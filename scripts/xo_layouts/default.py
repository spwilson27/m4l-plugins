"""XO Sample Map layout "default" (the main device, devices/XO Sample Map.amxd): ONE device, two switchable looks.

Themes (Options section > Theme, Live parameter `Theme`, default LCD):
  LCD    retro hardware-sampler look (the former variant D): amber live.numbox LCD readouts in a labelled matrix,
         dark bezels, LCD buttons.
  Focus  slim Filters / Playback columns of small live.dial grids with coloured edge ticks (the former variant E's
         columns) around the same-size map.

How the switch works (details: AGENTS.md section 4):
  * Geometry is `computeXoLayout(theme, saved, filters, playback, options)` in src/xo_layouts/default.js; this file holds
    its Python mirror (`layout_boxes`, used for the saved / default state; tests/test_xo_variants.js compares the two for
    every theme x section combination), the per-theme colours / fonts / texts (`THEME_STYLE`, injected into the v8ui as
    XO_THEME_STYLE and applied with setattr when the theme changes), and the presentation-only extras.
  * Each themed parameter has ONE parameter object (a live.numbox: automation, mapping and presets work on it) plus a
    non-parameter live.dial mirror (`<id>-mir`). The parameter object outputs into `prepend set` -> the mirror (silent);
    the mirror outputs into the parameter object, which then re-sets the mirror silently. The layout shows the numbox in
    LCD and the mirror in Focus.
  * Theme-specific labels, cells, bezels and ticks are separate presentation boxes shown / hidden by the layout.
Contract: scripts/xo_layouts/README.md.
"""

import re

NAME = "default"
DEVICE_NAME = "XO Sample Map"            # device title, output file devices/<DEVICE_NAME>.amxd, preview slug
LAYOUT_JS = "src/xo_layouts/default.js"  # computeXoLayout geometry, prepended to the mini-map v8ui
THEMED = True
THEMES = ["LCD", "Focus", "Live"]
DEFAULT_THEME = "Live"                  # the Theme parameter's initial value for NEW instances (saved sets keep their index)
DEFAULT_SECTIONS = (1, 0, 0, 0)          # a NEW instance starts with the toolbar, map and Saved list only (Filters / Playback / Options closed)
DEVICE_WIDTH = 414.0                     # DEFAULT_THEME, DEFAULT_SECTIONS; must equal computeXoLayout("Live", 1, 0, 0, 0).deviceWidth
# obj-expr-width: device width from pak (saved filters playback options theme) = $i1 .. $i5 (theme 0 = LCD, 1 = Focus, 2 = Live).
# Must equal computeXoLayout(...).deviceWidth for every theme x 16 section combinations (tests/test_xo_variants.js).
WIDTH_EXPR = ("expr 278 + $i1 * 136 + $i4 * 196 + $i2 * 214 + $i3 * (170 - 12 * ($i5 > 0))")
# (no if(): a comma inside an expr box has to be escaped in Max; Playback is 12 px narrower in Focus and Live,
#  `($i5 > 0)` is 0 for LCD and 1 for Focus / Live; Filters are 208 px in every theme)

# ---------------------------------------------------------------------------------------------------------------
# Geometry (mirror of src/xo_layouts/default.js)
# ---------------------------------------------------------------------------------------------------------------
XO_TB_X, XO_TB_W, XO_LEFT_X, XO_GAP = 3.0, 22.0, 28.0, 6.0
XO_MAP_PANE_W, XO_SAVED_PANE_W, XO_OPTIONS_W = 236.0, 136.0, 190.0
XO_FILTERS_W = {"LCD": 208.0, "Focus": 208.0, "Live": 208.0}
def label_h(bid, th):
    """Live's fixed live.comment height, floor(font + 8), for the label's font in theme th (src/xo_layouts/default.js xoLabelH)."""
    if th == "Live" and not re.match(r"obj-lcd-[fp]-lbl-", bid):  # Ableton Sans Medium rounds up (measured in Live 12.4.6: 9.5 pt -> 18, 9 / 8.5 pt -> 17)
        return 18.0 if (bid.startswith("obj-hdr-") or bid == "obj-lbl-searches") else 17.0
    if bid.startswith("obj-lbl-"):
        return 15.0 if th == "LCD" else 17.0
    if re.match(r"obj-lcd-[fp]-lbl-", bid):
        return 15.0
    if re.match(r"obj-focus-[fp]-lbl-", bid):
        return 16.0
    return 17.0


LABEL_RE = re.compile(r"^obj-(hdr-|lbl-|lcd-[fp]-lbl-|focus-[fp]-lbl-|lcd-f-prompt$)")
XO_PLAYBACK_W = {"LCD": 164.0, "Focus": 152.0, "Live": 152.0}
LCD_PB_COL = [4.0, 82.0]
LCD_PB_ROW = [25.0, 70.0, 115.0]
LCD_PB_W = [77.0, 78.0]
LCD_F_COL = [(4.0, 49.0), (54.0, 49.0), (104.0, 49.0), (154.0, 50.0)]
FOCUS_F = [(6.0, 50.0), (55.0, 50.0), (104.0, 50.0), (153.0, 50.0)]  # one row of four 48 px dials (a second row put a dial value right above the next label)

