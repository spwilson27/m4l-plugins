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


# Live chain colour per channel: index into Live's 70-colour clip/track palette (chain `color_index`), the palette entry nearest
# (CIELAB distance) to the colour the face uses for that channel. Palette measured in Live 12.4.6 (chain `color` via the LOM), RGB:
#   orange face colour live_display_line_one (255,173,86)  -> 1  (255,165,41)    Transients, Mid, Harmonics A
#   cyan   face colour live_display_line_two (3,195,213)   -> 21 (25,233,255)    Tones, Loud, Harmonics B
#   grey   face colour live_display_scale_text (134,134,134) -> 55 (123,123,123)  Quiet, Nonharmonics
#   Freq Split FV_COLS: red (255,107,97) -> 28 (226,103,90); blue (82,158,255) -> 9 (84,128,228);
#                       yellow (255,204,64) -> 59 (219,195,0); magenta (235,107,217) -> 11 (216,108,228)
# Full palette 0..69: 255,148,166 | 255,165,41 | 204,153,39 | 247,244,124 | 191,251,0 | 26,255,47 | 37,255,168 | 92,255,232 |
# 139,197,255 | 84,128,228 | 146,167,255 | 216,108,228 | 229,83,160 | 255,255,255 | 255,54,54 | 246,108,3 | 153,114,75 | 255,240,52 |
# 135,255,103 | 61,195,0 | 0,191,175 | 25,233,255 | 16,164,238 | 0,125,192 | 136,108,228 | 182,119,198 | 255,57,212 | 208,208,208 |
# 226,103,90 | 255,163,116 | 211,173,113 | 237,255,174 | 210,228,152 | 186,208,116 | 155,196,141 | 212,253,225 | 205,241,248 |
# 185,193,227 | 205,187,228 | 174,152,229 | 229,220,225 | 169,169,169 | 198,146,139 | 183,130,86 | 153,131,106 | 191,186,105 |
# 166,190,0 | 125,176,77 | 136,194,186 | 155,179,196 | 133,165,194 | 131,147,204 | 165,149,181 | 191,159,190 | 188,113,150 |
# 123,123,123 | 175,51,51 | 169,81,49 | 114,79,65 | 219,195,0 | 133,150,31 | 83,159,49 | 10,156,142 | 35,99,132 | 26,47,150 |
# 47,82,162 | 98,75,173 | 163,75,173 | 204,46,110 | 60,60,60
# In the .adg the colour sits in <AudioEffectBranchPreset> as DocumentColorIndex + AutoColored false; in the .als in
# <AudioEffectBranch> as Color + AutoColored false.
CHAIN_COLORS = {
    "Transients": 1, "Tones": 21,
    "Quiet": 55, "Mid": 1, "Loud": 21,
    "Nonharmonics": 55, "Harmonics A": 1, "Harmonics B": 21,
    "Red": 28, "Blue": 9, "Yellow": 59, "Magenta": 11,
}


def chain_color(name):
    return CHAIN_COLORS.get(name)


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
        ci = chain_color(name)
        if ci is not None:
            b, n = re.subn(r'<DocumentColorIndex Value="\d+" />\s*<AutoColored Value="true" />',
                           '<DocumentColorIndex Value="%d" /><AutoColored Value="false" />' % ci, b, count=1)
            if n != 1:
                raise SystemExit("branch preset template has no colour fields")
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
