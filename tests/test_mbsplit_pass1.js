#!/usr/bin/env node
/**
 * Pass 1 RED tests for devices/Multiband Split.amxd (bug hunt, tests only).
 *
 * Each test below pins a defect found in Pass 1 at the pass bar: code
 * evidence of expected-vs-actual behaviour. Both tests FAIL on the
 * current tree (d72ee17) and must pass once the defect is fixed.
 * No production code is changed by this file.
 *
 * Defect 1 (UI / functional): the volume-slider mapping pair in
 *   src/mbsplit_ui.js is not invertible at low gains.
 * Defect 2 (DSP display mirror / AGENTS.md architecture): the FIR
 *   lowpass display approximation in src/mbsplit_config.js exceeds
 *   its stated 0.1 tolerance against the real kernel — including at
 *   MBSPLIT_DEFAULT_F1 (120 Hz), a legal Live F2 value.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "src", "mbsplit_config.js");
const UI_PATH = path.join(ROOT, "src", "mbsplit_ui.js");

const cfg = require(CONFIG_PATH);

const failures = [];
function check(name, fn) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (err) {
        failures.push(name + ": " + err.message);
        console.log("FAIL " + name + ": " + err.message);
    }
}

function extractFunction(source, name) {
    const start = source.indexOf("function " + name + "(");
    assert.ok(start >= 0, "could not find function " + name + " in mbsplit_ui.js");
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error("unterminated function " + name);
}

const uiSource = fs.readFileSync(UI_PATH, "utf8");
const slider = new Function(
    "clamp",
    extractFunction(uiSource, "gainDbToSliderNorm") +
        "\n" +
        extractFunction(uiSource, "sliderNormToGainDb") +
        "\nreturn { gainDbToSliderNorm: gainDbToSliderNorm, sliderNormToGainDb: sliderNormToGainDb };"
)(cfg.clamp);

check("volume slider mapping round-trips low gains (defect: sliderNormToGainDb dead zone swallows -69..-62.5 dB)", function () {
    const bad = [];
    for (let g = -69.5; g <= 18.0001; g += 0.5) {
        const norm = slider.gainDbToSliderNorm(g);
        const back = slider.sliderNormToGainDb(norm);
        if (Math.abs(back - g) > 0.5) {
            bad.push(g.toFixed(1) + " dB -> norm " + norm.toFixed(4) + " -> " + back.toFixed(1) + " dB");
        }
    }
    assert.deepStrictEqual(
        bad,
        [],
        "volume slider mapping is not invertible (gain -> norm -> gain): " + bad.join("; ")
    );
});

check("volume slider mapping has no dead gap (defect: sliderNormToGainDb jumps from -70 dB to about -62.4 dB)", function () {
    let prev = slider.sliderNormToGainDb(0.0);
    let worst = null;
    for (let n = 0.001; n <= 1.0001; n += 0.001) {
        const db = slider.sliderNormToGainDb(Math.min(n, 1.0));
        if (db - prev > 1.0 && !worst) worst = { atNorm: +n.toFixed(3), from: prev, to: db };
        prev = db;
    }
    assert.strictEqual(
        worst,
        null,
        "sliderNormToGainDb jumps " + (worst ? worst.from.toFixed(1) + " -> " + worst.to.toFixed(1) + " dB at norm " + worst.atNorm : "") +
            ": gains in (-70, -62.4) dB are unreachable from the volume slider"
    );
});

function firApproxWorst(fc, sr) {
    const D = cfg.firLatencyForSampleRate(sr);
    const kh = cfg.designFirHalfKernel(fc, sr, D);
    let worst = { d: 0 };
    for (let i = 0; i <= 400; i++) {
        const f = 20 * Math.pow(1000, i / 400);
        if (f > sr / 2) continue;
        const real = cfg.evalFirHalfKernel(kh, f, sr);
        const approx = cfg.computeFirLowpassMag(f, fc, sr);
        const d = Math.abs(real - approx);
        if (d > worst.d) worst = { d: d, f: +f.toFixed(1), fc: fc, sr: sr, real: +real.toFixed(3), approx: +approx.toFixed(3) };
    }
    return worst;
}

check("FIR display approximation stays within 0.1 of the real kernel (defect: computeFirLowpassMag exceeds its stated tolerance at low crossovers)", function () {
    let worst = { d: 0 };
    const offenders = [];
    for (const sr of [48000, 96000]) {
        for (const fc of [40, 120, 300, 800, 2000, 4500, 9000]) {
            const w = firApproxWorst(fc, sr);
            if (w.d > worst.d) worst = w;
            if (w.d > 0.1) offenders.push("fc=" + fc + "/sr=" + sr + " d=" + w.d.toFixed(3));
        }
    }
    assert.ok(
        worst.d <= 0.1,
        "computeFirLowpassMag deviates from the real FIR kernel by " + worst.d.toFixed(3) +
            " (limit 0.1) at f=" + worst.f + " Hz, fc=" + worst.fc + ", sr=" + worst.sr +
            " (real " + worst.real + " vs approx " + worst.approx + ")" +
            (offenders.length ? "; offenders: " + offenders.join(", ") : "")
    );
});

check("FIR display approximation stays within 0.1 at DEFAULT_F1=120 Hz (defect: even the default crossover exceeds the AGENTS.md contract)", function () {
    const fc = cfg.MBSPLIT_DEFAULT_F1;
    assert.strictEqual(fc, 120, "expected MBSPLIT_DEFAULT_F1 === 120");
    let worst = { d: 0 };
    for (const sr of [48000, 96000]) {
        const w = firApproxWorst(fc, sr);
        if (w.d > worst.d) worst = w;
    }
    assert.ok(
        worst.d <= 0.1,
        "computeFirLowpassMag at DEFAULT_F1=" + fc + " Hz exceeds 0.1: worst " + worst.d.toFixed(3) +
            " at f=" + worst.f + " Hz, sr=" + worst.sr +
            " (real " + worst.real + " vs approx " + worst.approx + ")"
    );
});

if (failures.length) {
    console.error("\n" + failures.length + " Pass 1 red test(s) failing:");
    for (const f of failures) console.error(" - " + f);
    process.exit(1);
}
console.log("\nAll Pass 1 tests passed.");
