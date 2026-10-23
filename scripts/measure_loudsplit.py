#!/usr/bin/env python3
"""Loud Split before / after measurements on real Max inside the tart VM (AGENTS.md 1a, shared harness 1b). Device-local companion of
scripts/measure_spectral.py (which only knows the Transient Split rack):

  scripts/vm_spectral.sh run measure_loudsplit.py compile      gen compile time (harness wall time of a 100 ms render minus a trivial gen, min of 3):
                                                               old core (git HEAD, no rack machinery) vs the device's gen code now
  scripts/vm_spectral.sh run measure_loudsplit.py cpu          cost per instance and per Size, alone (old core vs new core in role 0)
  scripts/vm_spectral.sh run measure_loudsplit.py rack         cost per 3-chain rack and Size: old (3 instances compute) vs shared (leader + 2 followers)
  scripts/vm_spectral.sh run measure_loudsplit.py split        where the time of one new SELF instance goes (masks, FFTs, telemetry), by switching parts off
  scripts/vm_spectral.sh run measure_loudsplit.py all

NonRealTime wall seconds per second of audio of the WHOLE patch on one core (stimulus + record + instances); the slope between a long and
a short render removes the launch time, the difference between a patch with 1 and N_HI units isolates one unit. Noise about +-0.5 % of a core."""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import spectral_common as sc
import measure_spectral as ms
import build_loudsplit

ROOT = mh.ROOT
SIZES = [("1k", 1024), ("2k", 2048), ("4k", 4096)]
if os.environ.get("MEASURE_SIZES"):          # e.g. MEASURE_SIZES=2k,4k
    SIZES = [s for s in SIZES if s[0] in os.environ["MEASURE_SIZES"].split(",")]
N_HI = 4              # racks (or instances x 3) in the loaded patch
STIM = ms.STIM


def old_code():
    """The device as committed before this change: lib + ss lib + the old core (fixture tests/loudsplit_old_core.genexpr, = git 00c2fa0's
    src/loudsplit_core.genexpr; the VM has no git), one analysis per instance."""
    with open(os.path.join(ROOT, "tests", "loudsplit_old_core.genexpr"), encoding="utf-8") as f:
        core = f.read()
    return "\n".join(t.rstrip() + "\n" for t in (ms.src("cepstrum_lib.genexpr", "spectral_split_lib.genexpr"), core))


def new_code():
    return build_loudsplit.gen_code()


