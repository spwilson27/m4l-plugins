/*
 * XO Sample Map — Folder Filter List Widget (src/xo_folder_ui.js)
 * Embedded in Max 9 v8ui object (id: "obj-folder-list", presentation_rect: [398.0, 90.0, 126.0, 69.0])
 *
 * Features:
 *  - Displays all remembered sample folders (automatically including Ableton Core Drums)
 *  - Click any folder row to toggle whether its samples are included in the 2D map
 *  - Click "All" in header to enable all remembered folders
 *  - Click "+Add" in header to add a new folder
 *  - Scrollable with mouse wheel or right-edge scrollbar thumb
 */

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1; // Outlet 0: commands to node.codebox (toggle_folder, enable_all_folders, prompt_folder)

let folders = [
  {
    enabled: 1,
    scanning: 0,
    count: 80,
    name: "Ableton Core Drums",
    path: "CORE_DRUMS"
  }
];

let scrollOffset = 0;
let scrollbarDrag = false;
const HEADER_H = 15;
const ROW_H = 17;
const MAX_VIS_ROWS = 3;

function clampScroll() {
  const maxScroll = Math.max(0, folders.length - MAX_VIS_ROWS);
  scrollOffset = Math.max(0, Math.min(maxScroll, Math.round(scrollOffset)));
}

function loadbang() {
  mgraphics.redraw();
}

function folder_list_sync(count, ...flat) {
  const next = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    const flags = Number(flat[i]) || 0;
    next.push({
      enabled: (flags & 1) ? 1 : 0,
      scanning: (flags & 2) ? 1 : 0,
      count: Number(flat[i + 1]) || 0,
      name: String(flat[i + 2] || "Folder"),
      path: String(flat[i + 3] || "")
    });
  }
  if (Number(count) === 0 || next.length > 0) {
    folders = next;
  }
  clampScroll();
  mgraphics.redraw();
}

function set_folder_scanning(target, isScanning) {
  for (let i = 0; i < folders.length; i++) {
    if (i === Number(target) || folders[i].path === target || folders[i].name === target || target === "all") {
      folders[i].scanning = Number(isScanning) ? 1 : 0;
    }
  }
  mgraphics.redraw();
}

function isAnyFolderScanning() {
  return folders.some((f) => !!f.scanning);
}

function getFolders() {
  return folders;
}

function getScrollOffset() {
  return scrollOffset;
}

function scrollFolders(delta) {
  scrollOffset += delta;
  clampScroll();
  mgraphics.redraw();
}

function onclick(x, y) {
  const sz = mgraphics.size || [196, 69];
  const w = sz[0];
  const h = sz[1];

  // Header buttons ("All" at [w-53..w-31], "+Add" at [w-29..w-2])
  if (y <= HEADER_H) {
    if (x >= w - 54 && x < w - 29) {
      for (let i = 0; i < folders.length; i++) {
        folders[i].enabled = 1;
      }
      outlet(0, "enable_all_folders");
      mgraphics.redraw();
      return;
    }
    if (x >= w - 29) {
      outlet(0, "prompt_folder");
      return;
    }
    return;
  }

  // Right-edge scrollbar drag
  if (x >= w - 6 && folders.length > MAX_VIS_ROWS) {
    scrollbarDrag = true;
    const trackH = Math.max(1, h - HEADER_H - 2);
    const normY = Math.max(0, Math.min(1, (y - HEADER_H) / trackH));
    scrollOffset = Math.round(normY * Math.max(0, folders.length - MAX_VIS_ROWS));
    clampScroll();
    mgraphics.redraw();
    return;
  }

  // Folder row click -> [x] delete button (x >= w - 19) or toggle enabled
  const visRow = Math.floor((y - HEADER_H - 1) / ROW_H);
  const actualIdx = scrollOffset + visRow;
  if (visRow >= 0 && visRow < MAX_VIS_ROWS && actualIdx >= 0 && actualIdx < folders.length) {
    const delX0 = w - 19;
    const delX1 = w - 6;
    if (x >= delX0 && x <= delX1) {
      const removed = folders.splice(actualIdx, 1)[0];
      clampScroll();
      outlet(0, "remove_folder", removed ? removed.path : actualIdx);
      mgraphics.redraw();
      return;
    }
    folders[actualIdx].enabled = folders[actualIdx].enabled ? 0 : 1;
    outlet(0, "toggle_folder", folders[actualIdx].path, folders[actualIdx].enabled);
    mgraphics.redraw();
  }
}

