#!/usr/bin/env python3
"""
Build Better Sampler (.amxd) — Bitwig-Style Multi-Engine Polyphonic Sampler for Ableton Live 12.

Features:
  - 4 Playback Engines: REPITCH, CYCLES, TEXTURES (Granular), and SLICE + Playhead FREEZE.
  - Up to 16-Voice Polyphony + up to 8-Voice Stereo Unison per voice + Mono / Legato / Glide.
  - Multimode Chamberlin SVF Filter (LP / BP / HP) with Pre-Drive, Resonance & Bipolar Envelope Mod.
  - Dual ADSR Envelopes (Amp ADSR + Filter/Mod ADSR) + Internal LFO (Sine, Triangle, Saw, S&H).
  - Multi-Panel Collapsible Architecture (`Filt/Amp` and `Mod/Uni` expand/collapse buttons in the
    top header dynamically hide/reposition sections and shrink the device width in Ableton Live
    via `live.thisdevice` `setwidth` and `thispatcher`).
  - Generates 3 distinct 169px-tall UI size/layout variants in `devices/`:
      1. "standard" (720 x 169 px -> `devices/Better Sampler.amxd` & `devices/Better Sampler Standard.amxd`)
         Ableton Sampler-sized 4-panel workstation (shrinks to 568 / 588 / 436 px when panels collapse).
      2. "compact"  (622 x 169 px -> `devices/Better Sampler Compact.amxd`)
         Simpler-sized high-density horizontal value-bar edition (shrinks to 486 / 504 / 368 px).
      3. "expanded" (788 x 169 px -> `devices/Better Sampler Expanded.amxd`)
         Wide flagship studio edition (shrinks to 624 / 640 / 476 px) with 328px waveform editor and full rotary + slider controls.
"""

import json
import os
import struct
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "sampler_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "sampler_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "sampler_core.genexpr")

DEVICE_H = 169.0

# Color palette
COL_PLAY = (0.24, 0.84, 0.96)   # Cyan — Playback / Pitch / Loop
COL_GRN  = (0.30, 0.90, 0.58)   # Emerald — Textures / Cycles / Granular
COL_FILT = (0.98, 0.62, 0.24)   # Amber — SVF Filter + Drive
COL_AMP  = (0.38, 0.78, 0.98)   # Sky Blue — Amp ADSR
COL_MOD  = (0.76, 0.46, 0.98)   # Violet — Mod Env & LFO
COL_UNI  = (0.98, 0.42, 0.58)   # Coral — Unison / Voicing / Master

