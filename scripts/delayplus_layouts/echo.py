"""Echo layout (478 x 169): a copy of Ableton Live's Echo device face, with Echo's tunnel replaced
by the tape-loop ring. Controls use Live's theme colours (no colour attributes), like Echo.

  left column   Left / Right time (Time or note value, swapped by each side's Sync button), the
                Stereo Link icon between them, Sync, Sync Mode menu and Offset per side, then Input with the
                D (clip) and Ø (invert) buttons, and Feedback
  centre        [Echo | Modulation | Character] tabs over the display area:
                  Echo        ring display (obj-viz); the triangle shows / hides the Filter Display
                              (obj-filtdisp, its own panel under a shrunken ring); bottom row: Filter
                              on, HP, Res, LP, Res
                  Modulation  LFO display with the waveform icons (obj-lfodisp), then Sync / Rate /
                              Phase, x4 and Mod Delay, Mod Filter, Env Mix
                  Character   Gate, Ducking, Noise and Wobble sections (2 x 2), Repitch
  right column  Freeze and Debug (where Echo has its reverb), Stereo, Output, the Stereo /
                Ping Pong / Mid/Side stack and Dry/Wet

Show / hide: `pak page filterDisplay modSync` -> one `expr` per widget group -> `prepend hidden`,
and the ring's presentation_rect (full display, or the top part when the Filter Display shows). The
page is a hidden UI-state parameter (`Delay+ Page`); every input of the `pak` is a stored
parameter, so the state is re-applied when the device loads.
"""

PAGES = ["Echo", "Modulation", "Character"]
# Geometry measured from Echo next to Delay+ in Live 12 (same scale): left column 0..109, display
# 111..371, right column 377..478; dial tops at y 10 (top row) / 64 (Output) / 118 (bottom row).
W = 478.0
X0, CW = 111.0, 260.0           # display (centre column)
DISP_Y, DISP_H = 11.0, 154.0    # display panel (to y 165), the filter bar sits inside its bottom edge
RING_FULL = [X0, DISP_Y, CW, 138.0]
RING_SMALL = [X0, DISP_Y, CW, 71.0]
FILT_RECT = [X0, 82.0, CW, 67.0]
LFO_RECT = [X0, DISP_Y, CW, 86.0]
ROW_Y = 150.0                   # filter bar (inside the display)
DISPLAY_BLACK = (0.075, 0.075, 0.075)
VALUE_BLUE = (0.36, 0.78, 0.96)  # Echo's value text in the display


