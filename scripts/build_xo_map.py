#!/usr/bin/env python3
"""
Build script for devices/XO Sample Map.amxd
Generates a self-contained Max for Live Audio Effect device (.amxd) combining:
  - src/xo_node_engine.js (embedded in a Max 9 node.codebox object)
  - src/xo_strip_ui.js (embedded in a Max 9 v8ui object for in-device mini-map, waveform scanner & saved list)
  - Visibly separate FILTERS panel (Search textbox, MaxLen 50ms..Infinite, Tone, Sim stepping)
    vs. PLAYBACK panel (Audition, Pitch, Trim/Decay, Gain)
  - Scrollable, selectable, drag-reorderable & deletable Saved Samples List with Raw vs. Edited OS file drag-out
  - Stereo sfplay~ 2 audition engine with automatic Mono-to-Stereo routing (selector~ 2 1)
    and live waveform playhead scanning line (line 0. 20)
"""

import json
import os
import struct

from minify_embed import minify_patcher

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_node_engine.js")
STRIP_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_strip_ui.js")
# category names of the Options > Searches picker (order = src/xo_search.js XO_SEARCH_CATS; tests/test_xo_search.js checks it)
SEARCH_CAT_TITLES = ["Kick", "Snare", "Hi-Hat", "Clap", "Perc", "Shaker", "Cymbal", "Voice"]
FOLDER_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_folder_ui.js")
STRETCH_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_stretch.js")
SEARCH_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_search.js")
PALETTE_JS_PATH = os.path.join(ROOT_DIR, "src", "xo_palette.js")
LAYOUTS_DIR = os.path.join(ROOT_DIR, "scripts", "xo_layouts")


