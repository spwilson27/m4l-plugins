#!/usr/bin/env python3
"""
Build devices/Freq Split.amxd and devices/Freq Split.adg (Bitwig Freq Split (Spectral) style spectral sorter).

Four channels: 1 red, 2 blue, 3 yellow, 4 magenta. The log-frequency axis is cut by 1..1024 (continuous) splits into many narrow
regions that are dealt to the channels in rotation; Split Insertion Direction (<- / <-> / ->) says where a fractional new split
grows in, Crossfade overlaps neighbouring regions, Nudge (+-4, wrapping, fractional crossfades) shifts the channel assignment, Spin
(+-50 %, wrapping) slides the pattern, Bend / Pinch (the XY dot) warp it. Use the device as the FIRST device of EVERY chain of an
Audio Effect Rack, one chain per channel (the .adg preset does exactly that): the rack's chain volume / pan / activator / solo and
the chain's devices are Bitwig's per-channel Gain / Pan / On / Solo / FX chain, devices before / after the rack are Pre FX / Post FX.
Every instance computes the same pattern and per-bin masks from linked parameters and outputs only its own channel (Output =
Auto: the chain index); the masks sum to 1, so the chains sum back to the input delayed by the constant latency (5120 samples, "latency": 5120).
Mix keeps that identity in a rack (out = mix * wet + (1 - mix) * dry / 4 per chain). No signal analysis: the masks depend on the
parameters only.

Signal path: plugin~ -> gen~ -> plugout~, where the gen~ is NOT in the saved device: the face creates it after load from the embedded gen
patch (src/spectral_dsp.js, AGENTS.md 1d; gen code = cepstrum_lib + spectral_split_lib + spectral_split_rack + the expanded
src/freqsplit_core.genexpr with the rack template src/spectral_split_rack_main.genexpr). Every gen-bound message goes into the ss_genin hub
(gate 1 1). ONE instance per rack (the leader, elected by the face through src/spectral_link.js) frames the signal, runs the FFT once and
computes all four channels; the other chains read their channel from its ring (latency 5120 = 4096 + the host block margin). The main v8ui
face (src/freqsplit_config.js + src/spectral_link.js + src/spectral_theme.js + src/spectral_dsp.js + src/freqsplit_ui.js) draws the channel
regions, the XY dot, the limiter line and the spectrum, links the parameters with the other instances in the rack and sends the gen its
output selection, role and buffer names; the small header v8ui (src/freqsplit_top_ui.js) draws the direction arrows and the crossfade ramp.

Layout (480 x 169, Live Reverb style, Live theme colours): left section "Splits" (x=4..340: Splits | Insert arrows | XFade row, the
display canvas, Nudge | Spin | Bend | Pinch row), right sections "Spectrum" (Display Pre | Post, Limiter + threshold) and "Output"
(Output, Size, Mix dial, latency note); section panels then the body panel last. No live.* widget overlaps a v8ui.
"""

import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from spectral_common import line, newobj, message

ROOT = sc.ROOT_DIR
SRC = os.path.join(ROOT, "src")
OUT_AMXD = os.path.join(sc.DEVICES_DIR, "Freq Split.amxd")
OUT_ADG = os.path.join(sc.DEVICES_DIR, "Freq Split.adg")
WIDTH = 480.0
LATENCY = sc.RACK_LATENCY      # 5120: 4096 + the host block margin the leader / follower exchange needs
RING_SAMPS = sc.rack_ring_samps(4)
ZERO_COUNT = 640
SC_FRAME = 640                 # first scope slot of the rack template's common scalars (FS_SC_FRAME)

RED, BLU, YEL, MAG = sc.RED, sc.BLUE, sc.YELLOW, sc.MAGENTA
ORG = sc.ORANGE

