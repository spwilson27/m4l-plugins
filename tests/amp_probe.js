// Amp audio probe. rec ch1 = device out 1, ch2 = raw model output (tapraw 1) or out 2.
// jsarguments: [ref buffer name] [settle samples]. Reports the error of ch2 against the reference
// buffer (offset by the settle period, which the scaffold drops from rec) and simple levels; maxerr1 is
// ch1 against the same reference (stereo cases: ch1 = raw left model output) or, for a 2-channel reference,
// against its channel 2 (sag: ch1 = the sag input gain); span2 = max - min of ch2, min1 = min of ch1.
inlets = 1;
outlets = 1;
var resultPath = "/tmp/amp_audio.txt";
var armed = false;
function resultpath(p) { resultPath = String(p); }
// `adstatus cpu` readings (audio_device perf cases only).
var cpuMax = 0, cpuSum = 0, cpuCount = 0;
function cpu(v) { cpuMax = Math.max(cpuMax, v); cpuSum += v; cpuCount++; }

function rd(buf, ch, off, n) {
    var out = [];
    for (var i = 0; i < n; i += 4096) {
        var k = Math.min(4096, n - i);
        var v = buf.peek(ch, off + i, k);
        if (typeof v === "number") v = [v];
        for (var j = 0; j < k; j++) out.push(v[j]);
    }
    return out;
}

function analyze(durMs) {
    if (armed) return;
    armed = true;
    var rec = new Buffer("rec");
    var frames = rec.framecount();
    if (jsarguments.length > 1 && String(jsarguments[1]) === "cpu") {
        var fc = new File(resultPath, "write", "TEXT");
        fc.eof = 0;
        fc.writeline("frames " + frames);
        fc.writeline("cpuavg " + (cpuCount ? cpuSum / cpuCount : -1));
        fc.writeline("cpumax " + cpuMax);
        fc.writeline("cpucount " + cpuCount);
        fc.close();
        outlet(0, "bang");
        return;
    }
    var refName = jsarguments.length > 1 ? String(jsarguments[1]) : "";
    var settle = jsarguments.length > 2 ? Number(jsarguments[2]) : 0;
    var a = rd(rec, 1, 0, frames), b = rd(rec, 2, 0, frames);
    var err = 0, err1 = 0, mn2 = 1e9, mx2 = -1e9, peakRef = 0, peakB = 0, peakA = 0, nans = 0, rmsA = 0, sumsq = 0;
    var ref = null, ref1 = null, min1 = 1e9;
    if (refName) {
        var rb = new Buffer(refName);
        var rf = rb.framecount();
        var n = Math.max(0, Math.min(frames, rf - settle));
        ref = rd(rb, 1, settle, n);
        // a 2-channel reference: ch1 (out 1 of the device) is checked against its channel 2 (the sag case)
        if (rb.channelcount() > 1) ref1 = rd(rb, 2, settle, n);
    }
    for (var i = 0; i < frames; i++) {
        var va = a[i], vb = b[i];
        if (va !== va || vb !== vb) { nans++; continue; }
        peakA = Math.max(peakA, Math.abs(va));
        min1 = Math.min(min1, va);
        peakB = Math.max(peakB, Math.abs(vb));
        rmsA += va * va;
        mn2 = Math.min(mn2, vb); mx2 = Math.max(mx2, vb);
        if (ref && i < ref.length) {
            var d = Math.abs(vb - ref[i]);
            if (d > err) err = d;
            var d1 = Math.abs(va - (ref1 ? ref1[i] : ref[i]));
            if (d1 > err1) err1 = d1;
            peakRef = Math.max(peakRef, Math.abs(ref[i]));
            sumsq += (vb - ref[i]) * (vb - ref[i]);
        }
    }
    var f = new File(resultPath, "write", "TEXT");
    f.eof = 0;
    f.writeline("frames " + frames);
    f.writeline("settle " + settle);
    f.writeline("maxerr " + err);
    f.writeline("maxerr1 " + err1);
    f.writeline("span2 " + (mx2 - mn2));
    f.writeline("rmserr " + (ref && ref.length ? Math.sqrt(sumsq / ref.length) : -1));
    f.writeline("peakref " + peakRef);
    f.writeline("peakraw " + peakB);
    f.writeline("peakout " + peakA);
    f.writeline("rmsout " + Math.sqrt(rmsA / Math.max(1, frames)));
    f.writeline("nans " + nans);
    f.writeline("min1 " + min1);
    var tail = 0;
    for (i = Math.floor(frames * 0.75); i < frames; i++) tail = Math.max(tail, Math.abs(b[i]));
    f.writeline("tailpeak " + tail);
    var sc = new Buffer("amp_scope_t");
    var names = ["frames_t", "sr_t", "inpk", "outpk", "gate", "sat", "inrms", "outrms", "modelok", "nlayers", "nampk", "asleep"];
    for (i = 0; i < names.length; i++) {
        var v = sc.peek(1, i, 1);
        f.writeline(names[i] + " " + (typeof v === "number" ? v : v[0]));
    }
    f.close();
    outlet(0, "bang");
}
