#!/usr/bin/env python3
"""Render Deviate's gen core through Ableton-bundled Max (shared NonRealTime harness) and verify the contract.

Runs on scripts/max_harness.py (VM only: AGENTS.md 1a / 1b):
    /usr/bin/python3 scripts/run_deviate_audio_tests.py [case ...]        (scripts/vm_deviate.sh audio)
    python3 scripts/run_deviate_audio_tests.py --list                     (case names)
    python3 scripts/run_deviate_audio_tests.py --dry [case ...]           (build every patch + probe, launch nothing; runs on the host)

Python stdlib only. The gen text comes from build_deviate.gen_code() (what the device embeds); until scripts/build_deviate.py
exists it is built here: cepstrum_lib + deviate_conv + deviate_core with the `//@hidden` line replaced by dvHiddenGen() (needs
`node` on the host; the VM uses build_deviate).

One patch per case: SOURCE gen -> Deviate gen (+ a TAP gen) -> record~ rec (3 channels: ch1 out L, ch2 out R, ch3 source L).
The TAP gen reads the device's telemetry buffer (scope) every 16 samples and pokes selected slots into a buffer (one row of
TAP_SLOTS per 16 samples), so the probe sees hits, page applies, draws and peaks as time series. The device gen is wired into
the tap gen (an audio cord), which makes the tap run AFTER the device in every 64-sample vector: a telemetry change made at sample
t is seen in the first tap row at or after t + (rest of the vector), i.e. up to 63 + 16 samples late, never early.
The probe (tests/deviate_probe.js, v8, src/deviate_config.js prepended) reduces everything to `key value` lines.

Cases:
  mix0_null        Mix 0 and Mix 100 (noise + tone bursts): the output is bit-equal to the input delayed 256 samples; no NaN
  latency_env      an impulse comes out exactly 256 samples later at unity (Envelope) and 1279 later (dvsplit 1); telemetry LATENCY
  hit_once         tone bursts at 100 / 110 / 160 ms: exactly 2 hits (the 10 ms one is swallowed, the 60 ms one hits), page
                   applied at t0 + 256 - 96 (+0..+80 samples of tap latency), PAGE_APPLIED 2
  seed_repro       4 hits, Seed 5: telemetry DRAWS equal dvStep (float32 telemetry: 2 float32 ulp), two hits differ, the same
                   seed twice is identical, Seed 6 differs
  sleep_silent     silence: exact zeros, ALIVE and FRAMES keep moving, ASLEEP = 1
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
    ("irtag", 11), ("reroll", 8), ("hitsrc", 40),
] + [(f"d{i}", 24 + i) for i in range(8)] + [(f"m{i}", 16 + i) for i in range(8)]
TAP_STRIDE = len(TAP_SLOTS)

DEFAULT_V = [30, 50, 30, 20, 30, 20, 20, 10]
DEFAULT_R = [50] * 8


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
Param kind(0);
Param amp(0.8);
Param s1(-1);
Param s2(-1);
Param s3(-1);
Param s4(-1);
Param blen(100);
Param impos(100);

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
sig = 0;
sig = (kind < 0.5) ? nz + bursts * 0.6 : sig;
sig = (kind > 0.5 && kind < 1.5) ? imp : sig;
sig = (kind > 1.5 && kind < 2.5) ? bursts : sig;
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


def device(code, case):
    boxes = [
        mh.msg("dev-params", case["params"], 40, 40, 900),
        mh.msg("dev-src-params", case["source"], 40, 70, 600),
        mh.msg("dev-bind", "scope #0-dvscope, ctl #0-dvctl, ir #0-dvir, spec #0-dvspec", 40, 100, 560),
        mh.msg("dev-tap-bind", "sc #0-dvscope, tp #0-dvtap", 640, 100, 260),
        mh.msg("dev-probemsg", "setbuffers #0-dvscope #0-dvtap, tapnames " + " ".join(n for n, _ in TAP_SLOTS)
               + (", dparams " + case["dparams"] if case.get("dparams") else ""), 40, 130, 900),
        mh.box("dev-buf-scope", "buffer~ #0-dvscope @samps 1536", 980, 20, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-ctl", "buffer~ #0-dvctl @samps 64", 980, 45, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-ir", "buffer~ #0-dvir @samps 4096", 980, 70, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-spec", "buffer~ #0-dvspec @samps 2048 @chans 5", 980, 95, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-tap", f"buffer~ #0-dvtap @samps {tap_samps(case['dur'])}", 980, 120, 260, numoutlets=2,
               outlettype=["float", "bang"]),
        mh.gen_box("dev-src", SOURCE_GEN, 40, 200, numinlets=1, numoutlets=3),
        mh.gen_box("dev-gen", code, 40, 300, numinlets=2, numoutlets=2),
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
    return boxes, lines


# ---- cases ------------------------------------------------------------------------------------------------------------------
def case(name, dur, source, extra="", lat=LAT_ENV, dparams=""):
    return {"name": name, "dur": dur, "source": source, "params": params_text(extra), "lat": lat, "dparams": dparams}


def draw_params(v, r, lock, chance, seed, drift):
    return {"v": list(v), "r": list(r), "lock": list(lock), "chance": chance, "seed": seed, "drift": drift}


def dparams_text(p):
    vals = list(p["v"]) + list(p["r"]) + list(p["lock"]) + [p["chance"], p["seed"], p["drift"]]
    return " ".join(str(x) for x in vals)


SEED_V = [20, 50, 80, 10, 60, 30, 90, 5]
SEED_R = [30, 60, 40, 100, 25, 0, 50, 80]


def seed_case(tag, seed):
    p = draw_params(SEED_V, SEED_R, [0] * 8, 100, seed, 0)
    extra = ", ".join([f"dvv{i} {SEED_V[i]}" for i in range(8)] + [f"dvr{i} {SEED_R[i]}" for i in range(8)] + [f"dvseed {seed}"])
    c = case(f"seed_repro_{tag}", 800, "kind 2, amp 0.8, s1 100, s2 250, s3 400, s4 550, blen 100", extra, dparams=dparams_text(p))
    c["draw"] = p
    return c


def cases():
    return {
        "mix0_null": [
            case("mix0_null_w0", 600, "kind 0, amp 0.8, s1 100, s2 300", "dvwet 0"),
            case("mix0_null_w1", 600, "kind 0, amp 0.8, s1 100, s2 300", "dvwet 1"),
        ],
        "latency_env": [
            case("latency_env_0", 400, "kind 1, amp 0.8, impos 100", "dvsplit 0", lat=LAT_ENV),
            case("latency_env_1", 400, "kind 1, amp 0.8, impos 100", "dvsplit 1", lat=LAT_SPEC),
        ],
        "hit_once": [case("hit_once", 400, "kind 2, amp 0.8, s1 100, s2 110, s3 160, blen 100")],
        "seed_repro": [seed_case("a", 5), seed_case("b", 5), seed_case("c", 6)],
        "sleep_silent": [case("sleep_silent", 800, "kind 3")],
        "telemetry_layout": [case(
            "telemetry_layout", 700, "kind 2, amp 0.8, s1 100, blen 100",
            "dvv0 12, dvv1 64, dvv2 33, dvv3 41, dvv4 77, dvv5 5, dvv6 91, dvv7 48, dvr0 10, dvr1 20, dvr2 30, dvr3 40, dvr4 50, "
            "dvr5 60, dvr6 70, dvr7 80, dvl1 1, dvl4 1, dvsens 0.7, dvthr -30, dvchance 80, dvwet 0.75, dvseed 7, dvdrift 20")],
    }


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
                      dur_ms=c["dur"], channels=3, sr=SR, mode="nrt", probe_object="v8", timeout=300)
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


def check_latency(metas, errors):
    for tag, m in metas.items():
        want = LAT_SPEC if tag == "1" else LAT_ENV
        got = m.get("devfirst", -1) - m.get("srcfirst", -2)
        if got != want:
            errors.append(f"latency_env split {tag}: impulse delay {got} samples, want {want}")
        if abs(m.get("unity", 0) - 1.0) > 1e-6:
            errors.append(f"latency_env split {tag}: impulse gain {m.get('unity')}, want 1")
        if m.get("t_lat") != want:
            errors.append(f"latency_env split {tag}: telemetry LATENCY {m.get('t_lat')}, want {want}")
        if m.get("t_split") != int(tag):
            errors.append(f"latency_env split {tag}: telemetry SPLIT_MODE {m.get('t_split')}")
        if m.get("diffL") != 0:
            errors.append(f"latency_env split {tag}: output differs from the input delayed {want} (max {m.get('diffL')})")


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


def check_sleep(m, errors):
    if m.get("maxL", 1) != 0 or m.get("maxR", 1) != 0:
        errors.append(f"sleep_silent: output must be exact zeros (max {m.get('maxL')} / {m.get('maxR')})")
    if m.get("t_asleep") != 1:
        errors.append(f"sleep_silent: ASLEEP telemetry {m.get('t_asleep')}, want 1")
    if not (m.get("t_alive", 0) - m.get("f_alive", 0) > 20):
        errors.append(f"sleep_silent: ALIVE must keep moving while asleep ({m.get('f_alive')} -> {m.get('t_alive')})")
    if not (m.get("t_frames", 0) - m.get("f_frames", 0) > 20):
        errors.append(f"sleep_silent: FRAMES must keep moving while asleep ({m.get('f_frames')} -> {m.get('t_frames')})")


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
    if not (m.get("max_pkout", 0) > 0.5 and abs(m.get("max_pkout", 0) - m.get("max_pkdry", 0)) < 1e-6):
        errors.append(f"telemetry_layout: PK_OUT {m.get('max_pkout')} must equal PK_DRY {m.get('max_pkdry')} in the stub")
    if not (m.get("max_ringenv", 0) > 0.99):
        errors.append(f"telemetry_layout: RING_ENV never reached 1 ({m.get('max_ringenv')})")


def run_group(code, name, only_dry=False):
    errors = []
    cs = cases()[name]
    if only_dry:
        for c in cs:
            boxes, lines = device(code, c)
            patch, _s, _d = mh.build_scaffold(boxes, lines, probe_js="/tmp/x.js", probe_args=f"{c['name']} {c['lat']}", settle_ms=0,
                                              dur_ms=c["dur"], channels=3, sr=SR, mode="nrt", probe_object="v8")
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
    if name == "mix0_null":
        check_mix0_null({"0": res.get("mix0_null_w0", {}), "1": res.get("mix0_null_w1", {})}, errors)
    elif name == "latency_env":
        check_latency({"0": res.get("latency_env_0", {}), "1": res.get("latency_env_1", {})}, errors)
    elif name == "hit_once":
        check_hit_once(res.get("hit_once", {}), errors)
    elif name == "seed_repro":
        check_seed({k.split("_")[-1]: v for k, v in res.items()}, errors)
    elif name == "sleep_silent":
        check_sleep(res.get("sleep_silent", {}), errors)
    elif name == "telemetry_layout":
        check_telemetry(res.get("telemetry_layout", {}), errors)
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
