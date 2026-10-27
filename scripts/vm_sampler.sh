#!/bin/zsh
# Better Sampler Max / Live tests inside the tart VM macos-1 (AGENTS.md 1a: never run Max or Live on
# the host). Builds and node tests stay on the host; this copies the repo into the VM and runs the rest
# there over ssh (login admin / admin, tart's default test-VM credentials). Modelled on vm_delayplus.sh.
#
#   scripts/vm_sampler.sh sync     rsync the repo to ~/ableton in the VM
#   scripts/vm_sampler.sh live     sync, rebuild in the VM, write sampler_test.als with VM paths
#                                  (scripts/make_sampler_set.py), (re)start Live in the VM on it, clear
#                                  crash recovery, wait for the MCP bridge (127.0.0.1:9877 in the VM)
#   scripts/vm_sampler.sh run      live + test under ONE hold of the Live lock (scripts/vm_live_lock.sh); live and
#                                 test alone also take it. `scripts/vm_live_lock.sh status` shows the holder.
#   scripts/vm_sampler.sh test     make a 1.5 s 220 Hz WAV in the VM, then run scripts/test_sampler_live.js
#                                  on the host through an ssh tunnel (local 19877 -> VM 9877)
#   scripts/vm_sampler.sh audio    sync, then run scripts/run_sampler_audio_tests.py in the VM
#   scripts/vm_sampler.sh drag     sync, then drag a sample onto a drop target and onto Live
#   scripts/vm_sampler.sh titledrag  sync, load Reactive 2, drag its sample title onto a drop target
#   scripts/vm_sampler.sh wtface     sync, load Reactive 2, prove wavetable-frame automation faces in Live
#   scripts/vm_sampler.sh wtvis      photograph the scan and the modulated frame, and check the picture
# Workflow: python3 scripts/build_sampler.py && node tests/test_sampler.js, then `live`, then `test`.
set -u
VM=macos-1
LOCAL_PORT=19877
WAV=/tmp/bs_test_220.wav
WAV2=/tmp/bs_test_short.wav
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"  # the DHCP-lease lookup can miss a running VM
[ -n "$IP" ] || { echo "VM $VM is not running (tart run $VM)" >&2; exit 1; }
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new "admin@${IP}")

sync_repo() {
  rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ \
    -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${VMREL}/"
}

# Live is shared by every session: live / test / run hold the VM-wide Live lock (vm_live_lock.sh; nested
# calls see M4L_LIVE_LOCK_HELD=1 and run directly). `run` = lock -> live -> test -> release.
case "${1:-}" in live|test|run|drag|titledrag|wtface|wtvis|mseglive) [ -n "${M4L_LIVE_LOCK_HELD:-}" ] || M4L_LIVE_SET=sampler_test.als exec "$ROOT/scripts/vm_live_lock.sh" sampler -- "$0" "$@" ;; esac

