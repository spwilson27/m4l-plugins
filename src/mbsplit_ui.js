// Multiband Split — Block-Size 8192 Harmonic Spectrogram, Linkwitz-Riley Crossover Editor,
// Auto Instance-Count Band Creator (1..4 Bands) & Cross-Instance Link Engine (v8ui)

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 2;

var INSTANCE_ID = "mbsplit_" + Math.floor(Math.random() * 1e9) + "_" + Date.now();
var INSTANCE_ORDER = 0;

// Crossover, Band & Volume State
var curF1 = MBSPLIT_DEFAULT_F1;
var curF2 = MBSPLIT_DEFAULT_F2;
var curF3 = MBSPLIT_DEFAULT_F3;
var curNumBands = 1;            // Auto-detected from linked instances (1..4), or manual override
var manualBandsOverride = null; // null = auto-detect from linked instances (1..4)
var curSlope = 1;               // 0 = 12 dB/oct (LR2), 1 = 24 dB/oct (LR4), 2 = 48 dB/oct (LR8)
var curPhaseMode = 0;           // 0 = Min Phase (zero-latency LR tree), 1 = Dynamic Phase (LR F1 + linear-phase FIR F2/F3)
var curBandMode = 0;            // 0 = Auto Chain, 1..4 = Band 1..4 Solo, 5 = Custom Multi-Band
var curCustomMask = 1;          // 4-bit mask (1..15) used when curBandMode === 5
var curLinkGroup = 0;           // 0 = Auto (Parent Rack), 1..4 = Grp A..D, 5 = Off
var curGainDb = 0.0;            // -70.0 (-inf) .. +18.0 dB
var showLinkStatus = true;      // Clickable show/hide link info string in bottom-right of spectrogram

// Discovered Ableton LOM Rack Context
var rackContext = {
    parentRackPath: "standalone_default",
    chainIndex: 0,
    deviceIndex: 0,
    nestingDepth: 0,
    isInRack: false,
    shortLabel: "RACK #1 CH1"
};

var isApplyingRemoteSync = false;
var isDeleted = false;
var selfLomAlive = true;
var dspTimedOut = false;
var lastKnownAlive = true;
var selfDeviceId = 0;
var selfLomPath = "";
var lastHandledLomPath = "";
var selfLiveApi = null;
var undoTrashProbeTick = 0;
var lastLomCheckTime = 0;
var lastSeenTime = Date.now();
var lastScopeBeat = -1;
var lastDspBeatTime = 0;
var lastAutoRank = 0;
var lastEffectiveGroupKey = null;

// Undo / Redo history
var undoStack = [];
var redoStack = [];
var MAX_UNDO = 32;

// Mouse interaction state
var dragHandleIdx = -1; // -1 = none, 0 = F1, 1 = F2, 2 = F3
var dragVolume = false;
var volDragLastY = 0;
var volDragNorm = 0.72;
var isCursorStolen = false;
var hoverHandleIdx = -1;
var hoverBandIdx = -1;
var hoverAutoBtn = false;
var hoverVolSlider = false;
var hoverLinkBadge = false;
var lastClickTime = 0;
var lastClickTarget = "";
var lastClickX = -999;
var lastClickY = -999;

// Block-Size 8192 FFT Spectrogram & Telemetry State
var scopeBufName = "";
var scopeSampleRate = 48000.0;
var firLatencySamples = firLatencyForSampleRate(48000.0); // updated from gen telemetry (scope[26])
var reportedLatency = -1;
var selfPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;
var SPEC_COLS = 248; // 1 column per pixel across the 250px plot interior
var specColFreqs = new Array(SPEC_COLS + 1);
var specColDb = new Array(SPEC_COLS);
var specColPeaks = new Array(SPEC_COLS);
var specColHistory = []; // Rolling 2D waterfall rows of SPEC_COLS dB values
var MAX_WATERFALL_ROWS = 16;
var audioRingUnwrapped = new Array(MBSPLIT_FFT_SIZE);

var specBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
var bandPeaks = [0, 0, 0, 0];
var inPeak = 0.0;
var outPeak = 0.0;

(function initSpectrogramArrays() {
    for (var c = 0; c <= SPEC_COLS; c++) {
        specColFreqs[c] = normToFreq(c / SPEC_COLS);
    }
    for (var i = 0; i < SPEC_COLS; i++) {
        specColDb[i] = -72.0;
        specColPeaks[i] = -72.0;
    }
    for (var n = 0; n < MBSPLIT_FFT_SIZE; n++) {
        audioRingUnwrapped[n] = 0.0;
    }
})();

// =========================================================================
// ABLETON-STYLE MOUSE STEALING & VOLUME SLIDER (-inf to +18 dB) HELPERS
// =========================================================================
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

function gainDbToSliderNorm(db) {
    var g = clamp(Number(db), -70.0, 18.0);
    if (isNaN(g) || g <= -69.5) return 0.0;
    if (g >= 0.0) {
        return clamp(0.72 + 0.28 * (g / 18.0), 0.0, 1.0);
    }
    // Smooth perceptual curve for -70..0 dB -> 0.0..0.72
    return clamp(0.72 * Math.pow((g + 70.0) / 70.0, 1.75), 0.0, 0.72);
}

function sliderNormToGainDb(norm) {
    var n = clamp(Number(norm) || 0.0, 0.0, 1.0);
    if (n <= 0.015) return -70.0; // -inf dB
    if (n >= 0.72) {
        return clamp(((n - 0.72) / 0.28) * 18.0, 0.0, 18.0);
    }
    var db = -70.0 + 70.0 * Math.pow(n / 0.72, 1.0 / 1.75);
    return clamp(db, -70.0, 0.0);
}

// =========================================================================
// SHARED CROSS-INSTANCE LINK REGISTRY & DYNAMIC INSTANCE COUNT TRACKING
// =========================================================================
function getSharedBus() {
    if (typeof Global !== "undefined") {
        try {
            var g = new Global("mbsplit_shared_bus");
            if (!g.groups) g.groups = {};
            if (!g.peers) g.peers = {};
            if (typeof g.nextOrder !== "number") g.nextOrder = 1;
            if (typeof g.isBroadcastingTopology !== "boolean") g.isBroadcastingTopology = false;
            return g;
        } catch (err) {}
    }
    if (typeof global !== "undefined") {
        if (!global.__mbsplit_shared_bus) {
            global.__mbsplit_shared_bus = { groups: {}, peers: {}, nextOrder: 1, isBroadcastingTopology: false };
        }
        return global.__mbsplit_shared_bus;
    }
    return { groups: {}, peers: {}, nextOrder: 1, isBroadcastingTopology: false };
}

function getBaseGroupKey() {
    return resolveLinkGroupKey(curLinkGroup, rackContext.parentRackPath);
}