F_IDS = ["maxlen", "tone", "filter-tonal", "filter-drum"]
F_LCD_NAMES = ["MAXLEN", "TONE", "TONAL", "DRUMS"]
F_FOCUS_NAMES = ["MaxLen", "Tone", "Tonal", "Drums"]
P_OBJ = ["obj-pitch-dial", "obj-speed-dial", "obj-grain-dial", "obj-decay-dial", "obj-stretch-mode", "obj-gain-dial"]
P_LCD_NAMES = ["PITCH", "SPEED", "GRAIN", "TRIM/DEC", "MODE", "GAIN"]
P_FOCUS_NAMES = ["Pitch", "Speed", "Grain", "Trim/Dec", "Mode", "Gain"]
# parameter objects that get a mirror: the 4 Filters + 6 Playback value controls
PARAM_OBJ = ["obj-%s-dial" % k for k in F_IDS] + P_OBJ


def layout_boxes(theme, s, f, p, o):
    """{box id: (rect, hidden, section, theme-only or "")} in layout order for (theme, saved, filters, playback, options)."""
    th = theme
    lcd = th == "LCD"
    live = th == "Live"
    map_w = XO_MAP_PANE_W + (XO_SAVED_PANE_W if s else 0.0)
    left_w = map_w + 8.0
    cur = XO_LEFT_X
    ox = cur
    if o:
        cur += XO_OPTIONS_W + XO_GAP
    lx = cur
    cur += left_w + XO_GAP
    fx = cur
    fw = XO_FILTERS_W[th]
    if f:
        cur += fw + XO_GAP
    px = cur
    pw = XO_PLAYBACK_W[th]
    if p:
        cur += pw + XO_GAP
    out = {}

    def only_ok(only):
        """Mirror of xoOnlyOk: "" = every theme; "Dials" = Focus and Live; else that theme only."""
        return (not only) or (th != "LCD" if only == "Dials" else only == th)

    def put(bid, sec, only, rect):
        if LABEL_RE.match(bid):  # Live's own live.comment height for this theme's font
            rect = [rect[0], rect[1], rect[2], label_h(bid, th)]
        sec_on = {"filters": f, "playback": p, "options": o}.get(sec, 1)
        out[bid] = ([float(v) for v in rect], 0 if (sec_on and only_ok(only)) else 1, sec, only)

    put("obj-panel-toolbar", "toolbar", "", [XO_TB_X, 5.0, XO_TB_W, 159.0])
    put("obj-toggle-saved-btn", "toolbar", "", [XO_TB_X + 3.0, 9.0, 16.0, 16.0])
    put("obj-toggle-filters-btn", "toolbar", "", [XO_TB_X + 3.0, 28.0, 16.0, 16.0])
    put("obj-toggle-playback-btn", "toolbar", "", [XO_TB_X + 3.0, 47.0, 16.0, 16.0])
    put("obj-toggle-options-btn", "toolbar", "", [XO_TB_X + 3.0, 145.0, 16.0, 16.0])
    put("obj-panel-options", "options", "", [ox, 5.0, XO_OPTIONS_W, 159.0])
    put("obj-hdr-options", "options", "", [ox + 7.0, 6.0 if live else 8.0, 82.0, 14.0])
    put("obj-rule-options", "options", "Live", [ox + 52.0, 12.0, 132.0, 5.0])
    put("obj-lbl-theme", "options", "", [ox + 7.0, 30.0, 70.0, 11.0])
    put("obj-theme-tab", "options", "", [ox + 6.0, 44.0, 86.0, 18.0])
    put("obj-lbl-zoom", "options", "", [ox + 95.0, 30.0, 38.0, 11.0])
    put("obj-zoom-speed", "options", "", [ox + 95.0, 44.0, 38.0, 18.0])
    put("obj-lbl-map", "options", "", [ox + 136.0, 30.0, 50.0, 11.0])
    put("obj-map-samples", "options", "", [ox + 136.0, 44.0, 50.0, 18.0])
    put("obj-lbl-searches", "options", "", [ox + 7.0, 68.0, 178.0, 11.0])
    put("obj-rule-searches", "options", "Live", [ox + 54.0, 74.0, 130.0, 5.0])
    put("obj-searches-cat", "options", "", [ox + 6.0, 80.0, 178.0, 15.0])
    put("obj-searches-terms", "options", "", [ox + 6.0, 97.0, 178.0, 40.0])
    put("obj-searches-reset", "options", "", [ox + 6.0, 141.0, 44.0, 16.0])
    put("obj-searches-folders", "options", "", [ox + 54.0, 141.0, 100.0, 16.0])
    put("obj-panel-left", "left", "", [lx, 5.0, left_w, 159.0])
    put("obj-minimap", "left", "", [lx + 4.0, 8.0, map_w, 154.0])

    put("obj-panel-filters", "filters", "", [fx, 5.0, fw, 159.0])
    put("obj-hdr-filters", "filters", "", [fx + 7.0, 9.0, 70.0, 13.0] if lcd else ([fx + 4.0, 6.0, 56.0, 15.0] if live else [fx + 11.0, 6.0, 56.0, 15.0]))
    put("obj-rule-filters", "filters", "Live", [fx + 42.0, 12.0, 100.0, 5.0])
    put("obj-reseed-filtered-btn", "filters", "", [fx + 118.0, 9.0, 52.0, 13.0] if lcd else [fx + 146.0, 7.0, 56.0, 13.0])
    put("obj-search-clear-btn", "filters", "", [fx + 174.0, 9.0, 28.0, 13.0] if lcd else [fx + 160.0, 22.0, 42.0, 14.0])
    put("obj-search-box", "filters", "", [fx + 17.0, 25.0, 186.0, 15.0] if lcd else [fx + 6.0, 22.0, 150.0, 14.0])
    put("obj-folder-list", "filters", "", [fx + 4.0, 86.0, 200.0, 74.0] if lcd else [fx + 6.0, 92.0, 196.0, 68.0])
    for i in range(4):
        put("obj-%s-dial" % F_IDS[i], "filters", "LCD", [fx + LCD_F_COL[i][0] + 1.0, 59.0, LCD_F_COL[i][1] - 2.0, 22.0])
        put("obj-%s-dial-mir" % F_IDS[i], "filters", "Dials", [fx + FOCUS_F[i][0], FOCUS_F[i][1], 48.0, 37.0])  # Live's live.dial height for this size
        put("obj-lcd-f-cell-%d" % i, "filters", "LCD", [fx + LCD_F_COL[i][0], 42.0, LCD_F_COL[i][1], 42.0])
        put("obj-lcd-f-lbl-%d" % i, "filters", "LCD", [fx + LCD_F_COL[i][0], 46.0, LCD_F_COL[i][1], 11.0])
        put("obj-focus-f-lbl-%d" % i, "filters", "Dials", [fx + FOCUS_F[i][0], FOCUS_F[i][1] - 10.0, 48.0, 10.0])
    put("obj-lcd-f-cell-title", "filters", "LCD", [fx + 4.0, 8.0, 200.0, 15.0])
    put("obj-lcd-f-cell-search", "filters", "LCD", [fx + 4.0, 24.0, 200.0, 17.0])
    put("obj-lcd-f-prompt", "filters", "LCD", [fx + 3.5, 24.0, 14.0, 15.0])  # 1 px above obj-search-box; 14 px = Live's minimum width, centred where the 11 px box was
    put("obj-focus-tick-filters", "filters", "Focus", [fx - 5.0, 5.0, 4.0, 159.0])  # Live's minimum panel width, centred in the gap

    put("obj-panel-playback", "playback", "", [px, 5.0, pw, 159.0])
    put("obj-hdr-playback", "playback", "", [px + 7.0, 9.0, 80.0, 13.0] if lcd else ([px + 4.0, 6.0, 64.0, 15.0] if live else [px + 11.0, 6.0, 64.0, 15.0]))
    put("obj-rule-playback", "playback", "Live", [px + 54.0, 12.0, 38.0, 5.0])
    put("obj-reverse-btn", "playback", "", [px + 106.0, 9.0, 52.0, 13.0] if lcd else [px + 96.0, 7.0, 50.0, 13.0])
    for i in range(6):
        lc, lr = i % 2, i // 2
        fc, fr = i % 3, i // 3
        fdx = 4.0 + fc * 48.0
        fdy = 102.0 if fr else 40.0
        put(P_OBJ[i], "playback", "LCD", [px + LCD_PB_COL[lc] + 1.0, LCD_PB_ROW[lr] + 19.0, 76.0 if lc else 75.0, 20.0])
        put(P_OBJ[i] + "-mir", "playback", "Dials", [px + fdx, fdy, 48.0, 37.0])  # Live's live.dial height for this size
        put("obj-lcd-p-cell-%d" % i, "playback", "LCD", [px + LCD_PB_COL[lc], LCD_PB_ROW[lr], LCD_PB_W[lc], 44.0])
        put("obj-lcd-p-lbl-%d" % i, "playback", "LCD", [px + LCD_PB_COL[lc], LCD_PB_ROW[lr] + 5.0, LCD_PB_W[lc], 11.0])
        put("obj-focus-p-lbl-%d" % i, "playback", "Dials", [px + fdx, fdy - 10.0, 48.0, 10.0])
    put("obj-lcd-p-cell-title", "playback", "LCD", [px + 4.0, 8.0, 156.0, 15.0])
    put("obj-focus-tick-playback", "playback", "Focus", [px - 5.0, 5.0, 4.0, 159.0])  # Live's minimum panel width, centred in the gap
    return out, cur


