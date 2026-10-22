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
  SAMPLER_CYCTIME_ONLY=1  with SAMPLER_CASE='^ct': the Cycles timing cases and their checks only (run_cyctime_checks)
  SAMPLER_NEW_ONLY=1      with SAMPLER_CASE='^(cr_|spf_|rpf_|tel_)': the Cycles crunch (cr_), Spectral Formant / Shift % (spf_),
                          Repitch Freeze (rpf_) and grain telemetry (tel_) cases and checks; or one group with SAMPLER_CRUNCH_ONLY /
                          SAMPLER_SPF_ONLY / SAMPLER_RPF_ONLY / SAMPLER_TEL_ONLY
  SAMPLER_REHARM_ONLY=1   with SAMPLER_CASE='^rh_': Spectral controls returned to neutral null against a never-moved reference
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
        mh.msg("obj-setbuf", "setbuffers #0-bsamp #0-bsvoices #0-bsscope #0-bspitch", 200, 70, 290),
        # The pitch curve (Analyzed Root Key) is bound like the device does; a "nopitchbind" case leaves it out.
        mh.msg("obj-bind", "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope"
               + ("" if case.get("nopitchbind") else ", pitch #0-bspitch"), 200, 100, 320),
        mh.box("obj-samp", f"buffer~ #0-bsamp @samps 12000 {chans}", 540, 70, 225,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-voices", "buffer~ #0-bsvoices @samps 128", 540, 100, 220,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-scope", "buffer~ #0-bsscope @samps 128", 540, 130, 210,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("obj-pitchbuf", "buffer~ #0-bspitch @samps 4096", 540, 160, 220,
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
    for gev_ms, gev_msg in case.get("gen_events", []):
        events.append((SETTLE_MS + gev_ms, "obj-gen", 0, gev_msg))
    opts = case.get("opts", "")
    for sn in case.get("snaps", []):
        events.append((SETTLE_MS + sn, "obj-js", 3, f"snap t{sn}"))
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
        mode=case.get("harness_mode", "stepped"), events=events, keep_dir=bool(case.get("keep")),
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
        "params": "mode 1, formant 7, grain_motion 0.0875, unison_voices 2, filt_on 1, filt_cutoff 12000, out_gain 0",
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
add("eng_cycles", P("mode 1, grain_motion 0.0875"), 500, opts=S48)
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
add("cy_xf0", P("mode 1, grain_motion 0.175, cy_xfade 0"), 500, opts=T48)
add("cy_xf1", P("mode 1, grain_motion 0.175, cy_xfade 1"), 500, opts=T48)

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
# The sample is 12000 frames = 250 ms at natural speed; Cycles runs at Speed 17.5 % (real time x Speed), so it lasts 1.43 s.
for _en, _e, _gp in SEQ_ENGINES:
    _dur, _cut = (2100, 1800) if _en == "cycles" else (900, 550)
    _mo = ", grain_motion 0.175" if _en == "cycles" else ""
    for _lm, _tag in ((0, "off"), (1, "fwd")):
        add(f"lp_{_en}_{_tag}", P(f"mode {_e}, {_gp}loop_mode {_lm}, loop_start 0.05, loop_end 0.95, root_note 57{_mo}"), _dur,
            cut_ms=_cut, opts=S48)
add("lp_repitch_rev_off", P("mode 0, loop_mode 0, reverse 1, root_note 57"), 900, cut_ms=550, opts=S48)
add("lp_repitch_pp", P("mode 0, loop_mode 2, loop_start 0.05, loop_end 0.95, root_note 57"), 900, cut_ms=550, opts=S48)


# ---------------------------------------------------------------------------------------------
# Analyzed Root Key (root_dyn): the root of every engine follows the sample's pitch curve (#0-bspitch)
# ---------------------------------------------------------------------------------------------
# Test sample (probe src=steps48): 220 / 330 / 246.94 Hz in thirds of the 12000 frames, curve = exact MIDI per position.
# Played on note 60 with root_note 57: with root_dyn on every part must sound at mtof(60) = 261.63 Hz; with it off the
# ratio stays constant (2^(3/12): 261.6 / 392.4 / 293.7 Hz).
import math

RD_NOTE_HZ = 440.0 * 2.0 ** ((60 - 69) / 12.0)
RD_STEP_HZ = (220.0, 330.0, 246.94)
RD_FRAMES = 12000
RD_SR = 48000.0


def rd_midi(f):
    return 69.0 + 12.0 * math.log2(f / 440.0)


def rd_curve(kind):
    """MIDI of the test sample at normalised position p (what the probe writes into the pitch buffer)."""
    if kind == "glide":
        return lambda p: 57.0 + 7.0 * p
    return lambda p: rd_midi(RD_STEP_HZ[min(2, int(p * 3.0))])


def rd_timeline(kind, dyn, reverse=False, note=60, root=57, pingpong=False, total_ms=480):
    """Output-time ms at which the playhead reaches 0, 1/3, 2/3, 1 of the sample (forward) in Repitch."""
    curve = rd_curve(kind)
    pos, t, marks = (1.0 if reverse else 0.0), 0.0, {}
    step = 1.0 / 4096
    direction = -1.0 if reverse else 1.0
    targets = [i / 3.0 for i in range(4)]
    trace = [(0.0, pos)]
    while t < total_ms and 0.0 <= pos <= 1.0:
        r = 2.0 ** ((note - (curve(min(pos, 0.99999)) if dyn else root)) / 12.0)
        dt = step * RD_FRAMES / r / RD_SR * 1000.0
        pos += direction * step
        t += dt
        trace.append((t, pos))
    return trace


def rd_time_of(trace, p):
    for t, pos in trace:
        if (trace[1][1] > trace[0][1] and pos >= p) or (trace[1][1] < trace[0][1] and pos <= p):
            return t
    return trace[-1][0]


def rd_windows(trace, margin=9.0):
    """Interior windows (ms) of the three thirds of the sample along a Repitch time line."""
    out = []
    for a, b in ((0.0, 1 / 3.0), (1 / 3.0, 2 / 3.0), (2 / 3.0, 1.0)):
        ta, tb = sorted((rd_time_of(trace, a), rd_time_of(trace, b)))
        out.append((ta + margin, tb - margin))
    return sorted(out)


def segs_opt(wins):
    return ",".join(f"{a:.1f}-{b:.1f}" for a, b in wins)


RD_ENGINES = (("cycles", 1, ""), ("textures", 2, "grain_size 40, "), ("spectral", 3, ""),
             ("fragments", 4, "grain_size 30, fr_motion 0, fr_density 1, fr_repeats 1, "))
FRZ = {"A": 1 / 6.0, "B": 0.5, "C": 5 / 6.0}
RD_SRC = "src=steps48 notes=60 "
# analysis windows for frozen / sliced cases (Spectral needs its frames to settle); cen / harm refs = the keyed note
RD_ANA = {"spectral": "segs=450-850 ana=450 cen=261.63 harm=261.63", "other": "segs=250-550 ana=250 cen=261.63 harm=261.63"}
RD_CASES = []  # (case name, expectation kind) for run_rootdyn_checks


def rd_add(name, params, dur, **kw):
    add(name, params, dur, **kw)


for _dyn in (1, 0):
    _tag = "on" if _dyn else "off"
    _tr = rd_timeline("steps", _dyn)
    rd_add(f"rd_rp_{_tag}", P(f"mode 0, root_note 57, root_dyn {_dyn}"), 400,
           opts=RD_SRC + "segs=" + segs_opt(rd_windows(_tr)))
    _trr = rd_timeline("steps", _dyn, reverse=True)
    rd_add(f"rd_rp_rev_{_tag}", P(f"mode 0, root_note 57, root_dyn {_dyn}, reverse 1"), 400,
           opts=RD_SRC + "segs=" + segs_opt(rd_windows(_trr)))
    # every engine frozen inside each third (Pos only applies while Freeze is on)
    for _en, _e, _gp in RD_ENGINES:
        for _k, _pos in FRZ.items():
            if _dyn == 0 and _k != "B":
                continue
            rd_add(f"rd_{_en}_{_tag}_{_k}",
                   P(f"mode {_e}, {_gp}root_note 57, root_dyn {_dyn}, freeze 1, play_pos {_pos:.4f}"),
                   900 if _en == "spectral" else 600,
                   opts=RD_SRC + RD_ANA["spectral" if _en == "spectral" else "other"])
    # Sliced key inside the 330 Hz third (slice 0.40..0.60), looping: plays the root key
    # (loop_xfade 0: Repitch's slice loop still crossfades 2 %, so the slice is 1632.65 frames = 11 source cycles + that 2 %;
    # Cycles scans the slice at natural speed, which shifts a periodic source's pitch, so it is frozen inside the slice)
    for _en, _e, _gp in (("repitch", 0, ""),) + RD_ENGINES:
        _fz = ", freeze 1, play_pos 0.5" if _en == "cycles" else ""
        rd_add(f"rd_sl_{_en}_{_tag}", P(f"mode {_e}, {_gp}sliced 1, slice_play 2, loop_xfade 0, root_note 60, root_dyn {_dyn}{_fz}"),
               900 if _en == "spectral" else 600,
               opts="src=steps48 notes=38 slice=0.40:0.5360542 " + RD_ANA["spectral" if _en == "spectral" else "other"])

# continuous glide (MIDI 57 -> 64 over the sample), Repitch scanning
_trg = rd_timeline("glide", 1)
rd_add("rd_rp_glide", P("mode 0, root_note 57, root_dyn 1"), 400,
       opts="src=glide48 notes=60 segs=" + segs_opt(rd_windows(_trg)))
# ping-pong loop over the whole sample: forward then backwards pass, both flattened
rd_add("rd_rp_pingpong", P("mode 0, root_note 57, root_dyn 1, loop_mode 2, loop_start 0, loop_end 1"), 520,
       opts=RD_SRC + "segs=8-62,84-168,190-243,270-320,345-425")
# Textures scanning (not frozen): the scan speed follows the curve too
_trt = rd_timeline("steps", 1)
rd_add("rd_tx_scan", P("mode 2, grain_size 12, root_note 57, root_dyn 1"), 420,
       opts=RD_SRC + "cen=261.63 segs=" + segs_opt(rd_windows(_trt, margin=12.0)))
# Fallbacks: pitch buffer not bound to the gen, or bound but never filled (zeros): static root_note
_tr_off = rd_timeline("steps", 0)
rd_add("rd_rp_unbound", P("mode 0, root_note 57, root_dyn 1"), 400, nopitchbind=True,
       opts=RD_SRC + "segs=" + segs_opt(rd_windows(_tr_off)))
rd_add("rd_rp_zero", P("mode 0, root_note 57, root_dyn 1"), 400,
       opts=RD_SRC + "pitch=zero segs=" + segs_opt(rd_windows(_tr_off)))


# ---------------------------------------------------------------------------------------------
# Cycles + Analyzed Root Key (root_dyn 1): the cycle window must be one source period at the read position
# ---------------------------------------------------------------------------------------------
# Played on note 60 (root_note 57 / 60 is only the fallback: the curve in #0-bspitch wins). Neutral characters (width 0,
# split 0, fund 0, mod 0), so the output is the source's own cycle replayed at mtof(60) = 261.63 Hz:
#   (a) the fundamental is mtof(note) in every segment, (b) a sine source gives a sine, (c) a saw / pulse keeps its
#   harmonic ratios, (d) no clicks or amplitude modulation at the pitch steps or the window joins, (e) a constant source
#   pitch equal to root_note matches root_dyn off.
# Source waves (probe wave=): sine, saw (a_n = 1/n: H2/H1 0.5, H3/H1 0.333), pulse (25 %: 0.7071, 0.3333).
CD_WAVES = {"sine": (0.0, 0.0), "saw": (0.5, 1 / 3.0), "pulse": (0.7071, 1 / 3.0)}
CD_CHARS = {0: "pulse", 1: "partials", 2: "phase"}
CD_CASES = []     # (name, kind, wave, char, xfade)
# Single mode: Speed 17.5 % moves the playhead 0.175 s of source per second, i.e. 0.7 of this 0.25 s sample per second
# (Speed is real time x motion, so this is the same slow scan the old 0.35 / Motion-2 rate gave): thirds end at 476 / 952 ms
CD_SCAN_MOTION = 0.175
CD_SCAN_SEGS = "60-416,536-892,1012-1368"
CD_SCAN_CLK = "50-1380"
# Sliced (slice 0..1, Motion 0.5 = half the natural speed): thirds end at 167 / 333 ms of 500
CD_SLICE_SEGS = "25-142,192-308,358-474"
CD_SLICE_CLK = "30-480"


def cd_add(kind, wave, char, xf, root_dyn=1, pos=None, steps="steps"):
    tag = f"cd_{kind}_{wave}_c{char}_x{xf}" + ("" if root_dyn else "_off") + ("" if pos is None else f"_{pos}")
    base = f"mode 1, cy_char {char}, cy_xfade {xf}, root_dyn {root_dyn}"
    src = f"src={steps}48 wave={wave} notes=60 harm=261.63 cen=261.63 "
    if kind == "scan":
        add(tag, P(base + f", root_note 57, grain_motion {CD_SCAN_MOTION}"), 1450, opts=src + f"segs={CD_SCAN_SEGS} clk={CD_SCAN_CLK}")
    elif kind == "glide":
        add(tag, P(base + f", root_note 57, grain_motion {CD_SCAN_MOTION}"), 1450, opts=src.replace("steps", "glide") + f"segs={CD_SCAN_SEGS} clk={CD_SCAN_CLK}")
    elif kind == "frozen":
        add(tag, P(base + f", root_note 57, freeze 1, play_pos {FRZ[pos]:.4f}"), 600, opts=src + "segs=250-550 ana=250 clk=150-590")
    elif kind == "sliced":
        add(tag, P(base + ", root_note 60, sliced 1, slice_play 0, grain_motion 0.5"), 520,
            opts=src.replace("notes=60", "notes=38") + f"slice=0.0:1.0 segs={CD_SLICE_SEGS} clk={CD_SLICE_CLK}")
    elif kind == "const":
        add(tag, P(base + f", root_note 57, grain_motion {CD_SCAN_MOTION}"), 1450, opts=src.replace("steps", "flat") + f"segs={CD_SCAN_SEGS} clk={CD_SCAN_CLK}")
    CD_CASES.append((tag, kind, wave, char, xf, pos))


# Every character x crossfade on / off on a scanning sine and saw, a pulse source, glides, frozen in each third, sliced.
# (Each case is one Max launch, so the matrix is kept to what tells the paths apart; at neutral settings the three
# characters share the cycle read, they differ in the code they pass through.)
for _w in ("sine", "saw"):
    for _c in (0, 1, 2):
        for _x in (0, 1):
            cd_add("scan", _w, _c, _x)
for _x in (0, 1):
    cd_add("scan", "pulse", 0, _x)
for _w, _c, _x in (("sine", 0, 0), ("sine", 0, 1), ("saw", 0, 0), ("saw", 0, 1), ("sine", 1, 0), ("sine", 2, 1)):
    cd_add("glide", _w, _c, _x)
for _k in ("A", "B", "C"):
    cd_add("frozen", "sine", 0, 0, pos=_k)
cd_add("frozen", "sine", 1, 0, pos="B")
cd_add("frozen", "sine", 2, 1, pos="C")
cd_add("frozen", "saw", 0, 0, pos="B")
cd_add("frozen", "saw", 0, 1, pos="A")
for _w, _c, _x in (("sine", 0, 0), ("sine", 0, 1), ("sine", 1, 0), ("sine", 2, 0), ("saw", 0, 0), ("saw", 0, 1)):
    cd_add("sliced", _w, _c, _x)
# (e) constant 220 Hz source with the curve at MIDI 57 = root_note: dyn on must equal dyn off
for _w, _c, _x in (("sine", 0, 0), ("saw", 1, 1), ("sine", 2, 0)):
    cd_add("const", _w, _c, _x, root_dyn=1)
    cd_add("const", _w, _c, _x, root_dyn=0)


# ---------------------------------------------------------------------------------------------
# Cycles timing (Bitwig model): pitch is locked to the played key, time is independent. The playhead moves by elapsed
# time x Speed (grain_motion, 1.0 = real time) whatever note is played, so the markers of src=marks48 (bursts centred
# at 0.20 / 0.45 / 0.80 s of a 1 s sample) must appear at their source times / Speed in the output, the playhead
# telemetry slope must be Speed, and Off / Fwd loop / Sliced end or wrap on the same clock. root_dyn on and off (the
# sample's curve is flat MIDI 57 = root_note, so both give the same expectation).
# ---------------------------------------------------------------------------------------------
CT_BURSTS = (0.20, 0.45, 0.80)
CT_CASES = []   # (name, expectation dict)


def ct_timeline(speed, rev=False, lo=0.0, hi=1.0, loop=None, start=None, total=1.25, dt=0.0001, pingpong=False):
    """Simulate the playhead (source seconds, 1 s sample): burst-centre crossing times (ms), the time the head stops
    (ms, or None when it loops) and the time of the first wrap / stop (ms)."""
    pos = (hi if rev else lo) if start is None else start
    direction = -1.0 if rev else 1.0
    t, hits, stop, first_wrap = 0.0, [], None, None
    while t < total:
        new = pos + direction * speed * dt
        wrapped = False
        if loop and ((direction > 0 and new >= loop[1]) or (direction < 0 and new <= loop[0])):
            if first_wrap is None:
                first_wrap = t * 1000.0
            if pingpong:
                new = loop[1] - (new - loop[1]) if direction > 0 else loop[0] + (loop[0] - new)
                direction = -direction
            else:
                new = loop[0] + (new - loop[1]) if direction > 0 else loop[1] - (loop[0] - new)
                wrapped = True
        elif new >= hi or new <= lo:
            stop = t * 1000.0
            first_wrap = first_wrap if first_wrap is not None else stop
            break
        for c in CT_BURSTS:
            if not wrapped and (pos - c) * (new - c) < 0:
                hits.append(t * 1000.0)
        pos = new
        t += dt
    return hits, stop, first_wrap


def ct_gap_window(hits, stop, lo_ms=30.0, guard=50.0, total=1100.0):
    """The longest stretch between the bursts (and the start / stop), for the pitch measurement."""
    edges = [lo_ms] + [x for h in hits for x in (h - guard, h + guard)] + [(stop - 30.0) if stop else total]
    best = max(((edges[i], edges[i + 1]) for i in range(0, len(edges), 2)), key=lambda w: w[1] - w[0])
    return best



CT_ENG_NAME = {0: "rp", 1: "cy", 2: "tx", 3: "sp", 4: "fr"}


def ct_add(tag, note, dyn, speed, rev=0, loop=None, slc=None, xf=0, dur=None, pingpong=False, eng=1, fsr=False, bursts="abs", ref=None):
    """loop = (a, b) normalised Fwd loop region; slc = (a, b, slice_play) for Sliced (key 38 plays the slice).
    eng = engine (mode index); fsr = the 1 s sample is a 44.1 kHz file (src=marks44, samp_rate 44100), so the
    timeline is the same as for the 48 kHz file; bursts = "abs" (burst times from the timeline), "ref" (against the
    48 kHz case `ref`, for engines with latency) or None."""
    name = f"ct{CT_ENG_NAME[eng] if eng != 1 else ''}{'r' if fsr else ''}_{tag}_n{note}_{'dyn' if dyn else 'off'}" + (f"_x{xf}" if xf else "")
    extra = ""
    if loop:
        extra += f", loop_mode {2 if pingpong else 1}, loop_start {loop[0]}, loop_end {loop[1]}, loop_xfade 0"
    if slc:
        extra += f", sliced 1, slice_play {slc[2]}"
    params = P(f"mode {eng}, cy_char 0, cy_xfade {xf}, root_dyn {dyn}, root_note 57, grain_motion {speed}, reverse {rev}{extra}"
               + (f", samp_rate 44100" if fsr else ""))
    if slc:
        a, b, play = slc
        lo, hi = a, (b if play in (0, 2, 3) else 1.0)
        tl = ct_timeline(speed, bool(rev), lo, hi, loop=(a, b) if play >= 2 else None)
    else:
        tl = ct_timeline(speed, bool(rev), 0.0, 1.0, loop=loop, pingpong=pingpong)
    hits, stop, wrap = tl
    horizon = (stop + 250.0) if stop else 1250.0
    if speed == 0:
        hits, stop, wrap, horizon = [], None, 600.0, 600.0
    last = (stop or horizon) - 60.0
    snaps = [ms for ms in range(60, int(((wrap if wrap else horizon) - 50.0)), 60)][:12]
    gw = ct_gap_window(hits, stop, total=horizon - 100.0)
    opts = f"src={'marks44' if fsr else 'marks48'} notes={38 if slc else note} mk=1 harm=220 segs={gw[0]:.0f}-{gw[1]:.0f} "
    if slc:
        opts += f"slice={slc[0]}:{slc[1]} "
    dur = int(horizon)
    case = {"name": name, "dur": dur, "params": params, "opts": opts, "snaps": snaps}
    if stop:
        case["cut_ms"] = int(stop + 70)
    CASES.append(case)
    hz = 220.0 if slc else 220.0 * 2.0 ** ((note - 57) / 12.0)
    CT_CASES.append((name, dict(hits=hits, stop=stop, speed=speed, rev=rev, hz=hz, snaps=snaps, wrap=wrap,
                                tag=tag, note=note, frames=44100 if fsr else 48000, bursts=bursts, ref=ref)))
    return name


for _dyn in (1, 0):
    for _n in (57, 64, 69, 45):
        ct_add("fwd100", _n, _dyn, 1.0)
    for _n in (57, 69):
        ct_add("fwd50", _n, _dyn, 0.5)
        ct_add("hold0", _n, _dyn, 0.0)
        ct_add("rev100", _n, _dyn, 1.0, rev=1)
        ct_add("loop100", _n, _dyn, 1.0, loop=(0.3, 0.6))
        ct_add("pingpong100", _n, _dyn, 1.0, loop=(0.3, 0.6), pingpong=True)
    ct_add("fwd200", 64, _dyn, 2.0)
    ct_add("slice100", 57, _dyn, 1.0, slc=(0.1, 0.6, 0))
    ct_add("sliceloop100", 57, _dyn, 1.0, slc=(0.3, 0.6, 2))
for _n in (69, 45):
    ct_add("fwd100", _n, 1, 1.0, xf=1)
ct_add("fwd50", 69, 1, 0.5, xf=1)

# Files whose sample rate differs from Live's (a 44.1 kHz file in the 48 kHz harness, samp_rate 44100): the playhead
# must run in file time, so bursts, playhead slope, end and pitch are those of the 48 kHz file, in every engine.
for _dyn in (1, 0):
    for _n in (57, 69):
        ct_add("fwd100", _n, _dyn, 1.0, fsr=True)
ct_add("fwd50", 57, 1, 0.5, fsr=True)
ct_add("loop100", 57, 1, 1.0, loop=(0.3, 0.6), fsr=True)
ct_add("slice100", 57, 1, 1.0, slc=(0.1, 0.6, 0), fsr=True)
ct_add("sliceloop100", 57, 1, 1.0, slc=(0.3, 0.6, 2), fsr=True)
ct_add("fwd100", 69, 1, 1.0, xf=1, fsr=True)
for _eng in (0, 2, 3, 4):
    _abs = "abs" if _eng in (0, 2) else "ref"
    _b0 = "abs" if _eng == 2 else None   # Textures' grains follow the playhead (grains latch it with half a grain of lead): absolute burst times
    # (Repitch, Textures and Fragments move at Speed x pitch ratio, so only the root note is compared.)
    for _n in (57,):
        _r = ct_add("fwd100", _n, 0, 1.0, eng=_eng, bursts=_b0) if _eng else None
        ct_add("fwd100", _n, 0, 1.0, eng=_eng, fsr=True, bursts=_abs, ref=_r)
    _r = ct_add("loop100", 57, 0, 1.0, loop=(0.3, 0.6), eng=_eng, bursts=_b0) if _eng else None
    ct_add("loop100", 57, 0, 1.0, loop=(0.3, 0.6), eng=_eng, fsr=True, bursts=_abs, ref=_r)
    _r = ct_add("slice100", 57, 0, 1.0, slc=(0.1, 0.6, 0), eng=_eng, bursts=_b0) if _eng else None
    ct_add("slice100", 57, 0, 1.0, slc=(0.1, 0.6, 0), eng=_eng, fsr=True, bursts=_abs, ref=_r)
ct_add("rev100", 57, 0, 1.0, rev=1, eng=0, fsr=True)
ct_add("pingpong100", 57, 0, 1.0, loop=(0.3, 0.6), pingpong=True, eng=0, fsr=True)

# ---------------------------------------------------------------------------------------------
# Cycles on real-world material at Speed 100 % (the real-time scan): no crunch at the cycle joins
# ---------------------------------------------------------------------------------------------
# Long (8 s) sample whose sound sits at 4.8 s .. 7.2 s; the scan starts at Start 0.6 (4.8 s) and runs at Speed 100 %, root_dyn
# off, the source 35 ct above the root the device is told about (220 Hz). Sources (probe src=real48): pad (5 detuned saws + a
# noise bed), vowel (formants, jitter, voiced / unvoiced segments) and a sine with vibrato, all band-limited to about 4.2 kHz,
# so power above 5 kHz can only be an artefact of the engine. The metrics (probe crunch=) compare the output with the
# source stretch the scan reads: HF power above 5 kHz (dB), spectral flatness of that residual, the 99.9th percentile of the
# sample-to-sample step over its rms, and the second-difference energy per phase bin of the output period (joins).
CR_CASES = []   # (name, kind)


def cr_add(kind, char=0, xf=0, off=0.35, note=57, extra="", tag=""):
    name = f"cr_{kind}_c{char}_x{xf}{tag}"
    hz = 220.0 * 2.0 ** ((note - 57) / 12.0)
    params = P(f"mode 1, cy_char {char}, cy_xfade {xf}, root_dyn 0, root_note 57, grain_motion 1.0, samp_start 0.6, samp_end 1.0" + extra)
    add(name, params, 1500, opts=f"src=real48 kind={kind} len=8 gstart=4.8 glen=2.4 off={off} notes={note} crunch=120-1400 cf0={hz:.4f} hfc={5000.0 * 2.0 ** ((note - 57) / 12.0):.0f} hfcr=5000 clk=120-1400 harm={hz:.4f} cen={hz:.4f} segs=120-1400 ")
    CR_CASES.append((name, kind))


for _k in ("pad", "vowel", "vib"):
    cr_add(_k)
for _k in ("pad", "vowel"):
    cr_add(_k, xf=1)
cr_add("pad", char=1)
cr_add("pad", char=2)
cr_add("pad", note=64, tag="_n64")
cr_add("pad", off=0.0, tag="_on")

# ---------------------------------------------------------------------------------------------
# Spectral Pure: Formant (formant) and Shift % (sp_shift) move the spectral envelope, not the pitch
# ---------------------------------------------------------------------------------------------
# Steady vowel (probe kind=vowelst: harmonics shaped by formants at 700 / 1220 / 2600 Hz), played at its own pitch so the pitch
# ratio is 1 (the fundamental must stay put) with the phase vocoder frozen mid-sample. The harmonics' power-weighted centroid
# (segHCen) and the frequency of the strongest harmonic (segHPk) follow the formants: Formant +12 st must double them,
# -12 st halve them, Shift % scales the shift (50 % -> +6 st), Formant processing off must ignore Formant.
SPF_CASES = []


def spf_add(tag, extra, f0=220.0, note=57, dur=900):
    off = 12.0 * math.log2(f0 / 220.0)
    name = f"spf_{tag}"
    add(name, P(f"mode 3, freeze 1, play_pos 0.5, root_note {note}, " + extra), dur,
        opts=f"src=real48 kind=vowelst len=2 gstart=0 glen=2 off={off:.5f} notes={note} segs=400-880 harm={f0:.4f} hs={f0:.4f} ana=400 ")
    SPF_CASES.append(name)


spf_add("base", "formant 0")
spf_add("up", "formant 12")
spf_add("dn", "formant -12")
spf_add("half", "formant 12, sp_shift 0.5")
spf_add("zero", "formant 12, sp_shift 0.01")
spf_add("full122", "formant 12, sp_shift 1.22")
spf_add("off", "formant 12, sp_formant_on 0")
spf_add("hi_base", "formant 0", f0=329.63, note=64)
spf_add("hi_up", "formant 12", f0=329.63, note=64)
# the pitch moves a fifth up (ratio 1.5) with the formants staying where they are, and with Formant +12 they move up
spf_add("p7", "formant 0", f0=329.63, note=64)
SPF_CASES.pop()
add("spf_p7", P("mode 3, freeze 1, play_pos 0.5, root_note 57, formant 0"), 900,
    opts="src=real48 kind=vowelst len=2 gstart=0 glen=2 off=0 notes=64 segs=400-880 harm=329.63 hs=329.63 ana=400 ")
add("spf_p7_up", P("mode 3, freeze 1, play_pos 0.5, root_note 57, formant 12"), 900,
    opts="src=real48 kind=vowelst len=2 gstart=0 glen=2 off=0 notes=64 segs=400-880 harm=329.63 hs=329.63 ana=400 ")
SPF_CASES += ["spf_p7", "spf_p7_up"]

# ---------------------------------------------------------------------------------------------
# Spectral state returns to neutral: moving a Spectral control away from neutral and back must sound like never moving it
# ---------------------------------------------------------------------------------------------
# The phase vocoder keeps one synthesis phase per bin and advances it by the (bent) frequency every frame. Reharm Bend, Quantize,
# Pitch, ... shift the bins' phases by different amounts, and nothing ever took that offset out again, so the harmonics came
# back with permanently scrambled relative phases (a different waveform, phasiness, a softened attack) even at Bend 0.
# Every case renders a reference (the neutral setting throughout, plus the same unrelated events) and a test (the control moved
# at 120 ms and back at 400 ms), both of the same note on a steady source, and compares the output 520..880 ms after the
# return: the residual of the null test (dB below the reference), the harmonic magnitudes (dB) and the harmonic phase
# alignment (phase of harmonic k minus k times the fundamental's, rms over the strong harmonics, radians).
RH_CASES = []     # (reference name, test name, source, f0, magnitude tolerance dB)
RH_RAW = "520-880"
RH_SRC = {"saw": "kind=saw", "vow": "kind=vowelst", "pad": "kind=pad"}


def rh_add(tag, src, params, test_ev, ref_ev=(), extra="", ref_params=None, mag_tol=0.5):
    opts = f"src=real48 {RH_SRC[src]} len=2 gstart=0 glen=2 off=0 notes=57 raw={RH_RAW} ana=300 harm=220 "
    rn, tn = f"rh_{tag}_ref", f"rh_{tag}_test"
    add(rn, P("mode 3, root_note 57, " + (params if ref_params is None else ref_params)), 900, gen_events=list(ref_ev), opts=opts, keep=True)
    add(tn, P("mode 3, root_note 57, " + params + extra), 900, gen_events=list(test_ev), opts=opts, keep=True)
    RH_CASES.append((rn, tn, src, 220.0, mag_tol))


_RH_BACK = 400
for _src, _tol in (("saw", 0.5), ("vow", 0.5), ("pad", 1.0)):
    rh_add(f"bend7_{_src}", _src, "sp_char 1, sp_bend 0", [(120, "sp_bend 7"), (_RH_BACK, "sp_bend 0")], mag_tol=_tol)
rh_add("bendm12_saw", "saw", "sp_char 1, sp_bend 0", [(120, "sp_bend -12"), (_RH_BACK, "sp_bend 0")])
rh_add("bendm12_pad", "pad", "sp_char 1, sp_bend 0", [(120, "sp_bend -12"), (_RH_BACK, "sp_bend 0")], mag_tol=1.0)
# a started value in the preset (Bend +7 from the first frame) that is then reset
rh_add("bend7pre_saw", "saw", "sp_char 1, sp_bend 7", [(_RH_BACK, "sp_bend 0")], ref_params="sp_char 1, sp_bend 0")
# frozen playhead: no analysis phase advance to lock to, the phases advance at the bin centres
rh_add("bend7_saw_frz", "saw", "sp_char 1, sp_bend 0, freeze 1, play_pos 0.5", [(120, "sp_bend 7"), (_RH_BACK, "sp_bend 0")])
rh_add("bend7_pad_frz", "pad", "sp_char 1, sp_bend 0, freeze 1, play_pos 0.5", [(120, "sp_bend 7"), (_RH_BACK, "sp_bend 0")], mag_tol=1.0)
# Quantize Octaves / Key -> Off
rh_add("quantoct_saw", "saw", "sp_char 1, sp_quant 0", [(120, "sp_quant 1"), (_RH_BACK, "sp_quant 0")])
rh_add("quantkey_vow", "vow", "sp_char 1, sp_quant 0, sp_key 2", [(120, "sp_quant 2"), (_RH_BACK, "sp_quant 0")])
rh_add("quantbend_pad", "pad", "sp_char 1, sp_quant 0, sp_bend 0", [(120, "sp_bend 5, sp_quant 1"), (_RH_BACK, "sp_bend 0, sp_quant 0")], mag_tol=1.0)
# Pure: Formant / Shift back to neutral (they only reshape magnitudes, so this guards against regressions)
rh_add("formant_vow", "vow", "sp_char 0, formant 0", [(120, "formant 12"), (_RH_BACK, "formant 0")])
rh_add("shift_vow", "vow", "sp_char 0, formant 12, sp_shift 0.01", [(120, "sp_shift 1"), (_RH_BACK, "sp_shift 0.01")])
# Reharm -> Pure -> Reharm (Bend moved while in Reharm, returned while in Pure, so the switch back is neutral)
rh_add("char_saw", "saw", "sp_char 1, sp_bend 0", [(120, "sp_bend 7"), (200, "sp_char 0"), (300, "sp_bend 0"), (_RH_BACK, "sp_char 1")])
rh_add("char_pad", "pad", "sp_char 1, sp_bend 0", [(120, "sp_bend 7"), (200, "sp_char 0"), (300, "sp_bend 0"), (_RH_BACK, "sp_char 1")], mag_tol=1.0)
# Quality changes restart the vocoder (the playhead too), so the reference makes the same quality changes
rh_add("quality_saw", "saw", "sp_char 1, sp_bend 7", [(200, "sp_quality 2"), (300, "sp_quality 1"), (_RH_BACK, "sp_bend 0")],
       ref_ev=[(200, "sp_quality 2"), (300, "sp_quality 1")], ref_params="sp_char 1, sp_bend 0")
rh_add("quality_pad", "pad", "sp_char 1, sp_bend 7", [(200, "sp_quality 0"), (300, "sp_quality 1"), (_RH_BACK, "sp_bend 0")],
       ref_ev=[(200, "sp_quality 0"), (300, "sp_quality 1")], ref_params="sp_char 1, sp_bend 0", mag_tol=1.0)
# Pitch +7 st and back (the same phase state)
rh_add("pitch7_saw", "saw", "sp_char 1, pitch_st 0", [(120, "pitch_st 7"), (_RH_BACK, "pitch_st 0")])

# ---------------------------------------------------------------------------------------------
# Repitch Freeze: the read head glides to Pos like tape and loops seamlessly where it rests
# ---------------------------------------------------------------------------------------------
# Source: the steady 220 Hz tone (sus48), played at its root. Frozen, the head holds a short loop (a whole number of root cycles
# of about 75 ms, crossfaded), so a static Pos is a stable periodic 220 Hz tone. Pos moves in 8 ms steps (events through
# the stepped harness): the head follows with a short slew, so its speed adds to the playback speed (a tape-like Doppler bend:
# a head moving at v frames per sample plays at 1 + v times the pitch) with no jumps and no noise.
RPF_CASES = []
RPF = "mode 0, freeze 1, loop_mode 0, root_note 57"


def rpf_add(name, p0, dp, n=26, t0=60, step=8, extra="", dur=500, segs="175-265", f_hz=220.0, clk="100-265", gen_events=None):
    ev = [(t0 + step * k, f"play_pos {p0 + dp * (k + 1):.5f}") for k in range(n)] if gen_events is None else gen_events
    add(name, P(RPF + f", play_pos {p0}" + extra), dur, gen_events=ev,
        opts=f"src=sus48 notes=57 segs={segs} harm={f_hz:.3f} cen={f_hz:.3f} clk={clk} ana=150 ")
    RPF_CASES.append(name)


add("rpf_static", P(RPF + ", play_pos 0.5"), 700, opts="src=sus48 notes=57 segs=150-650 harm=220 cen=220 clk=150-650 ana=150 ")
RPF_CASES.append("rpf_static")
add("rpf_static_lo", P(RPF + ", play_pos 0.08"), 700, opts="src=sus48 notes=57 segs=150-650 harm=220 cen=220 clk=150-650 ana=150 ")
RPF_CASES.append("rpf_static_lo")
add("rpf_static_hi", P(RPF + ", play_pos 0.97"), 700, opts="src=sus48 notes=57 segs=150-650 harm=220 cen=220 clk=150-650 ana=150 ")
RPF_CASES.append("rpf_static_hi")
add("rpf_static_up", P(RPF + ", play_pos 0.5"), 700, opts="src=sus48 notes=69 segs=150-650 harm=440 cen=440 clk=150-650 ana=150 ")
RPF_CASES.append("rpf_static_up")
add("rpf_static_rev", P(RPF + ", play_pos 0.5, reverse 1"), 700, opts="src=sus48 notes=57 segs=150-650 harm=220 cen=220 clk=150-650 ana=150 ")
RPF_CASES.append("rpf_static_rev")
add("rpf_static_uni", P(RPF + ", play_pos 0.5, unison_voices 4, unison_detune 0.05, unison_width 0.5"), 700,
    opts="src=sus48 notes=57 segs=150-650 harm=220 cen=220 clk=150-650 ana=150 ")
RPF_CASES.append("rpf_static_uni")
# head speed v frames per sample: Pos steps of v * 384 frames / 12000 every 8 ms (26 steps; the harness supports about 30 events)
rpf_add("rpf_fwd10", 0.30, 0.0032, f_hz=242.0)      # v = +0.10 -> 242 Hz
rpf_add("rpf_fwd25", 0.20, 0.008, f_hz=275.0)       # v = +0.25 -> 275 Hz
rpf_add("rpf_back10", 0.70, -0.0032, f_hz=198.0)    # v = -0.10 -> 198 Hz
add("rpf_step", P(RPF + ", play_pos 0.2"), 800, gen_events=[(150, "play_pos 0.7")],
    opts="src=sus48 notes=57 segs=162-200,450-750 harm=220 cen=220 clk=100-780 ana=150 ")
RPF_CASES.append("rpf_step")

# ---------------------------------------------------------------------------------------------
# Grain telemetry for the face's grain lines: #0-bsscope 64..95 = read position (0..1, -1 unused), 96..127 = level
# ---------------------------------------------------------------------------------------------
TEL_CASES = []
TEL_SNAPS = list(range(100, 560, 20))


def tel_add(name, params, dur=600, opts=S48, **kw):
    add(name, params, dur, snaps=TEL_SNAPS, opts=opts + "gt=1 ", **kw)
    TEL_CASES.append(name)


tel_add("tel_idle", P("mode 2, freeze 1, play_pos 0.5, grain_size 55, grain_spray 0.35"), 300, no_trigger=True)
tel_add("tel_cy", P("mode 1, grain_motion 1.0"), 500)
tel_add("tel_rp", P("mode 0, loop_mode 1, loop_start 0.05, loop_end 0.95"), 500)
tel_add("tel_tx", P("mode 2, freeze 1, play_pos 0.5, grain_size 55, grain_spray 0.35"), 600)
tel_add("tel_tx_scan", P("mode 2, grain_size 40, grain_spray 0.2, grain_motion 1.0"), 600)
tel_add("tel_tx_poly", P("mode 2, freeze 1, play_pos 0.5, grain_size 55, grain_spray 0.35, unison_voices 4, unison_detune 0.3"), 600,
        opts="src=sus48 notes=57,60,64,67 ")
tel_add("tel_tx_rel", P("mode 2, freeze 1, play_pos 0.5, grain_size 40, grain_spray 0.2, rel_ms 10"), 600, release_ms=150)
# priority to louder grains: 4 voices x 8 unison x 2 windows = 64 grains compete for 32 slots; the last voice is the loud one
# (vel_sens 1, velocities 0.15 / 0.15 / 0.15 / 1.0), the others stay below level 0.25
tel_add("tel_tx_prio", P("mode 2, freeze 1, play_pos 0.5, grain_size 55, grain_spray 0.2, unison_voices 8, unison_detune 0.3, vel_sens 1"), 500,
        opts="src=sus48 notes=57,60,64,67 vels=0.15,0.15,0.15,1.0 ")
tel_add("tel_fr", P("mode 4, freeze 1, play_pos 0.5, grain_size 40, fr_density 8, fr_repeats 1, fr_motion 0, fr_env 0.5, fr_use_density 1"), 600)
tel_add("tel_fr_many", P("mode 4, freeze 1, play_pos 0.5, grain_size 200, fr_density 40, fr_repeats 1, fr_max_grains 256, fr_use_density 1"), 700,
        opts="src=sus48 notes=57,60,64,67 ")


# Global LFO (scope slot 35 = lfoSig, slot 39 = frame counter), sampled by snap events every 9 ms. S&H must hold
# its value between steps and step to a new random value once per LFO period (20 Hz = every 50 ms); the saw is the control.
LFO_SNAPS = list(range(9, 253, 9))  # the harness caps events at about 30 (one gen outlet each)
LFO_CASES = ["lfo_sh", "lfo_saw"]
for _n, _shape in (("lfo_sh", 3), ("lfo_saw", 2)):
    add(_n, P(f"mode 0, loop_mode 1, loop_start 0.05, loop_end 0.95, lfo_shape {_shape}, lfo_rate 20, lfo_pitch 0.2"), 400,
        snaps=LFO_SNAPS, opts=S48)


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
        if r.get("harness_dir"):
            import shutil
            try:
                r["raw"] = rh_read_raw(os.path.join(r["harness_dir"], "result.txt.raw.txt"))
            finally:
                shutil.rmtree(r["harness_dir"], ignore_errors=True)
            r["harness_dir"] = ""
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

    if only and os.environ.get("SAMPLER_ROOTDYN_ONLY"):
        # SAMPLER_CASE='^rd_' SAMPLER_ROOTDYN_ONLY=1: just the Analyzed Root Key cases and their checks
        run_rootdyn_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Analyzed Root Key checks passed.")
        return
    if only and os.environ.get("SAMPLER_CYCDYN_ONLY"):
        # SAMPLER_CASE='^cd_' SAMPLER_CYCDYN_ONLY=1: just the Cycles + Analyzed Root Key cases and their checks
        run_cycdyn_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Cycles + Analyzed Root Key checks passed.")
        return
    if only and os.environ.get("SAMPLER_CRUNCH_ONLY"):
        # SAMPLER_CASE='^cr_' SAMPLER_CRUNCH_ONLY=1: just the Cycles real-material crunch cases and their checks
        run_crunch_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Cycles crunch checks passed.")
        return
    if only and os.environ.get("SAMPLER_NEW_ONLY"):
        # SAMPLER_CASE='^(cr_|spf_|rpf_|tel_)' SAMPLER_NEW_ONLY=1: the Cycles crunch, Spectral formant, Repitch Freeze and grain
        # telemetry cases and their checks (the user-reported problems)
        for fn in (run_crunch_checks, run_spf_checks, run_rpf_checks, run_tel_checks):
            fn(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Cycles crunch, Spectral formant, Repitch Freeze and grain telemetry checks passed.")
        return
    if only and os.environ.get("SAMPLER_RPF_ONLY"):
        # SAMPLER_CASE='^rpf_' SAMPLER_RPF_ONLY=1: just the Repitch Freeze cases and their checks
        run_rpf_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Repitch Freeze checks passed.")
        return
    if only and os.environ.get("SAMPLER_LFO_ONLY"):
        # SAMPLER_CASE='^lfo_' SAMPLER_LFO_ONLY=1: just the global LFO (S&H) cases and checks
        run_lfo_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("LFO checks passed.")
        return
    if only and os.environ.get("SAMPLER_TEL_ONLY"):
        # SAMPLER_CASE='^tel_' SAMPLER_TEL_ONLY=1: just the grain telemetry cases and their checks
        run_tel_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Grain telemetry checks passed.")
        return
    if only and os.environ.get("SAMPLER_REHARM_ONLY"):
        # SAMPLER_CASE='^rh_' SAMPLER_REHARM_ONLY=1: just the Spectral return-to-neutral null tests
        run_reharm_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Spectral return-to-neutral checks passed.")
        return
    if only and os.environ.get("SAMPLER_SPF_ONLY"):
        # SAMPLER_CASE='^spf_' SAMPLER_SPF_ONLY=1: just the Spectral Formant / Shift % cases and their checks
        run_spf_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Spectral formant checks passed.")
        return
    if only and os.environ.get("SAMPLER_CYCTIME_ONLY"):
        # SAMPLER_CASE='^ct' SAMPLER_CYCTIME_ONLY=1: just the Cycles timing cases and their checks
        run_cyctime_checks(results)
        if FAILS:
            print(f"{len(FAILS)} sampler audio assertion(s) FAILED")
            raise SystemExit(1)
        print("Cycles timing checks passed.")
        return
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
    run_rootdyn_checks(results)
    run_cycdyn_checks(results)
    run_crunch_checks(results)
    run_spf_checks(results)
    run_reharm_checks(results)
    run_rpf_checks(results)
    run_tel_checks(results)
    run_lfo_checks(results)


def run_rootdyn_checks(R):
    """Analyzed Root Key: with root_dyn on every engine keeps each part of the pitch-moving sample at the keyed note."""
    def cents(f, ref):
        return 1200.0 * math.log2(max(f, 1e-9) / ref)

    def seg(name, k):
        r = R[name]
        return r[f"segHz{k}"], r[f"segRms{k}"]

    def at_note(name, k, tol_ct, ref=RD_NOTE_HZ):
        if name not in R:  # partial run (SAMPLER_CASE)
            return
        hz, rms = seg(name, k)
        check(rms > 0.01, f"{name}: window {k} must sound (rms={rms:.4f})")
        check(abs(cents(hz, ref)) <= tol_ct,
              f"{name}: window {k} must sit at {ref:.1f} Hz within {tol_ct} ct (got {hz:.2f} Hz = {cents(hz, ref):+.1f} ct)")

    for name in sorted(n for n in R if n.startswith("rd_")):
        hzs = [R[name][f"segHz{k}"] for k in range(5) if f"segHz{k}" in R[name]]
        cens = [R[name][f"segCen{k}"] for k in range(5) if f"segCen{k}" in R[name]]
        harms = [R[name][f"segHarm{k}"] for k in range(5) if f"segHarm{k}" in R[name]]
        print(f"  {name:20s} segHz " + " ".join(f"{h:8.2f}" for h in hzs)
              + ("   cen " + " ".join(f"{h:7.2f}" for h in cens) if cens else "")
              + ("   harm " + " ".join(f"{h:5.3f}" for h in harms) if harms else "")
              + ("   h2/h1 " + " ".join(f"{R[name][f'segH2_{k}']:5.3f}" for k in range(5) if f'segH2_{k}' in R[name]) if harms else "")
              + f"   (keyed {RD_NOTE_HZ:.2f})")
    # Repitch (scanning): forward, reverse, glide, ping-pong
    for n in ("rd_rp_on", "rd_rp_rev_on", "rd_rp_glide"):
        for k in range(3):
            at_note(n, k, 6)
    for k in range(5):
        at_note("rd_rp_pingpong", k, 6)
    # off: the ratio stays constant (sample frequency x 2^(3/12)), forward and reverse
    off_hz = [f * 2.0 ** (3 / 12.0) for f in RD_STEP_HZ]
    for n, order in (("rd_rp_off", (0, 1, 2)), ("rd_rp_rev_off", (2, 1, 0)), ("rd_rp_unbound", (0, 1, 2)), ("rd_rp_zero", (0, 1, 2))):
        for k, srcseg in enumerate(order):
            at_note(n, k, 6, off_hz[srcseg])
    check("rd_rp_unbound" not in R or R["rd_rp_unbound"]["gpRootDyn"] == 0, "rd_rp_unbound: Analyzed Root Key must stay inactive without a bound pitch buffer")
    check("rd_rp_on" not in R or R["rd_rp_on"]["gpRootDyn"] == 1, "rd_rp_on: Analyzed Root Key must report active with root_dyn 1 and a bound buffer")
    check("rd_rp_off" not in R or R["rd_rp_off"]["gpRootDyn"] == 0, "rd_rp_off: Analyzed Root Key must report inactive with root_dyn 0")
    # the three windows differ by more than 100 ct with the curve off: the assertions above would fail on the old gen
    def have(*names):
        return all(n in R for n in names)

    def cen_within(name, k, ref, rel):
        c = R[name][f"segCen{k}"]
        check(R[name][f"segRms{k}"] > 0.01, f"{name}: window {k} must sound")
        check(abs(c / ref - 1.0) <= rel,
              f"{name}: carrier (centroid) must sit at {ref:.1f} Hz within {rel * 100:.0f} % (got {c:.2f} Hz, {cents(c, ref):+.0f} ct)")

    # Frozen in each third of the sample: the carrier sits at the keyed note in every engine. Cycles' output pitch is the
    # note by design, so there the root shows in the waveform: with the right cycle length the 2nd harmonic keeps the
    # source's ratio (0.4545 for the test sample); a 220 Hz root on a 330 Hz part reads 1.5 source periods per cycle.
    tol = {"textures": 0.05, "spectral": 0.03, "fragments": 0.03}
    for en, rel in tol.items():
        for k in "ABC":
            if have(f"rd_{en}_on_{k}"):
                cen_within(f"rd_{en}_on_{k}", 0, RD_NOTE_HZ, rel)
        if have(f"rd_{en}_off_B"):
            # off: the ratio stays constant, 330 Hz x 2^(3/12) = 392.4 Hz (Spectral / Textures: carrier clipped by the 1.45 x band)
            hz = R[f"rd_{en}_off_B"]["segHz0"]
            cen = R[f"rd_{en}_off_B"]["segCen0"]
            check(cen > RD_NOTE_HZ * 1.3, f"rd_{en}_off_B: without root_dyn the 330 Hz part must not sit at the keyed note (carrier {cen:.1f} Hz)")
            if en != "spectral":
                check(abs(hz / off_hz[1] - 1.0) <= 0.10, f"rd_{en}_off_B: dominant must stay near {off_hz[1]:.1f} Hz (got {hz:.1f})")
    for k in "ABC":
        if have(f"rd_cycles_on_{k}"):
            h2 = R[f"rd_cycles_on_{k}"]["segH2_0"]
            check(abs(h2 - 0.4545) <= 0.04, f"rd_cycles_on_{k}: cycle length must follow the curve (h2/h1={h2:.3f}, source 0.4545)")
    if have("rd_cycles_off_B"):
        check(R["rd_cycles_off_B"]["segH2_0"] > 0.6, f"rd_cycles_off_B: a 220 Hz root on a 330 Hz part must distort the cycle (h2/h1={R['rd_cycles_off_B']['segH2_0']:.3f})")
    # Sliced key inside the 330 Hz third: the keyed (root) pitch with root_dyn, the natural 330 Hz without
    if have("rd_sl_repitch_on", "rd_sl_repitch_off"):
        at_note("rd_sl_repitch_on", 0, 6)
        at_note("rd_sl_repitch_off", 0, 6, 330.0)
    for en in ("textures", "spectral", "fragments"):
        if have(f"rd_sl_{en}_on", f"rd_sl_{en}_off"):
            on, off = R[f"rd_sl_{en}_on"]["segCen0"], R[f"rd_sl_{en}_off"]["segCen0"]
            want = RD_NOTE_HZ / 330.0
            check(off > 270 and abs(on / off / want - 1.0) <= 0.03,
                  f"rd_sl_{en}: root_dyn must lower the 330 Hz slice to the keyed note (on {on:.1f} Hz, off {off:.1f} Hz, ratio {on / max(off, 1e-9):.3f}, want {want:.3f})")
    if have("rd_sl_cycles_on", "rd_sl_cycles_off"):
        # on: the cycle length follows the curve. off used to distort the cycle (h2/h1 > 0.6: a 261.63 Hz root on the 330 Hz
        # slice); Cycles now measures the source's period when the root is within about 20 % of it (cyc_period) and this
        # slice is just inside, so off plays the source's own shape too. Both must be the source's waveform.
        check(abs(R["rd_sl_cycles_on"]["segH2_0"] - 0.4545) <= 0.04 and abs(R["rd_sl_cycles_off"]["segH2_0"] - 0.4545) <= 0.06,
              f"rd_sl_cycles: the slice's cycle length must follow the curve or the measured period (h2/h1 on {R['rd_sl_cycles_on']['segH2_0']:.3f}, off {R['rd_sl_cycles_off']['segH2_0']:.3f})")
    # Textures scanning: the middle (330 Hz) part, away from the start and end transients
    if have("rd_tx_scan"):
        cen_within("rd_tx_scan", 1, RD_NOTE_HZ, 0.05)


CD_CLK_RATIO_MAX = 1.6    # per-window max step over its median (steady periodic waveform: about 1)
CD_CLK_RIPPLE_MAX = 0.05  # (max - min) / mean RMS over 2-period windows


def run_cycdyn_checks(R):
    """Cycles + Analyzed Root Key: a-e from the block above the cd_ cases."""
    def cents(f, ref):
        return 1200.0 * math.log2(max(f, 1e-9) / ref)

    for name, kind, wave, char, xf, pos in CD_CASES:
        if name not in R:
            continue
        r = R[name]
        if kind == "const":
            continue
        nseg = 3 if kind in ("scan", "glide", "sliced") else 1
        h2w, h3w = CD_WAVES[wave]
        label = f"{name} ({CD_CHARS[char]}, xfade {xf}, {wave})"
        for k in range(nseg):
            hz, rms = r[f"segHz{k}"], r[f"segRms{k}"]
            check(rms > 0.05, f"{label}: segment {k} must sound (rms {rms:.4f})")
            check(abs(cents(hz, RD_NOTE_HZ)) <= 12, f"{label}: segment {k} fundamental must be the note ({hz:.2f} Hz, want {RD_NOTE_HZ:.2f})")
            h2, h3 = r[f"segH2_{k}"], r[f"segH3_{k}"]
            if wave == "sine":
                check(h2 < 0.05 and h3 < 0.05, f"{label}: segment {k} must be a pure sine (H2/H1 {h2:.3f}, H3/H1 {h3:.3f})")
            else:
                check(abs(h2 - h2w) <= 0.08 and abs(h3 - h3w) <= 0.07,
                      f"{label}: segment {k} must keep the source's harmonics (H2/H1 {h2:.3f} want {h2w:.3f}, H3/H1 {h3:.3f} want {h3w:.3f})")
        check(r["clkRatio"] < CD_CLK_RATIO_MAX, f"{label}: clicks (max step / median {r['clkRatio']:.2f}, limit {CD_CLK_RATIO_MAX})")
        check(r["clkRipple"] < CD_CLK_RIPPLE_MAX, f"{label}: amplitude ripple {r['clkRipple']:.3f} (limit {CD_CLK_RIPPLE_MAX})")
    # (e) constant pitch == root_note: dyn on equals dyn off
    for name, kind, wave, char, xf, pos in CD_CASES:
        if kind != "const" or name.endswith("_off") or name not in R or name + "_off" not in R:
            continue
        a, b = R[name], R[name + "_off"]
        check(a["gpRootDyn"] == 1 and b["gpRootDyn"] == 0, f"{name}: root_dyn telemetry")
        check(abs(a["chk"] - b["chk"]) <= 1e-6 * max(abs(a["chk"]), 1.0) and abs(a["rms"] - b["rms"]) <= 1e-6,
              f"{name}: a constant source pitch equal to root_note must match root_dyn off (chk {a['chk']:.6g} vs {b['chk']:.6g})")
        check(abs(cents(a["segHz1"], RD_NOTE_HZ)) <= 12, f"{name}: fundamental {a['segHz1']:.2f} Hz")


def run_crunch_checks(R):
    """Cycles at Speed 100 % on pad / vowel / vibrato material: no crunch at the cycle joins (see the block above the cr_ cases).
    The sources hold nothing above 5 kHz (times the transposition), so the HF power can only be an artefact of the engine.
      - hf: power above 5 kHz against the source's own (dB, the source stretch the scan reads); the old engine's hard cycle
        switches put the pad / vowel 31-33 dB above their source and the vibrato sine 88 dB above its (absolute -63 dB)
      - flat: that residual must not be noise-like (spectral flatness; 0.6-0.8 with the hard switches, 0.00-0.03 now), judged
        only where it is above -100 dB
      - jump: the largest sample-to-sample step against the source's own (the old engine made the sine 1.6x as jumpy)
      - bin: second-difference energy by phase of the output period, max / median (a click at the join: 35 for the sine)
      - pitch lock: the sine plays the note (220 Hz), the pad and vowel keep their harmonic lattice"""
    for name, kind in CR_CASES:
        if name not in R:
            continue
        r = R[name]
        excess = r["crHfDb"] - r["crRefHfDb"]
        print(f"  {name}: rms={r['rms']:.3f} hfDb={r['crHfDb']:.1f} (ref {r['crRefHfDb']:.1f}, +{excess:.1f}) flat={r['crHfFlat']:.3f} (ref {r['crRefHfFlat']:.3f}) "
              f"bin={r['crBin']:.2f} harm={r['segHarm0']:.3f} jmp999={r['crJmp999']:.2f} (ref {r['crRefJmp999']:.2f}) jmpMax={r['crJmpMax']:.2f} (ref {r['crRefJmpMax']:.2f}) f={r['specPeakHz']:.1f}")
        check(r["rms"] > 0.02, f"{name}: must sound (rms {r['rms']:.4f})")
        check(excess <= 18.0 or r["crHfDb"] <= -100.0,
              f"{name}: crunch at the cycle joins: {r['crHfDb']:.1f} dB above 5 kHz is {excess:.1f} dB over the source's own {r['crRefHfDb']:.1f} dB (limit 18 dB)")
        if r["crHfDb"] > -100.0:
            check(r["crHfFlat"] <= 0.15, f"{name}: the residual above 5 kHz must not be noise-like (flatness {r['crHfFlat']:.3f}, limit 0.15)")
        check(r["crJmpMax"] <= 1.2 * r["crRefJmpMax"] + 0.15,
              f"{name}: sample-to-sample jumps {r['crJmpMax']:.2f} x rms against the source's {r['crRefJmpMax']:.2f}")
        if kind == "vib":
            check(r["crBin"] <= 6.0, f"{name}: the cycle joins must not stand out (second-difference energy max / median {r['crBin']:.1f}, limit 6)")
            check(abs(r["specPeakHz"] - 220.0) < 3.0, f"{name}: the sine must play the note, 220 Hz ({r['specPeakHz']:.1f})")
        else:
            check(r["segHarm0"] > 0.6, f"{name}: the output must repeat at the note pitch (harmonic fraction {r['segHarm0']:.3f})")


def spf_vowel_env(f0):
    """The harmonic amplitude of the probe's steady vowel (kind=vowelst) at harmonic index x of f0."""
    def env(f):
        return (1.0 / math.sqrt(1 + ((f - 700) / 110.0) ** 2) + 0.6 / math.sqrt(1 + ((f - 1220) / 140.0) ** 2)
                + 0.3 / math.sqrt(1 + ((f - 2600) / 200.0) ** 2))
    return lambda x: env(x * f0) / (1 + 0.15 * x)


def spf_fit(r, f0, nh=12):
    """Formant frequency ratio of a measured harmonic profile: the scale s of the vowel's envelope F(n / s) that best matches
    the first nh harmonics (cosine similarity), 1.0 = the vowel as it is, 2.0 = formants an octave up."""
    fn = spf_vowel_env(f0)
    amps = [r[f"segA0_{n}"] for n in range(1, nh + 1)]
    best = (-1.0, 1.0)
    for i in range(30, 301):
        sc = i / 100.0
        e = [fn(n / sc) for n in range(1, nh + 1)]
        num = sum(a * b for a, b in zip(amps, e))
        den = math.sqrt(sum(a * a for a in amps) * sum(b * b for b in e)) + 1e-30
        if num / den > best[0]:
            best = (num / den, sc)
    return best[1]


def run_spf_checks(R):
    """Spectral Pure Formant / Shift %: see the block above the spf_ cases. spf_fit reads the formant ratio off the harmonic
    amplitudes (the vowel's formants at 700 / 1220 / 2600 Hz scaled by s), which is where the peaks of the envelope sit."""
    if not all(n in R for n in SPF_CASES):
        return
    f0s = {n: (329.63 if ("hi_" in n or "p7" in n) else 220.0) for n in SPF_CASES}
    fit = {n: spf_fit(R[n], f0s[n]) for n in SPF_CASES}
    for n in SPF_CASES:
        r = R[n]
        print(f"  {n}: formant ratio {fit[n]:.2f} (cen={r['segHCen0']:.0f} pk={r['segHPk0']:.0f} harm={r['segHarm0']:.3f} rms={r['segRms0']:.3f})")
    for n in SPF_CASES:
        check(R[n]["segRms0"] > 0.02, f"{n}: must sound (rms {R[n]['segRms0']:.4f})")
        # the fundamental stays: the strongest partial is a multiple of f0 and most of the power sits on that lattice
        hz = R[n]["segHz0"]
        k = max(round(hz / f0s[n]), 1)
        check(abs(hz - k * f0s[n]) < 0.03 * k * f0s[n] and R[n]["segHarm0"] > 0.5,
              f"{n}: the pitch must stay at {f0s[n]:.0f} Hz (strongest partial {hz:.1f} Hz, lattice fraction {R[n]['segHarm0']:.3f})")
    want = (("spf_base", 0.9, 1.1), ("spf_up", 1.75, 2.2), ("spf_dn", 0.42, 0.6), ("spf_half", 1.25, 1.55), ("spf_zero", 0.9, 1.1),
            ("spf_full122", 2.05, 2.6), ("spf_off", 0.9, 1.1), ("spf_hi_base", 0.9, 1.1), ("spf_hi_up", 1.75, 2.2),
            ("spf_p7", 0.9, 1.15), ("spf_p7_up", 1.7, 2.2))
    notes = {"spf_up": "Formant +12 st must double the formant frequencies", "spf_dn": "Formant -12 st must halve them",
             "spf_half": "Shift 50 % must apply half of +12 st (+6 st = 1.41)", "spf_zero": "Shift about 0 % must leave the formants alone",
             "spf_full122": "Shift 122 % must overshoot (+14.6 st = 2.33)", "spf_off": "Formant processing off must ignore Formant",
             "spf_hi_up": "Formant +12 st must also move the formants of a 330 Hz voice",
             "spf_p7": "Playing a fifth up must keep the formants where the vowel has them",
             "spf_p7_up": "Formant +12 st on a transposed note must move them an octave", "spf_base": "The unshifted vowel must read 1.0",
             "spf_hi_base": "The unshifted 330 Hz vowel must read 1.0"}
    for n, lo, hi in want:
        check(lo <= fit[n] <= hi, f"{notes[n]} (formant ratio {fit[n]:.2f}, want {lo}..{hi})")



def rh_read_raw(path):
    left = []
    with open(path, "r") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2:
                left.append(float(parts[0]))
    return left


def rh_harmonics(x, f0, sr, nh=8):
    """Hann-windowed single-bin DFT at k * f0 (k = 1..nh): list of (magnitude, phase)."""
    n = len(x)
    win = [0.5 - 0.5 * math.cos(2.0 * math.pi * i / n) for i in range(n)]
    xs = [x[i] * win[i] for i in range(n)]
    out = []
    for k in range(1, nh + 1):
        w = 2.0 * math.pi * k * f0 / sr
        cr, ci = math.cos(w), math.sin(w)
        rr, ri = 1.0, 0.0
        sr_, si_ = 0.0, 0.0
        for v in xs:
            sr_ += v * rr
            si_ -= v * ri
            rr, ri = rr * cr - ri * ci, rr * ci + ri * cr
        out.append((math.hypot(sr_, si_) * 2.0 / n, math.atan2(si_, sr_)))
    return out


def rh_compare(ref, tst, f0, sr=48000.0):
    """Residual of the null test (dB re the reference), worst harmonic magnitude difference (dB) and the rms difference of the
    harmonic phase alignment (phase of harmonic k minus k times the fundamental's, strong harmonics only, radians)."""
    n = min(len(ref), len(tst))
    ref, tst = ref[:n], tst[:n]
    e_ref = sum(v * v for v in ref)
    e_res = sum((a - b) ** 2 for a, b in zip(ref, tst))
    res_db = 10.0 * math.log10((e_res + 1e-20) / (e_ref + 1e-20))
    hr, ht = rh_harmonics(ref, f0, sr), rh_harmonics(tst, f0, sr)
    top = max(m for m, _ in hr)
    mag_db, errs = 0.0, []
    for k in range(8):
        if hr[k][0] < top * 0.01:
            continue
        mag_db = max(mag_db, abs(20.0 * math.log10((ht[k][0] + 1e-12) / (hr[k][0] + 1e-12))))
        if k >= 1:
            d = (ht[k][1] - (k + 1) * ht[0][1]) - (hr[k][1] - (k + 1) * hr[0][1])
            d = d - 2.0 * math.pi * round(d / (2.0 * math.pi))
            errs.append(d * d)
    ph = math.sqrt(sum(errs) / max(len(errs), 1))
    return res_db, mag_db, ph, math.sqrt(e_ref / max(n, 1))


def run_reharm_checks(R):
    """Spectral controls returned to neutral must sound like never moved: see the block above the rh_ cases."""
    for rn, tn, src, f0, tol in RH_CASES:
        if rn not in R or tn not in R or "raw" not in R[rn] or "raw" not in R[tn]:
            continue
        res_db, mag_db, ph, rms = rh_compare(R[rn]["raw"], R[tn]["raw"], f0)
        print(f"  {tn}: null {res_db:.1f} dB, harmonic magnitude {mag_db:.2f} dB, harmonic phase {ph:.3f} rad (ref rms {rms:.3f})")
        check(rms > 0.02, f"{rn}: the reference must sound (rms {rms:.4f})")
        check(res_db < -40.0, f"{tn}: after the control returned to neutral the output must null against the reference "
                              f"(residual {res_db:.1f} dB, want < -40)")
        check(mag_db < tol, f"{tn}: harmonic magnitudes must match the reference (worst {mag_db:.2f} dB, want < {tol})")
        check(ph < 0.1, f"{tn}: harmonic phase alignment must match the reference (rms {ph:.3f} rad, want < 0.1)")


def run_rpf_checks(R):
    """Repitch Freeze (see the block above the rpf_ cases)."""
    if not all(n in R for n in RPF_CASES):
        return
    for n in RPF_CASES:
        r = R[n]
        print(f"  {n}: rms={r['rms']:.3f} seg0={r['segHz0']:.1f} Hz harm={r['segHarm0']:.3f} ripple={r['clkRipple']:.3f} "
              f"ratio={r['clkRatio']:.2f} jump={r['clkJump']:.3f}")
    # a static Pos: a stable, periodic tone at the played pitch (one root cycle of the source repeats exactly)
    for n, hz in (("rpf_static", 220.0), ("rpf_static_lo", 220.0), ("rpf_static_hi", 220.0), ("rpf_static_up", 440.0), ("rpf_static_rev", 220.0)):
        r = R[n]
        check(r["segRms0"] > 0.1, f"{n}: the frozen loop must sound (rms {r['segRms0']:.4f})")
        check(abs(r["segHz0"] - hz) < 0.01 * hz, f"{n}: the frozen loop must play at {hz:.0f} Hz ({r['segHz0']:.2f})")
        check(r["segHarm0"] > 0.98, f"{n}: a static Pos must be periodic, not noise (harmonic fraction {r['segHarm0']:.4f})")
        check(r["clkRipple"] < 0.03, f"{n}: the loop must be steady (amplitude ripple {r['clkRipple']:.3f})")
        check(r["clkRatio"] < 1.5, f"{n}: the loop seam must not click (max step / median {r['clkRatio']:.2f})")
    # a unison stack (4 voices, 5 % detune): the detuned voices beat (so no ripple / step-ratio limits), but nothing may jump
    r = R["rpf_static_uni"]
    check(r["segRms0"] > 0.1 and abs(r["segHz0"] - 220.0) < 4.0 and r["clkJump"] < 0.15,
          f"rpf_static_uni: the frozen unison stack must sound at 220 Hz without jumps (rms {r['segRms0']:.3f}, {r['segHz0']:.1f} Hz, largest step / peak {r['clkJump']:.3f})")
    # a moving Pos: the pitch follows the head speed, without jumps or noise
    for n, v in (("rpf_fwd10", 0.10), ("rpf_fwd25", 0.25), ("rpf_back10", -0.10)):
        r = R[n]
        want = 220.0 * (1.0 + v)
        check(r["segRms0"] > 0.1, f"{n}: must sound (rms {r['segRms0']:.4f})")
        check(abs(r["segHz0"] / 220.0 - (1.0 + v)) < 0.02, f"{n}: a head moving at {v:+.2f} frames/sample must play at {want:.0f} Hz (got {r['segHz0']:.1f})")
        check(r["segHarm0"] > 0.78, f"{n}: sliding Pos must stay tonal, not grainy (harmonic fraction {r['segHarm0']:.4f})")
        check(r["clkRatio"] < 1.8, f"{n}: no discontinuities while Pos moves (max step / median {r['clkRatio']:.2f})")
        check(r["clkRipple"] < 0.08, f"{n}: no amplitude modulation while Pos moves (ripple {r['clkRipple']:.3f})")
    # a jump of Pos: the head glides (a bend up that settles), then the loop is stable again
    r = R["rpf_step"]
    check(r["segHz0"] > 1.5 * 220.0, f"rpf_step: the head moving forward must bend the pitch up right after the jump ({r['segHz0']:.1f} Hz)")
    check(abs(r["segHz1"] - 220.0) < 3.0 and r["segHarm1"] > 0.97,
          f"rpf_step: after the glide the loop must be stable at 220 Hz ({r['segHz1']:.1f} Hz, harmonic fraction {r['segHarm1']:.3f})")
    check(r["clkJump"] < 0.3, f"rpf_step: the glide must not jump (largest step / peak {r['clkJump']:.3f})")


def run_lfo_checks(R):
    """S&H LFO steps once per period (aliased `prevLfoPhs = lfoPhs` never saw the wrap and S&H never stepped)."""
    if not all(n in R for n in LFO_CASES):
        return
    def series(n):
        r = R[n]
        return [(ms, r[f"snp{ms}Lfo"]) for ms in LFO_SNAPS if f"snp{ms}Lfo" in r]
    sh = series("lfo_sh")
    check(len(sh) >= 25, f"lfo_sh: LFO telemetry snapshots missing ({len(sh)})")
    vals = [v for _, v in sh]
    check(all(-1.0001 <= v <= 1.0001 for v in vals), "lfo_sh: S&H value must stay in -1..1")
    changes = [sh[i][0] for i in range(1, len(sh)) if abs(sh[i][1] - sh[i - 1][1]) > 1e-6]
    print(f"  lfo_sh: {len(changes)} steps at {changes}")
    print("  lfo_sh series", [(m, round(v, 3)) for m, v in sh])
    # 250 ms at 20 Hz = 5 wraps (4 or 5 seen), never more
    check(4 <= len(changes) <= 5, f"lfo_sh: expected 4-5 steps in 250 ms at 20 Hz, saw {len(changes)}")
    gaps = [changes[i] - changes[i - 1] for i in range(1, len(changes))]
    check(all(abs(g - 50) <= 9 for g in gaps), f"lfo_sh: steps must be 50 ms apart (gaps {gaps})")
    check(len(set(round(v, 4) for v in vals)) >= 4, "lfo_sh: each step must pick a new random value")
    saw = series("lfo_saw")
    sv = [v for _, v in saw]
    check(len(set(round(v, 3) for v in sv)) >= 20, "lfo_saw: control saw LFO must vary continuously")


def run_tel_checks(R):
    """Grain telemetry in #0-bsscope 64..127 (see the block above the tel_ cases)."""
    if not all(n in R for n in TEL_CASES):
        return
    for n in TEL_CASES:
        r = R[n]
        print(f"  {n}: end N={r['gtN']:.0f} min={r['gtMin']:.3f} max={r['gtMax']:.3f} lvl={r['gtLvlMax']:.2f} | snaps "
              f"{r.get('gtAllSnaps', 0):.0f} N {r.get('gtAllMinN', -1):.0f}..{r.get('gtAllMaxN', -1):.0f} pos {r.get('gtAllMin', -1):.3f}..{r.get('gtAllMax', -1):.3f} "
              f"distinct {r.get('gtAllDistinct', 0):.0f}")
    r = R["tel_idle"]
    check(r["gtN"] == 0 and r["gtUnusedOk"] == 1, f"tel_idle: all 32 grain slots must be -1 / level 0 when idle (N={r['gtN']:.0f}, ok={r['gtUnusedOk']:.0f})")
    for n in ("tel_cy", "tel_rp"):
        check(R[n]["gtAllMaxN"] == 0 and R[n]["gtAllBad"] == 0, f"{n}: engines without grains must leave the slots at -1 (max N {R[n]['gtAllMaxN']:.0f})")
    r = R["tel_tx_rel"]
    check(r["gtN"] == 0 and r["gtUnusedOk"] == 1, f"tel_tx_rel: slots must go back to -1 after the voice has ended (N={r['gtN']:.0f})")
    check(r["gtAllMaxN"] >= 1, "tel_tx_rel: grains must show while the note is held")
    # Textures, frozen at Pos 0.5 with spray 35 % and 55 ms grains: the grains read around 0.5 +- (spray 0.114 + half a grain 0.11)
    r = R["tel_tx"]
    check(r["gtAllMinN"] >= 1 and r["gtAllMaxN"] <= 32 and r["gtAllBad"] == 0, f"tel_tx: 1..32 grains with valid slots (N {r['gtAllMinN']:.0f}..{r['gtAllMaxN']:.0f}, bad {r['gtAllBad']:.0f})")
    check(r["gtAllDistinct"] >= 6, f"tel_tx: spray must give several distinct positions over time ({r['gtAllDistinct']:.0f})")
    check(0.26 <= r["gtAllMin"] and r["gtAllMax"] <= 0.74, f"tel_tx: positions must stay around Pos 0.5 +- 0.23 ({r['gtAllMin']:.3f}..{r['gtAllMax']:.3f})")
    check(0.0 < r["gtAllLvl"] <= 1.0, f"tel_tx: levels must be 0..1 ({r['gtAllLvl']:.3f})")
    r = R["tel_tx_poly"]
    check(r["gtAllMaxN"] == 32, f"tel_tx_poly: 4 voices x 4 unison x 2 windows fill all 32 slots ({r['gtAllMaxN']:.0f})")
    check(r["gtAllBad"] == 0, "tel_tx_poly: unused slots must be exactly -1 / 0")
    r = R["tel_tx_prio"]
    check(r["gtLoud"] >= 8 and r["gtN"] == 32, f"tel_tx_prio: the loud voice's grains must win slots over the quiet ones (loud {r['gtLoud']:.0f}, N {r['gtN']:.0f})")
    r = R["tel_tx_scan"]
    check(r["gtAllDistinct"] >= 6 and r["gtAllMin"] >= 0.0 and r["gtAllMax"] <= 1.0,
          f"tel_tx_scan: the scanning playhead must show moving grains within 0..1 (distinct {r['gtAllDistinct']:.0f}, {r['gtAllMin']:.3f}..{r['gtAllMax']:.3f})")
    # Fragments: grains of 40 ms at density 8 from Pos 0.5, they read forward from there (up to 40 ms = 0.16 of the sample)
    r = R["tel_fr"]
    check(r["gtAllMaxN"] >= 3 and r["gtAllBad"] == 0, f"tel_fr: Fragments grains must show (max N {r['gtAllMaxN']:.0f}, bad {r['gtAllBad']:.0f})")
    check(r["gtAllDistinct"] >= 6, f"tel_fr: grains of different ages read different positions ({r['gtAllDistinct']:.0f})")
    check(0.49 <= r["gtAllMin"] and r["gtAllMax"] <= 0.70, f"tel_fr: positions must run forward from Pos 0.5 ({r['gtAllMin']:.3f}..{r['gtAllMax']:.3f})")
    check(0.0 < r["gtAllLvl"] <= 1.0, f"tel_fr: levels must be 0..1 ({r['gtAllLvl']:.3f})")
    r = R["tel_fr_many"]
    check(r["gtAllMaxN"] == 32 and r["gtAllBad"] == 0, f"tel_fr_many: more than 32 grains in flight must fill, not overflow, the 32 slots ({r['gtAllMaxN']:.0f})")


def run_cyctime_checks(R):
    """Cycles timing: markers at source time / Speed, playhead slope = Speed, stop / wrap on the same clock, pitch = note."""
    CT_TOL_MS = float(os.environ.get("CT_TOL_MS", "12"))
    for name, ex in CT_CASES:
        if name not in R:
            continue
        r = R[name]
        label = f"{name} (note {ex['note']}, speed {ex['speed']}, {ex['tag']})"
        hits = ex["hits"]
        pts0 = [(ms, r[f"snp{ms}Pos"]) for ms in ex["snaps"] if r.get(f"snp{ms}Pos", -1) >= 0]
        slope0 = ((pts0[-1][1] - pts0[0][1]) / ((pts0[-1][0] - pts0[0][0]) / 1000.0)) if len(pts0) >= 2 else float("nan")
        print(f"  {name}: bursts {[round(r[f'mkT{k}'], 1) for k in range(int(r.get('mkN', 0)))] if ex['speed'] > 0 else '-'} "
              f"want {[round(h, 1) for h in hits]}, end {r.get('mkEnd', -1):.0f} (want {ex['stop'] and round(ex['stop'])}), "
              f"slope {slope0:.3f}, pitch {r['segHz0']:.1f} Hz (want {ex['hz']:.1f})")
        if ex["speed"] > 0 and ex["bursts"] == "ref":
            rr = R.get(ex["ref"])
            if rr is not None:
                got = [r[f"mkT{k}"] for k in range(int(r.get("mkN", 0)))]
                want = [rr[f"mkT{k}"] for k in range(int(rr.get("mkN", 0)))]
                check(len(got) == len(want) and all(abs(g - w) <= 8.0 for g, w in zip(got, want)),
                      f"{label}: bursts {[round(g, 1) for g in got]} ms, the 48 kHz file ({ex['ref']}) gives {[round(w, 1) for w in want]} ms")
                check(abs(r.get("mkEnd", -1) - rr.get("mkEnd", -1)) <= 20.0,
                      f"{label}: output ends at {r.get('mkEnd', -1):.1f} ms, the 48 kHz file gives {rr.get('mkEnd', -1):.1f} ms")
        if ex["speed"] > 0 and ex["bursts"] == "abs":
            n_want = len(hits)
            got = [r[f"mkT{k}"] for k in range(int(r.get("mkN", 0)))]
            check(len(got) == n_want, f"{label}: {n_want} bursts expected, found {len(got)} at {[round(g, 1) for g in got]} (want {[round(h, 1) for h in hits]})")
            for g, h in zip(got, hits):
                check(abs(g - h) <= CT_TOL_MS, f"{label}: burst at {g:.1f} ms, want {h:.1f} ms (tolerance {CT_TOL_MS} ms)")
            if ex["stop"]:
                check(abs(r["mkEnd"] - ex["stop"]) <= 20.0, f"{label}: output ends at {r['mkEnd']:.1f} ms, want {ex['stop']:.1f} ms")
                check(r["afterPeak"] < 0.01, f"{label}: must be silent after the end (peak {r['afterPeak']:.4f})")
        # playhead slope (telemetry slots 0..15) over the snapshots before the first wrap / stop
        pts = [(ms, r[f"snp{ms}Pos"]) for ms in ex["snaps"] if r.get(f"snp{ms}Pos", -1) >= 0]
        check(len(pts) >= 3, f"{label}: playhead telemetry missing ({len(pts)} snapshots)")
        if len(pts) >= 3:
            slope = (pts[-1][1] - pts[0][1]) / ((pts[-1][0] - pts[0][0]) / 1000.0)
            want = (-1.0 if ex["rev"] else 1.0) * ex["speed"]
            if ex["speed"] == 0:
                check(abs(slope) < 0.01, f"{label}: the playhead must hold at Speed 0 (slope {slope:.3f})")
            else:
                check(abs(slope / want - 1.0) <= 0.02, f"{label}: playhead slope {slope:.3f} sample/s, want {want:.3f} (+-2 %)")
        cents = 1200.0 * math.log2(max(r["segHz0"], 1e-9) / ex["hz"])
        check(abs(cents) <= (60 if (ex["tag"] == "pingpong100" or "cttx" in name) else 12), f"{label}: pitch {r['segHz0']:.2f} Hz, want {ex['hz']:.2f} Hz ({cents:+.0f} ct)")
        check(r["scopeFrames"] == ex["frames"], f"{label}: the {ex['frames']}-frame sample must be bound ({r['scopeFrames']})")


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
    # worst case for the cycle search: an inharmonic pad scanned at Speed 100 % (the search runs at every cycle seam)
    ("cycles(pad)", "mode 1, root_dyn 0, root_note 57, grain_motion 1.0, samp_start 0.6, samp_end 1.0, loop_mode 1, loop_start 0.6, loop_end 0.9, loop_xfade 0",
     "src=real48 kind=pad len=8 gstart=4.8 glen=2.4 off=0.35"),
    ("repitch freeze", "mode 0, freeze 1, play_pos 0.5"),
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
    for entry in CPU_ENGINES:
        label, params = entry[0], entry[1]
        src_opts = entry[2] if len(entry) > 2 else "src=sus48"
        if os.environ.get("SAMPLER_CPU_ENGINES") and not re.search(os.environ["SAMPLER_CPU_ENGINES"], label):
            continue
        out = []
        for nv, notes in ((0, ""), (4, "57,60,64,67")):
            walls = []
            for dur in (short_ms, long_ms):
                opts = f"{src_opts} notes=57" if nv == 0 else f"{src_opts} notes={notes} start=live"
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
