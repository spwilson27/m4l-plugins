// CPU probe for scripts/run_timbre_audio_tests.py: inlet 0 gets floats from [adstatus cpu] and `finish`,
// inlet 1 a [snapshot~] of the noise source (non-zero proves the DSP chain runs). jsarguments[1] = report path.
inlets = 2;
outlets = 1;
var reportPath = jsarguments.length > 1 ? jsarguments[1] : "/tmp/timbre_cpu.txt";
var cpuSamples = [];
var alive = 0;
var armed = false;

function msg_float(v) {
    if (inlet === 1) { if (v !== 0) alive++; return; }
    cpuSamples.push(v);
}

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
