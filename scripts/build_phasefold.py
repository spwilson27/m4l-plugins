#!/usr/bin/env python3
"""
Build devices/Phase Fold A.amxd, Phase Fold B.amxd and Phase Fold C.amxd.

Same DSP (src/cepstrum_lib.genexpr + src/phasefold_core.genexpr), the same six
Live parameters and the same v8ui script (src/phasefold_ui.js); only the
layout differs. The layout letter is baked into the v8ui text and also sent as
a `layout` message on loadbang.

  A "Sweep"        408 x 169  Big canvas: scrolling in/out envelopes, frame
                              energy strip and a draggable Phase handle field.
                              Value bars in a side column.
  B "Classic"      300 x 169  Small scope strip on top, four dials below.
  C "Transient Lab" 440 x 169 Before/after waveform lanes as the hero, Phase
                              handle under them, one control strip at the bottom.

Parameters: Phase (-100..+100 %), Size (512/1024/2048/4096), Orig (0..100 %),
Auto Gain (on/off), Mix (0..100 %), Output (-24..+12 dB).

Usage: build_phasefold.py [--variant a|b|c]    (no argument builds all three)
"""

import argparse
import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT_DIR, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT_DIR, "src", "phasefold_core.genexpr")
UI_PATH = os.path.join(ROOT_DIR, "src", "phasefold_ui.js")
DEVICES_DIR = os.path.join(ROOT_DIR, "devices")

DEVICE_H = 169.0
LATENCY = 4096
LAYOUT_LINE = 'var layoutMode = "a"; // @layout'

CYAN = (0.28, 0.84, 0.96)
AMBER = (0.98, 0.70, 0.26)
CORAL = (0.96, 0.48, 0.44)
SLATE = (0.76, 0.82, 0.90)
BG = (0.052, 0.064, 0.082)

VARIANTS = {
    "a": {"name": "Phase Fold A", "width": 408.0},
    "b": {"name": "Phase Fold B", "width": 300.0},
    "c": {"name": "Phase Fold C", "width": 440.0},
}

# long name -> (short name, gen param, lo, hi, initial, unitstyle, help)
PARAMS = {
    "Phase": ("Phase", "phaseamt", -100.0, 100.0, -50.0, 5,
              "Phase of every STFT frame: +100% minimum phase (tight, punchy), 0 zero phase (smear), "
              "-100% maximum phase (reverse swell with pre-ringing)."),
    "Orig": ("Orig", "orig", 0.0, 100.0, 0.0, 5,
             "Complex-domain blend of the processed spectrum back toward the original phase. "
             "Partial values are glitchy."),
    "Mix": ("Mix", "mixpct", 0.0, 100.0, 100.0, 5, "Equal-power dry/wet mix. The dry path is delayed to match."),
    "Output": ("Out", "outdb", -24.0, 12.0, 0.0, 4, "Output gain in dB."),
}


def blend(color, mix=0.38):
    """Ableton ignores alpha on the slider fill: pre-blend accent over the dark bg."""
    return [round(color[i] * mix + BG[i] * (1.0 - mix), 4) for i in range(3)] + [1.0]


def valueof(longname, short, lo, hi, initial, unit, enum=None, ptype=0):
    v = {
        "parameter_annotation_name": longname,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": longname,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": ptype,
        "parameter_unitstyle": unit,
    }
    if enum:
        v["parameter_enum"] = enum
    return v


def make_bar(longname, x, y, w, h, color, bipolar=False):
    short, _gen, lo, hi, initial, unit, helptext = PARAMS[longname]
    return {
        "box": {
            "activebgcolor": [BG[0], BG[1], BG[2], 1.0],
            "activeslidercolor": blend(color),
            "annotation": helptext,
            "annotation_name": longname,
            "appearance": 3 if bipolar else 2,
            "bordercolor": [0.22, 0.28, 0.36, 1.0],
            "id": f"obj-{longname.lower()}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 220.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof(longname, short, lo, hi, initial, unit)},
            "textcolor": [0.94, 0.96, 0.98, 1.0],
            "varname": longname,
        }
    }


def make_dial(longname, x, y, w, h, color):
    short, _gen, lo, hi, initial, unit, helptext = PARAMS[longname]
    return {
        "box": {
            "activedialcolor": [color[0], color[1], color[2], 1.0],
            "annotation": helptext,
            "annotation_name": longname,
            "id": f"obj-{longname.lower()}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 260.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof(longname, short, lo, hi, initial, unit)},
            "textcolor": [0.88, 0.91, 0.96, 1.0],
            "varname": longname,
        }
    }


