#!/usr/bin/env python3
"""Write glitch_test.als: a Live Set for the automated Glitch test (scripts/test_glitch_live.js).

The Set holds the Ableton MCP Bridge on the Main track and one audio track "Glitch" with devices/Glitch.amxd directly on it
(a Max Audio Effect, <MxDeviceAudioEffect>). Same machinery as scripts/make_delayplus_sets.py / make_sampler_set.py: the Set
base is the repo's ableton_mcp_bridge.als, the device element comes from the M4L template, pointee Ids are renumbered and
validated. The .amxd is referenced by absolute path (and relative to the Set), so run this where the Set will be opened:
scripts/vm_glitch.sh live runs it inside the VM.

  python3 scripts/make_glitch_set.py [--out glitch_test.als] [--glitch "devices/Glitch.amxd"]
"""
import argparse
import os
import re
import sys
import gzip

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as mds  # noqa: E402

REPO = mds.REPO
DEFAULT_GLITCH = os.path.join(REPO, "devices", "Glitch.amxd")
DEFAULT_OUT = os.path.join(REPO, "glitch_test.als")


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
    dev = mds.m4l_xml(args.glitch, out, 0)
    slots = "<ClipSlotList>" + "".join(
        '<ClipSlot Id="%d"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot>' % i
        for i in range(scenes)) + "</ClipSlotList>"
    track = mds.fill(mds.tpl("audiotrack"), TRACKID=args.track_id, TRACKNAME=mds.esc(args.track_name), CLIPSLOTS=slots,
                     DEVICES="<Devices>\n" + dev + "\n</Devices>")
    track = rn(track)
    base, n = re.subn(r"<Tracks>.*?</Tracks>", lambda m: "<Tracks>\n" + track + "\n\t\t</Tracks>", base, count=1, flags=re.S)
    if n != 1:
        sys.exit("base set has no <Tracks>")
    base = re.sub(r'(<NextPointeeId Value=")\d+', lambda m: "%s%d" % (m.group(1), rn.n), base, count=1)
    mds.write_gz(out, base)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--glitch", default=DEFAULT_GLITCH)
    ap.add_argument("--bridge", default=mds.DEFAULT_BRIDGE)
    ap.add_argument("--base-set", default=mds.DEFAULT_BASE_SET)
    ap.add_argument("--track-name", default="Glitch")
    ap.add_argument("--track-id", type=int, default=32)
    args = ap.parse_args()
    out = build(args)
    probs = mds.validate(out, True)
    print("wrote %s%s" % (out, "" if not probs else "  PROBLEMS: %s" % probs))
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
