"""Reverb+ face `d` -> `Reverb+ D` (632 x 169): "Display + grouped strip".

  display v8ui (4,4  624 x 95)   the Decay Waterfall made wide and short (src/reverbplus_face_d*.js): waterfall + predicted decay
                                  at the left, dry/wet strip, band readout, PRE / LOOP / FROZEN / CLIP and the IR name at the right
  ONE row of 12 compact controls under it (live.dial, 46 x 44, plus a live.menu / live.text / live.drop where a dial does not
  fit), in four groups, each marked like  +-- SPACE >--+  : a bracket of live.lines with the group's name centred in a gap, short
  vertical ticks at the ends and a vertical separator between groups.
      SPACE  Algorithm | Pre-Delay | Size | Decay            TONE  HF Damp | Low Cut | High Cut
      LOOP   Loop | Loop Time                                MIX   Freeze | Width | Dry/Wet
  The bracket title is a live.text toggle (hidden UI-state parameters Space / Tone / Loop / Mix Page): click it and that group's
  row swaps for its second page (title shows "< NAME"); the other groups are not touched.
      SPACE 2  Early | Diffusion | Mod Rate | Mod Depth      TONE 2  Bass Mult | Crossover | Late
      LOOP 2   Clip Level | Clip Mode                         MIX 2   Output | Duck | Duck Rel
  Convolution swaps SPACE: page 1 shows IR Stretch instead of Size, page 2 IR File | IR Start | IR Decay | IR Reverse.
  Parameters the algorithm ignores are greyed (Decay and Freeze in Convolution, Bass / Crossover / Early on Plate and Spring).
Every parameter is on the face (no off_face). The display's outlet 1 drives the page logic (`g_<group> <hidden>` -> route ->
`prepend hidden`; `act_<key>` -> `prepend active`), computed in the face from the Page parameters and the algorithm.

Preview pages: REVERBPLUS_D_PAGE=space2|tone2|loop2|mix2|conv|conv2 saves that state (build + python3 scripts/render_preview.py).
"""
import os

W = 632.0
DISP = [4.0, 4.0, 624.0, 95.0]
ROW_PANEL = [4.0, 100.0, 624.0, 65.0]
TITLE_Y = 102.0
LINE_Y = 108.0
DIAL_Y = 117.0
DIAL_W, DIAL_H = 46.0, 44.0
CTRL_Y, CTRL_H = 146.0, 15.0
TITLE_W = 44.0

# group: (x of the bracket, width, [(slot x, slot width), ...])
GROUPS = {
    "space": (8.0, 200.0, [(10.0, 58.0), (68.0, 46.0), (114.0, 46.0), (160.0, 46.0)]),
    "tone": (220.0, 142.0, [(222.0, 46.0), (268.0, 46.0), (314.0, 46.0)]),
    "loop": (374.0, 96.0, [(376.0, 46.0), (422.0, 46.0)]),
    "mix": (482.0, 142.0, [(484.0, 46.0), (530.0, 46.0), (576.0, 46.0)]),
}
ORDER = ["space", "tone", "loop", "mix"]
TITLES = {"space": "SPACE", "tone": "TONE", "loop": "LOOP", "mix": "MIX"}
PAGE_KEYS = {g: f"pg_{g}" for g in ORDER}

# widget groups (the names the face emits): (group, kind, key, slot); kind dial | menu | text | drop
ITEMS = {
    "sp1": [("space", "menu", "algo", 0), ("space", "dial", "predelay", 1), ("space", "dial", "decay", 3)],
    "sp1t": [("space", "dial", "size", 2)],
    "sp1c": [("space", "dial", "irstretch", 2)],
    "sp2t": [("space", "dial", "erlevel", 0), ("space", "dial", "diffusion", 1), ("space", "dial", "modrate", 2),
             ("space", "dial", "moddepth", 3)],
    "sp2c": [("space", "drop", "irfile", 0), ("space", "dial", "irstart", 1), ("space", "dial", "irdecay", 2),
             ("space", "text", "irreverse", 3)],
    "tn1": [("tone", "dial", "damp", 0), ("tone", "dial", "lowcut", 1), ("tone", "dial", "highcut", 2)],
    "tn2": [("tone", "dial", "bassmult", 0), ("tone", "dial", "xover", 1), ("tone", "dial", "latelevel", 2)],
    "lp1": [("loop", "dial", "loop", 0), ("loop", "dial", "looptime", 1)],
    "lp2": [("loop", "dial", "looplevel", 0), ("loop", "menu", "loopclip", 1)],
    "mx1": [("mix", "text", "freeze", 0), ("mix", "dial", "width", 1), ("mix", "dial", "drywet", 2)],
    "mx2": [("mix", "dial", "output", 0), ("mix", "dial", "duck", 1), ("mix", "dial", "duckrel", 2)],
}
GROUP_NAMES = list(ITEMS)  # same order as DG_NAMES in the face
LABELS = {"algo": "Algorithm", "irfile": "IR File", "irreverse": "Reverse", "freeze": "Freeze", "loopclip": "Clip Mode"}
ACT_KEYS = ["decay", "freeze", "size", "diffusion", "modrate", "moddepth", "bassmult", "xover", "erlevel"]  # DG_ACT in the face

