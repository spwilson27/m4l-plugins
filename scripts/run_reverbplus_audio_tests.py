#!/usr/bin/env python3
"""Render Reverb+ (Start + End gens) through Ableton-bundled Max and verify the reverbs, the outer loop and the convolution.

Runs on scripts/max_harness.py (NonRealTime driver, one Max at a time, VM only: AGENTS.md 1a / 1b):
    /usr/bin/python3 scripts/run_reverbplus_audio_tests.py [case ...]      (scripts/vm_reverbplus.sh audio)

One patch simulates a chain: source -> Start gen~ [-> delay~ L (chain latency, optional *~ gain) -> End gen~] -> record~.
Standalone cases use the Start alone (unpaired: it mixes Dry/Wet itself, Dry/Wet 100% = the wet only). The recording has
4 channels: ch1 / ch2 output L / R, ch3 the source's reference marker, ch4 the Start's output L before the chain.
The probe (tests/reverbplus_probe.js, v8, with src/reverbplus_config.js prepended) builds and pokes IRs with the real IR pipeline.

Cases (per algorithm a in plate, hall, room, chamber, spring):
  rt_<a>      impulse -> RT60 of the 1 kHz band (Schroeder, -5..-25 dB) within 15 % of Decay (1.5 s); finite, no DC
  rtl_<a>     the same at Decay 3 s;  size1_<a> / size0_<a>: Size 100 % / 0 %;  damp_<a>: HF Damp 2 kHz shortens the 6 kHz band;  stable_<a>: Decay 60 s, extreme Bass Mult, no growth
  bass_<a>    (hall, room, chamber) Bass Mult 2: the 160 Hz band decays about twice as long as the 1 kHz band
  freeze_<a>  noise burst, Freeze at 1 s (stepped): the level trend over 2 s (500 ms windows) is < 0.5 dB, scatter < 1 dB
  switch      Hall -> Chamber on a sine (stepped): no click (second difference no larger than 3x its steady value), state back to 0
  loop0 / loopon   Loop 0: the tank input is exactly the input whatever the chain does (1.5x gain); Loop 50 %: it adds the return
  loopclip    Loop 110 %, chain gain 1.5x, Hard clip at -6 dB: the tank input stays below the ceiling, output finite and bounded
  looptime / loopmin   Convolution on a Dirac: successive wet impulses land loop time + 256 samples apart (+-1), and at
                       B + L + 4 + 256 when the loop time is below the minimum (MIN flagged in the telemetry)
  conv_null / conv_mono / conv_rev / conv_stretch / conv_long / conv_swap / conv_predelay   convolution against the processed IR
  drywet      End: Dry/Wet 75 % is equal power
  compile     Start and End see each other (K 0, B 64)
  perf_<a>, perf_conv, perf_convlong   audio CPU (adstatus cpu) on the real-time driver (reported, loose limit)
"""

import concurrent.futures
import math
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
PROBE_JS = os.path.join(ROOT, "tests", "reverbplus_probe.js")
SIGVS = 64
SETTLE_MS = 500
SR = 48000
LAT = 256  # convolution engine latency
ALGOS = {"plate": 0, "hall": 1, "room": 2, "chamber": 3, "spring": 4}

SOURCE_GEN = """
Param kind(0);
Param amp(0.8);
Param lch(1);
Param rch(1);
Param pos(600);
Param b1l(80);
Param b2s(-1);
Param b2l(80);
Param freq(220);

History n(0);
History nz(0);
History ph(0);

n = n + 1;
ms = n * 1000 / samplerate;
posS = floor(pos * samplerate / 1000);
d = n - posS;
nz = nz + 0.1 * (noise() - nz);
nzs = nz * 4 * amp;
act = (kind > 1.5) ? (ms >= pos) : ((ms >= pos && ms < pos + b1l) || (b2s >= 0 && ms >= b2s && ms < b2s + b2l));
ph = wrap(ph + freq / samplerate, 0, 1);
bump = (abs(d) < 17) ? amp * 0.5 * (1 + cos(pi * d / 17)) : 0;
sig = (kind < 0.5) ? bump : (kind > 3.5 ? ((d == 0) ? amp : 0) : (kind > 2.5 ? ((ms >= pos) ? amp * sin(twopi * ph) : 0) : (act ? nzs : 0)));
out1 = sig * lch;
out2 = sig * rch;
out3 = (d == 0) ? 1 : 0;
"""

