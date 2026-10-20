#!/usr/bin/env python3
"""Render Better Sampler through Ableton-bundled Max 9 and verify all 4 playback
engines (Repitch, Cycles, Textures, Slice), Freeze, Reverse, 8-voice Stereo Unison,
SVF Filter, and #0-bsscope live UI telemetry.

Cases:
  idle_silent      — All 16 voices released: output is silent and active voice count == 0
  repitch_chord    — Mode 0 (Repitch) 3-voice triad with loop & 4x stereo unison
  cycles_formant   — Mode 1 (Cycles) wavetable cycle engine with +7 st Formant shift
  textures_cloud   — Mode 2 (Textures) dual Hann granular cloud with Freeze & Spray
  slice_trig       — Mode 3 (Slice) transient slice playback with SVF LP filter & drive
  forward_oneshot  — Mode 0 one-shot, unison 1, glide armed: decaying forward read
  reverse_oneshot  — Mode 0 one-shot played backwards through the same decay
  freeze_hold      — Mode 0 playhead frozen at a non-zero sample position
  unison8_wide     — Mode 0 single note with 8 detuned stereo unison voices
  mono_sample      — 1-channel buffer, unison 1: both outputs carry equal audio
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "sampler_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "sampler_probe.js")
GEN_CODE = ""


SETTLE_MS = 100


def device_patch(case):
    """Device-specific boxes for the shared scaffold (scripts/max_harness.py)."""
    name = case["name"]
    chans = 1 if name == "mono_sample" else 2
    boxes = [
        mh.msg("obj-params", case["params"], 200, 40, 760),
        mh.msg("obj-setbuf", "setbuffers #0-bsamp #0-bsvoices #0-bsscope", 200, 70, 290),
        mh.msg("obj-bind", "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope", 200, 100, 320),
        mh.box("obj-samp", f"buffer~ #0-bsamp @samps 12000 {chans}", 540, 70, 225,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-voices", "buffer~ #0-bsvoices @samps 128", 540, 100, 220,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-scope", "buffer~ #0-bsscope @samps 64", 540, 130, 210,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-order", "t b b b", 200, 10, 60, numoutlets=3, outlettype=["bang", "bang", "bang"]),
        mh.gen_box("obj-gen", GEN_CODE, 200, 215),
    ]
    lines = [
        # Fixed order (right to left): bind buffers, then params, then seed the sample.
        mh.line("obj-load", 0, "obj-order", 0),
        mh.line("obj-order", 2, "obj-bind", 0),
        mh.line("obj-order", 1, "obj-params", 0),
        mh.line("obj-order", 0, "obj-setbuf", 0),
        mh.line("obj-setbuf", 0, "obj-js", 3),
        mh.line("obj-bind", 0, "obj-gen", 0),
        mh.line("obj-params", 0, "obj-gen", 0),
        mh.line("obj-gen", 0, "obj-record", 0),
        mh.line("obj-gen", 1, "obj-record", 1),
        mh.line("obj-gen", 0, "obj-mute-l", 0),
        mh.line("obj-gen", 1, "obj-mute-r", 0),
    ]
    return boxes, lines


def run_case(gen_code, case):
    global GEN_CODE
    GEN_CODE = gen_code
    boxes, lines = device_patch(case)
    # Voices are gated on at the start of the measured window (sample time, stepped mode).
    return mh.run_case(
        case["name"], boxes, lines,
        probe_js=PROBE_JS, probe_args=case["name"],
        settle_ms=SETTLE_MS, dur_ms=case["dur"], channels=2,
        mode="stepped", events=[(SETTLE_MS, "obj-js", 3, "trigger")],
    )


CASES = [
    {
        "name": "idle_silent",
        "dur": 400,
        "params": "mode 0, filt_on 1, out_gain 0",
    },
    {
        "name": "repitch_chord",
        "dur": 600,
        "params": "mode 0, loop_mode 1, unison_voices 4, unison_detune 0.35, unison_width 0.8, filt_on 1, filt_cutoff 14000, out_gain 0",
    },
    {
        "name": "cycles_formant",
        "dur": 600,
        "params": "mode 1, formant 7, grain_motion 1.0, unison_voices 2, filt_on 1, filt_cutoff 12000, out_gain 0",
    },
    {
        "name": "textures_cloud",
        "dur": 600,
        "params": "mode 2, freeze 1, play_pos 0.25, grain_size 55, grain_spray 0.35, lfo_rate 4.0, lfo_pos 0.25, out_gain 0",
    },
    {
        "name": "slice_trig",
        "dur": 600,
        "params": "mode 3, filt_on 1, filt_type 0, filt_cutoff 2800, filt_res 0.45, filt_drive 0.5, out_gain 0",
    },
    {
        "name": "forward_oneshot",
        "dur": 700,
        "params": "mode 0, reverse 0, freeze 0, loop_mode 0, unison_voices 1, unison_width 0, glide_ms 300, filt_on 0, sus_lvl 1, dec_ms 10000, atk_ms 0.5, out_gain 0",
    },
    {
        "name": "reverse_oneshot",
        "dur": 700,
        "params": "mode 0, reverse 1, freeze 0, loop_mode 0, unison_voices 1, unison_width 0, filt_on 0, sus_lvl 1, dec_ms 10000, atk_ms 0.5, out_gain 0",
    },
    {
        "name": "freeze_hold",
        "dur": 500,
        "params": "mode 0, freeze 1, reverse 0, play_pos 0.12, loop_mode 0, unison_voices 1, unison_width 0, unison_detune 0, lfo_pos 0, filt_on 0, sus_lvl 1, dec_ms 10000, atk_ms 0.5, out_gain 0",
    },
    {
        "name": "unison8_wide",
        "dur": 500,
        "params": "mode 0, loop_mode 1, unison_voices 8, unison_detune 0.85, unison_width 1, freeze 0, reverse 0, filt_on 0, sus_lvl 1, out_gain 0",
    },
    {
        "name": "mono_sample",
        "dur": 500,
        "params": "mode 0, loop_mode 1, unison_voices 1, unison_width 0, unison_detune 0, freeze 0, reverse 0, filt_on 0, sus_lvl 1, out_gain 0",
    },
]


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"Skipping real Max audio test: {mh.MAX_BIN} not found")
        return

    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    results = {}
    only = os.environ.get("SAMPLER_CASE", "").strip()
    cases = [c for c in CASES if not only or c["name"] == only]
    for c in cases:
        # One run per case: max_harness isolates each Max instance and rejects mismatched results,
        # so a missing or unbound result is a real failure, not a reason to retry.
        r = run_case(gen_code, c)
        if not r:
            raise RuntimeError(f"Max audio harness did not produce a result for {c['name']}")
        assert r.get("scopeFrames", 0) >= 8000, f"{c['name']}: sample buffer not bound (scopeFrames={r.get('scopeFrames')})"
        results[c["name"]] = r
        ratio = (r["lateRms"] / r["earlyRms"]) if r.get("earlyRms", 0) > 1e-8 else 0.0
        r["lateEarly"] = ratio
        print(
            f"[{c['name']:16s}] peak={r['peak']:.4f} rms={r['rms']:.4f} "
            f"stereoDiff={r['stereoDiff']:.4f} late/early={ratio:.3f} "
            f"activeVoices={int(r['scopeActive'])} cutHz={r['scopeCutHz']:.1f} "
            f"sampFrames={r['scopeFrames']:.0f} rendered={r.get('rendered', 0):.0f} "
            f"nan={int(r['nan'])}"
        )
        assert r["nan"] == 0, f"{c['name']}: NaN detected in audio output!"
        assert r["peak"] < 1.05, f"{c['name']}: output exceeded the soft ceiling ({r['peak']})"
        assert r["scopeFrames"] >= 8000, f"{c['name']}: sample buffer was not bound (frames={r['scopeFrames']})"

    if any(c["name"] not in results for c in CASES):
        print("Partial sampler audio run; cross-case checks skipped.")
        return

    # Verify idle silence
    assert results["idle_silent"]["peak"] < 1e-4, "idle_silent must be silent when no voices are gated"
    assert results["idle_silent"]["scopeActive"] == 0, "idle_silent must report 0 active voices"

    # Verify all 4 active engines produce clean audio & update telemetry
    for active_case in ("repitch_chord", "cycles_formant", "textures_cloud", "slice_trig"):
        r = results[active_case]
        assert r["peak"] > 0.05, f"{active_case}: expected audible output peak > 0.05, got {r['peak']}"
        assert r["rms"] > 0.01, f"{active_case}: expected audible RMS > 0.01, got {r['rms']}"
        assert r["scopeActive"] >= 1, f"{active_case}: #0-bsscope must report active voices >= 1"
        assert r["scopePeakL"] > 0.02, f"{active_case}: #0-bsscope must report live output peak"

    assert results["repitch_chord"]["scopeActive"] >= 3, "Repitch triad must keep 3 voices active"
    assert results["repitch_chord"]["stereoDiff"] > 0.01, "4x Unison triad must produce stereo spread"
    assert results["repitch_chord"]["scopeCutHz"] > 8000, "Open SVF cutoff must land in the scope telemetry"
    assert 1000 < results["slice_trig"]["scopeCutHz"] < 5000, "Slice LP cutoff must track the 2.8 kHz filter"

    for tonal in ("forward_oneshot", "reverse_oneshot", "freeze_hold", "unison8_wide"):
        r = results[tonal]
        assert r["peak"] > 0.04, f"{tonal}: expected audible peak > 0.04, got {r['peak']}"
        assert r["rms"] > 0.008, f"{tonal}: expected audible RMS > 0.008, got {r['rms']}"
        assert r["scopeActive"] >= 1, f"{tonal}: #0-bsscope must report an active voice"
        assert r["earlyRms"] > 0.005 and r["lateRms"] > 0.005, f"{tonal}: both analysis windows must be audible"

    fwd = results["forward_oneshot"]["lateEarly"]
    rev = results["reverse_oneshot"]["lateEarly"]
    assert fwd < 0.92, f"Forward one-shot must decay (late/early={fwd:.3f})"
    assert rev > fwd + 0.2, f"Reverse must walk back into the attack (late/early={rev:.3f}, forward={fwd:.3f})"

    frozen = results["freeze_hold"]["lateEarly"]
    assert 0.8 <= frozen <= 1.25, f"Frozen playhead must hold a steady level (late/early={frozen:.3f})"

    assert results["unison8_wide"]["stereoDiff"] > results["forward_oneshot"]["stereoDiff"] + 0.015, (
        "8-voice wide unison must spread wider than a centered single voice"
    )
    assert results["unison8_wide"]["scopeActive"] == 1, "Unison stacks inside one allocated voice"

    mono = results["mono_sample"]
    assert mono["peak"] > 0.04 and mono["rms"] > 0.008, "mono_sample: expected audible output"
    assert mono["stereoDiff"] < 0.001, f"mono_sample: L/R must match (stereoDiff={mono['stereoDiff']})"
    assert mono["scopePeakL"] > 0.02, "mono_sample: scope must report live output"

    print("All 10 real Max 9 Better Sampler audio tests passed!")


if __name__ == "__main__":
    main()
