"""Amp Neural: Ableton-native face. The v8ui draws the network the model runs (layers as node columns,
dilated taps, a signal pulse); every parameter is a native Live widget in the right column."""
SLUG = "neural"
DEVICE = "Amp Neural"
WIDTH = 520
FACE_FILES = ["spectral_theme.js", "amp_face_neural.js"]
VIZ = [4, 4, 330, 161]
DROP = [340, 147, 174, 18]

_DIAL = {"kind": "dial"}


def _dial(col, row):
    return {"kind": "dial", "rect": [340 + 44 * col, 3 + 52 * row, 44, 48]}


WIDGETS = {
    "input": _dial(0, 0), "gate": _dial(1, 0), "bass": _dial(2, 0), "mid": _dial(3, 0),
    "treble": _dial(0, 1), "presence": _dial(1, 1), "output": _dial(2, 1), "mix": _dial(3, 1),
    "cab": {"kind": "tab", "rect": [340, 107, 174, 16]},
    "normalize": {"kind": "toggle", "rect": [340, 127, 174, 16], "text": "Normalize", "texton": "Normalize"},
}
LABELS = []
# Section panels first, body panel last (Max draws earlier background panels over later ones).
PANELS = [
    ("obj-panel-ctl", [337, 3, 180, 163], [0.165, 0.165, 0.165, 1.0], 3),
    ("obj-panel-body", [0, 0, 520, 169], [0.212, 0.212, 0.212, 1.0], 0),
]
DESCRIPTION = "Neural amp (NAM / Tone 3000 captures): a live view of the network's layers and dilated taps, native Live controls."
