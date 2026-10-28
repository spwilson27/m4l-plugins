#!/bin/zsh
# Operator+ Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never Max or Live on the host). Builds and node
# tests stay on the host; this syncs the repo to the VM checkout (default ~/sweep2/opplus, M4L_VM_DIR overrides) and runs
# the rest there.
#   scripts/vm_opplus.sh sync               rsync the repo
#   scripts/vm_opplus.sh audio [case ...]   scripts/run_opplus_audio_tests.py in the VM (shared Max harness, NonRealTime)
#   scripts/vm_opplus.sh live               build on the host, sync, write opplus_test.als (scripts/make_smoke_set.py: MCP Bridge
#                                           on Main) and open it fresh in the VM's Live (Live lock)
#   scripts/vm_opplus.sh test [step ...]    scripts/test_opplus_live.py on the host: setup (Operator / Operator+ twin tracks with
#                                           OpCap probes), dsp, params, ab (A/B audio), shots (screenshots per section)
#   scripts/vm_opplus.sh run                live + test under one hold of the Live lock
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel sweep2/opplus
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  "${SSH[@]}" "mkdir -p ~/${VMREL}" && rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude tests/out \
    --exclude __pycache__ -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${VMREL}/"
}

case "${1:-}" in live|test|run) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=opplus_test.als exec "$ROOT/scripts/vm_live_lock.sh" opplus -- "$0" "$@" ;; esac

case "${1:-}" in
  run)
    "$0" live && "$0" test ;;
  sync)
    sync_repo ;;
  audio)
    shift
    sync_repo && "${SSH[@]}" "cd ~/${VMREL} && /usr/bin/python3 scripts/run_opplus_audio_tests.py $*" ;;
  live)
    host_build opplus opplus_probe && sync_repo || exit 1
    "${SSH[@]}" "cd ~/${VMREL} && /usr/bin/python3 scripts/make_smoke_set.py opplus_test.als" || exit 1
    "$ROOT/scripts/vm_live_open.sh" ensure "~/${VMREL}/opplus_test.als" --fresh ;;
  test)
    shift
    OPPLUS_VM_DIR="$VMREL" python3 "$ROOT/scripts/test_opplus_live.py" "$@" ;;
  *)
    sed -n '2,12p' "$0"; exit 2 ;;
esac
