// Mega Modulator — v8-side runtime ("MM"). Prepended after src/megamod_config.js into every UI script.
// See the API CONTRACT at the top of src/megamod_config.js for the UI-facing API.
//
// Owns: state, engine buffer writers, the saved mapping-slot pool (route/curve buffers + live id binding),
// learn (selected_parameter observer), target resolution/validation, telemetry polling,
// getvalueof/setvalueof, device width requests. Everything touching Max/Live objects is guarded so the
// script also loads in Node mocks and in the preview renderer.

const MM_THIS = this;
const MM_ENGINE_VARNAME = "megamod_engine";
// Debug trace of learn/mapping. Off by default; set MM_DEBUG_LOG to an absolute path to also mirror it to a file.
const MM_DEBUG = false;
const MM_DEBUG_LOG = "";
const mmLogLines = [];
/** @param {...unknown} args */
function dlog(...args) {
    const parts = args.map((a) => {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
    });
    const line = new Date().toISOString().slice(11, 23) + " " + parts.join(" ");
    mmLogLines.push(line);
    if (mmLogLines.length > 1500) mmLogLines.splice(0, mmLogLines.length - 1500);
    if (typeof post === "function") post("megamod: " + line + "\n");
    if (!MM_DEBUG_LOG || typeof File === "undefined") return;
    try {
        const f = new File(MM_DEBUG_LOG, "write", "TEXT");
        f.eof = 0;
        f.writestring(mmLogLines.join("\n") + "\n");
        f.close();
    } catch (e) {}
}
dlog("script loaded; this.patcher=" + (MM_THIS && MM_THIS.patcher ? "yes" : "NO") + " Global=" + (typeof Global) + " LiveAPI=" + (typeof LiveAPI));

