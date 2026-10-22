#!/usr/bin/env python3
"""Render Harmonic Split's gen core through the Ableton-bundled Max 9 on the shared NonRealTime harness
(scripts/max_harness.py) and check the DSP and the telemetry buffer. Max runs only in the tart VM (AGENTS.md 1a):

    scripts/vm_spectral.sh audio harmsplit [case ...]      (from the host)
    /usr/bin/python3 scripts/run_harmsplit_audio_tests.py [case ...]      (inside the VM)

Every case patches four instances of the REAL core (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr +
src/harmsplit_core.genexpr, exactly what the device embeds), fed by one stimulus gen: outsel 1 (Nonharmonics), 2 (Harmonics A),
3 (Harmonics B) and 0 (All = the sum of the masks). The stimulus has a left channel x and a right channel 0.5 x. The probe
(tests/harmsplit_probe.js) records the three channels (left), the stimulus delayed by 4096 samples, All (left) and A (right), and
measures the energy at 220 Hz * h (h = 1..12) and half way between the harmonics with a Goertzel filter per channel.

Stimuli: saw = band-limited 220 Hz sawtooth (additive, amplitude 0.25), sawnoise = saw 0.15 + white noise 0.02, noise = white
noise 0.3, nofund = the sawtooth without its fundamental, quiet = saw at -70 dB, impulse = one impulse, silent.

Cases:
  sum_<n>_saw / sum_2048_sawnoise / sum_2048_noise / sum_2048_pat4   the three channels null against the input delayed 4096 samples
                                  (< -90 dB) at Size 1k / 2k / 4k and at other settings
  saw_p2                          odd harmonics of the sawtooth in A, even in B (>= 98 % each), Nonharmonics < 3 %, f0 within 1 %
  saw_p4 / saw_p1                 Pattern 4: harmonics 1, 5, 9 in A, the rest in B; Pattern 1: only the fundamental in A
  saw_maxh8                       Maximum Harmonics 8: harmonics 15 and 20 go to Nonharmonics (the default 0 = Off keeps them in A / B)
  saw_cut                         Detection band 150..400 Hz around the 220 Hz fundamental: f0 found, every harmonic of the sawtooth
                                  (also above High-cut) still sorted as with the defaults
  band_low / band_high / band_empty   the 220 Hz fundamental is outside the band (500..1500, 19.4..100 Hz, Low = High): not tracked,
                                  any f0 lies inside the band, the fundamental goes to Nonharmonics, an empty band detects nothing
  band_wide / band_default_2500   2.5 kHz sawtooth: tracked with High-cut 19.9 kHz, not with the default 1.5 kHz
  mix_0 / mix_50                  Mix 0 %: every chain outputs its third of the dry input (A energy = D / 9, All = D); Mix 50 %: the
                                  chains still sum to the delayed input (0.5 wet + 0.5 dry)
  sawnoise                        noise between the partials is mostly in Nonharmonics, the partials in A / B, f0 within 1 %
  c1_sq_2k / c1_sq_44k / c1_saw_4k   ROOT detection (the user's report): C1 (32.7 Hz) square at Size 2k (48 and 44.1 kHz) and sawtooth at 4k, band
                                  156.1 Hz .. 2.9 kHz, Every 8th: series f0 32.7, root 163.5 Hz (5th harmonic), harmonics h' = 1, 9, 17 in A,
                                  the other partials in B, the series partials below the root (32.7, 98.1 Hz) in Nonharmonics
  c1_noise                        white noise in that band: no root, no series
  saw110_low300                   110 Hz sawtooth with Low 300 Hz: series 110, root 330 Hz (harmonic 3), pattern counted from it
  nofund                          the fundamental removed: the series f0 is still 220 Hz, the root is 440 Hz (harmonic 2)
  noise                           white noise: Nonharmonics > 99 %, no fundamental tracked
  thr_above / quiet               below an explicit Detection Threshold everything goes to Nonharmonics
  quiet_auto                      Threshold Automatic (-120 dB, the default): a -70 dB sawtooth is still split, the effective threshold
                                  telemetry follows the running level - 40 dB (floor -100 dB)
  stereo                          the right channel of A is half the left (stereo image kept), telemetry is live
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
PROBE_JS = os.path.join(ROOT, "tests", "harmsplit_probe.js")
SR = mh.DEFAULT_SR
LATENCY = 4096
F0 = 220.0


def gen_source():
    parts = []
    for name in ("cepstrum_lib.genexpr", "spectral_split_lib.genexpr", "harmsplit_core.genexpr"):
        with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
            parts.append(f.read().rstrip() + "\n")
    return "\n".join(parts)


def stim_code(kind, delay_dry, f0=F0, sr=SR):
    """Stimulus gen: out1 = x (left), out2 = x delayed 4096 (or raw), out3 unused."""
    head = ["History n(0);", "Delay dlyX(4097);"]
    body = ["dummy = in1 * 0;", "n = n + 1;", "k = n - 1;",
            f"ph = k * {f0} / {sr};", "ph = ph - floor(ph);",
            "r = noise();",
            "s = 0;",
            "for (h = 1; h <= 90; h += 1) {", "  s += sin(6.283185307179586 * h * ph) / h;", "}",
            "s2 = s - sin(6.283185307179586 * ph);"]
    if kind == "saw":
        body.append("x = 0.25 * s;")
    elif kind == "sawnoise":
        body.append("x = 0.15 * s + 0.02 * r;")
    elif kind == "noise":
        body.append("x = 0.3 * r;")
    elif kind == "nofund":
        body.append("x = 0.25 * s2;")
    elif kind == "saw2500":
        body.append(f"ph3 = k * 2500 / {sr};")
        body.append("ph3 = ph3 - floor(ph3);")
        body.append("s3 = 0;")
        body.append("for (h = 1; h <= 7; h += 1) {")
        body.append("  s3 += sin(6.283185307179586 * h * ph3) / h;")
        body.append("}")
        body.append("x = 0.25 * s3;")
    elif kind == "sawc":
        # sawtooth band-limited to 0.45 sr (a LOW f0 needs hundreds of harmonics, unlike `saw` which stops at 90)
        hmax = min(int(0.45 * sr // f0), 700)
        body += ["s5 = 0;", f"for (h = 1; h <= {hmax}; h += 1) {{", "  s5 += sin(6.283185307179586 * h * ph) / h;", "}", "x = 0.25 * s5;"]
    elif kind in ("square", "square_q", "tri", "pulse25"):
        # band-limited odd / gapped spectra below 0.45 sr: square = odd harmonics 1/h, triangle = odd 1/h^2 with alternating sign,
        # 25 % pulse = every 4th harmonic missing
        hmax = min(int(0.45 * sr // f0), 700)
        body += ["s4 = 0;", f"for (h = 1; h <= {hmax}; h += 1) {{"]
        if kind in ("square", "square_q"):
            body += ["  odd = h - 2 * floor(h / 2);", "  s4 += odd * sin(6.283185307179586 * h * ph) / h;"]
        elif kind == "tri":
            body += ["  odd = h - 2 * floor(h / 2);", "  sg = (h - 4 * floor(h / 4)) < 1.5 ? 1 : -1;",
                     "  s4 += odd * sg * sin(6.283185307179586 * h * ph) / (h * h);"]
        else:
            body += ["  s4 += sin(3.141592653589793 * h * 0.25) * sin(6.283185307179586 * h * ph) / h;"]
        body.append("}")
        if kind == "square":
            body.append("x = 0.25 * 1.2732395447351628 * s4;")
        elif kind == "square_q":
            body.append("x = 0.008 * 1.2732395447351628 * s4;")
        elif kind == "tri":
            body.append("x = 0.25 * 1.2339 * s4;")
        else:
            body.append("x = 0.25 * 2 * 1.5707963267948966 * 0.6366197723675814 * s4;")
    elif kind == "quiet":
        body.append("x = 0.0003 * s;")
    elif kind == "impulse":
        body.append("x = k == 1000 ? 0.5 : 0;")
    else:
        body.append("x = 0;")
    body.append("out1 = x;")
    body += ["dlyX.write(x);", "out2 = dlyX.read(4096);" if delay_dry else "out2 = x;", "out3 = 0;"]
    return "\n".join(head + body) + "\n"


def build_device(code, case):
    boxes = [
        mh.gen_box("obj-stim", stim_code(case["stim"], case.get("delay", True), case.get("f0", F0), case.get("sr", SR)), 40, 120, numinlets=1, numoutlets=3),
        mh.box("obj-half", "*~ 0.5", 40, 160, 45, numinlets=2, outlettype=["signal"]),
        mh.box("obj-scope", "buffer~ #0-harmsplitscope @samps 544", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf", "setbuffer #0-harmsplitscope", 520, 130, 220),
    ]
    lines = [mh.line("obj-load", 0, "obj-setbuf", 0), mh.line("obj-setbuf", 0, "obj-js", 0),
             mh.line("obj-stim", 0, "obj-half", 0)]
    for tag, sel in (("n", 1), ("a", 2), ("b", 3), ("all", 0)):
        gid = f"obj-gen-{tag}"
        params = (f"outsel {sel}, fftn {case['n']}, hpat {case['pat']}, hmaxp {case['maxh']}, sensamt {case['sens']}, tiltamt 0, "
                  f"thrdb {case['thr']}, flocut {case['lo']}, fhicut {case['hi']}, wetamt {case['mix']}")
        x = 200 + 240 * sel
        boxes.append(mh.gen_box(gid, code, x, 260))
        boxes.append(mh.msg(f"obj-params-{tag}", params, x, 220, 330))
        lines += [mh.line("obj-load", 0, f"obj-params-{tag}", 0), mh.line(f"obj-params-{tag}", 0, gid, 0),
                  mh.line("obj-stim", 0, gid, 0), mh.line("obj-half", 0, gid, 1)]
        if tag == "n":
            boxes.append(mh.msg("obj-bind", "scope #0-harmsplitscope", 200, 190, 200))
            lines += [mh.line("obj-load", 0, "obj-bind", 0), mh.line("obj-bind", 0, gid, 0)]
    lines += [
        mh.line("obj-gen-n", 0, "obj-record", 0),
        mh.line("obj-gen-a", 0, "obj-record", 1),
        mh.line("obj-gen-b", 0, "obj-record", 2),
        mh.line("obj-stim", 1, "obj-record", 3),
        mh.line("obj-gen-all", 0, "obj-record", 4),
        mh.line("obj-gen-a", 1, "obj-record", 5),
        mh.line("obj-gen-n", 0, "obj-mute-l", 0),
        mh.line("obj-gen-a", 0, "obj-mute-r", 0),
    ]
    return boxes, lines


def cases():
    out = []

    def c(name, **kw):
        d = {"name": name, "stim": "saw", "n": 2048, "pat": 2, "maxh": 64, "sens": 0.5, "thr": -120, "lo": 80, "hi": 1500, "mix": 1.0,
             "settle": 600, "dur": 800, "delay": True}
        d.update(kw)
        out.append(d)

    for n in (1024, 2048, 4096):
        c(f"sum_{n}_saw", n=n)
    c("sum_2048_sawnoise", stim="sawnoise")
    c("sum_2048_noise", stim="noise")
    c("sum_2048_pat4", stim="sawnoise", pat=4, sens=0.9, lo=150, hi=3000, maxh=12)
    c("saw_p2")
    c("saw_p4", pat=4)
    c("saw_p1", pat=1)
    c("saw_maxh8", maxh=8)
    # odd-only and gapped spectra (the f0 tracker used to need every harmonic: a square never reached the accept)
    c("sq_p2", stim="square")
    c("sq_p4", stim="square", pat=4)
    c("sq_quiet", stim="square_q")
    for f in (110, 440, 880):
        c(f"sq_f{f}", stim="square", f0=f)
    c("tri_220", stim="tri")
    c("tri_110", stim="tri", f0=110)
    for f in (220, 440):
        c(f"pulse_f{f}", stim="pulse25", f0=f)
    c("sq_wide_1760", stim="square", f0=1760, lo=19.4, hi=19900)
    c("sawnoise", stim="sawnoise")
    c("nofund", stim="nofund")
    c("noise", stim="noise")
    # ROOT = lowest present partial of the series inside the band; the pattern counts from it (h' = h - hr + 1)
    # the user's report: C1 square (32.7 Hz, odd harmonics), Low 156.1 Hz, High 2.9 kHz, Every 8th, Size 2k
    U = dict(lo=156.1, hi=2900, pat=8, maxh=0, f0=32.7, xh=[1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23])
    c("c1_sq_2k", stim="square", **U)
    c("c1_sq_44k", stim="square", sr=44100, **U)
    c("c1_saw_4k", stim="sawc", n=4096, settle=900, dur=900, **dict(U, xh=list(range(1, 30))))
    c("c1_noise", stim="noise", lo=156.1, hi=2900, pat=8)
    c("saw110_low300", stim="saw", f0=110, lo=300, hi=1500, xh=[1, 2, 3, 4, 5, 6, 7, 8, 9])
    c("saw_cut", lo=150, hi=400)
    c("band_low", lo=500, hi=1500)
    c("band_high", lo=19.4, hi=100)
    c("band_empty", lo=1000, hi=1000)
    c("band_wide", stim="saw2500", lo=80, hi=19900)
    c("band_default_2500", stim="saw2500")
    c("mix_0", mix=0.0)
    c("mix_50", mix=0.5)
    c("thr_above", thr=-10)
    c("quiet", stim="quiet", thr=-60)
    c("quiet_auto", stim="quiet")
    c("stereo")
    c("silence", stim="silent", dur=1000)
    for n in (1024, 2048, 4096):
        c(f"latency_{n}", stim="impulse", n=n, settle=0, dur=400, delay=False)
    return out


def db(x):
    return 10.0 * math.log10(max(x, 1e-300))


def run_case(code, case):
    boxes, lines = build_device(code, case)
    xs = ",".join(str(h) for h in case.get("xh", []))
    args = f"{case['stim']} {case.get('f0', F0)}" + (f" {xs}" if xs else "")
    return mh.run_case(f"harmsplit_{case['name']}", boxes, lines, probe_js=PROBE_JS, probe_args=args,
                       settle_ms=case["settle"], dur_ms=case["dur"], channels=6, sr=case.get("sr", SR))


def share(r, h, ch, mid=False):
    """Share of the energy at harmonic h (or half way between h and h + 1) that sits in channel ch ('n', 'a', 'b')."""
    key = "m" if mid else "g"
    vals = {c: r.get(f"{key}{c}{h}", 0.0) for c in "nab"}
    tot = sum(vals.values())
    return vals[ch] / tot if tot > 0 else 0.0


def share_x(r, h, ch):
    """Share of the energy at the extra harmonic h (probe argument list) that sits in channel ch."""
    vals = {c: r.get(f"x{c}{h}", 0.0) for c in "nab"}
    tot = sum(vals.values())
    return vals[ch] / tot if tot > 0 else 0.0


def check(case, r, errors):
    name = case["name"]

    def err(msg):
        errors.append(f"{name}: {msg}")

    if r.get("nan", 1) != 0:
        err(f"NaN / inf samples ({r.get('nan')})")
    if r.get("harness_sr") and abs(r["harness_sr"] - case.get("sr", SR)) > 1:
        err(f"sample rate {r['harness_sr']}")
    eN, eA, eB = r["energyN"], r["energyA"], r["energyB"]
    tot = max(eN + eA + eB, 1e-300)
    f0 = r["scopeF0"]
    if name.startswith("sum_"):
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        print(f"[{name}] null={null:.1f} dB  energyN={eN:.3f} energyA={eA:.3f} energyB={eB:.3f} energyDry={r['energyD']:.3f}  f0={f0:.2f}")
        if r["energyD"] < 1.0:
            err("stimulus silent")
        if not null < -90.0:
            err(f"Nonharmonics + A + B must null against the input delayed 4096 (got {null:.1f} dB)")
        if name != "sum_2048_noise" and (eA <= 0 or eB <= 0):
            err("A and B must carry signal")
    elif name in ("saw_p2", "saw_p4", "saw_p1"):
        pat = case["pat"]
        sh = []
        for h in range(1, 13):
            want = "a" if (h == 1 if pat == 1 else (h - 1) % pat == 0) else "b"
            s = share(r, h, want)
            sh.append(s)
            if not s > 0.98:
                err(f"harmonic {h} must be in {'A' if want == 'a' else 'B'} (share {s:.4f}; N {share(r, h, 'n'):.4f} A {share(r, h, 'a'):.4f} B {share(r, h, 'b'):.4f})")
        print(f"[{name}] shares of harmonics 1..12 in their channel: min {min(sh):.4f}  Nonharmonics {100 * eN / tot:.2f} %  A/B energy {eA / max(eB, 1e-30):.2f}  f0={f0:.2f} Hz  active harmonics {int(r['scopeNact'])}")
        if not eN / tot < 0.03:
            err(f"a clean sawtooth must leave < 3 % in Nonharmonics (got {100 * eN / tot:.2f} %)")
        if name == "saw_p2" and not (2.5 < eA / eB < 3.6):
            err(f"odd / even energy ratio of a sawtooth is about 3 (got {eA / eB:.2f})")
        if name == "saw_p2" and abs(r["scopeThrEff"] - (r["scopeLvl"] - 40)) > 4.0:
            err(f"Automatic threshold: effective threshold = running level - 40 dB (level {r['scopeLvl']:.1f}, got {r['scopeThrEff']:.1f})")
        if name == "saw_p1" and not (1.3 < eA / eB < 1.8):
            err(f"Pattern 1: A carries just the fundamental, A / B energy about 1.55 (got {eA / eB:.2f})")
        if abs(f0 / F0 - 1) > 0.01:
            err(f"f0 telemetry must be within 1 % of {F0} Hz (got {f0:.2f})")
    elif name.startswith("sq_") or name.startswith("tri_") or name.startswith("pulse_"):
        f0w = case.get("f0", F0)
        print(f"[{name}] f0={f0:.2f} Hz (want {f0w})  salience {r['scopeConf']:.2f}  Nonharmonics {100 * eN / tot:.2f} %  A {100 * eA / tot:.1f} %  B {100 * eB / tot:.1f} %")
        if abs(f0 / f0w - 1) > 0.01:
            err(f"f0 telemetry must be within 1 % of {f0w} Hz (got {f0:.2f})")
        if not eN / tot < 0.05:
            err(f"a clean periodic wave must leave < 5 % in Nonharmonics (got {100 * eN / tot:.2f} %)")
        if f0w == F0 and name in ("sq_p2", "sq_p4"):
            for h in (1, 3, 5, 7, 9, 11):
                want = "a" if (h - 1) % case["pat"] == 0 else "b"
                sh_ = share(r, h, want)
                if not sh_ > 0.98:
                    err(f"square harmonic {h} must be in {want.upper()} (share {sh_:.4f}; N {share(r, h, 'n'):.4f} A {share(r, h, 'a'):.4f} B {share(r, h, 'b'):.4f})")
        if name == "sq_p2" and not eB / tot < 0.02:
            err(f"square, Pattern 2: all harmonics are odd, so B stays empty (got {100 * eB / tot:.2f} %)")
    elif name in ("c1_sq_2k", "c1_sq_44k", "c1_saw_4k"):
        f1 = 32.7
        xs = lambda h, ch: share_x(r, h, ch)  # noqa: E731
        a_ok = [5, 13, 21]
        b_odd = [7, 9, 11, 15, 17, 19, 23]
        b_all = b_odd if name != "c1_saw_4k" else [6, 7, 8, 9, 10, 11, 12, 14]
        a_share = [xs(h, "a") for h in a_ok]
        b_share = [xs(h, "b") for h in b_all]
        n_share = [xs(h, "n") for h in (1, 3)]
        print(f"[{name}] root={f0:.2f} Hz (want 163.5)  series f0={r['scopeSeries']:.2f}  root harmonic {int(r['scopeRootH'])}  odd-only {int(r['scopeOdd'])}  salience {r['scopeConf']:.2f}  "
              f"A partials 5/13/21: {', '.join(f'{v:.3f}' for v in a_share)}  B: min {min(b_share):.3f}  Nonharmonics 1/3: {', '.join(f'{v:.3f}' for v in n_share)}  "
              f"N {100 * eN / tot:.1f} %  A {100 * eA / tot:.1f} %  B {100 * eB / tot:.1f} %")
        if abs(f0 / 163.5 - 1) > 0.01:
            err(f"the root of the C1 series inside 156.1 .. 2900 Hz is its 5th harmonic, 163.5 Hz (got {f0:.2f})")
        if abs(r["scopeSeries"] / f1 - 1) > 0.01 or int(r["scopeRootH"]) != 5:
            err(f"series f0 32.7 Hz, root harmonic 5 (got {r['scopeSeries']:.2f}, h {int(r['scopeRootH'])})")
        if name != "c1_saw_4k" and int(r["scopeOdd"]) != 1:
            err("a square wave is an odd-only series")
        if not (min(a_share) > 0.85 and min(b_share) > 0.85):
            err(f"Every 8th counts from the root: harmonics h' = 1, 9, 17 (series 5, 13, 21) in A, the others in B (A {a_share}, B {b_share})")
        if not min(n_share) > 0.85:
            err(f"series partials below the root (32.7, 98.1 Hz) go to Nonharmonics ({n_share})")
        if not r["scopeConf"] > 0.42:
            err(f"salience {r['scopeConf']:.2f} must have margin over the 0.36 accept")
    elif name == "c1_noise":
        print(f"[{name}] Nonharmonics {100 * eN / tot:.3f} %  root={f0:.2f}  series={r['scopeSeries']:.2f}  salience {r['scopeConf']:.2f}")
        if f0 != 0 or r["scopeSeries"] != 0 or not eN / tot > 0.99:
            err(f"white noise in the band 156.1 .. 2900 Hz: no root, no series, all Nonharmonics (root {f0:.2f}, series {r['scopeSeries']:.2f}, N {100 * eN / tot:.2f} %)")
    elif name == "saw110_low300":
        a_share = [share_x(r, h, "a") for h in (3, 5, 7, 9)]
        b_share = [share_x(r, h, "b") for h in (4, 6, 8)]
        n_share = [share_x(r, h, "n") for h in (1, 2)]
        print(f"[{name}] root={f0:.2f} Hz (want 330)  series f0={r['scopeSeries']:.2f}  root harmonic {int(r['scopeRootH'])}  A 3/5/7/9: {', '.join(f'{v:.3f}' for v in a_share)}  B 4/6/8: {', '.join(f'{v:.3f}' for v in b_share)}  Nonharmonics 1/2: {', '.join(f'{v:.3f}' for v in n_share)}")
        if abs(f0 / 330 - 1) > 0.01 or int(r["scopeRootH"]) != 3 or abs(r["scopeSeries"] / 110 - 1) > 0.01:
            err(f"110 Hz saw with Low 300 Hz: series 110, root 330 Hz = harmonic 3 (got root {f0:.2f}, series {r['scopeSeries']:.2f}, h {int(r['scopeRootH'])})")
        if not (min(a_share) > 0.98 and min(b_share) > 0.98):
            err(f"Every 2nd counts from the root: harmonics 3, 5, 7, 9 in A, 4, 6, 8 in B (A {a_share}, B {b_share})")
        if not min(n_share) > 0.9:
            err(f"harmonics 1, 2 (below the root) go to Nonharmonics ({n_share})")
    elif name == "saw_cut":
        sh = []
        for h in range(1, 13):
            want = "a" if h % 2 == 1 else "b"
            s = share(r, h, want)
            sh.append(s)
            if not s > 0.98:
                err(f"harmonic {h} (outside the 150..400 Hz detection band or not) must still be in {want.upper()} (share {s:.4f})")
        print(f"[{name}] shares of harmonics 1..12 in their channel: min {min(sh):.4f}  Nonharmonics {100 * eN / tot:.2f} %  f0={f0:.2f} Hz")
        if abs(f0 / F0 - 1) > 0.01:
            err(f"f0 telemetry must stay within 1 % of {F0} Hz with the band 150..400 Hz (got {f0:.2f})")
        if not eN / tot < 0.03:
            err(f"harmonics above High-cut must stay sorted, not move to Nonharmonics (got {100 * eN / tot:.2f} %)")
    elif name in ("band_low", "band_high", "band_empty"):
        lo, hi = case["lo"], case["hi"]
        s1 = share(r, 1, "n")
        print(f"[{name}] band {lo}..{hi} Hz: f0={f0:.2f} Hz  Nonharmonics {100 * eN / tot:.2f} %  220 Hz fundamental in Nonharmonics {100 * s1:.2f} %")
        if abs(f0 / F0 - 1) < 0.05:
            err(f"the 220 Hz fundamental is outside the band {lo}..{hi} Hz and must not be tracked (got f0 {f0:.2f})")
        if f0 > 0 and not (lo * 0.7071 - 1 <= f0 <= hi * 1.4143 + 1):
            err(f"any f0 must lie inside the band (+- half an octave soft edge) {lo}..{hi} Hz (got {f0:.2f})")
        if name == "band_empty" and (f0 != 0 or not eN / tot > 0.999):
            err(f"empty band (Low >= High): nothing is detected, all Nonharmonics (f0 {f0:.2f}, N {100 * eN / tot:.2f} %)")
        if not s1 > 0.9:
            err(f"the excluded fundamental 220 Hz must be in Nonharmonics (share {s1:.3f})")
    elif name in ("band_wide", "band_default_2500"):
        print(f"[{name}] 2.5 kHz sawtooth, Low {case['lo']} / High {case['hi']}: f0={f0:.2f} Hz  A + B {100 * (eA + eB) / tot:.2f} %")
        if name == "band_wide":
            if abs(f0 / 2500 - 1) > 0.01:
                err(f"High-cut 19.9 kHz: a 2.5 kHz fundamental must be tracked (got {f0:.2f})")
            if not (eA + eB) / tot > 0.5:
                err(f"2.5 kHz fundamental tracked: the harmonics must be split off Nonharmonics (A + B {100 * (eA + eB) / tot:.2f} %)")
        elif abs(f0 / 2500 - 1) < 0.05:
            err(f"2.5 kHz is above the default High-cut 1.5 kHz (+ half an octave) and must not be tracked (got {f0:.2f})")
    elif name == "mix_0":
        ratio = eA / max(r["energyD"], 1e-300)
        allnull = db(r["nullAll"] / max(r["energyD"], 1e-300))
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        print(f"[{name}] A energy / dry energy = {ratio:.5f} (1/9 = {1 / 9:.5f}); sum null {null:.1f} dB; All vs dry null {allnull:.1f} dB")
        if abs(ratio * 9 - 1) > 0.01:
            err(f"Mix 0: one chain carries a third of the delayed dry input, A energy / dry energy = 1/9 (got {ratio:.5f})")
        if not null < -90.0:
            err(f"Mix 0: the three chains sum to the delayed dry input (got {null:.1f} dB)")
        if not allnull < -90.0:
            err(f"Mix 0 with Output = All is the delayed dry input (got {allnull:.1f} dB)")
    elif name == "mix_50":
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        allnull = db(r["nullAll"] / max(r["energyD"], 1e-300))
        print(f"[{name}] sum null {null:.1f} dB; All null {allnull:.1f} dB; A harmonic 2 (even, 0 wet) energy {r['ga2']:.3e}")
        if not null < -90.0:
            err(f"Mix 50 %: 0.5 wet + 0.5 dry of the three chains nulls against the delayed input (got {null:.1f} dB)")
        if not allnull < -90.0:
            err(f"Mix 50 % with Output = All nulls against the delayed input (got {allnull:.1f} dB)")
        if not r["ga2"] > 1e-8:
            err("Mix 50 %: chain A must carry its third of the dry signal, including the even harmonics it does not own")
    elif name == "quiet_auto":
        split = (eA + eB) / tot
        want = max(r["scopeLvl"] - 40, -100)
        print(f"[{name}] A + B share {100 * split:.2f} %  level {r['scopeLvl']:.1f} dB  effective threshold {r['scopeThrEff']:.1f} dB (expected {want:.1f})  voiced {r['scopeVoiced']:.3f}")
        if not split > 0.95:
            err(f"Automatic threshold: a -70 dB sawtooth must still be split (A + B = {100 * split:.2f} %)")
        if abs(r["scopeThrEff"] - want) > 4.0:
            err(f"the effective threshold must be running level - 40 dB, floor -100 (got {r['scopeThrEff']:.1f}, expected {want:.1f})")
    elif name == "saw_maxh8":
        s8, s15, s20 = share(r, 8, "b"), share(r, 15, "n"), share(r, 20, "n")
        print(f"[{name}] harmonic 8 in B {s8:.3f}, harmonic 15 / 20 in Nonharmonics {s15:.3f} / {s20:.3f}")
        if not (s8 > 0.95 and s15 > 0.95 and s20 > 0.95):
            err("Maximum Harmonics 8 must keep harmonic 8 and send 15 and 20 to Nonharmonics")
    elif name == "sawnoise":
        mid = sum(share(r, m, "n", mid=True) for m in range(1, 7)) / 6
        parts = [share(r, h, "n") for h in range(1, 7)]
        print(f"[{name}] noise between partials in Nonharmonics {mid:.3f}; partials 1..6 in Nonharmonics max {max(parts):.4f}; f0={f0:.2f} Hz, active harmonics {int(r['scopeNact'])}")
        if not mid > 0.85:
            err(f"noise between the partials must be mostly in Nonharmonics (got {mid:.3f})")
        if not max(parts) < 0.03:
            err("the partials must stay out of Nonharmonics")
        if abs(f0 / F0 - 1) > 0.01:
            err(f"f0 telemetry must be within 1 % of {F0} Hz (got {f0:.2f})")
    elif name == "nofund":
        print(f"[{name}] root={f0:.2f} Hz  series f0={r['scopeSeries']:.2f} Hz  root harmonic {int(r['scopeRootH'])}")
        if abs(f0 / (2 * F0) - 1) > 0.01 or int(r["scopeRootH"]) != 2:
            err(f"fundamental missing: the root is the lowest present partial, 440 Hz = series harmonic 2 (got {f0:.2f}, h {int(r['scopeRootH'])})")
        if abs(r["scopeSeries"] / F0 - 1) > 0.01:
            err(f"fundamental missing: the series f0 is still {F0} Hz (got {r['scopeSeries']:.2f})")
    elif name == "noise":
        print(f"[{name}] Nonharmonics {100 * eN / tot:.3f} %  f0={f0:.2f}  salience {r['scopeConf']:.2f}")
        if not eN / tot > 0.99:
            err(f"white noise must stay in Nonharmonics (got {100 * eN / tot:.2f} %)")
        if f0 != 0:
            err(f"no fundamental may be tracked in noise (got {f0:.2f})")
    elif name in ("thr_above", "quiet"):
        print(f"[{name}] A + B share {100 * (eA + eB) / tot:.5f} %  level {r['scopeLvl']:.1f} dB  voiced {r['scopeVoiced']:.3f}")
        if not (eA + eB) / tot < 1e-4:
            err(f"below the Detection Threshold everything must go to Nonharmonics (A + B = {100 * (eA + eB) / tot:.4f} %)")
    elif name == "stereo":
        print(f"[stereo] R/L = {r['ratioR']:.3f}")
        tele = (f"frame={int(r['scopeFrame'])} N={int(r['scopeN'])} awake={int(r['scopeAwake'])} lat={int(r['scopeLat'])} sel={int(r['scopeSel'])} "
                f"preMax={r['scopePreMax']:.3f} nhMax={r['scopeNhMax']:.3f} aMax={r['scopeAMax']:.3f} bMax={r['scopeBMax']:.3f} "
                f"f0={f0:.1f} voiced={r['scopeVoiced']:.2f} nact={int(r['scopeNact'])}")
        print(f"[stereo] telemetry {tele}")
        if abs(r["ratioR"] - 0.5) > 0.02:
            err(f"stereo image: right/left must stay 0.5 (got {r['ratioR']:.3f})")
        if r["scopeFrame"] < 5 or r["scopeN"] != 2048 or r["scopeAwake"] != 1 or r["scopeLat"] != LATENCY or r["scopeSel"] != 1:
            err(f"telemetry scalars wrong ({tele})")
        if not (r["scopePreMax"] > 0.3 and r["scopeAMax"] > 0.3 and r["scopeBMax"] > 0.3 and r["scopeNhMax"] > 0.0 and r["scopeVoiced"] > 0.9 and r["scopeNact"] > 40):
            err(f"telemetry columns / f0 state wrong ({tele})")
    elif name == "silence":
        print(f"[silence] peaks N={r['peakN']} A={r['peakA']} B={r['peakB']} All={r['peakAll']}  telemetry awake={int(r['scopeAwake'])} preMax={r['scopePreMax']}")
        if r["peakN"] != 0 or r["peakA"] != 0 or r["peakB"] != 0 or r["peakAll"] != 0:
            err("silence in must give exact zeros on every channel")
        if r["scopeAwake"] != 0 or r["scopePreMax"] != 0 or r["scopeF0"] != 0:
            err("the telemetry must report the device asleep with empty columns")
    elif name.startswith("latency_"):
        lat = r["idxAll"] - r["idxD"]
        print(f"[{name}] impulse in at {int(r['idxD'])}, out at {int(r['idxAll'])}: latency {int(lat)} samples, peak {r['peakAll']:.4f}")
        if lat != LATENCY:
            err(f"latency must be exactly {LATENCY} samples (got {lat})")
        if abs(r["peakAll"] - 0.5) > 0.002:
            err(f"impulse must come out at unity (peak {r['peakAll']:.4f})")


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"SKIP: Max binary not found at {mh.MAX_BIN}")
        sys.exit(0)
    wanted = set(sys.argv[1:])
    code = gen_source()
    errors = []
    for case in cases():
        if wanted and case["name"] not in wanted:
            continue
        try:
            r = run_case(code, case)
        except Exception as ex:  # noqa: BLE001
            errors.append(f"{case['name']}: {ex}")
            print(f"[{case['name']}] ERROR {ex}")
            continue
        check(case, r, errors)
    if errors:
        print("\nFAILED:")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("All Real Max 9 Harmonic Split audio and telemetry tests passed!")


if __name__ == "__main__":
    main()
