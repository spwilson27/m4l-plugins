#!/usr/bin/env python3
"""Minimal Live Set for the generic device smoke test (scripts/vm_smoke.sh): the repo's base Set
(Main track + MCP Bridge + scenes) with the bridge path repointed. Tracks are created at run time through
the M4LTestLoader (scripts/vm_live_open.sh exec/load), so the Set keeps only the base set's one track (Live refuses a Set without player tracks); it is deleted at setup.
  python3 scripts/make_smoke_set.py OUT.als [--bridge path.amxd] [--base-set base.als]
"""
import argparse, gzip, os, re, sys
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--bridge", default=os.path.join(REPO, "devices", "Ableton MCP Bridge.amxd"))
    ap.add_argument("--base-set", default=os.path.join(REPO, "ableton_mcp_bridge.als"))
    a = ap.parse_args()
    base = gzip.open(a.base_set).read().decode("utf-8")
    bridge = os.path.abspath(a.bridge)
    st = os.stat(bridge)
    rel = os.path.relpath(bridge, os.path.dirname(os.path.abspath(a.out)))
    esc = lambda s: s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    mt = base.find("<MainTrack")
    pm = re.compile(r'(<MxPatchRef Id="\d+">\s*<FileRef>\s*<RelativePathType Value=")\d+(" />\s*<RelativePath Value=")[^"]*'
                    r'(" />\s*<Path Value=")[^"]*(" />.*?<OriginalFileSize Value=")\d+(" />\s*<OriginalCrc Value=")\d+'
                    r'(" />.*?<LastModDate Value=")\d+', re.S)
    tail, n = pm.subn(lambda m: "%s1%s%s%s%s%s%d%s0%s%d" % (
        m.group(1), m.group(2), esc(rel), m.group(3), esc(bridge), m.group(4), st.st_size, m.group(5),
        m.group(6), int(st.st_mtime)), base[mt:], count=1)
    if n != 1:
        sys.exit("no Max device on the Main track of the base set")
    base = base[:mt] + tail
    with gzip.open(a.out, "wb") as f:
        f.write(base.encode("utf-8"))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
