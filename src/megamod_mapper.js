// Mega Modulator — v8-side runtime ("MM"). Prepended after src/megamod_config.js into every UI script.
// See the API CONTRACT at the top of src/megamod_config.js for the UI-facing API.
//
// Owns: state, engine buffer writers, the saved mapping-slot pool (route/curve buffers + live id binding),
// learn (selected_parameter observer), target resolution/validation, telemetry polling,
// getvalueof/setvalueof, device width requests. Everything touching Max/Live objects is guarded so the
// script also loads in Node mocks and in the preview renderer.

const MM_THIS = this;
const MM_UI_VARNAME = "MegaModState";
const MM_ENGINE_VARNAME = "megamod_engine";
// Debug trace of learn/mapping. Off by default; set MM_DEBUG_LOG to an absolute path to also mirror it to a file.
// (`let`, so the test hook `test_debug <path>` can switch the trace on at runtime inside Live.)
let MM_DEBUG = false;
let MM_DEBUG_LOG = "";
const mmLogLines = [];
/** @param {...unknown} args */
function dlog(...args) {
    if (!MM_DEBUG) return;
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
    let slotOf = {}; // mapId -> pool slot 0..MAX_MAPPINGS-1 (runtime only; internal self-mappings have none)
    let islotOf = {}; // mapId -> internal matrix route 0..INT_ROUTES-1 (internal self-mappings, runtime; persisted in mapping.slot)
    let bound = {}; // slot -> {mod, rem}: ids last sent to mm_mid_<k> / mm_rid_<k>
    let rtrgCounter = 0;
    let reqWidth = 0;
    let telTask = null;
    let valTask = null;
    let notifyTask = null;
    let pidCache = {}; // mapId -> live id (number), runtime only
    let missing = {}; // mapId -> true
    let seenLive = {}; // mapId -> true once its target resolved in THIS session (only those can be auto-deleted when the target goes away)
    let lostPid = {}; // mapId -> the Live id a mapping lost (probed again while it is missing)
    let missPolls = {}; // mapId -> consecutive validate polls the target was unresolvable (auto-delete needs AUTO_DELETE_POLLS)
    // eff[slot] = {ctl: [5 normalized A..E after internal modulation], on, sw: [6 effective switch values]}; depth[k] = effective Depth 0..1 of pool slot k
    const tel = { frame: 0, bpm: 120, beat: 0, playing: 0, mods: [], eff: [], depth: [] };
    for (let i = 0; i < MAX_MODS; i++) { tel.mods.push({ out: 0, phase: 0, u: 0, aux: 0 }); tel.eff.push({ ctl: [0, 0, 0, 0, 0], on: 1, sw: [0, 0, 0, 0, 0, 0] }); }
    for (let k = 0; k < ROUTER_DEPTH_SLOTS; k++) tel.depth.push(1);

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
        reapplyVia(i); // a control that live.modulate~ is modulating keeps its modulated engine value
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
        for (let i = 0; i < MAX_MODS; i++) reapplyVia(i);
        for (let i = 0; i < MAX_MODS; i++) { writeMsegSlot(i); writeStepsSlot(i); }
        flushInternal();
    }

    // ---------------------------------------------------------------- mapping slots
    function lomPid(m) {
        return pidCache[m.id] || 0;
    }
    function isInternal(m) {
        return !!(m && m.target && m.target.internal === true);
    }
    // a self-mapping whose destination does not exist (the target modulator's type has no such control, or its slot is empty) is MISSING:
    // its route is off (nothing is modulated, no Live id bound) and it revives when the type changes back
    function selfDestMissing(m) {
        // a depth route (schema 10) is missing while its target mapping has no pool slot (deleted / not yet slotted / converted to an internal route)
        if (isDepthRoute(m)) return slotOf[m.target.mapId] === undefined || !api.getMapping(m.target.mapId);
        return isSelfMapping(m) && !selfDestExists(selfDestOf(m), api.state);
    }
    function mappingActive(m) {
        const mod = api.state.mods[m.mod];
        if (isInternal(m)) return !!(m.enabled && mod && mod.enabled && !selfDestMissing(m));
        return !!(m.enabled && mod && mod.enabled && !missing[m.id] && lomPid(m) > 0 && !selfDestMissing(m));
    }
    api.mappingStatus = function (id) {
        const m = api.getMapping(id);
        if (!m) return "missing";
        if (selfDestMissing(m)) return "missing";
        if (isInternal(m)) return mappingActive(m) ? "ok" : "disabled";
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
        for (let k = 0; k < ROUTER_DEPTH_SLOTS; k++) { a[2 * k + 1] = 1; a[ROUTE_DEPTH_BASE + k] = 1; a[ROUTE_DEPTH_MIN + k] = -1; }
        poke(BUF_ROUTE, 0, a);
    }
    // EVERY pool slot (schema 10) applies the Depth in the ROUTER (per sample, so a Depth lane / depth modulation is smooth): its curve
    // table is baked at depth 1 and the base depth (+ the Remote centre (min + max) / 2, or -1 for Mod) lives in the route buffer. The engine copies base
    // -> effective and adds the summed depth-modulation routes. Only the first AUTO_DEPTH_SLOTS slots also have a `Depth k` Live parameter.
    function writeDepthCells(m, slot) {
        if (slot >= ROUTER_DEPTH_SLOTS) return;
        poke(BUF_ROUTE, ROUTE_DEPTH_BASE + slot, [clamp(m.depth, 0, 1)]);
        poke(BUF_ROUTE, ROUTE_DEPTH_MIN + slot, [m.mode === "remote" ? remoteCentre(m) : -1]);
    }
    function unbindSlot(slot) {
        const b = boundOf(slot);
        if (b.mod !== 0) { sendId("mm_mid_", slot, 0); b.mod = 0; }
        if (b.rem !== 0) { sendId("mm_rid_", slot, 0); b.rem = 0; }
    }
    // Drive one slot's ids: release first (mode/target change, or inactive), then bind the active mode's box only.
    // A write that fails (sendId false) is not recorded as bound, so the validate poll's self-heal binds it again.
    function bindSlot(slot, mode, pid) {
        const b = boundOf(slot);
        const wantMod = mode === "mod" ? pid : 0;
        const wantRem = mode === "remote" ? pid : 0;
        if (b.mod !== 0 && b.mod !== wantMod) { sendId("mm_mid_", slot, 0); b.mod = 0; }
        if (b.rem !== 0 && b.rem !== wantRem) { sendId("mm_rid_", slot, 0); b.rem = 0; }
        if (wantMod !== 0 && b.mod !== wantMod) { if (sendId("mm_mid_", slot, wantMod)) b.mod = wantMod; }
        if (wantRem !== 0 && b.rem !== wantRem) { if (sendId("mm_rid_", slot, wantRem)) b.rem = wantRem; }
    }
    function writeMappingTable(m) {
        const slot = slotOf[m.id];
        if (slot === undefined) return;
        poke(BUF_CURVE, slot * CURVE_REGION, mappingTable(Object.assign({}, m, { depth: 1 })));
        writeDepthCells(m, slot);
    }
    // Bring one mapping's slot in line with the model: table, route, ids. Cheap when nothing changed.
    function syncMapping(m) {
        syncMappingBody(m);
        if (!rebuildingAll) rebuildViaDests();
    }
    let rebuildingAll = false;
    function syncMappingBody(m) {
        if (isInternal(m)) { syncInternal(m); return; }
        if (slotOf[m.id] === undefined) {
            const s = allocSlot();
            if (s < 0) { dlog("syncMapping: pool full, map", m.id); return; }
            slotOf[m.id] = s;
        }
        m.slot = slotOf[m.id]; // persisted: the mapping keeps this slot (and its Depth parameter) across saves
        syncDepthRoutesFor(m.id); // depth routes aimed at this mapping follow its (possibly new) pool slot
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
        if (isInternal(m)) { releaseInternal(m); return; }
        const slot = slotOf[m.id];
        if (slot === undefined) return;
        if (patcher() && names) {
            sendId("mm_mid_", slot, 0); sendId("mm_rid_", slot, 0);
            writeRoute(slot, ROUTE_OFF);
        }
        bound[slot] = { mod: 0, rem: 0 };
        delete slotOf[m.id];
        if (slot < AUTO_DEPTH_SLOTS) autoPush("ad_" + slot, 100);
        if (patcher() && names) { poke(BUF_ROUTE, ROUTE_DEPTH_BASE + slot, [1]); poke(BUF_ROUTE, ROUTE_DEPTH_MIN + slot, [-1]); }
        syncDepthRoutesFor(m.id); // its depth routes go off (missing)
    }
    // Rebind every mapping (load / names / LOM ready). Releases everything first. Each mapping gets its saved slot
    // back when it is free, so automation of its "Depth <k>" parameter follows the mapping across deletes and
    // reloads; only mappings without a (valid, unclaimed) saved slot take the lowest free one.
    function rebuildAllSlots() {
        rebuildingAll = true;
        for (const k of Object.keys(bound)) unbindSlot(Number(k));
        slotOf = {};
        bound = {};
        if (names) flushRoute();
        const claimed = {};
        rebuildInternal();
        for (const m of api.state.mappings) {
            if (isInternal(m)) continue;
            if (Number.isInteger(m.slot) && m.slot >= 0 && m.slot < MAX_MAPPINGS && !claimed[m.slot]) {
                claimed[m.slot] = true;
                slotOf[m.id] = m.slot;
            }
        }
        for (const m of api.state.mappings) {
            if (isInternal(m)) continue;
            if (slotOf[m.id] !== undefined) { syncMapping(m); continue; }
            const s = allocSlot();
            if (s < 0) { dlog("rebuildAllSlots: pool full, map", m.id, "left unslotted"); continue; }
            slotOf[m.id] = s;
            syncMapping(m);
        }
        rebuildingAll = false;
        for (const m of api.state.mappings) if (isDepthRoute(m)) syncInternal(m); // every pool slot is known now: re-aim the depth routes
        rebuildViaDests();
    }

    // ---------------------------------------------------------------- internal self-modulation matrix (schema 9, no Live pool slot)
    // An internal self-mapping is a route of the ENGINE's matrix: source modulator -> destination code (selfDestFor) with its 256-sample transfer
    // table (the same mappingTable() as a pool mapping, depth baked in). megamodint[4r..] = [src + 1 | 0, dest, 0, 0], megamodint[256] = highest
    // used route + 1 (0 = the engine skips the whole matrix), megamodicurve[r * 256 ..] = the table.
    function allocInternal() {
        const used = {};
        for (const k of Object.keys(islotOf)) used[islotOf[k]] = true;
        for (let k = 0; k < INT_ROUTES; k++) if (!used[k]) return k;
        return -1;
    }
    function writeInternalCount() {
        let hi = 0;
        for (const k of Object.keys(islotOf)) hi = Math.max(hi, islotOf[k] + 1);
        poke(BUF_INT, INT_COUNT_AT, [hi]);
    }
    function writeInternalRoute(m, off) {
        const r = islotOf[m.id];
        if (r === undefined) return;
        let dest = selfDestOf(m);
        if (isDepthRoute(m)) {
            const ts = slotOf[m.target.mapId];
            if (ts === undefined) { off = true; dest = DEST_DEPTH; } else dest = depthRouteDest(ts);
        }
        poke(BUF_INT, 4 * r, [off ? 0 : m.mod + 1, dest, 0, 0]);
    }
    // depth routes (schema 10) aimed at mapping `mapId`: rewrite their engine destination (the target's pool slot may have changed)
    function syncDepthRoutesFor(mapId) {
        for (const x of api.state.mappings) if (isDepthRoute(x) && x.target.mapId === mapId) syncInternal(x);
    }
    function syncInternal(m) {
        if (islotOf[m.id] === undefined) {
            const r = allocInternal();
            if (r < 0) { dlog("syncInternal: matrix full, map", m.id); return; }
            islotOf[m.id] = r;
        }
        m.slot = islotOf[m.id];
        const r = islotOf[m.id];
        if (!names) return;
        poke(BUF_ICURVE, r * CURVE_REGION, isDepthRoute(m) ? depthFactorTable(m) : mappingTable(m)); // a depth route bakes its unipolar FACTOR m = range * dep * y, 0..range (the engine multiplies them, clips 0..1)
        writeInternalRoute(m, !mappingActive(m));
        writeInternalCount();
    }
    function releaseInternal(m) {
        const r = islotOf[m.id];
        if (r === undefined) return;
        if (names) { poke(BUF_INT, 4 * r, [0, 0, 0, 0]); }
        delete islotOf[m.id];
        if (names) writeInternalCount();
    }
    // (re)assign every internal mapping its saved route (or the lowest free one) and rewrite the whole matrix
    function assignInternalSlots() {
        const claimed = {};
        for (const k of Object.keys(islotOf)) claimed[islotOf[k]] = true;
        for (const m of api.state.mappings) {
            if (isInternal(m) && islotOf[m.id] === undefined && Number.isInteger(m.slot) && m.slot >= 0 && m.slot < INT_ROUTES && !claimed[m.slot]) { claimed[m.slot] = true; islotOf[m.id] = m.slot; }
        }
        for (const m of api.state.mappings) {
            if (isInternal(m) && islotOf[m.id] === undefined) { const r = allocInternal(); if (r >= 0) islotOf[m.id] = r; }
        }
    }
    function rebuildInternal() {
        islotOf = {};
        flushInternal();
    }
    function flushInternal() {
        if (!names) return;
        const hdr = new Array(INT_SAMPS).fill(0);
        const desc = intDescriptorFloats();
        for (let i = 0; i < desc.length; i++) hdr[INT_DESC_AT + i] = desc[i];
        poke(BUF_INT, 0, hdr);
        assignInternalSlots();
        for (const m of api.state.mappings) if (isInternal(m) && islotOf[m.id] !== undefined) syncInternal(m);
        writeInternalCount();
    }
    api.internalCapacity = function () {
        const used = Object.keys(islotOf).length;
        return { used, max: INT_ROUTES, free: INT_ROUTES - used };
    };

    // ---------------------------------------------------------------- VIA LIVE: a pool mapping modulating this device's OWN parameter
    // Measured in Live 12.4.6 (VM, scripts/test_megamod_selfmod_live.js): live.modulate~ on one of the device's own parameters DOES work. The LOM
    // DeviceParameter.value keeps the STORED value (what the model holds), while the parameter's live.dial / live.text / live.tab OUTPUTS the
    // MODULATED value (stored + modulation) into `autop` / `autot` / `autod`. A modulated output therefore must drive the engine but never the
    // model: for the destinations in `viaDests` (an active Mod-mode via-Live self-mapping on them) the incoming value goes to the engine's cfg
    // float (or the Depth cell) only, never to mod.p / m.depth, the undo stack, dirty state or the autoCache; the stored value is re-read from the
    // LOM (`value`, 4 Hz) so a real change of the stored value (face drag, automation, macro) still reaches the model. Remote mappings take the
    // parameter over (its value really moves, like automation), so they use the normal path. The modulation updates at Live's control rate, not per sample.
    let viaDests = {}; // dest code -> true
    const viaVal = {}; // dest code -> the last modulated engine value (re-applied after the cfg slot is rewritten)
    let viaTask = null;
    const viaApis = {}; // dest code -> LiveAPI of the parameter (stored value reads)
    function viaCfgField(code) {
        const d = selfDestInfo(code);
        if (!d || d.kind === "depth") return -1;
        const mod = api.state.mods[d.slot];
        if (!mod) return -1;
        if (d.kind === "on") return CF_ENABLED;
        if (d.kind === "sw") return KEY_CF[AUTO_SW_KEYS[d.ctl]];
        const key = AUTO_KEYS[mod.type][d.ctl];
        return key ? KEY_CF[key] : -1;
    }
    function applyViaValue(code) {
        const d = selfDestInfo(code);
        if (!d || viaVal[code] === undefined) return;
        if (d.kind === "depth") { poke(BUF_ROUTE, ROUTE_DEPTH_BASE + d.ctl, [viaVal[code]]); return; }
        const f = viaCfgField(code);
        if (f >= 0) poke(BUF_CFG, d.slot * CFG_STRIDE + f, [viaVal[code]]);
    }
    function reapplyVia(slot) {
        for (const k of Object.keys(viaDests)) {
            const d = selfDestInfo(Number(k));
            if (d && d.kind !== "depth" && d.slot === slot) applyViaValue(Number(k));
        }
    }
    // the model's value of a destination goes back into the engine (modulation stopped / the mapping went away)
    function restoreDest(code) {
        const d = selfDestInfo(code);
        delete viaVal[code];
        delete viaApis[code];
        if (!d) return;
        if (d.kind === "depth") {
            for (const m of api.state.mappings) if (slotOf[m.id] === d.ctl && !isInternal(m)) writeDepthCells(m, d.ctl);
        } else if (api.state.mods[d.slot]) writeCfgSlot(d.slot);
    }
    function rebuildViaDests() {
        const old = viaDests;
        viaDests = {};
        for (const m of api.state.mappings) {
            if (isSelfMapping(m) && !isInternal(m) && m.mode === "mod" && mappingActive(m)) viaDests[selfDestOf(m)] = true;
        }
        for (const k of Object.keys(old)) if (!viaDests[k]) restoreDest(Number(k));
        const any = Object.keys(viaDests).length > 0;
        if (typeof Task === "undefined") return;
        if (any && !viaTask) { viaTask = new Task(viaReadStored, MM_THIS); viaTask.interval = 250; viaTask.repeat(); }
        if (!any && viaTask) { try { viaTask.cancel(); } catch (e) {} viaTask = null; }
    }
    // the STORED value of a modulated parameter (LOM `value`, in the parameter's own 0..100 percent / enum units)
    function viaStored(code) {
        if (typeof LiveAPI === "undefined" || !lomReady) return undefined;
        if (!viaApis[code]) {
            const path = ownParamPath(selfDestName(code));
            if (!path) return undefined;
            try { viaApis[code] = new LiveAPI(function () {}, path); } catch (e) { return undefined; }
        }
        try {
            const v = viaApis[code].get("value");
            const n = Number(Array.isArray(v) ? v[0] : v);
            return Number.isFinite(n) ? n : undefined;
        } catch (e) { return undefined; }
    }
    function viaReadStored() {
        for (const k of Object.keys(viaDests)) {
            const code = Number(k);
            const v = viaStored(code);
            if (v === undefined) continue;
            const d = selfDestInfo(code);
            // unchanged (within float noise) = nothing to adopt
            let cur = null;
            if (d.kind === "depth") { for (const m of api.state.mappings) if (slotOf[m.id] === d.ctl && !isInternal(m)) cur = 100 * m.depth; }
            else {
                const mod = api.state.mods[d.slot];
                if (mod && d.kind === "on") cur = mod.enabled ? 1 : 0;
                else if (mod && d.kind === "sw") cur = mod.p[AUTO_SW_KEYS[d.ctl]];
                else if (mod && AUTO_KEYS[mod.type][d.ctl]) cur = 100 * autoNorm(AUTO_KEYS[mod.type][d.ctl], mod.p[AUTO_KEYS[mod.type][d.ctl]]);
            }
            if (cur === null || Math.abs(cur - v) < 0.02) continue;
            if (d.kind === "depth") api._autoDepthStored(d.ctl, v);
            else if (d.kind === "sw") api._autoSwitchStored(code - DEST_SW, v);
            else api._autoParamStored(code, v);
        }
    }
    // an incoming (modulated) value of a destination in viaDests: the engine only
    function viaIn(code, v) {
        const d = selfDestInfo(code);
        if (!d) return;
        if (d.kind === "depth") { viaVal[code] = clamp(v / 100, 0, 1); applyViaValue(code); return; }
        const mod = api.state.mods[d.slot];
        if (!mod) return;
        if (d.kind === "on") viaVal[code] = v >= 0.5 ? 1 : 0;
        else if (d.kind === "sw") viaVal[code] = clampParam(AUTO_SW_KEYS[d.ctl], Math.round(v));
        else {
            const key = AUTO_KEYS[mod.type][d.ctl];
            if (!key) return;
            viaVal[code] = clampParam(key, autoValue(key, v / 100));
        }
        applyViaValue(code);
    }
    api.viaDests = function () { return Object.keys(viaDests).map(Number); };
    api._viaStoredRead = viaReadStored; // test hook: poll the stored values now

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
            if (!m) continue;
            if (isInternal(m)) syncInternal(m); // the internal table has the depth baked in
            else if (slotOf[m.id] !== undefined) writeDepthCells(m, slotOf[m.id]); // the router applies it per sample
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
        if (viaDests[idx] && autoOn && !autoFrozen) { delete autoSent["ap_" + idx]; viaIn(idx, v); return; } // a modulated output: the engine only
        api._autoParamStored(idx, v);
    };
    // the value is the parameter's STORED value (not modulated): the model follows it (and the engine, through the cfg write)
    api._autoParamStored = function (idx, v) {
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
        if (viaDests[DEST_SW + idx] && autoOn && !autoFrozen) { delete autoSent["at_" + idx]; viaIn(DEST_SW + idx, v); return; }
        api._autoSwitchStored(idx, v);
    };
    api._autoSwitchStored = function (idx, v) {
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
        if (viaDests[DEST_DEPTH + k] && autoOn) { delete autoSent["ad_" + k]; viaIn(DEST_DEPTH + k, v); return; }
        api._autoDepthStored(k, v);
    };
    api._autoDepthStored = function (k, v) {
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
            const ui = p && p.getnamed ? p.getnamed(MM_UI_VARNAME) : null;
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
            if (isInternal(m)) continue;
            const r = resolveTarget(m.target, lom);
            if (r.ok) {
                m.target.path = r.path;
                const a = scratchApi();
                try { a.goto(r.path); pidCache[m.id] = Number(a.id) || 0; } catch (e) { pidCache[m.id] = 0; }
                missing[m.id] = pidCache[m.id] > 0 ? false : true;
                if (!missing[m.id]) seenLive[m.id] = true;
            } else {
                pidCache[m.id] = 0;
                missing[m.id] = true;
            }
        }
    }
    // Slow poll (1.5 s): detect moved / deleted targets, revive missing ones when they come back, and AUTO-DELETE the mappings whose target went away.
    // Auto-delete (decided, see AGENTS.md section 21 "Target deleted"): only a mapping whose target resolved earlier in THIS session (`seenLive`; a mapping that
    // was already missing when the Set loaded is kept, marked missing, in case the user is about to restore the device), unresolvable (path, then name)
    // on AUTO_DELETE_POLLS consecutive polls, while the LOM looks healthy (the Set has its master track and this device itself resolves; a Set load / reload
    // never deletes). A MOVED device keeps its Live id (its path changes, the id still resolves) or is found again by name, so it is never unresolved.
    // Everything confirmed in one poll is deleted as ONE undo entry. Every mapping is handled on its own: an exception on one never blocks the others.
    const AUTO_DELETE_POLLS = 2;
    function lomHealthy(lom) {
        try {
            if (!lom.exists("live_set master_track")) return false;
            if (selfPath && !lom.exists(selfPath)) return false;
            return true;
        } catch (e) { return false; }
    }
    function validateTargets() {
        try { validateTargetsBody(); } catch (e) { dlog("validateTargets threw", String(e)); }
    }
    function validateTargetsBody() {
        if (!lomReady || !api.state.mappings.some((m) => !isInternal(m))) return;
        const a = scratchApi();
        if (!a) return;
        const lom = lomIface();
        const healthy = lomHealthy(lom);
        let changed = false;
        const dead = [];
        for (const m of api.state.mappings.slice()) {
            if (isInternal(m)) continue;
            try {
                const pid = lomPid(m);
                // the id to probe: the bound one, or (while the mapping is missing) the one it just lost: a temporary glitch brings the SAME Live object back
                const probe = pid > 0 ? pid : (lostPid[m.id] || 0);
                let ok = false;
                let moved = false;
                let idDead = false;
                if (probe > 0) {
                    try {
                        // a FRESH LiveAPI per probe: a goto("id N") on the shared scratch API returns nothing once it has been pointed at a dead id (AGENTS.md "Lookup")
                        const ia = new LiveAPI(function () {}, "id " + probe);
                        idDead = Number(ia.id) !== probe;
                        if (!idDead) {
                            const np = stripQuotes(ia.unquotedpath || ia.path);
                            if (np === m.target.path) ok = true;
                            else if (np) { // the same Live object under a new path: the device was moved; follow it
                                ok = true; moved = true;
                                m.target.path = np;
                                const pp = pathParts(np);
                                const tm = /^live_set (?:tracks \d+|return_tracks \d+|master_track)/.exec(np);
                                if (tm) { const tn = lom.name(tm[0]); if (tn) m.target.trackName = tn; }
                                const dn = lom.name(np.replace(/ parameters \d+$/, ""));
                                if (dn) m.target.deviceName = dn;
                                changed = true;
                            }
                        }
                    } catch (e) { ok = false; idDead = true; }
                }
                dlog("validate map", m.id, "pid", pid, "probe", probe, "ok", ok, "idDead", idDead, "path", m.target.path);
                if (ok) {
                    missPolls[m.id] = 0;
                    seenLive[m.id] = true;
                    if (pid <= 0) { pidCache[m.id] = probe; missing[m.id] = false; delete lostPid[m.id]; syncMapping(m); changed = true; }
                    else if (moved) { syncMapping(m); }
                    else {
                        // self-heal: a live target whose pool slot is not bound to its id (a failed slot write) is bound again
                        const sl = slotOf[m.id];
                        if (sl !== undefined && mappingActive(m)) {
                            const b = boundOf(sl);
                            if (b.mod !== (m.mode === "mod" ? pid : 0) || b.rem !== (m.mode === "remote" ? pid : 0)) syncMapping(m);
                        }
                    }
                    continue;
                }
                let r = resolveTarget(m.target, lom);
                // The Live id of a target we saw alive is gone. A device that was MOVED keeps its id (followed above), so a same-named parameter that sits at the
                // OLD path is another device (the next one slid into the deleted one's place): the target is deleted. Found by NAME elsewhere = moved, kept.
                if (seenLive[m.id] && (probe > 0 || missPolls[m.id] > 0) && r.ok && r.how === "path") r = { ok: false, path: m.target.path, how: "stale" };
                let newPid = 0;
                if (r.ok) { try { a.goto(r.path); newPid = Number(a.id) || 0; } catch (e) { newPid = 0; } }
                const nowMissing = newPid <= 0;
                if (!nowMissing) { missPolls[m.id] = 0; seenLive[m.id] = true; delete lostPid[m.id]; }
                else if (pid > 0) lostPid[m.id] = pid;
                if (nowMissing && healthy) missPolls[m.id] = (missPolls[m.id] || 0) + 1;
                else if (nowMissing) missPolls[m.id] = 0; // an unhealthy LOM (loading) proves nothing
                if (newPid !== pid || nowMissing !== !!missing[m.id]) {
                    if (r.ok) m.target.path = r.path;
                    pidCache[m.id] = newPid;
                    missing[m.id] = nowMissing;
                    syncMapping(m);
                    changed = true;
                }
                if (nowMissing && seenLive[m.id] && missPolls[m.id] >= AUTO_DELETE_POLLS && !(m.target.selfDest !== undefined || isSelfTarget(m.target.path, selfPath))) dead.push(m);
            } catch (e) { dlog("validate: mapping", m.id, "threw", String(e)); }
        }
        if (dead.length && healthy) { autoDeleteMappings(dead); changed = true; }
        if (changed) fire("targets");
    }
    // Delete mappings whose target is gone (with their depth routes, as one undo entry; their pool slots are unbound and freed)
    function autoDeleteMappings(list) {
        const all = [];
        const add = (x) => { if (all.indexOf(x) < 0) all.push(x); };
        for (const m of list) { add(m); for (const d of depthRoutesOf(api.state.mappings, m.id)) add(d); }
        const entry = { kind: "tdel", maps: all.map(snapMapping), label: list.length > 1 ? list.length + " mappings (target deleted)" : mappingLabel(list[0]) + " (target deleted)" };
        for (const m of all) { try { removeMappingInternal(m); } catch (e) { dlog("autoDelete: remove", m.id, "threw", String(e)); } delete seenLive[m.id]; delete missPolls[m.id]; }
        pushUndo(entry);
        dlog("autoDeleteMappings", list.map((m) => m.id));
        fire("mapping", list[0].mod, list[0].id);
        api.commit();
    }
    // after an undo of an auto-delete (Live's own Undo may have restored the device): resolve again, rebind when it resolves, else leave it missing
    function reresolveRestored(ms) {
        const a = scratchApi();
        if (!a) return;
        const lom = lomIface();
        for (const m of ms) {
            if (isInternal(m)) continue;
            try {
                const r = resolveTarget(m.target, lom);
                let np = 0;
                if (r.ok) { try { a.goto(r.path); np = Number(a.id) || 0; } catch (e) { np = 0; } }
                if (np > 0) { m.target.path = r.path; pidCache[m.id] = np; missing[m.id] = false; seenLive[m.id] = true; }
                else { pidCache[m.id] = 0; missing[m.id] = true; delete seenLive[m.id]; }
                missPolls[m.id] = 0;
                syncMapping(m);
            } catch (e) { dlog("reresolveRestored threw", m.id, String(e)); }
        }
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
    // The deferred learn handler. Every step is guarded: an exception (a dead id, a throwing LiveAPI, a failing slot write) is logged, a single-shot learn
    // is disarmed (never left half armed), and a multi-learn stays armed for the next parameter. `lastSelectedId` is updated first, so one bad selection
    // never blocks the next different one.
    api._selectionChanged = function (id) {
        try { selectionChangedBody(id); }
        catch (e) {
            dlog("selectionChanged threw", String(e));
            try { if (api.learn.armed && !api.learn.multi) api.disarmLearn(); } catch (e2) {}
        }
    };
    function selectionChangedBody(id) {
        dlog("selectionChanged id", id, "last", lastSelectedId, "learn", api.learn);
        if (id === lastSelectedId) return;
        lastSelectedId = id;
        if (!api.learn.armed || !id) return;
        let info = null;
        try { info = describeParameter(id); } catch (e) { dlog("describeParameter threw", String(e)); }
        dlog("describeParameter", info);
        if (!info) return;
        if (isSelfTarget(info.path, selfPath)) {
            // the device's own parameter: a modulator control / On / switch / mapping Depth becomes a self-mapping of the selected kind
            const c = classifySelfParam(info.paramName, api.learn.mod, api.state);
            if (!c.ok) { dlog("ignored: own parameter", info.path, info.paramName, c.reason); return; }
            const sm = api.addSelfMapping(api.learn.mod, c.dest, undefined, info);
            dlog("addSelfMapping ->", sm ? { id: sm.id, mod: sm.mod, internal: isInternal(sm), dest: c.dest } : "NULL (duplicate / full)");
            if (!api.learn.multi) api.disarmLearn();
            return;
        }
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
            seenLive[mapping.id] = true;
            try { syncMapping(mapping); } catch (e) { dlog("learn: syncMapping threw", String(e)); }
            fire("mapping", mapping.mod, mapping.id);
        }
        if (!api.learn.multi) api.disarmLearn();
    }
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
        // the mappings it sources AND the self-mappings that target it (their destination goes away with it) are deleted together, undo restores all
        const touching = mappingsTouching(i);
        const entry = { kind: "mod", slot: i, orig: i, mod: cloneJson(mod), maps: touching.map(snapMapping), label: mod.name };
        for (const m of touching) removeMappingInternal(m);
        api.state.mods[i] = null;
        if (api.learn.mod === i) api.disarmLearn();
        writeCfgSlot(i); writeMsegSlot(i); writeStepsSlot(i);
        if (!(opts && opts.noUndo)) pushUndo(entry);
        fire("mods", i);
        api.commit();
    };
    // mappings sourced by modulator slot i, plus self-mappings whose destination is a control / On / switch of slot i
    // (plus the depth routes aimed at the mappings it sources: they go with their target mapping)
    function mappingsTouching(i) {
        const sourced = {};
        for (const x of api.state.mappings) if (x.mod === i && !isInternal(x)) sourced[x.id] = true;
        return api.state.mappings.filter((x) => x.mod === i || (isSelfMapping(x) && (function () { const d = selfDestInfo(selfDestOf(x)); return !!d && d.kind !== "depth" && d.slot === i; })()) || (isDepthRoute(x) && sourced[x.target.mapId]));
    }
    api.setModType = function (i, type) {
        const m = api.state.mods[i];
        if (!m) return;
        const keep = { name: m.name, color: m.color, enabled: m.enabled };
        const fresh = makeModSlot(clamp(Math.round(type), 1, 5), i);
        fresh.name = keep.name; fresh.color = keep.color; fresh.enabled = keep.enabled;
        api.state.mods[i] = fresh;
        writeCfgSlot(i); writeMsegSlot(i); writeStepsSlot(i);
        autoPushSlot(i);
        // self-mappings aimed at this slot are kept; those whose control the new type does not have become MISSING (route off) and revive on a type
        // change back. The meaning of a letter changes with the type (position based): A..E keep modulating whichever control now sits there.
        for (const x of api.state.mappings) if (isSelfMapping(x)) { const d = selfDestInfo(selfDestOf(x)); if (d && d.kind !== "depth" && d.slot === i) syncMapping(x); }
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
        if (isInternal({ target: t })) return null; // internal routes go through addSelfMapping
        // a duplicate is the same modulator on the same LIVE target. A STALE mapping (its target is gone, so it is missing or its Live id is another object than
        // the new one) can share the old path with the new target (a device after it slid into the deleted one's position): that is no duplicate.
        const newId = target && target.id ? Number(target.id) : 0;
        if (findDuplicateMapping(api.state.mappings, i, t, (x) => !isInternal(x) && (!!missing[x.id] || (newId > 0 && lomPid(x) > 0 && lomPid(x) !== newId)))) return null;
        if (t.selfDest !== undefined) {
            const c = classifySelfParam(selfDestName(t.selfDest), i, api.state);
            if (!c.ok || isInternal({ target: t })) return null;
        } else if (selfPath && isSelfTarget(t.path, selfPath)) return null; // an own parameter only through addSelfMapping / learn
        if (allocSlot() < 0) { dlog("addMapping refused: pool full", MAX_MAPPINGS); fire("full", i); return null; }
        const m = defaultMapping(api.state.nextMapId++, i, t, api.state.settings.defaultMode);
        api.state.mappings.push(m);
        if (target && target.id) { pidCache[m.id] = Number(target.id); missing[m.id] = false; seenLive[m.id] = true; }
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

    // ---------------------------------------------------------------- self-mappings (a modulator modulating this device's own controls)
    // The Live parameter of a dest code on THIS device as a mapping target {path, paramName, deviceName, trackName, selfDest, id?}. The path is found by
    // scanning the device's parameter names (cached); without the LOM (Node tests, before init_lom) path / id stay empty and validateTargets
    // resolves the target by track / device / parameter name once the LOM is ready.
    let ownParamIdx = null;
    function ownParamPath(name) {
        if (!lomReady || !selfPath) return "";
        if (!ownParamIdx) {
            ownParamIdx = {};
            const lom = lomIface();
            const n = lom.count(selfPath, "parameters");
            for (let q = 0; q < n; q++) ownParamIdx[lom.name(selfPath + " parameters " + q)] = q;
        }
        return ownParamIdx[name] === undefined ? "" : selfPath + " parameters " + ownParamIdx[name];
    }
    function ownTarget(dest, info) {
        if (info && info.path) return Object.assign({}, info, { selfDest: dest });
        const nm = selfDestName(dest);
        const lom = lomIface();
        const tm = /^live_set (?:tracks \d+|return_tracks \d+|master_track)/.exec(selfPath);
        return { path: ownParamPath(nm), name: nm, paramName: nm, selfDest: dest, deviceName: selfPath && lomReady ? lom.name(selfPath) : "", trackName: tm && lomReady ? lom.name(tm[0]) : "" };
    }
    function bindOwnPid(m) {
        const a = m.target.path && lomReady ? scratchApi() : null;
        let pid = 0;
        if (a) { try { a.goto(m.target.path); pid = Number(a.id) || 0; } catch (e) { pid = 0; } }
        pidCache[m.id] = pid;
        missing[m.id] = pid <= 0;
    }
    // kind: "internal" | "live" (default settings.selfMod). info = describeParameter() of the learned own parameter (via Live).
    // Returns the mapping, or null (duplicate, rejected target, the chosen pool is full: change kind "full", id -1 = the internal matrix).
    api.addSelfMapping = function (i, dest, kind, info) {
        if (!api.state.mods[i]) return null;
        const c = classifySelfParam(selfDestName(dest), i, api.state);
        if (!c.ok) return null;
        const k = kind === "live" || kind === "internal" ? kind : api.state.settings.selfMod;
        if (api.state.mappings.some((x) => x.mod === i && selfDestOf(x) === dest)) return null;
        const di = selfDestInfo(dest);
        if (k === "internal" && di && di.kind === "depth") {
            // INTERNAL + `Depth k` (learn on a Depth parameter) is a depth route on the mapping that owns pool slot k (schema 10)
            const owner = api.state.mappings.find((x) => !isInternal(x) && slotOf[x.id] === di.ctl);
            return owner ? api.addDepthRoute(i, owner.id) : null;
        }
        let m;
        if (k === "internal") {
            if (allocInternal() < 0) { dlog("addSelfMapping: internal matrix full", INT_ROUTES); fire("full", i, -1); return null; }
            m = defaultMapping(api.state.nextMapId++, i, makeInternalTarget(dest), "mod");
            api.state.mappings.push(m);
            syncInternal(m);
        } else {
            if (allocSlot() < 0) { fire("full", i); return null; }
            const t = ownTarget(dest, info);
            m = defaultMapping(api.state.nextMapId++, i, t, api.state.settings.defaultMode);
            m.target.selfDest = dest;
            api.state.mappings.push(m);
            if (info && info.id) { pidCache[m.id] = Number(info.id); missing[m.id] = false; } else bindOwnPid(m);
            syncMapping(m);
        }
        fire("mapping", i, m.id);
        api.commit();
        return m;
    };
    // ---------------------------------------------------------------- depth-modulation routes (schema 10)
    // Modulator `i` modulates the Depth of the pool mapping `mapId` (an internal route aimed at the mapping's pool slot, see src/megamod_config.js).
    // Allowed: any source (also the target mapping's own modulator: tremolo of self, no feedback loop), several routes per mapping (they sum).
    // Refused (null): unknown modulator / mapping, an INTERNAL or depth-route target (no router stage), the same source twice on one mapping,
    // a full internal matrix (change kind "full", id -1; the 64-route cap is shared with the self-mod routes).
    api.addDepthRoute = function (i, mapId) {
        if (!api.state.mods[i]) return null;
        const tm = api.getMapping(mapId);
        if (!tm || isInternal(tm)) return null;
        if (findDuplicateMapping(api.state.mappings, i, makeDepthTarget(mapId))) return null;
        if (allocInternal() < 0) { dlog("addDepthRoute: internal matrix full", INT_ROUTES); fire("full", i, -1); return null; }
        const m = defaultMapping(api.state.nextMapId++, i, makeDepthTarget(mapId), "mod");
        api.state.mappings.push(m);
        syncInternal(m);
        fire("mapping", i, m.id);
        api.commit();
        return m;
    };
    // the depth routes aimed at a mapping, in list order
    api.depthRoutesFor = function (mapId) { return depthRoutesOf(api.state.mappings, mapId); };
    // the mapping a depth route modulates (null when it is gone)
    api.depthTargetOf = function (m) { return isDepthRoute(m) ? api.getMapping(m.target.mapId) : null; };
    // "<parameter> Depth" / "Depth"
    api.depthRouteLabel = function (m) {
        const t = api.depthTargetOf(m);
        const nm = t ? t.target.paramName || t.target.name || "" : "";
        return nm ? nm + " Depth" : "Depth";
    };
    // the effective depth of a mapping (the engine's telemetry: base + the routes, clipped), or its own depth without a pool slot / telemetry
    api.effectiveDepth = function (mapId) {
        const m = api.getMapping(mapId);
        if (!m) return 1;
        const k = slotOf[mapId];
        return k !== undefined && tel.depth[k] !== undefined && depthRoutesOf(api.state.mappings, mapId).length ? clamp(tel.depth[k], 0, 1) : m.depth;
    };
    api.selfMappingsOfKind = function (kind) {
        return api.state.mappings.filter((m) => isSelfMapping(m) && (kind === "internal") === isInternal(m));
    };
    // The target of a mapping by meaning ("LFO 2 Rate" / "Frequency Depth"), plus " (M2 A)" for a via-Live row. "" for a normal mapping.
    api.selfLabel = function (m) {
        if (!isSelfMapping(m)) return "";
        const owner = function (k) {
            for (const x of api.state.mappings) if (slotOf[x.id] === k) return x.target.paramName || x.target.name || "";
            return "";
        };
        const lab = selfDestLabel(selfDestOf(m), api.state, owner);
        return isInternal(m) ? lab : lab + " (" + selfDestName(selfDestOf(m)) + ")";
    };
    // Convert ONE mapping to `to` ("internal" | "live"), in place (id, source, polarity, range, depth, shape and enabled are kept). Returns true,
    // or false when the destination kind has no room (the mapping is left as it was). Via Live -> internal: Remote becomes Mod (the closest equivalent:
    // an absolute window [min, max] becomes an offset of the same span in the same direction, "+" for max >= min, "-" otherwise, range = |max - min|).
    function convertOne(m, to) {
        const dest = selfDestOf(m);
        if (to === "internal") {
            if (isInternal(m)) return true;
            if (allocInternal() < 0) return false;
            const di = selfDestInfo(dest);
            if (di && di.kind === "depth") {
                // VIA LIVE `Depth k` -> INTERNAL = a depth route on the mapping that owns slot k (a mapping cannot modulate its own Depth parameter)
                const owner = api.state.mappings.find((x) => x !== m && !isInternal(x) && slotOf[x.id] === di.ctl);
                if (!owner || findDuplicateMapping(api.state.mappings, m.mod, makeDepthTarget(owner.id))) return false;
                if (m.mode === "remote") {
                    m.polarity = m.max >= m.min ? 1 : -1;
                    m.range = clamp(Math.abs(m.max - m.min), 0, 1);
                    m.mode = "mod";
                }
                releaseMappingSlot(m);
                delete pidCache[m.id]; delete missing[m.id];
                m.target = makeDepthTarget(owner.id);
                delete m.slot;
                syncInternal(m);
                return true;
            }
            if (m.mode === "remote") {
                m.polarity = m.max >= m.min ? 1 : -1;
                m.range = clamp(Math.abs(m.max - m.min), 0, 1);
                m.mode = "mod";
            }
            releaseMappingSlot(m);
            delete pidCache[m.id]; delete missing[m.id];
            m.target = makeInternalTarget(dest);
            delete m.slot;
            syncInternal(m);
            return true;
        }
        if (!isInternal(m)) return true;
        if (allocSlot() < 0) return false;
        releaseInternal(m);
        delete m.slot;
        m.target = ownTarget(dest, null);
        m.target.selfDest = dest;
        m.mode = "mod";
        bindOwnPid(m);
        syncMapping(m);
        return true;
    }
    function convertMany(ms, to) {
        const done = [];
        for (const m of ms) if (convertOne(m, to)) done.push(m.id);
        return done;
    }
    // Switch the Options selector. `convert` (default true): the self-mappings of the OTHER kind are converted to the new one as ONE undo step.
    api.setSelfMod = function (kind, convert) {
        const k = kind === "live" ? "live" : "internal";
        const old = api.state.settings.selfMod;
        api.setSettings({ selfMod: k });
        let converted = [];
        if (convert !== false) {
            const other = api.selfMappingsOfKind(k === "internal" ? "live" : "internal");
            if (other.length) {
                const entry = { kind: "conv", to: k, items: other.map(snapMapping), label: other.length + " self-mapping" + (other.length === 1 ? "" : "s") };
                converted = convertMany(other, k);
                entry.items = entry.items.filter((it) => converted.indexOf(it.m.id) >= 0);
                if (converted.length) pushUndo(entry);
                if (converted.length < other.length) fire("full", other[0].mod, k === "internal" ? -1 : 0);
                fire("mapping", other[0].mod, converted[0] || 0);
                api.commit();
            }
        }
        fire("selfmod", -1, converted.length);
        return { from: old, to: k, converted: converted.length };
    };
    function mappingLabel(m) {
        return isDepthRoute(m) ? "depth route" : m.target.paramName || m.target.name || "mapping";
    }
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
        delete seenLive[m.id];
        delete missPolls[m.id];
        delete lostPid[m.id];
        rebuildViaDests();
    }
    api.deleteMapping = function (id, opts) {
        const m = api.getMapping(id);
        if (!m) return;
        // the depth routes aimed at it go with it (one undo step restores all of them)
        const deps = isInternal(m) ? [] : depthRoutesOf(api.state.mappings, m.id);
        const entry = { kind: "map", maps: [m].concat(deps).map(snapMapping), label: mappingLabel(m) };
        for (const d of deps) removeMappingInternal(d);
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
    // orig = the modulator slot the snapshot was taken from; modSlot = the slot it is restored into (may differ when the old one was reused):
    // mappings it sourced follow it, and self-mappings that targeted it are re-aimed at the new slot.
    function restoreMappings(maps, modSlot, orig) {
        const used = {};
        for (const k of Object.keys(slotOf)) used[slotOf[k]] = true;
        const restored = [];
        for (const sn of maps.slice().sort((a, b) => a.index - b.index)) {
            if (api.getMapping(sn.m.id)) continue;
            const m = cloneJson(sn.m);
            if (modSlot !== undefined && m.mod === orig) m.mod = modSlot;
            if (modSlot !== undefined && modSlot !== orig && isSelfMapping(m)) retargetSelf(m, orig, modSlot);
            api.state.mappings.splice(clamp(sn.index, 0, api.state.mappings.length), 0, m);
            if (isInternal(m)) {
                const r = Number.isInteger(m.slot) && m.slot >= 0 && !Object.keys(islotOf).some((q) => islotOf[q] === m.slot) ? m.slot : allocInternal();
                if (r >= 0) islotOf[m.id] = r;
                restored.push(m);
                continue;
            }
            if (sn.pid) pidCache[m.id] = sn.pid;
            missing[m.id] = sn.missing;
            if (!sn.missing && sn.pid) seenLive[m.id] = true;
            let k = sn.slot;
            if (k < 0 || used[k]) k = allocSlot();
            if (k >= 0) { slotOf[m.id] = k; used[k] = true; }
            restored.push(m);
        }
        for (const m of restored) syncMapping(m);
        return restored;
    }
    // re-aim a self-mapping that targeted modulator slot `from` at slot `to` (an undo that had to use another free slot)
    function retargetSelf(m, from, to) {
        const d = selfDestInfo(selfDestOf(m));
        if (!d || d.kind === "depth" || d.slot !== from) return;
        const code = selfDestFor(d.kind, to, d.ctl);
        if (isInternal(m)) { m.target = makeInternalTarget(code); return; }
        m.target.selfDest = code; m.target.paramName = selfDestName(code); m.target.name = m.target.paramName; m.target.path = "";
        pidCache[m.id] = 0;
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
            restoreMappings(e.maps, s, e.orig);
            if (s !== e.orig) e.orig = s; // the entry now describes the new slot
            fire("mods", s);
        } else if (e.kind === "tdel") {
            // an auto-delete (target deleted): bring back the mappings whose modulator still exists, then resolve their targets again
            const maps = e.maps.filter((sn) => api.state.mods[sn.m.mod] || isDepthRoute(sn.m));
            if (!maps.length) return false;
            const r = restoreMappings(maps);
            reresolveRestored(r);
            fire("mapping", r.length ? r[0].mod : -1, r.length ? r[0].id : 0);
            fire("targets");
        } else if (e.kind === "conv") {
            // put every converted mapping back exactly as it was (the current object is released and replaced by its snapshot)
            for (const it of e.items) {
                const cur = api.getMapping(it.m.id);
                if (cur) removeMappingInternal(cur);
            }
            restoreMappings(e.items, undefined, undefined);
            fire("mapping", e.items.length ? e.items[0].m.mod : -1, e.items.length ? e.items[0].m.id : 0);
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
            e.maps = mappingsTouching(e.slot).map(snapMapping);
            e.orig = e.slot;
            api.removeModulator(e.slot, { noUndo: true });
        } else if (e.kind === "tdel") {
            const ms = e.maps.map((sn) => api.getMapping(sn.m.id)).filter(Boolean);
            if (!ms.length) return false;
            e.maps = ms.map(snapMapping);
            for (const m of ms) removeMappingInternal(m);
            fire("mapping", ms[0].mod, ms[0].id);
            fire("targets");
            api.commit();
        } else if (e.kind === "conv") {
            const ms = e.items.map((it) => api.getMapping(it.m.id)).filter(Boolean);
            if (!ms.length) return false;
            e.items = ms.map(snapMapping);
            convertMany(ms, e.to);
            fire("mapping", ms[0].mod, ms[0].id);
            api.commit();
        } else {
            const m = api.getMapping(e.maps[0].m.id);
            if (!m) return false;
            e.maps = [m].concat(isInternal(m) ? [] : depthRoutesOf(api.state.mappings, m.id)).map(snapMapping);
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
        return undoResult(e);
    };
    function undoResult(e) {
        if (e.kind === "conv") return { kind: "conv", slot: e.items[0].m.mod, ids: e.items.map((x) => x.m.id) };
        return { kind: e.kind, slot: e.kind === "mod" ? e.slot : e.maps[0].m.mod, ids: e.maps.map((x) => x.m.id) };
    }
    api.redo = function () {
        const e = redoStack.pop();
        if (!e) return null;
        if (!applyRedo(e)) return null;
        undoStack.push(e);
        fire("undo");
        return undoResult(e);
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
            // the v8ui's scripting name is "MegaModState" (the builder renames it), NOT its box id: looking up the box id returns null in Live
            const ui = p.getnamed(MM_UI_VARNAME) || (MM_THIS.box && typeof MM_THIS.box.getattr === "function" ? MM_THIS.box : null);
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
            const e = tel.eff[i], o = SCOPE_EFF + i * SCOPE_EFF_STRIDE;
            for (let j = 0; j < AUTO_PARAMS; j++) e.ctl[j] = a[o + j] || 0;
            e.on = a[o + AUTO_PARAMS] || 0;
            for (let t2 = 0; t2 < AUTO_SW_PER_SLOT; t2++) e.sw[t2] = a[o + AUTO_PARAMS + 1 + t2] || 0;
        }
        for (let k = 0; k < ROUTER_DEPTH_SLOTS; k++) tel.depth[k] = a.length > SCOPE_DEPTH + k ? a[SCOPE_DEPTH + k] : 1;
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
    api._setNames = function (cfg, mseg, steps, scope, curve, route, ibuf, icurve) {
        names = {};
        names[BUF_CFG] = cfg; names[BUF_MSEG] = mseg; names[BUF_STEPS] = steps; names[BUF_SCOPE] = scope; names[BUF_CURVE] = curve;
        names[BUF_ROUTE] = route;
        if (ibuf) names[BUF_INT] = ibuf;
        if (icurve) names[BUF_ICURVE] = icurve;
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
        seenLive = {};
        missPolls = {};
        lostPid = {};
        slotOf = {};
        islotOf = {};
        ownParamIdx = null;
        for (const m of api.state.mappings) { if (isInternal(m)) continue; const k = allocSlot(); if (k >= 0) slotOf[m.id] = k; }
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
        reqWidth: function () { return reqWidth; },
        slotOf: function () { return slotOf; },
        islotOf: function () { return islotOf; },
        islot: function (id) { return islotOf[id] === undefined ? -1 : islotOf[id]; },
        intBuf: function (off, n) { const b = buf(BUF_INT); if (!b) return null; try { return b.peek(1, off, n); } catch (e) { return null; } },
        bound: function () { return bound; },
        // the four router cells of a pool slot: [source or -1, effective depth, base depth, Remote centre or -1] (the engine writes the effective one)
        cells: function (slot) { const b = buf(BUF_ROUTE); if (!b) return null; try { const g = (i) => { const v = b.peek(1, i, 1); return Array.isArray(v) ? v[0] : v; }; return [g(2 * slot), g(2 * slot + 1), g(ROUTE_DEPTH_BASE + slot), g(ROUTE_DEPTH_MIN + slot)]; } catch (e) { return null; } },
        route: function (slot) { const b = buf(BUF_ROUTE); if (!b) return null; try { const v = b.peek(1, 2 * slot, 1); return Array.isArray(v) ? v[0] : v; } catch (e) { return null; } },
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
// loadmess setnames ---megamodcfg ---megamodmseg ---megamodsteps ---megamodscope ---mmcurve ---megamodroute ---megamodint ---megamodicurve
function setnames(cfg, mseg, steps, scope, curve, route, ibuf, icurve) {
    MM._setNames(String(cfg), String(mseg), String(steps), String(scope), String(curve), String(route), ibuf === undefined ? "" : String(ibuf), icurve === undefined ? "" : String(icurve));
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
        learn: MM.learn, bound: (function () { const o = {}; for (const k of Object.keys(bnd)) if (bnd[k] && (bnd[k].mod || bnd[k].rem)) o[k] = [bnd[k].mod, bnd[k].rem]; return o; })(),
        undoInfo: MM.undoInfo(), settings: MM.getSettings(), eff: MM.readTelemetry().eff.slice(0, 4), cache: MM.autoInfo().cache, internalCap: MM.internalCapacity(),
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
                internal: !!m.target.internal, selfDest: m.target.selfDest === undefined ? -1 : m.target.selfDest, islot: t.islot(m.id), label: MM.selfLabel(m),
                depthRoute: isDepthRoute(m) ? m.target.mapId : 0, nRoutes: m.target.internal ? 0 : MM.depthRoutesFor(m.id).length, effDepth: slot >= 0 ? MM.readTelemetry().depth[slot] : null,
                slot, route: slot >= 0 ? t.route(slot) : null, cells: slot >= 0 ? t.cells(slot) : null, idMod: b.mod, idRem: b.rem,
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

// test_dmodgeom: the v8ui rects a real-click test of the depth-modulation UI needs (v8ui pixels), as `dmodgeom_<device id>`: the rail buttons, every LST
// tab, the visible LST rows by mapping id (the name area), and the sub-rows
function test_dmodgeom() {
    const out = { rail: ubRailRects(), tabs: {}, rows: {}, subs: {}, pb: ubPb(), sel: ubSel(), width: ubLayoutWidth() };
    for (const g of ubTabsGeom(ubOrder()).list) if (g.tab) out.tabs[g.slot] = [g.x, g.y, g.w, g.h];
    const gm = ubListGeom();
    out.list = [gm.lx, gm.ly, gm.lw, gm.lh];
    for (const r of ubListVisible().rows) {
        if (r.item.kind === "map") out.rows[r.item.m.id] = [gm.lx + 18, r.y, 40, r.h];
        else if (r.item.kind === "dsub") out.subs[r.item.m.id] = [gm.lx, r.y, gm.lw, r.h];
    }
    let devId = "0";
    try { devId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) {}
    const g = new Global("megamod_test");
    g["dmodgeom_" + devId] = JSON.stringify(out);
}
// test_dmodroute <source mod> <mapping id>: MM.addDepthRoute (the model path)
function test_dmodroute(mod, id) { MM.addDepthRoute(Number(mod), Number(id)); }

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
// test_selflearn <mod> <dest code> [internal|live]: create a self-mapping the way a learn of that own parameter does (kind default = Options selector)
function test_selflearn(mod, dest, kind) { MM.addSelfMapping(Number(mod), Number(dest), kind === undefined ? undefined : String(kind)); }
// test_selfmod <internal|live>: the Options selector (converts existing self-mappings of the other kind)
function test_selfmod(kind) { MM.setSelfMod(String(kind)); }
function test_undo() { MM.undo(); }
// test_debug <absolute log path>: switch the dlog trace on (mirrored to that file; "off" switches it off)
function test_debug(path) { MM_DEBUG = String(path) !== "off"; MM_DEBUG_LOG = MM_DEBUG ? String(path) : ""; dlog("debug on"); }
// test_selui <slot>: select a modulator (the UI state `sel`); the faces tests use it to detect where a real click lands
function test_selui(slot) { MM.setUI({ sel: Number(slot) }); }
// test_expand <slot>: expand that strip in place (-1 collapses all); the faces tests use it to reach the expanded editor
function test_expand(slot) { ubSetExpanded(Number(slot)); }
function test_setparam(slot, key, v) { MM.setParam(Number(slot), String(key), Number(v)); }
// test_measure <slot> <ms>: busy-poll the engine's scope phase of that slot for ms milliseconds on the LOM thread and count the wraps (an LFO's cycles).
// Writes {wraps, ms, polls, out0, out1, rate} (rate = the slot's cfg rate float at the end) to Global("megamod_test").measure_<device id>.
function test_measure(slot, ms) {
    if (typeof Global === "undefined") return;
    const nm = MM._test.names();
    const sb = new Buffer(nm.megamodscope);
    const cb = new Buffer(nm.megamodcfg);
    const s = Number(slot);
    const t0 = Date.now();
    let last = -1, wraps = 0, polls = 0, out0 = null, out1 = 0;
    while (Date.now() - t0 < Number(ms)) {
        const a = sb.peek(1, s * 4, 2);
        polls++;
        if (out0 === null) out0 = a[0];
        out1 = a[0];
        if (last >= 0 && a[1] < last - 0.5) wraps++;
        last = a[1];
    }
    let devId = "0";
    try { devId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) {}
    new Global("megamod_test")["measure_" + devId] = JSON.stringify({ wraps, ms: Date.now() - t0, polls, out0, out1, rate: (function () { const v = cb.peek(1, s * CFG_STRIDE + CF_RATE, 1); return Array.isArray(v) ? v[0] : v; })() });
}
// test_mapupd <mapping id> <key> <value>: MM.updateMapping(id, {key: value}) (value JSON-parsed when it is not a plain string)
function test_delmap(id) { MM.deleteMapping(Number(id)); }
function test_mapupd(id, key, v) {
    let val = v;
    try { val = JSON.parse(String(v)); } catch (e) { val = v; }
    MM.updateMapping(Number(id), { [String(key)]: val });
}
// test_cfg <slot> <field>: the engine's cfg float (what the engine really reads) -> Global("megamod_test").cfg_<device id>
function test_cfg(slot, field) {
    if (typeof Global === "undefined") return;
    let devId = "0";
    try { devId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) {}
    new Global("megamod_test")["cfg_" + devId] = String((function () { const v = new Buffer(MM._test.names().megamodcfg).peek(1, Number(slot) * CFG_STRIDE + Number(field), 1); return Array.isArray(v) ? v[0] : v; })());
}
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
// test_geom: the width story as Live sees it, as `geom_<device id>`: obj-viz / panel presentation rects, the v8ui's own box.rect /
// mgraphics.size, the width last requested, the patcher's openrect / devicewidth attributes
function test_geom() {
    if (typeof Global === "undefined") return;
    let devId = "0";
    try { devId = String(new LiveAPI(function () {}, "this_device").id); } catch (e) {}
    const out = { reqWidth: MM._test.reqWidth(), uiLayout: typeof ubLayoutWidth === "function" ? ubLayoutWidth() : -1 };
    const rect = (n) => { try { const o = MM_THIS.patcher.getnamed(n); return o ? o.getattr("presentation_rect") : null; } catch (e) { return "ERR " + e; } };
    out.viz = rect(MM_UI_VARNAME);
    out.panels = [];
    for (let i = 0; i < 8; i++) { const r = rect("obj-panel-" + i); if (!r) break; out.panels.push(r); }
    try { out.boxRect = MM_THIS.box.rect; } catch (e) { out.boxRect = "ERR " + e; }
    try { out.gfx = mgraphics.size; } catch (e) { out.gfx = "ERR " + e; }
    out.lastClick = typeof ubLastClick !== "undefined" ? ubLastClick : null;
    try { out.devwidth = MM_THIS.patcher.getattr("devicewidth"); } catch (e) { out.devwidth = "ERR " + e; }
    try { out.openrect = MM_THIS.patcher.getattr("openrect"); } catch (e) { out.openrect = "ERR " + e; }
    try {
        out.strips = ubStrips().list.map((g2) => {
            const c = g2.exp ? ubStripRects(g2).chips.filter((q) => q.id === "sync")[0] : null;
            return { slot: g2.slot, x: g2.x, w: g2.w, exp: !!g2.exp, sync: c ? c.rect : null, chips: g2.exp ? ubStripRects(g2).chips.map((q) => [q.id, q.key, q.rect]) : [] };
        });
    } catch (e) { out.strips = "ERR " + e; }
    const g = new Global("megamod_test");
    g["geom_" + devId] = JSON.stringify(out);
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
