// Spectral Sum Probe face (v8ui, not visible): registers in Global("ssp_bus") and forwards `hold` (freeze now) and `stopat` (freeze when the probe's own sample counter reaches it) from the bus to the gen.
inlets = 1;
outlets = 1;
var uid = "s" + Math.floor(Math.random() * 1e9).toString(36);
var names = { cap: "", info: "" };
var devPath = "";
var task = null;
function setnames(cap, info) {
    names.cap = String(cap);
    names.info = String(info);
    reg();
    if (!task) {
        task = new Task(tick, this);
        task.interval = 40;
        task.repeat();
    }
}
function init_path() {
    try {
        var api = new LiveAPI(function () {}, "this_device");
        devPath = String(api.unquotedpath || api.path || "");
    } catch (e) {}
    reg();
}
function reg() {
    var g = new Global("ssp_bus");
    if (!g.inst) g.inst = {};
    g.inst[uid] = { cap: names.cap, info: names.info, path: devPath, t: Date.now() };
}
var lastReg = 0;
function tick() {
    var now = Date.now();
    if (now - lastReg > 500) { lastReg = now; reg(); }
    var g = new Global("ssp_bus");
    outlet(0, "frz", g.hold ? 1 : 0);
    outlet(0, "stopat", (g.stopat === undefined || g.stopat === null) ? -1 : Number(g.stopat));
}
