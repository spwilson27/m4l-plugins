#!/usr/bin/env python3
"""
Build devices/Better GrainSpec.amxd

Max for Live Instrument (type iiii / 1768515945):
- Onset-based 128-slice detector & fundamental pitch estimator
- Transient-preserving attack stage + 4-voice Granular <-> Phase-Locked Spectral stretcher
- Pitch-matching stereo feedback comb filter + Hyperglitch crush stage
- Live audio capture from plugin~ or file load into #0-gssample
- Presentation footprint: 740 x 169 px. Zero overlap between v8ui and live.* controls.
"""

import json
import os
import struct

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLICER_PATH = os.path.join(ROOT_DIR, "src", "grainspec_slicer.js")
UI_PATH = os.path.join(ROOT_DIR, "src", "grainspec_ui.js")
GEN_PATH = os.path.join(ROOT_DIR, "src", "grainspec_core.genexpr")
OUT_AMXD_PATH = os.path.join(ROOT_DIR, "devices", "Better GrainSpec.amxd")

DEVICE_W = 740.0
DEVICE_H = 169.0

# name, long_name, short, x, y, lo, hi, initial, unit, exponent, gen_param, scale100
DIALS = [
    ("speed", "Speed", "Speed", 398.0, 40.0, -200.0, 200.0, 25.0, 5, 1.0, "speed", True),
    ("grain", "Grain", "Grain", 464.0, 40.0, 4.0, 250.0, 38.0, 2, 1.8, "grainsize", False),
    ("morph", "Morph", "Morph", 530.0, 40.0, 0.0, 100.0, 35.0, 5, 1.0, "morph", True),
    ("trans", "Trans", "Trans", 596.0, 40.0, 0.0, 100.0, 75.0, 5, 1.0, "trans", True),
    ("jitter", "Jitter", "Jitter", 662.0, 40.0, 0.0, 100.0, 15.0, 5, 1.0, "jitter", True),
    ("pitch", "Pitch", "Pitch", 398.0, 112.0, -24.0, 24.0, 0.0, 7, 1.0, "pitch", False),
    ("combmix", "CombMix", "CombMix", 464.0, 112.0, 0.0, 100.0, 30.0, 5, 1.0, "combmix", True),
    ("combfbk", "CombFbk", "CombFbk", 530.0, 112.0, 0.0, 100.0, 55.0, 5, 1.0, "combfbk", True),
    ("crush", "Crush", "Crush", 596.0, 112.0, 0.0, 100.0, 0.0, 5, 1.0, "crush", True),
    ("mix", "Mix", "Mix", 662.0, 112.0, 0.0, 100.0, 100.0, 5, 1.0, "wet", True),
]

DIAL_HELP = {
    "speed": "Slice stretch speed (-200% to +200%). 0% freezes the slice body in place.",
    "grain": "Grain and spectral window size (4 ms to 250 ms).",
    "morph": "Crossfades between 4-voice Granular (0%) and Phase-Locked Spectral/Mono stretch (100%).",
    "trans": "Preserves the unstretched drum transient at the start of every slice so beats stay punchy.",
    "jitter": "Randomizes grain and slice read positions.",
    "pitch": "Pitch shift in semitones (-24 to +24 st); also shifts the pitch-matching comb filter.",
    "combmix": "Wet mix of the pitch-matching stereo feedback comb filter.",
    "combfbk": "Resonance / decay time of the pitch-matching comb filter.",
    "crush": "Hyperglitch sample-rate and bit-depth decimation.",
    "mix": "Equal-power balance between dry input and Better GrainSpec output.",
}


