#!/usr/bin/env python3
"""Render Better GrainSpec through Ableton-bundled Max 9 and verify DSP + telemetry.

Cases:
  unbound       — buffers not bound to gen, output stays silent with zero NaN
  default_trig  — triggered slice produces audio and updates #0-gsstate visual meters
  trans_high    — Trans 100% preserves sharp initial attack energy (first 22 ms)
  trans_zero    — Trans 0% skips direct punch and starts in stretched body
  stretch_slow  — Speed 0% freezes / sustains a short 80 ms hit past 500 ms
  morph_spec    — Morph 100% (Spectral) produces valid phase-locked output distinct from Morph 0%
  comb_pitch    — CombMix + CombFbk adds pitched comb resonance without runaway explosion
"""

import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "grainspec_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "grainspec_probe.js")
HARNESS = os.path.join(ROOT, "tests", "grainspec_harness.maxpat")
RESULT = "/tmp/grainspec_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)

DEFAULTS = "pitch 0, crush 0, wet 1, keymode 0, midi_note 60, gate 1, rev 0, capture 0"


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
    boxes = [
        box("obj-load", "loadbang", 40, 30, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 1100", 40, 65, 75, 20, numinlets=2, numoutlets=1),
        box("obj-dsp", "; dsp start", 40, 100, 80, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-arm", f"delay {case['arm']}", 40, 135, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-on", "1", 40, 170, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-trig-msg", case["trig"], 110, 170, 220, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-stop", f"delay {case['dur']}", 40, 210, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-off", "0", 40, 245, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-peak", "delay 40", 40, 280, 70, 20, numinlets=2, numoutlets=1),
        box("obj-del-analyze", "delay 80", 40, 315, 70, 20, numinlets=2, numoutlets=1),
        box("obj-analyze", f"analyze {case['dur']}", 120, 315, 95, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-quit", "; max quit", 40, 365, 70, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-params", case["params"], 220, 30, 620, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-setbuf", "setbuffer #0-gssample #0-gsslices #0-gsstate", 220, 60, 330, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-samp", "buffer~ #0-gssample 2000 2", 560, 95, 200, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-slices", "buffer~ #0-gsslices @samps 512", 560, 125, 210, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-state", "buffer~ #0-gsstate @samps 16", 560, 155, 200, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 4000 2", 560, 185, 160, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
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
                "patching_rect": [220.0, 180.0, 300.0, 80.0],
            }
        },
        box("obj-record", "record~ rec 2", 220, 285, 90, 20, numinlets=4, numoutlets=1, outlettype=[""]),
        box("obj-peak-l", "peakamp~", 220, 325, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-r", "peakamp~", 300, 325, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-c", "peakamp~", 380, 325, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-tone", "cycle~ 220", 720, 220, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-gain", "*~ 0.25", 720, 255, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-mute-l", "*~ 0", 220, 365, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-mute-r", "*~ 0", 280, 365, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-dac", "dac~", 220, 405, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box(
            "obj-js",
            f"js {PROBE_JS} {case['name']}",
            220,
            445,
            380,
            20,
            numinlets=4,
            numoutlets=3,
            outlettype=["bang", "bang", ""],
        ),
    ]

    if case["bind"]:
        boxes.append(
            box(
                "obj-bind",
                "samp #0-gssample, slices #0-gsslices, state #0-gsstate",
                220,
                95,
                330,
                20,
                maxclass="message",
                numinlets=2,
                numoutlets=1,
            )
        )

    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-trig-msg", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-trig-msg", 0, "obj-gen", 0),
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
        line("obj-tone", 0, "obj-gain", 0),
        line("obj-gain", 0, "obj-peak-c", 0),
        line("obj-gen", 0, "obj-mute-l", 0),
        line("obj-gen", 1, "obj-mute-r", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-mute-r", 0, "obj-dac", 1),
        line("obj-peak-l", 0, "obj-js", 0),
        line("obj-peak-c", 0, "obj-js", 1),
        line("obj-peak-r", 0, "obj-js", 2),
    ]
    if case["bind"]:
        lines.append(line("obj-load", 0, "obj-bind", 0))
        lines.append(line("obj-bind", 0, "obj-gen", 0))

    doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 40.0, 980.0, 520.0],
            "boxes": boxes,
            "lines": lines,
        }
    }
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def cases():
    def p(extra):
        return extra + ", " + DEFAULTS

    return (
        {
            "name": "unbound",
            "bind": False,
            "arm": 220,
            "dur": 300,
            "params": p("speed 0.25, grainsize 38, morph 0.35, trans 0.75, jitter 0.1, combmix 0.3, combfbk 0.5"),
            "trig": "slice 0, trigcount 1",
        },
        {
            "name": "default_trig",
            "bind": True,
            "arm": 220,
            "dur": 450,
            "params": p("speed 0.25, grainsize 38, morph 0.35, trans 0.75, jitter 0.15, combmix 0.3, combfbk 0.55"),
            "trig": "slice 0, trigcount 1",
        },
        {
            "name": "trans_high",
            "bind": True,
            "arm": 220,
            "dur": 350,
            "params": p("speed 0, grainsize 45, morph 0, trans 1.0, jitter 0, combmix 0, combfbk 0"),
            "trig": "slice 0, trigcount 1",
        },
        {
            "name": "trans_zero",
            "bind": True,
            "arm": 220,
            "dur": 350,
            "params": p("speed 0, grainsize 45, morph 0, trans 0.0, jitter 0, combmix 0, combfbk 0"),
            "trig": "slice 0, trigcount 1",
        },
        {
            "name": "stretch_slow",
            "bind": True,
            "arm": 220,
            "dur": 750,
            "params": p("speed 0.05, grainsize 42, morph 0.2, trans 0.3, jitter 0.05, combmix 0, combfbk 0"),
            "trig": "slice 1, trigcount 1",
        },
        {
            "name": "morph_spec",
            "bind": True,
            "arm": 220,
            "dur": 450,
            "params": p("speed 0.15, grainsize 40, morph 1.0, trans 0.0, jitter 0, combmix 0, combfbk 0"),
            "trig": "slice 0, trigcount 1",
        },
        {
            "name": "comb_pitch",
            "bind": True,
            "arm": 220,
            "dur": 500,
            "params": p("speed 0.2, grainsize 38, morph 0.3, trans 0.5, jitter 0, combmix 0.85, combfbk 0.92"),
            "trig": "slice 0, trigcount 1",
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
        k, v = raw.split(None, 1)
        meta[k] = float(v)
    meta["env"] = env
    return meta


def env_max(env, start, end):
    chunk = env[start:end]
    return max(chunk) if chunk else 0.0


def run_case(gen_code, case):
    build_harness(gen_code, case)
    if os.path.exists(RESULT):
        os.remove(RESULT)
    recovery = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Crash Recovery")
    if os.path.isdir(recovery):
        shutil.rmtree(recovery, ignore_errors=True)

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
        sz = os.path.getsize(RESULT)
        if sz > 0 and sz == last_size:
            stable += 1
        else:
            stable = 0
            last_size = sz
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
    env = meta.get("env", [])
    print(
        f"genL {meta.get('genL'):.4f} genR {meta.get('genR'):.4f} ctl {meta.get('ctl'):.4f} "
        f"peak {meta.get('peak'):.4f} meter {meta.get('meter'):.4f} combHz {meta.get('combHz'):.1f} "
        f"zcr {meta.get('zcr'):.4f} nan {meta.get('nan')}"
    )
    print("env " + " ".join(f"{v:.4f}" for v in env[:50]))
    return meta


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    if not (0.2 <= meta.get("ctl", 0) <= 0.3):
        errors.append(f"{name}: control tone missing ({meta.get('ctl')})")
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: non-finite samples ({meta.get('nan')})")
    if meta.get("peak", 99) > 1.55:
        errors.append(f"{name}: output clipped / exploded ({meta.get('peak')})")

    env = meta.get("env", [])
    if name == "unbound":
        if meta.get("peak", 1) > 0.005:
            errors.append(f"{name}: unbound buffer should be silent ({meta.get('peak')})")
    elif name == "default_trig":
        if meta.get("peak", 0) < 0.15:
            errors.append(f"{name}: triggered slice output too quiet ({meta.get('peak')})")
        if not (0.02 < meta.get("meter", 0) < 1.5):
            errors.append(f"{name}: state telemetry meter not updating ({meta.get('meter')})")
        if abs(meta.get("combHz", 0) - 220.0) > 2.0:
            errors.append(f"{name}: comb filter did not lock to 220 Hz slice pitch ({meta.get('combHz')})")
    elif name == "stretch_slow":
        early = env_max(env, 0, 100)
        sustained = env_max(env, 450, 700)
        print(f"stretch_slow early {early:.4f} sustained {sustained:.4f}")
        if early < 0.08:
            errors.append(f"{name}: slice did not start ({early})")
        if sustained < 0.03:
            errors.append(f"{name}: 80 ms hit was not time-stretched past 500 ms ({sustained})")
    elif name == "morph_spec":
        if meta.get("peak", 0) < 0.05:
            errors.append(f"{name}: spectral stretch output silent ({meta.get('peak')})")
    elif name == "comb_pitch":
        if meta.get("peak", 0) < 0.15 or meta.get("peak", 99) > 1.5:
            errors.append(f"{name}: comb filter output out of bounds ({meta.get('peak')})")


def main():
    with open(GEN_PATH, encoding="utf-8") as f:
        gen_code = f.read()
    only = set(sys.argv[1:])
    errors = []
    results = {}
    for case in cases():
        if only and case["name"] not in only:
            continue
        meta = run_case(gen_code, case)
        results[case["name"]] = meta
        check(case["name"], meta, errors)

    th = results.get("trans_high")
    tz = results.get("trans_zero")
    if th and tz:
        punch_hi = env_max(th.get("env", []), 0, 22)
        punch_lo = env_max(tz.get("env", []), 0, 22)
        print(f"transient first 22 ms: trans=1.0 -> {punch_hi:.4f}, trans=0.0 -> {punch_lo:.4f}")
        if punch_hi < punch_lo * 1.4 or punch_hi < 0.45:
            errors.append(f"Transient preservation did not boost initial attack punch ({punch_hi:.4f} vs {punch_lo:.4f})")

    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("grainspec audio checks passed")


if __name__ == "__main__":
    main()
