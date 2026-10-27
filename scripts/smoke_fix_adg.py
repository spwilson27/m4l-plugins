#!/usr/bin/env python3
"""Repoint the .amxd references of a rack preset (.adg) at <devicesdir>/<name>.amxd (absolute Path). The committed
.adg files carry an empty Path (relative reference only), and the M4LTestLoader stages the preset in Live's
User Library, so its relative path no longer resolves. stdlib only; run in the VM by scripts/vm_smoke.sh.
  python3 scripts/smoke_fix_adg.py IN.adg OUT.adg DEVICES_DIR"""
import gzip, os, re, sys

src, dst, ddir = sys.argv[1:4]
x = gzip.open(src).read().decode("utf-8")
n = [0]


def sub(m):
    blk = m.group(0)
    rel = re.search(r'<RelativePath Value="([^"]*\.amxd)"', blk)
    if not rel:
        return blk
    n[0] += 1
    new = os.path.join(ddir, os.path.basename(rel.group(1).replace("&amp;", "&"))).replace("&", "&amp;")
    return re.sub(r'<Path Value="[^"]*"', lambda _m: '<Path Value="%s"' % new, blk, count=1)


# presets carry an empty Path (portable); older ones an absolute one: either way point it at DEVICES_DIR
x = re.sub(r'<MxPatchRef Id="\d+">.*?</MxPatchRef>', sub, x, flags=re.S)
with gzip.open(dst, "wb") as f:
    f.write(x.encode("utf-8"))
print("repointed %d reference(s) -> %s" % (n[0], ddir))
