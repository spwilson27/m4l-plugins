#!/usr/bin/env python3
"""Render Phase Fold's gen core through the Ableton-bundled Max (real audio).

Run through the shared lock:
    python3 scripts/max_lock.py python3 scripts/run_phasefold_audio_tests.py [case-prefix ...]

The gen code is src/cepstrum_lib.genexpr + src/phasefold_core.genexpr, the same
text the three devices embed. A second gen.codebox~ generates the test signals
(noise, a kick train, kick + snare drums, a sine, silence), so every run is
deterministic. Cases:
  dry0_*     Mix 0: the output is the input delayed by exactly 4096 samples
  ident_N    Orig 100%, Mix 100%: wet is the input delayed by exactly 4096 at every Size
  mix50      Orig 100%, Mix 50%: wet and dry line up (the sum is +3.01 dB, no comb loss)
  pre_*      kick train: pre-ring energy before the attack at -100, none at +100
  lvl_*      noise and drums: loudness within 1.5 dB of the input at every Phase
  silent     silence in, exact zeros out
  sw_*       Size switches while a sine plays: no step above the sine's own slope
  tel_*      telemetry buffer: heartbeat, FFT size, centroid at both Phase extremes
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
CORE_PATH = os.path.join(ROOT, "src", "phasefold_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "phasefold_probe.js")
HARNESS = os.path.join(ROOT, "tests", "phasefold_harness.maxpat")
RESULT = "/tmp/phasefold_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
MAX_LOG = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log")
AUDIO_PREFS = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Settings/audioprefs.txt")
GOOD_PREFS = 'max v2;dsp prefdrivername "Core Audio";dsp prefsubname ;'
RETRIES = 3
SKIP = 24000  # samples ignored at the start (> the 4160 + n hold and the fade-in)
REC_MS = 3400

SRC_CODE = """// Test signal generator for the Phase Fold audio tests.
// srcmode 0 noise, 1 kick train, 2 kick + snare, 3 silence, 4 sine 220 Hz.
Param srcmode(0);
History tc(0);
History sph(0);
tc = wrap(tc + 1, 0, samplerate * 0.5);
t = tc / samplerate;
nz = noise();
kick = 0.8 * exp(-t * 25) * sin(6.283185307179586 * (55 * t + 3 * (1 - exp(-t * 40))));
snon = t >= 0.25 ? 1 : 0;
sn = snon * nz * exp(-max(t - 0.25, 0) * 30) * 0.5;
sph = wrap(sph + 220 / samplerate, 0, 1);
sinv = sin(6.283185307179586 * sph) * 0.3;
sel0 = srcmode < 0.5 ? 1 : 0;
sel1 = (srcmode > 0.5 && srcmode < 1.5) ? 1 : 0;
sel2 = (srcmode > 1.5 && srcmode < 2.5) ? 1 : 0;
sel4 = srcmode > 3.5 ? 1 : 0;
x = sel0 * nz * 0.35 + sel1 * kick + sel2 * (kick + sn) + sel4 * sinv;
out1 = x;
out2 = samplerate * 0.00001;
"""


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


def gen_box(obj_id, code, x, y, inlets, outlets):
    return {
        "box": {
            "code": code,
            "fontname": "<Monospaced>",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "gen.codebox~",
            "numinlets": inlets,
            "numoutlets": outlets,
            "outlettype": ["signal"] * outlets,
            "patching_rect": [float(x), float(y), 200.0, 60.0],
        }
    }


def build_harness(code, case):
    params = (
        f"phaseamt {case['phase']}, sizeidx {case['size']}, orig {case.get('orig', 0)}, "
        f"autog {case.get('ag', 1)}, mixpct {case.get('mix', 100)}, outdb 0"
    )
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, outlettype=["bang"]),
        box("obj-del-dsp", "delay 800", 40, 80, 80, 20, numinlets=2),
        msg("obj-dsp", "; dsp start", 40, 120, 80),
        box("obj-del-arm", "delay 200", 40, 160, 80, 20, numinlets=2),
        msg("obj-rec-on", "1", 40, 200, 30),
        box("obj-del-stop", f"delay {REC_MS}", 40, 240, 80, 20, numinlets=2),
        msg("obj-rec-off", "0", 40, 280, 30),
        box("obj-del-analyze", "delay 150", 40, 320, 80, 20, numinlets=2),
        msg("obj-analyze", "analyze 262144", 40, 360, 140),
        msg("obj-quit", "; max quit", 40, 420, 70),
        msg("obj-params", params, 200, 40, 460),
        msg("obj-srcparams", f"srcmode {case['src']}", 200, 70, 120),
        msg("obj-bind", "scope pfscope", 200, 100, 120),
        box("obj-scope", "buffer~ pfscope 100 4", 520, 100, 160, 20, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec @samps 262144 @chans 4", 520, 140, 200, 20, numoutlets=2, outlettype=["float", "bang"]),
        gen_box("obj-src", SRC_CODE, 520, 200, 1, 2),
        gen_box("obj-gen", code, 200, 200, 2, 2),
        box("obj-record", "record~ rec 4", 200, 300, 90, 20, numinlets=5),
        box("obj-js", f"js {PROBE_JS} {RESULT} {SKIP}", 200, 470, 360, 20, outlettype=["bang"]),
    ]
    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-srcparams", 0),
        line("obj-load", 0, "obj-bind", 0),
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
        line("obj-bind", 0, "obj-gen", 0),
        line("obj-srcparams", 0, "obj-src", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-src", 0, "obj-gen", 0),
        line("obj-src", 0, "obj-gen", 1),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-src", 0, "obj-record", 1),
        line("obj-gen", 1, "obj-record", 2),
        line("obj-src", 1, "obj-record", 3),
    ]
    if "switch_to" in case:
        boxes += [
            box("obj-del-sw", f"delay {800 + case['switch_at']}", 40, 480, 90, 20, numinlets=2),
            msg("obj-sw", f"sizeidx {case['switch_to']}", 40, 520, 110),
        ]
        lines += [
            line("obj-load", 0, "obj-del-sw", 0),
            line("obj-del-sw", 0, "obj-sw", 0),
            line("obj-sw", 0, "obj-gen", 0),
        ]
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


def parse_result(text):
    meta = {}
    for raw in text.splitlines():
        if raw.strip():
            key, val = raw.split(None, 1)
            meta[key] = float(val)
    return meta


def clear_recovery():
    shutil.rmtree(
        os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"),
        ignore_errors=True,
    )


def restore_audio_prefs():
    """Max falls back to the NonRealTime driver when the audio device is busy and
    saves that choice, which breaks every later run. Put Core Audio back."""
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
        if any(k in ln.lower() for k in ("error", "failed", "probe_")) and ln.strip()[-1:] != "]"
    ]
    if interesting:
        print("--- max log ---")
        print("\n".join(interesting[-12:]))


def launch():
    subprocess.run(["pkill", "-f", "phasefold_harness.maxpat"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(20):
        if subprocess.run(["pgrep", "-f", "phasefold_harness.maxpat"], stdout=subprocess.DEVNULL).returncode != 0:
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
        # wait until the report exists and its size has stopped changing
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


def run_case(code, case, attempt=0):
    launch()
    build_harness(code, case)
    meta, log_size = run_max(45)
    print(f"--- {case['name']} ---")
    if meta is None:
        print("NO RESULT FILE")
        dump_log(log_size)
        if attempt < RETRIES:
            print(f"{case['name']}: no result (Max or the audio device did not start), retrying")
            return run_case(code, case, attempt + 1)
        return None
    print(
        f"sr {meta['sr']:.0f} lag {meta['lag']:.0f} gain {meta['gaindb']:.2f} dB err {meta['errdb']:.1f} dB "
        f"pre {meta['pre']:.3f} ({meta['onsets']:.0f}) step {meta['maxstep']:.4f} peak {meta['outpeak']:.3f} "
        f"dry {meta['dryrms']:.3f} nan {meta['nan']:.0f} | beat {meta['beat']:.0f} n {meta['nact']:.0f} "
        f"cout {meta['cout']:.2f} cin {meta['cin']:.2f} g {meta['gdb']:.1f} dB"
    )
    dump_log(log_size)
    if attempt < RETRIES and case["src"] != 3 and meta.get("dryrms", 0) < 0.02:
        print(f"{case['name']}: input was silent, retrying")
        return run_case(code, case, attempt + 1)
    return meta


NOISE, KICK, DRUMS, SILENCE, SINE = 0, 1, 2, 3, 4


def cases():
    out = []
    out.append({"name": "dry0_noise", "kind": "dry0", "src": NOISE, "phase": -100, "size": 3, "mix": 0})
    out.append({"name": "dry0_drums", "kind": "dry0", "src": DRUMS, "phase": 100, "size": 0, "mix": 0})
    for i, n in enumerate((512, 1024, 2048, 4096)):
        out.append({"name": f"ident_{n}", "kind": "ident", "src": NOISE, "phase": -100, "size": i, "orig": 100, "n": n})
    out.append({"name": "mix50", "kind": "mix50", "src": NOISE, "phase": -100, "size": 1, "orig": 100, "mix": 50})
    out.append({"name": "pre_m100_4096", "kind": "pre_max", "src": KICK, "phase": -100, "size": 3, "min_pre": 0.15})
    out.append({"name": "pre_m100_2048", "kind": "pre_max", "src": KICK, "phase": -100, "size": 2, "min_pre": 0.08})
    out.append({"name": "pre_p100_4096", "kind": "pre_min", "src": KICK, "phase": 100, "size": 3})
    out.append({"name": "pre_p100_2048", "kind": "pre_min", "src": KICK, "phase": 100, "size": 2})
    for src, nm in ((NOISE, "noise"), (DRUMS, "drums")):
        for ph in (-100, 0, 100):
            out.append({
                "name": f"lvl_{nm}_{ph}", "kind": "lvl", "src": src, "phase": ph, "size": 2, "group": nm,
            })
    out.append({"name": "lvl_drums_orig50", "kind": "lvl", "src": DRUMS, "phase": -100, "size": 2, "orig": 50, "group": "o50"})
    out.append({"name": "silent", "kind": "silent", "src": SILENCE, "phase": -100, "size": 2})
    out.append({"name": "sw_down", "kind": "switch", "src": SINE, "phase": 0, "size": 3, "orig": 100,
                "switch_at": 1500, "switch_to": 0})
    out.append({"name": "sw_up", "kind": "switch", "src": SINE, "phase": 0, "size": 0, "orig": 100,
                "switch_at": 1500, "switch_to": 3})
    out.append({"name": "sw_phase", "kind": "switch", "src": SINE, "phase": -100, "size": 2, "orig": 0,
                "switch_at": 1500, "switch_to": 1, "loose": True})
    out.append({"name": "tel_min", "kind": "tel_min", "src": NOISE, "phase": 100, "size": 2})
    out.append({"name": "tel_max", "kind": "tel_max", "src": NOISE, "phase": -100, "size": 2})
    return out


def check(case, meta, errors, groups):
    name = case["name"]
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    kind = case["kind"]
    if meta["nan"] != 0:
        errors.append(f"{name}: {meta['nan']:.0f} non-finite samples")
    if meta["tiny"] != 0:
        errors.append(f"{name}: {meta['tiny']:.0f} denormal-range samples")
    if meta["beat"] < 20:
        errors.append(f"{name}: telemetry heartbeat {meta['beat']:.0f} (buffer not updating)")
    if kind == "dry0":
        if meta["lag"] != 4096 or abs(meta["gaindb"]) > 0.05 or meta["errdb"] > -80:
            errors.append(f"{name}: dry path lag {meta['lag']:.0f} gain {meta['gaindb']:.3f} err {meta['errdb']:.1f}")
    elif kind == "ident":
        if meta["lag"] != 4096:
            errors.append(f"{name}: wet lag {meta['lag']:.0f}, expected 4096 at every Size")
        if abs(meta["gaindb"]) > 0.3 or meta["errdb"] > -50:
            errors.append(f"{name}: identity gain {meta['gaindb']:.3f} dB err {meta['errdb']:.1f} dB")
        if abs(meta["nact"] - case["n"]) > 0.5:
            errors.append(f"{name}: telemetry size {meta['nact']:.0f}")
    elif kind == "mix50":
        if abs(meta["gaindb"] - 3.0103) > 0.15:
            errors.append(f"{name}: dry/wet misaligned, sum {meta['gaindb']:.3f} dB (expected +3.01)")
    elif kind == "pre_max":
        if meta["onsets"] < 3 or meta["pre"] < case["min_pre"]:
            errors.append(f"{name}: pre-ring fraction {meta['pre']:.3f} over {meta['onsets']:.0f} hits (need {case['min_pre']})")
    elif kind == "pre_min":
        if meta["onsets"] < 3 or meta["pre"] > 0.03:
            errors.append(f"{name}: pre-ring fraction {meta['pre']:.3f} at +100 (should be absent)")
    elif kind == "lvl":
        groups.setdefault(case["group"], []).append(meta["gaindb"])
        if abs(meta["gaindb"]) > 1.5:
            errors.append(f"{name}: level {meta['gaindb']:.2f} dB vs the input")
    elif kind == "silent":
        if meta["outpeak"] > 1e-12 or meta["outrpeak"] > 1e-12:
            errors.append(f"{name}: silence in, peak {meta['outpeak']} out")
    elif kind == "switch":
        # a sine at 0.3 has a largest step of about 0.009 per sample; allow 0.015
        limit = 0.015 if not case.get("loose") else 0.05
        if meta["maxstep"] > limit:
            errors.append(f"{name}: click, step {meta['maxstep']:.4f} (limit {limit})")
        if not case.get("loose") and abs(20 * math.log10(max(meta["tailout"], 1e-9) / max(meta["taildry"], 1e-9))) > 1.0:
            errors.append(f"{name}: level after the Size change {meta['tailout']:.4f} vs {meta['taildry']:.4f}")
        want = 512 * 2 ** case["switch_to"]
        if abs(meta["nact"] - want) > 0.5:
            errors.append(f"{name}: telemetry size {meta['nact']:.0f} after the switch (expected {want})")
    elif kind == "tel_min":
        if meta["cout"] > 0.35 or meta["wenv"] < 0.02:
            errors.append(f"{name}: output centroid {meta['cout']:.2f} at +100 (expected near frame start), env {meta['wenv']:.3f}")
    elif kind == "tel_max":
        if meta["cout"] < 0.65 or meta["wenv"] < 0.02:
            errors.append(f"{name}: output centroid {meta['cout']:.2f} at -100 (expected near frame end), env {meta['wenv']:.3f}")
    if kind in ("tel_min", "tel_max") and abs(meta["cin"] - 0.5) > 0.15:
        errors.append(f"{name}: input centroid {meta['cin']:.2f}")


def main():
    with open(LIB_PATH, encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, encoding="utf-8") as f:
        core = f.read()
    code = lib + "\n" + core
    only = sys.argv[1:]
    errors = []
    groups = {}
    for case in cases():
        if only and not any(case["name"].startswith(p) for p in only):
            continue
        meta = run_case(code, case)
        check(case, meta, errors, groups)
    for grp, vals in groups.items():
        if grp in ("noise", "drums") and len(vals) == 3:
            spread = max(vals) - min(vals)
            print(f"level spread across Phase ({grp}): {spread:.2f} dB  {[round(v, 2) for v in vals]}")
            if spread > 1.5:
                errors.append(f"{grp}: level spread {spread:.2f} dB across Phase")
    restore_audio_prefs()
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
