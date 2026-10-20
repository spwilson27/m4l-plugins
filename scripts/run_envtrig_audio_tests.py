#!/usr/bin/env python3
"""Render Envelope Trigger through Ableton-bundled Max and verify its detector & scope telemetry.

Cases:
  hits      — Five 0.8 tone bursts 200 ms apart (Thr -24 dB) fire exactly five notes with high
              velocity and pass the audio through unchanged
  scope     — 0.8 bursts every 100 ms fill the oscilloscope ring with ~0.8 min/max blocks and onset flags
  quiet     — The same bursts at 0.03 (-30 dB, below Thr) fire nothing
  velocity  — Bursts at 0.2 (-14 dB) fire five notes with mid-range velocity (Vel Lo 40 .. Vel Hi 127)
  sustain   — A steady 0.5 tone fires one note at its onset and never retriggers
  hold      — Bursts every 40 ms with Hold = 200 ms are thinned to a few notes, not one per burst
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "envtrig_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "envtrig_probe.js")
HARNESS = os.path.join(ROOT, "tests", "envtrig_harness.maxpat")
RESULT = "/tmp/envtrig_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)

# kind 0 = burst train (first, every), 1 = sustained tone from `first`.
# Bursts rise over `atk` ms and fall 60 dB over `decay` ms.
SOURCE_GEN = """
burst_env(dt, atk, decay) {
	rise = (atk > 0.001) ? clip(dt / atk, 0, 1) : 1;
	fall = exp(-max(dt - atk, 0) * 6.9078 / max(decay, 1));
	return (dt < 0) ? 0 : rise * fall;
}

Param go(0);
Param kind(0);
Param amp(0.8);
Param freq(1000);
Param first(40);
Param every(200);
Param atk(0);
Param decay(80);

History n(0);
History ph(0);

