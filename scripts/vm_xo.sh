#!/bin/zsh
# XO Sample Map Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on
# the host). Builds and node tests stay on the host; this copies the repo into the VM and runs the rest
# there over ssh (login admin / admin, tart's default test-VM credentials). Modelled on vm_sampler.sh and
# vm_envtrig.sh.
#
#   scripts/vm_xo.sh sync     rsync the repo to ~/ableton in the VM (generated *_test.als sets in the VM are kept)
#   scripts/vm_xo.sh max      host: node tests/test_xo_map.js with XO_RUN_MAX_RUNTIME=1 writes the Max runtime
#                             patch (the VM has no node); sync; VM: scripts/run_xo_runtime_test.py launches it
#                             through scripts/max_harness.py (machine-wide Max lock, direct exec, SIGTERM)
#   scripts/vm_xo.sh live     sync, rebuild in the VM, write xo_test.als with VM paths (scripts/make_xo_set.py:
#                             audio track "XO Sample Map" + MCP Bridge on Main), (re)start Live in the VM on it,
#                             clear crash recovery, wait for the bridge (127.0.0.1:9877 in the VM).
#                             Holds the Live lock (waits for other sessions); FORCE=1 = run without it (stale lock).
#   scripts/vm_xo.sh run [V]  live + test under ONE hold of the Live lock (scripts/vm_live_lock.sh); live and
#                                 test alone also take it. `scripts/vm_live_lock.sh status` shows the holder.
#   scripts/vm_xo.sh test     run scripts/test_xo_live.js on the host through an ssh tunnel (local 19879 ->
#                             VM 9877); --ssh lets it stat the rendered files in the VM
#   scripts/vm_xo.sh shot     screencapture of the VM screen -> scratchpad/xo_vm.png (scp'd back)
# Variants: `live`, `test` and `run` take an optional layout variant (default | A | B | C | D | E), e.g.
#   scripts/vm_xo.sh run C     builds `devices/XO Sample Map C.amxd` in the VM, writes xo_test.als with THAT device and
#                              tests it against src/xo_layouts/C.js. (`max` always uses the default device.)
# Workflow: the host gate (README of AGENTS.md section 4), then `live`, `test`, `max`.
set -u
VM=macos-1
LOCAL_PORT=19879
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")
VARIANT="${2:-default}"
case "$VARIANT" in default|[A-Z]) ;; *) echo "variant must be default or a letter, got: $VARIANT" >&2; exit 1 ;; esac
if [ "$VARIANT" = default ]; then XO_DEV="XO Sample Map"; else XO_DEV="XO Sample Map $VARIANT"; fi
SHOT_DIR="${XO_SHOT_DIR:-/private/tmp/claude-501/-Users-mrwilson-software-ableton/b8ec0495-a030-41af-b9b0-e092509b2aec/scratchpad}"

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ \
    --exclude '*_test.als' -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:ableton/"
}

# Live is shared by every session: live / test / run hold the VM-wide Live lock (vm_live_lock.sh; nested
# calls see M4L_LIVE_LOCK_HELD=1 and run directly). `run` = lock -> live -> test -> release.
case "${1:-}" in live|test|run) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=xo_test.als exec "$ROOT/scripts/vm_live_lock.sh" xo -- "$0" "$@" ;; esac

case "${1:-}" in
  run)
    "$0" live "$VARIANT" && "$0" test "$VARIANT" ;;
  sync)
    sync_repo ;;
  max)
    (cd "$ROOT" && XO_RUN_MAX_RUNTIME=1 node tests/test_xo_map.js >/dev/null) || exit 1
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/run_xo_runtime_test.py' ;;
  live)
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/build_xo_map.py --variant '"'$VARIANT'"' >/dev/null &&
      /usr/bin/python3 scripts/make_xo_set.py --out "$HOME/ableton/xo_test.als" --xo "devices/'"$XO_DEV"'.amxd" --track-name "'"$XO_DEV"'" || exit 1
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      find "$HOME/Library/Preferences/Ableton" -maxdepth 2 \( -name CrashRecoveryInfo.cfg -o -name CrashDetection.cfg \) -delete;  # (an unmatched glob aborts rm in the VM zsh)
      open -a "Ableton Live 12 Suite" "$HOME/ableton/xo_test.als" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  test)
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_xo_live.js" --port "$LOCAL_PORT" --ssh "admin@${IP}" --variant "$VARIANT" ;;
  shot)
    "${SSH[@]}" 'screencapture -x /tmp/xo_vm.png' && sshpass -e scp "admin@${IP}:/tmp/xo_vm.png" "$SHOT_DIR/xo_vm.png" && echo "$SHOT_DIR/xo_vm.png" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
