#!/usr/bin/env python3
"""Where Reverb+'s load time goes (real Max, VM only): wall time of the shared harness for
  baseline  - a trivial gen~ (Max start + harness floor)
  start     - the Start gen core (cepstrum_lib + reverbplus_conv + reverbplus_start)
  end       - the End gen core
Each case renders 100 ms, so the differences are compile / instantiate cost (AGENTS.md 1d)."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = os.path.join(ROOT, "tests", "sampler_loadtime_probe.js")


def src(*names):
    return "\n".join(open(os.path.join(ROOT, "src", n), encoding="utf-8").read() for n in names)


START = src("cepstrum_lib.genexpr", "reverbplus_conv.genexpr", "reverbplus_start.genexpr")
END = src("reverbplus_end.genexpr")


def case(name, gen_code):
    boxes = [mh.gen_box("obj-g", gen_code, 40, 80, numinlets=2, numoutlets=2)]
    lines = [mh.line("obj-g", 0, "obj-record", 0), mh.line("obj-g", 1, "obj-record", 1)]
    return mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=100)["harness_wall_s"]


runs = int(sys.argv[1]) if len(sys.argv) > 1 else 3
res = {"baseline": [], "start": [], "end": []}
for _ in range(runs):
    res["baseline"].append(case("rl_base", "out1 = in1; out2 = in2;"))
    res["start"].append(case("rl_start", START))
    res["end"].append(case("rl_end", END))
for k, v in res.items():
    print(f"{k:10s} " + " ".join(f"{x:6.2f}s" for x in v) + f"   min {min(v):6.2f}s")
b = min(res["baseline"])
print(f"Start gen compile ~{min(res['start']) - b:.2f}s, End gen compile ~{min(res['end']) - b:.2f}s")
