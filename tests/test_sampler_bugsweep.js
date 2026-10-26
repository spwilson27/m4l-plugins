// Pass 1 bugsweep red tests for Better Sampler.
// Each block corresponds to a bug in BUGS.md and is EXPECTED TO FAIL at the
// pre-bugsweep baseline: the failure is the evidence for the bug.
// Style follows tests/test_sampler_slicing.js (ok/near helpers, exit code).
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const C = require("../src/sampler_config.js");

let fails = 0, passes = 0;
function ok(c, m) { if (c) passes++; else { fails++; console.log("FAIL: " + m); } }
function near(a, b, t) { return Math.abs(a - b) <= t; }

const ROOT = path.resolve(__dirname, "..");

// --- sandbox of the built device's main face script (mirrors makeSandbox in
// tests/test_sampler.js, trimmed to what getvalueof/setvalueof need) ---
function loadMainFace() {
    const raw = fs.readFileSync(path.join(ROOT, "devices", "Better Sampler.amxd"));
    const doc = JSON.parse(raw.slice(32).toString("utf8"));
    const boxes = doc.patcher.boxes.map((b) => b.box);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    const box = byId.get("obj-viz");
    const ctx = { emitted: [], notified: 0, channels: 2, fileRate: 44100, fileFrames: 44100 };
    const noop = () => {};
    const sandbox = {
        mgraphics: {
            size: [box.presentation_rect[2], box.presentation_rect[3]],
            relative_coords: 1, autofill: 1,
            init: noop, redraw: noop, set_source_rgba: noop, set_line_width: noop,
            rectangle: noop, rectangle_rounded: noop, move_to: noop, line_to: noop,
            curve_to: noop, close_path: noop, arc: noop, fill: noop, stroke: noop,
            select_font_face: noop, set_font_size: noop, show_text: noop,
        },
        inlets: 1, outlets: 1,
        outlet: (...args) => ctx.emitted.push(args),
        notifyclients: () => { ctx.notified++; },
        arrayfromargs: (args) => Array.from(args),
        Buffer: function (name) {
            this.name = String(name || "");
            this.framecount = () => ctx.fileFrames;
            this.length = () => ctx.fileFrames / ctx.fileRate * 1000;
            this.channelcount = () => ctx.channels;
            this.peek = (ch, start, len) => new Float32Array(Math.max(1, len || 1));
            this.poke = noop;
            this.send = noop;
        },
        Task: function () { this.schedule = noop; },
        max: { hidecursor: noop, showcursor: noop },
        post: noop,
        Math, Number, String, Array, Object, Float32Array,
    };
    vm.createContext(sandbox);
    vm.runInContext(box.textfile.text, sandbox);
    ctx.sb = sandbox;
    return ctx;
}

// Bug 1: state save/load loses slice markers and corrupts the sample path
// when there are more than 32 markers.
// getvalueof (src/sampler_ui.js) writes sliceMarkers.length uncapped, every
// marker, then the sample path. setvalueof clamps the count to 32 and reads
// the path at 11 + clampedCount, so with >32 markers the extra markers are
// dropped and the 33rd marker value is misread as the sample path.
// Reachable via Slice Divisions (slice_div up to 64 -> 64 markers),
// Beats mode (up to 256 markers) or manual addSliceMarker (no cap).
{
    const ctx = loadMainFace();
    const sb = ctx.sb;
    const markers = C.sliceDivisions(0, 1, 64);
    ok(markers.length === 64, "setup: sliceDivisions(0,1,64) yields 64 markers, got " + markers.length);
    sb.sliceMarkers = markers.slice();
    sb.dropfile("/Users/test/Drums/Loop 64.wav");
    const saved = sb.getvalueof();
    ok(saved[10] === 64, "setup: getvalueof stores the full count 64, got " + saved[10]);
    ok(saved.length === 11 + 64 + 1, "setup: blob length 11 + 64 + path = 76, got " + saved.length);
    ok(saved[saved.length - 1] === "/Users/test/Drums/Loop 64.wav", "setup: path stored last");

    sb.sliceMarkers = [0, 0.5];
    sb.sampleFilePath = "";
    sb.sampleFileName = "";
    ctx.emitted.length = 0;
    sb.setvalueof.apply(sb, saved);

    ok(sb.sliceMarkers.length === 64,
        "round-trip keeps all 64 slice markers, got " + sb.sliceMarkers.length);
    ok(sb.sliceMarkers.length === 64 && near(sb.sliceMarkers[40], markers[40], 1e-4),
        "marker 40 survives the round-trip (want " + markers[40] + ", got " + sb.sliceMarkers[40] + ")");
    ok(sb.sampleFilePath === "/Users/test/Drums/Loop 64.wav",
        "sample path survives the round-trip, got " + JSON.stringify(sb.sampleFilePath));
    ok(ctx.emitted.some((a) => a[1] === "load_sample" && a[2] === "/Users/test/Drums/Loop 64.wav"),
        "restore emits load_sample with the real path, got " +
        JSON.stringify(ctx.emitted.filter((a) => a[1] === "load_sample")));
}

console.log(passes + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
