#!/bin/zsh
# Live visual check of every Amp+ face in the tart VM macos-1 (AGENTS.md 1a: never launch Live
# on the host). Syncs the repo like vm_ampplus.sh (the devices need devices/ampplus_models/
# beside them), then for each device: load on a new audio track under the Live lock, confirm
# the track's devices, screenshot the VM screen, remove the track (guarded by an Amp device
# name check, so nothing else can be deleted). The screenshot step uses vm_shot.sh (host-side
# capture; in-guest screencapture over ssh fails 'could not create image from display' in every
# form tried, and VNC port 5900 is closed). Tart is NOT headless — it runs fullscreen on the
# host — so vm_shot.sh falls back to activating Tart and taking a full-screen capture when no
# window named macos-1 exists (verified 2026-10-24).
#   scripts/vm_ampplus_livecheck.sh [outdir]    default: previews/live
set -u
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VM=macos-1
DIR="${AMPPLUS_VM_DIR:-ableton-ampplus}"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running" >&2; exit 1; }
OUTDIR="${1:-$ROOT/previews/live}"
mkdir -p "$OUTDIR"
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

echo "== sync =="
rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ --exclude 'tests/out' --exclude '*_test.als' -e "sshpass -e ssh -o StrictHostKeyChecking=accept-new" "$ROOT/" "admin@${IP}:${DIR}/"
VMHOME="$("${SSH[@]}" 'echo $HOME')"
echo "VM home: $VMHOME"

run() {
  export M4L_LIVE_LOCK_HELD=1
  local spec name slug dev shot
  for spec in "Amp+|main" "Amp+ Wave|wave" "Amp+ Pulse|pulse" "Amp+ Tiles|tiles" "Amp+ Strip|strip" "Amp+ Mono|mono"; do
    name="${spec%%|*}"
    slug="${spec##*|}"
    dev="${VMHOME}/${DIR}/devices/${name}.amxd"
    shot="${OUTDIR}/amp_${slug}_live.png"
    echo "== load $name =="
    "$ROOT/scripts/vm_live_open.sh" load "$dev" new_audio || { echo "LOAD FAILED: $name" >&2; continue; }
    python3 -c 'import time; time.sleep(8)'
    echo "== confirm $name =="
    "$ROOT/scripts/vm_live_open.sh" exec 't = song.tracks[-1]
result = {"track": t.name, "devices": [d.name for d in t.devices]}'
    echo "== shot $name =="
    "$ROOT/scripts/vm_shot.sh" "$shot"
    echo "== remove $name =="
    "$ROOT/scripts/vm_live_open.sh" exec 't = song.tracks[-1]
names = [d.name for d in t.devices]
result = {"devices": names, "removed": False}
if any(n.startswith("Amp") for n in names):
    song.delete_track(len(song.tracks) - 1)
    result["removed"] = True'
  done
  echo "== screenshots =="
  ls -l "$OUTDIR"
}

if [ -n "${M4L_LIVE_LOCK_HELD:-}" ]; then
  run
else
  exec "$ROOT/scripts/vm_live_lock.sh" ampplus-live -- "$0" "$@"
fi