n = (go > 0.5) ? n + 1 : 0;
tms = n * 1000 / samplerate;
ph = wrap(ph + freq / samplerate, 0, 1);
tone = sin(6.28318531 * ph);
local = tms - first;
dtTrain = local - floor(max(local, 0) / max(every, 1)) * max(every, 1);
train = burst_env((local < 0) ? -1 : dtTrain, atk, decay);
sus = clip(local / 2, 0, 1);
sig = (kind < 0.5) ? tone * train : tone * sus;
out1 = (go > 0.5) ? sig * amp : 0;
"""

DEFAULTS = "thr -24, sens 0.5, holdms 60, velmin 40, velmax 127"


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


def msg(obj_id, text, x, y, w=80):
    return box(obj_id, text, x, y, w, 20, maxclass="message", numinlets=2, numoutlets=1)


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def build_harness(gen_code, case):
    dur = case["dur"]
    buf_ms = 4000  # sized in 44.1 kHz frames; DSP may run at a higher rate
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 1200", 40, 80, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 120),
        box("obj-del-arm", f"delay {case['arm']}", 40, 160, 80, 20, numinlets=2),
        msg("obj-rec-on", "1", 40, 200, 30),
        box("obj-del-stop", f"delay {dur}", 40, 240, 80, 20, numinlets=2),
        msg("obj-rec-off", "0", 40, 280, 30),
        box("obj-del-peak", "delay 40", 40, 320, 70, 20, numinlets=2),
        box("obj-del-analyze", "delay 80", 40, 360, 70, 20, numinlets=2),
        msg("obj-analyze", f"analyze {dur}", 120, 360, 90),
        msg("obj-quit", "; max quit", 40, 420, 70),
        msg("obj-params", case["params"], 200, 40, 680),
        msg("obj-setbuf", "setbuffer #0-trigscope", 200, 70, 190),
        msg("obj-bind", "scope #0-trigscope", 200, 100, 180),
        box("obj-scope", "buffer~ #0-trigscope @samps 800", 520, 100, 210, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", f"buffer~ rec {buf_ms} 2", 520, 130, 150, 20, numoutlets=2, outlettype=["float", "bang"]),
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 4,
                "outlettype": ["signal"] * 4,
                "patching_rect": [200.0, 220.0, 300.0, 80.0],
            }
        },
        box("obj-record", "record~ rec 2", 200, 360, 90, 20, numinlets=4, outlettype=[""]),
        # rec ch1 = gate * velocity; ch2 = audio out L
        box("obj-gv0", "*~", 200, 300, 40, 20, numinlets=2, outlettype=["signal"]),
        box("obj-peak-l", "peakamp~", 200, 400, 70, 20, outlettype=["float"]),
        box("obj-peak-c", "peakamp~", 290, 400, 70, 20, outlettype=["float"]),
        box("obj-dspstate", "dspstate~", 640, 40, 70, 20, numinlets=1, numoutlets=4, outlettype=["int", "float", "int", "int"]),
        box("obj-prep-sr", "prepend dspsr", 640, 70, 90, 20),
        box("obj-mute-l", "*~ 0", 200, 400, 45, 20, numinlets=2, outlettype=["signal"]),
        box("obj-dac", "dac~", 200, 440, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box("obj-js", f"js {PROBE_JS} {case['name']}", 200, 480, 420, 20, numinlets=4, numoutlets=3, outlettype=["bang", "bang", ""]),
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
        line("obj-del-peak", 0, "obj-peak-c", 0),
        line("obj-del-peak", 0, "obj-del-analyze", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-analyze", 0, "obj-js", 3),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-gen", 2, "obj-gv0", 0),
        line("obj-gen", 3, "obj-gv0", 1),
        line("obj-gv0", 0, "obj-record", 0),
        line("obj-gen", 0, "obj-record", 1),
        line("obj-gen", 0, "obj-peak-l", 0),
        line("obj-gen", 0, "obj-mute-l", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-peak-l", 0, "obj-js", 0),
        line("obj-peak-c", 0, "obj-js", 1),
        line("obj-dspstate", 1, "obj-prep-sr", 0),
        line("obj-prep-sr", 0, "obj-js", 3),
    ]

    # Test signals are generated at audio rate (not by metro): Max may render faster than
    # real time, so only sample-counted timing lines up with the recording.
    boxes.extend([
        {
            "box": {
                "code": SOURCE_GEN,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-src",
                "maxclass": "gen.codebox~",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [700.0, 220.0, 300.0, 80.0],
            }
        },
        msg("obj-src-params", case["source"], 700, 160, 380),
        msg("obj-src-go", "go 1", 700, 190, 40),
    ])
    lines.extend([
        line("obj-load", 0, "obj-src-params", 0),
        line("obj-src-params", 0, "obj-src", 0),
        line("obj-del-arm", 0, "obj-src-go", 0),
        line("obj-src-go", 0, "obj-src", 0),
        line("obj-src", 0, "obj-gen", 0),
        line("obj-src", 0, "obj-gen", 1),
        line("obj-src", 0, "obj-peak-c", 0),
    ])

    doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 40.0, 1100.0, 600.0],
            "boxes": boxes,
            "lines": lines,
        }
    }
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def cases():
    def params(extra=""):
        return DEFAULTS + (", " + extra if extra else "")

    return (
        {"name": "hits", "arm": 250, "dur": 1000, "params": params(),
         "source": "kind 0, amp 0.8, freq 1000, first 40, every 200, atk 0, decay 80"},
        {"name": "scope", "arm": 250, "dur": 600, "params": params(),
         "source": "kind 0, amp 0.8, freq 1000, first 40, every 100, atk 0, decay 60"},
        {"name": "quiet", "arm": 250, "dur": 1000, "params": params(),
         "source": "kind 0, amp 0.03, freq 1000, first 40, every 200, atk 0, decay 80"},
        {"name": "velocity", "arm": 250, "dur": 1000, "params": params(),
         "source": "kind 0, amp 0.2, freq 1000, first 40, every 200, atk 0, decay 80"},
        {"name": "sustain", "arm": 250, "dur": 900, "params": params(),
         "source": "kind 1, amp 0.5, freq 220, first 50"},
        {"name": "hold", "arm": 250, "dur": 1000, "params": params("holdms 200"),
         "source": "kind 0, amp 0.8, freq 1000, first 40, every 40, atk 0, decay 30"},
    )


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        parts = raw.split()
        if not parts:
            continue
        key = parts[0]
        if key.startswith("lane"):
            meta[key] = [(int(p.split("@")[0]), int(p.split("@")[1])) for p in parts[1:]]
        else:
            meta[key] = float(parts[1])
    return meta


def run_case(gen_code, case):
    build_harness(gen_code, case)
    if os.path.exists(RESULT):
        os.remove(RESULT)
    recovery = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Crash Recovery")
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
        f"notes {meta.get('lane0')} ringMax {meta.get('ringMax', 0):.3f} ringOnsets {meta.get('ringOnsets')} "
        f"genL {meta.get('genL'):.4f} ctl {meta.get('ctl'):.4f} scopeFires0 {meta.get('scopeFires0')} nan {meta.get('nan')}"
    )
    return meta


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    l0 = meta.get("lane0", [])
    vels0 = [v for v, _t in l0]
    if name == "hits":
        if len(l0) != 5:
            errors.append(f"hits: expected 5 notes on lane 0, got {len(l0)} {l0}")
        if vels0 and min(vels0) < 105:
            errors.append(f"hits: 0.8 bursts should fire high velocity (~120), got {vels0}")
        if abs(meta.get("genL", 0) - meta.get("ctl", -1)) > 1e-3:
            errors.append(f"hits: audio must pass through unchanged (out {meta.get('genL')} vs in {meta.get('ctl')})")
        if meta.get("scopeFires0", 0) < 5:
            errors.append(f"hits: scope fire counter should reach 5, got {meta.get('scopeFires0')}")

    elif name == "scope":
        # Bursts every 100 ms keep at least one onset inside the 186 ms ring whenever it is read
        # (the source keeps playing after recording stops).
        if not (0.6 <= meta.get("ringMax", 0) <= 0.85):
            errors.append(f"scope: oscilloscope ring should hold ~0.8 peaks, got {meta.get('ringMax')}")
        if meta.get("ringOnsets", 0) < 1:
            errors.append(f"scope: oscilloscope ring should flag onsets, got {meta.get('ringOnsets')}")
    elif name == "quiet":
        if l0:
            errors.append(f"quiet: bursts below threshold must not fire, got {l0}")
    elif name == "velocity":
        if len(l0) != 5:
            errors.append(f"velocity: expected 5 notes, got {len(l0)} {l0}")
        if vels0 and not all(60 <= v <= 95 for v in vels0):
            errors.append(f"velocity: -14 dB bursts should land mid-range (~76), got {vels0}")
    elif name == "sustain":
        if len(l0) != 1:
            errors.append(f"sustain: a steady tone must fire exactly once, got {l0}")
        elif not (40 <= l0[0][1] <= 70):
            errors.append(f"sustain: the onset note should fire near 50 ms, got {l0[0][1]} ms")
    elif name == "hold":
        if not (2 <= len(l0) <= 6):
            errors.append(f"hold: 200 ms lockout should thin ~24 bursts to 2..6 notes, got {len(l0)} {l0}")


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
    print("envtrig audio checks passed")


if __name__ == "__main__":
    main()
