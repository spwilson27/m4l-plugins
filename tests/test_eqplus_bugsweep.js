"use strict";
// EQ+ bug sweep, pass 1 (iteration 1): red tests only, NO fixes.
// Each block pins a real defect found by inspection of the scoped files.
// Every block FAILS on the current tree for the stated reason; the file
// collects all failures and exits non-zero if any block fails.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "src", "eqplus_config.js");
const UI_PATH = path.join(ROOT, "src", "eqplus_ui.js");
const configSrc = fs.readFileSync(CONFIG_PATH, "utf8");
const uiSrc = fs.readFileSync(UI_PATH, "utf8");

// Mock Max environment, adapted from tests/test_eqplus.js loadFace(), with
// outlet() captured so tests can see exactly which `param <key> <value>`
// messages the face sends to the Live parameters on outlet 0.
function loadFace() {
    const outlets = [];
    const pokes = [];
    const sandbox = {
        outlets,
        pokes,
        paintError: null,
        posts: [],
        cursorLog: [],
        mgOps: null,
        _painting: false,
        notifyCount: 0,
        samplerate: 48000,
        jsarguments: ["eqplus"],
        messagename: "",
        inlet: 0,
        setTimeout() { return 0; },
        clearTimeout() {},
        setInterval() { return 0; },
        clearInterval() {},
    };
    sandbox.notifyclients = function () { sandbox.notifyCount++; };
    sandbox.notifyclients.hook = true;
    sandbox.max = {
        hidecursor() { sandbox.cursorLog.push("hide"); },
        showcursor() { sandbox.cursorLog.push("show"); },
    };
    sandbox.outlet = function () { outlets.push(Array.prototype.slice.call(arguments)); };
    function presentationBox(rect) {
        return {
            rect: rect.slice(),
            setattr(name, a, b, c, d) {
                if (name === "presentation_rect") this.rect = [a, b, c, d];
                else if (name === "hidden") this.hidden = a;
            },
            getattr(name) {
                if (name === "presentation_rect") return this.rect.slice();
                return 0;
            },
            message() {},
        };
    }
    const named = {
        "obj-viz": presentationBox([4, 4, 370, 161]),
        "obj-panel-bg": presentationBox([0, 0, 378, 169]),
    };
    sandbox.named = named;
    sandbox.latencySets = [];
    sandbox.patcher = {
        newdefault() { return { message() {}, getattr() { return 0; } }; },
        connect() {},
        getnamed(name) { return named[name] || null; },
        message() {},
        setattr(name, value) { sandbox.latencySets.push([String(name), value]); },
    };
    function Buffer(name) {
        const rec = { name: String(name) };
        const buf = {
            name: rec.name,
            poke(ch, a, b) { pokes.push({ name: rec.name, ch, a, b }); },
            peek(ch, index, count) {
                if (count && count > 1) {
                    const out = [];
                    for (let i = 0; i < count; i++) out.push(0);
                    return out;
                }
                if (/spec/.test(rec.name) && index === 1 && (ch === 1 || ch == null)) return 48000;
                return 0;
            },
            framecount() { return 8200; },
            channelcount() { return /spec/.test(rec.name) ? 4 : 1; },
            length() { return 8200; },
            send() {},
        };
        return new Proxy(buf, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== "string") return undefined;
                return function () { return 0; };
            },
        });
    }
    function Task(fn) {
        this.fn = fn;
        this._ran = false;
        const self = this;
        const run = function () {
            if (self._ran) return;
            self._ran = true;
            if (typeof fn === "function") fn();
        };
        this.schedule = run;
        this.repeat = run;
        this.cancel = function () { self._ran = true; };
        this.interval = 0;
    }
    function File() {
        this.isopen = false;
        this.eof = 0;
        this.open = function () { this.isopen = true; return 1; };
        this.writestring = function () {};
        this.close = function () { this.isopen = false; };
    }
    const globals = {};
    function Global(name) {
        if (!globals[name]) globals[name] = { owner: 0, t: 0, text: "" };
        return globals[name];
    }
    function Dict() {
        this.get = function () { return null; };
        this.set = function () {};
        this.stringify = function () { return "{}"; };
    }
    const mg = {
        size: [352, 161],
        relative_coords: 1,
        autofill: 1,
        init() {},
        redraw() {
            if (sandbox._painting) return;
            sandbox._painting = true;
            try {
                if (typeof sandbox.paint === "function") sandbox.paint();
            } catch (err) {
                sandbox.paintError = sandbox.paintError || err;
            } finally {
                sandbox._painting = false;
            }
        },
    };
    sandbox.mgraphics = new Proxy(mg, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== "string") return undefined;
            return function () {
                if (prop === "text_measure" || prop === "text_measure_simple") {
                    const s = arguments[0] == null ? "" : String(arguments[0]);
                    return [Math.max(4, s.length * 5.6), 11];
                }
                if (prop === "get_current_point") return [0, 0];
                if (prop === "font_extents") {
                    const e = [8, 2];
                    e.ascent = 8;
                    e.descent = 2;
                    e.height = 10;
                    return e;
                }
                return undefined;
            };
        },
        set(target, prop, value) {
            target[prop] = value;
            return true;
        },
    });
    sandbox.Buffer = Buffer;
    sandbox.Task = Task;
    sandbox.File = File;
    sandbox.Global = Global;
    sandbox.Dict = Dict;
    vm.createContext(sandbox);
    const src = "var GEN_DSP_TEXT = \"{}\";\nvar GEN_DSP_HASH = \"abc123def456\";\n"
        + configSrc + "\n" + uiSrc;
    vm.runInContext(src, sandbox, { filename: "eqplus_ui.js" });
    // The UI script sets Max global , overwriting sandbox.outlets;
    // the outlet() capture array survives in the closure, so expose it privately.
    sandbox.__outlets = outlets;
    return sandbox;
}