def make_size_tab(x, y, w, h):
    enum = ["512", "1024", "2048", "4096"]
    return {
        "box": {
            "activebgcolor": [0.065, 0.078, 0.098, 1.0],
            "activebgoncolor": [CYAN[0], CYAN[1], CYAN[2], 1.0],
            "activetextcolor": [0.76, 0.82, 0.90, 1.0],
            "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
            "annotation": "STFT frame size. Larger frames give longer swells and tails. "
                          "Latency stays 4096 samples at every size.",
            "annotation_name": "Size",
            "bordercolor": [0.20, 0.25, 0.32, 1.0],
            "id": "obj-size",
            "maxclass": "live.tab",
            "num_lines_patching": 1,
            "num_lines_presentation": 1,
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 200.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": valueof("Size", "Size", 0, 3, 2, 9, enum=enum, ptype=2)
            },
            "spacing_x": 2.0,
            "varname": "Size",
        }
    }


def make_auto(x, y, w, h, text="Auto Gain"):
    return {
        "box": {
            "activebgcolor": [0.10, 0.12, 0.15, 1.0],
            "activebgoncolor": [AMBER[0], AMBER[1], AMBER[2], 1.0],
            "activetextcolor": [0.82, 0.86, 0.90, 1.0],
            "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
            "annotation": "Auto Gain: scales every frame to the energy of the input frame, so sweeping Phase "
                          "does not change the loudness.",
            "annotation_name": "Auto Gain",
            "bordercolor": [AMBER[0] * 0.8, AMBER[1] * 0.8, AMBER[2] * 0.8, 1.0],
            "id": "obj-auto",
            "maxclass": "live.text",
            "mode": 1,
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [float(x), 240.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": valueof("Auto Gain", "Auto", 0, 1, 1, 0, enum=["Off", "On"], ptype=2)
            },
            "text": text,
            "texton": text,
            "varname": "Auto Gain",
        }
    }


def make_label(obj_id, text, x, y, w, h=12.0, size=8.0, color=SLATE, align=0):
    return {
        "box": {
            "fontface": 1,
            "fontname": "Arial Bold",
            "fontsize": float(size),
            "id": obj_id,
            "maxclass": "live.comment",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 20.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "textcolor": [color[0], color[1], color[2], 1.0],
            "textjustification": align,
        }
    }


def make_panel(obj_id, x, y, w, h, bg=(0.075, 0.086, 0.108), border=(0.24, 0.29, 0.37), rounded=6):
    return {
        "box": {
            "angle": 270.0,
            "background": 1,
            "bgcolor": [bg[0], bg[1], bg[2], 1.0],
            "border": 1,
            "bordercolor": [border[0], border[1], border[2], 1.0],
            "id": obj_id,
            "maxclass": "panel",
            "mode": 0,
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 520.0, 80.0, 40.0],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "proportion": 0.5,
            "rounded": rounded,
        }
    }


def newobj(obj_id, text, x, y, w, inlets=1, outlets=1, otype=None):
    return {
        "box": {
            "fontname": "Arial Bold",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "newobj",
            "numinlets": inlets,
            "numoutlets": outlets,
            "outlettype": otype if otype is not None else [""] * outlets,
            "patching_rect": [float(x), float(y), float(w), 20.0],
            "text": text,
        }
    }


def message(obj_id, text, x, y, w):
    b = newobj(obj_id, text, x, y, w, inlets=2)
    b["box"]["maxclass"] = "message"
    return b


