#!/bin/zsh
# Shared, queueing lock for the tart VM's single Ableton Live (AGENTS.md 1a). Live runs only in the VM
# and restarting it ends every other session's set, so every host command that restarts Live or tests
# against the running set must hold this lock for its whole duration. HOLD IT ONLY FOR A REAL RUN.
#
#   scripts/vm_live_lock.sh <label> -- <command...>   wait for the lock (prints the holder), run the command
#                                                     with M4L_LIVE_LOCK_HELD=1, release on exit
#   scripts/vm_live_lock.sh batch <label> [-f file] ['cmd 1' 'cmd 2' ...]
#                                                     ONE hold for several commands (each run with zsh -c, from
#                                                     the args and/or one per line of <file>, # = comment);
#                                                     runs them all, prints a per-step summary, rc 1 if any failed
#   scripts/vm_live_lock.sh status | queue            holder (label, set, held for, max hold) and the waiters
#   scripts/vm_live_lock.sh break                     kill the holder's lock process (stale lock; loud)
#   scripts/vm_live_lock.sh selftest                  exercises acquire / max hold / idle refusal / batch / queue
# Rules (enforced):
#   * max hold: a command (each batch step) is killed after M4L_LIVE_LOCK_MAX_HOLD s (default 600) and a
#     whole batch after M4L_LIVE_LOCK_MAX_TOTAL s (default 1800); the lock is then released with a message.
#     Raise them only for a run that really drives Live that long (e.g. a drop stress), never to park.
#   * no idle holds: a command that is only `sleep` / `read` / `cat` / `wait` (also inside `sh -c '...'`,
#     or any `sleep` of 100 s or more) is refused, and a hold whose running processes are all `sleep`s that
#     have been sleeping M4L_LIVE_LOCK_IDLE s (default 90) is broken. Wait for something with a real
#     command (a test), not by holding the lock.
# Env: M4L_LIVE_LOCK_WAIT=<seconds> max wait (default 1800); M4L_LIVE_SET=<set name> shown in the owner
#      file; M4L_LIVE_LOCK_HELD=1 (set for the command) makes a nested call run its command directly;
#      FORCE=1 runs the command WITHOUT the lock (loud warning), only to get past a stale lock.
# How: a long-lived ssh runs `lockf /tmp/m4l_live.lock` on the VM around a `cat` that reads the ssh
# stdin (with a perl alarm at max hold + 120 s as a backstop). When this script ends (Ctrl-C, error,
# kill -9) or the connection drops, cat sees EOF / is killed, lockf exits and the VM frees the lock.
# Owner file: /tmp/m4l_live.lock.owner (only meaningful while held); waiters: /tmp/m4l_live.queue/<pid>.
# Lock order when both are needed: this lock first, then /tmp/m4l_real_max.lock. Standalone Max harness
# runs (`audio` / `max` / `ui`) do NOT take it (see AGENTS.md 1a).
set -u
SELF="${0:A}"  # $0 inside a zsh function is the function name
VM=macos-1
export SSHPASS=admin
LOCKF=/tmp/m4l_live.lock
QDIR=/tmp/m4l_live.queue
MAXHOLD="${M4L_LIVE_LOCK_MAX_HOLD:-600}"
MAXTOTAL="${M4L_LIVE_LOCK_MAX_TOTAL:-1800}"
IDLE="${M4L_LIVE_LOCK_IDLE:-90}"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=5 -o ServerAliveCountMax=3 "admin@${IP}")

HOLD=""; CMDPID=""
trap '[ -n "$HOLD" ] && kill $HOLD 2>/dev/null' EXIT
trap '[ -n "$CMDPID" ] && kill_tree $CMDPID; [ -n "$HOLD" ] && kill $HOLD 2>/dev/null; exit 130' INT TERM HUP

holder() { "${SSH[@]}" "cat $LOCKF.owner 2>/dev/null" 2>/dev/null; }

