// Five faces for Amp+, redesigned from scratch: Wave, Pulse, Tiles, Strip, Mono.
// Rects are device pixels. Hidden boxes are out of the hit test.
// obj-viz is the only clickable canvas. obj-viz-bg is ignoreclick and may cover the device.

var AMP_W = 496;
var AMP_H = 169;

function ampBox(x, y, w, h, hidden) {
    return { rect: [x, y, w, h], hidden: hidden ? 1 : 0 };
}

function ampOff() {
    return ampBox(0, 0, 1, 1, 1);
}

function ampDials(xs, y, w, h) {
    var keys = ["gain", "bass", "mid", "treble", "presence", "volume"];
    var out = {};
    var i;
    for (i = 0; i < keys.length; i++) out["obj-ctrl-" + keys[i]] = ampBox(xs[i], y, w, h, 0);
    return out;
}

function ampDialsGrid(xs, ys, w, h) {
    var keys = ["gain", "bass", "mid", "treble", "presence", "volume"];
    var out = {};
    var i;
    for (i = 0; i < keys.length; i++) out["obj-ctrl-" + keys[i]] = ampBox(xs[i % xs.length], ys[Math.floor(i / xs.length)], w, h, 0);
    return out;
}

function ampChrome(show) {
    if (!show) {
        return {
            "obj-panel-amp": ampOff(),
            "obj-title-amp": ampOff(),
            "obj-rule-amp": ampOff(),
            "obj-panel-cab": ampOff(),
            "obj-title-cab": ampOff(),
            "obj-rule-cab": ampOff()
        };
    }
    return {
        "obj-panel-amp": ampBox(4, 4, 488, 136, 0),
        "obj-title-amp": ampBox(8, 6, 28, 13, 0),
        "obj-rule-amp": ampBox(40, 13, 448, 2, 0),
        "obj-panel-cab": ampBox(4, 140, 488, 25, 0),
        "obj-title-cab": ampOff(),
        "obj-rule-cab": ampOff()
    };
}

function ampAssign(target, src) {
    var k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    return target;
}

// Wave: the output waveform is the face. One wide scope on top, one even dial
// row, and every remaining control on a single compact strip at the bottom.
function ampLookWave() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(8, 8, 480, 76, 0),
        "obj-ctrl-amp": ampBox(8, 148, 110, 16, 0),
        "obj-ctrl-look": ampBox(122, 148, 74, 16, 0),
        "obj-ctrl-cabon": ampBox(200, 148, 40, 16, 0),
        "obj-ctrl-cabtype": ampBox(244, 148, 70, 16, 0),
        "obj-ctrl-mic": ampBox(318, 148, 96, 16, 0),
        "obj-lbl-position": ampBox(418, 150, 26, 12, 0),
        "obj-ctrl-position": ampBox(446, 148, 42, 16, 0)
    };
    ampAssign(boxes, ampDials([8, 86, 164, 242, 320, 398], 92, 70, 48));
    ampAssign(boxes, ampChrome(0));
    return { name: "Wave", dialName: 1, boxes: boxes };
}

// Pulse: a radial visualizer on the left. The dials sit in a plain 3x2 grid on
// the right, grouped amp / cabinet / mic-position top to bottom.
function ampLookPulse() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(8, 8, 232, 152, 0),
        "obj-ctrl-amp": ampBox(252, 106, 112, 16, 0),
        "obj-ctrl-look": ampBox(368, 106, 116, 16, 0),
        "obj-ctrl-cabon": ampBox(252, 128, 38, 16, 0),
        "obj-ctrl-cabtype": ampBox(294, 128, 66, 16, 0),
        "obj-ctrl-mic": ampBox(364, 128, 120, 16, 0),
        "obj-lbl-position": ampBox(252, 152, 28, 12, 0),
        "obj-ctrl-position": ampBox(284, 150, 96, 16, 0)
    };
    ampAssign(boxes, ampDialsGrid([252, 332, 412], [4, 54], 72, 46));
    ampAssign(boxes, ampChrome(0));
    return { name: "Pulse", dialName: 1, boxes: boxes };
}

// Tiles: every dial gets its own level-reactive tile in a 3x2 grid. The cabinet
// controls are a tile column on the right under a mini scope tile.
function ampLookTiles() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(338, 8, 150, 62, 0),
        "obj-ctrl-amp": ampBox(338, 76, 72, 16, 0),
        "obj-ctrl-look": ampBox(414, 76, 74, 16, 0),
        "obj-ctrl-cabon": ampBox(338, 96, 44, 16, 0),
        "obj-ctrl-cabtype": ampBox(386, 96, 102, 16, 0),
        "obj-ctrl-mic": ampBox(338, 116, 150, 16, 0),
        "obj-lbl-position": ampBox(338, 142, 28, 12, 0),
        "obj-ctrl-position": ampBox(370, 140, 118, 16, 0)
    };
    ampAssign(boxes, ampDialsGrid([8, 118, 228], [8, 76], 102, 62));
    ampAssign(boxes, ampChrome(0));
    return { name: "Tiles", dialName: 1, boxes: boxes };
}

