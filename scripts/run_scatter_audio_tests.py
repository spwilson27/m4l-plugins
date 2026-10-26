#!/usr/bin/env python3
"""Scatter DSP checks in the tart VM (scripts/max_harness.py). Never launch Max on the host.

  dry       Mix 0 impulse leaves at sample 5120 and matches the input delayed 5120
  dry_spec  same in Spectral split mode (declared latency is mode-independent)
  hit       an impulse over Sens fires a draw (scope hit count) and a Ring tail
  nohit     a steady sine at Sens 0 never fires the onset
  draw_a/b  identical (seed, hit) cases render bit-identical aggregate metrics
  spec      Spectral mode hit fires and tails, finite output
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "scatter_probe.js")
SCOPE = "#0-scatterscope"

BASE_PARAMS = (
    "sens 0.45, seed 0, master 0.5, mix 1, splitmode 0, lock 0, reroll 0, "
    "snap 0.5, snapr 0.25, body 0.5, bodyr 0.25, metal 0.3, metalr 0.25, "
    "motion 0.35, motionr 0.25, space 0.3, spacer 0.2, grit 0.2, gritr 0.15, "
    "warp 0.25, warpr 0.2, ring 0.4, ringr 0.2"
)


def gen_text():
    with open(os.path.join(ROOT, "src", "scatter_core.genexpr"), encoding="utf-8") as f:
        return f.read()


def build(case):
    params = BASE_PARAMS + (", " + case["params"] if case.get("params") else "")
    boxes = [
        mh.msg("dev-params", params, 200, 40, 720),
        mh.box("dev-scope", f"buffer~ {SCOPE} @samps 64", 520, 100, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_text(), 200, 200),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
    ]
    events = []
    if case["mode"] == "impulse":
        boxes += [
            mh.box("dev-click", "click~", 700, 200, 50, outlettype=["signal"]),
            mh.box("dev-gain", "*~ 1", 700, 240, 50, numinlets=2, outlettype=["signal"]),
        ]
        lines += [mh.line("dev-click", 0, "dev-gain", 0)]
        events.append((case["arm"] + 40, "dev-click", 0, "bang"))
    else:
        boxes += [
            mh.box("dev-tone", "cycle~ 220", 700, 200, 80, numinlets=2, outlettype=["signal"]),
            mh.box("dev-gain", "*~ 0.4", 700, 240, 55, numinlets=2, outlettype=["signal"]),
        ]
        lines += [mh.line("dev-tone", 0, "dev-gain", 0)]
    lines += [
        mh.line("dev-gain", 0, "dev-gen", 0),
        mh.line("dev-gain", 0, "dev-gen", 1),
        mh.line("dev-gain", 0, "obj-record", 2),
    ]
    return boxes, lines, events


CASES = (
    {"name": "dry", "mode": "impulse", "arm": 80, "dur": 300, "params": "mix 0"},
    {"name": "dry_spec", "mode": "impulse", "arm": 80, "dur": 300, "params": "mix 0, splitmode 1"},
    {"name": "hit", "mode": "impulse", "arm": 80, "dur": 600, "params": "sens 1, master 0"},
    {"name": "nohit", "mode": "sine", "arm": 300, "dur": 400, "params": "sens 0"},
    {"name": "draw_a", "mode": "impulse", "arm": 80, "dur": 600, "params": "sens 1, seed 7, master 1"},
    {"name": "draw_b", "mode": "impulse", "arm": 80, "dur": 600, "params": "sens 1, seed 7, master 1"},
    {"name": "spec", "mode": "impulse", "arm": 80, "dur": 600, "params": "sens 1, master 0, splitmode 1"},
)


def main():
    only = sys.argv[1:]
    errors = []
    seen = {}
    for case in CASES:
        if only and case["name"] not in only:
            continue
        boxes, lines, events = build(case)
        print(f"--- {case['name']} ---", flush=True)
        meta = mh.run_case(
            f"scatter_{case['name']}", boxes, lines, probe_js=PROBE,
            settle_ms=case["arm"], dur_ms=case["dur"], channels=3,
            events=events or None, timeout=300,
        )
        seen[case["name"]] = meta
        print(
            f"lag {meta.get('lag')} meanAbs {meta.get('meanAbs')} outPeak {meta.get('outPeak')} "
            f"nan {meta.get('nan')} tail {meta.get('tail')} hit {meta.get('scopeHit')} "
            f"scopeTail {meta.get('scopeTail')} frame {meta.get('scopeFrame')}",
            flush=True,
        )
        if meta.get("nan", 1) != 0:
            errors.append(f"{case['name']}: non-finite samples")
        if not (float(meta.get("scopeFrame", -1)) > 0):
            errors.append(f"{case['name']}: scope frame did not advance (core did not run?)")
        if case["name"] in ("dry", "dry_spec"):
            if abs(float(meta.get("lag", -9999)) - 5120) > 1:
                errors.append(f"{case['name']}: lag {meta.get('lag')} is not 5120")
            if not (0.9 <= float(meta.get("outPeak", 0)) <= 1.05):
                errors.append(f"{case['name']}: peak {meta.get('outPeak')}")
            if float(meta.get("meanAbs", 1)) > 0.002:
                errors.append(f"{case['name']}: meanAbs {meta.get('meanAbs')} (dry is not the 5120 delay)")
        elif case["name"] in ("hit", "spec"):
            if not (float(meta.get("scopeHit", 0)) >= 1):
                errors.append(f"{case['name']}: no hit recorded (scopeHit {meta.get('scopeHit')})")
            if not (float(meta.get("tail", 0)) > 0.001):
                errors.append(f"{case['name']}: no tail energy (tail {meta.get('tail')})")
            if not (float(meta.get("meanAbs", 0)) > 0.02):
                errors.append(f"{case['name']}: output still matches the dry delay ({meta.get('meanAbs')})")
            if float(meta.get("outPeak", 99)) > 8:
                errors.append(f"{case['name']}: peak {meta.get('outPeak')} (the tail ran away)")
        elif case["name"] == "nohit":
            if float(meta.get("scopeHit", -1)) != 0:
                errors.append(f"nohit: steady sine fired the onset (scopeHit {meta.get('scopeHit')})")
    a, b = seen.get("draw_a"), seen.get("draw_b")
    if a is not None and b is not None:
        for key in ("lag", "outPeak", "meanAbs", "tail", "scopeHit"):
            if a.get(key) != b.get(key):
                errors.append(f"draw: repeated (seed, hit) differs in {key}: {a.get(key)} vs {b.get(key)}")
    if errors:
        print("FAILURES:")
        for e in errors:
            print("  " + e)
        sys.exit(1)
    print("All Scatter audio tests passed")


if __name__ == "__main__":
    main()
