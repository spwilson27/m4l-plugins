// Five faces for Amp+. Rects are device pixels. Hidden boxes are out of the hit test.
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

function ampLookHead() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(8, 22, 120, 86, 0),
        "obj-ctrl-amp": ampBox(8, 114, 120, 16, 0),
        "obj-ctrl-cabon": ampBox(8, 146, 42, 16, 0),
        "obj-ctrl-look": ampBox(54, 146, 70, 16, 0),
        "obj-ctrl-cabtype": ampBox(128, 146, 72, 16, 0),
        "obj-ctrl-mic": ampBox(204, 146, 150, 16, 0),
        "obj-lbl-position": ampBox(358, 148, 28, 12, 0),
        "obj-ctrl-position": ampBox(388, 146, 100, 16, 0)
    };
    ampAssign(boxes, ampDials([140, 198, 256, 314, 372, 430], 28, 54, 76));
    ampAssign(boxes, ampChrome(1));
    return { name: "Head", dialName: 1, boxes: boxes };
}

function ampLookStack() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(6, 6, 142, 100, 0),
        "obj-ctrl-amp": ampBox(158, 6, 160, 16, 0),
        "obj-ctrl-look": ampBox(326, 6, 162, 16, 0),
        "obj-ctrl-cabon": ampBox(6, 112, 46, 16, 0),
        "obj-ctrl-cabtype": ampBox(56, 112, 92, 16, 0),
        "obj-ctrl-mic": ampBox(6, 132, 142, 16, 0),
        "obj-lbl-position": ampBox(6, 152, 32, 12, 0),
        "obj-ctrl-position": ampBox(42, 150, 106, 16, 0)
    };
    ampAssign(boxes, ampDialsGrid([158, 270, 382], [28, 100], 104, 66));
    ampAssign(boxes, ampChrome(0));
    return { name: "Stack", dialName: 1, boxes: boxes };
}

function ampLookPlate() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(8, 76, 480, 58, 0),
        "obj-ctrl-amp": ampBox(8, 140, 96, 18, 0),
        "obj-ctrl-look": ampBox(108, 140, 70, 18, 0),
        "obj-ctrl-cabon": ampBox(182, 140, 40, 18, 0),
        "obj-ctrl-cabtype": ampBox(226, 140, 68, 18, 0),
        "obj-ctrl-mic": ampBox(298, 140, 112, 18, 0),
        "obj-lbl-position": ampBox(414, 143, 26, 12, 0),
        "obj-ctrl-position": ampBox(442, 140, 46, 18, 0)
    };
    ampAssign(boxes, ampDials([8, 89, 170, 251, 332, 413], 4, 76, 68));
    ampAssign(boxes, ampChrome(0));
    return { name: "Plate", dialName: 1, boxes: boxes };
}

function ampLookCombo() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(128, 6, 240, 128, 0),
        "obj-ctrl-amp": ampBox(8, 148, 96, 16, 0),
        "obj-ctrl-look": ampBox(108, 148, 70, 16, 0),
        "obj-ctrl-cabon": ampBox(182, 148, 40, 16, 0),
        "obj-ctrl-cabtype": ampBox(226, 148, 68, 16, 0),
        "obj-ctrl-mic": ampBox(298, 148, 112, 16, 0),
        "obj-lbl-position": ampBox(414, 150, 26, 12, 0),
        "obj-ctrl-position": ampBox(442, 148, 46, 16, 0),
        "obj-ctrl-gain": ampBox(10, 8, 52, 38, 0),
        "obj-ctrl-bass": ampBox(10, 50, 52, 38, 0),
        "obj-ctrl-mid": ampBox(10, 92, 52, 38, 0),
        "obj-ctrl-treble": ampBox(400, 8, 52, 38, 0),
        "obj-ctrl-presence": ampBox(400, 50, 52, 38, 0),
        "obj-ctrl-volume": ampBox(400, 92, 52, 38, 0)
    };
    ampAssign(boxes, ampChrome(0));
    return { name: "Combo", dialName: 0, boxes: boxes };
}

function ampLookRack() {
    var boxes = {
        "obj-viz-bg": ampBox(0, 0, AMP_W, AMP_H, 0),
        "obj-viz": ampBox(8, 6, 480, 24, 0),
        "obj-ctrl-amp": ampBox(8, 132, 96, 18, 0),
        "obj-ctrl-look": ampBox(108, 132, 70, 18, 0),
        "obj-ctrl-cabon": ampBox(182, 132, 40, 18, 0),
        "obj-ctrl-cabtype": ampBox(226, 132, 68, 18, 0),
        "obj-ctrl-mic": ampBox(298, 132, 112, 18, 0),
        "obj-lbl-position": ampBox(414, 135, 26, 12, 0),
        "obj-ctrl-position": ampBox(442, 132, 46, 18, 0)
    };
    ampAssign(boxes, ampDials([10, 91, 172, 253, 334, 415], 38, 74, 82));
    ampAssign(boxes, ampChrome(0));
    return { name: "Rack", dialName: 1, boxes: boxes };
}

function ampAllLooks() {
    return [ampLookHead(), ampLookStack(), ampLookPlate(), ampLookCombo(), ampLookRack()];
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
