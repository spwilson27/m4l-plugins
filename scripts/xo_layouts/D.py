"""XO Sample Map layout "D" - "LCD Matrix" (devices/XO Sample Map D.amxd).

Retro hardware-sampler look: every Filters / Playback parameter is a borderless LCD readout (live.numbox
appearance 4, amber on near-black) in a labelled matrix cell; one dark bezel per section, thin grid lines (the
1 px gaps between the dark cells show the bezel colour), small-caps labels, monochrome amber palette plus a dim
variant. Parameters are unchanged (long names, ranges, defaults, order): the dials become numboxes, the enum
(Mode) shows as LCD text. Labels, cell backgrounds and the search prompt are presentation-only extras
("dxf_*" / "dxp_*" scripting names) that src/xo_layouts/D.js moves and hides with their section.
Contract: scripts/xo_layouts/README.md.
"""

NAME = "D"
DEVICE_NAME = "XO Sample Map D"
LAYOUT_JS = "src/xo_layouts/D.js"
DEVICE_WIDTH = 798.0
WIDTH_EXPR = "expr 278 + $i1 * 136 + $i2 * 214 + $i3 * 170"

FX = 414.0   # all-shown x of the Filters section
PX = 628.0   # all-shown x of the Playback section
PB_COL = [4.0, 82.0]
PB_ROW = [25.0, 70.0, 115.0]

RECTS = {
    "obj-panel-toolbar": [3.0, 5.0, 22.0, 159.0],
    "obj-toggle-saved-btn": [6.0, 9.0, 16.0, 16.0],
    "obj-toggle-filters-btn": [6.0, 28.0, 16.0, 16.0],
    "obj-toggle-playback-btn": [6.0, 47.0, 16.0, 16.0],
    "obj-panel-left": [28.0, 5.0, 380.0, 159.0],
    "obj-minimap": [32.0, 8.0, 372.0, 154.0],
    "obj-panel-filters": [FX, 5.0, 208.0, 159.0],
    "obj-hdr-filters": [FX + 7.0, 9.0, 70.0, 13.0],
    "obj-reseed-filtered-btn": [FX + 118.0, 9.0, 52.0, 13.0],
    "obj-search-clear-btn": [FX + 174.0, 9.0, 28.0, 13.0],
    "obj-search-box": [FX + 17.0, 25.0, 186.0, 15.0],
    "obj-maxlen-dial": [FX + 5.0, 59.0, 47.0, 22.0],
    "obj-tone-dial": [FX + 55.0, 59.0, 47.0, 22.0],
    "obj-filter-tonal-dial": [FX + 105.0, 59.0, 47.0, 22.0],
    "obj-filter-drum-dial": [FX + 155.0, 59.0, 48.0, 22.0],
    "obj-folder-list": [FX + 4.0, 86.0, 200.0, 74.0],
    "obj-panel-playback": [PX, 5.0, 164.0, 159.0],
    "obj-hdr-playback": [PX + 7.0, 9.0, 80.0, 13.0],
    "obj-reverse-btn": [PX + 106.0, 9.0, 52.0, 13.0],
    "obj-pitch-dial": [PX + PB_COL[0] + 1.0, PB_ROW[0] + 19.0, 75.0, 20.0],
    "obj-speed-dial": [PX + PB_COL[1] + 1.0, PB_ROW[0] + 19.0, 76.0, 20.0],
    "obj-grain-dial": [PX + PB_COL[0] + 1.0, PB_ROW[1] + 19.0, 75.0, 20.0],
    "obj-decay-dial": [PX + PB_COL[1] + 1.0, PB_ROW[1] + 19.0, 76.0, 20.0],
    "obj-stretch-mode": [PX + PB_COL[0] + 1.0, PB_ROW[2] + 19.0, 75.0, 20.0],
    "obj-gain-dial": [PX + PB_COL[1] + 1.0, PB_ROW[2] + 19.0, 76.0, 20.0],
}

# --- palette: one amber accent, a dim variant, near-black glass, a brown grid colour ---
ACC = [1.0, 0.70, 0.10, 1.0]
DIM = [0.62, 0.41, 0.07, 1.0]
FAINT = [0.40, 0.27, 0.05, 1.0]
GLASS = [0.030, 0.026, 0.016, 1.0]
GRID = [0.165, 0.110, 0.030, 1.0]
EDGE = [0.50, 0.33, 0.06, 1.0]
MONO = "Menlo"

NUMBOXES = ["obj-maxlen-dial", "obj-tone-dial", "obj-filter-tonal-dial", "obj-filter-drum-dial",
            "obj-pitch-dial", "obj-speed-dial", "obj-grain-dial", "obj-decay-dial", "obj-stretch-mode", "obj-gain-dial"]

