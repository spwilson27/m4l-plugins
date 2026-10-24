#!/usr/bin/env python3
"""
Build devices/EQ+.amxd (360 x 169 px) — a drawable eight-band EQ (Bitwig EQ+).

The face is one interactive v8ui (`obj-viz`). Every automatable control is a hidden
`live.*` parameter (presentation off) so Live can automate, map, and show it in the
Inspector without covering the canvas. The v8ui reports changes as `param <name> <value>`
on outlet 0; `route` turns those into a silent `set` of the live object so nothing feeds
back. Outlet 1 sends `outgain` straight to the gen hub.

plugin~ stays unwired until the face creates `gen~` (AGENTS.md 1d). Messages for that
gen go through `eq_genin` (`gate 1 1`, data into the right inlet).
"""
import hashlib
import json
import os
import struct

from minify_embed import minify_patcher

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "eqplus_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "eqplus_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "eqplus_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "EQ+.amxd")

DEVICE_W = 360.0
DEVICE_H = 169.0

MODES = [
    "Off",
    "Low-Cut 1",
    "Low-Cut 2",
    "Low-Cut 4",
    "Low-Cut 8",
    "Low-Shelf",
    "Bell",
    "Notch",
    "High-Shelf",
    "High-Cut 1",
    "High-Cut 2",
    "High-Cut 4",
    "High-Cut 8",
]
DEFAULT_FREQS = [60.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0]
TILT_ENUM = ["0.0 dB/oct", "3.0 dB/oct", "4.5 dB/oct", "6.0 dB/oct"]
RANGE_ENUM = ["\u00b110", "\u00b120", "\u00b130"]
ON_OFF = ["Off", "On"]


def float_valueof(long_name, short_name, lo, hi, initial, unit, exponent=None):
    valueof = {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short_name,
        "parameter_type": 0,
        "parameter_unitstyle": unit,
    }
    if exponent is not None:
        valueof["parameter_exponent"] = exponent
    return valueof


def enum_valueof(long_name, short_name, enums, initial, unitstyle=True):
    valueof = {
        "parameter_annotation_name": long_name,
        "parameter_enum": list(enums),
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": len(enums) - 1,
        "parameter_shortname": short_name,
        "parameter_type": 2,
    }
    if unitstyle:
        valueof["parameter_unitstyle"] = 9
    return valueof


def hidden(obj_id, maxclass, x, y, w, h, valueof, varname, help_text):
    return {
        "annotation": help_text,
        "annotation_name": varname,
        "id": obj_id,
        "maxclass": maxclass,
        "numinlets": 1,
        "parameter_enable": 1,
        "patching_rect": [float(x), float(y), float(w), float(h)],
        "presentation": 0,
        "hidden": 1,
        "saved_attribute_attributes": {"valueof": valueof},
        "varname": varname,
    }


def make_num(obj_id, long_name, short_name, lo, hi, initial, unit, x, y, w, help_text, exponent=None):
    box = hidden(
        obj_id, "live.numbox", x, y, w, 18.0,
        float_valueof(long_name, short_name, lo, hi, initial, unit, exponent),
        long_name, help_text,
    )
    box["numoutlets"] = 2
    box["outlettype"] = ["", "float"]
    return {"box": box}


def make_toggle(obj_id, long_name, short_name, initial, x, y, w, help_text):
    box = hidden(
        obj_id, "live.text", x, y, w, 18.0,
        enum_valueof(long_name, short_name, ON_OFF, initial, unitstyle=False),
        long_name, help_text,
    )
    box.update({
        "mode": 1,
        "numoutlets": 2,
        "outlettype": ["", ""],
        "text": "Off",
        "texton": "On",
    })
    return {"box": box}


def make_tab(obj_id, long_name, short_name, enums, initial, x, y, w, help_text):
    box = hidden(
        obj_id, "live.tab", x, y, w, 18.0,
        enum_valueof(long_name, short_name, enums, initial),
        long_name, help_text,
    )
    box.update({
        "num_lines_patching": 1,
        "num_lines_presentation": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
    })
    return {"box": box}


