"use strict";
/** Lanes extras: the meta rows line up with the canvas lanes, every Value / Range is on the face, no live.* over the canvas, theme-bound panels. */
const path = require("path");
const T = require("./deviate_test_lib.js");
const R = T.makeReporter("test_deviate_face_lanes");
const dir = T.tmpDir("lanes");
const built = T.buildInto(dir).filter((f) => f === "Deviate Lanes.amxd");
R.ok(built.length === 1, "Deviate Lanes.amxd built");
if (built.length) {
    const dev = T.readDevice(path.join(dir, built[0]));
    const box = (id) => dev.byId[id];
    const canvas = box("obj-lay-lanes-viz");
    const [cx, cy, cw, ch] = canvas.presentation_rect;
    R.ok(cw === 250 && ch === 159, `canvas is 250x159 (${cw}x${ch})`);
    R.ok(canvas.ignoreclick === 1, "canvas is ignoreclick");
    const keys = ["snap", "pitch", "body", "motion", "space", "echo", "grit", "ring"];
    const rowOf = { snap: 0, grit: 0, pitch: 1, body: 1, motion: 1, space: 2, echo: 2, ring: 2 };
    for (const k of keys) {
        for (const p of ["v_", "r_", "l_"]) {
            const b = box("obj-ctrl-" + p + k);
            R.ok(b && b.presentation === 1 && !b.hidden, `${p}${k} is on the face`);
            if (!b) continue;
            const laneTop = cy + 14 + rowOf[k] * 47;
            const [x, y, w, h] = b.presentation_rect;
            R.ok(y >= laneTop - 0.01 && y + h <= laneTop + 44.01, `${p}${k} lies within its lane row (${y}..${y + h} vs ${laneTop}..${laneTop + 44})`);
            R.ok(x >= cx + cw, `${p}${k} is right of the canvas`);
        }
    }
    for (const k of ["reroll", "mix", "chance", "sens"]) { const b = box("obj-ctrl-" + k); R.ok(b && b.presentation === 1, `${k} is on the face`); }
    const colorAttrs = ["bgcolor", "textcolor", "activebgcolor", "activedialcolor", "activeslidercolor", "lcdcolor", "bordercolor"];
    for (const b of dev.boxes.filter((x) => /^obj-ctrl-/.test(x.id))) {
        const bad = colorAttrs.filter((a) => b[a] !== undefined);
        R.ok(bad.length === 0, `${b.id} has no static colour attribute${bad.length ? ": " + bad : ""}`);
    }
    for (const id of ["obj-panel-meta", "obj-panel-globals", "obj-panel-lanes", "obj-panel-body"]) {
        const b = box(id);
        const e = b && b.saved_attribute_attributes && b.saved_attribute_attributes.bgfillcolor;
        R.ok(e && /themecolor\./.test(e.expression), `${id} is bound to a theme colour`);
    }
}
const src = require("fs").readFileSync(path.join(__dirname, "..", "src", "deviate_face_lanes.js"), "utf8");
const num = (n) => Number((src.match(new RegExp("var " + n + " = (\\d+)")) || [])[1]);
const gaugeRight = num("LN_GUT_X") + 2 * num("LN_GAUGE_PITCH") + num("LN_GAUGE_W") + 2; // fill + the Value tick overhangs by 1 px + 1
R.ok(gaugeRight <= num("LN_CANVAS_W") - num("LN_RIGHT_MARGIN"), `gauge right edge ${gaugeRight} leaves a ${num("LN_RIGHT_MARGIN")} px margin`);
R.ok(num("LN_AXIS_Y") + 3 <= num("LN_CANVAS_H"), "axis label baseline leaves descender room");
R.ok(/\bt\.draws\b/.test(src) && !/lnPush\([^;]*t\.metas/.test(src) && !/lnPush\([^;]*dvTel\.metas/.test(src), "hit ticks come from the raw draws");
R.ok(!/"-2\.4 s"/.test(src) && /lnSpanLabel/.test(src), "span label is not a hard-coded constant");
R.done();
