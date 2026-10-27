/**
 * Ableton MCP Bridge — Max for Live LOM & Global Inspector (`src/ableton_mcp_lom.js`)
 *
 * Runs inside `v8ui` on Max's main/LOM thread so it has direct synchronous access to:
 *  - `LiveAPI` (Ableton Live Object Model: `live_set`, `tracks`, `devices`, `chains`, `parameters`, `view`)
 *  - `Global` (shared cross-device Max buses such as `Global("mbsplit_shared_bus")`)
 *  - `Buffer` (audio/telemetry buffers)
 *
 * Communicates with `obj-node` (`node.codebox`, `src/ableton_mcp_node.js`) via:
 *  - Inlet:  `lom_rpc <reqId> <jsonString>`
 *  - Outlet: `["lom_reply", reqId, jsonString]`
 */

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var CANVAS_W = 248;
var CANVAS_H = 157;

var bridgeStatus = "STARTING";
var bridgePort = 9877;
var totalRpcCalls = 0;
var lastRpcAction = "none";
var lastRpcLatencyMs = 0;
var lastErrorMsg = "";
var rpcLog = []; // [{ time, action, target, ok, ms }]
var MAX_LOG_ITEMS = 5;

var sessionSnapshot = {
    tempo: 120.0,
    isPlaying: 0,
    trackCount: 0,
    sigNum: 4,
    sigDen: 4
};

function cleanPath(p) {
    if (!p) return "";
    return String(p).replace(/^["']+|["']+$/g, "").trim();
}

function extractIds(rawArr) {
    if (!rawArr) return [];
    var arr = Array.isArray(rawArr) ? rawArr : [rawArr];
    var ids = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === "id" && i + 1 < arr.length) {
            ids.push(Number(arr[i + 1]));
            i++;
        } else if (typeof arr[i] === "number" && arr[i] > 0) {
            ids.push(arr[i]);
        }
    }
    return ids;
}

function getScalar(api, prop) {
    try {
        var v = api.get(prop);
        if (Array.isArray(v)) return v.length === 1 ? v[0] : v;
        return v;
    } catch (e) {
        return null;
    }
}

/**
 * @param {string} [pathOrId]
 * @returns {LomApi}
 */
function makeApi(pathOrId) {
    if (typeof LiveAPI === "undefined") {
        throw new Error("LiveAPI is not available in this Max environment");
    }
    var target = cleanPath(pathOrId || "live_set");
    var api = new LiveAPI(function() {}, target);
    if (!api) {
        throw new Error("Failed to create LiveAPI for target: " + target);
    }
    return api;
}

function requireExists(api, path) {
    if (!api || !(Number(api.id) > 0)) {
        throw new Error("LOM path does not exist: " + path);
    }
    return api;
}

function countParameters(devicePath) {
    var devApi = makeApi(devicePath);
    try {
        return Number(devApi.getcount("parameters")) || 0;
    } catch (e) {
        return extractIds(devApi.get("parameters")).length;
    }
}

function readParameterList(devicePath, maxParams) {
    var devApi = makeApi(devicePath);
    var nParams = 0;
    try {
        nParams = Number(devApi.getcount("parameters")) || 0;
    } catch (e) {
        var pIds = extractIds(devApi.get("parameters"));
        nParams = pIds.length;
    }
    var limit = Math.min(nParams, typeof maxParams === "number" ? maxParams : 64);
    var params = [];
    for (var i = 0; i < limit; i++) {
        var pPath = cleanPath(devicePath) + " parameters " + i;
        try {
            var pApi = makeApi(pPath);
            var val = getScalar(pApi, "value");
            var disp = "";
            try {
                disp = String(pApi.call("str_for_value", val) || "");
            } catch (eDisp) {}
            params.push({
                index: i,
                id: Number(pApi.id) || 0,
                name: String(getScalar(pApi, "name") || ""),
                value: Number(val),
                min: Number(getScalar(pApi, "min")),
                max: Number(getScalar(pApi, "max")),
                is_quantized: Number(getScalar(pApi, "is_quantized")) || 0,
                display_value: disp,
                path: pPath
            });
        } catch (eParam) {}
    }
    return params;
}