# key: (long name, short name, min, max, initial, ptype, unitstyle)
NUM = {
    "splits": ("Frequency Splits", "Splits", 1.0, 1024.0, 16.0, 0, 9),
    "xfade": ("Crossfade Amount", "XFade", 0.0, 100.0, 0.0, 0, 9),
    "nudge": ("Split Nudge", "Nudge", -4.0, 4.0, 0.0, 0, 9),
    "spin": ("Split Spin", "Spin", -50.0, 50.0, 0.0, 0, 9),
    "bend": ("Split Bend", "Bend", -100.0, 100.0, 0.0, 0, 9),
    "pinch": ("Split Pinch", "Pinch", -100.0, 100.0, 0.0, 0, 9),
    "limthr": ("Limiter Threshold", "Lim Thr", -120.0, 12.0, 0.0, 0, 9),
    "mix": ("Mix", "Mix", 0.0, 100.0, 100.0, 0, 9),
}
NUM_UNITS = {"splits": "%.2f", "xfade": "%.2f %", "nudge": "%.2f", "spin": "%.1f %", "bend": "%.0f %", "pinch": "%.0f %",
             "limthr": "%.1f dB", "mix": "%.0f %"}
NUM_EXPONENT = {"splits": 3.0}
NUM_HELP = {
    "splits": "Frequency Splits: the number of splits (1.00 to 1024.00, fractional) across the whole spectrum; the regions between them are dealt to the four channels in rotation. A fractional count grows the newest split in smoothly at the Split Insertion Direction.",
    "xfade": "Crossfade Amount: the overlap of the individual splits. 0 % cuts the spectrum into isolated bins, above that adjacent regions crossfade (100 % overlaps their full half widths). The four channels always sum to the input.",
    "nudge": "Split Nudge (+-4.00, wrapping): shifts the channel assignment. +2.00 moves channel 1's contents to channel 3 and channel 4's to channel 2. Fractional values crossfade between adjacent channels.",
    "spin": "Split Spin (+-50 %, wrapping): offsets the split pattern against the whole spectrum; what leaves one end wraps around to the other.",
    "bend": "Split Bend (+-100 %): sets the centre frequency of the split pattern (the white dot's x) and bends the pattern around it. Negative values pack the splits low, positive values high.",
    "pinch": "Split Pinch (+-100 %): pinches the split pattern toward the middle (positive, the white dot's y up) or toward the edges (negative).",
    "limthr": "Spectral Limiter Threshold (-120 to +12 dB): with the Spectral Limiter on, no frequency bin of this channel's output gets louder than this level (applied after the channel's mask).",
    "mix": "Mix: amount of processed signal against the dry signal entering the device. In a Rack each chain adds a quarter of the dry signal, so the Rack sum is the Mix of processed and dry (the dry share passes through each chain's devices). Output All is a normal dry/wet.",
}
# key: (long name, short name, values, initial)
ENUM = {
    "dir": ("Split Insertion Direction", "Insert", ["High", "Mid", "Low"], 0),
    "limon": ("Spectral Limiter", "Limiter", ["Off", "On"], 0),
    "size": ("Size", "Size", ["1k", "2k", "4k"], 2),
    "output": ("Output", "Output", ["Auto", "Ch 1", "Ch 2", "Ch 3", "Ch 4", "All"], 0),
    "dispost": ("Spectrum Display", "Display", ["Pre", "Post"], 0),
}
ENUM_HELP = {
    "dir": "Split Insertion Direction: where new splits are inserted in the spectrum: High (arrow <-, at the right / high end), Mid (arrow <->, in the middle) or Low (arrow ->, at the left / low end).",
    "limon": "Spectral Limiter: caps the magnitude of every frequency bin of the output at the Limiter Threshold, applied after the channel masks. Bins below it are unaffected. This is the one control that breaks the exact sum of the channels.",
    "size": "Analysis block size: larger blocks resolve narrow splits more sharply at low frequencies. The latency stays 5120 samples at every size.",
    "output": "Output: Auto uses this chain's index in the parent Rack (1 red, 2 blue, 3 yellow, 4 magenta; outside a Rack the sum of all), or pick a channel, or All.",
    "dispost": "Spectrum Display: Pre shows the analysis data (good for tweaking the splits), Post shows the channel output after the masks and the limiter.",
}
# key: (gen message, scale)
GEN_MSG = {
    "splits": ("nsplit", 1.0),
    "dir": ("sdir", 1.0),
    "xfade": ("xfadeamt", 0.01),
    "nudge": ("nudgeamt", 1.0),
    "spin": ("spinamt", 0.01),
    "bend": ("bendamt", 0.01),
    "pinch": ("pinchamt", 0.01),
    "limon": ("limon", 1.0),
    "limthr": ("limdb", 1.0),
    "mix": ("mixamt", 0.01),
    "size": ("fftn", None),
    "output": (None, 1.0),
    "dispost": (None, 1.0),
}
LINKED = ["splits", "dir", "xfade", "nudge", "spin", "bend", "pinch", "limon", "limthr", "mix", "size"]
CANVAS_KEYS = ["bend", "pinch", "limthr", "spin"]     # edited from the canvas -> route -> control
UI_KEYS = ["splits", "dir", "xfade", "nudge", "spin", "bend", "pinch", "limon", "limthr", "mix", "size", "output", "dispost"]


