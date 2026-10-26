#!/usr/bin/env python3
"""Drive Fill in the VM's Live and print what the face and the scope report."""
import json
import sys
import time
import urllib.request

LOOP = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Drums/Full/Hip Hop Doubled 145 bpm.wav"


def rpc(code, timeout=40):
    body = json.dumps({"action": "eval_js", "params": {"code": code}}).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:9877/rpc", data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as res:
        out = json.loads(res.read().decode())
    if not out.get("ok"):
        print("BRIDGE", json.dumps(out)[:800])
        sys.exit(1)
    result = out.get("result", {})
    if isinstance(result, dict) and "result" in result:
        return result["result"]
    return result


def main():
    step = sys.argv[1] if len(sys.argv) > 1 else "info"
    if step == "info":
        print(rpc(r'''
            var song = new LiveAPI("live_set");
            var n = song.getcount("tracks");
            var lines = ["song " + song.get("name"), "tracks " + n];
            var i, d, t, devs, name;
            for (i = 0; i < n; i++) {
                t = new LiveAPI("live_set tracks " + i);
                devs = t.getcount("devices");
                lines.push("track " + i + " " + t.get("name") + " devices " + devs);
                for (d = 0; d < devs; d++) {
                    var dev = new LiveAPI("live_set tracks " + i + " devices " + d);
                    lines.push("  dev " + d + " " + dev.get("name") + " class " + dev.get("class_name") + " params " + dev.getcount("parameters"));
                }
            }
            var view = new LiveAPI("live_app view");
            view.call("show_view", "Detail");
            view.call("show_view", "Detail/DeviceChain");
            if (n > 0) {
                var tr = new LiveAPI("live_set tracks 0");
                new LiveAPI("live_set view").set("selected_track", "id " + tr.id);
            }
            return lines.join("\n");
        '''))
    elif step == "chains":
        print(rpc(r'''
            var rack = new LiveAPI("live_set tracks 0 devices 0");
            var nc = rack.getcount("chains");
            var lines = ["chains " + nc];
            var c, d;
            for (c = 0; c < nc; c++) {
                var chain = new LiveAPI("live_set tracks 0 devices 0 chains " + c);
                lines.push("chain " + c + " " + chain.get("name") + " devices " + chain.getcount("devices"));
                var nd = chain.getcount("devices");
                for (d = 0; d < nd; d++) {
                    var dev = new LiveAPI("live_set tracks 0 devices 0 chains " + c + " devices " + d);
                    lines.push("  " + d + " " + dev.get("name") + " " + dev.get("class_name") + " params " + dev.getcount("parameters"));
                }
            }
            return lines.join("\n");
        '''))
    elif step == "params":
        path = sys.argv[2] if len(sys.argv) > 2 else "live_set tracks 0 devices 0"
        print(rpc(
            'var dev = new LiveAPI("' + path + '");'
            'var n = dev.getcount("parameters");'
            'var lines = [dev.get("name") + " " + dev.get("class_name")];'
            'var i;'
            'for (i = 0; i < n; i++) {'
            '  var p = new LiveAPI("' + path + ' parameters " + i);'
            '  lines.push(i + " " + p.get("name") + " = " + p.get("value") + "  " + p.get("value_string"));'
            '}'
            'return lines.join("\\n");'
        ))
    elif step == "play":
        print(rpc(r'''
            var slot = new LiveAPI("live_set tracks 0 clip_slots 0");
            var has = Number(slot.get("has_clip"));
            if (!has) {
                try { slot.call("create_audio_clip", "''' + LOOP + r'''"); }
                catch (e) { return "create failed " + e; }
            }
            var clip = new LiveAPI("live_set tracks 0 clip_slots 0 clip");
            clip.set("looping", 1);
            var song = new LiveAPI("live_set");
            song.call("start_playing");
            slot.call("fire");
            return "fired has_was " + has + " name " + clip.get("name");
        '''))
    elif step == "clip":
        print(rpc(r'''
            var t = new LiveAPI("live_set tracks 0");
            var slot = new LiveAPI("live_set tracks 0 clip_slots 0");
            var lines = [
                "mute " + t.get("mute"),
                "solo " + t.get("solo"),
                "arm " + t.get("arm"),
                "meterL " + t.get("output_meter_left"),
                "meterR " + t.get("output_meter_right"),
                "meter " + t.get("output_meter_level"),
                "has " + slot.get("has_clip"),
                "playing_slot " + slot.get("is_playing"),
                "triggered " + slot.get("is_triggered")
            ];
            if (Number(slot.get("has_clip"))) {
                var clip = new LiveAPI("live_set tracks 0 clip_slots 0 clip");
                lines.push("clip " + clip.get("name"));
                lines.push("playing " + clip.get("is_playing"));
                lines.push("loop " + clip.get("looping"));
                lines.push("len " + clip.get("length"));
                lines.push("file " + clip.get("file_path"));
            }
            lines.push("song_playing " + new LiveAPI("live_set").get("is_playing"));
            var mix = new LiveAPI("live_set tracks 0 mixer_device volume");
            lines.push("vol " + mix.get("value"));
            var chain = new LiveAPI("live_set tracks 0 devices 0 chains 0");
            lines.push("chain_mute " + chain.get("mute"));
            var cm = new LiveAPI("live_set tracks 0 devices 0 chains 0 mixer_device volume");
            lines.push("chain_vol " + cm.get("value"));
            if (Number(slot.get("has_clip"))) {
                var c2 = new LiveAPI("live_set tracks 0 clip_slots 0 clip");
                lines.push("gain " + c2.get("gain"));
                lines.push("sample " + c2.get("sample_length"));
                lines.push("warp " + c2.get("warping"));
            }
            return lines.join("\n");
        '''))
    elif step == "meter":
        time.sleep(0.8)
        print(rpc(r'''
            var t = new LiveAPI("live_set tracks 0");
            return "meter " + t.get("output_meter_level") + " playing " + new LiveAPI("live_set").get("is_playing");
        '''))
    elif step == "select":
        print(rpc(r'''
            var dev = new LiveAPI("live_set tracks 0 devices 0 chains 0 devices 0");
            var view = new LiveAPI("live_app view");
            view.call("show_view", "Detail");
            view.call("show_view", "Detail/DeviceChain");
            var tr = new LiveAPI("live_set tracks 0");
            new LiveAPI("live_set view").set("selected_track", "id " + tr.id);
            new LiveAPI("live_set tracks 0 view").set("selected_device", "id " + dev.id);
            return "selected " + dev.get("name") + " " + dev.id;
        '''))
    elif step == "hook":
        msg = sys.argv[2] if len(sys.argv) > 2 else "test_report"
        extra = ""
        if len(sys.argv) > 3:
            extra = ", " + sys.argv[3]
        print(rpc(
            'messnamed("fill-face-test", "' + msg.replace('"', "") + '"' + extra + ');'
            'return "sent ' + msg.replace('"', "") + extra + '";'
        ))
    elif step == "report":
        try:
            print(open("/tmp/fill_face_report.txt").read())
        except OSError as e:
            print("no report", e)
            return 1
    elif step == "set":
        # argv: index value   (parameter index on track 0 device 0, or devices 0 chain)
        index = int(sys.argv[2])
        value = float(sys.argv[3])
        which = sys.argv[4] if len(sys.argv) > 4 else "live_set tracks 0 devices 0"
        print(rpc(
            'var p = new LiveAPI("' + which + ' parameters ' + str(index) + '");'
            'p.set("value", ' + str(value) + ');'
            'return p.get("name") + " -> " + p.get("value_string");'
        ))
    else:
        print("unknown", step)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
