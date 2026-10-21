// spectral_link.js — rack context, chain index / count and cross-instance parameter linking for the Spectral Split
// suite (Transient Split, Loud Split, Harmonic Split, Freq Split). Plain JS for a Max v8ui: the build script
// concatenates it into the main face script, BEFORE the device's own ui script (and after the device config).
// Also Node-requirable (nodeModule pattern, AGENTS.md 1c) for tests/spectral_link_tests.js, which mocks Global / LiveAPI / Task.
//
// TOPOLOGY. A suite device is the first device of EVERY chain of an Audio Effect Rack, one chain per output channel. Every
// instance publishes its sound parameters on a shared bus and applies newer values from its peers, so editing any one of
// them edits all of them. The `Output` parameter (and any per-chain value) is NOT linked: leave it out of `keys`.
//
// API (all names are globals prefixed spl / SPL_, so they do not clash with device scripts)
//   splParseRackContext(lomPath)      -> {parentRackPath, chainIndex, deviceIndex, nestingDepth, isInRack}   (port of
//                                         parseRackContextFromPath in mbsplit_config.js, which stays untouched)
//   splCreateLink(cfg[, env])         -> link object
//       cfg = {
//         kind:        "transplit"               device kind, part of the group key (groups never mix kinds)
//         keys:        ["bias", ...]             linked parameter keys
//         channelCount: 2                        number of output channels of the device (for Auto)
//         getLocal:    function (key) -> number  current local value of a linked key (used when this instance publishes)
//         apply:       function (key, value)     a NEWER value from a peer: write it silently into the live.* object
//                                                (`prepend set`) and into the gen, and update the face's own state. Must
//                                                NOT call link.notify (the link also guards against that).
//         onInfo:      function (info)           optional; called when chain index / count / link state changed
//         pollMs: 80, heartbeatMs: 500, topoMs: 500, staleMs: 3000    optional timing
//       }
//       env (tests only) = {LiveAPI, Global, Task, now}; defaults to the Max globals.
//   link.init()                 call from live.thisdevice ("init_link"; never from loadbang: the LOM is not ready then).
//                               Reads the device path, joins the group, adopts the group's values if it already has some
//                               (otherwise publishes this instance's), starts the Task.
//   link.notify(key, value)     call when a linked parameter changed LOCALLY (the face's set_<key> handlers). Ignored before
//                               init and while a remote value is being applied. Remote values are never re-published.
//   link.info()                 {instanceId, isInRack, rackPath, chainIndex, deviceIndex, chainCount, peers, groupKey, linked,
//                                autoChannel}
//   link.autoChannel()          0-based output channel for Output = Auto: the chain index clamped to channelCount - 1;
//                               -1 outside a rack (then Auto means "all channels summed" = pass-through).
//   link.dispose()              stop the Task and leave the group.
//
// FACE WIRING (see scripts/build_transplit.py): the face's set_<key> handler stores the value and calls link.notify. Its
// `apply` callback emits ["link", key, value] on a v8ui outlet -> [route key1 key2 ...] -> per key a `prepend set` into the
// live.* object (silent, so it cannot loop) and the same gen path the live.* object uses. `onInfo` redraws the Auto pill and
// re-sends the resolved channel to the gen.
//
// BUS. Global("spectral_split_bus") = {groups: {<groupKey>: {counter, params: {key: {v, ver, src}}}}, peers: {<id>: {kind,
// group, chainIndex, t}}}. groupKey = kind + "::" + parentRackPath (outside a rack: kind + "::solo::" + instanceId, so the
// instance never links). ver comes from the group's counter, so the newest write wins. Each instance polls its group every
// pollMs on its own Task and applies entries whose ver is newer than the last one it saw and whose src is not itself; LiveAPI
// is only touched on the instance's own Task (never in another instance's callback). A group whose peers are all gone
// (no heartbeat for staleMs) is reset before a new instance joins, so a rebuilt rack does not inherit stale values.

var SPL_BUS_NAME = "spectral_split_bus";
var splNextId = 1;
var splScopeName = "";      // this instance's telemetry buffer name (the face calls splNoteScope from setbuffer); listed in the peer record for tests

function splNoteScope(name) {
    splScopeName = name ? String(name) : "";
}