def load_layout(variant="default"):
    """Import scripts/xo_layouts/default.py (the layout module: see scripts/xo_layouts/README.md)."""
    import importlib.util
    path = os.path.join(LAYOUTS_DIR, variant + ".py")
    if not os.path.isfile(path):
        raise SystemExit("missing layout module %s" % path)
    spec = importlib.util.spec_from_file_location("xo_layout_" + variant, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build(variant="default"):
    layout = load_layout(variant)
    LAYOUT_JS_PATH = os.path.join(ROOT_DIR, layout.LAYOUT_JS)
    OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", layout.DEVICE_NAME + ".amxd")
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)

    with open(NODE_JS_PATH, "r", encoding="utf-8") as f:
        node_js_raw = f.read()

    with open(STRIP_JS_PATH, "r", encoding="utf-8") as f:
        strip_js_code = f.read()

    with open(FOLDER_JS_PATH, "r", encoding="utf-8") as f:
        folder_js_code = f.read()

    # Compact embedded JS comments/blank lines so node.codebox code buffer stays well under Max's atom limit
    import re
    compact_node_js = re.sub(r"(?m)^\s*//.*$\n?", "", node_js_raw)
    compact_node_js = re.sub(r"\n{2,}", "\n", compact_node_js)

    # Offline stretch engines (src/xo_stretch.js): wrapped in a function so the codebox needs no require() of it and
    # its helper names stay out of the engine's scope; the engine reads XO_STRETCH_EMBEDDED.
    with open(STRETCH_JS_PATH, "r", encoding="utf-8") as f:
        stretch_js_raw = f.read()
    stretch_js = re.sub(r"(?m)^\s*//.*$\n?", "", stretch_js_raw)
    stretch_js = re.sub(r"/\*.*?\*/", "", stretch_js, flags=re.S)
    stretch_js = re.sub(r"\n{2,}", "\n", stretch_js)
    stretch_wrapped = (
        "const XO_STRETCH_EMBEDDED = (function () {\nconst module = { exports: {} };\n"
        + stretch_js
        + "\nreturn module.exports;\n})();\n"
    )

    # Category search by words (src/xo_search.js): same wrapping, read by the engine as XO_SEARCH_EMBEDDED.
    with open(SEARCH_JS_PATH, "r", encoding="utf-8") as f:
        search_js_raw = f.read()
    search_js = re.sub(r"(?m)^\s*//.*$\n?", "", search_js_raw)
    search_js = re.sub(r"/\*.*?\*/", "", search_js, flags=re.S)
    search_js = re.sub(r"\n{2,}", "\n", search_js)
    search_wrapped = (
        "const XO_SEARCH_EMBEDDED = (function () {\nconst module = { exports: {} };\n"
        + search_js
        + "\nreturn module.exports;\n})();\n"
    )

    embedded_node_code = stretch_wrapped + search_wrapped + compact_node_js

    boxes = [
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
                "numoutlets": 4,
                "outlettype": ["signal", "signal", "signal", "bang"],
                "patching_rect": [120.0, 30.0, 82.0, 20.0],
                # 2 channels, default disk buffer, position outlet (ms of the playing file, outlet 2); bang on finish / halt = outlet 3
                "text": "sfplay~ 2 0 1"
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
        # Waveform playhead = the real sfplay~ position: snapshot~ samples the position outlet (ms) at ~30 Hz, only while playing
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-snap-pos",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["float"],
                "patching_rect": [355.0, 88.0, 130.0, 20.0],
                "text": "snapshot~ 33 @active 0"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-playpos",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [355.0, 115.0, 100.0, 20.0],
                "text": "prepend play_pos"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-snap-start",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [355.0, 62.0, 40.0, 20.0],
                "text": "start"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-snap-stop",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [400.0, 62.0, 40.0, 20.0],
                "text": "stop"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-play-done",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [490.0, 115.0, 60.0, 20.0],
                "text": "play_done"
            }
        },
        # Esc / stop_playback from the v8ui (outlet 1): fade the audition out in 8 ms, then halt sfplay~ and restore the unity envelope
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-route-uiout",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [355.0, 142.0, 120.0, 20.0],
                "text": "route stop_playback"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-trig-stop",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["bang", "bang"],
                "patching_rect": [480.0, 142.0, 40.0, 20.0],
                "text": "t b b"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-stop-fade",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [480.0, 168.0, 40.0, 20.0],
                "text": "0 8"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-del-stop",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [525.0, 168.0, 60.0, 20.0],
                "text": "delay 12"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-stop-zero",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [525.0, 194.0, 30.0, 20.0],
                "text": "0"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-env-unity",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [560.0, 194.0, 30.0, 20.0],
                "text": "1"
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
                "numinlets": 24,
                "numoutlets": 24,
                "outlettype": [""] * 24,
                "patching_rect": [420.0, 435.0, 780.0, 20.0],
                "text": (
                    "route minimap_clear minimap_batch minimap_done "
                    "selected_info play_file play_speed play_env play_scan_dur "
                    "play_mono play_gain saved_list_sync sync_playback_dials "
                    "prompt_folder strip_filter_cat strip_filter_maxlen strip_filter_tone "
                    "strip_filter_tonal strip_filter_drum folder_list_sync patcher_cmd setwidth_cmd "
                    "selected_wave audition_info"
                )
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-pak-vis",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [900.0, 520.0, 62.0, 20.0],
                "text": "pak 1 1 1"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-expr-width",
                "maxclass": "newobj",
                "numinlets": 3,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [900.0, 548.0, 232.0, 20.0],
                "text": layout.WIDTH_EXPR
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-setwidth",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [900.0, 575.0, 102.0, 20.0],
                "text": "prepend setwidth"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-root-thispatcher",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [900.0, 468.0, 68.0, 20.0],
                "save": ["#N", "thispatcher", ";", "#Q", "end", ";"],
                "text": "thispatcher"
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
                "id": "obj-prep-sel-wave",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 372.0, 118.0, 20.0],
                "text": "prepend selected_wave"
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
                "id": "obj-prep-sf-tonal",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [315.0, 450.0, 132.0, 20.0],
                "text": "prepend strip_filter_tonal"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-sf-drum",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [180.0, 450.0, 132.0, 20.0],
                "text": "prepend strip_filter_drum"
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
                "numoutlets": 7,
                "outlettype": ["float", "float", "float", "int", "float", "float", "int"],
                "patching_rect": [750.0, 468.0, 185.0, 20.0],
                "text": "unpack 0. 2500. 0. 0 100. 45. 1"
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
                "numinlets": 14,
                "numoutlets": 14,
                "outlettype": ["bang"] * 13 + [""],
                "patching_rect": [640.0, 522.0, 255.0, 20.0],
                # 115 / 83 = s / S, 127 / 8 / -5 / -3 = delete keys, 28 / 29 / 30 / 31 = left / right / up / down,
                # 114 / 82 = r / R (random sample), 27 = Esc (stop playback)
                "text": "sel 115 83 127 8 -5 -3 28 29 30 31 114 82 27"
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
                "id": "obj-msg-hotkey-prev",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [640.0, 578.0, 110.0, 20.0],
                "text": "hotkey_prev_similar"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-hotkey-next",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [755.0, 578.0, 110.0, 20.0],
                "text": "hotkey_next_similar"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-hotkey-random",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [990.0, 550.0, 110.0, 20.0],
                "text": "hotkey_random"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-hotkey-stop",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [990.0, 578.0, 110.0, 20.0],
                "text": "hotkey_stop"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-hotkey-back",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [870.0, 578.0, 110.0, 20.0],
                "text": "hotkey_history_back"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-hotkey-fwd",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [985.0, 578.0, 110.0, 20.0],
                "text": "hotkey_history_forward"
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

        # --- 5. Left Panel Header Widgets (Above Mini Editor v8ui: Saved / Filters / Playback Toggles; no title, Live's header names the device) ---
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [0.29, 0.87, 0.50, 1.0],
                "activetextcolor": [0.75, 0.80, 0.86, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Toolbar: show or hide the Saved samples list (list icon). Hiding it shrinks the device.",
                "annotation_name": "Show Saved List",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "fontsize": 8.0,
                "id": "obj-toggle-saved-btn",
                "maxclass": "live.text",
                "mode": 1,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [590.0, 30.0, 40.0, 15.0],
                "presentation": 1,
                "presentation_rect": [10.0, 9.0, 40.0, 15.0],
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
                "pictures": ["menu_closed.svg", "menu_closed.svg"],
                "remapsvgcolors": 1,
                "text": "Saved",
                "texton": "Saved",
                "usepicture": 1,
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
                "annotation": "Toolbar: show or hide the Filters section (filter-curve icon). Hiding it shrinks the device.",
                "annotation_name": "Show Filters Section",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "fontsize": 8.0,
                "id": "obj-toggle-filters-btn",
                "maxclass": "live.text",
                "mode": 1,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [645.0, 30.0, 40.0, 15.0],
                "presentation": 1,
                "presentation_rect": [53.0, 9.0, 40.0, 15.0],
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
                "pictures": ["bandpass.svg", "bandpass.svg"],
                "remapsvgcolors": 1,
                "text": "Filters",
                "texton": "Filters",
                "usepicture": 1,
                "varname": "ShowFiltersSection"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-show-filters",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [645.0, 52.0, 126.0, 20.0],
                "text": "prepend set_show_filters"
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
                "annotation": "Toolbar: show or hide the Playback section (envelope icon). Hiding it shrinks the device.",
                "annotation_name": "Show Playback Section",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "fontsize": 8.0,
                "id": "obj-toggle-playback-btn",
                "maxclass": "live.text",
                "mode": 1,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [700.0, 30.0, 48.0, 15.0],
                "presentation": 1,
                "presentation_rect": [96.0, 9.0, 48.0, 15.0],
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
                "pictures": ["sharkTooth.svg", "sharkTooth.svg"],
                "remapsvgcolors": 1,
                "text": "Playback",
                "texton": "Playback",
                "usepicture": 1,
                "varname": "ShowPlaybackSection"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-show-playback",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [780.0, 30.0, 138.0, 20.0],
                "text": "prepend set_show_playback"
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

        # --- 6. Center Panel: FILTERS (Search, Re-Seed, MaxLen, Tone, Tonal, Druminess & Remembered Folder List) ---
        {
            "box": {
                "fontface": 1,
                "fontsize": 9.5,
                "id": "obj-hdr-filters",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [420.0, 90.0, 68.0, 15.0],
                "presentation": 1,
                "presentation_rect": [398.0, 6.0, 68.0, 15.0],
                "text": "FILTERS",
                "textcolor": [0.22, 0.74, 0.97, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.12, 0.17, 0.23, 1.0],
                "activebgoncolor": [0.22, 0.74, 0.97, 1.0],
                "activetextcolor": [0.22, 0.74, 0.97, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Re-seeds and fills the 2D map with up to Map Samples (Options, default 1,500) samples from the full corpus that match all active filters.",
                "annotation_name": "Re-Seed Filtered Map",
                "bordercolor": [0.22, 0.74, 0.97, 0.75],
                "id": "obj-reseed-filtered-btn",
                "maxclass": "live.text",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [550.0, 110.0, 52.0, 14.0],
                "presentation": 1,
                "presentation_rect": [510.0, 6.0, 52.0, 14.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Re-Seed Filtered Map",
                        "parameter_enum": ["val1", "val2"],
                        "parameter_invisible": 2,
                        "parameter_longname": "ReseedFilteredMap",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Re-Seed",
                        "parameter_type": 2
                    }
                },
                "text": "Re-Seed",
                "texton": "Re-Seed",
                "varname": "ReseedFilteredMap"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-reseed-filtered",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [550.0, 158.0, 96.0, 20.0],
                "text": "reseed_filtered"
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
                "presentation_rect": [566.0, 6.0, 28.0, 14.0],
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
                "patching_rect": [510.0, 110.0, 196.0, 17.0],
                "presentation": 1,
                "presentation_rect": [398.0, 22.0, 196.0, 17.0],
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
                "patching_rect": [420.0, 165.0, 46.0, 46.0],
                "presentation": 1,
                "presentation_rect": [398.0, 41.0, 46.0, 46.0],
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
                "patching_rect": [485.0, 165.0, 46.0, 46.0],
                "presentation": 1,
                "presentation_rect": [448.0, 41.0, 46.0, 46.0],
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
                "activedialcolor": [0.22, 0.74, 0.97, 1.0],
                "annotation": "Filters samples by Tonal vs. Atonal character (-100% Atonal/Noisy to +100% Tonal/Pitched, 0% = All).",
                "annotation_name": "Tonal vs. Atonal Filter",
                "id": "obj-filter-tonal-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [605.0, 110.0, 46.0, 46.0],
                "presentation": 1,
                "presentation_rect": [498.0, 41.0, 46.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Tonal vs. Atonal Filter",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "TonalFilter",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": -100.0,
                        "parameter_shortname": "Tonal",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "varname": "TonalFilter"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-filter-tonal",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [680.0, 158.0, 122.0, 20.0],
                "text": "prepend set_filter_tonal"
            }
        },
        {
            "box": {
                "activedialcolor": [0.22, 0.74, 0.97, 1.0],
                "annotation": "Filters between Pads/Sustained Clusters (-100%) and Punchy Percussive Drums (+100%, 0% = All).",
                "annotation_name": "Druminess Filter (Pads vs. Drums)",
                "id": "obj-filter-drum-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [665.0, 110.0, 46.0, 46.0],
                "presentation": 1,
                "presentation_rect": [548.0, 41.0, 46.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Druminess Filter (Pads vs. Drums)",
                        "parameter_initial": [0.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "DruminessFilter",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": -100.0,
                        "parameter_shortname": "Drums",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "varname": "DruminessFilter"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-filter-drum",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [810.0, 158.0, 122.0, 20.0],
                "text": "prepend set_filter_drum"
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
                "patching_rect": [750.0, 90.0, 196.0, 69.0],
                "presentation": 1,
                "presentation_rect": [398.0, 90.0, 196.0, 69.0],
                "textfile": {
                    "text": folder_js_code,
                    "filename": "none",
                    "flags": 0,
                    "embed": 1,
                    "autowatch": 1
                }
            }
        },

        # --- 7. Right Panel: PLAYBACK CONTROLS (Pitch, Speed, Grain, Trim/Decay, Mode, Gain, Reverse) ---
        {
            "box": {
                "fontface": 1,
                "fontsize": 9.5,
                "id": "obj-hdr-playback",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [780.0, 30.0, 92.0, 15.0],
                "presentation": 1,
                "presentation_rect": [612.0, 6.0, 92.0, 15.0],
                "text": "PLAYBACK",
                "textcolor": [1.0, 0.709804, 0.196078, 1.0],
                "textjustification": 0
            }
        },
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [1.0, 0.694, 0.18, 1.0],
                "activetextcolor": [0.85, 0.89, 0.94, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Reverses sample playback and edited WAV exports. Saved with sample.",
                "annotation_name": "Reverse Playback",
                "bordercolor": [1.0, 0.694, 0.18, 0.65],
                "id": "obj-reverse-btn",
                "maxclass": "live.text",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [750.0, 165.0, 52.0, 14.0],
                "presentation": 1,
                "presentation_rect": [712.0, 6.0, 52.0, 14.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Reverse Playback",
                        "parameter_enum": ["Forward", "Reverse"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_longname": "ReversePlayback",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Reverse",
                        "parameter_type": 2
                    }
                },
                "text": "Reverse",
                "texton": "Reversed",
                "varname": "ReversePlayback"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-reverse",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [750.0, 215.0, 102.0, 20.0],
                "text": "prepend set_reverse"
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
                "patching_rect": [550.0, 165.0, 48.0, 46.0],
                "presentation": 1,
                "presentation_rect": [610.0, 30.0, 48.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Pitch Transpose",
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "PitchTranspose",
                        "parameter_mmax": 24.0,
                        "parameter_mmin": -24.0,
                        "parameter_shortname": "Pitch",
                        "parameter_type": 1,
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
                "annotation": "Time-stretch playback speed (engine chosen with Mode) (10% slow stretch up to 400% fast scan, 100% = 1:1). Saved with sample.",
                "annotation_name": "Granular Speed",
                "id": "obj-speed-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [810.0, 165.0, 48.0, 46.0],
                "presentation": 1,
                "presentation_rect": [664.0, 30.0, 48.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Granular Speed",
                        "parameter_exponent": 1.6,
                        "parameter_initial": [100.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "StretchSpeed",
                        "parameter_mmax": 400.0,
                        "parameter_mmin": 10.0,
                        "parameter_shortname": "Speed",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5
                    }
                },
                "varname": "StretchSpeed"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-speed",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [810.0, 215.0, 92.0, 20.0],
                "text": "prepend set_speed"
            }
        },
        {
            "box": {
                "activedialcolor": [1.0, 0.694, 0.18, 1.0],
                "annotation": "Grain mode: Hann grain size (5 ms micro-grains up to 250 ms smooth clouds). Texture mode: analysis window size (5..250 ms maps to a 4096..32768 sample window; larger = smoother). Dimmed in Cmplx. Saved with sample.",
                "annotation_name": "Grain Size",
                "id": "obj-grain-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [865.0, 165.0, 48.0, 46.0],
                "presentation": 1,
                "presentation_rect": [718.0, 30.0, 48.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Grain Size",
                        "parameter_exponent": 1.5,
                        "parameter_initial": [45.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "GrainSize",
                        "parameter_mmax": 250.0,
                        "parameter_mmin": 5.0,
                        "parameter_shortname": "Grain",
                        "parameter_type": 0,
                        "parameter_unitstyle": 2
                    }
                },
                "varname": "GrainSize"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-grain",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [865.0, 215.0, 90.0, 20.0],
                "text": "prepend set_grain"
            }
        },
        {
            "box": {
                "activedialcolor": [1.0, 0.694, 0.18, 1.0],
                "annotation": "Sets the trim & amplitude decay time (up to 20s) for sample playback and edited exports.",
                "annotation_name": "Trim / Decay",
                "id": "obj-decay-dial",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [615.0, 165.0, 48.0, 46.0],
                "presentation": 1,
                "presentation_rect": [610.0, 92.0, 48.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Trim / Decay",
                        "parameter_exponent": 2.2,
                        "parameter_initial": [2500.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "DecayEnvelope",
                        "parameter_mmax": 20000.0,
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
                "activedialcolor": [0.66, 0.33, 0.97, 1.0],
                "annotation": "Time-stretch engine used when Speed is not 100% (Texture always renders): Grain = granular clouds, Cmplx = phase vocoder with transient and phase-lock handling, Textr = PaulStretch-style frozen texture. Saved with sample.",
                "annotation_name": "Stretch Mode",
                "id": "obj-stretch-mode",
                "maxclass": "live.dial",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [920.0, 165.0, 48.0, 46.0],
                "presentation": 1,
                "presentation_rect": [664.0, 92.0, 48.0, 46.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Stretch Mode",
                        "parameter_enum": ["Grain", "Cmplx", "Textr"],
                        "parameter_initial": [1],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "StretchMode",
                        "parameter_mmax": 2,
                        "parameter_mmin": 0,
                        "parameter_shortname": "Mode",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9
                    }
                },
                "varname": "StretchMode"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-stretch-mode",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [920.0, 215.0, 130.0, 20.0],
                "text": "prepend set_stretchmode"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-audition-info",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [1060.0, 240.0, 130.0, 20.0],
                "text": "prepend audition_info"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-test-width",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [1060.0, 265.0, 130.0, 20.0],
                "text": "prepend test_width"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-r-testkey",
                "maxclass": "newobj",
                "numinlets": 0,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [1060.0, 320.0, 130.0, 20.0],
                "text": "receive #0-xo-testkey"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-init-selection",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [70.0, 625.0, 85.0, 20.0],
                "text": "init_selection"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-r-test",
                "maxclass": "newobj",
                "numinlets": 0,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [1060.0, 290.0, 110.0, 20.0],
                "text": "receive #0-xo-test"
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
                "patching_rect": [680.0, 165.0, 48.0, 46.0],
                "presentation": 1,
                "presentation_rect": [718.0, 92.0, 48.0, 46.0],
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
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-apply-layout",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [70.0, 625.0, 78.0, 20.0],
                "text": "apply_layout"
            }
        },
        # --- Options toolbar toggle + Theme selector (parameters appended after every existing one; in the default
        #     devices, which have no Options section, they stay as off-face parameters: presentation 0) ---
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [0.66, 0.40, 0.97, 1.0],
                "activetextcolor": [0.75, 0.80, 0.86, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Options: show or hide the Options section (gear icon, bottom of the toolbar): the Theme selector.",
                "annotation_name": "Show Options Section",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "fontsize": 8.0,
                "id": "obj-toggle-options-btn",
                "maxclass": "live.text",
                "mode": 1,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [820.0, 30.0, 40.0, 15.0],
                "presentation": 1,
                "presentation_rect": [6.0, 145.0, 16.0, 16.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Show Options Section",
                        "parameter_enum": ["Hidden", "Shown"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_longname": "ShowOptions",
                        "parameter_mmax": 1,
                        "parameter_shortname": "Options",
                        "parameter_type": 2
                    }
                },
                "pictures": ["gear.svg", "gear.svg"],
                "remapsvgcolors": 1,
                "text": "Options",
                "texton": "Options",
                "usepicture": 1,
                "varname": "ShowOptions"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-show-options",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [820.0, 52.0, 138.0, 20.0],
                "text": "prepend set_show_options"
            }
        },
        {
            "box": {
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "activebgoncolor": [0.66, 0.40, 0.97, 1.0],
                "activetextcolor": [0.85, 0.89, 0.94, 1.0],
                "activetextoncolor": [0.06, 0.08, 0.10, 1.0],
                "annotation": "Look of the device: LCD = amber hardware readouts, Focus = slim dial columns, Live = Ableton's own device look in your Live theme colours. Same parameters either way.",
                "annotation_name": "Theme",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "fontsize": 9.0,
                "id": "obj-theme-tab",
                "maxclass": "live.tab",
                "num_lines_patching": 1,
                "num_lines_presentation": 1,
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", "float"],
                "parameter_enable": 1,
                "patching_rect": [820.0, 90.0, 84.0, 18.0],
                "presentation": 1,
                "presentation_rect": [34.0, 44.0, 84.0, 18.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Theme",
                        "parameter_enum": ["LCD", "Focus", "Live"],
                        "parameter_initial": [2],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Theme",
                        "parameter_mmax": 2,
                        "parameter_shortname": "Theme",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9
                    }
                },
                "spacing_x": 2.0,
                "varname": "Theme"
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-theme",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [820.0, 120.0, 102.0, 20.0],
                "text": "prepend set_theme"
            }
        },
        # --- Options > Searches (themed layout only; presentation 0 elsewhere): category picker (hidden UI-state parameter),
        # terms text field, Reset, Match folders (stored in the XOStateData blob, not a parameter)
        {
            "box": {
                "annotation": "Category whose search terms are shown below.",
                "annotation_name": "Searches Category",
                "bordercolor": [0.32, 0.38, 0.46, 1.0],
                "activebgcolor": [0.14, 0.17, 0.21, 1.0],
                "textcolor": [0.85, 0.89, 0.94, 1.0],
                "fontsize": 9.0,
                "id": "obj-searches-cat",
                "maxclass": "live.menu",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", "float"],
                "parameter_enable": 1,
                "patching_rect": [820.0, 160.0, 138.0, 15.0],
                "presentation": 1,
                "presentation_rect": [34.0, 80.0, 138.0, 15.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Searches Category",
                        "parameter_enum": SEARCH_CAT_TITLES,
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 2,
                        "parameter_linknames": 1,
                        "parameter_longname": "Searches Category",
                        "parameter_mmax": len(SEARCH_CAT_TITLES) - 1,
                        "parameter_shortname": "Search Cat",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9
                    }
                },
                "varname": "SearchesCategory"
            }
        },
        {
            "box": {
                "annotation": "Search terms of the selected category, comma separated. Press Enter (or click elsewhere) to apply.",
                "annotation_name": "Search terms",
                "autoscroll": 0,
                "bgcolor": [0.07, 0.085, 0.11, 1.0],
                "border": 1.0,
                "bordercolor": [0.22, 0.74, 0.97, 0.65],
                "fontname": "Arial",
                "fontsize": 9.0,
                "id": "obj-searches-terms",
                "keymode": 1,
                "lines": 3,
                "maxclass": "textedit",
                "numinlets": 1,
                "numoutlets": 4,
                "outlettype": ["", "int", "", ""],
                "outputmode": 1,
                "parameter_enable": 0,
                "patching_rect": [820.0, 180.0, 138.0, 40.0],
                "presentation": 1,
                "presentation_rect": [34.0, 97.0, 138.0, 40.0],
                "tabmode": 1,
                "textcolor": [0.92, 0.95, 0.98, 1.0],
                "wordwrap": 1
            }
        },
        {
            "box": {
                "annotation": "Restore the default terms of the selected category.",
                "annotation_name": "Reset terms",
                "id": "obj-searches-reset",
                "maxclass": "live.text",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 0,
                "patching_rect": [820.0, 230.0, 44.0, 16.0],
                "presentation": 1,
                "presentation_rect": [34.0, 141.0, 44.0, 16.0],
                "text": "Reset",
                "texton": "Reset"
            }
        },
        {
            "box": {
                "annotation": "Also match the folder names below the indexed folder (not its own name or parents).",
                "annotation_name": "Match folders",
                "id": "obj-searches-folders",
                "maxclass": "live.text",
                "mode": 1,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 0,
                "patching_rect": [870.0, 230.0, 90.0, 16.0],
                "presentation": 1,
                "presentation_rect": [82.0, 141.0, 90.0, 16.0],
                "text": "Match folders",
                "texton": "Match folders",
                "varname": "obj-searches-folders"
            }
        },
        # --- Options > Zoom Speed: stored-only float parameter (appended last), one live.numbox for both themes (THEME_STYLE
        # restyles it). Log feel: exponent 2.32 puts 1.0x at the middle of the 0.25..4 range (0.25 + 3.75 * 0.5^2.32 = 1.0).
        {
            "box": {
                "annotation": "Mouse-wheel zoom speed of the map. 1.0x = the default rate; 0.25x slower .. 4x faster.",
                "annotation_name": "Zoom Speed",
                "appearance": 4,
                "fontsize": 9.0,
                "id": "obj-zoom-speed",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [820.0, 140.0, 50.0, 18.0],
                "presentation": 1,
                "presentation_rect": [94.0, 44.0, 50.0, 18.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Mouse-wheel zoom speed of the map",
                        "parameter_exponent": 2.32,
                        "parameter_initial": [1.0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Zoom Speed",
                        "parameter_mmax": 4.0,
                        "parameter_mmin": 0.25,
                        "parameter_shortname": "Zoom Spd",
                        "parameter_type": 0,
                        "parameter_unitstyle": 9,
                        "parameter_units": "%.2fx"
                    }
                },
                "varname": "ZoomSpeed"
            }
        },
        # --- Options > Map Samples: maximum number of samples on the map (stored-only float parameter with Int display, appended
        # last: Live's Int type stops at 255). The node engine picks the map subset from it (src/xo_node_engine.js `map_samples`).
        {
            "box": {
                "annotation": "Maximum number of samples shown on the map (100..5000). Changing it re-picks the map; the selection stays if it is still on it.",
                "annotation_name": "Map Samples",
                "appearance": 4,
                "fontsize": 9.0,
                "id": "obj-map-samples",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [820.0, 190.0, 52.0, 18.0],
                "presentation": 1,
                "presentation_rect": [132.0, 44.0, 52.0, 18.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Maximum number of samples shown on the map",
                        "parameter_initial": [1500.0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Map Samples",
                        "parameter_mmax": 5000.0,
                        "parameter_mmin": 100.0,
                        "parameter_shortname": "Map Smpl",
                        "parameter_type": 0,
                        "parameter_unitstyle": 0
                    }
                },
                "varname": "MapSamples"
            }
        },
        {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-prep-mapsamples", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [820.0, 215.0, 130.0, 20.0], "text": "prepend set_mapsamples"}},
        {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-prep-zoomspeed", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [820.0, 165.0, 120.0, 20.0], "text": "prepend set_zoomspeed"}},
        {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-prep-terms-cat", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [820.0, 260.0, 130.0, 20.0], "text": "prepend set_terms_cat"}},
        {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-route-terms", "maxclass": "newobj", "numinlets": 1, "numoutlets": 2,
                 "outlettype": ["", ""], "patching_rect": [820.0, 285.0, 70.0, 20.0], "text": "route text"}},
        {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-prep-terms-text", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [820.0, 310.0, 132.0, 20.0], "text": "prepend set_terms_text"}},
        {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-prep-terms-reset", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [820.0, 335.0, 140.0, 20.0], "text": "prepend set_terms_reset"}},
        {"box": {"fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-prep-match-folders", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [820.0, 360.0, 150.0, 20.0], "text": "prepend set_match_folders"}},
        {
            "box": {
                "angle": 270.0,
                "background": 1,
                "bgcolor": [0.105, 0.125, 0.15, 1.0],
                "border": 1,
                "bordercolor": [0.06, 0.07, 0.08, 1.0],
                "id": "obj-panel-toolbar",
                "maxclass": "panel",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [30.0, 640.0, 100.0, 40.0],
                "presentation": 1,
                "presentation_rect": [3.0, 5.0, 22.0, 159.0],
                "proportion": 0.39,
                "rounded": 6
            }
        },
        {
            "box": {
                "angle": 270.0,
                "background": 1,
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
                "background": 1,
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
                "presentation_rect": [392.0, 5.0, 208.0, 159.0],
                "proportion": 0.39,
                "rounded": 6
            }
        },
        {
            "box": {
                "angle": 270.0,
                "background": 1,
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
                "presentation_rect": [606.0, 5.0, 164.0, 159.0],
                "proportion": 0.39,
                "rounded": 6
            }
        },
        # --- 9. Embedded Node for Max Engine (placed at the very end of boxes in background layer with 1x1 rect inside 0..169 so it boots in Presentation Mode while remaining 100% hidden: it sits under the centre of the Options (gear) toggle, an opaque toolbar button the layout never moves or hides, in every theme) ---
        {
            "box": {
                "background": 1,
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
                "presentation_rect": [13.0, 152.0, 1.0, 1.0],
                "saved_object_attributes": {
                    "autostart": 1,
                    "defer": 1,
                    "watch": 0
                }
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
        # Waveform playhead: sfplay~ position outlet (2) -> snapshot~ (started with the play message, stopped by the finish bang)
        {"patchline": {"source": ["obj-sfplay", 2], "destination": ["obj-snap-pos", 0]}},
        {"patchline": {"source": ["obj-snap-pos", 0], "destination": ["obj-prep-playpos", 0]}},
        {"patchline": {"source": ["obj-prep-playpos", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-trig-play", 0], "destination": ["obj-msg-snap-start", 0]}},
        {"patchline": {"source": ["obj-msg-snap-start", 0], "destination": ["obj-snap-pos", 0]}},
        {"patchline": {"source": ["obj-sfplay", 3], "destination": ["obj-msg-snap-stop", 0]}},
        {"patchline": {"source": ["obj-msg-snap-stop", 0], "destination": ["obj-snap-pos", 0]}},
        {"patchline": {"source": ["obj-sfplay", 3], "destination": ["obj-msg-play-done", 0]}},
        {"patchline": {"source": ["obj-msg-play-done", 0], "destination": ["obj-minimap", 0]}},
        # Esc: v8ui outlet 1 `stop_playback` -> fade 8 ms, halt, unity envelope again
        {"patchline": {"source": ["obj-minimap", 1], "destination": ["obj-route-uiout", 0]}},
        {"patchline": {"source": ["obj-route-uiout", 0], "destination": ["obj-trig-stop", 0]}},
        {"patchline": {"source": ["obj-trig-stop", 1], "destination": ["obj-msg-stop-fade", 0]}},
        {"patchline": {"source": ["obj-msg-stop-fade", 0], "destination": ["obj-env-line", 0]}},
        {"patchline": {"source": ["obj-trig-stop", 0], "destination": ["obj-del-stop", 0]}},
        {"patchline": {"source": ["obj-del-stop", 0], "destination": ["obj-msg-stop-zero", 0]}},
        {"patchline": {"source": ["obj-del-stop", 0], "destination": ["obj-msg-env-unity", 0]}},
        {"patchline": {"source": ["obj-msg-stop-zero", 0], "destination": ["obj-sfplay", 0]}},
        {"patchline": {"source": ["obj-msg-env-unity", 0], "destination": ["obj-env-line", 0]}},

        # 2. node.codebox Outlet Routing
        {"patchline": {"source": ["obj-node", 0], "destination": ["obj-route-node", 0]}},
        {"patchline": {"source": ["obj-route-node", 0], "destination": ["obj-prep-mm-clear", 0]}},
        {"patchline": {"source": ["obj-prep-mm-clear", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 1], "destination": ["obj-prep-mm-batch", 0]}},
        {"patchline": {"source": ["obj-prep-mm-batch", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 2], "destination": ["obj-prep-mm-done", 0]}},
        {"patchline": {"source": ["obj-prep-mm-done", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 3], "destination": ["obj-prep-sel-info", 0]}},
        {"patchline": {"source": ["obj-prep-sel-info", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 4], "destination": ["obj-trig-play", 0]}},
        {"patchline": {"source": ["obj-route-node", 5], "destination": ["obj-speed-reg", 1], "order": 1}},
        {"patchline": {"source": ["obj-route-node", 5], "destination": ["obj-sfplay", 1], "order": 0}},
        {"patchline": {"source": ["obj-route-node", 6], "destination": ["obj-env-line", 0]}},
        # route-node outlet 7 (play_scan_dur) is informational only now: the playhead follows sfplay~'s real position
        {"patchline": {"source": ["obj-route-node", 8], "destination": ["obj-r-chan-sel", 0]}},
        {"patchline": {"source": ["obj-route-node", 9], "destination": ["obj-dbtoa", 0]}},
        {"patchline": {"source": ["obj-route-node", 10], "destination": ["obj-prep-saved-sync", 0]}},
        {"patchline": {"source": ["obj-prep-saved-sync", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 11], "destination": ["obj-unpack-recalled", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 0], "destination": ["obj-pitch-dial", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 1], "destination": ["obj-decay-dial", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 2], "destination": ["obj-gain-dial", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 3], "destination": ["obj-reverse-btn", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 4], "destination": ["obj-speed-dial", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 5], "destination": ["obj-grain-dial", 0]}},
        {"patchline": {"source": ["obj-unpack-recalled", 6], "destination": ["obj-stretch-mode", 0]}},
        {"patchline": {"source": ["obj-route-node", 22], "destination": ["obj-prep-audition-info", 0]}},
        {"patchline": {"source": ["obj-prep-audition-info", 0], "destination": ["obj-minimap", 0]}},
        # Test hook (tests/test_xo_map.js, scripts/test_xo_live.js): `; #0-xo-test <message>` (literal #0 in a top-level device) drives the v8ui and
        # test_report writes its state to Global("xo_test"); the device width is mirrored for the report.
        {"patchline": {"source": ["obj-r-test", 0], "destination": ["obj-minimap", 0]}},
        # Test hook for the hotkeys: `; #0-xo-testkey <key code>` reaches every instance's obj-sel-key exactly like the `key` object's output
        {"patchline": {"source": ["obj-r-testkey", 0], "destination": ["obj-sel-key", 0]}},
        # Which instance is the selected device in Live (hotkeys from `key` only act there): started by live.thisdevice, never loadbang
        {"patchline": {"source": ["obj-thisdevice", 0], "destination": ["obj-msg-init-selection", 0], "order": 2}},
        {"patchline": {"source": ["obj-msg-init-selection", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-expr-width", 0], "destination": ["obj-prep-test-width", 0]}},
        {"patchline": {"source": ["obj-prep-test-width", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 12], "destination": ["obj-opendialog", 0]}},
        {"patchline": {"source": ["obj-route-node", 13], "destination": ["obj-prep-sf-cat", 0]}},
        {"patchline": {"source": ["obj-prep-sf-cat", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 14], "destination": ["obj-prep-sf-maxlen", 0]}},
        {"patchline": {"source": ["obj-prep-sf-maxlen", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 15], "destination": ["obj-prep-sf-tone", 0]}},
        {"patchline": {"source": ["obj-prep-sf-tone", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 16], "destination": ["obj-prep-sf-tonal", 0]}},
        {"patchline": {"source": ["obj-prep-sf-tonal", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 17], "destination": ["obj-prep-sf-drum", 0]}},
        {"patchline": {"source": ["obj-prep-sf-drum", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-route-node", 18], "destination": ["obj-prep-folder-sync", 0]}},
        {"patchline": {"source": ["obj-prep-folder-sync", 0], "destination": ["obj-folder-list", 0]}},
        {"patchline": {"source": ["obj-route-node", 19], "destination": ["obj-root-thispatcher", 0]}},
        {"patchline": {"source": ["obj-route-node", 20], "destination": ["obj-prep-setwidth", 0]}},
        {"patchline": {"source": ["obj-route-node", 21], "destination": ["obj-prep-sel-wave", 0]}},
        {"patchline": {"source": ["obj-prep-sel-wave", 0], "destination": ["obj-minimap", 0]}},

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
        {"patchline": {"source": ["obj-sel-key", 6], "destination": ["obj-msg-hotkey-prev", 0]}},
        {"patchline": {"source": ["obj-sel-key", 7], "destination": ["obj-msg-hotkey-next", 0]}},
        {"patchline": {"source": ["obj-sel-key", 8], "destination": ["obj-msg-hotkey-fwd", 0]}},
        {"patchline": {"source": ["obj-sel-key", 9], "destination": ["obj-msg-hotkey-back", 0]}},
        {"patchline": {"source": ["obj-sel-key", 10], "destination": ["obj-msg-hotkey-random", 0]}},
        {"patchline": {"source": ["obj-sel-key", 11], "destination": ["obj-msg-hotkey-random", 0]}},
        {"patchline": {"source": ["obj-sel-key", 12], "destination": ["obj-msg-hotkey-stop", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-random", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-stop", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-prev", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-next", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-fwd", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-back", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-hotkey-save", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-del-saved", 0], "destination": ["obj-minimap", 0]}},

        # 4. Pop-out Map Window, Section Collapse/Show Toggles (with Dynamic Device Shrinking) & Folder Dialog Controls
        {"patchline": {"source": ["obj-opendialog", 0], "destination": ["obj-prep-add-folder", 0]}},
        {"patchline": {"source": ["obj-prep-add-folder", 0], "destination": ["obj-node", 0]}},
        # Saved List Collapse/Show Toggle -> v8ui, node.codebox, AND live.thisdevice ("setwidth <w>")
        {"patchline": {"source": ["obj-toggle-saved-btn", 0], "destination": ["obj-prep-show-saved", 0], "order": 1}},
        {"patchline": {"source": ["obj-toggle-saved-btn", 0], "destination": ["obj-pak-vis", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-show-saved", 0], "destination": ["obj-minimap", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-show-saved", 0], "destination": ["obj-node", 0], "order": 0}},
        # Filters Section Collapse/Show Toggle -> hidden, node.codebox, AND live.thisdevice ("setwidth <w>")
        {"patchline": {"source": ["obj-toggle-filters-btn", 0], "destination": ["obj-inv-filters", 0], "order": 2}},
        {"patchline": {"source": ["obj-toggle-filters-btn", 0], "destination": ["obj-prep-show-filters", 0], "order": 1}},
        {"patchline": {"source": ["obj-toggle-filters-btn", 0], "destination": ["obj-pak-vis", 1], "order": 0}},
        {"patchline": {"source": ["obj-prep-show-filters", 0], "destination": ["obj-minimap", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-show-filters", 0], "destination": ["obj-node", 0], "order": 0}},
        {"patchline": {"source": ["obj-inv-filters", 0], "destination": ["obj-prep-hide-filters", 0]}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-panel-filters", 0], "order": 9}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-hdr-filters", 0], "order": 8}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-reseed-filtered-btn", 0], "order": 7}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-search-clear-btn", 0], "order": 6}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-search-box", 0], "order": 5}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-maxlen-dial", 0], "order": 4}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-tone-dial", 0], "order": 3}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-filter-tonal-dial", 0], "order": 2}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-filter-drum-dial", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-hide-filters", 0], "destination": ["obj-folder-list", 0], "order": 0}},
        # Playback Section Collapse/Show Toggle -> hidden, node.codebox, AND live.thisdevice ("setwidth <w>")
        {"patchline": {"source": ["obj-toggle-playback-btn", 0], "destination": ["obj-inv-playback", 0], "order": 2}},
        {"patchline": {"source": ["obj-toggle-playback-btn", 0], "destination": ["obj-prep-show-playback", 0], "order": 1}},
        {"patchline": {"source": ["obj-toggle-playback-btn", 0], "destination": ["obj-pak-vis", 2], "order": 0}},
        {"patchline": {"source": ["obj-pak-vis", 0], "destination": ["obj-expr-width", 0]}},
        {"patchline": {"source": ["obj-expr-width", 0], "destination": ["obj-prep-setwidth", 0]}},
        {"patchline": {"source": ["obj-prep-setwidth", 0], "destination": ["obj-thisdevice", 0]}},
        {"patchline": {"source": ["obj-prep-show-playback", 0], "destination": ["obj-minimap", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-show-playback", 0], "destination": ["obj-node", 0], "order": 0}},
        {"patchline": {"source": ["obj-inv-playback", 0], "destination": ["obj-prep-hide-playback", 0]}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-panel-playback", 0], "order": 8}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-hdr-playback", 0], "order": 7}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-pitch-dial", 0], "order": 6}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-speed-dial", 0], "order": 5}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-grain-dial", 0], "order": 4}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-decay-dial", 0], "order": 3}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-stretch-mode", 0], "order": 2}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-gain-dial", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-hide-playback", 0], "destination": ["obj-reverse-btn", 0], "order": 0}},

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
        {"patchline": {"source": ["obj-filter-tonal-dial", 0], "destination": ["obj-prep-filter-tonal", 0], "order": 1}},
        {"patchline": {"source": ["obj-filter-tonal-dial", 0], "destination": ["obj-prep-sf-tonal", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-filter-tonal", 0], "destination": ["obj-node", 0]}},
        {"patchline": {"source": ["obj-filter-drum-dial", 0], "destination": ["obj-prep-filter-drum", 0], "order": 1}},
        {"patchline": {"source": ["obj-filter-drum-dial", 0], "destination": ["obj-prep-sf-drum", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-filter-drum", 0], "destination": ["obj-node", 0]}},
        {"patchline": {"source": ["obj-reseed-filtered-btn", 0], "destination": ["obj-msg-reseed-filtered", 0]}},
        {"patchline": {"source": ["obj-msg-reseed-filtered", 0], "destination": ["obj-node", 0]}},

        # 6. PLAYBACK Panel Controls -> node.codebox & v8ui
        {"patchline": {"source": ["obj-pitch-dial", 0], "destination": ["obj-prep-pitch", 0]}},
        {"patchline": {"source": ["obj-prep-pitch", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-pitch", 0], "destination": ["obj-minimap", 0], "order": 0}},
        {"patchline": {"source": ["obj-speed-dial", 0], "destination": ["obj-prep-speed", 0]}},
        {"patchline": {"source": ["obj-prep-speed", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-speed", 0], "destination": ["obj-minimap", 0], "order": 0}},
        {"patchline": {"source": ["obj-grain-dial", 0], "destination": ["obj-prep-grain", 0]}},
        {"patchline": {"source": ["obj-prep-grain", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-grain", 0], "destination": ["obj-minimap", 0], "order": 0}},
        {"patchline": {"source": ["obj-decay-dial", 0], "destination": ["obj-prep-decay", 0]}},
        {"patchline": {"source": ["obj-prep-decay", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-decay", 0], "destination": ["obj-minimap", 0], "order": 0}},
        {"patchline": {"source": ["obj-stretch-mode", 0], "destination": ["obj-prep-stretch-mode", 0]}},
        {"patchline": {"source": ["obj-prep-stretch-mode", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-stretch-mode", 0], "destination": ["obj-minimap", 0], "order": 0}},
        {"patchline": {"source": ["obj-reverse-btn", 0], "destination": ["obj-prep-reverse", 0]}},
        {"patchline": {"source": ["obj-prep-reverse", 0], "destination": ["obj-node", 0], "order": 1}},
        {"patchline": {"source": ["obj-prep-reverse", 0], "destination": ["obj-minimap", 0], "order": 0}},

        # 7. Device Startup
        {"patchline": {"source": ["obj-thisdevice", 0], "destination": ["obj-msg-init", 0], "order": 1}},
        {"patchline": {"source": ["obj-thisdevice", 0], "destination": ["obj-msg-apply-layout", 0], "order": 0}},
        {"patchline": {"source": ["obj-msg-apply-layout", 0], "destination": ["obj-minimap", 0]}},
        {"patchline": {"source": ["obj-msg-init", 0], "destination": ["obj-node", 0]}}
    ]

    parameters_dict = {
        "obj-minimap": ["XOStateData", "XOStateData", 0],
        "obj-toggle-saved-btn": ["ShowSavedList", "Saved", 0],
        "obj-toggle-filters-btn": ["ShowFiltersSection", "Filters", 0],
        "obj-toggle-playback-btn": ["ShowPlaybackSection", "Playback", 0],
        "obj-search-clear-btn": ["ClearSearch", "Clr", 0],
        "obj-maxlen-dial": ["MaxLength", "MaxLen", 0],
        "obj-tone-dial": ["ToneFilter", "Tone", 0],
        "obj-filter-tonal-dial": ["TonalFilter", "Tonal", 0],
        "obj-filter-drum-dial": ["DruminessFilter", "Drums", 0],
        "obj-reseed-filtered-btn": ["ReseedFilteredMap", "Re-Seed", 0],
        "obj-pitch-dial": ["PitchTranspose", "Pitch", 0],
        "obj-speed-dial": ["StretchSpeed", "Speed", 0],
        "obj-grain-dial": ["GrainSize", "Grain", 0],
        "obj-decay-dial": ["DecayEnvelope", "Trim/Dec", 0],
        "obj-stretch-mode": ["StretchMode", "Mode", 0],
        "obj-gain-dial": ["PreviewGain", "Gain", 0],
        "obj-reverse-btn": ["ReversePlayback", "Reverse", 0],
        # appended after every existing parameter (order of the others is unchanged)
        "obj-toggle-options-btn": ["ShowOptions", "Options", 0],
        "obj-theme-tab": ["Theme", "Theme", 0],
        "obj-searches-cat": ["Searches Category", "Search Cat", 0],
        "obj-zoom-speed": ["ZoomSpeed", "Zoom Spd", 0],
        "obj-map-samples": ["MapSamples", "Map Smpl", 0]
    }

    # Section layout (src/xo_layouts/<name>.js) is applied by the mini-map v8ui through
    # patcher.getnamed(), so every box it moves needs a scripting name. Boxes that
    # already have one (parameter objects) keep it; the rest use their box id.
    with open(LAYOUT_JS_PATH, "r", encoding="utf-8") as f:
        layout_js_code = f.read()
    themed = bool(getattr(layout, "THEMED", False))
    # The themed layout builds some ids in loops, so tests/test_xo_layout.js
    # compares its ids (and rects, all 32 theme x section combinations) with RECTS / layout_boxes instead.
    layout_ids = set(layout.RECTS) if themed else set(re.findall(r'"(obj-[a-z0-9-]+)": \{ rect:', layout_js_code))
    # Options toggle, Theme selector and their wiring exist in every device; only a themed layout presents them.
    lines.append({"patchline": {"source": ["obj-toggle-options-btn", 0], "destination": ["obj-prep-show-options", 0], "order": 1}})
    lines.append({"patchline": {"source": ["obj-prep-show-options", 0], "destination": ["obj-minimap", 0]}})
    boxes_by_id = {b["box"]["id"]: b["box"] for b in boxes}
    if themed:
        # The layout function (applyXoLayout in the v8ui) is the single authority on visibility: drop the old
        # per-section `prepend hidden` chains. Width comes from pak (saved filters playback options theme) -> expr.
        drop = {"obj-inv-filters", "obj-inv-playback", "obj-prep-hide-filters", "obj-prep-hide-playback"}
        boxes[:] = [b for b in boxes if b["box"]["id"] not in drop]
        lines[:] = [ln for ln in lines if ln["patchline"]["source"][0] not in drop and ln["patchline"]["destination"][0] not in drop]
        boxes_by_id = {b["box"]["id"]: b["box"] for b in boxes}
        boxes_by_id["obj-pak-vis"]["numinlets"] = 5
        d_s, d_f, d_p, d_o = layout.DEFAULT_SECTIONS
        boxes_by_id["obj-pak-vis"]["text"] = "pak %d %d %d %d %d" % (d_s, d_f, d_p, d_o, layout.THEMES.index(layout.DEFAULT_THEME))
        # A new instance starts in layout.DEFAULT_SECTIONS: the toggles' initial values (existing Sets keep what they saved)
        for tid, val in (("obj-toggle-saved-btn", d_s), ("obj-toggle-filters-btn", d_f), ("obj-toggle-playback-btn", d_p)):
            boxes_by_id[tid]["saved_attribute_attributes"]["valueof"]["parameter_initial"] = [val]
        boxes_by_id["obj-expr-width"]["numinlets"] = 5
        boxes_by_id["obj-expr-width"]["patching_rect"][2] = 520.0
        lines.append({"patchline": {"source": ["obj-toggle-options-btn", 0], "destination": ["obj-pak-vis", 3], "order": 0}})
        lines.append({"patchline": {"source": ["obj-theme-tab", 0], "destination": ["obj-pak-vis", 4], "order": 0}})
        lines.append({"patchline": {"source": ["obj-theme-tab", 0], "destination": ["obj-prep-theme", 0], "order": 1}})
        lines.append({"patchline": {"source": ["obj-prep-theme", 0], "destination": ["obj-minimap", 0], "order": 1}})
        lines.append({"patchline": {"source": ["obj-prep-theme", 0], "destination": ["obj-folder-list", 0], "order": 0}})
        lines.append({"patchline": {"source": ["obj-zoom-speed", 0], "destination": ["obj-prep-zoomspeed", 0]}})
        lines.append({"patchline": {"source": ["obj-prep-zoomspeed", 0], "destination": ["obj-minimap", 0]}})
        lines.append({"patchline": {"source": ["obj-map-samples", 0], "destination": ["obj-prep-mapsamples", 0]}})
        lines.append({"patchline": {"source": ["obj-prep-mapsamples", 0], "destination": ["obj-minimap", 0]}})
        # Options > Searches -> v8ui (which owns the terms and tells the node engine)
        for src, dst in (("obj-searches-cat", "obj-prep-terms-cat"), ("obj-searches-terms", "obj-route-terms"),
                         ("obj-route-terms", "obj-prep-terms-text"), ("obj-searches-reset", "obj-prep-terms-reset"),
                         ("obj-searches-folders", "obj-prep-match-folders")):
            lines.append({"patchline": {"source": [src, 0], "destination": [dst, 0]}})
        for prep in ("obj-prep-terms-cat", "obj-prep-terms-text", "obj-prep-terms-reset", "obj-prep-match-folders"):
            lines.append({"patchline": {"source": [prep, 0], "destination": ["obj-minimap", 0]}})
        # themed layouts add their own boxes first (they get their rects below)
        layout.customize(boxes_by_id, boxes, lines)
        boxes_by_id = {b["box"]["id"]: b["box"] for b in boxes}
        for b_ in boxes:   # hidden twin parameters (invisible 2) are listed like every other parameter
            bx = b_["box"]
            if bx["id"].endswith("-mir") and bx.get("parameter_enable") == 1:
                vo = bx["saved_attribute_attributes"]["valueof"]
                parameters_dict[bx["id"]] = [vo["parameter_longname"], vo["parameter_shortname"], 0]
    else:
        for bid in ("obj-toggle-options-btn", "obj-theme-tab", "obj-searches-cat", "obj-searches-terms", "obj-searches-reset",
                    "obj-searches-folders", "obj-zoom-speed", "obj-map-samples"):
            boxes_by_id[bid]["presentation"] = 0
    if set(layout.RECTS) != layout_ids:
        raise SystemExit("layout %s: RECTS ids differ from %s ids: %s" % (
            layout.NAME, layout.LAYOUT_JS, sorted(set(layout.RECTS) ^ layout_ids)))
    for box_id, rect in layout.RECTS.items():
        boxes_by_id[box_id]["presentation_rect"] = [float(v) for v in rect]
    for box_id, attrs in layout.STYLE.items():
        boxes_by_id[box_id].update(attrs)
    if themed:
        for box_id in layout.HIDDEN:
            boxes_by_id[box_id]["hidden"] = 1
    else:
        layout.customize(boxes_by_id, boxes, lines)
    layout_names = {}
    for box_id in sorted(layout_ids) if themed else layout_ids:
        box = boxes_by_id[box_id]
        box.setdefault("varname", box_id)
        layout_names[box_id] = box["varname"]
    palette_js = open(PALETTE_JS_PATH, "r", encoding="utf-8").read()
    if themed:
        palette_js += 'xoPaletteSet("%s");  // the default theme (set_theme switches it)\n' % layout.DEFAULT_THEME
    minimap_text = boxes_by_id["obj-minimap"]["textfile"]
    if themed:   # the v8ui starts in the same section state as the toggles' initial values
        for var, val in zip(("showSavedList", "showFiltersSection", "showPlaybackSection", "showOptionsSection"), layout.DEFAULT_SECTIONS):
            old = "let %s = " % var
            i0 = minimap_text["text"].index(old)
            i1 = minimap_text["text"].index(";", i0)
            minimap_text["text"] = minimap_text["text"][:i0] + old + str(val) + minimap_text["text"][i1:]
    if themed:
        old = "let xoThemeIdx = "
        i0 = minimap_text["text"].index(old)
        i1 = minimap_text["text"].index(";", i0)
        minimap_text["text"] = minimap_text["text"][:i0] + old + str(layout.THEMES.index(layout.DEFAULT_THEME)) + minimap_text["text"][i1:]
    theme_js = ""
    if themed:
        theme_js = f"var XO_THEME_STYLE = {json.dumps(layout.THEME_STYLE)};\n"
    minimap_text["text"] = (
        f"var XO_LAYOUT_NAMES = {json.dumps(layout_names)};\n{theme_js}\n" + palette_js + "\n" + search_js_raw + "\n"
        + layout_js_code + "\n" + minimap_text["text"]
    )
    folder_text = boxes_by_id["obj-folder-list"]["textfile"]
    folder_text["text"] = palette_js + "\n" + folder_text["text"]

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
            "openrect": [0.0, 0.0, layout.DEVICE_WIDTH, 169.0],
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
            "devicewidth": layout.DEVICE_WIDTH,
            "description": "XLN Audio XO-inspired 2D Drum Sample Space Browser & OS File Drag-Out Exporter",
            "digest": "",
            "tags": "M4L Sample Browser XO Drum Map Export",
            "style": "",
            "subpatcher_template": "",
            "title": layout.DEVICE_NAME,
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
                            "PreviewGain"
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

    import sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import theme_common as tc
    tc.inject_theme_support(patcher_doc, "xo_sample_map", assign_varnames=False)

    minify_patcher(patcher_doc)
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
    import argparse
    ap = argparse.ArgumentParser(description="Build devices/XO Sample Map.amxd")
    ap.add_argument("--all", action="store_true", help="accepted for old commands; there are no variants, same as no flag")
    ap.parse_args()
    build()