# holder + waiters, ages computed in the VM (one clock)
show_status() {
  "${SSH[@]}" "now=\$(date +%s)
if /usr/bin/lockf -s -t 0 $LOCKF true; then echo 'Live lock: free'
else
  o=$LOCKF.owner
  if [ -f \$o ]; then
    g() { sed -n \"s/^\$1=//p\" \$o; }
    ep=\$(g epoch); mh=\$(g maxhold)
    echo \"Live lock: HELD by '\$(g label)' (set \$(g set), host pid \$(g host_pid), since \$(g started))\"
    [ -n \"\$ep\" ] && echo \"  held for \$((now - ep)) s, max hold \${mh:-?} s\"
  else echo 'Live lock: held (no owner file)'; fi
fi
n=0
for f in \$(ls -tr $QDIR 2>/dev/null); do
  q=$QDIR/\$f; p=\$(sed -n 's/^vmpid=//p' \$q)
  if [ -n \"\$p\" ] && kill -0 \$p 2>/dev/null; then
    n=\$((n+1)); echo \"  waiting #\$n: '\$(sed -n 's/^label=//p' \$q)' (host pid \$(sed -n 's/^host_pid=//p' \$q)) for \$((now - \$(sed -n 's/^epoch=//p' \$q))) s\"
  else rm -f \$q; fi
done
[ \$n -eq 0 ] && echo '  nobody waiting'; true"
}

# A command that only waits must not hold the lock. Args: the command words.
idle_cmd() {
  local first="${1:t}" s
  case "$first" in sleep|read|cat|wait|true|tail) return 0 ;; esac
  case "$first" in sh|bash|zsh)
    [ "${2:-}" = "-c" ] || return 1
    s="${3:-}"
    print -r -- "$s" | grep -qE '(^|[;&|[:space:]])sleep[[:space:]]+[0-9]{3,}' && return 0
    print -r -- "$s" | grep -qE '^[[:space:]]*((sleep|read|cat|wait|true)([[:space:]]+[^;&|]*)?[[:space:]]*(;|&&|\|\||$)[[:space:]]*)+$' && return 0 ;;
  esac
  return 1
}

# pid comm elapsed-seconds of every descendant of $1 that has no children (leaves)
leaves() {
  ps -axo pid=,ppid=,etime=,comm= | awk -v root="$1" '
    { pid[NR]=$1; pp[$1]=$2; et[$1]=$3; c=$4; for (i=5;i<=NF;i++) c=c" "$i; cm[$1]=c; kids[$2]++ }
    function secs(e,  d,a,n,s) { d=0; if (index(e,"-")) { split(e,a,"-"); d=a[1]; e=a[2] } n=split(e,a,":"); s=0
      for (i2=1;i2<=n;i2++) s=s*60+a[i2]; return d*86400+s }
    function under(p) { while (p != "" && p > 1) { if (p == root) return 1; p = pp[p] } return 0 }
    END { for (i=1;i<=NR;i++) { p=pid[i]; if (p != root && under(pp[p]) && !kids[p]) { n=split(cm[p],b,"/"); print p, b[n], secs(et[p]) } } }'
}

kill_tree() {  # TERM the tree under $1 (children first), then KILL what is left
  local p kids
  kids=($(pgrep -P $1 2>/dev/null))
  for p in $kids; do kill_tree $p; done
  kill -TERM $1 2>/dev/null
}
kill_tree9() { local p; for p in $(pgrep -P $1 2>/dev/null); do kill_tree9 $p; done; kill -KILL $1 2>/dev/null; }

# Run "$@" under the watchdog: killed at its deadline (epoch s) or when it only sleeps. Prints why.
WHY=""; CMDPID=""
run_watched() {
  local deadline=$1; shift
  WHY=""
  "$@" &
  CMDPID=$!
  local pid=$CMDPID now l n=0
  while kill -0 $pid 2>/dev/null; do
    sleep 1; n=$((n + 1))
    now=$(date +%s)
    if [ $now -ge $deadline ]; then WHY="max hold reached"; break; fi
    if [ $((n % 5)) -eq 0 ]; then
      l="$(leaves $pid)"
      # idle = every running leaf process is a `sleep` that has been sleeping IDLE s or more
      if [ -n "$l" ] && print -r -- "$l" | awk -v lim="$IDLE" '!($2 == "sleep" && $3 >= lim) { bad = 1 } END { exit bad }'; then
        WHY="idle: only sleeping for ${IDLE}+ s ($(print -r -- "$l" | tr '\n' ' '))"; break
      fi
    fi
  done
  if [ -n "$WHY" ]; then
    echo "!!! [$LABEL] $WHY: killing the command and releasing the Live lock (AGENTS.md 1a: hold only for a real run;" \
      "raise M4L_LIVE_LOCK_MAX_HOLD / M4L_LIVE_LOCK_MAX_TOTAL only for a real long run)" >&2
    kill_tree $pid; sleep 3; kill_tree9 $pid
    wait $pid 2>/dev/null
    return 124
  fi
  wait $pid
}

acquire() {  # $1 = backstop seconds for the VM-side holder
  local WAIT="${M4L_LIVE_LOCK_WAIT:-1800}" SETNAME="${M4L_LIVE_SET:--}" NOW="$(date '+%Y-%m-%d %H:%M:%S')" BACK=$1
  # VM side: register in the queue, retry lockf in 3 s slices (exit 75 = busy); on success leave the
  # queue, write the owner file, say LOCKED, hold until our stdin closes or the backstop alarm fires.
  local REMOTE="end=\$((\$(date +%s) + $WAIT)); n=0; mkdir -p $QDIR; Q=$QDIR/\$\$
printf 'label=%s\nhost_pid=%s\nepoch=%s\nvmpid=%s\n' '$LABEL' $$ \$(date +%s) \$\$ > \$Q; trap 'rm -f \$Q' EXIT
while :; do
  /usr/bin/lockf -s -t 3 $LOCKF sh -c 'rm -f \"\$7\"; printf \"label=%s\nhost_pid=%s\nhost=%s\nstarted=%s\nset=%s\nvmpid=%s\nepoch=%s\nmaxhold=%s\n\" \"\$1\" \"\$2\" \"\$3\" \"\$4\" \"\$5\" \$\$ \$(date +%s) \"\$6\" > $LOCKF.owner; echo LOCKED; /usr/bin/perl -e \"alarm shift; exec @ARGV\" $BACK cat >/dev/null; rm -f $LOCKF.owner' sh '$LABEL' $$ \"$(hostname -s)\" '$NOW' '$SETNAME' '$2' \$Q
  rc=\$?; [ \$rc -ne 75 ] && exit \$rc
  [ \$(date +%s) -ge \$end ] && { echo TIMEOUT; exit 75; }
  [ \$(ps -o ppid= -p \$\$) -eq 1 ] && exit 1  # the host side went away (ssh dropped): leave the queue
  n=\$((n+1)); [ \$((n % 5)) -eq 1 ] && { echo WAITING; cat $LOCKF.owner 2>/dev/null | tr '\n' ' '; echo; }
done"
  coproc "${SSH[@]}" "$REMOTE"
  HOLD=$!
  local line
  while IFS= read -r -u p line; do
    case "$line" in
      LOCKED) break ;;
      TIMEOUT) kill $HOLD 2>/dev/null; echo "[$LABEL] timed out after ${WAIT}s waiting for the Live lock" >&2; exit 75 ;;
      WAITING) echo "[$LABEL] Live lock busy, waiting (scripts/vm_live_lock.sh queue). Holder:" >&2 ;;
      *) [ -n "$line" ] && echo "[$LABEL]   $line" >&2 ;;
    esac
  done
  kill -0 $HOLD 2>/dev/null || { echo "[$LABEL] lock connection lost" >&2; exit 1; }
  echo "[$LABEL] Live lock acquired (max hold ${2}s)" >&2
  export M4L_LIVE_LOCK_HELD=1
}

