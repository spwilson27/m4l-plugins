#!/bin/zsh
# Degrade Max audio tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max on the host).
#   scripts/vm_degrade.sh audio [case ...]
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton-degrade "${DEGRADE_VM_DIR:-}"; DIR="$VMREL"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ --exclude 'tests/out' \
    --exclude '*_test.als' -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${DIR}/"
}

cmd="${1:-audio}"
shift || true
case "$cmd" in
  audio)
    sync_repo
    "${SSH[@]}" "cd ~/${DIR} && python3 scripts/${RUNNER:-run_degrade_audio_tests.py} $*"
    ;;
  *)
    echo "usage: scripts/vm_degrade.sh audio [case ...]" >&2
    exit 64
    ;;
esac
