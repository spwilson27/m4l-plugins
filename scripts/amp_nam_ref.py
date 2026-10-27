#!/usr/bin/env python3
"""Dev-time helper (needs torch + neural-amp-modeler, NOT the repo's plain python).

Builds NAM WaveNet models with the classic trainer presets, exports them as .nam
and dumps a reference input/output pair, so tests/test_amp.js can check the JS
reference forward and the generated GenExpr against the official implementation.

  <venv>/bin/python scripts/amp_nam_ref.py <outdir> [preset ...]
"""
import json
import math
import os
import sys

import torch
from nam.models._from_nam import init_from_nam

D_LITE0 = [1, 2, 4, 8, 16, 32, 64]
D_LITE1 = [128, 256, 512, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512]
D_STD = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512]


def preset(name):
    c0, c1, d0, d1 = {
        "standard": (16, 8, D_STD, D_STD),
        "lite": (12, 6, D_LITE0, D_LITE1),
        "feather": (8, 4, D_LITE0, D_LITE1),
        "nano": (4, 2, D_LITE0, D_LITE1),
    }[name]
    return {
        "layers": [
            {"input_size": 1, "condition_size": 1, "channels": c0, "head_size": c1,
             "kernel_size": 3, "dilations": d0, "activation": "Tanh", "gated": False,
             "head_bias": False},
            {"input_size": c0, "condition_size": 1, "channels": c1, "head_size": 1,
             "kernel_size": 3, "dilations": d1, "activation": "Tanh", "gated": False,
             "head_bias": True},
        ],
        "head_scale": 0.02,
    }


def legacy_to_current(nam):
    """Classic .nam (head_size / head_bias) -> what this nam version parses."""
    out = json.loads(json.dumps(nam))
    out["config"].setdefault("head", None)
    for lc in out["config"]["layers"]:
        lc["head"] = {"out_channels": lc.pop("head_size"), "kernel_size": 1,
                      "bias": lc.pop("head_bias")}
        lc.pop("gated", None)
        lc["activation"] = {"name": lc["activation"]}
    return out


def lstm_cfg(name):
    h, nl = {"lstm": (16, 1), "lstm2": (8, 2)}[name]
    return {"input_size": 1, "hidden_size": h, "num_layers": nl}


def n_weights(cfg):
    if "hidden_size" in cfg:
        h, n, i = cfg["hidden_size"], 0, cfg["input_size"]
        for _ in range(cfg["num_layers"]):
            n += 4 * h * (i + h) + 4 * h + 2 * h
            i = h
        return n + h + 1
    n = 0
    for lc in cfg["layers"]:
        c, k = lc["channels"], lc["kernel_size"]
        n += lc["input_size"] * c
        n += len(lc["dilations"]) * (c * c * k + c + lc["condition_size"] * c + c * c + c)
        n += c * lc["head_size"] + (lc["head_size"] if lc["head_bias"] else 0)
    return n + 1


def stimulus(n, sr=48000):
    out = []
    for i in range(n):
        t = i / sr
        env = 0.2 + 0.8 * abs(math.sin(2 * math.pi * 3 * t))
        x = 0.6 * math.sin(2 * math.pi * 110 * t) + 0.25 * math.sin(2 * math.pi * 333 * t + 1)
        x += 0.1 * math.sin(2 * math.pi * 2731 * t)
        out.append(env * x)
    return out


def main():
    outdir = sys.argv[1]
    names = sys.argv[2:] or ["nano", "feather"]
    os.makedirs(outdir, exist_ok=True)
    torch.manual_seed(7)
    for name in names:
        lstm = name.startswith("lstm")
        cfg = lstm_cfg(name) if lstm else preset(name)
        n = n_weights(cfg)
        g = torch.Generator().manual_seed(11)
        w = (torch.randn(n, generator=g) * 0.45).tolist()
        if not lstm:
            w[-1] = 0.02  # head_scale is the last weight in classic files
        nam = {"version": "0.5.4", "architecture": "LSTM" if lstm else "WaveNet", "config": cfg,
               "weights": [round(v, 6) for v in w], "sample_rate": 48000,
               "metadata": {"name": f"ref {name}", "loudness": -12.0}}
        with open(os.path.join(outdir, f"{name}.nam"), "w") as f:
            json.dump(nam, f)
        model = init_from_nam(nam if lstm else legacy_to_current(nam))
        model.eval()
        x = torch.tensor(stimulus(4096), dtype=torch.float32)
        with torch.no_grad():
            y = model(x[None, :], pad_start=True)[0]
        with open(os.path.join(outdir, f"{name}_io.json"), "w") as f:
            json.dump({"x": [round(float(v), 7) for v in x],
                       "y": [round(float(v), 8) for v in y]}, f)
        print(name, n, "weights", float(y.abs().max()))


if __name__ == "__main__":
    main()
