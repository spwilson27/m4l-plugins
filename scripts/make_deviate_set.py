#!/usr/bin/env python3
"""Write deviate_test.als: a Live Set for the automated Deviate test (scripts/test_deviate_live.js).

The Set holds the Ableton MCP Bridge on the Main track and one audio track per built face (every `Deviate *.amxd` in --devices-dir,
sorted; the track is named after the device, e.g. "Deviate Stub") with the .amxd directly on it (a Max Audio Effect). With --midi (the
default) it also writes one empty MIDI track "Deviate MIDI Src" (the live test creates its looping clip through the LOM) that the
MIDI From check routes into a device. Same machinery as scripts/make_glitch_set.py / make_sampler_set.py (base = the repo's
ableton_mcp_bridge.als, pointee Ids renumbered, validated). The .amxd files are referenced by ABSOLUTE path (and relative to the Set),
so run this where the Set will be opened: scripts/vm_deviate.sh live runs it inside the VM.

  python3 scripts/make_deviate_set.py [--devices-dir devices] [--out deviate_test.als] [--no-midi] [--bridge ..] [--base-set ..] [--track-id 32]
"""
import argparse
import glob
import gzip
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as mds  # noqa: E402
import make_sampler_set as mss  # noqa: E402  (its MIDI track template)

REPO = mds.REPO
DEFAULT_OUT = os.path.join(REPO, "deviate_test.als")
MIDI_NAME = "Deviate MIDI Src"


def clip_slots(scenes):
    return "<ClipSlotList>" + "".join(
        '<ClipSlot Id="%d"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot>' % k
        for k in range(scenes)) + "</ClipSlotList>"


def build(args):
    base = gzip.open(args.base_set).read().decode("utf-8")
    scenes = base.count("<Scene Id=")
    if not scenes:
        sys.exit("base set has no scenes: %s" % args.base_set)
    out = os.path.abspath(args.out)
    bridge = os.path.abspath(args.bridge)
    if not os.path.isfile(bridge):
        sys.exit("missing bridge .amxd: %s" % bridge)
    devs = sorted(glob.glob(os.path.join(os.path.abspath(args.devices_dir), "Deviate *.amxd")))
    if not devs:
        sys.exit("no Deviate *.amxd in %s" % args.devices_dir)
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
    tracks = ""
    tid = args.track_id
    for path in devs:
        dev = mds.m4l_xml(path, out, 0)
        name = os.path.splitext(os.path.basename(path))[0]
        track = mds.fill(mds.tpl("audiotrack"), TRACKID=tid, TRACKNAME=mds.esc(name), CLIPSLOTS=clip_slots(scenes),
                         DEVICES="<Devices>\n" + dev + "\n</Devices>")
        tracks += rn(track) + "\n"
        tid += 1
    if args.midi:
        track = mds.fill(mss.midi_tpl(), TRACKID=tid, TRACKNAME=mds.esc(MIDI_NAME), CLIPSLOTS=clip_slots(scenes),
                         DEVICES="<Devices />")
        tracks += rn(track) + "\n"
    base, n = re.subn(r"<Tracks>.*?</Tracks>", lambda m: "<Tracks>\n" + tracks + "\t\t</Tracks>", base, count=1, flags=re.S)
    if n != 1:
        sys.exit("base set has no <Tracks>")
    base = re.sub(r'(<NextPointeeId Value=")\d+', lambda m: "%s%d" % (m.group(1), rn.n), base, count=1)
    mds.write_gz(out, base)
    return out, [os.path.basename(d) for d in devs]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--devices-dir", default=os.path.join(REPO, "devices"))
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--bridge", default=mds.DEFAULT_BRIDGE)
    ap.add_argument("--base-set", default=mds.DEFAULT_BASE_SET)
    ap.add_argument("--track-id", type=int, default=32)
    ap.add_argument("--midi", dest="midi", action="store_true", default=True, help="add the empty MIDI source track (default)")
    ap.add_argument("--no-midi", dest="midi", action="store_false")
    args = ap.parse_args()
    out, names = build(args)
    probs = mds.validate(out, True)
    print("wrote %s (%s)%s" % (out, ", ".join(names), "" if not probs else "  PROBLEMS: %s" % probs))
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