def layout_widgets(variant):
    """Returns (widgets, panels, viz_rect)."""
    if variant == "a":
        viz = [10.0, 26.0, 270.0, 134.0]
        widgets = [
            make_label("obj-title", "PHASE FOLD", 10, 7, 100, 16, size=11.0, color=(0.96, 0.92, 0.84)),
            make_size_tab(150, 7, 130, 15),
            make_label("obj-phase-lbl", "Phase", 294, 10, 40, 12, color=CORAL),
            make_bar("Phase", 338, 8, 60, 15, CORAL, bipolar=True),
            make_label("obj-orig-lbl", "Orig", 294, 34, 40, 12, color=CYAN),
            make_bar("Orig", 338, 32, 60, 15, CYAN),
            make_label("obj-mix-lbl", "Mix", 294, 58, 40, 12, color=AMBER),
            make_bar("Mix", 338, 56, 60, 15, AMBER),
            make_label("obj-out-lbl", "Out", 294, 82, 40, 12, color=AMBER),
            make_bar("Output", 338, 80, 60, 15, AMBER),
            make_auto(294, 108, 104, 18),
            make_label("obj-lat-lbl", "Latency 4096 smp", 294, 136, 104, 12, size=7.5, color=(0.58, 0.64, 0.72)),
        ]
        panels = [
            make_panel("obj-panel-viz", 6, 5, 278, 159),
            make_panel("obj-panel-ctl", 288, 5, 114, 159, bg=(0.092, 0.098, 0.118), border=(0.26, 0.30, 0.38)),
        ]
    elif variant == "b":
        viz = [10.0, 26.0, 280.0, 40.0]
        widgets = [
            make_label("obj-title", "PHASE FOLD", 10, 7, 84, 16, size=10.0, color=(0.96, 0.92, 0.84)),
            make_size_tab(98, 7, 130, 15),
            make_auto(234, 7, 56, 15, text="Auto"),
            make_dial("Phase", 14, 72, 84, 88, CORAL),
            make_dial("Orig", 108, 80, 56, 76, CYAN),
            make_dial("Mix", 168, 80, 56, 76, AMBER),
            make_dial("Output", 228, 80, 56, 76, AMBER),
        ]
        panels = [make_panel("obj-panel-viz", 6, 5, 288, 159)]
    else:
        viz = [10.0, 8.0, 420.0, 114.0]
        widgets = [
            make_label("obj-phase-lbl", "Phase", 10, 125, 96, 11, size=7.5, color=CORAL),
            make_bar("Phase", 10, 137, 96, 15, CORAL, bipolar=True),
            make_label("obj-size-lbl", "Size", 112, 125, 92, 11, size=7.5, color=CYAN),
            make_size_tab(112, 137, 92, 15),
            make_label("obj-orig-lbl", "Orig", 210, 125, 48, 11, size=7.5, color=CYAN),
            make_bar("Orig", 210, 137, 48, 15, CYAN),
            make_label("obj-mix-lbl", "Mix", 264, 125, 48, 11, size=7.5, color=AMBER),
            make_bar("Mix", 264, 137, 48, 15, AMBER),
            make_label("obj-out-lbl", "Out", 318, 125, 50, 11, size=7.5, color=AMBER),
            make_bar("Output", 318, 137, 50, 15, AMBER),
            make_auto(374, 137, 54, 15, text="Auto"),
        ]
        panels = [make_panel("obj-panel-viz", 6, 5, 428, 159)]
    return widgets, panels, viz