HERO_KEYS = ["algo", "predelay", "decay", "bassmult", "xover", "damp", "loop", "freeze"] + list(PAGE_KEYS.values())

PANEL_BG = [0.2, 0.2, 0.2, 1.0]
TEXT = [0.80, 0.82, 0.85, 1.0]
SEL = [0.96, 0.64, 0.23, 1.0]
LINE = [0.45, 0.50, 0.58, 1.0]

# preview pages: name -> (page flags space, tone, loop, mix; algorithm index)
PAGES = {
    "": ((0, 0, 0, 0), 1), "space2": ((1, 0, 0, 0), 1), "tone2": ((0, 1, 0, 0), 1), "loop2": ((0, 0, 1, 0), 1),
    "mix2": ((0, 0, 0, 1), 1), "conv": ((0, 0, 0, 0), 5), "conv2": ((1, 0, 0, 0), 5),
}


def hidden_groups(algo, pg):
    """Mirror of dHidden() in src/reverbplus_face_d.js: 1 = the group is hidden."""
    conv = 1 if algo == 5 else 0
    h = {
        "sp1": pg[0], "sp1t": 1 if (pg[0] or conv) else 0, "sp1c": 1 if (pg[0] or not conv) else 0,
        "sp2t": 1 if (not pg[0] or conv) else 0, "sp2c": 1 if (not pg[0] or not conv) else 0,
        "tn1": pg[1], "tn2": 0 if pg[1] else 1, "lp1": pg[2], "lp2": 0 if pg[2] else 1, "mx1": pg[3], "mx2": 0 if pg[3] else 1,
    }
    return {k: 1 if v else 0 for k, v in h.items()}


