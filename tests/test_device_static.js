"use strict";
/**
 * Generic static checks of AGENTS.md section 1 over EVERY built devices/*.amxd (host only, no Max / Live).
 *
 *   node tests/test_device_static.js [--no-allow] [--device "Name.amxd" ...] [--verbose]
 *
 * Rules (rule id -> check):
 *   header            32-byte header / 'ptch' / length (section 2)
 *   height            presentation height 169 (openrect[3]) and openinpresentation 1
 *   panel-background  presentation `panel` boxes carry background 1
 *   panel-order       background panels are the LAST boxes (after every non-panel box)
 *   overlap           visible live.* interactive widget overlapping a visible v8ui/jsui presentation_rect, unless the v8ui has
 *                     ignoreclick 1 AND the widget is later in `boxes`; a live.drop / dropfile with ignoreclick 1 is exempt
 *   presentation-bounds  visible presentation box outside 0..devicewidth x 0..169
 *   int-range         parameter_type 1 (Int) with range > 255
 *   param-names       duplicate parameter_shortname / parameter_longname among parameter-enabled objects
 *   instance-name     buffer~ / send / receive names: literal `#0` (Live does not expand it in a top-level patcher) or
 *                     no per-instance `---` prefix
 *   relative-coords   a v8ui script using mgraphics must set mgraphics.relative_coords = 0
 *   js-max-global     v8ui script declares/assigns box, patcher, max, messagename, inlet, jsarguments
 *   gen-*             GenExpr lint (tests/lint_lib.js) of every codebox `code`, including .gendsp text embedded in v8ui scripts
 *
 * Exit status 1 when a violation is not covered by tests/device_static_allow.json ({device: {rule: reason}}, device
 * "*" = all). Allowlisted hits are printed with their reason.
 */
const fs = require("fs");
const path = require("path");
const L = require("./lint_lib.js");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const useAllow = !args.includes("--no-allow");
const only = args.flatMap((a, i) => (args[i - 1] === "--device" ? [a] : []));

const INTERACTIVE = new Set(["live.dial", "live.numbox", "live.text", "live.tab", "live.menu", "live.slider", "live.toggle",
    "live.button", "live.drop", "live.gain~", "live.step", "live.grid", "live.arrows", "live.meter~", "live.scope~", "textedit", "dropfile", "number", "flonum", "umenu"]);
const CANVAS = new Set(["v8ui", "jsui"]);

