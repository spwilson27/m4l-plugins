#!/usr/bin/env python3
"""
Build Degrade (.amxd) — Modular 5-Section Reorderable Digital & Codec Degradation Plugin.

Generates 3 distinct 169px-tall interface variants in devices/:
  1. "strip"   (780 x 169, default -> devices/Degrade.amxd & devices/Degrade Strip.amxd)
               Audio-reactive visualizer + 5 side-by-side color-coded section cards + Master strip.
  2. "compact" (480 x 169 -> devices/Degrade Compact.amxd)
               Compact 2-panel rack: Visualizer + 5-Column Dark LCD Matrix + 6 Hero Dials.
  3. "hero"    (560 x 169 -> devices/Degrade Hero.amxd)
               Wide 302px interactive visualizer pedal + 5 Macro Dials + Micro-Matrix.

Usage:
  python3 scripts/build_degrade.py           # builds default ("strip") + all 3 variant .amxd files
  python3 scripts/build_degrade.py strip     # sets devices/Degrade.amxd to Strip layout (780 px)
  python3 scripts/build_degrade.py compact   # sets devices/Degrade.amxd to Compact layout (480 px)
  python3 scripts/build_degrade.py hero      # sets devices/Degrade.amxd to Hero layout (560 px)
"""

import json
import os
import struct
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "degrade_config.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "degrade_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "degrade_core.genexpr")
SPEC_GEN_PATH = os.path.join(ROOT_DIR, "src", "degrade_spectral.genexpr")

DEVICE_H = 169.0

# Colors matching STAGE_META in src/degrade_config.js
COL_BIT   = (0.98, 0.56, 0.24)
COL_SR    = (0.26, 0.84, 0.96)
COL_CODEC = (0.76, 0.46, 0.98)
COL_TELE  = (0.32, 0.90, 0.58)
COL_FFT   = (0.98, 0.36, 0.54)
COL_MST   = (0.92, 0.78, 0.34)

# Continuous parameter specs:
# key: (long_name, short_name, lo, hi, initial, unitstyle, exponent, gen_param, scale_factor, ui_setter, help_text)
# unitstyle: 0=int, 1=float, 2=time(ms), 3=freq(Hz), 4=dB, 5=percent
PARAM_SPECS = {
    # Section 1: BIT
    "bits": (
        "Bits", "Bits", 1.0, 16.0, 8.0, 1, 1.0, "bits", 1.0, "set_bits",
        "Quantization bit depth (1.0 to 16.0 bits) with signal-following grit floor.",
    ),
    "wrap": (
        "Wrap", "Wrap", 0.0, 100.0, 25.0, 5, 1.0, "wrap_amt", 0.01, "set_wrap",
        "Integer overflow wraparound (folds peaks around full scale like 8/16-bit game chips).",
    ),
    "dither": (
        "Dither", "Dith", 0.0, 100.0, 20.0, 5, 1.0, "dither", 0.01, "set_dither",
        "High-pass TPDF dither & noise floor texture injected before quantization.",
    ),
    # Section 2: SR
    "srate": (
        "Sample Rate", "Rate", 100.0, 44100.0, 12000.0, 3, 2.2, "srate", 1.0, "set_srate",
        "Downsampling clock rate (100 Hz to 44.1 kHz).",
    ),
    "jitter": (
        "Jitter", "Jit", 0.0, 100.0, 15.0, 5, 1.0, "jitter", 0.01, "set_jitter",
        "Stochastic sample-clock timing jitter and sideband fuzz.",
    ),
    # Section 3: CODEC
    "codec_loss": (
        "Codec Damage", "Damage", 0.0, 100.0, 55.0, 5, 1.0, "codec_loss", 0.01, "set_codec_loss",
        "MP3/AAC/Opus perceptual masking damage (punches spectral holes in quieter sub-bands).",
    ),
    "preecho": (
        "Pre-Echo", "Echo", 0.0, 100.0, 35.0, 5, 1.0, "preecho", 0.01, "set_preecho",
        "Transient block-smear pre-echo before sharp drum/pluck attacks.",
    ),
    "birdies": (
        "Birdies", "Bird", 0.0, 100.0, 40.0, 5, 1.0, "birdies", 0.01, "set_birdies",
        "MDCT frame-rate spectral scale-factor quantization chatter and warble.",
    ),
    # Section 4: TELECOM
    "tele_line": (
        "Telecom Line", "Line", 0.0, 100.0, 60.0, 5, 1.0, "tele_line", 0.01, "set_tele_line",
        "Telephone line bandwidth constriction, companding coarseness, and GSM frame dropouts.",
    ),
    # Section 5: FFT GLITCH
    "fft_glitch": (
        "FFT Glitch", "Glitch", 0.0, 100.0, 50.0, 5, 1.0, "fft_glitch", 0.01, "set_fft_glitch",
        "Spectral glitch intensity (Freeze, Scramble, Spectral Comb, Phase Splat).",
    ),
    "fft_frame": (
        "FFT Frame", "Frame", 5.0, 150.0, 45.0, 2, 1.5, "fft_frame", 1.0, "set_fft_frame",
        "Spectral window frame length in milliseconds (5 to 150 ms).",
    ),
    # Master
    "out_gain": (
        "Output", "Out", -24.0, 12.0, 0.0, 4, 1.0, "out_gain", 1.0, None,
        "Master output drive/trim in dB before final soft ceiling.",
    ),
    "mix": (
        "Mix", "Mix", 0.0, 100.0, 100.0, 5, 1.0, "wet", 0.01, "set_mix",
        "Equal-power dry/wet mix.",
    ),
}

