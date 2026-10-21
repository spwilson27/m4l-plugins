#!/usr/bin/env python3
"""Write sampler_test.als: a Live Set for the automated Better Sampler test (scripts/test_sampler_live.js).

The Set holds the Ableton MCP Bridge on the Main track and one MIDI track "Better Sampler" with
devices/Better Sampler.amxd (a Max Instrument, <MxDeviceInstrument>).  Reuses the Delay+ generator's
machinery (scripts/make_delayplus_sets.py): the Set base is the repo's ableton_mcp_bridge.als, the M4L
device element comes from its MxDeviceAudioEffect template with the tag renamed, and every pointee Id
is renumbered and validated the same way.

The MIDI track template is the MidiTrack of Live's own
  Core Library/Defaults/Creating Tracks/MIDI Track/Default MIDI Track.als  (Live 12.4, gzip XML)
with the name, Id, clip slots and the track-level <Devices /> replaced by placeholders (zlib+base64
below).  The .amxd is referenced by absolute path (and by a path relative to the Set), so run this
where the Set will be opened: scripts/vm_sampler.sh live runs it inside the VM.

  python3 scripts/make_sampler_set.py [--out sampler_test.als] [--sampler "devices/Better Sampler.amxd"]
"""
import argparse
import gzip
import os
import re
import sys
import zlib
import base64

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as mds  # noqa: E402

REPO = mds.REPO
DEFAULT_SAMPLER = os.path.join(REPO, "devices", "Better Sampler.amxd")
DEFAULT_OUT = os.path.join(REPO, "sampler_test.als")

MIDITRACK_TPL = (
    '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'
)


def midi_tpl():
    return zlib.decompress(base64.b64decode("".join(MIDITRACK_TPL))).decode()


def build(args):
    base = gzip.open(args.base_set).read().decode("utf-8")
    scenes = base.count("<Scene Id=")
    if not scenes:
        sys.exit("base set has no scenes: %s" % args.base_set)
    out = os.path.abspath(args.out)
    # Main track bridge device: repoint at --bridge (same patch as make_delayplus_sets.build_als)
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
    # the Max Instrument: the audio-effect element with the instrument tag (Live reads the IO from the patch)
    dev = mds.m4l_xml(args.sampler, out, 0)
    dev = dev.replace("<MxDeviceAudioEffect", "<MxDeviceInstrument").replace("</MxDeviceAudioEffect>", "</MxDeviceInstrument>")
    slots = "<ClipSlotList>" + "".join(
        '<ClipSlot Id="%d"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot>' % i
        for i in range(scenes)) + "</ClipSlotList>"
    track = mds.fill(midi_tpl(), TRACKID=args.track_id, TRACKNAME=mds.esc(args.track_name), CLIPSLOTS=slots,
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
    ap.add_argument("--sampler", default=DEFAULT_SAMPLER)
    ap.add_argument("--bridge", default=mds.DEFAULT_BRIDGE)
    ap.add_argument("--base-set", default=mds.DEFAULT_BASE_SET)
    ap.add_argument("--track-name", default="Better Sampler")
    ap.add_argument("--track-id", type=int, default=32)
    args = ap.parse_args()
    out = build(args)
    probs = mds.validate(out, True)
    print("wrote %s%s" % (out, "" if not probs else "  PROBLEMS: %s" % probs))
    return 1 if probs else 0


if __name__ == "__main__":
    sys.exit(main())
