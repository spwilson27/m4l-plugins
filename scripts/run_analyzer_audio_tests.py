#!/usr/bin/env python3
"""Analyzer tap checks. Run only inside the macos-01 VM (AGENTS.md section 1a).

Cases:
  tone1k       1 kHz at -20 dBFS, both channels. RMS, LUFS, true peak, correlation, pass-through, scope ring.
  invert       same tone with the right channel flipped. Loudest band correlation near -1.
  intersample  18 kHz at amplitude 0.5, phase 0.4 rad. True peak above the sample peak.
  lowband      40 Hz. The lowest crossover band holds more energy than the other three.
               (80 Hz does not: the complementary one-poles at 150 Hz are only a few dB down there,
               and the lowpass phase puts more power in the next band.)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN = open(os.path.join(ROOT, "src", "analyzer_core.genexpr"), encoding="utf-8").read()
PROBE = os.path.join(ROOT, "tests", "analyzer_probe.js")


def chain(kind):
    boxes, lines = [], []
    if kind == "intersample":
        boxes.append(mh.gen_box(
            "dev-tone",
            "History n(0);\nn = n + 1;\nout1 = 0.5 * sin(6.283185307179586 * 18000 / samplerate * n + 0.4);\n",
            700, 180, numinlets=1, numoutlets=1,
        ))
        lines.append(mh.line("dev-tone", 0, "dev-gen", 0))
        lines.append(mh.line("dev-tone", 0, "dev-gen", 1))
    else:
        freq = 40 if kind == "lowband" else 1000
        amp = 0.25 if kind == "lowband" else 0.1
        boxes += [
            mh.box("dev-tone", "cycle~ %d" % freq, 700, 160, 80, numinlets=2, outlettype=["signal"]),
            mh.box("dev-amp", "*~ %s" % amp, 700, 200, 60, numinlets=2, outlettype=["signal"]),
        ]
        lines.append(mh.line("dev-tone", 0, "dev-amp", 0))
        lines.append(mh.line("dev-amp", 0, "dev-gen", 0))
        if kind == "invert":
            boxes.append(mh.box("dev-inv", "*~ -1", 780, 240, 50, numinlets=2, outlettype=["signal"]))
            lines += [mh.line("dev-amp", 0, "dev-inv", 0), mh.line("dev-inv", 0, "dev-gen", 1)]
        else:
            lines.append(mh.line("dev-amp", 0, "dev-gen", 1))
    boxes += [
        mh.gen_box("dev-gen", GEN, 200, 200),
        mh.msg("dev-params", "f1 150, f2 1000, f3 6000", 200, 40, 220),
        mh.msg("dev-bind", "scope #0-analyzerscope", 200, 70, 200),
        mh.box("dev-buf", "buffer~ #0-analyzerscope @samps 17952", 200, 110, 260, numoutlets=2, outlettype=["float", "bang"]),
    ]
    lines += [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    return boxes, lines


def check(name, got):
    frame = float(got["frame"])
    if frame < 5:
        raise SystemExit("%s: gen frame counter did not move (%s)" % (name, frame))
    if name == "tone1k":
        pk, tp, rms, lufs = float(got["pk"]), float(got["tp"]), float(got["rms"]), float(got["lufs"])
        corr, scopepk, pas = float(got["corr"]), float(got["scopepk"]), float(got["pass"])
        if not (0.09 <= pk <= 0.11):
            raise SystemExit("%s: sample peak %s" % (name, pk))
        if not (0.09 <= tp <= 0.14):
            raise SystemExit("%s: true peak %s" % (name, tp))
        if not (-24 <= rms <= -22):
            raise SystemExit("%s: rms %s dB" % (name, rms))
        if not (-22 <= lufs <= -18):
            raise SystemExit("%s: lufs %s" % (name, lufs))
        if corr < 0.9:
            raise SystemExit("%s: correlation %s" % (name, corr))
        if scopepk < 0.08:
            raise SystemExit("%s: scope ring %s" % (name, scopepk))
        if pas < 0.09:
            raise SystemExit("%s: pass-through %s" % (name, pas))
    elif name == "invert":
        if float(got["corr"]) > -0.9:
            raise SystemExit("%s: correlation %s" % (name, got["corr"]))
    elif name == "intersample":
        pk, tp = float(got["pk"]), float(got["tp"])
        if not (tp > pk * 1.01):
            raise SystemExit("%s: true peak %s is not above sample peak %s" % (name, tp, pk))
    elif name == "lowband":
        b = [float(got["b%d" % i]) for i in range(4)]
        if not (b[0] > b[1] and b[0] > b[2] and b[0] > b[3] and b[0] > 0):
            raise SystemExit("%s: band energy %s" % (name, b))
    else:
        raise SystemExit("unknown case " + name)
    print("ok", name, "frame", got["frame"], "pk", got.get("pk"), "tp", got.get("tp"), "lufs", got.get("lufs"), "corr", got.get("corr"))


def main():
    wanted = sys.argv[1:] or ["tone1k", "invert", "intersample", "lowband"]
    for name in wanted:
        boxes, lines = chain(name)
        got = mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=400, dur_ms=250, channels=2)
        check(name, got)


if __name__ == "__main__":
    main()
