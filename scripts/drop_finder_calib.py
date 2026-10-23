#!/usr/bin/env python3
"""VM-side calibration of the Finder drag automation (scripts/drop_stress.py): drags the Finder list-view icons onto
scripts/rp_drop_sink.m and counts the drops it receives. Usage: drop_finder_calib.py [N] [variant]"""
import os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drop_stress as ds
mo = ds.mo
N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
var = sys.argv[2] if len(sys.argv) > 2 else "base"
f = ds.FinderSource(); f.prepare()
subprocess.run("pkill rp_drop_sink", shell=True)
p = subprocess.Popen(["/tmp/rp_drop_sink", "700", "500", "220", "169"], stdout=open("/tmp/sink.out", "w"))
time.sleep(2)
for i in range(N):
    x, y = f.rows[i % len(f.rows)]
    if var in ("front", "click"):
        mo.front("Finder")
    if var == "click":
        mo.click(x, y)
    steps = 30 if var == "slow" else 16
    mo.drag(x, y, 800 - x, 580 - y, steps=steps)
    time.sleep(0.6)
p.terminate()
lines = [l for l in open("/tmp/sink.out") if l.startswith("DROP")]
print(var, "drags", N, "dropped files", len(lines), [l.strip().split("/")[-1] for l in lines])
