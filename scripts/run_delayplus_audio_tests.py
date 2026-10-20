#!/usr/bin/env python3
"""Render Delay+ (Start + End) through Ableton-bundled Max and verify timing, latency compensation and safety.

One patch simulates a Live chain: source -> Start gen~ -> delay~ L (chain latency, optional *~ gain)
-> End gen~ -> record~. Both gen~ bind the same xfer / hdr buffers, Start gets `lat L`.
Runs on scripts/max_harness.py (NonRealTime driver, cases in parallel, no lock):  python3 scripts/run_delayplus_audio_tests.py [case ...]

Echo positions are measured against the dry output (which sits L samples after the input, the
sample Live's PDC re-aligns); the reference marker is recorded on channel 3.

Cases:
  compile      — both gen objects compile and link: dry output non-silent, paired flags set
  timing_L0 / timing_L256 / timing_L1000 — echoes 1..4 at exactly n*T after the dry, gains 1, .5, .25, .125
  timing_gain  — L=256 with a 0.5 gain in the chain: echo ratios follow (fb * gain)^(n-1)
  clamp        — T < L + B + 4 is clamped (scope[2]) and echoes land at tmin = B + L + 4
  pingpong     — echo 1 on L, echo 2 on R, echo 3 on L
  offset       — Offset 0.5: right echo at 1.5 T, left at T
  freeze       — (stepped mode, Freeze message at a sample time) Freeze holds the loop within 1 dB over repeats and ignores new input
  debug        — Debug ping measures the chain latency (hdr[10] == L) and the loop error hdr[17] is 0
  midside      — Mid/Side mode: impulse on L -> mid echo (Left time) in phase on both sides, side echo
                 (Right time) +L / -R
  invert       — Feedback Invert: the second echo flips polarity
  gate         — Gate at -20 dB: a hit below it does not reach the delay
  filter       — Filter on, LP 400 Hz: the echo is darker than the dry hit
  blowup       — fb 1.1 + Clip Dry at +12 dB input on 5 s of noise stays finite and below 2.0
"""

import concurrent.futures
import math
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
START_PATH = os.path.join(ROOT, "src", "delayplus_start.genexpr")
END_PATH = os.path.join(ROOT, "src", "delayplus_end.genexpr")
PROBE_JS = os.path.join(ROOT, "tests", "delayplus_probe.js")
SIGVS = 64  # max_harness runs the DSP with `dsp sigvs 64`
SETTLE_MS = 500  # link / crossfade settling, trimmed by the harness; sources start at POS_MS

# Test source (audio-rate, sample counted from DSP start). kind 0 = 33-sample Hann bump (peak at `pos` ms),
# 1 = band-limited noise bursts (burst 1 at pos for b1l ms, optional burst 2 at b2s for b2l ms),
# 2 = continuous noise from pos. out3 = single-sample reference marker at pos.
SOURCE_GEN = """
bump(d, a) {
	return (abs(d) < 17) ? a * 0.5 * (1 + cos(pi * d / 17)) : 0;
}

Param kind(0);
Param amp(0.8);
Param lch(1);
Param rch(1);
Param pos(600);
Param b1l(80);
Param b2s(-1);
Param b2l(80);

History n(0);
History nz(0);

n = n + 1;
ms = n * 1000 / samplerate;
posS = floor(pos * samplerate / 1000);
d = n - posS;
nz = nz + 0.1 * (noise() - nz);
nzs = nz * 4 * amp;
act = (kind > 1.5) ? (ms >= pos) : ((ms >= pos && ms < pos + b1l) || (b2s >= 0 && ms >= b2s && ms < b2s + b2l));
sig = (kind < 0.5) ? bump(d, amp) : (act ? nzs : 0);
out1 = sig * lch;
out2 = sig * rch;
out3 = (d == 0) ? 1 : 0;
"""

BASE = "filton 0, hp 10, lp 20000, repitch 0, tmsL 100, tmsR 100, fb 0.5, wet 0.5"