_ALL, _W = layout_boxes(DEFAULT_THEME, *DEFAULT_SECTIONS)
assert _W == DEVICE_WIDTH
# Presentation rects of every layout box in the saved / default state (DEFAULT_THEME, DEFAULT_SECTIONS).
RECTS = {bid: v[0] for bid, v in _ALL.items()}
# Boxes hidden in that state (the other themes' boxes and the closed Filters / Playback / Options sections).
HIDDEN = sorted(bid for bid, v in _ALL.items() if v[1])


def dump_layouts():
    """JSON-able {"theme/s/f/p/o": {"width": w, "boxes": {id: [rect, hidden]}}} for every combination (for the host test)."""
    res = {}
    for th in THEMES:
        for n in range(16):
            s, f, p, o = n & 1, (n >> 1) & 1, (n >> 2) & 1, (n >> 3) & 1
            boxes, w = layout_boxes(th, s, f, p, o)
            res["%s/%d/%d/%d/%d" % (th, s, f, p, o)] = {"width": w, "boxes": {k: [v[0], v[1]] for k, v in boxes.items()}}
    return res


# ---------------------------------------------------------------------------------------------------------------
# Per-theme style: {theme: {box id: {attribute: value}}}. Applied statically for the saved state (LCD) and by the v8ui
# with setattr when the theme changes (injected as XO_THEME_STYLE). Arrays are colours / lists (setattr takes them as
# separate arguments).
# ---------------------------------------------------------------------------------------------------------------
# LCD palette (the former variant D)
ACC = [1.0, 0.70, 0.10, 1.0]
DIM = [0.62, 0.41, 0.07, 1.0]
FAINT = [0.40, 0.27, 0.05, 1.0]
GLASS = [0.030, 0.026, 0.016, 1.0]
GRID = [0.165, 0.110, 0.030, 1.0]
EDGE = [0.50, 0.33, 0.06, 1.0]
MONO = "Menlo"
# Focus palette (the original blue look, the former variant E's panels)
CYAN = [0.22, 0.74, 0.97, 1.0]
AMBER = [1.0, 0.694, 0.18, 1.0]
GREEN = [0.29, 0.87, 0.50, 1.0]
VIOLET = [0.66, 0.40, 0.97, 1.0]
INK = [0.06, 0.08, 0.10, 1.0]
BTN = [0.14, 0.17, 0.21, 1.0]
BTN_TEXT = [0.75, 0.80, 0.86, 1.0]
BTN_EDGE = [0.32, 0.38, 0.46, 1.0]
UI_FONT = "Ableton Sans Medium"

