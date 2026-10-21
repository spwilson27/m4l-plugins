#!/usr/bin/env python3
"""Mega Modulator hotkeys (Delete / Backspace, Cmd-Z, Shift-Cmd-Z, Ctrl-Y) in REAL standalone Max with
REAL OS key and mouse events. Run it inside the tart VM macos-1 (AGENTS.md 1a), from a repo copy where
`devices/Mega Modulator.amxd` is built; the VM's GUI session must be logged in with Accessibility
permission for the ssh chain (osascript System Events + CGEvent).

How it works
  * scripts/max_harness.py launches Max with the device's own boxes/lines (presentation mode, patcher
    window locked) plus tests/megamod_key_probe.js (a `v8` probe). The probe keeps Max alive and answers
    commands appended to a file (seed state, `test_report` through the device's `receive megamod-test`
    hook, window geometry), so this script can interleave OS events and state reads in wall-clock time.
  * The state (3 modulators: LFO / Env / Random, 3 mappings, LFO selected) is the fixture
    tests/megamod_key_seed.json (regenerate on the host with `node scripts/megamod_key_seed.js`; node is
    not installed in the VM).
  * Keys are posted by System Events (`key code 51`, `keystroke "z" using command down`, ...), clicks by
    CGEvent mouse events (no cliclick in the VM), at screen positions computed from the window geometry.

Usage (in the VM):  python3 scripts/run_megamod_key_tests.py [--keep]
Exit status is non-zero when any check fails.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
AMXD = os.path.join(ROOT, "devices", "Mega Modulator.amxd")
PROBE_JS = os.path.join(ROOT, "tests", "megamod_key_probe.js")
SEED = os.path.join(ROOT, "tests", "megamod_key_seed.json")


# ----------------------------------------------------------------------------------------------- OS input
from mm_os_input import click, press, sysevents  # noqa: E402  (real key / mouse events, see that file)


def max_pid():
    """pid of the harness Max (its argv holds the m4l_megamod_keys_ temp patch); the VM can also have an idle Max."""
    r = subprocess.run(["pgrep", "-f", "m4l_megamod_keys_.*maxpat"], capture_output=True, text=True)
    pids = [int(x) for x in r.stdout.split() if x.strip() and int(x) != os.getpid()]
    return pids[0] if pids else None


def proc_ref():
    return f"(first process whose unix id is {max_pid()})"


def front():
    sysevents(f'set frontmost of {proc_ref()} to true')
    time.sleep(0.5)


# ----------------------------------------------------------------------------------------------- probe link
class Link:
    def __init__(self, d):
        self.d = d
        self.n = 0
        self.cmdpath = os.path.join(d, "cmd.txt")
        open(self.cmdpath, "w").close()

    def cmd(self, text, timeout=20.0):
        self.n += 1
        with open(self.cmdpath, "a") as f:
            f.write(f"{self.n} {text}\n")
        end = time.time() + timeout
        ack = os.path.join(self.d, "ack.txt")
        while time.time() < end:
            try:
                if int(open(ack).read().strip() or 0) >= self.n:
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.05)
        err = os.path.join(self.d, "error.txt")
        raise RuntimeError(f"probe did not answer `{text}`" + (": " + open(err).read() if os.path.exists(err) else ""))

    def last(self, name):
        with open(os.path.join(self.d, name)) as f:
            return json.loads(f.read().strip().split("\n")[-1])

    def report(self, tag):
        self.cmd(f"report {tag}")
        r = self.last("reports.jsonl")
        assert r["tag"] == tag, r["tag"]
        return r["report"]

    def geom(self, tag="g"):
        self.cmd(f"geom {tag}")
        return self.last("geom.jsonl")


def mods_of(rep):
    return [m for m in rep["mods"]] if rep else None


def summary(rep):
    return f"modulators in slots {alive(rep)}, {len(rep['mappings'])} mappings"


# ----------------------------------------------------------------------------------------------- main
def device_patch():
    with open(AMXD, "rb") as f:
        patcher = json.loads(f.read()[32:].decode("utf-8"))["patcher"]
    return patcher["boxes"], patcher["lines"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="keep the exchange dir")
    args = ap.parse_args()

    boxes, lines = device_patch()
    # the probe reaches the device UI through a `receive` (the scaffold's obj-js box has one outlet only)
    boxes = list(boxes) + [mh.box("mmk-recv", "receive mmkeyseed", 600, 700, 130, numinlets=0),
                           mh.box("mmk-pattr", "pattr mmkeystate @bindto MegaModState", 600, 730, 220,
                                  numoutlets=3, outlettype=["", "", ""])]
    lines = list(lines) + [mh.line("mmk-recv", 0, "mmk-pattr", 0)]
    seed = json.load(open(SEED))

    d = tempfile.mkdtemp(prefix="mm_keys_")
    with open(PROBE_JS) as f:
        probe_src = f"var CASE = {json.dumps({'dir': d})};\n" + f.read()
    probe = os.path.join(d, "probe.js")
    with open(probe, "w") as f:
        f.write(probe_src)
    with open(os.path.join(d, "seed.txt"), "w") as f:
        f.write(" ".join(str(x) for x in seed["list"]) + "\n")

    # Open the patch in presentation mode (the device's own layout); the harness scaffold has no such flag.
    orig = mh.build_scaffold

    def build(*a, **k):
        p, s, dd = orig(*a, **k)
        p["patcher"]["openinpresentation"] = 1
        p["patcher"]["toolbarvisible"] = 0
        p["patcher"]["statusbarvisible"] = 0
        return p, s, dd
    mh.build_scaffold = build

    out = {}

    def run():
        try:
            out["res"] = mh.run_case("megamod_keys", boxes, lines, probe_js=probe, probe_object="v8", settle_ms=0,
                                     dur_ms=100, channels=1, timeout=420.0)
        except Exception as e:  # noqa
            out["err"] = e

    th = threading.Thread(target=run, daemon=True)
    th.start()
    ok = True
    try:
        t_end = time.time() + 240
        while not os.path.exists(os.path.join(d, "ready")):
            if "err" in out or time.time() > t_end:
                raise RuntimeError(f"Max did not reach the probe: {out.get('err')}")
            time.sleep(0.5)
        link = Link(d)
        ok = scenario(link, seed, args)
        link.cmd("quit")
    finally:
        th.join(timeout=60)
        if not args.keep:
            shutil.rmtree(d, ignore_errors=True)
        else:
            print("exchange dir:", d)
    if "err" in out:
        print("harness error:", out["err"])
        ok = False
    sys.exit(0 if ok else 1)


def alive(rep):
    return [i for i, m in enumerate(rep["mods"]) if m is not None]


def maps(rep):
    return sorted((m["id"], m["mod"], m["mode"]) for m in rep["mappings"])


# Strip geometry (src/megamod_ui.js: UB_RAIL 20, UB_GAP 2, UB_STRIP 56; strip head = top 17 px). Click targets,
# in v8ui-local pixels: the head of strip k selects it (click only, no drag).
def strip_head(k):
    return 20 + 2 + 58 * k + 30, 8


def scenario(link, seed, args):
    results = []

    def check(name, cond, detail=""):
        results.append(bool(cond))
        print(("PASS " if cond else "FAIL ") + name + (f"  [{detail}]" if detail else ""))

    link.cmd(f"seed {os.path.join(link.d, 'seed.txt')}")
    time.sleep(1.0)
    base = link.report("seeded")
    base_maps = maps(base)
    check("seed: 3 modulators (LFO/Env/Random) + 3 mappings loaded", alive(base) == [0, 1, 2] and len(base_maps) == 3, summary(base))
    if not results[-1]:
        return False

    front()
    sysevents(f'tell {proc_ref()} to perform action "AXRaise" of (first window whose name contains "megamod_keys")')
    time.sleep(0.5)
    g = link.geom()
    lx, ly = g["location"][0], g["location"][1]   # canvas origin (toolbar hidden): screen point of patcher (0, 0)
    vx, vy = g["vizPresRect"][0], g["vizPresRect"][1]
    print(f"window content at ({lx},{ly}), v8ui at presentation ({vx},{vy}) size {g['vizPresRect'][2]}x{g['vizPresRect'][3]}")

    def cur(tag):
        return link.report(tag)

    def click_ui(x, y, double=False):
        click(lx + vx + x, ly + vy + y, double)

    def click_away():
        # blank patcher canvas to the right of the device (presentation mode shows nothing there)
        click(lx + vx + g["vizPresRect"][2] + 120, ly + vy + 60)

    # ---- 1. nothing clicked yet: keys do nothing
    for name in ("delete", "fwddelete", "undo"):
        press(name)
    r = cur("nofocus")
    check("no focus: Delete / fwd-Delete / Cmd-Z before any click do nothing", alive(r) == [0, 1, 2] and maps(r) == base_maps, summary(r))

    # ---- 2. click strip 2 (selects mod 1), Delete removes it with its mapping
    click_ui(*strip_head(1))
    press("delete")
    r = cur("del1")
    check("click strip 2 + Delete: selected modulator (and only it) deleted", alive(r) == [0, 2], summary(r))
    check("  ... its mapping went with it", len(r["mappings"]) == 2 and all(m["mod"] != 1 for m in r["mappings"]), f"{len(r['mappings'])} mappings")

    # ---- 3. Cmd-Z restores modulator + mapping
    press("undo")
    r = cur("undo1")
    check("Cmd-Z restores the modulator and its mapping", alive(r) == [0, 1, 2] and maps(r) == base_maps, summary(r))

    # ---- 4. Shift-Cmd-Z redoes the delete, Cmd-Z brings it back again
    press("redo")
    r = cur("redo1")
    check("Shift-Cmd-Z redoes the delete", alive(r) == [0, 2] and len(r["mappings"]) == 2, summary(r))
    press("undo")
    r = cur("undo2")
    check("Cmd-Z after redo restores again", alive(r) == [0, 1, 2] and maps(r) == base_maps, summary(r))

    # ---- 5. Ctrl-Y redoes
    press("ctrl_y")
    r = cur("redo2")
    check("Ctrl-Y redoes the delete", alive(r) == [0, 2] and len(r["mappings"]) == 2, summary(r))
    press("ctrl_z")
    r = cur("undo3")
    check("Ctrl-Z undoes (same as Cmd-Z)", alive(r) == [0, 1, 2] and maps(r) == base_maps, summary(r))

    # ---- 6. forward-Delete (fn-Delete) also deletes
    press("fwddelete")
    r = cur("fwd")
    check("forward Delete (fn-Delete) deletes the selected modulator", alive(r) == [0, 2], summary(r))
    press("undo")
    r = cur("undo4")
    check("Cmd-Z restores after forward Delete", alive(r) == [0, 1, 2] and maps(r) == base_maps, summary(r))

    # ---- 7. focus lost: click outside the device, then keys do nothing; click back in, keys work again
    click_ui(*strip_head(2))          # select mod 2, focus
    press("delete")
    r = cur("del2")
    check("click strip 3 + Delete deletes mod 2", alive(r) == [0, 1], summary(r))
    click_away()
    press("undo")
    press("delete")
    r = cur("away")
    check("after clicking outside the device: Cmd-Z and Delete are ignored", alive(r) == [0, 1] and maps(r) == base_maps, summary(r))
    click_ui(*strip_head(0))
    press("undo")
    r = cur("back")
    check("click back into the device: Cmd-Z works again (restores mod 2 + mapping)", alive(r) == [0, 1, 2] and maps(r) == base_maps, summary(r))
    return all(results)


if __name__ == "__main__":
    main()
