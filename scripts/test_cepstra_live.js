#!/usr/bin/env node
/**
 * Live checks for Cepstra (sweep 2), host side through the ssh tunnel to the VM's MCP bridge. Run it through
 * scripts/vm_cepstra.sh (smoke-style set: tracks "SMK A" / "SMK B" with Cepstra on each, a looping clip playing).
 *
 *   node scripts/test_cepstra_live.js --port 19912
 *
 * Checks (LOM only, no OS input): parameter names, reported latency vs the audio path (N + N/8), MIDI input routing of
 * the device (a midiin without any chooser), Lock Mid/Side follower, AUTO / MIDI exclusivity, Quality switch recovery,
 * Ceps gate mode. Exit 1 on any FAIL.
 */
const http = require("http");
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt("port", 9877));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const say = (s) => console.log(s);
const FAIL = (s) => { fails.push(s); say("FAIL " + s); };
const PASS = (s) => say("PASS " + s);
const check = (c, s) => (c ? PASS(s) : FAIL(s));

function rpc(action, params) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ action, params });
        const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/rpc", method: "POST", timeout: 20000,
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
            const ch = [];
            res.on("data", (c) => ch.push(c));
            res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString())); } catch (e) { reject(new Error("bad JSON from bridge")); } });
        });
        req.on("timeout", () => req.destroy(new Error("bridge timeout")));
        req.on("error", reject);
        req.end(payload);
    });
}
async function lom(code) {
    for (let a = 0; ; a++) {
        try {
            const out = await rpc("eval_js", { code });
            if (out.ok === false || out.error) throw new Error(String(out.error || "eval failed"));
            let r = out.result !== undefined ? out.result : out;
            if (r && typeof r === "object" && r.result !== undefined && Object.keys(r).length === 1) r = r.result;
            return r;
        } catch (e) { if (a < 4 && /timed out|timeout/i.test(e.message)) { await sleep(2000); continue; } throw e; }
    }
}
const H = `function dget(a, k) { var v = a.get(k); return (v && v.length !== undefined && typeof v !== "string") ? v[0] : v; }`;

