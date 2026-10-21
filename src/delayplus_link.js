// Delay+ link layer, shared by the Start and End v8ui scripts (prepended after
// src/delayplus_config.js; the including script defines DP_ROLE = "start" | "end").
//
// Every instance registers itself in Global("delayplus_bus").reg[<LOM device id>] =
// { role, xfer, hdr, t } and refreshes `t` from a 500 ms Task on its own thread. Pairing is
// bracket matching over the device list of the instance's own chain (dpFindPartner), using the
// registry to tell Delay+ devices apart from everything else, so nested pairs and renamed devices
// work. All LiveAPI calls happen on the instance's own Task (never in a cross-instance callback),
// because "this_device" resolves to the caller's patcher there.
//
// Start: sums latency_in_samples of the devices between it and its End -> `lat <L>` to gen.
//        Observes live_set tempo for tempo-sync.
// End:   binds its gen Buffers to its Start's buffer~ names (`xfer <name>`, `hdr <name>`) or
//        back to its own empty buffers when it has no Start.

var dpSelfApi = null;
var dpProbeApi = null;
var dpChainApi = null;
var dpTempoApi = null;
var dpTask = null;
var dpSelfId = 0;
var dpOwnNames = { xfer: "", hdr: "", scope: "", spec: "" };
var dpLink = {
    paired: false,
    partnerId: 0,
    partnerIndex: -1,
    selfIndex: -1,
    latency: 0,
    latencies: [],
    chainNames: [],
    chainIds: [],
    boundTo: "",
    bpm: 120,
    status: "init",
};
var dpPolls = 0;
var dpOnChange = null; // set by the UI script: called when pairing / latency / tempo changes

function dpBus() {
    var g = new Global(DP_BUS_NAME);
    if (!g.reg) g.reg = {};
    return g;
}

function dpRegister() {
    if (!dpSelfId) return;
    var g = dpBus();
    g.reg[dpSelfId] = {
        role: DP_ROLE, xfer: dpOwnNames.xfer, hdr: dpOwnNames.hdr, t: Date.now(),
        // diagnostics for scripts/test_delayplus_live.js (read through the MCP bridge)
        polls: dpPolls, sentLat: dpLink.latency, lats: dpLink.latencies.slice(), status: dpLink.status,
        build: typeof DP_BUILD !== "undefined" ? DP_BUILD : "",
    };
}

// From loadbang: `names <xfer> <hdr> <scope> [<spec>]` (this instance's own buffer~ names).
function names(xferName, hdrName, scopeName, specName) {
    dpOwnNames.xfer = String(xferName);
    dpOwnNames.spec = specName === undefined ? "" : String(specName);
    dpOwnNames.hdr = String(hdrName);
    dpOwnNames.scope = String(scopeName);
    if (typeof dpScopeBind === "function") dpScopeBind(dpOwnNames.scope);
    dpRegister();
}

// From live.thisdevice (the LOM is ready).
// True once live.thisdevice has fired (init_link): the Set's saved parameter values have all arrived.
var dpLoaded = false;

function init_link() {
    dpLoaded = true;
    // Start: create the gen~ now that the face is up (src/delayplus_dsp.js)
    if (typeof dpDspSchedule === "function") dpDspSchedule();
    try {
        dpSelfApi = new LiveAPI(function () {}, "this_device");
        dpSelfId = Number(dpSelfApi.id);
        dpProbeApi = new LiveAPI(function () {}, "live_set");
        if (DP_ROLE === "start") {
            dpTempoApi = new LiveAPI(function (args) {
                if (args && args[0] === "tempo") {
                    dpLink.bpm = Number(args[1]) || dpLink.bpm;
                    if (dpOnChange) dpOnChange("tempo");
                }
            }, "live_set");
            dpTempoApi.property = "tempo";
            dpLink.bpm = Number(dpTempoApi.get("tempo")) || 120;
        }
    } catch (err) {
        dpLink.status = "no LOM";
        return;
    }
    dpRegister();
    if (typeof dpApplyPanelTheme === "function") dpApplyPanelTheme();
    if (typeof dpInitMidiRouting === "function") dpInitMidiRouting();
    if (!dpTask) {
        dpTask = new Task(dpPoll, this);
        dpTask.interval = 500;
    }
    dpTask.repeat();
    dpPoll();
}

// Values for the Start gen go straight into its header buffer: a message sent from this Task's
// thread was seen to stop reaching gen in Live (the first one, from init, arrived).
var dpHdrBuf = null;
function dpHdrPoke(index, value) {
    if (!dpOwnNames.hdr) return;
    try {
        if (!dpHdrBuf) dpHdrBuf = new Buffer(dpOwnNames.hdr);
        dpHdrBuf.poke(1, index, value);
    } catch (err) {
        dpHdrBuf = null;
    }
}

