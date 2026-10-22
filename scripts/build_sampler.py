#!/usr/bin/env python3
"""
Build Better Sampler (.amxd) — Bitwig-Style Multi-Engine Polyphonic Sampler for Ableton Live 12.

Features:
  - 4 Playback Engines: REPITCH, CYCLES, TEXTURES (Granular), and SLICE + Playhead FREEZE.
  - Up to 16-Voice Polyphony + up to 8-Voice Stereo Unison per voice + Mono / Legato / Glide.
  - Multimode Chamberlin SVF Filter (LP / BP / HP) with Pre-Drive, Resonance & Bipolar Envelope Mod.
  - Dual ADSR Envelopes (Amp ADSR + Filter/Mod ADSR) + Internal LFO (Sine, Triangle, Saw, S&H).
  - Bitwig-style face (600 x 169 px): two v8ui canvases draw every control (src/sampler_face.js);
    each parameter is a hidden, automatable live.* object that the face drives and mirrors.
  - Writes `devices/Better Sampler.amxd`.
"""

import hashlib
import json
import os
import struct
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "sampler_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "sampler_ui.js")
FACE_PATH = os.path.join(ROOT_DIR, "src", "sampler_face.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "sampler_core.genexpr")

DEVICE_H = 169.0
DEVICE_W = 600.0
MAIN_VIZ_RECT = [0.0, 0.0, 528.0, 169.0]
SIDE_VIZ_RECT = [531.0, 3.0, 66.0, 163.0]
# Inspector panel to the right of the 600 px face; live.thisdevice widens the device by 160 px to show it
INSPECTOR_W = 160.0
INSPECTOR_VIZ_RECT = [600.0, 0.0, INSPECTOR_W, 169.0]
# Waveform area inside obj-viz (sampler_face.js paintSamplePanel: sx + 4, sy + 17, sw - 8, 66)
WAVE_DROP_RECT = [63.0, 20.0, 458.0, 66.0]

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
        "Frozen playhead position (0 to 100%); only applies while Freeze is on.",
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
        "ModEnv Pitch", "MEnvP", -100.0, 100.0, 0.0, 5, 1.0, "menv_pitch", 0.01, "set_menv_pitch",
        "Bipolar Mod Envelope depth on pitch.",
    ),
    "menv_pos": (
        "ModEnv Pos", "MEnvPos", -100.0, 100.0, 0.0, 5, 1.0, "menv_pos", 0.01, "set_menv_pos",
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
        "Velocity Sens", "Vel", 0.0, 100.0, 70.0, 5, 1.0, "vel_sens", 0.01, "set_vel_sens",
        "MIDI note velocity sensitivity (0 to 100%).",
    ),
    "out_gain": (
        "Output Gain", "Gain", -36.0, 18.0, 0.0, 4, 1.0, "out_gain", 1.0, "set_out_gain",
        "Master output level in dB (-36 to +18 dB).",
    ),
    # Repitch characters (Analog: Crunch / Tape, Digital: Bits / Color)
    "rp_dist": ("Repitch Distortion", "Dist", 0.0, 100.0, 0.0, 5, 1.0, "rp_dist", 0.01, "set_rp_dist",
                "Analog: tailored saturation with harmonic generation. Digital: bit reduction."),
    "rp_color": ("Repitch Color", "Color", -100.0, 100.0, 0.0, 5, 1.0, "rp_color", 0.01, "set_rp_color",
                 "Analog: stereo tape colour (+ brighter, - warmer). Digital: sample-rate reduction (+ aliasing, - band-limited)."),
    # Spectral (Pure: Formant / Shift %, Reharm: Bend / Quantize / %)
    "sp_shift": ("Formant Shift Amount", "FmtAmt", 1.0, 122.0, 100.0, 5, 1.0, "sp_shift", 0.01, "set_sp_shift",
                 "Spectral Pure: amount of formant shift, as a crossfade-type control."),
    "sp_bend": ("Harmonic Bend", "Bend", -24.0, 24.0, 0.0, 7, 1.0, "sp_bend", 1.0, "set_sp_bend",
                "Spectral Reharm: pitch shift applied to the harmonics; the fundamental is not shifted."),
    "sp_quant_amt": ("Quantize Amount", "QAmt", 1.0, 100.0, 100.0, 5, 1.0, "sp_quant_amt", 0.01, "set_sp_quant_amt",
                     "Spectral Reharm: how strongly harmonic quantization is applied."),
    "sp_dispersion": ("Phase Dispersion", "Disp", 0.0, 100.0, 66.7, 5, 1.0, "sp_dispersion", 0.01, "set_sp_dispersion",
                      "Spectral: phase randomization at extreme stretch ratios, smoothing the sound."),
    # Cycles (Pulse: Width, Partials: Split / Fund., Phase: Mod / Harm.)
    "cy_width": ("Pulse Width", "PW", -100.0, 100.0, 0.0, 5, 1.0, "cy_width", 0.01, "set_cy_width",
                 "Cycles Pulse: pulse-width style shaping of the sound."),
    "cy_split": ("Harmonic Split", "Split", -100.0, 100.0, 0.0, 5, 1.0, "cy_split", 0.01, "set_cy_split",
                 "Cycles Partials: isolates odd (negative) or even (positive) harmonics."),
    "cy_fund": ("Fundamental Level", "Fund", 0.0, 100.0, 0.0, 5, 1.0, "cy_fund", 0.01, "set_cy_fund",
                "Cycles Partials: blends in a sine at the played pitch."),
    "cy_mod": ("Phase Mod Amount", "PMod", 0.0, 100.0, 0.0, 5, 1.0, "cy_mod", 0.01, "set_cy_mod",
               "Cycles Phase: modulation index of the carrier by the internal modulator."),
    "cy_harm": ("Modulator Harmonics", "Harm", -100.0, 100.0, 0.0, 5, 1.0, "cy_harm", 0.01, "set_cy_harm",
                "Cycles Phase: steps through tunings of the (dirty sine) modulator."),
    # Fragments granular
    "fr_env": ("Grain Envelope", "GrEnv", 0.0, 100.0, 50.0, 5, 1.0, "fr_env", 0.01, "set_fr_env",
               "Fragments: grain amplitude envelope shape (50% symmetric; extremes click on purpose)."),
    "fr_repeats": ("Grain Repeats", "Repeats", 1.0, 16.0, 1.0, 0, 1.0, "fr_repeats", 1.0, "set_fr_repeats",
                   "Fragments: number of times each grain is triggered."),
    "fr_density": ("Grain Density", "Density", 0.1, 100.0, 4.0, 1, 2.0, "fr_density", 1.0, "set_fr_density",
                   "Fragments: grains triggered within each grain-size time."),
    "fr_motion": ("Playhead Motion", "FMotion", 0.0, 800.0, 0.0, 5, 1.5, "fr_motion", 0.01, "set_fr_motion",
                  "Fragments: randomizes stereo pan and playhead position per grain and repeat."),
    "fr_max_grains": ("Max Grains", "MaxGr", 1.0, 256.0, 256.0, 0, 1.0, "fr_max_grains", 1.0, "set_fr_max_grains",
                      "Fragments: maximum grains per voice."),
    # Slicing (analysis runs in the face; gen only sees slice bounds)
    "slice_div": ("Slice Divisions", "Divs", 1.0, 64.0, 8.0, 0, 1.0, None, 1.0, "set_slice_div",
                  "Slice at Divisions: number of equal slices between start and end."),
    "slice_sens": ("Slice Sensitivity", "SlSens", 0.0, 100.0, 70.0, 5, 1.0, None, 1.0, "set_slice_sens",
                   "Slice at Onsets / Pitches: detection sensitivity."),
    "slice_from": ("Slice Root Key", "From", 0.0, 127.0, 36.0, 8, 1.0, None, 1.0, "set_slice_from",
                   "Sliced: MIDI key that plays the first slice."),
}

