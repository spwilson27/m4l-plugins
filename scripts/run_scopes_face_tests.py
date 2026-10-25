#!/usr/bin/env python3
"""Click the painted EQ+ node, Q handle, and oscilloscope trigger guide inside Max.

A click on the drawn control has to leave the value that paint used. The first
run of the unfixed faces fails and prints the jumped number.
Run in the tart VM (AGENTS.md 1a): python3 scripts/run_scopes_face_tests.py
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "scopes_face_probe.js")

# EQ+ geo() with the sidechain fold closed: plot at (20, 23), 348 x 115, range ±12.
EQ_PLOT_X = 20.0
EQ_PLOT_Y = 23.0
EQ_PLOT_W = 348.0
EQ_PLOT_H = 115.0
EQ_RANGE = 12.0
EQ_Q_GAP = 13.5
EQ_Q_DEFAULT = 0.7071

# Oscilloscope overlay wave: oscGeom().plot then oscOverlayWave.
OSC_WAVE = (30.0, 29.0, 306.0, 117.0)
OSC_HEADROOM = 0.78
OSC_GUIDE_PAD = 4.0


def viz_box(amxd_name):
    path = os.path.join(ROOT, "devices", amxd_name)
    with open(path, "rb") as f:
        patcher = json.loads(f.read()[32:].decode("utf-8"))["patcher"]
    for b in patcher["boxes"]:
        if b["box"].get("id") == "obj-viz":
            return b
    raise SystemExit(f"{amxd_name} has no obj-viz")


def eq_freq_to_x(freq):
    t = math.log(freq / 20.0) / math.log(20000.0 / 20.0)
    return EQ_PLOT_X + t * EQ_PLOT_W


def eq_db_to_y(db):
    n = (db + EQ_RANGE) / (2.0 * EQ_RANGE)
    if n < 0.0:
        n = 0.0
    if n > 1.0:
        n = 1.0
    return EQ_PLOT_Y + (1.0 - n) * EQ_PLOT_H


def osc_amp_y(level, gain, rect):
    mid = rect[1] + rect[3] * 0.5
    return mid - level * gain * (rect[3] * 0.5 * OSC_HEADROOM)


def osc_guide_y(level, gain, rect):
    y = osc_amp_y(level, gain, rect)
    top = rect[1] + OSC_GUIDE_PAD
    bot = rect[1] + rect[3] - OSC_GUIDE_PAD
    if y < top:
        y = top
    if y > bot:
        y = bot
    return y


def run(name, box, events):
    lines = [mh.line("obj-viz", 0, "obj-js", 0)]
    res = mh.run_case(
        name, [box], lines, probe_js=PROBE, settle_ms=0, dur_ms=400,
        channels=1, mode="stepped", events=events,
    )
    print(f"{name}: gain {res.get('gain')} freq {res.get('freq')} q {res.get('q')} "
          f"extra {res.get('extra')} trig {res.get('trig')}")
    return res


def num(res, key):
    try:
        return float(res.get(key))
    except (TypeError, ValueError):
        return None


def main():
    errors = []

    # Bell gain sits above the ±12 scale, so the dot is painted on the top edge.
    gx = eq_freq_to_x(1000.0)
    gy = eq_db_to_y(24.0)
    gain_box = viz_box("EQ+.amxd")
    gain = run("eq_gain_dot", gain_box, [
        (20, "obj-viz", 0, "set_band_enable 0 1"),
        (40, "obj-viz", 0, "set_band_mode 0 6"),
        (60, "obj-viz", 0, "set_band_freq 0 1000"),
        (80, "obj-viz", 0, "set_band_q 0 1"),
        (100, "obj-viz", 0, "set_band_gain 0 24"),
        (140, "obj-viz", 0, f"onclick {gx:.4f} {gy:.4f} 1"),
        (180, "obj-viz", 0, f"ondrag {gx:.4f} {gy:.4f} 1"),
        (220, "obj-viz", 0, f"ondrag {gx:.4f} {gy:.4f} 0"),
    ])
    got = num(gain, "gain")
    # No outlet means the drag left 24 in place.
    if got is not None and abs(got - 24.0) > 0.05:
        errors.append(f"EQ+ band dot click moved gain 24 to {got} (painted y {gy:.2f})")

    # -12 st paints 40 Hz on the 20 Hz edge. Clicking that edge must keep 40.
    fx = eq_freq_to_x(20.0)
    fy = eq_db_to_y(0.0)
    freq = run("eq_freq_dot", viz_box("EQ+.amxd"), [
        (20, "obj-viz", 0, "set_band_enable 0 1"),
        (40, "obj-viz", 0, "set_band_mode 0 6"),
        (60, "obj-viz", 0, "set_band_gain 0 0"),
        (80, "obj-viz", 0, "set_band_q 0 1"),
        (100, "obj-viz", 0, "set_shift -12"),
        (120, "obj-viz", 0, "set_band_freq 0 40"),
        (160, "obj-viz", 0, f"onclick {fx:.4f} {fy:.4f} 1"),
        (200, "obj-viz", 0, f"ondrag {fx:.4f} {fy:.4f} 1"),
        (240, "obj-viz", 0, f"ondrag {fx:.4f} {fy:.4f} 0"),
    ])
    got = num(freq, "freq")
    if got is not None and abs(got - 40.0) > 0.05:
        errors.append(f"EQ+ band dot click moved 40 Hz at -12 st to {got} (painted x {fx:.2f})")

    # Double-click the Q handle resets Q. It must not spawn another band.
    qx = eq_freq_to_x(1000.0)
    qy = eq_db_to_y(4.0) - EQ_Q_GAP
    qh = run("eq_q_handle", viz_box("EQ+.amxd"), [
        (20, "obj-viz", 0, "set_band_enable 0 1"),
        (40, "obj-viz", 0, "set_band_mode 0 6"),
        (60, "obj-viz", 0, "set_band_freq 0 1000"),
        (80, "obj-viz", 0, "set_band_gain 0 4"),
        (100, "obj-viz", 0, "set_band_q 0 2.5"),
        (140, "obj-viz", 0, f"ondblclick {qx:.4f} {qy:.4f} 1"),
    ])
    spawned = num(qh, "extra")
    got_q = num(qh, "q")
    if spawned is not None and spawned > 0.5:
        errors.append(f"EQ+ Q-handle double-click enabled another band (b2_enable {spawned})")
    if got_q is None or abs(got_q - EQ_Q_DEFAULT) > 0.001:
        errors.append(f"EQ+ Q-handle double-click left Q at {got_q}, expected {EQ_Q_DEFAULT}")

    # +12 dB display gain clamps the trigger guide. A click on that line keeps the level.
    # The face does not outlet the trigger, so the harness copy of the script reports it.
    gain_lin = 10.0 ** (12.0 / 20.0)
    level = 0.5
    guide_y = osc_guide_y(level, gain_lin, OSC_WAVE)
    click_x = OSC_WAVE[0] + OSC_WAVE[2] * 0.5
    osc_box = viz_box("Oscilloscope.amxd")
    # Paint applies oscSmoothGain from the Gain Scale. A redraw is not guaranteed
    # between harness messages, so the copy sets that same gain, then the real
    # onclick hits the guide oscGuideY would draw.
    text = osc_box["box"]["textfile"]["text"]
    osc_box["box"]["textfile"]["text"] = text + (
        "\nfunction scopes_arm(level, db) {\n"
        "    oscAutoGain = 0;\n"
        "    oscGainDb = Number(db);\n"
        "    oscSmoothGain = Math.pow(10, oscGainDb / 20);\n"
        "    if (!(oscSmoothGain > 1e-4)) oscSmoothGain = 1;\n"
        "    oscTrigLevel = Number(level);\n"
        "    oscDrag = null;\n"
        "}\n"
        "function scopes_report() { outlet(0, \"trig\", oscTrigLevel); }\n"
    )
    osc = run("osc_guide", osc_box, [
        (40, "obj-viz", 0, "scopes_arm 0.5 12"),
        (120, "obj-viz", 0, f"onclick {click_x:.4f} {guide_y:.4f}"),
        (200, "obj-viz", 0, "scopes_report"),
    ])
    got = num(osc, "trig")
    if got is None or abs(got - level) > 0.01:
        errors.append(
            f"Oscilloscope guide click moved trigger {level} to {got} "
            f"(painted y {guide_y:.2f}, raw {osc_amp_y(level, gain_lin, OSC_WAVE):.2f})"
        )

    if errors:
        print("scopes face: FAIL")
        for e in errors:
            print(" ", e)
        return 1
    print("scopes face: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
