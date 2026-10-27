# Sweep 2 lane report: EQ+ (stage A+B)

Counts: S1 0, S2 2, S3 0, S4 3.

| id | sev | description | evidence | red test |
|---|---|---|---|---|
| EQP-S2-01 | S2 | `buffer~ #0-eqpluscfg/-eqplusspec/-eqplusir` (and the `setbuffers` / `eqcfg ...` messages) use `#0-`, which Live does not expand in a top-level device: all EQ+ instances share one cfg / spectrum / IR buffer (coefficients and spectrum of one instance overwrite another's). Fix: `---` names (also in src/eqplus_ui.js defaults, core header comments, runner harness patch). | `node tests/test_device_static.js` (3 violations for EQ+.amxd), built device boxes obj-buf-cfg/spec/ir, obj-msg-setbuf, obj-msg-gen-buf | `tests/test_eqplus_sweep2.js` EQP-S2-01 |
| EQP-S2-02 | S2 (infra) | `scripts/run_eqplus_audio_tests.py` calls `node` via subprocess (coefficients); the VM has no node, so the Max suite cannot run where Max is allowed. Fix: host-generate coefficients (JSON file synced to the VM) like other runners; add `scripts/vm_eqplus.sh` wrapper. | Runner raises CalledProcessError in the VM. For this audit I ran it in the VM with a recorded-output `node` shim (not committed). | `tests/test_eqplus_sweep2.js` EQP-S2-02 |
| EQP-S4-01 | S4 | No AGENTS.md section for EQ+; no `vm_eqplus.sh`. | | log only |
| EQP-S4-02 | S4 | Curve B (Right/Side route) bands are not separately automatable: the 40 band params always mirror the currently displayed curve (set_route re-emits them, so no stale state found). Design note. | probe: set_route emits all b*_ params | log only |
| EQP-S4-03 | S4 | vm_smoke: after the 54-parameter sweep + restore, track meter A reads 0.948 vs baseline 0.858 (B unchanged 0.857). Face looks identical; likely a clip-position meter fluke, unverified. No gen fixdenorm / sleep for 8-band cascades (CPU denormals untested). | tests/out/smoke/eq/report.txt | log only |

## Checked, no defect found
- Host gate (typecheck, build, test_eqplus 2766 checks, bugsweep, preview) passes; preview eq.png clean.
- test_face_fuzz: 0 failures; the 22 "leaves canvas" warnings are mock artifacts (the mock canvas stays 370 px while the face widens the device through resizeDeviceBoxes / setwidth_cmd).
- Probes (node, mock): band dot press/release at all four plot corners and 10 modes keeps freq/gain/q (no jump); drag to off-canvas / NaN / Infinity / undefined coordinates stays clamped and finite, no non-finite outlets, no paint error; Q handle double-click resets Q to 0.7071 without enabling another band; Q handle stays inside canvas at plot edges.
- Parameters: 54 params, ranges/defaults/units sane, every live.* has set_<key> handler or band handler, route to face and back wired; set_route re-emits bands (no loop); hotkeys gated by hotkeyAllowed().
- VM audio suite (14 cases) all pass: bypass 0.00 dB, bell +12.00, notch -108, lowcut, gain6, cascade, tilt_low/high, lat0 / latnat(350) / latlin(3072), lr_right, ms_side, no NaN.
- vm_smoke: PASS (54/54 params, 219 sets, ready 425 ms); screenshots show the face rendering correctly in Live.

## Verify
- EQP-S2-01 KEEP: ran test, fails for the stated reason (5 boxes with #0- names); AGENTS rule 15 / 1d say #0 is not expanded in top-level devices, expected --- is right; matches baseline F8, not an iteration-1 item.
- EQP-S2-02 KEEP: runner invokes subprocess "node" (lines 298, 322); VM has no node (AGENTS 1a); deterministic static check, fails for the stated reason.
- EQP-S4-01..03 not tested (log only), no verdict needed.
- Note: git diff main also shows unrelated Neural Amp changes (branch base behind main); not part of this lane.

## Fix
- EQP-S2-01 fixed: `#0-eqplus*` -> `---eqplus*` in build_eqplus.py, src/eqplus_ui.js / config / core comments, runner harness patch, tests/test_eqplus.js (updated expectations to `---`). Commit a9a546f.
- EQP-S2-02 fixed: runner replays `scripts/eqplus_audio_fixtures.json` when node is absent (records when present; `--fixtures`); added `scripts/vm_eqplus.sh audio`. Commit a9a546f.
- EQP-S4-01 fixed (AGENTS section 32 appended, vm_eqplus.sh). S4-02/03 log only.
- Gate: typecheck, build, test_eqplus (2766), bugsweep, sweep2 tests all green, test_device_static EQ+ 0 violations, test_face_fuzz 0 failures, preview Read clean; vm_smoke PASS (54/54 params, screenshot clean). VM audio suite run via vm_eqplus.sh (see summary).
- VM Max audio re-run: NOT completed. After the rename (DSP unchanged, only buffer names) `vm_eqplus.sh audio` and a 4-case subset hung 15+ min with no output (harness idle; VM Max/Live shared with other lanes, likely the known WindowServer/lock wedge). Stage A's full 14-case pass was on the old names; smoke in Live passes with the new names (gens ready, meters move). Re-run `M4L_VM_DIR=sweep2/eqplus scripts/vm_eqplus.sh audio` once the VM is free.

## Review
- Rebuilt EQ+.amxd: identical to committed (no diff in devices/). typecheck, test_eqplus (2766), test_eqplus_sweep2, test_device_static (EQ+ 0 violations) green. Fixtures regenerate with no diff.
- Diff touches only EQ+ files, vm_eqplus.sh (new, not a frozen infra edit), AGENTS.md (single append, section 32) and the report. No frozen/shared files changed.
- VM Max audio re-run completed after the earlier hang: all 14 cases pass on the `---` names (bypass 0.00 dB, bell +12.00, notch -108, tilt, latency 0/1488/3072, lr_right, ms_side, no NaN).
- Test quality: S2-01 inspects the built device boxes (proves bug); S2-02 is a regex on the runner source (weak but deterministic, accompanied by the real VM run).
- No fixes needed. Deferred shared: none (the unrelated Neural Amp diff vs main is branch-base drift).
