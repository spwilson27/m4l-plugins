#!/usr/bin/env python3
"""
Build script for Tiny Space.amxd
Generates a self-contained Max for Live Audio Effect reverb:
  - src/tinyspace_ui.js (v8ui visualization + seed config generator)
  - src/tinyspace_core.genexpr (gen.codebox~ FDN reverb core)
  - 2 in / 2 out audio, 13 controls, 20 per-line meters
"""
import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Tiny Space.amxd")

DEVICE_W = 660
DEVICE_H = 169


def build():
    with open(JS_PATH, "r", encoding="utf-8") as f:
        v8ui_code = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    boxes = []
    lines = []

    # --- 1. Audio pass-through (plugin~/plugout~) ---
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-plugin",
        "maxclass": "newobj", "numinlets": 2, "numoutlets": 2,
        "outlettype": ["signal", "signal"],
        "patching_rect": [30.0, 30.0, 52.0, 20.0], "text": "plugin~"
    }})
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-plugout",
        "maxclass": "newobj", "numinlets": 2, "numoutlets": 2,
        "outlettype": ["signal", "signal"],
        "patching_rect": [30.0, 80.0, 58.0, 20.0], "text": "plugout~"
    }})
    lines.append({"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-plugout", 0]}})
    lines.append({"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-plugout", 1]}})

    # --- 2. Config buffer ---
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-bufcfg",
        "maxclass": "newobj", "numinlets": 1, "numoutlets": 2,
        "outlettype": ["float", "bang"],
        "patching_rect": [30.0, 120.0, 180.0, 20.0],
        "text": "buffer~ #0-tsconfig @samps 48"
    }})
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-loadbuf",
        "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
        "outlettype": [""],
        "patching_rect": [30.0, 150.0, 180.0, 20.0],
        "text": "loadmess setbuffer #0-tsconfig"
    }})

    # --- 3. gen.codebox~ core (hidden) ---
    boxes.append({"box": {
        "code": gen_code,
        "fontface": 0, "fontname": "<Monospaced>", "fontsize": 10.0,
        "hidden": 1, "id": "obj-gen",
        "maxclass": "gen.codebox~",
        "numinlets": 15, "numoutlets": 22,
        "outlettype": ["signal"] * 22,
        "patching_rect": [30.0, 200.0, 260.0, 120.0],
        "varname": "TinySpaceGen"
    }})

    # wire audio in
    lines.append({"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}})
    lines.append({"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}})
    # wire audio out
    lines.append({"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}})
    lines.append({"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}})

    # --- 4. v8ui visualization canvas ---
    boxes.append({"box": {
        "border": 0, "filename": "none", "id": "obj-viz",
        "maxclass": "v8ui", "numinlets": 1, "numoutlets": 0,
        "outlettype": [],
        "parameter_enable": 1,
        "patching_rect": [30.0, 230.0, 400.0, 134.0],
        "presentation": 1,
        "presentation_rect": [10.0, 27.0, 396.0, 134.0],
        "saved_attribute_attributes": {
            "valueof": {
                "parameter_invisible": 1,
                "parameter_longname": "VizData",
                "parameter_shortname": "VizData",
                "parameter_type": 3
            }
        },
        "textfile": {
            "text": v8ui_code, "filename": "none", "flags": 0,
            "embed": 1, "autowatch": 1
        },
        "varname": "VizData"
    }})
    # loadbuffer -> v8ui
    lines.append({"patchline": {"source": ["obj-loadbuf", 0], "destination": ["obj-viz", 0]}})

    # --- 5. Controls (dials) ---
    # list of (id, label, init, param name for gen inN index)
    # gen inlets: 3=size,4=damp,5=width,6=mix,7=feedback,8=freeze,9=predelay,10=ingain,11=outgain,12=hp,13=lp,14=mod,15=crossfeed
    controls = [
        ("size", "Size", 50, 3),
        ("damp", "Damp", 50, 4),
        ("width", "Width", 100, 5),
        ("mix", "Mix", 30, 6),
        ("feedback", "Feedback", 40, 7),
        ("predelay", "PreDly", 10, 9),
        ("mod", "Mod", 0, 14),
        ("crossfeed", "XFeed", 30, 15),
        ("ingain", "InGain", 100, 10),
        ("outgain", "OutGain", 100, 11),
        ("hp", "HP", 5, 12),
        ("lp", "LP", 80, 13),
    ]
    # freeze is a toggle (live.text) -> in8
    # seed is a numbox

    # dial layout: 4 cols x 3 rows in right panel x=410..654
    col_x = [412, 460, 508, 556]
    row_y = [24, 72, 120]
    for idx, (cid, label, init, inIdx) in enumerate(controls):
        c = idx % 4
        r = idx // 4
        x = col_x[c]
        y = row_y[r]
        did = "obj-dial-" + cid
        boxes.append({"box": {
            "activedialcolor": [0.317647, 0.768627, 0.921569, 1.0],
            "annotation": label,
            "annotation_name": label,
            "id": did,
            "maxclass": "live.dial",
            "numinlets": 1, "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [600.0 + idx * 10, 300.0, 44.0, 48.0],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), 44.0, 48.0],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": label,
                    "parameter_initial": [float(init)],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": label,
                    "parameter_mmax": 100.0,
                    "parameter_mmin": 0.0,
                    "parameter_shortname": label,
                    "parameter_type": 0,
                    "parameter_unitstyle": 5
                }
            },
            "varname": label
        }})
        # label comment above dial
        boxes.append({"box": {
            "fontsize": 8.0, "id": "obj-lbl-" + cid,
            "maxclass": "live.comment", "numinlets": 1, "numoutlets": 0,
            "patching_rect": [600.0, 300.0, 44.0, 12.0],
            "presentation": 1,
            "presentation_rect": [float(x), float(y - 12), 44.0, 12.0],
            "text": label,
            "textcolor": [0.65, 0.68, 0.72, 1.0],
            "textjustification": 1
        }})
        # sig~ conversion + wire to gen inlet
        sid = "obj-sig-" + cid
        boxes.append({"box": {
            "fontname": "Arial Bold", "fontsize": 10.0, "id": sid,
            "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
            "outlettype": ["signal"],
            "patching_rect": [600.0, 320.0, 40.0, 20.0],
            "text": "sig~ 0."
        }})
        lines.append({"patchline": {"source": [did, 1], "destination": [sid, 0]}})
        lines.append({"patchline": {"source": [sid, 0], "destination": ["obj-gen", inIdx - 1]}})

    # seed numbox
    boxes.append({"box": {
        "activebgcolor": [0.086, 0.102, 0.122, 1.0],
        "activeslidercolor": [1.0, 0.709804, 0.196078, 1.0],
        "annotation": "Seed",
        "annotation_name": "Seed",
        "appearance": 4,
        "id": "obj-seed",
        "maxclass": "live.numbox", "numinlets": 1, "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [600.0, 400.0, 50.0, 15.0],
        "presentation": 1,
        "presentation_rect": [556.0, 124.0, 50.0, 15.0],
        "saved_attribute_attributes": {
            "valueof": {
                "parameter_annotation_name": "Seed",
                "parameter_initial": [1.0],
                "parameter_initial_enable": 1,
                "parameter_linknames": 1,
                "parameter_longname": "Seed",
                "parameter_mmax": 9999.0,
                "parameter_mmin": 0.0,
                "parameter_shortname": "Seed",
                "parameter_type": 1,
                "parameter_unitstyle": 0
            }
        },
        "textcolor": [1.0, 0.709804, 0.196078, 1.0],
        "varname": "Seed"
    }})
    boxes.append({"box": {
        "fontsize": 8.0, "id": "obj-lbl-seed",
        "maxclass": "live.comment", "numinlets": 1, "numoutlets": 0,
        "patching_rect": [600.0, 400.0, 44.0, 12.0],
        "presentation": 1,
        "presentation_rect": [556.0, 112.0, 50.0, 12.0],
        "text": "Seed",
        "textcolor": [0.65, 0.68, 0.72, 1.0],
        "textjustification": 1
    }})
    # seed -> v8ui
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-seed-prep",
        "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
        "outlettype": [""],
        "patching_rect": [600.0, 420.0, 70.0, 20.0],
        "text": "prepend seed"
    }})
    lines.append({"patchline": {"source": ["obj-seed", 0], "destination": ["obj-seed-prep", 0]}})
    lines.append({"patchline": {"source": ["obj-seed-prep", 0], "destination": ["obj-viz", 0]}})

    # freeze toggle -> in8
    boxes.append({"box": {
        "activebgcolor": [0.086, 0.102, 0.122, 1.0],
        "activebgoncolor": [1.0, 0.694, 0.18, 1.0],
        "activetextcolor": [0.75, 0.78, 0.82, 1.0],
        "activetextoncolor": [0.08, 0.1, 0.12, 1.0],
        "annotation": "Freeze",
        "annotation_name": "Freeze",
        "id": "obj-freeze",
        "maxclass": "live.text", "numinlets": 1, "numoutlets": 2,
        "outlettype": ["", ""],
        "parameter_enable": 1,
        "patching_rect": [600.0, 440.0, 44.0, 15.0],
        "presentation": 1,
        "presentation_rect": [612.0, 124.0, 44.0, 15.0],
        "saved_attribute_attributes": {
            "valueof": {
                "parameter_annotation_name": "Freeze",
                "parameter_enum": ["Off", "On"],
                "parameter_initial": [0],
                "parameter_initial_enable": 1,
                "parameter_linknames": 1,
                "parameter_longname": "Freeze",
                "parameter_mmax": 1,
                "parameter_shortname": "Freeze",
                "parameter_type": 2
            }
        },
        "text": "Freeze", "texton": "Freeze",
        "varname": "Freeze"
    }})
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-freeze-sig",
        "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
        "outlettype": ["signal"],
        "patching_rect": [600.0, 460.0, 40.0, 20.0],
        "text": "sig~ 0."
    }})
    lines.append({"patchline": {"source": ["obj-freeze", 0], "destination": ["obj-freeze-sig", 0]}})
    lines.append({"patchline": {"source": ["obj-freeze-sig", 0], "destination": ["obj-gen", 7]}})

    # --- 6. Meters: gen out3..out22 -> rms~ -> snapshot~ 50 -> prepend lineN -> v8ui ---
    for i in range(20):
        mid = "obj-rms-%d" % i
        sid = "obj-snap-%d" % i
        pid = "obj-prep-%d" % i
        boxes.append({"box": {
            "fontname": "Arial Bold", "fontsize": 10.0, "id": mid,
            "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
            "outlettype": ["signal"],
            "patching_rect": [400.0, 200.0 + i * 12, 60.0, 20.0],
            "text": "rms~ 50"
        }})
        boxes.append({"box": {
            "fontname": "Arial Bold", "fontsize": 10.0, "id": sid,
            "maxclass": "newobj", "numinlets": 2, "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [470.0, 200.0 + i * 12, 70.0, 20.0],
            "text": "snapshot~ 50"
        }})
        boxes.append({"box": {
            "fontname": "Arial Bold", "fontsize": 10.0, "id": pid,
            "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [545.0, 200.0 + i * 12, 90.0, 20.0],
            "text": "prepend line%d" % i
        }})
        lines.append({"patchline": {"source": ["obj-gen", 2 + i], "destination": [mid, 0]}})
        lines.append({"patchline": {"source": [mid, 0], "destination": [sid, 0]}})
        lines.append({"patchline": {"source": [sid, 0], "destination": [pid, 0]}})
        lines.append({"patchline": {"source": [pid, 0], "destination": ["obj-viz", 0]}})

    # --- 7. Panels ---
    boxes.append({"box": {
        "angle": 270.0, "background": 1,
        "bgcolor": [0.125, 0.145, 0.17, 1.0],
        "border": 1, "bordercolor": [0.06, 0.07, 0.08, 1.0],
        "id": "obj-panel-viz",
        "maxclass": "panel", "mode": 0, "numinlets": 1, "numoutlets": 0,
        "patching_rect": [30.0, 500.0, 120.0, 40.0],
        "presentation": 1,
        "presentation_rect": [6.0, 5.0, 400.0, 159.0],
        "proportion": 0.5, "rounded": 6
    }})
    boxes.append({"box": {
        "angle": 270.0, "background": 1,
        "bgcolor": [0.125, 0.145, 0.17, 1.0],
        "border": 1, "bordercolor": [0.06, 0.07, 0.08, 1.0],
        "id": "obj-panel-ctrl",
        "maxclass": "panel", "mode": 0, "numinlets": 1, "numoutlets": 0,
        "patching_rect": [160.0, 500.0, 120.0, 40.0],
        "presentation": 1,
        "presentation_rect": [410.0, 5.0, 244.0, 159.0],
        "proportion": 0.5, "rounded": 6
    }})
    # title
    boxes.append({"box": {
        "fontface": 1, "fontsize": 12.0, "id": "obj-title",
        "maxclass": "live.comment", "numinlets": 1, "numoutlets": 0,
        "patching_rect": [30.0, 380.0, 120.0, 18.0],
        "presentation": 1,
        "presentation_rect": [10.0, 7.0, 120.0, 18.0],
        "text": "Tiny Space",
        "textcolor": [1.0, 0.709804, 0.196078, 1.0],
        "textjustification": 0
    }})

    # --- 8. Device-state click guard ---
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-thisdevice",
        "maxclass": "newobj", "numinlets": 1, "numoutlets": 3,
        "outlettype": ["bang", "int", "int"],
        "patching_rect": [700.0, 30.0, 78.0, 20.0],
        "text": "live.thisdevice"
    }})
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-dev-inv",
        "maxclass": "newobj", "numinlets": 2, "numoutlets": 1,
        "outlettype": ["int"],
        "patching_rect": [730.0, 58.0, 30.0, 20.0],
        "text": "!- 1"
    }})
    boxes.append({"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-dev-ig",
        "maxclass": "newobj", "numinlets": 2, "numoutlets": 1,
        "outlettype": [""],
        "patching_rect": [730.0, 84.0, 76.0, 20.0],
        "text": "ignoreclick $1"
    }})
    lines.append({"patchline": {"source": ["obj-thisdevice", 1], "destination": ["obj-dev-inv", 0]}})
    lines.append({"patchline": {"source": ["obj-dev-inv", 0], "destination": ["obj-dev-ig", 0]}})
    # apply ignoreclick to dials
    for cid, label, init, inIdx in controls:
        lines.append({"patchline": {"source": ["obj-dev-ig", 0], "destination": ["obj-dial-" + cid, 0], "order": 0}})

    # parameters_dict
    parameters_dict = {
        "obj-viz": ["VizData", "VizData", 0],
        "obj-seed": ["Seed", "Seed", 0],
        "obj-freeze": ["Freeze", "Freeze", 0],
    }
    for cid, label, init, inIdx in controls:
        parameters_dict["obj-dial-" + cid] = [label, label, 0]

    parameters_dict["parameterbanks"] = {
        "0": {
            "index": 0,
            "name": "",
            "parameters": ["Size", "Damp", "Width", "Mix", "Feedback",
                           "PreDly", "Mod", "XFeed", "InGain", "OutGain",
                           "HP", "LP", "Seed", "Freeze"]
        }
    }
    parameters_dict["inherited_shortname"] = 1

    patcher_doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5,
                           "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [60.0, 80.0, 1180.0, 680.0],
            "openrect": [0.0, 0.0, float(DEVICE_W), float(DEVICE_H)],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial Bold",
            "gridonopen": 1, "gridsize": [8.0, 8.0],
            "gridsnaponopen": 1, "objectsnaponopen": 1,
            "statusbarvisible": 2, "toolbarvisible": 1,
            "lefttoolbarpinned": 0, "toptoolbarpinned": 0,
            "righttoolbarpinned": 0, "bottomtoolbarpinned": 0,
            "toolbars_unpinned_last_save": 0, "tallnewobj": 0,
            "boxanimatetime": 500, "enablehscroll": 1, "enablevscroll": 1,
            "devicewidth": float(DEVICE_W),
            "description": "Tiny Space reverb (FDN, seed-driven configs)",
            "digest": "Tiny Space reverb for Max for Live",
            "tags": "max for live audio effect reverb tiny space",
            "style": "", "subpatcher_template": "",
            "title": "Tiny Space",
            "boxes": boxes, "lines": lines,
            "parameters": parameters_dict,
            "dependency_cache": [],
            "latency": 0,
            "project": {
                "version": 1,
                "creationdate": 3590052786,
                "modificationdate": 3590052786,
                "viewrect": [0.0, 0.0, 300.0, 500.0],
                "autoorganize": 1, "hideprojectwindow": 1,
                "showdependencies": 1, "autolocalize": 0,
                "contents": {"patchers": {}},
                "layout": {}, "searchpath": {}, "detailsvisible": 0,
                "amxdtype": 1633771873, "readonly": 0,
                "devpathtype": 0, "devpath": ".",
                "sortmode": 0, "viewmode": 0
            },
            "autosave": 0
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
    print("Built %s (%d bytes)" % (OUT_AMXD_PATH, len(header) + len(json_bytes)))


if __name__ == "__main__":
    build()
