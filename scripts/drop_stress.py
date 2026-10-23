#!/usr/bin/env python3
"""Crash-count matrix for real file drops onto Live / Max drop targets (AGENTS.md section 27, "Open" crash notes).
Runs INSIDE the tart VM (AGENTS.md 1a), python3 -I-free system python (3.9), as the logged-in user. Needs Accessibility
for the ssh chain (scripts/mm_os_input.py). The host wrapper holds the Live lock for the whole run:

  scripts/vm_live_lock.sh dropstress -- <ssh into the VM> 'cd ~/ableton && python3 scripts/build_dropprobe.py &&
        /usr/bin/python3 scripts/drop_stress.py --cells F-df,F-ld --drops 300 --max-crashes 3'

Cells are "<source>-<target>" (target sink = a plain Cocoa drop window, no Live and no Max): source F = real Finder drag (a Finder list view of ~/dropfinder, press on the file icon, CGEvent
drag), S = synthetic scripts/rp_drag_source.m (NSDraggingSource); target rp = Reverb+ (reverbplus_test.als, HEAD build),
df = DropProbe DF (only a transparent whole-face dropfile), ld = DropProbe LD (only a whole-face live.drop in parameter mode),
native = a drop on Live's own session area outside any device (Live-native baseline), maxpatch = standalone Max 9 with a
dropfile (left half) and a live.drop (right half), alternating (plain launch, no Live running; deviation from AGENTS.md 1b
as in XO's runtime test: this is a UI test, not an audio render).

Per cell it records: drops delivered, drops received by the target (probe counter files /tmp/dropprobe_<name>.txt, or the
Reverb+ engine's ir.ver through the bridge), accepted (the synthetic source reports the drag operation), new crash reports in
~/Library/Logs/DiagnosticReports with a signature, and restarts Live after each crash. Result lines go to
/tmp/drop_stress_results.jsonl, progress to /tmp/drop_stress.log. A cell stops early after --max-crashes crashes.
"""
import argparse
import fcntl
import glob
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mm_os_input as mo  # noqa: E402

HOME = os.path.expanduser("~")
REPO = os.path.dirname(HERE)
PROBE = os.path.join(REPO, "tests", "out", "dropprobe")
DIAG = os.path.join(HOME, "Library", "Logs", "DiagnosticReports")
LOG = "/tmp/drop_stress.log"
RESULTS = "/tmp/drop_stress_results.jsonl"
FINDER_DIR = os.path.join(HOME, "dropfinder")
BRIDGE = "http://127.0.0.1:9877"
LIVE_APP = "Ableton Live 12 Suite"
MAX_BIN = "/Applications/Max.app/Contents/MacOS/Max"
SETS = {"rp": os.path.join(REPO, "reverbplus_test.als"), "df": os.path.join(PROBE, "probe_df.als"),
        "ld": os.path.join(PROBE, "probe_ld.als"), "cal": os.path.join(PROBE, "probe_cal.als"),
        "native": os.path.join(PROBE, "probe_df.als")}
FACE_W, FACE_H = 220, 169
RP_FACE_W = 444
RP_SPOTS = [(413, 123), (31, 30), (413, 29), (200, 60), (222, 13), (413, 65), (100, 150), (270, 150), (175, 150), (5, 5)]


def move(x, y, secs=0.15):
    mo._mouse(5, x, y)
    time.sleep(secs)


def log(*a):
    line = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def sh(cmd, timeout=60):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout).stdout


# ---- bridge ----------------------------------------------------------------------------------------------------------

def rpc(action, params, timeout=20):
    req = urllib.request.Request(BRIDGE + "/rpc", data=json.dumps({"action": action, "params": params}).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())


def lom(code):
    d = rpc("eval_js", {"code": code})
    if isinstance(d, dict) and d.get("error"):
        raise RuntimeError(d["error"])
    r = d.get("result", d) if isinstance(d, dict) else d
    if isinstance(r, dict) and "result" in r:
        r = r["result"]
    if isinstance(d, dict) and d.get("ok") is False:
        raise RuntimeError(str(d.get("error")))
    return r


