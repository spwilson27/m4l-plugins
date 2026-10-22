#!/usr/bin/env python3
"""Multiband Split cost in real Max (VM only, AGENTS.md 1a/1d), on the shared NonRealTime harness.
    scripts/vm_mbsplit.sh run measure_mbsplit.py <core.genexpr> [big] [silent] ["--, prune 1, ringon 0"]
Per core: gen compile (wall of a 100 ms render minus a trivial gen), and the cost of one rack
(K instances, noise input, one band each, like Auto chains) as (wall(long) - wall(short)) / seconds
in seconds of wall time per second of audio, divided by K. Includes the harness floor of the noise source."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
from max_harness import box, gen_box, line

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = os.path.join(ROOT, "tests", "sampler_loadtime_probe.js")
SHORT_MS, LONG_MS = 1500, 61500
REPS = 2


SILENT = "silent" in sys.argv[1:]   # silent input: measures the idle cost (silence sleep)
BIG = "big" in sys.argv[1:]         # 16 instances: resolves the IIR cost above the measurement noise


def rack(code, k, nb, slope, dyn, masks, extra=""):
    boxes = [box("obj-scope", "buffer~ #0-splitscope @samps 8224", 400, 30, 220, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
             box("obj-noise", "noise~", 20, 40, 50, 20, numinlets=1, numoutlets=1, outlettype=["signal"]),
             box("obj-nscale", "*~ 0.0" if SILENT else "*~ 0.1", 20, 70, 50, 20, numinlets=2, numoutlets=1, outlettype=["signal"])]
    lines = [line("obj-noise", 0, "obj-nscale", 0)]
    for i in range(k):
        boxes.append(gen_box(f"obj-g{i}", code, 40 + 120 * i, 200))
        boxes.append(box(f"obj-p{i}", f"scope #0-splitscope, numbands {nb}, slope {slope}, f1 150, f2 900, f3 4200, bandmask {masks[i % len(masks)]}, gain 0, phase 0, dynphase {dyn}{extra}",
                         40 + 120 * i, 160, 500, 20, maxclass="message", numinlets=2, numoutlets=1))
        lines += [line("obj-load", 0, f"obj-p{i}", 0), line(f"obj-p{i}", 0, f"obj-g{i}", 0),
                  line("obj-nscale", 0, f"obj-g{i}", 0), line("obj-nscale", 0, f"obj-g{i}", 1),
                  line(f"obj-g{i}", 0, "obj-record", 0), line(f"obj-g{i}", 1, "obj-record", 1)]
    return boxes, lines


def wall(code, k, nb, slope, dyn, masks, dur, extra=""):
    b, l = rack(code, k, nb, slope, dyn, masks, extra)
    return mh.run_case("mbs_meas", b, l, probe_js=PROBE, settle_ms=50, dur_ms=dur)["harness_wall_s"]  # excludes the lock wait


def compile_cost(code, runs=4):
    triv = "out1 = in1; out2 = in2;"
    res = {"base": [], "core": []}
    for _ in range(runs):
        for name, c in (("base", triv), ("core", code)):
            boxes = [gen_box("obj-g", c, 40, 80)]
            lines = [line("obj-g", 0, "obj-record", 0), line("obj-g", 1, "obj-record", 1)]
            res[name].append(mh.run_case("mbs_comp", boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=100)["harness_wall_s"])
    return min(res["core"]) - min(res["base"]), res


def main():
    cores = [a for a in sys.argv[1:] if not a.startswith("--") and a not in ("big", "silent")]
    extra = " ".join(a[2:] for a in sys.argv[1:] if a.startswith("--"))
    for core in cores:
        code = open(core, encoding="utf-8").read()
        c, raw = compile_cost(code)
        print(f"{core}: gen compile ~{c:.2f}s  (core {['%.2f' % x for x in raw['core']]}, base {['%.2f' % x for x in raw['base']]})")
        cfgs = [("1 inst nb=1", 1, 1, 1, 0, [1]),
                ("2-chain rack LR4", 2, 2, 1, 0, [1, 2]),
                ("3-chain rack LR4", 3, 3, 1, 0, [1, 2, 4]),
                ("4-chain rack LR4", 4, 4, 1, 0, [1, 2, 4, 8]),
                ("4-chain rack LR8", 4, 4, 2, 0, [1, 2, 4, 8]),
                ("4-chain rack LR12", 4, 4, 0, 0, [1, 2, 4, 8]),
                ("4-chain rack DYN", 4, 4, 1, 1, [1, 2, 4, 8]),
                ("4-chain DYN band4 only", 4, 4, 1, 1, [8]),
                ("1 inst 4 bands mask15", 1, 4, 1, 0, [15])]
        if BIG:   # 16 instances (4 racks of 4)
            cfgs = [("16 inst LR4 (4 racks x 4 bands)", 16, 4, 1, 0, [1, 2, 4, 8]),
                    ("16 inst LR8 (4 racks x 4 bands)", 16, 4, 2, 0, [1, 2, 4, 8]),
                    ("16 inst DYN (4 racks x 4 bands)", 16, 4, 1, 1, [1, 2, 4, 8])]
        for name, k, nb, sl, dyn, masks in cfgs:
            ws = min(wall(code, k, nb, sl, dyn, masks, SHORT_MS, extra) for _ in range(REPS))
            wl = min(wall(code, k, nb, sl, dyn, masks, LONG_MS, extra) for _ in range(REPS))
            rtf = (wl - ws) / ((LONG_MS - SHORT_MS) / 1000.0)
            print(f"  {name:26s} {rtf:.4f} s/s total, {rtf / k:.4f} s/s per instance (short {ws:.1f}s long {wl:.1f}s)", flush=True)


if __name__ == "__main__":
    main()
