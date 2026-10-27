#!/usr/bin/env python3
"""Amp audio cases on the Max harness (inside the tart VM only, AGENTS.md 1a).

Fixtures come from the host (`node tests/amp_fixtures.js`, the VM has no node): the generated gen
code per reference model, its weights, a stimulus and the reference output of ampForward.

  <model>        nano / feather / standard / lstm / lstm2: the raw model output (tapraw) equals the
                 JS reference (which equals the official NAM torch model) within float32 error
  cpu_<model>    real-time CPU (adstatus cpu, audio_device driver) with the stimulus playing; cpu_none = no model,
                 cpu_st_<model> = Stereo mode
  stereo_<model> Output mode Stereo (tapraw 2: out 1 / out 2 = raw L / R model output): both channels
                 equal the reference (feather, lstm)
  stereo_iso     Stereo with a silent right input: the left channel still equals the reference and the
                 right one stays at the model's constant (no state shared between the channels)
  chain          the full chain (gate, normalize, DC block, biquads, volume, dry/wet) stays finite and
                 audible with a model running, mono and stereo
  sleep          silent input puts the model to sleep (telemetry) and outputs exact zeros

  python3 scripts/run_amp_audio_tests.py [case ...]
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(ROOT, "tests", "out", "amp")
PROBE = os.path.join(ROOT, "tests", "amp_probe.js")
MODELS = ["nano", "feather", "lite", "standard", "lstm", "lstm2"]
SETTLE_MS = 100

SOURCE = """Buffer st("amp_stim_t");
Param silent(0);
Param loop(0);
Param rgain(1);
History n(0);
o = n < dim(st) ? peek(st, n, 0) : 0;
n = n + 1;
n = (loop > 0.5) && (n >= dim(st)) ? 0 : n;
o = silent > 0.5 ? 0 : o;
out1 = o;
out2 = o * rgain;
"""


def device(model, params, ref=True, code_name=None):
    code = "" if code_name and code_name.startswith("gendsp:") else open(os.path.join(FIX, (code_name or model) + ".genexpr")).read()
    boxes = [
        mh.box("dev-wbuf", f"buffer~ amp_w_t {os.path.join(FIX, model + '_w.wav')}", 40, 120, 300, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-sbuf", f"buffer~ amp_stim_t {os.path.join(FIX, 'stim.wav')}", 40, 150, 300, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-cbuf", "buffer~ amp_cf_t 56 1", 40, 210, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-scbuf", "buffer~ amp_scope_t 3136 1", 40, 240, 200, numoutlets=2, outlettype=["float", "bang"]),
        mh.gen_box("dev-src", SOURCE, 400, 200, numinlets=1, numoutlets=2),
        (mh.box("dev-gen", "gen~ @gen " + os.path.join(FIX, code_name[7:]), 400, 300, 200, numinlets=2, numoutlets=2, outlettype=["signal", "signal"])
         if code_name and code_name.startswith("gendsp:") else mh.gen_box("dev-gen", code, 400, 300, numinlets=2, numoutlets=2)),
        mh.msg("dev-params", "w amp_w_t, cf amp_cf_t, scope amp_scope_t, wbase 0, mok 1, " + params, 40, 40, 900),
    ]
    if ref is True:
        boxes.append(mh.box("dev-rbuf", f"buffer~ amp_ref_t {os.path.join(FIX, model + '_ref.wav')}", 40, 180, 300, numoutlets=2, outlettype=["float", "bang"]))
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-src", 0, "dev-gen", 0),
        mh.line("dev-src", 1, "dev-gen", 1),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    return boxes, lines


def run(name, model, params, dur_ms, ref=True, src_params=None, code_name=None, mode="nrt"):
    boxes, lines = device(model, params, ref, code_name)
    if mode == "audio_device":
        # Real-time CPU load cannot be measured offline (the harness's NonRealTime driver ran at
        # about real time in the VM, so wall time says nothing about the gen's cost).
        boxes += [
            mh.box("dev-metro", "metro 100", 40, 480, 70, numinlets=2),
            mh.box("dev-adstatus", "adstatus cpu", 40, 510, 90, outlettype=["float"]),
            mh.box("dev-cpu-prep", "prepend cpu", 40, 540, 90),
        ]
        lines += [
            mh.line("obj-load", 0, "dev-metro", 0),
            mh.line("dev-metro", 0, "dev-adstatus", 0),
            mh.line("dev-adstatus", 0, "dev-cpu-prep", 0),
            mh.line("dev-cpu-prep", 0, "obj-js", 0),
        ]
    if src_params:
        boxes.append(mh.msg("dev-srcp", src_params, 600, 40, 200))
        lines += [mh.line("obj-load", 0, "dev-srcp", 0), mh.line("dev-srcp", 0, "dev-src", 0)]
    settle = int(SETTLE_MS * 48)
    return mh.run_case(name, boxes, lines, probe_js=PROBE,
                       probe_args=("cpu" if ref == "cpu" else ("amp_ref_t " if ref else "- ")) + ("" if ref == "cpu" else str(settle)),
                       settle_ms=SETTLE_MS, dur_ms=dur_ms, mode=mode)


def check(ok, msg):
    print(("PASS " if ok else "FAIL ") + msg, flush=True)
    return ok


def main():
    want = sys.argv[1:] or MODELS + ["stereo_feather", "stereo_lstm", "stereo_iso", "chain", "chain_stereo", "sleep"] + ["cpu_" + m for m in ["none", "nano", "feather", "standard", "lstm"]]
    bad = 0
    for case in want:
        if case in MODELS:
            r = run(case, case, "tapraw 1, mixamt 1", 1300)
            rel = r["maxerr"] / max(1e-9, r["peakref"])
            bad += not check(r["nans"] == 0 and rel < 2e-3 and r["peakraw"] > 0,
                             f"{case}: maxerr {r['maxerr']:.3g} (peak ref {r['peakref']:.3g}, rel {rel:.2g}), rms err {r['rmserr']:.3g}")
        elif case.startswith("stereo_") and case[7:] in MODELS:
            m = case[7:]
            r = run(case, m, "tapraw 2, stmode 1, mixamt 1", 1300)
            rel = r["maxerr"] / max(1e-9, r["peakref"])
            rel1 = r["maxerr1"] / max(1e-9, r["peakref"])
            bad += not check(r["nans"] == 0 and rel < 2e-3 and rel1 < 2e-3 and r["peakraw"] > 0,
                             f"{case}: L maxerr {r['maxerr1']:.3g}, R maxerr {r['maxerr']:.3g} (peak ref {r['peakref']:.3g})")
        elif case == "stereo_iso":
            r = run(case, "feather", "tapraw 2, stmode 1, mixamt 1", 1300, src_params="rgain 0")
            rel1 = r["maxerr1"] / max(1e-9, r["peakref"])
            bad += not check(r["nans"] == 0 and rel1 < 2e-3 and r["span2"] < 1e-6,
                             f"stereo_iso: L maxerr {r['maxerr1']:.3g} (rel {rel1:.2g}), R span {r['span2']:.3g}")
        elif case == "chain_stereo":
            r = run(case, "feather", "tapraw 0, stmode 1, gatedb -60, outdb -3", 1300, ref=False, src_params="rgain 0.5")
            bad += not check(r["nans"] == 0 and 0.001 < r["peakout"] < 4 and 0.001 < r["peakraw"] < 4,
                             f"chain_stereo: peak L {r['peakout']:.3g}, R {r['peakraw']:.3g}")
        elif case.startswith("dbg:"):
            r = run("dbg", "feather", "tapraw 1", 300, ref=False, code_name=case[4:])
            print("DEBUG", {k: v for k, v in r.items() if k != "harness_dir"}, flush=True)
        elif case.startswith("cpu_"):
            m = case[4:]
            extra = "tapraw 0" + (", mok 0" if m == "none" else "")
            if m.startswith("st_"):   # cpu_st_<model>: Output mode Stereo (a model per channel)
                m = m[3:]
                extra += ", stmode 1"
            m = "feather" if m == "none" else m
            r = run(case, m, extra, 3000, ref="cpu", mode="audio_device", src_params="loop 1")
            print(f"INFO {case}: adstatus cpu avg {r['cpuavg']:.1f} %, max {r['cpumax']:.0f} % ({int(r['cpucount'])} readings)", flush=True)
        elif case == "chain":
            r = run(case, "feather", "tapraw 0, gatedb -60, outdb -3, normdb 6", 1300, ref=False)
            bad += not check(r["nans"] == 0 and 0.001 < r["peakout"] < 4, f"chain: peak out {r['peakout']:.3g}, rms {r['rmsout']:.3g}")
        elif case == "sleep":
            r = run(case, "feather", "tapraw 1", 1300, ref=False, src_params="silent 1")
            bad += not check(r["tailpeak"] == 0 and r["asleep"] == 1, f"sleep: tail raw peak {r['tailpeak']}, asleep {r['asleep']}")
        else:
            print("unknown case " + case)
            bad += 1
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
