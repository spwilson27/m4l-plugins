"""Reverb+ face `base` -> `Reverb+` (444 x 169): "Hybrid tabs", modelled on Ableton's Hybrid Reverb.

  left column   Pre-Delay dial | hairline | Input dial | hairline | Decay dial (IR Decay in Convolution)
                (the outer-loop latency warning is a status pill in the display's header, like Delay+'s MIN warning)
  right column  Width dial, Freeze chip | hairline | Dry/Wet dial      (always visible)
  centre        one dark display: tabs [Reverb | Tone | Tail] on top (hidden UI-state live.tab `Reverb Page`), the display
                v8ui (src/reverbplus_face*.js), a hairline, then the LCD row of real live.* widgets (label above value):
      Reverb    waterfall | Algorithm  Size Diffusion Mod Depth                        (tank)
                          | Algorithm  [IR box + browse / clear]  IR Start Stretch  Reverse   (Convolution)
      Tone      EQ view (draggable nodes) | Low Cut High Cut | HF Damp Bass Mult Crossover
      Tail      drawn value bars / chips for the nine rarely used parameters (the display grows over the LCD row)
Thin separators (live.line, the display's frame colour) divide the groups of the LCD row; cyan values = output filter /
space, amber = decay, the same colours as the EQ nodes. Which widgets show is decided by the display v8ui (outlet 1:
`g_<group> <hide>` -> route -> `prepend hidden`, groups in src/reverbplus_face_math.js `rbVis`; `viz_tall <0|1>` ->
`presentation_rect` of the display).
Off the face (justified in `off_face`): Mod Rate, Early, Late, Output, Ducking, Duck Release, Clip Level, Clip Mode
(drawn on the Tail tab, driven through rpSend). Mod Depth is in the Reverb tab's LCD row AND drawn on the Tail tab (one
live.numbox; the Tail bar drives it through rpSend).
Preview state of another tab / algorithm: RC_PAGE=0..2 RC_ALGO=0..5 (build and render_preview both read them).
"""

import os

W = 444.0
DISP = [61.0, 4.0, 322.0, 161.0]
VIZ_X, VIZ_Y, VIZ_W = 64.0, 22.0, 316.0
VIZ_H, VIZ_H_TALL = 104.0, 135.0
LBL_Y = 131.0
VAL_Y = 142.0
CELL_H = 15.0

CYAN = (0.30, 0.82, 0.95)
AMBER = (0.97, 0.68, 0.26)

PAGE_ENUM = ["Reverb", "Tone", "Tail"]
GROUPS = ["rev", "tank", "ir", "tone", "tonebass", "freeze", "decay", "irdecay", "lcdsep"]
# algorithms where a parameter does not apply (RP_INACTIVE in src/reverbplus_config.js; the test compares)
INACTIVE_BASS = (0, 4, 5)

VIZ_KEYS = ["algo", "page", "decay", "bassmult", "xover", "damp", "lowcut", "highcut", "loopclip", "looplevel", "freeze", "predelay",
            "modrate", "moddepth", "erlevel", "latelevel", "duck", "duckrel", "output"]

_TAIL = "drawn as a value bar on the display's Tail tab; the display drives the parameter through rpSend (stays automatable)"
OFF_FACE = {
    "modrate": _TAIL,
    "erlevel": _TAIL + " (Hall / Room / Chamber only)",
    "latelevel": _TAIL,
    "output": _TAIL,
    "duck": _TAIL,
    "duckrel": _TAIL,
    "looplevel": _TAIL,
    "loopclip": _TAIL.replace("value bar", "chip row"),
}


def _state():
    page = int(os.environ.get("RC_PAGE", "0") or 0)
    algo = int(os.environ.get("RC_ALGO", "1") or 1)
    return max(0, min(2, page)), max(0, min(5, algo))


def visible_groups(page, algo):
    """Which groups of widgets are visible (mirror of rbVis in src/reverbplus_face_math.js; the test checks the two agree)."""
    return {
        "rev": page == 0,
        "tank": page == 0 and algo != 5,
        "ir": page == 0 and algo == 5,
        "tone": page == 1,
        "tonebass": page == 1 and algo not in INACTIVE_BASS,
        "freeze": algo != 5,
        "decay": algo != 5,
        "irdecay": algo == 5,
        "lcdsep": page != 2,
    }


