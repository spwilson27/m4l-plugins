#!/usr/bin/env python3
"""Render Glitch through the Ableton-bundled Max (NonRealTime driver, scripts/max_harness.py) and check the DSP.

Runs INSIDE the tart VM only (AGENTS.md 1a). The VM has no node: the layout comes from tests/out/glitch_layout.json,
which build_glitch.py / the host unit tests refresh.
    python3 scripts/run_glitch_audio_tests.py [case ...]

The gen code is src/cepstrum_lib.genexpr + src/glitch_core.genexpr (tokens substituted by glitch_common.py), exactly what
the device embeds. The slot vectors and weights are written into buffer~ glitchslots by tests/glitch_probe.js through the
same peek/poke layout the UI uses (src/glitch_config.js packEngineBuffer).

Cases: neutral (exact identity at the fixed latency 1023), silence, one case per module alone (phase 1 and phase 2 modules),
spec_latency (STFT running but transparent has the same latency), xy_morph (weights ramp, no clicks), disc_switch (discrete
param switch at the midpoint), the sequencer (seq_steps / seq_glide / seq_hold / seq_stop / seq_ppq / seq_empty: slot switches
on the step boundaries of the free-running and of the stepped ppq clock, click-free glide, hold, transport stop),
stress_all (every module on, no NaN), telemetry, cpu6 / cpu6_new / cpu_all (real-time driver) and compile (gen compile time vs
a trivial gen).
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import glitch_common as gc

ROOT = mh.ROOT
PROBE_JS = os.path.join(ROOT, "tests", "glitch_probe.js")
SR = mh.DEFAULT_SR
LAYOUT = gc.load_layout()
LATENCY = LAYOUT["latency"]
NP = LAYOUT["np"]
WOFF = LAYOUT["weightsOffset"]
SQOFF = LAYOUT["seqOffset"]
POS = {iid: i for i, iid in enumerate(LAYOUT["order"])}  # chain position of each instance (telemetry ACTIVITY / LEVEL index)
SC_ARGS = [f"sc:{k}={v}" for k, v in LAYOUT["scope"].items()] + [f"meta:{LAYOUT['metaOffset']}"]
CONSTANTS = LAYOUT["constants"]  # kind + 4 * group per param, defaults, wet index per chain position (the engine buffer's constants block)
GEN = gc.gen_source(LAYOUT)
DEFAULTS = [m[2] for m in LAYOUT["meta"]]

BASE = "bpm 120, ppq 0, wet 1, outdb 0"
DIV_BEATS = LAYOUT["mvDivBeats"]  # LFO cycle / step length in beats per division index (GL_MV_DIV_BEATS)


def mv(inst, typ, target, depth, div=8, sync=1, hz=1.0, shape=0, phase=0.0, steps=None, nsteps=0, glide=0.0, atk=10.0, rel=200.0):
    """The movement block of a slot vector entry: vec({"filt": {"wet": 1, ..., **mv("filt", 1, "cutoff", 0.3)}})."""
    pos = LAYOUT["index"][f"{inst}.{target}"] - LAYOUT["base"][inst]
    d = {"mv_on": 1, "mv_type": typ, "mv_target": pos, "mv_depth": depth, "mv_hz": hz, "mv_cpb": 1.0 / DIV_BEATS[div], "mv_sync": sync, "mv_phase": phase,
         "mv_shape": shape, "mv_glide": glide, "mv_nsteps": nsteps, "mv_atk": atk, "mv_rel": rel}
    for i, v in enumerate(steps or []):
        d[f"mv_s{i}"] = v
    return d


def vec(mods):
    """Slot vector from {instance: {"wet": x, key: value}}; absent instances are off."""
    v = list(DEFAULTS)
    for inst, vals in mods.items():
        for key, val in vals.items():
            v[LAYOUT["index"][f"{inst}.{key}"]] = float(val)
    return v


def slotdata(slots):
    flat = []
    for s in range(8):
        flat += slots[s] if s < len(slots) and slots[s] is not None else list(DEFAULTS)
    return "slots " + " ".join(f"{x:.7g}" for x in flat)


def weights_msg(w):
    w = list(w) + [0.0] * (8 - len(w))
    return "weights " + " ".join(f"{x:.5g}" for x in w)


def build_device(code, case):
    boxes = [
        mh.msg("obj-params", case.get("params", BASE), 200, 40, 700),
        mh.msg("obj-bind", "slots glitchslots, scope glitchscope", 200, 70, 300),
        mh.msg("obj-fill", "fill", 300, 130, 40),
        mh.msg("obj-slotmsg", slotdata(case.get("slots", [])), 200, 160, 700),
        mh.msg("obj-wmsg", weights_msg(case.get("weights", [1])), 200, 190, 300),
        mh.msg("obj-seqmsg", case.get("seq", seq_msg(0, 8, 4, 0, 0, [])), 200, 215, 400),
        mh.msg("obj-metamsg", "meta " + " ".join(f"{x:.7g}" for x in CONSTANTS), 200, 240, 900),
        mh.box("obj-slots-buf", f"buffer~ glitchslots @samps {LAYOUT['slotsBufSamps']}", 520, 70, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-scope-buf", f"buffer~ glitchscope @samps {LAYOUT['scopeSamps']}", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-stim", f"buffer~ stim @samps {3 * SR} @chans 1", 520, 130, 220, numoutlets=2, outlettype=["float", "bang"]),
        {
            "box": {
                "code": code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [200.0, 240.0, 300.0, 80.0],
            }
        },
        mh.box("obj-phasor", "phasor~ 0.3333333333", 700, 200, 80, numinlets=2, outlettype=["signal"]),
        mh.box("obj-wave", "wave~ stim", 700, 240, 90, numinlets=3, numoutlets=2, outlettype=["signal", "signal"]),
    ]
    lines = [
        mh.line("obj-load", 0, "obj-params", 0),
        mh.line("obj-load", 0, "obj-bind", 0),
        mh.line("obj-load", 0, "obj-fill", 0),
        mh.line("obj-load", 0, "obj-slotmsg", 0),
        mh.line("obj-load", 0, "obj-wmsg", 0),
        mh.line("obj-load", 0, "obj-seqmsg", 0),
        mh.line("obj-load", 0, "obj-metamsg", 0),
        mh.line("obj-metamsg", 0, "obj-js", 0),
        mh.line("obj-seqmsg", 0, "obj-js", 0),
        mh.line("obj-fill", 0, "obj-js", 0),
        mh.line("obj-slotmsg", 0, "obj-js", 0),
        mh.line("obj-wmsg", 0, "obj-js", 0),
        mh.line("obj-bind", 0, "obj-gen", 0),
        mh.line("obj-params", 0, "obj-gen", 0),
        mh.line("obj-gen", 0, "obj-record", 0),
        mh.line("obj-wave", 0, "obj-record", 1),
        mh.line("obj-gen", 1, "obj-record", 2),
        mh.line("obj-phasor", 0, "obj-record", 3),
        mh.line("obj-gen", 0, "obj-mute-l", 0),
        mh.line("obj-phasor", 0, "obj-wave", 0),
        mh.line("obj-wave", 0, "obj-gen", 0),
        mh.line("obj-wave", 0, "obj-gen", 1),
    ]
    events = []
    for ev in case.get("events", []):
        ms, text = ev[0], ev[1]
        events.append((ms, ev[2] if len(ev) > 2 else case.get("event_target", "obj-js"), 0, text))
    if case.get("cpu"):
        boxes += [
            mh.msg("obj-metro-on", "1", 40, 480, 30),
            mh.box("obj-metro", "metro 100", 40, 500, 70, numinlets=2, outlettype=["bang"]),
            mh.box("obj-adstatus", "adstatus cpu", 40, 530, 90, outlettype=["float"]),
        ]
        lines += [mh.line("obj-metro", 0, "obj-adstatus", 0), mh.line("obj-adstatus", 0, "obj-js", 1)]
        events.append((0, "obj-metro", 0, "1"))
    return boxes, lines, events




def seq_msg(mode, length, rate, glide, curve, steps):
    """The probe's `seq` message: the 24 floats of the sequencer block (header + 16 steps, -1 = hold)."""
    st = list(steps) + [-1] * (16 - len(steps))
    return "seq " + " ".join(str(x) for x in [mode, length, rate, glide, curve, 0, 0, 0] + st)


