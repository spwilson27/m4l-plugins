#!/usr/bin/env python3
"""
Shared real-Max test harness for every `scripts/run_<device>_audio_tests.py`.

Why: several agents run standalone Max harnesses on this machine at once. On the hardware
audio driver, `delay`-timed recordings came back partial or silent. This module renders each case
on Max's **NonRealTime** driver with all timing counted in samples, and runs ONE harness Max at a
time machine-wide (MAX_LOCK): Max hands a newly launched patch to an already-running Max instance,
so concurrent launches end up sharing one process. NonRealTime renders are fast, so serial is cheap.

Rules (enforced by construction here; see AGENTS.md "Real Max Test Harness"):
  * Never launch Max yourself. Build the device-specific boxes and call `run_case()`. Runners may
    call run_case from several threads/processes; the lock queues them.
  * Never time anything with `delay` / `metro` / wall-clock ms. In NonRealTime the scheduler
    does not follow audio time (measured: a 1000 ms `delay` window held 144000-244000 samples).
    The scaffold records from DSP start, counts samples in gen, trims the settle period and
    then sends `analyze <dur_ms>` to the probe. Mid-run parameter changes go through
    `events=[...]` and need `mode="stepped"` to land on time.
  * `mode="audio_device"` (real CoreAudio, serialized by one machine-wide lock) is only for the
    few tests that depend on the hardware driver itself (device sample-rate switching, driver
    I/O). It is not the default and should stay rare.

Device harness contract (ids the scaffold provides; connect to them):
  obj-load    loadbang. Fires before DSP starts: send parameter / buffer-bind messages from it.
  obj-record  `record~ rec <channels>`: connect the signals to analyze to its inlets 0..channels-1.
  obj-mute-l / obj-mute-r   `*~ 0` into `dac~` (optional sinks, keep signal chains pulled).
  obj-js      `js <probe> ...` (pass `probe_js=`). Receives `resultpath <file>` at load and
              `analyze <dur_ms>` once `rec` holds exactly dur_ms of audio. It must write its
              `key value` lines to the result path, then bang its outlet (the scaffold quits).
  Buffer `rec` holds only the measured window, its `sr` is the real DSP rate, so existing
  probes that compute `frames / length` keep working.

Modes:
  "nrt"           NonRealTime, scheduler outside audio (fastest, about 150x real time). Default.
  "stepped"       NonRealTime with `takeover 1`: scheduler serviced between DSP vectors, so
                  `events` land within one vector of their sample time. Slower than real time.
  "audio_device"  Core Audio driver, real time, holds AUDIO_DEVICE_LOCK for the whole run.
"""

import contextlib
import fcntl
import json
import os
import shutil
import subprocess
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_APP = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app"
MAX_BIN = os.path.join(MAX_APP, "Contents", "MacOS", "Max")
# Skip macOS's "reopen windows after a crash?" alert: once Max has crashed or been killed a few
# times that alert aborts every new launch (NSPersistentUIRestorer ... SIGABRT, no result).
MAX_LAUNCH_ARGS = ["-ApplePersistenceIgnoreState", "YES"]
PID_REGISTRY = "/tmp/m4l_max_harness_pids"
MAX_SUPPORT = os.path.expanduser("~/Library/Application Support/Cycling '74/Max 9")
CRASH_RECOVERY_DIR = os.path.join(MAX_SUPPORT, "Crash Recovery")
AUDIO_PREFS = os.path.join(MAX_SUPPORT, "Settings", "audioprefs.txt")
MAX_PREFS = os.path.join(MAX_SUPPORT, "Settings", "maxpreferences.maxpref")
MAX_PREFS_SAVED = "/tmp/m4l_maxprefs_maxatstartup.json"  # the user's own value while harnesses run
TRIM_JS = os.path.join(ROOT, "tests", "max_harness_trim.js")

# Machine-wide lock held for the whole life of every harness Max (all modes). Same file as
# scripts/max_lock.py, so unmigrated runners are serialized with us too.
MAX_LOCK = "/tmp/m4l_real_max.lock"
AUDIO_DEVICE_LOCK = MAX_LOCK

DEFAULT_SR = 48000
MODES = ("nrt", "stepped", "audio_device")


