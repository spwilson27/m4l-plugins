#!/usr/bin/env python3
"""Render Reciprocator through Ableton-bundled Max and verify its DSP & scope telemetry.

Cases:
  bypass     — Amount=0% passes the 0.25 sine wave at its original 0.25 amplitude
  flatten    — Two-level input (0.50 loud then 0.035 quiet, >23 dB apart) is flattened so
               both halves exit near Ceiling (-1 dB ≈ 0.89)
  gate_mute  — Input below Gate (-36 dB) is muted near 0.0 instead of being boosted to full scale
  rev_gate   — Reverse Gate (`revgate 1`, Gate = -18 dB ≈ 0.126): loud 0.50 input is muted,
               while quiet 0.035 input below Gate passes through and is boosted to Ceiling
  audiorate  — Ultra-fast Attack/Release (0.05 ms / 0.5 ms) waveshapes the sine wave
               (lowering crest factor vs a pure sine) with zero NaN and bounded Ceiling
  ceiling    — Hot 0.90 input with Hard Clip (`outmode 1`) and Ceiling = -6 dB (0.501) clamps at 0.5012
  limiter    — Peak Limiter (`outmode 2`) with Ceiling = -6 dB (0.501) clamps peak to ~0.501
               while preserving a cleaner sinusoidal crest factor (~1.38..1.42) than hard clipping
  invert     — Amount = 150% (1.5) ducks loud 0.50 input below quiet 0.035 input
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "reciprocator_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "reciprocator_probe.js")

DEFAULTS = "lookahead 1.5, detect 0.25, schp 40, sclp 16000, outmode 1, revgate 0"
SCOPE = "#0-recipscope"


def build_device(gen_code, case):
    """Device boxes/lines for one case. Records gen L/R (rec ch1/2) and the gen input (ch3)."""
    mode = case["mode"]
    boxes = [
        mh.msg("dev-params", case["params"], 200, 40, 680),
        mh.msg("dev-setbuf", f"setbuffer {SCOPE}", 200, 70, 190),
        mh.msg("dev-bind", f"scope {SCOPE}", 200, 100, 180),
        mh.box("dev-scope", f"buffer~ {SCOPE} @samps 32", 520, 100, 210, numoutlets=2,
               outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_code, 200, 200),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
    ]
    events = []
    src = "dev-gain"
    if mode == "sine":
        amp = case.get("amp", 0.25)
        freq = case.get("freq", 220)
        boxes += [mh.box("dev-tone", f"cycle~ {freq}", 700, 200, 80, numinlets=2, outlettype=["signal"]),
                  mh.box("dev-gain", f"*~ {amp}", 700, 240, 65, numinlets=2, outlettype=["signal"])]
        lines += [mh.line("dev-tone", 0, "dev-gain", 0)]
    elif mode == "impulse":
        boxes += [mh.box("dev-click", "click~", 700, 200, 50, outlettype=["signal"]),
                  mh.box("dev-gain", "*~ 0.5", 700, 240, 60, numinlets=2, outlettype=["signal"])]
        lines += [mh.line("dev-click", 0, "dev-gain", 0)]
        # Old: click fired 40 ms after record arm -> settle + 40 ms from DSP start.
        events.append((case["arm"] + 40, "dev-click", 0, "bang"))
    elif mode == "twotone":
        # Starts at 0.50 amplitude, then steps down to 0.035 at 350 ms after recording starts.
        boxes += [mh.box("dev-tone", "cycle~ 220", 700, 180, 80, numinlets=2, outlettype=["signal"]),
                  mh.box("dev-gain", "*~ 0.5", 700, 240, 55, numinlets=2, outlettype=["signal"]),
                  mh.box("dev-line", "line~ 0.5", 780, 240, 65, numinlets=2, numoutlets=2,
                         outlettype=["signal", "bang"])]
        lines += [mh.line("dev-tone", 0, "dev-gain", 0), mh.line("dev-line", 0, "dev-gain", 1)]
        events.append((case["arm"] + 350, "dev-line", 0, "0.035 10"))
    lines += [
        mh.line(src, 0, "dev-gen", 0),
        mh.line(src, 0, "dev-gen", 1),
        mh.line(src, 0, "obj-record", 2),
    ]
    return boxes, lines, events


def cases():
    def params(extra):
        return extra + ", " + DEFAULTS

    return (
        {
            "name": "bypass",
            "mode": "sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 350,
            "params": params("amount 0.0, gate -42, attack 2, release 60, wet 1, ceiling -1"),
        },
        {
            "name": "flatten",
            "mode": "twotone",
            "arm": 250,
            "dur": 800,
            "params": params("amount 1.0, gate -48, attack 1.0, release 25, wet 1, ceiling -1"),
        },
        {
            "name": "gate_mute",
            "mode": "sine",
            "amp": 0.0005,
            "arm": 250,
            "dur": 350,
            "params": params("amount 1.0, gate -36, attack 1.5, release 40, wet 1, ceiling -1"),
        },
        {
            "name": "rev_gate",
            "mode": "twotone",
            "arm": 250,
            "dur": 800,
            "params": "amount 1.0, gate -18, attack 1.0, release 20, wet 1, ceiling -1, lookahead 1.5, detect 0.25, schp 40, sclp 16000, outmode 1, revgate 1",
        },
        {
            "name": "audiorate",
            "mode": "sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 350,
            "params": "amount 1.0, gate -48, attack 0.05, release 0.5, wet 1, ceiling -1, lookahead 0, detect 0, schp 20, sclp 18000, outmode 0, revgate 0",
        },
        {
            "name": "ceiling",
            "mode": "sine",
            "amp": 0.90,
            "arm": 250,
            "dur": 350,
            "params": params("amount 1.0, gate -48, attack 0.5, release 40, wet 1, ceiling -6"),
        },
        {
            "name": "limiter",
            "mode": "sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 350,
            "params": "amount 1.0, gate -48, attack 50.0, release 250.0, wet 1, ceiling -6, lookahead 1.5, detect 1.0, schp 20, sclp 18000, outmode 2, revgate 0",
        },
        {
            "name": "invert",
            "mode": "twotone",
            "arm": 250,
            "dur": 800,
            "params": params("amount 1.5, gate -54, attack 1.0, release 25, wet 1, ceiling 0"),
        },
        {
            "name": "sc_filter",
            "mode": "sine",
            "freq": 55,
            "amp": 0.12,
            "arm": 250,
            "dur": 350,
            "params": "amount 1.0, gate -24, attack 1.5, release 40, wet 1, ceiling -1, lookahead 1.5, detect 0.25, schp 2000, sclp 16000, outmode 1, revgate 0",
        },
        {
            # Sweep 2: every control at its extreme with a full-scale input: finite, bounded by 0 dB ceiling.
            "name": "extremes",
            "mode": "sine",
            "amp": 1.0,
            "arm": 250,
            "dur": 350,
            "params": "amount 1.5, gate -72, attack 0.05, release 0.5, wet 1, ceiling 0, lookahead 10.0, detect 1.0, schp 20, sclp 18000, outmode 1, revgate 0",
        },
        {
            # Sweep 2: Mix 0 must be the (lookahead-delayed) dry exactly, whatever Amount / Ceiling / Gate do.
            "name": "mix0_dry",
            "mode": "sine",
            "amp": 0.25,
            "arm": 250,
            "dur": 350,
            "params": "amount 1.5, gate -6, attack 1.0, release 60, wet 0.0, ceiling -18, lookahead 0, detect 0.25, schp 60, sclp 12000, outmode 0, revgate 1",
        },
        {
            "name": "lookahead_align",
            "mode": "impulse",
            "arm": 250,
            "dur": 300,
            "params": "amount 0.0, gate -48, attack 1.5, release 40, wet 0.5, ceiling 0, lookahead 10.0, detect 0.25, schp 40, sclp 16000, outmode 1, revgate 0",
        },
    )


def env_max(env, start, end):
    chunk = env[start:end]
    return max(chunk) if chunk else 0.0


def run_case(gen_code, case):
    boxes, lines, events = build_device(gen_code, case)
    print(f"--- {case['name']} ---")
    meta = mh.run_case(
        f"recip_{case['name']}", boxes, lines, probe_js=PROBE_JS, probe_args=case["mode"],
        settle_ms=case["arm"], dur_ms=case["dur"], channels=3,
        mode="stepped" if events else "nrt", events=events, timeout=300,
    )
    meta["env"] = [meta.pop(f"env_{i}") for i in range(int(meta.get("envbins", 0)))]
    print(
        f"genL {meta.get('genL'):.4f} ctl {meta.get('ctl'):.4f} peak {meta.get('peak'):.4f} "
        f"crest {meta.get('crest'):.3f} scopeEnv {meta.get('scopeEnv'):.4f} "
        f"scopeOut {meta.get('scopeOut'):.4f} scopeGate {meta.get('scopeGate'):.3f} nan {meta.get('nan')}"
    )
    return meta


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    env = meta.get("env", [])
    if name == "bypass":
        if not (0.21 <= meta.get("peak", 0) <= 0.29):
            errors.append(f"bypass: expected ~0.25 peak, got {meta.get('peak')}")
    elif name == "flatten":
        loud_win = env_max(env, 80, 300)
        quiet_win = env_max(env, 450, 750)
        print(f"flatten loud_win={loud_win:.4f} quiet_win={quiet_win:.4f}")
        if not (0.72 <= loud_win <= 0.96):
            errors.append(f"flatten: loud section did not reach Ceiling (~0.89), got {loud_win}")
        if not (0.72 <= quiet_win <= 0.96):
            errors.append(f"flatten: quiet 0.035 section was not reciprocated to Ceiling (~0.89), got {quiet_win}")
        if abs(loud_win - quiet_win) > 0.14:
            errors.append(f"flatten: loud ({loud_win}) and quiet ({quiet_win}) sections were not leveled")
        if not (0.01 < meta.get("scopeOut", 0) <= 1.05):
            errors.append(f"flatten: scope buffer output peak not tracking ({meta.get('scopeOut')})")
    elif name == "gate_mute":
        steady = env_max(env, 80, 320)
        print(f"gate_mute steady={steady:.6f}")
        if steady > 0.005:
            errors.append(f"gate_mute: sub-gate noise should be muted, got {steady}")
        if meta.get("scopeGate", 1) > 0.1:
            errors.append(f"gate_mute: scopeGate should report closed, got {meta.get('scopeGate')}")
    elif name == "rev_gate":
        # Gate = -18 dB (~0.126): loud 0.50 section is ABOVE Gate so Reverse Gate mutes it;
        # quiet 0.035 section is BELOW Gate so Reverse Gate opens and boosts it to Ceiling (~0.89).
        loud_win = env_max(env, 120, 320)
        quiet_win = env_max(env, 480, 750)
        print(f"rev_gate loud_win={loud_win:.4f} quiet_win={quiet_win:.4f}")
        if loud_win > 0.03:
            errors.append(f"rev_gate: loud 0.50 section above Gate should be muted, got {loud_win}")
        if not (0.72 <= quiet_win <= 0.96):
            errors.append(f"rev_gate: quiet 0.035 section below Gate should pass and reach Ceiling (~0.89), got {quiet_win}")
    elif name == "audiorate":
        crest = meta.get("crest", 2.0)
        print(f"audiorate crest={crest:.4f} peak={meta.get('peak'):.4f}")
        if not (1.0 <= crest <= 1.33):
            errors.append(f"audiorate: expected squared/waveshaped crest factor < 1.33, got {crest}")
        # outmode 0 is a real tanh soft clip now (it used to fall through to the limiter, which pinned the peak at the ceiling)
        if meta.get("peak", 0) < 0.6 or meta.get("peak", 99) > 0.95:
            errors.append(f"audiorate: peak out of range ({meta.get('peak')})")
    elif name == "ceiling":
        pk = env_max(env, 60, 320)
        print(f"ceiling steady_peak={pk:.4f}")
        if not (0.44 <= pk <= 0.53):
            errors.append(f"ceiling: expected output clamped near -6 dB (0.501), got {pk}")
    elif name == "limiter":
        pk = env_max(env, 80, 320)
        crest = meta.get("crest", 0)
        print(f"limiter steady_peak={pk:.4f} crest={crest:.4f}")
        if not (0.45 <= pk <= 0.53):
            errors.append(f"limiter: expected peak limited near -6 dB (0.501), got {pk}")
        if not (1.36 <= crest <= 1.45):
            errors.append(f"limiter: expected clean sinusoidal crest factor (~1.41) vs hard clip, got {crest}")
    elif name == "invert":
        loud_win = env_max(env, 80, 300)
        quiet_win = env_max(env, 450, 750)
        print(f"invert loud_win={loud_win:.4f} quiet_win={quiet_win:.4f}")
        if not (quiet_win > loud_win + 0.10):
            errors.append(f"invert: expected quiet section ({quiet_win}) > loud section ({loud_win}) at Amount=150%")
    elif name == "sc_filter":
        # 55 Hz tone with SC HP = 2000 Hz is attenuated >30 dB in the sidechain detector,
        # falling below Gate (-24 dB) so the gate closes and mutes the output.
        steady = env_max(env, 80, 320)
        print(f"sc_filter steady={steady:.6f} scopeEnv={meta.get('scopeEnv'):.6f}")
        if steady > 0.02:
            errors.append(f"sc_filter: 55 Hz tone should be rejected by SC HP = 2000 Hz and gated, got {steady}")
    elif name == "extremes":
        print(f"extremes peak={meta.get('peak'):.4f}")
        if meta.get("peak", 99) > 1.001:
            errors.append(f"extremes: Hard ceiling 0 dB exceeded ({meta.get('peak')})")
    elif name == "mix0_dry":
        print(f"mix0_dry peak={meta.get('peak'):.4f}")
        if abs(meta.get("peak", 0) - 0.25) > 0.003:
            errors.append(f"mix0_dry: Mix 0 should pass the dry unchanged (0.25), got {meta.get('peak')}")
    elif name == "lookahead_align":
        # Because dry and wet share the same 10 ms lookahead delay line, wet=0.5
        # produces a single phase-aligned impulse (1 bin at ~0.7071) rather than a double echo.
        active_bins = [i for i, v in enumerate(env[:150]) if v > 0.15]
        print(f"lookahead_align active_bins={active_bins} peak={meta.get('peak'):.4f}")
        if not active_bins or not (10 <= active_bins[0] <= 60):
            errors.append(f"lookahead_align: expected delayed impulse in 10..60 ms, got bins {active_bins}")
        if len(active_bins) > 2:
            errors.append(f"lookahead_align: dry and wet paths are not phase-aligned ({active_bins})")


def main():
    with open(GEN_PATH, encoding="utf-8") as f:
        gen_code = f.read()
    only = set(sys.argv[1:])
    errors = []
    for case in cases():
        if only and case["name"] not in only:
            continue
        meta = run_case(gen_code, case)
        check(case["name"], meta, errors)
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("reciprocator audio checks passed")


if __name__ == "__main__":
    main()
