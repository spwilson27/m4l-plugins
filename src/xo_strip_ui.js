/*
 * XO Sample Map — In-Device Mini Editor: 2D Map, Waveform Scanner & Saved Samples List (src/xo_strip_ui.js)
 * Embedded in Max 9 v8ui object (presentation_rect: [32.0, 8.0, 372.0, 154.0]; 236 wide with the Saved list hidden)
 * src/xo_layout.js is prepended (section layout).
 *
 * Features:
 *  - Left Pane (x = 0..236):
 *    - Top 20px Sample Inspector & 24-Bar Waveform Viewer with live scanning playhead line
 *    - Center 2D XO Sample Constellation Map with k-NN similarity lines & filter-aware scrub (50ms..Inf)
 *    - Bottom 12-item geometric vector icon toolbar (Category filters + Prev/Next Similar, Random)
 *  - Right Pane (x = 237..372):
 *    - Scrollable Saved Samples List with "+Save" button (and 'S' hotkey) & Clear All ('x') button
 *    - Selectable rows, Drag-to-Reorder rows vertically, Delete ('x' button or Backspace/Delete key)
 *    - Stores per-sample playback settings (pitchSt, decayMs, gainDb) when saved
 *    - Separate OS file drag-out zones per item: [R] (Raw) and [E] (Edited / re-rendered)
 *    - Separate batch OS file drag-out zones at bottom: [Drag Raw] and [Drag Edit]
 *  - Versioned getvalueof() / setvalueof() state persistence & 64-step Undo/Redo stack
 */

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2; // Outlet 0: commands to node.codebox, Outlet 1: UI sync

const STATE_VERSION = 2;

const CATEGORIES = [
  { id: "ALL",    title: "Filter: All Samples", color: [0.88, 0.91, 0.95, 1.0] },
  { id: "kick",   title: "Filter: Kick",        color: [1.00, 0.30, 0.37, 1.0] },
  { id: "snare",  title: "Filter: Snare",       color: [1.00, 0.62, 0.11, 1.0] },
  { id: "hihat",  title: "Filter: Hi-Hat",      color: [1.00, 0.90, 0.43, 1.0] },
  { id: "clap",   title: "Filter: Clap",        color: [1.00, 0.40, 0.70, 1.0] },
  { id: "tom",    title: "Filter: Tom",         color: [0.66, 0.33, 0.97, 1.0] },
  { id: "rim",    title: "Filter: Rim",         color: [0.98, 0.44, 0.52, 1.0] },
  { id: "cymbal", title: "Filter: Cymbal",      color: [0.22, 0.74, 0.97, 1.0] },
  { id: "shaker", title: "Filter: Shaker",      color: [0.18, 0.83, 0.75, 1.0] },
  { id: "perc",   title: "Filter: Percussion",  color: [0.29, 0.87, 0.50, 1.0] },
  { id: "fx",     title: "Filter: FX / Other",  color: [0.51, 0.55, 0.97, 1.0] }
];

const CAT_ID_LIST = [
  "kick", "snare", "hihat", "clap", "tom", "rim", "cymbal", "shaker", "perc", "fx"
];

const PITCH_NOTE_ENUM = [
  "Off", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
];

function parsePitchNoteFilter(val) {
  if (val === undefined || val === null || val === "" || val === "Off" || val === "off" || val === "ALL") {
    return -1;
  }
  if (typeof val === "string") {
    const upper = val.trim().toUpperCase();
    const noteIdx = PITCH_NOTE_ENUM.indexOf(upper);
    if (noteIdx >= 1) return noteIdx - 1;
  }
  const n = Math.round(Number(val));
  if (!Number.isFinite(n) || n <= 0 || n > 12) return -1;
  return n - 1;
}

const TOOLBAR_ITEMS = [
  { id: "cat_ALL",    title: "Filter: All Categories" },
  { id: "cat_kick",   title: "Filter: Kick" },
  { id: "cat_snare",  title: "Filter: Snare" },
  { id: "cat_hihat",  title: "Filter: Hi-Hat" },
  { id: "cat_clap",   title: "Filter: Clap" },
  { id: "cat_tom",    title: "Filter: Tom" },
  { id: "cat_cymbal", title: "Filter: Cymbal" },
  { id: "cat_perc",   title: "Filter: Percussion" },
  { id: "cat_fx",     title: "Filter: FX / Other" },
  { id: "sim_prev",   title: "Prev Similar Sample" },
  { id: "sim_next",   title: "Next Similar Sample" },
  { id: "random",     title: "Random Sample" },
  { id: "reseed",     title: "Re-Seed Map Subset (1500 max)" }
];

let points = [];
let selectedIndex = 0;
let anchorIndex = 0;
let hoveredIndex = -1;
let hoveredToolbarIndex = -1;
let lastArmedZoneKey = "";
let lastHotkeySaveMs = 0;
let lastHotkeyDelMs = 0;

// Active Audition Filters (maxLenMs >= 4990 or Infinity = Infinite)
let activeCategory = "ALL";
let maxLenMs = 5000;
let toneFilter = 0;
let tonalFilter = 0;
let drumFilter = 0;
let searchQuery = "";

// Active Playback Settings
let pitchSt = 0;
let speedPct = 100;
let grainMs = 45;
// Stretch engine: 0 Granular, 1 Complex, 2 Texture (default Complex)
let stretchMode = 1;
let decayMs = 2500;
let gainDb = 0;
let reversePlayback = 0;
let playheadPos = 0.32;

// Saved Samples List (scrollable, selectable, drag-reorderable, deletable)
let savedList = [];
let selectedSavedIndex = 0;
let savedScrollOffset = 0;
let nextLocalSavedId = 1;
let showSavedList = 1;
let showFiltersSection = 1;
let showPlaybackSection = 1;
// Options section + theme (themed layouts only: XO_THEMES is defined by src/xo_layouts/default.js; the variant
// devices keep the old three-argument layout, no Options section and the default palette).
let showOptionsSection = 0;
let xoThemeIdx = 0;
let xoStyledTheme = "";
let lastArmSentMs = 0;

let selectedMeta = {
  name: "Kick Atmos",
  category: "kick",
  catIdx: 0,
  durationMs: 320,
  brightness: 38,
  favorite: 0,
  peaks: [
    1.0, 0.92, 0.84, 0.75, 0.66, 0.58, 0.50, 0.43,
    0.36, 0.30, 0.25, 0.21, 0.17, 0.14, 0.11, 0.09,
    0.07, 0.05, 0.04, 0.03, 0.02, 0.02, 0.01, 0.01
  ],
  neighbors: [10, 20, 30, 40, 50, 1, 11]
};

// Detailed waveform of the selected file (selected_wave): per-column min / max / RMS, linear amplitude.
// null until it arrives (or when decoding failed); the 24 cached peaks are drawn as a smooth envelope meanwhile.
let waveData = null; // { n, min: number[], max: number[], rms: number[] }

let isScrubbing = false;
let scrubTrail = [];
let dragOutState = null;     // { mode, savedIdx, label, x, y }
let reorderDragState = null; // { active: true, fromIdx, currentIdx, y }
let previewPressState = null; // { x, y, dragged }
let scrollbarDrag = false;
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 64;
let localSeed = 1;
let simTourCache = [];
let simTourKey = "";

function initDefaultConstellation() {
  points = [];
  const total = 80;
  const sampleNames = [
    "Kick Atmos", "Snare Crisp", "Hihat Closed", "Clap 808", "Tom Low",
    "Rim Click", "Cymbal Crash", "Shaker Groove", "Perc Wood", "FX Laser"
  ];
  for (let i = 0; i < total; i++) {
    const catIdx = i % CAT_ID_LIST.length;
    const clusterIdx = Math.floor(i / CAT_ID_LIST.length);
    const angle = (catIdx / CAT_ID_LIST.length) * Math.PI * 2 - Math.PI * 0.72 + (clusterIdx - 3.5) * 0.075;
    const radiusX = 0.22 + ((i * 11) % 23) / 23.0 * 0.24;
    const radiusY = 0.20 + ((i * 7) % 19) / 19.0 * 0.24;
    const x = Math.max(0.04, Math.min(0.96, 0.5 + Math.cos(angle) * radiusX));
    const y = Math.max(0.06, Math.min(0.94, 0.5 + Math.sin(angle) * radiusY));
    points.push({
      x,
      y,
      catIdx,
      category: CAT_ID_LIST[catIdx],
      durationMs: i === 79 ? 8500 : (60 + ((i * 65) % 1200)),
      brightness: 10 + ((i * 19) % 85),
      druminess: i === 79 ? 15 : (35 + ((i * 29) % 60)),
      tonalPct: 10 + ((i * 31) % 85),
      name: `${sampleNames[catIdx]} ${clusterIdx + 1}`
    });
  }
  selectedIndex = 0;
  anchorIndex = 0;
  selectedMeta.neighbors = [10, 20, 30, 40, 50, 1, 11];
  savedList = [];
  selectedSavedIndex = -1;
  savedScrollOffset = 0;
  nextLocalSavedId = 1;
}

initDefaultConstellation();

// Width / height the patcher gave this v8ui (applyXoLayout). In Live, mgraphics.size reads 0 x 0 while the
// device is off screen, which made the map pane negative and broke hit-testing and zoom before the first paint.
let xoBoxW = 372;
let xoBoxH = 154;

function getLayout() {
  const sz = mgraphics.size;
  const w = (sz && sz[0] > 0) ? sz[0] : xoBoxW;
  const h = (sz && sz[1] > 0) ? sz[1] : xoBoxH;
  const savedW = showSavedList ? XO_SAVED_PANE_W : 0;
  // The map pane keeps its width when the Saved list is hidden, even before the
  // patcher has shrunk this v8ui (applyXoLayout).
  const mapW = showSavedList ? w - savedW : Math.min(w, XO_MAP_PANE_W);
  return {
    w,
    h,
    mapW,
    savedX: mapW,
    savedW,
    topBarH: 20,
    plotX: 6,
    plotY: 22,
    plotW: mapW - 12,
    plotH: h - 22 - 22,
    toolbarY: h - 22,
    toolbarH: 22,
    savedRowY0: 21,
    savedRowH: 22,
    savedMaxRows: Math.max(4, Math.floor((h - 22 - 21) / 22)),
    savedBottomY: h - 22,
    scrollbarX: w - 5
  };
}

// ----------------------------------------------------------------------------
// Map view (zoom / pan). The visible window is [viewX0, viewX0 + 1/zoom] x [viewY0, viewY0 + 1/zoom]
// in normalized map coordinates; zoom 1 is exactly the full view.
// ----------------------------------------------------------------------------
const VIEW_ZOOM_MIN = 1.0;
const VIEW_ZOOM_MAX = 16.0;
const MAP_PAD_X = 5;
const MAP_PAD_Y = 6;
let viewZoom = 1.0;
let viewX0 = 0.0;
let viewY0 = 0.0;
let panState = null; // { x, y, x0, y0 } while a pan gesture is active

function clampView() {
  viewZoom = Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, Number(viewZoom) || 1.0));
  if (viewZoom < 1.0005) {
    viewZoom = 1.0;
    viewX0 = 0.0;
    viewY0 = 0.0;
    return;
  }
  const span = 1.0 / viewZoom;
  viewX0 = Math.max(0.0, Math.min(1.0 - span, viewX0));
  viewY0 = Math.max(0.0, Math.min(1.0 - span, viewY0));
}

function resetView() {
  viewZoom = 1.0;
  viewX0 = 0.0;
  viewY0 = 0.0;
  panState = null;
  mgraphics.redraw();
}

function normToScreen(nx, ny, lay) {
  const pw = lay.plotW - MAP_PAD_X * 2;
  const ph = lay.plotH - MAP_PAD_Y * 2;
  return [
    lay.plotX + MAP_PAD_X + (nx - viewX0) * viewZoom * pw,
    lay.plotY + MAP_PAD_Y + (ny - viewY0) * viewZoom * ph
  ];
}

function screenToNorm(sx, sy, lay) {
  const pw = lay.plotW - MAP_PAD_X * 2;
  const ph = lay.plotH - MAP_PAD_Y * 2;
  return [
    viewX0 + (sx - lay.plotX - MAP_PAD_X) / (pw * viewZoom),
    viewY0 + (sy - lay.plotY - MAP_PAD_Y) / (ph * viewZoom)
  ];
}

/** Zoom by `factor` keeping the map point under the screen position (sx, sy) fixed (unless clamped at the edges). */
function zoomViewAt(sx, sy, factor, lay) {
  const l = lay || getLayout();
  const [nx, ny] = screenToNorm(sx, sy, l);
  const pw = l.plotW - MAP_PAD_X * 2;
  const ph = l.plotH - MAP_PAD_Y * 2;
  const fx = (sx - l.plotX - MAP_PAD_X) / pw;
  const fy = (sy - l.plotY - MAP_PAD_Y) / ph;
  viewZoom = Math.max(VIEW_ZOOM_MIN, Math.min(VIEW_ZOOM_MAX, viewZoom * factor));
  viewX0 = nx - fx / viewZoom;
  viewY0 = ny - fy / viewZoom;
  clampView();
  mgraphics.redraw();
}

