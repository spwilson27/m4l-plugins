#!/bin/zsh
# Reverb+ Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on the
# host). Builds and node tests stay on the host; this copies the repo into the VM and runs the rest
# there over ssh (login admin / admin, tart's default test-VM credentials).
#
#   scripts/vm_reverbplus.sh sync     rsync the repo to ~/ableton in the VM
#   scripts/vm_reverbplus.sh audio [case ...]   sync, then run scripts/run_reverbplus_audio_tests.py in the VM
#   scripts/vm_reverbplus.sh live     sync, rebuild in the VM (the test set must point at VM paths),
#                                    (re)start Live in the VM with reverbplus_test.als and wait for its
#                                    MCP bridge. Live is the only instance there: no dialog, relaunch
#                                    freely after every build (crash-recovery files are cleared after
#                                    the quit, or Live stops at a "recover your work?" dialog).
#   scripts/vm_reverbplus.sh run      live + test under ONE hold of the Live lock (scripts/vm_live_lock.sh); live and
#                                 test alone also take it. `scripts/vm_live_lock.sh status` shows the holder.
#   scripts/vm_reverbplus.sh test     run scripts/test_reverbplus_live.js (with --ssh: real OS clicks / file drags) on the host through an ssh
#                                    tunnel (local 19880 -> VM 127.0.0.1:9877, the bridge port)
set -u
VM=macos-1
LOCAL_PORT=19880
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
case "${1:-}" in live|test|run) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=reverbplus_test.als exec "$ROOT/scripts/vm_live_lock.sh" reverbplus -- "$0" "$@" ;; esac

case "${1:-}" in
  run)
    "$0" live && "$0" test ;;
  sync)
    sync_repo ;;
  audio)
    sync_repo && "${SSH[@]}" "cd ~/ableton && /usr/bin/python3 scripts/run_reverbplus_audio_tests.py ${*:2}" ;;
  live)
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/build_reverbplus.py >/dev/null &&
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      rm -f "$HOME"/Library/Preferences/Ableton/Live\ */CrashRecoveryInfo.cfg "$HOME"/Library/Preferences/Ableton/Live\ */CrashDetection.cfg;
      open -a "Ableton Live 12 Suite" "$HOME/ableton/reverbplus_test.als" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  test)
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    # the shimmer test's tone: a 0.4 s 220 Hz sine burst, then silence (6 s loop), made in the VM
    "${SSH[@]}" "/usr/bin/python3 - <<'PYEOF'
import wave, struct, math
w = wave.open('/tmp/rp_tone_220.wav', 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
n = 44100 * 6
w.writeframes(b''.join(struct.pack('<h', int(14000 * math.sin(2 * math.pi * 220 * i / 44100)) if i < 17640 else 0) for i in range(n)))
w.close()
PYEOF"
    node "$ROOT/scripts/test_reverbplus_live.js" --port "$LOCAL_PORT" --ssh "admin@${IP}" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
