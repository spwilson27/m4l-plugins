// CPU probe for scripts/run_timbre_audio_tests.py (run by scripts/max_harness.py in audio_device mode):
// inlet 0 gets floats from [adstatus cpu] and the harness's `analyze <durMs>` (= finish),
// inlet 1 a [snapshot~] of the noise source (non-zero proves the DSP chain runs). The report goes to the
// path the harness sends with `resultpath`.
inlets = 2;
outlets = 1;
var reportPath = "/tmp/timbre_cpu.txt";
function resultpath(p) { reportPath = String(p); }
var cpuSamples = [];
var alive = 0;
var armed = false;

function msg_float(v) {
    if (inlet === 1) { if (v !== 0) alive++; return; }
    cpuSamples.push(v);
}

function analyze(durMs) { finish(); }

function finish() {
    if (armed) return;
    armed = true;
    var from = Math.floor(cpuSamples.length * 0.4);
    var s = 0, peak = 0, cnt = 0;
    for (var i = from; i < cpuSamples.length; i++) {
        s += cpuSamples[i];
        if (cpuSamples[i] > peak) peak = cpuSamples[i];
        cnt++;
    }
    var report = new File(reportPath, "write", "TEXT");
    report.writestring("cpu " + (cnt ? s / cnt : -1) + "\ncpupeak " + peak + "\nsamples " + cnt + "\nalive " + alive + "\n");
    report.close();
    outlet(0, "bang");
}
