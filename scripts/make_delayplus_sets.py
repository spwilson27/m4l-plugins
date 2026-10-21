#!/usr/bin/env python3
"""Generate Ableton Live 12 files for the two-device "Delay+" Max for Live delay.

Delay+ needs a Start device and an End device in the same rack chain with user
FX between them.  This script writes (gzipped XML, stdlib only):

  --adg OUT.adg   Audio Effect Rack preset: one chain "Delay+" holding
                  [Start .amxd] [--middle devices] [End .amxd].
  --als OUT.als   Live Set: Ableton MCP Bridge on the Main (master) track and
                  one audio track "Delay+ Test" holding the same rack.

Examples:
  python3 scripts/make_delayplus_sets.py --start "devices/Delay Start.amxd" \\
      --end "devices/Delay End.amxd" --middle limiter --adg out/Delay+.adg --als out/test.als

--middle accepts none (default) or a comma list of native devices (limiter).
"limiter" is a native Limiter with Lookahead at its maximum (6 ms), so the chain
reports nonzero latency (handy for testing latency compensation).

Nothing here opens Live.  The XML is built from templates extracted from real
Live 12.4 files (see TEMPLATE PROVENANCE) and renumbered so every pointee Id
(AutomationTarget / ModulationTarget / Pointee) in a Set is unique.

M4L file references: each .amxd is stored as <MxPatchRef><FileRef> with
RelativePathType 1 (relative to the saved file), a RelativePath computed from
the output file's directory, the absolute Path as fallback, the real file size
and mtime.  No patcher copy is embedded (the BlobSlot is empty), so Live loads
the .amxd from disk each time the Set/rack is opened and a rebuilt .amxd is
picked up.  OriginalCrc is written as 0 (Live's CRC variant is not reproduced).

TEMPLATE PROVENANCE (zlib+base64 below, regenerate by re-extracting):
  adg      Live 12.4.1 rack preset ("random redux.adg": GroupDevicePreset with one
           AudioEffectBranchPreset), DevicePresets emptied.
  alsrack  AudioEffectGroupDevice from a Live 12.4.6 Set (one AudioEffectBranch).
  audiotrack  Live 12.4.6 AudioTrack with clips/devices stripped.
  m4l      MxDeviceAudioEffect from ableton_mcp_bridge.als (Live 12.4.6).
  limiter  Core Library/Defaults/Audio Effects/Limiter.adv (Lookahead param set).
The Set base is the repo's ableton_mcp_bridge.als (Main track + bridge device,
scenes, transport); its Tracks list is replaced with the audio track.
"""
import argparse
import base64
import gzip
import os
import re
import sys
import xml.etree.ElementTree as ET
import zlib
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_BRIDGE = os.path.join(REPO, "devices", "Ableton MCP Bridge.amxd")
DEFAULT_BASE_SET = os.path.join(REPO, "ableton_mcp_bridge.als")

