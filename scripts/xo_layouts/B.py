"""XO Sample Map layout "B" (devices/XO Sample Map B.amxd; "Value Bars": no dials, narrow live.numbox bar columns).

A layout module is DATA for scripts/build_xo_map.py: where every box sits and how it is styled. Parameters,
long names, ranges, defaults and order are NOT part of a layout (identical in every variant).
Contract: scripts/xo_layouts/README.md.  Variant authors edit only their own scripts/xo_layouts/<V>.py and
src/xo_layouts/<V>.js (+ tsconfig.xo-strip-<V>.json is already provided).
"""

NAME = "B"
DEVICE_NAME = "XO Sample Map B"            # device title, output file devices/<DEVICE_NAME>.amxd, preview slug
LAYOUT_JS = "src/xo_layouts/B.js"  # computeXoLayout geometry, prepended to the mini-map v8ui
DEVICE_WIDTH = 690.0                     # all sections shown; must equal computeXoLayout(1, 1, 1).deviceWidth
# obj-expr-width: device width from the three section toggles ($i1 Saved, $i2 Filters, $i3 Playback).
# Must equal computeXoLayout(...).deviceWidth for all 8 combinations (checked by tests/test_xo_variants.js).
WIDTH_EXPR = "expr 278 + $i1 * 136 + $i2 * 138 + $i3 * 138"

# Presentation rects [x, y, w, h] with all three sections shown. Exactly the keys of computeXoLayout(1,1,1).boxes.
RECTS = {
    "obj-panel-toolbar": [3.0, 5.0, 22.0, 159.0],
    "obj-toggle-saved-btn": [6.0, 9.0, 16.0, 16.0],
    "obj-toggle-filters-btn": [6.0, 28.0, 16.0, 16.0],
    "obj-toggle-playback-btn": [6.0, 47.0, 16.0, 16.0],
    "obj-panel-left": [28.0, 5.0, 380.0, 159.0],
    "obj-minimap": [32.0, 8.0, 372.0, 154.0],
    "obj-panel-filters": [414.0, 5.0, 132.0, 159.0],
    "obj-hdr-filters": [420.0, 6.0, 46.0, 15.0],
    "obj-reseed-filtered-btn": [468.0, 6.0, 46.0, 14.0],
    "obj-search-clear-btn": [516.0, 6.0, 24.0, 14.0],
    "obj-search-box": [420.0, 23.0, 120.0, 14.0],
    "obj-maxlen-dial": [456.0, 40.0, 84.0, 14.0],
    "obj-tone-dial": [456.0, 56.0, 84.0, 14.0],
    "obj-filter-tonal-dial": [456.0, 72.0, 84.0, 14.0],
    "obj-filter-drum-dial": [456.0, 88.0, 84.0, 14.0],
    "obj-folder-list": [420.0, 105.0, 120.0, 54.0],
    "obj-panel-playback": [552.0, 5.0, 132.0, 159.0],
    "obj-hdr-playback": [558.0, 6.0, 80.0, 15.0],
    "obj-reverse-btn": [558.0, 141.0, 120.0, 16.0],
    "obj-pitch-dial": [596.0, 26.0, 82.0, 14.0],
    "obj-speed-dial": [596.0, 45.0, 82.0, 14.0],
    "obj-grain-dial": [596.0, 64.0, 82.0, 14.0],
    "obj-decay-dial": [596.0, 83.0, 82.0, 14.0],
    "obj-stretch-mode": [596.0, 102.0, 82.0, 14.0],
    "obj-gain-dial": [596.0, 121.0, 82.0, 14.0],
}

# Per-box attribute overrides merged into the box after the common build (colours, fonts, pictures, maxclass
# tweaks that keep the same parameter, ...). {box id: {attr: value}}
CYAN = (0.22, 0.74, 0.97)
AMBER = (1.0, 0.694, 0.18)
VIOLET = (0.66, 0.33, 0.97)
GREEN = (0.29, 0.87, 0.50)
BAR_BG = [0.055, 0.068, 0.085, 1.0]
LABEL_COL = [0.60, 0.68, 0.77, 1.0]

