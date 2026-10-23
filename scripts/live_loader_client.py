#!/usr/bin/env python3
"""Client for the M4LTestLoader remote script (scripts/live_remote/M4LTestLoader). Runs IN the VM (AGENTS.md 1a).

  python3 scripts/live_loader_client.py ping
  python3 scripts/live_loader_client.py load <file.amxd|.adg> [track]   track: index, master, selected, new_audio, new_midi
  python3 scripts/live_loader_client.py exec '<python>'                  `song`, `app`, `browser`, `Live` in scope; set `result`
Prints the JSON reply; exit 1 when it is not ok or Live does not answer within --timeout (default 30 s).
"""
import json
import os
import sys
import time
import uuid

BASE = "/tmp/m4l_loader"


def call(req, timeout=30.0):
    os.makedirs(BASE + "/req", exist_ok=True)
    os.makedirs(BASE + "/res", exist_ok=True)
    rid = "%d_%s" % (time.time() * 1000, uuid.uuid4().hex[:8])
    tmp = "%s/req/.%s" % (BASE, rid)
    with open(tmp, "w") as f:
        json.dump(req, f)
    os.rename(tmp, "%s/req/%s.json" % (BASE, rid))
    res = "%s/res/%s.json" % (BASE, rid)
    end = time.time() + timeout
    while time.time() < end:
        if os.path.exists(res):
            with open(res) as f:
                out = json.load(f)
            os.remove(res)
            return out
        time.sleep(0.05)
    try:
        os.remove("%s/req/%s.json" % (BASE, rid))
    except OSError:
        pass
    return {"ok": False, "error": "no answer from M4LTestLoader within %.0f s (Live not running, or the control surface is not selected)" % timeout}


def main(argv):
    timeout = 30.0
    if "--timeout" in argv:
        i = argv.index("--timeout")
        timeout = float(argv[i + 1])
        del argv[i:i + 2]
    if not argv:
        print(__doc__)
        return 2
    op = argv[0]
    if op == "ping":
        req = {"op": "ping"}
    elif op == "load":
        tr = argv[2] if len(argv) > 2 else "selected"
        req = {"op": "load", "path": os.path.abspath(argv[1]), "track": int(tr) if tr.lstrip("-").isdigit() else tr}
    elif op == "exec":
        req = {"op": "exec", "code": argv[1]}
    else:
        print(__doc__)
        return 2
    t0 = time.time()
    out = call(req, timeout)
    out["ms"] = round((time.time() - t0) * 1000)
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
