"""Reverb+ face `e` -> `Reverb+ E` (600 x 169): "Direct manipulation". The waterfall is the control surface.

  left column   ALGORITHM menu | SPACE: Size, Diffusion  (Convolution: IMPULSE: Stretch, Start, Reverse, IR file drop)
  display v8ui  (102,4  396 x 161) two tabs on the header line:
                SPACE  waterfall + six numbered handles (1 Decay, 2 HF Damp, 3 Bass Mult / Crossover, 4 Low Cut,
                       5 High Cut, 6 Pre-Delay) that drive the off-face live.* parameters through rpSend, and a
                       readout bar of LCD values (the touched handle lit, its colour tied to the cell by a hairline)
                TAIL   drawn value bars for Mod Rate / Depth, Early, Late, Width, Ducking, Output, Clip Level / Mode
  right column  Freeze | LOOP bracket: Loop, Loop Time | MIX: Dry/Wet

Off-face (real, automatable live.* objects the display drives): decay predelay damp bassmult xover lowcut highcut
irdecay (handles) and modrate moddepth erlevel latelevel width duck duckrel output looplevel loopclip (TAIL page).
The Size / Diffusion and IMPULSE controls swap with the algorithm: the display's outlet 1 sends hide_tank / hide_ir
-> route -> prepend hidden -> the widgets of each side (the tank side is saved visible, the IR side hidden).
Hairlines are live.line boxes (2 px, centred), Live theme colours throughout.
"""
import os

W = 600.0
DISP = [102.0, 4.0, 396.0, 161.0]
LCOL = [4.0, 4.0, 94.0, 161.0]
RCOL = [502.0, 4.0, 94.0, 161.0]

OFF_HANDLE = "drawn as a numbered handle in the display (SPACE page); the display drives the parameter through rpSend"
OFF_TAIL = "drawn as a value bar on the display's TAIL page; the display drives the parameter through rpSend"
OFF = {
    "decay": OFF_HANDLE, "predelay": OFF_HANDLE, "damp": OFF_HANDLE, "bassmult": OFF_HANDLE, "xover": OFF_HANDLE,
    "lowcut": OFF_HANDLE, "highcut": OFF_HANDLE, "irdecay": OFF_HANDLE + " (handle 1 in Convolution)",
    "modrate": OFF_TAIL, "moddepth": OFF_TAIL, "erlevel": OFF_TAIL, "latelevel": OFF_TAIL, "width": OFF_TAIL, "duck": OFF_TAIL,
    "duckrel": OFF_TAIL, "output": OFF_TAIL, "looplevel": OFF_TAIL, "loopclip": OFF_TAIL,
}

DISPLAY_KEYS = ["algo", "decay", "predelay", "damp", "bassmult", "xover", "lowcut", "highcut", "irdecay", "modrate", "moddepth",
                "erlevel", "latelevel", "width", "duck", "duckrel", "output", "looplevel", "loopclip", "freeze", "loop", "looptime"]