// Strip: a channel strip. A filled oscillogram strip on top, the tone stack as
// the four big dials in the middle with Gain and Volume as smaller bookends,
// the cabinet row under them, and a full-width output meter along the bottom.
function ampLookStrip() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(8, 6, 480, 40, 0),
        "obj-ctrl-amp": ampBox(8, 124, 110, 16, 0),
        "obj-ctrl-look": ampBox(122, 124, 74, 16, 0),
        "obj-ctrl-cabon": ampBox(200, 124, 40, 16, 0),
        "obj-ctrl-cabtype": ampBox(244, 124, 70, 16, 0),
        "obj-ctrl-mic": ampBox(318, 124, 96, 16, 0),
        "obj-lbl-position": ampBox(418, 126, 26, 12, 0),
        "obj-ctrl-position": ampBox(446, 124, 42, 16, 0),
        "obj-ctrl-gain": ampBox(8, 54, 64, 62, 0),
        "obj-ctrl-bass": ampBox(80, 54, 80, 62, 0),
        "obj-ctrl-mid": ampBox(168, 54, 80, 62, 0),
        "obj-ctrl-treble": ampBox(256, 54, 80, 62, 0),
        "obj-ctrl-presence": ampBox(344, 54, 80, 62, 0),
        "obj-ctrl-volume": ampBox(432, 54, 56, 62, 0)
    };
    ampAssign(boxes, ampChrome(0));
    return { name: "Strip", dialName: 1, boxes: boxes };
}

// Mono: a minimal performance face. Gain and Volume are the two hero dials,
// the tone stack is one small row along the bottom, everything else is a
// compact column on the right, and a single level disc is the whole picture.
function ampLookMono() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(176, 8, 150, 108, 0),
        "obj-ctrl-amp": ampBox(334, 8, 154, 16, 0),
        "obj-ctrl-look": ampBox(334, 28, 154, 16, 0),
        "obj-ctrl-cabon": ampBox(334, 48, 48, 16, 0),
        "obj-ctrl-cabtype": ampBox(386, 48, 102, 16, 0),
        "obj-ctrl-mic": ampBox(334, 68, 154, 16, 0),
        "obj-lbl-position": ampBox(334, 90, 30, 12, 0),
        "obj-ctrl-position": ampBox(368, 88, 120, 16, 0),
        "obj-ctrl-gain": ampBox(8, 8, 78, 80, 0),
        "obj-ctrl-volume": ampBox(90, 8, 78, 80, 0),
        "obj-ctrl-bass": ampBox(8, 124, 56, 40, 0),
        "obj-ctrl-mid": ampBox(68, 124, 56, 40, 0),
        "obj-ctrl-treble": ampBox(128, 124, 56, 40, 0),
        "obj-ctrl-presence": ampBox(188, 124, 56, 40, 0)
    };
    ampAssign(boxes, ampChrome(0));
    return { name: "Mono", dialName: 0, boxes: boxes };
}

function ampAllLooks() {
    return [ampLookWave(), ampLookPulse(), ampLookTiles(), ampLookStrip(), ampLookMono()];
}

function ampLayout(index) {
    var looks = ampAllLooks();
    var i = Math.round(Number(index));
    if (!(i >= 0 && i < looks.length)) i = 0;
    return looks[i];
}

function ampOverlaps(a, b) {
    return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1];
}

function ampLookProblems(look) {
    var problems = [];
    var ids = [];
    var id;
    for (id in look.boxes) if (Object.prototype.hasOwnProperty.call(look.boxes, id)) ids.push(id);
    var live = [];
    var i;
    for (i = 0; i < ids.length; i++) {
        id = ids[i];
        var spec = look.boxes[id];
        if (spec.hidden || id === "obj-viz-bg" || id.indexOf("obj-panel-") === 0) continue;
        var r = spec.rect;
        if (r[0] < -0.1 || r[1] < -0.1 || r[0] + r[2] > AMP_W + 0.1 || r[1] + r[3] > AMP_H + 0.1) {
            problems.push(look.name + " " + id + " outside");
        }
        live.push({ id: id, rect: r });
    }
    var a, b;
    for (a = 0; a < live.length; a++) {
        for (b = a + 1; b < live.length; b++) {
            if (ampOverlaps(live[a].rect, live[b].rect)) {
                problems.push(look.name + " " + live[a].id + " overlaps " + live[b].id);
            }
        }
    }
    return problems;
}

// Map a linear output peak to 0..1 for the face. Quiet notes still move; hot notes stay near full.
function ampLevelFromEnv(v) {
    var x = Number(v);
    if (!(x > 0)) return 0;
    if (x > 1.5) x = 1.5;
    var u = Math.pow(x / 1.5, 0.5);
    return u > 1 ? 1 : u;
}

var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = {
        ampAllLooks: ampAllLooks,
        ampLayout: ampLayout,
        ampLookProblems: ampLookProblems,
        ampLevelFromEnv: ampLevelFromEnv
    };
}
