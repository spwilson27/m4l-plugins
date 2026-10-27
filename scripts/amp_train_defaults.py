#!/usr/bin/env python3
"""Dev-time trainer for Amp's built-in captures (needs torch + neural-amp-modeler + scipy; NOT the
repo's plain python). Each built-in is a NAM Feather WaveNet trained, with the NAM model code, on a
synthetic amp circuit defined below (pre filter, asymmetric triode-like stages with interstage
filters, a passive-ish tone stack, power-stage soft clip). No cabinet: the device's Cab section
adds one. Writes src/amp_models/<name>.nam (classic .nam format, as Tone 3000 files).

  <venv>/bin/python scripts/amp_train_defaults.py [name ...] [--steps N]
"""
import json
import math
import os
import sys

import numpy as np
import torch
from scipy.signal import butter, lfilter, sosfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from amp_nam_ref import legacy_to_current, n_weights, preset  # noqa: E402
from nam.models._from_nam import init_from_nam  # noqa: E402

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "amp_models")


def peaking(f, q, gdb):
    A = 10 ** (gdb / 40)
    w0 = 2 * math.pi * f / SR
    al = math.sin(w0) / (2 * q)
    b = [1 + al * A, -2 * math.cos(w0), 1 - al * A]
    a = [1 + al / A, -2 * math.cos(w0), 1 - al / A]
    return np.array(b) / a[0], np.array(a) / a[0]


def stage(x, gain, bias, hp, lp):
    x = sosfilt(butter(1, hp, "highpass", fs=SR, output="sos"), x)
    y = np.tanh(gain * x + bias) - math.tanh(bias)
    return sosfilt(butter(1, lp, "lowpass", fs=SR, output="sos"), y)


AMPS = {
    # name: (pre gain, [(stage gain, bias, hp, lp)], tone peaks [(f, q, dB)], power drive, out level)
    "clean": (1.0, [(1.6, 0.08, 40, 12000)], [(120, 0.7, 2.5), (600, 0.6, -3.0), (3000, 0.8, 3.0)], 1.2, 0.55),
    "crunch": (1.0, [(5.0, 0.18, 90, 9000), (3.0, -0.12, 120, 7000)], [(110, 0.7, 2.0), (500, 0.7, -2.0), (1600, 0.8, 4.0)], 1.8, 0.45),
    "lead": (1.0, [(14.0, 0.22, 180, 8000), (6.0, -0.2, 160, 6500), (4.0, 0.15, 140, 6000)],
             [(140, 0.8, 3.0), (700, 0.6, -4.0), (2200, 1.0, 5.0)], 2.4, 0.4),
    "jazz": (1.0, [(1.2, 0.05, 30, 6000)], [(150, 0.7, 3.5), (900, 0.7, 1.0), (3500, 0.8, -5.0)], 1.1, 0.6),
    "twang": (1.0, [(2.2, 0.06, 70, 14000)], [(100, 0.7, 1.5), (500, 0.6, -5.0), (2800, 0.9, 5.0)], 1.5, 0.5),
    "blues": (1.0, [(3.2, 0.15, 70, 9000), (1.8, -0.1, 100, 8000)], [(130, 0.7, 2.0), (800, 0.8, 3.0), (2500, 0.8, 1.0)], 1.6, 0.48),
    "drive": (1.0, [(8.0, 0.2, 120, 8500), (4.0, -0.15, 140, 7000)], [(120, 0.7, 2.0), (900, 0.8, 3.0), (2000, 0.9, 3.0)], 2.1, 0.42),
    "metal": (1.0, [(20.0, 0.25, 300, 7500), (8.0, -0.22, 220, 6500), (5.0, 0.18, 200, 6000)],
              [(110, 0.9, 4.0), (650, 0.6, -7.0), (3000, 1.0, 5.0)], 2.8, 0.38),
}


def amp(name, x):
    pre, stages, peaks, drive, level = AMPS[name]
    y = x * pre
    for g, b, hp, lp in stages:
        y = stage(y, g, b, hp, lp)
    for f, q, gdb in peaks:
        bb, aa = peaking(f, q, gdb)
        y = lfilter(bb, aa, y)
    y = np.tanh(drive * y) / math.tanh(drive)
    y = sosfilt(butter(2, 30, "highpass", fs=SR, output="sos"), y)
    return (level * y).astype(np.float32)


