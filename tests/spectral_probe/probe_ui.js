// Spectral Probe face (v8ui, not visible): registers this instance in Global("probe_bus") and forwards the shared-buffer name, id and
// chain count from the bus to the gen. Messages in: names <sh> <own>, init_path (live.thisdevice).
inlets = 1;
outlets = 1;
var uid = "p" + Math.floor(Math.random() * 1e9).toString(36);
var names = { sh: "", own: "" };
var devPath = "";
var task = null;
function names_(a, b) {}
function setnames(sh, own) {
    names.sh = String(sh);
    names.own = String(own);
    reg();
    if (!task) {
        task = new Task(tick, this);
        task.interval = 250;
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
    var g = new Global("probe_bus");
    if (!g.inst) g.inst = {};
    g.inst[uid] = { sh: names.sh, own: names.own, path: devPath, t: Date.now() };
}
function tick() {
    reg();
    var g = new Global("probe_bus");
    outlet(0, "res", names.own);
    var c = g.cfg && g.cfg[uid];
    if (c) {
        if (c.sh) outlet(0, "sh", String(c.sh));
        outlet(0, "id", c.id);
        outlet(0, "kn", c.k);
    }
}
