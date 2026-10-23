#!/usr/bin/env python3
"""Render the Mega Modulator engine (src/megamod_engine.genexpr) in real Max and verify every modulator.

Run:  python3 scripts/run_megamod_audio_tests.py [case ...]
Every run goes through scripts/max_harness.py (NonRealTime driver, machine-wide instance cap).

Each run: engine gen.codebox~ (32 signal outlets = 16 slots x outputs A / B) + audio-rate source gen (device audio input) ->
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
GEN_PATH = os.environ.get("MEGAMOD_GEN") or os.path.join(ROOT, "src", "megamod_engine.genexpr")  # (MEGAMOD_GEN: test another engine file)
CONFIG_JS = os.path.join(ROOT, "src", "megamod_config.js")
PROBE_JS = os.path.join(ROOT, "tests", "megamod_probe.js")

MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG, MOD_ADSR, MOD_XY, MOD_BTN = 1, 2, 3, 4, 5, 6, 7, 8
SETTLE_MS = 300

# Audio-rate sine burst source (device audio input of the engine); counts samples from DSP start.
SOURCE_GEN = """
Param go(0);
Param amp(0.5);
Param freq(1000);
Param t0ms(200);
Param lenms(200);
Param periodms(0);

History cnt(0);
History ph(0);

cnt = (go > 0.5) ? cnt + 1 : 0;
tms = cnt * 1000 / samplerate;
ph = wrap(ph + freq / samplerate, 0, 1);
rel = tms - t0ms;
gate = (tms >= t0ms && tms < t0ms + lenms) ? 1 : 0;
gate = (periodms > 0) ? ((rel >= 0 && rel - periodms * floor(rel / periodms) < lenms) ? 1 : 0) : gate;
out1 = (go > 0.5) ? sin(twopi * ph) * amp * gate : 0;
"""

BIND = ("cfg ---megamodcfg, mseg ---megamodmseg, steps ---megamodsteps, scope ---megamodscope, "
        "ibuf ---megamodint, icurve ---megamodicurve, route ---megamodroute")
ROUTER_BIND = "route ---megamodroute, curve ---mmcurve"
SETBUF = ("setbuffers ---megamodcfg ---megamodmseg ---megamodsteps ---megamodscope ---mmcurve ---megamodroute "
          "---megamodint ---megamodicurve, configure")
AUTO_RATE_NORM_4HZ = __import__("math").log(4.0 / 0.01) / __import__("math").log(40.0 / 0.01)  # autoNorm("rate", 4) (log curve 0.01..40 Hz)
ROUTER = 3  # router under test (slots 96..127): outlet j = slot 96 + j


def device(gen_code, run):
    """Device boxes / lines for mh.run_case. Everything is configured from obj-load (before DSP)."""
    boxes = [
        mh.msg("dev-bind", BIND, 40, 560, 560),
        mh.msg("dev-params", run["params"], 40, 590, 400),
        mh.msg("dev-setbuf", SETBUF, 40, 620, 560),
        mh.msg("dev-srcparams", run.get("source", "amp 0") + ", go 1", 700, 560, 380),
        mh.box("dev-b-cfg", f"buffer~ ---megamodcfg @samps {mc.CFG_FLOATS}", 800, 40, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-mseg", "buffer~ ---megamodmseg @samps 16384", 800, 70, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-steps", "buffer~ ---megamodsteps @samps 512", 800, 100, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-scope", f"buffer~ ---megamodscope @samps {mc.SCOPE_SAMPS}", 800, 130, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-int", f"buffer~ ---megamodint @samps {mc.INT_SAMPS}", 800, 250, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-icurve", f"buffer~ ---megamodicurve @samps {mc.ICURVE_SAMPS}", 800, 280, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-curve", f"buffer~ ---mmcurve @samps {mc.CURVE_SAMPS}", 800, 160, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-route", f"buffer~ ---megamodroute @samps {mc.ROUTE_SAMPS}", 800, 190, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_code, 200, 220, numinlets=2, numoutlets=mc.ENGINE_OUTS),
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
        # (one router text for all 8 routers: Param rbase = 32 * router index, what the face sends after loading the router)
        # (late_rbase: the router starts with rbase 0 and learns its slots from an event mid-run, like a router that was still compiling when the face's first send arrived)
        boxes.append(mh.msg("dev-rbind", ROUTER_BIND + ("" if run.get("late_rbase") else ", rbase %d" % (run.get("router_idx", ROUTER) * mc.ROUTER_SLOTS)), 40, 650, 400))
        rcode = open(os.environ["MEGAMOD_ROUTER"], encoding="utf-8").read() if os.environ.get("MEGAMOD_ROUTER") else mc.router_gen_code()  # (MEGAMOD_ROUTER: test another router text)
        boxes.append(mh.gen_box("dev-router", rcode, 400, 380, numinlets=mc.ENGINE_OUTS, numoutlets=32))
        lines.append(mh.line("obj-load", 0, "dev-rbind", 0))
        lines.append(mh.line("dev-rbind", 0, "dev-router", 0))
        if run.get("rparams"):
            # router Params (Options panel smoothing: `smooth <ms>`), sent before DSP like the other params
            boxes.append(mh.msg("dev-rparams", run["rparams"], 40, 680, 300))
            lines.append(mh.line("obj-load", 0, "dev-rparams", 0))
            lines.append(mh.line("dev-rparams", 0, "dev-router", 0))
        for i in range(mc.ENGINE_OUTS):
            lines.append(mh.line("dev-gen", i, "dev-router", i))
    for inlet, spec in enumerate(run["outs"]):
        if spec == "src":
            lines.append(mh.line("dev-src", 0, "obj-record", inlet))
        elif str(spec).startswith("rt"):
            lines.append(mh.line("dev-router", int(spec[2:]), "obj-record", inlet))
        elif str(spec).startswith("b"):
            # "b<n>": output B of modulator n (1-based) = engine outlet 2 * (n - 1) + 1 (XY: Y, Buttons: button 2)
            lines.append(mh.line("dev-gen", 2 * (int(str(spec)[1:]) - 1) + 1, "obj-record", inlet))
        else:
            # <n>: output A of modulator n (1-based) = engine outlet 2 * (n - 1) (each slot has two engine outputs)
            lines.append(mh.line("dev-gen", 2 * (int(spec) - 1), "obj-record", inlet))
    return boxes, lines


def make_probe(run, tag):
    """Temp probe file: CASE data + src/megamod_config.js + tests/megamod_probe.js (unique per run)."""
    case_obj = {k: run[k] for k in ("mods", "an", "bpm", "jumpTo", "router", "chk", "tele", "smooth_ms", "dep", "remote", "dctr", "selfmod", "sp") if k in run}
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
    # an event is (t, text) for the engine, or (t, text, "obj-js") for the probe (autorate: a Live parameter moved)
    events = [(SETTLE_MS + ev[0], ev[2] if len(ev) > 2 else "dev-gen", 0, ev[1]) for ev in run.get("events", [])]
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


def mc_cf(name):
    """A CF_* field index of src/megamod_config.js (the python side has no copy)."""
    import re
    m = re.search(r"const %s = (\d+);" % name, open(CONFIG_JS, encoding="utf-8").read())
    return int(m.group(1))


def adsr(slot, attack=50, decay=100, sustain=0.5, release=200, thresh=-24, **kw):
    """An ADSR in Threshold mode (Trig = sync 1), unipolar, depth 1, Vel off; `kw` overrides any parameter (retrig, depth, ...)."""
    p = {"attack": attack, "decay": decay, "sustain": sustain, "release": release, "thresh": thresh, "sync": 1, "bipolar": 0, "depth": 1.0,
         "retrig": 0, "oneshot": 0}
    p.update(kw)
    return {"slot": slot, "type": MOD_ADSR, "p": p}


def xy(slot, x, y, depth=1.0, slew=0.0):
    return {"slot": slot, "type": MOD_XY, "p": {"x": x, "y": y, "depth": depth, "slew": slew}}


def buttons(slot, b1, b2, depth=1.0, slew=0.0):
    """Buttons: button 1 = the sync field, button 2 = the bipolar field."""
    return {"slot": slot, "type": MOD_BTN, "p": {"sync": b1, "bipolar": b2, "depth": depth, "slew": slew}}


def two_out_router(src, base=ROUTER * mc.ROUTER_SLOTS):
    """Router slots base (output A) and base + 1 (output B) of modulator `src`, identity mapping (Mod +-, range 1, linear: the router output equals the engine output)."""
    return {"base": base, "slots": [{"slot": base, "src": src, "out": 0, "map": MAPPING_ID}, {"slot": base + 1, "src": src, "out": 1, "map": MAPPING_ID}]}


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

MAPPING = {"mode": "mod", "polarity": 0, "range": 0.8, "curve": 3, "curveAmt": 0.6, "curveSteps": 4}
MAPPING_B = {"mode": "remote", "min": 0.85, "max": 0.15, "polarity": -1, "range": 0.9, "curve": 1, "curveAmt": 0.5, "curveSteps": 4}
ROUTER_CASE = {"base": ROUTER * mc.ROUTER_SLOTS, "slots": [
    {"slot": ROUTER * mc.ROUTER_SLOTS + 0, "src": 0, "map": MAPPING},
    {"slot": ROUTER * mc.ROUTER_SLOTS + 1, "src": 1, "map": MAPPING_B},
]}


# identity mapping (Mod, +-, range 1, linear) so the router output equals the engine output apart from smoothing
MAPPING_ID = {"mode": "mod", "polarity": 0, "range": 1.0, "curve": 0, "curveAmt": 0.5, "curveSteps": 4}
ROUTER_ID = {"base": ROUTER * mc.ROUTER_SLOTS, "slots": [{"slot": ROUTER * mc.ROUTER_SLOTS + 0, "src": 0, "map": MAPPING_ID}]}


def depth_router(dep, mode, mn=0.2, mx=0.8):
    """Router slots 96 (depth 1) and 97 (depth `dep`) from modulator 0 with the same Mod (+-, range 0.8) or Remote (min..max) mapping."""
    base = ROUTER * mc.ROUTER_SLOTS
    m = ({"mode": "remote", "min": mn, "max": mx, "polarity": 0, "range": 1.0} if mode == "remote"
         else {"mode": "mod", "polarity": 0, "range": 0.8})
    return {"base": base, "slots": [
        {"slot": base, "src": 0, "map": dict(m, depth=1.0)},
        {"slot": base + 1, "src": 0, "map": dict(m, depth=dep)},
    ]}


OCT_NORM = __import__("math").log(2.0) / __import__("math").log(40.0 / 0.01)  # one octave of the Rate knob (log 0.01..40 Hz) in normalized knob space
MAP_PM = {"mode": "mod", "polarity": 0, "range": 1.0}  # +-: output = range * x (x = the source output -1..1)


def selfmap(**kw):
    m = dict(MAP_PM)
    m.update(kw)
    return m


# self-mod (internal matrix): dest codes (src/megamod_config.js selfDestFor): slot * 6 + j (generic control j), 96 + slot * 6 + t (switch t:
# shape, sync, bipolar, retrig, oneshot, loopOn), 192 + k (Depth of pool slot k)
DEST_RATE_1 = 1 * 6 + 0      # LFO in slot 1: generic control A = Rate
DEST_RATE_0 = 0 * 6 + 0
DEST_BIPOLAR_1 = 96 + 1 * 6 + 2
DEST_DEPTH_0 = 192 + 0
DEPTH_SLOT_HI = 96            # a pool slot >= 64 (router 3, outlet 0): depth routes work on all 256 slots (schema 10); dest = 192 + slot
ROUTER_DEPTH_HI = {"base": DEPTH_SLOT_HI, "slots": [{"slot": DEPTH_SLOT_HI, "src": 1, "map": {"mode": "mod", "polarity": 0, "range": 1.0, "depth": 0.8}}]}
ROUTER_DEPTH_SUM = {"base": DEPTH_SLOT_HI, "slots": [{"slot": DEPTH_SLOT_HI, "src": 1, "map": {"mode": "mod", "polarity": 0, "range": 1.0, "depth": 1.0}}]}
ROUTER_DEPTH = {"base": 0, "slots": [{"slot": 0, "src": 1, "map": {"mode": "mod", "polarity": 0, "range": 1.0, "depth": 1.0}}]}


def remote_router(slot, mn=0.0, mx=1.0, dep=1.0, mode="remote", src=1):
    """One router slot `slot` (source modulator `src`) with a Remote (min..max, linear) or Mod (+-, range 1) mapping at base depth `dep`."""
    m = ({"mode": "remote", "min": mn, "max": mx, "polarity": 0, "range": 1.0, "depth": dep} if mode == "remote"
         else {"mode": "mod", "polarity": 0, "range": 1.0, "depth": dep})
    return {"base": slot, "slots": [{"slot": slot, "src": src, "map": m}]}


def remote_case(name, slot, mode="remote", dep=1.0, routes=(), mn=0.0, mx=1.0, src_rate=2.0):
    """LFO 1 (slot 0, 1 Hz) and LFO 3 (slot 2, 1.7 Hz) are the depth-route sources (sines), LFO 2 (slot 1, `src_rate` Hz sine) is the mapping's source.
    A route is {src, range, pol}: a UNIPOLAR depth route whose factor is m = range * dep * y (0..range; y = B's normalized output (B + 1) / 2). `pol` is the STORED polarity
    of an old route and is ignored (default 0). Range 0 -> depth 0 -> the Remote output sits at the centre; range 1.0 is the VCA setup (B at its minimum -> depth 0, at its
    maximum -> 1); range 0.5 spans only the middle half."""
    router_idx = slot // mc.ROUTER_SLOTS
    outlet = slot - router_idx * mc.ROUTER_SLOTS
    mods = [lfo(0, 0, 1.0), lfo(1, 0, src_rate), lfo(2, 0, 1.7)]
    sm = {"routes": [{"src": rt["src"], "dest": 192 + slot, "map": selfmap(range=rt["range"], polarity=rt.get("pol", 0))} for rt in routes]}
    run = R(name, mods, ("rt%d" % outlet, 2), dur=3000, an="remoteroutes", router_idx=router_idx,
            router=remote_router(slot, mn, mx, dep, mode),
            sp={"settle_ms": SETTLE_MS, "base": dep, "mode": mode, "min": mn, "max": mx,
                "routes": [{"f": 1.0 if rt["src"] == 0 else 1.7, "range": rt["range"], "pol": rt.get("pol", 0)} for rt in routes]})
    if routes:
        run["selfmod"] = sm
    return run


def cases():
    return {
        # Remote / Mod mapping with depth routes. Remote depth scales AROUND THE CENTRE c = (min + max) / 2: out = c + (lookup - c) * eff, and the
        # route factor is the unipolar m = range * y (multiplicative, never negative). The user's three cases are cases 1..3 below. The earlier scenario: A = LFO 2 (3 Hz sine) with Remote 0..1, B = LFO 1 (1 Hz sine)
        # modulating A's depth through a full-range route: the output is 0.5 whenever B is at its minimum and swings fully only when B is at its peak.
        # Slots below and above 64 (routers 0 / 2 / 3).
        "remote_depth": [
            remote_case("user_B_full_lo", 5, "remote", 1.0, [{"src": 0, "range": 1.0}], src_rate=3.0),
            remote_case("user_B_full_hi", 96, "remote", 1.0, [{"src": 0, "range": 1.0}], src_rate=3.0),
            remote_case("user_B_full_hi70", 70, "remote", 1.0, [{"src": 0, "range": 1.0}], src_rate=3.0),
            remote_case("bounds_25_100_B_full", 5, "remote", 1.0, [{"src": 0, "range": 1.0}], mn=0.25, mx=1.0, src_rate=3.0),
            remote_case("remote_route15_lo", 5, "remote", 1.0, [{"src": 0, "range": 0.15}]),
            remote_case("remote_route15_hi", 96, "remote", 1.0, [{"src": 0, "range": 0.15}]),
            remote_case("remote_old_minus_route", 5, "remote", 1.0, [{"src": 0, "range": 1.0, "pol": -1}]),  # a stored "-" polarity is ignored
            remote_case("remote_two_routes", 96, "remote", 1.0, [{"src": 0, "range": 0.7}, {"src": 2, "range": 0.7}], mn=0.2, mx=0.9),
            remote_case("remote_noroute", 5, "remote", 1.0, []),
            remote_case("remote_base0", 5, "remote", 0.0, []),
            remote_case("remote_base0_bounds25", 96, "remote", 0.0, [], mn=0.25, mx=1.0),
            remote_case("remote_base05", 5, "remote", 0.5, []),
            remote_case("remote_base05_hi", 96, "remote", 0.5, []),
            remote_case("remote_base08_route", 96, "remote", 0.8, [{"src": 0, "range": 0.15}], mn=0.2, mx=0.9),
            remote_case("mod_route_lo", 5, "mod", 1.0, [{"src": 0, "range": 0.15}]),
            remote_case("mod_route_hi", 96, "mod", 1.0, [{"src": 0, "range": 0.15}]),
            remote_case("mod_B_full", 96, "mod", 1.0, [{"src": 0, "range": 1.0}], src_rate=3.0),
            # the user's three cases (A Remote, B a 1 Hz sine through a depth route; "range" = the route's range)
            remote_case("case1_A0_100_range0", 5, "remote", 1.0, [{"src": 0, "range": 0.0}], src_rate=3.1),
            remote_case("case2_A25_100_range0", 96, "remote", 1.0, [{"src": 0, "range": 0.0}], mn=0.25, mx=1.0, src_rate=3.1),
            remote_case("case3_A0_100_range50", 96, "remote", 1.0, [{"src": 0, "range": 0.5}], src_rate=3.1),
        ],
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
        "follower": [R("follower", [
            {"slot": 0, "type": MOD_ENV, "p": {"attack": 5, "release": 120, "gain": 0, "bipolar": 0, "depth": 1}},
        ], (1, "src"), dur=800, an="env", source="amp 0.5, freq 1000, t0ms 500, lenms 200")],
        # ADSR, Trig = Threshold (the Envelope Trigger onset detector inside the engine): the output follows adsrRunThreshold() on the recorded input; the stage
        # times are measured on the first burst (FIXED-duration segments with the new curves: a mild concave attack of 50 ms, an exponential decay of 100 ms to sustain 0.5, an exponential release of 200 ms).
        "adsr_threshold": [
            R("times", [adsr(0)], (1, "src"), dur=1800, an="adsr", source="amp 0.5, freq 1000, t0ms 400, lenms 700"),
            R("bursts", [adsr(0, attack=10, decay=30, sustain=0.6, release=50)], (1, "src"), dur=2400, an="adsr",
              source="amp 0.5, freq 1000, t0ms 400, lenms 120, periodms 500"),
            R("thresh_hi", [adsr(0, attack=10, decay=30, sustain=0.6, release=50, thresh=-6)], (1, "src"), dur=1500, an="adsr",
              source="amp 0.25, freq 1000, t0ms 400, lenms 200"),  # peak 0.25 stays below -6 dB (0.5): no trigger
            R("velocity_off", [adsr(0, oneshot=1)], (1, "src"), dur=1200, an="adsr", sp={"peak": 1.0},
              source="amp 0.5, freq 1000, t0ms 400, lenms 400"),  # Vel on in Threshold mode: the velocity is 1
        ],
        # Retrig: a new trigger during the release attacks from the CURRENT level (Retrig off) or from 0 (Retrig on)
        "adsr_retrig": [
            R("retrig", [adsr(0, attack=50, decay=100, sustain=0.5, release=5000), adsr(1, attack=50, decay=100, sustain=0.5, release=5000, retrig=1)],
              (1, 2), dur=1600, an="adsrretrig", source="amp 0.5, freq 1000, t0ms 400, lenms 100, periodms 400",
              sp={"t2_ms": 400 + 400 - SETTLE_MS}),
        ],
        # XY: out A = X, out B = Y (unipolar, scaled by Depth), directly and through the 32-input router (two router slots, identity mappings)
        "xy_outputs": [
            R("direct", [xy(0, 0.2, 0.8)], (1, "b1"), dur=300),
            R("router", [xy(0, 0.2, 0.8)], ("rt0", "rt1"), dur=300, router=two_out_router(0)),
            R("router_depth", [xy(0, 0.9, 0.1, depth=0.5), xy(5, 0.3, 0.6)], ("rt0", "rt1"), dur=300, router=two_out_router(0)),
            R("router_slot5", [xy(0, 0.9, 0.1, depth=0.5), xy(5, 0.3, 0.6)], ("rt0", "rt1"), dur=300, router=two_out_router(5)),
        ],
        # Buttons: out A = button 1, out B = button 2 (0 / 1 -> -1 / +1 unipolar), independent, with an optional slew (one-pole, tau = 2000 * slew^2 ms)
        "buttons_outputs": [
            R("direct", [buttons(0, 1, 0)], (1, "b1"), dur=300),
            R("router", [buttons(0, 0, 1)], ("rt0", "rt1"), dur=300, router=two_out_router(0)),
            R("slew", [buttons(0, 0, 0, slew=0.15)], (1, "b1"), dur=1200, an="btnslew", sp={"t_ms": 400},
              events=[(400, "cfgset 0 %d 1" % mc_cf("CF_SYNC"), "obj-js")]),
        ],
        # a single-output type mirrors output A on output B (here an LFO)
        "outputs_mirror": [R("mirror", [lfo(0, 0, 3.0)], (1, "b1"), dur=800, an="mirror")],
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
        # Options panel: global rate multiplier (engine Param ratemul) and router smoothing (router Param smooth, ms).
        "rate_mul": [
            R("x2", [lfo(0, 0, 2.0)], (1, 2), dur=2000, params="hbpm 120, hppq 0, hplay 0, ratemul 2"),
            R("x0.5", [lfo(0, 0, 2.0)], (1, 2), dur=3500, params="hbpm 120, hppq 0, hplay 0, ratemul 0.5"),
            R("sync_x2", [lfo(0, 0, 1.0, 1, 1.0, sync=1, syncDiv=9)], (1, 2), dur=2000, params="hbpm 120, hppq 0, hplay 0, ratemul 2"),
            R("change_free", [lfo(0, 0, 2.0)], (1, 2), dur=2200, params="hbpm 120, hppq 0, hplay 0, ratemul 1",
              events=[(800, "ratemul 2")]),
            R("change_sync", [lfo(0, 0, 1.0, 1, 1.0, sync=1, syncDiv=9)], (1, 2), dur=2200,
              params="hbpm 120, hppq 0, hplay 0, ratemul 1", events=[(800, "ratemul 2")]),
            R("env_x4", [{"slot": 0, "type": MOD_ENV, "p": {"attack": 5, "release": 120, "gain": 0, "bipolar": 0, "depth": 1}}],
              (1, "src"), dur=800, an="env", params="hbpm 120, hppq 0, hplay 0, ratemul 4",
              source="amp 0.5, freq 1000, t0ms 500, lenms 200"),
        ],
        "smoothing": [
            R("smooth50", [lfo(0, 4, 1.0)], (1, "rt0"), dur=2500, an="smooth", router=ROUTER_ID, rparams="smooth 50", smooth_ms=50),
            R("smooth0", [lfo(0, 4, 1.0)], (1, "rt0"), dur=2500, an="smooth", router=ROUTER_ID, rparams="smooth 0", smooth_ms=0),
        ],
        # Per-mapping Depth (schema 8, baked into the mapping table): Mod depth 0.5 halves the output, Remote shrinks the span toward the CENTRE (min + max) / 2.
        "mapping_depth": [
            R("mod", [lfo(0, 0, 3.0)], ("rt0", "rt1"), dur=1000, an="depth", dep=0.5, router=depth_router(0.5, "mod")),
            R("remote", [lfo(0, 0, 3.0)], ("rt0", "rt1"), dur=1000, an="depth", dep=0.5, remote=1, dctr=0.5,
              router=depth_router(0.5, "remote")),
            R("zero", [lfo(0, 0, 3.0)], ("rt0", "rt1"), dur=1000, an="depth", dep=0.0, router=depth_router(0.0, "mod")),
        ],
        # Automatable Rate parameter: `autorate` (obj-js) writes autoValue("rate", n) into the slot's cfg float mid-run, like the device
        # does when the "M1 Rate" Live parameter moves; the LFO period follows (2 Hz -> 4 Hz = 0.5 s -> 0.25 s, no phase jump).
        "auto_rate": [
            R("rate_param", [lfo(0, 0, 2.0)], (1, 2), dur=2200, params="hbpm 120, hppq 0, hplay 0",
              events=[(800, "autorate %.6f" % AUTO_RATE_NORM_4HZ, "obj-js")]),
        ],
        # Self-mod, INTERNAL matrix (schema 9): the engine adds a route's output to a destination in normalized knob space.
        "selfmod_internal": [
            # LFO 1 (0.5 Hz) modulates LFO 2's Rate (4 Hz base) by +-1 octave: instantaneous frequency 2..8 Hz in phase with LFO 1
            R("rate", [lfo(0, 0, 0.5), lfo(1, 0, 4.0)], (2, 1), dur=2200, an="selfrate",
              selfmod={"routes": [{"src": 0, "dest": DEST_RATE_1, "map": selfmap(range=OCT_NORM)}]},
              sp={"settle_ms": SETTLE_MS, "f1": 0.5, "f2": 4.0, "oct": 1.0}),
            # feedback LFO 1 <-> LFO 2 (each modulates the other's Rate by +-0.3 of the knob travel): finite, in range, still oscillating
            R("feedback", [lfo(0, 0, 3.0), lfo(1, 0, 5.0)], (1, 2), dur=2500, an="selffb",
              selfmod={"routes": [{"src": 0, "dest": DEST_RATE_1, "map": selfmap(range=0.3)},
                                  {"src": 1, "dest": DEST_RATE_0, "map": selfmap(range=0.3)}]}),
        ],
        # LFO 1 (1 Hz) modulates the Depth of mapping X (router slot 0, source LFO 2 at 8 Hz, route range 0.5: eff = 0.5 (sin + 1) / 2 = 0..0.5): amplitude modulation
        "selfmod_depth": [
            R("depth", [lfo(0, 0, 1.0), lfo(1, 0, 8.0)], ("rt0", 2), dur=2200, an="selfdepth", router_idx=0, router=ROUTER_DEPTH,
              selfmod={"routes": [{"src": 0, "dest": DEST_DEPTH_0, "map": selfmap(range=0.5)}]},
              sp={"settle_ms": SETTLE_MS, "f1": 1.0, "dbase": 1.0, "range": 0.5}),
        ],
        # Depth-modulation routes are MULTIPLICATIVE (VCA-like) and UNIPOLAR: eff = clip(base * prod m_k, 0, 1), m = range * y.
        # Onto a mapping in pool slot 96 (>= 64; the mapping's source is LFO 2, an 8 Hz sine, base depth 0.8): LFO 1 (1 Hz) through a route of
        # range 1.0 gives m = (sin + 1) / 2 = 0..1, eff = 0..0.8 (never inverting): the per-cycle peak of the router output follows it
        "depthmod_hi": [
            R("one", [lfo(0, 0, 1.0), lfo(1, 0, 8.0)], ("rt0", 2), dur=2400, an="depthroutes", router_idx=3, router=ROUTER_DEPTH_HI,
              selfmod={"routes": [{"src": 0, "dest": 192 + DEPTH_SLOT_HI, "map": selfmap(range=1.0)}]},
              sp={"settle_ms": SETTLE_MS, "base": 0.8, "routes": [{"f": 1.0, "range": 1.0}]}),
        ],
        # two routes onto one mapping MULTIPLY: base 1, LFO 1 (1 Hz, range 1: m = (sin + 1) / 2) x LFO 3 (1.7 Hz,
        # range 1: m = (sin + 1) / 2): eff = the product (0..1), 0 whenever either factor is 0
        "depthmod_sum": [
            R("two", [lfo(0, 0, 1.0), lfo(1, 0, 8.0), lfo(2, 0, 1.7)], ("rt0", 2), dur=3000, an="depthroutes", router_idx=3, router=ROUTER_DEPTH_SUM,
              selfmod={"routes": [{"src": 0, "dest": 192 + DEPTH_SLOT_HI, "map": selfmap(range=1.0)},
                                  {"src": 2, "dest": 192 + DEPTH_SLOT_HI, "map": selfmap(range=1.0)}]},
              sp={"settle_ms": SETTLE_MS, "base": 1.0, "routes": [{"f": 1.0, "range": 1.0}, {"f": 1.7, "range": 1.0}]}),
        ],
        # LFO 1 (2 Hz) modulates the Bipolar switch of slot 1 (40 Hz sine, depth 0.5, base off): bipolar (-0.5..0.5) while LFO 1 > 0.5, else unipolar (-1..0)
        "selfmod_toggle": [
            R("toggle", [lfo(0, 0, 2.0), lfo(1, 0, 40.0, 0, 0.5)], (2, 1), dur=2200, an="selftoggle",
              selfmod={"routes": [{"src": 0, "dest": DEST_BIPOLAR_1, "map": selfmap(range=1.0)}]},
              sp={"settle_ms": SETTLE_MS, "fast": 40.0}),
        ],
        # Router gen (src: scripts/megamod_common.py router_gen_code): slots 96 / 97 route from two different
        # modulators with two different tables, slot 98 is off. Router outlet j = slot 96 + j.
        # Skip logic (the deferred-DSP / skip-computation pass): a router whose route cells are all off sleeps (exact zeros) and wakes within ~32 samples when a cell
        # becomes active; its heartbeat / echo cells tell the face it runs; an engine slot that is disabled outputs exact zeros and comes back when re-enabled.
        "router_sleep": [
            # the mapper's way (activity count, then the cell): the sleeping router wakes on the next sample, so a Remote target is never forced to 0 for a vector
            R("wake", [lfo(0, 0, 3.0)], ("rt0", 1), dur=1500, an="routesleep", router=dict(ROUTER_ID, off=True),
              events=[(700, "routeset %d 0" % (ROUTER * mc.ROUTER_SLOTS), "obj-js")], sp={"event_ms": 700, "max_wake": 100}),
            # only the cell is written: the router's own 32-sample scan finds it
            R("scan", [lfo(0, 0, 3.0)], ("rt0", 1), dur=1500, an="routesleep", router=dict(ROUTER_ID, off=True),
              events=[(700, "routecell %d 0" % (ROUTER * mc.ROUTER_SLOTS), "obj-js")], sp={"event_ms": 700, "max_wake": 200}),
        ],
        "router_late_rbase": [
            R("late", [lfo(0, 0, 3.0)], ("rt0", 1), dur=1500, an="routesleep", router=ROUTER_ID, late_rbase=True,
              events=[(700, "rbase %d" % (ROUTER * mc.ROUTER_SLOTS), "dev-router")], sp={"event_ms": 700}),
        ],
        "router_heartbeat": [
            R("hb", [lfo(0, 0, 3.0)], ("rt0", 1), dur=600, an="routehb", router=ROUTER_ID, sp={"router_idx": ROUTER, "total_ms": 600 + SETTLE_MS}),
            R("hb0", [lfo(0, 0, 3.0)], ("rt0", 1), dur=600, an="routehb", router=dict(ROUTER_ID, base=0, slots=[{"slot": 0, "src": 0, "map": MAPPING_ID}]), router_idx=0,
              sp={"router_idx": 0, "total_ms": 600 + SETTLE_MS}),
        ],
        "slot_off": [
            R("off", [lfo(0, 0, 5.0)], (1,), dur=1400, an="slotoff", events=[(400, "cfgset 0 %d 0" % mc_cf("CF_ENABLED"), "obj-js"), (900, "cfgset 0 %d 1" % mc_cf("CF_ENABLED"), "obj-js")],
              sp={"off_ms": 400, "on_ms": 900}),
        ],
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
    elif case == "follower":
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
    elif case == "rate_mul":
        x2, x05, sx2, chf, chs, envx = ms
        sr = x2["sr"]
        one = 2 * 3.141592653589793 * 4.0 / sr  # largest per-sample step of a 4 Hz unit sine
        notes.append(f"x2: period {x2['c1_period']:.4f}s (4 Hz = 0.25); x0.5: period {x05['c1_period']:.4f}s (1 Hz = 1.0); "
                     f"sync x2: {sx2['c1_period']:.4f}s; free change: periods {chf['c1_periods'][0]:.3f} -> {chf['c1_periods'][-1]:.3f} "
                     f"maxStep {chf['c1_maxStep']:.2e} (limit {one:.2e}); sync change: {chs['c1_periods'][0]:.3f} -> "
                     f"{chs['c1_periods'][-1]:.3f} maxStep {chs['c1_maxStep']:.2e}; env x4 err {envx['env_maxerr']:.4f}")
        if not near(x2["c1_period"], 0.25, 0.005):
            err(f"ratemul 2 on a 2 Hz LFO: period {x2['c1_period']} != 0.25")
        if not near(x05["c1_period"], 1.0, 0.02):
            err(f"ratemul 0.5 on a 2 Hz LFO: period {x05['c1_period']} != 1.0")
        if not near(sx2["c1_period"], 0.25, 0.005):
            err(f"synced 1/4 at 120 bpm with ratemul 2: period {sx2['c1_period']} != 0.25")
        for tag, m in (("free", chf), ("sync", chs)):
            ps = m["c1_periods"]
            if len(ps) < 4 or not near(ps[0], 0.5, 0.01) or not near(ps[-1], 0.25, 0.006):
                err(f"{tag} mid-run change: periods should go 0.5 -> 0.25, got {ps}")
            if m["c1_maxStep"] > one * 1.03:
                err(f"{tag} mid-run change: phase jump (max step {m['c1_maxStep']} > one normal step {one})")
            if m["c1_min"] < -1.0001 or m["c1_max"] > 1.0001:
                err(f"{tag} mid-run change: out of range")
        if envx["env_maxerr"] > 0.05 or envx["env_peak_out"] < envx["env_peak_ref"] - 0.05:
            err("the envelope follower must ignore ratemul")
    elif case == "mapping_depth":
        mod, rem, zero = ms
        notes.append(f"Mod depth 0.5: peak {mod['depth_peak_full']:.3f} -> {mod['depth_peak_scaled']:.3f}, max err vs 0.5 x full {mod['depth_err']:.2e}; "
                     f"Remote depth 0.5 (0.2..0.8, centre 0.5): err vs c + 0.5 (full - c) {rem['depth_err']:.2e}, peak {rem['depth_peak_full']:.3f} -> "
                     f"{rem['depth_peak_scaled']:.3f}; Mod depth 0 peak {zero['depth_peak_scaled']:.2e}")
        if mod["depth_peak_full"] < 0.7:
            err(f"Mod depth 1 should modulate (peak {mod['depth_peak_full']})")
        if not near(mod["depth_peak_scaled"], 0.5 * mod["depth_peak_full"], 0.01):
            err(f"Mod depth 0.5 must halve the output ({mod['depth_peak_scaled']} vs {0.5 * mod['depth_peak_full']})")
        if not mod["depth_err"] <= 0.002:  # (written so that a NaN fails)
            err(f"Mod depth 0.5: router output is not 0.5 x the full-depth output (err {mod['depth_err']})")
        if not rem["depth_err"] <= 0.002:
            err(f"Remote depth 0.5: output is not c + 0.5 x (full - c) (err {rem['depth_err']})")
        if rem["depth_peak_scaled"] >= rem["depth_peak_full"] - 0.1:
            err("Remote depth 0.5 should shrink the span")
        if not zero["depth_err"] <= 0.002 or zero["depth_peak_scaled"] > 1e-6:
            err(f"Mod depth 0 must not modulate (peak {zero['depth_peak_scaled']})")
    elif case == "auto_rate":
        m = ms[0]
        ps = m["c1_periods"]
        sr = m["sr"]
        one = 2 * 3.141592653589793 * 4.0 / sr
        notes.append(f"periods {ps[0]:.3f} -> {ps[-1]:.3f} (2 Hz = 0.5 s, 4 Hz = 0.25 s), maxStep {m['c1_maxStep']:.2e} (limit {one:.2e})")
        if len(ps) < 4 or not near(ps[0], 0.5, 0.01) or not near(ps[-1], 0.25, 0.006):
            err(f"the Rate parameter change must move the LFO period 0.5 -> 0.25 s, got {ps}")
        if m["c1_maxStep"] > one * 1.03:
            err(f"phase jump on the rate change (max step {m['c1_maxStep']} > {one})")
    elif case == "smoothing":
        s50, s0 = ms
        notes.append(f"smooth 50: tau {s50['smooth_tau_ms']:.1f} ms (edges {s50['smooth_edges']:.0f}), +1 ms level {s50['smooth_instant']:.3f}, "
                     f"settled {s50['smooth_final']:.3f}; smooth 0: tau {s0['smooth_tau_ms']:.2f} ms maxdiff vs source {s0['smooth_maxdiff']:.4f}")
        for tag, m, want in (("50 ms", s50, 50.0),):
            if m["smooth_edges"] < 2:
                err(f"smooth {tag}: no edges measured")
            elif not near(m["smooth_tau_ms"], want, want * 0.08):
                err(f"smooth {tag}: one-pole time constant {m['smooth_tau_ms']} ms != {want} +-8%")
            if m["smooth_final"] < 0.97:
                err(f"smooth {tag}: output does not settle at the source level ({m['smooth_final']})")
        if s50["smooth_instant"] > -0.8:
            err(f"smooth 50: the step is instant (level 1 ms after the edge {s50['smooth_instant']})")
        if s0["smooth_tau_ms"] > 1.0 or s0["smooth_maxdiff"] > 0.02:
            err(f"smooth 0 must pass the output unchanged (tau {s0['smooth_tau_ms']} ms, maxdiff {s0['smooth_maxdiff']})")
    elif case == "selfmod_internal":
        a, fb = ms
        notes.append(f"LFO 2 Rate by LFO 1 (+-1 oct): {a['self_crossings']:.0f} crossings, max crossing error {a['self_cross_err_ms']:.3f} ms vs the integrated "
                     f"reference, f {a['self_fmin']:.2f}..{a['self_fmax']:.2f} Hz (want ~2..8), fastest at t = {a['self_tfmax']:.2f} s (LFO 1 peak at "
                     f"{a['self_lfo1_peak_t']:.2f} s)")
        if a["self_crossings"] < 6:
            err("LFO 2 should complete more than 6 cycles")
        if not a["self_cross_err_ms"] <= 3.0:
            err(f"zero crossings of LFO 2 differ from the +-1 octave rate-modulation reference by {a['self_cross_err_ms']} ms")
        if not (7.0 <= a["self_fmax"] <= 8.4):
            err(f"fastest LFO 2 frequency {a['self_fmax']} Hz (want ~ 8 = 2x the 4 Hz base)")
        if not (1.9 <= a["self_fmin"] <= 2.5):
            err(f"slowest LFO 2 frequency {a['self_fmin']} Hz (want ~ 2 = 1/2 x the 4 Hz base)")
        if not abs(a["self_tfmax"] - a["self_lfo1_peak_t"]) <= 0.3:
            err("LFO 2's fastest cycle is not in phase with LFO 1's positive peak")
        notes.append(f"feedback LFO 1 <-> LFO 2: {fb['sfb_cross1']:.0f} / {fb['sfb_cross2']:.0f} cycles, f {fb['sfb_fmin']:.2f}..{fb['sfb_fmax']:.2f} Hz, "
                     f"range {fb['c1_min']:.3f}..{fb['c1_max']:.3f} / {fb['c2_min']:.3f}..{fb['c2_max']:.3f}")
        if fb["sfb_cross1"] < 3 or fb["sfb_cross2"] < 3:
            err("feedback: an oscillator stopped")
        if fb["sfb_fmax"] > 41:
            err(f"feedback: frequency {fb['sfb_fmax']} Hz exceeds the Rate range")
        if fb["c1_min"] < -1.0001 or fb["c1_max"] > 1.0001 or fb["c2_min"] < -1.0001 or fb["c2_max"] > 1.0001:
            err("feedback: output out of -1..1")
    elif case == "selfmod_depth":
        d = ms[0]
        notes.append(f"effective depth = out / LFO 2: max err vs 0.5 (sin(2 pi t) + 1) / 2 {d['sdepth_err']:.4f} over {d['sdepth_n']:.0f} samples, "
                     f"range {d['sdepth_min']:.3f}..{d['sdepth_max']:.3f}; per-cycle peak of the output {d['sdepth_peak_min']:.3f}..{d['sdepth_peak_max']:.3f}")
        if d["sdepth_n"] < 200:
            err("too few samples to measure the depth")
        if not d["sdepth_err"] <= 0.04:
            err(f"Depth modulation error {d['sdepth_err']} (> 0.04)")
        if d["sdepth_min"] < -0.03:
            err(f"the effective Depth went below 0 ({d['sdepth_min']}): a depth route must never invert")
        if d["sdepth_min"] > 0.06 or d["sdepth_max"] < 0.45 or d["sdepth_max"] > 0.53:
            err("the Depth should sweep 0..0.5 (m = range * (sin + 1) / 2)")
        if d["sdepth_peak_max"] - d["sdepth_peak_min"] < 0.15 or d["sdepth_peak_max"] < 0.45:
            err("the slot output is not amplitude modulated")
    elif case == "remote_depth":
        for r, d in zip(runs, ms):
            sp = r["sp"]
            c = (sp["min"] + sp["max"]) / 2 if sp["mode"] == "remote" else 0.0
            line = (f"{r['name']}: {sp['mode']} {sp['min']}..{sp['max']} (c {c:.3f}) base {sp['base']} routes {len(sp['routes'])}: "
                    f"depth {d['rr_dmin']:.3f}..{d['rr_dmax']:.3f}, depth err {d['rr_err']:.4f} over {d['rr_n']:.0f} samples, "
                    f"out err {d['rr_dir_err']:.4f}, out {d['rr_out_min']:.3f}..{d['rr_out_max']:.3f}, max |out - c| {d['rr_dev_max']:.3f}, "
                    f"at depth ~0 ({d['rr_zero_n']:.0f} samples) |out - c| <= {d['rr_zero_dev']:.4f}")
            notes.append(line)
            if d["rr_n"] < 200:
                err(f"{r['name']}: too few samples to measure the depth")
            if d["rr_dmin"] < -0.03 or (sp["mode"] == "remote" and (d["rr_out_min"] < min(sp["min"], sp["max"]) - 0.02 or d["rr_out_max"] > max(sp["min"], sp["max"]) + 0.02)):
                err(f"{r['name']}: the effective depth went below 0 / the output left its bounds (depth min {d['rr_dmin']}, out {d['rr_out_min']}..{d['rr_out_max']})")
            if not d["rr_err"] <= 0.05:
                err(f"{r['name']}: effective depth error {d['rr_err']} (> 0.05)")
            if not d["rr_dir_err"] <= 0.03:
                err(f"{r['name']}: output differs from c + (lookup - c) * depth by {d['rr_dir_err']} (> 0.03)")
            if d["rr_zero_n"] > 0 and not d["rr_zero_dev"] <= 0.03:
                err(f"{r['name']}: output is not at the centre {c} while the depth is ~0 (|out - c| {d['rr_zero_dev']})")
            if r["name"].startswith(("user_B_full", "bounds_25_100")):
                if d["rr_zero_n"] < 100:
                    err(f"{r['name']}: too few samples with B ~ 0")
                if not d["rr_dev_max"] >= 0.9 * (sp["max"] - sp["min"]) / 2:
                    err(f"{r['name']}: the output never swings widely when |B| ~ 1 (max |out - c| {d['rr_dev_max']})")
            if r["name"].startswith("case1") or r["name"].startswith("case2"):
                want = 0.5 if r["name"].startswith("case1") else 0.625
                if not (d["rr_out_max"] - d["rr_out_min"] <= 0.01 and abs(d["rr_out_max"] - want) <= 0.01):
                    err(f"{r['name']}: route range 0 must hold {want} constant (out {d['rr_out_min']}..{d['rr_out_max']})")
            if r["name"].startswith("case3"):
                if not (abs(d["rr_out_min"] - 0.25) <= 0.03 and abs(d["rr_out_max"] - 0.75) <= 0.03 and d["rr_out_min"] >= 0.24 and d["rr_out_max"] <= 0.76):
                    err(f"{r['name']}: route range 0.5 must span 0.25..0.75 (out {d['rr_out_min']}..{d['rr_out_max']})")
            if r["name"] in ("remote_base0", "remote_base0_bounds25"):
                if not (d["rr_out_max"] - d["rr_out_min"] <= 0.01 and abs(d["rr_out_max"] - c) <= 0.01):
                    err(f"{r['name']}: base depth 0 must hold the centre {c} (out {d['rr_out_min']}..{d['rr_out_max']})")
            if r["name"].startswith("remote_base05") and not (abs(d["rr_out_min"] - 0.25) < 0.02 and abs(d["rr_out_max"] - 0.75) < 0.02):
                err(f"{r['name']}: depth 0.5 on 0..1 must span 0.25..0.75 (out {d['rr_out_min']}..{d['rr_out_max']})")
    elif case in ("depthmod_hi", "depthmod_sum"):
        d = ms[0]
        notes.append(f"pool slot {DEPTH_SLOT_HI}: out / src vs clip(base * prod m_k, 0, 1): max err {d['dr_err']:.4f} over {d['dr_n']:.0f} samples, depth {d['dr_min']:.3f}..{d['dr_max']:.3f} "
                     f"(expected {d['dr_exp_min']:.3f}..{d['dr_exp_max']:.3f}); "
                     f"per-cycle |peak| {d['dr_peak_min']:.3f}..{d['dr_peak_max']:.3f} over {d['dr_cycles']:.0f} cycles, max err {d['dr_peak_err']:.4f}, correlation {d['dr_corr']:.4f}")
        if d["dr_n"] < 200 or d["dr_cycles"] < 10:
            err("too few samples / cycles to measure the depth")
        if not d["dr_err"] <= 0.05:
            err(f"effective depth error {d['dr_err']} (> 0.05)")
        if not d["dr_peak_err"] <= 0.05:
            err(f"per-cycle peak error {d['dr_peak_err']} (> 0.05)")
        if not d["dr_corr"] >= 0.98:
            err(f"the per-cycle peaks do not follow the modulators (correlation {d['dr_corr']})")
        if not (abs(d["dr_min"] - d["dr_exp_min"]) <= 0.06 and abs(d["dr_max"] - d["dr_exp_max"]) <= 0.06):
            err("the measured depth range differs from the product of the routes' factors")
        if d["dr_peak_max"] - d["dr_peak_min"] < 0.3 or d["dr_peak_max"] < 0.7:
            err("the slot output is not amplitude modulated (per-cycle peak spread < 0.3 or max < 0.7)")
        if d["dr_min"] < -0.03:
            err(f"the effective depth went below 0 ({d['dr_min']}): a depth route never inverts the mapping")
        if d["dr_min"] > 0.1:
            err("the depth should reach ~0 (B at its minimum)")
    elif case == "adsr_threshold":
        for r, d in zip(runs, ms):
            nm = r["name"]
            notes.append(f"{nm}: max err vs adsrRunThreshold {d['adsr_err']:.5f}; onset {d['adsr_onset_ms']:.2f} ms, attack {d['adsr_attack_ms']:.2f} ms, decay {d['adsr_decay_ms']:.2f} ms, "
                         f"sustain {d['adsr_sustain']:.4f}, release {d['adsr_release_ms']:.2f} ms, peak {d['adsr_peak']:.4f}, triggers {d['adsr_triggers']:.0f} (reference {d['adsr_ref_triggers']:.0f})")
            if nm == "thresh_hi":
                if d["c1_max"] > -0.999:
                    err(f"{nm}: the input stays below the threshold, the ADSR must not fire (max out {d['c1_max']})")
                continue
            if not d["adsr_err"] <= 0.002:
                err(f"{nm}: output differs from the reference by {d['adsr_err']} (> 0.002)")
            if abs(d["adsr_triggers"] - d["adsr_ref_triggers"]) > 0.5 or d["adsr_triggers"] < 1:
                err(f"{nm}: {d['adsr_triggers']} triggers, reference {d['adsr_ref_triggers']}")
            if nm == "times":
                if not near(d["adsr_attack_ms"], 50.0, 2.0):
                    err(f"attack {d['adsr_attack_ms']} ms != 50 +-2")
                if not near(d["adsr_decay_ms"], 100.0, 2.0):
                    err(f"decay {d['adsr_decay_ms']} ms != 100 +-2")
                if not near(d["adsr_sustain"], 0.5, 0.005):
                    err(f"sustain {d['adsr_sustain']} != 0.5 +-0.005")
                if not near(d["adsr_release_ms"], 200.0, 3.0):
                    err(f"release {d['adsr_release_ms']} ms != 200 +-3")
                if not near(d["adsr_onset_ms"], 400.0 - SETTLE_MS, 2.0):
                    err(f"onset {d['adsr_onset_ms']} ms != burst start {400 - SETTLE_MS} +-2")
            if nm == "bursts" and d["adsr_triggers"] < 3.5:
                err(f"the bursts must trigger at least 4 times (got {d['adsr_triggers']})")
            if nm == "velocity_off" and not near(d["adsr_peak"], 1.0, 0.002):
                err(f"Vel on without MIDI velocity must still peak at 1 (got {d['adsr_peak']})")
    elif case == "adsr_retrig":
        d = ms[0]
        notes.append(f"second burst: Retrig off u {d['rt_a_before']:.3f} -> {d['rt_a_after']:.3f} (min {d['rt_a_min']:.3f}); Retrig on u {d['rt_b_before']:.3f} -> {d['rt_b_after']:.3f} (min {d['rt_b_min']:.3f}); "
                     f"identical before the retrigger within {d['rt_same_before']:.2e}")
        if d["rt_same_before"] > 1e-4:
            err("both ADSRs must be identical until the second trigger")
        if d["rt_a_before"] < 0.2:
            err(f"the first envelope must still be in its release at the second burst (u {d['rt_a_before']})")
        if d["rt_a_min"] < d["rt_a_before"] - 0.01:
            err(f"Retrig off must attack from the current level (dipped to {d['rt_a_min']} from {d['rt_a_before']})")
        if d["rt_b_min"] > 0.05 or d["rt_b_after"] > 0.1:
            err(f"Retrig on must restart from 0 (min {d['rt_b_min']}, 1 ms after the onset {d['rt_b_after']})")
    elif case == "xy_outputs":
        want = {"direct": (-0.6, 0.6), "router": (-0.6, 0.6), "router_depth": (-0.1, -0.9), "router_slot5": (-0.4, 0.2)}
        for r, d in zip(runs, ms):
            a, b = want[r["name"]]
            notes.append(f"{r['name']}: out A {d['c1_mean']:.4f} (want {a}), out B {d['c2_mean']:.4f} (want {b}); ripple {d['c1_max'] - d['c1_min']:.1e} / {d['c2_max'] - d['c2_min']:.1e}")
            if not (near(d["c1_mean"], a, 0.005) and near(d["c2_mean"], b, 0.005)):
                err(f"{r['name']}: X / Y levels {d['c1_mean']} / {d['c2_mean']} != {a} / {b}")
            if d["c1_max"] - d["c1_min"] > 1e-4 or d["c2_max"] - d["c2_min"] > 1e-4:
                err(f"{r['name']}: the outputs must be constant")
            if abs(d["c1_mean"] - d["c2_mean"]) < 0.1:
                err(f"{r['name']}: X and Y came out equal")
    elif case == "buttons_outputs":
        for r, d in zip(runs, ms):
            nm = r["name"]
            if nm == "slew":
                notes.append(f"slew: tau {d['bs_tau_ms']:.2f} ms (want 45), start {d['bs_start_ms']:.2f} ms, max step {d['bs_max_step']:.4f}, end {d['bs_end']:.4f}; button 2 stays {d['bs_b_min']:.4f}..{d['bs_b_max']:.4f}")
                if not near(d["bs_tau_ms"], 45.0, 4.0):
                    err(f"slew time constant {d['bs_tau_ms']} ms != 45 +-4")
                if d["bs_max_step"] > 0.05:
                    err(f"the slewed toggle steps by {d['bs_max_step']} per sample (not smooth)")
                if d["bs_end"] < 0.95:
                    err(f"the slewed button 1 must reach on (end {d['bs_end']})")
                if d["bs_b_max"] - d["bs_b_min"] > 1e-6 or d["bs_b_max"] > -0.999:
                    err("button 2 must stay off and untouched while button 1 toggles")
                continue
            want = (1.0, -1.0) if nm == "direct" else (-1.0, 1.0)
            notes.append(f"{nm}: out A {d['c1_mean']:.4f} (want {want[0]}), out B {d['c2_mean']:.4f} (want {want[1]})")
            if not (near(d["c1_mean"], want[0], 1e-3) and near(d["c2_mean"], want[1], 1e-3)):
                err(f"{nm}: button outputs {d['c1_mean']} / {d['c2_mean']} != {want}")
            if d["c1_max"] - d["c1_min"] > 1e-4 or d["c2_max"] - d["c2_min"] > 1e-4:
                err(f"{nm}: the outputs must be constant")
    elif case == "outputs_mirror":
        d = ms[0]
        notes.append(f"LFO: |A - B| max {d['mirror_maxdiff']:.2e}")
        if d["mirror_maxdiff"] > 1e-7:
            err("a single-output type must mirror output A on output B")
    elif case == "selfmod_toggle":
        t = ms[0]
        notes.append(f"Bipolar toggled by LFO 1 > 0.5: {t['stoggle_windows']:.0f} windows ({t['stoggle_on']:.0f} bipolar, {t['stoggle_off']:.0f} unipolar), "
                     f"{t['stoggle_mismatch']:.0f} mismatches")
        if t["stoggle_windows"] < 30 or t["stoggle_on"] < 5 or t["stoggle_off"] < 5:
            err("the toggle should switch between bipolar and unipolar")
        if t["stoggle_mismatch"] > 1:
            err(f"{t['stoggle_mismatch']} windows disagree with 'bipolar while LFO 1 > 0.5'")
    elif case == "router_sleep":
        for m, r in zip(ms, runs):
            notes.append(f"{r['name']}: asleep max|y| {m['rs_pre_max']:.2e}; woke {m['rs_wake_samples']:.0f} samples after the route cell was written; follows the source within {m['rs_follow_err']:.4f} ({m['rs_follow_n']:.0f} samples)")
            if m["rs_pre_max"] != 0:
                err(f"{r['name']}: a router with every route cell off must output exact zeros (got {m['rs_pre_max']})")
            if m["rs_wake_samples"] < 0 or m["rs_wake_samples"] > r["sp"]["max_wake"]:
                err(f"{r['name']}: the router must wake within {r['sp']['max_wake']} samples of a route cell becoming active (took {m['rs_wake_samples']})")
            if m["rs_follow_err"] > 0.02:
                err(f"{r['name']}: after waking the router output must follow the source (err {m['rs_follow_err']})")
    elif case == "router_late_rbase":
        m = ms[0]
        notes.append(f"before `rbase`: max|y| {m['rs_pre_max']:.2e}; the slots followed {m['rs_wake_samples']:.0f} samples after it, within {m['rs_follow_err']:.4f}")
        if m["rs_pre_max"] != 0:
            err(f"a router without its rbase reads slots 0..31 (all off): exact zeros expected (got {m['rs_pre_max']})")
        if m["rs_wake_samples"] < 0 or m["rs_wake_samples"] > 200:
            err(f"the router must serve its slots right after `rbase` (took {m['rs_wake_samples']} samples)")
        if m["rs_follow_err"] > 0.02:
            err(f"after rbase the router output must follow the source (err {m['rs_follow_err']})")
    elif case == "router_heartbeat":
        for m, r in zip(ms, runs):
            idx = r["sp"]["router_idx"]
            notes.append(f"router {idx}: heartbeat {m['hb_count']:.0f} (at least {0.8 * m['hb_expected']:.0f} expected), echo {m['hb_echo']:.0f} (want {idx * mc.ROUTER_SLOTS + 1})")
            # (a lower bound only: the NonRealTime render keeps running until the probe's message is handled, so the counter can be many times the window)
            if m["hb_count"] < 0.8 * m["hb_expected"]:
                err(f"router {idx}: the heartbeat should advance every 32 samples (got {m['hb_count']}, at least {0.8 * m['hb_expected']:.0f} expected)")
            if m["hb_echo"] != idx * mc.ROUTER_SLOTS + 1:
                err(f"router {idx}: the echo of rbase + 1 should be {idx * mc.ROUTER_SLOTS + 1} (got {m['hb_echo']})")
    elif case == "slot_off":
        m = ms[0]
        notes.append(f"before {m['so_before_max']:.3f}, disabled {m['so_off_max']:.2e}, re-enabled {m['so_after_max']:.3f}")
        if m["so_before_max"] < 0.9 or m["so_after_max"] < 0.9:
            err("the LFO must run before the slot is disabled and again after it is re-enabled")
        if m["so_off_max"] != 0:
            err(f"a disabled engine slot must output exact zeros (got {m['so_off_max']})")
    elif case == "lookup_chain":
        for tag, m in zip(("slot A (src mod 0, mod-mode S curve)", "slot B (src mod 1, remote exp, min 0.85 > max 0.15 inverted)"), ms[:2]):
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
