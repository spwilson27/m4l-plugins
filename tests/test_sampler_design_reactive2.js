#!/usr/bin/env node
/**
 * Better Sampler "reactive2" design: sidebar folds, tall viewer, traced envelope dots, per-voice filter display,
 * ADSR handle drags, the additive sub oscillator, and that every parameter is reachable.
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
{
    const route = patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-route-param").text.split(/\s+/).slice(1);
    const at = route.indexOf("osc1_pan");
    assert.strictEqual(route[at - 1], "osc2_tune", "pan parameters are appended after osc2_tune");
    assert.deepStrictEqual(route.slice(at, at + 3), ["osc1_pan", "osc2_pan", "sub_pan"], "osc 1, osc 2, then sub pan");
    for (const key of ["osc1_pan", "osc2_pan", "sub_pan"]) {
        assert.strictEqual(patcher.boxes.map((b) => b.box).find((b) => b.id === `obj-scale-${key}`).text, "* 0.01", `${key} scales into -1..1`);
        assert.strictEqual(FP[key].lo, -100);
        assert.strictEqual(FP[key].hi, 100);
        assert.strictEqual(FP[key].init, 0);
        assert.strictEqual(typeof sb["set_" + key], "function", `${key} setter`);
    }
    const node = patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-drag-node");
    assert.ok(node && node.maxclass === "node.codebox" && node.ignoreclick === 1, "reactive2 embeds the file-drag node");
    assert.ok(String(node.code).includes("bs_drag_helper_v1_bin") && String(node.code).includes("selected_raw"), "drag node embeds the sampler file-drag helper");
    assert.ok(String(node.code).includes("trackEventsMatchingMask") && String(node.code).includes("[self initiateOSFileDrag:event]"), "a file drag starts from the original mouseDown, like XO");
    assert.ok(String(node.code).includes("NSStatusWindowLevel") && !String(node.code).includes("NSPopUpMenuWindowLevel"), "the drag panel uses XO's status window level");
    assert.ok(String(node.code).includes("handoff"), "a drag the face already owns is handed to the helper");
    assert.ok(String(node.code).includes("resolveSampleDragPath") && String(node.code).includes("mouse.y - (h - oy)"), "the drag resolves Live's volume path and covers the whole name");
    {
        const dragSrc = fs.readFileSync(path.join(ROOT, "src", "sampler_drag_node.js"), "utf8");
        const picked = dragSrc.slice(dragSrc.indexOf("function takeDragPathText"), dragSrc.indexOf("const fs = require"));
        const dragPath = new Function(picked + "\nreturn { takeDragPathText, resolveSampleDragPath };")();
        const dir = fs.mkdtempSync("/tmp/bs-drag-");
        const shortWav = path.join(dir, "Renders", "Bass", "1-10-23 -2 2 80-Operator-002.wav");
        const longWav = path.join(dir, "Processed", "Reverse", "1-10-23 -2 2 80-Operator-002 R.wav");
        fs.mkdirSync(path.dirname(shortWav), { recursive: true });
        fs.mkdirSync(path.dirname(longWav), { recursive: true });
        fs.writeFileSync(shortWav, "");
        fs.writeFileSync(longWav, "");
        const exists = (p) => fs.existsSync(p);
        // Max's File write left the tail of a longer path in place. The recorded failure was
        // "...002.wav" followed by the leftover "2 R.wav", and Live's "Macintosh HD:" prefix.
        let disk = "";
        function File() { this.isopen = 1; }
        File.prototype.writestring = function (s) {
            s = String(s);
            disk = s + disk.slice(s.length);
        };
        File.prototype.close = function () {};
        sb.File = File;
        try {
            const longReported = "Macintosh HD:" + longWav;
            const shortReported = "Macintosh HD:" + shortWav;
            assert.ok(shortReported.length < longReported.length, "the replacement path is the shorter one");
            sb.publishDragPath(longReported);
            sb.publishDragPath(shortReported);
            assert.ok(disk.length > shortReported.length && disk.slice(shortReported.length).includes("R.wav"), "the path file still carries the previous name");
            assert.strictEqual(dragPath.resolveSampleDragPath(disk.trim(), exists), "", "the tail plus the volume prefix is not a file");
            assert.strictEqual(
                dragPath.resolveSampleDragPath(dragPath.takeDragPathText(disk), exists),
                shortWav,
                "the drag uses the file Live loaded, not the leftover name"
            );
            assert.strictEqual(dragPath.resolveSampleDragPath(shortWav, exists), shortWav, "a POSIX path is unchanged");
            assert.strictEqual(dragPath.resolveSampleDragPath("Macintosh HD:/no/such/file.wav", exists), "", "a missing file does not arm");
        } finally {
            delete sb.File;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    const vizRoute = patcher.boxes.map((b) => b.box).find((b) => b.id === "obj-route-viz").text.split(/\s+/).slice(1);
    assert.deepStrictEqual(vizRoute.slice(-2), ["arm_drag", "disarm_drag"], "drag messages are appended to the viz route");
    const linked = (a, ao, b, bo) => patcher.lines.some((l) => l.patchline.source[0] === a && l.patchline.source[1] === ao && l.patchline.destination[0] === b && l.patchline.destination[1] === bo);
    assert.ok(linked("obj-route-viz", 9, "obj-prep-arm-drag", 0) && linked("obj-prep-arm-drag", 0, "obj-drag-node", 0), "arm_drag reaches the node");
    assert.ok(linked("obj-route-viz", 10, "obj-msg-disarm-drag", 0) && linked("obj-msg-disarm-drag", 0, "obj-drag-node", 0), "disarm_drag reaches the node");
    assert.ok(linked("obj-drag-node", 0, "obj-viz", 0), "name_click returns to the face");
}
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

// --- the engine strip is fixed: selector, character and value bars are there with every fold, none of them in the sidebar ---
for (const m of [0, ALL]) {
    sb.setFoldMask(m); sb.storeParam("mode", 3, true); sb.paint();
    const inStrip = sb.hitZones.filter((z) => z.y >= sb.STRIP.y && z.x < sb.STRIP.x + sb.STRIP.w);
    assert.strictEqual(inStrip.filter((z) => z.action === "engine").length, 5, "5 engine selectors in the strip");
    assert.ok(inStrip.some((z) => z.key === "sp_char"), "character switch in the strip");
    assert.ok(inStrip.filter((z) => z.kind === "value" || z.kind === "knob").length >= 5, "engine value bars + Pitch / Speed / Pos / Gain in the strip");
    const modeBars = inStrip.filter((z) => z.kind === "value" && z.x < sb.STRIP.x + 286 && z.key !== "grain_motion" && z.key !== "play_pos");
    assert.ok(modeBars.length >= 2 && modeBars.every((z) => z.w === 66), "mode setting sliders below the modes are consistently 66 px wide (fits 4 params)");
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

// --- dragging sidebar items reorders both the toolbar icons and the open panels, and persists in the blob ---
{
    sb.setSectionOrder([0, 1, 2, 3, 4]);
    sb.setFoldMask(2 | 4 | 8); // Mod Sources (1), Filter (2), Mod Matrix (3) open
    sb.paint();
    assert.deepStrictEqual(plain(sb.sectionRects(sb.foldMask).map((r) => r.id)), ["env", "filter", "matrix"], "default panel order");
    // Drag Filter (slot 2) up to slot 0 (above Mod Sources)
    const zFilt = zones("act").filter((q) => q.tip).find((q) => q.secIdx === 2);
    const cx = zFilt.x + zFilt.w * 0.5, cy = zFilt.y + zFilt.h * 0.5;
    sb.onclick(cx, cy, 1, 0, 0);
    sb.ondrag(cx, cy - 50, 1, 0, 0);
    assert.strictEqual(sb.foldMask, 2 | 4 | 8, "dragging a sidebar item preserves its open/closed foldMask");
    assert.deepStrictEqual(plain(sb.sectionOrder), [2, 0, 1, 3, 4], "Filter moved to slot 0 in sectionOrder");
    assert.deepStrictEqual(plain(sb.sectionRects(sb.foldMask).map((r) => r.id)), ["filter", "env", "matrix"], "Filter panel now appears before Mod Sources");
    sb.ondrag(cx, cy - 50, 0, 0, 0);
    // Persisted in getvalueof / setvalueof
    const blobReord = sb.getvalueof();
    assert.strictEqual(blobReord[blobReord.length - 4], "R2O", "custom section order tag saved in blob");
    sb.setSectionOrder([0, 1, 2, 3, 4]);
    sb.setvalueof.apply(null, blobReord);
    assert.deepStrictEqual(plain(sb.sectionOrder), [2, 0, 1, 3, 4], "reordered sectionOrder restored from blob");
    sb.setSectionOrder([0, 1, 2, 3, 4]);
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
    assert.strictEqual(find((z) => z.region === "samp_start").x, V.x + 34, "start value sits where the PLAY label was");
    assert.ok(!/"PLAY"/.test(sb.paintViewer.toString()), "sample footer has no PLAY label");
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

// --- character switch directly below the mode pills and above its value bars (consistent 4-slot 66px width) ---
{
    sb.setFoldMask(0);
    for (const [mode, key, ch] of [[0, "rp_char", 1], [3, "sp_char", 0], [3, "sp_char", 1], [1, "cy_char", 0], [1, "cy_char", 2]]) {
        sb.storeParam("mode", mode, true); sb.storeParam(key, ch, true); sb.paint();
        const S = sb.STRIP;
        const pills = sb.hitZones.filter((z) => z.action === "engine");
        assert.ok(pills.length === 5 && pills.every((z) => z.x < S.x + 286), "engine selector on the left");
        const seg = sb.hitZones.filter((z) => z.action === "menu_pick" && z.key === key);
        assert.ok(seg.length >= 2, `${key}: switch present`);
        const left = Math.min(...seg.map((z) => z.x)), top = Math.min(...seg.map((z) => z.y)), bottom = Math.max(...seg.map((z) => z.y + z.h));
        assert.ok(top >= pills[0].y + pills[0].h, `${key}: switch sits below the mode pills`);
        assert.ok(seg.every((z) => z.x < S.x + 286), `${key}: switch sits in the left column under the mode pills`);
        const bars = sb.hitZones.filter((z) => (z.kind === "value" || (z.action === "menu" && z.key === "sp_quant")) && z.y >= S.y + 30 && z.x < S.x + 286 && z.key !== "grain_motion" && z.key !== "play_pos").sort((a, b) => a.x - b.x);
        assert.ok(bars.length >= 2, `${key}: engine setting bars`);
        assert.ok(bottom <= Math.min(...bars.map((z) => z.y)) + 0.01, `${key}: switch sits above its setting bars`);
        assert.ok(Math.abs(left - bars[0].x) <= 6, `${key}: switch aligned with the first setting bar (${left} vs ${bars[0].x})`);
        const play = sb.hitZones.find((z) => z.kind === "value" && z.key === "grain_motion");
        if (bars.length <= 2) assert.ok(bars.every((z) => z.w === 66), `${key}: two setting bars stay 66 px`);
        else assert.ok(bars.every((z) => z.w === bars[0].w && z.w < 66) && bars[bars.length - 1].x + bars[bars.length - 1].w <= play.x, `${key}: three setting bars share the space left of Speed`);
        const pitch = sb.hitZones.find((z) => z.kind === "value" && z.key === "pitch_st");
        const pos = sb.hitZones.find((z) => z.kind === "value" && z.key === "play_pos");
        const frz = sb.hitZones.find((z) => z.action === "freeze");
        assert.ok(pitch && pitch.x >= S.x + 286, "Pitch bar on the right");
        assert.ok(pos && frz && Math.abs(frz.x - (pos.x + pos.w)) <= 6 && Math.abs(frz.y - pos.y) <= 2, "Freeze button sits immediately beside the Pos control");
    }
    sb.storeParam("mode", 0, true); sb.storeParam("rp_char", 0, true);
}

// Speed, Pos and Freeze are a column in the sample section. Gain stays in the tuning column.
{
    const S = sb.STRIP;
    sb.oscTab = 0;
    sb.setParamFromFace("osc1_type", 0);
    for (const [mode, chKey, ch] of [[0, "rp_char", 0], [1, "cy_char", 2]]) {
        sb.setParamFromFace("mode", mode);
        sb.setParamFromFace(chKey, ch);
        sb.paint();
        const speed = sb.hitZones.find((z) => z.kind === "value" && z.key === "grain_motion");
        const pos = sb.hitZones.find((z) => z.kind === "value" && z.key === "play_pos");
        const frz = sb.hitZones.find((z) => z.action === "freeze");
        const gain = sb.hitZones.find((z) => z.kind === "value" && z.key === "samp_gain" && z.y >= S.y);
        assert.ok(speed && pos && frz, `mode ${mode}: Speed, Pos and Freeze are drawn`);
        assert.ok(speed.x < S.x + 286 && pos.x < S.x + 286 && frz.x < S.x + 286, "playhead stays in the sampler column");
        assert.ok(pos.y < speed.y && Math.abs(speed.x - pos.x) <= 1, "Speed sits under Pos");
        sb.setParamFromFace("grain_motion", 100);
        sb.paint();
        const bar = sb.hitZones.find((z) => z.kind === "value" && z.key === "grain_motion");
        const bx = bar.x + bar.w / 2, by = bar.y + bar.h / 2;
        sb.onclick(bx, by, 1, 0, 0);
        sb.ondrag(bx + 30, by, 1, 0, 0);
        assert.ok(sb.paramValue("grain_motion") > 100, "dragging a bar right raises it");
        sb.ondrag(bx - 30, by, 1, 0, 0);
        assert.ok(sb.paramValue("grain_motion") < 100, "dragging a bar left lowers it");
        sb.ondrag(bx, by + 30, 1, 0, 0);
        assert.ok(sb.paramValue("grain_motion") < 100, "dragging a bar down lowers it");
        sb.ondrag(bx, by - 30, 1, 0, 0);
        assert.ok(sb.paramValue("grain_motion") > 100, "dragging a bar up raises it");
        sb.ondrag(bx, by, 0, 0, 0);
        sb.setParamFromFace("grain_motion", 100);
        assert.ok(Math.abs(frz.x - (pos.x + pos.w)) <= 6 && Math.abs(frz.y - pos.y) <= 1, "Freeze sits beside Pos");
        assert.ok(gain && gain.w === 50 && gain.h === 16 && gain.x === S.x + 410, "Gain stays 50 px");
        const pan = sb.hitZones.find((z) => z.kind === "value" && z.key === "osc1_pan" && z.y >= S.y);
        assert.ok(pan && pan.w === gain.w && pan.h === gain.h && pan.y === gain.y && pan.hbar === 1, "Pan matches Gain and drags as a horizontal bar");
        const panGap = gain.x - (pan.x + pan.w);
        assert.strictEqual(panGap, 4, "Pan sits one gap to the left of Gain");
        const slot = { x: pan.x - panGap - pan.w, y: pan.y, w: pan.w, h: pan.h };
        assert.ok(slot.x >= S.x + 292, "the free slot stays in the tuning column");
        assert.ok(!sb.hitZones.some((z) => !(z.x + z.w <= slot.x || slot.x + slot.w <= z.x || z.y + z.h <= slot.y || slot.y + slot.h <= z.y)), "a slot the width of Pan stays empty further left");
        sb.setParamFromFace("osc1_pan", 0);
        sb.paint();
        const pz = sb.hitZones.find((z) => z.kind === "value" && z.key === "osc1_pan");
        const px = pz.x + pz.w / 2, py = pz.y + pz.h / 2;
        sb.onclick(px, py, 1, 0, 0);
        sb.ondrag(px + 30, py, 1, 0, 0);
        assert.ok(sb.paramValue("osc1_pan") > 0, "dragging Pan right raises it");
        sb.ondrag(px - 30, py, 1, 0, 0);
        assert.ok(sb.paramValue("osc1_pan") < 0, "dragging Pan left lowers it");
        sb.ondrag(px, py + 30, 1, 0, 0);
        assert.ok(sb.paramValue("osc1_pan") < 0, "dragging Pan down lowers it");
        sb.ondrag(px, py - 30, 1, 0, 0);
        assert.ok(sb.paramValue("osc1_pan") > 0, "dragging Pan up raises it");
        sb.ondrag(px, py, 0, 0, 0);
        sb.setParamFromFace("osc1_pan", 0);
        assert.strictEqual(sb.toNorm("osc1_pan", 0), 0.5, "Pan is bipolar around center");
    }
    sb.oscTab = 2;
    sb.paint();
    const subGain = sb.hitZones.find((z) => z.kind === "value" && z.key === "sub_gain");
    assert.ok(subGain && subGain.w === 50 && subGain.h === 16 && subGain.x === S.x + 410, "sub Level matches Gain");
    const subPan = sb.hitZones.find((z) => z.kind === "value" && z.key === "sub_pan");
    assert.ok(subPan && subPan.w === subGain.w && subPan.h === subGain.h && subPan.y === subGain.y && subGain.x - (subPan.x + subPan.w) === 4, "sub Pan sits one gap left of Level");
    sb.oscTab = 0;
    sb.setParamFromFace("mode", 0);
}

// Unison: compact voice count, and Detune / Width with their words on the bar.
{
    const S = sb.STRIP;
    const foldWas = sb.foldMask;
    sb.setFoldMask(0);
    sb.oscTab = 0;
    sb.setParamFromFace("osc1_type", 0);
    sb.setParamFromFace("unison_voices", 1);
    const drawn = [];
    sb.mgraphics.show_text = (s) => { drawn.push(String(s)); };
    sb.paint();
    const voices = sb.hitZones.find((z) => z.kind === "value" && z.key === "unison_voices" && z.y < S.y + 20);
    const det = sb.hitZones.find((z) => z.kind === "value" && z.key === "unison_detune" && z.y < S.y + 20);
    const wid = sb.hitZones.find((z) => z.kind === "value" && z.key === "unison_width" && z.y < S.y + 20);
    assert.ok(voices && voices.w <= 24 && !voices.hbar, "voice count stays a compact vertical pill");
    assert.ok(det && wid && det.hbar === 1 && wid.hbar === 1, "Detune and Width are horizontal bars");
    assert.ok(drawn.includes("Detune") && drawn.includes("Width"), "Detune and Width are drawn as words");
    assert.ok(det.x >= voices.x + voices.w && wid.x >= det.x + det.w, "voice count, Detune, then Width");
    const vx = voices.x + voices.w / 2, vy = voices.y + voices.h / 2;
    sb.onclick(vx, vy, 1, 0, 0);
    sb.ondrag(vx, vy - 40, 1, 0, 0);
    assert.ok(sb.paramValue("unison_voices") > 1, "dragging the voice pill up raises it");
    sb.ondrag(vx, vy, 0, 0, 0);
    sb.setParamFromFace("unison_voices", 1);
    sb.setFoldMask(foldWas);
}

// Sample name: middle ellipsis, file drag of the showing oscillator, a click opens the file dialog.
{
    sb.setFoldMask(0);
    sb.oscTab = 0;
    sb.setParamFromFace("osc1_type", 0);
    sb.hasLoadedSample = 1;
    sb.sampleFileName = "Granular Pad Texture Example.wav";
    sb.sampleFilePath = "/Users/test/Drums/Granular Pad Texture Example.wav";
    const drawn = [];
    const show = sb.mgraphics.show_text;
    sb.mgraphics.show_text = (s) => { drawn.push(String(s)); };
    sb.paint();
    sb.mgraphics.show_text = show;
    const clipped = drawn.filter((s) => s.includes("…") && s.endsWith(".wav"));
    assert.ok(clipped.length >= 1, "loaded sample name ellipsizes in the middle and keeps .wav");
    assert.ok(clipped.every((s) => !s.endsWith("…")), "the ellipsis is not at the end of the file name");
    assert.strictEqual(sb.fitFileName("Kick.wav", 200, 9), "Kick.wav", "a short file name is unchanged");
    const name = sb.hitZones.find((z) => z.action === "browse");
    assert.ok(name, "sample name stays clickable");
    const mark = emitted.length;
    sb.onidle(name.x + 4, name.y + 4);
    const arm = emitted.slice(mark).find((a) => a[1] === "arm_drag");
    assert.deepStrictEqual(
        arm && arm.slice(1),
        ["arm_drag", "hover", Math.round(name.w), Math.round(name.h), 4, 4],
        "hovering the name arms a drag of the whole name, without the path in the message"
    );
    sb.onidleout();
    assert.ok(!emitted.slice(mark).some((a) => a[1] === "disarm_drag"), "the overlay taking the pointer does not disarm the drag");
    sb.onidle(name.x + name.w + 40, name.y + 40);
    assert.ok(emitted.slice(mark).some((a) => a[1] === "disarm_drag"), "moving onto another control disarms the drag");
    sb.oscTab = 1;
    sb.osc2Loaded = 1;
    sb.osc2FileName = "Osc2 Hat.wav";
    sb.osc2FilePath = "/Users/test/Drums/Osc2 Hat.wav";
    sb.setParamFromFace("osc2_type", 0);
    sb.paint();
    const name2 = sb.hitZones.find((z) => z.action === "browse");
    const mark2 = emitted.length;
    sb.onidle(name2.x + 4, name2.y + 4);
    const arm2 = emitted.slice(mark2).find((a) => a[1] === "arm_drag");
    assert.ok(arm2 && arm2[2] === "hover", "osc 2's name arms the same drag");
    sb.onidleout();
    sb.oscTab = 0;
    sb.paint();
    const browsed = emitted.length;
    sb.onclick(name.x + 4, name.y + 4, 1, 0, 0);
    assert.ok(!emitted.slice(browsed).some((a) => a[1] === "browse"), "pressing the name does not open the file dialog");
    sb.ondrag(name.x + 24, name.y + 8, 1, 0, 0);
    const handed = emitted.slice(browsed).find((a) => a[1] === "arm_drag" && a[2] === "handoff");
    assert.ok(handed && handed.length === 7, "the first pixel of a drag hands the gesture to the helper");
    sb.ondrag(name.x + 24, name.y + 8, 0, 0, 0);
    assert.ok(!emitted.slice(browsed).some((a) => a[1] === "browse"), "dragging the name does not open the file dialog");
    sb.onclick(name.x + 4, name.y + 4, 1, 0, 0);
    sb.ondrag(name.x + 5, name.y + 5, 0, 0, 0);
    assert.ok(emitted.slice(browsed).some((a) => a[1] === "browse"), "a click on the name opens the file dialog");
    sb.nameClick();
    assert.ok(emitted.slice(browsed).filter((a) => a[1] === "browse").length >= 2, "the drag helper's click still opens the file dialog");
    sb.ondblclick(name.x + 4, name.y + 4);
    assert.ok(!emitted.slice(browsed).some((a) => a[1] === "show_view"), "a double-click does not try to reveal the file in the browser");
    sb.sampleFileName = "Pad.wav";
    sb.sampleFilePath = "/Users/test/Pad.wav";
    sb.osc2Loaded = 0;
    sb.oscTab = 0;
}

// A sample used as a wavetable is scaled so its loudest frame is full scale. One gain for the whole table.
{
    const quiet = [0.2, -0.5, 0.1, 0.25];
    const norm = sb.wtNormalizeFrames(quiet);
    near(norm.gain, 2, 1e-9, "gain is 1 / peak");
    near(norm.samples[1], -1, 1e-9, "the loudest sample reaches full scale");
    near(norm.samples[0], 0.4, 1e-9, "quieter samples keep the same ratio");
    const full = sb.wtNormalizeFrames([0.3, 1, -0.2]);
    near(full.gain, 1, 1e-9, "a table already at full scale is unchanged");
    const hot = sb.wtNormalizeFrames([2, -0.5]);
    near(hot.samples[0], 1, 1e-9, "a hot sample is brought down to full scale");
    assert.strictEqual(sb.wtNormFromPeak(0), 1, "silence is left alone");
    sb.oscTab = 0;
    sb.setParamFromFace("osc1_type", 1);
    sb.wtSelect(0, sb.WT_USER, 0);
    near(sb.wtNorm[0], 20, 1e-6, "the loaded sample peaking at 0.05 normalizes to full scale");
    near(sb.wtDisplaySample(0.2, 0), 1, 1e-4, "the wavetable view shows the normalized frame");
    const sent = emitted.filter((a) => a[1] === "wt_msg" && a[2] === "wt1_norm").pop();
    assert.ok(sent && Math.abs(sent[3] - 20) < 1e-6, "the normalized gain is sent to the oscillator");
    sb.wtSelect(0, 0, 0);
    sb.setParamFromFace("osc1_type", 0);
}

// --- Mod Matrix target label static fill and live modulation sum bar ---
{
    sb.setFoldMask(8); sb.matTab = 0;
    // Static fill: min (-48 dB) -> 0 (empty/black), max (+24 dB) -> 1 (full 59 px)
    sb.setParamFromFace("samp_gain", -48); sb.paint();
    assert.strictEqual(sb.toNorm("samp_gain", sb.paramValue("samp_gain")), 0, "samp_gain at -48 dB gives 0 static fill");
    sb.setParamFromFace("samp_gain", 24); sb.paint();
    assert.strictEqual(sb.toNorm("samp_gain", sb.paramValue("samp_gain")), 1, "samp_gain at +24 dB gives full static fill");
    sb.setParamFromFace("samp_gain", 0);
    near(sb.toNorm("samp_gain", sb.paramValue("samp_gain")), 48 / 72, 1e-6, "samp_gain at 0 dB gives 66.7% static fill");
    // When no voice is playing, activeVoiceLevel() === 0 and modSourceSignal() === 0 for every column
    for (let v = 0; v < 16; v++) sb.voiceAmpLvl[v] = 0;
    assert.strictEqual(sb.activeVoiceLevel(), 0, "no voice playing -> activeVoiceLevel is 0");
    for (let c = 0; c < 5; c++) {
        assert.strictEqual(sb.modSourceSignal(1, c), 0, `no voice playing -> source ${c} signal is 0`);
    }
    // When a voice is playing, modSourceSignal returns bounded live values in [-1..+1]
    sb.voiceAmpLvl[0] = 0.8; sb.liveModEnvVal = 0.5; sb.liveLfoVal = 0.6; sb.liveLfo2Val = 0.45; sb.lfoPhaseEst = 0.2;
    assert.strictEqual(sb.activeVoiceLevel(), 0.8, "voice playing -> activeVoiceLevel is 0.8");
    for (let c = 0; c < 5; c++) {
        const sig = sb.modSourceSignal(1, c);
        assert.ok(sig >= -1 && sig <= 1 && Math.abs(sig) > 0, `voice playing -> source ${c} signal ${sig} active`);
    }
    sb.voiceAmpLvl[0] = 0;
    sb.setFoldMask(sb.DEFAULT_FOLD);
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
    for (let v = 0; v < 16; v++) { sb.voiceAmpStg[v] = 0; sb.voiceAmpLvl[v] = 0; sb.voiceModStg[v] = 0; sb.voiceModLvl[v] = 0; sb.voiceCutHz[v] = 0; sb.voiceBorn[v] = 0; sb.prevAmpStage[v] = 0; if (sb.susPin) sb.susPin[v] = 0; }
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
    // Held at sustain 0: the decay fraction (1 - level) keeps walking the tail, so one voice used to
    // jump between points. Once the output is at the floor it stays on the sustain hold.
    sb.setParamFromFace("sus_lvl", 0); sb.setParamFromFace("amp_peak", 100);
    setVoices([{ amp: 2.35, al: 0.62, born: 1 }]); sb.paint();
    const g0 = sb.envGeom(), hold = sb.sustainDot(g0);
    assert.ok(sb.envDots[0].x < g0.xD - 1, "a voice still decaying is not pulled onto the hold");
    const tail = [[2.96, 0.03], [2.40, 0.11], [2.15, 0.06], [3.0, 0.0], [2.80, 0.16], [2.55, 0.04]];
    for (const [amp, al] of tail) {
        sb.voiceAmpStg[0] = amp; sb.voiceAmpLvl[0] = al; sb.paint();
        near(sb.envDots[0].x, hold.x, 0.01, `sustain 0 held x @ ${amp}`);
        near(sb.envDots[0].y, hold.y, 0.01, `sustain 0 held y @ ${amp}`);
        assert.ok(sb.envDots[0].x >= g0.xD && sb.envDots[0].x <= g0.xS, "held dot stays on the sustain segment");
    }
    sb.voiceAmpStg[0] = 2.5; sb.voiceAmpLvl[0] = 0.55; sb.paint();
    assert.ok(sb.envDots[0].x < g0.xD - 1, "leaving the floor puts the dot back on the decay");
    sb.voiceAmpStg[0] = 4.4; sb.voiceAmpLvl[0] = 0.02; sb.paint();
    assert.strictEqual(sb.envDots[0].stage, 4, "a release at the floor stays a release");
    assert.ok(sb.envDots[0].x > g0.xS, "a release is not pulled back onto the hold");
    sb.setParamFromFace("sus_lvl", 50); sb.setParamFromFace("amp_peak", 100);
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


// --- Attack = 0 ms lands on the left wall (gx), Release = 60 s lands on the right wall (gx + gw), and slope diamonds stay grabbable ---
{
    sb.setFoldMask(sb.DEFAULT_FOLD); sb.envTab = 0;
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const page of [0, 1]) {
        sb.envPage = page;
        const k = page === 1 ? ["matk_ms", "mdec_ms", "msus_lvl", "mrel_ms"] : ["atk_ms", "dec_ms", "sus_lvl", "rel_ms"];
        assert.strictEqual(FP[k[0]].lo, 0, `${k[0]} minimum is 0 ms`);
        assert.strictEqual(FP[k[3]].hi, 60000, `${k[3]} maximum is 60000 ms (60 s)`);
        sb.setParamFromFace(k[0], 0); sb.setParamFromFace(k[1], 20000); sb.setParamFromFace(k[2], 100); sb.setParamFromFace(k[3], 60000);
        sb.paint();
        const gWall = sb.envGeom();
        near(gWall.xA, gWall.gx, 1e-6, `${k[0]}=0 ms lands on the left wall (gx)`);
        near(gWall.xR, gWall.gx + gWall.gw, 1e-6, `${k[3]}=60 s lands on the right wall (gx + gw)`);
    }
    for (const page of [0, 1]) for (const sus of [0, 35, 100]) for (const t of [[0, 1, 1], [0.2, 1, 1000], [4000, 4000, 4000], [5, 40, 900]]) {
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
        assert.ok(g.xA >= g.gx - 1e-9 && g.xD - g.xA >= 18 - 1e-9 && g.xR - g.xS >= 18 - 1e-9, `${label}: D and R segments are at least 18 px wide and A >= gx`);
        for (const z of [...h, ...d]) assert.ok(z.x >= g.gx - 6 && z.x + z.w <= g.gx + g.gw + 8, `${label}: ${z.id} inside the display`);
        // handles still map back to the same value at the minimum width (drag to the far left sets 0 ms)
        const hz = h[0]; emitted.length = 0; sb.onclick(hz.cx, hz.cy, 1, 0, 0); sb.ondrag(hz.cx - 500, hz.cy, 1, 0, 0); sb.ondrag(hz.cx - 500, hz.cy, 0, 0, 0);
        assert.strictEqual(sb.paramValue(k[0]), 0, `${label}: dragging A left reaches 0 ms`);
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
const actionKeys = { sliced_set: ["sliced"], engine: ["mode", "osc2_mode", "osc1_type", "osc2_type"], engine_wt: ["osc1_type", "osc2_type"], reverse: ["reverse"], freeze: ["freeze"], filt_on: ["filt_on"], voicing: ["mono_legato"] };
function collect() {
    for (const z of sb.hitZones) {
        if (z.key) reach.add(z.key);
        if (z.region) regionKeys[z.region].forEach((k) => reach.add(k));
        if (actionKeys[z.action]) actionKeys[z.action].forEach((k) => reach.add(k));
        if (z.kind === "sub_harm") ["sub_h1_4", "sub_h5_8", "sub_h9_12", "sub_h13_16"].forEach((k) => reach.add(k));
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
    if (page === 4) { sb.slotTypes[4] = 0; sb.paint(); collect(); sb.slotTypes[4] = 2; }
    sb.envTab = 0;
}
for (const mTab of [0, 1, 2, 3, 4]) { sb.matTab = mTab; sb.paint(); collect(); }
sb.matTab = 0; sb.envPage = 0;
for (const at of [2, 3, 4]) { sb.setParamFromFace("slice_at", at); sb.setParamFromFace("sliced", 1); sb.paint(); collect(); }
for (const ot of [1, 2, 0]) {
    sb.oscTab = ot;
    for (const wt of [0, 1]) {
        sb.setParamFromFace("osc1_type", wt);
        sb.setParamFromFace("osc2_type", wt);
        sb.paint();
        collect();
    }
}
sb.setParamFromFace("osc1_type", 0); sb.setParamFromFace("osc2_type", 0); sb.oscTab = 0;
const missing = Object.keys(FP).filter((k) => !reach.has(k));
assert.deepStrictEqual(plain(missing), [], `unreachable parameters: ${missing.join(", ")}`);

// Wavetable viewer: no sample header, no side sliders, no Semi / Fine / Ratio. The gain pill stays.
{
    sb.oscTab = 1;
    sb.setParamFromFace("osc2_type", 1);
    sb.paint();
    const V = sb.VIEW;
    const inView = (z) => z.y >= V.y && z.y + z.h <= V.y + V.h;
    assert.ok(!sb.hitZones.some((z) => z.action === "browse"), "wavetable header has no sample folder");
    assert.ok(!sb.hitZones.some((z) => z.key === "root_dyn" || z.key === "root_note" || z.key === "fine_cents"), "wavetable header has no root");
    assert.ok(!sb.hitZones.some((z) => z.action === "sliced_set"), "wavetable header has no sample/slice switch");
    const gain = sb.hitZones.find((z) => z.key === "samp_gain");
    assert.ok(gain && gain.y < V.y + 16 && gain.x === V.x + 276, "wavetable header keeps the gain pill");
    assert.ok(!sb.hitZones.some((z) => inView(z) && z.key === "osc2_gain"), "wavetable viewer has no left gain slider");
    assert.ok(!sb.hitZones.some((z) => inView(z) && z.key === "osc2_pos" && z.kind === "value"), "wavetable viewer has no right position slider");
    for (const k of ["osc2_pitch", "osc2_detune", "osc2_ratio"]) {
        assert.ok(!sb.hitZones.some((z) => inView(z) && z.key === k), `wavetable footer has no ${k}`);
    }
    assert.ok(sb.hitZones.some((z) => inView(z) && z.key === "wt2_fx"), "wavetable footer keeps the effect menu");
    assert.ok(sb.hitZones.some((z) => z.key === "osc2_pitch" && z.y >= sb.STRIP.y), "Pitch stays in the tuning strip");
    const stripGain = sb.hitZones.find((z) => z.kind === "value" && z.key === "osc2_gain" && z.y >= sb.STRIP.y);
    assert.ok(stripGain && stripGain.w === 50 && stripGain.h === 16 && stripGain.x === sb.STRIP.x + 410, "wavetable Gain keeps its size and place");
    const stripPan = sb.hitZones.find((z) => z.kind === "value" && z.key === "osc2_pan" && z.y >= sb.STRIP.y);
    assert.ok(stripPan && stripPan.w === 50 && stripPan.h === 16 && stripPan.y === stripGain.y && stripGain.x - (stripPan.x + stripPan.w) === 4, "wavetable Pan sits one gap left of Gain");
    assert.ok(!sb.hitZones.some((z) => z.y >= sb.STRIP.y && z.key === "grain_motion"), "wavetable strip has no Speed");
    assert.ok(!sb.hitZones.some((z) => z.y >= sb.STRIP.y && z.kind === "value" && z.key === "osc2_pos"), "wavetable strip has no Pos");
    assert.ok(!sb.hitZones.some((z) => z.y >= sb.STRIP.y && z.action === "freeze"), "wavetable strip has no Freeze");
    sb.oscTab = 2;
    sb.paint();
    const subGain = sb.hitZones.find((z) => z.kind === "value" && z.key === "sub_gain");
    assert.ok(subGain && subGain.w === stripGain.w && subGain.h === stripGain.h && subGain.x === stripGain.x && subGain.y === stripGain.y, "sub Level matches the wavetable Gain");
    sb.oscTab = 1;
    sb.setParamFromFace("osc2_type", 1);
    sb.paint();
    const wl = sb.wtViewLayout();
    assert.strictEqual(wl.bw * 64 + wl.barGap * 63, wl.barsW, "64 harmonic bars fill the left pane");
    assert.ok(sb.hitZones.filter((z) => z.kind === "wt_pos").length >= 2, "position slider and the wave are draggable");
    assert.ok(sb.hitZones.some((z) => z.key === "wt2_cat" && z.wtList), "category menu under the wave");
    assert.ok(sb.hitZones.some((z) => z.key === "wt2_tbl" && z.wtList), "wavetable menu under the wave");
    assert.deepStrictEqual(plain(sb.WT_TABLES.Basics.slice(0, 5)), ["Basic Shapes", "Harmonic Series", "Sub 1", "Sub 2", "Sub 3"], "Basics matches Wavetable");
    assert.strictEqual(sb.WT_TABLES.Basics[sb.WT_TABLES.Basics.length - 1], "White Noise");
    assert.strictEqual(sb.WT_CATS[sb.WT_CATS.length - 1], "User");
    assert.ok(!sb.hitZones.some((z) => z.kind === "wave"), "wavetable viewer is not the sample waveform");
    const sineH = sb.wtHarmAmps(0, 0, 0, 0);
    assert.strictEqual(sineH.length, 64, "harmonic view is the first 64 partials");
    assert.ok(sineH[0] > 0.9 && sineH[1] < 0.05 && sineH[2] < 0.05, "sine position shows the fundamental");
    const squareH = sb.wtHarmAmps(1, 0, 0, 0);
    assert.ok(squareH[1] < 0.08 && squareH[2] > 0.25, "square position keeps the odd harmonics");
    const foldedH = sb.wtHarmAmps(0, 3, 0, 1);
    assert.ok(foldedH[2] - sineH[2] > 0.05, "fold changes the harmonic view");
    const slider = sb.hitZones.find((z) => z.kind === "wt_pos" && z.w < 30);
    sb.onclick(slider.x + 1, slider.top + slider.h * 0.25, 1, 0, 0, 0, 0, 0);
    assert.ok(Math.abs(sb.paramValue("osc2_pos") - 75) < 1.5, "dragging the slider traverses the wavetable");
    const wave = sb.hitZones.find((z) => z.kind === "wt_pos" && z.w >= 30);
    const stack = sb.wtStackGeom(sb.viewWave[1] + 5, sb.viewWave[3] - 10);
    const yAt = (t) => stack.yBot - t * stack.stack;
    near(wave.top, yAt(1), 1e-6, "the wave maps position 100% to the top frame");
    near(wave.mapH, Math.max(stack.stack, 1), 1e-6, "the wave maps position 0% to the bottom frame");
    sb.setParamFromFace("osc2_pos", 0);
    sb.onclick(wave.x + wave.w * 0.5, yAt(0), 1, 0, 0, 0, 0, 0);
    near(sb.paramValue("osc2_pos"), 0, 0.05, "clicking the bottom orange trace keeps 0%");
    sb.onclick(wave.x + wave.w * 0.5, yAt(1), 1, 0, 0, 0, 0, 0);
    near(sb.paramValue("osc2_pos"), 100, 0.05, "clicking the top orange trace sets 100%");
    sb.onclick(wave.x + wave.w * 0.5, yAt(0.375), 1, 0, 0, 0, 0, 0);
    near(sb.paramValue("osc2_pos"), 37.5, 0.05, "clicking a mid trace stores that position");
    sb.setParamFromFace("osc2_pos", 0);
    const catBtn = sb.hitZones.find((z) => z.key === "wt2_cat");
    sb.doAction(catBtn);
    sb.paint();
    const userPick = sb.hitZones.find((z) => z.action === "wt_pick" && z.which === "cat" && z.value === sb.WT_USER);
    assert.ok(userPick, "User is in the category menu");
    sb.doAction(userPick);
    assert.strictEqual(sb.wtSel[1].cat, sb.WT_USER, "picking User selects the shared sample");
    const keptPath = sb.sampleFilePath, keptName = sb.sampleFileName, keptLoaded = sb.hasLoadedSample;
    sb.wtSelect(1, 0, 0);
    sb.oscTab = 1;
    sb.setParamFromFace("osc2_type", 1);
    sb.dropfile("/tmp/shared-user-wave.wav");
    assert.strictEqual(sb.wtSel[1].cat, sb.WT_USER, "a drop on osc 2 wavetable imports it as that oscillator's user table");
    assert.strictEqual(sb.osc2FilePath, "/tmp/shared-user-wave.wav", "osc 2 keeps its own sample");
    assert.strictEqual(sb.sampleFilePath, keptPath, "osc 1's sample is left alone");
    sb.sample2_loaded("/tmp/shared-user-wave.wav");
    sb.setParamFromFace("osc2_type", 0);
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.key === "osc2_root"), "osc 2 header tunes its own root");
    assert.ok(sb.hitZones.some((z) => z.key === "osc2_tune"), "osc 2 header tunes its own sample fine");
    assert.ok(!sb.hitZones.some((z) => z.key === "fine_cents"), "osc 2 sample fine is not osc 1's");
    sb.osc2FilePath = "";
    sb.osc2FileName = "";
    sb.osc2Loaded = 0;
    sb.sampleFilePath = keptPath;
    sb.sampleFileName = keptName;
    sb.hasLoadedSample = keptLoaded;
    sb.wtSelect(1, 0, 0);
    const wtTab = sb.hitZones.find((z) => z.action === "osc_tab" && z.tab === 0);
    sb.setParamFromFace("osc2_type", 0);
    sb.oscTab = 0;
    sb.paint();
    const sampTab = sb.hitZones.find((z) => z.action === "osc_tab" && z.tab === 0);
    assert.strictEqual(wtTab.x, sampTab.x, "oscillator tabs stay put when leaving wavetable");
    assert.strictEqual(sampTab.x, sb.VIEW.x + 164, "oscillator tabs sit toward the centre of the viewer");
    const headerGain = sb.hitZones.find((z) => z.key === "samp_gain" && z.y < sb.VIEW.y + 16);
    assert.ok(headerGain && sampTab.x + 104 < headerGain.x, "oscillator tabs stay clear of the gain pill");
    assert.ok(!sb.paintViewer.toString().includes("liveActiveVoices"), "no voice counter in the viewer header");
}

// Ranges for the additive sub. The build supplies these on FACE_PARAMS; fill any gap so a drag
// during the zone sweep stays inside the real parameter (the sweep paints the Sub tab).
const SUB_SPECS = {
    sub_semi: { lo: -24, hi: 24, init: 0, exp: 1, unit: 7 },
    sub_fine: { lo: -100, hi: 100, init: 0, exp: 1, unit: 0 },
    sub_partials: { lo: 1, hi: 16, init: 8, exp: 1, unit: 0 },
    sub_phase: { lo: 0, hi: 360, init: 0, exp: 1, unit: 1 },
    sub_level: { lo: 0, hi: 100, init: 100, exp: 1, unit: 5 },
    sub_harm_level: { lo: 0, hi: 100, init: 75, exp: 1, unit: 5 },
    sub_detune: { lo: 0, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_mod: { lo: 0, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_width: { lo: 0, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_odd: { lo: -100, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_even: { lo: -100, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_tilt: { lo: -100, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_lp: { lo: 0, hi: 100, init: 100, exp: 1, unit: 5 },
    sub_knock: { lo: 0, hi: 96, init: 0, exp: 1, unit: 7 },
    sub_decay: { lo: 1, hi: 250, init: 120, exp: 1, unit: 2 },
    sub_knock_slope: { lo: -100, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_disp_freq: { lo: 20, hi: 2000, init: 160, exp: 1, unit: 3 },
    sub_disp_amt: { lo: 0, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_drive: { lo: 0, hi: 100, init: 0, exp: 1, unit: 5 },
    sub_h1_4: { lo: 0, hi: 65535, init: 51000, exp: 1, unit: 0 },
    sub_h5_8: { lo: 0, hi: 65535, init: 13107, exp: 1, unit: 0 },
    sub_h9_12: { lo: 0, hi: 65535, init: 0, exp: 1, unit: 0 },
    sub_h13_16: { lo: 0, hi: 65535, init: 0, exp: 1, unit: 0 },
    sub_ratio: { lo: 0.125, hi: 16, init: 1, exp: 1, unit: 1 },
    sub_wave: { lo: 0, hi: 6, init: 6, exp: 1, unit: 0, enums: ["Custom", "Sine", "Saw", "Square", "Triangle", "Odd", "Warm"] },
    sub_lock: { lo: 0, hi: 1, init: 0, exp: 1, unit: 0, enums: ["Off", "On"] },
    sub_lock_note: { lo: 0, hi: 11, init: 0, exp: 1, unit: 0, enums: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] },
    sub_mono: { lo: 0, hi: 1, init: 0, exp: 1, unit: 0, enums: ["Off", "On"] },
    sub_direct: { lo: 0, hi: 1, init: 0, exp: 1, unit: 0, enums: ["Off", "On"] },
    sub_drv_type: { lo: 0, hi: 6, init: 0, exp: 1, unit: 0, enums: ["Soft", "Hard", "Tube", "Fold", "Sine", "Pinch", "Noise"] }
};
for (const [k, spec] of Object.entries(SUB_SPECS)) if (!FP[k]) FP[k] = spec;

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

// --- additive sub oscillator (Operator harmonic bars + Current series spectra strip & drive dropdown) ---
for (const k of ["sub_semi", "sub_fine", "sub_odd", "sub_even", "sub_tilt"]) assert.ok(sb.BIPOLAR_KEYS[k], `${k} is bipolar`);
assert.strictEqual(typeof sb.getSubHarmonic, "function");
assert.strictEqual(typeof sb.applySubWavePreset, "function");
assert.strictEqual(typeof sb.effSubHarmonic, "function");

sb.setFoldMask(0);
sb.oscTab = 2;
sb.setParamFromFace("sub_on", 1);
sb.paint();
{
    const L = sb.subHarmLayout();
    near(L.ww, 458, 0.1, "sub plot width");
    near(L.wh, 73, 0.1, "sub plot height");
    assert.strictEqual(L.editorW, 300, "harmonic editor is 300 px");
    assert.strictEqual(L.scopeW, 150, "waveform scope is 150 px");
    assert.ok(!sb.hitZones.some((z) => z.action === "browse"), "sub header has no sample folder");
    assert.ok(!sb.hitZones.some((z) => z.key === "root_dyn" || z.key === "root_note" || z.key === "fine_cents"), "sub header has no root");
    assert.ok(!sb.hitZones.some((z) => z.action === "sliced_set"), "sub header has no sample/slice switch");
    const gain = sb.hitZones.find((z) => z.key === "samp_gain");
    assert.ok(gain && gain.y < sb.VIEW.y + 16 && gain.x === sb.VIEW.x + 276, "sub header keeps the gain pill");
    const subTab = sb.hitZones.find((z) => z.action === "osc_tab" && z.tab === 0);
    sb.oscTab = 0;
    sb.paint();
    const sampleTab = sb.hitZones.find((z) => z.action === "osc_tab" && z.tab === 0);
    assert.strictEqual(subTab.x, sampleTab.x, "oscillator tabs stay put on the sub viewer");
    sb.oscTab = 2;
    sb.paint();
    const harm = sb.hitZones.find((z) => z.kind === "sub_harm");
    const par = sb.hitZones.find((z) => z.key === "sub_partials");
    assert.ok(harm && par, "harmonic field and Partials control");
    assert.ok(harm.y + harm.h <= par.y + 0.5, "harmonic field sits above the footer");
    const slotW = 66;
    const specOrder = ["sub_odd", "sub_even", "sub_tilt", "sub_lp"];
    let prevSpecX = -1;
    for (const k of specOrder) {
        const z = sb.hitZones.find((q) => q.kind === "value" && q.key === k);
        assert.ok(z && z.w === slotW, `${k} is a 66 px Design 5A bar`);
        assert.ok(z.x > prevSpecX, `${k} ordered left-to-right in Odd, Even, Tilt, Low Pass`);
        prevSpecX = z.x;
    }
    const det = sb.hitZones.find((q) => q.key === "sub_detune");
    const lpBar = sb.hitZones.find((q) => q.key === "sub_lp");
    assert.ok(det.x >= lpBar.x + lpBar.w, "upper-harmonic column sits to the right of Low Pass");
    const reached = new Set();
    for (const z of sb.hitZones) {
        if (z.key) reached.add(z.key);
        if (z.kind === "sub_harm") ["sub_h1_4", "sub_h5_8", "sub_h9_12", "sub_h13_16"].forEach((k) => reached.add(k));
    }
    const need = ["sub_on", "sub_tone", "sub_gain", ...Object.keys(SUB_SPECS)];
    const absent = need.filter((k) => !reached.has(k));
    assert.deepStrictEqual(absent, [], `sub tab leaves unreachable: ${absent.join(", ")}`);
    const swept = Object.keys(SUB_SPECS).filter((k) => !reach.has(k));
    assert.deepStrictEqual(swept, [], `parameter sweep missed ${swept.join(", ")}`);
    const dw = sb.foldWidth(0);
    for (const z of sb.hitZones) {
        assert.ok(z.x >= -1 && z.y >= -1 && z.x + z.w <= dw + 1 && z.y + z.h <= 170, `sub zone ${z.kind} ${z.key || ""} inside the device`);
    }
}

// Drawing across the harmonic bars writes the packed nibbles and switches the preset to Custom.
sb.applySubWavePreset(1);
assert.strictEqual(Math.round(sb.paramValue("sub_wave")), 1, "Sine preset");
assert.strictEqual(Math.round(sb.paramValue("sub_h1_4")), 15, "sine fundamental nibble");
assert.strictEqual(Math.round(sb.paramValue("sub_h5_8")), 0);
assert.strictEqual(Math.round(sb.paramValue("sub_h9_12")), 0);
assert.strictEqual(Math.round(sb.paramValue("sub_h13_16")), 0);
assert.strictEqual(sb.getSubHarmonic(0), 1);
assert.strictEqual(sb.getSubHarmonic(1), 0);
sb.setSubHarmonic(3, 0.5);
near(sb.getSubHarmonic(3), 8 / 15, 1e-9, "nibble quantizes 0.5 to 8/15");
sb.applySubWavePreset(0);
assert.strictEqual(Math.round(sb.paramValue("sub_wave")), 0, "Custom does not wipe drawn partials");
assert.strictEqual(sb.getSubHarmonic(0), 1);
for (const waveIdx of [2, 3, 4, 5, 6]) {
    sb.applySubWavePreset(waveIdx);
    assert.strictEqual(Math.round(sb.paramValue("sub_wave")), waveIdx);
    const amps = sb.subPresetAmps(waveIdx);
    for (let i = 0; i < 16; i++) near(sb.getSubHarmonic(i), Math.round(amps[i] * 15) / 15, 1e-9, `preset ${waveIdx} partial ${i}`);
    for (const k of ["sub_h1_4", "sub_h5_8", "sub_h9_12", "sub_h13_16"]) {
        const v = sb.paramValue(k);
        assert.ok(v >= 0 && v <= 65535 && v === Math.round(v), `${k} packed in range`);
    }
}
sb.applySubWavePreset(3);
assert.strictEqual(sb.getSubHarmonic(1), 0, "square has no 2nd harmonic");
sb.applySubWavePreset(5);
assert.ok(sb.getSubHarmonic(2) > sb.subPresetAmps(3)[2], "Odd keeps more of the 3rd than Square");

sb.applySubWavePreset(1);
sb.paint();
{
    const L = sb.subHarmLayout();
    const barX = (i) => L.barsX + i * (L.bw + L.barGap) + L.bw * 0.5;
    emitted.length = 0;
    sb.onclick(barX(0), L.top + 0.5, 1, 0, 0);
    assert.strictEqual(Math.round(sb.paramValue("sub_wave")), 0, "drawing switches to Custom");
    assert.ok(sb.getSubHarmonic(0) > 0.9, "click at the top of bar 1 sets the fundamental");
    sb.ondrag(barX(5), L.bot - 0.5, 1, 0, 0);
    sb.ondrag(barX(5), L.bot - 0.5, 0, 0, 0);
    assert.ok(sb.getSubHarmonic(5) < 0.08, "drag to the bottom of bar 6 clears it");
    assert.ok(sb.getSubHarmonic(0) > sb.getSubHarmonic(2) && sb.getSubHarmonic(2) > sb.getSubHarmonic(4), "bars between the gesture are interpolated");
    assert.notStrictEqual(Math.round(sb.paramValue("sub_h5_8")), 0, "the drag wrote partials 5..8");
    sb.onclick(barX(2), L.bot - 0.5, 1, 0, 0);
    assert.ok(sb.getSubHarmonic(2) < 0.08, "a later click can lower a single bar");
    sb.ondrag(barX(2), L.top + 0.5, 1, 0, 0);
    sb.ondrag(barX(2), L.top + 0.5, 0, 0, 0);
    assert.ok(sb.getSubHarmonic(2) > 0.9, "dragging the same bar upward raises it");
    assert.strictEqual(Math.round(sb.paramValue("sub_wave")), 0, "editing one bar stays on Custom");
    params().forEach(inRange);
}

// Wave / lock / note menus, tuning, mono, direct, spectra mode and drive type.
function clickZone(pred) {
    sb.paint();
    const z = sb.hitZones.find(pred);
    assert.ok(z, "expected zone");
    sb.onclick(z.x + Math.min(3, z.w / 2), z.y + z.h / 2, 1, 0, 0);
    return z;
}
clickZone((z) => z.key === "sub_wave" && z.action === "menu");
assert.strictEqual(sb.openMenu && sb.openMenu.key, "sub_wave");
sb.paint();
clickZone((z) => z.key === "sub_wave" && z.action === "menu_pick" && z.value === 2);
assert.strictEqual(Math.round(sb.paramValue("sub_wave")), 2, "Saw from the wave menu");
assert.ok(sb.getSubHarmonic(1) > 0.4, "Saw preset filled the 2nd harmonic");
assert.strictEqual(sb.openMenu, null);

sb.setParamFromFace("sub_lock", 0);
clickZone((z) => z.key === "sub_lock" && z.action === "toggle");
assert.strictEqual(Math.round(sb.paramValue("sub_lock")), 1);
clickZone((z) => z.key === "sub_lock_note" && z.action === "menu");
sb.paint();
clickZone((z) => z.key === "sub_lock_note" && z.action === "menu_pick" && z.value === 9);
assert.strictEqual(Math.round(sb.paramValue("sub_lock_note")), 9, "lock note A");
assert.ok(!sb.hitZones.some((z) => z.key === "sub_tuning"), "Key, Fixed, Ratio buttons removed");
sb.setParamFromFace("sub_mono", 0);
clickZone((z) => z.key === "sub_mono" && z.action === "toggle");
assert.strictEqual(Math.round(sb.paramValue("sub_mono")), 1);
sb.setParamFromFace("sub_direct", 0);
clickZone((z) => z.key === "sub_direct" && z.action === "toggle");
assert.strictEqual(Math.round(sb.paramValue("sub_direct")), 1);
// Distortion mode is a dropdown menu with Soft, Hard, Tube, Fold, Sine, Pinch, Noise
clickZone((z) => z.key === "sub_drv_type" && z.action === "menu");
assert.strictEqual(sb.openMenu && sb.openMenu.key, "sub_drv_type");
sb.paint();
clickZone((z) => z.key === "sub_drv_type" && z.action === "menu_pick" && z.value === 5);
assert.strictEqual(Math.round(sb.paramValue("sub_drv_type")), 5, "Pinch drive selected from dropdown");
assert.strictEqual(sb.openMenu, null);
assert.strictEqual(FP.sub_knock.hi, 96, "Knock goes up to +96 st at max");
assert.strictEqual(FP.sub_decay.lo, 1, "Knock Decay starts at 1 ms");
assert.strictEqual(FP.sub_decay.hi, 250, "Knock Decay goes up to 250 ms at max");
assert.ok(!sb.hitZones.some((z) => z.key === "sub_oct"), "0, -1, -2 octave buttons removed");
{
    const zTone = sb.hitZones.find((z) => z.key === "sub_tone");
    const zDec = sb.hitZones.find((z) => z.key === "sub_decay");
    const zSlp = sb.hitZones.find((z) => z.key === "sub_knock_slope");
    const zKnk = sb.hitZones.find((z) => z.key === "sub_knock");
    assert.ok(zTone && zDec && zSlp && zKnk, "2-row Knock widget has time, slope, and vertical amount bar zones to the right of Tone");
    assert.ok(zDec.x > zTone.x + zTone.w && zSlp.x > zTone.x + zTone.w && zKnk.x > zTone.x + zTone.w, "Knock widget sits to the right of Tone");
    assert.ok(zKnk.h >= 30, "Knock widget spans two rows");
}

function dragUp(key, from) {
    sb.setParamFromFace(key, from);
    sb.paint();
    const z = sb.hitZones.find((q) => q.kind === "value" && q.key === key);
    assert.ok(z, `value zone ${key}`);
    const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
    emitted.length = 0;
    sb.onclick(cx, cy, 1, 0, 0);
    sb.ondrag(cx, cy - 90, 1, 0, 0);
    sb.ondrag(cx, cy - 90, 0, 0, 0);
    params().forEach(inRange);
    assert.ok(sb.paramValue(key) > from, `${key} rises when dragged up (${sb.paramValue(key)} from ${from})`);
    sb.ondblclick(cx, cy);
    assert.strictEqual(sb.paramValue(key), FP[key].init, `${key} double-click resets`);
}
for (const [k, from] of [["sub_detune", 0], ["sub_mod", 0], ["sub_width", 0], ["sub_odd", 0], ["sub_even", 0], ["sub_tilt", 0], ["sub_lp", 20], ["sub_disp_freq", 40], ["sub_disp_amt", 0], ["sub_knock", 0], ["sub_decay", 5], ["sub_knock_slope", 0], ["sub_drive", 0], ["sub_semi", 0], ["sub_fine", 0], ["sub_ratio", 0.5], ["sub_tone", 0], ["sub_level", 10], ["sub_harm_level", 10], ["sub_partials", 1], ["sub_phase", 0]]) {
    dragUp(k, from);
}
sb.setParamFromFace("sub_gain", -20);
dragUp("sub_gain", -20);

// Verify Ratio slider and Fine Range control on Osc 1, Osc 2, and Voice/Out
assert.strictEqual(FP.fine_range.lo, 1.0);
assert.strictEqual(FP.fine_range.hi, 96.0);
assert.strictEqual(FP.fine_range.init, 1.0);
sb.setParamFromFace("fine_range", 1.0);
assert.strictEqual(sb.fmtParam("fine_cents", 50), "+0.50", "Fine at +50% with default 1.0 range displays +0.50");
sb.setParamFromFace("fine_range", 96.0);
assert.strictEqual(sb.fmtParam("fine_cents", 100), "+96.0", "Fine at +100% with 96.0 range displays +96.0");
assert.strictEqual(sb.fmtParam("fine_cents", -100), "-96.0", "Fine at -100% with 96.0 range displays -96.0");
sb.setParamFromFace("fine_range", 1.0);
for (const [ot, rKey, fKey] of [[0, "osc1_ratio", "osc1_detune"], [1, "osc2_ratio", "osc2_detune"], [2, "sub_ratio", "sub_fine"]]) {
    sb.oscTab = ot;
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.kind === "value" && z.key === rKey), `oscTab ${ot} has Ratio slider (${rKey})`);
    assert.ok(sb.hitZones.some((z) => z.kind === "value" && z.key === fKey && z.y >= sb.STRIP.y), `oscTab ${ot} has Fine slider (${fKey})`);
}
sb.oscTab = 0;
sb.setParamFromFace("osc1_type", 0);
sb.setParamFromFace("fine_cents", 25);
sb.setParamFromFace("osc1_detune", 40);
sb.paint();
assert.ok(sb.hitZones.some((z) => z.key === "fine_cents" && z.y < sb.VIEW.y + 20), "sample pane keeps its own fine tune");
assert.ok(sb.hitZones.some((z) => z.key === "osc1_detune" && z.y >= sb.STRIP.y), "tuning strip Fine is the oscillator detune");
assert.strictEqual(sb.paramValue("fine_cents"), 25, "sample tune stays put when the strip detune is set");
assert.strictEqual(sb.paramValue("osc1_detune"), 40, "strip detune stays put when the sample tune is set");
sb.setParamFromFace("fine_cents", 0);
sb.setParamFromFace("osc1_detune", 0);
for (const [ot, rKey] of [[0, "osc1_ratio"], [1, "osc2_ratio"], [2, "sub_ratio"]]) {
    sb.oscTab = ot;
    sb.setParamFromFace(rKey, 1);
    sb.paint();
    const rz = sb.hitZones.find((z) => z.kind === "value" && z.key === rKey);
    const rx = rz.x + rz.w / 2, ry = rz.y + rz.h / 2;
    sb.onclick(rx, ry, 1, 0, 0);
    sb.ondrag(rx + 3, ry, 1, 0, 0);
    assert.strictEqual(sb.paramValue(rKey), 1, `${rKey} stays on 1x for a short drag`);
    sb.ondrag(rx + 11, ry, 1, 0, 0);
    assert.strictEqual(sb.paramValue(rKey), 2, `${rKey} steps to the next whole number`);
    sb.ondrag(rx, ry, 0, 0, 0);
    sb.setParamFromFace(rKey, 1);
    sb.onclick(rx, ry, 1, 0, 1);
    sb.ondrag(rx + 11, ry, 1, 0, 1);
    const fine = sb.paramValue(rKey);
    assert.ok(fine > 1 && fine < 2, `${rKey} shift-drag lands between whole numbers (${fine})`);
    sb.ondrag(rx, ry, 0, 0, 0);
    sb.setParamFromFace(rKey, 1);
}
sb.oscTab = 2;
sb.paint();

// Effective level: partial count, fundamental vs upper level, and the series Odd / Even / Tilt / Low Pass chain.
sb.applySubWavePreset(2);
sb.setParamFromFace("sub_partials", 4);
sb.setParamFromFace("sub_level", 50);
sb.setParamFromFace("sub_harm_level", 100);
sb.setParamFromFace("sub_odd", 0);
sb.setParamFromFace("sub_even", 0);
sb.setParamFromFace("sub_tilt", 0);
sb.setParamFromFace("sub_lp", 100);
near(sb.effSubHarmonic(0), sb.getSubHarmonic(0) * 0.5, 1e-9, "bar 1 follows Sub level");
near(sb.effSubHarmonic(1), sb.getSubHarmonic(1), 1e-9, "upper bars follow Harm level");
assert.strictEqual(sb.effSubHarmonic(4), 0, "partials beyond sub_partials are silent");
for (let i = 0; i < 16; i++) assert.strictEqual(sb.subSpectraGain(i), 1, "neutral Odd/Even/Tilt/LP is unity");
sb.setParamFromFace("sub_even", -100);
assert.ok(sb.effSubHarmonic(1) < 1e-6, "Even -100% mutes the 2nd harmonic");
assert.ok(sb.effSubHarmonic(2) > 0.2, "the 3rd harmonic (odd) stays");
sb.setParamFromFace("sub_even", 0);
sb.setParamFromFace("sub_odd", -100);
assert.ok(sb.effSubHarmonic(2) < 1e-6, "Odd -100% mutes the 3rd harmonic (upper odd)");
assert.ok(sb.effSubHarmonic(0) > 0.2, "Fundamental (idx 0) is unaffected by Odd cut");
sb.setParamFromFace("sub_odd", 0);
sb.setParamFromFace("sub_tilt", -100);
assert.ok(sb.subSpectraGain(0) > sb.subSpectraGain(15), "negative tilt favors the fundamental");
sb.setParamFromFace("sub_tilt", 0);
// Low Pass only affects upper harmonics (idx >= 1), never the sub fundamental (idx === 0)
sb.setParamFromFace("sub_lp", 0);
assert.strictEqual(sb.subSpectraGain(0), 1, "Low Pass at 0% does not attenuate the sub fundamental (idx 0)");
assert.strictEqual(sb.subSpectraGain(1), 0, "Low Pass at 0% mutes upper harmonics (idx >= 1)");
// Midway is a 2-pole rolloff: -3 dB on the cutoff partial, then about 12 dB per octave, with a tail past that.
sb.setParamFromFace("sub_lp", (4 - 1.5) / 15.5 * 100);
near(sb.subSpectraGain(0), 1, 1e-9, "Low Pass still leaves the fundamental alone");
near(sb.subSpectraGain(3), 1 / Math.sqrt(2), 0.02, "cutoff partial (4th harmonic) is about -3 dB");
near(sb.subSpectraGain(7), 1 / Math.sqrt(17), 0.02, "one octave above the cutoff");
near(sb.subSpectraGain(15), 1 / Math.sqrt(1 + Math.pow(4, 4)), 0.02, "two octaves above the cutoff");
const lpDb = 20 * Math.log10(sb.subSpectraGain(15) / sb.subSpectraGain(7));
assert.ok(lpDb < -10 && lpDb > -14, `second octave falls about 12 dB, got ${lpDb.toFixed(2)}`);
sb.setParamFromFace("sub_lp", 100);

// The scope hears Drive (including Pinch, Sine, Noise), Detune and Width.
sb.applySubWavePreset(1);
sb.setParamFromFace("sub_partials", 1);
sb.setParamFromFace("sub_level", 100);
sb.setParamFromFace("sub_harm_level", 0);
sb.setParamFromFace("sub_phase", 0);
sb.setParamFromFace("sub_detune", 0);
sb.setParamFromFace("sub_mod", 0);
sb.setParamFromFace("sub_width", 0);
sb.setParamFromFace("sub_drive", 0);
const dry = sb.subWaveSample(0.03, 0);
near(sb.subWaveSample(0.03, 1), dry, 1e-9, "no width and one partial is mono");
sb.setParamFromFace("sub_drive", 100);
sb.setParamFromFace("sub_drv_type", 1);
assert.ok(Math.abs(sb.subWaveSample(0.03, 0)) > Math.abs(dry) + 0.05, "hard drive raises a quiet sample");
// Pinch mode on a sine wave: creates sharp ears near the zero-crossing (phase 0.025) with a valley (phase 0.07) and rounded mid-crest (phase 0.25)
sb.setParamFromFace("sub_drv_type", 5);
sb.setParamFromFace("sub_drive", 100);
assert.ok(sb.subWaveSample(0.025, 0) > sb.subWaveSample(0.07, 0), "Pinch mode creates sharp ears near zero-crossing with a valley after it");
assert.ok(sb.subWaveSample(0.25, 0) > sb.subWaveSample(0.07, 0), "Pinch mode rises from the valley into a rounded mid-crest");

// Tone is a per-mode waveshaper. 0% matches the plain curve; Harm level does not move with it.
sb.setParamFromFace("sub_tone", 100);
sb.setParamFromFace("sub_harm_level", 40);
sb.setParamFromFace("sub_level", 40);
const harmAtTone = sb.effSubHarmonic(3);
sb.setParamFromFace("sub_tone", 0);
near(sb.effSubHarmonic(3), harmAtTone, 1e-12, "Tone does not scale upper harmonics");
function legacyDrive(x, amt, kind, phase01) {
    if (!(amt > 0.0005)) return Math.max(-1, Math.min(1, x));
    if (kind === 1) {
        const yH = x * (1 + amt * 8);
        return x + (Math.max(-1, Math.min(1, yH)) - x) * amt;
    }
    if (kind === 2) {
        const yT = x * (1 + amt * 5);
        return x + (Math.tanh(yT + 0.35 * yT * yT) - x) * amt;
    }
    if (kind === 3) {
        const yF = x * (1 + amt * 4);
        return x + (Math.sin(Math.max(-8, Math.min(8, yF))) - x) * amt;
    }
    if (kind === 4) {
        const yS = x * (1 + amt * 3);
        return x + (Math.sin(Math.max(-4, Math.min(4, yS)) * 1.57079632679) - x) * amt;
    }
    if (kind === 5) {
        const ax = Math.abs(x);
        const sgn = x >= 0 ? 1 : -1;
        const pn = sgn * (11 * ax * Math.exp(-8.5 * ax) + 0.78 * Math.pow(Math.max(0, ax - 0.14) / 0.86, 1.45));
        return Math.max(-1, Math.min(1, x + (pn - x) * amt));
    }
    if (kind === 6) {
        const nh = Math.sin((phase01 || 0) * 129.898 + 78.233) * 43758.5453;
        const nv = (nh - Math.floor(nh)) * 2 - 1;
        const yN = Math.tanh(x * (1 + amt * 3.5) + nv * amt * (0.15 + 0.85 * Math.abs(x)));
        return x + (yN - x) * amt;
    }
    return x + (Math.tanh(x * (1 + amt * 6)) - x) * amt;
}
const toneXs = [-0.8, -0.35, -0.12, 0.12, 0.35, 0.8];
for (let kind = 0; kind <= 6; kind++) {
    for (const x of toneXs) {
        near(sb.subShapeDrive(x, 0.55, kind, 0.2, 0), legacyDrive(x, 0.55, kind, 0.2), 1e-9, `tone 0 kind ${kind} at ${x} matches the plain shaper`);
    }
}
// Soft: less early squash, then closer to the rail.
assert.ok(sb.subShapeDrive(0.15, 0.5, 0, 0, 1) > sb.subShapeDrive(0.15, 0.5, 0, 0, 0) + 0.02, "Soft tone stays linear longer through the middle");
assert.ok(sb.subShapeDrive(0.5, 0.5, 0, 0, 1) > sb.subShapeDrive(0.5, 0.5, 0, 0, 0), "Soft tone bends harder near the rail");
// Hard: shoulder rounds toward the rail; a full clip and a quiet sample stay put.
assert.ok(sb.subShapeDrive(0.1, 1, 1, 0, 1) > sb.subShapeDrive(0.1, 1, 1, 0, 0) + 0.02, "Hard tone rounds the clip shoulder");
near(sb.subShapeDrive(0.5, 1, 1, 0, 1), sb.subShapeDrive(0.5, 1, 1, 0, 0), 1e-9, "Hard tone keeps the clip rail");
near(sb.subShapeDrive(0.02, 1, 1, 0, 1), sb.subShapeDrive(0.02, 1, 1, 0, 0), 1e-9, "Hard tone leaves the linear region alone");
// Tube: even-harmonic imbalance grows.
const tubeEven = (tn) => sb.subShapeDrive(0.35, 0.4, 2, 0, tn) + sb.subShapeDrive(-0.35, 0.4, 2, 0, tn);
assert.ok(Math.abs(tubeEven(1)) > Math.abs(tubeEven(0)) + 0.2, "Tube tone adds asymmetry");
// Fold: a centered folder is odd; the offset fills in an even component. A zero input stays zero.
const foldEven = (tn) => sb.subShapeDrive(0.4, 0.7, 3, 0, tn) + sb.subShapeDrive(-0.4, 0.7, 3, 0, tn);
near(foldEven(0), 0, 1e-9, "Fold at tone 0 stays an odd curve");
assert.ok(Math.abs(foldEven(1)) > 0.2, "Fold tone offsets the folds");
near(sb.subShapeDrive(0, 1, 3, 0, 1), 0, 1e-9, "Fold tone does not add DC at zero");
// Sine: the side of the wave comes up; a full-scale crest is unchanged because 1^p is 1.
assert.ok(sb.subShapeDrive(0.15, 0.4, 4, 0, 1) > sb.subShapeDrive(0.15, 0.4, 4, 0, 0) + 0.15, "Sine tone pinches the zero crossing");
near(sb.subShapeDrive(1, 0.4, 4, 0, 1), sb.subShapeDrive(1, 0.4, 4, 0, 0), 1e-9, "Sine tone leaves a full crest in place");
// Pinch: taller ear, deeper valley, crest held.
function pinchAt(a, tn) {
    return sb.subShapeDrive(a, 1, 5, 0, tn);
}
let ear0 = 0, ear1 = 0, val0 = 99, val1 = 99;
for (let i = 1; i <= 200; i++) {
    const a = i / 200;
    const p0 = pinchAt(a, 0), p1 = pinchAt(a, 1);
    if (a < 0.2) { if (p0 > ear0) ear0 = p0; if (p1 > ear1) ear1 = p1; }
    if (a > 0.2 && a < 0.55) { if (p0 < val0) val0 = p0; if (p1 < val1) val1 = p1; }
}
assert.ok(ear1 > ear0 + 0.1, "Pinch tone raises the ear");
assert.ok(val1 < val0 - 0.15, "Pinch tone deepens the valley");
near(pinchAt(1, 1), pinchAt(1, 0), 0.02, "Pinch tone keeps the crest");
// Noise: grit leaves the peak and lands on the crossing. Compare each to the same drive with the noise term removed.
function noiseClean(x, amt) {
    const yN = Math.tanh(x * (1 + amt * 3.5));
    return x + (yN - x) * amt;
}
const amtN = 0.7;
const zC = noiseClean(0.08, amtN);
const z0 = sb.subShapeDrive(0.08, amtN, 6, 0.37, 0);
const z1 = sb.subShapeDrive(0.08, amtN, 6, 0.37, 1);
assert.ok(Math.abs(z1 - zC) > Math.abs(z0 - zC) + 0.05, "Noise tone puts grit on the zero crossing");
const kC = noiseClean(0.85, amtN);
const k0 = sb.subShapeDrive(0.85, amtN, 6, 0.37, 0);
const k1 = sb.subShapeDrive(0.85, amtN, 6, 0.37, 1);
assert.ok(Math.abs(k1 - kC) < Math.abs(k0 - kC) * 0.5, "Noise tone lifts grit off the peak");
// The scope path reads the Tone parameter.
sb.applySubWavePreset(1);
sb.setParamFromFace("sub_partials", 1);
sb.setParamFromFace("sub_level", 100);
sb.setParamFromFace("sub_harm_level", 0);
sb.setParamFromFace("sub_drive", 45);
sb.setParamFromFace("sub_drv_type", 0);
sb.setParamFromFace("sub_tone", 0);
const scopeDryTone = sb.subWaveSample(0.02, 0);
sb.setParamFromFace("sub_tone", 100);
assert.ok(Math.abs(sb.subWaveSample(0.02, 0) - scopeDryTone) > 0.01, "the scope waveform follows Tone");
sb.setParamFromFace("sub_tone", 0);
sb.setParamFromFace("sub_drive", 0);
sb.applySubWavePreset(2);
sb.setParamFromFace("sub_partials", 8);
sb.setParamFromFace("sub_harm_level", 100);
sb.setParamFromFace("sub_level", 100);
sb.setParamFromFace("sub_drive", 0);
sb.setParamFromFace("sub_width", 0);
sb.setParamFromFace("sub_detune", 0);
const undetuned = sb.subWaveSample(0.22, 0);
near(sb.subWaveSample(0.22, 1), undetuned, 1e-9, "width 0 keeps L and R together");
sb.setParamFromFace("sub_width", 100);
assert.ok(Math.abs(sb.subWaveSample(0.22, 0) - sb.subWaveSample(0.22, 1)) > 0.01, "width spreads the upper harmonics");
sb.setParamFromFace("sub_width", 0);
sb.setParamFromFace("sub_detune", 100);
assert.ok(Math.abs(sb.subWaveSample(0.22, 0) - undetuned) > 1e-3, "detune moves the waveform");

sb.oscTab = 0;
sb.openMenu = null;
sb.setFoldMask(sb.DEFAULT_FOLD);

// Modulation matrix: every continuous parameter is a target, denied ones are not, and the grid drives the packer.
{
    const audit = sb.modAudit(FP);
    assert.deepStrictEqual(plain(audit.missing), [], `matrix missing ${audit.missing.join(", ")}`);
    assert.deepStrictEqual(plain(audit.deniedHit), [], `matrix should not target ${audit.deniedHit.join(", ")}`);
    sb.matRows = sb.modDefaultRows();
    sb.matDepth = {};
    sb.matPolar = {};
    sb.matTouch = { 1: -1, 2: -1, 3: -1, 4: -1 };
    sb.slotTypes = [0, 0, 0, 0, 2];
    sb.matPackedSig = "";
    assert.deepStrictEqual(plain(sb.modPack(sb.matRows, sb.matDepth, 100)), [0], "an empty matrix packs no routes");
    const legacy = sb.modPack({ 1: ["pitch_st"], 2: ["samp_gain"], 3: ["pitch_st"] }, { "1:0:1": 80, "2:0:5": 40 }, 100);
    assert.deepStrictEqual(plain(legacy), [0], "Env 2 to pitch and Vel to amp stay on their Live parameters");
    sb.setFoldMask(ALL);
    sb.matTab = 0;
    sb.paint();
    const cell = sb.hitZones.find((z) => z.kind === "modcell" && z.row === 0 && z.src === 4);
    assert.ok(cell, "slot 4 to Amp is a draggable cell");
    const cx = cell.x + 2, cy0 = cell.y + 2;
    sb.onclick(cx, cy0, 1, 0, 0);
    sb.ondrag(cx, cy0 - 120, 1, 0, 0);
    sb.ondrag(cx, cy0 - 120, 0, 0, 0);
    near(sb.matDepth["1:0:4"], 100, 0.01, "a full drag sets the slot 4 depth to 100");
    const packed = sb.modPack(sb.matRows, sb.matDepth, 100);
    assert.strictEqual(packed[0], 1, "one audio route");
    assert.strictEqual(packed[1], sb.modCode(sb.modTarget("samp_gain")), "the route targets sample gain");
    assert.strictEqual(packed[2], 4, "source is slot 4");
    near(packed[3], 1, 1e-9, "depth 100% at global amount 100%");
    sb.matDepth = {};
    sb.onclick(cx, cy0, 1, 0, 1);
    sb.ondrag(cx, cy0 - 120, 1, 0, 1);
    sb.ondrag(cx, cy0 - 120, 0, 0, 1);
    near(sb.matDepth["1:0:4"], 12.5, 0.05, "shift drag is eight times finer");
    sb.ondblclick(cx, cy0);
    assert.strictEqual(sb.matDepth["1:0:4"], 0, "double-click clears the cell");
    const before = sb.matRows[1][0];
    assert.ok(!sb.hitZones.some((z) => z.kind === "modrow"), "the target name is not a control");
    assert.strictEqual(sb.matRows[1][0], before, "the target name stays put");
    assert.ok(!sb.hitZones.some((z) => z.kind === "act" && Math.abs(z.y - cell.y) < 4 && z.x < cell.x), "default rows have no delete control");
    sb.onclick(cell.x + 2, cell.y + 2, 1, 0, 0, 0, 1);
    assert.strictEqual(sb.matPolar["1:0:4"], 1, "alt-click flips the cell to unipolar");
    sb.matDepth["1:0:4"] = 40;
    const uni = sb.modPack(sb.matRows, sb.matDepth, 100, sb.matPolar);
    assert.strictEqual(uni[2], 36, "a flipped cell packs source id + 32");
    delete sb.matPolar["1:0:4"];
    sb.matDepth = {};
    sb.matTab = 4;
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.kind === "modcell" && z.src === 15), "audio tab maps Osc 1");
    assert.ok(sb.hitZones.some((z) => z.kind === "modcell" && z.src === 17), "audio tab maps Sub");
    sb.slotTypes = [0, 0, 0, 0, 2];
    sb.msegPane = [0, 0, 0, 0, 0];
    sb.envPage = 4;
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.kind === "msegpt"), "slot 4 paints the MSEG");
    assert.strictEqual(sb.envTabTitle(4), "MSEG", "slot 4 is titled MSEG");
    sb.setSlotKind(1, 1);
    assert.strictEqual(sb.slotTypes[1], 1, "Env 2 can become an LFO");
    sb.setSlotKind(3, 2);
    assert.strictEqual(sb.slotTypes[3], 2, "LFO 1 can become an MSEG");
    function editorChrome() {
        sb.openMenu = null;
        sb.paint();
        return sb.hitZones.filter((z) => z.kind === "value" || z.kind === "msegplot" || (z.kind === "button" && (z.action === "menu_pick" || z.action === "toggle" || z.action === "menu")))
            .map((z) => [z.kind, z.action || "", Math.round(z.x), Math.round(z.y), Math.round(z.w)].join(":")).sort();
    }
    sb.msegPts = [null, null, null, null, null];
    sb.slotTypes = [0, 0, 0, 0, 2];
    sb.envPage = 3;
    const lfoNative = editorChrome();
    sb.envPage = 1;
    sb.setSlotKind(1, 1);
    const lfoSwitched = editorChrome();
    assert.deepStrictEqual(lfoSwitched, lfoNative, "an envelope slot set to LFO uses the LFO editor");
    assert.ok(sb.hitZones.some((z) => z.key === "sLfo:1:rate"), "the switched LFO edits that slot, not LFO 1");
    const rateZ = sb.hitZones.find((z) => z.key === "sLfo:1:rate");
    const lfoRateBefore = sb.paramValue("lfo_rate");
    sb.onclick(rateZ.x + 2, rateZ.y + 2, 1, 0, 0);
    sb.ondrag(rateZ.x + 30, rateZ.y - 40, 1, 0, 0);
    sb.ondrag(rateZ.x + 30, rateZ.y - 40, 0, 0, 0);
    assert.notStrictEqual(sb.slotLfo[1].rate, 1, "dragging the switched LFO rate changes that slot");
    assert.strictEqual(sb.paramValue("lfo_rate"), lfoRateBefore, "the switched LFO does not move LFO 1");
    sb.setSlotKind(1, 0);
    sb.envPage = 1;
    const envNative = editorChrome();
    sb.envPage = 3;
    sb.setSlotKind(3, 0);
    const envSwitched = editorChrome();
    assert.deepStrictEqual(envSwitched, envNative, "an LFO slot set to Env uses the envelope editor");
    const envHandles = () => sb.hitZones.filter((z) => z.kind === "hdl" && String(z.id).indexOf("env:") === 0).length;
    const switchedHandles = envHandles();
    sb.envPage = 1;
    sb.setSlotKind(1, 0);
    sb.paint();
    assert.strictEqual(switchedHandles, envHandles(), "the switched envelope has the same handles");
    sb.msegPts = [null, null, null, null, null];
    sb.msegPane = [0, 0, 0, 0, 0];
    sb.envPage = 4;
    sb.setSlotKind(4, 2);
    sb.paint();
    const msegA = sb.hitZones.filter((z) => z.kind === "msegpt" || z.kind === "msegplot").map((z) => [z.kind, Math.round(z.x), Math.round(z.y), Math.round(z.w)].join(":")).sort();
    sb.envPage = 2;
    sb.setSlotKind(2, 2);
    sb.paint();
    const msegB = sb.hitZones.filter((z) => z.kind === "msegpt" || z.kind === "msegplot").map((z) => [z.kind, Math.round(z.x), Math.round(z.y), Math.round(z.w)].join(":")).sort();
    assert.deepStrictEqual(msegB, msegA, "MSEG is the same editor on every slot");
    assert.ok(sb.hitZones.some((z) => z.tip === "sine"), "the MSEG toolbar has the sine tool");
    assert.ok(!sb.hitZones.some((z) => z.tip === "undo" || z.tip === "redo"), "the MSEG toolbar has no undo arrows");
    assert.ok(sb.hitZones.some((z) => z.tip === "Loop") && sb.hitZones.some((z) => z.tip === "1-Shot"), "Loop and 1-Shot stay on the panel");
    assert.ok(!sb.hitZones.some((z) => z.tip === "Manual"), "Manual mode is gone");
    assert.ok(sb.hitZones.some((z) => z.kind === "msegrate"), "Rate sits on the MSEG panel");
    assert.ok(!sb.hitZones.some((z) => z.kind === "msegknob" && z.field === "depth"), "Depth is gone from the MSEG panel");
    assert.ok(!sb.hitZones.some((z) => z.kind === "msegknob" && (z.field === "offset" || z.field === "jitter")), "Offset and Jitter are gone");
    assert.ok(sb.hitZones.some((z) => z.kind === "msegloop" && z.edge === "start"), "loop start is a handle");
    assert.ok(sb.hitZones.some((z) => z.kind === "msegloop" && z.edge === "end"), "loop end is a handle");
    assert.ok(sb.hitZones.some((z) => z.kind === "msegclock" && z.sync === 1), "rate can switch to sync");
    assert.ok(sb.hitZones.some((z) => z.tip === "retrigger"), "retrigger sits on the panel");
    const rateY = sb.hitZones.find((z) => z.kind === "msegrate").y;
    const plotY = sb.hitZones.find((z) => z.kind === "msegplot").y;
    assert.ok(rateY > plotY, "the value row sits under the curve");
    const gridZ = sb.hitZones.find((z) => z.kind === "mseggrid");
    sb.onclick(gridZ.x + 2, gridZ.y + 2, 1, 0, 0);
    sb.ondrag(gridZ.x + 2, gridZ.y - 36, 1, 0, 0);
    sb.ondrag(gridZ.x + 2, gridZ.y - 36, 0, 0, 0);
    assert.ok(sb.msegGridN[2] > 8, "dragging the grid value raises it");
    sb.msegGridN[2] = 8;
    const syncZ = sb.hitZones.find((z) => z.kind === "msegclock" && z.sync === 1);
    sb.onclick(syncZ.x + 2, syncZ.y + 2, 1, 0, 0);
    assert.strictEqual(sb.msegSync[2], 1, "the metronome switches rate to sync");
    assert.strictEqual(sb.msegRateText(2), "1/4", "sync starts on a quarter note");
    sb.msegSync[2] = 0;
    const loopZ = sb.hitZones.find((z) => z.kind === "msegloop" && z.edge === "end");
    sb.onclick(loopZ.x + 2, loopZ.y + 2, 1, 0, 0);
    sb.ondrag(loopZ.x - 40, loopZ.y, 1, 0, 0);
    sb.ondrag(loopZ.x - 40, loopZ.y, 0, 0, 0);
    assert.ok(sb.msegLoop1[2] < 1, "dragging the loop end moves it");
    sb.msegLoop0[2] = 0;
    sb.msegLoop1[2] = 1;
    const trigZ = sb.hitZones.find((z) => z.tip === "retrigger");
    sb.onclick(trigZ.x + 2, trigZ.y + 2, 1, 0, 0);
    assert.strictEqual(sb.msegRetrig[2], 0, "retrigger toggles off");
    sb.msegRetrig[2] = 1;
    sb.msegGridN[2] = 4;
    sb.msegSnapOn[2] = 0;
    sb.msegPts[2] = null;
    sb.msegGeom = { x: 0, y: 0, w: 100, h: 100, slot: 2 };
    sb.msegPaintRamp(2, 10, 20);
    const painted = sb.msegPoints(2);
    assert.strictEqual(painted[0].y, 0, "a painted ramp starts at the bottom of the cell");
    assert.ok(painted.some((p) => Math.abs(p.y - 0.8) < 0.02 && p.x > 0.15 && p.x < 0.3), "a painted ramp rises across the grid cell");
    sb.msegGridN[2] = 8;
    sb.msegSnapOn[2] = 1;
    sb.msegApply(2, "ramps");
    const ramps = sb.msegPoints(2);
    assert.strictEqual(ramps[0].x, 0, "random ramps start at the left");
    assert.strictEqual(ramps[ramps.length - 1].x, 1, "random ramps end at the right");
    assert.ok(ramps.length >= 4 && ramps.length % 2 === 0, "random ramps are peak and floor pairs");
    for (let ri = 0; ri < ramps.length; ri += 2) {
        assert.ok(ramps[ri].y + 1e-6 >= ramps[ri + 1].y, "each ramp falls");
        assert.ok(ramps[ri].curve > 0.2, "each ramp decays");
    }
    sb.msegApply(2, "sine");
    assert.strictEqual(sb.msegPoints(2).length, 5, "the sine tool builds the shaper sine");
    sb.msegDraw[2] = 0;
    sb.msegSnapOn[2] = 0;
    sb.msegSel[2] = [];
    sb.msegPts[2] = [
        { x: 0, y: 0.2, curve: 0, sCurve: 0 },
        { x: 0.25, y: 0.75, curve: 0, sCurve: 0 },
        { x: 0.55, y: 0.35, curve: 0, sCurve: 0 },
        { x: 0.8, y: 0.6, curve: 0, sCurve: 0 },
        { x: 1, y: 0.2, curve: 0, sCurve: 0 }
    ];
    sb.paint();
    const mg = sb.msegGeom;
    const scr = (p) => [mg.x + p.x * mg.w, mg.y + (1 - p.y) * mg.h];
    const boxPts = sb.msegPoints(2);
    const s1 = scr(boxPts[1]);
    const s2 = scr(boxPts[2]);
    sb.onclick(s1[0] - 10, s1[1], 1, 0, 0);
    sb.ondrag(s2[0] + 10, s2[1], 1, 0, 0);
    sb.ondrag(s2[0] + 10, s2[1], 0, 0, 0);
    assert.ok(sb.msegSel[2].indexOf(boxPts[1].id) >= 0 && sb.msegSel[2].indexOf(boxPts[2].id) >= 0, "a selection box selects the points inside it");
    const xBefore = boxPts.map((p) => p.x);
    sb.onclick(s1[0], s1[1], 1, 0, 0);
    sb.ondrag(s1[0] + mg.w * 0.1, s1[1], 1, 0, 0);
    sb.ondrag(s1[0] + mg.w * 0.1, s1[1], 0, 0, 0);
    const grouped = sb.msegPoints(2);
    assert.ok(Math.abs(grouped[1].x - (xBefore[1] + 0.1)) < 0.02, "dragging a selection moves the grabbed point");
    assert.ok(Math.abs((grouped[2].x - xBefore[2]) - (grouped[1].x - xBefore[1])) < 0.02, "dragging a selection moves every selected point together");
    sb.msegPts[2] = [
        { x: 0, y: 0, curve: 0, sCurve: 0 },
        { x: 0.2, y: 0.5, curve: 0, sCurve: 0 },
        { x: 0.5, y: 0.5, curve: 0, sCurve: 0 },
        { x: 0.8, y: 0.5, curve: 0, sCurve: 0 },
        { x: 1, y: 0, curve: 0, sCurve: 0 }
    ];
    sb.msegSel[2] = [];
    sb.paint();
    const eatG = sb.msegGeom;
    const eatY = eatG.y + (1 - 0.5) * eatG.h;
    sb.onclick(eatG.x + 0.2 * eatG.w, eatY, 1, 0, 0);
    sb.ondrag(eatG.x + 0.5 * eatG.w, eatY, 1, 0, 0);
    sb.ondrag(eatG.x + 0.5 * eatG.w, eatY, 0, 0, 0);
    assert.strictEqual(sb.msegPoints(2).length, 4, "dragging a point onto another deletes the one underneath");
    sb.msegPts[2] = [
        { x: 0, y: 0, curve: 0, sCurve: 0 },
        { x: 0.2, y: 0.4, curve: 0, sCurve: 0 },
        { x: 0.5, y: 0.8, curve: 0, sCurve: 0 },
        { x: 0.8, y: 0.3, curve: 0, sCurve: 0 },
        { x: 1, y: 0, curve: 0, sCurve: 0 }
    ];
    sb.msegSel[2] = [];
    sb.paint();
    const delPts = sb.msegPoints(2);
    sb.msegSel[2] = [delPts[1].id, delPts[2].id];
    sb.msegKeyOn = 1;
    assert.strictEqual(sb.onkeydown(8, 8, 0), 0, "a key release does not delete");
    sb.msegKeyOn = 0;
    sb.onkeydown(8, 8, 1);
    assert.strictEqual(sb.msegPoints(2).length, 5, "delete does nothing while the MSEG is not focused");
    sb.msegKeyOn = 1;
    assert.strictEqual(sb.onkeydown(8, 8, 1), 1, "delete is handled while the MSEG is focused");
    assert.strictEqual(sb.msegPoints(2).length, 3, "delete removes the selected points");
    assert.ok(sb.msegPoints(2).every((p) => p.id !== delPts[1].id && p.id !== delPts[2].id), "the selected points are the ones removed");
    assert.strictEqual(sb.msegPoints(2)[0].x, 0, "delete keeps the left end");
    assert.strictEqual(sb.msegPoints(2)[sb.msegPoints(2).length - 1].x, 1, "delete keeps the right end");
    for (let pv = 0; pv < 16; pv++) { sb.msegVoicePh[pv] = -1; sb.voiceAmpLvl[pv] = 0; }
    sb.msegVoicePh[0] = 0.25;
    sb.msegVoicePh[3] = 0.7;
    sb.voiceAmpLvl[0] = 0.8;
    sb.voiceAmpLvl[3] = 0.5;
    sb.voiceBorn[0] = 1;
    sb.voiceBorn[3] = 2;
    sb.paint();
    assert.strictEqual(sb.msegDots.length, 2, "each sounding voice draws a dot on the curve");
    const dotG = sb.msegGeom;
    const dot0 = sb.msegDots.find((d) => d.v === 0);
    const dot3 = sb.msegDots.find((d) => d.v === 3);
    near(dot0.x, dotG.x + 0.25 * dotG.w, 1.2, "a voice dot sits at that voice's position");
    near(dot3.x, dotG.x + 0.7 * dotG.w, 1.2, "a second voice dot sits at its own position");
    near(dot0.y, dotG.y + (1 - sb.msegAt(sb.msegPoints(2), 0.25)) * dotG.h, 1.2, "the dot rides the curve");
    for (let pv2 = 0; pv2 < 16; pv2++) { sb.msegVoicePh[pv2] = -1; sb.voiceAmpLvl[pv2] = 0; }
    const revZ = sb.hitZones.find((z) => z.tip === "reverse");
    assert.ok(revZ, "reverse is a button");
    sb.onclick(revZ.x + 2, revZ.y + 2, 1, 0, 0);
    assert.strictEqual(sb.msegRev[2], 1, "the reverse button toggles on");
    sb.msegRev[2] = 0;
    sb.msegSync[2] = 0;
    sb.paint();
    const smoothHz = sb.hitZones.find((z) => z.kind === "msegknob" && z.field === "smooth");
    const phaseHz = sb.hitZones.find((z) => z.kind === "msegknob" && z.field === "phase");
    const rateHz = sb.hitZones.find((z) => z.kind === "msegrate");
    assert.ok(!sb.hitZones.some((z) => z.kind === "msegmult"), "Hz mode leaves the multiplier slot empty");
    sb.msegSync[2] = 1;
    sb.msegSyncMul[2] = 1;
    sb.paint();
    const mulZ = sb.hitZones.find((z) => z.kind === "msegmult");
    const smoothSync = sb.hitZones.find((z) => z.kind === "msegknob" && z.field === "smooth");
    const phaseSync = sb.hitZones.find((z) => z.kind === "msegknob" && z.field === "phase");
    assert.ok(mulZ, "sync mode shows a time multiplier");
    assert.strictEqual(smoothSync.x, smoothHz.x, "Smooth stays put when sync turns on");
    assert.strictEqual(phaseSync.x, phaseHz.x, "Phase stays put when sync turns on");
    assert.ok(mulZ.x > rateHz.x + 20 && mulZ.x < smoothSync.x, "the multiplier fills the slot between Rate and Smooth");
    assert.strictEqual(sb.msegMulText(2), "\u00d71.00", "the multiplier starts at \u00d71");
    sb.onclick(mulZ.x + 2, mulZ.y + 2, 1, 0, 0);
    sb.ondrag(mulZ.x + 2, mulZ.y - 80, 1, 0, 0);
    sb.ondrag(mulZ.x + 2, mulZ.y - 80, 0, 0, 0);
    assert.ok(sb.msegSyncMul[2] > 1.8 && sb.msegSyncMul[2] < 2.2, "dragging the multiplier doubles it over an octave of travel");
    sb.msegSync[2] = 0;
    sb.msegSyncMul[2] = 1;
    sb.msegKeyOn = 0;
    sb.msegPts = [null, null, null, null, null];
    sb.msegSel = [[], [], [], [], []];
    sb.msegSnapOn[2] = 1;
    sb.drag = null;
    sb.msegUndo = [[], [], [], [], []];
    sb.msegRedo = [[], [], [], [], []];
    sb.slotTypes = [0, 0, 0, 0, 2];
    sb.slotLfo = [null, sb.blankSlotLfo(), sb.blankSlotLfo(), sb.blankSlotLfo(), sb.blankSlotLfo()];
    sb.slotTypes = [0, 0, 0, 0, 2];
    sb.envPage = 0;
    sb.matTab = 0;
    sb.matSuppressTouch = 0;
    sb.setFoldMask(sb.DEFAULT_FOLD);
    const touched = sb.noteMatTouch("filt_res");
    assert.strictEqual(touched, false, "a folded matrix does not grow a row");
    sb.setFoldMask(ALL);
    sb.noteMatTouch("filt_res");
    assert.ok(sb.matRows[1].indexOf("filt_res") >= 0, "touching a parameter adds a matrix row");
    const added = sb.matRows[1].indexOf("filt_res");
    sb.noteMatTouch("atk_ms");
    assert.strictEqual(sb.matRows[1][added], "atk_ms", "an unmapped touch row is replaced");
    sb.matDepth["1:" + added + ":0"] = 30;
    sb.noteMatTouch("dec_ms");
    assert.ok(sb.matRows[1].indexOf("atk_ms") >= 0 && sb.matRows[1].indexOf("dec_ms") >= 0, "a mapped touch row stays");
    sb.matRows = sb.modDefaultRows();
    sb.matDepth = {};
    sb.matPolar = {};
    sb.matTouch = { 1: -1, 2: -1, 3: -1, 4: -1 };
    sb.matTab = 2;
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.kind === "value" && z.key === "vel_sens"), "MIDI Vel to Amp edits Velocity");
    assert.ok(sb.hitZones.some((z) => z.kind === "modcell"), "MIDI tab has matrix cells");
    sb.matTab = 3;
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.kind === "modcell" && z.src === 13), "MPE Slide is a source");
    sb.matTab = 1;
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.key === "xs_depth"), "X-Synth tab still edits its depth");
    sb.matTab = 0;
    sb.matRows = sb.modDefaultRows();
    sb.matDepth = {};
    sb.matPolar = {};
    sb.slotTypes = [0, 0, 0, 0, 2];
    sb.slotRate = [1, 1, 1, 1, 1];
    sb.slotShape = [0, 0, 0, 0, 0];
    sb.slotAdsr = [[10, 200, 0.7, 300], [10, 200, 0.7, 300], [10, 200, 0.7, 300], [10, 200, 0.7, 300], [10, 200, 0.7, 300]];
    sb.msegPts = [null, null, null, null, null];
    sb.msegPlayMode = [0, 0, 0, 0, 0];
    sb.msegLoop0 = [0, 0, 0, 0, 0];
    sb.msegLoop1 = [1, 1, 1, 1, 1];
    sb.msegSync = [0, 0, 0, 0, 0];
    sb.msegSyncIdx = [9, 9, 9, 9, 9];
    sb.msegRetrig = [1, 1, 1, 1, 1];
    sb.msegRev = [0, 0, 0, 0, 0];
    sb.msegSyncMul = [1, 1, 1, 1, 1];
    sb.msegGridN = [8, 8, 8, 8, 8];
    sb.msegSnapOn = [1, 1, 1, 1, 1];
    sb.paint();
    assert.ok(sb.hitZones.some((z) => z.key === "mod_global_amt"), "Global Amount stays a direct control");
    let blob = sb.getvalueof();
    assert.strictEqual(blob[blob.length - 2], "R2", "a default matrix is omitted from the blob");
    sb.matDepth["1:0:4"] = 25;
    sb.matPackedSig = "";
    blob = sb.getvalueof();
    assert.strictEqual(blob[blob.length - 2], "MX", "a changed cell is saved after the fold mask");
    sb.matDepth = {};
    sb.matRows = sb.modDefaultRows();
    sb.setvalueof(...blob);
    near(sb.matDepth["1:0:4"], 25, 1e-9, "the blob restores the cell");
    sb.matRows = { 1: ["osc1_pan", "cell:1:0:4"], 2: [], 3: [] };
    sb.matDepth = { "1:1:0": 40 };
    const depthPacked = plain(sb.modPack(sb.matRows, sb.matDepth, 100));
    assert.strictEqual(depthPacked[0], 2, "a zero cell stays packed when another row targets its depth");
    assert.strictEqual(depthPacked[7], 1000, "the second route modulates the first route");
    sb.matDepth = {};
    sb.matRows = sb.modDefaultRows();
    sb.matPackedSig = "";
}

// Automation echoes share one paint. A face edit still paints immediately.
{
    const cut = sb.paramValue("filt_cutoff");
    const res = sb.paramValue("filt_res");
    const Task0 = sb.Task;
    const redraw0 = sb.mgraphics.redraw;
    let paints = 0;
    let queued = 0;
    const tasks = [];
    sb.mgraphics.redraw = () => { paints++; };
    sb.Task = function (fn) {
        this.fn = fn;
        this.schedule = (ms) => { this.ms = ms; queued++; };
        this.cancel = () => { this.cancelled = true; };
        tasks.push(this);
    };
    sb.redrawTask = null;
    sb.redrawQueued = 0;
    sb.set_filt_cutoff(400);
    sb.set_filt_cutoff(800);
    sb.set_filt_res(20);
    assert.strictEqual(paints, 0, "automation echoes do not paint immediately");
    assert.strictEqual(queued, 1, "a burst of automation schedules one paint");
    assert.strictEqual(tasks[0].ms, 16, "the shared paint waits one frame");
    tasks[0].fn();
    assert.strictEqual(paints, 1, "the scheduled paint runs once");
    queued = 0;
    sb.set_filt_cutoff(800);
    assert.strictEqual(queued, 0, "an unchanged automated value does not repaint");
    paints = 0;
    sb.storeParam("filt_cutoff", 900, true);
    assert.strictEqual(paints, 1, "a face edit still paints immediately");
    sb.storeParam("filt_cutoff", cut, true);
    sb.storeParam("filt_res", res, true);
    sb.redrawTask = null;
    sb.redrawQueued = 0;
    sb.Task = Task0;
    sb.mgraphics.redraw = redraw0;
}
{
    sb.setFoldMask(sb.DEFAULT_FOLD);
    sb.envPage = 3;
    sb.liveLfoPh = 0.5;
    sb.paint();
    assert.ok(sb.lfoDot, "LFO 1 draws a playhead");
    near(sb.lfoDot.ph, 0.5, 1e-6, "the playhead is the generator phase");
    const xAtHalf = sb.lfoDot.x;
    sb.liveLfoPh = 0;
    sb.paint();
    assert.ok(sb.lfoDot.x < xAtHalf, "phase 0 sits left of mid-cycle");
    sb.envPage = 1;
    sb.liveLfoPh = 0;
}
console.log("reactive2 design: folds, viewer, envelope dots, filter voices, handles, sub oscillator and parameter reach ok");
