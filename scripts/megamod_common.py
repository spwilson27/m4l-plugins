#!/usr/bin/env python3
"""Builder for devices/Mega Modulator.amxd.

The UI is `src/megamod_ui.js`, laid out by `scripts/megamod_layout.json`. The patch adds pass-through audio,
the hidden gen engine and routers, buffers, transport sync, the 256-slot mapping pool and live.thisdevice
width/LOM init wiring.

Layout JSON schema (all keys optional except `main.rect` and `width`):
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

# automatable parameter pool (contract with src/megamod_config.js AUTO_*; tests/test_megamod.js checks both)
MAX_MODS = 16
AUTO_PARAMS = 5             # generic controls per modulator slot
AUTO_PER_SLOT = AUTO_PARAMS + 1   # + On
AUTO_DEPTH_SLOTS = 64       # mapping pool slots with an automatable Depth parameter
AUTO_LETTERS = "ABCDE"     # fixed Live parameter names: M3 A .. M3 E, M3 On, Depth 5 (runtime renames do not reach Live)
# per-slot switch parameters (objects at_<slot*6+t>): the LFO shape (live.tab, 5 values) and the 5 boolean chips (live.text toggles)
AUTO_SW_NAMES = ["Shape", "Sync", "Bipolar", "Retrig", "1Shot", "Loop"]
AUTO_SW_PER_SLOT = len(AUTO_SW_NAMES)
LFO_SHAPE_NAMES = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square"]

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
        "// Global smoothing (Options panel): `smooth <ms>` -> one-pole lowpass on every slot output, 0 = bypass (coefficient 0).",
        "Param smooth(0);",
    ]
    out += [f"History ys{j}(0);" for j in range(ROUTER_SLOTS)]
    out += [
        "",
        "smSr = max(samplerate, 1);",
        "smCoef = (smooth > 0.0001) ? exp(-1000 / (smooth * smSr)) : 0;",
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
            f"ys{j} = yv{j} + (ys{j} - yv{j}) * smCoef;",
            f"out{j + 1} = ys{j};",
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


def auto_valueof(longname, enum=None, initial=0):
    """Saved-parameter attributes of one pool object: generic 0..100 percent float (`enum` None) or an Off / On toggle.
    parameter_linknames is 0 so renaming the long name at runtime never changes the scripting name (varname)."""
    v = {
        "parameter_linknames": 0,
        "parameter_longname": longname,
        "parameter_shortname": longname,
        "parameter_initial": [initial],
        "parameter_initial_enable": 0,
    }
    if enum:
        v.update({"parameter_enum": enum, "parameter_mmax": len(enum) - 1, "parameter_type": 2, "parameter_unitstyle": 9})
    else:
        v.update({"parameter_mmin": 0.0, "parameter_mmax": 100.0, "parameter_type": 0, "parameter_unitstyle": 5})
    return v


# Every pool object is also a TRANSPARENT FACE (AGENTS.md section 21): in presentation, hidden, parked 1x1 in a corner outside the
# v8ui, in front of it in z-order. At runtime the UI script moves it over the drawn control it belongs to (MM.faceApply), so a real
# click / drag / right-click lands on a live.* object and Live's native parameter menu works. Every colour has alpha 0.
FACE_PARK = [0.0, 0.0, 1.0, 1.0]
CLEAR = [0.0, 0.0, 0.0, 0.0]
FACE_COLORS = {
    # Live snaps the size of a displayed live.dial to 27 x 28 and a live.numbox to 15 px high, so those faces are laid out as boxes of
    # exactly that size (the UI centres a dial on its knob). A live.slider's automation dot was seen to move with the value, so no
    # slider is used any more. The names are the attributes Max reports (getattrnames).
    "live.dial": ["activedialcolor", "activefgdialcolor", "activeneedlecolor", "bordercolor", "dialcolor", "fgdialcolor",
                  "focusbordercolor", "needlecolor", "panelcolor", "textcolor", "tricolor", "tribordercolor"],
    "live.numbox": ["activebgcolor", "activeslidercolor", "activetricolor", "bordercolor", "focusbordercolor", "inactivelcdcolor",
                    "lcdbgcolor", "lcdcolor", "textcolor", "tricolor"],
    "live.tab": ["activebgcolor", "activebgoncolor", "bgcolor", "bgoncolor", "bordercolor", "focusbordercolor", "inactivelcdcolor",
                 "inactivetextoffcolor", "inactivetextoncolor", "lcdbgcolor", "lcdcolor", "textcolor", "textoncolor"],
    "live.text": ["activebgcolor", "activebgoncolor", "activetextcolor", "activetextoncolor", "bgcolor", "bgoncolor", "bordercolor",
                  "textcolor", "textoncolor", "focusbordercolor"],
}


def face_attrs(maxclass):
    """presentation + hidden + the fully transparent look of a face."""
    a = {"presentation": 1, "presentation_rect": list(FACE_PARK), "hidden": 1}
    for k in FACE_COLORS[maxclass]:
        a[k] = list(CLEAR)
    if maxclass == "live.dial":
        a.update({"showname": 0, "shownumber": 0})
    elif maxclass == "live.numbox":
        a.update({"appearance": 0})
    elif maxclass == "live.tab":
        a.update({"rounded": 0, "num_lines_patching": 1, "num_lines_presentation": 1})
    else:
        a.update({"text": "", "texton": "", "rounded": 0, "border": 0})
    return a


def auto_face_param(obj_id, maxclass, varname, longname, x, y, initial=0):
    """A generic 0..100 percent float parameter whose face is `maxclass` (live.dial for the modulator controls, live.numbox for Depth)."""
    b = {
        "id": obj_id,
        "maxclass": maxclass,
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), float(y), 44.0, 15.0],
        "saved_attribute_attributes": {"valueof": auto_valueof(longname, initial=initial)},
        "varname": varname,
    }
    b.update(face_attrs(maxclass))
    return {"box": b}


def auto_numbox(obj_id, varname, longname, x, y, invisible=0, ptype=None, mmax=None):
    """The hidden marker (a plain numbox, never a face)."""
    b = {
        "id": obj_id,
        "maxclass": "live.numbox",
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), float(y), 44.0, 15.0],
        "saved_attribute_attributes": {"valueof": auto_valueof(longname)},
        "varname": varname,
    }
    if invisible:
        b["saved_attribute_attributes"]["valueof"]["parameter_invisible"] = 1
    if ptype is not None:  # hidden marker: integer 0..1
        vo = b["saved_attribute_attributes"]["valueof"]
        vo["parameter_type"] = ptype
        vo["parameter_mmax"] = mmax
        vo["parameter_unitstyle"] = 0
    return {"box": b}


def auto_shape_tab(obj_id, varname, longname, x, y):
    """The LFO shape: a 5-way live.tab face (enum parameter)."""
    b = {
        "id": obj_id,
        "maxclass": "live.tab",
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), float(y), 92.0, 12.0],
        "saved_attribute_attributes": {"valueof": auto_valueof(longname, LFO_SHAPE_NAMES)},
        "varname": varname,
    }
    b.update(face_attrs("live.tab"))
    return {"box": b}


def auto_toggle(obj_id, varname, longname, x, y):
    b = {
        "id": obj_id,
        "maxclass": "live.text",
        "mode": 1,
        "numinlets": 1,
        "numoutlets": 2,
        "outlettype": ["", ""],
        "parameter_enable": 1,
        "patching_rect": [float(x), float(y), 44.0, 15.0],
        "saved_attribute_attributes": {"valueof": auto_valueof(longname, ["Off", "On"])},
        "varname": varname,
    }
    b.update(face_attrs("live.text"))
    return {"box": b}


def auto_boxes_and_lines():
    """The automatable parameter pool: per modulator slot AUTO_PARAMS generic live.dial (varname ap_<slot*6+j>) + an On live.text
    (ap_<slot*6+5>) + 6 switches (at_<slot*6+t>: the LFO shape live.tab, then Sync / Bipolar / Retrig / 1Shot / Loop live.text),
    AUTO_DEPTH_SLOTS Depth live.numbox (ad_<k>) and the hidden marker (ap_marker, 0 none / 1 values stored / 2 switches stored too). Each outputs through a
    `prepend autop <idx>` / `prepend autod <k>` / `prepend autom` into the main v8ui. Saved, not in presentation, visible in Live's
    parameter list (parameter_invisible 0) except the marker. The names are fixed (src/megamod_config.js autoSlotNames / autoDepthName)."""
    boxes, lines = [], []
    x0, y0 = 20.0, 2400.0
    for slot in range(MAX_MODS):
        for j in range(AUTO_PER_SLOT):
            idx = slot * AUTO_PER_SLOT + j
            name = f"M{slot + 1} On" if j == AUTO_PARAMS else f"M{slot + 1} {AUTO_LETTERS[j]}"
            x = x0 + j * 70.0
            y = y0 + slot * 70.0
            oid = f"obj-ap-{idx}"
            if j == AUTO_PARAMS:
                boxes.append(auto_toggle(oid, f"ap_{idx}", name, x, y))
            else:
                boxes.append(auto_face_param(oid, "live.dial", f"ap_{idx}", name, x, y, initial=100 if j == 2 else 0))
            pid = f"obj-apx-{idx}"
            boxes.append(newobj(pid, f"prepend autop {idx}", x, y + 22, 66, 18.0, numinlets=1, numoutlets=1, outlettype=[""]))
            lines.append(line(oid, 0, pid, 0))
            lines.append(line(pid, 0, "obj-viz", 0))
    for slot in range(MAX_MODS):
        for t in range(AUTO_SW_PER_SLOT):
            idx = slot * AUTO_SW_PER_SLOT + t
            name = f"M{slot + 1} {AUTO_SW_NAMES[t]}"
            x = x0 + 1750.0 + t * 70.0
            y = y0 + slot * 70.0
            oid = f"obj-at-{idx}"
            if t == 0:
                boxes.append(auto_shape_tab(oid, f"at_{idx}", name, x, y))
            else:
                boxes.append(auto_toggle(oid, f"at_{idx}", name, x, y))
            pid = f"obj-atx-{idx}"
            boxes.append(newobj(pid, f"prepend autot {idx}", x, y + 22, 66, 18.0, numinlets=1, numoutlets=1, outlettype=[""]))
            lines.append(line(oid, 0, pid, 0))
            lines.append(line(pid, 0, "obj-viz", 0))
    for k in range(AUTO_DEPTH_SLOTS):
        name = f"Depth {k + 1}"
        x = x0 + 600.0 + (k % 16) * 70.0
        y = y0 + (k // 16) * 70.0
        oid = f"obj-ad-{k}"
        boxes.append(auto_face_param(oid, "live.numbox", f"ad_{k}", name, x, y, initial=100))
        pid = f"obj-adx-{k}"
        boxes.append(newobj(pid, f"prepend autod {k}", x, y + 22, 66, 18.0, numinlets=1, numoutlets=1, outlettype=[""]))
        lines.append(line(oid, 0, pid, 0))
        lines.append(line(pid, 0, "obj-viz", 0))
    marker = auto_numbox("obj-ap-marker", "ap_marker", "MM Auto Stored", x0 + 600.0, y0 + 300.0, invisible=1, ptype=1, mmax=2.0)
    boxes.append(marker)
    boxes.append(newobj("obj-apx-marker", "prepend autom", x0 + 600.0, y0 + 322.0, 80, 18.0, numinlets=1, numoutlets=1, outlettype=[""]))
    lines.append(line("obj-ap-marker", 0, "obj-apx-marker", 0))
    lines.append(line("obj-apx-marker", 0, "obj-viz", 0))
    return boxes, lines


def load_layout():
    path = os.path.join(ROOT_DIR, "scripts", "megamod_layout.json")
    with open(path, "r", encoding="utf-8") as f:
        v = json.load(f)
    v.setdefault("width", 300)
    v.setdefault("extra_boxes", [])
    v.setdefault("extra_lines", [])
    v.setdefault("panels", [{"rect": [0, 0, v["width"], DEVICE_H], "bg": [0.09, 0.10, 0.12], "border": [0.22, 0.26, 0.32], "rounded": 6}])
    return v


def ui_script():
    header = V8_HEADER
    config = read(os.path.join(SRC, "megamod_config.js"))
    mapper = read(os.path.join(SRC, "megamod_mapper.js"))
    ui = read(os.path.join(SRC, "megamod_ui.js"))
    return header + config.rstrip() + "\n\n" + mapper.rstrip() + "\n\n" + ui


def build_patcher():
    v = load_layout()
    width = float(v["width"])
    gen_code = read(os.path.join(SRC, "megamod_engine.genexpr"))
    main_rect = v["main"]["rect"]

    boxes = [v8ui_box("obj-viz", ui_script(), main_rect, (20.0, 80.0), 1, 2)]
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
        # `---` (not `#0-`): Live replaces it with a per-device number (`012megamodcfg`) in every box of the
        # device, message boxes included. `#0` is only expanded inside abstractions, so `#0-` names were shared
        # by every Mega Modulator in the Set (verified through the MCP bridge).
        buffer_box("obj-buf-cfg", "---megamodcfg", CFG_FLOATS, 560, 460),
        buffer_box("obj-buf-mseg", "---megamodmseg", MSEG_FLOATS, 560, 485),
        buffer_box("obj-buf-steps", "---megamodsteps", STEPS_FLOATS, 560, 510),
        buffer_box("obj-buf-scope", "---megamodscope", SCOPE_SAMPS, 560, 535),
        buffer_box("obj-buf-curve", "---mmcurve", CURVE_SAMPS, 560, 560),
        buffer_box("obj-buf-route", "---megamodroute", ROUTE_SAMPS, 560, 585),
        newobj("obj-loadbang", "loadbang", 560, 600, 60, outlettype=["bang"]),
        message("obj-msg-gen-bind", "cfg ---megamodcfg, mseg ---megamodmseg, steps ---megamodsteps, scope ---megamodscope", 560, 630, 480),
        message("obj-msg-names", "setnames ---megamodcfg ---megamodmseg ---megamodsteps ---megamodscope ---mmcurve ---megamodroute", 560, 660, 500),
        message("obj-msg-router-bind", "route ---megamodroute, curve ---mmcurve", 560, 690, 300),
        newobj("obj-thisdevice", "live.thisdevice", 700, 10, 85, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init-lom", "init_lom", 800, 40, 70),
        newobj("obj-route", "route width gen smooth", 20, 120, 130, numinlets=1, numoutlets=4),
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
        # Keyboard fallback (the v8ui also gets native onkeydown): [key] ascii + modifiers -> `key <ascii> <mods>` -> obj-viz.
        # The UI only acts on it while the device was the last thing clicked (ubFocus in src/megamod_ui.js).
        newobj("obj-key", "key", 800, 100, 40, numinlets=0, numoutlets=4, outlettype=["int", "int", "int", "int"]),
        newobj("obj-key-pack", "pack 0 0", 800, 130, 56, numinlets=2, numoutlets=1),
        newobj("obj-key-prep", "prepend key", 800, 160, 80),
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
        line("obj-key", 0, "obj-key-pack", 0),
        line("obj-key", 2, "obj-key-pack", 1),
        line("obj-key-pack", 0, "obj-key-prep", 0),
        line("obj-key-prep", 0, "obj-viz", 0),
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
    auto_boxes, auto_lines = auto_boxes_and_lines()
    boxes.extend(auto_boxes)
    lines.extend(auto_lines)
    for r in range(ROUTERS):
        lines.append(line("obj-msg-router-bind", 0, f"obj-router-{r}", 0))
        lines.append(line("obj-route", 2, f"obj-router-{r}", 0))  # `smooth <ms>` -> router Param smooth

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


OUT_PATH = os.path.join(DEVICES, "Mega Modulator.amxd")
