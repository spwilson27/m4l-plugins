#!/usr/bin/env python3
"""Render Transient Split's gen core through the Ableton-bundled Max 9 on the shared NonRealTime harness
(scripts/max_harness.py) and check the DSP and the telemetry buffer. Max runs only in the tart VM (AGENTS.md 1a):

    scripts/vm_spectral.sh audio transplit [case ...]      (from the host)
    /usr/bin/python3 scripts/run_transplit_audio_tests.py [case ...]      (inside the VM)

Every case patches three instances of the REAL core (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr +
src/transplit_core.genexpr, exactly what the device embeds), fed by one stimulus gen: outsel 1 (Transients), outsel 2 (Tones)
and outsel 0 (All = the sum of both masks). The stimulus has a left channel x and a right channel 0.5 x. The probe
(tests/transplit_probe.js) records Transients L, Tones L, the stimulus delayed by 4096 samples, a window flag, All L and
Transients R.

Stimuli: drums = decaying noise bursts every 400 ms (tau 60 ms) over a steady 440 Hz sine, noise = steady white noise,
impulse = one impulse, silent. The window flag marks the first 40 ms after each burst (1) and 200..360 ms after it (2).

Cases:
  sum_<n>_perc / sum_1024_noise   Transients + Tones null against the input delayed 4096 samples (< -90 dB) at Size 512 / 1k / 2k / 4k
  drums_perc / drums_noise        default Size 1k: the first 40 ms of each burst land mostly in Transients, the sine in the quiet
                                  gap stays in Tones, the right channel is half the left (stereo image kept), telemetry is live
  bias_lo / bias_mid / bias_hi    Analysis Bias -80 / 0 / +80 %: the Transients share of the output energy rises
  noise_perc / noise_noise        steady white noise: Perc keeps it in Tones, Noise sends it to Transients
  blend_hi / blend_lo             Blend 100 % silences Tones, Blend 0 % silences Transients
  mix_50 / mix_0                  Transients + Tones at Mix 50 % null vs 0.5 wet + 0.5 dry (< -90 dB); Mix 0 % = dry delayed 4096
  silence                         silent input gives exact zeros on every channel and telemetry awake = 0
  latency_<n>                     an impulse comes out of Output = All exactly 4096 samples later at every Size
"""

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import spectral_common as sc

ROOT = mh.ROOT
SRC = os.path.join(ROOT, "src")
PROBE_JS = os.path.join(ROOT, "tests", "transplit_probe.js")
SR = mh.DEFAULT_SR
LATENCY = sc.RACK_LATENCY       # 5120: the rack machinery adds a 1024-sample margin to the largest STFT latency (4096)
PERIOD = 19200          # 400 ms at 48 kHz
FIRST_ONSET = 4800      # 100 ms


def gen_source():
    """Exactly the gen code the device embeds (build_transplit.py)."""
    import build_transplit
    return build_transplit.gen_code()


def stim_code(kind, delay_dry):
    """Stimulus gen: out1 = x (left), out2 = x delayed 4096 (or raw), out3 = window flag aligned with out2."""
    head = ["History n(0);", f"Delay dlyX({LATENCY + 1});", f"Delay dlyF({LATENCY + 1});"]
    body = ["dummy = in1 * 0;", "n = n + 1;", "k = n - 1;",
            f"m = k - {FIRST_ONSET};", f"ph = m - {PERIOD} * floor(m / {PERIOD});",
            # gen's own white noise (an LCG on a History left the modulus broken: floor() of the big product never wrapped)
            "r = noise();",
            "env = m >= 0 ? exp(0 - ph / 2880) : 0;",
            "flag = 0;",
            "if (m >= 0) {", "  if (ph < 1920) { flag = 1; }", "  if (ph >= 9600 && ph < 17280) { flag = 2; }", "}"]
    if kind == "drums":
        body.append("x = 0.1 * sin(6.283185307179586 * 440 * k / 48000) + 0.5 * env * r;")
    elif kind == "noise":
        body.append("x = 0.3 * r;")
    elif kind == "impulse":
        body.append("x = k == 1000 ? 0.5 : 0;")
    else:
        body.append("x = 0;")
    body.append("out1 = x;")
    if delay_dry:
        body += ["dlyX.write(x);", "dlyF.write(flag);", f"out2 = dlyX.read({LATENCY});", f"out3 = dlyF.read({LATENCY});"]
    else:
        body += ["dlyX.write(x);", "dlyF.write(flag);", "out2 = x;", "out3 = flag;"]
    return "\n".join(head + body) + "\n"


