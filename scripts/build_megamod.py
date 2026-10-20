#!/usr/bin/env python3
"""Build devices/Mega Modulator.amxd (shared core + src/megamod_ui.js + scripts/megamod_layout.json).

Usage: python3 scripts/build_megamod.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import megamod_common as mc  # noqa: E402


def main():
    patcher = mc.build_patcher()
    size = mc.write_amxd(patcher, mc.OUT_PATH)
    w = patcher["patcher"]["devicewidth"]
    print(f"Built {mc.OUT_PATH} [{int(w)}x169 px] ({size} bytes)")


if __name__ == "__main__":
    main()
