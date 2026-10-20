#!/usr/bin/env python3
"""Open devices/Envelope Trigger.amxd's patcher in Ableton-bundled Max and verify the
collapsible MIDI To panel end to end.

tests/envtrig_ui_probe.js drives the device's test hook (`receive envtrig-test`):
  report -> click -> report -> click -> report -> click -> report
and each report (written by the strip v8ui to Global("envtrig_test")) must show:
  collapsed: open 0, toggle 0, every panel widget hidden
  open:      open 1, toggle 1, setwidth 342, every panel widget visible
  collapsed: open 0, toggle 0, setwidth 228, every panel widget hidden
  open again (the toggle must latch, not act as a momentary button)

live.thisdevice cannot resize a device outside Live, so this checks the `setwidth` message,
not Live's resize; scripts/test_envtrig_live.js covers the real device in Live.
"""

import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AMXD = os.path.join(ROOT, "devices", "Envelope Trigger.amxd")
PROBE_JS = os.path.join(ROOT, "tests", "envtrig_ui_probe.js")
HARNESS = os.path.join(ROOT, "tests", "envtrig_ui_harness.maxpat")
RESULT = "/tmp/envtrig_ui.txt"
MAX_BIN = (
    "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/"
    "Max/Max.app/Contents/MacOS/Max"
)
WIDTH_COLLAPSED = 228
WIDTH_EXPANDED = 342


def build_harness():
    with open(AMXD, "rb") as f:
        raw = f.read()
    doc = json.loads(raw[32:].decode("utf-8"))
    patcher = doc["patcher"]
    patcher["boxes"].extend([
        {"box": {"id": "obj-t-load", "maxclass": "newobj", "text": "loadbang", "numinlets": 1, "numoutlets": 1,
                 "outlettype": ["bang"], "patching_rect": [1200.0, 40.0, 60.0, 20.0]}},
        {"box": {"id": "obj-t-delay", "maxclass": "newobj", "text": "delay 2000", "numinlets": 2, "numoutlets": 1,
                 "outlettype": ["bang"], "patching_rect": [1200.0, 70.0, 70.0, 20.0]}},
        {"box": {"id": "obj-t-run", "maxclass": "message", "text": "run", "numinlets": 2, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [1200.0, 100.0, 35.0, 20.0]}},
        {"box": {"id": "obj-t-probe", "maxclass": "newobj", "text": f"v8 {PROBE_JS}", "numinlets": 1, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [1200.0, 130.0, 300.0, 20.0]}},
        {"box": {"id": "obj-t-quit", "maxclass": "message", "text": "; max quit", "numinlets": 2, "numoutlets": 1,
                 "outlettype": [""], "patching_rect": [1200.0, 160.0, 70.0, 20.0]}},
    ])
    patcher["lines"].extend([
        {"patchline": {"source": ["obj-t-load", 0], "destination": ["obj-t-delay", 0]}},
        {"patchline": {"source": ["obj-t-delay", 0], "destination": ["obj-t-run", 0]}},
        {"patchline": {"source": ["obj-t-run", 0], "destination": ["obj-t-probe", 0]}},
        {"patchline": {"source": ["obj-t-probe", 0], "destination": ["obj-t-quit", 0]}},
    ])
    with open(HARNESS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent="\t")
        f.write("\n")


def wait_for_idle_max(timeout=300):
    """Only one standalone Max runs at a time: a second launch hands its patch to the running
    instance, and whichever harness quits first takes the other down."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        busy = subprocess.run(["pgrep", "-f", "Max.app/Contents/MacOS/Max .*[.]maxpat"], capture_output=True).returncode == 0
        if not busy:
            return
        time.sleep(2)


def run_max():
    wait_for_idle_max()
    if os.path.exists(RESULT):
        os.remove(RESULT)
    recovery = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Crash Recovery")
    if os.path.isdir(recovery):
        subprocess.run(["rm", "-rf", recovery], check=False)
    proc = subprocess.Popen([MAX_BIN, HARNESS], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 40
    while time.time() < deadline and not os.path.exists(RESULT):
        if proc.poll() is not None:
            break
        time.sleep(0.2)
    last, stable = -1, 0
    while time.time() < deadline and stable < 2 and os.path.exists(RESULT):
        size = os.path.getsize(RESULT)
        stable = stable + 1 if size > 0 and size == last else 0
        last = size
        time.sleep(0.15)
    if proc.poll() is None:
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.terminate()
    if not os.path.exists(RESULT):
        return None
    with open(RESULT, encoding="utf-8") as f:
        return [json.loads(l) if l.strip() != "null" else None for l in f.read().splitlines() if l.strip()]


def check(reports):
    errors = []
    if not reports or len(reports) != 4 or any(r is None for r in reports):
        return [f"expected 4 reports from the strip test hook, got {reports}"]
    expect = [(0, None), (1, WIDTH_EXPANDED), (0, WIDTH_COLLAPSED), (1, WIDTH_EXPANDED)]
    for i, (r, (state, width)) in enumerate(zip(reports, expect)):
        tag = f"step {i} ({'open' if state else 'collapsed'})"
        if r["open"] != state:
            errors.append(f"{tag}: strip shows open={r['open']}")
        if r["toggle"] != state:
            errors.append(f"{tag}: MIDI To Panel toggle holds {r['toggle']}")
        if width is not None and r["width"] != width:
            errors.append(f"{tag}: setwidth sent {r['width']}, expected {width}")
        wrong = [n for n, h in r["hidden"].items() if h != (0 if state else 1)]
        if wrong:
            errors.append(f"{tag}: wrong visibility for {wrong}")
    return errors


def main():
    build_harness()
    reports = run_max()
    for i, r in enumerate(reports or []):
        print(f"report {i}: {json.dumps(r)}")
    errors = check(reports)
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("envtrig UI checks passed")


if __name__ == "__main__":
    main()