selftest() {
  local t0 rc me=$SELF out
  echo "selftest: status"; "$me" status || return 1
  echo "selftest: refuse idle commands"
  for c in "sleep 5" "sh -c 'sleep 30'" "zsh -c 'echo hi; sleep 600'"; do
    eval "M4L_LIVE_LOCK_WAIT=5 \"$me\" selftest-lock -- $c" >/dev/null 2>&1; rc=$?
    [ $rc -eq 64 ] && echo "  refused: $c" || { echo "  FAIL: '$c' rc $rc (want 64)"; return 1; }
  done
  echo "selftest: acquire + run + release"
  M4L_LIVE_LOCK_WAIT=60 "$me" selftest-lock -- zsh -c '[ "$M4L_LIVE_LOCK_HELD" = 1 ] && echo held' | grep -q held || { echo "  FAIL"; return 1; }
  echo "selftest: max hold breaks a long command (5 s)"
  t0=$(date +%s)
  M4L_LIVE_LOCK_WAIT=60 M4L_LIVE_LOCK_MAX_HOLD=5 "$me" selftest-lock -- zsh -c 'for i in {1..40}; do sleep 0.5; done' 2>/dev/null; rc=$?
  [ $rc -eq 124 ] && [ $(( $(date +%s) - t0 )) -lt 30 ] && echo "  killed after $(( $(date +%s) - t0 )) s" || { echo "  FAIL rc $rc"; return 1; }
  echo "selftest: idle hold is broken (IDLE=3)"
  M4L_LIVE_LOCK_WAIT=60 M4L_LIVE_LOCK_IDLE=3 "$me" selftest-lock -- zsh -c 'sleep 40 & wait' 2>/dev/null; rc=$?
  [ $rc -eq 124 ] && echo "  broken" || { echo "  FAIL rc $rc"; return 1; }
  echo "selftest: queue shows a waiter, batch runs 3 steps under one hold"
  M4L_LIVE_LOCK_WAIT=60 "$me" selftest-hold -- zsh -c 'for i in {1..30}; do sleep 0.5; done' 2>/dev/null &
  sleep 3
  M4L_LIVE_LOCK_WAIT=60 "$me" batch selftest-batch 'echo one' 'false' 'echo three' > /tmp/m4l_lock_selftest.$$ 2>&1 &
  local bp=$!
  sleep 4
  out="$("$me" queue)"; print -r -- "$out" | sed 's/^/  /'
  print -r -- "$out" | grep -q "waiting #1: .selftest-batch" || { echo "  FAIL: waiter not listed"; return 1; }
  wait $bp; rc=$?
  grep -q "BATCH 3/3" /tmp/m4l_lock_selftest.$$ && [ $rc -eq 1 ] && grep "^BATCH" /tmp/m4l_lock_selftest.$$ | sed 's/^/  /' || { echo "  FAIL rc $rc"; cat /tmp/m4l_lock_selftest.$$; return 1; }
  rm -f /tmp/m4l_lock_selftest.$$
  wait
  "$me" status | grep -q "free" && echo "selftest: lock free again; all OK" || { echo "  lock not free afterwards"; return 1; }
}

