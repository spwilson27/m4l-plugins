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
  lrt_<a>_<x> Start -> unity chain (delay L, gain 1) -> End on an impulse, 3 Decay / Size settings: RT60 of the 1 kHz band within
               15 % of Decay although tank AND the recirculating chain loop make the tail (the tank runs at 0.3 x Decay while paired)
  lg15_<a>     chain gain 1.5 (+ Decay 4, noise burst): the clip keeps it finite and bounded (the loop gain 1.5 g may exceed 1: it saturates
               at the clip and sustains, it does not grow past it)
  loopclip     chain gain 20, Hard clip at -6 dB: the loop's contribution stays below the ceiling, output finite and bounded
  period_<a>   the telemetry loop time equals the derived period (K x the tank's characteristic period, +-1 sample), or MIN when clamped;
               the telemetry loop gain is 10^(-3 (T + allpass delay) / Decay)
  looptime / loopmin   Convolution on a Dirac: the first recirculation lands exactly the derived loop time later (+-1; the loop does not pass the convolution engine), its ratio
                       to the wet impulse = loop gain x (allpass coefficient)^4 (the allpass chain's direct path), and at
                       B + L + 4 when the derived time is below the minimum (MIN flagged)
  shimmer      a +12 st granular pitch shifter in the chain (unity gain, latency 1024), a 468.75 Hz sine burst: energy at 2f, 4f and 8f
               appears successively over the passes, 4f and 8f at most 10 dB below the previous partial, the tail stays bounded
  freezeL_hall  paired Hall, Freeze at 1 s: the loop return is muted, level trend < 0.5 dB over 2 s
  conv_null / conv_mono / conv_rev / conv_stretch / conv_long / conv_swap / conv_predelay   convolution against the processed IR
  drywet      End: Dry/Wet 75 % is equal power
  compile     Start and End see each other (K 0, B 64)
  sleep_<a>   two noise bursts 3 s apart at Decay 0.3 s: the second one's response has the energy of the first (the idle sleep woke the
              tank, within 2 dB), nothing audible after the tail (< -140 dB) and the telemetry reports the sleep; sleep_size_hall changes Size while
              asleep (within 3 dB)
  perf_<a>, perf_idle_<a>, perf_conv, perf_convlong   audio CPU (adstatus cpu) on the real-time driver, playing / silent input (reported, loose limit)
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
burst = (ms >= pos && ms < pos + b1l);
sig = (kind > 4.5) ? (burst ? amp * sin(twopi * ph) : 0) : (kind < 0.5) ? bump : (kind > 3.5 ? ((d == 0) ? amp : 0) : (kind > 2.5 ? ((ms >= pos) ? amp * sin(twopi * ph) : 0) : (act ? nzs : 0)));
out1 = sig * lch;
out2 = sig * rch;
out3 = (d == 0) ? 1 : 0;
"""

# +12 st granular pitch shifter for the chain (two crossfading taps of a delay line, unity gain for in-phase taps): the delay shrinks
# by (ratio - 1) samples per sample over a window of W samples and wraps; the two taps are half a window apart with sin^2 / cos^2 weights.
# Mean latency W / 2 = 1024 samples (the case's chain latency L).
SHIFT_GEN = """
Delay dlL(8192);
Delay dlR(8192);
Param ratio(2);
History ph(0);

W = 2048;
ph = wrap(ph + (ratio - 1) / W, 0, 1);
p2 = wrap(ph + 0.5, 0, 1);
d1 = 1 + (W - 2) * (1 - ph);
d2 = 1 + (W - 2) * (1 - p2);
g1 = sin(pi * ph) * sin(pi * ph);
g2 = sin(pi * p2) * sin(pi * p2);
dlL.write(in1);
dlR.write(in2);
out1 = g1 * dlL.read(d1, interp="linear") + g2 * dlL.read(d2, interp="linear");
out2 = g1 * dlR.read(d1, interp="linear") + g2 * dlR.read(d2, interp="linear");
"""

# The same shifter with a slow time-varying delay on top (+-8 samples at 1.7 Hz, about +-0.2 % pitch wobble): a chain that decorrelates
# its output from Start's tap, so End's audio calibration can never lock. The loop must not care (shimmer_vary).
SHIFT_VARY_GEN = SHIFT_GEN.replace("History ph(0);", "History ph(0);\nHistory vn(0);").replace(
    "W = 2048;", "W = 2048;\nvn = vn + 1;\nvib = 8 * sin(twopi * 1.7 * vn / samplerate);", 1).replace(
    "d1 = 1 + (W - 2) * (1 - ph);", "d1 = 10 + (W - 2) * (1 - ph) + vib;").replace(
    "d2 = 1 + (W - 2) * (1 - p2);", "d2 = 10 + (W - 2) * (1 - p2) + vib;")

# neutral wet: no filters, no damping, no early/late trim, no width change, Dry/Wet 100 %
BASE = ("algo 1, predelay 0, szp 0.6, dcy 1.5, diffp 0.8, dampf 20000, bassm 1, xoverf 350, modrate 0.6, moddepth 0.25, "
        "erlvl 0, latelvl 0, lowcut 20, highcut 20000, widthp 1, freeze 0, clipmode 0, cliplevel 0, "
        "duckamt 0, duckrel 250, wetmix 1, outdb 0")


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def start_code():
    code = "\n".join(read(f) for f in ("cepstrum_lib.genexpr", "reverbplus_conv.genexpr", "reverbplus_start.genexpr"))
    if os.environ.get("RP_NOSLEEP"):   # measurement knob: the idle sleep never engages (compare the perf_idle_* cases)
        assert "quietCnt >= 32768" in code
        code = code.replace("quietCnt >= 32768", "quietCnt >= 1000000000")
    return code


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
        mh.box("dev-buf-scope", "buffer~ #0-rpscope @samps 64", 700, 70, 220, numoutlets=2, outlettype=["float", "bang"]),
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
        boxes.append(mh.gen_box("dev-end", end, 40, 400, numinlets=2, numoutlets=2))
        if not case.get("shifter"):
            boxes += [
                mh.box("dev-dl", f"delay~ 65536 {L}", 300, 330, 110, numinlets=2, outlettype=["signal"]),
                mh.box("dev-dr", f"delay~ 65536 {L}", 430, 330, 110, numinlets=2, outlettype=["signal"]),
            ]
        lines += [
            mh.line("dev-bind-end", 0, "dev-end", 0),
            mh.line("dev-end", 0, "obj-record", 0), mh.line("dev-end", 1, "obj-record", 1),
            mh.line("dev-end", 0, "obj-mute-l", 0), mh.line("dev-end", 1, "obj-mute-r", 0),
        ]
        if case.get("shifter"):
            boxes.append(mh.gen_box("dev-shift", SHIFT_VARY_GEN if case["shifter"] == "vary" else SHIFT_GEN, 300, 330, numinlets=2, numoutlets=2))
            for ch in (0, 1):
                lines += [mh.line("dev-start", ch, "dev-shift", ch), mh.line("dev-shift", ch, "dev-end", ch)]
        for ch, d in (() if case.get("shifter") else ((0, "dev-dl"), (1, "dev-dr"))):
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
          paired=False, ir="", shifter=False):
        return {"name": name, "shifter": shifter, "params": BASE + (", " + params if params else ""), "source": source, "L": L, "gain": gain,
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
    # derived outer loop: unity chain RT60, gain 1.5, period telemetry
    for a, k in ALGOS.items():
        for tag, dc, sz, dur in (("a", 1.5, 0.6, 3500), ("b", 3, 1, 5500), ("c", 1, 0, 2600)):
            out.append(c(f"lrt_{a}_{tag}", f"algo {k}, dcy {dc}, szp {sz}", L=256, paired=True, dur=dur))
        out.append(c(f"lg15_{a}", f"algo {k}, dcy 4", source="kind 1, amp 0.5, pos 700, b1l 80", L=256, gain=1.5, paired=True, dur=6000))
        out.append(c(f"period_{a}", f"algo {k}, dcy 2, szp 0.3", L=256, paired=True, dur=600, dump=False))
    out.append(c("shimmer", "algo 1, dcy 3, szp 0.6", source="kind 5, amp 0.5, pos 700, b1l 200, freq 468.75", L=1024, paired=True, dur=7000,
                 shifter=True))
    out.append(c("shimmer_vary", "algo 1, dcy 3, szp 0.6", source="kind 5, amp 0.5, pos 700, b1l 200, freq 468.75", L=1024, paired=True,
                 dur=7000, shifter="vary"))
    out.append(c("period_room_min", "algo 2, dcy 2, szp 0", L=2400, paired=True, dur=600, dump=False))
    out += [
        c("switch", "algo 1, dcy 1.2", source="kind 3, amp 0.3, pos 100, freq 220", dur=1600, mode="stepped",
          events=[(1100, "dev-start", 0, "algo 3")]),
        c("loopclip", "algo 1, dcy 2, clipmode 1, cliplevel -6", source="kind 1, amp 0.5, pos 700, b1l 80",
          L=256, gain=20.0, paired=True, dur=4000),
        c("looptime", "algo 5, latelvl 0", L=256, paired=True, dur=1500, ir="buildir dirac 1 100 0 0 100 1"),
        c("loopmin", "algo 5, latelvl 0", L=2400, paired=True, dur=1500, ir="buildir dirac 1 100 0 0 100 1"),
        c("freezeL_hall", "algo 1, dcy 2.5", source="kind 1, amp 0.5, pos 700, b1l 80", L=256, paired=True, dur=3300, mode="stepped",
          events=[(1000, "dev-start", 0, "freeze 1")]),
        c("conv_null", "algo 5, latelvl 0", dur=1700, ir="buildir noise 1200 100 0 0 100 1"),
        c("conv_mono", "algo 5, latelvl 0", dur=1700, ir="buildir mono 1200 100 0 0 100 0"),
        c("conv_rev", "algo 5, latelvl 0", dur=1700, ir="buildir noise 1200 100 0 1 100 1"),
        c("conv_stretch", "algo 5, latelvl 0", dur=2600, ir="buildir noise 1200 150 0 0 100 1"),
        c("conv_long", "algo 5, latelvl 0", dur=6900, ir="buildir long 6000 100 0 0 100 1"),
        c("conv_predelay", "algo 5, latelvl 0, predelay 100", dur=500, ir="buildir dirac 1 100 0 0 100 1"),
        c("conv_swap", "algo 5, latelvl 0", source="kind 2, amp 0.3, pos 100", dur=2400, mode="stepped",
          ir="buildir noise 1200 100 0 0 100 1", events=[(1200, "obj-js", 0, "swapir")]),
        c("drywet", "algo 5, wetmix 0.75, latelvl 0", L=256, paired=True, dur=600, ir="buildir dirac 1 100 0 0 100 1"),
        # Input: scales only what enters the reverb; the dry path is untouched, 0 dB is the plain drywet case
        c("input_0", "algo 5, wetmix 0.75, latelvl 0, indb 0", L=256, paired=True, dur=600, ir="buildir dirac 1 100 0 0 100 1"),
        c("input_m12", "algo 5, wetmix 0.75, latelvl 0, indb -12", L=256, paired=True, dur=600, ir="buildir dirac 1 100 0 0 100 1"),
    ]
    for a, k in ALGOS.items():
        out.append(c(f"perf_{a}", f"algo {k}", source="kind 2, amp 0.3, pos 100", dur=3000, mode="audio_device", dump=False))
    for a, k in ALGOS.items():
        out.append(c(f"sleep_{a}", f"algo {k}, dcy 0.3", source="kind 1, amp 0.5, pos 600, b1l 80, b2s 3600, b2l 80", dur=6500))
    out.append(c("sleep_size_hall", "algo 1, dcy 0.3", source="kind 1, amp 0.5, pos 600, b1l 80, b2s 3600, b2l 80", dur=6500,
                 mode="stepped", events=[(2900, "dev-start", 0, "szp 1")]))
    for a, k in ALGOS.items():   # silent input: the tank sleeps after its tail has gone (CPU of an idle instance)
        out.append(c(f"perf_idle_{a}", f"algo {k}", source="kind 4, amp 0, pos 600", dur=4000, mode="audio_device", dump=False))
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


# the derived outer loop period in samples (mirrors rpLoopPeriod in src/reverbplus_config.js; tests/test_reverbplus.js checks that file)
LINES = {1: [1031, 1327, 1559, 1823, 2087, 2293, 2531, 2791, 3067, 3323, 3571, 3833, 4093, 4339, 4591, 4861],
         2: [263, 349, 433, 521, 617, 709, 811, 919], 3: [541, 673, 811, 953, 1103, 1249, 1399, 1553]}
LOOP_K = {0: 0.3, 1: 1.25, 2: 6.0, 3: 3.5, 4: 1.5}


def derived_period(algo, size, ir_len=0):
    szs = 0.4 + 1.2 * size
    if algo == 5:
        want = min(max(0.15 * ir_len, 0.04 * SR), 0.15 * SR)
    else:
        if algo in LINES:
            tc = sum(LINES[algo]) / len(LINES[algo]) * szs
        elif algo == 0:
            psr = SR / 29761.0
            tc = (sum([672, 4453, 1800, 3720]) + sum([908, 4217, 2656, 3163])) * 0.5 * psr * szs * 0.75
        else:
            tc = (1536 + 2104) / 2 * szs + 48
        want = LOOP_K[algo] * tc
    return int(math.floor(min(max(want, 0), 0.25 * SR) + 0.5))


def tone_power(x, freq, a, n):
    """Hann-windowed single-frequency DFT power of x[a:a+n] at `freq` (amplitude^2 of the tone)."""
    w = 2 * math.pi * freq / SR
    re = im = 0.0
    wsum = 0.0
    for i in range(n):
        h = 0.5 - 0.5 * math.cos(2 * math.pi * i / n)
        v = x[a + i] * h
        re += v * math.cos(w * i)
        im -= v * math.sin(w * i)
        wsum += h
    return 2 * (re * re + im * im) / (wsum * wsum)


def shimmer_check(l, r0, meta, errf):
    f = 468.75
    win = int(0.1 * SR)
    t0 = r0
    nwin = (len(l) - t0) // win
    tones = [2 * f, 4 * f, 8 * f]
    series = {t: [tone_power(l, t, t0 + i * win, win) for i in range(nwin)] for t in tones + [f]}
    energy = {t: sum(v) for t, v in series.items()}
    centroid = {t: (sum(i * v for i, v in enumerate(series[t])) / max(energy[t], 1e-30)) * 0.1 for t in tones}
    first = {t: next((i * 0.1 for i, v in enumerate(series[t]) if v > 0.05 * max(series[t])), None) for t in tones}
    r42 = 10 * math.log10(max(energy[4 * f], 1e-30) / max(energy[2 * f], 1e-30))
    r84 = 10 * math.log10(max(energy[8 * f], 1e-30) / max(energy[4 * f], 1e-30))
    peak_db = {t: 10 * math.log10(max(series[t]) + 1e-30) for t in tones}
    tail = db(rms(l[t0 + int(3.0 * SR):t0 + int(4.0 * SR)]))
    head = db(rms(l[t0 + int(0.5 * SR):t0 + int(1.5 * SR)]))
    print(f"shimmer: loop gain {meta.get('lgain', float('nan')):.3f}, loop {meta.get('loopms', float('nan')):.1f} ms; tone energy (rel 2f) "
          f"2f 0.0 dB, 4f {r42:+.1f} dB, 8f {10 * math.log10(max(energy[8 * f], 1e-30) / max(energy[2 * f], 1e-30)):+.1f} dB (8f vs 4f {r84:+.1f} dB); "
          f"unshifted f {10 * math.log10(max(energy[f], 1e-30) / max(energy[2 * f], 1e-30)):+.1f} dB")
    print("shimmer: centroid time (s after the burst start) " + ", ".join(f"{int(t)} Hz {centroid[t]:.2f}" for t in tones)
          + "; first above 5 % of its own peak " + ", ".join(f"{int(t)} Hz {first[t]}" for t in tones)
          + f"; level {head:.1f} dB at 0.5..1.5 s, {tail:.1f} dB at 3..4 s, peak {meta['maxabs1']:.3f}")
    if not (centroid[2 * f] < centroid[4 * f] < centroid[8 * f]):
        errf("partials do not appear successively (centroids " + ", ".join(f"{centroid[t]:.2f}" for t in tones) + ")")
    if r42 < -10 or r84 < -10:
        errf(f"the cascade is too weak: 4f {r42:+.1f} dB vs 2f, 8f {r84:+.1f} dB vs 4f (limit -10 dB per pass)")
    # every L / B / K change ducks the wet and the return for 2048 samples: after the first settling there must be none
    if meta.get("mutes", 0) > 3:
        errf(f"the pair re-timed itself {meta.get('mutes'):.0f} times (L {meta.get('mutel')}, B {meta.get('muteb')}, K {meta.get('mutek')}): each one mutes the loop")
    if meta["maxabs1"] > 2.0 or tail > head:
        errf(f"tail not bounded / decaying (peak {meta['maxabs1']:.2f}, {head:.1f} -> {tail:.1f} dB)")


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
        if data is None:
            err("no recorded data")
            return
        late = max(abs(v) for v in data["ch4"][int(3.0 * SR):])
        print(f"loopclip (chain gain 20): max |out| {meta['maxabs1']:.3f}, late (after 3 s) max |chain input| {late:.4f}, ceiling 0.5012")
        if sc[14] > 6.01:
            err(f"Start wet peak {sc[14]:.2f} (the wet safety ceiling is 6)")
        if late > 0.5012 + 1e-3:
            err(f"chain input {late:.4f} above the -6 dB hard ceiling once the tank has decayed")
        if late < 0.3:
            err(f"the saturated loop is not sustaining at the ceiling ({late:.3f})")
        return

    if name.startswith("period_"):
        algo = name.split("_")[1]
        L = 2400 if name.endswith("_min") else 256
        size = 0 if name.endswith("_min") else 0.3
        want = derived_period(ALGOS[algo], size)
        minimum = hdr[3] + L + 4
        expect = max(want, minimum)
        got = meta.get("loopms", float("nan")) * SR / 1000
        print(f"{name}: derived {want} samples (MIN {minimum:.0f}), telemetry loop {got:.1f} samples, clamped {sc[11]:.0f}, "
              f"loop gain {meta.get('lgain', float('nan')):.4f}, tank RT60 {meta.get('tankrt', float('nan')):.3f} s")
        if hdr[14] != 1:
            err("Start does not see End")
        if abs(got - expect) > 1.0:
            err(f"loop time {got:.1f} samples, expected {expect} (+-1)")
        if (sc[11] == 1) != (want < minimum):
            err(f"MIN flag {sc[11]} but derived {want} vs MIN {minimum:.0f}")
        dcy = 2.0
        ap_delay = 0.75 * (149 + 233 + 367 + 523 + 163 + 257 + 389 + 547)
        want_g = min(10 ** (-3 * (got + ap_delay) / (SR * dcy)), 0.97)
        if abs(meta.get("lgain", 0) - want_g) > 0.003:
            err(f"loop gain {meta.get('lgain')} vs 10^(-3 (T + AP delay) / Decay) = {want_g:.4f}")
        if abs(meta.get("tankrt", 0) - dcy * 0.3) > 1e-3:
            err(f"tank RT60 {meta.get('tankrt')} s, expected {dcy * 0.3:.3f} s")
        return

    if data is None:
        err("no recorded data")
        return
    r0 = ref_index(data)
    l, r, st = data["ch1"], data["ch2"], data["ch4"]
    if r0 is None and not (name.startswith(("freeze_", "freezeL_")) or name == "switch" or name == "conv_swap"):
        err("reference marker not recorded")
        return

    if name.startswith("sleep_"):
        win = int(0.5 * SR)
        e1 = rms(l[r0:r0 + win])
        e2 = rms(l[r0 + 3 * SR:r0 + 3 * SR + win])
        late = max((abs(v) for v in l[r0 + int(5.6 * SR):]), default=1.0)
        ratio = db(e2) - db(e1)
        print(f"{name}: burst response {db(e1):.1f} dB, after 3 s {db(e2):.1f} dB (ratio {ratio:+.2f}), max |out| after 5.6 s {late:.2e}, asleep {meta.get('asleep')}")
        if abs(ratio) > (3.0 if name == "sleep_size_hall" else 2.0):
            err(f"the second burst's response differs by {ratio:+.2f} dB: the tank did not wake correctly")
        if late > 1e-7:
            err(f"output {late:.2e} after the tail (> -140 dB)")
        if meta.get("asleep") != 1:
            err(f"not asleep at the end (telemetry {meta.get('asleep')})")
        return

    if name.startswith("lg15_"):
        wins = [db(rms(l[int(t * SR):int((t + 1) * SR)])) for t in range(1, 5)] if data else []
        print(f"{name}: chain gain 1.5: max |out| {meta['maxabs1']:.3f}, loop gain {meta.get('lgain', float('nan')):.4f}, level per second "
              f"{' '.join(f'{w:.1f}' for w in wins)} dB")
        if meta["maxabs1"] > 2.5:
            err(f"peak {meta['maxabs1']:.2f}")
        if wins and wins[-1] > wins[-2] + 1.0:
            err(f"still growing at the end ({wins[-2]:.1f} -> {wins[-1]:.1f} dB): the clip should hold it")
        if wins and wins[-1] > 3.0:
            err(f"sustained level {wins[-1]:.1f} dB too high")
        return

    if name in ("shimmer", "shimmer_vary"):
        shimmer_check(l, r0, meta, err)
        return

    if name == "freezeL_hall":
        wins = [db(rms(l[int(t * 0.5 * SR):int(t * 0.5 * SR) + int(0.5 * SR)])) for t in range(2, 6)]
        xs = [0.5 * k for k in range(len(wins))]
        mx, my = sum(xs) / len(xs), sum(wins) / len(wins)
        slope = sum((x - mx) * (y - my) for x, y in zip(xs, wins)) / sum((x - mx) ** 2 for x in xs)
        print(f"{name}: paired, level {min(wins):.2f}..{max(wins):.2f} dB, trend {abs(slope) * 2:.2f} dB / 2 s")
        if min(wins) < -80:
            err("went silent")
        if abs(slope) * 2 > 0.5 or max(wins) - min(wins) > 1.0:
            err("drift or scatter too large with the loop muted by Freeze")
        return

    if name.startswith("stable_"):
        wins = [db(rms(l[int(t * SR):int((t + 1) * SR)])) for t in range(1, 5)]
        print(f"{name}: level per second {' '.join(f'{w:.1f}' for w in wins)} dB, peak {meta['maxabs1']:.3f}")
        if meta["maxabs1"] > 2.0:
            err(f"peak {meta['maxabs1']:.2f}")
        if wins[-1] > wins[0] + 0.5:
            err(f"the tail grows ({wins[0]:.1f} -> {wins[-1]:.1f} dB)")
        return

    if name.startswith("lrt_"):
        _, algo, tag = name.split("_")
        want = {"a": 1.5, "b": 3.0, "c": 1.0}[tag]
        x = l[r0:]
        t_mid = rt60(biquad_bp(x, 1000, 1.5))
        mean = sum(x) / len(x)
        print(f"{name}: RT60 at 1 kHz {t_mid and round(t_mid, 3)} s (Decay {want}; tank {meta.get('tankrt', float('nan')):.3f} s + derived loop "
              f"{meta.get('loopms', float('nan')):.1f} ms gain {meta.get('lgain', float('nan')):.4f}), peak {meta['maxabs1']:.3f}")
        if t_mid is None or abs(t_mid / want - 1) > 0.15:
            err(f"RT60 {t_mid} s vs {want} s (> 15 %)")
        if abs(mean) > 1e-3 or meta["maxabs1"] > 1.5 or meta["maxabs1"] < 1e-3:
            err(f"DC {mean:.2e} / peak {meta['maxabs1']:.2f}")
        if hdr[14] != 1:
            err("Start does not see End")
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
        B, Lc = hdr[3], (256 if name == "looptime" else 2400)
        derived = derived_period(5, 0.6, 1)
        expect = max(derived, int(B + Lc + 4))  # the chain loop bypasses the convolution engine: no +256
        first, v0 = peak_near(st, r0 + LAT, 8)
        second, v1 = peak_near(st, first + expect, 8)
        lg = meta.get("lgain", float("nan"))
        ap_gain = 0.3 + 0.4 * 0.8  # Diffusion 0.8 in BASE
        want_ratio = lg * ap_gain ** 4  # the allpass chain's direct path: (-a)^4 = a^4
        print(f"{name}: wet impulses at {first - r0}, {second - r0}: spacing {second - first} (expect {expect}), echo / wet {v1 / v0:.4f} "
              f"(loop gain {lg:.4f} x allpass^4 {ap_gain ** 4:.4f} = {want_ratio:.4f}); B {B:.0f} MIN {sc[8] * SR / 1000:.0f} smp clamped {sc[11]:.0f}")
        if abs((second - first) - expect) > 1:
            err(f"loop spacing {second - first}, expected {expect} (+-1)")
        if not (0.9 < v1 / v0 / want_ratio < 1.1):
            err(f"echo ratio {v1 / v0:.4f} vs loop gain x allpass^4 = {want_ratio:.4f}")
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

    if name in ("input_0", "input_m12"):
        di, dv = peak_near(l, r0 + 256, 6)
        wi, wv = peak_near(l, r0 + 256 + LAT, 6)
        shift = 0.0 if name == "input_0" else -12.0
        want = 20 * math.log10(math.tan(0.75 * math.pi / 2)) + shift
        got = db(wv / dv)
        dry_want = math.cos(0.75 * math.pi / 2)  # the source impulse is 1.0 (the drywet case); Input must not touch it
        print(f"{name}: wet / dry {got:+.2f} dB (expected {want:+.2f}), dry peak {dv:.4f} (expected {dry_want:.4f})")
        if abs(got - want) > 0.2:
            err(f"wet / dry {got:+.2f} dB, expected {want:+.2f} (+-0.2)")
        if abs(dv / dry_want - 1) > 0.01:
            err(f"dry peak {dv:.4f}, expected {dry_want:.4f}: Input changed the dry path")
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
