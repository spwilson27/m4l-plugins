#!/bin/zsh
# Amp Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on the host).
#   scripts/vm_amp.sh audio [case ...]   host fixtures (node tests/amp_fixtures.js), sync, run the Max harness cases
#   scripts/vm_amp.sh livetest           under the Live lock: sync, open the bridge set (fresh), load every built
#                                        Amp device on a new audio track, run scripts/test_amp_live.js (tunnel)
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
  livetest)
    [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || exec "$ROOT/scripts/vm_live_lock.sh" amp-live -- "$0" livetest "$@"
    sync_repo || exit 1
    # The bridge set's device path does not resolve in the VM: open it, then put the bridge on Main by file.
    "$ROOT/scripts/vm_live_open.sh" ensure "~/${DIR}/ableton_mcp_bridge.als" --fresh
    "$ROOT/scripts/vm_live_open.sh" load "/Users/admin/${DIR}/devices/Ableton MCP Bridge.amxd" master || exit 1
    "${SSH[@]}" 'for i in $(seq 1 60); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 0.5; done; echo "no bridge" >&2; exit 1' || exit 1
    for f in "$ROOT"/devices/Amp\ *.amxd; do
      "$ROOT/scripts/vm_live_open.sh" load "/Users/admin/${DIR}/devices/$(basename "$f")" new_audio || exit 1
    done
    LOCAL_PORT=19884
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_amp_live.js" --port "$LOCAL_PORT" --vmdir "/Users/admin/${DIR}" ;;
  *) echo "usage: scripts/vm_amp.sh audio|sync [case ...]" >&2; exit 64 ;;
esac
