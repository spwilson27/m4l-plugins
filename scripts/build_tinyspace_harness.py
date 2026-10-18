#!/usr/bin/env python3
"""Builds a Tiny Space audio test harness .maxpat with extra audio in/out sinks.

The harness feeds an impulse (click~) into the gen reverb and measures the
output peak at two time points (early vs late) via peakamp~ to validate:
  - decent output (peak above threshold)
  - no infinite ringing in normal mode (late peak << early peak)
  - sustain in freeze mode (late peak ~ early peak)

Usage:
    python3 scripts/build_tinyspace_harness.py [--freeze] [--out PATH]
"""
import argparse
import json
import os

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT_DIR, "src", "tinyspace_core.genexpr")

ap = argparse.ArgumentParser()
ap.add_argument("--freeze", action="store_true", help="Enable freeze mode")
ap.add_argument("--out", default=None, help="Output .maxpat path")
args = ap.parse_args()

suffix = "_freeze" if args.freeze else ""
default_out = os.path.join(ROOT_DIR, "tests", "tinyspace_harness%s.maxpat" % suffix)
OUT_PATH = args.out or default_out

with open(GEN_PATH) as f:
    gen_code = f.read()

freeze_val = 1.0 if args.freeze else 0.0
ctrl_vals = [0.5, 0.5, 1.0, 0.3, 0.4, freeze_val, 0.1, 1.0, 1.0, 0.05, 0.8, 0.0, 0.3]

test_ui_code = r'''
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
inlets = 1;
outlets = 1;
let bufName = "";
let snaps = [];
function setbuffer(n){ bufName = n; poke(); }
function poke(){
  if (!bufName) return;
  const arr = [10];
  for (let i = 0; i < 40; i++) arr.push(0.5);
  try { new Buffer(bufName).poke(1, 0, arr); } catch(e) {}
}
function loadbang(){ poke(); post("TINYZSPACE_HARNESS_OK\n"); }
function paint(){ mgraphics.set_source_rgba(0.06,0.07,0.09,1); mgraphics.rectangle(0,0,mgraphics.size[0],mgraphics.size[1]); mgraphics.fill(); }
// snapshot measurement: snapshot~ arrives as snap(v)
let snaps = [];
function snap(v){
  const val = (typeof v === "number") ? v : 0;
  snaps.push(val);
  post("SNAP " + snaps.length + " = " + val + "\n");
  if (snaps.length >= 3) {
    // early (after ~0.3s) vs late (after ~2s)
    const early = Math.max.apply(null, snaps.slice(0, 3).map(Math.abs));
    const late = Math.abs(snaps[snaps.length - 1]);
    const decent = early > 0.001;
    const noClip = early < 0.99;
    const ratio = (early > 0) ? (late / early) : 0;
    const freezeMode = ''' + ("true" if args.freeze else "false") + r''';
    const ringOk = freezeMode ? (ratio > 0.3) : (ratio < 0.3);
    if (decent && noClip && ringOk) post("HARNESS_PASS\n");
    else post("HARNESS_FAIL decent=" + decent + " noClip=" + noClip + " ringOk=" + ringOk + " ratio=" + ratio + " early=" + early + " late=" + late + "\n");
  }
}
'''

boxes = []
lines = []

boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-plugin", "maxclass": "newobj", "numinlets": 2, "numoutlets": 2, "outlettype": ["signal", "signal"], "patching_rect": [30.0, 30.0, 52.0, 20.0], "text": "plugin~"}})
boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-plugout", "maxclass": "newobj", "numinlets": 2, "numoutlets": 2, "outlettype": ["signal", "signal"], "patching_rect": [30.0, 80.0, 58.0, 20.0], "text": "plugout~"}})
lines.append({"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-plugout", 0]}})
lines.append({"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-plugout", 1]}})

boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-bufcfg", "maxclass": "newobj", "numinlets": 1, "numoutlets": 2, "outlettype": ["float", "bang"], "patching_rect": [30.0, 120.0, 180.0, 20.0], "text": "buffer~ #0-tsconfig @samps 48"}})
boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-loadbuf", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 150.0, 180.0, 20.0], "text": "loadmess setbuffer #0-tsconfig"}})

