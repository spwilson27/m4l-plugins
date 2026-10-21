#!/usr/bin/env python3
"""
Write an Audio Effect Rack preset (.adg) for a Spectral Split device: one chain per output channel, each chain
holding the device as its first (and only) device. Reuses the Live 12.4 rack template and the M4L device XML of
scripts/make_delayplus_sets.py (imported, not modified).

    python3 scripts/make_spectral_rack.py --amxd "devices/Transient Split.amxd" --name "Transient Split" \\
        --chains "Transients,Tones" --out "devices/Transient Split.adg"

Each device keeps Output = Auto (its default), which resolves to the chain index at run time.
The .amxd is referenced relative to the .adg (RelativePathType 1) with the absolute path as fallback, so a rebuilt
device is picked up the next time the rack is opened.
"""

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_delayplus_sets as mds


def build_rack_adg(amxd, out_path, rack_name, chains):
    x = mds.tpl("adg")
    m = re.search(r'<AudioEffectBranchPreset Id="0">.*?</AudioEffectBranchPreset>', x, re.S)
    if not m:
        raise SystemExit("rack template has no branch preset")
    branch = m.group(0)
    out_chains = []
    for i, name in enumerate(chains):
        dev = mds.m4l_xml(amxd, out_path, 0)
        preset = ('<AbletonDevicePreset Id="0"><OverwriteProtectionNumber Value="3076" />'
                  "<Device>%s</Device>%s</AbletonDevicePreset>" % (mds.zero_pointees(dev), mds.preset_ref("MxDeviceAudioEffect")))
        b = branch.replace('<AudioEffectBranchPreset Id="0">', '<AudioEffectBranchPreset Id="%d">' % i, 1)
        b = b.replace('<Name Value="@@NAME@@" />', '<Name Value="%s" />' % mds.esc(name), 1)
        b = b.replace("@@PRESETS@@", preset)
        out_chains.append(b)
    x = x[:m.start()] + "\n".join(out_chains) + x[m.end():]
    x = mds.fill(x, NAME=mds.esc(rack_name))
    mds.write_gz(out_path, x)
    problems = mds.validate(out_path, False)
    print("wrote %s%s" % (out_path, "" if not problems else "  PROBLEMS: %s" % problems))
    return not problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1] if __doc__ else "")
    ap.add_argument("--amxd", required=True)
    ap.add_argument("--name", required=True, help="rack name")
    ap.add_argument("--chains", required=True, help="comma separated chain names, in channel order")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    ok = build_rack_adg(args.amxd, args.out, args.name, [c.strip() for c in args.chains.split(",") if c.strip()])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
