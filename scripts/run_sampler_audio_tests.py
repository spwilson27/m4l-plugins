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
  SAMPLER_CPU_ENGINES=<regex>  measure only the matching CPU_ENGINES labels

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
CONFIG_PATH = os.path.join(ROOT, "src", "sampler_config.js")
_SEQ_PROBE = None


def seq_probe_path():
    """Probe for note-sequence cases: src/sampler_config.js (the real voice allocator and activeSliceStarts) in front
    of tests/sampler_probe.js, so the test pokes #0-bsvoices exactly like the face does."""
    global _SEQ_PROBE
    if _SEQ_PROBE is None:
        import tempfile
        d = tempfile.mkdtemp(prefix="sampler_seq_probe_")
        _SEQ_PROBE = os.path.join(d, "sampler_seq_probe.js")
        with open(_SEQ_PROBE, "w", encoding="utf-8") as f:
            f.write(open(CONFIG_PATH, encoding="utf-8").read() + "\n" + open(PROBE_JS, encoding="utf-8").read())
    return _SEQ_PROBE


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
    events = [] if (case.get("no_trigger") or case.get("seq")) else [(SETTLE_MS, "obj-js", 3, "trigger")]
    if "rebound_ms" in case:
        events.append((SETTLE_MS + case["rebound_ms"], "obj-js", 3, "rebound"))
    if "release_ms" in case:
        events.append((SETTLE_MS + case["release_ms"], "obj-js", 3, "release"))
    opts = case.get("opts", "")
    seq = case.get("seq")
    if seq:
        # keys=[...], step ms between key-ons, hold ms each key is held; snap slightly before the key-off
        keys, step, hold = seq["keys"], seq.get("step", 150), seq.get("hold", 120)
        opts += f" seq={','.join(str(k) for k in keys)} step={step} hold={hold} skip={seq.get('skip', 30)}"
        for i, k in enumerate(keys):
            events.append((SETTLE_MS + i * step, "obj-js", 3, f"noteon {k} 100"))
            events.append((SETTLE_MS + i * step + int(hold * seq.get("snap", 0.85)), "obj-js", 3, f"snap {i}"))
            events.append((SETTLE_MS + i * step + hold, "obj-js", 3, f"noteoff {k}"))
    return mh.run_case(
        case["name"], boxes, lines,
        probe_js=seq_probe_path() if seq else PROBE_JS, probe_args=f"{case['name']} {case.get('cut_ms', 0)} {opts}".strip(),
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
# Pitch: the fundamental must be the note pitch (220 Hz at the root, 440 Hz an octave up) in every character
add("cy_oct_up", P(CYB), 500, opts="src=sus48 notes=69 ")
add("cy_pulse_oct", P(CYB + ", cy_char 0, cy_width 0.5"), 500, opts="src=sus48 notes=69 ")
add("cy_part_oct", P(CYB + ", cy_char 1"), 500, opts="src=sus48 notes=69 ")
add("cy_fund_oct", P(CYB + ", cy_char 1, cy_fund 1"), 500, opts="src=sus48 notes=69 ")
# Harmonic-rich source (sus48 only has h1..h3) for the odd / even split checks
add("cy_r_base", P(CYB), 500, opts=R48)
add("cy_r_odd", P(CYB + ", cy_char 1, cy_split -1"), 500, opts=R48)
add("cy_r_even", P(CYB + ", cy_char 1, cy_split 1"), 500, opts=R48)
add("cy_ph_oct", P(CYB + ", cy_char 2, cy_mod 0.3"), 500, opts="src=sus48 notes=69 ")
add("cy_xf1_root", P(CYB + ", cy_xfade 1"), 500, opts=S48)
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
add("fr_surv0", P(FRB + ", play_pos 0.1, grain_size 200, rel_ms 10, fr_survive 0"), 500, cut_ms=120, release_ms=60, opts=S48)
add("fr_surv1", P(FRB + ", play_pos 0.1, grain_size 200, rel_ms 10, fr_survive 1"), 500, cut_ms=120, release_ms=60, opts=S48)
add("fr_latch1", P(FRB + ", fr_density 4, lfo_pitch 0.3, lfo_rate 6, fr_latch 1"), 600, opts=S48)
add("fr_latch0", P(FRB + ", fr_density 4, lfo_pitch 0.3, lfo_rate 6, fr_latch 0"), 600, opts=S48)
add("fr_rinit1", P(FRB + ", fr_density 2, fr_repeats 4, fr_repeat_init 1"), 600, opts=S48)
add("fr_rinit0", P(FRB + ", fr_density 2, fr_repeats 4, fr_repeat_init 0"), 600, opts=S48)
add("fr_uni", P(FRB + ", fr_density 4, unison_voices 4, unison_width 1, unison_detune 0.5"), 600, opts=S48)

# ---------------------------------------------------------------------------------------------
# Real note sequences (Sliced keymap) and Loop Off, per engine
# ---------------------------------------------------------------------------------------------
# A test sample with four distinct tones (240 / 320 / 480 / 640 Hz, one per quarter) is sliced at 0, .25, .5, .75 and
# played with keys C1.. (36..39, then 40 wraps to slice 0) through the real voice allocator, written to #0-bsvoices
# like the face does. Root note 60 on purpose: a key that does not play its slice at the root pitch is audibly wrong.
SLICE_HZ = [240.0, 320.0, 480.0, 640.0]
SEQ_ENGINES = (("repitch", 0, ""), ("cycles", 1, ""), ("textures", 2, "grain_size 40, "), ("spectral", 3, ""),
               ("fragments", 4, "grain_size 40, fr_density 4, "))
for _en, _e, _gp in SEQ_ENGINES:
    # Spectral runs on voices 0..3 only; the face caps polyphony at 4 there (voiceCap()), so does the probe (cap=4)
    add(f"keys_{_en}", P(f"mode {_e}, {_gp}sliced 1, slice_play 2, root_note 60"), 800,
        opts="src=slices4 ana=0 " + ("cap=4 " if _e == 3 else ""), seq={"keys": [36, 37, 38, 39, 40], "step": 150, "hold": 120, "skip": 40})
# slice_play 0 plays each slice once (62.5 ms) and stops
add("keys_repitch_once", P("mode 0, sliced 1, slice_play 0, root_note 60"), 500,
    opts="src=slices4 ana=0 ", seq={"keys": [36, 37, 38, 39], "step": 100, "hold": 80, "skip": 8, "snap": 0.45})
# "Use keys from" moved to E2 (52): slice k plays on 52 + k
add("keys_repitch_base52", P("mode 0, sliced 1, slice_play 2, root_note 60"), 700,
    opts="src=slices4 ana=0 base=52 ", seq={"keys": [52, 53, 54, 55], "step": 150, "hold": 120, "skip": 40})
# Start and end moved to 0.25..0.75: two slices, keys wrap
add("keys_repitch_trim", P("mode 0, sliced 1, slice_play 2, root_note 60, samp_start 0.25, samp_end 0.75"), 700,
    opts="src=slices4 ana=0 sstart=0.25 send=0.75 ", seq={"keys": [36, 37, 38], "step": 150, "hold": 120, "skip": 40})

# Loop Off (Single): the sample plays once and then the voice is silent, in every engine. Loop Fwd keeps sounding.
# The sample is 12000 frames = 250 ms at natural speed; Cycles scans at most 0.7 sample per second.
for _en, _e, _gp in SEQ_ENGINES:
    _dur, _cut = (2100, 1800) if _en == "cycles" else (900, 550)
    _mo = ", grain_motion 2.0" if _en == "cycles" else ""
    for _lm, _tag in ((0, "off"), (1, "fwd")):
        add(f"lp_{_en}_{_tag}", P(f"mode {_e}, {_gp}loop_mode {_lm}, loop_start 0.05, loop_end 0.95, root_note 57{_mo}"), _dur,
            cut_ms=_cut, opts=S48)
add("lp_repitch_rev_off", P("mode 0, loop_mode 0, reverse 1, root_note 57"), 900, cut_ms=550, opts=S48)
add("lp_repitch_pp", P("mode 0, loop_mode 2, loop_start 0.05, loop_end 0.95, root_note 57"), 900, cut_ms=550, opts=S48)


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
    cases = [c for c in CASES if (not only or re.search(only, c["name"]))]
    if os.environ.get("SAMPLER_CPU_ONLY"):
        measure_cpu(gen_code)
        return
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

    if only and os.environ.get("SAMPLER_SEQ_ONLY"):
        # SAMPLER_CASE='^(keys_|lp_)' SAMPLER_SEQ_ONLY=1: just the note-sequence and Loop Off cases and their checks
        run_seq_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Note-sequence and Loop Off checks passed.")
        return
    if only:
        print("Partial sampler audio run; cross-case checks skipped.")
        return
    run_checks(results)
    if os.environ.get("SAMPLER_CPU", "1") != "0":
        measure_cpu(gen_code)
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
    run_seq_checks(results)


def run_seq_checks(R):
    """Sliced keys play their slices (dominant frequency per key, playhead inside the key's slice); Loop Off stops."""
    def key_checks(name, slices, engine, lo_list, hz_list):
        r = R[name]
        for i, sl in enumerate(slices):
            hz, rms, pos = r[f"seq{i}Hz"], r[f"seq{i}Rms"], r[f"seq{i}Pos"]
            check(rms > 0.02, f"{name}: key #{i} must sound (rms={rms:.4f})")
            lo = lo_list[sl]
            check(lo - 0.006 <= pos <= lo + 0.25 + 0.006, f"{name}: key #{i} playhead must sit in slice {sl} {lo:.2f}..{lo + 0.25:.2f} (pos={pos:.3f})")
            # Textures is a grain cloud: the grain-rate sidebands (25 Hz at 40 ms) can win the peak pick by a few %;
            # an octave error (the old bug: scan speed added to the grain's own read speed) is 100 %.
            tol = 0.09 if engine == "textures" else 0.04
            if engine != "cycles":
                check(abs(hz - hz_list[sl]) < tol * hz_list[sl],
                      f"{name}: key #{i} must play slice {sl} at {hz_list[sl]:.0f} Hz (got {hz:.1f} Hz)")
    q = [0.0, 0.25, 0.5, 0.75]
    for _en, _e, _ in SEQ_ENGINES:
        key_checks(f"keys_{_en}", [0, 1, 2, 3, 0], _en, q, SLICE_HZ)
    key_checks("keys_repitch_once", [0, 1, 2, 3], "repitch", q, SLICE_HZ)
    key_checks("keys_repitch_base52", [0, 1, 2, 3], "repitch", q, SLICE_HZ)
    # start..end 0.25..0.75 holds two slices, 0.25..0.5 (320 Hz) and 0.5..0.75 (480 Hz); key 38 wraps to slice 0
    key_checks("keys_repitch_trim", [0, 1, 0], "repitch", [0.25, 0.5], [320.0, 480.0])

    # The gen reports the parameter values it runs with (scope 40..47)
    kr = R["keys_repitch"]
    check((kr["gpSliced"], kr["gpLoopMode"], kr["gpSlicePlay"], kr["gpMode"], kr["gpRoot"]) == (1, 0, 2, 0, 60),
          f"gen telemetry must report its parameters (sliced, loop_mode, slice_play, mode, root_note) = (1, 0, 2, 0, 60), got "
          f"{(kr['gpSliced'], kr['gpLoopMode'], kr['gpSlicePlay'], kr['gpMode'], kr['gpRoot'])}")
    check((R["lp_cycles_fwd"]["gpLoopMode"], R["lp_cycles_fwd"]["gpMode"], R["lp_cycles_fwd"]["gpSliced"]) == (1, 1, 0),
          "gen telemetry must report loop_mode 1 / mode 1 / sliced 0 in the Cycles Loop Fwd case")

    for _en, _e, _ in SEQ_ENGINES:
        off, fwd = R[f"lp_{_en}_off"], R[f"lp_{_en}_fwd"]
        check(off["headRms"] > 0.02, f"lp_{_en}_off: the sample must play (headRms={off['headRms']:.4f})")
        check(off["afterRms"] < 0.004, f"Loop Off must stop at the sample end in {_en} (afterRms={off['afterRms']:.4f})")
        check(fwd["afterRms"] > 0.03, f"Loop Fwd must keep sounding in {_en} (afterRms={fwd['afterRms']:.4f})")
    check(R["lp_repitch_rev_off"]["afterRms"] < 0.004, f"Reverse with Loop Off must stop (afterRms={R['lp_repitch_rev_off']['afterRms']:.4f})")
    check(R["lp_repitch_pp"]["afterRms"] > 0.03, "Loop Ping-Pong must keep sounding")


# CPU per engine. Each configuration renders a short and a long NonRealTime run of the same patch (voices start
# at load, no events); the wall-time difference removes Max launch and gen compile time, so
# xRT = audio seconds rendered per wall second of one core.
CPU_ENGINES = (
    ("repitch", "mode 0, loop_mode 1, loop_start 0.05, loop_end 0.95"),
    ("repitch+analog", "mode 0, loop_mode 1, loop_start 0.05, loop_end 0.95, rp_char 1, rp_dist 0.5, rp_color 0.5"),
    ("repitch+digital", "mode 0, loop_mode 1, loop_start 0.05, loop_end 0.95, rp_char 2, rp_dist 0.3, rp_color 0.3"),
    ("cycles", "mode 1"),
    ("textures", "mode 2, grain_size 60"),
    ("spectral(1024)", "mode 3, sp_quality 0, loop_mode 1, loop_start 0.05, loop_end 0.95"),
    ("spectral(2048)", "mode 3, sp_quality 1, loop_mode 1, loop_start 0.05, loop_end 0.95"),
    ("spectral(4096)", "mode 3, sp_quality 2, loop_mode 1, loop_start 0.05, loop_end 0.95"),
    ("fragments", "mode 4, grain_size 60, fr_density 8, fr_repeats 2, loop_mode 1, loop_start 0.05, loop_end 0.95"),
)


def measure_cpu(gen_code, short_ms=10000, long_ms=70000):
    """Wall-time slope of a short and a long NonRealTime render = single-core load at real time.
    The slope includes the harness floor (record~, scheduler); every engine runs its voice code for all 16 voices
    whether or not they are playing, so 'idle' and 'playing' differ only by the grains / frames in flight."""
    print("CPU per engine: single-core load at real time (% of one core), from 10 s vs 70 s NonRealTime renders.")
    print("  The harness floor (record~, scheduler) is included; resolution is about +-2%.")
    for label, params in CPU_ENGINES:
        if os.environ.get("SAMPLER_CPU_ENGINES") and not re.search(os.environ["SAMPLER_CPU_ENGINES"], label):
            continue
        out = []
        for nv, notes in ((0, ""), (4, "57,60,64,67")):
            walls = []
            for dur in (short_ms, long_ms):
                opts = "src=sus48 notes=57" if nv == 0 else f"src=sus48 notes={notes} start=live"
                case = {"name": "cpu", "dur": dur, "params": P(params), "no_trigger": True,
                        "harness_mode": "nrt", "opts": opts}
                walls.append(run_case(gen_code, case)["harness_wall_s"])
            out.append((walls[1] - walls[0]) / ((long_ms - short_ms) / 1000.0) * 100.0)
        print(f"  {label:18s} 0 voices: {out[0]:5.1f}%   4 voices: {out[1]:5.1f}%   (xRT {100.0 / max(out[1], 0.1):5.1f})")


def run_new_checks(results):
    R = results

    def ratio(a, b):
        return a / max(b, 1e-30)

    def differs(a, b, rel=1e-3):
        return abs(R[a]["chk"] - R[b]["chk"]) > rel * max(abs(R[a]["chk"]), abs(R[b]["chk"]), 1e-9)

    # ---- every engine sounds, finite, and keeps the pitch where it should ----
    for n in ("eng_repitch", "eng_cycles", "eng_textures", "eng_spectral", "eng_spectral_q0", "eng_spectral_q2",
              "eng_spectral_nolive", "eng_fragments"):
        r = R[n]
        check(r["peak"] > 0.05 and r["rms"] > 0.02, f"{n}: must be audible (peak={r['peak']}, rms={r['rms']})")
        check(r["scopeActive"] >= 1, f"{n}: scope must report an active voice")
    for n in ("eng_repitch", "eng_spectral", "eng_spectral_q0", "eng_spectral_q2", "eng_spectral_nolive"):
        check(abs(R[n]["specPeakHz"] - 220.0) < 4.0, f"{n}: note at the root key must sound at 220 Hz (got {R[n]['specPeakHz']:.1f})")
    check(abs(R["eng_fragments"]["specPeakHz"] - 220.0) < 25.0, f"eng_fragments: pitch must follow the sample ({R['eng_fragments']['specPeakHz']:.1f} Hz)")
    check(R["eng_spectral"]["startMs"] < 8.0, f"Spectral Live mode must start without latency (startMs={R['eng_spectral']['startMs']:.1f})")
    check(R["eng_spectral_nolive"]["startMs"] > 15.0,
          f"Spectral with Live off ramps in (startMs={R['eng_spectral_nolive']['startMs']:.1f})")

    # ---- Sliced works in every engine ----
    for en in ("repitch", "cycles", "textures", "spectral", "fragments"):
        e, lp, pp, lv = (R[f"sl_{en}_{k}"] for k in ("end", "loop", "pp", "live"))
        check(e["headRms"] > 0.02, f"sl_{en}_end: the slice must sound (headRms={e['headRms']})")
        check(e["afterRms"] < 0.002, f"sl_{en}_end: must be silent once the slice has played (afterRms={e['afterRms']})")
        for k, r in (("loop", lp), ("pp", pp)):
            check(r["afterRms"] > 0.03 and r["afterRms"] > 0.4 * r["headRms"],
                  f"sl_{en}_{k}: looping slice must sustain (head={r['headRms']}, after={r['afterRms']})")
        check(lv["afterRms"] > 0.03, f"sl_{en}_live: must keep sounding after the slice bounds move (afterRms={lv['afterRms']})")
        check(0.095 <= lv["scopePos0"] <= 0.21, f"sl_{en}_live: playhead must be inside the new 0.10..0.20 slice (pos={lv['scopePos0']})")

    # ---- Repitch characters ----
    check(abs(R["rp_an_d0"]["rms"] - R["rp_clean_sus"]["rms"]) < 1e-3 * R["rp_clean_sus"]["rms"]
          and abs(R["rp_an_d0"]["centroid"] - R["rp_clean_sus"]["centroid"]) < 2.0,
          "Analog at Dist 0 / Color 0 must be transparent (apart from a 2-sample delay)")
    check(R["rp_an_d8"]["hfFrac"] > 1e4 * R["rp_an_d0"]["hfFrac"], "Analog Dist must generate harmonics "
          f"(hf {R['rp_an_d8']['hfFrac']:.2e} vs {R['rp_an_d0']['hfFrac']:.2e})")
    check(R["rp_an_cp"]["centroid"] > 1.08 * R["rp_clean_rich"]["centroid"], "Analog Color + must be brighter "
          f"({R['rp_an_cp']['centroid']:.0f} vs {R['rp_clean_rich']['centroid']:.0f} Hz)")
    check(R["rp_an_cp"]["stereoDiff"] > 0.05 and R["rp_clean_rich"]["stereoDiff"] < 1e-3,
          f"Analog Color + must separate the stereo image (stereoDiff={R['rp_an_cp']['stereoDiff']})")
    check(R["rp_an_cn"]["centroid"] < 0.7 * R["rp_clean_rich"]["centroid"], "Analog Color - must be warmer "
          f"({R['rp_an_cn']['centroid']:.0f} vs {R['rp_clean_rich']['centroid']:.0f} Hz)")
    check(R["rp_dg_d0"]["hfFrac"] < 1e-5 and abs(R["rp_dg_d0"]["rms"] - R["rp_clean_sus"]["rms"]) < 1e-3 * R["rp_clean_sus"]["rms"],
          "Digital at Dist 0 (about 13 bits) must stay clean")
    check(R["rp_dg_d1"]["hfFrac"] > 1e4 * R["rp_dg_d0"]["hfFrac"], "Digital Dist must reduce the bit depth "
          f"(hf {R['rp_dg_d1']['hfFrac']:.2e} vs {R['rp_dg_d0']['hfFrac']:.2e})")
    check(R["rp_dg_cpos"]["hfFrac"] > 2.0 * R["rp_dg_cneg"]["hfFrac"], "Digital Color + must alias, - must be band-limited "
          f"(hf {R['rp_dg_cpos']['hfFrac']:.3f} vs {R['rp_dg_cneg']['hfFrac']:.3f})")
    check(R["rp_dg_img0"]["hfFrac"] > 5.0 * R["rp_dg_img1"]["hfFrac"], "Imaging filter must remove the images "
          f"(hf off {R['rp_dg_img0']['hfFrac']:.3f} vs on {R['rp_dg_img1']['hfFrac']:.4f})")
    check(R["rp_dg_vsr1"]["centroid"] < 0.9 * R["rp_dg_vsr0"]["centroid"], "VSR must lower the sample rate (and the imaging cutoff) "
          f"for a low note ({R['rp_dg_vsr1']['centroid']:.0f} vs {R['rp_dg_vsr0']['centroid']:.0f} Hz)")

    # ---- Cycles pitch: fundamental == note pitch (was an octave high: grain B read at +0.5 phase) ----
    for n, hz in (("cy_base", 220.0), ("cy_pulse_p", 220.0), ("cy_pulse_n", 220.0),
                  ("cy_part0", 220.0), ("cy_fund1", 220.0), ("cy_ph0", 220.0), ("cy_fund_oct", 440.0),
                  ("cy_xf1_root", 220.0), ("cy_oct_up", 440.0), ("cy_pulse_oct", 440.0),
                  ("cy_part_oct", 440.0), ("cy_ph_oct", 440.0)):
        check(abs(R[n]["specPeakHz"] - hz) < 0.03 * hz, f"{n}: Cycles fundamental must be {hz:.0f} Hz (got {R[n]['specPeakHz']:.1f})")

    # ---- Cycles characters ----
    base = R["cy_base"]
    for n in ("cy_pulse_p", "cy_pulse_n"):
        check(R[n]["hfFrac"] > 100.0 * base["hfFrac"] and abs(R[n]["specPeakHz"] - base["specPeakHz"]) < 4.0,
              f"{n}: Pulse width must reshape the spectrum without moving the pitch (hf {R[n]['hfFrac']:.2e} vs {base['hfFrac']:.2e})")
    check(differs("cy_pulse_p", "cy_pulse_n") and differs("cy_pulse_p", "cy_base"), "Pulse width + and - must differ from each other and from neutral")
    check(not differs("cy_part0", "cy_base", 1e-9), "Partials at Split 0 / Fund 0 must equal the plain cycle")
    rb, ro, re_ = R["cy_r_base"], R["cy_r_odd"], R["cy_r_even"]
    check(re_["h4"] > 0.5 * rb["h4"] and ro["h4"] < 0.05 * rb["h4"] and ro["h3"] > 0.5 * rb["h3"] and re_["h3"] < 0.05 * rb["h3"],
          f"Split + keeps even harmonics only, - odd only (h3 odd={ro['h3']:.3f} even={re_['h3']:.2e}; h4 odd={ro['h4']:.2e} even={re_['h4']:.3f}; base h3={rb['h3']:.3f} h4={rb['h4']:.3f})")
    check(abs(ro["specPeakHz"] - 220.0) < 4.0, f"Split - (odd only) keeps the fundamental ({ro['specPeakHz']:.1f} Hz)")
    check(abs(R["cy_fund1"]["specPeakHz"] - 220.0) < 4.0 and R["cy_fund1"]["h1"] > 20.0 * max(R["cy_fund1"]["h2"], R["cy_fund1"]["h3"]),
          f"Fund 100% must give a sine at the played pitch (h1={R['cy_fund1']['h1']:.3f}, h3={R['cy_fund1']['h3']:.4f})")
    check(not differs("cy_ph0", "cy_base", 1e-9), "Phase at Mod 0 must equal the plain cycle")
    check(R["cy_ph_mod"]["hfFrac"] > 1e3 * R["cy_ph0"]["hfFrac"], "Phase Mod must add sidebands "
          f"(hf {R['cy_ph_mod']['hfFrac']:.2e} vs {R['cy_ph0']['hfFrac']:.2e})")
    check(R["cy_ph_harm"]["centroid"] > 2.0 * R["cy_ph_mod"]["centroid"], "Phase Harm must step to a higher modulator tuning "
          f"({R['cy_ph_harm']['centroid']:.0f} vs {R['cy_ph_mod']['centroid']:.0f} Hz)")
    for c in (0, 1, 2):
        r = R[f"cy_form{c}"]
        check(r["peak"] > 0.05 and r["rms"] > 0.02, f"cy_form{c}: every Cycles character must work with Formant")
    check(differs("cy_xf0", "cy_xf1"), "Cycles Crossfade must change the output")

    # ---- Spectral ----
    n_, half, dbl, p7 = R["sp_n"], R["sp_half"], R["sp_dbl"], R["sp_p7"]
    check(abs(half["specPeakHz"] - 220.0) < 5.0, f"Spectral Speed 50% must keep the pitch ({half['specPeakHz']:.1f} Hz)")
    check(half["lateEarly"] > 1.15 * n_["lateEarly"], "Spectral Speed 50% must stretch the decay "
          f"(late/early {half['lateEarly']:.3f} vs {n_['lateEarly']:.3f})")
    check(dbl["lateEarly"] < n_["lateEarly"], "Spectral Speed 200% must shorten the decay")
    check(abs(p7["specPeakHz"] - 329.6) < 3.0 and 0.8 < p7["lateEarly"] / n_["lateEarly"] < 1.25,
          f"Spectral +7 st must shift the pitch (got {p7['specPeakHz']:.1f} Hz) and keep the speed")
    check(R["sp_f_on"]["centroid"] < 0.85 * R["sp_f_off"]["centroid"], "Formant on must keep the timbre when the pitch rises "
          f"({R['sp_f_on']['centroid']:.0f} vs {R['sp_f_off']['centroid']:.0f} Hz)")
    check(R["sp_f_rel"]["centroid"] > 1.2 * R["sp_f_on"]["centroid"], "Relative formant shifts must move the formants with the pitch")
    check(R["sp_fshift"]["centroid"] > 1.15 * R["sp_rich"]["centroid"], "Formant +12 st must raise the spectral envelope")
    check(abs(R["sp_rh_bend"]["specPeakHz"] - 220.0) < 5.0 and R["sp_rh_bend"]["h1"] > 0.8 * R["sp_rh0"]["h1"]
          and R["sp_rh_bend"]["h2"] < 0.1 * R["sp_rh0"]["h2"],
          "Reharm Bend must move the harmonics but leave the fundamental")
    check(R["sp_q_oct"]["h3"] < 0.1 * R["sp_rh0"]["h3"] and R["sp_q_oct"]["h1"] > 0.8 * R["sp_rh0"]["h1"],
          "Quantize to Octaves must move the 3rd harmonic onto an octave")
    check(R["sp_q_key"]["h5"] < 0.1 * R["sp_rh0"]["h5"] and R["sp_q_key"]["h1"] > 0.8 * R["sp_rh0"]["h1"],
          "Quantize to C major must move the out-of-key 5th harmonic (C#)")
    check(R["sp_ons_on"]["peak"] > 1.3 * R["sp_ons_off"]["peak"], "Preserve Onsets must keep the clicks sharp at slow Speed "
          f"(peak {R['sp_ons_on']['peak']:.3f} vs {R['sp_ons_off']['peak']:.3f})")
    check(R["sp_disp1"]["peak"] < 0.85 * R["sp_disp0"]["peak"], "Dispersion must smear phases at extreme stretch "
          f"(peak {R['sp_disp1']['peak']:.3f} vs {R['sp_disp0']['peak']:.3f})")
    check(0.8 < R["sp_freeze"]["lateEarly"] < 1.25, f"Spectral freeze must hold a steady level ({R['sp_freeze']['lateEarly']:.3f})")
    check(R["sp_rev"]["lateEarly"] > 3.0, f"Spectral reverse must walk back into the attack ({R['sp_rev']['lateEarly']:.2f})")
    check(R["sp_loop"]["afterRms"] > 0.05, "Spectral loop must sustain past the sample end")
    check(R["sp_poly4"]["scopeActive"] == 4 and R["sp_poly4"]["peak"] < 1.05, "4 Spectral voices must play together")
    for q in ("eng_spectral_q0", "eng_spectral_q2"):
        check(0.6 < R[q]["rms"] / R["eng_spectral"]["rms"] < 1.4, f"{q}: all Spectral qualities must give a similar level")

    # ---- Fragments ----
    sp = {k: max(R[k]["spawns"], 1e-9) for k in ("fr_d1", "fr_d2", "fr_d8", "fr_off8", "fr_r1", "fr_r4", "fr_nosync", "fr_sync", "fr_max4", "fr_max32")}
    check(1.7 < sp["fr_d2"] / sp["fr_d1"] < 2.3, f"Fragments density 2 vs 1 must double the grains ({sp['fr_d2']:.0f} vs {sp['fr_d1']:.0f})")
    check(3.3 < sp["fr_d8"] / sp["fr_d2"] < 4.5, f"Fragments density 8 vs 2 must quadruple the grains ({sp['fr_d8']:.0f} vs {sp['fr_d2']:.0f})")
    check(abs(sp["fr_off8"] - sp["fr_d1"]) <= 1, "With Use Density off the density value must be ignored")
    check(sp["fr_r1"] == sp["fr_d2"], "Repeats 1 must not add grains")
    check(3.5 < sp["fr_r4"] / sp["fr_r1"] < 4.5, f"Repeats 4 must quadruple the grains ({sp['fr_r4']:.0f} vs {sp['fr_r1']:.0f})")
    check(0.7 < sp["fr_sync"] / sp["fr_nosync"] < 0.9, f"Sync must snap the grain size to the beat grid ({sp['fr_sync']:.0f} vs {sp['fr_nosync']:.0f})")
    check(abs(R["fr_max4"]["rms"] - R["fr_max32"]["rms"]) > 0.3 * R["fr_max32"]["rms"], "Max Grains must cap the grain pool "
          f"(rms {R['fr_max4']['rms']:.4f} vs {R['fr_max32']['rms']:.4f})")
    check(R["fr_env0"]["hfFrac"] > 50.0 * R["fr_env5"]["hfFrac"], "Envelope shape 0% must click on purpose "
          f"(hf {R['fr_env0']['hfFrac']:.2e} vs {R['fr_env5']['hfFrac']:.2e})")
    check(R["fr_mot4"]["stereoDiff"] > 0.05 and R["fr_mot0"]["stereoDiff"] < 0.01, "Motion must randomise the pan")
    check(differs("fr_dir0", "fr_dir2"), "Grain direction Random must differ from Sample")
    check(differs("fr_latch1", "fr_latch0") and abs(R["fr_latch1"]["specPeakHz"] - R["fr_latch0"]["specPeakHz"]) > 5.0,
          "Latch off must let a pitch LFO bend grains in flight")
    check(differs("fr_rinit1", "fr_rinit0"), "Repeat at initial position must change where repeats read")
    check(R["fr_surv1"]["afterRms"] > 0.03 and R["fr_surv1"]["afterRms"] > 10.0 * R["fr_surv0"]["afterRms"],
          f"Grains must survive the voice end only when asked (after {R['fr_surv1']['afterRms']:.4f} vs {R['fr_surv0']['afterRms']:.4f})")
    check(R["fr_uni"]["stereoDiff"] > 0.1, "Fragments unison must spread the grains")


if __name__ == "__main__":
    main()