def build_variant(variant):
    info = VARIANTS[variant]
    width = info["width"]
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    if LAYOUT_LINE not in ui_js:
        raise SystemExit(f"{UI_PATH} lost its layout line: {LAYOUT_LINE}")
    ui_js = ui_js.replace(LAYOUT_LINE, LAYOUT_LINE.replace('"a"', f'"{variant}"'))
    with open(LIB_PATH, "r", encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, "r", encoding="utf-8") as f:
        core = f.read()
    gen_code = lib + "\n" + core

    widgets, panels, viz_rect = layout_widgets(variant)

    boxes = [
        {
            "box": {
                "border": 0,
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [20.0, 80.0, viz_rect[2], viz_rect[3]],
                "presentation": 1,
                "presentation_rect": [float(v) for v in viz_rect],
                "textfile": {"text": ui_js, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
            }
        },
        newobj("obj-plugin", "plugin~", 20, 240, 52, inlets=2, outlets=2, otype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 460, 58, inlets=2, outlets=0, otype=[]),
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
                "patching_rect": [120.0, 320.0, 420.0, 120.0],
                "varname": "phasefold",
            }
        },
        newobj("obj-scope", "buffer~ #0-phasefoldscope 100 4", 560, 240, 200, inlets=1, outlets=2,
               otype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 180, 60, outlets=1, otype=["bang"]),
        message("obj-msg-genbuf", "scope #0-phasefoldscope", 640, 180, 190),
        message("obj-msg-uibuf", "setbuffer #0-phasefoldscope", 640, 210, 190),
        message("obj-msg-layout", f"layout {variant}", 840, 210, 80),
        newobj("obj-route-viz", "route phase", 20, 215, 80, inlets=2, outlets=2),
        newobj("obj-set-phase", "prepend set", 110, 215, 75),
        newobj("obj-prep-phase", "prepend phaseamt", 320, 360, 110),
        newobj("obj-ui-phase", "prepend set_phase", 440, 360, 120),
        newobj("obj-prep-size", "prepend sizeidx", 320, 390, 110),
        newobj("obj-ui-size", "prepend set_size", 440, 390, 120),
        newobj("obj-prep-orig", "prepend orig", 320, 420, 110),
        newobj("obj-ui-orig", "prepend set_orig", 440, 420, 120),
        newobj("obj-prep-auto", "prepend autog", 320, 450, 110),
        newobj("obj-ui-auto", "prepend set_auto", 440, 450, 120),
        newobj("obj-prep-mix", "prepend mixpct", 320, 480, 110),
        newobj("obj-ui-mix", "prepend set_mix", 440, 480, 120),
        newobj("obj-prep-out", "prepend outdb", 320, 510, 110),
        newobj("obj-ui-out", "prepend set_out", 440, 510, 120),
    ]
    boxes.extend(widgets)
    # Background panels MUST be last in boxes and have "background": 1
    boxes.extend(panels)

    def line(src, outlet, dst, inlet=0):
        return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}

    lines = [
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-genbuf"),
        line("obj-loadbang", 0, "obj-msg-uibuf"),
        line("obj-loadbang", 0, "obj-msg-layout"),
        line("obj-msg-genbuf", 0, "obj-gen"),
        line("obj-msg-uibuf", 0, "obj-viz"),
        line("obj-msg-layout", 0, "obj-viz"),
        # canvas Phase handle -> gen + Phase control display
        line("obj-viz", 0, "obj-route-viz"),
        line("obj-route-viz", 0, "obj-prep-phase"),
        line("obj-route-viz", 0, "obj-set-phase"),
        line("obj-set-phase", 0, "obj-phase"),
    ]
    for ctl, prep, ui in (
        ("obj-phase", "obj-prep-phase", "obj-ui-phase"),
        ("obj-size", "obj-prep-size", "obj-ui-size"),
        ("obj-orig", "obj-prep-orig", "obj-ui-orig"),
        ("obj-auto", "obj-prep-auto", "obj-ui-auto"),
        ("obj-mix", "obj-prep-mix", "obj-ui-mix"),
        ("obj-output", "obj-prep-out", "obj-ui-out"),
    ):
        lines += [
            line(ctl, 0, prep),
            line(prep, 0, "obj-gen"),
            line(ctl, 0, ui),
            line(ui, 0, "obj-viz"),
        ]

    parameters = {
        "obj-phase": ["Phase", "Phase", 0],
        "obj-size": ["Size", "Size", 0],
        "obj-orig": ["Orig", "Orig", 0],
        "obj-auto": ["Auto Gain", "Auto", 0],
        "obj-mix": ["Mix", "Mix", 0],
        "obj-output": ["Output", "Out", 0],
        "parameterbanks": {
            "0": {
                "index": 0,
                "name": "",
                "parameters": ["Phase", "Size", "Orig", "Auto Gain", "Mix", "Output"],
            }
        },
        "inherited_shortname": 1,
    }

    patcher_doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 60.0, 1100.0, 640.0],
            "openrect": [0.0, 0.0, width, DEVICE_H],
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
            "devicewidth": width,
            "description": "Phase Fold: cepstral phase sculptor, minimum to maximum phase per STFT frame",
            "digest": "Min/max-phase transient sculptor for Max for Live",
            "tags": "max for live phase cepstrum transient",
            "style": "",
            "subpatcher_template": "",
            "title": info["name"],
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters,
            "dependency_cache": [],
            "latency": LATENCY,
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
        b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4)
        + struct.pack("<I", 0) + b"ptch" + struct.pack("<I", len(json_bytes))
    )
    out_path = os.path.join(DEVICES_DIR, info["name"] + ".amxd")
    os.makedirs(DEVICES_DIR, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header + json_bytes)
    print(f"Built {out_path} [{int(width)}x169 px] ({len(header) + len(json_bytes)} bytes)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=sorted(VARIANTS), help="build one layout (default: all three)")
    args = ap.parse_args()
    for v in ([args.variant] if args.variant else sorted(VARIANTS)):
        build_variant(v)


if __name__ == "__main__":
    main()
