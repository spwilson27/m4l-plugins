#!/usr/bin/env node
/**
 * Live investigation: how are the chains of ONE Audio Effect Rack processed? (Goal 1 of the splitter optimisation; evidence for the
 * leader / follower design in AGENTS.md section 22.) Needs spectral_probe_test.als (scripts/make_spectral_probe_set.py,
 * `scripts/vm_spectral.sh probelive`): tracks "Probe" (rack, 4 chains) and "Probe B" (rack, 3 chains), a Spectral Probe in every chain
 * (tests/spectral_probe/probe.genexpr). A float32 ramp clip x[n] = n / 2^20 plays on both tracks, so every instance sees the exact
 * absolute sample index in its own input. At the first sample of each of its vectors an instance compares the absolute time that
 * every other instance wrote last with its own: fresh (the other ran earlier in this vector), stale (later), other (anything else =
 * concurrent or misaligned vectors).
 *
 *   node scripts/test_spectral_probe_live.js [--port 19880] [--secs 15]
 * Prints the evidence; exits non-zero only on tool errors or when the data contradicts "serial, aligned, fixed order".
 */
const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : def; };
const PORT = opt("--port", null);
const SECS = opt("--secs", 15);

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8", maxBuffer: 1 << 26 }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let failures = 0;
function check(ok, msg) { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failures++; return ok; }

function vmIp() {
    for (const a of [["ip", "macos-1"], ["ip", "--resolver=arp", "macos-1"]]) {
        try { const ip = execFileSync("tart", a, { encoding: "utf8" }).trim(); if (ip) return ip; } catch (e) { /* next */ }
    }
    throw new Error("no VM ip");
}
function makeRamp(sr, secsLen) {
    const py = `
import struct, sys
sr = int(sys.argv[1]); n = 1 << 20
f = open("/tmp/sp_ramp.wav", "wb")
data = struct.pack("<%df" % n, *[i / 1048576.0 for i in range(n)])
f.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, sr, sr * 4, 4, 32) + b"data" + struct.pack("<I", len(data)) + data)
f.close(); print("ok")
`;
    const out = execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", `admin@${vmIp()}`, "/usr/bin/python3", "-", String(sr)],
        { encoding: "utf8", input: py, env: Object.assign({}, process.env, { SSHPASS: process.env.SSHPASS || "admin" }) });
    return out.trim() === "ok";
}

const HELPERS = `
    function bus() { var g = new Global("probe_bus"); if (!g.inst) g.inst = {}; if (!g.cfg) g.cfg = {}; return g; }
    function res(name) { var b = new Buffer(name); var v = b.peek(1, 0, 512); return v; }
`;
const lom = (code) => evalLom(HELPERS + code);

// 1. instances
let inst = [];
for (let i = 0; i < 40; i++) {
    inst = lom(`var g = bus(), out = [], now = Date.now(); for (var u in g.inst) { var p = g.inst[u]; if (now - p.t < 3000 && p.path) out.push({ uid: u, sh: p.sh, own: p.own, path: p.path }); } return out;`);
    if (inst.length >= 7) break;
    sleep(500);
}
check(inst.length === 7, `${inst.length} probe instances registered (want 7)`);
if (inst.length !== 7) { console.log(JSON.stringify(inst)); process.exit(1); }
const parse = (p) => { const m = p.match(/tracks (\d+) devices (\d+) chains (\d+) devices (\d+)/); return m ? { track: +m[1], chain: +m[3] } : null; };
inst.forEach((i) => Object.assign(i, parse(i.path)));
const trackNames = lom(`var n = new LiveAPI("live_set").getcount("tracks"), r = []; for (var t = 0; t < n; t++) r.push(String(new LiveAPI("live_set tracks " + t).get("name"))); return r;`);
inst.forEach((i) => { i.tname = trackNames[i.track]; });
inst.sort((a, b) => (a.tname === b.tname ? a.chain - b.chain : (a.tname < b.tname ? 1 : -1)));
const groups = {};
inst.forEach((i) => { (groups[i.tname] = groups[i.tname] || []).push(i); });
console.log("groups: " + Object.keys(groups).map((k) => `${k}[${groups[k].map((i) => "chain" + i.chain).join(",")}]`).join("  "));
for (const g of Object.values(groups)) g.forEach((i, idx) => { i.id = idx; i.k = g.length; i.shared = g[0].sh; });
lom(`var g = bus(); g.cfg = {}; ${JSON.stringify(inst)}.forEach(function (i) { g.cfg[i.uid] = { id: i.id, k: i.k, sh: i.shared }; }); return 1;`);
sleep(1500);

