#!/usr/bin/env node
/**
 * Better Sampler "reactive2" design: sidebar folds, tall viewer, traced envelope dots, per-voice filter display,
 * ADSR handle drags and that every parameter is reachable.
 * Run after `python3 scripts/build_sampler.py reactive2`.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "sampler_designs", "reactive2.json"), "utf8"));
const raw = fs.readFileSync(path.join(ROOT, "devices", spec.device));
const patcher = JSON.parse(raw.slice(32).toString("utf8")).patcher;
const box = patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-viz");

const emitted = [];
const sampleSpike = { at: 70000, v: 0.25, ch: 2 };   // the loaded sample's peak (channel 2, so all channels are read)
const scopeData = new Float32Array(256);   // what the mocked #0-bsscope buffer returns
const noop = () => {};
const sb = {
    mgraphics: new Proxy({ size: [spec.max_width, 169] }, { get: (t, k) => (k in t ? t[k] : noop) }),
    outlet: (...a) => emitted.push(a),
    notifyclients: noop, arrayfromargs: (a) => Array.from(a), post: noop,
    Buffer: function (name) {
        this.framecount = () => 96000; this.channelcount = () => 2; this.poke = noop;
        this.peek = (c, s, l) => {
            if (name === "#0-bsscope") return scopeData.slice(s, s + l);
            const a = new Float32Array(Math.max(1, l || 1));
            if (name === "#0-bsamp") { for (let i = 0; i < a.length; i++) a[i] = 0.05; const k = sampleSpike.at - s; if (k >= 0 && k < a.length && c === sampleSpike.ch) a[k] = sampleSpike.v; }
            return a;
        };
    },
    Task: function () { this.schedule = noop; this.cancel = noop; this.repeat = noop; },
    Math, Number, String, Array, Object, Float32Array, Uint8Array, JSON, Date,
};
vm.createContext(sb);
vm.runInContext(box.textfile.text, sb);
const FP = sb.FACE_PARAMS;
sb.setbuffers("#0-bsamp", "#0-bsvoices", "#0-bsscope", "#0-bspitch");
sb.sample_loaded("/Users/test/Pad.wav");
sb.sample_loaded("bang");

const params = () => emitted.filter((a) => a[1] === "param").map((a) => ({ key: a[2], v: a[3] }));
const zones = (kind, id) => sb.hitZones.filter((z) => z.kind === kind && (!id || z.id === id));
const inRange = (p) => { const s = FP[p.key]; assert.ok(s, `known param ${p.key}`); assert.ok(p.v >= s.lo - 1e-6 && p.v <= s.hi + 1e-6, `${p.key}=${p.v} in ${s.lo}..${s.hi}`); };
const plain = (a) => JSON.parse(JSON.stringify(a));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const lastWidth = () => { const w = emitted.filter((a) => a[1] === "setwidth_cmd").pop(); return w ? w[2] : null; };
const NSEC = spec.folds;
const ALL = (1 << NSEC) - 1;
const ID = ["engine", "details", "env", "filter", "lfo", "voice"];

// --- sample viewer: as wide as Better Sampler's sample panel, nearly full height ---
sb.setFoldMask(0);
sb.paint();
{
    assert.strictEqual(sb.VIEW.w, sb.MAIN.sample[2], "viewer width = Better Sampler's sample panel width");
    assert.ok(sb.STRIP.y >= sb.VIEW.y + sb.VIEW.h && sb.STRIP.y + sb.STRIP.h <= 169, "engine strip sits directly under the viewer");
    assert.strictEqual(sb.STRIP.w, sb.VIEW.w, "strip as wide as the viewer");
    const w = zones("wave")[0];
    assert.ok(w.h >= 65 && w.w >= 455, `waveform ${w.w} x ${w.h} fills the viewer`);
    assert.ok(sb.VIEW.x >= sb.SB_X + sb.SB_W, "viewer sits right of the sidebar");
}

// --- every fold combination: widths, no overlapping rects, zones inside the device ---
for (let m = 0; m <= ALL; m++) {
    emitted.length = 0;
    sb.setFoldMask(m);
    const w = lastWidth();
    assert.strictEqual(w, sb.foldWidth(m), `mask ${m}: setwidth_cmd = foldWidth`);
    const rects = sb.sectionRects(m);
    assert.strictEqual(rects.length, m.toString(2).split("1").length - 1, `mask ${m}: one rect per open section`);
    let prevEnd = sb.VIEW.x + sb.VIEW.w;
    for (const r of rects) {
        assert.ok(r.x >= prevEnd, `mask ${m}: section ${r.id} does not overlap the previous one / the viewer`);
        prevEnd = r.x + r.w;
    }
    assert.ok(prevEnd <= w, `mask ${m}: sections inside the width`);
    for (const mode of [0, 3, 4]) for (const sliced of [0, 1]) {
        sb.storeParam("mode", mode, true); sb.storeParam("sliced", sliced, true);
        sb.paint();
        for (const z of sb.hitZones) {
            assert.ok(z.x >= -1 && z.y >= -1 && z.x + z.w <= w + 1 && z.y + z.h <= 170, `mask ${m}: zone ${z.kind} ${z.key || z.action || z.id || ""} inside ${w}x169`);
        }
        // zones of different sections never overlap each other (sections are separate columns)
        for (const a of rects) for (const b of rects) if (a !== b) {
            const za = sb.hitZones.filter((z) => z.x >= a.x && z.x + z.w <= a.x + a.w + 1);
            for (const z of za) assert.ok(!(z.x >= b.x && z.x < b.x + b.w), `mask ${m}: zone of ${a.id} inside ${b.id}`);
        }
        assert.strictEqual(zones("hdl", "filt").length, (m >> 2) & 1, `mask ${m}: filter handle iff the Filter section is open`);
        assert.strictEqual(zones("hdl").filter((z) => /^env:[ADR]$/.test(z.id)).length, ((m >> 1) & 1) * 3, `mask ${m}: 3 envelope handles (A, D+S, R) iff the Envelope section is open`);
    }
}
assert.strictEqual(sb.foldWidth(ALL), spec.max_width, "everything open = max_width");
assert.strictEqual(sb.foldWidth(sb.DEFAULT_FOLD), spec.width, "default fold = spec width");
sb.storeParam("mode", 0, true); sb.storeParam("sliced", 0, true);

// --- the engine strip is fixed: selector, character and knobs are there with every fold, none of them in the sidebar ---
for (const m of [0, ALL]) {
    sb.setFoldMask(m); sb.storeParam("mode", 3, true); sb.paint();
    const inStrip = sb.hitZones.filter((z) => z.y >= sb.STRIP.y && z.x < sb.STRIP.x + sb.STRIP.w);
    assert.strictEqual(inStrip.filter((z) => z.action === "engine").length, 5, "5 engine selectors in the strip");
    assert.ok(inStrip.some((z) => z.key === "sp_char"), "character switch in the strip");
    assert.ok(inStrip.filter((z) => z.kind === "knob").length >= 5, "engine knobs + Pitch / Speed / Pos in the strip");
    for (const z of inStrip) assert.ok(z.y + z.h <= 166.5 && z.y >= sb.STRIP.y - 0.5, `strip zone ${z.kind} ${z.key || z.action} inside the strip`);
    for (const z of sb.hitZones) if (z.kind === "wave") assert.ok(z.y + z.h <= sb.STRIP.y, "waveform ends above the strip");
}
sb.storeParam("mode", 0, true);

// --- the sidebar toggles fold sections; each toggle is a distinct zone with a name ---
sb.setFoldMask(sb.DEFAULT_FOLD);
sb.paint();
{
    const tg = zones("act").filter((z) => z.tip);
    assert.deepStrictEqual(plain(tg.map((z) => z.index)), [0, 1, 2, 3, 4], "5 sidebar toggles");
    assert.ok(tg.every((z) => z.x < sb.VIEW.x && z.w >= 18), "toggles are in the left column");
    const names = tg.map((z) => z.tip);
    assert.strictEqual(new Set(names).size, 5, "toggle names are distinct");
    // several open at once, width follows
    for (const i of [0, 3]) { sb.paint(); const z = zones("act").filter((q) => q.tip)[i]; emitted.length = 0; sb.onclick(z.x + 2, z.y + 2, 1, 0, 0); }
    assert.strictEqual(sb.foldMask, 2 | 1 | 8, "toggles combine");
    assert.strictEqual(lastWidth(), sb.foldWidth(11), "device width follows");
    sb.paint();
    const z2 = zones("act").filter((q) => q.tip)[1]; emitted.length = 0; sb.onclick(z2.x + 2, z2.y + 2, 1, 0, 0);
    assert.strictEqual(sb.foldMask, 1 | 8, "toggle closes a section");
    // HUD tip on hover
    sb.paint(); const z4 = zones("act").filter((q) => q.tip)[4];
    sb.onidle(z4.x + 3, z4.y + 3); assert.ok(sb.hoverTip && sb.hoverTip.tip === "Voice / Out", "hover shows the section name");
    sb.onidleout(); assert.strictEqual(sb.hoverTip, null, "tip clears on leave");
}

// --- persisted in the state blob; old blobs leave the folds alone ---
sb.setFoldMask(0b1011);
{
    const blob = sb.getvalueof();
    assert.strictEqual(blob[blob.length - 2], "R2"); assert.strictEqual(blob[blob.length - 1], 0b1011);
    sb.setFoldMask(0);
    emitted.length = 0;
    sb.setvalueof.apply(null, blob);
    assert.strictEqual(sb.foldMask, 0b1011, "mask restored from the blob");
    assert.strictEqual(lastWidth(), sb.foldWidth(0b1011), "width restored");
    const old = blob.slice(0, -2);
    sb.setFoldMask(0b10);
    sb.setvalueof.apply(null, old);
    assert.strictEqual(sb.foldMask, 0b10, "a blob without R2 keeps the folds");
}


// --- sample pane: the default face's controls and positions, no level meter, V2's Single / Sliced buttons kept top right ---
{
    sb.setFoldMask(0); sb.storeParam("sliced", 0, true); sb.storeParam("loop_mode", 1, true); sb.paint();
    const V = sb.VIEW, inV = (z) => z.x >= V.x && z.x + z.w <= V.x + V.w && z.y >= V.y && z.y + z.h <= V.y + V.h;
    const find = (f) => sb.hitZones.find(f);
    for (const r of ["samp_start", "samp_end", "loop_start", "loop_end", "loop_xfade"]) assert.ok(find((z) => z.region === r && inV(z)), `Single footer has ${r}`);
    assert.ok(find((z) => z.action === "menu" && z.key === "loop_mode"), "loop mode dropdown");
    assert.ok(find((z) => z.action === "reverse"), "reverse");
    assert.ok(find((z) => z.action === "toggle" && z.key === "root_dyn"), "ROOT toggle in the header");
    assert.ok(find((z) => z.key === "root_note") && find((z) => z.key === "fine_cents"), "root note and ct");
    // positions follow the default face (same offsets from the panel's left edge, panels are the same width)
    assert.strictEqual(find((z) => z.region === "samp_start").x, V.x + 64, "start value at the default face's offset");
    assert.strictEqual(find((z) => z.action === "menu" && z.key === "loop_mode").x, V.x + 240 + 30, "loop dropdown at the default face's offset");
    assert.strictEqual(find((z) => z.action === "toggle" && z.key === "root_dyn").x, V.x + 330 - 2, "ROOT at the default face's offset");
    const sl = sb.hitZones.filter((z) => z.action === "sliced_set");
    assert.ok(sl.length === 2 && sl.every((z) => z.x > V.x + V.w - 50 && z.y < V.y + 16), "Single / Sliced stay top right");
    const fy = V.y + V.h - 4;
    assert.ok(find((z) => z.region === "samp_start").y === fy - 11, "footer row at the bottom of the viewer");
    assert.ok(!/livePeak/.test(sb.paintViewer.toString()), "no level meter in the viewer");
    // Sliced footer
    sb.storeParam("sliced", 1, true);
    for (const at of [0, 1, 2, 3, 4]) {
        sb.storeParam("slice_at", at, true); sb.paint();
        assert.ok(find((z) => z.key === "slice_from"), "keys from");
        assert.ok(find((z) => z.action === "menu" && z.key === "slice_at"), "Slice at");
        assert.ok(find((z) => z.action === "menu" && z.key === "slice_play"), "Playback");
        const amount = [find((z) => z.key === "slice_div"), find((z) => z.action === "menu" && z.key === "slice_beat"), find((z) => z.key === "slice_sens")];
        assert.strictEqual(amount.filter(Boolean).length, at === 4 ? 0 : (at === 3 ? 1 : 1), `slice at ${at}: one amount control`);
    }
    assert.strictEqual(find((z) => z.key === "slice_from").x, V.x + 70, "keys-from value at the default face's offset");
    sb.storeParam("sliced", 0, true);
}


// --- waveform zoom / pan (the XO Sample Map gestures) ---
{
    sb.setFoldMask(0); sb.storeParam("sliced", 0, true); sb.storeParam("loop_mode", 1, true);
    sb.sample_loaded("/Users/test/Pad.wav"); sb.sample_loaded("bang"); sb.resetView(); sb.paint();
    const [wx, wy, ww, wh] = Array.from(sb.viewWave);
    assert.strictEqual(sb.viewZoom, 1);
    const cx = wx + ww * 0.7, cy = wy + wh / 2;
    const n0 = sb.vnorm(cx);
    sb.onwheel(cx, cy, 0, 1);                                  // documented form (x, y, inc_x, inc_y)
    assert.ok(sb.viewZoom > 1.5, "wheel up zooms in");
    near(sb.vnorm(cx), n0, 1e-9, "zoom keeps the sample under the cursor");
    sb.onwheel(cx, cy, 0, 1, 0, 0, 0, 0, 0);                   // 9 arguments: the flags at the end are not the deltas
    const z2 = sb.viewZoom; assert.ok(z2 > 3, "9-argument wheel zooms");
    for (let i = 0; i < 40; i++) sb.onwheel(cx, cy, 0, 3);
    assert.strictEqual(sb.viewZoom, 64, "zoom stops at 64x");
    near(sb.vnorm(cx), n0, 1e-6, "still anchored at 64x");
    assert.ok(sb.viewX0 >= 0 && sb.viewX0 <= 1 - 1 / 64 + 1e-9, "view stays inside the sample");
    sb.onwheel(cx, cy, 0, 1, { deltaY: -1 }); // an event object last
    for (let i = 0; i < 60; i++) sb.onwheel(cx, cy, 0, -3);
    assert.strictEqual(sb.viewZoom, 1, "zooming out reaches exactly 1x and recentres"); assert.strictEqual(sb.viewX0, 0);
    sb.onwheel(wx - 5, cy, 0, 1); sb.onwheel(cx, wy + wh + 30, 0, 1); assert.strictEqual(sb.viewZoom, 1, "wheel outside the waveform does nothing");
    // pan: Cmd-drag, Option-drag, middle button
    sb.onwheel(cx, cy, 0, 2); sb.onwheel(cx, cy, 0, 2); sb.paint();
    const x00 = sb.viewX0, zz = sb.viewZoom;
    sb.onclick(cx, cy, 1, 1, 0); sb.ondrag(cx + 40, cy, 1, 1, 0); sb.ondrag(cx + 40, cy, 0, 1, 0);
    near(sb.viewX0, Math.max(0, x00 - 40 / (ww * zz)), 1e-9, "Cmd-drag pans (content follows the cursor)");
    const x01 = sb.viewX0;
    sb.onclick(cx, cy, 1, 0, 0, 0, 1); sb.ondrag(cx - 25, cy, 1, 0, 0, 0, 1); sb.ondrag(cx - 25, cy, 0, 0, 0, 0, 1);
    near(sb.viewX0, Math.min(1 - 1 / zz, x01 + 25 / (ww * zz)), 1e-9, "Option-drag pans");
    const x02 = sb.viewX0;
    sb.onclick(cx, cy, 1, 0, 0, 0, 0, 0, { buttons: 4 }); sb.ondrag(cx + 10, cy, 1, 0, 0); sb.ondrag(cx + 10, cy, 0, 0, 0);
    near(sb.viewX0, Math.max(0, x02 - 10 / (ww * zz)), 1e-9, "middle-button drag pans");
    sb.onclick(cx, cy, 1, 1, 0); sb.ondrag(cx + 9000000, cy, 1, 1, 0); sb.ondrag(cx + 9000000, cy, 0, 1, 0);
    assert.strictEqual(sb.viewX0, 0, "pan clamps at the left edge");
    sb.onclick(cx, cy, 1, 1, 0); sb.ondrag(cx - 9000000, cy, 1, 1, 0); sb.ondrag(cx - 9000000, cy, 0, 1, 0);
    near(sb.viewX0, 1 - 1 / zz, 1e-9, "pan clamps at the right edge");
    assert.ok(!emitted.some((a) => a[1] === "param" && /samp_|loop_/.test(a[2])), "panning writes no region parameters");
    // markers stay draggable while zoomed: grab distance is in screen pixels, drag moves by pixels / zoom
    sb.resetView(); sb.storeParam("loop_mode", 0, true);
    sb.setvalueof(...[3, 0, 3000, 9000, 0, 1500, 8500, 500, 0, 0, 1, 0, ""]);   // start 0.30, end 0.90
    sb.paint();
    sb.onwheel(sb.vwx(0.30), cy, 0, 2); sb.onwheel(sb.vwx(0.30), cy, 0, 2); sb.paint();
    const zoomNow = sb.viewZoom; assert.ok(zoomNow > 4);
    const sx0 = sb.vwx(sb.curStart);
    assert.ok(sx0 > wx && sx0 < wx + ww, "start marker visible");
    emitted.length = 0;
    sb.onclick(sx0 + 2, cy, 1, 0, 0); sb.ondrag(sx0 + 22, cy, 1, 0, 0); sb.ondrag(sx0 + 22, cy, 0, 0, 0);
    near(sb.curStart, 0.30 + 22 / (ww * zoomNow), 1e-4, "start marker follows the mouse in screen pixels while zoomed");
    assert.ok(params().length === 0 || params().every((p) => FP[p.key]), "region edits stay in range");
    const farX = sb.vwx(sb.curEnd);
    sb.onclick(wx + 30, cy, 1, 0, 0); sb.ondrag(wx + 30, cy, 0, 0, 0);       // far from any marker: no grab
    assert.ok(Math.abs(sb.curStart - (0.30 + 22 / (ww * zoomNow))) < 2e-4, "a click far from a marker grabs nothing");
    // every zone stays inside the viewer, overlays inside the waveform
    sb.paint();
    for (const z of sb.hitZones) assert.ok(z.x >= -1 && z.x + z.w <= sb.foldWidth(0) + 1 && z.y + z.h <= 170, `zoomed: ${z.kind} inside`);
    for (const z of sb.hitZones.filter((q) => ["flag", "xfade", "loop_move"].includes(q.kind))) assert.ok(z.x >= wx - 0.5 && z.x + z.w <= wx + ww + 0.5, `${z.kind} zone inside the waveform`);
    // sliced flags and the loop only get zones while visible
    sb.storeParam("sliced", 1, true); sb.storeParam("slice_at", 4, true);
    sb.paint(); const nFl = sb.hitZones.filter((q) => q.kind === "flag").length;
    sb.resetView(); sb.paint(); assert.ok(sb.hitZones.filter((q) => q.kind === "flag").length >= nFl, "all flags back at 1x");
    sb.storeParam("sliced", 0, true);
    // reset: double-click on the zoomed waveform, and the zoom pill
    sb.onwheel(cx, cy, 0, 2); sb.paint(); assert.ok(sb.viewZoom > 1);
    const pill = sb.hitZones.find((q) => q.kind === "act" && !q.tip);
    assert.ok(pill, "zoom pill while zoomed"); sb.onclick(pill.x + 2, pill.y + 2, 1, 0, 0);
    assert.strictEqual(sb.viewZoom, 1, "pill click resets");
    sb.onwheel(cx, cy, 0, 2); sb.paint(); sb.ondblclick(cx, cy); assert.strictEqual(sb.viewZoom, 1, "double-click on the zoomed waveform resets");
    sb.paint(); assert.ok(!sb.hitZones.some((q) => q.kind === "act" && !q.tip), "no pill at 1x");
    // a new load drops the zoom
    sb.onwheel(cx, cy, 0, 2); sb.sample_loaded("/Users/test/N.wav"); assert.strictEqual(sb.viewZoom, 1);
    // detail: a zoomed view re-reads the waveform at the visible range's resolution, in chunks
    sb.sample_loaded("/Users/test/Pad.wav"); sb.sample_loaded("bang");
    sampleSpike.v = 0.9; sampleSpike.at = 70000; sampleSpike.ch = 1;
    const spikeX = 70000 / 96000;
    sb.onwheel(sb.vwx(spikeX), cy, 0, 3); sb.onwheel(sb.vwx(spikeX), cy, 0, 3); sb.paint();
    assert.ok(sb.detail && !sb.detail.done, "zoomed: a detail job is queued");
    const peeks = []; const Bold = sb.Buffer; sb.Buffer = function (n) { Bold.call(this, n); const pk = this.peek; this.peek = (c, s, l) => { peeks.push(l); return pk(c, s, l); }; };
    let steps = 0; while (!sb.detailStep(sb.detail) && steps++ < 50) {}
    sb.Buffer = Bold;
    assert.ok(peeks.length > 0 && peeks.every((l) => l <= sb.DETAIL_CHUNK), "read in bounded chunks");
    assert.ok(sb.detail.done && sb.detail.got.filter(Boolean).length === sb.detail.cols, "every visible column was read");
    const col = Math.round(sb.vwx(spikeX) - wx);
    const amps = Array.from(sb.detail.amp); const mx = Math.max(...amps), mxc = amps.indexOf(mx);
    assert.ok(mx >= 0.89 && Math.abs(mxc - col) <= 1, `the spike shows in the detail at its own column (${mxc} vs ${col})`);
    near(sb.colAmp(wx + mxc), 0.9, 0.02, "painting uses the detail, not the stretched overview");
    sampleSpike.v = 0.25; sampleSpike.at = 70000; sampleSpike.ch = 2;
    sb.resetView(); sb.paint();
    assert.strictEqual(sb.detail, null, "1x drops the detail");
}

// --- character switch directly above the knobs it controls ---
{
    sb.setFoldMask(0);
    for (const [mode, key, ch] of [[0, "rp_char", 1], [3, "sp_char", 0], [3, "sp_char", 1], [1, "cy_char", 0], [1, "cy_char", 2]]) {
        sb.storeParam("mode", mode, true); sb.storeParam(key, ch, true); sb.paint();
        const S = sb.STRIP;
        const seg = sb.hitZones.filter((z) => z.action === "menu_pick" && z.key === key);
        assert.ok(seg.length >= 2, `${key}: switch present`);
        const left = Math.min(...seg.map((z) => z.x)), bottom = Math.max(...seg.map((z) => z.y + z.h));
        const knobs = sb.hitZones.filter((z) => z.kind === "knob" && z.y >= S.y && z.x >= S.x + 250).sort((a, b) => a.x - b.x);
        assert.ok(knobs.length >= 2, `${key}: engine knobs`);
        assert.ok(bottom <= Math.min(...knobs.map((z) => z.y)) + 0.01, `${key}: switch sits above its knobs`);
        assert.ok(Math.abs(left - knobs[0].x) <= 6, `${key}: switch aligned with the first knob (${left} vs ${knobs[0].x})`);
        for (const z of seg) assert.ok(z.x + z.w <= knobs[knobs.length - 1].x + knobs[knobs.length - 1].w + 70, `${key}: switch spans its knobs`);
        assert.ok(seg.every((z) => z.x >= S.x + 250), `${key}: on the right`);
        const pills = sb.hitZones.filter((z) => z.action === "engine");
        assert.ok(pills.length === 5 && pills.every((z) => z.x < S.x + 250), "engine selector on the left");
        const pitch = sb.hitZones.find((z) => z.kind === "knob" && z.key === "pitch_st");
        assert.ok(pitch.x < S.x + 250 && pitch.y > pills[0].y, "Pitch under the engine selector");
    }
    sb.storeParam("mode", 0, true); sb.storeParam("rp_char", 0, true);
}

// --- sample gain: drag, reset, normalize (right-click and ctrl-click) ---
{
    sb.setFoldMask(0); sb.paint();
    assert.strictEqual(FP.samp_gain.lo, -48); assert.strictEqual(FP.samp_gain.hi, 24); assert.strictEqual(FP.samp_gain.init, 0);
    const gz = () => zones("value").find((z) => z.key === "samp_gain");
    assert.ok(gz().x > sb.VIEW.x && gz().y < sb.VIEW.y + 16, "gain pill in the viewer header");
    let z = gz(), cx = z.x + z.w / 2, cy = z.y + z.h / 2;
    emitted.length = 0;
    sb.onclick(cx, cy, 1, 0, 0); sb.ondrag(cx, cy - 20, 1, 0, 0); sb.ondrag(cx, cy - 20, 0, 0, 0);
    assert.ok(sb.paramValue("samp_gain") > 1, "dragging up raises the gain");
    params().forEach(inRange);
    sb.onclick(cx, cy, 1, 0, 0); sb.ondrag(cx, cy + 900, 1, 0, 0); sb.ondrag(cx, cy + 900, 0, 0, 0);
    assert.strictEqual(sb.paramValue("samp_gain"), -48, "dragging down stops at -48 dB");
    sb.onclick(cx, cy, 1, 0, 0); sb.ondrag(cx, cy - 900, 1, 0, 0); sb.ondrag(cx, cy - 900, 0, 0, 0);
    assert.strictEqual(sb.paramValue("samp_gain"), 24, "dragging up stops at +24 dB");
    sb.ondblclick(cx, cy);
    assert.strictEqual(sb.paramValue("samp_gain"), 0, "double-click resets to 0 dB");
    sb.setParamFromFace("samp_gain", -12.34); sb.paint();
    assert.strictEqual(sb.fmtParam("samp_gain", sb.paramValue("samp_gain")), "-12.3 dB", "value shown in dB");
    sb.setParamFromFace("samp_gain", 0);

    const finish = () => { let n = 0; while (sb.peakJob && !sb.peakStep() && n++ < 100) {} };
    const gainOut = () => params().filter((p) => p.key === "samp_gain").pop();
    // a plain left click only starts a drag: no normalize
    sb.sample_loaded("/Users/test/Pad.wav"); sb.sample_loaded("bang"); sb.paint();
    emitted.length = 0; sb.onclick(cx, cy, 1, 0, 0); sb.ondrag(cx, cy, 0, 0, 0);
    assert.strictEqual(sb.peakJob, null, "left click does not measure");
    // right-click (PointerEvent button / buttons) and ctrl-click normalize; peak 0.25 -> +12.04 dB
    for (const [label, args] of [["right-click buttons", [0, 0, 0, 0, 0, { buttons: 2 }]], ["right-click button", [0, 0, 0, 0, 0, { button: 2 }]], ["ctrl-click", [0, 0, 0, 0, 1]]]) {
        sb.sample_loaded("/Users/test/Pad.wav"); sb.sample_loaded("bang");       // a new load recomputes the peak
        sampleSpike.v = 0.25; sb.setParamFromFace("samp_gain", 0); sb.paint(); emitted.length = 0;
        sb.onclick(cx, cy, 1, ...args);
        assert.ok(sb.peakJob, `${label}: measures in chunks (a Task job)`);
        finish();
        near(sb.paramValue("samp_gain"), 12.0412, 0.001, `${label}: gain = -20 log10(peak)`);
        near(gainOut().v, 12.0412, 0.001, `${label}: emitted through the parameter`);
        assert.ok(sb.hudNote.text === "Normalized +12.0 dB", `${label}: HUD note "${sb.hudNote.text}"`);
        assert.strictEqual(sb.peakCache.peak, 0.25, "peak cached");
    }
    // cached: a second normalize needs no new job and uses the cached peak, then a new load drops the cache
    sb.setParamFromFace("samp_gain", 0); sb.onclick(cx, cy, 1, 0, 0, 0, 0, 1);
    assert.strictEqual(sb.peakJob, null, "cached peak: no new measurement"); near(sb.paramValue("samp_gain"), 12.0412, 0.001, "cached normalize");
    sampleSpike.v = 0.5; sb.sample_loaded("/Users/test/Other.wav"); sb.sample_loaded("bang");
    assert.strictEqual(sb.peakCache.peak, -1, "a new load invalidates the cached peak");
    sb.onclick(cx, cy, 1, 0, 0, 0, 0, 1); finish();
    near(sb.paramValue("samp_gain"), 6.0206, 0.001, "recomputed after the new load");
    // peaks beyond the range clamp
    for (const [v, want, note] of [[0.0005, 24, "Normalized +24.0 dB (limit)"], [400, -48, "Normalized -48.0 dB (limit)"], [4, -12.0412, "Normalized -12.0 dB"]]) {
        sampleSpike.v = v; sb.sample_loaded("/Users/test/Pad.wav"); sb.sample_loaded("bang");
        sb.onclick(cx, cy, 1, 0, 0, 0, 0, 1); finish();
        near(sb.paramValue("samp_gain"), want, 0.001, `peak ${v}`); assert.strictEqual(sb.hudNote.text, note);
        params().forEach(inRange);
    }
    sampleSpike.v = 0.25; sb.setParamFromFace("samp_gain", 0);
}

// --- envelope dots, in every stage, several voices ---
function setVoices(list) {
    for (let v = 0; v < 16; v++) { sb.voiceAmpStg[v] = 0; sb.voiceAmpLvl[v] = 0; sb.voiceModStg[v] = 0; sb.voiceModLvl[v] = 0; sb.voiceCutHz[v] = 0; sb.voiceBorn[v] = 0; sb.prevAmpStage[v] = 0; }
    list.forEach((o, v) => { sb.voiceAmpStg[v] = o.amp || 0; sb.voiceAmpLvl[v] = o.al || 0; sb.voiceModStg[v] = o.mod || 0; sb.voiceModLvl[v] = o.ml || 0; sb.voiceCutHz[v] = o.cut || 0; sb.voiceBorn[v] = o.born || 0; });
}
sb.setFoldMask(ALL);
sb.setParamFromFace("atk_ms", 100); sb.setParamFromFace("dec_ms", 400); sb.setParamFromFace("sus_lvl", 50); sb.setParamFromFace("rel_ms", 600);
sb.envPage = 0;
setVoices([]);
sb.paint();
assert.deepStrictEqual(plain(sb.envDots), [], "no dots without voices");
{
    // attack 40 %, decay 50 %, sustain, release 30 % from level 0.4, an idle one
    setVoices([
        { amp: 1.4, al: 0.4, born: 1 },
        { amp: 2.5, al: 0.75, born: 2 },
        { amp: 3.0, al: 0.5, born: 3 },
        { amp: 4.3, al: 0.28, born: 4 },
        { amp: 0, al: 0, born: 9 },
    ]);
    sb.paint();
    const g = sb.envGeom();
    const d = sb.envDots;
    assert.strictEqual(d.length, 4, "one dot per sounding voice");
    const byV = (v) => d.find((q) => q.v === v);
    // attack: on the rising line at progress = level
    near(byV(0).x, g.gx + (g.xA - g.gx) * 0.4, 0.01, "attack x"); near(byV(0).y, g.gb - 0.4 * (g.gb - g.gy), 0.01, "attack y");
    // decay: on the decay curve; f = 0.5 -> level = sus + (1-sus) * 0.5
    const tD = 1 - Math.pow(0.5, 1 / 2.2);
    near(byV(1).x, g.xA + (g.xD - g.xA) * tD, 0.01, "decay x"); near(byV(1).y, g.ys + (g.gy - g.ys) * 0.5, 0.01, "decay y (level 0.75)");
    assert.ok(byV(1).x > g.xA && byV(1).x < g.xD, "decay dot between A and D");
    // sustain: on the dashed hold segment at the sustain level
    assert.ok(byV(2).x >= g.xD && byV(2).x <= g.xS, "sustain dot on the hold segment"); near(byV(2).y, g.ys, 0.01, "sustain y");
    // release: after the hold, at the voice's own level
    assert.ok(byV(3).x > g.xS && byV(3).x < g.xR, "release dot between S and R"); near(byV(3).y, g.gb - 0.28 * (g.gb - g.gy), 0.01, "release y = actual level");
    assert.ok(byV(3).y > g.ys, "release dot below the sustain level");
    // newest brightest, ordered newest first, every dot inside the curve panel
    assert.deepStrictEqual(plain(d.map((q) => q.v)), [3, 2, 1, 0], "newest first");
    assert.strictEqual(d[0].alpha, 1.0); for (let i = 1; i < d.length; i++) assert.ok(d[i].alpha < d[i - 1].alpha || d[i].alpha === 0.28, "older dots dimmer");
    for (const q of d) assert.ok(q.x >= g.gx - 1 && q.x <= g.xR + 1 && q.y >= g.gy - 1 && q.y <= g.gb + 1, "dot inside the curve area");
    // the Mod tab follows the mod envelope telemetry instead
    setVoices([{ amp: 3, al: 0.5, mod: 2.2, ml: 0.9, born: 1 }, { amp: 3, al: 0.5, mod: 1.8, ml: 0.8, born: 2 }]);
    sb.envPage = 1; sb.paint();
    const gm = sb.envGeom();
    assert.strictEqual(gm.keys[0], "matk_ms");
    assert.strictEqual(sb.envDots.length, 2);
    const dm = sb.envDots.find((q) => q.v === 0);
    assert.strictEqual(dm.stage, 2, "mod page reads the mod stage");
    assert.ok(dm.x > gm.xA && dm.x < gm.xD);
    sb.envPage = 0;
    // a releasing voice that started below the sustain level keeps a faint ghost path (no throw), starting level reported
    setVoices([{ amp: 4.5, al: 0.2, born: 1 }]); sb.paint();
    assert.strictEqual(sb.envDots[0].stage, 4);
    // sustain-level extremes
    for (const sus of [0, 100]) { sb.setParamFromFace("sus_lvl", sus); setVoices([{ amp: 2.6, al: 0.5, born: 1 }, { amp: 4.4, al: 0.3, born: 2 }]); sb.paint(); for (const q of sb.envDots) assert.ok(isFinite(q.x) && isFinite(q.y)); }
    sb.setParamFromFace("sus_lvl", 50);
    // no horizontal level line / level bar any more
    assert.ok(!/live level bar|lvl > 0\.004/.test(box.textfile.text), "old level bar is gone");
}

// --- born ordering through the poll: a stage restart makes a voice the newest ---
{
    setVoices([]);
    sb.bornSeq = 0;
    scopeData.fill(0);
    scopeData[128 + 2] = 1.2; scopeData[144 + 2] = 0.2; sb.pollTelemetryScope();
    scopeData[128 + 5] = 1.1; scopeData[144 + 5] = 0.1; sb.pollTelemetryScope();
    assert.ok(sb.voiceBorn[5] > sb.voiceBorn[2], "later note = newer");
    assert.strictEqual(sb.voiceAmpStg[2].toFixed(2), "1.20", "the shared poll reads the per-voice slots");
    scopeData[128 + 2] = 3.0; sb.pollTelemetryScope(); scopeData[128 + 2] = 1.05; sb.pollTelemetryScope();
    assert.ok(sb.voiceBorn[2] > sb.voiceBorn[5], "a retriggered voice becomes the newest");
    scopeData.fill(0); sb.pollTelemetryScope();
}

// --- filter: per-voice cutoffs ---
{
    sb.setParamFromFace("filt_on", 1); sb.setParamFromFace("filt_cutoff", 1000); sb.setParamFromFace("filt_res", 40);
    setVoices([]); sb.paint();
    assert.deepStrictEqual(plain(sb.filtDots), [], "no filter dots without voices");
    setVoices([{ amp: 3, al: 0.5, cut: 1000, born: 1 }, { amp: 2.4, al: 0.5, cut: 2400, born: 2 }, { amp: 1.3, al: 0.3, cut: 450, born: 3 }, { amp: 0, al: 0, cut: 0, born: 4 }]);
    sb.paint();
    const g = sb.filterGeom();
    assert.strictEqual(sb.filtDots.length, 3, "one dot per sounding voice (idle voices report no cutoff)");
    assert.deepStrictEqual(plain(sb.filtDots.map((q) => q.v)), [2, 1, 0], "newest first");
    for (const q of sb.filtDots) { near(q.x, sb.fFx(g, q.hz), 0.01, "dot x at the voice's cutoff"); near(q.hz, sb.voiceCutHz[q.v], 1e-6, "cutoff from telemetry"); }
    assert.ok(sb.filtDots[0].x < sb.filtDots[2].x === (450 < 1000), "dots spread by their cutoffs");
    assert.strictEqual(sb.filtDots[0].alpha, 1.0);
    // a dot rides the voice's own peak: y is the response peak of the current type / resonance
    for (const q of sb.filtDots) near(q.y, sb.fFy(g, sb.filterDb(0, 1, sb.resToQ(40))), 0.01, "dot y on the peak");
    // filter off: nothing drawn for voices
    sb.setParamFromFace("filt_on", 0); sb.paint();
    assert.deepStrictEqual(plain(sb.filtDots), [], "filter off hides voice dots");
    sb.setParamFromFace("filt_on", 1);
    // cutoff beyond the display range stays inside the plot
    setVoices([{ amp: 3, al: 0.5, cut: 21000, born: 1 }]); sb.paint();
    assert.ok(sb.filtDots[0].x <= g.gx + g.gw + 1e-6);
}

// --- ADSR handles: drag writes the right parameter, stays in range ---
function dragHandle(id, dx, dy) {
    sb.paint();
    const z = zones("hdl", id)[0];
    assert.ok(z, `handle ${id} exists`);
    emitted.length = 0;
    sb.onclick(z.cx, z.cy, 1, 0, 0);
    sb.ondrag(z.cx + dx, z.cy + dy, 1, 0, 0);
    sb.ondrag(z.cx + dx, z.cy + dy, 0, 0, 0);
    sb.paint();
    return params();
}
setVoices([]);
sb.setFoldMask(sb.DEFAULT_FOLD);
sb.envPage = 0;
assert.strictEqual(zones("hdl", "env:S").length, 0, "no separate sustain handle on the hold line");
for (const [id, keys] of [["env:A", ["atk_ms"]], ["env:D", ["dec_ms", "sus_lvl"]], ["env:R", ["rel_ms"]]]) {
    const before = keys.map((k) => sb.paramValue(k));
    const right = dragHandle(id, 14, id === "env:D" ? -12 : 0);
    right.forEach(inRange);
    for (const k of keys) assert.ok(right.some((p) => p.key === k), `${id} writes ${k}`);
    assert.ok(sb.paramValue(keys[0]) > before[0], `${id}: dragging right lengthens`);
    if (id === "env:D") {
        assert.ok(sb.paramValue("sus_lvl") > before[1], "env:D: dragging up raises sustain");
        const tl = sb.paramValue("dec_ms");
        const s0 = sb.paramValue("sus_lvl");
        dragHandle(id, 0, -10);
        assert.ok(Math.abs(sb.paramValue("dec_ms") - tl) < 1e-6 * Math.max(1, tl), "env:D: a vertical drag keeps decay");
        assert.ok(sb.paramValue("sus_lvl") > s0, "env:D: a vertical drag raises sustain");
    }
    dragHandle(id, 900, -900).forEach(inRange);
    dragHandle(id, -900, 900).forEach(inRange);
}
{ const zp1 = sb.hitZones.find((z) => z.action === "env_page" && z.page === 1); sb.onclick(zp1.x + 2, zp1.y + 2, 1, 0, 0); }
sb.paint();
for (const [id, key] of [["env:A", "matk_ms"], ["env:A", "env2_peak"], ["env:D", "mdec_ms"], ["env:D", "msus_lvl"], ["env:R", "mrel_ms"], ["env:R", "env2_final"]]) {
    const ps = dragHandle(id, 10, id === "env:R" ? -12 : 6);
    ps.forEach(inRange);
    assert.ok(ps.some((p) => p.key === key), `mod ${id} writes ${key}`);
    assert.ok(!ps.some((p) => ["atk_ms", "dec_ms", "sus_lvl", "rel_ms", "amp_peak", "amp_init"].includes(p.key)), "mod handles leave the amp envelope alone");
}
// Extra envelopes (Env 2 / Env 3): dragging R handle vertically adjusts Final release value (0..100%)
sb.setParamFromFace("env2_final", 0); sb.paint();
dragHandle("env:R", 0, -30);
assert.ok(sb.paramValue("env2_final") > 40, "Env 2 R handle vertical drag raises Final release level");
sb.setParamFromFace("env2_final", 0); sb.setParamFromFace("env2_peak", 100);
{ const zp0 = sb.hitZones.find((z) => z.action === "env_page" && z.page === 0); sb.onclick(zp0.x + 2, zp0.y + 2, 1, 0, 0); }
// Main Amp envelope: allow adjusting Peak below Sustain value (via A handle vertical drag or Value tab)
sb.setParamFromFace("sus_lvl", 80); sb.setParamFromFace("amp_peak", 100); sb.paint();
dragHandle("env:A", 0, 35);
assert.ok(sb.paramValue("amp_peak") < sb.paramValue("sus_lvl"), `Amp Peak (${sb.paramValue("amp_peak").toFixed(1)}%) can be adjusted below Sustain (${sb.paramValue("sus_lvl")}%)`);
sb.setParamFromFace("amp_peak", 100); sb.setParamFromFace("sus_lvl", 85);
sb.setParamFromFace("atk_ms", 400); sb.paint();
{ const z = zones("hdl", "env:A")[0]; emitted.length = 0; sb.ondblclick(z.cx, z.cy); assert.strictEqual(sb.paramValue("atk_ms"), FP.atk_ms.init); }
sb.setParamFromFace("dec_ms", 900); sb.setParamFromFace("sus_lvl", 20); sb.paint();
{ const z = zones("hdl", "env:D")[0]; sb.ondblclick(z.cx, z.cy);
  assert.strictEqual(sb.paramValue("dec_ms"), FP.dec_ms.init); assert.strictEqual(sb.paramValue("sus_lvl"), FP.sus_lvl.init); }
// filter handle (needs its section)
sb.setFoldMask(sb.DEFAULT_FOLD | 4);
{
    sb.paint();
    const before = { c: sb.paramValue("filt_cutoff"), r: sb.paramValue("filt_res") };
    const ps = dragHandle("filt", -30, -10);
    ps.forEach(inRange);
    assert.ok(sb.paramValue("filt_cutoff") < before.c, "filter point left lowers the cutoff");
    assert.ok(sb.paramValue("filt_res") > before.r, "filter point up raises resonance");
    dragHandle("filt", 900, -900).forEach(inRange);
    dragHandle("filt", -900, 900).forEach(inRange);
    sb.paint(); const z = zones("hdl", "filt")[0]; sb.ondblclick(z.cx, z.cy);
    assert.strictEqual(sb.paramValue("filt_cutoff"), FP.filt_cutoff.init);
    // Filter 2 handle, dropdowns, slope toggle, circuit and routing
    sb.setParamFromFace("filt2_on", 1); sb.setParamFromFace("filt2_cutoff", 500); sb.setParamFromFace("filt2_res", 30);
    sb.paint();
    const ps2 = dragHandle("filt2", 25, -8);
    ps2.forEach(inRange);
    assert.ok(sb.paramValue("filt2_cutoff") > 500, "filt2 handle right raises Filter 2 cutoff");
    assert.ok(sb.paramValue("filt2_res") > 30, "filt2 handle up raises Filter 2 resonance");
    assert.strictEqual(sb.filtFocus, 2, "dragging filt2 focuses Filter 2");
    sb.paint(); const zf2 = zones("hdl", "filt2")[0]; sb.ondblclick(zf2.cx, zf2.cy);
    assert.strictEqual(sb.paramValue("filt2_cutoff"), FP.filt2_cutoff.init);
    for (const [mKey, pickVal] of [["filt_type", 3], ["filt_circuit", 2], ["filt2_type", 2], ["filt2_circuit", 4], ["filt_route", 1]]) {
        sb.paint();
        const btn = sb.hitZones.find((q) => q.action === "menu" && q.key === mKey);
        assert.ok(btn, `menu button for ${mKey}`);
        sb.onclick(btn.x + 2, btn.y + 2, 1, 0, 0);
        assert.ok(sb.openMenu && sb.openMenu.key === mKey, `${mKey} menu opens`);
        sb.paint();
        const item = sb.hitZones.find((q) => q.action === "menu_pick" && q.key === mKey && q.value === pickVal);
        assert.ok(item, `${mKey} menu item ${pickVal}`);
        sb.onclick(item.x + 2, item.y + 2, 1, 0, 0);
        assert.strictEqual(sb.openMenu, null, `${mKey} menu closes on pick`);
        assert.strictEqual(sb.paramValue(mKey), pickVal, `${mKey} updated to ${pickVal}`);
    }
    sb.setParamFromFace("filt_type", 0); sb.setParamFromFace("filt_circuit", 0); sb.setParamFromFace("filt2_on", 0); sb.setParamFromFace("filt_route", 0);
}


// --- slope handles (diamonds on the A / D / R segments), the Time | Slope value row, Live's dials ---
{
    sb.setFoldMask(sb.DEFAULT_FOLD); sb.envPage = 0; sb.envTab = 0;
    for (const [k, v] of [["atk_ms", 400], ["dec_ms", 500], ["sus_lvl", 40], ["rel_ms", 600], ["atk_slope", 0], ["dec_slope", 0], ["rel_slope", 0]]) sb.setParamFromFace(k, v);
    setVoices([]); sb.paint();
    for (const id of ["env:As", "env:Ds", "env:Rs"]) assert.strictEqual(zones("hdl", id).length, 1, `${id} slope diamond`);
    // bend(p, 0) = p, s > 0 bows up
    near(sb.bendP(0.3, 0), 0.3, 0, "bend at slope 0 is the identity"); assert.ok(sb.bendP(0.3, 0.5) > 0.3 && sb.bendP(0.3, -0.5) < 0.3);
    near(sb.bendP(0, 1), 0, 0, "endpoints fixed"); near(sb.bendP(1, -1), 1, 0, "endpoints fixed");
    // decay / release end-window (matches the gen): identity below the tail, unchanged above 2 %, continuous to 0
    near(sb.bendW(0.3, 0.7), sb.bendP(0.3, 0.7), 1e-12, "bendW equals the bend above the end-window");
    near(sb.bendW(0.005, 0), 0.005, 0, "bendW at slope 0 is the identity");
    assert.ok(sb.bendW(0.0001, 1) < 0.0002 && sb.bendW(0, 1) === 0 && sb.bendW(0.001, 1) < sb.bendP(0.001, 1) * 0.05, "bendW returns to p at the tail");
    // dragging a diamond up bends up, down bends down; the diamond follows the curve; double-click resets to 0
    for (const [id, key, mid] of [["env:As", "atk_slope", "envYAttack"], ["env:Ds", "dec_slope", "envYDecay"], ["env:Rs", "rel_slope", "envYRelease"]]) {
        for (const dy of [-10, 10]) {
            sb.setParamFromFace(key, 0); sb.paint();
            const ps = dragHandle(id, 0, dy); ps.forEach(inRange);
            const v = sb.paramValue(key);
            assert.ok(dy < 0 ? v > 5 : v < -5, `${id}: dragging ${dy < 0 ? "up bends up" : "down bends down"} (${v})`);
            assert.ok(ps.every((q) => q.key === key), `${id} writes only ${key}`);
            sb.paint();
            const g = sb.envGeom(), z = zones("hdl", id)[0];
            const yy = id === "env:As" ? sb.envYAttack(g, 0.5) : (id === "env:Ds" ? sb.envYDecay(g, 0.5) : sb.envYRelease(g, 0.5, g.sus));
            near(z.cy, yy, 0.01, `${id}: the diamond sits on the bent curve`);
        }
        dragHandle(id, 0, -900).forEach(inRange); dragHandle(id, 0, 900).forEach(inRange);
        sb.paint(); const z2 = zones("hdl", id)[0]; sb.ondblclick(z2.cx, z2.cy);
        assert.strictEqual(sb.paramValue(key), 0, `${id}: double-click resets the slope`);
    }
    // the drag inverts the curve: grab the diamond at the position slope s puts it, the slope is read back as s
    for (const s0 of [-0.7, 0.4, 0.9]) {
        for (const [id, key] of [["env:As", "atk_slope"], ["env:Ds", "dec_slope"], ["env:Rs", "rel_slope"]]) {
            sb.setParamFromFace("atk_slope", 0); sb.setParamFromFace("dec_slope", 0); sb.setParamFromFace("rel_slope", 0);
            sb.setParamFromFace(key, s0 * 100); sb.paint();
            const z = zones("hdl", id)[0];
            sb.setParamFromFace(key, 0); sb.paint();
            const z0 = zones("hdl", id)[0];
            emitted.length = 0;
            sb.onclick(z0.cx, z0.cy, 1, 0, 0); sb.ondrag(z0.cx, z.cy, 1, 0, 0); sb.ondrag(z0.cx, z.cy, 0, 0, 0);
            near(sb.paramValue(key), s0 * 100, 1.5, `${id}: slope read back from the drag`);
        }
    }
    for (const k of ["atk_slope", "dec_slope", "rel_slope"]) sb.setParamFromFace(k, 0);
    // dots ride the drawn bent curve at any slope
    for (const sl of [-80, 0, 70]) {
        sb.setParamFromFace("atk_slope", sl); sb.setParamFromFace("dec_slope", sl); sb.setParamFromFace("rel_slope", sl); sb.paint();
        const g = sb.envGeom();
        const sD = sl / 100;
        const bend = (p, s) => (s === 0 ? p : Math.pow(p, Math.pow(4, -s)));
        // attack frac 0.5, decay frac 0.5 (level = sus + (1-sus) * bend(q)), release with start level 0.4 and frac 0.5
        setVoices([{ amp: 1.5, al: bend(0.5, sD), born: 1 }, { amp: 2.5, al: 0.4 + 0.6 * bend(0.5, sD), born: 2 }, { amp: 4.5, al: 0.4 * bend(0.5, sD), born: 3 }]);
        sb.paint();
        const d = sb.envDots; assert.strictEqual(d.length, 3);
        const A = d.find((q) => q.v === 0), D = d.find((q) => q.v === 1), R = d.find((q) => q.v === 2);
        near(A.y, sb.envYAttack(g, 0.5), 1e-6, `slope ${sl}: attack dot on the curve`);
        near(D.y, g.gb - (0.4 + 0.6 * bend(0.5, sD)) * (g.gb - g.gy), 1e-6, `slope ${sl}: decay dot at its output level`);
        near(D.y, sb.envYDecay(g, sb.envT(0.5)), 1e-6, `slope ${sl}: decay dot on the curve`);
        near(R.y, g.gb - 0.4 * bend(0.5, sD) * (g.gb - g.gy), 1e-6, `slope ${sl}: release dot at its output level`);
        near(R.y, sb.envYRelease(g, sb.envT(0.5), 0.4), 1e-6, `slope ${sl}: release dot on the curve from its start level`);
    }
    for (const k of ["atk_slope", "dec_slope", "rel_slope"]) sb.setParamFromFace(k, 0);
    setVoices([]);
    // Time | Slope | Value row: times (S in dB on Amp), A / D / S / R slopes, and Initial / Peak / S / Final values
    sb.paint();
    const tabs = zones("act").filter((z) => !z.tip && z.y > 105 && z.y < 140 && z.x > sb.sectionX("env"));
    assert.strictEqual(tabs.length, 3, "Time | Slope | Value tab trio");
    const vals = () => zones("value").filter((z) => z.x > sb.sectionX("env") && z.y > 125 && z.y < 160);
    assert.deepStrictEqual(plain(vals().map((z) => z.key)), ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"], "Time tab: A D S R");
    assert.strictEqual(sb.fmtEnvVal("sus_lvl", 50), "-6.0 dB", "S in dB"); assert.strictEqual(sb.fmtEnvVal("sus_lvl", 100), "0.0 dB");
    assert.strictEqual(sb.fmtEnvVal("atk_slope", 25), "25 %");
    sb.onclick(tabs[1].x + 2, tabs[1].y + 2, 1, 0, 0); sb.paint();
    assert.strictEqual(sb.envTab, 1);
    assert.deepStrictEqual(plain(vals().map((z) => z.key)), ["atk_slope", "dec_slope", "sus_lvl", "rel_slope"], "Slope tab: A D S R");
    for (const z of vals().filter((q) => /slope$/.test(q.key))) {
        sb.setParamFromFace(z.key, 0);
        sb.onclick(z.x + 2, z.y + 2, 1, 0, 0); sb.ondrag(z.x + 2, z.y - 20, 1, 0, 0); sb.ondrag(z.x + 2, z.y - 20, 0, 0, 0);
        assert.ok(sb.paramValue(z.key) > 5, `${z.key}: the value is draggable`);
        sb.ondblclick(z.x + 2, z.y + 2); assert.strictEqual(sb.paramValue(z.key), 0, `${z.key}: double-click resets`);
    }
    sb.envPage = 1; sb.paint();
    assert.deepStrictEqual(plain(vals().map((z) => z.key)), ["matk_slope", "mdec_slope", "msus_lvl", "mrel_slope"], "MOD page slopes");
    sb.envPage = 0; sb.envTab = 0;
    // Live's dials: label above, value below, no filled disc (nothing drawn at the centre), thin needle
    sb.setFoldMask(sb.DEFAULT_FOLD | 4 | 8 | 1); sb.paint();
    for (const z of sb.hitZones.filter((q) => q.kind === "knob")) assert.ok(z.h >= 30 && z.w >= 24, `dial ${z.key}: zone covers label, arc and value`);
    assert.ok(!/circle\(cx, cy, r, RC\.knob/.test(sb.rKnob.toString()), "no filled disc");
    sb.setFoldMask(sb.DEFAULT_FOLD);
}


// --- all three slope diamonds stay visible and grabbable at the shortest times, without touching the A / D / R handles ---
{
    sb.setFoldMask(sb.DEFAULT_FOLD); sb.envTab = 0;
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const page of [0, 1]) for (const sus of [0, 35, 100]) for (const t of [[0.2, 1, 1], [0.2, 1, 1000], [4000, 4000, 4000], [5, 40, 900]]) {
        sb.envPage = page;
        const k = page === 1 ? ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms"] : ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"];
        sb.setParamFromFace(k[0], t[0]); sb.setParamFromFace(k[1], t[1]); sb.setParamFromFace(k[2], sus); sb.setParamFromFace(k[3], t[2]);
        sb.paint();
        const h = ["env:A", "env:D", "env:R"].map((id) => zones("hdl", id)[0]);
        const d = ["env:As", "env:Ds", "env:Rs"].map((id) => zones("hdl", id)[0]);
        const label = `page ${page} sus ${sus} times ${t}`;
        assert.ok(h.every(Boolean) && d.every(Boolean), `${label}: every handle and diamond has a zone`);
        for (const dz of d) for (const hz of h) assert.ok(!ov(dz, hz), `${label}: diamond ${dz.id} does not overlap handle ${hz.id}`);
        for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!ov(d[i], d[j]), `${label}: diamonds do not overlap each other`);
        const g = sb.envGeom();
        assert.ok(g.xA - g.gx >= 18 - 1e-9 && g.xD - g.xA >= 18 - 1e-9 && g.xR - g.xS >= 18 - 1e-9, `${label}: every segment is at least 18 px wide`);
        for (const z of [...h, ...d]) assert.ok(z.x >= g.gx - 6 && z.x + z.w <= g.gx + g.gw + 8, `${label}: ${z.id} inside the display`);
        // handles still map back to the same value at the minimum width (drag to the far left sets the minimum time)
        const hz = h[0]; emitted.length = 0; sb.onclick(hz.cx, hz.cy, 1, 0, 0); sb.ondrag(hz.cx - 500, hz.cy, 1, 0, 0); sb.ondrag(hz.cx - 500, hz.cy, 0, 0, 0);
        assert.ok(sb.paramValue(k[0]) <= FP[k[0]].lo + 1e-6 + 0.01 * FP[k[0]].hi, `${label}: dragging A left reaches the shortest time`);
    }
    sb.envPage = 0;
    for (const [k, v] of [["atk_ms", 18], ["dec_ms", 900], ["sus_lvl", 35], ["rel_ms", 1200]]) sb.setParamFromFace(k, v);
    // the drawn curve really uses the slope: +-40 % moves the mid-segment points visibly and the shape is the gen's bend
    sb.setParamFromFace("dec_slope", 0); sb.setParamFromFace("rel_slope", 0); sb.paint();
    const g0 = sb.envGeom();
    const yD0 = sb.envYDecay(g0, 0.5), yR0 = sb.envYRelease(g0, 0.5, g0.sus);
    sb.setParamFromFace("dec_slope", 40); sb.setParamFromFace("rel_slope", 40); sb.paint();
    const g1 = sb.envGeom();
    assert.ok(yD0 - sb.envYDecay(g1, 0.5) > 3, `decay +40 %: the mid point rises by ${(yD0 - sb.envYDecay(g1, 0.5)).toFixed(1)} px`);
    assert.ok(yR0 - sb.envYRelease(g1, 0.5, g1.sus) > 3, "release +40 %: the mid point rises");
    const t5 = Math.pow(0.5, 2.2);
    near(sb.envYDecay(g1, 0.5), g1.gb - (g1.sus + (1 - g1.sus) * Math.pow(t5, Math.pow(4, -0.4))) * (g1.gb - g1.gy), 1e-9, "decay curve = sus + (1 - sus) * bend((1 - t)^2.2, s)");
    sb.setParamFromFace("dec_slope", -40); sb.paint();
    assert.ok(sb.envYDecay(sb.envGeom(), 0.5) - yD0 > 1.5, "decay -40 %: the mid point drops");
    for (const k of ["dec_slope", "rel_slope"]) sb.setParamFromFace(k, 0);
}

// --- every parameter reachable from some zone ---
const reach = new Set();
const regionKeys = { samp_start: ["samp_start"], samp_end: ["samp_end"], loop_start: ["loop_start"], loop_end: ["loop_end"], loop_xfade: ["loop_xfade"] };
const actionKeys = { sliced_set: ["sliced"], engine: ["mode"], reverse: ["reverse"], freeze: ["freeze"], filt_on: ["filt_on"], voicing: ["mono_legato"] };
function collect() {
    for (const z of sb.hitZones) {
        if (z.key) reach.add(z.key);
        if (z.region) regionKeys[z.region].forEach((k) => reach.add(k));
        if (actionKeys[z.action]) actionKeys[z.action].forEach((k) => reach.add(k));
        if (z.kind === "wave") ["samp_start", "samp_end", "loop_start", "loop_end", "play_pos"].forEach((k) => reach.add(k));
        if (z.kind === "xfade") reach.add("loop_xfade");
        if (z.kind === "flag") reach.add("slice_at");
        if (z.kind === "act" && z.tip) reach.add("show_inspector");        // the sidebar mirrors "anything open" into it
    }
    if (zones("hdl", "filt").length) ["filt_cutoff", "filt_res"].forEach((k) => reach.add(k));
    for (const z of zones("hdl")) if (z.id.startsWith("env:")) {
        const m = sb.envPage === 2 ? ["env3_atk_ms", "env3_dec_ms", "env3_sus_lvl", "env3_rel_ms"] : (sb.envPage === 1 ? ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms"] : ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"]);
        m.forEach((k) => reach.add(k));
    }
}
sb.setFoldMask(ALL);
for (let mode = 0; mode < 5; mode++) for (const sliced of [0, 1]) for (let ch = 0; ch < 3; ch++) for (let page = 0; page < 5; page++) {
    sb.setParamFromFace("mode", mode); sb.setParamFromFace("sliced", sliced);
    for (const k of ["rp_char", "sp_char", "cy_char"]) sb.setParamFromFace(k, Math.min(ch, FP[k].hi));
    sb.setParamFromFace("slice_at", ch % 2 ? 1 : 0);
    sb.setParamFromFace("loop_mode", 1);
    sb.matTab = 0;
    sb.envPage = page;
    for (const tb of [0, 1, 2]) { sb.envTab = tb; sb.paint(); collect(); }
    sb.envTab = 0;
}
for (const mTab of [0, 1, 2]) { sb.matTab = mTab; sb.paint(); collect(); }
sb.matTab = 0; sb.envPage = 0;
for (const at of [2, 3, 4]) { sb.setParamFromFace("slice_at", at); sb.setParamFromFace("sliced", 1); sb.paint(); collect(); }
for (const ot of [1, 2, 0]) { sb.oscTab = ot; sb.paint(); collect(); }
const missing = Object.keys(FP).filter((k) => !reach.has(k));
assert.deepStrictEqual(plain(missing), [], `unreachable parameters: ${missing.join(", ")}`);

// --- every zone of every section is clickable / draggable without a bad value ---
for (const mode of [0, 1, 3, 4]) {
    sb.setParamFromFace("mode", mode); sb.setParamFromFace("sliced", 0); sb.setFoldMask(ALL); sb.paint();
    for (const z of sb.hitZones.slice()) {
        if (z.tip) continue;                       // sidebar toggles change the folds (tested above)
        const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
        emitted.length = 0;
        sb.paint();
        sb.onclick(cx, cy, 1, 0, 0); sb.ondrag(cx + 8, cy - 25, 1, 0, 0); sb.ondrag(cx + 8, cy - 25, 0, 0, 0); sb.ondblclick(cx, cy);
        params().forEach(inRange);
        if (sb.openMenu) sb.onclick(1, 1, 1, 0, 0);
    }
}
console.log("reactive2 design: folds, viewer, envelope dots, filter voices, handles and parameter reach ok");
