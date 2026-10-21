#!/bin/zsh
# Mega Modulator hotkey tests (real Max / real Live, real OS key + mouse events) inside the tart VM macos-1
# (AGENTS.md 1a: never run Max or Live on the host). Login admin / admin (tart's default test-VM credentials).
#
#   scripts/vm_megamod_keys.sh sync   rsync scripts/ src/ tests/ devices/ to ~/Software/ableton-mmnames in the VM
#                                     (no --delete), rebuild the device there
#   scripts/vm_megamod_keys.sh max    sync, then scripts/run_megamod_key_tests.py in the VM (standalone Max)
#   scripts/vm_megamod_keys.sh live   sync, write megamod_keys_test.als in the VM and (re)start Live on it.
#                                     Refuses when a Live with another set is running (another session may be
#                                     using it); FORCE=1 overrides. Waits for the MCP bridge.
#   scripts/vm_megamod_keys.sh test   run scripts/test_megamod_keys_live.js on the host through an ssh tunnel
#                                     (local 19880 -> VM 127.0.0.1:9877)
# The seed fixture tests/megamod_key_seed.json is made on the host (the VM has no node):
#   node scripts/megamod_key_seed.js
set -u
VM=macos-1
LOCAL_PORT=19880
VMDIR='$HOME/Software/ableton-mmnames'
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  (cd "$ROOT" && node scripts/megamod_key_seed.js >/dev/null) || return 1
  rsync -az --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ --exclude vendor \
    -e "sshpass -e ssh" "$ROOT/scripts" "$ROOT/src" "$ROOT/tests" "$ROOT/devices" "admin@${IP}:Software/ableton-mmnames/" || return 1
  "${SSH[@]}" "cd $VMDIR && /usr/bin/python3 scripts/build_megamod.py >/dev/null"
}

case "${1:-}" in
  sync)
    sync_repo ;;
  max)
    sync_repo && "${SSH[@]}" "cd $VMDIR && /usr/bin/python3 scripts/run_megamod_key_tests.py" ;;
  live)
    BUSY="$("${SSH[@]}" 'pgrep -f "MacOS/Live$" >/dev/null || exit 0;
      osascript -e "tell application \"System Events\" to get name of every window of process \"Live\""' 2>/dev/null)"
    if [ -n "$BUSY" ] && ! echo "$BUSY" | grep -q "megamod_keys_test"; then
      echo "Live is running in the VM with: $BUSY"
      [ "${FORCE:-0}" = "1" ] || { echo "not restarting someone else's Live (FORCE=1 to override)" >&2; exit 2; }
    fi
    sync_repo || exit 1
    "${SSH[@]}" "cd $VMDIR && /usr/bin/python3 scripts/make_megamod_keys_set.py --out $VMDIR/megamod_keys_test.als || exit 1
      pkill -f \"MacOS/Live\" ; for i in \$(seq 1 40); do pgrep -f \"MacOS/Live\" >/dev/null || break; sleep 0.5; done;
      rm -f \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashRecoveryInfo.cfg \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashDetection.cfg;
      open -a \"Ableton Live 12 Suite\" $VMDIR/megamod_keys_test.als &&
      for i in \$(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo \"bridge up\"; exit 0; }; sleep 2; done;
      echo \"bridge did not come up\" >&2; exit 1" ;;
  test)
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_megamod_keys_live.js" --port "$LOCAL_PORT" --ssh "admin@${IP}" ;;
  *)
    sed -n '2,16p' "$0"; exit 1 ;;
esac
