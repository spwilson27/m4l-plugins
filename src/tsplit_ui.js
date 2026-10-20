// Timbre Split — audio-reactive v8ui: MFCC fingerprint heatmap tinted by the winning class, class-membership
// timeline, learned centroid fingerprints, learn progress, class pills + Gain slider, link badge, and the
// cross-instance link engine (Rack/chain scoping, Auto class assignment, leader that learns, shared centroids).
// src/tsplit_config.js is prepended by scripts/build_tsplit.py (one script scope).
//
// Telemetry (src/tsplit_core.genexpr): Buffer `#0-tsplitscope`, 2592 floats, written by gen, read here every 40 ms.
//   header: 0 hop counter  1 head column  2 gate  3 samplerate  4 level dB  5 K  6..9 class gains  10 idle
//           12 latency  13 winner (1-based)
//   column j (0..127) at 32 + 20 j: c1..c13, c0, p1..p4, winner (1-based, 0 = gated), gate.
// Centroids are written by the leader's learner into `#0-tsplitcent` (centroid k at k * 16, c1..c13) in EVERY linked
// instance (each gen classifies with the same centroids, so the chains add up to the input).

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var INSTANCE_ID = "tsplit_" + Math.floor(Math.random() * 1e9) + "_" + Date.now();
var INSTANCE_ORDER = 0;

// ---- Shared parameters (linked across the instances of one Rack) ----
var curClasses = TSPLIT_DEFAULT_CLASSES;
var curSharp = TSPLIT_DEFAULT_SHARP;
var curSmooth = TSPLIT_DEFAULT_SMOOTH;
var curAdapt = 0;
var curLearned = 0;
/** @type {number[][]} */
var centroids = TSPLIT_PRIOR_CENTROIDS.map(function (c) { return c.slice(); });
// ---- Per chain ----
var curClassMode = 0;           // 0 = Auto (chain N passes class N), 1..4 = solo, 5 = multi
var curCustomMask = 1;
var curLinkGroup = 0;           // 0 = Auto (parent Rack), 1..4 = Grp A..D, 5 = Off
var curGainDb = 0.0;
var showLinkStatus = true;

// ---- Learning (only the leader instance runs it; the others mirror its progress) ----
var learning = false;
var learnProgress = 0;
var learnHopsDone = 0;
var learnTargetHops = 0;
var learnPollTick = 0;
var learnOwner = false;         // true on the instance whose learner is running
/** @type {any} */
var learner = null;
var adaptDirty = false;
var adaptTick = 0;

var rackContext = {
    parentRackPath: "standalone_default", chainIndex: 0, deviceIndex: 0, nestingDepth: 0,
    isInRack: false, shortLabel: "RACK #1 CH1"
};

var isApplyingRemoteSync = false;
var isDeleted = false;
var selfLomAlive = true;
var lastKnownAlive = true;
var selfDeviceId = 0;
var selfLomPath = "";
var lastHandledLomPath = "";
/** @type {any} */
var selfLiveApi = null;
var lastSeenTime = Date.now();
var lastEffectiveGroupKey = null;
var lastRank = 0;
var lastPeerCount = 1;

// Mouse interaction state
var dragVolume = false;
var volDragLastY = 0;
var volDragNorm = 0.72;
var isCursorStolen = false;
var hoverPill = -1;
var hoverAutoBtn = false;
var hoverVolSlider = false;
var hoverLinkBadge = false;
var lastClickTime = 0;
var lastClickTarget = "";
var lastClickX = -999;
var lastClickY = -999;
var undoStack = [];
var redoStack = [];
var MAX_UNDO = 32;

// ---- Telemetry / display state ----
var TSPLIT_COLS = 128;
var TSPLIT_HDR = 32;
var TSPLIT_STRIDE = 20;
var TSPLIT_BUF_LEN = 32 + 128 * 20;
var NCOL = 128;                 // display columns
var DEC = 3;                    // hops merged into one display column (about 16 ms)
var scopeBufName = "";
var centBufName = "";
var scopeSampleRate = 48000.0;
var lastCounter = -1;
var lastIdle = -1;
var demoActive = true;
var needRedraw = false;
var gateOpen = 0;
var levelDb = -200;
var liveGains = [1, 0, 0, 0];
var dMfcc = [];
var dW = [];
var dWin = [];
var accN = 0;
var accM = [];
var accW = [];
var accWin = 0;
var reportedLatency = -1;
var selfPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;

var C_BG = [0.040, 0.044, 0.072];
var C_TXT = [0.80, 0.84, 0.92];
var C_DIM = [0.46, 0.50, 0.60];
var C_AMBER = [1.0, 0.72, 0.22];

function resetAcc() {
    accN = 0;
    accM = [];
    accW = [0, 0, 0, 0];
    accWin = 0;
    for (var k = 0; k < TSPLIT_NC; k++) accM.push(0);
}

function emptyHistory() {
    dMfcc = [];
    dW = [];
    dWin = [];
    for (var i = 0; i < NCOL; i++) {
        var z = [];
        for (var k = 0; k < TSPLIT_NC; k++) z.push(0);
        dMfcc.push(z);
        dW.push([0, 0, 0, 0]);
        dWin.push(0);
    }
    resetAcc();
}

function stealMouseCursor() {
    isCursorStolen = true;
    if (typeof max !== "undefined" && typeof max.hidecursor === "function") {
        try { max.hidecursor(); } catch (err) {}
    }
}

function releaseMouseCursor() {
    if (!isCursorStolen) return;
    isCursorStolen = false;
    if (typeof max !== "undefined" && typeof max.showcursor === "function") {
        try { max.showcursor(); } catch (err) {}
    }
}

// =========================================================================
// SHARED CROSS-INSTANCE LINK REGISTRY
// =========================================================================
function getSharedBus() {
    if (typeof Global !== "undefined") {
        try {
            var g = new Global("tsplit_shared_bus");
            if (!g.groups) g.groups = {};
            if (!g.peers) g.peers = {};
            if (typeof g.nextOrder !== "number") g.nextOrder = 1;
            if (typeof g.isBroadcastingTopology !== "boolean") g.isBroadcastingTopology = false;
            return g;
        } catch (err) {}
    }
    if (typeof global !== "undefined") {
        if (!global.__tsplit_shared_bus) {
            global.__tsplit_shared_bus = { groups: {}, peers: {}, nextOrder: 1, isBroadcastingTopology: false };
        }
        return global.__tsplit_shared_bus;
    }
    return { groups: {}, peers: {}, nextOrder: 1, isBroadcastingTopology: false };
}

function getBaseGroupKey() {
    return resolveLinkGroupKey(curLinkGroup, rackContext.parentRackPath);
}

/**
 * True when this is the left-most alive Timbre Split in its own `(parentRackPath, chainIndex)` chain. A Cmd+D
 * duplicate to its right stays in an isolated one-chain group (it must not take a class of the Rack).
 */
function isLeftMostInOwnChain() {
    var myParent = rackContext.parentRackPath || "standalone_default";
    if (myParent === "standalone_default") return true;
    var myChain = Number(rackContext.chainIndex) || 0;
    var myDevIdx = Number(rackContext.deviceIndex) || 0;
    var myOrder = Number(INSTANCE_ORDER) || 999999999;
    var bus = getSharedBus();
    if (!bus || !bus.peers) return true;
    for (var id in bus.peers) {
        if (id === INSTANCE_ID) continue;
        var p = bus.peers[id];
        if (!p) continue;
        try {
            if (typeof p.isDeleted === "function" && p.isDeleted()) continue;
            if (typeof p.isAlive === "function" && !p.isAlive()) continue;
            var pLink = (typeof p.getLinkGroup === "function") ? (Number(p.getLinkGroup()) || 0) : 0;
            if (pLink !== 0) continue;
            var pParent = (typeof p.getParentRackPath === "function") ? (p.getParentRackPath() || "standalone_default") : "standalone_default";
            if (pParent !== myParent) continue;
            var pChain = (typeof p.getChainIndex === "function") ? (Number(p.getChainIndex()) || 0) : 0;
            if (pChain !== myChain) continue;
            var pDevIdx = (typeof p.getDeviceIndex === "function") ? (Number(p.getDeviceIndex()) || 0) : 0;
            var pOrder = Number(p.order) || 999999999;
            if (pDevIdx < myDevIdx) return false;
            if (pDevIdx === myDevIdx && pOrder < myOrder) return false;
            if (pDevIdx === myDevIdx && pOrder === myOrder && String(id) < String(INSTANCE_ID)) return false;
        } catch (err) {}
    }
    return true;
}

