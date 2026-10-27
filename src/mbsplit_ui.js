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
var curCustomMask = 1;          // 4-bit mask (0..15, 0 = every band off) used when curBandMode === 5
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

var bandPeaks = [0, 0, 0, 0];      // meters shown on the band pills: max over the linked instances' own bands
var bandPeaksOwn = [0, 0, 0, 0];   // this instance's gen only computes the bands it outputs (prune), see getBandPeaks()
var inPeak = 0.0;
var outPeak = 0.0;

// Work sharing between the instances of one link group (rack): one instance computes the FFT spectrogram, the others
// copy its columns through Global("mbsplit_shared_bus").spec[groupKey]; the gen of each instance only filters the
// bands it outputs (`prune`, see src/mbsplit_core.genexpr).
var TOPO_INTERVAL_MS = 250;        // LOM / topology polling (the scope itself is read every 40 ms)
var FFT_RING_FILL_MS = 200;        // the 8192-sample ring (170 ms at 48 kHz) must refill after `ringon` turns on
var FFT_SHARE_FRESH_MS = 400;
var lastTopoTime = 0;
var cachedAlivePeers = [];
var fftWantRing = true;            // this instance runs the FFT (its gen writes the ring)
var fftRingOnSince = 0;
var sharedSeqSeen = -1;
var fftSeq = 0;
var fftComputed = 0;               // FFTs this instance ran
var fftCopied = 0;                 // spectrogram frames this instance took from another instance
var sentPrune = -1;
var silentTicks = 0;
var lastDrawSig = "";
var LR_CURVE_STEPS = 96;
var lrGeomKey = "";
var lrSumGeom = "";
var lrSumMask = -2;
var lrBandCol = null;
var lrBandStep = null;
var lrSumStep = null;
var gateNeedBits = 0;              // scope slot 28: bands the gen computes (bit 0..3) | prune (16)
var gateAsleep = 0;                // scope slot 29: gen silence sleep

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
    // Smooth perceptual curve for -70..0 dB -> 0.0..0.72.
    // Exponent is matched to sliderNormToGainDb below so the pair is an exact inverse.
    return clamp(0.72 * Math.pow((g + 70.0) / 70.0, 1.5), 0.0, 0.72);
}