def make_toggle(key, x, y, w, h, text):
    """Spectral Limiter: a live.text toggle (Off / On parameter), Live theme colours (outlined off, orange on)."""
    t = sc.make_tab(key, ENUM[key], ENUM_HELP[key], x, y, w, h, sc.ORANGE)
    b = t["box"]
    for k in ("num_lines_patching", "num_lines_presentation", "bgoncolor", "textoncolor", "textcolor", "activebgcolor",
              "activebgoncolor", "activetextcolor", "activetextoncolor", "bordercolor", "bgcolor", "activeslidercolor"):
        b.pop(k, None)
    b.update({"maxclass": "live.text", "mode": 1, "numoutlets": 2, "outlettype": ["", ""], "text": text, "texton": text,
              "fontface": 0, "fontname": sc.THEME_FONT, "fontsize": sc.THEME_FONT_SIZE})
    return sc.theme(t, bgcolor="live_control_bg", activebgcolor="live_control_bg", bgoncolor="live_control_selection",
                    activebgoncolor="live_control_selection", textcolor="live_control_fg", activetextcolor="live_control_fg",
                    textoncolor="live_lcd_bg", activetextoncolor="live_lcd_bg", bordercolor="live_desktop")


def make_dial(key, x, y, w, h):
    """Mix: a native live.dial with no colour attributes besides the label (Live paints the orange arc in the current theme)."""
    valueof = sc.num_valueof(NUM[key])
    valueof["parameter_units"] = NUM_UNITS[key]
    valueof["parameter_unitstyle"] = 9
    return sc.theme({"box": {
        "annotation": NUM_HELP[key], "annotation_name": NUM[key][0],
        "fontface": 0, "fontname": sc.THEME_FONT, "fontsize": sc.THEME_FONT_SIZE,
        "id": f"obj-ctrl-{key}", "maxclass": "live.dial", "numinlets": 1, "numoutlets": 2, "outlettype": ["", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 300.0, float(w), float(h)],
        "presentation": 1, "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": valueof},
        "showname": 1, "shownumber": 1, "varname": NUM[key][0],
    }}, textcolor="live_control_fg")


def lcd_numbox(key, x, y, w, h=15.0):
    box = sc.make_lcd_numbox(key, NUM[key], NUM_HELP[key], x, y, w, h, unit_text=NUM_UNITS[key])
    if key in NUM_EXPONENT:
        box["box"]["saved_attribute_attributes"]["valueof"]["parameter_exponent"] = NUM_EXPONENT[key]
    return box


def gen_code():
    """The gen code of the device (what the face writes to the .gendsp file)."""
    subs = sc.rack_subs(4, "fsd", 5, SC_FRAME, ZERO_COUNT, midfn="ss_mida")
    return sc.gen_code_rack(os.path.join(SRC, "freqsplit_core.genexpr"), subs, libs=[os.path.join(SRC, "spectral_split_mida.genexpr")])


