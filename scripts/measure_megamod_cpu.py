#!/usr/bin/env python3
"""Compile time, DSP cost and old-vs-new equivalence of the Mega Modulator engine + routers in real Max (inside the tart VM, AGENTS.md 1a),
on the shared NonRealTime harness (AGENTS.md 1b).

    scripts/vm_megamod_keys.sh py measure_megamod_cpu.py compile [old=<dir>]
    scripts/vm_megamod_keys.sh py measure_megamod_cpu.py cpu [old=<dir>] [chains=6] [reps=3]
    scripts/vm_megamod_keys.sh py measure_megamod_cpu.py compare old=<dir>

`old=<dir>` holds the build to compare against: `engine.genexpr` (the old src/megamod_engine.genexpr) and `common.py` (the old
scripts/megamod_common.py, for its router_gen_code). Without it only the current build is measured.

compile: harness wall time of a 100 ms render of one gen minus a trivial gen (min of 3): the engine and one router.
cpu:     NonRealTime wall seconds per second of audio of `chains` complete chains (engine + 8 routers), slope of (long - short) window,
         divided by `chains` = the cost of one device's DSP as a share of one core (a real-time factor of the patch, not Live's CPU
         meter). States: empty (no modulator), s4 (4 modulators, 8 mappings), s16 (16 modulators of every type, 64 mappings).
compare: renders a rich state (all types, 64 mappings incl. Remote and depth, self-mod routes, a mid-run-free run) with the old and the
         new gens and compares every recorded router / engine output sample by sample (max abs difference).
"""
import importlib.util
import signal
import json
import os
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh  # noqa: E402
import megamod_common as mc  # noqa: E402

ROOT = mh.ROOT
SRC = os.path.join(ROOT, "src")
PROBE_JS = os.path.join(ROOT, "tests", "megamod_cpu_probe.js")
CONFIG_JS = os.path.join(SRC, "megamod_config.js")
SHORT_MS, LONG_MS = 1000, 41000
STIM = ("History n(0);\nn = n + 1;\nk = n - 1;\nr = noise();\n"
        "x = 0.1 * sin(6.283185307179586 * 440 * k / 48000) + 0.25 * r;\nout1 = x;\nout2 = x * 0.5;\n")

# a deterministic stimulus for `compare` (gen noise() is seeded differently on every load, which made input-dependent outputs (the Follower) differ between two renders)
STIM_DET = ("History n(0);\nHistory rs(12345);\nn = n + 1;\nk = n - 1;\nrs = (rs * 16807) - 2147483647 * floor((rs * 16807) / 2147483647);\nr = rs / 2147483647 * 2 - 1;\n"
            "x = 0.1 * sin(6.283185307179586 * 440 * k / 48000) + 0.25 * r;\nout1 = x;\nout2 = x * 0.5;\n")

MAP_A = {"mode": "mod", "polarity": 0, "range": 0.8, "curve": 3, "curveAmt": 0.6, "curveSteps": 4}
MAP_R = {"mode": "remote", "min": 0.85, "max": 0.15, "polarity": -1, "range": 0.9, "curve": 1, "curveAmt": 0.5, "curveSteps": 4, "depth": 0.7}
MAP_ID = {"mode": "mod", "polarity": 0, "range": 1.0, "curve": 0, "curveAmt": 0.5, "curveSteps": 4}
MSEG_POINTS = [{"x": 0, "y": 0, "curve": 0, "sCurve": 0}, {"x": 0.3, "y": 1, "curve": 0.5, "sCurve": 0},
               {"x": 0.6, "y": 0.2, "curve": -0.4, "sCurve": 1}, {"x": 1, "y": 0.8, "curve": 0, "sCurve": 0}]
STEPVALS = [(i * 7 % 10) / 10.0 for i in range(32)]


def mod(slot, mtype, **p):
    d = {"slot": slot, "type": mtype, "p": p}
    if mtype == 5:
        d["points"] = MSEG_POINTS
    if mtype == 4:
        d["stepVals"] = STEPVALS
    return d