def device(start_code, end_code, case):
    lat = case["L"]
    boxes = [
        mh.msg("dev-params", f"lat {lat}, {case['start']}", 40, 60, 600),
        mh.msg("dev-src-params", case["source"], 40, 90, 600),
        mh.msg("dev-bind-start", "xfer #0-dpxfer, hdr #0-dphdr, scope #0-dpscope", 40, 120, 330),
        mh.msg("dev-bind-end", "xfer #0-dpxfer, hdr #0-dphdr, scope #0-dpscopeE", 380, 120, 330),
        mh.box("dev-buf-xfer", "buffer~ #0-dpxfer @samps 65536 @chans 5", 700, 20, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-hdr", "buffer~ #0-dphdr @samps 64", 700, 45, 190, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-scope", "buffer~ #0-dpscope @samps 1568", 700, 70, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-buf-scopee", "buffer~ #0-dpscopeE @samps 32", 700, 95, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("dev-setbuf", "setbuffers #0-dpxfer #0-dphdr #0-dpscope #0-dpscopeE", 380, 150, 380),
        mh.gen_box("dev-src", SOURCE_GEN, 40, 160, numinlets=1, numoutlets=3),
        mh.gen_box("dev-start", start_code, 40, 260, numinlets=2, numoutlets=2),
        mh.gen_box("dev-end", end_code, 40, 400, numinlets=2, numoutlets=2),
        mh.box("dev-dl", f"delay~ 65536 {lat}", 300, 330, 110, numinlets=2, outlettype=["signal"]),
        mh.box("dev-dr", f"delay~ 65536 {lat}", 430, 330, 110, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-src-params", 0),
        mh.line("obj-load", 0, "dev-bind-start", 0),
        mh.line("obj-load", 0, "dev-bind-end", 0),
        mh.line("obj-load", 0, "dev-setbuf", 0),
        mh.line("dev-setbuf", 0, "obj-js", 0),
        mh.line("dev-params", 0, "dev-start", 0),
        mh.line("dev-bind-start", 0, "dev-start", 0),
        mh.line("dev-bind-end", 0, "dev-end", 0),
        mh.line("dev-src-params", 0, "dev-src", 0),
        mh.line("dev-src", 0, "dev-start", 0),
        mh.line("dev-src", 1, "dev-start", 1),
        mh.line("dev-src", 2, "obj-record", 2),
        mh.line("dev-end", 0, "obj-record", 0),
        mh.line("dev-end", 1, "obj-record", 1),
        mh.line("dev-end", 0, "obj-mute-l", 0),
        mh.line("dev-end", 1, "obj-mute-r", 0),
    ]
    # Start -> simulated chain latency (+ optional gain) -> End. The connection orders the DSP sort.
    for ch, d in ((0, "dev-dl"), (1, "dev-dr")):
        lines.append(mh.line("dev-start", ch, d, 0))
        if case["gain"] != 1.0:
            g = f"dev-g{ch}"
            boxes.append(mh.box(g, f"*~ {case['gain']}", 300 + 130 * ch, 365, 50, numinlets=2, outlettype=["signal"]))
            lines.append(mh.line(d, 0, g, 0))
            lines.append(mh.line(g, 0, "dev-end", ch))
        else:
            lines.append(mh.line(d, 0, "dev-end", ch))
    return boxes, lines


def cases():
    # `dur` = analysed window after the 500 ms settle. Source events land at `pos` ms from DSP start.
    def c(name, start="", source="kind 0, amp 0.8, pos 600", L=0, gain=1.0, dur=700, dump=True,
          mode="nrt", events=None):
        return {"name": name, "start": BASE + (", " + start if start else ""), "source": source,
                "L": L, "gain": gain, "dur": dur, "dump": dump, "mode": mode, "events": events or []}

    return (
        c("compile", dur=500),
        c("timing_L0", L=0),
        c("timing_L256", L=256),
        c("timing_L1000", L=1000),
        c("timing_gain", L=256, gain=0.5),
        c("clamp", "tmsL 50, tmsR 50", L=4000, dur=600),
        c("pingpong", "chmode 1", source="kind 0, amp 0.8, pos 600, rch 0"),
        c("offset", "tmsR 150", dur=700),
        c("midside", "chmode 2, tmsL 100, tmsR 150", source="kind 0, amp 0.8, pos 600, rch 0", dur=700),
        c("invert", "inv 1"),
        c("gate", "gateon 1, gatethr -20", source="kind 0, amp 0.05, pos 600", dur=500),
        c("filter", "filton 1, hp 20, lp 400", dur=500),
        # Freeze needs a message at a sample time -> stepped mode (event lands within one vector).
        c("freeze", "wet 1", source="kind 1, amp 0.5, pos 700, b1l 80, b2s 1700, b2l 80", dur=1700,
          mode="stepped", events=[(1000, "dev-start", 0, "freeze 1")]),
        c("debug", "debug 1", source="kind 0, amp 0, pos 600", L=256, dur=1500, dump=False),
        c("blowup", "tmsL 50, tmsR 50, fb 1.1, clipdry 1, inputdb 12, wet 1", source="kind 2, amp 1.0, pos 100", dur=5000, dump=False),
    )


def parse_data(path):
    """Probe stores each sample as round((v + 8) * 1e5); tokens are read across line wraps."""
    ch = {}
    cur = None
    with open(path) as f:
        for tok in f.read().split():
            if tok.startswith("ch"):
                cur = ch.setdefault(tok, [])
            elif cur is not None:
                cur.append(int(tok) / 100000.0 - 8.0)
    return ch


def run_case(start_code, end_code, case):
    boxes, lines = device(start_code, end_code, case)
    try:
        meta = mh.run_case(
            case["name"], boxes, lines, probe_js=PROBE_JS,
            probe_args=f"{case['name']} {1 if case['dump'] else 0}",
            settle_ms=SETTLE_MS, dur_ms=case["dur"], channels=3, mode=case["mode"],
            events=case["events"], keep_dir=True)
    except Exception as exc:  # noqa: BLE001 - reported as a failed case
        return {"name": case["name"], "error": str(exc)}, None
    work = meta.get("harness_dir")
    data = None
    if case["dump"] and work and os.path.exists(os.path.join(work, "result.txt.data")):
        data = parse_data(os.path.join(work, "result.txt.data"))
    if work:
        shutil.rmtree(work, ignore_errors=True)
    meta["sr"] = meta.get("harness_sr", 48000.0)
    meta["hdr"] = [meta.get(f"h{i}", float("nan")) for i in range(20)]
    meta["scope"] = [meta.get(f"s{i}", float("nan")) for i in range(24)]
    return meta, data


def describe(case, meta):
    if meta is None or "error" in meta:
        return f"--- {case['name']} --- ERROR {meta and meta.get('error')}"
    hdr = meta["hdr"]
    return (f"--- {case['name']} --- sr {meta['sr']:.0f} vs {SIGVS} K {hdr[2]:.0f} B {hdr[3]:.0f} L {hdr[4]:.0f} "
            f"paired {hdr[14]:.0f}/{hdr[15]:.0f} maxabs {meta['maxabs1']:.4f}/{meta['maxabs2']:.4f} "
            f"nan {meta['nan']:.0f} wall {meta['harness_wall_s']:.1f}s")


# ---- analysis helpers ----------------------------------------------------------------------

def db(x):
    return 20 * math.log10(max(abs(x), 1e-12))


def peak_near(ch, center, half=40):
    lo = max(0, int(center) - half)
    hi = min(len(ch), int(center) + half + 1)
    seg = ch[lo:hi]
    if not seg:
        return None, 0.0
    j = max(range(len(seg)), key=lambda i: abs(seg[i]))
    return lo + j, seg[j]


def energy_near(ch, center, half=40):
    lo = max(0, int(center) - half)
    hi = min(len(ch), int(center) + half + 1)
    return sum(v * v for v in ch[lo:hi])


def ref_index(data):
    ref = data.get("ch3", [])
    for i, v in enumerate(ref):
        if v > 0.5:
            return i
    return None


def check_echo(tag, ch, expect, errors, tol=1):
    idx, val = peak_near(ch, expect)
    if idx is None or abs(idx - expect) > tol:
        errors.append(f"{tag}: peak at {idx}, expected {expect:.0f} (+-{tol})")
    return idx, val


def check(case, meta, data, errors):
    name = case["name"]
    if meta is None:
        errors.append(f"{name}: no measurement")
        return
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: {meta.get('nan')} non-finite samples")
    hdr = meta.get("hdr", [])
    sc = meta.get("scope", [])
    sr = meta["sr"]
    L = case["L"]
    T = round(0.1 * sr)

    if name == "compile":
        if meta["maxabs1"] < 0.1:
            errors.append(f"compile: dry output silent (maxabs {meta['maxabs1']}) — gen compile failure?")
        if len(hdr) < 16 or hdr[14] != 1 or hdr[15] != 1:
            errors.append(f"compile: Start/End do not see each other (hdr14/15 = {hdr[14:16]})")
        if hdr[3] != SIGVS:
            errors.append(f"compile: B = {hdr[3]}, expected the signal vector size {SIGVS} (Start sorts before End)")
        if hdr[2] != 0:
            errors.append(f"compile: K = {hdr[2]}, expected 0 (same-vector lockstep)")
        return

    if name == "debug":
        if len(hdr) < 12 or abs(hdr[10] - L) > 1:
            errors.append(f"debug: ping-measured latency hdr[10] = {hdr[10:11]}, expected {L} (+-1)")
        if len(hdr) > 11 and hdr[11] < 2:
            errors.append(f"debug: expected >= 2 pings, got {hdr[11]}")
        if len(hdr) > 17 and hdr[17] != 0:
            errors.append(f"debug: loop error hdr[17] = {hdr[17]}, expected 0")
        print(f"ping latency {hdr[10]:.0f} (L {L}), pings {hdr[11]:.0f}, loop error hdr[17] {hdr[17] if len(hdr) > 17 else 'n/a'}")
        return

    if name == "blowup":
        if max(meta["maxabs1"], meta["maxabs2"]) >= 2.0:
            errors.append(f"blowup: output peak {max(meta['maxabs1'], meta['maxabs2']):.3f} >= 2.0")
        if meta["maxabs1"] < 1e-4:
            errors.append("blowup: output silent")
        return

    if data is None:
        errors.append(f"{name}: no recorded data")
        return
    r0 = ref_index(data)
    if r0 is None:
        errors.append(f"{name}: reference marker not recorded")
        return
    l, r = data["ch1"], data["ch2"]
    dry = r0 + L

    if name.startswith("timing"):
        g = case["gain"]
        di, dv = check_echo("dry", l, dry, errors)
        print(f"dry at {di - r0} (L {L}), peak {dv:.3f}")
        peaks = []
        for n in range(1, 5):
            i, v = check_echo(f"echo{n}", l, dry + n * T, errors)
            peaks.append(v)
            print(f"echo{n} at +{i - dry} (expect {n * T}), peak {v:.4f}")
        if abs(db(peaks[0] / dv) - db(g)) > 0.5:
            errors.append(f"{name}: echo1/dry {db(peaks[0] / dv):.2f} dB, expected {db(g):.2f} (+-0.5)")
        # Return path: End input = tap * g, fed back through softsat(x * fb, 1.5): predict each tap from the last.
        tap = peaks[0] / g
        for n in range(2, 5):
            tap = 1.5 * math.tanh(g * tap * 0.5 / 1.5)
            want = g * tap
            got = peaks[n - 1]
            print(f"echo{n}/predicted {db(got / want):+.2f} dB")
            if abs(db(got / want)) > 0.5:
                errors.append(f"{name}: echo{n} {db(got / want):+.2f} dB from predicted (+-0.5)")
        # right channel mirrors left
        ri, rv = check_echo("echo1 R", r, dry + T, errors)

    elif name == "clamp":
        B = hdr[3]
        tmin = B + L + 4
        if len(sc) < 4 or sc[2] != 1:
            errors.append(f"clamp: scope[2] clamped flag = {sc[2:3]}, expected 1")
        if len(sc) > 3 and abs(sc[3] - tmin) > 0.5:
            errors.append(f"clamp: scope[3] tmin = {sc[3]}, expected {tmin}")
        for n in (1, 2):
            i, v = check_echo(f"echo{n}", l, dry + n * tmin, errors)
            print(f"echo{n} at +{i - dry} (tmin {tmin:.0f}, B {B:.0f}), peak {v:.4f}")

    elif name == "pingpong":
        for n, strong, weak in ((1, l, r), (2, r, l), (3, l, r)):
            c = dry + n * T
            es, ew = energy_near(strong, c), energy_near(weak, c)
            sep = 10 * math.log10(max(es, 1e-12) / max(ew, 1e-12))
            print(f"echo{n}: {'L' if strong is l else 'R'} dominant by {sep:.1f} dB (energy {es:.4f})")
            if es < 1e-4:
                errors.append(f"pingpong: echo{n} missing (energy {es})")
            if sep < 30:
                errors.append(f"pingpong: echo{n} not on the expected channel (separation {sep:.1f} dB)")
            check_echo(f"pingpong echo{n}", strong, c, errors)

    elif name == "midside":
        # impulse on L only: mid = side = A/2. Mid echo (T) is in phase on both sides, side echo
        # (1.5T) comes out +A/2 on the left and -A/2 on the right.
        a, b = dry + T, dry + int(1.5 * T)
        iL, vL = check_echo("mid echo L", l, a, errors)
        mL, mR = l[iL], r[iL]
        jL, _ = check_echo("side echo L", l, b, errors)
        sL, sR = l[jL], r[jL]
        print(f"mid echo L {mL:+.3f} R {mR:+.3f}; side echo L {sL:+.3f} R {sR:+.3f}")
        if mL <= 0 or mR <= 0 or abs(db(abs(mL) / max(abs(mR), 1e-9))) > 0.5:
            errors.append(f"midside: mid echo should be equal and positive on both sides (L {mL:+.3f}, R {mR:+.3f})")
        if sL <= 0 or sR >= 0 or abs(db(abs(sL) / max(abs(sR), 1e-9))) > 0.5:
            errors.append(f"midside: side echo should be +L / -R (L {sL:+.3f}, R {sR:+.3f})")

    elif name == "invert":
        i1, _ = check_echo("echo1", l, dry + T, errors)
        i2, _ = check_echo("echo2", l, dry + 2 * T, errors)
        print(f"echo1 {l[i1]:+.3f}, echo2 {l[i2]:+.3f}")
        if not (l[i1] > 0 and l[i2] < 0):
            errors.append(f"invert: expected echo1 > 0 and echo2 < 0 (got {l[i1]:+.3f}, {l[i2]:+.3f})")

    elif name == "gate":
        e = energy_near(l, dry + T)
        print(f"echo energy with the gate closed: {e:.2e}")
        if e > 1e-7:
            errors.append(f"gate: a hit below the threshold still echoes (energy {e:.2e})")

    elif name == "filter":
        di, dv = check_echo("dry", l, dry, errors, tol=2)
        e1 = max(abs(v) for v in l[dry + T - 40:dry + T + 40])
        print(f"echo1/dry with LP 400 Hz: {db(e1 / dv):+.2f} dB")
        if db(e1 / dv) > -3:
            errors.append(f"filter: LP 400 Hz should darken the echo by > 3 dB (got {db(e1 / dv):+.2f} dB)")

    elif name == "offset":
        iL, vL = check_echo("left echo", l, dry + T, errors)
        iR, vR = check_echo("right echo", r, dry + int(1.5 * T), errors)
        print(f"left echo at +{iL - dry} (T {T}), right echo at +{iR - dry} (1.5T {int(1.5 * T)})")
        if energy_near(r, dry + T) > 1e-3 * energy_near(r, dry + int(1.5 * T)):
            errors.append("offset: right channel has energy at T")
        if energy_near(l, dry + int(1.5 * T)) > 1e-3 * energy_near(l, dry + T):
            errors.append("offset: left channel has energy at 1.5T")

    elif name == "freeze":
        wins = []
        for n in range(5, 13):
            s = r0 + n * T
            a, b = s + int(0.005 * sr), s + int(0.075 * sr)
            seg = l[a:b]
            rms = math.sqrt(sum(v * v for v in seg) / max(len(seg), 1))
            wins.append(db(rms))
        print("freeze window levels (dB): " + " ".join(f"{w:.2f}" for w in wins))
        if min(wins) < -60:
            errors.append(f"freeze: loop went silent ({min(wins):.1f} dB)")
        if max(wins) - min(wins) > 1.0:
            errors.append(f"freeze: level drifts {max(wins) - min(wins):.2f} dB over repeats (> 1 dB)")


def main():
    with open(START_PATH, encoding="utf-8") as f:
        start_code = f.read()
    with open(END_PATH, encoding="utf-8") as f:
        end_code = f.read()
    only = set(sys.argv[1:])
    todo = [c for c in cases() if not only or c["name"] in only]
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, max(len(todo), 1))) as ex:
        runs = list(ex.map(lambda c: run_case(start_code, end_code, c), todo))
    errors = []
    results = []
    for case, (meta, data) in zip(todo, runs):
        before = len(errors)
        print(describe(case, meta))
        if meta is not None and "error" in meta:
            errors.append(f"{case['name']}: {meta['error']}")
        else:
            check(case, meta, data, errors)
        results.append((case["name"], "PASS" if len(errors) == before else "FAIL"))
        print(f"[{results[-1][1]}] {case['name']}")
    print("=== summary ===")
    for n, s in results:
        print(f"{s} {n}")
    if errors:
        print("FAILED")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("delayplus audio checks passed")


if __name__ == "__main__":
    main()