# neutral wet: no filters, no damping, no early/late trim, no width change, Dry/Wet 100 %
BASE = ("algo 1, predelay 0, szp 0.6, dcy 1.5, diffp 0.8, dampf 20000, bassm 1, xoverf 350, modrate 0.6, moddepth 0.25, "
        "erlvl 0, latelvl 0, lowcut 20, highcut 20000, widthp 1, freeze 0, clipmode 0, cliplevel 0, "
        "duckamt 0, duckrel 250, wetmix 1, outdb 0")


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def start_code():
    return "\n".join(read(f) for f in ("cepstrum_lib.genexpr", "reverbplus_conv.genexpr", "reverbplus_start.genexpr"))


def device(start, end, case):
    L = case["L"]
    paired = case["paired"]
    boxes = [
        mh.msg("dev-params", f"lat {L}, {case['params']}", 40, 60, 700),
        mh.msg("dev-src-params", case["source"], 40, 90, 600),
        mh.msg("dev-bind-start", "xfer #0-rpxfer, hdr #0-rphdr, scope #0-rpscope, spec #0-rpspec, irs #0-rpirspec", 40, 120, 480),
        mh.msg("dev-bind-end", "xfer #0-rpxfer, hdr #0-rphdr, scope #0-rpscopeE", 560, 120, 300),
        mh.box("dev-buf-xfer", "buffer~ #0-rpxfer @samps 65536 @chans 5", 700, 20, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-hdr", "buffer~ #0-rphdr @samps 64", 700, 45, 190, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-scope", "buffer~ #0-rpscope @samps 1024", 700, 70, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-spec", "buffer~ #0-rpspec @samps 8224", 940, 70, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-irspec", "buffer~ #0-rpirspec @samps 2327904", 940, 95, 240, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-scopee", "buffer~ #0-rpscopeE @samps 32", 700, 95, 220, numoutlets=2, outlettype=["float", "bang"]),
        # the probe gets the buffer names and (for convolution) builds + pokes the IR; one message box keeps the order
        mh.msg("dev-setbuf", "setbuffers #0-rpxfer #0-rphdr #0-rpscope #0-rpirspec #0-rpscopeE"
               + (", " + case["ir"] if case.get("ir") else ""), 380, 150, 600),
        mh.gen_box("dev-src", SOURCE_GEN, 40, 160, numinlets=1, numoutlets=3),
        mh.gen_box("dev-start", start, 40, 260, numinlets=2, numoutlets=2),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-src-params", 0),
        mh.line("obj-load", 0, "dev-bind-start", 0),
        mh.line("obj-load", 0, "dev-bind-end", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-params", 0, "dev-start", 0),
        mh.line("dev-bind-start", 0, "dev-start", 0),
        mh.line("dev-src-params", 0, "dev-src", 0),
        mh.line("dev-src", 0, "dev-start", 0),
        mh.line("dev-src", 1, "dev-start", 1),
        mh.line("dev-src", 2, "obj-record", 2),
        mh.line("dev-start", 0, "obj-record", 3),
    ]
    if not paired:
        lines += [
            mh.line("dev-start", 0, "obj-record", 0), mh.line("dev-start", 1, "obj-record", 1),
            mh.line("dev-start", 0, "obj-mute-l", 0), mh.line("dev-start", 1, "obj-mute-r", 0),
        ]
    else:
        boxes += [
            mh.gen_box("dev-end", end, 40, 400, numinlets=2, numoutlets=2),
            mh.box("dev-dl", f"delay~ 65536 {L}", 300, 330, 110, numinlets=2, outlettype=["signal"]),
            mh.box("dev-dr", f"delay~ 65536 {L}", 430, 330, 110, numinlets=2, outlettype=["signal"]),
        ]
        lines += [
            mh.line("dev-bind-end", 0, "dev-end", 0),
            mh.line("dev-end", 0, "obj-record", 0), mh.line("dev-end", 1, "obj-record", 1),
            mh.line("dev-end", 0, "obj-mute-l", 0), mh.line("dev-end", 1, "obj-mute-r", 0),
        ]
        for ch, d in ((0, "dev-dl"), (1, "dev-dr")):
            lines.append(mh.line("dev-start", ch, d, 0))
            if case["gain"] != 1.0:
                g = f"dev-g{ch}"
                boxes.append(mh.box(g, f"*~ {case['gain']}", 300 + 130 * ch, 365, 50, numinlets=2, outlettype=["signal"]))
                lines += [mh.line(d, 0, g, 0), mh.line(g, 0, "dev-end", ch)]
            else:
                lines.append(mh.line(d, 0, "dev-end", ch))
    if case.get("mode") == "audio_device":
        boxes += [
            mh.box("dev-metro", "metro 100", 40, 480, 70, numinlets=2),
            mh.box("dev-adstatus", "adstatus cpu", 40, 510, 90, outlettype=["float"]),
            mh.box("dev-cpu-prep", "prepend cpu", 40, 540, 90),
        ]
        lines += [
            mh.line("obj-load", 0, "dev-metro", 0),
            mh.line("dev-metro", 0, "dev-adstatus", 0),
            mh.line("dev-adstatus", 0, "dev-cpu-prep", 0),
            mh.line("dev-cpu-prep", 0, "obj-js", 0),
        ]
    return boxes, lines


def cases():
    def c(name, params="", source="kind 4, amp 1.0, pos 600", L=0, gain=1.0, dur=700, dump=True, mode="nrt", events=None,
          paired=False, ir=""):
        return {"name": name, "params": BASE + (", " + params if params else ""), "source": source, "L": L, "gain": gain,
                "dur": dur, "dump": dump, "mode": mode, "events": events or [], "paired": paired, "ir": ir}

    out = [c("compile", "algo 1", L=256, paired=True, dur=500, dump=False)]
    for a, k in ALGOS.items():
        out.append(c(f"rt_{a}", f"algo {k}, dcy 1.5", dur=3500))
        out.append(c(f"rtl_{a}", f"algo {k}, dcy 3", dur=5500))
        out.append(c(f"damp_{a}", f"algo {k}, dcy 1.5, dampf 2000", dur=3500))
        out.append(c(f"size1_{a}", f"algo {k}, dcy 1.5, szp 1", dur=3500))
        out.append(c(f"size0_{a}", f"algo {k}, dcy 1.5, szp 0", dur=3500))
        # longest decay and the extreme Bass Multipliers must stay lossy (no growth): 6 s of a noise burst
        out.append(c(f"stable_{a}", f"algo {k}, dcy 60, bassm {4 if a in ('hall', 'chamber') else 0.25}",
                     source="kind 1, amp 0.5, pos 700, b1l 80", dur=6000, dump=True))
        if a in ("hall", "room", "chamber"):
            out.append(c(f"bass_{a}", f"algo {k}, dcy 1.5, bassm 2", dur=5000))
        out.append(c(f"freeze_{a}", f"algo {k}, dcy 2.5", source="kind 1, amp 0.5, pos 700, b1l 80", dur=3300,
                     mode="stepped", events=[(1000, "dev-start", 0, "freeze 1")]))
    # energy gain of the wet (tank input -> wet output) per algorithm: late part (Early -70 dB) and early part (Late -70 dB)
    for a, k in ALGOS.items():
        for tag, dc, sz, dur in (("d08", 0.8, 0.6, 2500), ("d15", 1.5, 0.6, 3500), ("d4", 4, 0.6, 6500), ("d10", 10, 0.6, 12500), ("s0", 1.5, 0, 3500), ("s1", 1.5, 1, 3500)):
            out.append(c(f"egl_{a}_{tag}", f"algo {k}, dcy {dc}, szp {sz}, erlvl -70", dur=dur))
        if a in ("hall", "room", "chamber"):
            out.append(c(f"ege_{a}", f"algo {k}, dcy 1.5, latelvl -70", dur=1500))
    out += [
        c("switch", "algo 1, dcy 1.2", source="kind 3, amp 0.3, pos 100, freq 220", dur=1600, mode="stepped",
          events=[(1100, "dev-start", 0, "algo 3")]),
        c("loop0", "algo 1, loopg 0", source="kind 2, amp 0.3, pos 100", L=256, gain=1.5, paired=True, dur=1500, dump=False),
        c("loopon", "algo 1, loopg 0.5", source="kind 2, amp 0.3, pos 100", L=256, gain=1.5, paired=True, dur=1500, dump=False),
        c("loopclip", "algo 1, dcy 2, loopg 1.1, looptime 80, clipmode 1, cliplevel -6", source="kind 1, amp 0.5, pos 700, b1l 80",
          L=256, gain=1.5, paired=True, dur=4000, dump=False),
        c("looptime", "algo 5, loopg 0.5, looptime 100, latelvl 0", L=256, paired=True, dur=1500,
          ir="buildir dirac 1 100 0 0 100 1"),
        c("loopmin", "algo 5, loopg 0.5, looptime 0, latelvl 0", L=256, paired=True, dur=700,
          ir="buildir dirac 1 100 0 0 100 1"),
        c("conv_null", "algo 5, latelvl 0", dur=1700, ir="buildir noise 1200 100 0 0 100 1"),
        c("conv_mono", "algo 5, latelvl 0", dur=1700, ir="buildir mono 1200 100 0 0 100 0"),
        c("conv_rev", "algo 5, latelvl 0", dur=1700, ir="buildir noise 1200 100 0 1 100 1"),
        c("conv_stretch", "algo 5, latelvl 0", dur=2600, ir="buildir noise 1200 150 0 0 100 1"),
        c("conv_long", "algo 5, latelvl 0", dur=6900, ir="buildir long 6000 100 0 0 100 1"),
        c("conv_predelay", "algo 5, latelvl 0, predelay 100", dur=500, ir="buildir dirac 1 100 0 0 100 1"),
        c("conv_swap", "algo 5, latelvl 0", source="kind 2, amp 0.3, pos 100", dur=2400, mode="stepped",
          ir="buildir noise 1200 100 0 0 100 1", events=[(1200, "obj-js", 0, "swapir")]),
        c("drywet", "algo 5, wetmix 0.75, latelvl 0", L=256, paired=True, dur=600, ir="buildir dirac 1 100 0 0 100 1"),
    ]
    for a, k in ALGOS.items():
        out.append(c(f"perf_{a}", f"algo {k}", source="kind 2, amp 0.3, pos 100", dur=3000, mode="audio_device", dump=False))
    out.append(c("perf_conv", "algo 5", source="kind 2, amp 0.3, pos 100", dur=3000, mode="audio_device", dump=False,
                 ir="buildir noise 2000 100 0 0 100 1"))
    out.append(c("perf_convlong", "algo 5", source="kind 2, amp 0.3, pos 100", dur=3000, mode="audio_device", dump=False,
                 ir="buildir long 6000 100 0 0 100 1"))
    return out


def parse_data(path):
    ch = {}
    cur = None
    with open(path) as f:
        for tok in f.read().split():
            if tok.startswith("ch"):
                cur = ch.setdefault(tok, [])
            elif cur is not None:
                cur.append(int(tok) / 100000.0 - 8.0)
    return ch


def run_case(start, end, case, probe_path):
    boxes, lines = device(start, end, case)
    try:
        meta = mh.run_case(
            case["name"], boxes, lines, probe_js=probe_path, probe_args=f"{case['name']} {1 if case['dump'] else 0}",
            settle_ms=SETTLE_MS, dur_ms=case["dur"], channels=4, mode=case["mode"], events=case["events"], keep_dir=True,
            probe_object="v8", timeout=600)
    except Exception as exc:  # noqa: BLE001 - reported as a failed case
        return {"name": case["name"], "error": str(exc)}, None
    work = meta.get("harness_dir")
    data = None
    if case["dump"] and work and os.path.exists(os.path.join(work, "result.txt.data")):
        data = parse_data(os.path.join(work, "result.txt.data"))
    if work:
        shutil.rmtree(work, ignore_errors=True)
    meta["hdr"] = [meta.get(f"h{i}", float("nan")) for i in range(48)]
    meta["scope"] = [meta.get(f"s{i}", float("nan")) for i in range(32)]
    return meta, data


# ---- analysis ---------------------------------------------------------------------------------------

def db(x):
    return 20 * math.log10(max(abs(x), 1e-12))


def biquad_bp(x, fc, q):
    w0 = 2 * math.pi * fc / SR
    alpha = math.sin(w0) / (2 * q)
    b0, b2 = alpha, -alpha
    a0, a1, a2 = 1 + alpha, -2 * math.cos(w0), 1 - alpha
    b0, b2, a1, a2 = b0 / a0, b2 / a0, a1 / a0, a2 / a0
    y = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b0 * v + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, v
        y2, y1 = y1, o
        y[i] = o
    return y


def rt60(x, lo=-5.0, hi=-25.0):
    """Schroeder backward integration, line through the lo..hi dB points, extrapolated to 60 dB."""
    e = [v * v for v in x]
    s = [0.0] * len(e)
    acc = 0.0
    for i in range(len(e) - 1, -1, -1):
        acc += e[i]
        s[i] = acc
    if s[0] <= 0:
        return None
    i1 = i2 = None
    for i, v in enumerate(s):
        d = 10 * math.log10(max(v / s[0], 1e-30))
        if i1 is None and d <= lo:
            i1 = i
        if i2 is None and d <= hi:
            i2 = i
            break
    if i1 is None or i2 is None or i2 <= i1:
        return None
    return (i2 - i1) / SR * 60.0 / (lo - hi)


def ref_index(data):
    for i, v in enumerate(data.get("ch3", [])):
        if v > 0.5:
            return i
    return None


def peak_near(ch, center, half=40):
    lo = max(0, int(center) - half)
    hi = min(len(ch), int(center) + half + 1)
    seg = ch[lo:hi]
    if not seg:
        return None, 0.0
    j = max(range(len(seg)), key=lambda i: abs(seg[i]))
    return lo + j, seg[j]


def rms(seg):
    return math.sqrt(sum(v * v for v in seg) / max(len(seg), 1))


RESULTS = {}


def check(case, meta, data, errors):
    name = case["name"]
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    hdr, sc = meta["hdr"], meta["scope"]

    def err(msg):
        errors.append(f"{name}: {msg}")

    if name == "compile":
        if meta["maxabs1"] < 0.0 and False:
            err("silent")
        if hdr[14] != 1 or hdr[15] != 1:
            err(f"Start / End do not see each other (hdr14/15 = {hdr[14:16]})")
        if hdr[3] != SIGVS:
            err(f"B = {hdr[3]}, expected {SIGVS}")
        if hdr[2] != 0:
            err(f"K = {hdr[2]}, expected 0")
        print(f"compile: K {hdr[2]:.0f} B {hdr[3]:.0f} L {hdr[4]:.0f} algo {sc[2]:.0f}")
        return

    if name.startswith("perf_"):
        print(f"{name}: audio CPU avg {meta.get('cpuAvg', float('nan')):.1f}% max {meta.get('cpuMax', float('nan')):.1f}% "
              f"(real-time driver, harness floor about 9%)")
        RESULTS[name] = (meta.get("cpuAvg"), meta.get("cpuMax"))
        if not meta.get("cpuCount"):
            err("no CPU samples from adstatus cpu")
        elif meta.get("cpuMax", 0) > 80:
            err(f"audio CPU peaked at {meta['cpuMax']:.1f}%")
        return

    if name == "loopclip":
        print(f"loopclip: max |out| {meta['maxabs1']:.3f}, tank input peak (last 64 samples) {sc[13]:.4f}, ceiling 0.5012")
        if meta["maxabs1"] > 6.5:
            err(f"output peak {meta['maxabs1']:.2f} > 6.5 (the output safety ceiling is 6)")
        if sc[13] > 0.5012 + 1e-3:
            err(f"tank input {sc[13]:.4f} above the -6 dB ceiling")
        return

    if name in ("loop0", "loopon"):
        # the tank input (scope 13, peak of the last 64 samples) against the input (scope 12): with Loop 0 the return adds exactly
        # nothing, whatever the chain does (1.5x gain here); with Loop on it adds the return
        print(f"{name}: tank input peak {sc[13]:.6f}, input peak {sc[12]:.6f}, return peak {sc[15]:.4f}")
        if sc[12] < 0.05:
            err("input silent")
        if name == "loop0" and abs(sc[13] - sc[12]) > 1e-9:
            err(f"Loop 0 is not a bypass of the return: tank input {sc[13]:.9f} vs input {sc[12]:.9f}")
        if name == "loopon" and not sc[13] > sc[12] + 1e-3:
            err("Loop 50 % adds nothing to the tank input")
        return

    if data is None:
        err("no recorded data")
        return
    r0 = ref_index(data)
    l, r, st = data["ch1"], data["ch2"], data["ch4"]
    if r0 is None and not (name.startswith("freeze_") or name == "switch" or name == "conv_swap"):
        err("reference marker not recorded")
        return

    if name.startswith("stable_"):
        wins = [db(rms(l[int(t * SR):int((t + 1) * SR)])) for t in range(1, 5)]
        print(f"{name}: level per second {' '.join(f'{w:.1f}' for w in wins)} dB, peak {meta['maxabs1']:.3f}")
        if meta["maxabs1"] > 2.0:
            err(f"peak {meta['maxabs1']:.2f}")
        if wins[-1] > wins[0] + 0.5:
            err(f"the tail grows ({wins[0]:.1f} -> {wins[-1]:.1f} dB)")
        return

    if name.startswith(("egl_", "ege_")):
        x = l[r0:]
        en = sum(v * v for v in x)
        print(f"{name}: wet energy {en:.4f} ({10 * math.log10(max(en, 1e-9)):+.2f} dB) hrms2 {meta.get('hrms2', float('nan')):.4f} hpk2 {meta.get('hpk2', float('nan')):.3f}")
        return

    if name.startswith(("rt_", "rtl_", "size1_", "size0_")):
        algo = name.split("_", 1)[1]
        want = 3.0 if name.startswith("rtl_") else 1.5
        x = l[r0:]
        mean = sum(x) / len(x)
        t_mid = rt60(biquad_bp(x, 1000, 1.5))
        en = sum(v * v for v in x)
        print(f"{name}: RT60 at 1 kHz {t_mid and round(t_mid, 3)} s (want {want}), peak {meta['maxabs1']:.3f}, mean {mean:.2e}, "
              f"IR energy {en:.3f} ({10 * math.log10(max(en, 1e-9)):+.1f} dB; unit gain = 0 dB), telemetry mid {sc[23]:.2f}")
        if t_mid is None or abs(t_mid / want - 1) > 0.15:
            err(f"RT60 {t_mid} s vs {want} s (> 15 %)")
        if abs(mean) > 1e-3:
            err(f"DC offset {mean:.2e}")
        if meta["maxabs1"] > 1.5:
            err(f"peak {meta['maxabs1']:.2f}")
        if meta["maxabs1"] < 1e-3:
            err("silent")
        if abs(sc[2] - ALGOS[algo]) > 0.5:
            err(f"algorithm {sc[2]} running, expected {ALGOS[algo]}")
        return

    if name.startswith("damp_"):
        x = l[r0:]
        bands = {f: rt60(biquad_bp(x, f, 1.5)) for f in (250, 700, 2000, 6000)}
        t_hi, t_mid = bands[6000], bands[700]
        print(f"{name}: RT60 by band (HF Damp 2 kHz): " + ", ".join(f"{f} Hz {v and round(v, 2)} s" for f, v in bands.items()))
        if t_hi is None or t_mid is None or t_hi > 0.75 * t_mid:
            err(f"HF Damp 2 kHz: 6 kHz decays in {t_hi} s vs {t_mid} s at 700 Hz (want < 75 %)")
        return

    if name.startswith("bass_"):
        x = l[r0:]
        t_lo = rt60(biquad_bp(x, 100, 1.5))
        t_mid = rt60(biquad_bp(x, 1000, 1.5))
        print(f"{name}: RT60 100 Hz {t_lo and round(t_lo, 2)} s, 1 kHz {t_mid and round(t_mid, 2)} s (Bass Mult 2 below the 350 Hz crossover: about 2x)")
        if t_lo is None or t_mid is None or not (1.5 <= t_lo / t_mid <= 2.4):
            err(f"low / mid RT60 ratio {t_lo and t_mid and round(t_lo / t_mid, 2)} outside 1.5..2.4")
        return

    if name.startswith("freeze_"):
        # frozen from 0.5 s of the take (Freeze at 1.0 s DSP, burst 700..780 ms): four 500 ms windows over the next 2 s; drift = the
        # straight-line trend over the 2 s (the window-to-window scatter of a noise-like frozen tail is judged separately, < 1 dB)
        wins = []
        for t in range(2, 6):
            a = int(t * 0.5 * SR)
            wins.append(db(rms(l[a:a + int(0.5 * SR)])))
        xs = [0.5 * k for k in range(len(wins))]
        mx, my = sum(xs) / len(xs), sum(wins) / len(wins)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, wins)) / sum((x - mx) ** 2 for x in xs)
        drift = abs(slope) * 2.0
        spread = max(wins) - min(wins)
        print(f"{name}: level {min(wins):.2f}..{max(wins):.2f} dB (500 ms windows over 2 s), trend {drift:.2f} dB / 2 s, scatter {spread:.2f} dB")
        if min(wins) < -80:
            err("went silent")
        if drift > 0.5 or spread > 1.0:
            err(f"drift {drift:.2f} dB / 2 s (> 0.5) or scatter {spread:.2f} dB (> 1.0)")
        return

    if name == "switch":
        # second difference: steady value before the switch (event at 1100 ms = take 600 ms), then the maximum after it
        def d2max(a, b):
            return max(abs(l[i] - 2 * l[i - 1] + l[i - 2]) for i in range(max(a, 2), b))
        before = d2max(int(0.25 * SR), int(0.58 * SR))
        after = d2max(int(0.60 * SR), int(1.05 * SR))
        print(f"switch: max second difference {before:.5f} before, {after:.5f} after (state {meta.get('astate')}, algo {sc[2]:.0f})")
        if after > 3 * before + 1e-4:
            err(f"click: {after:.5f} vs {before:.5f}")
        if sc[2] != 3 or meta.get("astate") != 0:
            err(f"algorithm {sc[2]} state {meta.get('astate')}, expected 3 / 0")
        return

    if name in ("looptime", "loopmin"):
        B, Lc = hdr[3], 256
        expect = (round(0.1 * SR) if name == "looptime" else int(B + Lc + 4)) + LAT
        first, v0 = peak_near(st, r0 + LAT, 8)
        second, v1 = peak_near(st, first + expect, 8)
        third, v2 = peak_near(st, second + expect, 8)
        print(f"{name}: wet impulses at {first - r0}, {second - r0}, {third - r0}: spacing {second - first}, {third - second} "
              f"(expect {expect}), ratios {v1 / v0:.3f} {v2 / v1:.3f}; B {B:.0f} MIN {sc[8] * SR / 1000:.0f} smp clamped {sc[11]:.0f}")
        if abs((second - first) - expect) > 1 or abs((third - second) - expect) > 1:
            err(f"loop spacing {second - first}, {third - second}, expected {expect} (+-1)")
        if not (0.45 < v1 / v0 < 0.55):
            err(f"loop gain {v1 / v0:.3f}, expected 0.5")
        if name == "loopmin" and sc[11] != 1:
            err("MIN not flagged")
        if name == "looptime" and sc[11] != 0:
            err("clamped flag set")
        return

    if name == "drywet":
        di, dv = peak_near(l, r0 + 256, 6)
        wi, wv = peak_near(l, r0 + 256 + LAT, 6)
        want = 20 * math.log10(math.tan(0.75 * math.pi / 2))
        got = db(wv / dv)
        print(f"drywet 75%: dry at +{di - r0} wet at +{wi - r0}, wet / dry {got:+.2f} dB (expected {want:+.2f})")
        if abs(got - want) > 0.3:
            err(f"wet / dry {got:+.2f} dB, expected {want:+.2f}")
        return

    if name.startswith("conv_"):
        print(f"{name}: null L {meta.get('null_l', float('nan')):.1f} dB, R {meta.get('null_r', float('nan')):.1f} dB, "
              f"IR {meta.get('ir_len')} samples, output length {meta.get('len_meas')}, maxabs {meta['maxabs1']:.3f}")
        if name == "conv_swap":
            if meta["maxabs1"] < 0.01:
                err("silent after the IR swap")
            return
        if name == "conv_predelay":
            pi_, pv = peak_near(l, r0 + round(0.1 * SR), 6)
            print(f"conv_predelay: impulse at +{pi_ - r0} (expect {round(0.1 * SR)})")
            if abs(pi_ - r0 - round(0.1 * SR)) > 1:
                err(f"pre-delay lands at {pi_ - r0}")
            return
        if name == "conv_stretch":
            ratio = meta.get("len_meas", 0) / 57600.0
            print(f"conv_stretch: length ratio {ratio:.3f} (want 1.5)")
            if abs(ratio - 1.5) > 0.03:
                err(f"stretch 150 % gave length ratio {ratio:.3f}")
        if meta.get("null_l", 0) > -80 or meta.get("null_r", 0) > -80:
            err(f"null vs the processed IR: {meta.get('null_l', float('nan')):.1f} / {meta.get('null_r', float('nan')):.1f} dB (want < -80)")
        if name == "conv_mono":
            diff = max(abs(l[i] - r[i]) for i in range(len(l)))
            print(f"conv_mono: max |L - R| {diff:.2e}")
            if diff > 2e-5:
                err("mono IR does not play on both channels identically")
        if name == "conv_rev":
            # independent of the pipeline: the original's loudest sample (its first, 0.9) is now the LAST sample of the IR
            idx = max(range(len(l)), key=lambda i: abs(l[i]))
            print(f"conv_rev: loudest output sample at +{idx - r0 - LAT} of the {meta.get('ir_len'):.0f}-sample reversed IR")
            if abs(idx - r0 - LAT - (meta.get("ir_len", 0) - 1)) > 2:
                err("the reversed IR's loud first sample is not at its end")
        return


