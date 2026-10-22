#!/usr/bin/env node
/**
 * Live check for the Spectral Split framework: the summed output of a rack equals the input, delayed by the reported latency, sample for sample
 * (null below -90 dB), and still does after a linked Size change, after the instances are restarted one at a time (a late start), and after a chain
 * is added later. This is the check that catches the hop-phase bug (chains that frame the signal at different sample phases do not sum to the input).
 *
 * Needs spectral_sum_test.als (scripts/make_spectral_sum_set.py, `scripts/vm_spectral.sh sumlive`): track "Transient Split" = [Spectral Sum Probe]
 * [Audio Effect Rack, one Transient Split per chain] [Spectral Sum Probe]; track "Control" = [probe] [probe]. A float32 stereo clip plays on both:
 * L = a ramp (x[n] = n / 2^21: every sample carries its own absolute index, the pilot), R = decaying noise bursts over a sine (transients for the
 * detector). Both probes record their last 131072 input samples; a frozen window of each is read in the bridge (v8) and compared: the pilot gives
 * the pairing of samples (post[i0 + k] vs pre[j0 + k]), the null is sum((post - pre)^2) / sum(pre^2) over both channels. The pairing offset (i0 - j0)
 * is the rack's latency plus the (control-measured) constant offset of the two probes' ring positions; the control track measures that offset.
 *
 *   node scripts/test_spectral_sum_live.js [--port 19880] [--only name,name]
 */
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const PORT = opt("--port", null);
const ONLY = opt("--only", "") ? opt("--only", "").split(",") : null;
const TRACK = "Transient Split";
const NULL_LIMIT_DB = -90;

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 27 }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let failures = 0;
function check(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; return ok; }
const wanted = (n) => !ONLY || ONLY.indexOf(n) >= 0;

const HELPERS = `
    function findParam(devPath, name) {
        var d = new LiveAPI(devPath), n = d.getcount("parameters");
        for (var i = 0; i < n; i++) { var p = new LiveAPI(devPath + " parameters " + i); if (String(p.get("name")) === name) return p; }
        return null;
    }
    function getVal(devPath, name) { var p = findParam(devPath, name); return p ? Number(p.get("value")) : null; }
    function setVal(devPath, name, v) { var p = findParam(devPath, name); if (!p) return false; p.set("value", v); return true; }
    function sbus() { var g = new Global("spectral_split_bus"); return { peers: g.peers || {}, groups: g.groups || {} }; }
    function scopeVals(name, idxs) {
        var b = new Buffer(name), out = [];
        for (var i = 0; i < idxs.length; i++) { var v = b.peek(1, idxs[i], 1); out.push(typeof v === "number" ? v : v[0]); }
        return out;
    }
    function pbus() { var g = new Global("ssp_bus"); if (!g.inst) g.inst = {}; return g; }
    function unroll(name) {
        var N = 131072, inf = new Buffer(name.info), pos = Number(inf.peek(1, 0, 1));
        var cap = new Buffer(name.cap), out = [];
        for (var c = 1; c <= 2; c++) {
            var raw = cap.peek(c, 0, N), a = new Array(N);
            for (var k = 0; k < N; k++) a[k] = raw[(pos + k) % N];
            out.push(a);
        }
        return out;
    }
    // pre = dry window, post = rack output window (each [L, R], oldest first, both frozen at the same probe counter, so ring index i of one is
    // the same instant as ring index i of the other). post[i] = sum of the rack's channels = pre[i - lag]: find the lag with the smallest error
    // (a coarse scan on the loudest 1024 samples, then a fine scan on 24000) and report the null sum((post - pre)^2) / sum(pre^2).
    function compare(pre, post) {
        var N = pre[0].length, W = 1024, best = -1, bestE = -1;
        for (var b = 16384; b + W < N; b += W) {
            var e = 0;
            for (var k = 0; k < W; k++) e += post[1][b + k] * post[1][b + k] + post[0][b + k] * post[0][b + k] * 0;
            if (e > bestE) { bestE = e; best = b; }
        }
        if (best < 0 || bestE < 1e-3) return { error: "no signal in the post window" };
        var lag0 = -1, errBest = 1e300;
        for (var lag = 0; lag <= 8192 && best - lag >= 0; lag++) {
            var er = 0;
            for (var c = 0; c < 2; c++) for (var k2 = 0; k2 < W; k2 += 1) { var d = post[c][best + k2] - pre[c][best + k2 - lag]; er += d * d; }
            if (er < errBest) { errBest = er; lag0 = lag; }
        }
        var K = 24000, a0 = N - 1 - K, bestLag = lag0, bestErr = 1e300, ref = 1, peakPost = 0;
        for (var lag2 = Math.max(0, lag0 - 6); lag2 <= lag0 + 6; lag2++) {
            var err2 = 0, rf = 0, pk = 0;
            for (var c2 = 0; c2 < 2; c2++) for (var k3 = 0; k3 < K; k3++) {
                var d2 = post[c2][a0 + k3] - pre[c2][a0 + k3 - lag2]; err2 += d2 * d2; rf += pre[c2][a0 + k3 - lag2] * pre[c2][a0 + k3 - lag2];
                pk = Math.max(pk, Math.abs(post[c2][a0 + k3]));
            }
            if (err2 < bestErr) { bestErr = err2; bestLag = lag2; ref = rf; peakPost = pk; }
        }
        return { nullDb: 10 * Math.log10(Math.max(bestErr, 1e-300) / Math.max(ref, 1e-300)), lag: bestLag, K: K, refRms: Math.sqrt(ref / (2 * K)), peakPost: peakPost };
    }
`;
const lom = (code) => evalLom(HELPERS + code);

