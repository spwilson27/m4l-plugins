#!/usr/bin/env python3
"""Click the painted Sand reticles and the Cepstra cutoff bar inside Max.

A click on the drawn amount/freq crosshair has to leave those values in place, and a
click on Cepstra's bar at Quality 1k / Res 100 has to leave Res at 100. The lifter
lag is clamped at N/2, so that bar sits on the clamp, not on the unclamped 15 ms mark.
Run in the tart VM (AGENTS.md 1a): python3 scripts/run_meters_face_tests.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "meters_face_probe.js")


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def viz_box(amxd_name, box_id):
    path = os.path.join(ROOT, "devices", amxd_name)
    with open(path, "rb") as f:
        import json
        patcher = json.loads(f.read()[32:].decode("utf-8"))["patcher"]
    for b in patcher["boxes"]:
        if b["box"].get("id") == box_id:
            return b
    raise SystemExit(f"{amxd_name} has no {box_id}")


def box_size(box):
    # The harness opens the patch out of presentation, so v8ui size is the patching rect.
    r = box["box"]["patching_rect"]
    return float(r[2]), float(r[3])


def sand_cross(w, h, db, hz):
    # paint() reticles on the  scope canvas: freq inset 4 px, amount inset 3 px over a 6 px shorter travel.
    plot_x, plot_y = 4.0, 4.0
    plot_w = w - 32.0
    plot_h = h - 8.0
    amt = clamp(db / 140.0, 0.0, 1.0)
    lift_y = plot_y + plot_h - amt * (plot_h - 6.0) - 3.0
    lo, hi = math.log(20.0), math.log(18000.0)
    norm = (math.log(clamp(hz, 20.0, 18000.0)) - lo) / (hi - lo)
    freq_x = plot_x + 4.0 + norm * (plot_w - 8.0)
    return freq_x, lift_y


def cepstra_bar_x(w, h, res_pct, n_fft, sr=44100.0):
    # layoutRegions + barAxis01 for a silent Manual display. Lag clamps at N/2 - 4.
    pad = 4.0
    disp_x = pad
    disp_w = w - 2.0 * pad
    ms = 0.3 * (15.0 / 0.3) ** clamp(res_pct / 100.0, 0.0, 1.0)
    lag = clamp(ms * 0.001 * sr, 2.0, n_fft / 2.0 - 4.0)
    t = clamp((lag / sr) * 1000.0 / 20.0, 0.0, 1.0)
    return disp_x + t * disp_w


def run(name, box, events, extra_boxes=None):
    lines = [mh.line(box["box"]["id"], 0, "obj-js", 0)]
    res = mh.run_case(
        name, [box] + list(extra_boxes or []), lines, probe_js=PROBE,
        settle_ms=0, dur_ms=400, channels=1, mode="stepped", events=events,
    )
    print(f"{name}: amount {res.get('amount')} freq {res.get('freq')} res {res.get('res')}")
    return res


def main():
    sand_box = viz_box("Sand.amxd", "obj-viz")
    sw, sh = box_size(sand_box)
    sx, sy = sand_cross(sw, sh, 18.0, 14000.0)
    sand = run("sand_reticle", sand_box, [
        (80, "obj-viz", 0, f"onclick {sx:.4f} {sy:.4f}"),
    ])

    cep_box = viz_box("Cepstra.amxd", "obj-viz-disp")
    cw, ch = box_size(cep_box)
    # Quality 1k is N = 1024. The bar for Res 100 is the clamped lag, not 15 ms.
    bx = cepstra_bar_x(cw, ch, 100.0, 1024.0)
    scope = mh.box("obj-cepscope", "buffer~ cepface 272", 40, 300, 160)
    cep = run("cepstra_bar", cep_box, [
        (40, "obj-viz-disp", 0, "setbuffer cepface"),
        (90, "obj-viz-disp", 0, "set_mode 0"),
        (140, "obj-viz-disp", 0, "set_quality 0"),
        (190, "obj-viz-disp", 0, "set_res 100"),
        (260, "obj-viz-disp", 0, f"onclick {bx:.4f} 40"),
    ], extra_boxes=[scope])

    errors = []
    amt = float(sand.get("amount", -999))
    frq = float(sand.get("freq", -999))
    if abs(amt - 18.0) > 0.1 or abs(frq - 14000.0) > 1.0:
        errors.append(
            f"Sand crosshair click moved 18 dB / 14000 Hz to {sand.get('amount')} / {sand.get('freq')} "
            f"(x {sx:.2f} y {sy:.2f})"
        )
    got = cep.get("res", None)
    # set_res does not emit, and a click that leaves Res alone does not either.
    # The probe's -999 is that silence. An emitted value other than 100 is the jump.
    if got is not None and float(got) != -999.0 and abs(float(got) - 100.0) > 0.1:
        errors.append(
            f"Cepstra 1k Res bar click moved 100 to {got} (x {bx:.2f})"
        )
    if errors:
        print("meters face: FAIL")
        for e in errors:
            print(" ", e)
        return 1
    print("meters face: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
