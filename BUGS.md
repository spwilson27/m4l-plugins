# Amp+ core - pass 1 bug sweep (red tests only, no fixes)

Worktree: /tmp/bugsweep/ampplus-core, branch bugsweep/ampplus-core-pass1.
Unit: Amp+ core (src/ampplus_core.genexpr, src/ampplus_models.js, scripts/build_ampplus.py, face code as built at HEAD).
Post-merge HEAD includes main's face redesign (d72ee17) via merge commit on this branch.

## Finding 1 - the Node genexpr mirror shares History across call sites, so the suite is blind to per-instance state bugs

- Device semantics: in gen, a function-local History is inlined fresh at every call site. The core relies on this explicitly (comment above the tone-stack biq calls: Each biq call is its own filter; a wrapper would share one History across every band). The running device has seven independent slew instances (bass, mid, treble, presence, volume, position, cab) and seven independent biq instances (4 tone + 3 cab).
- Mirror behaviour: tests/genexpr_functions.js transpile hoists each function-local History to a single global named H_fn_name, shared by every call of that function in one load. All call sites collapse to one state.
- Consequence: the Node suite, the only fast check of the DSP functions, cannot detect any bug whose symptom is state leaking or priming across instances, and a test written naively against the mirror can assert behaviour the device does not have, and vice versa. Existing tests only ever exercise one instance at a time (the slew block and the biq block in test_ampplus.js), so nothing flags the gap.
- Red tests: tests/test_ampplus_pass1.js. One: a second slew call site must prime to its own target (mirror returns about 40.04 instead of 80). Two: a fresh biq instance fed 0 must output 0 after another instance was driven with DC (mirror leaks the previous state). Both fail against the current mirror. The fix belongs to the mirror (per-call-site state), not to the genexpr, whose per-site semantics the VM audio suite already exercises.
- Severity: test-harness defect, not a device DSP defect. Filed here because pass 1 covers the core and its tests, and this gap decides how much the green suite can be trusted for stateful DSP.
- Re-confirmed after merging main (face redesign + standalone Amp+ Wave/Pulse/Tiles/Strip/Mono devices): red tests still fail the same way; baseline node tests/test_ampplus.js still prints ampplus ok.

## Investigated and cleared (no bug)

- DSP math vs AGENTS.md section 30 and the RBJ cookbook: toneDb spans give exactly plus/minus 12 dB (bass, mid, treble) and plus/minus 8 dB (presence); shelf alpha uses sinW times 0.7071 (slope 1) as RBJ requires; peak, HP and LP coefficients match; volCurve is the specified 2.5-power law (0 at 0, 1 at 100); filt clamps freq to 15..0.45 sr and q to at least 0.05.
- Cabinet tables vs build help text: condenser is brighter (LP times 1.25, peak times 0.55), dynamic is darker with the presence bump (peak plus 2.2 dB), cone-edge position darkens the LP, raises the HP and fades the peak; speaker counts in the face (1, 2, 4, 4, 1, 8) match the six cab types.
- Param mapping and defaults: every gen Param default matches build NUM and ENUM (tone 50, volume 80, position 0, cab on, cabtype 1 = 2x12, mic 0 = Dynamic); GEN prepend routing covers bass, mid, treble, presence, volume, cab, cabtype, mic, position; gain stays in front of neural via scale 0..100 to -18..+18, dbtoa, sig, slide 960 (50 maps to 0 dB, per spec).
- Scope path: buffer #0-ampscope is 32 samples; the gen pokes slots 0, 1 and 2..25 (26 used), so it fits. Audio tests leave scopeon at 0.
- Buffer.peek channel in ampplus_ui.js pullMeter: peek(1, 0, 1) looks off by one but is correct. Max JS Buffer channels are 1-based, confirmed repo-wide (sampler_ui.js reads stereo as peek channel 1 and peek channel 2; the loudsplit, tinyspace, transplit and reverbplus faces all read mono buffers with peek channel 1). Slot 0 is the envelope the meter wants.
- ampStep wraparound and clampIndex bounds in the face; model list vs NOTICE.json is already asserted by the existing suite.

## Environment note

Merged main into this branch (ort) so the worktree now includes the committed Amp+ face redesign and the five standalone face devices. src/ampplus_core.genexpr and src/ampplus_models.js were unchanged by that merge; Finding 1 still applies to the shipping core. Host gate needs local npm install (typescript + terser); without node_modules, tsc and the amxd minify step fail. Baseline: node tests/test_ampplus.js prints ampplus ok. Pass 1 red: node tests/test_ampplus_pass1.js fails as documented.
