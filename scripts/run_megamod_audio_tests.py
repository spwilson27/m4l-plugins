#!/usr/bin/env python3
"""Render the Mega Modulator engine (src/megamod_engine.genexpr) in real Max and verify every modulator.

Run:  python3 scripts/run_megamod_audio_tests.py [case ...]
Every run goes through scripts/max_harness.py (NonRealTime driver, machine-wide instance cap).

Each run: engine gen.codebox~ (16 signal outlets) + audio-rate source gen (device audio input) ->
`record~` (two chosen engine outlets). The harness records from DSP start, trims `settle`, and hands the
probe exactly `dur` ms. tests/megamod_probe.js pokes the cfg / mseg / steps buffers (at loadbang, before
DSP) from src/megamod_config.js, analyses the recording against the JS reference and writes the report.
Transport / retrigger changes are harness `events` (stepped mode, within one vector of their sample time).
"""

import concurrent.futures
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import megamod_common as mc

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "megamod_engine.genexpr")
CONFIG_JS = os.path.join(ROOT, "src", "megamod_config.js")
PROBE_JS = os.path.join(ROOT, "tests", "megamod_probe.js")

MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG = 1, 2, 3, 4, 5
SETTLE_MS = 300

# Audio-rate sine burst source (device audio input of the engine); counts samples from DSP start.
SOURCE_GEN = """
Param go(0);
Param amp(0.5);
Param freq(1000);
Param t0ms(200);
Param lenms(200);

History cnt(0);
History ph(0);

cnt = (go > 0.5) ? cnt + 1 : 0;
tms = cnt * 1000 / samplerate;
ph = wrap(ph + freq / samplerate, 0, 1);
gate = (tms >= t0ms && tms < t0ms + lenms) ? 1 : 0;
out1 = (go > 0.5) ? sin(twopi * ph) * amp * gate : 0;
"""

BIND = "cfg ---megamodcfg, mseg ---megamodmseg, steps ---megamodsteps, scope ---megamodscope"
ROUTER_BIND = "route ---megamodroute, curve ---mmcurve"
SETBUF = ("setbuffers ---megamodcfg ---megamodmseg ---megamodsteps ---megamodscope ---mmcurve ---megamodroute, configure")
ROUTER = 3  # router under test (slots 96..127): outlet j = slot 96 + j


