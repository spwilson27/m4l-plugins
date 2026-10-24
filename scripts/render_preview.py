#!/usr/bin/env python3
"""
Renders a 2x Retina pixel-accurate visual preview of devices/Better Shaper.amxd
by executing the embedded v8ui mgraphics paint() stream in Node.js and rendering
all Max presentation_rect UI widgets and mgraphics vector paths/text to tests/preview.png.
Also checks for any text overflow or widget overlap issues automatically.
"""

import json
import math
import os
import re
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREVIEWS_DIR = os.path.join(ROOT_DIR, "previews")
DEFAULT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Better Shaper.amxd")

SCALE = 2  # 2x Retina rendering


def slugify_device_name(amxd_path):
    base = os.path.splitext(os.path.basename(amxd_path))[0]
    slug = re.sub(r"[^a-z0-9]+", "_", base.lower()).strip("_")
    return slug or "device"


_MAX_SVG_DIRS = [
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app/Contents/Resources/C74/media/max/picts/m4l-picts",
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app/Contents/Resources/C74/interfaces",
    "/Applications/Max.app/Contents/Resources/C74/media/max/picts/m4l-picts",
    "/Applications/Max.app/Contents/Resources/C74/interfaces",
]
_SVG_CACHE = {}


def builtin_svg_mask(name, size_px):
    """Rasterize one of Live/Max's built-in SVG icons (e.g. lock.svg, piano_keys.svg) to an 'L' alpha mask
    of size_px, using macOS Quick Look. Returns None when the icon or qlmanage is unavailable."""
    key = (name, size_px)
    if key in _SVG_CACHE:
        return _SVG_CACHE[key]
    mask = None
    src = next((os.path.join(d, name) for d in _MAX_SVG_DIRS if os.path.exists(os.path.join(d, name))), None)
    if src:
        try:
            with open(src, "r", encoding="utf-8") as f:
                svg = f.read()
            head = re.search(r"<svg[^>]*>", svg).group(0)
            if "viewBox" not in head:
                dims = [re.search(a + r'="([0-9.]+)', head) for a in ("width", "height")]
                if all(dims):
                    svg = svg.replace("<svg", f'<svg viewBox="0 0 {dims[0].group(1)} {dims[1].group(1)}"', 1)
            for attr in ("width", "height"):
                svg = re.sub(r'(<svg[^>]*?)\s' + attr + r'="[^"]*"', r"\1", svg, count=1)
            big = max(128, size_px * 4)  # Quick Look renders tiny sizes poorly: rasterize large, then downsample
            svg = svg.replace("<svg", f'<svg width="{big}" height="{big}"', 1)
            with tempfile.TemporaryDirectory() as td:
                sp = os.path.join(td, name)
                with open(sp, "w", encoding="utf-8") as f:
                    f.write(svg)
                subprocess.run(["qlmanage", "-t", "-s", str(big), "-o", td, sp], capture_output=True, timeout=20)
                png = sp + ".png"
                if os.path.exists(png):
                    inv = Image.open(png).convert("L").point(lambda v: 255 - v)  # dark icon on white -> opaque mask
                    bb = inv.getbbox()
                    if bb:
                        inv = inv.crop(bb)
                        sc = size_px / max(inv.size)
                        inv = inv.resize((max(1, round(inv.size[0] * sc)), max(1, round(inv.size[1] * sc))), Image.LANCZOS)
                        mask = Image.new("L", (size_px, size_px), 0)
                        mask.paste(inv, ((size_px - inv.size[0]) // 2, (size_px - inv.size[1]) // 2))
        except Exception:
            mask = None
    _SVG_CACHE[key] = mask
    return mask


def get_font(size_px, bold=False):
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc"
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, int(round(size_px)))
            except Exception:
                pass
    return ImageFont.load_default()


def parse_theme_spec(theme_spec=None, ableton_ui_spec=None):
    raw = theme_spec if theme_spec is not None else os.environ.get("M4L_THEME", "")
    raw = str(raw or "").strip()
    ui_raw = ableton_ui_spec if ableton_ui_spec is not None else os.environ.get("M4L_ABLETON_UI", "")
    ui_raw = str(ui_raw or "").strip()

    state = None
    if raw and raw != "Default":
        if raw.startswith("{"):
            try:
                state = json.loads(raw)
            except Exception:
                state = None
        if not state:
            state = {
                "version": 1,
                "preset": raw,
                "macros": {"hueShift": 0, "satScale": 1.0, "contrast": 1.0, "brightness": 0.0},
                "tokens": {},
                "deviceOverrides": {},
                "customPresets": {},
            }

    if ui_raw:
        try:
            ui_obj = json.loads(ui_raw)
        except Exception:
            ui_obj = {"enabled": True, "theme": ui_raw}
        ui_obj["enabled"] = True
        if not state:
            state = {
                "version": 1,
                "preset": "Default",
                "macros": {"hueShift": 0, "satScale": 1.0, "contrast": 1.0, "brightness": 0.0},
                "tokens": {},
                "deviceOverrides": {},
                "customPresets": {},
            }
        state["abletonUi"] = ui_obj

    return state


def compute_ableton_ui_tokens(theme_state):
    engine_path = os.path.join(ROOT_DIR, "src", "theme_engine.js")
    ui_obj = (theme_state or {}).get("abletonUi") or {"enabled": True}
    script = f"""
const te = require({json.dumps(engine_path)});
console.log(JSON.stringify(te.m4lComputeAbletonUiTokens({json.dumps(ui_obj)})));
"""
    try:
        res = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True)
        return json.loads(res.stdout)
    except Exception:
        return {}