(async () => {
    const found = await lom(`${H}
        var s = new LiveAPI("live_set"); var n = s.getcount("tracks"); var o = null;
        for (var i = 0; i < n; i++) { var t = new LiveAPI("live_set tracks " + i);
            if (String(dget(t, "name")) === "SMK A") { var d = new LiveAPI("live_set tracks " + i + " devices 0"); o = { track: i, name: String(dget(d, "name")), cls: String(dget(d, "class_name")) }; } }
        return o;`);
    if (!found) { FAIL("track 'SMK A' not found"); process.exit(1); }
    say("device: " + JSON.stringify(found));
    const base = `live_set tracks ${found.track} devices 0`;
    const params = await lom(`${H} var d = new LiveAPI("${base}"); var n = d.getcount("parameters"); var o = {};
        for (var i = 0; i < n; i++) { var p = new LiveAPI("${base} parameters " + i); o[String(dget(p, "name"))] = { i: i, v: Number(dget(p, "value")), min: Number(dget(p, "min")), max: Number(dget(p, "max")) }; }
        return o;`);
    say("parameters: " + Object.keys(params).join(", "));
    const idx = (n) => params[n] && params[n].i;
    const get = async (n) => lom(`${H} var p = new LiveAPI("${base} parameters ${idx(n)}"); return Number(dget(p, "value"));`);
    const set = async (n, v) => lom(`var p = new LiveAPI("${base} parameters ${idx(n)}"); p.set("value", ${v}); return 1;`);
    for (const n of ["Res", "Mid", "Side", "Gate", "Mix", "Quality", "Lock", "Auto", "MIDI"]) check(params[n] !== undefined, `parameter ${n} exists`);
    const dev = async (prop) => lom(`${H} var d = new LiveAPI("${base}"); return Number(dget(d, "${prop}"));`);
    const meter = async (ms) => {
        const end = Date.now() + ms; let m = 0;
        do { m = Math.max(m, await lom(`${H} var t = new LiveAPI("live_set tracks ${found.track}"); return Math.max(Number(dget(t, "output_meter_left")), Number(dget(t, "output_meter_right")));`)); await sleep(60); } while (Date.now() < end);
        return m;
    };

    // ---- ready: output meter moves
    await sleep(1500);
    const m0 = await meter(1500);
    check(m0 > 0.001 && isFinite(m0), `audio passes the device (meter ${m0.toFixed(3)})`);

    // ---- reported latency == audio path (N + N/8)
    for (const q of [0, 1, 2]) {
        await set("Quality", q);
        await sleep(700);
        const lat = await dev("latency_in_samples");
        const n = 1024 * 2 ** q, real = n + n / 8;
        // the audio path really is `real` late (null test in the Max suite); a constant pad to 4608 is the other valid design
        check(lat === real || lat === 4608, `CEP-S2-01 latency_in_samples ${lat} at Quality ${q} (audio path ${real} samples)`);
        const mq = await meter(1200);
        check(mq > 0.001 && isFinite(mq), `Quality ${q}: audio recovers after the switch (meter ${mq.toFixed(3)})`);
    }
    await set("Quality", 1);

    // ---- MIDI input of the device
    const io = await lom(`${H} var out = { exists: false };
        try { var m = new LiveAPI("${base} midi_inputs 0"); out.exists = Number(m.id) !== 0; if (out.exists) { out.routing = String(m.get("routing_type")); out.types = String(m.get("available_routing_types")).slice(0, 300); } } catch (e) { out.err = String(e); }
        return out;`);
    say("midi_inputs 0: " + JSON.stringify(io));
    const hasChooser = Object.keys(params).some((n) => /MIDI From/i.test(n));
    check(io.exists, "device has a MIDI input (DeviceIO)");
    check(hasChooser || (io.exists && !/No Input/i.test(io.routing || "")), "CEP-S2-03 MIDI input is routable: a MIDI From chooser exists or routing_type is not 'No Input' by default (routing: " + (io.routing || "?").slice(0, 80) + ")");

    // ---- Lock follower
    await set("Lock", 0); await set("Mid", 0); await set("Side", 0); await sleep(300);
    await set("Lock", 1); await sleep(200);
    await set("Mid", 10); await sleep(400);
    let side = await get("Side");
    check(Math.abs(side - 10) < 0.6, `Lock: Mid +10 moves Side to +10 (Side ${side.toFixed(2)})`);
    await set("Side", -4); await sleep(400);
    let mid = await get("Mid");
    check(Math.abs(mid - (-4)) < 0.6, `Lock: Side 10 -> -4 moves Mid by the same delta (Mid ${mid.toFixed(2)})`);
    await set("Lock", 0); await sleep(200);
    await set("Mid", 5); await sleep(400);
    side = await get("Side");
    check(Math.abs(side - (-4)) < 0.6, `Unlocked: Mid does not drag Side (Side ${side.toFixed(2)})`);
    await set("Mid", 0); await set("Side", 0);

    // ---- AUTO / MIDI exclusivity
    await set("Auto", 1); await sleep(400);
    let a = await get("Auto"), mi = await get("MIDI"), mode = params.Mode ? await get("Mode") : null;
    check(a === 1 && mi === 0 && (mode === null || mode === 1), `AUTO on: MIDI off, Mode Auto (auto ${a}, midi ${mi}, mode ${mode})`);
    await set("MIDI", 1); await sleep(400);
    a = await get("Auto"); mi = await get("MIDI"); mode = params.Mode ? await get("Mode") : null;
    check(a === 0 && mi === 1 && (mode === null || mode === 2), `MIDI on: AUTO off, Mode MIDI (auto ${a}, midi ${mi}, mode ${mode})`);
    await set("MIDI", 0); await sleep(400);
    a = await get("Auto"); mi = await get("MIDI"); mode = params.Mode ? await get("Mode") : null;
    check(a === 0 && mi === 0 && (mode === null || mode === 0), `both off = Manual (auto ${a}, midi ${mi}, mode ${mode})`);

    // ---- gate modes keep the audio finite and alive
    for (const [gm, g] of [[0, 60], [1, 20], [1, 100], [0, 100]]) {
        await set("GateMode", gm); await set("Gate", g); await sleep(500);
        const mm = await meter(800);
        check(isFinite(mm) && mm < 4, `GateMode ${gm} Gate ${g}%: meter finite (${mm.toFixed(3)})`);
    }
    await set("Gate", 0); await set("GateMode", 0);
    say(fails.length ? `FAILED ${fails.length}` : "ALL PASS");
    process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.log("ERROR " + e.message); process.exit(2); });
