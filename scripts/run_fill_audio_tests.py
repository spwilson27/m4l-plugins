#!/usr/bin/env python3
"""Fill DSP checks in the tart VM (scripts/max_harness.py). Never launch Max on the host.

  identity    an impulse leaves at sample 1536 and matches the input
  dry         a sine outside the fill matches that same delay
  resonator   Strike 100% inside the fill no longer matches the dry delay
  pitch       Tune +12 in Pitch mode moves a 220 Hz body toward 440 Hz
  beater      Beater 0 removes the click of an impulse
  kick        Body Kick is not the Tom identity
  tuneopen    Tune +7 in Resonator mode moves a sine (Strike stays 0)
  damp        Damp 100% darkens the body with Strike at 0
  exp         Experimental page 1 plays the poked bank instead of the dry delay
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "fill_probe.js")
SCOPE = "#0-fillscope"


def gen_text():
    parts = []
    for name in ("fill_conv.genexpr", "fill_core.genexpr"):
        with open(os.path.join(ROOT, "src", name), encoding="utf-8") as f:
            parts.append(f.read())
    return "\n".join(parts)


def build(case):
    boxes = [
        mh.msg("dev-params", case["params"], 200, 40, 720),
        mh.msg("dev-bind", f"fillbody #0-fillbody, fillair #0-fillair, scope {SCOPE}, fillbank #0-fillbank", 200, 70, 520),
        mh.box("dev-body", "buffer~ #0-fillbody @samps 16", 520, 70, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-air", "buffer~ #0-fillair @samps 16", 520, 130, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-scope", f"buffer~ {SCOPE} @samps 64", 520, 100, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-bank", "buffer~ #0-fillbank @samps 832", 520, 160, 240, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_text(), 200, 200),
    ]
    if case.get("bank") or case["name"] == "exp":
        boxes.append(mh.box("dev-bank-js", "js " + os.path.join(ROOT, "tests", "fill_bank_init.js"), 200, 160, 280))
        if case.get("bank"):
            boxes.append(mh.msg("dev-bank-msg", case["bank"], 200, 130, 180))
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
    ]
    if case.get("bank"):
        lines += [
            mh.line("obj-load", 0, "dev-bank-msg", 0),
            mh.line("dev-bank-msg", 0, "dev-bank-js", 0),
            mh.line("dev-bank-js", 0, "dev-gen", 0),
        ]
    elif case["name"] == "exp":
        lines += [
            mh.line("obj-load", 0, "dev-bank-js", 0),
            mh.line("dev-bank-js", 0, "dev-gen", 0),
        ]
    lines += [
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
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
    {"name": "identity", "mode": "impulse", "arm": 80, "dur": 200, "params": "wet 1, play 0, page 0, randamt 0, tune 0, tuner 0, strike 0, striker 0, beater 1, beaterr 0, metal 1, metalr 0, space 0, spacer 0, bmix 0, bmixr 0, amix 0, amixr 0"},
    {"name": "dry", "mode": "sine", "arm": 200, "dur": 300, "params": "wet 1, play 1, page 0, randamt 0, tune 0, tuner 0, strike 0, striker 0, beater 1, beaterr 0, metal 1, metalr 0, space 0, spacer 0, bmix 0, bmixr 0, amix 0, amixr 0"},
    {"name": "resonator", "mode": "sine", "arm": 250, "dur": 400, "params": "wet 1, play 1, page 0, randamt 0, mode 0, strike 1, striker 0, bmix 0, bmixr 0"},
    {"name": "pitch", "mode": "sine", "arm": 300, "dur": 400, "params": "wet 1, play 1, page 0, randamt 0, mode 1, tune 12, tuner 0, strike 0, striker 0, bmix 0, bmixr 0"},
    {"name": "beater", "mode": "impulse", "arm": 80, "dur": 200, "params": "wet 1, play 0, page 0, randamt 0, tune 0, tuner 0, strike 0, striker 0, beater 0, beaterr 0, metal 1, metalr 0, space 0, spacer 0, bmix 0, bmixr 0, amix 0, amixr 0, bmodel 0, amodel 0"},
    {"name": "kick", "mode": "impulse", "arm": 80, "dur": 200, "params": "wet 1, play 0, page 0, randamt 0, tune 0, tuner 0, strike 0, striker 0, beater 1, beaterr 0, metal 1, metalr 0, space 0, spacer 0, bmix 0, bmixr 0, amix 0, amixr 0, bmodel 2, amodel 0"},
    {"name": "tuneopen", "mode": "sine", "arm": 250, "dur": 400, "params": "wet 1, play 1, page 0, randamt 0, mode 0, tune 7, tuner 0, strike 0, striker 0, bmix 0, bmixr 0, bmodel 0"},
    {"name": "damp", "mode": "impulse", "arm": 80, "dur": 200, "params": "wet 1, play 0, page 0, randamt 0, tune 0, tuner 0, strike 0, striker 0, damp 1, dampr 0, beater 1, beaterr 0, metal 1, metalr 0, space 0, spacer 0, bmix 0, bmixr 0, amix 0, amixr 0, bmodel 0, amodel 0"},
    {"name": "metal", "mode": "impulse", "arm": 80, "dur": 200, "params": "wet 1, play 0, page 0, randamt 0, tune 0, tuner 0, strike 0, striker 0, damp 0, dampr 0, beater 1, beaterr 0, metal 0, metalr 0, space 0, spacer 0, bmix 0, bmixr 0, amix 0, amixr 0, bmodel 0, amodel 0"},
    {"name": "space", "mode": "impulse", "arm": 80, "dur": 200, "params": "wet 1, play 0, page 0, randamt 0, tune 0, tuner 0, strike 0, striker 0, damp 0, dampr 0, beater 1, beaterr 0, metal 1, metalr 0, space 12, spacer 0, bmix 0, bmixr 0, amix 0, amixr 0, bmodel 0, amodel 0"},
    {"name": "exp", "mode": "sine", "arm": 250, "dur": 400, "params": "wet 1, play 1, page 1, bankgen 1, randamt 0"},
    {"name": "exp_low", "mode": "impulse", "arm": 40, "dur": 450, "bank": "bank 90 0.28", "params": "wet 1, play 1, page 1, bankgen 1"},
    {"name": "exp_high", "mode": "impulse", "arm": 40, "dur": 450, "bank": "bank 1400 0.28", "params": "wet 1, play 1, page 1, bankgen 1"},
    {"name": "exp_short", "mode": "impulse", "arm": 40, "dur": 450, "bank": "bank 180 0.03", "params": "wet 1, play 1, page 1, bankgen 1"},
    {"name": "exp_long", "mode": "impulse", "arm": 40, "dur": 450, "bank": "bank 180 0.45", "params": "wet 1, play 1, page 1, bankgen 1"},
)


def main():
    only = sys.argv[1:]
    errors = []
    for case in CASES:
        if only and case["name"] not in only:
            continue
        boxes, lines, events = build(case)
        print(f"--- {case['name']} ---", flush=True)
        meta = mh.run_case(
            f"fill_{case['name']}", boxes, lines, probe_js=PROBE,
            settle_ms=case["arm"], dur_ms=case["dur"], channels=3,
            events=events or None, timeout=300,
        )
        print(
            f"lag {meta.get('lag')} meanAbs {meta.get('meanAbs')} outPeak {meta.get('outPeak')} "
            f"nan {meta.get('nan')} g220 {meta.get('g220')} g440 {meta.get('g440')} zc {meta.get('zcHz')} tail {meta.get('tail')} scope {meta.get('scopeFrame')}",
            flush=True,
        )
        if meta.get("nan", 1) != 0:
            errors.append(f"{case['name']}: non-finite samples")
        if case["name"] == "identity":
            if abs(float(meta.get("lag", -999)) - 1536) > 1:
                errors.append(f"identity: lag {meta.get('lag')} is not 1536")
            if not (0.9 <= float(meta.get("outPeak", 0)) <= 1.05):
                errors.append(f"identity: peak {meta.get('outPeak')}")
            if float(meta.get("meanAbs", 1)) > 0.002:
                errors.append(f"identity: meanAbs {meta.get('meanAbs')}")
        elif case["name"] == "dry":
            if float(meta.get("meanAbs", 1)) > 0.01:
                errors.append(f"dry: meanAbs {meta.get('meanAbs')}")
        elif case["name"] == "resonator":
            if float(meta.get("meanAbs", 0)) < 0.02:
                errors.append(f"resonator: output still matches the dry delay ({meta.get('meanAbs')})")
            if float(meta.get("outPeak", 99)) > 8:
                errors.append(f"resonator: peak {meta.get('outPeak')} (the modes ran away)")
        elif case["name"] == "pitch":
            # Grain splices keep a long Goertzel window correlated with 220 Hz.
            # The zero-crossing rate is the transpose: +12 st of 220 Hz is about 440.
            zc = float(meta.get("zcHz", 0))
            if not (400 <= zc <= 500):
                errors.append(f"pitch: zero-crossing rate {zc} Hz, want about 440")
            if float(meta.get("outPeak", 0)) < 0.15:
                errors.append(f"pitch: peak {meta.get('outPeak')} (the shift went quiet)")
        elif case["name"] == "beater":
            # The click is most of an impulse, so Beater 0 drops the peak.
            # The leftover body is small, and meanAbs over the window stays near 0.
            if float(meta.get("outPeak", 1)) > 0.25:
                errors.append(f"beater: peak {meta.get('outPeak')} (the click was not removed)")
            if float(meta.get("outPeak", 0)) < 0.005:
                errors.append(f"beater: peak {meta.get('outPeak')} (the hit was silenced)")
        elif case["name"] in ("kick", "damp", "metal"):
            # An impulse is one sample. The error averaged over the window stays
            # near 0 even when the hit itself is clearly darker.
            if float(meta.get("outPeak", 1)) > 0.75:
                errors.append(f"{case['name']}: peak {meta.get('outPeak')} (the hit was not colored)")
            if float(meta.get("outPeak", 0)) < 0.02:
                errors.append(f"{case['name']}: peak {meta.get('outPeak')} (the hit was silenced)")
        elif case["name"] == "space":
            # The comb keeps the impulse peak and adds an echo, so meanAbs is tiny.
            # The echo moves energy out of the flat impulse spectrum.
            if float(meta.get("g220", 1)) > 0.85:
                errors.append(f"space: g220 {meta.get('g220')} (the comb did not move the spectrum)")
            if float(meta.get("outPeak", 0)) < 0.5:
                errors.append(f"space: peak {meta.get('outPeak')}")
        elif case["name"] == "exp_low":
            zc = float(meta.get("zcHz", 0))
            if not (40 <= zc <= 280):
                errors.append(f"exp_low: zero-crossing rate {zc} Hz, want about 90")
            if float(meta.get("outPeak", 0)) < 0.02:
                errors.append(f"exp_low: peak {meta.get('outPeak')}")
        elif case["name"] == "exp_high":
            zc = float(meta.get("zcHz", 0))
            if zc < 700:
                errors.append(f"exp_high: zero-crossing rate {zc} Hz, want well above the low bank")
            if float(meta.get("outPeak", 0)) < 0.02:
                errors.append(f"exp_high: peak {meta.get('outPeak')}")
        elif case["name"] == "exp_short":
            if float(meta.get("tail", 1)) > 0.012:
                errors.append(f"exp_short: tail {meta.get('tail')} (a 30 ms decay was still ringing)")
            if float(meta.get("outPeak", 0)) < 0.02:
                errors.append(f"exp_short: peak {meta.get('outPeak')}")
        elif case["name"] == "exp_long":
            if float(meta.get("tail", 0)) < 0.02:
                errors.append(f"exp_long: tail {meta.get('tail')} (a 0.45 s decay died early)")
            if float(meta.get("outPeak", 99)) > 8:
                errors.append(f"exp_long: peak {meta.get('outPeak')}")
        elif case["name"] in ("tuneopen", "exp"):
            if float(meta.get("meanAbs", 0)) < 0.02:
                errors.append(f"{case['name']}: output still matches the dry delay ({meta.get('meanAbs')})")
            if float(meta.get("outPeak", 0)) < 0.02:
                errors.append(f"{case['name']}: peak {meta.get('outPeak')} (the path went silent)")
            if float(meta.get("outPeak", 99)) > 8:
                errors.append(f"{case['name']}: peak {meta.get('outPeak')} (the path ran away)")
        if float(meta.get("scopeFrame", -1)) <= 0:
            errors.append(f"{case['name']}: scope frame did not move")
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        return 1
    print("fill audio ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
