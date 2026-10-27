#!/bin/zsh
# Generic Live smoke test for any device, in the tart VM macos-1 (AGENTS.md 1a: never Max / Live on the host).
#   scripts/vm_smoke.sh [--budget S] [--keep] <device.amxd|.adg>...     (paths relative to the repo)
# Per device (own hold of the Live lock, label smoke-<slug>): rsync the repo to ~/sweep2/smoke in the VM (own checkout,
# never shared), write the smoke set (MCP Bridge on Main, no other track), reopen it with `vm_live_open.sh ensure --fresh`,
# create two tracks "SMK A" / "SMK B" (audio tracks playing a looping noise / tone clip, or MIDI tracks playing a note clip
# for instruments), load the device (or the rack .adg) on both, then run scripts/test_device_smoke_live.js on the host
# through an ssh tunnel (ready, parameter sweep, isolation, screenshots). Output: tests/out/smoke/<slug>/
# (report.json, report.txt, default.png, after_sweep.png + *_full.png). Config: scripts/smoke_devices.json.
# Env: SMOKE_VM_DIR (default ~/sweep2/smoke), SMOKE_BUDGET (sweep seconds per device, default 240).
# Exit 1 when any device FAILs. A Live crash report appearing during a device's run is a FAIL too.
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VMDIR="${SMOKE_VM_DIR:-sweep2/smoke}"   # relative to the VM user's home
BUDGET="${SMOKE_BUDGET:-240}"
LOCAL_PORT="${SMOKE_PORT:-19911}"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

slug_of() { local e="${1:e}"; [[ "$e" == adg ]] && e=_adg || e=; print -r -- "${${1:t:r}:l}$e" | sed 's/[^a-z0-9]/_/g;s/__*/_/g;s/_$//'; }

sync_repo() {
  "${SSH[@]}" "mkdir -p ~/$VMDIR" && rsync -az --delete --exclude .git --exclude node_modules --exclude previews \
    --exclude tests/out --exclude __pycache__ -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:$VMDIR/"
}


