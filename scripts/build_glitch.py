#!/usr/bin/env python3
"""
Build devices/Glitch.amxd — a Max for Live audio effect with a pool of hidden FX modules in one fixed chain.

Signal path: plugin~ -> gen.codebox~ (src/cepstrum_lib.genexpr + src/glitch_core.genexpr, tokens filled from
src/glitch_config.js) -> plugout~. Latency is constant: 1023 samples (the STFT's N - 1, N = 1024), the dry path is
delayed identically (patcher attribute "latency": 1023).

Deferred DSP (AGENTS.md 1d): the device ships WITHOUT its gen~. The gen patch is embedded in the v8ui script as .gendsp
JSON (GEN_DSP_TEXT); after live.thisdevice's ready bang plus one Task tick the v8ui writes /tmp/glitch_core_<hash>.gendsp,
creates `gen~ @gen <file>` and wires it: every gen-bound message goes through the `gate 1 1` hub (varname gl_genin), plugin~
(gl_plugin) feeds the gen, and its outputs enter selector~ 2 1 (gl_selL / gl_selR) input 2. Until the gen runs the selectors
pass the dry signal (input 1); dsp_on 2 switches them. dsp_ready re-sends the buffer binding, Mix, Output, bpm and ppq.

Engine contract:
  buffer~ #0-glitchslots @samps 9472  UI -> gen. 8 slot vectors of NP floats + 8 weights at GL weightsOffset + the 24-float
                                      sequencer block at seqOffset (mode header, pack version, 16 steps) + the layout constants block (meta, defaults,
                                      wet indices, minimums, maximums; see src/glitch_config.js).
  buffer~ #0-glitchscope @samps 640   gen -> UI telemetry (layout GL_SCOPE in src/glitch_config.js).
  loadbang binds both buffers in gen (`slots ..., scope ...`) and in the v8ui (`setbuffer ...`).
  plugsync~ feeds the gen Params `bpm`, `ppq` and `playing` (outlet 0, the transport state: the sequencer clock holds while 0). Mix -> Param `wet` (0..1), Output -> Param `outdb` (dB).
  The v8ui keeps the whole state in the blob parameter GlitchStateData ([version, json]).
Live parameters (src/glitch_config.js GL_PARAMS, real live.* objects, NOT in presentation): Morph X / Y, Chaos, Mix, Output,
Randomize, Mutate (trigger toggles), Mode (Working / Morph / Seq), Seq Rate, Glide and Seq Length. The v8ui draws every control.

Usage: build_glitch.py [--preview-editor|--preview-seq|--preview-options|--preview-many|--preview-many2|--preview-motion|--preview-new|--preview-specedit|--preview-options2|--preview-all]
(each writes tests/out/Glitch_<name>.amxd in that UI state; render_preview.py on it writes previews/glitch_<name>.png)
"""

import hashlib
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import glitch_common as gc

ROOT_DIR = gc.ROOT_DIR
UI_PATH = os.path.join(ROOT_DIR, "src", "glitch_ui.js")
DEVICES_DIR = os.path.join(ROOT_DIR, "devices")
OUT_PATH = os.path.join(DEVICES_DIR, "Glitch.amxd")

PREVIEW_DIR = os.path.join(ROOT_DIR, "tests", "out")

DEVICE_H = 169.0