function vmIp() {
    for (const a of [["ip", "macos-1"], ["ip", "--resolver=arp", "macos-1"]]) {
        try { const ip = execFileSync("tart", a, { encoding: "utf8" }).trim(); if (ip) return ip; } catch (e) { /* next */ }
    }
    throw new Error("no VM ip");
}
function makeClip(sr) {
    const py = `
import struct, sys, math
sr = int(sys.argv[1]); n = 1 << 20
seed = 12345
buf = bytearray()
period = int(0.4 * sr); tau = 0.06 * sr
for i in range(n):
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    r = (seed / 1073741824.0) - 1.0
    ph = i % period
    env = math.exp(-ph / tau) if i >= 4800 else 0.0
    right = 0.1 * math.sin(2 * math.pi * 440 * i / sr) + 0.5 * env * r
    buf += struct.pack("<ff", i / 2097152.0, right)
f = open("/tmp/ss_sum_clip.wav", "wb")
f.write(b"RIFF" + struct.pack("<I", 36 + len(buf)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 2, sr, sr * 8, 8, 32) + b"data" + struct.pack("<I", len(buf)) + bytes(buf))
f.close(); print("ok")
`;
    const out = execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", `admin@${vmIp()}`, "/usr/bin/python3", "-", String(sr)],
        { encoding: "utf8", input: py, env: Object.assign({}, process.env, { SSHPASS: process.env.SSHPASS || "admin" }) });
    return out.trim() === "ok";
}

// ---- find the track, the probes and the rack
const info = lom(`
    var n = new LiveAPI("live_set").getcount("tracks"), res = {};
    for (var t = 0; t < n; t++) {
        var nm = String(new LiveAPI("live_set tracks " + t).get("name"));
        if (nm === ${JSON.stringify(TRACK)} || nm === "Control") res[nm] = t;
    }
    return res;
`);
check(info[TRACK] !== undefined && info.Control !== undefined, `tracks found: ${JSON.stringify(info)}`);
if (info[TRACK] === undefined) process.exit(1);
const T = info[TRACK], C = info.Control;
const rackPath = `live_set tracks ${T} devices 1`;
const chains = lom(`var r = new LiveAPI(${JSON.stringify(rackPath)}), n = r.getcount("chains"), out = []; for (var c = 0; c < n; c++) out.push("${rackPath} chains " + c + " devices 0"); return out;`);
console.log("chains: " + chains.length);

