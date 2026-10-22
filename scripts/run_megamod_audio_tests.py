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
GEN_PATH = os.environ.get("MEGAMOD_GEN") or os.path.join(ROOT, "src", "megamod_engine.genexpr")  # (MEGAMOD_GEN: test another engine file)
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
        mh.box("dev-b-cfg", "buffer~ ---megamodcfg @samps 384", 800, 40, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-mseg", "buffer~ ---megamodmseg @samps 16384", 800, 70, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-steps", "buffer~ ---megamodsteps @samps 512", 800, 100, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-scope", f"buffer~ ---megamodscope @samps {mc.SCOPE_SAMPS}", 800, 130, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-int", f"buffer~ ---megamodint @samps {mc.INT_SAMPS}", 800, 250, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-b-icurve", f"buffer~ ---megamodicurve @samps {mc.ICURVE_SAMPS}", 800, 280, 220, numoutlets=2, outlettype=["float", "bang"]),
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
        boxes.append(mh.gen_box("dev-router", mc.router_gen_code(run.get("router_idx", ROUTER)), 400, 380, numinlets=16, numoutlets=32))
        lines.append(mh.line("obj-load", 0, "dev-rbind", 0))
        lines.append(mh.line("dev-rbind", 0, "dev-router", 0))
        if run.get("rparams"):
            # router Params (Options panel smoothing: `smooth <ms>`), sent before DSP like the other params
            boxes.append(mh.msg("dev-rparams", run["rparams"], 40, 680, 300))
            lines.append(mh.line("obj-load", 0, "dev-rparams", 0))
            lines.append(mh.line("dev-rparams", 0, "dev-router", 0))
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
    case_obj = {k: run[k] for k in ("mods", "an", "bpm", "jumpTo", "router", "chk", "tele", "smooth_ms", "dep", "remote", "dmin", "selfmod", "sp") if k in run}
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
ROUTER_DEPTH_HI = {"base": DEPTH_SLOT_HI, "slots": [{"slot": DEPTH_SLOT_HI, "src": 1, "map": {"mode": "mod", "polarity": 0, "range": 1.0, "depth": 0.5}}]}
ROUTER_DEPTH = {"base": 0, "slots": [{"slot": 0, "src": 1, "map": {"mode": "mod", "polarity": 0, "range": 1.0, "depth": 0.5}}]}


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
        # Per-mapping Depth (schema 8, baked into the mapping table): Mod depth 0.5 halves the output, Remote shrinks the span toward min.
        "mapping_depth": [
            R("mod", [lfo(0, 0, 3.0)], ("rt0", "rt1"), dur=1000, an="depth", dep=0.5, router=depth_router(0.5, "mod")),
            R("remote", [lfo(0, 0, 3.0)], ("rt0", "rt1"), dur=1000, an="depth", dep=0.5, remote=1, dmin=0.2,
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
        # LFO 1 (1 Hz) modulates the Depth of mapping X (router slot 0, source LFO 2 at 8 Hz, base depth 0.5, +-0.5): amplitude modulation
        "selfmod_depth": [
            R("depth", [lfo(0, 0, 1.0), lfo(1, 0, 8.0)], ("rt0", 2), dur=2200, an="selfdepth", router_idx=0, router=ROUTER_DEPTH,
              selfmod={"routes": [{"src": 0, "dest": DEST_DEPTH_0, "map": selfmap(range=0.5)}]},
              sp={"settle_ms": SETTLE_MS, "f1": 1.0, "dbase": 0.5, "range": 0.5}),
        ],
        # Depth-modulation routes onto a mapping in pool slot 96 (>= 64; the mapping's source is LFO 2, an 8 Hz sine, base depth 0.5):
        # LFO 1 (1 Hz, +-0.5) -> the per-cycle peak of the router output follows LFO 1 (amplitude modulation)
        "depthmod_hi": [
            R("one", [lfo(0, 0, 1.0), lfo(1, 0, 8.0)], ("rt0", 2), dur=2400, an="depthroutes", router_idx=3, router=ROUTER_DEPTH_HI,
              selfmod={"routes": [{"src": 0, "dest": 192 + DEPTH_SLOT_HI, "map": selfmap(range=0.5)}]},
              sp={"settle_ms": SETTLE_MS, "base": 0.5, "routes": [{"f": 1.0, "range": 0.5}]}),
        ],
        # two routes onto one mapping sum (and clamp at 0..1): LFO 1 (1 Hz, +-0.35) + LFO 3 (1.7 Hz, +-0.35) on base depth 0.5
        "depthmod_sum": [
            R("two", [lfo(0, 0, 1.0), lfo(1, 0, 8.0), lfo(2, 0, 1.7)], ("rt0", 2), dur=3000, an="depthroutes", router_idx=3, router=ROUTER_DEPTH_HI,
              selfmod={"routes": [{"src": 0, "dest": 192 + DEPTH_SLOT_HI, "map": selfmap(range=0.35)},
                                  {"src": 2, "dest": 192 + DEPTH_SLOT_HI, "map": selfmap(range=0.35)}]},
              sp={"settle_ms": SETTLE_MS, "base": 0.5, "routes": [{"f": 1.0, "range": 0.35}, {"f": 1.7, "range": 0.35}]}),
        ],
        # LFO 1 (2 Hz) modulates the Bipolar switch of slot 1 (40 Hz sine, depth 0.5, base off): bipolar (-0.5..0.5) while LFO 1 > 0.5, else unipolar (-1..0)
        "selfmod_toggle": [
            R("toggle", [lfo(0, 0, 2.0), lfo(1, 0, 40.0, 0, 0.5)], (2, 1), dur=2200, an="selftoggle",
              selfmod={"routes": [{"src": 0, "dest": DEST_BIPOLAR_1, "map": selfmap(range=1.0)}]},
              sp={"settle_ms": SETTLE_MS, "fast": 40.0}),
        ],
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
                     f"Remote depth 0.5 (min 0.2): err vs min + 0.5 (full - min) {rem['depth_err']:.2e}, peak {rem['depth_peak_full']:.3f} -> "
                     f"{rem['depth_peak_scaled']:.3f}; Mod depth 0 peak {zero['depth_peak_scaled']:.2e}")
        if mod["depth_peak_full"] < 0.7:
            err(f"Mod depth 1 should modulate (peak {mod['depth_peak_full']})")
        if not near(mod["depth_peak_scaled"], 0.5 * mod["depth_peak_full"], 0.01):
            err(f"Mod depth 0.5 must halve the output ({mod['depth_peak_scaled']} vs {0.5 * mod['depth_peak_full']})")
        if not mod["depth_err"] <= 0.002:  # (written so that a NaN fails)
            err(f"Mod depth 0.5: router output is not 0.5 x the full-depth output (err {mod['depth_err']})")
        if not rem["depth_err"] <= 0.002:
            err(f"Remote depth 0.5: output is not min + 0.5 x (full - min) (err {rem['depth_err']})")
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
        notes.append(f"effective depth = out / LFO 2: max err vs clip(0.5 + 0.5 sin(2 pi t), 0, 1) {d['sdepth_err']:.4f} over {d['sdepth_n']:.0f} samples, "
                     f"range {d['sdepth_min']:.3f}..{d['sdepth_max']:.3f}; per-cycle peak of the output {d['sdepth_peak_min']:.3f}..{d['sdepth_peak_max']:.3f}")
        if d["sdepth_n"] < 200:
            err("too few samples to measure the depth")
        if not d["sdepth_err"] <= 0.04:
            err(f"Depth modulation error {d['sdepth_err']} (> 0.04)")
        if d["sdepth_min"] > 0.1 or d["sdepth_max"] < 0.9:
            err("the Depth should sweep 0..1")
        if d["sdepth_peak_min"] > 0.35 or d["sdepth_peak_max"] < 0.9:
            err("the slot output is not amplitude modulated")
    elif case in ("depthmod_hi", "depthmod_sum"):
        d = ms[0]
        notes.append(f"pool slot {DEPTH_SLOT_HI}: out / src vs clip(base + sum of the routes): max err {d['dr_err']:.4f} over {d['dr_n']:.0f} samples, depth {d['dr_min']:.3f}..{d['dr_max']:.3f}; "
                     f"per-cycle peak {d['dr_peak_min']:.3f}..{d['dr_peak_max']:.3f} over {d['dr_cycles']:.0f} cycles, max err {d['dr_peak_err']:.4f}, correlation {d['dr_corr']:.4f}")
        if d["dr_n"] < 200 or d["dr_cycles"] < 10:
            err("too few samples / cycles to measure the depth")
        if not d["dr_err"] <= 0.05:
            err(f"effective depth error {d['dr_err']} (> 0.05)")
        if not d["dr_peak_err"] <= 0.05:
            err(f"per-cycle peak error {d['dr_peak_err']} (> 0.05)")
        if not d["dr_corr"] >= 0.98:
            err(f"the per-cycle peaks do not follow the modulators (correlation {d['dr_corr']})")
        if d["dr_peak_min"] > 0.3 or d["dr_peak_max"] < 0.9:
            err("the slot output is not amplitude modulated over 0.3..0.9")
        if case == "depthmod_sum" and not d["dr_min"] <= 0.05:
            err("the summed depth should clamp down to 0 (two routes pulling the same way)")
    elif case == "selfmod_toggle":
        t = ms[0]
        notes.append(f"Bipolar toggled by LFO 1 > 0.5: {t['stoggle_windows']:.0f} windows ({t['stoggle_on']:.0f} bipolar, {t['stoggle_off']:.0f} unipolar), "
                     f"{t['stoggle_mismatch']:.0f} mismatches")
        if t["stoggle_windows"] < 30 or t["stoggle_on"] < 5 or t["stoggle_off"] < 5:
            err("the toggle should switch between bipolar and unipolar")
        if t["stoggle_mismatch"] > 1:
            err(f"{t['stoggle_mismatch']} windows disagree with 'bipolar while LFO 1 > 0.5'")
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