def build_device(code, case):
    """Three instances of the real core: outsel 1 (Transients), outsel 2 (Tones), outsel 0 (All). case["rack"] = False: all three compute alone
    (role 0, the pre-rack behaviour); True: the Transients instance leads (role 1, serves both channels) and the other two follow its ring
    (role 2, lead = its ring), exactly what the face sets up in a rack. case["in_delay"] = {tag: samples}: that instance's input is delayed
    (its sample clock then differs from the leader's by that many samples, which the content alignment must find); case["in_gain"] = {tag: g}:
    that instance gets a slightly different input (it must fall back to computing alone)."""
    boxes = [
        mh.gen_box("obj-stim", stim_code(case["stim"], case.get("delay", True)), 40, 120, numinlets=1, numoutlets=3),
        mh.box("obj-half", "*~ 0.5", 40, 160, 45, numinlets=2, outlettype=["signal"]),
        mh.box("obj-scope", "buffer~ #0-transplitscope @samps 800", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf", "setbuffer #0-transplitscope", 520, 130, 220),
    ]
    lines = [mh.line("obj-load", 0, "obj-setbuf", 0), mh.line("obj-setbuf", 0, "obj-js", 0),
             mh.line("obj-stim", 0, "obj-half", 0)]
    boxes += [mh.box("obj-scopeq", "buffer~ #0-transplitscopeq @samps 800", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
              mh.msg("obj-setbuf2", "setbuffer2 #0-transplitscopeq", 520, 70, 240)]
    lines += [mh.line("obj-load", 0, "obj-setbuf2", 0), mh.line("obj-setbuf2", 0, "obj-js", 0)]
    rack = case.get("rack", False)
    for tag, sel in (("t", 1), ("q", 2), ("a", 0), ("s", 2)):
        gid = f"obj-gen-{tag}"
        mixv = case["mix"] if sel != 0 else 1.0        # the All instance is the Mix 100 % reference
        if tag == "s":
            mixv = 1.0                                  # the SELF reference computes alone, always Mix 100 %
        if rack and tag != "s":
            role, lead_tag = (1, "t") if tag == "t" else (2, "t")
        else:
            role, lead_tag = 0, tag
        serve = 3 if (rack and tag == "t") else 0
        params = (f"outsel {sel}, fftn {case['n']}, ttype {case['ttype']}, anbias {case['bias']}, tdecay 8, tsmooth 1.5, tiltamt 0, "
                  f"tmode 0, blendamt {case['blend']}, mixamt {mixv}, ring #0-ssring{tag}, lead #0-ssring{lead_tag}, serve {serve}, epoch 1"
                  + ("" if case.get("no_role") else ", ")
                  + ("" if case.get("no_role") else f"role {role}"))
        if tag == "t":
            params += ", scope #0-transplitscope"
        if tag == "q":
            params += ", scope #0-transplitscopeq"
        boxes.append(mh.box(f"obj-ring-{tag}", f"buffer~ #0-ssring{tag} @samps {sc.rack_ring_samps(2)}", 520, 160 + 30 * sel, 280, numoutlets=2, outlettype=["float", "bang"]))
        boxes.append(mh.gen_box(gid, code, 200 + 240 * (sel % 3), 260))
        boxes.append(mh.msg(f"obj-params-{tag}", params, 200 + 240 * (sel % 3), 220, 330))
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
        if tag == "t":
            lines += [mh.line("obj-load", 0, "obj-params-t", 0)]
    lines += [
        mh.line("obj-gen-s", 0, "obj-record", 6),
        mh.line("obj-gen-t", 0, "obj-record", 0),
        mh.line("obj-gen-q", 0, "obj-record", 1),
        mh.line("obj-stim", 1, "obj-record", 2),
        mh.line("obj-stim", 2, "obj-record", 3),
        mh.line("obj-gen-a", 0, "obj-record", 4),
        mh.line("obj-gen-t", 1, "obj-record", 5),
        mh.line("obj-gen-t", 0, "obj-mute-l", 0),
        mh.line("obj-gen-q", 0, "obj-mute-r", 0),
    ]
    return boxes, lines


def cases():
    out = []

    def c(name, **kw):
        d = {"name": name, "stim": "drums", "n": 1024, "ttype": 0, "bias": 0, "blend": 0.5, "mix": 1.0, "settle": 300, "dur": 1500, "delay": True}
        d.update(kw)
        out.append(d)

    for n in (512, 1024, 2048, 4096):
        c(f"sum_{n}_perc", n=n)
    c("sum_1024_noise", ttype=1)
    c("drums_perc")
    c("drums_noise", ttype=1)
    c("bias_lo", bias=-0.8)
    c("bias_mid")
    c("bias_hi", bias=0.8)
    c("noise_perc", stim="noise", dur=1000)
    c("noise_noise", stim="noise", ttype=1, dur=1000)
    c("silence", stim="silent", dur=1000)
    c("blend_hi", blend=1.0)                  # Blend 100 %: only the transient portions
    c("blend_lo", blend=0.0)                  # Blend 0 %: only the tone portions
    c("mix_50", blend=1.0, mix=0.5)           # Transients + Tones at Mix 50 % = 0.5 wet (All instance) + 0.5 dry
    c("mix_0", blend=1.0, mix=0.0)            # Mix 0 %: the dry input delayed 4096
    for n in (512, 1024, 2048, 4096):
        c(f"latency_{n}", stim="impulse", n=n, settle=0, dur=400, delay=False)
    # ---- rack sharing: the Transients instance leads (role 1), Tones and All follow its ring (role 2); s = a SELF instance computing alone
    for n in (512, 1024, 2048, 4096):
        c(f"rack_sum_{n}", n=n, rack=True)
    c("rack_noise", stim="noise", ttype=1, rack=True, dur=1000)
    c("rack_silence", stim="silent", rack=True, dur=1000)
    c("rack_blend", blend=1.0, rack=True)
    c("rack_mix_50", blend=1.0, mix=0.5, rack=True)
    c("rack_mix_0", blend=1.0, mix=0.0, rack=True)
    for k in (37, 300, 1301):
        c(f"rack_delay_{k}", rack=True, in_delay={"q": k}, dur=2500)
    c("rack_delay_far", rack=True, in_delay={"q": 2500}, dur=3000)       # beyond the +-2048 search span: the follower computes alone
    c("rack_pending", rack=True, no_role=True, dur=800)                  # no role message yet: silence, no computing
    c("rack_fallback", rack=True, in_gain={"q": 0.97}, dur=3000)
    c("rack_impulse", stim="impulse", rack=True, settle=0, dur=400, delay=False)
    return out


def db(x):
    return 10.0 * math.log10(max(x, 1e-300))


def run_case(code, case):
    boxes, lines = build_device(code, case)
    d = case.get("in_delay", {}).get("q", 0)
    return mh.run_case(f"transplit_{case['name']}", boxes, lines, probe_js=PROBE_JS, probe_args=f"{case['stim']} {d}",
                       settle_ms=case["settle"], dur_ms=case["dur"], channels=7, sr=SR)


def frac(a, b):
    return a / (a + b) if a + b > 0 else 0.0


def check(case, r, store, errors):
    name = case["name"]

    def err(msg):
        errors.append(f"{name}: {msg}")

    if r.get("nan", 1) != 0:
        err(f"NaN / inf samples ({r.get('nan')}: T {r.get('nanT')} Q {r.get('nanQ')} dry {r.get('nanD')} flag {r.get('nanF')} A {r.get('nanA')} TR {r.get('nanTR')}; d100={r.get('d100')} d30000={r.get('d30000')})")
    if r.get("harness_sr") and abs(r["harness_sr"] - SR) > 1:
        err(f"sample rate {r['harness_sr']}")
    if name.startswith("rack_"):
        check_rack(case, r, errors)
        return
    if name.startswith("sum_"):
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        print(f"[{name}] null={null:.1f} dB  energyT={r['energyT']:.3f} energyQ={r['energyQ']:.3f} energyDry={r['energyD']:.3f}")
        if r["energyD"] < 1.0:
            err("stimulus silent")
        if not null < -90.0:
            err(f"Transients + Tones must null against the input delayed 4096 (got {null:.1f} dB)")
        if r["energyT"] <= 0 or r["energyQ"] <= 0:
            err("both channels must carry signal")
    elif name in ("drums_perc", "drums_noise"):
        onset = frac(r["onsetT"], r["onsetQ"])
        gap_tone = frac(r["gapQ"], r["gapT"])
        tot = frac(r["energyT"], r["energyQ"])
        print(f"[{name}] onset Transients share={onset:.3f}  gap Tones share={gap_tone:.3f}  total Transients share={tot:.3f}  "
              f"R/L={r['ratioR']:.3f}  windows {int(r['onsetN'])}/{int(r['gapN'])} samples")
        if r["onsetN"] < 1000 or r["gapN"] < 1000:
            err("window flags missing")
        if not onset > 0.5:
            err(f"most of a burst's first 40 ms must land in Transients (got {onset:.3f})")
        if not gap_tone > (0.9 if name == "drums_perc" else 0.8):
            err(f"the steady sine must stay in Tones (got {gap_tone:.3f})")
        if abs(r["ratioR"] - 0.5) > 0.02:
            err(f"stereo image: right/left must stay 0.5 (got {r['ratioR']:.3f})")
        tele = (f"frame={int(r['scopeFrame'])} N={int(r['scopeN'])} awake={int(r['scopeAwake'])} lat={int(r['scopeLat'])} sel={int(r['scopeSel'])} "
                f"preMax={r['scopePreMax']:.3f} trMax={r['scopeTrMax']:.3f} toneMax={r['scopeToneMax']:.3f} fracMax={r['scopeFracMax']:.3f}")
        print(f"[{name}] telemetry {tele}")
        if not (r["waveMaxT"] > 0 and r["waveMaxQ"] > 0 and r["waveMaxPT"] > 0 and r["waveMaxPQ"] > 0):
            err(f"waveform ring empty (post {r['waveMaxT']}/{r['waveMaxQ']} pre {r['waveMaxPT']}/{r['waveMaxPQ']})")
        if r["scopeFrame"] < 5 or r["scopeN"] != 1024 or r["scopeAwake"] != 1 or r["scopeLat"] != LATENCY or r["scopeSel"] != 1:
            err(f"telemetry scalars wrong ({tele})")
        # the probe reads the buffer once, at the end of the window (a burst may or may not be playing then):
        # only the input and Tones columns are guaranteed here, the Transients columns are checked in noise_noise
        if not (r["scopePreMax"] > 0.3 and r["scopeToneMax"] > 0.1):
            err(f"telemetry columns empty ({tele})")
    elif name.startswith("bias_"):
        tot = frac(r["energyT"], r["energyQ"])
        store[name] = tot
        print(f"[{name}] total Transients share={tot:.3f}")
    elif name in ("noise_perc", "noise_noise"):
        tot = frac(r["energyT"], r["energyQ"])
        print(f"[{name}] steady noise: Transients share={tot:.3f}")
        if name == "noise_perc" and not tot < 0.1:
            err(f"Perc: steady noise must stay out of Transients (got {tot:.3f})")
        if name == "noise_noise" and not tot > 0.8:
            err(f"Noise: steady noise must go to Transients (got {tot:.3f})")
        if name == "noise_noise":
            tele = (f"trMax={r['scopeTrMax']:.3f} fracMax={r['scopeFracMax']:.3f} trMean={r['scopeTrMean']:.3f}")
            print(f"[{name}] telemetry {tele}")
            if not (r["scopeTrMax"] > 0.1 and r["scopeFracMax"] > 0.5 and r["scopeTrMean"] > 0.5):
                err(f"Transients telemetry columns must show steady noise ({tele})")
    elif name in ("blend_hi", "blend_lo"):
        tot = frac(r["energyT"], r["energyQ"])
        print(f"[{name}] Transients share={tot:.4f} peakT={r['peakT']:.4f} peakQ={r['peakQ']:.6f}")
        if name == "blend_hi" and not (tot > 0.99999 and r["peakT"] > 0.01):
            err(f"Blend 100 %: Tones must be silent (Transients share {tot:.6f})")
        if name == "blend_lo" and not (tot < 0.00001 and r["peakQ"] > 0.01):
            err(f"Blend 0 %: Transients must be silent (Transients share {tot:.6f})")
    elif name in ("mix_50", "mix_0"):
        if name == "mix_50":
            null = db(r["mixNullE"] / max(r["mixRefE"], 1e-300))
            what = "T + Q vs 0.5 wet + 0.5 dry"
        else:
            null = db(r["nullE"] / max(r["energyD"], 1e-300))
            what = "T + Q vs dry delayed 4096"
        print(f"[{name}] {what}: null={null:.1f} dB")
        if r["energyD"] < 1.0:
            err("stimulus silent")
        if not null < -90.0:
            err(f"{what} must null (got {null:.1f} dB)")
    elif name == "silence":
        print(f"[silence] peakT={r['peakT']} peakQ={r['peakQ']} peakA={r['peakA']} telemetry awake={int(r['scopeAwake'])} preMax={r['scopePreMax']}")
        if r["peakT"] != 0 or r["peakQ"] != 0 or r["peakA"] != 0:
            err("silence in must give exact zeros on every channel")
        if r["scopeAwake"] != 0 or r["scopePreMax"] != 0:
            err("the telemetry must report the device asleep with empty columns")
    elif name.startswith("latency_"):
        lat = r["idxA"] - r["idxD"]
        print(f"[{name}] impulse in at {int(r['idxD'])}, out at {int(r['idxA'])}: latency {int(lat)} samples, peak {r['peakA']:.4f}")
        if lat != LATENCY:
            err(f"latency must be exactly {LATENCY} samples (got {lat})")
        if abs(r["peakA"] - 0.5) > 0.002:
            err(f"impulse must come out at unity (peak {r['peakA']:.4f})")


def check_rack(case, r, errors):
    name = case["name"]

    def err(msg):
        errors.append(f"{name}: {msg}")

    if r.get("nan", 1) != 0:
        err(f"NaN / inf samples ({r.get('nan')})")
    flags = (f"leader cmp={int(r['t_cmp'])} role={int(r['t_role'])} serve={int(r['t_serve'])} | follower cmp={int(r['q_cmp'])} fol={int(r['q_fol'])} "
             f"aligned={int(r['q_aligned'])} fb={int(r['q_fb'])} doff={int(r['q_doff'])} lag={int(r['q_lag'])} under={r['q_under']:.1f} role={int(r['q_role'])}")
    rel = r["qsErr"] / max(r["qsRef"], 1e-300)
    if name.startswith("rack_sum_") or name in ("rack_blend", "rack_mix_50", "rack_mix_0"):
        if name == "rack_mix_50":
            null = db(r["mixNullE"] / max(r["mixRefE"], 1e-300))
            what = "T + Q vs 0.5 wet + 0.5 dry"
        elif name == "rack_mix_0":
            null = db(r["nullE"] / max(r["energyD"], 1e-300))
            what = "T + Q vs dry delayed"
        elif name == "rack_blend":
            null = -999.0
            what = "Blend 100 %"
        else:
            null = db(r["nullE"] / max(r["energyD"], 1e-300))
            what = "T + Q vs input delayed"
        print(f"[{name}] {what}: null={null:.1f} dB; follower Tones vs the SELF instance: err {db(rel):.1f} dB; {flags}")
        if r["energyD"] < 1.0:
            err("stimulus silent")
        if name != "rack_blend" and not null < -90.0:
            err(f"{what} must null (got {null:.1f} dB)")
        if name == "rack_blend":
            tot = frac(r["energyT"], r["energyQ"])
            if not (tot > 0.99999 and r["peakT"] > 0.01):
                err(f"Blend 100 %: Tones must be silent (Transients share {tot:.6f})")
        if name != "rack_mix_50" and name != "rack_mix_0" and name != "rack_blend" and not rel < 1e-10:
            err(f"the follower's Tones must equal the SELF instance's (relative error energy {rel:.3g})")
        if not (r["t_cmp"] == 1 and r["t_role"] == 1 and r["q_cmp"] == 0 and r["q_fol"] == 1 and r["q_aligned"] == 1 and r["q_fb"] == 0):
            err(f"roles / alignment wrong ({flags})")
        if r["q_doff"] != 0 or r["q_under"] != 0:
            err(f"identical inputs must align with offset 0 and no underrun ({flags})")
    elif name.startswith("rack_delay_") and name != "rack_delay_far":
        k = case["in_delay"]["q"]
        print(f"[{name}] follower input delayed by {k}: follower Tones vs SELF delayed: err {db(rel):.1f} dB; {flags}")
        if not (r["q_fol"] == 1 and r["q_aligned"] == 1 and r["q_fb"] == 0):
            err(f"the follower must align by content ({flags})")
        if r["q_doff"] != -k:
            err(f"counter offset must be -{k}, got {int(r['q_doff'])}")
        if not rel < 1e-10:
            err(f"follower output must equal the SELF Tones delayed by {k} (relative error energy {rel:.3g})")
    elif name == "rack_delay_far":
        print(f"[{name}] follower input delayed beyond the search span: {flags}")
        if not (r["q_fb"] == 1 and r["q_cmp"] == 1):
            err(f"a follower that cannot be aligned must compute alone ({flags})")
        if not (r["energyQ"] > 1.0):
            err("the fallback must still produce its channel")
    elif name == "rack_pending":
        print(f"[{name}] before any role message: peaks T {r['peakT']} Q {r['peakQ']} A {r['peakA']}; {flags}")
        if r["peakT"] != 0 or r["peakQ"] != 0 or r["peakA"] != 0:
            err("an instance that has not been told its role must be silent")
        if not (r["t_role"] == -1 and r["t_cmp"] == 0 and r["q_cmp"] == 0 and r["q_fol"] == 0):
            err(f"pending instances neither compute nor follow ({flags})")
    elif name == "rack_fallback":
        eq, es = r["energyQ"], r["qsRef"]
        print(f"[{name}] follower with a different input: {flags}; energyQ/energySelf {eq / max(es, 1e-300):.4f}")
        if not (r["q_fb"] == 1 and r["q_cmp"] == 1):
            err(f"a follower whose input differs must fall back to computing alone ({flags})")
        if not 0.85 < eq / max(es, 1e-300) < 0.97:
            err(f"fallback output must be the split of its own (0.97x) input, not the leader's (energy ratio {eq / max(es, 1e-300):.4f})")
    elif name == "rack_silence":
        print(f"[{name}] peaks T {r['peakT']} Q {r['peakQ']} A {r['peakA']}; {flags}")
        if r["peakT"] != 0 or r["peakQ"] != 0 or r["peakA"] != 0:
            err("silence in must give exact zeros on every channel")
        if r["q_alive"] <= 0:
            err("the follower's alive counter must move in silence")
    elif name == "rack_noise":
        tot = frac(r["energyT"], r["energyQ"])
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        print(f"[{name}] null {null:.1f} dB, Transients share {tot:.3f}; {flags}")
        if not null < -90.0:
            err(f"T + Q must null (got {null:.1f} dB)")
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
    if all(k in store for k in ("bias_lo", "bias_mid", "bias_hi")):
        lo, mid, hi = store["bias_lo"], store["bias_mid"], store["bias_hi"]
        print(f"[bias] Transients share -80 %: {lo:.3f}  0 %: {mid:.3f}  +80 %: {hi:.3f}")
        if not lo < mid < hi:
            errors.append(f"bias: the Transients share must rise with Analysis Bias ({lo:.3f}, {mid:.3f}, {hi:.3f})")
        if not hi - lo > 0.15:
            errors.append(f"bias: -80 % to +80 % must move at least 0.15 of the energy (moved {hi - lo:.3f})")
    if errors:
        print("\nFAILED:")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("All Real Max 9 Transient Split audio and telemetry tests passed!")


if __name__ == "__main__":
    main()
