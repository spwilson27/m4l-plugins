#!/usr/bin/env python3
"""Render Lifter's gen core through the Ableton-bundled Max and check the audio.

The gen code is src/cepstrum_lib.genexpr + src/lifter_core.genexpr, via build_lifter.gen_source() (what the three
devices embed). The curve table comes from src/lifter_ui.js via tests/lifter_curve_cli.js.
Runs on the shared NonRealTime harness (scripts/max_harness.py): cases run in parallel, no lock.

Cases (3-channel recording: out L, dry in, out R):
  unity_N   — flat curve at Size N: unity gain, exact constant lag of 4096 samples, no clicks
  unitysm   — the same with Smooth 60 % (flat stays identity at any Smooth)
  dry_N     — Mix 0 returns the dry input at the same 4096 sample lag
  whisper_N — the whisper curve on a 200 Hz sawtooth lowers the harmonic peak-to-valley ratio;
              telemetry updates, pitch reads about 200 Hz, spectra and cepstrum are filled
  track     — a 110 Hz saw with the robot curve boosts harmonicity more with Track on than off
  switch_*  — changing Size while running stays finite, continuous and settles at unity
  silent    — silence in gives exact zeros out, telemetry reports silent

Usage: run_lifter_audio_tests.py [case-prefix ...]   (e.g. unity cpu)
"""

import concurrent.futures
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh  # noqa: E402
from build_lifter import gen_source  # noqa: E402  (lib minus the functions that break the compile)

ROOT = mh.ROOT
CURVE_CLI = os.path.join(ROOT, "tests", "lifter_curve_cli.js")
PROBE_JS = os.path.join(ROOT, "tests", "lifter_probe.js")
SIZES = (512, 1024, 2048, 4096)
SR = 48000
BASE = "depthp 100, smoothp 0, wetp 100, outdb 0, trackp 0"
SIG = ["signal"]


def source_boxes(src, f0):
    """Test signal chain ending in dev-src (signal)."""
    b, ln = mh.box, mh.line
    if src in ("noise_sine", "silent"):
        boxes = [
            b("dev-noise", "noise~", 700, 40, 60, outlettype=SIG),
            b("dev-ng", "*~ 0.2", 700, 70, 50, numinlets=2, outlettype=SIG),
            b("dev-sine", "cycle~ 440", 780, 40, 80, numinlets=2, outlettype=SIG),
            b("dev-sg", "*~ 0.3", 780, 70, 50, numinlets=2, outlettype=SIG),
            b("dev-sum", "+~", 700, 100, 40, numinlets=2, outlettype=SIG),
            b("dev-src", "*~ 0" if src == "silent" else "*~ 1", 700, 130, 50, numinlets=2, outlettype=SIG),
        ]
        lines = [ln("dev-noise", 0, "dev-ng", 0), ln("dev-sine", 0, "dev-sg", 0), ln("dev-ng", 0, "dev-sum", 0),
                 ln("dev-sg", 0, "dev-sum", 1), ln("dev-sum", 0, "dev-src", 0)]
    elif src == "saw":
        boxes = [
            b("dev-ph", f"phasor~ {f0}", 700, 40, 80, numinlets=2, outlettype=SIG),
            b("dev-off", "-~ 0.5", 700, 70, 50, numinlets=2, outlettype=SIG),
            b("dev-ng", "*~ 0.5", 700, 100, 50, numinlets=2, outlettype=SIG),
            b("dev-nz", "noise~", 800, 40, 60, outlettype=SIG),
            b("dev-nzg", "*~ 0.003", 800, 70, 60, numinlets=2, outlettype=SIG),
            b("dev-add", "+~", 700, 115, 40, numinlets=2, outlettype=SIG),
            b("dev-src", "*~ 1", 700, 130, 50, numinlets=2, outlettype=SIG),
        ]
        # a little noise: a perfectly periodic saw has a cepstrum that is not like real audio
        lines = [ln("dev-ph", 0, "dev-off", 0), ln("dev-off", 0, "dev-ng", 0), ln("dev-ng", 0, "dev-add", 0),
                 ln("dev-nz", 0, "dev-nzg", 0), ln("dev-nzg", 0, "dev-add", 1), ln("dev-add", 0, "dev-src", 0)]
    else:  # sines3: smooth, for click detection
        boxes = [
            b("dev-s1", "cycle~ 200", 700, 40, 80, numinlets=2, outlettype=SIG),
            b("dev-s2", "cycle~ 400", 790, 40, 80, numinlets=2, outlettype=SIG),
            b("dev-s3", "cycle~ 600", 880, 40, 80, numinlets=2, outlettype=SIG),
            b("dev-g1", "*~ 0.12", 700, 70, 50, numinlets=2, outlettype=SIG),
            b("dev-g2", "*~ 0.08", 790, 70, 50, numinlets=2, outlettype=SIG),
            b("dev-g3", "*~ 0.06", 880, 70, 50, numinlets=2, outlettype=SIG),
            b("dev-sum", "+~", 700, 100, 40, numinlets=2, outlettype=SIG),
            b("dev-sum2", "+~", 700, 115, 40, numinlets=2, outlettype=SIG),
            b("dev-src", "*~ 1", 700, 130, 50, numinlets=2, outlettype=SIG),
        ]
        lines = [ln("dev-s1", 0, "dev-g1", 0), ln("dev-s2", 0, "dev-g2", 0), ln("dev-s3", 0, "dev-g3", 0),
                 ln("dev-g1", 0, "dev-sum", 0), ln("dev-g2", 0, "dev-sum", 1), ln("dev-sum", 0, "dev-sum2", 0),
                 ln("dev-g3", 0, "dev-sum2", 1), ln("dev-sum2", 0, "dev-src", 0)]
    return boxes, lines


