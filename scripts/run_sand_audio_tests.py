#!/usr/bin/env python3
"""Render Sand through the Ableton-bundled Max and check the wet path.

Cases:
  dry      — mix 0, output matches the 0.25 tone
  thru     — order 0, amount 0, full wet matches the tone
  deriv    — order 1 at 220 Hz is much quieter than the tone
  lift     — a high amount brings that derivative back up
  integ    — order -1 is louder than the bare derivative
  left     — a left-only input stays off the right channel
  lp       — a low low-pass attenuates a 2 kHz tone
  hp       — a low high-pass passes a 2 kHz tone
  hard     — hard clip holds a slammed signal at or under full scale
  limit    — the limiter holds it under its ceiling
  order15  — the top derivative order stays finite
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "sand_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "sand_probe.js")

BASE = (
    "amount 0, stages 1, dorder 0, soft 0, debrick 0, ftype 0, ffreq 18000, "
    "fpos 2, mix 100, outmode 0"
)


def device(gen_code, case):
    mode = case["mode"]
    freq = 2000 if mode == "sine2k" else 220
    boxes = [
        mh.gen_box("dev-gen", gen_code, 200, 200, numinlets=2, numoutlets=2),
        mh.msg("dev-params", case["params"], 200, 40, 760),
        mh.msg("dev-setbuf", "setbuffer #0-sandwave", 200, 70, 180),
        mh.msg("dev-bind", "wave #0-sandwave", 200, 100, 160),
        mh.box("dev-wave", "buffer~ #0-sandwave 100 2", 520, 100, 180, numoutlets=2,
               outlettype=["float", "bang"]),
        mh.box("dev-tone", f"cycle~ {freq}", 700, 200, 80, numinlets=2, outlettype=["signal"]),
        mh.box("dev-gain", "*~ 0.25", 700, 240, 60, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-tone", 0, "dev-gain", 0),
        mh.line("dev-gain", 0, "dev-gen", 0),
        # rec channels: 1 = gen L, 2 = gen R, 3 = control tone (probe reports genL/genR/ctl peaks)
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gain", 0, "obj-record", 2),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    if mode == "left":
        boxes.append(mh.box("dev-zero", "sig~ 0", 780, 240, 50, outlettype=["signal"]))
        lines.append(mh.line("dev-zero", 0, "dev-gen", 1))
    else:
        lines.append(mh.line("dev-gain", 0, "dev-gen", 1))
    return boxes, lines


def params(extra):
    return BASE + ", " + extra


def cases():
    return (
        {"name": "dry", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 0, dorder 0, amount 0")},
        {"name": "thru", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, outmode 0")},
        {"name": "deriv", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 0, outmode 0")},
        {"name": "lift", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 80, outmode 0")},
        {"name": "integ", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder -1, amount 0, outmode 0")},
        {"name": "left", "mode": "left", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, outmode 0")},
        {"name": "lp", "mode": "sine2k", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, ftype 0, ffreq 400, fpos 2, outmode 0")},
        {"name": "lp_diff", "mode": "sine2k", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, ftype 0, ffreq 400, fpos 1, outmode 0")},
        {"name": "hp", "mode": "sine2k", "arm": 200, "dur": 250, "params": params("mix 100, dorder 0, amount 0, ftype 2, ffreq 400, fpos 2, outmode 0")},
        {"name": "hard", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 140, outmode 1")},
        {"name": "limit", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 140, outmode 2")},
        {"name": "order5", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 5, amount 0, outmode 0")},
        {"name": "order8", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 8, amount 0, outmode 0")},
        {"name": "order15", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 15, amount 40, outmode 0")},
        {"name": "debrick", "mode": "sine", "arm": 200, "dur": 250, "params": params("mix 100, dorder 1, amount 80, debrick 100, outmode 0")},
    )


def run_case(gen_code, case):
    boxes, lines = device(gen_code, case)
    meta = mh.run_case(f"sand_{case['name']}", boxes, lines, probe_js=PROBE_JS,
                       probe_args=case["mode"], settle_ms=case["arm"], dur_ms=case["dur"],
                       channels=3, sr=mh.DEFAULT_SR, mode="nrt")
    print(f"--- {case['name']} ---")
    print(
        f"genL {meta.get('genL')} genR {meta.get('genR')} ctl {meta.get('ctl')} "
        f"peak {meta.get('peak')} corr {meta.get('corr')} wave {meta.get('wave')} "
        f"nan {meta.get('nan')} sr {meta.get('sr')} ch {meta.get('ch')} wall {meta.get('harness_wall_s'):.1f}s"
    )
    return meta


def require_ctl(name, meta, errors):
    ctl = meta.get("ctl", 0)
    if not (0.2 <= ctl <= 0.3):
        errors.append(f"{name}: control peak {ctl} (expected the 0.25 tone)")


def require_finite(name, meta, errors):
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    require_ctl(name, meta, errors)
    require_finite(name, meta, errors)
    peak = meta.get("peak", 0)
    if name == "dry":
        if not (0.2 <= meta.get("genL", 0) <= 0.3 and 0.2 <= meta.get("genR", 0) <= 0.3):
            errors.append(f"{name}: dry output should match the tone ({meta.get('genL')}, {meta.get('genR')})")
    elif name == "thru":
        if not (0.18 <= peak <= 0.32):
            errors.append(f"{name}: order 0 amount 0 should pass the tone ({peak})")
        if meta.get("wave", 0) < 0.02:
            errors.append(f"{name}: scope buffer is not receiving audio ({meta.get('wave')})")
    elif name == "deriv":
        if peak > 0.02:
            errors.append(f"{name}: first derivative of 220 Hz should be quiet ({peak})")
        meta["deriv_peak"] = peak
    elif name == "lift":
        if peak < 0.2:
            errors.append(f"{name}: amount should restore the derivative ({peak})")
    elif name == "integ":
        if peak < 0.2:
            errors.append(f"{name}: integrator should be louder than the derivative ({peak})")
    elif name == "left":
        if meta.get("genL", 0) < 0.15:
            errors.append(f"{name}: left channel is quiet ({meta.get('genL')})")
        if meta.get("genR", 0) > 0.02:
            errors.append(f"{name}: right channel leaked ({meta.get('genR')})")
    elif name in ("lp", "lp_diff"):
        if peak > 0.12:
            errors.append(f"{name}: low-pass did not cut 2 kHz ({peak})")
    elif name == "hp":
        if peak < 0.15:
            errors.append(f"{name}: high-pass removed 2 kHz ({peak})")
    elif name == "hard":
        if peak > 1.02:
            errors.append(f"{name}: hard clip exceeded full scale ({peak})")
        if peak < 0.2:
            errors.append(f"{name}: hard clip was silent ({peak})")
    elif name == "limit":
        if peak > 0.95:
            errors.append(f"{name}: limiter exceeded its ceiling ({peak})")
        if peak < 0.2:
            errors.append(f"{name}: limiter was silent ({peak})")
    elif name in ("order5", "order8", "order15"):
        if peak > 0.02:
            errors.append(f"{name}: a high order on a low sine should stay quiet ({peak})")
    elif name == "debrick":
        if peak > 0.85:
            errors.append(f"{name}: debrick did not ease the slammed derivative ({peak})")


def main():
    gen_path = sys.argv[1] if len(sys.argv) > 1 else GEN_PATH
    with open(gen_path, encoding="utf-8") as f:
        gen_code = f.read()
    errors = []
    results = {}
    only = set(sys.argv[2:])
    for case in cases():
        if only and case["name"] not in only:
            continue
        meta = run_case(gen_code, case)
        results[case["name"]] = meta
        check(case["name"], meta, errors)
    deriv = (results.get("deriv") or {}).get("peak", 1)
    lift = (results.get("lift") or {}).get("peak", 0)
    if deriv < 1 and lift and lift < deriv * 2:
        errors.append(f"amount did not raise the derivative ({deriv} -> {lift})")
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
