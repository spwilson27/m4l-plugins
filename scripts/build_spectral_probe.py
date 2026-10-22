#!/usr/bin/env python3
"""Build tests/spectral_probe/Spectral Probe.amxd: a diagnostic audio effect (NOT a product) that records how Live processes the
chains of one Audio Effect Rack (order, vector alignment, visibility of one instance's writes in another). Source:
tests/spectral_probe/probe.genexpr + probe_ui.js. Driven by scripts/test_spectral_probe_live.js (Live in the VM only, AGENTS.md 1a)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from spectral_common import line, newobj, message

ROOT = sc.ROOT_DIR
OUT = os.path.join(ROOT, "tests", "spectral_probe", "Spectral Probe.amxd")
OUT_SUM = os.path.join(ROOT, "tests", "spectral_probe", "Spectral Sum Probe.amxd")


def build():
    gen = sc.read(os.path.join(ROOT, "tests", "spectral_probe", "probe.genexpr"))
    face = sc.read(os.path.join(ROOT, "tests", "spectral_probe", "probe_ui.js"))
    boxes = [
        sc.v8ui("obj-viz", face, [4.0, 4.0, 40.0, 20.0], (20.0, 80.0), 1, "ProbeView"),
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.gen_box("obj-gen", gen, "probe"),
        newobj("obj-sh", "buffer~ ---probesh @samps 256", 560, 250, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-own", "buffer~ ---probeown @samps 512", 560, 280, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 310, 60, outlettype=["bang"]),
        message("obj-msg-names", "setnames ---probesh ---probeown", 560, 340, 220),
        message("obj-msg-gen", "sh ---probesh, res ---probeown", 560, 370, 220),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init", "init_path", 780, 430, 70),
    ]
    lines = [
        line("obj-plugin", 0, "obj-gen", 0), line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0), line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-names"), line("obj-loadbang", 0, "obj-msg-gen"),
        line("obj-msg-names", 0, "obj-viz"), line("obj-msg-gen", 0, "obj-gen"),
        line("obj-viz", 0, "obj-gen"),
        line("obj-thisdevice", 0, "obj-msg-init"), line("obj-msg-init", 0, "obj-viz"),
    ]
    boxes.append(sc.make_body_panel(60.0))
    doc = sc.patcher(boxes, lines, 60.0, "Diagnostic probe", "Spectral Probe", "probe", 0)
    sc.write_amxd(doc, OUT)


def build_sum():
    gen = sc.read(os.path.join(ROOT, "tests", "spectral_probe", "sumprobe.genexpr"))
    face = sc.read(os.path.join(ROOT, "tests", "spectral_probe", "sumprobe_ui.js"))
    boxes = [
        sc.v8ui("obj-viz", face, [4.0, 4.0, 40.0, 20.0], (20.0, 80.0), 1, "SumProbeView"),
        newobj("obj-plugin", "plugin~", 20, 240, 52, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        newobj("obj-plugout", "plugout~", 20, 520, 58, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        sc.gen_box("obj-gen", gen, "sumprobe"),
        newobj("obj-cap", "buffer~ ---sspcap @samps 131072 @chans 2", 560, 250, 300, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-info", "buffer~ ---sspinfo @samps 16", 560, 280, 260, numoutlets=2, outlettype=["float", "bang"]),
        newobj("obj-loadbang", "loadbang", 560, 310, 60, outlettype=["bang"]),
        message("obj-msg-names", "setnames ---sspcap ---sspinfo", 560, 340, 220),
        message("obj-msg-gen", "cap ---sspcap, info ---sspinfo", 560, 370, 220),
        newobj("obj-thisdevice", "live.thisdevice", 780, 400, 90, numinlets=1, numoutlets=2, outlettype=["bang", "int"]),
        message("obj-msg-init", "init_path", 780, 430, 70),
    ]
    lines = [
        line("obj-plugin", 0, "obj-gen", 0), line("obj-plugin", 1, "obj-gen", 1),
        line("obj-gen", 0, "obj-plugout", 0), line("obj-gen", 1, "obj-plugout", 1),
        line("obj-loadbang", 0, "obj-msg-names"), line("obj-loadbang", 0, "obj-msg-gen"),
        line("obj-msg-names", 0, "obj-viz"), line("obj-msg-gen", 0, "obj-gen"),
        line("obj-viz", 0, "obj-gen"),
        line("obj-thisdevice", 0, "obj-msg-init"), line("obj-msg-init", 0, "obj-viz"),
    ]
    boxes.append(sc.make_body_panel(60.0))
    sc.write_amxd(sc.patcher(boxes, lines, 60.0, "Diagnostic sum probe", "Spectral Sum Probe", "probe", 0), OUT_SUM)


if __name__ == "__main__":
    build()
    build_sum()
