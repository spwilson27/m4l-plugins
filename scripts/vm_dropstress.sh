#!/bin/zsh
# Run the file-drop crash matrix (scripts/drop_stress.py) in the tart VM macos-1 under the VM-wide Live lock
# (AGENTS.md 1a). Usage: scripts/vm_dropstress.sh <cells,comma,separated> [drops=300] [max-crashes=3]
#   cells: <F|S>-<rp|df|ld|native|maxpatch>, e.g. F-df,F-ld,S-df. Results: /tmp/drop_stress_results.jsonl and /tmp/drop_stress.log in the VM.
set -u
VM=macos-1
export SSHPASS=admin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IP="$(tart ip $VM 2>/dev/null || tart ip --resolver=arp $VM 2>/dev/null)"
[ -n "$IP" ] || { echo "VM $VM is not running" >&2; exit 1; }
. "$ROOT/scripts/vm_common.sh"; vm_dir_rel ableton
SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 "admin@${IP}")
if [ -z "${M4L_LIVE_LOCK_HELD:-}" ]; then
  M4L_LIVE_LOCK_WAIT=${M4L_LIVE_LOCK_WAIT:-7200} M4L_LIVE_SET=dropstress exec "$ROOT/scripts/vm_live_lock.sh" dropstress -- "$0" "$@"
fi
rsync -az --delete --exclude .git --exclude node_modules --exclude previews --exclude __pycache__ -e "sshpass -e ssh" "$ROOT/" "admin@${IP}:${VMREL}/"
"${SSH[@]}" "cd ~/${VMREL} && /usr/bin/python3 scripts/build_dropprobe.py >/dev/null && DS_DEBUG=${DS_DEBUG:-} DS_FRONT=${DS_FRONT:-Live} DS_NAME=${DS_NAME:-1} /usr/bin/python3 scripts/drop_stress.py --cells $1 --drops ${2:-300} --max-crashes ${3:-3}"