function readDeviceTree(devicePath, opts, depth) {
    var curDepth = depth || 0;
    var devApi = makeApi(devicePath);
    var id = Number(devApi.id) || 0;
    var name = String(getScalar(devApi, "name") || "");
    var className = String(getScalar(devApi, "class_name") || "");
    var devType = Number(getScalar(devApi, "type")) || 0;
    var isActive = Number(getScalar(devApi, "is_active"));
    var canHaveChains = Number(getScalar(devApi, "can_have_chains")) || 0;

    var info = {
        id: id,
        name: name,
        class_name: className,
        type: devType,
        is_active: isNaN(isActive) ? 1 : isActive,
        can_have_chains: canHaveChains,
        path: cleanPath(devApi.unquotedpath || devApi.path || devicePath)
    };

    if (opts && opts.includeParameters) {
        info.parameters = readParameterList(devicePath, typeof opts.maxParameters === "number" ? opts.maxParameters : 32);
    }

    if (canHaveChains && curDepth < 4) {
        var nChains = 0;
        try {
            nChains = Number(devApi.getcount("chains")) || 0;
        } catch (e) {
            nChains = extractIds(devApi.get("chains")).length;
        }
        var chains = [];
        for (var c = 0; c < nChains; c++) {
            var cPath = cleanPath(devicePath) + " chains " + c;
            try {
                var cApi = makeApi(cPath);
                var nSubDevs = 0;
                try {
                    nSubDevs = Number(cApi.getcount("devices")) || 0;
                } catch (e2) {
                    nSubDevs = extractIds(cApi.get("devices")).length;
                }
                var subDevs = [];
                for (var d = 0; d < nSubDevs; d++) {
                    subDevs.push(readDeviceTree(cPath + " devices " + d, opts, curDepth + 1));
                }
                chains.push({
                    index: c,
                    id: Number(cApi.id) || 0,
                    name: String(getScalar(cApi, "name") || ("Chain " + c)),
                    mute: Number(getScalar(cApi, "mute")) || 0,
                    solo: Number(getScalar(cApi, "solo")) || 0,
                    path: cleanPath(cApi.unquotedpath || cApi.path || cPath),
                    devices: subDevs
                });
            } catch (eChain) {}
        }
        info.chains = chains;
    }

    return info;
}

function readTrackInfo(trackPath, index, category, opts) {
    var tApi = makeApi(trackPath);
    var nDevs = 0;
    try {
        nDevs = Number(tApi.getcount("devices")) || 0;
    } catch (e) {
        nDevs = extractIds(tApi.get("devices")).length;
    }
    var devices = [];
    for (var d = 0; d < nDevs; d++) {
        devices.push(readDeviceTree(trackPath + " devices " + d, opts, 0));
    }
    return {
        index: index,
        category: category,
        id: Number(tApi.id) || 0,
        name: String(getScalar(tApi, "name") || ""),
        mute: Number(getScalar(tApi, "mute")) || 0,
        solo: Number(getScalar(tApi, "solo")) || 0,
        has_audio_input: Number(getScalar(tApi, "has_audio_input")) || 0,
        has_midi_input: Number(getScalar(tApi, "has_midi_input")) || 0,
        path: cleanPath(tApi.unquotedpath || tApi.path || trackPath),
        devices: devices
    };
}

