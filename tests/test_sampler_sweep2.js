// sweep2 red tests for Better Sampler / Better Sampler Reactive 2.
// S2-1: per-instance buffers / receives must use "---" names. Live does not expand "#0" in a
// top-level device patcher (AGENTS 15), so two instances share buffer~ #0-bsamp, #0-bsvoices,
// #0-bsscope ... (sample, voice slots, telemetry and pitch curve clobber each other).
// Script strings are not expanded at all, so a v8ui must never hard-code "#0-..." either; the
// patcher passes the names in (setbuffers ...).
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
let fails = 0;
function fail(m) { fails++; console.log("FAIL: " + m); }
for (const f of ["Better Sampler.amxd", "Better Sampler Reactive 2.amxd"]) {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "devices", f)).slice(32).toString("utf8"));
    const boxes = doc.patcher.boxes.map((b) => b.box);
    for (const b of boxes) {
        if (typeof b.text === "string" && b.text.includes("#0")) fail(`${f} ${b.id}: box text uses #0: '${b.text}'`);
        const code = b.textfile && b.textfile.text;
        if (code) {
            const hits = code.match(/["']#0-[A-Za-z0-9_]+/g);
            if (hits) fail(`${f} ${b.id}: script hard-codes ${[...new Set(hits)].join(", ")}`);
        }
    }
}
console.log(fails ? `${fails} failed` : "ok");
process.exit(fails ? 1 : 0);
