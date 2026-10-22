#!/usr/bin/env python3
"""Write mbsplit_test.als: the Live Set for scripts/test_mbsplit_live.js.

Two audio tracks plus the Ableton MCP Bridge on Main:
  "Multiband Split"  an Audio Effect Rack with four chains (Chain 1..4), each holding Multiband Split as its only device
                     (Auto: one band per chain, so the rack sums to the input)
  "Reference"        no devices (the level the rack output must match)
Reuses scripts/make_spectral_set.py (and through it make_delayplus_sets.py): set base, audio-track and rack templates, M4L device
element, pointee renumbering, validation. The .amxd is referenced by absolute path, so run this where the Set will be opened
(scripts/vm_mbsplit.sh live runs it inside the VM).

  python3 scripts/make_mbsplit_set.py [--out mbsplit_test.als]
"""
import argparse
import gzip
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as mds  # noqa: E402
import make_spectral_set as mss  # noqa: E402

REPO = mds.REPO
DEFAULT_OUT = os.path.join(REPO, "mbsplit_test.als")
CHAINS = ["Chain 1", "Chain 2", "Chain 3", "Chain 4"]


def build(args):
    base = gzip.open(args.base_set).read().decode("utf-8")
    scenes = base.count("<Scene Id=")
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
    slots = "<ClipSlotList>" + "".join(
        '<ClipSlot Id="%d"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot>' % i
        for i in range(scenes)) + "</ClipSlotList>"
    amxd = os.path.join(args.devices, "Multiband Split.amxd")
    if not os.path.isfile(amxd):
        sys.exit("missing device: %s" % amxd)
    tracks = []
    rack = rn(mss.rack_xml(amxd, out, "Multiband Split", CHAINS))
    tracks.append(rn(mds.fill(mds.tpl("audiotrack"), TRACKID=args.track_id, TRACKNAME=mds.esc("Multiband Split"), CLIPSLOTS=slots,
                              DEVICES="<Devices>\n" + rack + "\n</Devices>")))
    tracks.append(rn(mds.fill(mds.tpl("audiotrack"), TRACKID=args.track_id + 1, TRACKNAME=mds.esc("Reference"), CLIPSLOTS=slots,
                              DEVICES="<Devices>\n</Devices>")))
    base, n = re.subn(r"<Tracks>.*?</Tracks>", lambda m: "<Tracks>\n" + "\n".join(tracks) + "\n\t\t</Tracks>", base, count=1, flags=re.S)
    if n != 1:
        sys.exit("base set has no <Tracks>")
    base = re.sub(r'(<NextPointeeId Value=")\d+', lambda m: "%s%d" % (m.group(1), rn.n), base, count=1)
    mds.write_gz(out, base)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--devices", default=os.path.join(REPO, "devices"))
    ap.add_argument("--bridge", default=mds.DEFAULT_BRIDGE)
    ap.add_argument("--base-set", default=mds.DEFAULT_BASE_SET)
    ap.add_argument("--track-id", type=int, default=32)
    args = ap.parse_args()
    out = build(args)
    probs = mds.validate(out, True)
    print("wrote %s%s" % (out, "" if not probs else "  PROBLEMS: %s" % probs))
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
