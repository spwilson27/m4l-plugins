#!/usr/bin/env python3
"""Render Lifter's gen core through the Ableton-bundled Max and check the audio.

The gen code is src/cepstrum_lib.genexpr + src/lifter_core.genexpr, via build_lifter.gen_source() (what the three
devices embed). The curve table comes from src/lifter_ui.js via tests/lifter_curve_cli.js.
Run it through the Max lock:  python3 scripts/max_lock.py python3 scripts/run_lifter_audio_tests.py

Cases (3-channel recording: out L, dry in, out R):
  unity_N   — flat curve at Size N: unity gain, exact constant lag of 4096 samples, no clicks
  unitysm   — the same with Smooth 60 % (flat stays identity at any Smooth)
  dry_N     — Mix 0 returns the dry input at the same 4096 sample lag
  whisper_N — the whisper curve on a 200 Hz sawtooth lowers the harmonic peak-to-valley ratio;
              telemetry updates, pitch reads about 200 Hz, spectra and cepstrum are filled
  track     — a 110 Hz saw with the robot curve boosts harmonicity more with Track on than off
  switch_*  — changing Size while running stays finite, continuous and settles at unity
  silent    — silence in gives exact zeros out, telemetry reports silent
CPU cases (8 stereo instances, [adstatus cpu]) run last.

Usage: run_lifter_audio_tests.py [case-prefix ...]   (e.g. unity cpu)
"""

import json
import math
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_lifter import gen_source  # noqa: E402  (lib minus the functions that break the compile)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CURVE_CLI = os.path.join(ROOT, "tests", "lifter_curve_cli.js")
PROBE_JS = os.path.join(ROOT, "tests", "lifter_probe.js")
HARNESS = os.path.join(ROOT, "tests", "lifter_harness.maxpat")
RESULT = "/tmp/lifter_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
MAX_LOG = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log")
AUDIO_PREFS = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Settings/audioprefs.txt")
GOOD_PREFS = 'max v2;dsp prefdrivername "Core Audio";dsp prefsubname ;'
SIZES = (512, 1024, 2048, 4096)
SKIP = 16384
RETRIES = 3
CPU_INSTANCES = 8
PASSTHROUGH = "out1 = in1;\nout2 = in2;\n"
NSAMP = 66000


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


def msg(obj_id, text, x, y, w=120):
    return box(obj_id, text, x, y, w, 20, maxclass="message", numinlets=2)


def gen_box(obj_id, code, x, y):
    return {"box": {
        "code": code,
        "fontname": "<Monospaced>",
        "fontsize": 10.0,
        "id": obj_id,
        "maxclass": "gen.codebox~",
        "numinlets": 2,
        "numoutlets": 2,
        "outlettype": ["signal", "signal"],
        "patching_rect": [float(x), float(y), 200.0, 60.0],
    }}


