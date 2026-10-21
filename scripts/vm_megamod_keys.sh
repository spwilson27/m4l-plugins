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
#   scripts/vm_megamod_keys.sh reload  load order in Live: duplicate_track clones a prepared device (scripts/test_megamod_reload_live.js)
#   scripts/vm_megamod_keys.sh auto   run scripts/test_megamod_auto_live.js (automatable parameters + depth) on the host
#                                     through the same tunnel (after `live`)
#   scripts/vm_megamod_keys.sh measure [device.amxd]  time the load of the set in the VM (3 runs); replaces the synced device first
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

# The bridge normally listens on 9877, but a stale (stuck exiting) Live tree can keep that port: the bridge then takes 9878+ (AGENTS.md 13).
# rport prints the first port in 9877..9884 whose /health answers (run in the VM); tunnels forward the local port to it.
RPORT_CMD='for p in 9877 9878 9879 9880 9881 9882 9883 9884; do curl -s -m 1 http://127.0.0.1:$p/health | grep -q "\"ok\":true" && { echo $p; break; }; done'
tunnel() {
  RPORT=""
  for i in $(seq 1 15); do  # the bridge can answer once and restart (a reloaded device shuts the stale listener down)
    sleep 2
    RPORT="$("${SSH[@]}" "$RPORT_CMD")"
    [ -n "$RPORT" ] && break
  done
  [ -n "$RPORT" ] || { echo "no bridge answers in the VM (9877..9884)" >&2; return 1; }
  "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:${RPORT}" &
  TUNNEL=$!
  local ok=0
  for i in $(seq 1 80); do curl -sf -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && { ok=1; break; }; sleep 0.5; done
  echo "bridge tunnel: local ${LOCAL_PORT} -> VM ${RPORT} (answers: ${ok}, after ${i} tries)"
  [ "$ok" = 1 ] || { kill $TUNNEL 2>/dev/null; return 1; }
}

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
      pkill -x Live ; for i in \$(seq 1 60); do pgrep -x Live >/dev/null || break; sleep 0.5; done; pgrep -x Live >/dev/null && pkill -9 -x Live;
      rm -f \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashRecoveryInfo.cfg \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashDetection.cfg;
      if ps -axo command | grep -qx \"(Live)\"; then open -n -a \"Ableton Live 12 Suite\" $VMDIR/megamod_keys_test.als; else open -a \"Ableton Live 12 Suite\" $VMDIR/megamod_keys_test.als; fi &&
      for i in \$(seq 1 90); do for p in 9877 9878 9879 9880; do curl -s -m 1 http://127.0.0.1:\$p/health >/dev/null && { echo \"bridge up on \$p\"; exit 0; }; done; sleep 2; done;
      echo \"bridge did not come up\" >&2; exit 1" ;;
  test)
    tunnel || exit 1
    trap 'kill $TUNNEL 2>/dev/null' EXIT   # (not inside tunnel(): zsh runs a function's EXIT trap when the function returns)
    node "$ROOT/scripts/test_megamod_keys_live.js" --port "$LOCAL_PORT" --ssh "admin@${IP}" ;;
  measure)
    # usage: measure [device.amxd] -- syncs, optionally swaps in another build of the device, times the load (3 runs) in the VM
    sync_repo || exit 1
    if [ -n "${2:-}" ]; then sshpass -e scp "$2" "admin@${IP}:Software/ableton-mmnames/devices/Mega Modulator.amxd" || exit 1; fi
    "${SSH[@]}" "cd $VMDIR && /usr/bin/python3 scripts/make_megamod_keys_set.py --out $VMDIR/megamod_keys_test.als >/dev/null && /usr/bin/python3 scripts/measure_megamod_load.py --runs ${RUNS:-3}" ;;
  reload)
    # load order in real Live (run after `live`): prepare a device (LFO, parameters moved through the LOM, a mapping with a Depth), then
    # `duplicate_track` clones it through Live's stored state like a Set load and the clone's adoption of Live's values is checked.
    # (Saving a Set through the UI was not automatable: the File > Save menu click wrote nothing.)
    tunnel || exit 1
    trap 'kill $TUNNEL 2>/dev/null' EXIT   # (not inside tunnel(): zsh runs a function's EXIT trap when the function returns)
    node "$ROOT/scripts/test_megamod_reload_live.js" --port "$LOCAL_PORT" ;;
  probe)
    tunnel || exit 1
    trap 'kill $TUNNEL 2>/dev/null' EXIT   # (not inside tunnel(): zsh runs a function's EXIT trap when the function returns)
    node "$ROOT/scripts/probe_megamod_rename_live.js" --port "$LOCAL_PORT" ;;
  auto)
    tunnel || exit 1
    trap 'kill $TUNNEL 2>/dev/null' EXIT   # (not inside tunnel(): zsh runs a function's EXIT trap when the function returns)
    node "$ROOT/scripts/test_megamod_auto_live.js" --port "$LOCAL_PORT" ;;
  run)
    # run <script.js> [args]: any bridge script of this device on the host through the tunnel (gets --port and --ssh)
    tunnel || exit 1
    trap 'kill $TUNNEL 2>/dev/null' EXIT   # (not inside tunnel(): zsh runs a function's EXIT trap when the function returns)
    sc="$2"; shift 2; node "$sc" --port "$LOCAL_PORT" --ssh "admin@${IP}" "$@" ;;
  faces)
    # parameter faces in real Live (run after `live`): scripts/test_megamod_faces_live.js (real left drag / right click in the VM)
    tunnel || exit 1
    trap 'kill $TUNNEL 2>/dev/null' EXIT   # (not inside tunnel(): zsh runs a function's EXIT trap when the function returns)
    node "$ROOT/scripts/test_megamod_faces_live.js" --port "$LOCAL_PORT" --ssh "admin@${IP}" ;;
  *)
    sed -n '2,19p' "$0"; exit 1 ;;
esac