def make_menu(obj_id, long_name, short_name, enums, initial, x, y, w, help_text):
    box = hidden(
        obj_id, "live.menu", x, y, w, 18.0,
        enum_valueof(long_name, short_name, enums, initial),
        long_name, help_text,
    )
    box.update({
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
    })
    return {"box": box}


def newobj(obj_id, text, x, y, w, numinlets=1, numoutlets=1, outlettype=None, varname=None):
    box = {
        "fontname": "Arial",
        "fontsize": 10.0,
        "id": obj_id,
        "maxclass": "newobj",
        "numinlets": numinlets,
        "numoutlets": numoutlets,
        "outlettype": outlettype if outlettype is not None else [""] * numoutlets,
        "patching_rect": [float(x), float(y), float(w), 20.0],
        "text": text,
    }
    if varname:
        box["varname"] = varname
    return {"box": box}


def message(obj_id, text, x, y, w):
    box = newobj(obj_id, text, x, y, w, numinlets=2)
    box["box"]["maxclass"] = "message"
    return box


def line(src, outlet, dst, inlet=0):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def gendsp_json(gen_code):
    """2-in / 2-out gen patch as .gendsp JSON. The face writes it and creates gen~ after load."""
    def bx(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {
            "id": i,
            "maxclass": cls,
            "numinlets": ni,
            "numoutlets": no,
            "outlettype": [""] * no,
            "patching_rect": [float(x), float(y), 200.0, 22.0],
        }
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}

    patch = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "dsp.gen",
            "rect": [50.0, 50.0, 600.0, 450.0],
            "boxes": [
                bx("obj-in1", "in 1", 20, 20, 0, 1),
                bx("obj-in2", "in 2", 120, 20, 0, 1),
                bx("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
                bx("obj-out1", "out 1", 20, 400, 1, 0),
                bx("obj-out2", "out 2", 120, 400, 1, 0),
            ],
            "lines": [
                line("obj-in1", 0, "obj-code", 0),
                line("obj-in2", 0, "obj-code", 1),
                line("obj-code", 0, "obj-out1", 0),
                line("obj-code", 1, "obj-out2", 0),
            ],
        }
    }
    return json.dumps(patch)


