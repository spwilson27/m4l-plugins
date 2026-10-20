#!/usr/bin/env python3
"""Render Timbre Split (`src/cepstrum_lib.genexpr` + `src/tsplit_core.genexpr`) through the Ableton-bundled Max 9.

RUNS MAX: only inside the macos-01 VM (AGENTS.md section 1a), through the shared scripts/max_harness.py (NonRealTime
driver, one Max at a time):  python3 scripts/run_tsplit_audio_tests.py [drums] [silence]

Patch per case: `buffer~ src <stimulus.wav>` (loaded at patch load) -> gen counter / `index~ src` -> four gen.codebox~
with the real core: chains with class masks 1, 2 and 4 plus one all-class chain (mask 7); Classes 3 / Sharp 60 /
Smooth 8, the learned centroids from `node tests/tsplit_ref_cli.js info` poked into `buffer~ tscent` by the probe.
The harness records 6 channels (chain sum, dry input, chain 1, chain 2, chain 3, all-class chain); tests/tsplit_probe.js
writes them as a headerless float32 file and reports the first 32 floats of `tsplitscope`.

Cases:
  drums   - the 11.2 s kick / snare / hat sequence of tests/test_tsplit.js (mono into in1 and in2)
            * latency: the chain sum equals the dry input delayed by exactly 2048 samples
            * perfect reconstruction: sum - delayed dry below -120 dB; the all-class chain is the delayed dry input
            * isolation: every hit puts > 90 % of its energy into its own chain, > 90 % in the first 3 ms (no chopped onsets)
            * the three chain outputs match the JS mirror (src/tsplit_ref.js) rendered by tests/tsplit_ref_cli.js
            * telemetry: hop counter advanced, K = 3, latency 2048, applied class gains sum to 1, no NaN / denormals
  silence - 3 s of zeros: every output exactly 0, idle flag set (the analysis sleeps), counter stops advancing
"""