var MM = (function () {
    const api = {};
    const listeners = { change: [], telemetry: [], ready: [] };
    let names = null; // {cfg, mseg, steps, scope, curve, route} names as Live expanded them (--- -> 012...)
    let bufs = {};
    let lomReady = false;
    let readyFired = false;
    let selfPath = "";
    let scratch = null;
    let selObserver = null;
    let lastSelectedId = 0;
    let slotOf = {}; // mapId -> pool slot 0..MAX_MAPPINGS-1 (runtime only)
    let bound = {}; // slot -> {mod, rem}: ids last sent to mm_mid_<k> / mm_rid_<k>
    let rtrgCounter = 0;
    let reqWidth = 0;
    let telTask = null;
    let valTask = null;
    let notifyTask = null;
    let pidCache = {}; // mapId -> live id (number), runtime only
    let missing = {}; // mapId -> true
    const tel = { frame: 0, bpm: 120, beat: 0, playing: 0, mods: [] };
    for (let i = 0; i < MAX_MODS; i++) tel.mods.push({ out: 0, phase: 0, u: 0, aux: 0 });

    api.state = defaultState();
    api.learn = { armed: false, mod: -1, multi: false };

    // ---------------------------------------------------------------- plumbing
    function patcher() {
        return MM_THIS && MM_THIS.patcher ? MM_THIS.patcher : null;
    }
    function post2(s) {
        dlog("post2", s);
    }
    function redraw() {
        if (typeof mgraphics !== "undefined" && mgraphics.redraw) mgraphics.redraw();
    }
    function fire(kind, mod, id) {
        const ev = { kind, mod: mod === undefined ? -1 : mod, id: id === undefined ? 0 : id };
        for (const fn of listeners.change) { try { fn(ev); } catch (e) { post2("listener: " + e); } }
        if (typeof uiChanged === "function") { try { uiChanged(ev); } catch (e) { post2("uiChanged: " + e); } }
        redraw();
    }
    api.on = function (name, fn) {
        if (listeners[name]) listeners[name].push(fn);
    };
    function buf(key) {
        if (!names || !names[key]) return null;
        if (!bufs[key]) {
            try { bufs[key] = new Buffer(names[key]); } catch (e) { bufs[key] = null; post2("Buffer " + names[key] + ": " + e); }
        }
        return bufs[key];
    }
    function poke(key, offset, arr) {
        const b = buf(key);
        if (!b) return false;
        try { b.poke(1, offset, arr); return true; } catch (e) { return false; }
    }
    function markDirty() {
        if (typeof Task === "undefined") { api.commit(); return; }
        if (!notifyTask) notifyTask = new Task(function () { api.commit(); }, MM_THIS);
        notifyTask.interval = 400;
        notifyTask.cancel();
        notifyTask.schedule(400);
    }
    api.commit = function () {
        if (notifyTask) { try { notifyTask.cancel(); } catch (e) {} }
        if (typeof notifyclients === "function") notifyclients();
    };

    // ---------------------------------------------------------------- engine buffers
    function writeCfgSlot(i) {
        poke(BUF_CFG, i * CFG_STRIDE, slotConfigFloats(api.state.mods[i]));
    }
    function writeMsegSlot(i) {
        const m = api.state.mods[i];
        poke(BUF_MSEG, i * MSEG_TABLE, m ? msegTable(m.points) : new Array(MSEG_TABLE).fill(0));
    }
    function writeStepsSlot(i) {
        const m = api.state.mods[i];
        poke(BUF_STEPS, i * STEPS_MAX, m ? m.stepVals.slice(0, STEPS_MAX) : new Array(STEPS_MAX).fill(0));
    }
    function flushEngine() {
        if (!names) return;
        poke(BUF_CFG, 0, cfgBufferFloats(api.state));
        for (let i = 0; i < MAX_MODS; i++) { writeMsegSlot(i); writeStepsSlot(i); }
    }

    // ---------------------------------------------------------------- mapping slots
    function lomPid(m) {
        return pidCache[m.id] || 0;
    }
    function mappingActive(m) {
        const mod = api.state.mods[m.mod];
        return !!(m.enabled && mod && mod.enabled && !missing[m.id] && lomPid(m) > 0);
    }
    api.mappingStatus = function (id) {
        const m = api.getMapping(id);
        if (!m) return "missing";
        if (missing[m.id]) return "missing";
        if (!lomReady || !lomPid(m)) return "pending";
        return mappingActive(m) ? "ok" : "disabled";
    };

    // ---- mapping slot pool: 256 saved slots (router outlet -> live.modulate~ / live.remote~), no scripting ----
    function slotBox(prefix, slot) {
        const p = patcher();
        if (!p || typeof p.getnamed !== "function") return null;
        try { return p.getnamed(prefix + slot) || null; } catch (e) { return null; }
    }
    function sendId(prefix, slot, id) {
        const o = slotBox(prefix, slot);
        if (!o) { dlog("sendId: box missing", prefix + slot); return false; }
        try { o.message("int", id); return true; } catch (e) { dlog("sendId failed", prefix + slot, String(e)); return false; }
    }
    function allocSlot() {
        const used = {};
        for (const k of Object.keys(slotOf)) used[slotOf[k]] = true;
        for (let k = 0; k < MAX_MAPPINGS; k++) if (!used[k]) return k;
        return -1;
    }
    function boundOf(slot) {
        if (!bound[slot]) bound[slot] = { mod: 0, rem: 0 };
        return bound[slot];
    }
    function writeRoute(slot, v) {
        poke(BUF_ROUTE, 2 * slot, [v]);
    }
    function flushRoute() {
        const a = new Array(ROUTE_SAMPS).fill(0);
        for (let k = 0; k < MAX_MAPPINGS; k++) a[2 * k] = ROUTE_OFF;
        poke(BUF_ROUTE, 0, a);
    }
    function unbindSlot(slot) {
        const b = boundOf(slot);
        if (b.mod !== 0) { sendId("mm_mid_", slot, 0); b.mod = 0; }
        if (b.rem !== 0) { sendId("mm_rid_", slot, 0); b.rem = 0; }
    }
    // Drive one slot's ids: release first (mode/target change, or inactive), then bind the active mode's box only.
    function bindSlot(slot, mode, pid) {
        const b = boundOf(slot);
        const wantMod = mode === "mod" ? pid : 0;
        const wantRem = mode === "remote" ? pid : 0;
        if (b.mod !== 0 && b.mod !== wantMod) { sendId("mm_mid_", slot, 0); b.mod = 0; }
        if (b.rem !== 0 && b.rem !== wantRem) { sendId("mm_rid_", slot, 0); b.rem = 0; }
        if (wantMod !== 0 && b.mod !== wantMod) { sendId("mm_mid_", slot, wantMod); b.mod = wantMod; }
        if (wantRem !== 0 && b.rem !== wantRem) { sendId("mm_rid_", slot, wantRem); b.rem = wantRem; }
    }
    function writeMappingTable(m) {
        const slot = slotOf[m.id];
        if (slot === undefined) return;
        poke(BUF_CURVE, slot * CURVE_REGION, mappingTable(m));
    }
    // Bring one mapping's slot in line with the model: table, route, ids. Cheap when nothing changed.
    function syncMapping(m) {
        if (slotOf[m.id] === undefined) {
            const s = allocSlot();
            if (s < 0) { dlog("syncMapping: pool full, map", m.id); return; }
            slotOf[m.id] = s;
        }
        m.slot = slotOf[m.id]; // persisted: the mapping keeps this slot (and its Depth parameter) across saves
        autoPushDepth(m);
        if (!patcher() || !names || !lomReady) { dlog("syncMapping skip map", m.id, "patcher", !!patcher(), "names", !!names, "lomReady", lomReady); return; }
        const slot = slotOf[m.id];
        const active = mappingActive(m);
        writeMappingTable(m);
        if (active) {
            writeRoute(slot, m.mod);
            bindSlot(slot, m.mode, lomPid(m));
        } else {
            bindSlot(slot, m.mode, 0);
            writeRoute(slot, ROUTE_OFF);
        }
        dlog("syncMapping map", m.id, "slot", slot, "mode", m.mode, "mod", m.mod, "active", active, "pid", lomPid(m), "bound", boundOf(slot));
    }
    function syncMappingsFor(modIndex) {
        for (const m of api.state.mappings) if (m.mod === modIndex) syncMapping(m);
    }
    function releaseMappingSlot(m) {
        const slot = slotOf[m.id];
        if (slot === undefined) return;
        if (patcher() && names) {
            sendId("mm_mid_", slot, 0); sendId("mm_rid_", slot, 0);
            writeRoute(slot, ROUTE_OFF);
        }
        bound[slot] = { mod: 0, rem: 0 };
        delete slotOf[m.id];
        if (slot < AUTO_DEPTH_SLOTS) autoPush("ad_" + slot, 100);
    }
    // Rebind every mapping (load / names / LOM ready). Releases everything first. Each mapping gets its saved slot
    // back when it is free, so automation of its "Depth <k>" parameter follows the mapping across deletes and
    // reloads; only mappings without a (valid, unclaimed) saved slot take the lowest free one.
    function rebuildAllSlots() {
        for (const k of Object.keys(bound)) unbindSlot(Number(k));
        slotOf = {};
        bound = {};
        if (names) flushRoute();
        const claimed = {};
        for (const m of api.state.mappings) {
            if (Number.isInteger(m.slot) && m.slot >= 0 && m.slot < MAX_MAPPINGS && !claimed[m.slot]) {
                claimed[m.slot] = true;
                slotOf[m.id] = m.slot;
            }
        }
        for (const m of api.state.mappings) {
            if (slotOf[m.id] !== undefined) { syncMapping(m); continue; }
            const s = allocSlot();
            if (s < 0) { dlog("rebuildAllSlots: pool full, map", m.id, "left unslotted"); continue; }
            slotOf[m.id] = s;
            syncMapping(m);
        }
    }

    // ---------------------------------------------------------------- automatable parameter pool
    // Saved live.* objects (scripts/megamod_common.py): ap_<slot * 6 + j> (j 0..4 = the type's controls via AUTO_KEYS, j 5 = On),
    // ad_<k> (Depth of the mapping in pool slot k < 64) and ap_marker (hidden: "Live has stored the parameter values").
    // The Live parameter NAMES are fixed ("M3 A".."M3 E", "M3 On", "Depth 5"): a runtime rename does not reach Live (see AUTO_LETTERS in config).
    // JS -> Live: the value is MESSAGED into the object (it outputs, so Live records automation / macros see it), never `set`.
    // Live -> JS: every object outputs through `prepend autop <idx>` / `prepend autod <k>` into this script (autop() / autod()).
    // Echo of our own push is recognised by value (autoSent), an echo never changes the model; an external change never pushes
    // back, marks the Set dirty or touches the undo stack. Nothing is pushed before `ready` (autoOn): at ready, a stored
    // marker means Live's values win (adopted into the model), no marker (old Set, new device) means the blob's values are pushed.
    let autoOn = false;
    let autoFrozen = false; // test hook: Live input is dropped, so the blob goes stale against the parameter values
    let autoInitInfo = null; // how the last autoInit decided: {stored, marker, cached, read, missing} (test_names / tests)
    const autoCache = {}; // object key -> last value seen from / pushed to the object (normalized 0..100 for params)
    const autoSent = {}; // object key -> value we pushed and whose echo has not arrived yet
    let depthTask = null;
    let depthLast = 0;
    const depthPending = {}; // mapId -> true while a throttled table rewrite is waiting
    const DEPTH_THROTTLE_MS = 33;
    let nowFn = function () { return Date.now(); };
    function autoBox(key) {
        const p = patcher();
        if (!p || typeof p.getnamed !== "function") return null;
        try { return p.getnamed(key) || null; } catch (e) { return null; }
    }
    function autoKey(slot, j) { return "ap_" + (slot * AUTO_PER_SLOT + j); }
    function swKey(slot, t) { return "at_" + (slot * AUTO_SW_PER_SLOT + t); }
    function autoPush(key, v) {
        if (!autoOn) return;
        if (autoCache[key] !== undefined && Math.abs(autoCache[key] - v) < 1e-7) return;
        const o = autoBox(key);
        if (!o) return;
        autoCache[key] = v;
        autoSent[key] = v;
        try { o.message("float", v); } catch (e) { dlog("autoPush failed", key, String(e)); }
    }
    // a value from a live.* object: true when it is the echo of our own push (consumed), else it is an external change
    function autoIsEcho(key, v) {
        const s = autoSent[key];
        delete autoSent[key];
        autoCache[key] = v;
        return s !== undefined && Math.abs(s - v) < 0.01;
    }
    function autoReadBack(key) {
        if (autoCache[key] !== undefined) { if (autoInitInfo) autoInitInfo.cached++; return autoCache[key]; }
        const o = autoBox(key);
        if (!o) { if (autoInitInfo) autoInitInfo.missing++; return undefined; }
        try {
            const v = typeof o.getvalueof === "function" ? o.getvalueof() : undefined;
            const n = Array.isArray(v) ? Number(v[0]) : Number(v);
            if (Number.isFinite(n)) { if (autoInitInfo) autoInitInfo.read++; return n; }
        } catch (e) {}
        if (autoInitInfo) autoInitInfo.missing++;
        return undefined;
    }
    function autoPushSlot(i) {
        const mod = api.state.mods[i];
        if (!mod) return;
        const keys = AUTO_KEYS[mod.type];
        for (let j = 0; j < AUTO_PARAMS; j++) if (keys[j]) autoPush(autoKey(i, j), 100 * autoNorm(keys[j], mod.p[keys[j]]));
        autoPush(autoKey(i, AUTO_PARAMS), mod.enabled ? 1 : 0);
        for (const k of AUTO_SW_USED[mod.type]) autoPush(swKey(i, AUTO_SW_KEYS.indexOf(k)), mod.p[k]);
    }
    // one control changed in the model (UI path): push it, and its coupled partner (loop start / end)
    function autoPushKey(i, key) {
        if (!autoOn) return;
        const mod = api.state.mods[i];
        if (!mod) return;
        if (key === "enabled") { autoPush(autoKey(i, AUTO_PARAMS), mod.enabled ? 1 : 0); return; }
        const t = autoSwitchIndex(mod.type, key);
        if (t >= 0) { autoPush(swKey(i, t), mod.p[key]); return; }
        const keys = AUTO_KEYS[mod.type];
        const ks = key === "loopStart" || key === "loopEnd" ? ["loopStart", "loopEnd"] : [key];
        for (const kk of ks) {
            const j = keys.indexOf(kk);
            if (j >= 0) autoPush(autoKey(i, j), 100 * autoNorm(kk, mod.p[kk]));
        }
    }
    function mappingInSlot() {
        const out = {};
        for (const m of api.state.mappings) if (slotOf[m.id] !== undefined) out[slotOf[m.id]] = m;
        return out;
    }
    function autoPushDepth(m) {
        const k = slotOf[m.id];
        if (k !== undefined && k < AUTO_DEPTH_SLOTS) autoPush("ad_" + k, 100 * m.depth);
    }
    function autoPushAll(force) {
        if (force) for (const k of Object.keys(autoCache)) delete autoCache[k];
        for (let i = 0; i < MAX_MODS; i++) autoPushSlot(i);
        for (const m of api.state.mappings) autoPushDepth(m);
        for (let k = 0; k < AUTO_DEPTH_SLOTS; k++) if (!mappingInSlot()[k]) autoPush("ad_" + k, 100);
    }
    // ready: Live's stored values win when the marker says Live has them, else the blob's values are pushed once
    function autoInit() {
        if (autoOn || !patcher()) return;
        autoInitInfo = { stored: false, marker: null, cached: 0, read: 0, missing: 0 };
        const mk = autoReadBack("ap_marker");
        const stored = mk !== undefined && mk >= 0.5;
        const swStored = mk !== undefined && mk >= 1.5; // marker 2: the switch parameters (shape / chips) were saved too
        autoInitInfo.stored = stored;
        autoInitInfo.marker = mk === undefined ? null : mk;
        autoOn = true;
        if (stored) {
            for (let i = 0; i < MAX_MODS; i++) {
                const mod = api.state.mods[i];
                if (!mod) continue;
                const keys = AUTO_KEYS[mod.type];
                for (let j = 0; j < AUTO_PARAMS; j++) {
                    if (!keys[j]) continue;
                    const v = autoReadBack(autoKey(i, j));
                    if (v === undefined) autoPush(autoKey(i, j), 100 * autoNorm(keys[j], mod.p[keys[j]]));
                    else mod.p[keys[j]] = clampParam(keys[j], autoValue(keys[j], v / 100));
                }
                for (const k of AUTO_SW_USED[mod.type]) {
                    const t = AUTO_SW_KEYS.indexOf(k);
                    const v = swStored ? autoReadBack(swKey(i, t)) : undefined;
                    if (v === undefined) autoPush(swKey(i, t), mod.p[k]);
                    else mod.p[k] = clampParam(k, Math.round(v));
                }
                if (mod.p.loopEnd < mod.p.loopStart + 0.05) mod.p.loopEnd = Math.min(1, mod.p.loopStart + 0.05);
                const en = autoReadBack(autoKey(i, AUTO_PARAMS));
                if (en === undefined) autoPush(autoKey(i, AUTO_PARAMS), mod.enabled ? 1 : 0);
                else mod.enabled = en >= 0.5 ? 1 : 0;
            }
            for (const m of api.state.mappings) {
                const k = slotOf[m.id];
                if (k === undefined || k >= AUTO_DEPTH_SLOTS) continue;
                const v = autoReadBack("ad_" + k);
                if (v === undefined) autoPushDepth(m);
                else m.depth = clamp(v / 100, 0, 1);
            }
            flushEngine();
            for (const m of api.state.mappings) writeMappingTable(m);
            for (let i = 0; i < MAX_MODS; i++) syncMappingsFor(i);
            for (let k = 0; k < AUTO_DEPTH_SLOTS; k++) if (!mappingInSlot()[k] && autoReadBack("ad_" + k) === undefined) autoPush("ad_" + k, 100);
            if (!swStored) autoPush("ap_marker", 2);
            fire("mods");
        } else {
            autoPushAll(true);
            autoPush("ap_marker", 2);
        }
    }
    function writeDepthTables() {
        for (const id of Object.keys(depthPending)) {
            delete depthPending[id];
            const m = api.getMapping(Number(id));
            if (m) writeMappingTable(m);
        }
        depthLast = nowFn();
    }
    // automation can move a depth faster than a table is worth rewriting: at most one rewrite per DEPTH_THROTTLE_MS, trailing edge kept
    function scheduleDepthTable(m) {
        depthPending[m.id] = true;
        if (nowFn() - depthLast >= DEPTH_THROTTLE_MS) { writeDepthTables(); return; }
        if (typeof Task === "undefined") { writeDepthTables(); return; }
        if (!depthTask) depthTask = new Task(writeDepthTables, MM_THIS);
        depthTask.interval = DEPTH_THROTTLE_MS;
        depthTask.cancel();
        depthTask.schedule(DEPTH_THROTTLE_MS);
    }
    // Live -> model: a modulator control moved by automation / macro / MIDI / the parameter list
    api._autoParamIn = function (idx, v) {
        const key = "ap_" + idx;
        const echo = autoIsEcho(key, v);
        if (!autoOn || echo || autoFrozen) return;
        const slot = Math.floor(idx / AUTO_PER_SLOT);
        const j = idx % AUTO_PER_SLOT;
        const mod = api.state.mods[slot];
        if (!mod || slot >= MAX_MODS) return;
        if (j === AUTO_PARAMS) {
            const en = v >= 0.5 ? 1 : 0;
            if (mod.enabled === en) return;
            mod.enabled = en;
            writeCfgSlot(slot);
            syncMappingsFor(slot);
            fire("param", slot);
            return;
        }
        const k = AUTO_KEYS[mod.type][j];
        if (!k) return;
        const val = clampParam(k, autoValue(k, v / 100));
        if (mod.p[k] === val) return;
        mod.p[k] = val;
        if (k === "loopStart" && mod.p.loopEnd < val + 0.05) mod.p.loopEnd = Math.min(1, val + 0.05);
        if (k === "loopEnd" && val < mod.p.loopStart + 0.05) mod.p.loopStart = Math.max(0, val - 0.05);
        writeCfgSlot(slot);
        fire("param", slot);
    };
    // Live -> model: a switch parameter (LFO shape, SYNC / BIP / RTG / 1SH / LOOP) moved by automation / macro / MIDI / a face click
    api._autoSwitchIn = function (idx, v) {
        const key = "at_" + idx;
        const echo = autoIsEcho(key, v);
        if (!autoOn || echo || autoFrozen) return;
        const slot = Math.floor(idx / AUTO_SW_PER_SLOT);
        const t = idx % AUTO_SW_PER_SLOT;
        const mod = slot < MAX_MODS ? api.state.mods[slot] : null;
        if (!mod) return;
        const k = AUTO_SW_KEYS[t];
        if (autoSwitchIndex(mod.type, k) < 0) return;
        const val = clampParam(k, Math.round(v));
        if (mod.p[k] === val) return;
        mod.p[k] = val;
        writeCfgSlot(slot);
        fire("param", slot);
    };
    // Live -> model: the Depth of the mapping in pool slot k
    api._autoDepthIn = function (k, v) {
        const key = "ad_" + k;
        const echo = autoIsEcho(key, v);
        if (!autoOn || echo) return;
        const m = mappingInSlot()[k];
        if (!m) return;
        const d = clamp(v / 100, 0, 1);
        if (Math.abs(m.depth - d) < 1e-6) return;
        m.depth = d;
        scheduleDepthTable(m);
        fire("mapping", m.mod, m.id);
    };
    api._autoMarkerIn = function (v) { autoCache["ap_marker"] = v; };
    api.autoInfo = function () {
        return { on: autoOn, cache: Object.assign({}, autoCache), init: autoInitInfo };
    };

    // ---------------------------------------------------------------- parameter faces (Live's native right-click menu)
    // Live shows Show Automation / Map to Macro / Edit MIDI Map only for a real live.* object under the mouse, and the v8ui draws every
    // control itself. So each pool object is also a TRANSPARENT FACE (presentation, hidden, parked 1x1 in the saved file) that the UI
    // moves over the control it belongs to: faceApply({key: [x, y, w, h]}) in v8ui-local pixels shows exactly those objects at their
    // rect (+ the v8ui's presentation origin) and hides every other one. Only objects whose rect / visibility changed are touched.
    // Faces are only shown once the pool is live (autoOn): before that a drag would be dropped by autop().
    const faceCache = {}; // key -> "x,y,w,h" while shown (absent = hidden / parked as saved)
    let faceOrigin = null; // [x, y] of the main v8ui's presentation rect (re-read when the width changes)
    const faceStats = { applies: 0, setattrs: 0 };
    function faceOriginXY() {
        if (faceOrigin) return faceOrigin;
        let o = [4, 4];
        const p = patcher();
        try {
            const ui = p && p.getnamed ? p.getnamed("obj-viz") : null;
            const r = ui ? ui.getattr("presentation_rect") : null;
            if (Array.isArray(r) && r.length >= 2) o = [Number(r[0]), Number(r[1])];
        } catch (e) {}
        faceOrigin = o;
        return o;
    }
    /** @returns {{bringtofront?: (box: any) => void}} the device patcher (Max's Patcher also has bringtofront, which @types/maxmsp lacks) */
    function p0() { return /** @type {any} */ (patcher()) || {}; }
    api.faceApply = function (want) {
        want = autoOn ? want || {} : {};
        faceStats.applies++;
        let changed = 0;
        const o = faceOriginXY();
        for (const k of Object.keys(faceCache)) {
            if (want[k]) continue;
            const b = autoBox(k);
            if (b) { try { b.setattr("hidden", 1); b.setattr("presentation_rect", 0, 0, 1, 1); } catch (e) {} faceStats.setattrs += 2; changed++; }
            delete faceCache[k];
        }
        for (const k of Object.keys(want)) {
            const r = want[k];
            const x = Math.round((o[0] + r[0]) * 100) / 100, y = Math.round((o[1] + r[1]) * 100) / 100;
            const w = Math.round(r[2] * 100) / 100, h = Math.round(r[3] * 100) / 100;
            const sig = x + "," + y + "," + w + "," + h;
            if (faceCache[k] === sig) continue;
            const b = autoBox(k);
            if (!b) continue;
            const wasHidden = faceCache[k] === undefined;
            try {
                b.setattr("presentation_rect", x, y, w, h);
                if (wasHidden) {
                    b.setattr("hidden", 0);
                    // z-order: Live loads the patcher with obj-viz LAST in the object chain (measured: v8ui index 1382 of 1383, faces
                    // ~300), i.e. in front of every saved face, so a face must be brought to the front to get the click
                    if (typeof p0().bringtofront === "function") p0().bringtofront(b);
                }
            } catch (e) { dlog("faceApply failed", k, String(e)); continue; }
            faceStats.setattrs += wasHidden ? 2 : 1;
            faceCache[k] = sig;
            changed++;
        }
        return changed;
    };
    api.faceState = function () { return { shown: Object.assign({}, faceCache), stats: Object.assign({}, faceStats), origin: faceOrigin }; };
    api.autoKeyFor = function (slot, j) { return autoKey(slot, j); };
    api.autoSwKeyFor = function (slot, t) { return swKey(slot, t); };

    // ---------------------------------------------------------------- LOM access
    function scratchApi() {
        if (typeof LiveAPI === "undefined") return null;
        if (!scratch) scratch = new LiveAPI(function () {}, "live_set");
        return scratch;
    }
    function stripQuotes(s) {
        return String(s === undefined || s === null ? "" : s).replace(/^["']+|["']+$/g, "").trim();
    }
    function lomIface() {
        const a = scratchApi();
        const goto2 = function (path) { try { a.goto(path); return Number(a.id) > 0; } catch (e) { return false; } };
        return {
            exists: function (path) { return !!a && goto2(path); },
            name: function (path) {
                if (!a || !goto2(path)) return "";
                const n = a.get("name");
                return stripQuotes(Array.isArray(n) ? n[0] : n);
            },
            count: function (path, child) {
                if (!a || !goto2(path)) return 0;
                return Number(a.getcount(child)) || 0;
            },
        };
    }
    function describeParameter(id) {
        if (typeof LiveAPI === "undefined") return null;
        let a = null;
        try { a = new LiveAPI(function () {}, "id " + id); } catch (e) { dlog("describeParameter: LiveAPI(id) threw", String(e)); return null; }
        dlog("describeParameter probe", { want: id, id: a.id, path: a.path, unquotedpath: a.unquotedpath, type: a.type });
        if (!(Number(a.id) > 0)) return null;
        const path = stripQuotes(a.unquotedpath || a.path);
        const nm = a.get("name");
        const paramName = stripQuotes(Array.isArray(nm) ? nm[0] : nm);
        const devPath = path.replace(/ parameters \d+$/, "");
        const tm = /^live_set (?:tracks \d+|return_tracks \d+|master_track)/.exec(path);
        const lom = lomIface();
        return {
            id: Number(id), path, name: paramName, paramName,
            deviceName: devPath !== path ? lom.name(devPath) : "",
            trackName: tm ? lom.name(tm[0]) : "",
        };
    }
    function resolveMappingTargets() {
        const lom = lomIface();
        for (const m of api.state.mappings) {
            const r = resolveTarget(m.target, lom);
            if (r.ok) {
                m.target.path = r.path;
                const a = scratchApi();
                try { a.goto(r.path); pidCache[m.id] = Number(a.id) || 0; } catch (e) { pidCache[m.id] = 0; }
                missing[m.id] = pidCache[m.id] > 0 ? false : true;
            } else {
                pidCache[m.id] = 0;
                missing[m.id] = true;
            }
        }
    }
    // Slow poll: detect deleted / moved targets, and revive missing ones when they come back.
    function validateTargets() {
        if (!lomReady || !api.state.mappings.length) return;
        const a = scratchApi();
        if (!a) return;
        const lom = lomIface();
        let changed = false;
        for (const m of api.state.mappings) {
            const pid = lomPid(m);
            let ok = false;
            if (pid > 0) {
                try { a.goto("id " + pid); ok = Number(a.id) === pid && stripQuotes(a.unquotedpath || a.path) === m.target.path; } catch (e) { ok = false; }
            }
            if (ok) continue;
            const r = resolveTarget(m.target, lom);
            let newPid = 0;
            if (r.ok) { try { a.goto(r.path); newPid = Number(a.id) || 0; } catch (e) { newPid = 0; } }
            const nowMissing = newPid <= 0;
            if (newPid !== pid || nowMissing !== !!missing[m.id]) {
                if (r.ok) m.target.path = r.path;
                pidCache[m.id] = newPid;
                missing[m.id] = nowMissing;
                syncMapping(m);
                changed = true;
            }
        }
        if (changed) fire("targets");
    }

    // ---------------------------------------------------------------- learn
    function onSelectedParameter() {
        // LiveAPI observers pass ONE array (["selected_parameter", "id", N]); flatten so spread args work too.
        const raw = Array.prototype.slice.call(arguments);
        try { dlog("selected_parameter callback raw", raw.map((a) => (a && typeof a === "object" && !Array.isArray(a) ? "[object " + (a.constructor && a.constructor.name) + "]" : a))); } catch (e) {}
        const args = [].concat.apply([], raw.map((a) => (Array.isArray(a) ? a : [a])));
        let id = 0;
        for (let i = 0; i < args.length; i++) {
            if (args[i] === "id" && i + 1 < args.length) { id = Number(args[i + 1]) || 0; break; }
        }
        // Never touch the LOM or script objects inside a Live notification: defer to the next tick.
        if (typeof Task !== "undefined" && !api._syncLearn) {
            const t = new Task(function () { try { api._selectionChanged(id); } catch (e) { dlog("selectionChanged threw", String(e)); } }, MM_THIS);
            t.schedule(0);
        } else {
            api._selectionChanged(id);
        }
    }
    api._selectionChanged = function (id) {
        dlog("selectionChanged id", id, "last", lastSelectedId, "learn", api.learn);
        if (id === lastSelectedId) return;
        lastSelectedId = id;
        if (!api.learn.armed || !id) return;
        const info = describeParameter(id);
        dlog("describeParameter", info);
        if (!info) return;
        if (isSelfTarget(info.path, selfPath)) { dlog("ignored: own parameter", info.path, "self", selfPath); return; }
        if (allocSlot() < 0) {
            dlog("learn: mapping pool full", MAX_MAPPINGS);
            fire("full", api.learn.mod);
            if (!api.learn.multi) api.disarmLearn();
            return;
        }
        const mapping = api.addMapping(api.learn.mod, info);
        dlog("addMapping ->", mapping ? { id: mapping.id, mod: mapping.mod, mode: mapping.mode, target: mapping.target } : "NULL (duplicate/self/no mod)");
        if (mapping) {
            pidCache[mapping.id] = info.id;
            missing[mapping.id] = false;
            syncMapping(mapping);
            fire("mapping", mapping.mod, mapping.id);
        }
        if (!api.learn.multi) api.disarmLearn();
    };
    api.armLearn = function (i, multi) {
        dlog("armLearn", i, "multi", !!multi, "modExists", !!api.state.mods[i]);
        if (!api.state.mods[i]) return;
        api.learn = { armed: true, mod: i, multi: !!multi };
        fire("learn", i);
    };
    api.disarmLearn = function () {
        dlog("disarmLearn");
        api.learn = { armed: false, mod: -1, multi: false };
        fire("learn");
    };

    // ---------------------------------------------------------------- modulators
    api.modCount = function () {
        return api.state.mods.filter(Boolean).length;
    };
    api.freeSlot = function () {
        return api.state.mods.indexOf(null);
    };
    api.addModulator = function (type, slot) {
        const s = slot === undefined ? api.freeSlot() : slot;
        if (s < 0 || s >= MAX_MODS || api.state.mods[s]) return -1;
        api.state.mods[s] = makeModSlot(clamp(Math.round(type), 1, 5), s);
        writeCfgSlot(s); writeMsegSlot(s); writeStepsSlot(s);
        autoPushSlot(s);
        fire("mods", s);
        api.commit();
        return s;
    };
    // opts.noUndo: internal (undo / redo themselves); everything else is recorded on the undo stack
    api.removeModulator = function (i, opts) {
        const mod = api.state.mods[i];
        if (!mod) return;
        const entry = { kind: "mod", slot: i, mod: cloneJson(mod), maps: api.state.mappings.filter((x) => x.mod === i).map(snapMapping), label: mod.name };
        for (const m of api.state.mappings.filter((x) => x.mod === i)) removeMappingInternal(m);
        api.state.mods[i] = null;
        if (api.learn.mod === i) api.disarmLearn();
        writeCfgSlot(i); writeMsegSlot(i); writeStepsSlot(i);
        if (!(opts && opts.noUndo)) pushUndo(entry);
        fire("mods", i);
        api.commit();
    };
    api.setModType = function (i, type) {
        const m = api.state.mods[i];
        if (!m) return;
        const keep = { name: m.name, color: m.color, enabled: m.enabled };
        const fresh = makeModSlot(clamp(Math.round(type), 1, 5), i);
        fresh.name = keep.name; fresh.color = keep.color; fresh.enabled = keep.enabled;
        api.state.mods[i] = fresh;
        writeCfgSlot(i); writeMsegSlot(i); writeStepsSlot(i);
        autoPushSlot(i);
        fire("mod", i);
        api.commit();
    };
    api.setParam = function (i, key, v) {
        const m = api.state.mods[i];
        if (!m || MOD_PARAM_KEYS.indexOf(key) < 0) return;
        const val = clampParam(key, v);
        if (key === "enabled") m.enabled = val;
        else m.p[key] = val;
        if (key === "loopStart" && m.p.loopEnd < m.p.loopStart + 0.05) m.p.loopEnd = Math.min(1, m.p.loopStart + 0.05);
        if (key === "loopEnd" && m.p.loopEnd < m.p.loopStart + 0.05) m.p.loopStart = Math.max(0, m.p.loopEnd - 0.05);
        writeCfgSlot(i);
        if (key === "enabled") syncMappingsFor(i);
        autoPushKey(i, key); // UI -> Live parameter (messaged, so automation records it)
        fire("param", i);
        markDirty();
    };
    api.setName = function (i, s) {
        if (!api.state.mods[i]) return;
        api.state.mods[i].name = String(s).slice(0, 32);
        fire("mod", i);
        markDirty();
    };
    api.setColor = function (i, idx) {
        if (!api.state.mods[i]) return;
        api.state.mods[i].color = clamp(Math.round(idx), 0, MOD_COLORS.length - 1);
        fire("mod", i);
        markDirty();
    };
    api.setSteps = function (i, arr) {
        const m = api.state.mods[i];
        if (!m || !Array.isArray(arr)) return;
        for (let k = 0; k < STEPS_MAX; k++) if (k < arr.length) m.stepVals[k] = clamp(num(arr[k], 0), 0, 1);
        writeStepsSlot(i);
        fire("param", i);
        markDirty();
    };
    api.setStep = function (i, k, v) {
        const m = api.state.mods[i];
        if (!m || k < 0 || k >= STEPS_MAX) return;
        m.stepVals[k] = clamp(num(v, 0), 0, 1);
        poke(BUF_STEPS, i * STEPS_MAX + k, [m.stepVals[k]]);
        fire("param", i);
        markDirty();
    };
    api.setMsegPoints = function (i, pts) {
        const m = api.state.mods[i];
        if (!m) return;
        m.points = sanitizeMsegPoints(pts);
        writeMsegSlot(i);
        fire("param", i);
        markDirty();
    };
    api.retrigger = function (i) {
        rtrgCounter = (rtrgCounter % 100000) + 1;
        if (typeof outlet === "function") outlet(0, "gen", "rtrg", rtrgCounter * 16 + clamp(Math.round(i), 0, 15));
    };

    // ---------------------------------------------------------------- mappings
    api.allMappings = function () { return api.state.mappings; };
    api.mappingsFor = function (i) { return api.state.mappings.filter((m) => m.mod === i); };
    api.getMapping = function (id) {
        for (const m of api.state.mappings) if (m.id === id) return m;
        return null;
    };
    api.addMapping = function (i, target) {
        if (!api.state.mods[i]) return null;
        const t = sanitizeTarget(target);
        if (target && target.id) t.id = target.id;
        if (findDuplicateMapping(api.state.mappings, i, t)) return null;
        if (selfPath && isSelfTarget(t.path, selfPath)) return null;
        if (allocSlot() < 0) { dlog("addMapping refused: pool full", MAX_MAPPINGS); fire("full", i); return null; }
        const m = defaultMapping(api.state.nextMapId++, i, t, api.state.settings.defaultMode);
        api.state.mappings.push(m);
        if (target && target.id) { pidCache[m.id] = Number(target.id); missing[m.id] = false; }
        syncMapping(m);
        fire("mapping", i, m.id);
        api.commit();
        return m;
    };
    api.MAX_MAPPINGS = MAX_MAPPINGS;
    api.mappingCapacity = function () {
        const used = Object.keys(slotOf).length;
        return { used, max: MAX_MAPPINGS, free: MAX_MAPPINGS - used };
    };
    api.mappingSlot = function (id) {
        return slotOf[id] === undefined ? -1 : slotOf[id];
    };
    api.updateMapping = function (id, patch) {
        const m = api.getMapping(id);
        if (!m || !patch) return;
        const merged = sanitizeMapping(Object.assign({}, m, patch, { id: m.id, target: m.target }));
        const oldMod = m.mod;
        for (const k of ["mod", "enabled", "mode", "polarity", "range", "depth", "min", "max", "shape"]) m[k] = merged[k];
        if (!api.state.mods[m.mod]) m.mod = oldMod;
        syncMapping(m);
        fire("mapping", m.mod, m.id);
        markDirty();
    };
    function removeMappingInternal(m) {
        releaseMappingSlot(m);
        const i = api.state.mappings.indexOf(m);
        if (i >= 0) api.state.mappings.splice(i, 1);
        delete pidCache[m.id];
        delete missing[m.id];
    }
    api.deleteMapping = function (id, opts) {
        const m = api.getMapping(id);
        if (!m) return;
        const entry = { kind: "map", maps: [snapMapping(m)], label: m.target.paramName || m.target.name || "mapping" };
        removeMappingInternal(m);
        if (!(opts && opts.noUndo)) pushUndo(entry);
        fire("mapping", m.mod, id);
        api.commit();
    };

    // ---------------------------------------------------------------- undo / redo of deletes
    // Deleting a modulator (with all its mappings) or a single mapping is recorded as an exact snapshot: the modulator slot and
    // settings, each mapping (id, target, shape, ...) at its original list index, its Live parameter id, its missing flag and its
    // pool slot. Undo puts all of it back (re-binding the pool slots and ids through syncMapping) and redo deletes it again.
    // A new delete clears the redo stack; the undo stack keeps the last UNDO_MAX entries.
    const UNDO_MAX = 16;
    let undoStack = [];
    let redoStack = [];
    function cloneJson(o) {
        return JSON.parse(JSON.stringify(o));
    }
    function snapMapping(m) {
        return { index: api.state.mappings.indexOf(m), m: cloneJson(m), pid: pidCache[m.id] || 0, missing: !!missing[m.id], slot: slotOf[m.id] === undefined ? -1 : slotOf[m.id] };
    }
    function pushUndo(entry) {
        undoStack.push(entry);
        if (undoStack.length > UNDO_MAX) undoStack.shift();
        redoStack = [];
        fire("undo");
    }
    function restoreMappings(maps, modSlot) {
        const used = {};
        for (const k of Object.keys(slotOf)) used[slotOf[k]] = true;
        const restored = [];
        for (const sn of maps.slice().sort((a, b) => a.index - b.index)) {
            if (api.getMapping(sn.m.id)) continue;
            const m = cloneJson(sn.m);
            if (modSlot !== undefined) m.mod = modSlot;
            api.state.mappings.splice(clamp(sn.index, 0, api.state.mappings.length), 0, m);
            if (sn.pid) pidCache[m.id] = sn.pid;
            missing[m.id] = sn.missing;
            let k = sn.slot;
            if (k < 0 || used[k]) k = allocSlot();
            if (k >= 0) { slotOf[m.id] = k; used[k] = true; }
            restored.push(m);
        }
        for (const m of restored) syncMapping(m);
        return restored;
    }
    function applyUndo(e) {
        if (e.kind === "mod") {
            let s = e.slot;
            if (api.state.mods[s]) s = api.freeSlot();
            if (s < 0) return false;
            e.slot = s;
            api.state.mods[s] = cloneJson(e.mod);
            writeCfgSlot(s); writeMsegSlot(s); writeStepsSlot(s);
            autoPushSlot(s);
            restoreMappings(e.maps, s);
            fire("mods", s);
        } else {
            const mod = e.maps[0].m.mod;
            if (!api.state.mods[mod]) return false;
            const r = restoreMappings(e.maps);
            fire("mapping", mod, r.length ? r[0].id : 0);
        }
        api.commit();
        return true;
    }
    function applyRedo(e) {
        if (e.kind === "mod") {
            if (!api.state.mods[e.slot]) return false;
            e.mod = cloneJson(api.state.mods[e.slot]);
            e.maps = api.state.mappings.filter((x) => x.mod === e.slot).map(snapMapping);
            api.removeModulator(e.slot, { noUndo: true });
        } else {
            const m = api.getMapping(e.maps[0].m.id);
            if (!m) return false;
            e.maps = [snapMapping(m)];
            api.deleteMapping(m.id, { noUndo: true });
        }
        return true;
    }
    // Undo the last delete -> {kind, slot (modulator), ids (mappings)} or null when there is nothing (or it can't be restored)
    api.undo = function () {
        const e = undoStack.pop();
        if (!e) return null;
        if (!applyUndo(e)) return null;
        redoStack.push(e);
        fire("undo");
        return { kind: e.kind, slot: e.kind === "mod" ? e.slot : e.maps[0].m.mod, ids: e.maps.map((x) => x.m.id) };
    };
    api.redo = function () {
        const e = redoStack.pop();
        if (!e) return null;
        if (!applyRedo(e)) return null;
        undoStack.push(e);
        fire("undo");
        return { kind: e.kind, slot: e.kind === "mod" ? e.slot : e.maps[0].m.mod, ids: e.maps.map((x) => x.m.id) };
    };
    api.undoInfo = function () {
        const top = undoStack.length ? undoStack[undoStack.length - 1] : null;
        return { undo: undoStack.length, redo: redoStack.length, max: UNDO_MAX, label: top ? top.label : "", kind: top ? top.kind : "" };
    };
    api.clearUndo = function () {
        undoStack = [];
        redoStack = [];
    };

    // ---------------------------------------------------------------- device-global settings (Options panel)
    // smoothMs -> `smooth <ms>` to every router (patch: route width gen smooth), rateMul -> `gen ratemul <x>` to the engine.
    api.getSettings = function () { return api.state.settings; };
    api.sendSettings = function () {
        if (typeof outlet !== "function") return;
        outlet(0, "smooth", api.state.settings.smoothMs);
        outlet(0, "gen", "ratemul", api.state.settings.rateMul);
    };
    api.setSettings = function (patch) {
        const next = sanitizeSettings(Object.assign({}, api.state.settings, patch || {}));
        const old = api.state.settings;
        api.state.settings = next;
        if (typeof outlet === "function") {
            if (next.smoothMs !== old.smoothMs) outlet(0, "smooth", next.smoothMs);
            if (next.rateMul !== old.rateMul) outlet(0, "gen", "ratemul", next.rateMul);
        }
        fire("settings");
        markDirty();
    };
    // ---------------------------------------------------------------- UI state, width, aux
    api.setUI = function (patch) {
        Object.assign(api.state.ui, patch || {});
        fire("ui");
        markDirty();
    };
    api.getUI = function () { return api.state.ui; };
    api.requestWidth = function (w) {
        reqWidth = clampWidth(w);
        faceOrigin = null;
        resizeFace(reqWidth);
        if (typeof outlet === "function") outlet(0, "width", reqWidth);
    };
    // Grow/shrink the main v8ui and the full-width background panels with the
    // device, keeping the v8ui's left inset as its right margin too.
    function resizeFace(w) {
        const p = patcher();
        if (!p || typeof p.getnamed !== "function") return;
        try {
            const ui = p.getnamed("obj-viz");
            if (ui) {
                const r = ui.getattr("presentation_rect");
                if (Array.isArray(r) && r.length >= 4) ui.setattr("presentation_rect", r[0], r[1], Math.max(1, w - 2 * r[0]), r[3]);
            }
            for (let i = 0; i < 8; i++) {
                const pn = p.getnamed("obj-panel-" + i);
                if (!pn) break;
                const r = pn.getattr("presentation_rect");
                if (Array.isArray(r) && r.length >= 4 && r[0] === 0) pn.setattr("presentation_rect", 0, r[1], w, r[3]);
            }
        } catch (e) {}
    }
    api.emitAux = function () {
        if (typeof outlet === "function") outlet.apply(null, [1].concat(Array.prototype.slice.call(arguments)));
    };

    // ---------------------------------------------------------------- telemetry
    api.readTelemetry = function () {
        const b = buf(BUF_SCOPE);
        if (!b) return tel;
        let a = null;
        try { a = b.peek(1, 0, SCOPE_SAMPS); } catch (e) { a = null; }
        if (!a || !a.length) return tel;
        tel.frame = a[SCOPE_FRAME];
        tel.bpm = a[SCOPE_BPM];
        tel.beat = a[SCOPE_BEAT];
        tel.playing = a[SCOPE_PLAYING];
        for (let i = 0; i < MAX_MODS; i++) {
            const t = tel.mods[i];
            t.out = a[i * SCOPE_STRIDE]; t.phase = a[i * SCOPE_STRIDE + 1];
            t.u = a[i * SCOPE_STRIDE + 2]; t.aux = a[i * SCOPE_STRIDE + 3];
        }
        return tel;
    };
    function pollTelemetry() {
        const t = api.readTelemetry();
        for (const fn of listeners.telemetry) { try { fn(t); } catch (e) {} }
        if (typeof uiTelemetry === "function") { try { uiTelemetry(t); } catch (e) {} }
        redraw();
    }
    function startTasks() {
        if (typeof Task === "undefined") return;
        if (!telTask) { telTask = new Task(pollTelemetry, MM_THIS); telTask.interval = 33; telTask.repeat(); }
        if (!valTask) { valTask = new Task(validateTargets, MM_THIS); valTask.interval = 1500; valTask.repeat(); }
    }

    // ---------------------------------------------------------------- lifecycle
    function fireReady() {
        if (readyFired || !names || !lomReady) return;
        readyFired = true;
        autoInit();
        redraw(); // the faces appear once the pool is live
        for (const fn of listeners.ready) { try { fn(); } catch (e) {} }
        if (typeof uiReady === "function") { try { uiReady(); } catch (e) { post2("uiReady: " + e); } }
        api.sendSettings();
        if (reqWidth) api.requestWidth(reqWidth);
        startTasks();
    }
    api._setNames = function (cfg, mseg, steps, scope, curve, route) {
        names = {};
        names[BUF_CFG] = cfg; names[BUF_MSEG] = mseg; names[BUF_STEPS] = steps; names[BUF_SCOPE] = scope; names[BUF_CURVE] = curve;
        names[BUF_ROUTE] = route;
        dlog("setnames", names);
        bufs = {};
        flushEngine();
        flushRoute();
        api.sendSettings();
        if (lomReady) { rebuildAllSlots(); }
        fireReady();
    };
    api._initLom = function () {
        if (typeof LiveAPI !== "undefined") {
            try {
                const me = new LiveAPI(function () {}, "this_device");
                selfPath = stripQuotes(me.unquotedpath || me.path);
            } catch (e) { selfPath = ""; }
            try {
                selObserver = new LiveAPI(onSelectedParameter, "live_set view");
                selObserver.property = "selected_parameter";
                dlog("observer created; live_set view id", selObserver.id, "current", selObserver.get("selected_parameter"));
            } catch (e) { post2("selected_parameter observer failed: " + e); }
        }
        lomReady = true;
        dlog("init_lom selfPath", selfPath, "mappings", api.state.mappings.length);
        resolveMappingTargets();
        if (names) rebuildAllSlots();
        if (reqWidth) api.requestWidth(reqWidth);
        fireReady();
        fire("targets");
    };
    api.load = function (list) {
        const s = deserializeState(list);
        if (!s) return false;
        api.state = s;
        undoStack = [];
        redoStack = [];
        if (api.learn.armed) api.learn = { armed: false, mod: -1, multi: false };
        pidCache = {};
        missing = {};
        slotOf = {};
        for (const m of api.state.mappings) { const k = allocSlot(); if (k >= 0) slotOf[m.id] = k; }
        flushEngine();
        api.sendSettings();
        if (lomReady) { resolveMappingTargets(); if (names) rebuildAllSlots(); }
        if (autoOn) autoPushAll(true); // a preset / undo load after ready: the blob wins, the params follow
        fire("load");
        if (reqWidth) api.requestWidth(reqWidth);
        return true;
    };
    api.save = function () {
        return serializeState(api.state);
    };
    api.demo = function () {
        const s = defaultState();
        const types = [MOD_LFO, MOD_ENV, MOD_RANDOM, MOD_STEPS, MOD_MSEG];
        for (let i = 0; i < types.length; i++) s.mods[i] = makeModSlot(types[i], i);
        s.mods[0].p.shape = 1;
        for (let k = 0; k < 3; k++) {
            s.mappings.push(defaultMapping(s.nextMapId++, 0, { path: "live_set tracks 0 devices 0 parameters " + (k + 1), paramName: "Param " + (k + 1), deviceName: "Device", trackName: "Track" }));
        }
        s.mappings.push(defaultMapping(s.nextMapId++, 1, { path: "live_set tracks 1 devices 0 parameters 2", paramName: "Cutoff", deviceName: "Auto Filter", trackName: "Bass" }));
        api.state = s;
        for (let i = 0; i < 5; i++) {
            tel.mods[i].out = Math.sin(i * 1.7);
            tel.mods[i].u = (tel.mods[i].out + 1) / 2;
            tel.mods[i].phase = (i * 0.23) % 1;
        }
        return s;
    };
    api._test = {
        slotOf: function () { return slotOf; },
        bound: function () { return bound; },
        route: function (slot) { const b = buf(BUF_ROUTE); if (!b) return null; try { return b.peek(1, 2 * slot, 1)[0]; } catch (e) { return null; } },
        pid: function (id) { return pidCache[id]; },
        missing: function (id) { return !!missing[id]; },
        validate: validateTargets,
        names: function () { return names; },
        lomReady: function () { return lomReady; },
        selfPath: function () { return selfPath; },
        setLomReady: function (v) { lomReady = v; },
        pollTelemetry,
        setNow: function (f) { nowFn = f; },
        flushDepth: writeDepthTables,
        freeze: function (b) { autoFrozen = !!b; },
        autoOn: function () { return autoOn; },
    };
    return api;
})();

// ---- Max entry points owned by the mapper ----
function getvalueof() {
    return MM.save();
}
function setvalueof() {
    const a = typeof arrayfromargs === "function" ? arrayfromargs(arguments) : Array.prototype.slice.call(arguments);
    MM.load(a.length === 1 && Array.isArray(a[0]) ? a[0] : a);
}
// loadmess setnames ---megamodcfg ---megamodmseg ---megamodsteps ---megamodscope ---mmcurve ---megamodroute
function setnames(cfg, mseg, steps, scope, curve, route) {
    MM._setNames(String(cfg), String(mseg), String(steps), String(scope), String(curve), String(route));
}
// live.thisdevice bang (the LOM is ready): observers + target resolution + slot reassignment
function init_lom() {
    MM._initLom();
}

// ---- automatable parameter pool: every saved live.* object outputs through a `prepend` into these (see MM._autoParamIn) ----
function autop(idx, v) { MM._autoParamIn(Number(idx), Number(v)); } // modulator control / On (idx = slot * 6 + j)
function autot(idx, v) { MM._autoSwitchIn(Number(idx), Number(v)); } // switch of a modulator (idx = slot * 6 + t): shape / sync / bipolar / retrig / oneshot / loopOn
function autod(k, v) { MM._autoDepthIn(Number(k), Number(v)); } // Depth of the mapping in pool slot k
function autom(v) { MM._autoMarkerIn(Number(v)); } // "Live has stored the parameter values" marker

// ---- Test hook (global `receive megamod-test`, driven through the Ableton MCP bridge) ----
//   test_learn <mod> <param id>  simulates a single-shot learn of that Live parameter
//   test_report                  writes this instance's mapping state to Global("megamod_test") as
//                                `report_<LOM device id>` and `last` (JSON string)
function test_learn(mod, pid) {
    MM.armLearn(Number(mod), false);
    MM._selectionChanged(Number(pid));
}
// test_poke <mapping id> <value>: send a float straight to the mapping's active live.* object (bypasses the signal path)
function test_poke(id, v) {
    const m = MM.getMapping(Number(id));
    const slot = MM.mappingSlot(Number(id));
    if (!m || slot < 0) { dlog("test_poke: no mapping/slot", id); return; }
    const name = (m.mode === "remote" ? "mm_rem_" : "mm_mod_") + slot;
    let o = null;
    try { o = MM_THIS.patcher.getnamed(name); } catch (e) {}
    dlog("test_poke", id, v, name, o ? o.maxclass : null);
    if (o) { try { o.message("float", Number(v)); } catch (e) { dlog("test_poke failed", String(e)); } }
}
function cordsOf(o) {
    try {
        const pc = o.patchcords;
        const fmt = (arr) => (arr || []).map((x) => ({ obj: x.dstobject ? x.dstobject.maxclass : x.srcobject ? x.srcobject.maxclass : "?", out: x.srcoutlet, in: x.dstinlet }));
        return pc ? { in: fmt(pc.inputs), out: fmt(pc.outputs) } : "no patchcords prop";
    } catch (e) { return "err " + e; }
}
function test_report() {
    if (typeof Global === "undefined") return;
    const t = MM._test;
    const slots = t.slotOf();
    const bnd = t.bound();
    const box = (n) => { try { return MM_THIS.patcher.getnamed(n); } catch (x) { return null; } };
    const rep = {
        self: t.selfPath(), lomReady: t.lomReady(), names: t.names(), capacity: MM.mappingCapacity(),
        mods: MM.state.mods.map((m) => (m ? m.type : null)),
        modP: MM.state.mods.map((m) => (m ? Object.assign({ enabled: m.enabled }, m.p) : null)),
        auto: MM.autoInfo().on,
        ui: MM.getUI(),
        hover: typeof ubHover !== "undefined" && ubHover ? [ubHover.x, ubHover.y] : null, // last mouse position over the v8ui (real-mouse calibration)
        engine: (function () { try { const e = MM_THIS.patcher.getnamed(MM_ENGINE_VARNAME); return e ? { cls: e.maxclass, cords: cordsOf(e) } : null; } catch (x) { return "err " + x; } })(),
        mappings: MM.allMappings().map((m) => {
            const slot = slots[m.id] === undefined ? -1 : slots[m.id];
            const b = slot >= 0 && bnd[slot] ? bnd[slot] : { mod: 0, rem: 0 };
            const mid = slot >= 0 ? box("mm_mid_" + slot) : null, rid = slot >= 0 ? box("mm_rid_" + slot) : null;
            const lm = slot >= 0 ? box("mm_mod_" + slot) : null, lr = slot >= 0 ? box("mm_rem_" + slot) : null;
            return {
                id: m.id, mod: m.mod, mode: m.mode, depth: m.depth, path: m.target.path, status: MM.mappingStatus(m.id), pid: t.pid(m.id),
                slot, route: slot >= 0 ? t.route(slot) : null, idMod: b.mod, idRem: b.rem,
                boxes: { mid: !!mid, rid: !!rid, mod: lm ? lm.maxclass : null, rem: lr ? lr.maxclass : null },
                modCords: lm ? cordsOf(lm) : null, remCords: lr ? cordsOf(lr) : null,
            };
        }),
    };
    let devId = "0";
    try { devId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) {}
    const g = new Global("megamod_test");
    g["report_" + devId] = JSON.stringify(rep);
    g.last = g["report_" + devId];
}

//   test_add <type>              add a modulator of that type (MOD_LFO..MOD_MSEG) in the first free slot
//   test_settype <slot> <type>   change a modulator's type
//   test_remove <slot> / test_undo   delete a modulator (with its mappings) / undo the last delete
//   test_setparam <slot> <key> <v>  MM.setParam (UI path: pushes into the live.* object)
//   test_names                   writes the cached Live parameter names / values this script applied to Global("megamod_test") as `names_<device id>`
//   test_probe <varname>         what the object reports about its attributes (Global("megamod_test").probe)
//   test_rename <varname> <name> <mode>   renaming experiments (modes 0..7, see the function)
function test_add(type) { MM.addModulator(Number(type)); }
function test_settype(slot, type) { MM.setModType(Number(slot), Number(type)); }
// test_freeze <0|1>: drop Live -> model parameter input (the blob then goes stale against the stored parameter values: load-order tests)
function test_freeze(v) { MM._test.freeze(Number(v) !== 0); }
function test_remove(slot) { MM.removeModulator(Number(slot)); }
function test_undo() { MM.undo(); }
// test_selui <slot>: select a modulator (the UI state `sel`); the faces tests use it to detect where a real click lands
function test_selui(slot) { MM.setUI({ sel: Number(slot) }); }
// test_expand <slot>: expand that strip in place (-1 collapses all); the faces tests use it to reach the expanded editor
function test_expand(slot) { ubSetExpanded(Number(slot)); }
function test_setparam(slot, key, v) { MM.setParam(Number(slot), String(key), Number(v)); }
function test_names() {
    if (typeof Global === "undefined") return;
    let devId = "0";
    try { devId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) {}
    const g = new Global("megamod_test");
    g["names_" + devId] = JSON.stringify(MM.autoInfo());
    g.last_names = g["names_" + devId];
}
// test_cls <class> <w> <h>: makes a scratch box of that Max class in the device patcher, sets its presentation rect, and reports the size
// Live / Max really gave it plus its colour / size attribute names (face widget research), then removes it
function test_cls(cls, w, h, par) {
    if (typeof Global === "undefined") return;
    const out = { cls: String(cls), stages: [] };
    let o = null;
    const rect = (label) => { try { out.stages.push(label + " " + JSON.stringify(o.getattr("presentation_rect"))); } catch (e) { out.stages.push(label + " ERR " + e); } };
    try {
        o = MM_THIS.patcher.newdefault(900, 2900, String(cls));
        if (Number(par)) { o.setattr("parameter_enable", 1); o.setattr("_parameter_longname", "scratch_" + cls); }
        o.setattr("presentation", 1);
        o.setattr("hidden", 1);
        o.setattr("presentation_rect", 300, 10, Number(w), Number(h));
        rect("hidden, set");
        o.setattr("hidden", 0);
        rect("unhidden");
        o.setattr("presentation_rect", 300, 10, Number(w), Number(h));
        rect("set again");
        out.attrs = o.getattrnames().filter((a) => /color|orient|trian|show|appearance/i.test(a)).join(" ");
    } catch (e) { out.err = String(e); }
    test_cls_obj = o;
    const g = new Global("megamod_test");
    g.cls = JSON.stringify(out);
}
let test_cls_obj = null;
// test_cls_read: the scratch box's rect after the object had time to draw (Live / Max may snap a live.* size then), then removes it
function test_cls_read() {
    if (typeof Global === "undefined") return;
    const out = {};
    try { out.rect = test_cls_obj.getattr("presentation_rect"); } catch (e) { out.err = String(e); }
    try { if (test_cls_obj) MM_THIS.patcher.remove(test_cls_obj); } catch (e) { out.rmErr = String(e); }
    test_cls_obj = null;
    new Global("megamod_test").clsr = JSON.stringify(out);
}
// test_poolrect <varname> <x> <y> <w> <h> / test_poolrect_read <varname>: size experiments on a saved pool object (does Live snap its size?)
function test_poolrect(key, x, y, w, h) {
    try { const o = MM_THIS.patcher.getnamed(String(key)); o.setattr("presentation_rect", Number(x), Number(y), Number(w), Number(h)); o.setattr("hidden", 0); } catch (e) { dlog("test_poolrect", String(e)); }
}
function test_poolrect_read(key) {
    let r = null;
    try { r = MM_THIS.patcher.getnamed(String(key)).getattr("presentation_rect"); } catch (e) { r = "ERR " + e; }
    new Global("megamod_test").pr = JSON.stringify(r);
}
// face z-order / click experiments (Live): test_zorder reports box order of obj-viz and the pool faces; test_alpha <a> sets every colour
// of every pool face to alpha a; test_front brings the shown faces to the front (patcher.bringtofront)
function test_zorder() {
    if (typeof Global === "undefined") return;
    const order = [];
    let b = MM_THIS.patcher.firstobject;
    let i = 0;
    while (b) { const vn = b.varname || ""; if (vn === "MegaModState" || /^a[pd]_\d+$/.test(vn)) order.push([i, vn, b.maxclass]); i++; b = b.nextobject; }
    const viz = order.filter((x) => x[1] === "MegaModState")[0];
    const shown = Object.keys(MM.faceState().shown);
    new Global("megamod_test").zorder = JSON.stringify({ viz: viz, total: i, shown: order.filter((x) => shown.indexOf(x[1]) >= 0), first3: order.slice(0, 3), bringtofront: typeof MM_THIS.patcher.bringtofront });
}
function test_alpha(a) {
    const cols = ["focusbordercolor", "modulationcolor", "slidercolor", "textcolor", "tribordercolor", "tricolor", "trioncolor"];
    for (let i = 0; i < 96; i++) for (const n of ["ap_" + i]) { try { const o = MM_THIS.patcher.getnamed(n); if (i % 6 !== 5) for (const c of cols) o.setattr(c, 0.5, 0.5, 0.5, Number(a)); } catch (e) {} }
}
function test_front() {
    const shown = Object.keys(MM.faceState().shown);
    let n = 0;
    for (const k of shown) { try { MM_THIS.patcher.bringtofront(MM_THIS.patcher.getnamed(k)); n++; } catch (e) { dlog("bringtofront failed", String(e)); } }
    new Global("megamod_test").front = String(n);
}
// test_faces: the parameter faces this script placed, and what Live's objects really report (presentation_rect / hidden), as `faces_<device id>`
function test_faces() {
    if (typeof Global === "undefined") return;
    let devId = "0";
    try { devId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) {}
    const st = MM.faceState();
    const real = {};
    for (const k of Object.keys(st.shown)) {
        try {
            const o = MM_THIS.patcher.getnamed(k);
            real[k] = { rect: o.getattr("presentation_rect"), hidden: o.getattr("hidden"), cls: o.maxclass };
        } catch (e) { real[k] = "ERR " + e; }
    }
    let nHidden = 0;
    try {
        for (let i = 0; i < 96; i++) { const o = MM_THIS.patcher.getnamed("ap_" + i); if (o && o.getattr("hidden")) nHidden++; }
        for (let i = 0; i < AUTO_SW_COUNT; i++) { const o = MM_THIS.patcher.getnamed("at_" + i); if (o && o.getattr("hidden")) nHidden++; }
        for (let i = 0; i < 64; i++) { const o = MM_THIS.patcher.getnamed("ad_" + i); if (o && o.getattr("hidden")) nHidden++; }
    } catch (e) {}
    const g = new Global("megamod_test");
    g["faces_" + devId] = JSON.stringify({ popup: typeof ubPopup !== "undefined" ? !!ubPopup : null, maps: typeof ubMapsPop !== "undefined" ? !!ubMapsPop : null, nmods: MM.state.mods.filter((m) => m).length, paints: typeof ubPaintCount !== "undefined" ? ubPaintCount : -1, hover: typeof ubHover !== "undefined" && ubHover ? [ubHover.x, ubHover.y] : null, shown: st.shown, real: real, stats: st.stats, origin: st.origin, hiddenCount: nHidden });
    g.last_faces = g["faces_" + devId];
}
// test_probe <varname>: what the live.* object says about itself (attribute names with "param", the long / short name attributes)
function test_probe(varname) {
    if (typeof Global === "undefined") return;
    let o = null;
    try { o = MM_THIS.patcher.getnamed(String(varname)); } catch (e) {}
    const out = { found: !!o };
    if (o) {
        try { out.cls = o.maxclass; } catch (e) {}
        try { out.attrs = o.getattrnames().filter((a) => /param|name/i.test(a)); } catch (e) { out.attrsErr = String(e); }
        for (const a of ["_parameter_longname", "_parameter_shortname", "parameter_longname", "varname"]) {
            try { out["get_" + a] = o.getattr(a); } catch (e) { out["get_" + a] = "ERR " + e; }
        }
        try { out.val = o.getvalueof(); } catch (e) { out.val = "ERR " + e; }
    }
    const g = new Global("megamod_test");
    g.probe = JSON.stringify(out);
}
function test_rename(varname, name, mode) {
    let o = null;
    try { o = MM_THIS.patcher.getnamed(String(varname)); } catch (e) {}
    if (!o) { dlog("test_rename: no box", varname); return; }
    const md = Number(mode) || 0;
    const nm = String(name);
    try {
        if (md === 0) { o.setattr("_parameter_longname", nm); o.setattr("_parameter_shortname", nm); }
        else if (md === 1) o.setattr("_parameter_longname", nm);
        else if (md === 2) o.message("_parameter_longname", nm);
        else if (md === 3) { o.setattr("_parameter_longname", nm); o.setattr("_parameter_shortname", nm); o.setattr("annotation_name", nm); }
        else if (md === 4) { o.setattr("_parameter_longname", nm); o.setattr("_parameter_shortname", nm); o.setattr("parameter_enable", 0); o.setattr("parameter_enable", 1); }
        else if (md === 5) { o.setattr("parameter_longname", nm); o.setattr("parameter_shortname", nm); }
        else if (md === 6) { o.message("parameter_longname", nm); o.message("parameter_shortname", nm); }
        else if (md === 7) { o.message("_parameter_longname", nm); o.message("_parameter_shortname", nm); o.message("annotation_name", nm); }
        else if (md === 8) { o.setattr("_parameter_longname", nm); o.setattr("_parameter_shortname", nm); o.setattr("_parameter_invisible", 1); o.setattr("_parameter_invisible", 0); }
        else if (md === 9) { o.setattr("_parameter_longname", nm); o.setattr("_parameter_shortname", nm); o.setattr("parameter_mappable", 0); o.setattr("parameter_mappable", 1); }
        else if (md === 10) { o.setattr("_parameter_longname", nm); o.setattr("_parameter_shortname", nm); o.setattr("_parameter_enable", 0); o.setattr("_parameter_enable", 1); }
        else if (md === 11) { o.setattr("_parameter_longname", nm); o.setattr("_parameter_shortname", nm); o.message("_parameter_invisible", 1); o.message("_parameter_invisible", 0); }
    } catch (e) { dlog("test_rename failed", String(e)); }
}