def wrap_in_ableton_chrome(dev_img, device_title, theme_state):
    """Wraps a rendered 2x Retina device image inside an authentic full Ableton Live 12 window
    (Top Transport Bar, Left Browser + Groove Pool, Right Arrangement View with Grid Lines & Track Headers,
    Bottom Device Tray with Device Header Bar + Device + Stereo Meter + 'Drop Audio Effects Here' zone,
    and Bottom Status / Tab Bar)."""
    toks = compute_ableton_ui_tokens(theme_state)
    desk = rgba_tuple(toks.get("live_desktop", [0.165, 0.165, 0.165, 1.0]))
    surf_bg = rgba_tuple(toks.get("live_surface_bg", [0.212, 0.212, 0.212, 1.0]))
    surf_frame = rgba_tuple(toks.get("live_surface_frame", [0.141, 0.141, 0.141, 1.0]))
    lcd_bg = rgba_tuple(toks.get("live_lcd_bg", [0.094, 0.094, 0.094, 1.0]))
    lcd_frame = rgba_tuple(toks.get("live_lcd_frame", [0.243, 0.243, 0.243, 1.0]))
    macro_title = rgba_tuple(toks.get("live_macro_title", [0.275, 0.275, 0.275, 1.0]))
    ctl_bg = rgba_tuple(toks.get("live_control_bg", [0.118, 0.118, 0.118, 1.0]))
    ctl_fg = rgba_tuple(toks.get("live_control_fg", [0.71, 0.71, 0.71, 1.0]))
    ctl_on = rgba_tuple(toks.get("live_control_selection", [1.0, 0.678, 0.337, 1.0]))
    ctl_fg_on = rgba_tuple(toks.get("live_control_fg_on", [0.027, 0.027, 0.027, 1.0]))
    zombie = rgba_tuple(toks.get("live_control_zombie", [0.459, 0.459, 0.459, 1.0]))
    scale_txt = rgba_tuple(toks.get("live_display_scale_text", [0.525, 0.525, 0.525, 1.0]))
    alt_c = rgba_tuple(toks.get("live_lcd_control_fg_alt", [0.012, 0.765, 0.835, 1.0]))

    # Selection highlight derived from surface_bg + scale_txt
    sel_bg = (
        int(min(255, surf_bg[0] * 0.55 + scale_txt[0] * 0.45 + 12)),
        int(min(255, surf_bg[1] * 0.55 + scale_txt[1] * 0.45 + 18)),
        int(min(255, surf_bg[2] * 0.55 + scale_txt[2] * 0.45 + 22)),
        255,
    )

    S = SCALE
    dev_w_pt = dev_img.width // S
    dev_h_pt = dev_img.height // S  # 169
    drop_zone_w_pt = max(92, 920 - dev_w_pt)
    win_w_pt = max(960, dev_w_pt + drop_zone_w_pt + 26)

    top_h_pt = 32
    mid_h_pt = 250
    hdr_h_pt = 20
    tray_h_pt = hdr_h_pt + dev_h_pt + 8
    bot_h_pt = 24
    win_h_pt = top_h_pt + mid_h_pt + tray_h_pt + bot_h_pt + 12

    out = Image.new("RGBA", (win_w_pt * S, win_h_pt * S), desk)
    d = ImageDraw.Draw(out)

    fnt_sm = get_font(8.0 * S, bold=False)
    fnt_md = get_font(9.0 * S, bold=False)
    fnt_bd = get_font(9.0 * S, bold=True)
    fnt_hdr = get_font(10.0 * S, bold=True)
    fnt_lg = get_font(14.0 * S, bold=False)

    def rrect(x, y, w, h, r=3, fill=None, outline=None, width=1):
        d.rounded_rectangle([x * S, y * S, (x + w) * S, (y + h) * S], radius=r * S, fill=fill, outline=outline, width=width)

    def txt(x, y, s, font=fnt_md, fill=ctl_fg):
        d.text((x * S, y * S), str(s), font=font, fill=fill)

    # -------------------------------------------------------------------------
    # 1. TOP TRANSPORT & CONTROL BAR (y = 4..32)
    # -------------------------------------------------------------------------
    ty = 6
    # Left group: orange Metronome/Layout pill, Link, Tap, Tempo 130.00, 4/4, Metronome, 1 Bar, Scale b# C Major
    rrect(6, ty, 20, 18, 2, fill=ctl_on)
    txt(11, ty + 3, "II", fnt_bd, ctl_fg_on)
    for bx, bw, blbl in [(34, 40, "Link"), (78, 30, "Tap"), (110, 44, "130.00"), (156, 22, "IIII"), (180, 32, "4 / 4"), (214, 28, "○●"), (244, 42, "1 Bar")]:
        rrect(bx, ty, bw, 18, 2, fill=surf_bg, outline=desk)
        txt(bx + 5, ty + 3, blbl, fnt_sm, ctl_fg)
    # Purple Scale button (`b#`) + `C` + `Major`
    rrect(294, ty, 20, 18, 2, fill=(168, 136, 248, 255))
    txt(297, ty + 3, "b#", fnt_bd, ctl_fg_on)
    rrect(316, ty, 32, 18, 2, fill=surf_bg, outline=desk)
    txt(321, ty + 3, "C", fnt_sm, ctl_fg)
    rrect(350, ty, 52, 18, 2, fill=surf_bg, outline=desk)
    txt(355, ty + 3, "Major", fnt_sm, ctl_fg)

    # Center transport: Position `205 . 1 . 1`, Play, Stop, Record, +, Automation Arm (orange), Loop, Punch
    rrect(424, ty, 66, 18, 2, fill=surf_bg)
    txt(430, ty + 3, "205 . 1 . 1", fnt_bd, ctl_fg)
    # Play triangle, Stop square, Record circle
    d.polygon([(502 * S, (ty + 4) * S), (502 * S, (ty + 14) * S), (511 * S, (ty + 9) * S)], fill=ctl_fg)
    d.rectangle([520 * S, (ty + 4) * S, 529 * S, (ty + 13) * S], fill=ctl_fg)
    d.ellipse([538 * S, (ty + 4) * S, 547 * S, (ty + 13) * S], fill=ctl_fg)

    rrect(558, ty, 18, 18, 2, fill=surf_bg)
    txt(563, ty + 2, "+", fnt_bd, ctl_fg)
    rrect(578, ty, 20, 18, 2, fill=ctl_on)
    txt(583, ty + 3, "o-", fnt_bd, ctl_fg_on)
    for bx, bw, blbl in [(602, 20, "<-"), (624, 20, "[]"), (646, 20, "O"), (674, 20, "|\\"), (696, 20, "()"), (718, 20, "/|")]:
        rrect(bx, ty, bw, 18, 2, fill=ctl_on if blbl == "()" else surf_bg)
        txt(bx + 3, ty + 3, blbl, fnt_sm, ctl_fg_on if blbl == "()" else ctl_fg)

    # Right group: Draw, Computer MIDI Keyboard (orange), Key, MIDI, 44.1, 4%
    rx0 = win_w_pt - 210
    rrect(rx0, ty, 20, 18, 2, fill=surf_bg)
    txt(rx0 + 4, ty + 3, "/", fnt_bd, ctl_fg)
    rrect(rx0 + 22, ty, 22, 18, 2, fill=ctl_on)
    txt(rx0 + 25, ty + 3, "M", fnt_bd, ctl_fg_on)
    for bx, bw, blbl in [(rx0 + 46, 28, "Key"), (rx0 + 76, 30, "MIDI"), (rx0 + 108, 32, "44.1"), (rx0 + 142, 34, "4 %")]:
        rrect(bx, ty, bw, 18, 2, fill=surf_bg)
        txt(bx + 4, ty + 3, blbl, fnt_sm, ctl_fg)

    # -------------------------------------------------------------------------
    # 2. MIDDLE SPLIT: LEFT BROWSER & GROOVE POOL + RIGHT ARRANGEMENT VIEW
    # -------------------------------------------------------------------------
    my0 = top_h_pt + 2
    left_w = 468
    # Left Browser Pane (y = my0 .. my0 + 186)
    rrect(4, my0, left_w, 186, 4, fill=surf_bg, outline=zombie, width=1)
    # Search bar
    rrect(8, my0 + 4, left_w - 38, 18, 3, fill=ctl_bg, outline=lcd_frame)
    txt(14, my0 + 7, "<  >   sampler", fnt_sm, ctl_fg)
    rrect(left_w - 26, my0 + 4, 18, 18, 2, fill=ctl_on)
    txt(left_w - 22, my0 + 7, "=", fnt_bd, ctl_fg_on)

    # Browser Left Sidebar (Collections & Library)
    d.line([(196 * S, (my0 + 25) * S), (196 * S, (my0 + 184) * S)], fill=desk, width=S)
    txt(10, my0 + 28, "Collections", fnt_bd, scale_txt)
    collections = [((228, 52, 46, 255), "Favorites"), ((245, 158, 52, 255), "Orange"), ((242, 212, 50, 255), "NEW"), ((128, 134, 142, 255), "Preferred Plugin")]
    for ci, (ccol, cname) in enumerate(collections):
        cy = my0 + 42 + ci * 14
        d.rounded_rectangle([12 * S, (cy + 2) * S, 18 * S, (cy + 8) * S], radius=1 * S, fill=ccol)
        txt(24, cy, cname, fnt_sm, ctl_fg)

    txt(10, my0 + 104, "Library", fnt_bd, scale_txt)
    d.rectangle([5 * S, (my0 + 117) * S, 195 * S, (my0 + 131) * S], fill=sel_bg)
    txt(22, my0 + 119, "All", fnt_bd, ctl_fg)
    for li, lname in enumerate(["Drums", "Instruments", "Audio Effects", "Clips"]):
        txt(22, my0 + 133 + li * 13, lname, fnt_sm, ctl_fg)

    # Browser Right Results Pane
    bx1 = 202
    txt(bx1, my0 + 28, "Content  ▸", fnt_bd, ctl_fg)
    txt(bx1, my0 + 42, "Type  ▾", fnt_bd, ctl_fg)
    for px, pw, plbl in [(bx1, 48, "One Shot"), (bx1 + 52, 68, "MPE Enabled"), (bx1 + 124, 68, "Multisampled")]:
        rrect(px, my0 + 55, pw, 14, 2, fill=macro_title)
        txt(px + 4, my0 + 57, plbl, fnt_sm, ctl_fg)
    txt(bx1, my0 + 74, "Sounds  ▾", fnt_bd, ctl_fg)
    for px, pw, plbl in [(bx1, 34, "Bass ›"), (bx1 + 38, 40, "Brass ›"), (bx1 + 82, 84, "Guitar & Plucked ›"), (bx1 + 170, 38, "Lead")]:
        rrect(px, my0 + 87, pw, 14, 2, fill=macro_title)
        txt(px + 4, my0 + 89, plbl, fnt_sm, ctl_fg)

    # Results header bar (highlighted in warm amber/gold)
    rrect(bx1 - 2, my0 + 104, left_w - bx1 + 2, 16, 2, fill=(230, 178, 108, 255))
    txt(bx1 + 2, my0 + 107, "Results", fnt_bd, ctl_fg_on)
    rrect(left_w - 62, my0 + 106, 36, 12, 5, fill=ctl_fg_on)
    txt(left_w - 56, my0 + 107, "Clear", fnt_sm, (230, 178, 108, 255))

    txt(bx1 + 2, my0 + 123, "Name", fnt_sm, scale_txt)
    txt(bx1 + 148, my0 + 123, "Rank  ▼ | Date Mo...", fnt_sm, scale_txt)
    d.rectangle([(bx1 - 2) * S, (my0 + 136) * S, (left_w - 2) * S, (my0 + 152) * S], fill=sel_bg)
    txt(bx1 + 14, my0 + 139, device_title, fnt_bd, ctl_fg)
    txt(bx1 + 2, my0 + 157, "Tags:  Sampling   Add...", fnt_sm, scale_txt)
    txt(bx1 + 85, my0 + 172, "1 item selected", fnt_sm, ctl_fg)

    # Groove Pool (y = my0 + 190 .. my0 + 248)
    gy0 = my0 + 190
    rrect(4, gy0, left_w, 58, 4, fill=surf_bg, outline=desk, width=1)
    txt(10, gy0 + 4, "Groove Name", fnt_sm, scale_txt)
    txt(240, gy0 + 4, "Base     Quantize   Timing    Random   Velocity", fnt_sm, scale_txt)
    d.line([(6 * S, (gy0 + 17) * S), ((left_w - 2) * S, (gy0 + 17) * S)], fill=desk, width=1)
    txt(10, gy0 + 21, "Swing 16ths 66", fnt_sm, ctl_fg)
    rrect(198, gy0 + 20, 12, 12, 2, fill=ctl_on)
    txt(238, gy0 + 21, "1/16  ▾     0 %       100 %       0 %        0 %", fnt_sm, ctl_fg)
    d.rectangle([5 * S, (gy0 + 40) * S, (left_w - 1) * S, (gy0 + 57) * S], fill=surf_frame)
    txt(10, gy0 + 43, "Groove Pool", fnt_bd, scale_txt)
    txt(left_w - 105, gy0 + 43, "Global Amount", fnt_sm, scale_txt)
    rrect(left_w - 32, gy0 + 42, 28, 13, 2, fill=ctl_bg, outline=lcd_frame)
    txt(left_w - 26, gy0 + 43, "0%", fnt_sm, ctl_fg)

    # Right Arrangement View (x = left_w + 8 .. win_w_pt - 4, y = my0 .. my0 + 248)
    ax0 = left_w + 8
    aw = win_w_pt - ax0 - 4
    rrect(ax0, my0, aw, 248, 4, fill=surf_bg, outline=zombie, width=1)

    # Timeline area vs Right Track Headers
    hdr_w = 248
    tl_w = max(180, aw - hdr_w)
    d.rectangle([(ax0 + 2) * S, (my0 + 22) * S, (ax0 + tl_w) * S, (my0 + 228) * S], fill=lcd_bg)

    # Ruler markings
    for bi, bnum in enumerate(["1", "65", "129", "193"]):
        bx = ax0 + 8 + bi * (tl_w // 4)
        txt(bx, my0 + 11, bnum, fnt_sm, ctl_fg)

    # Arrangement vertical grid lines scaled by Grid Line Intensity
    grid_pct = float(((theme_state or {}).get("abletonUi") or {}).get("gridLineIntensity", 100))
    grid_alpha = int(max(0, min(255, round((grid_pct / 200.0) * 115))))
    if grid_alpha > 2:
        for gx in range(ax0 + 8, ax0 + tl_w, 16):
            is_bar = ((gx - (ax0 + 8)) % 64) == 0
            a_use = min(255, int(grid_alpha * (1.35 if is_bar else 0.75)))
            gc = (lcd_frame[0], lcd_frame[1], lcd_frame[2], a_use)
            d.line([((gx) * S), (my0 + 22) * S, ((gx) * S), (my0 + 228) * S], fill=gc, width=1)

    # White Playhead Line in Arrangement
    d.line([((ax0 + 16) * S), (my0 + 22) * S, ((ax0 + 16) * S), (my0 + 228) * S], fill=(235, 242, 248, 220), width=max(1, S))

    # Big watermark `16/1` and time `0:00` / `5:00` at bottom of timeline
    txt(ax0 + tl_w - 42, my0 + 206, "16/1", fnt_lg, scale_txt)
    txt(ax0 + 8, my0 + 216, "0:00", fnt_sm, scale_txt)
    txt(ax0 + tl_w - 58, my0 + 216, "5:00", fnt_sm, scale_txt)
    rrect(ax0 + tl_w + 4, my0 + 231, 14, 13, 2, fill=ctl_on)
    rrect(ax0 + tl_w + 20, my0 + 231, 32, 13, 2, fill=ctl_bg, outline=alt_c)
    txt(ax0 + tl_w + 23, my0 + 232, "1.00x", fnt_sm, ctl_fg)
    txt(ax0 + tl_w + 56, my0 + 232, "H   W", fnt_bd, ctl_fg)

    # Track Headers on Right of Arrangement View
    tx0 = ax0 + tl_w + 2
    tracks = [
        ("1 Drum Rack", (184, 58, 52, 255), (240, 244, 248, 255), 54, "1", "0"),
        ("2 SC", (242, 244, 248, 255), (18, 22, 28, 255), 34, "2", "0"),
        ("3 MIDI", (28, 226, 252, 255), (18, 22, 28, 255), 68, "3", "0"),
        ("4 Wavetable", (244, 212, 54, 255), (18, 22, 28, 255), 18, "4", "0"),
        ("Main", (36, 200, 155, 255), (18, 22, 28, 255), 18, "M", "-6.0"),
    ]
    cur_ty = my0 + 30
    for tname, tcol, tfg, th, tnum, tvol in tracks:
        if cur_ty + th > my0 + 228:
            th = max(16, (my0 + 228) - cur_ty)
        # Colored track name block (82px wide)
        d.rectangle([tx0 * S, cur_ty * S, (tx0 + 82) * S, (cur_ty + th - 1) * S], fill=tcol)
        txt(tx0 + 6, cur_ty + 3, "▾ " + tname, fnt_bd, tfg)
        # Middle I/O column (62px wide)
        iox = tx0 + 84
        d.rectangle([iox * S, cur_ty * S, (iox + 62) * S, (cur_ty + th - 1) * S], fill=surf_frame)
        rrect(iox + 2, cur_ty + 2, 58, 13, 2, fill=ctl_bg, outline=lcd_frame)
        txt(iox + 5, cur_ty + 3, "Main       ▾" if tnum in ("2", "M") else "All Ins    ▾", fnt_sm, ctl_fg)
        if th >= 48:
            rrect(iox + 2, cur_ty + 17, 58, 13, 2, fill=ctl_bg, outline=lcd_frame)
            txt(iox + 5, cur_ty + 18, "All Channe▾", fnt_sm, ctl_fg)
            rrect(iox + 2, cur_ty + 32, 16, 13, 2, fill=ctl_bg)
            txt(iox + 4, cur_ty + 33, "In", fnt_sm, ctl_fg)
            rrect(iox + 19, cur_ty + 32, 23, 13, 2, fill=ctl_on)
            txt(iox + 21, cur_ty + 33, "Auto", fnt_sm, ctl_fg_on)
            rrect(iox + 43, cur_ty + 32, 17, 13, 2, fill=ctl_bg)
            txt(iox + 45, cur_ty + 33, "Off", fnt_sm, ctl_fg)
        # Right mixer controls column
        mx_col = iox + 64
        d.rectangle([mx_col * S, cur_ty * S, (ax0 + aw - 2) * S, (cur_ty + th - 1) * S], fill=surf_bg)
        if tnum != "M":
            rrect(mx_col + 2, cur_ty + 2, 34, 13, 2, fill=ctl_on)
            txt(mx_col + 15, cur_ty + 3, tnum, fnt_bd, ctl_fg_on)
            rrect(mx_col + 38, cur_ty + 2, 18, 13, 2, fill=ctl_bg)
            txt(mx_col + 44, cur_ty + 3, "S", fnt_sm, ctl_fg)
            rrect(mx_col + 58, cur_ty + 2, 18, 13, 2, fill=ctl_bg)
            txt(mx_col + 63, cur_ty + 3, "●", fnt_sm, ctl_fg)
        if th >= 30 or tnum == "M":
            vy = cur_ty + (2 if tnum == "M" else 17)
            rrect(mx_col + 2, vy, 34, 13, 2, fill=(18, 92, 104, 255), outline=alt_c)
            txt(mx_col + 14, vy + 1, "0", fnt_sm, ctl_fg)
            if tnum == "M":
                rrect(mx_col + 38, vy, 38, 13, 2, fill=(68, 96, 172, 255))
                txt(mx_col + 46, vy + 1, tvol, fnt_sm, ctl_fg)
            else:
                rrect(mx_col + 38, vy, 38, 13, 2, fill=ctl_bg)
                txt(mx_col + 54, vy + 1, "C", fnt_sm, ctl_fg)
        cur_ty += th + 1

    # -------------------------------------------------------------------------
    # 3. BOTTOM FULL-WIDTH ABLETON DEVICE TRAY (y = dy0 .. dy0 + tray_h_pt)
    # -------------------------------------------------------------------------
    dy0 = my0 + mid_h_pt + 4
    # Outer Device Tray focus frame (SelectionFrame highlight like the user's screenshot)
    rrect(4, dy0, win_w_pt - 8, tray_h_pt, 5, fill=surf_frame, outline=zombie, width=max(1, int(1.5 * S)))

    # Device Shell inside the tray on the left
    dx_pt = 8
    dy_pt = dy0 + 3
    dw_pt = dev_w_pt
    dh_pt = hdr_h_pt + dev_h_pt

    # Device Header Bar (`live_macro_title`)
    rrect(dx_pt, dy_pt, dw_pt, hdr_h_pt + 4, 4, fill=macro_title)
    # Activator circle (orange `ChosenDefault`)
    ax = (dx_pt + 10) * S
    ay = (dy_pt + 10) * S
    ar = 5 * S
    d.ellipse([ax - ar, ay - ar, ax + ar, ay + ar], fill=ctl_on, outline=desk, width=1)
    d.ellipse([ax - 2 * S, ay - 2 * S, ax + 2 * S, ay + 2 * S], outline=ctl_fg_on, width=max(1, S))

    # Device Title
    txt(dx_pt + 20, dy_pt + 4, device_title, fnt_hdr, ctl_fg)

    # Right-hand M4L Header Icons (Hot-Swap, Edit, Save Preset, Menu `•••`)
    ih_x = dx_pt + dw_pt - 56
    txt(ih_x, dy_pt + 4, "↻   ⧉   💾   •••", fnt_sm, ctl_fg)

    # Paste 169px Device Canvas directly below the 20px Header Bar
    out.alpha_composite(dev_img, (dx_pt * S, (dy_pt + hdr_h_pt) * S))

    # 1px separator & outer device border
    d.line([(dx_pt * S, (dy_pt + hdr_h_pt) * S), ((dx_pt + dw_pt) * S, (dy_pt + hdr_h_pt) * S)], fill=desk, width=S)
    rrect(dx_pt, dy_pt, dw_pt, dh_pt, 4, fill=None, outline=desk, width=S)

    # Inter-Device Stereo Level Meter immediately to the right of the device
    mx_pt = dx_pt + dw_pt + 4
    rrect(mx_pt, dy_pt, 8, dh_pt, 2, fill=lcd_bg, outline=desk, width=1)
    for tick_y in range(dy_pt + 12, dy_pt + dh_pt - 8, 16):
        d.line([((mx_pt + 2) * S, tick_y * S), ((mx_pt + 6) * S, tick_y * S)], fill=scale_txt, width=1)
    bar_h = int(dh_pt * 0.62)
    d.rectangle([(mx_pt + 1.5) * S, (dy_pt + dh_pt - bar_h) * S, (mx_pt + 3.5) * S, (dy_pt + dh_pt - 2) * S], fill=(0, 211, 141, 255))
    d.rectangle([(mx_pt + 4.5) * S, (dy_pt + dh_pt - bar_h + 6) * S, (mx_pt + 6.5) * S, (dy_pt + dh_pt - 2) * S], fill=(0, 211, 141, 255))

    # "Drop Audio Effects Here" zone filling the rest of the Device Tray width
    drop_x = mx_pt + 16
    drop_w = (win_w_pt - 8) - drop_x
    if drop_w >= 48:
        rrect(drop_x, dy_pt, drop_w, dh_pt, 3, fill=surf_bg, outline=desk, width=1)
        lbl1 = "Drop Audio"
        lbl2 = "Effects Here"
        b1 = d.textbbox((0, 0), lbl1, font=fnt_bd)
        b2 = d.textbbox((0, 0), lbl2, font=fnt_bd)
        cx_drop = (drop_x + drop_w * 0.5) * S
        cy_drop = (dy_pt + dh_pt * 0.5) * S
        d.text((cx_drop - (b1[2] - b1[0]) * 0.5, cy_drop - 10 * S), lbl1, font=fnt_bd, fill=scale_txt)
        d.text((cx_drop - (b2[2] - b2[0]) * 0.5, cy_drop + 3 * S), lbl2, font=fnt_bd, fill=scale_txt)

    # -------------------------------------------------------------------------
    # 4. BOTTOM STATUS & VIEW TAB BAR (y = by0 .. by0 + 20)
    # -------------------------------------------------------------------------
    by0 = dy0 + tray_h_pt + 4
    # Left Info Bar
    rrect(4, by0, 468, 20, 3, fill=surf_bg)
    txt(10, by0 + 4, "ⓘ   Live 12 Theme Studio Preview — Ableton UI & Device Tray Active", fnt_sm, ctl_fg)
    # Middle Status Bar
    mid_w = win_w_pt - 476 - 246
    if mid_w > 40:
        rrect(476, by0, mid_w, 20, 3, fill=surf_bg)
        txt(484, by0 + 4, "▶", fnt_sm, ctl_fg)
    # Right Tab Bar (orange ▲ button, track name, highlighted active device tab)
    rx_tab = win_w_pt - 242
    rrect(rx_tab, by0, 20, 20, 3, fill=ctl_on)
    txt(rx_tab + 6, by0 + 4, "▲", fnt_sm, ctl_fg_on)
    txt(rx_tab + 26, by0 + 4, f"1-{device_title[:18]}", fnt_bd, ctl_fg)
    rrect(rx_tab + 128, by0, 88, 20, 4, fill=macro_title, outline=zombie, width=max(1, int(1.5 * S)))
    txt(rx_tab + 133, by0 + 4, device_title[:14], fnt_bd, ctl_fg)
    rrect(win_w_pt - 22, by0, 18, 20, 3, fill=surf_bg)
    txt(win_w_pt - 18, by0 + 4, "III", fnt_sm, alt_c)

    return out


def apply_theme_to_patcher_boxes(boxes, slug, theme_state):
    """Maps native panel and live.* widget colors through src/theme_engine.js when a theme is active."""
    if not theme_state:
        return
    engine_path = os.path.join(ROOT_DIR, "src", "theme_engine.js")
    if not os.path.exists(engine_path):
        return
    color_keys = [
        "bgcolor", "bordercolor", "activedialcolor", "dialcolor", "textcolor",
        "activetextcolor", "textoncolor", "activebgcolor", "activeslidercolor",
        "slidercolor", "lcdcolor", "bgoncolor", "activebgoncolor", "linecolor",
        "tribordercolor", "activetricolor2", "tricolor"
    ]
    payload = []
    for idx, b in enumerate(boxes):
        b_cols = {}
        for k in color_keys:
            v = b.get(k)
            if isinstance(v, list) and len(v) in (3, 4) and not (len(v) == 4 and v[3] == 0):
                b_cols[k] = v
        saa = b.get("saved_attribute_attributes", {})
        saa_tokens = {}
        for k, v in saa.items():
            if isinstance(v, dict) and str(v.get("expression", "")).startswith("themecolor."):
                saa_tokens[k] = str(v["expression"]).split(".", 1)[1]
        if b_cols or saa_tokens:
            payload.append({"idx": idx, "cols": b_cols, "tokens": saa_tokens})
    if not payload:
        return
    script = f"""
global.M4L_DEVICE_SLUG = {json.dumps(slug)};
global.__M4L_THEME_STATE__ = {json.dumps(theme_state)};
const te = require({json.dumps(engine_path)});
const items = {json.dumps(payload)};
const out = items.map(item => {{
    const mapped = {{}};
    for (const [k, col] of Object.entries(item.cols)) {{
        if (item.tokens[k]) {{
            mapped[k] = te.m4lColor(item.tokens[k], col);
        }} else {{
            mapped[k] = te.m4lMapRgba(col[0], col[1], col[2], col.length > 3 ? col[3] : 1.0);
        }}
    }}
    for (const [k, tok] of Object.entries(item.tokens)) {{
        if (!mapped[k]) mapped[k] = te.m4lColor(tok);
    }}
    if (mapped.activeslidercolor && mapped.activebgcolor) {{
        const a = mapped.activeslidercolor, bg = mapped.activebgcolor;
        mapped.activeslidercolor = [a[0]*0.38 + bg[0]*0.62, a[1]*0.38 + bg[1]*0.62, a[2]*0.38 + bg[2]*0.62, 1.0];
    }}
    if (mapped.bgfillcolor && !mapped.bgcolor) mapped.bgcolor = mapped.bgfillcolor;
    return {{ idx: item.idx, mapped }};
}});
const surf = te.m4lColor("live_surface_bg");
console.log(JSON.stringify({{ items: out, surface: surf }}));
"""
    try:
        res = subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True)
        parsed = json.loads(res.stdout)
        for entry in parsed.get("items", []):
            box = boxes[entry["idx"]]
            for k, col in entry["mapped"].items():
                box[k] = col
        return parsed.get("surface")
    except Exception:
        return None