def curve_table(name):
    return subprocess.check_output(["node", CURVE_CLI, name], text=True).strip()


def device(code, case):
    """Boxes and lines wired into the harness scaffold (obj-load, obj-record, obj-mute-*)."""
    b, m, ln = mh.box, mh.msg, mh.line
    boxes = [
        mh.gen_box("dev-gen", code, 200, 200),
        m("dev-params", case["params"], 200, 40, 560),
        m("dev-bind-curve", "lcurve #0-liftercurve", 200, 70, 170),
        m("dev-bind-scope", "lscope #0-lifterscope", 380, 70, 170),
        m("dev-setbuf", "setbuffer #0-lifterscope #0-liftercurve", 560, 70, 250),
        m("dev-curve", "curve " + curve_table(case["curve"]), 200, 100, 400),
        b("dev-curvebuf", "buffer~ #0-liftercurve @samps 256", 520, 140, 220, numoutlets=2, outlettype=["float", "bang"]),
        b("dev-scopebuf", "buffer~ #0-lifterscope @samps 512", 520, 170, 220, numoutlets=2, outlettype=["float", "bang"]),
    ]
    lines = [ln("obj-load", 0, t, 0) for t in ("dev-params", "dev-bind-curve", "dev-bind-scope", "dev-setbuf", "dev-curve")]
    lines += [
        ln("dev-params", 0, "dev-gen", 0), ln("dev-bind-curve", 0, "dev-gen", 0), ln("dev-bind-scope", 0, "dev-gen", 0),
        ln("dev-setbuf", 0, "obj-js", 0), ln("dev-curve", 0, "obj-js", 0),
        ln("dev-gen", 0, "obj-record", 0), ln("dev-src", 0, "obj-record", 1), ln("dev-gen", 1, "obj-record", 2),
        ln("dev-src", 0, "dev-gen", 0), ln("dev-src", 0, "dev-gen", 1),
        ln("dev-gen", 0, "obj-mute-l", 0), ln("dev-gen", 1, "obj-mute-r", 0),
    ]
    sb, sl = source_boxes(case["src"], case.get("f0", 200))
    return boxes + sb, lines + sl


