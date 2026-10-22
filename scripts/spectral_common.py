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

Ableton-native theme builders (no hard colours; see src/spectral_theme.js and the style guide). Every colour attribute is bound
to a Live theme colour (`saved_attribute_attributes: {attr: {"expression": "themecolor.<name>"}}`) next to a static fallback taken
from LIVE_THEME (Live 12 default dark, measured), so the device follows Live's theme and hue while node tests and
scripts/render_preview.py see the same colours:
  sc.theme(box, attr=name, ...)                 bind attributes to theme colours (static fallback written too)
  sc.make_theme_panel(id, x, y, w, h, name)     flat background panel (varname = id: the face recolours it, spt_apply_panel_theme)
  sc.make_section(id, x, y, w, h, title)        -> (panel box, [title live.comment, hairline live.line]); append the panel at the END
                                                of `boxes` (after all other section panels, before the body panel), the rest anywhere
  sc.make_body_panel(width)                     device body (live_desktop); the very last box
  sc.make_theme_line(id, x, y, w)               2 px live.line hairline (live_lcd_frame)
  sc.make_theme_comment(id, text, x, y, w, ...) live.comment in a theme text colour (default live_control_fg)
  sc.make_lcd_numbox(key, spec, help, x, y, w, h)   borderless LCD numbox (appearance 4), value in live_lcd_control_fg_alt
  sc.make_theme_text / make_theme_menu / make_theme_tab   native live.text / live.menu / live.tab in theme colours
  sc.PANELS_THEME(...)                          the [[scripting name, theme name], ...] list a face feeds to sptApplyPanelTheme
"""

import json
import os
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
    return make_theme_panel("obj-panel-body", 0, 0, width, DEVICE_H, "live_desktop", rounded=0)


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
    """Reverb-style section: flat live_surface_bg panel with a small title top-left and a hairline running from the title to the
    right edge. Returns (panel box, [title comment, hairline])."""
    tw = title_w if title_w is not None else len(title) * 5.3 + 4
    panel = make_theme_panel(f"obj-panel-{obj_id}", x, y, w, h, "live_surface_bg")
    parts = [make_theme_comment(f"obj-title-{obj_id}", title, x + 4, y + 2, tw, 13.0, name="live_lcd_title"),
             make_theme_line(f"obj-rule-{obj_id}", x + 4 + tw + 3, y + 9, w - tw - 14)]
    return panel, parts


def make_lcd_numbox(key, spec, help_text, x, y, w, h, fontsize=THEME_FONT_SIZE, unit_text=None):
    """Borderless LCD-style value (appearance 4), drawn in the LCD value colour like Reverb's Amount / Rate values."""
    b = make_numbox(key, spec, help_text, x, y, w, h, LIVE_THEME["live_lcd_control_fg_alt"], appearance=4, fontsize=fontsize,
                    unit_text=unit_text)
    bx = b["box"]
    for k in ("activebgcolor", "activeslidercolor", "bordercolor"):
        bx.pop(k, None)
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
                 activebgoncolor="live_control_selection", textoncolor="live_lcd_bg", bordercolor="live_surface_bg")


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
