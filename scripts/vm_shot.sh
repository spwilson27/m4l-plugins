#!/bin/zsh
# Screenshot of the tart VM macos-1's screen, taken on the HOST from tart's window (in-VM `screencapture`
# over ssh fails: "could not create image from display"). Needs the VM to run with a window (`tart run macos-1`)
# and the host shell to have Screen Recording permission.
#   scripts/vm_shot.sh [out.png]    default: /tmp/vm_shot.png; prints the path (the image includes tart's title bar)
set -u
OUT="${1:-/tmp/vm_shot.png}"
WID="$(osascript -l JavaScript -e 'ObjC.import("CoreGraphics"); const a = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0)); let id = "";
for (let i = 0; i < a.count; i++) { const w = a.objectAtIndex(i); if (/tart/i.test(ObjC.unwrap(w.objectForKey("kCGWindowOwnerName")) || "") && ObjC.unwrap(w.objectForKey("kCGWindowName")) === "macos-1") id = String(ObjC.unwrap(w.objectForKey("kCGWindowNumber"))); } id')"
[ -n "$WID" ] || { echo "no tart window named macos-1 (is the VM running with a window?)" >&2; exit 1; }
screencapture -x -o -l "$WID" "$OUT" && echo "$OUT"
