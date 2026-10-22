#!/usr/bin/env python3
"""Write spectral_sum_test.als for scripts/test_spectral_sum_live.js: MCP Bridge on Main, track "Transient Split" = [Sum Probe] [rack with one
Transient Split per chain] [Sum Probe], and a control track "Control" = [Sum Probe] [Sum Probe] (no rack). Run inside the VM
(scripts/vm_spectral.sh sumlive)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_spectral_set as mss  # noqa: E402

mss.DEVICES = [
    ("Transient Split", "Transient Split.amxd", ["Transients", "Tones"], True),
    ("Control", "", None, True),
]

if __name__ == "__main__":
    sys.argv += ["--out", os.path.join(mss.REPO, "spectral_sum_test.als")]
    if "--devices" not in sys.argv:
        sys.argv += ["--devices", os.path.join(mss.REPO, "devices")]
    sys.exit(mss.main())
