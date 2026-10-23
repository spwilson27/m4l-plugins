#!/bin/zsh
# Reuse the ONE running Live in the tart VM macos-1 instead of relaunching it for every test (AGENTS.md 1a).
# Uses the M4LTestLoader control surface (scripts/live_remote/M4LTestLoader, selected once in Live's
# Settings > Tempo & MIDI > Control Surface) to load device files through Live's browser and run Python in Live.
# Every subcommand but install / ping runs under the Live lock (scripts/vm_live_lock.sh; nested calls run directly).
#
#   scripts/vm_live_open.sh install                 copy the remote script + client into the VM (once, and after edits;
#                                                   Live reads the script at startup)
#   scripts/vm_live_open.sh ping                    is Live up and the loader answering? (prints version, tracks)
#   scripts/vm_live_open.sh ensure <set> [--fresh]  make <set> (a VM path, ~/ allowed) the open Set and wait for the
#                                                   MCP bridge: nothing to do when it is already open (reuse), else
#                                                   open it in the running Live (answers "Don't Save"), else cold-launch.
#                                                   --fresh reopens it even when open (fresh state, rebuilt devices).
#   scripts/vm_live_open.sh load <file> [track]     load an .amxd / .adg into the open Set (track: index, master,
#                                                   selected, new_audio, new_midi); the browser reads the file as it is now
#   scripts/vm_live_open.sh exec '<python>'         run Python in Live (song, app, browser, Live; set `result`)
#   scripts/vm_live_open.sh cold <set>              the old way: kill Live, clear crash files, launch it on <set>
# Prints `TIMING <what> <ms>` lines. The current Set is recorded in /tmp/m4l_loader/current_set in the VM.
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")
CLIENT='/usr/bin/python3 ~/.m4l_loader/live_loader_client.py'

case "${1:-}" in
  ensure|load|exec|cold) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || exec "$ROOT/scripts/vm_live_lock.sh" "live-open-$1" -- "$0" "$@" ;;
esac

ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }

