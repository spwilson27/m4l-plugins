#!/usr/bin/env python3
"""Max audio tests for Amp+'s tone stack and cabinet (the gen~, not the NAM external).

The NAM model itself loads on a background thread inside neural~ and is not part of
these cases. Run only in the tart VM: scripts/vm_ampplus.sh audio
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = open(os.path.join(ROOT, "src", "ampplus_core.genexpr"), encoding="utf-8").read()
PROBE = os.path.join(ROOT, "tests", "ampplus_probe.js")
SR = 48000


def case(name, freq, message):
    boxes = [
        mh.box("obj-sine", f"cycle~ {freq}", 40, 40, 90),
        mh.box("obj-amp", "*~ 0.2", 40, 80, 60, numinlets=2, numoutlets=1, outlettype=["signal"]),
        mh.gen_box("obj-gen", GEN, 40, 140, numinlets=1, numoutlets=2),
        mh.msg("obj-msg-params", message, 40, 200, 420),
    ]
    lines = [
        mh.line("obj-sine", 0, "obj-amp", 0),
        mh.line("obj-amp", 0, "obj-gen", 0),
        mh.line("obj-gen", 0, "obj-record", 0),
        mh.line("obj-gen", 0, "obj-mute-l", 0),
        mh.line("obj-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
        mh.line("obj-load", 0, "obj-msg-params", 0),
        mh.line("obj-msg-params", 0, "obj-gen", 0),
    ]
    print(f"--- {name} ---", flush=True)
    raw = mh.run_case(f"ampplus_{name}", boxes, lines, probe_js=PROBE, settle_ms=150, dur_ms=250,
                      channels=1, sr=SR, mode="nrt")
    print(f"rms {raw.get('rms')} peak {raw.get('peak')} nan {raw.get('nan')} frames {raw.get('frames')}", flush=True)
    return raw


def require(errors, name, raw, pred, detail):
    if raw.get("nan", 1) != 0:
        errors.append(f"{name}: non-finite samples")
    if not pred:
        errors.append(f"{name}: {detail} (rms {raw.get('rms')} peak {raw.get('peak')})")


def main():
    flat = "bass 50, mid 50, treble 50, presence 50, volume 100, cab 0, cabtype 1, mic 0, position 0"
    errors = []
    raw = case("flat", 440, flat)
    require(errors, "flat", raw, 0.13 < raw.get("rms", 0) < 0.16, "440 Hz at unity should stay near 0.141 rms")

    raw = case("bass_hi", 80, "bass 100, mid 50, treble 50, presence 50, volume 100, cab 0, cabtype 1, mic 0, position 0")
    require(errors, "bass_hi", raw, raw.get("rms", 0) > 0.25, "bass at 100 should lift 80 Hz")

    raw = case("bass_lo", 80, "bass 0, mid 50, treble 50, presence 50, volume 100, cab 0, cabtype 1, mic 0, position 0")
    require(errors, "bass_lo", raw, raw.get("rms", 0) < 0.09, "bass at 0 should cut 80 Hz")

    raw = case("treble_hi", 6000, "bass 50, mid 50, treble 100, presence 50, volume 100, cab 0, cabtype 1, mic 0, position 0")
    require(errors, "treble_hi", raw, raw.get("rms", 0) > 0.30, "treble at 100 should lift 6 kHz")

    raw = case("cab", 8000, "bass 50, mid 50, treble 50, presence 50, volume 100, cab 1, cabtype 3, mic 0, position 0")
    require(errors, "cab", raw, raw.get("rms", 0) < 0.07, "a 4x12 should darken 8 kHz")

    raw = case("mute", 440, "bass 50, mid 50, treble 50, presence 50, volume 0, cab 0, cabtype 1, mic 0, position 0")
    require(errors, "mute", raw, raw.get("rms", 0) < 0.001, "volume 0 should be silent")

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
