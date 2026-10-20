#!/usr/bin/env python3
"""Render Better Sampler through Ableton-bundled Max 9 and verify all 4 playback
engines (Repitch, Cycles, Textures, Slice), Freeze, Reverse, 8-voice Stereo Unison,
SVF Filter, and #0-bsscope live UI telemetry.

Cases:
  idle_silent      — All 16 voices released: output is silent and active voice count == 0
  repitch_chord    — Mode 0 (Repitch) 3-voice triad with loop & 4x stereo unison
  cycles_formant   — Mode 1 (Cycles) wavetable cycle engine with +7 st Formant shift
  textures_cloud   — Mode 2 (Textures) dual Hann granular cloud with Freeze & Spray
  slice_trig       — Mode 3 (Slice) transient slice playback with SVF LP filter & drive
  forward_oneshot  — Mode 0 one-shot, unison 1, glide armed: decaying forward read
  reverse_oneshot  — Mode 0 one-shot played backwards through the same decay
  freeze_hold      — Mode 0 playhead frozen at a non-zero sample position
  unison8_wide     — Mode 0 single note with 8 detuned stereo unison voices
"""

import json
import os
import shutil
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "sampler_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "sampler_probe.js")
HARNESS = os.path.join(ROOT, "tests", "sampler_harness.maxpat")
RESULT = "/tmp/sampler_audio.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
CRASH_RECOVERY = os.path.expanduser(
    "~/Library/Application Support/Cycling '74/Max 9/Crash Recovery"
)


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