/** Pan by a screen-space delta (content follows the cursor). */
function panViewBy(dxPx, dyPx, lay) {
  const l = lay || getLayout();
  const pw = l.plotW - MAP_PAD_X * 2;
  const ph = l.plotH - MAP_PAD_Y * 2;
  viewX0 -= dxPx / (pw * viewZoom);
  viewY0 -= dyPx / (ph * viewZoom);
  clampView();
  mgraphics.redraw();
}

function isInPlotRect(sx, sy, lay, margin) {
  const m = margin || 0;
  return sx >= lay.plotX + m && sx <= lay.plotX + lay.plotW - m && sy >= lay.plotY + m && sy <= lay.plotY + lay.plotH - m;
}

/** Zoom indicator pill rectangle (bottom-left of the plot, only shown while zoomed). */
function zoomPillRect(lay) {
  return [lay.plotX + 3, lay.plotY + lay.plotH - 14, 30, 11];
}

/** Pan so the selected sample is inside the view (centred when it is not). Only when zoomed. */
function ensureSelectedInView() {
  if (viewZoom <= 1.0 || selectedIndex < 0 || selectedIndex >= points.length) return;
  const lay = getLayout();
  const pt = points[selectedIndex];
  const [sx, sy] = normToScreen(pt.x, pt.y, lay);
  if (isInPlotRect(sx, sy, lay, 10)) return;
  const span = 1.0 / viewZoom;
  viewX0 = pt.x - span / 2;
  viewY0 = pt.y - span / 2;
  clampView();
}

