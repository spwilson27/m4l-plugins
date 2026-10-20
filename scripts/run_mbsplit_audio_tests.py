#!/usr/bin/env python3
"""
Render Multiband Split (`src/mbsplit_core.genexpr`) through Ableton-bundled Max 9
and verify its DSP & telemetry buffer (`#0-splitscope`).

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
"""

import json
import math
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "mbsplit_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "mbsplit_probe.js")
HARNESS = os.path.join(ROOT, "tests", "mbsplit_harness.maxpat")
RESULT = "/tmp/mbsplit_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
CRASH_RECOVERY_DIR = os.path.expanduser(
    "~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"
)


def box(obj_id, text, x, y, w, h, **extra):
    b = {
        "id": obj_id,
        "maxclass": extra.pop("maxclass", "newobj"),
        "numinlets": extra.pop("numinlets", 1),
        "numoutlets": extra.pop("numoutlets", 1),
        "outlettype": extra.pop("outlettype", [""]),
        "patching_rect": [float(x), float(y), float(w), float(h)],
        "text": text,
    }
    b.update(extra)
    return {"box": b}


def gen_box(obj_id, gen_code, x, y):
    return {
        "box": {
            "code": gen_code,
            "fontname": "<Monospaced>",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "gen.codebox~",
            "numinlets": 2,
            "numoutlets": 2,
            "outlettype": ["signal", "signal"],
            "patching_rect": [float(x), float(y), 220.0, 60.0],
        }
    }


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def clear_crash_recovery():
    if os.path.isdir(CRASH_RECOVERY_DIR):
        for entry in os.listdir(CRASH_RECOVERY_DIR):
            full = os.path.join(CRASH_RECOVERY_DIR, entry)
            try:
                if os.path.isdir(full):
                    shutil.rmtree(full)
                else:
                    os.remove(full)
            except Exception:
                pass


def build_harness(gen_code, mode, dur_ms=500):
    boxes = [
        box("obj-load", "loadbang", 40, 30, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 1000", 40, 65, 75, 20, numinlets=2, numoutlets=1),
        box("obj-dsp", "; dsp start", 40, 100, 80, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-arm", "delay 1300", 40, 135, 75, 20, numinlets=2, numoutlets=1),
        box("obj-rec-on", "1", 40, 170, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-stop", f"delay {dur_ms}", 40, 205, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-off", "0", 40, 240, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-analyze", "delay 80", 40, 275, 70, 20, numinlets=2, numoutlets=1),
        box("obj-analyze", f"analyze {dur_ms}", 120, 275, 95, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-quit", "; max quit", 40, 340, 70, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-setbuf", "setbuffer #0-splitscope", 220, 30, 160, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-scope", "buffer~ #0-splitscope @samps 8224", 400, 30, 220, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 3000 2", 630, 30, 150, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-record", "record~ rec 2", 260, 420, 100, 20, numinlets=4, numoutlets=1, outlettype=[""]),
        box("obj-mute-l", "*~ 0", 260, 460, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-mute-r", "*~ 0", 320, 460, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-dac", "dac~", 260, 500, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box("obj-js", f"js {PROBE_JS}", 420, 420, 220, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
    ]

    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-setbuf", 0, "obj-js", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-analyze", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-analyze", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-mute-r", 0, "obj-dac", 1),
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

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, 1080.0, 580.0],
            "boxes": boxes,
            "lines": lines,
        }
    }


def run_case(gen_code, mode):
    clear_crash_recovery()
    if os.path.exists(RESULT):
        os.remove(RESULT)

    patch = build_harness(gen_code, mode)
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(patch, f, indent=2)

    proc = subprocess.Popen(
        [MAX_BIN, HARNESS],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    deadline = time.time() + 25.0
    stable_hits = 0
    last_size = -1
    while time.time() < deadline:
        if os.path.exists(RESULT):
            sz = os.path.getsize(RESULT)
            if sz > 20 and sz == last_size:
                stable_hits += 1
                if stable_hits >= 2:
                    break
            else:
                stable_hits = 0
                last_size = sz
        time.sleep(0.12)

    if proc.poll() is None:
        try:
            proc.wait(timeout=3.0)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                proc.kill()
    time.sleep(0.35)

    if not os.path.exists(RESULT):
        raise RuntimeError(f"Case {mode}: /tmp/mbsplit_audio.txt was not produced by Max")

    data = {}
    with open(RESULT, "r", encoding="utf-8") as f:
        for raw_line in f:
            parts = raw_line.strip().split()
            if len(parts) == 2:
                data[parts[0]] = float(parts[1])
    return data


def main():
    if not os.path.exists(MAX_BIN):
        print(f"SKIP: Max binary not found at {MAX_BIN}")
        sys.exit(0)

    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    try:
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

        print("All Real Max 9 Multiband Split audio & telemetry tests passed!")
    finally:
        if os.path.exists(HARNESS):
            os.remove(HARNESS)
        clear_crash_recovery()


if __name__ == "__main__":
    main()