def audio_cases():
    out = []
    for i, n in enumerate(SIZES):
        out.append({"name": f"unity_{n}", "kind": "unity", "n": n, "src": "noise_sine", "curve": "flat",
                    "maxlag": 4200, "params": f"sizei {i}, {BASE}"})
    out.append({"name": "unitysm_1024", "kind": "unity", "n": 1024, "src": "noise_sine", "curve": "flat",
                "maxlag": 4200, "params": f"sizei 1, {BASE}, smoothp 60"})
    out.append({"name": "dry_1024", "kind": "unity", "n": 1024, "src": "noise_sine", "curve": "whisper",
                "maxlag": 4200, "params": f"sizei 1, {BASE}, wetp 0"})
    for i, n in ((1, 1024), (2, 2048), (3, 4096)):
        out.append({"name": f"whisper_{n}", "kind": "whisper", "n": n, "src": "saw", "f0": 200, "curve": "whisper",
                    "maxlag": 0, "params": f"sizei {i}, {BASE}"})
    out.append({"name": "track_off", "kind": "track_off", "n": 2048, "src": "saw", "f0": 110, "curve": "robot",
                "maxlag": 0, "params": f"sizei 2, {BASE}"})
    out.append({"name": "track_on", "kind": "track_on", "n": 2048, "src": "saw", "f0": 110, "curve": "robot",
                "maxlag": 0, "params": f"sizei 2, {BASE}, trackp 1"})
    for name, first, last in (("switch_down", 3, 0), ("switch_up", 0, 3)):
        out.append({"name": name, "kind": "switch", "n": SIZES[last], "src": "sines3", "curve": "whisper",
                    "maxlag": 4200, "params": f"sizei {first}, {BASE}", "switch": (450, last), "dur_ms": 800})
    out.append({"name": "silent_1024", "kind": "silent", "n": 1024, "src": "silent", "curve": "whisper",
                "maxlag": 0, "params": f"sizei 1, {BASE}"})
    return out


def run_audio(code, case):
    boxes, lines = device(code, case)
    kw = {}
    if case.get("switch"):
        at, idx = case["switch"]
        kw = {"events": [(at, "dev-gen", 0, f"sizei {idx}")], "mode": "stepped"}
    return mh.run_case(case["name"], boxes, lines, probe_js=PROBE_JS,
                       probe_args=f"{case['maxlag']} {case.get('f0', 0)}", settle_ms=400,
                       dur_ms=case.get("dur_ms", 600), channels=3, sr=SR, **kw)


def fmt(case, meta):
    return (
        f"--- {case['name']} ---\n"
        f"sr {meta['sr']:.0f} lag {meta['lag']:.0f} gain {meta['gaindb']:.3f} dB err {meta['errdb']:.1f} dB "
        f"maxerr {meta['maxerr']:.2e} errR {meta['errr']:.2e} peak {meta['outpeak']:.3f} dry {meta['dryrms']:.3f} "
        f"nan {meta['nan']:.0f} tiny {meta['tiny']:.0f} | p2v out {meta['p2vout']:.1f} dry {meta['p2vdry']:.1f} | "
        f"step out {meta['stepout']:.4f} dry {meta['stepdry']:.4f} | tele hop {meta['thop']:.0f} "
        f"f0 {meta['tsr'] / meta['tq'] if meta['tq'] > 1 else 0:.1f} conf {meta['tconf']:.2f} N {meta['tn']:.0f} "
        f"silent {meta['tsilent']:.0f} spec {meta['tspecn']:.0f} cep {meta['tcepmax']:.3f} dbg argmax {meta['tdbg0']:.1f} fc240 {meta['tdbg1']:.3f}"
    )


