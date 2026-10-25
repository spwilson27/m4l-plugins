#!/usr/bin/env python3
"""Render Cepstra through Ableton-bundled Max (shared scripts/max_harness.py) and verify its DSP & telemetry.

Run it inside the tart VM only (AGENTS.md section 1a), never on the host. Every case holds the harness's
machine-wide Max lock (AGENTS.md section 1b). Cases render on the NonRealTime driver at 48 kHz, except `perf`, which
uses `audio_device` (real CoreAudio) because CPU load cannot be measured offline. qswitch uses `stepped` so the
mid-run `quality 2` lands on time.

Stimulus: 120 Hz impulse train through three formant resonators (700 / 1220 / 2600 Hz), optionally with noise.

Cases:
  neutral        — defaults (shift 0, gate 0, mix 100%): null test vs input delayed by N + N/8
  neutral_q0     — same at Quality 1k
  neutral_q2     — same at Quality 4k
  mix0           — wet 0 equals the delayed dry signal
  shift12        — Mid +12 st moves the spectral centroid upward while f0 stays at 120 Hz
  neutral_ceps   — Gate Mode = Ceps at Gate 0 is also a null
  ceps_off/gate_ceps — Ceps (voicing) gate 20% on vowel bursts + constant noise: noise-only stretches drop >= 40 dB, vowel stretches stay within 1.5 dB
  gate_off/gate  — Spec gate 60% removes noise between partials (>= 6 dB) while the partials keep their level (f0 within 1.5 dB)
  auto           — Auto cutoff: scope reports a voiced f0 near 120 Hz and L = k * period
  midi           — MIDI cutoff: midinote 47 (B2) sets L = k * (sr / 123.47 Hz)
  qswitch        — Quality 2k -> 4k mid-run: no NaN/inf, output recovers
  silence        — silent input sleeps: output is exactly silent, scope level 0
  perf           — Quality 4k with shifted formants: audio CPU (adstatus cpu, real-time driver) stays below 70%
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "cepstra_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "cepstra_probe.js")
SCOPE = "---cepscope"
SR = 48000

DEFAULTS = "res 0.57, midshift 0, sideshift 0, gate 0, resmode 0, quality 1, wet 1, midinote -1, gatemode 0"
LTOT = {0: 1152, 1: 2304, 2: 4608}


def build_device(gen_code, case):
    """Device boxes/lines: stimulus (one 2 s pass of buffer~ cepstra_src, poked by the probe at load; the longest
    run is settle + dur = 1.5 s, so the loop seam, whose click would land in the analysis window and differ between
    the input and the delayed output, is never reached) -> gen L+R.
    rec ch1 = gen out L, ch2 = raw input (after the case gain)."""
    boxes = [
        mh.msg("dev-params", case["params"], 200, 40, 680),
        mh.msg("dev-setbuf", f"setbuffer {SCOPE}", 200, 70, 190),
        mh.msg("dev-bind", f"scope {SCOPE}", 200, 100, 180),
        mh.box("dev-scope", f"buffer~ {SCOPE} @samps 272", 520, 100, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-src", f"buffer~ cepstra_src @samps {SR * 2}", 520, 130, 150, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_code, 200, 200),
        mh.box("dev-phasor", "phasor~ 0.5", 700, 200, 65, numinlets=2, outlettype=["signal"]),
        mh.box("dev-groove", "wave~ cepstra_src", 700, 240, 90, numinlets=3, numoutlets=2, outlettype=["signal", "signal"]),
        mh.box("dev-gain", f"*~ {case.get('gain', 1.0)}", 700, 280, 65, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-phasor", 0, "dev-groove", 0),
        mh.line("dev-groove", 0, "dev-gain", 0),
        mh.line("dev-gain", 0, "dev-gen", 0),
        mh.line("dev-gain", 0, "dev-gen", 1),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gain", 0, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gain", 0, "obj-mute-r", 0),
    ]
    if case.get("mode") == "audio_device":
        # Real-time CPU poll, forwarded to the probe as `cpu <percent>`.
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
    def p(extra=""):
        return DEFAULTS + (", " + extra if extra else "")

    base = {"arm": 700, "dur": 600}
    return (
        dict(base, name="neutral", params=p()),
        dict(base, name="neutral_q0", q=0, params=p("quality 0")),
        dict(base, name="neutral_q2", q=2, params=p("quality 2"), arm=900),
        dict(base, name="neutral_res_lo", params=p("res 0")),
        dict(base, name="neutral_res_hi", params=p("res 1")),
        dict(base, name="neutral_auto", params=p("resmode 1")),
        dict(base, name="mix0", params=p("wet 0")),
        dict(base, name="shift12", params=p("midshift 12")),
        dict(base, name="gate_off", stim="vowelnoise", params=p()),
        dict(base, name="gate", stim="vowelnoise", params=p("gate 0.6")),
        dict(base, name="neutral_ceps", params=p("gatemode 1")),
        dict(base, name="ceps_off", stim="vowelgaps", params=p("gatemode 1")),
        dict(base, name="gate_ceps", stim="vowelgaps", params=p("gatemode 1, gate 0.2")),
        dict(base, name="auto", params=p("resmode 1")),
        dict(base, name="midi", params=p("resmode 2, midinote 47")),
        # Quality 2k -> 4k at 300 ms into the run; recording starts at 900 ms. `stepped` so the event lands on time.
        dict(base, name="qswitch", q=2, params=p(), arm=900, mode="stepped",
             events=[(300, "dev-gen", 0, "quality 2")]),
        dict(base, name="silence", stim="silent", params=p()),
        # CPU load can only be measured on the real-time driver: NonRealTime renders ~150x faster than real time and
        # has no audio-thread load. This case holds the machine-wide audio-device lock.
        dict(base, name="perf", q=2, params=p("quality 2, midshift 7, sideshift -5, gate 0.2"), arm=900,
             mode="audio_device"),
    )


def sane(meta, case):
    """The stimulus must have been recorded at the nominal pitch and the forced 48 kHz rate."""
    if meta.get("sr", 0) != float(SR) or meta.get("probeError"):
        return False
    if case.get("stim") == "silent":
        return True
    if case.get("stim") == "vowelgaps":
        # f0 of the final window may fall in a noise-only stretch; require both window classes to have been found
        return meta.get("refRms", 0) > 0.01 and abs(meta.get("gapDb", 999)) < 200 and abs(meta.get("voxDb", 999)) < 200
    return abs(meta.get("f0In", 0) - 120.0) < 4.0 and meta.get("refRms", 0) > 0.01


def run_case(gen_code, case):
    boxes, lines = build_device(gen_code, case)
    meta = mh.run_case(
        f"cepstra_{case['name']}", boxes, lines, probe_js=PROBE_JS,
        probe_args=f"{case.get('stim', 'vowel')} {LTOT[case.get('q', 1)]}",
        settle_ms=case["arm"], dur_ms=case["dur"], channels=2, sr=SR,
        mode=case.get("mode", "nrt"), events=case.get("events"))
    print(f"--- {case['name']} ({meta['harness_mode']}, {meta['harness_wall_s']:.1f} s) ---")
    if meta.get("probeError"):
        print("PROBE ERROR (see probe .err file in the kept work dir)")
        return None
    print(
        f"peak {meta.get('peak'):.4f} nullDb {meta.get('nullDb'):.1f} cent {meta.get('centIn'):.0f}->{meta.get('centOut'):.0f} "
        f"f0 {meta.get('f0In'):.1f}->{meta.get('f0Out'):.1f} valley {meta.get('valleyIn'):.1f}->{meta.get('valleyOut'):.1f} "
        f"scope[nz {meta.get('scopeNonZero'):.0f} L {meta.get('scopeL'):.1f} f0 {meta.get('scopeF0'):.1f} "
        f"lvl {meta.get('scopeLevel'):.3f} frame {meta.get('scopeFrame'):.0f} N {meta.get('scopeN'):.0f}] "
        f"cpu avg {meta.get('cpuAvg'):.1f} max {meta.get('cpuMax'):.1f} nan {meta.get('nan'):.0f}"
    )
    return meta


def main():
    with open(GEN_PATH, encoding="utf-8") as f:
        gen_code = f.read()
    only = set(sys.argv[1:])
    results = {}
    errors = []
    for case in cases():
        if only and case["name"] not in only:
            continue
        # A loaded machine (several agents launching Max) occasionally yields no result or a stimulus that was not
        # recorded; retry the case. Assertions below are never loosened.
        meta = None
        for attempt in range(3):
            try:
                meta = run_case(gen_code, case)
            except RuntimeError as exc:
                print(f"  ({exc}; retry {attempt + 1})")
                meta = None
                continue
            if meta is not None and sane(meta, case):
                break
            print(f"  (measurement not sane: sr {meta and meta.get('sr')}; retry {attempt + 1})")
            meta = None
        results[case["name"]] = meta
        name = case["name"]
        if meta is None:
            errors.append(f"{name}: no measurement")
            continue
        if meta.get("nan", 1) != 0:
            errors.append(f"{name}: {meta.get('nan')} non-finite samples")
        if name in ("neutral", "neutral_q0", "neutral_q2", "neutral_ceps", "neutral_res_lo", "neutral_res_hi", "neutral_auto"):
            if meta["nullDb"] > -60:
                errors.append(f"{name}: null test residual {meta['nullDb']:.1f} dB (need < -60 dB)")
            if meta["refRms"] < 0.01:
                errors.append(f"{name}: input reference too quiet ({meta['refRms']})")
        elif name == "mix0":
            if meta["nullDb"] > -90:
                errors.append(f"mix0: wet=0 differs from delayed dry ({meta['nullDb']:.1f} dB)")
        elif name in ("auto", "midi"):
            sr = meta["sr"]
            if name == "auto":
                if meta["scopeVoiced"] < 0.5 or abs(meta["scopeF0"] - 120.0) > 4.0:
                    errors.append(f"auto: expected voiced f0 near 120 Hz, got f0 {meta['scopeF0']} voiced {meta['scopeVoiced']}")
                period = sr / 120.0
            else:
                period = sr / (440.0 * 2 ** ((47 - 69) / 12.0))
            k = 0.3 + 0.7 * 0.57
            if abs(meta["scopeL"] - k * period) > 0.08 * k * period:
                errors.append(f"{name}: L {meta['scopeL']:.1f} not near k*period {k * period:.1f}")
        elif name == "qswitch":
            if meta["tailPeak"] < 0.05:
                errors.append(f"qswitch: output did not recover after the Quality change (tail peak {meta['tailPeak']})")
        elif name == "silence":
            if meta["peak"] > 1e-6:
                errors.append(f"silence: expected silent output, peak {meta['peak']}")
            if meta["scopeLevel"] > 1e-6:
                errors.append(f"silence: scope level should read 0, got {meta['scopeLevel']}")
        elif name == "perf":
            print(f"perf: 4k pipeline Max audio CPU avg {meta['cpuAvg']:.1f}% / max {meta['cpuMax']:.1f}% ({meta['cpuMax'] > 0 and 'real-time driver' or 'no CPU samples'})")
            if meta["cpuMax"] <= 0:
                errors.append("perf: no CPU samples received from adstatus cpu")
            if meta["cpuMax"] > 70:
                errors.append(f"perf: audio CPU peaked at {meta['cpuMax']:.1f}%")

        if name not in ("silence", "mix0") and meta.get("scopeFrame", 0) < 1:
            errors.append(f"{name}: scope frame counter never advanced")
        if name in ("neutral", "neutral_q2", "auto"):
            pk_ms, pk_v = meta.get("scopeCepPeakMs", 0), meta.get("scopeCepPeakV", 0)
            # At 4k the second rahmonic (2/f0 = 16.67 ms) can out-rank the first, so accept either multiple there.
            allowed = [1000.0 / 120.0] + ([2000.0 / 120.0] if name == "neutral_q2" else [])
            if min(abs(pk_ms - a) for a in allowed) > 0.35 or pk_v <= 0:
                errors.append(f"{name}: largest c[n] over 2-20 ms at {pk_ms:.2f} ms (c {pk_v:.3f}); expected the 1/f0 column (8.33 ms)" + (" or its 2nd rahmonic" if name == "neutral_q2" else "") + " with positive sign")
            else:
                print(f"  cepstrum telemetry: largest c[n] over 2-20 ms = {pk_v:+.3f} at {pk_ms:.2f} ms (1/f0 = 8.33 ms)")
        if name not in ("silence", "mix0") and meta.get("scopeNonZero", 0) < 100:
            errors.append(f"{name}: scope cepstrum buffer was not updated ({meta.get('scopeNonZero')} non-zero)")

    neutral = results.get("neutral")
    sh = results.get("shift12")
    if neutral and sh:
        print(f"Mid +12 st: centroid {neutral['centOut']:.0f} -> {sh['centOut']:.0f} Hz, f0 {neutral['f0Out']:.1f} -> {sh['f0Out']:.1f} Hz")
        if sh["centOut"] < neutral["centOut"] * 1.2:
            errors.append(f"shift12: centroid did not move up ({neutral['centOut']:.0f} -> {sh['centOut']:.0f})")
        if abs(sh["f0Out"] - neutral["f0Out"]) > 3.0 or abs(sh["f0Out"] - 120.0) > 4.0:
            errors.append(f"shift12: f0 changed ({neutral['f0Out']:.1f} -> {sh['f0Out']:.1f})")
    g0, g1 = results.get("gate_off"), results.get("gate")
    if g0 and g1:
        # Spec gate is relative to the local partial peak, so partials must keep their level while the noise floor drops.
        # (The old 40% / 6 dB target only passed on the looped stimulus because the gate removed its seam click.)
        sf0 = g1["f0Level"] - g0["f0Level"]
        print(f"Spec gate 60%: between-partials vs partials {g0['valleyOut']:.1f} dB -> {g1['valleyOut']:.1f} dB, f0 component {sf0:+.1f} dB")
        if g1["valleyOut"] > g0["valleyOut"] - 6.0:
            errors.append(f"gate: noise between partials not reduced by 6 dB ({g0['valleyOut']:.1f} -> {g1['valleyOut']:.1f})")
        if abs(sf0) > 1.5:
            errors.append(f"gate: f0 component changed by {sf0:+.1f} dB (limit 1.5 dB)")

    c0, gc = results.get("ceps_off"), results.get("gate_ceps")
    if c0 and gc:
        gapDrop = c0["gapDb"] - gc["gapDb"]
        voxD = gc["voxDb"] - c0["voxDb"]
        print(f"Ceps (voicing) gate 20%: noise-only stretches {gapDrop:+.1f} dB down, vowel stretches {voxD:+.1f} dB")
        if gapDrop < 40.0:
            errors.append(f"gate_ceps: unpitched stretches only dropped {gapDrop:.1f} dB (need >= 40 dB)")
        if abs(voxD) > 1.5:
            errors.append(f"gate_ceps: pitched stretches changed by {voxD:+.1f} dB (limit 1.5 dB)")
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("cepstra audio checks passed")


if __name__ == "__main__":
    main()
