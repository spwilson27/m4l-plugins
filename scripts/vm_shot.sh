#!/bin/zsh
# Screenshot of the tart VM macos-1's screen, taken on the HOST from tart's window (in-VM `screencapture`
# over ssh fails: "could not create image from display" — verified plain, via Live's process, and via
# sudo launchctl asuser 501, all rc=1). Needs the VM to run with a window (`tart run macos-1`)
# and the host shell to have Screen Recording permission.
#   scripts/vm_shot.sh [out.png]    default: /tmp/vm_shot.png; prints the path (the image includes tart's title bar)
# Fallback (verified 2026-10-24): this tart run's windows all have empty names and window-id capture
# fails ('could not create image from window'), but Tart runs fullscreen on the host, so if no window
# named macos-1 is found the script activates Tart and takes a full-screen capture instead.
set -u
OUT="${1:-/tmp/vm_shot.png}"
WID="$(osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); const a = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0)); let id = "";
for (let i = 0; i < a.count; i++) { const w = a.objectAtIndex(i); if (/tart/i.test(ObjC.unwrap(w.objectForKey("kCGWindowOwnerName")) || "") && ObjC.unwrap(w.objectForKey("kCGWindowName")) === "macos-1") id = String(ObjC.unwrap(w.objectForKey("kCGWindowNumber"))); } id')"
if [ -n "$WID" ]; then
  screencapture -x -o -l "$WID" "$OUT" && { echo "$OUT"; exit 0; }
  echo "window-id capture failed for id $WID, falling back to full-screen" >&2
fi
osascript -e 'tell application "Tart" to activate' >/dev/null 2>&1
sleep 1
screencapture -x -o "$OUT" && echo "$OUT"