# Continuous parameter specs:
# key: (long_name, short_name, lo, hi, initial, unitstyle, exponent, gen_param, scale_factor, ui_setter, help_text)
# unitstyle: 0=int, 1=float, 2=time(ms), 3=freq(Hz), 4=dB, 5=percent, 7=semitones
PARAM_SPECS = {
    # Playback & Pitch
    "pitch_st": (
        "Transpose", "Pitch", -36.0, 36.0, 0.0, 7, 1.0, "pitch_st", 1.0, "set_pitch_st",
        "Coarse pitch transposition in semitones (-36 to +36 st).",
    ),
    "fine_cents": (
        "Fine Tune", "Fine", -100.0, 100.0, 0.0, 0, 1.0, "fine_cents", 1.0, "set_fine_cents",
        "Fine pitch tuning in cents (-100 to +100 ct).",
    ),
    "root_note": (
        "Root Note", "Root", 0.0, 127.0, 60.0, 0, 1.0, "root_note", 1.0, "set_root_note",
        "Root MIDI key of the loaded sample (60 = C3).",
    ),
    "play_pos": (
        "Play Position", "Pos", 0.0, 100.0, 0.0, 5, 1.0, "play_pos", 0.01, "set_play_pos",
        "Playhead start or frozen scrub position (0 to 100%).",
    ),
    "samp_start": (
        "Sample Start", "Start", 0.0, 99.0, 0.0, 5, 1.0, "samp_start", 0.01, "set_samp_start",
        "Normalized sample start boundary (0 to 99%).",
    ),
    "samp_end": (
        "Sample End", "End", 1.0, 100.0, 100.0, 5, 1.0, "samp_end", 0.01, "set_samp_end",
        "Normalized sample end boundary (1 to 100%).",
    ),
    "loop_start": (
        "Loop Start", "LpStart", 0.0, 98.0, 15.0, 5, 1.0, "loop_start", 0.01, "set_loop_start",
        "Loop start marker position (0 to 98%).",
    ),
    "loop_end": (
        "Loop End", "LpEnd", 2.0, 100.0, 85.0, 5, 1.0, "loop_end", 0.01, "set_loop_end",
        "Loop end marker position (2 to 100%).",
    ),
    "loop_xfade": (
        "Loop Crossfade", "XFade", 0.0, 100.0, 10.0, 5, 1.0, "loop_xfade", 0.0045, "set_loop_xfade",
        "Equal-power loop boundary crossfade depth (0 to 100%).",
    ),
    # Cycles / Textures (Granular)
    "grain_size": (
        "Grain Size", "Grain", 5.0, 500.0, 65.0, 2, 1.8, "grain_size", 1.0, "set_grain_size",
        "Hann grain window duration in Textures mode (5 to 500 ms).",
    ),
    "grain_motion": (
        "Motion Speed", "Motion", 0.0, 200.0, 100.0, 5, 1.0, "grain_motion", 0.01, "set_grain_motion",
        "Playhead scan speed through the sample in Cycles and Textures modes (0% frozen to 200%).",
    ),
    "grain_spray": (
        "Grain Spray", "Spray", 0.0, 100.0, 15.0, 5, 1.0, "grain_spray", 0.01, "set_grain_spray",
        "Random position jitter around the playhead in Textures mode.",
    ),
    "formant": (
        "Formant Shift", "Formant", -24.0, 24.0, 0.0, 7, 1.0, "formant", 1.0, "set_formant",
        "Phase-locked intra-cycle formant shift in Cycles mode (-24 to +24 st).",
    ),
    # Filter
    "filt_cutoff": (
        "Filter Cutoff", "Cutoff", 20.0, 20000.0, 18000.0, 3, 2.6, "filt_cutoff", 1.0, "set_filt_cutoff",
        "2-pole zero-delay SVF cutoff frequency (20 Hz to 20 kHz).",
    ),
    "filt_res": (
        "Filter Resonance", "Res", 0.0, 100.0, 15.0, 5, 1.0, "filt_res", 0.0095, "set_filt_res",
        "SVF filter resonance (0 to 100%).",
    ),
    "filt_drive": (
        "Filter Drive", "Drive", 0.0, 100.0, 0.0, 5, 1.0, "filt_drive", 0.01, "set_filt_drive",
        "Pre-filter saturation drive (0 to 100%).",
    ),
    "filt_env_amt": (
        "Filter Env Amt", "FEnv", -100.0, 100.0, 0.0, 5, 1.0, "filt_env_amt", 0.01, "set_filt_env_amt",
        "Bipolar Mod Envelope depth on filter cutoff (-100% to +100%).",
    ),
    # Amp ADSR
    "atk_ms": (
        "Amp Attack", "Atk", 0.2, 5000.0, 2.5, 2, 2.6, "atk_ms", 1.0, "set_atk_ms",
        "Amplitude envelope attack time (0.2 ms to 5000 ms).",
    ),
    "dec_ms": (
        "Amp Decay", "Dec", 1.0, 10000.0, 250.0, 2, 2.6, "dec_ms", 1.0, "set_dec_ms",
        "Amplitude envelope decay time (1 ms to 10 s).",
    ),
    "sus_lvl": (
        "Amp Sustain", "Sus", 0.0, 100.0, 85.0, 5, 1.0, "sus_lvl", 0.01, "set_sus_lvl",
        "Amplitude envelope sustain level (0 to 100%).",
    ),
    "rel_ms": (
        "Amp Release", "Rel", 1.0, 10000.0, 140.0, 2, 2.6, "rel_ms", 1.0, "set_rel_ms",
        "Amplitude envelope release time (1 ms to 10 s).",
    ),
    # Mod ADSR
    "matk_ms": (
        "Mod Attack", "MAtk", 0.2, 5000.0, 5.0, 2, 2.6, "matk_ms", 1.0, "set_matk_ms",
        "Filter/Mod envelope attack time (0.2 ms to 5000 ms).",
    ),
    "mdec_ms": (
        "Mod Decay", "MDec", 1.0, 10000.0, 320.0, 2, 2.6, "mdec_ms", 1.0, "set_mdec_ms",
        "Filter/Mod envelope decay time (1 ms to 10 s).",
    ),
    "msus_lvl": (
        "Mod Sustain", "MSus", 0.0, 100.0, 25.0, 5, 1.0, "msus_lvl", 0.01, "set_msus_lvl",
        "Filter/Mod envelope sustain level (0 to 100%).",
    ),
    "mrel_ms": (
        "Mod Release", "MRel", 1.0, 10000.0, 220.0, 2, 2.6, "mrel_ms", 1.0, "set_mrel_ms",
        "Filter/Mod envelope release time (1 ms to 10 s).",
    ),
    "menv_pitch": (
        "ModEnv Pitch", "MEnvP", -100.0, 100.0, 0.0, 5, 1.0, "menv_pitch", 0.01, None,
        "Bipolar Mod Envelope depth on pitch.",
    ),
    "menv_pos": (
        "ModEnv Pos", "MEnvPos", -100.0, 100.0, 0.0, 5, 1.0, "menv_pos", 0.01, None,
        "Bipolar Mod Envelope depth on sample playhead position.",
    ),
    # LFO
    "lfo_rate": (
        "LFO Rate", "Rate", 0.05, 30.0, 2.0, 3, 2.0, "lfo_rate", 1.0, "set_lfo_rate",
        "Internal modulation LFO frequency (0.05 to 30 Hz).",
    ),
    "lfo_pitch": (
        "LFO Pitch", "LfoP", -100.0, 100.0, 0.0, 5, 1.0, "lfo_pitch", 0.01, "set_lfo_pitch",
        "Bipolar LFO depth on voice pitch.",
    ),
    "lfo_filt": (
        "LFO Filter", "LfoF", -100.0, 100.0, 0.0, 5, 1.0, "lfo_filt", 0.01, "set_lfo_filt",
        "Bipolar LFO depth on SVF filter cutoff.",
    ),
    "lfo_pos": (
        "LFO Pos", "LfoPos", -100.0, 100.0, 0.0, 5, 1.0, "lfo_pos", 0.01, "set_lfo_pos",
        "Bipolar LFO depth on sample/grain playhead position.",
    ),
    # Unison & Voicing
    "poly_voices": (
        "Poly Voices", "Voices", 1.0, 16.0, 8.0, 0, 1.0, None, 1.0, "set_poly_voices",
        "Maximum polyphonic voices (1 to 16 voices).",
    ),
    "unison_voices": (
        "Unison Voices", "Unison", 1.0, 8.0, 1.0, 0, 1.0, "unison_voices", 1.0, "set_unison_voices",
        "Stacked stereo unison voices per note (1 to 8).",
    ),
    "unison_detune": (
        "Unison Detune", "Detune", 0.0, 100.0, 15.0, 5, 1.0, "unison_detune", 0.01, "set_unison_detune",
        "Unison detune and phase spread amount (0 to 100%).",
    ),
    "unison_width": (
        "Unison Width", "Width", 0.0, 100.0, 65.0, 5, 1.0, "unison_width", 0.01, "set_unison_width",
        "Stereo pan spread across unison voices (0 to 100%).",
    ),
    "glide_ms": (
        "Pitch Glide", "Glide", 0.0, 1000.0, 0.0, 2, 2.2, "glide_ms", 1.0, "set_glide_ms",
        "Portamento pitch glide time in milliseconds (0 to 1000 ms).",
    ),
    "vel_sens": (
        "Velocity Sens", "Vel", 0.0, 100.0, 70.0, 5, 1.0, "vel_sens", 0.01, None,
        "MIDI note velocity sensitivity (0 to 100%).",
    ),
    "out_gain": (
        "Output Gain", "Gain", -36.0, 18.0, 0.0, 4, 1.0, "out_gain", 1.0, None,
        "Master output level in dB (-36 to +18 dB).",
    ),
}

# Discrete enum / toggle parameters:
# key: (long_name, short_name, enums, initial, gen_param, ui_setter, help_text)
ENUM_SPECS = {
    "mode": (
        "Playback Mode", "Mode", ["Repitch", "Cycles", "Textures", "Slice"], 0, "mode", "set_mode",
        "Selects Bitwig-style Repitch, Cycles (formant wavetable), Textures (granular), or Slice engine.",
    ),
    "freeze": (
        "Playhead Freeze", "Freeze", ["Off", "Freeze"], 0, "freeze", "set_freeze",
        "Freezes automatic playhead advancement so Pos and modulation scrub through the sample.",
    ),
    "reverse": (
        "Reverse Playback", "Rev", ["Fwd", "Rev"], 0, "reverse", "set_reverse",
        "Reverses sample playback direction.",
    ),
    "loop_mode": (
        "Loop Mode", "Loop", ["Off", "Fwd", "Ping"], 1, "loop_mode", "set_loop_mode",
        "Selects One-Shot (Off), Forward Loop (Fwd), or Ping-Pong Loop (Ping).",
    ),
    "filt_on": (
        "Filter Enable", "FiltOn", ["Off", "On"], 1, "filt_on", "set_filt_on",
        "Enables the 2-pole zero-delay multimode SVF filter.",
    ),
    "filt_type": (
        "Filter Type", "FType", ["LP", "BP", "HP"], 0, "filt_type", "set_filt_type",
        "Selects Low-Pass (LP), Band-Pass (BP), or High-Pass (HP) SVF response.",
    ),
    "lfo_shape": (
        "LFO Shape", "Shape", ["Sin", "Tri", "Saw", "S&H"], 0, "lfo_shape", "set_lfo_shape",
        "Selects Sine, Triangle, Sawtooth, or Sample-and-Hold LFO waveform.",
    ),
    "mono_legato": (
        "Mono Legato", "Legato", ["Poly", "Legato"], 0, None, "set_mono_legato",
        "Switches between polyphonic voicing and monophonic single-trigger legato.",
    ),
}


def valueof_dict(key):
    long_name, short, lo, hi, initial, unit, exponent, _gen, _sc, _ui, _help = PARAM_SPECS[key]
    v = {
        "parameter_annotation_name": long_name,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": hi,
        "parameter_mmin": lo,
        "parameter_shortname": short,
        "parameter_type": 0,
        "parameter_unitstyle": unit,
    }
    if exponent != 1.0:
        v["parameter_exponent"] = exponent
    return v


