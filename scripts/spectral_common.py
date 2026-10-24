#!/usr/bin/env python3
"""
Shared patcher helpers for the Spectral Split suite build scripts (Transient Split, Loud Split, Harmonic Split,
Freq Split). Import from a build script that lives in scripts/:

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import spectral_common as sc

Every make_* function returns a `{"box": {...}}` dict. Parameter tables use these shapes:
    NUM  key -> (long name, short name, min, max, initial, ptype, unitstyle, help)         ptype 0 Float, 1 Int (<= 255 only)
    ENUM key -> (long name, short name, [values], initial, help)
The widget id is always `obj-ctrl-<key>`.

  sc.read(path)                         text of a file
  sc.make_numbox / make_tab / make_menu live.numbox / live.tab / live.menu bound to a NUM / ENUM table
  sc.make_state_toggle                  hidden (parameter_invisible, not in presentation) live.text toggle for UI state
  sc.make_label / make_panel / newobj / message / line / v8ui / gen_box   plain boxes and patchlines
  sc.patcher(...) / write_amxd(...)     whole .amxd (audio effect, `latency` attribute, presentation height 169)
  sc.gen_code(*paths)                   concatenates gen sources (library functions first)
  sc.wire_param(...)                    the standard chain control -> [scale] -> prepend <gen msg> -> gen, and control -> prepend
                                        set_<key> -> face (see build_transplit.py for the full wiring recipe)
Rack presets (.adg) come from scripts/make_spectral_rack.py.

Rack machinery (one analysis per rack, deferred gen~; AGENTS.md section 22, reference device: Transient Split):
  sc.rack_subs(K, mask_data, mask_base, scope_base, zero_count)   placeholder values for src/spectral_split_rack_main.genexpr
  sc.gen_code_rack(core_path, subs)      cepstrum_lib + spectral_split_lib + spectral_split_rack + the core with the template expanded
  sc.expand_rack_core(core, template, subs)   the expansion itself (`//@SS_DECL`, `//@SS_MAIN`, `//@hook ctl|frame|tele`, @@KEY@@)
  sc.gendsp_json(code) / sc.deferred_header(prefix, code)   .gendsp text, and the GEN_DSP_TEXT / GEN_DSP_HASH / SS_PREFIX prelude for the face script
  sc.to_gen_hub(lines)                   retarget cords into the (not yet existing) gen's inlet 0 to the `gate 1 1` hub's data inlet
  sc.rack_ring_samps(K), sc.RACK_LATENCY the ring buffer length and the constant latency (5120) of a rack device

Ableton-native theme builders (no hard colours; see src/spectral_theme.js and the style guide). Every colour attribute is bound
to a Live theme colour (`saved_attribute_attributes: {attr: {"expression": "themecolor.<name>"}}`) next to a static fallback taken
from LIVE_THEME (Live 12 default dark, measured), so the device follows Live's theme and hue while node tests and
scripts/render_preview.py see the same colours:
  sc.theme(box, attr=name, ...)                 bind attributes to theme colours (static fallback written too)
  sc.make_theme_panel(id, x, y, w, h, name)     flat background panel (varname = id: the face recolours it, spt_apply_panel_theme)
  sc.make_section(id, x, y, w, h, title)        -> (panel box, [title live.comment, hairline live.line]); append the panel at the END
                                                of `boxes` (after all other section panels, before the body panel), the rest anywhere
  sc.make_body_panel(width)                     device body (live_surface_bg); the very last box
  sc.make_theme_line(id, x, y, w)               2 px live.line hairline (live_lcd_frame)
  sc.make_theme_comment(id, text, x, y, w, ...) live.comment in a theme text colour (default live_control_fg)
  sc.make_lcd_numbox(key, spec, help, x, y, w, h)   borderless LCD numbox (appearance 4), value in live_lcd_control_fg_alt
  sc.make_theme_text / make_theme_menu / make_theme_tab   native live.text / live.menu / live.tab in theme colours
  sc.PANELS_THEME(...)                          the [[scripting name, theme name], ...] list a face feeds to sptApplyPanelTheme
"""

import hashlib
import json
import os
import re
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEVICES_DIR = os.path.join(ROOT_DIR, "devices")
DEVICE_H = 169.0

