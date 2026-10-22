#!/usr/bin/env python3
"""Write xo_test.als: a Live Set for the automated XO Sample Map test (scripts/test_xo_live.js).

The Set holds the Ableton MCP Bridge on the Main track and three audio tracks with devices/XO Sample Map.amxd:
track 1 "XO Sample Map" (instance 1, directly on the track), track 2 "XO Sample Map 2" (instance 2) and track 3
"XO Sample Map Rack" (instance 3 inside an Audio Effect Rack chain), for the hotkey-selection test.  Reuses the Delay+ generator's machinery
(scripts/make_delayplus_sets.py): base set = the repo's ableton_mcp_bridge.als, audio track and M4L
device templates, pointee renumbering and validation.  The .amxd is referenced by absolute path (and a
path relative to the Set), so run this where the Set will be opened: scripts/vm_xo.sh live runs it in the VM.

  python3 scripts/make_xo_set.py [--out xo_test.als] [--xo "devices/XO Sample Map.amxd"]
"""
import argparse
import gzip
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as mds  # noqa: E402

REPO = mds.REPO
DEFAULT_XO = os.path.join(REPO, "devices", "XO Sample Map.amxd")
DEFAULT_OUT = os.path.join(REPO, "xo_test.als")


def build(args):
    base = gzip.open(args.base_set).read().decode("utf-8")
    scenes = base.count("<Scene Id=")
    if not scenes:
        sys.exit("base set has no scenes: %s" % args.base_set)
    out = os.path.abspath(args.out)
    bridge = os.path.abspath(args.bridge)
    if not os.path.isfile(bridge):
        sys.exit("missing bridge .amxd: %s" % bridge)
    mt = base.find("<MainTrack")
    pm = re.compile(r'(<MxPatchRef Id="\d+">\s*<FileRef>\s*<RelativePathType Value=")\d+(" />\s*<RelativePath Value=")[^"]*'
                    r'(" />\s*<Path Value=")[^"]*(" />.*?<OriginalFileSize Value=")\d+(" />\s*<OriginalCrc Value=")\d+'
                    r'(" />.*?<LastModDate Value=")\d+', re.S)
    st = os.stat(bridge)
    rel = os.path.relpath(bridge, os.path.dirname(out))
    tail, n = pm.subn(lambda m: "%s1%s%s%s%s%s%d%s0%s%d" % (
        m.group(1), m.group(2), mds.esc(rel), m.group(3), mds.esc(bridge), m.group(4), st.st_size, m.group(5),
        m.group(6), int(st.st_mtime)), base[mt:], count=1)
    if n != 1:
        sys.exit("base set: no Max device found on the Main track")
    base = base[:mt] + tail
    rn = mds.Renumber(int(re.search(r'<NextPointeeId Value="(\d+)"', base).group(1)))
    dev = mds.m4l_xml(args.xo, out, 0)
    slots = "<ClipSlotList>" + "".join(
        '<ClipSlot Id="%d"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot>' % i
        for i in range(scenes)) + "</ClipSlotList>"
    tracks = []
    for i in range(3):
        devs = "<Devices>\n" + dev + "\n</Devices>"
        name = args.track_name + ("" if i == 0 else " 2" if i == 1 else " Rack")
        if i == 2:  # instance 3 lives inside an Audio Effect Rack chain
            rack = mds.fill(mds.tpl("alsrack"), RACKID=0, NAME=mds.esc("XO Rack"), DEVICES="<Devices>\n" + dev + "\n</Devices>").replace(
                '<AreDevicesVisible Value="false" />', '<AreDevicesVisible Value="true" />')
            devs = "<Devices>\n" + rack + "\n</Devices>"
        track = mds.fill(mds.tpl("audiotrack"), TRACKID=args.track_id + i, TRACKNAME=mds.esc(name), CLIPSLOTS=slots, DEVICES=devs)
        tracks.append(rn(track))
    track = "\n".join(tracks)
    base, n = re.subn(r"<Tracks>.*?</Tracks>", lambda m: "<Tracks>\n" + track + "\n\t\t</Tracks>", base, count=1, flags=re.S)
    if n != 1:
        sys.exit("base set has no <Tracks>")
    base = re.sub(r'(<NextPointeeId Value=")\d+', lambda m: "%s%d" % (m.group(1), rn.n), base, count=1)
    mds.write_gz(out, base)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--xo", default=DEFAULT_XO)
    ap.add_argument("--bridge", default=mds.DEFAULT_BRIDGE)
    ap.add_argument("--base-set", default=mds.DEFAULT_BASE_SET)
    ap.add_argument("--track-name", default="XO Sample Map")
    ap.add_argument("--track-id", type=int, default=32)
    args = ap.parse_args()
    out = build(args)
    probs = mds.validate(out, True)
    print("wrote %s%s" % (out, "" if not probs else "  PROBLEMS: %s" % probs))
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
