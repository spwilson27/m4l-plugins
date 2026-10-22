"""Reverb+ face `a` -> `Reverb+ A` (586 x 169): "Signal-flow sections", modelled on Ableton's Reverb.

The face reads left to right as the signal flows, as titled sections with a hairline under each title and vertical
separators between them; paired values are joined by brackets, small values are LCD readouts on dark wells.

  INPUT  x 4..82     Pre-Delay dial, a tiny filter curve (display only), Low Cut / High Cut LCD values (bracketed)
  SPACE  x 82..304   Algorithm menu in the title row, the waterfall display, Size / Decay / Diffusion dials under it,
                     and a column of Mod Rate / Mod Depth LCD values (bracketed). Convolution swaps the dials for
                     IR Stretch / Start / Decay and the Mod column for IR Reverse + the IR drop.
  TONE   x 304..404  HF Damp + Bass Mult dials, Crossover LCD under Bass Mult, LEVELS: Late / Early LCD (bracketed)
  LOOP   x 404..498  Loop + Loop Time dials, LOOP CLIP: Clip Mode menu + Clip Level LCD (bracketed), clip LED + MIN
  right  x 502..582  Freeze chip, Width dial, Dry/Wet dial (like Reverb's right column)
Off the face: Output, Ducking, Duck Release (see OFF_FACE).

Two v8uis (both in src/): `obj-lay-a-deco` (reverbplus_face_a_deco.js, ignoreclick, whole face, BEHIND every
control: titles, hairlines, separators, LCD wells, brackets, labels, filter curve, clip LED) and `obj-lay-a-viz`
(reverbplus_face_a.js, the display; its outlet 1 sends `hide_tank` / `hide_ir` for the Convolution swap).
Build the Convolution page for a preview with RA_PAGE=conv (then render_preview.py, RC_PREVIEW=conv).
"""
import os

W = 586.0
PAGE = os.environ.get("RA_PAGE", "tank")

HERO = [88.0, 26.0, 210.0, 88.0]
DIAL_W, DIAL_H = 40.0, 44.0

# (key, x, y) of the dials
DIALS = {
    "predelay": (23.0, 26.0),
    "size": (90.0, 118.0), "decay": (136.0, 118.0), "diffusion": (182.0, 118.0),
    "irstretch": (90.0, 118.0), "irstart": (136.0, 118.0), "irdecay": (182.0, 118.0),
    "damp": (310.0, 26.0), "bassmult": (358.0, 26.0),
    "loop": (412.0, 26.0), "looptime": (456.0, 26.0),
    "width": (522.0, 45.0), "drywet": (522.0, 103.0),
}
# LCD values: key -> [x, y, w, h] (the deco script draws the well and the label behind each)
LCD = {
    "lowcut": [28.0, 124.0, 48.0, 15.0], "highcut": [28.0, 141.0, 48.0, 15.0],
    "xover": [358.0, 74.0, 40.0, 15.0],
    "latelevel": [354.0, 112.0, 44.0, 15.0], "erlevel": [354.0, 129.0, 44.0, 15.0],
    "modrate": [262.0, 132.0, 36.0, 14.0], "moddepth": [262.0, 148.0, 36.0, 14.0],
    "looplevel": [438.0, 109.0, 54.0, 15.0],
}
LOOPCLIP = [438.0, 92.0, 54.0, 15.0]
ALGO = [214.0, 5.0, 84.0, 14.0]
FREEZE = [508.0, 16.0, 68.0, 17.0]
IRREVERSE = [234.0, 132.0, 64.0, 14.0]
IRDROP = [234.0, 148.0, 64.0, 14.0]

TANK_ONLY = ["size", "decay", "diffusion", "modrate", "moddepth", "bassmult", "xover", "erlevel"]
IR_ONLY = ["irstretch", "irstart", "irdecay", "irreverse", "irfile"]

OFF_FACE = {
    "output": "rarely changed and the track fader does the same job; Dry/Wet already sets the wet level (still automatable)",
    "duck": "a set-and-forget effect (ducking the reverb under loud dry signal); kept off the face to keep it to the always-needed controls",
    "duckrel": "belongs to Ducking; both stay in Live's parameter list for automation",
}

HERO_KEYS = ["algo", "decay", "bassmult", "xover", "damp", "freeze"]
DECO_KEYS = ["algo", "lowcut", "highcut", "loop"]


