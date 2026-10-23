#!/usr/bin/env python3
"""VM-side: Finder drag onto the DropProbe DF device with variants of the drag timing; prints received/N. Usage: N dwell steps"""
import os, sys, time, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drop_stress as ds
mo = ds.mo
N, dwell, steps = int(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3])
origin = {"x": 274, "y": 502}
t = ds.Probe("df"); t.setup(origin)
f = ds.FinderSource(); f.prepare()
rnd = random.Random(7)
for i in range(N):
    tx, ty = t.point(rnd)
    x, y = f.rows[i % len(f.rows)]
    mo.front("Finder"); mo.click(x, y)
    mo._mouse(5, x, y); time.sleep(0.2); mo._mouse(1, x, y, 1); time.sleep(0.15)
    for k in range(1, steps + 1):
        mo._mouse(6, x + (tx - x) * k / steps, y + (ty - y) * k / steps, 1); time.sleep(0.03)
    time.sleep(dwell)
    mo._mouse(2, tx, ty, 1); time.sleep(0.8)
time.sleep(2)
print("dwell", dwell, "steps", steps, "sent", N, "received", t.received())