def training_signal(seconds, seed):
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    x = np.zeros(n)
    t = 0
    while t < n:
        f0 = 80 * 2 ** (rng.uniform(0, 3))
        dur = int(rng.uniform(0.15, 1.2) * SR)
        amp_ = 10 ** rng.uniform(-2.2, 0)
        tt = np.arange(min(dur, n - t)) / SR
        env = np.exp(-tt * rng.uniform(2, 9)) * np.minimum(1, tt * 500)
        s = np.zeros_like(tt)
        for h in range(1, 9):
            s += np.sin(2 * np.pi * f0 * h * tt + rng.uniform(0, 6)) * (rng.uniform(0.3, 1) / h)
        x[t:t + len(tt)] += amp_ * env * s * 0.5
        t += int(dur * rng.uniform(0.3, 1.0))
    x += 10 ** rng.uniform(-3, -2) * rng.standard_normal(n)
    # level sweeps of noise so the model sees the whole drive range
    k = np.linspace(0, 1, n)
    x += 0.3 * (np.sin(2 * np.pi * 0.05 * k * seconds) ** 2) * rng.standard_normal(n) * 0.3
    return np.clip(x, -1, 1).astype(np.float32)


def train(name, steps):
    cfg = preset("feather")
    nw = n_weights(cfg)
    g = torch.Generator().manual_seed(3)
    w0 = (torch.randn(nw, generator=g) * 0.1).tolist()
    w0[-1] = 0.02
    nam = {"version": "0.5.4", "architecture": "WaveNet", "config": cfg, "weights": w0, "sample_rate": SR}
    model = init_from_nam(legacy_to_current(nam))
    model.train()
    x = training_signal(240, 1)
    y = amp(name, x)
    xv = training_signal(20, 2)
    yv = amp(name, xv)
    rf = model.receptive_field
    seg = int(os.environ.get("AMP_SEG", "2048"))
    opt = torch.optim.Adam(model.parameters(), lr=4e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, steps)
    xt, yt = torch.from_numpy(x), torch.from_numpy(y)
    rng = np.random.default_rng(5)

    def pre_emph(v):
        return v[:, 1:] - 0.85 * v[:, :-1]

    for step in range(steps):
        idx = rng.integers(0, len(x) - seg - rf, int(os.environ.get("AMP_BATCH", "8")))
        xb = torch.stack([xt[i:i + seg + rf - 1] for i in idx])
        yb = torch.stack([yt[i + rf - 1:i + seg + rf - 1] for i in idx])
        pred = model(xb, pad_start=False)
        p1, y1 = pre_emph(pred), pre_emph(yb)
        loss = ((p1 - y1) ** 2).mean() / ((y1 ** 2).mean() + 1e-9) + 0.1 * ((pred - yb) ** 2).mean() / ((yb ** 2).mean() + 1e-9)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
        if step % 50 == 0 or step == steps - 1:
            print(name, step, float(loss), flush=True)
    model.eval()
    with torch.no_grad():
        pv = model(torch.from_numpy(xv)[None], pad_start=True)[0].numpy()
    esr = float(((pv - yv) ** 2).sum() / (yv ** 2).sum())
    weights = [float(v) for v in model.export_weights()] if hasattr(model, "export_weights") else None
    if weights is None:
        weights = [float(v) for v in model._export_weights()]
    # loudness like NAM: rms of the output for a reference signal, in dB
    loud = 20 * math.log10(float(np.sqrt(np.mean(pv ** 2))) + 1e-9)
    out = {"version": "0.5.4", "architecture": "WaveNet", "config": cfg, "weights": [round(v, 7) for v in weights],
           "sample_rate": SR, "metadata": {"name": "Amp " + name.title(), "modeled_by": "Amp (synthetic circuit)",
           "gear_type": "amp", "tone_type": name, "loudness": round(loud, 2), "validation_esr": round(esr, 5)}}
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name + ".nam"), "w") as f:
        json.dump(out, f)
    print(name, "ESR", esr, "loudness", loud, flush=True)


def main():
    args = sys.argv[1:]
    steps = 2500
    if "--steps" in args:
        i = args.index("--steps")
        steps = int(args[i + 1])
        del args[i:i + 2]
    torch.set_num_threads(int(os.environ.get("AMP_THREADS", "4")))
    for name in args or list(AMPS):
        train(name, steps)


if __name__ == "__main__":
    main()
