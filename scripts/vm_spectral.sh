#!/bin/zsh
# Spectral Split suite (Transient Split, Loud Split, Harmonic Split, Freq Split) Max tests inside the tart VM macos-1
# (AGENTS.md 1a: never run Max or Live on the host). Builds and node tests stay on the host; this copies the repo into the
# VM and runs the real-Max runner there over ssh (login admin / admin, tart's default test-VM credentials). Several
# devices may run at the same time: every Max launch inside the VM goes through scripts/max_harness.py, which serializes
# them on the machine-wide lock /tmp/m4l_real_max.lock.
#
# Slugs: transplit (Transient Split), loudsplit (Loud Split), harmsplit (Harmonic Split), freqsplit (Freq Split).
#
#   scripts/vm_spectral.sh sync                       rsync the repo to ~/ableton-spectral in the VM (SPECTRAL_VM_DIR overrides)
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
#   scripts/vm_spectral.sh probelive | probe | probetest   the rack-processing probe (tests/spectral_probe, scripts/test_spectral_probe_live.js)
#   scripts/vm_spectral.sh sumlive | sum | sumtest         the rack-sum check (Sum Probes around a Transient Split rack, scripts/test_spectral_sum_live.js)
#   scripts/vm_spectral.sh status                     VM ip and the Max / Live processes running there
#   scripts/vm_spectral.sh shot                       screenshot of the VM screen, copied to /tmp/vm_spectral_shot.png
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${SPECTRAL_VM_DIR:-ableton-spectral}"   # own VM checkout (rsync --delete): never share ~/ableton with other sessions
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ --exclude 'tests/out' \
    --exclude '*_test.als' -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${DIR}/"
}

remote_py() {  # remote_py <script under scripts/> [args ...]
  local script="$1"; shift
  local args=""
  for a in "$@"; do args+=" ${(q)a}"; done
  "${SSH[@]}" "cd ~/${DIR} && PYTHONUNBUFFERED=1 /usr/bin/python3 scripts/${script}${args}"
}

LOCAL_PORT=19880
# Live is shared by every session: live / test / livetest hold the VM-wide Live lock (nested calls see M4L_LIVE_LOCK_HELD=1).
case "${1:-}" in live|probelive|probe|sumlive|sum|test|livetest|probetest|sumtest) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=spectral_test.als exec "$ROOT/scripts/vm_live_lock.sh" spectral -- "$0" "$@" ;; esac

case "${1:-}" in
  livetest)
    shift; "$0" live && "$0" test "$@" ;;
  probetest)
    shift; "$0" probelive && "$0" probe "$@" ;;
  sumtest)
    shift; if [ "${1:-}" = old ]; then shift; "$0" sumlive old && "$0" sum "$@"; else "$0" sumlive && "$0" sum "$@"; fi ;;
  live|probelive|sumlive)
    if [ "$1" = sumlive ] && [ "${2:-}" = old ]; then   # the rack-sum check against the device as committed (HEAD), to show the hop-phase bug
      mkdir -p "$ROOT/tests/spectral_probe/old"   # fixture: the pre-rack device (committed with the framework); extracted from HEAD only if it is missing
      [ -s "$ROOT/tests/spectral_probe/old/Transient Split.amxd" ] || git -C "$ROOT" show 'HEAD:devices/Transient Split.amxd' > "$ROOT/tests/spectral_probe/old/Transient Split.amxd" || exit 1
    fi
    sync_repo || exit 1
    if [ "$1" = sumlive ]; then
      if [ "${2:-}" = old ]; then
        BUILD='/usr/bin/python3 scripts/build_spectral_probe.py >/dev/null && /usr/bin/python3 scripts/make_spectral_sum_set.py --devices tests/spectral_probe/old'
      else
        BUILD='/usr/bin/python3 scripts/build_spectral_probe.py >/dev/null && /usr/bin/python3 scripts/build_transplit.py >/dev/null && /usr/bin/python3 scripts/make_spectral_sum_set.py'
      fi
      SETF=spectral_sum_test.als
    elif [ "$1" = probelive ]; then
      BUILD='/usr/bin/python3 scripts/build_spectral_probe.py >/dev/null && /usr/bin/python3 scripts/make_spectral_probe_set.py'; SETF=spectral_probe_test.als
    else
      BUILD='for s in transplit loudsplit harmsplit freqsplit; do /usr/bin/python3 scripts/build_$s.py >/dev/null || exit 1; done && /usr/bin/python3 scripts/make_spectral_set.py'; SETF=spectral_test.als
    fi
    "${SSH[@]}" "cd ~/${DIR}"' && '"$BUILD"' || exit 1
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      rm -f "$HOME"/Library/Preferences/Ableton/Live\ */CrashRecoveryInfo.cfg "$HOME"/Library/Preferences/Ableton/Live\ */CrashDetection.cfg;
      rm -rf "$HOME"/Library/Preferences/Ableton/Live\ */Undo;
      open -a "Ableton Live 12 Suite" "$PWD/'"$SETF"'" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  probe|sum)
    what="$1"; shift
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    if [ "$what" = sum ]; then node "$ROOT/scripts/test_spectral_sum_live.js" --port "$LOCAL_PORT" "$@"; else node "$ROOT/scripts/test_spectral_probe_live.js" --port "$LOCAL_PORT" "$@"; fi ;;
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