def build_harness(gen_code, case):
    mode = case["name"]
    boxes = [
        box("obj-load", "loadbang", 40, 40, 60, 20, numinlets=1, numoutlets=1, outlettype=["bang"]),
        box("obj-del-dsp", "delay 2600", 40, 80, 80, 20, numinlets=2, numoutlets=1),
        box("obj-dsp", "; dsp start", 40, 120, 80, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-arm", "delay 1200", 40, 160, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-on", "1", 40, 200, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-stop", f"delay {case['dur']}", 40, 240, 80, 20, numinlets=2, numoutlets=1),
        box("obj-rec-off", "0", 40, 280, 30, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-del-peak", "delay 40", 40, 320, 70, 20, numinlets=2, numoutlets=1),
        box("obj-del-analyze", "delay 80", 40, 360, 70, 20, numinlets=2, numoutlets=1),
        box("obj-analyze", f"analyze {case['dur']}", 120, 360, 90, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-quit", "; max quit", 40, 420, 70, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-params", case["params"], 200, 40, 760, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-setbuf", "setbuffers #0-bsamp #0-bsvoices #0-bsscope", 200, 70, 290, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-bind", "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope", 200, 100, 320, 20, maxclass="message", numinlets=2, numoutlets=1),
        box("obj-samp", "buffer~ #0-bsamp @samps 12000 2", 540, 70, 225, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-voices", "buffer~ #0-bsvoices @samps 128", 540, 100, 220, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-scope", "buffer~ #0-bsscope @samps 64", 540, 130, 210, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recbuf", "buffer~ rec 2000 2", 540, 160, 150, 20, numinlets=1, numoutlets=2, outlettype=["float", "bang"]),
        box("obj-recsize", "size 2000", 540, 185, 75, 20, maxclass="message", numinlets=2, numoutlets=1),
        {
            "box": {
                "code": gen_code,
                "fontname": "<Monospaced>",
                "fontsize": 10.0,
                "id": "obj-gen",
                "maxclass": "gen.codebox~",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [200.0, 215.0, 300.0, 75.0],
            }
        },
        box("obj-record", "record~ rec 2", 200, 305, 90, 20, numinlets=4, numoutlets=1, outlettype=[""]),
        box("obj-peak-l", "peakamp~", 200, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-peak-r", "peakamp~", 290, 340, 70, 20, numinlets=1, numoutlets=1, outlettype=["float"]),
        box("obj-mute-l", "*~ 0", 200, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-mute-r", "*~ 0", 260, 390, 45, 20, numinlets=2, numoutlets=1, outlettype=["signal"]),
        box("obj-dac", "dac~", 200, 430, 50, 20, numinlets=2, numoutlets=0, outlettype=[]),
        box(
            "obj-js",
            f"js {PROBE_JS} {mode}",
            200, 470, 420, 20,
            numinlets=4,
            numoutlets=3,
            outlettype=["bang", "bang", ""],
        ),
    ]

    lines = [
        line("obj-load", 0, "obj-del-dsp", 0),
        line("obj-load", 0, "obj-recsize", 0),
        line("obj-recsize", 0, "obj-recbuf", 0),
        line("obj-load", 0, "obj-params", 0),
        line("obj-load", 0, "obj-setbuf", 0),
        line("obj-load", 0, "obj-bind", 0),
        line("obj-bind", 0, "obj-gen", 0),
        line("obj-params", 0, "obj-gen", 0),
        line("obj-setbuf", 0, "obj-js", 3),
        line("obj-del-dsp", 0, "obj-dsp", 0),
        line("obj-del-dsp", 0, "obj-del-arm", 0),
        line("obj-del-arm", 0, "obj-setbuf", 0),
        line("obj-del-arm", 0, "obj-rec-on", 0),
        line("obj-del-arm", 0, "obj-del-stop", 0),
        line("obj-rec-on", 0, "obj-record", 0),
        line("obj-del-stop", 0, "obj-rec-off", 0),
        line("obj-del-stop", 0, "obj-del-peak", 0),
        line("obj-del-stop", 0, "obj-del-analyze", 0),
        line("obj-rec-off", 0, "obj-record", 0),
        line("obj-del-peak", 0, "obj-peak-l", 0),
        line("obj-del-peak", 0, "obj-peak-r", 0),
        line("obj-del-analyze", 0, "obj-analyze", 0),
        line("obj-analyze", 0, "obj-js", 0),
        line("obj-js", 0, "obj-quit", 0),
        line("obj-gen", 0, "obj-record", 0),
        line("obj-gen", 1, "obj-record", 1),
        line("obj-gen", 0, "obj-peak-l", 0),
        line("obj-gen", 1, "obj-peak-r", 0),
        line("obj-gen", 0, "obj-mute-l", 0),
        line("obj-gen", 1, "obj-mute-r", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-mute-r", 0, "obj-dac", 1),
        line("obj-peak-l", 0, "obj-js", 0),
        line("obj-peak-r", 0, "obj-js", 2),
    ]

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "rect": [80.0, 80.0, 960.0, 560.0],
            "boxes": boxes,
            "lines": lines,
        }
    }


def stop_previous_harness():
    # Max is single-instance. A harness that is still quitting will steal the
    # next launch and measure silence.
    subprocess.run(
        ["pkill", "-9", "-f", "sampler_harness.maxpat"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(24):
        still = subprocess.run(
            ["pgrep", "-f", "sampler_harness.maxpat"],
            stdout=subprocess.DEVNULL,
        )
        if still.returncode != 0:
            break
        time.sleep(0.25)
    time.sleep(0.35)


def run_case(gen_code, case):
    stop_previous_harness()
    if os.path.exists(RESULT):
        os.remove(RESULT)
    if os.path.exists(CRASH_RECOVERY):
        shutil.rmtree(CRASH_RECOVERY, ignore_errors=True)

    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(build_harness(gen_code, case), f, indent=2)

    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t0 = time.time()
    stable = 0
    last_size = -1
    while time.time() - t0 < 48.0:
        if os.path.exists(RESULT):
            sz = os.path.getsize(RESULT)
            if sz > 20 and sz == last_size:
                stable += 1
                if stable >= 2:
                    break
            else:
                stable = 0
                last_size = sz
        time.sleep(0.15)

    try:
        proc.terminate()
        proc.wait(timeout=2.0)
    except Exception:
        proc.kill()

    if not os.path.exists(RESULT):
        return None

    out = {}
    with open(RESULT, "r", encoding="utf-8") as f:
        for line_str in f:
            parts = line_str.strip().split()
            if len(parts) == 2:
                out[parts[0]] = float(parts[1])
    return out


CASES = [
    {
        "name": "idle_silent",
        "dur": 400,
        "params": "mode 0, filt_on 1, out_gain 0",
    },
    {
        "name": "repitch_chord",
        "dur": 600,
        "params": "mode 0, loop_mode 1, unison_voices 4, unison_detune 0.35, unison_width 0.8, filt_on 1, filt_cutoff 14000, out_gain 0",
    },
    {
        "name": "cycles_formant",
        "dur": 600,
        "params": "mode 1, formant 7, grain_motion 1.0, unison_voices 2, filt_on 1, filt_cutoff 12000, out_gain 0",
    },
    {
        "name": "textures_cloud",
        "dur": 600,
        "params": "mode 2, freeze 1, play_pos 0.25, grain_size 55, grain_spray 0.35, lfo_rate 4.0, lfo_pos 0.25, out_gain 0",
    },
    {
        "name": "slice_trig",
        "dur": 600,
        "params": "mode 3, filt_on 1, filt_type 0, filt_cutoff 2800, filt_res 0.45, filt_drive 0.5, out_gain 0",
    },
    {
        "name": "forward_oneshot",
        "dur": 700,
        "params": "mode 0, reverse 0, freeze 0, loop_mode 0, unison_voices 1, unison_width 0, glide_ms 300, filt_on 0, sus_lvl 1, dec_ms 10000, atk_ms 0.5, out_gain 0",
    },
    {
        "name": "reverse_oneshot",
        "dur": 700,
        "params": "mode 0, reverse 1, freeze 0, loop_mode 0, unison_voices 1, unison_width 0, filt_on 0, sus_lvl 1, dec_ms 10000, atk_ms 0.5, out_gain 0",
    },
    {
        "name": "freeze_hold",
        "dur": 500,
        "params": "mode 0, freeze 1, reverse 0, play_pos 0.12, loop_mode 0, unison_voices 1, unison_width 0, unison_detune 0, lfo_pos 0, filt_on 0, sus_lvl 1, dec_ms 10000, atk_ms 0.5, out_gain 0",
    },
    {
        "name": "unison8_wide",
        "dur": 500,
        "params": "mode 0, loop_mode 1, unison_voices 8, unison_detune 0.85, unison_width 1, freeze 0, reverse 0, filt_on 0, sus_lvl 1, out_gain 0",
    },
]


def main():
    if not os.path.exists(MAX_BIN):
        print(f"Skipping real Max audio test: {MAX_BIN} not found")
        return

    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    results = {}
    only = os.environ.get("SAMPLER_CASE", "").strip()
    cases = [c for c in CASES if not only or c["name"] == only]
    for c in cases:
        r = None
        for attempt in range(3):
            r = run_case(gen_code, c)
            if not r:
                print(f"[{c['name']}] attempt {attempt + 1} produced no report, retrying")
                continue
            bound = r.get("scopeFrames", 0) >= 8000
            audible = c["name"] == "idle_silent" or (
                r.get("rendered", 0) >= 800 and r.get("peak", 0) > 0.02
            )
            if bound and audible and r.get("nan", 1) == 0:
                break
            print(f"[{c['name']}] attempt {attempt + 1} was not ready (scopeFrames={r.get('scopeFrames')} rendered={r.get('rendered')} peak={r.get('peak')}), retrying")
        if not r:
            raise RuntimeError(f"Max audio harness did not produce {RESULT} for {c['name']}")
        results[c["name"]] = r
        ratio = (r["lateRms"] / r["earlyRms"]) if r.get("earlyRms", 0) > 1e-8 else 0.0
        r["lateEarly"] = ratio
        print(
            f"[{c['name']:16s}] peak={r['peak']:.4f} rms={r['rms']:.4f} "
            f"stereoDiff={r['stereoDiff']:.4f} late/early={ratio:.3f} "
            f"activeVoices={int(r['scopeActive'])} cutHz={r['scopeCutHz']:.1f} "
            f"sampFrames={r['scopeFrames']:.0f} rendered={r.get('rendered', 0):.0f} "
            f"nan={int(r['nan'])}"
        )
        assert r["nan"] == 0, f"{c['name']}: NaN detected in audio output!"
        assert r["peak"] < 1.05, f"{c['name']}: output exceeded the soft ceiling ({r['peak']})"
        assert r["scopeFrames"] >= 8000, f"{c['name']}: sample buffer was not bound (frames={r['scopeFrames']})"

    if any(c["name"] not in results for c in CASES):
        print("Partial sampler audio run; cross-case checks skipped.")
        return

    # Verify idle silence
    assert results["idle_silent"]["peak"] < 1e-4, "idle_silent must be silent when no voices are gated"
    assert results["idle_silent"]["scopeActive"] == 0, "idle_silent must report 0 active voices"

    # Verify all 4 active engines produce clean audio & update telemetry
    for active_case in ("repitch_chord", "cycles_formant", "textures_cloud", "slice_trig"):
        r = results[active_case]
        assert r["peak"] > 0.05, f"{active_case}: expected audible output peak > 0.05, got {r['peak']}"
        assert r["rms"] > 0.01, f"{active_case}: expected audible RMS > 0.01, got {r['rms']}"
        assert r["scopeActive"] >= 1, f"{active_case}: #0-bsscope must report active voices >= 1"
        assert r["scopePeakL"] > 0.02, f"{active_case}: #0-bsscope must report live output peak"

    assert results["repitch_chord"]["scopeActive"] >= 3, "Repitch triad must keep 3 voices active"
    assert results["repitch_chord"]["stereoDiff"] > 0.01, "4x Unison triad must produce stereo spread"
    assert results["repitch_chord"]["scopeCutHz"] > 8000, "Open SVF cutoff must land in the scope telemetry"
    assert 1000 < results["slice_trig"]["scopeCutHz"] < 5000, "Slice LP cutoff must track the 2.8 kHz filter"

    for tonal in ("forward_oneshot", "reverse_oneshot", "freeze_hold", "unison8_wide"):
        r = results[tonal]
        assert r["peak"] > 0.04, f"{tonal}: expected audible peak > 0.04, got {r['peak']}"
        assert r["rms"] > 0.008, f"{tonal}: expected audible RMS > 0.008, got {r['rms']}"
        assert r["scopeActive"] >= 1, f"{tonal}: #0-bsscope must report an active voice"
        assert r["earlyRms"] > 0.005 and r["lateRms"] > 0.005, f"{tonal}: both analysis windows must be audible"

    fwd = results["forward_oneshot"]["lateEarly"]
    rev = results["reverse_oneshot"]["lateEarly"]
    assert fwd < 0.92, f"Forward one-shot must decay (late/early={fwd:.3f})"
    assert rev > fwd + 0.2, f"Reverse must walk back into the attack (late/early={rev:.3f}, forward={fwd:.3f})"

    frozen = results["freeze_hold"]["lateEarly"]
    assert 0.8 <= frozen <= 1.25, f"Frozen playhead must hold a steady level (late/early={frozen:.3f})"

    assert results["unison8_wide"]["stereoDiff"] > results["forward_oneshot"]["stereoDiff"] + 0.015, (
        "8-voice wide unison must spread wider than a centered single voice"
    )
    assert results["unison8_wide"]["scopeActive"] == 1, "Unison stacks inside one allocated voice"

    if os.path.exists(HARNESS):
        os.remove(HARNESS)
    print("All 9 real Max 9 Better Sampler audio tests passed!")


if __name__ == "__main__":
    main()
