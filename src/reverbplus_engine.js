// Reverb+ (Start) engine: the non-visual v8ui every face is built around. Build order:
//   reverbplus_config.js + `var RP_ROLE = "start"` + build constants + reverbplus_link.js +
//   reverbplus_dsp.js + this file.
//
// It owns everything that is not drawing: the parameter store, the link layer (pairing, chain latency
// -> gen header), the deferred gen~ creation, the IR pipeline (file -> buffer~ ---rpir -> processed
// partition spectra -> buffer~ ---rpirspec + header) and the state bus the faces listen to.
//
// Inlet 0 messages:
//   set_<key> <value>      every parameter (prepend set_<key> from each live.* object)
//   names <xfer> <hdr> <scope> <spec> <ir> <irspec> <irview>   from loadbang
//   init_link              from live.thisdevice (the LOM is ready): link layer + deferred DSP start
//   dropfile <path...>     live.drop (also Live replaying the saved path on load)
//   browsed <path...>      file dialog result
//   ir_loaded              buffer~ ---rpir finished loading
//   browse_ir | clear_ir   commands from a face (`cmd browse_ir`)
//   bang                   re-broadcast the state (a face that comes up late)
// Outlets: 0 gen hub (messages for the gen~), 1 state bus (`state ...` -> s ---rpstate), 2 `replace <path>`
//   -> buffer~ ---rpir, 3 bang -> opendialog sound, 4 path -> prepend set -> the live.drop.
// State bus (messages on outlet 1, all prefixed `state`):
//   state dsp <ready 0|1> <error|->
//   state link <paired 0|1> <status> <latency smp> <partner index>
//   state ir <status> <loaded 0|1> <len smp> <sr> <channels> <sr mismatch 0|1> <name|->
//   status: idle | loading | processing | ready | error

inlets = 1;
outlets = 5;

// Raw parameter values as they arrived (the deferred DSP re-sends the gen-bound ones).
var rpRaw = {};

function anything() {
    var name = messagename;
    if (name.indexOf("set_") !== 0) return;
    var key = name.substring(4);
    var v = arguments.length ? Number(arguments[0]) : 0;
    rpRaw[key] = v;
    if (key === "irstretch" || key === "irstart" || key === "irreverse" || key === "irdecay") rpIrReprocessSoon();
    if (key === "algo") {
        if (rpIr.pendingSr) rpIrReprocessSoon();
        if (typeof rpApplyActive === "function") rpApplyActive();
    }
}

// ---- state bus -------------------------------------------------------------------------------------
rpOnChange = function () {
    rpBroadcastLink();
};

function rpBroadcastLink() {
    outlet(1, "state", "link", rpLink.paired ? 1 : 0, String(rpLink.status).replace(/\s+/g, "_"),
        Math.round(rpLink.latency), rpLink.partnerIndex);
}

function rpBroadcastIr() {
    var i = rpIr;
    outlet(1, "state", "ir", i.status, i.loaded ? 1 : 0, i.len, i.sr, i.channels, i.srMismatch ? 1 : 0,
        i.name ? i.name.replace(/\s+/g, "_") : "-");
}

// After init_link: tell the faces (they may have loaded after the first broadcast) a few times.
var rpInitTasks = [];
function rpOnInit() {
    if (typeof rpApplyPanelTheme === "function") rpApplyPanelTheme();
    if (typeof rpApplyActive === "function") rpApplyActive();
    [100, 700, 2500].forEach(function (ms) {
        var t = new Task(bang, this);
        t.schedule(ms);
        rpInitTasks.push(t);
    });
}

function bang() {
    rpBroadcastLink();
    rpBroadcastIr();
    if (typeof rpDsp !== "undefined") rpBroadcastDsp();
}

// ---- device sample rate (reported by the gen in its telemetry) -----------------------------------------
function rpDevSr() {
    try {
        if (!rpOwnNames.scope) return 0;
        var v = new Buffer(rpOwnNames.scope).peek(1, RP_SCOPE.SR, 1);
        var sr = typeof v === "number" ? v : (v && v.length ? Number(v[0]) : 0);
        return sr > 8000 ? sr : 0;
    } catch (e) {
        return 0;
    }
}

// ---- IR pipeline ----------------------------------------------------------------------------------------
var rpIr = {
    status: "idle", loaded: false, len: 0, sr: 0, channels: 0, srMismatch: false, name: "", path: "",
    src: null,        // {chans: [Float32Array], sr} the file as loaded
    ver: 0, bank: 0, // header version (bumped on every new set of spectra) and the bank in use
    reproTask: null, workTask: null, work: null, loadTask: null, pendingSr: false, t0: 0,
};

function rpFileName(p) {
    var s = String(p || "");
    var i = Math.max(s.lastIndexOf("/"), s.lastIndexOf(":"));
    return s.substring(i + 1);
}

