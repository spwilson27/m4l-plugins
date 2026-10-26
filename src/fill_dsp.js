// Deferred gen~ and the generated impulse responses.
// The device ships without gen~. init_dsp (live.thisdevice) writes the embedded
// .gendsp and creates gen~ on the fill_genin hub. plugin~ stays unwired until
// that cord exists, so the device is silent while the gen compiles.
//
// IR banks are center±range, not a start/end snapshot. Mixes stay on the gen.
// Experimental pages go to #0-fillbank (832): header, then 408 floats at 16
// and 16+408 from fillExperimentalPage.

var fillHost = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var fillDsp = { ready: 0, error: "", createdAt: 0, counter0: -1, task: null, settleTask: null, retries: 0 };
var fillBufBody = null;
var fillBufAir = null;
var fillBufScope = null;
var fillBufBank = null;
var fillBodyName = "";
var fillAirName = "";
var fillScopeName = "";
var fillBankName = "";
var fillIrTask = null;
var fillIrSig = "";
var fillIrSlot = { body: 0, air: 0, n: 0 };
var fillIrHead = { body: 1, air: 1 };
var fillIrTail = { body: 0, air: 0 };
var fillBankTask = null;
var fillBankSig = "";
var fillBankGen = 0;
var fillTele = { slots: [0, 0, 0, 0, 0, 0, 0, 0], energy: [], hit: 0 };
var FILL_DSP_RETRIES = 2;
var FILL_DSP_CONFIRM_MS = 150;
var FILL_DSP_TIMEOUT_MS = 8000;
var FILL_DSP_CLAIM_MS = 15000;
var fillDspToken = Math.random();

function fillDspClaim() {
    var q = new Global("fill_dspq");
    var now = Date.now();
    if (q.owner && q.owner !== fillDspToken && now - Number(q.t) < FILL_DSP_CLAIM_MS) return false;
    q.owner = fillDspToken;
    q.t = now;
    return true;
}

function fillDspRelease() {
    try {
        var q = new Global("fill_dspq");
        if (q.owner === fillDspToken) q.owner = 0;
    } catch (e) {}
}

function fillDspCords(g) {
    var inn = -1;
    var outn = -1;
    try {
        var pc = g && g.patchcords;
        if (pc) {
            inn = pc.inputs ? pc.inputs.length : -1;
            outn = pc.outputs ? pc.outputs.length : -1;
        }
    } catch (e) {}
    return { inn: inn, outn: outn };
}

function fillDspWire(g) {
    if (!g || !fillHost) return;
    var c = fillDspCords(g);
    if (c.inn >= 3 && c.outn >= 2) return;
    var hub = null;
    var pin = null;
    var pout = null;
    try {
        hub = fillHost.getnamed("fill_genin");
        pin = fillHost.getnamed("fill_plugin");
        pout = fillHost.getnamed("fill_plugout");
    } catch (e) { return; }
    if (!hub || !pin || !pout) return;
    try {
        if (c.inn < 3) {
            fillHost.connect(hub, 0, g, 0);
            fillHost.connect(pin, 0, g, 0);
            fillHost.connect(pin, 1, g, 1);
        }
        if (c.outn < 2) {
            fillHost.connect(g, 0, pout, 0);
            fillHost.connect(g, 1, pout, 1);
        }
    } catch (e2) {}
}
var FILL_BANK_PAGE = 408;
var FILL_BANK_ORIGIN = 16;

function fillSr() {
    var sr = (typeof samplerate === "number" && samplerate > 1000) ? samplerate : 48000;
    return sr;
}

function fillPoke(buf, offset, arr) {
    var i = 0;
    while (i < arr.length) {
        var n = Math.min(4096, arr.length - i);
        var slice = [];
        var k;
        for (k = 0; k < n; k++) slice.push(arr[i + k]);
        buf.poke(1, offset + i, slice);
        i += n;
    }
}

function fillPoke1(buf, index, value) {
    buf.poke(1, index, [value]);
}

function fillWriteBank(buf, bank, spec) {
    var base = bank * FILL_CONV.BANK_FLOATS;
    fillPoke(buf, base, spec.head);
    fillPoke(buf, base + FILL_CONV.HEAD_FLOATS, spec.tail);
}

function fillEdge(center, range, lo, hi, sign) {
    return fillClamp(Number(center) + sign * Number(range || 0), lo, hi);
}

