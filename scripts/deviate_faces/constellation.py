"""Deviate Constellation: indigo night sky. One star per meta over its own strip (Value dial, Range numbox, Lock toggle), the globals on the right.
The sky canvas (obj-lay-sky, role hit) is a tile beside nothing: every live.* sits below it or right of it, none over it."""
from . import _blocks as b

NAME = "Constellation"

PITCH = 53.0            # column pitch of the 8 strips = star spacing in the sky
LEFT = 6.0
SKY_W = PITCH * 8       # 424
SKY_H = 82.0
GLOBALS_X = 443.0
W = 560.0

CYAN = (0.40, 0.85, 1.00)
MAGENTA = (0.95, 0.40, 0.80)
BODY = (0.03, 0.035, 0.10)
CARD = (0.055, 0.06, 0.13)
EDGE = (0.16, 0.18, 0.34)


def layout(h):
    controls = []
    for i, name in enumerate(h.METAS):
        k = name.lower()
        colx = LEFT + i * PITCH
        controls += [
            h.dial(f"v_{k}", colx + 10.0, 91.0, b.CELL_W, b.DIAL_H, color=CYAN),
            h.numbox(f"r_{k}", colx + 6.0, 134.0, 41.0, 15.0, color=MAGENTA),
            h.toggle(f"l_{k}", colx + 6.0, 150.0, 41.0, 14.0, text="Lock", color=CYAN),
        ]
    globs, _ = b.globals_block(h, GLOBALS_X, 22.0, color=CYAN)
    keys = [f"{p}_{n.lower()}" for p in ("v", "r", "l") for n in h.METAS] + ["split"]
    canvas = {"id": "obj-lay-sky", "files": ["deviate_face_constellation.js"], "rect": [LEFT, 4.0, SKY_W, SKY_H], "role": "hit",
              "ignoreclick": False, "keys": keys}
    panels = [
        h.panel("obj-panel-globals", 437, 4, 120, 161, bg=CARD, border=EDGE),
        h.panel("obj-panel-strips", 3, 88, SKY_W + 6, 77, bg=CARD, border=EDGE),
        h.panel("obj-panel-body", 0, 0, W, 169, bg=BODY, border=BODY, rounded=0),
    ]
    return {"width": W, "controls": controls + globs, "off_face": {}, "canvases": [canvas], "panels": panels, "panel_theme": [], "theme": "own"}
