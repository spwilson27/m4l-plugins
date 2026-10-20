#!/bin/zsh
# Delay+ Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on the
# host). Builds and node tests stay on the host; this copies the repo into the VM and runs the rest
# there over ssh (login admin / admin, tart's default test-VM credentials).
#
#   scripts/vm_delayplus.sh sync     rsync the repo to ~/ableton in the VM
#   scripts/vm_delayplus.sh audio    sync, then run scripts/run_delayplus_audio_tests.py in the VM
#   scripts/vm_delayplus.sh live     sync, rebuild in the VM (the test set must point at VM paths),
#                                    (re)start Live in the VM with delayplus_test.als and wait for its
#                                    MCP bridge. Live is the only instance there: no dialog, relaunch
#                                    freely after every build.
#   scripts/vm_delayplus.sh test     run scripts/test_delayplus_live.js on the host through an ssh
#                                    tunnel (local 19877 -> VM 127.0.0.1:9877, the bridge port)
set -u
VM=macos-1
LOCAL_PORT=19877
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null)"
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
    sync_repo && "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/run_delayplus_audio_tests.py' ;;
  live)
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/build_delayplus.py >/dev/null &&
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      open -a "Ableton Live 12 Suite" "$HOME/ableton/delayplus_test.als" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  test)
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_delayplus_live.js" --port "$LOCAL_PORT" ;;
  *)
    sed -n '2,15p' "$0"; exit 1 ;;
esac