/** Liang-Barsky: clip segment to the plot rect; returns [x0, y0, x1, y1] or null when fully outside. */
function clipSegmentToPlot(x0, y0, x1, y1, lay) {
  const xmin = lay.plotX;
  const xmax = lay.plotX + lay.plotW;
  const ymin = lay.plotY;
  const ymax = lay.plotY + lay.plotH;
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

function isInfiniteMaxLen(val) {
  if (val === "inf" || val === "infinite" || val === "Infinity" || val === Infinity) return true;
  const n = Number(val);
  return !Number.isFinite(n) || n >= 4990;
}

function isPointVisible(pt) {
  if (!pt) return false;
  if (activeCategory !== "ALL" && pt.category !== activeCategory) return false;
  if (!isInfiniteMaxLen(maxLenMs) && pt.durationMs > Number(maxLenMs)) return false;
  if (toneFilter < 0) {
    const maxB = 100.0 + toneFilter * 0.85;
    if (pt.brightness > maxB) return false;
  } else if (toneFilter > 0) {
    const minB = toneFilter * 0.85;
    if (pt.brightness < minB) return false;
  }
  const tPct = pt.tonalPct !== undefined ? pt.tonalPct : 50;
  if (tonalFilter < 0) {
    const maxT = 100.0 + tonalFilter * 0.85;
    if (tPct > maxT) return false;
  } else if (tonalFilter > 0) {
    const minT = tonalFilter * 0.85;
    if (tPct < minT) return false;
  }
  const dPct = pt.druminess !== undefined ? pt.druminess : 65;
  if (drumFilter < 0) {
    const maxD = 100.0 + drumFilter * 0.85;
    if (dPct > maxD) return false;
  } else if (drumFilter > 0) {
    const minD = drumFilter * 0.85;
    if (dPct < minD) return false;
  }
  if (searchQuery && searchQuery.trim().length > 0) {
    const clauses = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (clauses.length > 0) {
      const haystack = String(pt.name || "")
        .toLowerCase()
        .replace(/[_\-./\\]+/g, " ");
      for (let i = 0; i < clauses.length; i++) {
        if (!haystack.includes(clauses[i])) return false;
      }
    }
  }
  return true;
}

function ensureValidSelection() {
  if (points.length === 0) return;
  if (selectedIndex >= 0 && selectedIndex < points.length && isPointVisible(points[selectedIndex])) {
    return;
  }
  for (let i = 0; i < points.length; i++) {
    if (isPointVisible(points[i])) {
      selectedIndex = i;
      anchorIndex = i;
      return;
    }
  }
}

function clampSavedScroll() {
  const lay = getLayout();
  const maxScroll = Math.max(0, savedList.length - lay.savedMaxRows);
  savedScrollOffset = Math.max(0, Math.min(maxScroll, Math.round(savedScrollOffset)));
  if (selectedSavedIndex >= savedList.length) {
    selectedSavedIndex = savedList.length - 1;
  }
}

function scrollSavedList(deltaRows) {
  savedScrollOffset += deltaRows;
  clampSavedScroll();
  mgraphics.redraw();
}

function getCategoryColor(catIdx) {
  const entry = CATEGORIES[catIdx + 1] || CATEGORIES[0];
  return xoPaletteCat(entry.id, entry.color);
}

function findNearestVisiblePoint(sx, sy, maxDistPx) {
  const lay = getLayout();
  let bestIdx = -1;
  let bestD2 = maxDistPx * maxDistPx;
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (!isPointVisible(pt)) continue;
    const pos = normToScreen(pt.x, pt.y, lay);
    if (viewZoom > 1.0 && !isInPlotRect(pos[0], pos[1], lay, 0)) continue;
    const dx = pos[0] - sx;
    const dy = pos[1] - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      bestD2 = d2;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function captureSnapshot() {
  return {
    activeCategory,
    maxLenMs,
    toneFilter,
    searchQuery,
    pitchSt,
    decayMs,
    gainDb,
    selectedIndex,
    anchorIndex,
    selectedSavedIndex,
    savedScrollOffset,
    savedList: savedList.map((item) => ({ ...item }))
  };
}

function applySnapshot(snap) {
  if (!snap) return;
  activeCategory = snap.activeCategory || "ALL";
  maxLenMs = snap.maxLenMs !== undefined ? snap.maxLenMs : 5000;
  toneFilter = snap.toneFilter !== undefined ? snap.toneFilter : 0;
  searchQuery = snap.searchQuery || "";
  pitchSt = snap.pitchSt !== undefined ? snap.pitchSt : 0;
  decayMs = snap.decayMs !== undefined ? snap.decayMs : 2500;
  gainDb = snap.gainDb !== undefined ? snap.gainDb : 0;
  selectedIndex = snap.selectedIndex || 0;
  anchorIndex = snap.anchorIndex || 0;
  selectedSavedIndex = snap.selectedSavedIndex !== undefined ? snap.selectedSavedIndex : -1;
  savedScrollOffset = snap.savedScrollOffset || 0;
  if (Array.isArray(snap.savedList)) {
    savedList = snap.savedList.map((item) => ({ ...item }));
  }
  clampSavedScroll();
  mgraphics.redraw();
}

function pushUndoState() {
  undoStack.push(captureSnapshot());
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (undoStack.length === 0) return;
  redoStack.push(captureSnapshot());
  const prev = undoStack.pop();
  applySnapshot(prev);
  notifyclients();
}

function redo() {
  if (redoStack.length === 0) return;
  undoStack.push(captureSnapshot());
  const next = redoStack.pop();
  applySnapshot(next);
  notifyclients();
}

function parseTrailingNumber(args, fallback) {
  for (let i = args.length - 1; i >= 0; i--) {
    if (args[i] === "inf" || args[i] === "infinite" || args[i] === "Infinity" || args[i] === Infinity) {
      return Infinity;
    }
    const n = Number(args[i]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// ============================================================================
// Max Messages into v8ui
// ============================================================================

function loadbang() {
  mgraphics.redraw();
}

function minimap_clear() {
  points = [];
  selectedIndex = 0;
  anchorIndex = 0;
}

function minimap_batch(offset, ...flat) {
  let stride = 5;
  if (flat.length % 8 === 0 && typeof flat[7] === "string") stride = 8;
  else if (flat.length % 6 === 0 && typeof flat[5] === "string") stride = 6;
  for (let i = 0; i + (stride - 1) < flat.length; i += stride) {
    const x = Number(flat[i]);
    const y = Number(flat[i + 1]);
    const catIdx = Math.max(0, Math.min(CAT_ID_LIST.length - 1, Number(flat[i + 2]) || 0));
    const durationMs = Number(flat[i + 3]) || 200;
    const brightness = Number(flat[i + 4]) || 50;
    const druminess = stride === 8 ? (Number(flat[i + 5]) || 65) : 65;
    const tonalPct = stride === 8 ? (Number(flat[i + 6]) || 50) : 50;
    const name = stride === 8
      ? String(flat[i + 7] || `Sample_${offset + i / stride}`)
      : (stride === 6 ? String(flat[i + 5] || `Sample_${offset + i / stride}`) : `Sample_${offset + i / stride}`);
    const idx = offset + (i / stride);
    points[idx] = {
      x,
      y,
      catIdx,
      category: CAT_ID_LIST[catIdx],
      durationMs,
      brightness,
      druminess,
      tonalPct,
      name
    };
  }
}

function minimap_done(totalCount, status) {
  if (points.length === 0) initDefaultConstellation();
  ensureValidSelection();
  mgraphics.redraw();
}

function selected_info(idx, name, category, catIdx, durMs, bright, fav, ...rest) {
  xoSelLog.push({ idx: Number(idx), name: String(name) });
  if (xoSelLog.length > 40) xoSelLog.shift();
  const newIdx = Number(idx) || 0;
  // Keep the detailed waveform when the same sample is re-announced (param change); drop it on a new one.
  if (waveData && (waveData.idx !== newIdx || waveData.name !== String(name || "Sample"))) waveData = null;
  selectedIndex = newIdx;
  if (Date.now() - historyNavAtMs < 1500) {
    historyNavAtMs = 0;
    anchorIndex = newIdx;
    simTourKey = "";
    playheadPos = 0.0;
  }
  const nbrMarker = rest.indexOf("nbrs");
  const peaks = nbrMarker >= 0 ? rest.slice(0, nbrMarker).map(Number) : rest.slice(0, 24).map(Number);
  const neighbors = nbrMarker >= 0 ? rest.slice(nbrMarker + 1).map(Number) : [];
  selectedMeta = {
    name: String(name || "Sample"),
    category: String(category || "kick"),
    catIdx: Number(catIdx) || 0,
    durationMs: Number(durMs) || 200,
    brightness: Number(bright) || 50,
    favorite: Number(fav) || 0,
    peaks: peaks.length > 0 ? peaks : selectedMeta.peaks,
    neighbors
  };
  ensureSelectedInView();
  mgraphics.redraw();
}

/**
 * selected_wave <idx> <n> <min0> <max0> <rms0> ... : whole-file waveform of the selected sample.
 * n = 0 means the file could not be decoded (the cached peaks stay).
 */
function selected_wave(idx, n, ...vals) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  if (Number(idx) !== selectedIndex) return; // stale: another sample was selected meanwhile
  if (count === 0 || vals.length < count * 3) {
    waveData = null;
    mgraphics.redraw();
    return;
  }
  const mn = new Array(count);
  const mx = new Array(count);
  const rm = new Array(count);
  for (let i = 0; i < count; i++) {
    mn[i] = Math.max(-1, Math.min(1, Number(vals[i * 3]) || 0));
    mx[i] = Math.max(-1, Math.min(1, Number(vals[i * 3 + 1]) || 0));
    rm[i] = Math.max(0, Math.min(1, Number(vals[i * 3 + 2]) || 0));
  }
  waveData = { idx: selectedIndex, name: selectedMeta.name, n: count, min: mn, max: mx, rms: rm };
  mgraphics.redraw();
}

/** Smooth envelope from the 24 cached peaks (symmetric), used until selected_wave arrives. */
function fallbackWaveFromPeaks(peaks) {
  const n0 = peaks.length;
  const n = Math.max(2, n0) * 4;
  const mn = [];
  const mx = [];
  const rm = [];
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * (n0 - 1);
    const a = Math.floor(t);
    const b = Math.min(n0 - 1, a + 1);
    const f = t - a;
    const k = f * f * (3 - 2 * f);
    const v = Math.max(0, Math.min(1, (Number(peaks[a]) || 0) * (1 - k) + (Number(peaks[b]) || 0) * k));
    mx.push(v);
    mn.push(-v);
    rm.push(v * 0.55);
  }
  return { n, min: mn, max: mx, rms: rm };
}

/** Closed filled polygon over display columns [i0, i1] (upper edge left to right, lower edge back). */
function waveformPolygon(wd, i0, i1, x0, x1, midY, halfH, mirror, useRms) {
  const n = wd.n;
  const xAt = (i) => (n > 1 ? x0 + (i / (n - 1)) * (x1 - x0) : x0);
  const src = (i) => (mirror ? n - 1 - i : i);
  const upper = (i) => midY - (useRms ? wd.rms[src(i)] : Math.max(0, wd.max[src(i)])) * halfH;
  const lower = (i) => midY + (useRms ? wd.rms[src(i)] : Math.max(0, -wd.min[src(i)])) * halfH;
  mgraphics.move_to(xAt(i0), upper(i0));
  for (let i = i0 + 1; i <= i1; i++) mgraphics.line_to(xAt(i), upper(i));
  for (let i = i1; i >= i0; i--) mgraphics.line_to(xAt(i), lower(i));
  mgraphics.close_path();
}

function strip_filter_cat(...args) {
  const last = args.length > 0 ? String(args[args.length - 1]) : "ALL";
  activeCategory = last || "ALL";
  ensureValidSelection();
  mgraphics.redraw();
}

function strip_filter_maxlen(...args) {
  const parsed = parseTrailingNumber(args, 5000);
  maxLenMs = isInfiniteMaxLen(parsed) ? Infinity : Math.max(50, parsed);
  ensureValidSelection();
  mgraphics.redraw();
}

function strip_filter_tone(...args) {
  toneFilter = Math.max(-100, Math.min(100, parseTrailingNumber(args, 0)));
  ensureValidSelection();
  mgraphics.redraw();
}

function strip_filter_tonal(...args) {
  tonalFilter = Math.max(-100, Math.min(100, parseTrailingNumber(args, 0)));
  ensureValidSelection();
  mgraphics.redraw();
}

function strip_filter_drum(...args) {
  drumFilter = Math.max(-100, Math.min(100, parseTrailingNumber(args, 0)));
  ensureValidSelection();
  mgraphics.redraw();
}

function strip_filter_search(...args) {
  const raw = args.join(" ").replace(/^(strip_filter_search|set_search|text)\s*/i, "").trim();
  searchQuery = raw;
  ensureValidSelection();
  mgraphics.redraw();
}

function set_decay(...args) {
  decayMs = Math.max(20, parseTrailingNumber(args, 2500));
  mgraphics.redraw();
}

function set_pitch(...args) {
  pitchSt = parseTrailingNumber(args, 0);
  mgraphics.redraw();
}

function set_gain(...args) {
  gainDb = parseTrailingNumber(args, 0);
  mgraphics.redraw();
}

function set_reverse(...args) {
  reversePlayback = parseTrailingNumber(args, 0) ? 1 : 0;
  mgraphics.redraw();
}

function getReverse() {
  return reversePlayback;
}

function set_speed(...args) {
  speedPct = Math.max(10, Math.min(400, parseTrailingNumber(args, 100)));
  mgraphics.redraw();
}

function set_grain(...args) {
  grainMs = Math.max(5, Math.min(250, parseTrailingNumber(args, 45)));
  mgraphics.redraw();
}

function set_stretchmode(...args) {
  stretchMode = Math.max(0, Math.min(2, Math.round(parseTrailingNumber(args, 1))));
  applyGrainDialState();
  mgraphics.redraw();
}

// Grain is the grain size (Granular) or the window size (Texture); Complex ignores it, so it is dimmed.
function applyGrainDialState() {
  const pat = (typeof xoHostPatcher !== "undefined") ? xoHostPatcher : null;
  if (!pat || typeof pat.getnamed !== "function" || typeof XO_LAYOUT_NAMES === "undefined") return;
  const on = (stretchMode === 0 || stretchMode === 2) ? 1 : 0;
  for (const id of ["obj-grain-dial", "obj-grain-dial-mir"]) {
    const obj = pat.getnamed(XO_LAYOUT_NAMES[id] || id);
    if (!obj) continue;
    try {
      obj.setattr("active", on);
      // An inactive dial neither outputs a change nor takes the silent `set` of the parameter -> mirror sync, so when
      // Grain gets dimmed (Cmplx) the Focus mirror is brought up to the parameter's current value through the script.
      if (!on && id === "obj-grain-dial-mir") {
        const src = pat.getnamed(XO_LAYOUT_NAMES["obj-grain-dial"] || "obj-grain-dial");
        if (src) {
          obj.setattr("active", 1);
          obj.message("set", Number(src.getvalueof()));
          obj.setattr("active", 0);
        }
      }
    } catch (e) {}
  }
}

function set_show_saved(...args) {
  const v = parseTrailingNumber(args, 1);
  showSavedList = v ? 1 : 0;
  if (!showSavedList) {
    updateArmedDragZone("none", -1);
  }
  applyXoLayout();
  mgraphics.redraw();
}

function set_show_filters(...args) {
  showFiltersSection = parseTrailingNumber(args, 1) ? 1 : 0;
  applyXoLayout();
}

function set_show_playback(...args) {
  showPlaybackSection = parseTrailingNumber(args, 1) ? 1 : 0;
  applyXoLayout();
}

function set_show_options(...args) {
  showOptionsSection = parseTrailingNumber(args, 0) ? 1 : 0;
  applyXoLayout();
}

/** Theme switch (Options > Theme): `set_theme <index>` or `set_theme <name>` ("LCD" | "Focus"). */
function set_theme(...args) {
  if (typeof XO_THEMES === "undefined") return;
  const a = args.length ? args[args.length - 1] : 0;
  let idx = (typeof a === "string") ? XO_THEMES.indexOf(a) : Math.round(Number(a));
  if (!(idx >= 0 && idx < XO_THEMES.length)) idx = 0;
  xoThemeIdx = idx;
  xoPaletteSet(XO_THEMES[idx]);
  applyXoLayout();
  mgraphics.redraw();
}

function getXoThemeName() {
  return (typeof XO_THEMES !== "undefined") ? XO_THEMES[xoThemeIdx] : "default";
}

function apply_layout() {
  applyXoLayout();
}

// Captured at top level: `this` is only the jsthis there.
const xoHostPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;

/** The layout for the current theme and section flags (themed: 5 arguments, variants: 3). */
function xoCurrentLayout() {
  const layoutFn = /** @type {(...a: any[]) => any} */ (computeXoLayout);
  if (typeof XO_THEMES !== "undefined") {
    return layoutFn(XO_THEMES[xoThemeIdx], showSavedList, showFiltersSection, showPlaybackSection, showOptionsSection);
  }
  return layoutFn(showSavedList, showFiltersSection, showPlaybackSection);
}

/**
 * Sets the colours / fonts / texts of the shared boxes for the active theme (XO_THEME_STYLE, injected by
 * scripts/build_xo_map.py: {theme: {box id: {attribute: value | [numbers]}}}). Runs once per theme change.
 * @param {any} pat
 */
function applyXoThemeStyle(pat) {
  if (typeof XO_THEME_STYLE === "undefined" || typeof XO_THEMES === "undefined") return;
  const name = XO_THEMES[xoThemeIdx];
  if (xoStyledTheme === name) return;
  const table = XO_THEME_STYLE[name];
  if (!table) return;
  for (const id of Object.keys(table)) {
    const obj = pat.getnamed(XO_LAYOUT_NAMES[id] || id);
    if (!obj) continue;
    const attrs = table[id];
    for (const attr of Object.keys(attrs)) {
      const v = attrs[attr];
      try {
        if (Array.isArray(v)) obj.setattr(attr, ...v); else obj.setattr(attr, v);
      } catch (e) {}
    }
  }
  xoStyledTheme = name;
}

// Moves / hides every laid-out box for the current theme and section visibility (src/xo_layouts/<name>.js)
// and restyles the shared boxes when the theme changed.
// Boxes are looked up by scripting name: XO_LAYOUT_NAMES (box id -> varname) is
// prepended by scripts/build_xo_map.py. The device width itself is set by the
// patcher (obj-expr-width -> live.thisdevice).
function applyXoLayout() {
  const layout = xoCurrentLayout();
  xoBoxW = layout.boxes["obj-minimap"].rect[2];
  xoBoxH = layout.boxes["obj-minimap"].rect[3];
  const pat = xoHostPatcher;
  if (!pat || typeof pat.getnamed !== "function" || typeof XO_LAYOUT_NAMES === "undefined") return layout;
  applyXoThemeStyle(pat);
  for (const id of Object.keys(layout.boxes)) {
    const spec = layout.boxes[id];
    const obj = pat.getnamed(XO_LAYOUT_NAMES[id] || id);
    if (!obj) continue;
    try {
      obj.setattr("presentation_rect", spec.rect[0], spec.rect[1], spec.rect[2], spec.rect[3]);
      obj.hidden = spec.hidden === 1;
    } catch (e) {}
  }
  return layout;
}

function getXoSectionVisibility() {
  return [showSavedList, showFiltersSection, showPlaybackSection];
}

function getShowSavedList() {
  return showSavedList;
}

function getShowOptions() {
  return showOptionsSection;
}

function set_playhead(p) {
  const val = Number(p);
  if (Number.isFinite(val)) {
    playheadPos = Math.max(0.0, Math.min(1.0, val));
    mgraphics.redraw();
  }
}

function setphase(p) {
  set_playhead(p);
}

// Helper used only by scripts/render_preview.py so the static preview screenshot shows example saved rows
function preview() {
  playheadPos = 0.32;
  savedList = [
    { id: 1, sampleIndex: 0, name: "Kick Atmos", catIdx: 0, pitchSt: 0, decayMs: 320, gainDb: 0 },
    { id: 2, sampleIndex: 1, name: "Snare Crisp", catIdx: 1, pitchSt: 3, decayMs: 450, gainDb: -1.5 }
  ];
  selectedSavedIndex = 0;
}

function getPoints() {
  return points;
}

function getSelectedIndex() {
  return selectedIndex;
}

function getView() {
  return { zoom: viewZoom, x0: viewX0, y0: viewY0 };
}

function getWaveData() {
  return waveData;
}

function getSavedList() {
  return savedList;
}

function getSelectedSavedIndex() {
  return selectedSavedIndex;
}

function getSavedScrollOffset() {
  return savedScrollOffset;
}

// ============================================================================
// Saved Samples List Management (Select, Scroll, Reorder, Delete & Drag-Out)
// ============================================================================

function save_selected() {
  lastHotkeySaveMs = Date.now();
  pushUndoState();
  const pt = points[selectedIndex] || { name: selectedMeta.name, catIdx: selectedMeta.catIdx, category: selectedMeta.category, durationMs: selectedMeta.durationMs };
  const entry = {
    id: nextLocalSavedId++,
    sampleIndex: selectedIndex,
    name: (selectedIndex >= 0 && pt && pt.name) ? pt.name : (selectedMeta.name || `Sample ${selectedIndex}`),
    catIdx: pt ? pt.catIdx : (selectedMeta.catIdx || 0),
    pitchSt,
    decayMs,
    gainDb,
    reverse: reversePlayback ? 1 : 0,
    speedPct,
    grainMs,
    stretchMode
  };
  savedList.push(entry);
  selectedSavedIndex = savedList.length - 1;
  const lay = getLayout();
  if (selectedSavedIndex >= savedScrollOffset + lay.savedMaxRows) {
    savedScrollOffset = selectedSavedIndex - lay.savedMaxRows + 1;
  }
  clampSavedScroll();
  outlet(
    0,
    "save_selected",
    selectedIndex,
    entry.name,
    entry.catIdx,
    pitchSt,
    decayMs,
    gainDb,
    entry.reverse,
    speedPct,
    grainMs,
    stretchMode
  );
  notifyclients();
  mgraphics.redraw();
  return entry;
}

function saved_list_sync(count, ...flat) {
  const next = [];
  let stride = 7;
  if (flat.length % 11 === 0 && Number(count) * 11 === flat.length) stride = 11;
  else if (flat.length % 8 === 0 && Number(count) * 8 === flat.length) stride = 8;
  for (let i = 0; i + (stride - 1) < flat.length; i += stride) {
    next.push({
      id: Number(flat[i]) || (i + 1),
      sampleIndex: Number(flat[i + 1]) || 0,
      name: String(flat[i + 2] || "Sample"),
      catIdx: Number(flat[i + 3]) || 0,
      pitchSt: Number(flat[i + 4]) || 0,
      decayMs: Number(flat[i + 5]) || 2500,
      gainDb: Number(flat[i + 6]) || 0,
      reverse: stride >= 8 ? (Number(flat[i + 7]) ? 1 : 0) : 0,
      speedPct: stride >= 11 ? (Number(flat[i + 8]) || 100) : 100,
      grainMs: stride >= 11 ? (Number(flat[i + 9]) || 45) : 45,
      stretchMode: stride >= 11 && Number.isFinite(Number(flat[i + 10])) ? Math.max(0, Math.min(2, Math.round(Number(flat[i + 10])))) : 1
    });
  }
  if (next.length === 0 && savedList.length > 0) {
    // Re-push local saved items (e.g. from Live Set recall or early hotkey before node booted) to node.codebox
    for (let i = 0; i < savedList.length; i++) {
      const s = savedList[i];
      outlet(
        0,
        "save_selected",
        s.sampleIndex,
        s.name,
        s.catIdx,
        s.pitchSt,
        s.decayMs,
        s.gainDb,
        s.reverse ? 1 : 0,
        s.speedPct || 100,
        s.grainMs || 45,
        s.stretchMode !== undefined ? s.stretchMode : 1
      );
    }
    return;
  }
  savedList = next;
  clampSavedScroll();
  mgraphics.redraw();
}

function recallSavedEntry(savedIdx) {
  if (savedIdx < 0 || savedIdx >= savedList.length) return;
  selectedSavedIndex = savedIdx;
  const item = savedList[savedIdx];
  selectedIndex = item.sampleIndex;
  anchorIndex = item.sampleIndex;
  pitchSt = item.pitchSt;
  decayMs = item.decayMs;
  gainDb = item.gainDb;
  reversePlayback = item.reverse ? 1 : 0;
  speedPct = item.speedPct !== undefined ? item.speedPct : 100;
  grainMs = item.grainMs !== undefined ? item.grainMs : 45;
  stretchMode = item.stretchMode !== undefined ? item.stretchMode : (item.spectralPct > 0 ? 0 : 1);
  applyGrainDialState();
  playheadPos = 0.0;
  outlet(0, "recall_saved", savedIdx);
  outlet(1, "recalled_settings", pitchSt, decayMs, gainDb, reversePlayback, speedPct, grainMs, stretchMode);
  mgraphics.redraw();
}

function reorderSavedEntry(fromIdx, toIdx) {
  if (fromIdx < 0 || fromIdx >= savedList.length || toIdx < 0 || toIdx >= savedList.length || fromIdx === toIdx) {
    return;
  }
  const [moved] = savedList.splice(fromIdx, 1);
  savedList.splice(toIdx, 0, moved);
  selectedSavedIndex = toIdx;
  outlet(0, "reorder_saved", fromIdx, toIdx);
  notifyclients();
  mgraphics.redraw();
}

function removeSavedEntry(savedIdx) {
  if (savedIdx < 0 || savedIdx >= savedList.length) return;
  pushUndoState();
  savedList.splice(savedIdx, 1);
  if (selectedSavedIndex >= savedList.length) {
    selectedSavedIndex = savedList.length - 1;
  }
  clampSavedScroll();
  outlet(0, "remove_saved", savedIdx);
  notifyclients();
  mgraphics.redraw();
}

function hotkey_save() {
  const now = Date.now();
  if (now - lastHotkeySaveMs < 200) return null;
  lastHotkeySaveMs = now;
  return save_selected();
}

function delete_selected_saved() {
  const now = Date.now();
  if (now - lastHotkeyDelMs < 200) return;
  lastHotkeyDelMs = now;
  if (selectedSavedIndex >= 0 && selectedSavedIndex < savedList.length) {
    removeSavedEntry(selectedSavedIndex);
  }
}

function clearSavedList() {
  pushUndoState();
  savedList = [];
  selectedSavedIndex = -1;
  savedScrollOffset = 0;
  outlet(0, "clear_saved");
  notifyclients();
  mgraphics.redraw();
}

function startDragOut(mode, savedIdx, x, y) {
  let label = "Drag Raw";
  if (mode === "edited") label = "Drag Edited";
  else if (mode === "all_raw") label = `Drag All Raw (${savedList.length})`;
  else if (mode === "all_edited") label = `Drag All Edited (${savedList.length})`;

  dragOutState = {
    mode,
    savedIdx,
    label,
    x,
    y
  };
  outlet(0, "drag_out", mode, savedIdx);
  mgraphics.redraw();
}

// Arrow keys. The patcher's `key` object reports 28 / 29 / 30 / 31 (left / right / up / down) on macOS;
// v8ui's onkeydown may deliver the same codes or a name. Both are accepted. A single key press can reach the
// script through both paths (onkeydown AND obj-key -> obj-sel-key -> message), so each action is
// de-duplicated: the same action within ARROW_DEDUP_MS is ignored (key auto-repeat is slower than that).
const ARROW_DEDUP_MS = 20;
let historyNavAtMs = 0; // a selected_info right after a history key re-anchors the similarity tour
const lastArrowActionMs = { prev: 0, next: 0, back: 0, forward: 0 };

function arrowOnce(action) {
  const now = Date.now();
  if (now - lastArrowActionMs[action] < ARROW_DEDUP_MS) return false;
  lastArrowActionMs[action] = now;
  return true;
}

/** Left arrow = Prev Similar (same path as the toolbar button). */
function hotkey_prev_similar() {
  if (arrowOnce("prev")) applyToolbarAction("sim_prev");
}

/** Right arrow = Next Similar (same path as the toolbar button). */
function hotkey_next_similar() {
  if (arrowOnce("next")) applyToolbarAction("sim_next");
}

/** Down arrow = history Back (previously selected sound). */
function hotkey_history_back() {
  if (arrowOnce("back")) {
    historyNavAtMs = Date.now();
    outlet(0, "history_back");
  }
}

/** Up arrow = history Forward. */
function hotkey_history_forward() {
  if (arrowOnce("forward")) {
    historyNavAtMs = Date.now();
    outlet(0, "history_forward");
  }
}

/** @param {any} k */
function arrowKeyName(k) {
  if (k === 28 || k === "ArrowLeft") return "left";
  if (k === 29 || k === "ArrowRight") return "right";
  if (k === 30 || k === "ArrowUp") return "up";
  if (k === 31 || k === "ArrowDown") return "down";
  if (typeof k === "string") {
    const n = k.toLowerCase();
    if (n === "left" || n === "right" || n === "up" || n === "down") return n;
  }
  return "";
}

function key(k) {
  const arrow = arrowKeyName(k);
  if (arrow === "left") { hotkey_prev_similar(); return; }
  if (arrow === "right") { hotkey_next_similar(); return; }
  if (arrow === "down") { hotkey_history_back(); return; }
  if (arrow === "up") { hotkey_history_forward(); return; }
  if (k === 115 || k === 83 || k === "s" || k === "S") {
    hotkey_save();
    return;
  }
  if (k === 127 || k === 8 || k === -5 || k === -3 || k === "Delete" || k === "Backspace") {
    delete_selected_saved();
  }
}

function onkeydown(k) {
  key(k);
}

/**
 * Wheel / trackpad scroll. v8 exposes `onwheel` (confirmed in the v8 / jsui externals; the Max docs do not list
 * its arguments). The expected form is (x, y, ...modifiers, wheel_inc_x, wheel_inc_y) or simply (x, y, dx, dy):
 * the LAST TWO numeric arguments are taken as (dx, dy), and a pointer-like object with deltaY is also accepted.
 * Positive dy zooms in / scrolls up. Check the sign in Live: flip WHEEL_ZOOM_SIGN if it feels inverted.
 */
const WHEEL_ZOOM_SIGN = 1;

/** @param {any[]} args */
function parseWheelDelta(args) {
  const last = args.length > 0 ? args[args.length - 1] : null;
  if (last && typeof last === "object") {
    const oy = Number(last.deltaY !== undefined ? -last.deltaY : (last.wheelDeltaY !== undefined ? last.wheelDeltaY : 0));
    const ox = Number(last.deltaX !== undefined ? last.deltaX : 0);
    return [ox || 0, oy || 0];
  }
  const nums = args.slice(2).map(Number).filter((v) => Number.isFinite(v));
  if (nums.length >= 2) return [nums[nums.length - 2], nums[nums.length - 1]];
  if (nums.length === 1) return [0, nums[0]];
  return [0, 0];
}

function onwheel(x, y, ...rest) {
  xoRawLog("onwheel", arguments);
  const lay = getLayout();
  const [, dy] = parseWheelDelta([x, y, ...rest]);
  if (x >= lay.savedX && savedList.length > lay.savedMaxRows) {
    scrollSavedList(dy < 0 ? 1 : -1);
    return;
  }
  if (x < lay.savedX && y > lay.topBarH && y < lay.toolbarY && dy !== 0) {
    const clamped = Math.max(-3, Math.min(3, dy * WHEEL_ZOOM_SIGN));
    zoomViewAt(x, y, Math.exp(0.3 * clamped), lay);
  }
}

// ============================================================================
// Toolbar & Mouse Interaction
// ============================================================================

function applyToolbarAction(actionId) {
  pushUndoState();
  if (actionId.startsWith("cat_")) {
    const cat = actionId.slice(4);
    if (cat === "ALL") {
      activeCategory = "ALL";
    } else {
      activeCategory = (activeCategory === cat) ? "ALL" : cat;
    }
    ensureValidSelection();
    outlet(0, "set_cat", activeCategory);
    outlet(1, "filter_cat", activeCategory);
  } else if (actionId === "sim_prev") {
    stepLocalNeighbor(-1);
    outlet(0, "step_similar", -1);
  } else if (actionId === "sim_next") {
    stepLocalNeighbor(1);
    outlet(0, "step_similar", 1);
  } else if (actionId === "random") {
    const vis = [];
    for (let i = 0; i < points.length; i++) {
      if (isPointVisible(points[i])) vis.push(i);
    }
    if (vis.length > 0) {
      selectedIndex = vis[Math.floor(Math.random() * vis.length)];
      anchorIndex = selectedIndex;
      simTourKey = "";
      playheadPos = 0.0;
      outlet(0, "select_index", selectedIndex, 1);
    }
  } else if (actionId === "reseed") {
    localSeed = (localSeed + 1) >>> 0;
    simTourKey = "";
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const h = Math.sin((i + 1) * 12.9898 + localSeed * 78.233) * 43758.5453;
      const frac = h - Math.floor(h);
      const ang = (p.catIdx / CAT_ID_LIST.length) * Math.PI * 2 - Math.PI * 0.72 + (frac - 0.5) * 0.55;
      const rad = 0.16 + ((frac * 17) % 1.0) * 0.28;
      p.x = Math.max(0.04, Math.min(0.96, 0.5 + Math.cos(ang) * rad));
      p.y = Math.max(0.06, Math.min(0.94, 0.5 + Math.sin(ang) * rad));
    }
    outlet(0, "reseed_map");
  }
  notifyclients();
  mgraphics.redraw();
}

function buildLocalSimilarityTour(startIdx) {
  const vis = [];
  for (let i = 0; i < points.length; i++) {
    if (isPointVisible(points[i])) vis.push(i);
  }
  if (vis.length === 0) return [];
  const key = `${startIdx}|${vis.length}|${activeCategory}|${maxLenMs}|${toneFilter}|${searchQuery}|${localSeed}`;
  if (simTourKey === key && simTourCache.length === vis.length) {
    return simTourCache;
  }

  const remaining = new Set(vis);
  const start = remaining.has(startIdx) ? startIdx : vis[0];
  const tour = [start];
  remaining.delete(start);

  const nbrBoost = new Set((selectedMeta && selectedMeta.neighbors) || []);
  let cur = start;
  while (remaining.size > 0) {
    const cp = points[cur] || { x: 0.5, y: 0.5, catIdx: 0, brightness: 50, durationMs: 300 };
    let bestIdx = -1;
    let bestScore = Infinity;
    for (const cand of remaining) {
      const qp = points[cand];
      const dx = qp.x - cp.x;
      const dy = qp.y - cp.y;
      const dBright = ((qp.brightness || 50) - (cp.brightness || 50)) / 100.0;
      const dDur = ((qp.durationMs || 300) - (cp.durationMs || 300)) / 2000.0;
      let score = dx * dx * 2.5 + dy * dy * 2.5 + dBright * dBright * 0.4 + dDur * dDur * 0.3;
      if (qp.catIdx !== cp.catIdx) score += 0.25;
      if (cur === start && nbrBoost.has(cand)) score *= 0.25;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = cand;
      }
    }
    if (bestIdx < 0) break;
    tour.push(bestIdx);
    remaining.delete(bestIdx);
    cur = bestIdx;
  }

  simTourKey = key;
  simTourCache = tour;
  return tour;
}

function stepLocalNeighbor(dir) {
  const tour = buildLocalSimilarityTour(anchorIndex >= 0 ? anchorIndex : selectedIndex);
  if (tour.length === 0) return;
  let pos = tour.indexOf(selectedIndex);
  if (pos < 0) pos = 0;
  const step = Number(dir) >= 0 ? 1 : -1;
  const nextPos = (pos + step + tour.length) % tour.length;
  selectedIndex = tour[nextPos];
  playheadPos = 0.0;
}

/**
 * Pan gesture: middle mouse button (the legacy handlers receive a PointerEvent as a 9th argument whose
 * `buttons` bitmask has 4 for the middle button) or, as the fallback, Option-drag.
 */
function isPanGesture(option, pointerevent) {
  if (option) return true;
  return !!(pointerevent && typeof pointerevent === "object" && (Number(pointerevent.buttons) & 4));
}

function onclick(x, y, but, cmd, shift, capslock, option, ctrl, pointerevent) {
  xoRawLog("onclick", arguments);
  const lay = getLayout();
  panState = null; // a stale pan (release not delivered) must not hijack this gesture

  // --- RIGHT PANE: Saved Samples List & Drag-Out Dock (x >= lay.savedX) ---
  if (x >= lay.savedX) {
    // 1. Saved Header (y <= topBarH)
    if (y <= lay.topBarH) {
      if (x >= lay.savedX + 64 && x <= lay.savedX + 108) {
        save_selected();
        return;
      }
      if (x > lay.savedX + 108) {
        clearSavedList();
        return;
      }
      return;
    }

    // 2. Bottom Batch Drag-Out Bar (y >= lay.savedBottomY)
    if (y >= lay.savedBottomY) {
      const midSavedX = lay.savedX + lay.savedW * 0.5;
      if (x < midSavedX) {
        startDragOut("all_raw", -1, x, y);
      } else {
        startDragOut("all_edited", -1, x, y);
      }
      return;
    }

    // 3. Scrollbar track on far right edge (x >= lay.scrollbarX)
    if (x >= lay.scrollbarX && savedList.length > lay.savedMaxRows) {
      scrollbarDrag = true;
      const trackH = lay.savedBottomY - lay.savedRowY0;
      const normY = Math.max(0, Math.min(1, (y - lay.savedRowY0) / trackH));
      savedScrollOffset = Math.round(normY * Math.max(0, savedList.length - lay.savedMaxRows));
      clampSavedScroll();
      mgraphics.redraw();
      return;
    }

    // 4. Individual Saved Sample Rows
    const visRowIdx = Math.floor((y - lay.savedRowY0) / lay.savedRowH);
    const actualIdx = savedScrollOffset + visRowIdx;
    if (visRowIdx >= 0 && visRowIdx < lay.savedMaxRows && actualIdx >= 0 && actualIdx < savedList.length) {
      const rawZoneX0 = lay.savedX + lay.savedW - 52;
      const editZoneX0 = lay.savedX + lay.savedW - 35;
      const delZoneX0 = lay.savedX + lay.savedW - 18;

      if (x >= delZoneX0 && x < lay.scrollbarX) {
        removeSavedEntry(actualIdx);
      } else if (x >= editZoneX0 && x < delZoneX0) {
        startDragOut("edited", actualIdx, x, y);
      } else if (x >= rawZoneX0 && x < editZoneX0) {
        startDragOut("raw", actualIdx, x, y);
      } else {
        pushUndoState();
        recallSavedEntry(actualIdx);
        reorderDragState = {
          active: true,
          fromIdx: actualIdx,
          currentIdx: actualIdx,
          y
        };
      }
    }
    return;
  }

  // --- LEFT PANE: Waveform Viewer, 2D Map & Toolbar (x < lay.savedX) ---
  if (y <= lay.topBarH) {
    previewPressState = { x, y, dragged: false };
    return;
  }

  if (y >= lay.toolbarY) {
    const btnW = lay.mapW / TOOLBAR_ITEMS.length;
    const idx = Math.max(0, Math.min(TOOLBAR_ITEMS.length - 1, Math.floor(x / btnW)));
    applyToolbarAction(TOOLBAR_ITEMS[idx].id);
    return;
  }

  // Zoom indicator pill: click resets the view
  if (viewZoom > 1.0) {
    const zr = zoomPillRect(lay);
    if (x >= zr[0] && x <= zr[0] + zr[2] && y >= zr[1] && y <= zr[1] + zr[3]) {
      resetView();
      return;
    }
  }

  // Pan (middle button / Option-drag) leaves selection and scrubbing untouched
  if (isPanGesture(option, pointerevent)) {
    panState = { x, y, x0: viewX0, y0: viewY0 };
    return;
  }

  pushUndoState();
  isScrubbing = true;
  scrubTrail = [[x, y]];
  const hit = findNearestVisiblePoint(x, y, 26);
  if (hit >= 0) {
    selectedIndex = hit;
    anchorIndex = hit;
    simTourKey = "";
    playheadPos = 0.0;
    outlet(0, "select_index", hit, 1);
  }
  mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift, capslock, option, ctrl, pointerevent) {
  xoRawLog("ondrag", arguments);
  const lay = getLayout();

  if (panState) {
    if (!but) {
      panState = null;
    } else {
      viewX0 = panState.x0;
      viewY0 = panState.y0;
      panViewBy(x - panState.x, y - panState.y, lay);
    }
    return;
  }

  if (previewPressState) {
    if (!but) {
      const wasDragged = previewPressState.dragged;
      previewPressState = null;
      dragOutState = null;
      if (!wasDragged) {
        playheadPos = 0.0;
        outlet(0, "replay");
      }
      mgraphics.redraw();
      return;
    }
    if (!previewPressState.dragged && (Math.abs(x - previewPressState.x) >= 1 || Math.abs(y - previewPressState.y) >= 1)) {
      previewPressState.dragged = true;
      startDragOut("selected_raw", selectedIndex, x, y);
    }
    return;
  }

  if (!but) {
    if (isScrubbing || dragOutState || reorderDragState || scrollbarDrag) {
      isScrubbing = false;
      scrubTrail = [];
      dragOutState = null;
      reorderDragState = null;
      scrollbarDrag = false;
      notifyclients();
      mgraphics.redraw();
    }
    return;
  }

  if (scrollbarDrag) {
    const trackH = Math.max(1, lay.savedBottomY - lay.savedRowY0);
    const normY = Math.max(0, Math.min(1, (y - lay.savedRowY0) / trackH));
    savedScrollOffset = Math.round(normY * Math.max(0, savedList.length - lay.savedMaxRows));
    clampSavedScroll();
    mgraphics.redraw();
    return;
  }

  if (reorderDragState && reorderDragState.active) {
    reorderDragState.y = y;
    const visRow = Math.max(0, Math.min(lay.savedMaxRows - 1, Math.floor((y - lay.savedRowY0) / lay.savedRowH)));
    const targetIdx = Math.max(0, Math.min(savedList.length - 1, savedScrollOffset + visRow));
    if (targetIdx !== reorderDragState.currentIdx) {
      reorderSavedEntry(reorderDragState.currentIdx, targetIdx);
      reorderDragState.currentIdx = targetIdx;
    }
    mgraphics.redraw();
    return;
  }

  if (dragOutState) {
    dragOutState.x = x;
    dragOutState.y = y;
    mgraphics.redraw();
    return;
  }

  if (!isScrubbing) return;
  scrubTrail.push([x, y]);
  if (scrubTrail.length > 16) scrubTrail.shift();

  const hit = findNearestVisiblePoint(x, y, 24);
  if (hit >= 0 && hit !== selectedIndex) {
    selectedIndex = hit;
    anchorIndex = hit;
    playheadPos = 0.0;
    outlet(0, "select_index", hit, 1);
  }
  mgraphics.redraw();
}

function ondblclick(x, y, but, cmd, shift, capslock, option, ctrl) {
  const lay = getLayout();
  if (x < lay.savedX && y > lay.topBarH && y < lay.toolbarY) {
    const hit = findNearestVisiblePoint(x, y, 26);
    if (hit < 0 && viewZoom > 1.0) {
      // Double-click on empty map space (no sample within 26 px) resets zoom / pan
      resetView();
      return;
    }
    if (hit >= 0) {
      selectedIndex = hit;
      anchorIndex = hit;
      simTourKey = "";
      playheadPos = 0.0;
      outlet(0, "select_index", hit, 1);
      mgraphics.redraw();
    }
  }
}

function updateArmedDragZone(mode, savedIdx) {
  const key = `${mode}:${savedIdx}`;
  const now = Date.now();
  if (mode === "none") {
    if (lastArmedZoneKey !== "none:-1") {
      lastArmedZoneKey = "none:-1";
      lastArmSentMs = now;
      outlet(0, "arm_drag", "none", -1);
    }
    return;
  }
  if (key !== lastArmedZoneKey || (now - lastArmSentMs) >= 35) {
    lastArmedZoneKey = key;
    lastArmSentMs = now;
    outlet(0, "arm_drag", mode, savedIdx);
  }
}

function onidle(x, y, but, cmd, shift, capslock, option, ctrl) {
  const lay = getLayout();

  if (x >= lay.savedX) {
    if (hoveredIndex !== -1 || hoveredToolbarIndex !== -1) {
      hoveredIndex = -1;
      hoveredToolbarIndex = -1;
      mgraphics.redraw();
    }
    if (y <= lay.topBarH) {
      updateArmedDragZone("none", -1);
    } else if (y >= lay.savedBottomY) {
      if (x < lay.savedX + lay.savedW * 0.5) {
        updateArmedDragZone("all_raw", -1);
      } else {
        updateArmedDragZone("all_edited", -1);
      }
    } else {
      const visRowIdx = Math.floor((y - lay.savedRowY0) / lay.savedRowH);
      const actualIdx = savedScrollOffset + visRowIdx;
      if (visRowIdx >= 0 && visRowIdx < lay.savedMaxRows && actualIdx >= 0 && actualIdx < savedList.length) {
        const rawZoneX0 = lay.savedX + lay.savedW - 52;
        const editZoneX0 = lay.savedX + lay.savedW - 35;
        const delZoneX0 = lay.savedX + lay.savedW - 18;
        if (x >= delZoneX0 && x < lay.scrollbarX) {
          updateArmedDragZone("none", -1);
        } else if (x >= editZoneX0 && x < delZoneX0) {
          updateArmedDragZone("edited", actualIdx);
        } else if (x >= rawZoneX0 && x < editZoneX0) {
          updateArmedDragZone("raw", actualIdx);
        } else {
          updateArmedDragZone("none", -1);
        }
      } else {
        updateArmedDragZone("none", -1);
      }
    }
    return;
  }

  if (y <= lay.topBarH) {
    updateArmedDragZone("selected_raw", selectedIndex);
    if (hoveredIndex !== -1 || hoveredToolbarIndex !== -1) {
      hoveredIndex = -1;
      hoveredToolbarIndex = -1;
      mgraphics.redraw();
    }
    return;
  }

  updateArmedDragZone("none", -1);

  if (y >= lay.toolbarY) {
    const btnW = lay.mapW / TOOLBAR_ITEMS.length;
    const tIdx = Math.max(0, Math.min(TOOLBAR_ITEMS.length - 1, Math.floor(x / btnW)));
    if (tIdx !== hoveredToolbarIndex || hoveredIndex !== -1) {
      hoveredToolbarIndex = tIdx;
      hoveredIndex = -1;
      mgraphics.redraw();
    }
  } else if (y > lay.topBarH && y < lay.toolbarY) {
    const hit = findNearestVisiblePoint(x, y, 14);
    if (hit !== hoveredIndex || hoveredToolbarIndex !== -1) {
      hoveredIndex = hit;
      hoveredToolbarIndex = -1;
      mgraphics.redraw();
    }
  } else if (hoveredIndex !== -1 || hoveredToolbarIndex !== -1) {
    hoveredIndex = -1;
    hoveredToolbarIndex = -1;
    mgraphics.redraw();
  }
}

function onidleout() {
  if (hoveredIndex !== -1 || hoveredToolbarIndex !== -1) {
    hoveredIndex = -1;
    hoveredToolbarIndex = -1;
    mgraphics.redraw();
  }
}

// ============================================================================
// State Persistence (getvalueof / setvalueof)
// ============================================================================

function getvalueof() {
  const catIdx = CATEGORIES.findIndex((c) => c.id === activeCategory);
  const serializedMaxLen = isInfiniteMaxLen(maxLenMs) ? 5000 : maxLenMs;
  const out = [
    STATE_VERSION,
    catIdx >= 0 ? catIdx : 0,
    serializedMaxLen,
    toneFilter,
    pitchSt,
    decayMs,
    gainDb,
    selectedIndex,
    anchorIndex,
    savedList.length
  ];
  for (let i = 0; i < savedList.length; i++) {
    const s = savedList[i];
    out.push(s.sampleIndex, s.catIdx, s.pitchSt, s.decayMs, s.gainDb);
  }
  return out;
}

function setvalueof(...args) {
  const arr = (args.length === 1 && Array.isArray(args[0])) ? args[0] : args;
  if (!arr || arr.length < 2) return;
  const ver = Math.round(Number(arr[0]) || 1);
  if (ver === 1) {
    const catIdx = Math.max(0, Math.min(CATEGORIES.length - 1, Math.round(Number(arr[1]) || 0)));
    activeCategory = CATEGORIES[catIdx].id;
    const rawLen = Number(arr[2]) || 5000;
    maxLenMs = isInfiniteMaxLen(rawLen) ? Infinity : rawLen;
    toneFilter = Number(arr[3]) || 0;
    pitchSt = Number(arr[4]) || 0;
    decayMs = Number(arr[5]) || 2500;
    selectedIndex = Math.max(0, Math.round(Number(arr[7]) || 0));
    anchorIndex = Math.max(0, Math.round(Number(arr[8]) || 0));
  } else if (ver >= 2) {
    const catIdx = Math.max(0, Math.min(CATEGORIES.length - 1, Math.round(Number(arr[1]) || 0)));
    activeCategory = CATEGORIES[catIdx].id;
    const rawLen = Number(arr[2]) || 5000;
    maxLenMs = isInfiniteMaxLen(rawLen) ? Infinity : rawLen;
    toneFilter = Number(arr[3]) || 0;
    pitchSt = Number(arr[4]) || 0;
    decayMs = Number(arr[5]) || 2500;
    gainDb = Number(arr[6]) || 0;
    selectedIndex = Math.max(0, Math.round(Number(arr[7]) || 0));
    anchorIndex = Math.max(0, Math.round(Number(arr[8]) || 0));
    const count = Math.max(0, Math.round(Number(arr[9]) || 0));
    savedList = [];
    let offset = 10;
    for (let i = 0; i < count && offset + 4 < arr.length; i++, offset += 5) {
      const sIdx = Math.max(0, Math.round(Number(arr[offset]) || 0));
      const pt = points[sIdx];
      savedList.push({
        id: nextLocalSavedId++,
        sampleIndex: sIdx,
        name: pt ? pt.name : `Sample ${sIdx}`,
        catIdx: Number(arr[offset + 1]) || 0,
        pitchSt: Number(arr[offset + 2]) || 0,
        decayMs: Number(arr[offset + 3]) || 2500,
        gainDb: Number(arr[offset + 4]) || 0
      });
    }
  }
  clampSavedScroll();
  ensureValidSelection();
  mgraphics.redraw();
}

// ============================================================================
// Geometric Vector Toolbar Icon Renderer
// ============================================================================

function drawToolbarIcon(id, x, y, w, h, col, isActive) {
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  mgraphics.set_line_width(1.3);
  xoSrcRaw(col[0], col[1], col[2], isActive ? 1.0 : 0.88);

  if (id === "cat_ALL") {
    const r = 1.4;
    mgraphics.arc(cx - 2.6, cy - 2.6, r, 0, Math.PI * 2); mgraphics.fill();
    mgraphics.arc(cx + 2.6, cy - 2.6, r, 0, Math.PI * 2); mgraphics.fill();
    mgraphics.arc(cx - 2.6, cy + 2.6, r, 0, Math.PI * 2); mgraphics.fill();
    mgraphics.arc(cx + 2.6, cy + 2.6, r, 0, Math.PI * 2); mgraphics.fill();
  } else if (id === "cat_kick") {
    mgraphics.arc(cx, cy, 4.0, 0, Math.PI * 2);
    mgraphics.stroke();
    mgraphics.arc(cx, cy, 1.5, 0, Math.PI * 2);
    mgraphics.fill();
  } else if (id === "cat_snare") {
    mgraphics.rectangle(cx - 4.0, cy - 2.8, 8.0, 5.6);
    mgraphics.stroke();
    mgraphics.move_to(cx - 3.8, cy + 2.6);
    mgraphics.line_to(cx + 3.8, cy - 2.6);
    mgraphics.stroke();
  } else if (id === "cat_hihat") {
    mgraphics.move_to(cx - 4.2, cy - 1.2);
    mgraphics.line_to(cx + 4.2, cy - 1.2);
    mgraphics.move_to(cx - 4.2, cy + 1.2);
    mgraphics.line_to(cx + 4.2, cy + 1.2);
    mgraphics.move_to(cx, cy - 4.0);
    mgraphics.line_to(cx, cy + 4.2);
    mgraphics.stroke();
  } else if (id === "cat_clap") {
    mgraphics.move_to(cx - 3.8, cy + 3.0);
    mgraphics.line_to(cx - 1.8, cy - 3.8);
    mgraphics.line_to(cx - 0.3, cy + 2.2);
    mgraphics.line_to(cx + 1.5, cy - 3.2);
    mgraphics.line_to(cx + 3.5, cy + 3.0);
    mgraphics.stroke();
  } else if (id === "cat_tom") {
    mgraphics.rectangle_rounded(cx - 3.6, cy - 3.4, 7.2, 6.8, 1.5, 1.5);
    mgraphics.stroke();
    mgraphics.move_to(cx - 3.6, cy - 1.0);
    mgraphics.line_to(cx + 3.6, cy - 1.0);
    mgraphics.stroke();
  } else if (id === "cat_cymbal") {
    mgraphics.move_to(cx - 4.2, cy - 0.8);
    mgraphics.line_to(cx + 4.2, cy - 2.8);
    mgraphics.move_to(cx, cy - 1.8);
    mgraphics.line_to(cx, cy + 4.2);
    mgraphics.stroke();
  } else if (id === "cat_perc") {
    mgraphics.move_to(cx, cy - 3.8);
    mgraphics.line_to(cx + 4.0, cy + 3.2);
    mgraphics.line_to(cx - 4.0, cy + 3.2);
    mgraphics.close_path();
    mgraphics.stroke();
  } else if (id === "cat_fx") {
    mgraphics.move_to(cx - 4.2, cy);
    mgraphics.curve_to(cx - 1.8, cy - 4.6, cx - 0.6, cy - 4.6, cx, cy);
    mgraphics.curve_to(cx + 0.6, cy + 4.6, cx + 1.8, cy + 4.6, cx + 4.2, cy);
    mgraphics.stroke();
  } else if (id === "sim_prev") {
    mgraphics.move_to(cx + 1.8, cy - 3.6);
    mgraphics.line_to(cx - 2.0, cy);
    mgraphics.line_to(cx + 1.8, cy + 3.6);
    mgraphics.stroke();
  } else if (id === "sim_next") {
    mgraphics.move_to(cx - 1.8, cy - 3.6);
    mgraphics.line_to(cx + 2.0, cy);
    mgraphics.line_to(cx - 1.8, cy + 3.6);
    mgraphics.stroke();
  } else if (id === "random") {
    const r = 1.15;
    mgraphics.arc(cx - 2.5, cy - 2.4, r, 0, Math.PI * 2); mgraphics.fill();
    mgraphics.arc(cx + 2.5, cy - 2.4, r, 0, Math.PI * 2); mgraphics.fill();
    mgraphics.arc(cx,       cy,       r, 0, Math.PI * 2); mgraphics.fill();
    mgraphics.arc(cx - 2.5, cy + 2.4, r, 0, Math.PI * 2); mgraphics.fill();
    mgraphics.arc(cx + 2.5, cy + 2.4, r, 0, Math.PI * 2); mgraphics.fill();
  } else if (id === "reseed") {
    // Open circular refresh arrow + center seed dot using bezier curves
    const r = 3.8;
    mgraphics.move_to(cx - r, cy);
    mgraphics.curve_to(cx - r, cy - r * 1.1, cx + r * 0.8, cy - r * 1.1, cx + r * 0.85, cy - 1.2);
    mgraphics.stroke();
    mgraphics.move_to(cx + r * 0.85, cy + 1.4);
    mgraphics.curve_to(cx + r * 0.6, cy + r * 1.1, cx - r, cy + r * 1.1, cx - r, cy);
    mgraphics.stroke();
    // Arrowhead at top-right
    mgraphics.move_to(cx + 1.2, cy - 3.6);
    mgraphics.line_to(cx + 3.6, cy - 1.0);
    mgraphics.line_to(cx + 0.8, cy - 0.8);
    mgraphics.stroke();
    // Center seed dot
    mgraphics.arc(cx, cy, 1.0, 0, Math.PI * 2);
    mgraphics.fill();
  }
}

// ============================================================================
// MGraphics Vector Renderer
// ============================================================================

function paint() {
  const lay = getLayout();
  const { w, h, mapW, savedX, savedW, topBarH, plotX, plotY, plotW, plotH, toolbarY, toolbarH } = lay;

  // 1. Main Background
  xoSrc(0.055, 0.067, 0.086, 1.0);
  mgraphics.rectangle_rounded(0, 0, w, h, 4, 4);
  mgraphics.fill();

  // 2. Top Sample Inspector & Waveform Banner (Left Pane: 0..mapW)
  xoSrc(0.09, 0.11, 0.145, 1.0);
  mgraphics.rectangle(0, 0, mapW, topBarH);
  mgraphics.fill();

  const selCol = getCategoryColor(selectedMeta.catIdx || 0);
  xoSrcRaw(selCol[0], selCol[1], selCol[2], 1.0);
  mgraphics.arc(9, 10, 3.8, 0, Math.PI * 2);
  mgraphics.fill();

  mgraphics.select_font_face("Arial", "normal", "bold");
  mgraphics.set_font_size(9.0);
  xoSrc(0.94, 0.96, 0.98, 1.0);
  mgraphics.move_to(16, 13.5);
  const shortName = String(selectedMeta.name || "Select Sample").slice(0, 14);
  mgraphics.show_text(shortName);

  // Waveform Viewer with Scanning Playhead Line (x = 122..mapW-5)
  const peaks = selectedMeta.peaks || [];
  const waveX = 122;
  const waveW = mapW - waveX - 5;
  xoSrc(0.04, 0.05, 0.07, 1.0);
  mgraphics.rectangle_rounded(waveX - 2, 2, waveW + 4, topBarH - 4, 2, 2);
  mgraphics.fill();

  // Ableton-style waveform: filled min/max envelope, brighter RMS core, thin centre line.
  // Linear amplitude; Reverse mirrors it; Trim/Dec dims the part that will be cut.
  const wd = waveData || (peaks.length > 0 ? fallbackWaveFromPeaks(peaks) : null);
  const bannerTop = 2;
  const bannerH = topBarH - 4;
  const midY = bannerTop + bannerH / 2;
  const halfH = bannerH / 2 - 1;
  if (wd && wd.n > 0) {
    const mirror = reversePlayback ? true : false;
    const totDur = selectedMeta.durationMs || 300;
    const keepFrac = decayMs < totDur ? Math.max(0.0, Math.min(1.0, decayMs / Math.max(20, totDur))) : 1.0;
    const lastCol = wd.n - 1;
    // Kept columns: forward keeps the start, Reverse keeps the end (Trim/Dec sweeps the start of a reversed sample)
    const k0 = mirror ? Math.round(lastCol * (1.0 - keepFrac)) : 0;
    const k1 = mirror ? lastCol : Math.round(lastCol * keepFrac);

    if (keepFrac < 1.0) {
      xoSrcRaw(selCol[0], selCol[1], selCol[2], 0.25);
      waveformPolygon(wd, 0, lastCol, waveX, waveX + waveW, midY, halfH, mirror, false);
      mgraphics.fill();
    }
    xoSrcRaw(selCol[0], selCol[1], selCol[2], 0.82);
    waveformPolygon(wd, k0, k1, waveX, waveX + waveW, midY, halfH, mirror, false);
    mgraphics.fill();
    xoSrcRaw(
      Math.min(1, selCol[0] * 0.45 + 0.55),
      Math.min(1, selCol[1] * 0.45 + 0.55),
      Math.min(1, selCol[2] * 0.45 + 0.55),
      0.9
    );
    waveformPolygon(wd, k0, k1, waveX, waveX + waveW, midY, halfH, mirror, true);
    mgraphics.fill();
  }
  xoSrc(0.85, 0.9, 0.95, 0.28);
  mgraphics.set_line_width(0.6);
  mgraphics.move_to(waveX, midY);
  mgraphics.line_to(waveX + waveW, midY);
  mgraphics.stroke();

  // Visible Scanning Playhead Line across Waveform Viewer
  if (playheadPos >= 0.0 && playheadPos <= 1.0) {
    const scanX = waveX + playheadPos * waveW;
    xoSrc(0.22, 0.88, 1.0, 0.95);
    mgraphics.set_line_width(1.6);
    mgraphics.move_to(scanX, 2);
    mgraphics.line_to(scanX, topBarH - 2);
    mgraphics.stroke();

    mgraphics.move_to(scanX - 2.5, 2);
    mgraphics.line_to(scanX + 2.5, 2);
    mgraphics.line_to(scanX, 5.5);
    mgraphics.close_path();
    mgraphics.fill();
  }

  // 3. Center 2D Map Background & Radar Rings
  xoSrc(0.16, 0.20, 0.27, 0.35);
  mgraphics.set_line_width(1.0);
  const cx = plotX + plotW * 0.5;
  const cy = plotY + plotH * 0.5;
  mgraphics.arc(cx, cy, Math.min(plotW, plotH) * 0.24, 0, Math.PI * 2);
  mgraphics.stroke();
  mgraphics.arc(cx, cy, Math.min(plotW, plotH) * 0.44, 0, Math.PI * 2);
  mgraphics.stroke();

  // 4. Draw k-NN neighbor constellation lines from selected point
  const nbrSet = new Set(selectedMeta.neighbors || []);
  if (selectedIndex >= 0 && selectedIndex < points.length && isPointVisible(points[selectedIndex])) {
    const sp = points[selectedIndex];
    const [sx, sy] = normToScreen(sp.x, sp.y, lay);
    xoSrc(0.22, 0.74, 0.97, 0.35);
    mgraphics.set_line_width(1.0);
    for (const nIdx of nbrSet) {
      if (nIdx >= 0 && nIdx < points.length && isPointVisible(points[nIdx])) {
        const np = points[nIdx];
        const [nx, ny] = normToScreen(np.x, np.y, lay);
        const seg = clipSegmentToPlot(sx, sy, nx, ny, lay);
        if (!seg) continue;
        mgraphics.move_to(seg[0], seg[1]);
        mgraphics.line_to(seg[2], seg[3]);
        mgraphics.stroke();
      }
    }
  }

  // 5. Draw Scrub Trail
  if (scrubTrail.length > 1) {
    xoSrc(0.22, 0.74, 0.97, 0.50);
    mgraphics.set_line_width(2.0);
    for (let i = 0; i < scrubTrail.length; i++) {
      if (i === 0) mgraphics.move_to(scrubTrail[i][0], scrubTrail[i][1]);
      else mgraphics.line_to(scrubTrail[i][0], scrubTrail[i][1]);
    }
    mgraphics.stroke();
  }

  // 6. Draw Sample Points
  const ptRadius = points.length > 250 ? 2.1 : 2.6;
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    const vis = isPointVisible(pt);
    const [px, py] = normToScreen(pt.x, pt.y, lay);
    if (viewZoom > 1.0 && !isInPlotRect(px, py, lay, ptRadius + 1.0)) continue; // cull to the plot rect when zoomed
    if (!vis) {
      xoSrc(0.25, 0.30, 0.38, 0.22);
      mgraphics.arc(px, py, 1.4, 0, Math.PI * 2);
      mgraphics.fill();
      continue;
    }
    const col = getCategoryColor(pt.catIdx);
    xoSrcRaw(col[0], col[1], col[2], 0.92);
    mgraphics.arc(px, py, nbrSet.has(i) ? ptRadius + 0.7 : ptRadius, 0, Math.PI * 2);
    mgraphics.fill();
  }

  // 7. Highlight Selected & Hovered Point
  const hovPos = (hoveredIndex >= 0 && hoveredIndex < points.length) ? normToScreen(points[hoveredIndex].x, points[hoveredIndex].y, lay) : null;
  if (hovPos && isPointVisible(points[hoveredIndex]) && (viewZoom <= 1.0 || isInPlotRect(hovPos[0], hovPos[1], lay, ptRadius + 3.0))) {
    const [hx, hy] = hovPos;
    xoSrc(1.0, 1.0, 1.0, 0.85);
    mgraphics.set_line_width(1.2);
    mgraphics.arc(hx, hy, ptRadius + 2.8, 0, Math.PI * 2);
    mgraphics.stroke();
  }

  const selPos = (selectedIndex >= 0 && selectedIndex < points.length) ? normToScreen(points[selectedIndex].x, points[selectedIndex].y, lay) : null;
  if (selPos && isPointVisible(points[selectedIndex]) && (viewZoom <= 1.0 || isInPlotRect(selPos[0], selPos[1], lay, ptRadius + 5.6))) {
    const [sx, sy] = selPos;
    xoSrc(1.0, 1.0, 1.0, 0.22);
    mgraphics.arc(sx, sy, ptRadius + 5.5, 0, Math.PI * 2);
    mgraphics.fill();

    xoSrc(1.0, 1.0, 1.0, 1.0);
    mgraphics.set_line_width(1.7);
    mgraphics.arc(sx, sy, ptRadius + 3.0, 0, Math.PI * 2);
    mgraphics.stroke();
  }

  // 7b. Zoom indicator (bottom-left corner of the plot; the hover tooltip lives top-right)
  if (viewZoom > 1.0) {
    const zr = zoomPillRect(lay);
    xoSrc(0.08, 0.10, 0.13, 0.88);
    mgraphics.rectangle_rounded(zr[0], zr[1], zr[2], zr[3], 2, 2);
    mgraphics.fill();
    mgraphics.select_font_face("Arial", "normal", "bold");
    mgraphics.set_font_size(8.0);
    xoSrc(0.22, 0.74, 0.97, 1.0);
    mgraphics.move_to(zr[0] + 4, zr[1] + 8.5);
    mgraphics.show_text(`${viewZoom.toFixed(1)}x`);
  }

  // 8. Hover HUD Overlay Tooltip (only for 2D map points and map toolbar icons)
  let hudText = "";
  if (hoveredToolbarIndex >= 0 && hoveredToolbarIndex < TOOLBAR_ITEMS.length) {
    hudText = TOOLBAR_ITEMS[hoveredToolbarIndex].title;
  } else if (hoveredIndex >= 0 && hoveredIndex < points.length) {
    const hp = points[hoveredIndex];
    hudText = `${hp.name || hp.category} (${Math.round(hp.durationMs)}ms)`;
  }
  if (hudText) {
    const boxW = Math.min(mapW - 10, Math.max(72, hudText.length * 5.0 + 10));
    mgraphics.select_font_face("Arial", "normal", "bold");
    mgraphics.set_font_size(8.5);
    xoSrc(0.08, 0.10, 0.13, 0.90);
    mgraphics.rectangle_rounded(mapW - boxW - 5, plotY + 2, boxW, 13, 2, 2);
    mgraphics.fill();
    xoSrc(0.90, 0.93, 0.96, 0.96);
    mgraphics.move_to(mapW - boxW - 1, plotY + 11.5);
    mgraphics.show_text(hudText);
  }

  // 9. Bottom Geometric Vector Icon Toolbar (Left Pane: 0..mapW)
  xoSrc(0.11, 0.125, 0.15, 1.0);
  mgraphics.rectangle(0, toolbarY, mapW, toolbarH);
  mgraphics.fill();

  mgraphics.set_line_width(1.0);
  xoSrc(1.0, 1.0, 1.0, 0.1);
  mgraphics.move_to(0, toolbarY);
  mgraphics.line_to(mapW, toolbarY);
  mgraphics.stroke();

  const btnW = mapW / TOOLBAR_ITEMS.length;
  for (let i = 0; i < TOOLBAR_ITEMS.length; i++) {
    const item = TOOLBAR_ITEMS[i];
    const bx = i * btnW;
    const isHov = (hoveredToolbarIndex === i);
    let isActive = false;
    let iconCol = xoPaletteColor(0.72, 0.76, 0.82, 1.0);

    if (item.id.startsWith("cat_")) {
      const cat = item.id.slice(4);
      isActive = (activeCategory === cat);
      const found = CATEGORIES.find((c) => c.id === cat);
      if (found) iconCol = xoPaletteCat(found.id, found.color);
    } else if (isHov) {
      iconCol = xoPaletteColor(0.22, 0.74, 0.97, 1.0);
    }

    if (isActive) {
      xoSrcRaw(iconCol[0], iconCol[1], iconCol[2], 0.24);
      mgraphics.rectangle(bx + 0.5, toolbarY + 1, btnW - 1, toolbarH - 2);
      mgraphics.fill();
    } else if (isHov) {
      xoSrc(1.0, 1.0, 1.0, 0.08);
      mgraphics.rectangle(bx + 0.5, toolbarY + 1, btnW - 1, toolbarH - 2);
      mgraphics.fill();
    }

    if (i > 0) {
      xoSrc(1.0, 1.0, 1.0, 0.07);
      mgraphics.move_to(bx, toolbarY + 3);
      mgraphics.line_to(bx, toolbarY + toolbarH - 3);
      mgraphics.stroke();
    }

    drawToolbarIcon(item.id, bx, toolbarY, btnW, toolbarH, iconCol, isActive || isHov);
  }

  // ==========================================================================
  // 10. RIGHT PANE: Scrollable, Selectable, Reorderable & Deletable Saved List
  // ==========================================================================
  if (!showSavedList || savedW <= 0) return;

  xoSrc(0.075, 0.09, 0.115, 1.0);
  mgraphics.rectangle(savedX, 0, savedW, h);
  mgraphics.fill();

  xoSrc(0.22, 0.26, 0.33, 1.0);
  mgraphics.set_line_width(1.0);
  mgraphics.move_to(savedX, 0);
  mgraphics.line_to(savedX, h);
  mgraphics.stroke();

  // Saved List Top Bar
  xoSrc(0.10, 0.12, 0.16, 1.0);
  mgraphics.rectangle(savedX + 1, 0, savedW - 1, topBarH);
  mgraphics.fill();

  mgraphics.select_font_face("Arial", "normal", "bold");
  mgraphics.set_font_size(8.5);
  xoSrc(1.0, 0.71, 0.20, 1.0);
  mgraphics.move_to(savedX + 5, 13.5);
  mgraphics.show_text(`SAVED (${savedList.length})`);

  // "+Save" mini button in header
  xoSrc(0.20, 0.74, 0.45, 0.28);
  mgraphics.rectangle_rounded(savedX + 65, 3, 42, 14, 2, 2);
  mgraphics.fill();
  xoSrc(0.35, 0.90, 0.55, 1.0);
  mgraphics.move_to(savedX + 73, 13);
  mgraphics.show_text("+Save");

  // Clear All ("x") mini button in header
  xoSrc(0.20, 0.24, 0.30, 1.0);
  mgraphics.rectangle_rounded(savedX + 111, 3, 20, 14, 2, 2);
  mgraphics.fill();
  xoSrc(0.75, 0.80, 0.86, 0.9);
  mgraphics.set_line_width(1.2);
  mgraphics.move_to(savedX + 118, 7);
  mgraphics.line_to(savedX + 124, 13);
  mgraphics.move_to(savedX + 124, 7);
  mgraphics.line_to(savedX + 118, 13);
  mgraphics.stroke();

  // Saved Sample Rows (Scrollable window of up to 4 rows)
  if (savedList.length === 0) {
    mgraphics.select_font_face("Arial", "normal", "normal");
    mgraphics.set_font_size(8.5);
    xoSrc(0.50, 0.55, 0.62, 1.0);
    mgraphics.move_to(savedX + 10, 56);
    mgraphics.show_text("Press 'S' or +Save");
    mgraphics.move_to(savedX + 10, 69);
    mgraphics.show_text("to keep samples +");
    mgraphics.move_to(savedX + 10, 82);
    mgraphics.show_text("playback settings");
  } else {
    const maxVis = Math.min(lay.savedMaxRows, savedList.length - savedScrollOffset);
    for (let r = 0; r < maxVis; r++) {
      const actualIdx = savedScrollOffset + r;
      const item = savedList[actualIdx];
      if (!item) continue;
      const ry = lay.savedRowY0 + r * lay.savedRowH;
      const isRowSelected = (actualIdx === selectedSavedIndex);

      xoSrc(
        isRowSelected ? 0.14 : 0.11,
        isRowSelected ? 0.19 : 0.135,
        isRowSelected ? 0.26 : 0.175,
        1.0
      );
      mgraphics.rectangle_rounded(savedX + 3, ry + 1, savedW - 10, lay.savedRowH - 2, 2, 2);
      mgraphics.fill();

      if (isRowSelected) {
        xoSrc(0.22, 0.74, 0.97, 0.85);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle_rounded(savedX + 3, ry + 1, savedW - 10, lay.savedRowH - 2, 2, 2);
        mgraphics.stroke();
      }

      const cCol = getCategoryColor(item.catIdx || 0);
      xoSrcRaw(cCol[0], cCol[1], cCol[2], 1.0);
      mgraphics.arc(savedX + 8, ry + 7, 2.5, 0, Math.PI * 2);
      mgraphics.fill();

      mgraphics.select_font_face("Arial", "normal", "bold");
      mgraphics.set_font_size(8.0);
      xoSrc(0.92, 0.95, 0.98, 1.0);
      mgraphics.move_to(savedX + 13, ry + 9.5);
      mgraphics.show_text(String(item.name).slice(0, 12));

      mgraphics.select_font_face("Arial", "normal", "normal");
      mgraphics.set_font_size(7.5);
      xoSrc(0.58, 0.64, 0.72, 1.0);
      const pStr = item.pitchSt >= 0 ? `+${item.pitchSt}st` : `${item.pitchSt}st`;
      const revSuffix = item.reverse ? "•Rev" : "";
      mgraphics.move_to(savedX + 13, ry + 18.5);
      mgraphics.show_text(`${pStr}•${Math.round(item.decayMs)}m${revSuffix}`);

      // Per-Row Action Buttons: [R] (Raw), [E] (Edited), [x] (Delete)
      const rawX = savedX + savedW - 52;
      const editX = savedX + savedW - 35;
      const delX = savedX + savedW - 19;

      // [R] Raw Drag Handle
      xoSrc(0.18, 0.23, 0.30, 1.0);
      mgraphics.rectangle_rounded(rawX, ry + 3, 15, 15, 2, 2);
      mgraphics.fill();
      mgraphics.select_font_face("Arial", "normal", "bold");
      mgraphics.set_font_size(7.8);
      xoSrc(0.78, 0.84, 0.92, 1.0);
      mgraphics.move_to(rawX + 4.2, ry + 13);
      mgraphics.show_text("R");

      // [E] Edited Drag Handle
      xoSrc(0.22, 0.74, 0.97, 0.25);
      mgraphics.rectangle_rounded(editX, ry + 3, 15, 15, 2, 2);
      mgraphics.fill();
      xoSrc(0.22, 0.74, 0.97, 1.0);
      mgraphics.move_to(editX + 4.2, ry + 13);
      mgraphics.show_text("E");

      // [x] Delete Row Button (geometric vector X)
      xoSrc(0.26, 0.16, 0.18, 0.85);
      mgraphics.rectangle_rounded(delX, ry + 3, 12, 15, 2, 2);
      mgraphics.fill();
      xoSrc(0.95, 0.45, 0.48, 0.95);
      mgraphics.set_line_width(1.1);
      mgraphics.move_to(delX + 3.5, ry + 8);
      mgraphics.line_to(delX + 8.5, ry + 13);
      mgraphics.move_to(delX + 8.5, ry + 8);
      mgraphics.line_to(delX + 3.5, ry + 13);
      mgraphics.stroke();
    }

    // Scrollbar Track & Thumb (on right edge of Saved List)
    const trackX = w - 4;
    const trackY = lay.savedRowY0 + 2;
    const trackH = lay.savedBottomY - lay.savedRowY0 - 4;
    xoSrc(0.14, 0.17, 0.22, 1.0);
    mgraphics.rectangle_rounded(trackX, trackY, 3, trackH, 1.5, 1.5);
    mgraphics.fill();

    const thumbRatio = Math.min(1.0, lay.savedMaxRows / Math.max(1, savedList.length));
    const thumbH = Math.max(12, trackH * thumbRatio);
    const maxScroll = Math.max(1, savedList.length - lay.savedMaxRows);
    const thumbY = trackY + (savedScrollOffset / maxScroll) * (trackH - thumbH);
    xoSrc(0.45, 0.55, 0.68, 0.9);
    mgraphics.rectangle_rounded(trackX, thumbY, 3, thumbH, 1.5, 1.5);
    mgraphics.fill();
  }

  // Bottom Batch Drag-Out Zones: [Drag Raw] vs [Drag Edit]
  xoSrc(0.10, 0.12, 0.155, 1.0);
  mgraphics.rectangle(savedX + 1, lay.savedBottomY, savedW - 1, toolbarH);
  mgraphics.fill();

  const halfW = (savedW - 8) * 0.5;
  xoSrc(0.16, 0.20, 0.26, 1.0);
  mgraphics.rectangle_rounded(savedX + 3, lay.savedBottomY + 3, halfW, toolbarH - 6, 2, 2);
  mgraphics.fill();
  mgraphics.select_font_face("Arial", "normal", "bold");
  mgraphics.set_font_size(8.0);
  xoSrc(0.84, 0.88, 0.94, 1.0);
  mgraphics.move_to(savedX + 14, lay.savedBottomY + 14);
  mgraphics.show_text("Drag Raw");

  xoSrc(1.0, 0.69, 0.18, 0.24);
  mgraphics.rectangle_rounded(savedX + 5 + halfW, lay.savedBottomY + 3, halfW, toolbarH - 6, 2, 2);
  mgraphics.fill();
  xoSrc(1.0, 0.73, 0.22, 1.0);
  mgraphics.move_to(savedX + 16 + halfW, lay.savedBottomY + 14);
  mgraphics.show_text("Drag Edit");
}