def control_specs():
    """Hidden automatable parameters, in Live's parameter order."""
    specs = [
        {
            "id": "obj-ctrl-shift",
            "key": "shift",
            "ui": "set_shift",
            "kind": "num",
            "long": "Global Shift",
            "short": "Shift",
            "lo": -36.0,
            "hi": 36.0,
            "init": 0.0,
            "unit": 7,
            "w": 70,
            "help": "Offsets the frequency of every band, in semitones (-36 to +36).",
        },
        {
            "id": "obj-ctrl-gain",
            "key": "gain",
            "ui": "set_gain",
            "gen": "outgain",
            "kind": "num",
            "long": "Output Gain",
            "short": "Gain",
            "lo": -24.0,
            "hi": 24.0,
            "init": 0.0,
            "unit": 4,
            "w": 70,
            "help": "Gain applied to the device output, in dB (-24 to +24).",
        },
        {
            "id": "obj-ctrl-adaptiveq",
            "key": "adaptiveq",
            "ui": "set_adaptiveq",
            "kind": "toggle",
            "long": "Adaptive-Q",
            "short": "AdaptQ",
            "init": 1,
            "w": 70,
            "help": "When on, each bell's Q rises with the absolute value of its gain.",
        },
        {
            "id": "obj-ctrl-range",
            "key": "range",
            "ui": "set_range",
            "kind": "tab",
            "long": "Display Range",
            "short": "Range",
            "enums": RANGE_ENUM,
            "init": 0,
            "w": 90,
            "help": "Vertical display range of the curve: \u00b110, \u00b120, or \u00b130 dB.",
        },
        {
            "id": "obj-ctrl-pre",
            "key": "pre",
            "ui": "set_pre",
            "kind": "toggle",
            "long": "Analyzer Pre",
            "short": "Pre",
            "init": 1,
            "w": 54,
            "help": "Draw the incoming audio as a shaded spectrum.",
        },
        {
            "id": "obj-ctrl-post",
            "key": "post",
            "ui": "set_post",
            "kind": "toggle",
            "long": "Analyzer Post",
            "short": "Post",
            "init": 1,
            "w": 54,
            "help": "Draw the outgoing audio as a bright spectrum curve.",
        },
        {
            "id": "obj-ctrl-resolution",
            "key": "resolution",
            "ui": "set_resolution",
            "kind": "menu",
            "long": "Resolution",
            "short": "Res",
            "enums": ["Small", "Medium", "Large", "Huge"],
            "init": 3,
            "w": 80,
            "help": "FFT size of the spectrum display: Small, Medium, Large, or Huge.",
        },
        {
            "id": "obj-ctrl-speed",
            "key": "speed",
            "ui": "set_speed",
            "kind": "menu",
            "long": "Speed",
            "short": "Speed",
            "enums": ["Fast", "Medium", "Slow", "Freeze"],
            "init": 0,
            "w": 80,
            "help": "Rise and fall time of the spectrum display.",
        },
        {
            "id": "obj-ctrl-tilt",
            "key": "tilt",
            "ui": "set_tilt",
            "kind": "menu",
            "long": "Tilt",
            "short": "Tilt",
            "enums": TILT_ENUM,
            "init": 2,
            "w": 100,
            "help": "Spectrum tilt in dB per octave, pivoted around 1 kHz.",
        },
    ]
    for i, freq in enumerate(DEFAULT_FREQS):
        n = i + 1
        base = f"obj-ctrl-b{n}"
        specs.extend([
            {
                "id": f"{base}-enable",
                "key": f"b{n}_enable",
                "ui": f"set_band_enable {i}",
                "kind": "toggle",
                "long": f"Band {n} Enable",
                "short": f"B{n} On",
                "init": 0,
                "w": 60,
                "help": f"Enable band {n}.",
            },
            {
                "id": f"{base}-mode",
                "key": f"b{n}_mode",
                "ui": f"set_band_mode {i}",
                "kind": "menu",
                "long": f"Band {n} Mode",
                "short": f"B{n} Mode",
                "enums": MODES,
                "init": 0,
                "w": 110,
                "help": f"Filter mode for band {n}.",
            },
            {
                "id": f"{base}-freq",
                "key": f"b{n}_freq",
                "ui": f"set_band_freq {i}",
                "kind": "num",
                "long": f"Band {n} Freq",
                "short": f"B{n} Freq",
                "lo": 20.0,
                "hi": 20000.0,
                "init": freq,
                "unit": 3,
                "exponent": 3.0,
                "w": 70,
                "help": f"Center or corner frequency of band {n}, in Hz.",
            },
            {
                "id": f"{base}-gain",
                "key": f"b{n}_gain",
                "ui": f"set_band_gain {i}",
                "kind": "num",
                "long": f"Band {n} Gain",
                "short": f"B{n} Gain",
                "lo": -30.0,
                "hi": 30.0,
                "init": 0.0,
                "unit": 4,
                "w": 64,
                "help": f"Gain of band {n}, in dB. Cuts and notches ignore it.",
            },
            {
                "id": f"{base}-q",
                "key": f"b{n}_q",
                "ui": f"set_band_q {i}",
                "kind": "num",
                "long": f"Band {n} Q",
                "short": f"B{n} Q",
                "lo": 0.1,
                "hi": 40.0,
                "init": 0.7071,
                "unit": 1,
                "exponent": 2.5,
                "w": 56,
                "help": f"Q of band {n} (0.1 to 40).",
            },
        ])
    return specs


def make_control(spec, x, y):
    kind = spec["kind"]
    if kind == "num":
        return make_num(
            spec["id"], spec["long"], spec["short"], spec["lo"], spec["hi"], spec["init"],
            spec["unit"], x, y, spec["w"], spec["help"], spec.get("exponent"),
        )
    if kind == "toggle":
        return make_toggle(spec["id"], spec["long"], spec["short"], spec["init"], x, y, spec["w"], spec["help"])
    if kind == "tab":
        return make_tab(spec["id"], spec["long"], spec["short"], spec["enums"], spec["init"], x, y, spec["w"], spec["help"])
    if kind == "menu":
        return make_menu(spec["id"], spec["long"], spec["short"], spec["enums"], spec["init"], x, y, spec["w"], spec["help"])
    raise ValueError(kind)