# ---------------------------------------------------------------------------
# Patcher JSON helpers (shared by every runner)
# ---------------------------------------------------------------------------
def box(obj_id, text, x, y, w=120, h=20, **extra):
    b = {
        "id": obj_id,
        "maxclass": extra.pop("maxclass", "newobj"),
        "numinlets": extra.pop("numinlets", 1),
        "numoutlets": extra.pop("numoutlets", 1),
        "outlettype": extra.pop("outlettype", [""]),
        "patching_rect": [float(x), float(y), float(w), float(h)],
        "text": text,
    }
    b.update(extra)
    return {"box": b}


def msg(obj_id, text, x, y, w=160, h=20):
    return box(obj_id, text, x, y, w, h, maxclass="message", numinlets=2, numoutlets=1)


def gen_box(obj_id, gen_code, x, y, numinlets=2, numoutlets=2):
    return {
        "box": {
            "code": gen_code,
            "fontname": "<Monospaced>",
            "fontsize": 10.0,
            "id": obj_id,
            "maxclass": "gen.codebox~",
            "numinlets": numinlets,
            "numoutlets": numoutlets,
            "outlettype": ["signal"] * numoutlets,
            "patching_rect": [float(x), float(y), 220.0, 60.0],
        }
    }


def line(src, outlet, dst, inlet):
    return {"patchline": {"source": [src, outlet], "destination": [dst, inlet]}}


# ---------------------------------------------------------------------------
# Locks and shared Max state
# ---------------------------------------------------------------------------
@contextlib.contextmanager
def file_lock(path):
    with open(path, "w") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def _max_pids():
    try:
        out = subprocess.check_output(["pgrep", "-f", "Max\\.app/Contents/MacOS/Max"], text=True)
    except subprocess.CalledProcessError:
        return set()
    return {int(p) for p in out.split() if p.strip()}


def _other_harness_max_running(own_pid=None):
    """Harness Max processes: ones registered by this module, plus legacy runners that launch the
    binary directly with a .maxpat argument. Max hosted by Live is never counted."""
    os.makedirs(PID_REGISTRY, exist_ok=True)
    for name in os.listdir(PID_REGISTRY):
        pid = int(name) if name.isdigit() else -1
        if pid == own_pid:
            continue
        if pid > 0 and _pid_alive(pid):
            return True
        try:
            os.remove(os.path.join(PID_REGISTRY, name))
        except OSError:
            pass
    try:
        out = subprocess.check_output(["pgrep", "-f", "[M]acOS/Max .*\\.maxpat"], text=True)
    except subprocess.CalledProcessError:
        return False
    return any(int(p) != own_pid for p in out.split() if p.strip())


def _harness_max_pids():
    """Standalone harness Max processes (a .maxpat in argv). Max hosted by Live never matches."""
    try:
        out = subprocess.check_output(["pgrep", "-f", "[M]acOS/Max .*\\.maxpat"], text=True)
    except subprocess.CalledProcessError:
        return set()
    return {int(p) for p in out.split() if p.strip()}


def _kill_stale_harness_max(grace=3.0):
    """Called while holding MAX_LOCK, so any harness Max still alive belongs to a finished or dead
    run (or an unmigrated runner that skipped the lock). SIGTERM, then SIGKILL, until none remain."""
    pids = _harness_max_pids()
    for p in pids:
        try:
            os.kill(p, 15)
        except OSError:
            pass
    t = time.time() + grace
    while time.time() < t and _harness_max_pids():
        time.sleep(0.1)
    for p in _harness_max_pids():
        try:
            os.kill(p, 9)
        except OSError:
            pass
    t = time.time() + grace
    while time.time() < t and _harness_max_pids():
        time.sleep(0.1)


def _reap_orphans():
    """SIGTERM harness Max instances whose owning runner process has died (killed runner, crashed
    Python): nobody else would ever end them, and each NonRealTime render keeps a core busy."""
    os.makedirs(PID_REGISTRY, exist_ok=True)
    for name in os.listdir(PID_REGISTRY):
        if not name.isdigit():
            continue
        pid, path = int(name), os.path.join(PID_REGISTRY, name)
        try:
            owner = int(open(path).read().strip() or 0)
        except (OSError, ValueError):
            owner = 0
        if _pid_alive(pid) and owner and not _pid_alive(owner):
            try:
                os.kill(pid, 15)
            except OSError:
                pass
        if not _pid_alive(pid) or (owner and not _pid_alive(owner)):
            try:
                os.remove(path)
            except OSError:
                pass


