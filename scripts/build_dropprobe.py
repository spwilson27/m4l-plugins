#!/usr/bin/env python3
"""Minimal drop-target probes for the Live / Max file-drop crash investigation (AGENTS.md section 27, "Open" crash
notes; scripts/drop_stress.py). No Reverb+ code at all:

  DropProbe DF.amxd   audio effect, one transparent whole-face Max `dropfile` (ignoreclick 1, like Reverb+) -> counter
  DropProbe LD.amxd   audio effect, one whole-face `live.drop` in parameter mode (like the IR File box) -> counter
  DropProbe End.amxd  pass-through (the set generator wants a Start and an End)
  dropprobe.maxpat    standalone Max patch: left half `dropfile`, right half `live.drop`, window at a fixed screen position
  probe_df.als / probe_ld.als   Live Sets (MCP Bridge on Main, one track with [probe][End]) -- need the VM paths, so run this
                                script INSIDE the VM (the generated sets reference the .amxd by absolute path)

The counter (a non-presented v8ui) counts every non-"none" message, keeps it in Global("dropprobe")[name] and writes
"<n> <path>" to /tmp/dropprobe_<name>.txt, so the count survives a Live crash.

  python3 scripts/build_dropprobe.py [--no-sets]       writes tests/out/dropprobe/*
"""
import json
import os
import struct
import subprocess
import sys

from minify_embed import minify_patcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out", "dropprobe")
W, H = 220.0, 169.0

COUNTER = r"""
inlets = 1; outlets = 1;
var NAME = "__NAME__"; var n = 0;
function note(a, kind) {
    var s = String(a.join(" "));
    if (s === "none" || s === "" || s === "bang") return;
    n++;
    try { var g = new Global("dropprobe"); g[NAME] = n; g[NAME + "_last"] = s; } catch (e) {}
    try { var f = new File("/tmp/dropprobe_" + NAME + ".log", "write"); if (f.isopen) { f.position = f.eof; f.writeline(n + " " + kind + " " + Date.now() + " " + s); f.close(); } } catch (e2) {}
    post("dropprobe " + NAME + " " + n + " " + kind + " " + s + "\n");
}
function anything() { note([messagename].concat(arrayfromargs(arguments)), "anything"); }
function symbol(s) { note([s], "symbol"); }
function list() { note(arrayfromargs(arguments), "list"); }
"""


def counter(oid, name):
    return {"box": {"border": 0, "filename": "none", "id": oid, "maxclass": "v8ui", "numinlets": 1, "numoutlets": 0,
                    "outlettype": [], "patching_rect": [400.0, 300.0, 64.0, 16.0],
                    "textfile": {"text": COUNTER.replace("__NAME__", name), "filename": "none", "flags": 0, "embed": 1, "autowatch": 1}}}


CAL = r"""
mgraphics.init(); mgraphics.relative_coords = 0; mgraphics.autofill = 0;
function paint() { }
function onidle(x, y) { try { var g = new Global("dropprobe"); g.hover = JSON.stringify({ x: x, y: y, t: Date.now() }); } catch (e) {} }
"""


def calview(oid, rect):
    return {"box": {"border": 0, "filename": "none", "id": oid, "maxclass": "v8ui", "numinlets": 1, "numoutlets": 0, "outlettype": [],
                    "patching_rect": [400.0, 340.0, rect[2], rect[3]], "presentation": 1, "presentation_rect": rect,
                    "textfile": {"text": CAL, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1}}}


def newobj(oid, text, x, y, ins, outs):
    return {"box": {"id": oid, "maxclass": "newobj", "numinlets": ins, "numoutlets": outs, "outlettype": [""] * outs,
                    "patching_rect": [x, y, 100.0, 20.0], "text": text, "fontname": "Arial Bold", "fontsize": 10.0}}


