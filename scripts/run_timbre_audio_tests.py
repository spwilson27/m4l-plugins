#!/usr/bin/env python3
"""Render Timbre Follower (`src/timbre_core.genexpr`) through the Ableton-bundled Max 9.

Run it under the shared lock:  python3 scripts/max_lock.py python3 scripts/run_timbre_audio_tests.py

The gen code is src/cepstrum_lib.genexpr + src/timbre_core.genexpr. A deterministic stimulus is written into
`buffer~ src` by tests/timbre_probe.js and played through the core; `sfrecord~ 4` (4 channels: out1, dry input,
out3 control, out2) is written by sfrecord~ as a float32 WAV and the `timbrescope` telemetry is dumped to text; both are analysed here.

Cases:
  env      — Env mode. Stimulus: sine 0-1 s, saw 1-2, noise 2-3, saw 3-4 (timbre switches at 1, 2, 3 s, all at
             -18 dBFS RMS), the same saw +12 dB at 4-5 s and back at 5-6 s (level changes only).
             * out1 / out2 equal the dry input bit for bit at the same index (zero lag)
             * the control peaks after each timbre switch and stays near 0 for both level changes and in the
               steady parts; no NaN or denormals
             * telemetry: hop counter advanced, threshold 0.32 for Sens 50, columns written
             * the whole control trace matches src/timbre_ref.js (hop phase searched)
  trig     — Trig mode on the same stimulus: exactly 3 fixed AD pulses of height 1.0, one per timbre switch,
             none at the level changes; matches the reference
  focus    — Focus +100 %, Sens 80, other attack / release: matches the reference; texture-weighted, so the
             low-order (brightness / body) switches are attenuated while the level changes still read 0
  silence  — 3 s of zeros: control exactly 0, idle flag set (no analysis), counter frozen
  cpu      — (only with the argument `cpu`) 8 instances, [adstatus cpu] minus a pass-through baseline
"""

import array
import json
import math
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT, "src", "timbre_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "timbre_probe.js")
COMPARE_JS = os.path.join(ROOT, "tests", "timbre_mirror_compare.js")
HARNESS = os.path.join(ROOT, "tests", "timbre_harness.maxpat")
REC_WAV = "/tmp/timbre_rec.wav"
SCOPE_TXT = "/tmp/timbre_scope.txt"
CPU_RESULT = "/tmp/timbre_cpu.txt"
MAX_BIN = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app/Contents/MacOS/Max"
MAX_LOG = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log")
AUDIO_PREFS = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Settings/audioprefs.txt")
GOOD_PREFS = 'max v2;dsp prefdrivername "Core Audio";dsp prefsubname ;'
RETRIES = 5
CPU_INSTANCES = 8


# ---------------------------------------------------------------- patch helpers
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


def gen_box(obj_id, code, x, y, ins=2):
    return {
        "box": {
            "code": code,
            "fontname": "<Monospaced>",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "gen.codebox~",
            "numinlets": ins,
            "numoutlets": 3,
            "outlettype": ["signal", "signal", "signal"],
            "patching_rect": [float(x), float(y), 220.0, 60.0],
        }
    }


