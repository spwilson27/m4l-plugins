"""Reverb+ face `b` -> `Reverb+ B` (520 x 169): "Hybrid tabs", modelled on Ableton's Hybrid Reverb.

  left column   Pre-Delay dial | hairline | Loop dial + Loop Time (small box)      (always visible)
  right column  Width dial, Freeze chip | hairline, MIX title | Dry/Wet dial       (always visible)
  centre        one dark display: page tabs on top (hidden UI-state live.tab `Reverb Page`), the display v8ui
                (src/reverbplus_face_b*.js), a hairline, then the LCD row of real live.* widgets (label above value):
      Reverb    waterfall | Algorithm  Decay Size Diffusion Mod   (tank)
                         | Algorithm  [IR box + browse / clear]  IR Start Stretch Decay  Reverse   (Convolution)
      Tone      EQ view (draggable nodes) | Low Cut High Cut | HF Damp Bass Mult Crossover
      Loop      outer-loop diagram | Clip Mode  Clip Level
Thin separators (live.line, the display's frame colour) divide the groups of the LCD row; cyan values = output filter,
amber = decay / loop, the same colours as the EQ nodes. Which widgets show is decided by the display v8ui (outlet 1:
`g_<group> <hide>` -> route -> `prepend hidden`, groups in src/reverbplus_face_b_math.js `rbVis`).
Off the face (justified in `off_face`): Mod Rate, Early, Late, Ducking, Duck Release, Output.
Preview state of another page / algorithm: RCB_PAGE=0..2 RCB_ALGO=0..5 (build and render_preview both read them).
"""

import os

W = 520.0
DISP = [59.0, 4.0, 402.0, 161.0]
VIZ = [63.0, 22.0, 394.0, 104.0]
LBL_Y = 131.0
VAL_Y = 142.0
CELL_H = 15.0

CYAN = (0.30, 0.82, 0.95)
AMBER = (0.97, 0.68, 0.26)

PAGE_ENUM = ["Reverb", "Tone", "Loop"]
GROUPS = ["rev", "tank", "ir", "tone", "tonebass", "loop", "freeze"]
# algorithms where a parameter does not apply (RP_INACTIVE in src/reverbplus_config.js; the test compares)
INACTIVE_BASS = (0, 4, 5)

VIZ_KEYS = ["algo", "page", "decay", "bassmult", "xover", "damp", "lowcut", "highcut", "loop", "looptime", "loopclip", "looplevel",
            "freeze", "predelay"]

OFF_FACE = {
    "modrate": "rarely changed once the tail sounds right (Mod Depth is in the LCD row); stays automatable in Live's parameter list",
    "erlevel": "a mix trim of the early reflections, set once per room (Hall / Room / Chamber only); stays automatable",
    "latelevel": "level of the tail, redundant with Dry/Wet for everyday use; stays automatable",
    "duck": "a set-and-forget effect; stays automatable (and in Live's device parameter list)",
    "duckrel": "only matters while Ducking is used; stays automatable",
    "output": "a gain trim: Dry/Wet already balances the level, unity is right for almost every patch; stays automatable",
}


def _state():
    page = int(os.environ.get("RCB_PAGE", "0") or 0)
    algo = int(os.environ.get("RCB_ALGO", "1") or 1)
    return max(0, min(2, page)), max(0, min(5, algo))


def visible_groups(page, algo):
    """Which groups of widgets are visible (mirror of rbVis in src/reverbplus_face_b_math.js; the test checks the two agree)."""
    return {
        "rev": page == 0,
        "tank": page == 0 and algo != 5,
        "ir": page == 0 and algo == 5,
        "tone": page == 1,
        "tonebass": page == 1 and algo not in INACTIVE_BASS,
        "loop": page == 2,
        "freeze": algo != 5,
    }


