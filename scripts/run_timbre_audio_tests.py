#!/usr/bin/env python3
"""Render Timbre Follower (`src/timbre_core.genexpr`) through the Ableton-bundled Max 9.

Run it directly (shared scripts/max_harness.py, NonRealTime driver, no lock):  python3 scripts/run_timbre_audio_tests.py

The gen code is src/cepstrum_lib.genexpr + src/timbre_core.genexpr. A deterministic stimulus is written into
`buffer~ src` by tests/timbre_probe.js and read sample by sample (`index~`, driven by a gen counter) through the
core; the harness records 4 channels (out1, dry input, out3 control, out2), the probe writes them as a float32 WAV
and reports the `timbrescope` telemetry; both are analysed here.

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
import concurrent.futures
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
LIB_PATH = os.path.join(ROOT, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT, "src", "timbre_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "timbre_probe.js")
CPU_PROBE_JS = os.path.join(ROOT, "tests", "timbre_cpu_probe.js")
COMPARE_JS = os.path.join(ROOT, "tests", "timbre_mirror_compare.js")
SR = mh.DEFAULT_SR
CPU_INSTANCES = 8
WORKERS = 4


def timbre_gen(obj_id, code, x, y):
    return mh.gen_box(obj_id, code, x, y, numinlets=2, numoutlets=3)


def audio_device(code, case):
    """gen counter -> index~ src (the stimulus, sample exact) -> core; record out1, dry, out3 (control), out2."""
    boxes = [
        mh.msg("obj-params", case["params"], 380, 30, 420),
        mh.msg("obj-bind", "scope timbrescope", 380, 60, 140),
        mh.msg("obj-fillmsg", f"fill {SR}", 40, 180, 60),
        mh.box("obj-srcbuf", "buffer~ src 100", 560, 90, 100, outlettype=["float", "bang"], numoutlets=2),
        mh.box("obj-scopebuf", "buffer~ timbrescope @samps 2064", 560, 150, 190, outlettype=["float", "bang"], numoutlets=2),
        mh.gen_box("obj-counter", "History n(0);\nout1 = n;\nn = n + 1;\n", 100, 300, numinlets=1, numoutlets=1),
        mh.box("obj-playsrc", "index~ src", 100, 360, 80, numinlets=1, outlettype=["signal"]),
        timbre_gen("obj-gen", code, 380, 330),
    ]
    lines = [
        mh.line("obj-load", 0, "obj-params", 0),
        mh.line("obj-load", 0, "obj-bind", 0),
        mh.line("obj-load", 0, "obj-fillmsg", 0),
        mh.line("obj-fillmsg", 0, "obj-js", 0),
        mh.line("obj-params", 0, "obj-gen", 0),
        mh.line("obj-bind", 0, "obj-gen", 0),
        mh.line("obj-counter", 0, "obj-playsrc", 0),
        mh.line("obj-playsrc", 0, "obj-gen", 0),
        mh.line("obj-playsrc", 0, "obj-gen", 1),
        mh.line("obj-gen", 0, "obj-record", 0),
        mh.line("obj-playsrc", 0, "obj-record", 1),
        mh.line("obj-gen", 2, "obj-record", 2),
        mh.line("obj-gen", 1, "obj-record", 3),
        mh.line("obj-gen", 0, "obj-mute-l", 0),
    ]
    return boxes, lines


def cpu_device(code, count):
    boxes = [
        mh.msg("obj-params", "sens 50, attack 8, release 250, focus 0, mode 0", 200, 60, 340),
        mh.msg("obj-metro-on", "1", 40, 100, 30),
        mh.box("obj-metro", "metro 250", 40, 120, 80, numinlets=2, outlettype=["bang"]),
        mh.box("obj-cpu", "adstatus cpu", 40, 150, 100, outlettype=["float"]),
        mh.box("obj-noise", "noise~", 700, 40, 60, numinlets=1, outlettype=["signal"]),
        mh.box("obj-ng", "*~ 0.2", 700, 70, 50, numinlets=2, outlettype=["signal"]),
        mh.box("obj-sine", "cycle~ 440", 780, 40, 80, numinlets=2, outlettype=["signal"]),
        mh.box("obj-sg", "*~ 0.3", 780, 70, 50, numinlets=2, outlettype=["signal"]),
        mh.box("obj-sum", "+~", 700, 100, 40, numinlets=2, outlettype=["signal"]),
        mh.box("obj-snap", "snapshot~ 100", 700, 130, 90, numinlets=2, outlettype=["float"]),
    ]
    lines = [
        mh.line("obj-load", 0, "obj-params", 0),
        mh.line("obj-metro", 0, "obj-cpu", 0),
        mh.line("obj-cpu", 0, "obj-js", 0),
        mh.line("obj-snap", 0, "obj-js", 1),
        mh.line("obj-noise", 0, "obj-ng", 0),
        mh.line("obj-sine", 0, "obj-sg", 0),
        mh.line("obj-ng", 0, "obj-sum", 0),
        mh.line("obj-sg", 0, "obj-sum", 1),
        mh.line("obj-sum", 0, "obj-snap", 0),
    ]
    for k in range(count):
        boxes.append(timbre_gen(f"obj-gen{k}", code, 200 + 30 * k, 330 + 4 * k))
        lines += [mh.line("obj-params", 0, f"obj-gen{k}", 0), mh.line("obj-sum", 0, f"obj-gen{k}", 0),
                  mh.line("obj-sum", 0, f"obj-gen{k}", 1)]
    return boxes, lines


def read_raw(path, channels=4):
    """Headerless interleaved float32 (buffer~ writeraw) -> list of channel arrays (array('f'))."""
    flat = array.array("f")
    with open(path, "rb") as f:
        data = f.read()
    flat.frombytes(data[: len(data) // 4 * 4])
    # Max's `writeraw` always writes big-endian samples (verified: little-endian reads gave NaN / 3e38 garbage).
    if sys.byteorder == "little":
        flat.byteswap()
    return [flat[c::channels] for c in range(channels)]


def raw_to_wav(raw_path, wav_path, sr, channels=4):
    """Wrap the raw float32 file in a WAV header for tests/timbre_mirror_compare.js."""
    with open(raw_path, "rb") as f:
        data = f.read()
    data = data[: len(data) // 4 * 4]
    if sys.byteorder == "little":  # writeraw is big-endian, a float WAV is little-endian
        sw = array.array("f")
        sw.frombytes(data)
        sw.byteswap()
        data = sw.tobytes()
    n = len(data)
    hdr = b"RIFF" + (36 + n).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little")
    hdr += (3).to_bytes(2, "little") + channels.to_bytes(2, "little") + int(sr).to_bytes(4, "little")
    hdr += int(sr * channels * 4).to_bytes(4, "little") + (channels * 4).to_bytes(2, "little") + (32).to_bytes(2, "little")
    hdr += b"data" + n.to_bytes(4, "little")
    with open(wav_path, "wb") as f:
        f.write(hdr + data)


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


def run_audio_once(code, case):
    work = tempfile.mkdtemp(prefix=f"timbre_{case['name']}_")
    raw = os.path.join(work, "rec.raw")
    boxes, lines = audio_device(code, case)
    try:
        r = mh.run_case(f"timbre_{case['name']}", boxes, lines, probe_js=PROBE_JS,
                        probe_args=f"{case['scenario']} {raw}", settle_ms=0, dur_ms=case["dur"],
                        channels=4, sr=SR, timeout=300)
        res = {"rec": read_raw(raw), "scope": [r.get(f"s{i}", 0.0) for i in range(16)], "raw": raw}
        errs = []
        check_audio(case, res, errs)
        return errs
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run_audio(code, case):
    """Render and check one case (returns errors, report lines)."""
    _tls.lines = []
    try:
        errs = run_audio_once(code, case)
    except Exception as exc:  # noqa: BLE001
        errs = [f"{case['name']}: did not run ({exc})"]
    return errs, _tls.lines


_tls = threading.local()


def say(*parts):
    """check_audio runs inside worker threads: collect its lines so the report prints in case order."""
    _tls.lines.append(" ".join(str(p) for p in parts))


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
        say(f"sr {sr:.0f} ctlpeak {peak:.3e} idle {scope[9]:.0f} counter {scope[0]:.0f} nan {nan}")
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
    say(f"sr {sr:.0f} thru diff L {diff1:.1e} R {diff2:.1e}  ctl peak {peak:.3f} nan {nan} tiny {tiny}  "
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
    say(f"switch peaks {[round(v, 3) for v in sw]}  level-change peaks {[round(v, 3) for v in lv]}  "
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
        say(f"pulses at {times} s, heights {heights}")
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
        wav = res["raw"] + ".wav"
        raw_to_wav(res["raw"], wav, sr)
        out = subprocess.check_output(["node", COMPARE_JS, wav, str(sr), json.dumps(mirror), "0.3", "5.9"], text=True)
        cmp_res = json.loads(out.strip().splitlines()[-1])
        say(f"reference: hop phase {cmp_res['phase']} rms diff {cmp_res['rms']:.4f} max {cmp_res['max']:.3f} "
              f"corr {cmp_res['corr']:.4f} (peak ref {cmp_res['mirPeak']:.3f} gen {cmp_res['ctlPeak']:.3f})")
        if cmp_res["corr"] < 0.985 or cmp_res["rms"] > 0.03:
            errors.append(f"{name}: gen differs from src/timbre_ref.js (corr {cmp_res['corr']:.4f}, rms {cmp_res['rms']:.4f})")


def run_cpu(code, label):
    boxes, lines = cpu_device(code, CPU_INSTANCES)
    # Hardware-driver case: CPU load is only meaningful on the real audio device (holds the machine-wide lock).
    r = mh.run_case(f"timbre_cpu_{label}", boxes, lines, probe_js=CPU_PROBE_JS, settle_ms=0, dur_ms=9000,
                    channels=1, sr=SR, mode="audio_device", events=[(0, "obj-metro", 0, "1")], timeout=60)
    if r.get("samples", 0) < 4 or r.get("alive", 0) < 1:
        print(f"--- cpu {label}: NO USABLE RESULT")
        return None
    print(f"--- cpu {label}: mean {r['cpu']:.2f} % peak {r['cpupeak']:.2f} % ({r['samples']:.0f} polls)")
    return r


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"SKIP: Max binary not found at {mh.MAX_BIN}")
        sys.exit(0)
    with open(LIB_PATH, encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, encoding="utf-8") as f:
        core = f.read()
    code = lib + "\n" + core
    only = sys.argv[1:]
    errors = []
    cases = [c for c in audio_cases() if not only or any(c["name"].startswith(p) for p in only)]
    # check_audio prints its measurements, so run the cases one after another in the printing order
    # while the Max renders themselves overlap: rendering happens inside run_audio_once.
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [(c, ex.submit(run_audio, code, c)) for c in cases]
        for case, fut in futs:
            errs, lines = fut.result()
            print(f"--- {case['name']} ---")
            print("\n".join(lines))
            errors += errs
    if "cpu" in only:
        base = run_cpu("out1 = in1;\nout2 = in2;\nout3 = 0;\n", "baseline")
        meta = run_cpu(code, "timbre")
        if base and meta:
            per = (meta["cpu"] - base["cpu"]) / CPU_INSTANCES
            print(f"cpu timbre: {per:.3f} % per instance")
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("All Real Max 9 Timbre Follower audio tests passed!")


if __name__ == "__main__":
    main()
