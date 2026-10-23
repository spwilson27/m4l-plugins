#!/usr/bin/env python3
"""Compile time and DSP cost of Harmonic Split's gen in real Max (inside the tart VM, AGENTS.md 1a), on the shared NonRealTime harness.

    scripts/vm_spectral.sh run measure_harmsplit_cpu.py compile [old=<core.genexpr>]
    scripts/vm_spectral.sh run measure_harmsplit_cpu.py rack [old=<core.genexpr>]
    scripts/vm_spectral.sh run measure_harmsplit_cpu.py split old=<core> [sizes=2k] [reps=3]
    scripts/vm_spectral.sh run measure_harmsplit_cpu.py all [old=<core.genexpr>]

`old=` is the pre-rack core (the committed one before the rack machinery: `git show <rev>:src/harmsplit_core.genexpr` copied into the VM, e.g. to
tests/out/harmsplit_core_old.genexpr); it is built as cepstrum_lib + spectral_split_lib + that core, the way the device used to embed it.

compile: harness wall time of a 100 ms render of one gen minus a trivial gen (min of 3), old versus new gen code.
rack:    cost of ONE RACK (3 chains) per Size, in seconds of NonRealTime wall time per second of audio (a real-time factor of the whole patch on one
         core, not Live's CPU meter): slope (long - short window) of 4 racks minus 1 rack, over 3. Variants: old (3 instances of the old core),
         alone (3 instances of the new gen in role 0: the same work as old plus the ring writes) and shared (the first instance leads, the
         other two follow its ring: what the face sets up in a rack). Same VM state, same stimulus (noise + 440 Hz sine, stereo).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh  # noqa: E402
import measure_spectral as ms  # noqa: E402
import build_harmsplit  # noqa: E402
import spectral_common as sc  # noqa: E402

SIZES = [("1k", 1024), ("2k", 2048), ("4k", 4096)]
RACKS_HI = 4


def old_code(path):
    return ms.src("cepstrum_lib.genexpr", "spectral_split_lib.genexpr") + open(path, encoding="utf-8").read().rstrip() + "\n"


def patch_rack(code, racks, n, mode):
    """`racks` racks of three chains. mode: "old" (no rack messages), "alone" (role 0), "shared" (instance 0 leads and serves 7, 1 and 2 follow)."""
    boxes = [mh.gen_box("obj-stim", ms.STIM, 40, 100, numinlets=1, numoutlets=2)]
    lines = []
    for r in range(racks):
        for c in range(3):
            tag = f"{r}_{c}"
            gid = f"obj-g{tag}"
            msg = (f"outsel {c + 1}, fftn {n}, hpat 2, hmaxp 0, sensamt 0.495, tiltamt 0, thrdb -120, flocut 80, fhicut 1500, "      # the device defaults
                   f"scope #0-sc{tag}")
            if mode != "old":
                lead_tag = f"{r}_0" if mode == "shared" else tag
                role = (1 if c == 0 else 2) if mode == "shared" else 0
                serve = 7 if (mode == "shared" and c == 0) else 0
                msg += f", ring #0-ring{tag}, lead #0-ring{lead_tag}, role {role}, serve {serve}, epoch 1"
                boxes.append(mh.box(f"obj-ring{tag}", f"buffer~ #0-ring{tag} @samps {build_harmsplit.RING_SAMPS}", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
            boxes.append(mh.box(f"obj-sc{tag}", f"buffer~ #0-sc{tag} @samps 560", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
            boxes.append(mh.gen_box(gid, code, 200, 260))
            boxes.append(mh.msg(f"obj-p{tag}", msg, 200, 220, 300))
            lines += [mh.line("obj-load", 0, f"obj-p{tag}", 0), mh.line(f"obj-p{tag}", 0, gid, 0),
                      mh.line("obj-stim", 0, gid, 0), mh.line("obj-stim", 1, gid, 1), mh.line(gid, 0, "obj-mute-l", 0)]
    lines.append(mh.line("obj-g0_0", 0, "obj-record", 0))
    return boxes, lines


def render(name, boxes, lines, dur):
    """One harness render; the harness occasionally reports `Max produced no result` (re-run once, as for the audio suites)."""
    for attempt in range(3):
        try:
            return ms.render(name, boxes, lines, dur)
        except RuntimeError as ex:
            if "no result" not in str(ex) or attempt == 2:
                raise
            print(f"retry {name}: {ex}")


def slope(boxes, lines, tag):
    """Wall seconds per second of audio of the patch: slope of (long - short) window, median of HM_REPS (default 3) repetitions (the VM is shared:
    a single slope has a spread of about +-0.01 s/s)."""
    reps = int(os.environ.get("HM_REPS", "3"))
    vals, shorts = [], []
    for i in range(reps):
        ws = render(f"mh_{tag}_s{i}", boxes, lines, ms.SHORT_MS)
        wl = render(f"mh_{tag}_l{i}", boxes, lines, ms.LONG_MS)
        vals.append((wl - ws) / ((ms.LONG_MS - ms.SHORT_MS) / 1000.0))
        shorts.append(ws)
    vals.sort()
    return vals[len(vals) // 2], shorts[0]


def do_compile(old, runs=3):
    base = min(ms.compile_case("mh_base", "out1 = in1; out2 = in2;") for _ in range(runs))
    print(f"baseline trivial gen: {base:.2f} s")
    codes = {"new (rack machinery)": build_harmsplit.gen_code()}
    if old:
        codes["old (pre-rack core)"] = old_code(old)
    for label, code in codes.items():
        w = [ms.compile_case("mh_c", code) for _ in range(runs)]
        print(f"COMPILE harmsplit {label}: wall {' '.join(f'{x:.2f}' for x in w)}  -> compile ~{min(w) - base:.2f} s (min - baseline), {len(code.splitlines())} lines")


def do_rack(old):
    new = build_harmsplit.gen_code()
    for label, n in SIZES:
        res = {}
        variants = [("alone", new), ("shared", new)] + ([("old", old_code(old))] if old else [])
        for mode, code in variants:
            b1, l1 = patch_rack(code, 1, n, mode)
            bh, lh = patch_rack(code, RACKS_HI, n, mode)
            s1, w1 = slope(b1, l1, f"{mode}1")
            sh, wh = slope(bh, lh, f"{mode}h")
            res[mode] = (sh - s1) / (RACKS_HI - 1)
            print(f"RACK Size {label} {mode}: per rack {res[mode]:.4f} s/s = {res[mode] * 100:.2f} % of one core  (1 rack {s1:.4f}, {RACKS_HI} racks {sh:.4f}; wall of the short render {w1:.1f} / {wh:.1f} s)")
        if "old" in res:
            print(f"RACK Size {label}: shared / old = {res['shared'] / max(res['old'], 1e-9):.2f}, alone / old = {res['alone'] / max(res['old'], 1e-9):.2f}")
        else:
            print(f"RACK Size {label}: shared / alone = {res['shared'] / max(res['alone'], 1e-9):.2f}")


def old_analysis_variant(full, old):
    """The new gen with hs_prep / hs_sal taken from the pre-rack core (before the cached tilt table and the guarded loops): isolates what the
    device-local analysis optimisations are worth."""
    import re

    def block(text, name):
        m = re.search(rf"^{name}\(.*?\n}}\n", text, re.S | re.M)
        assert m, name
        return m.group(0)

    code = full
    for name in ("hs_prep", "hs_sal"):
        code = code.replace(block(full, name), block(open(old, encoding="utf-8").read(), name))
    code = code.replace("hs_prep(ms, hsd, hst, hcf, n, sr, loH, hiH, tlH);", "hs_prep(ms, hsd, hst, n, sr, loH, hiH, tlH);")
    return code


def do_split(old=None):
    """Where one rack's cost goes (role 0 instances, timing only, the output of the variants is garbage): the whole analysis (hs_prep .. hs_masks),
    the series search alone (hs_sal), everything else (framing, FFTs, mask application, OLA, ring)."""
    import re
    full = build_harmsplit.gen_code()
    calls = r"\n[ \t]*hs_(?:prep|sal|decide|harm|post|masks)\([^\n]*\);[ \t]*\n"
    variants = {
        "full": full,
        "no_sal": re.sub(r"\n[ \t]*hs_sal\([^\n]*\);[ \t]*\n", "\n", full),
        "no_analysis": re.sub(calls, "\n", re.sub(calls, "\n", full)),
    }
    if old:
        variants["old_prep_sal"] = old_analysis_variant(full, old)
    for k, v in variants.items():
        if v == full and k != "full":
            print(f"WARNING variant {k} did not change the source")
    only = os.environ.get("HM_SPLIT_SIZES")           # e.g. "2k": only these Sizes (a split run is 12 renders per variant and Size)
    for label, n in SIZES:
        if only and label not in only.split(","):
            continue
        res = {}
        for k, code in variants.items():
            b1, l1 = patch_rack(code, 1, n, "alone")
            bh, lh = patch_rack(code, RACKS_HI, n, "alone")
            s1, _ = slope(b1, l1, f"split_{k}1")
            sh, _ = slope(bh, lh, f"split_{k}h")
            res[k] = (sh - s1) / (RACKS_HI - 1)
            print(f"SPLIT Size {label} {k}: per rack {res[k]:.4f} s/s")
        if "old_prep_sal" in res:
            print(f"SPLIT Size {label}: hs_prep + hs_sal of the pre-rack core instead of the optimised ones: {res['old_prep_sal'] - res['full']:+.4f} s/s per rack "
                  f"({100 * (res['old_prep_sal'] - res['full']) / max(res['full'] - res['no_analysis'], 1e-9):+.0f} % of the analysis cost)")
        print(f"SPLIT Size {label}: series search hs_sal = {res['full'] - res['no_sal']:.4f}, whole analysis = {res['full'] - res['no_analysis']:.4f}, "
              f"rest (framing / FFTs / masks applied / OLA / ring) = {res['no_analysis']:.4f}  (s/s per rack of 3 instances)")


def main():
    args = sys.argv[1:] or ["all"]
    what = args[0]
    old = next((a[4:] for a in args if a.startswith("old=")), None)
    for a in args:       # options are arguments, not environment variables: the script runs in the VM over ssh
        if a.startswith("reps="):
            os.environ["HM_REPS"] = a[5:]
        if a.startswith("sizes="):
            os.environ["HM_SPLIT_SIZES"] = a[6:]
    if what in ("compile", "all"):
        do_compile(old)
    if what in ("rack", "all"):
        do_rack(old)
    if what in ("split", "all"):
        do_split(old)


if __name__ == "__main__":
    main()
