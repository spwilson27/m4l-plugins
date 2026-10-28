#!/usr/bin/env python3
"""Operator+ in real Max (VM only, AGENTS.md 1a / 1b): the gen core in the shared NonRealTime harness, buffers written by a
v8 probe exactly as the face writes them, notes played through the real allocator at sample-accurate event times.

  python3 scripts/run_opplus_audio_tests.py [case ...]
Expected values for level, ratio, FM index and feedback are measurements of Live's Operator (VM, 2026-10-27).
"""
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import max_harness as mh  # noqa: E402

ROOT = os.path.dirname(HERE)
SOLO = {"osc_b_level": 0, "osc_c_level": 0, "osc_d_level": 0, "osc_a_lev_lt_vel": 0, "filter_on": 0, "algorithm": 10}
SETTLE = 100
OP = 0.1259   # Operator: a 0 dB oscillator at Volume -18 dB peaks at 0.1259


def S(**kw):
    d = dict(SOLO)
    d.update(kw)
    return d


CASES = [
    {"name": "sine220", "vals": S(), "notes": [(0, 57)], "dur": 400, "check": {"f0": (220, 0.3), "peak": (OP, 0.004)}},
    {"name": "ratio660", "vals": S(a_coarse=2, a_fine=500), "notes": [(0, 57)], "dur": 400, "check": {"f0": (660, 0.5)}},
    {"name": "fixed1k", "vals": S(a_fix_on=1, a_fix_freq=0.86923, a_fix_freq_mul=4), "notes": [(0, 40)], "dur": 400, "check": {"f0": (1000, 2)}},
    {"name": "fm_m20", "vals": S(algorithm=0, osc_b_level=0.5, osc_b_lev_lt_vel=0, be_sustain=1), "notes": [(0, 57)], "dur": 400,
     "harm": [0.47, 0.55, 0.17, 0.04], "htol": 0.04},
    {"name": "fm_m10", "vals": S(algorithm=0, osc_b_level=0.75, osc_b_lev_lt_vel=0, be_sustain=1), "notes": [(0, 57)], "dur": 400,
     "harm": [0.77, 0.37, 0.09, 0.56], "htol": 0.05},
    {"name": "fb50", "vals": S(osc_a_feedb=50), "notes": [(0, 57)], "dur": 400, "harm": [0.61, 0.29, 0.19, 0.14], "htol": 0.04},
    {"name": "alg11", "vals": S(algorithm=10, osc_b_level=1, osc_c_level=1, osc_d_level=1, b_coarse=2, c_coarse=3, d_coarse=4,
                                 osc_b_lev_lt_vel=0, osc_c_lev_lt_vel=0, osc_d_lev_lt_vel=0, be_sustain=1, ce_sustain=1, de_sustain=1),
     "notes": [(0, 57)], "dur": 400, "harm": [1, 1, 1, 1], "htol": 0.04},
    {"name": "lowpass", "vals": S(osc_a_wave=9, filter_on=1, filter_freq=0.5, filter_res=0), "notes": [(0, 57)], "dur": 400, "lp": True},
    {"name": "envelope", "vals": S(ae_attack=0.39, ae_decay=0.5, ae_sustain=0.5, ae_release=0.5), "notes": [(0, 57, 600)], "dur": 1200, "env": True},
    {"name": "poly3", "vals": S(), "notes": [(0, 57), (0, 64), (0, 69)], "dur": 400, "f0": 110, "extra_f": [220.0, 329.63, 440.0], "poly": True},
    {"name": "release_silent", "vals": S(ae_release=0.2), "notes": [(0, 57, 100)], "dur": 800, "silent_tail": True},
    {"name": "vibrato", "vals": S(lfo_on=1, lfo_type=0, lfo_range=0, lfo_rate=100, lfo_amt=0.05, osc_a_lt_lfo=1, le_attack=0),
     "notes": [(0, 57)], "dur": 1000, "track": True, "vib": True},
    {"name": "spread", "vals": S(spread=50), "notes": [(0, 57)], "dur": 400, "stereo": True},
    {"name": "noise", "vals": S(osc_a_wave=21), "notes": [(0, 57)], "dur": 300, "noise": True},
]


def probe_file(case):
    d = tempfile.mkdtemp(prefix="opplus_probe_")
    p = os.path.join(d, "opplus_probe.js")
    params = json.load(open(os.path.join(HERE, "opplus_params.json")))
    with open(p, "w") as f:
        f.write("var OP_PARAMS = %s;\nvar CASE = %s;\n" % (json.dumps(params), json.dumps(case)))
        f.write(open(os.path.join(ROOT, "src", "opplus_config.js")).read() + "\n")
        f.write(open(os.path.join(ROOT, "tests", "opplus_probe.js")).read())
    return p


