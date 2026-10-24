#!/usr/bin/env python3
"""
Builds `devices/Theme Editor.amxd` (320 x 169 px) — Suite-Wide M4L Theme Studio & WebUI Server.

Embeds:
  - `src/theme_engine.js` + `src/theme_editor_ui.js` inside `obj-viz` (`v8ui`, 308 x 157 px)
    for in-device preset switching, macro sliders, live 12-token swatch preview, and
    `Global("m4l_theme_bus")` synchronization across all open M4L plugins.
  - `src/theme_editor_web.html` (with `src/theme_engine.js` inlined) + `src/theme_editor_node.js`
    inside `obj-node` (`node.codebox`, `@autostart 1`) serving the interactive 2x Retina WebUI
    on `http://127.0.0.1:9888` (and inside the built-in `p ThemeWebWindow` `jweb` pop-out).
"""

import json
import os
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import theme_common as tc

UI_JS_PATH = ROOT / "src" / "theme_editor_ui.js"
NODE_JS_PATH = ROOT / "src" / "theme_editor_node.js"
WEB_HTML_PATH = ROOT / "src" / "theme_editor_web.html"
ENGINE_JS_PATH = ROOT / "src" / "theme_engine.js"
OUT_AMXD_PATH = ROOT / "devices" / "Theme Editor.amxd"

DEVICE_WIDTH = 320.0
DEVICE_HEIGHT = 169.0


def newobj(obj_id, text, x, y, w=90.0, h=20.0, numinlets=1, numoutlets=1, outlettype=None):
    box = {
        "id": obj_id,
        "maxclass": "newobj",
        "numinlets": numinlets,
        "numoutlets": numoutlets,
        "patching_rect": [float(x), float(y), float(w), float(h)],
        "text": text,
    }
    if outlettype is not None:
        box["outlettype"] = outlettype
    elif numoutlets > 0:
        box["outlettype"] = [""] * numoutlets
    return {"box": box}


def msgbox(obj_id, text, x, y, w=80.0, h=20.0):
    return {
        "box": {
            "id": obj_id,
            "maxclass": "message",
            "numinlets": 2,
            "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
        }
    }


def line(src_id, src_outlet, dst_id, dst_inlet, order=None):
    pl = {
        "destination": [dst_id, int(dst_inlet)],
        "source": [src_id, int(src_outlet)],
    }
    if order is not None:
        pl["order"] = int(order)
    return {"patchline": pl}