YELLOW = (1.0, 0.80, 0.25)
BLUE = (0.32, 0.62, 1.0)
GREEN = (0.45, 0.85, 0.45)
RED = (1.0, 0.42, 0.38)
ORANGE = (1.0, 0.62, 0.25)
TURQUOISE = (0.28, 0.84, 0.78)
GREY = (0.62, 0.68, 0.74)
MAGENTA = (0.92, 0.42, 0.85)
TEXT = (0.92, 0.96, 1.0)
DIM = (0.58, 0.66, 0.74)


# Live 12.4.6 default dark theme (max.getcolor in Live). Keep in sync with SPT_FALLBACK in src/spectral_theme.js.
LIVE_THEME = {
    "live_desktop": (0.165, 0.165, 0.165, 1.0),
    "live_surface_bg": (0.212, 0.212, 0.212, 1.0),
    "live_surface_frame": (0.141, 0.141, 0.141, 1.0),
    "live_lcd_bg": (0.094, 0.094, 0.094, 1.0),
    "live_lcd_frame": (0.243, 0.243, 0.243, 1.0),
    "live_lcd_title": (0.71, 0.71, 0.71, 1.0),
    "live_lcd_control_fg": (1.0, 0.678, 0.337, 1.0),
    "live_lcd_control_fg_alt": (0.012, 0.765, 0.835, 1.0),
    "live_display_line_one": (1.0, 0.678, 0.337, 1.0),
    "live_display_line_two": (0.012, 0.765, 0.835, 1.0),
    "live_display_handle_one": (1.0, 0.678, 0.337, 1.0),
    "live_display_scale_text": (0.525, 0.525, 0.525, 1.0),
    "live_control_bg": (0.118, 0.118, 0.118, 1.0),
    "live_control_fg": (0.71, 0.71, 0.71, 1.0),
    "live_control_selection": (1.0, 0.678, 0.337, 1.0),
    "live_control_zombie": (0.459, 0.459, 0.459, 1.0),
    "live_alert": (0.906, 0.412, 0.259, 1.0),
}
THEME_FONT = "Ableton Sans Medium"
THEME_FONT_SIZE = 9.5


def theme(box, **attrs):
    """Bind colour attributes to Live theme colours (e.g. sc.theme(b, textcolor="live_control_fg")) and write the theme's
    default-dark value as the static fallback."""
    b = box["box"] if "box" in box else box
    saa = b.setdefault("saved_attribute_attributes", {})
    for attr, name in attrs.items():
        b[attr] = list(LIVE_THEME[name])
        saa[attr] = {"expression": f"themecolor.{name}"}
    return box


def PANELS_THEME(*pairs):
    return [list(p) for p in pairs]


def make_theme_panel(obj_id, x, y, w, h, name, rounded=2):
    """Flat background panel in a theme colour. Background panels must be the LAST boxes (Max draws earlier boxes over later
    ones: section panels first, the body panel last). The face recolours it from the theme (varname = id)."""
    c = list(LIVE_THEME[name])
    b = make_panel(obj_id, x, y, w, h, bg=c[:3], border=c[:3], rounded=rounded)
    bx = b["box"]
    bx["bgfillcolor"] = {"type": "color", "color": c, "angle": 270.0, "proportion": 0.39}
    bx["grad1"] = c
    bx["grad2"] = c
    bx["varname"] = obj_id
    saa = bx.setdefault("saved_attribute_attributes", {})
    saa["bgfillcolor"] = {"expression": f"themecolor.{name}"}
    return b


def make_body_panel(width):
    return make_theme_panel("obj-panel-body", 0, 0, width, DEVICE_H, "live_surface_bg", rounded=0)


def make_theme_line(obj_id, x, y, w, name="live_lcd_frame"):
    b = {
        "box": {
            "id": obj_id,
            "ignoreclick": 1,
            "justification": 1,
            "maxclass": "live.line",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 40.0, float(w), 2.0],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), 2.0],
            "varname": obj_id,
        }
    }
    return theme(b, linecolor=name)


def make_theme_comment(obj_id, text, x, y, w, h=13.0, size=THEME_FONT_SIZE, name="live_control_fg", align=0):
    b = make_label(obj_id, text, x, y, w, h, size=size, color=LIVE_THEME[name], bold=False, align=align)
    b["box"]["fontname"] = THEME_FONT
    return theme(b, textcolor=name)


