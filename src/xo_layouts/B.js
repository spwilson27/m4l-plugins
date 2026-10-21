/**
 * XO Sample Map - presentation layout "B" ("Value Bars"): no rotary dials. Every continuous parameter is a
 * compact horizontal live.numbox value bar with a small name label on its left, stacked in narrow columns
 * (Filters 132 px, Playback 132 px).
 *
 * Pure function of the Saved / Filters / Playback visibility flags (contract: scripts/xo_layouts/README.md):
 *   globals XO_MAP_PANE_W, XO_SAVED_PANE_W, XO_DEVICE_H, computeXoLayout(s, f, p) returning
 *   {showSaved, showFilters, showPlayback, leftPanelW, minimapW, filtersX, playbackX, deviceWidth, boxes}.
 * The bar name labels are extra presentation-only live.comment boxes (not layout ids: the build only lets a
 * layout move boxes that already exist). computeXoLayout also moves / hides them through the host patcher
 * (xoHostPatcher) whenever the v8ui applies a layout, so they follow their section.
 * Keep it a global script (no top-level module.exports, AGENTS.md 1c).
 */

var XO_MAP_PANE_W = 236.0;
var XO_SAVED_PANE_W = 136.0;
var XO_GAP = 6.0;
var XO_FILTERS_W = 132.0;
var XO_PLAYBACK_W = 132.0;
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
  if (fOn) curX += XO_FILTERS_W + XO_GAP;
  var playbackX = curX;
  if (pOn) curX += XO_PLAYBACK_W + XO_GAP;

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
    "obj-panel-filters": { rect: [filtersX, 5.0, XO_FILTERS_W, 159.0], hidden: fh },
    "obj-hdr-filters": { rect: [filtersX + 6.0, 6.0, 46.0, 15.0], hidden: fh },
    "obj-reseed-filtered-btn": { rect: [filtersX + 54.0, 6.0, 46.0, 14.0], hidden: fh },
    "obj-search-clear-btn": { rect: [filtersX + 102.0, 6.0, 24.0, 14.0], hidden: fh },
    "obj-search-box": { rect: [filtersX + 6.0, 23.0, 120.0, 14.0], hidden: fh },
    "obj-maxlen-dial": { rect: [filtersX + 42.0, 40.0, 84.0, 14.0], hidden: fh },
    "obj-tone-dial": { rect: [filtersX + 42.0, 56.0, 84.0, 14.0], hidden: fh },
    "obj-filter-tonal-dial": { rect: [filtersX + 42.0, 72.0, 84.0, 14.0], hidden: fh },
    "obj-filter-drum-dial": { rect: [filtersX + 42.0, 88.0, 84.0, 14.0], hidden: fh },
    "obj-folder-list": { rect: [filtersX + 6.0, 105.0, 120.0, 54.0], hidden: fh },
    "obj-panel-playback": { rect: [playbackX, 5.0, XO_PLAYBACK_W, 159.0], hidden: ph },
    "obj-hdr-playback": { rect: [playbackX + 6.0, 6.0, 80.0, 15.0], hidden: ph },
    "obj-reverse-btn": { rect: [playbackX + 6.0, 141.0, 120.0, 16.0], hidden: ph },
    "obj-pitch-dial": { rect: [playbackX + 44.0, 26.0, 82.0, 14.0], hidden: ph },
    "obj-speed-dial": { rect: [playbackX + 44.0, 45.0, 82.0, 14.0], hidden: ph },
    "obj-grain-dial": { rect: [playbackX + 44.0, 64.0, 82.0, 14.0], hidden: ph },
    "obj-decay-dial": { rect: [playbackX + 44.0, 83.0, 82.0, 14.0], hidden: ph },
    "obj-stretch-mode": { rect: [playbackX + 44.0, 102.0, 82.0, 14.0], hidden: ph },
    "obj-gain-dial": { rect: [playbackX + 44.0, 121.0, 82.0, 14.0], hidden: ph }
  };

  xoMoveBarLabels(filtersX, fh, playbackX, ph);

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

/**
 * Bar name labels (live.comment boxes added by scripts/xo_layouts/B.py): {n: scripting name, s: section, dx, y, w}.
 * Section 0 = Filters (x = filtersX), 1 = Playback (x = playbackX).
 */
/** @type {Array<{n: string, s: number, dx: number, y: number, w: number}>} */
var XO_B_LABELS = [
  { n: "xo-lbl-maxlen", s: 0, dx: 6.0, y: 41.0, w: 36.0 },
  { n: "xo-lbl-tone", s: 0, dx: 6.0, y: 57.0, w: 36.0 },
  { n: "xo-lbl-tonal", s: 0, dx: 6.0, y: 73.0, w: 36.0 },
  { n: "xo-lbl-drums", s: 0, dx: 6.0, y: 89.0, w: 36.0 },
  { n: "xo-lbl-pitch", s: 1, dx: 6.0, y: 27.0, w: 38.0 },
  { n: "xo-lbl-speed", s: 1, dx: 6.0, y: 46.0, w: 38.0 },
  { n: "xo-lbl-grain", s: 1, dx: 6.0, y: 65.0, w: 38.0 },
  { n: "xo-lbl-decay", s: 1, dx: 6.0, y: 84.0, w: 38.0 },
  { n: "xo-lbl-mode", s: 1, dx: 6.0, y: 103.0, w: 38.0 },
  { n: "xo-lbl-gain", s: 1, dx: 6.0, y: 122.0, w: 38.0 }
];

/**
 * Moves / hides the bar labels with their section. Only does something inside the v8ui (the host patcher
 * exists); in Node (tests) it is a no-op.
 * @param {number} filtersX
 * @param {number} fh
 * @param {number} playbackX
 * @param {number} ph
 */
function xoMoveBarLabels(filtersX, fh, playbackX, ph) {
  try {
    var pat = (typeof xoHostPatcher !== "undefined") ? xoHostPatcher : null;
    if (!pat || typeof pat.getnamed !== "function") return;
    for (var i = 0; i < XO_B_LABELS.length; i += 1) {
      var d = XO_B_LABELS[i];
      var obj = pat.getnamed(d.n);
      if (!obj) continue;
      var x = (d.s === 0 ? filtersX : playbackX) + d.dx;
      obj.setattr("presentation_rect", x, d.y, d.w, 12.0);
      obj.hidden = (d.s === 0 ? fh : ph) === 1;
    }
  } catch (e) {}
}

var xoLayoutNodeModule = (typeof module !== "undefined") ? module : undefined;
if (xoLayoutNodeModule && xoLayoutNodeModule.exports) {
  xoLayoutNodeModule.exports = { computeXoLayout: computeXoLayout, XO_MAP_PANE_W: XO_MAP_PANE_W, XO_SAVED_PANE_W: XO_SAVED_PANE_W, XO_DEVICE_H: XO_DEVICE_H };
}
