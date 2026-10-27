#!/usr/bin/env python3
"""Deviate gen cost (real Max, VM only; AGENTS.md 1a / 1d).

    /usr/bin/python3 scripts/measure_deviate.py compile [runs]     wall time of the shared harness for a trivial gen and the full core
                                                                   (the difference is the compile / instantiate cost; target <= 2.5 s)
    /usr/bin/python3 scripts/measure_deviate.py variants [runs]    compile cost of each module (the full gen against the gen without the module)
CPU is measured by the audio cases perf_idle / perf_busy / perf_heavy / perf_spec of scripts/run_deviate_audio_tests.py (adstatus cpu on the real-time
driver; the NonRealTime driver takes about 1.8 s of wall time per second of audio in the VM, source and harness included, which a few percent of CPU cannot be resolved from).
The gen text is build_deviate.gen_code() (what the device embeds); DEVIATE_GEN_FILE=<path> measures another text."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import max_harness as mh  # noqa: E402
import run_deviate_audio_tests as rt  # noqa: E402

ROOT = os.path.dirname(HERE)
PROBE = os.path.join(ROOT, "tests", "sampler_loadtime_probe.js")


def compile_case(name, code):
    boxes = [mh.gen_box("obj-g", code, 40, 80, numinlets=4, numoutlets=2)]
    lines = [mh.line("obj-g", 0, "obj-record", 0), mh.line("obj-g", 1, "obj-record", 1)]
    return mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=100)["harness_wall_s"]


def compile_file_case(name):
    """The same core as the device loads it: the minified .gendsp as a file-backed gen~."""
    path = rt.gendsp_files()[0]
    boxes = [mh.box("obj-g", "gen~ @gen " + path, 40, 80, numinlets=4, numoutlets=2, outlettype=["signal", "signal"])]
    lines = [mh.line("obj-g", 0, "obj-record", 0), mh.line("obj-g", 1, "obj-record", 1)]
    return mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=100)["harness_wall_s"]


def cmd_compile(runs):
    code = rt.gen_code()
    res = {"baseline": [], "deviate": [], "file": []}
    for _ in range(runs):
        res["baseline"].append(compile_case("dv_base", "out1 = in1; out2 = in2;"))
        res["deviate"].append(compile_case("dv_full", code))
        res["file"].append(compile_file_case("dv_file"))
    for k, v in res.items():
        print(f"{k:10s} " + " ".join(f"{x:6.2f}s" for x in v) + f"   min {min(v):6.2f}s")
    print(f"Deviate gen compile ~{min(res['deviate']) - min(res['baseline']):.2f}s (gen.codebox~), ~{min(res['file']) - min(res['baseline']):.2f}s (minified .gendsp as the device loads it)")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "variants":
        cmd_variants(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    else:
        cmd_compile(int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "compile" else 3)
