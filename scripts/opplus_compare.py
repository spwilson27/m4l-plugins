#!/usr/bin/env python3
"""Side-by-side comparison of Operator+ with Live's Operator, per section.

  python3 scripts/opplus_compare.py [--live <dir>]
For every section / view it builds a scratch Operator+ with that state saved (OP_SECTION / OP_VIEW), renders it with
scripts/render_preview.py (or, with --live, takes <dir>/<name>.png: crops of Operator+ in Live made by scripts/test_opplus_live.js),
and writes previews/opplus_compare/<name>.png: Operator (top) over Operator+ (bottom), plus a mean absolute pixel difference.
References: tests/out/opplus_ref/sec_*.png (2x VM screenshots, device at crop (19, 41), 1450 x 338).
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageStat

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REF = os.path.join(ROOT, "tests", "out", "opplus_ref")
OUT = os.path.join(ROOT, "previews", "opplus_compare")
CASES = [("A", 0, None), ("B", 1, None), ("C", 2, None), ("D", 3, None), ("LFO", 4, None), ("Filter", 5, None),
         ("Pitch", 6, None), ("Global", 7, None), ("A_osc", 0, 1), ("Filter_disp", 5, 1)]


def ref_crop(name):
    return Image.open(os.path.join(REF, "sec_%s.png" % name)).convert("RGB").crop((19, 41, 19 + 1450, 41 + 338))


def render(sec, view, tmp):
    env = dict(os.environ, OP_SECTION=str(sec))
    if view is not None:
        env["OP_VIEW"] = str(view)
    dev = os.path.join(tmp, "Operator+.amxd")
    subprocess.run([sys.executable, os.path.join(HERE, "build_opplus.py"), "--out", dev], env=env, check=True, capture_output=True)
    subprocess.run([sys.executable, os.path.join(HERE, "render_preview.py"), dev], env=env, check=True, capture_output=True, cwd=tmp)
    png = [f for f in os.listdir(os.path.join(ROOT, "previews")) if f == "operator.png"]
    return Image.open(os.path.join(ROOT, "previews", png[0])).convert("RGB")


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    live = argv[argv.index("--live") + 1] if "--live" in argv else None
    keep = Image.open(os.path.join(ROOT, "previews", "operator.png")) if os.path.exists(os.path.join(ROOT, "previews", "operator.png")) else None
    keep = keep.copy() if keep else None
    scores = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, sec, view in CASES:
            r = ref_crop(name)
            m = Image.open(os.path.join(live, name + ".png")).convert("RGB").resize(r.size) if live else render(sec, view, tmp).resize(r.size)
            d = ImageStat.Stat(ImageChops.difference(r, m)).mean
            score = sum(d) / 3.0
            o = Image.new("RGB", (r.width, r.height * 2 + 8), (255, 0, 255))
            o.paste(r, (0, 0))
            o.paste(m, (0, r.height + 8))
            o.save(os.path.join(OUT, name + ".png"))
            scores.append((name, score))
            print("%-12s mean |diff| %.1f" % (name, score))
    if keep is not None:
        keep.save(os.path.join(ROOT, "previews", "operator.png"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
