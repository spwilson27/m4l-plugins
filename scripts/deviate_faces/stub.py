"""Deviate Stub: the throwaway face that exercises every contract path (a strip block, the globals block, one ignoreclick canvas
that draws telemetry and sends a manual hit). Deleted by the orchestrator once the real faces exist. Device: `Deviate Stub`."""
from . import _blocks as b

NAME = "Stub"

W = 6.0 + b.STRIP_W + 4.0 + 150.0 + 4.0 + b.GLOBALS_W + 6.0  # 418


def layout(h):
    accent = (0.45, 0.80, 0.95)
    sx, gx = 6.0, 6.0 + b.STRIP_W + 4.0 + 150.0 + 4.0
    strip, _ = b.strip_block(h, sx + 0.0, 8.0, color=accent)
    globs, _ = b.globals_block(h, gx, 8.0, color=accent)
    cx = sx + b.STRIP_W + 4.0
    canvas = {"id": "obj-lay-stub-viz", "files": ["deviate_face_stub.js"], "rect": [cx, 6.0, 150.0, 157.0], "role": "hit", "ignoreclick": False,
              "keys": ["v_snap", "v_pitch", "v_body", "v_motion", "v_space", "v_echo", "v_grit", "v_ring", "chance", "mix", "split"]}
    panels = [
        h.panel("obj-panel-strip", 3, 4, b.STRIP_W + 6, 161),
        h.panel("obj-panel-viz", cx - 2, 4, 154, 161),
        h.panel("obj-panel-globals", gx - 3, 4, b.GLOBALS_W + 6, 161),
        h.panel("obj-panel-body", 0, 0, W, 169, bg=(0.05, 0.055, 0.065), border=(0.05, 0.055, 0.065), rounded=0),
    ]
    return {"width": W, "controls": strip + globs, "canvases": [canvas], "panels": panels,
            "panel_theme": [], "theme": "own"}
