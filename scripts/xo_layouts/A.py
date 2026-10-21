"""XO Sample Map layout "A" (devices/XO Sample Map A.amxd; stub = copy of default, replace it).

A layout module is DATA for scripts/build_xo_map.py: where every box sits and how it is styled. Parameters,
long names, ranges, defaults and order are NOT part of a layout (identical in every variant).
Contract: scripts/xo_layouts/README.md.  Variant authors edit only their own scripts/xo_layouts/<V>.py and
src/xo_layouts/<V>.js (+ tsconfig.xo-strip-<V>.json is already provided).
"""

NAME = "A"
DEVICE_NAME = "XO Sample Map A"            # device title, output file devices/<DEVICE_NAME>.amxd, preview slug
LAYOUT_JS = "src/xo_layouts/A.js"  # computeXoLayout geometry, prepended to the mini-map v8ui
DEVICE_WIDTH = 792.0                     # all sections shown; must equal computeXoLayout(1, 1, 1).deviceWidth
# obj-expr-width: device width from the three section toggles ($i1 Saved, $i2 Filters, $i3 Playback).
WIDTH_EXPR = "expr 278 + $i1 * 136 + $i2 * 211 + $i3 * 167"

FX, PX = 414.0, 625.0
RECTS = {
    "obj-panel-toolbar": [3.0, 5.0, 24.0, 159.0],
    "obj-toggle-saved-btn": [6.0, 9.0, 18.0, 18.0],
    "obj-toggle-filters-btn": [6.0, 31.0, 18.0, 18.0],
    "obj-toggle-playback-btn": [6.0, 53.0, 18.0, 18.0],
    "obj-panel-left": [31.0, 5.0, 380.0, 159.0],
    "obj-minimap": [35.0, 8.0, 372.0, 154.0],
    "obj-panel-filters": [FX, 5.0, 208.0, 159.0],
    "obj-hdr-filters": [FX + 8, 8.0, 70.0, 12.0],
    "obj-reseed-filtered-btn": [FX + 116, 7.0, 50.0, 14.0],
    "obj-search-clear-btn": [FX + 170, 7.0, 30.0, 14.0],
    "obj-search-box": [FX + 8, 25.0, 192.0, 16.0],
    "obj-maxlen-dial": [FX + 8, 44.0, 46.0, 46.0],
    "obj-tone-dial": [FX + 56, 44.0, 46.0, 46.0],
    "obj-filter-tonal-dial": [FX + 104, 44.0, 46.0, 46.0],
    "obj-filter-drum-dial": [FX + 152, 44.0, 46.0, 46.0],
    "obj-folder-list": [FX + 8, 93.0, 192.0, 68.0],
    "obj-panel-playback": [PX, 5.0, 164.0, 159.0],
    "obj-hdr-playback": [PX + 8, 8.0, 80.0, 12.0],
    "obj-reverse-btn": [PX + 104, 7.0, 52.0, 14.0],
    "obj-pitch-dial": [PX + 6, 30.0, 48.0, 46.0],
    "obj-speed-dial": [PX + 58, 30.0, 48.0, 46.0],
    "obj-grain-dial": [PX + 110, 30.0, 48.0, 46.0],
    "obj-decay-dial": [PX + 6, 100.0, 48.0, 46.0],
    "obj-stretch-mode": [PX + 58, 100.0, 48.0, 46.0],
    "obj-gain-dial": [PX + 110, 100.0, 48.0, 46.0],
}

STYLE = {}

# Colour attributes stripped from live.* objects so they follow Live's theme.
_STRIP = ("activebgcolor", "activebgoncolor", "activetextcolor", "activetextoncolor", "bordercolor",
          "activedialcolor", "textcolor", "dialcolor", "tricolor", "needlecolor", "bgcolor", "fontface")


def _theme(box, **attrs):
    saa = box.setdefault("saved_attribute_attributes", {})
    for attr, name in attrs.items():
        saa[attr] = {"expression": "themecolor." + name}


def customize(boxes_by_id, boxes, lines):
    for bid, b in boxes_by_id.items():
        if b.get("maxclass") in ("live.text", "live.dial", "live.comment", "live.menu", "live.numbox"):
            for k in _STRIP:
                b.pop(k, None)
    # small grey caps section titles
    for bid, txt in (("obj-hdr-filters", "FILTERS"), ("obj-hdr-playback", "PLAYBACK")):
        b = boxes_by_id[bid]
        b["text"] = txt
        b["fontsize"] = 8.0
        b["textcolor"] = [0.62, 0.62, 0.62, 1.0]
        _theme(b, textcolor="live_lcd_title")
    # panels: flat, borderless, theme-bound
    for bid, col, name in (("obj-panel-toolbar", [0.26, 0.26, 0.26, 1.0], "live_surface_bg"),
                           ("obj-panel-left", [0.09, 0.09, 0.1, 1.0], "live_lcd_bg"),
                           ("obj-panel-filters", [0.26, 0.26, 0.26, 1.0], "live_surface_bg"),
                           ("obj-panel-playback", [0.26, 0.26, 0.26, 1.0], "live_surface_bg")):
        b = boxes_by_id[bid]
        b["border"] = 0
        b["rounded"] = 4
        b["bgfillcolor"] = {"type": "color", "color": col, "angle": 270.0, "proportion": 0.39, "autogradient": 0}
        b["bgcolor"] = col
        b.pop("bordercolor", None)
        _theme(b, bgfillcolor=name)
    # search box: LCD style
    sb = boxes_by_id["obj-search-box"]
    sb["border"] = 0
    sb["bgcolor"] = [0.09, 0.09, 0.1, 1.0]
    sb["textcolor"] = [0.85, 0.85, 0.85, 1.0]
    sb.pop("bordercolor", None)
    _theme(sb, bgcolor="live_lcd_bg", textcolor="live_lcd_control_fg")