def gl_perm(r, seed):
    """Python twin of gl_perm / qc_perm (seeded Fisher-Yates of 1..r, index 0 unused)."""
    pm = list(range(r + 2))
    for t in range(r - 1):
        i = r - t
        v = math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
        j = 1 + int(math.floor((v - math.floor(v)) * i))
        j = min(j, i)
        pm[i], pm[j] = pm[j], pm[i]
    return pm


def xc_token(name, out_start, in_start, ln, rev, search=48):
    return f"xc:{name}:{int(out_start)}:{int(in_start)}:{int(ln)}:{1 if rev else 0}:{int(search)}"


# --------------------------------------------------------------------------- cases
def ramp_events(w0, w1, t0, t1, steps):
    ev = []
    for i in range(1, steps + 1):
        f = i / steps
        ev.append((int(t0 + (t1 - t0) * (i - 1) / max(steps - 1, 1)), weights_msg([w0[k] + (w1[k] - w0[k]) * f for k in range(len(w0))])))
    return ev


def cases():
    base = {"stim": "mix", "arm": 700, "dur": 2800, "lags": [], "events": [], "slots": [], "weights": [1]}

    def c(name, **kw):
        d = dict(base)
        d["name"] = name
        d.update(kw)
        return d

    def one(name, mods, **kw):
        return c(name, slots=[vec(mods)], **kw)

    out = [
        c("neutral", dur=2200),
        c("silence", stim="silent", dur=1500, slots=[vec({
            "drvA": {"wet": 1, "drive": 24}, "filt": {"wet": 1}, "crush": {"wet": 1, "bits": 3}, "ring": {"wet": 1, "mode": 1, "freq": 300},
            "stut": {"wet": 1}, "time": {"wet": 1}, "chop": {"wet": 1}, "spec": {"wet": 1, "smr_amt": 1, "cc_amt": 1, "cc_coeffs": 0.2, "sc_amt": 1},
            "drvB": {"wet": 1}, "dly": {"wet": 1, "fb": 0.8}, "rev": {"wet": 1, "void": 1}, "wid": {"wet": 1, "gain": 6}})]),
        one("drive", {"drvA": {"wet": 1, "mode": 0, "drive": 24, "tone": 20000}}, stim="sine"),
        one("drive_b", {"drvB": {"wet": 1, "mode": 1, "drive": 18, "tone": 20000}}, stim="sine"),
        one("filter_lp", {"filt": {"wet": 1, "type": 0, "cutoff": 500, "res": 0.2}}, stim="noise"),
        one("filter_hp", {"filt": {"wet": 1, "type": 2, "cutoff": 4000, "res": 0.2}}, stim="noise"),
        one("filter_bp", {"filt": {"wet": 1, "type": 1, "cutoff": 1000, "res": 0.7}}, stim="noise"),
        one("crush", {"crush": {"wet": 1, "bits": 4, "rate": 8, "jitter": 0.3}}, stim="sine"),
        one("ring_shift", {"ring": {"wet": 1, "mode": 1, "freq": 300}}, stim="sine1k"),
        one("ring_mod", {"ring": {"wet": 1, "mode": 0, "freq": 300}}, stim="sine1k"),
        one("stutter", {"stut": {"wet": 1, "div": 6, "prob": 1, "decay": 0}}, stim="noise", dur=4000, lags=[24000]),
        one("tapestop", {"time": {"wet": 1, "mode": 0, "amt": 1, "div": 6}}, stim="mix", dur=3000),
        one("varispeed", {"time": {"wet": 1, "mode": 1, "amt": 0.8, "div": 6}}, stim="sine"),
        one("reverse", {"time": {"wet": 1, "mode": 2, "amt": 0.5, "div": 6}}, stim="noise", dur=3000),
        one("chopper", {"chop": {"wet": 1, "pattern": 0xAAAA, "div": 2, "smooth": 0}}, stim="noise"),
        one("freeze", {"spec": {"wet": 1, "frz_amt": 1, "frz_rate": 0}}, stim="sweep2", dur=2800),
        one("smear", {"spec": {"wet": 1, "smr_amt": 1, "smr_blur": 0.5}}, stim="clicks", dur=3000),
        one("ccrush", {"spec": {"wet": 1, "cc_amt": 1, "cc_coeffs": 0.1, "cc_bits": 16}}, stim="vowel", dur=3000),
        one("scramble", {"spec": {"wet": 1, "sc_amt": 1, "sc_mode": 1}}, stim="vowel", dur=3000),
        one("spec_latency", {"spec": {"wet": 1, "smr_amt": 0.001}}, stim="mix", dur=2200),
        one("delay", {"dly": {"wet": 1, "div": 6, "fb": 0.0, "pp": 0, "damp": 16000}}, stim="noise", dur=3000, lags=[24000]),
        one("delay_pp", {"dly": {"wet": 1, "div": 4, "fb": 0.6, "pp": 1, "damp": 8000}}, stim="burst", dur=3000),
        one("reverb", {"rev": {"wet": 1, "size": 0.6, "decay": 0.6, "damp": 8000, "void": 0}}, stim="burst", dur=3000),
        one("reverb_void", {"rev": {"wet": 1, "size": 1, "decay": 1, "damp": 12000, "void": 1}}, stim="burst", dur=3000),
        one("width_gain", {"wid": {"wet": 1, "width": 1, "gain": 6}}, stim="mix", dur=2200),
        one("limiter", {"wid": {"wet": 1, "width": 1, "gain": 6}, "drvA": {"wet": 1, "mode": 2, "drive": 30, "tone": 20000}}, stim="noise", dur=2200),
    ]
    # morph between two filter slots by ramping the weights
    a = vec({"filt": {"wet": 1, "type": 0, "cutoff": 800, "res": 0.3}})
    b = vec({"filt": {"wet": 1, "type": 2, "cutoff": 3000, "res": 0.6}, "drvA": {"wet": 0.8, "mode": 0, "drive": 12, "tone": 12000}})
    out.append(c("xy_morph", stim="mix", dur=3200, slots=[a, b], weights=[1, 0], events=ramp_events([1, 0], [0, 1], 900, 2100, 12)))
    out.append(c("xy_morph_empty", stim="mix", dur=3200, slots=[a, None], weights=[1, 0], events=ramp_events([1, 0], [0, 1], 900, 2100, 12)))
    # discrete param switch exactly at the midpoint
    out.append(c("disc_switch", stim="mix", dur=3000, slots=[a, vec({"filt": {"wet": 1, "type": 2, "cutoff": 800, "res": 0.3}})], weights=[0.6, 0.4],
                 events=[(1400, weights_msg([0.4, 0.6]))]))
    out.append(one("telemetry", {"spec": {"wet": 1, "smr_amt": 0.6, "cc_amt": 1, "cc_coeffs": 0.3}, "chop": {"wet": 1, "pattern": 0xFFFB, "div": 3}}, stim="vowel", dur=3000))  # mostly open: the spectral telemetry is only refreshed while sound reaches the STFT
    six = {"drvA": {"wet": 1, "mode": 0, "drive": 12}, "filt": {"wet": 1, "type": 1, "cutoff": 1500, "res": 0.5}, "crush": {"wet": 1, "bits": 8, "rate": 3},
           "stut": {"wet": 1, "div": 4, "prob": 0.6}, "spec": {"wet": 1, "smr_amt": 0.5, "cc_amt": 0.6, "cc_coeffs": 0.4}, "dly": {"wet": 0.5, "div": 4, "fb": 0.5},
           "rev": {"wet": 0.4, "size": 0.7, "decay": 0.7}}
    out.append(one("cpu6", six, stim="mix", dur=2500, cpu=True))
    out.append(one("six_nrt", six, stim="mix", dur=2500))

    # ---- phase 2 modules, each alone ----
    out += [
        one("formant_a", {"form": {"wet": 1, "vowel": 0, "shift": 0, "res": 0.8}}, stim="noise"),
        one("formant_i", {"form": {"wet": 1, "vowel": 2, "shift": 0, "res": 0.8}}, stim="noise"),
        one("comb", {"comb": {"wet": 1, "freq": 480, "fb": 0.85, "damp": 16000}}, stim="noise"),
        one("phaser", {"phas": {"wet": 1, "stages": 3, "sync": 0, "hz": 2, "depth": 1, "fb": 0.6}}, stim="noise", dur=3000),
        one("rectify_full", {"rect": {"wet": 1, "mode": 1, "blend": 1}}, stim="sine"),
        one("rectify_half", {"rect": {"wet": 1, "mode": 0, "blend": 1}}, stim="sine"),
        one("fm_osc", {"fm": {"wet": 1, "mode": 0, "ratio": 4, "index": 0.6}}, stim="sine"),
        one("fm_self", {"fm": {"wet": 1, "mode": 1, "ratio": 8, "index": 0.8}}, stim="sine"),
        one("corrupt", {"corr": {"wet": 1, "div": 2, "chance": 1, "flips": 1, "wrap": 0.5, "drop": 0.6}}, stim="sine"),
        one("corrupt_off", {"corr": {"wet": 1, "div": 2, "chance": 0, "flips": 1, "wrap": 0.5, "drop": 0.6}}, stim="mix", dur=2200),
        one("gpitch_up", {"gpit": {"wet": 1, "pitch": 12, "size": 80, "jitter": 0}}, stim="sine"),
        one("gpitch_down", {"gpit": {"wet": 1, "pitch": -12, "size": 80, "jitter": 0}}, stim="sine"),
        one("gstretch", {"gstr": {"wet": 1, "speed": 0.25, "size": 120, "spread": 0.2}}, stim="sine"),
        one("slapback", {"slap": {"wet": 1, "time": 90, "tone": 16000, "offset": 0}}, stim="noise", dur=3000, lags=[4320]),
        one("scatter", {"spec": {"wet": 1, "sct_amt": 1, "sct_w": 8, "sct_rate": 7}}, stim="sine1k", dur=3000),
        one("mirror", {"spec": {"wet": 1, "mir_amt": 1, "mir_pivot": 1500}}, stim="sine1k", dur=3000),
        one("binshift", {"spec": {"wet": 1, "bsh_amt": 1, "bsh_bins": 16}}, stim="sine1k", dur=3000),
        one("specgate_topk", {"spec": {"wet": 1, "sgl_amt": 1, "sgl_mode": 0, "sgl_k": 4}}, stim="mix", dur=3000),
        one("specgate_lofi", {"spec": {"wet": 1, "sgl_amt": 1, "sgl_mode": 1, "sgl_step": 24}}, stim="noise", dur=3000),
    ]
    # Granular Stretch freeze: the module engages at 1200 ms (stimulus still 440 Hz), speed 0 holds that grain; the input moves on to 1320 Hz
    gs_on = vec({"gstr": {"wet": 1, "speed": 0, "size": 100, "spread": 0}})
    out.append(c("gstretch_freeze", stim="sweep2", dur=2800, slots=[vec({}), gs_on], weights=[1, 0], events=[(1200, weights_msg([0, 1]))]))

    # Reverse Slices / Slice Shuffle: output slices are correlated with the reversed / permuted previous slices
    ARM = 750
    A0 = SR * ARM // 1000
    LAG = LATENCY
    SL = 12000  # 1/8 note at 120 bpm
    toks = []
    for m in range(4, 9):
        w0 = m * SL - A0
        toks.append(xc_token(f"rev{m}", w0 + LAG + 300, w0 - 1 - 300, SL - 600, True))
    out.append(one("revslice", {"rvs": {"wet": 1, "div": 4, "chance": 1}}, stim="noise", arm=ARM, dur=2800, probe=toks))
    SPAN = 24000  # one beat
    toks = []
    for sp in (3, 4, 5):
        pm = gl_perm(4, sp * 7.31 + 0 * 13.7)
        for k in range(4):
            src = int(pm[k + 1]) - 1
            w0 = sp * SPAN - A0
            toks.append(xc_token(f"shuf{sp}_{k}", w0 + k * 6000 + LAG + 300, w0 - SPAN + src * 6000 + 300, 5400, False))
    out.append(one("shuffle", {"shuf": {"wet": 1, "slices": 1, "span": 0, "chance": 1, "seed": 0}}, stim="noise", arm=ARM, dur=2800, probe=toks))

    # ---- sequencer: slot A = unity gain, slot B = -12 dB (post-spectral width/gain, so the level steps at the output time = gen time) ----
    sa = vec({"wid": {"wet": 1, "width": 1, "gain": 0}})
    sb = vec({"wid": {"wet": 1, "width": 1, "gain": -12}})
    sq = dict(stim="noise", arm=ARM, dur=3000, probe=["dump:128"], slots=[sa, sb])
    out.append(c("seq_steps", seq=seq_msg(2, 4, 4, 0, 0, [0, 1, 0, 1]), **sq))
    out.append(c("seq_hold", seq=seq_msg(2, 4, 4, 0, 0, [0, -1, 1, -1]), **sq))
    out.append(c("seq_stop", seq=seq_msg(2, 4, 4, 0, 0, [0, 1, 0, 1]), events=[(1100, "playing 0", "obj-gen")], **sq))
    out.append(c("seq_ppq", seq=seq_msg(2, 4, 4, 0, 0, [0, 1, 0, 1]), events=[(1100, "ppq 100.5", "obj-gen")], **sq))
    out.append(c("seq_glide", seq=seq_msg(2, 2, 4, 1.0, 0, [0, 1]), stim="sine", arm=ARM, dur=3000, probe=["dump:256"], slots=[sa, sb]))
    out.append(c("seq_empty", seq=seq_msg(2, 8, 4, 0, 0, []), stim="mix", dur=2200, slots=[sa, sb]))

    # ---- phase 3: per-module movement (blk 1024 = 21 ms envelope blocks, 128 for the step edges) ----
    ARMM = 750
    lp = {"wet": 1, "type": 0, "cutoff": 1000, "res": 0.2}
    mvc = dict(stim="noise", arm=ARMM, dur=3200, probe=["dump:1024"])
    # synced LFO on a low pass cutoff: 1/4 note cycle = 0.5 s = 24000 samples at 120 bpm; log curve, +-0.3 of the range (x 0.17 .. x 6)
    out.append(c("mv_lfo_sync", slots=[vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, div=8))})], **mvc))
    out.append(c("mv_static", slots=[vec({"filt": dict(lp)})], **mvc))
    # a different division (1/2 note, 48000 samples) must give a different, matching period
    out.append(c("mv_lfo_half", slots=[vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, div=11))})], stim="noise", arm=ARMM, dur=4800, probe=["dump:1024"]))
    # free running 2 Hz (period 24000 samples), ignores the host beat
    out.append(c("mv_lfo_free", slots=[vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, sync=0, hz=2.0))})], **mvc))
    # transport stops at 1100 ms: the synced LFO holds, the free one keeps running
    out.append(c("mv_stop_sync", slots=[vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, div=8))})], events=[(1100, "playing 0", "obj-gen")], **mvc))
    out.append(c("mv_stop_free", slots=[vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, sync=0, hz=2.0))})], events=[(1100, "playing 0", "obj-gen")], **mvc))
    # host position jump to beat 100.25: the synced LFO follows the ppq (a quarter cycle shifts the phase)
    out.append(c("mv_ppq", slots=[vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, div=8))})], events=[(1500, "ppq 100.25", "obj-gen")], **mvc))
    # the module (and its movement) switches on at 900 ms, after the rate parameter has glided from its default: the synced LFO must still sit on the
    # host grid (phase = beat * cycles per beat, no offset left over from the smoothing glide)
    out.append(c("mv_late_on", slots=[vec({}), vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, div=8))})], weights=[1, 0], events=[(900, weights_msg([0, 1]))], **mvc))
    # Steps on a gain: 4 distinct levels on 1/8 note boundaries (12000 samples); gain -12..+6 dB, depth 0.5 around 0 dB (norm 0.667)
    stp = [1, -1, 0.5, -0.5, 1, -1, 0.5, -0.5]
    out.append(c("mv_steps", slots=[vec({"wid": {"wet": 1, "width": 1, "gain": 0, **mv("wid", 2, "gain", 0.5, div=5, steps=stp)}})], stim="noise", arm=ARMM, dur=3200, probe=["dump:128"]))
    # Steps with glide: the same pattern ramps instead of jumping
    out.append(c("mv_steps_glide", slots=[vec({"wid": {"wet": 1, "width": 1, "gain": 0, **mv("wid", 2, "gain", 0.5, div=5, steps=stp, glide=1.0)}})], stim="noise", arm=ARMM, dur=3200, probe=["dump:128"]))
    # Envelope follower on the gain: loud / quiet noise (x10), positive depth widens the contrast, negative narrows it
    envm = dict(stim="levels", arm=ARMM, dur=3000, probe=["dump:1024"])
    out.append(c("mv_env_pos", slots=[vec({"wid": {"wet": 1, "width": 1, "gain": -12, **mv("wid", 3, "gain", 1.0, atk=5, rel=50)}})], **envm))
    out.append(c("mv_env_neg", slots=[vec({"wid": {"wet": 1, "width": 1, "gain": 6, **mv("wid", 3, "gain", -1.0, atk=5, rel=50)}})], **envm))
    out.append(c("mv_env_off", slots=[vec({"wid": {"wet": 1, "width": 1, "gain": -3}})], **envm))
    # morph between slots with different movement, and between a moving and a still slot: no clicks
    la = vec({"filt": dict(lp, cutoff=2000, **mv("filt", 1, "cutoff", 0.3, div=8))})
    lb = vec({"filt": dict(lp, cutoff=2000, **mv("filt", 2, "cutoff", 0.4, div=5, steps=stp, glide=0.3))})
    lc = vec({"filt": dict(lp, cutoff=2000)})
    out.append(c("mv_morph", stim="sine", dur=3200, slots=[la, lb], weights=[1, 0], events=ramp_events([1, 0], [0, 1], 900, 2100, 24)))
    out.append(c("mv_morph_off", stim="sine", dur=3200, slots=[la, lc], weights=[1, 0], events=ramp_events([1, 0], [0, 1], 900, 2100, 24)))
    # a square LFO on the cutoff (the hardest case for the per-param smoothing): the level edges survive
    out.append(c("mv_square", slots=[vec({"filt": dict(lp, **mv("filt", 1, "cutoff", 0.3, div=8, shape=4))})], stim="sine1k", arm=ARMM, dur=3200, probe=["dump:128"]))
    # movement on drive, filter, crush, stutter, a spectral param, delay and reverb at once (they run and stay finite)
    out.append(c("mv_many", stim="mix", dur=3000, slots=[vec({
        "drvA": {"wet": 0.6, "mode": 0, "drive": 12, **mv("drvA", 1, "drive", 0.4, div=8)},
        "filt": {"wet": 0.6, "type": 1, "cutoff": 1500, "res": 0.5, **mv("filt", 2, "cutoff", 0.4, div=5, steps=stp)},
        "crush": {"wet": 0.5, "bits": 6, "rate": 4, **mv("crush", 3, "bits", 0.5)},
        "stut": {"wet": 0.5, "div": 4, "prob": 0.7, "decay": 0.3, **mv("stut", 1, "decay", 0.4, div=11, shape=2)},
        "spec": {"wet": 1, "smr_amt": 0.5, "smr_blur": 0.4, "cc_amt": 0.5, "cc_coeffs": 0.4, **mv("spec", 1, "smr_blur", 0.4, div=8)},
        "dly": {"wet": 0.4, "div": 4, "fb": 0.5, **mv("dly", 1, "fb", 0.3, div=11)},
        "rev": {"wet": 0.4, "size": 0.7, "decay": 0.7, **mv("rev", 1, "decay", 0.3, div=13)},
    })]))

    # ---- everything on at once ----
    allmods = {
        "drvA": {"wet": 0.6, "mode": 1, "drive": 12, "tone": 12000}, "filt": {"wet": 0.6, "type": 1, "cutoff": 1500, "res": 0.6},
        "form": {"wet": 0.6, "vowel": 1.5, "shift": 3, "res": 0.7}, "comb": {"wet": 0.5, "freq": 330, "fb": 0.7, "damp": 8000},
        "phas": {"wet": 0.7, "stages": 3, "sync": 1, "hz": 2, "div": 2, "depth": 1, "fb": 0.5}, "crush": {"wet": 0.5, "bits": 6, "rate": 4, "jitter": 0.5},
        "rect": {"wet": 0.5, "mode": 2, "blend": 0.7}, "fm": {"wet": 0.5, "mode": 0, "ratio": 3, "index": 0.5},
        "corr": {"wet": 0.6, "div": 2, "chance": 0.8, "flips": 0.7, "wrap": 0.4, "drop": 0.3}, "ring": {"wet": 0.4, "mode": 1, "freq": 150},
        "stut": {"wet": 0.6, "div": 3, "prob": 0.7, "decay": 0.3}, "time": {"wet": 0.5, "mode": 2, "amt": 0.5, "div": 4},
        "gpit": {"wet": 0.6, "pitch": 7, "size": 60, "jitter": 0.5}, "gstr": {"wet": 0.6, "speed": 0.3, "size": 150, "spread": 0.5},
        "rvs": {"wet": 0.6, "div": 3, "chance": 0.7}, "shuf": {"wet": 0.6, "slices": 2, "span": 1, "chance": 0.7, "seed": 5},
        "chop": {"wet": 0.6, "pattern": 0xF0F0, "div": 2, "smooth": 0.3},
        "spec": {"wet": 1, "frz_amt": 0.3, "frz_rate": 1, "smr_amt": 0.5, "smr_blur": 0.5, "cc_amt": 0.6, "cc_coeffs": 0.3, "cc_bits": 8, "sc_amt": 0.5, "sc_mode": 2,
                 "sct_amt": 0.5, "sct_w": 6, "sct_rate": 4, "mir_amt": 0.5, "mir_pivot": 1200, "bsh_amt": 0.5, "bsh_bins": -7, "sgl_amt": 0.5, "sgl_mode": 0, "sgl_k": 24, "sgl_step": 9},
        "drvB": {"wet": 0.5, "mode": 3, "drive": 10, "tone": 9000}, "dly": {"wet": 0.5, "div": 4, "fb": 0.6, "pp": 0.7, "damp": 5000},
        "slap": {"wet": 0.5, "time": 100, "tone": 6000, "offset": 0.6}, "rev": {"wet": 0.4, "size": 0.7, "decay": 0.7, "damp": 6000, "void": 0.3},
        "wid": {"wet": 1, "width": 1.5, "gain": 3},
    }
    out.append(one("stress_all", allmods, stim="mix", dur=3000))
    typical_new = {k: allmods[k] for k in ("form", "phas", "rect", "gpit", "shuf", "slap")}
    out.append(c("cpu_idle", stim="mix", dur=2500, cpu=True))  # no module on: the cost of the engine itself (slot blend, clocks, telemetry)
    out.append(one("cpu6_new", typical_new, stim="mix", dur=2500, cpu=True))
    out.append(one("cpu_all", allmods, stim="mix", dur=2500, cpu=True))
    # six modules WITH movement (LFO / Steps / Env mixed): the cost of the movement engine on top of cpu6
    six_mv = {k: dict(v) for k, v in six.items()}
    six_mv["drvA"].update(mv("drvA", 1, "drive", 0.4, div=8))
    six_mv["filt"].update(mv("filt", 2, "cutoff", 0.4, div=5, steps=stp))
    six_mv["crush"].update(mv("crush", 3, "bits", 0.5))
    six_mv["stut"].update(mv("stut", 1, "decay", 0.4, div=11, shape=2))
    six_mv["dly"].update(mv("dly", 1, "fb", 0.3, div=11))
    six_mv["rev"].update(mv("rev", 1, "decay", 0.3, div=13))
    out.append(one("cpu6_move", six_mv, stim="mix", dur=2500, cpu=True))
    return out


