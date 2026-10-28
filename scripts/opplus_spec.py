#!/usr/bin/env python3
"""Operator+ parameter table, derived from the real Operator.

scripts/opplus_ref_params.json / opplus_ref_curves.json are LOM dumps of Live 12.4.7's Operator (VM, 2026-10-27,
scripts/opplus_ref_capture.js): every DeviceParameter's name, range, quantised items, the default patch value and
`str_for_value` at 65 points. Operator+ exposes exactly those parameters with the same names, ranges and order
(Device On excepted: M4L supplies its own), then the stored-only extras Operator keeps out of the LOM (Repeat, Voices,
Retrigger, Interpolation, Antialias, the MIDI matrix) and the UI state. ORDER IS FOREVER: append only.

  spec()        list of dicts {key, name, min, max, init, items, enum, kind, style, table, extra}
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

MATRIX_DESTS = ["Off", "OSC Volume A", "OSC Volume B", "OSC Volume C", "OSC Volume D", "OSC Crossfade A/C",
                "OSC Crossfade B/D", "OSC Feedback", "OSC Fixed Frequency", "FM Drive", "Filter Freq", "Filter Res",
                "Filter Morph", "Filter Drive", "Filter Envelope Amount", "Shaper Drive", "LFO Rate", "LFO Amount",
                "Aux Envelope Amount", "Volume", "Panorama", "Tone", "Time"]
# Parameters Live displays truncated toward zero (integer parameters inside Operator); all others round half to even.
# Found by tests/test_opplus.js against the 65-point str_for_value dump.
TRUNC = {"Transpose", "PB Range", "Pan < Key", "Pan < Rnd", "Spread", "Time", "Time < Key", "Pe Init", "Pe Peak", "Pe Sustain",
         "Pe End", "Pe R < Vel", "Le R < Vel", "Filt < Vel", "Filt < Key", "Fe Amount", "Fe R < Vel", "Shaper Mix"}
for _o in "ABCD":
    TRUNC |= {"%s Fine" % _o, "Osc-%s Phase" % _o, "Osc-%s Lev < Vel" % _o, "Osc-%s Lev < Key" % _o, "Osc-%s Feedb" % _o,
              "%se R < Vel" % _o}
VOICES = ["1", "2", "3", "4", "5", "6", "7", "8", "10", "12", "14", "16", "20", "24", "32"]
REPEAT = ["Off", "1/4", "1/2", "1", "2", "4"]


def key_of(name):
    k = name.strip().lower().replace("<", " lt ").replace("&", " and ").replace("/", " ")
    return re.sub(r"[^a-z0-9]+", "_", k).strip("_")


def _num(s):
    """'2.11 ms' -> (2.11 ms in ms, 'ms'), '-inf dB' -> (-inf, 'dB'), '50L' -> (-50, 'pan'), '1/48' -> ('1/48', 'frac')"""
    s = s.strip()
    if s == "C":
        return 0.0, "pan"
    m = re.match(r"^(\d+)([LR])$", s)
    if m:
        return (-1 if m.group(2) == "L" else 1) * float(m.group(1)), "pan"
    if "/" in s and " " not in s:
        return s, "frac"
    m = re.match(r"^([+-]?(?:inf|\d+(?:\.\d+)?))\s*(.*)$", s)
    if not m:
        return s, "text"
    v = float(m.group(1).replace("inf", "Infinity")) if "inf" in m.group(1) else float(m.group(1))
    u = m.group(2)
    if u == "s":
        v, u = v * 1000.0, "ms"
    if u == "kHz":
        v, u = v * 1000.0, "Hz"
    return v, u


def style_of(strs):
    """Infer Operator's display style from its 65 strings: unit + decimals rule."""
    if any("/" in s and " " not in s for s in strs):
        return "frac"
    if any(s.endswith(("lp/bp", "bp/hp", "hp/no", "no/lp")) for s in strs):
        return "morph"
    units = set()
    for s in strs:
        units.add(_num(s)[1])
    u = sorted(units)[0] if len(units) == 1 else ("ms" if "ms" in units else ("Hz" if "Hz" in units else sorted(units)[0]))
    if u == "frac":
        return "frac"
    if u == "pan":
        return "pan"
    if u == "st":
        return "st"
    if u in ("ms", "Hz"):
        return u
    if u == "dB":
        # sig3 ("0.00 dB", "12.0 dB") vs level ("0.0 dB", "-35 dB")
        return "dB3" if any(re.match(r"^-?\d+\.\d\d dB$", s) for s in strs) else "dB"
    if u == "%":
        if any(re.match(r"^-?\d+\.\d %$", s) for s in strs):
            return "pct1"
        return "pct"
    if u == "":
        if any(s == "0.5" for s in strs):
            return "coarse"
        if any(s in ("0.001", "0.01") for s in strs):
            return "mul"
        if any(re.match(r"^-?\d+\.\d\d$", s) for s in strs):
            return "num2"
        if any(s in ("0.001", "0.01") for s in strs):
            return "mul"
        if any(re.match(r"^-?\d+\.\d$", s) for s in strs):
            return "num1"
        return "int"
    return "text"


