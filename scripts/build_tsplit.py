#!/usr/bin/env python3
"""
Build devices/Timbre Split.amxd (Max Audio Effect, 440 x 169 px, patcher latency 2048 samples).

Timbre Split is a Rack-chain splitter like Multiband Split, but it splits by TIMBRE CLASS instead of by frequency
band. One instance per chain; the instances of a Rack share 2..4 learned classes (kick / snare / hat, voiced /
unvoiced, ...); each chain passes only its class, and the chains add up to the (delayed) input exactly.

Layout (one layout, based on Timbre Follower A):
  - Left v8ui canvas (`obj-viz`, x = 8, y = 8, w = 270, h = 153): top strip (AUTO + class pills + Gain slider),
    MFCC heatmap tinted by the winning class, class-membership timeline, learned centroid fingerprints,
    learn progress bar, per-class gain meters and the link badge.
  - Right control panel (x = 282..434): Learn + Adapt toggles, Classes / Sharp / Smooth value bars,
    and a latency / Auto hint strip.
  - Hidden automatable Live parameters synced with the v8ui: Gain, Link Group, Class Mode.

Audio: plugin~ -> gen.codebox~ (cepstrum lib + tsplit core, 2048-sample lookahead delay) -> plugout~.
Usage: python3 scripts/build_tsplit.py
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT_DIR, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT_DIR, "src", "tsplit_core.genexpr")
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "tsplit_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "tsplit_ui.js")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Timbre Split.amxd")

DEVICE_W = 440.0
DEVICE_H = 169.0
LATENCY = 2048  # samples; = TSPLIT_LATENCY in src/tsplit_config.js and the gen Delay read
BG_DARK = (0.040, 0.044, 0.072)

AMBER = (1.0, 0.72, 0.22)
CYAN = (0.36, 0.90, 0.95)
VIOLET = (0.66, 0.52, 1.0)
EMERALD = (0.42, 0.95, 0.68)
LEARN_RED = (0.93, 0.36, 0.52)


def blend_slider_color(accent, alpha=0.38):
    return [round(accent[i] * alpha + BG_DARK[i] * (1.0 - alpha), 4) for i in range(3)] + [1.0]


# key: long name, short name, min, max, initial, unit style (0 int, 2 ms, 4 dB, 5 %), exponent, parameter_type, annotation
PARAM_SPECS = {
    "classes": (
        "Classes", "Classes", 2.0, 4.0, 3.0, 0, 1.0, 1,
        "Number of timbre classes (2-4) the linked instances split the signal into. Linked across instances in the same Rack.",
    ),
    "sharp": (
        "Sharp", "Sharp", 0.0, 100.0, 60.0, 5, 1.0, 0,
        "How hard the classes are separated: low = soft overlapping memberships, high = near-binary decisions. Linked across instances in the same Rack.",
    ),
    "smooth": (
        "Smooth", "Smooth", 0.0, 60.0, 8.0, 2, 1.0, 0,
        "Temporal smoothing of the class memberships (ms). Higher = fewer flips and softer hand-overs between chains. Linked across instances in the same Rack.",
    ),
    "gain": (
        "Chain Gain", "Gain", -70.0, 18.0, 0.0, 4, 1.0, 0,
        "Output volume for this Rack chain (-inf dB at -70 dB up to +18 dB).",
    ),
}


def valueof_dict(key):
    long_name, short_name, lo, hi, initial, unit, exponent, ptype, _help = PARAM_SPECS[key]
    v = {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short_name,
        "parameter_type": ptype,
        "parameter_unitstyle": unit,
    }
    if exponent != 1.0:
        v["parameter_exponent"] = exponent
    return v


def make_numbox(key, x, y, w, h, accent, hidden=0, patch_xy=None):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _ptype, help_text = PARAM_SPECS[key]
    px, py = patch_xy if patch_xy else (x, 300.0)
    box = {
        "activebgcolor": [BG_DARK[0], BG_DARK[1], BG_DARK[2], 1.0],
        "activeslidercolor": blend_slider_color(accent),
        "annotation": help_text,
        "annotation_name": long_name,
        "appearance": 2,
        "bordercolor": [0.20, 0.22, 0.34, 1.0],
        "fontface": 1,
        "fontsize": 8.5,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.numbox",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(px), float(py), float(w), float(h)],
        "presentation": 0 if hidden else 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": valueof_dict(key)},
        "textcolor": [0.93, 0.95, 1.0, 1.0],
        "varname": long_name,
    }
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def make_toggle(obj_id, long_name, short_name, text_off, text_on, annotation, x, y, w, h, accent, patch_y):
    return {
        "box": {
            "activebgcolor": [0.070, 0.076, 0.112, 1.0],
            "activebgoncolor": [accent[0], accent[1], accent[2], 1.0],
            "activetextcolor": [0.85, 0.88, 0.94, 1.0],
            "activetextoncolor": [0.05, 0.05, 0.08, 1.0],
            "annotation": annotation,
            "annotation_name": long_name,
            "bgcolor": [0.070, 0.076, 0.112, 1.0],
            "bgoncolor": [accent[0], accent[1], accent[2], 1.0],
            "bordercolor": [accent[0] * 0.8, accent[1] * 0.8, accent[2] * 0.8, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "id": obj_id,
            "maxclass": "live.text",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [float(x), float(patch_y), float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": long_name,
                    "parameter_enum": ["Off", "On"],
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_longname": long_name,
                    "parameter_mmax": 1,
                    "parameter_shortname": short_name,
                    "parameter_type": 2,
                }
            },
            "text": text_off,
            "texton": text_on,
            "textcolor": [0.85, 0.88, 0.94, 1.0],
            "textoncolor": [0.05, 0.05, 0.08, 1.0],
            "varname": long_name,
        }
    }


def make_menu(obj_id, long_name, short_name, enum, annotation, x, y, w, h):
    return {
        "box": {
            "activebgcolor": [0.06, 0.08, 0.11, 1.0],
            "annotation": annotation,
            "annotation_name": long_name,
            "bordercolor": [0.22, 0.28, 0.35, 1.0],
            "fontface": 1,
            "fontsize": 8.5,
            "hidden": 1,
            "id": obj_id,
            "maxclass": "live.menu",
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), float(y), float(w), float(h)],
            "presentation": 0,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_enum": enum,
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_longname": long_name,
                    "parameter_mmax": len(enum) - 1,
                    "parameter_shortname": short_name,
                    "parameter_type": 2,
                }
            },
            "textcolor": [0.88, 0.94, 1.0, 1.0],
            "varname": long_name,
        }
    }


def make_label(obj_id, text, x, y, w, h=13.0, size=8.0, color=(0.62, 0.68, 0.80), align=0):
    return {
        "box": {
            "fontface": 1,
            "fontname": "Arial Bold",
            "fontsize": float(size),
            "id": obj_id,
            "maxclass": "live.comment",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 15.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "textcolor": [color[0], color[1], color[2], 1.0],
            "textjustification": align,
        }
    }


def newobj(obj_id, text, x, y, w=100.0, h=20.0, numinlets=1, numoutlets=1, outlettype=None):
    return {
        "box": {
            "fontname": "Arial",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "newobj",
            "numinlets": numinlets,
            "numoutlets": numoutlets,
            "outlettype": outlettype if outlettype is not None else ([""] * numoutlets),
            "patching_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
        }
    }


def msgbox(obj_id, text, x, y, w=110.0, h=20.0):
    return {
        "box": {
            "fontname": "Arial",
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


def line(src, src_out, dst, dst_in=0):
    return {"patchline": {"destination": [dst, dst_in], "source": [src, src_out]}}


def panel(pid, rect, bg, bd):
    return {
        "box": {
            "angle": 270.0,
            "background": 1,
            "bgcolor": bg,
            "border": 1,
            "bordercolor": bd,
            "id": pid,
            "maxclass": "panel",
            "mode": 0,
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [30.0, 700.0, float(rect[2]), float(rect[3])],
            "presentation": 1,
            "presentation_rect": [float(v) for v in rect],
            "proportion": 0.5,
            "rounded": 6,
        }
    }


# (control key, ui message prefix) pairs wired ctrl -> prepend set_<x> -> v8ui, and v8ui ui_<x> -> prepend set -> ctrl
CONTROLS = ["classes", "sharp", "smooth", "learn", "adapt", "classmode", "linkgroup", "gain"]


def build_patcher():
    with open(LIB_PATH, "r", encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, "r", encoding="utf-8") as f:
        core = f.read()
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    gen_code = lib + "\n" + core
    combined_js = config_js + "\n\n" + ui_js
    viz_rect = [8.0, 8.0, 270.0, 153.0]

    boxes = [
        newobj("obj-plugin", "plugin~", 40, 40, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 40, 560, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
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
                "patching_rect": [40.0, 420.0, 260.0, 70.0],
            }
        },
        # Instance-local telemetry ring and centroid buffer (centroid k at k * 16)
        newobj("obj-buf-scope", "buffer~ #0-tsplitscope @samps 2592", 340, 420, 230, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-buf-cent", "buffer~ #0-tsplitcent @samps 64", 340, 450, 200, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 340, 320, 60, 20, outlettype=["bang"]),
        newobj("obj-thisdevice", "live.thisdevice", 420, 320, 85, 20, numoutlets=2, outlettype=["bang", "int"]),
        newobj("obj-freebang", "freebang", 520, 320, 60, 20, outlettype=["bang"]),
        msgbox("obj-msg-gen-buf", "scope #0-tsplitscope", 340, 360, 140),
        msgbox("obj-msg-gen-cent", "cent #0-tsplitcent", 340, 385, 130),
        msgbox("obj-msg-ui-buf", "setbuffer #0-tsplitscope", 490, 360, 160),
        msgbox("obj-msg-ui-cent", "setcent #0-tsplitcent", 490, 385, 150),
        msgbox("obj-msg-ui-init", "loadbang", 660, 360, 65),
        msgbox("obj-msg-ui-free", "notifydeleted", 740, 360, 85),
        # Saved state (versioned blob: parameters, centroids, class mode ...), bound to the v8ui through the pattr
        {
            "box": {
                "id": "obj-state-pattr",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", ""],
                "patching_rect": [660.0, 120.0, 150.0, 20.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_initial": [1, 3, 60.0, 8.0, 0, 0, 1, 0, 0.0, 1, 0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 1,
                        "parameter_longname": "TsplitStateData",
                        "parameter_shortname": "TsplitStateData",
                        "parameter_type": 3,
                    }
                },
                "text": "pattr TsplitStateData",
                "varname": "TsplitStateData",
            }
        },
        {
            "box": {
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [120.0, 160.0, viz_rect[2], viz_rect[3]],
                "presentation": 1,
                "presentation_rect": viz_rect,
                "textfile": {"autowatch": 1, "embed": 1, "filename": "none", "flags": 0, "text": combined_js},
                "varname": "TsplitVisualizer",
            }
        },
    ]

    # Right panel controls (x = 282..434). Nothing overlaps the v8ui (it ends at x = 278).
    boxes.append(make_toggle(
        "obj-ctrl-learn", "Learn", "Learn", "Learn", "Learning",
        "Learn the classes: online k-means over the next 6 bars of the incoming audio (press again to stop early), then the "
        "centroids freeze. Runs on the first chain of the Rack and is shared with every linked instance.",
        288, 12, 90, 20, LEARN_RED, 200))
    boxes.append(make_toggle(
        "obj-ctrl-adapt", "Adapt", "Adapt", "Adapt", "Adapt",
        "Adapt: let the learned centroids drift slowly toward the incoming audio instead of staying frozen. Linked across instances in the same Rack.",
        382, 12, 46, 20, EMERALD, 230))
    rows = [("classes", "Classes", VIOLET, 44), ("sharp", "Sharp", AMBER, 68), ("smooth", "Smooth", CYAN, 92)]
    for key, text, accent, y in rows:
        boxes.append(make_label(f"obj-lbl-{key}", text, 288, y + 1, 42, 13, size=8.0))
        boxes.append(make_numbox(key, 332, y, 96, 15, accent))
    boxes.append(make_label("obj-lbl-latency", f"{LATENCY} smp latency", 288, 130, 140, 11, size=7.5, color=(0.52, 0.60, 0.70)))
    boxes.append(make_label("obj-lbl-hint", "Auto: chain N passes class N", 288, 143, 140, 11, size=7.5, color=(0.52, 0.60, 0.70)))

    # Automatable Live parameters synced with the v8ui (hidden in presentation)
    boxes.append(make_numbox("gain", 320.0, 240.0, 56.0, 15.0, AMBER, hidden=1, patch_xy=(320.0, 240.0)))
    boxes.append(make_menu(
        "obj-ctrl-linkgroup", "Link Group", "Link", ["Auto", "Grp A", "Grp B", "Grp C", "Grp D", "Off"],
        "Link scope: Auto links all instances inside the same parent Audio Effect Rack (nested racks supported).",
        390.0, 240.0, 46.0, 15.0))
    boxes.append(make_menu(
        "obj-ctrl-classmode", "Class Mode", "Class", ["Auto Chain", "Class 1", "Class 2", "Class 3", "Class 4", "Multi"],
        "Which class(es) this Rack chain passes. Auto Chain passes the class matching the chain index.",
        460.0, 240.0, 65.0, 15.0))

    # Messages: widgets -> v8ui, and v8ui -> widgets (`set`, no echo) / unmatched messages -> gen
    px = 120.0
    for key in CONTROLS:
        boxes.append(newobj(f"obj-prep-{key}", f"prepend set_{key}", px, 310, 100, 20))
        px += 108.0
    boxes.append(newobj(
        "obj-route-ui", "route " + " ".join(f"ui_{k}" for k in CONTROLS), 120, 360, 440, 20,
        numinlets=1, numoutlets=len(CONTROLS) + 1, outlettype=[""] * (len(CONTROLS) + 1)))
    for i, key in enumerate(CONTROLS):
        boxes.append(newobj(f"obj-set-{key}", "prepend set", 120 + 80 * i, 390, 75, 20))

    # Background panels MUST be last in `boxes` with `"background": 1`
    boxes.append(panel("obj-panel-main", (3.0, 4.0, DEVICE_W - 6.0, 161.0), [0.055, 0.060, 0.092, 1.0], [0.13, 0.15, 0.24, 1.0]))
    boxes.append(panel("obj-panel-controls", (282.0, 6.0, 152.0, 114.0), [0.070, 0.076, 0.112, 1.0], [0.14, 0.16, 0.26, 1.0]))
    boxes.append(panel("obj-panel-info", (282.0, 125.0, 152.0, 36.0), [0.070, 0.076, 0.112, 1.0], [0.14, 0.16, 0.26, 1.0]))

    lines = [
        line("obj-plugin", 0, "obj-gen", 0),
        line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0),
        line("obj-gen", 1, "obj-plugout", 1),
    ]
    for src in ("obj-loadbang", "obj-thisdevice"):
        for dst in ("obj-msg-gen-buf", "obj-msg-gen-cent", "obj-msg-ui-buf", "obj-msg-ui-cent", "obj-msg-ui-init"):
            lines.append(line(src, 0, dst, 0))
    lines += [
        line("obj-msg-gen-buf", 0, "obj-gen", 0),
        line("obj-msg-gen-cent", 0, "obj-gen", 0),
        line("obj-msg-ui-buf", 0, "obj-viz", 0),
        line("obj-msg-ui-cent", 0, "obj-viz", 0),
        line("obj-msg-ui-init", 0, "obj-viz", 0),
        line("obj-freebang", 0, "obj-msg-ui-free", 0),
        line("obj-msg-ui-free", 0, "obj-viz", 0),
        line("obj-state-pattr", 1, "obj-viz", 0),
        line("obj-viz", 0, "obj-route-ui", 0),
    ]
    for i, key in enumerate(CONTROLS):
        lines.append(line(f"obj-ctrl-{key}", 0, f"obj-prep-{key}", 0))
        lines.append(line(f"obj-prep-{key}", 0, "obj-viz", 0))
        lines.append(line("obj-route-ui", i, f"obj-set-{key}", 0))
        lines.append(line(f"obj-set-{key}", 0, f"obj-ctrl-{key}", 0))
    lines.append(line("obj-route-ui", len(CONTROLS), "obj-gen", 0))

    parameters = {
        "obj-ctrl-classes": ["Classes", "Classes", 0],
        "obj-ctrl-sharp": ["Sharp", "Sharp", 0],
        "obj-ctrl-smooth": ["Smooth", "Smooth", 0],
        "obj-ctrl-learn": ["Learn", "Learn", 0],
        "obj-ctrl-adapt": ["Adapt", "Adapt", 0],
        "obj-ctrl-classmode": ["Class Mode", "Class", 0],
        "obj-ctrl-linkgroup": ["Link Group", "Link", 0],
        "obj-ctrl-gain": ["Chain Gain", "Gain", 0],
        "obj-state-pattr": ["TsplitStateData", "TsplitStateData", 0],
        "parameterbanks": {},
        "inherited_shortname": 1,
    }

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, DEVICE_W, DEVICE_H],
            "openrect": [0.0, 0.0, DEVICE_W, DEVICE_H],
            "devicewidth": DEVICE_W,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontname": "Arial",
            "gridsize": [8.0, 8.0],
            "boxes": boxes,
            "lines": lines,
            "parameters": parameters,
            "dependency_cache": [],
            "latency": LATENCY,
            "autosave": 0,
        }
    }


def write_amxd(patcher_dict, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    payload = (json.dumps(patcher_dict, indent=2) + "\n").encode("utf-8")
    header = (
        b"ampf\x04\x00\x00\x00"
        + b"aaaa"
        + b"meta\x04\x00\x00\x00\x00\x00\x00\x00"
        + b"ptch"
        + struct.pack("<I", len(payload))
    )
    with open(out_path, "wb") as f:
        f.write(header + payload)
    print(f"Built {out_path} ({len(payload)} bytes JSON payload, {int(DEVICE_W)}x{int(DEVICE_H)} px, latency {LATENCY})")


if __name__ == "__main__":
    write_amxd(build_patcher(), OUT_AMXD_PATH)