// ============================================================================
// Test hook (`receive #0-xo-test` -> this v8ui; messnamed("#0-xo-test", ...)). Used by tests/test_xo_map.js (mocks) and scripts/test_xo_live.js
// (Live, through the MCP bridge):
//   test_report                    writes the state below to Global("xo_test") as report_<device id> and last
//   test_wheel x y dx dy           calls onwheel with synthetic arguments
//   test_click x y [shift] [option]  calls onclick;  test_drag x y [option]  calls ondrag;  test_release x y  ondrag with button up
//   test_select idx                select_index idx (audition)
//   test_replay                    same as clicking the waveform (replay -> render + audition)
//   test_clear_log                 forgets the selected_info log
//   test_section saved|filters|playback|options 0|1   sets that toolbar toggle (a hidden parameter, so the LOM can't): the
//                                  live.text outputs, exactly as a click does, through the real patcher wiring
//   test_theme LCD|Focus|<index>   sets the Theme tab (Options section), the same way
//   test_mirror <layout box id> <v>  sends a value to a theme mirror widget (obj-<x>-dial-mir) as a user drag would
// Real (non-synthetic) event arguments are kept in `raw` (last arguments Max passed to onwheel / onclick / ondrag).
// ============================================================================

const xoSelLog = [];
const xoRaw = {};
const xoRawCount = {};
let xoSynthetic = false;
let xoLastWidth = -1;
/** @type {any} */
let xoAudition = null;

