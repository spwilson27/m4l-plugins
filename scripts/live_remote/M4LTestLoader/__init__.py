# M4LTestLoader: a tiny Live MIDI Remote Script (control surface) for the tart VM macos-1 (AGENTS.md 1a).
# It lets host test scripts load .amxd / .adg files through Live's browser API without
# relaunching Live (the M4L LiveAPI bridge cannot load device files). Sets are opened by the host helper
# (scripts/vm_live_open.sh ensure: `open -a` into the running Live), not here: a staged copy of an .als
# would break its relative device paths.
#
# Install: scripts/vm_live_open.sh install (copies this folder to the VM's User Library "Remote Scripts"
# ; select it ONCE in Live: Settings > Tempo & MIDI > Control Surface = M4LTestLoader, kept in Preferences.cfg). Protocol: a client (scripts/live_loader_client.py, run in the
# VM) writes /tmp/m4l_loader/req/<id>.json = {"op": ..., ...}; this script polls that folder from
# update_display (about every 100 ms on Live's main thread), runs the request and writes
# /tmp/m4l_loader/res/<id>.json = {"ok": true|false, ...}.
# Ops:
#   ping                                    -> {version, tracks}
#   load   {path, track}                    load a device / preset / sample onto a track (index, "master",
#                                           "selected", "new_audio", "new_midi"); the file is copied into
#                                           User Library/_m4l_loader/<mtime>_<size>/ and found in the browser,
#                                           so a rebuilt file is a new item and the device keeps its name
#   exec   {code}                           run Python with song / app / browser / Live in scope; the value
#                                           of `result` is returned (must be JSON-serialisable)
from __future__ import absolute_import, print_function

import json
import os
import shutil
import time
import traceback

import Live

BASE = "/tmp/m4l_loader"
REQ = BASE + "/req"
RES = BASE + "/res"
USERLIB = os.path.expanduser("~/Music/Ableton/User Library")
STAGE = os.path.join(USERLIB, "_m4l_loader")


def create_instance(c_instance):
    return M4LTestLoader(c_instance)


class M4LTestLoader(object):
    def __init__(self, c_instance):
        self._c = c_instance
        self._pending = None  # a load waiting for the browser to index a new file
        for d in (REQ, RES, STAGE):
            try:
                os.makedirs(d)
            except OSError:
                pass
        self._log("M4LTestLoader ready")

    # --- control surface boilerplate -------------------------------------------------------------
    def disconnect(self):
        pass

    def connect_script_instances(self, instances):
        pass

    def can_lock_to_devices(self):
        return False

    def refresh_state(self):
        pass

    def build_midi_map(self, midi_map_handle):
        pass

    def receive_midi(self, midi_bytes):
        pass

    def suggest_input_port(self):
        return ""

    def suggest_output_port(self):
        return ""

    def suggest_map_mode(self, cc_no, channel):
        return Live.MidiMap.MapMode.absolute

    def port_settings_changed(self):
        pass

    def toggle_lock(self):
        pass

    def application(self):
        return Live.Application.get_application()

    def song(self):
        return self._c.song()

    def _log(self, msg):
        try:
            self._c.log_message("M4LTestLoader: " + str(msg))
        except Exception:
            pass

    # --- request loop ----------------------------------------------------------------------------
    def update_display(self):
        if self._pending is not None:
            rid, req, deadline = self._pending
            item = self._find(req["_name"])
            if item is not None or time.time() > deadline:
                self._pending = None
                self._finish(rid, req, item)
            return
        try:
            names = sorted(n for n in os.listdir(REQ) if n.endswith(".json"))
        except OSError:
            return
        for n in names[:1]:
            rid = n[:-5]
            p = os.path.join(REQ, n)
            try:
                with open(p) as f:
                    req = json.load(f)
            except Exception:
                continue  # half-written, try again next tick
            try:
                os.remove(p)
            except OSError:
                pass
            try:
                self._handle(rid, req)
            except Exception:
                self._reply(rid, {"ok": False, "error": traceback.format_exc()})

    def _reply(self, rid, obj):
        tmp = os.path.join(RES, rid + ".tmp")
        with open(tmp, "w") as f:
            json.dump(obj, f)
        os.rename(tmp, os.path.join(RES, rid + ".json"))

    def _handle(self, rid, req):
        op = req.get("op")
        song = self.song()
        if op == "ping":
            app = self.application()
            v = "%d.%d.%d" % (app.get_major_version(), app.get_minor_version(), app.get_bugfix_version())
            self._reply(rid, {"ok": True, "version": v, "tracks": [t.name for t in song.tracks]})
        elif op == "exec":
            ns = {"song": song, "app": self.application(), "browser": self.application().browser, "Live": Live, "result": None}
            exec(req["code"], ns)
            self._reply(rid, {"ok": True, "result": ns.get("result")})
        elif op == "load":
            src = req["path"]
            if not os.path.isfile(src):
                self._reply(rid, {"ok": False, "error": "no such file: " + src})
                return
            # stage a copy in a folder unique to this file version, so the browser item is new and current
            # while the device keeps its own name
            base = os.path.basename(src)
            tag = "%d_%d" % (int(os.path.getmtime(src)), os.path.getsize(src))
            d = os.path.join(STAGE, tag)
            dst = os.path.join(d, base)
            if not os.path.exists(dst):
                try:
                    os.makedirs(d)
                except OSError:
                    pass
                shutil.copyfile(src, dst)
            name = tag + "/" + base
            req["_name"] = name
            item = self._find(name)
            if item is None:  # the browser indexes new files a moment later
                self._pending = (rid, req, time.time() + float(req.get("timeout", 20)))
                return
            self._finish(rid, req, item)
        else:
            self._reply(rid, {"ok": False, "error": "unknown op %r" % (op,)})

    def _find(self, name):
        """name = "<version folder>/<file name>" inside the User Library folder _m4l_loader"""
        tag, base = name.split("/", 1)
        stem = os.path.splitext(base)[0]
        for a in self.application().browser.user_library.children:
            if a.name != "_m4l_loader":
                continue
            for b in a.children:
                if b.name != tag:
                    continue
                for c in b.children:
                    if c.is_loadable and c.name in (base, stem):
                        return c
        return None

    def _finish(self, rid, req, item):
        if item is None:
            self._reply(rid, {"ok": False, "error": "browser did not index " + req["_name"]})
            return
        song = self.song()
        browser = self.application().browser
        tr = req.get("track", "selected")
        if tr == "new_audio":
            song.create_audio_track(-1)
            track = song.tracks[-1]
        elif tr == "new_midi":
            song.create_midi_track(-1)
            track = song.tracks[-1]
        elif tr == "master":
            track = song.master_track
        elif tr == "selected":
            track = song.view.selected_track
        else:
            track = song.tracks[int(tr)]
        song.view.selected_track = track
        before = len(track.devices)
        browser.load_item(item)
        self._reply(rid, {"ok": True, "item": item.name, "track": track.name, "devices_before": before,
                          "devices": [d.name for d in track.devices]})