function handleGetSessionInfo() {
    var setApi = makeApi("live_set");
    var tempo = Number(getScalar(setApi, "tempo")) || 120.0;
    var sigNum = Number(getScalar(setApi, "signature_numerator")) || 4;
    var sigDen = Number(getScalar(setApi, "signature_denominator")) || 4;
    var isPlaying = Number(getScalar(setApi, "is_playing")) || 0;
    var songTime = Number(getScalar(setApi, "current_song_time")) || 0.0;
    var loop = Number(getScalar(setApi, "loop")) || 0;
    var loopStart = Number(getScalar(setApi, "loop_start")) || 0.0;
    var loopLengthNum = Number(getScalar(setApi, "loop_length"));
    var loopLength = isNaN(loopLengthNum) ? 4.0 : loopLengthNum;
    var metronome = Number(getScalar(setApi, "metronome")) || 0;

    var nTracks = 0;
    var nReturns = 0;
    var nScenes = 0;
    try { nTracks = Number(setApi.getcount("tracks")) || 0; } catch (e) { nTracks = extractIds(setApi.get("tracks")).length; }
    try { nReturns = Number(setApi.getcount("return_tracks")) || 0; } catch (e) { nReturns = extractIds(setApi.get("return_tracks")).length; }
    try { nScenes = Number(setApi.getcount("scenes")) || 0; } catch (e) { nScenes = extractIds(setApi.get("scenes")).length; }

    var selectedTrack = null;
    try {
        var selTrackApi = makeApi("live_set view selected_track");
        if (selTrackApi && Number(selTrackApi.id) > 0) {
            selectedTrack = {
                id: Number(selTrackApi.id),
                name: String(getScalar(selTrackApi, "name") || ""),
                path: cleanPath(selTrackApi.unquotedpath || selTrackApi.path)
            };
        }
    } catch (eSel) {}

    sessionSnapshot.tempo = tempo;
    sessionSnapshot.isPlaying = isPlaying;
    sessionSnapshot.trackCount = nTracks;
    sessionSnapshot.sigNum = sigNum;
    sessionSnapshot.sigDen = sigDen;

    return {
        tempo: tempo,
        signature_numerator: sigNum,
        signature_denominator: sigDen,
        is_playing: isPlaying,
        current_song_time: songTime,
        loop: loop,
        loop_start: loopStart,
        loop_length: loopLength,
        metronome: metronome,
        track_count: nTracks,
        return_track_count: nReturns,
        scene_count: nScenes,
        selected_track: selectedTrack
    };
}

function handleGetTracksTree(params) {
    var opts = params || {};
    var setApi = makeApi("live_set");
    var nTracks = 0;
    try { nTracks = Number(setApi.getcount("tracks")) || 0; } catch (e) { nTracks = extractIds(setApi.get("tracks")).length; }

    var tracks = [];
    if (typeof opts.trackIndex === "number") {
        if (opts.trackIndex >= 0 && opts.trackIndex < nTracks && Math.floor(opts.trackIndex) === opts.trackIndex) {
            tracks.push(readTrackInfo("live_set tracks " + opts.trackIndex, opts.trackIndex, "track", opts));
        }
    } else {
        for (var t = 0; t < nTracks; t++) {
            tracks.push(readTrackInfo("live_set tracks " + t, t, "track", opts));
        }
    }

    var returnTracks = [];
    if (opts.includeReturns !== false && typeof opts.trackIndex !== "number") {
        var nReturns = 0;
        try { nReturns = Number(setApi.getcount("return_tracks")) || 0; } catch (e) { nReturns = extractIds(setApi.get("return_tracks")).length; }
        for (var r = 0; r < nReturns; r++) {
            returnTracks.push(readTrackInfo("live_set return_tracks " + r, r, "return_track", opts));
        }
    }

    var masterTrack = null;
    if (opts.includeMaster !== false && typeof opts.trackIndex !== "number") {
        try {
            masterTrack = readTrackInfo("live_set master_track", 0, "master_track", opts);
        } catch (eMaster) {}
    }

    sessionSnapshot.trackCount = nTracks;
    return {
        track_count: nTracks,
        tracks: tracks,
        return_tracks: returnTracks,
        master_track: masterTrack
    };
}

function handleLomGet(params) {
    var p = params || {};
    var api = requireExists(makeApi(p.path || "live_set"), p.path || "live_set");
    var res = {
        id: Number(api.id) || 0,
        path: cleanPath(api.unquotedpath || api.path || p.path),
        type: String(api.type || "")
    };
    if (p.property) {
        var props = Array.isArray(p.property) ? p.property : [p.property];
        res.properties = {};
        for (var i = 0; i < props.length; i++) {
            res.properties[props[i]] = getScalar(api, props[i]);
        }
        if (!Array.isArray(p.property)) {
            res.value = res.properties[p.property];
        }
    }
    if (p.childCount) {
        res.count = Number(api.getcount(p.childCount));
    }
    if (p.includeInfo) {
        res.info = String(api.info || "");
        res.children = api.children || [];
    }
    return res;
}

