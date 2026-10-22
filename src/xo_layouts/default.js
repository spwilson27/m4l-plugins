/**
 * XO Sample Map — presentation layout "default": ONE device, two switchable looks ("themes").
 *
 *   "LCD"    retro hardware-sampler look (the former variant D): amber live.numbox LCD readouts in a labelled
 *            matrix, dark bezels, LCD buttons.
 *   "Focus"  slim columns of small live.dial grids with coloured edge ticks (the former variant E's columns).
 *
 * Pure function of the theme and the section visibility flags, prepended to the mini-map v8ui
 * (src/xo_strip_ui.js), which applies it to the patcher (getnamed + presentation_rect / hidden), and required by
 * the tests. Keep it a global script (no top-level module.exports, AGENTS.md 1c). Contract:
 * scripts/xo_layouts/README.md. The Python mirror of this geometry is scripts/xo_layouts/default.py
 * (`layout_boxes`); tests/test_xo_variants.js compares them for every theme x section combination.
 *
 *   computeXoLayout(theme, saved, filters, playback, options) -> {theme, showSaved, showFilters, showPlayback,
 *     showOptions, toolbarW, optionsX, leftX, leftPanelW, minimapW, filtersX, playbackX, deviceWidth,
 *     boxes: {<box id>: {rect: [x, y, w, h], hidden: 0|1}}, sections: {<id>: section}, themeOnly: {<id>: theme}}
 *
 * Rules:
 *  - A slim toolbar column (XO_TB_W px) is the leftmost, always visible column: three section toggles at the top
 *    (Saved / Filters / Playback) and the Options toggle at the bottom.
 *  - The Options section (XO_OPTIONS_W px: the Theme selector, the Zoom Speed value and Searches: category picker, terms field, Reset, Match folders) sits right of the toolbar.
 *  - The 2D map pane is XO_MAP_PANE_W wide in BOTH themes (the Saved list adds XO_SAVED_PANE_W).
 *  - Visible sections are packed left to right with a 6 px gap; a hidden section takes no space and the device
 *    width ends 6 px after the last visible panel. Filters and Playback are narrower in the Focus theme.
 *  - A box that only exists in one theme (LCD cells / labels, Focus ticks / labels, the dial or numbox of the
 *    other type) is hidden in the other theme; its rect is still reported (its own theme's geometry).
 *  - Every themed parameter has ONE parameter object (a live.numbox, shown in LCD) plus a non-parameter live.dial
 *    mirror (`<id>-mir`, shown in Focus).
 */

var XO_THEMES = ["LCD", "Focus"];
/** live.comment labels (headers, LCD / Focus labels, the search prompt); also click-through (default.py customize). */
var XO_LABEL_RE = /^obj-(hdr-|lbl-|lcd-[fp]-lbl-|focus-[fp]-lbl-|lcd-f-prompt$)/;
/**
 * Live sizes a single-line live.comment to exactly floor(font + 8) px tall, whatever the patch says (measured in
 * the VM), and the theme changes some label fonts, so a label's laid-out height follows its font in that theme
 * (fonts: scripts/xo_layouts/default.py THEME_STYLE / customize; tests/test_xo_map.js ties the two together).
 * @param {string} id @param {string} th
 */
function xoLabelH(id, th) {
  if (/^obj-lbl-/.test(id)) return th === "LCD" ? 15.0 : 17.0;   // 7 pt LCD, 9 pt Focus
  if (/^obj-lcd-[fp]-lbl-/.test(id)) return 15.0;                // 7 pt
  if (/^obj-focus-[fp]-lbl-/.test(id)) return 16.0;              // 8.5 pt
  return 17.0;                                                     // headers 9 / 9.5 pt, the 9 pt prompt
}
var XO_MAP_PANE_W = 236.0;
var XO_SAVED_PANE_W = 136.0;
var XO_GAP = 6.0;
var XO_OPTIONS_W = 150.0;
var XO_FILTERS_W = { "LCD": 208.0, "Focus": 134.0 };
var XO_PLAYBACK_W = { "LCD": 164.0, "Focus": 152.0 };
var XO_DEVICE_H = 169.0;
var XO_TB_X = 3.0;
var XO_TB_W = 22.0;
var XO_LEFT_X = 28.0;

