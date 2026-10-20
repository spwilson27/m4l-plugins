#!/usr/bin/env python3
"""
Build Delay+ (Bitwig Delay+ style delay whose feedback loop runs through a Live device chain).

Outputs (devices/):
  Delay+ A.amxd, Delay+ B.amxd, Delay+ C.amxd  Start device, one per visualization variant
                                               (src/delayplus_viz_{a,b,c}.js), same DSP / params
  Delay+ End.amxd                              End device (closes the loop, mixes dry/wet)
  Delay+ A.adg, Delay+ B.adg, Delay+ C.adg     Audio Effect Rack presets: [Delay+ X] [Delay+ End]
Plus the Live test set delayplus_test.als (tracks "Delay+ A/B/C": rack [Start, Limiter 6 ms, End],
Ableton MCP Bridge on the Main track) via scripts/make_delayplus_sets.py.

Usage: build_delayplus.py [--variant a|b|c] [--no-sets]

Start layout (480 x 169): visualization v8ui x=6..228 (status header inside), control grid
x=234..474: row 1 Time|Division, Offset, Feedback, Mix, Sync/Freeze buttons; row 2 HP, LP, Drive,
Rate, Depth; row 3 Duck, Width, Stereo Mode / Time Mode tabs and the Debug button.
End layout (124 x 169): status v8ui only.
"""

import argparse
import json
import os
import struct
import subprocess
import time
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
OUT_DIR = os.path.join(ROOT, "devices")

DEVICE_H = 169.0
START_W = 480.0
END_W = 124.0
RING = 65536
SCOPE_SAMPS = 32 + 3 * 512
ESCOPE_SAMPS = 32

VARIANTS = {
    "a": {"name": "Delay+ A", "viz": "delayplus_viz_a.js"},
    "b": {"name": "Delay+ B", "viz": "delayplus_viz_b.js"},
    "c": {"name": "Delay+ C", "viz": "delayplus_viz_c.js"},
}
END_NAME = "Delay+ End"

CYAN = (0.30, 0.82, 0.95)
AMBER = (0.97, 0.68, 0.26)
VIOLET = (0.66, 0.55, 0.98)
GREEN = (0.40, 0.88, 0.52)
CORAL = (0.98, 0.42, 0.38)
SLATE = (0.62, 0.68, 0.76)

DIVISIONS = ["1/64", "1/32T", "1/32", "1/16T", "1/32D", "1/16", "1/8T", "1/16D", "1/8", "1/4T",
             "1/8D", "1/4", "1/2T", "1/4D", "1/2", "1/1T", "1/2D", "1/1", "2/1", "4/1"]

# key: long, short, lo, hi, initial, ptype (0 float, 1 int, 2 enum), unitstyle, exponent,
#      gen param (None = UI only), scale (/100 before gen), help, enum
P = {
    "time": ("Time", "Time", 1.0, 5000.0, 375.0, 0, 2, 3.0, None, False,
             "Delay time in free mode. Never shorter than the chain latency (see MIN in the display).", None),
    "div": ("Division", "Div", 0, len(DIVISIONS) - 1, 10, 2, 9, 1.0, None, False,
            "Delay time in tempo-sync mode.", DIVISIONS),
    "sync": ("Sync", "Sync", 0, 1, 1, 2, 9, 1.0, None, False,
             "Free time in ms, or tempo-synced divisions.", ["Free", "Sync"]),
    "offset": ("Stereo Offset", "Offset", -50.0, 50.0, 0.0, 0, 5, 1.0, "off", True,
               "Delays one side by a fraction of the time: right when positive, left when negative.", None),
    "fb": ("Feedback", "Feedback", 0.0, 110.0, 40.0, 0, 5, 1.0, "fb", True,
           "How much of the processed echo goes back into the tank. Above 100% the loop saturates softly.", None),
    "wet": ("Dry/Wet", "Mix", 0.0, 100.0, 35.0, 0, 5, 1.0, "wet", True,
            "Dry/wet mix (done in Delay+ End). Dry stays at unity up to 50%, wet from 50%.", None),
    "freeze": ("Freeze", "Freeze", 0, 1, 0, 2, 9, 1.0, "freeze", False,
               "Stops input into the tank and loops what is in it at 100% feedback.", ["Off", "On"]),
    "hp": ("Low Cut", "Low Cut", 20.0, 2000.0, 20.0, 0, 3, 3.0, "hp", False,
           "High-pass on the tap: thins every repeat.", None),
    "lp": ("High Cut", "High Cut", 500.0, 20000.0, 20000.0, 0, 3, 3.0, "lp", False,
           "Low-pass on the tap: darkens every repeat.", None),
    "drive": ("Drive", "Drive", 0.0, 100.0, 0.0, 0, 5, 1.0, "drive", True,
              "Saturation on the tap, before the device chain.", None),
    "mrate": ("Mod Rate", "Rate", 0.05, 10.0, 0.5, 0, 3, 3.0, "mrate", False,
              "Speed of the delay-time modulation (wow).", None),
    "mdepth": ("Mod Depth", "Depth", 0.0, 100.0, 0.0, 0, 5, 1.0, "mdepth", True,
               "Depth of the delay-time modulation, up to 8 ms.", None),
    "duck": ("Ducking", "Duck", 0.0, 100.0, 0.0, 0, 5, 1.0, "duck", True,
             "Turns the echoes down while the input is playing.", None),
    "width": ("Width", "Width", 0.0, 200.0, 100.0, 0, 5, 1.0, "width", True,
              "Stereo width of the echoes.", None),
    "pp": ("Stereo Mode", "Mode", 0, 1, 0, 2, 9, 1.0, "pp", False,
           "Stereo keeps the sides apart; Ping-Pong bounces echoes between them.", ["Stereo", "Ping-Pong"]),
    "tmode": ("Time Mode", "Time Mode", 0, 1, 0, 2, 9, 1.0, "tmode", False,
              "Tape glides to a new time (pitch bends); Fade crossfades to it.", ["Tape", "Fade"]),
    "debug": ("Debug", "Debug", 0, 1, 0, 2, 9, 1.0, "debug", False,
              "Measures the chain latency with an impulse every 0.5 s (replaces the echoes) and compares it with Live's reported latency.",
              ["Off", "On"]),
}

