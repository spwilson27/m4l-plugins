#!/usr/bin/env python3
"""Freq Split measurements on real Max inside the tart VM (AGENTS.md 1a, shared harness 1b). Modelled on scripts/measure_spectral.py.

  scripts/vm_spectral.sh run measure_freqsplit.py compile         gen compile time (harness wall time of a 100 ms render minus a trivial gen), old core vs the rack core
  scripts/vm_spectral.sh run measure_freqsplit.py rack            CPU of a 4-chain rack per Size: old (all four compute alone) vs the rack machinery (leader + three followers),
                                                                  and the variants that decide the design (see below). NonRealTime wall seconds per second of audio,
                                                                  slope of (long - short) for 1 and 3 racks, per rack = (s3 - s1) / 2.
  scripts/vm_spectral.sh run measure_freqsplit.py all

Variants of the shared rack (timing only; the audio of a variant may be wrong):
  shared        leader serves 4 channels (what the face sets up), 3 followers read its ring
  serve3        the leader serves only 3 channels: the cost model of a leader that derives the 4th channel as (input - the other three)
  no_mid        shared, without the per-hop ss_mid (Mid amplitude + atan2 of 2049 bins) that the template runs every hop and Freq Split only needs for telemetry
  hop_alone     the hop clock alone: every instance computes its own channel (serve 0, role 0) -- the same work as `old`
Every number is the whole patch on one core (stimulus + record + instances), not Live's CPU meter; differences isolate the instances."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import spectral_common as sc

ROOT = mh.ROOT
SRC = os.path.join(ROOT, "src")
PROBE = os.path.join(ROOT, "tests", "sampler_loadtime_probe.js")
OLD_CORE = os.path.join(ROOT, "tests", "freqsplit_old", "freqsplit_core_old.genexpr")
SIZES = [("1k", 1024), ("2k", 2048), ("4k", 4096)]
SHORT_MS, LONG_MS = 1000, 21000
N_RACKS = 3
STIM = ("History n(0);\nn = n + 1;\nk = n - 1;\nr = noise();\n"
        "x = 0.1 * sin(6.283185307179586 * 440 * k / 48000) + 0.25 * r;\nout1 = x;\nout2 = x * 0.5;\n")


def read(*names):
    return "\n".join(open(os.path.join(SRC, n), encoding="utf-8").read().rstrip() + "\n" for n in names)


def old_code():
    return read("cepstrum_lib.genexpr", "spectral_split_lib.genexpr") + "\n" + open(OLD_CORE, encoding="utf-8").read()


def new_code():
    import build_freqsplit
    return build_freqsplit.gen_code()


def render(name, boxes, lines, dur):
    return mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=dur, channels=1)["harness_wall_s"]


def compile_case(name, code):
    boxes = [mh.gen_box("obj-g", code, 40, 80, numinlets=2, numoutlets=2)]
    lines = [mh.line("obj-g", 0, "obj-record", 0)]
    return render(name, boxes, lines, 100)


def patch(code, racks, n, mode):
    """racks racks of four chains. mode: old (no rack messages), shared (leader serve 15), serve3 (leader serve 7), alone (rack core, every instance role 0)."""
    boxes = [mh.gen_box("obj-stim", STIM, 40, 100, numinlets=1, numoutlets=2)]
    lines = []
    for r in range(racks):
        for c in range(4):
            tag = f"{r}_{c}"
            gid = f"obj-g{tag}"
            if mode == "old":
                msg = f"outsel {c + 1}, fftn {n}"
            else:
                lead = f"{r}_0" if mode in ("shared", "serve3") else tag
                role = (1 if c == 0 else 2) if mode in ("shared", "serve3") else 0
                serve = (15 if mode == "shared" else 7) if (c == 0 and role == 1) else 0
                boxes.append(mh.box(f"obj-ring{tag}", f"buffer~ #0-ring{tag} @samps {sc.rack_ring_samps(4)}", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
                msg = f"outsel {c + 1}, fftn {n}, ring #0-ring{tag}, lead #0-ring{lead}, role {role}, serve {serve}, epoch 1"
            boxes.append(mh.gen_box(gid, code, 200, 260))
            boxes.append(mh.msg(f"obj-p{tag}", msg, 200, 220, 300))
            lines += [mh.line("obj-load", 0, f"obj-p{tag}", 0), mh.line(f"obj-p{tag}", 0, gid, 0),
                      mh.line("obj-stim", 0, gid, 0), mh.line("obj-stim", 1, gid, 1), mh.line(gid, 0, "obj-mute-l", 0)]
    lines.append(mh.line("obj-g0_0", 0, "obj-record", 0))
    return boxes, lines


def slope(b, l, tag):
    ws = render(f"mf_{tag}_s", b, l, SHORT_MS)
    wl = render(f"mf_{tag}_l", b, l, LONG_MS)
    return (wl - ws) / ((LONG_MS - SHORT_MS) / 1000.0), ws


def do_compile(runs=3):
    base = min(compile_case("mf_base", "out1 = in1; out2 = in2;") for _ in range(runs))
    print(f"baseline trivial gen: {base:.2f} s")
    for label, code in (("old core", old_code()), ("rack core", new_code())):
        w = [compile_case("mf_c", code) for _ in range(runs)]
        print(f"COMPILE freqsplit {label}: wall {' '.join(f'{x:.2f}' for x in w)}  -> compile ~{min(w) - base:.2f} s (min - baseline)")


def do_rack():
    new = new_code()
    variants = {
        "old": (old_code(), "old"),
        "hop_alone": (new, "alone"),
        "shared": (new, "shared"),
        "serve3": (new, "serve3"),
        "no_mid": (new.replace("ss_mid(fx, ms, n);", ""), "shared"),
    }
    if variants["no_mid"][0] == new:
        print("WARNING: the no_mid variant did not change the source")
    for label, n in SIZES:
        res = {}
        for k, (code, mode) in variants.items():
            b1, l1 = patch(code, 1, n, mode)
            bh, lh = patch(code, N_RACKS, n, mode)
            s1, w1 = slope(b1, l1, f"{k}1")
            sh, wh = slope(bh, lh, f"{k}{N_RACKS}")
            res[k] = (sh - s1) / (N_RACKS - 1)
            print(f"RACK Size {label} {k:9s}: per 4-chain rack {res[k]:.4f} s/s = {res[k] * 100:.2f} % of one core (1 rack {s1:.4f}, {N_RACKS} racks {sh:.4f}; "
                  f"short render wall {w1:.1f} s / {wh:.1f} s)")
        print(f"RACK Size {label}: shared / old = {res['shared'] / max(res['old'], 1e-9):.2f}, serve3 / old = {res['serve3'] / max(res['old'], 1e-9):.2f}, "
              f"no_mid / old = {res['no_mid'] / max(res['old'], 1e-9):.2f}, hop_alone / old = {res['hop_alone'] / max(res['old'], 1e-9):.2f}")


def main():
    what = (sys.argv[1:] or ["all"])[0]
    if what in ("compile", "all"):
        do_compile()
    if what in ("rack", "all"):
        do_rack()


if __name__ == "__main__":
    main()
