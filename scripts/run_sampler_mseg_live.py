#!/usr/bin/env python3
"""Hold a note on Better Sampler Reactive 2 and check the MSEG playhead moves (tart VM).

The gen publishes one slot's phases and that slot's output level. This opens the MSEG tab,
plays a looping note, and requires the playhead and the published level to advance.
A flag file tells the host when to photograph the device.
"""
import json
import os
import sys
import time
import urllib.request

FLAG = "/tmp/bs_mseg_ready"


def fail(msg):
    print("FAIL", msg)
    sys.exit(1)


def rpc(code, timeout=30):
    body = json.dumps({"action": "eval_js", "params": {"code": code}}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:9877/rpc", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        out = json.loads(res.read().decode())
    if not out.get("ok"):
        fail("bridge: %s" % out)
    return out.get("result", {}).get("result")


def mess(msg):
    return rpc(
        'messnamed("#0-bsdebug", %s); return 1;' % msg
    )


def report():
    mess('"dbg_r2_mseg"')
    time.sleep(0.05)
    return str(rpc('var g = new Global("bs_r2_mseg"); return String(g.text || "");') or "")


def parse(line):
    out = {"lvl": None, "phases": []}
    for part in str(line).split():
        if part.startswith("lvl="):
            try:
                out["lvl"] = float(part.split("=", 1)[1])
            except ValueError:
                pass
        elif part.startswith("dots="):
            body = part.split("=", 1)[1]
            for item in body.split(","):
                if ":" not in item or not item:
                    continue
                try:
                    out["phases"].append(float(item.split(":", 1)[1]))
                except ValueError:
                    pass
    return out


def prepare():
    return rpc(
        'function one(v){ if (v && typeof v !== "string" && v.length) v = v[v.length - 1];'
        ' return String(v == null ? "" : v).replace(/^"|"$/g, ""); }'
        'var view = new LiveAPI("live_set view");'
        'var app = new LiveAPI("live_app view");'
        'app.call("show_view", "Detail"); app.call("show_view", "Detail/DeviceChain");'
        'var song = new LiveAPI("live_set"); var tracks = song.getcount("tracks");'
        'var hits = [], t, i, n;'
        'for (t = 0; t < tracks; t++) {'
        '  var tr = new LiveAPI("live_set tracks " + t); n = tr.getcount("devices");'
        '  for (i = 0; i < n; i++) {'
        '    var d0 = new LiveAPI("live_set tracks " + t + " devices " + i);'
        '    if (one(d0.get("name")).indexOf("Reactive 2") >= 0) hits.push(t);'
        '  }'
        '}'
        'var k; for (k = hits.length - 2; k >= 0; k--) song.call("delete_track", hits[k]);'
        'tracks = song.getcount("tracks"); var path = "", idx = -1, tid = 0;'
        'for (t = tracks - 1; t >= 0 && !path; t--) {'
        '  var tr2 = new LiveAPI("live_set tracks " + t); n = tr2.getcount("devices");'
        '  for (i = 0; i < n; i++) {'
        '    var d = new LiveAPI("live_set tracks " + t + " devices " + i);'
        '    if (one(d.get("name")).indexOf("Reactive 2") >= 0) {'
        '      path = String(d.unquotedpath || ""); idx = t; tid = Number(tr2.id); break; }'
        '  }'
        '}'
        'if (path) view.set("selected_track", "id " + tid);'
        'return {path: path, track: idx};'
    )


def play(track):
    notes = json.dumps({"notes": [{"pitch": 60, "start_time": 0, "duration": 3.5, "velocity": 100, "mute": 0}]})
    return rpc(
        'var song = new LiveAPI("live_set");'
        'song.set("tempo", 120);'
        'song.set("clip_trigger_quantization", 0);'
        'var slot = new LiveAPI("live_set tracks %d clip_slots 0");'
        'if (Number(slot.get("has_clip"))) slot.call("delete_clip");'
        'slot.call("create_clip", 4);'
        'var clip = new LiveAPI("live_set tracks %d clip_slots 0 clip");'
        'clip.set("looping", 1);'
        'clip.call("add_new_notes", %s);'
        'slot.call("fire");'
        'return 1;' % (track, track, json.dumps(notes))
    )


def stop(track):
    try:
        rpc(
            'new LiveAPI("live_set tracks %d").call("stop_all_clips");'
            'new LiveAPI("live_set").call("stop_playing"); return 1;' % track
        )
    except Exception as exc:
        print("stop failed", exc)


def main():
    try:
        os.remove(FLAG)
    except OSError:
        pass
    dev = prepare()
    print("device", dev)
    if not dev or not dev.get("path") or dev.get("track", -1) < 0:
        fail("no Reactive 2")
    track = int(dev["track"])
    time.sleep(2.5)
    # Mod Sources + Filter + Mod Matrix. Page 4 is the default MSEG slot.
    mess('"dbg_r2_view", 0, 4, 0, 0, 14')
    time.sleep(0.4)
    play(track)
    time.sleep(0.45)
    first = parse(report())
    print("t0", first)
    open(FLAG, "w").write("ready\n")
    time.sleep(0.55)
    second = parse(report())
    print("t1", second)
    # Leave the note sounding briefly so the host screenshot catches the playhead off the start.
    time.sleep(1.2)
    phases0 = first["phases"]
    phases1 = second["phases"]
    if not phases0 or not phases1:
        fail("no playhead (t0=%s t1=%s)" % (first, second))
    p0, p1 = max(phases0), max(phases1)
    moved = abs(p1 - p0) % 1.0
    if moved > 0.5:
        moved = 1.0 - moved
    # Default curve is a triangle: 0 at the ends, 1 at the middle.
    def tri(p):
        p = p % 1.0
        return (p / 0.5) if p <= 0.5 else ((1.0 - p) / 0.5)
    lvl = second["lvl"] if second["lvl"] is not None else -1
    print("moved", round(moved, 3), "lvl", lvl, "curve", round(tri(p1), 3))
    if moved < 0.15:
        fail("playhead did not travel (delta %s)" % moved)
    if abs(lvl - tri(p1)) > 0.2:
        fail("modulator level %s is not the curve at %s" % (lvl, p1))
    print("mseg live ok")
    stop(track)


if __name__ == "__main__":
    main()
