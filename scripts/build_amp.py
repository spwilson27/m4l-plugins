#!/usr/bin/env python3
"""Build the Amp devices: one neural amp engine (NAM / Tone 3000 model format), several faces.

Every design is a module in scripts/amp_designs/<slug>.py plus its face script(s) in src/. They share
src/amp_config.js (parser, gen generator, tone stack), src/amp_engine.js (deferred DSP, model
loading, parameters, telemetry) and the gen template src/amp_core.genexpr, so the DSP and the
parameter set are identical in every device; only the face (graphic, layout, controls) differs.

Design module contract (all names required unless marked optional):
  SLUG         short id, e.g. "stack"
  DEVICE       device name; written to devices/<DEVICE>.amxd
  WIDTH        presentation width in px (height is always 169)
  FACE_FILES   face scripts in src/, concatenated after the engine into the main v8ui
  VIZ          [x, y, w, h] of the main v8ui (interactive; no live.* widget may overlap it)
  DROP         optional [x, y, w, h] of the visible "Model File" live.drop (None = hidden)
  WIDGETS      optional {param key: {"kind": dial|numbox|tab|menu|toggle|slider, "rect": [...], ...box attrs}}
               on-face live.* widgets; every other parameter's live.* object is off the face
  LABELS       optional [(id, text, [x, y, w, h], size, rgba or None, align)] live.comment labels
  PANELS       optional [(id, [x, y, w, h], rgba, rounded)] background panels (drawn behind everything)
  DESCRIPTION  one line

  python3 scripts/build_amp.py [slug ...]
"""

import importlib.util
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
DESIGNS = os.path.join(ROOT, "scripts", "amp_designs")
BUILTIN = ["clean", "crunch", "lead"]