def dropfile(oid, rect, pres=1):
    b = {"bgcolor": [0, 0, 0, 0], "border": 0, "bordercolor": [0, 0, 0, 0], "id": oid, "ignoreclick": 1, "maxclass": "dropfile",
         "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""], "patching_rect": [20.0, 120.0, rect[2], rect[3]]}
    if pres:
        b.update({"presentation": 1, "presentation_rect": rect})
    return {"box": b}


def livedrop(oid, rect, pres=1):
    b = {"bordercolor": [0.28, 0.78, 0.94, 0.85], "fontsize": 8.0, "id": oid, "legend": "Drop", "maxclass": "live.drop",
         "numinlets": 1, "numoutlets": 2, "outlettype": ["", ""], "parameter_enable": 1,
         "patching_rect": [220.0, 120.0, rect[2], rect[3]], "textcolor": [0.84, 0.92, 0.98, 1.0],
         "saved_attribute_attributes": {"valueof": {"parameter_invisible": 1, "parameter_longname": "Probe File",
                                                    "parameter_modmode": 0, "parameter_shortname": "Probe File", "parameter_type": 4}},
         "varname": "Probe File"}
    if pres:
        b.update({"presentation": 1, "presentation_rect": rect})
    return {"box": b}


def panel(oid, rect):
    return {"box": {"angle": 270.0, "background": 1, "bgcolor": [1.0, 0.0, 1.0, 1.0], "border": 0, "id": oid, "maxclass": "panel",
                    "mode": 0, "numinlets": 1, "numoutlets": 0, "patching_rect": [10.0, 10.0, rect[2], rect[3]],
                    "presentation": 1, "presentation_rect": rect, "rounded": 0}}


def line(a, ao, b, bo):
    return {"patchline": {"source": [a, ao], "destination": [b, bo]}}


def patcher(boxes, lines, width, device=True):
    p = {"fileversion": 1, "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
         "classnamespace": "box", "rect": [100.0, 100.0, 700.0, 500.0], "bglocked": 0, "openinpresentation": 1,
         "default_fontsize": 10.0, "default_fontface": 0, "default_fontname": "Arial Bold", "gridonopen": 1,
         "gridsize": [8.0, 8.0], "statusbarvisible": 2, "toolbarvisible": 1, "boxanimatetime": 200,
         "boxes": boxes, "lines": lines, "parameters": {}, "dependency_cache": [], "autosave": 0}
    if device:
        p.update({"openrect": [0.0, 0.0, width, H], "devicewidth": width, "description": "drop probe", "digest": "drop probe"})
    return {"patcher": p}


def write_amxd(path, doc):
    minify_patcher(doc)
    payload = (json.dumps(doc, indent="\t") + "\n").encode("utf-8")
    hdr = b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0) + b"ptch" + struct.pack("<I", len(payload))
    with open(path, "wb") as f:
        f.write(hdr + payload)


def passthru():
    return [newobj("obj-plugin", "plugin~", 20, 20, 1, 2), newobj("obj-plugout", "plugout~", 20, 60, 2, 0)], \
           [line("obj-plugin", 0, "obj-plugout", 0), line("obj-plugin", 1, "obj-plugout", 1)]


def main():
    os.makedirs(OUT, exist_ok=True)
    face = [0.0, 0.0, W, H]
    # DF: transparent dropfile in front of a magenta panel (panel last, background)
    b, l = passthru()
    b += [counter("obj-count", "df"), dropfile("obj-drop", face), newobj("obj-print", "print dpdf", 20, 160, 1, 0), panel("obj-panel", face)]
    l += [line("obj-drop", 0, "obj-count", 0), line("obj-drop", 0, "obj-print", 0)]
    write_amxd(os.path.join(OUT, "DropProbe DF.amxd"), patcher(b, l, W))
    # LD: whole-face live.drop (parameter mode)
    b, l = passthru()
    b += [counter("obj-count", "ld"), livedrop("obj-drop", face), newobj("obj-print", "print dpld", 20, 160, 1, 0), panel("obj-panel", face)]
    l += [line("obj-drop", 0, "obj-count", 0), line("obj-drop", 0, "obj-print", 0)]
    write_amxd(os.path.join(OUT, "DropProbe LD.amxd"), patcher(b, l, W))
    # Cal: a pointer-reporting v8ui over the face (locates the device on screen; same size and rack position as the probes)
    b, l = passthru()
    b += [calview("obj-cal", face), panel("obj-panel", face)]
    write_amxd(os.path.join(OUT, "DropProbe Cal.amxd"), patcher(b, l, W))
    # End
    b, l = passthru()
    write_amxd(os.path.join(OUT, "DropProbe End.amxd"), patcher(b, l, 60.0))
    # standalone Max patch: window content at screen (560, 480), 400 x 200; left half dropfile, right half live.drop
    left, right = [0.0, 0.0, 200.0, 200.0], [200.0, 0.0, 200.0, 200.0]
    boxes = [counter("obj-count-df", "sdf"), counter("obj-count-ld", "sld"), dropfile("obj-drop", left), livedrop("obj-ld", right),
             panel("obj-panel", [0.0, 0.0, 400.0, 200.0])]
    lines = [line("obj-drop", 0, "obj-count-df", 0), line("obj-ld", 0, "obj-count-ld", 0)]
    pt = patcher(boxes, lines, 400.0, device=False)
    pt["patcher"]["rect"] = [560.0, 480.0, 400.0, 200.0]
    pt["patcher"]["openinpresentation"] = 1
    pt["patcher"]["toolbarvisible"] = 0
    pt["patcher"]["statusbarvisible"] = 0
    with open(os.path.join(OUT, "dropprobe.maxpat"), "w") as f:
        json.dump(pt, f, indent="\t")
    print("built devices + dropprobe.maxpat in", OUT)
    if "--no-sets" in sys.argv:
        return 0
    for tag in ("df", "ld", "cal"):
        subprocess.check_call([sys.executable, os.path.join(ROOT, "scripts", "make_delayplus_sets.py"),
                               "--start", os.path.join(OUT, "DropProbe %s.amxd" % tag.upper()),
                               "--end", os.path.join(OUT, "DropProbe End.amxd"), "--fold-end", "--name", "Probe",
                               "--track-name", "Probe %s" % tag.upper(), "--als", os.path.join(OUT, "probe_%s.als" % tag)])
    return 0


if __name__ == "__main__":
    sys.exit(main())