COL_X = [234.0 + c * 48.0 for c in range(5)]
DIAL_W, DIAL_H = 44.0, 47.0
ROW_Y = [8.0, 60.0, 112.0]


def valueof(key):
    long_name, short, lo, hi, init, ptype, unit, expo, _g, _s, help_text, enum = P[key]
    v = {
        "parameter_annotation_name": long_name,
        "parameter_info": help_text,
        "parameter_initial": [init],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_shortname": short,
        "parameter_type": ptype,
    }
    if enum:
        v["parameter_enum"] = enum
        v["parameter_mmax"] = len(enum) - 1
    else:
        v["parameter_mmin"] = lo
        v["parameter_mmax"] = hi
        v["parameter_unitstyle"] = unit
        if expo != 1.0:
            v["parameter_exponent"] = expo
    return v


def rgba(c, a=1.0):
    return [c[0], c[1], c[2], a]


def newobj(oid, text, x, y, w=100.0, ins=1, outs=1, outtypes=None):
    return {"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": oid, "maxclass": "newobj",
        "numinlets": ins, "numoutlets": outs, "outlettype": outtypes if outtypes is not None else [""] * outs,
        "patching_rect": [float(x), float(y), float(w), 20.0], "text": text,
    }}


def msgbox(oid, text, x, y, w=160.0):
    return {"box": {
        "fontname": "Arial Bold", "fontsize": 10.0, "id": oid, "maxclass": "message", "numinlets": 2,
        "numoutlets": 1, "outlettype": [""], "patching_rect": [float(x), float(y), float(w), 20.0], "text": text,
    }}


def dial(key, x, y, color, hidden=0):
    long_name = P[key][0]
    box = {
        "activedialcolor": rgba(color), "activeneedlecolor": rgba(color),
        "annotation": P[key][10], "annotation_name": long_name,
        "fontsize": 9.0, "id": f"obj-ctrl-{key}", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2,
        "outlettype": ["", "float"], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, DIAL_W, DIAL_H], "presentation": 1,
        "presentation_rect": [x, y, DIAL_W, DIAL_H],
        "saved_attribute_attributes": {"valueof": valueof(key)},
        "textcolor": rgba(SLATE), "varname": long_name,
    }
    if hidden:
        box["hidden"] = 1
    return {"box": box}


def tab(key, x, y, w, h, color):
    long_name = P[key][0]
    return {"box": {
        "activebgcolor": [0.10, 0.11, 0.14, 1.0], "activebgoncolor": rgba(color, 0.85),
        "annotation": P[key][10], "annotation_name": long_name, "bordercolor": [0.22, 0.26, 0.32, 1.0],
        "focusbordercolor": rgba(color), "fontsize": 8.5, "id": f"obj-ctrl-{key}", "maxclass": "live.tab",
        "num_lines_patching": 1, "num_lines_presentation": 1, "numinlets": 1, "numoutlets": 3,
        "outlettype": ["", "", "float"], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)},
        "textcolor": rgba(SLATE), "textoncolor": [0.05, 0.06, 0.08, 1.0], "varname": long_name,
    }}


