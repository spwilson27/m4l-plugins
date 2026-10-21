"""XO Sample Map layout "E" -- "Map Focus" (devices/XO Sample Map E.amxd).

The 2D map owns the device (368 px pane + Saved list). Filters and Playback are slim, chrome-light columns:
a coloured header tick, small dials in a 2-wide grid, no bordered panels.
"""

NAME = "E"
DEVICE_NAME = "XO Sample Map E"
LAYOUT_JS = "src/xo_layouts/E.js"
DEVICE_WIDTH = 844.0
WIDTH_EXPR = "expr 410 + $i1 * 136 + $i2 * 140 + $i3 * 158"

RECTS = {
    "obj-panel-toolbar": [3.0, 5.0, 22.0, 159.0],
    "obj-toggle-saved-btn": [6.0, 9.0, 16.0, 16.0],
    "obj-toggle-filters-btn": [6.0, 28.0, 16.0, 16.0],
    "obj-toggle-playback-btn": [6.0, 47.0, 16.0, 16.0],
    "obj-panel-left": [28.0, 5.0, 512.0, 159.0],
    "obj-minimap": [32.0, 8.0, 504.0, 154.0],
    "obj-panel-filters": [546.0, 5.0, 134.0, 159.0],
    "obj-hdr-filters": [557.0, 6.0, 56.0, 15.0],
    "obj-reseed-filtered-btn": [616.0, 7.0, 58.0, 13.0],
    "obj-search-box": [552.0, 22.0, 88.0, 14.0],
    "obj-search-clear-btn": [644.0, 22.0, 30.0, 14.0],
    "obj-maxlen-dial": [550.0, 38.0, 60.0, 40.0],
    "obj-tone-dial": [614.0, 38.0, 60.0, 40.0],
    "obj-filter-tonal-dial": [550.0, 84.0, 60.0, 40.0],
    "obj-filter-drum-dial": [614.0, 84.0, 60.0, 40.0],
    "obj-folder-list": [552.0, 128.0, 122.0, 33.0],
    "obj-panel-playback": [686.0, 5.0, 152.0, 159.0],
    "obj-hdr-playback": [697.0, 6.0, 64.0, 15.0],
    "obj-reverse-btn": [782.0, 7.0, 50.0, 13.0],
    "obj-pitch-dial": [690.0, 30.0, 48.0, 50.0],
    "obj-speed-dial": [738.0, 30.0, 48.0, 50.0],
    "obj-grain-dial": [786.0, 30.0, 48.0, 50.0],
    "obj-decay-dial": [690.0, 92.0, 48.0, 50.0],
    "obj-stretch-mode": [738.0, 92.0, 48.0, 50.0],
    "obj-gain-dial": [786.0, 92.0, 48.0, 50.0],
}

CYAN = [0.22, 0.74, 0.97, 1.0]
AMBER = [1.0, 0.694, 0.18, 1.0]
NONE = [0.0, 0.0, 0.0, 0.0]

BG = [0.085, 0.095, 0.115, 1.0]
STYLE = {
    "obj-panel-toolbar": {"bgcolor": [0.085, 0.095, 0.115, 1.0], "bordercolor": BG, "rounded": 8},
    "obj-panel-left": {"bgcolor": [0.085, 0.095, 0.115, 1.0], "bordercolor": BG, "rounded": 8},
    "obj-panel-filters": {"bgcolor": [0.105, 0.120, 0.140, 1.0], "bordercolor": [0.105, 0.120, 0.140, 1.0], "rounded": 8},
    "obj-panel-playback": {"bgcolor": [0.120, 0.120, 0.130, 1.0], "bordercolor": [0.120, 0.120, 0.130, 1.0], "rounded": 8},
}


def customize(boxes_by_id, boxes, lines):
    """Add a thin coloured header tick to the Filters and Playback columns (presentation-only background panels,
    placed before the section panels so they draw on top; hidden together with their section)."""
    first_bg = next(i for i, b in enumerate(boxes) if b["box"].get("background") == 1)
    for n, (sec, colour) in enumerate((("filters", CYAN), ("playback", AMBER))):
        panel = boxes_by_id["obj-panel-" + sec]
        x, y, w, h = RECTS["obj-panel-" + sec]
        tick = {"box": {
            "angle": 270.0, "background": 1, "bgcolor": colour, "border": 0, "bordercolor": colour,
            "id": "obj-tick-" + sec, "varname": "obj-tick-" + sec, "maxclass": "panel", "mode": 0,
            "numinlets": 1, "numoutlets": 0, "patching_rect": [30.0 + 20 * n, 700.0, 4.0, 14.0],
            "presentation": 1, "presentation_rect": [x - 4.0, y, 2.0, h], "proportion": 0.39, "rounded": 1,
        }}
        boxes.insert(first_bg + n, tick)
        boxes_by_id["obj-tick-" + sec] = tick["box"]
        lines.append({"patchline": {"source": ["obj-prep-hide-" + sec, 0], "destination": ["obj-tick-" + sec, 0], "order": 20 + n}})
