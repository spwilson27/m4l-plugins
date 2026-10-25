#!/usr/bin/env python3
"""Move the pointer inside Ableton Live and drag the sample title onto an audio track.

Success is a session clip whose file is the loaded wav, read back through Live's API.
A drag-operation code is not enough: dropping on a MIDI track only opens Convert Audio to MIDI.
Runs in the tart VM as the console user (BS_DRAG_VM=1).
"""
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mm_os_input as mo  # noqa: E402

WAV = "/tmp/60 - LOOP_YAW.wav"
STATE = "/tmp/bs_drag_state.json"
# Measured from the VM screenshot while Session + the device were both on screen.
# Filename glyphs on the cyan header, and the first clip cell of the WavDrop column.
TITLE = (348, 793)
SLOT = (746, 118)


def fail(msg):
    print("FAIL", msg)
    sys.exit(1)


def rpc(code):
    body = json.dumps({"action": "eval_js", "params": {"code": code}}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:9877/rpc", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=25) as res:
        out = json.loads(res.read().decode())
    if not out.get("ok"):
        fail("bridge: %s" % out)
    return out.get("result", {}).get("result")


def state():
    try:
        return json.loads(open(STATE).read() or "{}")
    except (OSError, ValueError):
        return {}


def hover_arms(x, y):
    try:
        os.remove(STATE)
    except OSError:
        pass
    mo._mouse(5, x, y)
    time.sleep(0.25)
    st = state()
    paths = st.get("paths") or []
    return bool(st.get("visible") and WAV in paths), st


def find_title():
    ok, st = hover_arms(*TITLE)
    if ok:
        return TITLE, st
    # The device can sit a few pixels off the last screenshot. Stay on the name bar.
    for y in range(770, 840, 6):
        for x in range(280, 460, 12):
            ok, st = hover_arms(x, y)
            if ok:
                return (x, y), st
    return None, st


def slow_drag(x, y, tx, ty):
    print("pointer down", x, y)
    mo._mouse(5, x, y)
    time.sleep(0.3)
    mo._mouse(1, x, y, 1)
    time.sleep(0.2)
    steps = 28
    for i in range(1, steps + 1):
        px = x + (tx - x) * i / steps
        py = y + (ty - y) * i / steps
        mo._mouse(6, px, py, 1)
        time.sleep(0.035)
    time.sleep(0.35)
    print("pointer up", tx, ty)
    mo._mouse(2, tx, ty, 1)
    time.sleep(0.6)


def clip_at(track):
    return rpc(
        'var slot = new LiveAPI("live_set tracks %d clip_slots 0");'
        'var has = getScalar(slot, "has_clip");'
        'if (!has) return { has: 0 };'
        'var clip = new LiveAPI("live_set tracks %d clip_slots 0 clip");'
        'return { has: 1, file: String(getScalar(clip, "file_path") || ""),'
        ' name: String(getScalar(clip, "name") || ""),'
        ' midi: getScalar(clip, "is_midi_clip") };' % (track, track)
    )


def main():
    if os.environ.get("BS_DRAG_VM") != "1":
        fail("this moves the pointer in Live; set BS_DRAG_VM=1")
    mo.front("Live")
    time.sleep(0.3)
    mo.press("escape", 0.3)
    mo.press("escape", 0.2)
    info = rpc(
        'var song = new LiveAPI("live_set");'
        'var n = song.getcount("tracks");'
        'var wav = -1, samp = -1;'
        'for (var i = 0; i < n; i++) {'
        '  var tr = new LiveAPI("live_set tracks " + i);'
        '  var name = String(getScalar(tr, "name") || "");'
        '  if (name === "WavDrop") wav = i;'
        '  if (name.indexOf("Better Sampler Reactive 2") >= 0) samp = i;'
        '}'
        'if (wav < 0) {'
        '  var raw = song.call("create_audio_track", -1);'
        '  var id = raw && raw.length ? raw[raw.length - 1] : raw;'
        '  var tr = new LiveAPI("id " + id);'
        '  tr.set("name", "WavDrop");'
        '  wav = song.getcount("tracks") - 1;'
        '}'
        'var v = new LiveAPI("live_set view");'
        'if (samp >= 0) v.set("selected_track", "id", Number(new LiveAPI("live_set tracks " + samp).id));'
        'var a = new LiveAPI("live_app view");'
        'a.call("show_view", "Session");'
        'a.call("show_view", "Detail");'
        'a.call("show_view", "Detail/DeviceChain");'
        'var slot = new LiveAPI("live_set tracks " + wav + " clip_slots 0");'
        'if (getScalar(slot, "has_clip")) slot.call("delete_clip");'
        'return { wav: wav, samp: samp, n: song.getcount("tracks") };'
    )
    print("tracks", info)
    if not info or info.get("wav") is None or int(info["wav"]) < 0:
        fail("no WavDrop audio track")
    time.sleep(0.6)
    hit, st = find_title()
    print("title", hit, "state", st)
    if not hit:
        fail("the pointer never armed a drag from the sample name")
    try:
        os.remove("/tmp/bs_drag_end.txt")
    except OSError:
        pass
    slow_drag(hit[0], hit[1], SLOT[0], SLOT[1])
    end = ""
    try:
        end = open("/tmp/bs_drag_end.txt").read().strip()
    except OSError:
        pass
    print("drag end", end)
    time.sleep(0.8)
    got = clip_at(int(info["wav"]))
    print("clip", got)
    file_path = (got or {}).get("file") or ""
    if "LOOP_YAW" not in file_path:
        print("windows", subprocess_windows())
        fail("the clip slot does not hold the sample: %r" % got)
    print("imported", file_path)


def subprocess_windows():
    import subprocess
    r = subprocess.run([sys.executable, os.path.join(HERE, "mm_os_input.py"), "cgwindows", "Live"],
                       capture_output=True, text=True)
    return (r.stdout or r.stderr)[:1500]


if __name__ == "__main__":
    main()
