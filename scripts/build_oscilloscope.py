#!/usr/bin/env python3
"""Build devices/Oscilloscope.amxd (460 x 169 px) and devices/Analyzer.amxd.

Pass-through stereo oscilloscope: plugin~ is wired straight to plugout~ at build time, so sound is
never held for the gen compile. The face creates the tap gen~ after the first paint (src/analyzer_dsp.js).

Features:
  - EQ-Eight style Mode selection box (`Stereo`, `L / R`, `M / S`) + `Ch` toggle button (`L/R`, `L`, `R`, `M/S`, `M`, `S`)
  - Single `Layout` toggle button (`Overlay` / `Split`)
  - `Window` selection box (`1 Cyc`, `2 Cyc`, `4 Cyc`, `8 Cyc`, `5 ms`, `20 ms`, `50 ms`)
  - Stabilized NSDF pitch tracker with temporal hysteresis, harmonic lock, and 36-frame hold
  - Continuous `Refresh Rate` slider (`10..60 Hz`)
  - Continuous `Gain Scale` slider (`-18..+24 dB`) with `Auto` normalize toggle (normalizes peak to unity first, then applies Gain Scale)
"""

import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_OSC = os.path.join(ROOT, "devices", "Oscilloscope.amxd")
OUT_ANA = os.path.join(ROOT, "devices", "Analyzer.amxd")
WIDTH = 460.0


def read(name):
    with open(os.path.join(ROOT, name), "r", encoding="utf-8") as f:
        return f.read()


