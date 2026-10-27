#!/bin/zsh
# The Mega Modulator Live scripts, each on a FRESH set (scripts/vm_megamod_keys.sh live before each), in the VM, under ONE hold of the Live lock:
#
#   scripts/vm_live_lock.sh megamod-suite -- scripts/vm_megamod_live_suite.sh [name ...]
#
# names (default: all but width): dsp auto faces reload selfmod dmod newmods delete midi remote_depth (width too if named). Wrap in M4L_LIVE_LOCK_MAX_HOLD=1800.
# Prints each script's output and a `SUITE <name>: <n> PASS <m> FAIL (rc <rc>)` summary line per script; exit status 1 when any script failed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEYS="$ROOT/scripts/vm_megamod_keys.sh"
if [ $# -gt 0 ]; then names=("$@"); else names=(dsp auto faces reload selfmod dmod newmods delete midi remote_depth); fi
bad=0
first=1
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel Software/ableton-mmnames "${MM_VM_DIR:-}"
SET="~/$VMREL/megamod_keys_test.als"
for n in $names; do
  case $n in
    dsp) cmd=(run scripts/test_megamod_dsp_live.js);;
    auto) cmd=(auto);;
    faces) cmd=(faces);;
    reload) cmd=(reload);;
    selfmod) cmd=(run scripts/test_megamod_selfmod_live.js);;
    dmod) cmd=(run scripts/test_megamod_dmod_live.js);;
    newmods) cmd=(run scripts/test_megamod_newmods_live.js);;
    delete) cmd=(run scripts/test_megamod_delete_target_live.js);;
    width) cmd=(run scripts/test_megamod_width_live.js);;
    midi) cmd=(run scripts/test_megamod_midi_live.js);;
    remote_depth) cmd=(run scripts/test_megamod_remote_depth_live.js);;
    *) echo "unknown $n"; continue;;
  esac
  echo "=== $n: fresh set"
  if [ $first = 1 ]; then   # the first script syncs the repo and writes the set; the others reopen it fresh in the running Live (~3 s, scripts/vm_live_open.sh)
    FORCE=1 "$KEYS" live || { echo "SUITE $n: live failed"; bad=1; continue; }; first=0
  else
    "$ROOT/scripts/vm_live_open.sh" ensure "$SET" --fresh || { echo "SUITE $n: reopen failed"; bad=1; continue; }
  fi
  out="$("$KEYS" $cmd 2>&1)"; rc=$?
  echo "$out"
  p=$(echo "$out" | grep -c '^PASS'); f=$(echo "$out" | grep -c '^FAIL')
  echo "SUITE $n: $p PASS $f FAIL (rc $rc)"
  [ "$rc" = 0 ] && [ "$f" = 0 ] || bad=1
done
exit $bad