case "${1:-}" in
  run)
    "$0" live && "$0" test ;;
  sync)
    sync_repo ;;
  audio)
    # SAMPLER_CASE / SAMPLER_PAN_ONLY on the host are forwarded. Unset runs the full suite.
    sync_repo && "${SSH[@]}" "cd ~/${VMREL} && SAMPLER_CASE=$(printf '%q' "${SAMPLER_CASE:-}") SAMPLER_PAN_ONLY=$(printf '%q' "${SAMPLER_PAN_ONLY:-}") SAMPLER_MX_ONLY=$(printf '%q' "${SAMPLER_MX_ONLY:-}") SAMPLER_WT_ONLY=$(printf '%q' "${SAMPLER_WT_ONLY:-}") SAMPLER_PHASE_ONLY=$(printf '%q' "${SAMPLER_PHASE_ONLY:-}") SAMPLER_BI_ONLY=$(printf '%q' "${SAMPLER_BI_ONLY:-}") /usr/bin/python3 scripts/run_sampler_audio_tests.py" ;;
  drag)
    # The helper is an AppKit window. ssh is a background session and NSPanel init never returns there,
    # so the test runs as the console user (Aqua), same password as the VM login.
    sync_repo && "${SSH[@]}" "cd ~/${VMREL} && echo $(printf '%q' "$SSHPASS") | sudo -S -p '' launchctl asuser \$(id -u) /usr/bin/env BS_DRAG_VM=1 /usr/bin/python3 \$HOME/${VMREL}/scripts/run_sampler_drag_test.py" ;;
  titledrag)
    # Drag the filename drawn on Reactive 2. The device is the one just built on the host (the VM has no
    # node, so this does not rebuild). Opens sampler_test.als for the bridge, then loads Reactive 2.
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 scripts/make_sampler_set.py' || exit 1
    "$ROOT/scripts/vm_live_open.sh" ensure "~/${VMREL}/sampler_test.als" || exit 1
    "${SSH[@]}" 'mkdir -p ~/.m4l_loader "$HOME/Music/Ableton/User Library/Remote Scripts"'
    tar -C "$ROOT/scripts/live_remote" -cf - M4LTestLoader | "${SSH[@]}" 'cd "$HOME/Music/Ableton/User Library/Remote Scripts" && tar -xf -'
    sshpass -e scp -q "$ROOT/scripts/live_loader_client.py" "$ROOT/scripts/mm_os_input.py" "admin@${IP}:.m4l_loader/"
    "${SSH[@]}" "/usr/bin/python3 \$HOME/.m4l_loader/live_loader_client.py load \"\$HOME/${VMREL}/devices/Better Sampler Reactive 2.amxd\" new_midi" || exit 1
    "${SSH[@]}" "cd ~/${VMREL} && echo $(printf '%q' "$SSHPASS") | sudo -S -p '' launchctl asuser \$(id -u) /usr/bin/env BS_DRAG_VM=1 /usr/bin/python3 \$HOME/${VMREL}/scripts/run_sampler_title_drag_test.py" ;;
  wtface)
    # Load Reactive 2 and prove every drawn parameter's live.* face: Play Position and Osc 2 Position
    # set and read back, a click on the wavetable slider selects that parameter, and a right-click
    # opens its menu. The device is the one just built on the host (the VM has no node).
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 scripts/make_sampler_set.py' || exit 1
    "$ROOT/scripts/vm_live_open.sh" ensure "~/${VMREL}/sampler_test.als" || exit 1
    "${SSH[@]}" 'mkdir -p ~/.m4l_loader "$HOME/Music/Ableton/User Library/Remote Scripts"'
    tar -C "$ROOT/scripts/live_remote" -cf - M4LTestLoader | "${SSH[@]}" 'cd "$HOME/Music/Ableton/User Library/Remote Scripts" && tar -xf -'
    sshpass -e scp -q "$ROOT/scripts/live_loader_client.py" "$ROOT/scripts/mm_os_input.py" "admin@${IP}:.m4l_loader/"
    "${SSH[@]}" "/usr/bin/python3 \$HOME/.m4l_loader/live_loader_client.py load \"\$HOME/${VMREL}/devices/Better Sampler Reactive 2.amxd\" new_midi" || exit 1
    "${SSH[@]}" "cd ~/${VMREL} && echo $(printf '%q' "$SSHPASS") | sudo -S -p '' launchctl asuser \$(id -u) /usr/bin/env BS_FACE_VM=1 PYTHONUNBUFFERED=1 /usr/bin/python3 \$HOME/${VMREL}/scripts/run_sampler_wt_face_test.py" ;;
  wtvis)
    # Arrange a modulated frame and a Resonance row, photograph the VM, and check the picture:
    # no light triangle beside the scan square, and a grey knob trace under the bright frame.
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 scripts/make_sampler_set.py' || exit 1
    "$ROOT/scripts/vm_live_open.sh" ensure "~/${VMREL}/sampler_test.als" || exit 1
    "${SSH[@]}" 'mkdir -p ~/.m4l_loader "$HOME/Music/Ableton/User Library/Remote Scripts"'
    tar -C "$ROOT/scripts/live_remote" -cf - M4LTestLoader | "${SSH[@]}" 'cd "$HOME/Music/Ableton/User Library/Remote Scripts" && tar -xf -'
    sshpass -e scp -q "$ROOT/scripts/live_loader_client.py" "$ROOT/scripts/mm_os_input.py" "admin@${IP}:.m4l_loader/"
    "${SSH[@]}" "/usr/bin/python3 \$HOME/.m4l_loader/live_loader_client.py load \"\$HOME/${VMREL}/devices/Better Sampler Reactive 2.amxd\" new_midi" || exit 1
    "${SSH[@]}" 'rm -f /tmp/bs_wtvis_ready /tmp/bs_wtvis_done'
    "${SSH[@]}" "cd ~/${VMREL} && PYTHONUNBUFFERED=1 BS_WTVIS_VM=1 /usr/bin/python3 scripts/run_sampler_wt_vis_test.py" &
    LIVEPY=$!
    for _i in $(seq 1 80); do
      "${SSH[@]}" 'test -f /tmp/bs_wtvis_ready' && break
      sleep 0.25
    done
    "${SSH[@]}" 'test -f /tmp/bs_wtvis_ready' || { echo "the device view was not ready" >&2; "${SSH[@]}" 'touch /tmp/bs_wtvis_done'; wait $LIVEPY; exit 1; }
    # The pointer leaves a white arrow on the scan. Park it in the corner before the picture.
    "${SSH[@]}" "cd ~/${VMREL} && echo $(printf '%q' "$SSHPASS") | sudo -S -p '' launchctl asuser \$(id -u) /usr/bin/python3 -c 'import sys; sys.path.insert(0, \"scripts\"); import mm_os_input as mo; mo._mouse(5, 40, 60)'" || true
    sleep 0.3
    "$ROOT/scripts/vm_shot.sh" /tmp/bs_wtvis.png || { "${SSH[@]}" 'touch /tmp/bs_wtvis_done'; wait $LIVEPY; exit 1; }
    python3 "$ROOT/scripts/run_sampler_wt_vis_test.py" --check /tmp/bs_wtvis.png || { "${SSH[@]}" 'touch /tmp/bs_wtvis_done'; wait $LIVEPY; exit 1; }
    "${SSH[@]}" 'touch /tmp/bs_wtvis_done'
    wait $LIVEPY || exit 1 ;;
  mseglive)
    # Open the MSEG, hold a note, and require the playhead and the published level to move.
    # The host photographs the device while the note is sounding.
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 scripts/make_sampler_set.py' || exit 1
    "$ROOT/scripts/vm_live_open.sh" ensure "~/${VMREL}/sampler_test.als" || exit 1
    "${SSH[@]}" 'mkdir -p ~/.m4l_loader "$HOME/Music/Ableton/User Library/Remote Scripts"'
    tar -C "$ROOT/scripts/live_remote" -cf - M4LTestLoader | "${SSH[@]}" 'cd "$HOME/Music/Ableton/User Library/Remote Scripts" && tar -xf -'
    sshpass -e scp -q "$ROOT/scripts/live_loader_client.py" "$ROOT/scripts/mm_os_input.py" "admin@${IP}:.m4l_loader/"
    "${SSH[@]}" "/usr/bin/python3 \$HOME/.m4l_loader/live_loader_client.py load \"\$HOME/${VMREL}/devices/Better Sampler Reactive 2.amxd\" new_midi" || exit 1
    "${SSH[@]}" 'rm -f /tmp/bs_mseg_ready'
    "${SSH[@]}" "cd ~/${VMREL} && PYTHONUNBUFFERED=1 /usr/bin/python3 scripts/run_sampler_mseg_live.py" &
    LIVEPY=$!
    for _i in $(seq 1 50); do
      "${SSH[@]}" 'test -f /tmp/bs_mseg_ready' && break
      sleep 0.25
    done
    "$ROOT/scripts/vm_shot.sh" /tmp/bs_mseg_live.png || true
    wait $LIVEPY || exit 1 ;;
  live)
    host_build sampler || exit 1
    sync_repo || exit 1
    "${SSH[@]}" 'cd ~/'"$VMREL"' && /usr/bin/python3 scripts/make_sampler_set.py || exit 1
      pkill -f "MacOS/Live" ; for i in $(seq 1 40); do pgrep -f "MacOS/Live" >/dev/null || break; sleep 0.5; done;
      rm -f "$HOME"/Library/Preferences/Ableton/Live\ */CrashRecoveryInfo.cfg "$HOME"/Library/Preferences/Ableton/Live\ */CrashDetection.cfg;
      rm -rf "$HOME"/Library/Preferences/Ableton/Live\ */Undo;
      open -a "Ableton Live 12 Suite" "$HOME/'"$VMREL"'/sampler_test.als" &&
      for i in $(seq 1 90); do curl -s -m 1 http://127.0.0.1:9877/health >/dev/null && { echo "bridge up"; exit 0; }; sleep 2; done;
      echo "bridge did not come up" >&2; exit 1' ;;
  test)
    "${SSH[@]}" "/usr/bin/python3 - <<'PY'
import wave, struct, math
for path, n in (('$WAV', 66150), ('$WAV2', 22050)):
    w = wave.open(path, 'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
    w.writeframes(b''.join(struct.pack('<h', int(20000 * math.sin(2 * math.pi * 220 * i / 44100))) for i in range(n)))
    w.close()
PY" || exit 1
    "${SSH[@]}" -N -L "${LOCAL_PORT}:127.0.0.1:9877" &
    TUNNEL=$!
    trap 'kill $TUNNEL 2>/dev/null' EXIT
    for i in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:${LOCAL_PORT}/health" >/dev/null && break; sleep 0.5; done
    node "$ROOT/scripts/test_sampler_live.js" --port "$LOCAL_PORT" --wav "$WAV" --wav2 "$WAV2" ;;
  *)
    sed -n '2,/^set -u/p' "$0"; exit 1 ;;
esac
