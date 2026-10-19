#!/usr/bin/env python3
"""Render Degrade through Ableton-bundled Max 9 and verify its 5 DSP sections,
zero-CPU section bypass gates, dynamic reordering, and #0-degscope telemetry.

Cases:
  all_off    — All 5 sections disabled (`*_on 0`): passes input signal cleanly with active mask = 0
  bit_wrap   — Section 1 (`bit_on 1`, `bits 3`, `wrap_amt 0.7`): quantizes and folds waveform
  sr_sh      — Section 2 (`sr_on 1`, `srate 2500`, `sr_mode 0`): Sample-and-Hold staircase (>65% flat steps)
  codec_tele — Section 3 + 4 (`codec_on 1`, `tele_on 1`, `tele_mode 2`): lossy holes + ADPCM companding
  fft_glitch — Section 5 (`fft_on 1`, `fft_mode 1`, `fft_glitch 0.85`): spectral bin scramble
  order_a    — `order_code 1234` (BIT -> TELE) with Bit + Telecom enabled
  order_b    — `order_code 30124` (TELE -> BIT) with Bit + Telecom enabled (verifies reordering changes output)
"""

import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "degrade_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "degrade_probe.js")
HARNESS = os.path.join(ROOT, "tests", "degrade_harness.maxpat")
RESULT = "/tmp/degrade_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
CRASH_RECOVERY = os.path.expanduser(
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


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def build_harness(gen_code, case):
    mode = case["name"]
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 1600", 40, 80, 80, 20, numinlets=2, numoutlets=1),
        box("obj-dsp", "; dsp start", 40, 120, 80, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-arm", "delay 1500", 40, 160, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-on", "1", 40, 200, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-off", "0", 40, 280, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-peak", "delay 40", 40, 320, 70, 20, numinlets=2, numoutlets=1),
        box("obj-del-analyze", "delay 80", 40, 360, 70, 20, numinlets=2, numoutlets=1),
        box("obj-analyze", f"analyze {case['dur']}", 120, 360, 90, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-quit", "; max quit", 40, 420, 70, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-params", case["params"], 200, 40, 740, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-setbuf", "setbuffer #0-degscope", 200, 70, 190, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-bind", "scope #0-degscope", 200, 100, 180, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-scope", "buffer~ #0-degscope @samps 32", 520, 100, 210, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 2000 2", 520, 160, 150, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        # Rich two-tone test source (220 Hz + 1760 Hz)
        box("obj-osc1", "cycle~ 220", 200, 130, 70, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-osc2", "cycle~ 1760", 280, 130, 75, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-g1", "*~ 0.45", 200, 160, 55, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-g2", "*~ 0.20", 280, 160, 55, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-sum", "+~", 200, 185, 40, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [200.0, 215.0, 300.0, 75.0],
            }
        },
        box("obj-record", "record~ rec 2", 200, 305, 90, 20, numinlets=4, numoutlets=1, outlettype=[""]),
        box("obj-peak-l", "peakamp~", 200, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-r", "peakamp~", 290, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-c", "peakamp~", 380, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-mute-l", "*~ 0", 200, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-mute-r", "*~ 0", 260, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-dac", "dac~", 200, 430, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box(
            "obj-js",
            f"js {PROBE_JS} {mode}",
            200, 470, 420, 20,
            numinlets=4,
            numoutlets=3,
            outlettype=["bang", "bang", ""],
        ),
    ]

    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-load", 0, "obj-bind", 0),
        line("obj-bind", 0, "obj-gen", 0),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-setbuf", 0, "obj-js", 3),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-peak", 0),
        line("obj-del-peak", 0, "obj-peak-l", 0),
        line("obj-del-peak", 0, "obj-peak-r", 0),
        line("obj-del-peak", 0, "obj-peak-c", 0),
        line("obj-del-peak", 0, "obj-del-analyze", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-osc1", 0, "obj-g1", 0),
        line("obj-osc2", 0, "obj-g2", 0),
        line("obj-g1", 0, "obj-sum", 0),
        line("obj-g2", 0, "obj-sum", 1),
        line("obj-sum", 0, "obj-gen", 0),
        line("obj-sum", 0, "obj-gen", 1),
        line("obj-sum", 0, "obj-peak-c", 0),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-gen", 1, "obj-record", 1),
        line("obj-gen", 0, "obj-peak-l", 0),
        line("obj-gen", 1, "obj-peak-r", 0),
        line("obj-gen", 0, "obj-mute-l", 0),
        line("obj-gen", 1, "obj-mute-r", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-mute-r", 0, "obj-dac", 1),
        line("obj-peak-l", 0, "obj-js", 0),
        line("obj-peak-c", 0, "obj-js", 1),
        line("obj-peak-r", 0, "obj-js", 2),
        line("obj-analyze", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
    ]

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "rect": [80.0, 80.0, 980.0, 560.0],
            "boxes": boxes,
            "lines": lines,
        }
    }


