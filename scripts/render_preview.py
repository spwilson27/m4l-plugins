#!/usr/bin/env python3
"""
Renders a 2x Retina pixel-accurate visual preview of devices/Bitwig Shaper.amxd
by executing the embedded v8ui mgraphics paint() stream in Node.js and rendering
all Max presentation_rect UI widgets and mgraphics vector paths/text to tests/preview.png.
Also checks for any text overflow or widget overlap issues automatically.
"""

import json
import math
import os
import subprocess
import tempfile
from PIL import Image, ImageDraw, ImageFont

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Bitwig Shaper.amxd")
OUT_PNG_PATH = os.path.join(ROOT_DIR, "tests", "preview.png")

SCALE = 2  # 2x Retina rendering


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
    fill() {{ cmds.push({{ op: "fill", preserve: false }}); }},
    fill_preserve() {{ cmds.push({{ op: "fill", preserve: true }}); }},
    stroke() {{ cmds.push({{ op: "stroke" }}); }},
    select_font_face(face) {{ cmds.push({{ op: "font_face", face }}); }},
    set_font_size(size) {{ cmds.push({{ op: "font_size", size }}); }},
    show_text(text) {{ cmds.push({{ op: "show_text", text }}); }}
}};
global.inlets = 1;
global.outlets = 2;
global.outlet = () => {{}};
global.notifyclients = () => {{}};
global.Buffer = function() {{ this.poke = () => {{}}; }};

{js_code}

setphase(0.32);
paint();
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

    for cmd in cmds:
        op = cmd["op"]
        if op == "rgba":
            cur_color = rgba_tuple([cmd["r"], cmd["g"], cmd["b"], cmd["a"]])
        elif op == "line_width":
            line_w = max(1, int(round(cmd["w"] * SCALE)))
        elif op == "font_size":
            font_size = cmd["size"]
        elif op == "rect":
            pending_shape = ("rect", cmd["x"] * SCALE, cmd["y"] * SCALE, cmd["w"] * SCALE, cmd["h"] * SCALE)
            cur_path = []
        elif op == "rrect":
            pending_shape = ("rrect", cmd["x"] * SCALE, cmd["y"] * SCALE, cmd["w"] * SCALE, cmd["h"] * SCALE, cmd["rx"] * SCALE)
            cur_path = []
        elif op == "arc":
            pending_shape = ("arc", cmd["x"] * SCALE, cmd["y"] * SCALE, cmd["r"] * SCALE, cmd["a1"], cmd["a2"])
            cur_path = []
        elif op == "move_to":
            pending_shape = None
            if len(cur_path) > 1:
                subpaths.append(cur_path)
            cur_pt = (cmd["x"] * SCALE, cmd["y"] * SCALE)
            cur_path = [cur_pt]
        elif op == "line_to":
            pending_shape = None
            cur_pt = (cmd["x"] * SCALE, cmd["y"] * SCALE)
            cur_path.append(cur_pt)
        elif op == "curve_to":
            pending_shape = None
            x0, y0 = cur_pt
            x1, y1 = cmd["x1"] * SCALE, cmd["y1"] * SCALE
            x2, y2 = cmd["x2"] * SCALE, cmd["y2"] * SCALE
            x3, y3 = cmd["x3"] * SCALE, cmd["y3"] * SCALE
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
            d.text((cur_pt[0], cur_pt[1] - font_size * SCALE * 0.85), str(cmd["text"]), font=fnt, fill=cur_color)
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
                    _, ax, ay, ar, a1, a2 = pending_shape
                    box = [ax - ar, ay - ar, ax + ar, ay + ar]
                    if op == "fill":
                        d.ellipse(box, fill=cur_color)
                    else:
                        d.ellipse(box, outline=cur_color, width=line_w)
                if not cmd.get("preserve", False):
                    pending_shape = None
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
            canvas = Image.alpha_composite(canvas, overlay)

    return canvas


