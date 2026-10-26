#!/bin/zsh
# Scatter Max audio tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max
# or Live on the host). Builds and node tests stay on the host; this copies the
# repo into the VM and runs the audio suite there over ssh (login admin / admin).
#
#   scripts/vm_scatter.sh sync    rsync the repo to ~/ableton in the VM
#   scripts/vm_scatter.sh audio   sync, then run scripts/run_scatter_audio_tests.py in the VM
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

case "${1:-}" in
  sync)
    sync_repo ;;
  audio)
    sync_repo && "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/run_scatter_audio_tests.py' "$@" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