function paramEmissions(ui) {
    // outlet 0 messages of the form: outlet(0, "param", <key>, <value>)
    return ui.__outlets
        .filter((a) => a[0] === 0 && a[1] === "param")
        .map((a) => [a[2], a[3]]);
}
function hasParam(ui, key, value) {
    return paramEmissions(ui).some((p) => p[0] === key && p[1] === value);
}

const failures = [];
function bug(name, fn) {
    try {
        fn();
        console.log("[bugsweep] ok: " + name);
    } catch (e) {
        failures.push(name + " -- " + e.message);
        console.log("[bugsweep] FAIL: " + name + " -- " + e.message);
    }
}

// ---- Bug 1: emitAll never resyncs sidechain_fold, ref_gain or phase_mode ----
// getvalueof() (src/eqplus_ui.js:914-932) saves all three in the blob:
// showSidechainFold, refGainDb and phaseMode sit at indices 54, 56 and 58.
// applyStateArray() restores them into the face and calls emitAll()
// (src/eqplus_ui.js:985) to push the restored state back to the Live
// parameters, but emitAll (src/eqplus_ui.js:895-912) emits every other saved
// parameter and omits exactly these three keys. After an undo/redo or a
// setvalueof restore, the face and the gen move to the restored values while
// the automatable "Processing Mode" and "Reference Gain" parameters and the
// stored-only "Show Sidechain Fold" keep their stale values; on the next
// save the stale parameter values are what Live re-sends to the face.
bug("emitAll resyncs sidechain_fold, ref_gain and phase_mode after a blob restore", function () {
    const ui = loadFace();
    ui.preview();
    const blob = Array.prototype.slice.call(ui.getvalueof());
    assert.strictEqual(blob.length, 100, "state blob is 100 entries");
    blob[54] = 1;   // showSidechainFold
    blob[56] = -9;  // refGainDb
    blob[58] = 2;   // phaseMode = Linear Phase
    ui.__outlets.length = 0;
    ui.setvalueof(blob.slice());
    // The face itself did restore all three (these pass today):
    assert.strictEqual(ui.showSidechainFold, 1, "face restored the sidechain fold");
    assert.strictEqual(ui.refGainDb, -9, "face restored the reference gain");
    assert.strictEqual(ui.phaseMode, 2, "face restored the processing mode");
    // And emitAll did resync other saved keys (also passes today):
    assert.ok(hasParam(ui, "shift", 0), "emitAll emitted shift");
    assert.ok(hasParam(ui, "route", 0), "emitAll emitted route");
    // The three omitted keys (red today):
    assert.ok(hasParam(ui, "sidechain_fold", 1), "BUG: emitAll never emits sidechain_fold, so the restored fold never reaches its Live parameter");
    assert.ok(hasParam(ui, "ref_gain", -9), "BUG: emitAll never emits ref_gain, so the restored Reference Gain never reaches its Live parameter");
    assert.ok(hasParam(ui, "phase_mode", 2), "BUG: emitAll never emits phase_mode, so the restored Processing Mode never reaches its Live parameter");
});

