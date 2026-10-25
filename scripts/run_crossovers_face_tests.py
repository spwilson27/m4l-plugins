#!/usr/bin/env python3
"""Click the painted Low / High handles of Harmonic Split inside Max.

The handles are drawn inset from the cutoff line so they stay inside the plot.
A click on the painted handle has to leave that cutoff within one 0.1 Hz step.
Run in the tart VM (AGENTS.md 1a): python3 scripts/run_crossovers_face_tests.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "crossovers_face_probe.js")

# harmsplit_ui.js plot and flag geometry (HS_PLOT, hsFreqX, hsFlagX, handle at top + 6.5).
FMIN = 30.0
FMAX = 20000.0
PLOT_X = 1.0
PLOT_Y = 1.0
PLOT_W = 278.0
VIZ_W = 280.0
STEP_HZ = 0.1


def freq_x(freq):
    if not (freq > FMIN):
        t = 0.0
    else:
        t = math.log(freq / FMIN) / math.log(FMAX / FMIN)
        t = 0.0 if t < 0.0 else (1.0 if t > 1.0 else t)
    return PLOT_X + t * PLOT_W


def flag_x(x):
    # Post toggle is 34 px wide at the right; the handle stays 6 px clear of it and 5 px inside the plot.
    lo = PLOT_X + 5.0
    hi = (VIZ_W - 34.0) - 6.0
    return lo if x < lo else hi if x > hi else x


def viz_box(amxd_name, box_id="obj-viz"):
    path = os.path.join(ROOT, "devices", amxd_name)
    import json
    with open(path, "rb") as f:
        patcher = json.loads(f.read()[32:].decode("utf-8"))["patcher"]
    for b in patcher["boxes"]:
        if b["box"].get("id") == box_id:
            return b
    raise SystemExit(f"{amxd_name} has no {box_id}")


def main():
    low_x = flag_x(freq_x(19.4))
    high_x = flag_x(freq_x(19900.0))
    hy = PLOT_Y + 6.5
    box = viz_box("Harmonic Split.amxd")
    lines = [mh.line("obj-viz", 0, "obj-js", 0)]
    res = mh.run_case(
        "harm_face_crossover", [box], lines, probe_js=PROBE, settle_ms=0, dur_ms=250,
        channels=1, mode="stepped",
        events=[
            (30, "obj-viz", 0, "set_lowcut 19.4"),
            (60, "obj-viz", 0, "set_highcut 19900"),
            (110, "obj-viz", 0, f"onclick {low_x:.4f} {hy:.4f}"),
            (170, "obj-viz", 0, f"onclick {high_x:.4f} {hy:.4f}"),
        ],
    )
    print(f"harm handles: lowcut {res.get('lowcut')} (painted x {low_x:.2f}) "
          f"highcut {res.get('highcut')} (painted x {high_x:.2f})")
    errors = []
    low = res.get("lowcut", "none")
    high = res.get("highcut", "none")
    if low != "none" and abs(float(low) - 19.4) > STEP_HZ:
        errors.append(f"Harmonic Split low handle click moved 19.4 Hz to {low} (painted x {low_x:.2f})")
    if high != "none" and abs(float(high) - 19900.0) > STEP_HZ:
        errors.append(f"Harmonic Split high handle click moved 19900 Hz to {high} (painted x {high_x:.2f})")
    # Freq Split header arrows: cells are drawn at x 0 / 28 / 56, each 27 px wide.
    # A click inside the painted middle cell must leave Insert on Mid (1).
    mid_x = 28.5
    top = viz_box("Freq Split.amxd", "obj-viz-top")
    top_res = mh.run_case(
        "freq_face_arrow", [top], [mh.line("obj-viz-top", 0, "obj-js", 0)],
        probe_js=PROBE, settle_ms=0, dur_ms=200, channels=1, mode="stepped",
        events=[
            (30, "obj-viz-top", 0, "set_dir 1"),
            (90, "obj-viz-top", 0, f"onclick {mid_x:.4f} 7"),
        ],
    )
    print(f"freq arrow: dir {top_res.get('dir')} (click x {mid_x})")
    direction = top_res.get("dir", "none")
    if direction != "none" and int(float(direction)) != 1:
        errors.append(f"Freq Split middle arrow click at x {mid_x} set Insert to {direction}, expected 1")
    if errors:
        print("crossovers face: FAIL")
        for e in errors:
            print(" ", e)
        return 1
    print("crossovers face: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