def layout(h):
    page = os.environ.get("REVERBPLUS_D_PAGE", "")
    pg, algo = PAGES[page]
    saved_algo = h.P["algo"]
    if algo != saved_algo[4]:
        h.P["algo"] = saved_algo[:4] + (algo,) + saved_algo[5:]
    hid = hidden_groups(algo, pg)
    controls, extra, lines = [], [], []
    members = {g: [] for g in GROUP_NAMES}

    for g in ORDER:
        h.register(PAGE_KEYS[g], f"{TITLES[g].title()} Page", f"{TITLES[g].title()} Page", 0, 1, pg[ORDER.index(g)], ptype=2,
                   enum=["Main", "More"], help_text=f"Click the {TITLES[g]} title to swap this group's controls for its second page.")

    def label(oid, text, x, w, hidden):
        b = h.label(oid, text, x, DIAL_Y - 1.0, w, 12.0, size=8.5, align=1, hidden=hidden)
        h.theme(b, textcolor="live_control_fg")
        extra.append(b)
        return oid

    for gname, items in ITEMS.items():
        hidden = hid[gname]
        for grp, kind, key, slot in items:
            sx, sw = GROUPS[grp][2][slot]
            if kind == "dial":
                x = sx + (sw - DIAL_W) / 2.0
                d = h.dial(key, x, DIAL_Y, w=DIAL_W, h=DIAL_H, hidden=hidden)
                d["box"]["fontsize"] = 8.0
                controls.append(d)
                members[gname].append(f"obj-ctrl-{key}")
                continue
            w = sw - 4.0 if kind in ("menu", "drop") else DIAL_W - 8.0
            x = sx + (sw - w) / 2.0
            if kind == "menu":
                controls.append(h.menu(key, x, CTRL_Y, w, CTRL_H, hidden=hidden))
            elif kind == "drop":
                controls.append(h.irdrop(x, CTRL_Y, w, CTRL_H, hidden=hidden))
            else:
                controls.append(h.button(key, x, CTRL_Y, w, CTRL_H, text="Off", texton="On", hidden=hidden))
            members[gname] += [f"obj-ctrl-{key}", label(f"obj-lay-d-lbl-{key}", LABELS[key], sx, sw, hidden)]

    # ---- bracket titles, lines, separators ----------------------------------------------------------------------------
    def add_line(oid, rect, patch):
        b = {"box": {"id": oid, "maxclass": "live.line", "justification": 1, "numinlets": 1, "numoutlets": 0,
                     "linecolor": list(LINE), "patching_rect": patch, "presentation": 1, "presentation_rect": rect, "varname": oid}}
        h.theme(b, linecolor="live_lcd_title")  # the dim label colour of Live's displays: visible but quiet on the surface
        extra.append(b)

    def hline(oid, x, w):
        add_line(oid, [x, LINE_Y, w, 2.0], [1500.0 + x, 700.0, w, 2.0])

    def vline(oid, x, y, hh):
        add_line(oid, [x, y, 2.0, hh], [1500.0 + x, 720.0 + y, 2.0, hh])

    for i, g in enumerate(ORDER):
        gx, gw, _slots = GROUPS[g]
        tx = gx + (gw - TITLE_W) / 2.0
        t = h.button(PAGE_KEYS[g], tx, TITLE_Y, TITLE_W, 14.0, text=f"{TITLES[g]} >", texton=f"< {TITLES[g]}")
        tb = t["box"]
        tb["fontsize"] = 8.0
        tb["fontface"] = 1
        for a in ("bgcolor", "activebgcolor", "bgoncolor", "activebgoncolor", "bordercolor"):
            tb[a] = list(PANEL_BG)
        for a in ("textcolor", "activetextcolor"):
            tb[a] = list(TEXT)
        for a in ("textoncolor", "activetextoncolor"):
            tb[a] = list(SEL)
        h.theme(t, bgcolor="live_surface_bg", activebgcolor="live_surface_bg", bgoncolor="live_surface_bg",
                activebgoncolor="live_surface_bg", bordercolor="live_surface_bg", textcolor="live_control_fg",
                activetextcolor="live_control_fg", textoncolor="live_control_selection", activetextoncolor="live_control_selection")
        controls.append(t)
        hline(f"obj-lay-d-br-{g}-l", gx, tx - 2.0 - gx)
        hline(f"obj-lay-d-br-{g}-r", tx + TITLE_W + 2.0, gx + gw - (tx + TITLE_W + 2.0))
        vline(f"obj-lay-d-tick-{g}-l", gx, LINE_Y, 8.0)
        vline(f"obj-lay-d-tick-{g}-r", gx + gw - 2.0, LINE_Y, 8.0)
        if i < len(ORDER) - 1:
            nx = GROUPS[ORDER[i + 1]][0]
            vline(f"obj-lay-d-sep-{i}", (gx + gw + nx) / 2.0 - 1.0, 122.0, 36.0)

    # ---- page logic: display outlet 1 -> route -> prepend hidden / active -> widgets -------------------------------------
    route_args = [f"g_{n}" for n in GROUP_NAMES] + [f"act_{k}" for k in ACT_KEYS]
    extra.append(h.newobj("obj-lay-d-route", "route " + " ".join(route_args), 1300.0, 100.0, 520.0, 1, len(route_args) + 1,
                          [""] * (len(route_args) + 1)))
    lines.append(h.line("obj-lay-d-viz", 1, "obj-lay-d-route", 0))
    for i, n in enumerate(GROUP_NAMES):
        pid = f"obj-lay-d-hide-{n}"
        extra.append(h.newobj(pid, "prepend hidden", 1300.0 + 90.0 * (i % 11), 140.0, 84.0))
        lines.append(h.line("obj-lay-d-route", i, pid, 0))
        lines += [h.line(pid, 0, t, 0) for t in members[n]]
    for j, k in enumerate(ACT_KEYS):
        pid = f"obj-lay-d-act-{k}"
        extra.append(h.newobj(pid, "prepend active", 1300.0 + 90.0 * j, 180.0, 84.0))
        lines.append(h.line("obj-lay-d-route", len(GROUP_NAMES) + j, pid, 0))
        lines.append(h.line(pid, 0, f"obj-ctrl-{k}", 0))

    h.P["algo"] = saved_algo
    panels = [
        h.panel("obj-lay-d-row", *ROW_PANEL),
        h.panel("obj-lay-d-display", *DISP),
        h.panel("obj-lay-d-body", 0.0, 0.0, W, 169.0),
    ]
    return {
        "width": W,
        "controls": controls,
        "off_face": {},
        "panels": panels,
        "panel_theme": [["obj-lay-d-body", "live_desktop", [0.165, 0.165, 0.165, 1]],
                        ["obj-lay-d-display", "live_lcd_bg", [0.075, 0.075, 0.075, 1]],
                        ["obj-lay-d-row", "live_surface_bg", PANEL_BG]],
        "extra_boxes": extra,
        "extra_lines": lines,
        "v8uis": [
            {"id": "obj-lay-d-viz", "files": ["reverbplus_face_d_math.js", "reverbplus_face_d.js"], "rect": list(DISP), "outs": 2,
             "keys": HERO_KEYS},
        ],
    }
