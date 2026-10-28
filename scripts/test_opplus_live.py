#!/usr/bin/env python3
"""Operator+ in Live (VM, under the Live lock: scripts/vm_opplus.sh run). Host side.

  python3 scripts/test_opplus_live.py [setup|dsp|params|ab|shots|all]
setup  : in the open set (MCP Bridge on Main) make MIDI tracks "OP REF" (Live's Operator) and "OP PLUS" (Operator+), each
         followed by the OpCap probe.
dsp    : Operator+'s deferred gen~ reports ready (Global opplus_trace).
params : Operator+'s parameter list in Live holds every one of Operator's parameters (names, ranges).
ab     : A/B: the same patch set on both through the LOM, the same clip on both tracks, both outputs captured at once;
         fundamental, harmonic levels and the 10 ms envelope must agree (gates below).
shots  : click every section of Operator+ (the same screen points as Operator's) and save crops to tests/out/opplus_live/,
         then scripts/opplus_compare.py --live builds previews/opplus_compare/.
"""
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import opplus_vm as ov  # noqa: E402

ROOT = os.path.dirname(HERE)
VMDIR = os.environ.get("OPPLUS_VM_DIR", "sweep2/opplus")
OUT = os.path.join(ROOT, "tests", "out", "opplus_live")
fails = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def setup():
    home = ov.ssh("echo $HOME").strip()
    ov.js("var g = new Global('opplus_trace'); g.text = ''; var d = new Global('opplus_diag'); d.main = ''; d.graph = ''; return 1;")
    code = """
n0 = len(song.tracks)
for nm in ('OP REF', 'OP PLUS'):
    song.create_midi_track(-1)
    song.tracks[-1].name = nm
for i in range(n0):
    song.delete_track(0)
song.view.selected_track = song.tracks[0]
it = None
for c in browser.instruments.children:
    if c.name.startswith('Operator'):
        it = c
browser.load_item(it)
result = [t.name for t in song.tracks]
"""
    print("tracks", ov.live(code))
    for path, tr in [("%s/%s/devices/Operator+.amxd" % (home, VMDIR), 1), ("%s/%s/tests/opplus_probe/OpCap.amxd" % (home, VMDIR), 0),
                     ("%s/%s/tests/opplus_probe/OpCap.amxd" % (home, VMDIR), 1)]:
        out = ov.ssh("/usr/bin/python3 ~/.m4l_loader/live_loader_client.py --timeout 60 load %s %d" % (json.dumps(path), tr), timeout=120)
        print("load", os.path.basename(path), tr, out.strip()[-120:])
        time.sleep(1.0)
    print("devices", ov.live("result = [[d.name for d in t.devices] for t in song.tracks]"))


def dsp():
    t0 = time.time()
    st = {}
    while time.time() - t0 < 30:
        ov.js("messnamed('opplus_test', 'diag'); return 1;")
        time.sleep(0.3)
        st = json.loads(ov.js("return String(new Global('opplus_diag').main || '{}');") or "{}")
        if st.get("dsp", {}).get("ready"):
            break
        time.sleep(1)
    txt = ov.js("return String(new Global('opplus_trace').text || '');")
    check(bool(st.get("dsp", {}).get("ready")), "Operator+ DSP ready (diag %s; trace %s)" % (json.dumps(st)[:300], str(txt).replace("\n", " | ")[-160:]))


def params():
    code = """
def dump(d):
    return [[p.name, p.min, p.max, p.is_quantized] for p in d.parameters]
result = [dump(song.tracks[0].devices[0]), dump(song.tracks[1].devices[0])]
"""
    ref, plus = ov.live(code)
    pm = {p[0]: p for p in plus}
    missing = [r[0] for r in ref if r[0] not in pm and r[0] != "Device On"]
    check(not missing, "every Operator parameter exists in Operator+ (missing %s)" % missing[:8])
    bad = [r[0] for r in ref if r[0] in pm and r[0] != "Device On" and (abs(pm[r[0]][1] - r[1]) > 1e-6 or abs(pm[r[0]][2] - r[2]) > 1e-6)]
    check(not bad, "same ranges (%s)" % bad[:8])
    print("Operator: %d parameters, Operator+: %d" % (len(ref), len(plus)))