def make_panel():
    c = round(30 / 255.0, 6)
    bg = [c, c, c, 1.0]
    return {
        "box": {
            "angle": 0.0,
            "background": 1,
            "bgcolor": bg,
            "border": 0,
            "bordercolor": bg,
            "grad1": bg,
            "grad2": bg,
            "id": "obj-panel-bg",
            "maxclass": "panel",
            "mode": 0,
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [760.0, 40.0, DEVICE_W, DEVICE_H],
            "presentation": 1,
            "presentation_rect": [0.0, 0.0, DEVICE_W, DEVICE_H],
            "proportion": 0.5,
            "rounded": 0,
        }
    }


def build():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    gen_text = gendsp_json(gen_code)
    gen_hash = hashlib.sha1(gen_text.encode("utf-8")).hexdigest()[:12]
    # GEN_DSP_TEXT / GEN_DSP_HASH, then the shared math, then the face. Top-level names stay
    # (minify keeps them); the face calls into the config functions and the deferred loader.
    face = (
        f"var GEN_DSP_TEXT = {json.dumps(gen_text)};\n"
        f"var GEN_DSP_HASH = \"{gen_hash}\";\n\n"
        + config_js.rstrip()
        + "\n\n"
        + ui_js
    )
    viz_rect = [4.0, 4.0, 352.0, 161.0]
    specs = control_specs()
    route_keys = [s["key"] for s in specs]

    boxes = []
    lines = []

    # Hidden live.* parameters. No presentation rect, so none of them can cover obj-viz.
    px, py = 20.0, 40.0
    for spec in specs:
        if px + spec["w"] > 980:
            px = 20.0
            py += 26.0
        boxes.append(make_control(spec, px, py))
        px += spec["w"] + 8.0

    boxes.append({
        "box": {
            "border": 0,
            "filename": "none",
            "id": "obj-viz",
            "maxclass": "v8ui",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [20.0, 220.0, viz_rect[2], viz_rect[3]],
            "presentation": 1,
            "presentation_rect": viz_rect,
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_invisible": 1,
                    "parameter_longname": "EQPlusState",
                    "parameter_shortname": "EQPlusState",
                    "parameter_type": 3,
                }
            },
            "textfile": {
                "text": face,
                "filename": "none",
                "flags": 0,
                "embed": 1,
                "autowatch": 1,
            },
            "varname": "EQPlusViz",
        }
    })

    boxes.extend([
        newobj("obj-plugin", "plugin~", 20, 420, 60, numinlets=2, numoutlets=2, outlettype=["signal", "signal"], varname="eq_plugin"),
        newobj("obj-plugout", "plugout~", 20, 620, 70, numinlets=2, numoutlets=2, outlettype=["signal", "signal"], varname="eq_plugout"),
        # Open gate: messages enter the right inlet. The face connects its outlet to gen~ after load.
        newobj("obj-gen-in", "gate 1 1", 120, 480, 70, numinlets=2, numoutlets=1, outlettype=[""], varname="eq_genin"),
        newobj("obj-buf-cfg", "buffer~ #0-eqpluscfg @samps 64", 420, 420, 230, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-buf-spec", "buffer~ #0-eqplusspec 200 2 @samps 8200", 420, 450, 280, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-thisdevice", "live.thisdevice", 420, 490, 100, numoutlets=2, outlettype=["bang", "int"]),
        newobj("obj-trig-init", "t b b", 420, 520, 50, numoutlets=2, outlettype=["bang", "bang"]),
        message("obj-msg-init", "init_dsp", 540, 490, 70),
        message("obj-msg-setbuf", "setbuffers #0-eqpluscfg #0-eqplusspec", 540, 520, 250),
        message("obj-msg-gen-buf", "eqcfg #0-eqpluscfg, spec #0-eqplusspec", 540, 550, 250),
        newobj("obj-metro", "qmetro 33 @active 1", 420, 590, 140, outlettype=["bang"]),
        newobj("obj-route-param", "route param", 20, 680, 90, numoutlets=2, outlettype=["", ""]),
        newobj(
            "obj-route-names",
            "route " + " ".join(route_keys),
            20, 710, 720,
            numoutlets=len(route_keys) + 1,
            outlettype=[""] * (len(route_keys) + 1),
        ),
    ])

    # Right outlet of `t b b` fires first: buffer names, then the gen bind. Left outlet fires
    # last, so init_dsp runs after the face knows its buffer names.
    lines.extend([
        line("obj-thisdevice", 0, "obj-trig-init"),
        line("obj-trig-init", 1, "obj-msg-setbuf"),
        line("obj-trig-init", 1, "obj-msg-gen-buf"),
        line("obj-trig-init", 0, "obj-msg-init"),
        line("obj-msg-setbuf", 0, "obj-viz"),
        line("obj-msg-gen-buf", 0, "obj-gen-in", 1),
        line("obj-msg-init", 0, "obj-viz"),
        line("obj-metro", 0, "obj-viz"),
        line("obj-viz", 0, "obj-route-param"),
        line("obj-route-param", 0, "obj-route-names"),
        line("obj-viz", 1, "obj-gen-in", 1),
    ])

    for i, spec in enumerate(specs):
        set_id = "obj-set-" + spec["key"].replace("_", "-")
        ui_id = "obj-ui-" + spec["key"].replace("_", "-")
        row_y = 760.0 + (i % 20) * 22.0
        col = 20.0 + (i // 20) * 360.0
        boxes.append(newobj(set_id, "prepend set", col, row_y, 80))
        boxes.append(newobj(ui_id, "prepend " + spec["ui"], col + 90, row_y, 180))
        lines.append(line("obj-route-names", i, set_id))
        lines.append(line(set_id, 0, spec["id"]))
        lines.append(line(spec["id"], 0, ui_id))
        lines.append(line(ui_id, 0, "obj-viz"))
        if spec.get("gen"):
            gen_id = "obj-prep-" + spec["gen"]
            boxes.append(newobj(gen_id, "prepend " + spec["gen"], col + 280, row_y, 90))
            lines.append(line(spec["id"], 0, gen_id))
            lines.append(line(gen_id, 0, "obj-gen-in", 1))

    # Background panel LAST, with background 1, so it sits behind the canvas in Live.
    boxes.append(make_panel())

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 0,
                "architecture": "x64",
                "modernui": 1,
            },
            "classnamespace": "box",
            "rect": [80.0, 80.0, 1100.0, 700.0],
            "openrect": [0.0, 0.0, DEVICE_W, DEVICE_H],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial",
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
            "boxanimatetime": 200,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": DEVICE_W,
            "description": "Drawable eight-band equalizer with Adaptive-Q and a spectrum analyzer",
            "digest": "Eight-band EQ with bells, shelves, cuts, a notch, global shift, and a pre/post spectrum",
            "tags": "eq equalizer filter spectrum",
            "style": "",
            "subpatcher_template": "",
            "assistshowspatchername": 0,
            "boxes": boxes,
            "lines": lines,
            "parameters": {},
            "dependency_cache": [],
            "autosave": 0,
        }
    }


def write_amxd(doc, out_path):
    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import theme_common as tc
    tc.inject_theme_support(doc, "eq_plus")
    minify_patcher(doc)
    payload = (json.dumps(doc, indent="\t") + "\n").encode("utf-8")
    header = (
        b"ampf"
        + struct.pack("<I", 4)
        + b"aaaa"
        + b"meta"
        + struct.pack("<I", 4)
        + struct.pack("<I", 0)
        + b"ptch"
        + struct.pack("<I", len(payload))
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header + payload)
    print(f"Built {out_path} [{int(DEVICE_W)}x169 px] ({len(header) + len(payload)} bytes)")


if __name__ == "__main__":
    write_amxd(build(), OUT_AMXD_PATH)
