#!/usr/bin/env python3
"""Write spectral_sum_test.als for scripts/test_spectral_sum_live.js: MCP Bridge on Main, one track per Spectral Split device = [Sum Probe] [rack with one
instance per chain] [Sum Probe], and a control track "Control" = [Sum Probe] [Sum Probe] (no rack). Run inside the VM
(scripts/vm_spectral.sh sumlive)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_spectral_set as mss  # noqa: E402

mss.DEVICES = [(n, f, c, True) for (n, f, c) in mss.DEVICES] + [("Control", "", None, True)]

if __name__ == "__main__":
    if "--only" in sys.argv:       # --only "Transient Split,Loud Split": just those device tracks (+ Control)
        i = sys.argv.index("--only")
        keep = sys.argv[i + 1].split(",")
        del sys.argv[i:i + 2]
        mss.DEVICES = [d for d in mss.DEVICES if d[0] in keep or d[0] == "Control"]
    sys.argv += ["--out", os.path.join(mss.REPO, "spectral_sum_test.als")]
    if "--devices" not in sys.argv:
        sys.argv += ["--devices", os.path.join(mss.REPO, "devices")]
    sys.exit(mss.main())
