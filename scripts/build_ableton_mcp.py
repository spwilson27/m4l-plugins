#!/usr/bin/env python3
"""
Builds `devices/Ableton MCP Bridge.amxd` — Max for Live Debug & Control Bridge for Cursor MCP.

Embeds:
  - `src/ableton_mcp_lom.js` inside `obj-viz` (`v8ui`) for synchronous Ableton `LiveAPI` (LOM)
    and Max `Global` bus inspection/control.
  - `src/ableton_mcp_node.js` inside `obj-node` (`node.codebox`, `@autostart 1`) running a
    local HTTP JSON-RPC bridge on `127.0.0.1:9877`.
"""

import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOM_JS_PATH = ROOT / "src" / "ableton_mcp_lom.js"
NODE_JS_PATH = ROOT / "src" / "ableton_mcp_node.js"
OUT_AMXD_PATH = ROOT / "devices" / "Ableton MCP Bridge.amxd"

DEVICE_WIDTH = 260.0
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
        "destination": [dst_id, int(dst_outlet if False else dst_inlet)],
        "source": [src_id, int(src_outlet)],
    }
    if order is not None:
        pl["order"] = int(order)
    return {"patchline": pl}


def build_patcher():
    lom_js = LOM_JS_PATH.read_text(encoding="utf-8")
    node_js = NODE_JS_PATH.read_text(encoding="utf-8")

    boxes = [
        # Transparent stereo audio pass-through
        newobj("obj-plugin", "plugin~", 40, 40, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 40, 120, 60, 20, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),

        # Startup initialization
        newobj("obj-loadbang", "loadbang", 180, 40, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        newobj("obj-thisdevice", "live.thisdevice", 260, 40, 85, 20, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        msgbox("obj-msg-init", "loadbang", 180, 80, 65, 20),
        msgbox("obj-msg-start", "script start", 260, 80, 75, 20),

        # LOM & Global Inspector Canvas (v8ui)
        {
            "box": {
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [180.0, 140.0, 248.0, 157.0],
                "presentation": 1,
                "presentation_rect": [6.0, 6.0, 248.0, 157.0],
                "textfile": {
                    "autowatch": 1,
                    "embed": 1,
                    "filename": "none",
                    "flags": 0,
                    "text": lom_js,
                },
                "varname": "AbletonMcpLom",
            }
        },

        # Routing from node.codebox -> v8ui
        newobj("obj-route-node", "route lom_rpc bridge_status", 180, 340, 165, 20, numinlets=1, numoutlets=3, outlettype=["", "", ""]),
        newobj("obj-prep-rpc", "prepend lom_rpc", 180, 380, 105, 20),
        newobj("obj-prep-status", "prepend set_bridge_status", 300, 380, 150, 20),

        # Node for Max HTTP JSON-RPC Bridge (background: 1, non-overlapping 1x1 presentation rect)
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
                "patching_rect": [460.0, 140.0, 320.0, 160.0],
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
                "patching_rect": [3.0, 4.0, 254.0, 161.0],
                "presentation": 1,
                "presentation_rect": [3.0, 4.0, 254.0, 161.0],
                "proportion": 0.5,
                "rounded": 8,
            }
        },
    ]

    lines = [
        # Stereo audio pass-through
        line("obj-plugin", 0, "obj-plugout", 0),
        line("obj-plugin", 1, "obj-plugout", 1),

        # Startup
        line("obj-loadbang", 0, "obj-msg-init", 0),
        line("obj-thisdevice", 0, "obj-msg-init", 0),
        line("obj-thisdevice", 0, "obj-msg-start", 0),
        line("obj-msg-init", 0, "obj-viz", 0),
        line("obj-msg-start", 0, "obj-node", 0),

        # v8ui -> node.codebox (lom_reply)
        line("obj-viz", 0, "obj-node", 0),

        # node.codebox -> v8ui (lom_rpc & bridge_status)
        line("obj-node", 0, "obj-route-node", 0),
        line("obj-route-node", 0, "obj-prep-rpc", 0),
        line("obj-prep-rpc", 0, "obj-viz", 0),
        line("obj-route-node", 1, "obj-prep-status", 0),
        line("obj-prep-status", 0, "obj-viz", 0),
    ]

    patcher = {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 0,
                "architecture": "x64",
                "modernui": 1,
            },
            "classnamespace": "box",
            "rect": [100.0, 100.0, 860.0, 520.0],
            "openrect": [0.0, 0.0, DEVICE_WIDTH, DEVICE_HEIGHT],
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
            "devicewidth": DEVICE_WIDTH,
            "description": "Ableton Live M4L Debug & Control Bridge for Cursor MCP",
            "digest": "MCP JSON-RPC Bridge for Ableton LiveAPI (LOM) & Global Bus Inspection",
            "tags": "MCP Debug Bridge Ableton LOM Max for Live",
            "style": "",
            "subpatcher_template": "",
            "assistshowspatchername": 0,
            "boxes": boxes,
            "lines": lines,
            "parameters": {
                "parameterbanks": {
                    "0": {
                        "index": 0,
                        "name": "",
                        "parameters": [],
                    }
                },
                "inherited_shortname": 1,
            },
            "dependency_cache": [],
            "autosave": 0,
        }
    }
    return patcher


def write_amxd(patcher_dict, out_path: Path):
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "scripts"))
    import theme_common as tc
    tc.inject_theme_support(patcher_dict, "ableton_mcp_bridge")
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
