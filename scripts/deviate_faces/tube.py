"""Deviate Tube: an amber-bezel CRT. A 246 x 161 canvas (phase portrait, graticule, spectrum trace, 8 LED bars, T / B / L lamps, ENV / SPEC
label) on the left, a bezel panel on the right with the meta strip block (amber) and the 3-column globals. Tile layout: no live.* over the canvas.
Device: `Deviate Tube`."""
from . import _blocks as b

NAME = "Tube"

W = 520.0
AMBER = (0.97, 0.68, 0.26)
CX, CY, CW, CH = 6.0, 4.0, 246.0, 161.0
BX = 256.0  # bezel panel x
SX = 262.0  # strip block
GX = 406.0  # globals block


def layout(h):
    strip, _ = b.strip_block(h, SX, 8.0, color=AMBER)
    globs, _ = b.globals_block(h, GX, 8.0, color=AMBER)
    canvas = {
        "id": "obj-lay-tube-crt", "files": ["deviate_face_tube.js"], "rect": [CX, CY, CW, CH], "role": "hit", "ignoreclick": False,
        "keys": ["v_snap", "v_pitch", "v_body", "v_motion", "v_space", "v_echo", "v_grit", "v_ring", "chance"],
    }
    plate = h.label("obj-lay-tube-plate", "DEVIATE  TUBE", GX, 154.5, 108.0, 12.0, size=9.0, color=AMBER, bold=True, align=1)
    panels = [
        h.panel("obj-panel-crt", 3, 2, 249, 165, bg=(0.16, 0.10, 0.04), border=(0.55, 0.36, 0.12), rounded=10),
        h.panel("obj-panel-bezel", BX, 2, W - BX - 3.0, 165, bg=(0.14, 0.09, 0.035), border=(0.55, 0.36, 0.12), rounded=8),
        h.panel("obj-panel-body", 0, 0, W, 169, bg=(0.07, 0.045, 0.02), border=(0.07, 0.045, 0.02), rounded=0),
    ]
    return {"width": W, "controls": strip + globs, "canvases": [canvas], "panels": panels, "extra_boxes": [plate],
            "extra_lines": [], "off_face": {}, "panel_theme": [], "theme": "own"}