# ----------------------------------------------------------------------------- box helpers
def newobj(obj_id, text, x, y, w, numinlets=1, numoutlets=1, outlettype=None, varname=None):
    box = {
        "fontname": "Arial Bold",
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
    b = newobj(obj_id, text, x, y, w)
    b["box"]["maxclass"] = "message"
    b["box"]["numinlets"] = 2
    return b


def line(src, outlet, dst, inlet=0):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def param_box(key, spec, x, y):
    """A real live.* parameter object kept OFF the face (no presentation): the v8ui draws the control and drives it."""
    long_name = spec["long"]
    if spec["kind"] in ("dial", "int"):
        is_int = spec["kind"] == "int"
        valueof = {
            "parameter_annotation_name": long_name,
            "parameter_initial": [spec["init"]],
            "parameter_initial_enable": 1,
            "parameter_linknames": 1,
            "parameter_longname": long_name,
            "parameter_mmax": spec["hi"],
            "parameter_mmin": spec["lo"],
            "parameter_shortname": spec["short"],
            "parameter_type": 1 if is_int else 0,
            "parameter_unitstyle": spec["unit"],
        }
        box = {"maxclass": "live.dial", "numoutlets": 2, "outlettype": ["", "float"], "patching_rect": [float(x), float(y), 44.0, 48.0]}
    elif spec["kind"] == "enum":
        # n-state enum: a live.menu (value = index), driven by `set` / int from the face
        valueof = {
            "parameter_annotation_name": long_name,
            "parameter_enum": spec["enums"],
            "parameter_initial": [spec["init"]],
            "parameter_initial_enable": 1,
            "parameter_linknames": 1,
            "parameter_longname": long_name,
            "parameter_mmax": len(spec["enums"]) - 1,
            "parameter_shortname": spec["short"],
            "parameter_type": 2,
        }
        box = {"maxclass": "live.menu", "numoutlets": 3, "outlettype": ["", "", "float"], "patching_rect": [float(x), float(y), 60.0, 16.0]}
    else:
        valueof = {
            "parameter_annotation_name": long_name,
            "parameter_enum": spec["enums"],
            "parameter_initial": [spec["init"]],
            "parameter_initial_enable": 1,
            "parameter_linknames": 1,
            "parameter_longname": long_name,
            "parameter_mmax": len(spec["enums"]) - 1,
            "parameter_shortname": spec["short"],
            "parameter_type": 2,
        }
        box = {"maxclass": "live.text", "mode": 1, "text": spec["enums"][0], "texton": spec["enums"][1], "numoutlets": 2, "outlettype": ["", ""],
               "patching_rect": [float(x), float(y), 50.0, 16.0]}
    box.update({
        "id": f"obj-ctrl-{key}",
        "numinlets": 1,
        "parameter_enable": 1,
        "saved_attribute_attributes": {"valueof": valueof},
        "varname": long_name,
    })
    return {"box": box}


# ----------------------------------------------------------------------------- UI + parameters
def ui_boxes(layout, width, gen_dsp_text, gen_dsp_hash, preview):
    with open(gc.CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    script = (
        config_js
        + f"\nvar GEN_DSP_TEXT = {json.dumps(gen_dsp_text)};\nvar GEN_DSP_HASH = \"{gen_dsp_hash}\";\n"
        + f"var UI_PREVIEW = {json.dumps(preview)};\n"
        + ui_js
    )
    boxes = []
    lines = []
    keys = layout["paramKeys"]
    params = layout["params"]
    for i, key in enumerate(keys):
        boxes.append(param_box(key, params[key], 20 + i * 70, 640))
    boxes.append(
        {
            "box": {
                "border": 0,
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "parameter_enable": 1,
                "patching_rect": [20.0, 80.0, float(width), DEVICE_H],
                "presentation": 1,
                "presentation_rect": [0.0, 0.0, float(width), DEVICE_H],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_invisible": 1,
                        "parameter_longname": "GlitchStateData",
                        "parameter_shortname": "GlitchStateData",
                        "parameter_type": 3,
                    }
                },
                "textfile": {"text": script, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
                "varname": "obj-viz",
            }
        }
    )
    # v8ui outlet 0 -> route: param <key> <v> | setwidth_cmd | dsp_ready | dsp_on
    boxes += [
        newobj("obj-route-viz", "route param setwidth_cmd dsp_ready dsp_on", 20, 520, 330, numoutlets=5),
        newobj("obj-route-param", "route " + " ".join(keys), 20, 550, 420, numoutlets=len(keys) + 1),
        newobj("obj-prep-setwidth", "prepend setwidth", 380, 560, 102),
        newobj("obj-thisdevice", "live.thisdevice", 380, 590, 90, numoutlets=3, outlettype=["bang", "int", "int"]),
        message("obj-msg-ready", "device_ready", 380, 620, 82),
        newobj("obj-debug-recv", "receive #0-glitchdebug", 560, 520, 150, numinlets=0),
    ]
    lines += [
        line("obj-viz", 0, "obj-route-viz"),
        line("obj-route-viz", 0, "obj-route-param"),
        line("obj-route-viz", 1, "obj-prep-setwidth"),
        line("obj-prep-setwidth", 0, "obj-thisdevice"),
        line("obj-thisdevice", 0, "obj-msg-ready"),
        line("obj-msg-ready", 0, "obj-viz"),
        line("obj-debug-recv", 0, "obj-viz"),
    ]
    for i, key in enumerate(keys):
        spec = params[key]
        ctrl = f"obj-ctrl-{key}"
        lines.append(line("obj-route-param", i, ctrl))
        up = f"obj-uiprep-{key}"
        boxes.append(newobj(up, f"prepend set_{key}", 20 + i * 70, 690, 66))
        lines += [line(ctrl, 0, up), line(up, 0, "obj-viz")]
        if spec.get("gen"):
            src = ctrl
            if abs(spec["scale"] - 1.0) > 1e-9:
                boxes.append(newobj(f"obj-scale-{key}", f"* {spec['scale']}", 20 + i * 70, 720, 56, numinlets=2, outlettype=["float"]))
                lines.append(line(ctrl, 0, f"obj-scale-{key}"))
                src = f"obj-scale-{key}"
            boxes.append(newobj(f"obj-prep-{key}", f"prepend {spec['gen']}", 20 + i * 70, 750, 90))
            lines += [line(src, 0, f"obj-prep-{key}"), line(f"obj-prep-{key}", 0, "obj-gen-in", 1)]
    return boxes, lines


# ----------------------------------------------------------------------------- engine (everything except the gen~)
def engine_boxes(layout):
    """plugin~ -> selectors -> plugout~, the gen hub, the two buffers, their bindings and the transport."""
    boxes = [
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"], varname="gl_plugin"),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"], varname="gl_plugout"),
        # dry until the gen runs (input 1), the gen's output afterwards (input 2): the v8ui sends dsp_on 2
        newobj("obj-selL", "selector~ 2 1", 20, 340, 80, numinlets=3, numoutlets=1, outlettype=["signal"], varname="gl_selL"),
        newobj("obj-selR", "selector~ 2 1", 120, 340, 80, numinlets=3, numoutlets=1, outlettype=["signal"], varname="gl_selR"),
        # the gen~ is created by the v8ui after load; every gen-bound message goes through this open gate
        newobj("obj-gen-in", "gate 1 1", 240, 300, 60, numinlets=2, numoutlets=1, varname="gl_genin"),
        newobj("obj-slots-buf", f"buffer~ #0-glitchslots @samps {layout['slotsBufSamps']}", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-scope-buf", f"buffer~ #0-glitchscope @samps {layout['scopeSamps']}", 560, 275, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 305, 60, outlettype=["bang"]),
        message("obj-msg-ui-buf", "setbuffer #0-glitchslots #0-glitchscope", 560, 335, 260),
        message("obj-msg-gen-buf", "slots #0-glitchslots, scope #0-glitchscope", 560, 365, 260),
        newobj("obj-sync", "plugsync~", 740, 40, 80, numoutlets=9, outlettype=["int", "int", "int", "float", "list", "float", "float", "int", "int"]),
        newobj("obj-bpm-chg", "change 0.", 740, 70, 60, numoutlets=3, outlettype=["", "int", "int"]),
        newobj("obj-bpm-hold", "f", 740, 95, 30, numinlets=2, outlettype=["float"]),
        newobj("obj-bpm-prep", "prepend bpm", 740, 120, 90),
        newobj("obj-ppq-chg", "change -1.", 840, 70, 66, numoutlets=3, outlettype=["", "int", "int"]),
        newobj("obj-ppq-hold", "f", 840, 95, 30, numinlets=2, outlettype=["float"]),
        newobj("obj-ppq-prep", "prepend ppq", 840, 120, 90),
        # transport state (plugsync~ outlet 0) -> gen Param `playing`: the sequencer clock holds while it is 0
        newobj("obj-play-chg", "change 0", 940, 70, 60, numoutlets=3, outlettype=["", "int", "int"]),
        newobj("obj-play-hold", "f", 940, 95, 30, numinlets=2, outlettype=["float"]),
        newobj("obj-play-prep", "prepend playing", 940, 120, 100),
        # dsp_ready: re-send the buffer binding (first), Mix, Output, bpm and ppq to the freshly created gen
        newobj("obj-dsp-resend", "t b b b b b b", 380, 400, 100, numoutlets=6, outlettype=["bang"] * 6),
    ]
    lines = [
        # until the gen exists the output is the dry input
        line("obj-plugin", 0, "obj-selL", 1),
        line("obj-plugin", 1, "obj-selR", 1),
        line("obj-selL", 0, "obj-plugout", 0),
        line("obj-selR", 0, "obj-plugout", 1),
        line("obj-route-viz", 3, "obj-selL", 0),
        line("obj-route-viz", 3, "obj-selR", 0),
        line("obj-loadbang", 0, "obj-msg-ui-buf"),
        line("obj-loadbang", 0, "obj-msg-gen-buf"),
        line("obj-msg-ui-buf", 0, "obj-viz"),
        line("obj-msg-gen-buf", 0, "obj-gen-in", 1),
        line("obj-sync", 5, "obj-bpm-chg"),
        line("obj-bpm-chg", 0, "obj-bpm-hold"),
        line("obj-bpm-hold", 0, "obj-bpm-prep"),
        line("obj-bpm-prep", 0, "obj-gen-in", 1),
        line("obj-sync", 6, "obj-ppq-chg"),
        line("obj-ppq-chg", 0, "obj-ppq-hold"),
        line("obj-ppq-hold", 0, "obj-ppq-prep"),
        line("obj-ppq-prep", 0, "obj-gen-in", 1),
        line("obj-sync", 0, "obj-play-chg"),
        line("obj-play-chg", 0, "obj-play-hold"),
        line("obj-play-hold", 0, "obj-play-prep"),
        line("obj-play-prep", 0, "obj-gen-in", 1),
        line("obj-route-viz", 2, "obj-dsp-resend"),
        line("obj-dsp-resend", 5, "obj-msg-gen-buf"),
        line("obj-dsp-resend", 4, "obj-ctrl-mix"),
        line("obj-dsp-resend", 3, "obj-ctrl-out"),
        line("obj-dsp-resend", 2, "obj-bpm-hold"),
        line("obj-dsp-resend", 1, "obj-ppq-hold"),
        line("obj-dsp-resend", 0, "obj-play-hold"),
    ]
    return boxes, lines