def run_case(code, case):
    boxes, lines, events = build_device(code, case)
    mode = "audio_device" if case.get("cpu") else ("stepped" if events else "nrt")
    return mh.run_case(f"glitch_{case['name']}", boxes, lines, probe_js=PROBE_JS,
                       probe_args=" ".join([case["stim"], str(LATENCY), str(WOFF), str(SQOFF)] + SC_ARGS + case.get("probe", []) + [str(x) for x in case.get("lags", [])]),
                       settle_ms=case["arm"], dur_ms=case["dur"], channels=4, sr=SR, mode=mode, events=events or None, timeout=240)


# --------------------------------------------------------------------------- checks
FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print("  FAIL: " + msg)
    return cond


def checks(name, r):
    check(r.get("error", 0) == 0, f"{name}: probe error")
    check(r["nan"] == 0, f"{name}: NaN/Inf samples {r['nan']}")
    check(r["peak"] <= 1.0 + 1e-6, f"{name}: peak {r['peak']:.3f} > 1")
    d2_ok = lambda lim: check(r["maxd2"] <= lim * max(r["maxd2in"], 0.01), f"{name}: click, max d2 {r['maxd2']:.4f} vs input {r['maxd2in']:.4f}")
    if name == "neutral":
        check(r["lag"] == LATENCY, f"neutral: lag {r['lag']} != {LATENCY}")
        check(r["errdb"] < -120, f"neutral: errdb {r['errdb']:.1f} (want exact identity)")
        check(r["maxerr"] < 1e-6, f"neutral: maxerr {r['maxerr']:.2e}")
        check(r["scFrame"] > 10, "neutral: telemetry frame counter moves")
        check(r["scSpecRun"] == 0, "neutral: STFT idles")
    elif name == "silence":
        check(r["peak"] == 0.0 and r["nonzero"] == 0, f"silence: peak {r['peak']} nonzero {r['nonzero']}")
    elif name == "drive":
        check(r["nonfunddb"] > -35, f"drive: harmonics {r['nonfunddb']:.1f} dB (want > -35)")
        check(r["gaindb"] > -12 and r["gaindb"] < 6, f"drive: level {r['gaindb']:.1f} dB")
    elif name == "drive_b":
        check(r["nonfunddb"] > -35, f"drive_b: harmonics {r['nonfunddb']:.1f} dB")
    elif name == "filter_lp":
        check(r["bout4"] - r["bin4"] < -25 and r["bout3"] - r["bin3"] < -15, f"filter_lp: high bands {r['bout4']-r['bin4']:.1f}/{r['bout3']-r['bin3']:.1f} dB")
        check(abs(r["bout0"] - r["bin0"]) < 4, f"filter_lp: low band kept ({r['bout0']-r['bin0']:.1f} dB)")
    elif name == "filter_hp":
        check(r["bout0"] - r["bin0"] < -25 and r["bout1"] - r["bin1"] < -15, f"filter_hp: low bands {r['bout0']-r['bin0']:.1f}/{r['bout1']-r['bin1']:.1f} dB")
        check(abs(r["bout4"] - r["bin4"]) < 4, f"filter_hp: high band kept ({r['bout4']-r['bin4']:.1f} dB)")
    elif name == "filter_bp":
        check(r["bout4"] - r["bin4"] < -15 and r["bout0"] - r["bin0"] < -10, f"filter_bp: band {r['bout0']-r['bin0']:.1f}/{r['bout4']-r['bin4']:.1f}")
    elif name == "crush":
        check(r["errdb"] > -30, f"crush: changes the signal (errdb {r['errdb']:.1f})")
        check(r["nonfunddb"] > -35, f"crush: adds distortion ({r['nonfunddb']:.1f})")
    elif name == "ring_shift":
        check(abs(r["peakhz"] - 1300) < 12, f"ring_shift: peak at {r['peakhz']:.1f} Hz (want 1300)")
        check(r["pk1000"] - r["pi1000"] < -25, f"ring_shift: original 1000 Hz down {r['pk1000']-r['pi1000']:.1f} dB")
    elif name == "ring_mod":
        check(r["pk700"] > r["pi1000"] - 10 and r["pk1300"] > r["pi1000"] - 10, f"ring_mod: sidebands {r['pk700']:.1f}/{r['pk1300']:.1f} vs {r['pi1000']:.1f}")
        check(r["pk1000"] - r["pi1000"] < -20, f"ring_mod: carrier suppressed {r['pk1000']-r['pi1000']:.1f} dB")
    elif name == "stutter":
        check(r["ac0"] > 0.9, f"stutter: output repeats at one beat length (corr {r['ac0']:.2f})")
        check(r["xc0"] < 0.5, f"stutter: not just the delayed input (xc {r['xc0']:.2f})")
    elif name == "tapestop":
        check(r["blockmin"] < 0.3 * r["blockmax"], f"tapestop: level dips ({r['blockmin']:.3f}/{r['blockmax']:.3f})")
    elif name == "varispeed":
        check(r["errdb"] > -20 and r["nonfunddb"] > -45, f"varispeed: pitch wobble (errdb {r['errdb']:.1f}, nonfund {r['nonfunddb']:.1f})")
    elif name == "reverse":
        check(r["errdb"] > -6, f"reverse: changes the signal (errdb {r['errdb']:.1f})")
        check(r["outrms"] > 0.3 * r["inrms"] and r["outrms"] < 2 * r["inrms"], f"reverse: level {r['outrms']:.3f} vs {r['inrms']:.3f}")
    elif name == "chopper":
        check(r["blockmin"] < 0.1 * r["blockmax"], f"chopper: gate depth ({r['blockmin']:.4f}/{r['blockmax']:.4f})")
    elif name == "freeze":
        check(r["pk1320"] - r["pi1320"] < -15, f"freeze: 1320 Hz suppressed {r['pk1320']-r['pi1320']:.1f} dB")
        check(r["scSpecRun"] == 1 or r["scSpecFrames"] > 50, "freeze: STFT ran")
    elif name == "smear":
        check(r["activefrac"] > 3 * r["activefracin"] and r["activefrac"] > 0.3, f"smear: clicks are smeared in time (active blocks {r['activefrac']:.2f} vs {r['activefracin']:.2f})")
    elif name in ("ccrush", "scramble"):
        check(r["errdb"] > -15, f"{name}: changes the signal (errdb {r['errdb']:.1f})")
        check(abs(r["gaindb"]) < 6, f"{name}: level {r['gaindb']:.1f} dB")
    elif name == "spec_latency":
        check(r["lag"] == LATENCY, f"spec_latency: lag {r['lag']} != {LATENCY}")
        check(r["errdb"] < -35, f"spec_latency: STFT path is transparent at the same latency (errdb {r['errdb']:.1f})")
    elif name == "delay":
        check(r["xc0"] > 0.4, f"delay: echo at one beat (corr {r['xc0']:.2f})")
    elif name == "delay_pp":
        check(r["win1"] > 1e-3 and r["win2"] > 1e-4, f"delay_pp: echoes after the burst ({r['win1']:.4f}/{r['win2']:.4f})")
    elif name == "reverb":
        check(r["win1"] > 1e-3, f"reverb: tail {r['win1']:.5f}")
    elif name == "reverb_void":
        check(r["win2"] > r["win1"] * 0.3 and r["win2"] > 2e-3, f"reverb_void: long tail ({r['win1']:.4f}/{r['win2']:.4f})")
    elif name == "width_gain":
        check(abs(r["gaindb"] - 6.02) < 0.3, f"width_gain: {r['gaindb']:.2f} dB (want +6)")
    elif name == "limiter":
        check(r["peak"] <= 1.0, f"limiter: peak {r['peak']:.3f}")
    elif name in ("xy_morph", "xy_morph_empty"):
        d2_ok(4.0)
        check(r["maxstep"] < 0.8, f"{name}: step {r['maxstep']:.3f}")
    elif name == "disc_switch":
        d2_ok(4.0)
    elif name == "telemetry":
        check(r["scFrame"] > 100, f"telemetry: frame counter {r['scFrame']}")
        check(r["scSpecRun"] == 1 and r["scSpecMix"] > 0.9, f"telemetry: spectral running ({r['scSpecRun']}/{r['scSpecMix']})")
        check(r["scActSum"] > 1.5, f"telemetry: module activity {r['scActSum']:.2f}")
        check(r["scBandsIn"] > 1 and r["scBandsOut"] > 1 and r["scCep"] > 0 and r["scWave"] > 0, f"telemetry: bands {r['scBandsIn']:.1f}/{r['scBandsOut']:.1f} cep {r['scCep']:.2f} wave {r['scWave']:.2f}")
        check(abs(r["scW0"] - 1) < 1e-6 and abs(r["scBpm"] - 120) < 1e-3, "telemetry: weights and bpm echo")
        check(r[f"scLvl{POS['spec']}"] > 0 and r[f"scLvl{POS['chop']}"] > 0, "telemetry: module levels")
    elif name == "formant_a":
        check(500 < r["peakhz"] < 1200 and r["bout4"] - r["bin4"] < -12, f"formant_a: peak at {r['peakhz']:.0f} Hz (want 500..1200), highs {r['bout4']-r['bin4']:.1f} dB")
    elif name == "formant_i":
        check(r["peakhz"] < 520 and r["bout4"] - r["bin4"] < -12, f"formant_i: peak at {r['peakhz']:.0f} Hz (want < 520), highs {r['bout4']-r['bin4']:.1f} dB")
    elif name == "comb":
        mult = r["peakhz"] / 480.0
        check(abs(mult - round(mult)) * 480.0 < 20 and round(mult) >= 1, f"comb: peak {r['peakhz']:.1f} Hz is not a multiple of 480")
        check(r["crest"] > 3.0, f"comb: tonal (crest {r['crest']:.2f})")
    elif name == "phaser":
        check(r["errdb"] > -9, f"phaser: changes the signal (errdb {r['errdb']:.1f})")
        check(abs(r["gaindb"]) < 6, f"phaser: level {r['gaindb']:.1f} dB")
    elif name == "rectify_full":
        check(abs(r["peakhz"] - 880) < 12, f"rectify_full: peak at {r['peakhz']:.1f} Hz (want 880)")
        check(r["pk440"] - r["pi440"] < -12, f"rectify_full: fundamental gone ({r['pk440']-r['pi440']:.1f} dB)")
    elif name == "rectify_half":
        check(r["nonfunddb"] > -25, f"rectify_half: harmonics {r['nonfunddb']:.1f} dB")
    elif name == "fm_osc":
        check(r["nonfunddb"] > -20, f"fm_osc: sidebands {r['nonfunddb']:.1f} dB (want > -20)")
    elif name == "fm_self":
        check(r["errdb"] > -10, f"fm_self: changes the signal (errdb {r['errdb']:.1f})")
    elif name == "corrupt":
        check(r["errdb"] > -8, f"corrupt: changes the signal (errdb {r['errdb']:.1f})")
        check(r["nonfunddb"] > -25, f"corrupt: broadband damage {r['nonfunddb']:.1f} dB")
    elif name == "corrupt_off":
        check(r["lag"] == LATENCY and r["errdb"] < -120, f"corrupt_off: Chance 0 is the identity (lag {r['lag']}, errdb {r['errdb']:.1f})")
    elif name == "gpitch_up":
        check(abs(r["peakhz"] - 880) < 15, f"gpitch_up: peak at {r['peakhz']:.1f} Hz (want 880)")
        check(r["pk440"] - r["pi440"] < -10 and -9 < r["gaindb"] < 3, f"gpitch_up: 440 Hz down {r['pk440']-r['pi440']:.1f} dB, level {r['gaindb']:.1f} dB")
    elif name == "gpitch_down":
        check(abs(r["peakhz"] - 220) < 12, f"gpitch_down: peak at {r['peakhz']:.1f} Hz (want 220)")
        check(-9 < r["gaindb"] < 3, f"gpitch_down: level {r['gaindb']:.1f} dB")
    elif name == "gstretch":
        check(abs(r["peakhz"] - 440) < 12 and -9 < r["gaindb"] < 3, f"gstretch: pitch kept ({r['peakhz']:.1f} Hz), level {r['gaindb']:.1f} dB")
    elif name == "gstretch_freeze":
        check(r["pk1320"] - r["pi1320"] < -15, f"gstretch_freeze: 1320 Hz suppressed {r['pk1320']-r['pi1320']:.1f} dB (the freeze holds the 440 Hz grain)")
        check(r["rmsB"] > 0.02, f"gstretch_freeze: still sounding ({r['rmsB']:.4f})")
    elif name == "revslice":
        lo = min(r[k] for k in r if k.startswith("x_rev"))
        sh = sorted(set(int(r[k]) for k in r if k.startswith("xd_rev")))
        print(f"  revslice: best correlation shifts {sh} samples")
        check(lo > 0.8, f"revslice: output slices are the reversed previous slices (min corr {lo:.2f})")
    elif name == "shuffle":
        ks = [k for k in r if k.startswith("x_shuf")]
        sh = sorted(set(int(r[k]) for k in r if k.startswith("xd_shuf")))
        print(f"  shuffle: best correlation shifts {sh} samples")
        check(len(ks) == 12 and min(r[k] for k in ks) > 0.8, f"shuffle: slices are the seeded permutation of the previous span (min corr {min(r[k] for k in ks):.2f})")
    elif name == "slapback":
        check(r["xc0"] > 0.4, f"slapback: echo at 90 ms (corr {r['xc0']:.2f})")
    elif name == "scatter":
        check(r["pk1000"] - r["pi1000"] < -10, f"scatter: 1 kHz moved away ({r['pk1000']-r['pi1000']:.1f} dB)")
    elif name == "mirror":
        check(abs(r["peakhz"] - 2000) < 80, f"mirror: 1 kHz reflected around 1.5 kHz to {r['peakhz']:.0f} Hz")
    elif name == "binshift":
        check(abs(r["peakhz"] - 1750) < 80, f"binshift: 1 kHz + 16 bins to {r['peakhz']:.0f} Hz (want 1750)")
    elif name == "specgate_topk":
        check(r["bout3"] - r["bin3"] < -10 and abs(r["pk440"] - r["pi440"]) < 4, f"specgate_topk: noise floor {r['bout3']-r['bin3']:.1f} dB, 440 Hz kept ({r['pk440']-r['pi440']:.1f} dB)")
    elif name == "specgate_lofi":
        check(r["errdb"] > -12 and abs(r["gaindb"]) < 8, f"specgate_lofi: quantized magnitudes (errdb {r['errdb']:.1f}, level {r['gaindb']:.1f} dB)")
    elif name == "stress_all":
        check(r["peak"] <= 1.0 and r["nan"] == 0, f"stress_all: bounded and finite (peak {r['peak']:.3f}, nan {r['nan']})")
        check(r["peak"] > 0.01, "stress_all: sounds")
    elif name in ("seq_steps", "seq_hold", "seq_stop", "seq_ppq", "seq_glide", "seq_empty"):
        seq_checks(name, r)
    elif name.startswith("mv_"):
        mv_checks(name, r)
    elif name in ("cpu_idle", "cpu6", "cpu6_new", "cpu_all", "cpu6_move"):
        check(r["cpuMax"] > 0, f"{name}: cpu measured")
        check(r["cpuMax"] < (95 if name == "cpu_all" else 70), f"{name}: audio CPU {r['cpuMax']:.1f} % (avg {r['cpuAvg']:.1f})")
        print(f"  CPU {name}: max {r['cpuMax']:.1f} % avg {r['cpuAvg']:.1f} %")
    elif name == "six_nrt":
        check(r["peak"] <= 1.0, "six_nrt: bounded")




