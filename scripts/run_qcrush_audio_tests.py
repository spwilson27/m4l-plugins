#!/usr/bin/env python3
"""Render Quefrency Crush through the Ableton-bundled Max and check the DSP and telemetry.

Run it through the Max lock (three other agents share the one Max install):
    python3 scripts/max_lock.py python3 scripts/run_qcrush_audio_tests.py [case ...]

The gen code is src/cepstrum_lib.genexpr + src/qcrush_core.genexpr, exactly what the device embeds.
Stimulus: a 110 Hz impulse train through three formants. Vowel A for 1.5 s, vowel B for 1.5 s, looped
(tests/qcrush_probe.js); sine and noise+sine stimuli for identity and click checks.

Cases:
  ident_N        defaults are exactly unity after 4096 samples at N = 512 / 1024 / 2048 / 4096
  mix0           Mix 0 is the dry signal at the same latency
  outgain        Output -6 dB
  silence        silent input gives exact zeros and level 0 in the telemetry
  neutral_v      the vowel at neutral settings is identity
  coeffs / coeffs_lo   fewer coefficients smooth the spectrum (valleys between partials fill in)
  bits_3 / bits_8      fewer bits change the signal more, monotonically
  scr_rev / scr_shuf / scr_rot   each scramble mode changes the spectral envelope; scr_off is identity
  shift_up / shift_down   Shift +12 removes the odd partials (octave-up comb), the pitch peak moves to q/2 (-12: 2q)
  freeze         Freeze keeps vowel A's envelope while the input moves to vowel B
  hold_slow / hold_fast   Hold 1 bar holds it for 2 s, Hold 1/32 follows
  tickrate / ppqlock      the hold clock runs at the Live tempo and locks to the host position
  sizeswitch     Size 1024 -> 4096 -> 512 -> 2048 while playing: finite, no clicks, back at unity
  extreme        every operation at its extreme at N = 512: finite and bounded
  perf           everything on at N = 4096: audio CPU
"""

import json
import math
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT, "src", "qcrush_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "qcrush_probe.js")
HARNESS = os.path.join(ROOT, "tests", "qcrush_harness.maxpat")
RESULT = "/tmp/qcrush_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
MAX_LOG = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log")
AUDIO_PREFS = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Settings/audioprefs.txt")
GOOD_PREFS = 'max v2;dsp prefdrivername "Core Audio";dsp prefsubname ;'
RETRIES = 8
LATENCY = 4096
PHASE_HZ = 1.0 / 3.0

BASE = "fftn 2048, coeffs 1, qbits 16, smode 0, samt 0.5, qshift 0, freeze 0, qhold 0, wet 1, outdb 0, bpm 120, ppq 0"


def p(extra):
    return BASE + ", " + extra if extra else BASE


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


def msg(obj_id, text, x, y, w=120):
    return box(obj_id, text, x, y, w, 20, maxclass="message", numinlets=2)


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