def button(key, x, y, w, h, color, text, texton):
    long_name = P[key][0]
    return {"box": {
        "activebgcolor": [0.10, 0.11, 0.14, 1.0], "activebgoncolor": rgba(color, 0.9),
        "annotation": P[key][10], "annotation_name": long_name, "bordercolor": [0.22, 0.26, 0.32, 1.0],
        "fontsize": 8.5, "id": f"obj-ctrl-{key}", "maxclass": "live.text", "mode": 1, "numinlets": 1,
        "numoutlets": 2, "outlettype": ["", ""], "parameter_enable": 1,
        "patching_rect": [x + 600.0, y + 300.0, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "saved_attribute_attributes": {"valueof": valueof(key)},
        "text": text, "texton": texton, "textcolor": rgba(SLATE), "textoncolor": [0.05, 0.06, 0.08, 1.0],
        "varname": long_name,
    }}


def v8ui(oid, code, rect, patch_xy, outs):
    return {"box": {
        "border": 0, "filename": "none", "id": oid, "maxclass": "v8ui", "numinlets": 1, "numoutlets": outs,
        "outlettype": [""] * outs, "patching_rect": [patch_xy[0], patch_xy[1], rect[2], rect[3]],
        "presentation": 1, "presentation_rect": [float(v) for v in rect],
        "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
    }}


def gen_box(code, outs=2):
    return {"box": {
        "code": code, "fontname": "<Monospaced>", "fontsize": 10.0, "id": "obj-gen", "maxclass": "gen.codebox~",
        "numinlets": 2, "numoutlets": outs, "outlettype": ["signal"] * outs,
        "patching_rect": [20.0, 120.0, 420.0, 160.0],
    }}


def panel(oid, x, y, w, h, bg=(0.085, 0.095, 0.115), border=(0.20, 0.23, 0.28)):
    return {"box": {
        "angle": 270.0, "background": 1, "bgcolor": rgba(bg), "border": 1, "bordercolor": rgba(border),
        "id": oid, "maxclass": "panel", "mode": 0, "numinlets": 1, "numoutlets": 0,
        "patching_rect": [float(x), 10.0, float(w), float(h)], "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)], "rounded": 6,
    }}


def line(src, so, dst, di):
    return {"patchline": {"source": [src, so], "destination": [dst, di]}}


# Stamped into every script (registry entry `build`) so tests can tell a reloaded device apart.
BUILD_STAMP = time.strftime("%Y%m%d-%H%M%S")


def read(name):
    with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
        return f.read()


def patcher(boxes, lines, width, description):
    return {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "box", "rect": [100.0, 100.0, 1200.0, 700.0],
        "openrect": [0.0, 0.0, width, DEVICE_H], "bglocked": 0, "openinpresentation": 1,
        "default_fontsize": 10.0, "default_fontface": 0, "default_fontname": "Arial Bold",
        "gridonopen": 1, "gridsize": [8.0, 8.0], "gridsnaponopen": 1, "objectsnaponopen": 1,
        "statusbarvisible": 2, "toolbarvisible": 1, "boxanimatetime": 200, "enablehscroll": 1,
        "enablevscroll": 1, "devicewidth": width, "description": description,
        "digest": description, "tags": "delay echo feedback rack latency", "style": "",
        "subpatcher_template": "", "assistshowspatchername": 0,
        "boxes": boxes, "lines": lines, "parameters": {}, "dependency_cache": [], "autosave": 0,
    }}


def write_amxd(path, doc):
    payload = (json.dumps(doc, indent="\t") + "\n").encode("utf-8")
    header = (b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4)
              + struct.pack("<I", 0) + b"ptch" + struct.pack("<I", len(payload)))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(header + payload)
    print(f"Built {path} ({len(header) + len(payload)} bytes)")