def bridge_up(fresh_within=None):
    """True when a bridge answers on 9877..9884 (a Live stuck exiting keeps 9877 and the new bridge takes the next port, AGENTS.md
    section 21); fresh_within=<s>: only one that started less than that many seconds ago. Sets the global BRIDGE to it."""
    global BRIDGE
    for port in range(9877, 9885):
        try:
            d = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=1).read().decode())
        except Exception:
            continue
        if fresh_within is None or d.get("uptime_ms", 0) / 1000.0 < fresh_within:
            BRIDGE = "http://127.0.0.1:%d" % port
            return True
    return False


# ---- Live / Max lifecycle --------------------------------------------------------------------------------------------

def live_pids():
    return sh("pgrep -f 'Contents/MacOS/Live'").split()


def reports():
    return set(os.listdir(DIAG)) if os.path.isdir(DIAG) else set()


def live_kill():
    sh("pkill -f 'Contents/MacOS/Live'; pkill -f 'Max.app/Contents/MacOS/Max .*dropprobe'")
    time.sleep(3)
    for _ in range(30):
        if not live_pids():
            break
        time.sleep(0.5)
    if live_pids():
        sh("pkill -9 -f 'Contents/MacOS/Live'")
        time.sleep(2)
    # the embedded Max of the killed Live (and its helper) must be gone before the next launch, or the new Live stops at a modal
    sh("pkill -f 'Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app'; true")
    for _ in range(20):
        if not sh("pgrep -f 'Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app'").split():
            break
        time.sleep(0.5)
    sh("rm -f %s/Library/Preferences/Ableton/Live\\ */CrashRecoveryInfo.cfg %s/Library/Preferences/Ableton/Live\\ */CrashDetection.cfg" % (HOME, HOME))
    for _ in range(30):
        if not bridge_up():
            break
        time.sleep(1)
    if bridge_up():
        log("WARNING: a bridge still answers after the kill (a Live stuck exiting?): ", sh("ps -axo pid,stat,etime,command | grep -i 'live' | grep -v grep | cut -c1-120"))
    time.sleep(1)


def live_open(setpath, wait=240):
    live_kill()
    subprocess.run(["open", "-a", LIVE_APP, setpath])
    t0 = time.time()
    pressed = False
    while time.time() - t0 < wait:
        if bridge_up(fresh_within=time.time() - t0 + 5):
            break
        if not pressed and time.time() - t0 > 100:
            pressed = True  # an unknown modal at startup (seen once after killing a Live with an open set): dismiss it
            log("no bridge after 100 s: pressing Return once")
            subprocess.run(["osascript", "-e", 'tell application "System Events" to key code 36'])
        time.sleep(2)
    else:
        raise RuntimeError("bridge did not come up for " + setpath)
    for _ in range(90):
        try:
            if lom("return 1;") == 1:
                break
        except Exception:
            pass
        time.sleep(2)
    time.sleep(6)
    log("live up with", os.path.basename(setpath), "after %.0fs" % (time.time() - t0))


def select_track():
    lom('var v = new LiveAPI("live_set view"); v.set("selected_track", "id " + new LiveAPI("live_set master_track").id);'
        ' v.set("selected_track", "id " + new LiveAPI("live_set tracks 0").id); return 1;')
    time.sleep(1.5)
    mo.front("Live")


def calibrate():
    """Device origin on screen (top-left of the first device in the detail view): the Cal probe reports the pointer position."""
    live_open(SETS["cal"])
    select_track()
    win = mo.window("Live")
    lom('var g = new Global("dropprobe"); g.hover = null; return 1;')
    move(win["x"] + 5, win["y"] + 5, 0.4)
    for y in range(win["y"] + win["h"] - 150, win["y"] + win["h"] - 8, 8):
        for px in range(win["x"] + 20, win["x"] + win["w"] - 20, 24):
            move(px, y, 0.05)
            hv = lom('return new Global("dropprobe").hover;')
            if hv:
                lom('new Global("dropprobe").hover = null; return 1;')
                move(px + 12, y + 4, 0.3)
                hv2 = lom('return new Global("dropprobe").hover;')
                if not hv2:
                    continue
                r = json.loads(hv2)
                o = {"x": px + 12 - r["x"], "y": y + 4 - r["y"], "win": win}
                log("calibrated origin", o)
                return o
    raise RuntimeError("calibration found no device on screen (window %s)" % win)


# ---- crash reports ----------------------------------------------------------------------------------------------------

