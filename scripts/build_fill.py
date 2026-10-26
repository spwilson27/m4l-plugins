#!/usr/bin/env python3
"""Build devices/Fill.amxd. 400x169, one column of wings, one picture."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT = sc.ROOT_DIR
W = 400
LATENCY = 1536
BANK_FLOATS = 32 * 129 * 4 + 6 * 2049 * 4  # 65688, matches src/fill_config.js
IR_BANKS = 4
VIZ = [164, 22, 232, 147]

# center key, long, short, lo, hi, initial, ptype, unit, bipolar,
# range key, range long, range short, range hi, range unit
NORMAL = [
    ("tune", "Tune", "Tune", -24, 24, 0, 0, 7, True, "tuner", "Tune Range", "Tune R", 24, 7),
    ("strike", "Strike", "Strike", 0, 100, 0, 0, 5, False, "striker", "Strike Range", "Strk R", 100, 5),
    ("damp", "Damp", "Damp", 0, 100, 0, 0, 5, False, "dampr", "Damp Range", "Damp R", 100, 5),
    ("beater", "Beater", "Beater", 0, 200, 100, 0, 5, False, "beaterr", "Beater Range", "Beat R", 200, 5),
    ("metal", "Metal", "Metal", 0, 200, 100, 0, 5, False, "metalr", "Metal Range", "Metl R", 200, 5),
    ("space", "Space", "Space", 0, 40, 0, 0, 2, False, "spacer", "Space Range", "Spc R", 40, 2),
]
EXP = [
    ("mass", "Mass", "Mass", 0, 100, 35, 0, 5, "massr", "Mass Range", "Mass R"),
    ("scatter", "Scatter", "Scatter", 0, 100, 25, 0, 5, "scatterr", "Scatter Range", "Scat R"),
    ("decay", "Decay", "Decay", 0, 100, 40, 0, 5, "decayr", "Decay Range", "Dcy R"),
    ("couple", "Couple", "Couple", 0, 100, 20, 0, 5, "coupler", "Couple Range", "Cpl R"),
    ("bite", "Bite", "Bite", 0, 100, 55, 0, 5, "biter", "Bite Range", "Bite R"),
    ("air", "Air", "Air", 0, 100, 15, 0, 5, "airr", "Air Range", "Air R"),
]
# Off the column: still automate and save. presentation hidden.
IR = [
    ("bdecay", "Body Decay", "BDec", 0, 100, 40, 0, 5, False, "bdecayr", "Body Decay Range", "BDec R", 100, 5),
    ("bsize", "Body Size", "BSize", 50, 200, 100, 0, 5, False, "bsizer", "Body Size Range", "BSz R", 150, 5),
    ("bcolor", "Body Color", "BCol", -100, 100, 0, 0, 0, True, "bcolorr", "Body Color Range", "BCol R", 200, 0),
    ("bmix", "Body Mix", "BMix", 0, 100, 0, 0, 5, False, "bmixr", "Body Mix Range", "BMx R", 100, 5),
    ("adecay", "Air Decay", "ADec", 0, 100, 40, 0, 5, False, "adecayr", "Air Decay Range", "ADec R", 100, 5),
    ("asize", "Air Size", "ASize", 50, 200, 100, 0, 5, False, "asizer", "Air Size Range", "ASz R", 150, 5),
    ("acolor", "Air Color", "ACol", -100, 100, 0, 0, 0, True, "acolorr", "Air Color Range", "ACol R", 200, 0),
    ("amix", "Air Mix", "AMix", 0, 100, 0, 0, 5, False, "amixr", "Air Mix Range", "AMx R", 100, 5),
]


def rebang_names():
    names = ["obj-ctrl-page", "obj-ctrl-sens", "obj-ctrl-rand", "obj-ctrl-mix", "obj-ctrl-seed", "obj-ctrl-mode", "obj-ctrl-picture"]
    for row in NORMAL + IR:
        names.append(f"obj-ctrl-{row[0]}")
        names.append(f"obj-ctrl-{row[9]}")
    for row in EXP:
        names.append(f"obj-ctrl-{row[0]}")
        names.append(f"obj-ctrl-{row[8]}")
    names += ["obj-ctrl-bmodel", "obj-ctrl-amodel"]
    return names


def tables_js():
    return "var FILL_REBANG = " + json.dumps(rebang_names()) + ";\n"


def showname(box, on=0):
    box["box"]["showname"] = on
    box["box"]["fontname"] = sc.THEME_FONT
    box["box"]["fontface"] = 0
    return box


def slider(key, spec, x, y, w, h, bipolar):
    color = sc.LIVE_THEME["live_control_selection"]
    help_text = spec[0] + " is the value held for each hit."
    box = sc.make_numbox(key, spec, help_text, x, y, w, h, color, appearance=3 if bipolar else 2, fontsize=8.0)
    box["box"]["textcolor"] = [0.93, 0.94, 0.96, 1.0]
    box["box"]["varname"] = f"obj-ctrl-{key}"
    return showname(box, 0)


def caption(obj_id, text, x, y, w):
    b = sc.make_theme_comment(obj_id, text, x, y, w, 12, size=8)
    b["box"]["varname"] = obj_id
    return b


def stored_only(box):
    box["box"]["saved_attribute_attributes"]["valueof"]["parameter_invisible"] = 1
    return box


def park(box):
    """Real parameter, not in the visible face. Rect stays inside the device."""
    box["box"]["hidden"] = 1
    box["box"]["presentation"] = 1
    box["box"]["presentation_rect"] = [4.0, 26.0, 36.0, 14.0]
    return box


def rect_of(box):
    return box["box"].get("presentation_rect")


def overlaps(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw - 0.5 and bx < ax + aw - 0.5 and ay < by + bh - 0.5 and by < ay + ah - 0.5


def assert_layout(boxes):
    items = []
    for b in boxes:
        bx = b["box"]
        if bx.get("presentation") != 1 or bx.get("hidden") or bx.get("maxclass") == "panel":
            continue
        r = bx["presentation_rect"]
        if r[0] < -0.1 or r[1] < -0.1 or r[0] + r[2] > W + 0.1 or r[1] + r[3] > 169.1:
            raise SystemExit(f"{bx['id']} outside the device {r}")
        items.append((bx["id"], r))
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if overlaps(items[i][1], items[j][1]):
                raise SystemExit(f"overlap {items[i][0]} {items[j][0]} {items[i][1]} {items[j][1]}")
    viz = next(b["box"] for b in boxes if b["box"]["id"] == "obj-viz")
    if viz.get("ignoreclick") == 1:
        raise SystemExit("picture v8ui must stay interactive")
    for b in boxes:
        bx = b["box"]
        if bx.get("presentation") != 1 or bx.get("hidden") or bx.get("maxclass") == "panel":
            continue
        if not str(bx.get("maxclass", "")).startswith("live."):
            continue
        if overlaps(bx["presentation_rect"], viz["presentation_rect"]):
            raise SystemExit(f"{bx['id']} overlaps the picture")


def named(box, varname):
    box["box"]["varname"] = varname
    return box


def add_pair(boxes, key, spec, rkey, rspec, y, bipolar, hidden):
    center = slider(key, spec, 46, y, 72, 16, bipolar)
    rng = slider(rkey, rspec, 120, y, 36, 16, False)
    if hidden:
        center["box"]["hidden"] = 1
        rng["box"]["hidden"] = 1
    boxes.append(center)
    boxes.append(rng)


def build():
    boxes = []
    lines = []
    ywire = 400.0

    def wire_ui(key):
        nonlocal ywire
        oid = f"obj-ui-{key}"
        boxes.append(sc.newobj(oid, f"prepend set_{key}", 40, ywire, 150))
        lines.append(sc.line(f"obj-ctrl-{key}", 0, oid))
        lines.append(sc.line(oid, 0, "obj-viz"))
        ywire += 16

    boxes.append(named(sc.newobj("obj-plugin", "plugin~", 40, 40, 70, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "fill_plugin"))
    boxes.append(named(sc.newobj("obj-plugout", "plugout~", 40, 80, 70, numinlets=2, numoutlets=0), "fill_plugout"))
    boxes.append(named(sc.newobj("obj-genin", "gate 1 1", 140, 40, 70, numinlets=2, numoutlets=1), "fill_genin"))
    boxes.append(sc.newobj("obj-body-buf", f"buffer~ #0-fillbody @samps {BANK_FLOATS * IR_BANKS}", 240, 40, 280, numoutlets=2, outlettype=["float", "bang"]))
    boxes.append(sc.newobj("obj-air-buf", f"buffer~ #0-fillair @samps {BANK_FLOATS * IR_BANKS}", 240, 70, 280, numoutlets=2, outlettype=["float", "bang"]))
    boxes.append(sc.newobj("obj-scope-buf", "buffer~ #0-fillscope @samps 64", 240, 100, 220, numoutlets=2, outlettype=["float", "bang"]))
    boxes.append(named(sc.newobj("obj-bank-buf", "buffer~ #0-fillbank @samps 832", 240, 130, 220, numoutlets=2, outlettype=["float", "bang"]), "fill_bank"))
    boxes.append(sc.newobj("obj-loadbang", "loadbang", 40, 160, 60, numoutlets=1, outlettype=["bang"]))
    boxes.append(named(sc.message("obj-msg-bind", "fillbody #0-fillbody, fillair #0-fillair, scope #0-fillscope, fillbank #0-fillbank", 40, 190, 420), "fill_bind"))
    boxes.append(sc.message("obj-msg-bufs", "bufnames #0-fillbody #0-fillair #0-fillscope #0-fillbank", 40, 220, 380))
    boxes.append(sc.newobj("obj-this", "live.thisdevice", 40, 260, 110, numoutlets=1))
    boxes.append(sc.newobj("obj-prep-init", "prepend init_dsp", 40, 290, 110))
    boxes.append(sc.newobj("obj-sync", "plugsync~", 700, 40, 80, numoutlets=9, outlettype=["int", "int", "int", "float", "list", "float", "float", "int", "int"]))
    boxes.append(sc.newobj("obj-play-ui", "prepend set_play", 760, 90, 100))
    lines.append(sc.line("obj-sync", 0, "obj-play-ui"))

    # Header. Tune Mode stays a parameter but does not fit beside Experimental.
    page = sc.make_theme_tab("page", ("Page", "Page", ["Normal", "Experimental"], 0), "Normal or Experimental", 4, 4, 156, 16, fontsize=8.0)
    page["box"]["varname"] = "obj-ctrl-page"
    boxes.append(page)
    boxes.append(caption("obj-lbl-sens", "Sens", 164, 6, 24))
    boxes.append(slider("sens", ("Sens", "Sens", 0, 100, 45, 0, 5), 192, 4, 44, 16, False))
    boxes.append(caption("obj-lbl-rand", "Rand", 240, 6, 24))
    boxes.append(slider("rand", ("Master Rand", "Rand", 0, 100, 0, 0, 5), 268, 4, 44, 16, False))
    boxes.append(caption("obj-lbl-mix", "Mix", 316, 6, 20))
    boxes.append(slider("mix", ("Mix", "Mix", 0, 100, 100, 0, 5), 340, 4, 56, 16, False))

    for i, row in enumerate(NORMAL):
        key, long_n, short, lo, hi, initial, ptype, unit, bipolar, rkey, rlong, rshort, rhi, runit = row
        y = 26 + i * 20
        boxes.append(caption(f"obj-lbl-{key}", long_n, 4, y + 2, 40))
        add_pair(
            boxes, key, (long_n, short, lo, hi, initial, ptype, unit),
            rkey, (rlong, rshort, 0, rhi, 0, 0, runit),
            y, bipolar, False,
        )
    for i, row in enumerate(EXP):
        key, long_n, short, lo, hi, initial, ptype, unit, rkey, rlong, rshort = row
        y = 26 + i * 20
        cap = caption(f"obj-lbl-{key}", long_n, 4, y + 2, 40)
        cap["box"]["hidden"] = 1
        boxes.append(cap)
        add_pair(
            boxes, key, (long_n, short, lo, hi, initial, ptype, unit),
            rkey, (rlong, rshort, 0, 100, 0, 0, 5),
            y, False, True,
        )

    boxes.append(sc.make_theme_menu("bmodel", ("Body", "Body", ["Tom", "Snare", "Kick", "Hat"], 0), "Body chooses the drum model for the impulse response.", 4, 150, 74, 16, fontsize=8.0))
    boxes.append(sc.make_theme_menu("amodel", ("Air Model", "AMod", ["Wires", "Room", "Hat", "Sizzle"], 0), "Air Model chooses the noise color for the impulse response.", 82, 150, 74, 16, fontsize=8.0))
    boxes[-2]["box"]["varname"] = "obj-ctrl-bmodel"
    boxes[-1]["box"]["varname"] = "obj-ctrl-amodel"

    for row in IR:
        key, long_n, short, lo, hi, initial, ptype, unit, bipolar, rkey, rlong, rshort, rhi, runit = row
        add_pair(
            boxes, key, (long_n, short, lo, hi, initial, ptype, unit),
            rkey, (rlong, rshort, 0, rhi, 0, 0, runit),
            26, bipolar, False,
        )
        park(boxes[-2])
        park(boxes[-1])

    mode = sc.make_theme_menu("mode", ("Tune Mode", "Mode", ["Resonator", "Pitch", "Freq"], 0), "How Tune moves the body", 4, 26, 80, 16, fontsize=8.0)
    mode["box"]["varname"] = "obj-ctrl-mode"
    boxes.append(park(mode))
    seed = slider("seed", ("Seed", "Seed", 0, 1000, 1, 0, 0), 4, 26, 48, 16, False)
    boxes.append(park(stored_only(seed)))
    picture = sc.make_theme_menu("picture", ("Picture", "Picture", ["Matter", "Ring", "Scar", "Dust"], 0), "Picture chooses Matter, Ring, Scar, or Dust.", 4, 26, 70, 16, fontsize=8.0)
    picture["box"]["varname"] = "obj-ctrl-picture"
    boxes.append(park(stored_only(picture)))

    gen = sc.gen_code(
        os.path.join(ROOT, "src", "fill_conv.genexpr"),
        os.path.join(ROOT, "src", "fill_core.genexpr"),
    )
    header, _hash = sc.deferred_header("fill", gen)
    face = "\n".join([
        header,
        sc.read(os.path.join(ROOT, "src", "spectral_theme.js")),
        sc.read(os.path.join(ROOT, "src", "fill_config.js")),
        tables_js(),
        sc.read(os.path.join(ROOT, "src", "fill_dsp.js")),
        sc.read(os.path.join(ROOT, "src", "fill_ui.js")),
    ])
    viz = sc.v8ui("obj-viz", face, VIZ, (164, 420), 2, varname="obj-viz")
    viz["box"]["ignoreclick"] = 0
    boxes.append(viz)

    for key in rebang_names():
        wire_ui(key.replace("obj-ctrl-", ""))
    lines.append(sc.line("obj-play-ui", 0, "obj-viz"))
    boxes.append(sc.newobj("obj-fill-test", "receive #0-fill-test", 40, 360, 160))
    boxes.append(sc.newobj("obj-fill-test-global", "receive fill-face-test", 40, 380, 160))
    lines.append(sc.line("obj-fill-test", 0, "obj-viz"))
    lines.append(sc.line("obj-fill-test-global", 0, "obj-viz"))
    lines.append(sc.line("obj-viz", 1, "obj-ctrl-picture"))
    lines.append(sc.line("obj-viz", 0, "obj-genin", 1))
    lines.append(sc.line("obj-loadbang", 0, "obj-msg-bind"))
    lines.append(sc.line("obj-loadbang", 0, "obj-msg-bufs"))
    lines.append(sc.line("obj-msg-bufs", 0, "obj-viz"))
    lines.append(sc.line("obj-this", 0, "obj-prep-init"))
    lines.append(sc.line("obj-prep-init", 0, "obj-viz"))
    lines.append(sc.line("obj-msg-bind", 0, "obj-genin", 1))

    col = sc.make_theme_panel("obj-panel-col", 2, 22, 160, 145, "live_desktop")
    boxes.append(col)
    boxes.append(sc.make_body_panel(W))

    assert_layout(boxes)
    sc.to_gen_hub(lines, "obj-genin", "obj-gen")
    doc = sc.patcher(
        boxes, lines, W,
        "One draw per hit. Normal drum color, or an experimental mode bank.",
        "Center and range wings, four pictures, generated body and air convolution.",
        "audio_effect",
        LATENCY,
    )
    sc.write_amxd(doc, os.path.join(sc.DEVICES_DIR, "Fill.amxd"))


if __name__ == "__main__":
    build()