def enum_valueof_dict(key):
    long_name, short, enums, initial, _gen, _ui, _help = ENUM_SPECS[key]
    return {
        "parameter_annotation_name": long_name,
        "parameter_enum": enums,
        "parameter_initial": [initial],
        "parameter_initial_enable": 1,
        "parameter_linknames": 1,
        "parameter_longname": long_name,
        "parameter_mmax": len(enums) - 1,
        "parameter_shortname": short,
        "parameter_type": 2,
    }


def make_dial(key, x, y, w=40.0, h=44.0, color_rgb=COL_PLAY):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _sc, _ui, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activedialcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 240.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "varname": long_name,
        }
    }


def make_numbox(key, x, y, w=44.0, h=14.0, color_rgb=COL_PLAY, appearance=2, fontsize=8.5):
    """
    appearance: 0 = classic box, 2 = Slider from left, 3 = Bipolar from center
    Pre-blends activeslidercolor (38% accent + 62% dark bg) per AGENTS.md rule #8.
    """
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _sc, _ui, help_text = PARAM_SPECS[key]
    bg = [0.06, 0.075, 0.095, 1.0]
    bar_rgb = [
        round(bg[0] * 0.62 + color_rgb[0] * 0.38, 4),
        round(bg[1] * 0.62 + color_rgb[1] * 0.38, 4),
        round(bg[2] * 0.62 + color_rgb[2] * 0.38, 4),
        1.0,
    ]
    return {
        "box": {
            "activebgcolor": bg,
            "activeslidercolor": bar_rgb,
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": appearance,
            "bordercolor": [0.22, 0.27, 0.33, 1.0],
            "fontface": 1,
            "fontsize": float(fontsize),
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 295.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "textcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "varname": long_name,
        }
    }


def make_toggle(key, x, y, w=34.0, h=14.0, color_rgb=COL_PLAY, text_off="Off", text_on="ON"):
    long_name, _short, _enums, _init, _gen, _ui, help_text = ENUM_SPECS[key]
    return {
        "box": {
            "activebgcolor": [0.10, 0.12, 0.15, 1.0],
            "activebgoncolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "activetextcolor": [0.75, 0.80, 0.86, 1.0],
            "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "bordercolor": [color_rgb[0], color_rgb[1], color_rgb[2], 0.85],
            "fontsize": 8.0,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.text",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [float(x), 185.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": enum_valueof_dict(key)},
            "text": text_off,
            "texton": text_on,
            "varname": long_name,
        }
    }


def make_enum_slider(key, x, y, w=44.0, h=14.0, color_rgb=COL_PLAY):
    long_name, _short, _enums, _init, _gen, _ui, help_text = ENUM_SPECS[key]
    vof = enum_valueof_dict(key)
    vof["parameter_unitstyle"] = 9
    bg = [0.06, 0.075, 0.095, 1.0]
    bar_rgb = [
        round(bg[0] * 0.62 + color_rgb[0] * 0.38, 4),
        round(bg[1] * 0.62 + color_rgb[1] * 0.38, 4),
        round(bg[2] * 0.62 + color_rgb[2] * 0.38, 4),
        1.0,
    ]
    return {
        "box": {
            "activebgcolor": bg,
            "activeslidercolor": bar_rgb,
            "activetricolor2": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": 2,
            "bordercolor": [color_rgb[0] * 0.65, color_rgb[1] * 0.65, color_rgb[2] * 0.65, 1.0],
            "fontface": 1,
            "fontsize": 8.5,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 205.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": vof},
            "textcolor": [0.95, 0.97, 1.0, 1.0],
            "varname": long_name,
        }
    }


def make_tab(key, x, y, w=68.0, h=14.0, color_rgb=COL_FILT, num_rows=1, pictures=None):
    long_name, _short, _enums, _init, _gen, _ui, help_text = ENUM_SPECS[key]
    b = {
        "activebgcolor": [0.09, 0.11, 0.14, 1.0],
        "activebgoncolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
        "activetextcolor": [0.78, 0.82, 0.88, 1.0],
        "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
        "annotation": help_text,
        "annotation_name": long_name,
        "bordercolor": [0.22, 0.26, 0.32, 1.0],
        "fontsize": 8.0,
        "id": f"obj-ctrl-{key}",
        "maxclass": "live.tab",
        "num_lines_patching": num_rows,
        "num_lines_presentation": num_rows,
        "numinlets": 1,
        "numoutlets": 3,
        "outlettype": ["", "", "float"],
        "parameter_enable": 1,
        "patching_rect": [float(x), 210.0, float(w), float(h)],
        "presentation": 1,
        "presentation_rect": [float(x), float(y), float(w), float(h)],
        "saved_attribute_attributes": {"valueof": enum_valueof_dict(key)},
        "spacing_x": 2.0,
        "spacing_y": 2.0,
        "varname": long_name,
    }
    if pictures:
        b["pictures"] = pictures
        b["usepicture"] = 1
    return {"box": b}


