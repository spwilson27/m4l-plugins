// Mega Modulator — v8-side runtime ("MM"). Prepended after src/megamod_config.js into every UI script.
// See the API CONTRACT at the top of src/megamod_config.js for the UI-facing API.
//
// Owns: state, engine buffer writers, the saved mapping-slot pool (route/curve buffers + live id binding),
// learn (selected_parameter observer), target resolution/validation, telemetry polling,
// getvalueof/setvalueof, device width requests. Everything touching Max/Live objects is guarded so the
// script also loads in Node mocks and in the preview renderer.

const MM_THIS = this;
const MM_ENGINE_VARNAME = "megamod_engine";
// TEMPORARY debug trace of learn/mapping, rewritten whole on every line (last 1500 lines).
const MM_DEBUG_LOG = "/private/tmp/claude-501/-Users-mrwilson-software-ableton/d121f0fc-10cf-4b45-90e7-0d9dd257f8c0/scratchpad/megamod_debug.log";
const mmLogLines = [];
function dlog() {
    const parts = Array.prototype.slice.call(arguments).map((a) => {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
    });
    const line = new Date().toISOString().slice(11, 23) + " " + parts.join(" ");
    mmLogLines.push(line);
    if (mmLogLines.length > 1500) mmLogLines.splice(0, mmLogLines.length - 1500);
    if (typeof post === "function") post("megamod: " + line + "\n");
    if (typeof File === "undefined") return;
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
    let names = null; // {cfg, mseg, steps, scope, curve, route} expanded #0 names
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
    }
    // Reassign every mapping to the lowest free slots (load / names / LOM ready). Releases everything first.
    function rebuildAllSlots() {
        for (const k of Object.keys(bound)) unbindSlot(Number(k));
        slotOf = {};
        bound = {};
        if (names) flushRoute();
        for (const m of api.state.mappings) {
            const s = allocSlot();
            if (s < 0) { dlog("rebuildAllSlots: pool full, map", m.id, "left unslotted"); continue; }
            slotOf[m.id] = s;
            syncMapping(m);
        }
    }

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
        fire("mods", s);
        api.commit();
        return s;
    };
    api.removeModulator = function (i) {
        if (!api.state.mods[i]) return;
        for (const m of api.state.mappings.filter((x) => x.mod === i)) removeMappingInternal(m);
        api.state.mods[i] = null;
        if (api.learn.mod === i) api.disarmLearn();
        writeCfgSlot(i); writeMsegSlot(i); writeStepsSlot(i);
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
        const m = defaultMapping(api.state.nextMapId++, i, t);
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
        for (const k of ["mod", "enabled", "mode", "min", "max", "amount", "bipolar", "invert", "curve", "curveAmt", "curveSteps"]) m[k] = merged[k];
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
    api.deleteMapping = function (id) {
        const m = api.getMapping(id);
        if (!m) return;
        removeMappingInternal(m);
        fire("mapping", m.mod, id);
        api.commit();
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
                if (r && r.length >= 4) ui.setattr("presentation_rect", r[0], r[1], Math.max(1, w - 2 * r[0]), r[3]);
            }
            for (let i = 0; i < 8; i++) {
                const pn = p.getnamed("obj-panel-" + i);
                if (!pn) break;
                const r = pn.getattr("presentation_rect");
                if (r && r.length >= 4 && r[0] === 0) pn.setattr("presentation_rect", 0, r[1], w, r[3]);
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
        for (const fn of listeners.ready) { try { fn(); } catch (e) {} }
        if (typeof uiReady === "function") { try { uiReady(); } catch (e) { post2("uiReady: " + e); } }
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
        if (api.learn.armed) api.learn = { armed: false, mod: -1, multi: false };
        pidCache = {};
        missing = {};
        slotOf = {};
        for (const m of api.state.mappings) { const k = allocSlot(); if (k >= 0) slotOf[m.id] = k; }
        flushEngine();
        if (lomReady) { resolveMappingTargets(); if (names) rebuildAllSlots(); }
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
// loadmess setnames #0-megamodcfg #0-megamodmseg #0-megamodsteps #0-megamodscope #0-mmcurve #0-megamodroute
function setnames(cfg, mseg, steps, scope, curve, route) {
    MM._setNames(String(cfg), String(mseg), String(steps), String(scope), String(curve), String(route));
}
// live.thisdevice bang (the LOM is ready): observers + target resolution + slot reassignment
function init_lom() {
    MM._initLom();
}

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
        engine: (function () { try { const e = MM_THIS.patcher.getnamed(MM_ENGINE_VARNAME); return e ? { cls: e.maxclass, cords: cordsOf(e) } : null; } catch (x) { return "err " + x; } })(),
        mappings: MM.allMappings().map((m) => {
            const slot = slots[m.id] === undefined ? -1 : slots[m.id];
            const b = slot >= 0 && bnd[slot] ? bnd[slot] : { mod: 0, rem: 0 };
            const mid = slot >= 0 ? box("mm_mid_" + slot) : null, rid = slot >= 0 ? box("mm_rid_" + slot) : null;
            const lm = slot >= 0 ? box("mm_mod_" + slot) : null, lr = slot >= 0 ? box("mm_rem_" + slot) : null;
            return {
                id: m.id, mod: m.mod, mode: m.mode, path: m.target.path, status: MM.mappingStatus(m.id), pid: t.pid(m.id),
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
