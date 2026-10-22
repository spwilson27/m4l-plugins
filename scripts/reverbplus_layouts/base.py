"""Reverb+ face `base` -> `Reverb+` (692 x 169): "Decay Waterfall", analysis first.

  hero v8ui (4,4  340 x 161)   algorithm icons, pseudo-3D wet-spectrum waterfall with the predicted decay (RT60 per
                               band) as an amber ghost, dry vs wet strip, footer (src/reverbplus_face*.js)
  three columns of value bars  live.numbox appearance 2 (Live theme colours), label comment at the left of each bar
      col 1  SPACE  Pre-Delay, Decay | SIZE / MOD (Size, Diffusion, Mod Rate, Mod Depth) or, in Convolution,
             IMPULSE (IR Stretch, IR Start, IR Decay, IR Reverse) | Freeze
      col 2  TONE   HF Damp, Bass Mult, Crossover, Low Cut, High Cut | LOOP  Loop, Loop Time, Clip Level, Clip Mode
      col 3  MIX    Early, Late, Width, Dry/Wet, Output, Duck, Duck Rel | IMPULSE FILE (the IR drop)
`Algorithm` is off the face: the hero's six vector icons drive it through rpSend.
The swap block is shown / hidden by the hero: its outlet 1 sends `hide_tank <0|1>` / `hide_ir <0|1>` -> route ->
`prepend hidden` -> the widgets and labels of each side (the tank side is saved visible, the IR side hidden).
"""

CYAN = (0.30, 0.82, 0.95)
GREEN = (0.40, 0.88, 0.52)
AMBER = (0.97, 0.68, 0.26)
VIOLET = (0.66, 0.55, 0.98)
COL_COLOR = [CYAN, GREEN, VIOLET]

W = 692.0
HERO = [4.0, 4.0, 340.0, 161.0]
COLS = [352.0, 464.0, 576.0]
LABEL_W = 40.0
BAR_W = 69.0
ROW = 15.0

# (key, label) per row, y
COL1_TOP = [("predelay", "Pre-Dly", 16.0), ("decay", "Decay", 31.0)]
SWAP_Y = [59.0, 74.0, 89.0, 104.0]
TANK = [("size", "Size"), ("diffusion", "Diffus"), ("modrate", "Mod Rate"), ("moddepth", "Mod Dep")]
IR = [("irstretch", "Stretch"), ("irstart", "Start"), ("irdecay", "Decay"), ("irreverse", None)]
COL2_TONE = [("damp", "HF Damp", 16.0), ("bassmult", "Bass x", 31.0), ("xover", "X-over", 46.0), ("lowcut", "Low Cut", 61.0),
             ("highcut", "High Cut", 76.0)]
COL2_LOOP = [("looplevel", "Clip Lv", 134.0)]
COL3_MIX = [("erlevel", "Early", 16.0), ("latelevel", "Late", 31.0), ("width", "Width", 46.0), ("drywet", "Dry/Wet", 61.0),
            ("output", "Output", 76.0), ("duck", "Duck", 91.0), ("duckrel", "Duck Rel", 106.0)]

HERO_KEYS = ["algo", "decay", "bassmult", "xover", "damp", "size", "predelay", "freeze"]


