#!/usr/bin/env python3
"""Render EQ+ through the shared Max harness and check the biquad path.

The device's gen reads coefficients from buffer~ ---eqpluscfg (8 bands x 8 floats)
and writes the pre/post ring to buffer~ ---eqplusspec. This runner pokes one band
with the same coefficients src/eqplus_config.js uses for the curve, then measures
the rendered sine.

Run it inside the tart VM (AGENTS.md 1a). Do not launch Max on the host.

Cases:
  bypass     — every band off, 1 kHz sine, output RMS matches the input
  bell       — +12 dB bell at 1 kHz boosts a 1 kHz sine by about 12 dB
  notch      — a notch at 1 kHz drops a 1 kHz sine by more than 25 dB
  lowcut_low — Low-Cut 4 at 1 kHz attenuates 200 Hz
  lowcut_high— Low-Cut 4 at 1 kHz passes 5 kHz
  gain6      — output gain +6 dB on a flat EQ
  cascade    — two +6 dB bells at 1 kHz add to about +12 dB
  tilt_low   — flat tilt +12 dB at 200 Hz
  tilt_high  — flat tilt +12 dB at 10 kHz
  lat0       — Zero Latency noise is undelayed
  latnat     — Natural Phase noise is delayed by about 350 samples
  latlin     — Linear Phase noise is delayed by 3072 samples
  lr_right   — route Right, curve A flat and curve B a +12 dB bell: left stays
               unity and the right channel rises about 12 dB
  ms_side    — route Side, a notch on the side, a pure side input: both
               outputs drop by more than 25 dB
  The bypass and bell cases also require ---eqplusspec to carry non-zero pre and
  post samples and a write index that has left 0.
"""

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN_PATH = os.path.join(ROOT, "src", "eqplus_core.genexpr")
FFT_PATH = os.path.join(ROOT, "src", "cepstrum_lib.genexpr")
CONFIG_PATH = os.path.join(ROOT, "src", "eqplus_config.js")
SR = mh.DEFAULT_SR
AMP = 0.2

