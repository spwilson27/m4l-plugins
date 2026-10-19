#!/usr/bin/env python3
"""Render Tiny Space through the Ableton-bundled Max and check the wet path.

The harness uses buffer~ #0-tsconfig, the same name the device uses. Gen only
sees that buffer after `set tsconfig #0-tsconfig`. Without it, Mix at 100% is
silent because every delay line stays off.

Cases:
  unbound  — data is poked, gen is not bound, full wet stays near zero
  dry      — bound, wet 0, output matches the 0.25 tone
  wet      — bound, wet 1, both channels move and are not identical
  width0   — bound, width 0, left and right match
  sizes    — two impulses; a larger Size delays the second one more
  room     — impulse has an early hit and a tail, without huge samples
  comb     — impulse repeats near the delay period
  decay1   — full feedback rings, then falls, and never grows
  decay0   — zero feedback is gone well before the full-feedback tail
  metal    — size 0 comb still has a bright repeating tone after a second
  ring0..7 — every room model at size 0, damp 0, fbk 1 is audible at 8 s
             and 10 s, strictly decaying, and matched to the other models
  ringxf   — the same tail survives unequal delays with crossfeed at 25%
  decay50  — 50% feedback is a short delay: audible around 250 ms, silent by 1 s
  half0..7 — the same 50% tail on every room model
  fbk25/75/90 — the delay-style curve at the other knob positions
  damp0/damp1 — full feedback stays bright at damp 0 and goes dark at damp 1
"""

import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "tinyspace_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "tinyspace_probe.js")
HARNESS = os.path.join(ROOT, "tests", "tinyspace_harness.maxpat")
RESULT = "/tmp/tinyspace_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
MAX_LOG = os.path.expanduser(
    "~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log"
)