// LCD matrix (the former variant D): Playback cells are 2 columns x 3 rows.
var XO_LCD_PB_COL = [4.0, 82.0];
var XO_LCD_PB_ROW = [25.0, 70.0, 115.0];
var XO_LCD_PB_W = [77.0, 78.0];
// LCD Filters: four value cells (x offset, width) and their labels.
var XO_LCD_F_COL = [[4.0, 49.0], [54.0, 49.0], [104.0, 49.0], [154.0, 50.0]];

/**
 * @param {string | number} theme  theme name, or its index in XO_THEMES
 * @returns {string}
 */
function xoThemeName(theme) {
  if (typeof theme === "number") return XO_THEMES[theme] || XO_THEMES[0];
  return XO_THEMES.indexOf(String(theme)) >= 0 ? String(theme) : XO_THEMES[0];
}

/**
 * @param {string | number} theme
 * @param {number} showSaved
 * @param {number} showFilters
 * @param {number} showPlayback
 * @param {number} showOptions
 */
function computeXoLayout(theme, showSaved, showFilters, showPlayback, showOptions) {
  var th = xoThemeName(theme);
  var sOn = Number(showSaved) ? 1 : 0;
  var fOn = Number(showFilters) ? 1 : 0;
  var pOn = Number(showPlayback) ? 1 : 0;
  var oOn = Number(showOptions) ? 1 : 0;

  var minimapW = XO_MAP_PANE_W + (sOn ? XO_SAVED_PANE_W : 0);
  var leftPanelW = minimapW + 8.0;
  var curX = XO_LEFT_X;
  var optionsX = curX;
  if (oOn) curX += XO_OPTIONS_W + XO_GAP;
  var leftX = curX;
  curX += leftPanelW + XO_GAP;
  var filtersX = curX;
  var fw = XO_FILTERS_W[th];
  if (fOn) curX += fw + XO_GAP;
  var playbackX = curX;
  var pw = XO_PLAYBACK_W[th];
  if (pOn) curX += pw + XO_GAP;

  /** @type {Object<string, {rect: number[], hidden: number}>} */
  var boxes = {};
  /** @type {Object<string, string>} */
  var sections = {};
  /** @type {Object<string, string>} */
  var themeOnly = {};
  var lcd = th === "LCD";

  /**
   * @param {string} id
   * @param {string} sec  toolbar | options | left | filters | playback
   * @param {string} only  "" = both themes, else the one theme the box exists in
   * @param {number[]} rect
   */
  function put(id, sec, only, rect) {
    // Labels get Live's own live.comment height (xoLabelH); their text is top-aligned, so it does not move.
    if (XO_LABEL_RE.test(id)) rect = [rect[0], rect[1], rect[2], xoLabelH(id, th)];
    var secOn = sec === "filters" ? fOn : (sec === "playback" ? pOn : (sec === "options" ? oOn : 1));
    boxes[id] = { rect: rect, hidden: (secOn && (!only || only === th)) ? 0 : 1 };
    sections[id] = sec;
    if (only) themeOnly[id] = only;
  }

  // --- toolbar: three section toggles on top, Options at the bottom ---
  put("obj-panel-toolbar", "toolbar", "", [XO_TB_X, 5.0, XO_TB_W, 159.0]);
  put("obj-toggle-saved-btn", "toolbar", "", [XO_TB_X + 3.0, 9.0, 16.0, 16.0]);
  put("obj-toggle-filters-btn", "toolbar", "", [XO_TB_X + 3.0, 28.0, 16.0, 16.0]);
  put("obj-toggle-playback-btn", "toolbar", "", [XO_TB_X + 3.0, 47.0, 16.0, 16.0]);
  put("obj-toggle-options-btn", "toolbar", "", [XO_TB_X + 3.0, 145.0, 16.0, 16.0]);

  // --- Options: header, Theme selector, Searches (category picker, terms field, Reset, Match folders) ---
  put("obj-panel-options", "options", "", [optionsX, 5.0, XO_OPTIONS_W, 159.0]);
  put("obj-hdr-options", "options", "", [optionsX + 7.0, 8.0, 82.0, 14.0]);
  put("obj-lbl-theme", "options", "", [optionsX + 7.0, 30.0, 82.0, 11.0]);
  put("obj-theme-tab", "options", "", [optionsX + 6.0, 44.0, 84.0, 18.0]);
  put("obj-lbl-zoom", "options", "", [optionsX + 94.0, 30.0, 50.0, 11.0]);
  put("obj-zoom-speed", "options", "", [optionsX + 94.0, 44.0, 50.0, 18.0]);
  put("obj-lbl-searches", "options", "", [optionsX + 7.0, 68.0, 138.0, 11.0]);
  put("obj-searches-cat", "options", "", [optionsX + 6.0, 80.0, 138.0, 15.0]);
  put("obj-searches-terms", "options", "", [optionsX + 6.0, 97.0, 138.0, 40.0]);
  put("obj-searches-reset", "options", "", [optionsX + 6.0, 141.0, 44.0, 16.0]);
  put("obj-searches-folders", "options", "", [optionsX + 54.0, 141.0, 90.0, 16.0]);

  // --- map (+ Saved list) ---
  put("obj-panel-left", "left", "", [leftX, 5.0, leftPanelW, 159.0]);
  put("obj-minimap", "left", "", [leftX + 4.0, 8.0, minimapW, 154.0]);

  // --- Filters ---
  var fx = filtersX;
  put("obj-panel-filters", "filters", "", [fx, 5.0, fw, 159.0]);
  put("obj-hdr-filters", "filters", "", lcd ? [fx + 7.0, 9.0, 70.0, 13.0] : [fx + 11.0, 6.0, 56.0, 15.0]);
  put("obj-reseed-filtered-btn", "filters", "", lcd ? [fx + 118.0, 9.0, 52.0, 13.0] : [fx + 70.0, 7.0, 58.0, 13.0]);
  put("obj-search-clear-btn", "filters", "", lcd ? [fx + 174.0, 9.0, 28.0, 13.0] : [fx + 98.0, 22.0, 30.0, 14.0]);
  put("obj-search-box", "filters", "", lcd ? [fx + 17.0, 25.0, 186.0, 15.0] : [fx + 6.0, 22.0, 88.0, 14.0]);
  put("obj-folder-list", "filters", "", lcd ? [fx + 4.0, 86.0, 200.0, 74.0] : [fx + 6.0, 128.0, 122.0, 33.0]);
  var fIds = ["maxlen", "tone", "filter-tonal", "filter-drum"];
  var fFocus = [[4.0, 47.0], [68.0, 47.0], [4.0, 90.0], [68.0, 90.0]]; // dial x offset, y (label 10 px above)
  var i;
  for (i = 0; i < 4; i++) {
    put("obj-" + fIds[i] + "-dial", "filters", "LCD", [fx + XO_LCD_F_COL[i][0] + 1.0, 59.0, XO_LCD_F_COL[i][1] - 2.0, 22.0]);
    put("obj-" + fIds[i] + "-dial-mir", "filters", "Focus", [fx + fFocus[i][0], fFocus[i][1], 60.0, 37.0]); // Live's live.dial height for this size
    put("obj-lcd-f-cell-" + i, "filters", "LCD", [fx + XO_LCD_F_COL[i][0], 42.0, XO_LCD_F_COL[i][1], 42.0]);
    put("obj-lcd-f-lbl-" + i, "filters", "LCD", [fx + XO_LCD_F_COL[i][0], 46.0, XO_LCD_F_COL[i][1], 11.0]);
    put("obj-focus-f-lbl-" + i, "filters", "Focus", [fx + fFocus[i][0], fFocus[i][1] - 10.0, 60.0, 10.0]);
  }
  put("obj-lcd-f-cell-title", "filters", "LCD", [fx + 4.0, 8.0, 200.0, 15.0]);
  put("obj-lcd-f-cell-search", "filters", "LCD", [fx + 4.0, 24.0, 200.0, 17.0]);
  put("obj-lcd-f-prompt", "filters", "LCD", [fx + 3.5, 24.0, 14.0, 15.0]); // 1 px above obj-search-box (live.comment insets text 1 px more than textedit); 14 px = Live's minimum width, centred where the 11 px box was
  put("obj-focus-tick-filters", "filters", "Focus", [fx - 5.0, 5.0, 4.0, 159.0]); // 4 px: Live's minimum panel width, centred in the 6 px gap

  // --- Playback ---
  var px = playbackX;
  put("obj-panel-playback", "playback", "", [px, 5.0, pw, 159.0]);
  put("obj-hdr-playback", "playback", "", lcd ? [px + 7.0, 9.0, 80.0, 13.0] : [px + 11.0, 6.0, 64.0, 15.0]);
  put("obj-reverse-btn", "playback", "", lcd ? [px + 106.0, 9.0, 52.0, 13.0] : [px + 96.0, 7.0, 50.0, 13.0]);
  var pObj = ["obj-pitch-dial", "obj-speed-dial", "obj-grain-dial", "obj-decay-dial", "obj-stretch-mode", "obj-gain-dial"];
  for (i = 0; i < 6; i++) {
    var lc = i % 2;           // LCD column / row (2 x 3)
    var lr = Math.floor(i / 2);
    var fc = i % 3;           // Focus column / row (3 x 2)
    var fr = Math.floor(i / 3);
    var fdx = 4.0 + fc * 48.0;
    var fdy = fr ? 102.0 : 40.0;
    put(pObj[i], "playback", "LCD", [px + XO_LCD_PB_COL[lc] + 1.0, XO_LCD_PB_ROW[lr] + 19.0, lc ? 76.0 : 75.0, 20.0]);
    put(pObj[i] + "-mir", "playback", "Focus", [px + fdx, fdy, 48.0, 37.0]); // Live's live.dial height for this size
    put("obj-lcd-p-cell-" + i, "playback", "LCD", [px + XO_LCD_PB_COL[lc], XO_LCD_PB_ROW[lr], XO_LCD_PB_W[lc], 44.0]);
    put("obj-lcd-p-lbl-" + i, "playback", "LCD", [px + XO_LCD_PB_COL[lc], XO_LCD_PB_ROW[lr] + 5.0, XO_LCD_PB_W[lc], 11.0]);
    put("obj-focus-p-lbl-" + i, "playback", "Focus", [px + fdx, fdy - 10.0, 48.0, 10.0]);
  }
  put("obj-lcd-p-cell-title", "playback", "LCD", [px + 4.0, 8.0, 156.0, 15.0]);
  put("obj-focus-tick-playback", "playback", "Focus", [px - 5.0, 5.0, 4.0, 159.0]); // 4 px: Live's minimum panel width, centred in the 6 px gap

  return {
    theme: th,
    showSaved: sOn,
    showFilters: fOn,
    showPlayback: pOn,
    showOptions: oOn,
    toolbarW: XO_TB_W,
    optionsX: optionsX,
    leftX: leftX,
    leftPanelW: leftPanelW,
    minimapW: minimapW,
    filtersX: filtersX,
    playbackX: playbackX,
    deviceWidth: curX,
    boxes: boxes,
    sections: sections,
    themeOnly: themeOnly
  };
}

var xoLayoutNodeModule = (typeof module !== "undefined") ? module : undefined;
if (xoLayoutNodeModule && xoLayoutNodeModule.exports) {
  xoLayoutNodeModule.exports = {
    computeXoLayout: computeXoLayout, XO_THEMES: XO_THEMES, XO_MAP_PANE_W: XO_MAP_PANE_W, XO_SAVED_PANE_W: XO_SAVED_PANE_W,
    XO_OPTIONS_W: XO_OPTIONS_W, XO_DEVICE_H: XO_DEVICE_H
  };
}
