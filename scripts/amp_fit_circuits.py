#!/usr/bin/env python3
"""Dev-time: fit the synthetic amp circuits behind Amp's built-in captures to measured tone targets.

Each target is a tone fingerprint MEASURED (no weights used) from a real-gear NAM capture: the small-signal
response in octave bands 63 Hz..8 kHz relative to 1 kHz (-40 dBFS noise), the THD of a 200 Hz sine at
-24 / -12 / -3 dBFS, and the even / odd harmonic balance at -12 dBFS. The captures measured are from
github.com/pelennor2170/NAM_models (GPL-3.0); only these numbers are kept, nothing of the models.

Circuit (see `circuit()`): input high-pass (where the drive starts, e.g. a Tube Screamer's ~700 Hz) ->
N asymmetric tanh stages (gain, bias; 1st-order interstage high-pass / low-pass) -> power soft clip ->
8-band graphic EQ (peaking filters at the octave centres, fitted so the small-signal response hits the
target) -> level. Writes scripts/amp_circuits.json, read by scripts/amp_train_defaults.py.

  <venv>/bin/python scripts/amp_fit_circuits.py [name ...]   (names: refit only those, keep the others)
"""
import json
import math
import os

import numpy as np
from scipy.signal import butter, lfilter, sosfilt

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANDS = [63, 125, 250, 500, 1000, 2000, 4000, 8000]

# name: (measured from, eq rel 1 kHz, THD % at -24 / -12 / -3 dBFS, even/odd dB, input high-pass Hz, stages, drive)
TARGETS = {
    "clean":  ("Fender TwinVerb Normal", [-0.1, 0.3, -2.8, -6.0, 0.0, 9.1, 15.8, 19.2], [0.1, 0.5, 1.5], 12.6, 30, 1, 1.0),
    "chime":  ("Vox AC15 (Jonar)", [-7.6, -3.2, -2.3, -1.9, 0.0, 3.5, 9.2, 12.3], [7.1, 34.1, 52.0], -9.5, 60, 1, 1.4),
    "bass":   ("Tech21 dUg DP3X", [-3.6, 3.4, 7.7, 5.1, 0.0, 9.5, 7.4, -14.3], [1.4, 3.6, 5.3], -5.7, 20, 1, 1.2),
    "drive":  ("Ibanez TS9", [-14.8, -8.7, -3.6, -0.2, 0.0, -3.2, -8.2, -16.0], [4.8, 13.8, 9.9], -36.6, 700, 1, 1.2),
    "crunch": ("Marshall JCM2000 Crunch", [-5.1, -2.9, -3.0, -2.4, 0.0, 3.6, 4.8, 1.7], [9.8, 23.6, 25.9], -7.8, 120, 2, 1.8),
    "lead":   ("Marshall JVM OD1", [-13.9, -2.8, -8.5, -7.7, 0.0, 4.9, 3.6, -4.6], [27.7, 28.4, 29.3], -14.6, 200, 2, 2.2),
    "metal":  ("Peavey 5150", [1.7, 6.4, 0.2, -3.5, 0.0, 1.8, 0.2, -4.6], [18.8, 18.9, 23.0], 0.8, 400, 2, 2.6),
    "fuzz":   ("Boss HM-2", [-7.4, -8.6, -16.4, -7.0, 0.0, -6.4, -17.1, -26.8], [7.8, 94.8, 174.6], 0.1, 80, 2, 3.0),
}
ORDER = ["clean", "chime", "bass", "drive", "crunch", "lead", "metal", "fuzz"]


def peaking(f, q, gdb):
    A = 10 ** (gdb / 40)
    w0 = 2 * math.pi * f / SR
    al = math.sin(w0) / (2 * q)
    b = np.array([1 + al * A, -2 * math.cos(w0), 1 - al * A])
    a = np.array([1 + al / A, -2 * math.cos(w0), 1 - al / A])
    return b / a[0], a / a[0]


def circuit(c, x):
    """The circuit the built-in is trained on. `c` is one entry of amp_circuits.json."""
    y = sosfilt(butter(1, c["hp_in"], "highpass", fs=SR, output="sos"), x)
    for g, b in c["stages"]:
        y = np.tanh(g * y + b) - math.tanh(b)
        y = sosfilt(butter(1, [c["hp_stage"], c["lp_stage"]], "bandpass", fs=SR, output="sos"), y)
    d = c["drive"]
    y = np.tanh(d * y) / math.tanh(d)
    for f, gdb in zip(BANDS, c["eq"]):
        bb, aa = peaking(f, 1.41, gdb)
        y = lfilter(bb, aa, y)
    y = sosfilt(butter(2, 25, "highpass", fs=SR, output="sos"), y)
    return c["level"] * y