def device(gen_code, run):
    """Device boxes / lines for mh.run_case. Everything is configured from obj-load (before DSP)."""
    boxes = [
        mh.msg("dev-bind", BIND, 40, 560, 560),
        mh.msg("dev-params", run["params"], 40, 590, 400),
        mh.msg("dev-setbuf", SETBUF, 40, 620, 560),
        mh.msg("dev-srcparams", run.get("source", "amp 0") + ", go 1", 700, 560, 380),
        mh.box("dev-b-cfg", "buffer~ ---megamodcfg @samps 384", 800, 40, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-mseg", "buffer~ ---megamodmseg @samps 16384", 800, 70, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-steps", "buffer~ ---megamodsteps @samps 512", 800, 100, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-scope", "buffer~ ---megamodscope @samps 128", 800, 130, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-curve", f"buffer~ ---mmcurve @samps {mc.CURVE_SAMPS}", 800, 160, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-route", f"buffer~ ---megamodroute @samps {mc.ROUTE_SAMPS}", 800, 190, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_code, 200, 220, numinlets=2, numoutlets=16),
        mh.gen_box("dev-src", SOURCE_GEN, 700, 280, numinlets=1, numoutlets=1),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("obj-load", 0, "dev-srcparams", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-srcparams", 0, "dev-src", 0),
        mh.line("dev-src", 0, "dev-gen", 0),
        mh.line("dev-src", 0, "dev-gen", 1),
        mh.line("dev-src", 0, "obj-mute-r", 0),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
    ]
    if any(str(o).startswith("rt") for o in run["outs"]):
        # the real generated router (scripts/megamod_common.py router_gen_code), fed by the 16 engine outlets
        boxes.append(mh.msg("dev-rbind", ROUTER_BIND, 40, 650, 400))
        boxes.append(mh.gen_box("dev-router", mc.router_gen_code(ROUTER), 400, 380, numinlets=16, numoutlets=32))
        lines.append(mh.line("obj-load", 0, "dev-rbind", 0))
        lines.append(mh.line("dev-rbind", 0, "dev-router", 0))
        for i in range(16):
            lines.append(mh.line("dev-gen", i, "dev-router", i))
    for inlet, spec in enumerate(run["outs"]):
        if spec == "src":
            lines.append(mh.line("dev-src", 0, "obj-record", inlet))
        elif str(spec).startswith("rt"):
            lines.append(mh.line("dev-router", int(spec[2:]), "obj-record", inlet))
        else:
            lines.append(mh.line("dev-gen", int(spec) - 1, "obj-record", inlet))
    return boxes, lines


def make_probe(run, tag):
    """Temp probe file: CASE data + src/megamod_config.js + tests/megamod_probe.js (unique per run)."""
    case_obj = {k: run[k] for k in ("mods", "an", "bpm", "jumpTo", "router", "chk", "tele") if k in run}
    fd, path = tempfile.mkstemp(prefix=f"megamod_probe_{tag}_", suffix=".js")
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        out.write("var CASE = " + json.dumps(case_obj) + ";\n")
        out.write(open(CONFIG_JS, encoding="utf-8").read() + "\n")
        out.write(open(PROBE_JS, encoding="utf-8").read())
    return path


def run_once(gen_code, run, tag):
    boxes, lines = device(gen_code, run)
    probe = make_probe(run, tag)
    # events: (ms after the measured window starts, message to the engine); negative = before the window
    events = [(SETTLE_MS + t, "dev-gen", 0, text) for t, text in run.get("events", [])]
    try:
        r = mh.run_case(f"megamod_{tag}", boxes, lines, probe_js=probe, settle_ms=SETTLE_MS, dur_ms=run["dur"],
                        channels=2, mode="stepped" if events else "nrt", events=events, probe_object="v8")
    finally:
        os.remove(probe)
    return parse_result(r)


# ---------------------------------------------------------------------------------- run definitions
def lfo(slot, shape=0, rate=2.0, bipolar=1, depth=1.0, **kw):
    p = {"sync": 0, "rate": rate, "shape": shape, "bipolar": bipolar, "depth": depth}
    p.update(kw)
    return {"slot": slot, "type": MOD_LFO, "p": p}


def steps_pad(vals):
    return list(vals) + [0.0] * (32 - len(vals))


def R(name, mods, outs, dur=1500, params="hbpm 120, hppq 0, hplay 0", an="gen", **kw):
    run = {"name": name, "mods": mods, "outs": outs, "dur": dur, "params": params, "an": an}
    run.update(kw)
    return run


MSEG_POINTS = [
    {"x": 0, "y": 0, "curve": 0, "sCurve": 0},
    {"x": 0.3, "y": 1, "curve": 0.5, "sCurve": 0},
    {"x": 0.6, "y": 0.2, "curve": -0.4, "sCurve": 1},
    {"x": 1, "y": 0.8, "curve": 0, "sCurve": 0},
]

MAPPING = {"mode": "mod", "amount": 0.8, "bipolar": 1, "curve": 3, "curveAmt": 0.6, "curveSteps": 4,
           "invert": 0, "min": 0, "max": 1}
MAPPING_B = {"mode": "remote", "amount": 1.0, "bipolar": 0, "curve": 1, "curveAmt": 0.5, "curveSteps": 4,
             "invert": 1, "min": 0.1, "max": 0.9}
ROUTER_CASE = {"base": ROUTER * mc.ROUTER_SLOTS, "slots": [
    {"slot": ROUTER * mc.ROUTER_SLOTS + 0, "src": 0, "map": MAPPING},
    {"slot": ROUTER * mc.ROUTER_SLOTS + 1, "src": 1, "map": MAPPING_B},
]}


def cases():
    return {
        "lfo_sine_2hz": [R("lfo_sine_2hz", [lfo(0, 0, 2.0)], (1, 2), dur=2000)],
        "lfo_unipolar": [
            R("A", [lfo(0, 0, 4.0, 0, 1.0), lfo(1, 0, 4.0, 0, 0.5)], (1, 2), dur=1200),
            R("B", [lfo(0, 0, 4.0, 1, 0.5)], (1, 2), dur=1200),
        ],
        "lfo_shapes": [
            R("A", [lfo(0, 2, 4.0), lfo(1, 3, 4.0)], (1, 2), dur=1200),
            R("B", [lfo(0, 4, 4.0), lfo(1, 1, 4.0)], (1, 2), dur=1200),
        ],
        "random": [R("random", [
            {"slot": 0, "type": MOD_RANDOM, "p": {"sync": 0, "rate": 10.0, "smooth": 0, "seed": 7, "bipolar": 1, "depth": 1}},
            {"slot": 1, "type": MOD_RANDOM, "p": {"sync": 0, "rate": 10.0, "smooth": 1, "seed": 7, "bipolar": 1, "depth": 1}},
        ], (1, 2), dur=1500, an="random")],
        "steps": [R("steps", [
            {"slot": 1, "type": MOD_STEPS, "stepVals": steps_pad([0.0, 1.0, 0.25, 0.75]),
             "p": {"sync": 0, "rate": 8.0, "steps": 4, "glide": 0, "bipolar": 0, "depth": 1}},
        ], (2, 1), dur=1500, an="steps")],
        "mseg": [R("mseg", [
            {"slot": 3, "type": MOD_MSEG, "points": MSEG_POINTS,
             "p": {"sync": 0, "rate": 1.0, "bipolar": 0, "depth": 1}},
        ], (4, 1), dur=2300, an="mseg")],
        "env_follow": [R("env_follow", [
            {"slot": 0, "type": MOD_ENV, "p": {"attack": 5, "release": 120, "gain": 0, "bipolar": 0, "depth": 1}},
        ], (1, "src"), dur=800, an="env", source="amp 0.5, freq 1000, t0ms 500, lenms 200")],
        "sync": [
            R("tempo", [lfo(0, 0, 1.0, 1, 1.0, sync=1, syncDiv=9)], (1, 2), dur=3800, an="sync",
              params="hbpm 120, hppq 0, hplay 0", events=[(1200, "hbpm 60")]),
            R("host", [lfo(0, 0, 1.0, 1, 1.0, sync=1, syncDiv=9)], (1, 2), dur=1800, an="host",
              params="hbpm 120, hppq 0, hplay 0", events=[(-3, "hplay 1"), (1000, "hppq 0.25")],
              bpm=120, jumpTo=0.25),
        ],
        "retrig": [R("retrig", [lfo(0, 2, 1.0), lfo(1, 2, 1.0, retrig=1)], (1, 2), dur=1500, an="retrig",
                     events=[(300, "rtrg 17"), (670, "rtrg 33")])],
        "telemetry": [R("telemetry", [lfo(0, 0, 3.0), lfo(1, 2, 2.0, 0, 0.6), lfo(2, 1, 1.0)], (1, 2), dur=1000,
                        params="hbpm 133, hppq 0, hplay 0", events=[(0, "hplay 1")], tele=True)],
        "multi_slot_isolation": [R("multi", [lfo(0, 0, 2.0), lfo(7, 2, 1.0), lfo(15, 4, 3.0)], (1, 16), dur=1500,
                                   tele=True)],
        # Router gen (src: scripts/megamod_common.py router_gen_code): slots 96 / 97 route from two different
        # modulators with two different tables, slot 98 is off. Router outlet j = slot 96 + j.
        "lookup_chain": [
            R("slotA", [lfo(0, 0, 3.0), lfo(1, 1, 2.0)], (1, "rt0"), dur=1000, an="lookup", chk=0, router=ROUTER_CASE),
            R("slotB", [lfo(0, 0, 3.0), lfo(1, 1, 2.0)], (2, "rt1"), dur=1000, an="lookup", chk=1, router=ROUTER_CASE),
            R("slotOff", [lfo(0, 0, 3.0), lfo(1, 1, 2.0)], ("rt2", "rt0"), dur=600, an="routeoff", router=ROUTER_CASE),
        ],
    }


# ---------------------------------------------------------------------------------- execution
LIST_KEYS = ("periods", "mids", "lens", "outs", "phases", "range", "restart_ms")


def parse_result(data):
    meta = {}
    for key, val in data.items():
        if isinstance(val, str):
            if val == "none":
                val = []
            elif "," in val or key.endswith(LIST_KEYS):
                items = []
                for tok in val.split(","):
                    try:
                        items.append(float(tok.split(":")[0]))
                    except ValueError:
                        items.append(tok)
                val = items
        elif key.endswith(LIST_KEYS):
            val = [val]
        meta[key] = val
    return meta


def near(v, target, tol):
    return abs(v - target) <= tol


def f(v):
    return f"{v:.4f}" if isinstance(v, float) else str(v)


def check(case, runs, metas, errors, notes):
    def err(msg_):
        errors.append(f"{case}: {msg_}")

    metas = [m if (m is None or "probe_error" not in m) else None for m in metas]

    for r, m in zip(runs, metas):
        if m is None:
            err(f"run {r['name']}: no measurement")
            return
        for ch in ("c1_", "c2_"):
            if m.get(ch + "nan", 1) != 0:
                err(f"run {r['name']}: {m.get(ch + 'nan')} non-finite samples on {ch}")
    ms = metas

    if case == "lfo_sine_2hz":
        m = ms[0]
        notes.append(f"period {m['c1_period']:.4f}s min {m['c1_min']:.4f} max {m['c1_max']:.4f} "
                     f"(disabled slot max|x| {max(abs(m['c2_min']), abs(m['c2_max'])):.4f})")
        if not near(m["c1_period"], 0.5, 0.01):
            err(f"period {m['c1_period']} != 0.5 +-2%")
        if m["c1_min"] > -0.98 or m["c1_max"] < 0.98:
            err("range does not reach +-0.98")
        if m["c1_min"] < -1.0001 or m["c1_max"] > 1.0001:
            err("range exceeds +-1")
        if max(abs(m["c2_min"]), abs(m["c2_max"])) > 1e-6:
            err("disabled slot must output 0")
    elif case == "lfo_unipolar":
        a, b = ms
        notes.append(f"uni d1 {a['c1_min']:.3f}..{a['c1_max']:.3f}; uni d0.5 {a['c2_min']:.3f}..{a['c2_max']:.3f}; "
                     f"bip d0.5 {b['c1_min']:.3f}..{b['c1_max']:.3f}")
        if a["c1_min"] > -0.98 or a["c1_max"] < 0.98 or a["c1_min"] < -1.0001 or a["c1_max"] > 1.0001:
            err("unipolar depth 1 should span -1..+1")
        if abs(a["c2_max"]) > 0.02 or a["c2_min"] > -0.98 or a["c2_min"] < -1.0001:
            err("unipolar depth 0.5 should span -1..0")
        if not (near(b["c1_min"], -0.5, 0.02) and near(b["c1_max"], 0.5, 0.02)):
            err("bipolar depth 0.5 should span -0.5..0.5")
    elif case == "lfo_shapes":
        a, b = ms
        notes.append(f"sawUp decr {a['c1_decr']} wraps {a['c1_wrapDown']} T {a['c1_period']:.4f} | sawDn incr {a['c2_incr']} "
                     f"wraps {a['c2_wrapUp']} T {a['c2_period']:.4f} | square levels {b['c1_nlevels']} duty "
                     f"{b['c1_duty']:.3f} {b['c1_min']:.2f}..{b['c1_max']:.2f} | tri {b['c2_min']:.4f}..{b['c2_max']:.4f} "
                     f"T {b['c2_period']:.4f} maxStep {b['c2_maxstep'] if 'c2_maxstep' in b else b['c2_maxStep']:.5f}")
        if a["c1_decr"] != 0 or a["c1_incr"] < 1000 or a["c1_wrapDown"] < 3:
            err("saw up must rise monotonically with wraps")
        if a["c2_incr"] != 0 and False:
            pass
        if a["c2_incr"] != 0 or a["c2_decr"] < 1000 or a["c2_wrapUp"] < 3:
            err("saw down must fall monotonically with wraps")
        for k in ("c1_period", "c2_period"):
            if not near(a[k], 0.25, 0.005):
                err(f"saw {k} {a[k]} != 0.25")
        for k in ("c1_min", "c2_min"):
            if a[k] > -0.995:
                err(f"saw {k} {a[k]} should reach -1")
        for k in ("c1_max", "c2_max"):
            if a[k] < 0.995:
                err(f"saw {k} {a[k]} should reach +1")
        if b["c1_nlevels"] != 2 or not (near(b["c1_min"], -1, 0.001) and near(b["c1_max"], 1, 0.001)):
            err("square must take exactly the values -1 and +1")
        if not (0.47 <= b["c1_duty"] <= 0.53):
            err(f"square duty {b['c1_duty']}")
        if not near(b["c1_period"], 0.25, 0.005):
            err("square period")
        if b["c2_min"] > -0.995 or b["c2_max"] < 0.995 or not near(b["c2_period"], 0.25, 0.005):
            err("triangle must peak at +-1 with period 0.25")
    elif case == "random":
        m = ms[0]
        notes.append(f"smooth0 runs {m['rnd0_runs']:.0f} (exp ~15) levels {m['c1_nlevels']} range "
                     f"{m['c1_min']:.3f}..{m['c1_max']:.3f} hash maxerr {m.get('rnd0_hash_maxerr', -1):.4f}; "
                     f"smooth1 maxStep {m['c2_maxStep']:.5f} levels {m['c2_nlevels']}")
        if not (14 <= m["rnd0_runs"] <= 17):
            err(f"random 10 Hz over 1.5 s should hold ~15 levels, got {m['rnd0_runs']}")
        if m["c1_min"] < -1.0001 or m["c1_max"] > 1.0001 or m["c2_min"] < -1.0001 or m["c2_max"] > 1.0001:
            err("random out of +-1")
        if m["c1_changes"] > 40:
            err("smooth 0 must be piecewise constant")
        if m["c2_maxStep"] > 2e-3 or m["c2_nlevels"] < 200:
            err("smooth 1 must be continuous")
        if m.get("rnd0_hash_maxerr", 9) > 0.01:
            err(f"levels do not match randHash01 reference (maxerr {m.get('rnd0_hash_maxerr')})")
    elif case == "steps":
        m = ms[0]
        lens = m.get("steps_lens", [])
        notes.append(f"runs {m['steps_runs']:.0f} maxerr {m['steps_maxerr']:.5f} cycle offset {m['steps_cycle_offset']:.0f} "
                     f"step len {sum(lens) / max(1, len(lens)):.4f}s mids {m['steps_mids']}")
        if m["steps_maxerr"] > 0.01:
            err(f"step centre values differ from 2v-1 by {m['steps_maxerr']}")
        if len(lens) < 8 or any(abs(x - 0.125) > 0.004 for x in lens):
            err(f"steps should last 0.125 s, got {lens}")
    elif case == "mseg":
        m = ms[0]
        notes.append(f"max abs err vs evalModulator {m['mseg_maxerr']:.5f} (n={m['mseg_samples']:.0f}, mean fit err "
                     f"{m['mseg_fit_meanerr']:.5f})")
        if m["mseg_maxerr"] > 0.01:
            err(f"mseg max error {m['mseg_maxerr']}")
    elif case == "env_follow":
        m = ms[0]
        notes.append(f"max err vs envelopeFollow {m['env_maxerr']:.5f}; peak out {m['env_peak_out']:.4f} ref "
                     f"{m['env_peak_ref']:.4f}; quiet max {m['env_quiet_max']:.4f}; tail {m['env_tail']:.4f}; "
                     f"src peak {m['env_src_peak']:.3f} burst {m['env_burst_ms']} ms")
        if m["env_maxerr"] > 0.05:
            err(f"envelope error {m['env_maxerr']}")
        if m["env_quiet_max"] > -0.99:
            err("silence must rest at -1")
        if m["env_peak_out"] < m["env_peak_ref"] - 0.05 or m["env_peak_out"] < -0.2:
            err("burst does not raise the envelope")
        if m["env_tail"] > m["env_peak_out"] - 0.2:
            err("envelope does not decay after the burst")
    elif case == "sync":
        a, b = ms
        notes.append(f"tempo: first period {a['sync_first_period']:.4f}s (120 bpm), last {a['sync_last_period']:.4f}s "
                     f"(60 bpm), n={a['sync_periods_n']:.0f}; host: start |x|max {b['host_start_abs_max']:.4f} slope>0 "
                     f"{b['host_start_slope']:.3f}, jump {b['host_jump_size']:.3f} @ {b['host_jump_ms']:.0f} ms, pre err "
                     f"{b['host_pre_maxerr']:.3f}, post err {b['host_post_maxerr']:.4f}")
        if not near(a["sync_first_period"], 0.5, 0.01):
            err(f"120 bpm 1/4 period {a['sync_first_period']} != 0.5")
        if not near(a["sync_last_period"], 1.0, 0.02):
            err(f"60 bpm 1/4 period {a['sync_last_period']} != 1.0")
        if b["host_start_abs_max"] > 0.15 or b["host_start_slope"] <= 0:
            err("sine at ppq 0 must start at the centre rising")
        if b["host_pre_maxerr"] > 0.25:
            err("playing phase does not follow host beat from ppq 0")
        if b["host_jump_size"] < 0.3 or b["host_post_maxerr"] > 0.05:
            err("hppq 0.25 while playing must jump the phase to ppq 0.25")
    elif case == "retrig":
        m = ms[0]
        notes.append(f"slot1 restarts {m['retrig_restarts_slot1']:.0f} at {m['retrig_restart_ms_slot1']} ms; slot0 restarts "
                     f"{m['retrig_restarts_slot0']:.0f}; slot0 slope dev {m['retrig_slot0_slope_dev']:.2e}; pre diff "
                     f"{m['retrig_pre_diff']:.4f}; post err {m.get('retrig_post_err_200ms', -1):.4f}")
        if m["retrig_restarts_slot0"] != 0 or m["retrig_slot0_slope_dev"] > 1e-4:
            err("slot 0 must be unaffected by rtrg 17/33")
        if m["retrig_restarts_slot1"] < 1:
            err("rtrg must restart slot 1")
        if m["retrig_pre_diff"] > 0.01:
            err("slots must agree before the retrigger")
        if m.get("retrig_post_err_200ms", 9) > 0.03:
            err("slot 1 must restart at 0 (-1) and rise linearly")
    elif case == "telemetry":
        m = ms[0]
        outs = m["tele_outs"]
        notes.append(f"frame {m['tele_frame']:.0f} sr {m['tele_sr']:.0f} (dsp {m['tele_dsp_sr']:.0f}) bpm {m['tele_bpm']:.0f} "
                     f"playing {m['tele_playing']:.0f} beat {m['tele_beat']:.2f} outs {outs[:4]} bad {m['tele_bad']:.0f}")
        if m["tele_frame"] <= 0:
            err("frame counter did not advance")
        if abs(m["tele_sr"] - m["tele_dsp_sr"]) > 0.01 * m["tele_dsp_sr"]:
            err("scope[65] != sample rate")
        if m["tele_bad"] != 0:
            err("slot telemetry outside [-1,1]")
        if any(abs(v) > 1e-9 for v in outs[3:]):
            err("unused slots must report 0")
        if m["tele_bpm"] != 133 or m["tele_playing"] != 1:
            err("bpm / playing header wrong")
    elif case == "multi_slot_isolation":
        m = ms[0]
        outs, phs = m["tele_outs"], m["tele_phases"]
        notes.append(f"slot0 sine period {m['c1_period']:.4f}s ({m['c1_min']:.3f}..{m['c1_max']:.3f}); slot15 square "
                     f"period {m['c2_period']:.4f}s levels {m['c2_nlevels']} duty {m['c2_duty']:.3f}; telemetry slot7 "
                     f"out {outs[7]} phase {phs[7]}; others zero: "
                     f"{all(abs(outs[i]) < 1e-9 for i in range(16) if i not in (0, 7, 15))}")
        if not near(m["c1_period"], 0.5, 0.01) or m["c1_min"] > -0.98 or m["c1_max"] < 0.98:
            err("slot 0 sine wrong")
        if not near(m["c2_period"], 1.0 / 3, 0.007) or m["c2_nlevels"] != 2:
            err("slot 15 square wrong")
        if abs(outs[7]) + abs(phs[7]) < 1e-6:
            err("slot 7 telemetry is dead")
        if any(abs(outs[i]) > 1e-9 for i in range(16) if i not in (0, 7, 15)):
            err("disabled slots must stay at 0")
    elif case == "lookup_chain":
        for tag, m in zip(("slot A (src mod 0, mod-mode S curve)", "slot B (src mod 1, remote exp inverted)"), ms[:2]):
            notes.append(f"{tag}: max err vs mappingOutput {m['lookup_err']:.5f}; decoy-region err {m['lookup_err_decoy']:.3f}; "
                         f"in {m['lookup_in_range']} out {m['lookup_out_range']}; samples {m['lookup_samples']}")
            # idx = clip((x + 1) * 128, 0, 256), linear interp, clamped to the last sample, from region slot*256
            if m["lookup_err"] > 0.02:  # 256-sample table quantization on steep exp curves
                err(f"{tag}: router output differs from mappingOutput by {m['lookup_err']} (> 0.02)")
            if m["lookup_err_decoy"] < 0.3:
                err(f"{tag}: output looks like the decoy region (wrong table offset)")
        off = ms[2]
        notes.append(f"off slot max|y| {off['off_max']:.2e}; routed neighbour max|y| {off['neighbour_max']:.3f}")
        if off["off_max"] > 1e-9:
            err(f"off slot must output 0 (got {off['off_max']})")
        if off["neighbour_max"] < 0.05:
            err("routed neighbour slot is silent")


def main():
    with open(GEN_PATH, encoding="utf-8") as fh:
        gen_code = fh.read()
    all_cases = cases()
    only = set(sys.argv[1:])
    jobs = []
    for name, runs in all_cases.items():
        if only and name not in only:
            continue
        for run in runs:
            jobs.append((name, run))

    def work(job):
        name, run = job
        try:
            return run_once(gen_code, run, f"{name}_{run['name']}")
        except Exception as exc:  # noqa: BLE001 - report per case
            print(f"  [{name}/{run['name']}] ERROR {exc}", flush=True)
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(work, jobs))

    errors = []
    for name, runs in all_cases.items():
        if only and name not in only:
            continue
        metas = [results[i] for i, (n, _r) in enumerate(jobs) if n == name]
        notes = []
        before = len(errors)
        try:
            check(name, runs, metas, errors, notes)
        except (KeyError, IndexError, TypeError) as exc:
            errors.append(f"{name}: missing measurement {exc!r}")
        status = "PASS" if len(errors) == before else "FAIL"
        print(f"{status} {name}")
        for n in notes:
            print("   ", n)
        for e in errors[before:]:
            print("    !", e)
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("megamod audio checks passed")


if __name__ == "__main__":
    main()
