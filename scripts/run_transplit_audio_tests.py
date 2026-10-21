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

ROOT = mh.ROOT
SRC = os.path.join(ROOT, "src")
PROBE_JS = os.path.join(ROOT, "tests", "transplit_probe.js")
SR = mh.DEFAULT_SR
LATENCY = 4096
PERIOD = 19200          # 400 ms at 48 kHz
FIRST_ONSET = 4800      # 100 ms


def gen_source():
    parts = []
    for name in ("cepstrum_lib.genexpr", "spectral_split_lib.genexpr", "transplit_core.genexpr"):
        with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
            parts.append(f.read().rstrip() + "\n")
    return "\n".join(parts)


def stim_code(kind, delay_dry):
    """Stimulus gen: out1 = x (left), out2 = x delayed 4096 (or raw), out3 = window flag aligned with out2."""
    head = ["History n(0);", "Delay dlyX(4097);", "Delay dlyF(4097);"]
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
        body += ["dlyX.write(x);", "dlyF.write(flag);", "out2 = dlyX.read(4096);", "out3 = dlyF.read(4096);"]
    else:
        body += ["dlyX.write(x);", "dlyF.write(flag);", "out2 = x;", "out3 = flag;"]
    return "\n".join(head + body) + "\n"


def build_device(code, case):
    boxes = [
        mh.gen_box("obj-stim", stim_code(case["stim"], case.get("delay", True)), 40, 120, numinlets=1, numoutlets=3),
        mh.box("obj-half", "*~ 0.5", 40, 160, 45, numinlets=2, outlettype=["signal"]),
        mh.box("obj-scope", "buffer~ #0-transplitscope @samps 800", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf", "setbuffer #0-transplitscope", 520, 130, 220),
    ]
    lines = [mh.line("obj-load", 0, "obj-setbuf", 0), mh.line("obj-setbuf", 0, "obj-js", 0),
             mh.line("obj-stim", 0, "obj-half", 0)]
    for tag, sel in (("t", 1), ("q", 2), ("a", 0)):
        gid = f"obj-gen-{tag}"
        mixv = case["mix"] if sel != 0 else 1.0        # the All instance is the Mix 100 % reference
        params = (f"outsel {sel}, fftn {case['n']}, ttype {case['ttype']}, anbias {case['bias']}, tdecay 8, tsmooth 1.5, tiltamt 0, "
                  f"tmode 0, blendamt {case['blend']}, mixamt {mixv}")
        boxes.append(mh.gen_box(gid, code, 200 + 240 * (sel % 3), 260))
        boxes.append(mh.msg(f"obj-params-{tag}", params, 200 + 240 * (sel % 3), 220, 330))
        lines += [mh.line("obj-load", 0, f"obj-params-{tag}", 0), mh.line(f"obj-params-{tag}", 0, gid, 0),
                  mh.line("obj-stim", 0, gid, 0), mh.line("obj-half", 0, gid, 1)]
        if tag == "t":
            boxes.append(mh.msg("obj-bind", "scope #0-transplitscope", 200, 190, 200))
            lines += [mh.line("obj-load", 0, "obj-bind", 0), mh.line("obj-bind", 0, gid, 0)]
    lines += [
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
    return out


def db(x):
    return 10.0 * math.log10(max(x, 1e-300))


def run_case(code, case):
    boxes, lines = build_device(code, case)
    return mh.run_case(f"transplit_{case['name']}", boxes, lines, probe_js=PROBE_JS, probe_args=case["stim"],
                       settle_ms=case["settle"], dur_ms=case["dur"], channels=6, sr=SR)


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
