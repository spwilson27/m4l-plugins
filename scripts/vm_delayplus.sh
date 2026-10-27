#!/bin/zsh
# Delay+ Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on the
# host). Builds and node tests stay on the host; this copies the repo into the VM and runs the rest
# there over ssh (login admin / admin, tart's default test-VM credentials).
#
#   scripts/vm_delayplus.sh sync     rsync the repo to ~/ableton in the VM
#   scripts/vm_delayplus.sh audio    sync, then run scripts/run_delayplus_audio_tests.py in the VM
#   scripts/vm_delayplus.sh live     sync, rebuild in the VM (the test set must point at VM paths),
#                                    then reopen delayplus_test.als in the running Live and wait for its
#                                    MCP bridge (scripts/vm_live_open.sh ensure --fresh: no relaunch;
#                                    cold start only when Live or its loader is not up; DP_COLD=1 forces it)
#   scripts/vm_delayplus.sh run      live + test under ONE hold of the Live lock (scripts/vm_live_lock.sh); live and
#                                 test alone also take it. `scripts/vm_live_lock.sh status` shows the holder.
#   scripts/vm_delayplus.sh test     run scripts/test_delayplus_live.js on the host through an ssh
#                                    tunnel (local 19877 -> VM 127.0.0.1:9877, the bridge port)
set -u
VM=macos-1
LOCAL_PORT=19877
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ --exclude '*_test.als' \
    -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${VMREL}/"
}

# Live is shared by every session: live / test / run hold the VM-wide Live lock (vm_live_lock.sh; nested
# calls see M4L_LIVE_LOCK_HELD=1 and run directly). `run` = lock -> live -> test -> release.
case "${1:-}" in live|test|run) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=delayplus_test.als exec "$ROOT/scripts/vm_live_lock.sh" delayplus -- "$0" "$@" ;; esac

case "${1:-}" in
  run)
    "$0" live && "$0" test ;;
  sync)
    sync_repo ;;
  audio)
    sync_repo && "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 scripts/run_delayplus_audio_tests.py' ;;
  live)
    host_build delayplus || exit 1
    sync_repo || exit 1
    # no node in the VM: the devices came over in the sync, the VM only writes the set (VM paths)
    "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 -c "import sys; sys.path.insert(0, \"scripts\"); import build_delayplus as b; b.build_sets([\"main\"])" >/dev/null' || exit 1
    # reopen the Set in the running Live (loads the rebuilt devices, ~3 s); DP_COLD=1 = kill + relaunch (~8-10 s)
    if [ -n "${DP_COLD:-}" ]; then "$ROOT/scripts/vm_live_open.sh" cold "~/${VMREL}/delayplus_test.als"
    else "$ROOT/scripts/vm_live_open.sh" ensure "~/${VMREL}/delayplus_test.als" --fresh; fi ;;
  test)
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_delayplus_live.js" --port "$LOCAL_PORT" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
