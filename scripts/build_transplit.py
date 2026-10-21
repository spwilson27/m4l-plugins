#!/usr/bin/env python3
"""
Build devices/Transient Split.amxd and devices/Transient Split.adg (Bitwig Spectral Suite style transient splitter).

Two channels: 1 Transients (yellow), 2 Tones (blue). Use the device as the FIRST device of EVERY chain of an Audio
Effect Rack, one chain per channel (the .adg preset does exactly that). Every instance runs the same mask-STFT analysis
on the same input with linked parameters and outputs only its own channel (Output = Auto: the chain index); the per-bin
masks sum to exactly 1, so the chains sum back to the input delayed by 4096 samples ("latency": 4096).

Signal path: plugin~ -> gen.codebox~ (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr + src/transplit_core.genexpr)
-> plugout~. The v8ui face (src/transplit_config.js + src/spectral_link.js + src/transplit_ui.js) draws the spectrum, hosts the
Bias slider / Tilt grip, links the parameters with the other instances in the rack and sends the resolved output selection.

Layout (440 x 169): v8ui canvas x=6..290, y=6..118; Tilt / Decay / Smoothing / Bias / Blend / Mix value bars in the right column
(x=300..432); Type, Tilt Mode, Size and Output controls under the canvas; two background panels last.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from spectral_common import line, newobj, message

ROOT = sc.ROOT_DIR
SRC = os.path.join(ROOT, "src")
OUT_AMXD = os.path.join(sc.DEVICES_DIR, "Transient Split.amxd")
OUT_ADG = os.path.join(sc.DEVICES_DIR, "Transient Split.adg")
WIDTH = 440.0
LATENCY = 4096

YEL = sc.YELLOW
BLU = sc.BLUE

# key: (long name, short name, min, max, initial, ptype, unitstyle[, units])
NUM = {
    "bias": ("Analysis Bias", "Bias", -100.0, 100.0, 0.0, 0, 5),
    "tdecay": ("Transients Decay", "Decay", 1.0, 125.0, 8.0, 0, 9),
    "tsmooth": ("Tones Smoothing", "Smoothing", 1.0, 64.0, 1.5, 0, 9),
    "tilt": ("Tilt Amount", "Tilt", -100.0, 100.0, 0.0, 0, 5),
    "blend": ("Transients Tones Blend", "Blend", 0.0, 100.0, 50.0, 0, 5),
    "mix": ("Mix", "Mix", 0.0, 100.0, 100.0, 0, 5),
}
NUM_HELP = {
    "bias": "Analysis Bias: positive values classify more of the signal as transients, negative values as tones.",
    "tdecay": "Transients Decay (1.00 to 125.00 blocks): release time that holds detected transients out a bit longer.",
    "tsmooth": "Tones Smoothing (1.00 to 64.00 blocks): keeps identified tones in the Tones channel as they decay.",
    "tilt": "Tilt Amount: tilts the Transients channel by up to 12 dB across frequency (positive favours highs, negative lows, set by Tilt Mode) and the Tones channel the opposite way.",
    "blend": "Transients/Tones Blend: audio balance between the two channels. 50 % is equal balance (reconstructs the original), 100 % only the transient portions, 0 % only the tone portions.",
    "mix": "Mix: dry/wet of the whole split. Each chain adds its dry share divided by the chain count, so the rack sums to mix * wet + (1 - mix) * dry (the dry share passes through each chain's devices).",
}
NUM_UNITS = {"tdecay": "%.2f", "tsmooth": "%.2f"}
# key: (long name, short name, values, initial)
ENUM = {
    "ttype": ("Transient Type", "Type", ["Percussive", "Noise"], 0),
    "tmode": ("Tilt Mode", "Tilt Mode", ["Standard", "Contour"], 0),
    "size": ("Size", "Size", ["512", "1k", "2k", "4k"], 1),
    "output": ("Output", "Output", ["Auto", "Transients", "Tones", "All"], 0),
}
ENUM_HELP = {
    "ttype": "Transient Type: Percussive detects per-bin impacts (sudden rises), Noise sends noisy, phase-unstable content (smears, reverb tails) to the Transients channel.",
    "tmode": "Tilt Mode: Standard tilts highs against lows, Contour tilts the mids against the highs and lows.",
    "size": "Analysis block size: 512 and 1k favour time resolution, 2k and 4k frequency resolution. The latency stays 4096 samples at every size.",
    "output": "Output: Auto uses this chain's index in the parent Rack (1 Transients, 2 Tones; outside a Rack the sum of all), or pick a channel, or All.",
}
# key: (gen message, scale)
GEN_MSG = {
    "bias": ("anbias", 0.01),
    "tdecay": ("tdecay", 1.0),
    "tsmooth": ("tsmooth", 1.0),
    "tilt": ("tiltamt", 0.01),
    "blend": ("blendamt", 0.01),
    "mix": ("mixamt", 0.01),
    "ttype": ("ttype", 1.0),
    "tmode": ("tmode", 1.0),
    "size": ("fftn", None),
    "output": (None, 1.0),
}
LINKED = ["ttype", "bias", "tdecay", "tsmooth", "tilt", "tmode", "blend", "mix", "size"]
CANVAS_KEYS = ["bias", "tilt", "tdecay", "tsmooth", "blend", "dispost", "disstyle"]       # edited from the canvas -> route -> control
UI_KEYS = ["ttype", "bias", "tdecay", "tsmooth", "tilt", "tmode", "blend", "mix", "size", "output"]


def build_patcher():
    gen = sc.gen_code(os.path.join(SRC, "cepstrum_lib.genexpr"), os.path.join(SRC, "spectral_split_lib.genexpr"),
                      os.path.join(SRC, "transplit_core.genexpr"))
    face = (sc.read(os.path.join(SRC, "transplit_config.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_link.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "transplit_ui.js")))

    boxes = []
    lines = []

    # ---- controls (presentation) ----
    rows = [("tilt", "Tilt", YEL), ("tdecay", "Decay", YEL), ("tsmooth", "Smoothing", BLU), ("bias", "Bias", sc.TEXT),
            ("blend", "Blend", sc.TEXT), ("mix", "Mix", sc.TEXT)]
    for i, (key, text, color) in enumerate(rows):
        y = 9 + i * 19
        boxes.append(sc.make_label(f"obj-lbl-{key}", text, 300, y + 1, 52, 13, size=8.0, color=color))
        app = 3 if key in ("bias", "tilt") else 2
        boxes.append(sc.make_numbox(key, NUM[key], NUM_HELP[key], 354, y, 78, 15, color, app, 8.5, NUM_UNITS.get(key)))

    boxes.append(sc.make_label("obj-lbl-ttype", "Type", 8, 125, 28, 13, color=YEL))
    boxes.append(sc.make_tab("ttype", ENUM["ttype"], ENUM_HELP["ttype"], 38, 124, 110, 15, YEL))
    boxes.append(sc.make_label("obj-lbl-tmode", "Tilt Mode", 154, 125, 44, 13, color=sc.TEXT))
    boxes.append(sc.make_tab("tmode", ENUM["tmode"], ENUM_HELP["tmode"], 198, 124, 92, 15, sc.TEXT))
    boxes.append(sc.make_label("obj-lbl-size", "Size", 8, 145, 28, 13, color=sc.DIM))
    boxes.append(sc.make_tab("size", ENUM["size"], ENUM_HELP["size"], 38, 144, 120, 15, sc.DIM))
    boxes.append(sc.make_label("obj-lbl-output", "Output", 168, 145, 44, 13, color=sc.TEXT))
    boxes.append(sc.make_menu("output", ENUM["output"], ENUM_HELP["output"], 214, 144, 76, 15, sc.TEXT))

    boxes.append(sc.make_label("obj-leg-lat", "Latency 4096 smp", 304, 147, 124, 12, size=7.0, color=sc.DIM, bold=False))

    # ---- display (the only v8ui) ----
    boxes.append(sc.v8ui("obj-viz", face, [6.0, 6.0, 284.0, 112.0], (20.0, 80.0), 3, "TransplitView"))

    # ---- audio ----
    boxes += [
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.gen_box("obj-gen", gen, "transplit"),
        # `---` is unique per device instance in M4L (`#0` is not expanded in a top-level device in Live)
        newobj("obj-scope-buf", "buffer~ ---transplitscope @samps 800", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 285, 60, outlettype=["bang"]),
        message("obj-msg-ui-buf", "setbuffer ---transplitscope", 560, 315, 190),
        message("obj-msg-gen-buf", "scope ---transplitscope", 560, 345, 170),
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
    boxes.append(sc.make_state_toggle("disstyle", "Display Style", "Style", ["Waveform", "Sonogram"], 50.0))
    for key in ("dispost", "disstyle"):
        uip = f"obj-ui-{key}"
        boxes.append(newobj(uip, f"prepend set_{key}", 900, 20.0 if key == "dispost" else 50.0, 120))
        lines.append(line(f"obj-ctrl-{key}", 0, uip))
        lines.append(line(uip, 0, "obj-viz"))

    # ---- parameter wiring: control -> gen, control -> face ----
    gen_head = {}
    for n, key in enumerate(UI_KEYS):
        msg, scale = GEN_MSG[key]
        expr = "expr 512 * pow(2\\, $f1)" if key == "size" else None
        gen_head[key] = sc.wire_param(boxes, lines, key, msg, scale or 1.0, f"set_{key}", y=600.0 + n * 26.0, size_expr=expr)

    # canvas edits -> route -> control (the control then drives gen and the face as usual)
    boxes.append(newobj("obj-route-canvas", "route " + " ".join(CANVAS_KEYS), 20, 560, 200, numoutlets=len(CANVAS_KEYS) + 1))
    lines.append(line("obj-viz", 0, "obj-route-canvas"))
    for i, key in enumerate(CANVAS_KEYS):
        lines.append(line("obj-route-canvas", i, f"obj-ctrl-{key}"))

    # rack peer values -> route -> `prepend set` (silent) into the control + into the same gen path the control uses
    boxes.append(newobj("obj-route-link", "route " + " ".join(LINKED), 20, 590, 260, numoutlets=len(LINKED) + 1))
    lines.append(line("obj-viz", 1, "obj-route-link"))
    for i, key in enumerate(LINKED):
        lset = f"obj-lset-{key}"
        boxes.append(newobj(lset, "prepend set", 300 + i * 20, 700 + i * 0, 80))
        lines.append(line("obj-route-link", i, lset))
        lines.append(line(lset, 0, f"obj-ctrl-{key}"))
        lines.append(line("obj-route-link", i, gen_head[key]))

    # resolved output selection -> gen
    lines.append(line("obj-viz", 2, "obj-gen", 0))

    # ---- background panels last ----
    boxes.append(sc.make_panel("obj-panel-left", 4, 4, 290, 161, border=(0.22, 0.26, 0.32)))
    boxes.append(sc.make_panel("obj-panel-right", 296, 4, 140, 161, border=(0.30, 0.26, 0.20)))

    return sc.patcher(
        boxes, lines, WIDTH,
        "Splits audio into Transients and Tones with a per-bin spectral mask; use one instance per chain of an Audio Effect Rack",
        "Transient Split: Transients and Tones channels (Bitwig Spectral Suite style) with linked rack instances",
        "transient tone split spectral rack stft", LATENCY)


def main():
    doc = build_patcher()
    sc.write_amxd(doc, OUT_AMXD)
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make_spectral_rack.py"), "--amxd", OUT_AMXD,
                    "--name", "Transient Split", "--chains", "Transients,Tones", "--out", OUT_ADG], check=True)


if __name__ == "__main__":
    main()