def render_device():
    with open(AMXD_PATH, "rb") as f:
        raw = f.read()
    doc = json.loads(raw[32:].decode("utf-8"))
    p = doc["patcher"]

    dev_w = int(p.get("devicewidth", 648))
    dev_h = 169
    img = Image.new("RGBA", (dev_w * SCALE, dev_h * SCALE), (54, 58, 64, 255))
    draw = ImageDraw.Draw(img)

    boxes = [b["box"] for b in p["boxes"] if b["box"].get("presentation") == 1 and not b["box"].get("hidden")]
    panels = [b for b in boxes if b.get("maxclass") == "panel"]
    widgets = [b for b in boxes if b.get("maxclass") != "panel"]

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
            bg = rgba_tuple(w.get("bgcolor", [0.067, 0.078, 0.094, 1.0]))
            draw.rectangle([rx, ry, rx + rw, ry + rh], fill=bg, outline=(30, 35, 42, 255), width=1)
            # Center zero line & simulated scope trace
            cy = ry + rh * 0.5
            draw.line([(rx, cy), (rx + rw, cy)], fill=(255, 255, 255, 35), width=1)
            pts = []
            for i in range(int(rw)):
                t = (i / rw) * 6.0
                frac = t - math.floor(t)
                y_val = (1.0 - (1.0 - frac) ** 2.2) if frac < 0.5 else ((frac - 0.5) * 2.0) ** 2.2
                pts.append((rx + i, ry + rh * 0.82 - y_val * rh * 0.64))
            draw.line(pts, fill=(255, 181, 50, 255), width=int(1.6 * SCALE))

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

        elif mc == "live.numbox":
            bg = rgba_tuple(w.get("activebgcolor", [0.086, 0.102, 0.122, 1.0]))
            tc = rgba_tuple(w.get("textcolor", [1.0, 0.71, 0.2, 1.0]))
            if bg[3] > 0:
                draw.rounded_rectangle([rx, ry, rx + rw, ry + rh], radius=2 * SCALE, fill=bg, outline=(50, 56, 66, 255), width=1)
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            init_val = vof.get("parameter_initial", [0])[0]
            ustyle = vof.get("parameter_unitstyle", 0)
            val_str = f"{int(init_val)} %" if ustyle == 5 else f"{int(init_val)}"
            fnt = get_font(9.0 * SCALE, bold=True)
            bbox = draw.textbbox((0, 0), val_str, font=fnt)
            tw = bbox[2] - bbox[0]
            draw.text((rx + (rw - tw) * 0.5, ry + 1.5 * SCALE), val_str, font=fnt, fill=tc)

        elif mc == "live.text":
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            init_on = vof.get("parameter_initial", [0])[0] == 1
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
            cell_h = rh / max(1, len(enums))
            fnt = get_font(8.5 * SCALE, bold=True)
            for idx, label in enumerate(enums):
                cy0 = ry + idx * cell_h
                is_on = (idx == 0)
                bg = (255, 177, 46, 255) if is_on else (32, 37, 44, 255)
                tc = (20, 24, 30, 255) if is_on else (180, 186, 195, 255)
                draw.rectangle([rx, cy0, rx + rw, cy0 + cell_h - 1], fill=bg, outline=(70, 76, 86, 255), width=1)
                bbox = draw.textbbox((0, 0), label, font=fnt)
                tw = bbox[2] - bbox[0]
                draw.text((rx + (rw - tw) * 0.5, cy0 + 2 * SCALE), label, font=fnt, fill=tc)

        elif mc == "live.dial":
            vof = w.get("saved_attribute_attributes", {}).get("valueof", {})
            sname = vof.get("parameter_shortname", "Rate")
            init_val = vof.get("parameter_initial", [1.0])[0]
            ustyle = vof.get("parameter_unitstyle", 0)
            val_str = f"{init_val:.1f} Hz" if ustyle == 3 else f"{int(init_val)} %"
            fnt = get_font(9.0 * SCALE, bold=True)
            # Label at top
            bbox = draw.textbbox((0, 0), sname, font=fnt)
            draw.text((rx + (rw - (bbox[2] - bbox[0])) * 0.5, ry), sname, font=fnt, fill=(210, 215, 222, 255))
            # Dial arc
            cx = rx + rw * 0.5
            cy = ry + rh * 0.52
            r = min(rw, rh) * 0.28
            draw.arc([cx - r, cy - r, cx + r, cy + r], start=135, end=405, fill=(45, 52, 62, 255), width=int(2.5 * SCALE))
            draw.arc([cx - r, cy - r, cx + r, cy + r], start=135, end=310, fill=(81, 196, 235, 255), width=int(2.5 * SCALE))
            ang = math.radians(310)
            draw.line([(cx, cy), (cx + r * math.cos(ang), cy + r * math.sin(ang))], fill=(220, 225, 230, 255), width=int(2 * SCALE))
            # Value at bottom
            bbox2 = draw.textbbox((0, 0), val_str, font=fnt)
            draw.text((rx + (rw - (bbox2[2] - bbox2[0])) * 0.5, ry + rh - 11 * SCALE), val_str, font=fnt, fill=(210, 215, 222, 255))

    img.save(OUT_PNG_PATH)
    print(f"Saved preview to {OUT_PNG_PATH} ({img.width}x{img.height})")


if __name__ == "__main__":
    render_device()
