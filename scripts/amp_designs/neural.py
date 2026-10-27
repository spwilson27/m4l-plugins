"""Neural Amp: laid out like Ableton's Amp. The v8ui at the top left is the display (the network the model runs:
layers as node columns, dilated taps, a signal pulse, the input / output waveforms); it only draws, and an
invisible .nam drop zone lies over it. Under it the model tabs (8 built-in captures + File) and the Load button,
then the knob row with the Normalize switch in the gap; the right column holds Output mode, Cabinet, Volume and
Dry/Wet. Every parameter is a native Live widget."""
SLUG = "neural"
DEVICE = "Neural Amp"
WIDTH = 470
FACE_FILES = ["spectral_theme.js", "amp_face_neural.js"]
VIZ = [6, 4, 380, 89]
VIZ_IGNORECLICK = True
DROP = [6, 4, 380, 89]
DROP_INVISIBLE = True
LOAD = [348, 96, 38, 15]


def _dial(x, y):
    return {"kind": "dial", "rect": [x, y, 44, 48]}


WIDGETS = {
    "model": {"kind": "tab", "rect": [6, 96, 338, 15]},
    "gain": _dial(8, 115), "gate": _dial(60, 115),
    "normalize": {"kind": "toggle", "rect": [110, 132, 56, 15], "text": "Normalize", "texton": "Normalize"},
    "bass": _dial(170, 115), "mid": _dial(222, 115), "treble": _dial(274, 115), "presence": _dial(330, 115),
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
