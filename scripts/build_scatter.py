#!/usr/bin/env python3
"""Build devices/Scatter.amxd. 608x169, two macro wings, centre scope.

Scatter is a deferred-DSP device (AGENTS.md 1d, Fill pattern): the .amxd
ships without gen~. The v8ui face (src/scatter_ui.js, concatenated after
src/scatter_config.js) writes the embedded core to
/tmp/scatter_core_<hash>.gendsp at loadbang and creates gen~ on the
scatter_genin hub itself, so this patcher needs no live.thisdevice /
init_dsp wiring and no bufnames messages - the face is self-starting.
The core text is read from src/scatter_core.genexpr when present; when
absent a clearly-marked placeholder passthrough core is embedded so the
build succeeds (the orchestrator rebuilds once the real DSP lands).
Hubs are the Fill/spectral gate-hub idiom adapted to two outlets so the
face's hub->gen and gen->scatter_genout connect calls succeed.
"""

import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc

ROOT = sc.ROOT_DIR
W = 608
LATENCY = 5120
VIZ = [168, 26, 272, 118]

# key, long, short, centre, rand depth
MACROS_LEFT = [
    ("snap", "Snap", "Snap", 50, 25),
    ("body", "Body", "Body", 50, 25),
    ("metal", "Metal", "Metal", 30, 25),
    ("motion", "Motion", "Motion", 35, 25),
]
MACROS_RIGHT = [
    ("space", "Space", "Space", 30, 20),
    ("grit", "Grit", "Grit", 20, 15),
    ("warp", "Warp", "Warp", 25, 20),
    ("ring", "Ring", "Ring", 40, 20),
]

PARAM_KEYS = [
    "sens", "rand", "mix", "splitmode", "seed",
    "snap", "snapr", "body", "bodyr", "metal", "metalr",
    "motion", "motionr", "space", "spacer", "grit", "gritr",
    "warp", "warpr", "ring", "ringr",
]

PLACEHOLDER_CORE = """// PLACEHOLDER passthrough core for Scatter - NOT the real DSP.
// scripts/build_scatter.py embeds this only while src/scatter_core.genexpr
// is absent; the orchestrator rebuilds the device once the DSP lands.
// out1 = in1; out2 = in2;
out1 = in1;
out2 = in2;
"""


def showname(box, on=0):
    box["box"]["showname"] = on
    box["box"]["fontname"] = sc.THEME_FONT
    box["box"]["fontface"] = 0
    return box


def slider(key, spec, x, y, w, h):
    color = sc.LIVE_THEME["live_control_selection"]
    help_text = spec[0] + " - Scatter parameter."
    box = sc.make_numbox(key, spec, help_text, x, y, w, h, color, appearance=2, fontsize=8.0)
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
        raise SystemExit("scope v8ui must stay interactive")
    for b in boxes:
        bx = b["box"]
        if bx.get("presentation") != 1 or bx.get("hidden") or bx.get("maxclass") == "panel":
            continue
        if not str(bx.get("maxclass", "")).startswith("live."):
            continue
        if overlaps(bx["presentation_rect"], viz["presentation_rect"]):
            raise SystemExit(f"{bx['id']} overlaps the scope")


def named(box, varname):
    box["box"]["varname"] = varname
    return box


def add_pair(boxes, key, long_n, short, centre, depth, x_cap, x_centre, x_range, y):
    boxes.append(caption(f"obj-lbl-{key}", long_n, x_cap, y + 2, 40))
    boxes.append(slider(key, (long_n, short, 0, 100, centre, 0, 5), x_centre, y, 72, 16))
    boxes.append(slider(key + "r", (long_n + " Range", short + " R", 0, 100, depth, 0, 5), x_range, y, 36, 16))


def core_text():
    path = os.path.join(ROOT, "src", "scatter_core.genexpr")
    if os.path.exists(path):
        return sc.read(path), True
    return PLACEHOLDER_CORE, False