def write_patch(boxes, lines):
    doc = {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [40.0, 40.0, 1100.0, 700.0],
        "boxes": boxes,
        "lines": lines,
    }}
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def source_chain(src, f0=200):
    """Test signal -> obj-mute (signal). Returns boxes, lines."""
    sig = ["signal"]
    mute_text = "*~ 0" if src == "silent" else "*~ 1"
    if src in ("noise_sine", "silent"):
        boxes = [
            box("obj-noise", "noise~", 700, 40, 60, 20, outlettype=sig),
            box("obj-ng", "*~ 0.2", 700, 70, 50, 20, numinlets=2, outlettype=sig),
            box("obj-sine", "cycle~ 440", 780, 40, 80, 20, numinlets=2, outlettype=sig),
            box("obj-sg", "*~ 0.3", 780, 70, 50, 20, numinlets=2, outlettype=sig),
            box("obj-sum", "+~", 700, 100, 40, 20, numinlets=2, outlettype=sig),
            box("obj-mute", mute_text, 700, 130, 50, 20, numinlets=2, outlettype=sig),
        ]
        lines = [
            line("obj-noise", 0, "obj-ng", 0), line("obj-sine", 0, "obj-sg", 0),
            line("obj-ng", 0, "obj-sum", 0), line("obj-sg", 0, "obj-sum", 1),
            line("obj-sum", 0, "obj-mute", 0),
        ]
    elif src == "saw":
        boxes = [
            box("obj-ph", f"phasor~ {f0}", 700, 40, 80, 20, numinlets=2, outlettype=sig),
            box("obj-off", "-~ 0.5", 700, 70, 50, 20, numinlets=2, outlettype=sig),
            box("obj-ng", "*~ 0.5", 700, 100, 50, 20, numinlets=2, outlettype=sig),
            box("obj-mute", mute_text, 700, 130, 50, 20, numinlets=2, outlettype=sig),
        ]
        lines = [
            line("obj-ph", 0, "obj-off", 0), line("obj-off", 0, "obj-ng", 0), line("obj-ng", 0, "obj-mute", 0),
        ]
    else:  # sines3: smooth, for click detection
        boxes = [
            box("obj-s1", "cycle~ 200", 700, 40, 80, 20, numinlets=2, outlettype=sig),
            box("obj-s2", "cycle~ 400", 790, 40, 80, 20, numinlets=2, outlettype=sig),
            box("obj-s3", "cycle~ 600", 880, 40, 80, 20, numinlets=2, outlettype=sig),
            box("obj-g1", "*~ 0.12", 700, 70, 50, 20, numinlets=2, outlettype=sig),
            box("obj-g2", "*~ 0.08", 790, 70, 50, 20, numinlets=2, outlettype=sig),
            box("obj-g3", "*~ 0.06", 880, 70, 50, 20, numinlets=2, outlettype=sig),
            box("obj-sum", "+~", 700, 100, 40, 20, numinlets=2, outlettype=sig),
            box("obj-sum2", "+~", 700, 115, 40, 20, numinlets=2, outlettype=sig),
            box("obj-mute", mute_text, 700, 130, 50, 20, numinlets=2, outlettype=sig),
        ]
        lines = [
            line("obj-s1", 0, "obj-g1", 0), line("obj-s2", 0, "obj-g2", 0), line("obj-s3", 0, "obj-g3", 0),
            line("obj-g1", 0, "obj-sum", 0), line("obj-g2", 0, "obj-sum", 1),
            line("obj-sum", 0, "obj-sum2", 0), line("obj-g3", 0, "obj-sum2", 1),
            line("obj-sum2", 0, "obj-mute", 0),
        ]
    return boxes, lines


def curve_table(name):
    out = subprocess.check_output(["node", CURVE_CLI, name], text=True).strip()
    return out