function checkDevice(file) {
    const v = []; // {rule, msg}
    const add = (rule, msg) => v.push({ rule, msg });
    const buf = fs.readFileSync(path.join(ROOT, "devices", file));
    let amxd;
    try { amxd = L.readAmxd(buf); } catch (e) { add("header", String(e.message)); return v; }
    amxd.errs.forEach((m) => add("header", m));
    const p = amxd.patcher;
    const boxes = p.boxes.map((b) => b.box);

    // ---- height / openrect
    if (!p.openrect || p.openrect[3] !== 169) add("height", `openrect height ${p.openrect && p.openrect[3]} != 169`);
    if (p.openinpresentation !== 1) add("height", `openinpresentation ${p.openinpresentation} != 1`);
    if (p.openrect && p.devicewidth && Math.abs(p.openrect[2] - p.devicewidth) > 0.5) add("height", `openrect width ${p.openrect[2]} != devicewidth ${p.devicewidth}`);

    // ---- panels
    const isPanel = (b) => b.maxclass === "panel";
    boxes.forEach((b, i) => { if (isPanel(b) && b.presentation === 1 && b.background !== 1) add("panel-background", `${b.id}: presentation panel without background 1`); });
    const firstPanel = boxes.findIndex((b) => isPanel(b) && b.background === 1);
    if (firstPanel >= 0) {
        // any box with background 1 counts as background (XO's node.codebox sits among them by design)
        const late = boxes.filter((b, i) => i > firstPanel && b.background !== 1).map((b) => b.id);
        if (late.length) add("panel-order", `background panel ${boxes[firstPanel].id} is followed by ${late.length} non-background-panel box(es): ${late.slice(0, 4).join(", ")}${late.length > 4 ? ", ..." : ""}`);
    }

    // ---- overlap + bounds (visible, presentation boxes only; hidden boxes are parked and unhidden at runtime by layout code)
    const vis = (b) => b.presentation === 1 && !b.hidden && b.presentation_rect;
    const rect = (b) => b.presentation_rect;
    const inter = (a, b) => { const x = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const y = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return x > 0.5 && y > 0.5; };
    boxes.forEach((b, i) => {
        if (!vis(b)) return;
        const r = rect(b);
        if (b.maxclass !== "panel" && (r[1] + r[3] > 169.5 || r[0] < -0.5 || r[1] < -0.5 || (p.devicewidth && r[0] + r[2] > p.devicewidth + 0.5)))
            add("presentation-bounds", `${b.id} (${b.maxclass}) presentation_rect [${r.map((x) => +x.toFixed(1))}] leaves ${p.devicewidth || "?"}x169`);
        if (!INTERACTIVE.has(b.maxclass) || (b.ignoreclick === 1)) return;
        boxes.forEach((c, j) => {
            if (!CANVAS.has(c.maxclass) || !vis(c) || !inter(r, rect(c))) return;
            if (c.ignoreclick === 1 && i > j) return; // documented exception: ignoreclick face, widget in front
            add("overlap", `${b.id} (${b.maxclass}) overlaps ${c.id} (${c.maxclass}${c.ignoreclick === 1 ? ", ignoreclick but " + b.id + " is behind it" : ""})`);
        });
    });

    // ---- parameters
    const short = new Map(), long = new Map();
    const walkParams = (pp) => {
        for (const { box: b } of pp.boxes) {
            const vo = b.saved_attribute_attributes && b.saved_attribute_attributes.valueof;
            if (b.parameter_enable === 1 && vo) {
                const ty = vo.parameter_type, mn = vo.parameter_mmin, mx = vo.parameter_mmax;
                if (ty === 1 && typeof mn === "number" && typeof mx === "number" && mx - mn > 255) add("int-range", `${b.id}: Int parameter (type 1) range ${mn}..${mx} > 255; use parameter_type 0 + parameter_unitstyle 0`);
                const sn = vo.parameter_shortname, ln = vo.parameter_longname;
                if (sn !== undefined) { if (short.has(sn)) add("param-names", `duplicate shortname '${sn}' (${short.get(sn)}, ${b.id})`); else short.set(sn, b.id); }
                if (ln !== undefined) { if (long.has(ln)) add("param-names", `duplicate longname '${ln}' (${long.get(ln)}, ${b.id})`); else long.set(ln, b.id); }
                if (sn === undefined && ln === undefined && b.maxclass.startsWith("live.")) add("param-names", `${b.id} (${b.maxclass}) is a parameter without short/long name`);
            }
            if (b.patcher) walkParams(b.patcher);
        }
    };
    walkParams(p);

    // ---- per-instance naming of buffers / sends / receives
    const walkNames = (pp, depth) => {
        for (const { box: b } of pp.boxes) {
            const t = (b.text || "").trim();
            const tok = t.split(/\s+/);
            if (b.maxclass === "newobj" && /^(buffer~|s|send|r|receive|send~|receive~|forward|throw~|catch~)$/.test(tok[0]) && tok[1]) {
                const name = tok[1];
                if (name.includes("#0")) add("instance-name", `${b.id}: '${t}' uses #0, which Live does not expand in a top-level device patcher (use ---)`);
                else if (!name.startsWith("---")) add("instance-name", `${b.id}: '${t}' has no per-instance --- prefix (shared by every instance in the Set)`);
            }
            if (b.patcher) walkNames(b.patcher, depth + 1);
        }
    };
    walkNames(p, 0);

    // ---- scripts: v8ui (textfile.text) and gen code
    const scan = (pp) => {
        for (const { box: b } of pp.boxes) {
            if (b.maxclass === "v8ui" || b.maxclass === "jsui") {
                const txt = b.textfile && b.textfile.text;
                if (typeof txt === "string") {
                    const lab = `${b.id}`;
                    if (/\bmgraphics\./.test(txt) && (b.presentation === 1 || /\bfunction\s+paint\b/.test(txt)) && !/relative_coords\s*=\s*0\b/.test(txt)) add("relative-coords", `${lab}: uses mgraphics but never sets mgraphics.relative_coords = 0`);
                    try { L.scanMaxGlobals(txt, lab).forEach((x) => v.push(x)); } catch (e) { add("js-max-global", `${lab}: script does not parse (${e.message})`); }
                    for (const g of L.extractGenCode(txt)) {
                        if (g.error) add("gen-parse", `${lab}/${g.label}: ${g.error}`);
                        else if (g.code) L.lintGenExpr(g.code, `${lab}/${g.label}`).forEach((x) => v.push(x));
                    }
                } else if (!b.filename || b.filename === "none") add("relative-coords", `${b.id}: v8ui without embedded script text`);
            }
            if (typeof b.code === "string" && /gen/.test(b.maxclass)) L.lintGenExpr(b.code, b.id).forEach((x) => v.push(x));
            if (b.patcher) scan(b.patcher);
        }
    };
    scan(p);
    return v;
}

// ------------------------------------------------------------------------------------------------------------------- main
const allow = useAllow && fs.existsSync(path.join(__dirname, "device_static_allow.json"))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, "device_static_allow.json"), "utf8")) : {};
// allow[device][rule] = "reason"  or  {reason, match: [regex source, ...]} (only messages matching one are allowed)
const reasonFor = (file, rule, msg) => {
    for (const k of [file, file.replace(/\.amxd$/, ""), "*"]) {
        const e = allow[k] && allow[k][rule];
        if (!e) continue;
        if (typeof e === "string") return e;
        if (msg === undefined || (e.match || []).some((re) => new RegExp(re).test(msg))) return e.reason;
    }
    return null;
};

const t0 = Date.now();
const files = fs.readdirSync(path.join(ROOT, "devices")).filter((n) => n.endsWith(".amxd") && (!only.length || only.includes(n))).sort();
let failing = 0, allowed = 0;
for (const f of files) {
    const v = checkDevice(f);
    const real = [], ok = [];
    for (const x of v) (reasonFor(f, x.rule, x.msg) ? ok : real).push(x);
    failing += real.length; allowed += ok.length;
    console.log(`${real.length ? "FAIL" : "ok  "} ${f}  (${real.length} violation(s)${ok.length ? `, ${ok.length} allowlisted` : ""})`);
    const group = (list, tag) => {
        const by = {};
        for (const x of list) (by[x.rule] = by[x.rule] || []).push(x.msg);
        for (const r of Object.keys(by)) {
            const shown = verbose ? by[r] : by[r].slice(0, 6);
            console.log(`   [${r}]${tag ? " (allowlisted: " + reasonFor(f, r, list.find((x) => x.rule === r).msg) + ")" : ""} x${by[r].length}`);
            shown.forEach((m) => console.log(`      ${m}`));
            if (shown.length < by[r].length) console.log(`      ... ${by[r].length - shown.length} more (--verbose)`);
        }
    };
    group(real, false);
    if (verbose || !real.length) group(ok, true);
}
console.log(`\n${files.length} device(s), ${failing} violation(s), ${allowed} allowlisted, ${Date.now() - t0} ms`);
process.exit(failing ? 1 : 0);