def layout(h):
    page0, algo0 = _state()
    if algo0 != 1:
        p = h.P["algo"]
        h.P["algo"] = p[:4] + (algo0,) + p[5:]
    h.register("page", "Reverb Page", "Page", 0, 2, page0, ptype=2, unit=9, help_text="Reverb, Tone or Tail tab of the display.",
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
        label(f"obj-lay-lbl-{key}", text, x, LBL_Y, w, group)

    # ---- left column: Pre-Delay | Decay (IR Decay) -----------------------------------------------------------------------
    controls.append(h.dial("predelay", 8.0, 6.0, w=46.0, h=46.0))
    hline("obj-lay-l-sep1", 9.0, 54.0, 44.0, theme=None)
    controls.append(h.dial("input", 8.0, 58.0, w=46.0, h=46.0))
    hline("obj-lay-l-sep2", 9.0, 106.0, 44.0, theme=None)
    controls.append(h.dial("decay", 8.0, 110.0, w=46.0, h=46.0, hidden=hid("decay")))
    groups["decay"].append("obj-ctrl-decay")
    controls.append(h.dial("irdecay", 8.0, 110.0, w=46.0, h=46.0, hidden=hid("irdecay")))
    groups["irdecay"].append("obj-ctrl-irdecay")

    # ---- right column: Width, Freeze | Dry/Wet ----------------------------------------------------------------
    controls.append(h.dial("width", 390.0, 6.0, w=46.0, h=46.0))
    controls.append(h.button("freeze", 391.0, 58.0, 44.0, 15.0, text="Freeze", hidden=hid("freeze")))
    groups["freeze"].append("obj-ctrl-freeze")
    hline("obj-lay-r-sep", 391.0, 90.0, 44.0, theme=None)
    controls.append(h.dial("drywet", 390.0, 100.0, w=46.0, h=46.0))

    # ---- display: tabs, the v8ui, the LCD row ---------------------------------------------------------------------
    controls.append(h.tab("page", 153.0, 6.0, 138.0, 15.0, rows=1))
    hline("obj-lay-lcd-sep", 65.0, 127.0, 316.0, group="lcdsep")

    # Reverb tab: Algorithm | (tank) Size Diffusion Mod Depth   (Convolution) IR box | IR Start Stretch | Reverse
    algo = h.menu("algo", 66.0, VAL_Y, 74.0, CELL_H, hidden=hid("rev"))
    controls.append(algo)
    groups["rev"].append("obj-ctrl-algo")
    label("obj-lay-lbl-algo", "Algorithm", 66.0, LBL_Y, 74.0, "rev")
    vline("obj-lay-sep-a", 144.0, 131.0, 26.0, group="rev")
    lcd("size", "Size", 150.0, 64.0, "tank", CYAN)
    lcd("diffusion", "Diffusion", 218.0, 64.0, "tank", CYAN)
    lcd("moddepth", "Mod Depth", 286.0, 64.0, "tank", CYAN)

    label("obj-lay-lbl-ir", "Convolution IR", 150.0, LBL_Y, 80.0, "ir")
    vline("obj-lay-sep-ir", 234.0, 131.0, 26.0, group="ir")
    lcd("irstart", "Start", 240.0, 44.0, "ir", CYAN)
    lcd("irstretch", "Stretch", 288.0, 44.0, "ir", CYAN)
    controls.append(h.button("irreverse", 336.0, VAL_Y, 44.0, CELL_H, text="Reverse", hidden=hid("ir")))
    groups["ir"].append("obj-ctrl-irreverse")
    label("obj-lay-lbl-irreverse", "Direction", 336.0, LBL_Y, 44.0, "ir")
    # IR name field: drawn by an ignoreclick v8ui, the live.drop (parameter IR File) sits in front of it, transparent
    drop = h.irdrop(150.0, VAL_Y, 52.0, CELL_H, hidden=hid("ir"), ignoreclick=0)
    for k in ("bordercolor", "textcolor"):
        drop["box"][k] = [0.0, 0.0, 0.0, 0.0]
    drop["box"]["legend"] = ""
    controls.append(drop)
    groups["ir"] += ["obj-ctrl-irfile", "obj-lay-irname", "obj-lay-irbtn"]

    # Tone tab: Low Cut High Cut | HF Damp Bass Mult Crossover
    lcd("lowcut", "Low Cut", 66.0, 56.0, "tone", CYAN)
    lcd("highcut", "High Cut", 126.0, 56.0, "tone", CYAN)
    vline("obj-lay-sep-t", 186.0, 131.0, 26.0, group="tone")
    lcd("damp", "HF Damp", 192.0, 56.0, "tone", AMBER)
    lcd("bassmult", "Bass Mult", 252.0, 56.0, "tonebass", AMBER)
    lcd("xover", "Crossover", 312.0, 56.0, "tonebass", AMBER)

    # ---- off the face: the Tail tab draws these (the parameters stay real, automatable live.* objects) ---------------
    for key in OFF_FACE:
        b = h.menu(key, 0.0, 0.0, 40.0, 15.0, hidden=1) if key == "loopclip" else h.numbox(key, 0.0, 0.0, 40.0, 15.0, hidden=1)
        b["box"]["presentation"] = 0
        del b["box"]["presentation_rect"]
        controls.append(b)

    # ---- show / hide wiring ------------------------------------------------------------------------------------------
    outs = len(GROUPS) + 2
    extra.append(h.newobj("obj-lay-route", "route " + " ".join(f"g_{g}" for g in GROUPS) + " viz_tall", 1300.0, 100.0, 420.0, 1, outs,
                          [""] * outs))
    lines = [h.line("obj-lay-viz", 1, "obj-lay-route", 0)]
    for i, g in enumerate(GROUPS):
        pid = f"obj-lay-hide-{g}"
        extra.append(h.newobj(pid, "prepend hidden", 1300.0 + 110.0 * i, 140.0, 100.0))
        lines.append(h.line("obj-lay-route", i, pid, 0))
        lines += [h.line(pid, 0, t, 0) for t in groups[g]]
    # the display grows over the LCD row on the Tail tab (presentation_rect messages to the v8ui, as Delay+'s ring)
    t = len(GROUPS)
    extra += [h.newobj("obj-lay-tall-sel", "sel 0 1", 1300.0, 180.0, 60.0, 1, 3),
              h.msgbox("obj-lay-tall-off", f"presentation_rect {VIZ_X:g} {VIZ_Y:g} {VIZ_W:g} {VIZ_H:g}", 1300.0, 220.0, 200.0),
              h.msgbox("obj-lay-tall-on", f"presentation_rect {VIZ_X:g} {VIZ_Y:g} {VIZ_W:g} {VIZ_H_TALL:g}", 1520.0, 220.0, 200.0)]
    lines += [h.line("obj-lay-route", t, "obj-lay-tall-sel", 0), h.line("obj-lay-tall-sel", 0, "obj-lay-tall-off", 0),
              h.line("obj-lay-tall-sel", 1, "obj-lay-tall-on", 0), h.line("obj-lay-tall-off", 0, "obj-lay-viz", 0),
              h.line("obj-lay-tall-on", 0, "obj-lay-viz", 0)]

    panels = [
        h.panel("obj-lay-left", 4.0, 4.0, 54.0, 161.0),
        h.panel("obj-lay-right", 386.0, 4.0, 54.0, 161.0),
        h.panel("obj-lay-display", DISP[0], DISP[1], DISP[2], DISP[3]),
        h.panel("obj-lay-body", 0.0, 0.0, W, 169.0),
    ]
    viz_h = VIZ_H_TALL if page0 == 2 else VIZ_H
    return {
        "width": W,
        "controls": controls,
        "off_face": {k: v for k, v in OFF_FACE.items()},
        "panels": panels,
        "panel_theme": [["obj-lay-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
                        ["obj-lay-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
                        ["obj-lay-left", "live_surface_bg", [0.2, 0.2, 0.2, 1]],
                        ["obj-lay-right", "live_surface_bg", [0.2, 0.2, 0.2, 1]]],
        "extra_boxes": extra,
        "extra_lines": lines,
        "v8uis": [
            {"id": "obj-lay-viz", "files": ["reverbplus_face_math.js", "reverbplus_face.js"], "rect": [VIZ_X, VIZ_Y, VIZ_W, viz_h],
             "outs": 2, "keys": VIZ_KEYS},
            # IR name field (draws under the transparent live.drop) and the browse / clear buttons next to it
            {"id": "obj-lay-irname", "files": ["reverbplus_face_ir.js"], "rect": [150.0, VAL_Y, 52.0, CELL_H], "outs": 1,
             "keys": [], "ignoreclick": True, "hidden": not vis0["ir"], "preamble": "var RBI_MODE = \"name\";"},
            {"id": "obj-lay-irbtn", "files": ["reverbplus_face_ir.js"], "rect": [204.0, VAL_Y, 26.0, CELL_H], "outs": 1,
             "keys": [], "hidden": not vis0["ir"], "preamble": "var RBI_MODE = \"btn\";"},
        ],
    }