def build_audio_harness(code, case):
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 800", 40, 80, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 120, 80),
        box("obj-del-arm", "delay 200", 40, 160, 80, 20, numinlets=2),
        msg("obj-rec-on", "1", 40, 200, 30),
        box("obj-del-snap", "delay 300", 140, 200, 80, 20, numinlets=2),
        msg("obj-snap", "snap", 140, 230, 40),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2),
        msg("obj-rec-off", "0", 40, 280, 30),
        box("obj-del-analyze", "delay 120", 40, 320, 80, 20, numinlets=2),
        msg("obj-analyze", f"analyze {NSAMP} {case['maxlag']} {case.get('f0', 0)}", 40, 360, 160),
        msg("obj-quit", "; max quit", 40, 420, 70),
        msg("obj-params", case["params"], 200, 40, 560),
        msg("obj-bind-curve", "lcurve #0-liftercurve", 200, 70, 170),
        msg("obj-bind-scope", "lscope #0-lifterscope", 380, 70, 170),
        msg("obj-setbuf", "setbuffer #0-lifterscope #0-liftercurve", 560, 70, 250),
        msg("obj-curve", "curve " + curve_table(case["curve"]), 200, 100, 400),
        box("obj-curvebuf", "buffer~ #0-liftercurve @samps 256", 520, 140, 220, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-scopebuf", "buffer~ #0-lifterscope @samps 512", 520, 170, 220, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec @samps 131072 @chans 3", 520, 200, 220, 20, numoutlets=2, outlettype=["float", "bang"]),
        gen_box("obj-gen", code, 200, 200),
        box("obj-record", "record~ rec 3", 200, 300, 90, 20, numinlets=4),
        box("obj-js", f"js {PROBE_JS} {RESULT} {SKIP}", 200, 470, 360, 20, numinlets=2, outlettype=["bang"]),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-bind-curve", 0),
        line("obj-load", 0, "obj-bind-scope", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-load", 0, "obj-curve", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-del-arm", 0, "obj-del-snap", 0),
        line("obj-del-snap", 0, "obj-snap", 0),
        line("obj-snap", 0, "obj-js", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-analyze", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-analyze", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-bind-curve", 0, "obj-gen", 0),
        line("obj-bind-scope", 0, "obj-gen", 0),
        line("obj-setbuf", 0, "obj-js", 0),
        line("obj-curve", 0, "obj-js", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-mute", 0, "obj-record", 1),
        line("obj-gen", 1, "obj-record", 2),
        line("obj-mute", 0, "obj-gen", 0),
        line("obj-mute", 0, "obj-gen", 1),
    ]
    if case.get("switch"):
        ms, idx = case["switch"]
        boxes += [
            box("obj-del-sw", f"delay {ms}", 340, 200, 80, 20, numinlets=2),
            msg("obj-sw", f"sizei {idx}", 340, 230, 70),
        ]
        lines += [
            line("obj-del-arm", 0, "obj-del-sw", 0),
            line("obj-del-sw", 0, "obj-sw", 0),
            line("obj-sw", 0, "obj-gen", 0),
        ]
    sb, sl = source_chain(case["src"], case.get("f0", 200))
    write_patch(boxes + sb, lines + sl)


def build_cpu_harness(code, params, count, dur):
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 800", 40, 80, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 120, 80),
        box("obj-metro", "metro 250", 40, 160, 80, 20, numinlets=2),
        box("obj-snapsig", "snapshot~ 100", 40, 180, 90, 20, numinlets=2, outlettype=["float"]),
        box("obj-cpu", "adstatus cpu", 40, 200, 100, 20, outlettype=["float"]),
        box("obj-del-fin", f"delay {dur}", 40, 240, 80, 20, numinlets=2),
        msg("obj-finish", "finish", 40, 280, 60),
        msg("obj-quit", "; max quit", 40, 420, 70),
        msg("obj-params", params, 200, 40, 460),
        box("obj-js", f"js {PROBE_JS} {RESULT} 0", 200, 470, 360, 20, numinlets=2, outlettype=["bang"]),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-metro", 0),
        line("obj-del-dsp", 0, "obj-del-fin", 0),
        line("obj-metro", 0, "obj-cpu", 0),
        line("obj-cpu", 0, "obj-js", 0),
        line("obj-snapsig", 0, "obj-js", 1),
        line("obj-ng", 0, "obj-snapsig", 0),
        line("obj-del-fin", 0, "obj-finish", 0),
        line("obj-finish", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
    ]
    for k in range(count):
        boxes.append(gen_box(f"obj-gen{k}", code, 200 + 30 * k, 200 + 4 * k))
        lines += [
            line("obj-params", 0, f"obj-gen{k}", 0),
            line("obj-mute", 0, f"obj-gen{k}", 0),
            line("obj-mute", 0, f"obj-gen{k}", 1),
        ]
    sb, sl = source_chain("noise_sine")
    write_patch(boxes + sb, lines + sl)


BASE = "depthp 100, smoothp 0, wetp 100, outdb 0, trackp 0"


def audio_cases():
    out = []
    for i, n in enumerate(SIZES):
        out.append({"name": f"unity_{n}", "kind": "unity", "n": n, "src": "noise_sine", "curve": "flat",
                    "dur": 1500, "maxlag": 4200, "params": f"sizei {i}, {BASE}"})
    out.append({"name": "unitysm_1024", "kind": "unity", "n": 1024, "src": "noise_sine", "curve": "flat",
                "dur": 1500, "maxlag": 4200, "params": f"sizei 1, {BASE}, smoothp 60"})
    out.append({"name": "dry_1024", "kind": "unity", "n": 1024, "src": "noise_sine", "curve": "whisper",
                "dur": 1500, "maxlag": 4200, "params": f"sizei 1, {BASE}, wetp 0"})
    for i, n in ((1, 1024), (2, 2048), (3, 4096)):
        out.append({"name": f"whisper_{n}", "kind": "whisper", "n": n, "src": "saw", "f0": 200, "curve": "whisper",
                    "dur": 1500, "maxlag": 0, "params": f"sizei {i}, {BASE}"})
    out.append({"name": "track_off", "kind": "track_off", "n": 2048, "src": "saw", "f0": 110, "curve": "robot",
                "dur": 1500, "maxlag": 0, "params": f"sizei 2, {BASE}"})
    out.append({"name": "track_on", "kind": "track_on", "n": 2048, "src": "saw", "f0": 110, "curve": "robot",
                "dur": 1500, "maxlag": 0, "params": f"sizei 2, {BASE}, trackp 1"})
    out.append({"name": "switch_down", "kind": "switch", "n": 512, "src": "sines3", "curve": "whisper",
                "dur": 1500, "maxlag": 4200, "params": f"sizei 3, {BASE}", "switch": (500, 0)})
    out.append({"name": "switch_up", "kind": "switch", "n": 4096, "src": "sines3", "curve": "whisper",
                "dur": 1500, "maxlag": 4200, "params": f"sizei 0, {BASE}", "switch": (500, 3)})
    out.append({"name": "silent_1024", "kind": "silent", "n": 1024, "src": "silent", "curve": "whisper",
                "dur": 1000, "maxlag": 0, "params": f"sizei 1, {BASE}"})
    return out


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        if raw.strip():
            key, val = raw.split(None, 1)
            meta[key] = float(val)
    return meta


def clear_recovery():
    shutil.rmtree(os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"),
                  ignore_errors=True)


def restore_audio_prefs():
    """Max falls back to the NonRealTime driver when the audio device is busy and saves
    that choice, which breaks later runs. Put Core Audio back before each launch."""
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
    interesting = [ln for ln in new.splitlines()
                   if any(k in ln.lower() for k in ("error", "failed", "probe_")) and ln.strip()[-1:] != "]"]
    if interesting:
        print("--- max log ---")
        print("\n".join(interesting[-12:]))


def launch():
    subprocess.run(["pkill", "-f", "lifter_harness.maxpat"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        if subprocess.run(["pgrep", "-f", "lifter_harness.maxpat"], stdout=subprocess.DEVNULL).returncode != 0:
            break
        time.sleep(0.25)
    # `Max <file>` opens the patch inside an already running Max (another agent's, started
    # outside the lock) and the measurement is then garbage. Wait until none is running.
    for _ in range(180):
        if subprocess.run(["pgrep", "-f", "Max.app/Contents/MacOS/Max"], stdout=subprocess.DEVNULL).returncode != 0:
            break
        time.sleep(1)
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


def run_audio(code, case, attempt=0):
    launch()
    build_audio_harness(code, case)
    meta, log_size = run_max(60)
    print(f"--- {case['name']} ---")
    if meta is None:
        print("NO RESULT FILE")
        dump_log(log_size)
        if attempt < RETRIES:
            print(f"{case['name']}: no result, retrying")
            return run_audio(code, case, attempt + 1)
        return None
    print(
        f"sr {meta['sr']:.0f} lag {meta['lag']:.0f} gain {meta['gaindb']:.3f} dB err {meta['errdb']:.1f} dB "
        f"maxerr {meta['maxerr']:.2e} errR {meta['errr']:.2e} peak {meta['outpeak']:.3f} dry {meta['dryrms']:.3f} "
        f"nan {meta['nan']:.0f} tiny {meta['tiny']:.0f} | p2v out {meta['p2vout']:.1f} dry {meta['p2vdry']:.1f} | "
        f"step out {meta['stepout']:.4f} dry {meta['stepdry']:.4f} | tele hop {meta['thop0']:.0f}->{meta['thop']:.0f} "
        f"f0 {meta['tsr'] / meta['tq'] if meta['tq'] > 1 else 0:.1f} conf {meta['tconf']:.2f} N {meta['tn']:.0f} "
        f"silent {meta['tsilent']:.0f} spec {meta['tspecn']:.0f} cep {meta['tcepmax']:.3f}"
    )
    dump_log(log_size)
    if attempt < RETRIES and case["kind"] != "silent" and meta.get("dryrms", 0) < 0.05:
        print(f"{case['name']}: input was silent, retrying")
        return run_audio(code, case, attempt + 1)
    return meta


def run_cpu(code, label, params, attempt=0):
    launch()
    build_cpu_harness(code, params, CPU_INSTANCES, 9000)
    meta, log_size = run_max(60)
    if meta is None or meta.get("samples", 0) < 4 or meta.get("alive", 0) < 1:
        if attempt < RETRIES:
            return run_cpu(code, label, params, attempt + 1)
        print(f"--- cpu {label}: NO RESULT")
        dump_log(log_size)
        return None
    print(f"--- cpu {label}: mean {meta['cpu']:.2f} % peak {meta['cpupeak']:.2f} % ({meta['samples']:.0f} polls)")
    return meta


def check_audio(case, meta, errors, results):
    name = case["name"]
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    kind = case["kind"]
    results[name] = meta
    if meta["nan"] != 0:
        errors.append(f"{name}: {meta['nan']:.0f} non-finite samples")
    if meta["tiny"] != 0:
        errors.append(f"{name}: {meta['tiny']:.0f} denormal-range samples")
    if kind == "unity":
        if meta["lag"] != 4096:
            errors.append(f"{name}: lag {meta['lag']:.0f}, expected 4096")
        if abs(meta["gaindb"]) > 0.1:
            errors.append(f"{name}: gain {meta['gaindb']:.3f} dB is not unity")
        if meta["errdb"] > -60:
            errors.append(f"{name}: residual {meta['errdb']:.1f} dB above -60 dB")
        if meta["maxerr"] > 2e-3 or meta["errr"] > 2e-3:
            errors.append(f"{name}: sample error {meta['maxerr']:.2e} / {meta['errr']:.2e}")
        if meta["stepout"] > meta["stepdry"] * 1.5 + 1e-3:
            errors.append(f"{name}: click, step {meta['stepout']:.4f} vs dry {meta['stepdry']:.4f}")
    elif kind == "whisper":
        drop = meta["p2vdry"] - meta["p2vout"]
        if drop < 6.0:
            errors.append(f"{name}: harmonic peak-to-valley fell only {drop:.1f} dB (need 6)")
        if meta["thop"] <= meta["thop0"] or meta["thop0"] < 0:
            errors.append(f"{name}: telemetry hop counter did not advance ({meta['thop0']:.0f} -> {meta['thop']:.0f})")
        if meta["tn"] != case["n"] or meta["tsr"] < 8000:
            errors.append(f"{name}: telemetry N {meta['tn']:.0f} / sr {meta['tsr']:.0f}")
        if meta["tq"] > 1:
            f0 = meta["tsr"] / meta["tq"]
            if abs(f0 - case["f0"]) > 6:
                errors.append(f"{name}: telemetry pitch {f0:.1f} Hz, expected {case['f0']}")
        else:
            errors.append(f"{name}: no pitch in the telemetry")
        if meta["tconf"] < 0.3:
            errors.append(f"{name}: pitch confidence {meta['tconf']:.2f}")
        if meta["tspecn"] < 20 or meta["tcepmax"] <= 0 or meta["tinpk"] < 0.1 or meta["toutpk"] < 0.01:
            errors.append(f"{name}: telemetry traces not filled (spec {meta['tspecn']:.0f}, cep {meta['tcepmax']:.3f}, "
                          f"in {meta['tinpk']:.3f}, out {meta['toutpk']:.3f})")
        if meta["tsilent"] != 0:
            errors.append(f"{name}: telemetry flagged silent")
    elif kind == "switch":
        if meta["stepout"] > meta["stepdry"] * 2.0 + 0.004:
            errors.append(f"{name}: click on the Size switch, step {meta['stepout']:.4f} vs dry {meta['stepdry']:.4f}")
        if meta["tn"] != case["n"]:
            errors.append(f"{name}: telemetry N {meta['tn']:.0f}, expected {case['n']}")
        if meta["outpeak"] > 0.6:
            errors.append(f"{name}: peak {meta['outpeak']:.3f}")
    elif kind == "silent":
        if meta["outpeak"] > 1e-12:
            errors.append(f"{name}: silence in, peak {meta['outpeak']} out")
        if meta["tsilent"] != 1:
            errors.append(f"{name}: telemetry did not report silence")


def main():
    code = gen_source()
    only = sys.argv[1:]
    errors = []
    results = {}
    for case in audio_cases():
        if only and not any(case["name"].startswith(p) for p in only):
            continue
        check_audio(case, run_audio(code, case), errors, results)
    if "track_on" in results and "track_off" in results:
        gain = results["track_on"]["p2vout"] - results["track_off"]["p2vout"]
        print(f"track: harmonicity on {results['track_on']['p2vout']:.1f} dB, off {results['track_off']['p2vout']:.1f} dB ({gain:+.1f})")
        if gain < 3.0:
            errors.append(f"track: Track on gained only {gain:.1f} dB of harmonicity over off (need 3)")
    lags = {n: results[f"unity_{n}"]["lag"] for n in SIZES if f"unity_{n}" in results}
    if lags:
        print("measured latency (samples):", {k: int(v) for k, v in lags.items()})

    if not only or "cpu" in only:
        base = run_cpu(PASSTHROUGH, "baseline", "sizei 1")
        base_cpu = base["cpu"] if base else 0.0
        for n_idx, n in ((1, 1024), (3, 4096)):
            meta = run_cpu(code, f"lifter_{n}", f"sizei {n_idx}, {BASE}")
            if meta is None:
                errors.append(f"cpu {n}: no measurement")
                continue
            per = (meta["cpu"] - base_cpu) / CPU_INSTANCES
            print(f"cpu lifter_{n}: {per:.3f} % per stereo instance")
            if per > 8.0:
                errors.append(f"cpu {n}: {per:.2f} % per stereo instance is too high")
    restore_audio_prefs()
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
