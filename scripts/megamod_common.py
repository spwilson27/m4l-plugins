#!/usr/bin/env python3
"""Shared builder for the Mega Modulator devices (A, B, C).

Each variant is `src/megamod_ui_<x>.js` + `scripts/megamod_variant_<x>.json`. The patch (pass-through audio,
hidden gen engine, buffers, transport sync, live.thisdevice width/LOM init wiring) is identical for all three.

Variant JSON schema (all keys optional except `main.rect` and `width`):
{
  "width": 300,                          # initial device width in px (UI can change it with MM.requestWidth)
  "main":  {"rect": [x, y, w, h]},       # presentation rect of the main v8ui (the one hosting the MM runtime)
  "extra_boxes": [                       # additional presentation boxes (placed after the main v8ui, before panels)
    {"id": "obj-extra1", "maxclass": "v8ui", "rect": [x, y, w, h],
     "script": "src/some_view.js",       # embedded inline; config is prepended unless "prepend_config": false
     "inlets": 1, "outlets": 1,          # defaults 1 / 1
     "ignoreclick": 0,
     "varname": "optional"},
    {"id": "obj-live1", "maxclass": "live.dial", "rect": [x, y, w, h], "box": {...raw box attributes...}}
  ],
  "extra_lines": [                       # patch cords between boxes by id; main v8ui id is "obj-viz"
    {"from": "obj-viz", "outlet": 1, "to": "obj-extra1", "inlet": 0}
  ],
  "panels": [                            # background panels (always emitted LAST, background:1)
    {"rect": [x, y, w, h], "bg": [r, g, b], "border": [r, g, b], "rounded": 6}
  ]
}
The main v8ui has 1 inlet and 2 outlets: outlet 0 = `width <px>` / `gen <msg...>` (routed by the patch),
outlet 1 = free-form aux messages (MM.emitAux) that extra_lines can wire to extra boxes.
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT_DIR, "src")
DEVICES = os.path.join(ROOT_DIR, "devices")
DEVICE_H = 169.0
VARIANTS = ("a", "b", "c")

CFG_FLOATS = 16 * 24
MSEG_FLOATS = 16 * 1024
STEPS_FLOATS = 16 * 32
SCOPE_SAMPS = 128
MAX_MAPPINGS = 256          # saved mapping-slot pool (contract with src/megamod_config.js MAX_MAPPINGS)
CURVE_REGION = 256
CURVE_SAMPS = MAX_MAPPINGS * CURVE_REGION
ROUTE_SAMPS = 512           # [2k] = source mod index or -1, [2k+1] spare
ROUTERS = 8                 # router gen.codebox~ boxes
ROUTER_SLOTS = MAX_MAPPINGS // ROUTERS  # 32 outlets each

V8_HEADER = (
    "mgraphics.init();\n"
    "mgraphics.relative_coords = 0;\n"
    "mgraphics.autofill = 0;\n\n"
    "inlets = 1;\n"
    "outlets = 2;\n\n"
)


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


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
    b = newobj(obj_id, text, x, y, w, h, numinlets=2, numoutlets=1)
    b["box"]["maxclass"] = "message"
    return b


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def v8ui_box(obj_id, code, rect, patch_xy, numinlets, numoutlets, ignoreclick=0):
    box = {
        "border": 0,
        "filename": "none",
        "id": obj_id,
        "maxclass": "v8ui",
        "numinlets": numinlets,
        "numoutlets": numoutlets,
        "outlettype": [""] * numoutlets,
        "patching_rect": [patch_xy[0], patch_xy[1], rect[2], rect[3]],
        "presentation": 1,
        "presentation_rect": [float(v) for v in rect],
        "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
        "varname": obj_id,
    }
    if ignoreclick:
        box["ignoreclick"] = 1
    return {"box": box}


def panel_box(obj_id, rect, bg, border, rounded):
    x, y, w, h = rect
    return {
        "box": {
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
            "varname": obj_id,
        }
    }


def buffer_box(obj_id, name, samps, x, y):
    return newobj(obj_id, f"buffer~ {name} @samps {samps}", x, y, 230, numinlets=1, numoutlets=2, outlettype=["float", "bang"])


def router_gen_code(r):
    """GenExpr text of router `r`: 16 signal inputs (engine outlets), 32 outputs (slots r*32 .. r*32+31).
    Per slot: sel = route[2k] + 1 picks the input (0 = off -> output 0); the output is the slot's 256-sample
    curve table k*256 read at idx = clip((x + 1) * 128, 0, 256) with linear interpolation, clamped to the last
    sample (the old lookup~ convention). GenExpr: Buffers first, then statements; no e<digit> identifiers."""
    ins = ", ".join(f"in{i + 1}" for i in range(16))
    out = [
        f"// Mega Modulator router {r}: slots {r * ROUTER_SLOTS}..{(r + 1) * ROUTER_SLOTS - 1} (generated by scripts/megamod_common.py)",
        "// out(j+1) = curve table of slot k read at the selected engine input; off slot -> 0.",
        "",
        'Buffer route("megamodroute");',
        'Buffer curve("mmcurve");',
        "",
    ]
    for j in range(ROUTER_SLOTS):
        k = r * ROUTER_SLOTS + j
        out += [
            f"sel{j} = peek(route, {2 * k}) + 1;",
            f"yv{j} = 0;",
            f"if (sel{j} > 0.5) {{",
            f"\txv{j} = selector(sel{j}, {ins});",
            f"\tfi{j} = clip((xv{j} + 1) * 128, 0, 256);",
            f"\tia{j} = min(floor(fi{j}), 255);",
            f"\tib{j} = min(ia{j} + 1, 255);",
            f"\tva{j} = peek(curve, {k * CURVE_REGION} + ia{j});",
            f"\tvb{j} = peek(curve, {k * CURVE_REGION} + ib{j});",
            f"\tyv{j} = va{j} + (vb{j} - va{j}) * (fi{j} - ia{j});",
            "}",
            f"out{j + 1} = yv{j};",
            "",
        ]
    return "\n".join(out)


def pool_boxes_and_lines():
    """The saved pool: ROUTERS router gens + MAX_MAPPINGS x (live.modulate~, live.remote~, 2 x prepend id).
    Everything is patching-only (off-screen, never in presentation). Varnames: mm_mod_k, mm_rem_k, mm_mid_k, mm_rid_k."""
    boxes, lines = [], []
    for r in range(ROUTERS):
        rid = f"obj-router-{r}"
        boxes.append({
            "box": {
                "code": router_gen_code(r),
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": rid,
                "maxclass": "gen.codebox~",
                "numinlets": 16,
                "numoutlets": ROUTER_SLOTS,
                "outlettype": ["signal"] * ROUTER_SLOTS,
                "patching_rect": [20.0 + r * 60.0, 1000.0, 50.0, 22.0],
                "varname": f"megamod_router_{r}",
            }
        })
        for i in range(16):
            lines.append(line("obj-engine", i, rid, i))
    for k in range(MAX_MAPPINGS):
        rid = f"obj-router-{k // ROUTER_SLOTS}"
        ro = k % ROUTER_SLOTS
        x = 1200.0 + (k % 32) * 140.0
        y = 1100.0 + (k // 32) * 140.0
        mod = newobj(f"obj-mm-mod-{k}", "live.modulate~", x, y + 60, 100, 22.0, numinlets=2, numoutlets=1, outlettype=[""])
        mod["box"]["saved_object_attributes"] = {"_persistence": 1, "smoothing": 1.0}
        mod["box"]["varname"] = f"mm_mod_{k}"
        rem = newobj(f"obj-mm-rem-{k}", "live.remote~ @normalized 1", x, y + 100, 130, 22.0, numinlets=2, numoutlets=0, outlettype=[])
        rem["box"]["saved_object_attributes"] = {"_persistence": 1, "normalized": 1, "smoothing": 1.0}
        rem["box"]["varname"] = f"mm_rem_{k}"
        pm = newobj(f"obj-mm-pmid-{k}", "prepend id", x + 40, y + 30, 66, 22.0, numinlets=1, numoutlets=1, outlettype=[""])
        pm["box"]["varname"] = f"mm_mid_{k}"
        pr = newobj(f"obj-mm-prid-{k}", "prepend id", x + 40, y, 66, 22.0, numinlets=1, numoutlets=1, outlettype=[""])
        pr["box"]["varname"] = f"mm_rid_{k}"
        boxes += [mod, rem, pm, pr]
        lines += [
            line(rid, ro, mod["box"]["id"], 0),
            line(rid, ro, rem["box"]["id"], 0),
            line(pm["box"]["id"], 0, mod["box"]["id"], 1),
            line(pr["box"]["id"], 0, rem["box"]["id"], 1),
        ]
    return boxes, lines


def load_variant(key):
    path = os.path.join(ROOT_DIR, "scripts", f"megamod_variant_{key}.json")
    with open(path, "r", encoding="utf-8") as f:
        v = json.load(f)
    v.setdefault("width", 300)
    v.setdefault("extra_boxes", [])
    v.setdefault("extra_lines", [])
    v.setdefault("panels", [{"rect": [0, 0, v["width"], DEVICE_H], "bg": [0.09, 0.10, 0.12], "border": [0.22, 0.26, 0.32], "rounded": 6}])
    return v


def ui_script(key):
    header = V8_HEADER
    config = read(os.path.join(SRC, "megamod_config.js"))
    mapper = read(os.path.join(SRC, "megamod_mapper.js"))
    ui = read(os.path.join(SRC, f"megamod_ui_{key}.js"))
    return header + config.rstrip() + "\n\n" + mapper.rstrip() + "\n\n" + ui


def build_patcher(key):
    v = load_variant(key)
    width = float(v["width"])
    gen_code = read(os.path.join(SRC, "megamod_engine.genexpr"))
    main_rect = v["main"]["rect"]

    boxes = [v8ui_box("obj-viz", ui_script(key), main_rect, (20.0, 80.0), 1, 2)]
    boxes[0]["box"]["parameter_enable"] = 1
    boxes[0]["box"]["saved_attribute_attributes"] = {
        "valueof": {
            "parameter_invisible": 1,
            "parameter_longname": "MegaModState",
            "parameter_shortname": "MegaModState",
            "parameter_type": 3,
        }
    }
    boxes[0]["box"]["varname"] = "MegaModState"

    for eb in v["extra_boxes"]:
        mc = eb.get("maxclass", "v8ui")
        rect = eb["rect"]
        if mc == "v8ui":
            code = V8_HEADER.replace("inlets = 1;\noutlets = 2;", f"inlets = {eb.get('inlets', 1)};\noutlets = {eb.get('outlets', 1)};")
            if eb.get("prepend_config", True):
                code += read(os.path.join(SRC, "megamod_config.js")).rstrip() + "\n\n"
            code += read(os.path.join(ROOT_DIR, eb["script"]))
            b = v8ui_box(eb["id"], code, rect, (20.0, 300.0), eb.get("inlets", 1), eb.get("outlets", 1), eb.get("ignoreclick", 0))
        else:
            b = {"box": dict(eb.get("box", {}))}
            b["box"].update({"id": eb["id"], "maxclass": mc, "presentation": 1,
                             "presentation_rect": [float(x) for x in rect],
                             "patching_rect": [20.0, 300.0, float(rect[2]), float(rect[3])]})
            b["box"].setdefault("numinlets", 1)
            b["box"].setdefault("numoutlets", 1)
            b["box"].setdefault("outlettype", [""])
        if eb.get("varname"):
            b["box"]["varname"] = eb["varname"]
        boxes.append(b)

    boxes.extend([
        newobj("obj-plugin", "plugin~", 20, 460, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 640, 58, numinlets=2, numoutlets=0, outlettype=[]),
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-engine",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 16,
                "outlettype": ["signal"] * 16,
                "patching_rect": [120.0, 520.0, 420.0, 140.0],
                "varname": "megamod_engine",
            }
        },
        buffer_box("obj-buf-cfg", "#0-megamodcfg", CFG_FLOATS, 560, 460),
        buffer_box("obj-buf-mseg", "#0-megamodmseg", MSEG_FLOATS, 560, 485),
        buffer_box("obj-buf-steps", "#0-megamodsteps", STEPS_FLOATS, 560, 510),
        buffer_box("obj-buf-scope", "#0-megamodscope", SCOPE_SAMPS, 560, 535),
        buffer_box("obj-buf-curve", "#0-mmcurve", CURVE_SAMPS, 560, 560),
        buffer_box("obj-buf-route", "#0-megamodroute", ROUTE_SAMPS, 560, 585),
        newobj("obj-loadbang", "loadbang", 560, 600, 60, outlettype=["bang"]),
        message("obj-msg-gen-bind", "cfg #0-megamodcfg, mseg #0-megamodmseg, steps #0-megamodsteps, scope #0-megamodscope", 560, 630, 480),
        message("obj-msg-names", "setnames #0-megamodcfg #0-megamodmseg #0-megamodsteps #0-megamodscope #0-mmcurve #0-megamodroute", 560, 660, 500),
        message("obj-msg-router-bind", "route #0-megamodroute, curve #0-mmcurve", 560, 690, 300),
        newobj("obj-thisdevice", "live.thisdevice", 700, 10, 85, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init-lom", "init_lom", 800, 40, 70),
        newobj("obj-route", "route width gen", 20, 120, 100, numinlets=1, numoutlets=3),
        newobj("obj-prep-setwidth", "prepend setwidth", 20, 150, 100),
        newobj("obj-sync", "plugsync~", 240, 30, 70, numinlets=1, numoutlets=9,
               outlettype=["int", "int", "int", "float", "list", "float", "float", "int", "int"]),
        newobj("obj-play-chg", "change", 240, 62, 50, numinlets=1, numoutlets=3, outlettype=["", "int", "int"]),
        newobj("obj-play-prep", "prepend hplay", 240, 90, 90),
        newobj("obj-bpm-chg", "change 0.", 345, 62, 60, numinlets=1, numoutlets=3, outlettype=["", "int", "int"]),
        newobj("obj-bpm-prep", "prepend hbpm", 345, 90, 90),
        newobj("obj-ppq-prep", "prepend hppq", 450, 90, 90),
        # Test hook: `test_learn <mod> <param id>` / `test_report` (see megamod_mapper.js)
        newobj("obj-r-test", "receive megamod-test", 800, 70, 130, numinlets=0, numoutlets=1),
    ])

    lines = [
        line("obj-plugin", 0, "obj-plugout", 0),
        line("obj-plugin", 1, "obj-plugout", 1),
        line("obj-plugin", 0, "obj-engine", 0),
        line("obj-plugin", 1, "obj-engine", 1),
        line("obj-loadbang", 0, "obj-msg-gen-bind", 0),
        line("obj-loadbang", 0, "obj-msg-names", 0),
        line("obj-msg-gen-bind", 0, "obj-engine", 0),
        line("obj-msg-names", 0, "obj-viz", 0),
        line("obj-loadbang", 0, "obj-msg-router-bind", 0),
        line("obj-thisdevice", 0, "obj-msg-init-lom", 0),
        line("obj-msg-init-lom", 0, "obj-viz", 0),
        line("obj-r-test", 0, "obj-viz", 0),
        line("obj-viz", 0, "obj-route", 0),
        line("obj-route", 0, "obj-prep-setwidth", 0),
        line("obj-prep-setwidth", 0, "obj-thisdevice", 0),
        line("obj-route", 1, "obj-engine", 0),
        line("obj-sync", 0, "obj-play-chg", 0),
        line("obj-play-chg", 0, "obj-play-prep", 0),
        line("obj-play-prep", 0, "obj-engine", 0),
        line("obj-sync", 5, "obj-bpm-chg", 0),
        line("obj-bpm-chg", 0, "obj-bpm-prep", 0),
        line("obj-bpm-prep", 0, "obj-engine", 0),
        line("obj-sync", 6, "obj-ppq-prep", 0),
        line("obj-ppq-prep", 0, "obj-engine", 0),
    ]
    for l in v["extra_lines"]:
        lines.append(line(l["from"], l.get("outlet", 0), l["to"], l.get("inlet", 0)))

    pool_boxes, pool_lines = pool_boxes_and_lines()
    boxes.extend(pool_boxes)
    lines.extend(pool_lines)
    for r in range(ROUTERS):
        lines.append(line("obj-msg-router-bind", 0, f"obj-router-{r}", 0))

    # Background panels MUST be last in boxes and have "background": 1
    for i, pn in enumerate(v["panels"]):
        boxes.append(panel_box(f"obj-panel-{i}", pn["rect"], pn.get("bg", [0.09, 0.10, 0.12]), pn.get("border", [0.22, 0.26, 0.32]), pn.get("rounded", 6)))

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, width, DEVICE_H],
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
            "boxanimatetime": 200,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": width,
            "description": "Many modulators in one device, each mapped to an unlimited number of Live parameters",
            "digest": "Mega Modulator",
            "tags": "modulation lfo envelope follower random steps mseg",
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


def write_amxd(patcher, out_path):
    payload = (json.dumps(patcher, indent="\t") + "\n").encode("utf-8")
    header = (
        b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0)
        + b"ptch" + struct.pack("<I", len(payload))
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header + payload)
    return len(header) + len(payload)


def out_path_for(key):
    return os.path.join(DEVICES, f"Mega Modulator {key.upper()}.amxd")