def build_oscilloscope(out_path, routing_mode=0, edit_sub=0, view_mode=0, cycle_mode=1, auto_gain=0, gain_db=0.0, open_menu=""):
    gen = sc.gendsp_json(read("src/analyzer_core.genexpr"))
    gen_hash = hashlib.sha1(gen.encode("utf-8")).hexdigest()[:12]
    gen_vars = "var GEN_DSP_TEXT = %s;\nvar GEN_DSP_HASH = %s;\n" % (json.dumps(gen), json.dumps(gen_hash))
    ui_src = read("src/oscilloscope_ui.js")
    if routing_mode != 0 or edit_sub != 0 or view_mode != 0 or cycle_mode != 1 or auto_gain != 0 or gain_db != 0.0 or open_menu:
        override = (
            "\noscRoutingMode = %d;\noscEditSub = %d;\noscChMode = oscResolveRouting(oscRoutingMode, oscEditSub).chMode;\n"
            "oscViewMode = %d;\noscCycleMode = %d;\noscAutoGain = %d;\noscGainDb = %s;\noscOpenMenu = %s;\noscDemoReady = 0;\n"
            % (int(routing_mode), int(edit_sub), int(view_mode), int(cycle_mode), int(auto_gain), repr(float(gain_db)), json.dumps(open_menu))
        )
        ui_src = ui_src.rstrip() + override

    code = "\n".join([
        read("src/oscilloscope_config.js").rstrip(),
        read("src/spectral_theme.js").rstrip(),
        gen_vars.rstrip(),
        read("src/analyzer_dsp.js").rstrip(),
        ui_src.rstrip(),
        "",
    ])

    boxes = [
        sc.newobj("obj-plugin", "plugin~", 40, 40, 70, numinlets=1, numoutlets=2, outlettype=["signal", "signal"]),
        sc.newobj("obj-plugout", "plugout~", 40, 220, 70, numinlets=2, numoutlets=0),
        sc.newobj("obj-gen-in", "gate 1 1", 160, 40, 70, numinlets=2, numoutlets=1, outlettype=[""]),
        sc.newobj("obj-buf", "buffer~ #0-analyzerscope @samps 17952", 280, 40, 250, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        sc.newobj("obj-loadbang", "loadbang", 160, 80, 70, numoutlets=1, outlettype=["bang"]),
        sc.newobj("obj-thisdevice", "live.thisdevice", 280, 80, 100, numoutlets=1, outlettype=["bang"]),
        sc.newobj("obj-freebang", "freebang", 420, 80, 70, numoutlets=1, outlettype=["bang"]),
        sc.message("obj-msg-scope", "scope #0-analyzerscope", 160, 120, 160),
        sc.message("obj-msg-setbuf", "setbuffer #0-analyzerscope", 340, 120, 180),
        sc.message("obj-msg-init", "loadbang", 540, 120, 70),
        sc.message("obj-msg-dsp", "init_dsp", 540, 150, 70),
        sc.message("obj-msg-free", "notifydeleted", 630, 120, 90),
    ]
    viz = sc.v8ui("obj-viz", code, [0, 0, WIDTH, 169], [40, 280], 2, varname="AnalyzerViz")
    viz["box"]["border"] = 0
    viz["box"]["parameter_enable"] = 1
    viz["box"]["saved_attribute_attributes"] = {
        "valueof": {
            "parameter_initial": [5, int(routing_mode), int(edit_sub), int(view_mode), int(cycle_mode), 30, float(gain_db), int(auto_gain), 0.0],
            "parameter_initial_enable": 1,
            "parameter_invisible": 1,
            "parameter_longname": "AnalyzerState",
            "parameter_shortname": "AnalyzerState",
            "parameter_type": 3,
        }
    }
    boxes.append(viz)
    boxes.append(sc.make_body_panel(WIDTH))

    names = {"obj-plugin": "an_plugin", "obj-plugout": "an_plugout", "obj-gen-in": "an_genin"}
    for item in boxes:
        box = item["box"]
        if box.get("id") in names:
            box["varname"] = names[box["id"]]

    lines = [
        sc.line("obj-plugin", 0, "obj-plugout", 0),
        sc.line("obj-plugin", 1, "obj-plugout", 1),
        sc.line("obj-loadbang", 0, "obj-msg-scope", 0),
        sc.line("obj-loadbang", 0, "obj-msg-setbuf", 0),
        sc.line("obj-loadbang", 0, "obj-msg-init", 0),
        sc.line("obj-thisdevice", 0, "obj-msg-scope", 0),
        sc.line("obj-thisdevice", 0, "obj-msg-setbuf", 0),
        sc.line("obj-thisdevice", 0, "obj-msg-init", 0),
        sc.line("obj-thisdevice", 0, "obj-msg-dsp", 0),
        sc.line("obj-msg-scope", 0, "obj-gen-in", 1),
        sc.line("obj-msg-setbuf", 0, "obj-viz", 0),
        sc.line("obj-msg-init", 0, "obj-viz", 0),
        sc.line("obj-msg-dsp", 0, "obj-viz", 0),
        sc.line("obj-freebang", 0, "obj-msg-free", 0),
        sc.line("obj-msg-free", 0, "obj-viz", 0),
        sc.line("obj-viz", 0, "obj-thisdevice", 0),
        sc.line("obj-viz", 1, "obj-gen-in", 1),
    ]

    doc = sc.patcher(
        boxes,
        lines,
        WIDTH,
        "Pass-through dual-channel L/R & Mid/Side single-cycle and multi-cycle oscilloscope.",
        "Oscilloscope",
        "audio analysis oscilloscope",
        0,
    )
    sc.write_amxd(doc, out_path)
    return gen_hash


def main():
    parser = argparse.ArgumentParser(description="Build Oscilloscope.amxd (and Analyzer.amxd).")
    parser.add_argument("--routing", type=int, default=0, help="Initial routing mode (0=Stereo, 1=L/R, 2=M/S)")
    parser.add_argument("--sub", type=int, default=0, help="Initial editSub channel toggle (0, 1, 2)")
    parser.add_argument("--view", type=int, default=0, help="Initial view mode (0=Overlay, 1=Split)")
    parser.add_argument("--cycle", type=int, default=1, help="Initial cycle mode (0=1 Cyc, 1=2 Cyc, ..., 5=20 ms)")
    parser.add_argument("--autogain", type=int, default=0, help="Initial Auto Normalize (0 or 1)")
    parser.add_argument("--gain", type=float, default=0.0, help="Initial Gain Scale dB (-18..+24)")
    parser.add_argument("--menu", type=str, default="", help="Open popup menu for preview ('mode' or 'window')")
    parser.add_argument("--out", type=str, default=None, help="Custom output .amxd path")
    args = parser.parse_args()

    if args.out:
        gen_hash = build_oscilloscope(args.out, args.routing, args.sub, args.view, args.cycle, args.autogain, args.gain, args.menu)
        print("Built %s (gen %s)" % (args.out, gen_hash))
        return

    gen_hash = build_oscilloscope(OUT_OSC, args.routing, args.sub, args.view, args.cycle, args.autogain, args.gain, args.menu)
    print("Oscilloscope built (gen %s, %d x 169 px)" % (gen_hash, int(WIDTH)))


if __name__ == "__main__":
    main()
