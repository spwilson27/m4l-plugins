#!/usr/bin/env python3
"""Click the painted wavetable trace and the Envelope Trigger scope threshold inside Max.

The orange wavetable trace is the position. A click on its centre has to store that
position. The scope threshold is drawn on the same half-scale as the waveform
(plot height / 2 - 1); a click on the line has to leave that dB in place.
Run in the tart VM (AGENTS.md 1a): python3 scripts/run_sampler_face_tests.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "sampler_face_probe.js")


def wt_trace_y(pos01):
    """Centre y of the current frame in paintWtFrameStack, 4-frame Basic Shapes, 73 px view."""
    wy, wh = 17.0, 73.0
    y = wy + 5.0
    h = wh - 10.0
    amp = 5.5
    room = h - 8.0 - amp * 2.0
    apart = amp * 2.0 + 3.5
    gap = min(room / 3.0, apart)
    stack = gap * 3.0
    y_bot = y + h - 4.0 - amp
    return y_bot - pos01 * stack


def scope_line_y(db):
    """Lower painted scope threshold at the Envelope Trigger viz's 192 x 104 bounds."""
    y0, ph = 15.0, 86.0
    lin = 10.0 ** (db / 20.0)
    return y0 + ph / 2.0 + lin * (ph / 2.0 - 1.0)


def viz_box(amxd_name):
    path = os.path.join(ROOT, "devices", amxd_name)
    with open(path, "rb") as f:
        patcher = json.loads(f.read()[32:].decode("utf-8"))["patcher"]
    for b in patcher["boxes"]:
        if b["box"].get("id") == "obj-viz":
            return b
    raise SystemExit(f"{amxd_name} has no obj-viz")


def run(name, amxd, events):
    box = viz_box(amxd)
    lines = [mh.line("obj-viz", 0, "obj-js", 0)]
    res = mh.run_case(
        name, [box], lines, probe_js=PROBE, settle_ms=0, dur_ms=400,
        channels=1, mode="stepped", events=events,
    )
    print(f"{name}: play_pos {res.get('play_pos')} thr {res.get('thr')}")
    return res


def main():
    y0 = wt_trace_y(0.0)
    y1 = wt_trace_y(1.0)
    x = 366.0
    sampler = run("sampler_wt_trace", "Better Sampler Reactive 2.amxd", [
        (40, "obj-viz", 0, "set_osc1_type 1"),
        (80, "obj-viz", 0, "set_play_pos 0"),
        (140, "obj-viz", 0, "paint"),
        (200, "obj-viz", 0, f"onclick {x:.1f} {y0:.4f} 1"),
        (280, "obj-viz", 0, f"onclick {x:.1f} {y1:.4f} 1"),
    ])
    sy = scope_line_y(-24.0)
    env = run("envtrig_scope_line", "Envelope Trigger.amxd", [
        (40, "obj-viz", 0, "set_view 1"),
        (80, "obj-viz", 0, "set_thr -24"),
        (160, "obj-viz", 0, f"onclick 40 {sy:.4f}"),
    ])
    errors = []
    raw = str(sampler.get("play_pos", "none"))
    vals = [] if raw in ("none", "None", "") else [float(v) for v in raw.split(",")]
    if not vals or abs(vals[-1] - 100.0) > 0.5 or any(abs(v) > 0.5 and abs(v - 100.0) > 0.5 for v in vals):
        errors.append(
            f"wavetable trace click wrote play_pos {raw} "
            f"(bottom y {y0:.2f} must stay 0, top y {y1:.2f} must be 100)"
        )
    got = float(env.get("thr", -999))
    if abs(got + 24.0) > 0.05:
        errors.append(f"scope threshold click moved -24 to {got} (y {sy:.2f})")
    if errors:
        print("sampler face: FAIL")
        for e in errors:
            print(" ", e)
        return 1
    print("sampler face: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
