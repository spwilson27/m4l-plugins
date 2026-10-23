#!/usr/bin/env python3
"""Find screen points where a REAL click selects a parameter of a given Live device (tart VM macos-1, AGENTS.md 1a).

The VM cannot take screenshots, and the layout of a stock device (Utility, Delay, ...) in Live's device view is not ours, so the points are found
by trial: click on a grid over the device view, read `live_set view selected_parameter` through the MCP bridge (127.0.0.1, run in the VM),
and keep the points whose selection is a parameter whose LOM path starts with PREFIX (distinct parameters only).

  python3 scripts/mm_scan_select.py PREFIX [COUNT] [X0 X1 Y0 Y1 STEP]   prints a JSON list [{"x","y","id","path","name"}, ...]

The window (`mm_os_input.window("Live")`) gives the default region: the Detail view's device strip (x from 240 pt right of the window's left edge, the lower
~210 pt of the window; measured: Mega Modulator's v8ui sits at screen (255, 506) in the 1024 x 680 Live window).
Clicks on a stock dial only select it; a toggle under the pointer toggles once (the scan is meant for scratch devices).
A menu parameter (more than two items) opens a popup when clicked: it is closed with Escape.
Env: MM_SCAN_NAMES="Balance,Stereo Width" keeps only hits with one of those parameter names (skips toggles such as Device On); MM_SCAN_SETTLE (s, default 0.1).
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import mm_os_input as io  # noqa: E402


def bridge_port():
    for p in range(9877, 9885):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{p}/health", timeout=1) as r:
                if b'"ok":true' in r.read():
                    return p
        except Exception:
            pass
    raise RuntimeError("no MCP bridge answers in the VM")


def selected(port):
    code = ('var v = new LiveAPI("live_set view"); var s = v.get("selected_parameter"); var id = Number(Array.isArray(s) ? s[s.length - 1] : s) || 0;'
            ' if (!id) return {id: 0}; var p = new LiveAPI("id " + id); return {id: id, path: String(p.unquotedpath || p.path).replace(/"/g, ""), name: String(p.get("name")), items: (p.get("value_items") || []).length};')
    req = urllib.request.Request(f"http://127.0.0.1:{port}/rpc", data=json.dumps({"action": "eval_js", "params": {"code": code}}).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        out = json.loads(r.read())
    res = out.get("result", out)
    if isinstance(res, dict) and "result" in res and "id" not in res:
        res = res["result"]
    return res


def main(argv):
    prefix = argv[1]
    count = int(argv[2]) if len(argv) > 2 else 2
    w = io.window("Live")
    x0, x1, y0, y1, step = (int(float(v)) for v in argv[3:8]) if len(argv) >= 8 else (w["x"] + 240, w["x"] + w["w"] - 8, w["y"] + w["h"] - 215, w["y"] + w["h"] - 6, 16)
    port = bridge_port()
    names = [n for n in os.environ.get("MM_SCAN_NAMES", "").split(",") if n]
    settle = float(os.environ.get("MM_SCAN_SETTLE", "0.1"))
    hits, seen = [], set()
    for y in range(y0, y1, step):
        for x in range(x0, x1, step):
            io.click(x, y)
            time.sleep(settle)
            s = selected(port)
            if s and s.get("items", 0) > 2:
                io.press("escape", 0.2)  # a click on a stock menu parameter (Channel Mode, ...) opens its popup: close it
            if s and s.get("id") and s.get("path", "").startswith(prefix) and (" parameters " in s["path"]) and s["id"] not in seen and (not names or s.get("name") in names):
                seen.add(s["id"])
                hits.append({"x": x, "y": y, "id": s["id"], "path": s["path"], "name": s.get("name", "")})
                if len(hits) >= count:
                    print(json.dumps(hits))
                    return 0
    print(json.dumps(hits))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