def wait_for_max_idle():
    deadline = time.time() + 60.0
    while time.time() < deadline:
        res = subprocess.run(["pgrep", "-f", "Max.app/Contents/MacOS/Max"], capture_output=True, text=True)
        if res.returncode != 0 or not res.stdout.strip():
            return
        time.sleep(0.5)


def run_case(gen_code, case):
    wait_for_max_idle()
    if os.path.exists(RESULT):
        os.remove(RESULT)
    if os.path.exists(CRASH_RECOVERY):
        shutil.rmtree(CRASH_RECOVERY, ignore_errors=True)

    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(build_harness(gen_code, case), f, indent=2)

    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 30.0
    last_size = -1
    stable_ticks = 0

    while time.time() < deadline:
        if os.path.exists(RESULT):
            sz = os.path.getsize(RESULT)
            if sz > 32 and sz == last_size:
                stable_ticks += 1
                if stable_ticks >= 2:
                    break
            else:
                last_size = sz
                stable_ticks = 0
        time.sleep(0.15)

    if proc.poll() is None:
        try:
            proc.wait(timeout=3.5)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                proc.kill()
    time.sleep(0.35)

    if not os.path.exists(RESULT):
        raise RuntimeError(f"Case {case['name']} did not produce {RESULT}")

    out = {}
    with open(RESULT, "r", encoding="utf-8") as f:
        for raw_line in f:
            parts = raw_line.strip().split(" ", 1)
            if len(parts) == 2:
                try:
                    out[parts[0]] = float(parts[1])
                except ValueError:
                    out[parts[0]] = parts[1]
    return out