/**
 * Returns true if this instance is the left-most alive Multiband Split in its
 * immediate `(parentRackPath, chainIndex)` chain.
 *
 * When a user duplicates (Cmd+D) an existing splitter to create a new device to
 * the right in the same chain (e.g. preparing to group a chain-within-a-chain),
 * splitters at the same level in the same chain must NOT merge into the same
 * auto-chain group: the left-most splitter stays part of the parent Rack's auto
 * chain, while any right-hand splitter belongs to its own isolated empty chain.
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

function extractLomIdList(rawArr) {
    if (!rawArr) return [];
    var arr = Array.isArray(rawArr) ? rawArr : [rawArr];
    var ids = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === "id" && i + 1 < arr.length) {
            var idVal = Number(arr[i + 1]);
            if (!isNaN(idVal) && idVal > 0) ids.push(idVal);
            i++;
        } else if (typeof arr[i] === "number" && arr[i] > 0) {
            ids.push(arr[i]);
        }
    }
    return ids;
}

function handleDynamicPathChange(prevGroupKey, newGroupKey, prevBaseKey, newBaseKey) {
    if (prevGroupKey && prevGroupKey !== newGroupKey) {
        notifySiblingPeersOfTopologyChange(prevGroupKey);
        if (prevBaseKey && prevBaseKey !== prevGroupKey) {
            notifySiblingPeersOfTopologyChange(prevBaseKey);
        }
        syncFromExistingGroupIfAvailable();
        notifySiblingPeersOfTopologyChange(newGroupKey);
        if (newBaseKey && newBaseKey !== newGroupKey) {
            notifySiblingPeersOfTopologyChange(newBaseKey);
        }
    } else {
        updateAutoBandCountFromPeers(false);
        notifySiblingPeersOfTopologyChange(newGroupKey);
        if (newBaseKey && newBaseKey !== newGroupKey) {
            notifySiblingPeersOfTopologyChange(newBaseKey);
        }
    }
    emitDspState(true);
    notifyclients();
    mgraphics.redraw();
}

/**
 * Checks whether `this_device` is still present inside an active Ableton Live Set / Rack chain
 * (as opposed to sitting in Ableton Live's Undo trash after the user deleted the device or chain),
 * and detects dynamic LOM path changes from chain/device reordering, moving, or nesting.
 *
 * CRITICAL: In Max for Live (`v8ui`), `new LiveAPI(..., "this_device")` resolves `"this_device"`
 * relative to whichever patcher owns the currently executing `Task`. Therefore:
 *  - We create `selfLiveApi = new LiveAPI(..., "this_device")` ONLY when `isOwnThread !== false`.
 *  - Once created in real Ableton Live (`selfDeviceId !== 42`), `selfLiveApi` is permanently bound
 *    to this device's unique LOM ID (`selfDeviceId`), so reading `selfLiveApi.unquotedpath` allocates
 *    ZERO `LiveAPI` objects and is 100% safe even when queried by a sibling (`isOwnThread === false`).
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
            if (isOwnThread === false && !isMockEnv) {
                return selfLomAlive;
            }
            selfLiveApi = new LiveAPI(function() {}, "this_device");
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
            // If sitting in Undo trash on our own thread, periodically re-probe `this_device` in case Cmd+Z restored us
            if (isOwnThread !== false && !selfLomAlive && devId !== 42) {
                undoTrashProbeTick = (undoTrashProbeTick + 1) % 8;
                if (undoTrashProbeTick === 0) {
                    try {
                        var probeApi = new LiveAPI(function() {}, "this_device");
                        var probePath = String(probeApi.unquotedpath || probeApi.path || "").replace(/^["']+|["']+$/g, "").trim();
                        if (probePath && probePath.indexOf("live_set") === 0) {
                            selfLiveApi = probeApi;
                            rawPath = probePath;
                            devId = extractSingleLomId(probeApi.id) || devId;
                        }
                    } catch (eProbe) {}
                }
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

        // In unit test mocks (`devId === 42`), inspect mock Rack chains if provided
        if (devId === 42 && parsed.isInRack && parsed.parentRackPath) {
            try {
                var rackApi = new LiveAPI(function() {}, parsed.parentRackPath);
                if (rackApi && rackApi.id !== undefined && extractSingleLomId(rackApi.id) <= 0) {
                    selfLomAlive = false;
                    return false;
                }
                var nChains = -1;
                if (rackApi && typeof rackApi.getcount === "function") {
                    var cnt = Number(rackApi.getcount("chains"));
                    if (!isNaN(cnt) && cnt >= 0) nChains = cnt;
                } else if (rackApi && typeof rackApi.get === "function") {
                    var chainIds = extractLomIdList(rackApi.get("chains"));
                    if (chainIds.length > 0) nChains = chainIds.length;
                }

                if (nChains === 0) {
                    selfLomAlive = false;
                    return false;
                }

                if (nChains > 0) {
                    var checkChainIdx = parsed.chainIndex;
                    var verifiedInRack = false;
                    var hasChainInspection = false;

                    if (checkChainIdx >= 0 && checkChainIdx < nChains) {
                        var chainApi = new LiveAPI(function() {}, parsed.parentRackPath + " chains " + checkChainIdx);
                        if (chainApi && typeof chainApi.get === "function") {
                            var cDevIds = extractLomIdList(chainApi.get("devices"));
                            if (cDevIds.length > 0) {
                                hasChainInspection = true;
                                if (cDevIds.indexOf(devId) !== -1) {
                                    verifiedInRack = true;
                                }
                            } else if (typeof chainApi.getcount === "function") {
                                var cDevCount = Number(chainApi.getcount("devices"));
                                if (!isNaN(cDevCount)) {
                                    hasChainInspection = true;
                                    if (cDevCount > 0) {
                                        verifiedInRack = true;
                                    }
                                }
                            }
                        }
                    } else if (checkChainIdx >= nChains) {
                        hasChainInspection = true;
                        verifiedInRack = false;
                    }

                    if (hasChainInspection && !verifiedInRack) {
                        selfLomAlive = false;
                        return false;
                    }
                }
            } catch (eRack) {}
        }

        selfLomPath = rawPath;
        rackContext = parsed;
        var wasAlive = selfLomAlive;
        selfLomAlive = true;

        if (!quietPathUpdate) {
            var comparePath = lastHandledLomPath || prevLomPath;
            lastHandledLomPath = rawPath;
            if (wasAlive && comparePath && rawPath !== comparePath) {
                refreshAllSiblingLomPathsQuietly();
                var newGroupKey = getActiveGroupKey();
                var newBaseKey = getBaseGroupKey();
                handleDynamicPathChange(prevGroupKey, newGroupKey, prevBaseKey, newBaseKey);
            }
        }
        return true;
    } catch (err) {
        return selfLomAlive;
    }
}

function isSelfCurrentlyAlive() {
    return !isDeleted && selfLomAlive && !dspTimedOut;
}

/**
 * Pure, side-effect-free lookup of all currently alive peers in `groupKey`.
 * Does NOT call `LiveAPI` and does NOT delete active/Undo peers behind their back,
 * preventing any re-registration / broadcast loops.
 */
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
            if (typeof p.isAlive === "function" && !p.isAlive()) {
                continue;
            }
            if (typeof p.getGroupKey === "function" && p.getGroupKey() === key) {
                alive.push(p);
            }
        } catch (err) {
            delete bus.peers[id];
        }
    }

    alive.sort(function(a, b) {
        var ca = (typeof a.getChainIndex === "function") ? (Number(a.getChainIndex()) || 0) : 0;
        var cb = (typeof b.getChainIndex === "function") ? (Number(b.getChainIndex()) || 0) : 0;
        if (ca !== cb) return ca - cb;
        var da = (typeof a.getDeviceIndex === "function") ? (Number(a.getDeviceIndex()) || 0) : 0;
        var db = (typeof b.getDeviceIndex === "function") ? (Number(b.getDeviceIndex()) || 0) : 0;
        if (da !== db) return da - db;
        return (Number(a.order) || 0) - (Number(b.order) || 0);
    });

    return alive;
}

function getLinkedPeerCount() {
    var key = getActiveGroupKey();
    if (!key) return 1;
    var alive = getAliveGroupPeers(key);
    return Math.max(1, alive.length);
}

/**
 * Automatically determines the number of bands (1..4) from the alive linked instances
 * in the active link group. When a linked device is deleted, this shrinks immediately!
 */
function computeDetectedBandCount() {
    if (manualBandsOverride !== null) {
        return clamp(Math.round(manualBandsOverride), 1, 4);
    }
    var key = getActiveGroupKey();
    if (!key) return 1;
    var alive = getAliveGroupPeers(key);
    return clamp(Math.max(1, alive.length), 1, 4);
}

/**
 * Returns this instance's 0-based rank (0 .. numBands - 1) among the alive linked
 * instances in the Rack, sorted by chain order. When a middle or end device is deleted,
 * the remaining instances compact cleanly into Bands 1..N.
 */
function getEffectiveChainRank(targetBands) {
    var maxB = targetBands !== undefined ? targetBands : curNumBands;
    if (manualBandsOverride !== null) {
        return clamp(Math.round(rackContext.chainIndex || 0), 0, Math.max(0, maxB - 1));
    }
    var key = getActiveGroupKey();
    if (!key) return 0;
    var alive = getAliveGroupPeers(key);
    for (var i = 0; i < alive.length; i++) {
        if (alive[i].id === INSTANCE_ID) {
            return clamp(i, 0, Math.max(0, maxB - 1));
        }
    }
    return clamp(Math.round(rackContext.chainIndex || 0), 0, Math.max(0, maxB - 1));
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
                if (typeof peer.isAlive === "function" && peer.isAlive() &&
                    typeof peer.onPeersChanged === "function") {
                    var pKey = (typeof peer.getGroupKey === "function") ? peer.getGroupKey() : null;
                    var pBase = (typeof peer.getBaseGroupKey === "function") ? peer.getBaseGroupKey() : null;
                    var pLast = (typeof peer.getLastEffectiveGroupKey === "function") ? peer.getLastEffectiveGroupKey() : null;
                    if (pKey === key || pBase === key || pLast === key) {
                        peer.onPeersChanged();
                    }
                }
            } catch (ePeer) {}
        }
    } finally {
        bus.isBroadcastingTopology = false;
    }
}

function updateAutoBandCountFromPeers(notifySiblings) {
    var prevKey = lastEffectiveGroupKey;
    var key = getActiveGroupKey();
    var groupChanged = (prevKey !== null && key !== prevKey);
    lastEffectiveGroupKey = key;

    var bus = getSharedBus();
    if (groupChanged && key && key.indexOf("rack_group::isolated::") !== 0 && bus && bus.groups && bus.groups[key]) {
        var aliveInNew = getAliveGroupPeers(key);
        var hasOther = false;
        for (var i = 0; i < aliveInNew.length; i++) {
            if (aliveInNew[i] && aliveInNew[i].id !== INSTANCE_ID) {
                hasOther = true;
                break;
            }
        }
        if (hasOther) {
            var ex = bus.groups[key];
            var san = sanitizeCrossovers(ex.f1, ex.f2, ex.f3, -1);
            curF1 = san[0];
            curF2 = san[1];
            curF3 = san[2];
            curSlope = clamp(Math.round(Number(ex.slope !== undefined ? ex.slope : curSlope)), 0, 2);
            curPhaseMode = (Number(ex.phaseMode !== undefined ? ex.phaseMode : curPhaseMode) > 0.5) ? 1 : 0;
        }
    }

    var detected = computeDetectedBandCount();
    var rank = getEffectiveChainRank(detected);
    var changed = groupChanged || (detected !== curNumBands) || (rank !== lastAutoRank);
    curNumBands = detected;
    lastAutoRank = rank;

    // If manual solo was set to a band higher than the shrunk band count, clamp it into 1..curNumBands
    if (curBandMode >= 1 && curBandMode <= 4 && curBandMode > curNumBands) {
        curBandMode = curNumBands;
        curCustomMask = 1 << (curNumBands - 1);
        changed = true;
    }

    if (key && bus && bus.groups && bus.groups[key]) {
        bus.groups[key].numBands = curNumBands;
    }

    if (changed && notifySiblings !== false) {
        if (groupChanged && prevKey) {
            notifySiblingPeersOfTopologyChange(prevKey);
        }
        notifySiblingPeersOfTopologyChange(key);
        var baseKey = getBaseGroupKey();
        if (baseKey && baseKey !== key) {
            notifySiblingPeersOfTopologyChange(baseKey);
        }
    }
    return changed;
}

function handlePeerTopologyChange() {
    if (!isSelfCurrentlyAlive()) return;
    var changed = updateAutoBandCountFromPeers(false);
    emitDspState(true);
    if (changed) {
        notifyclients();
    }
    mgraphics.redraw();
}