def capture_v8ui_commands(js_code, width, height, theme_state=None):
    theme_prelude = (
        f"global.__M4L_THEME_STATE__ = {json.dumps(theme_state)};\n"
        if theme_state
        else ""
    )
    runner = f"""
{theme_prelude}const cmds = [];
global.mgraphics = {{
    size: [{width}, {height}],
    init() {{}},
    redraw() {{}},
    set_source_rgba(r, g, b, a = 1.0) {{ cmds.push({{ op: "rgba", r, g, b, a }}); }},
    set_line_width(w) {{ cmds.push({{ op: "line_width", w }}); }},
    rectangle(x, y, w, h) {{ cmds.push({{ op: "rect", x, y, w, h }}); }},
    rectangle_rounded(x, y, w, h, rx, ry) {{ cmds.push({{ op: "rrect", x, y, w, h, rx, ry }}); }},
    move_to(x, y) {{ cmds.push({{ op: "move_to", x, y }}); }},
    line_to(x, y) {{ cmds.push({{ op: "line_to", x, y }}); }},
    curve_to(x1, y1, x2, y2, x3, y3) {{ cmds.push({{ op: "curve_to", x1, y1, x2, y2, x3, y3 }}); }},
    close_path() {{ cmds.push({{ op: "close_path" }}); }},
    arc(x, y, r, a1, a2) {{ cmds.push({{ op: "arc", x, y, r, a1, a2 }}); }},
    ellipse(x, y, w, h) {{ cmds.push({{ op: "arc", x: x + w / 2, y: y + h / 2, r: Math.min(w, h) / 2, a1: 0, a2: Math.PI * 2 }}); }},
    text_measure(t) {{ return [String(t).length * (this._fs || 10) * 0.56, (this._fs || 10)]; }},
    fill() {{ cmds.push({{ op: "fill", preserve: false }}); }},
    fill_preserve() {{ cmds.push({{ op: "fill", preserve: true }}); }},
    stroke() {{ cmds.push({{ op: "stroke" }}); }},
    select_font_face(face) {{ cmds.push({{ op: "font_face", face }}); }},
    set_font_size(size) {{ this._fs = size; cmds.push({{ op: "font_size", size }}); }},
    show_text(text) {{ cmds.push({{ op: "show_text", text }}); }},
    save() {{ cmds.push({{ op: "save" }}); }},
    restore() {{ cmds.push({{ op: "restore" }}); }},
    translate(x, y) {{ cmds.push({{ op: "translate", x, y }}); }},
    rotate(a) {{ cmds.push({{ op: "rotate", a }}); }}
}};
global.inlets = 1;
global.outlets = 2;
global.outlet = () => {{}};
global.notifyclients = () => {{}};
global.Buffer = function() {{ this.poke = () => {{}}; }};

{js_code}

if (typeof preview === "function") {{ preview(); }}
else if (typeof setphase === "function") {{ setphase(0.32); }}
if (typeof paint === "function") {{ paint(); }}
console.log(JSON.stringify(cmds));
"""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as tf:
        tf.write(runner)
        tf_path = tf.name
    try:
        res = subprocess.run(["node", tf_path], capture_output=True, text=True, check=True)
        return json.loads(res.stdout)
    finally:
        if os.path.exists(tf_path):
            os.remove(tf_path)