function fillBodyEdge(sign) {
    return {
        bmodel: fillP.bmodel,
        bdecay: fillEdge(fillP.bdecay, fillP.bdecayr, 0, 100, sign),
        bsize: fillEdge(fillP.bsize, fillP.bsizer, 50, 200, sign),
        bcolor: fillEdge(fillP.bcolor, fillP.bcolorr, -100, 100, sign),
        tune: fillEdge(fillP.tune, fillP.tuner, -24, 24, sign)
    };
}

function fillAirEdge(sign) {
    return {
        amodel: fillP.amodel,
        adecay: fillEdge(fillP.adecay, fillP.adecayr, 0, 100, sign),
        asize: fillEdge(fillP.asize, fillP.asizer, 50, 200, sign),
        acolor: fillEdge(fillP.acolor, fillP.acolorr, -100, 100, sign)
    };
}

function fillSendIrHeader() {
    outlet(0, ["bnh", fillIrHead.body]);
    outlet(0, ["bnt", fillIrTail.body]);
    outlet(0, ["anh", fillIrHead.air]);
    outlet(0, ["ant", fillIrTail.air]);
    outlet(0, ["bload", fillIrSlot.n > 0 ? 1 : 0]);
    outlet(0, ["aload", fillIrSlot.n > 0 ? 1 : 0]);
    outlet(0, ["btos", fillIrSlot.body * 2]);
    outlet(0, ["btoe", fillIrSlot.body * 2 + 1]);
    outlet(0, ["atos", fillIrSlot.air * 2]);
    outlet(0, ["atoe", fillIrSlot.air * 2 + 1]);
    outlet(0, ["birgen", fillIrSlot.n]);
    outlet(0, ["airgen", fillIrSlot.n]);
}

function fillPublishIr() {
    if (!fillBufBody || !fillBufAir || typeof fillP === "undefined") return;
    var sig = JSON.stringify([
        fillP.bmodel, fillP.bdecay, fillP.bdecayr, fillP.bsize, fillP.bsizer, fillP.bcolor, fillP.bcolorr,
        fillP.tune, fillP.tuner, fillP.amodel, fillP.adecay, fillP.adecayr, fillP.asize, fillP.asizer,
        fillP.acolor, fillP.acolorr, fillP.seed
    ]);
    if (sig === fillIrSig && fillIrSlot.n > 0) {
        fillSendIrHeader();
        return;
    }
    var sr = fillSr();
    var seed = fillP.seed || 1;
    var loB = fillBodyEdge(-1);
    var hiB = fillBodyEdge(1);
    var loA = fillAirEdge(-1);
    var hiA = fillAirEdge(1);
    var bs = fillSpectra(fillRenderBody(loB.bmodel, loB.bdecay, loB.bsize, loB.bcolor, loB.tune, sr));
    var be = fillSpectra(fillRenderBody(hiB.bmodel, hiB.bdecay, hiB.bsize, hiB.bcolor, hiB.tune, sr));
    var aspec = fillSpectra(fillRenderAir(loA.amodel, loA.adecay, loA.asize, loA.acolor, seed, sr));
    var ae = fillSpectra(fillRenderAir(hiA.amodel, hiA.adecay, hiA.asize, hiA.acolor, seed, sr));
    fillWriteBank(fillBufBody, 0, bs);
    fillWriteBank(fillBufBody, 1, be);
    fillWriteBank(fillBufAir, 0, aspec);
    fillWriteBank(fillBufAir, 1, ae);
    fillIrHead.body = Math.max(bs.nHead, be.nHead);
    fillIrTail.body = Math.max(bs.nTail, be.nTail);
    fillIrHead.air = Math.max(aspec.nHead, ae.nHead);
    fillIrTail.air = Math.max(aspec.nTail, ae.nTail);
    fillIrSig = sig;
    fillIrSlot.n += 1;
    fillIrSlot.body = 0;
    fillIrSlot.air = 0;
    fillSendIrHeader();
}

function fillScheduleIr() {
    if (typeof Task !== "function") {
        fillPublishIr();
        return;
    }
    if (!fillIrTask) fillIrTask = new Task(fillPublishIr, this);
    fillIrTask.schedule(40);
}

function fillBankMetas() {
    return {
        mass: fillP.mass, massR: fillP.massr,
        scatter: fillP.scatter, scatterR: fillP.scatterr,
        decay: fillP.decay, decayR: fillP.decayr,
        couple: fillP.couple, coupleR: fillP.coupler,
        bite: fillP.bite, biteR: fillP.biter,
        air: fillP.air, airR: fillP.airr,
        rand: (Number(fillP.rand) || 0) / 100
    };
}