# Discrete enum / toggle parameters:
# key: (long_name, short_name, enums, initial, gen_param, ui_setter, help_text)
ENUM_SPECS = {
    "mode": (
        "Playback Mode", "Mode", ["Repitch", "Cycles", "Textures", "Spectral", "Fragments"], 0, "mode", "set_mode",
        "Play mode: Repitch, Cycles (wavetables), Textures (granular), Spectral (stretching), or Fragments (granular).",
    ),
    "sliced": (
        "Sliced", "Sliced", ["Single", "Sliced"], 0, "sliced", "set_sliced",
        "Single sampler (start and loop points) or Sliced (each key plays a slice).",
    ),
    "root_dyn": ("Analyzed Root Key", "RootDyn", ["Off", "On"], 0, "root_dyn", "set_root_dyn",
                 "Dynamic pitch analysis instead of a fixed root key: playback follows the sample's pitch curve so every part plays at the keyed note."),
    "rp_char": ("Repitch Character", "RpChar", ["Clean", "Analog", "Digital"], 0, "rp_char", "set_rp_char",
                "Repitch flavour: Clean tape machine, Analog warmth, or Digital polyphonic sample rates."),
    "rp_vsr": ("Variable Sample Rate", "VSR", ["Off", "On"], 0, "rp_vsr", "set_rp_vsr",
               "Digital: sample rate follows the voice's playback rate."),
    "rp_imaging": ("Digital Imaging Filter", "Imaging", ["Off", "On"], 1, "rp_imaging", "set_rp_imaging",
                   "Digital: DAC output filter follows the voice's sample rate."),
    "sp_char": ("Spectral Character", "SpChar", ["Pure", "Reharm"], 0, "sp_char", "set_sp_char",
                "Spectral: Pure clean stretching with formant shifts, or Reharm bending harmonics."),
    "sp_quant": ("Harmonic Quantize", "Quant", ["Off", "Octaves", "Key"], 0, "sp_quant", "set_sp_quant",
                 "Spectral Reharm: quantize harmonics to octaves or to the key."),
    "sp_onsets": ("Preserve Onsets", "Onsets", ["Off", "On"], 0, "sp_onsets", "set_sp_onsets",
                  "Spectral: passes onsets at original speed whatever the Speed."),
    "sp_formant_on": ("Formant Processing", "FmtOn", ["Off", "On"], 1, "sp_formant_on", "set_sp_formant_on",
                      "Spectral: enables formant processing."),
    "sp_quality": ("Spectral Quality", "Quality", ["Low", "Medium", "High"], 1, "sp_quality", "set_sp_quality",
                   "Spectral: quality of pitch and formant processing versus CPU and latency."),
    "sp_live": ("Live Performance Mode", "LiveMode", ["Off", "On"], 1, "sp_live", "set_sp_live",
                "Spectral: no latency but higher CPU at note on."),
    "sp_rel_formant": ("Relative Formant Shifts", "RelFmt", ["Off", "On"], 0, "sp_rel_formant", "set_sp_rel_formant",
                       "Spectral: formant shift follows the pitch."),
    "sp_key": ("Local Key", "Key", ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], 0, "sp_key", "set_sp_key",
               "Spectral Reharm (to Key): root of the scale."),
    "sp_scale": ("Local Scale", "Scale", ["Major", "Minor"], 0, "sp_scale", "set_sp_scale",
                 "Spectral Reharm (to Key): scale."),
    "cy_char": ("Cycles Character", "CyChar", ["Pulse", "Partials", "Phase"], 0, "cy_char", "set_cy_char",
                "Cycles: Pulse width, Partials (odd/even split), or Phase (PM/FM by a harmonic modulator)."),
    "cy_xfade": ("Crossfade Two Voices", "CyXf", ["Off", "On"], 0, "cy_xfade", "set_cy_xfade",
                 "Cycles: duophonic crossfade of two voices for a smoother sound."),
    "fr_sync": ("Sync Grains", "FrSync", ["Off", "On"], 0, "fr_sync", "set_fr_sync",
                "Fragments: grain size in beat time."),
    "fr_use_density": ("Use Grain Density", "UseDens", ["Off", "On"], 1, "fr_use_density", "set_fr_use_density",
                       "Fragments: grain count as a density relative to the grain size."),
    "fr_direction": ("Grain Direction", "FrDir", ["Sample", "Playhead", "Random", "Alternating"], 1, "fr_direction", "set_fr_direction",
                     "Fragments: playback direction of each grain."),
    "fr_latch": ("Latch Initial Rate", "Latch", ["Off", "On"], 1, "fr_latch", "set_fr_latch",
                 "Fragments: each grain keeps its speed and direction for its lifetime."),
    "fr_repeat_init": ("Repeat at Initial Position", "RptInit", ["Off", "On"], 0, "fr_repeat_init", "set_fr_repeat_init",
                       "Fragments: repeats start where the voice started (else where the last grain stopped)."),
    "fr_survive": ("Grains Survive Voice End", "Survive", ["Off", "On"], 0, "fr_survive", "set_fr_survive",
                   "Fragments: grains keep sounding past the voice's end."),
    "slice_at": ("Slice At", "SliceAt", ["Divisions", "Beats", "Onsets", "Pitches", "Manual"], 0, None, "set_slice_at",
                 "How slices are made: equal divisions, note intervals, transients, pitch changes, or by hand."),
    "slice_beat": ("Slice Beat", "SlBeat", ["1 bar", "1/2", "1/4", "1/4T", "1/8", "1/8T", "1/16", "1/16T", "1/32", "1/32T"], 6, None, "set_slice_beat",
                   "Slice at Beats: note interval."),
    "show_inspector": ("Show Inspector", "Inspector", ["Hide", "Show"], 0, None, "set_show_inspector",
                       "Shows the inspector panel (mode settings) to the right of the device."),
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
    "slice_play": (
        "Slice Playback", "SlcPlay", ["Slice End", "Sample End", "Loop", "Ping-Pong"], 0, "slice_play", "set_slice_play",
        "Sliced mode: play each slice to its end, on to the sample end, looping one-way, or ping-pong looping.",
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


# Every parameter the face can set through ["param", key, value]
FACE_KEYS = list(PARAM_SPECS) + list(ENUM_SPECS)


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
# Bitwig-style face layout
# ============================================================================

def hide_from_face(b, px, py):
    """Keep a live.* parameter off the presentation face (the v8ui face draws and drives it)."""
    box = b["box"]
    box["presentation"] = 0
    box.pop("presentation_rect", None)
    box["patching_rect"] = [float(px), float(py), box["patching_rect"][2], box["patching_rect"][3]]
    return b


def build_face_layout():
    """Returns (ui_boxes, panels): hidden live.* parameters, the drop zone, and the device background."""
    ui_boxes = []
    col = 0
    for key in PARAM_SPECS:
        ui_boxes.append(hide_from_face(make_numbox(key, 0, 0, 52.0, 15.0, appearance=0), 1100 + (col % 6) * 70, 40 + (col // 6) * 24))
        col += 1
    for key in ENUM_SPECS:
        ui_boxes.append(hide_from_face(make_tab(key, 0, 0, 64.0, 15.0), 1100 + (col % 6) * 70, 40 + (col // 6) * 24))
        col += 1

    panels = [
        make_panel("obj-pnl-bg", 0, 0, DEVICE_W + INSPECTOR_W, DEVICE_H, bg=(0.255, 0.255, 0.255), border=(0.255, 0.255, 0.255), rounded=0),
    ]
    return ui_boxes, panels


def face_params_json():
    """Ranges the face needs to map knob travel to parameter values (Live's exponent mapping)."""
    out = {}
    for key, spec in PARAM_SPECS.items():
        _long, _short, lo, hi, init, unit, exp, *_rest = spec
        out[key] = {"lo": lo, "hi": hi, "init": init, "exp": exp, "unit": unit}
    for key, spec in ENUM_SPECS.items():
        _long, _short, enums, init, *_rest = spec
        out[key] = {"lo": 0, "hi": len(enums) - 1, "init": init, "exp": 1.0, "unit": 9, "enums": enums}
    return json.dumps(out)


def gendsp_json(gen_code):
    """The gen patcher (in 1 / in 2 -> codebox -> out 1 / out 2) as .gendsp JSON text."""
    def b(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {"id": i, "maxclass": cls, "numinlets": ni, "numoutlets": no, "outlettype": [""] * no,
               "patching_rect": [float(x), float(y), 200.0, 22.0]}
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}
    patch = {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "dsp.gen",
        "rect": [50.0, 50.0, 600.0, 450.0],
        "boxes": [
            b("obj-in1", "in 1", 20, 20, 0, 1), b("obj-in2", "in 2", 120, 20, 0, 1),
            b("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
            b("obj-out1", "out 1", 20, 400, 1, 0), b("obj-out2", "out 2", 120, 400, 1, 0),
        ],
        "lines": [
            {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-code", 0]}},
            {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-code", 1]}},
            {"patchline": {"source": ["obj-code", 0], "destination": ["obj-out1", 0]}},
            {"patchline": {"source": ["obj-code", 1], "destination": ["obj-out2", 0]}},
        ],
    }}
    return json.dumps(patch)


def make_viz(obj_id, rect, script, region, py):
    b = {
        "border": 0,
        "embed": 1,
        "filename": "none",
        "id": obj_id,
        "maxclass": "v8ui",
        "numinlets": 1,
        "numoutlets": 1,
        "outlettype": [""],
        "parameter_enable": 0,
        "patching_rect": [15.0, float(py), rect[2], rect[3]],
        "presentation": 1,
        "presentation_rect": [float(v) for v in rect],
        "textfile": {"text": script, "filename": "none", "flags": 0, "embed": 1, "autowatch": 1},
        "varname": obj_id,
    }
    return {"box": b}


def build_patcher():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(FACE_PATH, "r", encoding="utf-8") as f:
        face_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()

    ui_boxes, panels = build_face_layout()
    dev_w = DEVICE_W

    gen_dsp_text = gendsp_json(gen_code)
    gen_dsp_hash = hashlib.sha1(gen_dsp_text.encode("utf-8")).hexdigest()[:12]

    def face_script(region):
        dsp = ""
        if region == "main":
            dsp = f"var GEN_DSP_TEXT = {json.dumps(gen_dsp_text)};\nvar GEN_DSP_HASH = \"{gen_dsp_hash}\";\n"
        return (
            config_js
            + f'\n\nvar FACE_REGION = "{region}";\n'
            + f"var FACE_PARAMS = {face_params_json()};\n"
            + dsp
            + ui_js
            + "\n"
            + face_js
        )

    main_viz = make_viz("obj-viz", MAIN_VIZ_RECT, face_script("main"), "main", 45.0)
    # The main face owns the saved editor state (regions, slices, sample path, envelope page)
    main_viz["box"]["parameter_enable"] = 1
    main_viz["box"]["saved_attribute_attributes"] = {
        "valueof": {
            "parameter_initial": [1, 0, 0, 10000, 1, 1500, 8500, 500, 0, 0, 8, 0, 1250, 2500, 3750, 5000, 6250, 7500, 8750],
            "parameter_initial_enable": 1,
            "parameter_invisible": 1,
            "parameter_longname": "SamplerStateData",
            "parameter_shortname": "SamplerState",
            "parameter_type": 3,
        }
    }
    main_viz["box"]["varname"] = "SamplerStateData"
    side_viz = make_viz("obj-viz-side", SIDE_VIZ_RECT, face_script("side"), "side", 230.0)

    # Bitwig-style drop onto the waveform: an invisible live.drop above obj-viz. ignoreclick lets
    # clicks and drags fall through to the v8ui below; only file drops land on it. It lights blue
    # (focusbordercolor) while a file is dragged over it.
    # In Live a live.drop only outputs in parameter mode (File type 4, as in Max's live.drop help).
    # Live then saves the path and replays it on load; the face ignores a replay of the sample it is
    # already restoring from SamplerStateData.
    wave_drop = make_drop_zone(*WAVE_DROP_RECT)
    wave_drop["box"].update({
        "id": "obj-drop-wave",
        "legend": "",
        "ignoreclick": 1,
        "bordercolor": [0.0, 0.0, 0.0, 0.0],
        "textcolor": [0.0, 0.0, 0.0, 0.0],
        "focusbordercolor": [0.36, 0.66, 1.0, 1.0],
        "patching_rect": [700.0, 65.0, 120.0, 20.0],
        "parameter_enable": 1,
        "saved_attribute_attributes": {
            "valueof": {
                "parameter_invisible": 1,
                "parameter_longname": "Sample File",
                "parameter_modmode": 0,
                "parameter_shortname": "Sample",
                "parameter_type": 4,
            }
        },
        "varname": "Sample File",
    })
    insp_viz = make_viz("obj-viz-insp", INSPECTOR_VIZ_RECT, face_script("inspector"), "inspector", 420.0)
    ui_boxes = ui_boxes + [main_viz, side_viz, insp_viz, wave_drop]

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
                "varname": "bs_plugin",
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
                "varname": "bs_plugout",
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
        # The gen~ DSP core is NOT in the device: the face writes it as a .gendsp file and creates
        # `gen~ @gen <file>` right after load (see loadDsp() in src/sampler_ui.js), so the GUI appears
        # before the gen compiles. Every gen-bound message goes through this pass-through hub.
        {
            "box": {
                "id": "obj-gen-in",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [30.0, 405.0, 60.0, 20.0],
                # An open gate passes every message unchanged (right inlet). `t a` cannot be the
                # source of a scripted patcher.connect(): the cord is silently not made.
                "text": "gate 1 1",
                "varname": "bs_genin",
            }
        },
        # Once the gen exists, re-send the buffer binding and every parameter's current value
        {
            "box": {
                "id": "obj-dsp-resend",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["bang", "bang"],
                "patching_rect": [100.0, 405.0, 40.0, 20.0],
                "text": "t b b",
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
        # Analyzed root key: the sample's pitch (MIDI) at 4096 evenly spaced positions, written by the face
        {
            "box": {
                "id": "obj-buf-pitch",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [420.0, 414.0, 220.0, 20.0],
                "text": "buffer~ #0-bspitch @samps 4096",
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
        # Click the file name / folder in the face header -> file dialog -> same load path as a drop
        {
            "box": {
                "id": "obj-opendialog",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "bang"],
                "patching_rect": [660.0, 300.0, 100.0, 20.0],
                "text": "opendialog sound",
            }
        },
        {"box": {"id": "obj-prep-dropfile", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [700.0, 95.0, 110.0, 20.0], "text": "prepend dropfile"}},
        {"box": {"id": "obj-prep-browsed", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [660.0, 270.0, 110.0, 20.0], "text": "prepend browsed"}},
        # After a dialog pick the drop zone stores that path too, so Live's saved Sample File matches
        {"box": {"id": "obj-prep-dropset", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [700.0, 35.0, 80.0, 20.0], "text": "prepend set"}},
        # Inspector width: face -> setwidth_cmd -> prepend setwidth -> live.thisdevice; once the device is
        # ready it bangs device_ready so the face re-sends the saved width
        {"box": {"id": "obj-prep-setwidth", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [780.0, 576.0, 102.0, 20.0], "text": "prepend setwidth"}},
        {"box": {"id": "obj-thisdevice", "maxclass": "newobj", "numinlets": 1, "numoutlets": 3, "outlettype": ["bang", "int", "int"],
                 "patching_rect": [780.0, 604.0, 82.0, 20.0], "text": "live.thisdevice"}},
        {"box": {"id": "obj-msg-ready", "maxclass": "message", "numinlets": 2, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [780.0, 632.0, 82.0, 20.0], "text": "device_ready"}},
        {"box": {"id": "obj-prep-tempo", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [900.0, 576.0, 92.0, 20.0], "text": "prepend tempo"}},
        # The loaded file's sample rate (Hz, 0 = unknown): the gen scales every read step by file rate / DSP rate
        {"box": {"id": "obj-prep-samprate", "maxclass": "newobj", "numinlets": 1, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [1000.0, 576.0, 110.0, 20.0], "text": "prepend samp_rate"}},
        # Debug entry point for the MCP bridge: messnamed("#0-bsdebug", "dsp_diag") (see src/sampler_ui.js)
        {"box": {"id": "obj-debug-recv", "maxclass": "newobj", "numinlets": 0, "numoutlets": 1, "outlettype": [""],
                 "patching_rect": [900.0, 632.0, 110.0, 20.0], "text": "receive #0-bsdebug"}},
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
                "text": "samp #0-bsamp, vdata #0-bsvoices, scope #0-bsscope, pitch #0-bspitch",
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
                "text": "setbuffers #0-bsamp #0-bsvoices #0-bsscope #0-bspitch",
            }
        },
        # Route messages emitted from v8ui
        {
            "box": {
                "id": "obj-route-viz",
                "maxclass": "newobj",
                "numinlets": 9,
                "numoutlets": 9,
                "outlettype": ["", "", "", "", "", "", "", "", ""],
                "patching_rect": [160.0, 555.0, 310.0, 20.0],
                "text": "route param load_sample browse drop_set setwidth_cmd tempo dsp_ready samp_rate",
            }
        },
        {
            "box": {
                "id": "obj-route-param",
                "maxclass": "newobj",
                "numinlets": len(FACE_KEYS) + 1,
                "numoutlets": len(FACE_KEYS) + 1,
                "outlettype": [""] * (len(FACE_KEYS) + 1),
                "patching_rect": [160.0, 585.0, 900.0, 20.0],
                "text": "route " + " ".join(FACE_KEYS),
            }
        },
    ]

    lines = [
        # Audio & GenExpr I/O

        # MIDI Input -> midiparse -> v8ui voice allocator
        {"patchline": {"source": ["obj-midiin", 0], "destination": ["obj-midiparse", 0]}},
        {"patchline": {"source": ["obj-midiparse", 0], "destination": ["obj-prep-midi", 0]}},
        {"patchline": {"source": ["obj-prep-midi", 0], "destination": ["obj-viz", 0]}},

        # Sample load: the face's load_sample -> prepend replace -> buffer~ #0-bsamp -> done bang -> face
        {"patchline": {"source": ["obj-prep-replace", 0], "destination": ["obj-buf-samp", 0]}},
        {"patchline": {"source": ["obj-buf-samp", 1], "destination": ["obj-prep-loaded", 0]}},
        {"patchline": {"source": ["obj-prep-loaded", 0], "destination": ["obj-viz", 0]}},

        # Loadbang buffer binding
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-gen-buf", 0], "order": 1}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-ui-buf", 0], "order": 0}},
        {"patchline": {"source": ["obj-msg-gen-buf", 0], "destination": ["obj-gen-in", 1]}},
        {"patchline": {"source": ["obj-msg-ui-buf", 0], "destination": ["obj-viz", 0]}},

        # v8ui outlet routing (both face regions send ["param", key, value] / ["load_sample", path])
        {"patchline": {"source": ["obj-viz", 0], "destination": ["obj-route-viz", 0]}},
        {"patchline": {"source": ["obj-viz-side", 0], "destination": ["obj-route-viz", 0]}},
        {"patchline": {"source": ["obj-viz-insp", 0], "destination": ["obj-route-viz", 0]}},
        {"patchline": {"source": ["obj-route-viz", 4], "destination": ["obj-prep-setwidth", 0]}},
        {"patchline": {"source": ["obj-route-viz", 5], "destination": ["obj-prep-tempo", 0]}},
        {"patchline": {"source": ["obj-route-viz", 6], "destination": ["obj-dsp-resend", 0]}},
        {"patchline": {"source": ["obj-dsp-resend", 1], "destination": ["obj-msg-gen-buf", 0]}},
        {"patchline": {"source": ["obj-prep-tempo", 0], "destination": ["obj-gen-in", 1]}},
        {"patchline": {"source": ["obj-route-viz", 7], "destination": ["obj-prep-samprate", 0]}},
        {"patchline": {"source": ["obj-prep-samprate", 0], "destination": ["obj-gen-in", 1]}},
        {"patchline": {"source": ["obj-prep-setwidth", 0], "destination": ["obj-thisdevice", 0]}},
        {"patchline": {"source": ["obj-thisdevice", 0], "destination": ["obj-msg-ready", 0]}},
        {"patchline": {"source": ["obj-msg-ready", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-debug-recv", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-route-viz", 0], "destination": ["obj-route-param", 0]}},
        {"patchline": {"source": ["obj-route-viz", 1], "destination": ["obj-prep-replace", 0]}},
        {"patchline": {"source": ["obj-route-viz", 2], "destination": ["obj-opendialog", 0]}},
    ]

    # Drops and dialog picks go to the face, which emits load_sample (and drop_set after a browse)
    lines += [
        {"patchline": {"source": ["obj-drop-wave", 0], "destination": ["obj-prep-dropfile", 0]}},
        {"patchline": {"source": ["obj-prep-dropfile", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-opendialog", 0], "destination": ["obj-prep-browsed", 0]}},
        {"patchline": {"source": ["obj-prep-browsed", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-route-viz", 3], "destination": ["obj-prep-dropset", 0]}},
        {"patchline": {"source": ["obj-prep-dropset", 0], "destination": ["obj-drop-wave", 0]}},
    ]

    for i, key in enumerate(FACE_KEYS):
        lines.append({"patchline": {"source": ["obj-route-param", i], "destination": [f"obj-ctrl-{key}", 0]}})

    # dsp_ready: bang every gen-bound parameter object so its current value reaches the new gen
    for key, spec in PARAM_SPECS.items():
        if spec[7]:
            lines.append({"patchline": {"source": ["obj-dsp-resend", 0], "destination": [f"obj-ctrl-{key}", 0]}})
    for key, spec in ENUM_SPECS.items():
        if spec[4]:
            lines.append({"patchline": {"source": ["obj-dsp-resend", 0], "destination": [f"obj-ctrl-{key}", 0]}})

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
            lines.append({"patchline": {"source": [prep_id, 0], "destination": ["obj-gen-in", 1]}})

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
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz-side", 0]}})
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz-insp", 0]}})

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
            lines.append({"patchline": {"source": [prep_id, 0], "destination": ["obj-gen-in", 1]}})

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
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz-side", 0]}})
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz-insp", 0]}})

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
    devices_dir = os.path.join(ROOT_DIR, "devices")
    write_amxd(build_patcher(), os.path.join(devices_dir, "Better Sampler.amxd"))


if __name__ == "__main__":
    main()