def _launch_max(patch_path):
    """Call under MAX_LOCK. Returns the new Max pid (registered in PID_REGISTRY).

    Exec the binary directly with the patch in argv. Measured on this machine:
      * `open -n ... ` (LaunchServices) makes the already-running Max instance quit, so parallel
        harnesses killed each other (and the killed one aborted in its quit path: crash report);
      * a direct exec from a background process keeps every instance alive and does not take
        focus (macOS cooperative activation: the frontmost app stayed frontmost).
    The unique temp patch path finds the pid even if Max re-parents itself."""
    subprocess.Popen([MAX_BIN, patch_path, *MAX_LAUNCH_ARGS], stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, start_new_session=True)
    deadline = time.time() + 15.0
    while time.time() < deadline:
        try:
            out = subprocess.check_output(["pgrep", "-f", patch_path], text=True)
            pid = int(out.split()[0])
            os.makedirs(PID_REGISTRY, exist_ok=True)
            with open(os.path.join(PID_REGISTRY, str(pid)), "w") as f:
                f.write(str(os.getpid()))  # owner: the runner that will SIGTERM it
            return pid
        except (subprocess.CalledProcessError, IndexError, ValueError):
            time.sleep(0.1)
    raise RuntimeError("Max did not start")


def _patch_pids(patch_path):
    try:
        out = subprocess.check_output(["pgrep", "-f", patch_path], text=True)
    except subprocess.CalledProcessError:
        return set()
    return {int(p) for p in out.split() if p.strip()}


def _wait_or_kill(pid, deadline, done_path=None, patch_path=None, result_path=None):
    """Wait for the done marker (or the deadline, or Max being gone for 3 s), then SIGTERM.

    Track Max by its unique patch path, not by the launch pid: Max re-execs itself at startup, so the
    first pid exits within a second while the real instance (re-parented to launchd) keeps rendering.
    A signal from another process is not a crash, so macOS writes no report and shows no dialog."""
    gone_since = None
    last_size, stable_since = -1, None
    while time.time() < deadline:
        if done_path and os.path.exists(done_path):
            time.sleep(0.2)
            break
        # Fallback for probes that write their report but never bang their outlet (so the done
        # marker never comes): a non-empty result that has not grown for 1 s means the case is done.
        if result_path and os.path.exists(result_path):
            size = os.path.getsize(result_path)
            if size > 0 and size == last_size:
                stable_since = stable_since or time.time()
                if time.time() - stable_since > 1.0:
                    break
            else:
                last_size, stable_since = size, None
        alive = _patch_pids(patch_path) if patch_path else ({pid} if _pid_alive(pid) else set())
        if alive:
            gone_since = None
        else:
            gone_since = gone_since or time.time()
            if time.time() - gone_since > 3.0:
                break
        time.sleep(0.1)
    victims = (_patch_pids(patch_path) if patch_path else set()) | ({pid} if _pid_alive(pid) else set())
    for v in victims:
        try:
            os.kill(v, 15)
        except OSError:
            pass
    t = time.time() + 3.0
    while time.time() < t and any(_pid_alive(v) for v in victims):
        time.sleep(0.1)
    for v in victims:
        if _pid_alive(v):
            try:
                os.kill(v, 9)
            except OSError:
                pass
    for v in victims | {pid}:
        try:
            os.remove(os.path.join(PID_REGISTRY, str(v)))
        except OSError:
            pass


def _clear_crash_recovery():
    """Only called under MAX_LOCK and only when no other harness Max is running, so a
    parallel run never loses its recovery state mid-flight."""
    if _other_harness_max_running() or not os.path.isdir(CRASH_RECOVERY_DIR):
        return
    for entry in os.listdir(CRASH_RECOVERY_DIR):
        full = os.path.join(CRASH_RECOVERY_DIR, entry)
        try:
            shutil.rmtree(full) if os.path.isdir(full) else os.remove(full)
        except OSError:
            pass


