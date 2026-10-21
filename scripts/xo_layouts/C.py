"""XO Sample Map layout "C" -- Tabbed Inspector (devices/XO Sample Map C.amxd).

Big map pane + ONE inspector on the right. Filters and Playback are its two tabs: the toolbar toggles and the
tab buttons in the inspector header pick the tab, the toolbar toggles show / hide each tab
independent show / hide: one on = a one-tab inspector, both on = the two tabs side by side (width stays
additive). The tab button in each header swaps to the other tab (other on, this off). Contract: scripts/xo_layouts/README.md.
"""

NAME = "C"
DEVICE_NAME = "XO Sample Map C"
LAYOUT_JS = "src/xo_layouts/C.js"
DEVICE_WIDTH = 898.0   # = computeXoLayout(1, 1, 1).deviceWidth: 342 + 136 (Saved) + 2 x 210 (both tabs)
# 28 toolbar + 300 map + 8 panel pad + 6 gap; Saved adds 136; each inspector tab 204 + 6 gap.
WIDTH_EXPR = "expr 342 + $i1 * 136 + $i2 * 210 + $i3 * 210"

_F, _P = 478.0, 688.0   # inspector x with Saved shown: Filters tab, Playback tab (side by side only when both are on)
_BASE = {
    "obj-panel-toolbar": [3.0, 5.0, 22.0, 159.0],
    "obj-toggle-saved-btn": [6.0, 9.0, 16.0, 16.0],
    "obj-toggle-filters-btn": [6.0, 28.0, 16.0, 16.0],
    "obj-toggle-playback-btn": [6.0, 47.0, 16.0, 16.0],
    "obj-panel-left": [28.0, 5.0, 444.0, 159.0],
    "obj-minimap": [32.0, 8.0, 436.0, 154.0],
    "obj-panel-filters": [_F, 5.0, 204.0, 159.0],
    "obj-hdr-filters": [_F + 8, 8.0, 92.0, 15.0],
    "obj-reseed-filtered-btn": [_F + 112, 28.0, 52.0, 16.0],
    "obj-search-clear-btn": [_F + 168, 28.0, 30.0, 16.0],
    "obj-search-box": [_F + 6, 28.0, 102.0, 16.0],
    "obj-maxlen-dial": [_F + 6, 48.0, 46.0, 46.0],
    "obj-tone-dial": [_F + 54, 48.0, 46.0, 46.0],
    "obj-filter-tonal-dial": [_F + 102, 48.0, 46.0, 46.0],
    "obj-filter-drum-dial": [_F + 150, 48.0, 46.0, 46.0],
    "obj-folder-list": [_F + 6, 97.0, 192.0, 62.0],
    "obj-panel-playback": [_P, 5.0, 204.0, 159.0],
    "obj-hdr-playback": [_P + 8, 8.0, 92.0, 15.0],
    "obj-reverse-btn": [_P + 6, 28.0, 192.0, 16.0],
    "obj-pitch-dial": [_P + 10, 52.0, 48.0, 46.0],
    "obj-speed-dial": [_P + 78, 52.0, 48.0, 46.0],
    "obj-grain-dial": [_P + 146, 52.0, 48.0, 46.0],
    "obj-decay-dial": [_P + 10, 108.0, 48.0, 46.0],
    "obj-stretch-mode": [_P + 78, 108.0, 48.0, 46.0],
    "obj-gain-dial": [_P + 146, 108.0, 48.0, 46.0],
}
_EXTRA = {   # presentation-only boxes created by customize()
    "obj-tab-f-to-p": [_F + 104, 8.0, 92.0, 15.0],
    "obj-tab-p-to-f": [_P + 104, 8.0, 92.0, 15.0],
}


class _Rects(dict):
    """All layout ids (the build checks the keys), but items() only yields boxes that exist before customize()."""
    def items(self):
        return [(k, v) for k, v in dict.items(self) if k in _BASE]


RECTS = _Rects(_BASE)
RECTS.update(_EXTRA)

CY = [0.22, 0.74, 0.97, 1.0]
AM = [1.0, 0.709804, 0.196078, 1.0]
INK = [0.075, 0.09, 0.115, 1.0]

STYLE = {
    "obj-panel-toolbar": {"bgcolor": [0.09, 0.105, 0.13, 1.0], "bordercolor": [0.2, 0.24, 0.3, 1.0]},
    "obj-panel-left": {"bgcolor": [0.07, 0.082, 0.105, 1.0], "bordercolor": [0.2, 0.24, 0.3, 1.0]},
    "obj-panel-filters": {"bgcolor": [0.105, 0.125, 0.155, 1.0], "bordercolor": [0.22, 0.74, 0.97, 0.7]},
    "obj-panel-playback": {"bgcolor": [0.125, 0.12, 0.13, 1.0], "bordercolor": [1.0, 0.694, 0.18, 0.7]},
    "obj-hdr-filters": {"text": "FILTERS", "fontsize": 10.0},
    "obj-hdr-playback": {"text": "PLAYBACK", "fontsize": 10.0},
}


