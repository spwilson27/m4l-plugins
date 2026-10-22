#!/usr/bin/env python3
"""Write spectral_probe_test.als for scripts/test_spectral_probe_live.js: MCP Bridge on Main plus audio tracks "Probe" (a rack with
4 chains, one Spectral Probe each) and "Probe B" (a second rack track, to see whether tracks/racks interact). Run it inside the VM
(absolute device paths): scripts/vm_spectral.sh probe."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_spectral_set as mss  # noqa: E402

mss.DEVICES = [
    ("Probe", "Spectral Probe.amxd", ["A", "B", "C", "D"]),
    ("Probe B", "Spectral Probe.amxd", ["A", "B", "C"]),
]

if __name__ == "__main__":
    sys.argv += ["--out", os.path.join(mss.REPO, "spectral_probe_test.als"), "--devices", os.path.join(mss.REPO, "tests", "spectral_probe")]
    sys.exit(mss.main())