function rpIrPathFromArgs(args) {
    // a path split by spaces by Max is rejoined; "none" / empty (an empty live.drop on load) is ignored
    var p = Array.prototype.slice.call(args).join(" ").trim();
    if (!p || p === "none" || p === "0") return "";
    return p;
}

var rpLastDropped = "";

function dropfile() {
    var p = rpIrPathFromArgs(arguments);
    if (!p) return;
    if (p === rpLastDropped && rpIr.loaded) return; // Live replaying the path already loaded
    rpIrLoad(p);
}

function browsed() {
    var p = rpIrPathFromArgs(arguments);
    if (!p) return;
    outlet(4, p); // store it in the live.drop parameter too, so Live saves it
    rpIrLoad(p);
}

function browse_ir() {
    outlet(3, "bang");
}

function clear_ir() {
    rpIr.src = null;
    rpIr.loaded = false;
    rpIr.len = 0;
    rpIr.name = "";
    rpIr.status = "idle";
    rpLastDropped = "";
    rpHdrPoke(37, 0);
    rpHdrPoke(32, ++rpIr.ver);
    rpBroadcastIr();
}

function rpIrLoad(path) {
    rpLastDropped = path;
    rpIr.path = path;
    rpIr.name = rpFileName(path);
    rpIr.status = "loading";
    rpIr.t0 = Date.now();
    rpBroadcastIr();
    outlet(2, "replace", path);
    // buffer~ prints an error and sends nothing when it cannot read the file
    if (!rpIr.loadTask) rpIr.loadTask = new Task(function () {
        if (rpIr.status === "loading") {
            rpIr.status = "error";
            rpBroadcastIr();
        }
    }, this);
    rpIr.loadTask.schedule(8000);
}

// buffer~ ---rpir has the file: read it (chunked) and process.
function ir_loaded() {
    if (rpIr.status !== "loading") return;
    try {
        var b = new Buffer(rpOwnNames.ir);
        var n = b.framecount();
        var nch = b.channelcount();
        var ms = b.length();
        if (!(n > 0) || !(nch > 0)) {
            rpIr.status = "error";
            rpBroadcastIr();
            return;
        }
        var sr = ms > 0 ? n / (ms / 1000) : 48000;
        var std = [22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000];
        var best = std[0];
        for (var i = 0; i < std.length; i++) if (Math.abs(std[i] - sr) < Math.abs(best - sr)) best = std[i];
        if (Math.abs(best - sr) / sr < 0.01) sr = best;
        var chans = [];
        for (var c = 0; c < Math.min(nch, 2); c++) {
            var a = new Float32Array(n);
            for (var off = 0; off < n; off += 65536) {
                var cnt = Math.min(65536, n - off);
                var chunk = b.peek(c + 1, off, cnt);
                if (typeof chunk === "number") chunk = [chunk];
                for (var k = 0; k < cnt; k++) a[off + k] = chunk[k] || 0;
            }
            chans.push(a);
        }
        rpIr.src = { chans: chans, sr: sr };
        rpIr.channels = chans.length;
        if (rpIr.loadTask) rpIr.loadTask.cancel();
        rpIrReprocess();
    } catch (err) {
        rpIr.status = "error";
        post("Reverb+: IR read failed: " + err + "\n");
        rpBroadcastIr();
    }
}

function rpIrReprocessSoon() {
    if (!rpIr.src) return;
    if (!rpIr.reproTask) rpIr.reproTask = new Task(rpIrReprocess, this);
    rpIr.reproTask.schedule(200);
}

// Process the loaded IR with the current IR controls, then compute the partition spectra in slices
// (a handful of partitions per Task tick) so the UI stays responsive.
function rpIrReprocess() {
    if (!rpIr.src) return;
    var devSr = rpDevSr();
    if (!devSr) {
        // the gen has not reported its rate yet (DSP still loading): try again shortly
        rpIr.pendingSr = true;
        if (!rpIr.reproTask) rpIr.reproTask = new Task(rpIrReprocess, this);
        rpIr.reproTask.schedule(300);
        return;
    }
    rpIr.pendingSr = false;
    rpIr.status = "processing";
    rpBroadcastIr();
    var proc = rpIrProcess(rpIr.src, {
        stretch: rpRaw.irstretch === undefined ? 100 : rpRaw.irstretch,
        start: rpRaw.irstart || 0,
        reverse: (rpRaw.irreverse || 0) > 0.5,
        decay: rpRaw.irdecay === undefined ? 100 : rpRaw.irdecay,
    }, devSr);
    var counts = rpIrCounts(proc.len);
    rpIr.work = {
        proc: proc, counts: counts, head: new Float32Array(counts.nHead * RP_CONV.NB1 * 4),
        tail: new Float32Array(counts.nTail * RP_CONV.NB2 * 4), p: 0, q: 0, devSr: devSr,
        bank: 1 - rpIr.bank, wrote: 0,
    };
    if (!rpIr.workTask) rpIr.workTask = new Task(rpIrWork, this);
    rpIr.workTask.interval = 8;
    rpIr.workTask.repeat();
}

