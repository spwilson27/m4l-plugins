# Shared by scripts/vm_*.sh (source it: `. "$(dirname "$0")/vm_common.sh"`). AGENTS.md 1a.
# M4L_VM_DIR = the VM-side checkout this run syncs to, runs in and builds its sets from. Default `ableton`
# (= ~/ableton). Give it relative to the VM home (`sweep2/lane1`), or as `~/sweep2/lane1`; a path the HOST shell
# already expanded to $HOME/... (an unquoted `M4L_VM_DIR=~/x`) is stripped back to the relative form. Lanes that
# run at the same time must use different dirs, because every sync is an `rsync --delete`.
# Usage: vm_dir_rel <default-relative-dir> [override-var-value]  -> sets VMREL (relative, no slashes at the ends).
vm_dir_rel() {
  local d="${2:-${M4L_VM_DIR:-$1}}"
  d="${d#\~/}"; d="${d#"$HOME"/}"; d="${d#\$HOME/}"; d="${d#/}"; d="${d%/}"
  case "$d" in ""|.|..|*/../*|../*|*"'"*|*'"'*|*'$'*|*'`'*|/*) echo "bad M4L_VM_DIR: $d" >&2; exit 2 ;; esac
  VMREL="$d"
}

# The VM has no node, so every build_*.py (they minify embedded JS through node) runs on the HOST; the VM only
# generates its Live sets (python, no node) from the devices the sync copied over. Needs $ROOT. `live` paths call this
# before sync_repo.   host_build delayplus reverbplus ...
host_build() {
  local s
  for s in "$@"; do
    (cd "$ROOT" && python3 "scripts/build_$s.py" >/dev/null) || { echo "host build of $s failed" >&2; return 1; }
  done
}
