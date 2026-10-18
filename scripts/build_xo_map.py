#!/usr/bin/env python3
"""
Build script for devices/XO Sample Map.amxd
Generates a self-contained Max for Live Audio Effect device (.amxd) combining:
  - src/xo_node_engine.js + src/xo_map_ui.html (embedded in a Max 9 node.codebox object)
  - src/xo_strip_ui.js (embedded in a Max 9 v8ui object for in-device mini-map, waveform scanner & saved list)
  - Visibly separate FILTERS panel (Search textbox, MaxLen 50ms..Infinite, Tone, Sim stepping)
    vs. PLAYBACK panel (Audition, Pitch, Trim/Decay, Gain)
  - Scrollable, selectable, drag-reorderable & deletable Saved Samples List with Raw vs. Edited OS file drag-out
  - Pop-out floating window subpatcher (p XOMapWindow) hosting a full-screen jweb canvas
  - Stereo sfplay~ 2 audition engine with automatic Mono-to-Stereo routing (selector~ 2 1)
    and live waveform playhead scanning line (line 0. 20)
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_node_engine.js")
HTML_UI_PATH = os.path.join(ROOT_DIR, "src", "xo_map_ui.html")
STRIP_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_strip_ui.js")
FOLDER_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_folder_ui.js")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "XO Sample Map.amxd")


def make_map_window_subpatcher():
    """
    Creates the pop-out floating window subpatcher 'p XOMapWindow' containing
    the high-DPI jweb HTML5 Canvas XO Sample Space UI.
    """
    return {
        "fileversion": 1,
        "appversion": {
            "major": 9,
            "minor": 1,
            "revision": 5,
            "architecture": "x64",
            "modernui": 1
        },
        "classnamespace": "box",
        "rect": [120.0, 90.0, 1040.0, 680.0],
        "openrect": [120.0, 90.0, 1040.0, 680.0],
        "bglocked": 0,
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontface": 0,
        "default_fontname": "Arial Bold",
        "gridonopen": 1,
        "gridsize": [15.0, 15.0],
        "gridsnaponopen": 1,
        "objectsnaponopen": 1,
        "statusbarvisible": 0,
        "toolbarvisible": 0,
        "lefttoolbarpinned": 0,
        "toptoolbarpinned": 0,
        "righttoolbarpinned": 0,
        "bottomtoolbarpinned": 0,
        "toolbars_unpinned_last_save": 0,
        "tallnewobj": 0,
        "boxanimatetime": 200,
        "enablehscroll": 0,
        "enablevscroll": 0,
        "devicewidth": 0.0,
        "description": "XO Sample Space Floating Map Window",
        "digest": "",
        "tags": "",
        "style": "",
        "subpatcher_template": "",
        "title": "XO Sample Space",
        "boxes": [
            {
                "box": {
                    "comment": "pcontrol inlet",
                    "id": "obj-win-in",
                    "index": 1,
                    "maxclass": "inlet",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [20.0, 20.0, 25.0, 25.0]
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-thispatcher",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 2,
                    "outlettype": ["", ""],
                    "patching_rect": [20.0, 60.0, 68.0, 20.0],
                    "save": ["#N", "thispatcher", ";", "#Q", "end", ";"],
                    "text": "thispatcher"
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-r-jweb",
                    "maxclass": "newobj",
                    "numinlets": 0,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [120.0, 20.0, 88.0, 20.0],
                    "text": "r #0-to-jweb"
                }
            },
            {
                "box": {
                    "disablefind": 1,
                    "id": "obj-jweb",
                    "maxclass": "jweb",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [120.0, 60.0, 820.0, 540.0],
                    "presentation": 1,
                    "presentation_rect": [0.0, 0.0, 1040.0, 680.0],
                    "rendermode": 1,
                    "url": ""
                }
            },
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": "obj-s-jweb",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [120.0, 615.0, 98.0, 20.0],
                    "text": "s #0-from-jweb"
                }
            }
        ],
        "lines": [
            {"patchline": {"source": ["obj-win-in", 0], "destination": ["obj-thispatcher", 0]}},
            {"patchline": {"source": ["obj-r-jweb", 0], "destination": ["obj-jweb", 0]}},
            {"patchline": {"source": ["obj-jweb", 0], "destination": ["obj-s-jweb", 0]}}
        ],
        "bgcolor": [0.055, 0.067, 0.086, 1.0],
        "editing_bgcolor": [0.055, 0.067, 0.086, 1.0]
    }


def build():
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)

    with open(HTML_UI_PATH, "r", encoding="utf-8") as f:
        html_ui_str = f.read()

    with open(NODE_JS_PATH, "r", encoding="utf-8") as f:
        node_js_raw = f.read()

    with open(STRIP_JS_PATH, "r", encoding="utf-8") as f:
        strip_js_code = f.read()

    with open(FOLDER_JS_PATH, "r", encoding="utf-8") as f:
        folder_js_code = f.read()

    embedded_node_code = (
        f"const EMBEDDED_XO_HTML = {json.dumps(html_ui_str)};\n\n" + node_js_raw
    )

    boxes = [
        # --- 0. Embedded Node for Max Engine (placed first in z-order behind panel-left so it boots in Presentation Mode) ---
        {
            "box": {
                "code": embedded_node_code,
                "fontface": 0,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-node",
                "ignoreclick": 1,
                "maxclass": "node.codebox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [420.0, 240.0, 360.0, 180.0],
                "presentation": 1,
                "presentation_rect": [0.0, 220.0, 10.0, 10.0],
                "saved_object_attributes": {
                    "autostart": 1,
                    "defer": 1,
                    "watch": 0
                }
            }
        },

        # --- 1. Audio Pass-Through + Mono-Safe Stereo Preview Mixer + Playhead Scanner ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugin",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [30.0, 30.0, 52.0, 20.0],
                "text": "plugin~"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sfplay",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 3,
                "outlettype": ["signal", "signal", "bang"],
                "patching_rect": [120.0, 30.0, 68.0, 20.0],
                "text": "sfplay~ 2"
            }
        },
        # Mono-to-Stereo Right Channel Selector (1 = Mono duplicated from Left, 2 = True Stereo Right)
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-r-chan-sel",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [165.0, 60.0, 82.0, 20.0],
                "text": "selector~ 2 1"
            }
        },
        # Ordered Play Trigger: 1st open <file>, 2nd apply <speed>, 3rd start playback '1'
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-trig-play",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["bang", "bang", ""],
                "patching_rect": [255.0, 30.0, 56.0, 20.0],
                "text": "t b b s"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-open",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [320.0, 30.0, 76.0, 20.0],
                "text": "prepend open"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-speed-reg",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [255.0, 60.0, 42.0, 20.0],
                "text": "f 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-play1",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [210.0, 30.0, 29.5, 20.0],
                "text": "1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-env-line",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "bang"],
                "patching_rect": [255.0, 90.0, 52.0, 20.0],
                "text": "line~ 1."
            }
        },
        # Live Waveform Playhead Scanner (0. -> 1. over effective duration)
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-scan-msg",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [355.0, 88.0, 62.0, 20.0],
                "text": "0., 1. $1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-scan-line",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 2,
                "outlettype": ["", "bang"],
                "patching_rect": [355.0, 115.0, 62.0, 20.0],
                "text": "line 0. 20"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-playhead",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [355.0, 142.0, 115.0, 20.0],
                "text": "prepend set_playhead"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-env-mul-l",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [120.0, 90.0, 38.0, 20.0],
                "text": "*~ 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-env-mul-r",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [165.0, 90.0, 38.0, 20.0],
                "text": "*~ 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-dbtoa",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [310.0, 60.0, 44.0, 20.0],
                "text": "dbtoa"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-gain-mul-l",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [120.0, 120.0, 38.0, 20.0],
                "text": "*~ 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-gain-mul-r",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [165.0, 120.0, 38.0, 20.0],
                "text": "*~ 1."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-mix-l",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [30.0, 150.0, 38.0, 20.0],
                "text": "+~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-mix-r",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["signal"],
                "patching_rect": [75.0, 150.0, 38.0, 20.0],
                "text": "+~ 0."
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugout",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [30.0, 180.0, 58.0, 20.0],
                "text": "plugout~"
            }
        },

        # --- 2. Node for Max Outlet Router ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-route-node",
                "maxclass": "newobj",
                "numinlets": 19,
                "numoutlets": 19,
                "outlettype": [""] * 19,
                "patching_rect": [420.0, 435.0, 660.0, 20.0],
                "text": (
                    "route server_url minimap_clear minimap_batch minimap_done "
                    "selected_info play_file play_speed play_env play_scan_dur "
                    "play_mono play_gain saved_list_sync sync_playback_dials "
                    "prompt_folder strip_filter_cat strip_filter_maxlen strip_filter_tone "
                    "folder_list_sync"
                )
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-folder-sync",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [300.0, 398.0, 138.0, 20.0],
                "text": "prepend folder_list_sync"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-url",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [420.0, 468.0, 68.0, 20.0],
                "text": "prepend url"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-s-to-jweb",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [420.0, 495.0, 88.0, 20.0],
                "text": "s #0-to-jweb"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-r-from-jweb",
                "maxclass": "newobj",
                "numinlets": 0,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [520.0, 495.0, 98.0, 20.0],
                "text": "r #0-from-jweb"
            }
        },

        # --- 3. In-Device Mini Editor: 2D Map, Waveform Scanner & Saved List (v8ui) ---
        {
            "box": {
                "border": 0,
                "filename": "none",
                "id": "obj-minimap",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [30.0, 220.0, 372.0, 134.0],
                "presentation": 1,
                "presentation_rect": [10.0, 27.0, 372.0, 134.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_invisible": 1,
                        "parameter_longname": "XOStateData",
                        "parameter_shortname": "XOStateData",
                        "parameter_type": 3
                    }
                },
                "textfile": {
                    "text": strip_js_code,
                    "filename": "none",
                    "flags": 0,
                    "embed": 1,
                    "autowatch": 1
                },
                "varname": "XOStateData"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-mm-clear",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 370.0, 120.0, 20.0],
                "text": "prepend minimap_clear"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-mm-batch",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [160.0, 370.0, 122.0, 20.0],
                "text": "prepend minimap_batch"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-mm-done",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [290.0, 370.0, 120.0, 20.0],
                "text": "prepend minimap_done"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-sel-info",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 398.0, 118.0, 20.0],
                "text": "prepend selected_info"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-saved-sync",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [160.0, 398.0, 132.0, 20.0],
                "text": "prepend saved_list_sync"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-sf-cat",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 424.0, 125.0, 20.0],
                "text": "prepend strip_filter_cat"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-sf-maxlen",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [160.0, 424.0, 140.0, 20.0],
                "text": "prepend strip_filter_maxlen"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-sf-tone",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [305.0, 424.0, 130.0, 20.0],
                "text": "prepend strip_filter_tone"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-sf-search",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 450.0, 142.0, 20.0],
                "text": "prepend strip_filter_search"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-unpack-recalled",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["float", "float", "float"],
                "patching_rect": [750.0, 468.0, 102.0, 20.0],
                "text": "unpack 0. 2500. 0."
            }
        },

        # --- 4. Hotkey 'S' & Delete Handler + Pop-Out Window Subpatcher + Folder Picker ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-key",
                "maxclass": "newobj",
                "numinlets": 0,
                "numoutlets": 4,
                "outlettype": ["int", "int", "int", "int"],
                "patching_rect": [640.0, 495.0, 46.0, 20.0],
                "text": "key"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sel-key",
                "maxclass": "newobj",
                "numinlets": 7,
                "numoutlets": 7,
                "outlettype": ["bang", "bang", "bang", "bang", "bang", "bang", ""],
                "patching_rect": [640.0, 522.0, 145.0, 20.0],
                "text": "sel 115 83 127 8 -5 -3"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-hotkey-save",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [640.0, 550.0, 75.0, 20.0],
                "text": "hotkey_save"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-del-saved",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [735.0, 550.0, 125.0, 20.0],
                "text": "delete_selected_saved"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-sel-map-win",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 3,
                "outlettype": ["bang", "bang", ""],
                "patching_rect": [30.0, 480.0, 54.0, 20.0],
                "text": "sel 1 0"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-open-win",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 508.0, 38.0, 20.0],
                "text": "open"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-close-win",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [75.0, 508.0, 40.0, 20.0],
                "text": "close"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-pcontrol",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 536.0, 56.0, 20.0],
                "text": "pcontrol"
            }
        },
        {
            "box": {
                "color": [0.22, 0.74, 0.97, 1.0],
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-map-window",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 564.0, 98.0, 20.0],
                "patcher": make_map_window_subpatcher(),
                "saved_object_attributes": {
                    "description": "XO Sample Space Floating Map Window",
                    "digest": "",
                    "editing_bgcolor": [0.055, 0.067, 0.086, 1.0],
                    "globalpatchername": "",
                    "locked_bgcolor": [0.055, 0.067, 0.086, 1.0],
                    "tags": ""
                },
                "text": "p XOMapWindow"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-opendialog",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "bang"],
                "patching_rect": [160.0, 508.0, 88.0, 20.0],
                "text": "opendialog fold"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-add-folder",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [160.0, 536.0, 105.0, 20.0],
                "text": "prepend add_folder"
            }
        },

        # --- 5. Left Panel Header Widgets (Above Mini Editor v8ui: Title + Open Map + Saved / Filters / Playback Toggles) ---
        {
            "box": {
                "fontface": 1,
                "fontsize": 10.0,
                "id": "obj-title-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [420.0, 30.0, 92.0, 18.0],
                "presentation": 1,
                "presentation_rect": [10.0, 8.0, 92.0, 18.0],
                "text": "XO Sample Map",
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [0.22, 0.74, 0.97, 1.0],
                "activetextcolor": [0.85, 0.89, 0.94, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Opens or closes the large resizable XO Sample Space floating map window.",
                "annotation_name": "Open Map Window",
                "bordercolor": [0.22, 0.74, 0.97, 1.0],
                "id": "obj-open-map-btn",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [520.0, 30.0, 62.0, 15.0],
                "presentation": 1,
                "presentation_rect": [104.0, 9.0, 62.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Open Map Window",
                        "parameter_enum": ["Closed", "Open"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_longname": "OpenMapWindow",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Open Map",
                        "parameter_type": 2
                    }
                },
                "text": "Open Map",
                "texton": "Map Open",
                "varname": "OpenMapWindow"
            }
        },
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [0.29, 0.87, 0.50, 1.0],
                "activetextcolor": [0.75, 0.80, 0.86, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Shows or collapses the Saved Samples List pane inside the mini editor.",
                "annotation_name": "Show Saved List",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "id": "obj-toggle-saved-btn",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [590.0, 30.0, 48.0, 15.0],
                "presentation": 1,
                "presentation_rect": [172.0, 9.0, 48.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Show Saved List",
                        "parameter_enum": ["Hidden", "Shown"],
                        "parameter_initial": [1],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_longname": "ShowSavedList",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Saved",
                        "parameter_type": 2
                    }
                },
                "text": "Saved",
                "texton": "Saved",
                "varname": "ShowSavedList"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-show-saved",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [590.0, 52.0, 126.0, 20.0],
                "text": "prepend set_show_saved"
            }
        },
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [0.22, 0.74, 0.97, 1.0],
                "activetextcolor": [0.75, 0.80, 0.86, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Shows or collapses the Filters section.",
                "annotation_name": "Show Filters Section",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "id": "obj-toggle-filters-btn",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [645.0, 30.0, 48.0, 15.0],
                "presentation": 1,
                "presentation_rect": [224.0, 9.0, 48.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Show Filters Section",
                        "parameter_enum": ["Hidden", "Shown"],
                        "parameter_initial": [1],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_longname": "ShowFiltersSection",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Filters",
                        "parameter_type": 2
                    }
                },
                "text": "Filters",
                "texton": "Filters",
                "varname": "ShowFiltersSection"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-inv-filters",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [720.0, 52.0, 35.0, 20.0],
                "text": "== 0"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-hide-filters",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [760.0, 52.0, 88.0, 20.0],
                "text": "prepend hidden"
            }
        },
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [1.0, 0.694, 0.18, 1.0],
                "activetextcolor": [0.75, 0.80, 0.86, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Shows or collapses the Playback section.",
                "annotation_name": "Show Playback Section",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "id": "obj-toggle-playback-btn",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [700.0, 30.0, 56.0, 15.0],
                "presentation": 1,
                "presentation_rect": [276.0, 9.0, 56.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Show Playback Section",
                        "parameter_enum": ["Hidden", "Shown"],
                        "parameter_initial": [1],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_longname": "ShowPlaybackSection",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Playback",
                        "parameter_type": 2
                    }
                },
                "text": "Playback",
                "texton": "Playback",
                "varname": "ShowPlaybackSection"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-inv-playback",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [855.0, 52.0, 35.0, 20.0],
                "text": "== 0"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-hide-playback",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [895.0, 52.0, 88.0, 20.0],
                "text": "prepend hidden"
            }
        },

        # --- 6. Center Panel: FILTERS (Search, MaxLen, Tone & Remembered Folder Filter List) ---
        {
            "box": {
                "fontface": 1,
                "fontsize": 9.5,
                "id": "obj-hdr-filters",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [420.0, 90.0, 92.0, 15.0],
                "presentation": 1,
                "presentation_rect": [398.0, 6.0, 92.0, 15.0],
                "text": "FILTERS",
                "textcolor": [0.22, 0.74, 0.97, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [0.22, 0.74, 0.97, 1.0],
                "activetextcolor": [0.75, 0.80, 0.86, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Clears the sample name search box.",
                "annotation_name": "Clear Search",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "id": "obj-search-clear-btn",
                "maxclass": "live.text",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [475.0, 110.0, 28.0, 14.0],
                "presentation": 1,
                "presentation_rect": [496.0, 6.0, 28.0, 14.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Clear Search",
                        "parameter_enum": ["val1", "val2"],
                        "parameter_invisible": 2,
                        "parameter_longname": "ClearSearch",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Clr",
                        "parameter_type": 2
                    }
                },
                "text": "Clr",
                "texton": "Clr",
                "varname": "ClearSearch"
            }
        },
        {
            "box": {
                "annotation": "Type to filter samples by name.",
                "annotation_name": "Filter by name...",
                "autoscroll": 0,
                "bgcolor": [0.07, 0.085, 0.11, 1.0],
                "border": 1.0,
                "bordercolor": [0.22, 0.74, 0.97, 0.65],
                "fontname": "Arial",
                "fontsize": 9.0,
                "id": "obj-search-box",
                "keymode": 1,
                "lines": 1,
                "maxclass": "textedit",
                "numinlets": 1,
                "numoutlets": 4,
                "outlettype": ["", "int", "", ""],
                "parameter_enable": 0,
                "patching_rect": [510.0, 110.0, 126.0, 17.0],
                "presentation": 1,
                "presentation_rect": [398.0, 22.0, 126.0, 17.0],
                "tabmode": 0,
                "textcolor": [0.92, 0.95, 0.98, 1.0],
                "wordwrap": 0
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-route-text",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [510.0, 134.0, 62.0, 20.0],
                "text": "route text"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-search",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [580.0, 134.0, 102.0, 20.0],
                "text": "prepend set_search"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-clear-search",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [690.0, 110.0, 38.0, 20.0],
                "text": "clear"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-empty-search",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [690.0, 134.0, 74.0, 20.0],
                "text": "set_search"
            }
        },
        {
            "box": {
                "activedialcolor": [0.22, 0.74, 0.97, 1.0],
                "annotation": "Filters the map to samples shorter than MaxLen (50 ms up to Infinite at max).",
                "annotation_name": "Max Length (50ms - Inf)",
                "id": "obj-maxlen-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [420.0, 165.0, 52.0, 46.0],
                "presentation": 1,
                "presentation_rect": [402.0, 41.0, 52.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Max Length (50ms - Inf)",
                        "parameter_exponent": 2.0,
                        "parameter_initial": [5000.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "MaxLength",
                        "parameter_mmax": 5000.0,
                        "parameter_mmin": 50.0,
                        "parameter_shortname": "MaxLen",
                        "parameter_type": 0,
                        "parameter_unitstyle": 2
                    }
                },
                "varname": "MaxLength"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-maxlen",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [420.0, 215.0, 96.0, 20.0],
                "text": "prepend set_maxlen"
            }
        },
        {
            "box": {
                "activedialcolor": [0.22, 0.74, 0.97, 1.0],
                "annotation": "Filters samples by spectral brightness (-100% Dark to +100% Bright).",
                "annotation_name": "Tone Filter",
                "id": "obj-tone-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [485.0, 165.0, 52.0, 46.0],
                "presentation": 1,
                "presentation_rect": [468.0, 41.0, 52.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Tone Filter",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "ToneFilter",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": -100.0,
                        "parameter_shortname": "Tone",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "varname": "ToneFilter"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-tone",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [485.0, 215.0, 86.0, 20.0],
                "text": "prepend set_tone"
            }
        },
        {
            "box": {
                "border": 0,
                "filename": "none",
                "id": "obj-folder-list",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "parameter_enable": 0,
                "patching_rect": [750.0, 90.0, 126.0, 69.0],
                "presentation": 1,
                "presentation_rect": [398.0, 90.0, 126.0, 69.0],
                "textfile": {
                    "text": folder_js_code,
                    "filename": "none",
                    "flags": 0,
                    "embed": 1,
                    "autowatch": 1
                }
            }
        },

        # --- 7. Right Panel: PLAYBACK CONTROLS (Pitch, Trim/Decay, Gain) ---
        {
            "box": {
                "fontface": 1,
                "fontsize": 9.5,
                "id": "obj-hdr-playback",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [780.0, 30.0, 126.0, 16.0],
                "presentation": 1,
                "presentation_rect": [542.0, 7.0, 126.0, 16.0],
                "text": "PLAYBACK",
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activedialcolor": [1.0, 0.694, 0.18, 1.0],
                "annotation": "Transposes sample playback in semitones (-24 st to +24 st). Saved with sample.",
                "annotation_name": "Pitch Transpose",
                "id": "obj-pitch-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [550.0, 165.0, 52.0, 48.0],
                "presentation": 1,
                "presentation_rect": [548.0, 32.0, 52.0, 48.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Pitch Transpose",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "PitchTranspose",
                        "parameter_mmax": 24.0,
                        "parameter_mmin": -24.0,
                        "parameter_shortname": "Pitch",
                        "parameter_type": 0,
                        "parameter_unitstyle": 7
                    }
                },
                "varname": "PitchTranspose"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-pitch",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [550.0, 215.0, 88.0, 20.0],
                "text": "prepend set_pitch"
            }
        },
        {
            "box": {
                "activedialcolor": [1.0, 0.694, 0.18, 1.0],
                "annotation": "Sets the trim & amplitude decay time for sample playback and edited exports.",
                "annotation_name": "Trim / Decay",
                "id": "obj-decay-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [615.0, 165.0, 52.0, 48.0],
                "presentation": 1,
                "presentation_rect": [610.0, 32.0, 52.0, 48.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Trim / Decay",
                        "parameter_exponent": 2.0,
                        "parameter_initial": [2500.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "DecayEnvelope",
                        "parameter_mmax": 5000.0,
                        "parameter_mmin": 20.0,
                        "parameter_shortname": "Trim/Dec",
                        "parameter_type": 0,
                        "parameter_unitstyle": 2
                    }
                },
                "varname": "DecayEnvelope"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-decay",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [615.0, 215.0, 92.0, 20.0],
                "text": "prepend set_decay"
            }
        },
        {
            "box": {
                "activedialcolor": [0.29, 0.87, 0.50, 1.0],
                "annotation": "Adjusts the playback & edited export volume in dB.",
                "annotation_name": "Preview Gain",
                "id": "obj-gain-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [680.0, 165.0, 52.0, 48.0],
                "presentation": 1,
                "presentation_rect": [579.0, 96.0, 52.0, 48.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Preview Gain",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "PreviewGain",
                        "parameter_mmax": 12.0,
                        "parameter_mmin": -36.0,
                        "parameter_shortname": "Gain",
                        "parameter_type": 0,
                        "parameter_unitstyle": 4
                    }
                },
                "varname": "PreviewGain"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-gain",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [680.0, 215.0, 86.0, 20.0],
                "text": "prepend set_gain"
            }
        },

        # --- 8. Device Initialization (live.thisdevice) & 3 Visibly Separate Panels ---
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-thisdevice",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["bang", "int", "int"],
                "patching_rect": [30.0, 595.0, 78.0, 20.0],
                "text": "live.thisdevice"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-init",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 625.0, 32.0, 20.0],
                "text": "init"
            }
        },
        {
            "box": {
                "angle": 270.0,
                "bgcolor": [0.125, 0.145, 0.17, 1.0],
                "border": 1,
                "bordercolor": [0.06, 0.07, 0.08, 1.0],
                "id": "obj-panel-left",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 660.0, 100.0, 40.0],
                "presentation": 1,
                "presentation_rect": [6.0, 5.0, 380.0, 159.0],
                "proportion": 0.39,
                "rounded": 6
            }
        },
        {
            "box": {
                "angle": 270.0,
                "bgcolor": [0.115, 0.140, 0.172, 1.0],
                "border": 1,
                "bordercolor": [0.18, 0.52, 0.72, 0.55],
                "id": "obj-panel-filters",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [140.0, 660.0, 100.0, 40.0],
                "presentation": 1,
                "presentation_rect": [392.0, 5.0, 138.0, 159.0],
                "proportion": 0.39,
                "rounded": 6
            }
        },
        {
            "box": {
                "angle": 270.0,
                "bgcolor": [0.135, 0.142, 0.160, 1.0],
                "border": 1,
                "bordercolor": [0.75, 0.52, 0.15, 0.55],
                "id": "obj-panel-playback",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [250.0, 660.0, 100.0, 40.0],
                "presentation": 1,
                "presentation_rect": [536.0, 5.0, 138.0, 159.0],
                "proportion": 0.39,
                "rounded": 6
            }
        }
    ]

    lines = [
        # 1. Audio Pass-Through + Mono-Safe Stereo sfplay~ 2 Preview Mixer + Waveform Playhead Line
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-mix-l", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-mix-r", 0]}},
        # Ordered play trigger: 1st open <file>, 2nd <speed>, 3rd start '1'
        {"patchline": {"source": ["obj-trig-play", 2], "destination": ["obj-prep-open", 0]}},
        {"patchline": {"source": ["obj-prep-open", 0], "destination": ["obj-sfplay", 0]}},
        {"patchline": {"source": ["obj-trig-play", 1], "destination": ["obj-speed-reg", 0]}},
        {"patchline": {"source": ["obj-speed-reg", 0], "destination": ["obj-sfplay", 1]}},
        {"patchline": {"source": ["obj-trig-play", 0], "destination": ["obj-msg-play1", 0]}},
        {"patchline": {"source": ["obj-msg-play1", 0], "destination": ["obj-sfplay", 0]}},
        # Mono-to-Stereo routing: sfplay~ outlet 0 goes to Left AND selector~ inlet 1 (mono duplicate);
        # sfplay~ outlet 1 goes to selector~ inlet 2 (stereo R)
        {"patchline": {"source": ["obj-sfplay", 0], "destination": ["obj-env-mul-l", 0], "order": 1}},
        {"patchline": {"source": ["obj-sfplay", 0], "destination": ["obj-r-chan-sel", 1], "order": 0}},
        {"patchline": {"source": ["obj-sfplay", 1], "destination": ["obj-r-chan-sel", 2]}},
        {"patchline": {"source": ["obj-r-chan-sel", 0], "destination": ["obj-env-mul-r", 0]}},
        {"patchline": {"source": ["obj-env-line", 0], "destination": ["obj-env-mul-l", 1], "order": 1}},
        {"patchline": {"source": ["obj-env-line", 0], "destination": ["obj-env-mul-r", 1], "order": 0}},
        {"patchline": {"source": ["obj-env-mul-l", 0], "destination": ["obj-gain-mul-l", 0]}},
        {"patchline": {"source": ["obj-env-mul-r", 0], "destination": ["obj-gain-mul-r", 0]}},
        {"patchline": {"source": ["obj-gain-dial", 0], "destination": ["obj-dbtoa", 0], "order": 2}},
        {"patchline": {"source": ["obj-gain-dial", 0], "destination": ["obj-prep-gain", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-gain", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-gain", 0], "destination": ["obj-minimap", 0], "order": 0}},
        {"patchline": {"source": ["obj-dbtoa", 0], "destination": ["obj-gain-mul-l", 1], "order": 1}},
        {"patchline": {"source": ["obj-dbtoa", 0], "destination": ["obj-gain-mul-r", 1], "order": 0}},
        {"patchline": {"source": ["obj-gain-mul-l", 0], "destination": ["obj-mix-l", 1]}},
        {"patchline": {"source": ["obj-gain-mul-r", 0], "destination": ["obj-mix-r", 1]}},
        {"patchline": {"source": ["obj-mix-l", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-mix-r", 0], "destination": ["obj-plugout", 1]}},
        # Waveform Playhead Scan Line
        {"patchline": {"source": ["obj-scan-msg", 0], "destination": ["obj-scan-line", 0]}},
        {"patchline": {"source": ["obj-scan-line", 0], "destination": ["obj-prep-playhead", 0]}},
        {"patchline": {"source": ["obj-prep-playhead", 0], "destination": ["obj-minimap", 0]}},

        # 2. node.codebox Outlet Routing
        {"patchline": {"source": ["obj-node", 0], "destination": ["obj-route-node", 0]}},
        {"patchline": {"source": ["obj-route-node", 0], "destination": ["obj-prep-url", 0]}},
        {"patchline": {"source": ["obj-prep-url", 0], "destination": ["obj-s-to-jweb", 0]}},
        {"patchline": {"source": ["obj-route-node", 1], "destination": ["obj-prep-mm-clear", 0]}},
        {"patchline": {"source": ["obj-prep-mm-clear", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 2], "destination": ["obj-prep-mm-batch", 0]}},
        {"patchline": {"source": ["obj-prep-mm-batch", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 3], "destination": ["obj-prep-mm-done", 0]}},
        {"patchline": {"source": ["obj-prep-mm-done", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 4], "destination": ["obj-prep-sel-info", 0]}},
        {"patchline": {"source": ["obj-prep-sel-info", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 5], "destination": ["obj-trig-play", 0]}},
        {"patchline": {"source": ["obj-route-node", 6], "destination": ["obj-speed-reg", 1], "order": 1}},
        {"patchline": {"source": ["obj-route-node", 6], "destination": ["obj-sfplay", 1], "order": 0}},
        {"patchline": {"source": ["obj-route-node", 7], "destination": ["obj-env-line", 0]}},
        {"patchline": {"source": ["obj-route-node", 8], "destination": ["obj-scan-msg", 0]}},
        {"patchline": {"source": ["obj-route-node", 9], "destination": ["obj-r-chan-sel", 0]}},
        {"patchline": {"source": ["obj-route-node", 10], "destination": ["obj-dbtoa", 0]}},
        {"patchline": {"source": ["obj-route-node", 11], "destination": ["obj-prep-saved-sync", 0]}},
        {"patchline": {"source": ["obj-prep-saved-sync", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 12], "destination": ["obj-unpack-recalled", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 0], "destination": ["obj-pitch-dial", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 1], "destination": ["obj-decay-dial", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 2], "destination": ["obj-gain-dial", 0]}},
        {"patchline": {"source": ["obj-route-node", 13], "destination": ["obj-opendialog", 0]}},
        {"patchline": {"source": ["obj-route-node", 14], "destination": ["obj-prep-sf-cat", 0]}},
        {"patchline": {"source": ["obj-prep-sf-cat", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 15], "destination": ["obj-prep-sf-maxlen", 0]}},
        {"patchline": {"source": ["obj-prep-sf-maxlen", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 16], "destination": ["obj-prep-sf-tone", 0]}},
        {"patchline": {"source": ["obj-prep-sf-tone", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 17], "destination": ["obj-prep-folder-sync", 0]}},
        {"patchline": {"source": ["obj-prep-folder-sync", 0], "destination": ["obj-folder-list", 0]}},

        # 3. v8ui & Hotkeys ('S' -> hotkey_save, Delete/Backspace -> delete_selected_saved) -> node.codebox / v8ui
        {"patchline": {"source": ["obj-minimap", 0], "destination": ["obj-node", 0]}},
        {"patchline": {"source": ["obj-folder-list", 0], "destination": ["obj-node", 0]}},
        {"patchline": {"source": ["obj-key", 0], "destination": ["obj-sel-key", 0]}},
        {"patchline": {"source": ["obj-sel-key", 0], "destination": ["obj-msg-hotkey-save", 0]}},
        {"patchline": {"source": ["obj-sel-key", 1], "destination": ["obj-msg-hotkey-save", 0]}},
        {"patchline": {"source": ["obj-sel-key", 2], "destination": ["obj-msg-del-saved", 0]}},
        {"patchline": {"source": ["obj-sel-key", 3], "destination": ["obj-msg-del-saved", 0]}},
        {"patchline": {"source": ["obj-sel-key", 4], "destination": ["obj-msg-del-saved", 0]}},
        {"patchline": {"source": ["obj-sel-key", 5], "destination": ["obj-msg-del-saved", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-save", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-del-saved", 0], "destination": ["obj-minimap", 0]}},

        # 4. Pop-out Map Window, Section Collapse/Show Toggles & Folder Dialog Controls
        {"patchline": {"source": ["obj-open-map-btn", 0], "destination": ["obj-sel-map-win", 0]}},
        {"patchline": {"source": ["obj-sel-map-win", 0], "destination": ["obj-msg-open-win", 0], "order": 1}},
        {"patchline": {"source": ["obj-sel-map-win", 0], "destination": ["obj-msg-init", 0], "order": 0}},
        {"patchline": {"source": ["obj-sel-map-win", 1], "destination": ["obj-msg-close-win", 0]}},
        {"patchline": {"source": ["obj-msg-open-win", 0], "destination": ["obj-pcontrol", 0]}},
        {"patchline": {"source": ["obj-msg-close-win", 0], "destination": ["obj-pcontrol", 0]}},
        {"patchline": {"source": ["obj-pcontrol", 0], "destination": ["obj-map-window", 0]}},
        {"patchline": {"source": ["obj-opendialog", 0], "destination": ["obj-prep-add-folder", 0]}},
        {"patchline": {"source": ["obj-prep-add-folder", 0], "destination": ["obj-node", 0]}},
        # Saved List Collapse/Show Toggle
        {"patchline": {"source": ["obj-toggle-saved-btn", 0], "destination": ["obj-prep-show-saved", 0]}},
        {"patchline": {"source": ["obj-prep-show-saved", 0], "destination": ["obj-minimap", 0]}},
        # Filters Section Collapse/Show Toggle
        {"patchline": {"source": ["obj-toggle-filters-btn", 0], "destination": ["obj-inv-filters", 0]}},
        {"patchline": {"source": ["obj-inv-filters", 0], "destination": ["obj-prep-hide-filters", 0]}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-panel-filters", 0], "order": 6}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-hdr-filters", 0], "order": 5}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-search-clear-btn", 0], "order": 4}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-search-box", 0], "order": 3}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-maxlen-dial", 0], "order": 2}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-tone-dial", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-folder-list", 0], "order": 0}},
        # Playback Section Collapse/Show Toggle
        {"patchline": {"source": ["obj-toggle-playback-btn", 0], "destination": ["obj-inv-playback", 0]}},
        {"patchline": {"source": ["obj-inv-playback", 0], "destination": ["obj-prep-hide-playback", 0]}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-panel-playback", 0], "order": 4}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-hdr-playback", 0], "order": 3}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-pitch-dial", 0], "order": 2}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-decay-dial", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-gain-dial", 0], "order": 0}},

        # 5. FILTERS Panel Controls -> DIRECTLY to both node.codebox and v8ui
        {"patchline": {"source": ["obj-search-box", 0], "destination": ["obj-route-text", 0]}},
        {"patchline": {"source": ["obj-route-text", 0], "destination": ["obj-prep-search", 0], "order": 1}},
        {"patchline": {"source": ["obj-route-text", 0], "destination": ["obj-prep-sf-search", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-search", 0], "destination": ["obj-node", 0]}},
        {"patchline": {"source": ["obj-prep-sf-search", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-search-clear-btn", 0], "destination": ["obj-msg-clear-search", 0], "order": 1}},
        {"patchline": {"source": ["obj-search-clear-btn", 0], "destination": ["obj-msg-empty-search", 0], "order": 0}},
        {"patchline": {"source": ["obj-msg-clear-search", 0], "destination": ["obj-search-box", 0]}},
        {"patchline": {"source": ["obj-msg-empty-search", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-msg-empty-search", 0], "destination": ["obj-prep-sf-search", 0], "order": 0}},
        {"patchline": {"source": ["obj-maxlen-dial", 0], "destination": ["obj-prep-maxlen", 0], "order": 1}},
        {"patchline": {"source": ["obj-maxlen-dial", 0], "destination": ["obj-prep-sf-maxlen", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-maxlen", 0], "destination": ["obj-node", 0]}},
        {"patchline": {"source": ["obj-tone-dial", 0], "destination": ["obj-prep-tone", 0], "order": 1}},
        {"patchline": {"source": ["obj-tone-dial", 0], "destination": ["obj-prep-sf-tone", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-tone", 0], "destination": ["obj-node", 0]}},

        # 6. PLAYBACK Panel Controls -> node.codebox & v8ui
        {"patchline": {"source": ["obj-pitch-dial", 0], "destination": ["obj-prep-pitch", 0]}},
        {"patchline": {"source": ["obj-prep-pitch", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-pitch", 0], "destination": ["obj-minimap", 0], "order": 0}},
        {"patchline": {"source": ["obj-decay-dial", 0], "destination": ["obj-prep-decay", 0]}},
        {"patchline": {"source": ["obj-prep-decay", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-decay", 0], "destination": ["obj-minimap", 0], "order": 0}},

        # 7. Device Startup
        {"patchline": {"source": ["obj-thisdevice", 0], "destination": ["obj-msg-init", 0]}},
        {"patchline": {"source": ["obj-msg-init", 0], "destination": ["obj-node", 0]}}
    ]

    parameters_dict = {
        "obj-minimap": ["XOStateData", "XOStateData", 0],
        "obj-open-map-btn": ["OpenMapWindow", "Open Map", 0],
        "obj-toggle-saved-btn": ["ShowSavedList", "Saved", 0],
        "obj-toggle-filters-btn": ["ShowFiltersSection", "Filters", 0],
        "obj-toggle-playback-btn": ["ShowPlaybackSection", "Playback", 0],
        "obj-search-clear-btn": ["ClearSearch", "Clr", 0],
        "obj-maxlen-dial": ["MaxLength", "MaxLen", 0],
        "obj-tone-dial": ["ToneFilter", "Tone", 0],
        "obj-pitch-dial": ["PitchTranspose", "Pitch", 0],
        "obj-decay-dial": ["DecayEnvelope", "Trim/Dec", 0],
        "obj-gain-dial": ["PreviewGain", "Gain", 0]
    }

    patcher_doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 5,
                "architecture": "x64",
                "modernui": 1
            },
            "classnamespace": "box",
            "rect": [100.0, 100.0, 1080.0, 720.0],
            "openrect": [0.0, 0.0, 680.0, 169.0],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial Bold",
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
            "devicewidth": 680.0,
            "description": "XLN Audio XO-inspired 2D Drum Sample Space Browser & OS File Drag-Out Exporter",
            "digest": "",
            "tags": "M4L Sample Browser XO Drum Map Export",
            "style": "",
            "subpatcher_template": "",
            "title": "XO Sample Map",
            "boxes": boxes,
            "lines": lines,
            "parameters": {
                **parameters_dict,
                "parameterbanks": {
                    "0": {
                        "index": 0,
                        "name": "",
                        "parameters": [
                            "MaxLength",
                            "ToneFilter",
                            "PitchTranspose",
                            "DecayEnvelope",
                            "PreviewGain",
                            "OpenMapWindow"
                        ]
                    }
                },
                "inherited_shortname": 1
            },
            "dependency_cache": [],
            "latency": 0,
            "project": {
                "version": 1,
                "creationdate": 3590052786,
                "modificationdate": 3590052786,
                "viewrect": [0.0, 0.0, 300.0, 500.0],
                "autoorganize": 1,
                "hideprojectwindow": 1,
                "showdependencies": 1,
                "autolocalize": 0,
                "contents": {"patchers": {}},
                "layout": {},
                "searchpath": {},
                "detailsvisible": 0,
                "amxdtype": 1633771873,
                "readonly": 0,
                "devpathtype": 0,
                "devpath": ".",
                "sortmode": 0,
                "viewmode": 0
            },
            "autosave": 0
        }
    }

    json_bytes = (json.dumps(patcher_doc, indent="\t") + "\n").encode("utf-8")
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

    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + json_bytes)

    print(f"Built {OUT_AMXD_PATH} ({len(header) + len(json_bytes)} bytes)")


if __name__ == "__main__":
    build()
