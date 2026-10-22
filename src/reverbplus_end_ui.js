// Reverb+ End face: link status, the chain latency in use (from Live's LOM) and the wet /
// duck meters. Build order: reverbplus_config.js + `var RP_ROLE = "end"` + reverbplus_link.js +
// this file. Outlet 0 -> gen (`xfer <name>`, `hdr <name>` from the link layer).

inlets = 1;
outlets = 1;

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

var EC = {
    bg: [0.055, 0.062, 0.075, 1],
    frame: [0.20, 0.23, 0.28, 1],
    text: [0.80, 0.84, 0.90, 1],
    dim: [0.45, 0.50, 0.58, 1],
    cyan: [0.30, 0.82, 0.95, 1],
    amber: [0.97, 0.68, 0.26, 1],
    coral: [0.98, 0.42, 0.38, 1],
    green: [0.40, 0.88, 0.52, 1],
};

var es = { linked: 0, K: 0, L: 0, wetPk: 0, dryPk: 0, duck: 1, frames: -1, B: 0, wetHold: 0, dryHold: 0 };
var esScope = null;
var esScopeName = "";
var esTask = null;

function rpScopeBind(name) {
    esScopeName = name;
    esScope = null;
    if (!esTask) {
        esTask = new Task(esFrame, this);
        esTask.interval = 50;
        esTask.repeat();
    }
}

rpOnChange = function () {
    mgraphics.redraw();
};

function esFrame() {
    if (!esScope && esScopeName) {
        try { esScope = new Buffer(esScopeName); } catch (e) { esScope = null; }
    }
    if (!esScope) return;
    var h = esScope.peek(1, 0, RP_ESCOPE_SAMPS);
    if (!h || h.length < 10) return;
    var E = RP_ESCOPE;
    if (h[E.FRAMES] === es.frames && es.wetHold < 0.001 && es.dryHold < 0.001) return;
    es.frames = h[E.FRAMES];
    es.linked = h[E.LINKED]; es.K = h[E.K]; es.L = h[E.L];
    es.wetPk = h[E.WET_PK]; es.dryPk = h[E.DRY_PK]; es.duck = h[E.DUCK]; es.B = h[E.B];
    es.wetHold = Math.max(es.wetPk, es.wetHold * 0.85);
    es.dryHold = Math.max(es.dryPk, es.dryHold * 0.85);
    mgraphics.redraw();
}

function esColor(c, a) {
    mgraphics.set_source_rgba(c[0], c[1], c[2], a === undefined ? c[3] : a);
}

function esText(str, x, y, size, c, bold) {
    mgraphics.select_font_face(bold ? "Arial Bold" : "Arial");
    mgraphics.set_font_size(size);
    esColor(c);
    mgraphics.move_to(x, y);
    mgraphics.show_text(String(str));
}

function esMeter(x, y, w, h, v, c, label) {
    esColor(EC.frame, 0.6);
    mgraphics.rectangle_rounded(x, y, w, h, 2, 2);
    mgraphics.fill();
    var db = 20 * Math.log10(Math.max(v, 1e-5));
    var f = rpClamp((db + 60) / 60, 0, 1);
    esColor(c, 0.9);
    mgraphics.rectangle_rounded(x, y + h * (1 - f), w, h * f, 2, 2);
    mgraphics.fill();
    esText(label, x + w * 0.5 - 3, y + h + 10, 8, EC.dim, true);
}

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    esColor(EC.bg);
    mgraphics.rectangle_rounded(0, 0, w, h, 6, 6);
    mgraphics.fill();

    var ok = rpLink.paired && es.linked > 0.5;
    var col = ok ? EC.cyan : EC.coral;
    esColor(col);
    mgraphics.arc(11.5, 12.5, 3.5, 0, Math.PI * 2);
    mgraphics.fill();
    esText(ok ? "LINKED" : (rpLink.paired ? "WAITING" : "NO START"), 19, 16, 9.5, col, true);

    var sr = 44100;
    var y0 = 34;
    esText("CHAIN LATENCY", 8, y0, 7.5, EC.dim, true);
    esText(Math.round(es.L) + " smp", 8, y0 + 13, 11, EC.text, true);
    esText("SLICE " + Math.round(es.B) + "  K " + Math.round(es.K), 8, y0 + 25, 7.5, EC.dim, false);

    var mx = w - 34;
    esMeter(mx, 26, 9, h - 50, es.wetHold, EC.cyan, "W");
    esMeter(mx + 14, 26, 9, h - 50, es.dryHold, EC.text, "D");
    var dk = rpClamp(es.duck, 0, 1);
    esColor(EC.amber, 0.25 + 0.75 * (1 - dk));
    mgraphics.rectangle(mx, 20, 23 * (1 - dk), 3);
    mgraphics.fill();

    esColor(EC.frame);
    mgraphics.set_line_width(1);
    mgraphics.rectangle_rounded(0.5, 0.5, w - 1, h - 1, 6, 6);
    mgraphics.stroke();
}

// scripts/render_preview.py: representative state (linked).
function preview() {
    rpLink.paired = true;
    es.linked = 1; es.K = 0; es.L = 256; es.B = 32;
    es.wetHold = 0.3; es.dryHold = 0.6; es.duck = 0.8;
}
