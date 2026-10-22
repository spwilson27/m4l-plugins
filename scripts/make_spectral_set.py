#!/usr/bin/env python3
"""Write spectral_test.als: a Live Set for the automated Spectral Split test (scripts/test_spectral_live.js).

The Set holds the Ableton MCP Bridge on the Main track and one audio track per Spectral Split device. Each track holds an
Audio Effect Rack with one chain per output channel, and every chain holds the device as its only device (Output = Auto),
exactly like devices/<Name>.adg. Reuses the Delay+ generator's machinery (scripts/make_delayplus_sets.py): Set base =
ableton_mcp_bridge.als, the audio-track and rack templates, the M4L device element, pointee renumbering and validation.
The .amxd files are referenced by absolute path (and relative to the Set), so run this where the Set will be opened:
scripts/vm_spectral.sh live runs it inside the VM.

  python3 scripts/make_spectral_set.py [--out spectral_test.als]
"""
import argparse
import gzip
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as mds  # noqa: E402
import make_spectral_rack as msr  # noqa: E402

REPO = mds.REPO
DEFAULT_OUT = os.path.join(REPO, "spectral_test.als")

# (track name, .amxd, chain names in channel order)
DEVICES = [
    ("Transient Split", "Transient Split.amxd", ["Transients", "Tones"]),
    ("Loud Split", "Loud Split.amxd", ["Loud", "Mid", "Quiet"]),
    ("Harmonic Split", "Harmonic Split.amxd", ["Nonharmonics", "Harmonics A", "Harmonics B"]),
    ("Freq Split", "Freq Split.amxd", ["Red", "Blue", "Yellow", "Magenta"]),
]


def rack_xml(amxd, out, rack_name, chains):
    t = mds.tpl("alsrack")
    a = t.find("<Branches>") + len("<Branches>")
    b = t.find("</Branches>")
    branch = t[a:b]
    parts = []
    for i, name in enumerate(chains):
        dev = mds.m4l_xml(amxd, out, 0)
        x = branch.replace("@@NAME@@", mds.esc(name)).replace("@@DEVICES@@", "<Devices>\n" + dev + "\n</Devices>")
        x = x.replace('<AudioEffectBranch Id="0">', '<AudioEffectBranch Id="%d">' % i, 1)
        ci = msr.chain_color(name)
        if ci is not None:
            x, n = re.subn(r'<Color Value="\d+" />(\s*)<AutoColored Value="true" />',
                           lambda m: '<Color Value="%d" />%s<AutoColored Value="false" />' % (ci, m.group(1)), x, count=1)
            if n != 1:
                sys.exit("set template branch has no colour fields")
        if i:
            x = x.replace('<IsSelected Value="true" />', '<IsSelected Value="false" />', 1)
        parts.append(x)
    t = t[:a] + "\n".join(parts) + t[b:]
    t = mds.fill(t, RACKID=0, NAME=mds.esc(rack_name))
    return t.replace('<AreDevicesVisible Value="false" />', '<AreDevicesVisible Value="true" />')


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
    tracks = []
    for i, (tname, file, chains) in enumerate(DEVICES):
        amxd = os.path.join(args.devices, file)
        if not os.path.isfile(amxd):
            sys.exit("missing device: %s" % amxd)
        rack = rn(rack_xml(amxd, out, tname, chains))
        track = mds.fill(mds.tpl("audiotrack"), TRACKID=args.track_id + i, TRACKNAME=mds.esc(tname), CLIPSLOTS=slots,
                         DEVICES="<Devices>\n" + rack + "\n</Devices>")
        tracks.append(rn(track))
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
