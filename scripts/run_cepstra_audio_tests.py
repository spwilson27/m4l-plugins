#!/usr/bin/env python3
"""Render Cepstra through Ableton-bundled Max and verify its DSP & telemetry.

Stimulus: 120 Hz impulse train through three formant resonators (700 / 1220 / 2600 Hz), optionally with noise.

Cases:
  neutral        — defaults (shift 0, levels 100%, gate 0, mix 100%): null test vs input delayed by N + N/8
  neutral_q0     — same at Quality 1k
  neutral_q2     — same at Quality 4k
  mix0           — wet 0 equals the delayed dry signal
  shift12        — Mid +12 st moves the spectral centroid upward while f0 stays at 120 Hz
  gate_off/gate  — Gate 40% removes noise between partials compared to Gate 0%
  auto           — Auto cutoff: scope reports a voiced f0 near 120 Hz and L = k * period
  midi           — MIDI cutoff: midinote 47 (B2) sets L = k * (sr / 123.47 Hz)
  qswitch        — Quality 2k -> 4k mid-run: no NaN/inf, output recovers
  silence        — silent input sleeps: output is exactly silent, scope level 0
  perf           — Quality 4k with shifted formants: audio CPU stays well below real-time limits
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "cepstra_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "cepstra_probe.js")
HARNESS = os.path.join(ROOT, "tests", "cepstra_harness.maxpat")
RESULT = "/tmp/cepstra_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)

DEFAULTS = "res 0.57, midshift 0, sideshift 0, gate 0, fmtlevel 1, harmlevel 1, resmode 0, quality 1, wet 1, midinote -1"
LTOT = {0: 1152, 1: 2304, 2: 4608}


def box(obj_id, text, x, y, w, h, **extra):
    b = {
        "id": obj_id,
        "maxclass": extra.pop("maxclass", "newobj"),
        "numinlets": extra.pop("numinlets", 1),
        "numoutlets": extra.pop("numoutlets", 1),
        "outlettype": extra.pop("outlettype", [""]),
        "patching_rect": [float(x), float(y), float(w), float(h)],
        "text": text,
    }
    b.update(extra)
    return {"box": b}


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def build_harness(gen_code, case):
    q = case.get("q", 1)
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 1200", 40, 80, 80, 20, numinlets=2),
        box("obj-dsp", "; dsp start", 40, 120, 80, 20, maxclass="message", numinlets=2),
        box("obj-del-arm", f"delay {case['arm']}", 40, 160, 80, 20, numinlets=2),
        box("obj-mark", "mark", 120, 200, 40, 20, maxclass="message", numinlets=2),
        box("obj-rec-on", "1", 40, 200, 30, 20, maxclass="message", numinlets=2),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2),
        box("obj-rec-off", "0", 40, 280, 30, 20, maxclass="message", numinlets=2),
        box("obj-del-analyze", "delay 120", 40, 360, 70, 20, numinlets=2),
        box("obj-analyze", f"analyze {case['dur']}", 120, 360, 90, 20, maxclass="message", numinlets=2),
        box("obj-quit", "; max quit", 40, 420, 70, 20, maxclass="message", numinlets=2),
        box("obj-params", case["params"], 200, 40, 680, 20, maxclass="message", numinlets=2),
        box("obj-setbuf", "setbuffer #0-cepscope", 200, 70, 250, 20, maxclass="message", numinlets=2),
        box("obj-bind", "scope #0-cepscope", 200, 100, 250, 20, maxclass="message", numinlets=2),
        box("obj-scope", "buffer~ #0-cepscope @samps 272", 520, 100, 220, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-src", "buffer~ src 1000 1", 520, 130, 150, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 2000 2", 520, 160, 150, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recsize", "size 2000", 520, 185, 75, 20, maxclass="message", numinlets=2),
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [200.0, 200.0, 300.0, 80.0],
            }
        },
        box("obj-record", "record~ rec 2", 200, 300, 90, 20, numinlets=3, numoutlets=1),
        box("obj-mute-l", "*~ 0", 200, 390, 45, 20, numinlets=2, outlettype=["signal"]),
        box("obj-dac", "dac~", 200, 430, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box("obj-js", f"js {PROBE_JS} {case.get('stim', 'vowel')} {LTOT[q]}", 200, 470, 420, 20,
            numinlets=5, numoutlets=3, outlettype=["bang", "bang", ""]),
        box("obj-sig1", "phasor~ 1", 700, 200, 65, 20, numinlets=2, outlettype=["signal"]),
        box("obj-groove", "wave~ src", 700, 240, 90, 20, numinlets=3, numoutlets=2, outlettype=["signal", "signal"]),
        box("obj-gain", f"*~ {case.get('gain', 1.0)}", 700, 280, 65, 20, numinlets=2, outlettype=["signal"]),
        box("obj-sr-msg", "44100", 40, 560, 50, 20, maxclass="message", numinlets=2),
        box("obj-sr-set", "adstatus sr", 100, 560, 90, 20, numinlets=2, outlettype=["float"]),
        box("obj-del-setbuf", "delay 500", 200, 20, 70, 20, numinlets=2),
        box("obj-metro", "metro 100", 40, 480, 70, 20, numinlets=2),
        box("obj-adstatus", "adstatus cpu", 40, 510, 90, 20, numinlets=2, outlettype=["float"]),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-recsize", 0),
        line("obj-recsize", 0, "obj-recbuf", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-sr-msg", 0),
        line("obj-sr-msg", 0, "obj-sr-set", 0),
        line("obj-load", 0, "obj-del-setbuf", 0),
        line("obj-del-setbuf", 0, "obj-setbuf", 0),
        line("obj-load", 0, "obj-bind", 0),
        line("obj-bind", 0, "obj-gen", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-dsp", 0, "obj-metro", 0),
        line("obj-metro", 0, "obj-adstatus", 0),
        line("obj-adstatus", 0, "obj-js", 4),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-mark", 0),
        line("obj-mark", 0, "obj-js", 3),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-analyze", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-setbuf", 0, "obj-js", 3),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-analyze", 0, "obj-js", 3),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-gain", 0, "obj-record", 1),
        line("obj-gen", 0, "obj-mute-l", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-sig1", 0, "obj-groove", 0),
        line("obj-groove", 0, "obj-gain", 0),
        line("obj-gain", 0, "obj-gen", 0),
        line("obj-gain", 0, "obj-gen", 1),
    ]
    if case.get("late"):
        late_ms, late_msg = case["late"]
        boxes.append(box("obj-del-late", f"delay {late_ms}", 40, 320, 80, 20, numinlets=2))
        boxes.append(box("obj-late", late_msg, 120, 320, 120, 20, maxclass="message", numinlets=2))
        lines.append(line("obj-del-dsp", 0, "obj-del-late", 0))
        lines.append(line("obj-del-late", 0, "obj-late", 0))
        lines.append(line("obj-late", 0, "obj-gen", 0))

    doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 40.0, 1000.0, 560.0],
            "boxes": boxes,
            "lines": lines,
        }
    }
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def cases():
    def p(extra=""):
        return DEFAULTS + (", " + extra if extra else "")

    base = {"arm": 700, "dur": 600}
    return (
        dict(base, name="neutral", params=p()),
        dict(base, name="neutral_q0", q=0, params=p("quality 0")),
        dict(base, name="neutral_q2", q=2, params=p("quality 2"), arm=900),
        dict(base, name="mix0", params=p("wet 0")),
        dict(base, name="shift12", params=p("midshift 12")),
        dict(base, name="gate_off", stim="vowelnoise", params=p()),
        dict(base, name="gate", stim="vowelnoise", params=p("gate 0.4")),
        dict(base, name="auto", params=p("resmode 1")),
        dict(base, name="midi", params=p("resmode 2, midinote 47")),
        dict(base, name="qswitch", q=2, params=p(), late=(300, "quality 2"), arm=900),
        dict(base, name="silence", stim="silent", params=p()),
        dict(base, name="perf", q=2, params=p("quality 2, midshift 7, sideshift -5, gate 0.2"), arm=900),
    )


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        if not raw.strip():
            continue
        key, val = raw.split(None, 1)
        meta[key] = float(val)
    return meta


def sane(meta, case):
    """The stimulus must have been recorded at the nominal pitch and a normal sample rate."""
    if meta.get("sr", 0) not in (44100.0, 48000.0, 88200.0, 96000.0):
        return False
    if case.get("stim") == "silent":
        return True
    return abs(meta.get("f0In", 0) - 120.0) < 4.0 and meta.get("refRms", 0) > 0.01


def run_case(gen_code, case):
    build_harness(gen_code, case)
    if os.path.exists(RESULT):
        os.remove(RESULT)
    recovery = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Crash Recovery")
    if os.path.isdir(recovery):
        subprocess.run(["rm", "-rf", recovery], check=False)

    # Max is single-instance: make sure the previous case's process is fully gone before launching.
    for _ in range(40):
        alive = subprocess.run(["pgrep", "-f", MAX_BIN], capture_output=True, text=True).stdout.strip()
        if not alive:
            break
        subprocess.run(["pkill", "-f", MAX_BIN], check=False)
        time.sleep(0.5)
    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 45
    while time.time() < deadline and not os.path.exists(RESULT):
        if proc.poll() is not None:
            break
        time.sleep(0.2)

    last_size = -1
    stable = 0
    while time.time() < deadline and stable < 2:
        if not os.path.exists(RESULT):
            break
        size = os.path.getsize(RESULT)
        if size > 0 and size == last_size:
            stable += 1
        else:
            stable = 0
            last_size = size
        time.sleep(0.15)

    if proc.poll() is None:
        try:
            proc.wait(timeout=6)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
    time.sleep(1.0)
    print(f"--- {case['name']} ---")
    if not os.path.exists(RESULT):
        print("NO RESULT FILE")
        return None
    meta = parse_result(open(RESULT).read())
    print(
        f"peak {meta.get('peak'):.4f} nullDb {meta.get('nullDb'):.1f} cent {meta.get('centIn'):.0f}->{meta.get('centOut'):.0f} "
        f"f0 {meta.get('f0In'):.1f}->{meta.get('f0Out'):.1f} valley {meta.get('valleyIn'):.1f}->{meta.get('valleyOut'):.1f} "
        f"scope[nz {meta.get('scopeNonZero'):.0f} L {meta.get('scopeL'):.1f} f0 {meta.get('scopeF0'):.1f} "
        f"lvl {meta.get('scopeLevel'):.3f} frame {meta.get('scopeFrame'):.0f} N {meta.get('scopeN'):.0f}] "
        f"rt x{meta.get('rtFactor'):.1f} cpu avg {meta.get('cpuAvg'):.1f} max {meta.get('cpuMax'):.1f} nan {meta.get('nan'):.0f}"
    )
    return meta


def main():
    with open(GEN_PATH, encoding="utf-8") as f:
        gen_code = f.read()
    only = set(sys.argv[1:])
    results = {}
    errors = []
    for case in cases():
        if only and case["name"] not in only:
            continue
        meta = None
        for attempt in range(4):
            meta = run_case(gen_code, case)
            if meta is not None and sane(meta, case):
                break
            print(f"  (measurement not sane, e.g. the audio device was still settling - retry {attempt + 1})")
            time.sleep(2.0)
        results[case["name"]] = meta
        name = case["name"]
        if meta is None:
            errors.append(f"{name}: no measurement")
            continue
        if meta.get("nan", 1) != 0:
            errors.append(f"{name}: {meta.get('nan')} non-finite samples")
        if name in ("neutral", "neutral_q0", "neutral_q2"):
            if meta["nullDb"] > -60:
                errors.append(f"{name}: null test residual {meta['nullDb']:.1f} dB (need < -60 dB)")
            if meta["refRms"] < 0.01:
                errors.append(f"{name}: input reference too quiet ({meta['refRms']})")
        elif name == "mix0":
            if meta["nullDb"] > -90:
                errors.append(f"mix0: wet=0 differs from delayed dry ({meta['nullDb']:.1f} dB)")
        elif name in ("auto", "midi"):
            sr = meta["sr"]
            if name == "auto":
                if meta["scopeVoiced"] < 0.5 or abs(meta["scopeF0"] - 120.0) > 4.0:
                    errors.append(f"auto: expected voiced f0 near 120 Hz, got f0 {meta['scopeF0']} voiced {meta['scopeVoiced']}")
                period = sr / 120.0
            else:
                period = sr / (440.0 * 2 ** ((47 - 69) / 12.0))
            k = 0.3 + 0.7 * 0.57
            if abs(meta["scopeL"] - k * period) > 0.08 * k * period:
                errors.append(f"{name}: L {meta['scopeL']:.1f} not near k*period {k * period:.1f}")
        elif name == "qswitch":
            if meta["tailPeak"] < 0.05:
                errors.append(f"qswitch: output did not recover after the Quality change (tail peak {meta['tailPeak']})")
        elif name == "silence":
            if meta["peak"] > 1e-6:
                errors.append(f"silence: expected silent output, peak {meta['peak']}")
            if meta["scopeLevel"] > 1e-6:
                errors.append(f"silence: scope level should read 0, got {meta['scopeLevel']}")
        elif name == "perf":
            if meta["rtFactor"] > 1.5:
                print(f"perf: 4k pipeline ran at {meta['rtFactor']:.1f}x real time (about {100.0 / max(meta['rtFactor'], 0.01):.1f}% of one core; offline driver)")
            else:
                print(f"perf: 4k pipeline kept real time with Max audio CPU avg {meta['cpuAvg']:.1f}% / max {meta['cpuMax']:.1f}%")
            if meta["rtFactor"] < 0.95:
                errors.append(f"perf: 4k pipeline is slower than real time (x{meta['rtFactor']:.2f})")
            if meta["cpuMax"] > 70:
                errors.append(f"perf: audio CPU peaked at {meta['cpuMax']:.1f}%")

        if name not in ("silence", "mix0") and meta.get("scopeFrame", 0) < 1:
            errors.append(f"{name}: scope frame counter never advanced")
        if name in ("neutral", "neutral_q2", "auto"):
            pk_ms, pk_v = meta.get("scopeCepPeakMs", 0), meta.get("scopeCepPeakV", 0)
            # At 4k the second rahmonic (2/f0 = 16.67 ms) can out-rank the first, so accept either multiple there.
            allowed = [1000.0 / 120.0] + ([2000.0 / 120.0] if name == "neutral_q2" else [])
            if min(abs(pk_ms - a) for a in allowed) > 0.35 or pk_v <= 0:
                errors.append(f"{name}: largest c[n] over 2-20 ms at {pk_ms:.2f} ms (c {pk_v:.3f}); expected the 1/f0 column (8.33 ms)" + (" or its 2nd rahmonic" if name == "neutral_q2" else "") + " with positive sign")
            else:
                print(f"  cepstrum telemetry: largest c[n] over 2-20 ms = {pk_v:+.3f} at {pk_ms:.2f} ms (1/f0 = 8.33 ms)")
        if name not in ("silence", "mix0") and meta.get("scopeNonZero", 0) < 100:
            errors.append(f"{name}: scope cepstrum buffer was not updated ({meta.get('scopeNonZero')} non-zero)")

    neutral = results.get("neutral")
    sh = results.get("shift12")
    if neutral and sh:
        print(f"Mid +12 st: centroid {neutral['centOut']:.0f} -> {sh['centOut']:.0f} Hz, f0 {neutral['f0Out']:.1f} -> {sh['f0Out']:.1f} Hz")
        if sh["centOut"] < neutral["centOut"] * 1.2:
            errors.append(f"shift12: centroid did not move up ({neutral['centOut']:.0f} -> {sh['centOut']:.0f})")
        if abs(sh["f0Out"] - neutral["f0Out"]) > 3.0 or abs(sh["f0Out"] - 120.0) > 4.0:
            errors.append(f"shift12: f0 changed ({neutral['f0Out']:.1f} -> {sh['f0Out']:.1f})")
    g0, g1 = results.get("gate_off"), results.get("gate")
    if g0 and g1:
        print(f"Gate 40%: between-partials vs partials {g0['valleyOut']:.1f} dB -> {g1['valleyOut']:.1f} dB")
        if g1["valleyOut"] > g0["valleyOut"] - 6.0:
            errors.append(f"gate: noise between partials not reduced by 6 dB ({g0['valleyOut']:.1f} -> {g1['valleyOut']:.1f})")

    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("cepstra audio checks passed")


if __name__ == "__main__":
    main()
