#!/usr/bin/env python3
"""Which short GenExpr names fail to compile in Max. VM only."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

CASES = [
    ("slew", "a(b,c){\nHistory s(0);\nHistory g(0);\ns=(g==0)?b:mix(b,s,c);\ng=1;\nreturn s;\n}\nout1 = a(in1, 0.5);\n"),
    ("slew_sp", "a(b, c) {\nHistory s(0);\nHistory g(0);\ns = (g == 0) ? b : mix(b, s, c);\ng = 1;\nreturn s;\n}\nout1 = a(in1, 0.5);\n"),
    ("hist_s", "History s(0);\ns = in1;\nout1 = s;\n"),
    ("eq0", "History g(0);\nout1 = (g==0) ? in1 : 0;\n"),
]


def main():
    want = sys.argv[1:]
    cases = [(n, s) for n, s in CASES if not want or n in want]
    boxes = [
        mh.box("dev-noise", "noise~", 40, 40, 60, numinlets=0, numoutlets=1, outlettype=["signal"]),
        mh.box("dev-gain", "*~ 0.25", 40, 80, 60, numinlets=2, numoutlets=1, outlettype=["signal"]),
    ]
    lines = [mh.line("dev-noise", 0, "dev-gain", 0)]
    for i, (name, src) in enumerate(cases):
        boxes.append(mh.gen_box(f"dev-{name}", src, 200, 40 + i * 30, numinlets=1, numoutlets=1))
        lines.append(mh.line("dev-gain", 0, f"dev-{name}", 0))
        lines.append(mh.line(f"dev-{name}", 0, "obj-record", i))
    lines.append(mh.line("dev-ok" if any(n == "ok" for n, _ in cases) else cases[0][0] and "dev-" + cases[0][0], 0, "obj-mute-l", 0))
    # fix mute: always first case
    lines[-1] = mh.line(f"dev-{cases[0][0]}", 0, "obj-mute-l", 0)
    lines.append(mh.line(f"dev-{cases[0][0]}", 0, "obj-mute-r", 0))
    lines.append(mh.line("obj-mute-l", 0, "obj-dac", 0))
    lines.append(mh.line("obj-mute-r", 0, "obj-dac", 1))
    probe = os.path.join(mh.ROOT, "tests", "gen_name_probe.js")
    result = mh.run_case(
        "gen_name_diag", boxes, lines,
        probe_js=probe, probe_args=str(len(cases)),
        settle_ms=100, dur_ms=100, channels=len(cases), sr=48000,
    )
    for i, (name, _) in enumerate(cases):
        peak = float(result.get(f"ch{i}", "nan"))
        print(f"{name} peak {peak:.4f} {'FAIL' if peak < 0.05 else 'ok'}")


if __name__ == "__main__":
    main()
