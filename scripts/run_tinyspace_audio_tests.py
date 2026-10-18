#!/usr/bin/env python3
"""Audio validation for Tiny Space.

Builds normal + freeze harnesses, launches Max for each, then checks the Max
console log for HARNESS_PASS / HARNESS_FAIL.

The harness feeds an impulse (click~) into the gen reverb and measures the
output peak at two time points (early vs late) via peakamp~ to validate:
  - decent output (peak above threshold)
  - no infinite ringing in normal mode (late peak << early peak)
  - sustain in freeze mode (late peak ~ early peak)

Usage:
    python3 scripts/run_tinyspace_audio_tests.py [path-to-Max.app]
"""
import os
import sys
import time
import subprocess

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_APP = sys.argv[1] if len(sys.argv) > 1 else "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app"
MAX_BIN = os.path.join(MAX_APP, "Contents", "MacOS", "Max")
HARNESS_BUILDER = os.path.join(ROOT_DIR, "scripts", "build_tinyspace_harness.py")
LOG_PATH = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9/Logs/Max.log")

def build_harness(freeze):
    suffix = "_freeze" if freeze else ""
    out = os.path.join(ROOT_DIR, "tests", "tinyspace_harness%s.maxpat" % suffix)
    subprocess.run([sys.executable, HARNESS_BUILDER] + (["--freeze"] if freeze else []) + ["--out", out], check=True)
    return out

def run_harness(harness_path, marker):
    if not os.path.exists(MAX_BIN):
        print("Max binary not found:", MAX_BIN)
        return False, "no max"
    # record log size before
    log_size_before = os.path.getsize(LOG_PATH) if os.path.exists(LOG_PATH) else 0
    proc = subprocess.Popen([MAX_BIN, harness_path])
    # wait for the two peak measurements (~2.5s) + margin
    for _ in range(40):
        time.sleep(0.25)
        if os.path.exists(LOG_PATH):
            with open(LOG_PATH) as f:
                f.seek(log_size_before)
                tail = f.read()
            if "HARNESS_PASS" in tail or "HARNESS_FAIL" in tail:
                break
    time.sleep(1.0)
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    # read result
    result = "UNKNOWN"
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH) as f:
            f.seek(log_size_before)
            tail = f.read()
        if "HARNESS_PASS" in tail:
            result = "PASS"
        elif "HARNESS_FAIL" in tail:
            result = "FAIL"
            # extract fail line
            for line in tail.splitlines():
                if "HARNESS_FAIL" in line:
                    result = "FAIL: " + line.strip()
    return True, result

def main():
    results = {}
    for freeze in (False, True):
        print("\n=== %s ===" % ("FREEZE" if freeze else "NORMAL"))
        harness = build_harness(freeze)
        print("Harness:", harness)
        ok, res = run_harness(harness, "freeze" if freeze else "normal")
        print("Result:", res)
        results["freeze" if freeze else "normal"] = res

    passed = all(isinstance(v, str) and v.startswith("PASS") for v in results.values())
    print("\n" + ("PASS" if passed else "FAIL"))
    if not passed:
        sys.exit(1)

if __name__ == "__main__":
    main()
