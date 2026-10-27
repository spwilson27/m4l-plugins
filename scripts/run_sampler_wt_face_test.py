#!/usr/bin/env python3
"""Prove Better Sampler Reactive 2's parameter faces inside Live (tart VM, scripts/vm_sampler.sh wtface).

Play Position and Osc 2 Position set and read back through the LOM. A click on the wavetable
position slider selects that parameter (so the right-click menu is Live's parameter menu), and
a right-click opens a menu. Osc 2 uses the same slider after the face switches oscillators.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import mm_os_input as mo  # noqa: E402


def fail(msg):
    print("FAIL", msg)
    sys.exit(1)


def rpc(code):
    body = json.dumps({"action": "eval_js", "params": {"code": code}}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:9877/rpc", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        out = json.loads(res.read().decode())
    if not out.get("ok"):
        fail("bridge: %s" % out)
    return out.get("result", {}).get("result")


def num(v):
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip().strip('"'))
        except ValueError:
            return None
    if isinstance(v, list):
        for item in reversed(v):
            n = num(item)
            if n is not None:
                return n
    return None


def selected():
    return rpc(
        'function one(v){ if (v && typeof v !== "string" && v.length) v = v[v.length - 1];'
        ' return String(v == null ? "" : v).replace(/^"|"$/g, ""); }'
        'var v = new LiveAPI("live_set view"); var s = v.get("selected_parameter");'
        'var id = Number(one(s)) || 0; if (!id) return {id: 0};'
        'var p = new LiveAPI("id " + id);'
        'return {id: id, name: one(p.get("name")), path: String(p.unquotedpath || p.path)};'
    )


DEVICE = {"path": ""}


def prepare():
    info = rpc(
        'function one(v){ if (v && typeof v !== "string" && v.length) v = v[v.length - 1];'
        ' return String(v == null ? "" : v).replace(/^"|"$/g, ""); }'
        'var view = new LiveAPI("live_set view");'
        'var app = new LiveAPI("live_app view");'
        'app.call("show_view", "Detail"); app.call("show_view", "Detail/DeviceChain");'
        'var song = new LiveAPI("live_set"); var tracks = song.getcount("tracks");'
        'var hits = [], t, i, n, d, name;'
        'for (t = 0; t < tracks; t++) {'
        '  var tr = new LiveAPI("live_set tracks " + t); n = tr.getcount("devices");'
        '  for (i = 0; i < n; i++) {'
        '    d = new LiveAPI("live_set tracks " + t + " devices " + i);'
        '    name = one(d.get("name"));'
        '    if (name.indexOf("Reactive 2") >= 0) hits.push(t);'
        '  }'
        '}'
        'var k; for (k = hits.length - 2; k >= 0; k--) song.call("delete_track", hits[k]);'
        'tracks = song.getcount("tracks"); var path = "", tid = 0;'
        'for (t = tracks - 1; t >= 0 && !path; t--) {'
        '  var tr2 = new LiveAPI("live_set tracks " + t); n = tr2.getcount("devices");'
        '  for (i = 0; i < n; i++) {'
        '    d = new LiveAPI("live_set tracks " + t + " devices " + i);'
        '    if (one(d.get("name")).indexOf("Reactive 2") >= 0) {'
        '      path = String(d.unquotedpath || ""); tid = tr2.id; break; }'
        '  }'
        '}'
        'if (!path) return {path: ""};'
        'view.set("selected_track", "id " + tid);'
        'var dev = new LiveAPI(path); var pc = dev.getcount("parameters"); var out = {};'
        'for (i = 0; i < pc; i++) {'
        '  var p = new LiveAPI(path + " parameters " + i); var nm = one(p.get("name"));'
        '  if (nm === "Pos" || nm === "Osc2Pos") {'
        '    var setTo = nm === "Pos" ? 37 : 64;'
        '    p.set("value", setTo);'
        '    out[nm] = {min: one(p.get("min")), max: one(p.get("max")), value: one(p.get("value")), set: setTo};'
        '  }'
        '}'
        'return {path: path, id: Number(d.id), track: Number(tid), params: out, kept: hits.length};'
    )
    DEVICE["path"] = (info or {}).get("path") or ""
    return info


def show_osc(tab):
    type_name = "Osc2Type" if tab else "Osc1Type"
    on_name = "Osc2On" if tab else "Osc1On"
    rpc(
        'function one(v){ if (v && typeof v !== "string" && v.length) v = v[v.length - 1];'
        ' return String(v == null ? "" : v).replace(/^"|"$/g, ""); }'
        'var path = %s; var dev = new LiveAPI(path); var pc = dev.getcount("parameters"); var i;'
        'for (i = 0; i < pc; i++) { var p = new LiveAPI(path + " parameters " + i); var nm = one(p.get("name"));'
        '  if (nm === "%s" || nm === "%s") p.set("value", 1); }'
        'var m = new Global("better_sampler_hooks").map || {}; var k = Object.keys(m); var dbg = k.length ? m[k[k.length - 1]] : "";messnamed(dbg, "dbg_r2_osc", %d, 1); return 1;'
        % (json.dumps(DEVICE["path"]), type_name, on_name, tab)
    )
    time.sleep(0.6)
    text = rpc(
        'var m = new Global("better_sampler_hooks").map || {}; var k = Object.keys(m); var dbg = k.length ? m[k[k.length - 1]] : "";messnamed(dbg, "dbg_r2_faces");'
        'var g = new Global("bs_r2_faces");'
        'return String(g.text || "");'
    )
    faces = {}
    for part in str(text or "").split(";"):
        if "=" not in part:
            continue
        key, rect = part.split("=", 1)
        nums = [float(x) for x in rect.split(",") if x]
        if len(nums) == 4:
            faces[key] = nums
    time.sleep(0.25)
    box = rpc('var g = new Global("bs_r2_facebox"); return String(g.text || "");')
    print("face boxes", box)
    return faces


def show_device(info):
    # Selecting the master track and then this device is what paints the v8ui (select alone left it blank).
    rpc(
        'var v = new LiveAPI("live_set view"); var a = new LiveAPI("live_app view");'
        'a.call("hide_view", "Browser");'
        'a.call("show_view", "Detail"); a.call("show_view", "Detail/DeviceChain");'
        'v.set("selected_track", "id", Number(new LiveAPI("live_set master_track").id));'
        'return 1;'
    )
    time.sleep(0.7)
    rpc(
        'var v = new LiveAPI("live_set view"); var a = new LiveAPI("live_app view");'
        'v.set("selected_track", "id", %d);'
        'v.call("select_device", "id", %d);'
        'a.call("show_view", "Detail/DeviceChain");'
        'a.call("focus_view", "Detail/DeviceChain");'
        'return 1;' % (int(info["track"]), int(info["id"]))
    )
    time.sleep(0.7)


def read_ptr():
    rpc('var m = new Global("better_sampler_hooks").map || {}; var k = Object.keys(m); var dbg = k.length ? m[k[k.length - 1]] : "";messnamed(dbg, "dbg_r2_ptr"); return 1;')
    time.sleep(0.08)
    text = rpc('var g = new Global("bs_r2_ptr"); return String(g.text || "");')
    parts = str(text or "").split(",")
    if len(parts) != 3:
        return None
    try:
        return int(float(parts[0])), float(parts[1]), float(parts[2])
    except ValueError:
        return None


def calibrate(win):
    # Move over the device view until the drawing reports the pointer. No clicks, so a menu cannot open.
    base = read_ptr()
    base_n = base[0] if base else -1
    y_top = int(win["y"] + win["h"] - 340)
    y_bot = int(win["y"] + win["h"] - 36)
    for sy in range(y_bot, y_top, -32):
        for sx in range(int(win["x"] + 24), int(win["x"] + 560), 32):
            mo._mouse(5, sx, sy)
            time.sleep(0.08)
            p = read_ptr()
            if not p or p[0] == base_n or p[1] < 0:
                continue
            mo._mouse(5, sx + 8, sy + 8)
            time.sleep(0.08)
            p2 = read_ptr()
            if not p2 or p2[0] == p[0] or p2[1] < 0:
                continue
            origin = (sx + 8 - p2[1], sy + 8 - p2[2])
            print("canvas origin", [round(v, 1) for v in origin], "local", [round(v, 1) for v in p2[1:]])
            return origin
    return None


def click_face(origin, rect, name, low=False):
    # The scan face has to answer a click on the hairline, including near the handle,
    # not only the top 14 px a numbox would keep.
    x0, y0, w, h = rect
    # The handle lives on the lower half of the hairline. A face snapped to the top 18 px misses it.
    spots = (0.88, 0.72, 0.58) if low else (0.16, 0.5, 0.78)
    for fy in spots:
        for fx in (0.5, 0.3, 0.7):
            sx = origin[0] + x0 + w * fx
            sy = origin[1] + y0 + h * fy
            mo.press("escape", 0.05)
            mo.click(sx, sy)
            time.sleep(0.15)
            try:
                s = selected() or {}
            except Exception as exc:
                mo.press("escape", 0.2)
                print("click read", exc)
                continue
            print("click", name, round(sx), round(sy), s.get("name"))
            if s.get("name") == name:
                return sx, sy, s
    return None


def menu_text():
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, "mm_os_input.py"), "menu", "Live"],
        capture_output=True, text=True, timeout=25,
    )
    cg = subprocess.run(
        [sys.executable, os.path.join(HERE, "mm_os_input.py"), "cgwindows", "Live"],
        capture_output=True, text=True, timeout=25,
    )
    return (r.stdout or "") + (r.stderr or "") + "\n" + (cg.stdout or "")


def main():
    if os.environ.get("BS_FACE_VM") != "1":
        fail("this drives the pointer inside Live; run it with scripts/vm_sampler.sh wtface")
    try:
        urllib.request.urlopen("http://127.0.0.1:9877/health", timeout=3).read()
    except Exception as exc:
        fail("bridge is not up: %s" % exc)
    info = prepare()
    print("device", json.dumps(info))
    if not info or not info.get("path"):
        fail("Reactive 2 is not on a track")
    params = info.get("params") or {}
    for name, want in (("Pos", 37), ("Osc2Pos", 64)):
        got = params.get(name)
        if not got:
            fail("%s is not a device parameter" % name)
        if abs(num(got.get("min")) - 0) > 0.01 or abs(num(got.get("max")) - 100) > 0.01:
            fail("%s range is %s..%s" % (name, got.get("min"), got.get("max")))
        if abs(num(got.get("value")) - want) > 0.05:
            fail("%s read back %s after setting %s" % (name, got.get("value"), want))
    print("LOM readback ok")
    mo.front("Live")
    win = None
    last = None
    for _ in range(8):
        time.sleep(0.4)
        try:
            win = mo.window("Live")
            break
        except Exception as exc:
            last = exc
    if not win:
        fail("Live window: %s" % last)
    print("live window", win)
    show_device(info)
    faces = show_osc(0)
    print("osc1 faces", len(faces), faces.get("play_pos"))
    rect = faces.get("play_pos")
    if not rect or not (8 < rect[2] <= 40 and rect[3] > 20):
        fail("the wavetable slider has no thin Play Position face (%s)" % rect)
    if len(faces) < 8:
        fail("only %d parameter faces were placed" % len(faces))
    origin = calibrate(win)
    if not origin:
        fail("the pointer never crossed the device drawing")
    hit = click_face(origin, rect, "Pos", low=True)
    if not hit:
        fail("a click on the wavetable slider did not select Pos")
    x, y, sel = hit
    print("play position click", x, y, sel.get("path"))
    before = menu_text()
    mo.rclick(x, y)
    time.sleep(0.5)
    after = menu_text()
    mo.press("escape", 0.2)
    opened = ("Automation" in after) or (after.count("[") > before.count("["))
    print("--- menu ---")
    print(after[-2500:])
    if not opened:
        fail("right-click on Pos did not open a menu")
    if "Automation" not in after and "automation" not in after.lower():
        print("menu text did not include Automation; a new window did open")
    faces2 = show_osc(1)
    print("osc2 faces", len(faces2), faces2.get("osc2_pos"))
    rect2 = faces2.get("osc2_pos")
    if not rect2 or not (8 < rect2[2] <= 40 and rect2[3] > 20):
        fail("osc 2's wavetable slider has no thin Osc 2 Position face (%s)" % rect2)
    hit2 = click_face(origin, rect2, "Osc2Pos", low=True)
    if not hit2:
        fail("a click on osc 2's slider did not select Osc2Pos")
    x, y = hit2[0], hit2[1]
    print("osc2 click", hit2[2].get("path"))
    mo.rclick(x, y)
    time.sleep(0.4)
    after2 = menu_text()
    mo.press("escape", 0.2)
    if "Automation" not in after2 and "automation" not in after2.lower() and after2.count("[") <= before.count("["):
        fail("right-click on Osc2Pos did not open a menu")
    print("wavetable frame faces ok")


if __name__ == "__main__":
    main()
