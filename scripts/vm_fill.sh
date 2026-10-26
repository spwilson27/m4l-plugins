#!/bin/zsh
# Fill Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live
# on the host). Builds and node tests stay on the host; this copies the repo into the VM
# and runs the rest there over ssh (login admin / admin).
#
#   scripts/vm_fill.sh sync    rsync the repo to ~/ableton in the VM
#   scripts/vm_fill.sh audio   sync, then run scripts/run_fill_audio_tests.py in the VM
#   scripts/vm_fill.sh live    sync, write fill_test.als, open it under the Live lock
#   scripts/vm_fill.sh shot    capture the VM screen to previews/fill_live.png
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ \
    -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:ableton/"
}

case "${1:-}" in live) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=fill_test.als exec "$ROOT/scripts/vm_live_lock.sh" fill -- "$0" "$@" ;; esac

case "${1:-}" in
  sync)
    sync_repo ;;
  audio)
    sync_repo && "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/run_fill_audio_tests.py' "$@" ;;
  live)
    sync_repo || exit 1
    # The host build is what gets synced. The VM has no node, so the open script does not rebuild.
    "${SSH[@]}" bash ableton/scripts/fill_vm_open.sh ;;
  shot)
    "$ROOT/scripts/vm_shot.sh" "$ROOT/previews/fill_live.png" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
