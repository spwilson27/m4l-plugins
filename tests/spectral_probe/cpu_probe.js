// Probe for scripts/measure_spectral.py spike: collects `cpu <percent>` messages (adstatus cpu polled every few ms on the real-time driver)
// and writes their statistics (a per-hop CPU spike of a Spectral Split leader would show as max >> mean).
inlets = 1;
outlets = 1;
var resultPath = "/tmp/spectral_cpu.txt";
var samples = [];
function resultpath(p) { resultPath = String(p); }
function cpu(v) { samples.push(Number(v)); }
function analyze(durMs) {
    var s = samples.slice(Math.floor(samples.length * 0.1));      // drop the start-up
    var n = s.length, sum = 0, i, mx = 0;
    for (i = 0; i < n; i++) { sum += s[i]; if (s[i] > mx) mx = s[i]; }
    var sorted = s.slice().sort(function (a, b) { return a - b; });
    var q = function (p) { return n ? sorted[Math.min(n - 1, Math.floor(p * n))] : 0; };
    var distinct = {};
    for (i = 0; i < n; i++) distinct[s[i]] = 1;
    var f = new File(resultPath, "write", "TEXT");
    f.eof = 0;
    f.writestring("n " + n + "\nmean " + (n ? sum / n : 0) + "\np50 " + q(0.5) + "\np90 " + q(0.9) + "\np99 " + q(0.99) + "\nmax " + mx + "\ndistinct " + Object.keys(distinct).length + "\n");
    f.close();
    outlet(0, "bang");
}
