#!/bin/zsh
# Shared, queueing lock for the tart VM's single Ableton Live (AGENTS.md 1a). Live runs only in the VM
# and restarting it ends every other session's set, so every host command that restarts Live or tests
# against the running set must hold this lock for its whole duration.
#
#   scripts/vm_live_lock.sh <label> -- <command...>   wait for the lock (prints the holder), run the command
#                                                     with M4L_LIVE_LOCK_HELD=1, release on exit
#   scripts/vm_live_lock.sh status                    holder, or "free"
#   scripts/vm_live_lock.sh break                     kill the holder's lock process (stale lock; loud)
# Env: M4L_LIVE_LOCK_WAIT=<seconds> max wait (default 1800); M4L_LIVE_SET=<set name> shown in the owner
#      file; M4L_LIVE_LOCK_HELD=1 (set for the command) makes a nested call run its command directly;
#      FORCE=1 runs the command WITHOUT the lock (loud warning), only to get past a stale lock.
# How: a long-lived ssh runs `lockf /tmp/m4l_live.lock` on the VM around a `cat` that reads the ssh
# stdin. When this script ends (Ctrl-C, error, kill -9) or the connection drops, cat sees EOF / is
# killed, lockf exits and the VM frees the lock. Owner file: /tmp/m4l_live.lock.owner (only meaningful
# while the lock is held). Lock order when both are needed: this lock first, then /tmp/m4l_real_max.lock.
# Standalone Max harness runs (`audio` / `max` / `ui`) do NOT take it (see AGENTS.md 1a).
set -u
VM=macos-1
export SSHPASS=admin
LOCKF=/tmp/m4l_live.lock
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=5 -o ServerAliveCountMax=3 "admin@${IP}")

holder() { "${SSH[@]}" "cat $LOCKF.owner 2>/dev/null" 2>/dev/null; }

case "${1:-}" in
  status)
    if "${SSH[@]}" "/usr/bin/lockf -s -t 0 $LOCKF true"; then echo "free"
    else echo "held by:"; holder; fi
    exit 0 ;;
  break)
    echo "!!! BREAKING the Live lock held by:" >&2; holder >&2
    "${SSH[@]}" "p=\$(sed -n 's/^vmpid=//p' $LOCKF.owner); [ -n \"\$p\" ] && { pkill -P \$p; kill \$p; } ; true"
    exit 0 ;;
  ""|-h|--help) sed -n '2,17p' "$0"; exit 1 ;;
esac

LABEL="$1"; shift
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "usage: vm_live_lock.sh <label> -- <command...>" >&2; exit 1; }
if [ -n "${M4L_LIVE_LOCK_HELD:-}" ]; then exec "$@"; fi
if [ "${FORCE:-0}" = "1" ]; then
  echo "!!! FORCE=1: running '$LABEL' WITHOUT the Live lock. Current holder (may be live!):" >&2
  holder >&2; export M4L_LIVE_LOCK_HELD=1; exec "$@"
fi

WAIT="${M4L_LIVE_LOCK_WAIT:-1800}"
SETNAME="${M4L_LIVE_SET:--}"
NOW="$(date '+%Y-%m-%d %H:%M:%S')"
# VM side: retry lockf in 3 s slices (exit 75 = busy); on success write the owner file, say LOCKED, hold
# until our stdin closes. Holder text is shown to the waiter every ~15 s.
REMOTE="end=\$((\$(date +%s) + $WAIT)); n=0
while :; do
  /usr/bin/lockf -s -t 3 $LOCKF sh -c 'printf \"label=%s\nhost_pid=%s\nhost=%s\nstarted=%s\nset=%s\nvmpid=%s\n\" \"\$1\" \"\$2\" \"\$3\" \"\$4\" \"\$5\" \$\$ > $LOCKF.owner; echo LOCKED; cat >/dev/null; rm -f $LOCKF.owner' sh '$LABEL' $$ \"$(hostname -s)\" '$NOW' '$SETNAME'
  rc=\$?; [ \$rc -ne 75 ] && exit \$rc
  [ \$(date +%s) -ge \$end ] && { echo TIMEOUT; exit 75; }
  n=\$((n+1)); [ \$((n % 5)) -eq 1 ] && { echo WAITING; cat $LOCKF.owner 2>/dev/null | tr '\n' ' '; echo; }
done"
coproc "${SSH[@]}" "$REMOTE"
HOLD=$!
cleanup() { kill $HOLD 2>/dev/null; }
trap 'cleanup' EXIT
trap 'cleanup; exit 130' INT TERM HUP
while IFS= read -r -u p line; do
  case "$line" in
    LOCKED) break ;;
    TIMEOUT) echo "[$LABEL] timed out after ${WAIT}s waiting for the Live lock" >&2; exit 75 ;;
    WAITING) echo "[$LABEL] Live lock busy, waiting. Holder:" >&2 ;;
    *) [ -n "$line" ] && echo "[$LABEL]   $line" >&2 ;;
  esac
done
kill -0 $HOLD 2>/dev/null || { echo "[$LABEL] lock connection lost" >&2; exit 1; }
echo "[$LABEL] Live lock acquired" >&2
export M4L_LIVE_LOCK_HELD=1
"$@"
rc=$?
echo "[$LABEL] Live lock released (rc=$rc)" >&2
exit $rc
