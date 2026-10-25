#!/usr/bin/env python3
"""Click the drawn gate / ceiling / wave-pill controls of the built faces inside Max.

The lines are painted with the amplitude curve. A click on the painted line has to
leave that value in place, and the bottom edge of Percipitator's wave pill is Wave 0.
Run in the tart VM (AGENTS.md 1a): python3 scripts/run_face_drag_tests.py
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "face_drag_probe.js")


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def db_to_lin(db):
    return 10.0 ** (db / 20.0)


def percip_gate_y(db):
    # layoutRegions() at the face's 204 x 134 canvas, then the painted gate line.
    h = 134.0
    spec_y = 20.0
    spec_h = (h - 22.0 - 4.0) - spec_y - 4.0
    lin = db_to_lin(db)
    if lin <= 0.0001:
        vis = 0.0
    else:
        dbv = 20.0 * math.log10(min(lin, 1.5))
        db01 = clamp((dbv + 60.0) / 60.0, 0.0, 1.0)
        vis = 0.65 * db01 + 0.35 * clamp(math.sqrt(lin), 0.0, 1.0)
    return spec_y + spec_h - vis * (spec_h - 4.0)


def recip_line_y(db):
    # plotBounds() at the 162 x 132 canvas, then ampToVisual01.
    plot_y = 18.0
    plot_h = 132.0 - plot_y - 6.0
    lin = min(db_to_lin(db), 1.0)
    if lin <= 0.0001:
        vis = 0.0
    else:
        dbv = 20.0 * math.log10(lin)
        db01 = clamp((dbv + 66.0) / 66.0, 0.0, 1.0)
        lin01 = clamp(math.sqrt(lin), 0.0, 1.0)
        vis = 0.62 * db01 + 0.38 * lin01
    return plot_y + plot_h - vis * plot_h


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
        name, [box], lines, probe_js=PROBE, settle_ms=0, dur_ms=250,
        channels=1, mode="stepped", events=events,
    )
    print(f"{name}: gate {res.get('gate')} ceiling {res.get('ceiling')} "
          f"wtpos {res.get('wtpos')} warp {res.get('warp')}")
    return res


def main():
    gy = percip_gate_y(-42.0)
    # Pill is x=130 y=2 w=68 h=16. Bottom centre is Wave 0, Warp 50.
    percip = run("percip_face_drag", "Percipitator.amxd", [
        (40, "obj-viz", 0, f"onclick 40 {gy:.4f}"),
        (120, "obj-viz", 0, "onclick 164 18"),
    ])
    cy = recip_line_y(-12.0)
    ry = recip_line_y(-42.0)
    recip = run("recip_face_drag", "Reciprocator.amxd", [
        (30, "obj-viz", 0, "set_ceiling -12"),
        (80, "obj-viz", 0, f"onclick 40 {cy:.4f}"),
        (140, "obj-viz", 0, f"onclick 40 {ry:.4f}"),
    ])
    errors = []
    if abs(float(percip.get("gate", -999)) + 42) >= 0.6:
        errors.append(f"Percipitator gate line click moved -42 to {percip.get('gate')} (y {gy:.1f})")
    if float(percip.get("wtpos", -999)) > 2:
        errors.append(f"Percipitator wave-pill bottom set Wave to {percip.get('wtpos')}, expected 0")
    if abs(float(percip.get("warp", -999)) - 50) > 1:
        errors.append(f"Percipitator wave-pill centre set Warp to {percip.get('warp')}, expected 50")
    if abs(float(recip.get("gate", -999)) + 42) >= 0.6:
        errors.append(f"Reciprocator gate line click moved -42 to {recip.get('gate')} (y {ry:.1f})")
    if abs(float(recip.get("ceiling", -999)) + 12) >= 0.6:
        errors.append(f"Reciprocator ceiling line click moved -12 to {recip.get('ceiling')} (y {cy:.1f})")
    if errors:
        print("face drag: FAIL")
        for e in errors:
            print(" ", e)
        return 1
    print("face drag: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