def run_case(case):
    gen = open(os.environ.get("OPPLUS_GEN") or os.path.join(ROOT, "src", "opplus_core.genexpr")).read()
    boxes = [
        mh.msg("obj-bind", "cfgb #0-opcfg, vbuf #0-opvoices, wtab #0-opwaves, scope #0-opscope", 200, 60, 420),
        mh.msg("obj-names", "setnames #0-opcfg #0-opvoices #0-opwaves #0-opscope, init", 200, 90, 420),
        mh.box("obj-cfg", "buffer~ #0-opcfg @samps 448", 540, 60, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-voices", "buffer~ #0-opvoices @samps 256", 540, 90, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-waves", "buffer~ #0-opwaves @samps %d" % (26 * 8 * 2049), 540, 120, 240, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-scope", "buffer~ #0-opscope @samps 528", 540, 150, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-phasor", "phasor~ 2", 200, 180, 60, numinlets=2, numoutlets=1, outlettype=["signal"]),
        mh.box("obj-order", "t b b", 200, 30, 40, numoutlets=2, outlettype=["bang", "bang"]),
        mh.gen_box("obj-gen", gen, 200, 215),
    ]
    lines = [
        mh.line("obj-load", 0, "obj-order", 0),
        mh.line("obj-order", 1, "obj-names", 0), mh.line("obj-names", 0, "obj-js", 0),
        mh.line("obj-order", 0, "obj-bind", 0), mh.line("obj-bind", 0, "obj-gen", 0),
        mh.line("obj-phasor", 0, "obj-gen", 0),
        mh.line("obj-gen", 0, "obj-record", 0), mh.line("obj-gen", 1, "obj-record", 1),
        mh.line("obj-gen", 0, "obj-mute-l", 0), mh.line("obj-gen", 1, "obj-mute-r", 0),
    ]
    events = []
    for n in case["notes"]:
        events.append((SETTLE + n[0], "obj-js", 0, "noteon %d 100" % n[1]))
        if len(n) > 2:
            events.append((SETTLE + n[2], "obj-js", 0, "noteoff %d" % n[1]))
    pc = dict(case)
    pc.setdefault("from_ms", 100)
    pc.setdefault("win_ms", 200)
    pc.setdefault("f0", 220)
    return mh.run_case(case["name"] + os.environ.get("OPPLUS_TAG", ""), boxes, lines, probe_js=probe_file(pc), settle_ms=SETTLE, dur_ms=case["dur"], channels=2,
                       mode="stepped", events=events, probe_object="v8")


def check(case, r):
    errs = []
    if r.get("nan", 0) != 0:
        errs.append("NaN in output")
    for k, (want, tol) in case.get("check", {}).items():
        if abs(float(r[k]) - want) > tol:
            errs.append("%s %.4f vs %.4f" % (k, float(r[k]), want))
    if "harm" in case:
        got = [float(r["h%d" % (i + 1)]) / OP for i in range(len(case["harm"]))]
        if case["name"] == "alg11":
            got = [g / got[0] for g in got]
        for i, (g, w) in enumerate(zip(got, case["harm"])):
            if abs(g - w) > case["htol"]:
                errs.append("h%d %.3f vs %.3f" % (i + 1, g, w))
    env = [float(v) for v in str(r.get("env", "")).split(",") if v != ""]
    if case.get("lp"):
        # saw 64 through LP 745 Hz 24 dB: the 8th harmonic (1760 Hz) is cut by > 18 dB relative to a saw's 1/8
        if not (float(r["h1"]) > 0.6 * OP * 2 / 3.14159 and float(r["h8"]) < float(r["h1"]) / 8 * 0.12):
            errs.append("lowpass h1 %.4f h8 %.5f" % (float(r["h1"]), float(r["h8"])))
    if case.get("env"):
        if not (env[2] > 0.5 * OP):
            errs.append("attack: block 2 %.3f" % env[2])
        if abs(env[45] - 0.1 * OP) > 0.01 * OP + 0.002:
            errs.append("sustain %.4f vs %.4f" % (env[45], 0.1 * OP))
        if env[95] > 0.002:
            errs.append("release not done: %.4f" % env[95])
    if case.get("poly"):
        x = [float(r["x%d" % i]) for i in range(3)]
        if min(x) < 0.8 * OP:
            errs.append("poly fundamentals %s" % x)
    if case.get("silent_tail"):
        if max(env[-20:]) != 0 or float(r["voices"]) != 0:
            errs.append("tail not silent / voice still active (%s, voices %s)" % (max(env[-20:]), r["voices"]))
    if case.get("vib"):
        tr = [float(v) for v in str(r["track"]).split(",") if float(v) > 0][5:]
        if not tr or max(tr) - min(tr) < 3:
            errs.append("no vibrato: %s" % tr[:20])
    if case.get("stereo") and float(r["lrdiff"]) < 0.01:
        errs.append("spread: left == right")
    if case.get("noise") and float(r["peak"]) < 0.05:
        errs.append("noise silent")
    if float(r.get("alive", 0)) <= 0:
        errs.append("scope alive counter did not move")
    return errs


def main(argv):
    names = argv[1:]
    fails = 0
    for c in CASES:
        if names and c["name"] not in names:
            continue
        try:
            r = run_case(c)
        except Exception as e:  # noqa: BLE001
            print("FAIL %-14s %s" % (c["name"], e))
            fails += 1
            continue
        errs = check(c, r)
        brief = "f0 %.2f peak %.4f h1..4 %s" % (float(r["f0"]), float(r["peak"]), " ".join("%.3f" % (float(r["h%d" % i]) / OP) for i in range(1, 5)))
        print(("PASS" if not errs else "FAIL") + " %-14s %s %s" % (c["name"], brief, "; ".join(errs)))
        fails += bool(errs)
    print("%d failed" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
