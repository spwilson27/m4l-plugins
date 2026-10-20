#!/usr/bin/env python3
"""Where Better Sampler's load time goes (real Max, VM only): wall time of the shared harness for
  baseline  - a trivial gen~ (Max start + harness floor)
  gen       - the full sampler gen core
  gen+faces - the gen core plus the three v8ui face canvases from the built device
Each case renders 100 ms, so the differences are compile / instantiate cost."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = os.path.join(ROOT, "tests", "sampler_loadtime_probe.js")
GEN = open(os.path.join(ROOT, "src", "sampler_core.genexpr")).read()
DEV = json.loads(open(os.path.join(ROOT, "devices", "Better Sampler.amxd"), "rb").read()[32:])["patcher"]
FACES = [b for b in DEV["boxes"] if b["box"]["id"] in ("obj-viz", "obj-viz-side", "obj-viz-insp")]


def case(name, gen_code, extra):
    boxes = [mh.gen_box("obj-g", gen_code, 40, 80)] + extra
    lines = [mh.line("obj-g", 0, "obj-record", 0), mh.line("obj-g", 1, "obj-record", 1)]
    r = mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=100)
    return r["harness_wall_s"]


runs = int(sys.argv[1]) if len(sys.argv) > 1 else 2
res = {"baseline": [], "gen": [], "gen+faces": []}
for _ in range(runs):
    res["baseline"].append(case("lt_base", "out1 = in1; out2 = in2;", []))
    res["gen"].append(case("lt_gen", GEN, []))
    res["gen+faces"].append(case("lt_faces", GEN, FACES))
for k, v in res.items():
    print(f"{k:10s} " + " ".join(f"{x:6.2f}s" for x in v) + f"   min {min(v):6.2f}s")
b = min(res["baseline"])
print(f"gen compile ~{min(res['gen']) - b:.2f}s, faces ~{min(res['gen+faces']) - min(res['gen']):.2f}s")