def _tab(box_id, text, col, rect):
    return {"box": {
        "activebgcolor": [0.10, 0.12, 0.15, 1.0], "activebgoncolor": col,
        "activetextcolor": [0.62, 0.68, 0.76, 1.0], "activetextoncolor": INK,
        "annotation": "Switch the inspector to the %s tab." % text.strip("<>‹› "),
        "annotation_name": "Inspector tab %s" % text,
        "bordercolor": [0.28, 0.33, 0.40, 1.0], "fontsize": 9.0,
        "id": box_id, "maxclass": "live.text", "mode": 0, "numinlets": 1, "numoutlets": 2,
        "outlettype": ["", ""], "parameter_enable": 0,
        "patching_rect": [30.0, 700.0, 92.0, 15.0], "presentation": 1,
        "presentation_rect": [float(v) for v in rect], "text": text, "texton": text, "varname": box_id,
    }}


def _bar(box_id, col, rect):
    return {"box": {
        "angle": 270.0, "background": 1, "bgcolor": [col[0] * 0.22, col[1] * 0.22, col[2] * 0.22, 1.0],
        "border": 1, "bordercolor": [col[0], col[1], col[2], 0.45], "id": box_id, "maxclass": "panel",
        "mode": 0, "numinlets": 1, "numoutlets": 0, "patching_rect": [30.0, 720.0, 100.0, 20.0],
        "presentation": 1, "presentation_rect": [float(v) for v in rect], "proportion": 0.39, "rounded": 4,
    }}


def _obj(box_id, text, cls, x, y, outs):
    b = {"id": box_id, "maxclass": cls, "numinlets": 1, "numoutlets": outs, "patching_rect": [x, y, 40.0, 20.0],
         "text": text, "fontname": "Arial Bold", "fontsize": 10.0}
    b["outlettype"] = ["bang", ""] if (cls == "newobj" and outs == 2) else [""]
    if cls == "message":
        b["numinlets"] = 2
    return {"box": b}


def customize(boxes_by_id, boxes, lines):
    first_bg = next(i for i, b in enumerate(boxes) if b["box"].get("background") == 1)
    logic = [
        _tab("obj-tab-f-to-p", "Playback ›", AM, _EXTRA["obj-tab-f-to-p"]),
        _tab("obj-tab-p-to-f", "‹ Filters", CY, _EXTRA["obj-tab-p-to-f"]),
        # tab press (1 only) -> t b b: right = `1` into the target section toggle, then left = `0` into this one
        _obj("obj-xc-sel-fp", "sel 1", "newobj", 30, 760, 2), _obj("obj-xc-t-fp", "t b b", "newobj", 30, 790, 2),
        _obj("obj-xc-one-p", "1", "message", 60, 820, 1), _obj("obj-xc-zero-f", "0", "message", 30, 820, 1),
        _obj("obj-xc-sel-pf", "sel 1", "newobj", 130, 760, 2), _obj("obj-xc-t-pf", "t b b", "newobj", 130, 790, 2),
        _obj("obj-xc-one-f", "1", "message", 160, 820, 1), _obj("obj-xc-zero-p", "0", "message", 130, 820, 1),
    ]
    boxes[first_bg:first_bg] = logic
    for b in boxes:
        boxes_by_id[b["box"]["id"]] = b["box"]
    # header label is a plain title on the bar; match the tab fonts
    boxes_by_id["obj-hdr-filters"]["textcolor"] = CY
    boxes_by_id["obj-hdr-playback"]["textcolor"] = AM
    tf, tp = "obj-toggle-filters-btn", "obj-toggle-playback-btn"
    def L(a, b):
        lines.append({"patchline": {"source": [a, 0], "destination": [b, 0]}})
    L("obj-tab-f-to-p", "obj-xc-sel-fp"); L("obj-xc-sel-fp", "obj-xc-t-fp")
    lines.append({"patchline": {"source": ["obj-xc-t-fp", 1], "destination": ["obj-xc-one-p", 0]}})
    lines.append({"patchline": {"source": ["obj-xc-t-fp", 0], "destination": ["obj-xc-zero-f", 0]}})
    L("obj-xc-one-p", tp); L("obj-xc-zero-f", tf)
    L("obj-tab-p-to-f", "obj-xc-sel-pf"); L("obj-xc-sel-pf", "obj-xc-t-pf")
    lines.append({"patchline": {"source": ["obj-xc-t-pf", 1], "destination": ["obj-xc-one-f", 0]}})
    lines.append({"patchline": {"source": ["obj-xc-t-pf", 0], "destination": ["obj-xc-zero-p", 0]}})
    L("obj-xc-one-f", tf); L("obj-xc-zero-p", tp)