def layout(h):
    controls = []
    extra = []
    tank_targets = []
    ir_targets = []

    def label(oid, text, x, y, w, hidden=0, bold=False, size=8.0, align=0, hh=12.0):
        b = h.label(oid, text, x, y, w, hh, size=size, bold=bold, align=align, hidden=hidden)
        extra.append(b)
        return oid

    def hline(oid, x, y, w, hh=2.0, hidden=0):
        """A live.line hairline in Live's frame colour (2 px boxes: a 1 px box draws nothing)."""
        extra.append({"box": {"id": oid, "maxclass": "live.line", "justification": 1, "numinlets": 1, "numoutlets": 0,
                              "patching_rect": [600.0 + x, 700.0 + y, w, hh], "presentation": 1,
                              "presentation_rect": [x, y, w, hh]} | ({"hidden": 1} if hidden else {})})
        return oid

    def off_face(box):
        box["box"]["presentation"] = 0
        del box["box"]["presentation_rect"]
        box["box"]["hidden"] = 1
        controls.append(box)

    # ---- off-face parameters (handles and TAIL page) ---------------------------------------------------------------------
    for key in ("decay", "predelay", "damp", "bassmult", "xover", "lowcut", "highcut", "irdecay", "modrate", "moddepth", "erlevel",
                "latelevel", "width", "duck", "duckrel", "output", "looplevel"):
        off_face(h.numbox(key, 0.0, 0.0, 60.0, 15.0))
    off_face(h.menu("loopclip", 0.0, 0.0, 60.0, 15.0))

    # ---- left column ----------------------------------------------------------------------------------------------------------
    label("obj-lay-e-hdr-algo", "ALGORITHM", 8.0, 5.0, 86.0, bold=True, size=7.5)
    hline("obj-lay-e-hl-algo", 8.0, 17.0, 86.0)
    controls.append(h.menu("algo", 8.0, 21.0, 86.0, 15.0))
    tank_targets.append(label("obj-lay-e-hdr-space", "SPACE", 8.0, 43.0, 86.0, bold=True, size=7.5))
    ir_targets.append(label("obj-lay-e-hdr-ir", "IMPULSE", 8.0, 43.0, 86.0, hidden=1, bold=True, size=7.5))
    hline("obj-lay-e-hl-space", 8.0, 55.0, 86.0)
    for key, x in (("size", 6.0), ("diffusion", 50.0)):
        controls.append(h.dial(key, x, 59.0, w=44.0, h=44.0))
        tank_targets.append(f"obj-ctrl-{key}")
    for key, x in (("irstretch", 6.0), ("irstart", 50.0)):
        controls.append(h.dial(key, x, 59.0, w=44.0, h=44.0, hidden=1))
        ir_targets.append(f"obj-ctrl-{key}")
    hline("obj-lay-e-hl-tank-bottom", 8.0, 108.0, 86.0)
    for i, text in enumerate(("Drag the numbered", "handles in the display.", "TAIL: the rest.")):
        tank_targets.append(label(f"obj-lay-e-hint{i}", text, 8.0, 114.0 + 11.0 * i, 86.0, size=7.5))
    controls.append(h.button("irreverse", 8.0, 114.0, 86.0, 15.0, text="Reverse", hidden=1))
    ir_targets.append("obj-ctrl-irreverse")
    ir_targets.append(label("obj-lay-e-hdr-irfile", "IMPULSE FILE", 8.0, 134.0, 86.0, hidden=1, bold=True, size=7.5))
    controls.append(h.irdrop(8.0, 147.0, 86.0, 15.0, hidden=1))
    ir_targets.append("obj-ctrl-irfile")

    # ---- right column ---------------------------------------------------------------------------------------------------------
    controls.append(h.button("freeze", 508.0, 8.0, 82.0, 15.0, text="Freeze"))
    hline("obj-lay-e-hl-freeze", 508.0, 27.0, 82.0)
    # LOOP bracket: end ticks down from a top rule, the title centred in the gap above it
    label("obj-lay-e-hdr-loop", "LOOP", 508.0, 31.0, 82.0, bold=True, size=7.5, align=1)
    hline("obj-lay-e-br-top", 508.0, 45.0, 82.0)
    hline("obj-lay-e-br-l", 508.0, 45.0, 2.0, hh=7.0)
    hline("obj-lay-e-br-r", 588.0, 45.0, 2.0, hh=7.0)
    controls.append(h.dial("loop", 504.0, 54.0, w=44.0, h=44.0))
    controls.append(h.dial("looptime", 548.0, 54.0, w=44.0, h=44.0))
    hline("obj-lay-e-hl-mix", 508.0, 104.0, 82.0)
    label("obj-lay-e-hdr-mix", "MIX", 508.0, 108.0, 82.0, bold=True, size=7.5, align=1)
    controls.append(h.dial("drywet", 527.0, 120.0, w=44.0, h=44.0))

    # ---- swap logic: display outlet 1 -> route -> prepend hidden -> each side ------------------------------------------------
    extra += [
        h.newobj("obj-lay-e-route", "route hide_tank hide_ir", 1300.0, 100.0, 150.0, 1, 3, ["", "", ""]),
        h.newobj("obj-lay-e-hide-tank", "prepend hidden", 1300.0, 140.0, 100.0),
        h.newobj("obj-lay-e-hide-ir", "prepend hidden", 1420.0, 140.0, 100.0),
    ]
    lines = [
        h.line("obj-lay-e-viz", 1, "obj-lay-e-route", 0),
        h.line("obj-lay-e-route", 0, "obj-lay-e-hide-tank", 0),
        h.line("obj-lay-e-route", 1, "obj-lay-e-hide-ir", 0),
    ]
    lines += [h.line("obj-lay-e-hide-tank", 0, t, 0) for t in tank_targets]
    lines += [h.line("obj-lay-e-hide-ir", 0, t, 0) for t in ir_targets]

    panels = [
        h.panel("obj-lay-e-left", *LCOL),
        h.panel("obj-lay-e-right", *RCOL),
        h.panel("obj-lay-e-display", *DISP),
        h.panel("obj-lay-e-body", 0.0, 0.0, W, 169.0),
    ]
    return {
        "width": W,
        "controls": controls,
        "off_face": dict(OFF),
        "panels": panels,
        "panel_theme": [["obj-lay-e-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
                        ["obj-lay-e-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
                        ["obj-lay-e-left", "live_surface_bg", [0.2, 0.2, 0.2, 1]],
                        ["obj-lay-e-right", "live_surface_bg", [0.2, 0.2, 0.2, 1]]],
        "extra_boxes": extra,
        "extra_lines": lines,
        "v8uis": [
            {"id": "obj-lay-e-viz", "files": ["reverbplus_face_e_math.js", "reverbplus_face_e.js"], "rect": list(DISP), "outs": 2,
             "keys": DISPLAY_KEYS},
        ],
    }
