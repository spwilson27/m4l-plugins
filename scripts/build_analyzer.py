#!/usr/bin/env python3
"""Build devices/Analyzer.amxd.

Pass-through audio effect: plugin~ is wired to plugout~ at build time, so sound is never
held for the gen compile. The face creates the tap gen~ after the first paint (src/analyzer_dsp.js).
Device width follows the open panels. `var AN_PREVIEW = N` in src/analyzer_ui.js (0 in the
shipping source) builds the still at that fold mask so a screenshot can show every panel.
"""

import hashlib
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "devices", "Analyzer.amxd")


def read(name):
    with open(os.path.join(ROOT, name), "r", encoding="utf-8") as f:
        return f.read()


def preview_mask():
    ui = read("src/analyzer_ui.js")
    found = re.search(r"var AN_PREVIEW = (\d+)", ui)
    if not found:
        raise SystemExit("src/analyzer_ui.js is missing `var AN_PREVIEW = N`")
    return int(found.group(1)) & 15


def fold_width(mask):
    out = subprocess.check_output(
        ["node", "-e", "const c=require('./src/analyzer_config'); process.stdout.write(String(c.anFoldWidth(%d)))" % mask],
        cwd=ROOT,
        text=True,
    )
    return float(out)


def main():
    mask = preview_mask()
    width = fold_width(mask if mask else 1)
    gen = sc.gendsp_json(read("src/analyzer_core.genexpr"))
    gen_hash = hashlib.sha1(gen.encode("utf-8")).hexdigest()[:12]
    gen_vars = "var GEN_DSP_TEXT = %s;\nvar GEN_DSP_HASH = %s;\n" % (json.dumps(gen), json.dumps(gen_hash))
    code = "\n".join([
        read("src/analyzer_config.js").rstrip(),
        read("src/spectral_theme.js").rstrip(),
        gen_vars.rstrip(),
        read("src/analyzer_dsp.js").rstrip(),
        read("src/analyzer_ui.js").rstrip(),
        "",
    ])

    boxes = [
        sc.newobj("obj-plugin", "plugin~", 40, 40, 70, numinlets=1, numoutlets=2, outlettype=["signal", "signal"]),
        sc.newobj("obj-plugout", "plugout~", 40, 220, 70, numinlets=2, numoutlets=0),
        sc.newobj("obj-gen-in", "gate 1 1", 160, 40, 70, numinlets=2, numoutlets=1, outlettype=[""]),
        sc.newobj("obj-buf", "buffer~ ---analyzerscope @samps 17952", 280, 40, 250, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        sc.newobj("obj-loadbang", "loadbang", 160, 80, 70, numoutlets=1, outlettype=["bang"]),
        sc.newobj("obj-thisdevice", "live.thisdevice", 280, 80, 100, numoutlets=1, outlettype=["bang"]),
        sc.newobj("obj-freebang", "freebang", 420, 80, 70, numoutlets=1, outlettype=["bang"]),
        sc.message("obj-msg-scope", "scope ---analyzerscope", 160, 120, 160),
        sc.message("obj-msg-setbuf", "setbuffer ---analyzerscope", 340, 120, 180),
        sc.message("obj-msg-init", "loadbang", 540, 120, 70),
        sc.message("obj-msg-dsp", "init_dsp", 540, 150, 70),
        sc.message("obj-msg-free", "notifydeleted", 630, 120, 90),
    ]
    viz = sc.v8ui("obj-viz", code, [0, 0, width, 169], [40, 280], 2, varname="AnalyzerViz")
    viz["box"]["border"] = 0
    viz["box"]["parameter_enable"] = 1
    viz["box"]["saved_attribute_attributes"] = {
        "valueof": {
            "parameter_initial": [1, 1, 123, 0, 0, 1, 0, 150, 1000, 6000],
            "parameter_initial_enable": 1,
            "parameter_invisible": 1,
            "parameter_longname": "AnalyzerState",
            "parameter_shortname": "AnalyzerState",
            "parameter_type": 3,
        }
    }
    boxes.append(viz)
    boxes.append(sc.make_body_panel(width))

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
        width,
        "Pass-through spectrum, oscilloscope, multiband stereo and loudness analyzer.",
        "Analyzer",
        "audio analysis",
        0,
    )
    sc.write_amxd(doc, OUT)
    print("gen %s  fold mask %d  width %.0f" % (gen_hash, mask, width))


if __name__ == "__main__":
    main()
