# Bug sweep — Transient Split (transplit), Pass 4 (review)

Worktree: `/tmp/bugsweep/transplit` · Branch: `bugsweep/transplit-pass1` · Base: `66fea67`
Pass 3: fixed 1 / remaining 0. Bug 1 fixed — GenExpr tilt-gain cache now keys on sample rate (`cgSr`), mirroring `twSr`. Host gate green.
Pass 4: **APPROVED** — no code changes. Fix is minimal, correct, and matches the existing History cache-key pattern; red test unchanged and green; no drive-by refactors.
Scope: `devices/Transient Split.amxd` + `.adg`, `src/transplit_*`, `src/spectral_*`,
`scripts/spectral_common.py`, `scripts/build_transplit.py`, and the transplit/spectral tests.
Method: applied the pass-2 fix direction in `ts_masks`; re-ran the host gate until green.

## Bug 1 — Tilt gains go stale on a sample-rate change (GenExpr only) — FIXED

**Where:** `src/transplit_core.genexpr`, `ts_masks()` — the per-bin tilt-gain cache in
`tw` channel 2, keyed on the function-local History `cgTl / cgMd / cgN / cgW` (and now `cgSr`).

**Mechanism:** The gains were rebuilt only when tilt, tilt mode, FFT size `n`, or `cgW`
changed, where `cgW` is compared against `tw.peek(1, md)` — the tilt weight at **bin 1**,
used as a cheap probe for "the tilt table changed". But bin 1 is in the clipped region of
the table for every common configuration: its frequency `max(sr/n, 20)` is below 100 Hz
for sample rates 44.1-96 kHz at `n >= 1024`, so
`u = clip(log(f/100)/log(100), 0, 1) = 0` and the weight is pinned at -1 (Standard) /
+1 (Contour) regardless of sample rate. A sample-rate change rebuilt the tilt *table*
(the ctl hook in the same file tracks `twSr` and re-runs `ts_tilttab` for exactly this
case) but did **not** invalidate the cached *gains*, which were computed from the old
table. The wrong gains persisted until tilt, mode or size happened to change.

**Effect:** With Tilt non-zero, switching Live's sample rate (e.g. 44.1 <-> 48 <-> 96 kHz)
left the Transients/Tones tilt gains computed for the previous rate indefinitely.
Worked example (n = 1024, bin 64, Tilt = +1, Standard): weight 0.440 at 44.1 kHz vs
0.778 at 96 kHz, i.e. gain 1.837 vs the correct 2.930. The JS reference
(`cfg.tsMasks`) recomputes `exp(tl * 12 * w[k])` from the fresh table every frame, so
this was also a JS-vs-GenExpr mirror divergence.

**Red test (now green):** `tests/test_transplit.js`, section 2, "tilt gains follow the sample rate"
(drives `ts_tilttab` at 44100, one `ts_masks` frame, `ts_tilttab` at 96000 — exactly what
the ctl hook does on a rate change — then asserts `tw` channel 2 at bin 64).

**Fix applied (pass 3):** Added `History cgSr(0)` alongside the other `ts_masks` cache-
history vars, and included `cgSr != sr` in the rebuild condition with `cgSr = sr` inside
the rebuild block — mirroring the existing `twSr` pattern in the ctl hook. Keying on `sr`
invalidates the gains when the sample rate changes even though bin 1 stays clipped.

Touchpoints:
- `src/transplit_core.genexpr` — `History cgSr(0)` next to `cgW` in `ts_masks`
- `src/transplit_core.genexpr` — rebuild condition `... || cgSr != sr`; assign `cgSr = sr` in the rebuild block
- `tests/test_transplit.js:415` — assertion now passes (test left unchanged)

Commit SHA: `17d4b1b1347fd049e909e0a41e83c3d16b022416`

## Examined, no credible bug found