def make_section(obj_id, x, y, w, h, title, title_w=None):
    """Reverb-style section: flat recessed live_desktop panel with a small title top-left and a hairline running from the title to the
    right edge. Returns (panel box, [title comment, hairline])."""
    tw = title_w if title_w is not None else len(title) * 5.3 + 4
    panel = make_theme_panel(f"obj-panel-{obj_id}", x, y, w, h, "live_desktop")
    parts = [make_theme_comment(f"obj-title-{obj_id}", title, x + 4, y + 2, tw, 13.0, name="live_lcd_title"),
             make_theme_line(f"obj-rule-{obj_id}", x + 4 + tw + 3, y + 9, w - tw - 14)]
    return panel, parts


def make_lcd_numbox(key, spec, help_text, x, y, w, h, fontsize=THEME_FONT_SIZE, unit_text=None):
    """Borderless LCD-style value (appearance 4), drawn in the LCD value colour like Reverb's Amount / Rate values."""
    b = make_numbox(key, spec, help_text, x, y, w, h, LIVE_THEME["live_lcd_control_fg_alt"], appearance=4, fontsize=fontsize,
                    unit_text=unit_text)
    bx = b["box"]
    for k in ("activeslidercolor", "bordercolor"):
        bx.pop(k, None)
    bx["activebgcolor"] = [0.0, 0.0, 0.0, 0.0]   # borderless: no background (the LCD panel behind shows through)
    bx["fontface"] = 0
    bx["fontname"] = THEME_FONT
    return theme(b, textcolor="live_lcd_control_fg_alt", lcdcolor="live_lcd_control_fg_alt")


def make_theme_menu(key, spec, help_text, x, y, w, h, fontsize=THEME_FONT_SIZE):
    b = make_menu(key, spec, help_text, x, y, w, h, LIVE_THEME["live_control_fg"], fontsize)
    bx = b["box"]
    bx["fontface"] = 0
    bx["fontname"] = THEME_FONT
    for k in ("activebgcolor", "bordercolor", "textcolor"):
        bx.pop(k, None)
    return theme(b, textcolor="live_control_fg", bgcolor="live_control_bg", activebgcolor="live_control_bg",
                 bordercolor="live_control_bg")


def make_theme_tab(key, spec, help_text, x, y, w, h, rows=1, fontsize=THEME_FONT_SIZE):
    """Horizontal live.tab: dark cells with light text, the selected cell in the orange selection colour."""
    b = make_tab(key, spec, help_text, x, y, w, h, LIVE_THEME["live_control_selection"], rows, fontsize)
    bx = b["box"]
    bx["fontface"] = 0
    bx["fontname"] = THEME_FONT
    for k in ("activebgoncolor", "bgcolor", "bgoncolor", "bordercolor", "textcolor", "textoncolor"):
        bx.pop(k, None)
    return theme(b, bgcolor="live_control_bg", textcolor="live_control_fg", bgoncolor="live_control_selection",
                 activebgoncolor="live_control_selection", textoncolor="live_lcd_bg", bordercolor="live_desktop")