# wait until the trace Global holds >= per-track ready lines for $2 loaded tracks (config ready.regex / readyInstances)
probe_wait() {
  python3 - "$ROOT/scripts/smoke_devices.json" "$1" "$2" "$LOCAL_PORT" <<'PY'
import json, re, sys, time, urllib.request
cfg, dev, ntr, port = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
d = json.load(open(cfg)).get(dev, {})
rdy = d.get("ready") or {}
need = max(1, int(d.get("readyInstances", 2)) // 2) * ntr
end = time.time() + 40
n = 0
while time.time() < end:
    try:
        body = json.dumps({"action": "eval_js", "params": {"code": "return String(new Global(%s).text || '');" % json.dumps(rdy["global"])}}).encode()
        r = json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:%s/rpc" % port, body), timeout=10))
        t = r.get("result", {}); t = t.get("result", t) if isinstance(t, dict) else t
        n = len({re.search(r"\[#([^ \]]*)", l).group(1) if re.search(r"\[#", l) else l for l in str(t).split("\n") if re.search(rdy["regex"], l)})
        if n >= need:
            break
    except Exception:
        pass
    time.sleep(1)
print("ready probe: %d/%d after load(s) of %d track(s)" % (n, need, ntr))
PY
}

# one device, called under the Live lock (internal: `vm_smoke.sh _one <device>`)
one() {
  dev="$1"; slug="$(slug_of "$dev")"; out="$ROOT/tests/out/smoke/$slug"; mkdir -p "$out"
  [ -f "$ROOT/$dev" ] || { echo "FAIL $dev: no such device file" >&2; return 1; }
  kind="$(node -e 'const c=require(process.argv[1]);const d=c[process.argv[2]]||{};console.log(d.kind||(process.argv[2].endsWith(".adg")?"rack":"audio"))' "$ROOT/scripts/smoke_devices.json" "$dev")"
  home="$("${SSH[@]}" 'echo $HOME')"; vmroot="$home/$VMDIR"
  echo "== $dev  kind=$kind  slug=$slug"
  t0=$(date +%s)
  crashes0="$("${SSH[@]}" 'ls ~/Library/Logs/DiagnosticReports 2>/dev/null | grep -c "^Live"')"
  "$ROOT/scripts/vm_live_open.sh" ensure "~/$VMDIR/smoke_test.als" --fresh || { echo "FAIL $dev: could not open the smoke set" >&2; return 1; }
  # tracks + clips (Python in Live through the M4LTestLoader)
  setup="
import os
wav = os.path.join('$vmroot', 'assets', 'smoke_loop.wav')
kind = '$kind'
n0 = len(song.tracks)
for nm in ('SMK A', 'SMK B'):
    if kind == 'instrument':
        song.create_midi_track(-1)
    else:
        song.create_audio_track(-1)
    song.tracks[-1].name = nm
for i in range(n0):
    song.delete_track(0)
for tr in song.tracks:
    slot = tr.clip_slots[0]
    if kind == 'instrument':
        slot.create_clip(2.0)
        c = slot.clip
        try:
            c.add_new_notes({'notes': [{'pitch': p, 'start_time': t, 'duration': 0.4, 'velocity': 100} for t, p in ((0.0, 48), (0.5, 55), (1.0, 60), (1.5, 64))]})
        except Exception:
            c.set_notes(tuple((p, t, 0.4, 100, False) for t, p in ((0.0, 48), (0.5, 55), (1.0, 60), (1.5, 64))))
        c.looping = True
    else:
        slot.create_audio_clip(wav)
        slot.clip.looping = True
result = [t.name for t in song.tracks]
"
  r="$("$ROOT/scripts/vm_live_open.sh" exec "$setup")" || { echo "$r"; echo "FAIL $dev: track/clip setup failed" >&2; return 1; }
  echo "setup: $r"
  # bridge tunnel (lowest port that answers); Global traces survive a Set reopen, so clear the probe's trace first
  bport="$("${SSH[@]}" 'for p in 9877 9878 9879 9880; do curl -s -m1 http://127.0.0.1:$p/health >/dev/null && { echo $p; break; }; done')"
  [ -n "$bport" ] || { echo "FAIL $dev: no MCP bridge answers in the VM" >&2; return 1; }
  "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:${bport}" & tun=$!
  trap 'kill $tun 2>/dev/null' EXIT
  for i in $(seq 1 20); do curl -s -m1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
  g="$(node -e 'const c=require(process.argv[1]);const d=c[process.argv[2]]||{};console.log(d.ready&&d.ready.global||"")' "$ROOT/scripts/smoke_devices.json" "$dev")"
  [ -n "$g" ] && curl -s -m 10 -X POST "http://127.0.0.1:${LOCAL_PORT}/rpc" -d "{\"action\":\"eval_js\",\"params\":{\"code\":\"new Global('$g').text = ''; return 1;\"}}" >/dev/null
  loadf="$vmroot/$dev"
  case "$dev" in *.adg)  # the committed preset embeds the build machine's absolute device path: repoint it at the VM copy
    loadf="$vmroot/assets/${dev:t}"
    "${SSH[@]}" "/usr/bin/python3 $vmroot/scripts/smoke_fix_adg.py '$vmroot/$dev' '$loadf' '$vmroot/devices'" || { echo "FAIL $dev: could not repoint the preset" >&2; return 1; } ;;
  esac
  for tr in 0 1; do
    r="$("$ROOT/scripts/vm_live_open.sh" load "$loadf" $tr)" || { echo "$r"; echo "FAIL $dev: load on track $tr failed" >&2; return 1; }
    echo "load $tr: $(echo "$r" | head -c 160)"
    # devices with a ready probe: wait (max 40 s) until the instances loaded so far report ready before loading the next one
    # (a deferred gen~ created while another is still being built can stay outside the DSP chain, AGENTS 1d / 27)
    [ -n "$g" ] && probe_wait "$dev" $(( tr + 1 ))
  done
  # fire the clips only now: devices that create their gen~ after load (AGENTS 1d) are loaded while the transport is stopped
  "$ROOT/scripts/vm_live_open.sh" exec "for tr in song.tracks: tr.clip_slots[0].fire()
song.is_playing = True
result = 1" >/dev/null || { echo "FAIL $dev: could not start the clips" >&2; return 1; }
  node "$ROOT/scripts/test_device_smoke_live.js" --port "$LOCAL_PORT" --device "$dev" --out "$out" --ssh "admin@${IP}" --budget "$BUDGET" 2>&1 | tee "$out/run.log"
  rc=${pipestatus[1]}
  kill $tun 2>/dev/null
  crashes1="$("${SSH[@]}" 'ls ~/Library/Logs/DiagnosticReports 2>/dev/null | grep -c "^Live"')"
  if [ "$crashes1" -gt "$crashes0" ]; then echo "FAIL $dev: Live crash report(s) appeared ($crashes0 -> $crashes1) in ~/Library/Logs/DiagnosticReports" | tee -a "$out/report.txt"; rc=1; fi
  echo "TIMING $slug $(( $(date +%s) - t0 )) s (rc $rc)" | tee -a "$out/report.txt"
  return $rc
}

case "${1:-}" in
  _one) shift; one "$@"; exit $? ;;
  ""|-h|--help) sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac

while [ "${1:-}" = "--budget" ]; do BUDGET="$2"; shift 2; done
export SMOKE_BUDGET="$BUDGET"
sync_repo || exit 1
"${SSH[@]}" "cd ~/$VMDIR && /usr/bin/python3 scripts/make_smoke_set.py smoke_test.als && /usr/bin/python3 scripts/make_smoke_assets.py assets" || exit 1
"$ROOT/scripts/vm_live_open.sh" install >/dev/null 2>&1   # remote script + client (idempotent)
rc=0
for d in "$@"; do
  # own hold of the Live lock per device (never held while idle); a sweep may drive Live for several minutes
  M4L_LIVE_SET=smoke_test.als M4L_LIVE_LOCK_MAX_HOLD=$(( BUDGET + 420 )) \
    "$ROOT/scripts/vm_live_lock.sh" "smoke-$(slug_of "$d")" -- "$0" _one "$d" || rc=1
done
echo "== summary"; for d in "$@"; do s="$(slug_of "$d")"; head -1 "$ROOT/tests/out/smoke/$s/report.txt" 2>/dev/null || echo "$d: no report"; done
exit $rc
