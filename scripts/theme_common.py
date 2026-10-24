#!/usr/bin/env python3
"""
Shared build-time theme helper (`scripts/theme_common.py`).

Injects `src/theme_engine.js`, `M4L_DEVICE_SLUG`, `M4L_PATCHER_THEME_MAP`, and the `m4lWrapPaint`
hook into a Max for Live patcher dictionary or individual `v8ui` script string.
"""

import json
import os
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_ENGINE_PATH = os.path.join(ROOT_DIR, "src", "theme_engine.js")

COLOR_ATTRS = (
    "bgcolor",
    "bordercolor",
    "activedialcolor",
    "dialcolor",
    "textcolor",
    "activetextcolor",
    "textoncolor",
    "activebgcolor",
    "activeslidercolor",
    "slidercolor",
    "lcdcolor",
    "bgoncolor",
    "activebgoncolor",
    "linecolor",
    "tribordercolor",
    "activetricolor2",
    "tricolor",
)

THEMABLE_CLASSES = (
    "panel",
    "live.dial",
    "live.numbox",
    "live.tab",
    "live.menu",
    "live.text",
    "live.comment",
    "live.line",
    "live.scope~",
)


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_") or "device"


def read_theme_engine():
    with open(THEME_ENGINE_PATH, "r", encoding="utf-8") as f:
        return f.read()


def is_rgba_list(val):
    if not isinstance(val, (list, tuple)) or len(val) not in (3, 4):
        return False
    return all(isinstance(x, (int, float)) for x in val)


def is_transparent_rgba(val):
    return len(val) == 4 and float(val[3]) == 0.0


def build_patcher_theme_map(patcher_dict, assign_varnames=True):
    """Extracts original presentation widget/panel colors keyed by scripting name (`varname`)."""
    boxes = patcher_dict.get("boxes", [])
    used_varnames = {
        b.get("box", {}).get("varname")
        for b in boxes
        if b.get("box", {}).get("varname")
    }
    theme_map = {}

    for entry in boxes:
        box = entry.get("box", {})
        mc = box.get("maxclass", "")
        if mc not in THEMABLE_CLASSES:
            continue
        if box.get("presentation") != 1 and mc != "panel":
            continue

        attrs = {}
        for attr in COLOR_ATTRS:
            val = box.get(attr)
            if is_rgba_list(val) and not is_transparent_rgba(val):
                rgba = [round(float(x), 4) for x in val[:3]] + [
                    round(float(val[3]), 4) if len(val) > 3 else 1.0
                ]
                attrs[attr] = rgba

        bgfill = box.get("bgfillcolor")
        if isinstance(bgfill, dict) and is_rgba_list(bgfill.get("color")):
            c = bgfill["color"]
            if not is_transparent_rgba(c):
                attrs["bgfillcolor"] = [round(float(x), 4) for x in c[:3]] + [
                    round(float(c[3]), 4) if len(c) > 3 else 1.0
                ]
        elif is_rgba_list(bgfill) and not is_transparent_rgba(bgfill):
            attrs["bgfillcolor"] = [round(float(x), 4) for x in bgfill[:3]] + [
                round(float(bgfill[3]), 4) if len(bgfill) > 3 else 1.0
            ]

        if not attrs:
            continue

        vn = box.get("varname")
        if not vn and assign_varnames:
            candidate = box.get("id")
            if candidate and candidate not in used_varnames:
                box["varname"] = candidate
                used_varnames.add(candidate)
                vn = candidate

        if vn:
            theme_map[vn] = {"cls": mc, "attrs": attrs}

    return theme_map


def wrap_v8ui_code(js_code, device_slug, theme_map=None, include_engine=True):
    """Prepends `M4L_DEVICE_SLUG`, `M4L_PATCHER_THEME_MAP`, and `src/theme_engine.js` (if not already present)
    and appends the `m4lWrapPaint` hook."""
    slug = slugify(device_slug)
    header_lines = [f'var M4L_DEVICE_SLUG = "{slug}";']
    if theme_map is not None:
        header_lines.append(
            "var M4L_PATCHER_THEME_MAP = "
            + json.dumps(theme_map, separators=(",", ":"))
            + ";"
        )
    if include_engine and "var M4L_THEME_BUS_NAME =" not in js_code:
        header_lines.append(read_theme_engine())

    footer = (
        "\nif (typeof paint === \"function\" && typeof m4lWrapPaint === \"function\") {\n"
        "    paint = m4lWrapPaint(paint);\n"
        "}\n"
    )
    header_block = "\n".join(header_lines) + "\n"
    gen_m = re.match(
        r'^((?:var GEN_DSP_TEXT = ".*";\nvar GEN_DSP_HASH = "[0-9a-f]+";\n)|(?:var PANEL_NAMES = \[.*\];\n\n)|(?:mgraphics\.init\(\);\nmgraphics\.relative_coords = 0;\nmgraphics\.autofill = 0;\n))',
        js_code,
    )
    if gen_m:
        prefix = gen_m.group(1)
        out = prefix + header_block + js_code[len(prefix):]
    else:
        out = header_block + js_code
    if "paint = m4lWrapPaint(paint);" not in js_code:
        out = out + footer
    return out


def inject_theme_support(patcher_dict, device_slug, assign_varnames=True):
    """Injects theme support into all `v8ui` boxes in `patcher_dict`."""
    p = patcher_dict.get("patcher", patcher_dict)
    theme_map = build_patcher_theme_map(p, assign_varnames=assign_varnames)
    first_v8ui = True
    for entry in p.get("boxes", []):
        box = entry.get("box", {})
        if box.get("maxclass") == "v8ui" and isinstance(box.get("textfile"), dict):
            txt = box["textfile"].get("text", "")
            if txt:
                box["textfile"]["text"] = wrap_v8ui_code(
                    txt,
                    device_slug,
                    theme_map=theme_map if first_v8ui else {},
                    include_engine=True,
                )
                first_v8ui = False
    return patcher_dict