def make_theme_text(obj_id, text, x, y, w, h, toggle=True):
    """Plain live.text button (no parameter): outlined when off, orange fill when on."""
    b = {
        "box": {
            "fontface": 0,
            "fontname": THEME_FONT,
            "fontsize": THEME_FONT_SIZE,
            "id": obj_id,
            "maxclass": "live.text",
            "mode": 1 if toggle else 0,
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "patching_rect": [float(x), 60.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "texton": text,
            "varname": obj_id,
        }
    }
    return theme(b, bgcolor="live_control_bg", activebgcolor="live_control_bg", bgoncolor="live_control_selection",
                 activebgoncolor="live_control_selection", textcolor="live_control_selection",
                 activetextcolor="live_control_selection", textoncolor="live_lcd_bg", activetextoncolor="live_lcd_bg",
                 bordercolor="live_control_selection")


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def gen_code(*paths):
    return "\n".join(read(p).rstrip() + "\n" for p in paths)


# ---------------------------------------------------------------------------------------------------------------------------------
# Rack machinery (one analysis per rack, leader / follower; src/spectral_split_rack*.genexpr, src/spectral_link.js, src/spectral_dsp.js)
# ---------------------------------------------------------------------------------------------------------------------------------
RACK_RING_SLOTS = 8192        # output ring length in slots (counters modulo 2^22; must be a power of two)
RACK_HDR = 16                 # header floats at the start of the ring buffer
RACK_LATENCY = 5120           # constant latency of a rack device: 4096 (largest STFT latency n - 1 + pad) + 1024 (host block margin)
RACK_VERSION = 1


def rack_subs(channels, mk_data, mk_base, scope_base, zero_count, latency=RACK_LATENCY, midfn="ss_mid"):
    """Placeholder values for src/spectral_split_rack_main.genexpr. channels = K output channels; the device keeps the final mask of channel c
    in row mk_base + c of Data mk_data (c = 0..K-1) and the sum of all channels in row mk_base + K; scope_base = first scope slot of the 18
    common scalars (frame counter, sample rate, N, awake, input peak, -, latency, output selection, ... alive counter at +17).
    midfn = the Mid analysis function: "ss_mid" (amplitude and phase) or "ss_mida" (amplitude only, src/spectral_split_mida.genexpr must be in the
    device's libs: saves one atan2 per bin and hop for devices that never read the phase). SS_NO_DERIVE=1 in the environment builds without the
    derived last channel and SS_NO_MIDA=1 without the amplitude-only Mid analysis (measurement only: scripts/measure_spectral.py derive)."""
    k = int(channels)
    return {
        "K": k, "ACCROWS": 2 * (k + 1), "STRIDE": 1 + 2 * (k + 1), "RS": RACK_RING_SLOTS, "HDR": RACK_HDR, "LAT": int(latency),
        "LAT1": int(latency) + 1, "GAPHEAD": 129, "SERVEMAX": (1 << (k + 1)) - 1, "KSHARE": repr(1.0 / k), "MKD": mk_data, "MKB": int(mk_base),
        "SCB": int(scope_base), "VERSION": RACK_VERSION, "ZEROCNT": int(zero_count),
        "DERIVE": 0 if os.environ.get("SS_NO_DERIVE") == "1" else 1, "MIDFN": "ss_mid" if os.environ.get("SS_NO_MIDA") == "1" else midfn,
    }


def rack_ring_samps(channels):
    return RACK_HDR + RACK_RING_SLOTS * (1 + 2 * (int(channels) + 1))


def expand_rack_core(core_text, template_text, subs):
    """Expand a device core written for the rack machinery: `//@SS_DECL` / `//@SS_MAIN` receive the template's `decl` / `main` sections, the
    core's `//@hook <name>` ... `//@endhook` blocks (ctl, frame, tele) replace the template's `//@hook <name>` marker lines (indentation of
    the marker), and every @@KEY@@ is substituted from `subs`. The result is plain GenExpr for gen.codebox~."""
    hooks, cur, kept = {}, None, []
    for line in core_text.split("\n"):
        m = re.match(r"\s*//@hook (\w+)\s*$", line)
        if m:
            cur = m.group(1)
            hooks[cur] = []
            continue
        if re.match(r"\s*//@endhook\s*$", line):
            cur = None
            continue
        if cur is not None:
            if line.strip():
                hooks[cur].append(line.strip())
            continue
        kept.append(line)
    core = "\n".join(kept)
    sections = {}
    for m in re.finditer(r"^//@@SECTION (\w+)\n(.*?)(?=^//@@SECTION |\Z)", template_text, re.S | re.M):
        sections[m.group(1)] = m.group(2).rstrip() + "\n"
    main = sections["main"]

    def put(m):
        ind, name = m.group(1), m.group(2)
        body = hooks.get(name)
        if body is None:
            raise SystemExit(f"core has no `//@hook {name}` block")
        return "\n".join(ind + b for b in body)

    main = re.sub(r"^([ \t]*)//@hook (\w+)[ \t]*$", put, main, flags=re.M)
    if "//@SS_DECL" not in core or "//@SS_MAIN" not in core:
        raise SystemExit("core needs //@SS_DECL and //@SS_MAIN markers")
    core = core.replace("//@SS_DECL", sections["decl"].rstrip()).replace("//@SS_MAIN", main.rstrip())
    for k, v in subs.items():
        core = core.replace(f"@@{k}@@", str(v))
    left = re.findall(r"@@\w+@@", core)
    if left:
        raise SystemExit(f"unexpanded placeholders: {sorted(set(left))}")
    return core


def gen_code_rack(core_path, subs, libs=()):
    """cepstrum_lib + spectral_split_lib + spectral_split_rack (functions) + the expanded core. `libs` = extra gen sources between the shared
    libraries and the core (a device's own helper functions)."""
    src = os.path.join(ROOT_DIR, "src")
    parts = [read(os.path.join(src, "cepstrum_lib.genexpr")), read(os.path.join(src, "spectral_split_lib.genexpr")),
             read(os.path.join(src, "spectral_split_rack.genexpr"))] + [read(p) for p in libs]
    core = expand_rack_core(read(core_path), read(os.path.join(src, "spectral_split_rack_main.genexpr")), subs)
    return "\n".join(p.rstrip() + "\n" for p in parts + [core])


def gendsp_json(gen_code):
    """The gen patcher (in 1 / in 2 -> codebox -> out 1 / out 2) as .gendsp JSON text (the deferred DSP writes it to a file and creates
    `gen~ @gen <file>`; same as scripts/build_reverbplus.py and AGENTS.md 1d)."""
    def b(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {"id": i, "maxclass": cls, "numinlets": ni, "numoutlets": no, "outlettype": [""] * no,
               "patching_rect": [float(x), float(y), 200.0, 22.0]}
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}
    patch = {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "dsp.gen",
        "rect": [50.0, 50.0, 600.0, 450.0],
        "boxes": [
            b("obj-in1", "in 1", 20, 20, 0, 1), b("obj-in2", "in 2", 120, 20, 0, 1),
            b("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
            b("obj-out1", "out 1", 20, 400, 1, 0), b("obj-out2", "out 2", 120, 400, 1, 0),
        ],
        "lines": [
            {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-code", 0]}},
            {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-code", 1]}},
            {"patchline": {"source": ["obj-code", 0], "destination": ["obj-out1", 0]}},
            {"patchline": {"source": ["obj-code", 1], "destination": ["obj-out2", 0]}},
        ],
    }}
    return json.dumps(patch)


def deferred_header(prefix, gen_code):
    """JS prelude for the face script of a deferred-DSP device (src/spectral_dsp.js): the embedded .gendsp text, its hash and the device prefix."""
    text = gendsp_json(gen_code)
    h = hashlib.sha1(text.encode()).hexdigest()[:12]
    return (f"var GEN_DSP_TEXT = {json.dumps(text)};\nvar GEN_DSP_HASH = \"{h}\";\nvar SS_PREFIX = {json.dumps(prefix)};\n", h)


def to_gen_hub(lines, hub_id="obj-genin", gen_id="obj-gen"):
    """Cords into the deferred gen's inlet 0 go into the hub's data (right) inlet instead (`gate 1 1`, AGENTS.md 1d)."""
    for ln in lines:
        pl = ln["patchline"]
        if pl["destination"][0] == gen_id:
            assert pl["destination"][1] == 0, "only gen inlet 0 takes messages"
            pl["destination"] = [hub_id, 1]
        assert pl["source"][0] != gen_id, "nothing reads the deferred gen's outlets but plugout~"
    return lines


def num_valueof(spec):
    long_name, short, lo, hi, initial, ptype, unit = spec[:7]
    return {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": ptype,
        "parameter_unitstyle": unit,
    }


def enum_valueof(spec):
    long_name, short, values, initial = spec[:4]
    return {
        "parameter_annotation_name": long_name,
        "parameter_enum": list(values),
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": len(values) - 1,
        "parameter_shortname": short,
        "parameter_type": 2,
        "parameter_unitstyle": 9,
    }


def make_numbox(key, spec, help_text, x, y, w, h, color, appearance=2, fontsize=8.5, unit_text=None):
    """Value bar. appearance 2 fills from the left, 3 from the centre (bipolar). Live ignores alpha in
    activeslidercolor, so the fill is pre-blended (38% accent over the dark background)."""
    bg = [0.06, 0.075, 0.095, 1.0]
    bar = [round(bg[i] * 0.62 + color[i] * 0.38, 4) for i in range(3)] + [1.0]
    valueof = num_valueof(spec)
    if unit_text:
        valueof["parameter_units"] = unit_text
        valueof["parameter_unitstyle"] = 9
    return {
        "box": {
            "activebgcolor": bg,
            "activeslidercolor": bar,
            "annotation": help_text,
            "annotation_name": spec[0],
            "appearance": int(appearance),
            "bordercolor": [0.22, 0.27, 0.33, 1.0],
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 275.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof},
            "textcolor": [color[0], color[1], color[2], 1.0],
            "varname": spec[0],
        }
    }


def make_tab(key, spec, help_text, x, y, w, h, color, rows=1, fontsize=8.0):
    return {
        "box": {
            "activebgoncolor": [color[0], color[1], color[2], 1.0],
            "annotation": help_text,
            "annotation_name": spec[0],
            "bgcolor": [0.07, 0.09, 0.12, 1.0],
            "bgoncolor": [color[0] * 0.45, color[1] * 0.45, color[2] * 0.45, 1.0],
            "bordercolor": [0.22, 0.28, 0.35, 1.0],
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.tab",
            "num_lines_patching": int(rows),
            "num_lines_presentation": int(rows),
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 160.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": enum_valueof(spec)},
            "textcolor": [0.68, 0.76, 0.84, 1.0],
            "textoncolor": [0.98, 1.0, 1.0, 1.0],
            "varname": spec[0],
        }
    }


def make_menu(key, spec, help_text, x, y, w, h, color, fontsize=8.5):
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": help_text,
            "annotation_name": spec[0],
            "bordercolor": [color[0], color[1], color[2], 0.8],
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.menu",
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["", "", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 190.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": enum_valueof(spec)},
            "textcolor": [color[0], color[1], color[2], 1.0],
            "varname": spec[0],
        }
    }


def make_state_toggle(key, long_name, short, enum, patch_y):
    """Stored UI state (not automatable, not in presentation): Toggle mode, a v8ui is its face."""
    return {
        "box": {
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.text",
            "mode": 1,
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [880.0, float(patch_y), 60.0, 15.0],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_enum": list(enum),
                    "parameter_initial": [0],
                    "parameter_initial_enable": 1,
                    "parameter_invisible": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": long_name,
                    "parameter_mmax": 1,
                    "parameter_shortname": short,
                    "parameter_type": 2,
                }
            },
            "text": short,
            "texton": short,
            "varname": long_name,
        }
    }


