#!/usr/bin/env python3
"""Render Degrade (shared NonRealTime scripts/max_harness.py) through Ableton-bundled Max 9 and verify its 5 DSP sections,
zero-CPU section bypass gates, dynamic reordering, and #0-degscope telemetry.

Cases:
  all_off    — All 5 sections disabled (`*_on 0`): passes input signal cleanly with active mask = 0
  bit_wrap   — Section 1 (`bit_on 1`, `bits 3`, `wrap_amt 0.7`): quantizes and folds waveform
  sr_sh      — Section 2 (`sr_on 1`, `srate 2500`, `sr_mode 0`): Sample-and-Hold staircase (>65% flat steps)
  codec_tele — Section 3 + 4 (`codec_on 1`, `tele_on 1`, `tele_mode 2`): lossy holes + ADPCM companding
  fft_glitch — Section 5 (`fft_on 1`, `fft_mode 1`, `fft_glitch 0.85`): spectral bin scramble
  order_a    — `order_code 1234` (BIT -> TELE) with Bit + Telecom enabled
  order_b    — `order_code 30124` (TELE -> BIT) with Bit + Telecom enabled (verifies reordering changes output)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "degrade_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "degrade_probe.js")



def build_device(gen_code, case):
    boxes = [
        mh.msg("dev-params", case["params"], 200, 40, 740),
        mh.msg("dev-setbuf", "setbuffer #0-degscope", 200, 70, 190),
        mh.msg("dev-bind", "scope #0-degscope", 200, 100, 180),
        mh.box("dev-scope", "buffer~ #0-degscope @samps 32", 520, 100, 210, numoutlets=2, outlettype=["float", "bang"]),
        # Rich two-tone test source (220 Hz + 1760 Hz, or 0.0 when case["silent"] is True)
        mh.box("dev-osc1", "cycle~ 220", 200, 130, 70, numinlets=2, outlettype=["signal"]),
        mh.box("dev-osc2", "cycle~ 1760", 280, 130, 75, numinlets=2, outlettype=["signal"]),
        mh.box("dev-g1", "*~ 0.0" if case.get("silent") else "*~ 0.45", 200, 160, 55, numinlets=2, outlettype=["signal"]),
        mh.box("dev-g2", "*~ 0.0" if case.get("silent") else "*~ 0.20", 280, 160, 55, numinlets=2, outlettype=["signal"]),
        mh.box("dev-sum", "+~", 200, 185, 40, numinlets=2, outlettype=["signal"]),
        mh.gen_box("dev-gen", gen_code, 200, 215, numinlets=2, numoutlets=2),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-osc1", 0, "dev-g1", 0),
        mh.line("dev-osc2", 0, "dev-g2", 0),
        mh.line("dev-g1", 0, "dev-sum", 0),
        mh.line("dev-g2", 0, "dev-sum", 1),
        mh.line("dev-sum", 0, "dev-gen", 0),
        mh.line("dev-sum", 0, "dev-gen", 1),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
    ]
    return boxes, lines


def run_case(gen_code, case):
    b, l = build_device(gen_code, case)
    # Old runner recorded from DSP start (record armed before dsp start), so settle_ms = 0.
    return (mh.run_case(f"degrade_{case['name']}", b, l, probe_js=PROBE_JS, probe_args=case["name"],
                       settle_ms=0, dur_ms=case["dur"], channels=2))


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"SKIP: Max binary not found at {mh.MAX_BIN}")
        return

    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    cases = [
        {
            "name": "idle_silent",
            "dur": 450,
            "silent": True,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 4, wrap_amt 0.8, dither 1.0, sr_on 1, srate 4000, jitter 0.8, codec_on 1, codec_loss 0.8, preecho 0.8, birdies 0.8, tele_on 1, tele_line 0.8, fft_on 1, fft_glitch 0.8, order_code 1234",
        },
        {
            "name": "all_off",
            "dur": 450,
            "params": "wet 0.5, out_gain 0, bit_on 0, bits 16, wrap_amt 0, dither 0, sr_on 0, srate 44100, jitter 0, codec_on 0, codec_loss 0, preecho 0, birdies 0, tele_on 0, tele_line 0, fft_on 0, fft_glitch 0, order_code 1234",
        },
        {
            "name": "all_on_zero",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 16, wrap_amt 0, dither 0, sr_on 1, srate 44100, jitter 0, codec_on 1, codec_loss 0, preecho 0, birdies 0, tele_on 1, tele_line 0, fft_on 1, fft_glitch 0, order_code 1234",
        },
        {
            "name": "bit_wrap",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 2.5, wrap_amt 0.75, dither 0.15, sr_on 0, codec_on 0, tele_on 0, fft_on 0",
        },
        {
            "name": "sr_sh",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 1, srate 2200, jitter 0.0, sr_mode 0, codec_on 0, tele_on 0, fft_on 0",
        },
        {
            "name": "codec_wet",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 1, codec_loss 0.65, preecho 1.0, birdies 1.0, tele_on 0, fft_on 0",
        },
        {
            "name": "codec_100",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 1, codec_loss 1.0, preecho 0.35, birdies 0.65, tele_on 0, fft_on 0",
        },
        {
            "name": "codec_tele",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 1, codec_loss 0.8, preecho 0.5, birdies 0.6, tele_on 1, tele_mode 2, tele_line 0.75, fft_on 0",
        },
        {
            "name": "fft_den",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 0, fft_glitch 0.85, fft_frame 35",
        },
        {
            "name": "fft_scr5",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 1, fft_glitch 0.85, fft_frame 5",
        },
        {
            "name": "fft_spl",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 2, fft_glitch 0.85, fft_frame 45",
        },
        {
            "name": "fft_cmb",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 0, sr_on 0, codec_on 0, tele_on 0, fft_on 1, fft_mode 3, fft_glitch 0.85, fft_frame 45",
        },
        {
            "name": "order_a",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 2.0, wrap_amt 0.8, dither 0.0, sr_on 0, codec_on 0, tele_on 1, tele_mode 2, tele_line 0.85, fft_on 0, order_code 1234",
        },
        {
            "name": "order_b",
            "dur": 450,
            "params": "wet 1.0, out_gain 0, bit_on 1, bits 2.0, wrap_amt 0.8, dither 0.0, sr_on 0, codec_on 0, tele_on 1, tele_mode 2, tele_line 0.85, fft_on 0, order_code 30124",
        },
    ]

    results = {}
    for c in cases:
        res = run_case(gen_code, c)
        results[c["name"]] = res
        print(
            f"[{c['name']:10s}] nan={int(res['nan'])} peak={res['peak']:.3f} rms={res['rms']:.3f} "
            f"stepDiff={res['stepDiff']:.3f} rough={res['roughness']:.4f} mask={int(res['scopeMask'])} order={int(res['scopeOrder'])}"
        )
        assert res["nan"] == 0, f"{c['name']}: Produced NaN samples!"
        if c["name"] not in ("codec_100", "idle_silent"):
            assert res["peak"] > 0.05, f"{c['name']}: Output was silent!"

    # 0. Verify idle_silent skips DSP & PRNG/dither when no audio is coming in (peak == 0.0)
    assert results["idle_silent"]["peak"] < 1e-6, f"idle_silent must be 0.0 when no audio is coming in, got {results['idle_silent']['peak']}"
    assert results["idle_silent"]["scopeMask"] == 31, "idle_silent should still report active stage mask = 31"

    # 1. Verify all_off (at default wet=0.5) and all_on_zero (at wet=1.0, default knob values) pass audio cleanly
    assert results["all_off"]["scopeMask"] == 0, "all_off must report 0 active stages in #0-degscope"
    assert results["all_off"]["roughness"] < 0.035, "all_off must have clean sinusoidal roughness"
    assert results["all_on_zero"]["scopeMask"] == 31, "all_on_zero must report all 5 stages enabled (mask=31)"
    # all_off runs at Mix 50% (equal power: a transparent chain sums coherently to +3 dB), all_on_zero at Mix 100%: compare with the 0.65 input peak
    assert abs(results["all_on_zero"]["peak"] - 0.65) < 0.02, "all_on_zero at default knob values must be transparent (input peak 0.65)"
    assert results["all_on_zero"]["roughness"] < 0.035, "all_on_zero at default knob values must have clean sinusoidal roughness"

    # 2. Verify Sample-and-Hold at 2200 Hz produces staircase flat steps (>70% consecutive identical samples)
    assert results["sr_sh"]["stepDiff"] > 0.70, f"sr_sh should produce staircase hold steps, got {results['sr_sh']['stepDiff']}"
    assert results["sr_sh"]["scopeMask"] == 2, "sr_sh should report stage mask = 2"

    # 3. Verify Bit + Wrap alters waveform vs clean all_off
    assert abs(results["bit_wrap"]["hash"] - results["all_off"]["hash"]) > 100, "bit_wrap must alter waveform"
    assert results["bit_wrap"]["scopeMask"] == 1, "bit_wrap should report stage mask = 1"

    # 4. Verify Codec alone is smooth/spectral (not staircase/clipped or crunchy) and reports mask = 4
    assert results["codec_wet"]["scopeMask"] == 4, "codec_wet should report stage mask = 4"
    assert results["codec_wet"]["stepDiff"] < 0.05, "codec_wet must be smooth spectral audio, not staircase quantized"
    assert results["codec_wet"]["roughness"] < 0.08, f"codec_wet must have smooth sinusoidal roughness (<0.08), got {results['codec_wet']['roughness']}"
    assert abs(results["codec_wet"]["hash"] - results["all_off"]["hash"]) > 100, "codec_wet must spectrally transform audio"

    # 4b. Verify Codec at 100% Damage is nearly silent (extreme packet starvation) except for rare sinusoidal birdie glitches
    assert results["codec_100"]["rms"] < results["codec_wet"]["rms"] * 0.35, (
        f"codec_100 RMS ({results['codec_100']['rms']:.4f}) must be much quieter than codec_wet ({results['codec_wet']['rms']:.4f})"
    )
    assert results["codec_100"]["peak"] > 0.002, "codec_100 should still emit occasional faint birdie glitches (>0.002 peak)"
    assert results["codec_100"]["roughness"] < 0.08, "codec_100 birdie glitches must remain smooth sinusoids"

    # 5. Verify Codec + Telecom and all 4 FFT Glitch modes (Den, Scr, Spl, Cmb) run cleanly
    assert results["codec_tele"]["scopeMask"] == 12, "codec_tele should report stage mask = 4 + 8 = 12"
    for fft_key in ("fft_den", "fft_scr5", "fft_spl", "fft_cmb"):
        assert results[fft_key]["scopeMask"] == 16, f"{fft_key} should report stage mask = 16"
        assert results[fft_key]["stepDiff"] < 0.02, f"{fft_key} must not have sample-hold steps ({results[fft_key]['stepDiff']})"
        assert results[fft_key]["roughness"] < 0.085, f"{fft_key} must be smooth without quantization clicks ({results[fft_key]['roughness']})"

    # 5. Verify dynamic stage reordering (BIT -> TELE vs TELE -> BIT) produces distinct audio and telemetry
    assert int(results["order_a"]["scopeOrder"]) == 1234, "order_a should report order 1234"
    assert int(results["order_b"]["scopeOrder"]) == 30124, "order_b should report order 30124"
    assert results["order_a"]["hash"] != results["order_b"]["hash"], "Reordering BIT->TELE vs TELE->BIT must change output waveform!"

    print("ALL DEGRADE REAL MAX AUDIO TESTS PASSED!")


if __name__ == "__main__":
    main()
