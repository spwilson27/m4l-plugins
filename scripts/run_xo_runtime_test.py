#!/usr/bin/env python3
"""XO Sample Map: Max runtime test (node.codebox boots in Presentation Mode, 's' hotkey saves, the four
v8ui drag-out zones reach the node engine and arm the native Cocoa drag helper).

Runs in the tart VM only (AGENTS.md 1a). `node tests/test_xo_map.js` with XO_RUN_MAX_RUNTIME=1 writes the
patch to tests/out/xo_runtime/ (the VM has no `node`); this runner launches it through the shared harness
machinery in scripts/max_harness.py (machine-wide /tmp/m4l_real_max.lock, direct exec, stale-Max cleanup,
SIGTERM, crash-recovery clearing) and checks the two result files the patch writes.

Deviation from AGENTS.md 1b: this is a UI / node test, not an audio render, so it uses a plain Max launch
with the scheduler (`delay`) driving the clicks instead of the NonRealTime scaffold (`run_case`).

  python3 scripts/run_xo_runtime_test.py [patch.maxpat]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh  # noqa: E402

PATCH_SRC = os.path.join(mh.ROOT, "tests", "out", "xo_runtime", "xo_m4l_runtime_harness.maxpat")
TMP = tempfile.gettempdir()  # the Max node process inherits TMPDIR, so os.tmpdir() there is the same
RESULT = os.path.join(TMP, "xo_m4l_runtime_test_result.json")
HELPER_STATE = os.path.join(TMP, "xo_sample_map_exports", "last_drag_helper_state.json")


def run_once(patch_path, timeout=25.0):
    for f in (RESULT, HELPER_STATE):
        if os.path.exists(f):
            os.remove(f)
    t0 = time.time()
    pid = mh._launch_max(patch_path)
    try:
        while time.time() - t0 < timeout:
            if os.path.exists(RESULT) and os.path.exists(HELPER_STATE):
                time.sleep(0.5)
                break
            time.sleep(0.2)
    finally:
        mh._wait_or_kill(pid, time.time(), None, patch_path, None)
        mh._kill_stale_harness_max()
    return os.path.exists(RESULT) and os.path.exists(HELPER_STATE)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else PATCH_SRC
    if not os.path.exists(src):
        sys.exit("missing %s (node tests/test_xo_map.js with XO_RUN_MAX_RUNTIME=1 writes it)" % src)
    work = tempfile.mkdtemp(prefix="m4l_xo_runtime_")
    patch = os.path.join(work, "xo_m4l_runtime_harness.maxpat")
    shutil.copy(src, patch)
    env_note = "XO_CACHE_DIR=%s" % TMP
    os.environ["XO_CACHE_DIR"] = TMP
    ok = False
    with mh.file_lock(mh.MAX_LOCK):
        mh._kill_stale_harness_max()
        for attempt in range(3):
            mh._clear_crash_recovery()
            if run_once(patch):
                ok = True
                break
            time.sleep(0.4)
        subprocess.call(["pkill", "-f", "xo_drag_helper"])
    shutil.rmtree(work, ignore_errors=True)
    fails = []
    if not ok:
        fails.append("obj-node (node.codebox) produced no result in 3 launches (%s)" % env_note)
    else:
        res = json.load(open(RESULT))
        helper = json.load(open(HELPER_STATE))
        print("result:", json.dumps(res)[:400])
        print("helper:", json.dumps(helper)[:300])
        if res.get("error"):
            fails.append("runtime error: %s" % res["error"])
        if res.get("bootedInPresentation") is not True:
            fails.append("node did not boot in presentation mode")
        if (res.get("savedCountFromHotkey") or 0) < 1:
            fails.append("'s' hotkey did not save a sample: %r" % res.get("savedCountFromHotkey"))
        seen = res.get("dragModesSeen") or []
        if len(seen) != 4:
            fails.append("expected 4 drag-out zones, saw %d" % len(seen))
        for dm in seen:
            if not (dm.get("count", 0) >= 1 and dm.get("exists0")):
                fails.append("drag mode %s has no existing file: %s" % (dm.get("mode"), dm))
        if helper.get("visible") is not True:
            fails.append("native drag source window not visible")
        if (helper.get("count") or 0) < 1:
            fails.append("drag helper loaded no file URL onto the pasteboard")
    for f in fails:
        print("FAIL", f)
    print("all runtime checks passed" if not fails else "%d runtime check(s) FAILED" % len(fails))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