def make_label(obj_id, text, x, y, w, h=13.0, size=8.0, color=DIM, bold=True, align=0):
    return {
        "box": {
            "fontface": 1 if bold else 0,
            "fontname": "Arial Bold" if bold else "Arial",
            "fontsize": float(size),
            "id": obj_id,
            "maxclass": "live.comment",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 15.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "textcolor": [color[0], color[1], color[2], 1.0],
            "textjustification": align,
        }
    }


def make_panel(obj_id, x, y, w, h, bg=(0.10, 0.11, 0.13), border=(0.22, 0.26, 0.32), rounded=6):
    return {
        "box": {
            "angle": 270.0,
            "background": 1,
            "bgcolor": [bg[0], bg[1], bg[2], 1.0],
            "border": 1,
            "bordercolor": [border[0], border[1], border[2], 1.0],
            "grad1": [bg[0], bg[1], bg[2], 1.0],
            "grad2": [bg[0] * 0.85, bg[1] * 0.85, bg[2] * 0.85, 1.0],
            "id": obj_id,
            "maxclass": "panel",
            "mode": 0,
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 10.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "proportion": 0.39,
            "rounded": rounded,
        }
    }


def newobj(obj_id, text, x, y, w, numinlets=1, numoutlets=1, outlettype=None):
    return {
        "box": {
            "fontname": "Arial Bold",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "newobj",
            "numinlets": numinlets,
            "numoutlets": numoutlets,
            "outlettype": outlettype if outlettype is not None else [""] * numoutlets,
            "patching_rect": [float(x), float(y), float(w), 20.0],
            "text": text,
        }
    }


