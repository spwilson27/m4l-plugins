// Reverb+ link layer, shared by the Start engine and the End face (prepended after
// src/reverbplus_config.js; the including script defines RP_ROLE = "start" | "end").
//
// Every instance registers itself in Global("reverbplus_bus").reg[<LOM device id>] =
// { role, xfer, hdr, t } and refreshes `t` from a 500 ms Task on its own thread. Pairing is
// bracket matching over the device list of the instance's own chain (rpFindPartner), using the
// registry to tell Reverb+ devices apart from everything else, so nested pairs and renamed devices
// work. All LiveAPI calls happen on the instance's own Task (never in a cross-instance callback),
// because "this_device" resolves to the caller's patcher there.
//
// Start: sums latency_in_samples of the devices between it and its End -> hdr[30] (L) of the gen.
// End:   binds its gen Buffers to its Start's buffer~ names (`xfer <name>`, `hdr <name>`) or
//        back to its own empty buffers when it has no Start.

var rpSelfApi = null;
var rpProbeApi = null;
var rpChainApi = null;
var rpTask = null;
var rpSelfId = 0;
var rpOwnNames = { xfer: "", hdr: "", scope: "", spec: "", ir: "", irspec: "", irview: "" };
var rpLink = {
    paired: false,
    partnerId: 0,
    partnerIndex: -1,
    selfIndex: -1,
    latency: 0,
    latencies: [],
    chainNames: [],
    chainIds: [],
    boundTo: "",
    status: "init",
};
var rpPolls = 0;
var rpOnChange = null; // set by the UI script: called when pairing / latency / tempo changes

function rpBus() {
    var g = new Global(RP_BUS_NAME);
    if (!g.reg) g.reg = {};
    return g;
}

function rpRegister() {
    if (!rpSelfId) return;
    var g = rpBus();
    g.reg[rpSelfId] = {
        role: RP_ROLE, xfer: rpOwnNames.xfer, hdr: rpOwnNames.hdr, scope: rpOwnNames.scope, t: Date.now(),
        // diagnostics for scripts/test_reverbplus_live.js (read through the MCP bridge)
        polls: rpPolls, sentLat: rpLink.latency, lats: rpLink.latencies.slice(), status: rpLink.status,
        build: typeof RP_BUILD !== "undefined" ? RP_BUILD : "",
    };
}

// From loadbang: `names <xfer> <hdr> <scope> [<spec> <ir> <irspec> <irview>]` (this instance's own buffer~ names).
function names(xferName, hdrName, scopeName, specName, irName, irSpecName, irViewName) {
    rpOwnNames.xfer = String(xferName);
    rpOwnNames.hdr = String(hdrName);
    rpOwnNames.scope = String(scopeName);
    rpOwnNames.spec = specName === undefined ? "" : String(specName);
    rpOwnNames.ir = irName === undefined ? "" : String(irName);
    rpOwnNames.irspec = irSpecName === undefined ? "" : String(irSpecName);
    rpOwnNames.irview = irViewName === undefined ? "" : String(irViewName);
    if (typeof rpScopeBind === "function") rpScopeBind(rpOwnNames.scope);
    rpRegister();
}

// From live.thisdevice (the LOM is ready).
// True once live.thisdevice has fired (init_link): the Set's saved parameter values have all arrived.
var rpLoaded = false;

function init_link() {
    rpLoaded = true;
    // Start: create the gen~ now that the face is up (src/delayplus_dsp.js)
    if (typeof rpDspSchedule === "function") rpDspSchedule();
    try {
        rpSelfApi = new LiveAPI(function () {}, "this_device");
        rpSelfId = Number(rpSelfApi.id);
        rpProbeApi = new LiveAPI(function () {}, "live_set");
    } catch (err) {
        rpLink.status = "no LOM";
        return;
    }
    rpRegister();
    if (!rpTask) {
        rpTask = new Task(rpPoll, this);
        rpTask.interval = 500;
    }
    rpTask.repeat();
    rpPoll();
    if (typeof rpOnInit === "function") rpOnInit();
}

// Values for the Start gen go straight into its header buffer: a message sent from this Task's
// thread was seen to stop reaching gen in Live (the first one, from init, arrived).
var rpHdrBuf = null;
function rpHdrPoke(index, value) {
    if (!rpOwnNames.hdr) return;
    try {
        if (!rpHdrBuf) rpHdrBuf = new Buffer(rpOwnNames.hdr);
        rpHdrBuf.poke(1, index, value);
    } catch (err) {
        rpHdrBuf = null;
    }
}

function rpGetNum(api, prop) {
    var v = api.get(prop);
    return Number(Array.isArray(v) ? v[0] : v) || 0;
}

