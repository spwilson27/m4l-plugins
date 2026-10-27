#!/bin/zsh
# Oscilloscope Max audio tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max
# on the host). Builds and node tests stay on the host; this copies the repo and the
# 16-bit drum loops into the VM and runs the harness there.
#
#   scripts/vm_oscilloscope.sh audio [case ...]
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")
DRUMS="${OSC_DRUM_DIR:-/tmp/drum_probe}"

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ \
    -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${VMREL}/"
  if [ -d "$DRUMS" ]; then
    rsync -az -e "sshpass -e ssh" "$DRUMS/" "admin@${IP}:drum_probe/"
  fi
}

case "${1:-}" in
  audio)
    shift
    sync_repo || exit 1
    # shellcheck disable=SC2029
    "${SSH[@]}" "cd ~/${VMREL} && OSC_DRUM_DIR=\$HOME/drum_probe /usr/bin/python3 scripts/run_oscilloscope_audio_tests.py $*" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
