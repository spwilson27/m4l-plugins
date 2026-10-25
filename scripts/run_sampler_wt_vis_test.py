#!/usr/bin/env python3
"""Visual check for the Reactive 2 wavetable scan and frame stack (tart VM).

scripts/vm_sampler.sh wtvis loads the device, forces a modulated frame and a Resonance row,
then the host photographs the VM and checks the picture:
the scan has the orange square and no light triangle beside it, and the stack has a grey
trace and a bright trace on different frames. The matrix labels come back from the device.
"""
import json
import os
import struct
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_sampler_wt_face_test as face  # noqa: E402


def fail(msg):
    print("FAIL", msg)
    sys.exit(1)


def load_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        fail("not a png: %s" % path)
    pos = 8
    w = h = color = 0
    raw = b""
    while pos + 8 <= len(data):
        n, typ = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if typ == b"IHDR":
            w, h, bit, color = struct.unpack(">IIBB", chunk[:10])
            if bit != 8 or color not in (2, 6):
                fail("png is not 8-bit rgb (%s bit %s color %s)" % (path, bit, color))
        elif typ == b"IDAT":
            raw += chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(raw)
    bpp = 3 if color == 2 else 4
    rows = []
    i = 0
    stride = w * bpp
    prev = bytearray(stride)
    for _y in range(h):
        filt = raw[i]
        i += 1
        row = bytearray(raw[i:i + stride])
        i += stride
        if filt == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif filt == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif filt == 4:
            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                row[x] = (row[x] + pr) & 255
        elif filt != 0:
            fail("png filter %s" % filt)
        prev = row
        rows.append(row)
    return w, h, bpp, rows


def pix(rows, bpp, x, y):
    i = x * bpp
    r = rows[y]
    return r[i], r[i + 1], r[i + 2]


def _orange(c):
    r, g, b = c
    return r > 180 and g > 100 and b < 150 and r > g and r > b + 30


def _hairlines(rows, bpp, w, h):
    """Vertical position tracks: a blue-grey column, not the orange frame stroke."""
    lines = []
    for x in range(w):
        run = best = best_y = yb = 0
        for y in range(h):
            r, g, b = pix(rows, bpp, x, y)
            if 25 < r < 90 and g > r + 4 and b > g + 2:
                if run == 0:
                    yb = y
                run += 1
                if run > best:
                    best, best_y = run, yb
            else:
                run = 0
        if best >= 24:
            lines.append((x, best_y, best))
    return lines


def check_frame_box(rows, bpp, w, h):
    """The hollow frame box must be a closed square sitting clear of the position track.

    A slider thumb drawn on top of the box shortens the bottom edge and the right edge.
    The box is the orange square just left of the hairline, so a checkbox elsewhere
    cannot satisfy the check.
    """
    orange = []
    for y in range(h):
        for x in range(w):
            r, g, b = pix(rows, bpp, x, y)
            if r > 180 and g > 100 and b < 160 and r > g + 20 and r > b + 40:
                orange.append((x, y))
    lines = _hairlines(rows, bpp, w, h)
    best = None
    seen = []
    for x0, y0 in orange:
        if any(abs(x0 - sx) <= 20 and abs(y0 - sy) <= 16 for sx, sy in seen):
            continue
        xs = [x for x, y in orange if abs(y - y0) <= 16 and abs(x - x0) <= 20]
        ys = [y for x, y in orange if abs(y - y0) <= 16 and abs(x - x0) <= 20]
        seen.append((x0, y0))
        if len(xs) < 12:
            continue
        bw, bh = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        if not (8 <= bw <= 28 and 8 <= bh <= 28 and abs(bw - bh) <= 6):
            continue
        bx, by = min(xs), min(ys)
        # On a full screen the device sits in the lower half. Menu-bar squares are not the handle.
        if h >= 400 and by < h * 0.55:
            continue
        # A covered box still overlaps the track, so a negative gap is the bug, not a miss.
        # The position track is the long hairline. A full screenshot ignores short chrome.
        min_len = 70 if h >= 400 else 24
        near = [lx for lx, ly, ln in lines
                if ln >= min_len and -16 <= lx - (bx + bw) <= 24
                and ly - 56 <= by + bh / 2 <= ly + ln + 8]
        if not near:
            continue
        cand = (bx, by, bw, bh, len(xs), min(near))
        if best is None or cand[4] < best[4]:
            best = cand
    if best is None:
        fail("the frame box is not beside the position track")
    x0, y0, bw, bh, _n, line_x = best

    def span(y):
        cols = [x for x, yy in orange if yy == y and x0 - 1 <= x <= x0 + bw]
        return (min(cols), max(cols)) if cols else None

    top = span(y0)
    bot = span(y0 + bh - 1)
    if bot is None or (bot[1] - bot[0]) < bw * 0.6:
        bot = span(y0 + bh - 2)
    print("frame box", best[:4], "line", line_x, "top", top, "bottom", bot)
    if not top or not bot:
        fail("the frame box has no top or bottom edge")
    if abs((top[1] - top[0]) - (bot[1] - bot[0])) > 2:
        fail("the frame box is cut off (top %s, bottom %s)" % (top, bot))
    right = [y for x, y in orange if x >= x0 + bw - 2 and y0 <= y <= y0 + bh - 1]
    if not right or max(right) - min(right) < bh - 4:
        fail("the frame box right edge does not reach the bottom")
    print("frame box closed")


