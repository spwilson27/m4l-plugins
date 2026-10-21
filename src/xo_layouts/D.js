/**
 * XO Sample Map — presentation layout "D" ("LCD Matrix": retro hardware-sampler look).
 *
 * Pure function of the Saved / Filters / Playback visibility flags. Prepended to
 * the mini-map v8ui (src/xo_strip_ui.js), which applies it to the patcher, and
 * required by the tests. Keep it a global script (no top-level module.exports,
 * AGENTS.md 1c). Contract: scripts/xo_layouts/README.md.
 *
 * Same column structure as the default (toolbar | map [+ Saved] | Filters | Playback); inside the Filters and
 * Playback sections every parameter is an LCD cell of a labelled matrix. The cell labels, cell backgrounds and the
 * search prompt are presentation-only extras (scripting names "dxf_*" for Filters, "dxp_*" for Playback; built by
 * scripts/xo_layouts/D.py). They are not parameters, so they are not part of the layout table: they travel with
 * their section (shift = the section's current x minus its all-shown x) and hide with it. computeXoLayout places
 * them as a side effect, only inside the Max v8ui (where xoHostPatcher exists), and only when the visibility
 * flags changed.
 */

var XO_MAP_PANE_W = 236.0;
var XO_SAVED_PANE_W = 136.0;
var XO_GAP = 6.0;
var XO_FILTERS_W = 208.0;
var XO_PLAYBACK_W = 164.0;
var XO_DEVICE_H = 169.0;
var XO_TB_X = 3.0;
var XO_TB_W = 22.0;
var XO_LEFT_X = 28.0;

// All-shown section origins (the x the extras were built at).
var XO_D_ALL_FILTERS_X = 414.0;
var XO_D_ALL_PLAYBACK_X = 628.0;
// Playback matrix: 2 columns x 3 rows of 77 / 78 x 44 cells.
var XO_D_PB_COL = [4.0, 82.0];
var XO_D_PB_ROW = [25.0, 70.0, 115.0];

/** @type {Array<{obj: any, sec: string, rect: number[]}> | null} */
var xoDExtras = null;
var xoDPlacedKey = "";

/**
 * Moves / hides the presentation-only extras with their sections (v8ui only).
 * @param {{filtersX: number, playbackX: number, showFilters: number, showPlayback: number}} L
 */
