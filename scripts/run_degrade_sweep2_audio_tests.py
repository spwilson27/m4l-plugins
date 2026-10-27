#!/usr/bin/env python3
"""Degrade sweep 2 audio checks (real Max, VM only). Input is 0.45*sin(220)+0.20*sin(1760), peak 0.65.
  near_neutral  DEG-S2-02: Bit stage on with an almost neutral setting (Wrap 0.2%) at Mix 100% must stay within 1 dB of the input;
                the wet path is tanh()'d whenever any stage runs, so engaging a stage drops the level (-1.1 dB at 0.65 peak).
  mix0_exact    Mix 0 with every stage on is the dry signal (control, passes)
  extreme_all   every stage at its extreme: no NaN, peak bounded (control, passes)"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_degrade_audio_tests as r

GEN = open(r.GEN_PATH, encoding="utf-8").read()
ALL_ON = "bit_on 1, sr_on 1, codec_on 1, tele_on 1, fft_on 1"
cases = [
    {"name": "near_neutral", "dur": 450, "params": "wet 1.0, out_gain 0, bit_on 1, bits 16, wrap_amt 0.002, dither 0, sr_on 0, codec_on 0, tele_on 0, fft_on 0, order_code 1234"},
    {"name": "mix0_exact", "dur": 450, "params": f"wet 0.0, out_gain 0, {ALL_ON}, bits 2, wrap_amt 1, srate 300, jitter 1, codec_loss 1, preecho 1, birdies 1, tele_line 1, tele_mode 3, fft_glitch 1, fft_mode 3, order_code 1234"},
    {"name": "extreme_all", "dur": 450, "params": f"wet 1.0, out_gain 0, {ALL_ON}, bits 1, wrap_amt 1, dither 1, srate 100, jitter 1, codec_loss 1, preecho 1, birdies 1, tele_line 1, tele_mode 3, fft_glitch 1, fft_mode 2, fft_frame 5, order_code 43210"},
]
res = {c["name"]: r.run_case(GEN, c) for c in cases}
for k, v in res.items():
    print(k, {a: round(v[a], 4) for a in ("nan", "peak", "rms")})
fails = []
if abs(res["near_neutral"]["peak"] - 0.65) > 0.65 * 0.109:  # 1 dB
    fails.append(f"DEG-S2-02 near-neutral Bit stage changes level: peak {res['near_neutral']['peak']:.3f} vs input 0.65")
if abs(res["mix0_exact"]["peak"] - 0.65) > 0.01:
    fails.append(f"mix0 not dry: {res['mix0_exact']['peak']}")
if res["extreme_all"]["nan"] or res["extreme_all"]["peak"] > 1.01:
    fails.append(f"extreme_all nan/peak {res['extreme_all']['nan']} {res['extreme_all']['peak']}")
print("FAIL" if fails else "PASS", *fails, sep="\n  ")
sys.exit(1 if fails else 0)
