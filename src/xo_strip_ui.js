/*
 * XO Sample Map — In-Device Mini Editor: 2D Map, Waveform Scanner & Saved Samples List (src/xo_strip_ui.js)
 * Embedded in Max 9 v8ui object (presentation_rect: [10.0, 27.0, 372.0, 134.0])
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
  { id: "random",     title: "Random Sample" }
];

let points = [];
let selectedIndex = 0;
let anchorIndex = 0;
let hoveredIndex = -1;
let hoveredToolbarIndex = -1;
let hoveredZoneTitle = "";
let lastArmedZoneKey = "";

// Active Audition Filters (maxLenMs >= 4990 or Infinity = Infinite)
let activeCategory = "ALL";
let maxLenMs = 5000;
let toneFilter = 0;
let searchQuery = "";

// Active Playback Settings
let pitchSt = 0;
let decayMs = 2500;
let gainDb = 0;
let playheadPos = 0.32;

// Saved Samples List (scrollable, selectable, drag-reorderable, deletable)
let savedList = [];
let selectedSavedIndex = 0;
let savedScrollOffset = 0;
let nextLocalSavedId = 1;

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

let isScrubbing = false;
let scrubTrail = [];
let dragOutState = null;     // { mode, savedIdx, label, x, y }
let reorderDragState = null; // { active: true, fromIdx, currentIdx, y }
let scrollbarDrag = false;
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 64;

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
      name: `${sampleNames[catIdx]} ${clusterIdx + 1}`
    });
  }
  selectedIndex = 0;
  anchorIndex = 0;
  selectedMeta.neighbors = [10, 20, 30, 40, 50, 1, 11];
  savedList = [
    { id: 1, sampleIndex: 0, name: "Kick Atmos", catIdx: 0, pitchSt: 0, decayMs: 320, gainDb: 0 },
    { id: 2, sampleIndex: 1, name: "Snare Crisp", catIdx: 1, pitchSt: 3, decayMs: 450, gainDb: -1.5 }
  ];
  selectedSavedIndex = 0;
  savedScrollOffset = 0;
  nextLocalSavedId = 3;
}

initDefaultConstellation();

function getLayout() {
  const sz = mgraphics.size || [372, 134];
  const w = sz[0];
  const h = sz[1];
  const savedW = 136;
  const mapW = w - savedW;
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
    savedMaxRows: 4,
    savedBottomY: h - 22,
    scrollbarX: w - 5
  };
}

function normToScreen(nx, ny, lay) {
  const padX = 5;
  const padY = 6;
  return [
    lay.plotX + padX + nx * (lay.plotW - padX * 2),
    lay.plotY + padY + ny * (lay.plotH - padY * 2)
  ];
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
  if (searchQuery && searchQuery.trim().length > 0) {
    const q = searchQuery.trim().toLowerCase();
    const nm = (pt.name || "").toLowerCase();
    const ct = (pt.category || "").toLowerCase();
    if (!nm.includes(q) && !ct.includes(q)) return false;
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
  return entry.color;
}

function findNearestVisiblePoint(sx, sy, maxDistPx) {
  const lay = getLayout();
  let bestIdx = -1;
  let bestD2 = maxDistPx * maxDistPx;
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (!isPointVisible(pt)) continue;
    const pos = normToScreen(pt.x, pt.y, lay);
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
  const stride = (flat.length % 6 === 0 && typeof flat[5] === "string") ? 6 : 5;
  for (let i = 0; i + (stride - 1) < flat.length; i += stride) {
    const x = Number(flat[i]);
    const y = Number(flat[i + 1]);
    const catIdx = Math.max(0, Math.min(CAT_ID_LIST.length - 1, Number(flat[i + 2]) || 0));
    const durationMs = Number(flat[i + 3]) || 200;
    const brightness = Number(flat[i + 4]) || 50;
    const name = stride === 6 ? String(flat[i + 5] || `Sample_${offset + i / stride}`) : `Sample_${offset + i / stride}`;
    const idx = offset + (i / stride);
    points[idx] = {
      x,
      y,
      catIdx,
      category: CAT_ID_LIST[catIdx],
      durationMs,
      brightness,
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
  selectedIndex = Number(idx) || 0;
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
  mgraphics.redraw();
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

function getPoints() {
  return points;
}

function getSelectedIndex() {
  return selectedIndex;
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
  pushUndoState();
  const pt = points[selectedIndex] || { name: selectedMeta.name, catIdx: selectedMeta.catIdx, category: selectedMeta.category, durationMs: selectedMeta.durationMs };
  const entry = {
    id: nextLocalSavedId++,
    sampleIndex: selectedIndex,
    name: (selectedIndex >= 0 && pt && pt.name) ? pt.name : (selectedMeta.name || `Sample ${selectedIndex}`),
    catIdx: pt ? pt.catIdx : (selectedMeta.catIdx || 0),
    pitchSt,
    decayMs,
    gainDb
  };
  savedList.push(entry);
  selectedSavedIndex = savedList.length - 1;
  const lay = getLayout();
  if (selectedSavedIndex >= savedScrollOffset + lay.savedMaxRows) {
    savedScrollOffset = selectedSavedIndex - lay.savedMaxRows + 1;
  }
  clampSavedScroll();
  outlet(0, "save_selected");
  notifyclients();
  mgraphics.redraw();
  return entry;
}

function saved_list_sync(count, ...flat) {
  const next = [];
  for (let i = 0; i + 6 < flat.length; i += 7) {
    next.push({
      id: Number(flat[i]) || (i + 1),
      sampleIndex: Number(flat[i + 1]) || 0,
      name: String(flat[i + 2] || "Sample"),
      catIdx: Number(flat[i + 3]) || 0,
      pitchSt: Number(flat[i + 4]) || 0,
      decayMs: Number(flat[i + 5]) || 2500,
      gainDb: Number(flat[i + 6]) || 0
    });
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
  playheadPos = 0.0;
  outlet(0, "recall_saved", savedIdx);
  outlet(1, "recalled_settings", pitchSt, decayMs, gainDb);
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

function key(k) {
  // 's' (115) or 'S' (83) hotkey saves the currently selected sample with its playback settings
  if (k === 115 || k === 83 || k === "s" || k === "S") {
    save_selected();
    return;
  }
  // Delete (127, -5, "Delete") or Backspace (8, -3, "Backspace") removes selected saved item
  if (k === 127 || k === 8 || k === -5 || k === -3 || k === "Delete" || k === "Backspace") {
    if (selectedSavedIndex >= 0 && selectedSavedIndex < savedList.length) {
      removeSavedEntry(selectedSavedIndex);
    }
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
      playheadPos = 0.0;
      outlet(0, "select_index", selectedIndex, 1);
    }
  }
  notifyclients();
  mgraphics.redraw();
}

function stepLocalNeighbor(dir) {
  const rawNbrs = (selectedMeta && selectedMeta.neighbors && selectedMeta.neighbors.length > 0)
    ? selectedMeta.neighbors
    : [];
  const validNbrs = rawNbrs.filter((idx) => idx >= 0 && idx < points.length && isPointVisible(points[idx]));
  const pool = [];
  if (selectedIndex >= 0 && selectedIndex < points.length && isPointVisible(points[selectedIndex])) {
    pool.push(selectedIndex);
  }
  for (const n of validNbrs) {
    if (!pool.includes(n)) pool.push(n);
  }
  if (pool.length <= 1) {
    for (let i = 0; i < points.length; i++) {
      if (isPointVisible(points[i]) && !pool.includes(i)) pool.push(i);
    }
  }
  if (pool.length === 0) return;
  let pos = pool.indexOf(selectedIndex);
  if (pos < 0) pos = 0;
  const nextPos = (pos + dir + pool.length) % pool.length;
  selectedIndex = pool[nextPos];
  playheadPos = 0.0;
  outlet(0, "select_index", selectedIndex, 1);
}

function onclick(x, y, but, cmd, shift, capslock, option, ctrl) {
  const lay = getLayout();

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
    playheadPos = 0.0;
    outlet(0, "replay");
    mgraphics.redraw();
    return;
  }

  if (y >= lay.toolbarY) {
    const btnW = lay.mapW / TOOLBAR_ITEMS.length;
    const idx = Math.max(0, Math.min(TOOLBAR_ITEMS.length - 1, Math.floor(x / btnW)));
    applyToolbarAction(TOOLBAR_ITEMS[idx].id);
    return;
  }

  pushUndoState();
  isScrubbing = true;
  scrubTrail = [[x, y]];
  const hit = findNearestVisiblePoint(x, y, 26);
  if (hit >= 0) {
    selectedIndex = hit;
    anchorIndex = hit;
    playheadPos = 0.0;
    outlet(0, "select_index", hit, 1);
  }
  mgraphics.redraw();
}

function ondrag(x, y, but, cmd, shift, capslock, option, ctrl) {
  const lay = getLayout();

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
    if (hit >= 0) {
      selectedIndex = hit;
      anchorIndex = hit;
      save_selected();
    }
  }
}

function updateArmedDragZone(mode, savedIdx) {
  const key = `${mode}:${savedIdx}`;
  if (key !== lastArmedZoneKey) {
    lastArmedZoneKey = key;
    outlet(0, "arm_drag", mode, savedIdx);
  }
}

function onidle(x, y, but, cmd, shift, capslock, option, ctrl) {
  const lay = getLayout();
  hoveredZoneTitle = "";

  if (x >= lay.savedX) {
    hoveredIndex = -1;
    hoveredToolbarIndex = -1;
    if (y <= lay.topBarH) {
      updateArmedDragZone("none", -1);
      hoveredZoneTitle = x >= lay.savedX + 108 ? "Clear Saved List" : "Save Sample + Settings (S)";
    } else if (y >= lay.savedBottomY) {
      if (x < lay.savedX + lay.savedW * 0.5) {
        hoveredZoneTitle = "Drag All Saved (Raw)";
        updateArmedDragZone("all_raw", -1);
      } else {
        hoveredZoneTitle = "Drag All Saved (Edited)";
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
          hoveredZoneTitle = "Delete from Saved List";
          updateArmedDragZone("none", -1);
        } else if (x >= editZoneX0 && x < delZoneX0) {
          hoveredZoneTitle = "Drag Edited (Pitch/Trim WAV)";
          updateArmedDragZone("edited", actualIdx);
        } else if (x >= rawZoneX0 && x < editZoneX0) {
          hoveredZoneTitle = "Drag Raw Audio File";
          updateArmedDragZone("raw", actualIdx);
        } else {
          hoveredZoneTitle = `Select / Drag to Reorder: ${savedList[actualIdx].name}`;
          updateArmedDragZone("none", -1);
        }
      } else {
        updateArmedDragZone("none", -1);
      }
    }
    mgraphics.redraw();
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
  updateArmedDragZone("none", -1);
  if (hoveredIndex !== -1 || hoveredToolbarIndex !== -1 || hoveredZoneTitle !== "") {
    hoveredIndex = -1;
    hoveredToolbarIndex = -1;
    hoveredZoneTitle = "";
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
  mgraphics.set_source_rgba(col[0], col[1], col[2], isActive ? 1.0 : 0.88);

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
  }
}

// ============================================================================
// MGraphics Vector Renderer
// ============================================================================

function paint() {
  const lay = getLayout();
  const { w, h, mapW, savedX, savedW, topBarH, plotX, plotY, plotW, plotH, toolbarY, toolbarH } = lay;

  // 1. Main Background
  mgraphics.set_source_rgba(0.055, 0.067, 0.086, 1.0);
  mgraphics.rectangle_rounded(0, 0, w, h, 4, 4);
  mgraphics.fill();

  // 2. Top Sample Inspector & Waveform Banner (Left Pane: 0..mapW)
  mgraphics.set_source_rgba(0.09, 0.11, 0.145, 1.0);
  mgraphics.rectangle(0, 0, mapW, topBarH);
  mgraphics.fill();

  const selCol = getCategoryColor(selectedMeta.catIdx || 0);
  mgraphics.set_source_rgba(selCol[0], selCol[1], selCol[2], 1.0);
  mgraphics.arc(9, 10, 3.8, 0, Math.PI * 2);
  mgraphics.fill();

  mgraphics.select_font_face("Arial", "normal", "bold");
  mgraphics.set_font_size(9.0);
  mgraphics.set_source_rgba(0.94, 0.96, 0.98, 1.0);
  mgraphics.move_to(16, 13.5);
  const shortName = String(selectedMeta.name || "Select Sample").slice(0, 14);
  mgraphics.show_text(shortName);

  // Waveform Viewer with Scanning Playhead Line (x = 122..mapW-5)
  const peaks = selectedMeta.peaks || [];
  const waveX = 122;
  const waveW = mapW - waveX - 5;
  mgraphics.set_source_rgba(0.04, 0.05, 0.07, 1.0);
  mgraphics.rectangle_rounded(waveX - 2, 2, waveW + 4, topBarH - 4, 2, 2);
  mgraphics.fill();

  if (peaks.length > 0) {
    const nBars = Math.min(24, peaks.length);
    const stepW = waveW / nBars;
    mgraphics.set_source_rgba(selCol[0], selCol[1], selCol[2], 0.85);
    for (let i = 0; i < nBars; i++) {
      const env = decayMs < (selectedMeta.durationMs || 300)
        ? Math.max(0.05, 1.0 - ((i / nBars) * (selectedMeta.durationMs || 300)) / Math.max(20, decayMs))
        : 1.0;
      const bh = Math.max(2, peaks[i] * env * (topBarH - 6));
      mgraphics.rectangle(waveX + i * stepW, 10 - bh * 0.5, Math.max(1.4, stepW - 1), bh);
      mgraphics.fill();
    }
  }

  // Visible Scanning Playhead Line across Waveform Viewer
  if (playheadPos >= 0.0 && playheadPos <= 1.0) {
    const scanX = waveX + playheadPos * waveW;
    mgraphics.set_source_rgba(0.22, 0.88, 1.0, 0.95);
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
  mgraphics.set_source_rgba(0.16, 0.20, 0.27, 0.35);
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
    mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.35);
    mgraphics.set_line_width(1.0);
    for (const nIdx of nbrSet) {
      if (nIdx >= 0 && nIdx < points.length && isPointVisible(points[nIdx])) {
        const np = points[nIdx];
        const [nx, ny] = normToScreen(np.x, np.y, lay);
        mgraphics.move_to(sx, sy);
        mgraphics.line_to(nx, ny);
        mgraphics.stroke();
      }
    }
  }

  // 5. Draw Scrub Trail
  if (scrubTrail.length > 1) {
    mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.50);
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
    if (!vis) {
      mgraphics.set_source_rgba(0.25, 0.30, 0.38, 0.22);
      mgraphics.arc(px, py, 1.4, 0, Math.PI * 2);
      mgraphics.fill();
      continue;
    }
    const col = getCategoryColor(pt.catIdx);
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.92);
    mgraphics.arc(px, py, nbrSet.has(i) ? ptRadius + 0.7 : ptRadius, 0, Math.PI * 2);
    mgraphics.fill();
  }

  // 7. Highlight Selected & Hovered Point
  if (hoveredIndex >= 0 && hoveredIndex < points.length && isPointVisible(points[hoveredIndex])) {
    const hp = points[hoveredIndex];
    const [hx, hy] = normToScreen(hp.x, hp.y, lay);
    mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.85);
    mgraphics.set_line_width(1.2);
    mgraphics.arc(hx, hy, ptRadius + 2.8, 0, Math.PI * 2);
    mgraphics.stroke();
  }

  if (selectedIndex >= 0 && selectedIndex < points.length && isPointVisible(points[selectedIndex])) {
    const sp = points[selectedIndex];
    const [sx, sy] = normToScreen(sp.x, sp.y, lay);
    mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.22);
    mgraphics.arc(sx, sy, ptRadius + 5.5, 0, Math.PI * 2);
    mgraphics.fill();

    mgraphics.set_source_rgba(1.0, 1.0, 1.0, 1.0);
    mgraphics.set_line_width(1.7);
    mgraphics.arc(sx, sy, ptRadius + 3.0, 0, Math.PI * 2);
    mgraphics.stroke();
  }

  // 8. Hover HUD Overlay Tooltip
  let hudText = hoveredZoneTitle;
  if (!hudText && hoveredToolbarIndex >= 0 && hoveredToolbarIndex < TOOLBAR_ITEMS.length) {
    hudText = TOOLBAR_ITEMS[hoveredToolbarIndex].title;
  } else if (!hudText && hoveredIndex >= 0 && hoveredIndex < points.length) {
    const hp = points[hoveredIndex];
    hudText = `${hp.name || hp.category} (${Math.round(hp.durationMs)}ms)`;
  }
  if (hudText) {
    const boxW = Math.min(mapW - 10, Math.max(72, hudText.length * 5.0 + 10));
    mgraphics.select_font_face("Arial", "normal", "bold");
    mgraphics.set_font_size(8.5);
    mgraphics.set_source_rgba(0.08, 0.10, 0.13, 0.90);
    mgraphics.rectangle_rounded(mapW - boxW - 5, plotY + 2, boxW, 13, 2, 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.90, 0.93, 0.96, 0.96);
    mgraphics.move_to(mapW - boxW - 1, plotY + 11.5);
    mgraphics.show_text(hudText);
  }

  // 9. Bottom Geometric Vector Icon Toolbar (Left Pane: 0..mapW)
  mgraphics.set_source_rgba(0.11, 0.125, 0.15, 1.0);
  mgraphics.rectangle(0, toolbarY, mapW, toolbarH);
  mgraphics.fill();

  mgraphics.set_line_width(1.0);
  mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.1);
  mgraphics.move_to(0, toolbarY);
  mgraphics.line_to(mapW, toolbarY);
  mgraphics.stroke();

  const btnW = mapW / TOOLBAR_ITEMS.length;
  for (let i = 0; i < TOOLBAR_ITEMS.length; i++) {
    const item = TOOLBAR_ITEMS[i];
    const bx = i * btnW;
    const isHov = (hoveredToolbarIndex === i);
    let isActive = false;
    let iconCol = [0.72, 0.76, 0.82, 1.0];

    if (item.id.startsWith("cat_")) {
      const cat = item.id.slice(4);
      isActive = (activeCategory === cat);
      const found = CATEGORIES.find((c) => c.id === cat);
      if (found) iconCol = found.color;
    } else if (isHov) {
      iconCol = [0.22, 0.74, 0.97, 1.0];
    }

    if (isActive) {
      mgraphics.set_source_rgba(iconCol[0], iconCol[1], iconCol[2], 0.24);
      mgraphics.rectangle(bx + 0.5, toolbarY + 1, btnW - 1, toolbarH - 2);
      mgraphics.fill();
    } else if (isHov) {
      mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.08);
      mgraphics.rectangle(bx + 0.5, toolbarY + 1, btnW - 1, toolbarH - 2);
      mgraphics.fill();
    }

    if (i > 0) {
      mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.07);
      mgraphics.move_to(bx, toolbarY + 3);
      mgraphics.line_to(bx, toolbarY + toolbarH - 3);
      mgraphics.stroke();
    }

    drawToolbarIcon(item.id, bx, toolbarY, btnW, toolbarH, iconCol, isActive || isHov);
  }

  // ==========================================================================
  // 10. RIGHT PANE: Scrollable, Selectable, Reorderable & Deletable Saved List
  // ==========================================================================
  mgraphics.set_source_rgba(0.075, 0.09, 0.115, 1.0);
  mgraphics.rectangle(savedX, 0, savedW, h);
  mgraphics.fill();

  mgraphics.set_source_rgba(0.22, 0.26, 0.33, 1.0);
  mgraphics.set_line_width(1.0);
  mgraphics.move_to(savedX, 0);
  mgraphics.line_to(savedX, h);
  mgraphics.stroke();

  // Saved List Top Bar
  mgraphics.set_source_rgba(0.10, 0.12, 0.16, 1.0);
  mgraphics.rectangle(savedX + 1, 0, savedW - 1, topBarH);
  mgraphics.fill();

  mgraphics.select_font_face("Arial", "normal", "bold");
  mgraphics.set_font_size(8.5);
  mgraphics.set_source_rgba(1.0, 0.71, 0.20, 1.0);
  mgraphics.move_to(savedX + 5, 13.5);
  mgraphics.show_text(`SAVED (${savedList.length})`);

  // "+Save" mini button in header
  mgraphics.set_source_rgba(0.20, 0.74, 0.45, 0.28);
  mgraphics.rectangle_rounded(savedX + 65, 3, 42, 14, 2, 2);
  mgraphics.fill();
  mgraphics.set_source_rgba(0.35, 0.90, 0.55, 1.0);
  mgraphics.move_to(savedX + 73, 13);
  mgraphics.show_text("+Save");

  // Clear All ("x") mini button in header
  mgraphics.set_source_rgba(0.20, 0.24, 0.30, 1.0);
  mgraphics.rectangle_rounded(savedX + 111, 3, 20, 14, 2, 2);
  mgraphics.fill();
  mgraphics.set_source_rgba(0.75, 0.80, 0.86, 0.9);
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
    mgraphics.set_source_rgba(0.50, 0.55, 0.62, 1.0);
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

      mgraphics.set_source_rgba(
        isRowSelected ? 0.14 : 0.11,
        isRowSelected ? 0.19 : 0.135,
        isRowSelected ? 0.26 : 0.175,
        1.0
      );
      mgraphics.rectangle_rounded(savedX + 3, ry + 1, savedW - 10, lay.savedRowH - 2, 2, 2);
      mgraphics.fill();

      if (isRowSelected) {
        mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.85);
        mgraphics.set_line_width(1.1);
        mgraphics.rectangle_rounded(savedX + 3, ry + 1, savedW - 10, lay.savedRowH - 2, 2, 2);
        mgraphics.stroke();
      }

      const cCol = getCategoryColor(item.catIdx || 0);
      mgraphics.set_source_rgba(cCol[0], cCol[1], cCol[2], 1.0);
      mgraphics.arc(savedX + 8, ry + 7, 2.5, 0, Math.PI * 2);
      mgraphics.fill();

      mgraphics.select_font_face("Arial", "normal", "bold");
      mgraphics.set_font_size(8.0);
      mgraphics.set_source_rgba(0.92, 0.95, 0.98, 1.0);
      mgraphics.move_to(savedX + 13, ry + 9.5);
      mgraphics.show_text(String(item.name).slice(0, 12));

      mgraphics.select_font_face("Arial", "normal", "normal");
      mgraphics.set_font_size(7.5);
      mgraphics.set_source_rgba(0.58, 0.64, 0.72, 1.0);
      const pStr = item.pitchSt >= 0 ? `+${item.pitchSt}st` : `${item.pitchSt}st`;
      mgraphics.move_to(savedX + 13, ry + 18.5);
      mgraphics.show_text(`${pStr}•${Math.round(item.decayMs)}m`);

      // Per-Row Action Buttons: [R] (Raw), [E] (Edited), [x] (Delete)
      const rawX = savedX + savedW - 52;
      const editX = savedX + savedW - 35;
      const delX = savedX + savedW - 19;

      // [R] Raw Drag Handle
      mgraphics.set_source_rgba(0.18, 0.23, 0.30, 1.0);
      mgraphics.rectangle_rounded(rawX, ry + 3, 15, 15, 2, 2);
      mgraphics.fill();
      mgraphics.select_font_face("Arial", "normal", "bold");
      mgraphics.set_font_size(7.8);
      mgraphics.set_source_rgba(0.78, 0.84, 0.92, 1.0);
      mgraphics.move_to(rawX + 4.2, ry + 13);
      mgraphics.show_text("R");

      // [E] Edited Drag Handle
      mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.25);
      mgraphics.rectangle_rounded(editX, ry + 3, 15, 15, 2, 2);
      mgraphics.fill();
      mgraphics.set_source_rgba(0.22, 0.74, 0.97, 1.0);
      mgraphics.move_to(editX + 4.2, ry + 13);
      mgraphics.show_text("E");

      // [x] Delete Row Button (geometric vector X)
      mgraphics.set_source_rgba(0.26, 0.16, 0.18, 0.85);
      mgraphics.rectangle_rounded(delX, ry + 3, 12, 15, 2, 2);
      mgraphics.fill();
      mgraphics.set_source_rgba(0.95, 0.45, 0.48, 0.95);
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
    mgraphics.set_source_rgba(0.14, 0.17, 0.22, 1.0);
    mgraphics.rectangle_rounded(trackX, trackY, 3, trackH, 1.5, 1.5);
    mgraphics.fill();

    const thumbRatio = Math.min(1.0, lay.savedMaxRows / Math.max(1, savedList.length));
    const thumbH = Math.max(12, trackH * thumbRatio);
    const maxScroll = Math.max(1, savedList.length - lay.savedMaxRows);
    const thumbY = trackY + (savedScrollOffset / maxScroll) * (trackH - thumbH);
    mgraphics.set_source_rgba(0.45, 0.55, 0.68, 0.9);
    mgraphics.rectangle_rounded(trackX, thumbY, 3, thumbH, 1.5, 1.5);
    mgraphics.fill();
  }

  // Bottom Batch Drag-Out Zones: [Drag Raw] vs [Drag Edit]
  mgraphics.set_source_rgba(0.10, 0.12, 0.155, 1.0);
  mgraphics.rectangle(savedX + 1, lay.savedBottomY, savedW - 1, toolbarH);
  mgraphics.fill();

  const halfW = (savedW - 8) * 0.5;
  mgraphics.set_source_rgba(0.16, 0.20, 0.26, 1.0);
  mgraphics.rectangle_rounded(savedX + 3, lay.savedBottomY + 3, halfW, toolbarH - 6, 2, 2);
  mgraphics.fill();
  mgraphics.select_font_face("Arial", "normal", "bold");
  mgraphics.set_font_size(8.0);
  mgraphics.set_source_rgba(0.84, 0.88, 0.94, 1.0);
  mgraphics.move_to(savedX + 14, lay.savedBottomY + 14);
  mgraphics.show_text("Drag Raw");

  mgraphics.set_source_rgba(1.0, 0.69, 0.18, 0.24);
  mgraphics.rectangle_rounded(savedX + 5 + halfW, lay.savedBottomY + 3, halfW, toolbarH - 6, 2, 2);
  mgraphics.fill();
  mgraphics.set_source_rgba(1.0, 0.73, 0.22, 1.0);
  mgraphics.move_to(savedX + 16 + halfW, lay.savedBottomY + 14);
  mgraphics.show_text("Drag Edit");

  if (dragOutState) {
    const bw = 110;
    const bh = 16;
    const bx = Math.max(4, Math.min(w - bw - 4, dragOutState.x - bw * 0.5));
    const by = Math.max(4, Math.min(h - bh - 4, dragOutState.y - bh * 0.5));
    mgraphics.set_source_rgba(0.08, 0.11, 0.15, 0.94);
    mgraphics.rectangle_rounded(bx, by, bw, bh, 3, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.22, 0.74, 0.97, 1.0);
    mgraphics.set_line_width(1.2);
    mgraphics.rectangle_rounded(bx, by, bw, bh, 3, 3);
    mgraphics.stroke();
    mgraphics.set_source_rgba(0.95, 0.98, 1.0, 1.0);
    mgraphics.move_to(bx + 6, by + 11);
    mgraphics.show_text(dragOutState.label);
  }
}
