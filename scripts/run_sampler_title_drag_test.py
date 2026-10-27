#!/usr/bin/env python3
"""Drag the sample title in Better Sampler Reactive 2, inside Live, and prove the file moves.

The standalone helper test never touches this title. This one loads a wav whose name contains
spaces, finds the title by hovering until the device arms its drag panel, and drags that
point onto a drop target. Runs in the tart VM as the console user (scripts/vm_sampler.sh titledrag).
"""
import json
import os
import struct
import subprocess
import sys
import time
import urllib.request
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mm_os_input as mo  # noqa: E402

WAV = "/tmp/60 - LOOP_YAW.wav"
STATE = "/tmp/bs_drag_state.json"
LOG = "/tmp/bs_drag_node.log"
SINK = "/tmp/rp_drop_sink"
SINK_OUT = "/tmp/bs_title_drag_sink.out"
SINK_AT = (1500, 80, 280, 160)


def fail(msg):
    print("FAIL", msg)
    print("--- node log ---")
    print(read(LOG)[-4000:])
    sys.exit(1)


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


def read(path):
    try:
        return open(path).read()
    except OSError:
        return ""


def write_wav(path):
    n = 4410
    w = wave.open(path, "wb")
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(44100)
    w.writeframes(b"".join(struct.pack("<h", 8000 if i < n // 2 else -8000) for i in range(n)))
    w.close()


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


def probe():
    return rpc(
        'var m = new Global("better_sampler_hooks").map || {}; var k = Object.keys(m); var dbg = k.length ? m[k[k.length - 1]] : "";messnamed(dbg, "drag_probe");'
        'var g = new Global("bs_drag_probe");'
        'return { path: String(g.path || ""), name: String(g.name || ""), armed: g.armed || 0 };'
    )


def state():
    try:
        return json.loads(read(STATE) or "{}")
    except ValueError:
        return {}


def hover_arms(x, y):
    try:
        os.remove(STATE)
    except OSError:
        pass
    mo._mouse(5, x, y)
    time.sleep(0.22)
    st = state()
    paths = st.get("paths") or []
    return st.get("visible") and WAV in paths


def find_title(win):
    # The filename sits on the top edge of the device, low in the window. Sweep that band first.
    mo._mouse(5, 286, 790)
    time.sleep(2.5)
    bands = [(830, 750), (win["y"] + win["h"] - 40, max(win["y"] + 200, win["y"] + win["h"] - 280))]
    x1 = min(win["x"] + win["w"] - 20, win["x"] + 720)
    for y0, y1 in bands:
        for y in range(int(y0), int(y1), -10):
            for x in range(int(win["x"] + 20), int(x1), 14):
                if hover_arms(x, y):
                    return x, y
    return None


def slow_drag(x, y, tx, ty):
    mo._mouse(5, x, y)
    time.sleep(0.25)
    mo._mouse(1, x, y, 1)
    time.sleep(0.2)
    steps = 24
    for i in range(1, steps + 1):
        mo._mouse(6, x + (tx - x) * i / steps, y + (ty - y) * i / steps, 1)
        time.sleep(0.04)
    time.sleep(0.4)
    mo._mouse(2, tx, ty, 1)
    time.sleep(0.4)


def main():
    if os.environ.get("BS_DRAG_VM") != "1":
        fail("this drives the pointer inside Live; run it with scripts/vm_sampler.sh titledrag")
    write_wav(WAV)
    try:
        urllib.request.urlopen("http://127.0.0.1:9877/health", timeout=3).read()
    except Exception as exc:
        fail("bridge is not up: %s" % exc)
    open(LOG, "w").close()
    rpc(
        'var a = new LiveAPI("live_app view");'
        'a.call("show_view", "Detail");'
        'a.call("show_view", "Detail/DeviceChain");'
        'a.call("focus_view", "Detail/DeviceChain");'
        'return 1;'
    )
    rpc('var m = new Global("better_sampler_hooks").map || {}; var k = Object.keys(m); var dbg = k.length ? m[k[k.length - 1]] : "";messnamed(dbg, "dropfile", %s); return 1;' % json.dumps(WAV))
    time.sleep(1.2)
    got = probe()
    print("probe", got)
    if not got or got.get("path") != WAV:
        fail("the title is not showing %s (probe %r)" % (WAV, got))
    mo.front("Live")
    time.sleep(0.4)
    win = mo.window("Live")
    print("live window", win)
    r = subprocess.run(
        ["/usr/bin/clang", "-fobjc-arc", "-framework", "Cocoa", os.path.join(HERE, "rp_drop_sink.m"), "-o", SINK],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        fail("clang sink\n%s" % r.stderr[-1500:])
    open(SINK_OUT, "w").close()
    sink = subprocess.Popen(
        [SINK, str(SINK_AT[0]), str(SINK_AT[1]), str(SINK_AT[2]), str(SINK_AT[3])],
        stdout=open(SINK_OUT, "w"), stderr=subprocess.DEVNULL, start_new_session=True,
    )
    try:
        for _ in range(30):
            if "READY" in read(SINK_OUT):
                break
            time.sleep(0.1)
        else:
            fail("drop sink did not start")
        hit = find_title(win)
        if not hit:
            fail("hovering the device never armed a drag of the sample")
        print("title at", hit, "state", state())
        try:
            os.remove("/tmp/bs_drag_end.txt")
        except OSError:
            pass
        sx = SINK_AT[0] + SINK_AT[2] // 2
        sy = SINK_AT[1] + SINK_AT[3] // 2
        slow_drag(hit[0], hit[1], sx, sy)
        sink_out = read(SINK_OUT)
        print("sink", sink_out, "end", read("/tmp/bs_drag_end.txt").strip())
        if ("DROP " + WAV) not in sink_out:
            fail("dragging the title did not deliver the sample: %r" % sink_out)
        # The same gesture, dropped on Live's arrangement, must be accepted.
        hit = find_title(win) or hit
        try:
            os.remove("/tmp/bs_drag_end.txt")
        except OSError:
            pass
        slow_drag(hit[0], hit[1], win["x"] + 520, win["y"] + 280)
        end = read("/tmp/bs_drag_end.txt").strip()
        print("live end", end)
        op = end.replace("END ", "")
        if not op.isdigit() or int(op) == 0:
            fail("Live did not accept the title drag: %r" % end)
        print("title drag delivered", WAV, "and Live accepted it", end)
    finally:
        if sink.poll() is None:
            sink.terminate()
        sh("pkill -f '[r]p_drop_sink'; true")
        mo._mouse(2, 8, 8, 1)


if __name__ == "__main__":
    main()