def layout(h):
    controls = []
    conv_page = PAGE == "conv"

    def vis(key, hidden_default=0):
        """hidden flag for the saved state: the tank page shows the tank controls, the conv page the IR ones."""
        if key in TANK_ONLY:
            return 1 if conv_page else 0
        if key in IR_ONLY:
            return 0 if conv_page else 1
        return hidden_default

    for key, (x, y) in DIALS.items():
        controls.append(h.dial(key, x, y, hidden=vis(key), w=DIAL_W, h=DIAL_H))
    for key, r in LCD.items():
        box = h.numbox(key, r[0], r[1], r[2], r[3], appearance=4, hidden=vis(key))
        box["box"]["fontsize"] = 8.0
        h.theme(box, textcolor="live_lcd_control_fg", lcdcolor="live_lcd_control_fg")
        controls.append(box)
    controls.append(h.menu("loopclip", *LOOPCLIP))
    algo = h.menu("algo", *ALGO)
    if conv_page:
        algo["box"]["saved_attribute_attributes"]["valueof"]["parameter_initial"] = [5]
    controls.append(algo)
    controls.append(h.button("freeze", *FREEZE, text="Freeze"))
    controls.append(h.button("irreverse", *IRREVERSE, text="Reverse", hidden=vis("irreverse")))
    controls.append(h.irdrop(*IRDROP, hidden=vis("irfile")))

    for key in OFF_FACE:  # real, automatable live.* objects that are not on the face
        off = h.numbox(key, 0.0, 0.0, 40.0, 14.0, appearance=2, hidden=1)
        off["box"]["presentation"] = 0
        del off["box"]["presentation_rect"]
        controls.append(off)

    tank_targets = [f"obj-ctrl-{k}" for k in TANK_ONLY]
    ir_targets = [f"obj-ctrl-{k}" for k in IR_ONLY]

    # swap logic: the display's outlet 1 -> route -> prepend hidden -> each side; Freeze is greyed in Convolution
    extra = [
        h.newobj("obj-lay-a-route", "route hide_tank hide_ir", 1300.0, 100.0, 150.0, 1, 3, ["", "", ""]),
        h.newobj("obj-lay-a-hide-tank", "prepend hidden", 1300.0, 140.0, 100.0),
        h.newobj("obj-lay-a-hide-ir", "prepend hidden", 1420.0, 140.0, 100.0),
        h.newobj("obj-lay-a-frz-not", "== 0", 1300.0, 180.0, 40.0),
        h.newobj("obj-lay-a-frz-active", "prepend active", 1300.0, 220.0, 100.0),
    ]
    lines = [
        h.line("obj-lay-a-viz", 1, "obj-lay-a-route", 0),
        h.line("obj-lay-a-route", 0, "obj-lay-a-hide-tank", 0),
        h.line("obj-lay-a-route", 1, "obj-lay-a-hide-ir", 0),
        h.line("obj-lay-a-route", 0, "obj-lay-a-frz-not", 0),
        h.line("obj-lay-a-frz-not", 0, "obj-lay-a-frz-active", 0),
        h.line("obj-lay-a-frz-active", 0, "obj-ctrl-freeze", 0),
    ]
    lines += [h.line("obj-lay-a-hide-tank", 0, t, 0) for t in tank_targets]
    lines += [h.line("obj-lay-a-hide-ir", 0, t, 0) for t in ir_targets]

    panels = [
        h.panel("obj-lay-a-right", 502.0, 4.0, 80.0, 161.0),
        h.panel("obj-lay-a-main", 4.0, 4.0, 494.0, 161.0),
        h.panel("obj-lay-a-body", 0.0, 0.0, W, 169.0),
    ]
    return {
        "width": W,
        "controls": controls,
        "off_face": dict(OFF_FACE),
        "panels": panels,
        "panel_theme": [["obj-lay-a-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
                        ["obj-lay-a-main", "live_surface_bg", [0.2, 0.2, 0.2, 1]],
                        ["obj-lay-a-right", "live_surface_bg", [0.2, 0.2, 0.2, 1]]],
        "extra_boxes": extra,
        "extra_lines": lines,
        "v8uis": [
            {"id": "obj-lay-a-deco", "files": ["reverbplus_face_a_deco.js"], "rect": [0.0, 0.0, W, 169.0], "outs": 1,
             "keys": DECO_KEYS, "ignoreclick": True},
            {"id": "obj-lay-a-viz", "files": ["reverbplus_face_math.js", "reverbplus_face_a.js"], "rect": list(HERO), "outs": 2,
             "keys": HERO_KEYS},
        ],
    }
