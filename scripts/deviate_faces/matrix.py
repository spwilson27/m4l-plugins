"""Deviate Matrix: LED amber / white dot-matrix on black. Eight rows (one per meta: Lock, Value bar, Range) beside a history canvas of the
last 16 draws (one cell column per draw, colour by chain), a spectrum strip + chain bars on top, a Value/Range gauge at the end of every row.
Tile layout: the canvas sits right of the widgets, so no live.* overlaps it. Everything is on the face (off_face is empty)."""
from . import _blocks as b

NAME = "Matrix"

W = 476.0
AMBER = (1.0, 0.66, 0.12)
LABEL = (0.93, 0.94, 0.97)
BG = (0.02, 0.02, 0.025)
ROW_Y = 17.0
PITCH = 19.0
CV_X, CV_Y, CV_W, CV_H = 162.0, 3.0, 192.0, 163.0
GX = 362.0

KEYS = [k.lower() for k in ["Snap", "Pitch", "Body", "Motion", "Space", "Echo", "Grit", "Ring"]]


def layout(h):
    controls, boxes = [], []
    for i, name in enumerate(h.METAS):
        k = name.lower()
        y = ROW_Y + i * PITCH
        controls += [
            h.toggle(f"l_{k}", 6.0, y, 14.0, 14.0, text="L", color=AMBER),
            h.numbox(f"v_{k}", 53.0, y, 70.0, 15.0, color=AMBER, appearance=2),
            h.numbox(f"r_{k}", 125.0, y, 34.0, 15.0, color=AMBER, appearance=2),
        ]
        boxes.append(h.label(f"obj-lay-lbl-{k}", name, 22.0, y + 1.0, 31.0, 12.0, size=8.0, color=LABEL))
    boxes.append(h.label("obj-lay-title", "DEVIATE MATRIX", 22.0, 2.0, 130.0, 12.0, size=8.5, color=AMBER, bold=True))
    boxes.append(h.label("obj-lay-title-g", "GLOBAL", GX, 6.0, 108.0, 12.0, size=8.5, color=AMBER, bold=True))
    globs, _ = b.globals_block(h, GX, 20.0, color=AMBER)
    controls += globs
    canvas = {"id": "obj-lay-matrix-viz", "files": ["deviate_face_matrix.js"], "rect": [CV_X, CV_Y, CV_W, CV_H], "role": "hit", "ignoreclick": False,
              "keys": [f"v_{k}" for k in KEYS] + [f"r_{k}" for k in KEYS]}
    panels = [
        h.panel("obj-panel-rows", 3.0, 3.0, 157.0, 163.0, bg=(0.04, 0.04, 0.045), border=(0.16, 0.12, 0.05), rounded=3),
        h.panel("obj-panel-viz", 161.0, 3.0, 194.0, 163.0, bg=BG, border=(0.16, 0.12, 0.05), rounded=3),
        h.panel("obj-panel-globals", 358.0, 3.0, 114.0, 163.0, bg=(0.04, 0.04, 0.045), border=(0.16, 0.12, 0.05), rounded=3),
        h.panel("obj-panel-body", 0, 0, W, 169, bg=(0.02, 0.02, 0.025), border=(0.02, 0.02, 0.025), rounded=0),
    ]
    return {"width": W, "controls": controls, "off_face": {}, "canvases": [canvas], "panels": panels, "panel_theme": [],
            "extra_boxes": boxes, "extra_lines": [], "theme": "own"}
