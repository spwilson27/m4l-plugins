#!/usr/bin/env python3
"""Render Percipitator through Ableton-bundled Max and verify its DSP & telemetry.

Cases:
  dry            — wet=0 passes the 293.7 Hz 0.25 sine cleanly at ~0.25
  resynth_sine   — wet=1, wtpos=0 (Frame 0 = Sine), warp=0.5 resynthesizes into clean sine partials
  resynth_wt     — wet=1, wtpos=1 (Frame 3 = Square), wtmode=2 (Sync), warp=0.75 engages the
                   Square wavetable + Sync warp, producing much brighter harmonics (higher slopeRms)
  gate_silence   — input below Gate (-30 dB) produces silent precipitation output
  pitch_octave   — pitch=+12 st doubles the resynthesized frequency compared to pitch=0
  freq_shift     — fshift=+600 Hz shifts all resynthesized partials upward in frequency (higher zcr & slopeRms)
  midi_sidechain — scalemask=64 (F# only) snaps band 3 (220 Hz) onto F# (pitch class 6)
  partials_vol   — resynthgain=-18 dB reduces resynthesized output level significantly compared to 0 dB
  tilt_cut       — tilt=-1.0 (-100%, -36 dB high cut) strongly attenuates upper-band (1760 Hz) resynthesis
                   compared to tilt=+0.5 (+18 dB high boost)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "percipitator_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "percipitator_probe.js")

DEFAULTS = "stretch 1, fshift 0, snap 1, scalemask 4095, decay 80, attack 1.5, blur 0.1, tilt 0, sieve 0, freeze 0, resynthgain 0"


def build_device(gen_code, case):
    amp = case.get("amp", 0.25)
    freq = case.get("freq", 293.7)
    boxes = [
        mh.msg("dev-params", case["params"], 200, 40, 680),
        mh.msg("dev-setbuf", "setbuffer #0-percipwt #0-percipscope", 200, 70, 250),
        mh.msg("dev-bind", "wt #0-percipwt, scope #0-percipscope", 200, 100, 250),
        mh.box("dev-wt", "buffer~ #0-percipwt @samps 8192", 520, 100, 220, numoutlets=2,
               outlettype=["float", "bang"]),
        # @samps 64 covers telemetry slots 0..35. Slot 35 is the frame counter, which the gen
        # increments every 64 samples even while the input is silent (deferred-DSP confirm).
        # This harness compiles the genexpr directly; the device itself creates gen~ after load.
        mh.box("dev-scope", "buffer~ #0-percipscope @samps 64", 520, 130, 220, numoutlets=2,
               outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_code, 200, 200),
        mh.box("dev-tone", f"cycle~ {freq}", 700, 200, 85, numinlets=2, outlettype=["signal"]),
        mh.box("dev-gain", f"*~ {amp}", 700, 240, 65, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("dev-tone", 0, "dev-gain", 0),
        mh.line("dev-gain", 0, "dev-gen", 0),
        mh.line("dev-gain", 0, "dev-gen", 1),
    ]
    return boxes, lines


def cases():
    def params(extra):
        return extra + ", " + DEFAULTS

    return (
        {
            "name": "dry",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 0, pitch 0, gate -42, wtpos 0.3, wtmode 0, warp 0.3"),
        },
        {
            "name": "resynth_sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 0, gate -42, wtpos 0, wtmode 0, warp 0.5"),
        },
        {
            "name": "resynth_wt",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 0, gate -42, wtpos 1.0, wtmode 2, warp 0.75"),
        },
        {
            "name": "gate_silence",
            "amp": 0.0005,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 0, gate -30, wtpos 0.5, wtmode 0, warp 0.3"),
        },
        {
            "name": "pitch_octave",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": params("wet 1, pitch 12, gate -42, wtpos 0, wtmode 0, warp 0.5"),
        },
        {
            "name": "freq_shift",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": "wet 1, pitch 0, stretch 1, fshift 600, snap 1, scalemask 4095, gate -42, decay 80, attack 1.5, blur 0.1, tilt 0, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0.5, resynthgain 0",
        },
        {
            "name": "midi_sidechain",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": "wet 1, pitch 0, stretch 1, fshift 0, snap 1, scalemask 64, gate -42, decay 80, attack 1.5, blur 0.1, tilt 0, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0.5, resynthgain 0",
        },
        {
            "name": "partials_vol",
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": "wet 1, pitch 0, stretch 1, fshift 0, snap 1, scalemask 4095, gate -42, decay 80, attack 1.5, blur 0.1, tilt 0, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0.5, resynthgain -18",
        },
        {
            "name": "tilt_cut",
            "freq": 1760.0,
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": "wet 1, pitch 0, stretch 1, fshift 0, snap 1, scalemask 4095, gate -42, decay 80, attack 1.5, blur 0.1, tilt -1.0, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0.5, resynthgain 0",
        },
        {
            "name": "tilt_boost",
            "freq": 1760.0,
            "amp": 0.25,
            "arm": 250,
            "dur": 400,
            "params": "wet 1, pitch 0, stretch 1, fshift 0, snap 1, scalemask 4095, gate -42, decay 80, attack 1.5, blur 0.1, tilt 0.5, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0.5, resynthgain 0",
        },
        # Freeze / silence sleep. The tone is cut at 250 ms (event on `*~` right inlet), so the band envelopes decay.
        # `stepped` mode lands the events on time. GenExpr runs code after a nested `return`, so these once failed.
        {
            "name": "freeze_hold", "amp": 0.25, "arm": 800, "dur": 300, "mode": "stepped",
            "events": [(200, "dev-gen", 0, "freeze 1"), (250, "dev-gain", 1, "0")],
            "params": params("wet 1, pitch 0, gate -42, wtpos 0, wtmode 0, warp 0.5"),
        },
        {
            "name": "freeze_off", "amp": 0.25, "arm": 800, "dur": 300, "mode": "stepped",
            "events": [(250, "dev-gain", 1, "0")],
            "params": params("wet 1, pitch 0, gate -42, wtpos 0, wtmode 0, warp 0.5"),
        },
        {
            "name": "sleep_silent", "amp": 0.25, "arm": 500, "dur": 300, "mode": "stepped",
            "events": [(100, "dev-gain", 1, "0")],
            "params": params("wet 1, pitch 0, gate -42, wtpos 0, wtmode 0, warp 0.5, decay 1"),
        },
        {
            "name": "sleep_wake", "amp": 0.25, "arm": 500, "dur": 300, "mode": "stepped",
            "events": [(100, "dev-gain", 1, "0"), (300, "dev-gain", 1, "0.25")],
            "params": params("wet 1, pitch 0, gate -42, wtpos 0, wtmode 0, warp 0.5, decay 1"),
        },
    )


def run_case(gen_code, case):
    boxes, lines = build_device(gen_code, case)
    print(f"--- {case['name']} ---")
    meta = mh.run_case(
        f"percip_{case['name']}", boxes, lines, probe_js=PROBE_JS, probe_args="sine",
        settle_ms=case["arm"], dur_ms=case["dur"], channels=2, mode=case.get("mode", "nrt"),
        events=case.get("events"), timeout=300,
    )
    meta["env"] = [meta.pop(f"env_{i}") for i in range(int(meta.get("envbins", 0)))]
    print(
        f"genL {meta.get('genL'):.4f} ctl {meta.get('ctl'):.4f} peak {meta.get('peak'):.4f} "
        f"zcr {meta.get('zcr'):.0f} slopeRms {meta.get('slopeRms'):.4f} "
        f"bandMax {meta.get('scopeBandMax'):.4f} active {meta.get('scopeActive'):.0f} nan {meta.get('nan')}"
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
        meta = run_case(gen_code, case)
        results[case["name"]] = meta
        if meta is None:
            errors.append(f"{case['name']}: no measurement")
            continue
        if meta.get("nan", 1) != 0:
            errors.append(f"{case['name']}: {meta.get('nan')} non-finite samples")
        name = case["name"]
        if name == "dry":
            if not (0.21 <= meta.get("peak", 0) <= 0.29):
                errors.append(f"dry: expected ~0.25 peak, got {meta.get('peak')}")
        elif name in ("resynth_sine", "resynth_wt"):
            if not (0.08 <= meta.get("peak", 0) <= 0.98):
                errors.append(f"{name}: wet output out of range ({meta.get('peak')})")
            if not (0.04 <= meta.get("scopeBandMax", 0) <= 1.5):
                errors.append(f"{name}: scope band meters not tracking ({meta.get('scopeBandMax')})")
            if meta.get("scopeActive", 0) < 1:
                errors.append(f"{name}: expected active resynthesized bands, got {meta.get('scopeActive')}")
        elif name == "gate_silence":
            if meta.get("peak", 1) > 0.005:
                errors.append(f"gate_silence: expected muted output below Gate, got {meta.get('peak')}")
        elif name == "freeze_hold":
            if meta.get("peak", 0) < 0.08:
                errors.append(f"freeze_hold: Freeze did not hold the partials after the input stopped ({meta.get('peak')})")
        elif name == "freeze_off":
            if meta.get("peak", 1) > 0.02:
                errors.append(f"freeze_off: control without Freeze should have decayed ({meta.get('peak')})")
        elif name == "sleep_silent":
            if meta.get("peak", 1) > 0.03:  # slow low-band ring-down only, ~-24 dB under the active ~0.46
                errors.append(f"sleep_silent: output not silent after the input stopped ({meta.get('peak')})")
        elif name == "sleep_wake":
            if meta.get("peak", 0) < 0.08:
                errors.append(f"sleep_wake: bands did not wake after the silence sleep ({meta.get('peak')})")
        elif name == "pitch_octave":
            if meta.get("peak", 0) < 0.08:
                errors.append(f"pitch_octave: silent output ({meta.get('peak')})")
        elif name == "midi_sidechain":
            midi3 = meta.get("scopeMidi3", 0)
            pc3 = round(midi3) % 12
            print(f"midi_sidechain band3 quantized MIDI={midi3:.2f} (pitch_class={pc3}, expected 6=F#)")
            if pc3 != 6:
                errors.append(f"midi_sidechain: expected band 3 to quantize to F# (pitch class 6), got {midi3}")

    sine_m = results.get("resynth_sine")
    wt_m = results.get("resynth_wt")
    oct_m = results.get("pitch_octave")
    fsh_m = results.get("freq_shift")
    vol_m = results.get("partials_vol")
    tcut_m = results.get("tilt_cut")
    tbst_m = results.get("tilt_boost")
    if sine_m and wt_m:
        print(f"harmonic brightness: sine={sine_m.get('slopeRms'):.4f} -> square+sync={wt_m.get('slopeRms'):.4f}")
        if wt_m.get("slopeRms", 0) <= sine_m.get("slopeRms", 0) * 1.35:
            errors.append(
                f"Square wavetable + Sync warp should be harmonically brighter than Sine frame "
                f"({wt_m.get('slopeRms')} vs {sine_m.get('slopeRms')})"
            )
    if sine_m and oct_m:
        print(
            f"octave shift: zcr={sine_m.get('zcr'):.0f}->{oct_m.get('zcr'):.0f}, "
            f"slopeRms={sine_m.get('slopeRms'):.4f}->{oct_m.get('slopeRms'):.4f}"
        )
        if oct_m.get("slopeRms", 0) < sine_m.get("slopeRms", 0) * 1.75:
            errors.append(
                f"Pitch +12 st did not double frequency/slopeRms "
                f"({sine_m.get('slopeRms')} -> {oct_m.get('slopeRms')})"
            )
    if sine_m and fsh_m:
        print(
            f"freq shift +600 Hz: zcr={sine_m.get('zcr'):.0f}->{fsh_m.get('zcr'):.0f}, "
            f"slopeRms={sine_m.get('slopeRms'):.4f}->{fsh_m.get('slopeRms'):.4f}"
        )
        if fsh_m.get("slopeRms", 0) < sine_m.get("slopeRms", 0) * 2.2:
            errors.append(
                f"Shift +600 Hz did not shift resynthesized frequency upward "
                f"({sine_m.get('slopeRms')} -> {fsh_m.get('slopeRms')})"
            )
    if sine_m and vol_m:
        print(f"partials volume slider: 0dB={sine_m.get('peak'):.4f} -> -18dB={vol_m.get('peak'):.4f}")
        if vol_m.get("peak", 1) > sine_m.get("peak", 0) * 0.35:
            errors.append(
                f"Partials Vol slider at -18 dB did not attenuate resynthesized partials "
                f"({vol_m.get('peak')} vs {sine_m.get('peak')})"
            )
    if tcut_m and tbst_m:
        print(
            f"spectral tilt @1760Hz: peak {tcut_m.get('peak'):.4f}->{tbst_m.get('peak'):.4f}, "
            f"bandMax {tcut_m.get('scopeBandMax'):.4f}->{tbst_m.get('scopeBandMax'):.4f}"
        )
        if (
            tbst_m.get("peak", 0) <= tcut_m.get("peak", 1) * 2.2
            or tbst_m.get("scopeBandMax", 0) <= tcut_m.get("scopeBandMax", 1) * 6.0
        ):
            errors.append(
                f"Spectral Tilt did not strongly differentiate upper-band gain "
                f"(peak {tcut_m.get('peak')}->{tbst_m.get('peak')}, "
                f"bandMax {tcut_m.get('scopeBandMax')}->{tbst_m.get('scopeBandMax')})"
            )

    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("percipitator audio checks passed")


if __name__ == "__main__":
    main()
