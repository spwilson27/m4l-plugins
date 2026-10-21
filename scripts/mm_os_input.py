#!/usr/bin/env python3
"""Real OS input for UI tests, for the tart VM macos-1 (AGENTS.md 1a): System Events key presses and
CGEvent mouse clicks (the VM has no cliclick). Imported by scripts/run_megamod_key_tests.py and used as a CLI
by scripts/test_megamod_keys_live.js (over ssh):

  python3 scripts/mm_os_input.py front Live          bring the process to the front (by name)
  python3 scripts/mm_os_input.py window Live         print {"x","y","w","h"} of its first window (screen points)
  python3 scripts/mm_os_input.py click X Y [double]  left click at screen point X, Y
  python3 scripts/mm_os_input.py drag X Y DX DY      left press at X, Y, drag by DX, DY, release
  python3 scripts/mm_os_input.py cgwindows Live     window-server list of the process' windows (a context menu is one)
  python3 scripts/mm_os_input.py move X Y [SECS]    move the pointer (no click)
  python3 scripts/mm_os_input.py rclick X Y          right click (context menu stays open)
  python3 scripts/mm_os_input.py key delete          one key: delete | fwddelete | undo | redo | ctrl_z | ctrl_y | escape | cmd_d
  python3 scripts/mm_os_input.py keys                list the key names

Needs Accessibility permission for the ssh chain (osascript System Events and CGEventPost).
"""

import ctypes
import ctypes.util
import json
import subprocess
import sys
import time


def osa(script):
    r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=30)
    if r.returncode:
        raise RuntimeError(f"osascript failed: {r.stderr.strip()}")
    return r.stdout.strip()


def sysevents(body):
    return osa(f'tell application "System Events"\n{body}\nend tell')


_cg = ctypes.CDLL(ctypes.util.find_library("ApplicationServices"))


class CGPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_double), ("y", ctypes.c_double)]


_cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, CGPoint, ctypes.c_uint32]
_cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
_cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
_cg.CGEventSetIntegerValueField.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int64]
_cg.CFRelease.argtypes = [ctypes.c_void_p]


def _mouse(kind, x, y, click_state=1, button=0):
    ev = _cg.CGEventCreateMouseEvent(None, kind, CGPoint(x, y), button)
    _cg.CGEventSetIntegerValueField(ev, 1, click_state)  # kCGMouseEventClickState
    _cg.CGEventPost(0, ev)  # kCGHIDEventTap
    _cg.CFRelease(ev)


def click(x, y, double=False):
    """A real left click at screen point (x, y) (top-left origin, points)."""
    _mouse(5, x, y)  # moved (the hover is what makes Max / Live route the click to the right view)
    time.sleep(0.15)
    for n in (1, 2) if double else (1,):
        _mouse(1, x, y, n)
        time.sleep(0.05)
        _mouse(2, x, y, n)
        time.sleep(0.08)
    time.sleep(0.25)


def drag(x, y, dx, dy, steps=12, shift=False):
    """A real left press at (x, y), dragged by (dx, dy) in `steps` events, released there (a held drag, like a user turning a dial)."""
    _mouse(5, x, y)
    time.sleep(0.2)
    _mouse(1, x, y, 1)
    time.sleep(0.15)
    for i in range(1, steps + 1):
        _mouse(6, x + dx * i / steps, y + dy * i / steps, 1)  # kCGEventLeftMouseDragged
        time.sleep(0.03)
    time.sleep(0.1)
    _mouse(2, x + dx, y + dy, 1)
    time.sleep(0.3)


def rclick(x, y):
    """A real right click (the context menu), without choosing anything."""
    _mouse(5, x, y)
    time.sleep(0.2)
    _mouse(3, x, y, 1, 1)  # kCGEventRightMouseDown, button 1
    time.sleep(0.05)
    _mouse(4, x, y, 1, 1)
    time.sleep(0.5)


KEYS = {
    "delete": "key code 51",                                   # the Mac "Delete" key (backspace)
    "fwddelete": "key code 117",                               # fn-Delete
    "escape": "key code 53",
    "undo": 'keystroke "z" using command down',
    "redo": 'keystroke "z" using {command down, shift down}',
    "ctrl_z": 'keystroke "z" using control down',
    "ctrl_y": 'keystroke "y" using control down',
    "cmd_d": 'keystroke "d" using command down',
}


def press(name, settle=0.5):
    sysevents(KEYS[name])
    time.sleep(settle)


def front(process="Max"):
    sysevents(f'set frontmost of process "{process}" to true')
    time.sleep(0.5)


def window(process):
    out = sysevents(f'tell process "{process}" to get {{position, size}} of window 1')
    x, y, w, h = [int(float(v)) for v in out.replace(" ", "").split(",")]
    return {"x": x, "y": y, "w": w, "h": h}


def main(argv):
    if len(argv) < 2 or argv[1] == "keys":
        print(" ".join(KEYS))
        return 0
    cmd = argv[1]
    if cmd == "front":
        front(argv[2])
    elif cmd == "window":
        print(json.dumps(window(argv[2])))
    elif cmd == "click":
        click(float(argv[2]), float(argv[3]), len(argv) > 4 and argv[4] == "double")
    elif cmd == "drag":
        drag(float(argv[2]), float(argv[3]), float(argv[4]), float(argv[5]))
    elif cmd == "move":
        _mouse(5, float(argv[2]), float(argv[3]))
        time.sleep(float(argv[4]) if len(argv) > 4 else 0.15)
    elif cmd == "rclick":
        rclick(float(argv[2]), float(argv[3]))
    elif cmd == "cgwindows":
        # on-screen windows of a process from the window server (JXA + CoreGraphics): [layer, name, x, y, w, h, number]. A context menu
        # is its own window (layer >= 101), which System Events does not list.
        js = ('ObjC.import("CoreGraphics");'
              'var a = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)));'
              'JSON.stringify(a.filter(function (w) { return w.kCGWindowOwnerName == "%s"; }).map(function (w) {'
              'var b = w.kCGWindowBounds; return [w.kCGWindowLayer, w.kCGWindowName || "", b.X, b.Y, b.Width, b.Height, w.kCGWindowNumber]; }))' % argv[2])
        r = subprocess.run(["osascript", "-l", "JavaScript", "-e", js], capture_output=True, text=True, timeout=30)
        print(r.stdout.strip() or ("ERR " + r.stderr.strip()))
    elif cmd == "menu":
        # what System Events can see of Live's context menu: windows, menus of the process, menu items of its menu bars / windows
        probes = [
            ("windows", 'tell process "%s" to get name of every window'),
            ("window roles", 'tell process "%s" to get {role, subrole} of every window'),
            ("process menus", 'tell process "%s" to get name of every menu'),
            ("window 1 menus", 'tell process "%s" to get name of every menu of window 1'),
            ("window 1 elements", 'tell process "%s" to get {role, name} of every UI element of window 1'),
            ("frontmost window menu items", 'tell process "%s" to get name of every menu item of every menu of every window'),
            ("menu bar item count", 'tell process "%s" to get count of menu items of menu 1 of menu bar item 1 of menu bar 1'),
        ]
        for label, body in probes:
            try:
                print(f"{label}: {sysevents(body % argv[2])}")
            except Exception as e:  # the probe that fails is information too
                print(f"{label}: ERR {str(e).splitlines()[0][-90:]}")
    elif cmd == "key":
        press(argv[2])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
