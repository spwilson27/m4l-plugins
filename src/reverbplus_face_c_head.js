// Reverb+ face `c` ("Essentials + More"), head strip: a draw-only v8ui between the Algorithm menu and the Freeze / More
// chips. It (1) draws the status pills (DSP loading / failed, no End, loop MIN, IR state) and a quiet "LINKED" when all is well,
// and (2) owns the More swap: it shows / hides the waterfall and the More grid with Maxobj.setattr("hidden") by scripting name
// (CC_LAYOUT, injected by scripts/reverbplus_layouts/c.py) and greys the controls the algorithm does not use (rpActive).
// Build order: config + face_common + this file. Subscribed keys: more, algo.

outlets = 1;
rpPoll(4);

var CCS = { hidden: {}, active: {}, hero: null, heroHidden: -1 };

/**
 * Which parts are hidden for a state (pure; tested for every algorithm).
 * @param {number} more 0 / 1
 * @param {number} algo 0..5
 */
function ccHidden(more, algo) {
    var conv = algo === RP_ALGO.CONV;
    return {
        hero: more ? 1 : 0,
        more: more ? 0 : 1,
        tank: !more || conv ? 1 : 0,
        ir: !more || !conv ? 1 : 0,
    };
}

function ccFind(name) {
    var p = this.patcher;
    return p ? p.getnamed(name) : null;
}

/** The hero v8ui has no scripting name: find it by its presentation rectangle. */
function ccFindHero() {
    if (CCS.hero) return CCS.hero;
    var o = this.patcher ? this.patcher.firstobject : null;
    var want = CC_LAYOUT.heroRect;
    while (o) {
        if (o.maxclass === "v8ui") {
            var r = o.getattr("presentation_rect");
            if (r && r.length >= 4 && Math.abs(r[0] - want[0]) < 0.5 && Math.abs(r[1] - want[1]) < 0.5 && Math.abs(r[2] - want[2]) < 0.5) {
                CCS.hero = o;
                break;
            }
        }
        o = o.nextobject;
    }
    return CCS.hero;
}

function ccApply() {
    if (!this.patcher) return;
    var more = rpNum("more", 0) > 0.5 ? 1 : 0;
    var algo = rpAlgo();
    var f = ccHidden(more, algo);
    var hero = ccFindHero();
    if (hero && CCS.heroHidden !== f.hero) { hero.setattr("hidden", f.hero); CCS.heroHidden = f.hero; }
    for (var g in CC_LAYOUT.groups) {
        var names = CC_LAYOUT.groups[g];
        for (var i = 0; i < names.length; i++) {
            if (CCS.hidden[names[i]] === f[g]) continue;
            var o = ccFind(names[i]);
            if (o) { o.setattr("hidden", f[g]); CCS.hidden[names[i]] = f[g]; }
        }
    }
    for (var key in CC_LAYOUT.keyNames) {
        var act = rpActive(key) ? 1 : 0;
        if (CCS.active[key] === act) continue;
        var c = ccFind(CC_LAYOUT.keyNames[key]);
        if (c) { c.setattr("active", act); CCS.active[key] = act; }
    }
}

function onParam(key) {
    if (key === "more" || key === "algo") ccApply();
}

// ---- drawing ----------------------------------------------------------------------------------------------------------

function ccFit(text, maxW) {
    var t = text;
    while (t.length > 3 && rpTextW(t, 8, true) + 12 > maxW) t = t.substring(0, t.length - 2) + "…";
    return t;
}

function paint() {
    var w = mgraphics.size[0];
    rpRefreshTheme();
    var pills = rpHeaderPills();
    var x = 0;
    if (!pills.length) {
        rpText("LINKED", 2, 11, 8, RPC.dim, true);
        return;
    }
    for (var i = 0; i < pills.length; i++) {
        var label = ccFit(pills[i].label, w - x);
        var pw = rpTextW(label, 8, true) + 12;
        if (x + pw > w + 0.5) break;
        rpPill(x, 1, pw, 13, pills[i].color, 0.16);
        rpText(label, x + 6, 10.6, 8, pills[i].color, true);
        x += pw + 4;
    }
}

function preview() {
    rpPreviewBase(1, 2.5);
    rpState.link = { paired: 0, status: "no End", latency: 0, partner: -1 };
}
