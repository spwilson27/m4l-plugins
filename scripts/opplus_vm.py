#!/usr/bin/env python3
"""Host-side helpers for Operator+ work in the tart VM (AGENTS.md 1a): Python in Live through the M4LTestLoader,
JavaScript in Max through the MCP bridge (curl inside the VM), the OpCap probe's capture buffers, and small pure-Python
signal analysis (no numpy on the host). Callers hold the Live lock (scripts/vm_live_lock.sh) themselves.

  import opplus_vm as ov
  ov.live("result = len(song.tracks)")       Python in Live -> result
  ov.js("return 1 + 1")                       JavaScript in the bridge's v8ui -> result
  ov.capture(["OP REF", "OP PLUS"], secs)     trigger every OpCap probe, wait, read {track: (left, right)}
"""
import json
import math
import os
import subprocess
import time

VM = "macos-1"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV = dict(os.environ, SSHPASS="admin")


def ip():
    r = subprocess.run(["tart", "ip", VM], capture_output=True, text=True)
    a = r.stdout.strip()
    if not a:
        a = subprocess.run(["tart", "ip", "--resolver=arp", VM], capture_output=True, text=True).stdout.strip()
    return a


_IP = None


def ssh(cmd, inp=None, timeout=120):
    global _IP
    _IP = _IP or ip()
    r = subprocess.run(["sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", "admin@" + _IP, cmd],
                       input=inp, capture_output=True, text=True, env=ENV, timeout=timeout)
    return r.stdout


def live(code, timeout=60):
    out = ssh("/usr/bin/python3 ~/.m4l_loader/live_loader_client.py --timeout %d exec \"$(cat)\"" % timeout, inp=code, timeout=timeout + 30)
    line = [l for l in out.splitlines() if l.startswith("{")]
    if not line:
        raise RuntimeError("no reply from Live: " + out[-400:])
    d = json.loads(line[-1])
    if not d.get("ok"):
        raise RuntimeError(d.get("error", "live exec failed"))
    return d.get("result")


def js(code, port=9877, timeout=30):
    body = json.dumps({"action": "eval_js", "params": {"code": code}})
    out = ssh("curl -s -m %d -X POST -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:%d/rpc" % (timeout, port), inp=body, timeout=timeout + 20)
    d = json.loads(out)
    r = d.get("result", d)
    if isinstance(r, dict) and "result" in r:
        r = r["result"]
    if isinstance(d, dict) and d.get("ok") is False:
        raise RuntimeError(str(d)[:400])
    return r


def capture(tracks, secs=2.0, sr=48000, settle=0.15, stereo=False):
    """Start every OpCap probe at once, wait secs, stop, read each named track's left/right capture."""
    js("messnamed('opcap_rec', 1); return 1;")
    time.sleep(secs + settle)
    js("messnamed('opcap_rec', 0); return 1;")
    names = json.loads(js("return String(new Global('opcap').names || '{}');"))
    n = int(secs * sr)
    out = {}
    for t in tracks:
        bn = names.get(t)
        if not bn:
            raise RuntimeError("no OpCap probe on track %r (%s)" % (t, names))
        chans = []
        for ch in ((1, 2) if stereo else (1,)):
            data = []
            for off in range(0, n, 4000):
                k = min(4000, n - off)
                txt = js("var b = new Buffer(%s); var a = b.peek(%d, %d, %d); var o = []; for (var i = 0; i < a.length; i++) o.push(Math.round(a[i] * 100000)); return o.join(',');" % (json.dumps(bn), ch, off, k))
                data.extend(int(v) / 100000.0 for v in str(txt).split(",") if v != "")
            chans.append(data)
        if not stereo:
            chans.append(chans[0])
        out[t] = chans
    return out


# ---------- analysis (pure Python) ----------

def rms(x):
    return math.sqrt(sum(v * v for v in x) / max(len(x), 1))


def goertzel(x, f, sr=48000):
    """Amplitude of frequency f in x (Hann window, amplitude-normalised)."""
    n = len(x)
    w = [0.5 - 0.5 * math.cos(2 * math.pi * i / (n - 1)) for i in range(n)]
    k = 2 * math.cos(2 * math.pi * f / sr)
    s1 = s2 = 0.0
    for i in range(n):
        s0 = x[i] * w[i] + k * s1 - s2
        s2, s1 = s1, s0
    p = s1 * s1 + s2 * s2 - k * s1 * s2
    return 2 * math.sqrt(max(p, 0)) / (n * 0.5)


def pitch(x, sr=48000, fmin=30, fmax=4000):
    """Fundamental by refined autocorrelation peak."""
    n = min(len(x), 8192)
    x = x[:n]
    best, bl = -1e9, 0
    lo, hi = int(sr / fmax), int(sr / fmin)
    ac = {}
    for lag in range(lo, min(hi, n // 2)):
        s = 0.0
        for i in range(0, n - lag, 2):
            s += x[i] * x[i + lag]
        ac[lag] = s
    base = max(ac.values())
    for lag in range(lo + 1, min(hi, n // 2) - 1):
        if ac[lag] > ac[lag - 1] and ac[lag] >= ac[lag + 1] and ac[lag] > 0.8 * base:
            bl = lag
            break
    if not bl:
        return 0.0
    a, b, c = ac[bl - 1], ac[bl], ac[bl + 1]
    d = (a - c) / (2 * (a - 2 * b + c)) if (a - 2 * b + c) != 0 else 0
    return sr / (bl + d)


def env_rms(x, block=480):
    return [rms(x[i:i + block]) for i in range(0, len(x) - block + 1, block)]
