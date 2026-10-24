#!/usr/bin/env python3
"""Prove Better Sampler's file drag lands in another app, and that Ableton Live accepts it.

Runs in the tart VM (scripts/vm_sampler.sh drag). Compiles scripts/bs_drag_helper.m, the source
the device embeds. A click that does not move prints REPLAY_CLICK. A drag of a real wav onto
scripts/rp_drop_sink.m must deliver that path. The same drag onto Live's window must finish
with a non-zero drag operation, which is Live accepting the file.
"""
import json
import os
import re
import struct
import subprocess
import sys
import time
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mm_os_input as mo  # noqa: E402

WAV = "/tmp/bs_drag_me.wav"
HELPER = "/tmp/bs_drag_helper_v1_bin"
SINK = "/tmp/rp_drop_sink"
STATE = "/tmp/bs_drag_state.json"
HELPER_OUT = "/tmp/bs_drag_helper.out"
SINK_OUT = "/tmp/bs_drag_sink.out"
START = (200, 160)
SINK_AT = (1000, 620, 220, 140)


def fail(msg):
    print("FAIL", msg)
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


def clang(src, out):
    r = subprocess.run(
        ["/usr/bin/clang", "-O2", "-framework", "Cocoa", "-framework", "ApplicationServices", src, "-o", out],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        fail("clang %s\n%s" % (src, r.stderr[-2000:]))


def slow_drag(x, y, tx, ty):
    mo._mouse(5, x, y)
    time.sleep(0.3)
    mo._mouse(1, x, y, 1)
    time.sleep(0.25)
    steps = 24
    for i in range(1, steps + 1):
        mo._mouse(6, x + (tx - x) * i / steps, y + (ty - y) * i / steps, 1)
        time.sleep(0.05)
    time.sleep(0.45)
    mo._mouse(2, tx, ty, 1)
    time.sleep(0.4)


class Helper:
    def __init__(self):
        self.proc = None

    def start(self):
        sh("pkill -f '[b]s_drag_helper_v1'; true")
        open(HELPER_OUT, "w").close()
        self.proc = subprocess.Popen(
            [HELPER], stdin=subprocess.PIPE, stdout=open(HELPER_OUT, "w"), stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        for _ in range(30):
            if "READY" in read(HELPER_OUT):
                break
            if self.proc.poll() is not None:
                fail("drag helper exited at launch: %s" % read(HELPER_OUT))
            time.sleep(0.1)
        else:
            fail("drag helper did not start: %s" % read(HELPER_OUT))

    def arm(self, x, y):
        mo._mouse(5, x, y)
        time.sleep(0.2)
        try:
            os.remove(STATE)
        except OSError:
            pass
        line = json.dumps({
            "cmd": "arm", "mode": "selected_raw", "paths": [WAV],
            "w": 80, "h": 18, "stateFile": STATE,
        }) + "\n"
        self.proc.stdin.write(line.encode())
        self.proc.stdin.flush()
        for _ in range(30):
            if os.path.exists(STATE):
                st = json.loads(read(STATE) or "{}")
                if st.get("visible") and WAV in (st.get("paths") or []):
                    return
            time.sleep(0.1)
        fail("drag window did not arm: %s" % read(STATE))

    def wait_out(self, needle, since, secs=4):
        for _ in range(int(secs * 10)):
            got = read(HELPER_OUT)[since:]
            if needle in got:
                return got
            time.sleep(0.1)
        return read(HELPER_OUT)[since:]

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


def live_window():
    r = sh("pgrep -f 'MacOS/Live'")
    if not r.stdout.strip():
        print("starting Live")
        subprocess.Popen(["open", "-a", "Ableton Live 12 Suite"])
        for _ in range(40):
            time.sleep(1)
            if sh("pgrep -f 'MacOS/Live'").stdout.strip():
                break
        else:
            fail("Live did not start")
        time.sleep(6)
    mo.front("Live")
    for _ in range(20):
        try:
            return mo.window("Live")
        except Exception:
            time.sleep(0.5)
    fail("Live has no window")


def main():
    if os.environ.get("BS_DRAG_VM") != "1":
        fail("this drives the pointer and Live; run it with scripts/vm_sampler.sh drag")
    write_wav(WAV)
    clang(os.path.join(HERE, "bs_drag_helper.m"), HELPER)
    clang(os.path.join(HERE, "rp_drop_sink.m"), SINK)
    helper = Helper()
    sink = None
    try:
        helper.start()
        mark = len(read(HELPER_OUT))
        helper.arm(*START)
        mo.click(*START)
        out = helper.wait_out("REPLAY_CLICK", mark)
        if "REPLAY_CLICK" not in out:
            fail("a click on the name did not replay: %r" % out)
        if "END" in out:
            fail("a click started a file drag: %r" % out)
        print("click replays")

        open(SINK_OUT, "w").close()
        sink = subprocess.Popen(
            [SINK, str(SINK_AT[0]), str(SINK_AT[1]), str(SINK_AT[2]), str(SINK_AT[3])],
            stdout=open(SINK_OUT, "w"), stderr=subprocess.DEVNULL, start_new_session=True,
        )
        for _ in range(30):
            if "READY" in read(SINK_OUT):
                break
            time.sleep(0.1)
        else:
            fail("drop sink did not start")
        mark = len(read(HELPER_OUT))
        helper.arm(*START)
        sx = SINK_AT[0] + SINK_AT[2] // 2
        sy = SINK_AT[1] + SINK_AT[3] // 2
        slow_drag(START[0], START[1], sx, sy)
        out = helper.wait_out("END", mark)
        sink_out = read(SINK_OUT)
        if ("DROP " + WAV) not in sink_out:
            fail("sink did not receive the wav: %r helper %r" % (sink_out, out))
        op = re.search(r"END (\d+)", out)
        if not op or int(op.group(1)) == 0:
            fail("sink drag was not accepted: %r" % out)
        print("sink received", WAV)

        win = live_window()
        tx = win["x"] + min(520, max(180, win["w"] // 3))
        ty = win["y"] + min(220, max(140, win["h"] // 4))
        mark = len(read(HELPER_OUT))
        helper.arm(*START)
        slow_drag(START[0], START[1], tx, ty)
        out = helper.wait_out("END", mark, 6)
        op = re.search(r"END (\d+)", out)
        if not op:
            fail("Live drag produced no result at %s,%s: %r" % (tx, ty, out))
        if int(op.group(1)) == 0:
            fail("Live rejected the file drag at %s,%s: %r" % (tx, ty, out))
        print("Live accepted the drag (operation %s) at %s,%s" % (op.group(1), tx, ty))
    finally:
        helper.stop()
        if sink and sink.poll() is None:
            sink.terminate()
        sh("pkill -f '[b]s_drag_helper_v1'; pkill -f '[r]p_drop_sink'; true")
        mo._mouse(2, 8, 8, 1)


if __name__ == "__main__":
    main()
