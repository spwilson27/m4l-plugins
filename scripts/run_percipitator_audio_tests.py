#!/usr/bin/env python3
"""Render Percipitator through Ableton-bundled Max and verify its DSP & telemetry.

Cases:
  dry            — wet=0 passes the 293.7 Hz 0.25 sine cleanly at ~0.25
  resynth_sine   — wet=1, wtpos=0 (Frame 0 = Sine), warp=0 resynthesizes into clean sine partials
  resynth_wt     — wet=1, wtpos=1 (Frame 3 = Square), wtmode=2 (Sync), warp=0.75 engages the
                   Square wavetable + Sync warp, producing much brighter harmonics (higher slopeRms)
  gate_silence   — input below Gate (-30 dB) produces silent precipitation output
  pitch_octave   — pitch=+12 st doubles the resynthesized frequency compared to pitch=0
  midi_sidechain — scalemask=64 (F# only) snaps band 3 (220 Hz) onto F# (pitch class 6)
  partials_vol   — resynthgain=-18 dB reduces resynthesized output level significantly compared to 0 dB
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "percipitator_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "percipitator_probe.js")
HARNESS = os.path.join(ROOT, "tests", "percipitator_harness.maxpat")
RESULT = "/tmp/percipitator_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)

DEFAULTS = "stretch 1, fshift 0, snap 1, scalemask 4095, decay 80, attack 1.5, blur 0.1, tilt 0, sieve 0, freeze 0, resynthgain 0"


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
    amp = case.get("amp", 0.25)
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 1200", 40, 80, 80, 20, numinlets=2, numoutlets=1),
        box("obj-dsp", "; dsp start", 40, 120, 80, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-arm", f"delay {case['arm']}", 40, 160, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-on", "1", 40, 200, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-off", "0", 40, 280, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-peak", "delay 40", 40, 320, 70, 20, numinlets=2, numoutlets=1),
        box("obj-del-analyze", "delay 80", 40, 360, 70, 20, numinlets=2, numoutlets=1),
        box("obj-analyze", f"analyze {case['dur']}", 120, 360, 90, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-quit", "; max quit", 40, 420, 70, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-params", case["params"], 200, 40, 680, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-setbuf", "setbuffer #0-percipwt #0-percipscope", 200, 70, 250, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-bind", "wt #0-percipwt, scope #0-percipscope", 200, 100, 250, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-wt", "buffer~ #0-percipwt @samps 8192", 520, 100, 220, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-scope", "buffer~ #0-percipscope @samps 64", 520, 130, 220, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 2000 2", 520, 160, 150, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recsize", "size 2000", 520, 185, 75, 20, maxclass="message", numinlets=2, numoutlets=1),
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
                "patching_rect": [200.0, 200.0, 300.0, 80.0],
            }
        },
        box("obj-record", "record~ rec 2", 200, 300, 90, 20, numinlets=4, numoutlets=1, outlettype=[""]),
        box("obj-peak-l", "peakamp~", 200, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-r", "peakamp~", 290, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-c", "peakamp~", 380, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-mute-l", "*~ 0", 200, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-mute-r", "*~ 0", 260, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-dac", "dac~", 200, 430, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box(
            "obj-js",
            f"js {PROBE_JS} sine",
            200, 470, 420, 20,
            numinlets=4,
            numoutlets=3,
            outlettype=["bang", "bang", ""],
        ),
        box("obj-tone", "cycle~ 293.7", 700, 200, 85, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-gain", f"*~ {amp}", 700, 240, 65, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
    ]

    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-recsize", 0),
        line("obj-recsize", 0, "obj-recbuf", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-load", 0, "obj-bind", 0),
        line("obj-bind", 0, "obj-gen", 0),
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
        line("obj-setbuf", 0, "obj-js", 3),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-analyze", 0, "obj-js", 3),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
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
        line("obj-tone", 0, "obj-gain", 0),
        line("obj-gain", 0, "obj-gen", 0),
        line("obj-gain", 0, "obj-gen", 1),
        line("obj-gain", 0, "obj-peak-c", 0),
    ]

    doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 40.0, 1000.0, 560.0],
            "boxes": boxes,
            "lines": lines,
        }
    }
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def cases():
    def params(extra):
        return extra + ", " + DEFAULTS

    return (
        {
            "name": "dry",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 0, pitch 0, gate -42, wtpos 0.3, wtmode 0, warp 0.3"),
        },
        {
            "name": "resynth_sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 0, gate -42, wtpos 0, wtmode 0, warp 0"),
        },
        {
            "name": "resynth_wt",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 0, gate -42, wtpos 1.0, wtmode 2, warp 0.75"),
        },
        {
            "name": "gate_silence",
            "amp": 0.0005,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 0, gate -30, wtpos 0.5, wtmode 0, warp 0.3"),
        },
        {
            "name": "pitch_octave",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 12, gate -42, wtpos 0, wtmode 0, warp 0"),
        },
        {
            "name": "midi_sidechain",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": "wet 1, pitch 0, stretch 1, fshift 0, snap 1, scalemask 64, gate -42, decay 80, attack 1.5, blur 0.1, tilt 0, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0, resynthgain 0",
        },
        {
            "name": "partials_vol",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": "wet 1, pitch 0, stretch 1, fshift 0, snap 1, scalemask 4095, gate -42, decay 80, attack 1.5, blur 0.1, tilt 0, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0, resynthgain -18",
        },
    )


def parse_result(text):
    meta = {}
    env = []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        if raw.startswith("env "):
            env = [float(x) for x in raw[4:].split()] if raw.strip() != "env" else []
            continue
        key, val = raw.split(None, 1)
        meta[key] = float(val)
    meta["env"] = env
    return meta


def run_case(gen_code, case):
    build_harness(gen_code, case)
    if os.path.exists(RESULT):
        os.remove(RESULT)
    recovery = os.path.expanduser(
        "~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"
    )
    if os.path.isdir(recovery):
        subprocess.run(["rm", "-rf", recovery], check=False)

    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 30
    while time.time() < deadline and not os.path.exists(RESULT):
        if proc.poll() is not None:
            break
        time.sleep(0.2)

    last_size = -1
    stable = 0
    while time.time() < deadline and stable < 2:
        if not os.path.exists(RESULT):
            break
        size = os.path.getsize(RESULT)
        if size > 0 and size == last_size:
            stable += 1
        else:
            stable = 0
            last_size = size
        time.sleep(0.15)

    if proc.poll() is None:
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
    time.sleep(0.3)
    print(f"--- {case['name']} ---")
    if not os.path.exists(RESULT):
        print("NO RESULT FILE")
        return None
    meta = parse_result(open(RESULT).read())
    print(
        f"genL {meta.get('genL'):.4f} ctl {meta.get('ctl'):.4f} peak {meta.get('peak'):.4f} "
        f"zcr {meta.get('zcr'):.0f} slopeRms {meta.get('slopeRms'):.4f} "
        f"bandMax {meta.get('scopeBandMax'):.4f} active {meta.get('scopeActive'):.0f} nan {meta.get('nan')}"
    )
    return meta


def main():
    with open(GEN_PATH, encoding="utf-8") as f:
        gen_code = f.read()
    only = set(sys.argv[1:])
    results = {}
    errors = []
    for case in cases():
        if only and case["name"] not in only:
            continue
        meta = run_case(gen_code, case)
        results[case["name"]] = meta
        if meta is None:
            errors.append(f"{case['name']}: no measurement")
            continue
        if meta.get("nan", 1) != 0:
            errors.append(f"{case['name']}: {meta.get('nan')} non-finite samples")
        name = case["name"]
        if name == "dry":
            if not (0.21 <= meta.get("peak", 0) <= 0.29):
                errors.append(f"dry: expected ~0.25 peak, got {meta.get('peak')}")
        elif name in ("resynth_sine", "resynth_wt"):
            if not (0.08 <= meta.get("peak", 0) <= 0.98):
                errors.append(f"{name}: wet output out of range ({meta.get('peak')})")
            if not (0.04 <= meta.get("scopeBandMax", 0) <= 1.5):
                errors.append(f"{name}: scope band meters not tracking ({meta.get('scopeBandMax')})")
            if meta.get("scopeActive", 0) < 1:
                errors.append(f"{name}: expected active resynthesized bands, got {meta.get('scopeActive')}")
        elif name == "gate_silence":
            if meta.get("peak", 1) > 0.005:
                errors.append(f"gate_silence: expected muted output below Gate, got {meta.get('peak')}")
        elif name == "pitch_octave":
            if meta.get("peak", 0) < 0.08:
                errors.append(f"pitch_octave: silent output ({meta.get('peak')})")
        elif name == "midi_sidechain":
            midi3 = meta.get("scopeMidi3", 0)
            pc3 = round(midi3) % 12
            print(f"midi_sidechain band3 quantized MIDI={midi3:.2f} (pitch_class={pc3}, expected 6=F#)")
            if pc3 != 6:
                errors.append(f"midi_sidechain: expected band 3 to quantize to F# (pitch class 6), got {midi3}")

    sine_m = results.get("resynth_sine")
    wt_m = results.get("resynth_wt")
    oct_m = results.get("pitch_octave")
    vol_m = results.get("partials_vol")
    if sine_m and wt_m:
        print(f"harmonic brightness: sine={sine_m.get('slopeRms'):.4f} -> square+sync={wt_m.get('slopeRms'):.4f}")
        if wt_m.get("slopeRms", 0) <= sine_m.get("slopeRms", 0) * 1.35:
            errors.append(
                f"Square wavetable + Sync warp should be harmonically brighter than Sine frame "
                f"({wt_m.get('slopeRms')} vs {sine_m.get('slopeRms')})"
            )
    if sine_m and oct_m:
        print(
            f"octave shift: zcr={sine_m.get('zcr'):.0f}->{oct_m.get('zcr'):.0f}, "
            f"slopeRms={sine_m.get('slopeRms'):.4f}->{oct_m.get('slopeRms'):.4f}"
        )
        if oct_m.get("slopeRms", 0) < sine_m.get("slopeRms", 0) * 1.75:
            errors.append(
                f"Pitch +12 st did not double frequency/slopeRms "
                f"({sine_m.get('slopeRms')} -> {oct_m.get('slopeRms')})"
            )
    if sine_m and vol_m:
        print(f"partials volume slider: 0dB={sine_m.get('peak'):.4f} -> -18dB={vol_m.get('peak'):.4f}")
        if vol_m.get("peak", 1) > sine_m.get("peak", 0) * 0.35:
            errors.append(
                f"Partials Vol slider at -18 dB did not attenuate resynthesized partials "
                f"({vol_m.get('peak')} vs {sine_m.get('peak')})"
            )

    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("percipitator audio checks passed")


if __name__ == "__main__":
    main()