function ondrag(x, y, but) {
  if (!but) {
    scrollbarDrag = false;
    return;
  }
  if (scrollbarDrag) {
    const sz = mgraphics.size || [126, 69];
    const h = sz[1];
    const trackH = Math.max(1, h - HEADER_H - 2);
    const normY = Math.max(0, Math.min(1, (y - HEADER_H) / trackH));
    scrollOffset = Math.round(normY * Math.max(0, folders.length - MAX_VIS_ROWS));
    clampScroll();
    mgraphics.redraw();
  }
}

function onwheel(x, y, dx, dy) {
  if (folders.length > MAX_VIS_ROWS) {
    scrollFolders(dy < 0 ? 1 : -1);
  }
}

function paint() {
  const sz = mgraphics.size || [196, 69];
  const w = sz[0];
  const h = sz[1];

  // Background
  mgraphics.set_source_rgba(0.065, 0.08, 0.105, 1.0);
  mgraphics.rectangle_rounded(0, 0, w, h, 3, 3);
  mgraphics.fill();

  mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.35);
  mgraphics.set_line_width(1.0);
  mgraphics.rectangle_rounded(0.5, 0.5, w - 1, h - 1, 3, 3);
  mgraphics.stroke();

  // Top Header Bar
  mgraphics.set_source_rgba(0.095, 0.12, 0.155, 1.0);
  mgraphics.rectangle(1, 1, w - 2, HEADER_H - 1);
  mgraphics.fill();

  const activeCount = folders.filter((f) => f.enabled).length;
  const anyScanning = folders.some((f) => f.scanning);
  mgraphics.select_font_face("Arial", "normal", "bold");
  mgraphics.set_font_size(7.8);
  mgraphics.set_source_rgba(0.22, 0.74, 0.97, 1.0);
  mgraphics.move_to(4, 10.5);
  mgraphics.show_text(`FOLDERS (${activeCount}/${folders.length})`);

  if (anyScanning) {
    mgraphics.set_source_rgba(1.0, 0.70, 0.18, 0.24);
    mgraphics.rectangle_rounded(76, 2, 42, 11, 2, 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(1.0, 0.75, 0.22, 1.0);
    mgraphics.arc(82, 7.5, 2.0, 0, Math.PI * 2);
    mgraphics.fill();
    mgraphics.set_font_size(6.8);
    mgraphics.move_to(86, 10);
    mgraphics.show_text("SCAN..");
  }

  // "All" mini button
  const allBtnX = w - 53;
  const addBtnX = w - 30;
  mgraphics.set_source_rgba(0.16, 0.21, 0.28, 1.0);
  mgraphics.rectangle_rounded(allBtnX, 2, 21, 11, 2, 2);
  mgraphics.fill();
  mgraphics.set_source_rgba(0.82, 0.88, 0.95, 1.0);
  mgraphics.set_font_size(7.2);
  mgraphics.move_to(allBtnX + 5, 10);
  mgraphics.show_text("All");

  // "+Add" mini button
  mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.24);
  mgraphics.rectangle_rounded(addBtnX, 2, 27, 11, 2, 2);
  mgraphics.fill();
  mgraphics.set_source_rgba(0.35, 0.82, 1.0, 1.0);
  mgraphics.move_to(addBtnX + 3, 10);
  mgraphics.show_text("+Add");

  // Folder Rows
  const maxVis = Math.min(MAX_VIS_ROWS, folders.length - scrollOffset);
  for (let r = 0; r < maxVis; r++) {
    const idx = scrollOffset + r;
    const item = folders[idx];
    if (!item) continue;
    const ry = HEADER_H + 1 + r * ROW_H;
    const isOn = !!item.enabled;

    mgraphics.set_source_rgba(
      isOn ? 0.11 : 0.08,
      isOn ? 0.145 : 0.095,
      isOn ? 0.19 : 0.12,
      1.0
    );
    mgraphics.rectangle_rounded(2, ry + 1, w - 8, ROW_H - 2, 2, 2);
    mgraphics.fill();

    // Checkbox
    const cbX = 5;
    const cbY = ry + 3.5;
    const cbS = 9.5;
    if (isOn) {
      mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.9);
      mgraphics.rectangle_rounded(cbX, cbY, cbS, cbS, 1.8, 1.8);
      mgraphics.fill();
      // Checkmark vector path
      mgraphics.set_source_rgba(0.05, 0.07, 0.10, 1.0);
      mgraphics.set_line_width(1.4);
      mgraphics.move_to(cbX + 2.0, cbY + 5.0);
      mgraphics.line_to(cbX + 4.2, cbY + 7.2);
      mgraphics.line_to(cbX + 7.8, cbY + 2.5);
      mgraphics.stroke();
    } else {
      mgraphics.set_source_rgba(0.35, 0.42, 0.50, 0.8);
      mgraphics.set_line_width(1.0);
      mgraphics.rectangle_rounded(cbX, cbY, cbS, cbS, 1.8, 1.8);
      mgraphics.stroke();
    }

    // Folder Name
    const maxChars = w >= 180 ? 22 : 12;
    mgraphics.select_font_face("Arial", "normal", isOn ? "bold" : "normal");
    mgraphics.set_font_size(7.6);
    mgraphics.set_source_rgba(
      isOn ? 0.90 : 0.50,
      isOn ? 0.94 : 0.56,
      isOn ? 0.98 : 0.64,
      1.0
    );
    mgraphics.move_to(17, ry + 11.2);
    mgraphics.show_text(String(item.name || "Folder").slice(0, maxChars));

    // Sample Count or Active Scanning Indicator
    if (item.scanning) {
      mgraphics.set_source_rgba(1.0, 0.72, 0.20, 0.85);
      mgraphics.set_line_width(1.0);
      mgraphics.rectangle_rounded(2, ry + 1, w - 8, ROW_H - 2, 2, 2);
      mgraphics.stroke();

      mgraphics.select_font_face("Arial", "normal", "bold");
      mgraphics.set_font_size(6.6);
      mgraphics.set_source_rgba(1.0, 0.75, 0.22, 1.0);
      const scanStr = `SCAN ${item.count || 0}`;
      mgraphics.move_to(w - 22 - scanStr.length * 3.8, ry + 11.0);
      mgraphics.show_text(scanStr);
    } else {
      mgraphics.select_font_face("Arial", "normal", "normal");
      mgraphics.set_font_size(6.8);
      mgraphics.set_source_rgba(0.55, 0.63, 0.72, 0.9);
      const cntStr = String(item.count || 0);
      mgraphics.move_to(w - 21 - cntStr.length * 4.0, ry + 11.0);
      mgraphics.show_text(cntStr);
    }

    // Per-Row [x] Delete Folder Button
    const delX = w - 18;
    const delY = ry + 3;
    mgraphics.set_source_rgba(0.26, 0.16, 0.18, 0.88);
    mgraphics.rectangle_rounded(delX, delY, 11, 11, 2, 2);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.95, 0.45, 0.48, 0.95);
    mgraphics.set_line_width(1.1);
    mgraphics.move_to(delX + 3.0, delY + 3.0);
    mgraphics.line_to(delX + 8.0, delY + 8.0);
    mgraphics.move_to(delX + 8.0, delY + 3.0);
    mgraphics.line_to(delX + 3.0, delY + 8.0);
    mgraphics.stroke();
  }

  if (folders.length === 0) {
    mgraphics.select_font_face("Arial", "normal", "normal");
    mgraphics.set_font_size(7.5);
    mgraphics.set_source_rgba(0.50, 0.56, 0.64, 1.0);
    mgraphics.move_to(8, 38);
    mgraphics.show_text("No folders in index.");
    mgraphics.move_to(8, 50);
    mgraphics.show_text("Click +Add or Scan Core.");
  }

  // Right-edge scrollbar when folders.length > MAX_VIS_ROWS
  if (folders.length > MAX_VIS_ROWS) {
    const trackX = w - 4.5;
    const trackY = HEADER_H + 2;
    const trackH = h - HEADER_H - 4;
    mgraphics.set_source_rgba(0.14, 0.17, 0.22, 1.0);
    mgraphics.rectangle_rounded(trackX, trackY, 2.5, trackH, 1, 1);
    mgraphics.fill();

    const thumbRatio = Math.min(1.0, MAX_VIS_ROWS / folders.length);
    const thumbH = Math.max(10, trackH * thumbRatio);
    const maxScroll = Math.max(1, folders.length - MAX_VIS_ROWS);
    const thumbY = trackY + (scrollOffset / maxScroll) * (trackH - thumbH);
    mgraphics.set_source_rgba(0.22, 0.74, 0.97, 0.85);
    mgraphics.rectangle_rounded(trackX, thumbY, 2.5, thumbH, 1, 1);
    mgraphics.fill();
  }
}