# id -> (label scripting name, label text, colour, appearance, section, y of the bar); x of the labels is set by
# the layout script (src/xo_layouts/B.js XO_B_LABELS) at runtime, and here for the all-shown state.
BARS = {
    "obj-maxlen-dial": ("xo-lbl-maxlen", "MaxLen", CYAN, 2, 0),
    "obj-tone-dial": ("xo-lbl-tone", "Tone", CYAN, 3, 0),
    "obj-filter-tonal-dial": ("xo-lbl-tonal", "Tonal", CYAN, 3, 0),
    "obj-filter-drum-dial": ("xo-lbl-drums", "Drums", CYAN, 3, 0),
    "obj-pitch-dial": ("xo-lbl-pitch", "Pitch", AMBER, 3, 1),
    "obj-speed-dial": ("xo-lbl-speed", "Speed", AMBER, 2, 1),
    "obj-grain-dial": ("xo-lbl-grain", "Grain", AMBER, 2, 1),
    "obj-decay-dial": ("xo-lbl-decay", "Trim/Dec", AMBER, 2, 1),
    "obj-stretch-mode": ("xo-lbl-mode", "Mode", VIOLET, 1, 1),
    "obj-gain-dial": ("xo-lbl-gain", "Gain", GREEN, 2, 1),
}


def blend(c):
    """38 % accent + 62 % dark bg, opaque (Live ignores alpha in activeslidercolor; AGENTS.md section 1)."""
    return [round(BAR_BG[i] * 0.62 + c[i] * 0.38, 4) for i in range(3)] + [1.0]


STYLE = {
    "obj-panel-filters": {"bgcolor": [0.085, 0.105, 0.130, 1.0], "bordercolor": [0.18, 0.52, 0.72, 0.5]},
    "obj-panel-playback": {"bgcolor": [0.105, 0.108, 0.120, 1.0], "bordercolor": [0.75, 0.52, 0.15, 0.5]},
    "obj-panel-toolbar": {"bgcolor": [0.085, 0.100, 0.120, 1.0]},
    "obj-panel-left": {"bgcolor": [0.105, 0.122, 0.145, 1.0]},
    "obj-search-box": {"fontsize": 9.0},
    "obj-hdr-filters": {"fontsize": 9.0},
    "obj-hdr-playback": {"fontsize": 9.0},
    "obj-reverse-btn": {"fontsize": 9.0},
}


def customize(boxes_by_id, boxes, lines):
    """Dials -> value bars (same parameters), plus name labels placed in front of the background panels."""
    first_bg = next(i for i, b in enumerate(boxes) if b["box"].get("background") == 1)
    labels = []
    for box_id, (lname, text, col, appearance, section) in BARS.items():
        b = boxes_by_id[box_id]
        b.pop("activedialcolor", None)
        b["maxclass"] = "live.numbox"
        b["appearance"] = appearance
        b["activebgcolor"] = list(BAR_BG)
        b["activeslidercolor"] = blend(col)
        b["bordercolor"] = [0.22, 0.27, 0.33, 1.0]
        b["fontface"] = 1
        b["fontsize"] = 8.5
        b["textcolor"] = [c for c in col] + [1.0]
        x, y, w, h = b["presentation_rect"]
        lx = x - (38.0 if section else 36.0)
        labels.append({"box": {
            "fontface": 1, "fontname": "Arial Bold", "fontsize": 8.0,
            "id": lname, "maxclass": "live.comment", "numinlets": 1, "numoutlets": 0,
            "patching_rect": [lx, 400.0 + len(labels) * 14.0, 38.0, 12.0],
            "presentation": 1, "presentation_rect": [lx, y + 1.0, 38.0 if section else 36.0, 12.0],
            "text": text, "textcolor": list(LABEL_COL), "textjustification": 0, "varname": lname,
        }})
        src = "obj-prep-hide-playback" if section else "obj-prep-hide-filters"
        lines.append({"patchline": {"source": [src, 0], "destination": [lname, 0]}})
    boxes[first_bg:first_bg] = labels
