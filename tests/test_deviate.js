"use strict";
/**
 * Structural checks of ALL built Deviate devices (every face module in scripts/deviate_faces). Host only, no Max / Live.
 *   node tests/test_deviate.js
 * Builds every face twice into temp dirs (the .amxd files must be byte-identical), then checks each device. Also compares the
 * committed devices/Deviate *.amxd with the fresh build (a stale device means build_deviate.py was not re-run).
 */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const L = require("./lint_lib.js");
const T = require("./deviate_test_lib.js");
const CFG = require("../src/deviate_config.js");

const R = T.makeReporter("test_deviate");
const dirA = T.tmpDir("a"), dirB = T.tmpDir("b");
const filesA = T.buildInto(dirA);
const filesB = T.buildInto(dirB);
const info = T.faceInfo();
const faces = Object.keys(info.faces);

R.ok(faces.length > 0, `face modules found: ${faces.join(", ")}`);
R.ok(filesA.length === faces.length, `one device per face (${filesA.length} devices, ${faces.length} faces)`);
R.ok(JSON.stringify(filesA) === JSON.stringify(filesB), "both builds write the same file names");
console.log(`devices: ${filesA.join(", ")}`);

const INTERACTIVE = new Set(["live.dial", "live.numbox", "live.text", "live.tab", "live.menu", "live.slider", "live.toggle", "live.button", "live.drop"]);
const vis = (b) => b.presentation === 1 && !b.hidden && b.presentation_rect;
const inter = (a, b) => Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]) > 0.5;

// ---- the parameter table: DV_PARAMS in src/deviate_config.js vs --dump-params ---------------------------------------------------
const dump = JSON.parse(cp.spawnSync("python3", ["scripts/build_deviate.py", "--dump-params"], { cwd: T.ROOT, encoding: "utf8" }).stdout);
const dumpKeys = dump.map((p) => p.key);
R.ok(dump.length === CFG.DV_PARAMS.length, `--dump-params has ${dump.length} rows, DV_PARAMS ${CFG.DV_PARAMS.length}`);
dump.forEach((p, i) => {
    const d = CFG.DV_PARAMS[i];
    if (!d) return;
    const row = [p.key, p.long, p.short, p.min, p.max, p.init, p.type, p.unit, p.expo, p.gen, p.div];
    R.ok(JSON.stringify(row) === JSON.stringify(d), `DV_PARAMS[${i}] ${d[0]} equals the build table (${JSON.stringify(d)} vs ${JSON.stringify(row)})`);
});
R.ok(JSON.stringify(info.params.map((p) => p.key)) === JSON.stringify(dumpKeys), "faceInfo params == --dump-params order");
R.ok(dump.every((p) => (p.help || "").length >= 12), "every parameter has a help sentence of >= 12 characters in the build table");

/** parameter table of a device as comparable rows, in the order of the dump */
function paramRows(dev) {
    return dumpKeys.map((k) => {
        const b = dev.byId[`obj-ctrl-${k}`];
        if (!b) return null;
        const v = (b.saved_attribute_attributes || {}).valueof || {};
        return { key: k, long: v.parameter_longname, short: v.parameter_shortname, type: v.parameter_type, min: v.parameter_mmin, max: v.parameter_mmax,
            init: (v.parameter_initial || [])[0], initEnable: v.parameter_initial_enable, unit: v.parameter_unitstyle, expo: v.parameter_exponent,
            enum: v.parameter_enum, invisible: v.parameter_invisible, enable: b.parameter_enable };
    });
}

let refRows = null, refName = null;
const engineHashes = {};
const rebuilt = {};

