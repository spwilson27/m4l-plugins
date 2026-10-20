#!/usr/bin/env python3
"""Render the shared cepstrum/STFT library through the Ableton-bundled Max.

The gen code is src/cepstrum_lib.genexpr + tests/cepstrum_lib_core.genexpr.
Audio cases (noise + 440 Hz sine in, 4-channel recording):
  ident_N     — identity STFT is unity gain after exactly N - 1 samples, no clicks
  minphase_N  — minimum-phase pass stays finite and bounded, same level
  maxphase_N  — same for the maximum-phase fold
  roundtrip_N — cepstrum -> log magnitude -> original phase is also identity
  silent_N    — silence in gives exact zeros out (no NaN, no denormals)
  pitch_N     — the cepstral peak finds a 150 sample pulse train
  pad_N       — Delay padding gives a constant 4096 samples of latency for every N
  switch_*    — changing N while running stays finite and settles at unity
CPU cases (8 instances, [adstatus cpu]): ident and minphase at each N, minus a
pass-through baseline.

Usage: run_cepstrum_lib_audio_tests.py [case-prefix ...]   (e.g. ident cpu)
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
CORE_PATH = os.path.join(ROOT, "tests", "cepstrum_lib_core.genexpr")
EXPECT_JS = os.path.join(ROOT, "tests", "cepstrum_lib_expect.js")
PROBE_JS = os.path.join(ROOT, "tests", "cepstrum_lib_probe.js")
HARNESS = os.path.join(ROOT, "tests", "cepstrum_lib_harness.maxpat")
RESULT = "/tmp/cepstrum_lib_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
MAX_LOG = os.path.expanduser(
    "~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log"
)
SIZES = (512, 1024, 2048, 4096)
NSAMP = 30000  # samples analysed: the recording holds at least this at 24 kHz
SKIP = 16384  # samples ignored at the start: > 4 frames of the largest N
RETRIES = 3  # Max or the shared audio device occasionally fails to start
CPU_INSTANCES = 8
PASSTHROUGH = "out1 = in1;\nout2 = 0;\nout3 = 0;\n"


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
    return {
        "box": {
            "code": code,
            "fontname": "<Monospaced>",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "gen.codebox~",
            "numinlets": 1,
            "numoutlets": 3,
            "outlettype": ["signal", "signal", "signal"],
            "patching_rect": [float(x), float(y), 200.0, 60.0],
        }
    }


def write_patch(boxes, lines):
    doc = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [40.0, 40.0, 1000.0, 600.0],
            "boxes": boxes,
            "lines": lines,
        }
    }
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def source_chain(silent):
    """noise + sine -> optional mute; returns boxes, lines, id of the signal."""
    boxes = [
        box("obj-noise", "noise~", 700, 40, 60, 20, numinlets=1, outlettype=["signal"]),
        box("obj-ng", "*~ 0.2", 700, 70, 50, 20, numinlets=2, outlettype=["signal"]),
        box("obj-sine", "cycle~ 440", 780, 40, 80, 20, numinlets=2, outlettype=["signal"]),
        box("obj-sg", "*~ 0.3", 780, 70, 50, 20, numinlets=2, outlettype=["signal"]),
        box("obj-sum", "+~", 700, 100, 40, 20, numinlets=2, outlettype=["signal"]),
        box("obj-mute", "*~ 0" if silent else "*~ 1", 700, 130, 50, 20, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        line("obj-noise", 0, "obj-ng", 0),
        line("obj-sine", 0, "obj-sg", 0),
        line("obj-ng", 0, "obj-sum", 0),
        line("obj-sg", 0, "obj-sum", 1),
        line("obj-sum", 0, "obj-mute", 0),
    ]
    return boxes, lines


def build_audio_harness(code, case):
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 800", 40, 80, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 120, 80),
        box("obj-del-arm", "delay 200", 40, 160, 80, 20, numinlets=2),
        msg("obj-rec-on", "1", 40, 200, 30),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2),
        msg("obj-rec-off", "0", 40, 280, 30),
        box("obj-del-analyze", "delay 120", 40, 320, 80, 20, numinlets=2),
        msg("obj-analyze", f"analyze {NSAMP} {case['maxlag']}", 40, 360, 140),
        msg("obj-quit", "; max quit", 40, 420, 70),
        msg("obj-params", case["params"], 200, 40, 460),
        box("obj-recbuf", "buffer~ rec @samps 131072 @chans 4", 520, 140, 140, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        gen_box("obj-gen", code, 200, 200),
        box("obj-record", "record~ rec 4", 200, 300, 90, 20, numinlets=5),
        box("obj-js", f"js {PROBE_JS} {RESULT} {SKIP}", 200, 470, 360, 20, outlettype=["bang"]),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-analyze", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-analyze", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-mute", 0, "obj-record", 1),
        line("obj-gen", 1, "obj-record", 2),
        line("obj-gen", 2, "obj-record", 3),
        line("obj-mute", 0, "obj-gen", 0),
    ]
    sb, sl = source_chain(case.get("silent", False))
    write_patch(boxes + sb, lines + sl)


def build_cpu_harness(code, params, count, dur):
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 800", 40, 80, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 120, 80),
        box("obj-metro", "metro 250", 40, 160, 80, 20, numinlets=2),
        box("obj-snap", "snapshot~ 100", 40, 180, 90, 20, numinlets=2, outlettype=["float"]),
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
        line("obj-snap", 0, "obj-js", 1),
        line("obj-ng", 0, "obj-snap", 0),
        line("obj-del-fin", 0, "obj-finish", 0),
        line("obj-finish", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
    ]
    for k in range(count):
        boxes.append(gen_box(f"obj-gen{k}", code, 200 + 30 * k, 200 + 4 * k))
        lines += [line("obj-params", 0, f"obj-gen{k}", 0), line("obj-mute", 0, f"obj-gen{k}", 0)]
    sb, sl = source_chain(False)
    write_patch(boxes + sb, lines + sl)


def audio_cases():
    base = "src 0, per 150"
    out = []
    for n in SIZES:
        dur = 1500
        for name, mode, extra in (
            ("ident", 0, {}),
            ("minphase", 1, {}),
            ("maxphase", 4, {}),
            ("roundtrip", 2, {}),
        ):
            out.append({
                "name": f"{name}_{n}", "kind": name, "n": n, "dur": dur, "maxlag": 4200,
                "params": f"fftn {n}, mode {mode}, {base}",
            })
        out.append({
            "name": f"silent_{n}", "kind": "silent", "n": n, "dur": 1500, "maxlag": 4200, "silent": True,
            "params": f"fftn {n}, mode 1, {base}",
        })
    for n in (2048, 4096):
        out.append({
            "name": f"pitch_{n}", "kind": "pitch", "n": n, "dur": 1500, "maxlag": 100,
            "params": f"fftn {n}, mode 3, src 1, per 150",
        })
    # Delay padding to a constant 4096 samples of total latency.
    for n in (512, 4096):
        out.append({
            "name": f"pad_{n}", "kind": "pad", "n": n, "dur": 1500, "maxlag": 4200,
            "params": f"fftn {n}, mode 0, src 0, pad 1",
        })
    # N changes while running: the ring and accumulator reset, then unity again.
    for name, first, last in (("switch_down", 4096, 512), ("switch_up", 512, 4096)):
        out.append({
            "name": name, "kind": "switch", "n": last, "dur": 1500, "maxlag": 4200,
            "params": f"fftn {first}, fftn2 {last}, swsec 0.05, mode 0, src 0, per 150",
        })
    return out


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        if raw.strip():
            key, val = raw.split(None, 1)
            meta[key] = float(val)
    return meta


def clear_recovery():
    recovery = os.path.expanduser(
        "~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"
    )
    shutil.rmtree(recovery, ignore_errors=True)


def dump_log(log_size):
    if not os.path.exists(MAX_LOG):
        return
    log = open(MAX_LOG, errors="replace").read()
    new = log[log_size:] if log_size < len(log) else log[-8000:]
    interesting = [
        ln for ln in new.splitlines()
        if any(k in ln.lower() for k in ("error", "failed", "probe_")) and ln.strip()[-1:] != "]"
    ]
    if interesting:
        print("--- max log ---")
        print("\n".join(interesting[-12:]))


AUDIO_PREFS = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Settings/audioprefs.txt")
GOOD_PREFS = 'max v2;dsp prefdrivername "Core Audio";dsp prefsubname ;'


def restore_audio_prefs():
    """Max falls back to the NonRealTime driver when the audio device is busy and
    saves that choice, which breaks every later run (wrong sample rate, no
    real-time clock). Put Core Audio back before each launch."""
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


def launch(timeout):
    # A previous Max can write Crash Recovery after it is killed, and the next
    # launch then opens that patch on top of the harness.
    subprocess.run(["pkill", "-f", "cepstrum_lib_harness.maxpat"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        if subprocess.run(["pgrep", "-f", "cepstrum_lib_harness.maxpat"], stdout=subprocess.DEVNULL).returncode != 0:
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
        # Wait until the report exists and its size has stopped changing.
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
    launch(30)
    build_audio_harness(code, case)
    meta, log_size = run_max(40)
    print(f"--- {case['name']} ---")
    if meta is None:
        print("NO RESULT FILE")
        dump_log(log_size)
        if attempt < RETRIES:
            print(f"{case['name']}: no result (Max or the audio device did not start), retrying")
            return run_audio(code, case, attempt + 1)
        return None
    meta["sr"] = round(meta["conf"] * 1e5) if case["kind"] != "pitch" else 0
    print(
        f"sr {meta['sr']:.0f} lag {meta.get('lag'):.0f} gain {meta.get('gaindb'):.3f} dB err {meta.get('errdb'):.1f} dB "
        f"maxerr {meta.get('maxerr'):.2e} peak {meta.get('outpeak'):.3f} rms {meta.get('outrms'):.4f} "
        f"dry {meta.get('dryrms'):.3f} nan {meta.get('nan'):.0f} tiny {meta.get('tiny'):.0f} "
        f"q {meta.get('q'):.2f} conf {meta.get('conf'):.2f}"
    )
    dump_log(log_size)
    if attempt < RETRIES and not case.get("silent") and meta.get("dryrms", 0) < 0.05:
        print(f"{case['name']}: input was silent, retrying")
        return run_audio(code, case, attempt + 1)
    return meta


def run_cpu(code, label, params, attempt=0):
    launch(30)
    dur = 9000
    build_cpu_harness(code, params, CPU_INSTANCES, dur)
    meta, log_size = run_max(60)
    if meta is None or meta.get("samples", 0) < 4 or meta.get("alive", 0) < 1:
        if attempt < RETRIES:
            return run_cpu(code, label, params, attempt + 1)
        print(f"--- cpu {label}: NO RESULT")
        dump_log(log_size)
        return None
    print(f"--- cpu {label}: mean {meta['cpu']:.2f} % peak {meta['cpupeak']:.2f} % ({meta['samples']:.0f} polls)")
    return meta


def check_audio(case, meta, errors):
    name = case["name"]
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    kind = case["kind"]
    n = case["n"]
    if meta["nan"] != 0:
        errors.append(f"{name}: {meta['nan']:.0f} non-finite samples")
    if meta["tiny"] != 0:
        errors.append(f"{name}: {meta['tiny']:.0f} denormal-range samples")
    if kind in ("ident", "roundtrip"):
        if meta["lag"] != n - 1:
            errors.append(f"{name}: latency {meta['lag']:.0f} samples, expected {n - 1}")
        if abs(meta["gaindb"]) > 0.5:
            errors.append(f"{name}: gain {meta['gaindb']:.3f} dB is not unity")
        floor = -60 if kind == "ident" else -45
        if meta["errdb"] > floor:
            errors.append(f"{name}: residual {meta['errdb']:.1f} dB above {floor} dB")
        if meta["maxerr"] > (2e-3 if kind == "ident" else 2e-2):
            errors.append(f"{name}: sample error {meta['maxerr']:.2e} (click)")
    elif kind in ("minphase", "maxphase"):
        # The reference runs the same math, so the level must agree within 2 dB.
        level = 20 * math.log10(max(meta["outrms"], 1e-12) / max(meta["dryrms"], 1e-12))
        want = float(subprocess.check_output(
            ["node", EXPECT_JS, "min" if kind == "minphase" else "max", str(n), str(meta["sr"])], text=True))
        if abs(level - want) > 2.0:
            errors.append(f"{name}: level {level:.2f} dB, reference {want:.2f} dB")
        if meta["outpeak"] > 3.0:
            errors.append(f"{name}: peak {meta['outpeak']}")
    elif kind == "pad":
        if meta["lag"] != 4096 or abs(meta["gaindb"]) > 0.5:
            errors.append(f"{name}: padded latency {meta['lag']:.0f} (expected 4096), gain {meta['gaindb']:.3f} dB")
    elif kind == "silent":
        if meta["outpeak"] > 1e-12:
            errors.append(f"{name}: silence in, peak {meta['outpeak']} out")
    elif kind == "pitch":
        if abs(meta["q"] - 150.0) > 0.6:
            errors.append(f"{name}: pitch quefrency {meta['q']:.2f}, expected 150")
        if meta["conf"] < 0.5:
            errors.append(f"{name}: confidence {meta['conf']:.2f}")
    elif kind == "switch":
        if meta["q"] != n or meta["lag"] != n - 1 or abs(meta["gaindb"]) > 0.5:
            errors.append(f"{name}: N {meta['q']:.0f} lag {meta['lag']:.0f} gain {meta['gaindb']:.3f} after the change")
        if meta["outpeak"] > 0.6:
            errors.append(f"{name}: peak {meta['outpeak']} after the change")


def main():
    with open(LIB_PATH, encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, encoding="utf-8") as f:
        core = f.read()
    code = lib + "\n" + core
    only = sys.argv[1:]
    errors = []
    latencies = {}
    for case in audio_cases():
        if only and not any(case["name"].startswith(p) for p in only):
            continue
        meta = run_audio(code, case)
        check_audio(case, meta, errors)
        if meta and case["kind"] == "ident":
            latencies[case["n"]] = meta["lag"]
    if latencies:
        print("measured latency (samples):", {k: int(v) for k, v in sorted(latencies.items())})

    if not only or "cpu" in only:
        base = run_cpu(PASSTHROUGH, "baseline", "fftn 1024")
        base_cpu = base["cpu"] if base else 0.0
        for mode_name, mode in (("ident", 0), ("minphase", 1)):
            for n in SIZES:
                meta = run_cpu(code, f"{mode_name}_{n}", f"fftn {n}, mode {mode}, src 0")
                if meta is None:
                    errors.append(f"cpu {mode_name}_{n}: no measurement")
                    continue
                per = (meta["cpu"] - base_cpu) / CPU_INSTANCES
                print(f"cpu {mode_name}_{n}: {per:.3f} % per instance")
                if per > 4.0:
                    errors.append(f"cpu {mode_name}_{n}: {per:.2f} % per instance is too high")
    restore_audio_prefs()
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