/** @param {string} name @param {IArguments} args */
function xoRawLog(name, args) {
  if (xoSynthetic) return;
  try {
    xoRaw[name] = Array.prototype.map.call(args, function (a) {
      return (a !== null && typeof a === "object") ? "<" + Object.prototype.toString.call(a) + ":" + Object.keys(a).slice(0, 8).join(",") + ">" : a;
    });
    xoRawCount[name] = (xoRawCount[name] || 0) + 1;
  } catch (e) {}
}

function test_width(w) {
  xoLastWidth = Number(w);
}

/** audition_info <file> <ms> <frames> <rendered> <engine> <pitch> <speed> <mode> */
function audition_info(file, ms, frames, rendered, engine, pitch, speed, mode) {
  xoAudition = { file: String(file), ms: Number(ms), frames: Number(frames), rendered: Number(rendered), engine: String(engine), pitchSt: Number(pitch), speedPct: Number(speed), mode: Number(mode) };
}

function xoDeviceId() {
  try {
    if (typeof LiveAPI !== "undefined") return String(new LiveAPI("this_device").id);
  } catch (err) {}
  return "0";
}

function test_clear_log() {
  xoSelLog.length = 0;
  xoAudition = null;
}

/** @param {...any} a */
function test_wheel(...a) {
  xoSynthetic = true;
  try { onwheel(...a); } finally { xoSynthetic = false; }
}