function probes() {
    for (let i = 0; i < 40; i++) {
        const p = lom(`var b = pbus(), out = [], now = Date.now(); for (var u in b.inst) { var q = b.inst[u]; if (now - q.t < 3000 && q.path) out.push({ uid: u, cap: q.cap, info: q.info, path: q.path }); } return out;`);
        if (p.length >= 4) return p;
        sleep(500);
    }
    throw new Error("probes did not register");
}
const pr = probes();
const find = (track, dev) => pr.find((p) => p.path.indexOf(`tracks ${track} devices ${dev}`) >= 0 && /devices \d+$/.test(p.path) && p.path.split("devices").length === 2);
const preT = find(T, 0), postT = find(T, 2), preC = find(C, 0), postC = find(C, 1);
check(preT && postT && preC && postC, "4 sum probes found (pre / post on the rack track, pre / post on the control track)");
if (!(preT && postT && preC && postC)) { console.log(JSON.stringify(pr)); process.exit(1); }

// ---- the clip
const peerScope = lom(`var s = sbus(), out = null; for (var id in s.peers) { var p = s.peers[id]; if (p.group.indexOf(${JSON.stringify(rackPath)}) >= 0 && p.scope) { out = p.scope; break; } } return out;`);
let sr = 48000;
if (peerScope) { try { sr = lom(`return new Buffer(${JSON.stringify(peerScope)}).peek(1, 513, 1);`) || 48000; } catch (e) { /* keep 48000 */ } }
sr = Number(sr) > 8000 ? Math.round(Number(sr)) : 48000;
console.log("sample rate " + sr);
check(makeClip(sr), "pilot + bursts clip written in the VM");
for (const t of [T, C]) {
    const r = lom(`
        var slot = new LiveAPI("live_set tracks ${t} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) slot.call("create_audio_clip", "/tmp/ss_sum_clip.wav");
        var clip = new LiveAPI("live_set tracks ${t} clip_slots 0 clip");
        slot.call("fire");
        return "ok";`);
    if (r !== "ok") check(false, "clip on track " + t + ": " + r);
}
// Live analyses the new clip and turns warping on again some time after creation: switch it off (the ramp must play 1:1) until it stays off
for (let i = 0; i < 12; i++) {
    sleep(800);
    const w = [T, C].map((t) => lom(`var c = new LiveAPI("live_set tracks ${t} clip_slots 0 clip"); c.set("warping", 0); return Number(c.get("warping"));`));
    if (w.every((v) => v === 0)) { if (i >= 3) break; }
}
// An unwarped clip cannot loop through the LOM (looping 1 turns warping back on), so it plays once (21.8 s) and is fired again when needed.
let firedAt = 0;
function fireClips() {
    for (const t of [T, C]) lom(`var c = new LiveAPI("live_set tracks ${t} clip_slots 0 clip"); c.set("warping", 0); new LiveAPI("live_set tracks ${t} clip_slots 0").call("fire"); return 1;`);
    firedAt = Date.now();
}
fireClips();
sleep(1200);
const clipInfo = [T, C].map((t) => lom(`var c = new LiveAPI("live_set tracks ${t} clip_slots 0 clip"); return [Number(c.get("warping")), Number(c.get("gain")), Number(c.get("is_playing"))];`));
check(clipInfo.every((c) => c[0] === 0 && Math.abs(c[1] - 0.4) < 1e-6 && c[2] === 1), `clips play 1:1 (warping off, 0 dB gain, playing): ${JSON.stringify(clipInfo)}`);
sleep(1500);