_LCD_BTN = {
    "activebgcolor": GLASS, "activebgoncolor": ACC, "activetextcolor": ACC, "activetextoncolor": GLASS,
    "bordercolor": EDGE, "textcolor": ACC, "fontname": MONO, "fontface": 1, "fontsize": 8.0,
}
_LCD_TOOL = {
    "activebgcolor": GLASS, "activebgoncolor": ACC, "activetextcolor": DIM, "activetextoncolor": GLASS, "bordercolor": EDGE,
}
_LCD_HDR = {"textcolor": ACC, "fontname": MONO, "fontface": 1, "fontsize": 9.0}
_LCD_NUMBOX = {
    "appearance": 4,
    "activebgcolor": GLASS, "bgcolor": GLASS, "lcdbgcolor": GLASS,
    "lcdcolor": ACC, "textcolor": ACC, "inactivelcdcolor": FAINT,
    "bordercolor": GLASS, "focusbordercolor": ACC,
    # 10 pt: Live drops a numbox's unit when its WIDEST value string ("-100 %", "5.00 s") does not fit the cell,
    # which at 12 pt in the 47 px filter cells showed bare "0.00" / "5.00" (tests/test_xo_map.js checks the fit).
    "fontname": MONO, "fontface": 1, "fontsize": 10.0,
}
_FOCUS_TOOL = {"activebgcolor": BTN, "activetextcolor": BTN_TEXT, "activetextoncolor": INK, "bordercolor": BTN_EDGE}
_FOCUS_HDR = {"fontname": "Arial", "fontface": 1, "fontsize": 9.5}


def _focus_btn(on, text, texton, **extra):
    d = {"activebgcolor": BTN, "activebgoncolor": on, "activetextcolor": on, "activetextoncolor": INK,
         "bordercolor": on[:3] + [0.75], "fontname": UI_FONT, "fontface": 0, "fontsize": 9.0, "text": text, "texton": texton}
    d.update(extra)
    d["textcolor"] = d["activetextcolor"]
    return d


# Live palette: Ableton's own devices (section 22 "Ableton-native look", Harmonic Split / Reverb / Echo). Values are theme
# colour TOKENS "@live_<name>" (max.getcolor name): the v8ui resolves them with max.getcolor on theme select / load / when
# Live's theme changes (Live-default-dark fallbacks: src/xo_palette.js XO_LIVE_FALLBACK, also what the preview and the node
# tests use), because setattr replaces a saved themecolor binding. Literal lists pass through (alpha 0 = no background).
CLEAR = [0.0, 0.0, 0.0, 0.0]
LIVE_FONT = "Ableton Sans Medium"


def _live_btn(text):
    """Plain live.text in Live's button colours (Harmonic Split's Post / Size look): control fill, control text, the LCD frame as
    border; only an ON toggle takes the accent (fill live_control_selection, dark text)."""
    d = {"activebgcolor": "@live_control_bg", "activebgoncolor": "@live_control_selection", "activetextcolor": "@live_control_fg",
         "activetextoncolor": "@live_lcd_bg", "bordercolor": "@live_lcd_frame"}
    d.update({"fontname": LIVE_FONT, "fontface": 0, "fontsize": 9.0, "text": text, "texton": text, "textcolor": "@live_control_fg"})
    return d


_LIVE_PANEL = {"bgcolor": "@live_desktop", "bordercolor": "@live_desktop", "rounded": 3}
_LIVE_TOOL = {"activebgcolor": "@live_control_bg", "activebgoncolor": "@live_control_selection", "activetextcolor": "@live_control_fg",
              "activetextoncolor": "@live_lcd_bg", "bordercolor": "@live_control_bg"}
_LIVE_TITLE = {"textcolor": "@live_lcd_title", "fontname": LIVE_FONT, "fontface": 0, "fontsize": 9.5}
_LIVE_LABEL = {"textcolor": "@live_control_fg", "fontname": LIVE_FONT, "fontface": 0, "fontsize": 9.0}
_LIVE_VALUE = {"appearance": 4, "activebgcolor": CLEAR, "bgcolor": CLEAR, "lcdbgcolor": CLEAR, "lcdcolor": "@live_lcd_control_fg_alt",
               "textcolor": "@live_lcd_control_fg_alt", "inactivelcdcolor": "@live_control_zombie", "bordercolor": CLEAR,
               "focusbordercolor": "@live_control_selection", "fontname": LIVE_FONT, "fontface": 0, "fontsize": 9.0}
_LIVE_FIELD = {"bgcolor": "@live_lcd_bg", "border": 1.0, "bordercolor": "@live_lcd_frame", "textcolor": "@live_control_fg",
               "fontname": LIVE_FONT, "fontsize": 9.0}

