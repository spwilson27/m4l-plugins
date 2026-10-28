#!/usr/bin/env python3
"""Operator+ face layout (device pixels, 725 x 169), measured from Live 12.4.7's Operator (tests/out/opplus_ref/*.png,
2x screenshots of the VM: device x = (crop_x - 19) / 2, y = (crop_y - 41) / 2). Operator's centre display reaches 14 px
up into the title bar; an M4L device cannot draw there, so the display's graph strip is 14 px shorter.

items(): every drawn control: {key, t (type), x, y, w, h, label, lx, ly, g (visibility group), cond}. The face v8ui
draws them (src/opplus_ui.js) and the build places one transparent live.* object per item over it (rule 4 exception:
the face is ignoreclick and draws only). Groups: "shell" always; "s<i>" only while section i is selected
(0..3 = A..D, 4 LFO, 5 Filter, 6 Pitch, 7 Global). cond: an extra condition evaluated by the face (opCond).
"""

W, H = 725, 169
LEFT_X, LEFT_W = 0, 210          # oscillator column (rows D, C, B, A from the top)
RIGHT_X, RIGHT_W = 514, 210      # LFO, Filter, Pitch, Global
ROW_Y = [0, 43, 86, 129]
ROW_H = 40
DISP = [215, 0, 294, 167]        # display rectangle
GRAPH = [215, 0, 294, 61]        # interactive graph strip (envelope / harmonics / filter / algorithms)
OSC_ROW = {"D": 0, "C": 1, "B": 2, "A": 3}
SEC = ["A", "B", "C", "D", "LFO", "Filter", "Pitch", "Global"]

# display grid (absolute device px)
COL = [219.5, 269.5, 313.0, 356.5, 408.0, 458.0]
LBL_Y = [81.0, 111.0, 141.0]
VAL_Y = [95.0, 125.0, 155.0]
HEAD_Y = 66.0


def _dial(key, cx, rowy, label, g="shell", cond=None):
    return {"key": key, "t": "dial", "x": cx, "y": rowy + 24.5, "label": label, "lx": cx - 8.5, "ly": rowy + 8.0, "g": g, "cond": cond}


COL_W = [46.0, 41.0, 41.0, 44.0, 46.0, 46.0]   # value field widths: each ends before the next column starts


def _lcd(key, col, row, label, g, w=None, cond=None, label_override=None):
    x = COL[col]
    w = COL_W[col] if w is None else w
    return {"key": key, "t": "lcd", "x": x, "y": VAL_Y[row], "w": w, "h": 15.0, "label": label if label_override is None else label_override,
            "lx": x, "ly": LBL_Y[row], "g": g, "cond": cond}


def _menu(key, x, y, w, g, label=None, ly=None, cond=None, style="lcd"):
    return {"key": key, "t": "menu", "x": x, "y": y, "w": w, "h": 12.0, "label": label, "lx": x, "ly": ly, "g": g, "cond": cond, "style": style}


def _sq(key, x, y, s, g, text="", style="toggle", cond=None, w=None):
    return {"key": key, "t": "toggle", "x": x, "y": y, "w": w or s, "h": s, "text": text, "g": g, "style": style, "cond": cond}


