#!/usr/bin/env python3
"""
Build devices/Envelope Trigger.amxd

Audio effect that detects transients and sends MIDI notes to any track, the way
External Instrument does: the device's own MIDI output (`midiout`) is routed through
its LOM DeviceIO (`this_device midi_outputs 0`), mirrored by two hidden "MIDI To"
live.menus (type + channel). Live stores the routing with the set.

Layout (169 px tall, 228 px collapsed / 342 px with the MIDI To panel open):
  - Main (x=4..204): graph v8ui (envelope or oscilloscope view via an in-graph toggle saved in
    the hidden `Graph View` live.text, draggable threshold, thin full-height fired-note ticks,
    velocity LED, MIDI To destination HUD) with the Threshold / Sens / Hold dials underneath.
  - Strip (x=208..224): collapsible "MIDI TO" strip like Envelope Follower's "Audio Routing".
    Clicking it toggles the hidden `MIDI To Panel` live.text (Toggle mode), which resizes the
    device via live.thisdevice `setwidth` and shows/hides the panel widgets. live.thisdevice
    re-applies the saved state through an `i` store on load.
  - MIDI To panel (x=228..338, hidden when collapsed): MIDI To type & channel menus, Note,
    MIDI Ch, Length, Vel Lo, Vel Hi.
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "envtrig_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "envtrig_ui.js")
STRIP_PATH = os.path.join(ROOT_DIR, "src", "envtrig_strip.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "envtrig_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Envelope Trigger.amxd")

SCOPE_BUFFER_SAMPS = 800  # header + 256-block oscilloscope ring; matches src/envtrig_config.js
WIDTH_COLLAPSED = 228.0
WIDTH_EXPANDED = 342.0
DEVICE_H = 169.0

CYAN = (0.28, 0.84, 0.96)
AMBER = (0.96, 0.66, 0.25)
MIDI_LBL = (0.84, 0.70, 0.48)

# key: (long_name, short_name, lo, hi, initial, ptype, unitstyle, exponent, gen_param, is_pct, help_text)
#   ptype 0 = Float, 1 = Int. gen_param None = not sent to gen.
PARAM_SPECS = {
    "thr": ("Threshold", "Thresh", -60.0, 0.0, -24.0, 0, 4, 1.0, "thr", False,
            "Level a hit must exceed to fire a note. Also draggable on the graph."),
    "sens": ("Sensitivity", "Sens", 0.0, 100.0, 50.0, 0, 5, 1.0, "sens", True,
             "How far a hit must jump above the recent level to count as a transient. 100% fires on the threshold alone; 0% needs a 12 dB jump."),
    "hold": ("Hold", "Hold", 20.0, 1000.0, 60.0, 0, 2, 2.0, "holdms", False,
             "Retrigger lockout after each note, so one hit only fires once."),
    "note": ("Note", "Note", 0, 127, 36, 1, 8, 1.0, None, False,
             "MIDI note fired on each hit."),
    "chan": ("MIDI Channel", "Ch", 1, 16, 1, 1, 0, 1.0, None, False,
             "MIDI channel of the fired notes."),
    "len": ("Note Length", "Length", 5.0, 2000.0, 100.0, 0, 2, 2.0, None, False,
            "How long each fired note is held before its note-off."),
    "velmin": ("Velocity Low", "Vel Lo", 1, 127, 40, 1, 0, 1.0, "velmin", False,
               "Velocity of a hit right at the threshold."),
    "velmax": ("Velocity High", "Vel Hi", 1, 127, 127, 1, 0, 1.0, "velmax", False,
               "Velocity of a hit at 0 dBFS."),
}

# Everything shown only while the MIDI To panel is open (sent `hidden 0/1`).
PANEL_IDS = [
    "obj-route-type", "obj-route-chan",
    "obj-lbl-note", "obj-ctrl-note", "obj-lbl-chan", "obj-ctrl-chan", "obj-lbl-len", "obj-ctrl-len",
    "obj-lbl-velmin", "obj-ctrl-velmin", "obj-lbl-velmax", "obj-ctrl-velmax",
    "obj-panel-midi",
]


def valueof_dict(key):
    long_name, short, lo, hi, initial, ptype, unit, exponent, _gen, _pct, _help = PARAM_SPECS[key]
    v = {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": ptype,
        "parameter_unitstyle": unit,
    }
    if exponent != 1.0:
        v["parameter_exponent"] = exponent
    return v


def newobj(obj_id, text, x, y, w, h=20.0, numinlets=1, numoutlets=1, outlettype=None):
    return {
        "box": {
            "fontname": "Arial Bold",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "newobj",
            "numinlets": numinlets,
            "numoutlets": numoutlets,
            "outlettype": outlettype if outlettype is not None else [""] * numoutlets,
            "patching_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
        }
    }


def message(obj_id, text, x, y, w, h=20.0):
    return {
        "box": {
            "fontname": "Arial Bold",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "message",
            "numinlets": 2,
            "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
        }
    }


def make_dial(key, x, y, w=44.0, h=46.0, color_rgb=CYAN):
    long_name, *_rest, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activedialcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [x, 220.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "varname": long_name,
        }
    }


def make_numbox(key, x, y, w=56.0, h=15.0, color_rgb=AMBER, hidden=0):
    long_name, *_rest, help_text = PARAM_SPECS[key]
    box = {
        "activebgcolor": [0.06, 0.075, 0.095, 1.0],
        "annotation": help_text,
        "annotation_name": long_name,
        "appearance": 0,
        "bordercolor": [0.22, 0.27, 0.33, 1.0],
        "fontface": 1,
        "fontsize": 9.0,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.numbox",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [x, 275.0, w, h],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": valueof_dict(key)},
        "textcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
        "varname": long_name,
    }
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def make_label(obj_id, text, x, y, w, h=13.0, size=8.0, color=MIDI_LBL, hidden=0):
    box = {
        "fontface": 1,
        "fontname": "Arial Bold",
        "fontsize": float(size),
        "id": obj_id,
        "maxclass": "live.comment",
        "numinlets": 1,
        "numoutlets": 0,
        "patching_rect": [x, 15.0, w, h],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "text": text,
        "textcolor": [color[0], color[1], color[2], 1.0],
        "textjustification": 0,
    }
    if hidden:
        box["hidden"] = 1
        box["varname"] = obj_id
    return {"box": box}


def make_routing_menu(obj_id, long_name, short, enum, help_text, x, y, w=102.0, h=15.0):
    # Hidden parameter with initial value disabled: the menu only mirrors the LOM routing,
    # whose real state Live saves with the device.
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "bordercolor": [0.42, 0.36, 0.26, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "hidden": 1,
            "id": obj_id,
            "maxclass": "live.menu",
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [700.0, 100.0 if obj_id.endswith("type") else 130.0, w, h],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": long_name,
                    "parameter_enum": enum,
                    "parameter_info": help_text,
                    "parameter_invisible": 2,
                    "parameter_linknames": 1,
                    "parameter_longname": long_name,
                    "parameter_mmax": len(enum) - 1,
                    "parameter_shortname": short,
                    "parameter_type": 2,
                }
            },
            "textcolor": [AMBER[0], AMBER[1], AMBER[2], 1.0],
            "varname": long_name,
        }
    }


def make_state_toggle(obj_id, long_name, short, enum, patch_y):
    # Stored (not automatable) UI state, not in presentation — a v8ui is its face.
    # Toggle mode: Button mode (0) never latches the state.
    return {
        "box": {
            "id": obj_id,
            "maxclass": "live.text",
            "mode": 1,
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [860.0, patch_y, 60.0, 15.0],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_enum": enum,
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_invisible": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": long_name,
                    "parameter_mmax": 1,
                    "parameter_shortname": short,
                    "parameter_type": 2,
                }
            },
            "text": short,
            "texton": short,
            "varname": long_name,
        }
    }


def make_v8ui(obj_id, code, rect, patch_xy, numoutlets):
    return {
        "box": {
            "border": 0,
            "filename": "none",
            "id": obj_id,
            "maxclass": "v8ui",
            "numinlets": 1,
            "numoutlets": numoutlets,
            "outlettype": [""] * numoutlets,
            "patching_rect": [patch_xy[0], patch_xy[1], rect[2], rect[3]],
            "presentation": 1,
            "presentation_rect": [float(v) for v in rect],
            "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
        }
    }


def make_panel(obj_id, x, y, w, h, bg=(0.10, 0.11, 0.13), border=(0.22, 0.26, 0.32), rounded=6, hidden=0):
    box = {
        "angle": 270.0,
        "background": 1,
        "bgcolor": [bg[0], bg[1], bg[2], 1.0],
        "border": 1,
        "bordercolor": [border[0], border[1], border[2], 1.0],
        "grad1": [bg[0], bg[1], bg[2], 1.0],
        "grad2": [bg[0] * 0.85, bg[1] * 0.85, bg[2] * 0.85, 1.0],
        "id": obj_id,
        "maxclass": "panel",
        "mode": 0,
        "numinlets": 1,
        "numoutlets": 0,
        "patching_rect": [float(x), 10.0, float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "proportion": 0.39,
        "rounded": rounded,
    }
    if hidden:
        box["hidden"] = 1
        box["varname"] = obj_id
    return {"box": box}


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def build():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(STRIP_PATH, "r", encoding="utf-8") as f:
        strip_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    v8_code = config_js.rstrip() + "\n\n" + ui_js

    boxes = [
        make_v8ui("obj-viz", v8_code, [8.0, 8.0, 192.0, 104.0], (20.0, 80.0), 3),
        make_dial("thr", 18, 116),
        make_dial("sens", 82, 116),
        make_dial("hold", 146, 116),
        make_v8ui("obj-strip", strip_js, [208.0, 4.0, 16.0, 161.0], (860.0, 40.0), 1),  # code patched below
        make_state_toggle("obj-panel-toggle", "MIDI To Panel", "MIDI To", ["Closed", "Open"], 10.0),
        make_state_toggle("obj-view-toggle", "Graph View", "View", ["Envelope", "Scope"], 160.0),
        # MIDI To panel (x=228..338), hidden while collapsed
        make_routing_menu(
            "obj-route-type", "MIDI Output Type", "MIDI To", ["No Output", "-"],
            "Selects the track (or external MIDI port) that receives the fired notes, like External Instrument's MIDI To.",
            232, 10,
        ),
        make_routing_menu(
            "obj-route-chan", "MIDI Output Channel", "MIDI Ch To", ["-", "-"],
            "Selects the input of the destination track (Track In, or a device inside it).",
            232, 27,
        ),
    ]
    rows = [("note", "Note"), ("chan", "MIDI Ch"), ("len", "Length"), ("velmin", "Vel Lo"), ("velmax", "Vel Hi")]
    for i, (key, text) in enumerate(rows):
        y = 52 + i * 22
        boxes.append(make_label(f"obj-lbl-{key}", text, 232, y + 1, 44, hidden=1))
        boxes.append(make_numbox(key, 278, y, 56, 15, hidden=1))

    boxes.extend([
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 460, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 4,
                "outlettype": ["signal"] * 4,
                "patching_rect": [120.0, 300.0, 420.0, 140.0],
                "varname": "envtrig",
            }
        },
        newobj("obj-scope", f"buffer~ #0-trigscope @samps {SCOPE_BUFFER_SAMPS}", 560, 240, 210, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 300, 60, outlettype=["bang"]),
        message("obj-msg-ui-buf", "setbuffer #0-trigscope", 560, 330, 180),
        message("obj-msg-gen-buf", "scope #0-trigscope", 560, 360, 180),
        # live.thisdevice: init routing, restore the panel state, and receive setwidth
        newobj("obj-thisdevice", "live.thisdevice", 700, 10, 85, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init-routing", "init_routing", 800, 40, 80),
        message("obj-msg-settype", "settype $1", 820, 100, 80),
        message("obj-msg-setchan", "setchannel $1", 820, 130, 90),
        # Panel toggle -> strip face, device width, widget visibility. The toggle feeds `t i` and an
        # `i` store; live.thisdevice bangs the store (a bang to a Toggle live.text would flip it).
        newobj("obj-open-store", "i 0", 860, 70, 40, numinlets=2, numoutlets=1, outlettype=["int"]),
        newobj("obj-open-fan", "t i", 940, 10, 30, numinlets=1, numoutlets=1, outlettype=["int"]),
        newobj("obj-ui-open", "prepend set_open", 940, 40, 100),
        newobj("obj-expr-width", f"expr {int(WIDTH_COLLAPSED)} + $i1 * {int(WIDTH_EXPANDED - WIDTH_COLLAPSED)}", 940, 70, 130),
        newobj("obj-prep-setwidth", "prepend setwidth", 940, 100, 100),
        newobj("obj-eq-hidden", "== 0", 1080, 70, 40),
        newobj("obj-prep-hidden", "prepend hidden", 1080, 100, 90),
        # Threshold drag from the graph -> gen + dial
        newobj("obj-route-viz", "route thr view", 20, 215, 90, numinlets=3, numoutlets=3),
        # Graph view toggle (envelope / scope), re-applied on load like the panel state
        newobj("obj-view-store", "i 0", 860, 190, 40, numinlets=2, numoutlets=1, outlettype=["int"]),
        newobj("obj-ui-view", "prepend set_view", 940, 190, 100),
        newobj("obj-set-thr", "prepend set", 100, 245, 75),
        newobj("obj-ui-thr", "prepend set_thr", 560, 390, 100),
        newobj("obj-ui-note", "prepend set_note", 700, 400, 105),
        # Note path: gate -> edge~ -> t b b; right samples the held velocity, left outputs the note
        newobj("obj-edge", "edge~", 120, 560, 45, numinlets=1, numoutlets=2, outlettype=["bang", "bang"]),
        newobj("obj-trig", "t b b", 120, 586, 40, numinlets=1, numoutlets=2, outlettype=["bang", "bang"]),
        newobj("obj-snap", "snapshot~", 170, 612, 65, numinlets=2, numoutlets=1, outlettype=["float"]),
        newobj("obj-note", f"i {PARAM_SPECS['note'][4]}", 120, 638, 40, numinlets=2, numoutlets=1, outlettype=["int"]),
        newobj("obj-makenote", "makenote 100 100", 120, 700, 110, numinlets=3, numoutlets=2, outlettype=["float", "float"]),
        newobj("obj-pack-note", "pack 0 0", 120, 730, 60, numinlets=2, numoutlets=1),
        newobj("obj-midiformat", "midiformat", 120, 760, 70, numinlets=7, numoutlets=1, outlettype=["int"]),
        newobj("obj-midiout", "midiout", 120, 790, 55, numinlets=1, numoutlets=0, outlettype=[]),
    ])

    lines = [
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-ui-buf", 0),
        line("obj-loadbang", 0, "obj-msg-gen-buf", 0),
        line("obj-msg-ui-buf", 0, "obj-viz", 0),
        line("obj-msg-gen-buf", 0, "obj-gen", 0),
        line("obj-thisdevice", 0, "obj-msg-init-routing", 0),
        line("obj-msg-init-routing", 0, "obj-viz", 0),
        line("obj-thisdevice", 0, "obj-open-store", 0),
        line("obj-panel-toggle", 0, "obj-open-store", 1),
        line("obj-panel-toggle", 0, "obj-open-fan", 0),
        line("obj-open-store", 0, "obj-open-fan", 0),
        line("obj-viz", 1, "obj-route-type", 0),
        line("obj-viz", 2, "obj-route-chan", 0),
        line("obj-route-type", 0, "obj-msg-settype", 0),
        line("obj-route-chan", 0, "obj-msg-setchan", 0),
        line("obj-msg-settype", 0, "obj-viz", 0),
        line("obj-msg-setchan", 0, "obj-viz", 0),
        line("obj-strip", 0, "obj-panel-toggle", 0),
        line("obj-open-fan", 0, "obj-ui-open", 0),
        line("obj-ui-open", 0, "obj-strip", 0),
        line("obj-open-fan", 0, "obj-expr-width", 0),
        line("obj-expr-width", 0, "obj-prep-setwidth", 0),
        line("obj-prep-setwidth", 0, "obj-thisdevice", 0),
        line("obj-open-fan", 0, "obj-eq-hidden", 0),
        line("obj-eq-hidden", 0, "obj-prep-hidden", 0),
        line("obj-viz", 0, "obj-route-viz", 0),
        line("obj-route-viz", 1, "obj-view-toggle", 0),
        line("obj-view-toggle", 0, "obj-view-store", 1),
        line("obj-view-toggle", 0, "obj-ui-view", 0),
        line("obj-thisdevice", 0, "obj-view-store", 0),
        line("obj-view-store", 0, "obj-ui-view", 0),
        line("obj-ui-view", 0, "obj-viz", 0),
        line("obj-route-viz", 0, "obj-prep-thr", 0),
        line("obj-route-viz", 0, "obj-set-thr", 0),
        line("obj-set-thr", 0, "obj-ctrl-thr", 0),
        line("obj-ctrl-thr", 0, "obj-ui-thr", 0),
        line("obj-ui-thr", 0, "obj-viz", 0),
        line("obj-ctrl-note", 0, "obj-note", 1),
        line("obj-ctrl-note", 0, "obj-ui-note", 0),
        line("obj-ui-note", 0, "obj-viz", 0),
        line("obj-gen", 2, "obj-edge", 0),
        line("obj-gen", 3, "obj-snap", 0),
        line("obj-edge", 0, "obj-trig", 0),
        line("obj-trig", 1, "obj-snap", 0),
        line("obj-trig", 0, "obj-note", 0),
        line("obj-snap", 0, "obj-makenote", 1),
        line("obj-note", 0, "obj-makenote", 0),
        line("obj-makenote", 0, "obj-pack-note", 0),
        line("obj-makenote", 1, "obj-pack-note", 1),
        line("obj-pack-note", 0, "obj-midiformat", 0),
        line("obj-midiformat", 0, "obj-midiout", 0),
        line("obj-ctrl-chan", 0, "obj-midiformat", 6),
        line("obj-ctrl-len", 0, "obj-makenote", 2),
    ]
    for pid in PANEL_IDS:
        lines.append(line("obj-prep-hidden", 0, pid, 0))

    # Test hook: `; envtrig-test test_click` / `test_report` drive the strip from standalone Max
    # or the Ableton MCP bridge; the strip also mirrors the setwidth value for its report.
    boxes.extend([
        newobj("obj-r-test", "receive envtrig-test", 860, 210, 120, numinlets=0, numoutlets=1),
        newobj("obj-ui-width", "prepend set_width", 940, 130, 105),
    ])
    lines.extend([
        line("obj-r-test", 0, "obj-strip", 0),
        line("obj-expr-width", 0, "obj-ui-width", 0),
        line("obj-ui-width", 0, "obj-strip", 0),
    ])

    for i, (key, spec) in enumerate(PARAM_SPECS.items()):
        gen_param, is_pct = spec[8], spec[9]
        if gen_param is None:
            continue
        ctrl_id = f"obj-ctrl-{key}"
        prep_id = f"obj-prep-{key}"
        row_y = 500.0 + i * 26.0
        src_id = ctrl_id
        if is_pct:
            scale_id = f"obj-scale-{key}"
            boxes.append(newobj(scale_id, "/ 100.", 360, row_y, 52, numinlets=2, numoutlets=1, outlettype=["float"]))
            lines.append(line(ctrl_id, 0, scale_id, 0))
            src_id = scale_id
        boxes.append(newobj(prep_id, f"prepend {gen_param}", 424, row_y, 110))
        lines.append(line(src_id, 0, prep_id, 0))
        lines.append(line(prep_id, 0, "obj-gen", 0))

    # Background panels MUST be last in boxes and have "background": 1
    boxes.extend([
        make_panel("obj-panel-main", 4, 4, 200, 161),
        make_panel("obj-panel-midi", 228, 4, 110, 161, bg=(0.11, 0.10, 0.12), border=(0.54, 0.38, 0.20), hidden=1),
    ])

    by_id = {b["box"]["id"]: b["box"] for b in boxes}
    panel_names = [by_id[pid]["varname"] for pid in PANEL_IDS]
    by_id["obj-strip"]["textfile"]["text"] = f"var PANEL_NAMES = {json.dumps(panel_names)};\n\n" + strip_js

    patcher = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, WIDTH_EXPANDED, DEVICE_H],
            "openrect": [0.0, 0.0, WIDTH_COLLAPSED, DEVICE_H],
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
            "boxanimatetime": 200,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": WIDTH_COLLAPSED,
            "description": "Transient detector that fires MIDI notes from an audio track to any MIDI track",
            "digest": "Transient detection with a collapsible, native-style MIDI To chooser",
            "tags": "trigger transient drum replacement midi envelope",
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

    payload = (json.dumps(patcher, indent="\t") + "\n").encode("utf-8")
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
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)
    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + payload)
    print(f"Built {OUT_AMXD_PATH} [{int(WIDTH_COLLAPSED)}/{int(WIDTH_EXPANDED)}x169 px] ({len(header) + len(payload)} bytes)")


if __name__ == "__main__":
    build()
