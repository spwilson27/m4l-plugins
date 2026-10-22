"""Reverb+ face `c` -> `Reverb+ C` (444 x 169): "Essentials + More", the most minimal control scheme.

Default view: only the essentials, as big dials, around the Decay Waterfall (a 320 x 144 copy of the shipped hero).
  header row   Algorithm dropdown | status pills (draw-only v8ui) | Freeze chip | More chip
  SPACE        Pre-Delay, Size, Decay  (left column: title hairline + a bracket down its left edge)
  SOUND        HF Damp ("Tone"), Loop, Dry/Wet  (right column, same grammar)
More (hidden UI-state parameter `More`, the chip): the waterfall is hidden and the display shows a grid of the advanced
values as small LCD numboxes under titled hairlines: SHAPE (Diffusion, Mod Rate, Mod Depth, Early, Late) | TONE (Low Cut,
High Cut, Bass Mult, Crossover) | LOOP (Loop Time, Clip Mode, Clip Level) | OUT (Width, Ducking, Duck Rel, Output).
In Convolution the SHAPE column becomes IMPULSE (Stretch, Start, Decay, Reverse; Late stays on row 5) and the LOOP column
gains the IR File drop. Controls the algorithm does not use are greyed (`active 0`) by the head strip v8ui.
Swapping: the head strip v8ui (src/reverbplus_face_c_head.js) shows / hides boxes by scripting name with setattr("hidden").
Build-time preview pages: RP_C_PAGE=more | more_conv python3 scripts/build_reverbplus.py --variant c (saved state of the
device is then the More view / the More view in Convolution; default is the essentials view).
"""
import json
import os

W = 444.0
PAGE = os.environ.get("RP_C_PAGE", "")
MORE0 = 1 if PAGE in ("more", "more_conv") else 0
CONV0 = 1 if PAGE == "more_conv" else 0

LEFT_X, RIGHT_X, COL_W = 4.0, 386.0, 54.0
DISPLAY = [62.0, 21.0, 320.0, 144.0]
HEAD_Y, HEAD_H = 4.0, 15.0
ALGO = [62.0, HEAD_Y, 78.0, HEAD_H]
STATUS = [144.0, HEAD_Y, 122.0, HEAD_H]
FREEZE = [270.0, HEAD_Y, 52.0, HEAD_H]
MORE = [326.0, HEAD_Y, 56.0, HEAD_H]

DIAL_W, DIAL_H, DIAL_Y0, DIAL_PITCH = 46.0, 46.0, 21.0, 48.0
SPACE = ["predelay", "size", "decay"]
SOUND = ["damp", "loop", "drywet"]

GRID_X0, GRID_PITCH, ITEM_W = 66.0, 78.0, 74.0
TITLE_Y, RULE_Y, ROW_Y0, ROW_PITCH = 24.0, 36.0, 40.0, 25.0
# column -> (title, [(key, label)])
SHAPE = [("diffusion", "Diffusion"), ("modrate", "Mod Rate"), ("moddepth", "Mod Depth"), ("erlevel", "Early"), ("latelevel", "Late")]
IR = [("irstretch", "Stretch"), ("irstart", "Start"), ("irdecay", "Decay"), ("irreverse", None)]
TONE = [("lowcut", "Low Cut"), ("highcut", "High Cut"), ("bassmult", "Bass Mult"), ("xover", "Crossover")]
LOOP = [("looptime", "Loop Time"), ("loopclip", "Clip Mode"), ("looplevel", "Clip Level")]
OUT = [("width", "Width"), ("duck", "Ducking"), ("duckrel", "Duck Rel"), ("output", "Output")]
FILE_ROW = 4

LCD_FALLBACK = [0.30, 0.82, 0.95, 1.0]


def hid(group):
    """Initial `hidden` flag of a swap group for the saved state (PAGE)."""
    if group == "more":
        return 0 if MORE0 else 1
    if group == "tank":
        return 1 if (not MORE0 or CONV0) else 0
    return 1 if (not MORE0 or not CONV0) else 0  # ir