TEMPLATES = {
    'audiotrack': (
        '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'
    ),
    'alsrack': (
        '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'
        'PT0dC6XgOapkW7iklfuOtE//A3WaLYg='
    ),
    'adg': (
        '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'
        'B88DmDeB5fF8KGfC+aGWvaof3v0Hnj92UQ=='
    ),
    'm4l': (
        'eNrtV11P2zAUfe5+RcUfCJQNhBRQoSkiEv1QU5jEm2luqYVrR7ZDy6b999lOQ+zEaZn2sof1oap8j6/vx7nHbjjaRvCGF3Cdp5gN'
        'l0tYyG6cXh71+9HwMY76/aOrL53iE96zdZx2HxHJ4fLo+Kgb1EyPGDZ+cyyG2wzRFD62S56DA7nhgF5ZLpvQJSLCxU7ox+99UXXC'
        'EaI5Im1ndsLrXLI1kpjROeIvUKR+2ru46FVpmyMWr0P6BoRl0HJSUHdlR4FTPBhM6GS5nK84iBUjqbD9jzAt3Z59dfzqFLal7aR3'
        'Xjt0v+cwsAoVjliaExNgwnK+gAHLqfS3a4o4WoMELu6xkN85yjLgXVPoBpRhKgE+Cnfq0gIJmQBRpIJ0jteAngnEqrfbFhZZ8AHB'
        'WVnzA1umKnOQM1hapTFgGxj4kaa3kCYLjjMpXM7eqmruo2GyYjlJ1fem8DtWRWvl94MAbgMc4zWlTJreeM1lw1Slt3Jvkn5kOMpg'
        'iuVidQM0VYGIeU4xfWmNVQ9yhCQqAT9/ueP3BnzDsYQpZ1I1S4U9ztfPiiI7/Onx+Zmbn1aXSS6zXB6mlAHH9FNYPQCf9auxn3Q7'
        'RapYCWGNYjuTuTUwxaZu4cEydsJbTMChpF6cgZ7AN1AbV/P3SkxO3KGvIUtUvz8b3itFrmNdzPVN4sHYp/Ua1ntz0uK1jaAOqFLb'
        'BmTC8QumiOjkE/wDqqiS+GnoCavcMOCLCjuYDTzQgtp3uBKtGiQMPDU3AqGkT9HZimY0iRonuFNWt6F1RuBBoBcnguOaWAcVJ2yZ'
        'dqkTBk16VZKruWntddadUffvMLyLOMtqfuxlx40XH8apSqHm4mPN2d9EhjeEPR8enkjDzOScuJNj1t3y3yFh61HjIjeVNw73lb0R'
        'VzhTDw59Jwk7TapXlTyKWryFQcN9817aamNXPCt2ce+ULRgzCg1+P2g5irDICHpPJLf0ecy6hcY1R5JtWvY0oOoKSEDW89KWJxWN'
        'LQ/H9b2aPVzIsRL7wQpRCqRVt4p58yG/NSIK2kL6w+vK+PKVf9/TsGBM1VKbNz4GhKoDLbzYWf6aGMrPf2b8K8ywmmpTw8uC3cui'
        'NLj/QIoHisdWRSach9qQ6rU9z06FKdI+gDR51P/cXf0GPR9klw=='
    ),
    'limiter': (
        'eNrtmFFv2jAQgJ/pr0C8FxLohpDcCkrZhhYKAtY9u+QAC8eOHLulm/bfZwcSXBK0phrTRhcJkHzn8913d7EN8khAJIhy37+stNs3'
        'vbv+TbtduTorlZDHg75fvsNUwWXFqZRru9E7Ao8ZST/qrUPMfEgnSaEgkV4LwCuuZFZrjmmUqg2Z+TmweAkNMFOY5tgvoY6SPMCS'
        'cDbFYgEyDsmJQ4ntzVY99gCUh5A1W9ufvF2N+KTbHbLhfD5dCoiWnPrR1uCAsMTO+4vEkHFwnQy79eZugYOmUG0TMhpwX9HYhQlX'
        'YgZdrpjMQB5hgQPQGYs8EsmvAoehzl5My9bihEmA8rNBD0dyAhRmEvwpCQDfU+jrRKyzObY0u5SECbjD2iMdEsgxzK/OUCw3MlTb'
        'E23zAP5kJkgoo7RwPmgaBwpisuSK+vr7cWPoVoefV19fIhC2LBnvMMZljHVfkmDWpNbbhKeum7xk5GgQwojI2fIamK/Xi6aKEbbI'
        '88Y0yA2WOJF9/5EW+AOIR6F7biS41IS1Y7cquNdJ3Ko2nGZSN+gjJkX6wRo35aY9F5xSEGPMFpCt2/N6fuHuhrd1m2PoKO2WdsAr'
        'TO5P3uQwAYi6QKjOVQGY50613jJP0220fg9Y52S4WjjRWL8pcAQF0LZaVQP23UW9GFen6rjO5mm6uYQbWlTVnxMqYQtv7HFx3Pb7'
        '9B/eJ/eCRx5hq05gdskCLNyCFZfv8ckU13OGFlId14T4cLzN5+2QtVBqU3yFl4D9AmDbbW84/Nz51OuYo/mx2/h1eav/Mm+aiB07'
        'Guu7QLEN2flLY3dfELsVrSk2OIGwX5LyJFQzT180v73BXcuOPMWQKhU7jzY2Zx/X/X8e3Xvb5oJNcQ+VDJX88xep0+O7I4k8WODZ'
        '0yTgXC6tW7DVtmYTjP9duvoJbexA+g=='
    ),
}

def tpl(name):
    return zlib.decompress(base64.b64decode("".join(TEMPLATES[name]))).decode()


POINTEE_RE = re.compile(r'(<(?:\w*Target|Pointee) Id=")\d+(")')
NATIVE = {"limiter"}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")


def fill(t, **kw):
    for k, v in kw.items():
        t = t.replace("@@%s@@" % k, str(v))
    return t


def zero_pointees(xml):
    return POINTEE_RE.sub(r"\g<1>0\2", xml)


