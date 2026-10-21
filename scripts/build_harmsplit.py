#!/usr/bin/env python3
"""
Build devices/Harmonic Split.amxd and devices/Harmonic Split.adg (Bitwig Spectral Suite style harmonic splitter).

Three channels: 1 Nonharmonics (grey), 2 Harmonics A (orange), 3 Harmonics B (turquoise). Use the device as the FIRST device of
EVERY chain of an Audio Effect Rack, one chain per channel (the .adg preset does exactly that). Every instance runs the same
mask-STFT analysis (fundamental tracking + harmonic lobes) on the same input with linked parameters and outputs only its own
channel (Output = Auto: the chain index); the per-bin masks sum to exactly 1, so the chains sum back to the input delayed by
4096 samples ("latency": 4096).

Signal path: plugin~ -> gen.codebox~ (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr + src/harmsplit_core.genexpr)
-> plugout~. The v8ui face (src/harmsplit_config.js + src/spectral_link.js + src/harmsplit_ui.js) draws the spectrum, the tracked
fundamental and harmonics, hosts the draggable Low-cut / High-cut / Threshold handles and the Sensitivity slider, links the
parameters with the other instances in the rack and sends the resolved output selection.

Layout (440 x 169): v8ui canvas x=6..290, y=6..140 (Bitwig display: Low / High on the top row, Tilt / Threshold on the bottom row,
purple draggable L / H / Threshold lines); Harmonics (Pattern menu), NH Sens, Max Harm and Mix in the right column (x=300..432);
Size and Output under the canvas; Low / High / Tilt / Threshold are hidden automatable parameters edited by the display;
two background panels last.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from spectral_common import line, newobj, message

ROOT = sc.ROOT_DIR
SRC = os.path.join(ROOT, "src")
OUT_AMXD = os.path.join(sc.DEVICES_DIR, "Harmonic Split.amxd")
OUT_ADG = os.path.join(sc.DEVICES_DIR, "Harmonic Split.adg")
WIDTH = 440.0
LATENCY = 4096
SCOPE_SAMPS = 544

ORG = sc.ORANGE
TQ = sc.TURQUOISE
GR = sc.GREY
RD = sc.RED

# key: (long name, short name, min, max, initial, ptype, unitstyle)   (mirrors HS_PARAMS in src/harmsplit_config.js)
NUM = {
    "maxh": ("Maximum Harmonics", "Max Harm", 0.0, 404.0, 0.0, 0, 0),
    "sens": ("Nonharmonic Sensitivity", "NH Sens", 1.0, 100.0, 50.0, 0, 5),
    "tilt": ("Tilt", "Tilt", -12.0, 12.0, 0.0, 0, 4),
    "thr": ("Detection Threshold", "Threshold", -120.0, 0.0, -120.0, 0, 4),
    "lowcut": ("Detection Low-cut Frequency", "Low Cut", 19.4, 19900.0, 80.0, 0, 3),
    "highcut": ("Detection High-cut Frequency", "High Cut", 19.4, 19900.0, 1500.0, 0, 3),
    "mix": ("Mix", "Mix", 0.0, 100.0, 100.0, 0, 5),
}
NUM_HELP = {
    "maxh": "Maximum Harmonics: limits the number of harmonic peaks tracked; harmonics above it go to Nonharmonics. 0 = Off (no limit, up to 404).",
    "sens": "Nonharmonic Sensitivity: a relative threshold for the Nonharmonics channel. Lower values put more signal in Nonharmonics (less in the harmonic channels), higher values the opposite.",
    "tilt": "Tilt: tilts the spectrum for the fundamental detection, favouring the high end at positive settings and the low end at negative ones (dB per decade around 1 kHz). Analysis only, the audio is not affected.",
    "thr": "Detection Threshold: level the loudest partial must reach for harmonics to be detected. At the minimum (-120 dB) it reads Automatic: the threshold follows the running level (40 dB below it, never below -100 dB).",
    "lowcut": "Detection Low-cut Frequency: cutoff below which the analysis is attenuated (soft 4th-order filter, only for the fundamental detection, not a hard limit on what is sorted).",
    "highcut": "Detection High-cut Frequency: cutoff above which the analysis is attenuated (soft 4th-order filter, only for the fundamental detection).",
    "mix": "Mix: crossfades this channel with the dry input. In a rack, every chain carries its share (1/3) of the dry signal, so the rack sum is Mix * wet + (1 - Mix) * dry.",
}
PATTERN_ENUM = ["1st only"] + [f"Every {i}{'th' if 11 <= i % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(i % 10, 'th')}" for i in range(2, 25)]
# key: (long name, short name, values, initial)
ENUM = {
    "pattern": ("Harmonics Pattern", "Pattern", PATTERN_ENUM, 1),
    "size": ("Size", "Size", ["1k", "2k", "4k"], 1),
    "output": ("Output", "Output", ["Auto", "Nonharm", "Harm A", "Harm B", "All"], 0),
}
ENUM_HELP = {
    "pattern": "Harmonics Pattern (1..24): which harmonics go to Harmonics A. Every 2nd sends harmonics 1, 3, 5... to A and 2, 4, 6... to B; Every Nth sends 1, N+1, 2N+1... to A. 1st only is special: just the fundamental goes to A, all other harmonics to B.",
    "size": "Analysis block size: larger sizes separate close harmonics better but smear time. The latency stays 4096 samples at every size.",
    "output": "Output: Auto uses this chain's index in the parent Rack (1 Nonharmonics, 2 Harmonics A, 3 Harmonics B; outside a Rack the sum of all), or pick a channel, or All.",
}
# key: (gen message, scale)
GEN_MSG = {
    "pattern": ("hpat", 1.0),
    "maxh": ("hmaxp", 1.0),
    "sens": ("sensamt", 1.0),
    "tilt": ("tiltamt", 1.0),
    "thr": ("thrdb", 1.0),
    "lowcut": ("flocut", 1.0),
    "highcut": ("fhicut", 1.0),
    "mix": ("wetamt", 0.01),
    "size": ("fftn", None),
    "output": (None, 1.0),
}
GEN_EXPR = {
    "size": "expr 1024 * pow(2\\, $f1)",
    "pattern": "expr $f1 + 1",                  # menu index 0..23 -> Pattern 1..24
    "sens": "expr ($f1 - 1.) / 99.",            # 1..100 % -> 0..1
}
LINKED = ["pattern", "maxh", "sens", "tilt", "thr", "lowcut", "highcut", "mix", "size"]
CANVAS_KEYS = ["lowcut", "highcut", "tilt", "thr", "dispost"]       # edited from the canvas -> route -> control
UI_KEYS = ["pattern", "maxh", "sens", "tilt", "thr", "lowcut", "highcut", "mix", "size", "output"]
HIDDEN_KEYS = ["lowcut", "highcut", "tilt", "thr"]                   # drawn and edited by the canvas, no widget on the face


def build_patcher():
    gen = sc.gen_code(os.path.join(SRC, "cepstrum_lib.genexpr"), os.path.join(SRC, "spectral_split_lib.genexpr"),
                      os.path.join(SRC, "harmsplit_core.genexpr"))
    face = (sc.read(os.path.join(SRC, "harmsplit_config.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_link.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "harmsplit_ui.js")))

    boxes = []
    lines = []

    # ---- controls (presentation) ----
    boxes.append(sc.make_label("obj-lbl-pattern", "Harmonics", 300, 11, 52, 13, size=8.0, color=ORG))
    boxes.append(sc.make_menu("pattern", ENUM["pattern"], ENUM_HELP["pattern"], 352, 10, 80, 15, ORG, 8.5))
    for i, (key, text, color) in enumerate([("sens", "NH Sens", GR), ("maxh", "Max Harm", TQ), ("mix", "Mix", sc.TEXT)]):
        y = 30 + i * 20
        boxes.append(sc.make_label(f"obj-lbl-{key}", text, 300, y + 1, 52, 13, size=8.0, color=color))
        boxes.append(sc.make_numbox(key, NUM[key], NUM_HELP[key], 352, y, 80, 15, color, 2, 8.5))
    # Low / High / Tilt / Threshold: automatable parameters drawn and edited by the display (hidden from the face)
    for i, key in enumerate(HIDDEN_KEYS):
        b = sc.make_numbox(key, NUM[key], NUM_HELP[key], 20 + i * 100, 0, 80, 15, sc.TEXT, 3 if key == "tilt" else 2, 8.5)
        b["box"]["presentation"] = 0
        b["box"].pop("presentation_rect", None)
        if key in ("lowcut", "highcut"):
            b["box"]["saved_attribute_attributes"]["valueof"]["parameter_exponent"] = 3.0
        boxes.append(b)

    boxes.append(sc.make_label("obj-lbl-size", "Size", 8, 147, 28, 13, color=sc.DIM))
    boxes.append(sc.make_tab("size", ENUM["size"], ENUM_HELP["size"], 38, 146, 96, 15, sc.DIM))
    boxes.append(sc.make_label("obj-lbl-output", "Output", 146, 147, 44, 13, color=sc.TEXT))
    boxes.append(sc.make_menu("output", ENUM["output"], ENUM_HELP["output"], 190, 146, 100, 15, sc.TEXT))

    boxes.append(sc.make_label("obj-leg-1", "1  NONHARMONICS", 304, 106, 124, 13, size=8.0, color=GR))
    boxes.append(sc.make_label("obj-leg-2", "2  HARMONICS A", 304, 120, 124, 13, size=8.0, color=ORG))
    boxes.append(sc.make_label("obj-leg-3", "3  HARMONICS B", 304, 134, 124, 13, size=8.0, color=TQ))
    boxes.append(sc.make_label("obj-leg-lat", "Latency 4096 smp", 304, 148, 124, 12, size=7.0, color=sc.DIM, bold=False))

    # ---- display (the only v8ui) ----
    boxes.append(sc.v8ui("obj-viz", face, [6.0, 6.0, 284.0, 134.0], (20.0, 80.0), 3, "HarmsplitView"))

    # ---- audio ----
    boxes += [
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.gen_box("obj-gen", gen, "harmsplit"),
        # `---` is unique per device instance in M4L (`#0` is not expanded in a top-level device in Live)
        newobj("obj-scope-buf", f"buffer~ ---harmsplitscope @samps {SCOPE_SAMPS}", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 285, 60, outlettype=["bang"]),
        message("obj-msg-ui-buf", "setbuffer ---harmsplitscope", 560, 315, 190),
        message("obj-msg-gen-buf", "scope ---harmsplitscope", 560, 345, 170),
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

    # ---- hidden UI-state toggle (saved with the Set) ----
    boxes.append(sc.make_state_toggle("dispost", "Display Post", "Post", ["Pre", "Post"], 20.0))
    uip = "obj-ui-dispost"
    boxes.append(newobj(uip, "prepend set_dispost", 900, 20.0, 120))
    lines.append(line("obj-ctrl-dispost", 0, uip))
    lines.append(line(uip, 0, "obj-viz"))

    # ---- parameter wiring: control -> gen, control -> face ----
    gen_head = {}
    for n, key in enumerate(UI_KEYS):
        msg, scale = GEN_MSG[key]
        expr = GEN_EXPR.get(key)
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
    boxes.append(sc.make_panel("obj-panel-right", 296, 4, 140, 161, border=(0.32, 0.25, 0.20)))

    return sc.patcher(
        boxes, lines, WIDTH,
        "Splits audio into Nonharmonics, Harmonics A and Harmonics B with a per-bin spectral mask around the tracked fundamental; use one instance per chain of an Audio Effect Rack",
        "Harmonic Split: Nonharmonics, Harmonics A and Harmonics B channels (Bitwig Spectral Suite style) with linked rack instances",
        "harmonic split spectral rack stft pitch", LATENCY)


def main():
    doc = build_patcher()
    sc.write_amxd(doc, OUT_AMXD)
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make_spectral_rack.py"), "--amxd", OUT_AMXD,
                    "--name", "Harmonic Split", "--chains", "Nonharmonics,Harmonics A,Harmonics B", "--out", OUT_ADG], check=True)


if __name__ == "__main__":
    main()
