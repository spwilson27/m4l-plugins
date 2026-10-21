"""Render Freq Split's gen core through the Ableton-bundled Max 9 on the shared NonRealTime harness
(scripts/max_harness.py) and check the DSP and the telemetry buffer. Max runs only in the tart VM (AGENTS.md 1a):

    scripts/vm_spectral.sh audio freqsplit [case ...]      (from the host)
    /usr/bin/python3 scripts/run_freqsplit_audio_tests.py [case ...]      (inside the VM)

Every case patches five instances of the REAL core (src/cepstrum_lib.genexpr + src/spectral_split_lib.genexpr +
src/freqsplit_core.genexpr, exactly what the device embeds), fed by one stimulus gen: outsel 1..4 (channels 1..4) and outsel 0
(All). The stimulus has a left channel x and a right channel 0.5 x. The probe (tests/freqsplit_probe.js) records the four
channels (left), the stimulus delayed by 4096 samples and All (left); it correlates every channel with each stimulus sine.

Stimuli: mix = white noise plus three sines, sines = a set of sines (freqs / amps per case), impulse, silent.

Cases:
  sum_*            the four channels null against the input delayed 4096 samples (< -90 dB) at several split counts (1, 3.5, 16, 100.3,
                   1024), directions, fractional Nudge, Bend / Pinch / Spin and Crossfade 0 / 25 / 50 / 100 %, and at Size 1k / 2k / 4k
  iso_*            sines at the centres of regions (predicted by the Python port of the pattern) land in the predicted channel with
                   > 40 dB isolation: default 16 splits at Nudge 0 / 1 / 2, Mid / Low insertion, Spin, a fractional count (16.5)
  nudge_half       Nudge 0.5: a sine splits its amplitude evenly (0.05 + 0.05) between two adjacent channels
  iso_change       nsplit 3 -> 16 and Nudge 0 -> 1 sent to all instances mid-run: the masks follow (a stale cache would fail it)
  lim_on / lim_off Spectral Limiter -20 dB: a 0.8 sine is capped near the threshold in its channel, a 0.03 sine in another channel
                   passes unchanged (compared with the limiter off)
  mix_30 / mix_0   Mix 30 % / 0 %: the four chain outputs (each mix * wet + (1 - mix) * dry / 4) sum to the input delayed 4096
                   samples (< -90 dB); at Mix 0 every chain carries a quarter of the dry signal and Output All is the dry signal
  silence          silent input gives exact zeros on every channel and telemetry awake = 0
  latency_<n>      an impulse comes out of Output = All exactly 4096 samples later at Size 1k / 2k / 4k
  telemetry        scalars and columns of the scope buffer (channel 1 instance)
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src")
LATENCY = 4096
SIZES = {"1k": 1024, "2k": 2048, "4k": 4096}


# ---- Python port of the pattern / mask maths (src/freqsplit_config.js fsPattern / fsMaskAt), used to predict where sines land.
# tests/test_freqsplit.js cross-checks it against the JS reference through `--dump-masks` (JSON on stdin, no Max needed).
def _clip(x, lo, hi):
    return lo if x < lo else (hi if x > hi else x)


def fs_pattern(p):
    n = _clip(p["splits"], 1.0, 1024.0)
    K = math.floor(n)
    f = n - K
    F = K + 1
    d = int(_clip(math.floor(p["dir"] + 0.5), 0, 2))
    lc = (F + 1) // 2
    sp = F if d == 0 else (0 if d == 2 else lc)
    nd = p["nudge"] - 4 * math.floor(p["nudge"] / 4)
    a = math.floor(nd)
    return {"K": K, "f": f, "F": F, "T": F + f, "dir": d, "Lc": lc, "sp": sp, "xf": _clip(p["xfade"], 0.0, 1.0), "a": a,
            "phi": nd - a, "spin": _clip(p["spin"], -0.5, 0.5), "bend": _clip(p["bend"], -1.0, 1.0),
            "pinch": _clip(p["pinch"], -1.0, 1.0), "off": 3 - F, "pmid": lc if F % 2 == 0 else 3 - F + lc}


def fs_base(pat, s):
    if pat["dir"] == 0:
        return s
    if pat["dir"] == 2:
        return s + pat["off"]
    if s < pat["Lc"]:
        return s
    return s + pat["off"] if s > pat["Lc"] else pat["pmid"]


def fs_warp_inv(x, bend, pinch):
    m = 0.5 + 0.4 * bend
    gam = math.log(m) / math.log(0.5)
    qi = 1.0 / math.exp(pinch * math.log(3.0))
    tq = (m - x) / m if x < m else (x - m) / (1.0 - m)
    t0 = max(tq, 0.0) ** qi
    wv = m - m * t0 if x < m else m + (1.0 - m) * t0
    return max(wv, 0.0) ** (1.0 / gam)


def fs_mask_at(pat, x):
    q = fs_warp_inv(x, pat["bend"], pat["pinch"]) - pat["spin"]
    q = q + 1 if q < 0 else (q - 1 if q > 1 else q)
    t = q * pat["T"]
    sp, f = pat["sp"], pat["f"]
    if t < sp:
        s = math.floor(t)
    elif t < sp + f:
        s = sp
    else:
        s = sp + 1 + math.floor(t - sp - f)
    s = max(0, min(s, pat["F"]))
    if s == sp and f <= 0:
        s -= 1
    e = s if s < sp else (sp if s == sp else s + f - 1)
    w = f if s == sp else 1.0
    wl = f if s - 1 == sp else 1.0
    wu = f if s + 1 == sp else 1.0
    hl = pat["xf"] * 0.5 * min(wl, w) if s > 0 else 0.0
    hu = pat["xf"] * 0.5 * min(w, wu) if s < pat["F"] else 0.0
    dl, du = t - e, e + w - t
    in_l = dl < hl
    in_u = (not in_l) and du < hu
    nb = s - 1 if in_l else (s + 1 if in_u else s)
    tt = (dl + hl) / (2 * max(hl, 1e-12)) if in_l else ((hu - du) / (2 * max(hu, 1e-12)) if in_u else 0.0)
    sw = 0.5 - 0.5 * math.cos(math.pi * tt)
    w_s = sw if in_l else (1 - sw if in_u else 1.0)
    w_n = 1 - w_s
    cs = (fs_base(pat, s) + pat["a"]) % 4
    cn = (fs_base(pat, nb) + pat["a"]) % 4
    out = [0.0] * 4
    ph = pat["phi"]
    out[cs] += (1 - ph) * w_s
    out[cn] += (1 - ph) * w_n
    out[(cs + 1) % 4] += ph * w_s
    out[(cn + 1) % 4] += ph * w_n
    return out


def u_of_hz(f):
    return math.log(f / 20.0) / math.log(1000.0)


def hz_of_u(u):
    return 20.0 * math.exp(u * math.log(1000.0))


def channel_of_hz(p, f):
    m = fs_mask_at(fs_pattern(p), u_of_hz(f))
    return max(range(4), key=lambda c: m[c])


if "--dump-masks" in sys.argv:
    req = json.load(sys.stdin)
    json.dump([[fs_mask_at(fs_pattern(p), x) for x in req["xs"]] for p in req["sets"]], sys.stdout)
    sys.exit(0)

import max_harness as mh  # noqa: E402  (after the --dump-masks early exit: that mode needs no Max harness)

ROOT = mh.ROOT
PROBE_JS = os.path.join(ROOT, "tests", "freqsplit_probe.js")
SR = mh.DEFAULT_SR


def gen_source():
    parts = []
    for name in ("cepstrum_lib.genexpr", "spectral_split_lib.genexpr", "freqsplit_core.genexpr"):
        with open(os.path.join(SRC, name), "r", encoding="utf-8") as f:
            parts.append(f.read().rstrip() + "\n")
    return "\n".join(parts)


def stim_code(kind, delay_dry, freqs=(), amps=()):
    """Stimulus gen: out1 = x (left), out2 = x delayed 4096 (or raw)."""
    head = ["History n(0);", "Delay dlyX(4097);"]
    body = ["dummy = in1 * 0;", "n = n + 1;", "k = n - 1;", "r = noise();"]
    if kind == "mix":
        body.append("x = 0.15 * r + 0.1 * sin(6.283185307179586 * 100 * k / 48000) + 0.1 * sin(6.283185307179586 * 800 * k / 48000) "
                    "+ 0.08 * sin(6.283185307179586 * 5000 * k / 48000);")
    elif kind == "sines":
        terms = " + ".join(f"{a} * sin(6.283185307179586 * {f} * k / 48000)" for f, a in zip(freqs, amps))
        body.append(f"x = {terms};")
    elif kind == "impulse":
        body.append("x = k == 1000 ? 0.5 : 0;")
    else:
        body.append("x = 0;")
    body.append("out1 = x;")
    body.append("dlyX.write(x);")
    body.append("out2 = dlyX.read(4096);" if delay_dry else "out2 = x;")
    return "\n".join(head + body) + "\n"


def build_device(code, case):
    boxes = [
        mh.gen_box("obj-stim", stim_code(case["stim"], case.get("delay", True), case.get("freqs", ()), case.get("amps", ())), 40, 120, numinlets=1, numoutlets=2),
        mh.box("obj-half", "*~ 0.5", 40, 160, 45, numinlets=2, outlettype=["signal"]),
        mh.box("obj-scope", "buffer~ #0-freqsplitscope @samps 704", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf", "setbuffer #0-freqsplitscope", 520, 130, 220),
        mh.msg("obj-freqs", "freqs " + " ".join(str(f) for f in case.get("freqs", ())), 520, 160, 220),
    ]
    lines = [mh.line("obj-load", 0, "obj-setbuf", 0), mh.line("obj-setbuf", 0, "obj-js", 0),
             mh.line("obj-load", 0, "obj-freqs", 0), mh.line("obj-freqs", 0, "obj-js", 0),
             mh.line("obj-stim", 0, "obj-half", 0)]
    for sel in (1, 2, 3, 4, 0):
        gid = f"obj-gen-{sel}"
        params = (f"outsel {sel}, fftn {case['n']}, nsplit {case['splits']}, sdir {case['dir']}, xfadeamt {case['xfade']}, "
                  f"nudgeamt {case['nudge']}, spinamt {case['spin']}, bendamt {case['bend']}, pinchamt {case['pinch']}, "
                  f"limon {case['limon']}, limdb {case['limdb']}, mixamt {case['mix']}")
        x = 200 + 200 * (sel % 5)
        boxes.append(mh.gen_box(gid, code, x, 260))
        boxes.append(mh.msg(f"obj-params-{sel}", params, x, 220, 330))
        lines += [mh.line("obj-load", 0, f"obj-params-{sel}", 0), mh.line(f"obj-params-{sel}", 0, gid, 0),
                  mh.line("obj-stim", 0, gid, 0), mh.line("obj-half", 0, gid, 1)]
        if sel == 1:
            boxes.append(mh.msg("obj-bind", "scope #0-freqsplitscope", 200, 190, 200))
            lines += [mh.line("obj-load", 0, "obj-bind", 0), mh.line("obj-bind", 0, gid, 0)]
    lines += [
        mh.line("obj-gen-1", 0, "obj-record", 0),
        mh.line("obj-gen-2", 0, "obj-record", 1),
        mh.line("obj-gen-3", 0, "obj-record", 2),
        mh.line("obj-gen-4", 0, "obj-record", 3),
        mh.line("obj-stim", 1, "obj-record", 4),
        mh.line("obj-gen-0", 0, "obj-record", 5),
        mh.line("obj-gen-1", 0, "obj-mute-l", 0),
        mh.line("obj-gen-2", 0, "obj-mute-r", 0),
    ]
    return boxes, lines


BASE = {"stim": "mix", "n": 4096, "splits": 16, "dir": 0, "xfade": 0.0, "nudge": 0.0, "spin": 0.0, "bend": 0.0, "pinch": 0.0,
        "limon": 0, "limdb": -18, "mix": 1.0, "settle": 400, "dur": 1500, "delay": True}


def region_hz(case, j, T):
    """Centre frequency of pattern region j (of T total weight): the log centre of the region, slid along by Spin."""
    x = ((j + 0.5) / T + case.get("spin", 0.0)) % 1.0
    return round(hz_of_u(x), 1)


def wide_region_hz(case, count):
    """Centre frequencies (>= 150 Hz) of the widest hard one-channel runs of the layout, found on a fine grid of the Python port."""
    pat = fs_pattern(case)
    grid = 6000
    runs = []
    start, cur = 0, None
    for i in range(grid + 1):
        m = fs_mask_at(pat, i / grid)
        ch = max(range(4), key=lambda c: m[c]) if max(m) > 0.9999 else -1
        if ch != cur:
            if cur is not None and cur >= 0:
                runs.append((start / grid, (i - 1) / grid))
            start, cur = i, ch
    runs.append((start / grid, 1.0)) if cur is not None and cur >= 0 else None
    cands = [(b - a, hz_of_u((a + b) / 2)) for a, b in runs if hz_of_u((a + b) / 2) >= 150]
    best = sorted(cands, reverse=True)[:count]
    return sorted(round(hz) for _, hz in best)


def cases():
    out = []

    def c(name, **kw):
        d = dict(BASE)
        d["name"] = name
        d.update(kw)
        out.append(d)

    c("sum_default")
    c("sum_1k", n=1024)
    c("sum_2k", n=2048)
    c("sum_s1_xf0", splits=1, xfade=0.0)
    c("sum_s3p5_xf25", splits=3.5, xfade=0.25)
    c("sum_s1024_xf50", splits=1024, xfade=0.5)
    c("sum_s1024_xf0_mid_shaped", splits=1024, dir=1, xfade=0.0, bend=0.6, pinch=-0.5, spin=0.35)
    c("sum_s7p5_low_fracnudge", splits=7.5, dir=2, nudge=2.5, xfade=0.5)
    c("sum_s32_mid_shaped_xf100", splits=32, dir=1, xfade=1.0, bend=0.6, pinch=-0.5, spin=0.35)
    c("sum_s100p3_spin_nudge", splits=100.3, xfade=0.0, bend=-0.9, pinch=0.8, spin=-0.4, nudge=-1.3)
    c("sum_s4_spin50_xf100", splits=4, xfade=1.0, spin=0.5)
    # sines at the centres of regions of the default pattern (16 splits: 17 regions of the log axis)
    iso = lambda case, regs, T: dict(stim="sines", dur=1000, freqs=[region_hz(case, j, T) for j in regs], amps=[0.1] * len(regs))
    for nudge in (0, 1, 2):
        d = dict(BASE, nudge=nudge)
        c(f"iso_n{nudge}", nudge=nudge, **iso(d, [5, 8, 11, 14], 17))
    d = dict(BASE, splits=11, dir=1)
    c("iso_mid", splits=11, dir=1, **iso(d, [4, 6, 9, 10], 12))
    d = dict(BASE, splits=9, dir=2)
    c("iso_low", splits=9, dir=2, **iso(d, [2, 4, 6, 8], 10))
    d = dict(BASE, spin=0.2)
    c("iso_spin", spin=0.2, **iso(d, [5, 8, 11, 12], 17))
    d = dict(BASE, splits=16.5)
    c("iso_frac", splits=16.5, **iso(d, [5, 8, 11, 14], 17.5))
    shaped = dict(BASE, splits=6, dir=1, nudge=1, spin=-0.2, bend=0.3, pinch=-0.3)
    c("iso_shaped", splits=6, dir=1, nudge=1, spin=-0.2, bend=0.3, pinch=-0.3, stim="sines", dur=1000,
      freqs=wide_region_hz(shaped, 4), amps=[0.1] * 4)
    # Nudge 0.5: a sine in a region of channel c0 is split evenly between c0 and c0 + 1
    c("nudge_half", nudge=0.5, stim="sines", dur=1000, freqs=[region_hz(BASE, 8, 17)], amps=[0.1])
    # controls changed mid-run: 3 splits, Nudge 0 -> 16 splits, Nudge 1 (the final layout is what the sines are checked against)
    d = dict(BASE, nudge=1)
    ev = [(100, f"obj-gen-{sel}", 0, m) for sel in (1, 2, 3, 4, 0) for m in ("nsplit 16", "nudgeamt 1")]
    c("iso_change", splits=3, nudge=0, events=ev, final=d, **iso(d, [5, 8, 11, 14], 17))
    c("lim_on", n=2048, limon=1, limdb=-20, stim="sines", dur=1000, freqs=[region_hz(BASE, 8, 17), region_hz(BASE, 5, 17)], amps=[0.8, 0.03])
    c("lim_off", n=2048, limon=0, limdb=-20, stim="sines", dur=1000, freqs=[region_hz(BASE, 8, 17), region_hz(BASE, 5, 17)], amps=[0.8, 0.03])
    c("mix_30", mix=0.3, xfade=0.25)
    c("mix_0", mix=0.0, splits=40.5, dir=1, xfade=0.5, nudge=0.5)
    c("silence", stim="silent", dur=1000)
    for name, n in SIZES.items():
        c(f"latency_{name}", stim="impulse", n=n, settle=0, dur=400, delay=False)
    c("telemetry", n=2048, limon=0, dur=1500)
    return out


def db(x):
    return 10.0 * math.log10(max(x, 1e-300))


def run_case(code, case):
    boxes, lines = build_device(code, case)
    return mh.run_case(f"freqsplit_{case['name']}", boxes, lines, probe_js=PROBE_JS, settle_ms=case["settle"], dur_ms=case["dur"],
                       channels=6, sr=SR, events=case.get("events"))


def check(case, r, store, errors):
    name = case["name"]
    final = case.get("final", case)     # the settings the sines are predicted with (iso_change changes them mid-run)

    def err(msg):
        errors.append(f"{name}: {msg}")

    if r.get("nan", 1) != 0:
        err(f"NaN / inf samples ({r.get('nan')})")
    if r.get("harness_sr") and abs(r["harness_sr"] - SR) > 1:
        err(f"sample rate {r['harness_sr']}")
    if name.startswith("sum_") or name.startswith("mix_"):
        null = db(r["nullE"] / max(r["energyD"], 1e-300))
        en = [r[f"energy{c}"] for c in range(4)]
        print(f"[{name}] null={null:.1f} dB  channel energies {' '.join(f'{e:.3f}' for e in en)}  dry {r['energyD']:.3f}")
        if r["energyD"] < 1.0:
            err("stimulus silent")
        if not null < -90.0:
            err(f"the four channels must null against the input delayed 4096 (got {null:.1f} dB)")
        if name.startswith("sum_") and case["splits"] >= 3 and not all(e > 0 for e in en):
            err("every channel must carry signal")
        if name == "mix_0":
            ratio = [e / r["energyD"] for e in en]
            nullA = db(r["nullA"] / max(r["energyD"], 1e-300))
            print(f"[{name}] chain energy / dry {' '.join(f'{v:.4f}' for v in ratio)} (1/16 = 0.0625); Output All vs dry {nullA:.1f} dB")
            if any(abs(v - 0.0625) > 0.0007 for v in ratio):
                err(f"at Mix 0 every chain must carry a quarter of the dry signal (energy ratios {ratio})")
            if not nullA < -90.0:
                err(f"at Mix 0 Output All must be the dry signal delayed 4096 (got {nullA:.1f} dB)")
        if name == "mix_30":
            nullA = db(r["nullA"] / max(r["energyD"], 1e-300))
            print(f"[{name}] Output All vs dry {nullA:.1f} dB")
            if not nullA < -90.0:
                err(f"Output All (masks sum to 1) must stay the delayed input at Mix 30 % (got {nullA:.1f} dB)")
    elif name.startswith("iso_"):
        iso_all = []
        for fi, f in enumerate(case["freqs"]):
            want = channel_of_hz(final, f)
            amps = [r[f"amp_{c}_{fi}"] for c in range(4)]
            other = max(a for c, a in enumerate(amps) if c != want)
            iso = db((amps[want] ** 2) / max(other ** 2, 1e-300))
            iso_all.append(iso)
            print(f"[{name}] {f} Hz -> channel {want + 1}: amps {' '.join(f'{a:.4f}' for a in amps)}  isolation {iso:.1f} dB")
            if abs(amps[want] - 0.1) > 0.004:
                err(f"{f} Hz must pass at amplitude 0.1 in channel {want + 1} (got {amps[want]:.4f})")
            if not iso > 40:
                err(f"{f} Hz must land in channel {want + 1} with > 40 dB isolation (got {iso:.1f} dB)")
        store[name] = min(iso_all)
    elif name == "nudge_half":
        f = case["freqs"][0]
        c0 = channel_of_hz(dict(case, nudge=0.0), f)
        amps = [r[f"amp_{c}_0"] for c in range(4)]
        print(f"[{name}] {f} Hz (channel {c0 + 1} at Nudge 0): amps {' '.join(f'{a:.4f}' for a in amps)}")
        if abs(amps[c0] - 0.05) > 0.003 or abs(amps[(c0 + 1) % 4] - 0.05) > 0.003:
            err(f"Nudge 0.5 must share the sine evenly between channels {c0 + 1} and {(c0 + 1) % 4 + 1} (0.05 each)")
        if max(amps[(c0 + 2) % 4], amps[(c0 + 3) % 4]) > 0.002:
            err("the other two channels must stay silent")
    elif name in ("lim_on", "lim_off"):
        ch_loud = channel_of_hz(case, case["freqs"][0])
        ch_quiet = channel_of_hz(case, case["freqs"][1])
        a_loud = r[f"amp_{ch_loud}_0"]
        a_quiet = r[f"amp_{ch_quiet}_1"]
        print(f"[{name}] loud sine in channel {ch_loud + 1}: {a_loud:.4f}   quiet sine in channel {ch_quiet + 1}: {a_quiet:.4f}")
        store[name] = (a_loud, a_quiet)
        if name == "lim_off" and not (abs(a_loud - 0.8) < 0.02 and abs(a_quiet - 0.03) < 0.001):
            err(f"limiter off: sines pass at their level (got {a_loud:.4f}, {a_quiet:.4f})")
        if name == "lim_on" and not (0.05 < a_loud < 0.2):
            err(f"limiter -20 dB: the 0.8 sine must be capped near 0.1 (got {a_loud:.4f})")
    elif name == "silence":
        peaks = [r[f"peak{c}"] for c in range(4)] + [r["peakA"]]
        print(f"[silence] peaks {peaks} telemetry awake={int(r['scopeAwake'])} preMax={r['scopePreMax']}")
        if any(p != 0 for p in peaks):
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
    elif name == "telemetry":
        tele = (f"frame={int(r['scopeFrame'])} N={int(r['scopeN'])} awake={int(r['scopeAwake'])} lat={int(r['scopeLat'])} sel={int(r['scopeSel'])} "
                f"lim={int(r['scopeLim'])} preMax={r['scopePreMax']:.3f} ch0Max={r['scopeCh0Max']:.3f} ch1Max={r['scopeCh1Max']:.3f} "
                f"ch2Max={r['scopeCh2Max']:.3f} ch3Max={r['scopeCh3Max']:.3f}")
        print(f"[telemetry] {tele}")
        if r["scopeFrame"] < 5 or r["scopeN"] != 2048 or r["scopeAwake"] != 1 or r["scopeLat"] != LATENCY or r["scopeSel"] != 1 or r["scopeLim"] != 0:
            err(f"telemetry scalars wrong ({tele})")
        if not (r["scopePreMax"] > 0.3 and r["scopeCh0Max"] > 0.1 and r["scopeCh1Max"] > 0.1 and r["scopeCh2Max"] > 0.1 and r["scopeCh3Max"] > 0.05):
            err(f"telemetry columns empty ({tele})")


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
    if "lim_on" in store and "lim_off" in store:
        q_on, q_off = store["lim_on"][1], store["lim_off"][1]
        ok = abs(q_on - q_off) <= 0.0005 * max(q_off, 1e-9) * 10
        print(f"[limiter] quiet sine on {q_on:.5f} vs off {q_off:.5f}")
        if not ok:
            errors.append(f"limiter: the quiet sine must pass unchanged (on {q_on:.5f}, off {q_off:.5f})")
    if errors:
        print("\nFAILED:")
        for e in errors:
            print("  - " + e)
        sys.exit(1)
    print("All Real Max 9 Freq Split audio and telemetry tests passed!")


if __name__ == "__main__":
    main()