# Classic js (the harness probe object). Coefficients arrive as `setup <sections> <b0> ...`
# after `setbufs` has delivered the expanded --- buffer names.
PROBE_JS = r"""
inlets = 1;
outlets = 1;

var cfgName = "";
var specName = "";
var resultPath = "";
var armed = false;
var stereoRec = 0;

function resultpath(p) { resultPath = String(p); }

function stereo(v) { stereoRec = (+v) > 0.5 ? 1 : 0; }

function setbufs(cfg, spec) {
    cfgName = cfg ? String(cfg) : "";
    specName = spec ? String(spec) : "";
}

function pokeBand(band, sections, b0, b1, b2, a1, a2) {
    if (!cfgName) return;
    var buf = new Buffer(cfgName);
    var base = band * 8;
    buf.poke(1, base, +sections);
    buf.poke(1, base + 1, +b0);
    buf.poke(1, base + 2, +b1);
    buf.poke(1, base + 3, +b2);
    buf.poke(1, base + 4, +a1);
    buf.poke(1, base + 5, +a2);
}

function setup(sections, b0, b1, b2, a1, a2, sections2, c0, c1, c2, d1, d2) {
    if (!cfgName) return;
    var buf = new Buffer(cfgName);
    var i;
    for (i = 0; i < 64; i++) buf.poke(1, i, 0);
    pokeBand(0, sections, b0, b1, b2, a1, a2);
    if (arguments.length >= 12) pokeBand(1, sections2, c0, c1, c2, d1, d2);
}

function setup2(sections, b0, b1, b2, a1, a2) {
    pokeBand(1, sections, b0, b1, b2, a1, a2);
}

function setupB(sections, b0, b1, b2, a1, a2) {
    var buf = new Buffer(cfgName);
    var i;
    for (i = 64; i < 128; i++) buf.poke(1, i, 0);
    pokeBand(8, sections, b0, b1, b2, a1, a2);
}

function loadbang() {
    post("PROBE_LOADED\n");
}

function one(buf, ch, index) {
    var v = buf.peek(ch, index, 1);
    if (typeof v === "number") return v;
    if (v && v.length) return +v[0];
    return 0;
}

function readChannel(buf, channel, n) {
    var out = [];
    var i, k, count, chunk;
    for (i = 0; i < n; i += 2048) {
        count = Math.min(2048, n - i);
        chunk = buf.peek(channel, i, count);
        if (typeof chunk === "number") {
            out.push(chunk);
            continue;
        }
        if (!chunk) {
            for (k = 0; k < count; k++) out.push(0);
            continue;
        }
        for (k = 0; k < count; k++) out.push(chunk[k]);
    }
    return out;
}

function stats(a) {
    var sum = 0, peak = 0, nan = 0, n = 0, i, v, av;
    for (i = 0; i < a.length; i++) {
        v = a[i];
        if (v !== v || v === Infinity || v === -Infinity) { nan++; continue; }
        n++;
        sum += v * v;
        av = v < 0 ? -v : v;
        if (av > peak) peak = av;
    }
    return { rms: n ? Math.sqrt(sum / n) : 0, peak: peak, nan: nan };
}

function ringStats(buf, ch) {
    var chunk = buf.peek(ch, 8, 1024);
    var i, v, av, sum = 0, peak = 0, n = 0;
    if (typeof chunk === "number") return { peak: Math.abs(chunk), rms: Math.abs(chunk) };
    if (!chunk) return { peak: 0, rms: 0 };
    for (i = 0; i < chunk.length; i++) {
        v = chunk[i];
        if (v !== v || v === Infinity || v === -Infinity) continue;
        n++;
        sum += v * v;
        av = v < 0 ? -v : v;
        if (av > peak) peak = av;
    }
    return { peak: peak, rms: n ? Math.sqrt(sum / n) : 0 };
}

function bestLag(inn, out) {
    var n = Math.min(inn.length, out.length);
    var maxLag = 3600;
    var start = 2000;
    var len = 2048;
    if (n < start + len + maxLag) {
        start = 0;
        len = Math.max(0, n - maxLag);
    }
    if (len < 64) return -1;
    var bestL = 0;
    var bestC = -1e99;
    var lag, i, c, a, b, lo, hi;
    for (lag = 0; lag <= maxLag; lag += 4) {
        c = 0;
        for (i = 0; i < len; i += 2) {
            a = inn[start + i];
            b = out[start + i + lag];
            if (a !== a || b !== b) continue;
            c += a * b;
        }
        if (c > bestC) { bestC = c; bestL = lag; }
    }
    lo = bestL - 4;
    if (lo < 0) lo = 0;
    hi = bestL + 4;
    if (hi > maxLag) hi = maxLag;
    for (lag = lo; lag <= hi; lag++) {
        c = 0;
        for (i = 0; i < len; i += 2) {
            a = inn[start + i];
            b = out[start + i + lag];
            if (a !== a || b !== b) continue;
            c += a * b;
        }
        if (c > bestC) { bestC = c; bestL = lag; }
    }
    return bestL;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 48000;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var left = readChannel(rec, 1, n);
    var right = stereoRec ? readChannel(rec, 2, n) : left;
    var inn = readChannel(rec, stereoRec ? 3 : 2, n);
    var outS = stats(left);
    var rightS = stats(right);
    var inS = stats(inn);
    var lag = bestLag(inn, left);
    function corrAt(lagN) {
        var n = Math.min(inn.length, left.length);
        var start = 2000;
        var len = 2048;
        var i, c = 0, a, b;
        if (start + len + lagN >= n) return 0;
        for (i = 0; i < len; i += 2) {
            a = inn[start + i];
            b = left[start + i + lagN];
            if (a !== a || b !== b) continue;
            c += a * b;
        }
        return c;
    }
    var c0 = corrAt(0);
    var c350 = corrAt(350);
    var c3072 = corrAt(3072);
    var b8 = -1;
    try { b8 = one(new Buffer(cfgName), 1, 64); } catch (eB) {}
    var prePeak = -1, postPeak = -1, preRms = -1, postRms = -1;
    var writeIdx = -1, frameTick = -1, specSr = -1;
    try {
        var spec = new Buffer(specName);
        writeIdx = one(spec, 1, 0);
        frameTick = one(spec, 2, 0);
        specSr = one(spec, 1, 1);
        var pre = ringStats(spec, 1);
        var post = ringStats(spec, 2);
        prePeak = pre.peak;
        preRms = pre.rms;
        postPeak = post.peak;
        postRms = post.rms;
    } catch (e) {}
    var report = new File(resultPath, "write", "TEXT");
    report.eof = 0;
    report.writestring(
        "inRms " + inS.rms + "\n" +
        "outRms " + outS.rms + "\n" +
        "rRms " + rightS.rms + "\n" +
        "inPeak " + inS.peak + "\n" +
        "outPeak " + outS.peak + "\n" +
        "nan " + (outS.nan + inS.nan + (stereoRec ? rightS.nan : 0)) + "\n" +
        "sr " + sr + "\n" +
        "prePeak " + prePeak + "\n" +
        "postPeak " + postPeak + "\n" +
        "preRms " + preRms + "\n" +
        "postRms " + postRms + "\n" +
        "writeIdx " + writeIdx + "\n" +
        "frameTick " + frameTick + "\n" +
        "specSr " + specSr + "\n" +
        "lag " + lag + "\n" +
        "c0 " + c0 + "\n" +
        "c350 " + c350 + "\n" +
        "c3072 " + c3072 + "\n" +
        "stereo " + stereoRec + "\n" +
        "b8 " + b8 + "\n"
    );
    report.close();
    outlet(0, "bang");
}
"""