def make_jweb_subpatcher():
    return {
        "box": {
            "id": "obj-web-win",
            "maxclass": "newobj",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [360.0, 320.0, 115.0, 20.0],
            "text": "p ThemeWebWindow",
            "patcher": {
                "fileversion": 1,
                "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
                "classnamespace": "box",
                "rect": [120.0, 100.0, 1280.0, 820.0],
                "openrect": [120.0, 100.0, 1280.0, 820.0],
                "bglocked": 0,
                "openinpresentation": 1,
                "default_fontsize": 10.0,
                "default_fontname": "Arial",
                "gridsize": [15.0, 15.0],
                "statusbarvisible": 0,
                "toolbarvisible": 0,
                "enablehscroll": 0,
                "enablevscroll": 0,
                "bgcolor": [0.043, 0.055, 0.078, 1.0],
                "editing_bgcolor": [0.043, 0.055, 0.078, 1.0],
                "title": "M4L Theme Studio",
                "boxes": [
                    {
                        "box": {
                            "id": "obj-in",
                            "index": 1,
                            "maxclass": "inlet",
                            "numinlets": 0,
                            "numoutlets": 1,
                            "outlettype": [""],
                            "patching_rect": [30.0, 20.0, 25.0, 25.0],
                        }
                    },
                    newobj("obj-route", "route open url", 30.0, 60.0, 95.0, 20.0, 1, 3, ["", "", ""]),
                    msgbox("obj-front", "front, window flags grow close zoom nofloat, window exec", 30.0, 95.0, 290.0, 20.0),
                    newobj("obj-tp", "thispatcher", 30.0, 165.0, 70.0, 20.0, 1, 2, ["", ""]),
                    newobj("obj-qmetro", "qmetro 50 @active 1", 335.0, 60.0, 120.0, 20.0, 2, 1, ["bang"]),
                    msgbox("obj-getsize", "window getsize", 335.0, 95.0, 92.0, 20.0),
                    newobj("obj-route-win", "route window", 30.0, 200.0, 85.0, 20.0, 1, 2, ["", ""]),
                    newobj("obj-route-size", "route size", 30.0, 232.0, 68.0, 20.0, 1, 2, ["", ""]),
                    newobj("obj-expr-wh", "vexpr $i2 - $i1", 30.0, 264.0, 95.0, 20.0, 2, 1, [""]),
                    newobj("obj-zl- rot", "zl.slice 2", 30.0, 296.0, 62.0, 20.0, 2, 2, ["", ""]),
                    newobj("obj-chg-wh", "zl.change", 30.0, 328.0, 65.0, 20.0, 2, 2, ["", ""]),
                    msgbox("obj-prect", "presentation_rect 0. 0. $1 $2, patching_rect 0. 0. $1 $2", 30.0, 360.0, 295.0, 20.0),
                    msgbox("obj-url-msg", "url $1", 480.0, 95.0, 60.0, 20.0),
                    {
                        "box": {
                            "id": "obj-jweb",
                            "maxclass": "jweb",
                            "numinlets": 1,
                            "numoutlets": 1,
                            "outlettype": [""],
                            "patching_rect": [0.0, 0.0, 1280.0, 820.0],
                            "presentation": 1,
                            "presentation_rect": [0.0, 0.0, 1280.0, 820.0],
                            "rendermode": 1,
                            "url": "http://127.0.0.1:9888/",
                            "varname": "theme_jweb",
                        }
                    },
                ],
                "lines": [
                    line("obj-in", 0, "obj-route", 0),
                    line("obj-route", 0, "obj-front", 0),
                    line("obj-front", 0, "obj-tp", 0),
                    line("obj-qmetro", 0, "obj-getsize", 0),
                    line("obj-getsize", 0, "obj-tp", 0),
                    line("obj-tp", 0, "obj-route-win", 0),
                    line("obj-route-win", 0, "obj-route-size", 0),
                    line("obj-route-size", 0, "obj-zl- rot", 0),
                    line("obj-zl- rot", 0, "obj-expr-wh", 1),
                    line("obj-zl- rot", 1, "obj-expr-wh", 0),
                    line("obj-expr-wh", 0, "obj-chg-wh", 0),
                    line("obj-chg-wh", 0, "obj-prect", 0),
                    line("obj-prect", 0, "obj-jweb", 0),
                    line("obj-route", 1, "obj-url-msg", 0),
                    line("obj-url-msg", 0, "obj-jweb", 0),
                ],
            },
        }
    }