def check_shot(path):
    w, h, bpp, rows = load_png(path)
    # The device sits above the dock. An orange column there is the frame scan.
    y_lo = int(h * 0.74)
    y_hi = int(h * 0.86)
    line_x, line_n, line_y0 = None, 0, 0
    for x in range(w):
        run = best = yb = 0
        for y in range(y_lo, y_hi):
            if _orange(pix(rows, bpp, x, y)):
                if run == 0:
                    yb = y
                run += 1
                if run > best:
                    best = run
            else:
                run = 0
        if best > line_n:
            line_n, line_x, line_y0 = best, x, yb
    print("scan line", line_x, "from", line_y0, "len", line_n)
    if line_x is None or line_n < 40:
        fail("the frame scan is not in the picture")
    light = 0
    for y in range(line_y0, min(y_hi, line_y0 + line_n)):
        for x in range(line_x + 8, min(w - 1, line_x + 32)):
            r, g, b = pix(rows, bpp, x, y)
            if r > 220 and g > 220 and b > 210:
                light += 1
    print("light pixels beside the scan", light)
    if light > 40:
        fail("a light triangle is still drawn beside the frame square (%d px)" % light)
    # The bright frame is the pale stroke just right of the scan. The grey pivot is a second stroke
    # in that span, on another row, and it is not a solid panel.
    x0 = line_x + 16
    x1 = min(w - 1, line_x + 420)
    span = x1 - x0
    bright_y, bright_n = None, 0
    for y in range(y_lo, y_hi):
        n = 0
        for x in range(x0, x1):
            r, g, b = pix(rows, bpp, x, y)
            if max(r, g, b) > 175 and (b > r + 15 or _orange((r, g, b))):
                n += 1
        if 25 < n < span * 0.5 and n > bright_n:
            bright_n, bright_y = n, y
    print("bright frame", bright_y, "px", bright_n)
    if bright_y is None:
        fail("the bright modulated frame is not in the picture")
    grey_y, grey_n = None, 0
    for y in range(max(y_lo, bright_y - 70), min(y_hi, bright_y + 70)):
        if abs(y - bright_y) < 8:
            continue
        n = 0
        for x in range(x0, x1):
            r, g, b = pix(rows, bpp, x, y)
            if 115 < r < 185 and abs(r - g) < 16 and abs(g - b) < 20:
                n += 1
        if 25 < n < span * 0.45 and n > grey_n:
            grey_n, grey_y = n, y
    print("grey frame", grey_y, "px", grey_n)
    if grey_y is None:
        fail("the grey unmodulated frame is not in the picture")
    if abs(grey_y - bright_y) < 8:
        fail("the grey frame and the bright frame sit on the same line")
    print("wavetable picture ok")
    check_frame_box(rows, bpp, w, h)


def setup():
    if os.environ.get("BS_WTVIS_VM") != "1":
        fail("this arranges Live; run it with scripts/vm_sampler.sh wtvis")
    info = face.prepare()
    print("device", json.dumps(info))
    if not info or not info.get("path"):
        fail("Reactive 2 is not on a track")
    face.show_device(info)
    faces = face.show_osc(0)
    print("osc faces", faces.get("play_pos"))
    face.rpc('messnamed("#0-bsdebug", "dbg_r2_wtvis", 0.82); return 1;')
    marks = ""
    for _ in range(30):
        time.sleep(0.1)
        marks = face.rpc('var g = new Global("bs_r2_wtvis"); return String(g.text || "");')
        if str(marks).split(",")[-3:-2] == ["1"] or (len(str(marks).split(",")) >= 3 and str(marks).split(",")[2] == "1"):
            break
    print("frame marks", marks)
    parts = str(marks or "").split(",")
    if len(parts) < 3 or parts[2] != "1":
        fail("the device did not split the knob and the modulated frame (%s)" % marks)
    face.rpc('messnamed("#0-bsdebug", "dbg_r2_labels"); return 1;')
    time.sleep(0.5)
    labels = face.rpc('var g = new Global("bs_r2_labels"); return String(g.text || "");')
    print("labels", labels)
    names = str(labels or "").split("|")
    if "Resonance" not in names:
        fail("the matrix did not label filt_res as Resonance (%s)" % labels)
    if any(n.startswith("filt_") or n.startswith("Osc 1 Warp") for n in names):
        fail("a raw key or Osc 1 Warp is still a row (%s)" % labels)
    meta = os.environ.get("BS_WTVIS_META", "/tmp/bs_wtvis_ready")
    with open(meta, "w", encoding="utf-8") as f:
        f.write(str(labels) + "\n" + str(marks) + "\n")
    print("ready", meta)
    done = os.environ.get("BS_WTVIS_DONE", "/tmp/bs_wtvis_done")
    for _ in range(80):
        if os.path.exists(done):
            return
        time.sleep(0.25)
    fail("the host did not photograph the device")


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--check":
        check_shot(sys.argv[2])
        return
    setup()


if __name__ == "__main__":
    main()