for (const file of filesA) {
    const name = file.replace(/\.amxd$/, "");
    const faceKey = faces.find((f) => info.faces[f].device === name);
    const fi = info.faces[faceKey];
    const pa = path.join(dirA, file), pb = path.join(dirB, file);
    const tag = `[${name}]`;
    const bufA = fs.readFileSync(pa);
    R.ok(Buffer.compare(bufA, fs.readFileSync(pb)) === 0, `${tag} .amxd is byte-identical across two builds`);
    rebuilt[file] = bufA;
    let dev;
    try { dev = T.readDevice(pa); } catch (e) { R.ok(false, `${tag} parses: ${e.message}`); continue; }
    const p = dev.patcher, boxes = dev.boxes;
    R.ok(dev.errs.length === 0 && dev.type === "aaaa", `${tag} 'ampf' + 'aaaa' header and payload length (${dev.errs.join("; ") || "ok"})`);
    R.ok(fi && p.openrect && p.openrect[3] === 169 && p.openinpresentation === 1, `${tag} openrect height 169, openinpresentation 1`);
    R.ok(p.openrect[2] <= 600 && p.devicewidth <= 600, `${tag} width ${p.openrect[2]} <= 600`);
    R.ok(fi && Math.abs(p.openrect[2] - fi.width) < 0.01 && Math.abs(p.devicewidth - fi.width) < 0.01, `${tag} openrect/devicewidth ${p.openrect[2]}/${p.devicewidth} == the face's declared width ${fi && fi.width}`);
    R.ok(p.latency === 256, `${tag} patcher latency attribute is 256 (${p.latency})`);

    // ids unique, cords land on existing boxes
    const ids = boxes.map((b) => b.id);
    R.ok(new Set(ids).size === ids.length, `${tag} box ids are unique`);
    const badCords = dev.lines.filter((l) => !dev.byId[l.source[0]] || !dev.byId[l.destination[0]]);
    R.ok(badCords.length === 0, `${tag} every cord connects existing boxes${badCords.length ? " (" + JSON.stringify(badCords[0]) + ")" : ""}`);

    // ---- presentation bounds, overlaps, panels
    const W = p.devicewidth;
    const outside = boxes.filter((b) => vis(b) && (b.presentation_rect[0] < -0.5 || b.presentation_rect[1] < -0.5 || b.presentation_rect[0] + b.presentation_rect[2] > W + 0.5 || b.presentation_rect[1] + b.presentation_rect[3] > 169.5));
    R.ok(outside.length === 0, `${tag} every presentation box is inside ${W}x169${outside.length ? ": " + outside.map((b) => b.id).join(", ") : ""}`);
    const overlaps = [];
    boxes.forEach((b, i) => {
        if (!INTERACTIVE.has(b.maxclass) || !vis(b) || b.ignoreclick === 1) return;
        boxes.forEach((c, j) => {
            if ((c.maxclass !== "v8ui" && c.maxclass !== "jsui") || !vis(c) || !inter(b.presentation_rect, c.presentation_rect)) return;
            if (c.ignoreclick === 1 && i > j) return; // exception: ignoreclick canvas with the widget in front
            overlaps.push(`${b.id} over ${c.id}`);
        });
    });
    R.ok(overlaps.length === 0, `${tag} no live.* over an interactive v8ui (ignoreclick exception needs the widget later in boxes)${overlaps.length ? ": " + overlaps.join(", ") : ""}`);
    const firstBg = boxes.findIndex((b) => b.maxclass === "panel" && b.background === 1);
    R.ok(firstBg >= 0, `${tag} has background panels`);
    if (firstBg >= 0) {
        const late = boxes.slice(firstBg).filter((b) => b.background !== 1);
        R.ok(late.length === 0, `${tag} background panels are last, all with background 1${late.length ? " (violators: " + late.map((b) => b.id).join(", ") + ")" : ""}`);
    }
    R.ok(boxes.filter((b) => b.maxclass === "panel" && b.presentation === 1).every((b) => b.background === 1), `${tag} every presentation panel has background 1`);
    if (dev.byId["obj-panel-body"]) R.ok(boxes[boxes.length - 1].id === "obj-panel-body", `${tag} obj-panel-body is the very last box`);

    // ---- buffers, receive, hub, gen, cords
    const newobjs = boxes.filter((b) => b.maxclass === "newobj");
    const bufNames = newobjs.filter((b) => /^buffer~\s/.test(b.text)).map((b) => b.text.trim().split(/\s+/)[1]);
    R.ok(bufNames.length > 0 && bufNames.every((n) => n.startsWith("---")), `${tag} every buffer~ name starts with --- (${bufNames.join(", ")})`);
    R.ok(new Set(bufNames).size === bufNames.length, `${tag} buffer~ names are unique`);
    R.ok(newobjs.some((b) => /^r\s+---deviatetest\s*$/.test(b.text)), `${tag} has [r ---deviatetest]`);
    R.ok(!boxes.some((b) => typeof b.text === "string" && /#0/.test(b.text)), `${tag} no box text uses a literal #0`);
    const hub = newobjs.find((b) => b.text === "gate 1 1");
    R.ok(hub && hub.varname === "dv_genin", `${tag} hub [gate 1 1] with scripting name dv_genin`);
    R.ok(!boxes.some((b) => /^gen/.test(b.maxclass) || (typeof b.text === "string" && /^gen(~|\.codebox~)?(\s|$)/.test(b.text))), `${tag} no gen~ / gen.codebox~ box (deferred gen)`);
    R.ok(!dev.lines.some((l) => l.source[0] === "obj-plugin" && l.destination[0] === "obj-plugout"), `${tag} no direct plugin~ -> plugout~ cord`);
    R.ok(!dev.lines.some((l) => l.destination[0] === "obj-gen"), `${tag} no cord into a (non-existing) obj-gen`);
    R.ok(hub && dev.lines.some((l) => l.destination[0] === hub.id && l.destination[1] === 1), `${tag} gen-bound cords go into the hub's data inlet`);

    // ---- the engine
    const eng = dev.byId["obj-engine"];
    R.ok(eng && eng.maxclass === "v8ui" && eng.presentation !== 1 && !eng.presentation_rect, `${tag} engine v8ui exists and is NOT in presentation`);
    const ev = eng && eng.saved_attribute_attributes && eng.saved_attribute_attributes.valueof;
    R.ok(eng && eng.parameter_enable === 1 && ev && ev.parameter_type === 3, `${tag} blob parameter on obj-engine has parameter_type 3`);
    const engText = (eng && eng.textfile && eng.textfile.text) || "";
    const hm = /var GEN_DSP_HASH\s*=\s*"([0-9a-f]+)"/.exec(engText);
    R.ok(!!hm, `${tag} engine script has GEN_DSP_HASH`);
    if (hm) engineHashes[name] = hm[1];
    R.ok(hm && hm[1] === info.hash, `${tag} GEN_DSP_HASH ${hm && hm[1]} == fresh gen build ${info.hash}`);

    // ---- parameters
    const rows = paramRows(dev);
    const missing = dumpKeys.filter((k, i) => !rows[i]);
    R.ok(missing.length === 0, `${tag} every parameter has an obj-ctrl-<key> object${missing.length ? " (missing " + missing.join(", ") + ")" : ""}`);
    dump.forEach((d, i) => {
        const r = rows[i];
        if (!r) return;
        const bad = [];
        if (r.long !== d.long) bad.push(`long ${r.long} != ${d.long}`);
        if (r.short !== d.short) bad.push(`short ${r.short} != ${d.short}`);
        if (r.type !== d.type) bad.push(`type ${r.type} != ${d.type}`);
        if (d.enum) { if (JSON.stringify(r.enum) !== JSON.stringify(d.enum)) bad.push("enum differs"); if (r.max !== d.enum.length - 1) bad.push(`enum mmax ${r.max}`); }
        else {
            if (r.min !== d.min || r.max !== d.max) bad.push(`range ${r.min}..${r.max} != ${d.min}..${d.max}`);
            if (r.unit !== d.unit) bad.push(`unitstyle ${r.unit} != ${d.unit}`);
            if ((r.expo === undefined ? 1 : r.expo) !== d.expo) bad.push(`exponent ${r.expo} != ${d.expo}`);
        }
        if (d.key !== "midi_in" && r.init !== d.init) bad.push(`initial ${r.init} != ${d.init}`);
        if ((r.invisible || 0) !== d.invisible) bad.push(`invisible ${r.invisible} != ${d.invisible}`);
        if (r.enable !== 1) bad.push("parameter_enable != 1");
        R.ok(bad.length === 0, `${tag} parameter ${d.key} matches the build table${bad.length ? ": " + bad.join("; ") : ""}`);
    });
    const routeBox = dev.byId["obj-route-key"];
    R.ok(routeBox && routeBox.text === "route " + dumpKeys.join(" "), `${tag} obj-route-key lists the parameters in table order`);
    const seed = rows[dumpKeys.indexOf("seed")];
    R.ok(seed && seed.type === 0 && seed.unit === 0 && seed.max === 1000, `${tag} seed is parameter_type 0, unitstyle 0, range 0..1000`);
    const int255 = rows.filter((r) => r && r.type === 1 && r.max - r.min > 255);
    R.ok(int255.length === 0, `${tag} no parameter_type 1 range exceeds 255`);
    const shorts = rows.map((r) => r && r.short), longs = rows.map((r) => r && r.long);
    R.ok(new Set(shorts).size === shorts.length && new Set(longs).size === longs.length, `${tag} short and long names are unique`);
    const noHelp = [];
    boxes.forEach((b) => {
        if (!/^live\./.test(b.maxclass) || b.maxclass === "live.comment" || b.maxclass === "live.line") return;
        const vo = (b.saved_attribute_attributes || {}).valueof || {};
        const ann = b.annotation || "", info2 = vo.parameter_info || "";
        if (ann.length < 12 || (b.parameter_enable === 1 && info2.length < 12)) noHelp.push(b.id);
    });
    R.ok(noHelp.length === 0, `${tag} every live.* has a >= 12 char annotation and parameter_info${noHelp.length ? ": " + noHelp.join(", ") : ""}`);
    if (!refRows) { refRows = JSON.stringify(rows); refName = name; }
    else R.ok(JSON.stringify(rows) === refRows, `${tag} parameter table identical to ${refName}`);

    // ---- scripts
    let nScripts = 0;
    for (const b of boxes) {
        if (b.maxclass !== "v8ui") continue;
        const txt = b.textfile && b.textfile.text;
        if (typeof txt !== "string") { R.ok(false, `${tag} ${b.id}: v8ui has no embedded script`); continue; }
        nScripts++;
        let globals = [];
        try { globals = L.scanMaxGlobals(txt, b.id); } catch (e) { R.ok(false, `${tag} ${b.id}: script does not parse (${e.message})`); continue; }
        R.ok(globals.length === 0, `${tag} ${b.id} declares no Max globals${globals.length ? ": " + globals.map((g) => g.msg).join("; ") : ""}`);
        if (/\bmgraphics\./.test(txt) && (b.presentation === 1 || /function\s+paint\b/.test(txt))) R.ok(/mgraphics\.relative_coords\s*=\s*0\b/.test(txt), `${tag} ${b.id} sets mgraphics.relative_coords = 0`);
        for (const g of L.extractGenCode(txt)) {
            if (g.error) { R.ok(false, `${tag} ${b.id}/${g.label}: ${g.error}`); continue; }
            const lint = g.code ? L.lintGenExpr(g.code, `${b.id}/${g.label}`) : [];
            R.ok(lint.length === 0, `${tag} ${b.id}/${g.label} GenExpr lint clean${lint.length ? ": " + lint.slice(0, 3).map((x) => x.msg).join("; ") : ""}`);
        }
    }
    R.ok(nScripts === 1 + fi.canvases.length, `${tag} ${nScripts} v8ui scripts (engine + ${fi.canvases.length} canvas(es))`);
    // canvases of the device == the layout's canvases
    for (const c of fi.canvases) {
        const b = dev.byId[c.id];
        R.ok(b && b.maxclass === "v8ui", `${tag} canvas ${c.id} exists as v8ui`);
        if (b && c.presentation) R.ok(JSON.stringify(b.presentation_rect) === JSON.stringify(c.rect.map(Number)), `${tag} canvas ${c.id} presentation_rect == layout rect`);
        if (b && c.ignoreclick) R.ok(b.ignoreclick === 1, `${tag} canvas ${c.id} has ignoreclick 1`);
    }
    console.log(`  ${name}: ${boxes.length} boxes, ${dev.lines.length} cords, ${W}px, ${bufA.length} bytes`);
}

const hs = new Set(Object.values(engineHashes));
R.ok(hs.size <= 1, `GEN_DSP_HASH identical across builds (${[...hs].join(", ")})`);

// ---- committed devices vs a fresh build -------------------------------------------------------------------------------------------
for (const file of filesA) {
    const committed = path.join(T.ROOT, "devices", file);
    if (!fs.existsSync(committed)) { R.ok(false, `devices/${file} is missing (run python3 scripts/build_deviate.py)`); continue; }
    R.ok(Buffer.compare(fs.readFileSync(committed), rebuilt[file]) === 0, `devices/${file} byte-matches a rebuild (stale if it fails: run build_deviate.py)`);
}

R.done();
