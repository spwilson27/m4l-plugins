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

import concurrent.futures
import json
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
LIB_PATH = os.path.join(ROOT, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT, "tests", "cepstrum_lib_core.genexpr")
EXPECT_JS = os.path.join(ROOT, "tests", "cepstrum_lib_expect.js")
PROBE_JS = os.path.join(ROOT, "tests", "cepstrum_lib_probe.js")
SR = mh.DEFAULT_SR
SIZES = (512, 1024, 2048, 4096)
NSAMP = 30000  # samples analysed from the start of the measured window
SKIP = 16384  # samples ignored at the start: > 4 frames of the largest N
SETTLE_MS = 200
CPU_INSTANCES = 8
CPU_DUR_MS = 9000
PASSTHROUGH = "out1 = in1;\nout2 = 0;\nout3 = 0;\n"
WORKERS = 4


def expected_level(kind, n, sr):
    """Reference level change (dB). The VM has no node: use the host-generated tests/cepstrum_lib_expect.json
    (`node tests/cepstrum_lib_expect.js --all`); fall back to running node when it is available."""
    key = f"{kind}_{n}_{int(sr)}"
    path = os.path.join(ROOT, "tests", "cepstrum_lib_expect.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            table = json.load(f)
        if key in table:
            return float(table[key])
    return float(subprocess.check_output(["node", EXPECT_JS, kind, str(n), str(int(sr))], text=True))


def cep_gen(obj_id, code, x, y):
    return mh.gen_box(obj_id, code, x, y, numinlets=1, numoutlets=3)


def source_chain(silent):
    """noise + sine -> optional mute; the signal is obj-mute."""
    boxes = [
        mh.box("obj-noise", "noise~", 700, 40, 60, numinlets=1, outlettype=["signal"]),
        mh.box("obj-ng", "*~ 0.2", 700, 70, 50, numinlets=2, outlettype=["signal"]),
        mh.box("obj-sine", "cycle~ 440", 780, 40, 80, numinlets=2, outlettype=["signal"]),
        mh.box("obj-sg", "*~ 0.3", 780, 70, 50, numinlets=2, outlettype=["signal"]),
        mh.box("obj-sum", "+~", 700, 100, 40, numinlets=2, outlettype=["signal"]),
        mh.box("obj-mute", "*~ 0" if silent else "*~ 1", 700, 130, 50, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("obj-noise", 0, "obj-ng", 0),
        mh.line("obj-sine", 0, "obj-sg", 0),
        mh.line("obj-ng", 0, "obj-sum", 0),
        mh.line("obj-sg", 0, "obj-sum", 1),
        mh.line("obj-sum", 0, "obj-mute", 0),
    ]
    return boxes, lines


def audio_boxes(code, case):
    boxes = [
        mh.msg("obj-params", case["params"], 200, 40, 460),
        cep_gen("obj-gen", code, 200, 200),
    ]
    lines = [
        mh.line("obj-load", 0, "obj-params", 0),
        mh.line("obj-params", 0, "obj-gen", 0),
        mh.line("obj-gen", 0, "obj-record", 0),
        mh.line("obj-mute", 0, "obj-record", 1),
        mh.line("obj-gen", 1, "obj-record", 2),
        mh.line("obj-gen", 2, "obj-record", 3),
        mh.line("obj-mute", 0, "obj-gen", 0),
        mh.line("obj-gen", 0, "obj-mute-l", 0),
    ]
    sb, sl = source_chain(case.get("silent", False))
    return boxes + sb, lines + sl


def cpu_device(code, params, count):
    boxes = [
        mh.msg("obj-params", params, 200, 40, 460),
        mh.msg("obj-metro-on", "1", 40, 140, 30),
        mh.box("obj-metro", "metro 250", 40, 160, 80, numinlets=2, outlettype=["bang"]),
        mh.box("obj-snap", "snapshot~ 100", 40, 180, 90, numinlets=2, outlettype=["float"]),
        mh.box("obj-cpu", "adstatus cpu", 40, 200, 100, outlettype=["float"]),
    ]
    lines = [
        mh.line("obj-load", 0, "obj-params", 0),
        mh.line("obj-metro", 0, "obj-cpu", 0),
        mh.line("obj-cpu", 0, "obj-js", 0),
        mh.line("obj-snap", 0, "obj-js", 1),
        mh.line("obj-ng", 0, "obj-snap", 0),
    ]
    for k in range(count):
        boxes.append(cep_gen(f"obj-gen{k}", code, 200 + 30 * k, 200 + 4 * k))
        lines += [mh.line("obj-params", 0, f"obj-gen{k}", 0), mh.line("obj-mute", 0, f"obj-gen{k}", 0)]
    sb, sl = source_chain(False)
    return boxes + sb, lines + sl


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


def run_audio_once(code, case):
    boxes, lines = audio_boxes(code, case)
    r = mh.run_case(f"cep_{case['name']}", boxes, lines, probe_js=PROBE_JS,
                    probe_args=f"{SKIP} {case['maxlag']} audio", settle_ms=SETTLE_MS,
                    dur_ms=case["dur"], channels=4, sr=SR, timeout=90)
    r["sr"] = round(r["conf"] * 1e5) if case["kind"] != "pitch" else SR
    return r


def run_audio(code, case):
    """Render and check one case (returns meta, errors)."""
    errs = []
    try:
        meta = run_audio_once(code, case)
    except Exception as exc:  # noqa: BLE001
        return None, [f"{case['name']}: did not run ({exc})"]
    check_audio(case, meta, errs)
    return meta, errs


def print_audio(case, meta):
    print(f"--- {case['name']} ---")
    print(
        f"sr {meta['sr']:.0f} lag {meta.get('lag'):.0f} gain {meta.get('gaindb'):.3f} dB err {meta.get('errdb'):.1f} dB "
        f"maxerr {meta.get('maxerr'):.2e} peak {meta.get('outpeak'):.3f} rms {meta.get('outrms'):.4f} "
        f"dry {meta.get('dryrms'):.3f} nan {meta.get('nan'):.0f} tiny {meta.get('tiny'):.0f} "
        f"q {meta.get('q'):.2f} conf {meta.get('conf'):.2f}"
    )


def run_cpu(code, label, params):
    boxes, lines = cpu_device(code, params, CPU_INSTANCES)
    # Hardware-driver case: CPU load is only meaningful on the real audio device (holds the machine-wide lock).
    r = mh.run_case(f"cep_cpu_{label}", boxes, lines, probe_js=PROBE_JS, probe_args="0 0 cpu",
                    settle_ms=0, dur_ms=CPU_DUR_MS, channels=1, sr=SR, mode="audio_device",
                    events=[(0, "obj-metro", 0, "1")], timeout=60)
    if r.get("samples", 0) < 4 or r.get("alive", 0) < 1:
        print(f"--- cpu {label}: NO USABLE RESULT")
        return None
    print(f"--- cpu {label}: mean {r['cpu']:.2f} % peak {r['cpupeak']:.2f} % ({r['samples']:.0f} polls)")
    return r


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
        want = expected_level("min" if kind == "minphase" else "max", n, meta["sr"])
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
    cases = [c for c in audio_cases() if not only or any(c["name"].startswith(p) for p in only)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [(c, ex.submit(run_audio, code, c)) for c in cases]
        for case, fut in futs:
            meta, errs = fut.result()
            if meta is not None:
                print_audio(case, meta)
            errors += errs
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
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
