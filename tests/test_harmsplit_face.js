#!/usr/bin/env node
"use strict";
/**
 * Behaviour of the Harmonic Split face around the rack machinery (src/harmsplit_ui.js): the gen-bound messages it re-sends to a deferred gen~,
 * the telemetry poll (header first, the leader's buffer while following, derived slots hidden while asleep). Uses tests/paint_bounds_lib.js
 * for a recording mgraphics and a scripted Buffer.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { makeRecorder, loadFace } = require("./paint_bounds_lib");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8").trimEnd();
const header = 'var GEN_DSP_TEXT = "";\nvar GEN_DSP_HASH = "test";\nvar SS_PREFIX = "harmsplit";\n';
const code = [header, read("harmsplit_config.js"), read("spectral_link.js"), read("spectral_theme.js"), read("spectral_dsp.js"), fs.readFileSync(path.join(SRC, "harmsplit_ui.js"), "utf8")].join("\n\n");
const cfg = require(path.join(__dirname, "..", "src", "harmsplit_config.js"));

const data = {};            // buffer name -> Float64Array
const peeks = [];           // [name, start, count]
const sent = [];            // outlet messages
function FakeBuffer(name) {
    this.peek = (ch, idx, count) => {
        peeks.push([name, idx, count]);
        const d = data[name];
        if (!d) return [];
        return Array.from(d.slice(idx, idx + count));
    };
}
const rec = makeRecorder(280, 141);
const sb = loadFace(code, rec, { Buffer: FakeBuffer, outlet: (...a) => sent.push(a) });

function scope(over) {
    const d = new Float64Array(cfg.HS_SCOPE_SAMPS);
    for (const [k, v] of Object.entries(over)) d[k] = v;
    return d;
}

// ---- messages re-sent to the deferred gen~
sb.setnames("---scope", "---ring");
sb.hsVals.size = 2;
sb.hsVals.pattern = 3;
sb.hsVals.sens = 100;
sb.hsVals.mix = 40;
sb.hsSel = 2;
sent.length = 0;
sb.ssDevResend();
assert.ok(sent.every((m) => m[0] === 2), "everything goes out of outlet 2 (the gen hub)");
const byMsg = Object.fromEntries(sent.map((m) => [m[1], m[2]]));
assert.strictEqual(byMsg.scope, "---scope");
assert.strictEqual(byMsg.ring, "---ring");
assert.strictEqual(byMsg.fftn, 4096, "Size index 2 -> 4096");
assert.strictEqual(byMsg.hpat, 4, "Pattern index 3 -> Pattern 4");
assert.strictEqual(byMsg.sensamt, 1, "Sens 100 % -> 1");
assert.ok(Math.abs(byMsg.mixamt - 0.4) < 1e-12, "Mix 40 % -> 0.4");
assert.strictEqual(byMsg.outsel, 2, "the resolved output selection is re-sent");
for (const m of ["hmaxp", "tiltamt", "thrdb", "flocut", "fhicut"]) assert.ok(m in byMsg, `${m} is re-sent`);
assert.ok(!("wetamt" in byMsg), "the old Mix message name is gone");

// ---- poll: header first, nothing more while the frame counter stands still
data["---scope"] = scope({ [cfg.HS_SC_FRAME]: 7, [cfg.HS_SC_AWAKE]: 1, [cfg.HS_SC_SR]: 48000, [cfg.HS_SC_N]: 2048, [cfg.HS_SC_F0]: 196, [cfg.HS_SC_SERIES]: 98, [cfg.HS_SC_ROOTH]: 2,
    [cfg.HS_SC_CONF]: 0.6, [cfg.HS_SC_VOICED]: 1, [cfg.HS_SC_NACT]: 12, [cfg.HS_SC_THREFF]: -50, [cfg.HS_SC_LVL]: -10, [cfg.HS_SC_ODD]: 1, 5: 0.5 });
peeks.length = 0;
sb.hsPoll();
assert.deepStrictEqual(peeks.map((p) => p[2]), [4, cfg.HS_SCOPE_SAMPS], "first poll: the 4 header floats, then the whole buffer");
assert.strictEqual(peeks[0][1], cfg.HS_SC_FRAME, "the header is the frame counter / awake block");
assert.strictEqual(sb.hsScalars.f0, 196);
assert.strictEqual(sb.hsScalars.series, 98);
assert.strictEqual(sb.hsScalars.rootH, 2);
assert.strictEqual(sb.hsScalars.odd, 1);
assert.strictEqual(sb.hsScalars.threff, -50);
assert.strictEqual(sb.hsPre[5], 0.5, "columns are read");
peeks.length = 0;
sb.hsPoll();
assert.deepStrictEqual(peeks.map((p) => p[2]), [4], "an unchanged frame counter costs one 4-float peek");

// ---- asleep: the leader's last analysis is shown as empty
data["---scope"][cfg.HS_SC_FRAME] = 8;
data["---scope"][cfg.HS_SC_AWAKE] = 0;
sb.hsPoll();
assert.deepStrictEqual([sb.hsScalars.f0, sb.hsScalars.series, sb.hsScalars.rootH, sb.hsScalars.odd, sb.hsScalars.nact, sb.hsScalars.threff, sb.hsScalars.voiced],
    [0, 0, 0, 0, 0, cfg.HS_THR_MIN, 0], "asleep: no root, series, harmonics, voiced amount");

// ---- following: the display comes from the leader's buffer
data["---lead"] = scope({ [cfg.HS_SC_FRAME]: 3, [cfg.HS_SC_AWAKE]: 1, [cfg.HS_SC_F0]: 330, [cfg.HS_SC_SERIES]: 110, [cfg.HS_SC_ROOTH]: 3, [cfg.HS_SC_SR]: 44100, [cfg.HS_SC_N]: 4096 });
sb.hsLink = { rack: { displayScope: () => "---lead", messages: () => [["lead", "---lead"], ["epoch", 2], ["serve", 0], ["role", 2], ["inrack", 1]], state: () => ({}) }, notify() {} };
peeks.length = 0;
sb.hsPoll();
assert.ok(peeks.every((p) => p[0] === "---lead"), "a follower reads the leader's scope buffer");
assert.strictEqual(sb.hsScalars.f0, 330);
assert.strictEqual(sb.hsScalars.n, 4096);
sent.length = 0;
sb.ssDevResend();
const rk = sent.filter((m) => ["lead", "epoch", "serve", "role", "inrack"].includes(m[1])).map((m) => m[1]);
assert.deepStrictEqual(rk, ["lead", "epoch", "serve", "role", "inrack"], "the rack messages are re-sent with the parameters");
// back to the own buffer when the leader is gone
sb.hsLink = { rack: { displayScope: () => "", messages: () => [], state: () => ({}) }, notify() {} };
peeks.length = 0;
sb.hsPoll();
assert.ok(peeks.every((p) => p[0] === "---scope"), "no leader: the instance draws its own buffer");

// ---- the gen's alive counter comes from the instance's own buffer, whatever the display shows
data["---scope"][cfg.HS_SC_ALIVE] = 41;
assert.strictEqual(sb.ssGenAlive(), 41);
assert.strictEqual(sb.hsGenValue(cfg.HS_SC_FB), 0);
console.log("All Harmonic Split face tests passed");