ENV_NAMES = {"Ae": "oscillator A's envelope", "Be": "oscillator B's envelope", "Ce": "oscillator C's envelope",
             "De": "oscillator D's envelope", "Le": "the LFO envelope", "Fe": "the filter envelope", "Pe": "the pitch envelope"}
ENV_PART = {"Attack": "Attack time of %s.", "Init": "Initial level of %s, where the attack starts.", "Decay": "Decay time of %s.",
            "Peak": "Peak level of %s, reached at the end of the attack.", "Sustain": "Sustain level of %s while the note is held.",
            "Release": "Release time of %s after the note ends.", "End": "Level %s falls to at the end of the release.",
            "Mode": "Loop mode of %s: None, Loop, Beat, Sync or Trigger.", "Loop": "Loop time of %s in Loop mode.",
            "Retrig": "Repeat time of %s in Beat and Sync mode.", "R < Vel": "How much velocity shortens the times of %s.",
            "A Slope": "Curve of the attack of %s.", "D Slope": "Curve of the decay of %s.", "R Slope": "Curve of the release of %s."}
OSC_PART = {"On": "Switches oscillator %s on or off.", "Coarse": "Frequency ratio of oscillator %s to the played note.",
            "Fine": "Fine frequency ratio of oscillator %s, in thousandths of the coarse ratio.",
            "Freq<Vel": "How much velocity changes the frequency of oscillator %s.", "Quantize": "Quantizes Freq<Vel of oscillator %s to whole ratios.",
            "Fix On": "Plays oscillator %s at a fixed frequency instead of following the keyboard.",
            "Fix Freq": "Fixed frequency of oscillator %s.", "Fix Freq Mul": "Multiplier of the fixed frequency of oscillator %s.",
            "Level": "Output level of oscillator %s.", "Retrig": "Restarts the phase of oscillator %s with every note.",
            "Phase": "Start phase of oscillator %s.", "Lev < Vel": "How much velocity changes the level of oscillator %s.",
            "Lev < Key": "How much the played key changes the level of oscillator %s.", "Wave": "Waveform of oscillator %s.",
            "Feedb": "Feedback of oscillator %s onto itself (only when nothing modulates it).",
            "< Pe": "Lets the pitch envelope modulate oscillator %s.", "< LFO": "Lets the LFO modulate the pitch of oscillator %s.",
            "Repeat": "How a user waveform of oscillator %s repeats its partials above the editor's range."}
INFO = {"Algorithm": "Algorithm: how the four oscillators modulate each other.", "Transpose": "Transposes the whole instrument in semitones.",
        "PB Range": "Pitch bend range in semitones.", "Volume": "Output volume of the instrument.", "Panorama": "Stereo position of the output.",
        "Pan < Key": "How much the played key moves the stereo position.", "Pan < Rnd": "Random stereo position of each note.",
        "Tone": "High-frequency content of the output (aliasing products).", "Spread": "Detunes two copies of each voice, panned left and right.",
        "Glide On": "Glides from the previous note to the new one.", "Glide Time": "Time a glide takes.",
        "Time": "Scales the times of every envelope.", "Time < Key": "How much the played key scales the envelope times.",
        "Pe On": "Switches the pitch envelope on or off.", "Pe Amount": "Amount of the pitch envelope.",
        "Pe Amt A": "Pitch envelope amount on its A destinations.", "Pe Dst B": "Second destination of the pitch envelope.",
        "Pe Amt B": "Pitch envelope amount on destination B.", "LFO On": "Switches the LFO on or off.",
        "LFO Type": "Waveform of the LFO.", "LFO Range": "Rate range of the LFO: Low, High or tempo Sync.", "LFO Rate": "Rate of the LFO.",
        "LFO Sync": "Tempo-synced rate of the LFO.", "LFO R < K": "How much the played key raises the LFO rate.",
        "LFO Retrigger": "Restarts the LFO with every note.", "LFO Amt": "Overall amount of the LFO.",
        "LFO Amt A": "LFO amount on its A destinations.", "LFO Dst B": "Second destination of the LFO.", "LFO Amt B": "LFO amount on destination B.",
        "LFO < Vel": "How much velocity changes the LFO amount.", "LFO < Pe": "Lets the pitch envelope modulate the LFO rate.",
        "Filter On": "Switches the filter on or off.", "Filter Type": "Filter type: lowpass, highpass, bandpass, notch or morph.",
        "Filter Circuit - LP/HP": "Filter circuit model for lowpass and highpass.", "Filter Circuit - BP/NO/Morph": "Filter circuit model for bandpass, notch and morph.",
        "Filter Slope": "Filter slope: 12 or 24 dB per octave.", "Filter Freq": "Cutoff frequency of the filter.", "Filter Res": "Resonance of the filter.",
        "Filter Morph": "Morph position: lowpass, bandpass, highpass, notch and back.", "Filter Drive": "Drive into the filter circuit.",
        "Filt < Vel": "How much velocity moves the filter cutoff.", "Filt < Key": "How much the played key moves the filter cutoff.",
        "Fe Amount": "Amount of the filter envelope on the cutoff.", "Filt < LFO": "Lets the LFO modulate the filter cutoff.",
        "Shaper Type": "Waveshaper curve after the filter.", "Shaper Mix": "Dry/wet mix of the waveshaper.", "Shaper Drive": "Drive into the waveshaper."}


