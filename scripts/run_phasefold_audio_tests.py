#!/usr/bin/env python3
"""Render Phase Fold's gen core through the Ableton-bundled Max (real audio).

Runs on the shared NonRealTime harness (scripts/max_harness.py), cases in parallel:
    python3 scripts/run_phasefold_audio_tests.py [case-prefix ...]

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
  tel_*      telemetry buffer on a kick train: heartbeat, frame centroid near the frame start at +100, near its end at -100
"""

import concurrent.futures
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh  # noqa: E402

LIB_PATH = os.path.join(ROOT, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT, "src", "phasefold_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "phasefold_probe.js")
SETTLE_MS = 600  # longer than the 4160 + n hold and the wet fade-in
DUR_MS = 3000
WORKERS = 3

SRC_CODE = """// Test signal generator for the Phase Fold audio tests.
// srcmode 0 noise, 1 kick train, 2 kick + snare, 3 silence, 4 sine 220 Hz.
Param srcmode(0);
History tc(0);
History sph(0);
half = samplerate * 0.5;
tcn = tc + 1;
tc = tcn >= half ? 0 : tcn;
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



def device(code, case):
    """Device boxes/lines for mh.run_case: test source gen -> Phase Fold gen -> record~ (4 channels)."""
    params = (
        f"phaseamt {case['phase']}, sizeidx {case['size']}, orig {case.get('orig', 0)}, "
        f"autog {case.get('ag', 1)}, mixpct {case.get('mix', 100)}, outdb 0"
    )
    boxes = [
        mh.msg("dev-params", params, 200, 40, 460),
        mh.msg("dev-srcp", f"srcmode {case['src']}", 200, 70, 120),
        mh.msg("dev-bind", "scope pfscope", 200, 100, 120),
        mh.box("dev-scope", "buffer~ pfscope 100 4", 520, 100, 160, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-src", SRC_CODE, 520, 200, numinlets=1, numoutlets=2),
        mh.gen_box("dev-gen", code, 200, 200, numinlets=2, numoutlets=2),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-srcp", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-srcp", 0, "dev-src", 0),
        mh.line("dev-src", 0, "dev-gen", 0),
        mh.line("dev-src", 0, "dev-gen", 1),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-src", 0, "obj-record", 1),
        mh.line("dev-gen", 1, "obj-record", 2),
        mh.line("dev-src", 1, "obj-record", 3),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
    ]
    return boxes, lines


def run_case(code, case):
    boxes, lines = device(code, case)
    events = None
    mode = "nrt"
    if "switch_to" in case:
        events = [(SETTLE_MS + case["switch_at"], "dev-gen", 0, f"sizeidx {case['switch_to']}")]
        mode = "stepped"
    try:
        return mh.run_case(case["name"], boxes, lines, probe_js=PROBE_JS, settle_ms=SETTLE_MS,
                           dur_ms=DUR_MS, channels=4, sr=mh.DEFAULT_SR, mode=mode, events=events, timeout=420)
    except RuntimeError as exc:
        print(f"{case['name']}: {exc}", flush=True)
        return None


def describe(case, meta):
    return (
        f"--- {case['name']} ---\n"
        f"sr {meta['sr']:.0f} lag {meta['lag']:.0f} gain {meta['gaindb']:.2f} dB err {meta['errdb']:.1f} dB "
        f"pre {meta['pre']:.3f} ({meta['onsets']:.0f}) step {meta['maxstep']:.4f} peak {meta['outpeak']:.3f} "
        f"dry {meta['dryrms']:.3f} nan {meta['nan']:.0f} | beat {meta['beat']:.0f} "
        f"cout {meta['cout']:.2f} cin {meta['cin']:.2f} g {meta['gdb']:.1f} dB wall {meta['harness_wall_s']:.0f}s"
    )


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
    out.append({"name": "tel_min", "kind": "tel_min", "src": KICK, "phase": 100, "size": 2})
    out.append({"name": "tel_max", "kind": "tel_max", "src": KICK, "phase": -100, "size": 2})
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
    elif kind == "tel_min":
        if meta["cout"] > 0.45 or meta["wenv"] < 0.02:
            errors.append(f"{name}: output centroid {meta['cout']:.2f} at +100 (expected near frame start), env {meta['wenv']:.3f}")
    elif kind == "tel_max":
        if meta["cout"] < 0.6 or meta["wenv"] < 0.02:
            errors.append(f"{name}: output centroid {meta['cout']:.2f} at -100 (expected near frame end), env {meta['wenv']:.3f}")


def main():
    with open(LIB_PATH, encoding="utf-8") as f:
        lib = f.read()
    with open(CORE_PATH, encoding="utf-8") as f:
        core = f.read()
    code = lib + "\n" + core
    only = sys.argv[1:]
    todo = [c for c in cases() if not only or any(c["name"].startswith(p) for p in only)]
    errors = []
    groups = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(run_case, code, c): c for c in todo}
        for fut in concurrent.futures.as_completed(futs):
            case, meta = futs[fut], fut.result()
            if meta is not None:
                print(describe(case, meta), flush=True)
            check(case, meta, errors, groups)
    for grp, vals in groups.items():
        if grp in ("noise", "drums") and len(vals) == 3:
            spread = max(vals) - min(vals)
            print(f"level spread across Phase ({grp}): {spread:.2f} dB  {[round(v, 2) for v in vals]}")
            if spread > 1.5:
                errors.append(f"{grp}: level spread {spread:.2f} dB across Phase")
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