LIVE_STYLE = {
    "obj-panel-toolbar": dict(_LIVE_PANEL),
    "obj-panel-left": dict(_LIVE_PANEL),
    "obj-panel-options": dict(_LIVE_PANEL),
    "obj-panel-filters": dict(_LIVE_PANEL),
    "obj-panel-playback": dict(_LIVE_PANEL),
    "obj-toggle-saved-btn": dict(_LIVE_TOOL),
    "obj-toggle-filters-btn": dict(_LIVE_TOOL),
    "obj-toggle-playback-btn": dict(_LIVE_TOOL),
    "obj-toggle-options-btn": dict(_LIVE_TOOL),
    "obj-hdr-options": dict(_LIVE_TITLE),
    "obj-hdr-filters": dict(_LIVE_TITLE),
    "obj-hdr-playback": dict(_LIVE_TITLE),
    "obj-rule-options": {"linecolor": "@live_lcd_frame"},
    "obj-rule-searches": {"linecolor": "@live_lcd_frame"},
    "obj-rule-filters": {"linecolor": "@live_lcd_frame"},
    "obj-rule-playback": {"linecolor": "@live_lcd_frame"},
    "obj-lbl-theme": dict(_LIVE_LABEL),
    "obj-theme-tab": {"activebgcolor": "@live_control_bg", "activebgoncolor": "@live_control_selection", "activetextcolor": "@live_control_fg",
                      "activetextoncolor": "@live_lcd_bg", "bordercolor": "@live_desktop", "fontname": LIVE_FONT, "fontface": 0, "fontsize": 8.5},
    "obj-lbl-zoom": dict(_LIVE_LABEL),
    "obj-zoom-speed": dict(_LIVE_VALUE),
    "obj-lbl-map": dict(_LIVE_LABEL),
    "obj-map-samples": dict(_LIVE_VALUE),
    "obj-lbl-searches": dict(_LIVE_TITLE),
    "obj-searches-cat": {"activebgcolor": "@live_control_bg", "bordercolor": "@live_control_bg", "textcolor": "@live_control_fg",
                         "fontname": LIVE_FONT, "fontface": 0, "fontsize": 9.0},
    "obj-searches-terms": dict(_LIVE_FIELD),
    "obj-searches-reset": _live_btn("Reset"),
    "obj-searches-folders": _live_btn("Match folders"),
    "obj-reseed-filtered-btn": _live_btn("Re-Seed"),
    "obj-search-clear-btn": _live_btn("Clr"),
    "obj-reverse-btn": _live_btn("Reverse"),
    "obj-search-box": dict(_LIVE_FIELD),
    **{"obj-focus-%s-lbl-%d" % (sec, i): {"textcolor": "@live_control_fg", "fontname": LIVE_FONT, "fontface": 0, "fontsize": 8.5}
       for sec, n in (("f", 4), ("p", 6)) for i in range(n)},
}