function handleLomSet(params) {
    var p = params || {};
    if (!p.path || !p.property) {
        throw new Error("lom_set requires 'path' and 'property'");
    }
    var api = requireExists(makeApi(p.path), p.path);
    api.set(p.property, p.value);
    return {
        path: cleanPath(api.unquotedpath || api.path || p.path),
        property: p.property,
        value: getScalar(api, p.property)
    };
}

function handleLomCall(params) {
    var p = params || {};
    if (!p.path || !p.method) {
        throw new Error("lom_call requires 'path' and 'method'");
    }
    var api = requireExists(makeApi(p.path), p.path);
    var callArgs = [p.method];
    if (Array.isArray(p.args)) {
        for (var i = 0; i < p.args.length; i++) callArgs.push(p.args[i]);
    } else if (p.args !== undefined) {
        callArgs.push(p.args);
    }
    var result = api.call.apply(api, callArgs);
    return {
        path: cleanPath(api.unquotedpath || api.path || p.path),
        method: p.method,
        result: result
    };
}

function handleGetDeviceParameters(params) {
    var p = params || {};
    if (!p.path) throw new Error("get_device_parameters requires 'path'");
    var devApi = requireExists(makeApi(p.path), p.path);
    var maxP = typeof p.maxParameters === "number" ? p.maxParameters : 128;
    var total = countParameters(p.path);
    return {
        total_parameters: total,
        truncated: total > maxP,
        device_id: Number(devApi.id) || 0,
        device_name: String(getScalar(devApi, "name") || ""),
        path: cleanPath(devApi.unquotedpath || devApi.path || p.path),
        parameters: readParameterList(p.path, maxP)
    };
}

function handleSetDeviceParameter(params) {
    var p = params || {};
    if (!p.path) throw new Error("set_device_parameter requires 'path'");
    requireExists(makeApi(p.path), p.path);
    var list = readParameterList(p.path, 4096);
    var targetParam = null;
    if (typeof p.paramIndex === "number") {
        targetParam = list[p.paramIndex] || null;
    } else if (p.paramName) {
        var needle = String(p.paramName).toLowerCase();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name.toLowerCase() === needle) {
                targetParam = list[i];
                break;
            }
        }
        if (!targetParam) {
            for (var j = 0; j < list.length; j++) {
                if (list[j].name.toLowerCase().indexOf(needle) !== -1) {
                    targetParam = list[j];
                    break;
                }
            }
        }
    }
    if (!targetParam) {
        throw new Error("Parameter not found on " + p.path);
    }
    if (typeof p.value !== "number" || !isFinite(p.value)) {
        throw new Error("set_device_parameter requires a numeric value");
    }
    var paramApi = makeApi(targetParam.path);
    var clamped = Math.max(targetParam.min, Math.min(targetParam.max, Number(p.value)));
    paramApi.set("value", clamped);
    var updatedVal = Number(getScalar(paramApi, "value"));
    var disp = "";
    try { disp = String(paramApi.call("str_for_value", updatedVal) || ""); } catch (e) {}
    return {
        device_path: cleanPath(p.path),
        parameter_index: targetParam.index,
        parameter_name: targetParam.name,
        value: updatedVal,
        display_value: disp
    };
}