function xoDPlaceExtras(L) {
  if (typeof xoHostPatcher === "undefined" || !xoHostPatcher) return;
  var key = L.showFilters + "/" + L.showPlayback + "/" + L.filtersX + "/" + L.playbackX;
  if (key === xoDPlacedKey && xoDExtras) return;
  if (!xoDExtras) {
    xoDExtras = [];
    try {
      for (var b = xoHostPatcher.firstobject; b; b = b.nextobject) {
        var vn = String(b.varname || "");
        var sec = vn.indexOf("dxf_") === 0 ? "f" : (vn.indexOf("dxp_") === 0 ? "p" : "");
        if (!sec) continue;
        var r = Array.prototype.slice.call(b.getattr("presentation_rect"));
        xoDExtras.push({ obj: b, sec: sec, rect: [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3])] });
      }
    } catch (e) {}
  }
  xoDPlacedKey = key;
  var fdx = L.filtersX - XO_D_ALL_FILTERS_X;
  var pdx = L.playbackX - XO_D_ALL_PLAYBACK_X;
  for (var i = 0; i < xoDExtras.length; i++) {
    var ex = xoDExtras[i];
    var dx = ex.sec === "f" ? fdx : pdx;
    var on = ex.sec === "f" ? L.showFilters : L.showPlayback;
    try {
      ex.obj.setattr("presentation_rect", ex.rect[0] + dx, ex.rect[1], ex.rect[2], ex.rect[3]);
      ex.obj.hidden = on ? false : true;
    } catch (e2) {}
  }
}

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
  var pc0 = playbackX + XO_D_PB_COL[0] + 1.0;
  var pc1 = playbackX + XO_D_PB_COL[1] + 1.0;
  /** @type {Object<string, {rect: number[], hidden: number}>} */
  var boxes = {
    "obj-panel-toolbar": { rect: [XO_TB_X, 5.0, XO_TB_W, 159.0], hidden: 0 },
    "obj-toggle-saved-btn": { rect: [XO_TB_X + 3.0, 9.0, 16.0, 16.0], hidden: 0 },
    "obj-toggle-filters-btn": { rect: [XO_TB_X + 3.0, 28.0, 16.0, 16.0], hidden: 0 },
    "obj-toggle-playback-btn": { rect: [XO_TB_X + 3.0, 47.0, 16.0, 16.0], hidden: 0 },
    "obj-panel-left": { rect: [XO_LEFT_X, 5.0, leftPanelW, 159.0], hidden: 0 },
    "obj-minimap": { rect: [XO_LEFT_X + 4.0, 8.0, minimapW, 154.0], hidden: 0 },
    "obj-panel-filters": { rect: [filtersX, 5.0, XO_FILTERS_W, 159.0], hidden: fh },
    "obj-hdr-filters": { rect: [filtersX + 7.0, 9.0, 70.0, 13.0], hidden: fh },
    "obj-reseed-filtered-btn": { rect: [filtersX + 118.0, 9.0, 52.0, 13.0], hidden: fh },
    "obj-search-clear-btn": { rect: [filtersX + 174.0, 9.0, 28.0, 13.0], hidden: fh },
    "obj-search-box": { rect: [filtersX + 17.0, 25.0, 186.0, 15.0], hidden: fh },
    "obj-maxlen-dial": { rect: [filtersX + 5.0, 59.0, 47.0, 22.0], hidden: fh },
    "obj-tone-dial": { rect: [filtersX + 55.0, 59.0, 47.0, 22.0], hidden: fh },
    "obj-filter-tonal-dial": { rect: [filtersX + 105.0, 59.0, 47.0, 22.0], hidden: fh },
    "obj-filter-drum-dial": { rect: [filtersX + 155.0, 59.0, 48.0, 22.0], hidden: fh },
    "obj-folder-list": { rect: [filtersX + 4.0, 86.0, 200.0, 74.0], hidden: fh },
    "obj-panel-playback": { rect: [playbackX, 5.0, XO_PLAYBACK_W, 159.0], hidden: ph },
    "obj-hdr-playback": { rect: [playbackX + 7.0, 9.0, 80.0, 13.0], hidden: ph },
    "obj-reverse-btn": { rect: [playbackX + 106.0, 9.0, 52.0, 13.0], hidden: ph },
    "obj-pitch-dial": { rect: [pc0, XO_D_PB_ROW[0] + 19.0, 75.0, 20.0], hidden: ph },
    "obj-speed-dial": { rect: [pc1, XO_D_PB_ROW[0] + 19.0, 76.0, 20.0], hidden: ph },
    "obj-grain-dial": { rect: [pc0, XO_D_PB_ROW[1] + 19.0, 75.0, 20.0], hidden: ph },
    "obj-decay-dial": { rect: [pc1, XO_D_PB_ROW[1] + 19.0, 76.0, 20.0], hidden: ph },
    "obj-stretch-mode": { rect: [pc0, XO_D_PB_ROW[2] + 19.0, 75.0, 20.0], hidden: ph },
    "obj-gain-dial": { rect: [pc1, XO_D_PB_ROW[2] + 19.0, 76.0, 20.0], hidden: ph }
  };

  var layout = {
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
  xoDPlaceExtras(layout);
  return layout;
}

var xoLayoutNodeModule = (typeof module !== "undefined") ? module : undefined;
if (xoLayoutNodeModule && xoLayoutNodeModule.exports) {
  xoLayoutNodeModule.exports = { computeXoLayout: computeXoLayout, XO_MAP_PANE_W: XO_MAP_PANE_W, XO_SAVED_PANE_W: XO_SAVED_PANE_W, XO_DEVICE_H: XO_DEVICE_H };
}
