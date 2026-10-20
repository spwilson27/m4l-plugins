#!/usr/bin/env python3
"""Render Envelope Trigger through Ableton-bundled Max and verify its detector & scope telemetry.

Cases:
  hits      — Five 0.8 tone bursts 200 ms apart (Thr -24 dB) fire exactly five notes with high
              velocity and pass the audio through unchanged
  scope     — 0.8 bursts every 100 ms fill the oscilloscope ring with ~0.8 min/max blocks and onset flags
  quiet     — The same bursts at 0.03 (-30 dB, below Thr) fire nothing
  velocity  — Bursts at 0.2 (-14 dB) fire five notes with mid-range velocity (Vel Lo 40 .. Vel Hi 127)
  sustain   — A steady 0.5 tone fires one note at its onset and never retriggers
  hold      — Bursts every 40 ms with Hold = 200 ms are thinned to a few notes, not one per burst
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "envtrig_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "envtrig_probe.js")

# kind 0 = burst train (first, every), 1 = sustained tone from `first`.
# Bursts rise over `atk` ms and fall 60 dB over `decay` ms.
SOURCE_GEN = """
burst_env(dt, atk, decay) {
	rise = (atk > 0.001) ? clip(dt / atk, 0, 1) : 1;
	fall = exp(-max(dt - atk, 0) * 6.9078 / max(decay, 1));
	return (dt < 0) ? 0 : rise * fall;
}

Param go(0);
Param kind(0);
Param amp(0.8);
Param freq(1000);
Param first(40);
Param every(200);
Param atk(0);
Param decay(80);

History n(0);
History ph(0);