function handleDeleteDevice(params) {
    var p = params || {};
    var parentPath = cleanPath(p.parentPath || "");
    var deviceIndex = typeof p.deviceIndex === "number" ? p.deviceIndex : -1;

    if (p.path && (!parentPath || deviceIndex < 0)) {
        var cleaned = cleanPath(p.path);
        var match = cleaned.match(/^(.*)\s+devices\s+(\d+)$/);
        if (!match) {
            throw new Error("Cannot parse parent container and device index from path: " + cleaned);
        }
        parentPath = match[1];
        deviceIndex = parseInt(match[2], 10);
    }

    if (!parentPath || deviceIndex < 0) {
        throw new Error("delete_device requires a device path, or a parentPath and a non-negative deviceIndex");
    }

    if (Math.floor(deviceIndex) !== deviceIndex) {
        throw new Error("delete_device requires an integer deviceIndex, got: " + deviceIndex);
    }

    var parentApi = makeApi(parentPath);
    var deviceCount = null;
    try { deviceCount = Number(parentApi.getcount("devices")); } catch (e) { deviceCount = null; }
    if (deviceCount !== null && isFinite(deviceCount) && deviceIndex >= deviceCount) {
        throw new Error("delete_device deviceIndex " + deviceIndex + " is out of range: parent has " + deviceCount + " device(s)");
    }
    var result = parentApi.call("delete_device", deviceIndex);
    return {
        deleted: true,
        parent_path: parentPath,
        device_index: deviceIndex,
        result: result
    };
}

function handleTransport(params) {
    var p = params || {};
    var setApi = makeApi("live_set");
    if (typeof p.tempo === "number") {
        setApi.set("tempo", Math.max(20.0, Math.min(999.0, p.tempo)));
    }
    var act = String(p.action || "").toLowerCase();
    if (act === "play" || act === "start_playing") {
        setApi.call("start_playing");
    } else if (act === "stop" || act === "stop_playing") {
        setApi.call("stop_playing");
    } else if (act === "continue" || act === "continue_playing") {
        setApi.call("continue_playing");
    } else if (act === "undo") {
        setApi.call("undo");
    } else if (act === "redo") {
        setApi.call("redo");
    } else if (act) {
        throw new Error("Unknown transport action: " + act);
    }
    return handleGetSessionInfo();
}

function handleInspectMbsplit() {
    var busInfo = {
        peers: [],
        groups: {},
        liveSetMbsplitDevices: []
    };

    if (typeof Global !== "undefined") {
        try {
            var g = new Global("mbsplit_shared_bus");
            /** @type {{ [id: string]: any }} */
            var gPeers = g && /** @type {{ [id: string]: any }} */ (g.peers);
            if (g && gPeers) {
                for (var id in gPeers) {
                    var peer = gPeers[id];
                    if (!peer) continue;
                    var peerEntry = {
                        id: id,
                        order: peer.order
                    };
                    try { if (typeof peer.isDeleted === "function") peerEntry.isDeleted = peer.isDeleted(); } catch (e) {}
                    try { if (typeof peer.getGroupKey === "function") peerEntry.groupKey = peer.getGroupKey(); } catch (e) {}
                    try { if (typeof peer.getChainIndex === "function") peerEntry.chainIndex = peer.getChainIndex(); } catch (e) {}
                    try { if (typeof peer.getLastSeen === "function") peerEntry.lastSeen = peer.getLastSeen(); } catch (e) {}
                    try { if (typeof peer.getLastDspBeatTime === "function") peerEntry.lastDspBeatTime = peer.getLastDspBeatTime(); } catch (e) {}
                    try { if (typeof peer.getDeviceId === "function") peerEntry.deviceId = peer.getDeviceId(); } catch (e) {}
                    try { if (typeof peer.getLomPath === "function") peerEntry.lomPath = peer.getLomPath(); } catch (e) {}
                    try { if (typeof peer.getDebugState === "function") peerEntry.state = peer.getDebugState(); } catch (e) {}
                    busInfo.peers.push(peerEntry);
                }
            }
            if (g && g.groups) {
                busInfo.groups = g.groups;
            }
        } catch (eBus) {
            busInfo.busError = String(eBus);
        }
    }

    try {
        var tree = handleGetTracksTree({ includeParameters: true, maxParameters: 12 });
        function collectMbsplit(devs) {
            if (!Array.isArray(devs)) return;
            for (var i = 0; i < devs.length; i++) {
                var d = devs[i];
                if (d.name && d.name.toLowerCase().indexOf("multiband split") !== -1) {
                    busInfo.liveSetMbsplitDevices.push(d);
                }
                if (Array.isArray(d.chains)) {
                    for (var c = 0; c < d.chains.length; c++) {
                        collectMbsplit(d.chains[c].devices);
                    }
                }
            }
        }
        for (var t = 0; t < tree.tracks.length; t++) {
            collectMbsplit(tree.tracks[t].devices);
        }
        for (var r = 0; r < tree.return_tracks.length; r++) {
            collectMbsplit(tree.return_tracks[r].devices);
        }
        if (tree.master_track) {
            collectMbsplit(tree.master_track.devices);
        }
    } catch (eTree) {}

    return busInfo;
}

