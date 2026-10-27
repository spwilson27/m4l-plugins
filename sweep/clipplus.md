# Sweep 2 lane report: clipplus (Clip+.amxd)

## Stage A+B summary
Host gate (typecheck, build, test_clipplus, bugsweep, preview) passes; test_face_fuzz 0 failures; test_device_static FAILS Clip+ (CP-03). vm_smoke PASS (21/21 params, 69 sets) with 1 warn (F10 = CP-02). Preview and Live screenshots read: no truncation/overlap at the default layout. Not checked in Live: Filter popout / Meters open layouts (the smoke only shows the default).
VM audio: new cases lat_* (impulse latency vs patcher 1047), ext_*, ceil_filt_*. Delay is exactly 1047 on the waveshaper, 4x, True Peak and Hard Limit paths (lat_d0/os/tp-less/hlim), and on the STFT path when the input never drops under 1e-5 (lat_d100_floor).

Counts: S1 0, S2 5, S3 0, S4 6.

## Findings
| id | sev | description | evidence | red test |
|---|---|---|---|---|
| CP-01 | S2 | `csApplyLayout` (src/clipplus_ui.js) moves every Options-column box except `True Peak`; with the Filter popout open (+120 px) or Meters on, TP stays at x=350 over the display/OUT section while the other buttons shift. | recorded presentation_rect calls | tests/test_clipplus_sweep2.js CP-01 |
| CP-02 | S2 | `obj-btn-chmode` (plain Button-mode live.text, `make_theme_text`) has no `parameter_enable 0`, so Live lists it as a parameter named "obj-btn-chmode". Automating/sweeping it fires `cycle_chmode`, which advances Channel Mode: this is the smoke F10 drift (`devices 0#3` = Chan 0 -> 1 after the sweep). | Live LOM list index 16 `obj-btn-chmode`; Chan = index 3 | tests/test_clipplus_sweep2.js CP-02 |
| CP-03 | S2 | F8 confirmed: `buffer~ #0-clipscope`, `scope #0-clipscope`, `setbuffer #0-clipscope` use a literal `#0` in a top-level device. In Live with two Clip+ the literal buffer `#0-clipscope` exists (61440 frames) = both instances write one scope (meters, GR, curve dots, spectrum, loudness cross-talk, DSP-ready counter shared). Fix with `---clipscope` (build + cpBufName defaults in clipplus_ui/dsp/meters, runner). | scripts/test_clipplus_sweep2_live.js (Live, 2 instances) FAIL F8; test_device_static FAIL | tests/test_clipplus_sweep2.js CP-03 |
| CP-04 | S2 | STFT path (Detail > 0): the silence gate in the core (`pkHop < 1e-5`, one 256-sample hop) judges only the newest hop of a 1024-sample frame, so the three frames that still contain a signal that just ended are zeroed. A single impulse after digital silence comes out at 2e-6 instead of 0.1 (same impulse over a -80 dB noise floor: exact 1047 samples, unity). Clips ending in digital silence lose their last ~16 ms. | audio `lat_d100` fails, `lat_d100_floor` passes | scripts/run_clipplus_audio_tests.py lat_d100 |
| CP-05 | S2 | Hard Limit (Peak) and True Peak act before the post-emphasis stage; with the Filter on the output exceeds Ceiling: Low Shelf 12 dB, ceiling -6 dB, 80 Hz sine -> peak 2.16 (limit 0.50); Low Cut mode adds the unclipped lows back (peak 0.59). AGENTS 29 says Hard Limit is a sample clip at Ceiling. (Alternative: document that the filter sits outside the ceiling.) | audio | scripts/run_clipplus_audio_tests.py ceil_filt_shelf, ceil_filt_cut |
| CP-06 | S4 | Doc drift: AGENTS 29 says default 418 px (Mid Size 240), the code has csMidW fixed at 180 (406 px) and no Mid Size control anywhere; `buffer~ ---clipscope 1280 1` is 1280 ms (61440 frames), not 1280 samples. | build | log only |
| CP-07 | S4 | `Show Meters` saved y = 150 but csApplyLayout puts it at y = 144 (jumps 6 px on load). | | log only |
| CP-08 | S4 | F9 (Max Console "inlet outlet already connected") not reproduced: built cords have no duplicates and cpDspLoad connects once; no Log.txt line in the VM. | | log only |
| CP-09 | S4 | Toggle `str_for_value` reads `val1`/`val2` in Live for the live.text parameters (Delta, DC, 4x, ...). | smoke report | log only |
| CP-10 | S4 | `ext_filt` (Low Cut 12 kHz, Q 10, +24 dB input and drive) is bounded only because of CP-05 behaviour: peak 28. No NaN. | audio | covered by CP-05 |
| CP-11 | gap | Added audio cases: latency (impulse), extremes (no NaN), ceiling with filter; Live check scripts/test_clipplus_sweep2_live.js + sweep/run_live.sh. | | |
