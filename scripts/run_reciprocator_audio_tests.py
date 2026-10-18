#!/usr/bin/env python3
"""Render Reciprocator through Ableton-bundled Max and verify its DSP & scope telemetry.

Cases:
  bypass     — Mix=0% or Amount=0% passes the 0.25 sine wave at its original 0.25 amplitude
  flatten    — Two-level input (0.50 loud then 0.035 quiet, >23 dB apart) is flattened so
               both halves exit near Ceiling (-1 dB ≈ 0.89) within ~1.5 dB of each other
  gate_mute  — Input below Gate (-42 dB) is muted near 0.0 instead of being boosted to full scale
  audiorate  — Ultra-fast Attack/Release (0.05 ms / 0.5 ms) squares/waveshapes the sine wave
               (lowering crest factor vs a pure sine) with zero NaN and bounded Ceiling
  ceiling    — Hot 0.95 input with Ceiling = -6 dB (0.501) never exceeds 0.52
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "reciprocator_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "reciprocator_probe.js")
HARNESS = os.path.join(ROOT, "tests", "reciprocator_harness.maxpat")
RESULT = "/tmp/reciprocator_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
MAX_LOG = os.path.expanduser(
    "~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log"
)

DEFAULTS = "lookahead 1.5, detect 0.25, schp 40, sclp 16000, softclip 0"


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
    mode = case["mode"]
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
        box("obj-setbuf", "setbuffer #0-recipscope", 200, 70, 190, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-bind", "scope #0-recipscope", 200, 100, 180, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-scope", "buffer~ #0-recipscope @samps 32", 520, 100, 210, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 4000 2", 520, 160, 150, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
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
    ]

    if mode == "sine":
        amp = case.get("amp", 0.25)
        boxes.append(box("obj-tone", "cycle~ 220", 700, 200, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-gain", f"*~ {amp}", 700, 240, 65, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        lines.extend([
            line("obj-tone", 0, "obj-gain", 0),
            line("obj-gain", 0, "obj-gen", 0),
            line("obj-gain", 0, "obj-gen", 1),
            line("obj-gain", 0, "obj-peak-c", 0),
        ])
    elif mode == "twotone":
        # Starts at 0.50 amplitude, then steps down to 0.035 at 350 ms after recording starts.
        boxes.append(box("obj-tone", "cycle~ 220", 700, 180, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-env", "*~ 0.5", 700, 240, 55, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-line", "line~ 0.5", 780, 240, 65, 20, numinlets=2, numoutlets=2, outlettype=["signal", "bang"]))
        boxes.append(box("obj-step-hi", "0.5", 780, 180, 40, 20, maxclass="message", numinlets=2, numoutlets=1))
        boxes.append(box("obj-del-step", "delay 350", 830, 180, 70, 20, numinlets=2, numoutlets=1))
        boxes.append(box("obj-step-lo", "0.035 10", 830, 210, 65, 20, maxclass="message", numinlets=2, numoutlets=1))
        lines.extend([
            line("obj-tone", 0, "obj-env", 0),
            line("obj-line", 0, "obj-env", 1),
            line("obj-env", 0, "obj-gen", 0),
            line("obj-env", 0, "obj-gen", 1),
            line("obj-env", 0, "obj-peak-c", 0),
            line("obj-del-arm", 0, "obj-step-hi", 0),
            line("obj-step-hi", 0, "obj-line", 0),
            line("obj-del-arm", 0, "obj-del-step", 0),
            line("obj-del-step", 0, "obj-step-lo", 0),
            line("obj-step-lo", 0, "obj-line", 0),
        ])

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
            "name": "bypass",
            "mode": "sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 350,
            "params": params("amount 0.0, gate -42, attack 2, release 60, wet 1, ceiling -1"),
        },
        {
            "name": "flatten",
            "mode": "twotone",
            "arm": 250,
            "dur": 800,
            "params": params("amount 1.0, gate -48, attack 1.0, release 25, wet 1, ceiling -1"),
        },
        {
            "name": "gate_mute",
            "mode": "sine",
            "amp": 0.0005,
            "arm": 250,
            "dur": 350,
            "params": params("amount 1.0, gate -36, attack 1.5, release 40, wet 1, ceiling -1"),
        },
        {
            "name": "audiorate",
            "mode": "sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 350,
            "params": "amount 1.0, gate -48, attack 0.05, release 0.5, wet 1, ceiling -1, lookahead 0, detect 0, schp 20, sclp 18000, softclip 1",
        },
        {
            "name": "ceiling",
            "mode": "sine",
            "amp": 0.90,
            "arm": 250,
            "dur": 350,
            "params": params("amount 1.0, gate -48, attack 0.5, release 40, wet 1, ceiling -6"),
        },
        {
            "name": "invert",
            "mode": "twotone",
            "arm": 250,
            "dur": 800,
            "params": params("amount 1.5, gate -54, attack 1.0, release 25, wet 1, ceiling 0"),
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


def env_max(env, start, end):
    chunk = env[start:end]
    return max(chunk) if chunk else 0.0


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
    env = meta.get("env", [])
    print(
        f"genL {meta.get('genL'):.4f} ctl {meta.get('ctl'):.4f} peak {meta.get('peak'):.4f} "
        f"crest {meta.get('crest'):.3f} scopeEnv {meta.get('scopeEnv'):.4f} "
        f"scopeOut {meta.get('scopeOut'):.4f} scopeGate {meta.get('scopeGate'):.3f} nan {meta.get('nan')}"
    )
    return meta


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    env = meta.get("env", [])
    if name == "bypass":
        if not (0.21 <= meta.get("peak", 0) <= 0.29):
            errors.append(f"bypass: expected ~0.25 peak, got {meta.get('peak')}")
    elif name == "flatten":
        loud_win = env_max(env, 80, 300)
        quiet_win = env_max(env, 450, 750)
        print(f"flatten loud_win={loud_win:.4f} quiet_win={quiet_win:.4f}")
        if not (0.72 <= loud_win <= 0.96):
            errors.append(f"flatten: loud section did not reach Ceiling (~0.89), got {loud_win}")
        if not (0.72 <= quiet_win <= 0.96):
            errors.append(f"flatten: quiet 0.035 section was not reciprocated to Ceiling (~0.89), got {quiet_win}")
        if abs(loud_win - quiet_win) > 0.14:
            errors.append(f"flatten: loud ({loud_win}) and quiet ({quiet_win}) sections were not leveled")
        if not (0.01 < meta.get("scopeOut", 0) <= 1.05):
            errors.append(f"flatten: scope buffer output peak not tracking ({meta.get('scopeOut')})")
    elif name == "gate_mute":
        steady = env_max(env, 80, 320)
        print(f"gate_mute steady={steady:.6f}")
        if steady > 0.005:
            errors.append(f"gate_mute: sub-gate noise should be muted, got {steady}")
        if meta.get("scopeGate", 1) > 0.1:
            errors.append(f"gate_mute: scopeGate should report closed, got {meta.get('scopeGate')}")
    elif name == "audiorate":
        # A pure sine has crest factor sqrt(2) ≈ 1.414. Sub-ms reciprocal tracking squares the wave toward 1.05..1.28.
        crest = meta.get("crest", 2.0)
        print(f"audiorate crest={crest:.4f} peak={meta.get('peak'):.4f}")
        if not (1.0 <= crest <= 1.33):
            errors.append(f"audiorate: expected squared/waveshaped crest factor < 1.33, got {crest}")
        if meta.get("peak", 0) < 0.7 or meta.get("peak", 99) > 0.95:
            errors.append(f"audiorate: peak out of range ({meta.get('peak')})")
    elif name == "ceiling":
        # Ceiling = -6 dB ≈ 0.5012
        pk = env_max(env, 60, 320)
        print(f"ceiling steady_peak={pk:.4f}")
        if not (0.44 <= pk <= 0.53):
            errors.append(f"ceiling: expected output clamped near -6 dB (0.501), got {pk}")
    elif name == "invert":
        # At Amount = 150% (1.5), the quiet 0.035 input section gets boosted HIGHER than the loud 0.50 section!
        loud_win = env_max(env, 80, 300)
        quiet_win = env_max(env, 450, 750)
        print(f"invert loud_win={loud_win:.4f} quiet_win={quiet_win:.4f}")
        if not (quiet_win > loud_win + 0.10):
            errors.append(f"invert: expected quiet section ({quiet_win}) > loud section ({loud_win}) at Amount=150%")


def main():
    with open(GEN_PATH, encoding="utf-8") as f:
        gen_code = f.read()
    only = set(sys.argv[1:])
    errors = []
    for case in cases():
        if only and case["name"] not in only:
            continue
        meta = run_case(gen_code, case)
        check(case["name"], meta, errors)
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("reciprocator audio checks passed")


if __name__ == "__main__":
    main()
