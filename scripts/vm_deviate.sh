#!/bin/zsh
# Deviate Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on the host). Builds and node tests stay on
# the host (the VM has no node); this copies the repo into the VM (own checkout ${DEVIATE_VM_DIR:-ableton-deviate}, rsync --delete:
# never share it with another session) and runs the rest there over ssh (login admin / admin, tart's default test-VM credentials).
#
#   scripts/vm_deviate.sh sync          rsync the repo to ~/ableton-deviate in the VM
#   scripts/vm_deviate.sh audio [case ...]
#                                       sync, then scripts/run_deviate_audio_tests.py [case ...] in the VM (real Max, shared harness)
#   scripts/vm_deviate.sh py <script.py> [args]
#                                       sync, then /usr/bin/python3 <script.py> [args] in the VM (measurements: scripts/measure_deviate.py)
#   scripts/vm_deviate.sh live          host build of every face, sync, write deviate_test.als in the VM (scripts/make_deviate_set.py,
#                                       VM paths), then reopen it in the running Live (scripts/vm_live_open.sh ensure --fresh; DEV_COLD=1
#                                       = kill + relaunch) and wait for the MCP bridge
#   scripts/vm_deviate.sh test          scripts/test_deviate_live.js on the host through an ssh tunnel (local 19882 -> VM 127.0.0.1:9877)
#   scripts/vm_deviate.sh shot [face ...]
#                                       one Live screenshot per face (default: every Deviate device in the set) into previews/live/deviate_<face>.png
#   scripts/vm_deviate.sh run           live + test + shot under ONE hold of the Live lock (vm_live_lock.sh batch)
# live / test / shot / run hold the VM-wide Live lock (scripts/vm_live_lock.sh); nested calls see M4L_LIVE_LOCK_HELD=1.
set -u
VM=macos-1
LOCAL_PORT=19882
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton-deviate "${DEVIATE_VM_DIR:-}"
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude tests/out --exclude __pycache__ --exclude '*_test.als' \
    -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${VMREL}/"
}

# Live is shared by every session: live / test / shot / run hold the VM-wide Live lock. `run` = ONE batch hold (live, test, shot).
case "${1:-}" in
  run) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_LOCK_MAX_HOLD="${M4L_LIVE_LOCK_MAX_HOLD:-900}" M4L_LIVE_SET=deviate_test.als \
         exec "$ROOT/scripts/vm_live_lock.sh" batch deviate "$0 live" "$0 test" "$0 shot" ;;
  live|test|shot) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=deviate_test.als exec "$ROOT/scripts/vm_live_lock.sh" deviate -- "$0" "$@" ;;
esac

tunnel() {
  "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
  TUNNEL=$!
  trap 'kill $TUNNEL 2>/dev/null' EXIT
  for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
}

case "${1:-}" in
  run)
    "$0" live && "$0" test && "$0" shot ;;   # only reached with the lock already held (batch steps call live/test/shot directly)
  sync)
    sync_repo ;;
  audio)
    shift
    host_build deviate || exit 1   # also refreshes build_cache/ (the generated dv_hidden text: the VM has no node)
    sync_repo && "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 -u scripts/run_deviate_audio_tests.py '"$*" ;;
  py)
    shift
    host_build deviate || exit 1
    sync_repo && "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 -u '"$*" ;;
  live)
    host_build deviate || exit 1
    sync_repo || exit 1
    # no node in the VM: the devices came over in the sync, the VM only writes the set (VM paths)
    "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 scripts/make_deviate_set.py --devices-dir devices --out deviate_test.als' || exit 1
    if [ -n "${DEV_COLD:-}" ]; then "$ROOT/scripts/vm_live_open.sh" cold "~/${VMREL}/deviate_test.als"
    else "$ROOT/scripts/vm_live_open.sh" ensure "~/${VMREL}/deviate_test.als" --fresh; fi ;;
  test)
    tunnel
    node "$ROOT/scripts/test_deviate_live.js" --port "$LOCAL_PORT" ;;
  shot)
    shift
    tunnel
    mkdir -p "$ROOT/previews/live"
    faces=("$@")
    [ ${#faces[@]} -gt 0 ] || faces=(${(f)"$(node "$ROOT/scripts/test_deviate_live.js" --port "$LOCAL_PORT" --list-faces)"})
    rc=0
    for f in "${faces[@]}"; do
      node "$ROOT/scripts/test_deviate_live.js" --port "$LOCAL_PORT" --shot "$f" || rc=1
    done
    exit $rc ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
