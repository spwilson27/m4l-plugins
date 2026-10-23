#!/usr/bin/env node
/**
 * Live end-to-end test for the Spectral Split suite (Transient Split, Loud Split, Harmonic Split, Freq Split), driven through
 * the Ableton MCP Bridge (`scripts/ableton_mcp_server.js`, `ableton_eval_lom_js`).
 *
 * Needs spectral_test.als (one audio track per device holding its rack, one chain per output channel; scripts/make_spectral_set.py).
 * Live runs in the tart VM (AGENTS.md 1a): `scripts/vm_spectral.sh live`, then `scripts/vm_spectral.sh test [slug ...]`.
 * Every instance registers itself in Global("spectral_split_bus").peers (kind, group = rack path, device path, chain index, resolved
 * Auto channel, telemetry buffer name), which is how this test finds the instances; the gen's own telemetry buffer is read for the
 * running state. Per device (Track "<Name>", rack on devices 0):
 *   chains    the rack has one chain per channel, each holding one instance; all instances sit in one bus group
 *   auto      every instance resolved Auto to its chain index (peer record) AND its gen runs that channel (telemetry output selection)
 *   rack      (devices on the rack machinery: Transient Split) exactly one instance computes (leader, role 1, serves every channel), the others follow it
 *             (aligned to its sample clock by content, no fallback, no ring underrun), every gen reports the same latency (5120), the deferred gen~ of
 *             every instance reached "dsp ready" (Global spectral_split_trace), and its DSP-ready time after the script load is printed
 *   audio     a Core Library loop plays through the track: output_meter_left > 0.02, per instance: frame counter advances, awake = 1,
 *             input level > 0 (the gen is running)
 *   link      a numeric parameter set on the FIRST chain's instance reaches every other instance within 600 ms (measured), the same
 *             for a LAST-chain edit going back (both directions), an enum parameter, and Size
 *   once      each edit bumps the group's version counter by exactly 1 (no re-publishing) and nothing moves in the next 2.5 s
 *   mix/frac  Mix (every device) and a fractional float (Freq Split Splits 7.5, Transient Decay 12.5, ...) propagate with their value intact
 *   squares   (Harmonic Split only) generated WAVs (naive square 220 Hz mono 44.1 kHz, square 110 Hz on the LEFT channel only at 48 kHz,
 *             square 440 Hz, triangle 220 Hz) are made in the VM over ssh, dropped on slot 1.. and played: every chain's f0
 *             telemetry must lock within 1 % of the true pitch (regression: a square wave never reached the accept); and the C1 square
 *             (32.7 Hz) with Low 156.1 Hz / High 2.9 kHz / Every 8th / Size 2k: every chain reports ROOT 163.5 Hz (f0 slot), series f0
 *             32.7 Hz and root harmonic 5 (the band is set on chain 0 over the link and restored afterwards)
 *   output    Output is NOT linked: setting it on one instance leaves the others unchanged, and that gen's output selection follows
 *   restore   every parameter is put back at its initial value
 *
 *   node scripts/test_spectral_live.js [--port 19880] [slug ...]
 */

const { execFileSync } = require("child_process");
const path = require("path");

const SERVER = path.join(__dirname, "ableton_mcp_server.js");
const argv = process.argv.slice(2);
const portIdx = argv.indexOf("--port");
const PORT = portIdx >= 0 ? Number(argv[portIdx + 1]) : null;
const only = argv.filter((a, i) => !a.startsWith("--") && (portIdx < 0 || i !== portIdx + 1));

const LOOP = process.env.SPECTRAL_LOOP || "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/Loops/Drums/Full/Hip Hop Doubled 145 bpm.wav";
const LINK_MS = 600;

function evalLom(code) {
    const args = [SERVER];
    if (PORT) args.push("--port", String(PORT));
    args.push("--call", "ableton_eval_lom_js", JSON.stringify({ code }));
    const out = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
    if (out.error) throw new Error(out.error);
    return out.result;
}
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