n = (go > 0.5) ? n + 1 : 0;
tms = n * 1000 / samplerate;
ph = wrap(ph + freq / samplerate, 0, 1);
tone = sin(6.28318531 * ph);
local = tms - first;
dtTrain = local - floor(max(local, 0) / max(every, 1)) * max(every, 1);
train = burst_env((local < 0) ? -1 : dtTrain, atk, decay);
sus = clip(local / 2, 0, 1);
sig = (kind < 0.5) ? tone * train : tone * sus;
out1 = (go > 0.5) ? sig * amp : 0;
"""

DEFAULTS = "thr -24, sens 0.5, holdms 60, velmin 40, velmax 127"



def build_device(gen_code, case):
    # Device-only boxes. The scaffold records from DSP start, so the source's `go 1` is sent at
    # load and the source clock (gen sample counter) starts at the same sample as the recording
    # (settle_ms = 0, same alignment as the old arm/go pair).
    boxes = [
        mh.msg("dev-params", case["params"], 200, 40, 680),
        mh.msg("dev-setbuf", "setbuffer #0-trigscope", 200, 70, 190),
        mh.msg("dev-bind", "scope #0-trigscope", 200, 100, 180),
        mh.box("dev-scope", "buffer~ #0-trigscope @samps 800", 520, 100, 210, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-gen", gen_code, 200, 220, numinlets=2, numoutlets=4),
        # rec ch1 = gate * velocity; ch2 = audio out L; ch3 = test source (pass-through reference)
        mh.box("dev-gv0", "*~", 200, 300, 40, numinlets=2, outlettype=["signal"]),
        # Test signals are generated at audio rate in gen (sample-counted), never by metro.
        mh.gen_box("dev-src", SOURCE_GEN, 700, 220, numinlets=1, numoutlets=1),
        mh.msg("dev-src-params", case["source"] + ", go 1", 700, 160, 380),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-gen", 2, "dev-gv0", 0),
        mh.line("dev-gen", 3, "dev-gv0", 1),
        mh.line("dev-gv0", 0, "obj-record", 0),
        mh.line("dev-gen", 0, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("obj-load", 0, "dev-src-params", 0),
        mh.line("dev-src-params", 0, "dev-src", 0),
        mh.line("dev-src", 0, "dev-gen", 0),
        mh.line("dev-src", 0, "dev-gen", 1),
        mh.line("dev-src", 0, "obj-record", 2),
        mh.line("dev-src", 0, "obj-mute-r", 0),
    ]
    return boxes, lines


def cases():
    def params(extra=""):
        return DEFAULTS + (", " + extra if extra else "")

    return (
        {"name": "hits", "dur": 1000, "params": params(),
         "source": "kind 0, amp 0.8, freq 1000, first 40, every 200, atk 0, decay 80"},
        {"name": "scope", "dur": 600, "params": params(),
         "source": "kind 0, amp 0.8, freq 1000, first 40, every 100, atk 0, decay 60"},
        {"name": "quiet", "dur": 1000, "params": params(),
         "source": "kind 0, amp 0.03, freq 1000, first 40, every 200, atk 0, decay 80"},
        {"name": "velocity", "dur": 1000, "params": params(),
         "source": "kind 0, amp 0.2, freq 1000, first 40, every 200, atk 0, decay 80"},
        {"name": "sustain", "dur": 900, "params": params(),
         "source": "kind 1, amp 0.5, freq 220, first 50"},
        {"name": "hold", "dur": 1000, "params": params("holdms 200"),
         "source": "kind 0, amp 0.8, freq 1000, first 40, every 40, atk 0, decay 30"},
    )


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        parts = raw.split()
        if not parts:
            continue
        key = parts[0]
        if key.startswith("lane"):
            meta[key] = [(int(p.split("@")[0]), int(p.split("@")[1])) for p in parts[1:]]
        else:
            meta[key] = float(parts[1])
    return meta


def run_case(gen_code, case):
    b, l = build_device(gen_code, case)
    print(f"--- {case['name']} ---")
    # All envtrig outputs reach the recording as signals (gate * velocity), so no scheduler
    # objects (makenote/midiout) are involved: plain "nrt" mode is accurate.
    res = (mh.run_case(f"envtrig_{case['name']}", b, l, probe_js=PROBE_JS, probe_args=case["name"],
                      settle_ms=0, dur_ms=case["dur"], channels=3))
    meta = {}
    for k, v in res.items():
        if k.startswith("lane"):
            # probe writes "vel@ms,vel@ms" (one token, the harness parses 2-token lines) or "none"
            toks = [] if v == "none" else str(v).split(",")
            meta[k] = [(int(p.split("@")[0]), int(p.split("@")[1])) for p in toks]
        else:
            meta[k] = v
    meta.setdefault("lane0", [])
    print(f"notes {meta['lane0']} ringMax {meta.get('ringMax', 0):.3f} ringOnsets {meta.get('ringOnsets')} "
          f"genL {meta.get('genL'):.4f} ctl {meta.get('ctl'):.4f} scopeFires0 {meta.get('scopeFires0')} nan {meta.get('nan')}")
    return meta


def check(name, meta, errors):
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    l0 = meta.get("lane0", [])
    vels0 = [v for v, _t in l0]
    if name == "hits":
        if len(l0) != 5:
            errors.append(f"hits: expected 5 notes on lane 0, got {len(l0)} {l0}")
        if vels0 and min(vels0) < 105:
            errors.append(f"hits: 0.8 bursts should fire high velocity (~120), got {vels0}")
        if abs(meta.get("genL", 0) - meta.get("ctl", -1)) > 1e-3:
            errors.append(f"hits: audio must pass through unchanged (out {meta.get('genL')} vs in {meta.get('ctl')})")
        if meta.get("scopeFires0", 0) < 5:
            errors.append(f"hits: scope fire counter should reach 5, got {meta.get('scopeFires0')}")

    elif name == "scope":
        # Bursts every 100 ms keep at least one onset inside the 186 ms ring whenever it is read
        # (the source keeps playing after recording stops).
        if not (0.6 <= meta.get("ringMax", 0) <= 0.85):
            errors.append(f"scope: oscilloscope ring should hold ~0.8 peaks, got {meta.get('ringMax')}")
        if meta.get("ringOnsets", 0) < 1:
            errors.append(f"scope: oscilloscope ring should flag onsets, got {meta.get('ringOnsets')}")
    elif name == "quiet":
        if l0:
            errors.append(f"quiet: bursts below threshold must not fire, got {l0}")
    elif name == "velocity":
        if len(l0) != 5:
            errors.append(f"velocity: expected 5 notes, got {len(l0)} {l0}")
        if vels0 and not all(60 <= v <= 95 for v in vels0):
            errors.append(f"velocity: -14 dB bursts should land mid-range (~76), got {vels0}")
    elif name == "sustain":
        if len(l0) != 1:
            errors.append(f"sustain: a steady tone must fire exactly once, got {l0}")
        elif not (40 <= l0[0][1] <= 70):
            errors.append(f"sustain: the onset note should fire near 50 ms, got {l0[0][1]} ms")
    elif name == "hold":
        if not (2 <= len(l0) <= 6):
            errors.append(f"hold: 200 ms lockout should thin ~24 bursts to 2..6 notes, got {len(l0)} {l0}")


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
    print("envtrig audio checks passed")


if __name__ == "__main__":
    main()