def amp_params():
    out = subprocess.run(["node", "-e", "const A=require('./src/amp_config.js');"
                          "console.log(JSON.stringify({p:A.AMP_PARAMS,k:A.AMP_PARAM_KEYS,s:A.AMP_SCOPE,w:A.AMP_WBANK,c:A.AMP_CF_SAMPS}))"],
                         cwd=ROOT, capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def template_text():
    lines = []
    for ln in sc.read(os.path.join(SRC, "amp_core.genexpr")).split("\n"):
        if "//@NAM_" in ln:
            lines.append(ln.strip())
            continue
        ln = re.sub(r"//.*$", "", ln).rstrip()
        if ln.strip():
            lines.append(ln)
    return "\n".join(lines) + "\n"


def builtin_models():
    docs = []
    for name in BUILTIN:
        path = os.path.join(SRC, "amp_models", name + ".nam")
        with open(path) as f:
            d = json.load(f)
        d["weights"] = [float("%.7g" % v) for v in d["weights"]]
        docs.append(d)
    return docs


def load_design(slug):
    path = os.path.join(DESIGNS, slug + ".py")
    spec = importlib.util.spec_from_file_location("amp_design_" + slug, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def all_slugs():
    return sorted(f[:-3] for f in os.listdir(DESIGNS) if f.endswith(".py") and not f.startswith("_"))


def face_code(design, header):
    parts = [header, sc.read(os.path.join(SRC, "amp_config.js")), sc.read(os.path.join(SRC, "amp_engine.js"))]
    for f in design.FACE_FILES:
        parts.append(sc.read(os.path.join(SRC, f)))
    return "\n".join(p.rstrip() + "\n" for p in parts)


def valueof(key, spec):
    long_name, short, lo, hi, init, ptype, unit, _gen, enum, help_text = spec
    if ptype == 2:
        v = sc.enum_valueof((long_name, short, enum, init))
    else:
        v = sc.num_valueof((long_name, short, lo, hi, init, ptype, unit))
        if key == "mix":
            v["parameter_unitstyle"] = 5
    v["parameter_info"] = help_text
    return v


def widget(key, spec, w=None, patch_y=0.0):
    """The parameter's live.* object: on the face as described by `w`, else hidden (presentation 0)."""
    long_name, short, lo, hi, init, ptype, unit, _gen, enum, help_text = spec
    kind = (w or {}).get("kind") or ("tab" if ptype == 2 else "numbox")
    cls = {"dial": "live.dial", "numbox": "live.numbox", "tab": "live.tab", "menu": "live.menu",
           "toggle": "live.text", "slider": "live.slider"}[kind]
    outs = {"live.dial": (2, ["", "float"]), "live.numbox": (2, ["", "float"]), "live.tab": (3, ["", "", "float"]),
            "live.menu": (3, ["", "", "float"]), "live.text": (2, ["", ""]), "live.slider": (2, ["", "float"])}[cls]
    rect = (w or {}).get("rect", [0, 0, 44, 15])
    box = {
        "annotation": help_text, "annotation_name": long_name, "id": f"obj-ctrl-{key}", "maxclass": cls,
        "numinlets": 1, "numoutlets": outs[0], "outlettype": outs[1], "parameter_enable": 1,
        "patching_rect": [900.0 + 70.0 * (patch_y % 4), 40.0 + 30.0 * patch_y, float(rect[2]), float(rect[3])],
        "saved_attribute_attributes": {"valueof": valueof(key, spec)}, "varname": long_name,
    }
    if cls == "live.text":
        box["mode"] = 1
        box["text"] = enum[0] if enum else short
        box["texton"] = enum[-1] if enum else short
    if cls == "live.tab":
        box["num_lines_patching"] = 1
        box["num_lines_presentation"] = int((w or {}).get("rows", 1))
    if cls == "live.dial":
        box["showname"] = 1
        box["shownumber"] = 1
    if cls == "live.numbox" and "appearance" not in (w or {}):
        box["appearance"] = 2
    if w:
        box["presentation"] = 1
        box["presentation_rect"] = [float(v) for v in rect]
        for k, v in w.items():
            if k not in ("kind", "rect", "rows"):
                box[k] = v
    return {"box": box}


def drop_box(rect):
    box = {
        "annotation": "A .nam model file (Tone 3000 / Neural Amp Modeler). Drop it here or use Load.",
        "annotation_name": "Model File", "fontsize": 8.0, "id": "obj-ctrl-file", "legend": "Drop .nam",
        "maxclass": "live.drop", "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""], "parameter_enable": 1,
        "patching_rect": [1300.0, 40.0, 60.0, 20.0],
        "saved_attribute_attributes": {"valueof": {
            "parameter_invisible": 1, "parameter_longname": "Model File", "parameter_modmode": 0,
            "parameter_shortname": "Model File", "parameter_type": 4,
        }},
        "varname": "Model File",
    }
    if rect:
        box["presentation"] = 1
        box["presentation_rect"] = [float(v) for v in rect]
    return {"box": box}


def panel(oid, rect, rgba, rounded=0):
    b = sc.make_panel(oid, rect[0], rect[1], rect[2], rect[3], bg=rgba[:3], border=rgba[:3], rounded=rounded)
    bx = b["box"]
    bx["bgfillcolor"] = {"type": "color", "color": list(rgba), "angle": 270.0, "proportion": 0.39}
    bx["background"] = 1
    return b


def label(oid, text, rect, size=9.0, rgba=None, align=0):
    box = {"fontsize": float(size), "id": oid, "maxclass": "live.comment", "numinlets": 1, "numoutlets": 0,
           "patching_rect": [rect[0] + 600.0, rect[1] + 700.0, rect[2], rect[3]], "presentation": 1,
           "presentation_rect": [float(v) for v in rect], "text": text, "textjustification": align, "varname": oid}
    if rgba is not None:
        box["textcolor"] = list(rgba)
    return {"box": box}


def build(design, meta, header):
    P = meta["p"]
    keys = meta["k"]
    widgets = getattr(design, "WIDGETS", {}) or {}
    boxes = [sc.v8ui("obj-viz", face_code(design, header), design.VIZ, (20, 60), 2, varname="amp_face")]
    lines = []
    for i, key in enumerate(keys):
        boxes.append(widget(key, P[key], widgets.get(key), i))
        boxes.append(sc.newobj(f"obj-ui-{key}", f"prepend set_{key}", 640, 40 + 22 * i, 120))
        lines.append(sc.line(f"obj-ctrl-{key}", 0, f"obj-ui-{key}"))
        lines.append(sc.line(f"obj-ui-{key}", 0, "obj-viz"))
    boxes.append(drop_box(getattr(design, "DROP", None)))
    for lb in getattr(design, "LABELS", []) or []:
        boxes.append(label(lb[0], lb[1], lb[2], lb[3] if len(lb) > 3 else 9.0, lb[4] if len(lb) > 4 else None,
                           lb[5] if len(lb) > 5 else 0))
    boxes += [
        sc.newobj("obj-plugin", "plugin~", 20, 420, 60, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.newobj("obj-plugout", "plugout~", 20, 560, 70, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.newobj("obj-genin", "gate 1 1", 160, 420, 60, numinlets=2, numoutlets=1, outlettype=[""]),
        sc.newobj("obj-thisdevice", "live.thisdevice", 300, 20, 100, numoutlets=2, outlettype=["bang", "int"]),
        sc.message("obj-msg-init", "init_dsp", 300, 50, 60),
        sc.newobj("obj-loadbang", "loadbang", 420, 20, 60, numoutlets=1, outlettype=["bang"]),
        sc.message("obj-msg-names", "setnames ---ampscope ---ampw ---ampcf", 420, 50, 230),
        sc.newobj("obj-buf-scope", f"buffer~ ---ampscope @samps {meta['s']['SAMPS']}", 700, 20, 220, numoutlets=2, outlettype=["float", "bang"]),
        sc.newobj("obj-buf-w", f"buffer~ ---ampw @samps {2 * meta['w']}", 700, 50, 220, numoutlets=2, outlettype=["float", "bang"]),
        sc.newobj("obj-buf-cf", f"buffer~ ---ampcf @samps {meta['c']}", 700, 80, 220, numoutlets=2, outlettype=["float", "bang"]),
        sc.newobj("obj-route-out", "route param browse dropset", 160, 260, 170, numoutlets=4, outlettype=["", "", "", ""]),
        sc.newobj("obj-route-key", "route " + " ".join(keys), 160, 300, 400, numoutlets=len(keys) + 1, outlettype=[""] * (len(keys) + 1)),
        sc.newobj("obj-opendialog", "opendialog", 360, 300, 80, numoutlets=2, outlettype=["", "bang"]),
        sc.newobj("obj-prep-browsed", "prepend browsed", 360, 330, 100),
        sc.newobj("obj-prep-dropset", "prepend set", 480, 300, 80),
        sc.newobj("obj-prep-dropfile", "prepend dropfile", 1300, 80, 100),
    ]
    for oid, name in (("obj-plugin", "amp_plugin"), ("obj-plugout", "amp_plugout"), ("obj-genin", "amp_genin")):
        for b in boxes:
            if b["box"]["id"] == oid:
                b["box"]["varname"] = name
    lines += [
        sc.line("obj-thisdevice", 0, "obj-msg-init"), sc.line("obj-msg-init", 0, "obj-viz"),
        sc.line("obj-loadbang", 0, "obj-msg-names"), sc.line("obj-msg-names", 0, "obj-viz"),
        sc.line("obj-viz", 1, "obj-genin", 1),
        sc.line("obj-viz", 0, "obj-route-out"),
        sc.line("obj-route-out", 0, "obj-route-key"),
        sc.line("obj-route-out", 1, "obj-opendialog"),
        sc.line("obj-route-out", 2, "obj-prep-dropset"),
        sc.line("obj-opendialog", 0, "obj-prep-browsed"), sc.line("obj-prep-browsed", 0, "obj-viz"),
        sc.line("obj-prep-dropset", 0, "obj-ctrl-file"),
        sc.line("obj-ctrl-file", 0, "obj-prep-dropfile"), sc.line("obj-prep-dropfile", 0, "obj-viz"),
    ]
    for i, key in enumerate(keys):
        lines.append(sc.line("obj-route-key", i, f"obj-ctrl-{key}"))
    for p in getattr(design, "PANELS", []) or []:
        boxes.append(panel(p[0], p[1], p[2], p[3] if len(p) > 3 else 0))
    doc = sc.patcher(boxes, lines, design.WIDTH, design.DESCRIPTION,
                     "Neural amp (NAM / Tone 3000 .nam captures) with tone stack, cab and gate.",
                     "audio, amp, neural, nam, guitar", 0)
    sc.write_amxd(doc, os.path.join(ROOT, "devices", design.DEVICE + ".amxd"))


def main():
    meta = amp_params()
    header = ("var AMP_TEMPLATE = " + json.dumps(template_text()) + ";\n"
              + "var AMP_BUILTIN = " + json.dumps(builtin_models(), separators=(",", ":")) + ";\n")
    for slug in sys.argv[1:] or all_slugs():
        design = load_design(slug)
        build(design, meta, header + f'var AMP_FACE = "{design.SLUG}";\n')


if __name__ == "__main__":
    main()
