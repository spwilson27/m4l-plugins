/**
 * XO Sample Map — presentation layout "C" (Tabbed Inspector).
 *
 * Pure function of the Saved / Filters / Playback visibility flags. Prepended to the mini-map v8ui
 * (src/xo_strip_ui.js) and required by the tests. Keep it a global script (AGENTS.md 1c). Contract:
 * scripts/xo_layouts/README.md (ids are exactly the keys of RECTS in scripts/xo_layouts/C.py).
 *
 * Model: a big map pane (XO_MAP_PANE_W, +XO_SAVED_PANE_W with the Saved list) and ONE inspector on the
 * right. Filters and Playback are its two tabs (each XO_INSP_W wide). One flag on = a one-tab inspector
 * (the tab button in its header swaps to the other tab); both on = the two tabs side by side, so the
 * width is always additive; neither on = no inspector, the map takes the whole device.
 */

var XO_MAP_PANE_W = 300.0;
var XO_SAVED_PANE_W = 136.0;
var XO_GAP = 6.0;
var XO_INSP_W = 204.0;
var XO_DEVICE_H = 169.0;
var XO_TB_X = 3.0;
var XO_TB_W = 22.0;
var XO_LEFT_X = 28.0;

/**
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
  if (fOn) curX += XO_INSP_W + XO_GAP;
  var playbackX = curX;
  if (pOn) curX += XO_INSP_W + XO_GAP;

  var fh = fOn ? 0 : 1;
  var ph = pOn ? 0 : 1;
  /** @type {Object<string, {rect: number[], hidden: number}>} */
  var boxes = {
    "obj-panel-toolbar": { rect: [XO_TB_X, 5.0, XO_TB_W, 159.0], hidden: 0 },
    "obj-toggle-saved-btn": { rect: [XO_TB_X + 3.0, 9.0, 16.0, 16.0], hidden: 0 },
    "obj-toggle-filters-btn": { rect: [XO_TB_X + 3.0, 28.0, 16.0, 16.0], hidden: 0 },
    "obj-toggle-playback-btn": { rect: [XO_TB_X + 3.0, 47.0, 16.0, 16.0], hidden: 0 },
    "obj-panel-left": { rect: [XO_LEFT_X, 5.0, leftPanelW, 159.0], hidden: 0 },
    "obj-minimap": { rect: [XO_LEFT_X + 4.0, 8.0, minimapW, 154.0], hidden: 0 },
    "obj-panel-filters": { rect: [filtersX, 5.0, XO_INSP_W, 159.0], hidden: fh },
    "obj-hdr-filters": { rect: [filtersX + 8.0, 8.0, 92.0, 15.0], hidden: fh },
    "obj-tab-f-to-p": { rect: [filtersX + 104.0, 8.0, 92.0, 15.0], hidden: fh },
    "obj-reseed-filtered-btn": { rect: [filtersX + 112.0, 28.0, 52.0, 16.0], hidden: fh },
    "obj-search-clear-btn": { rect: [filtersX + 168.0, 28.0, 30.0, 16.0], hidden: fh },
    "obj-search-box": { rect: [filtersX + 6.0, 28.0, 102.0, 16.0], hidden: fh },
    "obj-maxlen-dial": { rect: [filtersX + 6.0, 48.0, 46.0, 46.0], hidden: fh },
    "obj-tone-dial": { rect: [filtersX + 54.0, 48.0, 46.0, 46.0], hidden: fh },
    "obj-filter-tonal-dial": { rect: [filtersX + 102.0, 48.0, 46.0, 46.0], hidden: fh },
    "obj-filter-drum-dial": { rect: [filtersX + 150.0, 48.0, 46.0, 46.0], hidden: fh },
    "obj-folder-list": { rect: [filtersX + 6.0, 97.0, 192.0, 62.0], hidden: fh },
    "obj-panel-playback": { rect: [playbackX, 5.0, XO_INSP_W, 159.0], hidden: ph },
    "obj-hdr-playback": { rect: [playbackX + 8.0, 8.0, 92.0, 15.0], hidden: ph },
    "obj-tab-p-to-f": { rect: [playbackX + 104.0, 8.0, 92.0, 15.0], hidden: ph },
    "obj-reverse-btn": { rect: [playbackX + 6.0, 28.0, 192.0, 16.0], hidden: ph },
    "obj-pitch-dial": { rect: [playbackX + 10.0, 52.0, 48.0, 46.0], hidden: ph },
    "obj-speed-dial": { rect: [playbackX + 78.0, 52.0, 48.0, 46.0], hidden: ph },
    "obj-grain-dial": { rect: [playbackX + 146.0, 52.0, 48.0, 46.0], hidden: ph },
    "obj-decay-dial": { rect: [playbackX + 10.0, 108.0, 48.0, 46.0], hidden: ph },
    "obj-stretch-mode": { rect: [playbackX + 78.0, 108.0, 48.0, 46.0], hidden: ph },
    "obj-gain-dial": { rect: [playbackX + 146.0, 108.0, 48.0, 46.0], hidden: ph }
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