// 2. sample rate, ramp
const sr = lom(`return res(${JSON.stringify(inst[0].own)})[6];`);
console.log("gen samplerate " + sr);
check(makeRamp(Math.round(sr), 0), "ramp clip (float32, 2^20 samples, x[n] = n / 2^20) written in the VM");
for (const tname of Object.keys(groups)) {
    const t = groups[tname][0].track;
    const r = lom(`
        var slot = new LiveAPI("live_set tracks ${t} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) slot.call("create_audio_clip", "/tmp/sp_ramp.wav");
        var clip = new LiveAPI("live_set tracks ${t} clip_slots 0 clip");
        try { clip.set("warping", 0); } catch (e) {}
        clip.set("looping", 1);
        slot.call("fire");
        return String(clip.get("warping")) + " len " + String(clip.get("length")) + " end " + String(clip.get("loop_end"));`);
    console.log(`clip on ${tname}: warping/len/loop_end ${r}`);
}

const snap = () => inst.map((i) => lom(`return res(${JSON.stringify(i.own)});`));
function report(label, r0, r1) {
    console.log(`\n--- ${label}`);
    const dl = (ai, o) => r1[ai][o] - (r0 ? r0[ai][o] : 0);
    inst.forEach((a, ai) => {
        const ra = r1[ai];
        console.log(`  ${a.tname}/chain${a.chain} id${a.id}: vectorsize ${ra[0]}, vectors ${dl(ai, 1)}, samples ${dl(ai, 2)}, ticket gap != K ${dl(ai, 3)} times`);
        const runs = [];
        for (let r = 1; r < 64; r++) { const c = dl(ai, 400 + r); if (c > 0) runs.push(`${r}:${c}`); }
        console.log(`      vectors per uninterrupted block (run length: count): ${runs.join(" ")}`);
        inst.forEach((b, bi) => {
            if (b === a || b.tname !== a.tname) return;
            const o = 16 + b.id * 8;
            const hist = [];
            for (let k = 0; k < 33; k++) { const c = dl(ai, 128 + b.id * 32 + k); if (c > 0) hist.push(`${k - 16}:${c}`); }
            console.log(`      vs chain${b.chain}: other AHEAD (already ran this vector or more) ${dl(ai, o)}, BEHIND ${dl(ai, o + 1)}, misaligned ${dl(ai, o + 2)}, compared ${dl(ai, o + 5)}; d in vectors (floor((d+1)/V): count) ${hist.join(" ")}`);
        });
    });
}
function verdict(label, r0, r1) {
    // a fixed serial order: for every pair the other is ALWAYS ahead or ALWAYS behind (a few wrap-around outliers allowed), and the two views mirror
    let ok = true;
    const pairs = [];
    inst.forEach((a, ai) => inst.forEach((b, bi) => {
        if (bi <= ai || a.tname !== b.tname) return;
        const oa = 16 + b.id * 8, ob = 16 + a.id * 8;
        const dA = (k) => r1[ai][oa + k] - r0[ai][oa + k];
        const dB = (k) => r1[bi][ob + k] - r0[bi][ob + k];
        const tot = dA(0) + dA(1);
        const fixed = tot > 100 && Math.min(dA(0), dA(1)) <= 0.01 * tot && dA(2) <= 0.01 * tot;
        const mirrored = (dA(0) > dA(1)) === (dB(1) > dB(0));
        ok = ok && fixed && mirrored;
        pairs.push(`${a.tname}/${a.chain}${dA(0) > dA(1) ? "<" : ">"}${b.chain}`);
    }));
    check(ok, `${label}: fixed order, vectors aligned (a<b: a's data is ahead of b; ${pairs.join(" ")})`);
}

