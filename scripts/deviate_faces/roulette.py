"""Deviate Roulette: casino wheel face. Felt green, ivory, brass, red / black. A 194 x 157 wheel canvas (role hit: a click is a manual hit)
between the strip block (left) and the globals block (right). Device: `Deviate Roulette`."""
from . import _blocks as b

NAME = "Roulette"

W = 468.0
FELT = (0.035, 0.13, 0.085)
FELT_EDGE = (0.07, 0.25, 0.16)
BRASS = (0.86, 0.68, 0.28)
SX = 7.0
CX = 153.0
CW = 194.0
GX = 354.0


def layout(h):
    strip, _ = b.strip_block(h, SX, 8.0, color=BRASS)
    globs, _ = b.globals_block(h, GX, 8.0, color=BRASS)
    metas = [m.lower() for m in h.METAS]
    keys = ["v_" + k for k in metas] + ["r_" + k for k in metas] + ["l_" + k for k in metas] + ["chance", "mix", "sens"]
    canvas = {"id": "obj-lay-roulette-wheel", "files": ["deviate_face_roulette.js"], "rect": [CX, 6.0, CW, 157.0], "role": "hit",
              "ignoreclick": False, "keys": keys}
    panels = [
        h.panel("obj-panel-strip", 3, 4, 148, 161, bg=FELT, border=FELT_EDGE),
        h.panel("obj-panel-wheel", 152, 4, 197, 161, bg=(0.02, 0.085, 0.055), border=FELT_EDGE),
        h.panel("obj-panel-globals", 350, 4, 115, 161, bg=FELT, border=FELT_EDGE),
        h.panel("obj-panel-body", 0, 0, W, 169, bg=(0.015, 0.05, 0.035), border=(0.015, 0.05, 0.035), rounded=0),
    ]
    return {"width": W, "controls": strip + globs, "canvases": [canvas], "panels": panels, "off_face": {},
            "panel_theme": [], "theme": "own"}
