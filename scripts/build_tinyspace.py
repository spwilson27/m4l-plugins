#!/usr/bin/env python3
"""
Build devices/Tiny Space.amxd

Audio-effect reverb: a gen.codebox~ 20-line feedback delay network whose
seed (0–9999) picks density, delay times, and diffusion character.
Presentation is 700 x 169. The v8ui string field never overlaps a live.* control.
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Tiny Space.amxd")

DEVICE_W = 700.0
DEVICE_H = 169.0

# name, long, short, x, y, min, max, initial, unit, exponent, gen param, percent
DIALS = [
    ("size", "Size", "Size", 368.0, 40.0, 0.0, 100.0, 45.0, 5, 1.0, "size", True),
    ("damp", "Damp", "Damp", 434.0, 40.0, 0.0, 100.0, 20.0, 5, 1.0, "damp", True),
    ("width", "Width", "Width", 500.0, 40.0, 0.0, 100.0, 70.0, 5, 1.0, "width", True),
    ("mix", "Mix", "Mix", 566.0, 40.0, 0.0, 100.0, 35.0, 5, 1.0, "wet", True),
    ("feedback", "Feedback", "Feedback", 632.0, 40.0, 0.0, 100.0, 40.0, 5, 1.0, "fbk", True),
    ("predly", "PreDly", "PreDly", 368.0, 112.0, 0.0, 250.0, 0.0, 2, 1.0, "predly", False),
    ("mod", "Mod", "Mod", 434.0, 112.0, 0.0, 100.0, 15.0, 5, 1.0, "modamt", True),
    ("xfeed", "XFeed", "XFeed", 500.0, 112.0, 0.0, 100.0, 25.0, 5, 1.0, "xfeed", True),
    ("hp", "HP", "HP", 566.0, 112.0, 20.0, 4000.0, 40.0, 3, 2.0, "hp", False),
    ("lp", "LP", "LP", 632.0, 112.0, 400.0, 18000.0, 14000.0, 3, 2.0, "lp", False),
]

DIAL_HELP = {
    "size": "Scales every delay line. Low is a tight comb; high reaches about 100 ms.",
    "damp": "Lowpass in the feedback loop. Higher is darker.",
    "width": "Wet stereo width. 0% is mono, 100% is the full tank image.",
    "mix": "Equal-power dry/wet mix. Dry is the untouched input.",
    "feedback": "Loop gain. High values ring; the tank soft-clips instead of exploding.",
    "predly": "Wet-path pre-delay, up to 250 ms.",
    "mod": "Depth of the per-line delay wobble. Rates come from the seed.",
    "xfeed": "How much each side's tank feeds the other side.",
    "hp": "Highpass into the tank.",
    "lp": "Lowpass into the tank.",
}


def live_dial(spec, amber):
    name, long_name, short, x, y, lo, hi, initial, unit, exponent, _gen, _pct = spec
    valueof = {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": 0,
        "parameter_unitstyle": unit,
    }
    if exponent != 1.0:
        valueof["parameter_exponent"] = exponent
    color = [0.95, 0.62, 0.22, 1.0] if amber else [0.28, 0.8, 0.95, 1.0]
    return {
        "box": {
            "activedialcolor": color,
            "annotation": DIAL_HELP[name],
            "annotation_name": long_name,
            "id": f"obj-dial-{name}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [x, 220.0 + (0 if y < 80 else 70), 60.0, 48.0],
            "presentation": 1,
            "presentation_rect": [x, y, 60.0, 48.0],
            "saved_attribute_attributes": {"valueof": valueof},
            "varname": long_name,
        }
    }


def build():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    v8_code = config_js.rstrip() + "\n\n" + ui_js

    boxes = [
        {
            "box": {
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 12.0,
                "id": "obj-title",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [20.0, 20.0, 90.0, 18.0],
                "presentation": 1,
                "presentation_rect": [12.0, 7.0, 110.0, 16.0],
                "text": "Tiny Space",
                "textcolor": [0.9, 0.93, 0.96, 1.0],
            }
        },
        {
            "box": {
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.0,
                "id": "obj-seed-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [140.0, 20.0, 40.0, 18.0],
                "presentation": 1,
                "presentation_rect": [236.0, 8.0, 34.0, 14.0],
                "text": "Seed",
                "textcolor": [0.62, 0.7, 0.78, 1.0],
                "textjustification": 2,
            }
        },
        {
            "box": {
                "activebgcolor": [0.07, 0.09, 0.11, 1.0],
                "annotation": "Picks a deterministic delay-line configuration. The same seed always rebuilds the same space.",
                "annotation_name": "Seed",
                "id": "obj-seed",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "int"],
                "parameter_enable": 1,
                "patching_rect": [200.0, 18.0, 70.0, 18.0],
                "presentation": 1,
                "presentation_rect": [272.0, 6.0, 70.0, 16.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Seed",
                        "parameter_initial": [1],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Seed",
                        "parameter_mmax": 9999,
                        "parameter_mmin": 0,
                        "parameter_shortname": "Seed",
                        "parameter_type": 1,
                        "parameter_unitstyle": 0,
                    }
                },
                "textcolor": [0.45, 0.86, 0.95, 1.0],
                "varname": "Seed",
            }
        },
        {
            "box": {
                "border": 0,
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [20.0, 80.0, 344.0, 132.0],
                "presentation": 1,
                "presentation_rect": [10.0, 28.0, 344.0, 132.0],
                "textfile": {
                    "text": v8_code,
                    "filename": "none",
                    "flags": 0,
                    "embed": 1,
                    "autowatch": 1,
                },
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugin",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [20.0, 240.0, 52.0, 20.0],
                "text": "plugin~",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugout",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [20.0, 460.0, 58.0, 20.0],
                "text": "plugout~",
            }
        },
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [120.0, 300.0, 420.0, 140.0],
                "varname": "tinyspace",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-cfg",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [560.0, 240.0, 190.0, 20.0],
                "text": "buffer~ #0-tsconfig @samps 128",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-meters",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [560.0, 270.0, 190.0, 20.0],
                "text": "buffer~ #0-tsmeters @samps 32",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-loadbang",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [560.0, 180.0, 60.0, 20.0],
                "text": "loadbang",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-genbufs",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [640.0, 180.0, 280.0, 20.0],
                "text": "cfg #0-tsconfig, meters #0-tsmeters",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-uibufs",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [640.0, 210.0, 230.0, 20.0],
                "text": "setbuffer #0-tsconfig #0-tsmeters",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-seed",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [200.0, 48.0, 110.0, 20.0],
                "text": "prepend set_seed",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-duck-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [400.0, 80.0, 70.0, 20.0],
                "text": "0, 1 160",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-duck-line",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [400.0, 110.0, 40.0, 20.0],
                "text": "line",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-duck",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [460.0, 110.0, 80.0, 20.0],
                "text": "prepend duck",
            }
        },
    ]

    for spec in DIALS:
        amber = spec[4] > 80  # second row (y = 112) uses the amber dial color
        boxes.append(live_dial(spec, amber))
        if spec[11]:
            boxes.append({
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": f"obj-scale-{spec[0]}",
                    "maxclass": "newobj",
                    "numinlets": 2,
                    "numoutlets": 1,
                    "outlettype": ["float"],
                    "patching_rect": [spec[3], 300.0, 48.0, 20.0],
                    "text": "/ 100.",
                }
            })
        boxes.append({
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": f"obj-prep-{spec[0]}",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [spec[3], 340.0, 90.0, 20.0],
                "text": f"prepend {spec[10]}",
            }
        })

    # Panels must be last and flagged background so they sit behind the controls.
    # Without background: 1, Max draws them in front and the device looks empty.
    boxes.extend([
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.07, 0.08, 0.095, 1.0],
                "border": 1,
                "bordercolor": [0.14, 0.17, 0.2, 1.0],
                "id": "obj-panel-viz",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [20.0, 520.0, 80.0, 40.0],
                "presentation": 1,
                "presentation_rect": [6.0, 5.0, 350.0, 158.0],
                "proportion": 0.5,
                "rounded": 4,
            }
        },
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.1, 0.115, 0.135, 1.0],
                "border": 1,
                "bordercolor": [0.16, 0.19, 0.23, 1.0],
                "id": "obj-panel-dials",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [120.0, 520.0, 80.0, 40.0],
                "presentation": 1,
                "presentation_rect": [362.0, 5.0, 332.0, 158.0],
                "proportion": 0.5,
                "rounded": 4,
            }
        },
    ])

    lines = [
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}},
        {"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-genbufs", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-uibufs", 0]}},
        {"patchline": {"source": ["obj-msg-genbufs", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-msg-uibufs", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-seed", 0], "destination": ["obj-prep-seed", 0]}},
        {"patchline": {"source": ["obj-prep-seed", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-viz", 0], "destination": ["obj-duck-msg", 0]}},
        {"patchline": {"source": ["obj-duck-msg", 0], "destination": ["obj-duck-line", 0]}},
        {"patchline": {"source": ["obj-duck-line", 0], "destination": ["obj-prep-duck", 0]}},
        {"patchline": {"source": ["obj-prep-duck", 0], "destination": ["obj-gen", 0]}},
    ]
    for spec in DIALS:
        name = spec[0]
        if spec[11]:
            lines.append({"patchline": {"source": [f"obj-dial-{name}", 0], "destination": [f"obj-scale-{name}", 0]}})
            lines.append({"patchline": {"source": [f"obj-scale-{name}", 0], "destination": [f"obj-prep-{name}", 0]}})
        else:
            lines.append({"patchline": {"source": [f"obj-dial-{name}", 0], "destination": [f"obj-prep-{name}", 0]}})
        lines.append({"patchline": {"source": [f"obj-prep-{name}", 0], "destination": ["obj-gen", 0]}})

    parameters = {
        "obj-seed": ["Seed", "Seed", 0],
    }
    for spec in DIALS:
        parameters[f"obj-dial-{spec[0]}"] = [spec[1], spec[2], 0]
    parameters["parameterbanks"] = {
        "0": {
            "index": 0,
            "name": "",
            "parameters": ["Size", "Damp", "Width", "Mix", "Feedback", "PreDly", "Mod", "XFeed"],
        },
        "1": {
            "index": 1,
            "name": "",
            "parameters": ["HP", "LP", "Seed"],
        },
    }
    parameters["inherited_shortname"] = 1

    patcher_doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 5,
                "architecture": "x64",
                "modernui": 1,
            },
            "classnamespace": "box",
            "rect": [40.0, 60.0, 1100.0, 640.0],
            "openrect": [0.0, 0.0, DEVICE_W, DEVICE_H],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial Bold",
            "gridonopen": 1,
            "gridsize": [8.0, 8.0],
            "gridsnaponopen": 1,
            "objectsnaponopen": 1,
            "statusbarvisible": 2,
            "toolbarvisible": 1,
            "lefttoolbarpinned": 0,
            "toptoolbarpinned": 0,
            "righttoolbarpinned": 0,
            "bottomtoolbarpinned": 0,
            "toolbars_unpinned_last_save": 0,
            "tallnewobj": 0,
            "boxanimatetime": 500,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": DEVICE_W,
            "description": "Tiny Space reverb: seed-selected combs through a small room",
            "digest": "Seeded tiny-space reverb for Max for Live",
            "tags": "max for live reverb delay tiny space",
            "style": "",
            "subpatcher_template": "",
            "title": "Tiny Space",
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters,
            "dependency_cache": [],
            "latency": 0,
            "project": {
                "version": 1,
                "creationdate": 3590052786,
                "modificationdate": 3590052786,
                "viewrect": [0.0, 0.0, 300.0, 500.0],
                "autoorganize": 1,
                "hideprojectwindow": 1,
                "showdependencies": 1,
                "autolocalize": 0,
                "contents": {"patchers": {}},
                "layout": {},
                "searchpath": {},
                "detailsvisible": 0,
                "amxdtype": 1633771873,
                "readonly": 0,
                "devpathtype": 0,
                "devpath": ".",
                "sortmode": 0,
                "viewmode": 0,
            },
            "autosave": 0,
        }
    }

    json_bytes = json.dumps(patcher_doc, indent="\t").encode("utf-8") + b"\n"
    header = (
        b"ampf" + struct.pack("<I", 4) +
        b"aaaa" +
        b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) +
        b"ptch" + struct.pack("<I", len(json_bytes))
    )
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)
    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + json_bytes)
    print(f"Built {OUT_AMXD_PATH} ({len(header) + len(json_bytes)} bytes)")


if __name__ == "__main__":
    build()