def write_patch(boxes, lines):
    doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 40.0, 1000.0, 640.0],
            "boxes": boxes,
            "lines": lines,
        }
    }
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def audio_harness(code, case):
    """loadbang -> dsp start (0.5 s) -> adstatus sr -> probe fill -> sfrecord~ 4 (32-bit float WAV) + play -> stop -> scope dump -> quit."""
    dur = case["dur"]
    boxes = [
        box("obj-load", "loadbang", 40, 30, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 500", 40, 60, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 90, 80),
        box("obj-del-fill", "delay 900", 40, 120, 80, 20, numinlets=2),
        box("obj-sr", "adstatus sr", 40, 150, 90, 20, numinlets=2),
        msg("obj-fillmsg", "fill $1", 40, 180, 60),
        box("obj-js", f"js {PROBE_JS} {case['scenario']} {SCOPE_TXT}", 40, 210, 460, 20, numoutlets=2, outlettype=["bang", "bang"]),
        msg("obj-open", f"samptype float32, open {REC_WAV}", 40, 240, 330),
        box("obj-del-arm", "delay 250", 40, 270, 80, 20, numinlets=2),
        msg("obj-rec-on", "1", 40, 300, 30),
        msg("obj-play", f"0, {dur} {dur}", 100, 300, 110),
        box("obj-line", "line~ 0", 100, 330, 70, 20, numinlets=2, outlettype=["signal"]),
        box("obj-playsrc", "play~ src", 100, 360, 80, 20, numinlets=2, outlettype=["signal"]),
        box("obj-del-stop", f"delay {dur + 150}", 40, 390, 90, 20, numinlets=2),
        msg("obj-rec-off", "0", 40, 420, 30),
        box("obj-del-dump", "delay 400", 40, 450, 80, 20, numinlets=2),
        msg("obj-dump", "dumpscope", 40, 480, 80),
        box("obj-del-quit", "delay 600", 40, 510, 80, 20, numinlets=2),
        msg("obj-quit", "; max quit", 40, 540, 70),
        msg("obj-params", case["params"], 380, 30, 420),
        msg("obj-bind", "scope timbrescope", 380, 60, 140),
        box("obj-srcbuf", "buffer~ src 100", 560, 90, 100, 20, outlettype=["float", "bang"], numoutlets=2),
        box("obj-scopebuf", "buffer~ timbrescope @samps 2064", 560, 150, 190, 20, outlettype=["float", "bang"], numoutlets=2),
        gen_box("obj-gen", code, 380, 330),
        box("obj-record", "sfrecord~ 4", 380, 430, 100, 20, numinlets=4, numoutlets=1),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-bind", 0),
        line("obj-load", 0, "obj-del-fill", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-bind", 0, "obj-gen", 0),
        line("obj-del-fill", 0, "obj-sr", 0),
        line("obj-sr", 0, "obj-fillmsg", 0),
        line("obj-fillmsg", 0, "obj-js", 0),
        line("obj-js", 0, "obj-open", 0),
        line("obj-js", 0, "obj-del-arm", 0),
        line("obj-open", 0, "obj-record", 0),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-play", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-play", 0, "obj-line", 0),
        line("obj-line", 0, "obj-playsrc", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-dump", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-del-dump", 0, "obj-dump", 0),
        line("obj-dump", 0, "obj-js", 0),
        line("obj-del-dump", 0, "obj-del-quit", 0),
        line("obj-del-quit", 0, "obj-quit", 0),
        # signal: play~ -> gen in1 + in2; record out1, dry, out3, out2
        line("obj-playsrc", 0, "obj-gen", 0),
        line("obj-playsrc", 0, "obj-gen", 1),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-playsrc", 0, "obj-record", 1),
        line("obj-gen", 2, "obj-record", 2),
        line("obj-gen", 1, "obj-record", 3),
    ]
    write_patch(boxes, lines)


def cpu_harness(code, count, dur, with_core):
    boxes = [
        box("obj-load", "loadbang", 40, 30, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 500", 40, 60, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 90, 80),
        box("obj-metro", "metro 250", 40, 120, 80, 20, numinlets=2),
        box("obj-cpu", "adstatus cpu", 40, 150, 100, 20, outlettype=["float"]),
        box("obj-del-fin", f"delay {dur}", 40, 180, 80, 20, numinlets=2),
        box("obj-js-cpu", f"js {os.path.join(ROOT, 'tests', 'timbre_cpu_probe.js')} {CPU_RESULT}", 200, 210, 360, 20, numinlets=2, outlettype=["bang"]),
        msg("obj-finish", "finish", 40, 210, 60),
        msg("obj-quit", "; max quit", 40, 270, 70),
        box("obj-noise", "noise~", 700, 40, 60, 20, outlettype=["signal"]),
        box("obj-ng", "*~ 0.2", 700, 70, 50, 20, numinlets=2, outlettype=["signal"]),
        box("obj-sine", "cycle~ 440", 780, 40, 80, 20, numinlets=2, outlettype=["signal"]),
        box("obj-sg", "*~ 0.3", 780, 70, 50, 20, numinlets=2, outlettype=["signal"]),
        box("obj-sum", "+~", 700, 100, 40, 20, numinlets=2, outlettype=["signal"]),
        box("obj-snap", "snapshot~ 100", 700, 130, 90, 20, numinlets=2, outlettype=["float"]),
        msg("obj-params", "sens 50, attack 8, release 250, focus 0, mode 0", 200, 60, 340),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-metro", 0),
        line("obj-del-dsp", 0, "obj-del-fin", 0),
        line("obj-metro", 0, "obj-cpu", 0),
        line("obj-cpu", 0, "obj-js-cpu", 0),
        line("obj-del-fin", 0, "obj-finish", 0),
        line("obj-finish", 0, "obj-js-cpu", 0),
        line("obj-js-cpu", 0, "obj-quit", 0),
        line("obj-noise", 0, "obj-ng", 0),
        line("obj-sine", 0, "obj-sg", 0),
        line("obj-ng", 0, "obj-sum", 0),
        line("obj-sg", 0, "obj-sum", 1),
        line("obj-sum", 0, "obj-snap", 0),
        line("obj-snap", 0, "obj-js-cpu", 1),
    ]
    for k in range(count):
        boxes.append(gen_box(f"obj-gen{k}", code, 200 + 30 * k, 330 + 4 * k))
        lines.append(line("obj-params", 0, f"obj-gen{k}", 0))
        lines.append(line("obj-sum", 0, f"obj-gen{k}", 0))
        lines.append(line("obj-sum", 0, f"obj-gen{k}", 1))
    write_patch(boxes, lines)


# ---------------------------------------------------------------- Max driver
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


def launch_prep():
    subprocess.run(["pkill", "-f", "timbre_harness.maxpat"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        if subprocess.run(["pgrep", "-f", "timbre_harness.maxpat"], stdout=subprocess.DEVNULL).returncode != 0:
            break
        time.sleep(0.25)
    time.sleep(0.4)
    clear_recovery()
    restore_audio_prefs()


def dump_log(log_size):
    if not os.path.exists(MAX_LOG):
        return
    log = open(MAX_LOG, errors="replace").read()
    new = log[log_size:] if log_size < len(log) else log[-8000:]
    skip = ("startup_load", "Node for Max", "rnbo", "nodescript", "maxdb", "snippet", "path_setdefault", "interface_init", "sysmenu")
    interesting = [
        ln for ln in new.splitlines()
        if ln.strip() and not any(k in ln for k in skip) and any(k in ln.lower() for k in ("error", "warning", "failed", "timbre", "undeclared"))
    ]
    if interesting:
        print("--- max log ---")
        print("\n".join(interesting[-14:]))


def run_max(result_paths, timeout):
    for p in result_paths:
        if os.path.exists(p):
            os.remove(p)
    log_size = os.path.getsize(MAX_LOG) if os.path.exists(MAX_LOG) else 0
    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + timeout
    while time.time() < deadline and proc.poll() is None:
        if all(os.path.exists(p) for p in result_paths):
            sizes = [os.path.getsize(p) for p in result_paths]
            time.sleep(0.5)
            if sizes == [os.path.getsize(p) for p in result_paths] and all(s > 0 for s in sizes):
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
    ok = all(os.path.exists(p) and os.path.getsize(p) > 0 for p in result_paths)
    return ok, log_size


def read_wav(path):
    """32-bit float WAV -> list of channel arrays (array('f'))."""
    data = open(path, "rb").read()
    pos = 12
    ch = bits = tag = 0
    payload = b""
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        if cid == b"fmt ":
            tag = int.from_bytes(data[pos + 8:pos + 10], "little")
            ch = int.from_bytes(data[pos + 10:pos + 12], "little")
            bits = int.from_bytes(data[pos + 22:pos + 24], "little")
        elif cid == b"data":
            payload = data[pos + 8:pos + 8 + size]
            break
        pos += 8 + size + (size & 1)
    if bits != 32 or tag not in (3, 0xFFFE):
        raise RuntimeError(f"{path}: expected 32-bit float WAV (tag {tag}, {bits} bit)")
    flat = array.array("f")
    flat.frombytes(payload[: len(payload) // 4 * 4])
    return [flat[c::ch] for c in range(ch)]


# ---------------------------------------------------------------- cases
def audio_cases():
    return [
        {"name": "env", "scenario": "switches", "dur": 6700, "kind": "env",
         "params": "sens 50, attack 2, release 60, focus 0, mode 0", "mirror": {"sens": 50, "attack": 2, "release": 60, "focus": 0, "mode": 0}},
        {"name": "trig", "scenario": "switches", "dur": 6700, "kind": "trig",
         "params": "sens 50, attack 5, release 120, focus 0, mode 1", "mirror": {"sens": 50, "attack": 5, "release": 120, "focus": 0, "mode": 1}},
        {"name": "focus", "scenario": "switches", "dur": 6700, "kind": "focus",
         "params": "sens 80, attack 4, release 150, focus 100, mode 0", "mirror": {"sens": 80, "attack": 4, "release": 150, "focus": 100, "mode": 0}},
        {"name": "silence", "scenario": "silence", "dur": 3000, "kind": "silence",
         "params": "sens 50, attack 2, release 60, focus 0, mode 0", "mirror": None},
    ]


def run_audio(code, case, attempt=0):
    launch_prep()
    audio_harness(code, case)
    ok, log_size = run_max([REC_WAV, SCOPE_TXT], 60)
    print(f"--- {case['name']} ---")
    if not ok:
        print("NO RESULT FILE")
        dump_log(log_size)
        if attempt < RETRIES:
            print(f"{case['name']}: no result (Max or the audio device did not start), retrying")
            return run_audio(code, case, attempt + 1)
        return None
    try:
        rec = read_wav(REC_WAV)
        scope = [float(v) for v in open(SCOPE_TXT).read().split()]
        if len(scope) < 2064:
            raise RuntimeError(f"scope dump has {len(scope)} values")
    except Exception as exc:  # noqa: BLE001
        print("unreadable result:", exc)
        dump_log(log_size)
        if attempt < RETRIES:
            return run_audio(code, case, attempt + 1)
        return None
    dump_log(log_size)
    return {"rec": rec, "scope": scope}


def stats(sig, a, b):
    peak = 0.0
    nan = 0
    tiny = 0
    for v in sig[a:b]:
        if v != v or abs(v) == math.inf:
            nan += 1
            continue
        av = abs(v)
        peak = max(peak, av)
        if 0 < av < 1e-30:
            tiny += 1
    return peak, nan, tiny


def rising_pulses(ctl, sr, a, b, hi=0.5, lo=0.2):
    """Start times (s) of excursions that cross `hi`, re-armed below `lo`, and their peak heights."""
    out = []
    armed = True
    cur = None
    for i in range(a, b):
        v = ctl[i]
        if armed and v > hi:
            armed = False
            cur = [i, v]
        elif not armed:
            cur[1] = max(cur[1], v)
            if v < lo:
                armed = True
                out.append(cur)
                cur = None
    if cur is not None:
        out.append(cur)
    return [((i - a) / sr, h) for i, h in out]


def check_audio(case, res, errors):
    name = case["name"]
    if res is None:
        errors.append(f"{name}: no measurement")
        return
    rec, scope = res["rec"], res["scope"]
    out1, dry, ctl, out2 = rec[0], rec[1], rec[2], rec[3]
    sr = scope[6]
    n = len(dry)
    kind = case["kind"]
    if not (8000 <= sr <= 200000):
        errors.append(f"{name}: telemetry sample rate {sr}")
        return
    first = next((i for i, v in enumerate(dry) if abs(v) > 1e-9), None)
    if kind == "silence":
        peak, nan, tiny = stats(ctl, 0, n)
        print(f"sr {sr:.0f} ctlpeak {peak:.3e} idle {scope[9]:.0f} counter {scope[0]:.0f} nan {nan}")
        if nan or tiny:
            errors.append(f"{name}: nan {nan} denormal {tiny}")
        if peak != 0.0:
            errors.append(f"{name}: silence in, control peak {peak}")
        if scope[9] != 1.0:
            errors.append(f"{name}: idle flag {scope[9]} (expected 1 after 1.2 s of silence)")
        # the analysis stops once idle: about 1.2 s of hops (<= 235 at 44.1 kHz), not one per hop for 3 s
        hops_3s = 3.0 * sr / 256
        if scope[0] > 0.6 * hops_3s:
            errors.append(f"{name}: {scope[0]:.0f} telemetry hops in 3 s of silence (analysis did not sleep)")
        return
    if first is None:
        errors.append(f"{name}: dry input was silent")
        return
    t0 = first
    # bit-exact pass-through at the same index (zero latency)
    diff1 = max(abs(a - b) for a, b in zip(out1, dry))
    diff2 = max(abs(a - b) for a, b in zip(out2, dry))
    peak, nan, tiny = stats(ctl, 0, n)
    for ch_i, chan in enumerate(rec):
        _, nn, _ = stats(chan, 0, n)
        nan += nn if ch_i != 2 else 0
    print(f"sr {sr:.0f} thru diff L {diff1:.1e} R {diff2:.1e}  ctl peak {peak:.3f} nan {nan} tiny {tiny}  "
          f"hops {scope[0]:.0f} thr {scope[3]:.3f} trigcount {scope[8]:.0f}")
    if diff1 != 0.0 or diff2 != 0.0:
        errors.append(f"{name}: pass-through not bit exact (L {diff1:.2e}, R {diff2:.2e})")
    if nan or tiny:
        errors.append(f"{name}: nan {nan} denormal-range {tiny}")
    if scope[0] < 100:
        errors.append(f"{name}: only {scope[0]:.0f} telemetry hops")

    def seg_max(t_a, t_b):
        a = t0 + int(t_a * sr)
        b = min(n, t0 + int(t_b * sr))
        return max(ctl[a:b]) if b > a else 0.0

    sw = [seg_max(t, t + 0.35) for t in (1.0, 2.0, 3.0)]
    lv = [seg_max(t, t + 0.35) for t in (4.0, 5.0)]
    steady = [seg_max(t + 0.6, t + 0.95) for t in (1.0, 2.0, 3.0, 4.0, 5.0)]
    print(f"switch peaks {[round(v, 3) for v in sw]}  level-change peaks {[round(v, 3) for v in lv]}  "
          f"steady {[round(v, 3) for v in steady]}")

    if kind == "env":
        for t, v in zip((1, 2, 3), sw):
            if v < 0.25:
                errors.append(f"{name}: timbre switch at {t} s gave control peak {v:.3f} (< 0.25)")
        # the level changes must be far below the switch responses
        ref = min(sw)
        for t, v in zip((4, 5), lv):
            if v > 0.15 or v > 0.4 * ref:
                errors.append(f"{name}: +12 dB / -12 dB level change at {t} s gave {v:.3f} (switches {ref:.3f})")
        for t, v in zip((1, 2, 3, 4, 5), steady):
            if v > 0.1:
                errors.append(f"{name}: steady part after {t} s moves the control to {v:.3f}")
    if kind == "focus":
        # Focus +100 weighs texture (high-order MFCCs): the sine -> saw change still gets through, while the
        # brightness / body changes (saw -> noise -> saw) are largely rejected. Level changes stay at 0.
        if sw[0] < 0.15:
            errors.append(f"{name}: Focus +100 lost the sine -> saw change too ({sw[0]:.3f})")
        if max(sw[1], sw[2]) > 0.5 * sw[0]:
            errors.append(f"{name}: Focus +100 did not attenuate the low-order switches ({sw})")
        if max(lv) > 0.05:
            errors.append(f"{name}: level changes moved the control to {max(lv):.3f}")
    if kind == "trig":
        pulses = rising_pulses(ctl, sr, t0 + int(0.35 * sr), min(n, t0 + int(5.9 * sr)))
        times = [round(t + 0.35, 3) for t, _ in pulses]
        heights = [round(h, 3) for _, h in pulses]
        print(f"pulses at {times} s, heights {heights}")
        if len(pulses) != 3:
            errors.append(f"{name}: {len(pulses)} pulses {times}, expected 3 (one per timbre switch)")
        else:
            for (t, h), want in zip(pulses, (1.0, 2.0, 3.0)):
                if not (want - 0.02 <= t + 0.35 <= want + 0.3):
                    errors.append(f"{name}: pulse at {t + 0.35:.3f} s, expected within 0.3 s after {want}")
                if h < 0.97:
                    errors.append(f"{name}: pulse height {h:.3f}, expected a full 1.0 AD pulse")
        if scope[8] < 3:
            errors.append(f"{name}: telemetry trigger count {scope[8]:.0f}")

    # reference comparison
    mirror = case.get("mirror")
    if mirror:
        wav = REC_WAV
        out = subprocess.check_output(["node", COMPARE_JS, wav, str(sr), json.dumps(mirror), "0.3", "5.9"], text=True)
        cmp_res = json.loads(out.strip().splitlines()[-1])
        print(f"reference: hop phase {cmp_res['phase']} rms diff {cmp_res['rms']:.4f} max {cmp_res['max']:.3f} "
              f"corr {cmp_res['corr']:.4f} (peak ref {cmp_res['mirPeak']:.3f} gen {cmp_res['ctlPeak']:.3f})")
        if cmp_res["corr"] < 0.985 or cmp_res["rms"] > 0.03:
            errors.append(f"{name}: gen differs from src/timbre_ref.js (corr {cmp_res['corr']:.4f}, rms {cmp_res['rms']:.4f})")


def run_cpu(code, label, attempt=0):
    launch_prep()
    cpu_harness(code, CPU_INSTANCES, 9000, True)
    ok, log_size = run_max([CPU_RESULT], 60)
    if not ok:
        if attempt < RETRIES:
            return run_cpu(code, label, attempt + 1)
        print(f"--- cpu {label}: NO RESULT")
        dump_log(log_size)
        return None
    vals = {}
    for raw in open(CPU_RESULT):
        parts = raw.split()
        if len(parts) == 2:
            vals[parts[0]] = float(parts[1])
    if vals.get("samples", 0) < 4 or vals.get("alive", 0) < 1:
        if attempt < RETRIES:
            return run_cpu(code, label, attempt + 1)
        return None
    print(f"--- cpu {label}: mean {vals['cpu']:.2f} % peak {vals['cpupeak']:.2f} % ({vals['samples']:.0f} polls)")
    return vals


def main():
    if not os.path.exists(MAX_BIN):
        print(f"SKIP: Max binary not found at {MAX_BIN}")
        sys.exit(0)
    with open(LIB_PATH, encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, encoding="utf-8") as f:
        core = f.read()
    code = lib + "\n" + core
    only = sys.argv[1:]
    errors = []
    for case in audio_cases():
        if only and not any(case["name"].startswith(p) for p in only):
            continue
        res = run_audio(code, case)
        check_audio(case, res, errors)
    if "cpu" in only:
        base = run_cpu("out1 = in1;\nout2 = in2;\nout3 = 0;\n", "baseline")
        meta = run_cpu(code, "timbre")
        if base and meta:
            per = (meta["cpu"] - base["cpu"]) / CPU_INSTANCES
            print(f"cpu timbre: {per:.3f} % per instance")
    restore_audio_prefs()
    clear_recovery()
    if os.path.exists(HARNESS):
        os.remove(HARNESS)
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("All Real Max 9 Timbre Follower audio tests passed!")


if __name__ == "__main__":
    main()