- Mask maths constants and helpers: JS named constants vs GenExpr literals (history
  rise/fall 0.014/0.040 s, onset 4.5 + 5.5 dB with bias 12, deviation 0.10/0.30 with bias
  0.12/0.27, tilt 12 dB, blend `min(1,2b)` / `min(1,2(1-b))`, smoothstep) — identical.
  Tilt tables (`tsTiltTables` vs `ts_tilttab`) — identical, incl. `log(100)` literal.
- Rack template reader/writer: signed centred counter differences (`ss2_wd`), slot
  arithmetic (`ss2_slot`), gap fade (256 in / 512 out), follower validity window
  (64 < age < RS-64), underrun -> fbk 3, `muteLeft = n + 128` restart muting with ring
  writes continuing so followers stay aligned — coherent.
- Serve/election: JS serve mask `(1<<K)-1` in a rack, gen `eserveH` forcing the own bit
  (`2^(selH-1)`, or bit K for All), `sAllCh` counting only real channels, DERIVE gating,
  epoch-change resets, leader election excluding fb=1 peers and dead-reported incumbents
  — consistent between `spectral_link.js`, the template and the tests.
- Telemetry layout: template scalars at SCB+0..+17 with +5 deliberately left for the
  device mean-mask slot; `transplit_config.js` TS_SC_* constants, the core header comment
  and the face reads (`tsPoll`, wave ring `frame mod 64`) all agree. Scope buffer 800 >=
  TS_SCOPE_SAMPS 786; ring buffer = `rack_ring_samps(2)`.
- Latency: every functional use is `RACK_LATENCY` = 5120 (gen reader/dry delay, scope
  slot, build line 216, `TS_LATENCY` displayed by the face).
- Sleep path: `ZERO_COUNT = 512` clears exactly the four display arrays; scalars are
  handled by explicit pokes; the face stops drawing on `awake = 0`.
- Face interaction: slider/drag mappings for Bias, Blend, Tilt, Decay, Smoothing match
  the parameter ranges and defaults; `tsResolveSel` maps Auto/Transients/Tones/All as
  documented.

## Non-functional notes (not bugs, no tests)

- `scripts/build_transplit.py` line 8 (docstring) and line 69 (Size help text) still say
  the latency is/stays 4096; the device actually delays and reports 5120 (see above).
  Prose only — Live-facing help for Size contradicts the face's own "Latency 5120 smp".
- `src/transplit_config.js` line 133 comment describes Contour as "+1 at the mids"; the
  code (and every other comment) is -1 at the centre, +1 at the edges.

## Pass 4 review

**Verdict: APPROVED** (no production follow-up).

- **Bug 1 (`cgSr`):** Minimal three-line GenExpr change (`History cgSr(0)`, `|| cgSr != sr`,
  `cgSr = sr` in the rebuild block). Correctly mirrors ctl-hook `twSr` / `ts_tilttab`.
  Bin-1 `cgW` probe stays clipped across SR at common n, so the SR key is necessary and
  sufficient. JS `tsMasks` recomputes `exp(tl * … * w[k])` every frame (no cache) — no
  remaining mirror gap. Red test left unchanged from pass 1 and is green.
- Diff vs main is only: BUGS.md, the red test (+17), `src/transplit_core.genexpr` (+3/-1),
  and rebuilt device artifacts. No drive-by refactors; tests not weakened.
- Non-functional prose notes (latency 4096 vs 5120 help text; Contour comment sign) left
  as notes — out of scope for this bugsweep.

## Commands / results

```
npm run -s typecheck && python3 scripts/build_transplit.py && node tests/test_transplit.js
# GREEN (pass 4 re-run): All Transient Split tests passed (incl. "tilt gains follow the sample rate")
node tests/spectral_link_tests.js      # passed (via test_transplit suite)
node tests/test_spectral_rack.js       # passed
node tests/test_spectral_dsp.js        # passed
```

Pass 1 committed the red test + this file; pass 2 confirmed the bug; pass 3 applied the
`cgSr` cache-key fix in `src/transplit_core.genexpr` and turned the host gate green;
pass 4 reviewed and approved with no further code changes.