def info_of(name):
    n = name.strip()
    if n in INFO:
        return INFO[n]
    m = re.match(r"^(Ae|Be|Ce|De|Le|Fe|Pe) (.+)$", n)
    if m and m.group(2) in ENV_PART:
        return ENV_PART[m.group(2)] % ENV_NAMES[m.group(1)]
    m = re.match(r"^(?:Osc-)?([A-D]) ?(.+)$", n)
    if m and m.group(2).strip() in OSC_PART:
        return OSC_PART[m.group(2).strip()] % m.group(1)
    return "%s of Operator+." % n


def spec():
    ref = json.load(open(os.path.join(HERE, "opplus_ref_params.json")))
    curves = json.load(open(os.path.join(HERE, "opplus_ref_curves.json")))
    out = []
    for e in ref:
        if e["name"] == "Device On":
            continue
        d = {"key": key_of(e["name"]), "name": e["name"], "min": e["min"], "max": e["max"],
             "init": e["value"], "items": e["items"] if e["q"] else [], "enum": bool(e["q"]), "extra": False,
             "trunc": e["name"] in TRUNC, "info": info_of(e["name"])}
        if not e["q"]:
            strs = curves[e["name"]]
            d["style"] = style_of(strs)
            if d["style"] in ("frac", "morph"):
                d["table"] = []
                d["strs"] = strs
            else:
                d["table"] = [max(_num(s)[0], -999.0) for s in strs]   # -inf dB -> -999 (JSON has no infinity)
        else:
            d["style"] = "enum"
        out.append(d)

    def extra(key, name, items=None, mn=0.0, mx=1.0, init=0.0, style="enum", invisible=1, info=None):
        info = info or ("%s (stored with the Set) of Operator+." % name)
        out.append({"key": key, "name": name, "min": mn, "max": mx, "init": init, "items": items or [],
                    "enum": bool(items), "extra": True, "style": style, "invisible": invisible, "info": info})

    for o in "ABCD":
        extra("osc_%s_repeat" % o.lower(), "Osc-%s Repeat" % o, REPEAT)
    extra("voices", "Voices", VOICES, init=5)
    extra("retrigger", "Retrigger", ["Off", "On"])
    extra("interpolation", "Interpolation", ["Off", "On"], init=1)
    extra("antialias", "Antialias", ["Off", "On"], init=1)
    for src in ("Vel", "Key", "AT", "PB", "MW"):
        extra("mx_%s_dst_a" % src.lower(), "%s Dst A" % src, MATRIX_DESTS)
        extra("mx_%s_amt_a" % src.lower(), "%s Amt A" % src, mn=-1.0, mx=1.0, style="num2")
        if src in ("Vel", "AT", "MW"):
            extra("mx_%s_dst_b" % src.lower(), "%s Dst B" % src, MATRIX_DESTS)
            extra("mx_%s_amt_b" % src.lower(), "%s Amt B" % src, mn=-1.0, mx=1.0, style="num2")
    # UI state (not automatable): selected section 0..7 = A B C D LFO Filter Pitch Global, the display view of each
    # section (0 Envelope / 1 Oscillator|LFO|Filter|Aux), the slope view of the Filter / Pitch envelopes
    extra("ui_section", "UI Section", ["A", "B", "C", "D", "LFO", "Filter", "Pitch", "Global"])
    for i, s in enumerate(["A", "B", "C", "D", "LFO", "Filter", "Pitch"]):
        extra("ui_view_%s" % s.lower(), "UI View %s" % s, ["Envelope", "Other"])
    extra("ui_slope_fe", "UI Slope Fe", ["Times", "Slopes"])
    extra("ui_slope_pe", "UI Slope Pe", ["Times", "Slopes"])
    keys = [p["key"] for p in out]
    assert len(keys) == len(set(keys)), "duplicate keys"
    return out



def write_json(path=None):
    path = path or os.path.join(HERE, "opplus_params.json")
    with open(path, "w") as f:
        json.dump(spec(), f, indent=0)
    return path


if __name__ == "__main__":
    write_json()
    s = spec()
    print(len(s), "parameters")
    for p in s:
        print(p["key"], "|", p["name"], "|", p["style"], p.get("table", [""])[:3] if not p["enum"] else p["items"][:3])
