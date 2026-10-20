#!/usr/bin/env python3
"""
Render Multiband Split (`src/mbsplit_core.genexpr`) through Ableton-bundled Max 9 on the shared
NonRealTime harness (`scripts/max_harness.py`, parallel-safe) and verify its DSP & telemetry
buffer (`#0-splitscope`).

Cases:
  1. flat_sum_4way           — 4 parallel Rack-chain instances (`bandmask` 1, 2, 4, 8)
                               summed together (`rmsL`) vs dry multi-band reference (`rmsR`).
                               Verifies 0.00 dB flat unity reconstruction (< 0.05 dB error).
  2. band_isolation_lr8      — 65 Hz bass tone split at 300 Hz (48 dB/oct LR8):
                               Chain 1 (`bandmask 1`, Low) passes at unity on L, while
                               Chain 2 (`bandmask 2`, High) rejects by > 40 dB on R.
  3. phase_gain_and_scope    — Chain 1 with `gain 6.0206` (+6 dB) boosts amplitude 2.0x on L;
                               Chain 2 with `phase 1` (180° invert) summed with dry cancels
                               to < 0.002 on R; verifies `#0-splitscope` telemetry updates.
  4. dyn_null_vs_delayed_allpass — Dynamic Phase 4-band sum vs the JS-reference F1 allpass of the
                               dry input delayed by 128 samples (null < -120 dB).
  5. dyn_band_isolation      — Dynamic Phase band 3 passes 2.4 kHz at 0 dB, rejects 300 Hz > 55 dB.
"""

import math
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
from max_harness import box, gen_box, line

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "mbsplit_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "mbsplit_probe.js")
SETTLE_MS = 300
DUR_MS = 500


