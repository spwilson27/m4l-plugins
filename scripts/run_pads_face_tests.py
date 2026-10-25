#!/usr/bin/env python3
"""Click the painted puck / pad / step bar and require the stored value to match.

Run in the tart VM (AGENTS.md 1a): python3 scripts/run_pads_face_tests.py
Assertions are the correct behaviour. A miss prints the value Max actually stored.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "pads_face_probe.js")

# Glitch default face (sections closed): pad origin and the crosshair inset in paintPadRaw / padToXY.
GL_PAD = (30.0, 19.0, 112.0, 118.0)
GL_WEIGHTS = 6816  # glitchLayout().weightsOffset = GL_NSLOT * np

# Mega Modulator expanded strip: rail 20 + gap 2, viz inset (x+4, 18). Steps plot inset matches ubDrawViz.
MM_VIZ = (26.0, 18.0, 196.0, 62.0)
MM_CFG_X = 24  # CF_X
MM_CFG_Y = 25  # CF_Y


def viz_box(amxd_name):
    path = os.path.join(ROOT, "devices", amxd_name)
    with open(path, "rb") as f:
        patcher = json.loads(f.read()[32:].decode("utf-8"))["patcher"]
    for b in patcher["boxes"]:
        if b["box"].get("id") == "obj-viz":
            return b
    raise SystemExit(f"{amxd_name} has no obj-viz")


def buf(obj_id, name, samps, x):
    return mh.box(obj_id, f"buffer~ {name} @samps {samps}", x, 700, 220, 22,
                   numoutlets=2, outlettype=["float", "bang"])


def run(name, boxes, events):
    lines = [mh.line("obj-viz", 0, "obj-js", 0)]
    res = mh.run_case(
        name, boxes, lines, probe_js=PROBE, settle_ms=0, dur_ms=400,
        channels=1, mode="stepped", events=events,
    )
    keys = ("morphx", "morphy", "morphx_n", "weight0", "weight1", "cfgx", "cfgy", "step0")
    print(name + ": " + " ".join(f"{k} {res.get(k)}" for k in keys))
    return res


def glitch_puck():
    # Painted crosshair at xy (0, 0): x = pad.x+8, y = pad.y+8. That point sits on corner badge 0.
    px = GL_PAD[0] + 8.0
    py = GL_PAD[1] + 8.0
    box = viz_box("Glitch.amxd")
    return run("glitch_puck", [box, buf("gl-slots", "glslots", 10496, 40)], [
        (30, "obj-js", 0, "slotsbuf glslots"),
        (40, "obj-viz", 0, "setbuffer glslots"),
        (90, "obj-viz", 0, "audition morph"),
        (140, "obj-viz", 0, "xy 0 0"),
        (200, "obj-viz", 0, f"onclick {px:.0f} {py:.0f} 1"),
    ])


def mm_steps():
    # Top of the steps plot is value 1 (ubDrawViz: iy = viz.y+3). Step 0's column centre.
    ix = MM_VIZ[0] + 2.0
    iy = MM_VIZ[1] + 3.0
    iw = MM_VIZ[2] - 4.0
    x = ix + (iw / 8.0) * 0.5
    y = iy
    box = viz_box("Mega Modulator.amxd")
    boxes = [
        box,
        buf("mm-cfg", "mmcfg", 512, 40),
        buf("mm-mseg", "mmmseg", 8192, 280),
        buf("mm-steps", "mmsteps", 512, 520),
        buf("mm-scope", "mmscope", 640, 760),
        buf("mm-curve", "mmcurve", 65536, 40),
        buf("mm-route", "mmroute", 1048, 280),
        buf("mm-int", "mmint", 512, 520),
        buf("mm-icurve", "mmicurve", 16384, 760),
    ]
    return run("mm_steps", boxes, [
        (30, "obj-viz", 0, "setnames mmcfg mmmseg mmsteps mmscope mmcurve mmroute mmint mmicurve"),
        (80, "obj-js", 0, "stepsbuf mmsteps"),
        (120, "obj-viz", 0, "test_add 4"),
        (170, "obj-viz", 0, "test_expand 0"),
        (230, "obj-viz", 0, f"onclick {x:.4f} {y:.4f} 1"),
    ])


def mm_xy():
    # Painted crosshair at X=0, Y=1 (ubPaintXy: +2 inset). Clicking it must store 0, 1.
    pad = (MM_VIZ[0], MM_VIZ[1], 62.0, 62.0)
    x = pad[0] + 2.0
    y = pad[1] + 2.0
    box = viz_box("Mega Modulator.amxd")
    boxes = [
        box,
        buf("mm-cfg", "mmcfg", 512, 40),
        buf("mm-mseg", "mmmseg", 8192, 280),
        buf("mm-steps", "mmsteps", 512, 520),
        buf("mm-scope", "mmscope", 640, 760),
        buf("mm-curve", "mmcurve", 65536, 40),
        buf("mm-route", "mmroute", 1048, 280),
        buf("mm-int", "mmint", 512, 520),
        buf("mm-icurve", "mmicurve", 16384, 760),
    ]
    return run("mm_xy", boxes, [
        (30, "obj-viz", 0, "setnames mmcfg mmmseg mmsteps mmscope mmcurve mmroute mmint mmicurve"),
        (80, "obj-js", 0, "cfgbuf mmcfg"),
        (120, "obj-viz", 0, "test_add 7"),
        (170, "obj-viz", 0, "test_expand 0"),
        (230, "obj-viz", 0, f"onclick {x:.4f} {y:.4f} 1"),
    ])


def main():
    errors = []
    try:
        g = glitch_puck()
    except Exception as e:
        print(f"glitch_puck: ERROR {e}")
        return 1
    # The click landed on the puck (morphx was sent again) and corner 0 stayed on slot 0.
    if int(float(g.get("morphx_n", 0))) < 2:
        errors.append(f"Glitch puck click did not reach the pad (morphx_n {g.get('morphx_n')}, weight0 {g.get('weight0')})")
    elif abs(float(g.get("weight0", -1)) - 1.0) > 0.01 or abs(float(g.get("morphx", -1))) > 0.01:
        errors.append(
            f"Glitch puck at xy 0,0 stored weight0 {g.get('weight0')} morphx {g.get('morphx')} "
            f"(corner stole the click; expected weight0 1 morphx 0)"
        )

    try:
        st = mm_steps()
    except Exception as e:
        print(f"mm_steps: ERROR {e}")
        return 1
    step0 = float(st.get("step0", -999))
    if abs(step0 - 1.0) > 0.01:
        errors.append(f"Mega Modulator steps: click on the painted top stored {step0}, expected 1")

    try:
        xy = mm_xy()
    except Exception as e:
        print(f"mm_xy: ERROR {e}")
        return 1
    cfgx = float(xy.get("cfgx", -999))
    cfgy = float(xy.get("cfgy", -999))
    if abs(cfgx - 0.0) > 0.01 or abs(cfgy - 1.0) > 0.01:
        errors.append(f"Mega Modulator XY: click on the painted (0, 1) crosshair stored {cfgx}, {cfgy}")

    if errors:
        print("pads face: FAIL")
        for e in errors:
            print(" ", e)
        return 1
    print("pads face: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
