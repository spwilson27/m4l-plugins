#!/usr/bin/env python3
"""Render Deviate's gen core through Ableton-bundled Max (shared NonRealTime harness) and verify the contract.

Runs on scripts/max_harness.py (VM only: AGENTS.md 1a / 1b):
    /usr/bin/python3 scripts/run_deviate_audio_tests.py [case ...]        (scripts/vm_deviate.sh audio)
    python3 scripts/run_deviate_audio_tests.py --list                     (case names)
    python3 scripts/run_deviate_audio_tests.py --dry [case ...]           (build every patch + probe, launch nothing; runs on the host)

Python stdlib only. The gen text comes from build_deviate.gen_code() (what the device embeds); the VM has no node, so the generated
dv_hidden text and the IR bank spectra come from build_cache/ (written by the host build).

One patch per case: SOURCE gen -> [spec stage gen ->] Deviate gen (+ a TAP gen) -> record~ rec (3 channels: ch1 out L, ch2 out R, ch3 source L;
a 4th = the Spectral stage's T output for `spec_t`). The TAP gen reads the device's telemetry buffer (scope) every 16 samples and pokes selected
slots into a buffer (one row of TAP_SLOTS per 16 samples), so the probe sees hits, page applies, draws and peaks as time series. The device gen is
wired into the tap gen (an audio cord), which makes the tap run AFTER the device in every 64-sample vector: a telemetry change made at sample
t is seen in the first tap row at or after t + (rest of the vector), i.e. up to 63 + 16 samples late, never early.
The probe (tests/deviate_probe.js, v8, src/deviate_config.js prepended) reduces everything to `key value` lines.

Cases (what each proves; numbers are printed by the run):
  mix0_null        Mix 0 with default metas AND extreme metas: the output is bit-equal to the input delayed 256 samples; no NaN
  neutral_null     Mix 100 with neutral metas (every Value 0, Pitch 50, Range 0): bit-equal to the delayed input in Envelope and Spectral mode
  latency_env      an impulse comes out exactly 256 samples later at unity (Envelope); telemetry LATENCY / SPLIT_MODE
  latency_spec     the same with the Spectral stage loaded and dvsplit 1: 1279 samples
  hit_once         tone bursts at 100 / 110 / 160 ms: exactly 2 hits (the 10 ms one is swallowed), page applied at t0 + 256 - 96
  seed_repro       4 hits, Seed 5: telemetry DRAWS equal dvStep (float32), two hits differ, the same seed twice is identical, Seed 6 differs
  range0_novar     Range 0: every hit draws exactly the Values
  chance0          Chance 0: after the first hit no hit draws (HIT_GATE 0, DRAW_SERIAL stays 1, the draw is kept)
  lock             Lock on two metas: they keep the first draw through hits, the others follow dvStep
  reroll_nohit     two Rerolls (rising edges of dvreroll): REROLL 2, DRAW_SERIAL +2, HITS unchanged, locked metas kept, unlocked change
  midi_hit         dvmtrig (first value = baseline): one MIDI hit, an audio burst inside its lockout is deduped, a later audio hit counts
  meta_<name>      each meta at 100 alone (Ranges 0): the output differs from the delayed dry (the effect is audible), no NaN, bounded
  ring_cap_*       Ring 100: space (reverb + convolver, IR bank loaded), reverb (no IR bank), echo, body, all: the residue is exactly 0 from
                   2.12 s on (2.0 s after the page was applied); levels in between are printed
  gendsp_file      the deferred patches exactly as the device embeds them (minified .gendsp, 4-input main gen, 2-input stage) as file-backed
                   gen~ objects: Spectral null + effects present
  split_sum        Spectral mode, neutral metas: the output nulls against the delayed input (T + B + R = delayed dry) at -inf dB
  spec_t           the Spectral stage alone: a click train over a steady tone, T carries the clicks and little of the tone
  mode_switch      Split Mode toggled mid-ring (default metas, Spectral stage loaded): no NaN, bounded, latency telemetry 256 -> 1279 -> 256
  sleep_silent     silence: exact zeros, ALIVE and FRAMES keep moving, ASLEEP = 1
  fuzz_a / fuzz_b  25 seeds each, extreme draws (Values 100, Ranges 100, Chance, Drift), a hit every 400 ms: no NaN, peak < 4
  arch_*           Architecture (the hidden map the engine writes to ---deviatemap; here the probe writes it, `archmap`), Arch 37 / 417 / 913:
                   arch_neutral (neutral metas = the input delayed exactly), arch_telemetry (telemetry_layout under that map),
                   ring_cap_arch<N> (every meta 100: residue 0 from 2.125 s), fuzz_arch (14 hits, a new Seed and Arch before each:
                   no NaN, peak < 4, the last page follows the last map)
  conv_onset       a burst that starts a new life with IR 6: (output with the IR bank) - (output without it) = 0.7 * wet * (IR 6 * burst) from the
                   first sample (time-domain IR from build_cache/deviate_ir_48000_td.json), i.e. the convolver gets the whole hit
  wipe_rehit       four identical hits 250 ms apart at Ring 10 (the next apply lands a few ms after the end of a life, inside the old wipe window), delay /
                   reverb / slap / comb / chorus / grain on: every hit's response equals the first hit's (no hole punched into a new hit's rings)
  stale_wake       delay on, off, on across three hits in one Ring-100 life: the response after hit 3 equals a run without hit 1 (no residue of hit 1)
  reroll_shorten   a Reroll that shortens Ring while the tail is at 0.4: the Ring envelope telemetry never falls by more than 0.3 per row (no jump to 0)
  mix0_exact       Mix 0 is the delayed dry bit for bit: +12 dBFS input with extreme metas; Mix moved 100 -> 0 mid-run; a signal under the sleep threshold
                   passes through while asleep
  telemetry_layout every slot class of DV_SCOPE: SR, LATENCY, FRAMES, ALIVE, ECHO block = the Params sent, HIDDEN slots =
                   dvHiddenFromMetas of the telemetry metas, waveform ring written, peaks move
"""

import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import max_harness as mh  # noqa: E402

ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "src")
PROBE_SRC = os.path.join(ROOT, "tests", "deviate_probe.js")
SR = 48000
LAT_ENV = 256
LAT_SPEC = 1279
PRE = 96

# slot of the scope buffer -> name in the tap rows (column order; the probe gets the names through `tapnames`)
TAP_SLOTS = [
    ("applied", 38), ("hits", 2), ("serial", 3), ("gate", 39), ("asleep", 7), ("alive", 48), ("frames", 0), ("ringenv", 10),
    ("pkt", 33), ("pkb", 34), ("pkl", 35), ("pkout", 36), ("pkin", 32), ("pkdry", 37), ("lat", 6), ("split", 5), ("onset", 4),
    ("irtag", 11), ("reroll", 8), ("hitsrc", 40), ("specalive", 49), ("trs", 9),
] + [(f"d{i}", 24 + i) for i in range(8)] + [(f"m{i}", 16 + i) for i in range(8)]
TAP_STRIDE = len(TAP_SLOTS)

DEFAULT_V = [30, 50, 30, 20, 30, 20, 20, 10]
DEFAULT_R = [50] * 8
IR_WAV = os.path.join(ROOT, "build_cache", "deviate_ir_48000.wav")
NEUTRAL = ", ".join([f"dvv{i} {v}" for i, v in enumerate([0, 50, 0, 0, 0, 0, 0, 0])] + [f"dvr{i} 0" for i in range(8)])


# ---- python mirror of dvHash / dvStep (src/deviate_config.js); cross-checked by tests/test_deviate_gen.js ------------------
def dv_clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def dv_hash(idx, k, slot):
    m = 67108859
    x = int(idx * 7919 + k * 104729 + slot * 3571 + 12345) % m
    for _ in range(4):
        x = (x * x + 40503) % m
    return x / m


def dv_new_state():
    return {"valid": 0, "hits": 0, "reroll": 0, "serial": 0, "gate": 1, "T": [0.0] * 8, "E": [0.0] * 8}


def dv_step(st, p, ev):
    k = math.floor(p["seed"] + 0.5)
    gate = 1
    drew = 1
    if not st["valid"]:
        for i in range(8):
            st["T"][i] = dv_clamp(p["v"][i], 0, 100)
            st["E"][i] = st["T"][i]
    if ev == "reroll":
        st["reroll"] += 1
        idx = st["hits"] * 4096 + (st["reroll"] % 4096)
    else:
        idx = st["hits"] * 4096 + (st["reroll"] % 4096)
        gate = 1 if not st["valid"] else (1 if dv_hash(idx, k, 8) * 100 < p["chance"] else 0)
        drew = gate
        st["hits"] += 1
        st["gate"] = gate
    if drew:
        for i in range(8):
            if st["valid"] and p["lock"][i]:
                continue
            st["T"][i] = dv_clamp(p["v"][i] + (2 * dv_hash(idx, k, i) - 1) * p["r"][i], 0, 100)
        st["valid"] = 1
        st["serial"] += 1
    kd = 1 - 0.56 * dv_clamp(p["drift"], 0, 100) / 100
    for i in range(8):
        st["E"][i] += kd * (st["T"][i] - st["E"][i])
    return {"gate": gate, "drew": drew, "idx": idx}


def f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]