THEME_STYLE = {
    "LCD": {
        "obj-panel-toolbar": {"bgcolor": GLASS, "bordercolor": EDGE, "rounded": 4},
        "obj-panel-left": {"bgcolor": GLASS, "bordercolor": EDGE, "rounded": 4},
        "obj-panel-options": {"bgcolor": GRID, "bordercolor": EDGE, "rounded": 4},
        "obj-panel-filters": {"bgcolor": GRID, "bordercolor": EDGE, "rounded": 4},
        "obj-panel-playback": {"bgcolor": GRID, "bordercolor": EDGE, "rounded": 4},
        "obj-toggle-saved-btn": dict(_LCD_TOOL),
        "obj-toggle-filters-btn": dict(_LCD_TOOL),
        "obj-toggle-playback-btn": dict(_LCD_TOOL),
        "obj-toggle-options-btn": dict(_LCD_TOOL),
        "obj-hdr-options": dict(_LCD_HDR),
        "obj-hdr-filters": dict(_LCD_HDR),
        "obj-hdr-playback": dict(_LCD_HDR),
        "obj-lbl-theme": {"textcolor": DIM, "fontname": MONO, "fontface": 1, "fontsize": 7.0},
        "obj-theme-tab": {"activebgcolor": GLASS, "activebgoncolor": ACC, "activetextcolor": ACC, "activetextoncolor": GLASS,
                          "bordercolor": EDGE, "fontname": MONO, "fontface": 1, "fontsize": 8.0},
        "obj-lbl-zoom": {"textcolor": DIM, "fontname": MONO, "fontface": 1, "fontsize": 7.0},
        "obj-zoom-speed": dict(_LCD_NUMBOX, fontsize=9.0),
        "obj-lbl-map": {"textcolor": DIM, "fontname": MONO, "fontface": 1, "fontsize": 7.0},
        "obj-map-samples": dict(_LCD_NUMBOX, fontsize=9.0),
        "obj-lbl-searches": {"textcolor": DIM, "fontname": MONO, "fontface": 1, "fontsize": 7.0},
        "obj-searches-cat": {"activebgcolor": GLASS, "bordercolor": EDGE, "textcolor": ACC, "fontname": MONO, "fontface": 1, "fontsize": 8.0},
        "obj-searches-terms": {"bgcolor": GLASS, "border": 1.0, "bordercolor": EDGE, "textcolor": ACC, "fontname": MONO, "fontsize": 8.0},
        "obj-searches-reset": dict(_LCD_BTN, text="RESET", texton="RESET"),
        "obj-searches-folders": dict(_LCD_BTN, text="MATCH FOLDERS", texton="MATCH FOLDERS", fontsize=7.0),
        "obj-reseed-filtered-btn": dict(_LCD_BTN, text="RESEED", texton="RESEED"),
        "obj-search-clear-btn": dict(_LCD_BTN, text="CLR", texton="CLR"),
        "obj-reverse-btn": dict(_LCD_BTN, text="FWD", texton="REV"),
        "obj-search-box": {"bgcolor": GLASS, "border": 0.0, "bordercolor": GLASS, "textcolor": ACC,
                           "fontname": MONO, "fontsize": 9.0},
        **{pid: dict(_LCD_NUMBOX) for pid in PARAM_OBJ},
    },
    "Focus": {
        "obj-panel-toolbar": {"bgcolor": [0.085, 0.095, 0.115, 1.0], "bordercolor": [0.085, 0.095, 0.115, 1.0], "rounded": 8},
        "obj-panel-left": {"bgcolor": [0.085, 0.095, 0.115, 1.0], "bordercolor": [0.085, 0.095, 0.115, 1.0], "rounded": 8},
        "obj-panel-options": {"bgcolor": [0.105, 0.120, 0.140, 1.0], "bordercolor": [0.105, 0.120, 0.140, 1.0], "rounded": 8},
        "obj-panel-filters": {"bgcolor": [0.105, 0.120, 0.140, 1.0], "bordercolor": [0.105, 0.120, 0.140, 1.0], "rounded": 8},
        "obj-panel-playback": {"bgcolor": [0.120, 0.120, 0.130, 1.0], "bordercolor": [0.120, 0.120, 0.130, 1.0], "rounded": 8},
        "obj-toggle-saved-btn": dict(_FOCUS_TOOL, activebgoncolor=GREEN),
        "obj-toggle-filters-btn": dict(_FOCUS_TOOL, activebgoncolor=CYAN),
        "obj-toggle-playback-btn": dict(_FOCUS_TOOL, activebgoncolor=AMBER),
        "obj-toggle-options-btn": dict(_FOCUS_TOOL, activebgoncolor=VIOLET),
        "obj-hdr-options": dict(_FOCUS_HDR, textcolor=VIOLET),
        "obj-hdr-filters": dict(_FOCUS_HDR, textcolor=CYAN),
        "obj-hdr-playback": dict(_FOCUS_HDR, textcolor=AMBER),
        "obj-lbl-theme": {"textcolor": BTN_TEXT, "fontname": "Arial", "fontface": 1, "fontsize": 9.0},
        "obj-theme-tab": {"activebgcolor": BTN, "activebgoncolor": VIOLET, "activetextcolor": [0.85, 0.89, 0.94, 1.0],
                          "activetextoncolor": INK, "bordercolor": BTN_EDGE, "fontname": UI_FONT, "fontface": 0, "fontsize": 9.0},
        "obj-lbl-zoom": {"textcolor": BTN_TEXT, "fontname": "Arial", "fontface": 1, "fontsize": 9.0},
        "obj-zoom-speed": {"appearance": 4, "activebgcolor": BTN, "bgcolor": BTN, "lcdbgcolor": BTN, "lcdcolor": [0.85, 0.89, 0.94, 1.0],
                           "textcolor": [0.85, 0.89, 0.94, 1.0], "inactivelcdcolor": BTN_TEXT, "bordercolor": BTN_EDGE,
                           "focusbordercolor": VIOLET, "fontname": UI_FONT, "fontface": 0, "fontsize": 9.0},
        "obj-lbl-map": {"textcolor": BTN_TEXT, "fontname": "Arial", "fontface": 1, "fontsize": 9.0},
        "obj-map-samples": {"appearance": 4, "activebgcolor": BTN, "bgcolor": BTN, "lcdbgcolor": BTN, "lcdcolor": [0.85, 0.89, 0.94, 1.0],
                            "textcolor": [0.85, 0.89, 0.94, 1.0], "inactivelcdcolor": BTN_TEXT, "bordercolor": BTN_EDGE,
                            "focusbordercolor": VIOLET, "fontname": UI_FONT, "fontface": 0, "fontsize": 9.0},
        "obj-lbl-searches": {"textcolor": BTN_TEXT, "fontname": "Arial", "fontface": 1, "fontsize": 9.0},
        "obj-searches-cat": {"activebgcolor": BTN, "bordercolor": BTN_EDGE, "textcolor": [0.85, 0.89, 0.94, 1.0], "fontname": UI_FONT,
                             "fontface": 0, "fontsize": 9.0},
        "obj-searches-terms": {"bgcolor": [0.07, 0.085, 0.11, 1.0], "border": 1.0, "bordercolor": [0.66, 0.40, 0.97, 0.65],
                               "textcolor": [0.92, 0.95, 0.98, 1.0], "fontname": "Arial", "fontsize": 9.0},
        "obj-searches-reset": dict(_focus_btn(VIOLET, "Reset", "Reset", activetextcolor=BTN_TEXT), bordercolor=BTN_EDGE),
        "obj-searches-folders": _focus_btn(VIOLET, "Match folders", "Match folders", activetextcolor=[0.85, 0.89, 0.94, 1.0]),
        "obj-reseed-filtered-btn": _focus_btn(CYAN, "Re-Seed", "Re-Seed", activebgcolor=[0.12, 0.17, 0.23, 1.0]),
        "obj-search-clear-btn": dict(_focus_btn(CYAN, "Clr", "Clr", activetextcolor=BTN_TEXT), bordercolor=BTN_EDGE),
        "obj-reverse-btn": _focus_btn(AMBER, "Reverse", "Reversed", activetextcolor=[0.85, 0.89, 0.94, 1.0]),
        "obj-search-box": {"bgcolor": [0.07, 0.085, 0.11, 1.0], "border": 1.0, "bordercolor": [0.22, 0.74, 0.97, 0.65],
                           "textcolor": [0.92, 0.95, 0.98, 1.0], "fontname": "Arial", "fontsize": 9.0},
        # the Dials labels are shared with the Live theme, which restyles them; Focus puts them back
        **{"obj-focus-%s-lbl-%d" % (sec, i): {"textcolor": BTN_TEXT, "fontname": "Arial", "fontface": 1, "fontsize": 8.5}
           for sec, n in (("f", 4), ("p", 6)) for i in range(n)},
    },
    "Live": LIVE_STYLE,
}