function test_click(x, y, shift, option) {
  xoSynthetic = true;
  try { onclick(Number(x), Number(y), 1, 0, Number(shift) || 0, 0, Number(option) || 0, 0); } finally { xoSynthetic = false; }
}

function test_drag(x, y, option) {
  xoSynthetic = true;
  try { ondrag(Number(x), Number(y), 1, 0, 0, 0, Number(option) || 0, 0); } finally { xoSynthetic = false; }
}

function test_release(x, y) {
  xoSynthetic = true;
  try { ondrag(Number(x), Number(y), 0, 0, 0, 0, 0, 0); } finally { xoSynthetic = false; }
}

const XO_SECTION_TOGGLES = { saved: "ShowSavedList", filters: "ShowFiltersSection", playback: "ShowPlaybackSection", options: "ShowOptions" };

function test_section(which, v) {
  const name = XO_SECTION_TOGGLES[String(which)];
  const obj = (name && xoHostPatcher) ? xoHostPatcher.getnamed(name) : null;
  if (obj) obj.message("int", Number(v) ? 1 : 0);
}

/** @param {string | number} name */
function test_theme(name) {
  const obj = xoHostPatcher ? xoHostPatcher.getnamed("Theme") : null;
  const idx = (typeof XO_THEMES !== "undefined" && typeof name === "string" && XO_THEMES.indexOf(name) >= 0) ? XO_THEMES.indexOf(name) : Math.round(Number(name));
  if (obj) obj.message("int", idx);
}