# ---- gen text -----------------------------------------------------------------------------------------------------------
def read_src(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def gen_code():
    """The text the device embeds: build_deviate.gen_code(), else the same concatenation built here.
    DEVIATE_GEN_FILE=<path> overrides it (bisecting a compile failure: scripts/dev_gen_bisect.py)."""
    override = os.environ.get("DEVIATE_GEN_FILE")
    if override:
        with open(override, encoding="utf-8") as f:
            return f.read()
    try:
        import build_deviate  # noqa: PLC0415
        return build_deviate.gen_code()
    except Exception:  # noqa: BLE001 - scripts/build_deviate.py may not exist yet
        pass
    out = subprocess.run(
        ["node", "-e", "process.stdout.write(require('./src/deviate_config.js').dvHiddenGen())"],
        cwd=ROOT, capture_output=True, text=True, check=True).stdout
    core = read_src("deviate_core.genexpr")
    lines = core.split("\n")
    assert lines.count("//@hidden") == 1, "the core must contain the line //@hidden exactly once"
    core = "\n".join(out if ln == "//@hidden" else ln for ln in lines)
    return "\n".join([read_src("cepstrum_lib.genexpr"), read_src("deviate_conv.genexpr"), core])


SOURCE_GEN = """
// one drum hit t samples after its start: a 3 ms noise burst plus a sine (tonef, 150 Hz) decaying over 90 ms
drum(t, tonef) {
	nz = t >= 0 ? exp(-t / (0.003 * samplerate)) * noise() : 0;
	to = t >= 0 ? exp(-t / (0.09 * samplerate)) * sin(twopi * tonef * t / samplerate) : 0;
	return 0.6 * nz + 0.7 * to;
}

Param kind(0);
Param amp(0.8);
Param s1(-1);
Param s2(-1);
Param s3(-1);
Param s4(-1);
Param blen(100);
Param impos(100);
Param per(400);
Param tf(150);

History n(0);

idx = n;
n = n + 1;
sf = samplerate / 1000;
ta = idx - floor(s1 * sf);
tb = idx - floor(s2 * sf);
tc = idx - floor(s3 * sf);
td = idx - floor(s4 * sf);
ba = (s1 >= 0 && ta >= 0 && ta < blen) ? sin(twopi * 1000 * ta / samplerate) : 0;
bb = (s2 >= 0 && tb >= 0 && tb < blen) ? sin(twopi * 1000 * tb / samplerate) : 0;
bc = (s3 >= 0 && tc >= 0 && tc < blen) ? sin(twopi * 1000 * tc / samplerate) : 0;
bd = (s4 >= 0 && td >= 0 && td < blen) ? sin(twopi * 1000 * td / samplerate) : 0;
bursts = (ba + bb + bc + bd) * amp;
imp = (idx == floor(impos * sf)) ? amp : 0;
nz = noise() * 0.3;
da = drum(s1 >= 0 ? ta : -1, tf);
db = drum(s2 >= 0 ? tb : -1, tf);
dc = drum(s3 >= 0 ? tc : -1, tf);
dd = drum(s4 >= 0 ? td : -1, tf);
drums = (da + db + dc + dd) * amp;
// kind 5: a steady 440 Hz tone plus two-sample clicks at s1..s4 (for the Spectral stage)
tone = 0.3 * sin(twopi * 440 * idx / samplerate);
ck = ((s1 >= 0 && ta >= 0 && ta < 2) || (s2 >= 0 && tb >= 0 && tb < 2) || (s3 >= 0 && tc >= 0 && tc < 2) || (s4 >= 0 && td >= 0 && td < 2)) ? amp : 0;
sig = 0;
sig = (kind < 0.5) ? nz + bursts * 0.6 : sig;
sig = (kind > 0.5 && kind < 1.5) ? imp : sig;
sig = (kind > 1.5 && kind < 2.5) ? bursts : sig;
sig = (kind > 3.5 && kind < 4.5) ? drums : sig;
sig = (kind > 4.5 && kind < 5.5) ? tone + ck : sig;
// kind 6: a drum hit every `per` ms starting at s1 (fuzz)
pp = per * sf;
php = idx - floor(s1 * sf);
tper = php >= 0 ? php - pp * floor(php / pp) : -1;
sig = (kind > 5.5 && kind < 6.5) ? drum(tper, tf) * amp : sig;
// kind 7: a steady 300 Hz tone of amplitude amp (a quiet one, under the sleep threshold, for mix0_exact)
sig = (kind > 6.5 && kind < 7.5) ? amp * sin(twopi * 300 * idx / samplerate) : sig;
out1 = sig;
out2 = sig;
out3 = sig;
"""


def tap_gen():
    lines = ["Buffer sc(\"tapsc\");", "Buffer tp(\"taprec\");", "History cnt(0);", "History row(0);", "",
             "cnt = cnt + 1;", "if (cnt >= 16) {", "\tcnt = 0;", f"\tbase = row * {TAP_STRIDE};"]
    for k, (_name, slot) in enumerate(TAP_SLOTS):
        lines.append(f"\tv = peek(sc, {slot}, 0);")
        lines.append(f"\tpoke(tp, v, base + {k}, 0);")
    lines += ["\trow = row + 1;", "}", "out1 = in1 * 0;"]
    return "\n".join(lines) + "\n"


def tap_samps(dur_ms):
    return (int(dur_ms * SR / 1000 / 16) + 64) * TAP_STRIDE


def params_text(extra=""):
    base = ", ".join([f"dvv{i} {DEFAULT_V[i]}" for i in range(8)] + [f"dvr{i} {DEFAULT_R[i]}" for i in range(8)]
                     + [f"dvl{i} 0" for i in range(8)]
                     + ["dvsens 0.5", "dvthr -36", "dvchance 100", "dvwet 1", "dvseed 0", "dvdrift 0", "dvsplit 0"])
    return base + (", " + extra if extra else "")


_spec_cache = []


def spec_code():
    if not _spec_cache:
        import build_deviate  # noqa: PLC0415
        _spec_cache.append(build_deviate.spec_code())
    return _spec_cache[0]


_gendsp_cache = []


def gendsp_files():
    """The deferred patches exactly as the device embeds them (minified .gendsp JSON: 4 inputs for the main gen, 2 for the stage), written to /tmp."""
    if not _gendsp_cache:
        import build_deviate  # noqa: PLC0415
        main = build_deviate.gendsp_json(build_deviate.gen_code(), 4, 2)
        spec = build_deviate.gendsp_json(build_deviate.spec_code(), 2, 2)
        paths = []
        for name, text in (("main", main), ("spec", spec)):
            path = f"/tmp/dvtest_{name}_{os.getpid()}.gendsp"
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            paths.append(path)
        _gendsp_cache.extend(paths)
    return _gendsp_cache


def device(code, case):
    nrec = case.get("channels", 3)
    boxes = [
        mh.msg("dev-params", case["params"], 40, 40, 900),
        mh.msg("dev-src-params", case["source"], 40, 70, 600),
        mh.msg("dev-bind", "scope #0-dvscope, ctl #0-dvctl, ir #0-dvir, spec #0-dvspec, dmap #0-dvmap", 40, 100, 560),
        mh.msg("dev-tap-bind", "sc #0-dvscope, tp #0-dvtap", 640, 100, 260),
        mh.msg("dev-probemsg", f"archmap #0-dvmap {case.get('arch', 0)}, setbuffers #0-dvscope #0-dvtap, tapnames " + " ".join(n for n, _ in TAP_SLOTS)
               + (", dparams " + case["dparams"] if case.get("dparams") else "")
               + (", rwindows " + " ".join(case["rwin"]) if case.get("rwin") else "")
               + (", clicks " + " ".join(str(x) for x in case["clicks"]) if case.get("clicks") else "")
               + (", exactfrom " + str(case["exactfrom"]) if case.get("exactfrom") is not None else "")
               + (", dumps " + " ".join(case["dumps"]) if case.get("dumps") else ""), 40, 130, 900),
        mh.box("dev-buf-scope", "buffer~ #0-dvscope @samps 1536", 980, 20, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-ctl", "buffer~ #0-dvctl @samps 64", 980, 45, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-map", "buffer~ #0-dvmap @samps 1040", 1220, 45, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-ir", "buffer~ #0-dvir @samps %d" % (2500000 if case.get("ir") else 4096), 980, 70, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-spec", "buffer~ #0-dvspec @samps 2048 @chans 5", 980, 95, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-tap", f"buffer~ #0-dvtap @samps {tap_samps(case['dur'])}", 980, 120, 260, numoutlets=2,
               outlettype=["float", "bang"]),
        mh.gen_box("dev-src", SOURCE_GEN, 40, 200, numinlets=1, numoutlets=3),
        (mh.box("dev-gen", "gen~ @gen " + gendsp_files()[0], 40, 300, numinlets=4, numoutlets=2, outlettype=["signal", "signal"])
         if case.get("gendsp") else mh.gen_box("dev-gen", code, 40, 300, numinlets=4, numoutlets=2)),
        mh.gen_box("dev-tap", tap_gen(), 400, 300, numinlets=1, numoutlets=1),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-src-params", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("obj-load", 0, "dev-tap-bind", 0),
        mh.line("obj-load", 0, "dev-probemsg", 0),
        mh.line("dev-probemsg", 0, "obj-js", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-tap-bind", 0, "dev-tap", 0),
        mh.line("dev-src-params", 0, "dev-src", 0),
        mh.line("dev-src", 0, "dev-gen", 0),
        mh.line("dev-src", 1, "dev-gen", 1),
        mh.line("dev-src", 2, "obj-record", 2),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 0, "dev-tap", 0),   # ordering: the tap runs after the device in every vector
        mh.line("dev-tap", 0, "obj-mute-r", 0),
    ]
    if case.get("mode") == "audio_device":
        # the real CoreAudio driver in real time, only for the CPU cases (a load figure means nothing offline)
        boxes += [mh.box("dev-metro", "metro 100", 40, 480, 70, numinlets=2), mh.box("dev-adstatus", "adstatus cpu", 40, 510, 90, outlettype=["float"]),
                  mh.box("dev-cpu-prep", "prepend cpu", 40, 540, 90)]
        lines += [mh.line("obj-load", 0, "dev-metro", 0), mh.line("dev-metro", 0, "dev-adstatus", 0), mh.line("dev-adstatus", 0, "dev-cpu-prep", 0),
                  mh.line("dev-cpu-prep", 0, "obj-js", 0)]
    if case.get("ir"):
        boxes.append(mh.msg("dev-ir-load", "replace " + IR_WAV, 640, 70, 560))
        lines.append(mh.line("obj-load", 0, "dev-ir-load", 0))
        lines.append(mh.line("dev-ir-load", 0, "dev-buf-ir", 0))
    if case.get("spec"):
        boxes.append(mh.box("dev-spec", "gen~ @gen " + gendsp_files()[1], 400, 200, numinlets=2, numoutlets=2, outlettype=["signal", "signal"])
                     if case.get("gendsp") else mh.gen_box("dev-spec", spec_code(), 400, 200, numinlets=2, numoutlets=2))
        boxes.append(mh.msg("dev-spec-bind", "scope #0-dvscope", 640, 40, 200))
        lines += [mh.line("obj-load", 0, "dev-spec-bind", 0), mh.line("dev-spec-bind", 0, "dev-spec", 0),
                  mh.line("dev-src", 0, "dev-spec", 0), mh.line("dev-src", 1, "dev-spec", 1),
                  mh.line("dev-spec", 0, "dev-gen", 2), mh.line("dev-spec", 1, "dev-gen", 3)]
        if nrec >= 4:
            lines.append(mh.line("dev-spec", 0, "obj-record", 3))
    return boxes, lines


# ---- cases ------------------------------------------------------------------------------------------------------------------
def case(name, dur, source, extra="", lat=LAT_ENV, dparams="", **opts):
    c = {"name": name, "dur": dur, "source": source, "params": params_text(extra), "lat": lat, "dparams": dparams}
    c.update(opts)
    return c


def draw_params(v, r, lock, chance, seed, drift):
    return {"v": list(v), "r": list(r), "lock": list(lock), "chance": chance, "seed": seed, "drift": drift}


def dparams_text(p):
    vals = list(p["v"]) + list(p["r"]) + list(p["lock"]) + [p["chance"], p["seed"], p["drift"]]
    return " ".join(str(x) for x in vals)


SEED_V = [20, 50, 80, 10, 60, 30, 90, 5]
SEED_R = [30, 60, 40, 100, 25, 0, 50, 80]
DRUM4 = "kind 4, amp 0.8, s1 100, s2 450, s3 800, s4 1150"


def vals_extra(v, r, **kw):
    parts = [f"dvv{i} {x}" for i, x in enumerate(v)] + [f"dvr{i} {x}" for i, x in enumerate(r)]
    parts += [f"{k} {x}" for k, x in kw.items()]
    return ", ".join(parts)


def seed_case(tag, seed):
    p = draw_params(SEED_V, SEED_R, [0] * 8, 100, seed, 0)
    extra = vals_extra(SEED_V, SEED_R, dvseed=seed)
    c = case(f"seed_repro_{tag}", 800, "kind 2, amp 0.8, s1 100, s2 250, s3 400, s4 550, blen 100", extra, dparams=dparams_text(p))
    c["draw"] = p
    return c


def hits4(name, dur, extra, p):
    c = case(name, dur, "kind 2, amp 0.8, s1 100, s2 250, s3 400, s4 550, blen 100", extra, dparams=dparams_text(p))
    c["draw"] = p
    return c


def meta_case(i):
    v = [0, 50, 0, 0, 0, 0, 0, 0]
    v[i] = 100
    return case(f"meta_{METAS[i]}", 1400, DRUM4, vals_extra(v, [0] * 8), rwin=["120:400", "400:700", "700:1200"])


METAS = ["snap", "pitch", "body", "motion", "space", "echo", "grit", "ring"]
RING_ALL = [100, 100, 100, 100, 100, 100, 100, 100]
# a ring_cap case: a single drum hit at 100 ms, the named metas and Ring at 100, Ranges 0; windows of the residue (output - delayed dry)
RWIN = ["100:400", "400:1000", "1000:1900", "1900:2060", "2060:2125", "2125:3300"]


def ring_case(name, hot, ir=False, tf=150):
    v = [0, 50, 0, 0, 0, 0, 0, 100]
    for i in hot:
        v[i] = 100
    return case(name, 3300, f"kind 4, amp 0.8, s1 100, tf {tf}", vals_extra(v, [0] * 8), ir=ir, rwin=RWIN)


ARCHS = [37, 417, 913]


def arch_fuzz_case(tag, seeds, archs):
    """fuzz_case with a new Architecture as well as a new Seed before each hit (the map written by the probe, as the engine does)."""
    ev = []
    for k, (s, a) in enumerate(zip(seeds, archs)):
        ev += [(300 + 400 * k - 60, "dev-gen", 0, f"dvseed {s}"), (300 + 400 * k - 50, "obj-js", 0, f"archmap #0-dvmap {a}")]
    return case(f"fuzz_{tag}", 300 + 400 * len(seeds) + 2400, "kind 6, amp 0.9, s1 300, per 400",
                vals_extra([100] * 8, [100] * 8, dvchance=100, dvdrift=30), events=ev, arch=archs[0])


def fuzz_case(tag, seeds):
    """25 hits (one every 400 ms) with a new Seed before each one; every Value 100, every Range 100 (draws cover the whole range), Drift 30."""
    ev = [(300 + 400 * k - 60, "dev-gen", 0, f"dvseed {s}") for k, s in enumerate(seeds)]
    return case(f"fuzz_{tag}", 300 + 400 * len(seeds) + 2400, "kind 6, amp 0.9, s1 300, per 400",
                vals_extra([100] * 8, [100] * 8, dvchance=100, dvdrift=30), events=ev)


# ---- cases of the review fixes (conv_onset, wipe_rehit, stale_wake, reroll_shorten, mix0_exact) ----
CV_V = [0, 50, 0, 0, 60, 0, 0, 0]      # Space 60: conv wet 0.9 * 0.6 * 1.0274..., IR tag 6; the reverb is on too (cancelled by the run without the IR bank)
CV_START = 100 * SR // 1000
CV_WIN = 2200
WR_V = [0, 50, 60, 70, 70, 80, 40, 10]
WR_STARTS = [100, 344, 588, 832]   # 244 ms apart: the next page applies about 110 samples after a Ring 10 life ended, inside the wipe window
WR_PIECES = [(15, 80), (80, 150), (150, 235)]
SW_V = [0, 50, 0, 0, 0, 90, 0, 100]
SW_EVENTS = [(450, "dev-gen", 0, "dvv5 0"), (850, "dev-gen", 0, "dvv5 90")]
SW_WINS = ["925:1300", "1300:2000", "2000:2800"]


def review_cases():
    out = {}
    cv = lambda tag, ir: case(f"conv_onset_{tag}", 420, "kind 2, amp 0.8, s1 100, blen 100", vals_extra(CV_V, [0] * 8), ir=ir,  # noqa: E731
                              dumps=[f"{CV_START + LAT_ENV}:{CV_WIN}"])
    out["conv_onset"] = [cv("ir", True), cv("noir", False)]
    wins = [f"{s + a}:{s + b}" for s in WR_STARTS for a, b in WR_PIECES]
    out["wipe_rehit"] = [case("wipe_rehit", 1250, "kind 2, amp 0.8, s1 100, s2 344, s3 588, s4 832, blen 100", vals_extra(WR_V, [0] * 8), rwin=wins)]
    out["stale_wake"] = [
        case("stale_wake_a", 2600, "kind 2, amp 0.8, s1 100, s2 500, s3 900, blen 100", vals_extra(SW_V, [0] * 8), events=SW_EVENTS, rwin=SW_WINS),
        case("stale_wake_b", 2600, "kind 2, amp 0.8, s1 500, s2 900, blen 100", vals_extra(SW_V, [0] * 8), events=SW_EVENTS, rwin=SW_WINS),
    ]
    out["reroll_shorten"] = [case("reroll_shorten", 900, "kind 2, amp 0.8, s1 100, blen 100", vals_extra([0, 50, 60, 0, 60, 60, 0, 100], [0] * 8) + ", dvreroll 0",
                                  events=[(450, "dev-gen", 0, "dvv7 0"), (455, "dev-gen", 0, "dvreroll 1")])]
    out["mix0_exact"] = [
        case("mix0_exact_hot", 700, "kind 2, amp 4.0, s1 100, s2 300, blen 200", "dvwet 0, " + vals_extra([100] * 8, [100] * 8)),
        case("mix0_exact_move", 1500, "kind 4, amp 0.9, s1 100, s2 300, s3 600, s4 900", "dvwet 1", events=[(150, "dev-gen", 0, "dvwet 0")], exactfrom=450),
        case("mix0_exact_sleep", 1500, "kind 7, amp 0.000005", "dvwet 0", exactfrom=600),
    ]
    return out


def cases_tel():
    return case("telemetry_layout", 700, "kind 2, amp 0.8, s1 100, blen 100",
                "dvv0 12, dvv1 64, dvv2 33, dvv3 41, dvv4 77, dvv5 5, dvv6 91, dvv7 48, dvr0 10, dvr1 20, dvr2 30, dvr3 40, dvr4 50, "
                "dvr5 60, dvr6 70, dvr7 80, dvl1 1, dvl4 1, dvsens 0.7, dvthr -30, dvchance 80, dvwet 0.75, dvseed 7, dvdrift 20")


def cases():
    out = {
        "mix0_null": [
            case("mix0_null_w0", 600, "kind 0, amp 0.8, s1 100, s2 300", "dvwet 0"),
            case("mix0_null_w1", 900, "kind 4, amp 0.9, s1 100, s2 300", "dvwet 0, " + vals_extra([100] * 8, [100] * 8)),
        ],
        "neutral_null": [
            case("neutral_null_0", 900, "kind 0, amp 0.8, s1 100, s2 300", "dvwet 1, " + NEUTRAL),
            case("neutral_null_1", 900, "kind 0, amp 0.8, s1 100, s2 300", "dvwet 1, dvsplit 1, " + NEUTRAL, lat=LAT_SPEC, spec=True),
        ],
        "latency_env": [case("latency_env_0", 400, "kind 1, amp 0.8, impos 100", "dvsplit 0, " + NEUTRAL, lat=LAT_ENV)],
        "latency_spec": [case("latency_spec_1", 400, "kind 1, amp 0.8, impos 100", "dvsplit 1, " + NEUTRAL, lat=LAT_SPEC, spec=True)],
        "gendsp_file": [
            case("gendsp_file_0", 900, "kind 4, amp 0.8, s1 100, s2 450", "dvsplit 1, " + NEUTRAL, lat=LAT_SPEC, spec=True, gendsp=True),
            case("gendsp_file_1", 1500, "kind 4, amp 0.8, s1 100, s2 450, s3 800", "dvsplit 0", spec=True, gendsp=True),
        ],
        "hit_once": [case("hit_once", 400, "kind 2, amp 0.8, s1 100, s2 110, s3 160, blen 100")],
        "seed_repro": [seed_case("a", 5), seed_case("b", 5), seed_case("c", 6)],
        "range0_novar": [hits4("range0_novar", 800, vals_extra(SEED_V, [0] * 8, dvseed=3),
                               draw_params(SEED_V, [0] * 8, [0] * 8, 100, 3, 0))],
        "chance0": [hits4("chance0", 800, vals_extra(SEED_V, SEED_R, dvseed=4, dvchance=0),
                          draw_params(SEED_V, SEED_R, [0] * 8, 0, 4, 0))],
        "lock": [hits4("lock", 800, vals_extra(SEED_V, [100] * 8, dvseed=9, dvl1=1, dvl5=1),
                       draw_params(SEED_V, [100] * 8, [0, 1, 0, 0, 0, 1, 0, 0], 100, 9, 0))],
        "reroll_nohit": [case("reroll_nohit", 1100, "kind 2, amp 0.8, s1 100, blen 100", vals_extra(SEED_V, [100] * 8, dvseed=2, dvl2=1, dvl3=1)
                              + ", dvreroll 0",
                              events=[(400, "dev-gen", 0, "dvreroll 1"), (430, "dev-gen", 0, "dvreroll 0"),
                                      (700, "dev-gen", 0, "dvreroll 1"), (730, "dev-gen", 0, "dvreroll 0")])],
        "midi_hit": [case("midi_hit", 900, "kind 2, amp 0.8, s1 205, s2 600, blen 100", "dvmtrig 5",
                          events=[(200, "dev-gen", 0, "dvmtrig 6")])],
        "sleep_silent": [case("sleep_silent", 800, "kind 3")],
        "split_sum": [case("split_sum", 900, "kind 4, amp 0.8, s1 100, s2 450", "dvsplit 1, " + NEUTRAL, lat=LAT_SPEC, spec=True)],
        "spec_t": [case("spec_t", 1000, "kind 5, amp 0.8, s1 150, s2 350, s3 550, s4 750", "dvsplit 1, " + NEUTRAL, lat=LAT_SPEC, spec=True, channels=4, clicks=[150, 350, 550, 750])],
        "mode_switch": [case("mode_switch", 1800, "kind 4, amp 0.8, s1 100, s2 500, s3 900, s4 1300", "dvsplit 0", lat=LAT_ENV, spec=True,
                             events=[(300, "dev-gen", 0, "dvsplit 1"), (900, "dev-gen", 0, "dvsplit 0"), (1200, "dev-gen", 0, "dvsplit 1")])],
        "telemetry_layout": [cases_tel()],
    }
    for i, m in enumerate(METAS):
        if m != "ring":
            out[f"meta_{m}"] = [meta_case(i)]
    out.update(review_cases())
    out["ring_cap_space"] = [ring_case("ring_cap_space", [4], ir=True)]
    out["ring_cap_reverb"] = [ring_case("ring_cap_reverb", [4], ir=False)]
    out["ring_cap_echo"] = [ring_case("ring_cap_echo", [5])]
    out["ring_cap_body"] = [ring_case("ring_cap_body", [2], tf=420)]  # the hit has energy at the first resonator mode (420 Hz)
    out["ring_cap_all"] = [ring_case("ring_cap_all", [0, 1, 2, 3, 4, 5, 6], ir=True)]
    # CPU on the real-time driver (adstatus cpu; the harness floor in the VM is about 9 %): silent input, a hit every 250 ms with the default metas,
    # every meta 100 with the convolver (a hit every 400 ms), and Spectral mode with the stage running
    heavy = vals_extra([100] * 8, [0] * 8)
    out["perf_idle"] = [case("perf_idle", 4000, "kind 3", mode="audio_device")]
    out["perf_busy"] = [case("perf_busy", 5000, "kind 6, amp 0.8, s1 100, per 250", "", mode="audio_device")]
    out["perf_heavy"] = [case("perf_heavy", 5000, "kind 6, amp 0.8, s1 100, per 400", heavy, mode="audio_device", ir=True)]
    out["perf_spec"] = [case("perf_spec", 5000, "kind 6, amp 0.8, s1 100, per 250", "dvsplit 1", lat=LAT_SPEC, mode="audio_device", spec=True)]
    # Architecture: a few non-zero maps (the probe writes them into the map buffer, as the engine does)
    out["arch_neutral"] = [case(f"arch_neutral_{a}", 900, "kind 0, amp 0.8, s1 100, s2 300", "dvwet 1, " + NEUTRAL, arch=a) for a in ARCHS]
    out["arch_telemetry"] = [dict(cases_tel(), name=f"arch_telemetry_{a}", arch=a) for a in ARCHS]
    for a in ARCHS:
        out[f"ring_cap_arch{a}"] = [dict(ring_case(f"ring_cap_arch{a}", [0, 1, 2, 3, 4, 5, 6], ir=True), arch=a)]
    out["fuzz_arch"] = [arch_fuzz_case("arch", [7 + 13 * k for k in range(14)], [1 + (k * 397) % 1000 for k in range(14)])]  # 28 events (harness cap ~30)
    out["fuzz_a"] = [fuzz_case("a", list(range(1, 26)))]
    out["fuzz_b"] = [fuzz_case("b", [101 + 37 * k for k in range(25)])]
    return out


RESULTS = {}
CASE_NAMES = list(cases().keys())


# ---- running ----------------------------------------------------------------------------------------------------------------
def probe_file(workdir):
    """tests/deviate_probe.js with src/deviate_config.js prepended (so the probe checks against the real mirrors)."""
    path = os.path.join(workdir, "deviate_probe_full.js")
    with open(os.path.join(SRC, "deviate_config.js"), encoding="utf-8") as a, open(PROBE_SRC, encoding="utf-8") as b:
        text = a.read() + "\n" + b.read()
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def run_one(code, c, probe_path):
    boxes, lines = device(code, c)
    print(f"--- {c['name']} ---")
    res = mh.run_case(c["name"], boxes, lines, probe_js=probe_path, probe_args=f"{c['name']} {c['lat']}", settle_ms=0,
                      dur_ms=c["dur"], channels=c.get("channels", 3), sr=SR, mode=c.get("mode", "nrt"), probe_object="v8", timeout=600,
                      events=c.get("events"))
    return res


def lst(v):
    """a comma-token list from the probe -> list of floats ('none' -> [])"""
    if v is None or v == "none":
        return []
    return [float(x) for x in str(v).split(",") if x != ""]


def check_mix0_null(metas, errors):
    for tag, m in metas.items():
        if m.get("nan", 1) != 0:
            errors.append(f"mix0_null {tag}: {m.get('nan')} non-finite samples")
        if m.get("prefmax", 1) != 0:
            errors.append(f"mix0_null {tag}: the first {LAT_ENV} samples must be exactly 0, max {m.get('prefmax')}")
        for ch in ("L", "R"):
            if m.get("diff" + ch, 1) != 0:
                errors.append(f"mix0_null {tag}: output {ch} must equal the input delayed {LAT_ENV} samples exactly, max diff {m.get('diff' + ch)}")
        if not (m.get("maxL", 0) > 0.1):
            errors.append(f"mix0_null {tag}: no signal in the output (max {m.get('maxL')})")
        if tag == "1" and not (m.get("t_applied", 0) >= 1):
            errors.append("mix0_null: the extreme metas were never applied (PAGE_APPLIED 0): the test would be vacuous")


def check_neutral_null(metas, errors):
    for tag, m in metas.items():
        lat = LAT_SPEC if tag == "1" else LAT_ENV
        if m.get("nan", 1) != 0:
            errors.append(f"neutral_null {tag}: {m.get('nan')} non-finite samples")
        for ch in ("L", "R"):
            if m.get("diff" + ch, 1) != 0:
                errors.append(f"neutral_null {tag}: output {ch} must equal the input delayed {lat} samples exactly, max diff {m.get('diff' + ch)}")
        if not (m.get("maxL", 0) > 0.1 and m.get("t_applied", 0) >= 2):
            errors.append(f"neutral_null {tag}: vacuous (max {m.get('maxL')}, pages applied {m.get('t_applied')})")
        if m.get("t_lat") != lat:
            errors.append(f"neutral_null {tag}: telemetry LATENCY {m.get('t_lat')}, want {lat}")


def check_latency(metas, errors, want_lat):
    for tag, m in metas.items():
        got = m.get("devfirst", -1) - m.get("srcfirst", -2)
        if got != want_lat:
            errors.append(f"{tag}: impulse delay {got} samples, want {want_lat}")
        if abs(m.get("unity", 0) - 1.0) > 1e-6:
            errors.append(f"{tag}: impulse gain {m.get('unity')}, want 1")
        if m.get("t_lat") != want_lat:
            errors.append(f"{tag}: telemetry LATENCY {m.get('t_lat')}, want {want_lat}")
        if m.get("t_split") != (1 if want_lat == LAT_SPEC else 0):
            errors.append(f"{tag}: telemetry SPLIT_MODE {m.get('t_split')}")
        if m.get("diffL") != 0:
            errors.append(f"{tag}: output differs from the input delayed {want_lat} (max {m.get('diffL')})")


def check_hit_once(m, errors):
    s1, s3 = 100 * SR // 1000, 160 * SR // 1000
    hits = lst(m.get("hit_samples"))
    app = lst(m.get("applied_samples"))
    if len(hits) != 2:
        errors.append(f"hit_once: expected 2 hits (100 ms and 160 ms; the 110 ms burst is inside the hit), got {hits}")
    else:
        for h, s in zip(hits, (s1, s3)):
            if not (-16 <= h - s <= 130):
                errors.append(f"hit_once: hit seen at sample {h}, burst starts at {s} (allowed -16..+130)")
    if len(app) != 2:
        errors.append(f"hit_once: expected 2 page applies, got {app}")
    else:
        for a, s in zip(app, (s1, s3)):
            want = s + 1 + LAT_ENV - PRE
            if not (-20 <= a - want <= 100):
                errors.append(f"hit_once: page applied at sample {a}, want {want} (t0 + {LAT_ENV} - {PRE}), allowed -20..+100")
    if m.get("t_hits") != 2:
        errors.append(f"hit_once: HITS telemetry {m.get('t_hits')}, want 2")
    if m.get("t_applied") != 2:
        errors.append(f"hit_once: PAGE_APPLIED {m.get('t_applied')}, want 2")
    if m.get("nan", 1) != 0:
        errors.append(f"hit_once: {m.get('nan')} non-finite samples")


def draws_of(m, k):
    return lst(m.get(f"draws{k}"))


def expected_seq(m, n_hits=4):
    p = m["_case"]["draw"]
    st = dv_new_state()
    seq = []
    for _ in range(n_hits):
        dv_step(st, p, "hit")
        seq.append({"T": list(st["T"]), "E": list(st["E"]), "gate": st["gate"], "serial": st["serial"]})
    return seq


def check_seed(metas, errors):
    runs = {}
    for tag, m in metas.items():
        p = m["_case"]["draw"]
        st = dv_new_state()
        n_hits = len(lst(m.get("hit_samples")))
        if n_hits != 4:
            errors.append(f"seed_repro {tag}: expected 4 hits, got {n_hits}")
            continue
        seq = []
        for k in range(4):
            dv_step(st, p, "hit")
            got = draws_of(m, k)
            exp = list(st["T"])
            seq.append(got)
            if len(got) != 8:
                errors.append(f"seed_repro {tag}: hit {k} has no draws")
                continue
            err = max(abs(g - f32(e)) for g, e in zip(got, exp))
            print(f"  {tag} hit {k}: draws {[round(g, 4) for g in got]}  max err vs dvStep {err:.2e}  (probe err {m.get(f'drawerr{k}')})")
            if err > 3e-5:
                errors.append(f"seed_repro {tag}: hit {k} draws differ from dvStep by {err} (float32 telemetry: 2 ulp = 1.5e-5)")
            if m.get(f"drawerr{k}", 1) > 3e-5:
                errors.append(f"seed_repro {tag}: probe-side dvStep comparison failed at hit {k}: {m.get(f'drawerr{k}')}")
            mt = lst(m.get(f"metas{k}"))
            if len(mt) == 8 and max(abs(a - b) for a, b in zip(mt, got)) > 3e-5:
                errors.append(f"seed_repro {tag}: at Drift 0 METAS must equal DRAWS at hit {k}")
            if m.get(f"ser{k}") != k + 1:
                errors.append(f"seed_repro {tag}: DRAW_SERIAL after hit {k} is {m.get(f'ser{k}')}, want {k + 1}")
        runs[tag] = seq
        for k in range(1, len(seq)):
            if len(seq[k]) == 8 and len(seq[k - 1]) == 8:
                ndiff = sum(1 for a, b in zip(seq[k], seq[k - 1]) if abs(a - b) > 0.05)
                if ndiff < 5:
                    errors.append(f"seed_repro {tag}: hits {k - 1} and {k} should differ in most metas (only {ndiff} differ)")
    if "a" in runs and "b" in runs and runs["a"] != runs["b"]:
        errors.append("seed_repro: the same seed twice must give identical draws")
    if "a" in runs and "c" in runs and runs["a"] == runs["c"]:
        errors.append("seed_repro: Seed 6 must differ from Seed 5")


def check_hits_draws(name, m, errors, extra=None):
    """Telemetry draws of 4 hits against dvStep (parity 3e-5 for float32); returns (seq of draws, expected)."""
    if len(lst(m.get("hit_samples"))) != 4:
        errors.append(f"{name}: expected 4 hits, got {lst(m.get('hit_samples'))}")
        return None, None
    exp = expected_seq(m)
    got = [draws_of(m, k) for k in range(4)]
    for k in range(4):
        if len(got[k]) != 8:
            errors.append(f"{name}: hit {k} has no draws")
            return None, None
        err = max(abs(g - f32(e)) for g, e in zip(got[k], exp[k]["T"]))
        print(f"  {name} hit {k}: draws {[round(g, 3) for g in got[k]]} gate {m.get(f'gate{k}')} serial {m.get(f'ser{k}')} err {err:.1e}")
        if err > 3e-5:
            errors.append(f"{name}: hit {k} draws differ from dvStep by {err}")
        if m.get(f"gate{k}") != exp[k]["gate"]:
            errors.append(f"{name}: hit {k} HIT_GATE {m.get(f'gate{k}')}, want {exp[k]['gate']}")
        if m.get(f"ser{k}") != exp[k]["serial"]:
            errors.append(f"{name}: hit {k} DRAW_SERIAL {m.get(f'ser{k}')}, want {exp[k]['serial']}")
    if m.get("nan", 1) != 0:
        errors.append(f"{name}: {m.get('nan')} non-finite samples")
    return got, exp


def check_range0(m, errors):
    got, _ = check_hits_draws("range0_novar", m, errors)
    if got:
        v = [f32(x) for x in SEED_V]
        for k in range(4):
            if max(abs(a - b) for a, b in zip(got[k], v)) > 3e-5:
                errors.append(f"range0_novar: hit {k} draws {got[k]} must equal the Values {SEED_V}")


def check_chance0(m, errors):
    got, exp = check_hits_draws("chance0", m, errors)
    if got:
        for k in range(1, 4):
            if m.get(f"gate{k}") != 0 or m.get(f"ser{k}") != 1:
                errors.append(f"chance0: hit {k} must be rejected (gate {m.get(f'gate{k}')}, serial {m.get(f'ser{k}')})")
            if got[k] != got[0]:
                errors.append(f"chance0: a rejected hit must keep the draw ({got[k]} vs {got[0]})")
        if m.get("t_gate") != 0:
            errors.append(f"chance0: HIT_GATE telemetry {m.get('t_gate')}, want 0")
        if m.get("t_applied") != 4:
            errors.append(f"chance0: PAGE_APPLIED {m.get('t_applied')}: a rejected hit still applies the page, want 4")


def check_lock(m, errors):
    got, _ = check_hits_draws("lock", m, errors)
    if got:
        for k in range(1, 4):
            for i in (1, 5):
                if got[k][i] != got[0][i]:
                    errors.append(f"lock: locked meta {i} changed at hit {k}: {got[0][i]} -> {got[k][i]}")
        for i in (0, 2, 3, 4, 6, 7):
            if all(abs(got[k][i] - got[0][i]) < 0.05 for k in range(1, 4)):
                errors.append(f"lock: unlocked meta {i} never left its first draw {got[0][i]} ({[g[i] for g in got]})")


def check_reroll(m, errors):
    if m.get("t_hits") != 1:
        errors.append(f"reroll_nohit: HITS {m.get('t_hits')}, want 1 (a Reroll is not a hit)")
    if m.get("t_reroll") != 2:
        errors.append(f"reroll_nohit: REROLL {m.get('t_reroll')}, want 2")
    sers = [lst(m.get(f"sdraws{k}")) for k in range(3)]
    if m.get("t_serial") != 3:
        errors.append(f"reroll_nohit: DRAW_SERIAL {m.get('t_serial')}, want 3 (hit + 2 rerolls)")
    if all(len(s) == 8 for s in sers):
        for k in (1, 2):
            for i in (2, 3):
                if sers[k][i] != sers[0][i]:
                    errors.append(f"reroll_nohit: locked meta {i} changed at draw {k}")
            if sum(1 for i in (0, 1, 4, 5, 6, 7) if abs(sers[k][i] - sers[k - 1][i]) > 0.05) < 4:
                errors.append(f"reroll_nohit: the unlocked metas must change at draw {k}")
        print("  rerolls: " + " | ".join(str([round(x, 1) for x in s]) for s in sers))
    else:
        errors.append(f"reroll_nohit: draws at the three serial changes are missing ({[len(s) for s in sers]})")
    if m.get("t_applied") != 3:
        errors.append(f"reroll_nohit: PAGE_APPLIED {m.get('t_applied')}, want 3")
    if m.get("nan", 1) != 0:
        errors.append(f"reroll_nohit: {m.get('nan')} non-finite samples")


def check_midi(m, errors):
    hs = lst(m.get("hit_samples"))
    if m.get("t_hits") != 2:
        errors.append(f"midi_hit: HITS {m.get('t_hits')}, want 2 (the MIDI hit, a later audio hit; the burst 5 ms after the MIDI hit is deduped), hits at {hs}")
    if len(hs) >= 1 and abs(hs[0] - 200 * SR / 1000) > 200:
        errors.append(f"midi_hit: the MIDI hit landed at sample {hs[0]}, want about {200 * SR // 1000}")
    if m.get("hitsrc0") != 1 or m.get("hitsrc1") != 0:
        errors.append(f"midi_hit: HIT_SRC {m.get('hitsrc0')} then {m.get('hitsrc1')}, want 1 (MIDI) then 0 (audio)")
    if m.get("t_applied") != 2:
        errors.append(f"midi_hit: PAGE_APPLIED {m.get('t_applied')}, want 2")


def check_sleep(m, errors):
    if m.get("maxL", 1) != 0 or m.get("maxR", 1) != 0:
        errors.append(f"sleep_silent: output must be exact zeros (max {m.get('maxL')} / {m.get('maxR')})")
    if m.get("t_asleep") != 1:
        errors.append(f"sleep_silent: ASLEEP telemetry {m.get('t_asleep')}, want 1")
    if not (m.get("t_alive", 0) - m.get("f_alive", 0) > 20):
        errors.append(f"sleep_silent: ALIVE must keep moving while asleep ({m.get('f_alive')} -> {m.get('t_alive')})")
    if not (m.get("t_frames", 0) - m.get("f_frames", 0) > 20):
        errors.append(f"sleep_silent: FRAMES must keep moving while asleep ({m.get('f_frames')} -> {m.get('t_frames')})")


def check_meta(name, m, errors):
    rs = m.get("res_rms", 0)
    ss = m.get("src_rms", 1)
    print(f"  {name}: residue rms {rs:.4f} vs source rms {ss:.4f} ({20 * math.log10(max(rs, 1e-9) / max(ss, 1e-9)):.1f} dB), peak {m.get('maxL'):.3f}, "
          f"windows { {k: round(v, 4) for k, v in m.items() if k.startswith('rmax_')} }")
    if m.get("nan", 1) != 0:
        errors.append(f"{name}: {m.get('nan')} non-finite samples")
    if not (m.get("maxL", 9) < 4 and m.get("maxR", 9) < 4):
        errors.append(f"{name}: peak {m.get('maxL')} / {m.get('maxR')} must stay below 4")
    if rs < 0.01 * ss:
        errors.append(f"{name}: the effect is inaudible (residue {rs:.5f} against source {ss:.4f})")


def check_ring_cap(name, m, errors):
    print(f"  {name}: " + " ".join(f"{k}={v:.5f}" for k, v in sorted(m.items()) if k.startswith("rmax_")) + f" peak {m.get('maxL'):.3f}")
    if m.get("nan", 1) != 0:
        errors.append(f"{name}: {m.get('nan')} non-finite samples")
    if not (m.get("maxL", 9) < 4 and m.get("maxR", 9) < 4):
        errors.append(f"{name}: peak {m.get('maxL')} must stay below 4")
    # exact 0 once the Ring envelope has faded (2.0 s after the page was applied); the device's silence sleep (input < -100 dB for 0.34 s) then zeroes
    # the output itself, and the dry path's own 1e-10 decay tail (the drum's sine, 2 s after the hit) is the only thing left in the residue
    if m.get("rmax_2125_3300", 1) > 1e-9:
        errors.append(f"{name}: the residue must be zero (< -180 dB) from 2.125 s on, max {m.get('rmax_2125_3300')}")
    if m.get("rmax_2060_2125", 1) > 1e-3:
        errors.append(f"{name}: residue {m.get('rmax_2060_2125')} between 2.06 and 2.125 s must be below -60 dB")
    if not (m.get("rmax_100_400", 0) > 0.01):
        errors.append(f"{name}: no effect heard in the first 300 ms ({m.get('rmax_100_400')}): the test would be vacuous")
    if name in ("ring_cap_space", "ring_cap_reverb", "ring_cap_echo", "ring_cap_body") and not (m.get("rmax_400_1000", 0) > 0.002):
        errors.append(f"{name}: no tail between 0.4 and 1.0 s ({m.get('rmax_400_1000')}): the test would be vacuous")


def check_split_sum(m, errors):
    if m.get("nan", 1) != 0:
        errors.append(f"split_sum: {m.get('nan')} non-finite samples")
    for ch in ("L", "R"):
        if m.get("diff" + ch, 1) != 0:
            errors.append(f"split_sum: output {ch} must equal the input delayed {LAT_SPEC} samples exactly, max diff {m.get('diff' + ch)}")
    if not (m.get("maxL", 0) > 0.1):
        errors.append("split_sum: no signal")
    if m.get("t_split") != 1 or m.get("t_lat") != LAT_SPEC:
        errors.append(f"split_sum: the Spectral mode was not engaged (SPLIT {m.get('t_split')}, LATENCY {m.get('t_lat')})")
    if not (m.get("t_specalive", 0) > 10):
        errors.append(f"split_sum: the Spectral stage is not running (alive {m.get('t_specalive')})")
    if not (m.get("max_pkt", 0) > 0.05 and m.get("max_pkb", 0) > 0.02):
        errors.append(f"split_sum: T / B chain inputs carry no signal (PK_T {m.get('max_pkt')}, PK_B {m.get('max_pkb')})")


def check_spec_t(m, errors):
    cl = m.get("clickT", 0)
    tn = m.get("toneT", 1)
    print(f"  spec_t: T energy around the clicks {cl:.4f} of the click energy {m.get('clickE', 0):.4f} ({m.get('clickRatio', 0):.2f}); "
          f"T tone leakage {tn:.5f} of the tone energy {m.get('toneE', 0):.4f} ({m.get('toneRatio', 0):.4f})")
    if not (m.get("clickRatio", 0) > 0.25):
        errors.append(f"spec_t: T keeps only {m.get('clickRatio')} of the click energy (want > 0.25)")
    if not (m.get("toneRatio", 1) < 0.02):
        errors.append(f"spec_t: T keeps {m.get('toneRatio')} of the steady tone (want < 0.02)")
    if m.get("nan", 1) != 0:
        errors.append(f"spec_t: {m.get('nan')} non-finite samples")


def check_mode_switch(m, errors):
    if m.get("nan", 1) != 0:
        errors.append(f"mode_switch: {m.get('nan')} non-finite samples")
    if not (m.get("maxL", 9) < 4):
        errors.append(f"mode_switch: peak {m.get('maxL')}")
    if m.get("t_split") != 1 or m.get("t_lat") != LAT_SPEC:
        errors.append(f"mode_switch: final SPLIT {m.get('t_split')} LATENCY {m.get('t_lat')}, want 1 / {LAT_SPEC}")
    if m.get("max_pkout", 0) < 0.05:
        errors.append("mode_switch: no output")
    print(f"  mode_switch: peak {m.get('maxL'):.3f}, max step {m.get('maxstep', 0):.4f}")


def check_fuzz(name, m, errors, min_hits=20):
    print(f"  {name}: peak {m.get('maxL'):.3f} / {m.get('maxR'):.3f}, hits {m.get('t_hits')}, draws {m.get('t_serial')}")
    if m.get("nan", 1) != 0:
        errors.append(f"{name}: {m.get('nan')} non-finite samples")
    if not (m.get("maxL", 9) < 4 and m.get("maxR", 9) < 4):
        errors.append(f"{name}: peak {m.get('maxL')} / {m.get('maxR')} must stay below 4")
    if not (m.get("t_hits", 0) >= min_hits):
        errors.append(f"{name}: only {m.get('t_hits')} hits")


def check_telemetry(m, errors):
    def want(key, val, tol=0.0):
        got = m.get(key)
        if got is None or abs(got - val) > tol:
            errors.append(f"telemetry_layout: {key} = {got}, want {val}")

    want("s1", SR)
    want("t_lat", LAT_ENV)
    want("t_split", 0)
    want("t_hits", 1)
    want("t_gate", 1)
    want("t_hitsrc", 0)
    want("t_applied", 1)
    if not (m.get("t_frames", 0) - m.get("f_frames", 0) > 20):
        errors.append("telemetry_layout: FRAMES does not move")
    if not (m.get("t_alive", 0) - m.get("f_alive", 0) > 20):
        errors.append("telemetry_layout: ALIVE does not move")
    echo_v = [12, 64, 33, 41, 77, 5, 91, 48]
    echo_r = [10, 20, 30, 40, 50, 60, 70, 80]
    for i in range(8):
        want(f"s{128 + i}", echo_v[i])
        want(f"s{136 + i}", echo_r[i])
    want("s144", 2 + 16)                       # locks: Pitch (bit 1) and Space (bit 4)
    want("s145", 0.7, 1e-6)
    want("s146", -30)
    want("s147", 80)
    want("s148", 0.75, 1e-6)
    want("s149", 7)
    want("s150", 20)
    want("s151", 0)
    want("s152", -1)                           # dvreroll never sent: the default (no value yet)
    want("s153", 0)
    if m.get("hidden_maxerr", 1) > 1e-4 or m.get("hidden_stepbad", 1) != 0:
        errors.append(f"telemetry_layout: HIDDEN slots differ from dvHiddenFromMetas (max err {m.get('hidden_maxerr')}, step mismatches {m.get('hidden_stepbad')})")
    if m.get("irtag_expected") is not None and m.get("t_irtag") != m.get("irtag_expected"):
        errors.append(f"telemetry_layout: IR_TAG {m.get('t_irtag')}, want {m.get('irtag_expected')}")
    if not (m.get("wavenz", 0) >= 1 and m.get("waveflag", 0) >= 1 and m.get("wavehead", 0) > 0):
        errors.append(f"telemetry_layout: waveform ring not written (nonzero blocks {m.get('wavenz')}, onset flags {m.get('waveflag')}, head {m.get('wavehead')})")
    if not (m.get("max_pkin", 0) > 0.5):
        errors.append(f"telemetry_layout: PK_IN {m.get('max_pkin')}")
    if not (m.get("max_pkt", 0) > 0.2):
        errors.append(f"telemetry_layout: PK_T {m.get('max_pkt')}")
    if not (m.get("max_pkb", 0) > 0.001):
        errors.append(f"telemetry_layout: PK_B {m.get('max_pkb')}")
    if not (m.get("max_pkl", 0) > 1e-6):
        errors.append(f"telemetry_layout: PK_L {m.get('max_pkl')}")
    if not (m.get("max_pkout", 0) > 0.5):
        errors.append(f"telemetry_layout: PK_OUT {m.get('max_pkout')}")
    if not (m.get("max_ringenv", 0) > 0.99):
        errors.append(f"telemetry_layout: RING_ENV never reached 1 ({m.get('max_ringenv')})")


def check_conv_onset(res, errors):
    a, b = res.get("conv_onset_ir", {}), res.get("conv_onset_noir", {})
    da, db = lst(a.get("dump0")), lst(b.get("dump0"))
    td_path = os.path.join(ROOT, "build_cache", "deviate_ir_48000_td.json")
    if not os.path.isfile(td_path):
        errors.append("conv_onset: build_cache/deviate_ir_48000_td.json is missing (the host build writes it: python3 scripts/build_deviate.py)")
        return
    with open(td_path, encoding="utf-8") as f:
        ir = json.load(f)["irs"]["6"]["L"]
    if len(da) != CV_WIN or len(db) != CV_WIN:
        errors.append(f"conv_onset: dumps have {len(da)} / {len(db)} samples, want {CV_WIN}")
        return
    cw = 0.9 * min(1.0, 60 * 0.01 * 1.0274682411155285)
    x = [0.8 * math.sin(2 * math.pi * 1000 * k / SR) for k in range(100)]
    ref = [0.7 * cw * sum(x[m] * ir[j - m] for m in range(100) if 0 <= j - m < len(ir)) for j in range(CV_WIN)]
    got = [p - q for p, q in zip(da, db)]
    e = sum((g - r) ** 2 for g, r in zip(got, ref))
    en = sum(r * r for r in ref)
    rel = math.sqrt(e / max(en, 1e-30))
    first_ref = next((j for j, r in enumerate(ref) if abs(r) > 1e-4), -1)
    first_got = next((j for j, g in enumerate(got) if abs(g) > 1e-4), -1)
    print(f"  conv_onset: reference energy {en:.4e}, relative error {rel:.2e}, first sample above 1e-4: ref {first_ref}, got {first_got} (after the page apply + 96)")
    if not (en > 1e-4):
        errors.append(f"conv_onset: vacuous (reference energy {en})")
    if not (rel < 5e-3):
        errors.append(f"conv_onset: the convolver output differs from IR * hit (relative error {rel:.3e}); the hit's start is missing or misaligned")
    if first_ref != first_got:
        errors.append(f"conv_onset: the output starts at +{first_got}, the convolution of the whole hit at +{first_ref}")
    for tag, m in (("ir", a), ("noir", b)):
        if m.get("nan", 1) != 0:
            errors.append(f"conv_onset_{tag}: {m.get('nan')} non-finite samples")


def check_wipe_rehit(m, errors):
    keys = lambda h: [f"rmax_{WR_STARTS[h] + a}_{WR_STARTS[h] + b}" for a, b in WR_PIECES]  # noqa: E731
    ref = [m.get(k) for k in keys(0)]
    print("  wipe_rehit: hit 1 windows " + " ".join(f"{v:.6f}" for v in ref if v is not None))
    if any(v is None for v in ref) or ref[0] < 1e-3 or ref[1] < 1e-3:
        errors.append(f"wipe_rehit: vacuous, hit 1 residue windows {ref}")
        return
    for h in (1, 2, 3):
        got = [m.get(k) for k in keys(h)]
        for r, g, k in zip(ref, got, keys(h)):
            if g is None or abs(g - r) > 1e-6 * r + 1e-9:
                errors.append(f"wipe_rehit: hit {h + 1} window {k} = {g}, hit 1 had {r}: a ring was wiped or left dirty under the new hit")
    if m.get("nan", 1) != 0:
        errors.append(f"wipe_rehit: {m.get('nan')} non-finite samples")
    if m.get("t_hits") != 4:
        errors.append(f"wipe_rehit: HITS {m.get('t_hits')}, want 4")


def check_stale_wake(res, errors):
    a, b = res.get("stale_wake_a", {}), res.get("stale_wake_b", {})
    ks = [k for k in a if k.startswith("rmax_")]
    print("  stale_wake: " + " ".join(f"{k}={a[k]:.6f}/{b.get(k, float('nan')):.6f}" for k in sorted(ks)))
    if a.get("t_hits") != 3 or b.get("t_hits") != 2:
        errors.append(f"stale_wake: hits {a.get('t_hits')} / {b.get('t_hits')}, want 3 / 2")
    for k in ks:
        if k in ("rmax_925_1300", "rmax_1300_2000") and not (b.get(k, 0) > 1e-3):
            errors.append(f"stale_wake: vacuous, run B window {k} = {b.get(k)}")
        elif abs(a[k] - b[k]) > 1e-5 * b.get(k, 0) + 1e-9:
            errors.append(f"stale_wake: window {k}: with hit 1 {a[k]}, without {b[k]}: the delay replays residue of hit 1")
    for tag, m in (("a", a), ("b", b)):
        if m.get("nan", 1) != 0:
            errors.append(f"stale_wake_{tag}: {m.get('nan')} non-finite samples")


def check_reroll_shorten(m, errors):
    print(f"  reroll_shorten: envelope peak {m.get('ringenv_hi', 0):.3f}, largest fall between two rows {m.get('ringenv_maxdrop', 0):.3f}, final {m.get('t_ringenv')}, Tr {m.get('t_trs')}")
    if m.get("t_reroll") != 1:
        errors.append(f"reroll_shorten: REROLL {m.get('t_reroll')}, want 1")
    if not (m.get("ringenv_hi", 0) > 0.9):
        errors.append(f"reroll_shorten: vacuous (envelope peak {m.get('ringenv_hi')})")
    if not (m.get("t_trs", 9) < 0.06):
        errors.append(f"reroll_shorten: the Reroll did not shorten Ring (TR_S {m.get('t_trs')})")
    if not (m.get("ringenv_maxdrop", 9) < 0.3):
        errors.append(f"reroll_shorten: the Ring envelope fell by {m.get('ringenv_maxdrop')} in one step (a click); it must ramp out")
    if m.get("t_ringenv") != 0:
        errors.append(f"reroll_shorten: the envelope must end at exactly 0, it is {m.get('t_ringenv')}")
    if m.get("nan", 1) != 0:
        errors.append(f"reroll_shorten: {m.get('nan')} non-finite samples")


def check_mix0_exact(res, errors):
    h, mv, sl = res.get("mix0_exact_hot", {}), res.get("mix0_exact_move", {}), res.get("mix0_exact_sleep", {})
    if h.get("nan", 1) != 0 or h.get("diffL", 1) != 0 or h.get("diffR", 1) != 0:
        errors.append(f"mix0_exact hot: +12 dBFS input at Mix 0 must be the delayed dry bit for bit (diff {h.get('diffL')} / {h.get('diffR')}, nan {h.get('nan')})")
    if not (h.get("maxL", 0) > 3.9):
        errors.append(f"mix0_exact hot: vacuous (peak {h.get('maxL')})")
    if mv.get("exdiffL", 1) != 0 or mv.get("exdiffR", 1) != 0 or mv.get("nan", 1) != 0:
        errors.append(f"mix0_exact move: from 450 ms (Mix moved to 0 at 150 ms) the output must be the delayed dry exactly (diff {mv.get('exdiffL')} / {mv.get('exdiffR')})")
    if not (mv.get("maxL", 0) > 0.3 and mv.get("t_applied", 0) >= 3):
        errors.append(f"mix0_exact move: vacuous (peak {mv.get('maxL')}, pages {mv.get('t_applied')})")
    if sl.get("exdiffL", 1) != 0 or sl.get("exdiffR", 1) != 0 or sl.get("nan", 1) != 0:
        errors.append(f"mix0_exact sleep: a signal under the sleep threshold must pass through exactly (diff {sl.get('exdiffL')} / {sl.get('exdiffR')})")
    if sl.get("t_asleep") != 1 or not (1e-6 < sl.get("maxL", 0) < 1e-5):
        errors.append(f"mix0_exact sleep: not asleep with a quiet signal (ASLEEP {sl.get('t_asleep')}, peak {sl.get('maxL')})")
    print(f"  mix0_exact: hot diff {h.get('diffL')}, move diff {mv.get('exdiffL')}, sleep diff {sl.get('exdiffL')} (asleep {sl.get('t_asleep')}, peak {sl.get('maxL')})")


def run_group(code, name, only_dry=False):
    errors = []
    cs = cases()[name]
    if only_dry:
        for c in cs:
            boxes, lines = device(code, c)
            patch, _s, _d = mh.build_scaffold(boxes, lines, probe_js="/tmp/x.js", probe_args=f"{c['name']} {c['lat']}", settle_ms=0,
                                              dur_ms=c["dur"], channels=c.get("channels", 3), sr=SR, mode="nrt", probe_object="v8",
                                              events=c.get("events"))
            json.dumps(patch)
            ids = [b["box"]["id"] for b in patch["patcher"]["boxes"]]
            assert len(ids) == len(set(ids)), f"{c['name']}: duplicate box ids"
            for ln in patch["patcher"]["lines"]:
                for end in ("source", "destination"):
                    assert ln["patchline"][end][0] in ids, f"{c['name']}: line to unknown box {ln['patchline'][end][0]}"
            print(f"dry: {c['name']} ok ({len(ids)} boxes)")
        return errors
    work = tempfile.mkdtemp(prefix="deviate_probe_")
    try:
        probe = probe_file(work)
        res = {}
        for c in cs:
            try:
                m = run_one(code, c, probe)
            except Exception as exc:  # noqa: BLE001 - reported as a failure
                errors.append(f"{c['name']}: {exc}")
                continue
            m["_case"] = c
            res[c["name"]] = m
            print("  " + " ".join(f"{k}={v}" for k, v in m.items() if k in ("nan", "maxL", "diffL", "prefmax", "devfirst", "srcfirst",
                                                                          "hit_samples", "applied_samples", "t_hits", "t_applied", "t_asleep")))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if errors and not res:
        return errors
    g = lambda k: res.get(k, {})  # noqa: E731
    if name == "mix0_null":
        check_mix0_null({"0": g("mix0_null_w0"), "1": g("mix0_null_w1")}, errors)
    elif name == "neutral_null":
        check_neutral_null({"0": g("neutral_null_0"), "1": g("neutral_null_1")}, errors)
    elif name == "latency_env":
        check_latency({"latency_env": g("latency_env_0")}, errors, LAT_ENV)
    elif name == "latency_spec":
        check_latency({"latency_spec": g("latency_spec_1")}, errors, LAT_SPEC)
    elif name == "gendsp_file":
        m0, m1 = g("gendsp_file_0"), g("gendsp_file_1")
        check_split_sum(m0, errors)
        if m1.get("nan", 1) != 0 or not (m1.get("maxL", 9) < 4):
            errors.append(f"gendsp_file effects: nan {m1.get('nan')}, peak {m1.get('maxL')}")
        if not (m1.get("res_rms", 0) > 0.01 * m1.get("src_rms", 1)):
            errors.append(f"gendsp_file effects: the effects are inaudible (residue {m1.get('res_rms')})")
        print(f"  gendsp_file: spectral null diff {m0.get('diffL')}, effects residue {m1.get('res_rms')} (source {m1.get('src_rms')})")
    elif name == "hit_once":
        check_hit_once(g("hit_once"), errors)
    elif name == "seed_repro":
        check_seed({k.split("_")[-1]: v for k, v in res.items()}, errors)
    elif name == "range0_novar":
        check_range0(g("range0_novar"), errors)
    elif name == "chance0":
        check_chance0(g("chance0"), errors)
    elif name == "lock":
        check_lock(g("lock"), errors)
    elif name == "reroll_nohit":
        check_reroll(g("reroll_nohit"), errors)
    elif name == "midi_hit":
        check_midi(g("midi_hit"), errors)
    elif name == "sleep_silent":
        check_sleep(g("sleep_silent"), errors)
    elif name.startswith("meta_"):
        check_meta(name, g(name), errors)
    elif name.startswith("ring_cap_"):
        check_ring_cap(name, g(name), errors)
    elif name == "split_sum":
        check_split_sum(g("split_sum"), errors)
    elif name == "spec_t":
        check_spec_t(g("spec_t"), errors)
    elif name == "mode_switch":
        check_mode_switch(g("mode_switch"), errors)
    elif name.startswith("perf_"):
        m = g(name)
        print(f"  {name}: audio CPU avg {m.get('cpuAvg', float('nan')):.1f}% max {m.get('cpuMax', float('nan')):.1f}% over {m.get('cpuCount', 0):.0f} samples (real-time driver, harness floor about 9%)")
        RESULTS[name] = (m.get("cpuAvg"), m.get("cpuMax"))
        if not m.get("cpuCount"):
            errors.append(f"{name}: no CPU samples from adstatus cpu")
        elif m.get("cpuMax", 0) > 80:
            errors.append(f"{name}: audio CPU peaked at {m['cpuMax']:.1f}%")
    elif name.startswith("fuzz_"):
        check_fuzz(name, g(name), errors, 12 if name == "fuzz_arch" else 20)
        if name == "fuzz_arch":
            m = g(name)
            if m.get("arch") != 1 + (13 * 397) % 1000 or m.get("hidden_maxerr", 1) > 1e-4 or m.get("hidden_stepbad", 1) != 0:
                errors.append(f"fuzz_arch: the last page does not follow the last map (arch {m.get('arch')}, max err {m.get('hidden_maxerr')}, step {m.get('hidden_stepbad')})")
    elif name == "arch_neutral":
        for a in ARCHS:
            m = g(f"arch_neutral_{a}")
            if m.get("nan", 1) != 0 or m.get("diffL", 1) != 0 or m.get("diffR", 1) != 0 or not (m.get("t_applied", 0) >= 2) or m.get("arch") != a:
                errors.append(f"arch_neutral {a}: neutral metas must give the input delayed {LAT_ENV} exactly (diff {m.get('diffL')}/{m.get('diffR')}, "
                              f"pages {m.get('t_applied')}, arch {m.get('arch')})")
    elif name == "arch_telemetry":
        for a in ARCHS:
            sub = []
            check_telemetry(g(f"arch_telemetry_{a}"), sub)
            errors += [f"arch {a}: {e}" for e in sub]
    elif name == "telemetry_layout":
        check_telemetry(g("telemetry_layout"), errors)
    elif name == "conv_onset":
        check_conv_onset(res, errors)
    elif name == "wipe_rehit":
        check_wipe_rehit(g("wipe_rehit"), errors)
    elif name == "stale_wake":
        check_stale_wake(res, errors)
    elif name == "reroll_shorten":
        check_reroll_shorten(g("reroll_shorten"), errors)
    elif name == "mix0_exact":
        check_mix0_exact(res, errors)
    return errors


def main(argv):
    if "--list" in argv:
        print("\n".join(CASE_NAMES))
        return 0
    dry = "--dry" in argv
    names = [a for a in argv if not a.startswith("--")]
    for n in names:
        if n not in CASE_NAMES:
            print(f"unknown case {n}; cases: {', '.join(CASE_NAMES)}")
            return 2
    code = gen_code()
    all_errors = []
    for name in (names or CASE_NAMES):
        print(f"=== {name} ===")
        all_errors += run_group(code, name, only_dry=dry)
    if all_errors:
        print("FAILED")
        for e in all_errors:
            print(" -", e)
        return 1
    print("deviate audio checks passed" if not dry else "deviate dry run passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