function getActiveGroupKey() {
    var baseKey = resolveLinkGroupKey(curLinkGroup, rackContext.parentRackPath);
    if (!baseKey) return null;
    if (Math.round(Number(curLinkGroup) || 0) === 0 && !isLeftMostInOwnChain()) {
        return "rack_group::isolated::" + INSTANCE_ID;
    }
    return baseKey;
}

function refreshAllSiblingLomPathsQuietly() {
    var bus = getSharedBus();
    if (!bus || !bus.peers) return;
    var pIds = Object.keys(bus.peers);
    for (var i = 0; i < pIds.length; i++) {
        var sib = bus.peers[pIds[i]];
        if (sib && sib.id !== INSTANCE_ID && typeof sib.refreshOwnLomState === "function") {
            try { sib.refreshOwnLomState(false, true); } catch (eSib) {}
        }
    }
}

function extractSingleLomId(rawId) {
    if (typeof rawId === "number") return rawId;
    if (Array.isArray(rawId)) {
        for (var i = 0; i < rawId.length; i++) {
            var n = Number(rawId[i]);
            if (!isNaN(n) && n > 0) return n;
        }
        return 0;
    }
    var m = String(rawId || "").match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
}

/**
 * Checks that `this_device` is still inside the Live Set (not in Live's Undo trash) and picks up reordering /
 * moving of the device. In v8ui `new LiveAPI(..., "this_device")` resolves relative to the patcher that owns the
 * running Task, so it is created only on our own thread (isOwnThread !== false) and reused for sibling queries.
 */