def face_code(gen):
    """The v8ui script: deferred-DSP constants, config, link, theme, deferred DSP, face."""
    header, _ = sc.deferred_header("freqsplit", gen)
    return (header + "\n"
            + sc.read(os.path.join(SRC, "freqsplit_config.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_link.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_theme.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "spectral_dsp.js")).rstrip() + "\n\n"
            + sc.read(os.path.join(SRC, "freqsplit_ui.js")))


def build_patcher():
    gen = gen_code()
    face = face_code(gen)
    top = (sc.read(os.path.join(SRC, "spectral_theme.js")).rstrip() + "\n\n"
           + sc.read(os.path.join(SRC, "freqsplit_top_ui.js")))

    boxes = []
    lines = []

    # ---- Reverb-style titled sections, theme-bound native live.* controls ----
    # Splits section (x = 4..340): header row (y = 20), display canvas (y = 36), value row (y = 142)
    boxes.append(sc.make_theme_comment("obj-lbl-splits", "Splits", 8, 21, 34))
    boxes.append(lcd_numbox("splits", 42, 20, 50))
    boxes.append(sc.make_theme_comment("obj-lbl-insert", "Insert", 98, 21, 34))
    boxes.append(sc.make_theme_comment("obj-lbl-xfade", "XFade", 226, 21, 38))
    boxes.append(lcd_numbox("xfade", 266, 20, 68))
    # direction tab: a real automatable parameter, kept off the face (the header v8ui draws the arrows and drives it)
    dirbox = sc.make_tab("dir", ENUM["dir"], ENUM_HELP["dir"], 0, 0, 90, 15, ORG)
    dirbox["box"]["presentation"] = 0
    dirbox["box"].pop("presentation_rect", None)
    boxes.append(dirbox)
    row = [("nudge", "Nudge", 8, 36, 44, 38), ("spin", "Spin", 94, 28, 122, 50), ("bend", "Bend", 176, 30, 206, 38),
           ("pinch", "Pinch", 250, 34, 284, 48)]
    for key, text, lx, lw, nx, nw in row:
        boxes.append(sc.make_theme_comment(f"obj-lbl-{key}", text, lx, 144, lw))
        boxes.append(lcd_numbox(key, nx, 143, nw))

    # right column (x = 344..476)
    RX, CX, CW = 350, 404, 68
    boxes.append(sc.make_theme_comment("obj-lbl-dispost", "Display", RX, 21, 50))
    boxes.append(sc.make_theme_tab("dispost", ENUM["dispost"], ENUM_HELP["dispost"], CX, 20, CW, 15))
    boxes.append(make_toggle("limon", RX, 39, 50, 15, "Limiter"))
    boxes.append(lcd_numbox("limthr", CX, 39, CW))
    boxes.append(sc.make_theme_comment("obj-lbl-output", "Output", RX, 80, 50))
    boxes.append(sc.make_theme_menu("output", ENUM["output"], ENUM_HELP["output"], CX, 79, CW, 15))
    boxes.append(sc.make_theme_comment("obj-lbl-size", "Size", RX, 98, 50))
    boxes.append(sc.make_theme_tab("size", ENUM["size"], ENUM_HELP["size"], CX, 97, CW, 15))
    boxes.append(make_dial("mix", RX, 116, 52, 46))
    boxes.append(sc.make_theme_comment("obj-leg-lat", f"Lat {LATENCY} smp", 410, 134, 64, 14, size=8.5, name="live_display_scale_text"))

    p_spl, parts_spl = sc.make_section("spl", 4, 4, 336, 161, "Splits")
    p_spc, parts_spc = sc.make_section("spc", 344, 4, 132, 54, "Spectrum")
    p_out, parts_out = sc.make_section("out", 344, 62, 132, 103, "Output")
    for parts in (parts_spl, parts_spc, parts_out):
        boxes += parts

    # ---- displays (the only v8uis) ----
    boxes.append(sc.v8ui("obj-viz-top", top, [134.0, 20.0, 84.0, 15.0], (20.0, 40.0), 1, "FreqsplitTop"))
    boxes.append(sc.v8ui("obj-viz", face, [8.0, 38.0, 328.0, 100.0], (20.0, 80.0), 3, "FreqsplitView"))

    # ---- audio ----
    # The device ships WITHOUT its gen~ (AGENTS.md 1d): plugin~ / plugout~ and the hub carry scripting names, the face creates the gen~ after
    # load and wires hub -> gen, plugin~ -> gen -> plugout~ (src/spectral_dsp.js). Every cord that goes to the gen's inlet 0 goes into the hub.
    def named(b, var):
        b["box"]["varname"] = var
        return b

    boxes += [
        named(newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "ss_plugin"),
        named(newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "ss_plugout"),
        named(newobj("obj-genin", "gate 1 1", 120, 280, 60, numinlets=2, numoutlets=1), "ss_genin"),
        # `---` is unique per device instance in M4L (`#0` is not expanded in a top-level device in Live)
        newobj("obj-scope-buf", "buffer~ ---freqsplitscope @samps 704", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-ring-buf", f"buffer~ ---ssring @samps {RING_SAMPS}", 560, 275, 280, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 305, 60, outlettype=["bang"]),
        message("obj-msg-ui-names", "setnames ---freqsplitscope ---ssring", 560, 335, 250),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init", "init_link", 780, 430, 70),
        newobj("obj-r-sstest", "r #0-sstest", 780, 460, 90, numinlets=0, numoutlets=1),   # test hook (scripts/test_spectral_sum_live.js)
    ]
    lines += [
        line("obj-loadbang", 0, "obj-msg-ui-names"), line("obj-msg-ui-names", 0, "obj-viz"),
        line("obj-thisdevice", 0, "obj-msg-init"), line("obj-msg-init", 0, "obj-viz"),
        line("obj-r-sstest", 0, "obj-viz"),
    ]

    # ---- parameter wiring: control -> gen, control -> face ----
    gen_head = {}
    for n, key in enumerate(UI_KEYS):
        msg, scale = GEN_MSG[key]
        expr = "expr 1024 * pow(2\\, $f1)" if key == "size" else None
        gen_head[key] = sc.wire_param(boxes, lines, key, msg, scale or 1.0, f"set_{key}", y=600.0 + n * 26.0, size_expr=expr)

    # header strip: the direction arrows drive the Insert tab, and follow it (the control echo and rack peers)
    lines.append(line("obj-viz-top", 0, "obj-ctrl-dir"))
    boxes.append(newobj("obj-top-prep-dir", "prepend set_dir", 900, 20.0, 120))
    lines.append(line("obj-ctrl-dir", 0, "obj-top-prep-dir"))
    lines.append(line("obj-top-prep-dir", 0, "obj-viz-top"))

    # canvas edits -> route -> control (the control then drives gen and the face as usual)
    boxes.append(newobj("obj-route-canvas", "route " + " ".join(CANVAS_KEYS), 20, 560, 240, numoutlets=len(CANVAS_KEYS) + 1))
    lines.append(line("obj-viz", 0, "obj-route-canvas"))
    for i, key in enumerate(CANVAS_KEYS):
        lines.append(line("obj-route-canvas", i, f"obj-ctrl-{key}"))

    # rack peer values -> route -> `prepend set` (silent) into the control + into the same gen path the control uses
    boxes.append(newobj("obj-route-link", "route " + " ".join(LINKED), 20, 590, 320, numoutlets=len(LINKED) + 1))
    lines.append(line("obj-viz", 1, "obj-route-link"))
    for i, key in enumerate(LINKED):
        lset = f"obj-lset-{key}"
        boxes.append(newobj(lset, "prepend set", 300 + i * 20, 700, 80))
        lines.append(line("obj-route-link", i, lset))
        lines.append(line(lset, 0, f"obj-ctrl-{key}"))
        lines.append(line("obj-route-link", i, gen_head[key]))
        if key == "dir":
            lines.append(line("obj-route-link", i, "obj-top-prep-dir"))

    # gen-bound messages of the face (outsel, buffer names, rack role, parameter re-sends) -> hub
    lines.append(line("obj-viz", 2, "obj-gen", 0))
    sc.to_gen_hub(lines, "obj-genin", "obj-gen")

    # ---- background panels last: section panels, then the body (Max draws earlier boxes over later ones) ----
    boxes += [p_spl, p_spc, p_out, sc.make_body_panel(WIDTH)]

    return sc.patcher(
        boxes, lines, WIDTH,
        "Spectral sorter: divides the signal into up to 1024 frequency groups and deals them to four channels; use one instance per chain of an Audio Effect Rack",
        "Freq Split: Bitwig Freq Split (Spectral) style frequency sorter with linked rack instances",
        "frequency split spectral rack stft", LATENCY)


def main():
    doc = build_patcher()
    sc.write_amxd(doc, OUT_AMXD)
    subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make_spectral_rack.py"), "--amxd", OUT_AMXD,
                    "--name", "Freq Split", "--chains", "Red,Blue,Yellow,Magenta", "--out", OUT_ADG], check=True)


if __name__ == "__main__":
    main()
