#!/bin/zsh
# Envelope Trigger Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live
# on the host). Builds and node tests stay on the host; this copies the repo into the VM and runs
# the rest there over ssh (login admin / admin, tart's default test-VM credentials).
#
#   scripts/vm_envtrig.sh sync    rsync the repo to ~/ableton in the VM
#   scripts/vm_envtrig.sh audio   sync, then run scripts/run_envtrig_audio_tests.py in the VM
#   scripts/vm_envtrig.sh ui      sync, then run scripts/run_envtrig_ui_tests.py in the VM
#   scripts/vm_envtrig.sh live    sync, rebuild in the VM, write envtrig_test.als there (MCP Bridge on
#                                 Main, track "Envelope Trigger" with two instances in one rack chain,
#                                 referenced by VM paths) and (re)start the VM's Live with it, then
#                                 wait for the bridge. Killing Live leaves crash-recovery files whose
#                                 "Live unexpectedly quit" dialog blocks the next launch, so they are
#                                 removed first. Restarting Live ends any other Live session in
#                                 the VM: check `pgrep -fl MacOS/Live` there first when sharing it.
#   scripts/vm_envtrig.sh run      live + test under ONE hold of the Live lock (scripts/vm_live_lock.sh); live and
#                                 test alone also take it. `scripts/vm_live_lock.sh status` shows the holder.
#   scripts/vm_envtrig.sh test    run scripts/test_envtrig_live.js on the host through an ssh tunnel
#                                 (local 19878 -> VM 127.0.0.1:9877, the bridge port)
set -u
VM=macos-1
LOCAL_PORT=19878
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ \
    -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:ableton/"
}

# Live is shared by every session: live / test / run hold the VM-wide Live lock (vm_live_lock.sh; nested
# calls see M4L_LIVE_LOCK_HELD=1 and run directly). `run` = lock -> live -> test -> release.
case "${1:-}" in live|test|run) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=envtrig_test.als exec "$ROOT/scripts/vm_live_lock.sh" envtrig -- "$0" "$@" ;; esac

case "${1:-}" in
  run)
    "$0" live && "$0" test ;;
  sync)
    sync_repo ;;
  audio)
    sync_repo && "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/run_envtrig_audio_tests.py' ;;
  ui)
    sync_repo && "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/run_envtrig_ui_tests.py' ;;
  live)
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/build_envtrig.py >/dev/null &&
      DEV="$HOME/ableton/devices/Envelope Trigger.amxd" &&
      /usr/bin/python3 scripts/make_delayplus_sets.py --start "$DEV" --end "$DEV" --name "Envelope Trigger" \
        --track "Envelope Trigger::$DEV" --als "$HOME/ableton/envtrig_test.als" >/dev/null &&
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      rm -f "$HOME"/Library/Preferences/Ableton/Live\ */CrashRecoveryInfo.cfg "$HOME"/Library/Preferences/Ableton/Live\ */CrashDetection.cfg;
      open -a "Ableton Live 12 Suite" "$HOME/ableton/envtrig_test.als" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  test)
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_envtrig_live.js" --port "$LOCAL_PORT" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