# Section titles and Options labels: upper case in LCD / Focus, title case in Live (live.comment `text`).
_TITLE_TEXT = {
    "obj-hdr-options": ("OPTIONS", "Options"), "obj-hdr-filters": ("FILTERS", "Filters"), "obj-hdr-playback": ("PLAYBACK", "Playback"),
    "obj-lbl-theme": ("THEME", "Theme"), "obj-lbl-zoom": ("ZOOM", "Zoom"), "obj-lbl-map": ("SAMPLES", "Samples"),
    "obj-lbl-searches": ("SEARCHES", "Searches"),
}
# the Dials labels are hidden in LCD, but a switch from Live must put their font back (Live's real label height follows it)
THEME_STYLE["LCD"].update({k: dict(v) for k, v in THEME_STYLE["Focus"].items() if k.startswith("obj-focus-") and "-lbl-" in k})
for _bid, (_up, _mixed) in _TITLE_TEXT.items():
    THEME_STYLE["LCD"][_bid]["text"] = _up
    THEME_STYLE["Focus"][_bid]["text"] = _up
    THEME_STYLE["Live"][_bid]["text"] = _mixed


# ---------------------------------------------------------------------------------------------------------------
# Static state (LCD, Options closed) and the presentation-only boxes
# ---------------------------------------------------------------------------------------------------------------
# Static attributes are applied by the build (RECTS + STYLE) so the saved file already shows the default state.
def _live_fallbacks():
    """{colour name: [r, g, b, a]} parsed from XO_LIVE_FALLBACK in src/xo_palette.js (the one copy of the default-dark values)."""
    import os
    src = open(os.path.join(os.path.dirname(__file__), "..", "..", "src", "xo_palette.js"), encoding="utf-8").read()
    body = src[src.index("var XO_LIVE_FALLBACK = {"):]
    body = body[:body.index("};")]
    return {m.group(1): [float(v) for v in m.group(2).split(",")] for m in re.finditer(r"(live_\w+): \[([^\]]+)\]", body)}


def resolve_style(table):
    """A style table with "@live_<name>" colour tokens replaced by their default-dark fallback colours (the saved patch cannot call
    max.getcolor; the v8ui applies the real Live colours at load)."""
    fb = _live_fallbacks()
    return {bid: {a: (fb[v[1:]] if isinstance(v, str) and v.startswith("@") else v) for a, v in attrs.items()} for bid, attrs in table.items()}


# Static attributes applied by the build: the default theme's style, so the saved file already shows the default state.
STYLE = resolve_style(THEME_STYLE[DEFAULT_THEME])


def _comment(oid, text, rect, color, font, size, just):
    x, y, w, h = rect
    return {"box": {
        "fontface": 1, "fontname": font, "fontsize": size, "id": oid, "maxclass": "live.comment",
        "numinlets": 1, "numoutlets": 0, "patching_rect": [x, 700.0 + y, w, h],
        "presentation": 1, "presentation_rect": rect, "text": text, "textcolor": color,
        "textjustification": just, "varname": oid,
    }}


def _rule(oid, rect):
    """Live theme hairline: a live.line (Live makes its box at least 5 px tall and draws a 1 px line through the middle), click-through."""
    x, y, w, h = rect
    return {"box": {
        "id": oid, "ignoreclick": 1, "justification": 1, "linecolor": [0.243, 0.243, 0.243, 1.0], "maxclass": "live.line",
        "numinlets": 1, "numoutlets": 0, "patching_rect": [x, 900.0 + y, w, h], "presentation": 1, "presentation_rect": rect,
        "varname": oid,
    }}


def _panel(oid, rect, color, rounded):
    x, y, w, h = rect
    return {"box": {
        "angle": 270.0, "background": 1, "bgcolor": color, "border": 0, "bordercolor": color, "id": oid,
        "maxclass": "panel", "mode": 0, "numinlets": 1, "numoutlets": 0,
        "patching_rect": [x, 800.0 + y, max(w, 4.0), max(h, 4.0)], "presentation": 1, "presentation_rect": rect,
        "proportion": 0.39, "rounded": rounded, "varname": oid,
    }}


def _to_numbox(box):
    """live.dial -> live.numbox, LCD look (appearance 4); the parameter (valueof) is untouched."""
    box["maxclass"] = "live.numbox"
    box.pop("activedialcolor", None)
    box.update({k: v for k, v in _LCD_NUMBOX.items()})


def _mirror(box):
    """Hidden twin parameter of a parameter object. Max applies range / unit / exponent / enum only to a real parameter
    (parameter_enable 1), so the twin is one too: every parameter_* attribute is copied from the source (generated here so
    they cannot drift), hidden with parameter_invisible 2 (not automatable, not stored, not listed), with its own unique
    long and short name (<Long>View / <Short>~ : names must stay unique; the dial shows no name, the Focus labels do)."""
    import copy
    m = copy.deepcopy(box)
    m["maxclass"] = "live.dial"
    m["id"] = box["id"] + "-mir"
    m["varname"] = m["id"]
    m["parameter_enable"] = 1
    m["showname"] = 0
    m["shownumber"] = 1
    m["annotation_name"] = box.get("annotation_name", "") + " (Focus)"
    vo = m.get("saved_attribute_attributes", {}).get("valueof", {})
    vo["parameter_longname"] = box["saved_attribute_attributes"]["valueof"]["parameter_longname"] + "View"
    vo["parameter_shortname"] = box["saved_attribute_attributes"]["valueof"]["parameter_shortname"] + "~"
    vo["parameter_invisible"] = 2
    vo["parameter_annotation_name"] = m["annotation_name"]
    px, py, pw, ph = m["patching_rect"]
    m["patching_rect"] = [px, py + 1000.0, pw, ph]
    return m