// ---- Bug 2: Reference Gain face edits never reach the Live parameter at all ----
// The sidechain fold's Gain control is a face drag (gesture "refgain",
// src/eqplus_ui.js:2283-2288) whose drag handler mutates refGainDb
// (src/eqplus_ui.js:2607-2616) and whose double-click resets it
// (src/eqplus_ui.js:2676-2686). Neither path — nor finishGesture — ever calls
// emitParam("ref_gain", ...): a grep of src/eqplus_ui.js shows no
// emitParam("ref_gain"...) anywhere, while every other face-edited parameter
// (shift, gain, tilt_eq, bands, ...) is emitted on edit. The value is saved
// in the blob, but the automatable "Reference Gain" parameter
// (obj-ctrl-ref-gain in scripts/build_eqplus.py) keeps its old value, so its
// automation lane / saved parameter state disagrees with the drawn control.
bug("dragging the sidechain Reference Gain emits param ref_gain", function () {
    const ui = loadFace();
    ui.preview();
    ui.set_sidechain_fold(1);
    assert.strictEqual(ui.showSidechainFold, 1, "sidechain fold is open");
    ui.__outlets.length = 0;
    // Gain rect in the open fold: x 72..122, y 80..96 (sidechainFoldLayout).
    ui.onclick(80, 88, 1, 0, 0, 0, 0, 0);
    ui.ondrag(80, 48, 1, 0, 0, 0, 0, 0); // +40 px at 0.15 dB/px = +6.0 dB
    ui.ondrag(80, 48, 0, 0, 0, 0, 0, 0); // release: finishGesture
    assert.strictEqual(ui.refGainDb, 6, "the drag set the face's reference gain to +6 dB");
    assert.ok(
        hasParam(ui, "ref_gain", 6),
        "BUG: the Reference Gain drag changed refGainDb to 6 but no param ref_gain message was emitted, so the Live parameter still holds its old value"
    );
});

// ---- Bug 3: set_band_mode leaves enabled=1 on a band whose mode is Off ----
// Every other writer keeps enabled and mode consistent: the face's own
// setBandMode sets b.enabled = mode === 0 ? 0 : 1 (src/eqplus_ui.js:1812),
// the aggregate set_band forces enabled off at mode 0
// (src/eqplus_ui.js:4071), and applyStateArray does the same on restore
// (src/eqplus_ui.js:959). The automation inlet set_band_mode
// (src/eqplus_ui.js:4012-4024) sets b.mode without touching b.enabled, so
// automating "Band N Mode" to Off leaves the band saved as enabled=1,
// mode=0 — and the next blob restore silently flips enabled to 0, changing
// the Band Enable parameter by itself.
bug("set_band_mode to Off clears the band's enabled flag", function () {
    const ui = loadFace();
    ui.preview(); // band 1: enabled=1, mode=10 (High-Cut 2)
    ui.set_band_mode(0, 0);
    const v = Array.prototype.slice.call(ui.getvalueof());
    assert.strictEqual(v[13], 0, "band 1 mode is Off after set_band_mode(0, 0)");
    assert.strictEqual(
        v[12], 0,
        "BUG: set_band_mode(0, 0) left band 1 enabled=1 with mode Off (getvalueof index 12); every other writer forces enabled=0 at mode 0"
    );
});

// ---- Bug 4: Band Mode Info View text doubles every cut slope ----
// scripts/build_eqplus.py:410, the parameter_info / annotation for every
// "Band N Mode" parameter, says the cuts are "(12, 24, 48 or 96 dB/oct)".
// The modes are 1, 2, 4 and 8 poles (src/eqplus_config.js EQP_MODES:
// Low-Cut 1/2/4/8), i.e. 6, 12, 24 and 48 dB/oct — the text omits the
// 6 dB/oct 1-pole cut and doubles each remaining slope. This is the text
// Live shows in Info View for all eight bands' Mode parameters.
bug("Band Mode help text states the real cut slopes (6, 12, 24, 48 dB/oct)", function () {
    const build = fs.readFileSync(path.join(ROOT, "scripts", "build_eqplus.py"), "utf8");
    assert.ok(
        !build.includes("96 dB/oct"),
        "BUG: build_eqplus.py Band Mode help claims a 96 dB/oct cut; no EQ+ mode exceeds 48 dB/oct (8 poles)"
    );
    assert.ok(
        /\(6, 12, 24 or 48 dB\/oct\)/.test(build),
        "BUG: build_eqplus.py Band Mode help never mentions the 6 dB/oct Low-Cut 1 / High-Cut 1 slope"
    );
});

if (failures.length) {
    console.log("test_eqplus_bugsweep: " + failures.length + " red test(s):");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
}
console.log("test_eqplus_bugsweep: ok");