function splParseRackContext(lomPath) {
    var clean = String(lomPath || "").replace(/^["']+|["']+$/g, "").trim();
    if (!clean) {
        return { parentRackPath: "", chainIndex: 0, deviceIndex: 0, nestingDepth: 0, isInRack: false };
    }
    var m = clean.match(/^(.*?\bdevices\s+\d+)\s+chains\s+(\d+)\s+devices\s+(\d+)\s*$/);
    if (m) {
        var allChains = clean.match(/\bchains\s+\d+/g) || [];
        return {
            parentRackPath: m[1].trim(),
            chainIndex: parseInt(m[2], 10) || 0,
            deviceIndex: parseInt(m[3], 10) || 0,
            nestingDepth: allChains.length,
            isInRack: true
        };
    }
    var dm = clean.match(/\bdevices\s+(\d+)\s*$/);
    return { parentRackPath: "", chainIndex: 0, deviceIndex: dm ? (parseInt(dm[1], 10) || 0) : 0, nestingDepth: 0, isInRack: false };
}

function splDefaultEnv() {
    return {
        LiveAPI: typeof LiveAPI !== "undefined" ? LiveAPI : null,
        Global: typeof Global !== "undefined" ? Global : null,
        Task: typeof Task !== "undefined" ? Task : null,
        now: function () { return Date.now(); }
    };
}

function splBus(env) {
    var g = new env.Global(SPL_BUS_NAME);
    if (!g.groups) g.groups = {};
    if (!g.peers) g.peers = {};
    return g;
}

function splCreateLink(cfg, envIn) {
    var env = envIn || splDefaultEnv();
    var keys = cfg.keys || [];
    var pollMs = cfg.pollMs || 80;
    var heartbeatMs = cfg.heartbeatMs || 500;
    var topoMs = cfg.topoMs || 500;
    var staleMs = cfg.staleMs || 3000;
    var channelCount = Math.max(1, cfg.channelCount || 2);
    var id = "i" + (splNextId++) + "_" + Math.floor(Math.random() * 1e9).toString(36);
    var state = {
        inited: false,
        applying: false,
        groupKey: "",
        isInRack: false,
        rackPath: "",
        path: "",
        chainIndex: 0,
        deviceIndex: 0,
        chainCount: 0,
        peers: 1,
        linked: false
    };
    var seen = {};
    var selfApi = null;
    var rackApi = null;
    var task = null;
    var lastTopo = -1e9;
    var lastBeat = -1e9;

    function autoChannel() {
        if (!state.isInRack) return -1;
        return Math.max(0, Math.min(channelCount - 1, state.chainIndex));
    }

    function info() {
        return {
            instanceId: id,
            isInRack: state.isInRack,
            rackPath: state.rackPath,
            chainIndex: state.chainIndex,
            deviceIndex: state.deviceIndex,
            chainCount: state.chainCount,
            peers: state.peers,
            groupKey: state.groupKey,
            linked: state.linked,
            autoChannel: autoChannel()
        };
    }

    function infoKey() {
        return [state.isInRack, state.chainIndex, state.chainCount, state.peers, state.linked, state.groupKey].join("|");
    }

    function getGroup(create) {
        var bus = splBus(env);
        var g = bus.groups[state.groupKey];
        if (!g && create) {
            g = { counter: 0, params: {} };
            bus.groups[state.groupKey] = g;
        }
        return g;
    }

    function readPath() {
        try {
            if (!selfApi) selfApi = new env.LiveAPI(function () {}, "this_device");
            return String(selfApi.unquotedpath || selfApi.path || "");
        } catch (err) {
            return "";
        }
    }

    function readChainCount(ctx) {
        if (!ctx.isInRack) return 0;
        try {
            if (!rackApi) rackApi = new env.LiveAPI(function () {}, ctx.parentRackPath);
            else if (String(rackApi.unquotedpath || rackApi.path || "") !== ctx.parentRackPath) rackApi.path = ctx.parentRackPath;
            var c = Number(rackApi.getcount("chains"));
            return isNaN(c) ? 0 : c;
        } catch (err) {
            return 0;
        }
    }

    function leaveGroup() {
        try {
            var bus = splBus(env);
            delete bus.peers[id];
        } catch (err) {}
    }

    function heartbeat(now) {
        var bus = splBus(env);
        bus.peers[id] = { kind: cfg.kind, group: state.groupKey, chainIndex: state.chainIndex, deviceIndex: state.deviceIndex, path: state.path,
                          auto: autoChannel(), scope: splScopeName, t: now };
        var alive = 0;
        var gone = [];
        for (var pid in bus.peers) {
            var p = bus.peers[pid];
            if (now - p.t > staleMs) gone.push(pid);
            else if (p.group === state.groupKey) alive++;
        }
        for (var i = 0; i < gone.length; i++) delete bus.peers[gone[i]];
        state.peers = Math.max(1, alive);
        lastBeat = now;
    }

    function applyNewer() {
        var g = getGroup(false);
        if (!g) return;
        for (var i = 0; i < keys.length; i++) {
            var key = keys[i];
            var e = g.params[key];
            if (!e) continue;
            if (e.ver <= (seen[key] || 0)) continue;
            seen[key] = e.ver;
            if (e.src === id) continue;
            state.applying = true;
            try {
                cfg.apply(key, e.v);
            } finally {
                state.applying = false;
            }
        }
    }

    function refreshTopology(now) {
        var devPath = readPath();
        var ctx = splParseRackContext(devPath);
        state.path = devPath;
        var newKey = cfg.kind + "::" + (ctx.isInRack ? ctx.parentRackPath : "solo::" + id);
        var joined = false;
        if (newKey !== state.groupKey) {
            if (state.groupKey) leaveGroup();
            state.groupKey = newKey;
            seen = {};                       // versions are per group
            joined = true;
        }
        state.isInRack = ctx.isInRack;
        state.rackPath = ctx.parentRackPath;
        state.chainIndex = ctx.chainIndex;
        state.deviceIndex = ctx.deviceIndex;
        var lom = readChainCount(ctx);
        heartbeat(now);
        state.chainCount = lom > 0 ? lom : (ctx.isInRack ? state.peers : 0);
        state.linked = ctx.isInRack && state.peers > 1;
        lastTopo = now;
        return joined;
    }

    function joinInitial() {
        // No live peer left in the group -> its stored values are stale: start it afresh.
        var bus = splBus(env);
        if (state.peers <= 1 && bus.groups[state.groupKey]) delete bus.groups[state.groupKey];
        var g = getGroup(true);
        var any = false;
        for (var k in g.params) any = true;
        if (any) {
            applyNewer();                               // adopt the rack's values
        } else {
            for (var i = 0; i < keys.length; i++) {     // first instance: publish this one's
                publish(keys[i], cfg.getLocal(keys[i]));
            }
        }
        for (var j = 0; j < keys.length; j++) {
            var e = g.params[keys[j]];
            if (e) seen[keys[j]] = Math.max(seen[keys[j]] || 0, e.ver);
        }
    }

    function publish(key, value) {
        var g = getGroup(true);
        g.counter = (g.counter || 0) + 1;
        g.params[key] = { v: value, ver: g.counter, src: id };
        seen[key] = g.counter;
    }

    var lastInfoKey = "";
    function tick() {
        if (!state.inited) return;
        var now = env.now();
        var rejoined = false;
        if (now - lastTopo >= topoMs) rejoined = refreshTopology(now);
        else if (now - lastBeat >= heartbeatMs) heartbeat(now);
        if (rejoined) joinInitial();
        else applyNewer();
        var k = infoKey();
        if (k !== lastInfoKey) {
            lastInfoKey = k;
            if (cfg.onInfo) cfg.onInfo(info());
        }
    }

    var link = {
        init: function () {
            if (state.inited) return;
            state.inited = true;
            refreshTopology(env.now());
            joinInitial();
            lastInfoKey = infoKey();
            if (cfg.onInfo) cfg.onInfo(info());
            if (env.Task) {
                task = new env.Task(tick, link);
                task.interval = pollMs;
                task.repeat();
            }
        },
        notify: function (key, value) {
            if (!state.inited || state.applying) return;
            if (keys.indexOf(key) < 0) return;
            var g = getGroup(false);
            var cur = g && g.params[key];
            if (cur && cur.v === value) return;    // same value as the bus already holds (e.g. a widget re-outputting after `active`): no new version
            publish(key, value);
        },
        info: info,
        autoChannel: autoChannel,
        dispose: function () {
            if (task) {
                try { task.cancel(); } catch (err) {}
                task = null;
            }
            if (state.inited) leaveGroup();
            state.inited = false;
        },
        tick: tick   // for tests (a mocked Task does not fire by itself)
    };
    return link;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = { splParseRackContext: splParseRackContext, splCreateLink: splCreateLink, SPL_BUS_NAME: SPL_BUS_NAME, splNoteScope: splNoteScope };
}
