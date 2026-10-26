#!/usr/bin/env python3
"""Fill face renders: Normal/Matter, Experimental/Matter, and Ring, Scar, Dust."""

import json
import os
import shutil
import struct
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from render_preview import render_device

SRC = os.path.join(sc.DEVICES_DIR, "Fill.amxd")

NORMAL_CENTERS = ("tune", "strike", "damp", "beater", "metal", "space")
EXP_CENTERS = ("mass", "scatter", "decay", "couple", "bite", "air")
NORMAL_KEYS = NORMAL_CENTERS + ("tuner", "striker", "dampr", "beaterr", "metalr", "spacer", "bmodel", "amodel")
EXP_KEYS = EXP_CENTERS + ("massr", "scatterr", "decayr", "coupler", "biter", "airr")

DEMO = dict(
    tune=-2, tuner=7, strike=35, striker=25, damp=40, dampr=20,
    beater=110, beaterr=40, metal=70, metalr=50, space=8, spacer=12,
    sens=45, rand=40, mix=100, bmodel=0, amodel=0,
    mass=35, massr=18, scatter=25, scatterr=30, decay=40, decayr=15,
    couple=20, coupler=25, bite=55, biter=20, air=15, airr=20,
)


def load():
    raw = open(SRC, "rb").read()
    return raw[:32], json.loads(raw[32:].decode("utf-8"))


def box(doc, obj_id):
    for b in doc["patcher"]["boxes"]:
        if b["box"].get("id") == obj_id:
            return b["box"]
    raise KeyError(obj_id)


def set_initial(bx, value):
    bx.setdefault("saved_attribute_attributes", {}).setdefault("valueof", {})["parameter_initial"] = [value]


def apply_page(doc, page):
    exp = page == 1
    for key in NORMAL_KEYS:
        box(doc, f"obj-ctrl-{key}")["hidden"] = 1 if exp else 0
    for key in NORMAL_CENTERS:
        box(doc, f"obj-lbl-{key}")["hidden"] = 1 if exp else 0
    for key in EXP_KEYS:
        box(doc, f"obj-ctrl-{key}")["hidden"] = 0 if exp else 1
    for key in EXP_CENTERS:
        box(doc, f"obj-lbl-{key}")["hidden"] = 0 if exp else 1


def write_and_render(header, doc, suffix, state):
    doc["patcher"]["devicewidth"] = 400.0
    doc["patcher"]["openrect"] = [0.0, 0.0, 400.0, 169.0]
    payload = (json.dumps(doc) + "\n").encode("utf-8")
    hdr = header[:28] + struct.pack("<I", len(payload))
    tmp = tempfile.mkdtemp(prefix="fillface_")
    path = os.path.join(tmp, "Fill.amxd")
    with open(path, "wb") as f:
        f.write(hdr + payload)
    try:
        render_device(path, out_suffix=suffix, v8_prelude=f'global.__M4L_SKIP_PREVIEW__ = true; previewState("{state}");')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    frames = [
        ("", "normal-matter", 0, 0),
        ("_exp", "exp-matter", 1, 0),
        ("_ring", "ring", 0, 1),
        ("_scar", "scar", 0, 2),
        ("_dust", "dust", 0, 3),
    ]
    header, _base = load()
    for suffix, state, page, picture in frames:
        _h, doc = load()
        for key, value in DEMO.items():
            set_initial(box(doc, f"obj-ctrl-{key}"), value)
        set_initial(box(doc, "obj-ctrl-page"), page)
        set_initial(box(doc, "obj-ctrl-picture"), picture)
        apply_page(doc, page)
        write_and_render(header, doc, suffix, state)
        print("rendered", suffix or "normal-matter")


if __name__ == "__main__":
    main()
