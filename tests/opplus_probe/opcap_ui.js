// Capture probe for the Operator+ A/B test (NOT a product). Records its input into its own buffer when the global
// receive opcap_rec gets 1, and publishes {track name: expanded buffer name} in Global("opcap") so the bridge can read it.
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
var capName = "";
function setnames(n) {
    capName = String(n);
}
function init_path() {
    try {
        var dev = new LiveAPI(null, "this_device");
        var tr = new LiveAPI(null, dev.path.replace(/ devices \d+$/, "").replace(/"/g, ""));
        var g = new Global("opcap");
        if (!g.map) g.map = {};
        var nm = String(tr.get("name"));
        g.map[nm] = capName;
        g.names = JSON.stringify(g.map);
    } catch (e) {
        post("opcap: " + e + "\n");
    }
}
function paint() {
    mgraphics.set_source_rgba(0.2, 0.2, 0.2, 1);
    mgraphics.rectangle(0, 0, 40, 20);
    mgraphics.fill();
}
