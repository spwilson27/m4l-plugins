#!/bin/zsh
# Better Sampler Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on
# the host). Builds and node tests stay on the host; this copies the repo into the VM and runs the rest
# there over ssh (login admin / admin, tart's default test-VM credentials). Modelled on vm_delayplus.sh.
#
#   scripts/vm_sampler.sh sync     rsync the repo to ~/ableton in the VM
#   scripts/vm_sampler.sh live     sync, rebuild in the VM, write sampler_test.als with VM paths
#                                  (scripts/make_sampler_set.py), (re)start Live in the VM on it, clear
#                                  crash recovery, wait for the MCP bridge (127.0.0.1:9877 in the VM)
#   scripts/vm_sampler.sh test     make a 1.5 s 220 Hz WAV in the VM, then run scripts/test_sampler_live.js
#                                  on the host through an ssh tunnel (local 19877 -> VM 9877)
#   scripts/vm_sampler.sh audio    sync, then run scripts/run_sampler_audio_tests.py in the VM
# Workflow: python3 scripts/build_sampler.py && node tests/test_sampler.js, then `live`, then `test`.
set -u
VM=macos-1
LOCAL_PORT=19877
WAV=/tmp/bs_test_220.wav
WAV2=/tmp/bs_test_short.wav
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
    sync_repo && "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/run_sampler_audio_tests.py' ;;
  live)
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/ableton && /usr/bin/python3 scripts/build_sampler.py >/dev/null &&
      /usr/bin/python3 scripts/make_sampler_set.py || exit 1
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      rm -f "$HOME"/Library/Preferences/Ableton/Live\ */CrashRecoveryInfo.cfg "$HOME"/Library/Preferences/Ableton/Live\ */CrashDetection.cfg;
      rm -rf "$HOME"/Library/Preferences/Ableton/Live\ */Undo;
      open -a "Ableton Live 12 Suite" "$HOME/ableton/sampler_test.als" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  test)
    "${SSH[@]}" "/usr/bin/python3 - <<'PY'
import wave, struct, math
for path, n in (('$WAV', 66150), ('$WAV2', 22050)):
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
    w.writeframes(b''.join(struct.pack('<h', int(20000 * math.sin(2 * math.pi * 220 * i / 44100))) for i in range(n)))
    w.close()
PY" || exit 1
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_sampler_live.js" --port "$LOCAL_PORT" --wav "$WAV" --wav2 "$WAV2" ;;
  *)
    sed -n '2,14p' "$0"; exit 1 ;;
esac