class Renumber:
    def __init__(self, start):
        self.n = start

    def __call__(self, xml):
        def sub(m):
            v = self.n
            self.n += 1
            return "%s%d%s" % (m.group(1), v, m.group(2))
        return POINTEE_RE.sub(sub, xml)


def m4l_xml(amxd, out_path, devid):
    amxd = os.path.abspath(amxd)
    if not os.path.isfile(amxd):
        sys.exit("missing .amxd: %s" % amxd)
    st = os.stat(amxd)
    rel = os.path.relpath(amxd, os.path.dirname(os.path.abspath(out_path)))
    return fill(tpl("m4l"), DEVID=devid, REL=esc(rel), ABS=esc(amxd),
                SIZE=st.st_size, CRC=0, MOD=int(st.st_mtime))


def native_xml(kind, devid):
    if kind == "limiter":
        return fill(tpl("limiter"), DEVID=devid, LOOKAHEAD=2)  # 2 = 6 ms
    sys.exit("unknown middle device: %s" % kind)


def device_list(args, out_path):
    """[(device_xml_with_ids_zero_or_index, DeviceId name)] in chain order."""
    middle = [] if args.middle in ("", "none") else [s.strip() for s in args.middle.split(",")]
    for k in middle:
        if k not in NATIVE:
            sys.exit("--middle: unknown device %r (supported: none, %s)" % (k, ", ".join(sorted(NATIVE))))
    kinds = ["m4l"] + middle + ["m4l"]
    paths = [args.start] + [None] * len(middle) + [args.end]
    devs = []
    for i, (k, p) in enumerate(zip(kinds, paths)):
        if k == "m4l":
            devs.append((m4l_xml(p, out_path, i), "MxDeviceAudioEffect"))
        else:
            devs.append((native_xml(k, i), "Limiter"))
    return devs


HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'


def write_gz(path, text):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(gzip.compress(text.encode("utf-8"), 9, mtime=0))


def preset_ref(devname):
    return ('<PresetRef><AbletonDefaultPresetRef Id="0"><FileRef><RelativePathType Value="0" />'
            '<RelativePath Value="" /><Path Value="" /><Type Value="2" /><LivePackName Value="" />'
            '<LivePackId Value="" /><OriginalFileSize Value="0" /><OriginalCrc Value="0" />'
            '<SourceHint Value="" /></FileRef><DeviceId Name="%s" /></AbletonDefaultPresetRef></PresetRef>' % devname)


def build_adg(args):
    parts = []
    for i, (dev, name) in enumerate(device_list(args, args.adg)):
        parts.append('<AbletonDevicePreset Id="%d"><OverwriteProtectionNumber Value="3076" />'
                     "<Device>%s</Device>%s</AbletonDevicePreset>" % (i, zero_pointees(dev), preset_ref(name)))
    x = fill(tpl("adg"), NAME=esc(args.name), PRESETS="\n".join(parts))
    write_gz(args.adg, x)
    return x


