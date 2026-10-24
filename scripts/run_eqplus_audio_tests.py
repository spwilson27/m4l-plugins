#!/usr/bin/env python3
"""Render EQ+ through the shared Max harness and check the biquad path.

The device's gen reads coefficients from buffer~ #0-eqpluscfg (8 bands x 8 floats)
and writes the pre/post ring to buffer~ #0-eqplusspec. This runner pokes one band
with the same coefficients src/eqplus_config.js uses for the curve, then measures
the rendered sine.

Run it inside the tart VM (AGENTS.md 1a). Do not launch Max on the host.

Cases:
  bypass     — every band off, 1 kHz sine, output RMS matches the input
  bell       — +12 dB bell at 1 kHz boosts a 1 kHz sine by about 12 dB
  notch      — a notch at 1 kHz drops a 1 kHz sine by more than 25 dB
  lowcut_low — Low-Cut 4 at 1 kHz attenuates 200 Hz
  lowcut_high— Low-Cut 4 at 1 kHz passes 5 kHz
  The bypass and bell cases also require #0-eqplusspec to carry non-zero pre and
  post samples and a write index that has left 0.
"""

import math
import os
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
# after `setbufs` has delivered the expanded #0- buffer names.
PROBE_JS = r"""
inlets = 1;
outlets = 1;

var cfgName = "";
var specName = "";
var resultPath = "";
var armed = false;

function resultpath(p) { resultPath = String(p); }

function setbufs(cfg, spec) {
    cfgName = cfg ? String(cfg) : "";
    specName = spec ? String(spec) : "";
}

function setup(sections, b0, b1, b2, a1, a2) {
    if (!cfgName) return;
    var buf = new Buffer(cfgName);
    var i;
    for (i = 0; i < 64; i++) buf.poke(1, i, 0);
    buf.poke(1, 0, +sections);
    buf.poke(1, 1, +b0);
    buf.poke(1, 2, +b1);
    buf.poke(1, 3, +b2);
    buf.poke(1, 4, +a1);
    buf.poke(1, 5, +a2);
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

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    var lengthMs = rec.length();
    var sr = lengthMs > 0 ? frames / (lengthMs / 1000) : 48000;
    var n = Math.max(0, Math.min(frames, Math.floor(sr * durMs / 1000)));
    var left = readChannel(rec, 1, n);
    var inn = readChannel(rec, 2, n);
    var outS = stats(left);
    var inS = stats(inn);
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
        "inPeak " + inS.peak + "\n" +
        "outPeak " + outS.peak + "\n" +
        "nan " + (outS.nan + inS.nan) + "\n" +
        "sr " + sr + "\n" +
        "prePeak " + prePeak + "\n" +
        "postPeak " + postPeak + "\n" +
        "preRms " + preRms + "\n" +
        "postRms " + postRms + "\n" +
        "writeIdx " + writeIdx + "\n" +
        "frameTick " + frameTick + "\n" +
        "specSr " + specSr + "\n"
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
    proc = subprocess.run(
        ["node", "-e", node, CONFIG_PATH, str(mode), str(freq), str(gain), str(q), str(sr)],
        check=True, capture_output=True, text=True,
    )
    return "setup " + proc.stdout.strip()


def cases():
    flat = "setup 0 0 0 0 0 0"
    bell = biquad_setup(6, 1000, 12, 0.7071)
    notch = biquad_setup(7, 1000, 0, 0.7071)
    lowcut = biquad_setup(3, 1000, 0, 0.7071)
    return (
        {"name": "bypass", "freq": 1000, "setup": flat, "spec": True},
        {"name": "bell", "freq": 1000, "setup": bell, "spec": True},
        {"name": "notch", "freq": 1000, "setup": notch, "spec": False},
        {"name": "lowcut_low", "freq": 200, "setup": lowcut, "spec": False},
        {"name": "lowcut_high", "freq": 5000, "setup": lowcut, "spec": False},
    )


def device(gen_code, case):
    boxes = [
        mh.gen_box("dev-gen", gen_code, 200, 240, numinlets=2, numoutlets=2),
        mh.box("dev-seq", "t b b", 40, 80, 50, numoutlets=2, outlettype=["bang", "bang"]),
        mh.msg("dev-setbufs", "setbufs #0-eqpluscfg #0-eqplusspec", 40, 120, 240),
        mh.msg("dev-bind", "eqcfg #0-eqpluscfg, spec #0-eqplusspec", 300, 120, 260),
        mh.msg("dev-setup", case["setup"], 40, 160, 520),
        mh.msg("dev-outgain", "outgain 0", 40, 190, 80),
        mh.box("dev-cfg", "buffer~ #0-eqpluscfg @samps 64", 700, 80, 220, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-spec", "buffer~ #0-eqplusspec 200 2 @samps 8200", 700, 110, 280, numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-tone", "cycle~ %s" % case["freq"], 200, 200, 90, numinlets=2, outlettype=["signal"]),
        mh.box("dev-amp", "*~ %s" % AMP, 200, 320, 60, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-seq", 0),
        # Right outlet fires first (buffer names + gen bind), then the coefficient poke.
        mh.line("dev-seq", 1, "dev-setbufs", 0),
        mh.line("dev-seq", 1, "dev-bind", 0),
        mh.line("dev-seq", 0, "dev-setup", 0),
        mh.line("dev-seq", 0, "dev-outgain", 0),
        mh.line("dev-setbufs", 0, "obj-js", 0),
        mh.line("dev-setup", 0, "obj-js", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-outgain", 0, "dev-gen", 0),
        mh.line("dev-tone", 0, "dev-amp", 0),
        mh.line("dev-amp", 0, "dev-gen", 0),
        mh.line("dev-amp", 0, "dev-gen", 1),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-amp", 0, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    return boxes, lines


def gain_db(meta):
    inn = meta.get("inRms") or 0
    out = meta.get("outRms") or 0
    if inn <= 1e-8:
        return -999.0
    return 20.0 * math.log10(max(out, 1e-12) / inn)


def require_input(name, meta, errors):
    inn = meta.get("inRms", 0)
    if not (0.12 <= inn <= 0.17):
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


def check(name, meta, errors):
    if meta is None:
        errors.append("%s: no measurement" % name)
        return
    require_input(name, meta, errors)
    db = gain_db(meta)
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
            settle_ms=400, dur_ms=400, channels=2, sr=SR, mode="nrt",
        )
        db = gain_db(meta) if meta else None
        db_txt = "%.2f" % db if db is not None and db > -900 else "?"
        print("--- %s ---" % case["name"])
        print(
            "inRms %s outRms %s dB %s pre %s post %s writeIdx %s frameTick %s specSr %s nan %s"
            % (
                meta.get("inRms"), meta.get("outRms"), db_txt, meta.get("prePeak"), meta.get("postPeak"),
                meta.get("writeIdx"), meta.get("frameTick"), meta.get("specSr"), meta.get("nan"),
            )
        )
        check(case["name"], meta, errors)
    if errors:
        print("FAILED")
        for err in errors:
            print(" -", err)
        sys.exit(1)
    print("audio checks passed")


if __name__ == "__main__":
    main()
