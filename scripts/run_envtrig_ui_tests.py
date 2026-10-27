#!/usr/bin/env python3
"""Run devices/Envelope Trigger.amxd's patcher in real Max (through scripts/max_harness.py) and verify
the collapsible MIDI To panel end to end. Run it inside the tart VM (AGENTS.md 1a), e.g.
`scripts/vm_envtrig.sh ui`.

tests/envtrig_ui_probe.js drives the device's test hook (`receive envtrig-test`) from sample-timed
harness events:
  report -> click -> report -> click -> report -> click -> report
and each report (written by the strip v8ui to Global("envtrig_test")) must show:
  collapsed: open 0, toggle 0, setwidth 228, every panel widget hidden
  open:      open 1, toggle 1, setwidth 342, every panel widget visible
  collapsed: open 0, toggle 0, setwidth 228, every panel widget hidden
  open again (the toggle must latch, not act as a momentary button)

live.thisdevice cannot resize a device outside Live, so this checks the `setwidth` message,
not Live's resize; scripts/test_envtrig_live.js covers the real device in Live.
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
AMXD = os.path.join(ROOT, "devices", "Envelope Trigger.amxd")
PROBE_JS = os.path.join(ROOT, "tests", "envtrig_ui_probe.js")
WIDTH_COLLAPSED = 228
WIDTH_EXPANDED = 342
STEPS = ["test_report", "test_click", "test_report", "test_click", "test_report", "test_click", "test_report"]
STEP_MS = 50


def device_patch():
    """The device's own boxes and lines, to run inside the harness scaffold."""
    with open(AMXD, "rb") as f:
        patcher = json.loads(f.read()[32:].decode("utf-8"))["patcher"]
    panel_names = None
    for b in patcher["boxes"]:
        if b["box"]["id"] == "obj-strip":
            first = b["box"]["textfile"]["text"].split("\n", 1)[0]
            panel_names = json.loads(first[len("var PANEL_NAMES="):].rstrip(";"))
    return patcher["boxes"], patcher["lines"], panel_names


def check(res, n_panel):
    errors = []
    if res.get("reports") != 4:
        return [f"expected 4 reports from the strip test hook, got {res.get('reports')}"]
    for i, state in enumerate([0, 1, 0, 1]):
        tag = f"report {i} ({'open' if state else 'collapsed'})"
        if res.get(f"r{i}_open") != state:
            errors.append(f"{tag}: strip shows open={res.get(f'r{i}_open')}")
        if res.get(f"r{i}_toggle") != state:
            errors.append(f"{tag}: MIDI To Panel toggle holds {res.get(f'r{i}_toggle')}")
        want_w = WIDTH_EXPANDED if state else WIDTH_COLLAPSED
        if res.get(f"r{i}_width") != want_w:
            errors.append(f"{tag}: setwidth sent {res.get(f'r{i}_width')}, expected {want_w}")
        want_hidden, want_shown = (0, n_panel) if state else (n_panel, 0)
        got = (res.get(f"r{i}_hidden"), res.get(f"r{i}_shown"), res.get(f"r{i}_missing"))
        if got != (want_hidden, want_shown, 0):
            errors.append(f"{tag}: panel widgets hidden/shown/missing = {got[0]}/{got[1]}/{got[2]}, "
                          f"expected {want_hidden}/{want_shown}/0")
    return errors


def main():
    boxes, lines, panel_names = device_patch()
    if not panel_names:
        sys.exit("Envelope Trigger strip has no PANEL_NAMES prefix; rebuild with scripts/build_envtrig.py")
    events = [(STEP_MS * (k + 1), "obj-js", 0, f"hook {s}") for k, s in enumerate(STEPS)]
    # "stepped": the scheduler runs between DSP vectors, so the steps land in order at their sample times.
    res = mh.run_case("envtrig_ui", boxes, lines, probe_js=PROBE_JS, probe_object="v8", settle_ms=0,
                      dur_ms=STEP_MS * (len(STEPS) + 2), channels=1, mode="stepped", events=events)
    for i in range(int(res.get("reports", 0))):
        print(f"report {i}: open {res.get(f'r{i}_open')} toggle {res.get(f'r{i}_toggle')} "
              f"width {res.get(f'r{i}_width')} hidden {res.get(f'r{i}_hidden')} shown {res.get(f'r{i}_shown')}")
    errors = check(res, len(panel_names))
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("envtrig UI checks passed")


if __name__ == "__main__":
    main()