def layout(h):
    controls = []
    extra = []
    groups = {"more": [], "tank": [], "ir": []}
    key_names = {}

    h.register("more", "More", "More", 0, 1, MORE0, ptype=2, unit=9, enum=["Less", "More"],
               help_text="Shows the advanced controls (Shape, Tone, Loop, Out and, in Convolution, the impulse response) instead of the waterfall.")

    def name_of(key):
        return h.P[key][0]

    def label(oid, text, x, y, w, group=None, bold=False, size=7.5, hidden=0, lcd=True):
        b = h.label(oid, text, x, y, w, 11.0 if bold else 10.0, size=size, bold=bold, hidden=hidden)
        if lcd:
            h.theme(b, textcolor="live_lcd_title")
        extra.append(b)
        if group:
            groups[group].append(oid)
        return oid

    def rule(oid, x, y, w, hgt, group=None, hidden=0):
        """A live.line hairline (2 px box draws a 1 px line; Live's frame colour follows the theme)."""
        b = {"box": {"id": oid, "maxclass": "live.line", "justification": 1, "numinlets": 1, "numoutlets": 0, "varname": oid,
                     "patching_rect": [600.0 + x, 700.0 + y, w, hgt], "presentation": 1, "presentation_rect": [x, y, w, hgt]}}
        b["box"]["linecolor"] = [0.36, 0.40, 0.46, 1.0]
        h.theme(b, linecolor="live_surface_frame")
        if hidden:
            b["box"]["hidden"] = 1
        extra.append(b)
        if group:
            groups[group].append(oid)
        return oid

    def lcd(key, x, y, group, hidden):
        box = h.numbox(key, x, y, ITEM_W, 15.0, color=None, appearance=4, hidden=hidden)
        box["box"]["textcolor"] = LCD_FALLBACK
        box["box"]["lcdcolor"] = LCD_FALLBACK
        h.theme(box, textcolor="live_lcd_control_fg", lcdcolor="live_lcd_control_fg")
        controls.append(box)
        groups[group].append(name_of(key))
        key_names[key] = name_of(key)
        return box

    def item(col, row, key, text, group):
        x = GRID_X0 + col * GRID_PITCH
        y = ROW_Y0 + row * ROW_PITCH
        hidden = hid(group)
        label(f"obj-lay-c-lbl-{key}", text, x, y, ITEM_W, group, hidden=hidden)
        if key == "loopclip":
            m = h.menu(key, x, y + 10.0, ITEM_W, 15.0, hidden=hidden)
            controls.append(m)
            groups[group].append(name_of(key))
            key_names[key] = name_of(key)
        else:
            lcd(key, x, y + 10.0, group, hidden)

    def section(col, oid, title, group):
        x = GRID_X0 + col * GRID_PITCH
        hidden = hid(group)
        label(oid, title, x, TITLE_Y, ITEM_W, group, bold=True, hidden=hidden)
        if group == "more" or col != 0:
            rule(f"{oid}-rule", x, RULE_Y, ITEM_W, 2.0, "more", hid("more"))

    # ---- header row ---------------------------------------------------------------------------------------------
    algo = h.menu("algo", *ALGO)
    if CONV0:
        algo["box"]["saved_attribute_attributes"]["valueof"]["parameter_initial"] = [5]
    controls.append(algo)
    controls.append(h.button("freeze", *FREEZE, text="Freeze"))
    controls.append(h.button("more", *MORE, text="More", texton="Less"))
    key_names["freeze"] = name_of("freeze")

    # ---- essentials: two columns of dials with a title hairline and a bracket down the outer edge -----------------
    for x0, title, keys, oid in ((LEFT_X, "SPACE", SPACE, "space"), (RIGHT_X, "SOUND", SOUND, "sound")):
        label(f"obj-lay-c-hdr-{oid}", title, x0 + 4.0, 6.0, 46.0, bold=True, lcd=False)
        rule(f"obj-lay-c-rule-{oid}", x0 + 4.0, 18.0, 46.0, 2.0)
        edge = x0 + 1.0 if x0 == LEFT_X else x0 + COL_W - 3.0
        rule(f"obj-lay-c-brk-{oid}", edge, DIAL_Y0, 2.0, DIAL_PITCH * len(keys) - 2.0)
        for i, key in enumerate(keys):
            d = h.dial(key, x0 + 4.0, DIAL_Y0 + i * DIAL_PITCH, w=DIAL_W, h=DIAL_H)
            d["box"]["fontsize"] = 8.0
            controls.append(d)
            key_names[key] = name_of(key)
            if i:
                rule(f"obj-lay-c-sep-{oid}{i}", x0 + 4.0, DIAL_Y0 + i * DIAL_PITCH - 2.0, 46.0, 2.0)

    # ---- the More grid ----------------------------------------------------------------------------------------------
    section(0, "obj-lay-c-t-shape", "SHAPE", "tank")
    section(0, "obj-lay-c-t-ir", "IMPULSE", "ir")
    rule("obj-lay-c-rule-col0", GRID_X0, RULE_Y, ITEM_W, 2.0, "more", hid("more"))
    for row, (key, text) in enumerate(SHAPE):
        item(0, row, key, text, "more" if key == "latelevel" else "tank")
    for row, (key, text) in enumerate(IR):
        if key == "irreverse":
            btn = h.button(key, GRID_X0, ROW_Y0 + row * ROW_PITCH + 10.0, ITEM_W, 15.0, text="Reverse", hidden=hid("ir"))
            controls.append(btn)
            groups["ir"].append(name_of(key))
            key_names[key] = name_of(key)
        else:
            item(0, row, key, text, "ir")
    section(1, "obj-lay-c-t-tone", "TONE", "more")
    for row, (key, text) in enumerate(TONE):
        item(1, row, key, text, "more")
    section(2, "obj-lay-c-t-loop", "LOOP", "more")
    for row, (key, text) in enumerate(LOOP):
        item(2, row, key, text, "more")
    label("obj-lay-c-lbl-irfile", "IR File", GRID_X0 + 2 * GRID_PITCH, ROW_Y0 + FILE_ROW * ROW_PITCH, ITEM_W, "ir", hidden=hid("ir"))
    drop = h.irdrop(GRID_X0 + 2 * GRID_PITCH, ROW_Y0 + FILE_ROW * ROW_PITCH + 10.0, ITEM_W, 15.0, hidden=hid("ir"))
    controls.append(drop)
    groups["ir"].append(name_of("irfile"))
    section(3, "obj-lay-c-t-out", "OUT", "more")
    for row, (key, text) in enumerate(OUT):
        item(3, row, key, text, "more")
    for col in (1, 2, 3):
        rule(f"obj-lay-c-vsep{col}", GRID_X0 + col * GRID_PITCH - 3.0, TITLE_Y, 2.0, 139.0, "more", hid("more"))

    panels = [
        h.panel("obj-lay-c-left", LEFT_X, 4.0, COL_W, 161.0),
        h.panel("obj-lay-c-right", RIGHT_X, 4.0, COL_W, 161.0),
        h.panel("obj-lay-c-display", *DISPLAY),
        h.panel("obj-lay-c-body", 0.0, 0.0, W, 169.0),
    ]
    layout_js = {"heroRect": list(DISPLAY), "groups": groups, "keyNames": key_names}
    return {
        "width": W,
        "controls": controls,
        "off_face": {},
        "panels": panels,
        "panel_theme": [["obj-lay-c-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
                        ["obj-lay-c-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
                        ["obj-lay-c-left", "live_surface_bg", [0.2, 0.2, 0.2, 1]],
                        ["obj-lay-c-right", "live_surface_bg", [0.2, 0.2, 0.2, 1]]],
        "extra_boxes": extra,
        "extra_lines": [],
        "v8uis": [
            {"id": "obj-lay-c-viz", "files": ["reverbplus_face_c_math.js", "reverbplus_face_c.js"], "rect": list(DISPLAY),
             "outs": 1, "hidden": 1 if MORE0 else 0,
             "keys": ["algo", "decay", "bassmult", "xover", "damp", "size", "predelay", "loop", "looptime", "freeze"]},
            {"id": "obj-lay-c-head", "files": ["reverbplus_face_c_head.js"], "rect": list(STATUS), "outs": 1, "ignoreclick": True,
             "keys": ["more", "algo", "loop"],
             "preamble": "var CC_LAYOUT = " + json.dumps(layout_js) + ";"},
        ],
    }