def patch(code, racks, n, mode):
    """mode: 'old' (core without rack machinery, 3 instances per rack all compute), 'self' (new core, role 0, 3 instances compute),
    'shared' (new core, instance 1 leads and serves all, 2 and 3 follow)."""
    boxes = [mh.gen_box("obj-stim", STIM, 40, 100, numinlets=1, numoutlets=2)]
    lines = []
    ring = build_loudsplit.RING_SAMPS
    for r in range(racks):
        for c in range(3):
            tag = f"{r}_{c}"
            gid = f"obj-g{tag}"
            boxes.append(mh.box(f"obj-sc{tag}", f"buffer~ #0-sc{tag} @samps 544", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
            boxes.append(mh.gen_box(gid, code, 200, 260))
            if mode == "old":
                msg = f"outsel {c + 1}, fftn {n}, scope #0-sc{tag}"
            else:
                boxes.append(mh.box(f"obj-ring{tag}", f"buffer~ #0-ring{tag} @samps {ring}", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
                shared = mode == "shared"
                role = (1 if c == 0 else 2) if shared else 0
                lead = f"{r}_0" if shared else tag
                serve = 7 if (shared and c == 0) else 0
                msg = (f"outsel {c + 1}, fftn {n}, ring #0-ring{tag}, lead #0-ring{lead}, scope #0-sc{tag}, role {role}, serve {serve}, epoch 1")
            boxes.append(mh.msg(f"obj-p{tag}", msg, 200, 220, 300))
            lines += [mh.line("obj-load", 0, f"obj-p{tag}", 0), mh.line(f"obj-p{tag}", 0, gid, 0),
                      mh.line("obj-stim", 0, gid, 0), mh.line("obj-stim", 1, gid, 1), mh.line(gid, 0, "obj-mute-l", 0)]
    lines.append(mh.line("obj-g0_0", 0, "obj-record", 0))
    return boxes, lines


def slope(code, racks, n, mode, tag):
    b, l = patch(code, racks, n, mode)
    ws = ms.render(f"ml_{tag}_s", b, l, ms.SHORT_MS)
    wl = ms.render(f"ml_{tag}_l", b, l, ms.LONG_MS)
    return (wl - ws) / ((ms.LONG_MS - ms.SHORT_MS) / 1000.0), ws


def per_rack(code, n, mode, tag):
    s1, w1 = slope(code, 1, n, mode, tag + "1")
    sh, wh = slope(code, N_HI, n, mode, tag + "h")
    return (sh - s1) / (N_HI - 1), w1, wh


def do_compile(runs=3):
    base = min(ms.compile_case("ml_base", "out1 = in1; out2 = in2;") for _ in range(runs))
    print(f"baseline trivial gen: {base:.2f} s")
    for label, code in (("old (HEAD)", old_code()), ("new (device gen code)", new_code())):
        w = [ms.compile_case("ml_c", code) for _ in range(runs)]
        print(f"COMPILE loudsplit {label}: wall {' '.join(f'{x:.2f}' for x in w)}  -> compile ~{min(w) - base:.2f} s (min - baseline)")


def do_cpu():
    for label, n in SIZES:
        o, _, _ = per_rack(old_code(), n, "old", f"cpuold{n}")
        s, _, _ = per_rack(new_code(), n, "self", f"cpuself{n}")
        print(f"CPU loudsplit Size {label}: per instance old {o / 3 * 100:.2f} %  new (role 0) {s / 3 * 100:.2f} % of one core")


def do_rack():
    code = new_code()
    for label, n in SIZES:
        o, w1o, whd = per_rack(old_code(), n, "old", f"rkold{n}")
        s, _, _ = per_rack(code, n, "self", f"rkself{n}")
        sh, w1, wh = per_rack(code, n, "shared", f"rkshared{n}")
        print(f"RACK loudsplit Size {label}: per 3-chain rack old {o * 100:.2f} %  new SELF (3 compute) {s * 100:.2f} %  shared (leader + 2 followers) {sh * 100:.2f} % of one core; "
              f"shared / old = {sh / max(o, 1e-9):.2f}")


def do_split():
    full = new_code()
    variants = {
        "full": full,
        "no_masks": re.sub(r"\n\t*ls_masks\([^\n]*\n", "\n", full),
        "no_fft": full.replace("fft_run(fx, tab, n, 0);", "").replace("fft_run(fx, tab, n, 1);", "").replace("fft_run(fy, tab, n, 1);", ""),
        "no_tele": full.replace("sTele = awake > 0.5 ? 1 : 0;", "sTele = 0;"),
    }
    for k, v in variants.items():
        if v == full and k != "full":
            print(f"WARNING variant {k} did not change the source")
    for label, n in SIZES:
        res = {}
        for k, code in variants.items():
            s, _, _ = per_rack(code, n, "self", f"split_{k}{n}")
            res[k] = s / 3
        print(f"SPLIT loudsplit Size {label}: per instance full {res['full'] * 100:.2f} %  masks (ls_masks, incl. the per-bin log10) {(res['full'] - res['no_masks']) * 100:.2f}  "
              f"FFTs {(res['full'] - res['no_fft']) * 100:.2f}  telemetry {(res['full'] - res['no_tele']) * 100:.2f}  (% of one core)")


def main():
    what = (sys.argv[1:] or ["all"])[0]
    if what in ("compile", "all"):
        do_compile()
    if what in ("cpu", "all"):
        do_cpu()
    if what in ("rack", "all"):
        do_rack()
    if what in ("split", "all"):
        do_split()


if __name__ == "__main__":
    main()
