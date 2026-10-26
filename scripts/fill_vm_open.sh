#!/bin/bash
# Opened on the VM by scripts/vm_fill.sh live. The host already built Fill.amxd.
set -euo pipefail
cd "$HOME/ableton"
DEV="$HOME/ableton/devices/Fill.amxd"
/usr/bin/python3 scripts/make_delayplus_sets.py --start "$DEV" --end "$DEV" --name Fill \
  --track "Fill::$DEV" --als "$HOME/ableton/fill_test.als" >/dev/null
pkill -f "MacOS/Live" || true
for _ in $(seq 1 40); do
  pgrep -f "MacOS/Live" >/dev/null || break
  sleep 0.5
done
rm -f "$HOME"/Library/Preferences/Ableton/Live\ */CrashRecoveryInfo.cfg \
      "$HOME"/Library/Preferences/Ableton/Live\ */CrashDetection.cfg || true
open -a "Ableton Live 12 Suite" "$HOME/ableton/fill_test.als"
for _ in $(seq 1 90); do
  if curl -s -m 1 http://127.0.0.1:9877/health >/dev/null; then
    echo "bridge up"
    exit 0
  fi
  sleep 2
done
echo "bridge did not come up" >&2
exit 1