function handleEvalJs(params) {
    var p = params || {};
    if (!p.code) throw new Error("eval_js requires 'code'");
    var fn = new Function("LiveAPI", "Global", "Buffer", "max", "makeApi", "getScalar", "extractIds", p.code);
    var out = fn(
        typeof LiveAPI !== "undefined" ? LiveAPI : undefined,
        typeof Global !== "undefined" ? Global : undefined,
        typeof Buffer !== "undefined" ? Buffer : undefined,
        typeof max !== "undefined" ? max : undefined,
        makeApi,
        getScalar,
        extractIds
    );
    return { result: out };
}

function dispatchRpcAction(action, params) {
    if (action === "ping") {
        var thisPath = "";
        try {
            var selfApi = makeApi("this_device");
            thisPath = cleanPath(selfApi.unquotedpath || selfApi.path);
        } catch (e) {}
        return {
            ok: true,
            bridge: "Ableton MCP Bridge",
            version: "1.0.0",
            this_device_path: thisPath,
            timestamp: Date.now()
        };
    }
    if (action === "get_session_info") return handleGetSessionInfo();
    if (action === "get_tracks_tree") return handleGetTracksTree(params);
    if (action === "lom_get") return handleLomGet(params);
    if (action === "lom_set") return handleLomSet(params);
    if (action === "lom_call") return handleLomCall(params);
    if (action === "get_device_parameters") return handleGetDeviceParameters(params);
    if (action === "set_device_parameter") return handleSetDeviceParameter(params);
    if (action === "delete_device") return handleDeleteDevice(params);
    if (action === "transport") return handleTransport(params);
    if (action === "inspect_mbsplit") return handleInspectMbsplit();
    if (action === "eval_js") return handleEvalJs(params);
    throw new Error("Unknown MCP RPC action: " + action);
}

function lom_rpc(reqId, jsonStr) {
    var t0 = Date.now();
    totalRpcCalls++;
    var action = "unknown";
    var target = "";
    try {
        var req = JSON.parse(String(jsonStr || "{}"));
        action = String(req.action || "ping");
        var params = req.params || {};
        target = String(params.path || params.action || "");
        lastRpcAction = action;

        var data = dispatchRpcAction(action, params);
        var dt = Date.now() - t0;
        lastRpcLatencyMs = dt;
        lastErrorMsg = "";

        rpcLog.unshift({
            time: new Date().toTimeString().slice(0, 8),
            action: action,
            target: target.slice(0, 22),
            ok: true,
            ms: dt
        });
        if (rpcLog.length > MAX_LOG_ITEMS) rpcLog.pop();

        outlet(0, ["lom_reply", String(reqId), JSON.stringify({ ok: true, result: data })]);
    } catch (err) {
        var errStr = String(err && err.message ? err.message : err);
        var dtErr = Date.now() - t0;
        lastRpcLatencyMs = dtErr;
        lastErrorMsg = errStr;

        rpcLog.unshift({
            time: new Date().toTimeString().slice(0, 8),
            action: action,
            target: errStr.slice(0, 22),
            ok: false,
            ms: dtErr
        });
        if (rpcLog.length > MAX_LOG_ITEMS) rpcLog.pop();

        outlet(0, ["lom_reply", String(reqId), JSON.stringify({ ok: false, error: errStr })]);
    }
    mgraphics.redraw();
}

