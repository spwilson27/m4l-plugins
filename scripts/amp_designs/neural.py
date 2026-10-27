"""Neural Amp: laid out like Ableton's Amp. The v8ui at the top left is the display (the network the model runs:
layers as node columns, dilated taps, a signal pulse, the input / output waveforms); it only draws, and an
invisible .nam drop zone lies over it. Under it the model tabs (12 built-in captures + File, two rows) and the Load button,
then the knob row with the Normalize and Pre-EQ switches in the gap; the right column holds Output mode, Cabinet, Volume and
Dry/Wet. Every parameter is a native Live widget."""
SLUG = "neural"
DEVICE = "Neural Amp"
WIDTH = 470
FACE_FILES = ["spectral_theme.js", "amp_face_neural.js"]
VIZ = [6, 4, 380, 78]
VIZ_IGNORECLICK = True
DROP = [6, 4, 380, 78]
DROP_INVISIBLE = True
LOAD = [348, 86, 38, 30]


def _dial(x, y):
    return {"kind": "dial", "rect": [x, y, 44, 48]}


WIDGETS = {
    "model": {"kind": "tab", "rect": [6, 86, 338, 30], "rows": 2},
    "gain": _dial(8, 119), "gate": _dial(60, 119),
    "normalize": {"kind": "toggle", "rect": [110, 125, 56, 15], "text": "Normalize", "texton": "Normalize"},
    "eqpos": {"kind": "toggle", "rect": [110, 145, 56, 15], "text": "Pre-EQ", "texton": "Pre-EQ"},
    "bass": _dial(170, 119), "mid": _dial(222, 119), "treble": _dial(274, 119), "presence": _dial(330, 119),
    "stereo": {"kind": "toggle", "rect": [401, 18, 60, 15], "text": "Mono", "texton": "Stereo"},
    "cab": {"kind": "menu", "rect": [401, 48, 60, 15]},
    "volume": _dial(409, 66), "mix": _dial(409, 118),
}
LABELS = [
    ("obj-lbl-output", "Output", [395, 4, 72, 14], 9.5, None, 1),
    ("obj-lbl-cab", "Cabinet", [395, 34, 72, 14], 9.5, None, 1),
]
# Section panels first, body panel last (Max draws earlier background panels over later ones).
PANELS = [
    ("obj-panel-side", [392, 3, 75, 163], [0.165, 0.165, 0.165, 1.0], 3, "live_desktop"),
    ("obj-panel-body", [0, 0, 470, 169], [0.212, 0.212, 0.212, 1.0], 0, "live_surface_bg"),
]
DESCRIPTION = "Neural amp (NAM / Tone 3000 captures) laid out like Ableton's Amp: a live view of the network's layers, native Live controls."