// Latency tree of one device for rpDeviceLatency: its own latency_in_samples plus, for a rack,
// every chain's devices (racks inside racks too, up to 6 levels).
function rpLatencyNode(path, depth) {
    var api = new LiveAPI(function () {}, path);
    var node = { lat: rpGetNum(api, "latency_in_samples"), chains: [] };
    if (depth < 6 && rpGetNum(api, "can_have_chains") > 0.5) {
        var nc = api.getcount("chains");
        for (var c = 0; c < nc; c++) {
            var chain = [];
            var cp = path + " chains " + c;
            var nd = new LiveAPI(function () {}, cp).getcount("devices");
            for (var d = 0; d < nd; d++) chain.push(rpLatencyNode(cp + " devices " + d, depth + 1));
            node.chains.push(chain);
        }
    }
    return node;
}

function rpPoll() {
    if (!rpSelfApi) return;
    rpPolls++;
    rpRegister();
    var now = Date.now();
    var parsed = rpParseDevicePath(rpSelfApi.unquotedpath);
    if (!parsed) {
        rpSetUnpaired("no chain");
        return;
    }
    if (!rpChainApi) rpChainApi = new LiveAPI(function () {}, parsed.parent);
    else if (rpChainApi.unquotedpath !== parsed.parent) rpChainApi.path = parsed.parent;
    var ids = rpExtractIds(rpChainApi.get("devices"));
    var reg = rpBus().reg;
    var roles = [];
    for (var i = 0; i < ids.length; i++) roles.push(rpRoleOf(reg, ids[i], now));
    // Our own entry is always live, even if the id list is a poll behind.
    var selfIndex = ids.indexOf(rpSelfId);
    if (selfIndex < 0) selfIndex = parsed.index;
    roles[selfIndex] = RP_ROLE;
    var partner = rpFindPartner(roles, selfIndex);
    rpLink.selfIndex = selfIndex;
    rpLink.chainIds = ids;
    if (partner < 0) {
        rpSetUnpaired(RP_ROLE === "start" ? "no End" : "no Start");
        return;
    }
    var lats = [];
    var namesList = [];
    var lo = Math.min(selfIndex, partner);
    var hi = Math.max(selfIndex, partner);
    for (var k = 0; k < ids.length; k++) {
        if (k > lo && k < hi) {
            rpProbeApi.id = ids[k];
            // a rack between the pair counts as its longest chain (Live reports 0 for the rack)
            lats.push(rpDeviceLatency(rpLatencyNode(String(rpProbeApi.unquotedpath), 0)));
            namesList.push(String(rpProbeApi.get("name")));
        } else {
            lats.push(0);
            namesList.push(k === selfIndex ? RP_ROLE : (k === partner ? (RP_ROLE === "start" ? "end" : "start") : ""));
        }
    }
    var latency = rpChainLatency(lats, selfIndex, partner);
    var changed = !rpLink.paired || rpLink.partnerId !== ids[partner] || rpLink.latency !== latency
        || rpLink.chainNames.join("|") !== namesList.join("|");
    rpLink.paired = true;
    rpLink.partnerId = ids[partner];
    rpLink.partnerIndex = partner;
    rpLink.latency = latency;
    rpLink.latencies = lats;
    rpLink.chainNames = namesList;
    rpLink.status = "linked";
    if (RP_ROLE === "start") {
        rpHdrPoke(30, latency);
    } else {
        var entry = reg[ids[partner]];
        var key = entry.xfer + "|" + entry.hdr;
        if (rpLink.boundTo !== key && entry.xfer && entry.hdr) {
            outlet(0, "xfer", entry.xfer);
            outlet(0, "hdr", entry.hdr);
            rpLink.boundTo = key;
            changed = true;
        }
    }
    if (changed && rpOnChange) rpOnChange("link");
}

function rpSetUnpaired(status) {
    var changed = rpLink.paired || rpLink.status !== status;
    rpLink.paired = false;
    rpLink.partnerId = 0;
    rpLink.partnerIndex = -1;
    rpLink.latency = 0;
    rpLink.latencies = [];
    rpLink.chainNames = [];
    rpLink.status = status;
    if (RP_ROLE === "start") {
        rpHdrPoke(30, 0);
    } else if (rpLink.boundTo !== "own" && rpOwnNames.xfer) {
        outlet(0, "xfer", rpOwnNames.xfer);
        outlet(0, "hdr", rpOwnNames.hdr);
        rpLink.boundTo = "own";
    }
    if (changed && rpOnChange) rpOnChange("link");
}

function notifydeleted() {
    if (rpTask) rpTask.cancel();
    if (rpSelfId) {
        var g = rpBus();
        delete g.reg[rpSelfId];
    }
}
