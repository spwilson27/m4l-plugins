# Bug sweep — Transient Split (transplit), Pass 2 (review reds — kept)

Worktree: `/tmp/bugsweep/transplit` · Branch: `bugsweep/transplit-pass1` · Base: `66fea67`
Pass 2: kept 1 / dropped 0. Bug 1 confirmed real (GenExpr cache omits SR; bin-1 probe never fires; JS recomputes every frame). Red test left as-is; still fails on unfixed code.
Scope: `devices/Transient Split.amxd` + `.adg`, `src/transplit_*`, `src/spectral_*`,
`scripts/spectral_common.py`, `scripts/build_transplit.py`, and the transplit/spectral tests.
Method: read AGENTS.md sections 22-23 and the sources; ran the four Node suites for a green
baseline; compared the JS reference (`src/transplit_config.js`) against its GenExpr mirror
(`src/transplit_core.genexpr`) line for line; audited the rack template
(`src/spectral_split_rack_main.genexpr`), the ring helpers (`src/spectral_split_rack.genexpr`),
the link/election module (`src/spectral_link.js`), the deferred-DSP loader
(`src/spectral_dsp.js`), the face (`src/transplit_ui.js`) and the build constants.

## Bug 1 — Tilt gains go stale on a sample-rate change (GenExpr only)

**Where:** `src/transplit_core.genexpr`, `ts_masks()` — the per-bin tilt-gain cache in
`tw` channel 2, keyed on the function-local History `cgTl / cgMd / cgN / cgW`.

**Mechanism:** The gains are rebuilt only when tilt, tilt mode, FFT size `n`, or `cgW`
changes, where `cgW` is compared against `tw.peek(1, md)` — the tilt weight at **bin 1**,
used as a cheap probe for "the tilt table changed". But bin 1 is in the clipped region of
the table for every common configuration: its frequency `max(sr/n, 20)` is below 100 Hz
for sample rates 44.1-96 kHz at `n >= 1024`, so
`u = clip(log(f/100)/log(100), 0, 1) = 0` and the weight is pinned at -1 (Standard) /
+1 (Contour) regardless of sample rate. A sample-rate change rebuilds the tilt *table*
(the ctl hook in the same file tracks `twSr` and re-runs `ts_tilttab` for exactly this
case) but does **not** invalidate the cached *gains*, which were computed from the old
table. The wrong gains persist until tilt, mode or size happens to change.

**Effect:** With Tilt non-zero, switching Live's sample rate (e.g. 44.1 <-> 48 <-> 96 kHz)
leaves the Transients/Tones tilt gains computed for the previous rate indefinitely.
Worked example (n = 1024, bin 64, Tilt = +1, Standard): weight 0.440 at 44.1 kHz vs
0.778 at 96 kHz, i.e. gain 1.837 vs the correct 2.930. The JS reference
(`cfg.tsMasks`) recomputes `exp(tl * 12 * w[k])` from the fresh table every frame, so
this is also a JS-vs-GenExpr mirror divergence. The same cache-key pattern should be
checked in the sibling split cores during their passes (not verified here).

**Red test:** `tests/test_transplit.js`, section 2, "tilt gains follow the sample rate"
(drives `ts_tilttab` at 44100, one `ts_masks` frame, `ts_tilttab` at 96000 — exactly what
the ctl hook does on a rate change — then asserts `tw` channel 2 at bin 64).

```
$ node tests/test_transplit.js
AssertionError [ERR_ASSERTION]: tilt gains follow the sample rate (bin 64 gain 1.8373469132695566, want 2.9301560515835208 for the 96 kHz table)
    at Object.<anonymous> (/private/tmp/bugsweep/transplit/tests/test_transplit.js:415:16)
```

**Fix direction (pass 3, not applied):** include the sample rate (or a mid-band probe bin
whose weight actually moves with `sr`) in the cache key — e.g. a `cgSr` History compared
against `sr`, mirroring the `twSr` tracking the ctl hook already does for the table.

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

## Commands / results

```
node tests/test_transplit.js          # RED: AssertionError above (new test, line 415)
node tests/spectral_link_tests.js      # passed
node tests/test_spectral_rack.js       # passed
node tests/test_spectral_dsp.js        # passed
```

Baseline before the new test: all four suites passed. Only `tests/test_transplit.js`
(one added block) and this file are committed; no source fixes in pass 1.
