#!/usr/bin/env python3
"""Deviate gen cost (real Max, VM only; AGENTS.md 1a / 1d).

    /usr/bin/python3 scripts/measure_deviate.py compile [runs]     wall time of the shared harness for a trivial gen and the full core
                                                                   (the difference is the compile / instantiate cost; target <= 2.5 s)
    /usr/bin/python3 scripts/measure_deviate.py cpu [reps]         NonRealTime wall seconds per second of audio (share of one core):
                                                                   idle (silence), busy (a hit every 250 ms, default metas), heavy (every meta 100)
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


def cmd_compile(runs):
    code = rt.gen_code()
    res = {"baseline": [], "deviate": []}
    for _ in range(runs):
        res["baseline"].append(compile_case("dv_base", "out1 = in1; out2 = in2;"))
        res["deviate"].append(compile_case("dv_full", code))
    for k, v in res.items():
        print(f"{k:10s} " + " ".join(f"{x:6.2f}s" for x in v) + f"   min {min(v):6.2f}s")
    print(f"Deviate gen compile ~{min(res['deviate']) - min(res['baseline']):.2f}s")


def cpu_wall(tag, code, source, extra, dur, ir=False):
    """Wall seconds of the harness for `dur` ms of audio through SOURCE -> device gen (no tap): includes Max start-up and the gen compile,
    which cancel in the slope between two durations."""
    boxes = [
        mh.msg("dev-params", rt.params_text(extra), 40, 40, 900),
        mh.msg("dev-src-params", source, 40, 70, 600),
        mh.msg("dev-bind", "scope #0-dvscope, ctl #0-dvctl, ir #0-dvir, spec #0-dvspec", 40, 100, 560),
        mh.box("dev-buf-scope", "buffer~ #0-dvscope @samps 1536", 980, 20, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-ctl", "buffer~ #0-dvctl @samps 64", 980, 45, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-ir", "buffer~ #0-dvir @samps %d" % (2500000 if ir else 4096), 980, 70, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-spec", "buffer~ #0-dvspec @samps 2048 @chans 5", 980, 95, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-src", rt.SOURCE_GEN, 40, 200, numinlets=1, numoutlets=3),
        mh.gen_box("dev-gen", code, 40, 300, numinlets=4, numoutlets=2),
    ]
    lines = [mh.line("obj-load", 0, "dev-params", 0), mh.line("obj-load", 0, "dev-src-params", 0), mh.line("obj-load", 0, "dev-bind", 0),
             mh.line("dev-params", 0, "dev-gen", 0), mh.line("dev-bind", 0, "dev-gen", 0), mh.line("dev-src-params", 0, "dev-src", 0),
             mh.line("dev-src", 0, "dev-gen", 0), mh.line("dev-src", 1, "dev-gen", 1),
             mh.line("dev-gen", 0, "obj-record", 0), mh.line("dev-gen", 1, "obj-record", 1)]
    if ir:
        boxes.append(mh.msg("dev-ir-load", "replace " + rt.IR_WAV, 640, 70, 560))
        lines += [mh.line("obj-load", 0, "dev-ir-load", 0), mh.line("dev-ir-load", 0, "dev-buf-ir", 0)]
    return mh.run_case(f"cpu_{tag}", boxes, lines, probe_js=PROBE, settle_ms=0, dur_ms=dur, channels=2, sr=rt.SR, mode="nrt")["harness_wall_s"]


def slope(tag, code, source, extra, reps, ir=False, d1=1000, d2=7000):
    s = []
    for _ in range(reps):
        w1 = cpu_wall(tag + "_a", code, source, extra, d1, ir)
        w2 = cpu_wall(tag + "_b", code, source, extra, d2, ir)
        s.append((w2 - w1) / ((d2 - d1) / 1000.0))
    return min(s), s


def drop_function(text, name):
    """The gen text without the function `name` (definition and its comment block) and without the statements that call it."""
    lines = text.split("\n")
    start = next((k for k, ln in enumerate(lines) if ln.startswith(name + "(") and ln.rstrip().endswith("{")), None)
    if start is None:
        return text
    top = start
    while top > 0 and lines[top - 1].startswith("//"):
        top -= 1
    end = start
    while lines[end] != "}":
        end += 1
    lines = lines[:top] + lines[end + 1:]
    import re
    pat = re.compile(r"^\s*(?:[A-Za-z_]\w* = )?" + name + r"\(.*\);\s*$")
    return "\n".join(ln for ln in lines if not pat.match(ln))


def cmd_variants(runs):
    """Compile cost of each module: the full gen against the gen without the module's definition and call sites."""
    code = rt.gen_code()
    mods = sys.argv[3:] or ["dvc_tick", "dvc_pass", "gl_drive", "gl_crush", "gl_filter", "gl_ring", "gl_form", "gl_comb", "gl_phas", "dv_grain", "dv_rev", "dv_dly",
                            "gl_slap", "dv_res", "dv_chor", "dv_snap", "dv_click", "dv_draw", "dv_hidden"]
    base = min(compile_case("dv_base", "out1 = in1; out2 = in2;") for _ in range(runs))
    full = min(compile_case("dv_full", code) for _ in range(runs))
    print(f"baseline {base:.2f}s  full {full:.2f}s  compile {full - base:.2f}s")
    for m in mods:
        v = min(compile_case("dv_var_" + m, drop_function(code, m)) for _ in range(runs))
        print(f"without {m:10s} {v - base:5.2f}s  (saves {full - v:5.2f}s)", flush=True)


def cmd_cpu(reps):
    code = rt.gen_code()
    passthru = "out1 = in1; out2 = in2;"
    hits = "kind 6, amp 0.8, s1 50, per 250"
    heavy = ", ".join([f"dvv{i} 100" for i in range(8)] + [f"dvr{i} 0" for i in range(8)])
    scen = [("idle", "kind 3", "", False), ("busy", hits, "", False), ("heavy", "kind 6, amp 0.8, s1 50, per 400", heavy, True),
            ("heavy_noconv", "kind 6, amp 0.8, s1 50, per 400", heavy, False)]
    res = {}
    for name, src, extra, ir in scen:
        base, _ = slope(name + "_base", passthru, src, "", reps, ir)
        dev, raw = slope(name, code, src, extra, reps, ir)
        res[name] = (dev, base)
        print(f"{name:14s} device slope {dev:.4f} s/s (min of {len(raw)}), source+harness {base:.4f} s/s  ->  about {100 * (dev - base):.1f} % of one core")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "variants":
        cmd_variants(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
    elif len(sys.argv) > 1 and sys.argv[1] == "cpu":
        cmd_cpu(int(sys.argv[2]) if len(sys.argv) > 2 else 3)
    else:
        cmd_compile(int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[1] == "compile" else 3)