let failures = 0;
function check(ok, msg) {
    console.log((ok ? "PASS " : "FAIL ") + msg);
    if (!ok) failures++;
    return ok;
}

// Per device: track name, kind (bus), config module + constant prefix, edits (LOM short name, new value; the Size edit is last)
const CHAIN_COLOR_INDEX = {
    "Transient Split": [1, 21],
    "Loud Split": [21, 1, 55],
    "Harmonic Split": [55, 1, 21],
    "Freq Split": [28, 9, 59, 11],
};
const DEVICES = [
    { slug: "transplit", track: "Transient Split", pre: "TS", rack: true, channels: 2, num: ["Bias", 40], num2: ["Tilt", -35], en: ["Type", 1], frac: ["Decay", 12.5], blend: ["Blend", 80] },
    { slug: "loudsplit", rack: true, track: "Loud Split", pre: "LS", channels: 3, num: ["Higher", -40], num2: ["Hi Knee", 14], en: ["Relative", 1], frac: ["Rise", 3.75] },
    { slug: "harmsplit", rack: true, track: "Harmonic Split", pre: "HS", channels: 3, num: ["NH Sens", 70], num2: ["Threshold", -45], en: ["Pattern", 3], frac: ["Tilt", 2.5] },
    { slug: "freqsplit", rack: true, track: "Freq Split", pre: "FS", channels: 4, num: ["XFade", 60], num2: ["Pinch", 30], en: ["Limiter", 1], frac: ["Splits", 7.5], fracExp: { lo: 1, hi: 1024, exp: 3, key: "splits" } },
];

const HELPERS = `
    function findParam(devPath, name) {
        var d = new LiveAPI(devPath);
        var n = d.getcount("parameters");
        for (var i = 0; i < n; i++) {
            var p = new LiveAPI(devPath + " parameters " + i);
            if (String(p.get("name")) === name) return p;
        }
        return null;
    }
    function getVal(devPath, name) { var p = findParam(devPath, name); return p ? Number(p.get("value")) : null; }
    function setVal(devPath, name, v) { var p = findParam(devPath, name); if (!p) return false; p.set("value", v); return true; }
    function bus() { var g = new Global("spectral_split_bus"); return { peers: g.peers || {}, groups: g.groups || {} }; }
    function scopeVals(name, idxs) {
        var b = new Buffer(name), out = [];
        for (var i = 0; i < idxs.length; i++) { var v = b.peek(1, idxs[i], 1); out.push(typeof v === "number" ? v : v[0]); }
        return out;
    }
`;
const lom = (code) => evalLom(HELPERS + code);