def _set_maxatstartup(value):
    try:
        with open(MAX_PREFS, "r", encoding="utf-8") as f:
            prefs = json.load(f)
        node = prefs.get("preferences", prefs)
        old = node.get("maxatstartup")
        if old != value:
            node["maxatstartup"] = value
            with open(MAX_PREFS, "w", encoding="utf-8") as f:
                json.dump(prefs, f, indent=4)
        return old
    except (OSError, ValueError, AttributeError):
        return None


def _hide_console_for_harness():
    """Max opens its Console window at startup ("maxatstartup": 1), which is the only window a
    harness Max still shows (the patch hides itself). Turn it off while harnesses run; the first
    harness saves the user's value, and _restore_user_prefs() puts it back after the last exits."""
    old = _set_maxatstartup(0)
    if old is not None and not os.path.exists(MAX_PREFS_SAVED):
        with open(MAX_PREFS_SAVED, "w") as f:
            json.dump({"maxatstartup": old}, f)


def _restore_audio_prefs():
    """`; dsp setdriver` persists into Max's audioprefs.txt. Put Core Audio back once the last
    harness Max has exited, so a manually launched Max does not open silently on NonRealTime."""
    if _other_harness_max_running():
        return
    try:
        with open(AUDIO_PREFS, "w", encoding="utf-8") as f:
            f.write('max v2;dsp prefdrivername "Core Audio";dsp prefsubname ;\n')
    except OSError:
        pass
    if os.path.exists(MAX_PREFS_SAVED):
        try:
            with open(MAX_PREFS_SAVED) as f:
                _set_maxatstartup(json.load(f).get("maxatstartup", 1))
            os.remove(MAX_PREFS_SAVED)
        except (OSError, ValueError):
            pass


# ---------------------------------------------------------------------------
# Scaffold
# ---------------------------------------------------------------------------
def samples_for_ms(ms, sr=DEFAULT_SR):
    return int(round(float(ms) * sr / 1000.0))


def _counter_gen(name, thresholds):
    """gen~ sample counter: outlet k goes 0 -> 1 once `thresholds[k]` samples have been processed."""
    lines = [f"History n(0);", "n = n + 1;"]
    for k, t in enumerate(thresholds):
        lines.append(f"out{k + 1} = n >= {int(t)};")
    return "\n".join(lines) + "\n"


