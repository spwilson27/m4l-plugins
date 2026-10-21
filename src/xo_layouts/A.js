/**
 * XO Sample Map — presentation layout "A" (Native Rack) (Saved / Filters / Playback sections + left toolbar).
 *
 * Pure function of the Saved / Filters / Playback visibility flags. Prepended to
 * the mini-map v8ui (src/xo_strip_ui.js), which applies it to the patcher, and
 * required by the tests. Keep it a global script (no top-level module.exports,
 * AGENTS.md 1c). Each variant has its own copy (src/xo_layouts/<name>.js) and must keep
 * the contract documented in scripts/xo_layouts/README.md:
 *   globals XO_MAP_PANE_W, XO_SAVED_PANE_W, XO_DEVICE_H, computeXoLayout(s, f, p) returning
 *   {showSaved, showFilters, showPlayback, leftPanelW, minimapW, filtersX, playbackX, deviceWidth, boxes}
 *   where boxes = {<box id>: {rect: [x, y, w, h], hidden: 0|1}} and the ids are exactly the keys of
 *   RECTS in scripts/xo_layouts/<name>.py.
 *
 * Rules:
 *  - A slim toolbar column (XO_TB_W px, three icon toggles: Saved / Filters / Playback) is the leftmost,
 *    always visible, fixed column. Everything else sits to its right.
 *  - The 2D map pane is always XO_MAP_PANE_W wide. Hiding the Saved list removes
 *    its 136 px and shrinks the mini-map v8ui and the left panel with it.
 *  - Visible sections are packed left to right with a 6 px gap; a hidden section
 *    takes no space, and the device width ends 6 px after the last visible panel.
 */

var XO_MAP_PANE_W = 236.0;
var XO_SAVED_PANE_W = 136.0;
var XO_GAP = 3.0;
var XO_FILTERS_W = 208.0;
var XO_PLAYBACK_W = 164.0;
var XO_DEVICE_H = 169.0;
var XO_TB_X = 3.0;
var XO_TB_W = 24.0;
var XO_LEFT_X = 31.0;

/**
 * Variant A "Native Rack": toolbar | LCD map | Filters | Playback, sections separated by a 3 px seam of the device background.
 * @param {number} showSaved
 * @param {number} showFilters
 * @param {number} showPlayback
 */
function computeXoLayout(showSaved, showFilters, showPlayback) {
  var sOn = Number(showSaved) ? 1 : 0;
  var fOn = Number(showFilters) ? 1 : 0;
  var pOn = Number(showPlayback) ? 1 : 0;

  var minimapW = XO_MAP_PANE_W + (sOn ? XO_SAVED_PANE_W : 0);
  var leftPanelW = minimapW + 8.0;
  var curX = XO_LEFT_X + leftPanelW + XO_GAP;

  var filtersX = curX;
  if (fOn) curX += XO_FILTERS_W + XO_GAP;
  var playbackX = curX;
  if (pOn) curX += XO_PLAYBACK_W + XO_GAP;

  var fh = fOn ? 0 : 1;
  var ph = pOn ? 0 : 1;
  var fx = filtersX;
  var px = playbackX;
  /** @type {Object<string, {rect: number[], hidden: number}>} */
  var boxes = {
    "obj-panel-toolbar": { rect: [XO_TB_X, 5.0, XO_TB_W, 159.0], hidden: 0 },
    "obj-toggle-saved-btn": { rect: [XO_TB_X + 3.0, 9.0, 18.0, 18.0], hidden: 0 },
    "obj-toggle-filters-btn": { rect: [XO_TB_X + 3.0, 31.0, 18.0, 18.0], hidden: 0 },
    "obj-toggle-playback-btn": { rect: [XO_TB_X + 3.0, 53.0, 18.0, 18.0], hidden: 0 },
    "obj-panel-left": { rect: [XO_LEFT_X, 5.0, leftPanelW, 159.0], hidden: 0 },
    "obj-minimap": { rect: [XO_LEFT_X + 4.0, 8.0, minimapW, 154.0], hidden: 0 },
    "obj-panel-filters": { rect: [fx, 5.0, XO_FILTERS_W, 159.0], hidden: fh },
    "obj-hdr-filters": { rect: [fx + 8.0, 8.0, 70.0, 12.0], hidden: fh },
    "obj-reseed-filtered-btn": { rect: [fx + 116.0, 7.0, 50.0, 14.0], hidden: fh },
    "obj-search-clear-btn": { rect: [fx + 170.0, 7.0, 30.0, 14.0], hidden: fh },
    "obj-search-box": { rect: [fx + 8.0, 25.0, 192.0, 16.0], hidden: fh },
    "obj-maxlen-dial": { rect: [fx + 8.0, 44.0, 46.0, 46.0], hidden: fh },
    "obj-tone-dial": { rect: [fx + 56.0, 44.0, 46.0, 46.0], hidden: fh },
    "obj-filter-tonal-dial": { rect: [fx + 104.0, 44.0, 46.0, 46.0], hidden: fh },
    "obj-filter-drum-dial": { rect: [fx + 152.0, 44.0, 46.0, 46.0], hidden: fh },
    "obj-folder-list": { rect: [fx + 8.0, 93.0, 192.0, 68.0], hidden: fh },
    "obj-panel-playback": { rect: [px, 5.0, XO_PLAYBACK_W, 159.0], hidden: ph },
    "obj-hdr-playback": { rect: [px + 8.0, 8.0, 80.0, 12.0], hidden: ph },
    "obj-reverse-btn": { rect: [px + 104.0, 7.0, 52.0, 14.0], hidden: ph },
    "obj-pitch-dial": { rect: [px + 6.0, 30.0, 48.0, 46.0], hidden: ph },
    "obj-speed-dial": { rect: [px + 58.0, 30.0, 48.0, 46.0], hidden: ph },
    "obj-grain-dial": { rect: [px + 110.0, 30.0, 48.0, 46.0], hidden: ph },
    "obj-decay-dial": { rect: [px + 6.0, 100.0, 48.0, 46.0], hidden: ph },
    "obj-stretch-mode": { rect: [px + 58.0, 100.0, 48.0, 46.0], hidden: ph },
    "obj-gain-dial": { rect: [px + 110.0, 100.0, 48.0, 46.0], hidden: ph }
  };

  return {
    showSaved: sOn,
    showFilters: fOn,
    showPlayback: pOn,
    toolbarW: XO_TB_W,
    leftPanelW: leftPanelW,
    minimapW: minimapW,
    filtersX: filtersX,
    playbackX: playbackX,
    deviceWidth: curX,
    boxes: boxes
  };
}

var xoLayoutNodeModule = (typeof module !== "undefined") ? module : undefined;
if (xoLayoutNodeModule && xoLayoutNodeModule.exports) {
  xoLayoutNodeModule.exports = { computeXoLayout: computeXoLayout, XO_MAP_PANE_W: XO_MAP_PANE_W, XO_SAVED_PANE_W: XO_SAVED_PANE_W, XO_DEVICE_H: XO_DEVICE_H };
}