boxes.append({"box": {"code": gen_code, "fontface": 0, "fontname": "<Monospaced>", "fontsize": 10.0, "hidden": 1, "id": "obj-gen", "maxclass": "gen.codebox~", "numinlets": 15, "numoutlets": 22, "outlettype": ["signal"] * 22, "patching_rect": [30.0, 200.0, 260.0, 120.0], "varname": "TinySpaceGen"}})
lines.append({"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}})
lines.append({"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}})
lines.append({"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}})
lines.append({"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}})

boxes.append({"box": {"border": 0, "filename": "none", "id": "obj-viz", "maxclass": "v8ui", "numinlets": 1, "numoutlets": 0, "outlettype": [], "patching_rect": [30.0, 230.0, 200.0, 80.0], "textfile": {"text": test_ui_code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1}, "varname": "VizData"}})
lines.append({"patchline": {"source": ["obj-loadbuf", 0], "destination": ["obj-viz", 0]}})

# test tone (impulse) -> gen in1/in2
boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-click", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": ["signal"], "patching_rect": [30.0, 320.0, 60.0, 20.0], "text": "click~"}})
lines.append({"patchline": {"source": ["obj-click", 0], "destination": ["obj-gen", 0]}})
lines.append({"patchline": {"source": ["obj-click", 0], "destination": ["obj-gen", 1]}})

# control constants -> gen in3..in15
for i, v in enumerate(ctrl_vals):
    bid = "obj-ctrl-%d" % i
    boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": bid, "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": ["signal"], "patching_rect": [30.0, 340.0 + i * 12, 60.0, 20.0], "text": "sig~ %g" % v}})
    lines.append({"patchline": {"source": [bid, 0], "destination": ["obj-gen", 2 + i]}})

# snapshot measurement of gen out0 (continuous)
boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-snap", "maxclass": "newobj", "numinlets": 2, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 500.0, 80.0, 20.0], "text": "snapshot~ 200"}})
lines.append({"patchline": {"source": ["obj-gen", 0], "destination": ["obj-snap", 0]}})

boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-snapprep", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 520.0, 80.0, 20.0], "text": "prepend snap"}})
lines.append({"patchline": {"source": ["obj-snap", 0], "destination": ["obj-snapprep", 0]}})
lines.append({"patchline": {"source": ["obj-snapprep", 0], "destination": ["obj-viz", 0]}})

# loadbang -> click + v8ui
boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-lb", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 560.0, 70.0, 20.0], "text": "loadbang"}})
lines.append({"patchline": {"source": ["obj-lb", 0], "destination": ["obj-click", 0]}})

# loadbang -> v8ui
boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-lb2", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""], "patching_rect": [30.0, 640.0, 70.0, 20.0], "text": "loadbang"}})
lines.append({"patchline": {"source": ["obj-lb2", 0], "destination": ["obj-viz", 0]}})

# ezdac for monitoring
boxes.append({"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-ezdac", "maxclass": "newobj", "numinlets": 2, "numoutlets": 0, "outlettype": [], "patching_rect": [30.0, 680.0, 44.0, 44.0], "text": "ezdac~"}})
lines.append({"patchline": {"source": ["obj-gen", 0], "destination": ["obj-ezdac", 0]}})
lines.append({"patchline": {"source": ["obj-gen", 1], "destination": ["obj-ezdac", 1]}})

patcher = {
    "fileversion": 1,
    "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
    "classnamespace": "box",
    "rect": [60.0, 80.0, 900.0, 780.0],
    "bglocked": 0, "openinpresentation": 0,
    "default_fontsize": 10.0, "default_fontface": 0, "default_fontname": "Arial Bold",
    "gridonopen": 1, "gridsize": [15.0, 15.0], "gridsnaponopen": 1, "objectsnaponopen": 1,
    "statusbarvisible": 2, "toolbarvisible": 1,
    "lefttoolbarpinned": 0, "toptoolbarpinned": 0, "righttoolbarpinned": 0, "bottomtoolbarpinned": 0,
    "toolbars_unpinned_last_save": 0, "tallnewobj": 0, "boxanimatetime": 200,
    "enablehscroll": 1, "enablevscroll": 1, "devicewidth": 0.0,
    "description": "", "digest": "", "tags": "", "style": "", "subpatcher_template": "",
    "boxes": boxes, "lines": lines,
    "parameters": {}, "dependency_cache": [], "latency": 0,
}

os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
with open(OUT_PATH, "w") as f:
    json.dump({"patcher": patcher}, f, indent="\t")
print("Built", OUT_PATH)