def build_scaffold(device_boxes, device_lines, *, probe_js, probe_args="", settle_ms=300,
                   dur_ms=500, channels=2, sr=DEFAULT_SR, mode="nrt", events=None, probe_object="js"):
    """Wrap device-specific boxes/lines in the shared NonRealTime recording scaffold.

    events: list of (at_ms, target_id, inlet, message_text), at_ms counted from DSP start.
    probe_object: "js" (classic, ES5) or "v8" (Max 9 V8 engine, ES6+) for the probe box.
    Returns (patcher_dict, settle_samps, dur_samps)."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    events = events or []
    settle = samples_for_ms(settle_ms, sr)
    dur = samples_for_ms(dur_ms, sr)
    total = settle + dur

    if mode == "audio_device":
        driver = '; dsp setdriver "Core Audio"; dsp takeover 0'
    else:
        driver = f"; dsp setdriver NonRealTime; dsp takeover {1 if mode == 'stepped' else 0}"
    cfg = f"{driver}; dsp sr {sr}; dsp sigvs 64; dsp iovs 64"

    boxes = [
        box("obj-load", "loadbang", 40, 20, 60, outlettype=["bang"]),
        box("hx-tb", "t b b b", 40, 50, 60, numoutlets=3, outlettype=["bang", "bang", "bang"]),
        msg("hx-cfg", cfg, 40, 80, 420),
        msg("hx-resultpath", "resultpath $1", 480, 80, 120),
        box("hx-wait", "delay 250", 40, 110, 70, numinlets=2, outlettype=["bang"]),
        box("hx-arm-t", "t b b", 40, 140, 50, numoutlets=2, outlettype=["bang", "bang"]),
        msg("hx-arm", "1", 40, 170, 30),
        msg("hx-start", "; dsp start", 100, 170, 80),
        box("hx-fullbuf", f"buffer~ rec_full 1 {channels} @samps {total}", 600, 20, 260,
            numoutlets=2, outlettype=["float", "bang"]),
        box("hx-recbuf", f"buffer~ rec 1 {channels} @samps {dur}", 600, 50, 220,
            numoutlets=2, outlettype=["float", "bang"]),
        box("obj-record", f"record~ rec_full {channels}", 260, 420, 120,
            numinlets=channels + 2, outlettype=["signal"]),
        box("obj-mute-l", "*~ 0", 260, 460, 45, numinlets=2, outlettype=["signal"]),
        box("obj-mute-r", "*~ 0", 320, 460, 45, numinlets=2, outlettype=["signal"]),
        box("obj-dac", "dac~", 260, 500, 50, numinlets=2, numoutlets=0, outlettype=[]),
        gen_box("hx-clock", _counter_gen("clock", [total] + [samples_for_ms(e[0], sr) for e in events]),
                600, 120, numinlets=1, numoutlets=1 + len(events)),
        box("hx-dspstate", "dspstate~", 880, 120, 80, numinlets=1, numoutlets=4,
            outlettype=["int", "float", "int", "int"]),
        box("hx-edge-done", "edge~", 600, 200, 50, numinlets=1, numoutlets=2, outlettype=["bang", "bang"]),
        msg("hx-trim", f"trim {settle} {dur} {channels}", 600, 230, 160),
        box("hx-trim-js", f"js {TRIM_JS}", 600, 260, 160),
        box("hx-srprep", "prepend sr", 880, 160, 80),
        msg("hx-analyze", f"analyze {int(dur_ms)}", 600, 290, 120),
        box("obj-js", f"{probe_object} {probe_js} {probe_args}".strip(), 420, 420, 260),
        box("hx-done-t", "t b b", 420, 460, 50, numoutlets=2, outlettype=["bang", "bang"]),
        msg("hx-stop", "; dsp stop", 480, 490, 80),
        # Never `; max quit`: on this macOS / Max build it aborts in maxapplication_quit
        # (+[NSEvent startPeriodicEventsAfterDelay:...] throws), leaving a crash report and a
        # "Max quit unexpectedly" dialog. The trim js writes a done marker; Python sends SIGTERM.
        msg("hx-done", "done", 420, 520, 60),
    ]
    lines = [
        line("obj-load", 0, "hx-tb", 0),
        line("hx-tb", 2, "hx-cfg", 0),
        line("hx-tb", 1, "hx-resultpath", 0),
        line("hx-resultpath", 0, "obj-js", 0),
        line("hx-tb", 0, "hx-wait", 0),
        line("hx-wait", 0, "hx-arm-t", 0),
        line("hx-arm-t", 1, "hx-arm", 0),
        line("hx-arm", 0, "obj-record", 0),
        line("hx-arm-t", 0, "hx-start", 0),
        line("obj-mute-l", 0, "obj-dac", 0),
        line("obj-mute-r", 0, "obj-dac", 1),
        line("hx-clock", 0, "hx-edge-done", 0),
        line("hx-edge-done", 0, "hx-trim", 0),
        line("hx-trim", 0, "hx-trim-js", 0),
        line("hx-dspstate", 1, "hx-srprep", 0),
        line("hx-srprep", 0, "hx-trim-js", 0),
        line("hx-trim-js", 0, "hx-analyze", 0),
        line("hx-analyze", 0, "obj-js", 0),
        line("obj-js", 0, "hx-done-t", 0),
        line("hx-done-t", 1, "hx-stop", 0),
        line("hx-done-t", 0, "hx-done", 0),
        line("hx-done", 0, "hx-trim-js", 0),
    ]
    for k, (at_ms, target, inlet, text) in enumerate(events):
        eid = f"hx-ev{k}"
        boxes.append(box(f"{eid}-edge", "edge~", 700 + 70 * k, 320, 50, numinlets=1, numoutlets=2,
                         outlettype=["bang", "bang"]))
        boxes.append(msg(f"{eid}-msg", text, 700 + 70 * k, 350, 200))
        lines += [line("hx-clock", k + 1, f"{eid}-edge", 0), line(f"{eid}-edge", 0, f"{eid}-msg", 0),
                  line(f"{eid}-msg", 0, target, inlet)]

    ids = {b["box"]["id"] for b in boxes}
    clash = ids & {b["box"]["id"] for b in device_boxes}
    if clash:
        raise ValueError(f"device boxes reuse scaffold ids: {sorted(clash)}")
    patcher = {
        "patcher": {
            "fileversion": 1,
            "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
            "classnamespace": "box",
            "rect": [100.0, 100.0, 1200.0, 640.0],
            "boxes": boxes + list(device_boxes),
            "lines": lines + list(device_lines),
        }
    }
    return patcher, settle, dur


def _parse_kv(path):
    data = {}
    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            parts = raw.strip().split()
            if len(parts) == 2:
                try:
                    data[parts[0]] = float(parts[1])
                except ValueError:
                    data[parts[0]] = parts[1]
    return data


def run_case(name, device_boxes, device_lines, *, probe_js, probe_args="", settle_ms=300, dur_ms=500,
             channels=2, sr=DEFAULT_SR, mode="nrt", events=None, timeout=300.0, keep_dir=False,
             probe_object="js"):
    """Render one case and return the probe's `key value` results as a dict (floats where possible).

    Adds `harness_sr`, `harness_mode`, `harness_wall_s`, and `harness_dir` (the per-run work dir, kept
    only with keep_dir=True so the caller can read extra probe files written next to the result path;
    the caller removes it). Raises RuntimeError on timeout / no result.
    A unique temp dir holds the patch and result, so parallel runs (even of the same device)
    never collide."""
    if not os.path.exists(MAX_BIN):
        raise FileNotFoundError(MAX_BIN)
    work = tempfile.mkdtemp(prefix=f"m4l_{name}_")
    result = os.path.join(work, "result.txt")
    harness_info = os.path.join(work, "harness.txt")
    patch, _, _ = build_scaffold(device_boxes, device_lines, probe_js=probe_js, probe_args=probe_args,
                                 settle_ms=settle_ms, dur_ms=dur_ms, channels=channels, sr=sr,
                                 mode=mode, events=events, probe_object=probe_object)
    # Hand the per-run paths to the probe and the trim script through loadbang-time messages
    for b in patch["patcher"]["boxes"]:
        if b["box"]["id"] == "hx-resultpath":
            b["box"]["text"] = f"resultpath {result}"
        if b["box"]["id"] == "hx-trim-js":
            b["box"]["text"] = f"js {TRIM_JS} {harness_info}"
    patch_path = os.path.join(work, f"{name}.maxpat")
    with open(patch_path, "w", encoding="utf-8") as f:
        json.dump(patch, f, indent=1)

    # One harness Max at a time, machine-wide (same lock file as scripts/max_lock.py, so legacy
    # runners are serialized with us). Max hands a newly launched patch to an already-running
    # Max instance, so two concurrent harness launches end up in ONE process (shared `rec`
    # buffers, shared DSP, one SIGTERM kills both). Measured 2026-10-20.
    with file_lock(MAX_LOCK):
        _kill_stale_harness_max()
        _clear_crash_recovery()
        t0 = time.time()
        pid = _launch_max(patch_path)
        try:
            _wait_or_kill(pid, t0 + timeout, harness_info + ".done", patch_path, result)
        finally:
            _kill_stale_harness_max()  # the next run must not be handed to this instance
            _restore_audio_prefs()

    if not os.path.exists(result) or os.path.getsize(result) == 0:
        raise RuntimeError(f"Case {name}: Max produced no result (patch kept at {patch_path})")
    data = _parse_kv(result)
    if os.path.exists(harness_info):
        for k, v in _parse_kv(harness_info).items():
            data[f"harness_{k}"] = v
    settle_want, dur_want = samples_for_ms(settle_ms, sr), samples_for_ms(dur_ms, sr)
    if data.get("harness_settle") != settle_want or data.get("harness_dur") != dur_want:
        raise RuntimeError(f"Case {name}: result does not belong to this run (harness.txt settle/dur "
                           f"{data.get('harness_settle')}/{data.get('harness_dur')}, want {settle_want}/{dur_want}; "
                           f"patch kept at {patch_path})")
    data["harness_mode"] = mode
    data["harness_wall_s"] = time.time() - t0
    data["harness_dir"] = work if keep_dir else ""
    if not keep_dir:
        shutil.rmtree(work, ignore_errors=True)
    return data