function keepPlaying() {
    // the clip lasts 21.8 s: restart it when less than 9 s are left (a capture needs about 4 s)
    if (Date.now() - firedAt > 12000) { fireClips(); sleep(1000); }
}
function capture(pre, post) {
    keepPlaying();
    // both probes freeze when THEIR counter reaches the same value (2.5 s ahead), so their rings are index-aligned
    const c0 = lom(`return new Buffer(${JSON.stringify(pre.info)}).peek(1, 2, 1);`);
    const target = (Math.round(Number(c0)) + Math.round(2.5 * sr)) % 4194304;
    lom(`var g = new Global("ssp_bus"); g.stopat = ${target}; g.hold = 0; return 1;`);
    sleep(3300);
    const r = lom(`
        var fi = [${JSON.stringify(pre.info)}, ${JSON.stringify(post.info)}].map(function (n) { var b = new Buffer(n); return [b.peek(1, 2, 1), b.peek(1, 3, 1)]; });
        var res;
        if (fi[0][1] !== 1 || fi[1][1] !== 1) res = { error: "the probes did not freeze: " + JSON.stringify(fi) };
        else {
            var a = unroll(${JSON.stringify({ cap: pre.cap, info: pre.info })}), b = unroll(${JSON.stringify({ cap: post.cap, info: post.info })});
            res = compare(a, b);
            res.counters = [fi[0][0], fi[1][0]];
        }
        var g = new Global("ssp_bus"); g.stopat = -1; g.hold = 0;
        return res;`);
    return r;
}
const reported = () => lom(`
    var rack = new LiveAPI(${JSON.stringify(rackPath)});
    var out = { rack: Number(rack.get("latency_in_samples")), devices: [] };
    var n = rack.getcount("chains");
    for (var c = 0; c < n; c++) out.devices.push(Number(new LiveAPI("${rackPath} chains " + c + " devices 0").get("latency_in_samples")));
    return out;`);

// control: the two probes on the control track see the same stream, so lag = the constant offset of their ring positions
let ctl = null;
for (let i = 0; i < 3 && (!ctl || ctl.error); i++) { ctl = capture(preC, postC); if (ctl.error) { console.log("control: " + ctl.error); sleep(1500); } }
check(ctl && !ctl.error && ctl.nullDb < -120 && ctl.lag === 0 && ctl.counters[0] === ctl.counters[1], `control track (no rack): null ${ctl && ctl.nullDb !== undefined ? ctl.nullDb.toFixed(1) : "?"} dB, probes frozen at counters ${ctl && ctl.counters}`);
const ctlOff = 0;     // both probes freeze at the same counter value: index-aligned rings
const rep0 = reported();
console.log("reported latency: " + JSON.stringify(rep0));

let results = [];
function sumCheck(label) {
    let r = null;
    for (let i = 0; i < 3; i++) { r = capture(preT, postT); if (!r.error) break; console.log("  (" + r.error + ", retry)"); sleep(1500); }
    if (r.error) { check(false, `${label}: ${r.error}`); return; }
    const rep = reported();
    const lat = r.lag - ctlOff;
    results.push({ label, null: r.nullDb, lat });
    check(r.nullDb < NULL_LIMIT_DB && r.refRms > 0.01,
        `${label}: rack sum vs input delayed ${lat} samples (reported latency ${rep.rack} / devices ${rep.devices}): null ${r.nullDb.toFixed(1)} dB (limit ${NULL_LIMIT_DB}), input rms ${r.refRms.toFixed(3)}, ${r.K} samples`);
    return r;
}

const PARAM_SIZE = "Size";
const setChain = (c, name, v) => lom(`return setVal(${JSON.stringify(chains[c])}, ${JSON.stringify(name)}, ${v});`);
const getChain = (c, name) => lom(`return getVal(${JSON.stringify(chains[c])}, ${JSON.stringify(name)});`);