def write_probe():
    path = os.path.join(tempfile.gettempdir(), "eqplus_audio_probe.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write(PROBE_JS)
    return path


FIXTURES_PATH = os.path.join(ROOT, "scripts", "eqplus_audio_fixtures.json")


def node_cached(node_src, args):
    """Run node on the host and record the output in FIXTURES_PATH; in the VM (no node)
    the recorded output is replayed. Regenerate on the host after changing eqplus_config.js."""
    key = json.dumps([node_src, [str(a) for a in args]])
    try:
        with open(FIXTURES_PATH, encoding="utf-8") as f:
            fx = json.load(f)
    except (OSError, ValueError):
        fx = {}
    if shutil.which("node"):
        cmd = [shutil.which("node"), "-e", node_src, CONFIG_PATH] + [str(a) for a in args]
        proc = subprocess.run(cmd,
                              check=True, capture_output=True, text=True)
        if fx.get(key) != proc.stdout:
            fx[key] = proc.stdout
            with open(FIXTURES_PATH, "w", encoding="utf-8") as f:
                json.dump(fx, f, indent=0, sort_keys=True)
        return proc.stdout
    if key not in fx:
        raise SystemExit("no node and no recorded fixture for " + key[:80] + " (run once on the host)")
    return fx[key]


def biquad_setup(mode, freq, gain, q, sr=SR):
    """sections b0 b1 b2 a1 a2 from eqplus_config.js, so the render matches the curve."""
    node = r"""
const cfg = require(process.argv[1]);
const c = cfg.eqpBiquadCoeffs(+process.argv[2], +process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6]);
const vals = [c.sections, c.b0, c.b1, c.b2, c.a1, c.a2];
if (vals.some(function (v) { return !Number.isFinite(v); })) {
    console.error("non-finite coeffs " + JSON.stringify(c));
    process.exit(1);
}
process.stdout.write(vals.map(function (v) { return Number(v).toFixed(9); }).join(" "));
"""
    return "setup " + node_cached(node, [mode, freq, gain, q, sr]).strip()


def tilt_message(tilt_db, freq, sr=SR):
    """Comma-separated gen messages for a flat tilt, plus the expected dB at freq."""
    node = r"""
const cfg = require(process.argv[1]);
const tilt = +process.argv[2];
const freq = +process.argv[3];
const sr = +process.argv[4];
const c = cfg.eqpTiltCoeffs(tilt, sr);
const parts = ["tiltOn " + c.on, "tGain " + c.gain.toFixed(9)];
c.sections.forEach(function (s, i) {
    ["b0", "b1", "a1"].forEach(function (k) {
        parts.push("t" + i + k + " " + Number(s[k]).toFixed(9));
    });
});
const db = cfg.eqpTiltResponseDb(tilt, freq, sr);
process.stdout.write(parts.join(", ") + "\n" + db.toFixed(6));
"""
    msg, db = node_cached(node, [tilt_db, freq, sr]).strip().split("\n")
    return msg, float(db)


def cases():
    flat = "setup 0 0 0 0 0 0"
    bell = biquad_setup(6, 1000, 12, 0.7071)
    bell6 = biquad_setup(6, 1000, 6, 0.7071)
    notch = biquad_setup(7, 1000, 0, 0.7071)
    lowcut = biquad_setup(3, 1000, 0, 0.7071)
    tilt_low_msg, tilt_low_db = tilt_message(12, 200)
    tilt_high_msg, tilt_high_db = tilt_message(12, 10000)
    return (
        {"name": "bypass", "freq": 1000, "setup": flat, "spec": True},
        {"name": "bell", "freq": 1000, "setup": bell, "spec": True},
        {"name": "notch", "freq": 1000, "setup": notch, "spec": False},
        {"name": "lowcut_low", "freq": 200, "setup": lowcut, "spec": False},
        {"name": "lowcut_high", "freq": 5000, "setup": lowcut, "spec": False},
        {"name": "gain6", "freq": 1000, "setup": flat, "outgain": "outgain 6", "want_db": 6.0, "tol": 0.4},
        {"name": "cascade", "freq": 1000, "setup": "setup " + bell6.split(" ", 1)[1] + " " + bell6.split(" ", 1)[1], "want_db": 12.0, "tol": 0.8},
        {"name": "tilt_low", "freq": 200, "setup": flat, "extra": tilt_low_msg, "want_db": tilt_low_db, "tol": 0.6},
        {"name": "tilt_high", "freq": 10000, "setup": flat, "extra": tilt_high_msg, "want_db": tilt_high_db, "tol": 0.6},
        {"name": "lat0", "noise": True, "setup": flat, "phase": "phaseMode 0", "lag": 0, "lag_tol": 4},
        {"name": "latnat", "noise": True, "setup": flat, "phase": "phaseMode 1", "lag": 350, "lag_tol": 6},
        {"name": "latlin", "noise": True, "setup": flat, "phase": "phaseMode 2", "lag": 3072, "lag_tol": 8},
        {"name": "lr_right", "freq": 1000, "setup": flat, "setupB": "setupB " + bell.split(" ", 1)[1],
         "route": "chroute 2", "stereo": True, "want_db": 0.0, "want_rdb": 12.0, "tol": 0.8},
        {"name": "ms_side", "freq": 1000, "setup": flat, "setupB": "setupB " + notch.split(" ", 1)[1],
         "route": "chroute 4", "stereo": True, "invert_r": True, "quiet": True},
    )


def device(gen_code, case):
    tone = "noise~" if case.get("noise") else "cycle~ %s" % case["freq"]
    boxes = [
        mh.gen_box("dev-gen", gen_code, 200, 240, numinlets=4, numoutlets=2),
        mh.box("dev-seq", "t b b", 40, 80, 50, numoutlets=2, outlettype=["bang", "bang"]),
        mh.msg("dev-setbufs", "setbufs ---eqpluscfg ---eqplusspec", 40, 120, 240),
        mh.msg("dev-bind", "eqcfg ---eqpluscfg, spec ---eqplusspec, irspec ---eqplusir", 300, 120, 360),
        mh.msg("dev-setup", case["setup"], 40, 160, 520),
        mh.msg("dev-outgain", case.get("outgain", "outgain 0"), 40, 190, 80),
        mh.msg("dev-phase", case.get("phase", "phaseMode 0"), 40, 220, 100),
        mh.msg("dev-route", case.get("route", "chroute 0"), 140, 220, 80),
        mh.box("dev-cfg", "buffer~ ---eqpluscfg @samps 128", 700, 80, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-spec", "buffer~ ---eqplusspec 200 4 @samps 8200", 700, 110, 280, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-ir", "buffer~ ---eqplusir 4096 3", 700, 140, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-tone", tone, 200, 200, 90, numinlets=2, outlettype=["signal"]),
        mh.box("dev-amp", "*~ %s" % AMP, 200, 320, 60, numinlets=2, outlettype=["signal"]),
    ]
    if case.get("setup2"):
        boxes.append(mh.msg("dev-setup2", case["setup2"], 40, 250, 520))
    if case.get("setupB"):
        boxes.append(mh.msg("dev-setupb", case["setupB"], 40, 250, 520))
    if case.get("stereo"):
        boxes.append(mh.msg("dev-stereo", "stereo 1", 160, 250, 70))
    if case.get("invert_r"):
        boxes.append(mh.box("dev-inv", "*~ -1", 280, 320, 50, numinlets=2, outlettype=["signal"]))
    if case.get("extra"):
        boxes.append(mh.msg("dev-extra", case["extra"], 40, 280, 900))
    lines = [
        mh.line("obj-load", 0, "dev-seq", 0),
        # Right outlet fires first (buffer names + gen bind), then the coefficient poke.
        mh.line("dev-seq", 1, "dev-setbufs", 0),
        mh.line("dev-seq", 1, "dev-bind", 0),
        mh.line("dev-seq", 0, "dev-setup", 0),
        mh.line("dev-seq", 0, "dev-outgain", 0),
        mh.line("dev-seq", 0, "dev-phase", 0),
        mh.line("dev-seq", 0, "dev-route", 0),
        mh.line("dev-setbufs", 0, "obj-js", 0),
        mh.line("dev-setup", 0, "obj-js", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-outgain", 0, "dev-gen", 0),
        mh.line("dev-phase", 0, "dev-gen", 0),
        mh.line("dev-route", 0, "dev-gen", 0),
        mh.line("dev-tone", 0, "dev-amp", 0),
        mh.line("dev-amp", 0, "dev-gen", 0),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    if case.get("invert_r"):
        lines.append(mh.line("dev-amp", 0, "dev-inv", 0))
        lines.append(mh.line("dev-inv", 0, "dev-gen", 1))
    else:
        lines.append(mh.line("dev-amp", 0, "dev-gen", 1))
    if case.get("stereo"):
        lines.append(mh.line("dev-gen", 1, "obj-record", 1))
        lines.append(mh.line("dev-amp", 0, "obj-record", 2))
    else:
        lines.append(mh.line("dev-amp", 0, "obj-record", 1))
    if case.get("setup2"):
        lines.append(mh.line("dev-seq", 0, "dev-setup2", 0))
        lines.append(mh.line("dev-setup2", 0, "obj-js", 0))
    if case.get("setupB"):
        lines.append(mh.line("dev-seq", 0, "dev-setupb", 0))
        lines.append(mh.line("dev-setupb", 0, "obj-js", 0))
    if case.get("stereo"):
        lines.append(mh.line("dev-seq", 0, "dev-stereo", 0))
        lines.append(mh.line("dev-stereo", 0, "obj-js", 0))
    if case.get("extra"):
        lines.append(mh.line("dev-seq", 0, "dev-extra", 0))
        lines.append(mh.line("dev-extra", 0, "dev-gen", 0))
    return boxes, lines


def gain_db(meta, key="outRms"):
    inn = meta.get("inRms") or 0
    out = meta.get(key) or 0
    if inn <= 1e-8:
        return -999.0
    return 20.0 * math.log10(max(out, 1e-12) / inn)


def require_input(name, meta, errors, noise):
    inn = meta.get("inRms", 0)
    if noise:
        if not (0.05 <= inn <= 0.25):
            errors.append("%s: noise input RMS %s" % (name, inn))
    elif not (0.12 <= inn <= 0.17):
        errors.append("%s: input RMS %s (expected ~%.3f)" % (name, inn, AMP / math.sqrt(2)))
    if meta.get("nan", 1) != 0:
        errors.append("%s: %s non-finite samples" % (name, meta.get("nan")))


def require_spec(name, meta, errors, post_loud):
    tick = meta.get("frameTick", -1)
    idx = meta.get("writeIdx", -1)
    if tick < 32:
        errors.append("%s: spectrum frameTick did not advance (%s)" % (name, tick))
    # writeIdx is stored only on the 64-sample heartbeat, and it is 0 whenever the
    # render length wraps the 8192-sample ring. A live frameTick means the gen ran.
    if tick >= 32 and not (0 <= idx < 8192):
        errors.append("%s: writeIdx out of range (%s)" % (name, idx))
    elif tick < 32 and not (0 < idx < 8192):
        errors.append("%s: writeIdx did not advance (%s)" % (name, idx))
    if meta.get("prePeak", 0) < 0.04:
        errors.append("%s: pre spectrum is silent (%s)" % (name, meta.get("prePeak")))
    if post_loud and meta.get("postPeak", 0) < 0.04:
        errors.append("%s: post spectrum is silent (%s)" % (name, meta.get("postPeak")))
    sr = meta.get("specSr", 0)
    if not (40000 <= sr <= 200000):
        errors.append("%s: spec sample rate %s" % (name, sr))


def check(case, meta, errors):
    name = case["name"]
    if meta is None:
        errors.append("%s: no measurement" % name)
        return
    require_input(name, meta, errors, case.get("noise"))
    db = gain_db(meta)
    if "want_db" in case:
        if abs(db - case["want_db"]) > case.get("tol", 0.5):
            errors.append("%s: measured %+.2f dB, want %+.2f" % (name, db, case["want_db"]))
    if "want_rdb" in case:
        rdb = gain_db(meta, "rRms")
        if abs(rdb - case["want_rdb"]) > case.get("tol", 0.5):
            errors.append("%s: right channel %+.2f dB, want %+.2f" % (name, rdb, case["want_rdb"]))
    if case.get("quiet"):
        rdb = gain_db(meta, "rRms")
        if db > -25 or rdb > -25:
            errors.append("%s: side notch left %+.2f / %+.2f dB" % (name, db, rdb))
    if "lag" in case:
        # A full-range argmax on noise can lock onto a side peak. The correlation
        # at the true delay equals the window energy; the other candidates do not.
        score = {0: meta.get("c0", 0), 350: meta.get("c350", 0), 3072: meta.get("c3072", 0)}
        got = score.get(case["lag"], 0)
        others = [v for k, v in score.items() if k != case["lag"]]
        if not (got > 5 and got > 5 * max(abs(v) for v in others)):
            errors.append("%s: delay correlation at %s is %s (others %s)" % (name, case["lag"], got, others))
        if abs(db) > 0.8:
            errors.append("%s: delayed path is not unity (%+.2f dB)" % (name, db))
    if name == "bypass":
        if abs(db) > 0.35:
            errors.append("%s: flat path is not unity (%+.2f dB)" % (name, db))
        require_spec(name, meta, errors, True)
    elif name == "bell":
        if abs(db - 12.0) > 0.7:
            errors.append("%s: +12 dB bell measured %+.2f dB" % (name, db))
        require_spec(name, meta, errors, True)
        pre = meta.get("preRms") or 0
        post = meta.get("postRms") or 0
        if pre > 0.01:
            spec_db = 20.0 * math.log10(max(post, 1e-12) / pre)
            if abs(spec_db - 12.0) > 1.2:
                errors.append("%s: spectrum post/pre is %+.2f dB" % (name, spec_db))
    elif name == "notch":
        if db > -25:
            errors.append("%s: notch only attenuated by %+.2f dB" % (name, db))
    elif name == "lowcut_low":
        if db > -6:
            errors.append("%s: Low-Cut 4 did not attenuate 200 Hz (%+.2f dB)" % (name, db))
    elif name == "lowcut_high":
        if abs(db) > 1.25:
            errors.append("%s: Low-Cut 4 did not pass 5 kHz (%+.2f dB)" % (name, db))


def main():
    args = sys.argv[1:]
    if args and args[0] == "--fixtures":
        cases()  # runs every node step, recording the fixtures
        print("fixtures written")
        return
    gen_path = GEN_PATH
    if args and args[0].endswith(".genexpr"):
        gen_path = args[0]
        args = args[1:]
    only = set(args)
    with open(gen_path, encoding="utf-8") as f:
        gen_code = f.read()
    if os.path.abspath(gen_path) == os.path.abspath(GEN_PATH):
        with open(FFT_PATH, encoding="utf-8") as f:
            gen_code = f.read().rstrip() + "\n" + gen_code
    probe_js = write_probe()
    errors = []
    for case in cases():
        if only and case["name"] not in only:
            continue
        boxes, lines = device(gen_code, case)
        meta = mh.run_case(
            "eqplus_" + case["name"], boxes, lines, probe_js=probe_js,
            settle_ms=400, dur_ms=400, channels=3 if case.get("stereo") else 2, sr=SR, mode="nrt",
        )
        db = gain_db(meta) if meta else None
        db_txt = "%.2f" % db if db is not None and db > -900 else "?"
        print("--- %s ---" % case["name"])
        print(
            "inRms %s outRms %s rRms %s dB %s lag %s stereo %s b8 %s nan %s"
            % (
                meta.get("inRms"), meta.get("outRms"), meta.get("rRms"), db_txt, meta.get("lag"),
                meta.get("stereo"), meta.get("b8"), meta.get("nan"),
            )
        )
        check(case, meta, errors)
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
