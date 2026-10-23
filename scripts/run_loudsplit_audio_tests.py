#!/usr/bin/env python3
"""Render Loud Split's gen core through the Ableton-bundled Max 9 on the shared NonRealTime harness
(scripts/max_harness.py) and check the DSP and the telemetry buffer. Max runs only in the tart VM (AGENTS.md 1a):

    scripts/vm_spectral.sh audio loudsplit [case ...]      (from the host)
    /usr/bin/python3 scripts/run_loudsplit_audio_tests.py [case ...]      (inside the VM)

Every case patches three instances of the REAL core (build_loudsplit.gen_code(): src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr +
src/spectral_split_rack.genexpr + src/loudsplit_core.genexpr with the rack template expanded, exactly what the device embeds), fed by one stimulus
gen: outsel 1 (Loud), 2 (Mid) and 3 (Quiet); the probe records them by name. Rack cases add an All instance (outsel 0) and a SELF reference (role 0).
The stimulus has a left channel x and a right channel 0.5 x. The probe (tests/loudsplit_probe.js) records Quiet L, Mid L,
Loud L, the stimulus delayed by 5120 samples, a window flag, Loud R, the SELF channel and All L.

Stimuli: mix = 500 Hz (-8 dB) + 1.5 kHz (-36 dB) + 3 kHz (-54 dB) + faint noise, times `gain`; ramp = a 1 kHz sine whose level
rises linearly in dB from -90 to 0 over the measured window; steps = a 1 kHz sine switching every 400 ms between 0.5 (-6 dB) and
0.01 (-40 dB); impulse; silent. Windows (flag): ramp 1 / 2 / 3 = first 25 % / middle 16 % / last 25 %; steps 1 = first 120 ms after a
rise, 2 = 40..160 ms after a fall, 3 = steady loud, 4 = steady quiet.

Cases:
  sum_mix50 / sum_mix0   Mix 50 % / 0 %: the three instances (each wet * mix + dry * (1 - mix) / 3) still sum to the dry input
                   delayed 5120 (< -90 dB); at Mix 0 each chain carries dry / 3 (energy 1/9)
  sum_*            Quiet + Mid + Loud null against the input delayed 5120 samples (< -90 dB): Size 1k / 2k / 4k, Relative, Tilt +/-,
                   Rise + Fall, wide knees, crossed thresholds
  partials         the loud / mid / quiet partials land in Loud / Mid / Quiet, right channel = left / 2, telemetry is live
  rel_loud / rel_quiet / abs_quiet   Relative mode keeps the split at -30 dB input, Absolute mode does not
  thr_move         a lower Higher Threshold moves the 1.5 kHz partial from Mid to Loud
  tilt_off / tilt_up   Tilt +6 dB/oct lifts the 3 kHz partial from Quiet to Mid (analysis only: the sum still nulls)
  ramp             a level ramp moves energy Quiet -> Mid -> Loud
  rise_0 / rise_16 / fall_0 / fall_16   Rise / Fall slow the move into the louder / quieter band
  silence          silent input gives exact zeros on every channel and telemetry awake = 0
  latency_<n>      an impulse comes out of the summed channels exactly 5120 samples later at every Size
  rack_*           the rack machinery: the Loud instance leads (role 1, serves every channel), Mid / Quiet / All follow its ring (role 2); s = a SELF
                   instance computing alone. rack_sum_<n> (Size 1k / 2k / 4k), rack_rel / rack_tilt / rack_riskfall / rack_cross (signal-dependent
                   settings), rack_mix_50 / rack_mix_0, rack_silence, rack_impulse (All follower, latency), rack_delay_<k> (a follower whose input
                   is delayed by k samples aligns by content), rack_delay_far (beyond the search span: it computes alone), rack_pending (no role yet:
                   silence), rack_fallback (a different input: it computes alone). Followers must equal the SELF instance (< -100 dB) and the
                   channels must null against the input.
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import spectral_common as sc

ROOT = mh.ROOT
SRC = os.path.join(ROOT, "src")
PROBE_JS = os.path.join(ROOT, "tests", "loudsplit_probe.js")
SR = mh.DEFAULT_SR
LATENCY = sc.RACK_LATENCY       # 5120: the rack machinery adds a 1024-sample margin to the largest STFT latency (4096)
PERIOD = 38400          # 800 ms at 48 kHz
FIRST_EDGE = 4800       # 100 ms
TAU = 6.283185307179586

# the cases keep their own thresholds (-24 / -48 dB, nearly instant Rise / Fall 0.13 blocks); the device defaults (Higher -30,
# Lower -85, Rise 2, Fall 8, Mix 100 %) are exercised by `sum_defaults`
DEFAULT_PARAMS = {"thrhi": -24, "thrlo": -48, "rthrhi": -12, "rthrlo": -36, "kneehi": 6, "kneelo": 6, "relmode": 0,
                  "risebl": 0.13, "fallbl": 0.13, "tiltdb": 0, "mixamt": 1}


def gen_source():
    """Exactly the gen code the device embeds (build_loudsplit.py)."""
    import build_loudsplit
    return build_loudsplit.gen_code()


def stim_code(case):
    """Stimulus gen: out1 = x (left), out2 = x delayed 5120 (or raw), out3 = window flag aligned with out2."""
    kind = case["stim"]
    head = ["History n(0);", f"Delay dlyX({LATENCY + 1});", f"Delay dlyF({LATENCY + 1});"]
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
        body += ["dlyX.write(x);", "dlyF.write(flag);", f"out2 = dlyX.read({LATENCY});", f"out3 = dlyF.read({LATENCY});"]
    else:
        body += ["dlyX.write(x);", "dlyF.write(flag);", "out2 = x;", "out3 = flag;"]
    return "\n".join(head + body) + "\n"


def build_device(code, case):
    """Instances of the real core: outsel 1 (Loud), 2 (Mid), 3 (Quiet); rack cases add outsel 0 (All) and s = a SELF Mid / Quiet reference.
    case["rack"] = False: every instance computes alone (role 0, the pre-rack behaviour); True: the Loud instance leads (role 1, serves all
    channels) and the others follow its ring (role 2), exactly what the face sets up in a rack. case["in_delay"] = {tag: samples}: that
    instance's input is delayed (its sample clock then differs from the leader's by that many samples, which the content alignment must
    find); case["in_gain"] = {tag: g}: that instance gets a slightly different input (it must fall back to computing alone)."""
    boxes = [
        mh.gen_box("obj-stim", stim_code(case), 40, 120, numinlets=1, numoutlets=3),
        mh.box("obj-half", "*~ 0.5", 40, 160, 45, numinlets=2, outlettype=["signal"]),
        mh.box("obj-scope", "buffer~ #0-loudsplitscope @samps 544", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf", "setbuffer #0-loudsplitscope", 520, 130, 220),
        mh.box("obj-scopem", "buffer~ #0-loudsplitscopem @samps 544", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf2", "setbuffer2 #0-loudsplitscopem", 520, 70, 240),
    ]
    lines = [mh.line("obj-load", 0, "obj-setbuf", 0), mh.line("obj-setbuf", 0, "obj-js", 0),
             mh.line("obj-load", 0, "obj-setbuf2", 0), mh.line("obj-setbuf2", 0, "obj-js", 0),
             mh.line("obj-stim", 0, "obj-half", 0)]
    params = dict(DEFAULT_PARAMS)
    params.update(case.get("params", {}))
    ptxt = ", ".join(f"{k} {v}" for k, v in params.items())
    rack = case.get("rack", False)
    # tag, outsel
    insts = [("q", 3), ("m", 2), ("l", 1)] + ([("a", 0), ("s", case.get("selfsel", 2))] if rack else [])
    for tag, sel in insts:
        gid = f"obj-gen-{tag}"
        x = 200 + 240 * (sel % 4)
        if rack and tag != "s":
            role, lead_tag = (1, "l") if tag == "l" else (2, "l")
        else:
            role, lead_tag = 0, tag
        serve = 7 if (rack and tag == "l") else 0
        pm = ptxt
        if tag == "s":
            pm = ptxt.replace("mixamt " + str(params["mixamt"]), "mixamt 1")     # the SELF reference computes alone, always Mix 100 %
        msg = (f"outsel {sel}, fftn {case['n']}, {pm}, ring #0-ssring{tag}, lead #0-ssring{lead_tag}, serve {serve}, epoch 1"
               + ("" if case.get("no_role") else f", role {role}"))
        if tag == "l":
            msg += ", scope #0-loudsplitscope"
        if tag == "m":
            msg += ", scope #0-loudsplitscopem"
        boxes.append(mh.box(f"obj-ring-{tag}", f"buffer~ #0-ssring{tag} @samps {sc.rack_ring_samps(3)}", 520, 160 + 30 * sel, 280, numoutlets=2, outlettype=["float", "bang"]))
        boxes.append(mh.gen_box(gid, code, x, 260))
        boxes.append(mh.msg(f"obj-params-{tag}", msg, x, 220, 330))
        lines += [mh.line("obj-load", 0, f"obj-params-{tag}", 0), mh.line(f"obj-params-{tag}", 0, gid, 0)]
        src0, src1 = ("obj-stim", 0), ("obj-half", 0)
        d = case.get("in_delay", {}).get(tag, 0)
        g = case.get("in_gain", {}).get(tag, 1.0)
        if d or g != 1.0:
            for ch, (sid, so) in enumerate((src0, src1)):
                nid = f"obj-in-{tag}{ch}"
                if d:
                    boxes.append(mh.box(nid, f"delay~ {max(d, 1)} {d}", 40 + 60 * ch, 190, 90, numinlets=2, outlettype=["signal"]))
                else:
                    boxes.append(mh.box(nid, f"*~ {g}", 40 + 60 * ch, 190, 60, numinlets=2, outlettype=["signal"]))
                lines.append(mh.line(sid, so, nid, 0))
            src0, src1 = (f"obj-in-{tag}0", 0), (f"obj-in-{tag}1", 0)
        lines += [mh.line(src0[0], src0[1], gid, 0), mh.line(src1[0], src1[1], gid, 1)]
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
    if rack:
        lines += [mh.line("obj-gen-s", 0, "obj-record", 6), mh.line("obj-gen-a", 0, "obj-record", 7)]
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
    c("sum_mix50", params={"mixamt": 0.5})
    c("sum_mix0", params={"mixamt": 0})
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
    # ---- rack sharing: the Loud instance leads (role 1), Mid / Quiet / All follow its ring (role 2); s = a SELF instance computing alone
    for n in (1024, 2048, 4096):
        c(f"rack_sum_{n}", n=n, rack=True)
    c("rack_rel", rack=True, params={"relmode": 1})
    c("rack_tilt", rack=True, params={"tiltdb": 4}, selfsel=3)
    c("rack_riskfall", rack=True, stim="steps", dur=1500, freqs="", params={"risebl": 8, "fallbl": 12})
    c("rack_cross", rack=True, params={"thrlo": -10, "thrhi": -40})
    c("rack_mix_50", rack=True, params={"mixamt": 0.5})
    c("rack_mix_0", rack=True, params={"mixamt": 0})
    c("rack_silence", stim="silent", rack=True, dur=1000, freqs="")
    for k in (37, 300, 1301):
        c(f"rack_delay_{k}", rack=True, in_delay={"m": k}, dur=2500)
    c("rack_delay_far", rack=True, in_delay={"m": 2500}, dur=3000)       # beyond the +-2048 search span: the follower computes alone
    c("rack_pending", rack=True, no_role=True, dur=800)                  # no role message yet: silence, no computing
    c("rack_fallback", rack=True, in_gain={"m": 0.97}, dur=3000)
    c("rack_impulse", stim="impulse", rack=True, settle=0, dur=400, delay=False, freqs="")
    return out


def db(x):
    return 10.0 * math.log10(max(x, 1e-300))


def run_case(code, case):
    boxes, lines = build_device(code, case)
    cmp_ch = "Q" if case.get("selfsel") == 3 else "M"
    k = case.get("in_delay", {}).get("m", 0)
    return mh.run_case(f"loudsplit_{case['name']}", boxes, lines, probe_js=PROBE_JS, probe_args=f"{cmp_ch} {k} {case['freqs']}".strip(),
                       settle_ms=case["settle"], dur_ms=case["dur"], channels=8, sr=SR)


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
    if name.startswith("rack_"):
        check_rack(case, r, errors)
        return
    if name.startswith("sum_"):
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        print(f"[{name}] null={null:.1f} dB  energyQ={r['energyQ']:.3f} energyM={r['energyM']:.3f} energyL={r['energyL']:.3f} energyDry={r['energyD']:.3f}")
        if r["energyD"] < 1e-6:
            err("stimulus silent")
        if not null < -90.0:
            err(f"Quiet + Mid + Loud must null against the input delayed 5120 (got {null:.1f} dB)")
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
            if r["scopeFrame"] < 5 or r["scopeN"] != 2048 or r["scopeAwake"] != 1 or r["scopeLat"] != LATENCY or r["scopeSel"] != 1:
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


def check_rack(case, r, errors):
    name = case["name"]

    def err(msg):
        errors.append(f"{name}: {msg}")

    cmp_ch = "Q" if case.get("selfsel") == 3 else "M"
    flags = (f"leader cmp={int(r['t_cmp'])} role={int(r['t_role'])} serve={int(r['t_serve'])} | follower({cmp_ch}) cmp={int(r['q_cmp'])} fol={int(r['q_fol'])} "
             f"aligned={int(r['q_aligned'])} fb={int(r['q_fb'])} doff={int(r['q_doff'])} lag={int(r['q_lag'])} under={r['q_under']:.1f} role={int(r['q_role'])}")
    rel = r["qsErr"] / max(r["qsRef"], 1e-300)
    base = name.startswith("rack_sum_") or name in ("rack_rel", "rack_tilt", "rack_riskfall", "rack_cross", "rack_mix_50", "rack_mix_0")
    if base:
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        print(f"[{name}] Q + M + L vs input delayed: null={null:.1f} dB; follower {cmp_ch} vs the SELF instance: err {db(rel):.1f} dB; {flags}")
        if r["energyD"] < 1e-6:
            err("stimulus silent")
        if not null < -90.0:
            err(f"Quiet + Mid + Loud must null against the input delayed {LATENCY} (got {null:.1f} dB)")
        # the SELF reference runs at Mix 100 %: only compare at Mix 100 %
        if "mix" not in name and not rel < 1e-10:
            err(f"the follower's {cmp_ch} must equal the SELF instance's (relative error energy {rel:.3g})")
        if not (r["t_cmp"] == 1 and r["t_role"] == 1 and r["q_cmp"] == 0 and r["q_fol"] == 1 and r["q_aligned"] == 1 and r["q_fb"] == 0):
            err(f"roles / alignment wrong ({flags})")
        if r["q_doff"] != 0 or r["q_under"] != 0:
            err(f"identical inputs must align with offset 0 and no underrun ({flags})")
        if name == "rack_mix_0":
            for ch in "QML":
                ratio = r[f"energy{ch}"] / max(r["energyD"], 1e-300)
                if abs(ratio - 1.0 / 9.0) > 0.003:
                    err(f"Mix 0: channel {ch} must be dry / 3 (energy ratio {ratio:.4f})")
    elif name.startswith("rack_delay_") and name != "rack_delay_far":
        k = case["in_delay"]["m"]
        print(f"[{name}] follower input delayed by {k}: follower M vs SELF delayed: err {db(rel):.1f} dB; {flags}")
        if not (r["q_fol"] == 1 and r["q_aligned"] == 1 and r["q_fb"] == 0):
            err(f"the follower must align by content ({flags})")
        if r["q_doff"] != -k:
            err(f"counter offset must be -{k}, got {int(r['q_doff'])}")
        if not rel < 1e-10:
            err(f"follower output must equal the SELF Mid delayed by {k} (relative error energy {rel:.3g})")
    elif name == "rack_delay_far":
        print(f"[{name}] follower input delayed beyond the search span: {flags}")
        if not (r["q_fb"] == 1 and r["q_cmp"] == 1):
            err(f"a follower that cannot be aligned must compute alone ({flags})")
        if not (r["energyM"] > 1e-6):
            err("the fallback must still produce its channel")
    elif name == "rack_pending":
        print(f"[{name}] before any role message: peaks Q {r['peakQ']} M {r['peakM']} L {r['peakL']} A {r['peakA']}; {flags}")
        if r["peakQ"] != 0 or r["peakM"] != 0 or r["peakL"] != 0 or r["peakA"] != 0:
            err("an instance that has not been told its role must be silent")
        if not (r["t_role"] == -1 and r["t_cmp"] == 0 and r["q_cmp"] == 0 and r["q_fol"] == 0):
            err(f"pending instances neither compute nor follow ({flags})")
    elif name == "rack_fallback":
        em, es = r["energyM"], r["qsRef"]
        print(f"[{name}] follower with a different input: {flags}; energyM/energySelf {em / max(es, 1e-300):.4f}")
        if not (r["q_fb"] == 1 and r["q_cmp"] == 1):
            err(f"a follower whose input differs must fall back to computing alone ({flags})")
        if not 0.8 < em / max(es, 1e-300) < 0.995:
            err(f"fallback output must be the split of its own (0.97x) input, not the leader's (energy ratio {em / max(es, 1e-300):.4f})")
    elif name == "rack_silence":
        print(f"[{name}] peaks Q {r['peakQ']} M {r['peakM']} L {r['peakL']} A {r['peakA']}; {flags}")
        if r["peakQ"] != 0 or r["peakM"] != 0 or r["peakL"] != 0 or r["peakA"] != 0:
            err("silence in must give exact zeros on every channel")
        if r["q_alive"] <= 0:
            err("the follower's alive counter must move in silence")
    elif name == "rack_impulse":
        lat = r["idxA"] - r["idxD"]
        print(f"[{name}] All follower: impulse in at {int(r['idxD'])}, out at {int(r['idxA'])}: latency {int(lat)}, peak {r['peakA']:.4f}; {flags}")
        if lat != LATENCY or abs(r["peakA"] - 0.5) > 0.002:
            err(f"impulse must come out of the All follower exactly {LATENCY} samples later at unity (latency {lat}, peak {r['peakA']:.4f})")


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