if (wanted("baseline")) sumCheck("baseline (Size " + getChain(0, PARAM_SIZE) + ")");
if (wanted("size")) {
    const start = getChain(0, PARAM_SIZE);
    for (const v of [2, 3, 0, 1]) {
        setChain(0, PARAM_SIZE, v);
        sleep(3500);
        sumCheck(`after a linked Size change to ${["512", "1k", "2k", "4k"][v]} (set on chain 0, reached the other chains over the link)`);
    }
    setChain(0, PARAM_SIZE, start);
    sleep(3000);
}
if (wanted("size_last")) {
    setChain(chains.length - 1, PARAM_SIZE, 2);
    sleep(3500);
    sumCheck("after a linked Size change to 2k set on the LAST chain");
    setChain(chains.length - 1, PARAM_SIZE, 1);
    sleep(3000);
}
if (wanted("param")) {
    setChain(0, "Bias", 30);
    sleep(2500);
    sumCheck("after Analysis Bias 30 % (linked parameter)");
    setChain(0, "Bias", 0);
    sleep(2500);
}
if (wanted("restart")) {
    // a late start: the instance in each chain in turn restarts its DSP (a new gen~: a new counter, new framing phase) while audio plays
    for (let c = 0; c < chains.length; c++) {
        lom(`messnamed("#0-sstest", ["dsp_restart", ${c}]); return 1;`);
        sleep(6500);
        sumCheck(`after restarting the DSP of the instance in chain ${c}`);
    }
}
if (ONLY && ONLY.indexOf("add") >= 0) {       // opt-in: destructive, and the LOM cannot insert an M4L device by name (it inserts a native device of a similar name)
    // a chain added later: insert a Transient Split into the second chain after deleting it (best effort via the LOM)
    const del = lom(`try { new LiveAPI(${JSON.stringify(rackPath + " chains 1")}).call("delete_device", 0); return "deleted"; } catch (e) { return "delete: " + e; }`);
    console.log("delete device in chain 1: " + del);
    sleep(2500);
    const ins = lom(`try { new LiveAPI(${JSON.stringify(rackPath + " chains 1")}).call("insert_device", "Transient Split", 0); return "inserted"; } catch (e) { return "insert: " + e; }`);
    console.log("insert device in chain 1: " + ins);
    const kind = lom(`var d = new LiveAPI(${JSON.stringify(rackPath + " chains 1 devices 0")}); return [String(d.get("name")), String(d.get("class_name"))];`);
    console.log("inserted device: " + JSON.stringify(kind));
    if (ins === "inserted" && kind[1] === "MxDeviceAudioEffect") { sleep(9000); sumCheck("after a Transient Split was added to chain 1 later"); }
    else console.log("INFO adding a chain device at run time is not possible through the LOM here; the `restart` scenario covers the late start");
}
if (ONLY && ONLY.indexOf("leader_deleted") >= 0) {   // opt-in, destructive: the leader's chain device is deleted while audio plays
    const scopeOf = (c) => lom(`var s = sbus(), out = null; for (var id in s.peers) { var p = s.peers[id]; if (p.path === ${JSON.stringify(chains[c])}) out = p.scope; } return out;`);
    const KEYS = ["CMP", "FOL", "ALIGNED", "FB", "ROLE", "ALIVE"].map((k) => require("../src/transplit_config.js")["TS_SC_" + k]);
    const surv = scopeOf(1);
    const before = lom(`return scopeVals(${JSON.stringify(surv)}, ${JSON.stringify(KEYS)});`);
    console.log(`before: survivor (chain 1) cmp/fol/aligned/fb/role/alive = ${before}`);
    const del = lom(`try { new LiveAPI(${JSON.stringify(rackPath + " chains 0")}).call("delete_device", 0); return "deleted"; } catch (e) { return "delete: " + e; }`);
    check(del === "deleted", "leader's device deleted from chain 0");
    let after = before, took = null;
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
        sleep(500);
        after = lom(`return scopeVals(${JSON.stringify(surv)}, ${JSON.stringify(KEYS)});`);
        if (after[4] === 1 && after[0] === 1 && after[3] === 0) { took = Date.now() - t0; break; }
    }
    check(took !== null, `the surviving instance becomes the leader (cmp 1, role 1, no fallback) after ${took} ms: ${after}`);
    sleep(3000);
    const r = capture(preT, postT);
    check(!r.error && r.refRms > 0.01, `the survivor keeps playing (post window has signal): ${JSON.stringify(r)}`);
}
lom(`new LiveAPI("live_set").call("stop_playing"); return 1;`);
console.log("\nsummary: " + results.map((r) => `${r.label.split(" (")[0]}: ${r.null.toFixed(1)} dB @${r.lat}`).join(" | "));
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall rack-sum checks passed");
process.exit(failures ? 1 : 0);