function rpIrWork() {
    var w = rpIr.work;
    if (!w) {
        rpIr.workTask.cancel();
        return;
    }
    var t0 = Date.now();
    var P = w.proc;
    while (Date.now() - t0 < 6) {
        if (w.p < w.counts.nHead) {
            rpPartitionSpectrum(P.L, P.R, w.p * RP_CONV.P1, RP_CONV.P1, w.head, w.p * RP_CONV.NB1 * 4);
            w.p++;
        } else if (w.q < w.counts.nTail) {
            rpPartitionSpectrum(P.L, P.R, RP_CONV.H + w.q * RP_CONV.P2, RP_CONV.P2, w.tail, w.q * RP_CONV.NB2 * 4);
            w.q++;
        } else {
            break;
        }
    }
    if (w.p < w.counts.nHead || w.q < w.counts.nTail) return;
    rpIr.workTask.cancel();
    rpIrPublish(w);
    rpIr.work = null;
}

function rpPokeChunked(buf, off, arr) {
    for (var i = 0; i < arr.length; i += 8192) {
        buf.poke(1, off + i, Array.prototype.slice.call(arr.subarray(i, Math.min(arr.length, i + 8192))));
    }
}

// Write the spectra into the idle bank, the display data into ---rpirview, then the header (version
// last: the gen swaps banks when it sees a new version, while its output is faded out).
function rpIrPublish(w) {
    try {
        var spec = new Buffer(rpOwnNames.irspec);
        var base = w.bank * RP_CONV.BANK_FLOATS;
        rpPokeChunked(spec, base, w.head);
        rpPokeChunked(spec, base + RP_CONV.HEAD_FLOATS, w.tail);
        var P = w.proc;
        if (rpOwnNames.irview) {
            var v = rpIrView(P.L, P.R, P.len);
            var vb = new Buffer(rpOwnNames.irview);
            vb.poke(1, 0, [rpIr.ver + 1, P.len, w.devSr, P.channels]);
            vb.poke(1, 16, Array.prototype.slice.call(v.env));
            vb.poke(1, 16 + RP_IR_VIEW_N, Array.prototype.slice.call(v.wave));
        }
        rpIr.bank = w.bank;
        rpIr.loaded = true;
        rpIr.len = P.len;
        rpIr.sr = rpIr.src.sr;
        rpIr.channels = P.channels;
        rpIr.srMismatch = P.srMismatch;
        rpIr.status = "ready";
        rpTrace("ir", "ready " + rpIr.name + ": " + P.len + " samples, " + w.counts.nHead + " + " + w.counts.nTail + " partitions, " + (Date.now() - rpIr.t0) + " ms since the file was handed to buffer~");
        rpHdrPoke(RP_HDR.IR_BANK, w.bank);
        rpHdrPoke(RP_HDR.IR_NHEAD, w.counts.nHead);
        rpHdrPoke(RP_HDR.IR_NTAIL, w.counts.nTail);
        rpHdrPoke(RP_HDR.IR_LEN, P.len);
        rpHdrPoke(RP_HDR.IR_LOADED, 1);
        rpHdrPoke(RP_HDR.IR_CH, P.channels);
        rpHdrPoke(RP_HDR.IR_SRMIS, P.srMismatch ? 1 : 0);
        rpHdrPoke(RP_HDR.IR_VER, ++rpIr.ver);
    } catch (err) {
        rpIr.status = "error";
        post("Reverb+: IR publish failed: " + err + "\n");
    }
    rpBroadcastIr();
}

// ---- test hook (scripts/test_reverbplus_live.js): `receive #0-rptest` -> this inlet. `#0` is not substituted in a
// top-level device, so the MCP bridge can address every instance with messnamed("#0-rptest", ...).
//   dropfile <path>    same as a drop on the live.drop
//   test_report        writes this instance's state to Global("reverbplus_test").report_<LOM device id>
function test_report() {
    var g = new Global("reverbplus_test");
    var h = null;
    try { h = new Buffer(rpOwnNames.hdr).peek(1, 0, 48); } catch (e) { h = null; }
    g["report_" + rpSelfId] = JSON.stringify({
        id: rpSelfId, dsp: rpDsp.ready, dspError: rpDsp.error, link: rpLink.status, latency: rpLink.latency,
        ir: { status: rpIr.status, loaded: rpIr.loaded, len: rpIr.len, ver: rpIr.ver, bank: rpIr.bank, srMismatch: rpIr.srMismatch,
            name: rpIr.name, channels: rpIr.channels }, devSr: rpDevSr(), hdr: h ? Array.prototype.slice.call(h) : null, raw: rpRaw,
    });
}
