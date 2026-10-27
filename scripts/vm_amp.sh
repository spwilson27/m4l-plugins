#!/bin/zsh
# Amp Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on the host).
#   scripts/vm_amp.sh audio [case ...]   host fixtures (node tests/amp_fixtures.js), sync, run the Max harness cases
#   scripts/vm_amp.sh sync
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${AMP_VM_DIR:-ableton-amp}"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ \
    --exclude '*_test.als' -e "sshpass -e ssh -o StrictHostKeyChecking=accept-new" "$ROOT/" "admin@${IP}:${DIR}/"
}

cmd="${1:-audio}"
shift || true
case "$cmd" in
  audio)
    [ -n "${AMP_NOFIX:-}" ] || (cd "$ROOT" && node tests/amp_fixtures.js >/dev/null) || exit 1
    sync_repo
    "${SSH[@]}" "cd ~/${DIR} && python3 scripts/run_amp_audio_tests.py $*"
    ;;
  sync) sync_repo ;;
  *) echo "usage: scripts/vm_amp.sh audio|sync [case ...]" >&2; exit 64 ;;
esac