function registerPeerInBus() {
    if (isDeleted) return;
    var bus = getSharedBus();
    if (!INSTANCE_ORDER) {
        INSTANCE_ORDER = bus.nextOrder++;
    }
    lastSeenTime = Date.now();
    lastKnownAlive = isSelfCurrentlyAlive();
    bus.peers[INSTANCE_ID] = {
        id: INSTANCE_ID,
        order: INSTANCE_ORDER,
        isDeleted: function() { return isDeleted; },
        isAlive: function() { return isSelfCurrentlyAlive(); },
        getLastSeen: function() { return lastSeenTime; },
        getLastDspBeatTime: function() { return lastDspBeatTime; },
        getDeviceId: function() { return selfDeviceId; },
        getLomPath: function() { return selfLomPath; },
        getLinkGroup: function() { return curLinkGroup; },
        getParentRackPath: function() { return rackContext.parentRackPath || "standalone_default"; },
        getBaseGroupKey: function() { return getBaseGroupKey(); },
        getLastEffectiveGroupKey: function() { return lastEffectiveGroupKey; },
        getGroupKey: function() { return getActiveGroupKey(); },
        getChainIndex: function() { return rackContext.chainIndex; },
        getDeviceIndex: function() { return rackContext.deviceIndex || 0; },
        refreshOwnLomState: function(isOwnThread, quietPathUpdate) {
            return refreshSelfLomState(isOwnThread === true, quietPathUpdate === true);
        },
        getDebugState: function() {
            return {
                curNumBands: curNumBands,
                curBandMode: curBandMode,
                effectiveRank: lastAutoRank,
                effectiveMask: getEffectiveMask(),
                chainIndex: rackContext.chainIndex || 0,
                deviceIndex: rackContext.deviceIndex || 0,
                isLeftMostInChain: isLeftMostInOwnChain(),
                effectiveGroupKey: getActiveGroupKey(),
                baseGroupKey: getBaseGroupKey(),
                selfLomAlive: selfLomAlive,
                dspTimedOut: dspTimedOut,
                isDeleted: isDeleted
            };
        },
        onPeersChanged: function() { handlePeerTopologyChange(); },
        applyRemoteState: function(state) {
            applyLinkedStateFromPeer(state);
        }
    };
    updateAutoBandCountFromPeers(true);
}

function markSelfDeletedAndNotifyPeers() {
    releaseMouseCursor();
    var key = getActiveGroupKey();
    var baseKey = getBaseGroupKey();
    isDeleted = true;
    selfLomAlive = false;
    lastKnownAlive = false;
    try {
        var bus = getSharedBus();
        if (bus && bus.peers && bus.peers[INSTANCE_ID]) {
            delete bus.peers[INSTANCE_ID];
        }
        notifySiblingPeersOfTopologyChange(key);
        if (baseKey && baseKey !== key) {
            notifySiblingPeersOfTopologyChange(baseKey);
        }
    } catch (err) {}
}

function notifydeleted() {
    markSelfDeletedAndNotifyPeers();
}

function freebang() {
    markSelfDeletedAndNotifyPeers();
}

function syncFromExistingGroupIfAvailable() {
    var key = getActiveGroupKey();
    updateAutoBandCountFromPeers(false);
    if (!key) return false;
    var bus = getSharedBus();
    var existing = bus.groups[key];
    var alivePeers = getAliveGroupPeers(key);
    var hasOtherAlivePeer = false;
    for (var i = 0; i < alivePeers.length; i++) {
        if (alivePeers[i] && alivePeers[i].id !== INSTANCE_ID) {
            hasOtherAlivePeer = true;
            break;
        }
    }
    if (existing && (existing.senderId !== INSTANCE_ID || hasOtherAlivePeer)) {
        applyLinkedStateFromPeer(existing, true);
        broadcastLinkedState();
        return true;
    }
    bus.groups[key] = {
        groupKey: key,
        senderId: INSTANCE_ID,
        f1: curF1,
        f2: curF2,
        f3: curF3,
        numBands: curNumBands,
        slope: curSlope,
        phaseMode: curPhaseMode,
        timestamp: Date.now()
    };
    return false;
}

function broadcastLinkedState() {
    if (isApplyingRemoteSync || !isSelfCurrentlyAlive()) return;
    updateAutoBandCountFromPeers(false);
    var key = getActiveGroupKey();
    if (!key) return;

    var bus = getSharedBus();
    var payload = {
        groupKey: key,
        senderId: INSTANCE_ID,
        f1: curF1,
        f2: curF2,
        f3: curF3,
        numBands: curNumBands,
        slope: curSlope,
        phaseMode: curPhaseMode,
        timestamp: Date.now()
    };
    bus.groups[key] = payload;

    var alive = getAliveGroupPeers(key);
    for (var i = 0; i < alive.length; i++) {
        var peer = alive[i];
        if (peer && peer.id !== INSTANCE_ID) {
            try {
                peer.applyRemoteState(payload);
            } catch (err) {}
        }
    }

    outlet(1, ["sync_bus", key, INSTANCE_ID, curF1, curF2, curF3, curNumBands, curSlope, curPhaseMode]);
}