function refreshSelfLomState(isOwnThread, quietPathUpdate) {
    if (isDeleted) {
        selfLomAlive = false;
        return false;
    }
    if (typeof LiveAPI === "undefined") {
        selfLomAlive = true;
        return true;
    }
    try {
        var isMockEnv = (selfDeviceId === 42);
        if (!selfLiveApi || isMockEnv) {
            if (isOwnThread === false && !isMockEnv) return selfLomAlive;
            selfLiveApi = new LiveAPI(function () {}, "this_device");
        }
        if (!selfLiveApi) {
            selfLomAlive = false;
            return false;
        }
        var devId = (selfLiveApi.id !== undefined) ? extractSingleLomId(selfLiveApi.id) : 1;
        if (selfLiveApi.id !== undefined && devId <= 0) {
            selfLomAlive = false;
            return false;
        }
        var rawPath = String(selfLiveApi.unquotedpath || selfLiveApi.path || "").replace(/^["']+|["']+$/g, "").trim();
        if (!rawPath || rawPath.indexOf("live_set") !== 0) {
            // In the Undo trash: probe now and then in case Cmd+Z restored the device
            if (isOwnThread !== false && !selfLomAlive && devId !== 42) {
                try {
                    var probeApi = new LiveAPI(function () {}, "this_device");
                    var probePath = String(probeApi.unquotedpath || probeApi.path || "").replace(/^["']+|["']+$/g, "").trim();
                    if (probePath && probePath.indexOf("live_set") === 0) {
                        selfLiveApi = probeApi;
                        rawPath = probePath;
                        devId = extractSingleLomId(probeApi.id) || devId;
                    }
                } catch (eProbe) {}
            }
            if (!rawPath || rawPath.indexOf("live_set") !== 0) {
                selfLomAlive = false;
                return false;
            }
        }
        var prevLomPath = selfLomPath;
        var prevGroupKey = lastEffectiveGroupKey || getActiveGroupKey();
        var prevBaseKey = getBaseGroupKey();
        selfDeviceId = devId;
        var parsed = parseRackContextFromPath(rawPath);
        selfLomPath = rawPath;
        rackContext = parsed;
        var wasAlive = selfLomAlive;
        selfLomAlive = true;
        if (!quietPathUpdate) {
            var comparePath = lastHandledLomPath || prevLomPath;
            lastHandledLomPath = rawPath;
            if (wasAlive && comparePath && rawPath !== comparePath) {
                refreshAllSiblingLomPathsQuietly();
                handleDynamicPathChange(prevGroupKey, getActiveGroupKey(), prevBaseKey, getBaseGroupKey());
            }
        }
        return true;
    } catch (err) {
        return selfLomAlive;
    }
}

function isSelfCurrentlyAlive() {
    return !isDeleted && selfLomAlive;
}

/** Alive peers of `groupKey`, sorted the way the chains read (chain, device, creation order). */
function getAliveGroupPeers(groupKey) {
    var key = groupKey !== undefined ? groupKey : getActiveGroupKey();
    if (!key) return [];
    var bus = getSharedBus();
    if (!bus || !bus.peers) return [];
    var alive = [];
    for (var id in bus.peers) {
        var p = bus.peers[id];
        if (!p) {
            delete bus.peers[id];
            continue;
        }
        try {
            if (typeof p.isDeleted === "function" && p.isDeleted()) {
                delete bus.peers[id];
                continue;
            }
            if (typeof p.isAlive === "function" && !p.isAlive()) continue;
            if (typeof p.getGroupKey === "function" && p.getGroupKey() === key) alive.push(p);
        } catch (err) {
            delete bus.peers[id];
        }
    }
    var desc = alive.map(function (p) {
        return {
            id: p.id, order: p.order,
            chainIndex: (typeof p.getChainIndex === "function") ? p.getChainIndex() : 0,
            deviceIndex: (typeof p.getDeviceIndex === "function") ? p.getDeviceIndex() : 0,
            peer: p
        };
    });
    return sortPeerDescriptors(desc).map(function (d) { return d.peer; });
}

function getLinkedPeerCount() {
    var key = getActiveGroupKey();
    if (!key) return 1;
    return Math.max(1, getAliveGroupPeers(key).length);
}

/** 0-based rank of this instance among the alive linked instances (chain order). */
function getEffectiveChainRank() {
    var key = getActiveGroupKey();
    if (!key) return 0;
    var alive = getAliveGroupPeers(key);
    for (var i = 0; i < alive.length; i++) {
        if (alive[i].id === INSTANCE_ID) return i;
    }
    return Math.max(0, Math.round(rackContext.chainIndex || 0));
}

/** The leader (learns, adapts, owns the shared centroids) is the first alive linked instance. */
function getLeaderPeer() {
    var key = getActiveGroupKey();
    if (!key) return null;
    var alive = getAliveGroupPeers(key);
    return alive.length ? alive[0] : null;
}

function isLeader() {
    var lp = getLeaderPeer();
    return !lp || lp.id === INSTANCE_ID;
}

function getEffectiveMask() {
    return resolveEffectiveClassMask(curClassMode, lastRank, lastPeerCount, curClasses, curCustomMask);
}

function notifySiblingPeersOfTopologyChange(groupKey) {
    var bus = getSharedBus();
    if (!bus || bus.isBroadcastingTopology) return;
    var key = groupKey !== undefined ? groupKey : getActiveGroupKey();
    if (!key || !bus.peers) return;
    bus.isBroadcastingTopology = true;
    try {
        var peerIds = Object.keys(bus.peers);
        for (var i = 0; i < peerIds.length; i++) {
            var pid = peerIds[i];
            if (pid === INSTANCE_ID) continue;
            var peer = bus.peers[pid];
            if (!peer) continue;
            try {
                if (typeof peer.isAlive === "function" && peer.isAlive() && typeof peer.onPeersChanged === "function") {
                    var pKey = (typeof peer.getGroupKey === "function") ? peer.getGroupKey() : null;
                    var pBase = (typeof peer.getBaseGroupKey === "function") ? peer.getBaseGroupKey() : null;
                    var pLast = (typeof peer.getLastEffectiveGroupKey === "function") ? peer.getLastEffectiveGroupKey() : null;
                    if (pKey === key || pBase === key || pLast === key) peer.onPeersChanged();
                }
            } catch (ePeer) {}
        }
    } finally {
        bus.isBroadcastingTopology = false;
    }
}

/**
 * Recomputes the group key, peer count and rank. A changed group adopts the new group's shared state (if others
 * live there). Returns true when anything changed (the mask may differ).
 */
function updateTopology(notifySiblings) {
    var prevKey = lastEffectiveGroupKey;
    var key = getActiveGroupKey();
    var groupChanged = (prevKey !== null && key !== prevKey);
    lastEffectiveGroupKey = key;
    var bus = getSharedBus();
    if (groupChanged && key && key.indexOf("rack_group::isolated::") !== 0 && bus && bus.groups && bus.groups[key]) {
        var others = getAliveGroupPeers(key).filter(function (p) { return p && p.id !== INSTANCE_ID; });
        if (others.length) adoptSharedState(bus.groups[key]);
    }
    var count = getLinkedPeerCount();
    var rank = getEffectiveChainRank();
    var changed = groupChanged || count !== lastPeerCount || rank !== lastRank;
    lastPeerCount = count;
    lastRank = rank;
    if (changed && notifySiblings !== false) {
        if (groupChanged && prevKey) notifySiblingPeersOfTopologyChange(prevKey);
        notifySiblingPeersOfTopologyChange(key);
        var baseKey = getBaseGroupKey();
        if (baseKey && baseKey !== key) notifySiblingPeersOfTopologyChange(baseKey);
    }
    return changed;
}

function handleDynamicPathChange(prevGroupKey, newGroupKey, prevBaseKey, newBaseKey) {
    if (prevGroupKey && prevGroupKey !== newGroupKey) {
        notifySiblingPeersOfTopologyChange(prevGroupKey);
        if (prevBaseKey && prevBaseKey !== prevGroupKey) notifySiblingPeersOfTopologyChange(prevBaseKey);
        syncFromExistingGroupIfAvailable();
    } else {
        updateTopology(false);
    }
    notifySiblingPeersOfTopologyChange(newGroupKey);
    if (newBaseKey && newBaseKey !== newGroupKey) notifySiblingPeersOfTopologyChange(newBaseKey);
    emitDspState(true);
    notifyclients();
    mgraphics.redraw();
}

function handlePeerTopologyChange() {
    if (!isSelfCurrentlyAlive()) return;
    var changed = updateTopology(false);
    if (learning && learnOwner && !isLeader()) {
        // a new chain appeared to our left and took over as leader: our unfinished take is dropped
        learning = false;
        learnOwner = false;
        learner = null;
    } else if (learning && !learnOwner && isLeader()) {
        learning = false; // the leader that was learning is gone
    }
    emitDspState(true);
    if (changed) notifyclients();
    mgraphics.redraw();
}

function registerPeerInBus() {
    if (isDeleted) return;
    var bus = getSharedBus();
    if (!INSTANCE_ORDER) INSTANCE_ORDER = bus.nextOrder++;
    lastSeenTime = Date.now();
    lastKnownAlive = isSelfCurrentlyAlive();
    bus.peers[INSTANCE_ID] = {
        id: INSTANCE_ID,
        order: INSTANCE_ORDER,
        isDeleted: function () { return isDeleted; },
        isAlive: function () { return isSelfCurrentlyAlive(); },
        getLastSeen: function () { return lastSeenTime; },
        getDeviceId: function () { return selfDeviceId; },
        getLomPath: function () { return selfLomPath; },
        getLinkGroup: function () { return curLinkGroup; },
        getParentRackPath: function () { return rackContext.parentRackPath || "standalone_default"; },
        getBaseGroupKey: function () { return getBaseGroupKey(); },
        getLastEffectiveGroupKey: function () { return lastEffectiveGroupKey; },
        getGroupKey: function () { return getActiveGroupKey(); },
        getChainIndex: function () { return rackContext.chainIndex; },
        getDeviceIndex: function () { return rackContext.deviceIndex || 0; },
        refreshOwnLomState: function (isOwnThread, quietPathUpdate) {
            return refreshSelfLomState(isOwnThread === true, quietPathUpdate === true);
        },
        getDebugState: function () {
            return {
                classes: curClasses, classMode: curClassMode, rank: lastRank, peerCount: lastPeerCount,
                mask: getEffectiveMask(), chainIndex: rackContext.chainIndex || 0,
                deviceIndex: rackContext.deviceIndex || 0, isLeftMostInChain: isLeftMostInOwnChain(),
                isLeader: isLeader(), learning: learning, learned: curLearned,
                effectiveGroupKey: getActiveGroupKey(), baseGroupKey: getBaseGroupKey(),
                selfLomAlive: selfLomAlive, isDeleted: isDeleted
            };
        },
        onPeersChanged: function () { handlePeerTopologyChange(); },
        applyRemoteState: function (state) { applyLinkedStateFromPeer(state); },
        requestLearn: function (on) { return requestLearnLocal(on); }
    };
    updateTopology(true);
}

function markSelfDeletedAndNotifyPeers() {
    releaseMouseCursor();
    var key = getActiveGroupKey();
    var baseKey = getBaseGroupKey();
    var wasLeader = isLeader();
    isDeleted = true;
    selfLomAlive = false;
    lastKnownAlive = false;
    learning = false;
    learnOwner = false;
    try {
        var bus = getSharedBus();
        if (bus && bus.peers && bus.peers[INSTANCE_ID]) delete bus.peers[INSTANCE_ID];
        notifySiblingPeersOfTopologyChange(key);
        if (baseKey && baseKey !== key) notifySiblingPeersOfTopologyChange(baseKey);
    } catch (err) {}
    return wasLeader;
}

function notifydeleted() {
    markSelfDeletedAndNotifyPeers();
}

function freebang() {
    markSelfDeletedAndNotifyPeers();
}

// =========================================================================
// SHARED STATE (classes, Sharp, Smooth, Adapt, centroids, learn progress) over the Global bus
// =========================================================================
function makeSharedPayload(key) {
    return {
        groupKey: key, senderId: INSTANCE_ID,
        classes: curClasses, sharp: curSharp, smooth: curSmooth, adapt: curAdapt, learned: curLearned,
        learning: learning ? 1 : 0, progress: learnProgress,
        centroids: centroids.map(function (c) { return c.slice(); }),
        timestamp: Date.now()
    };
}

function adoptSharedState(state) {
    if (!state) return;
    curClasses = clamp(Math.round(Number(state.classes) || curClasses), 2, TSPLIT_MAX_CLASSES);
    curSharp = clamp(Number(state.sharp), 0, 100);
    curSmooth = clamp(Number(state.smooth), 0, 60);
    if (isNaN(curSharp)) curSharp = TSPLIT_DEFAULT_SHARP;
    if (isNaN(curSmooth)) curSmooth = TSPLIT_DEFAULT_SMOOTH;
    curAdapt = Number(state.adapt) > 0.5 ? 1 : 0;
    curLearned = Number(state.learned) > 0.5 ? 1 : 0;
    var remoteLearning = Number(state.learning) > 0.5;
    if (!isLeader()) {
        learning = remoteLearning;
        learnProgress = Number(state.progress) || 0;
    }
    if (state.centroids && state.centroids.length >= TSPLIT_MAX_CLASSES) {
        centroids = state.centroids.map(function (c) { return Array.prototype.slice.call(c, 0, TSPLIT_NC); });
        pokeCentroids();
    }
}

function syncFromExistingGroupIfAvailable() {
    var key = getActiveGroupKey();
    updateTopology(false);
    if (!key) return false;
    var bus = getSharedBus();
    var existing = bus.groups[key];
    var others = getAliveGroupPeers(key).filter(function (p) { return p && p.id !== INSTANCE_ID; });
    if (existing && others.length && existing.senderId !== INSTANCE_ID) {
        adoptSharedState(existing);
        emitDspState(true);
        return true;
    }
    bus.groups[key] = makeSharedPayload(key);
    return false;
}

function broadcastLinkedState() {
    if (isApplyingRemoteSync || !isSelfCurrentlyAlive()) return;
    updateTopology(false);
    var key = getActiveGroupKey();
    if (!key) return;
    var bus = getSharedBus();
    var payload = makeSharedPayload(key);
    bus.groups[key] = payload;
    var alive = getAliveGroupPeers(key);
    for (var i = 0; i < alive.length; i++) {
        var peer = alive[i];
        if (peer && peer.id !== INSTANCE_ID) {
            try { peer.applyRemoteState(payload); } catch (err) {}
        }
    }
}

function applyLinkedStateFromPeer(state) {
    if (!state || state.senderId === INSTANCE_ID || !isSelfCurrentlyAlive()) return;
    var myKey = getActiveGroupKey();
    if (!myKey || (state.groupKey && state.groupKey !== myKey)) return;
    isApplyingRemoteSync = true;
    try {
        adoptSharedState(state);
        updateTopology(false);
        emitDspState(true);
        notifyclients();
        mgraphics.redraw();
    } finally {
        isApplyingRemoteSync = false;
    }
}

// =========================================================================
// LIVE OBJECT MODEL (LOM) PARENT RACK & NESTED CHAIN DISCOVERY
// =========================================================================
function applyDiscoveredPath(lomPath) {
    isDeleted = false;
    selfLomAlive = true;
    selfLomPath = String(lomPath || "").replace(/^["']+|["']+$/g, "").trim();
    lastHandledLomPath = selfLomPath;
    var prevKey = lastEffectiveGroupKey || getActiveGroupKey();
    rackContext = parseRackContextFromPath(selfLomPath);
    refreshAllSiblingLomPathsQuietly();
    registerPeerInBus();
    var newKey = getActiveGroupKey();
    if (newKey !== prevKey) syncFromExistingGroupIfAvailable();
    else updateTopology(true);
    var baseKey = getBaseGroupKey();
    if (baseKey) notifySiblingPeersOfTopologyChange(baseKey);
    emitDspState(true);
    mgraphics.redraw();
}

function discoverRackContext() {
    if (typeof LiveAPI === "undefined") {
        registerPeerInBus();
        emitDspState(true);
        return;
    }
    try {
        selfLiveApi = new LiveAPI(function () {}, "this_device");
        if (selfLiveApi) {
            selfDeviceId = extractSingleLomId(selfLiveApi.id) || 1;
            var p = String(selfLiveApi.unquotedpath || selfLiveApi.path || "");
            if (p) {
                applyDiscoveredPath(p);
                return;
            }
        }
    } catch (err) {}
    registerPeerInBus();
    emitDspState(true);
}

function set_lom_path(pathStr) {
    applyDiscoveredPath(pathStr);
}

// =========================================================================
// CENTROIDS -> gen buffer, LEARNING (leader) and ADAPT (leader)
// =========================================================================
function pokeCentroids() {
    if (!centBufName || typeof Buffer === "undefined") return;
    try {
        var b = new Buffer(centBufName);
        b.poke(1, 0, centroidsToBufferArray(centroids));
    } catch (err) {}
}

function readTempo() {
    if (typeof LiveAPI === "undefined") return 120;
    try {
        var api = new LiveAPI(function () {}, "live_set");
        var t = api.get("tempo");
        var v = Array.isArray(t) ? Number(t[0]) : Number(t);
        return (isNaN(v) || v < 20) ? 120 : v;
    } catch (err) {
        return 120;
    }
}

function startLearning() {
    var bpm = readTempo();
    learnTargetHops = learnHopsForBars(TSPLIT_LEARN_BARS, bpm, scopeSampleRate);
    learnHopsDone = 0;
    learnProgress = 0;
    learnPollTick = 0;
    learner = createKMeansLearner(curClasses, 4242);
    learning = true;
    learnOwner = true;
    adaptDirty = false;
}

function finishLearning(abort) {
    var l = learner;
    learning = false;
    learnOwner = false;
    learner = null;
    if (!abort && l && l.frameCount() >= TSPLIT_LEARN_MIN_FRAMES) {
        var fin = l.finalize();
        while (fin.length < TSPLIT_MAX_CLASSES) fin.push(TSPLIT_PRIOR_CENTROIDS[fin.length].slice());
        centroids = fin;
        curLearned = 1;
        pokeCentroids();
    }
    learnProgress = 0;
    emitDspState(true);
    broadcastLinkedState();
    notifyclients();
    mgraphics.redraw();
}

/** Called on the leader (directly, or through the bus by a follower's Learn button). */
function requestLearnLocal(on) {
    if (isDeleted) return false;
    if (on) {
        if (!learning) startLearning();
    } else if (learning) {
        finishLearning(false);
        return true;
    }
    emitDspState(true);
    broadcastLinkedState();
    mgraphics.redraw();
    return true;
}

function set_learn(v) {
    var on = Number(v) > 0.5;
    if (isLeader()) {
        requestLearnLocal(on);
        return;
    }
    var lp = getLeaderPeer();
    var ok = false;
    try {
        ok = !!(lp && typeof lp.requestLearn === "function" && lp.requestLearn(on));
    } catch (err) {}
    if (!ok) outlet(0, ["ui_learn", 0]);
}

/** One fresh hop of telemetry for the learner / adapt. feat = c1..c13, p = memberships. */
function learnerFeed(feat, p) {
    if (!isLeader() || isDeleted) return;
    if (learning && learner) {
        learner.add(feat);
        return;
    }
    if (curAdapt && curLearned) {
        var eta = 0.00015; // per hop: time constant about 1 / eta hops = 35 s, a slow drift
        for (var k = 0; k < curClasses; k++) {
            var w = (Number(p[k]) || 0) * eta;
            for (var d = 0; d < TSPLIT_NC; d++) centroids[k][d] += w * (feat[d] - centroids[k][d]);
        }
        adaptDirty = true;
    }
}

function learnerTick(freshHops) {
    if (!isLeader() || isDeleted) return;
    if (learning && learner) {
        learnHopsDone += freshHops;
        learnProgress = clamp(learnHopsDone / Math.max(learnTargetHops, 1), 0, 1);
        learnPollTick++;
        if (learnProgress >= 1) {
            finishLearning(false);
        } else if (learnPollTick % 6 === 0 && learner.frameCount() >= curClasses * 4) {
            centroids = learner.centroids();
            while (centroids.length < TSPLIT_MAX_CLASSES) centroids.push(TSPLIT_PRIOR_CENTROIDS[centroids.length].slice());
            pokeCentroids();
            broadcastLinkedState();
            needRedraw = true;
        }
    } else if (adaptDirty) {
        adaptTick++;
        if (adaptTick % 12 === 0) {
            adaptDirty = false;
            pokeCentroids();
            broadcastLinkedState();
            notifyclients();
        }
    }
}

// =========================================================================
// UNDO / REDO & STATE SERIALIZATION
// =========================================================================
function snapshotState() {
    return {
        classes: curClasses, sharp: curSharp, smooth: curSmooth, adapt: curAdapt, classMode: curClassMode,
        customMask: curCustomMask, linkGroup: curLinkGroup, gainDb: curGainDb, showLinkStatus: showLinkStatus ? 1 : 0
    };
}

function pushUndoState() {
    undoStack.push(snapshotState());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
}

function applySnapshot(snap) {
    if (!snap) return;
    curClasses = snap.classes;
    curSharp = snap.sharp;
    curSmooth = snap.smooth;
    curAdapt = snap.adapt;
    curClassMode = snap.classMode;
    curCustomMask = snap.customMask;
    curLinkGroup = snap.linkGroup;
    curGainDb = snap.gainDb;
    showLinkStatus = Boolean(snap.showLinkStatus);
    emitDspState(true);
    broadcastLinkedState();
    notifyclients();
    mgraphics.redraw();
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(snapshotState());
    applySnapshot(undoStack.pop());
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(snapshotState());
    applySnapshot(redoStack.pop());
}

function currentState() {
    return {
        classes: curClasses, sharp: curSharp, smooth: curSmooth, adapt: curAdapt, classMode: curClassMode,
        customMask: curCustomMask, linkGroup: curLinkGroup, gainDb: curGainDb,
        showLinkStatus: showLinkStatus ? 1 : 0, learned: curLearned, centroids: centroids
    };
}

// Saved with the Set / presets (parameter_type 3). First element is the version; see encodeStateBlob().
function getvalueof() {
    return encodeStateBlob(currentState());
}

function setvalueof() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 1 && Array.isArray(args[0])) args = args[0];
    if (!args || args.length === 0) return;
    var st = decodeStateBlob(args, currentState());
    curClasses = st.classes;
    curSharp = st.sharp;
    curSmooth = st.smooth;
    curAdapt = st.adapt;
    curClassMode = st.classMode;
    curCustomMask = st.customMask;
    curLinkGroup = st.linkGroup;
    curGainDb = st.gainDb;
    showLinkStatus = Boolean(st.showLinkStatus);
    curLearned = st.learned;
    centroids = st.centroids.map(function (c) { return c.slice(); });
    pokeCentroids();
    emitDspState(true);
    broadcastLinkedState();
    mgraphics.redraw();
}

// =========================================================================
// DSP & UI PARAMETER SYNC EMITTERS
// =========================================================================
function emitDspState(syncUiControls) {
    var mask = getEffectiveMask();
    outlet(0, ["classes", curClasses]);
    outlet(0, ["sharp", curSharp]);
    outlet(0, ["smooth", curSmooth]);
    outlet(0, ["gain", curGainDb]);
    outlet(0, ["cmask", mask]);
    if (syncUiControls) {
        outlet(0, ["ui_classes", curClasses]);
        outlet(0, ["ui_sharp", curSharp]);
        outlet(0, ["ui_smooth", curSmooth]);
        outlet(0, ["ui_adapt", curAdapt]);
        outlet(0, ["ui_learn", learning ? 1 : 0]);
        outlet(0, ["ui_classmode", curClassMode]);
        outlet(0, ["ui_linkgroup", curLinkGroup]);
        outlet(0, ["ui_gain", curGainDb]);
    }
}

function afterSharedChange() {
    emitDspState(false);
    broadcastLinkedState();
    notifyclients();
    mgraphics.redraw();
}

function set_classes(v) {
    var n = clamp(Math.round(Number(v) || TSPLIT_DEFAULT_CLASSES), 2, TSPLIT_MAX_CLASSES);
    if (n === curClasses) return;
    curClasses = n;
    if (curClassMode >= 1 && curClassMode <= 4 && curClassMode > n) curClassMode = n;
    if (learning && isLeader()) finishLearning(true);
    afterSharedChange();
}

function set_sharp(v) {
    var n = clamp(Number(v), 0, 100);
    if (isNaN(n)) return;
    curSharp = n;
    afterSharedChange();
}

function set_smooth(v) {
    var n = clamp(Number(v), 0, 60);
    if (isNaN(n)) return;
    curSmooth = n;
    afterSharedChange();
}

function set_adapt(v) {
    curAdapt = Number(v) > 0.5 ? 1 : 0;
    afterSharedChange();
}

function set_classmode(m) {
    var mode = clamp(Math.round(Number(m) || 0), 0, 5);
    curClassMode = mode;
    if (mode >= 1 && mode <= 4) curCustomMask = 1 << (mode - 1);
    emitDspState(false);
    mgraphics.redraw();
}

function set_linkgroup(g) {
    curLinkGroup = clamp(Math.round(Number(g) || 0), 0, 5);
    registerPeerInBus();
    if (!syncFromExistingGroupIfAvailable()) broadcastLinkedState();
    emitDspState(true);
    mgraphics.redraw();
}

function set_gain(db) {
    var g = Number(db);
    if (isNaN(g)) g = 0.0;
    curGainDb = clamp(g, TSPLIT_MIN_GAIN_DB, TSPLIT_MAX_GAIN_DB);
    outlet(0, ["gain", curGainDb]);
    mgraphics.redraw();
}

function set_show_link(v) {
    showLinkStatus = (Number(v) > 0.5);
    mgraphics.redraw();
}

function setbuffer(name) {
    scopeBufName = String(name || "");
}

function setcent(name) {
    centBufName = String(name || "");
    pokeCentroids();
}

function loadbang() {
    isDeleted = false;
    registerPeerInBus();
    discoverRackContext();
    if (!syncFromExistingGroupIfAvailable()) {
        emitDspState(true);
        broadcastLinkedState();
    }
    pokeCentroids();
    mgraphics.redraw();
}

/** Live re-reads the static patcher attribute `latency` at runtime; this is the constant lookahead delay. */
function updateDeviceLatency() {
    if (reportedLatency === TSPLIT_LATENCY || !selfPatcher) return;
    try {
        selfPatcher.setattr("latency", TSPLIT_LATENCY);
        reportedLatency = TSPLIT_LATENCY;
    } catch (err) {}
}

// =========================================================================
// TELEMETRY POLLING
// =========================================================================
function commitAcc() {
    var col = [];
    var k;
    for (k = 0; k < TSPLIT_NC; k++) col.push(accM[k] / Math.max(accN, 1));
    var w = [];
    var best = 0;
    for (k = 0; k < 4; k++) {
        w.push(accW[k] / Math.max(accN, 1));
        if (w[k] > w[best]) best = k;
    }
    dMfcc.push(col);
    dW.push(w);
    dWin.push(accWin > 0 ? best + 1 : 0);
    dMfcc.shift();
    dW.shift();
    dWin.shift();
    resetAcc();
}

function pushHop(d, base) {
    var gate = (Number(d[base + 19]) || 0) > 0.5;
    var feat = [];
    var p = [];
    var k;
    for (k = 0; k < TSPLIT_NC; k++) {
        var v = Number(d[base + k]) || 0;
        feat.push(v);
        accM[k] += v;
    }
    for (k = 0; k < 4; k++) {
        var pv = Number(d[base + 14 + k]) || 0;
        p.push(pv);
        accW[k] += pv;
    }
    if ((Number(d[base + 18]) || 0) > 0.5) accWin = 1;
    accN++;
    if (accN >= DEC) commitAcc();
    if (gate && (Number(d[base + 18]) || 0) > 0.5) learnerFeed(feat, p);
}

function pullScope() {
    if (isDeleted) return;
    var now = Date.now();
    refreshAllSiblingLomPathsQuietly();
    refreshSelfLomState(true);
    var aliveNow = isSelfCurrentlyAlive();
    if (!aliveNow) {
        if (lastKnownAlive) {
            lastKnownAlive = false;
            var prevEff = lastEffectiveGroupKey;
            var baseKey = getBaseGroupKey();
            if (prevEff && prevEff !== baseKey) notifySiblingPeersOfTopologyChange(prevEff);
            if (baseKey) notifySiblingPeersOfTopologyChange(baseKey);
        }
        return;
    }
    lastSeenTime = now;
    if (!lastKnownAlive) {
        // Restored from Undo (Cmd+Z): single transition inactive -> active
        lastKnownAlive = true;
        updateTopology(true);
        var restoredBase = getBaseGroupKey();
        if (restoredBase) notifySiblingPeersOfTopologyChange(restoredBase);
        emitDspState(true);
        broadcastLinkedState();
    } else if (updateTopology(true)) {
        emitDspState(true);
    }
    updateDeviceLatency();

    if (!scopeBufName || typeof Buffer === "undefined") return;
    try {
        var buf = new Buffer(scopeBufName);
        var d = buf.peek(1, 0, TSPLIT_BUF_LEN);
        if (!d || d.length < TSPLIT_BUF_LEN) return;
        var counter = Number(d[0]) || 0;
        var idle = (Number(d[10]) || 0) > 0.5 ? 1 : 0;
        if (counter !== lastCounter) {
            if (demoActive) {
                emptyHistory();
                demoActive = false;
            }
            var fresh = lastCounter < 0 ? TSPLIT_COLS : (counter - lastCounter + 1000000) % 1000000;
            if (fresh > TSPLIT_COLS) fresh = TSPLIT_COLS;
            var head = clamp(Math.floor(Number(d[1]) || 0), 0, TSPLIT_COLS - 1);
            for (var j = fresh - 1; j >= 0; j--) {
                var colIdx = (head - j + TSPLIT_COLS) % TSPLIT_COLS;
                pushHop(d, TSPLIT_HDR + colIdx * TSPLIT_STRIDE);
            }
            if (lastCounter >= 0) learnerTick(fresh);
            lastCounter = counter;
            gateOpen = Number(d[2]) || 0;
            scopeSampleRate = Math.max(8000.0, Number(d[3]) || 48000.0);
            levelDb = Number(d[4]) || -200;
            for (var g = 0; g < 4; g++) liveGains[g] = clamp(Number(d[6 + g]) || 0, 0, 1);
            needRedraw = true;
        }
        if (idle !== lastIdle) {
            lastIdle = idle;
            needRedraw = true;
        }
    } catch (err) {}
    if (learning || adaptDirty) needRedraw = true;
    if (needRedraw) {
        needRedraw = false;
        mgraphics.redraw();
    }
}

var pollTask = null;
if (typeof Task !== "undefined") {
    try {
        pollTask = new Task(pullScope, this);
        pollTask.interval = 40;
        pollTask.repeat();
    } catch (err) {}
}

// =========================================================================
// DEMO (preview and the first moments in Live, until telemetry arrives)
// =========================================================================
function buildDemo() {
    emptyHistory();
    // kick, hat, snare, hat, kick, kick, snare, hat ... each ~14 display columns, cross-faded
    var order = [0, 2, 1, 2, 0, 0, 1, 2, 0];
    var span = 14;
    for (var i = 0; i < NCOL; i++) {
        var seg = Math.floor(i / span);
        var pos = i - seg * span;
        var cls = order[seg % order.length];
        var prev = order[(seg + order.length - 1) % order.length];
        var t = pos < 3 ? (pos + 1) / 4 : 1;
        var w = [0, 0, 0, 0];
        w[cls] += t;
        w[prev] += 1 - t;
        // decay: late columns of a hit are quieter and less distinct
        var decay = Math.exp(-pos / (cls === 2 ? 3.0 : (cls === 1 ? 6.0 : 9.0)));
        for (var k = 0; k < TSPLIT_NC; k++) {
            var a = TSPLIT_PRIOR_CENTROIDS[cls][k];
            var b = TSPLIT_PRIOR_CENTROIDS[prev][k];
            var texture = 0.35 * Math.sin(i * 1.7 + k * 2.3) + 0.2 * Math.cos(i * 0.9 - k);
            dMfcc[i][k] = (a * t + b * (1 - t)) * (0.35 + 0.65 * decay) + texture;
        }
        dW[i] = w;
        dWin[i] = (decay < 0.04 && cls === 2) ? 0 : (w[cls] >= w[prev] ? cls + 1 : prev + 1);
    }
}

function preview() {
    demoActive = true;
    curClasses = 3;
    curLearned = 1;
    curClassMode = 0;
    curGainDb = 0.0;
    showLinkStatus = true;
    learning = false;
    rackContext = {
        parentRackPath: "live_set tracks 0 devices 0", deviceIndex: 0, chainIndex: 1, nestingDepth: 1,
        isInRack: true, shortLabel: "RACK #1 CH2"
    };
    lastRank = 1;
    lastPeerCount = 3;
    liveGains = [0.05, 0.82, 0.13, 0];
    buildDemo();
    centroids = [
        [11.4, 2.1, 1.7, 0.9, 0.7, 0.5, 0.4, 0.3, 0.3, 0.2, 0.2, 0.1, 0.2],
        [-0.3, -5.6, -2.4, -2.9, -2.4, -1.3, 0.8, 2.4, 3.6, 3.5, 1.7, -1.1, -3.4],
        [-0.2, -0.3, 0.1, -0.5, -0.7, -0.4, -0.2, 0.1, 0.1, -0.1, 0.4, 1.1, 0.5],
        TSPLIT_PRIOR_CENTROIDS[3].slice()
    ];
}

// =========================================================================
// GEOMETRY + TEXT HELPERS (Arial Bold metrics, no text_measure so the preview and Max agree)
// =========================================================================
function geom(w, h) {
    var hx = 19;
    return {
        heat: [hx, 21, w - hx - 3, 52],
        tl: [hx, 76, w - hx - 3, 26],
        fp: [3, 113, 26, 37],
        fpGap: 3,
        bar: [128, 105, w - 128 - 3, 11],
        meters: [128, 119, w - 128 - 3, 4, 5]
    };
}

function charW(ch) {
    if (ch === " ") return 0.278;
    if ("ijl.,:;'|!".indexOf(ch) >= 0) return 0.278;
    if ("tfrI()-/".indexOf(ch) >= 0) return 0.36;
    if ("mM".indexOf(ch) >= 0) return 0.89;
    if ("wW".indexOf(ch) >= 0) return 0.82;
    if ("0123456789".indexOf(ch) >= 0) return 0.556;
    if (ch >= "A" && ch <= "Z") return 0.72;
    return 0.6;
}

function textW(s, size) {
    var t = 0;
    for (var i = 0; i < s.length; i++) t += charW(s.charAt(i));
    return t * size;
}

function fitText(s, size, maxW) {
    if (textW(s, size) <= maxW) return s;
    var out = s;
    while (out.length > 1 && textW(out + "..", size) > maxW) out = out.substring(0, out.length - 1);
    return out + "..";
}

function text(s, x, y, size, c, a) {
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(size);
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? 1 : a);
    mgraphics.move_to(x, y);
    mgraphics.show_text(s);
}

function inRect(x, y, r) {
    return x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];
}

function getAutoBtnRect() {
    return [3, 2, 32, 15];
}

function getVolumeSliderRect() {
    var size = mgraphics.size || [270, 153];
    var w = size[0] || 270;
    return [w - 68, 2, 65, 15];
}

function getPillRect(idx) {
    var nb = clamp(curClasses, 2, TSPLIT_MAX_CLASSES);
    var ar = getAutoBtnRect();
    var vr = getVolumeSliderRect();
    var startX = ar[0] + ar[2] + 3;
    var availW = (vr[0] - 3) - startX;
    var gap = 2.5;
    var pillW = (availW - gap * (nb - 1)) / nb;
    return [startX + idx * (pillW + gap), ar[1], pillW, ar[3]];
}

function getLinkBadgeRect() {
    var size = mgraphics.size || [270, 153];
    var w = size[0] || 270;
    var h = size[1] || 153;
    var bw = showLinkStatus ? 134 : 30;
    var bh = 11;
    return [w - bw - 3, h - bh - 3, bw, bh];
}

// =========================================================================
// COLOUR MAP for the fingerprint (same as Timbre Follower)
// =========================================================================
var CM_STOPS = [
    [-1.0, 0.20, 0.62, 0.98],
    [-0.5, 0.10, 0.30, 0.62],
    [0.0, 0.046, 0.052, 0.085],
    [0.35, 0.50, 0.14, 0.52],
    [0.70, 0.96, 0.40, 0.34],
    [1.0, 1.0, 0.90, 0.58]
];
var CM_N = 41;
var cmLut = [];
(function buildLut() {
    for (var i = 0; i < CM_N; i++) {
        var t = -1 + 2 * i / (CM_N - 1);
        var lo = CM_STOPS[0];
        var hi = CM_STOPS[CM_STOPS.length - 1];
        for (var s = 0; s < CM_STOPS.length - 1; s++) {
            if (t >= CM_STOPS[s][0] && t <= CM_STOPS[s + 1][0]) {
                lo = CM_STOPS[s];
                hi = CM_STOPS[s + 1];
                break;
            }
        }
        var f = (t - lo[0]) / Math.max(hi[0] - lo[0], 1e-6);
        cmLut.push([lo[1] + (hi[1] - lo[1]) * f, lo[2] + (hi[2] - lo[2]) * f, lo[3] + (hi[3] - lo[3]) * f]);
    }
})();

var ROW_SCALE = [9, 7, 6, 5, 5, 4, 4, 3.5, 3.5, 3.5, 3, 3, 3];

function lutIndex(v, scale) {
    var t = v / scale;
    t = t < 0 ? -Math.pow(Math.min(-t, 1.4), 0.8) : Math.pow(Math.min(t, 1.4), 0.8);
    t = clamp(t, -1, 1);
    return Math.round((t + 1) * 0.5 * (CM_N - 1));
}

// =========================================================================
// DRAWING
// =========================================================================
function classColor(idx) {
    return TSPLIT_CLASS_COLORS[clamp(idx, 0, TSPLIT_MAX_CLASSES - 1)];
}

function drawHeat(g) {
    var r = g.heat;
    var x0 = r[0], y0 = r[1], w = r[2], h = r[3];
    var mid = cmLut[(CM_N - 1) / 2];
    mgraphics.set_source_rgba(mid[0], mid[1], mid[2], 1);
    mgraphics.rectangle(x0, y0, w, h);
    mgraphics.fill();
    var cw = w / NCOL;
    var ch = h / TSPLIT_NC;
    for (var i = 0; i < NCOL; i++) {
        var col = dMfcc[i];
        var win = dWin[i];
        var tint = win > 0 ? classColor(win - 1) : null;
        for (var k = 0; k < TSPLIT_NC; k++) {
            var li = lutIndex(col[k], ROW_SCALE[k]);
            if (li === (CM_N - 1) / 2) {
                if (tint) {
                    // quiet cells of a classified column still carry a faint class wash
                    mgraphics.set_source_rgba(tint[0], tint[1], tint[2], 0.07);
                    mgraphics.rectangle(x0 + i * cw, y0 + k * ch, cw + 0.5, ch + 0.4);
                    mgraphics.fill();
                }
                continue;
            }
            var c = cmLut[li];
            if (tint) {
                // tint = blend toward the winning class colour at the cell's own brightness
                var lum = Math.min(1, 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] + 0.18);
                mgraphics.set_source_rgba(c[0] * 0.35 + tint[0] * lum * 0.65, c[1] * 0.35 + tint[1] * lum * 0.65, c[2] * 0.35 + tint[2] * lum * 0.65, 1);
            } else {
                mgraphics.set_source_rgba(c[0] * 0.55, c[1] * 0.55, c[2] * 0.6, 1);
            }
            mgraphics.rectangle(x0 + i * cw, y0 + k * ch, cw + 0.5, ch + 0.4);
            mgraphics.fill();
        }
        if (tint) {
            // 2 px class tick along the top edge of each column
            mgraphics.set_source_rgba(tint[0], tint[1], tint[2], 0.95);
            mgraphics.rectangle(x0 + i * cw, y0, cw + 0.5, 1.6);
            mgraphics.fill();
        }
    }
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.16, 0.18, 0.28, 1);
    mgraphics.rectangle(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    mgraphics.stroke();
    /** @type {Array<[number, string]>} */
    var lab = [[0, "c1"], [6, "c7"], [12, "c13"]];
    for (var l = 0; l < lab.length; l++) {
        text(lab[l][1], 3, y0 + (lab[l][0] + 0.5) * ch + 2.3, 6.2, C_DIM, 0.9);
    }
}

function drawTimeline(g) {
    var r = g.tl;
    var x0 = r[0], y0 = r[1], w = r[2], h = r[3];
    mgraphics.set_source_rgba(0.028, 0.032, 0.054, 1);
    mgraphics.rectangle(x0, y0, w, h);
    mgraphics.fill();
    var cw = w / NCOL;
    var plotH = h - 2;
    var nk = clamp(curClasses, 2, TSPLIT_MAX_CLASSES);
    for (var i = 0; i < NCOL; i++) {
        var wv = dW[i];
        var sum = 0;
        var k;
        for (k = 0; k < nk; k++) sum += wv[k];
        if (sum < 1e-6) continue;
        var open = dWin[i] > 0;
        var yb = y0 + h - 1;
        for (k = 0; k < nk; k++) {
            var hh = plotH * (wv[k] / sum);
            if (hh < 0.05) continue;
            var c = classColor(k);
            mgraphics.set_source_rgba(c[0], c[1], c[2], open ? 0.9 : 0.28);
            mgraphics.rectangle(x0 + i * cw, yb - hh, cw + 0.5, hh);
            mgraphics.fill();
            yb -= hh;
        }
    }
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.16, 0.18, 0.28, 1);
    mgraphics.rectangle(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    mgraphics.stroke();
    text("w", 6, y0 + h * 0.5 + 2.3, 6.2, C_DIM, 0.9);
}

function drawFingerprints(g) {
    var nk = clamp(curClasses, 2, TSPLIT_MAX_CLASSES);
    var mask = getEffectiveMask();
    text("CENTROIDS", 3, 111, 6.2, C_DIM, 0.95);
    var fp = g.fp;
    for (var k = 0; k < nk; k++) {
        var x = fp[0] + k * (fp[2] + g.fpGap);
        var y = fp[1];
        var col = classColor(k);
        var on = (mask & (1 << k)) !== 0;
        mgraphics.set_source_rgba(0.028, 0.032, 0.054, 1);
        mgraphics.rectangle(x, y, fp[2], fp[3]);
        mgraphics.fill();
        var ch = (fp[3] - 2) / TSPLIT_NC;
        for (var d = 0; d < TSPLIT_NC; d++) {
            var li = lutIndex(centroids[k][d], ROW_SCALE[d]);
            var c = cmLut[li];
            mgraphics.set_source_rgba(c[0], c[1], c[2], 1);
            mgraphics.rectangle(x + 1, y + 1 + d * ch, fp[2] - 2, ch + 0.3);
            mgraphics.fill();
        }
        mgraphics.set_line_width(on ? 1.6 : 1.0);
        mgraphics.set_source_rgba(col[0], col[1], col[2], on ? 1 : 0.55);
        mgraphics.rectangle(x + 0.5, y + 0.5, fp[2] - 1, fp[3] - 1);
        mgraphics.stroke();
        text(String(k + 1), x + fp[2] - 6.5, y + 7.5, 6.6, [1, 1, 1], 0.95);
    }
}

function drawLearnBar(g) {
    var b = g.bar;
    var x = b[0], y = b[1], w = b[2], h = b[3];
    mgraphics.set_source_rgba(0.070, 0.076, 0.112, 1);
    mgraphics.rectangle_rounded(x, y, w, h, 3, 3);
    mgraphics.fill();
    var label;
    if (learning) {
        var fw = Math.max(2, (w - 2) * learnProgress);
        mgraphics.set_source_rgba(C_AMBER[0], C_AMBER[1], C_AMBER[2], 0.78);
        mgraphics.rectangle_rounded(x + 1, y + 1, fw, h - 2, 2, 2);
        mgraphics.fill();
        label = "LEARNING " + Math.round(learnProgress * 100) + "%";
    } else if (curLearned) {
        mgraphics.set_source_rgba(0.20, 0.55, 0.50, 0.55);
        mgraphics.rectangle_rounded(x + 1, y + 1, w - 2, h - 2, 2, 2);
        mgraphics.fill();
        label = "LEARNED " + curClasses + " CLASSES" + (curAdapt ? " + ADAPT" : "");
    } else {
        label = "FACTORY PRIOR - PRESS LEARN";
    }
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(learning ? C_AMBER[0] : 0.22, learning ? C_AMBER[1] : 0.26, learning ? C_AMBER[2] : 0.36, 0.9);
    mgraphics.rectangle_rounded(x + 0.5, y + 0.5, w - 1, h - 1, 3, 3);
    mgraphics.stroke();
    text(fitText(label, 6.8, w - 8), x + 5, y + h - 3.2, 6.8, [0.94, 0.96, 1.0], 1);
}

function drawMeters(g) {
    var m = g.meters;
    var nk = clamp(curClasses, 2, TSPLIT_MAX_CLASSES);
    var mask = getEffectiveMask();
    for (var k = 0; k < nk; k++) {
        var y = m[1] + k * m[4];
        var col = classColor(k);
        var on = (mask & (1 << k)) !== 0;
        var x0 = m[0] + 8;
        var w = m[2] - 8;
        text(String(k + 1), m[0], y + 4.6, 6.0, col, on ? 1 : 0.6);
        mgraphics.set_source_rgba(0.070, 0.076, 0.112, 1);
        mgraphics.rectangle(x0, y, w, m[3]);
        mgraphics.fill();
        var fw = w * clamp(liveGains[k], 0, 1);
        if (fw > 0.4) {
            mgraphics.set_source_rgba(col[0], col[1], col[2], on ? 0.95 : 0.4);
            mgraphics.rectangle(x0, y, fw, m[3]);
            mgraphics.fill();
        }
    }
}

function drawTopVolumeSlider() {
    var vr = getVolumeSliderRect();
    var vx = vr[0], vy = vr[1], vw = vr[2], vh = vr[3];
    var norm = gainDbToSliderNorm(curGainDb);
    var zeroNorm = gainDbToSliderNorm(0.0);
    mgraphics.set_source_rgba(0.07, 0.09, 0.12, 1.0);
    mgraphics.rectangle_rounded(vx, vy, vw, vh, 3, 3);
    mgraphics.fill();
    var fillW = Math.max(0.0, (vw - 2) * norm);
    if (fillW > 0.5) {
        var isBoost = (curGainDb > 0.05);
        mgraphics.set_source_rgba(isBoost ? 0.44 : 0.16, isBoost ? 0.34 : 0.38, isBoost ? 0.14 : 0.48, 0.95);
        mgraphics.rectangle_rounded(vx + 1, vy + 1, fillW, vh - 2, 2, 2);
        mgraphics.fill();
    }
    var zeroX = Math.round(vx + 1 + (vw - 2) * zeroNorm) + 0.5;
    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(0.55, 0.68, 0.82, 0.45);
    mgraphics.move_to(zeroX, vy + 2);
    mgraphics.line_to(zeroX, vy + vh - 2);
    mgraphics.stroke();
    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(dragVolume ? 0.38 : (hoverVolSlider ? 0.32 : 0.22), dragVolume ? 0.86 : (hoverVolSlider ? 0.72 : 0.28), dragVolume ? 0.98 : (hoverVolSlider ? 0.88 : 0.36), 0.95);
    mgraphics.rectangle_rounded(vx + 0.5, vy + 0.5, vw - 1, vh - 1, 3, 3);
    mgraphics.stroke();
    var gLabel = formatGainDb(curGainDb);
    text(gLabel, vx + (gLabel.length >= 7 ? 7 : 10), vy + vh - 4.2, 7.5, [0.92, 0.96, 1.0], 1);
}

function drawTopBar() {
    var mask = getEffectiveMask();
    var ar = getAutoBtnRect();
    var isAuto = (curClassMode === 0);
    mgraphics.set_source_rgba(isAuto ? 0.14 : (hoverAutoBtn ? 0.12 : 0.08), isAuto ? 0.34 : (hoverAutoBtn ? 0.16 : 0.10), isAuto ? 0.44 : (hoverAutoBtn ? 0.22 : 0.14), 1.0);
    mgraphics.rectangle_rounded(ar[0], ar[1], ar[2], ar[3], 3, 3);
    mgraphics.fill();
    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(isAuto ? 0.28 : 0.22, isAuto ? 0.82 : 0.28, isAuto ? 0.96 : 0.36, isAuto ? 0.95 : 0.7);
    mgraphics.rectangle_rounded(ar[0] + 0.5, ar[1] + 0.5, ar[2] - 1, ar[3] - 1, 3, 3);
    mgraphics.stroke();
    text("AUTO", ar[0] + 5, ar[1] + ar[3] - 4.2, 7.2, isAuto ? [0.55, 0.94, 1.0] : [0.62, 0.68, 0.76], 1);

    var nk = clamp(curClasses, 2, TSPLIT_MAX_CLASSES);
    for (var b = 0; b < nk; b++) {
        var pr = getPillRect(b);
        var isOn = ((mask & (1 << b)) !== 0);
        var col = classColor(b);
        mgraphics.set_source_rgba(isOn ? col[0] * 0.26 : 0.075, isOn ? col[1] * 0.26 : 0.090, isOn ? col[2] * 0.26 : 0.115, 1.0);
        mgraphics.rectangle_rounded(pr[0], pr[1], pr[2], pr[3], 3, 3);
        mgraphics.fill();
        var gk = clamp(liveGains[b] || 0, 0, 1);
        if (gk > 0.01) {
            mgraphics.set_source_rgba(col[0], col[1], col[2], isOn ? 0.6 : 0.25);
            mgraphics.rectangle(pr[0] + 2, pr[1] + pr[3] - 2.5, Math.max(2, (pr[2] - 4) * gk), 1.8);
            mgraphics.fill();
        }
        mgraphics.set_line_width(isOn ? 1.2 : 1.0);
        mgraphics.set_source_rgba(isOn ? col[0] : 0.20, isOn ? col[1] : 0.25, isOn ? col[2] : 0.32, isOn ? 0.95 : 0.65);
        mgraphics.rectangle_rounded(pr[0] + 0.5, pr[1] + 0.5, pr[2] - 1, pr[3] - 1, 3, 3);
        mgraphics.stroke();
        mgraphics.set_source_rgba(isOn ? col[0] : 0.30, isOn ? col[1] : 0.35, isOn ? col[2] : 0.42, isOn ? 1.0 : 0.55);
        mgraphics.arc(pr[0] + 6.0, pr[1] + pr[3] * 0.5, 1.9, 0, Math.PI * 2);
        mgraphics.fill();
        var pLabel = "CLASS " + (b + 1);
        if (textW(pLabel, 6.8) + 13 > pr[2]) pLabel = "CLS " + (b + 1);
        if (textW(pLabel, 6.8) + 13 > pr[2]) pLabel = String(b + 1);
        text(pLabel, pr[0] + 11, pr[1] + pr[3] - 4.2, 6.8, isOn ? [0.96, 0.98, 1.0] : [0.55, 0.62, 0.70], 1);
    }
    drawTopVolumeSlider();
}

function drawLinkBadge() {
    var lr = getLinkBadgeRect();
    var lx = lr[0], ly = lr[1], lw = lr[2], lh = lr[3];
    var linkNames = [rackContext.shortLabel, "GRP A", "GRP B", "GRP C", "GRP D", "UNLINKED"];
    var linkLabel = linkNames[curLinkGroup] || rackContext.shortLabel;
    var peers = lastPeerCount;
    var badge = (curLinkGroup === 5) ? "LINK: OFF" : ("LINK: " + linkLabel + " (" + peers + "x)" + (isLeader() ? " LEAD" : ""));
    mgraphics.set_source_rgba(0.04, 0.055, 0.075, showLinkStatus ? 0.88 : 0.72);
    mgraphics.rectangle_rounded(lx, ly, lw, lh, 3, 3);
    mgraphics.fill();
    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(hoverLinkBadge ? 0.38 : 0.22, hoverLinkBadge ? 0.82 : 0.34, hoverLinkBadge ? 0.96 : 0.46, showLinkStatus ? 0.85 : 0.55);
    mgraphics.rectangle_rounded(lx + 0.5, ly + 0.5, lw - 1, lh - 1, 3, 3);
    mgraphics.stroke();
    var isLinked = (curLinkGroup !== 5);
    mgraphics.set_source_rgba(isLinked ? 0.25 : 0.45, isLinked ? 0.88 : 0.50, isLinked ? 0.72 : 0.58, showLinkStatus ? 0.98 : 0.75);
    mgraphics.arc(lx + 5.5, ly + lh * 0.5, 2.0, 0, Math.PI * 2);
    mgraphics.fill();
    if (showLinkStatus) text(fitText(badge, 6.6, lw - 13), lx + 10, ly + lh - 3.0, 6.6, [0.76, 0.90, 0.98], 0.96);
    else text("LNK", lx + 9.5, ly + lh - 3.0, 6.6, [0.76, 0.90, 0.98], 0.78);
}

function paint() {
    var sz = mgraphics.size;
    var w = sz[0] || 270;
    var h = sz[1] || 153;
    if (dMfcc.length === 0) {
        if (demoActive) buildDemo();
        else emptyHistory();
    }
    var g = geom(w, h);
    mgraphics.set_source_rgba(C_BG[0], C_BG[1], C_BG[2], 1);
    mgraphics.rectangle_rounded(0, 0, w, h, 5, 5);
    mgraphics.fill();
    drawTopBar();
    drawHeat(g);
    drawTimeline(g);
    drawFingerprints(g);
    drawLearnBar(g);
    drawMeters(g);
    drawLinkBadge();
}

// =========================================================================
// MOUSE (AUTO, class pills, Gain slider, link badge)
// =========================================================================
function onclick(x, y, but, cmd, shift) {
    var now = Date.now();

    var vr = getVolumeSliderRect();
    if (inRect(x, y, vr)) {
        if (lastClickTarget === "vol" && (now - lastClickTime) < 320 && Math.abs(x - lastClickX) < 5 && Math.abs(y - lastClickY) < 5) {
            releaseMouseCursor();
            pushUndoState();
            curGainDb = 0.0;
            volDragNorm = gainDbToSliderNorm(0.0);
            emitDspState(true);
            notifyclients();
            mgraphics.redraw();
            lastClickTime = 0;
            dragVolume = false;
            return;
        }
        lastClickTime = now;
        lastClickTarget = "vol";
        lastClickX = x;
        lastClickY = y;
        pushUndoState();
        dragVolume = true;
        volDragLastY = y;
        volDragNorm = gainDbToSliderNorm(curGainDb);
        stealMouseCursor();
        mgraphics.redraw();
        return;
    }

    var ar = getAutoBtnRect();
    if (inRect(x, y, ar)) {
        pushUndoState();
        curClassMode = 0;
        emitDspState(true);
        notifyclients();
        mgraphics.redraw();
        return;
    }

    for (var b = 0; b < curClasses; b++) {
        var pr = getPillRect(b);
        if (inRect(x, y, pr)) {
            pushUndoState();
            var rightMultiToggle = (x >= pr[0] + pr[2] - 12);
            if (shift || cmd || rightMultiToggle) {
                curCustomMask = getEffectiveMask() ^ (1 << b);
                curClassMode = 5;
            } else {
                curClassMode = b + 1;
                curCustomMask = 1 << b;
            }
            emitDspState(true);
            notifyclients();
            mgraphics.redraw();
            return;
        }
    }

    var lr = getLinkBadgeRect();
    if (inRect(x, y, lr)) {
        showLinkStatus = !showLinkStatus;
        notifyclients();
        mgraphics.redraw();
    }
}

function ondblclick(x, y) {
    var vr = getVolumeSliderRect();
    if (inRect(x, y, vr)) {
        releaseMouseCursor();
        pushUndoState();
        curGainDb = 0.0;
        volDragNorm = gainDbToSliderNorm(0.0);
        emitDspState(true);
        notifyclients();
        dragVolume = false;
        mgraphics.redraw();
    }
}

function ondrag(x, y, but, cmd, shift) {
    if (!dragVolume) return;
    if (but === 0) {
        dragVolume = false;
        releaseMouseCursor();
        notifyclients();
        mgraphics.redraw();
        return;
    }
    var dy = volDragLastY - y;
    volDragLastY = y;
    if (Math.abs(dy) > 0) lastClickTime = 0;
    var stepPerPx = shift ? 0.0015 : 0.008;
    volDragNorm = clamp(volDragNorm + dy * stepPerPx, 0.0, 1.0);
    curGainDb = sliderNormToGainDb(volDragNorm);
    emitDspState(true);
    mgraphics.redraw();
}

function onidle(x, y) {
    var prevP = hoverPill;
    var prevA = hoverAutoBtn;
    var prevV = hoverVolSlider;
    var prevL = hoverLinkBadge;
    hoverAutoBtn = inRect(x, y, getAutoBtnRect());
    hoverVolSlider = inRect(x, y, getVolumeSliderRect());
    hoverLinkBadge = inRect(x, y, getLinkBadgeRect());
    hoverPill = -1;
    for (var b = 0; b < curClasses; b++) {
        if (inRect(x, y, getPillRect(b))) {
            hoverPill = b;
            break;
        }
    }
    if (prevP !== hoverPill || prevA !== hoverAutoBtn || prevV !== hoverVolSlider || prevL !== hoverLinkBadge) mgraphics.redraw();
}

function onidleout() {
    var dirty = hoverAutoBtn || hoverVolSlider || hoverLinkBadge || hoverPill >= 0;
    hoverAutoBtn = false;
    hoverVolSlider = false;
    hoverLinkBadge = false;
    hoverPill = -1;
    releaseMouseCursor();
    if (dirty) mgraphics.redraw();
}

emptyHistory();