_LCD_BTN = {
    "activebgcolor": GLASS, "activebgoncolor": ACC, "activetextcolor": ACC, "activetextoncolor": GLASS,
    "bordercolor": EDGE, "textcolor": ACC, "fontname": MONO, "fontface": 1, "fontsize": 8.0,
}
_TOOL_BTN = {
    "activebgcolor": GLASS, "activebgoncolor": ACC, "activetextcolor": DIM, "activetextoncolor": GLASS,
    "bordercolor": EDGE,
}
STYLE = {
    "obj-panel-toolbar": {"bgcolor": GLASS, "bordercolor": EDGE, "rounded": 4},
    "obj-panel-left": {"bgcolor": GLASS, "bordercolor": EDGE, "rounded": 4},
    "obj-panel-filters": {"bgcolor": GRID, "bordercolor": EDGE, "rounded": 4},
    "obj-panel-playback": {"bgcolor": GRID, "bordercolor": EDGE, "rounded": 4},
    "obj-toggle-saved-btn": dict(_TOOL_BTN),
    "obj-toggle-filters-btn": dict(_TOOL_BTN),
    "obj-toggle-playback-btn": dict(_TOOL_BTN),
    "obj-hdr-filters": {"textcolor": ACC, "fontname": MONO, "fontface": 1, "fontsize": 9.0},
    "obj-hdr-playback": {"textcolor": ACC, "fontname": MONO, "fontface": 1, "fontsize": 9.0},
    "obj-reseed-filtered-btn": dict(_LCD_BTN, text="RESEED", texton="RESEED"),
    "obj-search-clear-btn": dict(_LCD_BTN, text="CLR", texton="CLR"),
    "obj-reverse-btn": dict(_LCD_BTN, text="FWD", texton="REV"),
    "obj-search-box": {"bgcolor": GLASS, "border": 0.0, "bordercolor": GLASS, "textcolor": ACC,
                       "fontname": MONO, "fontsize": 9.0},
}


def _numbox(box):
    """live.dial -> live.numbox, LCD look (appearance 4); the parameter (valueof) is untouched."""
    box["maxclass"] = "live.numbox"
    box.pop("activedialcolor", None)
    box.update({
        "appearance": 4,
        "activebgcolor": GLASS, "bgcolor": GLASS, "lcdbgcolor": GLASS,
        "lcdcolor": ACC, "textcolor": ACC, "inactivelcdcolor": FAINT,
        "bordercolor": GLASS, "focusbordercolor": ACC,
        "fontname": MONO, "fontface": 1, "fontsize": 12.0,
    })


def _comment(oid, text, rect, color, size=7.0, just=1):
    x, y, w, h = rect
    return {"box": {
        "fontface": 1, "fontname": MONO, "fontsize": size, "id": oid, "maxclass": "live.comment",
        "numinlets": 1, "numoutlets": 0, "patching_rect": [x, 700.0 + y, w, h],
        "presentation": 1, "presentation_rect": [x, y, w, h],
        "text": text, "textcolor": color, "textjustification": just, "varname": oid,
    }}


def _cell(oid, rect):
    x, y, w, h = rect
    return {"box": {
        "angle": 270.0, "background": 1, "bgcolor": GLASS, "border": 0, "bordercolor": GLASS, "id": oid,
        "maxclass": "panel", "mode": 0, "numinlets": 1, "numoutlets": 0,
        "patching_rect": [x, 800.0 + y, w, h], "presentation": 1, "presentation_rect": [x, y, w, h],
        "proportion": 0.39, "rounded": 0, "varname": oid,
    }}


def customize(boxes_by_id, boxes, lines):
    for bid in NUMBOXES:
        _numbox(boxes_by_id[bid])

    labels, cells = [], []
    # Filters: title cell, search cell (+ prompt), four value cells.
    cells.append(_cell("dxf_cell_title", [FX + 4.0, 8.0, 200.0, 15.0]))
    cells.append(_cell("dxf_cell_search", [FX + 4.0, 24.0, 200.0, 17.0]))
    labels.append(_comment("dxf_prompt", ">", [FX + 5.0, 26.0, 11.0, 13.0], ACC, 9.0, 1))
    fcols = [(4.0, 49.0, "MAXLEN"), (54.0, 49.0, "TONE"), (104.0, 49.0, "TONAL"), (154.0, 50.0, "DRUMS")]
    for i, (dx, w, name) in enumerate(fcols):
        cells.append(_cell("dxf_cell_%d" % i, [FX + dx, 42.0, w, 42.0]))
        labels.append(_comment("dxf_lbl_%d" % i, name, [FX + dx, 46.0, w, 11.0], DIM))
    # Playback: title cell, 2 x 3 value cells.
    cells.append(_cell("dxp_cell_title", [PX + 4.0, 8.0, 156.0, 15.0]))
    pnames = ["PITCH", "SPEED", "GRAIN", "TRIM/DEC", "MODE", "GAIN"]
    for i, name in enumerate(pnames):
        col, row = i % 2, i // 2
        w = 77.0 if col == 0 else 78.0
        cells.append(_cell("dxp_cell_%d" % i, [PX + PB_COL[col], PB_ROW[row], w, 44.0]))
        labels.append(_comment("dxp_lbl_%d" % i, name, [PX + PB_COL[col], PB_ROW[row] + 5.0, w, 11.0], DIM))

    first_bg = next(i for i, b in enumerate(boxes) if b["box"].get("background") == 1)
    boxes[first_bg:first_bg] = labels + cells   # foreground labels, then cell panels above the section bezels
