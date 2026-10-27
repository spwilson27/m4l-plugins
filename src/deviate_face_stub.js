// Deviate Stub face: exercises the face contract (throwaway). Draws the three chain peaks, the Ring envelope, the 8 drawn metas against their
// Values, the gate and the DSP pill. A click sends a manual hit (role "hit").

var STUB_PAL = { bg: [0.05, 0.06, 0.075, 1], t: [0.98, 0.62, 0.25, 1], b: [0.40, 0.82, 0.95, 1], l: [0.72, 0.55, 0.98, 1], text: [0.82, 0.88, 0.94, 1], dim: [0.42, 0.48, 0.56, 1], hit: [1, 1, 1, 1] };
var stubFlash = 0;

dvPoll(30);

function onFrame(t) {
    if (t.hitNew) stubFlash = 1;
    else stubFlash = Math.max(0, stubFlash - 0.12);
    return true;
}

function onclick() {
    dvManualHit();
}

function preview() {
    dvPreviewBase();
    stubFlash = dvTel.hitNew ? 1 : 0;
}

function paint() {
    var W = mgraphics.size[0], H = mgraphics.size[1], i;
    dvColor(STUB_PAL.bg);
    mgraphics.rectangle(0, 0, W, H);
    mgraphics.fill();
    if (stubFlash > 0.02) {
        dvColor(STUB_PAL.hit, 0.12 * stubFlash);
        mgraphics.rectangle(0, 0, W, H);
        mgraphics.fill();
    }
    // chain peaks T / B / L
    var cols = [STUB_PAL.t, STUB_PAL.b, STUB_PAL.l], pk = [dvTel.pk.t, dvTel.pk.b, dvTel.pk.l], lab = ["T", "B", "L"];
    for (i = 0; i < 3; i++) {
        var h = Math.min(1, pk[i]) * 60;
        dvColor(cols[i], 0.9);
        mgraphics.rectangle(8 + i * 44, 70 - h, 36, Math.max(1, h));
        mgraphics.fill();
        dvText(lab[i], 22 + i * 44, 82, 9, STUB_PAL.text, true);
    }
    // Ring envelope
    dvColor(STUB_PAL.dim);
    mgraphics.rectangle(8, 90, W - 16, 4);
    mgraphics.fill();
    dvColor(STUB_PAL.l, 0.9);
    mgraphics.rectangle(8, 90, Math.max(1, (W - 16) * dvTel.ringEnv), 4);
    mgraphics.fill();
    // 8 metas: drawn value (bar) against the Value (tick)
    var bw = (W - 16) / 8;
    for (i = 0; i < 8; i++) {
        var m = dvMetaValue(i) / 100, v = dvNorm("v_" + DV_META_KEYS[i]);
        dvColor(STUB_PAL.t, dvTel.gate ? 0.9 : 0.35);
        mgraphics.rectangle(8 + i * bw + 2, 151 - m * 38, bw - 4, Math.max(1, m * 38));
        mgraphics.fill();
        dvColor(STUB_PAL.hit, 0.8);
        mgraphics.rectangle(8 + i * bw, 151 - v * 38, bw, 1);
        mgraphics.fill();
    }
    dvText(dvTel.gate ? "DRAW" : "KEPT", 8, 106, 9, dvTel.gate ? STUB_PAL.t : STUB_PAL.dim, true);
    dvText(dvTel.split ? "SPEC" : "ENV", W - 38, 106, 9, STUB_PAL.dim, true);
    dvDrawDspPill(W - 6, 4, 8, DVC);
}
