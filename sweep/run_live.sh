#!/bin/zsh
# under the Live lock: open smoke set, 2 tracks, load Clip+ on both, play, run scripts/test_clipplus_sweep2_live.js
set -u
ROOT=/tmp/sweep2/clipplus
export M4L_VM_DIR=sweep2/smoke M4L_LIVE_LOCK_HELD=1
IP="$(tart ip macos-1 2>/dev/null || tart ip --resolver=arp macos-1)"
export SSHPASS=admin
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")
home="$("${SSH[@]}" 'echo $HOME')"; vmroot="$home/sweep2/smoke"
"$ROOT/scripts/vm_live_open.sh" ensure "~/sweep2/smoke/smoke_test.als" --fresh || exit 1
"$ROOT/scripts/vm_live_open.sh" exec "
wav='$vmroot/assets/smoke_loop.wav'
n0=len(song.tracks)
for nm in ('SMK A','SMK B'):
    song.create_audio_track(-1); song.tracks[-1].name=nm
for i in range(n0): song.delete_track(0)
for tr in song.tracks:
    tr.clip_slots[0].create_audio_clip(wav); tr.clip_slots[0].clip.looping=True
result=1" >/dev/null
bport="$("${SSH[@]}" 'for p in 9877 9878 9879 9880; do curl -s -m1 http://127.0.0.1:$p/health >/dev/null && { echo $p; break; }; done')"
"${SSH[@]}" -N -L 19911:127.0.0.1:$bport & tun=$!
sleep 2
for tr in 0 1; do "$ROOT/scripts/vm_live_open.sh" load "$vmroot/devices/Clip+.amxd" $tr >/dev/null; sleep 4; done
"$ROOT/scripts/vm_live_open.sh" exec "for tr in song.tracks: tr.clip_slots[0].fire()
song.is_playing = True
result = 1" >/dev/null
sleep 4
node $ROOT/scripts/test_clipplus_sweep2_live.js 19911; rc=$?
kill $tun
exit $rc
