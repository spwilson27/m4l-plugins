#!/usr/bin/env python3
"""Build tests/opplus_probe/OpCap.amxd: a diagnostic audio effect (NOT a product) that records 4 s of its input on
`; opcap_rec 1` into its own buffer (name published in Global("opcap").names by track). Used by
scripts/test_opplus_ab_live.js to compare Operator+ with Operator in Live (VM only, AGENTS.md 1a)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from spectral_common import line, newobj, message

ROOT = sc.ROOT_DIR
OUT = os.path.join(ROOT, "tests", "opplus_probe", "OpCap.amxd")


def build():
    face = sc.read(os.path.join(ROOT, "tests", "opplus_probe", "opcap_ui.js"))
    boxes = [
        sc.v8ui("obj-viz", face, [4.0, 4.0, 40.0, 20.0], (20.0, 80.0), 1, "OpCapView"),
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-rec", "record~ ---opcap 2", 200, 320, 140, numinlets=3, numoutlets=1, outlettype=["signal"]),
        newobj("obj-buf", "buffer~ ---opcap 4000 2", 560, 250, 200, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-r", "r opcap_rec", 200, 260, 90, numinlets=0, numoutlets=1, outlettype=[""]),
        newobj("obj-loadbang", "loadbang", 560, 310, 60, outlettype=["bang"]),
        message("obj-msg-names", "setnames ---opcap", 560, 340, 220),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init", "init_path", 780, 430, 70),
    ]
    lines = [
        line("obj-plugin", 0, "obj-plugout", 0), line("obj-plugin", 1, "obj-plugout", 1),
        line("obj-plugin", 0, "obj-rec", 0), line("obj-plugin", 1, "obj-rec", 1),
        line("obj-r", 0, "obj-rec", 0),
        line("obj-loadbang", 0, "obj-msg-names"), line("obj-msg-names", 0, "obj-viz"),
        line("obj-thisdevice", 0, "obj-msg-init"), line("obj-msg-init", 0, "obj-viz"),
    ]
    boxes.append(sc.make_body_panel(60.0))
    sc.write_amxd(sc.patcher(boxes, lines, 60.0, "Diagnostic capture probe", "OpCap", "probe", 0), OUT)


if __name__ == "__main__":
    build()
    print(OUT)