def build_start(variant):
    cfg = VARIANTS[variant]
    code = (read("delayplus_config.js").rstrip() + f"\n\nvar DP_ROLE = \"start\";\nvar DP_BUILD = \"{BUILD_STAMP}\";\n\n"
            + read("delayplus_link.js").rstrip() + "\n\n" + read("delayplus_ui.js").rstrip() + "\n\n"
            + read(cfg["viz"]))
    boxes = [
        v8ui("obj-viz", code, [6.0, 6.0, 222.0, 157.0], (500.0, 20.0), 1),
        # row 1
        dial("time", COL_X[0], ROW_Y[0], CYAN, hidden=1),
        dial("div", COL_X[0], ROW_Y[0], CYAN),
        dial("offset", COL_X[1], ROW_Y[0], CYAN),
        dial("fb", COL_X[2], ROW_Y[0], AMBER),
        dial("wet", COL_X[3], ROW_Y[0], AMBER),
        button("sync", COL_X[4], ROW_Y[0] + 6.0, 44.0, 16.0, CYAN, "Free", "Sync"),
        button("freeze", COL_X[4], ROW_Y[0] + 27.0, 44.0, 16.0, VIOLET, "Freeze", "Freeze"),
        # row 2
        dial("hp", COL_X[0], ROW_Y[1], GREEN),
        dial("lp", COL_X[1], ROW_Y[1], GREEN),
        dial("drive", COL_X[2], ROW_Y[1], CORAL),
        dial("mrate", COL_X[3], ROW_Y[1], VIOLET),
        dial("mdepth", COL_X[4], ROW_Y[1], VIOLET),
        # row 3
        dial("duck", COL_X[0], ROW_Y[2], AMBER),
        dial("width", COL_X[1], ROW_Y[2], CYAN),
        tab("pp", COL_X[2], ROW_Y[2] + 6.0, 92.0, 16.0, CYAN),
        tab("tmode", COL_X[2], ROW_Y[2] + 27.0, 92.0, 16.0, VIOLET),
        button("debug", COL_X[4], ROW_Y[2] + 6.0, 44.0, 16.0, GREEN, "Debug", "Debug"),
        newobj("obj-plugin", "plugin~", 20, 60, 60, 2, 2, ["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 300, 60, 2, 2, ["signal", "signal"]),
        gen_box(read("delayplus_start.genexpr")),
        newobj("obj-buf-xfer", f"buffer~ ---dpxfer @samps {RING} @chans 5", 480, 300, 260, 1, 2, ["float", "bang"]),
        newobj("obj-buf-hdr", "buffer~ ---dphdr @samps 64", 480, 330, 200, 1, 2, ["float", "bang"]),
        newobj("obj-buf-scope", f"buffer~ ---dpscope @samps {SCOPE_SAMPS}", 480, 360, 220, 1, 2, ["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 480, 400, 60, 1, 1, ["bang"]),
        msgbox("obj-msg-gen-bufs", "xfer ---dpxfer, hdr ---dphdr, scope ---dpscope", 480, 430, 280),
        msgbox("obj-msg-ui-names", "names ---dpxfer ---dphdr ---dpscope", 480, 460, 240),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, 1, 2, ["bang", "int"]),
        msgbox("obj-msg-init", "init_link", 780, 430, 70),
        newobj("obj-sync-hide-time", "prepend hidden", 900, 260, 100),
        newobj("obj-sync-not", "!- 1", 1010, 230, 40, 2, 1, ["int"]),
        newobj("obj-sync-hide-div", "prepend hidden", 1010, 260, 100),
    ]
    lines = [
        line("obj-plugin", 0, "obj-gen", 0), line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0), line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-gen-bufs", 0), line("obj-msg-gen-bufs", 0, "obj-gen", 0),
        line("obj-loadbang", 0, "obj-msg-ui-names", 0), line("obj-msg-ui-names", 0, "obj-viz", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0), line("obj-msg-init", 0, "obj-viz", 0),
        line("obj-viz", 0, "obj-gen", 0),
        line("obj-ctrl-sync", 0, "obj-sync-hide-time", 0), line("obj-sync-hide-time", 0, "obj-ctrl-time", 0),
        line("obj-ctrl-sync", 0, "obj-sync-not", 0), line("obj-sync-not", 0, "obj-sync-hide-div", 0),
        line("obj-sync-hide-div", 0, "obj-ctrl-div", 0),
    ]
    for i, key in enumerate(P):
        gen_param, scale = P[key][8], P[key][9]
        y = 500.0 + i * 26.0
        ui_id = f"obj-ui-{key}"
        boxes.append(newobj(ui_id, f"prepend set_{key}", 760, y, 110))
        lines.append(line(f"obj-ctrl-{key}", 0, ui_id, 0))
        lines.append(line(ui_id, 0, "obj-viz", 0))
        if gen_param is None:
            continue
        src = f"obj-ctrl-{key}"
        if scale:
            sid = f"obj-scale-{key}"
            boxes.append(newobj(sid, "/ 100.", 880, y, 50, 2, 1, ["float"]))
            lines.append(line(src, 0, sid, 0))
            src = sid
        pid = f"obj-prep-{key}"
        boxes.append(newobj(pid, f"prepend {gen_param}", 940, y, 100))
        lines.append(line(src, 0, pid, 0))
        lines.append(line(pid, 0, "obj-gen", 0))
    boxes.append(panel("obj-panel-controls", 230, 4, 246, 161))  # background panels last
    doc = patcher(boxes, lines, START_W, "Delay whose feedback loop runs through the devices between Delay+ and Delay+ End")
    write_amxd(os.path.join(OUT_DIR, cfg["name"] + ".amxd"), doc)


def build_end():
    code = (read("delayplus_config.js").rstrip() + f"\n\nvar DP_ROLE = \"end\";\nvar DP_BUILD = \"{BUILD_STAMP}\";\n\n"
            + read("delayplus_link.js").rstrip() + "\n\n" + read("delayplus_end_ui.js"))
    boxes = [
        v8ui("obj-viz", code, [4.0, 4.0, END_W - 8.0, DEVICE_H - 8.0], (500.0, 20.0), 1),
        newobj("obj-plugin", "plugin~", 20, 60, 60, 2, 2, ["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 300, 60, 2, 2, ["signal", "signal"]),
        gen_box(read("delayplus_end.genexpr")),
        # Own buffers: used until the link layer binds gen to the Start's xfer / hdr.
        newobj("obj-buf-xfer", "buffer~ ---dpxferE @samps 64 @chans 5", 480, 300, 240, 1, 2, ["float", "bang"]),
        newobj("obj-buf-hdr", "buffer~ ---dphdrE @samps 64", 480, 330, 200, 1, 2, ["float", "bang"]),
        newobj("obj-buf-scope", f"buffer~ ---dpscopeE @samps {ESCOPE_SAMPS}", 480, 360, 220, 1, 2, ["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 480, 400, 60, 1, 1, ["bang"]),
        msgbox("obj-msg-gen-bufs", "xfer ---dpxferE, hdr ---dphdrE, scope ---dpscopeE", 480, 430, 300),
        msgbox("obj-msg-ui-names", "names ---dpxferE ---dphdrE ---dpscopeE", 480, 460, 260),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, 1, 2, ["bang", "int"]),
        msgbox("obj-msg-init", "init_link", 780, 430, 70),
    ]
    lines = [
        line("obj-plugin", 0, "obj-gen", 0), line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0), line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-gen-bufs", 0), line("obj-msg-gen-bufs", 0, "obj-gen", 0),
        line("obj-loadbang", 0, "obj-msg-ui-names", 0), line("obj-msg-ui-names", 0, "obj-viz", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0), line("obj-msg-init", 0, "obj-viz", 0),
        line("obj-viz", 0, "obj-gen", 0),
    ]
    doc = patcher(boxes, lines, END_W, "Closes the Delay+ feedback loop and mixes dry/wet")
    write_amxd(os.path.join(OUT_DIR, END_NAME + ".amxd"), doc)


def build_sets(variants):
    gen = os.path.join(ROOT, "scripts", "make_delayplus_sets.py")
    end = os.path.join(OUT_DIR, END_NAME + ".amxd")
    for v in variants:
        name = VARIANTS[v]["name"]
        start = os.path.join(OUT_DIR, name + ".amxd")
        subprocess.run([sys.executable, gen, "--start", start, "--end", end, "--name", "Delay+",
                        "--adg", os.path.join(OUT_DIR, name + ".adg")], check=True)
    tracks = []
    for v in sorted(VARIANTS):
        start = os.path.join(OUT_DIR, VARIANTS[v]["name"] + ".amxd")
        if os.path.isfile(start):
            tracks += ["--track", f"{VARIANTS[v]['name']}::{start}"]
    subprocess.run([sys.executable, gen, "--start", tracks[1].split("::")[1], "--end", end, "--middle", "limiter",
                    "--name", "Delay+", "--als", os.path.join(ROOT, "delayplus_test.als")] + tracks, check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", choices=sorted(VARIANTS), default=None)
    ap.add_argument("--no-sets", action="store_true")
    args = ap.parse_args()
    variants = [args.variant] if args.variant else sorted(VARIANTS)
    variants = [v for v in variants if os.path.isfile(os.path.join(SRC, VARIANTS[v]["viz"]))]
    for v in variants:
        build_start(v)
    build_end()
    if not args.no_sets:
        build_sets(variants)


if __name__ == "__main__":
    main()