/** @param {string} id @param {number} v */
function test_mirror(id, v) {
  const obj = (xoHostPatcher && typeof XO_LAYOUT_NAMES !== "undefined") ? xoHostPatcher.getnamed(XO_LAYOUT_NAMES[id] || id) : null;
  if (obj) obj.message("float", Number(v));
}

function test_select(idx) {
  outlet(0, "select_index", Number(idx), 1);
}

function test_replay() {
  outlet(0, "replay");
}

function test_report() {
  const pat = xoHostPatcher;
  /** @type {Object<string, any>} */
  const boxes = {};
  if (pat && typeof pat.getnamed === "function" && typeof XO_LAYOUT_NAMES !== "undefined") {
    for (const id of Object.keys(XO_LAYOUT_NAMES)) {
      const obj = pat.getnamed(XO_LAYOUT_NAMES[id]);
      if (!obj) { boxes[id] = null; continue; }
      let rect = null;
      try { rect = Array.prototype.slice.call(obj.getattr("presentation_rect")); } catch (e) {}
      boxes[id] = { rect: rect, hidden: obj.hidden ? 1 : 0 };
    }
  }
  // Mirror widgets' values and one styled attribute, to check the parameter -> mirror sync and the theme style.
  /** @type {Object<string, any>} */
  const mirrors = {};
  /** @type {Object<string, any>} */
  const mirrorAttrs = {};
  /** @type {Object<string, any>} */
  const sources = {};
  /** @type {Object<string, any>} */
  const styled = {};
  if (pat && typeof pat.getnamed === "function" && typeof XO_LAYOUT_NAMES !== "undefined") {
    for (const id of Object.keys(XO_LAYOUT_NAMES)) {
      if (!/-mir$/.test(id)) continue;
      const obj = pat.getnamed(XO_LAYOUT_NAMES[id]);
      try { mirrors[id] = obj ? Number(obj.getvalueof()) : null; } catch (e) { mirrors[id] = null; }
      try { const so = pat.getnamed(XO_LAYOUT_NAMES[id.replace(/-mir$/, "")] || id.replace(/-mir$/, "")); sources[id] = so ? Number(so.getvalueof()) : null; } catch (e) { sources[id] = null; }
      // the parameter attributes Max applied (only a real parameter has them) of the mirror and of its source object
      for (const [key, oid] of [[id, id], [id.replace(/-mir$/, ""), id.replace(/-mir$/, "")]]) {
        const o2 = pat.getnamed(XO_LAYOUT_NAMES[oid] || oid);
        /** @type {Object<string, any>} */
        const at = {};
        for (const n of ["_parameter_range", "_parameter_unitstyle", "_parameter_type", "_parameter_exponent", "_parameter_steps", "_parameter_longname"]) {
          try { at[n] = o2 ? JSON.stringify(o2.getattr(n)) : null; } catch (e) { at[n] = "ERR"; }
        }
        mirrorAttrs[key] = at;
      }
    }
    for (const id of ["obj-panel-filters", "obj-panel-playback", "obj-panel-options", "obj-hdr-filters", "obj-reseed-filtered-btn"]) {
      const obj = pat.getnamed(XO_LAYOUT_NAMES[id] || id);
      if (!obj) continue;
      try {
        styled[id] = { bgcolor: Array.prototype.slice.call(obj.getattr("bgcolor")), text: String(obj.getattr("text")) };
      } catch (e) {}
    }
  }
  let devWidth = -1;
  try { devWidth = Number(pat.getattr("devicewidth")); } catch (e) {}
  const sz = mgraphics.size || [0, 0];
  const lay = getLayout();
  const report = {
    selectedIndex: selectedIndex,
    name: selectedMeta.name,
    durMs: selectedMeta.durationMs,
    nPoints: points.length,
    waveN: waveData ? waveData.n : 0,
    view: getView(),
    sections: getXoSectionVisibility(),
    options: showOptionsSection,
    theme: getXoThemeName(),
    mirrors: mirrors,
    mirrorAttrs: mirrorAttrs,
    sources: sources,
    styled: styled,
    boxes: boxes,
    width: xoLastWidth,
    devicewidthAttr: devWidth,
    v8size: [sz[0], sz[1]],
    mapW: lay.mapW,
    savedX: lay.savedX,
    selLog: xoSelLog.slice(),
    raw: xoRaw,
    rawCount: xoRawCount,
    audition: xoAudition,
    savedCount: savedList.length
  };
  const g = new Global("xo_test");
  const text = JSON.stringify(report);
  g["report_" + xoDeviceId()] = text;
  g.last = text;
}
