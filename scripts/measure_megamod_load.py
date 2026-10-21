#!/usr/bin/env python3
"""Runs INSIDE the tart VM (AGENTS.md 1a): time from `open` of megamod_keys_test.als until the MCP bridge sees the Mega Modulator
device's parameters, and until its script reports ready (test_report -> lomReady).  The caller (scripts/vm_megamod_keys.sh
measure) has synced the device and holds the Live lock.

  python3 scripts/measure_megamod_load.py [--runs 3]
Prints one line per run and a median:  bridge-up / params-visible / ready (seconds since open)."""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SET = os.path.join(ROOT, "megamod_keys_test.als")
URL = "http://127.0.0.1:9877"  # replaced by the first port in 9877..9884 that answers (a stale Live tree can hold 9877)


def find_url():
    for p in range(9877, 9885):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/health" % p, timeout=1).read()
            return "http://127.0.0.1:%d" % p
        except Exception:
            pass
    return None


def rpc(action, params, timeout=5):
    req = urllib.request.Request(URL + "/rpc", json.dumps({"action": action, "params": params}).encode(), {"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read().decode())


def unwrap(r):
    """The bridge answers {"ok": true, "result": {"result": <value>}}."""
    v = r.get("result") if isinstance(r, dict) else None
    return v.get("result") if isinstance(v, dict) and "result" in v else v


CODE_PARAMS = """
var set = new LiveAPI("live_set");
for (var t = 0; t < set.getcount("tracks"); t++) {
  var tp = "live_set tracks " + t;
  var tr = new LiveAPI(tp);
  for (var i = 0; i < tr.getcount("devices"); i++) {
    var d = new LiveAPI(tp + " devices " + i);
    if (String(d.get("name")) === "Mega Modulator") return { id: String(d.id), n: d.getcount("parameters") };
  }
}
return null;
"""
CODE_READY = """
var g = new Global("megamod_test"); g.last = "";
messnamed("megamod-test", "test_report");
return g.last ? JSON.parse(String(g.last)).lomReady === true : false;
"""


def once():
    subprocess.call(["pkill", "-x", "Live"])
    for _ in range(80):
        if subprocess.call(["pgrep", "-x", "Live"], stdout=subprocess.DEVNULL) != 0:
            break
        time.sleep(0.5)
    else:
        subprocess.call(["pkill", "-9", "-x", "Live"])
        time.sleep(2)
    subprocess.call("rm -f $HOME/Library/Preferences/Ableton/Live\\ */CrashRecoveryInfo.cfg $HOME/Library/Preferences/Ableton/Live\\ */CrashDetection.cfg", shell=True)
    t0 = time.time()
    # not waited for: `open -a` blocks while an old Live process is stuck exiting (zombie); `-n` starts a new instance instead
    zombie = "(Live)" in subprocess.run(["ps", "-axo", "command"], capture_output=True, text=True).stdout.split("\n")
    subprocess.Popen(["open"] + (["-n"] if zombie else []) + ["-a", "Ableton Live 12 Suite", SET])
    up = vis = ready = n = None
    while time.time() - t0 < 240:
        try:
            if up is None:
                u = find_url()
                if u:
                    globals()["URL"] = u
                    up = time.time() - t0
            if vis is None:
                r = rpc("eval_js", {"code": CODE_PARAMS})
                res = unwrap(r)
                if isinstance(res, dict) and res.get("n", 0) >= 1:
                    vis = time.time() - t0
                    n = res["n"]
            if vis is not None and ready is None:
                r = rpc("eval_js", {"code": CODE_READY})
                if unwrap(r) is True:
                    ready = time.time() - t0
                    break
        except Exception:
            pass
        time.sleep(0.25)
    return up, vis, ready, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)
    a = ap.parse_args()
    rows = []
    for r in range(a.runs):
        up, vis, ready, n = once()
        rows.append((up, vis, ready))
        f = lambda v: "none" if v is None else "%.1f" % v
        print("run %d: bridge up %s s, device params visible %s s (%s params), script ready %s s" % (r + 1, f(up), f(vis), n, f(ready)))
        sys.stdout.flush()
    for k, label in enumerate(["bridge up", "params visible", "script ready"]):
        v = sorted(x[k] for x in rows if x[k] is not None)
        if v:
            print("median %s: %.1f s" % (label, v[len(v) // 2]))


if __name__ == "__main__":
    main()
