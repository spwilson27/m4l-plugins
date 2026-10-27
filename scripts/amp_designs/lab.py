"""Amp Lab: an analytical, oscilloscope-style face (transfer plot, tone response, harmonic spectrum)."""
SLUG = "lab"
DEVICE = "Amp Lab"
WIDTH = 640
FACE_FILES = ["amp_face_lab.js"]
VIZ = [0, 0, 510, 169]
DROP = None

TXT = [0.82, 0.96, 0.94, 1.0]
BG = [0.03, 0.06, 0.07, 1.0]
# Live ignores alpha in activeslidercolor: pre-blended 38 % teal over the dark background
SLIDER = [0.1, 0.36, 0.35, 1.0]
SLIDER_AMBER = [0.38, 0.27, 0.07, 1.0]


def _num(y, appearance=2, slider=SLIDER):
    return {"kind": "numbox", "rect": [566, y, 66, 15], "appearance": appearance, "textcolor": TXT,
            "lcdcolor": TXT, "activebgcolor": BG, "activeslidercolor": slider, "bgcolor": BG,
            "bordercolor": [0.1, 0.25, 0.27, 1.0]}


WIDGETS = {
    "input": _num(24, 3),
    "gate": _num(48, 2, SLIDER_AMBER),
    "output": _num(72, 2),
    "mix": _num(96, 2),
    "normalize": {"kind": "toggle", "rect": [520, 126, 112, 15], "text": "NORMALIZE", "texton": "NORMALIZE",
                  "bgcolor": [0.03, 0.06, 0.07, 1.0], "activebgcolor": [0.25, 0.9, 0.85, 1.0],
                  "textcolor": [0.35, 0.6, 0.6, 1.0], "activetextcolor": [0.02, 0.08, 0.08, 1.0],
                  "bordercolor": [0.1, 0.25, 0.27, 1.0], "fontsize": 8.0},
}
_L = [0.35, 0.75, 0.72, 1.0]
LABELS = [
    ("obj-lbl-head", "GAIN STAGE", [520, 5, 112, 14], 8, [0.25, 0.9, 0.85, 1.0], 0),
    ("obj-lbl-in", "INPUT", [520, 24, 44, 15], 7.5, _L, 0),
    ("obj-lbl-gate", "GATE", [520, 48, 44, 15], 7.5, [1.0, 0.7, 0.2, 1.0], 0),
    ("obj-lbl-out", "OUTPUT", [520, 72, 44, 15], 7.5, _L, 0),
    ("obj-lbl-mix", "MIX", [520, 96, 44, 15], 7.5, _L, 0),
    ("obj-lbl-foot", "AMP LAB  /  NAM", [520, 148, 112, 14], 7, [0.2, 0.42, 0.42, 1.0], 0),
]
PANELS = [
    ("obj-panel-gain", [514, 4, 122, 161], [0.025, 0.05, 0.058, 1.0], 3),
    ("obj-panel-body", [0, 0, 640, 169], [0.008, 0.016, 0.02, 1.0], 0),
]
DESCRIPTION = "Neural amp lab: transfer scope of the model's nonlinearity, draggable tone-stack response and harmonic spectrum."