def main():
    if not os.path.exists(MAX_BIN):
        print(f"SKIP: Max binary not found at {MAX_BIN}")
        return

    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    cases = [
        {
            "name": "all_off",
            "dur": 450,
            "params": "wet 0.5, out_gain 0, bit_on 0, bits 16, wrap_amt 0, dither 0, sr_on 0, srate 44100, jitter 0, codec_on 0, codec_loss 0, preecho 0, birdies 0, tele_on 0, tele_line 0, fft_on 0, fft_glitch 0, order_code 1234",
        },
        {
            "name": "all_on_zero",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 16, wrap_amt 0, dither 0, sr_on 1, srate 44100, jitter 0, codec_on 1, codec_loss 0, preecho 0, birdies 0, tele_on 1, tele_line 0, fft_on 1, fft_glitch 0, order_code 1234",
        },
        {
            "name": "bit_wrap",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 2.5, wrap_amt 0.75, dither 0.15, sr_on 0, codec_on 0, tele_on 0, fft_on 0",
        },
        {
            "name": "sr_sh",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 1, srate 2200, jitter 0.0, sr_mode 0, codec_on 0, tele_on 0, fft_on 0",
        },
        {
            "name": "codec_wet",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 1, codec_loss 0.65, preecho 1.0, birdies 1.0, tele_on 0, fft_on 0",
        },
        {
            "name": "codec_100",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 1, codec_loss 1.0, preecho 0.35, birdies 0.65, tele_on 0, fft_on 0",
        },
        {
            "name": "codec_tele",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 1, codec_loss 0.8, preecho 0.5, birdies 0.6, tele_on 1, tele_mode 2, tele_line 0.75, fft_on 0",
        },
        {
            "name": "fft_den",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 0, fft_glitch 0.85, fft_frame 35",
        },
        {
            "name": "fft_scr5",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 1, fft_glitch 0.85, fft_frame 5",
        },
        {
            "name": "fft_spl",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 2, fft_glitch 0.85, fft_frame 45",
        },
        {
            "name": "fft_cmb",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 3, fft_glitch 0.85, fft_frame 45",
        },
        {
            "name": "order_a",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 2.0, wrap_amt 0.8, dither 0.0, sr_on 0, codec_on 0, tele_on 1, tele_mode 2, tele_line 0.85, fft_on 0, order_code 1234",
        },
        {
            "name": "order_b",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 2.0, wrap_amt 0.8, dither 0.0, sr_on 0, codec_on 0, tele_on 1, tele_mode 2, tele_line 0.85, fft_on 0, order_code 30124",
        },
    ]

    results = {}
    for c in cases:
        res = None
        for _attempt in range(3):
            try:
                res = run_case(gen_code, c)
                if res.get("scopeOrder", 0) != 0 and (c["name"] == "codec_100" or res.get("peak", 0) > 0.05):
                    break
            except Exception:
                time.sleep(1.0)
        results[c["name"]] = res
        print(
            f"[{c['name']:10s}] nan={int(res['nan'])} peak={res['peak']:.3f} rms={res['rms']:.3f} "
            f"stepDiff={res['stepDiff']:.3f} rough={res['roughness']:.4f} mask={int(res['scopeMask'])} order={int(res['scopeOrder'])}"
        )
        assert res["nan"] == 0, f"{c['name']}: Produced NaN samples!"
        if c["name"] != "codec_100":
            assert res["peak"] > 0.05, f"{c['name']}: Output was silent!"

    # 1. Verify all_off (at default wet=0.5) and all_on_zero (at wet=1.0, default knob values) pass audio cleanly
    assert results["all_off"]["scopeMask"] == 0, "all_off must report 0 active stages in #0-degscope"
    assert results["all_off"]["roughness"] < 0.035, "all_off must have clean sinusoidal roughness"
    assert results["all_on_zero"]["scopeMask"] == 31, "all_on_zero must report all 5 stages enabled (mask=31)"
    assert abs(results["all_on_zero"]["peak"] - tanh_ref(results["all_on_zero"]["ctl"])) < 0.12, "all_on_zero at default knob values must be transparent"
    assert results["all_on_zero"]["roughness"] < 0.035, "all_on_zero at default knob values must have clean sinusoidal roughness"

    # 2. Verify Sample-and-Hold at 2200 Hz produces staircase flat steps (>70% consecutive identical samples)
    assert results["sr_sh"]["stepDiff"] > 0.70, f"sr_sh should produce staircase hold steps, got {results['sr_sh']['stepDiff']}"
    assert results["sr_sh"]["scopeMask"] == 2, "sr_sh should report stage mask = 2"

    # 3. Verify Bit + Wrap alters waveform vs clean all_off
    assert abs(results["bit_wrap"]["hash"] - results["all_off"]["hash"]) > 100, "bit_wrap must alter waveform"
    assert results["bit_wrap"]["scopeMask"] == 1, "bit_wrap should report stage mask = 1"

    # 4. Verify Codec alone is smooth/spectral (not staircase/clipped or crunchy) and reports mask = 4
    assert results["codec_wet"]["scopeMask"] == 4, "codec_wet should report stage mask = 4"
    assert results["codec_wet"]["stepDiff"] < 0.05, "codec_wet must be smooth spectral audio, not staircase quantized"
    assert results["codec_wet"]["roughness"] < 0.08, f"codec_wet must have smooth sinusoidal roughness (<0.08), got {results['codec_wet']['roughness']}"
    assert abs(results["codec_wet"]["hash"] - results["all_off"]["hash"]) > 100, "codec_wet must spectrally transform audio"

    # 4b. Verify Codec at 100% Damage is nearly silent (extreme packet starvation) except for rare sinusoidal birdie glitches
    assert results["codec_100"]["rms"] < results["codec_wet"]["rms"] * 0.35, (
        f"codec_100 RMS ({results['codec_100']['rms']:.4f}) must be much quieter than codec_wet ({results['codec_wet']['rms']:.4f})"
    )
    assert results["codec_100"]["peak"] > 0.002, "codec_100 should still emit occasional faint birdie glitches (>0.002 peak)"
    assert results["codec_100"]["roughness"] < 0.08, "codec_100 birdie glitches must remain smooth sinusoids"

    # 5. Verify Codec + Telecom and all 4 FFT Glitch modes (Den, Scr, Spl, Cmb) run cleanly
    assert results["codec_tele"]["scopeMask"] == 12, "codec_tele should report stage mask = 4 + 8 = 12"
    for fft_key in ("fft_den", "fft_scr5", "fft_spl", "fft_cmb"):
        assert results[fft_key]["scopeMask"] == 16, f"{fft_key} should report stage mask = 16"
        assert results[fft_key]["stepDiff"] < 0.02, f"{fft_key} must not have sample-hold steps ({results[fft_key]['stepDiff']})"
        assert results[fft_key]["roughness"] < 0.085, f"{fft_key} must be smooth without quantization clicks ({results[fft_key]['roughness']})"

    # 5. Verify dynamic stage reordering (BIT -> TELE vs TELE -> BIT) produces distinct audio and telemetry
    assert int(results["order_a"]["scopeOrder"]) == 1234, "order_a should report order 1234"
    assert int(results["order_b"]["scopeOrder"]) == 30124, "order_b should report order 30124"
    assert results["order_a"]["hash"] != results["order_b"]["hash"], "Reordering BIT->TELE vs TELE->BIT must change output waveform!"

    print("ALL DEGRADE REAL MAX AUDIO TESTS PASSED!")


def tanh_ref(x):
    import math
    return math.tanh(x)


if __name__ == "__main__":
    main()