def message(obj_id, text, x, y, w):
    b = newobj(obj_id, text, x, y, w)
    b["box"]["maxclass"] = "message"
    b["box"]["numinlets"] = 2
    return b


def line(src, outlet, dst, inlet=0):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def v8ui(obj_id, code, rect, patch_xy, numoutlets, varname=None):
    box = {
        "border": 0,
        "filename": "none",
        "id": obj_id,
        "maxclass": "v8ui",
        "numinlets": 1,
        "numoutlets": numoutlets,
        "outlettype": [""] * numoutlets,
        "patching_rect": [float(patch_xy[0]), float(patch_xy[1]), float(rect[2]), float(rect[3])],
        "presentation": 1,
        "presentation_rect": [float(v) for v in rect],
        "textfile": {"text": code, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
    }
    if varname:
        box["varname"] = varname
    return {"box": box}


def gen_box(obj_id, code, varname, x=120.0, y=300.0, numinlets=2, numoutlets=2):
    return {
        "box": {
            "code": code,
            "fontname": "<Monospaced>",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "gen.codebox~",
            "numinlets": numinlets,
            "numoutlets": numoutlets,
            "outlettype": ["signal"] * numoutlets,
            "patching_rect": [float(x), float(y), 420.0, 140.0],
            "varname": varname,
        }
    }


def wire_param(boxes, lines, key, gen_msg, scale, ui_msg, gen_id="obj-gen", face_id="obj-viz", y=560.0, size_expr=None):
    """control -> [scale / size expr] -> prepend <gen_msg> -> gen ; control -> prepend <ui_msg> -> face.
    Returns the id of the first object of the gen path, so other sources (a rack peer's value) can feed it too."""
    ctrl = f"obj-ctrl-{key}"
    first = None
    if gen_msg:
        prep = f"obj-prep-{key}"
        src = ctrl
        if size_expr:
            ex = f"obj-expr-{key}"
            boxes.append(newobj(ex, size_expr, 360, y, 150, outlettype=["float"]))
            lines.append(line(ctrl, 0, ex))
            src = ex
            first = ex
        elif abs(scale - 1.0) > 1e-9:
            sid = f"obj-scale-{key}"
            boxes.append(newobj(sid, f"* {scale}", 360, y, 56, numinlets=2, outlettype=["float"]))
            lines.append(line(ctrl, 0, sid))
            src = sid
            first = sid
        boxes.append(newobj(prep, f"prepend {gen_msg}", 520, y, 110))
        lines.append(line(src, 0, prep))
        lines.append(line(prep, 0, gen_id))
        if first is None:
            first = prep
        # the object that receives a rack peer's value must be the one that ends in the gen path
        # (a value from `route` is already the control's own unit, so it enters at `first`)
    uip = f"obj-ui-{key}"
    boxes.append(newobj(uip, f"prepend {ui_msg}", 650, y, 120))
    lines.append(line(ctrl, 0, uip))
    lines.append(line(uip, 0, face_id))
    return first


def patcher(boxes, lines, width, description, digest, tags, latency, dev_type="aaaa"):
    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, float(width), DEVICE_H],
            "openrect": [0.0, 0.0, float(width), DEVICE_H],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial Bold",
            "gridonopen": 1,
            "gridsize": [8.0, 8.0],
            "gridsnaponopen": 1,
            "objectsnaponopen": 1,
            "statusbarvisible": 2,
            "toolbarvisible": 1,
            "devicewidth": float(width),
            "latency": int(latency),
            "description": description,
            "digest": digest,
            "tags": tags,
            "style": "",
            "subpatcher_template": "",
            "boxes": boxes,
            "lines": lines,
            "parameters": {},
            "dependency_cache": [],
            "autosave": 0,
        }
    }


def write_amxd(patcher_doc, out_path, dev_type=b"aaaa"):
    import theme_common as tc
    tc.inject_theme_support(patcher_doc, os.path.splitext(os.path.basename(out_path))[0])
    payload = (json.dumps(patcher_doc, indent="\t") + "\n").encode("utf-8")
    header = (
        b"ampf" + struct.pack("<I", 4) + dev_type + b"meta" + struct.pack("<I", 4) + struct.pack("<I", 0)
        + b"ptch" + struct.pack("<I", len(payload))
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(header + payload)
    w = int(patcher_doc["patcher"]["openrect"][2])
    print(f"Built {out_path} [{w}x169 px] ({len(header) + len(payload)} bytes)")