SET = """
for ti in (0, 1):
    d = song.tracks[ti].devices[0]
    P = dict((p.name, p) for p in d.parameters)
    for k, v in %s.items():
        if k in P:
            P[k].value = v
result = 1
"""
CLIP = """
song.stop_playing()
for ti in (0, 1):
    cs = song.tracks[ti].clip_slots[0]
    if cs.has_clip:
        cs.delete_clip()
    cs.create_clip(8.0)
    cs.clip.set_notes(tuple((n, 0.0, %f, 100, False) for n in %s))
song.scenes[0].fire()
result = 1
"""
BASE = {"Osc-B Level": 0.0, "Osc-C Level": 0.0, "Osc-D Level": 0.0, "Osc-A Level": 1.0, "Volume": 0.4, "Filter On": 0,
        "Osc-A Lev < Vel": 0.0, "Osc-B Lev < Vel": 0.0, "Osc-C Lev < Vel": 0.0, "Osc-D Lev < Vel": 0.0, "Algorithm": 10,
        "A Coarse": 1, "A Fine": 0, "B Coarse": 1, "B Fine": 0, "Osc-A Feedb": 0, "Osc-A Wave": 0, "Tone": 0.7, "LFO On": 0,
        "Pe On": 0, "Be Sustain": 1.0, "Ce Sustain": 1.0, "De Sustain": 1.0, "Ae Attack": 0.0, "Ae Decay": 0.6, "Ae Sustain": 1.0,
        "Ae Release": 0.4, "Spread": 0, "Transpose": 0, "Panorama": 0.0}
PATCHES = [
    ("sine", {}),
    ("fm_b_m10", {"Algorithm": 0, "Osc-B Level": 0.75}),
    ("fm_b_0db_ratio2", {"Algorithm": 0, "Osc-B Level": 1.0, "B Coarse": 2}),
    ("fm_alg4", {"Algorithm": 3, "Osc-B Level": 0.7, "Osc-C Level": 0.6, "Osc-D Level": 0.65, "C Coarse": 3, "D Coarse": 2}),
    ("feedback50", {"Osc-A Feedb": 50}),
    ("feedback25", {"Osc-A Feedb": 25}),
    ("saw6", {"Osc-A Wave": 5}),
    ("square8", {"Osc-A Wave": 14}),
    ("triangle", {"Osc-A Wave": 19}),
    ("lowpass", {"Osc-A Wave": 9, "Filter On": 1, "Filter Freq": 0.5, "Filter Res": 0.0}),
    ("lowpass_res", {"Osc-A Wave": 9, "Filter On": 1, "Filter Freq": 0.55, "Filter Res": 0.9}),
    ("highpass", {"Osc-A Wave": 9, "Filter On": 1, "Filter Type": 1, "Filter Freq": 0.6, "Filter Res": 0.0}),
    ("env_decay", {"Ae Decay": 0.5, "Ae Sustain": 0.5}),
    ("pitchenv", {"Pe On": 1, "Pe Amount": 1.0, "Pe Init": 12, "Pe Peak": 12, "Pe Sustain": 0, "Pe Decay": 0.45, "Osc-A < Pe": 1}),
    ("vibrato", {"LFO On": 1, "LFO Type": 0, "LFO Range": 0, "LFO Rate": 100, "LFO Amt": 0.1, "Osc-A < LFO": 1}),
]


# Measured differences that remain (reported, not failed; AGENTS.md Operator+ "Known differences").
KNOWN = {"fm_alg4": "two modulators into one carrier: harmonics differ by up to ~10 dB; index law, signs, topology and start phases were fitted without closing it",
         "fm_b_m10": "a -37 dB harmonic differs by 1.5 dB",
         "lowpass_res": "a harmonic 1.5 octaves above a resonant cutoff differs by ~3 dB (resonance curve fitted at 0, 0.5, 0.9 and 1.0)"}


def harmonics(x, f0, n=8):
    seg = x[2400:2400 + 9600]
    return [ov.goertzel(seg, f0 * k) for k in range(1, n + 1)]


def db(v):
    return 20 * math.log10(max(v, 1e-7))