def signature(fname):
    try:
        raw = open(os.path.join(DIAG, fname)).read()
        body = json.loads(raw[raw.index("\n") + 1:])
    except Exception as e:
        return {"file": fname, "error": str(e)}
    exc = body.get("exception", {})
    asi = body.get("asi", {})
    ft = body.get("faultingThread", 0)
    th = (body.get("threads") or [{}])[ft] if body.get("threads") else {}
    frames = [f.get("symbol") or ("img%s+%s" % (f.get("imageIndex"), f.get("imageOffset"))) for f in th.get("frames", [])[:8]]
    return {"file": fname, "type": exc.get("type"), "signal": exc.get("signal"), "asi": asi, "thread": th.get("queue") or th.get("name"),
            "frames": frames, "version": body.get("osVersion", {}).get("train"), "app": body.get("procName")}


def slow_drag(x, y, tx, ty, steps=24, step_s=0.06, dwell=0.6):
    """A held real left drag from (x, y) to (tx, ty): slower and with a dwell before the release than mm_os_input.drag (the 1920x1080 VM
    delivered nothing with the fast one: the drag session did not finish)."""
    mo._mouse(5, x, y)
    time.sleep(0.3)
    mo._mouse(1, x, y, 1)
    time.sleep(0.3)
    for i in range(1, steps + 1):
        mo._mouse(6, x + (tx - x) * i / steps, y + (ty - y) * i / steps, 1)
        time.sleep(step_s)
    time.sleep(dwell)
    mo._mouse(6, tx, ty, 1)
    time.sleep(0.1)
    mo._mouse(2, tx, ty, 1)
    time.sleep(0.5)


# ---- sources ----------------------------------------------------------------------------------------------------------

def ensure_wavs():
    os.makedirs("/tmp/rpdrop", exist_ok=True)
    os.makedirs(FINDER_DIR, exist_ok=True)
    src = "/tmp/rpdrop/ir_src.wav"
    if not os.path.exists(src):
        import math, struct, wave
        w = wave.open(src, "wb")
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
        w.writeframes(b"".join(struct.pack("<h", int(20000 * math.exp(-i / 4000.0) * math.sin(i * 0.37))) for i in range(30000)))
        w.close()
    for i in range(1, 5):  # the synthetic source drags these; a missing path gives END 0 and nothing arrives
        sh("cp /tmp/rpdrop/ir_src.wav /tmp/rpdrop/ir_%d.wav" % i)
        assert os.path.exists("/tmp/rpdrop/ir_%d.wav" % i), "missing source file"
    sh("cp /tmp/rpdrop/ir_src.wav %s/ir_1.wav" % FINDER_DIR)
    for i in range(2, 5):
        sh("cp /tmp/rpdrop/ir_src.wav %s/ir_%d.wav" % (FINDER_DIR, i))
    sh("cc -x objective-c -fobjc-arc -framework Cocoa %s/rp_drag_source.m -o /tmp/rp_drag_source" % HERE)


class SynthSource:
    n = 0
    front = os.environ.get("DS_FRONT", "Live")

    def prepare(self):
        ensure_wavs()
        SynthSource.n = 0

    def drag(self, tx, ty):
        SynthSource.n += 1
        f = "/tmp/rpdrop/ir_%d.wav" % (SynthSource.n % 4 + 1)
        sh("rm -f /tmp/rpd.out; (nohup /tmp/rp_drag_source %s 100 200 40 20 > /tmp/rpd.out 2>&1 &)" % f)
        for _ in range(40):
            if "READY" in open("/tmp/rpd.out").read() if os.path.exists("/tmp/rpd.out") else False:
                break
            time.sleep(0.1)
        mo.front(self.front)  # DS_FRONT=Finder: the drag starts while Live is NOT the active app (calibration)
        slow_drag(120, 210, tx, ty)
        for _ in range(30):
            out = open("/tmp/rpd.out").read() if os.path.exists("/tmp/rpd.out") else ""
            if "END" in out:
                break
            time.sleep(0.1)
        m = re.search(r"END (\d+)", out)
        return (int(m.group(1)) > 0) if m else None