# Discrete toggle & enum parameters:
# key: (long_name, short_name, enums, initial, gen_param, ui_setter, help_text)
ENUM_SPECS = {
    "bit_on": (
        "Bit Enable", "BitOn", ["Off", "On"], 1, "bit_on", "set_bit_on",
        "Enables Section 1 (Bit Reduction, Integer Wrap & Dither). Zero CPU when Off.",
    ),
    "sr_on": (
        "SR Enable", "SROn", ["Off", "On"], 1, "sr_on", "set_sr_on",
        "Enables Section 2 (Sample-Rate Reduction & Clock Jitter). Zero CPU when Off.",
    ),
    "codec_on": (
        "Codec Enable", "CodOn", ["Off", "On"], 0, "codec_on", "set_codec_on",
        "Enables Section 3 (MP3/AAC/Opus Perceptual Codec Damage). Zero CPU when Off.",
    ),
    "tele_on": (
        "Telecom Enable", "TelOn", ["Off", "On"], 0, "tele_on", "set_tele_on",
        "Enables Section 4 (u-Law / A-Law / ADPCM / GSM Telecom). Zero CPU when Off.",
    ),
    "fft_on": (
        "FFT Enable", "FFTOn", ["Off", "On"], 0, "fft_on", "set_fft_on",
        "Enables Section 5 (FFT Spectral Glitch). Zero CPU when Off.",
    ),
    "sr_mode": (
        "SR Mode", "SRMode", ["S&H", "Filt"], 0, "sr_mode", "set_sr_mode",
        "Sample-and-Hold (harsh aliasing foldback) vs Filtered downsample.",
    ),
    "tele_mode": (
        "Telecom Mode", "TelMod", ["uLaw", "ALaw", "ADPC", "GSM"], 0, "tele_mode", "set_tele_mode",
        "Selects u-Law, A-Law, IMA ADPCM slope-overload, or GSM 06.10 mobile voice codec.",
    ),
    "fft_mode": (
        "FFT Mode", "FFTMod", ["Frz", "Scr", "Cmb", "Spl"], 0, "fft_mode", "set_fft_mode",
        "Selects Spectral Freeze, Bin Scramble, Spectral Comb, or Dispersive Phase Splat.",
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


def make_dial(key, x, y, w=42.0, h=46.0, color_rgb=COL_SR):
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
            "patching_rect": [float(x), 220.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "varname": long_name,
        }
    }


def make_numbox(key, x, y, w=44.0, h=15.0, color_rgb=COL_SR):
    long_name, _short, _lo, _hi, _init, _unit, _exp, _gen, _sc, _ui, help_text = PARAM_SPECS[key]
    return {
        "box": {
            "activebgcolor": [0.06, 0.075, 0.095, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "appearance": 0,
            "bordercolor": [0.22, 0.27, 0.33, 1.0],
            "fontface": 1,
            "fontsize": 9.0,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.numbox",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [float(x), 275.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": valueof_dict(key)},
            "textcolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "varname": long_name,
        }
    }


def make_toggle(key, x, y, w=26.0, h=14.0, color_rgb=COL_SR, text_off="Off", text_on="ON"):
    long_name, _short, _enums, _init, _gen, _ui, help_text = ENUM_SPECS[key]
    return {
        "box": {
            "activebgcolor": [0.10, 0.12, 0.15, 1.0],
            "activebgoncolor": [color_rgb[0], color_rgb[1], color_rgb[2], 1.0],
            "activetextcolor": [0.72, 0.76, 0.82, 1.0],
            "activetextoncolor": [0.05, 0.07, 0.09, 1.0],
            "annotation": help_text,
            "annotation_name": long_name,
            "bordercolor": [color_rgb[0], color_rgb[1], color_rgb[2], 0.85],
            "fontsize": 8.5,
            "id": f"obj-ctrl-{key}",
            "maxclass": "live.text",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", ""],
            "parameter_enable": 1,
            "patching_rect": [float(x), 175.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": enum_valueof_dict(key)},
            "text": text_off,
            "texton": text_on,
            "varname": long_name,
        }
    }


def make_tab(key, x, y, w=82.0, h=15.0, color_rgb=COL_SR, num_rows=1):
    long_name, _short, _enums, _init, _gen, _ui, help_text = ENUM_SPECS[key]
    return {
        "box": {
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
            "patching_rect": [float(x), 195.0, float(w), float(h)],
            "presentation": 1,
            "presentation_rect": [float(x), float(y), float(w), float(h)],
            "saved_attribute_attributes": {"valueof": enum_valueof_dict(key)},
            "spacing_x": 2.0,
            "spacing_y": 2.0,
            "varname": long_name,
        }
    }


def make_label(obj_id, text, x, y, w, h=13.0, size=8.5, color=(0.62, 0.70, 0.78), bold=True, align=0):
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


def make_panel(obj_id, x, y, w, h, bg=(0.10, 0.11, 0.13), border=(0.22, 0.26, 0.32), rounded=6):
    return {
        "box": {
            "angle": 270.0,
            "background": 1,
            "bgcolor": [bg[0], bg[1], bg[2], 1.0],
            "border": 1,
            "bordercolor": [border[0], border[1], border[2], 1.0],
            "grad1": [bg[0], bg[1], bg[2], 1.0],
            "grad2": [bg[0] * 0.85, bg[1] * 0.85, bg[2] * 0.85, 1.0],
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


def layout_strip():
    """
    Variant A: Modular 5-Section Channel Strip (780 x 169 px)
      - Left Panel (x=6..234): Title + Visualizer + Reorderable 5-Pill Chain
      - 5 Side-by-Side Section Cards:
          1. BIT (x=238..330)
          2. SR (x=334..426)
          3. CODEC (x=430..522)
          4. TELE (x=526..618)
          5. FFT (x=622..714)
      - Master Strip (x=718..774): Out dB + Mix
    """
    dev_w = 780.0
    viz_rect = [10.0, 26.0, 220.0, 136.0]

    ui_boxes = [
        make_label("obj-title", "Degrade", 10, 7, 70, 16, size=11.5, color=(0.94, 0.96, 0.99)),
        make_label("obj-sub", "5-Stage Modular Lo-Fi", 82, 8, 146, 14, size=8.5, color=(0.56, 0.66, 0.78), bold=False, align=2),

        # Section 1: 1. BIT (x=238..330)
        make_label("obj-hdr-bit", "1. BIT", 242, 8, 54, 14, size=9.0, color=COL_BIT),
        make_toggle("bit_on", 298, 8, 28, 14, color_rgb=COL_BIT),
        make_dial("bits", 241, 34, 42, 46, color_rgb=COL_BIT),
        make_dial("wrap", 285, 34, 42, 46, color_rgb=COL_BIT),
        make_label("obj-lbl-dith", "Dither", 242, 108, 40, 13, size=8.5, color=COL_BIT),
        make_numbox("dither", 282, 107, 44, 15, color_rgb=COL_BIT),
        make_label("obj-note-bit", " Floor + Fold", 242, 134, 84, 13, size=8.0, color=(0.55, 0.60, 0.68), bold=False),

        # Section 2: 2. SR (x=334..426)
        make_label("obj-hdr-sr", "2. SR", 338, 8, 54, 14, size=9.0, color=COL_SR),
        make_toggle("sr_on", 394, 8, 28, 14, color_rgb=COL_SR),
        make_dial("srate", 336, 34, 44, 46, color_rgb=COL_SR),
        make_dial("jitter", 382, 34, 42, 46, color_rgb=COL_SR),
        make_label("obj-lbl-srmode", "Clock Reconstruction", 338, 98, 84, 13, size=8.0, color=(0.55, 0.60, 0.68), bold=False),
        make_tab("sr_mode", 338, 114, 84, 16, color_rgb=COL_SR, num_rows=1),
        make_label("obj-note-sr", " Alias + Jitter", 338, 136, 84, 13, size=8.0, color=(0.55, 0.60, 0.68), bold=False),

        # Section 3: 3. CODEC (x=430..522)
        make_label("obj-hdr-codec", "3. CODEC", 434, 8, 56, 14, size=9.0, color=COL_CODEC),
        make_toggle("codec_on", 490, 8, 28, 14, color_rgb=COL_CODEC),
        make_dial("codec_loss", 433, 34, 42, 46, color_rgb=COL_CODEC),
        make_dial("birdies", 477, 34, 42, 46, color_rgb=COL_CODEC),
        make_label("obj-lbl-echo", "PreEcho", 434, 108, 42, 13, size=8.0, color=COL_CODEC),
        make_numbox("preecho", 476, 107, 42, 15, color_rgb=COL_CODEC),
        make_label("obj-note-cod", " MP3 / Opus Holes", 434, 134, 84, 13, size=8.0, color=(0.55, 0.60, 0.68), bold=False),

        # Section 4: 4. TELE (x=526..618)
        make_label("obj-hdr-tele", "4. TELE", 530, 8, 54, 14, size=9.0, color=COL_TELE),
        make_toggle("tele_on", 586, 8, 28, 14, color_rgb=COL_TELE),
        make_dial("tele_line", 550, 34, 44, 46, color_rgb=COL_TELE),
        make_tab("tele_mode", 530, 96, 84, 34, color_rgb=COL_TELE, num_rows=2),
        make_label("obj-note-tel", " Voice Compand", 530, 136, 84, 13, size=8.0, color=(0.55, 0.60, 0.68), bold=False),

        # Section 5: 5. FFT (x=622..714)
        make_label("obj-hdr-fft", "5. FFT", 626, 8, 54, 14, size=9.0, color=COL_FFT),
        make_toggle("fft_on", 682, 8, 28, 14, color_rgb=COL_FFT),
        make_dial("fft_glitch", 625, 34, 42, 46, color_rgb=COL_FFT),
        make_dial("fft_frame", 669, 34, 42, 46, color_rgb=COL_FFT),
        make_tab("fft_mode", 626, 96, 84, 34, color_rgb=COL_FFT, num_rows=2),
        make_label("obj-note-fft", " Spectral Glitch", 626, 136, 84, 13, size=8.0, color=(0.55, 0.60, 0.68), bold=False),

        # Master Strip: OUT (x=718..774)
        make_label("obj-hdr-mst", "OUT", 724, 8, 44, 14, size=9.0, color=COL_MST, align=1),
        make_label("obj-lbl-out", "Gain", 722, 30, 48, 12, size=8.0, color=COL_MST, align=1),
        make_numbox("out_gain", 723, 44, 46, 15, color_rgb=COL_MST),
        make_dial("mix", 724, 86, 44, 46, color_rgb=COL_MST),
    ]

    panels = [
        make_panel("obj-pnl-left",  6,   4, 228, 161, bg=(0.09, 0.10, 0.12), border=(0.22, 0.27, 0.34)),
        make_panel("obj-pnl-bit",   238, 4, 92,  161, bg=(0.10, 0.10, 0.12), border=(0.48, 0.30, 0.16)),
        make_panel("obj-pnl-sr",    334, 4, 92,  161, bg=(0.09, 0.11, 0.13), border=(0.18, 0.44, 0.52)),
        make_panel("obj-pnl-codec", 430, 4, 92,  161, bg=(0.10, 0.10, 0.13), border=(0.38, 0.25, 0.52)),
        make_panel("obj-pnl-tele",  526, 4, 92,  161, bg=(0.09, 0.11, 0.11), border=(0.18, 0.46, 0.32)),
        make_panel("obj-pnl-fft",   622, 4, 92,  161, bg=(0.11, 0.10, 0.12), border=(0.50, 0.22, 0.32)),
        make_panel("obj-pnl-mst",   718, 4, 56,  161, bg=(0.10, 0.10, 0.12), border=(0.44, 0.38, 0.22)),
    ]
    return dev_w, viz_rect, ui_boxes, panels


def layout_compact():
    """
    Variant B: Compact Matrix Rack (480 x 169 px)
      - Left Panel (x=6..204): Title + Visualizer (190 x 136)
      - Right Panel (x=208..474):
          - Top Dark LCD 5-Column Micro-Matrix (y=8..98):
            Each stage column has its Enable button + secondary numboxes/tabs.
          - Bottom 6 Hero Dials Row (y=106..154):
            Bits, Rate, Damage, Line, Glitch, Mix.
    """
    dev_w = 480.0
    viz_rect = [10.0, 26.0, 190.0, 136.0]

    ui_boxes = [
        make_label("obj-title", "Degrade", 10, 7, 74, 16, size=11.5, color=(0.94, 0.96, 0.99)),
        make_numbox("out_gain", 152, 7, 46, 15, color_rgb=COL_MST),

        # Column 1: BIT (x=212..260)
        make_toggle("bit_on", 214, 10, 44, 14, color_rgb=COL_BIT, text_off="1.BIT", text_on="1.BIT"),
        make_label("obj-lbl-wrap", "Wrap", 214, 28, 44, 12, size=7.5, color=COL_BIT),
        make_numbox("wrap", 214, 41, 44, 15, color_rgb=COL_BIT),
        make_label("obj-lbl-dith", "Dith", 214, 60, 44, 12, size=7.5, color=COL_BIT),
        make_numbox("dither", 214, 73, 44, 15, color_rgb=COL_BIT),

        # Column 2: SR (x=264..312)
        make_toggle("sr_on", 266, 10, 44, 14, color_rgb=COL_SR, text_off="2.SR", text_on="2.SR"),
        make_label("obj-lbl-jit", "Jitter", 266, 28, 44, 12, size=7.5, color=COL_SR),
        make_numbox("jitter", 266, 41, 44, 15, color_rgb=COL_SR),
        make_label("obj-lbl-srm", "Mode", 266, 60, 44, 12, size=7.5, color=COL_SR),
        make_tab("sr_mode", 266, 73, 44, 15, color_rgb=COL_SR, num_rows=1),

        # Column 3: CODEC (x=316..364)
        make_toggle("codec_on", 318, 10, 44, 14, color_rgb=COL_CODEC, text_off="3.COD", text_on="3.COD"),
        make_label("obj-lbl-echo", "Echo", 318, 28, 44, 12, size=7.5, color=COL_CODEC),
        make_numbox("preecho", 318, 41, 44, 15, color_rgb=COL_CODEC),
        make_label("obj-lbl-bird", "Bird", 318, 60, 44, 12, size=7.5, color=COL_CODEC),
        make_numbox("birdies", 318, 73, 44, 15, color_rgb=COL_CODEC),

        # Column 4: TELE (x=368..416)
        make_toggle("tele_on", 370, 10, 44, 14, color_rgb=COL_TELE, text_off="4.TEL", text_on="4.TEL"),
        make_label("obj-lbl-telm", "Codec", 370, 28, 44, 12, size=7.5, color=COL_TELE),
        make_tab("tele_mode", 369, 42, 46, 46, color_rgb=COL_TELE, num_rows=2),

        # Column 5: FFT (x=420..470)
        make_toggle("fft_on", 422, 10, 46, 14, color_rgb=COL_FFT, text_off="5.FFT", text_on="5.FFT"),
        make_numbox("fft_frame", 422, 27, 46, 15, color_rgb=COL_FFT),
        make_tab("fft_mode", 422, 45, 46, 43, color_rgb=COL_FFT, num_rows=2),

        # Bottom Row: 6 Hero Dials (y=104..150)
        make_dial("bits",       212, 104, 42, 46, color_rgb=COL_BIT),
        make_dial("srate",      256, 104, 42, 46, color_rgb=COL_SR),
        make_dial("codec_loss", 300, 104, 42, 46, color_rgb=COL_CODEC),
        make_dial("tele_line",  344, 104, 42, 46, color_rgb=COL_TELE),
        make_dial("fft_glitch", 388, 104, 42, 46, color_rgb=COL_FFT),
        make_dial("mix",        431, 104, 41, 46, color_rgb=COL_MST),
    ]

    panels = [
        make_panel("obj-pnl-left",  6,   4, 198, 161, bg=(0.09, 0.10, 0.12), border=(0.22, 0.27, 0.34)),
        make_panel("obj-pnl-lcd",   210, 6, 262, 88,  bg=(0.05, 0.06, 0.08), border=(0.20, 0.25, 0.32), rounded=5),
        make_panel("obj-pnl-right", 208, 4, 266, 161, bg=(0.10, 0.11, 0.13), border=(0.22, 0.26, 0.32)),
    ]
    return dev_w, viz_rect, ui_boxes, panels


def layout_hero():
    """
    Variant C: Visualizer-Hero Pedal (560 x 169 px)
      - Left Panel (x=6..312): Wide 298 x 136 interactive visualizer
      - Right Panel (x=316..554):
          - Top 5 Stage Enable toggles + 5 Macro Dials (y=8..74)
          - Bottom Micro-Matrix for secondary controls + Mix (y=82..156)
    """
    dev_w = 560.0
    viz_rect = [10.0, 26.0, 298.0, 136.0]

    ui_boxes = [
        make_label("obj-title", "Degrade", 10, 7, 74, 16, size=11.5, color=(0.94, 0.96, 0.99)),
        make_label("obj-sub", "Drag Pills to Reorder", 88, 8, 150, 14, size=8.5, color=(0.56, 0.66, 0.78), bold=False),
        make_numbox("out_gain", 260, 7, 46, 15, color_rgb=COL_MST),

        # Top Enable Strip + 5 Stage Macro Dials (x=320..550)
        make_toggle("bit_on",   322, 8, 42, 14, color_rgb=COL_BIT,   text_off="1.BIT", text_on="1.BIT"),
        make_toggle("sr_on",    368, 8, 42, 14, color_rgb=COL_SR,    text_off="2.SR",  text_on="2.SR"),
        make_toggle("codec_on", 414, 8, 42, 14, color_rgb=COL_CODEC, text_off="3.COD", text_on="3.COD"),
        make_toggle("tele_on",  460, 8, 42, 14, color_rgb=COL_TELE,  text_off="4.TEL", text_on="4.TEL"),
        make_toggle("fft_on",   506, 8, 42, 14, color_rgb=COL_FFT,   text_off="5.FFT", text_on="5.FFT"),

        make_dial("bits",       322, 25, 42, 46, color_rgb=COL_BIT),
        make_dial("srate",      368, 25, 42, 46, color_rgb=COL_SR),
        make_dial("codec_loss", 414, 25, 42, 46, color_rgb=COL_CODEC),
        make_dial("tele_line",  460, 25, 42, 46, color_rgb=COL_TELE),
        make_dial("fft_glitch", 506, 25, 42, 46, color_rgb=COL_FFT),

        # Bottom Secondary Matrix + Mix Dial (y=80..156)
        make_numbox("wrap",      322, 82,  42, 15, color_rgb=COL_BIT),
        make_numbox("dither",    322, 100, 42, 15, color_rgb=COL_BIT),

        make_numbox("jitter",    368, 82,  42, 15, color_rgb=COL_SR),
        make_tab("sr_mode",      368, 100, 42, 15, color_rgb=COL_SR, num_rows=1),

        make_numbox("preecho",   414, 82,  42, 15, color_rgb=COL_CODEC),
        make_numbox("birdies",   414, 100, 42, 15, color_rgb=COL_CODEC),

        make_tab("tele_mode",    322, 122, 92, 32, color_rgb=COL_TELE, num_rows=2),
        make_tab("fft_mode",     418, 122, 84, 32, color_rgb=COL_FFT,  num_rows=2),

        make_numbox("fft_frame", 460, 82,  42, 15, color_rgb=COL_FFT),
        make_dial("mix",         506, 96,  42, 46, color_rgb=COL_MST),
    ]

    panels = [
        make_panel("obj-pnl-left",  6,   4, 306, 161, bg=(0.09, 0.10, 0.12), border=(0.22, 0.27, 0.34)),
        make_panel("obj-pnl-lcd",   318, 76, 232, 84, bg=(0.05, 0.06, 0.08), border=(0.20, 0.25, 0.32), rounded=5),
        make_panel("obj-pnl-right", 316, 4, 238, 161, bg=(0.10, 0.11, 0.13), border=(0.22, 0.26, 0.32)),
    ]
    return dev_w, viz_rect, ui_boxes, panels


def build_patcher(variant="compact"):
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    with open(SPEC_GEN_PATH, "r", encoding="utf-8") as f:
        spec_gen_code = f.read()

    combined_ui_js = config_js + "\n\n" + ui_js

    if variant == "compact":
        dev_w, viz_rect, ui_boxes, panels = layout_compact()
    elif variant == "hero":
        dev_w, viz_rect, ui_boxes, panels = layout_hero()
    else:
        dev_w, viz_rect, ui_boxes, panels = layout_strip()

    dsp_boxes = [
        # Audio I/O
        {
            "box": {
                "id": "obj-plugin",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [40.0, 320.0, 52.0, 20.0],
                "text": "plugin~",
            }
        },
        {
            "box": {
                "id": "obj-plugout",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 0,
                "patching_rect": [40.0, 490.0, 58.0, 20.0],
                "text": "plugout~",
            }
        },
        # GenExpr core
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
                "patching_rect": [40.0, 390.0, 320.0, 75.0],
            }
        },
        # Instance-isolated telemetry buffer (#0-degscope)
        {
            "box": {
                "id": "obj-buf-scope",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [400.0, 320.0, 210.0, 20.0],
                "text": "buffer~ #0-degscope @samps 32",
            }
        },
        {
            "box": {
                "id": "obj-loadbang",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [400.0, 355.0, 56.0, 20.0],
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
                "patching_rect": [400.0, 385.0, 145.0, 20.0],
                "text": "scope #0-degscope",
            }
        },
        {
            "box": {
                "id": "obj-msg-ui-buf",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [400.0, 415.0, 175.0, 20.0],
                "text": "setbuffer #0-degscope",
            }
        },
        # Interactive v8ui canvas with OrderData blob persistence
        {
            "box": {
                "embed": 1,
                "filename": "none",
                "id": "obj-viz",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "parameter_enable": 1,
                "patching_rect": [10.0, 40.0, viz_rect[2], viz_rect[3]],
                "presentation": 1,
                "presentation_rect": [float(v) for v in viz_rect],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_initial": [1, 0, 1, 2, 3, 4, 0, 0],
                        "parameter_initial_enable": 1,
                        "parameter_invisible": 1,
                        "parameter_longname": "OrderData",
                        "parameter_shortname": "OrderData",
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
                "varname": "OrderData",
            }
        },
        # Route messages emitted from v8ui (order_code, toggle, macro, focus)
        {
            "box": {
                "id": "obj-route-ui",
                "maxclass": "newobj",
                "numinlets": 5,
                "numoutlets": 5,
                "outlettype": ["", "", "", "", ""],
                "patching_rect": [10.0, 530.0, 240.0, 20.0],
                "text": "route order_code toggle macro focus",
            }
        },
        {
            "box": {
                "id": "obj-prep-order",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [10.0, 565.0, 130.0, 20.0],
                "text": "prepend order_code",
            }
        },
        {
            "box": {
                "id": "obj-route-toggle",
                "maxclass": "newobj",
                "numinlets": 6,
                "numoutlets": 6,
                "outlettype": ["", "", "", "", "", ""],
                "patching_rect": [160.0, 565.0, 220.0, 20.0],
                "text": "route bit sr codec tele fft",
            }
        },
    ]

    lines = [
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}},
        {"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-gen-buf", 0]}},
        {"patchline": {"source": ["obj-msg-gen-buf", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-ui-buf", 0]}},
        {"patchline": {"source": ["obj-msg-ui-buf", 0], "destination": ["obj-viz", 0]}},
        {"patchline": {"source": ["obj-viz", 0], "destination": ["obj-route-ui", 0]}},
        {"patchline": {"source": ["obj-route-ui", 0], "destination": ["obj-prep-order", 0]}},
        {"patchline": {"source": ["obj-prep-order", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-route-ui", 1], "destination": ["obj-route-toggle", 0]}},
    ]

    # Connect v8ui pill power toggle route to the 5 enable buttons
    stage_keys = ["bit_on", "sr_on", "codec_on", "tele_on", "fft_on"]
    for idx, sk in enumerate(stage_keys):
        lines.append({
            "patchline": {
                "source": ["obj-route-toggle", idx],
                "destination": [f"obj-ctrl-{sk}", 0],
            }
        })

    # Wire every continuous parameter into obj-gen (with scale factor if needed) and obj-viz
    px = 60.0
    for key, spec in PARAM_SPECS.items():
        _long, _short, _lo, _hi, _init, _unit, _exp, gen_param, scale_factor, ui_setter, _help = spec
        ctrl_id = f"obj-ctrl-{key}"
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
                    "patching_rect": [px, 310.0, 52.0, 20.0],
                    "text": "* 0.01",
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
                "patching_rect": [px, 340.0, 110.0, 20.0],
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
                    "patching_rect": [px, 365.0, 115.0, 20.0],
                    "text": f"prepend {ui_setter}",
                }
            })
            lines.append({"patchline": {"source": [ctrl_id, 0], "destination": [ui_prep_id, 0]}})
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz", 0]}})

        px += 90.0

    # Wire every enum / toggle parameter into obj-gen and obj-viz
    for key, spec in ENUM_SPECS.items():
        _long, _short, _enums, _init, gen_param, ui_setter, _help = spec
        ctrl_id = f"obj-ctrl-{key}"
        prep_id = f"obj-prep-{key}"

        dsp_boxes.append({
            "box": {
                "id": prep_id,
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [px, 340.0, 110.0, 20.0],
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
                    "patching_rect": [px, 365.0, 115.0, 20.0],
                    "text": f"prepend {ui_setter}",
                }
            })
            lines.append({"patchline": {"source": [ctrl_id, 0], "destination": [ui_prep_id, 0]}})
            lines.append({"patchline": {"source": [ui_prep_id, 0], "destination": ["obj-viz", 0]}})

        px += 90.0

    # Decorative background panels MUST appear at the end of `boxes` with `"background": 1`
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
    header = (
        b"ampf\x04\x00\x00\x00"
        + b"aaaa"
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
    chosen = sys.argv[1].lower() if len(sys.argv) > 1 else "compact"
    if chosen not in ("strip", "compact", "hero"):
        chosen = "compact"

    variants = {
        "strip":   os.path.join(ROOT_DIR, "devices", "Degrade Strip.amxd"),
        "compact": os.path.join(ROOT_DIR, "devices", "Degrade Compact.amxd"),
        "hero":    os.path.join(ROOT_DIR, "devices", "Degrade Hero.amxd"),
    }

    for key, path in variants.items():
        p = build_patcher(key)
        write_amxd(p, path)

    main_path = os.path.join(ROOT_DIR, "devices", "Degrade.amxd")
    write_amxd(build_patcher(chosen), main_path)


if __name__ == "__main__":
    main()
