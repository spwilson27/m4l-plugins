// Fills buffer~ drums from a text slice written by run_oscilloscope_audio_tests.py.
// Line 1 is "channels frames". Each following line is "left right".
// Runs from loadbang, before the harness starts DSP.

inlets = 1;
outlets = 1;

function asCount(v) {
    if (typeof v === "number") return v;
    if (v && v.length) return v[0];
    return 0;
}

function fill(path) {
    var f = new File(String(path), "read");
    if (!f || !f.isopen) {
        outlet(0, "bang");
        return;
    }
    var frames = asCount(f.readint32(1)) | 0;
    var buf = new Buffer("drums");
    var got = 0;
    while (got < frames) {
        var n = Math.min(512, frames - got);
        var vals = f.readfloat32(n * 2);
        if (typeof vals === "number") vals = [vals];
        if (!vals || !vals.length) break;
        var left = [];
        var right = [];
        var i;
        for (i = 0; i + 1 < vals.length; i += 2) {
            left.push(vals[i]);
            right.push(vals[i + 1]);
        }
        if (!left.length) break;
        buf.poke(1, got, left);
        buf.poke(2, got, right);
        got += left.length;
    }
    f.close();
    outlet(0, "bang");
}