function fillPublishBank() {
    if (!fillBufBank || typeof fillP === "undefined" || fillP.page < 0.5) return;
    if (typeof fillExperimentalPage !== "function") return;
    var hit = Math.round(Number(fillTele.hit));
    if (hit !== hit || hit < 0) hit = 0;
    var metas = fillBankMetas();
    var sig = hit + "|" + (fillP.seed || 1) + "|" + JSON.stringify(metas);
    if (sig === fillBankSig && fillBankGen > 0) {
        outlet(0, ["bankgen", fillBankGen]);
        return;
    }
    var sr = fillSr();
    var cur = null;
    var nxt = null;
    try {
        cur = fillExperimentalPage(metas, fillP.seed || 1, hit, sr);
        nxt = fillExperimentalPage(metas, fillP.seed || 1, hit + 1, sr);
    } catch (err) {
        return;
    }
    if (!cur || cur.length < FILL_BANK_PAGE) return;
    // The gen always reads the page at 16 (header index 0 stays 0). Writing
    // the next draw into the other slot left Mass, Decay, and per-hit rolls
    // in a page that never sounded.
    fillPoke(fillBufBank, FILL_BANK_ORIGIN, cur);
    if (nxt && nxt.length >= FILL_BANK_PAGE) fillPoke(fillBufBank, FILL_BANK_ORIGIN + FILL_BANK_PAGE, nxt);
    fillPoke1(fillBufBank, 0, 0);
    fillPoke1(fillBufBank, 4, hit);
    fillBankGen += 1;
    fillPoke1(fillBufBank, 3, 48);
    fillPoke1(fillBufBank, 2, fillBankGen);
    fillPoke1(fillBufBank, 1, 1);
    fillBankSig = sig;
    outlet(0, ["bankgen", fillBankGen]);
}

function fillScheduleBank() {
    if (typeof Task !== "function") {
        fillPublishBank();
        return;
    }
    if (!fillBankTask) fillBankTask = new Task(fillPublishBank, this);
    fillBankTask.schedule(40);
}

function bufnames(body, air, scopeName, bankName) {
    fillBodyName = String(body || "");
    fillAirName = String(air || "");
    fillScopeName = String(scopeName || "");
    fillBankName = String(bankName || "");
    if (typeof Buffer === "function") {
        if (fillBodyName) fillBufBody = new Buffer(fillBodyName);
        if (fillAirName) fillBufAir = new Buffer(fillAirName);
        if (fillScopeName) fillBufScope = new Buffer(fillScopeName);
        if (fillBankName) fillBufBank = new Buffer(fillBankName);
    }
    fillPublishIr();
    if (typeof fillP !== "undefined" && fillP.page >= 0.5) fillPublishBank();
    if (typeof fillStartPoll === "function") fillStartPoll();
}

function fillReportLatency() {
    if (!fillHost || typeof fillHost.setattr !== "function") return;
    try { fillHost.setattr("latency", FILL_LATENCY); } catch (e) {}
}

function fillDspPath() {
    return "/tmp/fill_core_" + GEN_DSP_HASH + ".gendsp";
}

function fillDspWrite(path) {
    try {
        var rf = new File(path, "read");
        var have = rf.isopen && rf.eof === GEN_DSP_TEXT.length;
        rf.close();
        if (have) return true;
    } catch (e) {}
    var f = new File(path, "write", "TEXT");
    if (!f.isopen) return false;
    f.eof = 0;
    for (var i = 0; i < GEN_DSP_TEXT.length; i += 16384) f.writestring(GEN_DSP_TEXT.substring(i, i + 16384));
    f.close();
    return true;
}

function fillScopeFrame() {
    if (!fillBufScope || typeof Buffer !== "function") return -1;
    try {
        var chunk = fillBufScope.peek(1, 7, 1);
        if (typeof chunk === "number") return chunk;
        if (!chunk || !chunk.length) return -1;
        var v = chunk.length === 1 ? chunk[0] : chunk[7];
        return (typeof v === "number" && v === v) ? v : -1;
    } catch (e) {
        return -1;
    }
}

