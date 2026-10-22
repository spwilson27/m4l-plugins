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


def capture_v8ui_commands(js_code, width, height):
    runner = f"""
const cmds = [];
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
            fnt = get_font(font_size * SCALE, bold=True)
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


def is_fully_transparent(box):
    """A live.* widget whose every colour attribute has alpha 0 draws nothing in Live, so the preview skips it."""
    if not str(box.get("maxclass", "")).startswith("live.") or box.get("maxclass") == "live.comment":
        return False
    # focusbordercolor only shows while a file is dragged over the widget
    colours = [v for k, v in box.items() if "color" in k and k != "focusbordercolor" and isinstance(v, list) and len(v) == 4]
    return bool(colours) and all(c[3] == 0 for c in colours)


def render_device(amxd_path=DEFAULT_AMXD_PATH, multimap_open=False, out_suffix=""):
    os.makedirs(PREVIEWS_DIR, exist_ok=True)
    slug = slugify_device_name(amxd_path) + out_suffix
    out_png_path = os.path.join(PREVIEWS_DIR, f"{slug}.png")

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
    img = Image.new("RGBA", (dev_w * SCALE, dev_h * SCALE), (36, 45, 53, 255))
    draw = ImageDraw.Draw(img)

    boxes = [b["box"] for b in p["boxes"] if b["box"].get("presentation") == 1 and not b["box"].get("hidden")]
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

        if mc == "v8ui":
            cmds = capture_v8ui_commands(w["textfile"]["text"], w["presentation_rect"][2], w["presentation_rect"][3])
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
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            enums = vof.get("parameter_enum", ["COMB", "HYBRID", "ROOM"])
            init_idx = max(0, min(len(enums) - 1, int(round(vof.get("parameter_initial", [0])[0]))))
            val_str = str(enums[init_idx])
            draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=bd, width=1)
            # Dropdown caret triangle on the right
            cx = rx + rw - 6.5 * SCALE
            cy = ry + rh * 0.52
            draw.polygon([
                (cx - 2.6 * SCALE, cy - 1.4 * SCALE),
                (cx + 2.6 * SCALE, cy - 1.4 * SCALE),
                (cx, cy + 2.0 * SCALE),
            ], fill=tc)
            fnt = get_font(8.5 * SCALE, bold=True)
            bbox = draw.textbbox((0, 0), val_str, font=fnt)
            tw = bbox[2] - bbox[0]
            draw.text((rx + (rw - 10 * SCALE - tw) * 0.5 + 1 * SCALE, ry + 1.5 * SCALE), val_str, font=fnt, fill=tc)

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
                fnt = get_font(8.5 * SCALE, bold=True)
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
                fnt = get_font(float(w.get("fontsize", 8.5)) * SCALE, bold=True)
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
                fnt = get_font(9.0 * SCALE, bold=True)
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
                fnt = get_font(8.0 * SCALE, bold=True)
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
                fnt = get_font(9.0 * SCALE, bold=True)
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
                fnt = get_font(8.5 * SCALE, bold=True)
                for idx, label in enumerate(enums):
                    cx0 = rx + idx * (cell_w + gap_x)
                    is_on = (idx == init_idx)
                    bg = (255, 173, 56, 255) if is_on else (17, 22, 28, 255)
                    tc = (12, 17, 22, 255) if is_on else (218, 224, 232, 255)
                    draw.rectangle([cx0, ry, cx0 + cell_w, ry + rh], fill=bg, outline=(10, 14, 18, 255), width=max(1, SCALE // 2))
                    pic_name = pics[idx] if (use_svg and idx < len(pics)) else ""
                    if pic_name in ("highcut.svg", "bandpass.svg", "lowcut.svg"):
                        # Render built-in M4L filter response curves (LP / BP / HP)
                        x_l = cx0 + 4.0 * SCALE
                        x_r = cx0 + cell_w - 4.0 * SCALE
                        y_top = ry + 3.5 * SCALE
                        y_bot = ry + rh - 3.2 * SCALE
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
                fnt = get_font((8.0 if use_svg else 8.5) * SCALE, bold=True)
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
            fnt = get_font(9.5 * SCALE, bold=True)
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
            fnt = get_font(8.5 * SCALE, bold=True)
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
            fnt = get_font(8.5 * SCALE, bold=True)
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
            fnt = get_font(8.5 * SCALE, bold=True)
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

    img.save(out_png_path)
    print(f"Saved preview to {out_png_path} ({img.width}x{img.height})")
    return out_png_path


if __name__ == "__main__":
    target_amxd = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_AMXD_PATH
    suffix = sys.argv[2] if len(sys.argv) > 2 else ""
    render_device(target_amxd, multimap_open=False, out_suffix=suffix)
    if slugify_device_name(target_amxd) == "better_shaper" and not suffix:
        render_device(target_amxd, multimap_open=True, out_suffix="_multimap")
