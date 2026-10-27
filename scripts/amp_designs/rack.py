"""Amp Rack: a 19-inch studio amp-modeler unit. A VFD window (model browser, level meters, layer activity
waterfall) and a LOAD button are drawn in the v8ui; the parameters are native live.numbox faders,
a live.tab and a live.text toggle on the right of the faceplate (outside the v8ui)."""
SLUG = "rack"
DEVICE = "Amp Rack"
WIDTH = 620
FACE_FILES = ["amp_face_rack.js"]
VIZ = [0, 0, 372, 169]
DROP = None

ACC = [0.34, 0.96, 0.78, 1.0]            # VFD cyan-green
BG = [0.055, 0.075, 0.08, 1.0]           # dark glass / widget background
FILL = [0.38 * ACC[0] + 0.62 * BG[0], 0.38 * ACC[1] + 0.62 * BG[1], 0.38 * ACC[2] + 0.62 * BG[2], 1.0]  # pre-blended
TXT = [0.74, 1.0, 0.92, 1.0]
EDGE = [0.2, 0.3, 0.3, 1.0]

_FADER = {"kind": "numbox", "appearance": 2, "fontsize": 8.0, "activebgcolor": BG, "activeslidercolor": FILL,
          "textcolor": TXT, "bordercolor": EDGE, "bgcolor": BG}

_COL = [(380, 418), (494, 530)]           # (label x, slider x) of the two fader columns
_ROWS = [10, 32, 54, 76]
_ORDER = [("input", "INPUT"), ("gate", "GATE"), ("bass", "BASS"), ("mid", "MID"),
          ("treble", "TREBLE"), ("presence", "PRES"), ("output", "OUTPUT"), ("mix", "MIX")]

WIDGETS = {}
LABELS = []
for _i, (_k, _t) in enumerate(_ORDER):
    _c, _r = _i % 2, _i // 2
    _lx, _sx = _COL[_c]
    WIDGETS[_k] = dict(_FADER, rect=[_sx, _ROWS[_r], 68, 15])
    LABELS.append((f"obj-lbl-{_k}", _t, [_lx, _ROWS[_r] + 1, 38, 13], 7.5, TXT, 0))

WIDGETS["cab"] = {"kind": "tab", "rect": [418, 106, 180, 18], "fontsize": 8.0, "bgcolor": BG, "activebgcolor": BG,
                  "activebgoncolor": FILL, "textcolor": [0.55, 0.78, 0.72, 1.0], "activetextcolor": [0.55, 0.78, 0.72, 1.0],
                  "activetextoncolor": [0.9, 1.0, 0.96, 1.0], "bordercolor": EDGE}
WIDGETS["normalize"] = {"kind": "toggle", "rect": [418, 134, 180, 18], "fontsize": 8.0, "text": "LEVEL MATCH  OFF",
                        "texton": "LEVEL MATCH  ON", "bgcolor": BG, "bgoncolor": FILL, "textcolor": [0.55, 0.78, 0.72, 1.0],
                        "textoncolor": [0.9, 1.0, 0.96, 1.0], "bordercolor": EDGE}
LABELS += [("obj-lbl-cab", "CAB", [380, 109, 36, 13], 7.5, TXT, 0),
           ("obj-lbl-norm", "NORM", [380, 137, 36, 13], 7.5, TXT, 0)]

PANELS = []
for _y in (24, 133):                    # right ear: screw slots, screw heads, oval holes
    PANELS.append((f"obj-ear-slot-{_y}", [609, _y + 6, 6, 2], [0.1, 0.1, 0.11, 1.0], 1))
for _y in (24, 133):
    PANELS.append((f"obj-ear-screw-{_y}", [608, _y + 1, 8, 12], [0.55, 0.56, 0.58, 1.0], 4))
for _y in (24, 133):
    PANELS.append((f"obj-ear-hole-{_y}", [606, _y - 2, 12, 18], [0.03, 0.03, 0.035, 1.0], 6))
PANELS += [
    ("obj-ear-right", [604, 0, 16, 169], [0.30, 0.31, 0.33, 1.0], 0),
    ("obj-panel-recess", [376, 4, 224, 161], [0.1, 0.125, 0.13, 1.0], 4),
    ("obj-panel-body", [0, 0, 620, 169], [0.17, 0.175, 0.18, 1.0], 0),
]
DESCRIPTION = "Rack-mount neural amp: VFD model browser with level meters and layer activity waterfall, native fader bars."