// ---- Harmonic Split: periodic test waves made in the VM (stdlib python over ssh), played from clip slots ----
function vmIp() {
    for (const args of [["ip", "macos-1"], ["ip", "--resolver=arp", "macos-1"]]) {
        try { const ip = execFileSync("tart", args, { encoding: "utf8" }).trim(); if (ip) return ip; } catch (e) { /* try the next resolver */ }
    }
    return null;
}
function makeWaves(waves) {
    const ip = vmIp();
    if (!ip) throw new Error("no VM ip (tart ip macos-1)");
    const py = `
import wave, struct, math, sys, json
for w in json.loads(sys.argv[1]):
    sr, f0, kind, amp, ch, secs = w["sr"], w["f0"], w["kind"], w["amp"], w["ch"], w["secs"]
    f = wave.open(w["path"], "wb"); f.setnchannels(ch); f.setsampwidth(2); f.setframerate(sr)
    frames = bytearray()
    for i in range(int(sr * secs)):
        t = (f0 * i / sr) % 1.0
        v = (1.0 if t < 0.5 else -1.0) if kind == "square" else (4 * t - 1 if t < 0.5 else 3 - 4 * t)
        a = int(max(-1, min(1, amp * v)) * 32767)
        frames += struct.pack("<h", a) if ch == 1 else struct.pack("<hh", a, 0)
    f.writeframes(bytes(frames)); f.close()
print("ok")
`;
    const out = execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", `admin@${ip}`, "/usr/bin/python3", "-", `'${JSON.stringify(waves)}'`],
        { encoding: "utf8", input: py, env: Object.assign({}, process.env, { SSHPASS: process.env.SSHPASS || "admin" }) });
    return out.trim() === "ok";
}
const SQUARE_WAVES = [
    { path: "/tmp/hs_sq220.wav", sr: 44100, f0: 220, kind: "square", amp: 0.25, ch: 1, secs: 8, label: "square 220 Hz mono 44.1 kHz" },
    { path: "/tmp/hs_sq110L.wav", sr: 48000, f0: 110, kind: "square", amp: 0.25, ch: 2, secs: 8, label: "square 110 Hz hard left 48 kHz" },
    { path: "/tmp/hs_sq440.wav", sr: 44100, f0: 440, kind: "square", amp: 0.1, ch: 1, secs: 8, label: "square 440 Hz mono -20 dB" },
    { path: "/tmp/hs_tri220.wav", sr: 44100, f0: 220, kind: "tri", amp: 0.25, ch: 1, secs: 8, label: "triangle 220 Hz mono" },
    // the user's report: a C1 square (odd harmonics only), Low 156.1 Hz, High 2.90 kHz, Every 8th, Size 2k: ROOT = lowest partial inside the band
    // (5th harmonic, 163.5 Hz), series f0 32.7 Hz below the band
    { path: "/tmp/hs_c1sq.wav", sr: 48000, f0: 32.7, kind: "square", amp: 0.25, ch: 1, secs: 8, label: "C1 square 32.7 Hz mono 48 kHz (Low 156.1 / High 2900 / Every 8th / 2k)", root: 163.5, rootH: 5,
      band: { "Low Cut": 156.1, "High Cut": 2900, "Pattern": 7, "Size": 1 } },
];

