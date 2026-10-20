#!/usr/bin/env python3
"""
Run a command while holding an exclusive lock on the real Max app, so
parallel audio test runners never launch or drive Max at the same time.

    python3 scripts/max_lock.py python3 scripts/run_<device>_audio_tests.py
"""

import fcntl
import subprocess
import sys

LOCK_PATH = "/tmp/m4l_real_max.lock"


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: max_lock.py <command> [args...]")
    with open(LOCK_PATH, "w") as lock:
        print(f"[max_lock] waiting for {LOCK_PATH}", flush=True)
        fcntl.flock(lock, fcntl.LOCK_EX)
        print("[max_lock] acquired", flush=True)
        sys.exit(subprocess.call(sys.argv[1:]))


if __name__ == "__main__":
    main()