def customize(boxes_by_id, boxes, lines):
    """Themed structure (runs BEFORE RECTS / STYLE are applied, so the boxes it adds get their rects): parameter numboxes
    + live.dial mirrors with their sync wiring, the Options section boxes, the LCD cells / labels and Focus ticks /
    labels. Parameters are unchanged."""
    fg = []
    for pid in PARAM_OBJ:
        box = boxes_by_id[pid]
        mir = _mirror(box)            # copy of the dial, before it becomes a numbox
        _to_numbox(box)
        prep = {
            "fontname": "Arial Bold", "fontsize": 10.0, "id": "obj-prep-mset-" + pid[4:], "maxclass": "newobj",
            "numinlets": 1, "numoutlets": 1, "outlettype": [""],
            "patching_rect": [mir["patching_rect"][0], mir["patching_rect"][1] + 60.0, 76.0, 20.0], "text": "prepend set",
        }
        # parameter object -> prepend set -> mirror (silent); mirror -> parameter object (which re-sets the mirror silently)
        lines.append({"patchline": {"source": [pid, 0], "destination": [prep["id"], 0], "order": 9}})
        lines.append({"patchline": {"source": [prep["id"], 0], "destination": [mir["id"], 0]}})
        lines.append({"patchline": {"source": [mir["id"], 0], "destination": [pid, 0]}})
        fg += [{"box": prep}, {"box": mir}]
        # dial arc colour per theme: Focus keeps the original coloured arcs, Live uses its one display colour
        THEME_STYLE["Focus"][mir["id"]] = {"activedialcolor": list(mir["activedialcolor"])}
        THEME_STYLE["Live"][mir["id"]] = {"activedialcolor": "@live_lcd_control_fg_alt"}
        STYLE.update(resolve_style({mir["id"]: THEME_STYLE[DEFAULT_THEME][mir["id"]]}))

    # foreground extras: Options header / label, LCD and Focus labels
    fg.append(_comment("obj-hdr-options", "OPTIONS", RECTS["obj-hdr-options"], ACC, MONO, 9.0, 0))
    fg.append(_comment("obj-lbl-theme", "THEME", RECTS["obj-lbl-theme"], DIM, MONO, 7.0, 0))
    fg.append(_comment("obj-lbl-zoom", "ZOOM", RECTS["obj-lbl-zoom"], DIM, MONO, 7.0, 0))
    fg.append(_comment("obj-lbl-map", "SAMPLES", RECTS["obj-lbl-map"], DIM, MONO, 7.0, 0))
    fg.append(_comment("obj-lbl-searches", "SEARCHES", RECTS["obj-lbl-searches"], DIM, MONO, 7.0, 0))
    for i in range(4):
        fg.append(_comment("obj-lcd-f-lbl-%d" % i, F_LCD_NAMES[i], RECTS["obj-lcd-f-lbl-%d" % i], DIM, MONO, 7.0, 1))
        fg.append(_comment("obj-focus-f-lbl-%d" % i, F_FOCUS_NAMES[i], RECTS["obj-focus-f-lbl-%d" % i], BTN_TEXT, "Arial", 8.5, 1))
    for i in range(6):
        fg.append(_comment("obj-lcd-p-lbl-%d" % i, P_LCD_NAMES[i], RECTS["obj-lcd-p-lbl-%d" % i], DIM, MONO, 7.0, 1))
        fg.append(_comment("obj-focus-p-lbl-%d" % i, P_FOCUS_NAMES[i], RECTS["obj-focus-p-lbl-%d" % i], BTN_TEXT, "Arial", 8.5, 1))
    for sec in ("options", "searches", "filters", "playback"):
        fg.append(_rule("obj-rule-" + sec, RECTS["obj-rule-" + sec]))
    prompt = _comment("obj-lcd-f-prompt", ">", RECTS["obj-lcd-f-prompt"], ACC, MONO, 9.0, 1)
    prompt["box"]["fontface"] = 0  # regular, like the search text beside it
    fg.append(prompt)
    # background extras (drawn above the section bezels because they come first): LCD cells, Focus ticks
    bg = []
    for oid in sorted(RECTS):
        if oid.startswith("obj-lcd-f-cell-") or oid.startswith("obj-lcd-p-cell-"):
            bg.append(_panel(oid, RECTS[oid], GLASS, 0))
    for sec, colour in (("filters", CYAN), ("playback", AMBER)):
        bg.append(_panel("obj-focus-tick-" + sec, RECTS["obj-focus-tick-" + sec], colour, 1))

    first_bg = next(i for i, b in enumerate(boxes) if b["box"].get("background") == 1)
    boxes[first_bg:first_bg] = fg + bg
    # the Options panel is a section bezel like the others (after the existing background panels, before the node)
    opt_panel = _panel("obj-panel-options", RECTS["obj-panel-options"], GRID, 4)
    opt_panel["box"]["border"] = 1
    opt_panel["box"]["bordercolor"] = EDGE
    boxes.insert(next(i for i, b in enumerate(boxes) if b["box"]["id"] == "obj-node"), opt_panel)
    for b in fg + bg + [opt_panel]:
        boxes_by_id[b["box"]["id"]] = b["box"]
    # Labels only draw: Live makes a live.comment at least (font + 8) px tall, which can reach over the control
    # below it, so every label is click-through.
    for bid, box in boxes_by_id.items():
        if LABEL_RE.match(bid):
            box["ignoreclick"] = 1
