#!/bin/zsh
# Spectral Split suite (Transient Split, Loud Split, Harmonic Split, Freq Split) Max tests inside the tart VM macos-1
# (AGENTS.md 1a: never run Max or Live on the host). Builds and node tests stay on the host; this copies the repo into the
# VM and runs the real-Max runner there over ssh (login admin / admin, tart's default test-VM credentials). Several
# devices may run at the same time: every Max launch inside the VM goes through scripts/max_harness.py, which serializes
# them on the machine-wide lock /tmp/m4l_real_max.lock.
#
# Slugs: transplit (Transient Split), loudsplit (Loud Split), harmsplit (Harmonic Split), freqsplit (Freq Split).
#
#   scripts/vm_spectral.sh sync                       rsync the repo to ~/ableton in the VM
#   scripts/vm_spectral.sh audio <slug> [case ...]    sync, then run scripts/run_<slug>_audio_tests.py in the VM
#                                                     (optional case names restrict the run)
#   scripts/vm_spectral.sh ui <slug> [args ...]       sync, then run scripts/run_<slug>_ui_tests.py in the VM (if the device has one)
#   scripts/vm_spectral.sh run <script.py> [args ...] sync, then run any scripts/<script.py> in the VM
#   scripts/vm_spectral.sh live                       sync, rebuild all four devices in the VM, write spectral_test.als there
#                                                     (scripts/make_spectral_set.py: one audio track per device holding its rack, one chain
#                                                     per output channel, + the MCP Bridge on Main), (re)start the VM's Live on it, clear
#                                                     crash recovery, wait for the bridge. Takes the VM-wide Live lock (scripts/vm_live_lock.sh).
#   scripts/vm_spectral.sh test [slug ...]            scripts/test_spectral_live.js on the host through an ssh tunnel (local 19880 -> VM 9877)
#   scripts/vm_spectral.sh livetest [slug ...]        live + test under ONE hold of the Live lock
#   scripts/vm_spectral.sh status                     VM ip and the Max / Live processes running there
#   scripts/vm_spectral.sh shot                       screenshot of the VM screen, copied to /tmp/vm_spectral_shot.png
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ --exclude 'tests/out' \
    --exclude '*_test.als' -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:ableton/"
}

remote_py() {  # remote_py <script under scripts/> [args ...]
  local script="$1"; shift
  local args=""
  for a in "$@"; do args+=" ${(q)a}"; done
  "${SSH[@]}" "cd ~/ableton && /usr/bin/python3 scripts/${script}${args}"
}

LOCAL_PORT=19880
# Live is shared by every session: live / test / livetest hold the VM-wide Live lock (nested calls see M4L_LIVE_LOCK_HELD=1).
case "${1:-}" in live|test|livetest) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=spectral_test.als exec "$ROOT/scripts/vm_live_lock.sh" spectral -- "$0" "$@" ;; esac

case "${1:-}" in
  livetest)
    shift; "$0" live && "$0" test "$@" ;;
  live)
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/ableton && for s in transplit loudsplit harmsplit freqsplit; do /usr/bin/python3 scripts/build_$s.py >/dev/null || exit 1; done &&
      /usr/bin/python3 scripts/make_spectral_set.py || exit 1
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      rm -f "$HOME"/Library/Preferences/Ableton/Live\ */CrashRecoveryInfo.cfg "$HOME"/Library/Preferences/Ableton/Live\ */CrashDetection.cfg;
      rm -rf "$HOME"/Library/Preferences/Ableton/Live\ */Undo;
      open -a "Ableton Live 12 Suite" "$HOME/ableton/spectral_test.als" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  test)
    shift
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_spectral_live.js" --port "$LOCAL_PORT" "$@" ;;
  sync)
    sync_repo ;;
  audio)
    [ -n "${2:-}" ] || { sed -n '2,/^set -u/p' "$0"; exit 1; }
    slug="$2"; shift 2
    sync_repo && remote_py "run_${slug}_audio_tests.py" "$@" ;;
  ui)
    [ -n "${2:-}" ] || { sed -n '2,/^set -u/p' "$0"; exit 1; }
    slug="$2"; shift 2
    sync_repo && remote_py "run_${slug}_ui_tests.py" "$@" ;;
  run)
    [ -n "${2:-}" ] || { sed -n '2,/^set -u/p' "$0"; exit 1; }
    script="$2"; shift 2
    sync_repo && remote_py "$script" "$@" ;;
  status)
    echo "VM $VM at $IP"
    "${SSH[@]}" 'pgrep -fl "MacOS/Max|MacOS/Live" || echo "no Max / Live running"' ;;
  shot)
    "${SSH[@]}" 'screencapture -x /tmp/vm_spectral_shot.png' && sshpass -e scp -o StrictHostKeyChecking=accept-new "admin@${IP}:/tmp/vm_spectral_shot.png" /tmp/vm_spectral_shot.png && echo /tmp/vm_spectral_shot.png ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