function dpGetNum(api, prop) {
    var v = api.get(prop);
    return Number(Array.isArray(v) ? v[0] : v) || 0;
}

// Latency tree of one device for dpDeviceLatency: its own latency_in_samples plus, for a rack,
// every chain's devices (racks inside racks too, up to 6 levels).
function dpLatencyNode(path, depth) {
    var api = new LiveAPI(function () {}, path);
    var node = { lat: dpGetNum(api, "latency_in_samples"), chains: [] };
    if (depth < 6 && dpGetNum(api, "can_have_chains") > 0.5) {
        var nc = api.getcount("chains");
        for (var c = 0; c < nc; c++) {
            var chain = [];
            var cp = path + " chains " + c;
            var nd = new LiveAPI(function () {}, cp).getcount("devices");
            for (var d = 0; d < nd; d++) chain.push(dpLatencyNode(cp + " devices " + d, depth + 1));
            node.chains.push(chain);
        }
    }
    return node;
}

function dpPoll() {
    if (!dpSelfApi) return;
    dpPolls++;
    dpRegister();
    var now = Date.now();
    var parsed = dpParseDevicePath(dpSelfApi.unquotedpath);
    if (!parsed) {
        dpSetUnpaired("no chain");
        return;
    }
    if (!dpChainApi) dpChainApi = new LiveAPI(function () {}, parsed.parent);
    else if (dpChainApi.unquotedpath !== parsed.parent) dpChainApi.path = parsed.parent;
    var ids = dpExtractIds(dpChainApi.get("devices"));
    var reg = dpBus().reg;
    var roles = [];
    for (var i = 0; i < ids.length; i++) roles.push(dpRoleOf(reg, ids[i], now));
    // Our own entry is always live, even if the id list is a poll behind.
    var selfIndex = ids.indexOf(dpSelfId);
    if (selfIndex < 0) selfIndex = parsed.index;
    roles[selfIndex] = DP_ROLE;
    var partner = dpFindPartner(roles, selfIndex);
    dpLink.selfIndex = selfIndex;
    dpLink.chainIds = ids;
    if (partner < 0) {
        dpSetUnpaired(DP_ROLE === "start" ? "no End" : "no Start");
        return;
    }
    var lats = [];
    var namesList = [];
    var lo = Math.min(selfIndex, partner);
    var hi = Math.max(selfIndex, partner);
    for (var k = 0; k < ids.length; k++) {
        if (k > lo && k < hi) {
            dpProbeApi.id = ids[k];
            // a rack between the pair counts as its longest chain (Live reports 0 for the rack)
            lats.push(dpDeviceLatency(dpLatencyNode(String(dpProbeApi.unquotedpath), 0)));
            namesList.push(String(dpProbeApi.get("name")));
        } else {
            lats.push(0);
            namesList.push(k === selfIndex ? DP_ROLE : (k === partner ? (DP_ROLE === "start" ? "end" : "start") : ""));
        }
    }
    var latency = dpChainLatency(lats, selfIndex, partner);
    var changed = !dpLink.paired || dpLink.partnerId !== ids[partner] || dpLink.latency !== latency
        || dpLink.chainNames.join("|") !== namesList.join("|");
    dpLink.paired = true;
    dpLink.partnerId = ids[partner];
    dpLink.partnerIndex = partner;
    dpLink.latency = latency;
    dpLink.latencies = lats;
    dpLink.chainNames = namesList;
    dpLink.status = "linked";
    if (DP_ROLE === "start") {
        dpHdrPoke(30, latency);
        if (typeof dpPokeTimes === "function") dpPokeTimes();
    } else {
        var entry = reg[ids[partner]];
        var key = entry.xfer + "|" + entry.hdr;
        if (dpLink.boundTo !== key && entry.xfer && entry.hdr) {
            outlet(0, "xfer", entry.xfer);
            outlet(0, "hdr", entry.hdr);
            dpLink.boundTo = key;
            changed = true;
        }
    }
    if (changed && dpOnChange) dpOnChange("link");
}

function dpSetUnpaired(status) {
    var changed = dpLink.paired || dpLink.status !== status;
    dpLink.paired = false;
    dpLink.partnerId = 0;
    dpLink.partnerIndex = -1;
    dpLink.latency = 0;
    dpLink.latencies = [];
    dpLink.chainNames = [];
    dpLink.status = status;
    if (DP_ROLE === "start") {
        dpHdrPoke(30, 0);
    } else if (dpLink.boundTo !== "own" && dpOwnNames.xfer) {
        outlet(0, "xfer", dpOwnNames.xfer);
        outlet(0, "hdr", dpOwnNames.hdr);
        dpLink.boundTo = "own";
    }
    if (changed && dpOnChange) dpOnChange("link");
}

function notifydeleted() {
    if (dpTask) dpTask.cancel();
    if (dpSelfId) {
        var g = dpBus();
        delete g.reg[dpSelfId];
    }
}