PREVIEWS = ("editor", "seq", "options", "many", "many2", "motion", "new", "specedit", "options2")


def build_patcher(preview=""):
    layout = gc.load_layout()
    face = layout["faces"][preview] if preview else layout["face"]
    width = int(face["width"])
    gen_code = gc.gen_source(layout)
    gen_dsp_text = gc.gendsp_json(gen_code)
    gen_dsp_hash = hashlib.sha1(gen_dsp_text.encode("utf-8")).hexdigest()[:12]
    ui_b, ui_l = ui_boxes(layout, width, gen_dsp_text, gen_dsp_hash, preview)
    eng_b, eng_l = engine_boxes(layout)
    boxes = ui_b + eng_b
    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, float(width), DEVICE_H],
            "openrect": [0.0, 0.0, float(width), DEVICE_H],
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
            "devicewidth": float(width),
            "latency": int(layout["latency"]),
            "description": "A pool of hidden glitch FX modules in one fixed chain: Randomize, Chaos, Mutate, 8 slots and an XY morph",
            "digest": "Randomized glitch engine: 23 modules (drive, filters, distortion, time, granular, spectral), 8 slots, XY morph, 16-step slot sequencer",
            "tags": "glitch random morph stutter spectral cepstrum",
            "style": "",
            "subpatcher_template": "",
            "boxes": boxes,
            "lines": ui_l + eng_l,
            "parameters": {},
            "dependency_cache": [],
            "autosave": 0,
        }
    }


def write_amxd(patcher, out_path):
    payload = (json.dumps(patcher, indent="\t") + "\n").encode("utf-8")
    header = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) + b"ptch" + struct.pack("<I", len(payload))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header + payload)
    w = int(patcher["patcher"]["openrect"][2])
    print(f"Built {out_path} [{w}x169 px] ({len(header) + len(payload)} bytes)")


def main():
    flags = [a for a in sys.argv[1:] if a.startswith("--preview-")]
    if "--preview-all" in flags:
        flags = [f"--preview-{n}" for n in PREVIEWS]
    if flags:
        for f in flags:
            name = f[len("--preview-"):]
            if name not in PREVIEWS:
                sys.exit(f"unknown preview {name} (one of {', '.join(PREVIEWS)}, all)")
            write_amxd(build_patcher(name), os.path.join(PREVIEW_DIR, f"Glitch_{name}.amxd"))
        return
    write_amxd(build_patcher(), OUT_PATH)


if __name__ == "__main__":
    main()