def layout(h):
    dial, menu, button, numbox, tab, label = h.dial, h.menu, h.button, h.numbox, h.tab, h.label
    controls = []
    labels = []

    # ---- left column -----------------------------------------------------------------------
    # Each side's dial is two parameters (Time / Division) in one rect, so the "Left" / "Right" label
    # is a comment and the dials hide their own (unique) parameter names.
    for side, x, name in (("l", 2.0, "Left"), ("r", 61.0, "Right")):
        labels.append(label(f"obj-echo-lbl-{side}", name, x, 2.0, 44.0, 13.0, align=1))
        tdial, ddial = dial(f"time_{side}", x, 14.0, hidden=1, h=38.0), dial(f"div_{side}", x, 14.0, h=38.0)
        for b in (tdial, ddial):
            b["box"]["showname"] = 0
        controls += [
            tdial,
            ddial,
            button(f"sync_{side}", x + 1.0, 61.0, 43.0, 11.0, text="Time", texton="Sync"),
            menu(f"mode_{side}", x + 1.0, 75.0, 43.0, 11.0),
            numbox(f"offs_{side}", x + 1.0, 90.0, 43.0, 11.0, appearance=0),
        ]
    controls += [
        button("link", 780.0, 160.0, 30.0, 15.0, text="Link"),
        dial("inputdb", 2.0, 118.0),
        button("clipdry", 48.0, 121.0, 12.0, 12.0, text="D"),
        button("inv", 48.0, 136.0, 12.0, 12.0, text="Ø"),
        dial("fb", 61.0, 118.0),
    ]

    # ---- right column ----------------------------------------------------------------------
    controls += [
        button("freeze", 378.0, 14.0, 48.0, 13.0, text="Freeze"),
        button("debug", 378.0, 30.0, 48.0, 11.0, text="Debug"),
        dial("width", 430.0, 2.0),
        dial("outdb", 430.0, 64.0),
        tab("chmode", 377.0, 119.0, 49.0, 43.0, rows=3),
        dial("wet", 430.0, 121.0),
    ]

    # ---- Echo page: bottom row ---------------------------------------------------------------
    row = [
        button("filton", X0 + 17.0, ROW_Y + 1.5, 9.0, 9.0),
    ]
    # Echo's filter bar (inside the display): grey labels, blue values
    grey = (0.62, 0.62, 0.62)
    row_labels = [("Filter", 29.0, 26.0), ("HP", 53.0, 16.0), ("Res", 115.0, 20.0),
                  ("LP", 159.0, 14.0), ("Res", 216.0, 20.0)]
    for i, (text, dx, w) in enumerate(row_labels):
        labels.append(label(f"obj-echo-lbl-row{i}", text, X0 + dx, ROW_Y, w, 12.0, color=grey))
    row += [
        numbox("hp", X0 + 69.0, ROW_Y, 44.0, 12.0, color=VALUE_BLUE, appearance=4),
        numbox("hpres", X0 + 135.0, ROW_Y, 22.0, 12.0, color=VALUE_BLUE, appearance=4),
        numbox("lp", X0 + 173.0, ROW_Y, 44.0, 12.0, color=VALUE_BLUE, appearance=4),
        numbox("lpres", X0 + 236.0, ROW_Y, 22.0, 12.0, color=VALUE_BLUE, appearance=4),
    ]
    controls += row
    # Filter Display and Stereo Link toggles are drawn as icons (obj-icon-*, a v8ui each) that drive
    # these live.text parameters, which stay out of the presentation (Live's font has no such glyphs).
    disp = button("filtdisp", 780.0, 180.0, 30.0, 15.0, text="Display")
    for b in (disp, next(c for c in controls if c["box"]["id"] == "obj-ctrl-link")):
        b["box"]["presentation"] = 0
    controls.append(disp)
    echo_ids = [b["box"]["id"] for b in row] + [f"obj-echo-lbl-row{i}" for i in range(len(row_labels))]
    echo_ids += ["obj-viz", "obj-icon-filtdisp"]

    # ---- Modulation page ---------------------------------------------------------------------
    my = 104.0
    mod = [
        button("lfosync", X0 + 4.0, my + 1.0, 10.0, 10.0),
        numbox("lfohz", X0 + 32.0, my + 15.0, 40.0, 13.0, color=VALUE_BLUE, appearance=4),
        numbox("lfodiv", X0 + 32.0, my + 15.0, 40.0, 13.0, color=VALUE_BLUE, appearance=4),
        numbox("phase", X0 + 32.0, my + 30.0, 40.0, 13.0, color=VALUE_BLUE, appearance=4),
        button("x4", X0 + 84.0, my, 18.0, 12.0, text="x4"),
        numbox("moddelay", X0 + 84.0, my + 15.0, 44.0, 13.0, color=VALUE_BLUE, appearance=4),
        numbox("modfilt", X0 + 136.0, my + 15.0, 44.0, 13.0, color=VALUE_BLUE, appearance=4),
        numbox("envmix", X0 + 192.0, my + 15.0, 46.0, 13.0, color=VALUE_BLUE, appearance=4),
    ]
    # The waveform is chosen with the icons in the LFO display; its parameter object is not shown.
    shape = menu("lfoshape", 780.0, 120.0, 70.0, 15.0)
    shape["box"]["presentation"] = 0
    controls.append(shape)
    for b in mod:
        b["box"]["hidden"] = 1
    mod_labels = [("Sync", 16.0, my - 1.0, 30.0), ("Rate", 4.0, my + 15.0, 28.0), ("Phase", 4.0, my + 30.0, 28.0),
                  ("Mod", 106.0, my - 1.0, 26.0), ("Delay", 84.0, my + 30.0, 44.0), ("Mod", 136.0, my - 1.0, 44.0),
                  ("Filter", 136.0, my + 30.0, 44.0), ("Env", 192.0, my - 1.0, 46.0), ("Mix", 192.0, my + 30.0, 46.0)]
    for i, (text, dx, y, w) in enumerate(mod_labels):
        labels.append(label(f"obj-echo-lbl-mod{i}", text, X0 + dx, y, w, 13.0, hidden=1))
    controls += mod
    mod_ids = [b["box"]["id"] for b in mod if b["box"]["id"] not in ("obj-ctrl-lfohz", "obj-ctrl-lfodiv")]
    mod_ids += [f"obj-echo-lbl-mod{i}" for i in range(len(mod_labels))] + ["obj-lfodisp", "obj-panel-mod-sep"]

    # ---- Character page: 2 x 2 sections + Repitch ---------------------------------------------
    char_ids = []
    cells = [("gate", "Gate", "gatethr", "Threshold", "gaterel", "Release"),
             ("duck", "Ducking", "duckthr", "Threshold", "duckrel", "Release"),
             ("noise", "Noise", "noiseamt", "Amount", "noisemorph", "Morph"),
             ("wob", "Wobble", "wobamt", "Amount", "wobmorph", "Morph")]
    onkeys = {"gate": "gateon", "duck": "duckon", "noise": "noiseon", "wob": "wobon"}
    for i, (sec, title, k1, l1, k2, l2) in enumerate(cells):
        cx = X0 + (i % 2) * (CW / 2.0)
        cy = DISP_Y + 2.0 + (i // 2) * 67.0
        sw = [button(onkeys[sec], cx + 8.0, cy + 7.0, 10.0, 10.0),
              numbox(k1, cx + 12.0, cy + 42.0, 50.0, 13.0, color=(0.8, 0.8, 0.8), appearance=4),
              numbox(k2, cx + 64.0, cy + 42.0, 50.0, 13.0, color=(0.8, 0.8, 0.8), appearance=4)]
        for b in sw:
            b["box"]["hidden"] = 1
        controls += sw
        char_ids += [b["box"]["id"] for b in sw]
        for j, (text, dx, dy, w) in enumerate([(title, 22.0, 5.0, 90.0), (l1, 12.0, 28.0, 50.0), (l2, 64.0, 28.0, 50.0)]):
            lid = f"obj-echo-lbl-{sec}{j}"
            labels.append(label(lid, text, cx + dx, cy + dy, w, 13.0, hidden=1))
            char_ids.append(lid)
    rep = button("repitch", X0 + 8.0, ROW_Y + 1.5, 10.0, 10.0)
    rep["box"]["hidden"] = 1
    controls.append(rep)
    labels.append(label("obj-echo-lbl-repitch", "Repitch", X0 + 22.0, ROW_Y, 60.0, 13.0, hidden=1))
    char_ids += ["obj-ctrl-repitch", "obj-echo-lbl-repitch", "obj-panel-char-v", "obj-panel-char-h"]

    # ---- page tab (hidden UI-state parameter) ------------------------------------------------
    page_tab = {"box": {
        "annotation": "Echo, Modulation or Character controls in the centre.", "annotation_name": "Delay+ Page",
        "fontsize": 9.5, "id": "obj-echo-page", "maxclass": "live.tab", "num_lines_patching": 1,
        # Echo's tabs: flat grey, the selected one darker (not the accent colour)
        # the selected tab is the display's black and touches the display, so it reads as one shape
        "bgcolor": [0.29, 0.30, 0.32, 1.0], "activebgcolor": [0.29, 0.30, 0.32, 1.0],
        "bgoncolor": [*DISPLAY_BLACK, 1.0], "activebgoncolor": [*DISPLAY_BLACK, 1.0],
        "textcolor": [0.86, 0.86, 0.86, 1.0], "activetextcolor": [0.86, 0.86, 0.86, 1.0],
        "textoncolor": [0.96, 0.96, 0.96, 1.0], "activetextoncolor": [0.96, 0.96, 0.96, 1.0],
        "bordercolor": [0.0, 0.0, 0.0, 0.0], "focusbordercolor": [0.0, 0.0, 0.0, 0.0],
        "spacing_x": 2.0,
        "num_lines_presentation": 1, "numinlets": 1, "numoutlets": 3, "outlettype": ["", "", "float"],
        "parameter_enable": 1, "patching_rect": [780.0, 300.0, 190.0, 14.0], "presentation": 1,
        "presentation_rect": [X0 + 51.0, 0.0, 162.0, DISP_Y],
        "saved_attribute_attributes": {"valueof": {
            "parameter_annotation_name": "Delay+ Page", "parameter_info": "UI only: which page the centre shows.",
            "parameter_enum": PAGES, "parameter_initial": [0], "parameter_initial_enable": 1,
            "parameter_invisible": 1, "parameter_linknames": 1, "parameter_longname": "Delay+ Page",
            "parameter_mmax": len(PAGES) - 1, "parameter_shortname": "Page", "parameter_type": 2,
        }},
        "varname": "Delay+ Page",
    }}

    # ---- show / hide logic ---------------------------------------------------------------------
    nb = h.newobj
    extra_boxes = [page_tab, *labels,
                   nb("obj-echo-pak", "pak 0 1 1", 960, 300, 80, 3, 1),
                   nb("obj-echo-mirror", "route mirror", 960, 480, 80, 2, 2),
                   nb("obj-echo-route-filter", "route hp hpres lp lpres", 1100, 480, 140, 5, 5),
                   nb("obj-echo-route-lfo", "route lfoshape", 1260, 480, 90, 2, 2)]
    extra_lines = [
        h.line("obj-echo-page", 0, "obj-echo-pak", 0),
        h.line("obj-ctrl-filtdisp", 0, "obj-echo-pak", 1),
        h.line("obj-ctrl-lfosync", 0, "obj-echo-pak", 2),
        h.line("obj-thisdevice", 0, "obj-echo-pak", 0),  # bang: re-apply on load
        # Filter Display drags -> the filter parameters; LFO icons -> waveform parameter
        h.line("obj-filtdisp", 0, "obj-echo-route-filter", 0),
        h.line("obj-echo-route-filter", 0, "obj-ctrl-hp", 0),
        h.line("obj-echo-route-filter", 1, "obj-ctrl-hpres", 0),
        h.line("obj-echo-route-filter", 2, "obj-ctrl-lp", 0),
        h.line("obj-echo-route-filter", 3, "obj-ctrl-lpres", 0),
        h.line("obj-lfodisp", 0, "obj-echo-route-lfo", 0),
        h.line("obj-icon-filtdisp", 0, "obj-ctrl-filtdisp", 0),
        h.line("obj-icon-link", 0, "obj-ctrl-link", 0),
        h.line("obj-echo-route-lfo", 0, "obj-ctrl-lfoshape", 0),
        # Stereo Link: `mirror <key> <value>` from the face -> `set` on the other side's control
        h.line("obj-viz", 1, "obj-echo-mirror", 0),
    ]
    linked = [f"{k}_{s}" for k in ("sync", "time", "div", "mode") for s in ("l", "r")]
    extra_boxes.append(nb("obj-echo-mirror-route", "route " + " ".join(linked), 960, 510, 400, 1, len(linked) + 1))
    extra_lines.append(h.line("obj-echo-mirror", 0, "obj-echo-mirror-route", 0))
    for i, k in enumerate(linked):
        sid = f"obj-echo-set-{k}"
        extra_boxes.append(nb(sid, "prepend set", 960 + i * 60, 540, 70))
        extra_lines += [h.line("obj-echo-mirror-route", i, sid, 0), h.line(sid, 0, f"obj-ctrl-{k}", 0)]

    # groups: (expr over page $i1, filter display $i2, mod sync $i3) -> hidden flag -> widgets
    groups = [
        ("echo", "$i1 != 0", echo_ids),
        ("filt", "($i1 != 0) || ($i2 == 0)", ["obj-filtdisp"]),
        ("mod", "$i1 != 1", mod_ids),
        ("hz", "($i1 != 1) || ($i3 != 0)", ["obj-ctrl-lfohz"]),
        ("div", "($i1 != 1) || ($i3 == 0)", ["obj-ctrl-lfodiv"]),
        ("char", "$i1 != 2", char_ids),
    ]
    for g, (name, ex, ids) in enumerate(groups):
        e, p = f"obj-echo-x-{name}", f"obj-echo-hide-{name}"
        extra_boxes += [nb(e, f"expr {ex}", 960 + g * 110, 340, 100, 1, 1), nb(p, "prepend hidden", 960 + g * 110, 370, 90)]
        extra_lines += [h.line("obj-echo-pak", 0, e, 0), h.line(e, 0, p, 0)] + [h.line(p, 0, i, 0) for i in ids]
    # ring size: full display, or the top part above the Filter Display
    extra_boxes += [nb("obj-echo-x-ring", "expr $i2", 960, 400, 60, 1, 1),
                    nb("obj-echo-sel-ring", "sel 0 1", 960, 430, 60, 1, 3),
                    h.msgbox("obj-echo-ring-full", "presentation_rect " + " ".join(f"{v:g}" for v in RING_FULL), 960, 460, 220),
                    h.msgbox("obj-echo-ring-small", "presentation_rect " + " ".join(f"{v:g}" for v in RING_SMALL), 1190, 460, 220)]
    extra_lines += [h.line("obj-echo-pak", 0, "obj-echo-x-ring", 0), h.line("obj-echo-x-ring", 0, "obj-echo-sel-ring", 0),
                    h.line("obj-echo-sel-ring", 0, "obj-echo-ring-full", 0), h.line("obj-echo-sel-ring", 1, "obj-echo-ring-small", 0),
                    h.line("obj-echo-ring-full", 0, "obj-viz", 0), h.line("obj-echo-ring-small", 0, "obj-viz", 0)]

    section = (0.235, 0.24, 0.25)  # Echo's slightly lighter backgrounds behind the side controls
    panels = [
        # Echo's darker body between its sections (Live's Desktop colour), under everything else
        h.panel("obj-panel-body", 0.0, 0.0, W, 169.0, bg=(0.165, 0.165, 0.165), border=(0.165, 0.165, 0.165)),
        h.panel("obj-panel-left", 1.0, 1.0, 108.0, 167.0, bg=section, border=section),
        h.panel("obj-panel-right", 373.0, 1.0, 104.0, 167.0, bg=section, border=section),
        h.panel("obj-panel-display", X0, DISP_Y, CW, DISP_H, bg=DISPLAY_BLACK, border=DISPLAY_BLACK),
        h.panel("obj-panel-divider", 53.5, 38.0, 1.0, 64.0, bg=(0.3, 0.3, 0.3), border=(0.3, 0.3, 0.3)),
        h.panel("obj-panel-mod-sep", X0 + 186.0, my, 1.0, 44.0, bg=(0.3, 0.3, 0.3), border=(0.3, 0.3, 0.3)),
        h.panel("obj-panel-char-v", X0 + CW / 2.0, DISP_Y + 4.0, 1.0, 130.0, bg=(0.3, 0.3, 0.3), border=(0.3, 0.3, 0.3)),
        h.panel("obj-panel-char-h", X0 + 4.0, DISP_Y + 68.0, CW - 8.0, 1.0, bg=(0.3, 0.3, 0.3), border=(0.3, 0.3, 0.3)),
    ]
    for pnl in panels:
        pnl["box"]["varname"] = pnl["box"]["id"]
        pnl["box"]["rounded"] = 4 if pnl["box"]["id"] in ("obj-panel-left", "obj-panel-right") else 0
    for pid in ("obj-panel-mod-sep", "obj-panel-char-v", "obj-panel-char-h"):
        next(p for p in panels if p["box"]["id"] == pid)["box"]["hidden"] = 1

    # ---- Live theme colours (follow Live's theme and hue, like Echo) ---------------------------
    th = h.theme
    # Panels: coloured by the face script from max.getcolor (dpApplyPanelTheme in delayplus_ui.js),
    # on load and on theme changes. Attribute bindings on panels did not repaint them in Live.
    in_display = set(echo_ids) | set(mod_ids) | set(char_ids) | {"obj-ctrl-lfohz", "obj-ctrl-lfodiv"}
    for b in controls:
        bx = b["box"]
        if bx["id"] in in_display and bx["maxclass"] == "live.numbox":
            th(b, textcolor="live_lcd_control_fg")
    for b in labels:
        if b["box"]["id"] in in_display:
            th(b, textcolor="live_lcd_title")
    th(page_tab, bgcolor="live_surface_bg", activebgcolor="live_surface_bg", bgoncolor="live_lcd_bg",
       activebgoncolor="live_lcd_bg", textcolor="live_control_fg", activetextcolor="live_control_fg",
       textoncolor="live_lcd_title", activetextoncolor="live_lcd_title")

    return {
        "width": W,
        "viz_rect": list(RING_SMALL),
        "controls": controls,
        "panels": panels,
        "extra_boxes": extra_boxes,
        "extra_lines": extra_lines,
        "v8uis": [
            {"id": "obj-icon-filtdisp", "file": "delayplus_icon.js", "rect": [X0 + 5.0, ROW_Y + 1.0, 10.0, 10.0],
             "outs": 1, "keys": ["filtdisp"], "icon": "tri"},
            {"id": "obj-icon-link", "file": "delayplus_icon.js", "rect": [46.0, 23.0, 16.0, 10.0],
             "outs": 1, "keys": ["link"], "icon": "link"},
            {"id": "obj-filtdisp", "file": "delayplus_filter.js", "rect": FILT_RECT, "outs": 1,
             "keys": ["hp", "lp", "hpres", "lpres", "filton", "modfilt"]},
            {"id": "obj-lfodisp", "file": "delayplus_lfo.js", "rect": LFO_RECT, "outs": 1, "hidden": 1, "names": True,
             "keys": ["lfoshape", "phase", "moddelay", "modfilt", "envmix", "x4", "lfosync", "lfohz", "lfodiv"]},
        ],
    }
