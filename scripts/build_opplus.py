#!/usr/bin/env python3
"""Build devices/Operator+.amxd: a Max for Live recreation of Ableton Operator (AGENTS.md section "Operator+").

  python3 scripts/build_opplus.py [--out <file.amxd>]
Env (previews only): OP_SECTION=<0..7> / OP_VIEW=<0|1> save that section / view as the initial UI state.

Structure (Max Instrument, 725 x 169):
  obj-face  v8ui "main"  (whole face, ignoreclick: draws every control; engine: cfg, wavetables, voices, deferred gen~)
  obj-graph v8ui "graph" (interactive strip at the top of the display: envelope handles, harmonics, filter curve, algorithms)
  one transparent live.* object per parameter, placed over the control the face draws (rule 4's ignoreclick exception);
  transparent ubuttons for section select and the display's view headers;
  no gen~ in the file: src/opplus_ui.js creates it after the face is up (AGENTS.md 1d), hub op_genin (gate 1 1), op_phasor, op_plugout.
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import spectral_common as sc  # noqa: E402
from spectral_common import line, newobj, message  # noqa: E402
import opplus_layout as L  # noqa: E402
import opplus_spec  # noqa: E402

ROOT = sc.ROOT_DIR
OUT = os.path.join(ROOT, "devices", "Operator+.amxd")
W, H = L.W, L.H
BUF = {"cfg": ("---opcfg", 448), "voices": ("---opvoices", 32 * 8), "waves": ("---opwaves", 26 * 8 * 2049), "scope": ("---opscope", 528)}

CLEAR = [0.0, 0.0, 0.0, 0.0]
FACE_COLORS = {
    "live.dial": ["activedialcolor", "activefgdialcolor", "activeneedlecolor", "bordercolor", "dialcolor", "fgdialcolor",
                  "focusbordercolor", "needlecolor", "panelcolor", "textcolor", "tricolor", "tribordercolor"],
    "live.numbox": ["activebgcolor", "activeslidercolor", "activetricolor", "bordercolor", "focusbordercolor", "inactivelcdcolor",
                    "lcdbgcolor", "lcdcolor", "textcolor", "tricolor"],
    "live.tab": ["activebgcolor", "activebgoncolor", "bgcolor", "bgoncolor", "bordercolor", "focusbordercolor", "inactivelcdcolor",
                 "inactivetextoffcolor", "inactivetextoncolor", "lcdbgcolor", "lcdcolor", "textcolor", "textoncolor"],
    "live.text": ["activebgcolor", "activebgoncolor", "activetextcolor", "activetextoncolor", "bgcolor", "bgoncolor", "bordercolor",
                  "textcolor", "textoncolor", "focusbordercolor"],
    "live.menu": ["activebgcolor", "bgcolor", "bordercolor", "focusbordercolor", "textcolor", "tricolor", "tricolor2", "activetricolor",
                  "activetricolor2"],
}
MAXCLASS = {"dial": "live.dial", "lcd": "live.numbox", "menu": "live.menu", "toggle": "live.text", "tab": "live.tab"}


def gen_code():
    return sc.read(os.path.join(ROOT, "src", "opplus_core.genexpr"))


def valueof(p):
    v = {"parameter_longname": p["name"] or p["key"], "parameter_shortname": p["name"][:31] or p["key"],   # exact, trailing space of "A Fix On " too
         "parameter_annotation_name": p["name"].strip(), "parameter_linknames": 1, "parameter_initial_enable": 1}
    if p["enum"]:
        v.update({"parameter_type": 2, "parameter_enum": list(p["items"]), "parameter_mmax": len(p["items"]) - 1,
                  "parameter_initial": [int(round(p["init"]))], "parameter_unitstyle": 9})
    else:
        v.update({"parameter_type": 0, "parameter_mmin": float(p["min"]), "parameter_mmax": float(p["max"]),
                  "parameter_initial": [float(p["init"])], "parameter_unitstyle": 1})
    v["parameter_info"] = p["info"]
    if p.get("extra"):
        v["parameter_invisible"] = int(p.get("invisible", 1))
    return v


def live_box(p, maxclass, rect, hidden, patch_xy):
    b = {
        "id": "obj-p-" + p["key"],
        "maxclass": maxclass,
        "numinlets": 1,
        "numoutlets": 3 if maxclass in ("live.tab", "live.menu") else 2,
        "outlettype": ["", "", "float"] if maxclass in ("live.tab", "live.menu") else ["", "float"] if maxclass != "live.text" else ["", ""],
        "parameter_enable": 1,
        "patching_rect": [float(patch_xy[0]), float(patch_xy[1]), 44.0, 15.0],
        "saved_attribute_attributes": {"valueof": valueof(p)},
        "varname": "op_" + p["key"],
        "annotation": p["info"],
    }
    if rect is not None:
        b.update({"presentation": 1, "presentation_rect": [float(v) for v in rect], "hidden": 1 if hidden else 0})
        for k in FACE_COLORS[maxclass]:
            b[k] = list(CLEAR)
        if maxclass == "live.dial":
            b.update({"showname": 0, "shownumber": 0})
        elif maxclass == "live.numbox":
            b.update({"appearance": 0})
        elif maxclass == "live.tab":
            b.update({"rounded": 0, "num_lines_patching": 1, "num_lines_presentation": 1})
        elif maxclass == "live.text":
            b.update({"text": "", "texton": "", "rounded": 0, "border": 0, "mode": 1})
    elif maxclass == "live.text":
        b["mode"] = 1
    return {"box": b}


def widget_rect(it):
    t = it["t"]
    if t == "dial":
        return [it["x"] - 13.5, it["y"] - 14.0, 27.0, 28.0]
    if t == "lcd":
        return [it["x"] - 1.0, it["y"] - 7.5, it["w"], 15.0]
    return [it["x"], it["y"], it["w"], it["h"]]


def visible_initial(it, sel):
    """Same rule as opItemVisible in src/opplus_ui.js for the saved state (cond defaults)."""
    if it["g"] != "shell" and it["g"] != "s%d" % sel:
        return False
    c = it.get("cond")
    if not c:
        return True
    P = {p["key"]: p for p in opplus_spec.spec()}
    v = lambda k: P[k]["init"]  # noqa: E731
    if c.startswith("nofix"):
        return v(c[5].lower() + "_fix_on") < 0.5
    if c.startswith("fix"):
        return v(c[3].lower() + "_fix_on") > 0.5
    if c == "lfosync":
        return round(v("lfo_range")) == 2
    if c == "lfonosync":
        return round(v("lfo_range")) != 2
    if c == "lphp":
        return round(v("filter_type")) <= 1
    if c == "nolphp":
        return round(v("filter_type")) > 1
    if c == "morph":
        return round(v("filter_type")) == 4
    if c == "drive":
        return round(v("filter_type")) <= 2 and round(v("filter_circuit_lp_hp")) > 0
    if c.startswith("times"):
        return True
    if c.startswith("slopes"):
        return False
    if c.startswith("mloop"):
        return round(v(c[5:] + "_mode")) == 1
    if c.startswith("mbeat"):
        return round(v(c[5:] + "_mode")) in (2, 3)
    return True


def face_script(region, layout, ubnames, params):
    gen = gen_code()
    text = sc.gendsp_json(gen)
    h = hashlib.sha1(text.encode()).hexdigest()[:12]
    pre = [
        "var OP_REGION = %s;" % json.dumps(region),
        "var OP_PARAMS = %s;" % json.dumps(params, separators=(",", ":")),
        "var OP_LAYOUT = %s;" % json.dumps(layout, separators=(",", ":")),
        "var OP_UBUTTONS = %s;" % json.dumps(ubnames),
        "var GEN_DSP_TEXT = %s;" % (json.dumps(text) if region == "main" else '""'),
        "var GEN_DSP_HASH = %s;" % json.dumps(h),
    ]
    if os.environ.get("OP_SECTION"):
        pre.append("var OP_PREVIEW_SECTION = %d;" % int(os.environ["OP_SECTION"]))
    if os.environ.get("OP_VIEW"):
        pre.append("var OP_PREVIEW_VIEW = %d;" % int(os.environ["OP_VIEW"]))
    parts = ["\n".join(pre) + "\n", sc.read(os.path.join(ROOT, "src", "spectral_theme.js")),
             sc.read(os.path.join(ROOT, "src", "opplus_config.js")), sc.read(os.path.join(ROOT, "src", "opplus_ui.js"))]
    return "\n".join(parts)


def build(out=OUT):
    params = opplus_spec.spec()
    P = {p["key"]: p for p in params}
    sel = int(os.environ.get("OP_SECTION", "0"))
    if os.environ.get("OP_SECTION"):
        P["ui_section"]["init"] = sel
    if os.environ.get("OP_VIEW") and sel < 7:
        P["ui_view_" + ["a", "b", "c", "d", "lfo", "filter", "pitch"][sel]]["init"] = int(os.environ["OP_VIEW"])
    layout = L.items()
    ub = L.ubuttons()
    ubnames = ["op_ub_" + u[0] for u in ub]

    boxes, lines = [], []
    gh = 23.0 if sel == 7 else 61.0
    face = sc.v8ui("obj-face", face_script("main", layout, ubnames, params), [0.0, 0.0, float(W), float(H)], (20.0, 20.0), 2, "op_face")
    face["box"]["ignoreclick"] = 1
    face["box"]["parameter_enable"] = 1
    face["box"]["saved_attribute_attributes"] = {"valueof": {"parameter_longname": "OperatorPlusState", "parameter_shortname": "OpState",
                                                             "parameter_type": 3, "parameter_invisible": 1, "parameter_initial_enable": 0}}
    graph = sc.v8ui("obj-graph", face_script("graph", layout, ubnames, params), [float(L.GRAPH[0]), 0.0, float(L.GRAPH[2]), gh], (20.0, 200.0), 1, "op_graph")
    boxes += [face, graph]

    # click zones (behind the transparent parameter objects: earlier in boxes)
    for name, rect, msg in ub:
        r = list(rect)
        if name.startswith("view"):
            r[1] = 61.0
        boxes.append({"box": {"id": "obj-ub-" + name, "maxclass": "ubutton", "numinlets": 1, "numoutlets": 4,
                              "outlettype": ["bang", "bang", "", "int"], "patching_rect": [700.0, 20.0 + 22 * len(boxes), 40.0, 20.0],
                              "presentation": 1, "presentation_rect": [float(v) for v in r], "varname": "op_ub_" + name,
                              "handoff": "", "hltcolor": list(CLEAR)}})
        boxes.append(message("obj-ubm-" + name, "click " + msg, 760, 20.0 + 22 * len(boxes), 90))
        lines.append(line("obj-ub-" + name, 0, "obj-ubm-" + name))
        lines.append(line("obj-ubm-" + name, 0, "obj-face"))

    # parameter objects
    placed = set()
    y0 = 400.0
    for i, it in enumerate(layout):
        k = it.get("key")
        if not k:
            continue
        p = P[k]
        mc = MAXCLASS[it["t"]]
        if p["enum"] and mc in ("live.dial", "live.numbox"):
            mc = "live.menu"
        boxes.append(live_box(p, mc, widget_rect(it), not visible_initial(it, sel), (40.0 + (i % 12) * 60, y0 + (i // 12) * 22)))
        placed.add(k)
    j = 0
    for p in params:
        if p["key"] in placed:
            continue
        mc = "live.menu" if p["enum"] else "live.numbox"
        boxes.append(live_box(p, mc, None, True, (40.0 + (j % 12) * 60, 900.0 + (j // 12) * 22)))
        j += 1
        placed.add(p["key"])
    for p in params:
        pid = "obj-pv-" + p["key"]
        boxes.append(newobj(pid, "prepend pv " + p["key"], 40.0, 1100.0, 120))
        lines.append(line("obj-p-" + p["key"], 0, pid))
        lines.append(line(pid, 0, "obj-face"))
        lines.append(line(pid, 0, "obj-graph"))

    # engine plumbing
    for nm, (bn, n) in BUF.items():
        boxes.append(newobj("obj-buf-" + nm, "buffer~ %s @samps %d" % (bn, n), 900, 40 + 24 * len(BUF) * 0 + 24 * list(BUF).index(nm), 260,
                            numoutlets=2, outlettype=["float", "bang"]))
    names = " ".join(BUF[k][0] for k in ("cfg", "voices", "waves", "scope"))
    boxes += [
        newobj("obj-loadbang", "loadbang", 900, 160, 60, outlettype=["bang"]),
        message("obj-msg-names", "setnames " + names, 900, 190, 360),
        newobj("obj-thisdevice", "live.thisdevice", 900, 230, 90, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init", "init", 900, 260, 40),
        newobj("obj-midiin", "midiin", 600, 20, 50, numoutlets=1, outlettype=["int"]),
        newobj("obj-midiparse", "midiparse", 600, 50, 80, numinlets=1, numoutlets=8, outlettype=[""] * 7 + ["int"]),
        newobj("obj-prep-note", "prepend midi_note", 600, 80, 100),
        newobj("obj-prep-cc", "prepend midi_cc", 700, 80, 100),
        newobj("obj-prep-touch", "prepend midi_touch", 800, 80, 110),
        newobj("obj-prep-bend", "prepend midi_bend", 910, 80, 110),
        newobj("obj-genin", "gate 1 1", 20, 320, 60, numinlets=2, numoutlets=1),
        newobj("obj-phasor", "plugphasor~", 120, 320, 80, numinlets=1, numoutlets=1, outlettype=["signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
    ]
    for b in boxes:
        bid = b["box"]["id"]
        if bid == "obj-genin":
            b["box"]["varname"] = "op_genin"
        elif bid == "obj-phasor":
            b["box"]["varname"] = "op_phasor"
        elif bid == "obj-plugout":
            b["box"]["varname"] = "op_plugout"
    lines += [
        line("obj-loadbang", 0, "obj-msg-names"), line("obj-msg-names", 0, "obj-face"), line("obj-msg-names", 0, "obj-graph"),
        line("obj-thisdevice", 0, "obj-msg-init"), line("obj-msg-init", 0, "obj-face"), line("obj-msg-init", 0, "obj-graph"),
        line("obj-midiin", 0, "obj-midiparse"),
        line("obj-midiparse", 0, "obj-prep-note"), line("obj-prep-note", 0, "obj-face"),
        line("obj-midiparse", 2, "obj-prep-cc"), line("obj-prep-cc", 0, "obj-face"),
        line("obj-midiparse", 4, "obj-prep-touch"), line("obj-prep-touch", 0, "obj-face"),
        line("obj-midiparse", 5, "obj-prep-bend"), line("obj-prep-bend", 0, "obj-face"),
        line("obj-face", 0, "obj-genin", 1),
        line("obj-face", 1, "obj-graph"),
        line("obj-graph", 0, "obj-face"),
    ]
    boxes.append(newobj("obj-testhook", "r opplus_test", 1000, 300, 90, numinlets=0, numoutlets=1))
    lines.append(line("obj-testhook", 0, "obj-face"))
    lines.append(line("obj-testhook", 0, "obj-graph"))
    doc = sc.patcher(boxes, lines, W, "Operator+: a recreation of Ableton Operator (4-operator FM synth)", "Operator+", "instrument", 0,
                     dev_type="iiii")
    sc.write_amxd(doc, out, dev_type=b"iiii")
    return out


if __name__ == "__main__":
    out = OUT
    if "--out" in sys.argv:
        out = sys.argv[sys.argv.index("--out") + 1]
    opplus_spec.write_json()
    build(out)