# --------------------------------------------------------------------------- sequencer analysis
SL = SR // 4  # one step at 120 bpm, 1/8 note
ARM_SAMPLES = SR * 750 // 1000


def envelope(r):
    out = []
    while f"e{len(out)}" in r:
        out.append(r[f"e{len(out)}"])
    return out


def lvl(e, blk, a, b):
    i0, i1 = max(0, int(a // blk)), min(len(e), int(b // blk))
    return sum(e[i0:i1]) / max(1, i1 - i0)


def onset(e, blk, b, pre, post):
    """Sample offset (relative to boundary b) of the first block that crosses the midpoint between the old and new level."""
    mid = (pre + post) / 2.0
    up = post > pre
    for i in range(max(0, int((b - 3000) // blk)), min(len(e), int((b + 6000) // blk))):
        if (e[i] > mid) == up and abs(e[i] - pre) > abs(e[i] - post):
            return i * blk - b
    return None


def seq_checks(name, r):
    blk = 256 if name == "seq_glide" else 128
    e = envelope(r)
    if name == "seq_empty":
        check(r["lag"] == LATENCY and r["errdb"] < -120, f"seq_empty: an empty sequence is the dry sound (lag {r['lag']}, errdb {r['errdb']:.1f})")
        return
    check(len(e) > 100, f"{name}: envelope dump")
    if name == "seq_glide":
        check(r["maxd2"] <= 4.0 * max(r["maxd2in"], 0.01), f"seq_glide: click, max d2 {r['maxd2']:.4f} vs input {r['maxd2in']:.4f}")
        # block rms of a 440 Hz sine ripples by a few percent; a 4-block mean shows the ramp (the gain is blended in dB: about 0.01 per block at the start of a 12 dB glide, a hard step would be 0.26)
        sm = [sum(e[i:i + 4]) / 4 for i in range(len(e) - 4)]
        steps = [abs(sm[i + 1] - sm[i]) for i in range(len(sm) - 1) if i * blk > 2000]
        check(max(steps) < 0.02, f"seq_glide: smooth level, max smoothed block step {max(steps):.4f}")
        hi, lo = lvl(e, blk, SL * 3 + 200, SL * 3 + 1200), lvl(e, blk, SL * 4 - 1200, SL * 4 - 200)
        mid = lvl(e, blk, SL * 3 + 5500, SL * 3 + 6500)
        check(lo < mid < hi or hi < mid < lo, f"seq_glide: halfway through the step the level is between the two slots ({hi:.3f} / {mid:.3f} / {lo:.3f})")
        return
    # boundaries k * SL in window samples (the window starts exactly on a step boundary: arm 750 ms = 3 steps)
    plan = {
        "seq_steps": {k: True for k in range(1, 9)},
        "seq_hold": {k: (k % 2 == 1) for k in range(1, 8)},
    }.get(name)
    if plan:
        for k, change in plan.items():
            b = k * SL
            pre, post = lvl(e, blk, b - 3000, b - 400), lvl(e, blk, b + 2500, b + 3500)
            if change:
                ratio = max(pre, post) / max(min(pre, post), 1e-9)
                check(ratio > 2.5, f"{name}: boundary {k} changes the level (x{ratio:.2f})")
                on = onset(e, blk, b, pre, post)
                check(on is not None and -256 <= on <= 1500, f"{name}: boundary {k} onset {on} samples after the step boundary (want -256..1500)")
                early = max(abs(x - pre) / pre for x in e[int((b - 3000) // blk):int((b - 300) // blk)])
                check(early < 0.3, f"{name}: boundary {k} nothing happens before the boundary (dev {early:.2f})")
            else:
                check(abs(post - pre) / pre < 0.15, f"{name}: boundary {k} holds the slot ({pre:.4f} -> {post:.4f})")
    if name == "seq_steps":
        check(r["scSeqOn"] == 1 and r["scSeqPlay"] == 1, "seq_steps: telemetry on / playing")
        check(r["scSeqSlot"] in (0, 1) and r["scSeqPrev"] in (0, 1) and r["scSeqCount"] > 10, f"seq_steps: telemetry slot {r['scSeqSlot']} prev {r['scSeqPrev']} count {r['scSeqCount']}")
        check(abs(r["scW0"] + r["scW1"] - 1) < 1e-4, "seq_steps: weights telemetry")
    if name == "seq_stop":
        w0 = 1100 * SR // 1000 - ARM_SAMPLES  # 'playing 0' lands here
        ref = lvl(e, blk, w0 - 2500, w0 - 300)
        for a in range(w0 + 1500, len(e) * blk - 12000, 12000):
            v = lvl(e, blk, a, a + 10000)
            check(abs(v - ref) / ref < 0.12, f"seq_stop: step held after the transport stops (window {a}: {v:.4f} vs {ref:.4f})")
        check(r["scSeqPlay"] == 0, "seq_stop: telemetry reports the stopped transport")
    if name == "seq_ppq":
        w0 = 1100 * SR // 1000 - ARM_SAMPLES
        a_lvl, b_lvl = lvl(e, blk, w0 - 3000, w0 - 300), lvl(e, blk, w0 + 1500, w0 + 9000)
        check(a_lvl / b_lvl > 2.5, f"seq_ppq: the ppq jump to step 1 switches to slot B (A {a_lvl:.4f}, B {b_lvl:.4f})")
        on = onset(e, blk, w0, a_lvl, b_lvl)
        check(on is not None and -256 <= on <= 1500, f"seq_ppq: the switch starts at the jump ({on} samples)")
        b2 = w0 + SL  # the next boundary follows the new clock (one step after the jump)
        a2 = lvl(e, blk, b2 + 2500, b2 + 3500)
        check(a2 / b_lvl > 2.5, f"seq_ppq: next boundary one step after the jump (B {b_lvl:.4f} -> A {a2:.4f})")
        on2 = onset(e, blk, b2, b_lvl, a2)
        check(on2 is not None and -256 <= on2 <= 1500, f"seq_ppq: next boundary onset {on2}")


# --------------------------------------------------------------------------- movement analysis
def smooth3(e):
    return [sum(e[max(0, i - 1):i + 2]) / len(e[max(0, i - 1):i + 2]) for i in range(len(e))]


def crossings(e, blk, t0_samples=0):
    """Upward crossings (sample positions, window time) of the midpoint between the extremes of the smoothed envelope."""
    sm = smooth3(e)
    mid = (max(sm) + min(sm)) / 2.0
    out = []
    for i in range(1, len(sm)):
        if sm[i - 1] < mid <= sm[i]:
            out.append(t0_samples + (i - 1 + (mid - sm[i - 1]) / max(sm[i] - sm[i - 1], 1e-12) + 0.5) * blk)
    return out


def swing(e, a=0, b=None):
    sm = smooth3(e)[a:b]
    return max(sm) / max(min(sm), 1e-9)


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2]


def circ_mean(ps):
    import cmath
    z = sum(cmath.exp(2j * math.pi * (p - math.floor(p))) for p in ps) / len(ps)
    return (cmath.phase(z) / (2 * math.pi)) % 1.0


def circ_d(a, b):
    d = (a - b) % 1.0
    return min(d, 1.0 - d)


MV_SKEW = 0.07  # beat phase of the level crossings of a synced 1/4 note sine LFO on the cutoff of a low passed noise (measured on mv_lfo_sync)


def mv_checks(name, r):
    arm = ARM_SAMPLES
    e = envelope(r)
    blk = 128 if name in ("mv_steps", "mv_steps_glide", "mv_square") else 1024
    kf = POS["filt"]
    if name in ("mv_morph", "mv_morph_off"):
        check(r["maxd2"] <= 4.0 * max(r["maxd2in"], 0.01), f"{name}: click, max d2 {r['maxd2']:.4f} vs input {r['maxd2in']:.4f}")
        check(r["maxstep"] < 0.8, f"{name}: step {r['maxstep']:.3f}")
        return
    if name == "mv_many":
        check(r["peak"] <= 1.0 and r["nan"] == 0, f"mv_many: bounded and finite (peak {r['peak']:.3f}, nan {r['nan']})")
        check(r["peak"] > 0.01, "mv_many: sounds")
        for inst in ("drvA", "filt", "crush", "stut", "spec", "dly", "rev"):
            check(r[f"scMvOn{POS[inst]}"] == 1, f"mv_many: {inst} movement runs (telemetry)")
        check(r[f"scMvOn{POS['wid']}"] == 0, "mv_many: a module without movement reports none")
        return
    check(len(e) > 20, f"{name}: envelope dump")
    if name == "mv_static":
        # 21 ms blocks of low passed noise fluctuate by itself (x1.3 measured); the moving filter swings x7
        check(swing(e) < 2.0, f"mv_static: no movement, a steady level (swing x{swing(e):.2f})")
        check(r[f"scMvOn{kf}"] == 0, "mv_static: telemetry reports no movement")
        return
    if name in ("mv_lfo_sync", "mv_lfo_free", "mv_lfo_half", "mv_stop_free"):
        want = {"mv_lfo_sync": 24000, "mv_lfo_free": 24000, "mv_lfo_half": 48000, "mv_stop_free": 24000}[name]
        cr = crossings(e, blk)
        if name == "mv_stop_free":
            cr = [c for c in cr if c > 4000]
        check(len(cr) >= 3, f"{name}: {len(cr)} cycles seen")
        if len(cr) >= 3:
            per = median([b - a for a, b in zip(cr, cr[1:])])
            print(f"  {name}: period {per:.0f} samples (want {want}), swing x{swing(e):.1f}")
            check(abs(per - want) / want < 0.02, f"{name}: period {per:.0f} samples, want {want}")
        check(swing(e) > 3.0, f"{name}: the filter sweeps (level swing x{swing(e):.2f})")
        check(r[f"scMvOn{kf}"] == 1 and abs(r[f"scMvOfs{kf}"]) <= 0.3 + 1e-6 and 0 <= r[f"scMvPos{kf}"] <= 1, f"{name}: telemetry on={r[f'scMvOn{kf}']} ofs={r[f'scMvOfs{kf}']:.3f} pos={r[f'scMvPos{kf}']:.3f}")
        if name == "mv_lfo_sync":
            bp = circ_mean([((c + arm - LATENCY) / SR) * 2.0 for c in cr])
            print(f"  mv_lfo_sync: beat phase of the level crossings {bp:.3f}")
            check(circ_d(bp, MV_SKEW) < 0.05, f"mv_lfo_sync: absolute beat lock, crossing beat phase {bp:.3f} vs {MV_SKEW}")
        if name == "mv_stop_free":
            check(r["scSeqPlay"] == 0, "mv_stop_free: the transport is stopped")
        return
    if name == "mv_late_on":
        on = 900 * SR // 1000 - arm
        i0 = int((on + 6000) // blk)
        cr = crossings(e[i0:], blk, i0 * blk)  # only the part after the switch-on (the dry noise before it would dominate the extremes)
        check(len(cr) >= 3, f"mv_late_on: {len(cr)} crossings after the switch-on")
        if len(cr) >= 3:
            bp = circ_mean([((c + arm - LATENCY) / SR) * 2.0 for c in cr])
            print(f"  mv_late_on: beat phase of the level crossings after a late switch-on {bp:.3f} (on the grid = {MV_SKEW})")
            check(circ_d(bp, MV_SKEW) < 0.05, f"mv_late_on: locked to the host grid after a late switch-on (beat phase {bp:.3f} vs {MV_SKEW})")
        return
    if name == "mv_stop_sync":
        w0 = 1100 * SR // 1000 - arm
        i0 = int((w0 + 3000) // blk)
        after = swing(e, i0)
        before = swing(e, 0, int(w0 // blk))
        check(after < 1.15, f"mv_stop_sync: the synced LFO holds while the transport is stopped (level swing after the stop x{after:.3f}, before x{before:.2f})")
        check(r["scSeqPlay"] == 0, "mv_stop_sync: the transport is stopped")
        return
    if name == "mv_ppq":
        # the host jumps to beat 100.25 at 1500 ms: afterwards the synced LFO is locked to that position, so the beat phase of its
        # upward level crossings is the same as before the jump (a free-running phase would be a quarter beat off)
        jump = 1500 * SR // 1000 - arm
        cr = crossings(e, blk)

        def beat_of(c):
            t = (c + arm - LATENCY) / SR  # when the movement happened (the output lags by the fixed latency)
            return t * 2.0 if c < jump else 100.25 + (t - 1.5) * 2.0

        pre = [beat_of(c) for c in cr if 3000 < c < jump - 3000]
        post = [beat_of(c) for c in cr if c > jump + 6000]
        check(len(pre) >= 1 and len(post) >= 3, f"mv_ppq: crossings before {len(pre)} / after {len(post)}")
        if pre and len(post) >= 3:
            dp, dq = circ_mean(pre), circ_mean(post)
            print(f"  mv_ppq: beat phase of the crossings: before {dp:.3f}, after {dq:.3f} (a free-running phase would give {(dp - 0.25) % 1.0:.3f})")
            check(circ_d(dp, dq) < 0.08, f"mv_ppq: the LFO follows the host position (beat phase {dp:.3f} -> {dq:.3f})")
            check(circ_d(dq, (dp - 0.25) % 1.0) > 0.12, "mv_ppq: it is not the free-running phase")
        return
    if name in ("mv_steps", "mv_steps_glide"):
        stp = [1, -1, 0.5, -0.5, 1, -1, 0.5, -0.5]
        gain = lambda sv: -12 + 18 * min(max(2.0 / 3.0 + 0.5 * sv, 0.0), 1.0)
        # window starts on step boundary x = 3 (beat 1.5 at 1/8 steps of 0.5 beat)
        nsteps = min(11, len(e) * blk // SL - 1)
        levels = []
        for k in range(nsteps):
            a = k * SL + (4000 if name == "mv_steps" else 6000)
            levels.append(lvl(e, blk, a, a + (SL - 4000 - 500 if name == "mv_steps" else 1500)))
        if name == "mv_steps_glide":
            # 16-block moving average (2048 samples) of the 128-sample noise rms: a 15 dB ramp over 94 blocks moves it about 2 % per block, a hard
            # 9 dB step would move it more than 10 % per block
            sm = [sum(e[i:i + 16]) / 16 for i in range(len(e) - 16)]
            stepsz = max(abs(sm[i + 1] - sm[i]) / max(sm[i], 1e-9) for i in range(len(sm) - 1) if i * blk > 2000)
            check(stepsz < 0.06, f"mv_steps_glide: the ramp is smooth, largest relative smoothed block step {stepsz:.3f}")
            return
        for k in range(nsteps):
            want = gain(stp[(3 + k) % 8]) - gain(stp[3 % 8])
            got = 20 * math.log10(levels[k] / levels[0])
            check(abs(got - want) < 1.2, f"mv_steps: step {k} (value {stp[(3 + k) % 8]}) is {got:.2f} dB vs step 0, want {want:.2f}")
        for k in range(1, nsteps):
            b = k * SL
            pre, post = lvl(e, blk, b - 3000, b - 400), lvl(e, blk, b + 2500, b + 3500)
            on = onset(e, blk, b, pre, post)
            check(on is not None and -256 <= on <= 1500, f"mv_steps: boundary {k} changes the level {on} samples after the step boundary (want -256..1500)")
            early = max(abs(x - pre) / pre for x in e[int((b - 3000) // blk):int((b - 300) // blk)])
            check(early < 0.3, f"mv_steps: boundary {k} nothing before it (dev {early:.2f})")
        return
    if name == "mv_square":
        sm = e
        lo, hi = min(sm), max(sm)
        mid = [x for x in sm if lo + 0.2 * (hi - lo) < x < lo + 0.8 * (hi - lo)]
        check(hi / max(lo, 1e-9) > 3.0, f"mv_square: swing x{hi / max(lo, 1e-9):.2f}")
        check(len(mid) / len(sm) < 0.12, f"mv_square: edges stay sharp ({len(mid)}/{len(sm)} blocks between the two levels; a 1 kHz sine, the cutoff jumps between x0.5 and x2 of it)")
        return
    if name.startswith("mv_env"):
        # segments of the 'levels' stimulus: loud 0.75..1.5 s, quiet 1.5..2.25 s, loud 2.25..3.0 s, quiet 3.0..3.75 s (window starts at 0.75 s)
        def seg(a_s, b_s):
            return lvl(e, blk, a_s * SR - arm + 0.2 * SR, b_s * SR - arm - 0.15 * SR)
        loud = (seg(0.75, 1.5) + seg(2.25, 3.0)) / 2
        quiet = seg(1.5, 2.25)
        con = 20 * math.log10(loud / max(quiet, 1e-9))
        print(f"  {name}: loud / quiet contrast {con:.1f} dB")
        want = {"mv_env_off": 20.0, "mv_env_pos": 26.2, "mv_env_neg": 13.8}[name]
        check(abs(con - want) < 2.0, f"{name}: contrast {con:.1f} dB, want {want:.1f} (the follower moves the gain with the input level)")
        if name != "mv_env_off":
            check(r[f"scMvOn{POS['wid']}"] == 1, f"{name}: telemetry reports the follower")
        return


def print_case(case, r):
    keys = ["lag", "errdb", "gaindb", "peak", "nan", "maxd2", "maxd2in", "peakhz", "nonfunddb", "xc0", "ac0", "blockmin", "blockmax", "win1", "win2", "crest", "activefrac", "cpuMax", "scSpecRun", "scFrame"]
    parts = [f"{k} {r[k]:.4g}" for k in keys if k in r]
    print(f"--- {case['name']} ({r.get('harness_wall_s', 0):.1f}s) ---\n  " + " ".join(parts))


def compile_time():
    """Gen compile time: harness wall time of the Glitch core minus a trivial pass-through gen."""
    triv = {"name": "trivial", "stim": "sine", "arm": 300, "dur": 400, "lags": [], "events": [], "slots": [], "weights": [1], "params": "bpm 120"}
    walls = {}
    for label, code in (("trivial", "out1 = in1;\nout2 = in2;\n"), ("glitch", GEN)):
        ws = []
        for _ in range(2):
            r = run_case(code, dict(triv, name="compile_" + label))
            ws.append(r["harness_wall_s"])
        walls[label] = min(ws)
    print(f"compile: trivial gen {walls['trivial']:.1f}s, glitch gen {walls['glitch']:.1f}s -> gen compile about {walls['glitch'] - walls['trivial']:.1f}s")
    return walls


def main():
    want = sys.argv[1:]
    allc = cases()
    if want and "compile" not in want:
        allc = [c for c in allc if c["name"] in want]
    elif want:
        allc = [c for c in allc if c["name"] in want]
    if not want or "compile" in want:
        pass
    for case in allc:
        r = run_case(GEN, case)
        print_case(case, r)
        checks(case["name"], r)
    if not want or "compile" in want:
        compile_time()
    if FAILS:
        print(f"\n{len(FAILS)} FAILED:")
        for f in FAILS:
            print("  " + f)
        sys.exit(1)
    print("\nall glitch audio checks passed")


if __name__ == "__main__":
    main()
