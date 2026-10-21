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
  right column  Freeze (where Echo has its reverb), Stereo, Output, the Stereo /
                Ping Pong / Mid/Side stack and Dry/Wet

Show / hide: `pak page filterDisplay modSync` -> one `expr` per widget group -> `prepend hidden`,
and the ring's presentation_rect (full display, or the top part when the Filter Display shows). The
page is a hidden UI-state parameter (`Delay+ Page`); every input of the `pak` is a stored
parameter, so the state is re-applied when the device loads.
"""

# The Character page (Gate, Ducking, Noise, Wobble, Repitch) is off the face for now: its parameters
# stay in the device (automatable, DSP unchanged, all off by default) but have no widgets on show.
SHOW_CHARACTER = False
DIFF_DIAL_Y = 30.0       # Diffusion dial in the right column, under Freeze
DIFF_DIAL_Y_MIDI = 68.0  # ... and under the MIDI From menus while a side is in MIDI mode

# Stereo Link mirrors these per-side settings (DP_LINKED in src/delayplus_ui.js).
LINKED_KEYS = ("tmode", "time", "div", "mode", "note", "cents", "fluid")
# Per side: widget (formatted with the side) -> the Time Modes (DP_TM) in which it shows.
TMODE_SHOW = [("obj-ctrl-time_{s}", (0,)), ("obj-ctrl-div_{s}", (1, 3)), ("obj-ctrl-note_{s}", (2,)),
              ("obj-notedial-{s}", (4,)), ("obj-ctrl-mode_{s}", (1,)), ("obj-ctrl-fluid_{s}", (3,)),
              ("obj-ctrl-cents_{s}", (2, 4))]
PAGES = ["Echo", "Modulation", "Options"] + (["Character"] if SHOW_CHARACTER else [])
OPT_PAGE = PAGES.index("Options")
# Geometry measured from Echo next to Delay+ in Live 12 (same scale): left column 0..109, display
# 111..371, right column 377..478; dial tops at y 10 (top row) / 64 (Output) / 118 (bottom row).
W = 478.0
X0, CW = 111.0, 260.0           # display (centre column)
DISP_TOP = 1.0                  # the black display runs from the top (behind the page tabs) ...
DISP_Y = 16.0                   # ... and its content starts under the tabs
TAB_H = 14.0
TAB_SPACING = 12.0              # gap between the tab labels
TAB_W = 64.0 * len(PAGES) + TAB_SPACING * (len(PAGES) - 1)
TAB_X = X0 + (CW - TAB_W) / 2.0
TAB_TEXT_DIM = (0.55, 0.55, 0.56)   # unselected label
TAB_TEXT_ON = (0.96, 0.96, 0.96)    # selected label
ROW_Y = 152.0                   # filter bar (inside the display)
FILT_Y = 84.0
RING_FULL = [X0, DISP_Y, CW, ROW_Y - DISP_Y - 1.0]
RING_SMALL = [X0, DISP_Y, CW, FILT_Y - 2.0 - DISP_Y]
FILT_RECT = [X0, FILT_Y, CW, ROW_Y - 3.0 - FILT_Y]
# Echo's divider lines (Filter Display open): ring | filter curve, filter curve | filter bar. Each sits
# in the 2 px gap between those rects, so it never covers a v8ui.
FILT_LINES = [[X0, FILT_Y - 2.0, CW, 2.0], [X0, ROW_Y - 3.0, CW, 2.0]]
LFO_RECT = [X0, DISP_Y, CW, 86.0]
DISPLAY_BLACK = (0.075, 0.075, 0.075)
VALUE_BLUE = (0.36, 0.78, 0.96)  # Echo's value text in the display


def layout(h):
    dial, menu, button, numbox, tab, label = h.dial, h.menu, h.button, h.numbox, h.tab, h.label
    controls = []
    labels = []

    # ---- left column -----------------------------------------------------------------------
    # Each side's dial is two parameters (Time / Division) in one rect, so the "Left" / "Right" label
    # is a comment and the dials hide their own (unique) parameter names.
    # Buttons are sized like Echo's as drawn in Live (Live insets live.* boxes by about 1.5 px).
    # Per side: the Time Mode menu (Time / Sync / Pitch / Fluid / MIDI) where Echo has its Sync
    # button. The dial above it and the row under it change with the mode (TMODE_SHOW below):
    #   dial  Time: ms   Sync, Fluid: note value   Pitch: note   MIDI: the last MIDI note (a
    #         display-only v8ui, obj-notedial-<side>, drawn like a disabled dial)
    #   row   Sync: Notes / Triplet / Dotted   Fluid: multiplier   Pitch, MIDI: fine tune (cents)
    for side, x, name in (("l", 4.0, "Left"), ("r", 57.0, "Right")):
        labels.append(label(f"obj-echo-lbl-{side}", name, x, 2.0, 48.0, 13.0, align=1))
        # 40 px wide (centred as before) so the Stereo Link icon between them never covers a dial
        dials = [dial(f"time_{side}", x + 4.0, 14.0, hidden=1, w=40.0, h=38.0),
                 dial(f"div_{side}", x + 4.0, 14.0, w=40.0, h=38.0),
                 dial(f"note_{side}", x + 4.0, 14.0, hidden=1, w=40.0, h=38.0)]
        for b in dials:
            b["box"]["showname"] = 0
        controls += dials + [
            menu(f"tmode_{side}", x, 59.0, 48.0, 13.0),
            menu(f"mode_{side}", x, 75.0, 48.0, 13.0),
            numbox(f"fluid_{side}", x, 75.0, 48.0, 13.0, appearance=0, hidden=1),
            numbox(f"cents_{side}", x, 75.0, 48.0, 13.0, appearance=0, hidden=1),
            numbox(f"offs_{side}", x, 91.0, 48.0, 13.0, appearance=0),
        ]
    controls += [
        button("link", 780.0, 160.0, 30.0, 15.0, text="Link"),
        dial("inputdb", 1.0, 118.0),
        button("clipdry", 46.5, 124.0, 16.0, 13.0, text="D"),
        button("inv", 46.5, 140.0, 16.0, 13.0, text="Ø"),
        dial("fb", 64.0, 118.0),
    ]

    # ---- right column ----------------------------------------------------------------------
    controls += [
        button("freeze", 375.0, 12.0, 54.0, 13.0, text="Freeze"),
        # Diffusion (where Echo has its Reverb): the dial and its Size bar. While a side is in MIDI
        # mode the MIDI From menus take the top of this slot, so the dial moves down under them
        # and the Size bar hides (obj-midi-x below).
        dial("diffuse", 382.0, DIFF_DIAL_Y, w=40.0),
        numbox("dsize", 375.0, 82.0, 54.0, 13.0),
        dial("width", 431.0, 2.0),
        dial("outdb", 431.0, 64.0),
        tab("chmode", 375.0, 116.0, 54.0, 48.0, rows=3),
        dial("wet", 431.0, 121.0),
    ]

    # ---- Echo page: bottom row ---------------------------------------------------------------
    row = [
        button("filton", X0 + 20.0, ROW_Y + 1.5, 9.0, 9.0),
    ]
    # Echo's filter bar (inside the display): grey labels, blue values. live.numbox centres its text,
    # so each value box is just wider than its text and starts right after its label.
    grey = (0.62, 0.62, 0.62)
    row_labels = [("Filter HP", 31.0, 42.0), ("Res", 114.0, 20.0), ("LP", 160.0, 14.0), ("Res", 214.0, 20.0)]
    for i, (text, dx, w) in enumerate(row_labels):
        labels.append(label(f"obj-echo-lbl-row{i}", text, X0 + dx, ROW_Y - 2.0, w, 12.0, color=grey))
    row += [
        numbox("hp", X0 + 70.0, ROW_Y, 40.0, 12.0, color=VALUE_BLUE, appearance=4),
        numbox("hpres", X0 + 132.0, ROW_Y, 24.0, 12.0, color=VALUE_BLUE, appearance=4),
        numbox("lp", X0 + 172.0, ROW_Y, 42.0, 12.0, color=VALUE_BLUE, appearance=4),
        numbox("lpres", X0 + 232.0, ROW_Y, 24.0, 12.0, color=VALUE_BLUE, appearance=4),
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
    my = 106.0
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

    # ---- Options page: feedback clip ----------------------------------------------------------
    # Clip Mode (Soft / Hard / Limit) and Clip Level on the left, the clip's transfer curve
    # (obj-clipcurve, display only) on the right, Ducking and Repitch under it (see below).
    oy = DISP_Y + 8.0
    # Spectrum: which signals the Filter Display's spectrogram shows (both by default).
    opt = [tab("clipmode", X0 + 12.0, oy + 16.0, 120.0, 15.0, hidden=1),
           numbox("cliplevel", X0 + 12.0, oy + 54.0, 60.0, 14.0, color=VALUE_BLUE, appearance=4, hidden=1),
           button("specdry", X0 + 12.0, oy + 98.0, 40.0, 14.0, text="Dry", hidden=1),
           button("specwet", X0 + 56.0, oy + 98.0, 40.0, 14.0, text="Wet", hidden=1),
           button("showlat", X0 + 12.0, oy + 122.0, 84.0, 14.0, text="Link Latency", hidden=1)]
    controls += opt
    opt_labels = [("Feedback Clip", oy, 120.0), ("Level", oy + 40.0, 60.0), ("Spectrum", oy + 82.0, 90.0)]
    for i, (text, y, w) in enumerate(opt_labels):
        labels.append(label(f"obj-echo-lbl-opt{i}", text, X0 + 12.0, y, w, 13.0, hidden=1))
    opt_ids = [b["box"]["id"] for b in opt] + [f"obj-echo-lbl-opt{i}" for i in range(len(opt_labels))] + ["obj-clipcurve"]

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
            if not SHOW_CHARACTER:
                b["box"]["presentation"] = 0
        controls += sw
        char_ids += [b["box"]["id"] for b in sw]
        for j, (text, dx, dy, w) in enumerate([(title, 22.0, 5.0, 90.0), (l1, 12.0, 28.0, 50.0), (l2, 64.0, 28.0, 50.0)]):
            lid = f"obj-echo-lbl-{sec}{j}"
            if SHOW_CHARACTER:
                labels.append(label(lid, text, cx + dx, cy + dy, w, 13.0, hidden=1))
                char_ids.append(lid)
    rep = button("repitch", X0 + 8.0, ROW_Y + 1.5, 10.0, 10.0)
    rep["box"]["hidden"] = 1
    controls.append(rep)
    if SHOW_CHARACTER:
        labels.append(label("obj-echo-lbl-repitch", "Repitch", X0 + 22.0, ROW_Y, 60.0, 13.0, hidden=1))
        char_ids += ["obj-ctrl-repitch", "obj-echo-lbl-repitch", "obj-panel-char-v", "obj-panel-char-h"]
    else:
        rep["box"]["presentation"] = 0
        char_ids = []
        # With the Character page off, Ducking and Repitch live on the Options page (right column,
        # under the clip curve): Ducking on/off, its Threshold and Release, then Repitch.
        byid = {c["box"]["id"]: c["box"] for c in controls}
        ox = X0 + 150.0
        for cid, rect, text in (("obj-ctrl-duckon", [ox, oy + 78.0, 60.0, 14.0], "Ducking"),
                                ("obj-ctrl-duckthr", [ox, oy + 109.0, 48.0, 13.0], None),
                                ("obj-ctrl-duckrel", [ox + 52.0, oy + 109.0, 48.0, 13.0], None),
                                ("obj-ctrl-repitch", [ox, oy + 128.0, 60.0, 14.0], "Repitch")):
            b = byid[cid]
            b["presentation"] = 1
            b["presentation_rect"] = rect
            b["hidden"] = 1
            if text:
                b["text"] = b["texton"] = text
            opt_ids.append(cid)
        for i, (text, x) in enumerate((("Threshold", ox), ("Release", ox + 52.0))):
            lid = f"obj-echo-lbl-optduck{i}"
            labels.append(label(lid, text, x, oy + 95.0, 48.0, 13.0, hidden=1))
            opt_ids.append(lid)

    # ---- Echo's accent lines ----------------------------------------------------------------
    # Down the middle of the Left / Right controls (broken by the link icon), and from Input to D and
    # from Ø to Feedback. live.line draws a hairline in Live's frame colour (live_surface_frame by
    # default, so it follows the theme); a 1 px panel drew 3 px thick.
    for i, (x, y, w, hh) in enumerate([(52.5, 3.0, 5.0, 19.0), (52.5, 36.0, 5.0, 68.0),
                                       (38.0, 128.0, 8.5, 5.0), (62.5, 144.0, 9.0, 5.0)]):
        labels.append({"box": {"id": f"obj-echo-line{i}", "maxclass": "live.line", "justification": 1,
                               "numinlets": 1, "numoutlets": 0, "patching_rect": [600.0 + x, 700.0 + y, w, hh],
                               "presentation": 1, "presentation_rect": [x, y, w, hh]}})

    for i, r in enumerate(FILT_LINES):
        fl = {"box": {"id": f"obj-echo-filtline{i}", "maxclass": "live.line", "justification": 1, "hidden": 1,
                      "numinlets": 1, "numoutlets": 0, "patching_rect": [600.0 + r[0], 760.0 + r[1], r[2], r[3]],
                      "presentation": 1, "presentation_rect": list(r)}}
        h.theme(fl, linecolor="live_lcd_frame")  # the display's own frame colour, as in Echo
        labels.append(fl)

    # ---- page tab (hidden UI-state parameter) ------------------------------------------------
    page_tab = {"box": {
        "annotation": "Echo, Modulation or Character controls in the centre.", "annotation_name": "Delay+ Page",
        "fontsize": 10.0, "id": "obj-echo-page", "maxclass": "live.tab", "num_lines_patching": 1,
        # Text-only tabs on the display's black: the unselected label is dim, the selected one is
        # bright with an accent underline (obj-echo-tab-ul*). Fixed text colours, because some
        # themes' display colours are too close to the black.
        "bgcolor": [*DISPLAY_BLACK, 1.0], "activebgcolor": [*DISPLAY_BLACK, 1.0],
        "bgoncolor": [*DISPLAY_BLACK, 1.0], "activebgoncolor": [*DISPLAY_BLACK, 1.0],
        "textcolor": [*TAB_TEXT_DIM, 1.0], "activetextcolor": [*TAB_TEXT_DIM, 1.0],
        "textoncolor": [*TAB_TEXT_ON, 1.0], "activetextoncolor": [*TAB_TEXT_ON, 1.0],
        "bordercolor": [0.0, 0.0, 0.0, 0.0], "focusbordercolor": [0.0, 0.0, 0.0, 0.0],
        "spacing_x": TAB_SPACING,
        "num_lines_presentation": 1, "numinlets": 1, "numoutlets": 3, "outlettype": ["", "", "float"],
        "parameter_enable": 1, "patching_rect": [780.0, 300.0, 190.0, 14.0], "presentation": 1,
        "presentation_rect": [TAB_X, DISP_TOP + 1.0, TAB_W, TAB_H],
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
    linked = [f"{k}_{s}" for k in LINKED_KEYS for s in ("l", "r")]
    extra_boxes.append(nb("obj-echo-mirror-route", "route " + " ".join(linked), 960, 510, 400, 1, len(linked) + 1))
    extra_lines.append(h.line("obj-echo-mirror", 0, "obj-echo-mirror-route", 0))
    for i, k in enumerate(linked):
        sid = f"obj-echo-set-{k}"
        extra_boxes.append(nb(sid, "prepend set", 960 + i * 60, 540, 70))
        extra_lines += [h.line("obj-echo-mirror-route", i, sid, 0), h.line(sid, 0, f"obj-ctrl-{k}", 0)]
        if k.startswith("tmode_"):
            # `set` does not output, so the mirrored side's widget swap is driven here too
            extra_lines.append(h.line("obj-echo-mirror-route", i, f"obj-tm-hub-{k[-1]}", 0))

    # Per side, the Time Mode shows one dial and one context-row widget (hub -> expr -> hidden).
    for si, s in enumerate(("l", "r")):
        hub = f"obj-tm-hub-{s}"
        extra_boxes.append(nb(hub, "t i", 1500, 300 + si * 200, 30, 1, 1))
        extra_lines.append(h.line(f"obj-ctrl-tmode_{s}", 0, hub, 0))
        for j, (wid, modes) in enumerate(TMODE_SHOW):
            target = wid.format(s=s)
            ex = " && ".join(f"($i1 != {m})" for m in modes)
            e, pre = f"obj-tm-x-{s}-{j}", f"obj-tm-hide-{s}-{j}"
            extra_boxes += [nb(e, "expr " + ex, 1500 + j * 110, 330 + si * 200, 100, 1, 1),
                            nb(pre, "prepend hidden", 1500 + j * 110, 360 + si * 200, 90)]
            extra_lines += [h.line(hub, 0, e, 0), h.line(e, 0, pre, 0), h.line(pre, 0, target, 0)]

    # MIDI input (device-wide): `midiin` gives the device a MIDI input in Live; the MIDI From menus
    # (right column, only while a side is in MIDI mode) set where it comes from, through the LOM
    # (this_device midi_inputs 0), like Envelope Trigger's MIDI To. Note-ons go to the face (time)
    # and to the note displays.
    extra_boxes += [nb("obj-midiin", "midiin", 1500, 760, 50, 1, 1),
                    nb("obj-midiparse", "midiparse", 1500, 790, 70, 1, 8),
                    nb("obj-stripnote", "stripnote", 1500, 820, 70, 2, 2),
                    nb("obj-midi-note", "prepend midi_note", 1500, 850, 110, 1, 1),
                    nb("obj-midi-pak", "pak 1 1", 1700, 760, 60, 2, 1),
                    nb("obj-midi-x", "expr ($i1 != 4) && ($i2 != 4)", 1700, 790, 170, 1, 1),
                    nb("obj-midi-hide", "prepend hidden", 1700, 820, 90),
                    h.msgbox("obj-midi-settype", "settype $1", 1900, 760, 80),
                    h.msgbox("obj-midi-setchan", "setchannel $1", 1900, 790, 90)]
    extra_lines += [h.line("obj-midiin", 0, "obj-midiparse", 0), h.line("obj-midiparse", 0, "obj-stripnote", 0),
                    h.line("obj-stripnote", 0, "obj-midi-note", 0), h.line("obj-midi-note", 0, "obj-viz", 0),
                    h.line("obj-tm-hub-l", 0, "obj-midi-pak", 0), h.line("obj-tm-hub-r", 0, "obj-midi-pak", 1),
                    h.line("obj-midi-pak", 0, "obj-midi-x", 0), h.line("obj-midi-x", 0, "obj-midi-hide", 0),
                    h.line("obj-viz", 2, "obj-midi-type", 0), h.line("obj-viz", 3, "obj-midi-chan", 0),
                    h.line("obj-midi-type", 0, "obj-midi-settype", 0), h.line("obj-midi-settype", 0, "obj-viz", 0),
                    h.line("obj-midi-chan", 0, "obj-midi-setchan", 0), h.line("obj-midi-setchan", 0, "obj-viz", 0)]
    for s in ("l", "r"):
        extra_lines.append(h.line("obj-midi-note", 0, f"obj-notedial-{s}", 0))
    extra_boxes.append(label("obj-midi-lbl", "MIDI From", 375.0, 28.0, 54.0, 12.0, hidden=1))
    for mid, long_name, short, enum, y, help_text in (
            ("obj-midi-type", "MIDI From Type", "MIDI From", ["No Input", "-"], 41.0,
             "Where the MIDI notes for MIDI mode come from: a track, or an external MIDI port."),
            ("obj-midi-chan", "MIDI From Channel", "MIDI From Ch", ["-", "-"], 56.0,
             "The MIDI channel (or the device inside the source track) the notes come from.")):
        # Hidden parameter without an initial value: the menu only mirrors the LOM routing, whose
        # real state Live saves with the device.
        extra_boxes.append({"box": {
            "annotation": help_text, "annotation_name": long_name, "fontsize": 9.0, "hidden": 1, "id": mid,
            "maxclass": "live.menu", "numinlets": 1, "numoutlets": 3, "outlettype": ["", "", "float"],
            "parameter_enable": 1, "patching_rect": [1900.0, 820.0 + y, 54.0, 13.0], "presentation": 1,
            "presentation_rect": [375.0, y, 54.0, 13.0],
            "saved_attribute_attributes": {"valueof": {
                "parameter_annotation_name": long_name, "parameter_enum": enum, "parameter_info": help_text,
                "parameter_invisible": 2, "parameter_linknames": 1, "parameter_longname": long_name,
                "parameter_mmax": len(enum) - 1, "parameter_shortname": short, "parameter_type": 2}},
            "varname": long_name}})
        extra_lines.append(h.line("obj-midi-hide", 0, mid, 0))
    extra_lines.append(h.line("obj-midi-hide", 0, "obj-midi-lbl", 0))
    # Diffusion makes room for the MIDI From menus (obj-midi-x is 1 while no side is in MIDI mode)
    extra_boxes += [nb("obj-diff-sel", "sel 0 1", 1700, 850, 60, 1, 3),
                    h.msgbox("obj-diff-down", f"presentation_rect 382 {DIFF_DIAL_Y_MIDI:g} 40 47", 1700, 880, 200),
                    h.msgbox("obj-diff-up", f"presentation_rect 382 {DIFF_DIAL_Y:g} 40 47", 1910, 880, 200),
                    nb("obj-diff-x", "expr $i1 == 0", 1700, 910, 90, 1, 1),
                    nb("obj-diff-hide", "prepend hidden", 1700, 940, 90)]
    extra_lines += [h.line("obj-midi-x", 0, "obj-diff-sel", 0), h.line("obj-diff-sel", 0, "obj-diff-down", 0),
                    h.line("obj-diff-sel", 1, "obj-diff-up", 0), h.line("obj-diff-down", 0, "obj-ctrl-diffuse", 0),
                    h.line("obj-diff-up", 0, "obj-ctrl-diffuse", 0), h.line("obj-midi-x", 0, "obj-diff-x", 0),
                    h.line("obj-diff-x", 0, "obj-diff-hide", 0), h.line("obj-diff-hide", 0, "obj-ctrl-dsize", 0)]

    # groups: (expr over page $i1, filter display $i2, mod sync $i3) -> hidden flag -> widgets
    groups = [
        ("echo", "$i1 != 0", echo_ids),
        ("filt", "($i1 != 0) || ($i2 == 0)", ["obj-filtdisp"] + [f"obj-echo-filtline{i}" for i in range(len(FILT_LINES))]),
        ("mod", "$i1 != 1", mod_ids),
        ("hz", "($i1 != 1) || ($i3 != 0)", ["obj-ctrl-lfohz"]),
        ("div", "($i1 != 1) || ($i3 == 0)", ["obj-ctrl-lfodiv"]),
        ("opt", f"$i1 != {OPT_PAGE}", opt_ids),
    ] + ([("char", f"$i1 != {PAGES.index('Character') if SHOW_CHARACTER else -1}", char_ids)] if SHOW_CHARACTER else [])
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
    # Among background panels Max draws earlier boxes over later ones: separators first, then the
    # three sections, then the body.
    panels = [
        h.panel("obj-panel-left", 1.0, 1.0, 108.0, 167.0, bg=section, border=section),
        h.panel("obj-panel-right", 373.0, 1.0, 104.0, 167.0, bg=section, border=section),
        h.panel("obj-panel-display", X0, DISP_TOP, CW, 168.0 - DISP_TOP, bg=DISPLAY_BLACK, border=DISPLAY_BLACK),
    ]
    # Echo's darker body around the three panels (Live's Desktop colour, set by the face script)
    panels.append(h.panel("obj-panel-body", 0.0, 0.0, W, 169.0, bg=(0.165, 0.165, 0.165), border=(0.165, 0.165, 0.165)))
    for pnl in panels:
        pnl["box"]["varname"] = pnl["box"]["id"]
        pnl["box"]["rounded"] = 4 if pnl["box"]["id"] in ("obj-panel-left", "obj-panel-right") else 0
    # Underline under the selected page tab: two stacked hairlines (2 px) along the tab's bottom edge,
    # in the theme's accent, moved by the page switch (presentation_rect). Below the tab the ring
    # v8ui paints over them, so they sit on the tab itself, in front of it, with ignoreclick.
    seg_w = (TAB_W - TAB_SPACING * (len(PAGES) - 1)) / len(PAGES)
    tab_y = DISP_TOP + 1.0

    def outline_rects(i):
        sx = TAB_X + i * (seg_w + TAB_SPACING) + 4.0
        # live.line draws nothing in a 1 px tall box; a 2 px box draws a hairline across its middle
        return {f"u{k}": [sx, tab_y + TAB_H - 3.0 + k, seg_w - 8.0, 2.0] for k in range(2)}
    extra_boxes += [nb("obj-echo-x-tab", "expr $i1", 960, 580, 60, 1, 1),
                    nb("obj-echo-sel-tab", "sel " + " ".join(str(i) for i in range(len(PAGES))), 960, 610, 80, 1, len(PAGES) + 1)]
    extra_lines += [h.line("obj-echo-pak", 0, "obj-echo-x-tab", 0), h.line("obj-echo-x-tab", 0, "obj-echo-sel-tab", 0)]
    for side, r in outline_rects(0).items():
        ul = {"box": {"id": f"obj-echo-tab-ol-{side}", "maxclass": "live.line", "justification": 1,
                      "ignoreclick": 1, "linecolor": [0.96, 0.64, 0.23, 1.0], "numinlets": 1, "numoutlets": 0,
                      "patching_rect": [1500.0, 600.0, r[2], r[3]], "presentation": 1,
                      "presentation_rect": r, "varname": f"obj-echo-tab-ol-{side}"}}
        h.theme(ul, linecolor="live_control_selection")
        extra_boxes.append(ul)
    for i in range(len(PAGES)):
        for j, (side, r) in enumerate(outline_rects(i).items()):
            mid = f"obj-echo-tab-rect{i}{side}"
            extra_boxes.append(h.msgbox(mid, "presentation_rect " + " ".join(f"{v:g}" for v in r), 960 + i * 230, 640 + j * 30, 220))
            extra_lines += [h.line("obj-echo-sel-tab", i, mid, 0), h.line(mid, 0, f"obj-echo-tab-ol-{side}", 0)]
    # page separators inside the display: hairlines in the display's frame colour (a 1 px panel drew 3 px)
    seps = [("obj-panel-mod-sep", [X0 + 184.0, my, 5.0, 44.0])]
    if SHOW_CHARACTER:
        seps += [("obj-panel-char-v", [X0 + CW / 2.0 - 2.5, DISP_Y + 4.0, 5.0, 130.0]),
                 ("obj-panel-char-h", [X0 + 4.0, DISP_Y + 66.0, CW - 8.0, 5.0])]
    for sid, r in seps:
        sep = {"box": {"id": sid, "maxclass": "live.line", "justification": 1, "hidden": 1, "varname": sid,
                       "numinlets": 1, "numoutlets": 0, "patching_rect": [600.0 + r[0], 820.0 + r[1], r[2], r[3]],
                       "presentation": 1, "presentation_rect": r}}
        h.theme(sep, linecolor="live_lcd_frame")
        extra_boxes.append(sep)

    # ---- Live theme colours (follow Live's theme and hue, like Echo) ---------------------------
    th = h.theme
    # Panels: coloured by the face script from max.getcolor (dpApplyPanelTheme in delayplus_ui.js),
    # on load and on theme changes. Attribute bindings on panels did not repaint them in Live.
    in_display = set(echo_ids) | set(mod_ids) | set(char_ids) | set(opt_ids) | {"obj-ctrl-lfohz", "obj-ctrl-lfodiv"}
    for b in controls:
        bx = b["box"]
        if bx["id"] in in_display and bx["maxclass"] == "live.numbox":
            bx["lcdcolor"] = list(bx.get("textcolor", [*VALUE_BLUE, 1.0]))
            th(b, textcolor="live_lcd_control_fg_alt", lcdcolor="live_lcd_control_fg_alt")
    for b in labels:
        if b["box"]["id"] in in_display:
            th(b, textcolor="live_lcd_title")
    # Echo's filter switch is lit in the display's blue
    th(next(c for c in controls if c["box"]["id"] == "obj-ctrl-filton"), bgoncolor="live_lcd_control_fg_alt",
       activebgoncolor="live_lcd_control_fg_alt")
    # both tab states sit on the display's own colour (text-only tabs)
    th(page_tab, bgcolor="live_lcd_bg", activebgcolor="live_lcd_bg", bgoncolor="live_lcd_bg",
       activebgoncolor="live_lcd_bg")

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
            {"id": "obj-icon-link", "file": "delayplus_icon.js", "rect": [49.0, 24.0, 12.0, 10.0],
             "outs": 1, "keys": ["link"], "icon": "link"},
            {"id": "obj-clipcurve", "file": "delayplus_clipcurve.js", "rect": [X0 + 150.0, DISP_Y + 8.0, 100.0, 66.0],
             "outs": 1, "hidden": 1, "keys": ["clipmode", "cliplevel"]},
            # MIDI mode: the last MIDI note in place of the dial, greyed (display only)
            {"id": "obj-notedial-l", "file": "delayplus_notedial.js", "rect": [8.0, 14.0, 40.0, 38.0], "outs": 1,
             "hidden": 1, "keys": ["cents_l"]},
            {"id": "obj-notedial-r", "file": "delayplus_notedial.js", "rect": [61.0, 14.0, 40.0, 38.0], "outs": 1,
             "hidden": 1, "keys": ["cents_r"]},
            {"id": "obj-filtdisp", "file": "delayplus_filter.js", "pre": ["delayplus_spectrum.js"], "rect": FILT_RECT,
             "outs": 1, "names": True,
             "keys": ["hp", "lp", "hpres", "lpres", "filton", "modfilt", "filtdisp", "specdry", "specwet"]},
            {"id": "obj-lfodisp", "file": "delayplus_lfo.js", "rect": LFO_RECT, "outs": 1, "hidden": 1, "names": True,
             "keys": ["lfoshape", "phase", "moddelay", "modfilt", "envmix", "x4", "lfosync", "lfohz", "lfodiv"]},
        ],
    }
