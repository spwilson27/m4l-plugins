#!/bin/zsh
# Cepstra Live checks in the tart VM macos-1 (AGENTS.md 1a: never Live on the host). Modelled on vm_smoke.sh.
#   scripts/vm_cepstra.sh     (M4L_VM_DIR=sweep2/cepstra: own VM checkout)
# Under one hold of the Live lock: sync, write the smoke set, reopen it, create tracks "SMK A" / "SMK B" with a looping
# clip, load devices/Cepstra.amxd on both (one at a time, waiting for the gen~), then run scripts/test_cepstra_live.js
# on the host through an ssh tunnel.
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VMDIR="${M4L_VM_DIR:-sweep2/cepstra}"
LOCAL_PORT="${CEPSTRA_LIVE_PORT:-19912}"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")
DEV="devices/Cepstra.amxd"

sync_repo() {
  "${SSH[@]}" "mkdir -p ~/$VMDIR" && rsync -az --delete --exclude .git --exclude node_modules --exclude previews \
    --exclude tests/out --exclude __pycache__ -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:$VMDIR/"
}

# one device, called under the Live lock (internal: `vm_cepstra.sh _one`)
one() {
  dev="$DEV"; slug=cepstra_live; out="$ROOT/tests/out/cepstra_live"; mkdir -p "$out"
  [ -f "$ROOT/$dev" ] || { echo "FAIL $dev: no such device file" >&2; return 1; }
  kind=audio
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
  g=""
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
    sleep 9   # deferred gen~ (AGENTS 1d): let it join the DSP chain before the next instance
  done
  # fire the clips only now: devices that create their gen~ after load (AGENTS 1d) are loaded while the transport is stopped
  "$ROOT/scripts/vm_live_open.sh" exec "for tr in song.tracks: tr.clip_slots[0].fire()
song.is_playing = True
result = 1" >/dev/null || { echo "FAIL $dev: could not start the clips" >&2; return 1; }
  node "$ROOT/scripts/test_cepstra_live.js" --port "$LOCAL_PORT" 2>&1 | tee "$out/run.log"
  rc=${pipestatus[1]}
  kill $tun 2>/dev/null
  crashes1="$("${SSH[@]}" 'ls ~/Library/Logs/DiagnosticReports 2>/dev/null | grep -c "^Live"')"
  if [ "$crashes1" -gt "$crashes0" ]; then echo "FAIL $dev: Live crash report(s) appeared ($crashes0 -> $crashes1) in ~/Library/Logs/DiagnosticReports" | tee -a "$out/report.txt"; rc=1; fi
  echo "TIMING $slug $(( $(date +%s) - t0 )) s (rc $rc)" | tee -a "$out/report.txt"
  return $rc
}

case "${1:-}" in
  _one) shift; one; exit $? ;;
  -h|--help) sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac

sync_repo || exit 1
"${SSH[@]}" "cd ~/$VMDIR && /usr/bin/python3 scripts/make_smoke_set.py smoke_test.als && /usr/bin/python3 scripts/make_smoke_assets.py assets" || exit 1
"$ROOT/scripts/vm_live_open.sh" install >/dev/null 2>&1   # remote script + client (idempotent)
M4L_LIVE_SET=smoke_test.als M4L_LIVE_LOCK_MAX_HOLD=600 "$ROOT/scripts/vm_live_lock.sh" cepstra-live -- "$0" _one
