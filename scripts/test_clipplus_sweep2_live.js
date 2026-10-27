#!/usr/bin/env node
// Sweep 2 Live checks for Clip+ (run against the smoke set with two Clip+ on SMK A / SMK B).
//   F8: per-instance scope buffer (a literal "#0-clipscope" is shared by every instance);
//   F10: toggle parameters restore after being swept.
const http = require("http");
const port = Number(process.argv[2] || 19911);
function rpc(code) {
    return new Promise((res, rej) => {
        const p = JSON.stringify({ action: "eval_js", params: { code } });
        const r = http.request({ hostname: "127.0.0.1", port, path: "/rpc", method: "POST", timeout: 20000,
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(p) } }, (s) => {
            const c = []; s.on("data", (d) => c.push(d)); s.on("end", () => { try { const o = JSON.parse(Buffer.concat(c)); let v = o.result !== undefined ? o.result : o; if (v && v.result !== undefined && Object.keys(v).length === 1) v = v.result; res(v); } catch (e) { rej(e); } });
        });
        r.on("error", rej); r.end(p);
    });
}
let fails = 0; const FAIL = (s) => { fails++; console.log("FAIL " + s); }; const OK = (s) => console.log("ok   " + s);
(async () => {
    // F8: is there a literal #0-clipscope buffer in the Max runtime? If yes the instances share it.
    const lit = await rpc('var b = new Buffer("#0-clipscope"); return {frames: b.framecount(), ch: b.channelcount()};');
    console.log("literal #0-clipscope:", JSON.stringify(lit));
    if (lit && lit.frames > 0) FAIL("F8: buffer '#0-clipscope' exists literally, so every Clip+ instance shares one scope buffer (use ---)");
    else OK("F8: no shared literal scope buffer");
    // F10: list device parameters of track 0 and toggle each toggle twice
    const names = await rpc('var out=[]; var a=new LiveAPI("live_set tracks 0 devices 0"); var n=a.getcount("parameters"); for(var i=0;i<n;i++){var p=new LiveAPI("live_set tracks 0 devices 0 parameters "+i); out.push([i,String(p.get("name")),Number(p.get("value")),Number(p.get("min")),Number(p.get("max")),Number(p.get("default_value")||0)]);} return out;');
    console.log(JSON.stringify(names));
    for (const [i, nm, v, mn, mx] of names) {
        if (mx - mn !== 1 && !(mx === 1 && mn === 0)) continue;
        const r = await rpc('var p=new LiveAPI("live_set tracks 0 devices 0 parameters ' + i + '"); var v0=Number(p.get("value")); p.set("value",' + (v ? 0 : 1) + '); p.set("value",v0); return [v0, Number(p.get("value"))];');
        const ok = Math.abs(r[0] - r[1]) < 1e-6;
        (ok ? OK : FAIL)(`F10: param ${i} ${nm} restore ${r[0]} -> ${r[1]}`);
    }
    process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("ERR", e.message); process.exit(2); });
