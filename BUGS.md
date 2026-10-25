# Amp+ core - pass 2 review (drops)

Worktree: /tmp/bugsweep/ampplus-core, branch bugsweep/ampplus-core-pass1.
Unit: Amp+ core (src/ampplus_core.genexpr, src/ampplus_models.js, scripts/build_ampplus.py, face code as built at HEAD).
Post-merge HEAD includes main's face redesign (d72ee17) via merge commit on this branch.

Pass 2 reviewed the single Finding 1 from pass 1 and **dropped** it. No real device bugs kept. No production/src changes.

## Dropped

### Finding 1 - Node genexpr mirror shares History across call sites (DROPPED — harness-only / out of scope)

- Pass 1 claim: `tests/genexpr_functions.js` transpile hoists each function-local `History` to one global per function (`H_${fn}_${name}`), so every JS call of `slew` / `biq` shares state. Red tests in `tests/test_ampplus_pass1.js` asserted real gen per-call-site semantics against that mirror (second `slew` should prime to 80; a fresh `biq` fed 0 should output 0 after another was driven with DC).
- Pass 2 verification:
  - Branch touches only `BUGS.md` + `tests/test_ampplus_pass1.js`; `src/` untouched (device core equals main).
  - Shipping `src/ampplus_core.genexpr` has exactly 7 independent `slew(...)` call sites (bass/mid/treble/presence/volume/position/cab) and 7 independent `biq(...)` call sites (4 tone + 3 cab HP/LP/peak), with an explicit comment above the tone stack: each `biq()` call is its own filter; a wrapper would share one History across every band.
  - Mirror transpile confirmed: one `H_*` global per function name — cannot model per-site History.
  - Grounding runs: `node tests/test_ampplus_pass1.js` fails as documented (actual ~40.04 vs expected 80); `node tests/test_ampplus.js` prints `ampplus ok`.
- Why drop: not a functional/DSP/UI/state/serialization **device** bug. Gen correctly gives each call site its own History; the VM audio suite already exercises that. The reds encode correct device semantics but assert them against a known-broken Node mirror. Fix belongs in the harness (`tests/genexpr_functions.js`), not in `ampplus_core.genexpr`. Pass 2 scope is device bugs only.
- Action: remove `tests/test_ampplus_pass1.js`; leave this note so pass 3 / harness work can pick up the mirror fix separately.

## Kept

(none)

## Investigated and cleared (no bug) — inherited from pass 1, re-affirmed

- DSP math vs AGENTS.md section 30 and the RBJ cookbook: toneDb spans give exactly plus/minus 12 dB (bass, mid, treble) and plus/minus 8 dB (presence); shelf alpha uses sinW times 0.7071 (slope 1) as RBJ requires; peak, HP and LP coefficients match; volCurve is the specified 2.5-power law (0 at 0, 1 at 100); filt clamps freq to 15..0.45 sr and q to at least 0.05.
- Cabinet tables vs build help text: condenser is brighter (LP times 1.25, peak times 0.55), dynamic is darker with the presence bump (peak plus 2.2 dB), cone-edge position darkens the LP, raises the HP and fades the peak; speaker counts in the face (1, 2, 4, 4, 1, 8) match the six cab types.
- Param mapping and defaults: every gen Param default matches build NUM and ENUM (tone 50, volume 80, position 0, cab on, cabtype 1 = 2x12, mic 0 = Dynamic); GEN prepend routing covers bass, mid, treble, presence, volume, cab, cabtype, mic, position; gain stays in front of neural via scale 0..100 to -18..+18, dbtoa, sig, slide 960 (50 maps to 0 dB, per spec).
- Scope path: buffer #0-ampscope is 32 samples; the gen pokes slots 0, 1 and 2..25 (26 used), so it fits. Audio tests leave scopeon at 0.
- Buffer.peek channel in ampplus_ui.js pullMeter: peek(1, 0, 1) looks off by one but is correct. Max JS Buffer channels are 1-based, confirmed repo-wide. Slot 0 is the envelope the meter wants.
- ampStep wraparound and clampIndex bounds in the face; model list vs NOTICE.json is already asserted by the existing suite.

## Environment note

Host gate needs local npm install (typescript + terser); without node_modules, tsc and the amxd minify step fail. Baseline: `node tests/test_ampplus.js` prints `ampplus ok`.