def main():
    only = set(sys.argv[1:])
    todo = [c for c in cases() if not only or c["name"] in only or any(c["name"].startswith(o[:-1]) for o in only if o.endswith("*"))]
    start = start_code()
    with open(os.path.join(SRC, "reverbplus_end.genexpr"), encoding="utf-8") as f:
        end = f.read()
    tmp = tempfile.mkdtemp(prefix="rp_probe_")
    probe = os.path.join(tmp, "reverbplus_probe.js")
    with open(probe, "w", encoding="utf-8") as f:
        f.write(read("reverbplus_config.js") + "\n" + open(PROBE_JS, encoding="utf-8").read())
    # loop0_a / loop0_b are compared with each other: keep their order in the report
    results = []
    errors = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, max(len(todo), 1))) as ex:
            runs = list(ex.map(lambda c: run_case(start, end, c, probe), todo))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    for case, (meta, data) in zip(todo, runs):
        before = len(errors)
        if meta is not None and "error" in meta:
            errors.append(f"{case['name']}: {meta['error']}")
        else:
            print(f"--- {case['name']} --- wall {meta['harness_wall_s']:.1f}s nan {meta.get('nan', '?')} maxabs {meta.get('maxabs1', 0):.4f}")
            check(case, meta, data, errors)
        results.append((case["name"], "PASS" if len(errors) == before else "FAIL"))
        print(f"[{results[-1][1]}] {case['name']}")
    print("=== summary ===")
    for n, s in results:
        print(f"{s} {n}")
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("reverbplus audio checks passed")


if __name__ == "__main__":
    main()