def layout(h):
    page0, algo0 = _state()
    if algo0 != 1:
        p = h.P["algo"]
        h.P["algo"] = p[:4] + (algo0,) + p[5:]
    h.register("page", "Reverb Page", "Page", 0, 2, page0, ptype=2, unit=9, help_text="Reverb, Tone or Loop controls in the display.",
               enum=PAGE_ENUM)
    vis0 = visible_groups(page0, algo0)

    controls, extra, groups = [], [], {g: [] for g in GROUPS}

    def hid(group):
        return 0 if (group is None or vis0[group]) else 1

    def add_group(group, oid):
        if group:
            groups[group].append(oid)

    def label(oid, text, x, y, w, group=None, bold=False, size=7.5, align=1, in_display=True):
        b = h.label(oid, text, x, y, w, 11.0, size=size, bold=bold, align=align, hidden=hid(group))
        h.theme(b, textcolor="live_lcd_title" if in_display else "live_control_fg")
        extra.append(b)
        add_group(group, oid)

    def hline(oid, x, y, w, ht=2.0, group=None, theme="live_lcd_frame"):
        box = {"box": {"id": oid, "maxclass": "live.line", "justification": 1, "numinlets": 1, "numoutlets": 0,
                       "patching_rect": [700.0 + x, 700.0 + y, w, ht], "presentation": 1, "presentation_rect": [x, y, w, ht],
                       "varname": oid}}
        if hid(group):
            box["box"]["hidden"] = 1
        if theme:
            h.theme(box, linecolor=theme)
        extra.append(box)
        add_group(group, oid)

    def vline(oid, x, y, hgt, group=None):
        hline(oid, x, y, 2.0, hgt, group)

    def lcd(key, text, x, w, group, color):
        """An LCD cell: label above, borderless live.numbox below (value in the theme's display colour)."""
        box = h.numbox(key, x, VAL_Y, w, CELL_H, color=color, appearance=4, hidden=hid(group))
        h.theme(box, textcolor="live_display_line_one" if color == CYAN else "live_display_line_two",
                lcdcolor="live_display_line_one" if color == CYAN else "live_display_line_two")
        controls.append(box)
        add_group(group, f"obj-ctrl-{key}")
        label(f"obj-lay-b-lbl-{key}", text, x, LBL_Y, w, group)

    # ---- left column: Pre-Delay | Loop ---------------------------------------------------------------------------
    controls.append(h.dial("predelay", 7.0, 6.0, w=46.0, h=46.0))
    hline("obj-lay-b-l-sep", 8.0, 57.0, 44.0, theme=None)
    controls.append(h.dial("loop", 7.0, 62.0, w=46.0, h=46.0))
    label("obj-lay-b-lbl-looptime", "Loop Time", 7.0, 111.0, 46.0, in_display=False)
    controls.append(h.numbox("looptime", 7.0, 122.0, 46.0, 15.0, appearance=0))

    # ---- right column: Width, Freeze | MIX: Dry/Wet ----------------------------------------------------------------
    controls.append(h.dial("width", 465.0, 6.0, w=46.0, h=46.0))
    controls.append(h.button("freeze", 469.0, 58.0, 44.0, 15.0, text="Freeze", hidden=hid("freeze")))
    groups["freeze"].append("obj-ctrl-freeze")
    hline("obj-lay-b-r-sep", 469.0, 90.0, 44.0, theme=None)
    label("obj-lay-b-r-mix", "MIX", 465.0, 94.0, 46.0, bold=True, in_display=False)
    controls.append(h.dial("drywet", 465.0, 110.0, w=46.0, h=46.0))

    # ---- display: tabs, the v8ui, the LCD row ---------------------------------------------------------------------
    controls.append(h.tab("page", 187.0, 6.0, 146.0, 15.0, rows=1))
    hline("obj-lay-b-lcd-sep", 65.0, 127.0, 390.0)

    # Reverb tab: Algorithm | (tank) Decay Size Diffusion | Mod        (Convolution) IR box | IR Start Stretch Decay | Reverse
    algo = h.menu("algo", 67.0, VAL_Y, 78.0, CELL_H, hidden=hid("rev"))
    controls.append(algo)
    groups["rev"].append("obj-ctrl-algo")
    label("obj-lay-b-lbl-algo", "Algorithm", 67.0, LBL_Y, 78.0, "rev")
    vline("obj-lay-b-sep-a", 150.0, 131.0, 26.0, group="rev")
    lcd("decay", "Decay", 158.0, 62.0, "tank", CYAN)
    lcd("size", "Size", 224.0, 62.0, "tank", CYAN)
    lcd("diffusion", "Diffusion", 290.0, 62.0, "tank", CYAN)
    vline("obj-lay-b-sep-b", 358.0, 131.0, 26.0, group="tank")
    lcd("moddepth", "Mod", 364.0, 62.0, "tank", CYAN)

    label("obj-lay-b-lbl-ir", "Convolution IR", 158.0, LBL_Y, 98.0, "ir")
    vline("obj-lay-b-sep-ir", 262.0, 131.0, 26.0, group="ir")
    lcd("irstart", "Start", 268.0, 44.0, "ir", CYAN)
    lcd("irstretch", "Stretch", 316.0, 44.0, "ir", CYAN)
    lcd("irdecay", "IR Decay", 364.0, 44.0, "ir", CYAN)
    controls.append(h.button("irreverse", 412.0, VAL_Y, 44.0, CELL_H, text="Reverse", hidden=hid("ir")))
    groups["ir"].append("obj-ctrl-irreverse")
    label("obj-lay-b-lbl-irreverse", "Direction", 412.0, LBL_Y, 44.0, "ir")
    # IR name field: drawn by an ignoreclick v8ui, the live.drop (parameter IR File) sits in front of it, transparent
    drop = h.irdrop(158.0, VAL_Y, 66.0, CELL_H, hidden=hid("ir"), ignoreclick=0)
    for k in ("bordercolor", "textcolor"):
        drop["box"][k] = [0.0, 0.0, 0.0, 0.0]
    drop["box"]["legend"] = ""
    controls.append(drop)
    groups["ir"] += ["obj-ctrl-irfile", "obj-lay-b-irname", "obj-lay-b-irbtn"]

    # Tone tab: Low Cut High Cut | HF Damp Bass Mult Crossover
    lcd("lowcut", "Low Cut", 67.0, 62.0, "tone", CYAN)
    lcd("highcut", "High Cut", 133.0, 62.0, "tone", CYAN)
    vline("obj-lay-b-sep-t", 199.0, 131.0, 26.0, group="tone")
    lcd("damp", "HF Damp", 206.0, 62.0, "tone", AMBER)
    lcd("bassmult", "Bass Mult", 272.0, 62.0, "tonebass", AMBER)
    lcd("xover", "Crossover", 338.0, 62.0, "tonebass", AMBER)

    # Loop tab: Clip Mode | Clip Level (Loop and Loop Time are the left column)
    controls.append(h.menu("loopclip", 67.0, VAL_Y, 78.0, CELL_H, hidden=hid("loop")))
    groups["loop"].append("obj-ctrl-loopclip")
    label("obj-lay-b-lbl-loopclip", "Clip Mode", 67.0, LBL_Y, 78.0, "loop")
    vline("obj-lay-b-sep-l", 150.0, 131.0, 26.0, group="loop")
    lcd("looplevel", "Clip Level", 158.0, 62.0, "loop", AMBER)

    # ---- off the face ----------------------------------------------------------------------------------------------
    for key in OFF_FACE:
        b = h.numbox(key, 0.0, 0.0, 40.0, 15.0, hidden=1)
        b["box"]["presentation"] = 0
        del b["box"]["presentation_rect"]
        controls.append(b)

    # ---- show / hide wiring ------------------------------------------------------------------------------------------
    extra.append(h.newobj("obj-lay-b-route", "route " + " ".join(f"g_{g}" for g in GROUPS), 1300.0, 100.0, 330.0, 1, len(GROUPS) + 1,
                          [""] * (len(GROUPS) + 1)))
    lines = [h.line("obj-lay-b-viz", 1, "obj-lay-b-route", 0)]
    for i, g in enumerate(GROUPS):
        pid = f"obj-lay-b-hide-{g}"
        extra.append(h.newobj(pid, "prepend hidden", 1300.0 + 110.0 * i, 140.0, 100.0))
        lines.append(h.line("obj-lay-b-route", i, pid, 0))
        lines += [h.line(pid, 0, t, 0) for t in groups[g]]

    panels = [
        h.panel("obj-lay-b-left", 3.0, 4.0, 54.0, 161.0),
        h.panel("obj-lay-b-right", 463.0, 4.0, 54.0, 161.0),
        h.panel("obj-lay-b-display", DISP[0], DISP[1], DISP[2], DISP[3]),
        h.panel("obj-lay-b-body", 0.0, 0.0, W, 169.0),
    ]
    return {
        "width": W,
        "controls": controls,
        "off_face": {k: v for k, v in OFF_FACE.items()},
        "panels": panels,
        "panel_theme": [["obj-lay-b-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
                        ["obj-lay-b-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
                        ["obj-lay-b-left", "live_surface_bg", [0.2, 0.2, 0.2, 1]],
                        ["obj-lay-b-right", "live_surface_bg", [0.2, 0.2, 0.2, 1]]],
        "extra_boxes": extra,
        "extra_lines": lines,
        "v8uis": [
            {"id": "obj-lay-b-viz", "files": ["reverbplus_face_b_math.js", "reverbplus_face_b.js"], "rect": list(VIZ), "outs": 2,
             "keys": VIZ_KEYS},
            # IR name field (draws under the transparent live.drop) and the browse / clear buttons next to it
            {"id": "obj-lay-b-irname", "files": ["reverbplus_face_b_ir.js"], "rect": [158.0, VAL_Y, 66.0, CELL_H], "outs": 1,
             "keys": [], "ignoreclick": True, "hidden": not vis0["ir"], "preamble": "var RBI_MODE = \"name\";"},
            {"id": "obj-lay-b-irbtn", "files": ["reverbplus_face_b_ir.js"], "rect": [226.0, VAL_Y, 30.0, CELL_H], "outs": 1,
             "keys": [], "hidden": not vis0["ir"], "preamble": "var RBI_MODE = \"btn\";"},
        ],
    }
