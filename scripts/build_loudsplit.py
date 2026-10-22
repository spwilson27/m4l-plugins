#!/usr/bin/env python3
"""
Build devices/Loud Split.amxd and devices/Loud Split.adg (Bitwig Spectral Suite style loudness splitter).

Three channels: 1 Loud (red), 2 Mid (yellow), 3 Quiet (green). Use the device as the FIRST device of EVERY chain of an Audio
Effect Rack, one chain per channel (the .adg preset does exactly that). Every instance runs the same mask-STFT analysis on the
same input with linked parameters and outputs only its own channel (Output = Auto: the chain index); the per-bin masks sum to
exactly 1, so the chains sum back to the input delayed by 4096 samples ("latency": 4096).

Signal path: plugin~ -> gen.codebox~ (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr + src/loudsplit_core.genexpr)
-> plugout~. The v8ui face (src/loudsplit_config.js + src/spectral_link.js + src/loudsplit_ui.js) draws the spectrum and the two
threshold lines (drag = threshold, Alt/Shift-drag = knee, dot = momentary band solo), links the parameters with the other
instances in the rack and sends the resolved output selection.

Layout (480 x 169, Ableton-native: Reverb-like flat titled sections on the Live theme): `Detection` section (x=4..296) with the v8ui canvas
x=8..292, y=20..161 (LCD spectrum, threshold lines, legend, Rise / Fall / Tilt values, Relative button drawn inside it); `Thresholds`
(Higher / Hi Knee, Lower / Lo Knee, Rel High / Rel Low) and `Output` (Output, Size, Mix) sections in the right column (x=300..476);
section panels, then the body panel, last.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from spectral_common import line, newobj, message

ROOT = sc.ROOT_DIR
SRC = os.path.join(ROOT, "src")
OUT_AMXD = os.path.join(sc.DEVICES_DIR, "Loud Split.amxd")
OUT_ADG = os.path.join(sc.DEVICES_DIR, "Loud Split.adg")
WIDTH = 480.0
LATENCY = 4096

# key: (long name, short name, min, max, initial, ptype, unitstyle[, units])
NUM = {
    "hithr": ("Higher Threshold", "Higher", -110.0, 0.0, -30.0, 0, 4),
    "lothr": ("Lower Threshold", "Lower", -110.0, 0.0, -85.0, 0, 4),
    "rhithr": ("Relative Higher Threshold", "Rel Higher", -110.0, 0.0, -12.0, 0, 4),
    "rlothr": ("Relative Lower Threshold", "Rel Lower", -110.0, 0.0, -36.0, 0, 4),
    "hiknee": ("Higher Knee", "Hi Knee", 1.0, 24.0, 6.0, 0, 9),
    "loknee": ("Lower Knee", "Lo Knee", 1.0, 24.0, 6.0, 0, 9),
    "rise": ("Rise Time", "Rise", 0.13, 125.0, 2.0, 0, 9),
    "fall": ("Fall Time", "Fall", 0.13, 125.0, 8.0, 0, 9),
    "tilt": ("Tilt", "Tilt", -6.0, 6.0, 0.0, 0, 9),
    "mix": ("Mix", "Mix", 0.0, 100.0, 100.0, 0, 9),
}
NUM_HELP = {
    "hithr": "Higher Threshold: bins louder than this level go to the Loud channel (absolute level of the Mid signal in dB).",
    "lothr": "Lower Threshold: bins quieter than this level go to the Quiet channel; bins between the two thresholds go to Mid.",
    "rhithr": "Relative Higher Threshold: like Higher Threshold, but relative to the loudest bin of the current analysis block (0 dB). Used in Relative mode.",
    "rlothr": "Relative Lower Threshold: like Lower Threshold, relative to the loudest bin of the current block. Used in Relative mode.",
    "hiknee": "Higher Knee: width in dB of the crossfade between Mid and Loud around the Higher Threshold (0 = hard switch). The channels always add up to the input.",
    "loknee": "Lower Knee: width in dB of the crossfade between Quiet and Mid around the Lower Threshold (0 = hard switch).",
    "rise": "Rise Time (0.13..125 blocks): blocks before quieter signals cross into louder channels, a kind of resistance (a block is one analysis hop, Size / 4 samples).",
    "fall": "Fall Time (0.13..125 blocks): blocks before louder signals cross into quieter channels, a kind of release.",
    "mix": "Mix: this chain outputs Mix x its channel + (1 - Mix) x its share (1/3) of the dry input, so the rack sum is Mix x wet + (1 - Mix) x dry (dry delayed by the same 4096 samples; the dry share passes through each chain's devices). Outside a rack: ordinary dry/wet.",
    "tilt": "Tilt (+-6 dB/oct): weights the analysed level by dB per octave around 1 kHz (positive favours highs, negative lows) before it is classified. The output level is not changed.",
}
NUM_UNITS = {"hithr": "%.1f dB", "lothr": "%.1f dB", "rhithr": "%.1f dB", "rlothr": "%.1f dB", "hiknee": "%.1f dB", "loknee": "%.1f dB", "rise": "%.2f", "fall": "%.2f", "tilt": "%.1f dB/oct", "mix": "%.0f %"}
# key: (long name, short name, values, initial)
ENUM = {
    "relative": ("Relative Loudness Mode", "Relative", ["Absolute", "Relative"], 0),
    "size": ("Size", "Size", ["1k", "2k", "4k"], 1),
    "output": ("Output", "Output", ["Auto", "Loud", "Mid", "Quiet", "All"], 0),
}
ENUM_HELP = {
    "relative": "Relative Loudness Mode: classify against the Relative thresholds, measured from the loudest bin of the current block (0 dB), instead of absolute levels.",
    "size": "Analysis block size: 1k favours time resolution, 4k frequency resolution. The latency stays 4096 samples at every size.",
    "output": "Output: Auto uses this chain's index in the parent Rack (1 Loud, 2 Mid, 3 Quiet; outside a Rack the sum of all), or pick a channel, or All.",
}
# key: (gen message, scale)
GEN_MSG = {
    "hithr": ("thrhi", 1.0),
    "lothr": ("thrlo", 1.0),
    "rhithr": ("rthrhi", 1.0),
    "rlothr": ("rthrlo", 1.0),
    "hiknee": ("kneehi", 1.0),
    "loknee": ("kneelo", 1.0),
    "relative": ("relmode", 1.0),
    "rise": ("risebl", 1.0),
    "fall": ("fallbl", 1.0),
    "tilt": ("tiltdb", 1.0),
    "mix": ("wetamt", 0.01),
    "size": ("fftn", None),
    "output": (None, 1.0),
}
LINKED = ["hithr", "lothr", "rhithr", "rlothr", "hiknee", "loknee", "relative", "rise", "fall", "tilt", "mix", "size"]
CANVAS_KEYS = ["hithr", "lothr", "rhithr", "rlothr", "hiknee", "loknee", "relative", "rise", "fall", "tilt", "dispost", "disstyle"]
OFF_FACE = ["relative", "rise", "fall", "tilt"]   # drawn and edited in the display canvas (Bitwig layout); real automatable parameters   # edited from the canvas
UI_KEYS = LINKED + ["output"]
ABS_KEYS = ["hithr", "lothr"]
REL_KEYS = ["rhithr", "rlothr"]


def build_patcher():
    gen = sc.gen_code(os.path.join(SRC, "cepstrum_lib.genexpr"), os.path.join(SRC, "spectral_split_lib.genexpr"),
                      os.path.join(SRC, "loudsplit_core.genexpr"))
    face = (sc.read(os.path.join(SRC, "loudsplit_config.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_link.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_theme.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "loudsplit_ui.js")))

    boxes = []
    lines = []

    # ---- controls (presentation): Reverb-style titled sections, theme-bound native live.* controls ----
    # Thresholds section (x = 300..476): two columns of label + LCD value, three rows
    LX1, NX1, LX2, NX2 = 306, 350, 392, 436
    rows = [("hithr", "Higher", "hiknee", "Hi Knee"), ("lothr", "Lower", "loknee", "Lo Knee"), ("rhithr", "Rel High", "rlothr", "Rel Low")]
    for i, (k1, t1, k2, t2) in enumerate(rows):
        y = 21 + i * 17
        boxes.append(sc.make_theme_comment(f"obj-lbl-{k1}", t1, LX1, y + 1, 42))
        boxes.append(sc.make_lcd_numbox(k1, NUM[k1], NUM_HELP[k1], NX1, y, 38, 15, unit_text=NUM_UNITS.get(k1)))
        boxes.append(sc.make_theme_comment(f"obj-lbl-{k2}", t2, LX2, y + 1, 42))
        boxes.append(sc.make_lcd_numbox(k2, NUM[k2], NUM_HELP[k2], NX2, y, 38, 15, unit_text=NUM_UNITS.get(k2)))
    boxes.append(sc.make_theme_comment("obj-lbl-relnote", "Rel: dB below the loudest bin", 306, 74, 166, 12, size=8.5, name="live_display_scale_text"))
    # Rise / Fall / Tilt / Relative Loudness Mode live in the canvas: real parameters, kept off the face
    for key in ("rise", "fall", "tilt"):
        box = sc.make_numbox(key, NUM[key], NUM_HELP[key], 0, 0, 60, 15, sc.ORANGE, 2, 8.5, NUM_UNITS.get(key))
        box["box"]["presentation"] = 0
        del box["box"]["presentation_rect"]
        boxes.append(box)
    box = sc.make_tab("relative", ENUM["relative"], ENUM_HELP["relative"], 0, 0, 60, 15, sc.TEXT)
    box["box"]["presentation"] = 0
    del box["box"]["presentation_rect"]
    boxes.append(box)
    # Output section: Output menu, Size tab, Mix value
    CX, CW = 364, 106
    boxes.append(sc.make_theme_comment("obj-lbl-output", "Output", 306, 110, 56))
    boxes.append(sc.make_theme_menu("output", ENUM["output"], ENUM_HELP["output"], CX, 109, CW, 15))
    boxes.append(sc.make_theme_comment("obj-lbl-size", "Size", 306, 128, 56))
    boxes.append(sc.make_theme_tab("size", ENUM["size"], ENUM_HELP["size"], CX, 127, CW, 15))
    boxes.append(sc.make_theme_comment("obj-lbl-mix", "Mix", 306, 146, 56))
    boxes.append(sc.make_lcd_numbox("mix", NUM["mix"], NUM_HELP["mix"], CX, 145, 70, 15, unit_text=NUM_UNITS.get("mix")))

    # section titles + hairlines (the section panels themselves go last)
    p_det, parts_det = sc.make_section("det", 4, 4, 292, 161, "Detection")
    p_thr, parts_thr = sc.make_section("thr", 300, 4, 176, 85, "Thresholds")
    p_out, parts_out = sc.make_section("out", 300, 93, 176, 72, "Output")
    for parts in (parts_det, parts_thr, parts_out):
        boxes += parts

    # ---- display (the only v8ui) ----
    boxes.append(sc.v8ui("obj-viz", face, [8.0, 20.0, 284.0, 141.0], (20.0, 80.0), 4, "LoudsplitView"))

    # ---- audio ----
    boxes += [
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.gen_box("obj-gen", gen, "loudsplit"),
        # `---` is unique per device instance in M4L (`#0` is not expanded in a top-level device in Live)
        newobj("obj-scope-buf", "buffer~ ---loudsplitscope @samps 544", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 285, 60, outlettype=["bang"]),
        message("obj-msg-ui-buf", "setbuffer ---loudsplitscope", 560, 315, 190),
        message("obj-msg-gen-buf", "scope ---loudsplitscope", 560, 345, 170),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init", "init_link", 780, 430, 70),
    ]
    lines += [
        line("obj-plugin", 0, "obj-gen", 0), line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0), line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-ui-buf"), line("obj-loadbang", 0, "obj-msg-gen-buf"),
        line("obj-msg-ui-buf", 0, "obj-viz"), line("obj-msg-gen-buf", 0, "obj-gen"),
        line("obj-thisdevice", 0, "obj-msg-init"), line("obj-msg-init", 0, "obj-viz"),
    ]

    # ---- hidden UI-state toggles (saved with the Set) ----
    boxes.append(sc.make_state_toggle("dispost", "Display Post", "Post", ["Pre", "Post"], 20.0))
    boxes.append(sc.make_state_toggle("disstyle", "Display Style", "Style", ["Spectrum", "Sonogram"], 50.0))
    for key in ("dispost", "disstyle"):
        uip = f"obj-ui-{key}"
        boxes.append(newobj(uip, f"prepend set_{key}", 900, 20.0 if key == "dispost" else 50.0, 120))
        lines.append(line(f"obj-ctrl-{key}", 0, uip))
        lines.append(line(uip, 0, "obj-viz"))

    # ---- parameter wiring: control -> gen, control -> face ----
    gen_head = {}
    for n, key in enumerate(UI_KEYS):
        msg, scale = GEN_MSG[key]
        expr = "expr 1024 * pow(2\\, $f1)" if key == "size" else None
        gen_head[key] = sc.wire_param(boxes, lines, key, msg, scale or 1.0, f"set_{key}", y=600.0 + n * 26.0, size_expr=expr)

    # canvas edits -> route -> control (the control then drives gen and the face as usual)
    boxes.append(newobj("obj-route-canvas", "route " + " ".join(CANVAS_KEYS), 20, 560, 300, numoutlets=len(CANVAS_KEYS) + 1))
    lines.append(line("obj-viz", 0, "obj-route-canvas"))
    for i, key in enumerate(CANVAS_KEYS):
        lines.append(line("obj-route-canvas", i, f"obj-ctrl-{key}"))

    # rack peer values -> route -> `prepend set` (silent) into the control + into the same gen path the control uses
    boxes.append(newobj("obj-route-link", "route " + " ".join(LINKED), 20, 590, 360, numoutlets=len(LINKED) + 1))
    lines.append(line("obj-viz", 1, "obj-route-link"))
    for i, key in enumerate(LINKED):
        lset = f"obj-lset-{key}"
        boxes.append(newobj(lset, "prepend set", 300 + i * 20, 700, 80))
        lines.append(line("obj-route-link", i, lset))
        lines.append(line(lset, 0, f"obj-ctrl-{key}"))
        lines.append(line("obj-route-link", i, gen_head[key]))

    # resolved output selection -> gen
    lines.append(line("obj-viz", 2, "obj-gen", 0))

    # Relative mode greys out the unused threshold pair: face outlet 3 -> route -> prepend active -> the bars
    boxes.append(newobj("obj-route-active", "route act_abs act_rel", 20, 620, 160, numoutlets=3))
    boxes.append(newobj("obj-act-abs", "prepend active", 200, 650, 100))
    boxes.append(newobj("obj-act-rel", "prepend active", 320, 650, 100))
    lines += [line("obj-viz", 3, "obj-route-active"), line("obj-route-active", 0, "obj-act-abs"), line("obj-route-active", 1, "obj-act-rel")]
    for key in ABS_KEYS:
        lines.append(line("obj-act-abs", 0, f"obj-ctrl-{key}"))
    for key in REL_KEYS:
        lines.append(line("obj-act-rel", 0, f"obj-ctrl-{key}"))

    # ---- background panels last: section panels, then the body (Max draws earlier boxes over later ones) ----
    boxes += [p_det, p_thr, p_out, sc.make_body_panel(WIDTH)]

    return sc.patcher(
        boxes, lines, WIDTH,
        "Splits audio into Quiet, Mid and Loud channels per frequency bin with a spectral mask; use one instance per chain of an Audio Effect Rack",
        "Loud Split: Quiet, Mid and Loud channels (Bitwig Spectral Suite style) with linked rack instances",
        "loud quiet split spectral rack stft loudness", LATENCY)


def main():
    doc = build_patcher()
    sc.write_amxd(doc, OUT_AMXD)
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make_spectral_rack.py"), "--amxd", OUT_AMXD,
                    "--name", "Loud Split", "--chains", "Loud,Mid,Quiet", "--out", OUT_ADG], check=True)


if __name__ == "__main__":
    main()
