#!/usr/bin/env node
/**
 * Generic Live smoke test for ONE device, driven through the Ableton MCP Bridge (host side, ssh tunnel to the
 * VM's bridge). Run it through scripts/vm_smoke.sh, which loads the device twice (tracks "SMK A", "SMK B", both
 * playing a looping test clip) into the smoke set first. Live runs only in the tart VM (AGENTS.md 1a).
 *
 *   node scripts/test_device_smoke_live.js --port 19911 --device "devices/Tiny Space.amxd" --out tests/out/smoke/tiny_space
 *        [--ssh admin@IP] [--budget 240] [--seed 1] [--bound 4]
 *
 * Checks: ready (probe or meter), LOM parameter sweep on instance A (min / default / max / 2 random values:
 * read-back, str_for_value, meters finite and < bound, Live answers), restore, isolation (instance B's
 * parameters and meter unchanged), screenshots at default and after the sweep. Writes report.json + report.txt.
 * Exit 1 when any FAIL.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync } = require("child_process");

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt("port", 9877));
const DEVICE = opt("device", "");
const OUT = opt("out", "tests/out/smoke/device");
const SSH = opt("ssh", "");
const BUDGET_MS = Number(opt("budget", 240)) * 1000;
const BOUND = Number(opt("bound", 4));
const REPO = path.join(__dirname, "..");
const cfgAll = JSON.parse(fs.readFileSync(path.join(__dirname, "smoke_devices.json"), "utf8"));
const cfg = Object.assign({ kind: "audio", ready: null, skipParams: [], readyTimeoutMs: 45000, needsSignal: true }, cfgAll[DEVICE] || {});
const slug = path.basename(OUT);
fs.mkdirSync(OUT, { recursive: true });

let seed = Number(opt("seed", 1)) >>> 0;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const log = [];
const fails = [];
const warns = [];
function say(s) { console.log(s); log.push(s); }
function FAIL(s) { fails.push(s); say("FAIL " + s); }
function WARN(s) { warns.push(s); say("WARN " + s); }

function rpc(action, params) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({ action, params });
        const req = http.request({ hostname: "127.0.0.1", port: PORT, path: "/rpc", method: "POST", timeout: 20000,
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
            const ch = [];
            res.on("data", (c) => ch.push(c));
            res.on("end", () => { try { resolve(JSON.parse(Buffer.concat(ch).toString())); } catch (e) { reject(new Error("bad JSON from bridge")); } });
        });
        req.on("timeout", () => { req.destroy(new Error("bridge timeout")); });
        req.on("error", reject);
        req.end(payload);
    });
}
async function lom(code) {
    // Live's main thread is busy while a device loads / compiles: retry a timed-out call a few times
    for (let attempt = 0; ; attempt++) {
        try {
            const out = await rpc("eval_js", { code });
            if (out.ok === false || out.error) throw new Error(String(out.error || "eval failed"));
            let r = out.result !== undefined ? out.result : out;
            if (r && typeof r === "object" && r.result !== undefined && Object.keys(r).length === 1) r = r.result; // bridge wraps the eval value once more
            return r;
        } catch (e) {
            if (attempt < 4 && /timed out|timeout/i.test(e.message)) { await sleep(2000); continue; }
            throw e;
        }
    }
}

const HELPERS = `
function dget(a, k) { var v = a.get(k); return (v && v.length !== undefined && typeof v !== "string") ? v[0] : v; }
function walk(p, out, depth) {
    var a = new LiveAPI(p); var n = a.getcount("devices");
    for (var i = 0; i < n; i++) {
        var dp = p + " devices " + i; var d = new LiveAPI(dp);
        out.push({ path: dp, name: String(dget(d, "name")), cls: String(dget(d, "class_name")), id: Number(d.id) });
        if (Number(dget(d, "can_have_chains")) === 1 && depth < 4) {
            var nc = d.getcount("chains");
            for (var c = 0; c < nc; c++) walk(dp + " chains " + c, out, depth + 1);
        }
    }
}
function meters(t) {
    var r = [];
    for (var i = 0; i < t.length; i++) { var a = new LiveAPI("live_set tracks " + t[i]);
        r.push(Number(dget(a, "output_meter_left")), Number(dget(a, "output_meter_right"))); }
    return r;
}
`;

async function findTracks() {
    return lom(`${HELPERS}
        var s = new LiveAPI("live_set"); var n = s.getcount("tracks"); var o = {};
        for (var i = 0; i < n; i++) { var t = new LiveAPI("live_set tracks " + i); var nm = String(dget(t, "name"));
            if (nm === "SMK A") o.a = i; if (nm === "SMK B") o.b = i; }
        return o;`);
}

async function enumDevice(trackIdx) {
    return lom(`${HELPERS}
        var devs = []; walk("live_set tracks ${trackIdx}", devs, 0);
        for (var k = 0; k < devs.length; k++) {
            var d = new LiveAPI(devs[k].path); var n = d.getcount("parameters"); var ps = [];
            for (var i = 0; i < n; i++) {
                var p = new LiveAPI(devs[k].path + " parameters " + i);
                var q = Number(dget(p, "is_quantized")) === 1;
                var items = q ? p.get("value_items") : null;
                var def = null; try { def = Number(dget(p, "default_value")); } catch (e) {}
                ps.push({ i: i, name: String(dget(p, "name")), min: Number(dget(p, "min")), max: Number(dget(p, "max")),
                    value: Number(dget(p, "value")), q: q, items: items ? Array.prototype.slice.call(items).map(String) : null,
                    en: Number(dget(p, "is_enabled")), def: def });
            }
            devs[k].params = ps;
        }
        return devs;`);
}

const normPath = (p) => p.replace(/^live_set tracks \d+/, "T");

async function readValues(devs) {
    return lom(`${HELPERS}
        var devs = ${JSON.stringify(devs.map((d) => ({ path: d.path, n: d.params.length })))}; var o = {};
        for (var k = 0; k < devs.length; k++) for (var i = 0; i < devs[k].n; i++) {
            var p = new LiveAPI(devs[k].path + " parameters " + i); o[devs[k].path + "#" + i] = Number(dget(p, "value")); }
        return o;`);
}

async function meterRead(ts) { return lom(`${HELPERS} return meters(${JSON.stringify(ts)});`); }
const finite = (x) => typeof x === "number" && isFinite(x);

async function maxMeter(ts, ms, step) {
    const end = Date.now() + ms; let m = ts.map(() => 0);
    do { const r = await meterRead(ts); r.forEach((v, i) => { m[i >> 1] = Math.max(m[i >> 1], finite(v) ? v : 0); }); await sleep(step || 50); } while (Date.now() < end);
    return m;
}

function skip(name) {
    return name === "Device On" || cfg.skipParams.some((s) => (s.startsWith("/") ? new RegExp(s.slice(1, -1)).test(name) : s === name));
}

function pickValues(p) {
    const lo = p.min, hi = p.max;
    const vals = [lo];
    if (finite(p.def) && p.def >= lo && p.def <= hi) vals.push(p.def); else vals.push(p.value);
    vals.push(hi);
    for (let k = 0; k < 2; k++) {
        let v = lo + rnd() * (hi - lo);
        if (p.q || (Number.isInteger(p.min) && Number.isInteger(p.max) && hi - lo >= 2)) v = Math.round(v);
        vals.push(v);
    }
    return [...new Set(vals.map((v) => Math.round(v * 1e9) / 1e9))];
}

function shot(tag) {
    const base = path.join(OUT, tag);
    try {
        if (SSH) execFileSync("sshpass", ["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", SSH,
            "/usr/bin/python3 ~/sweep2/smoke/scripts/mm_os_input.py front Live"], { env: Object.assign({}, process.env, { SSHPASS: "admin" }), timeout: 30000, stdio: "ignore" });
    } catch (e) {}
    try {
        execFileSync("sleep", ["1.5"]);
        execFileSync(path.join(REPO, "scripts", "vm_shot.sh"), [base + "_full.png"], { timeout: 60000, stdio: "ignore" });
        const w = Number(/pixelWidth: (\d+)/.exec(execFileSync("sips", ["-g", "pixelWidth", base + "_full.png"], { encoding: "utf8" }))[1]);
        const h = Number(/pixelHeight: (\d+)/.exec(execFileSync("sips", ["-g", "pixelHeight", base + "_full.png"], { encoding: "utf8" }))[1]);
        const sc = w / 1920, offY = h - 1080 * sc; // VM screen 1920x1080 in the tart window (title bar on top)
        const y0 = Math.round(offY + 560 * sc), hh = Math.min(Math.round(450 * sc), h - y0);
        execFileSync("sips", ["-c", String(hh), String(w), "--cropOffset", String(y0), "0", base + "_full.png", "--out", base + ".png"], { stdio: "ignore" });
        say("shot " + base + ".png (device area), " + base + "_full.png");
        return base + ".png";
    } catch (e) { WARN("screenshot " + tag + " failed: " + e.message.split("\n")[0]); return null; }
}

async function selectDevice(trackIdx, devId) {
    try {
        await lom(`${HELPERS}
            var v = new LiveAPI("live_set view"); var t = new LiveAPI("live_set tracks ${trackIdx}");
            v.set("selected_track", "id " + Number(t.id));
            v.call("select_device", "id ${devId}");
            try { var av = new LiveAPI("live_app view"); av.call("show_view", "Detail/DeviceChain"); } catch (e) {}
            return 1;`);
    } catch (e) { WARN("select device failed: " + e.message); }
}

(async () => {
    const report = { device: DEVICE, slug, kind: cfg.kind, port: PORT, config: cfg, started: new Date().toISOString(), steps: {} };
    let code = 0;
    try {
        // ---- 0. Live answers, tracks, playing
        const ping = await lom(`var s = new LiveAPI("live_set"); s.call("start_playing"); return { tempo: Number(s.get("tempo")), playing: Number(s.get("is_playing")) };`);
        say(`bridge ok, tempo ${ping.tempo}`);
        const tr = await findTracks();
        if (tr.a === undefined || tr.b === undefined) { FAIL("tracks 'SMK A' / 'SMK B' not found (setup failed)"); throw new Error("setup"); }
        const TS = [tr.a, tr.b];
        const devA = await enumDevice(tr.a), devB = await enumDevice(tr.b);
        report.devicesA = devA.map((d) => ({ name: d.name, cls: d.cls, path: normPath(d.path), params: d.params.length }));
        say(`instance A: ${devA.length} device(s): ${devA.map((d) => d.name + "(" + d.params.length + ")").join(", ")}`);
        if (!devA.length) { FAIL("no device loaded on track A"); throw new Error("nodevice"); }
        if (!devB.length) FAIL("no device loaded on track B");
        if (devA.length !== devB.length) FAIL(`instance count mismatch A ${devA.length} vs B ${devB.length}`);

        // ---- 1. ready
        const t1 = Date.now(); let ready = false, traceHit = null, peak = [0, 0];
        while (Date.now() - t1 < cfg.readyTimeoutMs) {
            if (cfg.ready) {
                const txt = await lom(`return String(new Global(${JSON.stringify(cfg.ready.global)}).text || "");`).catch(() => "");
                const hits = String(txt).split("\n").filter((l) => new RegExp(cfg.ready.regex).test(l));
                // every instance of the device (two instances; a rack may hold several) must report ready: count distinct "[#<id>" tags when present
                const ids = new Set(hits.map((l) => (/\[#([^ \]]+)/.exec(l) || [0, l])[1]));
                if (hits.length && ids.size >= (cfg.readyInstances || 2)) traceHit = hits.slice(-2);
            }
            const m = await maxMeter(TS, 400, 100); peak = peak.map((v, i) => Math.max(v, m[i] || 0));
            const sig = peak[0] > 0.001;
            if ((cfg.ready ? traceHit : true) && (sig || !cfg.needsSignal)) { ready = true; break; }
            await sleep(250);
        }
        report.steps.ready = { ok: ready, ms: Date.now() - t1, trace: traceHit, meterPeakA: peak[0], meterPeakB: peak[1] };
        if (!ready && cfg.ready) {
            const txt = await lom(`return String(new Global(${JSON.stringify(cfg.ready.global)}).text || "");`).catch((e) => "(read failed " + e.message + ")");
            report.steps.ready.traceTail = String(txt).split("\n").slice(-14);
            say("trace tail:\n  " + report.steps.ready.traceTail.join("\n  "));
        }
        if (!ready) FAIL(`not ready in ${cfg.readyTimeoutMs} ms (probe ${cfg.ready ? JSON.stringify(cfg.ready) : "meter"}: trace ${JSON.stringify(traceHit)}, meter A ${peak[0].toFixed(4)})`);
        else say(`ready after ${Date.now() - t1} ms (meter A ${peak[0].toFixed(3)}, B ${peak[1].toFixed(3)}${traceHit ? ", trace " + traceHit.join(" | ") : ""})`);
        if (ready && cfg.needsSignal === false && peak[0] <= 0.001) WARN("output silent at default (needsSignal false in config)");
        const base = await maxMeter(TS, 2500, 50);
        report.steps.baseline = base;
        say(`baseline meters A ${base[0].toFixed(3)} B ${base[1].toFixed(3)}`);

        // ---- 2. screenshot default
        await selectDevice(tr.a, devA[0].id);
        report.shotDefault = shot("default");

        // ---- 3. sweep on A
        const snapB0 = await readValues(devB);
        const initial = {}; devA.forEach((d) => d.params.forEach((p) => { initial[d.path + "#" + p.i] = p.value; }));
        const results = []; let tested = 0, total = 0, exhausted = false, isoBad = 0, bBound = base[1] * 1.6 + 0.08, bMax = 0;
        devA.forEach((d) => d.params.forEach((p) => { if (!skip(p.name)) total++; }));
        const tSweep = Date.now();
        outer:
        for (const d of devA) {
            for (const p of d.params) {
                if (skip(p.name)) continue;
                const label = `${d.name}[${normPath(d.path).replace(/^T /, "")}] / ${p.name}`;
                if (!p.en) { results.push({ label, skipped: "disabled" }); continue; }
                if (!(p.max > p.min)) { results.push({ label, skipped: "no range" }); continue; }
                if (Date.now() - tSweep > BUDGET_MS) { exhausted = true; break outer; }
                const rec = { label, name: p.name, min: p.min, max: p.max, q: p.q, items: p.items, tests: [] };
                for (const v of pickValues(p)) {
                    let r;
                    try {
                        r = await lom(`${HELPERS}
                            var p = new LiveAPI(${JSON.stringify(d.path + " parameters " + p.i)});
                            p.set("value", ${v});
                            var rb = Number(dget(p, "value")); var s = ""; try { s = String(p.call("str_for_value", rb)); } catch (e) { s = "ERR " + e; }
                            return { rb: rb, s: s };`);
                    } catch (e) { FAIL(`${label}: bridge/Live stopped answering after set ${v}: ${e.message}`); throw new Error("dead"); }
                    await sleep(70);
                    let m;
                    try { m = await meterRead(TS); } catch (e) { FAIL(`${label}: Live not responding after set ${v}`); throw new Error("dead"); }
                    const range = p.max - p.min, intLike = p.q || (Number.isInteger(p.min) && Number.isInteger(p.max) && range >= 2 && Number.isInteger(r.rb)); // Live rounds integer parameters
                    const tol = intLike ? 0.5 : Math.max(1e-3 * range, 1e-6);
                    const rbOk = finite(r.rb) && Math.abs(r.rb - v) <= tol;
                    const mA = Math.max(finite(m[0]) ? m[0] : 0, finite(m[1]) ? m[1] : 0);
                    const bad = [];
                    if (!rbOk) bad.push(`read-back ${r.rb} != set ${v}`);
                    if (!r.s || /^ERR/.test(r.s)) bad.push(`str_for_value: ${r.s || "empty"}`);
                    if (!m.every(finite)) bad.push("non-finite meter");
                    else if (m.some((x) => x >= BOUND)) bad.push(`meter ${Math.max(...m).toFixed(2)} >= ${BOUND}`);
                    if (finite(m[3])) bMax = Math.max(bMax, m[3], m[2]);
                    rec.tests.push({ v, rb: r.rb, str: r.s, meterA: mA, ok: !bad.length });
                    if (bad.length) FAIL(`${label} @${v} (${r.s}): ${bad.join("; ")}`);
                    if (v === p.max) {
                        const sb = await readValues(devB);
                        for (const k of Object.keys(snapB0)) if (Math.abs(sb[k] - snapB0[k]) > 1e-6) { isoBad++; FAIL(`isolation: B ${k} changed ${snapB0[k]} -> ${sb[k]} after A ${label}=max`); snapB0[k] = sb[k]; }
                    }
                }
                // restore
                try { await lom(`${HELPERS} var p = new LiveAPI(${JSON.stringify(d.path + " parameters " + p.i)}); p.set("value", ${initial[d.path + "#" + p.i]}); return 1;`); } catch (e) { FAIL(`${label}: restore failed ${e.message}`); throw new Error("dead"); }
                results.push(rec); tested++;
            }
        }
        if (exhausted) WARN(`time budget ${BUDGET_MS / 1000}s exhausted: ${tested}/${total} parameters swept`);
        if (bMax > bBound) FAIL(`isolation: instance B meter reached ${bMax.toFixed(3)} (baseline ${base[1].toFixed(3)}) while A was swept`);
        report.steps.sweep = { total, tested, exhausted, ms: Date.now() - tSweep, isolationParamChanges: isoBad, bMeterMax: bMax };
        report.params = results;
        say(`sweep: ${tested}/${total} parameters, ${results.reduce((n, r) => n + (r.tests ? r.tests.length : 0), 0)} sets in ${Math.round((Date.now() - tSweep) / 1000)} s`);

        // ---- 4. after-sweep state
        const fin = await readValues(devA); let drift = 0;
        for (const k of Object.keys(initial)) if (Math.abs(fin[k] - initial[k]) > 1e-3 * (1 + Math.abs(initial[k]))) { drift++; if (drift <= 5) WARN(`restore drift ${k}: ${initial[k]} -> ${fin[k]}`); }
        const post = await maxMeter(TS, 2000, 50);
        say(`after sweep meters A ${post[0].toFixed(3)} B ${post[1].toFixed(3)}`);
        if (cfg.needsSignal && post[0] <= 0.001) WARN("output silent after restoring defaults");
        await selectDevice(tr.a, devA[0].id);
        report.shotAfter = shot("after_sweep");
    } catch (e) {
        if (!["setup", "nodevice", "dead"].includes(e.message)) FAIL("harness error: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | "));
    }
    report.fails = fails; report.warns = warns; report.durationMs = Date.now() - T0;
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
    const txt = [`${DEVICE} (${cfg.kind}) ${fails.length ? "FAIL" : "PASS"}  ${Math.round(report.durationMs / 1000)} s`,
        `fails ${fails.length}, warns ${warns.length}`, ...fails.slice(0, 60).map((s) => "FAIL " + s), ...warns.map((s) => "WARN " + s), "", ...log].join("\n");
    fs.writeFileSync(path.join(OUT, "report.txt"), txt + "\n");
    say(`${fails.length ? "RESULT FAIL" : "RESULT PASS"} ${DEVICE}: ${fails.length} fails, ${warns.length} warns, ${Math.round(report.durationMs / 1000)} s`);
    process.exit(fails.length ? 1 : 0);
})();