# VM-side helpers (zsh): wait for a bridge started after $1 (epoch ms), answer Live's "save changes?" dialog
VMFUN='
now_ms() { /usr/bin/python3 -c "import time; print(int(time.time()*1000))"; }
bridge_t0() {  # start time (epoch ms) of the bridge on 9877, empty when none answers
  h=$(curl -s -m 1 http://127.0.0.1:9877/health) || return 1
  up=$(printf "%s" "$h" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get(\"uptime_ms\", 0))" 2>/dev/null) || return 1
  echo $(( $(now_ms) - up ))
}
bridge_since() {  # $1 = epoch ms; ok when a bridge port answers with an uptime that started after it
  for i in $(seq 1 ${2:-180}); do
    for p in 9877 9878 9879 9880; do
      h=$(curl -s -m 1 http://127.0.0.1:$p/health) || continue
      up=$(printf "%s" "$h" | /usr/bin/python3 -c "import sys,json; print(json.load(sys.stdin).get(\"uptime_ms\", 0))" 2>/dev/null) || continue
      [ $(( $(now_ms) - up )) -ge $1 ] && { BRIDGE_T0=$(( $(now_ms) - up )); echo "bridge up on $p"; return 0; }
    done
    sleep 0.5
  done
  echo "bridge did not come up" >&2; return 1
}
fit_window() {  # Live keeps a 1024 x 680 window from the old 1024 x 768 screen: fill the screen (click tests need it)
  osascript -e "tell application \"System Events\" to tell process \"Live\" to set position of window 1 to {0, 25}" \
    -e "tell application \"System Events\" to tell process \"Live\" to set size of window 1 to {3000, 3000}" >/dev/null 2>&1
}
dismiss_save() {  # the save dialog is custom-drawn (invisible to AX): a layer-8 window of Live. Cmd+D = Do not save,
  # sent only while that window exists (Cmd+D in the main window would duplicate)
  for i in $(seq 1 40); do
    if /usr/bin/python3 ~/.m4l_loader/mm_os_input.py cgwindows Live 2>/dev/null | grep -q "\[8,"; then
      osascript -e "tell application \"System Events\" to tell process \"Live\" to set frontmost to true" -e "tell application \"System Events\" to keystroke \"d\" using command down" >/dev/null 2>&1
      return 0
    fi
    sleep 0.25
  done
}
'

case "${1:-}" in
  install)
    "${SSH[@]}" 'mkdir -p ~/.m4l_loader "$HOME/Music/Ableton/User Library/Remote Scripts"' &&
      tar -C "$ROOT/scripts/live_remote" -cf - M4LTestLoader | "${SSH[@]}" 'cd "$HOME/Music/Ableton/User Library/Remote Scripts" && tar -xf -' &&
      sshpass -e scp -q "$ROOT/scripts/live_loader_client.py" "$ROOT/scripts/mm_os_input.py" "admin@${IP}:.m4l_loader/" && echo "installed" ;;
  ping)
    "${SSH[@]}" "$CLIENT --timeout 5 ping" ;;
  load)
    t0=$(ms); "${SSH[@]}" "$CLIENT load \"$2\" ${3:-selected}"; rc=$?; echo "TIMING load $(( $(ms) - t0 ))"; exit $rc ;;
  exec)
    "${SSH[@]}" "$CLIENT exec $(printf '%q' "$2")" ;;
  cold)
    t0=$(ms)
    "${SSH[@]}" "$VMFUN"'
      set="'"$2"'"; case "$set" in "~/"*) set="$HOME/${set#\~/}";; esac
      t=$(now_ms)
      pkill -f "MacOS/Live"; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done
      find "$HOME/Library/Preferences/Ableton" -maxdepth 2 \( -name CrashRecoveryInfo.cfg -o -name CrashDetection.cfg \) -delete
      open -a "Ableton Live 12 Suite" "$set" && bridge_since $t && mkdir -p /tmp/m4l_loader && echo "$set|$BRIDGE_T0" > /tmp/m4l_loader/current_set; fit_window'
    rc=$?; echo "TIMING cold $(( $(ms) - t0 ))"; exit $rc ;;
  ensure)
    set="$2"; fresh="${3:-}"
    t0=$(ms)
    out="$("${SSH[@]}" "$VMFUN"'
      set="'"$set"'"; case "$set" in "~/"*) set="$HOME/${set#\~/}";; esac
      [ -f "$set" ] || { echo "no such set: $set" >&2; exit 2; }
      cur=$(cat /tmp/m4l_loader/current_set 2>/dev/null)
      if '"$CLIENT"' --timeout 10 ping >/dev/null 2>&1; then
        # reuse only when the bridge that answers is the one started with that Set (another script may have reopened Live)
        b=$(bridge_t0); c=${cur##*|}; case "$c" in (""|*[!0-9]*) c=0;; esac
        if [ "${cur%|*}" = "$set" ] && [ "'"$fresh"'" != "--fresh" ] && [ -n "$b" ] && [ $(( b - c )) -le 1500 ] && [ $(( c - b )) -le 1500 ]; then echo MODE reuse; exit 0; fi
        t=$(now_ms)
        open -a "Ableton Live 12 Suite" "$set" && { dismiss_save >/dev/null 2>&1 </dev/null & }   # only acts if Live asks to save
        dp=$!
        bridge_since $t 120 && { kill $dp 2>/dev/null; echo "$set|$BRIDGE_T0" > /tmp/m4l_loader/current_set; fit_window; echo MODE reopen; exit 0; }
        kill $dp 2>/dev/null
        echo "reopen failed, falling back to a cold start" >&2
      fi
      echo MODE cold-needed')"
    rc=$?
    print -r -- "$out" | grep -v '^MODE'
    mode="$(print -r -- "$out" | sed -n 's/^MODE //p' | tail -1)"
    [ -n "$mode" ] || { echo "ensure failed (rc $rc)" >&2; exit 1; }
    if [ "$mode" = "cold-needed" ]; then "$0" cold "$set"; rc=$?; mode=cold; fi
    echo "TIMING ensure-$mode $(( $(ms) - t0 ))"; exit $rc ;;
  *)
    sed -n '2,18p' "$0"; exit 1 ;;
esac