class FinderSource:
    PATH = 'image 1 of UI element 1 of row %d of outline 1 of scroll area 1 of splitter group 1 of splitter group 1 of window "dropfinder"'

    def prepare(self):
        ensure_wavs()
        subprocess.run(["open", FINDER_DIR])
        time.sleep(3)
        mo.sysevents('tell process "Finder" to set frontmost to true\nkeystroke "2" using command down')  # list view
        time.sleep(1)
        for cmd in ("set position to {1200, 100}", "set size to {600, 250}"):
            mo.sysevents('tell process "Finder" to tell window "dropfinder" to ' + cmd)
        time.sleep(1)
        self.rows = []
        for i in range(1, 4):  # the 4th row is not reliably hit (measured with scripts/drop_finder_calib.py): three files rotate
            out = mo.sysevents('tell process "Finder" to get {position, size} of ' + self.PATH % i)
            x, y, w, h = [int(float(v)) for v in out.replace(" ", "").split(",")]
            self.rows.append((x + w + 30 if os.environ.get("DS_NAME") else x + w // 2, y + h // 2))
        log("finder icon centres", self.rows)
        self.n = 0

    def drag(self, tx, ty):
        self.n += 1
        x, y = self.rows[self.n % len(self.rows)]
        mo.front("Finder")  # a drop on Live can leave Live active; a press on an inactive window only activates it
        mo.click(x, y)  # a single selection: Finder drags the whole selection when the press lands on a selected row
        slow_drag(x, y, tx, ty)
        return None


# ---- targets ----------------------------------------------------------------------------------------------------------

def probe_events(tag):
    """Distinct drop events in the probe's log: messages less than 400 ms apart count as one drop (a drop may output twice)."""
    try:
        ts = [int(l.split()[2]) for l in open("/tmp/dropprobe_%s.log" % tag) if l.strip()]
    except Exception:
        return 0
    ev, last = 0, None
    for t in ts:
        if last is None or t - last > 400:
            ev += 1
        last = t
    return ev


def probe_messages(tag):
    try:
        return sum(1 for l in open("/tmp/dropprobe_%s.log" % tag) if l.strip())
    except Exception:
        return 0


def rm_probe(tag):
    for ext in ("log", "txt"):
        p = "/tmp/dropprobe_%s.%s" % (tag, ext)
        if os.path.exists(p):
            os.remove(p)


class Probe:
    procs = ("Live", "Max")  # Live and its embedded Max for Live process

    def __init__(self, tag):
        self.tag = tag  # df | ld
        self.counts = 0

    def setup(self, origin):
        self.origin = origin
        for f in glob.glob("/tmp/dropprobe_*.txt") + glob.glob("/tmp/dropprobe_*.log"):
            os.remove(f)
        live_open(SETS[self.tag])
        select_track()

    def point(self, rnd):
        return self.origin["x"] + rnd.randint(30, FACE_W - 30), self.origin["y"] + rnd.randint(30, FACE_H - 30)

    def received(self):
        return self.counts + self._file()

    def _file(self):
        return probe_events(self.tag)

    def on_restart(self):
        self.counts += self._file()
        rm_probe(self.tag)

    def alive(self):
        return bool(live_pids())

    def restart(self):
        self.on_restart()
        live_open(SETS[self.tag])
        select_track()


class ReverbPlus(Probe):
    def __init__(self):
        super().__init__("rp")
        self.base = 0

    def setup(self, origin):
        self.origin = origin
        self.counts = 0
        self.restart()

    def restart(self):
        live_open(SETS["rp"])
        for _ in range(90):
            try:
                tr = str(lom('return String(new Global("reverbplus_trace").text || "");'))
                if " dsp ready after " in tr:
                    break
            except Exception:
                pass
            time.sleep(1)
        select_track()
        self.base_ver = self._ver()
        self.base_total = getattr(self, "total", 0)

    def _ver(self):
        try:
            lom('messnamed("#0-rptest", "test_report"); return 1;')
            time.sleep(0.8)
            did = lom('return new LiveAPI("live_set tracks 0 devices 0 chains 0 devices 0").id;')
            r = json.loads(lom('return String(new Global("reverbplus_test")["report_%s"] || "null");' % did))
            return int(r["ir"]["ver"])
        except Exception as e:
            log("ver read failed", e)
            return None

    def point(self, rnd):
        lx, ly = RP_SPOTS[rnd.randint(0, len(RP_SPOTS) - 1)]
        return self.origin["x"] + lx, self.origin["y"] + ly

    def received(self):
        v = self._ver()
        if v is None or self.base_ver is None:
            return self.counts
        self.last = self.counts + (v - self.base_ver)
        return self.last

    def on_restart(self):
        self.counts = getattr(self, "last", self.counts)


class Native(Probe):
    procs = ("Live",)
    """Live's own drop handling: the synthetic/Finder file dropped on the session area outside any device."""
    def __init__(self):
        super().__init__("native")

    def point(self, rnd):
        w = mo.window("Live")
        return w["x"] + rnd.randint(300, 700), w["y"] + rnd.randint(120, 260)

    def received(self):
        return -1  # Live gives no hook; "accepted" is reported by the synthetic source only

    def on_restart(self):
        pass


class Sink:
    """No Live, no Max: a plain Cocoa window that accepts file drops (scripts/rp_drop_sink.m) -- isolates the drag source / OS."""
    procs = ("rp_drop_sink",)
    tag = "sink"

    def setup(self, origin):
        live_kill()
        sh("pkill rp_drop_sink; cc -x objective-c -fobjc-arc -framework Cocoa %s/rp_drop_sink.m -o /tmp/rp_drop_sink" % HERE)
        self.base = 0
        open("/tmp/sink.out", "w").close()
        self.restart()

    def restart(self):
        self.base += self._n()
        sh("pkill rp_drop_sink; true")
        self.proc = subprocess.Popen(["/tmp/rp_drop_sink", "560", "480", "220", "169"], stdout=open("/tmp/sink.out", "w"),
                                     stdin=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        time.sleep(2)
        self.origin = {"x": 560, "y": 480}

    def _n(self):
        try:
            return sum(1 for l in open("/tmp/sink.out") if l.startswith("DROP"))
        except Exception:
            return 0

    def point(self, rnd):
        return self.origin["x"] + rnd.randint(30, FACE_W - 30), self.origin["y"] + rnd.randint(30, FACE_H - 30)

    def received(self):
        return self.base + self._n()

    def on_restart(self):
        pass

    def alive(self):
        return self.proc.poll() is None


class MaxPatch:
    procs = ("Max",)
    tag = "maxpatch"
    PATCH = os.path.join(PROBE, "dropprobe.maxpat")

    def setup(self, origin):
        live_kill()
        sh("pkill -f 'Max.app/Contents/MacOS/Max'; true")
        time.sleep(2)
        self.counts = {"sdf": 0, "sld": 0}
        rm_probe("sdf"); rm_probe("sld")
        self.restart()

    def restart(self):
        for k in ("sdf", "sld"):
            self.counts[k] += self._file(k)
            rm_probe(k)
        sh("rm -rf '%s/Library/Application Support/Cycling '74/Max 9/CrashRecovery' 2>/dev/null; true" % HOME)
        subprocess.Popen([MAX_BIN, self.PATCH, "-ApplePersistenceIgnoreState", "YES"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(15)
        mo.front("Max")
        ws = json.loads(subprocess.run([sys.executable, os.path.join(HERE, "mm_os_input.py"), "cgwindows", "Max"], capture_output=True, text=True).stdout)
        ws = [w for w in ws if w[0] == 0] or ws
        w = min(ws, key=lambda w: abs(w[4] - 400) + abs(w[5] - 222))
        pos, siz, best = [[w[2], w[3]]], [[w[4], w[5]]], 0
        self.origin = {"x": pos[best][0], "y": pos[best][1] + siz[best][1] - 200}
        log("max patch window", pos[best], siz[best], "->", self.origin)
        self.i = 0

    def point(self, rnd):
        self.i += 1
        half = (self.i % 2) * 200
        return self.origin["x"] + half + rnd.randint(10, 190), self.origin["y"] + rnd.randint(10, 190)

    def _file(self, k):
        return probe_events(k)

    def received(self):
        return {k: self.counts[k] + self._file(k) for k in self.counts}

    def on_restart(self):
        pass

    def alive(self):
        return bool(sh("pgrep -f 'Max.app/Contents/MacOS/Max .*dropprobe'").split())


def make_target(name):
    return {"rp": ReverbPlus, "df": lambda: Probe("df"), "ld": lambda: Probe("ld"), "native": Native, "maxpatch": MaxPatch, "sink": Sink}[name]()


# ---- cell runner -----------------------------------------------------------------------------------------------------

def run_cell(cell, drops, max_crashes, origin_cache):
    src_name, tgt_name = cell.split("-")
    src = SynthSource() if src_name == "S" else FinderSource()
    tgt = make_target(tgt_name)
    if tgt_name == "maxpatch":
        SynthSource.front = "Max"
    if tgt_name == "sink":
        SynthSource.front = "Finder"
    # the machine-wide Max lock for every cell: a harness Max of another session opens windows over the screen area this test drives
    # (lock order: Live lock first, held by the host wrapper, then this one)
    lock = open("/tmp/m4l_real_max.lock", "w")
    log("waiting for the Max lock")
    fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        origin = None
        if tgt_name in ("rp", "df", "ld", "native"):
            if "o" not in origin_cache:
                origin_cache["o"] = calibrate()
            origin = origin_cache["o"]
        # a drag session left over from an earlier run (a ghost drag image on screen, seen after a Finder crash) blocks every new drag
        mo._mouse(2, 5, 5, 1)
        sh("pkill rp_drag_source; pkill Safari; killall Finder; true")
        time.sleep(4)
        before = reports()
        tgt.setup(origin)
        src.prepare()
        rnd = random.Random(7)
        delivered = accepted = 0
        # pre-flight: a calibration drop must arrive before the cell starts (a silent 0-received cell must not happen again)
        for _ in range(6):
            r0 = tgt.received()
            tx, ty = tgt.point(rnd)
            ok = src.drag(tx, ty)
            delivered += 1
            accepted += 1 if ok else 0
            time.sleep(1.0)
            r1 = tgt.received()
            if r1 != r0 or (tgt_name == "native" and ok):
                break
        else:
            if not (tgt_name == "native" and src_name == "F"):
                raise RuntimeError("pre-flight: no calibration drop was received (received %s)" % (r1,))
        crashes = []
        t0 = time.time()
        src_crashes = []
        while delivered < drops and len(crashes) < max_crashes and len(src_crashes) < 40:
            tx, ty = tgt.point(rnd)
            ok = src.drag(tx, ty)
            delivered += 1
            accepted += 1 if ok else 0
            time.sleep(0.6)
            if os.environ.get("DS_DEBUG") and delivered <= 20:
                log("drop", delivered, "at", (tx, ty), "ok", ok, "received", tgt.received())
            new = sorted(reports() - before)
            if new or (delivered % 5 == 0 and not tgt.alive()):
                time.sleep(4)  # let the report(s) be written
                new = sorted(reports() - before)
                tgt_died = False
                for f in new:
                    before.add(f)
                    sg = signature(f)
                    mine = sg.get("app") in tgt.procs
                    (crashes if mine else src_crashes).append(sg)
                    tgt_died = tgt_died or mine
                    log("%s CRASH (%s) after %d drops: %s" % ("TARGET" if mine else "SOURCE-SIDE", sg.get("app"), delivered, json.dumps(sg)[:420]))
                if not tgt.alive() and not tgt_died:
                    crashes.append({"error": "target process gone, no report"})
                    tgt_died = True
                if tgt_died and len(crashes) < max_crashes:
                    tgt.restart()
                if src_name == "F" and (new or tgt_died):
                    mo._mouse(2, tx, ty, 1)  # release a button a crashed drag may have left down
                    time.sleep(1)
                    src.prepare()
            if delivered % 25 == 0:
                log(cell, "drops", delivered, "received", tgt.received(), "target crashes", len(crashes), "source-side crashes", len(src_crashes), "%.0fs" % (time.time() - t0))
        rec = tgt.received()
        res = {"cell": cell, "drops": delivered, "accepted(synthetic only)": accepted if src_name == "S" else None, "received": rec,
               "target_crashes": len(crashes), "source_side_crashes": len(src_crashes), "signatures": crashes, "source_signatures": src_crashes,
               "seconds": round(time.time() - t0)}
        with open(RESULTS, "a") as f:
            f.write(json.dumps(res) + "\n")
        log("CELL DONE", json.dumps(res)[:600])
        return res
    finally:
        sh("pkill rp_drop_sink; true")
        if lock:
            sh("pkill -f 'Max.app/Contents/MacOS/Max .*dropprobe'; true")
            fcntl.flock(lock, fcntl.LOCK_UN)
            lock.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cells", required=True)
    ap.add_argument("--drops", type=int, default=300)
    ap.add_argument("--max-crashes", type=int, default=3)
    a = ap.parse_args()
    cache = {}
    for c in a.cells.split(","):
        try:
            run_cell(c, a.drops, a.max_crashes, cache)
        except Exception as e:
            log("CELL ERROR", c, repr(e))
            with open(RESULTS, "a") as f:
                f.write(json.dumps({"cell": c, "error": repr(e)}) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
