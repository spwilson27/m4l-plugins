#!/usr/bin/env python3
"""Where Glitch's gen compile time goes (real Max, VM only, AGENTS.md 1a / 1d): harness wall time of a 100 ms render of ONE stage's gen
(or a custom group of chain instances), minus a trivial gen = what loading that gen~ costs (the harness compiles at patch load,
one gen after the other, like Live does for gen~ objects created by the v8ui).

  python3 scripts/measure_glitch_load.py [runs] [what ...]
    stage:<id>              a built stage (h head, a b c d e groups, s spectral, t tail)
    group:<first>[-<last>]  an ad-hoc group of chain instances (ids, e.g. group:drvA, group:gpit-gstr)
    stages                  every built stage in turn
    singles                 every chain instance as its own group (what per-module gens would cost)
    all                     every stage together in one patch (what loading a device with every module costs)
Gen caches identical compiles inside one Max process, so every case is a fresh process (the harness starts one per run)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import glitch_common as gc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = os.path.join(ROOT, "tests", "glitch_loadtime_probe.js")
LAYOUT = gc.load_layout()
STAGES = {st["id"]: st for st in LAYOUT["stages"]}


def group_stage(first, last=None):
    order = LAYOUT["order"]
    k0 = order.index(first)
    k1 = order.index(last or first) + 1
    base = LAYOUT["base"]
    return {"id": f"g{k0}_{k1}", "index": 1, "role": "spec" if first == "spec" else "group", "side": "pre", "insts": order[k0:k1], "k0": k0, "k1": k1,
            "plo": base[order[k0]], "phi": base[order[k1]] if k1 < len(order) else LAYOUT["mvBase"], "mlo": LAYOUT["mvBase"] + LAYOUT["mvN"] * k0,
            "mhi": LAYOUT["mvBase"] + LAYOUT["mvN"] * k1, "ins": ["L", "R", "tk", "bi", "bf"] + (["quiet"] if first == "spec" else []), "outs": ["L", "R"]}


def case(name, stages):
    boxes, lines = [], []
    for k, st in enumerate(stages):
        code = gc.gen_source(LAYOUT, stage=st)
        boxes.append(mh.gen_box(f"obj-g{k}", code, 40 + 240 * k, 80, len(st["ins"]), len(st["outs"])))
    lines = [mh.line("obj-g0", 0, "obj-record", 0), mh.line("obj-g0", min(1, len(stages[0]["outs"]) - 1), "obj-record", 1)]
    r = mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=100)
    return r["harness_wall_s"], sum(len(gc.gen_source(LAYOUT, stage=st).split("\n")) for st in stages)


def trivial():
    boxes = [mh.gen_box("obj-g", "out1 = in1; out2 = in2;", 40, 80)]
    lines = [mh.line("obj-g", 0, "obj-record", 0), mh.line("obj-g", 1, "obj-record", 1)]
    return mh.run_case("lt_base", boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=100)["harness_wall_s"]


def main():
    args = sys.argv[1:]
    runs = int(args[0]) if args and args[0].isdigit() else 2
    what = [a for a in args if not a.isdigit()] or ["stages"]
    base = [trivial() for _ in range(runs)]
    b = min(base)
    print(f"{'baseline (trivial gen)':26s} " + " ".join(f"{x:6.2f}s" for x in base))
    jobs = []
    for w in what:
        if w == "stages":
            jobs += [(f"stage:{k}", [v]) for k, v in STAGES.items()]
        elif w == "singles":
            jobs += [(f"group:{i}", [group_stage(i)]) for i in LAYOUT["order"] if i != "gstr"]
        elif w == "all":
            jobs.append(("all stages", list(STAGES.values())))
        elif w.startswith("stage:"):
            jobs.append((w, [STAGES[w[6:]]]))
        elif w.startswith("group:"):
            f, _, l = w[6:].partition("-")
            jobs.append((w, [group_stage(f, l or None)]))
    for name, stages in jobs:
        res = [case("lt_" + name.replace(":", "_").replace(" ", "_").replace("-", "_"), stages) for _ in range(runs)]
        w = [r[0] for r in res]
        print(f"{name:26s} " + " ".join(f"{x:6.2f}s" for x in w) + f"   compile ~{min(w) - b:5.2f}s  ({res[0][1]} lines)")


if __name__ == "__main__":
    main()