def bands_db(x, y, skip):
    N = 4096
    ein = np.zeros(len(BANDS))
    eout = np.zeros(len(BANDS))
    w = np.hanning(N)
    f = np.fft.rfftfreq(N, 1 / SR)
    for st in range(skip, len(x) - N + 1, N // 2):
        X = np.abs(np.fft.rfft(w * x[st:st + N])) ** 2
        Y = np.abs(np.fft.rfft(w * y[st:st + N])) ** 2
        for i, c in enumerate(BANDS):
            m = (f >= c / math.sqrt(2)) & (f < c * math.sqrt(2))
            ein[i] += X[m].sum()
            eout[i] += Y[m].sum()
    g = 10 * np.log10(eout / ein)
    return g - g[4]


def harmonics(y, f0, skip, nh=9):
    per = SR / f0
    n = int((len(y) - skip) // per * per)
    t = np.arange(n)
    seg = y[skip:skip + n]
    return np.array([abs(np.dot(seg, np.exp(-2j * math.pi * f0 * h * t / SR))) * 2 / n for h in range(1, nh + 1)])


def distortion(c):
    skip = 4800
    thd = []
    eo = 0.0
    for lv in (-24, -12, -3):
        x = 10 ** (lv / 20) * np.sin(2 * math.pi * 200 * np.arange(skip + 4800) / SR)
        h = harmonics(circuit(c, x), 200, skip)
        hd = (h[1:] ** 2).sum()
        thd.append(100 * math.sqrt(hd) / max(h[0], 1e-12))
        if lv == -12:
            ev = (h[1::2] ** 2).sum()
            od = (h[2::2] ** 2).sum()
            eo = 10 * math.log10((ev + 1e-20) / (od + 1e-20))
    return thd, eo


def fit_eq(c, target):
    rng = np.random.default_rng(7)
    skip = 6000
    x = (rng.uniform(-1, 1, skip + 16384) * 0.01 * math.sqrt(3))
    for _ in range(10):
        cur = bands_db(x, circuit(c, x), skip)
        # damped and clamped: neighbouring peaking filters overlap, and deep cuts made the plain update diverge
        c["eq"] = [max(-24.0, min(30.0, e + 0.6 * (t - m))) for e, t, m in zip(c["eq"], target, cur)]
    return bands_db(x, circuit(c, x), skip)


def fit(name):
    src, eq, thd_t, eo_t, hp_in, nst, drive = TARGETS[name]
    sgn = ((1,), (1, -1), (1, -1, 1))[nst - 1]

    def make(g, b, lp, eqv):
        return {"hp_in": hp_in, "hp_stage": 60.0, "lp_stage": float(lp), "drive": drive, "level": 1.0,
                "stages": [[float(g if i == 0 else max(1.5, g * 0.4)), float(b * s)] for i, s in enumerate(sgn)],
                "eq": list(eqv)}

    # The small-signal EQ does not depend on the stage gain, so fit it once on a quiet circuit, then search the
    # drive with that EQ in place (the EQ shapes the harmonics), then refit the EQ.
    c = make(1.0, 0.0, 9000, [0.0] * 8)
    fit_eq(c, eq)
    eqv = c["eq"]
    best = None
    for rnd in range(2):
        for g in np.geomspace(0.6, 400, 26):
            for b in (0.0, 0.1, 0.25, 0.45):
                for lp in (4500, 9000):
                    cc = make(g, b, lp, eqv)
                    thd, eo = distortion(cc)
                    err = sum(abs(math.log(t + 0.5) - math.log(m + 0.5)) for t, m in zip(thd_t, thd)) + 0.04 * abs(eo - eo_t)
                    if best is None or err < best[0]:
                        best = (err, cc)
        c = best[1]
        fit_eq(c, eq)
        eqv = c["eq"]
        best = (sum(abs(math.log(t + 0.5) - math.log(m + 0.5)) for t, m in zip(thd_t, distortion(c)[0])) + 0.04 * abs(distortion(c)[1] - eo_t), c)
    got_eq = fit_eq(c, eq)
    thd, eo = distortion(c)
    # level: about -18 dB rms out for the -12 dBFS sine, like a real capture's ballpark (Normalize trims it)
    x = 10 ** (-12 / 20) * np.sin(2 * math.pi * 200 * np.arange(9600) / SR)
    r = float(np.sqrt(np.mean(circuit(c, x)[4800:] ** 2)))
    c["level"] = float(10 ** (-18 / 20) / max(r, 1e-9))
    c["eq"] = [round(v, 3) for v in c["eq"]]
    c["source"] = src
    print(f"{name:7s} {src:26s} THD {['%.1f' % v for v in thd]} (target {thd_t}) e/o {eo:+.1f} ({eo_t:+.1f}) "
          f"eq err max {max(abs(a - b) for a, b in zip(got_eq, eq)):.2f} dB  stages {c['stages']}", flush=True)
    return c


def main():
    import sys
    path = os.path.join(ROOT, "scripts", "amp_circuits.json")
    out = json.load(open(path)) if os.path.exists(path) and sys.argv[1:] else {}
    for n in (sys.argv[1:] or ORDER):
        out[n] = fit(n)
    out = {n: out[n] for n in ORDER if n in out}
    with open(path, "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
