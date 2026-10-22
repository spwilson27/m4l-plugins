#!/usr/bin/env python3
"""Generate the Live 12 rack preset / test set for the two-device "Reverb+" (Start + End in one Audio
Effect Rack chain, user FX in between). Same generator as Delay+ (scripts/make_delayplus_sets.py: gzipped XML
from templates extracted from real Live 12.4 files); this wrapper only changes the defaults.

  --adg OUT.adg   rack preset: one chain holding [Start .amxd] [--middle devices] [End .amxd]
  --als OUT.als   Live Set: Ableton MCP Bridge on Main + one track per --track "Name::start.amxd"
                  (default track "Reverb+ Test")
Examples (see scripts/build_reverbplus.py):
  make_reverbplus_sets.py --start "devices/Reverb+.amxd" --end "devices/Reverb+ End.amxd" --adg devices/Reverb+.adg
  make_reverbplus_sets.py --start ... --end ... --middle limiter --als reverbplus_test.als --track "Reverb+ 1::devices/Reverb+.amxd"
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as base  # noqa: E402


def main():
    argv = sys.argv[1:]
    if "--name" not in argv:
        argv += ["--name", "Reverb+"]
    if "--track-name" not in argv:
        argv += ["--track-name", "Reverb+ Test"]
    sys.argv = [sys.argv[0]] + argv
    return base.main()


if __name__ == "__main__":
    sys.exit(main())