def build():
    boxes = []
    lines = []
    ywire = 400.0

    def wire_ui(key, src=None):
        nonlocal ywire
        oid = f"obj-ui-{key}"
        boxes.append(sc.newobj(oid, f"prepend set_{key}", 40, ywire, 150))
        lines.append(sc.line(src or f"obj-ctrl-{key}", 0, oid))
        lines.append(sc.line(oid, 0, "obj-viz"))
        ywire += 16

    boxes.append(named(sc.newobj("obj-plugin", "plugin~", 40, 40, 70, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]), "scatter_plugin"))
    boxes.append(named(sc.newobj("obj-plugout", "plugout~", 40, 80, 70, numinlets=2, numoutlets=0), "scatter_plugout"))
    boxes.append(named(sc.newobj("obj-genin", "gate 2 1", 140, 40, 70, numinlets=2, numoutlets=2), "scatter_genin"))
    boxes.append(named(sc.newobj("obj-genout", "gate 2 1", 140, 100, 70, numinlets=2, numoutlets=2), "scatter_genout"))
    boxes.append(sc.newobj("obj-scope-buf", "buffer~ #0-scatterscope @samps 64", 240, 40, 220, numoutlets=2, outlettype=["float", "bang"]))
    lines.append(sc.line("obj-plugin", 0, "obj-genin", 1))
    lines.append(sc.line("obj-plugin", 1, "obj-genin", 1))
    lines.append(sc.line("obj-genout", 0, "obj-plugout", 0))
    lines.append(sc.line("obj-genout", 1, "obj-plugout", 1))

    # Header: Sens / Rand / Mix numboxes + Split Mode menu.
    boxes.append(caption("obj-lbl-sens", "Sens", 4, 6, 24))
    boxes.append(slider("sens", ("Sens", "Sens", 0, 100, 45, 0, 5), 30, 4, 44, 16))
    boxes.append(caption("obj-lbl-rand", "Rand", 82, 6, 24))
    boxes.append(slider("rand", ("Master Rand", "Rand", 0, 100, 50, 0, 5), 108, 4, 44, 16))
    boxes.append(caption("obj-lbl-mix", "Mix", 160, 6, 20))
    boxes.append(slider("mix", ("Mix", "Mix", 0, 100, 100, 0, 5), 182, 4, 44, 16))
    boxes.append(caption("obj-lbl-splitmode", "Split Mode", 234, 6, 58))
    split = sc.make_theme_menu("splitmode", ("Split Mode", "Split", ["Envelope", "Spectral"], 0),
                               "Split Mode chooses the Envelope or Spectral split engine.", 296, 4, 100, 16, fontsize=8.0)
    split["box"]["varname"] = "obj-ctrl-splitmode"
    boxes.append(split)

    # Two macro wings: caption + centre numbox + narrow Range numbox.
    for i, (key, long_n, short, centre, depth) in enumerate(MACROS_LEFT):
        add_pair(boxes, key, long_n, short, centre, depth, 4, 46, 120, 30 + i * 27)
    for i, (key, long_n, short, centre, depth) in enumerate(MACROS_RIGHT):
        add_pair(boxes, key, long_n, short, centre, depth, 448, 490, 564, 30 + i * 27)

    # Footer: Seed (Stored Only) / Lock toggle / Reroll button / latency.
    boxes.append(caption("obj-lbl-seed", "Seed", 4, 150, 28))
    boxes.append(stored_only(slider("seed", ("Seed", "Seed", 0, 1000, 0, 0, 0), 34, 148, 52, 16)))
    lock = sc.make_theme_text("obj-lock", "Lock", 94, 148, 44, 16, toggle=True)
    lock["box"]["annotation"] = "Lock holds the current Scatter randomisation, so new hits keep the same drawn macro values."
    lock["box"]["annotation_name"] = "Lock"
    boxes.append(lock)
    reroll = sc.make_theme_text("obj-reroll", "Reroll", 146, 148, 56, 16, toggle=False)
    reroll["box"]["annotation"] = "Reroll draws new random values around each macro centre, scaled by its Rand depth and the Master Rand."
    reroll["box"]["annotation_name"] = "Reroll"
    boxes.append(reroll)
    boxes.append(caption("obj-lbl-latency", "Latency 5120", 486, 150, 114))

    core, real_core = core_text()
    digest = hashlib.sha1(core.encode("utf-8")).hexdigest()[:12]
    ui = sc.read(os.path.join(ROOT, "src", "scatter_ui.js"))
    ui = ui.replace("__SCATTER_CORE_TEXT__", json.dumps(core))
    ui = ui.replace("__SCATTER_CORE_HASH__", digest)
    face = "\n".join([
        sc.read(os.path.join(ROOT, "src", "scatter_config.js")),
        ui,
    ])
    viz = sc.v8ui("obj-viz", face, VIZ, (168, 420), 1, varname="obj-viz")
    viz["box"]["ignoreclick"] = 0
    boxes.append(viz)

    for key in PARAM_KEYS:
        wire_ui(key)
    wire_ui("lock", "obj-lock")
    wire_ui("reroll", "obj-reroll")
    lines.append(sc.line("obj-viz", 0, "obj-genin", 1))

    boxes.append(sc.make_theme_panel("obj-panel-left", 2, 22, 160, 126, "live_desktop"))
    boxes.append(sc.make_theme_panel("obj-panel-right", 446, 22, 160, 126, "live_desktop"))
    boxes.append(sc.make_body_panel(W))

    assert_layout(boxes)
    doc = sc.patcher(
        boxes, lines, W,
        "One-shot drum timbre randomizer: eight centre/Rand macros over a deferred gen~ core.",
        "Scatter face: header globals, two macro wings, centre scope, footer Seed/Lock/Reroll. "
        + ("Real core inlined." if real_core else "PLACEHOLDER passthrough core inlined (real DSP pending)."),
        "audio_effect",
        LATENCY,
    )
    sc.write_amxd(doc, os.path.join(sc.DEVICES_DIR, "Scatter.amxd"))
    print(f"Built Scatter.amxd ({W}x169, latency {LATENCY}, core={'real' if real_core else 'placeholder'} {digest})")


if __name__ == "__main__":
    build()