# Shared tail of every param list. Knobs that a case cares about come first.
QUIET = "predly 0, modamt 0, xfeed 0, hp 20, lp 18000, duck 1"


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
        # Leave time for record~ to flush into the buffer before the probe peeks it.
        # A heavy gen patch can still be rendering the start of a short take otherwise.
        box("obj-del-peak", "delay 300", 40, 320, 70, 20, numinlets=2, numoutlets=1),
        box("obj-del-analyze", "delay 400", 40, 360, 80, 20, numinlets=2, numoutlets=1),
        box("obj-analyze", f"analyze {case['dur']}", 120, 360, 90, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-quit", "; max quit", 40, 420, 70, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-params", case["params"], 200, 40, 680, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-setbuf", "setbuffer #0-tsconfig #0-tsmeters", 200, 70, 220, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-cfg", "buffer~ #0-tsconfig @samps 128", 520, 100, 210, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-meters", "buffer~ #0-tsmeters @samps 32", 520, 130, 210, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 14000 2", 520, 160, 150, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
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
            f"js {PROBE_JS} {mode} {case['config']}",
            200, 470, 420, 20,
            numinlets=4,
            numoutlets=3,
            outlettype=["bang", "bang", ""],
        ),
    ]
    if case["bind"]:
        boxes.append(box(
            "obj-bind",
            "cfg #0-tsconfig, meters #0-tsmeters",
            200, 100, 340, 20,
            maxclass="message",
            numinlets=2,
            numoutlets=1,
        ))

    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-setbuf", 0),
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
    if case["bind"]:
        lines.append(line("obj-load", 0, "obj-bind", 0))
        lines.append(line("obj-bind", 0, "obj-gen", 0))

    # Stimulus. Impulse clicks are armed after DSP is already running.
    if mode == "sine":
        boxes.append(box("obj-tone", "cycle~ 220", 700, 200, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-gain", "*~ 0.25", 700, 240, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        lines.extend([
            line("obj-tone", 0, "obj-gain", 0),
            line("obj-gain", 0, "obj-gen", 0),
            line("obj-gain", 0, "obj-gen", 1),
            line("obj-gain", 0, "obj-peak-c", 0),
        ])
    elif mode == "burst":
        boxes.append(box("obj-tone", "cycle~ 220", 700, 180, 80, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-gain", "*~ 0.25", 700, 220, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-env", "*~", 700, 260, 40, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-line", "line~", 780, 260, 45, 20, numinlets=1, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-burst", "1, 0 150", 780, 220, 70, 20, maxclass="message", numinlets=2, numoutlets=1))
        lines.extend([
            line("obj-tone", 0, "obj-gain", 0),
            line("obj-gain", 0, "obj-env", 0),
            line("obj-line", 0, "obj-env", 1),
            line("obj-env", 0, "obj-gen", 0),
            line("obj-env", 0, "obj-gen", 1),
            line("obj-env", 0, "obj-peak-c", 0),
            line("obj-del-arm", 0, "obj-burst", 0),
            line("obj-burst", 0, "obj-line", 0),
        ])
    else:
        boxes.append(box("obj-click", "click~", 700, 200, 50, 20, numinlets=1, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-gain", "*~ 0.25", 700, 240, 60, 20, numinlets=2, numoutlets=1, outlettype=["signal"]))
        boxes.append(box("obj-del-click", "delay 40", 700, 160, 70, 20, numinlets=2, numoutlets=1))
        lines.extend([
            line("obj-click", 0, "obj-gain", 0),
            line("obj-gain", 0, "obj-gen", 0),
            line("obj-gain", 0, "obj-gen", 1),
            line("obj-gain", 0, "obj-peak-c", 0),
            line("obj-del-arm", 0, "obj-del-click", 0),
            line("obj-del-click", 0, "obj-click", 0),
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
        return extra + ", " + QUIET

    return (
        {
            "name": "unbound",
            "mode": "sine",
            "config": "width",
            "bind": False,
            "arm": 400,
            "dur": 250,
            "params": params("size 0.55, damp 0.2, width 1, wet 1, fbk 0.62"),
        },
        {
            "name": "dry",
            "mode": "sine",
            "config": "single",
            "bind": True,
            "arm": 400,
            "dur": 250,
            "params": params("size 0.55, damp 0.2, width 1, wet 0, fbk 0.62"),
        },
        {
            "name": "wet",
            "mode": "sine",
            "config": "width",
            "bind": True,
            "arm": 400,
            "dur": 350,
            "params": params("size 0.55, damp 0.15, width 1, wet 1, fbk 0.55"),
        },
        {
            "name": "width0",
            "mode": "sine",
            "config": "width",
            "bind": True,
            "arm": 400,
            "dur": 350,
            "params": params("size 0.55, damp 0.15, width 0, wet 1, fbk 0.55"),
        },
        {
            "name": "size0",
            "mode": "impulse",
            "config": "single",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 0, width 0, wet 1, fbk 0"),
        },
        {
            "name": "size1",
            "mode": "impulse",
            "config": "single",
            "bind": True,
            "arm": 250,
            "dur": 1200,
            "params": params("size 1, damp 0, width 0, wet 1, fbk 0"),
        },
        {
            "name": "room",
            "mode": "impulse",
            "config": "room",
            "bind": True,
            "arm": 200,
            "dur": 600,
            "params": params("size 0.55, damp 0.15, width 0.7, wet 1, fbk 0.72, xfeed 0.25"),
        },
        {
            "name": "comb",
            "mode": "impulse",
            "config": "comb",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0.8, damp 0, width 0, wet 1, fbk 0.7"),
        },
        {
            "name": "decay1",
            "mode": "burst",
            "config": "decay",
            "bind": True,
            "arm": 200,
            "dur": 11000,
            "params": params("size 0.5, damp 0, width 0, wet 1, fbk 1"),
        },
        {
            "name": "decay0",
            "mode": "burst",
            "config": "decay",
            "bind": True,
            "arm": 200,
            "dur": 800,
            "params": params("size 0.5, damp 0, width 0, wet 1, fbk 0"),
        },
        {
            "name": "metal",
            "mode": "impulse",
            "config": "comb",
            "bind": True,
            "arm": 200,
            "dur": 1600,
            "params": params("size 0, damp 0, width 0, wet 1, fbk 1"),
        },
        {
            "name": "damp0",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 1"),
        },
        {
            "name": "damp1",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 1, width 1, wet 1, fbk 1"),
        },
    ) + tuple(
        {
            "name": f"ring{model}",
            "mode": "impulse",
            "config": f"ring{model}",
            "bind": True,
            "arm": 200,
            "dur": 11000,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 1"),
        }
        for model in range(8)
    ) + (
        {
            "name": "ringxf",
            "mode": "impulse",
            "config": "ringxf",
            "bind": True,
            "arm": 200,
            "dur": 11000,
            # xfeed is last so it overrides QUIET's xfeed 0.
            "params": params("size 0, damp 0, width 1, wet 1, fbk 1") + ", xfeed 0.25",
        },
        {
            "name": "decay50",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1600,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.5"),
        },
        {
            "name": "fbk25",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.25"),
        },
        {
            "name": "fbk75",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 4500,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.75"),
        },
        {
            "name": "fbk90",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 8000,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.9"),
        },
    ) + tuple(
        {
            "name": f"half{model}",
            "mode": "impulse",
            "config": f"ring{model}",
            "bind": True,
            "arm": 200,
            "dur": 1600,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.5"),
        }
        for model in range(8)
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
        if raw.startswith("sec "):
            meta["sec"] = [float(x) for x in raw[4:].split()] if raw.strip() != "sec" else []
            continue
        parts = raw.split(None, 1)
        if len(parts) != 2:
            continue
        key, val = parts
        try:
            meta[key] = float(val)
        except ValueError:
            continue
    meta["env"] = env
    return meta


def env_max(env, start, end):
    chunk = env[start:end]
    return max(chunk) if chunk else 0.0


def first_peak(env, start, end, floor):
    for i in range(start, min(end, len(env))):
        if env[i] >= floor:
            return i
    return -1


def clear_recovery():
    recovery = os.path.expanduser(
        "~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"
    )
    shutil.rmtree(recovery, ignore_errors=True)


def run_case(gen_code, case, retried=False):
    # A previous Max can reopen Crash Recovery on top of the harness and
    # measure silence. Kill a leftover harness, then delete that folder.
    subprocess.run(
        ["pkill", "-f", "tinyspace_harness.maxpat"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(20):
        still = subprocess.run(
            ["pgrep", "-f", "tinyspace_harness.maxpat"],
            stdout=subprocess.DEVNULL,
        )
        if still.returncode != 0:
            break
        time.sleep(0.25)
    time.sleep(0.3)
    clear_recovery()
    build_harness(gen_code, case)
    if os.path.exists(RESULT):
        os.remove(RESULT)
    log_size = os.path.getsize(MAX_LOG) if os.path.exists(MAX_LOG) else 0
    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + max(45, case["dur"] / 1000.0 + 35)
    while time.time() < deadline and not os.path.exists(RESULT):
        if proc.poll() is not None:
            break
        time.sleep(0.25)
    # The probe creates the file before the write finishes. Wait until the
    # size stops changing so a long envelope is not read halfway through.
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
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
    time.sleep(0.4)
    print(f"--- {case['name']} ---")
    if not os.path.exists(RESULT):
        print("NO RESULT FILE")
        dump_log(log_size)
        return None
    text = open(RESULT).read()
    meta = parse_result(text)
    env = meta.get("env", [])
    preview = " ".join(f"{v:.4f}" for v in env[:80])
    print(
        f"genL {meta.get('genL')} genR {meta.get('genR')} ctl {meta.get('ctl')} "
        f"peak {meta.get('peak')} corr {meta.get('corr')} meter {meta.get('meter')} nan {meta.get('nan')} "
        f"sr {meta.get('sr')} bins {len(env)}"
    )
    print(f"env {preview}")
    dump_log(log_size)
    # Max sometimes opens before the driver is up, so the click never lands
    # and the take is silent. One fresh launch is enough. A full-wet test
    # with an unbound buffer is supposed to be silent, so that case is not retried.
    ctl = meta.get("ctl", 0)
    heard = max(env) if env else 0.0
    expects_audio = case["mode"] in ("impulse", "burst")
    if not retried and (ctl < 0.05 or (expects_audio and heard < 1e-4)):
        print(f"{case['name']}: silent take, retrying once")
        return run_case(gen_code, case, retried=True)
    return meta


def dump_log(log_size):
    if not os.path.exists(MAX_LOG):
        return
    log = open(MAX_LOG, errors="replace").read()
    new = log[log_size:] if log_size < len(log) else log[-8000:]
    interesting = [
        line for line in new.splitlines()
        if any(k in line for k in ("error", "failed", "PROBE_"))
    ]
    if interesting:
        print("--- max log ---")
        print("\n".join(interesting[-30:]))


def require_ctl(name, meta, errors):
    ctl = meta.get("ctl", 0)
    if not (0.2 <= ctl <= 0.3):
        errors.append(f"{name}: control peak {ctl} (expected the 0.25 tone)")


def require_finite(name, meta, errors):
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    if meta.get("peak", 99) > 1.5:
        errors.append(f"{name}: peak {meta.get('peak')} is too hot")


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    require_ctl(name, meta, errors)
    require_finite(name, meta, errors)
    env = meta.get("env", [])
    if name == "unbound":
        if meta.get("genL", 1) > 0.005 or meta.get("genR", 1) > 0.005 or env_max(env, 0, 250) > 0.005:
            errors.append(f"{name}: full wet should be silent when the buffer is unbound ({meta.get('genL')}, {meta.get('genR')})")
    elif name == "dry":
        if not (0.2 <= meta.get("genL", 0) <= 0.3 and 0.2 <= meta.get("genR", 0) <= 0.3):
            errors.append(f"{name}: dry output should match the tone ({meta.get('genL')}, {meta.get('genR')})")
    elif name == "wet":
        if meta.get("genL", 0) < 0.02 or meta.get("genR", 0) < 0.02:
            errors.append(f"{name}: full wet is silent ({meta.get('genL')}, {meta.get('genR')})")
        if meta.get("corr", 1) > 0.92:
            errors.append(f"{name}: left and right are too similar for width 100% (corr {meta.get('corr')})")
        meter = meta.get("meter", -1)
        if not (0.02 < meter < 1.2):
            errors.append(f"{name}: delay meters are not tracking the audio ({meter})")
    elif name == "width0":
        if meta.get("genL", 0) < 0.02:
            errors.append(f"{name}: mono wet is silent")
        if meta.get("corr", 0) < 0.98:
            errors.append(f"{name}: width 0 should sum to mono (corr {meta.get('corr')})")
    elif name in ("size0", "size1"):
        first = first_peak(env, 0, 120, 0.05)
        meta["first"] = first
        print(f"{name} first peak {first} ms")
        if first < 0:
            errors.append(f"{name}: no delayed impulse")
    elif name == "room":
        early = env_max(env, 0, 40)
        tail = env_max(env, 80, 300)
        smear = sum(1 for v in env[:300] if v > 0.004)
        print(f"room early {early:.4f} tail {tail:.4f} bins {smear}")
        # A single-sample impulse is split across the active lines, so the
        # tail sits well below the 0.25 click and still far above silence.
        if early < 0.004:
            errors.append(f"{name}: no early delay energy ({early})")
        if tail < 0.0015:
            errors.append(f"{name}: tail is missing ({tail})")
        if smear < 12:
            errors.append(f"{name}: tail is a single spike, not a reverb ({smear} bins)")
    elif name == "comb":
        first = first_peak(env, 0, 40, 0.04)
        if first < 0:
            errors.append(f"{name}: no comb impulse")
        else:
            echo = env_max(env, first + 12, first + 24)
            gap = env_max(env, first + 4, first + 10)
            print(f"comb first {first} ms echo {echo:.4f} gap {gap:.4f}")
            if echo < 0.02 or echo < gap * 2:
                errors.append(f"{name}: no repeating delay (echo {echo}, gap {gap})")
    elif name == "decay1":
        burst = env_max(env, 0, 160)
        w2 = env_max(env, 1800, 2200)
        w6 = env_max(env, 5800, 6200)
        w10 = env_max(env, 9800, 10400)
        sec = meta.get("sec") or []
        w2 = sec[2] if len(sec) > 2 else w2
        w6 = sec[6] if len(sec) > 6 else w6
        w10 = sec[10] if len(sec) > 10 else w10
        print("decay1 per second " + " ".join(f"{v:.4f}" for v in sec))
        print(f"decay1 burst {burst:.4f} w2 {w2:.4f} w6 {w6:.4f} w10 {w10:.4f}")
        if burst < 0.02:
            errors.append(f"{name}: burst did not reach the tank ({burst})")
        if w2 < 0.03:
            errors.append(f"{name}: tail died before 2 s ({w2})")
        if w10 < 0.004:
            errors.append(f"{name}: tail is gone before 10 s ({w10})")
        if not (w2 > w6 > w10):
            errors.append(f"{name}: tail is not falling ({w2}, {w6}, {w10})")
        if max(w2, w6, w10) > burst * 1.15:
            errors.append(f"{name}: feedback grew after the burst")
        meta["w10"] = w10
    elif name == "decay0":
        burst = env_max(env, 0, 160)
        late = env_max(env, 250, 400)
        print(f"decay0 burst {burst:.4f} late {late:.4f}")
        if burst < 0.02:
            errors.append(f"{name}: burst did not reach the tank ({burst})")
        if late > 0.001:
            errors.append(f"{name}: zero feedback is still ringing ({late})")
    elif name == "metal":
        first = first_peak(env, 0, 40, 0.04)
        late = env_max(env, 1000, 1400)
        print(f"metal first {first} ms late {late:.4f}")
        if first < 0:
            errors.append(f"{name}: no comb impulse")
        elif late < env[first] * 0.45:
            errors.append(f"{name}: short comb died before 1 s ({late} vs {env[first]})")
    elif name == "damp0" or name == "damp1":
        early = env_max(env, 0, 40)
        late = env_max(env, 200, 700)
        meta["early"] = early
        meta["late"] = late
        print(f"{name} early {early:.4f} late {late:.4f}")
        if early < 0.004:
            errors.append(f"{name}: impulse did not reach the tank ({early})")
        if name == "damp0" and late < 0.04:
            errors.append(f"{name}: undamped tail died early ({late})")
        if name == "damp1" and late > 0.01:
            errors.append(f"{name}: full damp is still bright at 200 ms ({late})")
        if max(early, late) > 1.5:
            errors.append(f"{name}: damping went unstable ({max(early, late)})")
    elif name.startswith("ring"):
        burst = env_max(env, 0, 160)
        sec = meta.get("sec") or []
        w2 = sec[2] if len(sec) > 2 else 0.0
        w5 = sec[5] if len(sec) > 5 else 0.0
        w8 = sec[8] if len(sec) > 8 else 0.0
        w10 = sec[10] if len(sec) > 10 else 0.0
        meta["burst"] = burst
        meta["w2"] = w2
        meta["w5"] = w5
        meta["w8"] = w8
        meta["w10"] = w10
        print(" ".join(f"{v:.4f}" for v in sec))
        print(f"{name} burst {burst:.4f} w2 {w2:.4f} w5 {w5:.4f} w8 {w8:.4f} w10 {w10:.4f}")
        # ~27.5 s RT60 keeps about 13% at 8 s. The click peak is ~0.10,
        # so the absolute floors sit under that and above silence.
        if burst < 0.02:
            errors.append(f"{name}: impulse did not reach the tank ({burst})")
        if w8 <= 0.006:
            errors.append(f"{name}: tail is weak at 8 s ({w8})")
        if w10 <= 0.003:
            errors.append(f"{name}: tail is weak at 10 s ({w10})")
        if not (burst > w2 > w5 > w8):
            errors.append(f"{name}: tail is not strictly falling ({burst}, {w2}, {w5}, {w8})")
        if max(w2, w5, w8) > burst:
            errors.append(f"{name}: feedback grew after the impulse")
        if name != "ringxf" and not (w8 > w10):
            errors.append(f"{name}: tail rose between 8 s and 10 s ({w8}, {w10})")
    elif name == "decay50" or name.startswith("half"):
        burst = env_max(env, 0, 80)
        early = env_max(env, 180, 320)
        late = env_max(env, 1000, 1250)
        meta["burst"] = burst
        meta["early"] = early
        meta["late"] = late
        print(f"{name} burst {burst:.4f} early {early:.4f} late {late:.4f}")
        if burst < 0.02:
            errors.append(f"{name}: impulse did not reach the tank ({burst})")
        if early < 0.004:
            errors.append(f"{name}: 50% feedback has no tail at 250 ms ({early})")
        if late >= 0.002:
            errors.append(f"{name}: 50% feedback is still ringing at 1 s ({late})")
        if not (burst > early > late):
            errors.append(f"{name}: 50% tail is not falling ({burst}, {early}, {late})")
    elif name == "fbk25":
        burst = env_max(env, 0, 40)
        early = env_max(env, 40, 120)
        late = env_max(env, 400, 700)
        print(f"fbk25 burst {burst:.4f} early {early:.4f} late {late:.4f}")
        if early < 0.002:
            errors.append(f"{name}: 25% feedback died before 100 ms ({early})")
        if late >= 0.002:
            errors.append(f"{name}: 25% feedback is still ringing at 0.5 s ({late})")
    elif name == "fbk75":
        burst = env_max(env, 0, 80)
        mid = env_max(env, 800, 1200)
        late = env_max(env, 3500, 4200)
        print(f"fbk75 burst {burst:.4f} mid {mid:.4f} late {late:.4f}")
        if mid < 0.003:
            errors.append(f"{name}: 75% feedback is already gone at 1 s ({mid})")
        if late >= 0.002:
            errors.append(f"{name}: 75% feedback is still ringing at 3.5 s ({late})")
        if not (burst > mid > late):
            errors.append(f"{name}: 75% tail is not falling ({burst}, {mid}, {late})")
    elif name == "fbk90":
        sec = meta.get("sec") or []
        burst = env_max(env, 0, 80)
        w2 = sec[2] if len(sec) > 2 else 0.0
        w4 = sec[4] if len(sec) > 4 else 0.0
        w7 = sec[7] if len(sec) > 7 else 0.0
        print("fbk90 per second " + " ".join(f"{v:.4f}" for v in sec))
        print(f"fbk90 burst {burst:.4f} w2 {w2:.4f} w4 {w4:.4f} w7 {w7:.4f}")
        if w2 < 0.008:
            errors.append(f"{name}: 90% feedback is quiet at 2 s ({w2})")
        if w7 >= 0.002:
            errors.append(f"{name}: 90% feedback is still loud at 7 s ({w7})")
        if not (burst > w2 > w4 > w7):
            errors.append(f"{name}: 90% tail is not falling ({burst}, {w2}, {w4}, {w7})")


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
    high = results.get("decay1") or {}
    low = results.get("decay0") or {}
    if high and low and high.get("w10", 0) < 0.004:
        errors.append("full feedback died as fast as zero feedback")
    small = results.get("size0") or {}
    large = results.get("size1") or {}
    ring_levels = []
    for model in range(8):
        meta = results.get(f"ring{model}") or {}
        if "w8" in meta:
            ring_levels.append((model, meta["w8"]))
    if len(ring_levels) == 8:
        vals = [level for _model, level in ring_levels]
        lo = min(vals)
        hi = max(vals)
        print(
            "ring8s "
            + " ".join(f"m{model}:{level:.4f}" for model, level in ring_levels)
            + f"  range {lo:.4f}..{hi:.4f}"
        )
        if lo <= 0 or hi / lo > 1.25:
            errors.append(f"room models do not share an 8 s level ({lo} .. {hi})")
    half_levels = []
    for model in range(8):
        meta = results.get(f"half{model}") or {}
        if "early" in meta:
            half_levels.append((model, meta["early"]))
    if len(half_levels) == 8:
        vals = [level for _model, level in half_levels]
        lo = min(vals)
        hi = max(vals)
        print(
            "half250ms "
            + " ".join(f"m{model}:{level:.4f}" for model, level in half_levels)
            + f"  range {lo:.4f}..{hi:.4f}"
        )
        if lo <= 0 or hi / lo > 1.35:
            errors.append(f"room models do not share a 50% tail ({lo} .. {hi})")
    bright = results.get("damp0") or {}
    dark = results.get("damp1") or {}
    if "late" in bright and "late" in dark:
        print(f"damp late bright {bright['late']:.4f} dark {dark['late']:.4f}")
        if not (dark["late"] < bright["late"] * 0.25):
            errors.append(
                f"damp did not darken the tail ({dark['late']} vs {bright['late']})"
            )
    if small.get("first", -1) >= 0 and large.get("first", -1) >= 0:
        extra = large["first"] - small["first"]
        print(f"size delay {small['first']} ms -> {large['first']} ms")
        if extra < 20:
            errors.append(f"Size did not lengthen the delay ({small['first']} ms vs {large['first']} ms)")
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
