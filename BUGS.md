# Loud Split — Pass 1 bug hunt (red tests only, no fixes)

Branch: `bugsweep/loudsplit-pass1` · Worktree: `/tmp/bugsweep/loudsplit`

## BUG 1 — Mix dry share is 1/3 for a standalone single-channel Output (should be full dry)

**Severity:** audible level error in a documented configuration.

**Symptom.** A standalone Loud Split (not in the `.adg` rack) with `Output` set to
Loud, Mid or Quiet and `Mix` below 100 % outputs `(1 - mix) * dry / 3` instead of
`(1 - mix) * dry`. The dry component is ~9.5 dB low; at `Mix = 0 %` the device
outputs `dry / 3` instead of passing the dry signal through. `Output = All` (or
`Auto` outside a rack) is unaffected.

**Contract (AGENTS.md §24, “Mix”).** “Each instance outputs
`mix * wet_own + (1 - mix) * dry / K` … `K = 3` when one chain of a rack
(outsel 1..3), `K = 1` for Output All / outside a rack, so the rack sum is
`mix * wet + (1 - mix) * dry`.” The JS reference agrees:
`lsMixOut(wetOwn, dry, mix, k) = mix * wetOwn + (1 - mix) * dry / k`
(`src/loudsplit_config.js:90`), with `k` = the number of summed outputs.

**Root cause.** `src/spectral_split_rack_main.genexpr:480`:

```
kShare = selH > 0.5 ? @@KSHARE@@ : 1;
ov1 = fixnan(fixdenorm(mixS * wetL + (1 - mixS) * kShare * dryL.read(@@LAT@@)));
```

`@@KSHARE@@` is substituted as `repr(1.0 / k)` (= 1/3 for K = 3) by
`scripts/spectral_common.py:256`. The share is keyed **only** on `selH`, the
resolved output selection (`selH = clip(floor(outsel + 0.5), 0, K)`, ctl hook
line 158). No rack-presence / peer term reaches the mix: the template does track
served channels (`serveH` / `eserveH` / `allc` → `sAllCh`), but `sAllCh` feeds
only the DERIVE shortcut (line 303). Inside the rack the behaviour is correct by
accident of summation — each of the three chains selects its own channel and
contributes `dry / 3`, summing to full dry. A lone device has nothing to sum
with, so the share must be 1.

**Shared-framework flag.** The fault lives in the shared rack template
(`src/spectral_split_rack_main.genexpr`) and the shared build substitution
(`scripts/spectral_common.py`), not in Loud Split–specific code. Every device
built on the same template (the spectral split suite: Transient Split, Harmonic
Split, Freq Split, Multiband Split, …) presumably has the same standalone
single-channel Mix bug and should be checked in its own pass.

**Red test.** `tests/test_loudsplit.js`, §5 (after the existing Mix sum identity):
a model anchor (`lsMixOut(..., 1)` keeps full dry — passes; the JS reference is
correct) plus the failing assertion that the expanded gen must not contain the
selection-only share line `kShare = selH > 0.5 ? 0.3333333333333333 : 1`.

```
$ node tests/test_loudsplit.js
[ref] … passed
[genexpr] transpiled lib + ls_* tests passed
[lint] genexpr lint and link module tests passed
[device] built device and rack preset checks passed
AssertionError [ERR_ASSERTION]: gen dry share keys on selH alone (kShare = 1/3
for any single-channel Output): a standalone device with Output Loud / Mid /
Quiet must keep K = 1
    at Object.<anonymous> (tests/test_loudsplit.js:697:12)
```

## Checked and found correct (do not re-hunt)

- `lsMasks` (JS) vs `ls_masks` (genexpr) mirror: tilt table, lmax excluding bins
  0 and half, relative floor −150, Rise/Fall coefficient, smoothstep knees,
  `lo = min(tlo, thi)`, masks sum to 1 — identical.
- Latency: `LS_LATENCY` 5120 everywhere (patcher attribute, dry delay, tests);
  the “4096” in §22 is the suite’s generic hop wording, not this device.
- Parameter tables: build NUM/ENUM/GEN_MSG vs `LS_PARAMS` / `LS_ENUMS` /
  `LS_GEN_PARAMS` — ranges and initials all match; gen Param defaults match.
- Telemetry scope: channel rows (Loud 2, Mid 3, Quiet 4, sum 5), `LS_SC_*`
  offsets, 512 telemetry columns zeroed on sleep.
- `sAge` resets (template lines 266 / 296) match the documented restart
  semantics (“age = frames since the state was (re)started”); the JS model
  restarts age with a fresh state the same way.
- `ss_cols` bin-edge rounding vs `lsColBin`: documented as matching for the
  sizes used; covered by existing tests.
- UI maths: threshold / knee / Rise / Fall / Tilt drag mappings, `lsEffLo`
  clamp, solo override in `lsEmitSel`, UI defaults vs the parameter tables.