def rgba_tuple(c):
    return (
        int(max(0, min(255, round(c[0] * 255)))),
        int(max(0, min(255, round(c[1] * 255)))),
        int(max(0, min(255, round(c[2] * 255)))),
        int(max(0, min(255, round((c[3] if len(c) > 3 else 1.0) * 255))))
    )


def render_v8ui(cmds, w, h):
    canvas = Image.new("RGBA", (int(w * SCALE), int(h * SCALE)), (0, 0, 0, 0))
    cur_color = (255, 255, 255, 255)
    line_w = max(1, int(round(1.0 * SCALE)))
    font_size = 9.0
    font_bold = True   # "Ableton Sans ..." faces (Live-native look, src/spectral_theme.js) draw regular weight
    cur_pt = (0.0, 0.0)
    subpaths = []
    cur_path = []
    pending_shape = None  # ("rect", ...), ("rrect", ...), ("arc", ...)
    # Every arc since the last fill / stroke: cairo fills all of them (move_to + arc per dot batches many circles in
    # one fill); keeping only the last one drew one dot per fill.
    pending_arcs = []
    # Affine user->device matrix (a, b, c, d, e, f) as in cairo; paths and text follow it,
    # rects and arcs only follow its translation.
    mtx = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    mtx_stack = []

    def tp(x, y):
        a, b, c, d, e, f = mtx
        return ((a * x + c * y + e) * SCALE, (b * x + d * y + f) * SCALE)

    for cmd in cmds:
        op = cmd["op"]
        if op == "save":
            mtx_stack.append(mtx)
            continue
        if op == "restore":
            mtx = mtx_stack.pop() if mtx_stack else (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
            continue
        if op == "translate":
            a, b, c, d, e, f = mtx
            mtx = (a, b, c, d, e + a * cmd["x"] + c * cmd["y"], f + b * cmd["x"] + d * cmd["y"])
            continue
        if op == "rotate":
            a, b, c, d, e, f = mtx
            cs, sn = math.cos(cmd["a"]), math.sin(cmd["a"])
            mtx = (a * cs + c * sn, b * cs + d * sn, -a * sn + c * cs, -b * sn + d * cs, e, f)
            continue
        if op == "rgba":
            cur_color = rgba_tuple([cmd["r"], cmd["g"], cmd["b"], cmd["a"]])
        elif op == "line_width":
            line_w = max(1, int(round(cmd["w"] * SCALE)))
        elif op == "font_face":
            font_bold = not str(cmd.get("face", "")).startswith("Ableton Sans")
        elif op == "font_size":
            font_size = cmd["size"]
        elif op == "rect":
            pending_shape = ("rect", (cmd["x"] + mtx[4]) * SCALE, (cmd["y"] + mtx[5]) * SCALE, cmd["w"] * SCALE, cmd["h"] * SCALE)
            cur_path = []
        elif op == "rrect":
            pending_shape = ("rrect", cmd["x"] * SCALE, cmd["y"] * SCALE, cmd["w"] * SCALE, cmd["h"] * SCALE, cmd["rx"] * SCALE)
            cur_path = []
        elif op == "arc":
            pending_shape = ("arc", (cmd["x"] + mtx[4]) * SCALE, (cmd["y"] + mtx[5]) * SCALE, cmd["r"] * SCALE, cmd["a1"], cmd["a2"])
            pending_arcs.append(pending_shape)
            cur_path = []
        elif op == "move_to":
            pending_shape = pending_arcs[-1] if pending_arcs else None
            if len(cur_path) > 1:
                subpaths.append(cur_path)
            cur_pt = tp(cmd["x"], cmd["y"])
            cur_path = [cur_pt]
        elif op == "line_to":
            pending_shape = None
            cur_pt = tp(cmd["x"], cmd["y"])
            cur_path.append(cur_pt)
        elif op == "curve_to":
            pending_shape = None
            x0, y0 = cur_pt
            x1, y1 = tp(cmd["x1"], cmd["y1"])
            x2, y2 = tp(cmd["x2"], cmd["y2"])
            x3, y3 = tp(cmd["x3"], cmd["y3"])
            for step in range(1, 17):
                t = step / 16.0
                mt = 1.0 - t
                bx = mt**3 * x0 + 3 * mt**2 * t * x1 + 3 * mt * t**2 * x2 + t**3 * x3
                by = mt**3 * y0 + 3 * mt**2 * t * y1 + 3 * mt * t**2 * y2 + t**3 * y3
                cur_path.append((bx, by))
            cur_pt = (x3, y3)
        elif op == "close_path":
            if len(cur_path) > 2:
                cur_path.append(cur_path[0])
        elif op == "show_text":
            overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            d = ImageDraw.Draw(overlay)
            fnt = get_font(font_size * SCALE, bold=font_bold)
            angle = math.degrees(math.atan2(mtx[1], mtx[0]))
            if abs(angle) < 0.01:
                d.text((cur_pt[0], cur_pt[1] - font_size * SCALE * 0.85), str(cmd["text"]), font=fnt, fill=cur_color)
            else:
                # Draw horizontally on a square canvas with the baseline origin at its centre,
                # rotate about that centre, then paste (cropping anything off-canvas).
                half = int(d.textlength(str(cmd["text"]), font=fnt) + font_size * SCALE * 2)
                tmp = Image.new("RGBA", (half * 2, half * 2), (0, 0, 0, 0))
                ImageDraw.Draw(tmp).text((half, half - font_size * SCALE * 0.85), str(cmd["text"]), font=fnt, fill=cur_color)
                rot = tmp.rotate(-angle, center=(half, half), resample=Image.BICUBIC)
                dx, dy = int(cur_pt[0]) - half, int(cur_pt[1]) - half
                sx, sy = max(0, -dx), max(0, -dy)
                if sx < rot.width and sy < rot.height:
                    overlay.alpha_composite(rot.crop((sx, sy, rot.width, rot.height)), (dx + sx, dy + sy))
            canvas = Image.alpha_composite(canvas, overlay)
        elif op in ("fill", "stroke"):
            overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            d = ImageDraw.Draw(overlay)
            if pending_shape:
                kind = pending_shape[0]
                if kind == "rect":
                    _, rx, ry, rw, rh = pending_shape
                    box = [rx, ry, rx + rw, ry + rh]
                    if op == "fill":
                        d.rectangle(box, fill=cur_color)
                    else:
                        d.rectangle(box, outline=cur_color, width=line_w)
                elif kind == "rrect":
                    _, rx, ry, rw, rh, rad = pending_shape
                    box = [rx, ry, rx + rw, ry + rh]
                    if op == "fill":
                        d.rounded_rectangle(box, radius=rad, fill=cur_color)
                    else:
                        d.rounded_rectangle(box, radius=rad, outline=cur_color, width=line_w)
                elif kind == "arc":
                    for _, ax, ay, ar, a1, a2 in (pending_arcs or [pending_shape]):
                        box = [ax - ar, ay - ar, ax + ar, ay + ar]
                        if op == "fill":
                            d.ellipse(box, fill=cur_color)
                        else:
                            d.ellipse(box, outline=cur_color, width=line_w)
                if not cmd.get("preserve", False):
                    pending_shape = None
                    pending_arcs = []
                    subpaths = []
                    cur_path = []
            else:
                all_paths = subpaths + ([cur_path] if len(cur_path) > 1 else [])
                for pth in all_paths:
                    if op == "fill" and len(pth) >= 3:
                        d.polygon(pth, fill=cur_color)
                    elif op == "stroke" and len(pth) >= 2:
                        d.line(pth, fill=cur_color, width=line_w, joint="curve")
                if not cmd.get("preserve", False):
                    subpaths = []
                    cur_path = []
                    pending_arcs = []
            canvas = Image.alpha_composite(canvas, overlay)

    return canvas


def is_themed(box):
    """True for a live.* / comment box with colour attributes bound to Live theme colours (saved_attribute_attributes expression
    `themecolor.*`): Live draws these in its regular-weight UI font."""
    saa = box.get("saved_attribute_attributes", {})
    return any(isinstance(v, dict) and "expression" in v for v in saa.values())


def is_fully_transparent(box):
    """A live.* widget whose every colour attribute has alpha 0 draws nothing in Live, so the preview skips it."""
    if not str(box.get("maxclass", "")).startswith("live.") or box.get("maxclass") == "live.comment":
        return False
    # focusbordercolor only shows while a file is dragged over the widget
    colours = [v for k, v in box.items() if "color" in k and k != "focusbordercolor" and isinstance(v, list) and len(v) == 4]
    return bool(colours) and all(c[3] == 0 for c in colours)


def render_device(amxd_path=DEFAULT_AMXD_PATH, multimap_open=False, out_suffix="", theme_spec=None, ableton_ui_spec=None):
    os.makedirs(PREVIEWS_DIR, exist_ok=True)
    base_slug = slugify_device_name(amxd_path)
    slug = base_slug + out_suffix
    out_png_path = os.path.join(PREVIEWS_DIR, f"{slug}.png")
    theme_state = parse_theme_spec(theme_spec, ableton_ui_spec=ableton_ui_spec)

    with open(amxd_path, "rb") as f:
        raw = f.read()
    doc = json.loads(raw[32:].decode("utf-8"))
    p = doc["patcher"]

    if multimap_open:
        for b in p["boxes"]:
            box = b["box"]
            bid = box.get("id", "")
            if bid in ("obj-mseg", "obj-grid-lbl", "obj-grid", "obj-snap-btn"):
                box["hidden"] = 1
            elif bid in ("obj-hdr-targets", "obj-hdr-mode", "obj-hdr-range"):
                box["hidden"] = 0
            elif bid == "obj-expand-map":
                box.setdefault("saved_attribute_attributes", {}).setdefault("valueof", {})["parameter_initial"] = [1]
            elif any(bid.startswith(p) for p in ("obj-map-btn-", "obj-mod-mode-", "obj-bipolar-", "obj-mod-amt-")):
                box["hidden"] = 0

    dev_w = int(p.get("devicewidth", 648) or 385)
    dev_h = 169
    boxes = [b["box"] for b in p["boxes"] if b["box"].get("presentation") == 1 and not b["box"].get("hidden")]
    surf_col = apply_theme_to_patcher_boxes(boxes, base_slug, theme_state) if theme_state else None
    bg_rgba = rgba_tuple(surf_col) if surf_col else (36, 45, 53, 255)
    img = Image.new("RGBA", (dev_w * SCALE, dev_h * SCALE), bg_rgba)
    draw = ImageDraw.Draw(img)

    panels = [b for b in boxes if b.get("maxclass") == "panel"]
    widgets = [b for b in boxes if b.get("maxclass") != "panel" and not is_fully_transparent(b)]

    # 1. Draw background panels
    for pan in panels:
        rx, ry, rw, rh = [v * SCALE for v in pan["presentation_rect"]]
        bg = rgba_tuple(pan.get("bgcolor", [0.125, 0.145, 0.17, 1.0]))
        bd = rgba_tuple(pan.get("bordercolor", [0.06, 0.07, 0.08, 1.0]))
        rad = pan.get("rounded", 4) * SCALE
        draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=rad, fill=bg, outline=bd, width=SCALE)

    # 2. Draw widgets & v8ui
    for w in widgets:
        mc = w.get("maxclass")
        rx, ry, rw, rh = [v * SCALE for v in w["presentation_rect"]]
        W_BOLD = not is_themed(w)   # theme-bound widgets (spectral_common.theme) use Live's regular-weight font

        if mc == "v8ui":
            cmds = capture_v8ui_commands(w["textfile"]["text"], w["presentation_rect"][2], w["presentation_rect"][3], theme_state=theme_state)
            v8_img = render_v8ui(cmds, w["presentation_rect"][2], w["presentation_rect"][3])
            img.alpha_composite(v8_img, (int(rx), int(ry)))

        elif mc == "live.scope~":
            bg = rgba_tuple(w.get("bgcolor", [0.047, 0.067, 0.086, 1.0]))
            if bg[3] > 0:
                draw.rectangle([rx, ry, rx + rw, ry + rh], fill=bg)
            # Center zero line & simulated decay sawtooth scope trace (matching Live 12 Shaper screenshot)
            cy = ry + rh * 0.48
            draw.line([(rx, cy), (rx + rw, cy)], fill=(62, 86, 108, 160), width=max(1, SCALE // 2))
            pts = []
            for i in range(int(rw)):
                t = (i / rw) * 6.2
                frac = t - math.floor(t)
                y_val = (1.0 - frac) ** 1.85
                pts.append((rx + i, ry + rh * 0.90 - y_val * rh * 0.82))
            draw.line(pts, fill=(232, 158, 52, 255), width=int(1.5 * SCALE))

        elif mc == "live.comment":
            tc = rgba_tuple(w.get("textcolor", [0.85, 0.87, 0.9, 1.0]))
            fsize = w.get("fontsize", 9.5) * SCALE
            bold = w.get("fontface", 0) == 1
            fnt = get_font(fsize, bold=bold)
            txt = w.get("text", "")
            just = w.get("textjustification", 0)
            bbox = draw.textbbox((0, 0), txt, font=fnt)
            tw = bbox[2] - bbox[0]
            tx = rx + 2 * SCALE
            if just == 1:
                tx = rx + (rw - tw) * 0.5
            elif just == 2:
                tx = rx + rw - tw - 2 * SCALE
            draw.text((tx, ry + 2 * SCALE), txt, font=fnt, fill=tc)

        elif mc == "live.line":
            lc = rgba_tuple(w.get("linecolor", [0.12, 0.14, 0.16, 1.0]))
            cy = ry + rh * 0.5
            draw.line([(rx, cy), (rx + rw, cy)], fill=lc, width=max(1, int(1.5 * SCALE)))

        elif mc == "live.menu":
            bg = rgba_tuple(w.get("activebgcolor", [0.06, 0.075, 0.095, 1.0]))
            bd = rgba_tuple(w.get("bordercolor", [0.22, 0.28, 0.36, 1.0]))
            tc = rgba_tuple(w.get("textcolor", [0.95, 0.62, 0.22, 1.0]))
            tri_col = w.get("tricolor")
            show_tri = not (isinstance(tri_col, list) and len(tri_col) >= 4 and tri_col[3] == 0)
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            enums = vof.get("parameter_enum", ["COMB", "HYBRID", "ROOM"])
            init_idx = max(0, min(len(enums) - 1, int(round(vof.get("parameter_initial", [0])[0]))))
            val_str = str(enums[init_idx])
            draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=bd, width=1)
            fnt = get_font(8.5 * SCALE, bold=W_BOLD)
            bbox = draw.textbbox((0, 0), val_str, font=fnt)
            tw = bbox[2] - bbox[0]
            if show_tri:
                # Dropdown caret triangle on the right
                cx = rx + rw - 6.5 * SCALE
                cy = ry + rh * 0.52
                draw.polygon([
                    (cx - 2.6 * SCALE, cy - 1.4 * SCALE),
                    (cx + 2.6 * SCALE, cy - 1.4 * SCALE),
                    (cx, cy + 2.0 * SCALE),
                ], fill=tc)
                draw.text((rx + (rw - 10 * SCALE - tw) * 0.5 + 1 * SCALE, ry + 1.5 * SCALE), val_str, font=fnt, fill=tc)
            else:
                draw.text((rx + (rw - tw) * 0.5, ry + 1.5 * SCALE), val_str, font=fnt, fill=tc)

        elif mc == "live.numbox":
            app = w.get("appearance", 0)
            # `active 0` (greyed out): Live draws the inactive colours (bgcolor / slidercolor)
            inactive = w.get("active", 1) == 0
            bg = rgba_tuple(w.get("bgcolor" if inactive else "activebgcolor", [0.086, 0.102, 0.122, 1.0]))
            tc = rgba_tuple(w.get("textcolor", [1.0, 0.71, 0.2, 1.0]))
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            init_val = vof.get("parameter_initial", [0])[0]
            ustyle = vof.get("parameter_unitstyle", 0)
            enums = vof.get("parameter_enum", [])
            if app == 1:
                # Native Ableton slider numbox (Phase / Offset style with triangle on right)
                draw.rectangle([rx, ry, rx + rw, ry + rh], fill=bg, outline=(45, 50, 56, 255), width=max(1, SCALE // 2))
                tri_c = rgba_tuple(w.get("activetricolor2", [0.42, 0.78, 0.92, 1.0]))
                draw.polygon([
                    (rx + rw - 1 * SCALE, ry + 1.5 * SCALE),
                    (rx + rw - 1 * SCALE, ry + rh - 1.5 * SCALE),
                    (rx + rw - 8 * SCALE, ry + rh * 0.5)
                ], fill=tri_c)
                enums = vof.get("parameter_enum", [])
                if ustyle == 9 and enums:
                    idx = max(0, min(len(enums) - 1, int(round(init_val))))
                    val_str = str(enums[idx])
                elif ustyle == 5:
                    val_str = f"{init_val:.1f} %"
                else:
                    val_str = f"{int(init_val)}"
                fnt = get_font(8.5 * SCALE, bold=W_BOLD)
                bbox = draw.textbbox((0, 0), val_str, font=fnt)
                tw = bbox[2] - bbox[0]
                draw.text((rx + (rw - 7 * SCALE - tw) * 0.5, ry + 1.5 * SCALE), val_str, font=fnt, fill=tc)
            elif app in (2, 3):
                # Native Ableton horizontal value bar numbox (appearance 2 = Slider from left, appearance 3 = Bipolar from center)
                draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=(52, 60, 72, 255), width=max(1, SCALE // 2))
                lo_val = float(vof.get("parameter_mmin", 0.0))
                hi_val = float(vof.get("parameter_mmax", 100.0))
                norm = max(0.0, min(1.0, (float(init_val) - lo_val) / max(1e-6, hi_val - lo_val)))
                sl_c = rgba_tuple(w.get("slidercolor" if inactive else "activeslidercolor", [0.98, 0.70, 0.26, 1.0]))
                fill_c = (sl_c[0], sl_c[1], sl_c[2], 255)
                inner_w = rw - 2 * SCALE
                if app == 3:
                    mid_x = rx + 1 * SCALE + inner_w * 0.5
                    cur_x = rx + 1 * SCALE + inner_w * norm
                    x0 = min(mid_x, cur_x)
                    x1 = max(mid_x, cur_x)
                    if x1 - x0 >= 1.5 * SCALE:
                        draw.rectangle([x0, ry + 1 * SCALE, x1, ry + rh - 1 * SCALE], fill=fill_c)
                    # Center reference as short edge ticks so it never strikes through the value text
                    tick_c = (tc[0], tc[1], tc[2], 180)
                    draw.line([(mid_x, ry + 1 * SCALE), (mid_x, ry + 3 * SCALE)], fill=tick_c, width=max(1, SCALE))
                    draw.line([(mid_x, ry + rh - 3 * SCALE), (mid_x, ry + rh - 1 * SCALE)], fill=tick_c, width=max(1, SCALE))
                else:
                    bar_w = max(2.0 * SCALE, inner_w * norm)
                    draw.rounded_rectangle(
                        [rx + 1 * SCALE, ry + 1 * SCALE, rx + 1 * SCALE + bar_w, ry + rh - 1 * SCALE],
                        radius=1.5 * SCALE,
                        fill=fill_c,
                    )
                if ustyle == 9 and enums:
                    idx = max(0, min(len(enums) - 1, int(round(init_val))))
                    val_str = str(enums[idx])
                elif ustyle == 5:
                    val_str = f"{int(round(init_val))} %"
                elif ustyle == 7:
                    val_str = f"{int(round(init_val))} st"
                elif ustyle == 4:
                    val_str = f"{init_val:.1f} dB"
                elif ustyle == 3 and abs(init_val) >= 10:
                    val_str = f"{int(round(init_val))} Hz"
                elif ustyle == 3:
                    val_str = f"{init_val:.1f} Hz"
                elif ustyle == 2 and init_val < 10:
                    val_str = f"{init_val:.1f} ms"
                elif ustyle == 2:
                    val_str = f"{int(round(init_val))} ms"
                elif ustyle == 0:
                    val_str = f"{int(round(init_val))}"
                else:
                    val_str = f"{init_val:.1f}"
                fnt = get_font(float(w.get("fontsize", 8.5)) * SCALE, bold=W_BOLD)
                bbox = draw.textbbox((0, 0), val_str, font=fnt)
                tw = bbox[2] - bbox[0]
                text_c = (242, 246, 252, 255) if (ustyle == 9 and enums) else tc
                draw.text((rx + (rw - tw) * 0.5, ry + 1.5 * SCALE), val_str, font=fnt, fill=text_c)
            else:
                if bg[3] > 0:
                    draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=(50, 56, 66, 255), width=1)
                enums = vof.get("parameter_enum", [])
                lname = vof.get("parameter_longname", "")
                if ustyle == 9 and enums:
                    idx = max(0, min(len(enums) - 1, int(round(init_val))))
                    val_str = str(enums[idx])
                elif lname == "Phase":
                    val_str = f"{init_val:.2f} %"
                elif ustyle == 7:
                    val_str = f"{int(round(init_val))} st"
                elif ustyle == 5:
                    val_str = f"{int(round(init_val))} %"
                elif ustyle == 4:
                    val_str = f"+{init_val:.1f} dB" if init_val > 0 and lname == "Amount" else f"{init_val:.1f} dB"
                elif ustyle == 3:
                    val_str = f"{init_val / 1000.0:.1f} kHz" if init_val >= 10000 else (f"{int(round(init_val))} Hz" if init_val >= 100 else f"{init_val:.1f} Hz")
                elif ustyle == 2:
                    val_str = f"{init_val:.1f} ms" if init_val < 10 else f"{int(round(init_val))} ms"
                else:
                    val_str = f"{int(round(init_val))}"
                fnt = get_font(9.0 * SCALE, bold=W_BOLD)
                bbox = draw.textbbox((0, 0), val_str, font=fnt)
                tw = bbox[2] - bbox[0]
                tx = (rx + 2 * SCALE) if bg[3] == 0 else (rx + (rw - tw) * 0.5)
                draw.text((tx, ry + 1.5 * SCALE), val_str, font=fnt, fill=tc)

        elif mc == "live.text":
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            init_on = vof.get("parameter_initial", [0])[0] == 1
            pics = w.get("pictures", [])
            if w.get("usepicture") == 1 and pics and "multimap" in pics[0]:
                # Multimap 4-bar (closed) or 1-bar (open) gold icon button
                bg = rgba_tuple(w.get("activebgcolor", [0.086, 0.102, 0.122, 1.0]))
                bd = rgba_tuple(w.get("bordercolor", [1.0, 0.71, 0.2, 1.0]))
                draw.rectangle([rx, ry, rx + rw, ry + rh], fill=bg, outline=bd, width=max(1, SCALE // 2))
                if init_on:
                    by = ry + rh * 0.5
                    draw.line([(rx + 3 * SCALE, by), (rx + rw - 3 * SCALE, by)], fill=bd, width=max(1, int(1.4 * SCALE)))
                else:
                    for bar_i in range(4):
                        by = ry + (3.0 + bar_i * 2.6) * SCALE
                        draw.line([(rx + 3 * SCALE, by), (rx + rw - 3 * SCALE, by)], fill=bd, width=max(1, int(1.2 * SCALE)))
            elif w.get("appearance") == 1 and abs(rw - rh) <= 2 * SCALE:
                # Circular (R) Retrigger button inside dark LCD box
                bg = rgba_tuple(w.get("activebgcolor", [0.047, 0.067, 0.086, 1.0]))
                bd = rgba_tuple(w.get("bordercolor", [0.576, 0.631, 0.678, 1.0]))
                tc = rgba_tuple(w.get("activetextcolor", [0.576, 0.631, 0.678, 1.0]))
                draw.ellipse([rx, ry, rx + rw, ry + rh], fill=bg, outline=bd, width=max(1, int(1.1 * SCALE)))
                txt = w.get("text", "R")
                fnt = get_font(8.0 * SCALE, bold=W_BOLD)
                bbox = draw.textbbox((0, 0), txt, font=fnt)
                tw = bbox[2] - bbox[0]
                draw.text((rx + (rw - tw) * 0.5, ry + 1.5 * SCALE), txt, font=fnt, fill=tc)
            elif w.get("usepicture") == 1 and len(pics) >= 1 and builtin_svg_mask(pics[min(len(pics) - 1, 1 if init_on else 0)], int(min(rw, rh) - 4 * SCALE)) is not None:
                # Built-in Live/Max SVG icon toggle (remapsvgcolors: tinted with the text colour)
                bg = rgba_tuple(w.get("activebgoncolor", [1.0, 0.694, 0.18, 1.0]) if init_on else w.get("activebgcolor", [0.12, 0.14, 0.17, 1.0]))
                bd = rgba_tuple(w.get("bordercolor", [1.0, 0.71, 0.2, 1.0]))
                tc = rgba_tuple(w.get("activetextoncolor", [0.08, 0.1, 0.12, 1.0]) if init_on else w.get("activetextcolor", w.get("textcolor", [0.75, 0.78, 0.82, 1.0])))
                draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=bd, width=1)
                isz = int(min(rw, rh) - 4 * SCALE)
                mask = builtin_svg_mask(pics[min(len(pics) - 1, 1 if init_on else 0)], isz)
                img.paste(Image.new("RGBA", (isz, isz), tc), (int(rx + (rw - isz) * 0.5), int(ry + (rh - isz) * 0.5)), mask)
            else:
                bg = rgba_tuple(w.get("activebgoncolor", [1.0, 0.694, 0.18, 1.0]) if init_on else w.get("activebgcolor", [0.12, 0.14, 0.17, 1.0]))
                bd = rgba_tuple(w.get("bordercolor", [1.0, 0.71, 0.2, 1.0]))
                tc = rgba_tuple(w.get("activetextoncolor", [0.08, 0.1, 0.12, 1.0]) if init_on else w.get("textcolor", [0.75, 0.78, 0.82, 1.0]))
                draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=bd, width=1)
                txt = w.get("texton" if init_on else "text", "Map")
                fnt = get_font(9.0 * SCALE, bold=W_BOLD)
                bbox = draw.textbbox((0, 0), txt, font=fnt)
                tw = bbox[2] - bbox[0]
                draw.text((rx + (rw - tw) * 0.5, ry + 1.5 * SCALE), txt, font=fnt, fill=tc)

        elif mc == "live.tab":
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            enums = vof.get("parameter_enum", ["Hz", "Sync"])
            init_idx = int(vof.get("parameter_initial", [0])[0])
            num_rows = w.get("num_lines_presentation", 2)
            pics = w.get("pictures", [])
            use_svg = w.get("usepicture") == 1 and len(pics) >= 2
            if num_rows == 1:
                # Horizontal tab row (e.g. [ Loop ] [ 1-Shot ] [ Manual ])
                gap_x = w.get("spacing_x", 3.0) * SCALE
                cell_w = (rw - gap_x * (len(enums) - 1)) / max(1, len(enums))
                fnt = get_font(8.5 * SCALE, bold=W_BOLD)
                for idx, label in enumerate(enums):
                    cx0 = rx + idx * (cell_w + gap_x)
                    is_on = (idx == init_idx)
                    bg = (255, 173, 56, 255) if is_on else (17, 22, 28, 255)
                    tc = (12, 17, 22, 255) if is_on else (218, 224, 232, 255)
                    draw.rectangle([cx0, ry, cx0 + cell_w, ry + rh], fill=bg, outline=(10, 14, 18, 255), width=max(1, SCALE // 2))
                    pic_name = pics[idx] if (use_svg and idx < len(pics)) else ""
                    if pic_name in ("highcut.svg", "bandpass.svg", "lowcut.svg", "lowshelf.svg"):
                        # Render built-in M4L filter response curves (LP / BP / HP / Low-Shelf Fork)
                        x_l = cx0 + 4.0 * SCALE
                        x_r = cx0 + cell_w - 4.0 * SCALE
                        y_top = ry + 3.5 * SCALE
                        y_bot = ry + rh - 3.2 * SCALE
                        y_mid = (y_top + y_bot) * 0.5
                        lw = max(1, int(1.4 * SCALE))
                        if pic_name == "highcut.svg":
                            # Low-pass: flat passband on left, smooth roll-off down on right
                            x_k = x_l + (x_r - x_l) * 0.62
                            pts = [
                                (x_l, y_top),
                                (x_k, y_top),
                                (x_k + (x_r - x_k) * 0.55, y_top + (y_bot - y_top) * 0.35),
                                (x_r, y_bot),
                            ]
                            draw.line(pts, fill=tc, width=lw, joint="curve")
                        elif pic_name == "bandpass.svg":
                            # Band-pass: rises from left, flat/rounded top in middle, drops on right
                            x_k1 = x_l + (x_r - x_l) * 0.28
                            x_k2 = x_l + (x_r - x_l) * 0.72
                            pts = [
                                (x_l, y_bot),
                                (x_l + (x_k1 - x_l) * 0.45, y_top + (y_bot - y_top) * 0.35),
                                (x_k1, y_top),
                                (x_k2, y_top),
                                (x_k2 + (x_r - x_k2) * 0.55, y_top + (y_bot - y_top) * 0.35),
                                (x_r, y_bot),
                            ]
                            draw.line(pts, fill=tc, width=lw, joint="curve")
                        elif pic_name == "lowshelf.svg":
                            # Low-shelf fork: upper boost branch + lower cut branch splitting left from flat right passband
                            x_k1 = x_l + (x_r - x_l) * 0.32
                            x_k2 = x_l + (x_r - x_l) * 0.65
                            draw.line([(x_l, y_top), (x_k1, y_top), (x_k2, y_mid), (x_r, y_mid)], fill=tc, width=lw, joint="curve")
                            draw.line([(x_l, y_bot), (x_k1, y_bot), (x_k2, y_mid)], fill=tc, width=lw, joint="curve")
                        else:
                            # High-pass (lowcut.svg): rises from bottom-left, flat passband on right
                            x_k = x_l + (x_r - x_l) * 0.38
                            pts = [
                                (x_l, y_bot),
                                (x_l + (x_k - x_l) * 0.45, y_top + (y_bot - y_top) * 0.35),
                                (x_k, y_top),
                                (x_r, y_top),
                            ]
                            draw.line(pts, fill=tc, width=lw, joint="curve")
                    elif pic_name and builtin_svg_mask(pic_name, int(min(cell_w, rh) - 4 * SCALE)) is not None:
                        # Any other built-in Live/Max SVG icon, tinted with the cell's text colour
                        isz = int(min(cell_w, rh) - 4 * SCALE)
                        img.paste(Image.new("RGBA", (isz, isz), tc), (int(cx0 + (cell_w - isz) * 0.5), int(ry + (rh - isz) * 0.5)), builtin_svg_mask(pic_name, isz))
                    else:
                        bbox = draw.textbbox((0, 0), label, font=fnt)
                        tw = bbox[2] - bbox[0]
                        draw.text((cx0 + (cell_w - tw) * 0.5, ry + 1.5 * SCALE), label, font=fnt, fill=tc)
            else:
                num_cols = max(1, math.ceil(len(enums) / max(1, num_rows)))
                gap_x = w.get("spacing_x", 2.0) * SCALE if num_cols > 1 else 0
                gap_y = w.get("spacing_y", 2.5) * SCALE if (use_svg or num_cols > 1) else 0
                cell_w = (rw - gap_x * (num_cols - 1)) / max(1, num_cols)
                cell_h = (rh - gap_y * (num_rows - 1)) / max(1, num_rows)
                fnt = get_font((8.0 if use_svg else 8.5) * SCALE, bold=W_BOLD)
                for idx, label in enumerate(enums):
                    r_idx = idx // num_cols if num_cols > 1 else idx
                    c_idx = idx % num_cols if num_cols > 1 else 0
                    cx0 = rx + c_idx * (cell_w + gap_x)
                    cy0 = ry + r_idx * (cell_h + gap_y)
                    is_on = (idx == init_idx)
                    bg = (255, 173, 56, 255) if is_on else (17, 22, 28, 255)
                    tc = (12, 17, 22, 255) if is_on else (218, 224, 232, 255)
                    draw.rectangle([cx0, cy0, cx0 + cell_w, cy0 + cell_h], fill=bg, outline=(10, 14, 18, 255), width=max(1, SCALE // 2))
                    if use_svg and idx == 1:
                        mx = cx0 + cell_w * 0.5
                        top_y = cy0 + 2.8 * SCALE
                        bot_y = cy0 + cell_h - 2.2 * SCALE
                        draw.line([
                            (mx - 2.0 * SCALE, top_y + 1.2 * SCALE),
                            (mx - 4.2 * SCALE, bot_y),
                            (mx + 4.2 * SCALE, bot_y),
                            (mx + 2.0 * SCALE, top_y + 1.2 * SCALE)
                        ], fill=tc, width=max(1, int(1.3 * SCALE)), joint="curve")
                        draw.line([(mx - 0.5 * SCALE, bot_y - 1.5 * SCALE), (mx + 1.8 * SCALE, top_y)], fill=tc, width=max(1, int(1.3 * SCALE)))
                    else:
                        bbox = draw.textbbox((0, 0), label, font=fnt)
                        tw = bbox[2] - bbox[0]
                        draw.text((cx0 + (cell_w - tw) * 0.5, cy0 + 1.2 * SCALE), label, font=fnt, fill=tc)

        elif mc == "live.dial":
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            sname = vof.get("parameter_shortname", "Rate")
            init_val = vof.get("parameter_initial", [1.0])[0]
            ustyle = vof.get("parameter_unitstyle", 0)
            enums = vof.get("parameter_enum", [])
            if enums and (ustyle == 9 or vof.get("parameter_type") == 2):
                idx = max(0, min(len(enums) - 1, int(round(init_val))))
                val_str = str(enums[idx])
            elif ustyle == 3:
                val_str = f"{init_val:.1f} Hz"
            elif ustyle == 2:
                val_str = "Inf" if (sname == "MaxLen" and init_val >= 4990) else f"{int(init_val)} ms"
            elif ustyle == 4:
                val_str = f"{init_val:.1f} dB"
            elif ustyle == 7:
                val_str = f"{int(init_val)} st"
            elif ustyle == 5:
                val_str = f"{int(init_val)} %"
            else:
                val_str = f"{int(init_val)}"
            fnt = get_font(9.5 * SCALE, bold=W_BOLD)
            # Label at top (Live hides it with showname 0)
            if w.get("showname", 1):
                bbox = draw.textbbox((0, 0), sname, font=fnt)
                draw.text((rx + (rw - (bbox[2] - bbox[0])) * 0.5, ry - 1 * SCALE), sname, font=fnt, fill=(224, 230, 236, 255))
            # Dial arc
            cx = rx + rw * 0.5
            cy = ry + rh * 0.52
            r = min(rw, rh) * 0.30
            arc_color = rgba_tuple(w.get("activedialcolor", [0.0, 0.82, 0.91, 1.0]))
            lo_val = float(vof.get("parameter_mmin", 0.0))
            hi_val = float(vof.get("parameter_mmax", 100.0))
            norm = max(0.0, min(1.0, (float(init_val) - lo_val) / max(1e-6, hi_val - lo_val)))
            end_ang = 240 if (ustyle == 9 and enums) else int(135 + norm * 270)
            draw.arc([cx - r, cy - r, cx + r, cy + r], start=135, end=405, fill=(12, 17, 22, 255), width=int(2.6 * SCALE))
            draw.arc([cx - r, cy - r, cx + r, cy + r], start=135, end=max(136, end_ang), fill=arc_color, width=int(2.6 * SCALE))
            ang = math.radians(end_ang)
            draw.line([(cx, cy), (cx + r * math.cos(ang), cy + r * math.sin(ang))], fill=(12, 17, 22, 255), width=int(2.6 * SCALE))
            # Value at bottom
            bbox2 = draw.textbbox((0, 0), val_str, font=fnt)
            draw.text((rx + (rw - (bbox2[2] - bbox2[0])) * 0.5, ry + rh - 10.5 * SCALE), val_str, font=fnt, fill=(224, 230, 236, 255))

        elif mc == "live.slider":
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            sname = vof.get("parameter_shortname", "Vol")
            init_val = float(vof.get("parameter_initial", [0.0])[0])
            lo_val = float(vof.get("parameter_mmin", -36.0))
            hi_val = float(vof.get("parameter_mmax", 18.0))
            norm = max(0.0, min(1.0, (init_val - lo_val) / max(1e-6, hi_val - lo_val)))
            scol = rgba_tuple(w.get("slidercolor", [0.28, 0.84, 0.96, 1.0]))
            fnt = get_font(8.5 * SCALE, bold=W_BOLD)
            bbox = draw.textbbox((0, 0), sname, font=fnt)
            draw.text((rx + (rw - (bbox[2] - bbox[0])) * 0.5, ry), sname, font=fnt, fill=(224, 230, 236, 255))
            tx = rx + rw * 0.5
            top_y = ry + 13 * SCALE
            bot_y = ry + rh - 12 * SCALE
            fill_y = bot_y - norm * (bot_y - top_y)
            draw.rounded_rectangle([tx - 3 * SCALE, top_y, tx + 3 * SCALE, bot_y], radius=2 * SCALE, fill=(14, 19, 25, 255), outline=(42, 52, 64, 255), width=1)
            draw.rounded_rectangle([tx - 2.5 * SCALE, fill_y, tx + 2.5 * SCALE, bot_y], radius=2 * SCALE, fill=scol)
            draw.rectangle([tx - 5.5 * SCALE, fill_y - 1.5 * SCALE, tx + 5.5 * SCALE, fill_y + 1.5 * SCALE], fill=(240, 246, 252, 255))
            val_str = f"{init_val:+.1f}dB" if abs(init_val) >= 0.05 else "0.0dB"
            bbox2 = draw.textbbox((0, 0), val_str, font=fnt)
            draw.text((rx + (rw - (bbox2[2] - bbox2[0])) * 0.5, ry + rh - 10 * SCALE), val_str, font=fnt, fill=(224, 230, 236, 255))

        elif mc == "live.menu":
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            enums = vof.get("parameter_enum", ["Soft Clip", "Hard Clip", "Limiter"])
            init_idx = int(vof.get("parameter_initial", [0])[0])
            label = str(enums[max(0, min(len(enums) - 1, init_idx))])
            bg = rgba_tuple(w.get("activebgcolor", [0.07, 0.085, 0.11, 1.0]))
            bd = rgba_tuple(w.get("bordercolor", [0.42, 0.48, 0.56, 1.0]))
            tc = rgba_tuple(w.get("textcolor", [0.96, 0.66, 0.25, 1.0]))
            draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=bd, width=1)
            fnt = get_font(8.5 * SCALE, bold=W_BOLD)
            draw.text((rx + 4 * SCALE, ry + 1.5 * SCALE), label, font=fnt, fill=tc)
            # Dropdown caret triangle on the right
            cx_t = rx + rw - 6.5 * SCALE
            cy_t = ry + rh * 0.52
            draw.polygon([
                (cx_t - 3 * SCALE, cy_t - 1.8 * SCALE),
                (cx_t + 3 * SCALE, cy_t - 1.8 * SCALE),
                (cx_t, cy_t + 2.2 * SCALE),
            ], fill=tc)

        elif mc == "live.drop":
            bg = (22, 26, 33, 255)
            bd = rgba_tuple(w.get("bordercolor", [0.32, 0.38, 0.46, 1.0]))
            tc = rgba_tuple(w.get("textcolor", [0.68, 0.73, 0.80, 1.0]))
            draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=3 * SCALE, fill=bg, outline=bd, width=1)
            txt = w.get("legend", "Drop Sample Folder")
            fnt = get_font(8.5 * SCALE, bold=W_BOLD)
            bbox = draw.textbbox((0, 0), txt, font=fnt)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
            draw.text((rx + (rw - tw) * 0.5, ry + (rh - th) * 0.5 - 1 * SCALE), txt, font=fnt, fill=tc)

        elif mc == "textedit":
            bg = rgba_tuple(w.get("bgcolor", [0.07, 0.085, 0.11, 1.0]))
            bd = rgba_tuple(w.get("bordercolor", [0.22, 0.74, 0.97, 0.7]))
            tc = rgba_tuple(w.get("textcolor", [0.85, 0.89, 0.94, 1.0]))
            draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2.5 * SCALE, fill=bg, outline=bd, width=1)
            txt = w.get("text", "") or w.get("annotation_name", "Filter by name...")
            fnt = get_font(float(w.get("fontsize", 9.0)) * 0.94 * SCALE, bold=False)
            fill_c = (140, 152, 168, 255) if not w.get("text") else tc
            if w.get("lines", 1) and int(w.get("lines", 1)) > 1 and w.get("wordwrap", 1):
                # multi-line field: wrap on word boundaries inside the box
                line, ly = "", ry + 2.5 * SCALE
                for word in str(txt).split(" "):
                    trial = (line + " " + word).strip()
                    if line and draw.textlength(trial, font=fnt) > rw - 8 * SCALE:
                        draw.text((rx + 4 * SCALE, ly), line, font=fnt, fill=fill_c)
                        ly += fnt.size * 1.25
                        line = word
                    else:
                        line = trial
                draw.text((rx + 4 * SCALE, ly), line, font=fnt, fill=fill_c)
            else:
                draw.text((rx + 4 * SCALE, ry + 2.5 * SCALE), txt, font=fnt, fill=fill_c)

    if ableton_ui_spec or (theme_state and (theme_state.get("abletonUi") or {}).get("enabled")):
        dev_title = os.path.splitext(os.path.basename(amxd_path))[0]
        img = wrap_in_ableton_chrome(img, dev_title, theme_state)

    img.save(out_png_path)
    print(f"Saved preview to {out_png_path} ({img.width}x{img.height})")
    return out_png_path


if __name__ == "__main__":
    args = list(sys.argv[1:])
    cli_theme = None
    cli_ableton_ui = None
    if "--theme" in args:
        t_idx = args.index("--theme")
        if t_idx + 1 < len(args):
            cli_theme = args[t_idx + 1]
            del args[t_idx:t_idx + 2]
        else:
            del args[t_idx]
    if "--ableton-ui" in args:
        u_idx = args.index("--ableton-ui")
        if u_idx + 1 < len(args) and not args[u_idx + 1].startswith("-"):
            cli_ableton_ui = args[u_idx + 1]
            del args[u_idx:u_idx + 2]
        else:
            cli_ableton_ui = '{"enabled":true}'
            del args[u_idx]
    target_amxd = args[0] if len(args) > 0 else DEFAULT_AMXD_PATH
    suffix = args[1] if len(args) > 1 else ""
    render_device(target_amxd, multimap_open=False, out_suffix=suffix, theme_spec=cli_theme, ableton_ui_spec=cli_ableton_ui)
    if slugify_device_name(target_amxd) == "better_shaper" and not suffix:
        render_device(target_amxd, multimap_open=True, out_suffix="_multimap", theme_spec=cli_theme, ableton_ui_spec=cli_ableton_ui)