def check_audio(case, meta, errors, results):
    name = case["name"]
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    kind = case["kind"]
    results[name] = meta
    if meta["nan"] != 0:
        errors.append(f"{name}: {meta['nan']:.0f} non-finite samples")
    if meta["tiny"] != 0:
        errors.append(f"{name}: {meta['tiny']:.0f} denormal-range samples")
    if kind == "unity":
        if meta["lag"] != 4096:
            errors.append(f"{name}: lag {meta['lag']:.0f}, expected 4096")
        if abs(meta["gaindb"]) > 0.1:
            errors.append(f"{name}: gain {meta['gaindb']:.3f} dB is not unity")
        if meta["errdb"] > -60:
            errors.append(f"{name}: residual {meta['errdb']:.1f} dB above -60 dB")
        if meta["maxerr"] > 2e-3 or meta["errr"] > 2e-3:
            errors.append(f"{name}: sample error {meta['maxerr']:.2e} / {meta['errr']:.2e}")
        if meta["stepout"] > meta["stepdry"] * 1.5 + 1e-3:
            errors.append(f"{name}: click, step {meta['stepout']:.4f} vs dry {meta['stepdry']:.4f}")
    elif kind == "whisper":
        drop = meta["p2vdry"] - meta["p2vout"]
        if drop < 6.0:
            errors.append(f"{name}: harmonic peak-to-valley fell only {drop:.1f} dB (need 6)")
        if meta["thop"] < 10:
            errors.append(f"{name}: telemetry hop counter at {meta['thop']:.0f}, not advancing")
        if meta["tn"] != case["n"] or meta["tsr"] < 8000:
            errors.append(f"{name}: telemetry N {meta['tn']:.0f} / sr {meta['tsr']:.0f}")
        if meta["tq"] > 1:
            f0 = meta["tsr"] / meta["tq"]
            if abs(f0 - case["f0"]) > 6:
                errors.append(f"{name}: telemetry pitch {f0:.1f} Hz, expected {case['f0']}")
        else:
            errors.append(f"{name}: no pitch in the telemetry")
        if meta["tconf"] < 0.3:
            errors.append(f"{name}: pitch confidence {meta['tconf']:.2f}")
        if meta["tspecn"] < 20 or meta["tcepmax"] <= 0 or meta["tinpk"] < 0.1 or meta["toutpk"] < 0.01:
            errors.append(f"{name}: telemetry traces not filled (spec {meta['tspecn']:.0f}, cep {meta['tcepmax']:.3f}, "
                          f"in {meta['tinpk']:.3f}, out {meta['toutpk']:.3f})")
        if meta["tsilent"] != 0:
            errors.append(f"{name}: telemetry flagged silent")
        level = 20 * math.log10(max(meta["outrms"], 1e-12) / max(meta["dryrms"], 1e-12))
        if abs(level) > 3.0:
            errors.append(f"{name}: output level {level:+.1f} dB vs the dry input (need within 3 dB)")
    elif kind == "switch":
        if meta["stepout"] > meta["stepdry"] * 2.0 + 0.004:
            errors.append(f"{name}: click on the Size switch, step {meta['stepout']:.4f} vs dry {meta['stepdry']:.4f}")
        if meta["tn"] != case["n"]:
            errors.append(f"{name}: telemetry N {meta['tn']:.0f}, expected {case['n']}")
        if meta["outpeak"] > 0.6:
            errors.append(f"{name}: peak {meta['outpeak']:.3f}")
    elif kind == "silent":
        if meta["outpeak"] > 1e-12:
            errors.append(f"{name}: silence in, peak {meta['outpeak']} out")
        if meta["tsilent"] != 1:
            errors.append(f"{name}: telemetry did not report silence")


def main():
    code = gen_source()
    only = sys.argv[1:]
    cases = [c for c in audio_cases() if not only or any(c["name"].startswith(p) for p in only)]
    errors = []
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
        def safe(c):
            try:
                return run_audio(code, c)
            except RuntimeError as err:
                print(f"{c['name']}: {err}")
                return None
        metas = list(ex.map(safe, cases))
    for case, meta in zip(cases, metas):
        if meta is not None:
            print(fmt(case, meta))
        check_audio(case, meta, errors, results)
    if "track_on" in results and "track_off" in results:
        gain = results["track_on"]["p2vout"] - results["track_off"]["p2vout"]
        print(f"track: harmonicity on {results['track_on']['p2vout']:.1f} dB, off {results['track_off']['p2vout']:.1f} dB ({gain:+.1f})")
        if gain < 3.0:
            errors.append(f"track: Track on gained only {gain:.1f} dB of harmonicity over off (need 3)")
    lags = {n: results[f"unity_{n}"]["lag"] for n in SIZES if f"unity_{n}" in results}
    if lags:
        print("measured latency (samples):", {k: int(v) for k, v in lags.items()})
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
