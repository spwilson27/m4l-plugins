"""Shared cell helpers for Deviate faces (scripts/deviate_faces/README.md). `h` is the build module (scripts/build_deviate.py).

strip_block   the 8 metas in a 4 x 2 grid: Value dial 33 x 42, Range numbox 33 x 15, Lock toggle 33 x 14  -> 140 x 153 px
globals_block the globals in a 3-column block: Sens / Thresh / Chance, Mix / Drift / Seed (dials 33 x 42), Reroll + Split, MIDI From + Arch -> 108 x 128 px

Both return (controls, rects): the live.* boxes to append to the layout's `controls` and {key: [x, y, w, h]} of every placed widget
(handy to align canvases and labels). Pass `color` for an own-palette face (accent colour of dials / bars / buttons) or leave it None for a
Live-themed face (no colour attributes at all, or bind with h.theme afterwards).
"""

STRIP_W = 140.0
STRIP_H = 153.0
GLOBALS_W = 108.0
GLOBALS_H = 128.0
CELL_W = 33.0
DIAL_H = 42.0


def strip_block(h, x, y, color=None, col_pitch=35.0, row_pitch=80.0, lock_text="Lock", order=None):
    """The 8 meta cells, 4 columns x 2 rows, in meta order Snap Pitch Body Motion / Space Echo Grit Ring (or `order`, a list of 8 meta names).
    Cell: Value dial (y), Range numbox (y + 43), Lock toggle (y + 59)."""
    controls, rects = [], {}
    metas = order or h.METAS
    for i, name in enumerate(metas):
        k = name.lower()
        cx = x + (i % 4) * col_pitch
        cy = y + (i // 4) * row_pitch
        controls += [
            h.dial(f"v_{k}", cx, cy, CELL_W, DIAL_H, color=color),
            h.numbox(f"r_{k}", cx, cy + 43.0, CELL_W, 15.0, color=color),
            h.toggle(f"l_{k}", cx, cy + 59.0, CELL_W, 14.0, text=lock_text, color=color),
        ]
        rects[f"v_{k}"] = [cx, cy, CELL_W, DIAL_H]
        rects[f"r_{k}"] = [cx, cy + 43.0, CELL_W, 15.0]
        rects[f"l_{k}"] = [cx, cy + 59.0, CELL_W, 14.0]
    return controls, rects


def globals_block(h, x, y, color=None, col_pitch=36.0, reroll_text="Reroll"):
    """Sens Thresh Chance / Mix Drift Seed as dials, then Reroll (button) + Split Mode (menu), then MIDI From (menu)."""
    controls, rects = [], {}
    grid = [["sens", "thresh", "chance"], ["mix", "drift", "seed"]]
    for r, row in enumerate(grid):
        for c, key in enumerate(row):
            cx, cy = x + c * col_pitch, y + r * 48.0
            controls.append(h.dial(key, cx, cy, CELL_W, DIAL_H, color=color))
            rects[key] = [cx, cy, CELL_W, DIAL_H]
    controls.append(h.button("reroll", x, y + 96.0, CELL_W, 15.0, text=reroll_text, color=color))
    rects["reroll"] = [x, y + 96.0, CELL_W, 15.0]
    controls.append(h.menu("split", x + col_pitch, y + 96.0, 72.0, 15.0, color=color))
    rects["split"] = [x + col_pitch, y + 96.0, 72.0, 15.0]
    controls.append(h.menu("midi_in", x, y + 113.0, 58.0, 15.0, color=color))
    rects["midi_in"] = [x, y + 113.0, 58.0, 15.0]
    controls.append(h.numbox("arch", x + 61.0, y + 113.0, 47.0, 15.0, color=color))
    rects["arch"] = [x + 61.0, y + 113.0, 47.0, 15.0]
    return controls, rects