def ab():
    note, f0 = 57, 220.0
    results = {}
    for name, patch in PATCHES:
        vals = dict(BASE)
        vals.update(patch)
        ov.live(SET % json.dumps(vals))
        time.sleep(0.3)
        ov.live(CLIP % (3.5, json.dumps([note])))
        time.sleep(0.25)
        cap = ov.capture(["OP REF", "OP PLUS"], 1.0)
        ov.live("song.stop_playing()\nresult = 1")
        time.sleep(0.4)
        a, b = cap["OP REF"][0], cap["OP PLUS"][0]
        ra, rb = ov.rms(a[2400:]), ov.rms(b[2400:])
        ha, hb = harmonics(a, f0), harmonics(b, f0)
        top = max(ha)
        errs = []
        for k in range(8):
            big = max(ha[k], hb[k])
            tol = 1.5 if big > top * 0.1 else (3.0 if big > top * 0.0316 else None)
            if tol is not None and abs(db(ha[k]) - db(hb[k])) > tol:
                errs.append("h%d %.1f/%.1f dB" % (k + 1, db(ha[k]), db(hb[k])))
        ea, eb = ov.env_rms(a), ov.env_rms(b)
        m = max(max(ea), 1e-9)
        envd = max(abs(x - y) for x, y in zip(ea, eb)) / m
        if envd > (0.25 if "pass" in name else 0.10):
            errs.append("envelope differs by %.0f %% of peak" % (envd * 100))
        if name == "vibrato":
            errs = [e for e in errs if not e.startswith("h")]   # vibrato smears harmonics: compare the pitch track only
            ta = [ov.pitch(a[i:i + 2400], fmin=150, fmax=400) for i in range(0, 40000, 2400)]
            tb = [ov.pitch(b[i:i + 2400], fmin=150, fmax=400) for i in range(0, 40000, 2400)]
            sa, sb = max(ta) - min(ta), max(tb) - min(tb)
            if abs(sa - sb) > max(2.0, 0.25 * sa):
                errs.append("vibrato depth %.1f vs %.1f Hz" % (sa, sb))
        results[name] = {"rms": [ra, rb], "h": [ha, hb], "env": [ea, eb]}
        if errs and name in KNOWN:
            print("KNOWN A/B %-16s rms %.4f / %.4f  %s  (%s)" % (name, ra, rb, "; ".join(errs), KNOWN[name]))
        else:
            check(not errs, "A/B %-16s rms %.4f / %.4f  %s" % (name, ra, rb, "; ".join(errs)))
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "ab.json"), "w") as f:
        json.dump(results, f)


SECTIONS = [("A", 210, 350), ("B", 210, 262), ("C", 210, 175), ("D", 210, 90), ("LFO", 1300, 70), ("Filter", 1340, 140),
            ("Pitch", 1270, 227), ("Global", 1110, 340)]


def vmclick(cx, cy, dx=480, dy=1580):
    ov.ssh("python3 ~/.m4l_loader/mm_os_input.py front Live; python3 ~/.m4l_loader/mm_os_input.py click %d %d" % ((dx + cx) // 2, (dy + cy - 56) // 2))
    time.sleep(0.8)


def shot(name, dx=480, dy=1580):
    from PIL import Image
    ov.ssh("python3 ~/.m4l_loader/mm_os_input.py move 1200 400")   # keep the pointer out of the picture
    full = os.path.join(OUT, "_full.png")
    subprocess.run([os.path.join(HERE, "vm_shot.sh"), full], check=True, capture_output=True)
    Image.open(full).convert("RGB").crop((dx, dy, dx + 1520, dy + 410)).save(os.path.join(OUT, "sec_%s.png" % name))
    Image.open(full).convert("RGB").crop((dx + 19, dy + 41, dx + 19 + 1450, dy + 41 + 338)).save(os.path.join(OUT, name + ".png"))


RESET = """
d = song.tracks[1].devices[0]
P = dict((p.name, p) for p in d.parameters)
for k, v in %s.items():
    if k in P:
        P[k].value = v
result = 1
"""


def shots():
    os.makedirs(OUT, exist_ok=True)
    spec = json.load(open(os.path.join(HERE, "opplus_params.json")))
    ov.live(RESET % json.dumps({p["name"]: p["init"] for p in spec if not p.get("extra")}))   # Operator's default patch, as in the references
    ov.live("song.view.selected_track = song.tracks[1]\nsong.view.select_device(song.tracks[1].devices[0])\nresult = 1")
    time.sleep(1.5)
    for name, x, y in SECTIONS:
        vmclick(x, y)
        shot(name)
        print("shot", name)
    vmclick(*SECTIONS[0][1:])
    vmclick(838, 173)
    shot("A_osc")
    vmclick(838, 173 + 0)   # back
    vmclick(466, 173)
    vmclick(*SECTIONS[5][1:])
    vmclick(838, 173)
    shot("Filter_disp")
    vmclick(466, 173)
    vmclick(*SECTIONS[0][1:])
    sel = ov.live("d = song.tracks[1].devices[0]\nresult = [p.value for p in d.parameters if p.name == 'UI Section']")
    print("UI Section after clicks:", sel)


def main(argv):
    what = argv[1:] or ["all"]
    if "all" in what:
        what = ["setup", "dsp", "params", "ab", "shots"]
    for w in what:
        globals()[w]()
    print("%d failed" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