function set_bridge_status(statusStr, portNum) {
    bridgeStatus = String(statusStr || "ONLINE");
    if (portNum) bridgePort = Number(portNum) || 9877;
    mgraphics.redraw();
}

function loadbang() {
    try {
        handleGetSessionInfo();
    } catch (e) {}
    mgraphics.redraw();
}

function onclick(x, y) {
    // [Refresh LOM] button (x: 120..182, y: 136..151)
    if (x >= 120 && x <= 182 && y >= 136 && y <= 151) {
        try {
            handleGetSessionInfo();
            lastErrorMsg = "";
        } catch (e) {
            lastErrorMsg = String(e.message || e);
        }
        mgraphics.redraw();
        return;
    }
    // [Clear Log] button (x: 186..240, y: 136..151)
    if (x >= 186 && x <= 240 && y >= 136 && y <= 151) {
        rpcLog = [];
        lastErrorMsg = "";
        mgraphics.redraw();
    }
}

function paint() {
    var sz = mgraphics.size;
    var w = (sz && sz[0]) ? sz[0] : CANVAS_W;
    var h = (sz && sz[1]) ? sz[1] : CANVAS_H;

    // Outer dark slate background
    mgraphics.set_source_rgba(0.055, 0.068, 0.090, 1.0);
    mgraphics.rectangle_rounded(0, 0, w, h, 6, 6);
    mgraphics.fill();

    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(0.18, 0.25, 0.35, 1.0);
    mgraphics.rectangle_rounded(0.5, 0.5, w - 1, h - 1, 6, 6);
    mgraphics.stroke();

    // Header bar
    mgraphics.set_source_rgba(0.08, 0.10, 0.14, 1.0);
    mgraphics.rectangle_rounded(4, 4, w - 8, 20, 4, 4);
    mgraphics.fill();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(8.5);
    mgraphics.set_source_rgba(0.92, 0.96, 1.0, 1.0);
    mgraphics.move_to(10, 17);
    mgraphics.show_text("ABLETON MCP BRIDGE");

    // Status pill
    var isOnline = (bridgeStatus === "ONLINE");
    var pillX = w - 84;
    mgraphics.set_source_rgba(isOnline ? 0.08 : 0.24, isOnline ? 0.26 : 0.18, isOnline ? 0.18 : 0.06, 1.0);
    mgraphics.rectangle_rounded(pillX, 6, 76, 16, 3, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(isOnline ? 0.20 : 0.95, isOnline ? 0.92 : 0.65, isOnline ? 0.55 : 0.20, 0.9);
    mgraphics.rectangle_rounded(pillX + 0.5, 6.5, 75, 15, 3, 3);
    mgraphics.stroke();

    mgraphics.set_source_rgba(isOnline ? 0.25 : 0.98, isOnline ? 0.96 : 0.72, isOnline ? 0.60 : 0.22, 1.0);
    mgraphics.arc(pillX + 7, 14, 2.2, 0, Math.PI * 2);
    mgraphics.fill();

    mgraphics.set_font_size(7.2);
    mgraphics.move_to(pillX + 12, 16.5);
    mgraphics.show_text(isOnline ? ("PORT " + bridgePort) : bridgeStatus.slice(0, 10));

    // Metrics Strip (y = 28..48)
    mgraphics.set_source_rgba(0.035, 0.045, 0.062, 1.0);
    mgraphics.rectangle_rounded(4, 28, w - 8, 20, 3, 3);
    mgraphics.fill();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(7.4);
    mgraphics.set_source_rgba(0.45, 0.82, 0.98, 1.0);
    mgraphics.move_to(9, 40.5);
    mgraphics.show_text("BPM " + Number(sessionSnapshot.tempo || 120).toFixed(1));

    mgraphics.set_source_rgba(sessionSnapshot.isPlaying ? 0.30 : 0.58, sessionSnapshot.isPlaying ? 0.95 : 0.64, sessionSnapshot.isPlaying ? 0.55 : 0.72, 1.0);
    mgraphics.move_to(68, 40.5);
    mgraphics.show_text(sessionSnapshot.isPlaying ? "PLAYING" : "STOPPED");

    mgraphics.set_source_rgba(0.75, 0.82, 0.92, 1.0);
    mgraphics.move_to(122, 40.5);
    mgraphics.show_text("TRK " + (sessionSnapshot.trackCount || 0));

    mgraphics.set_source_rgba(0.98, 0.75, 0.32, 1.0);
    mgraphics.move_to(166, 40.5);
    mgraphics.show_text("RPC " + totalRpcCalls + " (" + lastRpcLatencyMs + "ms)");

    // Command Log Viewport (y = 52..132)
    mgraphics.set_source_rgba(0.028, 0.035, 0.048, 1.0);
    mgraphics.rectangle_rounded(4, 52, w - 8, 80, 4, 4);
    mgraphics.fill();

    mgraphics.set_source_rgba(0.14, 0.20, 0.28, 0.9);
    mgraphics.rectangle_rounded(4.5, 52.5, w - 9, 79, 4, 4);
    mgraphics.stroke();

    if (rpcLog.length === 0) {
        mgraphics.select_font_face("Arial");
        mgraphics.set_font_size(7.5);
        mgraphics.set_source_rgba(0.45, 0.54, 0.66, 0.9);
        mgraphics.move_to(14, 94);
        mgraphics.show_text("Waiting for Cursor MCP commands on 127.0.0.1:" + bridgePort + "...");
    } else {
        for (var i = 0; i < rpcLog.length; i++) {
            var item = rpcLog[i];
            var ry = 56 + i * 14.5;
            mgraphics.set_source_rgba(item.ok ? 0.22 : 0.95, item.ok ? 0.90 : 0.35, item.ok ? 0.55 : 0.35, 0.95);
            mgraphics.arc(11, ry + 5, 2.0, 0, Math.PI * 2);
            mgraphics.fill();

            mgraphics.select_font_face("Arial Bold");
            mgraphics.set_font_size(7.2);
            mgraphics.set_source_rgba(0.88, 0.93, 0.98, 0.95);
            mgraphics.move_to(17, ry + 7.5);
            mgraphics.show_text(item.action);

            mgraphics.select_font_face("Arial");
            mgraphics.set_source_rgba(0.56, 0.66, 0.78, 0.9);
            mgraphics.move_to(108, ry + 7.5);
            mgraphics.show_text(String(item.target || ""));

            mgraphics.set_source_rgba(0.45, 0.55, 0.68, 0.85);
            mgraphics.move_to(w - 38, ry + 7.5);
            mgraphics.show_text(item.ms + "ms");
        }
    }

    // Bottom Bar (y = 136..152)
    mgraphics.select_font_face("Arial");
    mgraphics.set_font_size(7.0);
    mgraphics.set_source_rgba(0.52, 0.62, 0.74, 0.9);
    mgraphics.move_to(8, 146);
    mgraphics.show_text("LOM + Global Bus Ready");

    // [Refresh] button
    mgraphics.set_source_rgba(0.10, 0.14, 0.20, 1.0);
    mgraphics.rectangle_rounded(120, 136, 62, 15, 3, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.24, 0.36, 0.52, 0.9);
    mgraphics.rectangle_rounded(120.5, 136.5, 61, 14, 3, 3);
    mgraphics.stroke();
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(7.0);
    mgraphics.set_source_rgba(0.82, 0.90, 0.98, 1.0);
    mgraphics.move_to(130, 146);
    mgraphics.show_text("Refresh LOM");

    // [Clear] button
    mgraphics.set_source_rgba(0.10, 0.14, 0.20, 1.0);
    mgraphics.rectangle_rounded(186, 136, 54, 15, 3, 3);
    mgraphics.fill();
    mgraphics.set_source_rgba(0.24, 0.36, 0.52, 0.9);
    mgraphics.rectangle_rounded(186.5, 136.5, 53, 14, 3, 3);
    mgraphics.stroke();
    mgraphics.set_source_rgba(0.82, 0.90, 0.98, 1.0);
    mgraphics.move_to(197, 146);
    mgraphics.show_text("Clear Log");
}