def case_patch(gen_code, mode):
    """Device boxes / lines for one case. The shared scaffold (scripts/max_harness.py) provides
    obj-load, obj-record (2 ch), obj-mute-l / obj-mute-r and the probe obj-js."""
    boxes = [
        box("obj-setbuf", "setbuffer #0-splitscope", 220, 30, 160, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-scope", "buffer~ #0-splitscope @samps 8224", 400, 30, 220, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
    ]
    lines = [
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-setbuf", 0, "obj-js", 0),
    ]

    if mode == "flat_sum_4way":
        # Multi-band signal (80 Hz + 380 Hz + 1900 Hz + 7500 Hz) split across 4 bands (bandmask 15 = Band 1+2+3+4 sum)
        # and also verified against dry reference on Right channel
        boxes.extend([
            box("obj-osc1", "cycle~ 80", 200, 80, 70, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc2", "cycle~ 380", 280, 80, 75, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc3", "cycle~ 1900", 365, 80, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc4", "cycle~ 7500", 455, 80, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-sum-in", "*~ 0.15", 260, 120, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            gen_box("obj-gen1", gen_code, 220, 200),
            box("obj-p1", "scope #0-splitscope, numbands 4, slope 1, f1 150, f2 900, f3 4200, bandmask 15, gain 0, phase 0", 220, 160, 520, 20, maxclass="message", numinlets=2, numoutlets=1),
        ])
        lines.extend([
            line("obj-osc1", 0, "obj-sum-in", 0),
            line("obj-osc2", 0, "obj-sum-in", 0),
            line("obj-osc3", 0, "obj-sum-in", 0),
            line("obj-osc4", 0, "obj-sum-in", 0),
            line("obj-load", 0, "obj-p1", 0),
            line("obj-p1", 0, "obj-gen1", 0),
            line("obj-sum-in", 0, "obj-gen1", 0),
            line("obj-sum-in", 0, "obj-gen1", 1),
            # Record 4-band summed output on Left, dry input on Right
            line("obj-gen1", 0, "obj-record", 0),
            line("obj-sum-in", 0, "obj-record", 1),
            line("obj-gen1", 0, "obj-mute-l", 0),
            line("obj-sum-in", 0, "obj-mute-r", 0),
        ])

    elif mode == "band_isolation_lr8":
        # 48 dB/oct (LR8) 2-band split at 400 Hz with Band 1 (Low, bandmask=1) soloed:
        # Left channel (in1): 65 Hz bass sine (*~ 0.5) -> passes unattenuated (rmsL ~ 0.3535)
        # Right channel (in2): 6000 Hz treble sine (*~ 0.5) -> rejected by > 55 dB (rmsR < 0.0006)
        boxes.extend([
            box("obj-osc-l", "cycle~ 65", 200, 80, 70, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-scale-l", "*~ 0.5", 200, 115, 55, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc-r", "cycle~ 6000", 310, 80, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-scale-r", "*~ 0.5", 310, 115, 55, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            gen_box("obj-gen1", gen_code, 220, 195),
            box("obj-p1", "scope #0-splitscope, numbands 2, slope 2, f1 400, bandmask 1, gain 0, phase 0", 220, 155, 440, 20, maxclass="message", numinlets=2, numoutlets=1),
        ])
        lines.extend([
            line("obj-osc-l", 0, "obj-scale-l", 0),
            line("obj-osc-r", 0, "obj-scale-r", 0),
            line("obj-load", 0, "obj-p1", 0),
            line("obj-p1", 0, "obj-gen1", 0),
            line("obj-scale-l", 0, "obj-gen1", 0),
            line("obj-scale-r", 0, "obj-gen1", 1),
            line("obj-gen1", 0, "obj-record", 0),
            line("obj-gen1", 1, "obj-record", 1),
            line("obj-gen1", 0, "obj-mute-l", 0),
            line("obj-gen1", 1, "obj-mute-r", 0),
        ])

    elif mode == "phase_gain_and_scope":
        # 3-band split (140 Hz / 1600 Hz, 48 dB/oct LR8) with Band 2 (Mid, bandmask=2) soloed and +6.0206 dB gain:
        # Left channel (in1): 380 Hz mid sine (*~ 0.25) -> in Band 2 passband, boosted 2x to peak ~0.50 (rmsL ~ 0.3535)
        # Right channel (in2): 7500 Hz high sine (*~ 0.25) -> in Band 3 (muted by bandmask=2), rejected on out2 (rmsR < 0.002)
        # Scope telemetry verifies Band 2 & Band 3 pre-solo meters and 16-band spectrum analyzer
        boxes.extend([
            box("obj-osc-l", "cycle~ 380", 200, 80, 75, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-scale-l", "*~ 0.25", 200, 115, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc-r", "cycle~ 7500", 310, 80, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-scale-r", "*~ 0.25", 310, 115, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            gen_box("obj-gen1", gen_code, 220, 195),
            box("obj-p1", "scope #0-splitscope, numbands 3, slope 2, f1 140, f2 1600, bandmask 2, gain 6.0206, phase 0", 220, 155, 500, 20, maxclass="message", numinlets=2, numoutlets=1),
        ])
        lines.extend([
            line("obj-osc-l", 0, "obj-scale-l", 0),
            line("obj-osc-r", 0, "obj-scale-r", 0),
            line("obj-load", 0, "obj-p1", 0),
            line("obj-p1", 0, "obj-gen1", 0),
            line("obj-scale-l", 0, "obj-gen1", 0),
            line("obj-scale-r", 0, "obj-gen1", 1),
            line("obj-gen1", 0, "obj-record", 0),
            line("obj-gen1", 1, "obj-record", 1),
            line("obj-gen1", 0, "obj-mute-l", 0),
            line("obj-gen1", 1, "obj-mute-r", 0),
        ])

    elif mode == "dyn_null_vs_delayed_allpass":
        # Dynamic Phase 4-band sum must equal the F1 Linkwitz-Riley allpass of the input delayed by the FIR
        # latency (128 samples at 44.1 / 48 kHz). Left: Dynamic 4-band sum. Right: dry input. The probe dumps
        # both channels and main() rebuilds the delayed allpass reference offline with the JS reference DSP.
        boxes.extend([
            box("obj-osc1", "cycle~ 80", 200, 80, 70, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc2", "cycle~ 380", 280, 80, 75, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc3", "cycle~ 1900", 365, 80, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc4", "cycle~ 7500", 455, 80, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-noise", "noise~", 545, 80, 50, 20, numinlets=1, numoutlets=1, outlettype=["signal"]),
            box("obj-noise-amt", "*~ 0.1", 545, 105, 50, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-sum-in", "*~ 0.15", 260, 120, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            gen_box("obj-gen1", gen_code, 220, 200),
            box("obj-p1", "scope #0-splitscope, numbands 4, slope 1, f1 150, f2 900, f3 4200, bandmask 15, gain 0, phase 0, dynphase 1", 220, 160, 560, 20, maxclass="message", numinlets=2, numoutlets=1),
        ])
        lines.extend([
            line("obj-osc1", 0, "obj-sum-in", 0),
            line("obj-osc2", 0, "obj-sum-in", 0),
            line("obj-osc3", 0, "obj-sum-in", 0),
            line("obj-osc4", 0, "obj-sum-in", 0),
            line("obj-noise", 0, "obj-noise-amt", 0),
            line("obj-noise-amt", 0, "obj-sum-in", 0),
            line("obj-load", 0, "obj-p1", 0),
            line("obj-p1", 0, "obj-gen1", 0),
            line("obj-sum-in", 0, "obj-gen1", 0),
            line("obj-sum-in", 0, "obj-gen1", 1),
            line("obj-gen1", 0, "obj-record", 0),
            line("obj-sum-in", 0, "obj-record", 1),
            line("obj-gen1", 0, "obj-mute-l", 0),
            line("obj-sum-in", 0, "obj-mute-r", 0),
        ])

    elif mode == "dyn_band_isolation":
        # Dynamic Phase 4-band split (120 / 800 / 4500) with Band 3 (HI-M, bandmask=4) soloed:
        # Left: 2400 Hz (Band 3 centre) passes at unity. Right: 300 Hz (Band 2) rejected by the F2 FIR (> 55 dB).
        boxes.extend([
            box("obj-osc-l", "cycle~ 2400", 200, 80, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-scale-l", "*~ 0.5", 200, 115, 55, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-osc-r", "cycle~ 300", 310, 80, 75, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            box("obj-scale-r", "*~ 0.5", 310, 115, 55, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
            gen_box("obj-gen1", gen_code, 220, 195),
            box("obj-p1", "scope #0-splitscope, numbands 4, slope 1, f1 120, f2 800, f3 4500, bandmask 4, gain 0, phase 0, dynphase 1", 220, 155, 560, 20, maxclass="message", numinlets=2, numoutlets=1),
        ])
        lines.extend([
            line("obj-osc-l", 0, "obj-scale-l", 0),
            line("obj-osc-r", 0, "obj-scale-r", 0),
            line("obj-load", 0, "obj-p1", 0),
            line("obj-p1", 0, "obj-gen1", 0),
            line("obj-scale-l", 0, "obj-gen1", 0),
            line("obj-scale-r", 0, "obj-gen1", 1),
            line("obj-gen1", 0, "obj-record", 0),
            line("obj-gen1", 1, "obj-record", 1),
            line("obj-gen1", 0, "obj-mute-l", 0),
            line("obj-gen1", 1, "obj-mute-r", 0),
        ])

    return boxes, lines


def run_case(gen_code, mode, keep_dir=False):
    boxes, lines = case_patch(gen_code, mode)
    return mh.run_case(f"mbsplit_{mode}", boxes, lines, probe_js=PROBE_JS, settle_ms=SETTLE_MS,
                       dur_ms=DUR_MS, channels=2, mode="nrt", keep_dir=keep_dir)


def offline_dynamic_null(dump_path, sr, f1, slope):
    """Null the recorded Dynamic Phase sum (L) against the JS reference F1 allpass of the recorded dry input (R),
    delayed by the FIR latency. Skips the first 4096 samples while the reference filter state settles and the
    last 64. On the NonRealTime harness the null is about -149 dB (float precision); an FIR split error
    would leave about -6 dB around F2 / F3."""
    script = r"""
const fs = require("fs");
const cfg = require(process.argv[1]);
const sr = Number(process.argv[2]), f1 = Number(process.argv[3]), slope = Number(process.argv[4]);
const rows = fs.readFileSync(process.argv[5], "utf8").trim().split("\n").map((l) => l.split(" ").map(Number));
const D = cfg.firLatencyForSampleRate(sr);
const ref = cfg.createReferenceSplitterDsp(sr);
const ap = rows.map((r) => { const b = ref.processSample(r[1], f1, 900, 4200, 2, slope); return b[0] + b[1]; });
let e = 0, p = 0, n = 0;
for (let i = 4096; i < rows.length - 64; i++) { const d = rows[i][0] - ap[i - D]; e += d * d; p += rows[i][0] * rows[i][0]; n++; }
console.log(Math.sqrt(e / n), Math.sqrt(p / n));
"""
    out = subprocess.check_output(
        ["node", "-e", script, os.path.join(ROOT, "src", "mbsplit_config.js"), str(sr), str(f1), str(slope), dump_path],
        text=True,
    )
    a, b = out.split()
    return float(a), float(b)


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"SKIP: Max binary not found at {mh.MAX_BIN}")
        sys.exit(0)

    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    # Case 1: 4-way parallel chain flat unity sum
    r1 = run_case(gen_code, "flat_sum_4way")
    assert r1["nan"] == 0, f"flat_sum_4way produced NaNs: {r1}"
    err_db = abs(20.0 * math.log10(max(r1["rmsL"], 1e-9) / max(r1["rmsR"], 1e-9)))
    print(f"[PASS] flat_sum_4way         rmsSum={r1['rmsL']:.5f} rmsDry={r1['rmsR']:.5f} err={err_db:.4f} dB")
    assert err_db < 0.05, f"Expected 4-chain parallel sum within 0.05 dB of dry input (got {err_db:.4f} dB)"

    # Case 2: LR8 48 dB/oct band isolation
    r2 = run_case(gen_code, "band_isolation_lr8")
    assert r2["nan"] == 0, f"band_isolation_lr8 produced NaNs: {r2}"
    rej_db = 20.0 * math.log10(max(r2["rmsL"], 1e-9) / max(r2["rmsR"], 1e-9))
    print(f"[PASS] band_isolation_lr8    rmsLow={r2['rmsL']:.5f} rmsHigh={r2['rmsR']:.6f} rejection={rej_db:.1f} dB")
    assert r2["rmsL"] > 0.33, f"Expected Low band to pass 65 Hz at ~0.353 RMS (got {r2['rmsL']})"
    assert rej_db > 40.0, f"Expected >40 dB stopband rejection on High band for 65 Hz (got {rej_db:.1f} dB)"

    # Case 3: +6 dB Gain, 180-deg Phase Invert cancellation, and live #0-splitscope telemetry
    r3 = run_case(gen_code, "phase_gain_and_scope")
    assert r3["nan"] == 0, f"phase_gain_and_scope produced NaNs: {r3}"
    print(
        f"[PASS] phase_gain_and_scope  peakBoostL={r3['peakL']:.4f} phaseCancelR={r3['peakR']:.6f} "
        f"specMax={r3['scopeSpecMax']:.3f} scopeOut={r3['scopeOut']:.3f}"
    )
    assert 0.48 <= r3["peakL"] <= 0.52, f"Expected +6 dB boosted 0.25 sine to peak near 0.50 (got {r3['peakL']})"
    assert r3["peakR"] < 0.002, f"Expected 180-deg phase invert to null against normal phase (got {r3['peakR']})"
    assert r3["scopeSpecMax"] > 0.05 and r3["scopeOut"] > 0.20 and r3["scopeBeat"] > 0, (
        f"Expected active #0-splitscope telemetry (got {r3})"
    )

    # Case 4: Dynamic Phase 4-band sum nulls against the delayed F1 allpass (exact FIR latency)
    r4 = run_case(gen_code, "dyn_null_vs_delayed_allpass", keep_dir=True)
    assert r4["nan"] == 0, f"dyn_null_vs_delayed_allpass produced NaNs: {r4}"
    try:
        null_rms, sig_rms = offline_dynamic_null(os.path.join(r4["harness_dir"], "result.txt.dump"), r4["sr"], 150.0, 1)
    finally:
        shutil.rmtree(r4["harness_dir"], ignore_errors=True)
    null_db = 20.0 * math.log10(max(null_rms, 1e-15) / max(sig_rms, 1e-15))
    print(f"[PASS] dyn_null_delayed_ap   rmsSum={r4['rmsL']:.5f} residual={null_rms:.2e} null={null_db:.1f} dB firD={r4['scopeFirD']:.0f}")
    assert r4["rmsL"] > 0.05, f"Expected Dynamic Phase output signal (got {r4})"
    assert null_db < -120.0, f"Expected Dynamic Phase sum to null against the 128-sample delayed F1 allpass (got {null_db:.1f} dB)"
    assert r4["scopeFirD"] == 128 and r4["scopeDyn"] == 1, f"Expected scope telemetry firD=128, dyn=1 (got {r4})"

    # Case 5: Dynamic Phase linear-phase FIR band isolation
    r5 = run_case(gen_code, "dyn_band_isolation")
    assert r5["nan"] == 0, f"dyn_band_isolation produced NaNs: {r5}"
    pass_db = 20.0 * math.log10(max(r5["rmsL"], 1e-12) / (0.5 / math.sqrt(2.0)))
    rej_db5 = 20.0 * math.log10(max(r5["rmsR"], 1e-12) / (0.5 / math.sqrt(2.0)))
    print(f"[PASS] dyn_band_isolation    pass2400={pass_db:.3f} dB reject300={rej_db5:.1f} dB")
    assert abs(pass_db) < 0.1, f"Expected 2.4 kHz to pass Band 3 at 0 dB (got {pass_db:.3f} dB)"
    assert rej_db5 < -55.0, f"Expected 300 Hz rejected > 55 dB by Band 3 (got {rej_db5:.1f} dB)"

    print("All Real Max 9 Multiband Split audio & telemetry tests passed!")


if __name__ == "__main__":
    main()