def make_collapse_button(obj_id, varname, label, x, y, w=48.0, h=14.0, color_rgb=COL_FILT):
    return {
        "box": {
            "activebgcolor": [0.10, 0.12, 0.15, 1.0],
            "activebgoncolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "activetextcolor": [0.72, 0.76, 0.82, 1.0],
            "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
            "annotation": f"Expand or collapse the {label} section to shrink device width.",
            "annotation_name": f"Show {label}",
            "bordercolor": [color_rgb[0], color_rgb[1], color_rgb[2], 0.85],
            "fontsize": 8.0,
            "id": obj_id,
            "maxclass": "live.text",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [float(x), 155.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {
                "valueof": {
                    "parameter_annotation_name": f"Show {label}",
                    "parameter_enum": ["Hide", "Show"],
                    "parameter_initial": [1],
                    "parameter_initial_enable": 1,
                    "parameter_linknames": 1,
                    "parameter_longname": varname,
                    "parameter_mmax": 1,
                    "parameter_shortname": label,
                    "parameter_type": 2,
                }
            },
            "text": label,
            "texton": label,
            "varname": varname,
        }
    }


def make_label(obj_id, text, x, y, w, h=12.0, size=8.0, color=(0.64, 0.72, 0.80), bold=True, align=0):
    return {
        "box": {
            "fontface": 1 if bold else 0,
            "fontname": "Arial Bold" if bold else "Arial",
            "fontsize": float(size),
            "id": obj_id,
            "maxclass": "live.comment",
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 15.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "text": text,
            "textcolor": [color[0], color[1], color[2], 1.0],
            "textjustification": align,
        }
    }


def make_panel(obj_id, x, y, w, h, bg=(0.095, 0.108, 0.128), border=(0.22, 0.27, 0.34), rounded=6):
    return {
        "box": {
            "angle": 270.0,
            "background": 1,
            "bgcolor": [bg[0], bg[1], bg[2], 1.0],
            "border": 1,
            "bordercolor": [border[0], border[1], border[2], 1.0],
            "grad1": [bg[0], bg[1], bg[2], 1.0],
            "grad2": [bg[0] * 0.86, bg[1] * 0.86, bg[2] * 0.86, 1.0],
            "id": obj_id,
            "maxclass": "panel",
            "mode": 0,
            "numinlets": 1,
            "numoutlets": 0,
            "patching_rect": [float(x), 10.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "proportion": 0.39,
            "rounded": rounded,
        }
    }


def make_drop_zone(x, y, w=68.0, h=14.0):
    return {
        "box": {
            "bordercolor": [0.28, 0.78, 0.94, 0.85],
            "fontsize": 8.0,
            "id": "obj-drop",
            "legend": "Drop Audio",
            "maxclass": "live.drop",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 0,
            "patching_rect": [float(x), 65.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "textcolor": [0.84, 0.92, 0.98, 1.0],
        }
    }


# ============================================================================
# 3 UI Layout Variants ("standard", "compact", "expanded")
# ============================================================================

def build_variant_layout(variant="standard"):
    """
    Constructs the presentation layout for one of the 3 size variations:
      - "standard" (720 x 169 px; 568 / 588 / 436 px with Filt/Amp, Mod/Uni, or both collapsed)
      - "compact"  (622 x 169 px; 486 / 504 / 368 px)
      - "expanded" (788 x 169 px; 624 / 640 / 476 px)
    Returns (dev_w, viz_rect, ui_boxes, panels, filt_group_ids, mod_group_ids, width_expr)
    """
    if variant == "compact":
        left_w = 248.0
        play_w = 104.0
        filt_w = 132.0
        mod_w  = 114.0
    elif variant == "expanded":
        left_w = 336.0
        play_w = 124.0
        filt_w = 160.0
        mod_w  = 144.0
    else:
        left_w = 304.0
        play_w = 116.0
        filt_w = 148.0
        mod_w  = 128.0

    left_x = 6.0
    play_x = left_x + left_w + 4.0
    filt_x = play_x + play_w + 4.0
    mod_x  = filt_x + filt_w + 4.0
    dev_w  = mod_x + mod_w + 6.0

    base_min_w = int(round(play_x + play_w + 6.0))
    filt_step_w = int(round(filt_w + 4.0))
    mod_step_w = int(round(mod_w + 4.0))
    width_expr = f"expr {base_min_w} + $i1 * {filt_step_w} + $i2 * {mod_step_w}"

    viz_rect = [left_x + 4.0, 25.0, left_w - 8.0, 136.0]

    # --- Panel 1: Left Header + Waveform/Grain/Slice v8ui Canvas ---
    drop_x = left_x + 92.0
    filt_btn_x = left_x + left_w - 98.0
    mod_btn_x = left_x + left_w - 48.0
    drop_w = max(48.0, filt_btn_x - drop_x - 4.0)

    ui_boxes = [
        make_label("obj-title", "Better Sampler", left_x + 4, 7, 86, 15, size=10.0, color=(0.94, 0.97, 1.0)),
        make_drop_zone(drop_x, 7, w=drop_w, h=14.0),
        make_collapse_button("obj-toggle-filt", "ShowFilterAmp", "Filt/Amp", filt_btn_x, 7, 46, 14, color_rgb=COL_FILT),
        make_collapse_button("obj-toggle-mod",  "ShowModUni",    "Mod/Uni",  mod_btn_x,  7, 44, 14, color_rgb=COL_MOD),
    ]

    #Hidden/synced mode parameter widget (kept off-canvas in presentation or in Play panel)
    # --- Panel 2: PLAYBACK / ENGINE Strip (Always Visible) ---
    p_in = play_x + 4.0
    p_col_w = (play_w - 12.0) * 0.5

    if variant == "compact":
        # Compact Attempt: Zero-Dial Linear Value-Bar Matrix in PLAY / ENGINE
        ui_boxes.extend([
            make_label("obj-hdr-play", "PLAY / ENGINE", p_in, 7, play_w - 8, 13, size=8.5, color=COL_PLAY),
            make_enum_slider("mode", p_in, 22, p_col_w, 14, color_rgb=COL_PLAY),
            make_toggle("freeze", p_in + p_col_w + 4, 22, p_col_w, 14, color_rgb=COL_GRN, text_off="Freeze", text_on="FREEZE"),

            make_label("obj-lbl-pit", "Pitch", p_in, 40, p_col_w, 10, size=7.5, color=COL_PLAY),
            make_label("obj-lbl-pos", "Pos",   p_in + p_col_w + 4, 40, p_col_w, 10, size=7.5, color=COL_PLAY),
            make_numbox("pitch_st", p_in, 51, p_col_w, 15, color_rgb=COL_PLAY, appearance=3),
            make_numbox("play_pos", p_in + p_col_w + 4, 51, p_col_w, 15, color_rgb=COL_PLAY, appearance=2),

            make_label("obj-lbl-fine", "Fine", p_in, 72, p_col_w, 10, size=7.5, color=COL_PLAY),
            make_label("obj-lbl-root", "Root", p_in + p_col_w + 4, 72, p_col_w, 10, size=7.5, color=COL_PLAY),
            make_numbox("fine_cents", p_in, 83, p_col_w, 14, color_rgb=COL_PLAY, appearance=3),
            make_numbox("root_note",  p_in + p_col_w + 4, 83, p_col_w, 14, color_rgb=COL_PLAY, appearance=0),

            make_label("obj-lbl-grn", "Grain", p_in, 104, p_col_w, 10, size=7.5, color=COL_GRN),
            make_label("obj-lbl-mot", "Motion", p_in + p_col_w + 4, 104, p_col_w, 10, size=7.5, color=COL_GRN),
            make_numbox("grain_size",   p_in, 115, p_col_w, 14, color_rgb=COL_GRN, appearance=2),
            make_numbox("grain_motion", p_in + p_col_w + 4, 115, p_col_w, 14, color_rgb=COL_GRN, appearance=2),

            make_label("obj-lbl-spr", "Spray", p_in, 135, p_col_w, 10, size=7.5, color=COL_GRN),
            make_label("obj-lbl-fmt", "Formant", p_in + p_col_w + 4, 135, p_col_w, 10, size=7.5, color=COL_GRN),
            make_numbox("grain_spray", p_in, 146, p_col_w, 14, color_rgb=COL_GRN, appearance=2),
            make_numbox("formant",     p_in + p_col_w + 4, 146, p_col_w, 14, color_rgb=COL_GRN, appearance=3),
        ])
    else:
        # Standard & Expanded Attempts: Hero Rotary Dials + Precision Sliders
        ui_boxes.extend([
            make_label("obj-hdr-play", "PLAY / ENGINE", p_in, 7, play_w - 8, 13, size=8.5, color=COL_PLAY),
            make_enum_slider("mode", p_in, 22, p_col_w, 14, color_rgb=COL_PLAY),
            make_toggle("freeze", p_in + p_col_w + 4, 22, p_col_w, 14, color_rgb=COL_GRN, text_off="Freeze", text_on="FREEZE"),

            make_dial("pitch_st", p_in, 40, p_col_w, 44, color_rgb=COL_PLAY),
            make_dial("play_pos", p_in + p_col_w + 4, 40, p_col_w, 44, color_rgb=COL_PLAY),

            make_label("obj-lbl-fine", "Fine", p_in, 85, p_col_w, 10, size=7.5, color=COL_PLAY),
            make_label("obj-lbl-root", "Root", p_in + p_col_w + 4, 85, p_col_w, 10, size=7.5, color=COL_PLAY),
            make_numbox("fine_cents", p_in, 96, p_col_w, 14, color_rgb=COL_PLAY, appearance=3),
            make_numbox("root_note",  p_in + p_col_w + 4, 96, p_col_w, 14, color_rgb=COL_PLAY, appearance=0),

            make_label("obj-lbl-grn", "Grain", p_in, 112, p_col_w, 10, size=7.5, color=COL_GRN),
            make_label("obj-lbl-mot", "Motion", p_in + p_col_w + 4, 112, p_col_w, 10, size=7.5, color=COL_GRN),
            make_numbox("grain_size",   p_in, 123, p_col_w, 14, color_rgb=COL_GRN, appearance=2),
            make_numbox("grain_motion", p_in + p_col_w + 4, 123, p_col_w, 14, color_rgb=COL_GRN, appearance=2),

            make_label("obj-lbl-spr", "Spray", p_in, 138, p_col_w, 10, size=7.5, color=COL_GRN),
            make_label("obj-lbl-fmt", "Formant", p_in + p_col_w + 4, 138, p_col_w, 10, size=7.5, color=COL_GRN),
            make_numbox("grain_spray", p_in, 149, p_col_w, 13, color_rgb=COL_GRN, appearance=2),
            make_numbox("formant",     p_in + p_col_w + 4, 149, p_col_w, 13, color_rgb=COL_GRN, appearance=3),
        ])

    # Non-presentation synced backing boxes for waveform region parameters so Ableton can automate them
    for hidden_key in ("samp_start", "samp_end", "loop_start", "loop_end", "loop_xfade", "menv_pitch", "menv_pos", "vel_sens"):
        hb = make_numbox(hidden_key, 20.0, 520.0, 44.0, 14.0, color_rgb=COL_PLAY, appearance=0)
        hb["box"]["presentation"] = 0
        ui_boxes.append(hb)

    # --- Panel 3: FILTER & AMP/MOD ENVELOPES (Collapsible via `Filt/Amp` button) ---
    f_in = filt_x + 4.0
    f_col_w = (filt_w - 12.0) * 0.5
    f_qtr_w = (filt_w - 14.0) * 0.25
    adsr_fs = 7.5 if f_qtr_w < 36.0 else 8.5  # "320 ms" needs ~30 px at 8.5 pt

    if variant == "compact":
        filt_top_controls = [
            make_label("obj-lbl-cut", "Cutoff", f_in, 46, f_col_w, 10, size=7.5, color=COL_FILT),
            make_label("obj-lbl-res", "Res",    f_in + f_col_w + 4, 46, f_col_w, 10, size=7.5, color=COL_FILT),
            make_numbox("filt_cutoff", f_in, 57, f_col_w, 18, color_rgb=COL_FILT, appearance=2),
            make_numbox("filt_res",    f_in + f_col_w + 4, 57, f_col_w, 18, color_rgb=COL_FILT, appearance=2),
        ]
    else:
        filt_top_controls = [
            make_dial("filt_cutoff", f_in, 39, f_col_w, 44, color_rgb=COL_FILT),
            make_dial("filt_res",    f_in + f_col_w + 4, 39, f_col_w, 44, color_rgb=COL_FILT),
        ]

    filt_boxes = [
        make_label("obj-hdr-filt", "FILTER & ENV", f_in, 7, filt_w - 42, 13, size=8.5, color=COL_FILT),
        make_toggle("filt_on", filt_x + filt_w - 34, 7, 28, 14, color_rgb=COL_FILT, text_off="Off", text_on="ON"),

        make_tab("filt_type", f_in, 23, f_col_w, 14, color_rgb=COL_FILT, num_rows=1, pictures=["highcut.svg", "bandpass.svg", "lowcut.svg"]),
        make_enum_slider("loop_mode", f_in + f_col_w + 4, 23, f_col_w, 14, color_rgb=COL_PLAY),
    ] + filt_top_controls + [
        make_label("obj-lbl-drv",  "Drive", f_in, 85, f_col_w, 11, size=7.5, color=COL_FILT),
        make_label("obj-lbl-fenv", "EnvAmt", f_in + f_col_w + 4, 85, f_col_w, 11, size=7.5, color=COL_FILT),
        make_numbox("filt_drive",   f_in, 96, f_col_w, 14, color_rgb=COL_FILT, appearance=2),
        make_numbox("filt_env_amt", f_in + f_col_w + 4, 96, f_col_w, 14, color_rgb=COL_FILT, appearance=3),

        # Amp ADSR row (y = 112..136)
        make_label("obj-lbl-amp-adsr", "AMP ADSR (A / D / S / R)", f_in, 111, filt_w - 8, 11, size=7.2, color=COL_AMP),
        make_numbox("atk_ms",  f_in,                       122, f_qtr_w, 13, color_rgb=COL_AMP, appearance=2, fontsize=adsr_fs),
        make_numbox("dec_ms",  f_in + (f_qtr_w + 2.0) * 1, 122, f_qtr_w, 13, color_rgb=COL_AMP, appearance=2, fontsize=adsr_fs),
        make_numbox("sus_lvl", f_in + (f_qtr_w + 2.0) * 2, 122, f_qtr_w, 13, color_rgb=COL_AMP, appearance=2, fontsize=adsr_fs),
        make_numbox("rel_ms",  f_in + (f_qtr_w + 2.0) * 3, 122, f_qtr_w, 13, color_rgb=COL_AMP, appearance=2, fontsize=adsr_fs),

        # Filter/Mod ADSR row (y = 137..161)
        make_label("obj-lbl-mod-adsr", "MOD ADSR (A / D / S / R)", f_in, 136, filt_w - 8, 11, size=7.2, color=COL_MOD),
        make_numbox("matk_ms",  f_in,                       147, f_qtr_w, 13, color_rgb=COL_MOD, appearance=2, fontsize=adsr_fs),
        make_numbox("mdec_ms",  f_in + (f_qtr_w + 2.0) * 1, 147, f_qtr_w, 13, color_rgb=COL_MOD, appearance=2, fontsize=adsr_fs),
        make_numbox("msus_lvl", f_in + (f_qtr_w + 2.0) * 2, 147, f_qtr_w, 13, color_rgb=COL_MOD, appearance=2, fontsize=adsr_fs),
        make_numbox("mrel_ms",  f_in + (f_qtr_w + 2.0) * 3, 147, f_qtr_w, 13, color_rgb=COL_MOD, appearance=2, fontsize=adsr_fs),
    ]
    ui_boxes.extend(filt_boxes)

    # --- Panel 4: LFO, UNISON & VOICING / MASTER (Collapsible via `Mod/Uni` button) ---
    m_in = mod_x + 4.0
    m_col_w = (mod_w - 12.0) * 0.5
    m_trd_w = (mod_w - 12.0) / 3.0

    mod_boxes = [
        make_label("obj-hdr-mod", "MOD & UNISON", m_in, 7, mod_w - 38, 13, size=8.5, color=COL_MOD),
        make_toggle("reverse", mod_x + mod_w - 34, 7, 28, 14, color_rgb=COL_UNI, text_off="Fwd", text_on="REV"),

        make_label("obj-lbl-lfor", "LFO Rate", m_in, 22, m_col_w, 11, size=7.5, color=COL_MOD),
        make_label("obj-lbl-lfos", "Shape",    m_in + m_col_w + 4, 22, m_col_w, 11, size=7.5, color=COL_MOD),
        make_numbox("lfo_rate",     m_in, 33, m_col_w, 14, color_rgb=COL_MOD, appearance=2),
        make_enum_slider("lfo_shape", m_in + m_col_w + 4, 33, m_col_w, 14, color_rgb=COL_MOD),

        make_label("obj-lbl-lfop", "L>Pitch", m_in, 49, m_trd_w, 11, size=7.0, color=COL_MOD),
        make_label("obj-lbl-lfof", "L>Filt",  m_in + m_trd_w + 2, 49, m_trd_w, 11, size=7.0, color=COL_MOD),
        make_label("obj-lbl-lfox", "L>Pos",   m_in + (m_trd_w + 2) * 2, 49, m_trd_w, 11, size=7.0, color=COL_MOD),
        make_numbox("lfo_pitch", m_in,                       60, m_trd_w, 13, color_rgb=COL_MOD, appearance=3),
        make_numbox("lfo_filt",  m_in + (m_trd_w + 2.0) * 1, 60, m_trd_w, 13, color_rgb=COL_MOD, appearance=3),
        make_numbox("lfo_pos",   m_in + (m_trd_w + 2.0) * 2, 60, m_trd_w, 13, color_rgb=COL_MOD, appearance=3),

        make_label("obj-lbl-uni", "Unison", m_in, 76, m_trd_w, 11, size=7.2, color=COL_UNI),
        make_label("obj-lbl-det", "Detune", m_in + m_trd_w + 2, 76, m_trd_w, 11, size=7.2, color=COL_UNI),
        make_label("obj-lbl-wid", "Width",  m_in + (m_trd_w + 2) * 2, 76, m_trd_w, 11, size=7.2, color=COL_UNI),
        make_numbox("unison_voices", m_in,                       87, m_trd_w, 13, color_rgb=COL_UNI, appearance=0),
        make_numbox("unison_detune", m_in + (m_trd_w + 2.0) * 1, 87, m_trd_w, 13, color_rgb=COL_UNI, appearance=2),
        make_numbox("unison_width",  m_in + (m_trd_w + 2.0) * 2, 87, m_trd_w, 13, color_rgb=COL_UNI, appearance=2),

        make_label("obj-lbl-poly", "Voices", m_in, 103, m_trd_w, 11, size=7.2, color=COL_UNI),
        make_label("obj-lbl-leg",  "Voicing", m_in + m_trd_w + 2, 103, m_trd_w, 11, size=7.2, color=COL_UNI),
        make_label("obj-lbl-gld",  "Glide",  m_in + (m_trd_w + 2) * 2, 103, m_trd_w, 11, size=7.2, color=COL_UNI),
        make_numbox("poly_voices", m_in,                       114, m_trd_w, 13, color_rgb=COL_UNI, appearance=0),
        make_toggle("mono_legato", m_in + (m_trd_w + 2.0) * 1, 114, m_trd_w, 13, color_rgb=COL_UNI, text_off="Poly", text_on="Leg"),
        make_numbox("glide_ms",    m_in + (m_trd_w + 2.0) * 2, 114, m_trd_w, 13, color_rgb=COL_UNI, appearance=2),

        make_label("obj-lbl-out", "Master Output Gain", m_in, 132, mod_w - 8, 11, size=7.5, color=COL_UNI),
        make_numbox("out_gain", m_in, 144, mod_w - 8, 15, color_rgb=COL_UNI, appearance=2),
    ]
    ui_boxes.extend(mod_boxes)

    panels = [
        make_panel("obj-pnl-left", left_x, 4, left_w, 161, bg=(0.09, 0.105, 0.125), border=(0.22, 0.28, 0.36)),
        make_panel("obj-pnl-play", play_x, 4, play_w, 161, bg=(0.095, 0.11, 0.135), border=(0.18, 0.48, 0.58)),
        make_panel("obj-pnl-filt", filt_x, 4, filt_w, 161, bg=(0.105, 0.105, 0.125), border=(0.52, 0.36, 0.18)),
        make_panel("obj-pnl-mod",  mod_x,  4, mod_w,  161, bg=(0.10, 0.10, 0.13),   border=(0.42, 0.26, 0.56)),
    ]

    filt_group_ids = [b["box"]["id"] for b in filt_boxes] + ["obj-pnl-filt"]
    mod_group_ids  = [b["box"]["id"] for b in mod_boxes] + ["obj-pnl-mod"]

    return dev_w, viz_rect, ui_boxes, panels, filt_group_ids, mod_group_ids, width_expr


def build_patcher(variant="standard"):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    dev_w, viz_rect, ui_boxes, panels, filt_group_ids, mod_group_ids, width_expr = build_variant_layout(variant)

    mod_set = set(mod_group_ids)
    mod_base_rects = {}
    for b in ui_boxes + panels:
        bid = b["box"]["id"]
        if bid in mod_set and "presentation_rect" in b["box"]:
            mod_base_rects[bid] = [float(v) for v in b["box"]["presentation_rect"]]

    combined_ui_js = (
        config_js
        + f'\n\nvar DEFAULT_UI_VARIANT = "{variant}";\n'
        + f"var MOD_PANEL_BASE_RECTS = {json.dumps(mod_base_rects)};\n"
        + ui_js
        + f'\nuiVariant = "{variant}";\n'
    )

    dsp_boxes = [
        # Audio I/O (pass-through + synth output sum so device works in Instrument or Audio track chains)
        {
            "box": {
                "id": "obj-plugin",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [30.0, 340.0, 52.0, 20.0],
                "text": "plugin~",
            }
        },
        {
            "box": {
                "id": "obj-plugout",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [30.0, 510.0, 58.0, 20.0],
                "text": "plugout~",
            }
        },
        # MIDI Input -> midiparse -> note/velocity to v8ui voice allocator
        {
            "box": {
                "id": "obj-midiin",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [30.0, 555.0, 46.0, 20.0],
                "text": "midiin",
            }
        },
        {
            "box": {
                "id": "obj-midiparse",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 7,
                "outlettype": ["", "", "", "int", "int", "", "int"],
                "patching_rect": [30.0, 582.0, 82.0, 20.0],
                "text": "midiparse",
            }
        },
        {
            "box": {
                "id": "obj-prep-midi",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 610.0, 108.0, 20.0],
                "text": "prepend midi_note",
            }
        },
        # GenExpr 16-Voice Polyphonic + Unison DSP Core
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
                "patching_rect": [30.0, 405.0, 320.0, 85.0],
                "varname": "better_sampler_dsp",
            }
        },
        # 3 Instance-Isolated Buffers (#0-bsamp, #0-bsvoices, #0-bsscope)
        {
            "box": {
                "id": "obj-buf-samp",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [420.0, 330.0, 220.0, 20.0],
                "text": "buffer~ #0-bsamp 1000 2",
            }
        },
        {
            "box": {
                "id": "obj-buf-voices",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [420.0, 358.0, 225.0, 20.0],
                "text": "buffer~ #0-bsvoices @samps 128",
            }
        },
        {
            "box": {
                "id": "obj-buf-scope",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [420.0, 386.0, 220.0, 20.0],
                "text": "buffer~ #0-bsscope @samps 64",
            }
        },
        # Sample file loader wiring (live.drop -> prepend replace -> buffer~ #0-bsamp -> bang -> v8ui)
        {
            "box": {
                "id": "obj-prep-replace",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [660.0, 330.0, 102.0, 20.0],
                "text": "prepend replace",
            }
        },
        {
            "box": {
                "id": "obj-prep-loaded",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [660.0, 358.0, 130.0, 20.0],
                "text": "prepend sample_loaded",
            }
        },
        # Loadbang buffer binding (rule #8: bind GenExpr Buffer varName with no `set` prefix)
        {
            "box": {
                "id": "obj-loadbang",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [420.0, 420.0, 58.0, 20.0],
                "text": "loadbang",
            }
        },
        {
            "box": {
                "id": "obj-msg-gen-buf",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [420.0, 450.0, 310.0, 20.0],
                "text": "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope",
            }
        },
        {
            "box": {
                "id": "obj-msg-ui-buf",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [420.0, 480.0, 290.0, 20.0],
                "text": "setbuffers #0-bsamp #0-bsvoices #0-bsscope",
            }
        },
        # Interactive v8ui Waveform / Loop / Slice / Envelope Canvas
        {
            "box": {
                "border": 0,
                "embed": 1,
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "parameter_enable": 1,
                "patching_rect": [15.0, 45.0, viz_rect[2], viz_rect[3]],
                "presentation": 1,
                "presentation_rect": [float(v) for v in viz_rect],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_initial": [1, 0, 0, 10000, 1, 1500, 8500, 500, 0, 0, 8, 0, 1250, 2500, 3750, 5000, 6250, 7500, 8750],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 1,
                        "parameter_longname": "SamplerStateData",
                        "parameter_shortname": "SamplerState",
                        "parameter_type": 3,
                    }
                },
                "textfile": {
                    "text": combined_ui_js,
                    "filename": "none",
                    "flags": 0,
                    "embed": 1,
                    "autowatch": 1,
                },
                "varname": "SamplerStateData",
            }
        },
        # Route messages emitted from v8ui
        {
            "box": {
                "id": "obj-route-viz",
                "maxclass": "newobj",
                "numinlets": 6,
                "numoutlets": 6,
                "outlettype": ["", "", "", "", "", ""],
                "patching_rect": [160.0, 555.0, 310.0, 20.0],
                "text": "route param root_note load_sample patcher_cmd setwidth_cmd",
            }
        },
        {
            "box": {
                "id": "obj-route-param",
                "maxclass": "newobj",
                "numinlets": 8,
                "numoutlets": 8,
                "outlettype": ["", "", "", "", "", "", "", ""],
                "patching_rect": [160.0, 585.0, 380.0, 20.0],
                "text": "route mode samp_start samp_end loop_start loop_end loop_xfade play_pos",
            }
        },
        # Dynamic Device Width Shrinking (live.thisdevice + thispatcher + pak/expr)
        {
            "box": {
                "id": "obj-pak-vis",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [780.0, 520.0, 56.0, 20.0],
                "text": "pak 1 1",
            }
        },
        {
            "box": {
                "id": "obj-expr-width",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [780.0, 548.0, 210.0, 20.0],
                "text": width_expr,
            }
        },
        {
            "box": {
                "id": "obj-prep-setwidth",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [780.0, 576.0, 102.0, 20.0],
                "text": "prepend setwidth",
            }
        },
        {
            "box": {
                "id": "obj-thisdevice",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["bang", "int", "int"],
                "patching_rect": [780.0, 604.0, 82.0, 20.0],
                "text": "live.thisdevice",
            }
        },
        {
            "box": {
                "id": "obj-thispatcher",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "patching_rect": [900.0, 604.0, 68.0, 20.0],
                "save": ["#N", "thispatcher", ";", "#Q", "end", ";"],
                "text": "thispatcher",
            }
        },
        {
            "box": {
                "id": "obj-inv-filt",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [780.0, 450.0, 38.0, 20.0],
                "text": "== 0",
            }
        },
        {
            "box": {
                "id": "obj-prep-hide-filt",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [780.0, 478.0, 92.0, 20.0],
                "text": "prepend hidden",
            }
        },
        {
            "box": {
                "id": "obj-inv-mod",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [900.0, 450.0, 38.0, 20.0],
                "text": "== 0",
            }
        },
        {
            "box": {
                "id": "obj-prep-hide-mod",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [900.0, 478.0, 92.0, 20.0],
                "text": "prepend hidden",
            }
        },
        {
            "box": {
                "id": "obj-prep-pfilt",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [780.0, 422.0, 120.0, 20.0],
                "text": "prepend set_panel_filt",
            }
        },
        {
            "box": {
                "id": "obj-prep-pmod",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [910.0, 422.0, 124.0, 20.0],
                "text": "prepend set_panel_mod",
            }
        },
    ]

    lines = [
        # Audio & GenExpr I/O
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}},
        {"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}},

        # MIDI Input -> midiparse -> v8ui voice allocator
        {"patchline": {"source": ["obj-midiin", 0], "destination": ["obj-midiparse", 0]}},
        {"patchline": {"source": ["obj-midiparse", 0], "destination": ["obj-prep-midi", 0]}},
        {"patchline": {"source": ["obj-prep-midi", 0], "destination": ["obj-viz", 0]}},

        # Sample Drop / Replace -> buffer~ #0-bsamp -> v8ui waveform refresh
        {"patchline": {"source": ["obj-drop", 0], "destination": ["obj-prep-replace", 0], "order": 1}},
        {"patchline": {"source": ["obj-drop", 0], "destination": ["obj-prep-loaded", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-replace", 0], "destination": ["obj-buf-samp", 0]}},
        {"patchline": {"source": ["obj-buf-samp", 1], "destination": ["obj-prep-loaded", 0]}},
        {"patchline": {"source": ["obj-prep-loaded", 0], "destination": ["obj-viz", 0]}},

        # Loadbang buffer binding
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-gen-buf", 0], "order": 1}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-ui-buf", 0], "order": 0}},
        {"patchline": {"source": ["obj-msg-gen-buf", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-msg-ui-buf", 0], "destination": ["obj-viz", 0]}},

        # v8ui outlet routing
        {"patchline": {"source": ["obj-viz", 0], "destination": ["obj-route-viz", 0]}},
        {"patchline": {"source": ["obj-route-viz", 0], "destination": ["obj-route-param", 0]}},
        {"patchline": {"source": ["obj-route-viz", 1], "destination": ["obj-ctrl-root_note", 0]}},
        {"patchline": {"source": ["obj-route-viz", 2], "destination": ["obj-prep-replace", 0]}},
        {"patchline": {"source": ["obj-route-viz", 3], "destination": ["obj-thispatcher", 0]}},
        {"patchline": {"source": ["obj-route-viz", 4], "destination": ["obj-prep-setwidth", 0]}},

        {"patchline": {"source": ["obj-route-param", 0], "destination": ["obj-ctrl-mode", 0]}},
        {"patchline": {"source": ["obj-route-param", 1], "destination": ["obj-ctrl-samp_start", 0]}},
        {"patchline": {"source": ["obj-route-param", 2], "destination": ["obj-ctrl-samp_end", 0]}},
        {"patchline": {"source": ["obj-route-param", 3], "destination": ["obj-ctrl-loop_start", 0]}},
        {"patchline": {"source": ["obj-route-param", 4], "destination": ["obj-ctrl-loop_end", 0]}},
        {"patchline": {"source": ["obj-route-param", 5], "destination": ["obj-ctrl-loop_xfade", 0]}},
        {"patchline": {"source": ["obj-route-param", 6], "destination": ["obj-ctrl-play_pos", 0]}},

        # Expand / Collapse buttons -> hide panels & resize device width via live.thisdevice
        {"patchline": {"source": ["obj-toggle-filt", 0], "destination": ["obj-inv-filt", 0], "order": 2}},
        {"patchline": {"source": ["obj-toggle-filt", 0], "destination": ["obj-pak-vis", 0], "order": 1}},
        {"patchline": {"source": ["obj-toggle-filt", 0], "destination": ["obj-prep-pfilt", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-pfilt", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-inv-filt", 0], "destination": ["obj-prep-hide-filt", 0]}},

        {"patchline": {"source": ["obj-toggle-mod", 0], "destination": ["obj-inv-mod", 0], "order": 2}},
        {"patchline": {"source": ["obj-toggle-mod", 0], "destination": ["obj-pak-vis", 1], "order": 1}},
        {"patchline": {"source": ["obj-toggle-mod", 0], "destination": ["obj-prep-pmod", 0], "order": 0}},
        {"patchline": {"source": ["obj-prep-pmod", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-inv-mod", 0], "destination": ["obj-prep-hide-mod", 0]}},

        {"patchline": {"source": ["obj-pak-vis", 0], "destination": ["obj-expr-width", 0]}},
        {"patchline": {"source": ["obj-expr-width", 0], "destination": ["obj-prep-setwidth", 0]}},
        {"patchline": {"source": ["obj-prep-setwidth", 0], "destination": ["obj-thisdevice", 0]}},
    ]

    for gid in filt_group_ids:
        lines.append({"patchline": {"source": ["obj-prep-hide-filt", 0], "destination": [gid, 0]}})
    for gid in mod_group_ids:
        lines.append({"patchline": {"source": ["obj-prep-hide-mod", 0], "destination": [gid, 0]}})

    # Wire every continuous parameter into obj-gen and obj-viz
    px = 60.0
    for key, spec in PARAM_SPECS.items():
        _long, _short, _lo, _hi, _init, _unit, _exp, gen_param, scale_factor, ui_setter, _help = spec
        ctrl_id = f"obj-ctrl-{key}"

        if gen_param:
            prep_id = f"obj-prep-{key}"
            src_for_prep = ctrl_id
            if abs(scale_factor - 1.0) > 1e-6:
                scale_id = f"obj-scale-{key}"
                dsp_boxes.append({
                    "box": {
                        "id": scale_id,
                        "maxclass": "newobj",
                        "numinlets": 2,
                        "numoutlets": 1,
                        "outlettype": ["float"],
                        "patching_rect": [px, 645.0, 62.0, 20.0],
                        "text": f"* {scale_factor}",
                    }
                })
                lines.append({"patchline": {"source": [ctrl_id, 0], "destination": [scale_id, 0]}})
                src_for_prep = scale_id

            dsp_boxes.append({
                "box": {
                    "id": prep_id,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [px, 672.0, 118.0, 20.0],
                    "text": f"prepend {gen_param}",
                }
            })
            lines.append({"patchline": {"source": [src_for_prep, 0], "destination": [prep_id, 0]}})
            lines.append({"patchline": {"source": [prep_id, 0], "destination": ["obj-gen", 0]}})

        if ui_setter:
            ui_prep_id = f"obj-uiprep-{key}"
            dsp_boxes.append({
                "box": {
                    "id": ui_prep_id,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [px, 700.0, 125.0, 20.0],
                    "text": f"prepend {ui_setter}",
                }
            })
            lines.append({"patchline": {"source": [ctrl_id, 0], "destination": [ui_prep_id, 0]}})
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz", 0]}})

        px += 85.0

    # Wire every enum / toggle parameter into obj-gen and obj-viz
    for key, spec in ENUM_SPECS.items():
        _long, _short, _enums, _init, gen_param, ui_setter, _help = spec
        ctrl_id = f"obj-ctrl-{key}"

        if gen_param:
            prep_id = f"obj-prep-{key}"
            dsp_boxes.append({
                "box": {
                    "id": prep_id,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [px, 672.0, 118.0, 20.0],
                    "text": f"prepend {gen_param}",
                }
            })
            lines.append({"patchline": {"source": [ctrl_id, 0], "destination": [prep_id, 0]}})
            lines.append({"patchline": {"source": [prep_id, 0], "destination": ["obj-gen", 0]}})

        if ui_setter:
            ui_prep_id = f"obj-uiprep-{key}"
            dsp_boxes.append({
                "box": {
                    "id": ui_prep_id,
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [px, 700.0, 125.0, 20.0],
                    "text": f"prepend {ui_setter}",
                }
            })
            lines.append({"patchline": {"source": [ctrl_id, 0], "destination": [ui_prep_id, 0]}})
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz", 0]}})

        px += 85.0

    # Decorative background panels MUST appear at the end of `boxes` with `"background": 1` (rule #8)
    all_boxes = dsp_boxes + ui_boxes + panels

    return {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, float(dev_w), float(DEVICE_H)],
            "openrect": [0.0, 0.0, float(dev_w), float(DEVICE_H)],
            "devicewidth": float(dev_w),
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontname": "Arial",
            "gridonopen": 1,
            "gridsize": [15.0, 15.0],
            "gridsnaponopen": 1,
            "objectsnaponopen": 1,
            "statusbarvisible": 2,
            "toolbarvisible": 1,
            "boxes": all_boxes,
            "lines": lines,
            "parameters": {},
            "dependency_cache": [],
            "autosave": 0,
        }
    }


def write_amxd(patcher_dict, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    payload = (json.dumps(patcher_dict, indent=2) + "\n").encode("utf-8")
    # Max Instrument header ("iiii") so Ableton loads Better Sampler on MIDI Instrument tracks
    header = (
        b"ampf\x04\x00\x00\x00"
        + b"iiii"
        + b"meta\x04\x00\x00\x00\x00\x00\x00\x00"
        + b"ptch"
        + struct.pack("<I", len(payload))
    )
    with open(out_path, "wb") as f:
        f.write(header + payload)
    w = int(patcher_dict["patcher"]["openrect"][2])
    h = int(patcher_dict["patcher"]["openrect"][3])
    print(f"Built {out_path} ({w}x{h} px, {len(payload)} bytes JSON)")


def main():
    arg_variant = sys.argv[1].lower() if len(sys.argv) > 1 else "standard"
    if arg_variant not in ("standard", "compact", "expanded"):
        arg_variant = "standard"

    devices_dir = os.path.join(ROOT_DIR, "devices")
    # Always build all 3 size variations so the user can compare them directly
    variants = {
        "standard": os.path.join(devices_dir, "Better Sampler Standard.amxd"),
        "compact":  os.path.join(devices_dir, "Better Sampler Compact.amxd"),
        "expanded": os.path.join(devices_dir, "Better Sampler Expanded.amxd"),
    }
    for v_name, v_path in variants.items():
        write_amxd(build_patcher(v_name), v_path)

    # Write main `devices/Better Sampler.amxd` using the selected variant (default: "standard")
    main_path = os.path.join(devices_dir, "Better Sampler.amxd")
    write_amxd(build_patcher(arg_variant), main_path)


if __name__ == "__main__":
    main()