function runDevice(dev) {
    const cfg = require(path.join(__dirname, "..", "src", dev.slug + "_config.js"));
    const IDX = [cfg[dev.pre + "_SC_FRAME"], cfg[dev.pre + "_SC_AWAKE"], cfg[dev.pre + "_SC_LEVEL"], cfg[dev.pre + "_SC_SEL"]];
    if (IDX.some((v) => typeof v !== "number")) { check(!dev.tolerant, `[${dev.track}] telemetry layout constants missing from src/${dev.slug}_config.js`); if (dev.tolerant) return; }
    const tag = `[${dev.track}]`;
    const info = lom(`
        var n = new LiveAPI("live_set").getcount("tracks");
        for (var t = 0; t < n; t++) {
            var tr = new LiveAPI("live_set tracks " + t);
            if (String(tr.get("name")) !== ${JSON.stringify(dev.track)}) continue;
            var rack = new LiveAPI("live_set tracks " + t + " devices 0");
            var nc = rack.getcount("chains");
            var chains = [];
            for (var c = 0; c < nc; c++) {
                var base = "live_set tracks " + t + " devices 0 chains " + c;
                var ch = new LiveAPI(base);
                var nd = ch.getcount("devices");
                var d0 = new LiveAPI(base + " devices 0");
                chains.push({ path: base + " devices 0", name: String(d0.get("name")), nd: nd });
            }
            return { track: t, rack: "live_set tracks " + t + " devices 0", chains: chains };
        }
        return null;
    `);
    if (!check(!!info, `${tag} track found`)) return;
    check(info.chains.length === dev.channels && info.chains.every((c) => c.nd === 1),
        `${tag} rack has ${info.chains.length} chains (want ${dev.channels}), one device each`);
    const N = info.chains.length;
    // chain colours (scripts/make_spectral_rack.py CHAIN_COLORS: palette index nearest to the face's channel colour)
    const wantColors = CHAIN_COLOR_INDEX[dev.track];
    if (wantColors) {
        const got = lom(`var r = []; for (var c = 0; c < ${N}; c++) { var a = new LiveAPI("live_set tracks ${info.track} devices 0 chains " + c); r.push([Number(a.get("color_index")), Number(a.get("color"))]); } return r;`);
        check(got.length === wantColors.length && got.every((g, i) => g[0] === wantColors[i]),
            `${tag} chain colours follow the channel colours: color_index [${got.map((g) => g[0])}] (want [${wantColors}]), RGB [${got.map((g) => "#" + (g[1] >>> 0).toString(16).padStart(6, "0"))}]`);
    }
    // a device under redesign (tolerant): look the edited parameters up by name at run time, skip what no longer exists
    const hasParam = (name) => lom(`return !!findParam(${JSON.stringify(info.chains[0].path)}, ${JSON.stringify(name)});`);
    for (const k of ["num", "num2", "en"]) {
        if (!Array.isArray(dev[k][0])) continue;
        const found = dev[k][0].find(hasParam);
        if (found) dev[k] = [found, dev[k][1]];
        else { console.log(`INFO ${tag} no parameter among [${dev[k][0]}]: edit skipped`); dev[k] = null; }
    }
    const edits = [dev.num, dev.num2, dev.en, dev.frac, dev.blend, ["Mix", 40]].filter(Boolean);

    // the loop: clip on slot 0 of the track
    const clipOk = lom(`
        var slot = new LiveAPI("live_set tracks ${info.track} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) {
            try { slot.call("create_audio_clip", ${JSON.stringify(LOOP)}); } catch (e) { return "no create_audio_clip: " + e; }
        }
        if (Number(slot.get("has_clip")) === 0) return "clip not created";
        var clip = new LiveAPI("live_set tracks ${info.track} clip_slots 0 clip");
        clip.set("looping", 1);
        slot.call("fire");
        return "ok";
    `);
    check(clipOk === "ok", `${tag} loop clip playing (${clipOk})`);

    // peers: wait for all N instances of this rack in the bus
    let peers = [];
    for (let i = 0; i < 40; i++) {
        peers = lom(`
            var b = bus(), out = [], now = Date.now();
            for (var id in b.peers) { var p = b.peers[id]; if (p.kind === ${JSON.stringify(dev.slug)} && p.group.indexOf(${JSON.stringify(info.rack)}) >= 0 && now - p.t < 3000) {
                out.push({ id: id, group: p.group, path: p.path, chain: p.chainIndex, auto: p.auto, scope: p.scope });
            } }
            out.sort(function (a, b) { return a.chain - b.chain; });
            return out;
        `);
        if (peers.length === N && peers.every((p) => p.scope)) break;
        sleep(500);
    }
    check(peers.length === N, `${tag} ${peers.length} instances registered in one bus group (want ${N})`);
    if (peers.length !== N) { console.log(JSON.stringify(peers)); return; }
    const groupKey = peers[0].group;
    check(peers.every((p) => p.group === groupKey), `${tag} all instances share the group ${groupKey}`);
    check(peers.every((p, i) => p.chain === i && p.path === info.chains[i].path),
        `${tag} chain indices 0..${N - 1} and device paths match the LOM`);
    check(peers.every((p, i) => p.auto === Math.min(i, N - 1)), `${tag} Auto resolved to the chain index: [${peers.map((p) => p.auto)}]`);

    // gen telemetry: frame counter advances, awake, level, selection
    sleep(2500);
    const tele = () => peers.map((p) => lom(`return scopeVals(${JSON.stringify(p.scope)}, ${JSON.stringify(IDX)});`));
    const t0 = tele();
    sleep(700);
    const t1 = tele();
    check(t1.every((v, i) => v[0] !== t0[i][0]), `${tag} gen frame counters advance: [${t0.map((v) => v[0])}] -> [${t1.map((v) => v[0])}]`);
    // the input level decays between loop hits, so take the maximum over a second of reads
    const lvl = t1.map((v) => v[2]);
    for (let k = 0; k < 5; k++) { sleep(200); tele().forEach((v, i) => { lvl[i] = Math.max(lvl[i], v[2]); }); }
    check(t1.every((v) => v[1] === 1) && lvl.every((l) => l > 0.01), `${tag} gens awake, max input level over 1 s: [${lvl.map((l) => l.toFixed(3))}]`);
    check(t1.every((v, i) => v[3] === i + 1), `${tag} gens run output selection = chain + 1 (telemetry): [${t1.map((v) => v[3])}]`);
    let meter = 0;
    for (let i = 0; i < 8; i++) {
        meter = Math.max(meter, Number(lom(`return new LiveAPI("live_set tracks ${info.track}").get("output_meter_left");`)));
        sleep(150);
    }
    check(meter > 0.02, `${tag} track output meter ${meter.toFixed(3)} > 0.02`);

    let leaderIdx = 0;
    if (dev.rack) {
        const RK = ["CMP", "FOL", "ALIGNED", "FB", "ROLE", "SERVE", "ALIVE", "LAG", "UNDER", "LATENCY", "DOFF"].map((k) => cfg[dev.pre + "_SC_" + k]);
        check(RK.every((v) => typeof v === "number"), `${tag} rack telemetry constants present in the config`);
        let rk = [];
        for (let i = 0; i < 20; i++) {
            rk = peers.map((p) => lom(`return scopeVals(${JSON.stringify(p.scope)}, ${JSON.stringify(RK)});`));
            if (rk.filter((v) => v[0] === 1).length === 1 && rk.filter((v) => v[1] === 1 && v[2] === 1).length === N - 1) break;
            sleep(500);
        }
        const leaders = rk.map((v, i) => (v[0] === 1 ? i : -1)).filter((i) => i >= 0);
        check(leaders.length === 1, `${tag} exactly one instance computes (the leader): chains [${leaders}]  (cmp [${rk.map((v) => v[0])}], role [${rk.map((v) => v[4])}])`);
        const wantRole = peers.map((_, i) => (i === leaders[0] ? 1 : 2));
        check(rk.every((v, i) => v[4] === wantRole[i]), `${tag} roles [leader 1, follower 2]: got [${rk.map((v) => v[4])}] want [${wantRole}]`);
        leaderIdx = leaders.length === 1 ? leaders[0] : 0;
        check(rk.every((v, i) => i === leaders[0] || (v[1] === 1 && v[2] === 1 && v[3] === 0)), `${tag} every other instance follows, aligned by content, no fallback: follow [${rk.map((v) => v[1])}] aligned [${rk.map((v) => v[2])}] fb [${rk.map((v) => v[3])}]`);
        // instances of a rack start their gens in different host blocks, so the counter offset is a multiple of the block (measured 10240 .. 386560): content alignment handles it
        console.log(`      ${tag} follower counter offsets to the leader (informational): [${rk.map((v) => v[10])}]`);
        check(leaders.length === 1 && rk[leaders[0]][5] === Math.pow(2, dev.channels) - 1, `${tag} the leader serves every channel (serve mask ${leaders.length ? rk[leaders[0]][5] : "?"})`);
        check(rk.every((v) => v[9] === cfg[dev.pre + "_LATENCY"]), `${tag} every gen reports the latency ${cfg[dev.pre + "_LATENCY"]}: [${rk.map((v) => v[9])}]`);
        sleep(1500);
        const rk2 = peers.map((p) => lom(`return scopeVals(${JSON.stringify(p.scope)}, ${JSON.stringify(RK)});`));
        check(rk2.every((v) => v[8] === 0), `${tag} no ring underrun: [${rk2.map((v) => v[8])}]  (follower lag to the leader's clock: [${rk2.map((v) => v[7])}] samples)`);
        const trace = lom(`var g = new Global("spectral_split_trace"); return g.text ? String(g.text) : "";`);
        const readyRe = new RegExp(" " + dev.slug + " dsp ready after (\\d+) ms", "g");
        const readyMs = (trace.match(readyRe) || []).map((s) => Number(s.match(/(\d+) ms/)[1]));
        check(readyMs.length >= N, `${tag} every instance's deferred gen~ reached ready (${readyMs.length} trace lines; ready after [${readyMs.slice(-N)}] ms)`);
        const rdy = trace.split("\n").filter((l) => l.indexOf(" " + dev.slug + " dsp ") >= 0).slice(-3 * N);
        console.log("      " + dev.slug + " dsp lines: " + rdy.map((l) => l.replace(/ \[#.*$/, "")).join(" ; "));
        console.log("      load trace:\n      " + trace.split("\n").slice(-12).join("\n      "));
    }

    if (dev.slug === "harmsplit") {
        // periodic waves with missing harmonics: every chain's detector must lock within 1 % of the true pitch
        let made = false;
        try { made = makeWaves(SQUARE_WAVES); } catch (e) { console.log("      " + e.message); }
        check(made, `${tag} test waves written in the VM`);
        if (made) {
            lom(`var s = new LiveAPI("live_set"); while (s.getcount("scenes") < ${SQUARE_WAVES.length + 1}) s.call("create_scene", -1); return s.getcount("scenes");`);
            const IDXH = [cfg.HS_SC_F0, cfg.HS_SC_CONF, cfg.HS_SC_VOICED, cfg.HS_SC_SR, cfg.HS_SC_SERIES, cfg.HS_SC_ROOTH, cfg.HS_SC_ODD];
            const chain0 = info.chains[0].path;
            SQUARE_WAVES.forEach((w, wi) => {
                const slot = wi + 1;
                // a wave with its own detection band: set it on the first chain (linked to the others), restore it afterwards
                const saved = {};
                if (w.band) {
                    for (const name of Object.keys(w.band)) {
                        saved[name] = lom(`return getVal(${JSON.stringify(chain0)}, ${JSON.stringify(name)});`);
                        // Low Cut / High Cut carry parameter_exponent 3 (the LOM value is the unwarped position): device = lo + span * x^3
                        const warped = name === "Low Cut" || name === "High Cut";
                        const lomV = warped ? 19.4 + 19880.6 * Math.pow((w.band[name] - 19.4) / 19880.6, 1 / 3) : w.band[name];
                        lom(`return setVal(${JSON.stringify(chain0)}, ${JSON.stringify(name)}, ${lomV});`);
                    }
                    sleep(1500);
                }
                const ok = lom(`
                    var slot = new LiveAPI("live_set tracks ${info.track} clip_slots ${slot}");
                    if (Number(slot.get("has_clip")) === 0) { try { slot.call("create_audio_clip", ${JSON.stringify(w.path)}); } catch (e) { return "create_audio_clip: " + e; } }
                    if (Number(slot.get("has_clip")) === 0) return "clip not created";
                    new LiveAPI("live_set tracks ${info.track} clip_slots ${slot} clip").set("looping", 1);
                    slot.call("fire");
                    return "ok";`);
                if (check(ok === "ok", `${tag} ${w.label}: clip playing (${ok})`)) {
                    const want = w.root || w.f0;
                    let f0s = [], last = [];
                    for (let i = 0; i < 30; i++) {
                        sleep(300);
                        last = [peers[leaderIdx]].map((p) => lom(`return scopeVals(${JSON.stringify(p.scope)}, ${JSON.stringify(IDXH)});`));   // followers hold no analysis telemetry: the leader's scope
                        f0s = last.map((v) => v[0]);
                        if (f0s.every((f) => Math.abs(f / want - 1) < 0.01)) break;
                    }
                    check(f0s.every((f) => Math.abs(f / want - 1) < 0.01),
                        `${tag} ${w.label}: ${w.root ? "ROOT" : "f0"} telemetry (leader's scope) within 1 % of ${want} Hz: [${f0s.map((f) => f.toFixed(2))}] (series [${last.map((v) => v[4].toFixed(2))}], root harmonic [${last.map((v) => v[5])}], odd-only [${last.map((v) => v[6])}], salience [${last.map((v) => v[1].toFixed(2))}], voiced [${last.map((v) => v[2].toFixed(2))}], gen sr ${last[0][3]})`);
                    if (w.root) check(last.every((v) => Math.abs(v[4] / w.f0 - 1) < 0.01 && v[5] === w.rootH),
                        `${tag} ${w.label}: series f0 ${w.f0} Hz and root harmonic ${w.rootH}: [${last.map((v) => v[4].toFixed(2) + "/h" + v[5])}]`);
                }
                if (w.band) {
                    for (const name of Object.keys(w.band)) lom(`return setVal(${JSON.stringify(chain0)}, ${JSON.stringify(name)}, ${saved[name]});`);
                    sleep(1500);
                }
            });
            lom(`new LiveAPI("live_set tracks ${info.track}").call("stop_all_clips"); return 1;`);
            sleep(500);
            // put the drum loop back for the rest of the test
            lom(`new LiveAPI("live_set tracks ${info.track} clip_slots 0").call("fire"); return 1;`);
            sleep(1500);
        }
    }

    // link
    const get = (chain, name) => lom(`return getVal(${JSON.stringify(info.chains[chain].path)}, ${JSON.stringify(name)});`);
    const counter = () => lom(`var g = bus().groups[${JSON.stringify(groupKey)}]; return g ? g.counter : -1;`);
    const initial = {};
    for (const [name] of [...edits, ["Size"], ["Output"]]) initial[name] = info.chains.map((c, i) => get(i, name));
    const eq = (a, b) => Math.abs(a - b) < 1e-6;
    for (const name of [...edits.map((e) => e[0]), "Size"])
        check(initial[name].every((v) => eq(v, initial[name][0])), `${tag} initial ${name} equal on all chains: [${initial[name]}]`);

    function linkTest(name, value, from, label) {
        check(!eq(initial[name][0], value), `${tag} ${name}: test value ${value} differs from the initial ${initial[name][0]} (a no-op edit proves nothing)`);
        const others = info.chains.map((_, i) => i).filter((i) => i !== from);
        const c0 = counter();
        lom(`return setVal(${JSON.stringify(info.chains[from].path)}, ${JSON.stringify(name)}, ${value});`);
        const t0 = Date.now();
        let done = null;
        while (Date.now() - t0 < 2500) {
            const vals = others.map((i) => get(i, name));
            if (vals.every((v) => eq(v, value))) { done = Date.now() - t0; break; }
        }
        // done includes the LOM round trips (tens of ms each); the budget covers the 80 ms poll plus those
        check(done !== null && done <= LINK_MS + 150 * others.length,
            `${tag} ${label}: ${name} ${initial[name][0]} -> ${value} on chain ${from} reached chains [${others}] in ${done === null ? "TIMEOUT" : done + " ms"}`);
        sleep(2500);
        const c1 = counter();
        if (!check(c1 === c0 + 1, `${tag}   ${name}: group version ${c0} -> ${c1} after 2.5 s (exactly one publish, no loop)`))
            console.log("      group params: " + JSON.stringify(lom(`var g = bus().groups[${JSON.stringify(groupKey)}]; return g ? g.params : null;`)));
        const settled = info.chains.map((_, i) => get(i, name));
        check(settled.every((v) => eq(v, value)), `${tag}   ${name}: settled at ${value} on every chain: [${settled}]`);
    }
    if (dev.num) linkTest(dev.num[0], dev.num[1], 0, "link first -> rest");
    if (dev.num2) linkTest(dev.num2[0], dev.num2[1], N - 1, "link last -> rest");
    if (dev.en) linkTest(dev.en[0], dev.en[1], 1, "link middle -> rest (enum)");
    if (dev.frac) {
        linkTest(dev.frac[0], dev.frac[1], 0, "link first -> rest (fractional float)");
        if (dev.fracExp) {
            // a parameter with parameter_exponent: the LOM value is the unwarped position, the device (and the bus) sees the warped value
            const fe = dev.fracExp, span = fe.hi - fe.lo;
            const want = fe.lo + span * Math.pow((dev.frac[1] - fe.lo) / span, fe.exp);
            const got = lom(`var g = bus().groups[${JSON.stringify(groupKey)}]; return g && g.params[${JSON.stringify(fe.key)}] ? g.params[${JSON.stringify(fe.key)}].v : null;`);
            check(got !== null && Math.abs(got - want) < 1e-6 && got !== Math.round(got), `${tag}   ${dev.frac[0]}: bus holds the warped fractional value ${got} (want ${want.toFixed(6)})`);
        }
    }
    if (dev.blend) linkTest(dev.blend[0], dev.blend[1], N - 1, "link last -> rest (0..100)");
    linkTest("Mix", 40, N - 1, "link last -> rest (Mix, every device)");
    linkTest("Size", initial["Size"][0] === 2 ? 1 : 2, 0, "link first -> rest (Size)");

    // Output is not linked
    const outAll = N + 1;
    const cOut0 = counter();
    lom(`return setVal(${JSON.stringify(info.chains[0].path)}, "Output", ${outAll});`);
    sleep(1500);
    const outs = info.chains.map((_, i) => get(i, "Output"));
    check(eq(outs[0], outAll) && outs.slice(1).every((v) => eq(v, 0)), `${tag} Output not linked: chain 0 = All, others stay Auto: [${outs}]`);
    check(counter() === cOut0, `${tag}   Output does not publish (version ${cOut0} -> ${counter()})`);
    const tOut = tele();
    check(tOut[0][3] === 0 && tOut.slice(1).every((v, i) => v[3] === i + 2), `${tag}   gen selections after Output edit: [${tOut.map((v) => v[3])}] (want 0, 2, ...)`);
    lom(`return setVal(${JSON.stringify(info.chains[0].path)}, "Output", 0);`);
    sleep(1200);
    const tBack = tele();
    check(tBack.every((v, i) => v[3] === i + 1), `${tag}   Output back to Auto: selections [${tBack.map((v) => v[3])}]`);

    // gens still running after the Size change (audio, awake)
    sleep(1500);
    const tEnd = tele();
    check(tEnd.every((v) => v[1] === 1 && v[2] > 0), `${tag} gens running after all edits: awake [${tEnd.map((v) => v[1])}]`);

    // restore
    for (const name of [...edits.map((e) => e[0]), "Size"]) {
        lom(`return setVal(${JSON.stringify(info.chains[0].path)}, ${JSON.stringify(name)}, ${initial[name][0]});`);
        sleep(700);
    }
    const back = [...edits.map((e) => e[0]), "Size"].every((name) => info.chains.every((_, i) => eq(get(i, name), initial[name][0])));
    check(back, `${tag} parameters restored on every chain`);
    lom(`new LiveAPI("live_set tracks ${info.track}").call("stop_all_clips"); return 1;`);
}

for (const dev of DEVICES) {
    if (only.length && only.indexOf(dev.slug) < 0) continue;
    try { runDevice(dev); } catch (e) { check(false, `[${dev.track}] exception: ${e.message}`); }
}
lom(`new LiveAPI("live_set").call("stop_playing"); return 1;`);
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall Live checks passed");
process.exit(failures ? 1 : 0);