def build_patcher():
    ui_js = UI_JS_PATH.read_text(encoding="utf-8")
    node_js_raw = NODE_JS_PATH.read_text(encoding="utf-8")
    web_html_raw = WEB_HTML_PATH.read_text(encoding="utf-8")
    engine_js_raw = ENGINE_JS_PATH.read_text(encoding="utf-8")

    inlined_html = web_html_raw.replace(
        '<script id="m4lThemeEngineInline"></script>',
        f'<script id="m4lThemeEngineInline">\n{engine_js_raw}\n</script>',
    )
    node_js = f"var M4L_THEME_WEB_HTML = {json.dumps(inlined_html)};\n" + node_js_raw

    boxes = [
        # Transparent stereo audio pass-through
        newobj("obj-plugin", "plugin~", 40, 40, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 40, 120, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),

        # Startup initialization
        newobj("obj-loadbang", "loadbang", 180, 40, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        newobj("obj-thisdevice", "live.thisdevice", 260, 40, 85, 20, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        msgbox("obj-msg-init", "loadbang", 180, 80, 65, 20),
        msgbox("obj-msg-start", "script start", 260, 80, 75, 20),

        # Theme Studio In-Device Canvas (v8ui)
        {
            "box": {
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [180.0, 140.0, 308.0, 157.0],
                "presentation": 1,
                "presentation_rect": [6.0, 6.0, 308.0, 157.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_initial_enable": 0,
                        "parameter_invisible": 1,
                        "parameter_longname": "ThemeEditorData",
                        "parameter_shortname": "ThemeData",
                        "parameter_type": 3,
                    }
                },
                "textfile": {
                    "autowatch": 1,
                    "embed": 1,
                    "filename": "none",
                    "flags": 0,
                    "text": ui_js,
                },
                "varname": "ThemeEditorData",
            }
        },

        # Floating jweb pop-out subpatcher window
        make_jweb_subpatcher(),

        # Routing from node.codebox -> v8ui
        newobj("obj-route-node", "route theme_sync server_status", 180, 360, 175, 20, numinlets=1, numoutlets=3, outlettype=["", "", ""]),
        newobj("obj-prep-sync", "prepend theme_sync", 180, 400, 115, 20),
        newobj("obj-prep-status", "prepend set_server_status", 310, 400, 150, 20),

        # Node for Max WebUI HTTP + SSE Server (background: 1, 1x1 presentation rect)
        {
            "box": {
                "background": 1,
                "code": node_js,
                "fontface": 0,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-node",
                "ignoreclick": 1,
                "maxclass": "node.codebox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [520.0, 140.0, 320.0, 160.0],
                "presentation": 1,
                "presentation_rect": [2.0, 164.0, 1.0, 1.0],
                "saved_object_attributes": {
                    "autostart": 1,
                    "defer": 1,
                    "watch": 0,
                },
            }
        },

        # Background panel at end of boxes list with background: 1
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.055, 0.068, 0.088, 1.0],
                "border": 1,
                "bordercolor": [0.16, 0.22, 0.30, 1.0],
                "id": "obj-panel-bg",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [3.0, 4.0, 314.0, 161.0],
                "presentation": 1,
                "presentation_rect": [3.0, 4.0, 314.0, 161.0],
                "proportion": 0.5,
                "rounded": 8,
                "varname": "obj-panel-bg",
            }
        },
    ]

    lines = [
        line("obj-plugin", 0, "obj-plugout", 0),
        line("obj-plugin", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-init", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0, order=1),
        line("obj-thisdevice", 0, "obj-msg-start", 0, order=0),
        line("obj-msg-init", 0, "obj-viz", 0),
        line("obj-msg-start", 0, "obj-node", 0),
        line("obj-viz", 0, "obj-node", 0),
        line("obj-viz", 1, "obj-web-win", 0),
        line("obj-node", 0, "obj-route-node", 0),
        line("obj-route-node", 0, "obj-prep-sync", 0),
        line("obj-route-node", 1, "obj-prep-status", 0),
        line("obj-prep-sync", 0, "obj-viz", 0),
        line("obj-prep-status", 0, "obj-viz", 0),
    ]

    patcher_doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, 920.0, 560.0],
            "openrect": [0.0, 0.0, DEVICE_WIDTH, DEVICE_HEIGHT],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial",
            "gridonopen": 1,
            "gridsize": [15.0, 15.0],
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
            "devicewidth": DEVICE_WIDTH,
            "description": "Suite-Wide Theme Studio & WebUI Server for Max for Live Devices",
            "digest": "Theme Editor & WebUI Preview Studio",
            "tags": "theme studio webui palette ableton",
            "style": "",
            "subpatcher_template": "",
            "assistshowspatchername": 0,
            "boxes": boxes,
            "lines": lines,
            "parameters": {
                "obj-viz": ["ThemeEditorData", "ThemeData", 0],
                "parameterbanks": {},
                "inherited_shortname": 1,
            },
            "dependency_cache": [],
            "autosave": 0,
        }
    }
    tc.inject_theme_support(patcher_doc, "theme_editor")
    return patcher_doc


def write_amxd(patcher_dict, out_path: Path):
    out_path.parent.mkdir(parents=True, exist_ok=True)
    json_bytes = (json.dumps(patcher_dict, indent=2) + "\n").encode("utf-8")
    header = (
        b"ampf"
        + struct.pack("<I", 4)
        + b"aaaa"
        + b"meta"
        + struct.pack("<I", 4)
        + struct.pack("<I", 0)
        + b"ptch"
        + struct.pack("<I", len(json_bytes))
    )
    out_path.write_bytes(header + json_bytes)
    print(f"Built {out_path} ({len(json_bytes)} bytes JSON payload, {int(DEVICE_WIDTH)}x{int(DEVICE_HEIGHT)} px)")


if __name__ == "__main__":
    write_amxd(build_patcher(), OUT_AMXD_PATH)
