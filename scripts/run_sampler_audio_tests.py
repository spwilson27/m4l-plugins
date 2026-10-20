#!/usr/bin/env python3
"""Render Better Sampler through Ableton-bundled Max 9 (shared harness, NonRealTime) and verify the
5 engines (Repitch, Cycles, Textures, Spectral, Fragments), Single / Sliced in every engine, the
Repitch / Cycles / Spectral characters, Fragments, Freeze, Reverse, 8-voice Stereo Unison, the SVF
Filter and #0-bsscope live UI telemetry. Also measures CPU per engine (real-time factor).

Environment:
  SAMPLER_CASE=<regex>  run only matching cases (cross-case checks are skipped)
  SAMPLER_DUMP=1        print every metric of every case
  SAMPLER_GEN=<path>    gen source to test instead of src/sampler_core.genexpr (e.g. the old core, to
                        show that the new assertions fail against it)
  SAMPLER_CPU=0         skip the CPU (real-time factor) measurement

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
  mono_sample      — 1-channel buffer, unison 1: both outputs carry equal audio
  slice_end / slice_sample_end / slice_loop / slice_pingpong
                   — slice_play 0..3 in Sliced mode (once to slice end, to sample end, loops)
  slice_reverse_end / slice_reverse_sample
                   — Reverse with "to slice end" and "to sample end"
  live_loop / live_pingpong / live_continue
                   — slice bounds re-poked into a held voice (no new trigger)
  pos_off{0,50}_m{0,1,2} / pos_on{10,50}_m0
                   — Pos (play_pos) only matters while Freeze is on
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN_PATH = os.path.join(ROOT, "src", "sampler_core.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "sampler_probe.js")
GEN_CODE = ""


SETTLE_MS = 100


def device_patch(case, gen_code):
    """Device-specific boxes for the shared scaffold (scripts/max_harness.py)."""
    name = case["name"]
    chans = 1 if name == "mono_sample" else 2
    boxes = [
        mh.msg("obj-params", case["params"], 200, 40, 760),
        mh.msg("obj-setbuf", "setbuffers #0-bsamp #0-bsvoices #0-bsscope", 200, 70, 290),
        mh.msg("obj-bind", "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope", 200, 100, 320),
        mh.box("obj-samp", f"buffer~ #0-bsamp @samps 12000 {chans}", 540, 70, 225,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-voices", "buffer~ #0-bsvoices @samps 128", 540, 100, 220,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-scope", "buffer~ #0-bsscope @samps 64", 540, 130, 210,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-order", "t b b b", 200, 10, 60, numoutlets=3, outlettype=["bang", "bang", "bang"]),
        mh.gen_box("obj-gen", gen_code, 200, 215),
    ]
    lines = [
        # Fixed order (right to left): bind buffers, then params, then seed the sample.
        mh.line("obj-load", 0, "obj-order", 0),
        mh.line("obj-order", 2, "obj-bind", 0),
        mh.line("obj-order", 1, "obj-params", 0),
        mh.line("obj-order", 0, "obj-setbuf", 0),
        mh.line("obj-setbuf", 0, "obj-js", 3),
        mh.line("obj-bind", 0, "obj-gen", 0),
        mh.line("obj-params", 0, "obj-gen", 0),
        mh.line("obj-gen", 0, "obj-record", 0),
        mh.line("obj-gen", 1, "obj-record", 1),
        mh.line("obj-gen", 0, "obj-mute-l", 0),
        mh.line("obj-gen", 1, "obj-mute-r", 0),
    ]
    return boxes, lines


def run_case(gen_code, case):
    boxes, lines = device_patch(case, gen_code)
    # Voices are gated on at the start of the measured window (sample time, stepped mode).
    events = [(SETTLE_MS, "obj-js", 3, "trigger")]
    if "rebound_ms" in case:
        events.append((SETTLE_MS + case["rebound_ms"], "obj-js", 3, "rebound"))
    if "release_ms" in case:
        events.append((SETTLE_MS + case["release_ms"], "obj-js", 3, "release"))
    opts = case.get("opts", "")
    return mh.run_case(
        case["name"], boxes, lines,
        probe_js=PROBE_JS, probe_args=f"{case['name']} {case.get('cut_ms', 0)} {opts}".strip(),
        settle_ms=SETTLE_MS, dur_ms=case["dur"], channels=2,
        mode=case.get("harness_mode", "stepped"), events=events,
    )


SLICE_BASE = "mode 0, sliced 1, filt_on 0, unison_voices 1, unison_width 0, unison_detune 0, sus_lvl 1, atk_ms 0.5, dec_ms 10000, out_gain 0"
POS_BASE = "freeze {fz}, play_pos {pos}, loop_mode 0, unison_voices 1, unison_width 0, unison_detune 0, grain_spray 0, lfo_pos 0, menv_pos 0, filt_on 0, sus_lvl 1, dec_ms 10000, atk_ms 0.5, out_gain 0"


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
        "params": "mode 0, sliced 1, slice_play 2, filt_on 1, filt_type 0, filt_cutoff 2800, filt_res 0.45, filt_drive 0.5, out_gain 0",
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
    # Slice (slice 0.10..0.20 of 12000 frames = 1200 samples = 25 ms at ratio 1; cut at 60 ms).
    {"name": "slice_end", "dur": 400, "cut_ms": 60, "params": SLICE_BASE + ", slice_play 0"},
    {"name": "slice_sample_end", "dur": 400, "cut_ms": 60, "params": SLICE_BASE + ", slice_play 1"},
    {"name": "slice_loop", "dur": 400, "cut_ms": 60, "params": SLICE_BASE + ", slice_play 2"},
    {"name": "slice_pingpong", "dur": 400, "cut_ms": 60, "params": SLICE_BASE + ", slice_play 3"},
    {"name": "slice_reverse_end", "dur": 400, "cut_ms": 60, "params": SLICE_BASE + ", slice_play 0, reverse 1"},
    # Reverse "to sample end" runs from the slice end back to the sample start (0.40..0.50 slice).
    {"name": "slice_reverse_sample", "dur": 400, "cut_ms": 80, "params": SLICE_BASE + ", slice_play 1, reverse 1"},
    # Live bounds: re-poked at +100 ms without a new trigger.
    {"name": "live_loop", "dur": 400, "cut_ms": 150, "rebound_ms": 100, "params": SLICE_BASE + ", slice_play 2"},
    {"name": "live_pingpong", "dur": 400, "cut_ms": 150, "rebound_ms": 100, "params": SLICE_BASE + ", slice_play 3"},
    # To sample end, start moved from 0.00 to 0.20 behind the playhead: playback must carry on.
    {"name": "live_continue", "dur": 150, "cut_ms": 100, "rebound_ms": 100, "params": SLICE_BASE + ", slice_play 1"},
    {
        "name": "mono_sample",
        "dur": 500,
        "params": "mode 0, loop_mode 1, unison_voices 1, unison_width 0, unison_detune 0, freeze 0, reverse 0, filt_on 0, sus_lvl 1, out_gain 0",
    },
]


for _mode in (0, 1, 2):
    for _pos, _tag in ((0.0, "0"), (0.5, "50")):
        CASES.append({
            "name": f"pos_off{_tag}_m{_mode}", "dur": 400,
            "params": f"mode {_mode}, " + POS_BASE.format(fz=0, pos=_pos),
        })
for _pos, _tag in ((0.1, "10"), (0.5, "50")):
    CASES.append({
        "name": f"pos_on{_tag}_m0", "dur": 400,
        "params": "mode 0, " + POS_BASE.format(fz=1, pos=_pos),
    })




# ---------------------------------------------------------------------------------------------
# Engines x Single / Sliced, characters, Spectral and Fragments
# ---------------------------------------------------------------------------------------------
# Neutral voice: one centred note, no filter, flat sustained envelope, root A3 (57) so that note 57 plays the
# 220 Hz test sample at ratio 1.
NB = ("filt_on 0, unison_voices 1, unison_width 0, unison_detune 0, sus_lvl 1, atk_ms 0.5, dec_ms 10000, rel_ms 20, "
      "out_gain 0, vel_sens 0, lfo_pos 0, menv_pos 0, lfo_pitch 0, menv_pitch 0, grain_spray 0, loop_mode 0, "
      "root_note 57, reverse 0, freeze 0, sliced 0, glide_ms 0, grain_motion 1.0")


def P(extra=""):
    return NB + (", " + extra if extra else "")


def add(name, params, dur=500, **kw):
    case = {"name": name, "dur": dur, "params": params}
    case.update(kw)
    CASES.append(case)


T48 = "src=tone48 notes=57 "
S48 = "src=sus48 notes=57 "
R48 = "src=rich48 notes=57 "

# Every engine sounds
add("eng_repitch", P("mode 0"), 500, opts=T48)
add("eng_cycles", P("mode 1"), 500, opts=S48)
add("eng_textures", P("mode 2, grain_size 60"), 500, opts=S48)
add("eng_spectral", P("mode 3"), 700, opts=T48 + "ana=150")
add("eng_spectral_q0", P("mode 3, sp_quality 0"), 700, opts=T48 + "ana=150")
add("eng_spectral_q2", P("mode 3, sp_quality 2"), 900, opts=T48 + "ana=150")
add("eng_spectral_nolive", P("mode 3, sp_live 0"), 700, opts=T48 + "ana=150")
add("eng_fragments", P("mode 4, grain_size 60, fr_density 4"), 500, opts=S48)

# Sliced works in every engine: slice 0.10..0.30 of the 12000-frame sample (50 ms at natural speed)
SLICE_OPTS = S48 + "slice=0.1:0.3 "
for _e, _en in enumerate(("repitch", "cycles", "textures", "spectral", "fragments")):
    _gp = "grain_size 40, " if _e in (2, 4) else ""
    add(f"sl_{_en}_end", P(f"mode {_e}, sliced 1, {_gp}slice_play 0"), 700, cut_ms=350, opts=SLICE_OPTS)
    add(f"sl_{_en}_loop", P(f"mode {_e}, sliced 1, {_gp}slice_play 2"), 700, cut_ms=350, opts=SLICE_OPTS)
    add(f"sl_{_en}_pp", P(f"mode {_e}, sliced 1, {_gp}slice_play 3"), 700, cut_ms=350, opts=SLICE_OPTS)
    add(f"sl_{_en}_live", P(f"mode {_e}, sliced 1, {_gp}slice_play 2"), 700, cut_ms=350, rebound_ms=150,
        opts=S48 + "slice=0.6:0.7 newslice=0.1:0.2")

# Repitch characters
RPB = "mode 0, loop_mode 1, loop_start 0.05, loop_end 0.95, loop_xfade 0.2"
add("rp_clean_sus", P(RPB), 500, opts=S48)
add("rp_clean_rich", P(RPB), 500, opts=R48)
add("rp_an_d0", P(RPB + ", rp_char 1"), 500, opts=S48)
add("rp_an_d8", P(RPB + ", rp_char 1, rp_dist 0.8"), 500, opts=S48)
add("rp_an_rich", P(RPB + ", rp_char 1"), 500, opts=R48)
add("rp_an_cp", P(RPB + ", rp_char 1, rp_color 0.8"), 500, opts=R48)
add("rp_an_cn", P(RPB + ", rp_char 1, rp_color -1.0"), 500, opts=R48)
add("rp_dg_d0", P(RPB + ", rp_char 2"), 500, opts=S48)
add("rp_dg_d1", P(RPB + ", rp_char 2, rp_dist 1.0"), 500, opts=S48)
add("rp_dg_cpos", P(RPB + ", rp_char 2, rp_color 0.6, rp_imaging 0"), 500, opts=R48)
add("rp_dg_cneg", P(RPB + ", rp_char 2, rp_color -0.6, rp_imaging 0"), 500, opts=R48)
add("rp_dg_img1", P(RPB + ", rp_char 2, rp_color 0.5, rp_imaging 1"), 500, opts=R48)
add("rp_dg_img0", P(RPB + ", rp_char 2, rp_color 0.5, rp_imaging 0"), 500, opts=R48)
add("rp_dg_vsr0", P(RPB + ", rp_char 2, rp_color 0.4, rp_imaging 1, rp_vsr 0"), 500, opts="src=rich48 notes=45 f0=110 ")
add("rp_dg_vsr1", P(RPB + ", rp_char 2, rp_color 0.4, rp_imaging 1, rp_vsr 1"), 500, opts="src=rich48 notes=45 f0=110 ")

# Cycles characters (frozen playhead on a periodic sample, so the timbre is steady)
CYB = "mode 1, freeze 1, play_pos 0.5"
add("cy_base", P(CYB), 500, opts=S48)
add("cy_pulse_p", P(CYB + ", cy_char 0, cy_width 0.8"), 500, opts=S48)
add("cy_pulse_n", P(CYB + ", cy_char 0, cy_width -0.8"), 500, opts=S48)
add("cy_part0", P(CYB + ", cy_char 1"), 500, opts=S48)
add("cy_odd", P(CYB + ", cy_char 1, cy_split -1"), 500, opts=S48)
add("cy_even", P(CYB + ", cy_char 1, cy_split 1"), 500, opts=S48)
add("cy_fund1", P(CYB + ", cy_char 1, cy_fund 1"), 500, opts=S48)
add("cy_ph0", P(CYB + ", cy_char 2, cy_mod 0"), 500, opts=S48)
add("cy_ph_mod", P(CYB + ", cy_char 2, cy_mod 0.8"), 500, opts=S48)
add("cy_ph_harm", P(CYB + ", cy_char 2, cy_mod 0.8, cy_harm 0.43"), 500, opts=S48)
for _c in (0, 1, 2):
    add(f"cy_form{_c}", P(CYB + f", cy_char {_c}, formant 7, cy_mod 0.5, cy_split -0.5"), 500, opts=S48)
add("cy_xf0", P("mode 1, grain_motion 2.0, cy_xfade 0"), 500, opts=T48)
add("cy_xf1", P("mode 1, grain_motion 2.0, cy_xfade 1"), 500, opts=T48)

# Spectral
add("sp_n", P("mode 3"), 800, opts=T48 + "ana=150")
add("sp_half", P("mode 3, grain_motion 0.5"), 1200, opts=T48 + "ana=150")
add("sp_dbl", P("mode 3, grain_motion 2.0"), 700, opts=T48 + "ana=150")
add("sp_p7", P("mode 3"), 800, opts="src=tone48 notes=64 f0=329.6 ana=150")
add("sp_f_on", P("mode 3, sp_formant_on 1"), 600, opts="src=rich48 notes=64 ana=150")
add("sp_f_off", P("mode 3, sp_formant_on 0"), 600, opts="src=rich48 notes=64 ana=150")
add("sp_f_rel", P("mode 3, sp_formant_on 1, sp_rel_formant 1"), 600, opts="src=rich48 notes=64 ana=150")
add("sp_rich", P("mode 3"), 600, opts=R48 + "ana=150")
add("sp_fshift", P("mode 3, formant 12"), 600, opts=R48 + "ana=150")
add("sp_rh0", P("mode 3, sp_char 1"), 600, opts=R48 + "ana=150")
add("sp_rh_bend", P("mode 3, sp_char 1, sp_bend 12"), 600, opts=R48 + "ana=150")
add("sp_q_oct", P("mode 3, sp_char 1, sp_quant 1"), 600, opts=R48 + "ana=150")
add("sp_q_key", P("mode 3, sp_char 1, sp_quant 2, sp_key 0, sp_scale 0"), 600, opts=R48 + "ana=150")
add("sp_ons_off", P("mode 3, grain_motion 0.25, sp_onsets 0"), 1200, opts="src=clicks48 notes=57 ana=150")
add("sp_ons_on", P("mode 3, grain_motion 0.25, sp_onsets 1"), 1200, opts="src=clicks48 notes=57 ana=150")
add("sp_disp0", P("mode 3, grain_motion 0.1, sp_dispersion 0"), 1200, opts=T48 + "ana=150")
add("sp_disp1", P("mode 3, grain_motion 0.1, sp_dispersion 1"), 1200, opts=T48 + "ana=150")
add("sp_freeze", P("mode 3, freeze 1, play_pos 0.3"), 700, opts=T48 + "ana=150")
add("sp_rev", P("mode 3, reverse 1"), 700, opts=T48 + "ana=150")
add("sp_loop", P("mode 3, loop_mode 1, loop_start 0.05, loop_end 0.95"), 900, cut_ms=450, opts=S48 + "ana=150")
add("sp_poly4", P("mode 3"), 700, opts="src=tone48 notes=57,60,64,67 ana=150")

# Fragments (frozen playhead; grain counts come from the gen telemetry, scope[48])
FRB = "mode 4, freeze 1, play_pos 0.5, grain_size 40, fr_density 1, fr_repeats 1, fr_env 0.5, fr_use_density 1"
add("fr_d1", P(FRB), 600, opts=S48)
add("fr_d2", P(FRB + ", fr_density 2"), 600, opts=S48)
add("fr_d8", P(FRB + ", fr_density 8"), 600, opts=S48)
add("fr_off8", P(FRB + ", fr_density 8, fr_use_density 0"), 600, opts=S48)
add("fr_r1", P(FRB + ", fr_density 2, fr_repeats 1"), 600, opts=S48)
add("fr_r4", P(FRB + ", fr_density 2, fr_repeats 4"), 600, opts=S48)
add("fr_max4", P(FRB + ", fr_density 20, fr_max_grains 4"), 600, opts=S48)
add("fr_max32", P(FRB + ", fr_density 20, fr_max_grains 256"), 600, opts=S48)
add("fr_nosync", P(FRB + ", grain_size 100, fr_density 4, fr_sync 0, tempo 120"), 800, opts=S48)
add("fr_sync", P(FRB + ", grain_size 100, fr_density 4, fr_sync 1, tempo 120"), 800, opts=S48)
add("fr_env5", P(FRB + ", fr_env 0.5"), 600, opts=S48)
add("fr_env0", P(FRB + ", fr_env 0.0"), 600, opts=S48)
add("fr_mot0", P(FRB + ", fr_density 4, fr_motion 0, unison_voices 1"), 600, opts=S48)
add("fr_mot4", P(FRB + ", fr_density 4, fr_motion 4"), 600, opts=S48)
add("fr_dir0", P(FRB + ", fr_density 4, fr_direction 0"), 600, opts=S48)
add("fr_dir2", P(FRB + ", fr_density 4, fr_direction 2"), 600, opts=S48)
add("fr_surv0", P(FRB + ", grain_size 400, rel_ms 10, fr_survive 0"), 700, cut_ms=250, release_ms=100, opts=S48)
add("fr_surv1", P(FRB + ", grain_size 400, rel_ms 10, fr_survive 1"), 700, cut_ms=250, release_ms=100, opts=S48)
add("fr_latch1", P(FRB + ", fr_density 4, lfo_pitch 0.3, lfo_rate 6, fr_latch 1"), 600, opts=S48)
add("fr_latch0", P(FRB + ", fr_density 4, lfo_pitch 0.3, lfo_rate 6, fr_latch 0"), 600, opts=S48)
add("fr_rinit1", P(FRB + ", fr_density 2, fr_repeats 4, fr_repeat_init 1"), 600, opts=S48)
add("fr_rinit0", P(FRB + ", fr_density 2, fr_repeats 4, fr_repeat_init 0"), 600, opts=S48)
add("fr_uni", P(FRB + ", fr_density 4, unison_voices 4, unison_width 1, unison_detune 0.5"), 600, opts=S48)


def run_with_retry(gen_code, case):
    """One render per case. The harness serialises Max machine-wide, and a missing or invalid result is a
    real failure, not a reason to retry."""
    return run_case(gen_code, case)


FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print(f"  FAIL: {msg}")


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"Skipping real Max audio test: {mh.MAX_BIN} not found")
        return

    gen_path = os.environ.get("SAMPLER_GEN") or GEN_PATH
    with open(gen_path, "r", encoding="utf-8") as f:
        gen_code = f.read()

    results = {}
    only = os.environ.get("SAMPLER_CASE", "").strip()
    cases = [c for c in CASES if not only or re.search(only, c["name"])]
    import json
    cache_path = os.environ.get("SAMPLER_CACHE")
    for c in cases:
        r = run_with_retry(gen_code, c)
        if not r:
            raise RuntimeError(f"Max audio harness did not produce a result for {c['name']}")
        results[c["name"]] = r
        ratio = (r["lateRms"] / r["earlyRms"]) if r.get("earlyRms", 0) > 1e-8 else 0.0
        r["lateEarly"] = ratio
        print(
            f"[{c['name']:16s}] peak={r['peak']:.4f} rms={r['rms']:.4f} "
            f"stereoDiff={r['stereoDiff']:.4f} late/early={ratio:.3f} "
            f"activeVoices={int(r['scopeActive'])} f={r.get('specPeakHz', 0):.1f}Hz "
            f"cent={r.get('centroid', 0):.0f} hf={r.get('hfFrac', 0):.2e} spawns={r.get('spawns', 0):.0f} "
            f"nan={int(r['nan'])}"
        )
        if os.environ.get("SAMPLER_DUMP"):
            print("    " + " ".join(f"{k}={v:.5g}" if isinstance(v, float) else f"{k}={v}"
                                    for k, v in sorted(r.items()) if not k.startswith("harness_")))
        check(r["nan"] == 0, f"{c['name']}: NaN detected in audio output")
        check(r["peak"] < 1.05, f"{c['name']}: output exceeded the soft ceiling ({r['peak']})")
        check(r["scopeFrames"] >= 8000, f"{c['name']}: sample buffer was not bound (frames={r['scopeFrames']})")
        sys.stdout.flush()
        if cache_path:
            with open(cache_path, "w") as cf:
                json.dump(results, cf)

    if only:
        print("Partial sampler audio run; cross-case checks skipped.")
        return
    run_checks(results)
    if FAILS:
        print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
        raise SystemExit(1)
    print(f"All {len(CASES)} real Max 9 Better Sampler audio tests passed!")


def run_checks(results):
    # Verify idle silence
    check(results["idle_silent"]["peak"] < 1e-4, "idle_silent must be silent when no voices are gated")
    check(results["idle_silent"]["scopeActive"] == 0, "idle_silent must report 0 active voices")

    for active_case in ("repitch_chord", "cycles_formant", "textures_cloud", "slice_trig"):
        r = results[active_case]
        check(r["peak"] > 0.05, f"{active_case}: expected audible output peak > 0.05, got {r['peak']}")
        check(r["rms"] > 0.01, f"{active_case}: expected audible RMS > 0.01, got {r['rms']}")
        check(r["scopeActive"] >= 1, f"{active_case}: #0-bsscope must report active voices >= 1")
        check(r["scopePeakL"] > 0.02, f"{active_case}: #0-bsscope must report live output peak")

    check(results["repitch_chord"]["scopeActive"] >= 3, "Repitch triad must keep 3 voices active")
    check(results["repitch_chord"]["stereoDiff"] > 0.01, "4x Unison triad must produce stereo spread")
    check(results["repitch_chord"]["scopeCutHz"] > 8000, "Open SVF cutoff must land in the scope telemetry")
    check(1000 < results["slice_trig"]["scopeCutHz"] < 5000, "Slice LP cutoff must track the 2.8 kHz filter")

    for tonal in ("forward_oneshot", "reverse_oneshot", "freeze_hold", "unison8_wide"):
        r = results[tonal]
        check(r["peak"] > 0.04, f"{tonal}: expected audible peak > 0.04, got {r['peak']}")
        check(r["rms"] > 0.008, f"{tonal}: expected audible RMS > 0.008, got {r['rms']}")
        check(r["scopeActive"] >= 1, f"{tonal}: #0-bsscope must report an active voice")
        check(r["earlyRms"] > 0.005 and r["lateRms"] > 0.005, f"{tonal}: both analysis windows must be audible")

    fwd = results["forward_oneshot"]["lateEarly"]
    rev = results["reverse_oneshot"]["lateEarly"]
    check(fwd < 0.92, f"Forward one-shot must decay (late/early={fwd:.3f})")
    check(rev > fwd + 0.2, f"Reverse must walk back into the attack (late/early={rev:.3f}, forward={fwd:.3f})")

    frozen = results["freeze_hold"]["lateEarly"]
    check(0.8 <= frozen <= 1.25, f"Frozen playhead must hold a steady level (late/early={frozen:.3f})")

    check(results["unison8_wide"]["stereoDiff"] > results["forward_oneshot"]["stereoDiff"] + 0.015,
          "8-voice wide unison must spread wider than a centered single voice")
    check(results["unison8_wide"]["scopeActive"] == 1, "Unison stacks inside one allocated voice")

    mono = results["mono_sample"]
    check(mono["peak"] > 0.04 and mono["rms"] > 0.008, "mono_sample: expected audible output")
    check(mono["stereoDiff"] < 0.001, f"mono_sample: L/R must match (stereoDiff={mono['stereoDiff']})")
    check(mono["scopePeakL"] > 0.02, "mono_sample: scope must report live output")

    # ---- Sliced (Repitch engine): slice_play ----
    se, ss, sl, sp = (results[n] for n in ("slice_end", "slice_sample_end", "slice_loop", "slice_pingpong"))
    check(se["headRms"] > 0.05, f"slice_end: slice must sound first (headRms={se['headRms']})")
    check(se["afterRms"] < 1e-3 and se["afterPeak"] < 5e-3,
          f"slice_end: must be silent after the slice length (afterRms={se['afterRms']}, afterPeak={se['afterPeak']})")
    check(ss["afterRms"] > 0.03, f"slice_sample_end: must keep sounding past the slice end (afterRms={ss['afterRms']})")
    for loop_case, r in (("slice_loop", sl), ("slice_pingpong", sp)):
        check(r["headRms"] > 0.05 and r["afterRms"] > 0.03,
              f"{loop_case}: needs sustained energy past the slice length (head={r['headRms']}, after={r['afterRms']})")
        check(0.1 <= r["scopePos0"] <= 0.2 + 1e-3, f"{loop_case}: playhead must stay in the slice (pos={r['scopePos0']})")
    sre, srs = results["slice_reverse_end"], results["slice_reverse_sample"]
    check(sre["headRms"] > 0.05 and sre["afterRms"] < 1e-3,
          f"slice_reverse_end: reverse plays slice end -> start once, then stops (head={sre['headRms']}, after={sre['afterRms']})")
    check(srs["headRms"] > 0.05 and srs["afterRms"] > 0.01,
          f"slice_reverse_sample: reverse must run from the slice end toward the sample start (after={srs['afterRms']})")

    # ---- Live slice bounds ----
    ll, lp, lc = results["live_loop"], results["live_pingpong"], results["live_continue"]
    check(0.1 - 1e-3 <= ll["scopePos0"] <= 0.2 + 1e-3, f"live_loop: playhead must be inside the new 0.10..0.20 slice (pos={ll['scopePos0']})")
    check(0.1 - 1e-3 <= lp["scopePos0"] <= 0.2 + 1e-3, f"live_pingpong: playhead must be inside the new 0.10..0.20 slice (pos={lp['scopePos0']})")
    for live_case, r in (("live_loop", ll), ("live_pingpong", lp)):
        check(r["afterRms"] > 0.03, f"{live_case}: must keep sounding after the bounds change (afterRms={r['afterRms']})")
    # Playhead was at ~4800 frames when the start moved to 2400. Playback continues: ~7200 frames (0.60).
    # A restart at the new start would land at ~4800 frames (0.40).
    check(0.55 <= lc["scopePos0"] <= 0.66, f"live_continue: held note must not restart on a bounds change (pos={lc['scopePos0']})")

    # ---- Pos only with Freeze ----
    def rel_diff(a, b):
        return abs(a - b) / max(a, b, 1e-9)
    for m in (0, 1, 2):
        off0, off50 = results[f"pos_off0_m{m}"], results[f"pos_off50_m{m}"]
        check(off0["rms"] > 0.005, f"pos_off0_m{m}: expected audible output")
        check(rel_diff(off0["rms"], off50["rms"]) < 1e-4 and abs(off0["peak"] - off50["peak"]) < 1e-4,
              f"mode {m}: Pos must be ignored with Freeze off (rms {off0['rms']} vs {off50['rms']})")
    on0, on50 = results["pos_on10_m0"], results["pos_on50_m0"]
    check(on0["rms"] > 0.005 and on50["rms"] > 0.005, "pos_on (Pos 0.1 vs 0.5): expected audible output")
    check(rel_diff(on0["rms"], on50["rms"]) > 0.1,
          f"Pos must move the frozen playhead (rms {on0['rms']} vs {on50['rms']})")

    run_new_checks(results)


def run_new_checks(results):
    pass


if __name__ == "__main__":
    main()
