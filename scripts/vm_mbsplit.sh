#!/bin/zsh
# Multiband Split tests inside the tart VM macos-1 (AGENTS.md 1a). Own checkout ~/ableton-mbsplit (rsync --delete, so never
# point it at another device's directory).
#   scripts/vm_mbsplit.sh audio [case ...]      sync, run scripts/run_mbsplit_audio_tests.py
#   scripts/vm_mbsplit.sh run <script.py> [args] sync, run any scripts/<script.py>
#   scripts/vm_mbsplit.sh live                   sync, rebuild, write mbsplit_test.als, restart Live on it (VM Live lock)
#   scripts/vm_mbsplit.sh test                   scripts/test_mbsplit_live.js through an ssh tunnel (local 19881 -> VM 9877)
#   scripts/vm_mbsplit.sh livetest               live + test under one hold of the Live lock
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton-mbsplit; DIR="$VMREL"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")
sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ --exclude 'tests/out' \
    --exclude '*_test.als' -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${DIR}/"
}
remote_py() { local script="$1"; shift; local args=""; for a in "$@"; do args+=" ${(q)a}"; done
  "${SSH[@]}" "cd ~/${DIR} && /usr/bin/python3 scripts/${script}${args}"; }
LOCAL_PORT=19881
case "${1:-}" in live|test|livetest) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || exec "$ROOT/scripts/vm_live_lock.sh" mbsplit -- "$0" "$@" ;; esac
case "${1:-}" in
  livetest) shift; "$0" live && "$0" test "$@" ;;
  live)
    host_build mbsplit || exit 1
    sync_repo || exit 1
    "${SSH[@]}" "cd ~/${DIR} && /usr/bin/python3 scripts/make_mbsplit_set.py || exit 1
      pkill -f 'MacOS/Live' ; for i in \$(seq 1 40); do pgrep -f 'MacOS/Live' >/dev/null || break; sleep 0.5; done;
      rm -f \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashRecoveryInfo.cfg \"\$HOME\"/Library/Preferences/Ableton/Live\\ */CrashDetection.cfg;
      rm -rf \"\$HOME\"/Library/Preferences/Ableton/Live\\ */Undo;
      open -a 'Ableton Live 12 Suite' \"\$HOME/${DIR}/mbsplit_test.als\" &&
      for i in \$(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo 'bridge up'; exit 0; }; sleep 2; done;
      echo 'bridge did not come up' >&2; exit 1" ;;
  test)
    shift
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_mbsplit_live.js" --port "$LOCAL_PORT" "$@" ;;
  audio) shift; sync_repo && remote_py run_mbsplit_audio_tests.py "$@" ;;
  run) [ -n "${2:-}" ] || { sed -n '2,/^set -u/p' "$0"; exit 1; }; script="$2"; shift 2; sync_repo && remote_py "$script" "$@" ;;
  sync) sync_repo ;;
  *) sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
