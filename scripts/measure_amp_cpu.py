#!/usr/bin/env python3
"""DSP cost of Neural Amp's generated gen in real Max (inside the tart VM, AGENTS.md 1a), on the shared NonRealTime harness.

    scripts/vm_amp.sh run measure_amp_cpu.py [models=feather,standard,lstm] [dirs=amp_old,amp] [stereo=0] [n=8] [reps=3] [long=6000]

For each model and each fixture directory under tests/out (`node tests/amp_fixtures.js <models>` writes tests/out/amp; copy an older build's
.genexpr files into another directory to compare), the cost of ONE instance in seconds of NonRealTime wall time per second of audio (a
real-time factor on one core, not Live's CPU meter): slope (long - short render) of n instances minus 1 instance, over n - 1. The instances
play noise through the model with the Pre-EQ tone stack fixture active (all 10 biquads run), Gain 0 dB, Normalize 0 dB.

mode=rt (recommended; the shared VM makes NonRealTime wall times noisy): n instances on the real CoreAudio driver for 4 s, Max's
`adstatus cpu` average and maximum (the audio_device harness mode, like run_amp_audio_tests.py's cpu_ cases). Run it while Live is idle,
e.g. under the Live lock: scripts/vm_live_lock.sh amp-cpu -- scripts/vm_amp.sh run measure_amp_cpu.py mode=rt
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh  # noqa: E402
import measure_spectral as ms  # noqa: E402

FIX = os.path.join(mh.ROOT, "tests", "out")
STIM = "History n(0);\nn = n + 1;\nr = noise() * 0.3;\nout1 = r;\nout2 = noise() * 0.3;\n"


def patch(code_dir, model, count, stereo):
    w = os.path.join(FIX, "amp", model + "_w.wav")
    cf = os.path.join(FIX, "amp", "cf_pre.wav")
    code = open(os.path.join(FIX, code_dir, model + ".genexpr"), encoding="utf-8").read()
    boxes = [mh.gen_box("obj-stim", STIM, 40, 100, numinlets=1, numoutlets=2),
             mh.box("obj-w", f"buffer~ amp_w_m {w}", 520, 60, 300, numoutlets=2, outlettype=["float", "bang"]),
             mh.box("obj-cf", f"buffer~ amp_cf_m {cf}", 520, 90, 300, numoutlets=2, outlettype=["float", "bang"])]
    lines = []
    for i in range(count):
        gid = f"obj-g{i}"
        boxes.append(mh.box(f"obj-sc{i}", f"buffer~ amp_sc_m{i} 3136 1", 520, 120, 240, numoutlets=2, outlettype=["float", "bang"]))
        boxes.append(mh.gen_box(gid, code, 200 + 60 * i, 260))
        boxes.append(mh.msg(f"obj-p{i}", f"w amp_w_m, cf amp_cf_m, scope amp_sc_m{i}, wbase 0, mok 1, stmode {stereo}, eqpre 1", 200 + 60 * i, 220, 300))
        lines += [mh.line("obj-load", 0, f"obj-p{i}", 0), mh.line(f"obj-p{i}", 0, gid, 0),
                  mh.line("obj-stim", 0, gid, 0), mh.line("obj-stim", 1, gid, 1), mh.line(gid, 0, "obj-mute-l", 0)]
    lines.append(mh.line("obj-g0", 0, "obj-record", 0))
    return boxes, lines


def render(name, boxes, lines, dur):
    for attempt in range(3):
        try:
            return ms.render(name, boxes, lines, dur)
        except RuntimeError as ex:
            if "no result" not in str(ex) or attempt == 2:
                raise
            print(f"retry {name}: {ex}", flush=True)


SHORT_MS, LONG_MS = 1000, 6000


def slope(boxes, lines, tag, reps):
    vals = []
    for i in range(reps):
        ws = render(f"amc_{tag}_s{i}", boxes, lines, SHORT_MS)
        wl = render(f"amc_{tag}_l{i}", boxes, lines, LONG_MS)
        vals.append((wl - ws) / ((LONG_MS - SHORT_MS) / 1000.0))
    vals.sort()
    return vals[len(vals) // 2]


def rt(d, model, count, stereo, dur=4000):
    boxes, lines = patch(d, model, count, stereo)
    boxes += [mh.box("obj-metro", "metro 100", 40, 480, 70, numinlets=2),
              mh.box("obj-ads", "adstatus cpu", 40, 510, 90, outlettype=["float"]),
              mh.box("obj-cpup", "prepend cpu", 40, 540, 90)]
    lines += [mh.line("obj-load", 0, "obj-metro", 0), mh.line("obj-metro", 0, "obj-ads", 0),
              mh.line("obj-ads", 0, "obj-cpup", 0), mh.line("obj-cpup", 0, "obj-js", 0)]
    # audio_device on purpose: real-time CPU load cannot be measured on the NonRealTime driver.
    r = mh.run_case(f"amc_rt_{d}_{model}_{count}", boxes, lines, probe_js=os.path.join(mh.ROOT, "tests", "amp_probe.js"),
                    probe_args="cpu", settle_ms=300, dur_ms=dur, mode="audio_device")
    return r["cpuavg"], r["cpumax"]


def main():
    opts = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a)
    models = opts.get("models", "feather,standard,lstm").split(",")
    dirs = opts.get("dirs", "amp_old,amp").split(",")
    stereo = int(opts.get("stereo", "0"))
    n = int(opts.get("n", "8"))
    reps = int(opts.get("reps", "3"))
    global LONG_MS
    LONG_MS = int(opts.get("long", str(LONG_MS)))
    if opts.get("mode") == "rt":
        for model in models:
            for d in dirs:
                avg, mx = rt(d, model, n, stereo)
                print(f"RT {model} {'stereo' if stereo else 'mono'} {d}: {n} instances adstatus cpu avg {avg:.1f} % max {mx:.0f} %", flush=True)
        return
    for model in models:
        res = {}
        for d in dirs:
            b1, l1 = patch(d, model, 1, stereo)
            bn, ln = patch(d, model, n, stereo)
            s1 = slope(b1, l1, f"{d}_{model}_1", reps)
            sn = slope(bn, ln, f"{d}_{model}_n", reps)
            res[d] = (sn - s1) / (n - 1)
            print(f"CPU {model} {'stereo' if stereo else 'mono'} {d}: per instance {res[d]:.4f} s/s = {res[d] * 100:.2f} % of one core "
                  f"(1 inst {s1:.4f}, {n} inst {sn:.4f})", flush=True)
        if len(dirs) == 2:
            a, b = res[dirs[0]], res[dirs[1]]
            print(f"CPU {model}: {dirs[1]} / {dirs[0]} = {b / max(a, 1e-9):.2f}", flush=True)


if __name__ == "__main__":
    main()
