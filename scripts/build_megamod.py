#!/usr/bin/env python3
"""Build devices/Mega Modulator A.amxd, B.amxd and C.amxd (shared core + per-variant UI script and layout JSON).

Usage: python3 scripts/build_megamod.py [a b c]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import megamod_common as mc  # noqa: E402


def main():
    keys = [k.lower() for k in sys.argv[1:]] or list(mc.VARIANTS)
    for key in keys:
        patcher = mc.build_patcher(key)
        size = mc.write_amxd(patcher, mc.out_path_for(key))
        w = patcher["patcher"]["devicewidth"]
        print(f"Built {mc.out_path_for(key)} [{int(w)}x169 px] ({size} bytes)")


if __name__ == "__main__":
    main()
