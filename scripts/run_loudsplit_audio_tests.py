#!/usr/bin/env python3
"""Render Loud Split's gen core through the Ableton-bundled Max 9 on the shared NonRealTime harness
(scripts/max_harness.py) and check the DSP and the telemetry buffer. Max runs only in the tart VM (AGENTS.md 1a):

    scripts/vm_spectral.sh audio loudsplit [case ...]      (from the host)
    /usr/bin/python3 scripts/run_loudsplit_audio_tests.py [case ...]      (inside the VM)

Every case patches three instances of the REAL core (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr +
src/loudsplit_core.genexpr, exactly what the device embeds), fed by one stimulus gen: outsel 1 (Quiet), 2 (Mid) and 3 (Loud).
The stimulus has a left channel x and a right channel 0.5 x. The probe (tests/loudsplit_probe.js) records Quiet L, Mid L,
Loud L, the stimulus delayed by 4096 samples, a window flag and Loud R.

Stimuli: mix = 500 Hz (-8 dB) + 1.5 kHz (-36 dB) + 3 kHz (-54 dB) + faint noise, times `gain`; ramp = a 1 kHz sine whose level
rises linearly in dB from -90 to 0 over the measured window; steps = a 1 kHz sine switching every 400 ms between 0.5 (-6 dB) and
0.01 (-40 dB); impulse; silent. Windows (flag): ramp 1 / 2 / 3 = first 25 % / middle 16 % / last 25 %; steps 1 = first 120 ms after a
rise, 2 = 40..160 ms after a fall, 3 = steady loud, 4 = steady quiet.

Cases:
  sum_mix50 / sum_mix0   Mix 50 % / 0 %: the three instances (each wet * mix + dry * (1 - mix) / 3) still sum to the dry input
                   delayed 4096 (< -90 dB); at Mix 0 each chain carries dry / 3 (energy 1/9)
  sum_*            Quiet + Mid + Loud null against the input delayed 4096 samples (< -90 dB): Size 1k / 2k / 4k, Relative, Tilt +/-,
                   Rise + Fall, wide knees, crossed thresholds
  partials         the loud / mid / quiet partials land in Loud / Mid / Quiet, right channel = left / 2, telemetry is live
  rel_loud / rel_quiet / abs_quiet   Relative mode keeps the split at -30 dB input, Absolute mode does not
  thr_move         a lower Higher Threshold moves the 1.5 kHz partial from Mid to Loud
  tilt_off / tilt_up   Tilt +6 dB/oct lifts the 3 kHz partial from Quiet to Mid (analysis only: the sum still nulls)
  ramp             a level ramp moves energy Quiet -> Mid -> Loud
  rise_0 / rise_16 / fall_0 / fall_16   Rise / Fall slow the move into the louder / quieter band
  silence          silent input gives exact zeros on every channel and telemetry awake = 0
  latency_<n>      an impulse comes out of the summed channels exactly 4096 samples later at every Size
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
SRC = os.path.join(ROOT, "src")
PROBE_JS = os.path.join(ROOT, "tests", "loudsplit_probe.js")
SR = mh.DEFAULT_SR
LATENCY = 4096
PERIOD = 38400          # 800 ms at 48 kHz
FIRST_EDGE = 4800       # 100 ms
TAU = 6.283185307179586

# the cases keep their own thresholds (-24 / -48 dB, nearly instant Rise / Fall 0.13 blocks); the device defaults (Higher -30,
# Lower -85, Rise 2, Fall 8, Mix 100 %) are exercised by `sum_defaults`
DEFAULT_PARAMS = {"thrhi": -24, "thrlo": -48, "rthrhi": -12, "rthrlo": -36, "kneehi": 6, "kneelo": 6, "relmode": 0,
                  "risebl": 0.13, "fallbl": 0.13, "tiltdb": 0, "wetamt": 1}


def gen_source():
    parts = []
    for name in ("cepstrum_lib.genexpr", "spectral_split_lib.genexpr", "loudsplit_core.genexpr"):
        with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
            parts.append(f.read().rstrip() + "\n")
    return "\n".join(parts)


def stim_code(case):
    """Stimulus gen: out1 = x (left), out2 = x delayed 4096 (or raw), out3 = window flag aligned with out2."""
    kind = case["stim"]
    head = ["History n(0);", "Delay dlyX(4097);", "Delay dlyF(4097);"]
    body = ["dummy = in1 * 0;", "n = n + 1;", "k = n - 1;",
            # gen's own white noise (an LCG on a History left the modulus broken)
            "r = noise();", "flag = 0;"]
    if kind == "mix":
        g = case.get("gain", 1.0)
        body.append(f"x = {g} * (0.4 * sin({TAU} * 500 * k / 48000) + 0.0158 * sin({TAU} * 1500 * k / 48000) "
                    f"+ 0.002 * sin({TAU} * 3000 * k / 48000) + 0.01 * r);")
    elif kind == "ramp":
        s0 = int(SR * case["settle"] / 1000)
        d = int(SR * case["dur"] / 1000)
        body += [f"u = (k - {s0}) / {d};", "db = -90 + 90 * clip(u, 0, 1);",
                 f"x = pow(10, db / 20) * sin({TAU} * 1000 * k / 48000);",
                 "if (u > 0 && u < 0.25) { flag = 1; }",
                 "if (u >= 0.42 && u < 0.58) { flag = 2; }",
                 "if (u >= 0.75 && u <= 1) { flag = 3; }"]
    elif kind == "steps":
        body += [f"m = k - {FIRST_EDGE};", f"ph = m - {PERIOD} * floor(m / {PERIOD});",
                 "up = clip(ph / 96, 0, 1);", "dn = clip((ph - 19200) / 96, 0, 1);",
                 "g = ph < 19200 ? up : 1 - dn;",
                 "g = m < 0 ? 0 : g;",
                 f"x = (0.01 + 0.49 * g) * sin({TAU} * 1000 * k / 48000);",
                 "if (m >= 0) {",
                 "  if (ph < 5760) { flag = 1; }",
                 "  if (ph >= 21120 && ph < 26880) { flag = 2; }",
                 "  if (ph >= 12000 && ph < 17000) { flag = 3; }",
                 "  if (ph >= 28000 && ph < 34000) { flag = 4; }",
                 "}"]
    elif kind == "impulse":
        body.append("x = k == 1000 ? 0.5 : 0;")
    else:
        body.append("x = 0;")
    body.append("out1 = x;")
    if case.get("delay", True):
        body += ["dlyX.write(x);", "dlyF.write(flag);", "out2 = dlyX.read(4096);", "out3 = dlyF.read(4096);"]
    else:
        body += ["dlyX.write(x);", "dlyF.write(flag);", "out2 = x;", "out3 = flag;"]
    return "\n".join(head + body) + "\n"


def build_device(code, case):
    boxes = [
        mh.gen_box("obj-stim", stim_code(case), 40, 120, numinlets=1, numoutlets=3),
        mh.box("obj-half", "*~ 0.5", 40, 160, 45, numinlets=2, outlettype=["signal"]),
        mh.box("obj-scope", "buffer~ #0-loudsplitscope @samps 544", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf", "setbuffer #0-loudsplitscope", 520, 130, 220),
    ]
    lines = [mh.line("obj-load", 0, "obj-setbuf", 0), mh.line("obj-setbuf", 0, "obj-js", 0),
             mh.line("obj-stim", 0, "obj-half", 0)]
    params = dict(DEFAULT_PARAMS)
    params.update(case.get("params", {}))
    ptxt = ", ".join(f"{k} {v}" for k, v in params.items())
    for tag, sel in (("q", 1), ("m", 2), ("l", 3)):
        gid = f"obj-gen-{tag}"
        x = 200 + 240 * (sel - 1)
        boxes.append(mh.gen_box(gid, code, x, 260))
        boxes.append(mh.msg(f"obj-params-{tag}", f"outsel {sel}, fftn {case['n']}, {ptxt}", x, 220, 330))
        lines += [mh.line("obj-load", 0, f"obj-params-{tag}", 0), mh.line(f"obj-params-{tag}", 0, gid, 0),
                  mh.line("obj-stim", 0, gid, 0), mh.line("obj-half", 0, gid, 1)]
        if tag == "l":
            boxes.append(mh.msg("obj-bind", "scope #0-loudsplitscope", 200, 190, 200))
            lines += [mh.line("obj-load", 0, "obj-bind", 0), mh.line("obj-bind", 0, gid, 0)]
    lines += [
        mh.line("obj-gen-q", 0, "obj-record", 0),
        mh.line("obj-gen-m", 0, "obj-record", 1),
        mh.line("obj-gen-l", 0, "obj-record", 2),
        mh.line("obj-stim", 1, "obj-record", 3),
        mh.line("obj-stim", 2, "obj-record", 4),
        mh.line("obj-gen-l", 1, "obj-record", 5),
        mh.line("obj-gen-q", 0, "obj-mute-l", 0),
        mh.line("obj-gen-m", 0, "obj-mute-r", 0),
    ]
    return boxes, lines


def cases():
    out = []

    def c(name, **kw):
        d = {"name": name, "stim": "mix", "n": 2048, "settle": 300, "dur": 1000, "delay": True, "params": {}, "freqs": "500 1500 3000"}
        d.update(kw)
        out.append(d)

    c("sum_1024", n=1024)
    c("sum_2048")
    c("sum_4096", n=4096)
    c("sum_2048_rel", params={"relmode": 1})
    c("sum_2048_tilt_up", params={"tiltdb": 4})
    c("sum_2048_tilt_down", params={"tiltdb": -5})
    c("sum_2048_riskfall", stim="steps", dur=1500, freqs="", params={"risebl": 8, "fallbl": 12})
    c("sum_2048_knee", params={"kneehi": 24, "kneelo": 1})
    c("sum_defaults", params={"thrhi": -30, "thrlo": -85, "risebl": 2, "fallbl": 8})
    c("sum_mix50", params={"wetamt": 0.5})
    c("sum_mix0", params={"wetamt": 0})
    c("sum_2048_cross", params={"thrlo": -10, "thrhi": -40})
    c("partials")
    c("rel_loud", params={"relmode": 1})
    c("rel_quiet", params={"relmode": 1}, gain=0.03)
    c("abs_quiet", gain=0.03)
    c("thr_move", params={"thrhi": -50})
    c("tilt_off", params={"thrlo": -52})
    c("tilt_up", params={"thrlo": -52, "tiltdb": 6})
    c("ramp", stim="ramp", dur=2000, freqs="", params={"thrhi": -30, "thrlo": -60})
    for name, p in (("rise_0", {}), ("rise_16", {"risebl": 16}), ("fall_0", {}), ("fall_16", {"fallbl": 16})):
        c(name, stim="steps", dur=1500, freqs="", params=p)
    c("silence", stim="silent", dur=1000, freqs="")
    for n in (1024, 2048, 4096):
        c(f"latency_{n}", stim="impulse", n=n, settle=0, dur=400, delay=False, freqs="")
    return out


def db(x):
    return 10.0 * math.log10(max(x, 1e-300))


def run_case(code, case):
    boxes, lines = build_device(code, case)
    return mh.run_case(f"loudsplit_{case['name']}", boxes, lines, probe_js=PROBE_JS, probe_args=case["freqs"],
                       settle_ms=case["settle"], dur_ms=case["dur"], channels=6, sr=SR)


def share(r, ch, i):
    """Share of tone i (0 = 500 Hz, 1 = 1.5 kHz, 2 = 3 kHz) in channel ch (Q / M / L): amplitude / dry amplitude."""
    d = r[f"toneD{i}"]
    return r[f"tone{ch}{i}"] / d if d > 0 else 0.0


def fshare(r, flag, ch):
    a, b, c = r[f"fq{flag}"], r[f"fm{flag}"], r[f"fl{flag}"]
    t = a + b + c
    return {"Q": a, "M": b, "L": c}[ch] / t if t > 0 else 0.0


def check(case, r, store, errors):
    name = case["name"]

    def err(msg):
        errors.append(f"{name}: {msg}")

    if r.get("nan", 1) != 0:
        err(f"NaN / inf samples ({r.get('nan')})")
    if r.get("harness_sr") and abs(r["harness_sr"] - SR) > 1:
        err(f"sample rate {r['harness_sr']}")
    if name.startswith("sum_"):
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        print(f"[{name}] null={null:.1f} dB  energyQ={r['energyQ']:.3f} energyM={r['energyM']:.3f} energyL={r['energyL']:.3f} energyDry={r['energyD']:.3f}")
        if r["energyD"] < 1e-6:
            err("stimulus silent")
        if not null < -90.0:
            err(f"Quiet + Mid + Loud must null against the input delayed 4096 (got {null:.1f} dB)")
        if r["energyQ"] + r["energyM"] + r["energyL"] <= 0:
            err("the channels must carry signal")
        if name == "sum_mix0":
            for ch in "QML":
                ratio = r[f"energy{ch}"] / max(r["energyD"], 1e-300)
                print(f"[{name}] energy {ch} / dry = {ratio:.4f} (want 1/9 = 0.1111)")
                if abs(ratio - 1.0 / 9.0) > 0.003:
                    err(f"Mix 0: channel {ch} must be dry / 3 (energy ratio {ratio:.4f})")
    elif name in ("partials", "rel_loud", "rel_quiet", "thr_move", "tilt_off", "tilt_up", "abs_quiet"):
        s = {(ch, i): share(r, ch, i) for ch in "QML" for i in range(3)}
        txt = "  ".join(f"{f}: Q {s['Q', i]:.3f} M {s['M', i]:.3f} L {s['L', i]:.3f}" for i, f in enumerate(("500 Hz", "1.5 kHz", "3 kHz")))
        print(f"[{name}] {txt}  R/L={r['ratioR']:.3f}")
        want = {
            "partials": [("L", 0), ("M", 1), ("Q", 2)],
            "rel_loud": [("L", 0), ("M", 1), ("Q", 2)],
            "rel_quiet": [("L", 0), ("M", 1), ("Q", 2)],
            "thr_move": [("L", 0), ("L", 1)],
            "tilt_off": [("Q", 2)],
            "tilt_up": [("M", 2)],
        }.get(name, [])
        for ch, i in want:
            # tilt_up: the Hann neighbours of the 3 kHz bin sit 6 dB lower, in the Lower knee, so about 20 % stays in Quiet
            if not s[ch, i] > (0.75 if name == "tilt_up" else 0.9):
                err(f"tone {i} must land in {ch} (share {s[ch, i]:.3f})")
        if name == "abs_quiet":
            # 500 Hz is now -38 dB (Mid), 1.5 kHz -66 dB (Quiet): no longer Loud
            if not (s["L", 0] < 0.1 and s["M", 0] > 0.8):
                err(f"Absolute mode: the 500 Hz tone at -38 dB belongs to Mid (L {s['L', 0]:.3f}, M {s['M', 0]:.3f})")
        if name in ("partials", "rel_loud"):
            if abs(r["ratioR"] - 0.5) > 0.02:
                err(f"stereo image: right/left must stay 0.5 (got {r['ratioR']:.3f})")
        if name in ("partials", "rel_loud"):
            tele = (f"frame={int(r['scopeFrame'])} N={int(r['scopeN'])} awake={int(r['scopeAwake'])} lat={int(r['scopeLat'])} sel={int(r['scopeSel'])} "
                    f"pre={r['scopePreMax']:.3f} q={r['scopeQMax']:.3f} m={r['scopeMMax']:.3f} l={r['scopeLMax']:.3f} "
                    f"thi={r['scopeThi']:.2f} tlo={r['scopeTlo']:.2f} lmax={r['scopeLmax']:.2f} mean={r['scopeMean']:.3f}")
            print(f"[{name}] telemetry {tele}")
            if r["scopeFrame"] < 5 or r["scopeN"] != 2048 or r["scopeAwake"] != 1 or r["scopeLat"] != LATENCY or r["scopeSel"] != 3:
                err(f"telemetry scalars wrong ({tele})")
            if not (r["scopePreMax"] > 0.3 and r["scopeLMax"] > 0.3 and r["scopeMMax"] > 0.1 and r["scopeQMax"] > 0.1):
                err(f"telemetry columns empty ({tele})")
            if name == "partials" and (abs(r["scopeThi"] + 24) > 0.01 or abs(r["scopeTlo"] + 48) > 0.01):
                err(f"effective thresholds must be -24 / -48 dB ({tele})")
            if name == "rel_loud":
                if abs(r["scopeThi"] - r["scopeLmax"] + 12) > 0.01 or abs(r["scopeTlo"] - r["scopeLmax"] + 36) > 0.01 or not -14 < r["scopeLmax"] < -2:
                    err(f"Relative thresholds must follow the loudest bin: thi - lmax = -12, tlo - lmax = -36 ({tele})")
            if not 0.2 < r["scopeMean"] < 1.0:
                err(f"mean Loud mask out of range ({tele})")
    elif name == "ramp":
        q1, m2, l3 = fshare(r, 1, "Q"), fshare(r, 2, "M"), fshare(r, 3, "L")
        print(f"[ramp] first quarter Quiet share {q1:.3f}  middle Mid share {m2:.3f}  last quarter Loud share {l3:.3f}  "
              f"(middle Q {fshare(r, 2, 'Q'):.3f} L {fshare(r, 2, 'L'):.3f})")
        if min(r["fn1"], r["fn2"], r["fn3"]) < 1000:
            err("window flags missing")
        if not (q1 > 0.9 and m2 > 0.8 and l3 > 0.85):
            err(f"energy must move Quiet -> Mid -> Loud as the level rises (Quiet {q1:.3f}, Mid {m2:.3f}, Loud {l3:.3f})")
    elif name in ("rise_0", "rise_16", "fall_0", "fall_16"):
        l1, m1 = fshare(r, 1, "L"), fshare(r, 1, "M")
        l2, m2 = fshare(r, 2, "L"), fshare(r, 2, "M")
        l3, m4 = fshare(r, 3, "L"), fshare(r, 4, "M")
        print(f"[{name}] after a rise: Loud {l1:.3f} Mid {m1:.3f}   after a fall: Loud {l2:.3f} Mid {m2:.3f}   steady: loud -> Loud {l3:.3f}, quiet -> Mid {m4:.3f}")
        store[name] = (l1, l2)
        if min(r["fn1"], r["fn2"], r["fn3"], r["fn4"]) < 1000:
            err("window flags missing")
        if name in ("rise_0", "fall_0") and not (l3 > 0.85 and m4 > 0.85):
            err(f"steady states: loud tone Loud {l3:.3f}, quiet tone Mid {m4:.3f}")
    elif name == "silence":
        print(f"[silence] peakQ={r['peakQ']} peakM={r['peakM']} peakL={r['peakL']} telemetry awake={int(r['scopeAwake'])} preMax={r['scopePreMax']}")
        if r["peakQ"] != 0 or r["peakM"] != 0 or r["peakL"] != 0:
            err("silence in must give exact zeros on every channel")
        if r["scopeAwake"] != 0 or r["scopePreMax"] != 0:
            err("the telemetry must report the device asleep with empty columns")
    elif name.startswith("latency_"):
        lat = r["idxS"] - r["idxD"]
        print(f"[{name}] impulse in at {int(r['idxD'])}, out at {int(r['idxS'])}: latency {int(lat)} samples, peak {r['peakS']:.4f}")
        if lat != LATENCY:
            err(f"latency must be exactly {LATENCY} samples (got {lat})")
        if abs(r["peakS"] - 0.5) > 0.002:
            err(f"impulse must come out at unity (peak {r['peakS']:.4f})")


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"SKIP: Max binary not found at {mh.MAX_BIN}")
        sys.exit(0)
    wanted = set(sys.argv[1:])
    code = gen_source()
    errors = []
    store = {}
    for case in cases():
        if wanted and case["name"] not in wanted:
            continue
        try:
            r = run_case(code, case)
        except Exception as ex:  # noqa: BLE001
            errors.append(f"{case['name']}: {ex}")
            print(f"[{case['name']}] ERROR {ex}")
            continue
        check(case, r, store, errors)
    if "rise_0" in store and "rise_16" in store:
        a, b = store["rise_0"][0], store["rise_16"][0]
        print(f"[rise] Loud share in the 120 ms after a rise: Rise 0 {a:.3f}  Rise 16 {b:.3f}")
        if not b < a - 0.15:
            errors.append(f"rise: Rise 16 must delay the move into Loud ({a:.3f} -> {b:.3f})")
    if "fall_0" in store and "fall_16" in store:
        a, b = store["fall_0"][1], store["fall_16"][1]
        print(f"[fall] Loud share 40..160 ms after a fall: Fall 0 {a:.3f}  Fall 16 {b:.3f}")
        if not b > a + 0.15:
            errors.append(f"fall: Fall 16 must keep the bins in Loud longer ({a:.3f} -> {b:.3f})")
    if errors:
        print("\nFAILED:")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("All Real Max 9 Loud Split audio and telemetry tests passed!")


if __name__ == "__main__":
    main()