function fillDspResend() {
    try {
        if (fillHost) {
            var bind = fillHost.getnamed("fill_bind");
            if (bind && bind.valid) bind.message("bang");
        }
    } catch (e) {}
    if (fillScopeName) outlet(0, ["scope", fillScopeName]);
    if (fillBodyName) outlet(0, ["fillbody", fillBodyName]);
    if (fillAirName) outlet(0, ["fillair", fillAirName]);
    if (fillBankName) outlet(0, ["fillbank", fillBankName]);
    var names = (typeof FILL_REBANG !== "undefined") ? FILL_REBANG : [];
    var i;
    for (i = 0; i < names.length; i++) {
        try {
            if (!fillHost) break;
            var o = fillHost.getnamed(names[i]);
            if (o && o.valid) o.message("bang");
        } catch (e2) {}
    }
    fillSendIrHeader();
    if (typeof fillSendToggles === "function") fillSendToggles();
    if (typeof fillP !== "undefined" && fillP.page >= 0.5) fillPublishBank();
}

function fillDspLoad() {
    if (fillDsp.ready || fillDsp.createdAt || !fillHost || typeof GEN_DSP_TEXT === "undefined") return;
    if (!fillDspClaim()) {
        if (typeof Task === "function") {
            if (!fillDsp.queueTask) fillDsp.queueTask = new Task(fillDspLoad, this);
            fillDsp.queueTask.schedule(100);
        }
        return;
    }
    try {
        var g = fillHost.getnamed("fill_gen");
        if (!g || !g.valid) {
            var path = fillDspPath();
            if (!fillDspWrite(path)) throw new Error("cannot write " + path);
            g = fillHost.newdefault(40, 340, "gen~", "@gen", path);
            if (!g) throw new Error("no gen~");
            g.varname = "fill_gen";
            var hub = fillHost.getnamed("fill_genin");
            var pin = fillHost.getnamed("fill_plugin");
            var pout = fillHost.getnamed("fill_plugout");
            if (!hub || !hub.valid || !pin || !pin.valid || !pout || !pout.valid) throw new Error("missing hub");
            fillHost.connect(hub, 0, g, 0);
            fillHost.connect(pin, 0, g, 0);
            fillHost.connect(pin, 1, g, 1);
            fillHost.connect(g, 0, pout, 0);
            fillHost.connect(g, 1, pout, 1);
            fillDspWire(g);
        }
        fillDsp.createdAt = Date.now();
        fillDsp.counter0 = fillScopeFrame();
        fillDspConfirm();
    } catch (err) {
        fillDsp.error = String(err && err.message ? err.message : err);
        fillDspRelease();
        if (typeof post === "function") post("Fill: DSP load failed: " + fillDsp.error + "\n");
    }
    if (typeof mgraphics !== "undefined" && mgraphics.redraw) mgraphics.redraw();
}

function fillDspConfirm() {
    var c = fillScopeFrame();
    if (fillDsp.counter0 >= 0 && c >= 0 && c !== fillDsp.counter0) {
        try { fillDspWire(fillHost.getnamed("fill_gen")); } catch (eWire) {}
        fillDsp.ready = 1;
        fillDsp.error = "";
        fillDspRelease();
        fillDspResend();
        if (typeof Task !== "undefined") {
            if (!fillDsp.settleTask) fillDsp.settleTask = new Task(fillDspResend, this);
            fillDsp.settleTask.schedule(300);
        }
        if (typeof mgraphics !== "undefined" && mgraphics.redraw) mgraphics.redraw();
        return;
    }
    if (Date.now() - fillDsp.createdAt > FILL_DSP_TIMEOUT_MS && fillDsp.retries < FILL_DSP_RETRIES) {
        fillDsp.retries++;
        try {
            var old = fillHost.getnamed("fill_gen");
            if (old && old.valid) fillHost.remove(old);
        } catch (e) {}
        fillDsp.createdAt = 0;
        fillDspLoad();
        return;
    }
    if (Date.now() - fillDsp.createdAt > FILL_DSP_TIMEOUT_MS) {
        fillDsp.error = fillDsp.error || "DSP did not start";
        fillDspRelease();
        if (typeof mgraphics !== "undefined" && mgraphics.redraw) mgraphics.redraw();
        return;
    }
    fillDspResend();
    if (typeof Task !== "undefined") {
        if (!fillDsp.task) fillDsp.task = new Task(fillDspConfirm, this);
        fillDsp.task.schedule(FILL_DSP_CONFIRM_MS);
    }
}

function init_dsp() {
    fillReportLatency();
    if (typeof Task === "function") {
        var t = new Task(fillDspLoad, this);
        t.schedule(30);
    } else {
        fillDspLoad();
    }
}