def build_als(args):
    base = gzip.open(args.base_set).read().decode("utf-8")
    scenes = base.count("<Scene Id=")
    if not scenes:
        sys.exit("base set has no scenes: %s" % args.base_set)
    # Main-track bridge device: repoint at --bridge
    bridge = os.path.abspath(args.bridge)
    if not os.path.isfile(bridge):
        sys.exit("missing bridge .amxd: %s" % bridge)
    mt = base.find("<MainTrack")
    pm = re.compile(r'(<MxPatchRef Id="\d+">\s*<FileRef>\s*<RelativePathType Value=")\d+(" />\s*<RelativePath Value=")[^"]*'
                    r'(" />\s*<Path Value=")[^"]*(" />.*?<OriginalFileSize Value=")\d+(" />\s*<OriginalCrc Value=")\d+'
                    r'(" />.*?<LastModDate Value=")\d+', re.S)
    st = os.stat(bridge)
    rel = os.path.relpath(bridge, os.path.dirname(os.path.abspath(args.als)))
    tail, n = pm.subn(lambda m: "%s1%s%s%s%s%s%d%s0%s%d" % (
        m.group(1), m.group(2), esc(rel), m.group(3), esc(bridge), m.group(4), st.st_size, m.group(5),
        m.group(6), int(st.st_mtime)), base[mt:], count=1)
    if n != 1:
        sys.exit("base set: no Max device found on the Main track")
    base = base[:mt] + tail
    # audio track(s) + rack: one track per --track "Name::start.amxd", else one from --start
    nxt = int(re.search(r'<NextPointeeId Value="(\d+)"', base).group(1))
    rn = Renumber(nxt)
    specs = [t.split("::", 1) for t in (args.track or [])] or [[args.track_name, args.start]]
    slots = "<ClipSlotList>" + "".join(
        '<ClipSlot Id="%d"><LomId Value="0" /><ClipSlot><Value /></ClipSlot><HasStop Value="true" /></ClipSlot>' % i
        for i in range(scenes)) + "</ClipSlotList>"
    tracks = []
    for i, (tname, tstart) in enumerate(specs):
        args.start = tstart
        devs = device_list(args, args.als)
        chain = "<Devices>\n" + "\n".join(d for d, _ in devs) + "\n</Devices>"
        # show the chain's devices (Delay+, the FX, Delay+ End) when the rack is opened, without the
        # macro panel, so Delay+ fits in the device view next to the Help view
        rack = rn(fill(tpl("alsrack"), RACKID=0, NAME=esc(args.name), DEVICES=chain).replace(
            '<AreDevicesVisible Value="false" />', '<AreDevicesVisible Value="true" />').replace(
            '<AreMacroControlsVisible Value="true" />', '<AreMacroControlsVisible Value="false" />'))
        track = fill(tpl("audiotrack"), TRACKID=max(1, args.track_id + i), TRACKNAME=esc(tname),
                     CLIPSLOTS=slots, DEVICES="<Devices>\n" + rack + "\n</Devices>")
        tracks.append(rn(track))
    track = "\n".join(tracks)
    base, n = re.subn(r"<Tracks>.*?</Tracks>", lambda m: "<Tracks>\n" + track + "\n\t\t</Tracks>", base, count=1, flags=re.S)
    if n != 1:
        sys.exit("base set has no <Tracks>")
    base = re.sub(r'(<NextPointeeId Value=")\d+', lambda m: "%s%d" % (m.group(1), rn.n), base, count=1)
    write_gz(args.als, base)
    return base


def validate(path, is_set):
    root = ET.fromstring(gzip.open(path).read())  # well-formed
    problems = []
    if is_set:
        ids = [e.get("Id") for e in root.iter() if (e.tag.endswith("Target") or e.tag == "Pointee") and e.get("Id") is not None]
        dup = [k for k, v in Counter(ids).items() if v > 1]
        if dup:
            problems.append("duplicate pointee Ids: %s" % dup[:5])
        refs = {e.get("Value") for e in root.iter("PointeeId")}
        if refs - set(ids):
            problems.append("dangling PointeeId refs: %s" % sorted(refs - set(ids))[:5])
        nxt = int(root.find("LiveSet/NextPointeeId").get("Value"))
        if ids and max(map(int, ids)) >= nxt:
            problems.append("NextPointeeId %d <= max pointee %s" % (nxt, max(map(int, ids))))
    for parent in root.iter():  # same-tag siblings must not repeat an Id (list indices)
        c = Counter((ch.tag, ch.get("Id")) for ch in parent if ch.get("Id") is not None
                    and not (ch.tag.endswith("Target") or ch.tag == "Pointee"))
        for (tag, i), n in c.items():
            if n > 1:
                problems.append("duplicate %s Id=%s under %s" % (tag, i, parent.tag))
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--adg", help="output Audio Effect Rack preset")
    ap.add_argument("--als", help="output Live Set")
    ap.add_argument("--start", required=True, help="Start .amxd")
    ap.add_argument("--end", required=True, help="End .amxd")
    ap.add_argument("--middle", default="none", help="none | limiter | comma list (default none)")
    ap.add_argument("--bridge", default=DEFAULT_BRIDGE, help="Ableton MCP Bridge .amxd for the master track")
    ap.add_argument("--base-set", default=DEFAULT_BASE_SET, help="Set used as base for --als")
    ap.add_argument("--name", default="Delay+", help="rack and chain name")
    ap.add_argument("--track-name", default="Delay+ Test")
    ap.add_argument("--track", action="append", help='one track per entry: "Track Name::start.amxd" (repeatable)')
    ap.add_argument("--track-id", type=int, default=32)
    args = ap.parse_args()
    if not (args.adg or args.als):
        ap.error("give --adg and/or --als")
    bad = False
    for out, fn, is_set in ((args.adg, build_adg, False), (args.als, build_als, True)):
        if out:
            fn(args)
            probs = validate(out, is_set)
            print("wrote %s%s" % (out, "" if not probs else "  PROBLEMS: %s" % probs))
            bad |= bool(probs)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
