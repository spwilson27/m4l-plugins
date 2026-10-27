#!/bin/zsh
# One Live load of Clip+ in the tart VM: new audio track, confirm the device, screenshot, remove the track.
# Run under the Live lock (this script takes it). Never launch Live on the host.
set -u
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VM=macos-1
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton-clipper "${CLIPPLUS_VM_DIR:-}"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running" >&2; exit 1; }
SSHPASS=admin sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}" "mkdir -p ~/$VMREL/devices; rm -f /tmp/clipplus_dsp.txt"
export SSHPASS=admin
rsync -az -e "sshpass -e ssh -o StrictHostKeyChecking=accept-new" \
  "$ROOT/devices/Clip+.amxd" "admin@${IP}:${VMREL}/devices/Clip+.amxd"
DEV="$(SSHPASS=admin sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}" "echo \$HOME/$VMREL/devices/Clip+.amxd")"
SHOT="${1:-/tmp/clipplus_live.png}"

run() {
  export M4L_LIVE_LOCK_HELD=1
  echo "== load =="
  "$ROOT/scripts/vm_live_open.sh" load "$DEV" new_audio
  echo "== settle =="
  python3 -c 'import time; time.sleep(8)'
  echo "== status =="
  SSHPASS=admin sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}" 'echo STATUS; cat /tmp/clipplus_dsp.txt 2>/dev/null; echo; ls -l /tmp/clipplus_core_*.gendsp 2>/dev/null | head'
  echo "== shot =="
  "$ROOT/scripts/vm_shot.sh" "$SHOT"
  echo "== remove =="
  "$ROOT/scripts/vm_live_open.sh" exec 't = song.tracks[-1]
names = [d.name for d in t.devices]
result = {"devices": names, "removed": False}
if any(n.startswith("Clip") for n in names):
    song.delete_track(len(song.tracks) - 1)
    result["removed"] = True'
}

if [ -n "${M4L_LIVE_LOCK_HELD:-}" ]; then
  run
else
  exec "$ROOT/scripts/vm_live_lock.sh" clipplus-live -- "$0" "$@"
fi