def layout(h):
    controls = []
    extra = []
    tank_targets = []
    ir_targets = []

    def label(oid, text, x, y, hidden=0, bold=False, w=LABEL_W, size=8.0):
        b = h.label(oid, text, x, y + (0.0 if bold else 2.0), w, 12.0, size=size, bold=bold, hidden=hidden)
        extra.append(b)
        return oid

    def bar(key, text, col, y, hidden=0, color=None):
        x = COLS[col]
        # pre-blended slider fill (AGENTS.md rule 8); the value text follows Live's LCD foreground colour
        box = h.numbox(key, x + LABEL_W + 1.0, y, BAR_W, ROW, color=color or COL_COLOR[col], appearance=2, hidden=hidden)
        h.theme(box, textcolor="live_lcd_control_fg")
        controls.append(box)
        return label(f"obj-lay-base-lbl-{key}", text, x, y, hidden)

    # column 1
    label("obj-lay-base-hdr-space", "SPACE", COLS[0], 6.0, bold=True, w=100.0, size=7.5)
    for key, text, y in COL1_TOP:
        bar(key, text, 0, y)
    label("obj-lay-base-hdr-tank", "SIZE / MOD", COLS[0], 49.0, bold=True, w=100.0, size=7.5)
    tank_targets.append("obj-lay-base-hdr-tank")
    label("obj-lay-base-hdr-ir", "IMPULSE RESPONSE", COLS[0], 49.0, hidden=1, bold=True, w=106.0, size=7.5)
    ir_targets.append("obj-lay-base-hdr-ir")
    for (key, text), y in zip(TANK, SWAP_Y):
        tank_targets += [f"obj-ctrl-{key}", bar(key, text, 0, y)]
    for (key, text), y in zip(IR, SWAP_Y):
        if key == "irreverse":
            controls.append(h.button(key, COLS[0], y, LABEL_W + 1.0 + BAR_W, ROW, text="Reverse", hidden=1))
            ir_targets.append(f"obj-ctrl-{key}")
        else:
            ir_targets += [f"obj-ctrl-{key}", bar(key, text, 0, y, hidden=1)]
    controls.append(h.button("freeze", COLS[0], 124.0, LABEL_W + 1.0 + BAR_W, ROW, text="Freeze"))

    # column 2
    label("obj-lay-base-hdr-tone", "TONE", COLS[1], 6.0, bold=True, w=100.0, size=7.5)
    for key, text, y in COL2_TONE:
        bar(key, text, 1, y)
    label("obj-lay-base-hdr-loop", "LOOP", COLS[1], 94.0, bold=True, w=100.0, size=7.5)
    for key, text, y in COL2_LOOP:
        bar(key, text, 1, y, color=AMBER)
    controls.append(h.menu("loopclip", COLS[1] + LABEL_W + 1.0, 149.0, BAR_W, ROW))
    label("obj-lay-base-lbl-loopclip", "Clip", COLS[1], 149.0)

    # column 3
    label("obj-lay-base-hdr-mix", "MIX", COLS[2], 6.0, bold=True, w=100.0, size=7.5)
    for key, text, y in COL3_MIX:
        bar(key, text, 2, y)
    label("obj-lay-base-hdr-irfile", "IMPULSE FILE", COLS[2], 126.0, bold=True, w=100.0, size=7.5)
    controls.append(h.irdrop(COLS[2], 136.0, LABEL_W + 1.0 + BAR_W, ROW))

    # Algorithm: driven by the hero's icons, a hidden automatable live.menu
    algo = h.menu("algo", COLS[0], 149.0, 40.0, 14.0, hidden=1)
    algo["box"]["presentation"] = 0
    del algo["box"]["presentation_rect"]
    controls.append(algo)

    # swap logic: hero outlet 1 -> route -> prepend hidden -> each side
    extra += [
        h.newobj("obj-lay-base-route", "route hide_tank hide_ir", 1300.0, 100.0, 150.0, 1, 3, ["", "", ""]),
        h.newobj("obj-lay-base-hide-tank", "prepend hidden", 1300.0, 140.0, 100.0),
        h.newobj("obj-lay-base-hide-ir", "prepend hidden", 1420.0, 140.0, 100.0),
    ]
    lines = [
        h.line("obj-lay-base-viz", 1, "obj-lay-base-route", 0),
        h.line("obj-lay-base-route", 0, "obj-lay-base-hide-tank", 0),
        h.line("obj-lay-base-route", 1, "obj-lay-base-hide-ir", 0),
    ]
    lines += [h.line("obj-lay-base-hide-tank", 0, t, 0) for t in tank_targets]
    lines += [h.line("obj-lay-base-hide-ir", 0, t, 0) for t in ir_targets]

    panels = [
        h.panel("obj-lay-base-col1", 350.0, 4.0, 112.0, 161.0),
        h.panel("obj-lay-base-col2", 462.0, 4.0, 112.0, 161.0),
        h.panel("obj-lay-base-col3", 574.0, 4.0, 114.0, 161.0),
        h.panel("obj-lay-base-display", HERO[0], HERO[1], HERO[2], HERO[3]),
        h.panel("obj-lay-base-body", 0.0, 0.0, W, 169.0),
    ]
    return {
        "width": W,
        "controls": controls,
        "off_face": {"algo": "chosen with the six vector icons the hero v8ui draws (it drives the parameter through rpSend)"},
        "panels": panels,
        "panel_theme": [["obj-lay-base-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
                        ["obj-lay-base-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
                        ["obj-lay-base-col1", "live_surface_bg", [0.2, 0.2, 0.2, 1]],
                        ["obj-lay-base-col2", "live_surface_bg", [0.2, 0.2, 0.2, 1]],
                        ["obj-lay-base-col3", "live_surface_bg", [0.2, 0.2, 0.2, 1]]],
        "extra_boxes": extra,
        "extra_lines": lines,
        "v8uis": [
            {"id": "obj-lay-base-viz", "files": ["reverbplus_face_math.js", "reverbplus_face.js"], "rect": list(HERO), "outs": 2,
             "keys": HERO_KEYS},
        ],
    }