import array
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
LIB_PATH = os.path.join(ROOT, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT, "src", "tsplit_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "tsplit_probe.js")
REF_CLI = os.path.join(ROOT, "tests", "tsplit_ref_cli.js")
SR = mh.DEFAULT_SR
LATENCY = 2048
CHANNELS = 6  # sum, dry, chain 1, chain 2, chain 3, all-class chain
MASKS = [1, 2, 4, 7]
PARAMS = "classes 3, sharp 60, smooth 8, gain 0"


def node_json(*args):
    out = subprocess.check_output(["node", REF_CLI, *args], text=True)
    return json.loads(out.strip().splitlines()[-1])


def read_raw(path, channels):
    """Headerless interleaved float32 (buffer~ writeraw, always big-endian) -> list of per-channel lists."""
    flat = array.array("f")
    with open(path, "rb") as f:
        data = f.read()
    flat.frombytes(data[: len(data) // 4 * 4])
    if sys.byteorder == "little":
        flat.byteswap()
    return [flat[c::channels] for c in range(channels)]


def read_planar_le(path, channels):
    flat = array.array("f")
    with open(path, "rb") as f:
        data = f.read()
    flat.frombytes(data[: len(data) // 4 * 4])
    if sys.byteorder == "big":
        flat.byteswap()
    n = len(flat) // channels
    return [flat[c * n:(c + 1) * n] for c in range(channels)]


def audio_device(code, wav_path, centroids):
    """index~ src (sample exact stimulus) -> 4 cores; record sum, dry, chain 1, 2, 3, all-class chain."""
    flat = [0.0] * 64
    for k, c in enumerate(centroids):
        for d, v in enumerate(c):
            flat[k * 16 + d] = v
    boxes = [
        mh.msg("obj-fillcent", "fillcent " + " ".join(repr(float(v)) for v in flat), 380, 30, 700),
        mh.box("obj-srcbuf", f"buffer~ src {wav_path}", 560, 90, 300, outlettype=["float", "bang"], numoutlets=2),
        mh.box("obj-centbuf", "buffer~ tscent @samps 64", 560, 120, 160, outlettype=["float", "bang"], numoutlets=2),
        mh.gen_box("obj-counter", "History n(0);\nout1 = n;\nn = n + 1;\n", 100, 300, numinlets=1, numoutlets=1),
        mh.box("obj-playsrc", "index~ src", 100, 360, 80, numinlets=1, outlettype=["signal"]),
        mh.box("obj-sum12", "+~", 420, 520, 40, numinlets=2, outlettype=["signal"]),
        mh.box("obj-sum123", "+~", 420, 550, 40, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("obj-load", 0, "obj-fillcent", 0),
        mh.line("obj-fillcent", 0, "obj-js", 0),
        mh.line("obj-counter", 0, "obj-playsrc", 0),
        mh.line("obj-gen1", 0, "obj-sum12", 0),
        mh.line("obj-gen2", 0, "obj-sum12", 1),
        mh.line("obj-sum12", 0, "obj-sum123", 0),
        mh.line("obj-gen3", 0, "obj-sum123", 1),
        mh.line("obj-sum123", 0, "obj-record", 0),
        mh.line("obj-playsrc", 0, "obj-record", 1),
        mh.line("obj-gen1", 0, "obj-record", 2),
        mh.line("obj-gen2", 0, "obj-record", 3),
        mh.line("obj-gen3", 0, "obj-record", 4),
        mh.line("obj-gen4", 0, "obj-record", 5),
        mh.line("obj-gen1", 0, "obj-mute-l", 0),
    ]
    for k, mask in enumerate(MASKS, start=1):
        boxes += [
            mh.box(f"obj-scopebuf{k}", f"buffer~ tsscope{k} @samps 2592", 560, 150 + 25 * k, 190, outlettype=["float", "bang"], numoutlets=2),
            mh.msg(f"obj-params{k}", f"{PARAMS}, cmask {mask}", 380 + 20 * k, 60 + 20 * k, 330),
            mh.msg(f"obj-bind{k}", f"scope tsscope{k}, cent tscent", 380 + 20 * k, 170 + 20 * k, 220),
            mh.gen_box(f"obj-gen{k}", code, 300 + 40 * k, 330, numinlets=2, numoutlets=2),
        ]
        lines += [
            mh.line("obj-load", 0, f"obj-params{k}", 0),
            mh.line("obj-load", 0, f"obj-bind{k}", 0),
            mh.line(f"obj-params{k}", 0, f"obj-gen{k}", 0),
            mh.line(f"obj-bind{k}", 0, f"obj-gen{k}", 0),
            mh.line("obj-playsrc", 0, f"obj-gen{k}", 0),
            mh.line("obj-playsrc", 0, f"obj-gen{k}", 1),
        ]
    return boxes, lines


def energy(sig, a, b):
    return sum(float(v) * float(v) for v in sig[a:b])


def first_nonzero(sig, thresh=1e-9):
    return next((i for i, v in enumerate(sig) if abs(v) > thresh), None)


def check_drums(res, rec, info, ref, errors, say):
    sr = info["sr"]
    total = info["total"]
    out, dry, c1, c2, c3, allc = rec
    scope = [res.get(f"s{i}", 0.0) for i in range(32)]
    n = min(len(dry), len(out))
    nan = sum(1 for ch in rec for v in ch if v != v or abs(v) == math.inf)
    tiny = sum(1 for ch in rec for v in ch if 0 < abs(v) < 1e-30)
    say(f"frames {n}  hops {scope[0]:.0f}  K {scope[5]:.0f}  latency field {scope[12]:.0f}  nan {nan} tiny {tiny}")
    if nan or tiny:
        errors.append(f"drums: nan {nan} / denormal-range {tiny}")
    if n < total:
        errors.append(f"drums: recorded {n} frames, stimulus has {total}")
        return
    # latency: first output sample vs first dry sample
    f_dry = first_nonzero(dry)
    f_out = first_nonzero(out)
    if f_dry is None or f_out is None:
        errors.append("drums: dry or output silent")
        return
    lag = f_out - f_dry
    say(f"first sample: dry {f_dry}, sum {f_out} -> latency {lag} samples")
    if lag != LATENCY:
        errors.append(f"drums: latency {lag} samples, expected exactly {LATENCY}")
    # perfect reconstruction
    num = den = peak_err = 0.0
    for i in range(LATENCY + 256, n):
        d = float(out[i]) - float(dry[i - LATENCY])
        num += d * d
        den += float(dry[i - LATENCY]) ** 2
        peak_err = max(peak_err, abs(d))
    res_db = 10 * math.log10(num / den + 1e-300)
    allc_err = max(abs(float(allc[i]) - float(dry[i - LATENCY])) for i in range(LATENCY + 4096, n))
    say(f"sum - delayed dry: {res_db:.1f} dB (peak {peak_err:.2e}); all-class chain vs delayed dry: {allc_err:.2e}")
    if res_db > -120:
        errors.append(f"drums: chain sum differs from the delayed input by {res_db:.1f} dB (> -120 dB)")
    if allc_err > 1e-6:
        errors.append(f"drums: the all-class chain is not the delayed input (max error {allc_err:.2e})")
    # isolation and onsets
    chains = [c1, c2, c3]
    names = ["kick", "snare", "hat"]
    n3 = int(0.003 * sr)
    worst_iso = [1.0, 1.0, 1.0]
    worst_onset = [1.0, 1.0, 1.0]
    for ev in info["events"]:
        k = ev["kind"]
        full = [energy(ch, ev["start"] + LATENCY, ev["end"] + LATENCY) for ch in chains]
        on = [energy(ch, ev["start"] + LATENCY, ev["start"] + LATENCY + n3) for ch in chains]
        worst_iso[k] = min(worst_iso[k], full[k] / max(sum(full), 1e-30))
        worst_onset[k] = min(worst_onset[k], on[k] / max(sum(on), 1e-30))
    say("worst per-hit energy in its own chain: " + ", ".join(f"{nm} {100 * v:.1f} %" for nm, v in zip(names, worst_iso)))
    say("worst first-3-ms energy in its own chain: " + ", ".join(f"{nm} {100 * v:.1f} %" for nm, v in zip(names, worst_onset)))
    for nm, v in zip(names, worst_iso):
        if v < 0.9:
            errors.append(f"drums: a {nm} keeps only {100 * v:.1f} % of its energy in its chain")
    for nm, v in zip(names, worst_onset):
        if v < 0.9:
            errors.append(f"drums: a {nm} onset lands only {100 * v:.1f} % in its chain (chopped transient)")
    # mirror
    rms_all = 0.0
    for c in range(3):
        d2 = sum((float(chains[c][i]) - float(ref[c][i])) ** 2 for i in range(LATENCY + 4096, total))
        a2 = sum(float(ref[c][i]) ** 2 for i in range(LATENCY + 4096, total)) + 1e-30
        rms_all = max(rms_all, 10 * math.log10(d2 / a2 + 1e-30))
    say(f"chains vs src/tsplit_ref.js: worst {rms_all:.1f} dB (relative error energy)")
    if rms_all > -40:
        errors.append(f"drums: the gen chains differ from the JS mirror ({rms_all:.1f} dB, expected < -40 dB)")
    # telemetry
    if scope[0] < 1500:
        errors.append(f"drums: only {scope[0]:.0f} telemetry hops")
    if scope[5] != 3:
        errors.append(f"drums: telemetry K {scope[5]}")
    if scope[12] != LATENCY:
        errors.append(f"drums: telemetry latency {scope[12]}")
    if abs(sum(scope[6:10]) - 1.0) > 1e-6:
        errors.append(f"drums: applied class gains sum to {sum(scope[6:10]):.9f}")


def check_silence(res, rec, errors, say):
    scope = [res.get(f"s{i}", 0.0) for i in range(32)]
    peak = max(abs(float(v)) for ch in rec for v in ch)
    say(f"peak {peak:.3e}  idle {scope[10]:.0f}  counter {scope[0]:.0f}")
    if peak != 0.0:
        errors.append(f"silence: outputs not exactly 0 (peak {peak})")
    if scope[10] != 1.0:
        errors.append(f"silence: idle flag {scope[10]} (expected 1 after 1.2 s of silence)")
    if scope[0] > 0.6 * 3.0 * SR / 256:
        errors.append(f"silence: {scope[0]:.0f} telemetry hops in 3 s (the analysis did not sleep)")


def run_case(name, code, info):
    work = tempfile.mkdtemp(prefix=f"tsplit_{name}_")
    errors = []
    lines = []
    say = lines.append
    try:
        wav = os.path.join(work, "stimulus.wav")
        raw = os.path.join(work, "rec.raw")
        if name == "silence":
            subprocess.check_call(["node", REF_CLI, "silence", wav, "3"])
            dur_ms = 3000
        else:
            subprocess.check_call(["node", REF_CLI, "stimulus", wav])
            dur_ms = int(info["total"] / info["sr"] * 1000) + 800  # stimulus + latency + tail
        boxes, dev_lines = audio_device(code, wav, info["centroids"])
        res = mh.run_case(f"tsplit_{name}", boxes, dev_lines, probe_js=PROBE_JS, probe_args=raw, settle_ms=0,
                          dur_ms=dur_ms, channels=CHANNELS, sr=SR, timeout=300)
        rec = read_raw(raw, CHANNELS)
        if name == "silence":
            check_silence(res, rec, errors, say)
        else:
            refraw = os.path.join(work, "ref.raw")
            subprocess.check_call(["node", REF_CLI, "render", refraw])
            check_drums(res, rec, info, read_planar_le(refraw, 3), errors, say)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{name}: did not run ({exc})")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return errors, lines


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"SKIP: Max binary not found at {mh.MAX_BIN}")
        sys.exit(0)
    with open(LIB_PATH, encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, encoding="utf-8") as f:
        core = f.read()
    code = lib + "\n" + core
    info = node_json("info")
    only = sys.argv[1:]
    errors = []
    for name in ("drums", "silence"):
        if only and name not in only:
            continue
        errs, lines = run_case(name, code, info)
        print(f"--- {name} ---")
        print("\n".join(lines))
        errors += errs
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("All Real Max 9 Timbre Split audio tests passed!")


if __name__ == "__main__":
    main()
