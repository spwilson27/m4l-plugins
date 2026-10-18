// Tiny Space — v8ui visualization + seed config generator
// Display-only (bars pulse with per-line delay energy)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

let bufName = "";
let currentSeed = 1;
let activeCount = 10;
let barLevel = new Array(20).fill(0);
let barTrail = new Array(20).fill(0);
let meterVal = new Array(20).fill(0);

// ---- Seeded PRNG (mulberry32) ----
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function computeConfig(s) {
    const rng = mulberry32(s >>> 0);
    const ac = 4 + Math.floor(rng() * 17); // 4..20
    const lens = [];
    const chars = [];
    for (let i = 0; i < 20; i++) {
        lens.push(rng());
        chars.push(rng());
    }
    return { activeCount: ac, lens: lens, chars: chars };
}

function pokeConfig(cfg) {
    const samples = [cfg.activeCount];
    for (let i = 0; i < 20; i++) samples.push(cfg.lens[i]);
    for (let i = 0; i < 20; i++) samples.push(cfg.chars[i]);
    if (bufName) {
        try { new Buffer(bufName).poke(1, 0, samples); } catch (e) {}
    }
}

function applySeed(s) {
    currentSeed = (s | 0);
    const cfg = computeConfig(currentSeed);
    activeCount = cfg.activeCount;
    pokeConfig(cfg);
    mgraphics.redraw();
}

// ---- Max messages ----
function setbuffer(name) { bufName = name; applySeed(seed); }
function seed(n) { applySeed(n); }
function loadbang() { applySeed(seed); }

// meter inlets arrive as lineN(value)
for (let k = 0; k < 20; k++) {
    (function (idx) {
        this["line" + idx] = function (v) {
            meterVal[idx] = (typeof v === "number") ? v : 0;
            const a = Math.abs(meterVal[idx]);
            if (a > barLevel[idx]) barLevel[idx] = a;
            barTrail[idx] = Math.max(barTrail[idx] * 0.9, a);
            mgraphics.redraw();
        };
    })(k);
}

// ---- Layout ----
function getLayout() {
    let sz = mgraphics.size;
    return { w: sz[0], h: sz[1] };
}

// ---- Paint ----
function paint() {
    const lay = getLayout();
    const W = lay.w, H = lay.h;
    // background
    mgraphics.set_source_rgba(0.06, 0.07, 0.09, 1.0);
    mgraphics.rectangle(0, 0, W, H);
    mgraphics.fill();

    // bars
    const n = 20;
    const pad = 4;
    const barW = (W - pad * 2) / n;
    const maxH = H - 24;
    for (let i = 0; i < n; i++) {
        const x = pad + i * barW;
        const lvl = Math.min(1, Math.max(0, barTrail[i]));
        const bh = lvl * maxH;
        const y = H - 12 - bh;
        // left/right colour
        if (i < 10) {
            mgraphics.set_source_rgba(0.32, 0.77, 0.92, 0.9);
        } else {
            mgraphics.set_source_rgba(1.0, 0.69, 0.18, 0.9);
        }
        mgraphics.rectangle(x + 1, y, barW - 2, bh);
        mgraphics.fill();
        // active indicator
        if (i < activeCount) {
            mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.15);
            mgraphics.rectangle(x + 1, H - 12, barW - 2, 2);
            mgraphics.fill();
        }
    }

    // decay trails (faint)
    for (let i = 0; i < n; i++) {
        const x = pad + i * barW;
        const t = Math.min(1, Math.max(0, barLevel[i]));
        if (t > 0.01) {
            mgraphics.set_source_rgba(1.0, 1.0, 1.0, 0.08);
            mgraphics.rectangle(x + 1, H - 12 - t * maxH - 2, barW - 2, 2);
            mgraphics.fill();
        }
    }

    // title / readout
    mgraphics.set_source_rgba(0.75, 0.78, 0.82, 1.0);
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(9);
    mgraphics.move_to(4, 10);
    mgraphics.show_text("Tiny Space");
    mgraphics.move_to(4, H - 2);
    mgraphics.show_text("seed " + currentSeed + "  lines " + activeCount);
}

// ---- state serialization ----
function getvalueof() {
    return [1, currentSeed];
}

function setvalueof(v) {
    if (Array.isArray(v)) {
        if (v.length >= 2 && typeof v[1] === "number") {
            applySeed(v[1] | 0);
        } else if (v.length >= 1 && typeof v[0] === "number") {
            // v0 legacy: treat first as seed
            applySeed(v[0] | 0);
        }
    }
}

// ---- decay bar levels over time ----
function decayBars() {
    for (let i = 0; i < 20; i++) {
        barTrail[i] *= 0.94;
        barLevel[i] *= 0.97;
    }
    mgraphics.redraw();
}

// ---- idle animation ----
let idleTimer = null;

function onidle() {
    decayBars();
}

// helpers exposed for tests
function getBarTrail(i) { return barTrail[i]; }
function getMeterVal(i) { return meterVal[i]; }
function getActiveCount() { return activeCount; }
function getCurrentSeed() { return currentSeed; }

// preview hook for render_preview.py
function preview() {
    // representative meter pattern
    for (let i = 0; i < 20; i++) {
        barTrail[i] = 0.2 + 0.6 * Math.abs(Math.sin(i * 0.7 + 1.2));
        barLevel[i] = barTrail[i];
    }
    paint();
}