def live_dial(spec, amber):
    name, long_name, short, x, y, lo, hi, initial, unit, exponent, _gen, _pct = spec
    valueof = {
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
        valueof["parameter_exponent"] = exponent
    color = [0.95, 0.62, 0.22, 1.0] if amber else [0.28, 0.82, 0.96, 1.0]
    return {
        "box": {
            "activedialcolor": color,
            "annotation": DIAL_HELP[name],
            "annotation_name": long_name,
            "id": f"obj-dial-{name}",
            "maxclass": "live.dial",
            "numinlets": 1,
            "numoutlets": 2,
            "outlettype": ["", "float"],
            "parameter_enable": 1,
            "patching_rect": [x, 220.0 + (0 if y < 80 else 70), 60.0, 48.0],
            "presentation": 1,
            "presentation_rect": [x, y, 60.0, 48.0],
            "saved_attribute_attributes": {"valueof": valueof},
            "varname": long_name,
        }
    }


def build():
    with open(SLICER_PATH, "r", encoding="utf-8") as f:
        slicer_js = f.read()
    with open(UI_PATH, "r", encoding="utf-8") as f:
        ui_js = f.read()
    with open(GEN_PATH, "r", encoding="utf-8") as f:
        gen_code = f.read()
    v8_code = slicer_js.rstrip() + "\n\n" + ui_js

    boxes = [
        # Left Panel Header (y = 7..23, non-overlapping with obj-ui at y = 28..160)
        {
            "box": {
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 11.0,
                "id": "obj-title",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [20.0, 20.0, 120.0, 18.0],
                "presentation": 1,
                "presentation_rect": [10.0, 7.0, 112.0, 16.0],
                "text": "Better GrainSpec",
                "textcolor": [0.92, 0.95, 0.98, 1.0],
            }
        },
        {
            "box": {
                "annotation": "Load an audio loop or sample into the slicer buffer.",
                "annotation_name": "Load Sample",
                "automation": "Off",
                "automationon": "On",
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.0,
                "id": "obj-btn-load",
                "maxclass": "live.text",
                "mode": 0,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [140.0, 20.0, 42.0, 16.0],
                "presentation": 1,
                "presentation_rect": [122.0, 7.0, 40.0, 16.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_enum": ["Off", "On"],
                        "parameter_longname": "Load Sample",
                        "parameter_mmax": 1,
                        "parameter_modmode": 0,
                        "parameter_shortname": "Load",
                        "parameter_type": 2,
                    }
                },
                "text": "Load",
                "texton": "Load",
                "varname": "LoadSample",
            }
        },
        {
            "box": {
                "annotation": "Capture live incoming track audio into the GrainSpec sample buffer.",
                "annotation_name": "Capture Audio",
                "automation": "Off",
                "automationon": "On",
                "activebgoncolor": [0.95, 0.32, 0.32, 1.0],
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.0,
                "id": "obj-btn-capture",
                "maxclass": "live.text",
                "mode": 1,
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [190.0, 20.0, 46.0, 16.0],
                "presentation": 1,
                "presentation_rect": [166.0, 7.0, 46.0, 16.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_enum": ["Off", "On"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_longname": "Capture Audio",
                        "parameter_mmax": 1,
                        "parameter_modmode": 0,
                        "parameter_shortname": "Cap",
                        "parameter_type": 2,
                    }
                },
                "text": "Cap",
                "texton": "Rec",
                "varname": "CaptureAudio",
            }
        },
        {
            "box": {
                "annotation": "128 Map: all 128 MIDI notes trigger slices. Chroma: plays selected slice chromatically.",
                "annotation_name": "Key Mode",
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.0,
                "id": "obj-keymode",
                "maxclass": "live.tab",
                "num_lines_patching": 1,
                "num_lines_presentation": 1,
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["", "", "float"],
                "parameter_enable": 1,
                "patching_rect": [245.0, 20.0, 92.0, 16.0],
                "presentation": 1,
                "presentation_rect": [216.0, 7.0, 86.0, 16.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_enum": ["128", "Key"],
                        "parameter_initial": [0],
                        "parameter_initial_enable": 1,
                        "parameter_longname": "Key Mode",
                        "parameter_mmax": 1,
                        "parameter_modmode": 0,
                        "parameter_shortname": "KeyMode",
                        "parameter_type": 2,
                        "parameter_unitstyle": 9,
                    }
                },
                "varname": "KeyMode",
            }
        },
        {
            "box": {
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.0,
                "id": "obj-sens-lbl",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [342.0, 20.0, 34.0, 16.0],
                "presentation": 1,
                "presentation_rect": [304.0, 7.0, 32.0, 16.0],
                "text": "Sens",
                "textcolor": [0.66, 0.72, 0.78, 1.0],
            }
        },
        {
            "box": {
                "annotation": "Onset detection sensitivity (0% to 100%). Higher detects more slice transients.",
                "annotation_name": "Sensitivity",
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.5,
                "id": "obj-sens",
                "maxclass": "live.numbox",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "float"],
                "parameter_enable": 1,
                "patching_rect": [380.0, 20.0, 44.0, 15.0],
                "presentation": 1,
                "presentation_rect": [336.0, 7.0, 42.0, 16.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_annotation_name": "Sensitivity",
                        "parameter_initial": [65.0],
                        "parameter_initial_enable": 1,
                        "parameter_linknames": 1,
                        "parameter_longname": "Sensitivity",
                        "parameter_mmax": 100.0,
                        "parameter_mmin": 0.0,
                        "parameter_shortname": "Sens",
                        "parameter_type": 0,
                        "parameter_unitstyle": 5,
                    }
                },
                "varname": "Sensitivity",
            }
        },
        # Right Panel Header Titles
        {
            "box": {
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.0,
                "id": "obj-hdr-stretch",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [398.0, 18.0, 190.0, 16.0],
                "presentation": 1,
                "presentation_rect": [398.0, 7.0, 190.0, 16.0],
                "text": "GRANULAR / SPECTRAL STRETCH",
                "textcolor": [0.36, 0.84, 0.96, 1.0],
            }
        },
        {
            "box": {
                "fontface": 1,
                "fontname": "Arial Bold",
                "fontsize": 9.0,
                "id": "obj-hdr-comb",
                "maxclass": "live.comment",
                "numinlets": 1,
                "numoutlets": 0,
                "patching_rect": [592.0, 18.0, 140.0, 16.0],
                "presentation": 1,
                "presentation_rect": [592.0, 7.0, 136.0, 16.0],
                "text": "PITCH COMB & GLITCH",
                "textcolor": [0.95, 0.66, 0.26, 1.0],
            }
        },
        # Main Interactive Waveform / Slicer / Grain & Spectral Visualizer (v8ui)
        {
            "box": {
                "embed": 1,
                "filename": "none",
                "id": "obj-ui",
                "maxclass": "v8ui",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", ""],
                "parameter_enable": 1,
                "patching_rect": [20.0, 60.0, 368.0, 132.0],
                "presentation": 1,
                "presentation_rect": [10.0, 28.0, 368.0, 132.0],
                "saved_attribute_attributes": {
                    "valueof": {
                        "parameter_initial_enable": 0,
                        "parameter_invisible": 1,
                        "parameter_longname": "ShapeData",
                        "parameter_modmode": 0,
                        "parameter_shortname": "ShapeData",
                        "parameter_type": 3,
                    }
                },
                "textfile": {
                    "autowatch": 1,
                    "embed": 1,
                    "filename": "none",
                    "flags": 0,
                    "text": v8_code,
                },
                "varname": "ShapeData",
            }
        },
        # MIDI + Audio I/O + Instance-Isolated Buffers (#0-)
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-midiin",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["int"],
                "patching_rect": [20.0, 220.0, 48.0, 20.0],
                "text": "midiin",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-notein",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 3,
                "outlettype": ["int", "int", "int"],
                "patching_rect": [20.0, 250.0, 56.0, 20.0],
                "text": "notein",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-pack-midi",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [20.0, 280.0, 64.0, 20.0],
                "text": "pack 0 0",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-midi",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [20.0, 310.0, 100.0, 20.0],
                "text": "prepend midi_in",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugin",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [20.0, 350.0, 56.0, 20.0],
                "text": "plugin~",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-plugout",
                "maxclass": "newobj",
                "numinlets": 2,
                "numoutlets": 2,
                "outlettype": ["signal", "signal"],
                "patching_rect": [20.0, 480.0, 62.0, 20.0],
                "text": "plugout~",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-buf-sample",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [520.0, 60.0, 210.0, 20.0],
                "text": "buffer~ #0-gssample 2000 2",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-buf-slices",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [520.0, 90.0, 210.0, 20.0],
                "text": "buffer~ #0-gsslices @samps 512",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-buf-state",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["float", "bang"],
                "patching_rect": [520.0, 120.0, 210.0, 20.0],
                "text": "buffer~ #0-gsstate @samps 16",
            }
        },
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
                "patching_rect": [20.0, 390.0, 320.0, 75.0],
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-loadbang",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": ["bang"],
                "patching_rect": [520.0, 155.0, 60.0, 20.0],
                "text": "loadbang",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-genbufs",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [600.0, 155.0, 360.0, 20.0],
                "text": "samp #0-gssample, slices #0-gsslices, state #0-gsstate",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-uibufs",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [600.0, 185.0, 340.0, 20.0],
                "text": "setbuffer #0-gssample #0-gsslices #0-gsstate",
            }
        },
        # File Load Dialog plumbing
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-opendialog",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 2,
                "outlettype": ["", "bang"],
                "patching_rect": [140.0, 220.0, 105.0, 20.0],
                "text": "opendialog sound",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-replace",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [140.0, 250.0, 95.0, 20.0],
                "text": "prepend replace",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-msg-loaded",
                "maxclass": "message",
                "numinlets": 2,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [250.0, 250.0, 95.0, 20.0],
                "text": "sample_loaded",
            }
        },
        # UI Control prepends
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-sens",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [140.0, 285.0, 125.0, 20.0],
                "text": "prepend set_sensitivity",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-keymode",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [140.0, 315.0, 115.0, 20.0],
                "text": "prepend set_keymode",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-capture",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [140.0, 345.0, 115.0, 20.0],
                "text": "prepend set_capture",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-uitrans",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [265.0, 285.0, 105.0, 20.0],
                "text": "prepend set_trans",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-uimorph",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [265.0, 315.0, 105.0, 20.0],
                "text": "prepend set_morph",
            }
        },
        {
            "box": {
                "fontname": "Arial Bold",
                "fontsize": 10.0,
                "id": "obj-prep-uipitch",
                "maxclass": "newobj",
                "numinlets": 1,
                "numoutlets": 1,
                "outlettype": [""],
                "patching_rect": [265.0, 345.0, 105.0, 20.0],
                "text": "prepend set_pitch",
            }
        },
    ]

    for spec in DIALS:
        amber = spec[4] > 80  # bottom row uses amber arc color
        boxes.append(live_dial(spec, amber))
        if spec[11]:
            boxes.append(
                {
                    "box": {
                        "fontname": "Arial Bold",
                        "fontsize": 10.0,
                        "id": f"obj-scale-{spec[0]}",
                        "maxclass": "newobj",
                        "numinlets": 2,
                        "numoutlets": 1,
                        "outlettype": ["float"],
                        "patching_rect": [spec[3], 360.0, 48.0, 20.0],
                        "text": "/ 100.",
                    }
                }
            )
        boxes.append(
            {
                "box": {
                    "fontname": "Arial Bold",
                    "fontsize": 10.0,
                    "id": f"obj-prep-{spec[0]}",
                    "maxclass": "newobj",
                    "numinlets": 1,
                    "numoutlets": 1,
                    "outlettype": [""],
                    "patching_rect": [spec[3], 395.0, 95.0, 20.0],
                    "text": f"prepend {spec[10]}",
                }
            }
        )

    # Background panels MUST be last in the box list with background: 1 so they never cover controls in Live.
    boxes.extend(
        [
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [0.12, 0.13, 0.16, 1.0],
                    "border": 1,
                    "bordercolor": [0.22, 0.25, 0.30, 1.0],
                    "id": "obj-panel-left",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [12.0, 12.0, 372.0, 157.0],
                    "presentation": 1,
                    "presentation_rect": [6.0, 5.0, 378.0, 159.0],
                    "proportion": 0.39,
                    "rounded": 6,
                }
            },
            {
                "box": {
                    "angle": 270.0,
                    "background": 1,
                    "bgcolor": [0.12, 0.13, 0.16, 1.0],
                    "border": 1,
                    "bordercolor": [0.22, 0.25, 0.30, 1.0],
                    "id": "obj-panel-right",
                    "maxclass": "panel",
                    "mode": 0,
                    "numinlets": 1,
                    "numoutlets": 0,
                    "patching_rect": [390.0, 12.0, 344.0, 157.0],
                    "presentation": 1,
                    "presentation_rect": [390.0, 5.0, 344.0, 159.0],
                    "proportion": 0.39,
                    "rounded": 6,
                }
            },
        ]
    )

    lines = [
        # Audio & MIDI routing
        {"patchline": {"source": ["obj-plugin", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-plugin", 1], "destination": ["obj-gen", 1]}},
        {"patchline": {"source": ["obj-gen", 0], "destination": ["obj-plugout", 0]}},
        {"patchline": {"source": ["obj-gen", 1], "destination": ["obj-plugout", 1]}},
        {"patchline": {"source": ["obj-midiin", 0], "destination": ["obj-notein", 0]}},
        {"patchline": {"source": ["obj-notein", 0], "destination": ["obj-pack-midi", 0]}},
        {"patchline": {"source": ["obj-notein", 1], "destination": ["obj-pack-midi", 1]}},
        {"patchline": {"source": ["obj-pack-midi", 0], "destination": ["obj-prep-midi", 0]}},
        {"patchline": {"source": ["obj-prep-midi", 0], "destination": ["obj-ui", 0]}},
        # Loadbang buffer binding
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-genbufs", 0]}},
        {"patchline": {"source": ["obj-loadbang", 0], "destination": ["obj-msg-uibufs", 0]}},
        {"patchline": {"source": ["obj-msg-genbufs", 0], "destination": ["obj-gen", 0]}},
        {"patchline": {"source": ["obj-msg-uibufs", 0], "destination": ["obj-ui", 0]}},
        # v8ui outlet 0 emits gen messages (slice, trigcount, gate, midi_note, keymode, rev, capture)
        {"patchline": {"source": ["obj-ui", 0], "destination": ["obj-gen", 0]}},
        # Sample file load flow
        {"patchline": {"source": ["obj-btn-load", 0], "destination": ["obj-opendialog", 0]}},
        {"patchline": {"source": ["obj-opendialog", 0], "destination": ["obj-prep-replace", 0]}},
        {"patchline": {"source": ["obj-prep-replace", 0], "destination": ["obj-buf-sample", 0]}},
        {"patchline": {"source": ["obj-buf-sample", 1], "destination": ["obj-msg-loaded", 0]}},
        {"patchline": {"source": ["obj-msg-loaded", 0], "destination": ["obj-ui", 0]}},
        # Header controls -> v8ui
        {"patchline": {"source": ["obj-sens", 0], "destination": ["obj-prep-sens", 0]}},
        {"patchline": {"source": ["obj-prep-sens", 0], "destination": ["obj-ui", 0]}},
        {"patchline": {"source": ["obj-keymode", 0], "destination": ["obj-prep-keymode", 0]}},
        {"patchline": {"source": ["obj-prep-keymode", 0], "destination": ["obj-ui", 0]}},
        {"patchline": {"source": ["obj-btn-capture", 0], "destination": ["obj-prep-capture", 0]}},
        {"patchline": {"source": ["obj-prep-capture", 0], "destination": ["obj-ui", 0]}},
        # Mirror key visual dials into v8ui for accurate transient/morph/pitch display
        {"patchline": {"source": ["obj-dial-trans", 0], "destination": ["obj-prep-uitrans", 0]}},
        {"patchline": {"source": ["obj-prep-uitrans", 0], "destination": ["obj-ui", 0]}},
        {"patchline": {"source": ["obj-dial-morph", 0], "destination": ["obj-prep-uimorph", 0]}},
        {"patchline": {"source": ["obj-prep-uimorph", 0], "destination": ["obj-ui", 0]}},
        {"patchline": {"source": ["obj-dial-pitch", 0], "destination": ["obj-prep-uipitch", 0]}},
        {"patchline": {"source": ["obj-prep-uipitch", 0], "destination": ["obj-ui", 0]}},
    ]

    for spec in DIALS:
        name = spec[0]
        if spec[11]:
            lines.append({"patchline": {"source": [f"obj-dial-{name}", 0], "destination": [f"obj-scale-{name}", 0]}})
            lines.append({"patchline": {"source": [f"obj-scale-{name}", 0], "destination": [f"obj-prep-{name}", 0]}})
        else:
            lines.append({"patchline": {"source": [f"obj-dial-{name}", 0], "destination": [f"obj-prep-{name}", 0]}})
        lines.append({"patchline": {"source": [f"obj-prep-{name}", 0], "destination": ["obj-gen", 0]}})

    patcher = {
        "patcher": {
            "fileversion": 1,
            "appversion": {
                "major": 9,
                "minor": 1,
                "revision": 5,
                "architecture": "x64",
                "modernui": 1,
            },
            "classnamespace": "box",
            "rect": [100.0, 100.0, DEVICE_W, DEVICE_H],
            "openrect": [0.0, 0.0, DEVICE_W, DEVICE_H],
            "bglocked": 0,
            "openinpresentation": 1,
            "default_fontsize": 10.0,
            "default_fontface": 0,
            "default_fontname": "Arial Bold",
            "gridonopen": 1,
            "gridsize": [15.0, 15.0],
            "gridsnaponopen": 1,
            "objectsnaponopen": 1,
            "statusbarvisible": 2,
            "toolbarvisible": 1,
            "lefttoolbarpinned": 0,
            "toptoolbarpinned": 0,
            "righttoolbarpinned": 0,
            "bottomtoolbarpinned": 0,
            "toolbars_unpinned_last_save": 0,
            "tallnewobj": 0,
            "boxanimatetime": 200,
            "enablehscroll": 1,
            "enablevscroll": 1,
            "devicewidth": DEVICE_W,
            "description": "Transient-Preserving Granular & Spectral Glitch Slicer with Pitch-Matching Comb Filter",
            "digest": "Better GrainSpec",
            "tags": "Instrument Granular Spectral Glitch Slicer",
            "style": "",
            "subpatcher_template": "",
            "assistshowspatchername": 0,
            "boxes": boxes,
            "lines": lines,
            "parameters": {
                "parameterbanks": {
                    "0": {
                        "index": 0,
                        "name": "",
                        "parameters": [],
                        "buttons": [],
                    }
                },
                "inherited_shortname": 1,
            },
            "dependency_cache": [],
            "autosave": 0,
            "amxdtype": 1768515945,  # 0x69696969 ('iiii' Max Instrument)
        }
    }

    json_bytes = (json.dumps(patcher, indent="\t") + "\n").encode("utf-8")
    header = (
        b"ampf"
        + struct.pack("<I", 4)
        + b"iiii"
        + b"meta"
        + struct.pack("<I", 4)
        + struct.pack("<I", 0)
        + b"ptch"
        + struct.pack("<I", len(json_bytes))
    )
    os.makedirs(os.path.dirname(OUT_AMXD_PATH), exist_ok=True)
    with open(OUT_AMXD_PATH, "wb") as f:
        f.write(header + json_bytes)
    print(f"Built {OUT_AMXD_PATH} ({len(header) + len(json_bytes)} bytes)")


if __name__ == "__main__":
    build()
