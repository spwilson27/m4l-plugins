#!/usr/bin/env python3
"""
Build devices/Harmonic Split.amxd and devices/Harmonic Split.adg (harmonic splitter, Ableton-native look).

Three channels: 1 Nonharmonics (grey), 2 Harmonics A (orange), 3 Harmonics B (turquoise). Use the device as the FIRST device of
EVERY chain of an Audio Effect Rack, one chain per channel (the .adg preset does exactly that). Every instance runs the same
mask-STFT analysis (fundamental tracking + harmonic lobes) on the same input with linked parameters and outputs only its own
channel (Output = Auto: the chain index); the per-bin masks sum to exactly 1, so the chains sum back to the input delayed by
5120 samples ("latency": 5120).

Signal path: plugin~ -> gen~ -> plugout~, where the gen~ is NOT in the saved device: the face creates it after load from the embedded
gen patch (src/spectral_dsp.js, AGENTS.md 1d; gen code = cepstrum_lib + spectral_split_lib + spectral_split_rack + the expanded
src/harmsplit_core.genexpr with the rack template src/spectral_split_rack_main.genexpr). Every gen-bound message goes into the ss_genin
hub (gate 1 1). The v8ui face (src/harmsplit_config.js + src/spectral_link.js + src/spectral_theme.js + src/spectral_dsp.js + src/harmsplit_ui.js)
draws the spectrum, the tracked fundamental and harmonics, hosts the draggable Low-cut / High-cut / Threshold handles and the Sensitivity
slider, links the parameters with the other instances in the rack, elects the rack's leader (one instance analyses, the others read their
channel from its ring) and sends the gen its output selection, role and buffer names.

Layout (440 x 169, Ableton-native, Reverb-like flat titled sections on the Live theme): `Detection` section (x=4..292) with the v8ui
canvas x=8..288, y=20..161 (LCD spectrum with faint grid, thin 1 px lines, hollow L / H / Threshold handles, channel legend, Low /
High / Tilt / Threshold values); `Harmonics` section (Pattern menu, NH Sens, Max Harm, Mix) and `Output` section (Output menu, Size
tab) in the right column (x=296..436). Low / High / Tilt / Threshold are hidden automatable parameters edited by the display. All
colours are Live theme colours (src/spectral_theme.js, spectral_common.make_*); the section panels and the body panel are the last
boxes.
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
LATENCY = sc.RACK_LATENCY      # 5120: 4096 + the host block margin the leader / follower exchange needs
RING_SAMPS = sc.rack_ring_samps(3)
ZERO_COUNT = 528               # sleep zeroes the arrays and the device slots (telemetry 0..527); the rack scalars start at 528
SCOPE_SAMPS = 560

ORG = sc.ORANGE
TQ = sc.TURQUOISE
GR = sc.GREY
RD = sc.RED

# key: (long name, short name, min, max, initial, ptype, unitstyle)   (mirrors HS_PARAMS in src/harmsplit_config.js)
NUM = {
    "maxh": ("Maximum Harmonics", "Max Harm", 0.0, 404.0, 0.0, 0, 0),
    "sens": ("Nonharmonic Sensitivity", "NH Sens", 1.0, 100.0, 50.0, 0, 5),
    "tilt": ("Tilt", "Tilt", -12.0, 12.0, 0.0, 0, 4),
    "thr": ("Detection Threshold", "Threshold", -120.0, 0.0, -120.0, 0,9),
    "lowcut": ("Detection Low-cut Frequency", "Low Cut", 19.4, 19900.0, 80.0, 0, 3),
    "highcut": ("Detection High-cut Frequency", "High Cut", 19.4, 19900.0, 1500.0, 0, 3),
    "mix": ("Mix", "Mix", 0.0, 100.0, 100.0, 0, 5),
}
# custom units: Live shows -inf at about -70 dB with unitstyle 4, but Threshold goes down to -120 dB (Automatic)
NUM_UNITS = {"thr": "%.1f dB"}
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
    "size": "Analysis block size: larger sizes separate close harmonics better but smear time. The latency stays 5120 samples at every size.",
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
    "mix": ("mixamt", 0.01),
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


def gen_code():
    """The gen code of the device (what the face writes to the .gendsp file)."""
    subs = sc.rack_subs(3, "hsd", 0, 528, ZERO_COUNT)
    return sc.gen_code_rack(os.path.join(SRC, "harmsplit_core.genexpr"), subs)


def face_code(gen):
    """The v8ui script: deferred-DSP constants, config, link, theme, deferred DSP, face."""
    header, _ = sc.deferred_header("harmsplit", gen)
    return (header + "\n"
            + sc.read(os.path.join(SRC, "harmsplit_config.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_link.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_theme.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_dsp.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "harmsplit_ui.js")))


def build_patcher():
    gen = gen_code()
    face = face_code(gen)

    boxes = []
    lines = []

    # ---- controls (presentation): Reverb-style titled sections, theme-bound native live.* controls ----
    RX, RW = 302, 128           # right column: label x, label + control width
    CX, CW = 360, 70            # control x / width inside the right sections
    boxes.append(sc.make_theme_comment("obj-lbl-pattern", "Pattern", RX, 22, 56))
    boxes.append(sc.make_theme_menu("pattern", ENUM["pattern"], ENUM_HELP["pattern"], CX, 21, CW, 15))
    for i, key in enumerate(["sens", "maxh", "mix"]):
        y = 41 + i * 18
        text = {"sens": "NH Sens", "maxh": "Max Harm", "mix": "Mix"}[key]
        boxes.append(sc.make_theme_comment(f"obj-lbl-{key}", text, RX, y + 1, 56))
        boxes.append(sc.make_lcd_numbox(key, NUM[key], NUM_HELP[key], CX, y, CW, 15))
    # Low / High / Tilt / Threshold: automatable parameters drawn and edited by the display (hidden from the face)
    for i, key in enumerate(HIDDEN_KEYS):
        b = sc.make_numbox(key, NUM[key], NUM_HELP[key], 20 + i * 100, 0, 80, 15, sc.TEXT, 3 if key == "tilt" else 2, 8.5, NUM_UNITS.get(key))
        b["box"]["presentation"] = 0
        b["box"].pop("presentation_rect", None)
        if key in ("lowcut", "highcut"):
            b["box"]["saved_attribute_attributes"]["valueof"]["parameter_exponent"] = 3.0
        boxes.append(b)

    boxes.append(sc.make_theme_comment("obj-lbl-output", "Output", RX, 119, 56))
    boxes.append(sc.make_theme_menu("output", ENUM["output"], ENUM_HELP["output"], CX, 118, CW, 15))
    boxes.append(sc.make_theme_comment("obj-lbl-size", "Size", RX, 136, 56))
    boxes.append(sc.make_theme_tab("size", ENUM["size"], ENUM_HELP["size"], CX, 135, CW, 15))
    boxes.append(sc.make_theme_comment("obj-leg-lat", f"Latency {LATENCY} smp", RX, 152, 124, 12, size=8.5, name="live_display_scale_text"))

    # section titles + hairlines (the section panels themselves go last)
    p_det, parts_det = sc.make_section("det", 4, 4, 288, 161, "Detection")
    p_harm, parts_harm = sc.make_section("harm", 296, 4, 140, 92, "Harmonics")
    p_out, parts_out = sc.make_section("out", 296, 100, 140, 65, "Output")
    for parts in (parts_det, parts_harm, parts_out):
        boxes += parts

    # ---- display (the only v8ui) ----
    boxes.append(sc.v8ui("obj-viz", face, [8.0, 20.0, 280.0, 141.0], (20.0, 80.0), 3, "HarmsplitView"))

    # ---- audio ----
    # The device ships WITHOUT its gen~ (AGENTS.md 1d): plugin~ / plugout~ and the hub carry scripting names, the face creates the gen~ after
    # load and wires hub -> gen, plugin~ -> gen -> plugout~ (src/spectral_dsp.js). Every cord that goes to the gen's inlet 0 goes into the hub.
    def named(b, var):
        b["box"]["varname"] = var
        return b

    boxes += [
        named(newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "ss_plugin"),
        named(newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "ss_plugout"),
        named(newobj("obj-genin", "gate 1 1", 120, 280, 60, numinlets=2, numoutlets=1), "ss_genin"),
        # `---` is unique per device instance in M4L (`#0` is not expanded in a top-level device in Live)
        newobj("obj-scope-buf", f"buffer~ ---harmsplitscope @samps {SCOPE_SAMPS}", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-ring-buf", f"buffer~ ---ssring @samps {RING_SAMPS}", 560, 275, 280, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 305, 60, outlettype=["bang"]),
        message("obj-msg-ui-names", "setnames ---harmsplitscope ---ssring", 560, 335, 250),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init", "init_link", 780, 430, 70),
        newobj("obj-r-sstest", "r #0-sstest", 780, 460, 90, numinlets=0, numoutlets=1),   # test hook (scripts/test_spectral_sum_live.js)
    ]
    lines += [
        line("obj-loadbang", 0, "obj-msg-ui-names"), line("obj-msg-ui-names", 0, "obj-viz"),
        line("obj-thisdevice", 0, "obj-msg-init"), line("obj-msg-init", 0, "obj-viz"),
        line("obj-r-sstest", 0, "obj-viz"),
    ]

    # ---- hidden UI-state toggle (saved with the Set) ----
    boxes.append(sc.make_state_toggle("dispost", "Display Post", "Post", ["Pre", "Post"], 20.0,
                                      "Spectrum source. Pre shows the analysis. Post shows this channel after the harmonic mask."))
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

    # gen-bound messages of the face (outsel, buffer names, rack role, parameter re-sends) -> hub
    lines.append(line("obj-viz", 2, "obj-gen", 0))
    sc.to_gen_hub(lines, "obj-genin", "obj-gen")

    # ---- background panels last: section panels, then the body (Max draws earlier boxes over later ones) ----
    boxes += [p_det, p_harm, p_out, sc.make_body_panel(WIDTH)]

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