case "${1:-}" in
  status|queue) show_status; exit 0 ;;
  break)
    echo "!!! BREAKING the Live lock held by:" >&2; holder >&2
    "${SSH[@]}" "p=\$(sed -n 's/^vmpid=//p' $LOCKF.owner); [ -n \"\$p\" ] && { pkill -P \$p; kill \$p; } ; true"
    exit 0 ;;
  selftest) LABEL=selftest; selftest; exit $? ;;
  ""|-h|--help) sed -n '2,34p' "$0"; exit 1 ;;
esac

if [ "$1" = "batch" ]; then
  shift; LABEL="${1:?usage: vm_live_lock.sh batch <label> [-f file] [cmd ...]}"; shift
  steps=()
  while [ $# -gt 0 ]; do
    if [ "$1" = "-f" ]; then
      while IFS= read -r l; do [[ "$l" =~ '^[[:space:]]*(#|$)' ]] || steps+=("$l"); done < "$2"; shift 2
    else steps+=("$1"); shift; fi
  done
  [ ${#steps} -gt 0 ] || { echo "batch: no commands" >&2; exit 64; }
  for s in "${steps[@]}"; do idle_cmd zsh -c "$s" && { echo "[$LABEL] refused: '$s' only waits; hold the Live lock only for a real run" >&2; exit 64; }; done
  if [ -n "${M4L_LIVE_LOCK_HELD:-}" ]; then :
  elif [ "${FORCE:-0}" = "1" ]; then echo "!!! FORCE=1: batch '$LABEL' WITHOUT the Live lock. Holder:" >&2; holder >&2; export M4L_LIVE_LOCK_HELD=1
  else acquire $((MAXTOTAL + 120)) $MAXTOTAL; fi
  T0=$(date +%s); summary=(); bad=0; i=0
  for s in "${steps[@]}"; do
    i=$((i + 1)); t=$(date +%s)
    dl=$((t + MAXHOLD)); [ $dl -gt $((T0 + MAXTOTAL)) ] && dl=$((T0 + MAXTOTAL))
    echo "[$LABEL] batch step $i/${#steps}: $s" >&2
    run_watched $dl zsh -c "$s"; rc=$?
    [ $rc -ne 0 ] && bad=1
    summary+=("BATCH $i/${#steps} rc=$rc $(( $(date +%s) - t ))s: $s${WHY:+ ($WHY)}")
    [ "$WHY" = "max hold reached" ] && [ $(date +%s) -ge $((T0 + MAXTOTAL)) ] && { summary+=("BATCH stopped: total max hold ${MAXTOTAL}s reached"); break; }
  done
  print -l -- "${summary[@]}"
  echo "[$LABEL] Live lock released (batch $(( $(date +%s) - T0 ))s, rc=$bad)" >&2
  exit $bad
fi

LABEL="$1"; shift
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "usage: vm_live_lock.sh <label> -- <command...>" >&2; exit 1; }
if [ -n "${M4L_LIVE_LOCK_HELD:-}" ]; then exec "$@"; fi
if idle_cmd "$@"; then
  echo "[$LABEL] refused: '$*' only waits. Hold the Live lock only for a real run (AGENTS.md 1a)." >&2; exit 64
fi
if [ "${FORCE:-0}" = "1" ]; then
  echo "!!! FORCE=1: running '$LABEL' WITHOUT the Live lock. Current holder (may be live!):" >&2
  holder >&2; export M4L_LIVE_LOCK_HELD=1; exec "$@"
fi
acquire $((MAXHOLD + 120)) $MAXHOLD
T0=$(date +%s)
run_watched $((T0 + MAXHOLD)) "$@"
rc=$?
echo "[$LABEL] Live lock released (rc=$rc, held $(( $(date +%s) - T0 ))s)" >&2
exit $rc
