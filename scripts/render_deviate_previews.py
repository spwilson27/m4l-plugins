#!/usr/bin/env python3
"""Render the Deviate preview stills: previews/deviate_<face>.png (state `hit`), _idle.png and _extreme.png.

  python3 scripts/render_deviate_previews.py [face ...]      faces by name ("stub", "roulette", ...); default: every devices/Deviate *.amxd
Each state is passed to the face as `var DV_PREVIEW_STATE = '<state>';` through render_device's v8 prelude. Exits 1 if any render raises.
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_preview as rp  # noqa: E402

ROOT = os.path.dirname(HERE)
STATES = [("hit", ""), ("idle", "_idle"), ("extreme", "_extreme")]


def main(argv):
    devices = sorted(glob.glob(os.path.join(ROOT, "devices", "Deviate *.amxd")))
    if argv:
        want = [re.sub(r"[^a-z0-9]+", "", a.lower()) for a in argv]
        devices = [d for d in devices if re.sub(r"[^a-z0-9]+", "", os.path.basename(d)[len("Deviate "):-5].lower()) in want]
        if not devices:
            print("no matching device for %s" % argv, file=sys.stderr)
            return 1
    failed = 0
    for d in devices:
        for state, suffix in STATES:
            try:
                rp.render_device(d, out_suffix=suffix, v8_prelude="var DV_PREVIEW_STATE = '%s';" % state)
                print("rendered %s [%s]" % (os.path.basename(d), state))
            except Exception as e:  # noqa: BLE001
                failed += 1
                print("FAILED %s [%s]: %s" % (os.path.basename(d), state, e), file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