sleep(2000);
const base0 = snap();
sleep(SECS * 1000);
const base1 = snap();
report(`baseline ${SECS} s, all chains playing`, base0, base1);
verdict("baseline", base0, base1);
check(inst.every((i, k) => base1[k][2] - base0[k][2] > SECS * sr * 0.9), "every instance processed ~all samples");
check(inst.every((i, k) => base1[k][0] === base1[0][0]), `all instances see vectorsize ${base1[0][0]}`);


// 3. mute chain 1 of "Probe", then unmute (late start of a stopped gen)
const pr = groups["Probe"];
lom(`var c = new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 1"); c.set("mute", 1); return 1;`);
console.log("chain 1 mute readback: " + lom(`var c = new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 1"); return [String(c.get("mute")), String(c.get("is_auto_colored")), String(c.get("muted_via_solo"))];`));
sleep(1500);
const m0 = snap();
sleep(4000);
const m1 = snap();
console.log(`\nchain 1 MUTED: samples processed in 4 s: muted instance ${m1[1][2] - m0[1][2]}, others ${m1[0][2] - m0[0][2]}`);
check(m1[1][2] - m0[1][2] < 1000 && m1[0][2] - m0[0][2] > sr * 3.5, "a muted chain's gen is NOT run (its counter stops)");
verdict("remaining chains while chain 1 is muted", m0, m1);
lom(`new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 1").set("mute", 0); return 1;`);
sleep(1500);
const u0 = snap();
sleep(SECS * 1000 / 3);
const u1 = snap();
report("after unmuting chain 1 (a late restart: its counter resumed where it stopped)", u0, u1);
verdict("after unmute", u0, u1);

// 4. Device On = 0 of chain 0's instance
lom(`var d = new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 0 devices 0"); var n = d.getcount("parameters"); for (var i = 0; i < n; i++) { var p = new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 0 devices 0 parameters " + i); if (String(p.get("name")) === "Device On") { p.set("value", 0); break; } } return 1;`);
sleep(1500);
const o0 = snap();
sleep(3000);
const o1 = snap();
console.log(`\nDevice OFF on chain 0: samples in 3 s: off instance ${o1[0][2] - o0[0][2]}, others ${o1[2][2] - o0[2][2]}`);
lom(`var d = new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 0 devices 0"); var n = d.getcount("parameters"); for (var i = 0; i < n; i++) { var p = new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 0 devices 0 parameters " + i); if (String(p.get("name")) === "Device On") { p.set("value", 1); break; } } return 1;`);
sleep(1500);

// 5. chain solo
lom(`new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 2").set("solo", 1); return 1;`);
sleep(1500);
const s0 = snap();
sleep(3000);
const s1 = snap();
console.log(`\nchain 2 SOLO: samples in 3 s per chain: [${pr.map((_, c) => s1[inst.indexOf(pr[c])][2] - s0[inst.indexOf(pr[c])][2])}]`);
lom(`new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 2").set("solo", 0); return 1;`);

// 6. try to add a chain / duplicate a device at run time (a real late start)
const dup = lom(`
    var out = [];
    try { var chain = new LiveAPI("live_set tracks ${pr[0].track} devices 0 chains 0"); chain.call("duplicate_device", 0); out.push("duplicate_device ok"); } catch (e) { out.push("duplicate_device: " + e); }
    return out;`);
console.log("\nruntime duplicate: " + JSON.stringify(dup));
sleep(2500);
const regNow = lom(`var g = bus(), n = 0, now = Date.now(); for (var u in g.inst) if (now - g.inst[u].t < 3000) n++; return n;`);
console.log("instances registered after the duplicate attempt: " + regNow);

lom(`new LiveAPI("live_set").call("stop_playing"); return 1;`);
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall probe checks passed");
process.exit(failures ? 1 : 0);
