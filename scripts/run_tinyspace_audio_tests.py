#!/usr/bin/env python3
"""Render Tiny Space through the Ableton-bundled Max and check the wet path.

The harness uses buffer~ #0-tsconfig, the same name the device uses. Gen only
sees that buffer after `set tsconfig #0-tsconfig`. Without it, Mix at 100% is
silent because every delay line stays off.

Cases:
  unbound  — data is poked, gen is not bound, full wet stays near zero
  dry      — bound, wet 0, output matches the 0.25 tone
  wet      — bound, wet 1, both channels move and are not identical
  width0   — bound, width 0, left and right match
  sizes    — two impulses; a larger Size delays the second one more
  room     — impulse has an early hit and a tail, without huge samples
  comb     — impulse repeats near the delay period
  decay1   — full feedback rings, then falls, and never grows
  decay0   — zero feedback is gone well before the full-feedback tail
  metal    — size 0 comb still has a bright repeating tone after a second
  ring0..7 — every room model at size 0, damp 0, fbk 1 is audible at 8 s
             and 10 s, strictly decaying, and matched to the other models
  ringxf   — the same tail survives unequal delays with crossfeed at 25%
  decay50  — 50% feedback is a short delay: audible around 250 ms, silent by 1 s
  half0..7 — the same 50% tail on every room model
  fbk25/75/90 — the delay-style curve at the other knob positions
  damp0/damp1 — full feedback stays bright at damp 0 and goes dark at damp 1
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "tinyspace_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "tinyspace_probe.js")
SR = mh.DEFAULT_SR

# Shared tail of every param list. Knobs that a case cares about come first.
QUIET = "predly 0, modamt 0, xfeed 0, hp 20, lp 18000, duck 1"


def stimulus(case):
    """Sample-counted stimulus (no delay/metro). Returns (boxes, lines); `dev-stim` is the
    mono signal that feeds gen inlets 0/1 and record~ ch3. Sample n is 1-based from DSP start,
    the measured window starts right after `arm` ms (the settle period)."""
    mode = case["mode"]
    settle = mh.samples_for_ms(case["arm"], SR)
    boxes, lines = [], []
    if mode == "sine":
        boxes += [mh.box("dev-tone", "cycle~ 220", 700, 200, 80, numinlets=2, outlettype=["signal"]),
                  mh.box("dev-stim", "*~ 0.25", 700, 240, 60, numinlets=2, outlettype=["signal"])]
        lines.append(mh.line("dev-tone", 0, "dev-stim", 0))
    elif mode == "burst":
        # 220 Hz tone through a 1 -> 0 ramp over 150 ms that starts at the record start
        # (was `1, 0 150` into line~).
        ramp = mh.samples_for_ms(150, SR)
        env = mh.gen_box("dev-envgen",
                         "History n(0);\nn = n + 1;\n"
                         f"out1 = (n > {settle}) * max(0, 1 - (n - {settle} - 1) / {ramp});\n",
                         780, 200, numinlets=1, numoutlets=1)
        boxes += [mh.box("dev-tone", "cycle~ 220", 700, 180, 80, numinlets=2, outlettype=["signal"]),
                  mh.box("dev-gain", "*~ 0.25", 700, 220, 60, numinlets=2, outlettype=["signal"]),
                  env,
                  mh.box("dev-stim", "*~", 700, 260, 40, numinlets=2, outlettype=["signal"])]
        lines += [mh.line("dev-tone", 0, "dev-gain", 0), mh.line("dev-gain", 0, "dev-stim", 0),
                  mh.line("dev-envgen", 0, "dev-stim", 1)]
    else:
        # Single-sample click 1 ms into the measured window. The old `delay 40 -> click~` landed
        # at the very start of the take, and the envelope checks (first peak, early window)
        # are written for a click at about t = 0.
        at = settle + mh.samples_for_ms(1, SR) + 1
        boxes += [mh.gen_box("dev-click", f"History n(0);\nn = n + 1;\nout1 = n == {at};\n",
                             700, 200, numinlets=1, numoutlets=1),
                  mh.box("dev-stim", "*~ 0.25", 700, 240, 60, numinlets=2, outlettype=["signal"])]
        lines.append(mh.line("dev-click", 0, "dev-stim", 0))
    return boxes, lines


def device(gen_code, case):
    boxes, lines = stimulus(case)
    boxes += [
        mh.gen_box("dev-gen", gen_code, 200, 200, numinlets=2, numoutlets=2),
        mh.msg("dev-params", case["params"], 200, 40, 680),
        mh.msg("dev-setbuf", "setbuffer #0-tsconfig #0-tsmeters", 200, 70, 220),
        mh.box("dev-cfg", "buffer~ #0-tsconfig @samps 128", 520, 100, 210, numoutlets=2,
               outlettype=["float", "bang"]),
        mh.box("dev-meters", "buffer~ #0-tsmeters @samps 32", 520, 130, 210, numoutlets=2,
               outlettype=["float", "bang"]),
    ]
    lines += [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-stim", 0, "dev-gen", 0),
        mh.line("dev-stim", 0, "dev-gen", 1),
        # rec channels: 1 = gen L, 2 = gen R, 3 = control tone (probe reports genL/genR/ctl peaks)
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-stim", 0, "obj-record", 2),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    if case["bind"]:
        boxes.append(mh.msg("dev-bind", "cfg #0-tsconfig, meters #0-tsmeters", 200, 100, 340))
        lines += [mh.line("obj-load", 0, "dev-bind", 0), mh.line("dev-bind", 0, "dev-gen", 0)]
    return boxes, lines


def cases():
    def params(extra):
        return extra + ", " + QUIET

    return (
        {
            "name": "unbound",
            "mode": "sine",
            "config": "width",
            "bind": False,
            "arm": 400,
            "dur": 250,
            "params": params("size 0.55, damp 0.2, width 1, wet 1, fbk 0.62"),
        },
        {
            "name": "dry",
            "mode": "sine",
            "config": "single",
            "bind": True,
            "arm": 400,
            "dur": 250,
            "params": params("size 0.55, damp 0.2, width 1, wet 0, fbk 0.62"),
        },
        {
            "name": "wet",
            "mode": "sine",
            "config": "width",
            "bind": True,
            "arm": 400,
            "dur": 350,
            "params": params("size 0.55, damp 0.15, width 1, wet 1, fbk 0.55"),
        },
        {
            "name": "width0",
            "mode": "sine",
            "config": "width",
            "bind": True,
            "arm": 400,
            "dur": 350,
            "params": params("size 0.55, damp 0.15, width 0, wet 1, fbk 0.55"),
        },
        {
            "name": "size0",
            "mode": "impulse",
            "config": "single",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 0, width 0, wet 1, fbk 0"),
        },
        {
            "name": "size1",
            "mode": "impulse",
            "config": "single",
            "bind": True,
            "arm": 250,
            "dur": 1200,
            "params": params("size 1, damp 0, width 0, wet 1, fbk 0"),
        },
        {
            "name": "room",
            "mode": "impulse",
            "config": "room",
            "bind": True,
            "arm": 200,
            "dur": 600,
            "params": params("size 0.55, damp 0.15, width 0.7, wet 1, fbk 0.72, xfeed 0.25"),
        },
        {
            "name": "comb",
            "mode": "impulse",
            "config": "comb",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0.8, damp 0, width 0, wet 1, fbk 0.7"),
        },
        {
            "name": "decay1",
            "mode": "burst",
            "config": "decay",
            "bind": True,
            "arm": 200,
            "dur": 11000,
            "params": params("size 0.5, damp 0, width 0, wet 1, fbk 1"),
        },
        {
            "name": "decay0",
            "mode": "burst",
            "config": "decay",
            "bind": True,
            "arm": 200,
            "dur": 800,
            "params": params("size 0.5, damp 0, width 0, wet 1, fbk 0"),
        },
        {
            "name": "metal",
            "mode": "impulse",
            "config": "comb",
            "bind": True,
            "arm": 200,
            "dur": 1600,
            "params": params("size 0, damp 0, width 0, wet 1, fbk 1"),
        },
        {
            "name": "damp0",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 1"),
        },
        {
            "name": "damp1",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 1, width 1, wet 1, fbk 1"),
        },
    ) + tuple(
        {
            "name": f"ring{model}",
            "mode": "impulse",
            "config": f"ring{model}",
            "bind": True,
            "arm": 200,
            "dur": 11000,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 1"),
        }
        for model in range(8)
    ) + (
        {
            "name": "ringxf",
            "mode": "impulse",
            "config": "ringxf",
            "bind": True,
            "arm": 200,
            "dur": 11000,
            # xfeed is last so it overrides QUIET's xfeed 0.
            "params": params("size 0, damp 0, width 1, wet 1, fbk 1") + ", xfeed 0.25",
        },
        {
            "name": "decay50",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1600,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.5"),
        },
        {
            "name": "fbk25",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 1200,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.25"),
        },
        {
            "name": "fbk75",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 4500,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.75"),
        },
        {
            "name": "fbk90",
            "mode": "impulse",
            "config": "ring0",
            "bind": True,
            "arm": 200,
            "dur": 8000,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.9"),
        },
    ) + tuple(
        {
            "name": f"half{model}",
            "mode": "impulse",
            "config": f"ring{model}",
            "bind": True,
            "arm": 200,
            "dur": 1600,
            "params": params("size 0, damp 0, width 1, wet 1, fbk 0.5"),
        }
        for model in range(8)
    )


def vector(raw, prefix, count):
    """Rebuild a vector the probe wrote as `<prefix><i> <value>` lines (harness keeps 2-token lines)."""
    return [raw[f"{prefix}{i}"] for i in range(count) if f"{prefix}{i}" in raw]


def env_max(env, start, end):
    chunk = env[start:end]
    return max(chunk) if chunk else 0.0


def first_peak(env, start, end, floor):
    for i in range(start, min(end, len(env))):
        if env[i] >= floor:
            return i
    return -1


def run_case(gen_code, case):
    boxes, lines = device(gen_code, case)
    raw = mh.run_case(f"tinyspace_{case['name']}", boxes, lines, probe_js=PROBE_JS,
                      probe_args=f"{case['mode']} {case['config']}", settle_ms=case["arm"],
                      dur_ms=case["dur"], channels=3, sr=SR, mode="nrt")
    meta = {k: v for k, v in raw.items() if not (k.startswith("env") or k.startswith("sec"))}
    meta["env"] = vector(raw, "env", int(raw.get("frames", 0)) + 1)
    meta["sec"] = vector(raw, "sec", 12)
    print(f"--- {case['name']} ---")
    env = meta["env"]
    preview = " ".join(f"{v:.4f}" for v in env[:80])
    print(
        f"genL {meta.get('genL')} genR {meta.get('genR')} ctl {meta.get('ctl')} "
        f"peak {meta.get('peak')} corr {meta.get('corr')} meter {meta.get('meter')} nan {meta.get('nan')} "
        f"sr {meta.get('sr')} bins {len(env)} wall {meta.get('harness_wall_s'):.1f}s"
    )
    print(f"env {preview}")
    return meta


def require_ctl(name, meta, errors):
    ctl = meta.get("ctl", 0)
    if not (0.2 <= ctl <= 0.3):
        errors.append(f"{name}: control peak {ctl} (expected the 0.25 tone)")


def require_finite(name, meta, errors):
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    if meta.get("peak", 99) > 1.5:
        errors.append(f"{name}: peak {meta.get('peak')} is too hot")


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    require_ctl(name, meta, errors)
    require_finite(name, meta, errors)
    env = meta.get("env", [])
    if name == "unbound":
        if meta.get("genL", 1) > 0.005 or meta.get("genR", 1) > 0.005 or env_max(env, 0, 250) > 0.005:
            errors.append(f"{name}: full wet should be silent when the buffer is unbound ({meta.get('genL')}, {meta.get('genR')})")
    elif name == "dry":
        if not (0.2 <= meta.get("genL", 0) <= 0.3 and 0.2 <= meta.get("genR", 0) <= 0.3):
            errors.append(f"{name}: dry output should match the tone ({meta.get('genL')}, {meta.get('genR')})")
    elif name == "wet":
        if meta.get("genL", 0) < 0.02 or meta.get("genR", 0) < 0.02:
            errors.append(f"{name}: full wet is silent ({meta.get('genL')}, {meta.get('genR')})")
        if meta.get("corr", 1) > 0.92:
            errors.append(f"{name}: left and right are too similar for width 100% (corr {meta.get('corr')})")
        meter = meta.get("meter", -1)
        if not (0.02 < meter < 1.2):
            errors.append(f"{name}: delay meters are not tracking the audio ({meter})")
    elif name == "width0":
        if meta.get("genL", 0) < 0.02:
            errors.append(f"{name}: mono wet is silent")
        if meta.get("corr", 0) < 0.98:
            errors.append(f"{name}: width 0 should sum to mono (corr {meta.get('corr')})")
    elif name in ("size0", "size1"):
        first = first_peak(env, 0, 120, 0.05)
        meta["first"] = first
        print(f"{name} first peak {first} ms")
        if first < 0:
            errors.append(f"{name}: no delayed impulse")
    elif name == "room":
        early = env_max(env, 0, 40)
        tail = env_max(env, 80, 300)
        smear = sum(1 for v in env[:300] if v > 0.002)
        print(f"room early {early:.4f} tail {tail:.4f} bins {smear}")
        # A single-sample impulse is split across the active lines, so the
        # tail sits well below the 0.25 click and still far above silence.
        if early < 0.004:
            errors.append(f"{name}: no early delay energy ({early})")
        if tail < 0.0015:
            errors.append(f"{name}: tail is missing ({tail})")
        if smear < 12:
            errors.append(f"{name}: tail is a single spike, not a reverb ({smear} bins)")
    elif name == "comb":
        first = first_peak(env, 0, 40, 0.04)
        if first < 0:
            errors.append(f"{name}: no comb impulse")
        else:
            echo = env_max(env, first + 12, first + 24)
            gap = env_max(env, first + 4, first + 10)
            print(f"comb first {first} ms echo {echo:.4f} gap {gap:.4f}")
            if echo < 0.02 or echo < gap * 2:
                errors.append(f"{name}: no repeating delay (echo {echo}, gap {gap})")
    elif name == "decay1":
        burst = env_max(env, 0, 160)
        w2 = env_max(env, 1800, 2200)
        w6 = env_max(env, 5800, 6200)
        w10 = env_max(env, 9800, 10400)
        sec = meta.get("sec") or []
        w2 = sec[2] if len(sec) > 2 else w2
        w6 = sec[6] if len(sec) > 6 else w6
        w10 = sec[10] if len(sec) > 10 else w10
        print("decay1 per second " + " ".join(f"{v:.4f}" for v in sec))
        print(f"decay1 burst {burst:.4f} w2 {w2:.4f} w6 {w6:.4f} w10 {w10:.4f}")
        if burst < 0.02:
            errors.append(f"{name}: burst did not reach the tank ({burst})")
        if w2 < 0.03:
            errors.append(f"{name}: tail died before 2 s ({w2})")
        if w10 < 0.004:
            errors.append(f"{name}: tail is gone before 10 s ({w10})")
        if not (w2 > w6 > w10):
            errors.append(f"{name}: tail is not falling ({w2}, {w6}, {w10})")
        if max(w2, w6, w10) > burst * 1.15:
            errors.append(f"{name}: feedback grew after the burst")
        meta["w10"] = w10
    elif name == "decay0":
        burst = env_max(env, 0, 160)
        late = env_max(env, 250, 400)
        print(f"decay0 burst {burst:.4f} late {late:.4f}")
        if burst < 0.02:
            errors.append(f"{name}: burst did not reach the tank ({burst})")
        if late > 0.001:
            errors.append(f"{name}: zero feedback is still ringing ({late})")
    elif name == "metal":
        first = first_peak(env, 0, 40, 0.04)
        late = env_max(env, 1000, 1400)
        print(f"metal first {first} ms late {late:.4f}")
        if first < 0:
            errors.append(f"{name}: no comb impulse")
        elif late < env[first] * 0.45:
            errors.append(f"{name}: short comb died before 1 s ({late} vs {env[first]})")
    elif name == "damp0" or name == "damp1":
        early = env_max(env, 0, 40)
        late = env_max(env, 200, 700)
        meta["early"] = early
        meta["late"] = late
        print(f"{name} early {early:.4f} late {late:.4f}")
        if early < 0.004:
            errors.append(f"{name}: impulse did not reach the tank ({early})")
        if name == "damp0" and late < 0.04:
            errors.append(f"{name}: undamped tail died early ({late})")
        if name == "damp1" and late > 0.01:
            errors.append(f"{name}: full damp is still bright at 200 ms ({late})")
        if max(early, late) > 1.5:
            errors.append(f"{name}: damping went unstable ({max(early, late)})")
    elif name.startswith("ring"):
        burst = env_max(env, 0, 160)
        sec = meta.get("sec") or []
        w2 = sec[2] if len(sec) > 2 else 0.0
        w5 = sec[5] if len(sec) > 5 else 0.0
        w8 = sec[8] if len(sec) > 8 else 0.0
        w10 = sec[10] if len(sec) > 10 else 0.0
        meta["burst"] = burst
        meta["w2"] = w2
        meta["w5"] = w5
        meta["w8"] = w8
        meta["w10"] = w10
        print(" ".join(f"{v:.4f}" for v in sec))
        print(f"{name} burst {burst:.4f} w2 {w2:.4f} w5 {w5:.4f} w8 {w8:.4f} w10 {w10:.4f}")
        # ~27.5 s RT60 keeps about 13% at 8 s. The click peak is ~0.10,
        # so the absolute floors sit under that and above silence.
        if burst < 0.02:
            errors.append(f"{name}: impulse did not reach the tank ({burst})")
        if w8 <= 0.006:
            errors.append(f"{name}: tail is weak at 8 s ({w8})")
        if w10 <= 0.003:
            errors.append(f"{name}: tail is weak at 10 s ({w10})")
        if not (burst > w2 > w5 > w8):
            errors.append(f"{name}: tail is not strictly falling ({burst}, {w2}, {w5}, {w8})")
        if max(w2, w5, w8) > burst:
            errors.append(f"{name}: feedback grew after the impulse")
        if name != "ringxf" and not (w8 > w10):
            errors.append(f"{name}: tail rose between 8 s and 10 s ({w8}, {w10})")
    elif name == "decay50" or name.startswith("half"):
        burst = env_max(env, 0, 80)
        early = env_max(env, 180, 320)
        late = env_max(env, 1000, 1250)
        meta["burst"] = burst
        meta["early"] = early
        meta["late"] = late
        print(f"{name} burst {burst:.4f} early {early:.4f} late {late:.4f}")
        if burst < 0.02:
            errors.append(f"{name}: impulse did not reach the tank ({burst})")
        if early < 0.004:
            errors.append(f"{name}: 50% feedback has no tail at 250 ms ({early})")
        if late >= 0.002:
            errors.append(f"{name}: 50% feedback is still ringing at 1 s ({late})")
        if not (burst > early > late):
            errors.append(f"{name}: 50% tail is not falling ({burst}, {early}, {late})")
    elif name == "fbk25":
        burst = env_max(env, 0, 40)
        early = env_max(env, 40, 120)
        late = env_max(env, 400, 700)
        print(f"fbk25 burst {burst:.4f} early {early:.4f} late {late:.4f}")
        if early < 0.002:
            errors.append(f"{name}: 25% feedback died before 100 ms ({early})")
        if late >= 0.002:
            errors.append(f"{name}: 25% feedback is still ringing at 0.5 s ({late})")
    elif name == "fbk75":
        burst = env_max(env, 0, 80)
        mid = env_max(env, 800, 1200)
        late = env_max(env, 3500, 4200)
        print(f"fbk75 burst {burst:.4f} mid {mid:.4f} late {late:.4f}")
        if mid < 0.003:
            errors.append(f"{name}: 75% feedback is already gone at 1 s ({mid})")
        if late >= 0.002:
            errors.append(f"{name}: 75% feedback is still ringing at 3.5 s ({late})")
        if not (burst > mid > late):
            errors.append(f"{name}: 75% tail is not falling ({burst}, {mid}, {late})")
    elif name == "fbk90":
        sec = meta.get("sec") or []
        burst = env_max(env, 0, 80)
        w2 = sec[2] if len(sec) > 2 else 0.0
        w4 = sec[4] if len(sec) > 4 else 0.0
        w7 = sec[7] if len(sec) > 7 else 0.0
        print("fbk90 per second " + " ".join(f"{v:.4f}" for v in sec))
        print(f"fbk90 burst {burst:.4f} w2 {w2:.4f} w4 {w4:.4f} w7 {w7:.4f}")
        if w2 < 0.008:
            errors.append(f"{name}: 90% feedback is quiet at 2 s ({w2})")
        if w7 >= 0.002:
            errors.append(f"{name}: 90% feedback is still loud at 7 s ({w7})")
        if not (burst > w2 > w4 > w7):
            errors.append(f"{name}: 90% tail is not falling ({burst}, {w2}, {w4}, {w7})")


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
    high = results.get("decay1") or {}
    low = results.get("decay0") or {}
    if high and low and high.get("w10", 0) < 0.004:
        errors.append("full feedback died as fast as zero feedback")
    small = results.get("size0") or {}
    large = results.get("size1") or {}
    ring_levels = []
    for model in range(8):
        meta = results.get(f"ring{model}") or {}
        if "w8" in meta:
            ring_levels.append((model, meta["w8"]))
    if len(ring_levels) == 8:
        vals = [level for _model, level in ring_levels]
        lo = min(vals)
        hi = max(vals)
        print(
            "ring8s "
            + " ".join(f"m{model}:{level:.4f}" for model, level in ring_levels)
            + f"  range {lo:.4f}..{hi:.4f}"
        )
        if lo <= 0 or hi / lo > 1.25:
            errors.append(f"room models do not share an 8 s level ({lo} .. {hi})")
    half_levels = []
    for model in range(8):
        meta = results.get(f"half{model}") or {}
        if "early" in meta:
            half_levels.append((model, meta["early"]))
    if len(half_levels) == 8:
        vals = [level for _model, level in half_levels]
        lo = min(vals)
        hi = max(vals)
        print(
            "half250ms "
            + " ".join(f"m{model}:{level:.4f}" for model, level in half_levels)
            + f"  range {lo:.4f}..{hi:.4f}"
        )
        if lo <= 0 or hi / lo > 1.35:
            errors.append(f"room models do not share a 50% tail ({lo} .. {hi})")
    bright = results.get("damp0") or {}
    dark = results.get("damp1") or {}
    if "late" in bright and "late" in dark:
        print(f"damp late bright {bright['late']:.4f} dark {dark['late']:.4f}")
        if not (dark["late"] < bright["late"] * 0.25):
            errors.append(
                f"damp did not darken the tail ({dark['late']} vs {bright['late']})"
            )
    if small.get("first", -1) >= 0 and large.get("first", -1) >= 0:
        extra = large["first"] - small["first"]
        print(f"size delay {small['first']} ms -> {large['first']} ms")
        if extra < 20:
            errors.append(f"Size did not lengthen the delay ({small['first']} ms vs {large['first']} ms)")
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