def items():
    it = []
    # ---------- oscillator shell panels ----------
    for L, r in OSC_ROW.items():
        y, l = ROW_Y[r], L.lower()
        it.append(_dial("%s_coarse" % l, 13.75, y, "Coarse", cond="nofix" + L))
        it.append(_dial("%s_fix_freq" % l, 13.75, y, "Freq", cond="fix" + L))
        it.append(_dial("%s_fine" % l, 72.5, y, "Fine", cond="nofix" + L))
        it.append(_dial("%s_fix_freq_mul" % l, 72.5, y, "Multi", cond="fix" + L))
        it.append(_sq("%s_fix_on" % l, 114.5, y + 20.0, 9.0, "shell", style="square"))
        it.append({"key": None, "t": "label", "label": "Fixed", "lx": 105.5, "ly": y + 8.0, "g": "shell"})
        it.append(_dial("osc_%s_level" % l, 149.25, y, "Level"))
        it.append(_sq("osc_%s_on" % l, 191.0, y + 13.5, 11.5, "shell", text=L, style="letter"))
    # ---------- right shell panels ----------
    y = ROW_Y[0]
    it.append(_sq("lfo_on", 520.5, y + 5.5, 11.0, "shell", style="square"))
    it.append({"key": None, "t": "label", "label": "LFO", "lx": 537.0, "ly": y + 11.0, "g": "shell", "big": 1})
    it.append(_menu("lfo_type", 521.0, y + 22.0, 48.0, "shell", style="box"))
    it.append(_menu("lfo_range", 573.0, y + 22.0, 18.0, "shell", style="box"))
    it.append(_sq("lfo_retrigger", 595.0, y + 22.0, 11.0, "shell", text="R", style="rbox"))
    it.append(_dial("lfo_rate", 625.5, y, "Rate", cond="lfonosync"))
    it.append(_dial("lfo_sync", 625.5, y, "Rate", cond="lfosync"))
    it.append(_dial("lfo_amt", 681.5, y, "Amount"))
    y = ROW_Y[1]
    it.append(_sq("filter_on", 520.5, y + 5.5, 11.0, "shell", style="square"))
    it.append({"key": None, "t": "label", "label": "Filter", "lx": 537.0, "ly": y + 11.0, "g": "shell", "big": 1})
    it.append(_menu("filter_type", 568.0, y + 5.0, 38.5, "shell", style="icon"))
    it.append({"key": "filter_slope", "t": "tab", "x": 520.5, "y": y + 22.0, "w": 40.0, "h": 12.0, "items": ["12", "24"], "g": "shell"})
    it.append(_menu("filter_circuit_lp_hp", 568.0, y + 22.0, 38.5, "shell", style="box", cond="lphp"))
    it.append(_menu("filter_circuit_bp_no_morph", 568.0, y + 22.0, 38.5, "shell", style="box", cond="nolphp"))
    it.append(_dial("filter_freq", 625.5, y, "Freq"))
    it.append(_dial("filter_res", 681.5, y, "Res"))
    y = ROW_Y[2]
    it.append({"key": None, "t": "peicon", "x": 521.0, "y": y + 7.0, "g": "shell"})
    it.append(_sq("pe_on", 520.5, y + 17.5, 11.0, "shell", style="square"))
    it.append(_dial("pe_amount", 569.5, y, "Pitch Env"))
    it.append(_dial("spread", 623.5, y, "Spread"))
    it.append(_dial("transpose", 676.5, y, "Transpose"))
    y = ROW_Y[3]
    it.append({"key": None, "t": "algicon", "x": 533.0, "y": y + 4.5, "g": "shell"})
    it.append(_dial("time", 569.5, y, "Time"))
    it.append(_dial("tone", 623.5, y, "Tone"))
    it.append(_dial("volume", 681.5, y, "Volume"))

    # ---------- display: envelope grids ----------
    def env_grid(px, g, levels_db=True, has_end=False, vel_key=None, key_key=None, extra4=None):
        it.append(_lcd(px + "_attack", 0, 0, "Attack", g, cond="times" + g))
        it.append(_lcd(px + "_decay", 1, 0, "Decay", g, cond="times" + g))
        it.append(_lcd(px + "_release", 2, 0, "Release", g, cond="times" + g))
        if px in ("fe", "pe"):
            it.append(_lcd(px + "_a_slope", 0, 0, "A.Slope", g, cond="slopes" + g))
            it.append(_lcd(px + "_d_slope", 1, 0, "D.Slope", g, cond="slopes" + g))
            it.append(_lcd(px + "_r_slope", 2, 0, "R.Slope", g, cond="slopes" + g))
        it.append(_lcd(px + "_r_lt_vel", 3, 0, "Time<Vel", g))
        it.append(_lcd(px + "_init", 0, 1, "Initial", g))
        it.append(_lcd(px + "_peak", 1, 1, "Peak", g))
        it.append(_lcd(px + "_sustain", 2, 1, "Sustain", g))
        it.append(_menu(px + "_mode", COL[0], VAL_Y[2] - 6.0, 44.0, g, label="Loop", ly=LBL_Y[2]))
        it.append(_lcd(px + "_loop", 1, 2, "Time", g, cond="mloop" + px))
        it.append(_lcd(px + "_retrig", 1, 2, "Repeat", g, cond="mbeat" + px))
        if has_end:
            it.append(_lcd(px + "_end", 2, 2, "End", g))
        if vel_key:
            it.append(_lcd(vel_key, 3, 1, "Vel", g))
        if key_key:
            it.append(_lcd(key_key, 3, 2, "Key", g))
        if extra4:
            it.append(_lcd(extra4[0], 3, 1, extra4[1], g))

    for i, L in enumerate("ABCD"):
        g, l = "s%d" % i, L.lower()
        env_grid(l + "e", g, vel_key="osc_%s_lev_lt_vel" % l, key_key="osc_%s_lev_lt_key" % l)
        it.append(_menu("osc_%s_wave" % l, COL[4], VAL_Y[0] - 6.0, 40.0, g, label="Wave", ly=LBL_Y[0], style="lcdalt", cond="wave" + L))
        it.append({"key": None, "t": "waveicon", "x": 460.5, "y": 80.0, "w": 36.0, "h": 17.0, "osc": i, "g": g, "cond": "wave" + L})
        # Operator+: oscillator Type in the free End slot of the oscillator envelope grid; Shape / Shape<LFO replace Wave and
        # its icon while the Type is not Operator
        it.append(_menu("osc_%s_type" % l, COL[2], VAL_Y[2] - 6.0, 41.0, g, label="Type", ly=LBL_Y[2], style="lcdalt"))
        it.append(_lcd("osc_%s_shape" % l, 4, 0, "Shape", g, cond="shape" + L))
        it.append(_lcd("osc_%s_shp_lt_lfo" % l, 5, 0, "Shp<LFO", g, cond="shape" + L))
        it.append(_lcd("osc_%s_feedb" % l, 4, 1, "Feedback", g))
        it.append(_menu("osc_%s_repeat" % l, COL[5], VAL_Y[1] - 6.0, 44.0, g, label="Repeat", ly=LBL_Y[1]))
        it.append(_sq("osc_%s_retrig" % l, COL[4], VAL_Y[2] - 5.0, 10.0, g, text="R", style="rbox"))
        it.append(_lcd("osc_%s_phase" % l, 4, 2, "Phase", g, w=30.0))
        it[-1]["x"] = COL[4] + 13.0
        it[-1]["lx"] = COL[4]
        it.append(_lcd("%s_freq_lt_vel" % l, 5, 2, "Osc<Vel", g, w=30.0))
        it.append(_sq("%s_quantize" % l, 489.0, VAL_Y[2] - 5.0, 10.0, g, text="Q", style="rbox"))

    # LFO
    g = "s4"
    env_grid("le", g, has_end=True)
    it.append({"key": "lfo_amt_a", "t": "lcd", "x": COL[5] + 4.0, "y": LBL_Y[0], "w": 40.0, "h": 13.0, "label": "Dest. A", "lx": COL[4], "ly": LBL_Y[0], "g": g, "rlabel": 1})
    for j, (k, txt) in enumerate([("osc_a_lt_lfo", "A"), ("osc_b_lt_lfo", "B"), ("osc_c_lt_lfo", "C"), ("osc_d_lt_lfo", "D")]):
        it.append(_sq(k, 408.5 + j * 16.0, VAL_Y[0] - 5.0, 10.5, g, text=txt, style="dbtn"))
    it.append(_sq("filt_lt_lfo", 472.5, VAL_Y[0] - 5.0, 10.5, g, text="FIL", style="dbtn", w=19.5))
    it.append({"key": "lfo_amt_b", "t": "lcd", "x": COL[5] + 4.0, "y": LBL_Y[1], "w": 40.0, "h": 13.0, "label": "Dest. B", "lx": COL[4], "ly": LBL_Y[1], "g": g, "rlabel": 1})
    it.append(_menu("lfo_dst_b", COL[4], VAL_Y[1] - 6.0, 92.0, g))
    it.append(_lcd("lfo_r_lt_k", 4, 2, "Rate<Key", g))
    it.append(_lcd("lfo_lt_vel", 5, 2, "Amt<Vel", g))

    # Filter
    g = "s5"
    env_grid("fe", g, has_end=True, extra4=("fe_amount", "Envelope"))
    it.append(_menu("shaper_type", COL[5], VAL_Y[0] - 6.0, 44.0, g, label="Shaper", ly=LBL_Y[0]))
    it.append(_lcd("filter_morph", 4, 0, "Morph", g, cond="morph"))
    it.append(_lcd("filter_drive", 4, 0, "Drive", g, cond="drive"))
    it.append(_lcd("filt_lt_vel", 4, 1, "Freq<Vel", g))
    it.append(_lcd("shaper_drive", 5, 1, "Shp.Drive", g))
    it.append(_lcd("filt_lt_key", 4, 2, "Freq<Key", g))
    it.append(_lcd("shaper_mix", 5, 2, "Dry/Wet", g))

    # Pitch
    g = "s6"
    env_grid("pe", g, has_end=True)
    it.append({"key": "pe_amt_a", "t": "lcd", "x": COL[5] + 4.0, "y": LBL_Y[0], "w": 40.0, "h": 13.0, "label": "Dest. A", "lx": COL[4], "ly": LBL_Y[0], "g": g, "rlabel": 1})
    for j, (k, txt) in enumerate([("osc_a_lt_pe", "A"), ("osc_b_lt_pe", "B"), ("osc_c_lt_pe", "C"), ("osc_d_lt_pe", "D")]):
        it.append(_sq(k, 408.5 + j * 16.0, VAL_Y[0] - 5.0, 10.5, g, text=txt, style="dbtn"))
    it.append(_sq("lfo_lt_pe", 472.5, VAL_Y[0] - 5.0, 10.5, g, text="LFO", style="dbtn", w=19.5))
    it.append({"key": "pe_amt_b", "t": "lcd", "x": COL[5] + 4.0, "y": LBL_Y[1], "w": 40.0, "h": 13.0, "label": "Dest. B", "lx": COL[4], "ly": LBL_Y[1], "g": g, "rlabel": 1})
    it.append(_menu("pe_dst_b", COL[4], VAL_Y[1] - 6.0, 92.0, g))
    it.append(_sq("glide_on", COL[4], VAL_Y[2] - 5.0, 10.0, g, text="G", style="rbox"))
    it.append({"key": None, "t": "label", "label": "Glide", "lx": COL[4], "ly": LBL_Y[2], "g": g})
    it.append(_lcd("glide_time", 5, 2, "Time", g))

    # Global
    g = "s7"
    rows = [("Velocity", "vel", True, None), ("Key", "key", False, ("time_lt_key", "Time")), ("Aftertouch", "at", True, None),
            ("Pitch Bend", "pb", False, ("pb_range", "Pitch")), ("Mod Wheel", "mw", True, None)]
    it.append({"key": None, "t": "glabel", "label": "Conn. A", "lx": 285.5, "ly": 34.5, "g": g})
    it.append({"key": None, "t": "glabel", "label": "Amt. A", "lx": 352.5, "ly": 34.5, "g": g})
    it.append({"key": None, "t": "glabel", "label": "Conn. B", "lx": 394.5, "ly": 34.5, "g": g})
    it.append({"key": None, "t": "glabel", "label": "Amt. B", "lx": 460.5, "ly": 34.5, "g": g})
    for j, (name, src, hasb, fixed) in enumerate(rows):
        yy = 50.0 + j * 17.0
        it.append({"key": None, "t": "label", "label": name, "lx": 225.5, "ly": yy, "g": g})
        it.append(_menu("mx_%s_dst_a" % src, 285.5, yy - 6.0, 56.0, g, style="lcdalt"))
        it.append({"key": "mx_%s_amt_a" % src, "t": "lcd", "x": 352.5, "y": yy, "w": 34.0, "h": 13.0, "label": None, "g": g, "style": "dim"})
        if hasb:
            it.append(_menu("mx_%s_dst_b" % src, 394.5, yy - 6.0, 56.0, g, style="lcdalt"))
            it.append({"key": "mx_%s_amt_b" % src, "t": "lcd", "x": 460.5, "y": yy, "w": 34.0, "h": 13.0, "label": None, "g": g, "style": "dim"})
        else:
            it.append({"key": None, "t": "label", "label": fixed[1], "lx": 394.5, "ly": yy, "g": g})
            it.append({"key": fixed[0], "t": "lcd", "x": 460.5, "y": yy, "w": 34.0, "h": 13.0, "label": None, "g": g, "style": "alt"})
    by, vy = 141.5, 155.0
    it.append(_menu("voices", 220.5, vy - 6.0, 24.0, g, label="Voices", ly=by))
    it.append(_sq("retrigger", 258.0, vy - 5.5, 11.0, g, text="R", style="rbox"))
    it.append({"key": None, "t": "label", "label": "Rtg", "lx": 258.0, "ly": by, "g": g})
    it.append(_sq("interpolation", 283.0, vy - 5.5, 11.0, g, style="fill"))
    it.append({"key": None, "t": "label", "label": "Interpol.", "lx": 283.0, "ly": by, "g": g})
    it.append(_sq("antialias", 330.5, vy - 5.5, 11.0, g, style="fill"))
    it.append({"key": None, "t": "label", "label": "Antialias", "lx": 330.5, "ly": by, "g": g})
    it.append({"key": "panorama", "t": "lcd", "x": 378.5, "y": vy, "w": 26.0, "h": 13.0, "label": "Pan", "lx": 378.5, "ly": by, "g": g, "style": "alt"})
    it.append({"key": "pan_lt_key", "t": "lcd", "x": 410.5, "y": vy, "w": 40.0, "h": 13.0, "label": "Pan<Key", "lx": 410.5, "ly": by, "g": g, "style": "alt"})
    it.append({"key": "pan_lt_rnd", "t": "lcd", "x": 457.5, "y": vy, "w": 40.0, "h": 13.0, "label": "Pan<Rnd", "lx": 457.5, "ly": by, "g": g, "style": "alt"})
    return it


def ubuttons():
    """Click zones that are not parameters: section select (whole shell panels) and the display's header toggles."""
    out = []
    for L, r in OSC_ROW.items():
        out.append(("sel_" + L, [LEFT_X, ROW_Y[r], LEFT_W, ROW_H], "sel %d" % "ABCD".index(L)))
    for j, s in enumerate(["LFO", "Filter", "Pitch", "Global"]):
        out.append(("sel_" + s, [RIGHT_X, ROW_Y[j], RIGHT_W, ROW_H], "sel %d" % (4 + j)))
    out.append(("view_env", [217.0, HEAD_Y - 6.0, 70.0, 12.0], "view 0"))
    out.append(("view_other", [405.0, HEAD_Y - 6.0, 70.0, 12.0], "view 1"))
    out.append(("slope_tog", [216.0, LBL_Y[0] - 5.0, 8.0, 10.0], "slopes"))
    return out


if __name__ == "__main__":
    import json
    print(json.dumps(items(), indent=0)[:2000])
    print(len(items()), "items")