def build_harness(code, case):
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 1000", 40, 80, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 120, 80),
        box("obj-del-arm", f"delay {case['arm']}", 40, 160, 80, 20, numinlets=2),
        msg("obj-rec-on", "1", 40, 200, 30),
        msg("obj-mark", "mark", 100, 200, 40),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2),
        msg("obj-rec-off", "0", 40, 280, 30),
        box("obj-del-analyze", "delay 150", 40, 320, 80, 20, numinlets=2),
        msg("obj-analyze", f"analyze {case['dur']}", 40, 360, 120),
        msg("obj-quit", "; max quit", 40, 420, 70),
        msg("obj-params", case["params"], 200, 40, 700),
        msg("obj-bind", "scope #0-qcrushscope", 200, 70, 200),
        msg("obj-setbuf", "setbuffer #0-qcrushscope", 200, 100, 220),
        box("obj-del-fill", "delay 300", 200, 130, 80, 20, numinlets=2),
        msg("obj-fill", "fill", 300, 130, 40),
        box("obj-scope", "buffer~ #0-qcrushscope @samps 320", 520, 100, 260, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-stim", "buffer~ stim 3000 1", 520, 130, 150, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec @samps 262144 @chans 4", 520, 160, 220, 20, numoutlets=2, outlettype=["float", "bang"]),
        {
            "box": {
                "code": code,
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
        box("obj-record", "record~ rec 4", 200, 300, 90, 20, numinlets=5),
        box("obj-mute-l", "*~ 0", 200, 390, 45, 20, numinlets=2, outlettype=["signal"]),
        box("obj-dac", "dac~", 200, 430, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box("obj-js", f"js {PROBE_JS} {case['stim']} {RESULT} {LATENCY}", 200, 470, 480, 20,
            numinlets=2, numoutlets=1, outlettype=["bang"]),
        box("obj-phasor", f"phasor~ {PHASE_HZ}", 700, 200, 80, 20, numinlets=2, outlettype=["signal"]),
        box("obj-wave", "wave~ stim", 700, 240, 90, 20, numinlets=3, numoutlets=2, outlettype=["signal", "signal"]),
        box("obj-metro", "metro 100", 40, 480, 70, 20, numinlets=2),
        box("obj-adstatus", "adstatus cpu", 40, 510, 90, 20, numinlets=2, outlettype=["float"]),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-bind", 0),
        line("obj-load", 0, "obj-del-fill", 0),
        line("obj-del-fill", 0, "obj-fill", 0),
        line("obj-fill", 0, "obj-js", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-setbuf", 0, "obj-js", 0),
        line("obj-bind", 0, "obj-gen", 0),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-dsp", 0, "obj-metro", 0),
        line("obj-metro", 0, "obj-adstatus", 0),
        line("obj-adstatus", 0, "obj-js", 1),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-mark", 0),
        line("obj-mark", 0, "obj-js", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-analyze", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-analyze", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-wave", 0, "obj-record", 1),
        line("obj-gen", 1, "obj-record", 2),
        line("obj-phasor", 0, "obj-record", 3),
        line("obj-gen", 0, "obj-mute-l", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-phasor", 0, "obj-wave", 0),
        line("obj-wave", 0, "obj-gen", 0),
        line("obj-wave", 0, "obj-gen", 1),
    ]
    if case["stim"] == "silent":
        pass
    for i, (ms, text) in enumerate(case.get("events", [])):
        boxes.append(box(f"obj-ev-del{i}", f"delay {ms}", 40, 560 + 30 * i, 80, 20, numinlets=2))
        boxes.append(msg(f"obj-ev-msg{i}", text, 130, 560 + 30 * i, 140))
        lines.append(line("obj-del-dsp", 0, f"obj-ev-del{i}", 0))
        lines.append(line(f"obj-ev-del{i}", 0, f"obj-ev-msg{i}", 0))
        lines.append(line(f"obj-ev-msg{i}", 0, "obj-gen", 0))
    if case.get("ppqfeed"):
        # host position moving at 4 beats per second (240 bpm), whatever the bpm parameter says
        boxes += [
            box("obj-ppq-metro", "metro 10", 300, 560, 70, 20, numinlets=2),
            box("obj-ppq-ctr", "counter", 300, 590, 60, 20, numinlets=4, numoutlets=4, outlettype=["int", "", "", "int"]),
            box("obj-ppq-mul", "* 0.04", 300, 620, 60, 20, numinlets=2, outlettype=["float"]),
            box("obj-ppq-prep", "prepend ppq", 300, 650, 90, 20),
        ]
        lines += [
            line("obj-del-dsp", 0, "obj-ppq-metro", 0),
            line("obj-ppq-metro", 0, "obj-ppq-ctr", 0),
            line("obj-ppq-ctr", 0, "obj-ppq-mul", 0),
            line("obj-ppq-mul", 0, "obj-ppq-prep", 0),
            line("obj-ppq-prep", 0, "obj-gen", 0),
        ]
    doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 40.0, 1000.0, 700.0],
            "boxes": boxes,
            "lines": lines,
        }
    }
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def cases():
    base = {"stim": "vowels2", "arm": 700, "dur": 2900, "events": []}

    def c(name, **kw):
        d = dict(base)
        d["name"] = name
        d.update(kw)
        return d

    out = []
    for n in (512, 1024, 2048, 4096):
        out.append(c(f"ident_{n}", stim="mix", dur=2000, params=p(f"fftn {n}"), n=n))
    out += [
        c("mix0", params=p("wet 0, coeffs 0.3, qbits 4"), dur=2000),
        c("outgain", stim="mix", dur=2000, params=p("outdb -6")),
        c("silence", stim="silent", dur=1500, params=p("coeffs 0.3")),
        c("neutral_v", params=p("")),
        c("coeffs", params=p("coeffs 0.45")),
        c("coeffs_lo", params=p("coeffs 0.15")),
        c("bits_3", params=p("qbits 3")),
        c("bits_8", params=p("qbits 8")),
        c("scr_off", params=p("smode 0, samt 1")),
        c("scr_rev", params=p("smode 1, samt 1")),
        c("scr_shuf", params=p("smode 2, samt 1")),
        c("scr_rot", params=p("smode 3, samt 0.6")),
        c("shift_up", params=p("qshift 12")),
        c("shift_down", params=p("qshift -12")),
        c("freeze", params=p(""), events=[(800, "freeze 1")]),
        c("hold_slow", params=p(""), events=[(400, "qhold 6")]),
        c("hold_fast", params=p(""), events=[(400, "qhold 1")]),
        c("tickrate", params=p("qhold 2"), dur=2000),
        c("ppqlock", params=p("qhold 3"), dur=2000, ppqfeed=True),
        c("sizeswitch", stim="sine", dur=4800, params=p("fftn 1024, coeffs 0.999, qbits 15"),
          events=[(1000, "fftn 4096"), (2200, "fftn 512"), (3400, "fftn 2048")]),
        c("extreme", params=p("fftn 512, coeffs 0, qbits 1, smode 2, samt 1, qshift -12, freeze 1"), dur=2000),
        c("perf", params=p("fftn 4096, coeffs 0.6, qbits 6, smode 1, samt 0.7, qshift 5, qhold 2"), dur=2000),
    ]
    return out


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        if raw.strip():
            key, val = raw.split(None, 1)
            try:
                meta[key] = float(val)
            except ValueError:
                meta[key] = float("nan")
    return meta


def clear_recovery():
    shutil.rmtree(os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"), ignore_errors=True)


def restore_audio_prefs():
    """Max falls back to the NonRealTime driver when the audio device is busy and saves that choice."""
    try:
        text = open(AUDIO_PREFS).read()
    except OSError:
        return
    if "NonRealTime" in text:
        with open(AUDIO_PREFS, "w") as f:
            f.write(GOOD_PREFS)
        nrt = os.path.join(os.path.dirname(AUDIO_PREFS), "NonRealTime@.txt")
        if os.path.exists(nrt):
            os.remove(nrt)


def dump_log(log_size):
    if not os.path.exists(MAX_LOG):
        return
    log = open(MAX_LOG, errors="replace").read()
    new = log[log_size:] if log_size < len(log) else log[-8000:]
    interesting = [
        ln for ln in new.splitlines()
        if any(k in ln.lower() for k in ("error", "failed", "gen", "qcrush")) and ln.strip()
    ]
    if interesting:
        print("--- max log ---")
        print("\n".join(interesting[-14:]))


def launch():
    subprocess.run(["pkill", "-f", "qcrush_harness.maxpat"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        if subprocess.run(["pgrep", "-f", "qcrush_harness.maxpat"], stdout=subprocess.DEVNULL).returncode != 0:
            break
        time.sleep(0.25)
    time.sleep(0.4)
    clear_recovery()
    restore_audio_prefs()


def run_max(timeout):
    if os.path.exists(RESULT):
        os.remove(RESULT)
    log_size = os.path.getsize(MAX_LOG) if os.path.exists(MAX_LOG) else 0
    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + timeout
    while time.time() < deadline and proc.poll() is None:
        if os.path.exists(RESULT):
            size = os.path.getsize(RESULT)
            time.sleep(0.4)
            if size > 0 and os.path.getsize(RESULT) == size:
                break
        else:
            time.sleep(0.25)
    if proc.poll() is None:
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
    time.sleep(0.3)
    meta = parse_result(open(RESULT).read()) if os.path.exists(RESULT) else None
    return meta, log_size


def sane(meta, case):
    if meta.get("error"):
        return False
    if meta.get("sr", 0) not in (44100.0, 48000.0, 88200.0, 96000.0):
        return False
    if case["stim"] == "silent":
        return True
    return meta.get("dryrms", 0) > 0.05


def run_case(code, case, attempt=0):
    launch()
    build_harness(code, case)
    meta, log_size = run_max(case["dur"] / 1000.0 + 16)
    print(f"--- {case['name']} ---")
    if meta is None or not sane(meta, case):
        print("NO RESULT" if meta is None else "measurement not sane (stimulus silent or audio device settling)")
        dump_log(log_size)
        if attempt < RETRIES:
            time.sleep(1.5)
            return run_case(code, case, attempt + 1)
        return meta
    meta["lvl"] = 20 * math.log10(max(meta["outrms"], 1e-12) / max(meta["dryrms"], 1e-12)) if meta["dryrms"] > 0 else 0.0
    print(
        f"lvl {meta['lvl']:.2f} dB clk {meta.get('stepcleanAt', 0):.2f}/{meta.get('stepinAt', 0):.2f} sr {meta['sr']:.0f} lag {meta['lag']:.0f} gain {meta['gaindb']:.2f} dB err {meta['errdb']:.1f} dB "
        f"step {meta['maxstep']:.4f} (in {meta['maxstepin']:.4f}) peak {meta['peak']:.3f} nan {meta['nan']:.0f} "
        f"valley {meta.get('valleyIn', 0):.1f}->{meta.get('valleyOut', 0):.1f} oddeven {meta.get('oddevenIn', 0):.1f}->{meta.get('oddevenOut', 0):.1f} "
        f"R(A,HB,B) in {meta.get('RinA', 0):.1f}/{meta.get('RinHB', 0):.1f}/{meta.get('RinB', 0):.1f} "
        f"out {meta.get('RoutA', 0):.1f}/{meta.get('RoutHB', 0):.1f}/{meta.get('RoutB', 0):.1f} bandmax {meta.get('bandmaxdiff', 0):.1f} "
        f"| scope N {meta.get('scN', 0):.0f} K {meta.get('scK', 0):.1f} q0 {meta.get('scQ0', 0):.1f} q0s {meta.get('scQ0s', 0):.1f} "
        f"frame {meta.get('scFrame', 0):.0f} lvl {meta.get('scLevel', 0):.3f} ticks {meta.get('tickDelta', 0):.0f}/{meta.get('wallSec', 0):.2f}s "
        f"cpu {meta.get('cpuAvg', 0):.1f}/{meta.get('cpuMax', 0):.1f}"
    )
    dump_log(log_size)
    return meta


def check(name, m, results, errors):
    def err(text):
        errors.append(f"{name}: {text}")

    if m is None:
        err("no measurement")
        return
    if m.get("nan", 1) != 0:
        err(f"{m.get('nan'):.0f} non-finite samples")
    if m.get("tiny", 0) != 0:
        err(f"{m.get('tiny'):.0f} denormal-range samples")
    sr = m["sr"]
    if name in ("coeffs", "coeffs_lo", "bits_3", "bits_8", "scr_rev", "scr_shuf", "scr_rot", "shift_up", "shift_down", "freeze", "hold_slow", "hold_fast") and abs(m["lvl"]) > (4.0 if name.startswith("scr_") else 2.5):
        err(f"level changed by {m['lvl']:.1f} dB (every crush should keep the loudness; scrambles peak into the soft knee)")
    if name.startswith("ident_"):
        n = int(name.split("_")[1])
        if m["lag"] != LATENCY:
            err(f"latency {m['lag']:.0f} samples, expected {LATENCY}")
        if abs(m["gaindb"]) > 0.3:
            err(f"gain {m['gaindb']:.3f} dB is not unity")
        if m["errdb"] > -60:
            err(f"residual {m['errdb']:.1f} dB above -60 dB")
        if m["maxerr"] > 2e-3:
            err(f"sample error {m['maxerr']:.2e}")
        if m["lrcorr"] < 0.999:
            err(f"L/R correlation {m['lrcorr']:.4f}")
        if m["scN"] != n or m["scNeutral"] != 1:
            err(f"telemetry N {m['scN']:.0f} neutral {m['scNeutral']:.0f}")
    elif name == "mix0":
        if m["lag"] != LATENCY or m["errdb"] > -90:
            err(f"wet 0 is not the dry signal at 4096 (lag {m['lag']:.0f}, residual {m['errdb']:.1f} dB)")
    elif name == "outgain":
        if abs(m["gaindb"] + 6.02) > 0.3:
            err(f"output -6 dB measured {m['gaindb']:.2f} dB")
    elif name == "silence":
        if m["peak"] > 1e-12:
            err(f"silence in, peak {m['peak']}")
        if m.get("scLevel", 1) > 1e-9:
            err(f"telemetry level should read 0 asleep, got {m.get('scLevel')}")
    elif name == "neutral_v":
        if m["errdb"] > -60 or m["lag"] != LATENCY:
            err(f"vowel at neutral: residual {m['errdb']:.1f} dB, lag {m['lag']:.0f}")
        if abs(m["RoutB"] - m["RinB"]) > 0.5:
            err("vowel B envelope changed at neutral")
    elif name in ("coeffs", "coeffs_lo"):
        d = m["valleyOut"] - m["valleyIn"]
        want = 6 if name == "coeffs" else 10
        if d < want:
            err(f"fewer coefficients should fill the valleys between partials by > {want} dB, got {d:.1f} dB")
        if m["errdb"] < -40:
            err(f"coefficient truncation barely changed the signal ({m['errdb']:.1f} dB)")
        if name == "coeffs" and abs(m["scK"] - 2 * (m["scQs"] / 2) ** (0.45 / 0.75)) > 1.0:
            err(f"telemetry K {m['scK']:.1f}")
        if m["scSumOrig"] < 0.5 or abs(m["scSumOrig"] - m["scSumCrush"]) < 0.01:
            err("telemetry shows no difference between the original and the crushed coefficients")
    elif name in ("bits_3", "bits_8"):
        if m["errdb"] < (-18 if name == "bits_3" else -45):
            err(f"quantizing the coefficients barely changed the signal ({m['errdb']:.1f} dB)")
        if m["scDiff"] < 0.01:
            err("telemetry: crushed coefficients identical to the original")
    elif name == "scr_off":
        if m["errdb"] > -60:
            err(f"scramble off must be identity, residual {m['errdb']:.1f} dB")
    elif name in ("scr_rev", "scr_shuf", "scr_rot"):
        if m["bandmaxdiff"] < 3:
            err(f"scramble did not move the spectral envelope (max band change {m['bandmaxdiff']:.1f} dB)")
        if m["errdb"] < -25:
            err(f"scramble barely changed the signal ({m['errdb']:.1f} dB)")
    elif name == "shift_up":
        d = m["oddevenOut"] - m["oddevenIn"]
        if d > -6:
            err(f"Shift +12 should leave only the even partials (odd/even {m['oddevenIn']:.1f} -> {m['oddevenOut']:.1f} dB)")
        if abs(m["scQ0"] - sr / 110.0) > 3:
            err(f"pitch quefrency {m['scQ0']:.1f}, expected {sr / 110.0:.1f}")
        if abs(m["scQ0s"] - m["scQ0"] / 2) > 2:
            err(f"shifted pitch quefrency {m['scQ0s']:.1f}, expected {m['scQ0'] / 2:.1f}")
        if m["scPeakBinCrush"] >= m["scPeakBinOrig"]:
            err("excitation strip: the crushed peak did not move to a shorter quefrency")
    elif name == "shift_down":
        if m["valleyOut"] - m["valleyIn"] < 3:
            err(f"Shift -12 should add teeth between the partials ({m['valleyIn']:.1f} -> {m['valleyOut']:.1f} dB)")
        if abs(m["scQ0s"] - 2 * m["scQ0"]) > 4:
            err(f"shifted pitch quefrency {m['scQ0s']:.1f}, expected {2 * m['scQ0']:.1f}")
        if m["scPeakBinCrush"] <= m["scPeakBinOrig"]:
            err("excitation strip: the crushed peak did not move to a longer quefrency")
    elif name in ("freeze", "hold_slow", "hold_fast"):
        span = m["RinB"] - m["RinA"]
        if span < 10:
            err(f"stimulus vowels too similar (span {span:.1f} dB)")
        if name == "freeze":
            if (m["RoutB"] - m["RinA"]) > 0.45 * span:
                err(f"frozen envelope drifted to vowel B (R {m['RinA']:.1f} -> {m['RoutB']:.1f} dB, B is {m['RinB']:.1f} dB)")
            if m["scHeld"] != 1:
                err("telemetry does not flag the held envelope")
        elif name == "hold_slow":
            if (m["RoutHB"] - m["RinA"]) > 0.45 * (m["RinHB"] - m["RinA"]):
                err(f"Hold 1 bar let the envelope move at 1.7..1.95 s (out {m['RoutHB']:.1f}, A {m['RinA']:.1f}, in {m['RinHB']:.1f})")
            if (m["RoutB"] - m["RinA"]) < 0.55 * span:
                err(f"Hold 1 bar never stepped to vowel B after its 2 s tick (out {m['RoutB']:.1f}, B {m['RinB']:.1f})")
        else:
            if (m["RoutHB"] - m["RinA"]) < 0.55 * (m["RinHB"] - m["RinA"]):
                err(f"Hold 1/32 did not follow vowel B (out {m['RoutHB']:.1f}, in {m['RinHB']:.1f})")
    elif name in ("tickrate", "ppqlock"):
        want = m["wallSec"] / 0.125
        if abs(m["tickDelta"] - want) > 2.5:
            err(f"{m['tickDelta']:.0f} hold ticks in {m['wallSec']:.2f} s, expected {want:.1f} (125 ms steps)")
        if not (0 <= m["scClock"] <= 1):
            err(f"clock phase {m['scClock']}")
    elif name == "sizeswitch":
        if m["maxstepclean"] > 0.02:
            err(f"click while switching Size: step {m['maxstepclean']:.4f} at {m['stepcleanAt']:.2f} s where the 220 Hz sine moves at most 0.008 per sample (input glitch at {m['stepinAt']:.2f} s)")
        if not (0.2 < m["tailpeak"] < 0.3):
            err(f"output did not return to the sine's level after the switches (tail peak {m['tailpeak']:.3f})")
        if m["scN"] != 2048:
            err(f"telemetry N {m['scN']:.0f}, expected 2048")
    elif name == "extreme":
        if m["peak"] > 6:
            err(f"peak {m['peak']:.2f} at extreme settings")
    elif name == "perf":
        if m["cpuMax"] > 70:
            err(f"audio CPU peaked at {m['cpuMax']:.1f} %")
    if name not in ("silence", "mix0", "outgain") and not name.startswith("ident_") and not name.startswith("size"):
        if m.get("scFrame", 0) < 1:
            err("telemetry frame counter never advanced")
        if m.get("scNonZero", 0) < 50:
            err(f"telemetry buffer not updated ({m.get('scNonZero')} non-zero)")


def main():
    code = open(LIB_PATH, encoding="utf-8").read() + "\n" + open(CORE_PATH, encoding="utf-8").read()
    only = sys.argv[1:]
    results = {}
    errors = []
    for case in cases():
        if only and not any(case["name"].startswith(o) for o in only):
            continue
        meta = run_case(code, case)
        results[case["name"]] = meta
        check(case["name"], meta, results, errors)
    # relative checks between cases
    b3 = results.get("bits_3")
    b8 = results.get("bits_8")
    if b3 and b8 and b3["errdb"] < b8["errdb"] + 3:
        errors.append(f"bits: 3 bits ({b3['errdb']:.1f} dB) should differ from the input more than 8 bits ({b8['errdb']:.1f} dB)")
    restore_audio_prefs()
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
