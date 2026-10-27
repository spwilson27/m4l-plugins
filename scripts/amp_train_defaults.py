#!/usr/bin/env python3
"""Dev-time trainer for Amp's built-in captures (needs torch + neural-amp-modeler + scipy; NOT the
repo's plain python). Each built-in is a NAM Feather WaveNet trained, with the NAM model code, on a
synthetic amp circuit fitted to a measured real-gear tone (scripts/amp_fit_circuits.py ->
scripts/amp_circuits.json: input high-pass, asymmetric tanh stages, power soft clip, 8-band EQ). No
cabinet: the device's Cab section adds one. Writes src/amp_models/<name>.nam (classic .nam format, as Tone 3000 files).

  <venv>/bin/python scripts/amp_train_defaults.py [name ...] [--steps N]
"""
import json
import math
import os
import sys

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from amp_nam_ref import legacy_to_current, n_weights, preset  # noqa: E402
from nam.models._from_nam import init_from_nam  # noqa: E402

SR = 48000
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "amp_models")


# The circuits are fitted to measured tone targets by scripts/amp_fit_circuits.py (scripts/amp_circuits.json).
from amp_fit_circuits import circuit as fitted_circuit  # noqa: E402

with open(os.path.join(ROOT, "scripts", "amp_circuits.json")) as _f:
    CIRCUITS = json.load(_f)
AMPS = list(CIRCUITS)
# Harder (high-gain) circuits get more steps than the --steps default.
STEPS_MIN = {"lead": 5000, "metal": 8000, "fuzz": 6000}


# Students of real-gear captures (GPL-3.0, third_party/nam_gpl, see its README): the Feather model is trained
# on the capture's own output for the same training signal (teacher -> student).
TEACHERS = {
    "markiv": ("mesa_markiv.nam", "Mesa Boogie Mark IV", "Roman A"),
    "magna": ("magnatone_ch1.nam", "Magnatone Super 59 MkII Ch1", "Tim R"),
    "ds1": ("ds1.nam", "Boss DS-1 (gain 6, tone 5)", "Keith B"),
    "splawn": ("splawn_g10_g3.nam", "Splawn Pro Mod (gear 3)", "Tim R"),
}
AMPS += list(TEACHERS)
STEPS_MIN.update({k: 5000 for k in TEACHERS})
_teacher_cache = {}


def teacher_model(name):
    if name not in _teacher_cache:
        with open(os.path.join(ROOT, "third_party", "nam_gpl", TEACHERS[name][0])) as f:
            doc = json.load(f)
        m = init_from_nam(legacy_to_current(doc))
        m.eval()
        _teacher_cache[name] = m
    return _teacher_cache[name]


def amp(name, x):
    if name in TEACHERS:
        m = teacher_model(name)
        out = []
        with torch.no_grad():
            for i in range(0, len(x), 480000):   # chunks with receptive-field overlap
                lo = max(0, i - m.receptive_field)
                y = m(torch.from_numpy(x[lo:i + 480000].astype(np.float32))[None], pad_start=(lo == 0))[0].numpy()
                out.append(y[len(y) - (min(len(x), i + 480000) - i):])
        return np.concatenate(out).astype(np.float32)
    return fitted_circuit(CIRCUITS[name], x.astype(np.float64)).astype(np.float32)


def metadata(name):
    if name in TEACHERS:
        f, gear, author = TEACHERS[name]
        return {"modeled_by": f"Feather student of the NAM capture '{gear}' by {author} "
                              "(github.com/pelennor2170/NAM_models, GPL-3.0)", "license": "GPL-3.0-or-later",
                "credit": f"{gear} capture by {author}, GPL-3.0",
                "teacher": f}
    return {"modeled_by": "Amp (synthetic circuit after " + CIRCUITS[name]["source"] + ")"}


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
           "sample_rate": SR, "metadata": dict({"name": "Amp " + name.title(), "gear_type": "amp", "tone_type": name,
                                          "loudness": round(loud, 2), "validation_esr": round(esr, 5)}, **metadata(name))}
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
        train(name, max(steps, STEPS_MIN.get(name, 0)))


if __name__ == "__main__":
    main()