function sliderNormToGainDb(norm) {
    var n = clamp(Number(norm) || 0.0, 0.0, 1.0);
    // Only true zero is silence (-inf dB). No dead zone, so gains in (-70, -62.4) dB
    // stay reachable and the pair round-trips with gainDbToSliderNorm.
    if (n <= 0.0) return -70.0;
    if (n >= 0.72) {
        return clamp(((n - 0.72) / 0.28) * 18.0, 0.0, 18.0);
    }
    var db = -70.0 + 70.0 * Math.pow(n / 0.72, 1.0 / 1.5);
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
        getBandPeaks: function() { return bandPeaksOwn; },
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
                isDeleted: isDeleted,
                f1: curF1, f2: curF2, f3: curF3, slope: curSlope, phaseMode: curPhaseMode,
                dspReady: mbDsp.ready,
                dspError: mbDsp.error,
                dspReadyMs: mbDsp.readyMs,
                dspRetries: mbDsp.retries,
                prune: sentPrune,
                ringOn: fftWantRing ? 1 : 0,
                fftComputed: fftComputed,
                fftCopied: fftCopied,
                needBits: gateNeedBits,
                asleep: gateAsleep,
                beat: lastScopeBeat,
                bandPeaksOwn: bandPeaksOwn.slice(0)
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
        if (args.length >= 8) {
            var cmRaw = Math.round(Number(args[7]));
            // 0 is a real mask (every band off). `|| 1` would reload that silence as band 1.
            curCustomMask = isNaN(cmRaw) ? 1 : clamp(cmRaw, 0, 15);
        }
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

// Bottom-bar crossover sliders: crossover k (F1..F3) only exists with more than k bands, so the
// sliders for missing splits are greyed out (`active 0`; Live draws them dim in the theme) and come back when bands appear.
var crossoverActiveSent = [-1, -1, -1];

function isCrossoverActive(k) {
    return curNumBands > k ? 1 : 0;
}

function emitCrossoverActive(force) {
    for (var k = 1; k <= 3; k++) {
        var on = isCrossoverActive(k);
        if (!force && crossoverActiveSent[k - 1] === on) continue;
        crossoverActiveSent[k - 1] = on;
        outlet(0, ["ui_st_f" + k, "active", on]);
    }
}

function wantPrune() {
    return getLinkedPeerCount() >= 2 ? 1 : 0;
}

function emitWorkShare() {
    sentPrune = wantPrune();
    outlet(0, ["prune", sentPrune]);
    outlet(0, ["ringon", fftWantRing ? 1 : 0]);
}

function emitDspState(syncUiControls) {
    emitWorkShare();
    outlet(0, ["f1", curF1]);
    outlet(0, ["f2", curF2]);
    outlet(0, ["f3", curF3]);
    outlet(0, ["numbands", curNumBands]);
    outlet(0, ["slope", curSlope]);
    outlet(0, ["dynphase", curPhaseMode]);
    outlet(0, ["gain", curGainDb]);
    emitEffectiveBandMask();
    updateDeviceLatency();
    emitCrossoverActive(false);

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
    var selfClamped = Math.abs(s[0] - Number(v)) > 1e-4;
    emitDspState(neighChanged || selfClamped);
    broadcastLinkedState();
    mgraphics.redraw();
}

function set_f2(v) {
    var s = sanitizeCrossovers(curF1, v, curF3, 1);
    var neighChanged = (Math.abs(s[0] - curF1) > 1e-4 || Math.abs(s[2] - curF3) > 1e-4);
    curF1 = s[0];
    curF2 = s[1];
    curF3 = s[2];
    var selfClamped = Math.abs(s[1] - Number(v)) > 1e-4;
    emitDspState(neighChanged || selfClamped);
    broadcastLinkedState();
    mgraphics.redraw();
}

function set_f3(v) {
    var s = sanitizeCrossovers(curF1, curF2, v, 2);
    var neighChanged = (Math.abs(s[0] - curF1) > 1e-4 || Math.abs(s[1] - curF2) > 1e-4);
    curF1 = s[0];
    curF2 = s[1];
    curF3 = s[2];
    var selfClamped = Math.abs(s[2] - Number(v)) > 1e-4;
    emitDspState(neighChanged || selfClamped);
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
    crossoverActiveSent = [-1, -1, -1];
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
/** Raw (unsmoothed) dB value of every display column for one 8192-sample ring snapshot. The only FFT of a link group. */
function computeRawSpecColumns(samples8192, sampleRate) {
    var sr = Number(sampleRate) || 48000.0;
    var dbBins = computeFft8192DbBins(samples8192);
    ensureSpecColumnBins(sr, SPEC_COLS);
    var raw = new Array(SPEC_COLS);
    for (var c = 0; c < SPEC_COLS; c++) {
        var rawDb = sampleFft8192DbFromBins(colLo[c], colHi[c], dbBins);
        raw[c] = (rawDb === rawDb) ? clamp(rawDb, -200.0, 200.0) : -72.0;     // NaN / infinite telemetry must not poison the smoothing state
    }
    return raw;
}

/** Per-instance smoothing, peak hold and waterfall row from raw column values (own FFT or another instance's). */
function applyRawSpecColumns(raw, pushWaterfallRow) {
    var row = new Array(SPEC_COLS);
    for (var c = 0; c < SPEC_COLS; c++) {
        var rawDb = raw[c];
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
}

function updateSpectrogramFrom8192Samples(samples8192, sampleRate, pushWaterfallRow) {
    var raw = computeRawSpecColumns(samples8192, sampleRate);
    applyRawSpecColumns(raw, pushWaterfallRow);
    return null;
}

/**
 * Who computes the FFT of a link group: the first alive instance (chain order) always does; the others only while no other
 * instance has published a fresh frame in the last FFT_SHARE_FRESH_MS (leader missing, its DSP not loaded, stale after a
 * deletion). Returns the fresh frame to copy, or null.
 */
function updateFftRole(now, alive) {
    var key = getActiveGroupKey();
    var bus = getSharedBus();
    if (bus && !bus.spec) bus.spec = {};
    var share = (key && bus && bus.spec) ? bus.spec[key] : null;
    var fresh = (share && share.owner !== INSTANCE_ID && (now - share.t) < FFT_SHARE_FRESH_MS) ? share : null;
    var iAmLeader = (alive.length === 0) || (alive[0].id === INSTANCE_ID);
    var want = iAmLeader || !fresh;
    if (want !== fftWantRing) {
        fftWantRing = want;
        if (want) fftRingOnSince = now;
        outlet(0, ["ringon", want ? 1 : 0]);
    }
    return fresh;
}

function publishSpecShare(now, raw, silent) {
    if (!mbDsp.ready && !raw) return;   // no heartbeat from an instance whose gen~ is not running: the followers then compute themselves
    var key = getActiveGroupKey();
    var bus = getSharedBus();
    if (!key || !bus) return;
    if (!bus.spec) bus.spec = {};
    var share = bus.spec[key];
    if (!share || share.owner !== INSTANCE_ID) {
        share = { owner: INSTANCE_ID, t: now, seq: ++fftSeq, cols: raw || null, sr: scopeSampleRate };
        bus.spec[key] = share;
    }
    share.t = now;
    if (raw) {
        share.seq = ++fftSeq;
        share.cols = raw;
        share.sr = scopeSampleRate;
    }
    share.silent = silent ? 1 : 0;
}

/** Max over the group's instances of every band meter (each instance's gen only measures the bands it computes). */
function mergeBandPeaks(alive) {
    for (var b = 0; b < 4; b++) bandPeaks[b] = bandPeaksOwn[b];
    for (var i = 0; i < alive.length; i++) {
        var p = alive[i];
        if (!p || p.id === INSTANCE_ID || typeof p.getBandPeaks !== "function") continue;
        try {
            var pk = p.getBandPeaks();
            for (var k = 0; k < 4; k++) if (pk[k] > bandPeaks[k]) bandPeaks[k] = pk[k];
        } catch (err) {}
    }
}

function pullScope() {
    if (isDeleted) return;
    var now = Date.now();
    var redrawNeeded = false;

    // LOM / topology work is polled every TOPO_INTERVAL_MS (was every 40 ms in every instance, O(instances^2) LiveAPI reads)
    if (now - lastTopoTime >= TOPO_INTERVAL_MS) {
        lastTopoTime = now;

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

        cachedAlivePeers = getAliveGroupPeers(getActiveGroupKey());
        var prNow = wantPrune();
        if (prNow !== sentPrune) {
            sentPrune = prNow;
            outlet(0, ["prune", prNow]);
        }
    } else if (!isSelfCurrentlyAlive()) {
        return;
    }

    if (!scopeBufName || typeof Buffer === "undefined") {
        if (redrawNeeded) mgraphics.redraw();
        return;
    }
    try {
        var fresh = updateFftRole(now, cachedAlivePeers);
        var buf = new Buffer(scopeBufName);
        // Header only (slots 0..31, including the beat at 23 and the input peak at 20).
        // The 8192-sample ring starts at index 32 and is not read once the track is silent
        // and the waterfall has finished decaying.
        var hdr = buf.peek(1, 0, 32);
        if (!hdr || hdr.length < 24) return;

        for (var b = 0; b < 4; b++) {
            bandPeaksOwn[b] = clamp(Number(hdr[16 + b]) || 0.0, 0.0, 2.0);
        }
        mergeBandPeaks(cachedAlivePeers);
        inPeak = clamp(Number(hdr[20]) || 0.0, 0.0, 2.0);
        outPeak = clamp(Number(hdr[21]) || 0.0, 0.0, 2.0);
        gateNeedBits = Number(hdr[28]) || 0;
        gateAsleep = Number(hdr[29]) || 0;

        var scopeBeat = Number(hdr[23]) || 0;
        if (scopeBeat !== lastScopeBeat) {
            lastScopeBeat = scopeBeat;
            lastDspBeatTime = now;
            dspTimedOut = false;
        }

        var sr = Math.max(8000.0, Number(hdr[25]) || 48000.0);
        scopeSampleRate = sr;
        var firD = Math.round(Number(hdr[26]) || 0);
        if (firD >= 128 && firD !== firLatencySamples) {
            firLatencySamples = firD;
            updateDeviceLatency();
        }

        // Asleep, or under the noise floor: skip the ring read and the FFT. After 120 silent
        // ticks the waterfall has settled, so a stable meter signature skips redraw as well.
        var signalLive = (inPeak > 1e-4) && !(gateAsleep > 0.5);
        if (signalLive) {
            silentTicks = 0;
            if (fftWantRing) {
                // the ring only holds one 8192-sample window of the current input after it has refilled
                if (now - fftRingOnSince >= FFT_RING_FILL_MS) {
                    var ringPos = clamp(Math.floor(Number(hdr[24]) || 0), 0, MBSPLIT_FFT_SIZE - 1);
                    var ringData = buf.peek(1, 32, MBSPLIT_FFT_SIZE);
                    if (ringData && ringData.length >= MBSPLIT_FFT_SIZE) {
                        var N = MBSPLIT_FFT_SIZE;
                        for (var n = 0; n < N; n++) {
                            var rIdx = (ringPos + n) % N;
                            var rv = Number(ringData[rIdx]);
                            audioRingUnwrapped[n] = isFinite(rv) ? rv : 0.0;
                        }
                        var raw = computeRawSpecColumns(audioRingUnwrapped, sr);
                        fftComputed++;
                        publishSpecShare(now, raw, false);
                        applyRawSpecColumns(raw, true);
                        redrawNeeded = true;
                    }
                }
            } else if (fresh && fresh.cols && fresh.seq !== sharedSeqSeen) {
                sharedSeqSeen = fresh.seq;
                fftCopied++;
                applyRawSpecColumns(fresh.cols, true);
                redrawNeeded = true;
            }
        } else {
            if (fftWantRing) publishSpecShare(now, null, true);
            // decay to the floor, scroll the empty rows out, then stop drawing (nothing moves any more)
            if (silentTicks < 120) {
                silentTicks++;
                var silentRow = new Array(SPEC_COLS);
                for (var c = 0; c < SPEC_COLS; c++) {
                    specColDb[c] = Math.max(-72.0, specColDb[c] - 2.5);
                    specColPeaks[c] = Math.max(-72.0, specColPeaks[c] - 1.2);
                    silentRow[c] = specColDb[c];
                }
                specColHistory.unshift(silentRow);
                if (specColHistory.length > MAX_WATERFALL_ROWS) specColHistory.pop();
                redrawNeeded = true;
            }
        }

        // meters / pills: redraw when a displayed value moved visibly
        var sig = Math.round(bandPeaks[0] * 200) + "," + Math.round(bandPeaks[1] * 200) + "," + Math.round(bandPeaks[2] * 200) + "," +
            Math.round(bandPeaks[3] * 200) + "," + Math.round(outPeak * 200) + "," + mbDsp.ready + mbDsp.error;
        if (sig !== lastDrawSig) {
            lastDrawSig = sig;
            redrawNeeded = true;
        }
        if (redrawNeeded) mgraphics.redraw();
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
    mbDsp.ready = 1;
    mbDsp.error = "";
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
        deviceIndex: 0,
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
var PLOT_X = 0;
var PLOT_Y = 16;
var PLOT_W = 250;
var PLOT_H = 113;

function updatePlotBounds() {
    var size = mgraphics.size || [256, 136];
    var w = size[0] || 256;
    var h = size[1] || 136;
    PLOT_X = 0;
    PLOT_Y = 16;
    PLOT_W = w;
    PLOT_H = h - 16;
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
    return [0, 1, 30, 13];
}

function getVolumeSliderRect() {
    var size = mgraphics.size || [256, 136];
    var w = size[0] || 256;
    return [w - 66, 1, 66, 13];
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

// Text of the link badge (expanded status or compact "Link").
function linkBadgeText() {
    // until the deferred gen~ runs (src/mbsplit_dsp.js) the badge reports the DSP state instead of the link
    if (!mbDsp.ready) return mbDsp.error ? "DSP failed: " + String(mbDsp.error).substring(0, 22) : "DSP loading...";
    var linkNames = [rackContext.shortLabel, "GRP A", "GRP B", "GRP C", "GRP D", "UNLINKED"];
    var linkLabel = linkNames[curLinkGroup] || rackContext.shortLabel;
    var peers = getLinkedPeerCount();
    var countBadge = (manualBandsOverride !== null) ? Math.max(peers, curNumBands) : peers;
    if (!showLinkStatus) return "Link";
    return (curLinkGroup === 5) ? "Link off" : ("Link " + linkLabel + " (" + countBadge + "x)");
}

function getLinkBadgeRect() {
    updatePlotBounds();
    // wide enough for the measured text (dot + 10 px lead, 4 px tail), never wider than the plot
    var bw = clamp(sptTextW(linkBadgeText(), SPT_SIZE_SMALL) + 14, 26, PLOT_W - 4);
    var bh = 12;
    var bx = PLOT_X + PLOT_W - bw - 2;
    var by = PLOT_Y + PLOT_H - bh - 2;
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
        pushUndoState();
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

// =========================================================================
// ABLETON-NATIVE LOOK (Live theme colours via spectral_theme.js; flat, 1 px lines, one orange accent)
// =========================================================================
var MB_PANELS = [["obj-panel-body", "live_surface_bg"], ["obj-panel-bands", "live_desktop"], ["obj-panel-xo", "live_desktop"]];
var mbThemeTask = sptThemeWatch(function () { sptApplyPanelTheme(MB_PANELS); });

// Muted band colours from the theme (cyan, pink, salmon, grey-orange); the orange accent stays for handles and active controls.
function bandColor(b) {
    var cy = sptColor("live_display_line_two");
    var pk = sptColor("live_display_handle_two");
    var og = sptColor("live_display_line_one");
    if (b === 0) return cy;
    if (b === 1) return pk;
    if (b === 2) return sptMix(og, pk, 0.5);
    return sptMix(cy, og, 0.5);
}

function bandAlpha(c, a) {
    return sptMuted(c, a);
}

function mbBandPath(fn) {
    // fn(i, x, f) -> y
    var innerW = PLOT_W - 2;
    for (var i = 0; i < SPEC_COLS; i++) {
        var x = PLOT_X + 1 + (i / (SPEC_COLS - 1)) * innerW;
        var y = fn(i, x, specColFreqs[i]);
        if (i === 0) mgraphics.move_to(x, y);
        else mgraphics.line_to(x, y);
    }
}

// Linkwitz-Riley display curves. Rebuilt when F1/F2/F3, slope, band count, phase mode,
// sample rate or the plot width changes — not on every scope frame. BandMode / CustomMask
// only change the summed curve (activeMask).
function ensureLrDisplayCache(activeMask) {
    updatePlotBounds();
    var geom = curF1 + "\t" + curF2 + "\t" + curF3 + "\t" + curSlope + "\t" + curNumBands + "\t" +
        curPhaseMode + "\t" + scopeSampleRate + "\t" + PLOT_W + "\t" + PLOT_X + "\t" + curBandMode + "\t" + curCustomMask;
    if (geom !== lrGeomKey || !lrBandCol) {
        lrGeomKey = geom;
        lrSumGeom = "";
        if (!lrBandCol) {
            lrBandCol = [null, null, null, null];
            lrBandStep = [null, null, null, null];
            for (var b = 0; b < 4; b++) {
                lrBandCol[b] = new Float64Array(SPEC_COLS);
                lrBandStep[b] = new Float64Array(LR_CURVE_STEPS + 1);
            }
            lrSumStep = new Float64Array(LR_CURVE_STEPS + 1);
        }
        var nb = curNumBands;
        for (var i = 0; i < SPEC_COLS; i++) {
            var resp = computeBandMagnitudesAtFreq(specColFreqs[i], curF1, curF2, curF3, nb, curSlope, activeMask, curPhaseMode, scopeSampleRate);
            for (var bc = 0; bc < 4; bc++) lrBandCol[bc][i] = resp.bands[bc];
        }
        for (var s = 0; s <= LR_CURVE_STEPS; s++) {
            var px = PLOT_X + (s / LR_CURVE_STEPS) * PLOT_W;
            var respS = computeBandMagnitudesAtFreq(xToFreq(px), curF1, curF2, curF3, nb, curSlope, activeMask, curPhaseMode, scopeSampleRate);
            for (var bs = 0; bs < 4; bs++) lrBandStep[bs][s] = respS.bands[bs];
        }
    }
    if (lrSumGeom !== lrGeomKey || lrSumMask !== activeMask) {
        lrSumGeom = lrGeomKey;
        lrSumMask = activeMask;
        for (var s2 = 0; s2 <= LR_CURVE_STEPS; s2++) {
            var sum = 0.0;
            if (activeMask & 1) sum += lrBandStep[0][s2];
            if (activeMask & 2) sum += lrBandStep[1][s2];
            if (activeMask & 4) sum += lrBandStep[2][s2];
            if (activeMask & 8) sum += lrBandStep[3][s2];
            lrSumStep[s2] = sum;
        }
    }
}

function drawSpectrogramAndCurves(activeMask, xoverCount) {
    ensureLrDisplayCache(activeMask);
    var plotBottom = PLOT_Y + PLOT_H - 2;
    var innerW = PLOT_W - 2;
    var span = PLOT_H - 10;
    var scaleCol = sptColor("live_display_scale_text");

    // 4A. Waterfall history (8192-point FFT rows), very faint muted cells
    var numRows = specColHistory.length;
    var rowH = (PLOT_H - 4) / MAX_WATERFALL_ROWS;
    var colW = innerW / SPEC_COLS;
    for (var r = 0; r < numRows; r++) {
        var wfRow = specColHistory[r];
        var ry = PLOT_Y + 2 + r * rowH;
        var ageFade = 1.0 - (r / MAX_WATERFALL_ROWS) * 0.65;
        for (var c = 0; c < SPEC_COLS; c++) {
            var intensity = clamp((wfRow[c] + 54.0) / 52.0, 0.0, 1.0);
            if (intensity <= 0.08) continue;
            var bOwner = ownerBandForFreq(specColFreqs[c]);
            var isBandOn = ((activeMask & (1 << bOwner)) !== 0);
            var alpha = Math.pow(intensity, 1.65) * ageFade * (isBandOn ? 0.20 : 0.05);
            if (alpha < 0.012) continue;
            sptRgba(bandColor(bOwner), alpha);
            mgraphics.rectangle(PLOT_X + 1 + c * colW, ry, Math.max(1.15, colW + 0.25), rowH + 0.35);
            mgraphics.fill();
        }
    }

    // 4B. Unfiltered input spectrum: faint fill + 1 px grey trace
    var inY = function (i) { return plotBottom - clamp((specColDb[i] + 56.0) / 54.0, 0.0, 1.0) * span; };
    sptRgba(scaleCol, 0.10);
    mgraphics.move_to(PLOT_X + 1, plotBottom);
    for (var cAll = 0; cAll < SPEC_COLS; cAll++) mgraphics.line_to(PLOT_X + 1 + (cAll / (SPEC_COLS - 1)) * innerW, inY(cAll));
    mgraphics.line_to(PLOT_X + PLOT_W - 1, plotBottom);
    mgraphics.close_path();
    mgraphics.fill();
    mgraphics.set_line_width(1);
    sptRgba(scaleCol, 0.55);
    mbBandPath(function (i) { return inY(i); });
    mgraphics.stroke();

    // 4C. Active band(s): faint fill under the post-crossover spectrum and a 1 px crest line
    for (var bBand = 0; bBand < curNumBands; bBand++) {
        if ((activeMask & (1 << bBand)) === 0) continue;
        var sCol = bandColor(bBand);
        var ys = [];
        var bandCol = lrBandCol[bBand];
        for (var i = 0; i < SPEC_COLS; i++) {
            var effDb = specColDb[i] + linToDb(Math.max(bandCol[i], 1e-4));
            ys.push(plotBottom - clamp((effDb + 56.0) / 54.0, 0.0, 1.0) * span);
        }
        sptRgba(sCol, 0.26);
        mgraphics.move_to(PLOT_X + 1, plotBottom);
        for (var j = 0; j < SPEC_COLS; j++) mgraphics.line_to(PLOT_X + 1 + (j / (SPEC_COLS - 1)) * innerW, ys[j]);
        mgraphics.line_to(PLOT_X + PLOT_W - 1, plotBottom);
        mgraphics.close_path();
        mgraphics.fill();
        mgraphics.set_line_width(1);
        sptRgba(sptMuted(sCol, 0.95));
        mbBandPath(function (k) { return ys[k]; });
        mgraphics.stroke();
    }

    // 4D. Peak-hold trace (thin, faint)
    mgraphics.set_line_width(1);
    sptRgba(sptColor("live_lcd_title"), 0.30);
    mbBandPath(function (i) { return plotBottom - clamp((specColPeaks[i] + 56.0) / 54.0, 0.0, 1.0) * span; });
    mgraphics.stroke();

    // 5. Linkwitz-Riley transfer curves (inactive first, active on top), 1 px
    var numSteps = 96;
    for (var pass = 0; pass < 2; pass++) {
        for (var bIdx = 0; bIdx < curNumBands; bIdx++) {
            var isBandActive = ((activeMask & (1 << bIdx)) !== 0);
            if ((pass === 0 && isBandActive) || (pass === 1 && !isBandActive)) continue;
            var bCol2 = bandColor(bIdx);
            sptRgba(isBandActive ? sptMuted(bCol2, 0.95) : sptMuted(bCol2, 0.55), isBandActive ? 1.0 : 0.7);
            mgraphics.set_line_width(1);
            var bandStep = lrBandStep[bIdx];
            for (var s2 = 0; s2 <= numSteps; s2++) {
                var px2 = PLOT_X + (s2 / numSteps) * PLOT_W;
                var py2 = magToY(bandStep[s2]);
                if (s2 === 0) mgraphics.move_to(px2, py2);
                else mgraphics.line_to(px2, py2);
            }
            mgraphics.stroke();
        }
    }

    // Composite sum curve when several bands pass (Custom mask)
    var enabledCount = ((activeMask & 1) ? 1 : 0) + ((activeMask & 2) ? 1 : 0) + ((activeMask & 4) ? 1 : 0) + ((activeMask & 8) ? 1 : 0);
    if (enabledCount > 1) {
        mgraphics.set_line_width(1);
        sptRgba(sptColor("live_control_fg"), 0.9);
        for (var sc = 0; sc <= numSteps; sc++) {
            var pxc = PLOT_X + (sc / numSteps) * PLOT_W;
            var pyc = magToY(lrSumStep[sc]);
            if (sc === 0) mgraphics.move_to(pxc, pyc);
            else mgraphics.line_to(pxc, pyc);
        }
        mgraphics.stroke();
    }

    // 6. Crossover lines (1 px grey) with small hollow orange numbered handles and plain frequency labels
    var orange = sptColor("live_display_handle_one");
    var labelRects = [];
    var nodeY = magToY(0.5);
    // Handle circles sit on their crossover line but stay fully inside the canvas; crossovers near a range end are nudged inward and
    // kept 10 px apart so neighbouring handles (and their digits) never overlap.
    var handleXs = [];
    var hMin = PLOT_X + 5.5;
    var hMax = PLOT_X + PLOT_W - 5.5;
    for (var hq = 0; hq < xoverCount; hq++) {
        var hxq = clamp(Math.round(freqToX(getCrossoverFreq(hq))) + 0.5, hMin, hMax);
        handleXs.push(hq > 0 ? Math.max(hxq, handleXs[hq - 1] + 10) : hxq);
    }
    for (var hb = xoverCount - 1; hb >= 0; hb--) {
        if (handleXs[hb] > hMax - (xoverCount - 1 - hb) * 10) handleXs[hb] = hMax - (xoverCount - 1 - hb) * 10;
    }
    for (var cIdx = 0; cIdx < xoverCount; cIdx++) {
        var fc = getCrossoverFreq(cIdx);
        // the line stays inside the plot (a crossover at 20 kHz would sit on the right edge); the handle circle stays fully inside too
        var hx = clamp(Math.round(freqToX(fc)) + 0.5, PLOT_X + 0.5, PLOT_X + PLOT_W - 0.5);
        var handleX = handleXs[cIdx];
        var isActiveDrag = (dragHandleIdx === cIdx);
        var isHover = (hoverHandleIdx === cIdx);
        mgraphics.set_line_width(1);
        sptRgba(isActiveDrag ? orange : sptColor("live_lcd_title"), isActiveDrag ? 0.9 : (isHover ? 0.8 : 0.5));
        mgraphics.move_to(hx, PLOT_Y + 1);
        mgraphics.line_to(hx, PLOT_Y + PLOT_H - 1);
        mgraphics.stroke();

        // -6.02 dB Linkwitz-Riley crossover point
        sptHandle(handleX, nodeY, isActiveDrag || isHover ? sptMix(orange, [1, 1, 1, 1], 0.3) : orange, cIdx + 1, 4.5);

        var fText = formatFreq(fc);
        var tw = sptTextW(fText, SPT_SIZE_SMALL);
        var tx = clamp(hx + 4, PLOT_X + 2, PLOT_X + PLOT_W - tw - 2);
        if (hx + 4 + tw > PLOT_X + PLOT_W - 2) tx = clamp(hx - 4 - tw, PLOT_X + 2, PLOT_X + PLOT_W - tw - 2);
        // frequency labels take the first row (10 px apart) where they do not touch an earlier label
        var rowY = PLOT_Y + 10;
        for (var row = 0; row < 5; row++) {
            rowY = PLOT_Y + 10 + row * 10;
            var clash = false;
            for (var lq = 0; lq < labelRects.length; lq++) {
                if (labelRects[lq][1] === rowY && tx < labelRects[lq][2] + 3 && tx + tw > labelRects[lq][0] - 3) clash = true;
            }
            // ... nor sits on any handle circle (and its digit)
            for (var hq2 = 0; hq2 < xoverCount; hq2++) {
                if (tx < handleXs[hq2] + 6 && tx + tw > handleXs[hq2] - 6 && rowY - 7 < nodeY + 6 && rowY + 2 > nodeY - 6) clash = true;
            }
            if (!clash) break;
        }
        labelRects.push([tx, rowY, tx + tw]);
        sptText(fText, tx, rowY, sptColor("live_lcd_control_fg_alt"), SPT_SIZE_SMALL, 0);
    }
}

function mbControl(r, text, on, hot, dotCol, meter) {
    var bg = sptColor("live_control_bg");
    sptRgba(on ? sptColor("live_control_selection") : (hot ? sptMix(bg, sptColor("live_control_fg"), 0.12) : bg));
    mgraphics.rectangle(r[0], r[1], r[2], r[3]);
    mgraphics.fill();
    if (meter && meter > 0.01) {
        sptRgba(dotCol, on ? 0.9 : 0.6);
        mgraphics.rectangle(r[0] + 1, r[1] + r[3] - 2, Math.max(1, (r[2] - 2) * Math.pow(meter, 0.65)), 1);
        mgraphics.fill();
    }
    var tc = on ? sptColor("live_lcd_bg") : sptColor("live_control_fg");
    sptText(text, r[0] + r[2] * 0.5, r[1] + r[3] - 3.5, tc, SPT_SIZE_SMALL, 1);
}

function drawTopVolumeSlider() {
    var vr = getVolumeSliderRect();
    var norm = gainDbToSliderNorm(curGainDb);
    var zeroNorm = gainDbToSliderNorm(0.0);
    var bg = sptColor("live_control_bg");
    sptRgba(bg);
    mgraphics.rectangle(vr[0], vr[1], vr[2], vr[3]);
    mgraphics.fill();
    var fillW = Math.max(0.0, (vr[2] - 2) * norm);
    if (fillW > 0.5) {
        sptRgba(sptMix(bg, sptColor("live_control_fg"), (dragVolume || hoverVolSlider) ? 0.32 : 0.24));
        mgraphics.rectangle(vr[0] + 1, vr[1] + 1, fillW, vr[3] - 2);
        mgraphics.fill();
    }
    var zeroX = Math.round(vr[0] + 1 + (vr[2] - 2) * zeroNorm) + 0.5;
    mgraphics.set_line_width(1);
    sptRgba(sptColor("live_display_scale_text"), 0.8);
    mgraphics.move_to(zeroX, vr[1] + 2);
    mgraphics.line_to(zeroX, vr[1] + vr[3] - 2);
    mgraphics.stroke();
    sptText(formatGainDb(curGainDb), vr[0] + vr[2] * 0.5, vr[1] + vr[3] - 3.5, sptColor("live_lcd_control_fg_alt"), SPT_SIZE_SMALL, 1);
}

function drawBottomRightLinkBadge() {
    var lr = getLinkBadgeRect();
    var isLinked = (curLinkGroup !== 5);

    sptRgba(sptColor("live_lcd_bg"), 0.85);
    mgraphics.rectangle(lr[0], lr[1], lr[2], lr[3]);
    mgraphics.fill();
    var dspShown = !mbDsp.ready;
    sptRgba(dspShown ? (mbDsp.error ? sptColor("live_alert") : sptColor("live_control_selection")) :
        (isLinked ? sptColor("live_control_selection") : sptColor("live_display_scale_text")), hoverLinkBadge ? 1.0 : 0.85);
    mgraphics.arc(lr[0] + 5, lr[1] + lr[3] * 0.5, 1.8, 0, Math.PI * 2);
    mgraphics.fill();
    sptText(linkBadgeText(), lr[0] + 10, lr[1] + lr[3] - 3,
        dspShown ? (mbDsp.error ? sptColor("live_alert") : sptColor("live_control_selection")) :
            (hoverLinkBadge ? sptColor("live_control_fg") : sptColor("live_display_scale_text")), SPT_SIZE_SMALL, 0);
}

function paint() {
    var size = mgraphics.size;
    var w = size[0] || 252;
    var h = size[1] || 102;
    updatePlotBounds();

    var activeMask = getEffectiveMask();
    var bandNames = getBandNames(curNumBands);
    var xoverCount = getActiveCrossoverCount();

    // Canvas background = the recessed section colour; the top strip sits on it, the LCD below
    sptRgba(sptColor("live_desktop"));
    mgraphics.rectangle(0, 0, w, h);
    mgraphics.fill();

    // Top strip: Auto + band pills + volume
    mbControl(getAutoBtnRect(), "Auto", curBandMode === 0, hoverAutoBtn, null, 0);
    for (var b = 0; b < curNumBands; b++) {
        var pr = getBandPillRect(b);
        var isOn = ((activeMask & (1 << b)) !== 0);
        var compactNames4 = ["Low", "Lo-M", "Hi-M", "High"];
        var bLabel = (curNumBands === 4) ? compactNames4[b] : ((b + 1) + ":" + titleCase(bandNames[b]));
        mbControl(pr, bLabel, isOn, false, bandColor(b), clamp(bandPeaks[b] || 0.0, 0.0, 1.0));
    }
    drawTopVolumeSlider();

    // LCD with faint log-frequency / dB grid
    var xs = [];
    var gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (var gf = 0; gf < gridFreqs.length; gf++) xs.push(freqToX(gridFreqs[gf]));
    var ys = [];
    var gridDbs = [0, -6, -18, -30];
    for (var gd = 0; gd < gridDbs.length; gd++) ys.push(magToY(dbToLin(gridDbs[gd])));
    sptLcd(PLOT_X, PLOT_Y, PLOT_W, PLOT_H, { xs: xs, ys: ys });

    drawSpectrogramAndCurves(activeMask, xoverCount);
    drawBottomRightLinkBadge();

    // axis labels (small, grey)
    var badge = getLinkBadgeRect();
    var axCol = sptColor("live_display_scale_text");
    var axisF = [[100, "100"], [1000, "1k"], [10000, "10k"]];
    for (var af = 0; af < axisF.length; af++) {
        var axX = freqToX(axisF[af][0]) + 2;
        if (axX + sptTextW(axisF[af][1], SPT_SIZE_SMALL) > badge[0] - 2 && axX < badge[0] + badge[2]) continue;
        sptText(axisF[af][1], axX, PLOT_Y + PLOT_H - 4, axCol, SPT_SIZE_SMALL, 0);
    }


    sptRgba(sptColor("live_lcd_frame"));
    mgraphics.set_line_width(1);
    mgraphics.rectangle(PLOT_X + 0.5, PLOT_Y + 0.5, PLOT_W - 1, PLOT_H - 1);
    mgraphics.stroke();
}

function titleCase(str) {
    var t = String(str).toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
}
