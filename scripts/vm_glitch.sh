#!/bin/zsh
# Glitch Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on the host). Builds and node tests
# stay on the host; this copies the repo into the VM and runs the rest there over ssh. Modelled on vm_sampler.sh.
# Key auth first (ssh -o BatchMode=yes admin@<ip>), sshpass admin / admin (tart's default test-VM login) as the fallback.
#
#   scripts/vm_glitch.sh sync     rsync the repo to ~/Software/ableton-glitch in the VM (GLITCH_VM_DIR overrides)
#   scripts/vm_glitch.sh audio    sync, then scripts/run_glitch_audio_tests.py in the VM (standalone Max harness, no Live lock)
#   scripts/vm_glitch.sh live     sync, rebuild in the VM, write glitch_test.als with VM paths (scripts/make_glitch_set.py),
#                                 (re)start Live in the VM on it, clear crash recovery, wait for the MCP bridge
#   scripts/vm_glitch.sh test     make a 1.5 s test WAV in the VM, then run scripts/test_glitch_live.js on the host through an
#                                 ssh tunnel (local 19880 -> VM 9877)
#   scripts/vm_glitch.sh run      live + test under ONE hold of the Live lock (scripts/vm_live_lock.sh); live and test alone
#                                 also take it. `scripts/vm_live_lock.sh status` shows the holder.
# Workflow: python3 scripts/build_glitch.py && node tests/test_glitch.js, then `run`.
set -u
VM=macos-1
LOCAL_PORT=19880
VM_DIR="${GLITCH_VM_DIR:-Software/ableton-glitch}"
WAV=/tmp/glitch_test_220.wav
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "admin@${IP}")
RSYNC_E="ssh -o BatchMode=yes"
if ! "${SSH[@]}" true 2>/dev/null; then
  SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")
  RSYNC_E="sshpass -e ssh"
fi

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ \
    -e "$RSYNC_E" "$ROOT/" "admin@${IP}:${VM_DIR}/"
}

# Live is shared by every session: live / test / run hold the VM-wide Live lock (nested calls run directly)
case "${1:-}" in live|test|run) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=glitch_test.als exec "$ROOT/scripts/vm_live_lock.sh" glitch -- "$0" "$@" ;; esac

case "${1:-}" in
  run)
    "$0" live && "$0" test ;;
  sync)
    sync_repo ;;
  audio)
    sync_repo && "${SSH[@]}" "cd ~/${VM_DIR} && /usr/bin/python3 scripts/run_glitch_audio_tests.py" ;;
  live)
    sync_repo || exit 1
    "${SSH[@]}" "cd ~/${VM_DIR} && /usr/bin/python3 scripts/make_glitch_set.py || exit 1
      pkill -f 'MacOS/Live' ; for i in \$(seq 1 40); do pgrep -f 'MacOS/Live' >/dev/null || break; sleep 0.5; done;
      rm -f \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashRecoveryInfo.cfg \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashDetection.cfg;
      rm -rf \"\$HOME\"/Library/Preferences/Ableton/Live\\ */Undo;
      rm -f /tmp/glitch_core_*.gendsp /tmp/glitch_[abcs]_*.gendsp;
      open -a 'Ableton Live 12 Suite' \"\$HOME/${VM_DIR}/glitch_test.als\" &&
      for i in \$(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo 'bridge up'; exit 0; }; sleep 2; done;
      echo 'bridge did not come up' >&2; exit 1" ;;
  test)
    "${SSH[@]}" "/usr/bin/python3 - <<'PY'
import wave, struct, math
w = wave.open('$WAV', 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
w.writeframes(b''.join(struct.pack('<h', int(9000 * math.sin(2 * math.pi * 220 * i / 44100) + 5000 * math.sin(2 * math.pi * 1760 * i / 44100))) for i in range(66150)))
w.close()
PY" || exit 1
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_glitch_live.js" --port "$LOCAL_PORT" --wav "$WAV" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
