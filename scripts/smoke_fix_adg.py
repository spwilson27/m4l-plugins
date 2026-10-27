#!/usr/bin/env python3
"""Repoint the .amxd references of a rack preset (.adg) at <devicesdir>/<name>.amxd (absolute Path). The committed
.adg files carry the absolute path of the machine that built them, and the M4LTestLoader stages the preset in Live's
User Library, so its relative path no longer resolves. stdlib only; run in the VM by scripts/vm_smoke.sh.
  python3 scripts/smoke_fix_adg.py IN.adg OUT.adg DEVICES_DIR"""
import gzip, os, re, sys

src, dst, ddir = sys.argv[1:4]
x = gzip.open(src).read().decode("utf-8")
n = [0]


def sub(m):
    n[0] += 1
    return '%s%s"' % (m.group(1), os.path.join(ddir, os.path.basename(m.group(2))).replace("&", "&amp;"))


x = re.sub(r'(<Path Value=")([^"]*\.amxd)"', sub, x)
with gzip.open(dst, "wb") as f:
    f.write(x.encode("utf-8"))
print("repointed %d reference(s) -> %s" % (n[0], ddir))
