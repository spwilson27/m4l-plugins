#!/usr/bin/env python3
"""
Build devices/Freq Split.amxd and devices/Freq Split.adg (Bitwig Freq Split (Spectral) style spectral sorter).

Four channels: 1 red, 2 blue, 3 yellow, 4 magenta. The log-frequency axis is cut by 1..1024 (continuous) splits into many narrow
regions that are dealt to the channels in rotation; Split Insertion Direction (<- / <-> / ->) says where a fractional new split
grows in, Crossfade overlaps neighbouring regions, Nudge (+-4, wrapping, fractional crossfades) shifts the channel assignment, Spin
(+-50 %, wrapping) slides the pattern, Bend / Pinch (the XY dot) warp it. Use the device as the FIRST device of EVERY chain of an
Audio Effect Rack, one chain per channel (the .adg preset does exactly that): the rack's chain volume / pan / activator / solo and
the chain's devices are Bitwig's per-channel Gain / Pan / On / Solo / FX chain, devices before / after the rack are Pre FX / Post FX.
Every instance computes the same pattern and per-bin masks from linked parameters and outputs only its own channel (Output =
Auto: the chain index); the masks sum to 1, so the chains sum back to the input delayed by 4096 samples ("latency": 4096).
Mix keeps that identity in a rack (out = mix * wet + (1 - mix) * dry / 4 per chain). No signal analysis: the masks depend on the
parameters only.

Signal path: plugin~ -> gen.codebox~ (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr + src/freqsplit_core.genexpr)
-> plugout~. The main v8ui face (src/freqsplit_config.js + src/spectral_link.js + src/freqsplit_ui.js) draws the channel regions,
the XY dot, the limiter line and the spectrum, links the parameters with the other instances in the rack and sends the resolved
output selection; the small header v8ui (src/freqsplit_top_ui.js) draws the direction arrows and the crossfade ramp.

Layout (480 x 169): top row (y=6) Splits | direction arrows + ramp | XFade; main v8ui canvas x=6..336, y=23..142; bottom row (y=146)
Nudge | Spin | Bend | Pinch; right column (x=344..474): Display Pre | Post, Limiter + Threshold, Mix dial, Size, Output; two
background panels last. No live.* widget overlaps a v8ui.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from spectral_common import line, newobj, message

ROOT = sc.ROOT_DIR
SRC = os.path.join(ROOT, "src")
OUT_AMXD = os.path.join(sc.DEVICES_DIR, "Freq Split.amxd")
OUT_ADG = os.path.join(sc.DEVICES_DIR, "Freq Split.adg")
WIDTH = 480.0
LATENCY = 4096

RED, BLU, YEL, MAG = sc.RED, sc.BLUE, sc.YELLOW, sc.MAGENTA
ORG = sc.ORANGE

# key: (long name, short name, min, max, initial, ptype, unitstyle)
NUM = {
    "splits": ("Frequency Splits", "Splits", 1.0, 1024.0, 16.0, 0, 9),
    "xfade": ("Crossfade Amount", "XFade", 0.0, 100.0, 0.0, 0, 9),
    "nudge": ("Split Nudge", "Nudge", -4.0, 4.0, 0.0, 0, 9),
    "spin": ("Split Spin", "Spin", -50.0, 50.0, 0.0, 0, 9),
    "bend": ("Split Bend", "Bend", -100.0, 100.0, 0.0, 0, 9),
    "pinch": ("Split Pinch", "Pinch", -100.0, 100.0, 0.0, 0, 9),
    "limthr": ("Limiter Threshold", "Lim Thr", -120.0, 12.0, 0.0, 0, 9),
    "mix": ("Mix", "Mix", 0.0, 100.0, 100.0, 0, 9),
}
NUM_UNITS = {"splits": "%.2f", "xfade": "%.2f %", "nudge": "%.2f", "spin": "%.1f %", "bend": "%.0f %", "pinch": "%.0f %",
             "limthr": "%.1f dB", "mix": "%.0f %"}
NUM_EXPONENT = {"splits": 3.0}
NUM_HELP = {
    "splits": "Frequency Splits: the number of splits (1.00 to 1024.00, fractional) across the whole spectrum; the regions between them are dealt to the four channels in rotation. A fractional count grows the newest split in smoothly at the Split Insertion Direction.",
    "xfade": "Crossfade Amount: the overlap of the individual splits. 0 % cuts the spectrum into isolated bins, above that adjacent regions crossfade (100 % overlaps their full half widths). The four channels always sum to the input.",
    "nudge": "Split Nudge (+-4.00, wrapping): shifts the channel assignment. +2.00 moves channel 1's contents to channel 3 and channel 4's to channel 2. Fractional values crossfade between adjacent channels.",
    "spin": "Split Spin (+-50 %, wrapping): offsets the split pattern against the whole spectrum; what leaves one end wraps around to the other.",
    "bend": "Split Bend (+-100 %): sets the centre frequency of the split pattern (the white dot's x) and bends the pattern around it. Negative values pack the splits low, positive values high.",
    "pinch": "Split Pinch (+-100 %): pinches the split pattern toward the middle (positive, the white dot's y up) or toward the edges (negative).",
    "limthr": "Spectral Limiter Threshold (-120 to +12 dB): with the Spectral Limiter on, no frequency bin of this channel's output gets louder than this level (applied after the channel's mask).",
    "mix": "Mix: amount of processed signal against the dry signal entering the device. In a Rack each chain adds a quarter of the dry signal, so the Rack sum is the Mix of processed and dry (the dry share passes through each chain's devices). Output All is a normal dry/wet.",
}
# key: (long name, short name, values, initial)
ENUM = {
    "dir": ("Split Insertion Direction", "Insert", ["High", "Mid", "Low"], 0),
    "limon": ("Spectral Limiter", "Limiter", ["Off", "On"], 0),
    "size": ("Size", "Size", ["1k", "2k", "4k"], 2),
    "output": ("Output", "Output", ["Auto", "Ch 1", "Ch 2", "Ch 3", "Ch 4", "All"], 0),
    "dispost": ("Spectrum Display", "Display", ["Pre", "Post"], 0),
}
ENUM_HELP = {
    "dir": "Split Insertion Direction: where new splits are inserted in the spectrum: High (arrow <-, at the right / high end), Mid (arrow <->, in the middle) or Low (arrow ->, at the left / low end).",
    "limon": "Spectral Limiter: caps the magnitude of every frequency bin of the output at the Limiter Threshold, applied after the channel masks. Bins below it are unaffected. This is the one control that breaks the exact sum of the channels.",
    "size": "Analysis block size: larger blocks resolve narrow splits more sharply at low frequencies. The latency stays 4096 samples at every size.",
    "output": "Output: Auto uses this chain's index in the parent Rack (1 red, 2 blue, 3 yellow, 4 magenta; outside a Rack the sum of all), or pick a channel, or All.",
    "dispost": "Spectrum Display: Pre shows the analysis data (good for tweaking the splits), Post shows the channel output after the masks and the limiter.",
}
# key: (gen message, scale)
GEN_MSG = {
    "splits": ("nsplit", 1.0),
    "dir": ("sdir", 1.0),
    "xfade": ("xfadeamt", 0.01),
    "nudge": ("nudgeamt", 1.0),
    "spin": ("spinamt", 0.01),
    "bend": ("bendamt", 0.01),
    "pinch": ("pinchamt", 0.01),
    "limon": ("limon", 1.0),
    "limthr": ("limdb", 1.0),
    "mix": ("mixamt", 0.01),
    "size": ("fftn", None),
    "output": (None, 1.0),
    "dispost": (None, 1.0),
}
LINKED = ["splits", "dir", "xfade", "nudge", "spin", "bend", "pinch", "limon", "limthr", "mix", "size"]
CANVAS_KEYS = ["bend", "pinch", "limthr", "spin"]     # edited from the canvas -> route -> control
UI_KEYS = ["splits", "dir", "xfade", "nudge", "spin", "bend", "pinch", "limon", "limthr", "mix", "size", "output", "dispost"]


def numbox(key, x, y, w, h, color, appearance):
    box = sc.make_numbox(key, NUM[key], NUM_HELP[key], x, y, w, h, color, appearance, 8.5, NUM_UNITS[key])
    if key in NUM_EXPONENT:
        box["box"]["saved_attribute_attributes"]["valueof"]["parameter_exponent"] = NUM_EXPONENT[key]
    return box


def make_toggle(key, x, y, w, h, color, text):
    """Spectral Limiter: a live.text toggle (Off / On parameter)."""
    t = sc.make_tab(key, ENUM[key], ENUM_HELP[key], x, y, w, h, color)
    b = t["box"]
    for k in ("num_lines_patching", "num_lines_presentation", "bgoncolor", "textoncolor", "textcolor"):
        b.pop(k, None)
    b.update({
        "maxclass": "live.text", "mode": 1, "numoutlets": 2, "outlettype": ["", ""], "text": text, "texton": text,
        "activebgcolor": [0.07, 0.09, 0.12, 1.0], "activebgoncolor": [color[0], color[1], color[2], 1.0],
        "activetextcolor": [0.68, 0.76, 0.84, 1.0], "activetextoncolor": [0.08, 0.1, 0.12, 1.0],
    })
    return t


def make_dial(key, x, y, w, h, color):
    valueof = sc.num_valueof(NUM[key])
    valueof["parameter_units"] = NUM_UNITS[key]
    valueof["parameter_unitstyle"] = 9
    return {"box": {
        "activedialcolor": [color[0], color[1], color[2], 1.0],
        "activeneedlecolor": [color[0], color[1], color[2], 1.0],
        "annotation": NUM_HELP[key], "annotation_name": NUM[key][0],
        "id": f"obj-ctrl-{key}", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 300.0, float(w), float(h)],
        "presentation": 1, "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": valueof},
        "showname": 1, "shownumber": 1, "textcolor": [0.82, 0.86, 0.90, 1.0], "varname": NUM[key][0],
    }}


def build_patcher():
    gen = sc.gen_code(os.path.join(SRC, "cepstrum_lib.genexpr"), os.path.join(SRC, "spectral_split_lib.genexpr"),
                      os.path.join(SRC, "freqsplit_core.genexpr"))
    face = (sc.read(os.path.join(SRC, "freqsplit_config.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_link.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "freqsplit_ui.js")))
    top = sc.read(os.path.join(SRC, "freqsplit_top_ui.js"))

    boxes = []
    lines = []

    # ---- top row (y = 6) ----
    boxes.append(sc.make_label("obj-lbl-splits", "Splits", 8, 7, 32, 13, color=sc.TEXT))
    boxes.append(numbox("splits", 42, 6, 56, 15, ORG, 2))
    boxes.append(numbox("xfade", 268, 6, 66, 15, ORG, 2))
    # direction tab: a real automatable parameter, kept off the face (the header v8ui draws the arrows and drives it)
    dirbox = sc.make_tab("dir", ENUM["dir"], ENUM_HELP["dir"], 0, 0, 90, 15, ORG)
    dirbox["box"]["presentation"] = 0
    dirbox["box"].pop("presentation_rect", None)
    boxes.append(dirbox)

    # ---- bottom row (y = 146) ----
    row = [("nudge", "Nudge", 8, 34, 42, 44, 3), ("spin", "Spin", 90, 26, 116, 54, 3), ("bend", "Bend", 174, 28, 202, 46, 3),
           ("pinch", "Pinch", 252, 32, 284, 46, 3)]
    for key, text, lx, lw, nx, nw, app in row:
        boxes.append(sc.make_label(f"obj-lbl-{key}", text, lx, 147, lw, 13, color=sc.TEXT))
        boxes.append(numbox(key, nx, 146, nw, 15, ORG, app))

    # ---- right column ----
    boxes.append(sc.make_tab("dispost", ENUM["dispost"], ENUM_HELP["dispost"], 350, 8, 120, 15, sc.TEXT))
    boxes.append(make_toggle("limon", 350, 28, 56, 15, ORG, "Limiter"))
    boxes.append(numbox("limthr", 410, 28, 60, 15, ORG, 2))
    boxes.append(make_dial("mix", 372, 50, 56, 60, ORG))
    boxes.append(sc.make_label("obj-lbl-size", "Size", 350, 119, 28, 13, color=sc.DIM))
    boxes.append(sc.make_tab("size", ENUM["size"], ENUM_HELP["size"], 380, 118, 90, 15, sc.DIM))
    boxes.append(sc.make_label("obj-lbl-output", "Output", 350, 139, 36, 13, color=sc.TEXT))
    boxes.append(sc.make_menu("output", ENUM["output"], ENUM_HELP["output"], 388, 138, 82, 15, sc.TEXT))
    boxes.append(sc.make_label("obj-leg-lat", "Latency 4096 smp", 350, 154, 120, 10, size=7.0, color=sc.DIM, bold=False))

    # ---- displays (the only v8uis) ----
    boxes.append(sc.v8ui("obj-viz-top", top, [104.0, 6.0, 160.0, 15.0], (20.0, 40.0), 1, "FreqsplitTop"))
    boxes.append(sc.v8ui("obj-viz", face, [6.0, 23.0, 330.0, 119.0], (20.0, 80.0), 3, "FreqsplitView"))

    # ---- audio ----
    boxes += [
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.gen_box("obj-gen", gen, "freqsplit"),
        # `---` is unique per device instance in M4L (`#0` is not expanded in a top-level device in Live)
        newobj("obj-scope-buf", "buffer~ ---freqsplitscope @samps 704", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 285, 60, outlettype=["bang"]),
        message("obj-msg-ui-buf", "setbuffer ---freqsplitscope", 560, 315, 190),
        message("obj-msg-gen-buf", "scope ---freqsplitscope", 560, 345, 170),
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

    # ---- parameter wiring: control -> gen, control -> face ----
    gen_head = {}
    for n, key in enumerate(UI_KEYS):
        msg, scale = GEN_MSG[key]
        expr = "expr 1024 * pow(2\\, $f1)" if key == "size" else None
        gen_head[key] = sc.wire_param(boxes, lines, key, msg, scale or 1.0, f"set_{key}", y=600.0 + n * 26.0, size_expr=expr)

    # header strip: the direction arrows drive the Insert tab, and follow it (the control echo and rack peers)
    lines.append(line("obj-viz-top", 0, "obj-ctrl-dir"))
    boxes.append(newobj("obj-top-prep-dir", "prepend set_dir", 900, 20.0, 120))
    lines.append(line("obj-ctrl-dir", 0, "obj-top-prep-dir"))
    lines.append(line("obj-top-prep-dir", 0, "obj-viz-top"))

    # canvas edits -> route -> control (the control then drives gen and the face as usual)
    boxes.append(newobj("obj-route-canvas", "route " + " ".join(CANVAS_KEYS), 20, 560, 240, numoutlets=len(CANVAS_KEYS) + 1))
    lines.append(line("obj-viz", 0, "obj-route-canvas"))
    for i, key in enumerate(CANVAS_KEYS):
        lines.append(line("obj-route-canvas", i, f"obj-ctrl-{key}"))

    # rack peer values -> route -> `prepend set` (silent) into the control + into the same gen path the control uses
    boxes.append(newobj("obj-route-link", "route " + " ".join(LINKED), 20, 590, 320, numoutlets=len(LINKED) + 1))
    lines.append(line("obj-viz", 1, "obj-route-link"))
    for i, key in enumerate(LINKED):
        lset = f"obj-lset-{key}"
        boxes.append(newobj(lset, "prepend set", 300 + i * 20, 700, 80))
        lines.append(line("obj-route-link", i, lset))
        lines.append(line(lset, 0, f"obj-ctrl-{key}"))
        lines.append(line("obj-route-link", i, gen_head[key]))
        if key == "dir":
            lines.append(line("obj-route-link", i, "obj-top-prep-dir"))

    # resolved output selection -> gen
    lines.append(line("obj-viz", 2, "obj-gen", 0))

    # ---- background panels last ----
    boxes.append(sc.make_panel("obj-panel-left", 4, 4, 336, 161, border=(0.22, 0.26, 0.32)))
    boxes.append(sc.make_panel("obj-panel-right", 342, 4, 134, 161, border=(0.30, 0.26, 0.20)))

    return sc.patcher(
        boxes, lines, WIDTH,
        "Spectral sorter: divides the signal into up to 1024 frequency groups and deals them to four channels; use one instance per chain of an Audio Effect Rack",
        "Freq Split: Bitwig Freq Split (Spectral) style frequency sorter with linked rack instances",
        "frequency split spectral rack stft", LATENCY)


def main():
    doc = build_patcher()
    sc.write_amxd(doc, OUT_AMXD)
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make_spectral_rack.py"), "--amxd", OUT_AMXD,
                    "--name", "Freq Split", "--chains", "Red,Blue,Yellow,Magenta", "--out", OUT_ADG], check=True)


if __name__ == "__main__":
    main()