def state(name):
    """(CASE dict, label) for a named state."""
    if name == "empty":
        return {"mods": [], "maps": []}
    if name == "s4":
        mods = [mod(0, 1, rate=2.0, shape=0, bipolar=1, depth=1.0), mod(1, 1, rate=0.7, shape=2, bipolar=0, depth=0.8),
                mod(2, 3, rate=3.0, smooth=0.3, seed=5), mod(3, 2, attack=5, release=80, gain=6)]
        maps = [{"slot": k, "src": k // 2, "map": MAP_A if k % 2 == 0 else MAP_R} for k in range(8)]
        return {"mods": mods, "maps": maps}
    types = [1, 1, 2, 3, 4, 5, 6, 7, 8, 1, 3, 4, 5, 2, 1, 6]
    mods = []
    for i, t in enumerate(types):
        if t == 1:
            mods.append(mod(i, 1, rate=0.5 + i * 0.37, shape=i % 5, bipolar=i % 2, depth=0.9))
        elif t == 2:
            mods.append(mod(i, 2, attack=4, release=90, gain=3))
        elif t == 3:
            mods.append(mod(i, 3, rate=2.0 + i, smooth=0.2, seed=i))
        elif t == 4:
            mods.append(mod(i, 4, rate=3.0, steps=8, glide=0.2))
        elif t == 5:
            mods.append(mod(i, 5, rate=1.5, depth=1.0))
        elif t == 6:
            mods.append(mod(i, 6, attack=20, decay=80, sustain=0.5, release=120, thresh=-30, sync=1, bipolar=0, depth=1.0))
        elif t == 7:
            mods.append(mod(i, 7, x=0.3, y=0.7, depth=1.0, slew=0.1))
        else:
            mods.append(mod(i, 8, sync=1, bipolar=0, depth=1.0, slew=0.1))
    maps = [{"slot": k, "src": k // 4, "out": 1 if (k % 4 == 3 and types[k // 4] in (7, 8)) else 0,
             "map": MAP_A if k % 3 else MAP_R} for k in range(64)]
    return {"mods": mods, "maps": maps}


def compare_state():
    """The 'compare' state: s16 plus mappings in all routers (slots 70 / 130 / 200 / 255), self-mod routes (control, switch, depth)."""
    c = state("s16")
    c["maps"] += [{"slot": s, "src": s % 16, "map": MAP_A if s % 2 else MAP_R} for s in (70, 130, 200, 255)]
    # a disabled-style mapping is a route of -1: slot 40 is removed
    c["maps"] = [m for m in c["maps"] if m["slot"] != 40]
    c["selfroutes"] = [
        {"src": 0, "dest": 1 * 6 + 0, "map": {"mode": "mod", "polarity": 0, "range": 0.06}},      # LFO 1 -> M2 A (rate of modulator 2)
        {"src": 1, "dest": 96 + 0 * 6 + 2, "map": {"mode": "mod", "polarity": 0, "range": 1.0}},  # LFO 2 -> M1 bipolar toggle
        {"src": 0, "dest": 192 + 3, "map": {"mode": "mod", "polarity": 0, "range": 0.8}},          # LFO 1 -> depth of slot 3
    ]
    c["dump"] = True
    return c


def load_old(old):
    spec = importlib.util.spec_from_file_location("megamod_common_old", os.path.join(old, "common.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return open(os.path.join(old, "engine.genexpr"), encoding="utf-8").read(), m


def new_build():
    return open(os.path.join(SRC, "megamod_engine.genexpr"), encoding="utf-8").read(), mc


def patch(engine, common, case, chains, record_outs=(), nrouters=None, stim=STIM):
    """chains x (engine + 8 routers + 8 buffers). record_outs: (kind, index) pairs of chain 0 to record: ("e", n) engine outlet n, ("r", router, outlet)."""
    boxes = [mh.gen_box("obj-stim", stim, 40, 100, numinlets=1, numoutlets=2)]
    lines = []
    for c in range(chains):
        t = f"c{c}"
        names = {k: f"#0-{t}{k}" for k in ("cfg", "mseg", "steps", "scope", "curve", "route", "ibuf", "icurve")}
        sizes = {"cfg": mc.CFG_FLOATS, "mseg": mc.MSEG_FLOATS, "steps": mc.STEPS_FLOATS, "scope": mc.SCOPE_SAMPS, "curve": mc.CURVE_SAMPS,
                 "route": mc.ROUTE_SAMPS, "ibuf": mc.INT_SAMPS, "icurve": mc.ICURVE_SAMPS}
        for k, n in names.items():
            boxes.append(mh.box(f"obj-b-{t}{k}", f"buffer~ {n} @samps {sizes[k]}", 800, 40, 220, numoutlets=2, outlettype=["float", "bang"]))
        eng = f"obj-e-{t}"
        boxes.append(mh.gen_box(eng, engine, 200, 220, numinlets=2, numoutlets=mc.ENGINE_OUTS))
        boxes.append(mh.msg(f"obj-bind-{t}", f"cfg {names['cfg']}, mseg {names['mseg']}, steps {names['steps']}, scope {names['scope']}, "
                                             f"ibuf {names['ibuf']}, icurve {names['icurve']}, route {names['route']}", 40, 560, 560))
        boxes.append(mh.msg(f"obj-cb-{t}", f"chainbufs {names['cfg']} {names['mseg']} {names['steps']} {names['scope']} {names['curve']} "
                                           f"{names['route']} {names['ibuf']} {names['icurve']}", 40, 590, 560))
        lines += [mh.line("obj-load", 0, f"obj-bind-{t}", 0), mh.line(f"obj-bind-{t}", 0, eng, 0),
                  mh.line("obj-load", 0, f"obj-cb-{t}", 0), mh.line(f"obj-cb-{t}", 0, "obj-js", 0),
                  mh.line("obj-stim", 0, eng, 0), mh.line("obj-stim", 1, eng, 1)]
        boxes.append(mh.msg(f"obj-rb-{t}", f"route {names['route']}, curve {names['curve']}", 40, 620, 300))
        lines.append(mh.line("obj-load", 0, f"obj-rb-{t}", 0))
        for r in range(mc.ROUTERS if nrouters is None else nrouters):
            rid = f"obj-r-{t}-{r}"
            boxes.append(mh.gen_box(rid, common.router_gen_code(r), 400, 380, numinlets=mc.ENGINE_OUTS, numoutlets=32))
            if r > 0 or True:
                # one router text for all routers in the new build: each learns its first pool slot from `rbase` (the old text has no such Param: the message is ignored)
                boxes.append(mh.msg(f"obj-rbase-{t}-{r}", f"rbase {r * mc.ROUTER_SLOTS}", 40, 650, 100))
                lines += [mh.line("obj-load", 0, f"obj-rbase-{t}-{r}", 0), mh.line(f"obj-rbase-{t}-{r}", 0, rid, 0)]
            lines.append(mh.line(f"obj-rb-{t}", 0, rid, 0))
            for i in range(mc.ENGINE_OUTS):
                lines.append(mh.line(eng, i, rid, i))
        if c == 0:
            for ch, spec in enumerate(record_outs):
                if spec[0] == "e":
                    lines.append(mh.line(eng, spec[1], "obj-record", ch))
                else:
                    lines.append(mh.line(f"obj-r-{t}-{spec[1]}", spec[2], "obj-record", ch))
    if not record_outs:
        lines.append(mh.line("obj-e-c0", 0, "obj-record", 0))
    return boxes, lines


def make_probe(case):
    fd, path = tempfile.mkstemp(prefix="megamod_cpu_probe_", suffix=".js")
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write("var CASE = " + json.dumps(case) + ";\n")
        out.write(open(CONFIG_JS, encoding="utf-8").read() + "\n")
        out.write(open(PROBE_JS, encoding="utf-8").read())
    return path


def render(name, boxes, lines, dur, case, channels=1, keep=False):
    probe = make_probe(case)
    try:
        for attempt in range(3):
            try:
                return mh.run_case(name, boxes, lines, probe_js=probe, settle_ms=50, dur_ms=dur, channels=channels, probe_object="v8", keep_dir=keep)
            except RuntimeError as ex:
                if "no result" not in str(ex) or attempt == 2:
                    raise
    finally:
        os.remove(probe)


def compile_case(name, code, nin, nout):
    boxes = [mh.gen_box("obj-g", code, 40, 80, numinlets=nin, numoutlets=nout)]
    lines = [mh.line("obj-g", 0, "obj-record", 0)]
    return render(name, boxes, lines, 100, {})["harness_wall_s"]


def do_compile(builds, runs=3):
    base = min(compile_case("mmc_base", "out1 = in1; out2 = in2;", 2, 2) for _ in range(runs))
    print(f"baseline trivial gen: {base:.2f} s")
    for label, (engine, common) in builds.items():
        for what, code, nin, nout in (("engine", engine, 2, mc.ENGINE_OUTS), ("router", common.router_gen_code(0), mc.ENGINE_OUTS, 32)):
            w = [compile_case(f"mmc_{what}", code, nin, nout) for _ in range(runs)]
            print(f"COMPILE {label} {what}: wall {' '.join(f'{x:.2f}' for x in w)} -> compile ~{min(w) - base:.2f} s ({len(code.splitlines())} lines)")


def _cputime(text):
    """ps `cputime` ([dd-][hh:]mm:ss.ss) -> seconds."""
    text = text.strip()
    if not text:
        return 0.0
    days = 0
    if "-" in text:
        d, text = text.split("-", 1)
        days = int(d)
    parts = [float(x) for x in text.split(":")]
    sec = 0.0
    for x in parts:
        sec = sec * 60 + x
    return sec + days * 86400


def render_cpu(name, boxes, lines, dur, case):
    """One render; returns (wall seconds, CPU seconds of the Max process). The CPU time (user + system, from `ps`, polled while the process runs) is what
    the slope uses: the VM is shared with other agents' work, which inflates wall time but not the process's own CPU time."""
    box = {"cpu": 0.0}
    stop = threading.Event()

    def poll():
        while not stop.is_set():
            try:
                pids = subprocess.run(["pgrep", "-f", f"m4l_{name}_"], capture_output=True, text=True).stdout.split()
                for pid in pids:
                    out = subprocess.run(["ps", "-o", "cputime=", "-p", pid], capture_output=True, text=True).stdout
                    box["cpu"] = max(box["cpu"], _cputime(out))
            except Exception:
                pass
            stop.wait(0.05)

    th = threading.Thread(target=poll, daemon=True)
    th.start()
    try:
        r = render(name, boxes, lines, dur, case)
    finally:
        stop.set()
        th.join(2)
    return r["harness_wall_s"], box["cpu"]


def one_slope(patch_bl, case, tag):
    """(CPU seconds of the 1 s render, of the 21 s render, wall of each): one repetition."""
    b, l = patch_bl
    ws, cs = render_cpu(f"mmcpu_{tag}_s", b, l, SHORT_MS, case)
    wl, cl = render_cpu(f"mmcpu_{tag}_l", b, l, LONG_MS, case)
    return cs, cl, ws, wl


def do_cpu(builds, chains, reps):
    """Per state, per build: `reps` NonRealTime renders of `chains` complete chains for a short and a long window (old / new alternate); cost per device =
    (min wall of the long render - min wall of the short one) / (window difference) / chains, as a share of one core (a real-time factor of the whole patch: the stimulus
    and recorder, about 0.3 %, are included). The VM is shared with other agents' runs: minima of the repetitions are the least disturbed, and the figures carry a few
    tenths of a percent of noise. (CPU time of the Max process polled through `ps` was tried first: unusable, it returned negative differences.)"""
    states = os.environ.get("MM_STATES", "empty,s4,s16").split(",")
    nr = int(os.environ.get("MM_ROUTERS", str(mc.ROUTERS)))  # 0 = engine only (the difference to 8 is the routers' share)
    d = (LONG_MS - SHORT_MS) / 1000.0
    for sname in states:
        case = state(sname)
        pt = {label: patch(engine, common, case, chains, nrouters=nr) for label, (engine, common) in builds.items()}
        walls = {label: {"s": [], "l": []} for label in builds}
        for rep in range(reps):
            for label in builds:
                b, l = pt[label]
                walls[label]["s"].append(render(f"mmcpu_{label}_{sname}_s", b, l, SHORT_MS, case)["harness_wall_s"])
                walls[label]["l"].append(render(f"mmcpu_{label}_{sname}_l", b, l, LONG_MS, case)["harness_wall_s"])
        for label in builds:
            w = walls[label]
            per = (min(w["l"]) - min(w["s"])) / d / chains
            singles = sorted((l - s) / d / chains for s, l in zip(w["s"], w["l"]))
            print(f"CPU {sname:5s} {label:4s} routers={nr}: per device {per * 100:.2f} % of one core (wall, minima of {reps}); single repetitions "
                  f"{' '.join(f'{x * 100:.2f}' for x in singles)}")
            sys.stdout.flush()


def read_data(r):
    path = os.path.join(r["harness_dir"], os.path.basename(r.get("result_path", ""))) if r.get("harness_dir") else None
    return r


def do_compare(old):
    case = compare_state()
    # engine outlets of several types (LFO, Follower, Random, ADSR-triggered slots, XY / Buttons B outputs) and router outlets that carry a mapping in every router
    # (slots 0, 3 (depth modulated by a self-mod route), 17, 35, 40 (removed: off), 70, 130, 200, 255)
    outs = [("e", 0), ("e", 2), ("e", 5), ("e", 11), ("e", 13), ("e", 15), ("e", 17), ("e", 29), ("r", 0, 0), ("r", 0, 3), ("r", 0, 17), ("r", 1, 3), ("r", 1, 8),
            ("r", 2, 6), ("r", 4, 2), ("r", 6, 8), ("r", 7, 31)]
    got = {}
    for label, (engine, common) in (("old", old), ("new", new_build())):
        b, l = patch(engine, common, case, 1, record_outs=outs, stim=STIM_DET)
        r = render(f"mmcmp_{label}", b, l, 3000, case, channels=len(outs), keep=True)
        dd = r["harness_dir"]
        data = None
        for fn in os.listdir(dd):
            if fn.endswith(".data"):
                data = []
                for ln in open(os.path.join(dd, fn)).read().split("\n"):
                    if ln.startswith("#channel"):
                        data.append([])
                    elif ln.strip():
                        data[-1].append(float(ln))
        got[label] = data
    worst = 0.0
    for ch, spec in enumerate(outs):
        o, n = got["old"][ch], got["new"][ch]
        d = max(abs(a - b) for a, b in zip(o, n))
        peak = max(abs(a) for a in o)
        worst = max(worst, d)
        print(f"COMPARE {spec}: max |old - new| = {d:.3g} (old peak {peak:.3f}, {len(o)} samples)")
    print(f"COMPARE worst difference {worst:.3g} ({'OK' if worst <= 1e-6 else 'DIFFERS'})")
    return 0 if worst <= 1e-6 else 1


def _terminate(signum, frame):
    """A kill (Ctrl-C / pkill) in the middle of a render must not leave its harness Max (and window) behind: the harness only cleans up in its `finally`."""
    try:
        mh._kill_stale_harness_max()
    finally:
        sys.exit(130)


def main():
    signal.signal(signal.SIGTERM, _terminate)
    signal.signal(signal.SIGINT, _terminate)
    args = sys.argv[1:]
    mode = args[0] if args else "all"
    kv = dict(a.split("=", 1) for a in args[1:] if "=" in a)
    builds = {}
    if "old" in kv:
        builds["old"] = load_old(kv["old"])
    if kv.get("onlyold") != "1":
        builds["new"] = new_build()
    if mode in ("compile", "all"):
        do_compile(builds)
    if mode in ("cpu", "all"):
        do_cpu(builds, int(kv.get("chains", "6")), int(kv.get("reps", "3")))
    if mode == "compare":
        sys.exit(do_compare(load_old(kv["old"])))


if __name__ == "__main__":
    main()