function applyLinkedStateFromPeer(state, allowSelfSender) {
    if (!state || (!allowSelfSender && state.senderId === INSTANCE_ID) || !isSelfCurrentlyAlive()) return;
    var myKey = getActiveGroupKey();
    if (!myKey || (state.groupKey && state.groupKey !== myKey)) return;

    isApplyingRemoteSync = true;
    try {
        var sanitized = sanitizeCrossovers(state.f1, state.f2, state.f3, -1);
        curF1 = sanitized[0];
        curF2 = sanitized[1];
        curF3 = sanitized[2];
        if (manualBandsOverride === null) {
            updateAutoBandCountFromPeers(false);
        } else {
            curNumBands = clamp(Math.round(Number(state.numBands) || curNumBands), 1, 4);
        }
        curSlope = clamp(Math.round(Number(state.slope !== undefined ? state.slope : 1)), 0, 2);
        if (state.phaseMode !== undefined) curPhaseMode = (Number(state.phaseMode) > 0.5) ? 1 : 0;

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
    dspTimedOut = false;
    selfLomPath = String(lomPath || "").replace(/^["']+|["']+$/g, "").trim();
    lastHandledLomPath = selfLomPath;
    var prevKey = lastEffectiveGroupKey || getActiveGroupKey();
    rackContext = parseRackContextFromPath(selfLomPath);
    refreshAllSiblingLomPathsQuietly();
    registerPeerInBus();
    var newKey = getActiveGroupKey();
    if (newKey !== prevKey) {
        syncFromExistingGroupIfAvailable();
    } else {
        updateAutoBandCountFromPeers(true);
    }
    var baseKey = getBaseGroupKey();
    if (baseKey) {
        notifySiblingPeersOfTopologyChange(baseKey);
    }
    emitDspState(true);
    broadcastLinkedState();
    mgraphics.redraw();
}

function discoverRackContext() {
    if (typeof LiveAPI === "undefined") {
        registerPeerInBus();
        emitDspState(true);
        return;
    }
    try {
        selfLiveApi = new LiveAPI(function() {}, "this_device");
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
// UNDO / REDO & STATE SERIALIZATION
// =========================================================================
function snapshotState() {
    return {
        f1: curF1,
        f2: curF2,
        f3: curF3,
        numBands: curNumBands,
        slope: curSlope,
        phaseMode: curPhaseMode,
        bandMode: curBandMode,
        customMask: curCustomMask,
        linkGroup: curLinkGroup,
        gainDb: curGainDb,
        showLinkStatus: showLinkStatus ? 1 : 0
    };
}

function pushUndoState() {
    undoStack.push(snapshotState());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
}

function applySnapshot(snap) {
    if (!snap) return;
    curF1 = snap.f1;
    curF2 = snap.f2;
    curF3 = snap.f3;
    curNumBands = clamp(snap.numBands || computeDetectedBandCount(), 1, 4);
    curSlope = snap.slope;
    if (snap.phaseMode !== undefined) curPhaseMode = snap.phaseMode;
    curBandMode = snap.bandMode;
    curCustomMask = snap.customMask;
    curLinkGroup = snap.linkGroup;
    if (snap.gainDb !== undefined) curGainDb = snap.gainDb;
    if (snap.showLinkStatus !== undefined) showLinkStatus = Boolean(snap.showLinkStatus);
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

function getvalueof() {
    return [
        3,
        curF1,
        curF2,
        curF3,
        curNumBands,
        curSlope,
        curBandMode,
        curCustomMask,
        curLinkGroup,
        curGainDb,
        showLinkStatus ? 1 : 0,
        curPhaseMode
    ];
}

function setvalueof() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 1 && Array.isArray(args[0])) args = args[0];
    if (!args || args.length === 0) return;

    var ver = Math.round(Number(args[0]) || 1);
    if (ver >= 1 && ver <= 3 && args.length >= 6) {
        var s = sanitizeCrossovers(args[1], args[2], args[3], -1);
        curF1 = s[0];
        curF2 = s[1];
        curF3 = s[2];
        if (manualBandsOverride !== null) {
            curNumBands = clamp(Math.round(Number(args[4]) || manualBandsOverride), 1, 4);
        } else {
            curNumBands = computeDetectedBandCount();
        }
        curSlope = clamp(Math.round(Number(args[5] !== undefined ? args[5] : 1)), 0, 2);
        if (args.length >= 7) curBandMode = clamp(Math.round(Number(args[6]) || 0), 0, 5);
        if (args.length >= 8) curCustomMask = clamp(Math.round(Number(args[7]) || 1), 0, 15);
        if (args.length >= 9) curLinkGroup = clamp(Math.round(Number(args[8]) || 0), 0, 5);
        if (ver >= 2 && args.length >= 10) curGainDb = clamp(Number(args[9]) || 0.0, -70.0, 18.0);
        if (ver >= 2 && args.length >= 11) showLinkStatus = (Number(args[10]) > 0.5);
        if (ver >= 3 && args.length >= 12) curPhaseMode = (Number(args[11]) > 0.5) ? 1 : 0;
    } else if (args.length >= 3) {
        var s0 = sanitizeCrossovers(args[0], args[1], args[2], -1);
        curF1 = s0[0];
        curF2 = s0[1];
        curF3 = s0[2];
    }
    emitDspState(true);
    broadcastLinkedState();
    mgraphics.redraw();
}

// =========================================================================
// DSP & UI PARAMETER SYNC EMITTERS
// =========================================================================
function getEffectiveMask() {
    var chainIdx = (curBandMode === 0) ? getEffectiveChainRank() : rackContext.chainIndex;
    return resolveEffectiveBandMask(curBandMode, chainIdx, curNumBands, curCustomMask);
}

function emitEffectiveBandMask() {
    var mask = getEffectiveMask();
    outlet(0, ["bandmask", mask]);
}

function emitDspState(syncUiControls) {
    outlet(0, ["f1", curF1]);
    outlet(0, ["f2", curF2]);
    outlet(0, ["f3", curF3]);
    outlet(0, ["numbands", curNumBands]);
    outlet(0, ["slope", curSlope]);
    outlet(0, ["dynphase", curPhaseMode]);
    outlet(0, ["gain", curGainDb]);
    emitEffectiveBandMask();
    updateDeviceLatency();

    if (syncUiControls) {
        outlet(0, ["ui_f1", curF1]);
        outlet(0, ["ui_f2", curF2]);
        outlet(0, ["ui_f3", curF3]);
        outlet(0, ["ui_slope", curSlope]);
        outlet(0, ["ui_phasemode", curPhaseMode]);
        outlet(0, ["ui_bandmode", curBandMode]);
        outlet(0, ["ui_linkgroup", curLinkGroup]);
        outlet(0, ["ui_gain", curGainDb]);
    }
}

// =========================================================================
// EXTERNAL MESSAGE HANDLERS (from live.* widgets & Max patcher)
// =========================================================================
function set_f1(v) {
    var s = sanitizeCrossovers(v, curF2, curF3, 0);
    var neighChanged = (Math.abs(s[1] - curF2) > 1e-4 || Math.abs(s[2] - curF3) > 1e-4);
    curF1 = s[0];
    curF2 = s[1];
    curF3 = s[2];
    emitDspState(neighChanged);
    broadcastLinkedState();
    mgraphics.redraw();
}

function set_f2(v) {
    var s = sanitizeCrossovers(curF1, v, curF3, 1);
    var neighChanged = (Math.abs(s[0] - curF1) > 1e-4 || Math.abs(s[2] - curF3) > 1e-4);
    curF1 = s[0];
    curF2 = s[1];
    curF3 = s[2];
    emitDspState(neighChanged);
    broadcastLinkedState();
    mgraphics.redraw();
}

function set_f3(v) {
    var s = sanitizeCrossovers(curF1, curF2, v, 2);
    var neighChanged = (Math.abs(s[0] - curF1) > 1e-4 || Math.abs(s[1] - curF2) > 1e-4);
    curF1 = s[0];
    curF2 = s[1];
    curF3 = s[2];
    emitDspState(neighChanged);
    broadcastLinkedState();
    mgraphics.redraw();
}

function set_numbands(nb) {
    var n = Math.round(Number(nb) || 0);
    if (n <= 0) {
        manualBandsOverride = null;
        updateAutoBandCountFromPeers();
    } else {
        manualBandsOverride = clamp(n, 1, 4);
        curNumBands = manualBandsOverride;
    }
    emitDspState(true);
    broadcastLinkedState();
    mgraphics.redraw();
}

function set_slope(s) {
    curSlope = clamp(Math.round(Number(s !== undefined ? s : 1)), 0, 2);
    emitDspState(false);
    broadcastLinkedState();
    mgraphics.redraw();
}

function set_phasemode(m) {
    curPhaseMode = (Number(m) > 0.5) ? 1 : 0;
    emitDspState(false);
    broadcastLinkedState();
    mgraphics.redraw();
}

/**
 * Dynamic Phase adds firLatencySamples of FIR delay. Live only reads a device's latency from the patcher
 * `latency` attribute, which Live re-reads at runtime when it is set (verified: LOM latency_in_samples follows).
 * Every linked instance carries the same phase mode, so all Rack chains report the same latency.
 */
function updateDeviceLatency() {
    var want = curPhaseMode ? firLatencySamples : 0;
    if (want === reportedLatency || !selfPatcher) return;
    try {
        selfPatcher.setattr("latency", want);
        reportedLatency = want;
    } catch (err) {}
}

function set_bandmode(m) {
    var mode = clamp(Math.round(Number(m) || 0), 0, 5);
    curBandMode = mode;
    if (mode >= 1 && mode <= 4) {
        curCustomMask = 1 << (mode - 1);
    }
    emitEffectiveBandMask();
    mgraphics.redraw();
}

function set_linkgroup(g) {
    curLinkGroup = clamp(Math.round(Number(g) || 0), 0, 5);
    registerPeerInBus();
    if (!syncFromExistingGroupIfAvailable()) {
        broadcastLinkedState();
    }
    emitDspState(true);
    mgraphics.redraw();
}

function set_gain(db) {
    var g = Number(db);
    if (isNaN(g)) g = 0.0;
    curGainDb = clamp(g, -70.0, 18.0);
    outlet(0, ["gain", curGainDb]);
    mgraphics.redraw();
}

function set_show_link(v) {
    showLinkStatus = (Number(v) > 0.5);
    mgraphics.redraw();
}

function sync_bus(groupKey, senderId, f1, f2, f3, numBands, slope, phaseMode) {
    applyLinkedStateFromPeer({
        groupKey: groupKey,
        senderId: senderId,
        f1: f1,
        f2: f2,
        f3: f3,
        numBands: numBands,
        slope: slope,
        phaseMode: phaseMode
    });
}

function setbuffer(name) {
    scopeBufName = String(name || "");
}

function loadbang() {
    isDeleted = false;
    registerPeerInBus();
    discoverRackContext();
    if (!syncFromExistingGroupIfAvailable()) {
        emitDspState(true);
        broadcastLinkedState();
    }
    mgraphics.redraw();
}

// =========================================================================
// BLOCK-SIZE 8192 FFT SPECTROGRAM ANALYSIS & WATERFALL ENGINE
// =========================================================================
function updateSpectrogramFrom8192Samples(samples8192, sampleRate, pushWaterfallRow) {
    var sr = Number(sampleRate) || 48000.0;
    var dbBins = computeFft8192DbBins(samples8192);
    var row = new Array(SPEC_COLS);

    for (var c = 0; c < SPEC_COLS; c++) {
        var fLo = specColFreqs[c];
        var fHi = specColFreqs[c + 1];
        var rawDb = sampleFft8192DbForPixel(fLo, fHi, dbBins, sr);
        var prevDb = specColDb[c];
        var smDb = (rawDb > prevDb)
            ? (prevDb * 0.25 + rawDb * 0.75)
            : (prevDb * 0.78 + rawDb * 0.22);
        specColDb[c] = smDb;
        specColPeaks[c] = Math.max(smDb, (specColPeaks[c] || -72.0) - 0.45);
        row[c] = smDb;
    }

    if (pushWaterfallRow !== false) {
        specColHistory.unshift(row);
        if (specColHistory.length > MAX_WATERFALL_ROWS) {
            specColHistory.pop();
        }
    }
    return dbBins;
}

function pullScope() {
    if (isDeleted) return;
    var now = Date.now();

    // Refresh sibling cached `selfLiveApi` paths quietly first so `isLeftMostInOwnChain()` sees up-to-date device indices
    refreshAllSiblingLomPathsQuietly();
    // Refresh our own LOM state on our own thread (`isOwnThread = true`)
    refreshSelfLomState(true);

    var aliveNow = isSelfCurrentlyAlive();
    if (!aliveNow) {
        if (lastKnownAlive) {
            lastKnownAlive = false;
            var prevEff = lastEffectiveGroupKey;
            var baseKey = getBaseGroupKey();
            if (prevEff && prevEff !== baseKey) {
                notifySiblingPeersOfTopologyChange(prevEff);
            }
            if (baseKey) {
                notifySiblingPeersOfTopologyChange(baseKey);
            }
        }
        return;
    }

    lastSeenTime = now;

    if (!lastKnownAlive) {
        // Restored from Undo (Cmd+Z) in Ableton Live — single transition from inactive -> active
        lastKnownAlive = true;
        updateAutoBandCountFromPeers(true);
        var restoredBase = getBaseGroupKey();
        if (restoredBase) {
            notifySiblingPeersOfTopologyChange(restoredBase);
        }
        emitDspState(true);
        broadcastLinkedState();
    } else if (updateAutoBandCountFromPeers(true)) {
        emitDspState(true);
    }

    if (!scopeBufName || typeof Buffer === "undefined") return;
    try {
        var buf = new Buffer(scopeBufName);
        var hdr = buf.peek(1, 0, 28);
        if (!hdr || hdr.length < 24) return;

        for (var i = 0; i < 16; i++) {
            specBands[i] = clamp(Number(hdr[i]) || 0.0, 0.0, 2.0);
        }
        for (var b = 0; b < 4; b++) {
            bandPeaks[b] = clamp(Number(hdr[16 + b]) || 0.0, 0.0, 2.0);
        }
        inPeak = clamp(Number(hdr[20]) || 0.0, 0.0, 2.0);
        outPeak = clamp(Number(hdr[21]) || 0.0, 0.0, 2.0);

        var scopeBeat = Number(hdr[23]) || 0;
        if (scopeBeat !== lastScopeBeat) {
            lastScopeBeat = scopeBeat;
            lastDspBeatTime = now;
            dspTimedOut = false;
        }

        var ringPos = clamp(Math.floor(Number(hdr[24]) || 0), 0, MBSPLIT_FFT_SIZE - 1);
        var sr = Math.max(8000.0, Number(hdr[25]) || 48000.0);
        scopeSampleRate = sr;
        var firD = Math.round(Number(hdr[26]) || 0);
        if (firD >= 128 && firD !== firLatencySamples) {
            firLatencySamples = firD;
            updateDeviceLatency();
        }

        if (inPeak > 1e-4) {
            var ringData = buf.peek(1, 32, MBSPLIT_FFT_SIZE);
            if (ringData && ringData.length >= MBSPLIT_FFT_SIZE) {
                var N = MBSPLIT_FFT_SIZE;
                for (var n = 0; n < N; n++) {
                    var rIdx = (ringPos + n) % N;
                    audioRingUnwrapped[n] = Number(ringData[rIdx]) || 0.0;
                }
                updateSpectrogramFrom8192Samples(audioRingUnwrapped, sr, true);
            }
        } else {
            var silentRow = new Array(SPEC_COLS);
            for (var c = 0; c < SPEC_COLS; c++) {
                specColDb[c] = Math.max(-72.0, specColDb[c] - 2.5);
                specColPeaks[c] = Math.max(-72.0, specColPeaks[c] - 1.2);
                silentRow[c] = specColDb[c];
            }
            specColHistory.unshift(silentRow);
            if (specColHistory.length > MAX_WATERFALL_ROWS) specColHistory.pop();
        }
        mgraphics.redraw();
    } catch (err) {}
}

var scopeTask = null;
if (typeof Task !== "undefined") {
    try {
        scopeTask = new Task(pullScope, this);
        scopeTask.interval = 40;
        scopeTask.repeat();
    } catch (err) {}
}

function preview() {
    manualBandsOverride = 4;
    curNumBands = 4;
    curSlope = 1; // 24 dB/oct LR4
    curF1 = 120.0;
    curF2 = 800.0;
    curF3 = 4500.0;
    curBandMode = 0; // Auto Chain
    curGainDb = 0.0;
    showLinkStatus = true;
    rackContext = {
        parentRackPath: "live_set tracks 0 devices 0",
        chainIndex: 1, // Highlight Band 2 (LO-MID) in preview as an active chain split
        nestingDepth: 1,
        isInRack: true,
        shortLabel: "RACK #1 CH2"
    };

    // Synthesize a 98 Hz (G2) sawtooth wave at block size 8192 and run the real 8192-point FFT
    var saw8192 = synthesizeSawWave8192(98.0, 48000.0);
    specColHistory = [];
    for (var c = 0; c < SPEC_COLS; c++) {
        specColDb[c] = -72.0;
        specColPeaks[c] = -72.0;
    }
    updateSpectrogramFrom8192Samples(saw8192, 48000.0, false);

    // Populate the 2D waterfall rows with subtle temporal harmonic shimmer
    for (var r = 0; r < MAX_WATERFALL_ROWS; r++) {
        var wfRow = new Array(SPEC_COLS);
        var ph = r * 0.35;
        for (var col = 0; col < SPEC_COLS; col++) {
            var baseDb = specColDb[col];
            var shimmer = 1.8 * Math.sin(ph + col * 0.09) * Math.cos(r * 0.22 - col * 0.04);
            wfRow[col] = clamp(baseDb + shimmer - r * 0.35, -72.0, 6.0);
        }
        specColHistory.push(wfRow);
        if (r === 0) {
            for (var p = 0; p < SPEC_COLS; p++) {
                specColPeaks[p] = clamp(specColDb[p] + 2.2, -72.0, 6.0);
            }
        }
    }

    bandPeaks = [0.42, 0.68, 0.38, 0.24];
    inPeak = 0.72;
    outPeak = 0.66;
}

// =========================================================================
// UI 2 GEOMETRY & COORDINATE HELPERS (256 x 136 px Canvas)
// =========================================================================
var PLOT_X = 3;
var PLOT_Y = 20;
var PLOT_W = 250;
var PLOT_H = 113;

function updatePlotBounds() {
    var size = mgraphics.size || [256, 136];
    var w = size[0] || 256;
    var h = size[1] || 136;
    PLOT_X = 3;
    PLOT_Y = 20;
    PLOT_W = w - 6;
    PLOT_H = h - 23;
}

function freqToX(freq) {
    updatePlotBounds();
    return PLOT_X + freqToNorm(freq) * PLOT_W;
}

function xToFreq(px) {
    updatePlotBounds();
    var norm = clamp((px - PLOT_X) / PLOT_W, 0.0, 1.0);
    return normToFreq(norm);
}

function magToY(magLin) {
    updatePlotBounds();
    var db = linToDb(Math.max(magLin, 1e-4));
    // Map +3 dB (top) down to -36 dB (bottom)
    var norm = clamp((db - (-36.0)) / (3.0 - (-36.0)), 0.0, 1.0);
    return PLOT_Y + PLOT_H - norm * (PLOT_H - 6) - 2;
}

function getBandNames(nb) {
    if (nb <= 1) return MBSPLIT_BAND_NAMES_1;
    if (nb === 2) return MBSPLIT_BAND_NAMES_2;
    if (nb === 3) return MBSPLIT_BAND_NAMES_3;
    return MBSPLIT_BAND_NAMES_4;
}

function getActiveCrossoverCount() {
    return clamp(curNumBands - 1, 0, 3);
}

function getCrossoverFreq(idx) {
    if (idx === 0) return curF1;
    if (idx === 1) return curF2;
    return curF3;
}

function getAutoBtnRect() {
    return [3, 2, 32, 15];
}

function getVolumeSliderRect() {
    var size = mgraphics.size || [256, 136];
    var w = size[0] || 256;
    return [w - 68, 2, 65, 15];
}

function getBandPillRect(bandIdx) {
    var nb = clamp(curNumBands, 1, 4);
    var ar = getAutoBtnRect();
    var vr = getVolumeSliderRect();
    var startX = ar[0] + ar[2] + 3;
    var availW = (vr[0] - 3) - startX;
    var gap = 2.5;
    var pillW = (availW - gap * (nb - 1)) / nb;
    var bx = startX + bandIdx * (pillW + gap);
    return [bx, ar[1], pillW, ar[3]];
}

function getLinkBadgeRect() {
    updatePlotBounds();
    var bw = showLinkStatus ? 104 : 30;
    var bh = 13;
    var bx = PLOT_X + PLOT_W - bw - 3;
    var by = PLOT_Y + PLOT_H - bh - 3;
    return [bx, by, bw, bh];
}

function hitTestHandle(x, y) {
    if (y < PLOT_Y - 2 || y > PLOT_Y + PLOT_H + 2) return -1;
    var count = getActiveCrossoverCount();
    var bestIdx = -1;
    var bestDist = 9.0;
    for (var i = 0; i < count; i++) {
        var hx = freqToX(getCrossoverFreq(i));
        var d = Math.abs(x - hx);
        if (d <= bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function hitTestBandRegionInPlot(x, y) {
    if (x < PLOT_X || x > PLOT_X + PLOT_W || y < PLOT_Y || y > PLOT_Y + PLOT_H) return -1;
    if (curNumBands <= 1) return 0;
    var f = xToFreq(x);
    if (curNumBands === 2) {
        return f < curF1 ? 0 : 1;
    }
    if (curNumBands === 3) {
        if (f < curF1) return 0;
        if (f < curF2) return 1;
        return 2;
    }
    if (f < curF1) return 0;
    if (f < curF2) return 1;
    if (f < curF3) return 2;
    return 3;
}

// =========================================================================
// MOUSE INTERACTION (Auto, Band Pills, Volume Slider, Link Toggle, Crossovers)
// =========================================================================
function onclick(x, y, but, cmd, shift) {
    var now = Date.now();

    // 1. Check Top-Right Volume Slider (-inf to +18 dB)
    // Behaves like Ableton's native horizontal value sliders:
    // steals/hides the mouse cursor and drags UP/DOWN (never left-right jump)
    var vr = getVolumeSliderRect();
    if (x >= vr[0] && x <= vr[0] + vr[2] && y >= vr[1] && y <= vr[1] + vr[3]) {
        if (lastClickTarget === "vol" && (now - lastClickTime) < 320 &&
            Math.abs(x - lastClickX) < 5 && Math.abs(y - lastClickY) < 5) {
            // Double-click resets volume to 0.0 dB
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
        dragHandleIdx = -1;
        volDragLastY = y;
        volDragNorm = gainDbToSliderNorm(curGainDb);
        stealMouseCursor();
        mgraphics.redraw();
        return;
    }

    // 2. Check Top Bar [AUTO] pill
    var ar = getAutoBtnRect();
    if (x >= ar[0] && x <= ar[0] + ar[2] && y >= ar[1] && y <= ar[1] + ar[3]) {
        pushUndoState();
        curBandMode = 0; // Auto Chain
        emitDspState(true);
        notifyclients();
        mgraphics.redraw();
        return;
    }

    // 3. Check Top Bar Band Solo / Multi-Band Pills (1..curNumBands)
    for (var b = 0; b < curNumBands; b++) {
        var pr = getBandPillRect(b);
        if (x >= pr[0] && x <= pr[0] + pr[2] && y >= pr[1] && y <= pr[1] + pr[3]) {
            pushUndoState();
            var rightMultiToggle = (x >= pr[0] + pr[2] - 12);
            if (shift || cmd || rightMultiToggle) {
                var currentMask = getEffectiveMask();
                var nextMask = currentMask ^ (1 << b);
                curBandMode = 5;
                curCustomMask = nextMask;
            } else {
                curBandMode = b + 1;
                curCustomMask = 1 << b;
            }
            emitDspState(true);
            notifyclients();
            mgraphics.redraw();
            return;
        }
    }

    // 4. Check Bottom-Right Spectrogram Link Info Toggle Badge
    var lr = getLinkBadgeRect();
    if (x >= lr[0] && x <= lr[0] + lr[2] && y >= lr[1] && y <= lr[1] + lr[3]) {
        showLinkStatus = !showLinkStatus;
        notifyclients();
        mgraphics.redraw();
        return;
    }

    // 5. Check Crossover Handles inside Plot
    var hIdx = hitTestHandle(x, y);
    if (hIdx >= 0) {
        if (lastClickTarget === ("h" + hIdx) && (now - lastClickTime) < 320) {
            pushUndoState();
            if (hIdx === 0) set_f1(MBSPLIT_DEFAULT_F1);
            else if (hIdx === 1) set_f2(MBSPLIT_DEFAULT_F2);
            else if (hIdx === 2) set_f3(MBSPLIT_DEFAULT_F3);
            emitDspState(true);
            notifyclients();
            lastClickTime = 0;
            dragHandleIdx = -1;
            return;
        }
        lastClickTime = now;
        lastClickTarget = "h" + hIdx;
        pushUndoState();
        dragHandleIdx = hIdx;
        dragVolume = false;
        return;
    }

    // 6. Clicking inside a band region in the plot solos that band (or Shift-clicks to multi-toggle)
    var regionBand = hitTestBandRegionInPlot(x, y);
    if (regionBand >= 0) {
        pushUndoState();
        if (shift || cmd) {
            curBandMode = 5;
            curCustomMask = getEffectiveMask() ^ (1 << regionBand);
        } else {
            curBandMode = regionBand + 1;
            curCustomMask = 1 << regionBand;
        }
        emitDspState(true);
        notifyclients();
        mgraphics.redraw();
    }
}

function ondblclick(x, y) {
    var vr = getVolumeSliderRect();
    if (x >= vr[0] && x <= vr[0] + vr[2] && y >= vr[1] && y <= vr[1] + vr[3]) {
        releaseMouseCursor();
        pushUndoState();
        curGainDb = 0.0;
        volDragNorm = gainDbToSliderNorm(0.0);
        emitDspState(true);
        notifyclients();
        dragVolume = false;
        mgraphics.redraw();
        return;
    }
    var hIdx = hitTestHandle(x, y);
    if (hIdx >= 0) {
        pushUndoState();
        if (hIdx === 0) set_f1(MBSPLIT_DEFAULT_F1);
        else if (hIdx === 1) set_f2(MBSPLIT_DEFAULT_F2);
        else if (hIdx === 2) set_f3(MBSPLIT_DEFAULT_F3);
        emitDspState(true);
        notifyclients();
        dragHandleIdx = -1;
    }
}

function ondrag(x, y, but, cmd, shift) {
    if (dragVolume) {
        if (but === 0) {
            dragVolume = false;
            releaseMouseCursor();
            notifyclients();
            mgraphics.redraw();
            return;
        }
        // Vertical (up/down) dragging only — moving UP (smaller y) increases gain,
        // moving DOWN (larger y) decreases gain. Horizontal x movement is ignored.
        var dy = volDragLastY - y;
        volDragLastY = y;
        if (Math.abs(dy) > 0) {
            lastClickTime = 0;
        }
        var stepPerPx = shift ? 0.0015 : 0.008;
        volDragNorm = clamp(volDragNorm + dy * stepPerPx, 0.0, 1.0);
        curGainDb = sliderNormToGainDb(volDragNorm);
        emitDspState(true);
        mgraphics.redraw();
        return;
    }

    if (dragHandleIdx < 0) return;
    if (but === 0) {
        dragHandleIdx = -1;
        notifyclients();
        mgraphics.redraw();
        return;
    }
    var targetFreq = xToFreq(x);
    if (dragHandleIdx === 0) {
        var s0 = sanitizeCrossovers(targetFreq, curF2, curF3, 0);
        curF1 = s0[0]; curF2 = s0[1]; curF3 = s0[2];
    } else if (dragHandleIdx === 1) {
        var s1 = sanitizeCrossovers(curF1, targetFreq, curF3, 1);
        curF1 = s1[0]; curF2 = s1[1]; curF3 = s1[2];
    } else if (dragHandleIdx === 2) {
        var s2 = sanitizeCrossovers(curF1, curF2, targetFreq, 2);
        curF1 = s2[0]; curF2 = s2[1]; curF3 = s2[2];
    }
    emitDspState(true);
    broadcastLinkedState();
    mgraphics.redraw();
}

function onidle(x, y) {
    var prevH = hoverHandleIdx;
    var prevB = hoverBandIdx;
    var prevA = hoverAutoBtn;
    var prevV = hoverVolSlider;
    var prevL = hoverLinkBadge;

    var ar = getAutoBtnRect();
    hoverAutoBtn = (x >= ar[0] && x <= ar[0] + ar[2] && y >= ar[1] && y <= ar[1] + ar[3]);

    var vr = getVolumeSliderRect();
    hoverVolSlider = (x >= vr[0] && x <= vr[0] + vr[2] && y >= vr[1] && y <= vr[1] + vr[3]);

    var lr = getLinkBadgeRect();
    hoverLinkBadge = (x >= lr[0] && x <= lr[0] + lr[2] && y >= lr[1] && y <= lr[1] + lr[3]);

    hoverBandIdx = -1;
    for (var b = 0; b < curNumBands; b++) {
        var pr = getBandPillRect(b);
        if (x >= pr[0] && x <= pr[0] + pr[2] && y >= pr[1] && y <= pr[1] + pr[3]) {
            hoverBandIdx = b;
            break;
        }
    }

    hoverHandleIdx = hitTestHandle(x, y);

    if (prevH !== hoverHandleIdx || prevB !== hoverBandIdx || prevA !== hoverAutoBtn ||
        prevV !== hoverVolSlider || prevL !== hoverLinkBadge) {
        mgraphics.redraw();
    }
}

function onidleout() {
    hoverHandleIdx = -1;
    hoverBandIdx = -1;
    hoverAutoBtn = false;
    hoverVolSlider = false;
    hoverLinkBadge = false;
    mgraphics.redraw();
}

// =========================================================================
// MGRAPHICS RENDERING (Block-Size 8192 Harmonic Spectrogram + LR Bode)
// =========================================================================
function ownerBandForFreq(f) {
    if (curNumBands <= 1) return 0;
    if (curNumBands === 2) return (f < curF1) ? 0 : 1;
    if (curNumBands === 3) return (f < curF1) ? 0 : ((f < curF2) ? 1 : 2);
    return (f < curF1) ? 0 : ((f < curF2) ? 1 : ((f < curF3) ? 2 : 3));
}

function drawSpectrogramAndCurves(activeMask, xoverCount) {
    var plotBottom = PLOT_Y + PLOT_H - 2;
    var innerW = PLOT_W - 2;

    // 4A. 2D Scrolling Harmonic Waterfall Spectrogram (8192-Point FFT History)
    var numRows = specColHistory.length;
    if (numRows > 0) {
        var rowH = (PLOT_H - 4) / MAX_WATERFALL_ROWS;
        var colW = innerW / SPEC_COLS;
        for (var r = 0; r < numRows; r++) {
            var wfRow = specColHistory[r];
            var ry = PLOT_Y + 2 + r * rowH;
            var ageFade = 1.0 - (r / MAX_WATERFALL_ROWS) * 0.65;
            for (var c = 0; c < SPEC_COLS; c++) {
                var cellDb = wfRow[c];
                var intensity = clamp((cellDb + 54.0) / 52.0, 0.0, 1.0);
                if (intensity <= 0.08) continue;
                var fMid = specColFreqs[c];
                var bOwner = ownerBandForFreq(fMid);
                var isBandOn = ((activeMask & (1 << bOwner)) !== 0);
                var bCol = MBSPLIT_BAND_COLORS[bOwner] || MBSPLIT_BAND_COLORS[0];
                var hot = Math.pow(intensity, 1.65);
                var alpha = hot * ageFade * (isBandOn ? 0.34 : 0.09);
                if (alpha < 0.015) continue;

                mgraphics.set_source_rgba(
                    bCol[0] * (0.75 + 0.35 * hot),
                    bCol[1] * (0.75 + 0.35 * hot),
                    bCol[2] * (0.75 + 0.35 * hot),
                    alpha
                );
                mgraphics.rectangle(PLOT_X + 1 + c * colW, ry, Math.max(1.15, colW + 0.25), rowH + 0.35);
                mgraphics.fill();
            }
        }
    }

    // 4B. Full-Spectrum Unfiltered 8192-Point FFT Harmonic Silhouette (248 columns = 1px resolution)
    mgraphics.set_source_rgba(0.36, 0.48, 0.64, 0.16);
    mgraphics.move_to(PLOT_X + 1, plotBottom);
    for (var cAll = 0; cAll < SPEC_COLS; cAll++) {
        var xAll = PLOT_X + 1 + (cAll / (SPEC_COLS - 1)) * innerW;
        var normAll = clamp((specColDb[cAll] + 56.0) / 54.0, 0.0, 1.0);
        var yAll = plotBottom - normAll * (PLOT_H - 10);
        mgraphics.line_to(xAll, yAll);
    }
    mgraphics.line_to(PLOT_X + PLOT_W - 1, plotBottom);
    mgraphics.close_path();
    mgraphics.fill();

    // Unfiltered input harmonic trace (subtle slate line showing harmonics outside soloed band)
    mgraphics.set_line_width(0.85);
    mgraphics.set_source_rgba(0.48, 0.60, 0.74, 0.32);
    for (var cIn = 0; cIn < SPEC_COLS; cIn++) {
        var xIn = PLOT_X + 1 + (cIn / (SPEC_COLS - 1)) * innerW;
        var normIn = clamp((specColDb[cIn] + 56.0) / 54.0, 0.0, 1.0);
        var yIn = plotBottom - normIn * (PLOT_H - 10);
        if (cIn === 0) mgraphics.move_to(xIn, yIn);
        else mgraphics.line_to(xIn, yIn);
    }
    mgraphics.stroke();

    // 4C. Active-Band Post-Crossover 8192-Point Harmonic Spectrogram Fill & Crisp Harmonic Crest
    for (var bBand = 0; bBand < curNumBands; bBand++) {
        var bandOn = ((activeMask & (1 << bBand)) !== 0);
        if (!bandOn) continue;
        var sCol = MBSPLIT_BAND_COLORS[bBand] || MBSPLIT_BAND_COLORS[0];

        var glowAlphas = [0.20, 0.30];
        var glowScales = [1.0, 0.78];
        for (var gl = 0; gl < 2; gl++) {
            mgraphics.set_source_rgba(sCol[0], sCol[1], sCol[2], glowAlphas[gl]);
            mgraphics.move_to(PLOT_X + 1, plotBottom);
            for (var i = 0; i < SPEC_COLS; i++) {
                var sx = PLOT_X + 1 + (i / (SPEC_COLS - 1)) * innerW;
                var sf = specColFreqs[i];
                var sDb = specColDb[i];
                var respBand = computeBandMagnitudesAtFreq(sf, curF1, curF2, curF3, curNumBands, curSlope, activeMask, curPhaseMode, scopeSampleRate);
                var bandGainDb = linToDb(Math.max(respBand.bands[bBand], 1e-4));
                var effDb = sDb + bandGainDb;
                var normY = clamp((effDb + 56.0) / 54.0, 0.0, 1.0) * glowScales[gl];
                var sy = plotBottom - normY * (PLOT_H - 10);
                mgraphics.line_to(sx, sy);
            }
            mgraphics.line_to(PLOT_X + PLOT_W - 1, plotBottom);
            mgraphics.close_path();
            mgraphics.fill();
        }

        // High-resolution 1px-stepped harmonic crest line (shows every sawtooth overtone spike clearly)
        mgraphics.set_line_width(1.15);
        mgraphics.set_source_rgba(
            Math.min(1.0, sCol[0] + 0.25),
            Math.min(1.0, sCol[1] + 0.25),
            Math.min(1.0, sCol[2] + 0.25),
            0.94
        );
        for (var j = 0; j < SPEC_COLS; j++) {
            var tx = PLOT_X + 1 + (j / (SPEC_COLS - 1)) * innerW;
            var tf = specColFreqs[j];
            var tDb = specColDb[j];
            var tResp = computeBandMagnitudesAtFreq(tf, curF1, curF2, curF3, curNumBands, curSlope, activeMask, curPhaseMode, scopeSampleRate);
            var tEffDb = tDb + linToDb(Math.max(tResp.bands[bBand], 1e-4));
            var tNorm = clamp((tEffDb + 56.0) / 54.0, 0.0, 1.0);
            var ty = plotBottom - tNorm * (PLOT_H - 10);
            if (j === 0) mgraphics.move_to(tx, ty);
            else mgraphics.line_to(tx, ty);
        }
        mgraphics.stroke();
    }

    // 4D. 8192-Point Peak-Hold Harmonic Envelope Trace
    mgraphics.set_line_width(0.8);
    mgraphics.set_source_rgba(0.80, 0.90, 1.0, 0.34);
    for (var pk = 0; pk < SPEC_COLS; pk++) {
        var pkX = PLOT_X + 1 + (pk / (SPEC_COLS - 1)) * innerW;
        var pkNorm = clamp((specColPeaks[pk] + 56.0) / 54.0, 0.0, 1.0);
        var pkY = plotBottom - pkNorm * (PLOT_H - 10);
        if (pk === 0) mgraphics.move_to(pkX, pkY);
        else mgraphics.line_to(pkX, pkY);
    }
    mgraphics.stroke();

    // 5. Linkwitz-Riley Filter Transfer Curves (Inactive Bands first, Active Band(s) on top)
    var numSteps = 96;
    for (var pass = 0; pass < 2; pass++) {
        for (var bIdx = 0; bIdx < curNumBands; bIdx++) {
            var isBandActive = ((activeMask & (1 << bIdx)) !== 0);
            if ((pass === 0 && isBandActive) || (pass === 1 && !isBandActive)) continue;

            var bCol2 = MBSPLIT_BAND_COLORS[bIdx] || MBSPLIT_BAND_COLORS[0];

            if (isBandActive) {
                mgraphics.set_source_rgba(bCol2[0], bCol2[1], bCol2[2], 0.10);
                mgraphics.move_to(PLOT_X, PLOT_Y + PLOT_H - 1);
                for (var s = 0; s <= numSteps; s++) {
                    var px = PLOT_X + (s / numSteps) * PLOT_W;
                    var pf = xToFreq(px);
                    var resp = computeBandMagnitudesAtFreq(pf, curF1, curF2, curF3, curNumBands, curSlope, activeMask, curPhaseMode, scopeSampleRate);
                    var py = magToY(resp.bands[bIdx]);
                    mgraphics.line_to(px, py);
                }
                mgraphics.line_to(PLOT_X + PLOT_W, PLOT_Y + PLOT_H - 1);
                mgraphics.close_path();
                mgraphics.fill();
            }

            mgraphics.set_line_width(isBandActive ? 1.8 : 1.0);
            mgraphics.set_source_rgba(
                bCol2[0],
                bCol2[1],
                bCol2[2],
                isBandActive ? 0.95 : 0.28
            );
            for (var s2 = 0; s2 <= numSteps; s2++) {
                var px2 = PLOT_X + (s2 / numSteps) * PLOT_W;
                var pf2 = xToFreq(px2);
                var resp2 = computeBandMagnitudesAtFreq(pf2, curF1, curF2, curF3, curNumBands, curSlope, activeMask, curPhaseMode, scopeSampleRate);
                var py2 = magToY(resp2.bands[bIdx]);
                if (s2 === 0) mgraphics.move_to(px2, py2);
                else mgraphics.line_to(px2, py2);
            }
            mgraphics.stroke();
        }
    }

    // Composite active sum curve when multiple bands are enabled in Custom mode
    var enabledCount = ((activeMask & 1) ? 1 : 0) + ((activeMask & 2) ? 1 : 0) +
                       ((activeMask & 4) ? 1 : 0) + ((activeMask & 8) ? 1 : 0);
    if (enabledCount > 1) {
        mgraphics.set_line_width(1.4);
        mgraphics.set_source_rgba(0.95, 0.98, 1.0, 0.85);
        for (var sc = 0; sc <= numSteps; sc++) {
            var pxc = PLOT_X + (sc / numSteps) * PLOT_W;
            var pfc = xToFreq(pxc);
            var respc = computeBandMagnitudesAtFreq(pfc, curF1, curF2, curF3, curNumBands, curSlope, activeMask, curPhaseMode, scopeSampleRate);
            var pyc = magToY(respc.activeSum);
            if (sc === 0) mgraphics.move_to(pxc, pyc);
            else mgraphics.line_to(pxc, pyc);
        }
        mgraphics.stroke();
    }

    // 6. Draggable Crossover Handles (F1, F2, F3) with Collision-Free Frequency Pills
    for (var cIdx = 0; cIdx < xoverCount; cIdx++) {
        var fc = getCrossoverFreq(cIdx);
        var hx = freqToX(fc);
        var isActiveDrag = (dragHandleIdx === cIdx);
        var isHover = (hoverHandleIdx === cIdx);

        mgraphics.set_line_width(isActiveDrag ? 1.8 : (isHover ? 1.5 : 1.1));
        mgraphics.set_source_rgba(
            isActiveDrag ? 1.0 : 0.86,
            isActiveDrag ? 0.92 : 0.92,
            isActiveDrag ? 0.55 : 0.98,
            isActiveDrag ? 1.0 : (isHover ? 0.92 : 0.72)
        );
        mgraphics.move_to(hx, PLOT_Y + 2);
        mgraphics.line_to(hx, PLOT_Y + PLOT_H - 2);
        mgraphics.stroke();

        var nodeY = magToY(0.5); // -6.02 dB Linkwitz-Riley crossover point
        mgraphics.set_source_rgba(0.06, 0.08, 0.11, 1.0);
        mgraphics.arc(hx, nodeY, isActiveDrag ? 4.8 : 3.8, 0, Math.PI * 2);
        mgraphics.fill();

        mgraphics.set_line_width(1.6);
        mgraphics.set_source_rgba(
            isActiveDrag ? 1.0 : 0.52,
            isActiveDrag ? 0.85 : 0.90,
            isActiveDrag ? 0.32 : 1.0,
            1.0
        );
        mgraphics.arc(hx, nodeY, isActiveDrag ? 4.8 : 3.8, 0, Math.PI * 2);
        mgraphics.stroke();

        var fText = formatFreq(fc);
        var pillW = 36;
        var pillH = 12;
        var pillX = clamp(hx - pillW * 0.5, PLOT_X + 2, PLOT_X + PLOT_W - pillW - 2);
        var pillY = PLOT_Y + 4 + (cIdx % 2) * 14;

        mgraphics.set_source_rgba(0.05, 0.07, 0.10, 0.90);
        mgraphics.rectangle_rounded(pillX, pillY, pillW, pillH, 3, 3);
        mgraphics.fill();

        mgraphics.set_line_width(1.0);
        mgraphics.set_source_rgba(0.32, 0.44, 0.56, isActiveDrag ? 0.95 : 0.65);
        mgraphics.rectangle_rounded(pillX + 0.5, pillY + 0.5, pillW - 1, pillH - 1, 3, 3);
        mgraphics.stroke();

        mgraphics.select_font_face("Arial Bold");
        mgraphics.set_font_size(7.5);
        mgraphics.set_source_rgba(0.92, 0.96, 1.0, 1.0);
        mgraphics.move_to(pillX + 4, pillY + 9);
        mgraphics.show_text(fText);
    }
}

function drawTopVolumeSlider() {
    var vr = getVolumeSliderRect();
    var vx = vr[0], vy = vr[1], vw = vr[2], vh = vr[3];
    var norm = gainDbToSliderNorm(curGainDb);
    var zeroNorm = gainDbToSliderNorm(0.0);

    // Track background
    mgraphics.set_source_rgba(0.07, 0.09, 0.12, 1.0);
    mgraphics.rectangle_rounded(vx, vy, vw, vh, 3, 3);
    mgraphics.fill();

    // Pre-blended fill bar from left edge
    var fillW = Math.max(0.0, (vw - 2) * norm);
    if (fillW > 0.5) {
        var isBoost = (curGainDb > 0.05);
        mgraphics.set_source_rgba(
            isBoost ? 0.44 : 0.16,
            isBoost ? 0.34 : 0.38,
            isBoost ? 0.14 : 0.48,
            0.95
        );
        mgraphics.rectangle_rounded(vx + 1, vy + 1, fillW, vh - 2, 2, 2);
        mgraphics.fill();
    }

    // 0 dB unity reference tick
    var zeroX = Math.round(vx + 1 + (vw - 2) * zeroNorm) + 0.5;
    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(0.55, 0.68, 0.82, 0.45);
    mgraphics.move_to(zeroX, vy + 2);
    mgraphics.line_to(zeroX, vy + vh - 2);
    mgraphics.stroke();

    // Slider border
    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(
        dragVolume ? 0.38 : (hoverVolSlider ? 0.32 : 0.22),
        dragVolume ? 0.86 : (hoverVolSlider ? 0.72 : 0.28),
        dragVolume ? 0.98 : (hoverVolSlider ? 0.88 : 0.36),
        0.95
    );
    mgraphics.rectangle_rounded(vx + 0.5, vy + 0.5, vw - 1, vh - 1, 3, 3);
    mgraphics.stroke();

    // High-contrast dB readout text ("-inf dB" .. "+18.0 dB")
    var gLabel = formatGainDb(curGainDb);
    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(7.5);
    mgraphics.set_source_rgba(0.92, 0.96, 1.0, 1.0);
    var textX = vx + (gLabel.length >= 7 ? 7 : 10);
    mgraphics.move_to(textX, vy + vh - 4.2);
    mgraphics.show_text(gLabel);
}

function drawBottomRightLinkBadge() {
    var lr = getLinkBadgeRect();
    var lx = lr[0], ly = lr[1], lw = lr[2], lh = lr[3];

    var linkNames = [rackContext.shortLabel, "GRP A", "GRP B", "GRP C", "GRP D", "UNLINKED"];
    var linkLabel = linkNames[curLinkGroup] || rackContext.shortLabel;
    var peers = getLinkedPeerCount();
    var countBadge = (manualBandsOverride !== null) ? Math.max(peers, curNumBands) : peers;
    var peerBadge = (curLinkGroup === 5)
        ? "LINK: OFF"
        : ("LINK: " + linkLabel + " (" + countBadge + "x)");

    // Dark translucent pill background inside bottom-right corner of spectrogram
    mgraphics.set_source_rgba(0.04, 0.055, 0.075, showLinkStatus ? 0.88 : 0.72);
    mgraphics.rectangle_rounded(lx, ly, lw, lh, 3, 3);
    mgraphics.fill();

    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(
        hoverLinkBadge ? 0.38 : 0.22,
        hoverLinkBadge ? 0.82 : 0.34,
        hoverLinkBadge ? 0.96 : 0.46,
        showLinkStatus ? 0.85 : 0.55
    );
    mgraphics.rectangle_rounded(lx + 0.5, ly + 0.5, lw - 1, lh - 1, 3, 3);
    mgraphics.stroke();

    // Link status dot
    var isLinked = (curLinkGroup !== 5);
    mgraphics.set_source_rgba(
        isLinked ? 0.25 : 0.45,
        isLinked ? 0.88 : 0.50,
        isLinked ? 0.72 : 0.58,
        showLinkStatus ? 0.98 : 0.75
    );
    mgraphics.arc(lx + 5.5, ly + lh * 0.5, 2.0, 0, Math.PI * 2);
    mgraphics.fill();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(6.8);
    mgraphics.set_source_rgba(0.76, 0.90, 0.98, showLinkStatus ? 0.96 : 0.78);
    if (showLinkStatus) {
        mgraphics.move_to(lx + 10, ly + lh - 3.5);
        mgraphics.show_text(peerBadge);
    } else {
        mgraphics.move_to(lx + 9.5, ly + lh - 3.5);
        mgraphics.show_text("LNK");
    }
}

function paint() {
    var size = mgraphics.size;
    var w = size[0] || 256;
    var h = size[1] || 136;
    updatePlotBounds();

    var activeMask = getEffectiveMask();
    var bandNames = getBandNames(curNumBands);
    var xoverCount = getActiveCrossoverCount();

    // 1. Canvas Outer Background
    mgraphics.set_source_rgba(0.045, 0.055, 0.072, 1.0);
    mgraphics.rectangle_rounded(0, 0, w, h, 5, 5);
    mgraphics.fill();

    // 2. Top Bar: [AUTO] + Detected Instance Band Pills (1..4) + Volume Slider (-inf..+18 dB)
    var ar = getAutoBtnRect();
    var isAuto = (curBandMode === 0);
    mgraphics.set_source_rgba(
        isAuto ? 0.14 : (hoverAutoBtn ? 0.12 : 0.08),
        isAuto ? 0.34 : (hoverAutoBtn ? 0.16 : 0.10),
        isAuto ? 0.44 : (hoverAutoBtn ? 0.22 : 0.14),
        1.0
    );
    mgraphics.rectangle_rounded(ar[0], ar[1], ar[2], ar[3], 3, 3);
    mgraphics.fill();

    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(
        isAuto ? 0.28 : 0.22,
        isAuto ? 0.82 : 0.28,
        isAuto ? 0.96 : 0.36,
        isAuto ? 0.95 : 0.7
    );
    mgraphics.rectangle_rounded(ar[0] + 0.5, ar[1] + 0.5, ar[2] - 1, ar[3] - 1, 3, 3);
    mgraphics.stroke();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(7.2);
    mgraphics.set_source_rgba(
        isAuto ? 0.55 : 0.62,
        isAuto ? 0.94 : 0.68,
        isAuto ? 1.00 : 0.76,
        1.0
    );
    mgraphics.move_to(ar[0] + 5, ar[1] + ar[3] - 4.2);
    mgraphics.show_text("AUTO");

    // Band Solo / Pass Pills (1..curNumBands, auto-created per detected instance)
    for (var b = 0; b < curNumBands; b++) {
        var pr = getBandPillRect(b);
        var isOn = ((activeMask & (1 << b)) !== 0);
        var col = MBSPLIT_BAND_COLORS[b] || MBSPLIT_BAND_COLORS[0];

        mgraphics.set_source_rgba(
            isOn ? col[0] * 0.26 : 0.075,
            isOn ? col[1] * 0.26 : 0.090,
            isOn ? col[2] * 0.26 : 0.115,
            1.0
        );
        mgraphics.rectangle_rounded(pr[0], pr[1], pr[2], pr[3], 3, 3);
        mgraphics.fill();

        var bPeak = clamp(bandPeaks[b] || 0.0, 0.0, 1.0);
        if (bPeak > 0.01) {
            var mw = Math.max(2, (pr[2] - 4) * Math.pow(bPeak, 0.65));
            mgraphics.set_source_rgba(col[0], col[1], col[2], isOn ? 0.55 : 0.25);
            mgraphics.rectangle(pr[0] + 2, pr[1] + pr[3] - 2.5, mw, 1.8);
            mgraphics.fill();
        }

        mgraphics.set_line_width(isOn ? 1.2 : 1.0);
        mgraphics.set_source_rgba(
            isOn ? col[0] : 0.20,
            isOn ? col[1] : 0.25,
            isOn ? col[2] : 0.32,
            isOn ? 0.95 : 0.65
        );
        mgraphics.rectangle_rounded(pr[0] + 0.5, pr[1] + 0.5, pr[2] - 1, pr[3] - 1, 3, 3);
        mgraphics.stroke();

        mgraphics.set_source_rgba(
            isOn ? col[0] : 0.30,
            isOn ? col[1] : 0.35,
            isOn ? col[2] : 0.42,
            isOn ? 1.0 : 0.55
        );
        mgraphics.arc(pr[0] + 5.0, pr[1] + pr[3] * 0.5, 1.8, 0, Math.PI * 2);
        mgraphics.fill();

        mgraphics.select_font_face("Arial Bold");
        mgraphics.set_font_size(curNumBands === 4 ? 6.8 : 7.4);
        mgraphics.set_source_rgba(
            isOn ? 0.96 : 0.55,
            isOn ? 0.98 : 0.62,
            isOn ? 1.00 : 0.70,
            1.0
        );
        var compactNames4 = ["LOW", "LO-M", "HI-M", "HIGH"];
        var shortName = (curNumBands === 4) ? compactNames4[b] : bandNames[b];
        var bLabel = (curNumBands === 4) ? shortName : ((b + 1) + ":" + shortName);
        mgraphics.move_to(pr[0] + 9, pr[1] + ar[3] - 4.2);
        mgraphics.show_text(bLabel);
    }

    // Top-right Volume Slider (-inf to +18 dB, replacing the Rack debug string)
    drawTopVolumeSlider();

    // 3. Main Bode / 8192-Block Spectrogram Viewport
    mgraphics.set_source_rgba(0.028, 0.036, 0.050, 1.0);
    mgraphics.rectangle_rounded(PLOT_X, PLOT_Y, PLOT_W, PLOT_H, 4, 4);
    mgraphics.fill();

    // Logarithmic frequency grid lines
    var gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    mgraphics.set_line_width(1.0);
    for (var gf = 0; gf < gridFreqs.length; gf++) {
        var gx = Math.round(freqToX(gridFreqs[gf])) + 0.5;
        var isMajor = (gridFreqs[gf] === 100 || gridFreqs[gf] === 1000 || gridFreqs[gf] === 10000);
        mgraphics.set_source_rgba(0.16, 0.21, 0.28, isMajor ? 0.48 : 0.22);
        mgraphics.move_to(gx, PLOT_Y + 1);
        mgraphics.line_to(gx, PLOT_Y + PLOT_H - 1);
        mgraphics.stroke();
    }

    // Horizontal dB reference lines (0 dB, -6 dB crossover point, -18 dB, -30 dB)
    var gridDbs = [0, -6, -18, -30];
    for (var gd = 0; gd < gridDbs.length; gd++) {
        var gy = Math.round(magToY(dbToLin(gridDbs[gd]))) + 0.5;
        var isZero = (gridDbs[gd] === 0);
        var isMinus6 = (gridDbs[gd] === -6);
        mgraphics.set_source_rgba(
            isZero ? 0.28 : (isMinus6 ? 0.22 : 0.15),
            isZero ? 0.36 : (isMinus6 ? 0.30 : 0.20),
            isZero ? 0.46 : (isMinus6 ? 0.40 : 0.26),
            isZero ? 0.58 : (isMinus6 ? 0.40 : 0.20)
        );
        mgraphics.move_to(PLOT_X + 1, gy);
        mgraphics.line_to(PLOT_X + PLOT_W - 1, gy);
        mgraphics.stroke();
    }

    // 4-6. Render 8192-Block Waterfall Spectrogram, Harmonic Spectrum, LR Bode Curves & Handles
    drawSpectrogramAndCurves(activeMask, xoverCount);

    // 7. Bottom-Right Clickable Link Status Badge inside Spectrogram
    drawBottomRightLinkBadge();

    // Viewport border
    mgraphics.set_line_width(1.0);
    mgraphics.set_source_rgba(0.18, 0.24, 0.32, 1.0);
    mgraphics.rectangle_rounded(PLOT_X + 0.5, PLOT_Y + 0.5, PLOT_W - 1, PLOT_H - 1, 4, 4);
    mgraphics.stroke();
}
