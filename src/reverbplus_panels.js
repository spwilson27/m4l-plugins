// Reverb+ (Start) engine: panel colours. A layout lists its background panels in "panel_theme"
// ([[box id, Live theme colour name, fallback rgba], ...], injected as RP_PANEL_THEME); this applies them
// from max.getcolor on load and whenever the theme changes (attribute bindings on panels did not repaint
// them in Live, same as Delay+). Appended to the engine script after reverbplus_engine.js.

var rpPatcher = (typeof this !== "undefined" && this && this.patcher) ? this.patcher : null;

function rpApplyPanelTheme() {
    if (!rpPatcher) return;
    var report = {};
    for (var i = 0; i < RP_PANEL_THEME.length; i++) {
        var e = RP_PANEL_THEME[i];
        var c = rpTheme(e[1], e[2]);
        try {
            var o = rpPatcher.getnamed(e[0]);
            if (!o) continue;
            o.setattr("bgfillcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bgcolor", c[0], c[1], c[2], c[3]);
            o.setattr("bordercolor", c[0], c[1], c[2], c[3]);
            report[e[0]] = c.map(function (v) { return Math.round(v * 255); }).join(",");
        } catch (err) {
            report[e[0]] = "err " + err;
        }
    }
    new Global("reverbplus_diag").panels = JSON.stringify(report); // read via the MCP bridge
}
rpOnThemeChange = rpApplyPanelTheme;
var rpThemeTask = rpThemeWatch();

// Parameters that do not apply to the chosen algorithm are greyed (`active 0` on their live.* object, whatever the
// layout): RP_INACTIVE in reverbplus_config.js. Called on load and when Algorithm changes.
function rpApplyActive() {
    if (!rpPatcher || typeof rpRaw === "undefined") return;
    var algo = rpIndex(rpRaw.algo === undefined ? 1 : rpRaw.algo, RP_ALGOS.length);
    var off = RP_INACTIVE[algo];
    for (var key in RP_VARNAMES) {
        try {
            var o = rpPatcher.getnamed(RP_VARNAMES[key]);
            if (o) o.setattr("active", off.indexOf(key) < 0 ? 1 : 0);
        } catch (err) {}
    }
}
