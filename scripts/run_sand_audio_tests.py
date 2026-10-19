#!/usr/bin/env python3
"""Render Sand through the Ableton-bundled Max and check the wet path.

Cases:
  dry      — mix 0, output matches the 0.25 tone
  thru     — order 0, amount 0, full wet matches the tone
  deriv    — order 1 at 220 Hz is much quieter than the tone
  lift     — a high amount brings that derivative back up
  integ    — order -1 is louder than the bare derivative
  left     — a left-only input stays off the right channel
  lp       — a low low-pass attenuates a 2 kHz tone
  hp       — a low high-pass passes a 2 kHz tone
  hard     — hard clip holds a slammed signal at or under full scale
  limit    — the limiter holds it under its ceiling
  order15  — the top derivative order stays finite
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "sand_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "sand_probe.js")
HARNESS = os.path.join(ROOT, "tests", "sand_harness.maxpat")
RESULT = "/tmp/sand_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
MAX_LOG = os.path.expanduser(
    "~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log"
)

BASE = (
    "amount 0, stages 1, dorder 0, soft 0, debrick 0, ftype 0, ffreq 18000, "
    "fpos 2, mix 100, outmode 0"
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
    mode = case["mode"]
    freq = 2000 if mode == "sine2k" else 220
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 800", 40, 80, 80, 20, numinlets=2, numoutlets=1),
        box("obj-dsp", "; dsp start", 40, 120, 80, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-arm", f"delay {case['arm']}", 40, 160, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-on", "1", 40, 200, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-off", "0", 40, 280, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-peak", "delay 40", 40, 320, 70, 20, numinlets=2, numoutlets=1),
        box("obj-del-analyze", "delay 80", 40, 360, 70, 20, numinlets=2, numoutlets=1),
        box("obj-analyze", f"analyze {case['dur']}", 120, 360, 110, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-quit", "; max quit", 40, 420, 70, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-params", case["params"], 200, 40, 760, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-setbuf", "setbuffer #0-sandwave", 200, 70, 180, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-bind", "wave #0-sandwave", 200, 100, 160, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-wave", "buffer~ #0-sandwave 100 2", 520, 100, 180, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 2000 2", 520, 140, 140, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
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
                "patching_rect": [200.0, 200.0, 280.0, 80.0],
            }
        },
        box("obj-record", "record~ rec 2", 200, 300, 90, 20, numinlets=3, numoutlets=1, outlettype=[""]),
        box("obj-peak-l", "peakamp~", 200, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-r", "peakamp~", 290, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-c", "peakamp~", 380, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-mute-l", "*~ 0", 200, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-mute-r", "*~ 0", 260, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-dac", "dac~", 200, 430, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box(
            "obj-js",
            f"js {PROBE_JS} {mode}",
            200, 470, 360, 20,
            numinlets=4,
            numoutlets=1,
            outlettype=["bang"],
        ),
        box("obj-tone", f"cycle~ {freq}", 700, 200, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-gain", "*~ 0.25", 700, 240, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-load", 0, "obj-bind", 0),
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
        line("obj-bind", 0, "obj-gen", 0),
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
        line("obj-gain", 0, "obj-peak-c", 0),
    ]
    if mode == "left":
        boxes.append(box("obj-zero", "sig~ 0", 780, 240, 50, 20, numinlets=1, numoutlets=1, outlettype=["signal"]))
        lines.append(line("obj-zero", 0, "obj-gen", 1))
    else:
        lines.append(line("obj-gain", 0, "obj-gen", 1))

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


def params(extra):
    return BASE + ", " + extra


def cases():
    return (
        {"name": "dry", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 0, dorder 0, amount 0")},
        {"name": "thru", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, outmode 0")},
        {"name": "deriv", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 0, outmode 0")},
        {"name": "lift", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 80, outmode 0")},
        {"name": "integ", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder -1, amount 0, outmode 0")},
        {"name": "left", "mode": "left", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, outmode 0")},
        {"name": "lp", "mode": "sine2k", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, ftype 0, ffreq 400, fpos 2, outmode 0")},
        {"name": "lp_diff", "mode": "sine2k", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, ftype 0, ffreq 400, fpos 1, outmode 0")},
        {"name": "hp", "mode": "sine2k", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, ftype 2, ffreq 400, fpos 2, outmode 0")},
        {"name": "hard", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 140, outmode 1")},
        {"name": "limit", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 140, outmode 2")},
        {"name": "order5", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 5, amount 0, outmode 0")},
        {"name": "order8", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 8, amount 0, outmode 0")},
        {"name": "order15", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 15, amount 40, outmode 0")},
        {"name": "debrick", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 80, debrick 100, outmode 0")},
    )


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        if not raw.strip():
            continue
        key, val = raw.split(None, 1)
        meta[key] = float(val)
    return meta


def clear_recovery():
    import shutil
    recovery = os.path.expanduser(
        "~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"
    )
    shutil.rmtree(recovery, ignore_errors=True)


def run_case(gen_code, case, retried=False):
    # A previous Max can write Crash Recovery after it is killed and the next
    # launch then opens that patch on top of the harness, measuring silence.
    subprocess.run(["pkill", "-f", "sand_harness.maxpat"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    subprocess.run(["pkill", "-f", "tinyspace_harness.maxpat"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        still = subprocess.run(["pgrep", "-f", "sand_harness.maxpat"], stdout=subprocess.DEVNULL)
        if still.returncode != 0:
            break
        time.sleep(0.25)
    time.sleep(0.4)
    clear_recovery()
    build_harness(gen_code, case)
    if os.path.exists(RESULT):
        os.remove(RESULT)
    log_size = os.path.getsize(MAX_LOG) if os.path.exists(MAX_LOG) else 0
    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 25
    while time.time() < deadline and not os.path.exists(RESULT):
        if proc.poll() is not None:
            break
        time.sleep(0.25)
    if proc.poll() is None:
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
    time.sleep(0.3)
    print(f"--- {case['name']} ---")
    if not os.path.exists(RESULT):
        print("NO RESULT FILE")
        dump_log(log_size)
        return None
    text = open(RESULT).read()
    meta = parse_result(text)
    print(
        f"genL {meta.get('genL')} genR {meta.get('genR')} ctl {meta.get('ctl')} "
        f"peak {meta.get('peak')} corr {meta.get('corr')} wave {meta.get('wave')} "
        f"nan {meta.get('nan')} sr {meta.get('sr')} ch {meta.get('ch')}"
    )
    dump_log(log_size)
    if not retried and meta.get("ctl", 0) < 0.05:
        print(f"{case['name']}: control was silent, retrying once")
        return run_case(gen_code, case, retried=True)
    return meta


def dump_log(log_size):
    if not os.path.exists(MAX_LOG):
        return
    log = open(MAX_LOG, errors="replace").read()
    new = log[log_size:] if log_size < len(log) else log[-8000:]
    interesting = [
        line for line in new.splitlines()
        if any(k in line.lower() for k in ("error", "failed", "probe_"))
    ]
    if interesting:
        print("--- max log ---")
        print("\n".join(interesting[-20:]))


def require_ctl(name, meta, errors):
    ctl = meta.get("ctl", 0)
    if not (0.2 <= ctl <= 0.3):
        errors.append(f"{name}: control peak {ctl} (expected the 0.25 tone)")


def require_finite(name, meta, errors):
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    require_ctl(name, meta, errors)
    require_finite(name, meta, errors)
    peak = meta.get("peak", 0)
    if name == "dry":
        if not (0.2 <= meta.get("genL", 0) <= 0.3 and 0.2 <= meta.get("genR", 0) <= 0.3):
            errors.append(f"{name}: dry output should match the tone ({meta.get('genL')}, {meta.get('genR')})")
    elif name == "thru":
        if not (0.18 <= peak <= 0.32):
            errors.append(f"{name}: order 0 amount 0 should pass the tone ({peak})")
        if meta.get("wave", 0) < 0.02:
            errors.append(f"{name}: scope buffer is not receiving audio ({meta.get('wave')})")
    elif name == "deriv":
        if peak > 0.02:
            errors.append(f"{name}: first derivative of 220 Hz should be quiet ({peak})")
        meta["deriv_peak"] = peak
    elif name == "lift":
        if peak < 0.2:
            errors.append(f"{name}: amount should restore the derivative ({peak})")
    elif name == "integ":
        if peak < 0.2:
            errors.append(f"{name}: integrator should be louder than the derivative ({peak})")
    elif name == "left":
        if meta.get("genL", 0) < 0.15:
            errors.append(f"{name}: left channel is quiet ({meta.get('genL')})")
        if meta.get("genR", 0) > 0.02:
            errors.append(f"{name}: right channel leaked ({meta.get('genR')})")
    elif name in ("lp", "lp_diff"):
        if peak > 0.12:
            errors.append(f"{name}: low-pass did not cut 2 kHz ({peak})")
    elif name == "hp":
        if peak < 0.15:
            errors.append(f"{name}: high-pass removed 2 kHz ({peak})")
    elif name == "hard":
        if peak > 1.02:
            errors.append(f"{name}: hard clip exceeded full scale ({peak})")
        if peak < 0.2:
            errors.append(f"{name}: hard clip was silent ({peak})")
    elif name == "limit":
        if peak > 0.95:
            errors.append(f"{name}: limiter exceeded its ceiling ({peak})")
        if peak < 0.2:
            errors.append(f"{name}: limiter was silent ({peak})")
    elif name in ("order5", "order8", "order15"):
        if peak > 0.02:
            errors.append(f"{name}: a high order on a low sine should stay quiet ({peak})")
    elif name == "debrick":
        if peak > 0.85:
            errors.append(f"{name}: debrick did not ease the slammed derivative ({peak})")


def main():
    gen_path = sys.argv[1] if len(sys.argv) > 1 else GEN_PATH
    with open(gen_path, encoding="utf-8") as f:
        gen_code = f.read()
    errors = []
    results = {}
    only = set(sys.argv[2:])
    for case in cases():
        if only and case["name"] not in only:
            continue
        meta = run_case(gen_code, case)
        results[case["name"]] = meta
        check(case["name"], meta, errors)
    deriv = (results.get("deriv") or {}).get("peak", 1)
    lift = (results.get("lift") or {}).get("peak", 0)
    if deriv < 1 and lift and lift < deriv * 2:
        errors.append(f"amount did not raise the derivative ({deriv} -> {lift})")
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
