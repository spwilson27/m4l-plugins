#!/usr/bin/env python3
"""Test audio for scripts/vm_smoke.sh (stdlib only): assets/smoke_loop.wav = 4 s stereo 44.1 kHz loop
(220 Hz + 1.3 kHz tones bursting every 0.5 s over low-level pink-ish noise, peak ~0.5), seamless at the loop point.
  python3 scripts/make_smoke_assets.py [OUTDIR]"""
import math, os, random, struct, sys, wave

out = sys.argv[1] if len(sys.argv) > 1 else "assets"
os.makedirs(out, exist_ok=True)
sr, dur = 44100, 4.0
n = int(sr * dur)
random.seed(7)
lp = [0.0, 0.0]
frames = bytearray()
for i in range(n):
    t = i / sr
    env = 0.5 * (1 - math.cos(2 * math.pi * ((t * 2) % 1.0)))  # 2 Hz bursts
    for c in (0, 1):
        lp[c] += 0.15 * (random.uniform(-1, 1) - lp[c])
        s = 0.35 * math.sin(2 * math.pi * 220 * t + c) * env + 0.1 * math.sin(2 * math.pi * 1300 * t) * env + 0.25 * lp[c] + 0.05 * random.uniform(-1, 1)
        frames += struct.pack("<h", int(max(-1, min(1, s)) * 32000))
w = wave.open(os.path.join(out, "smoke_loop.wav"), "wb")
w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr)
w.writeframes(bytes(frames)); w.close()
print("wrote", os.path.join(out, "smoke_loop.wav"))
