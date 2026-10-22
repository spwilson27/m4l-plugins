#!/usr/bin/env node
/**
 * XO Sample Map: structural / layout checks for the default device and every layout variant.
 * Variants are the scripts/xo_layouts/<name>.py modules ("default", "A", "B", ...), built into
 * devices/XO Sample Map[ <name>].amxd with `python3 scripts/build_xo_map.py --all`.
 *
 *   node tests/test_xo_variants.js            all variants present
 *   node tests/test_xo_variants.js C          only variant C (the per-variant gate)
 *   node tests/test_xo_variants.js default
 *
 * Every variant must: expose the same parameter table as the default; lay out all 8 Saved / Filters /
 * Playback combinations without overlap or overflow; keep the toolbar (three icon toggles) visible; agree
 * with its own computeXoLayout (src/xo_layouts/<name>.js); keep varnames and XO_LAYOUT_NAMES consistent;
 * be 169 px high; end the box list with background panels; never overlap a live.* with an interactive v8ui.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.dirname(__dirname);
const allNames = ["default", ...fs.readdirSync(path.join(ROOT, "scripts", "xo_layouts"))
  .filter((f) => /\.py$/.test(f) && !f.startsWith("_") && f !== "default.py").map((f) => f.slice(0, -3)).sort()];
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : allNames;
for (const n of names) assert(allNames.includes(n), `unknown variant ${n} (have ${allNames.join(", ")})`);

const deviceFile = (name) => path.join(ROOT, "devices", name === "default" ? "XO Sample Map.amxd" : `XO Sample Map ${name}.amxd`);
const readDevice = (name) => {
  const raw = fs.readFileSync(deviceFile(name));
  assert.strictEqual(raw.slice(0, 8).toString("hex"), "616d706604000000", `[${name}] ampf header`);
  assert.strictEqual(raw.slice(8, 12).toString("ascii"), "aaaa", `[${name}] audio effect`);
  assert.strictEqual(32 + raw.readUInt32LE(28), raw.length, `[${name}] ptch length`);
  return JSON.parse(raw.slice(32).toString("utf8")).patcher;
};
const layoutModule = (name) => {
  const file = path.join(ROOT, "src", "xo_layouts", name + ".js");
  delete require.cache[require.resolve(file)];
  return require(file);
};

/** Parameter table: everything that must be identical across variants (presets / automation stay portable). */
function paramTable(p) {
  const rows = {};
  for (const { box } of p.boxes) {
    const vo = box.saved_attribute_attributes && box.saved_attribute_attributes.valueof;
    if (!vo || !vo.parameter_longname) continue;
    if (vo.parameter_invisible === 2 && /View$/.test(vo.parameter_longname)) continue;   // hidden Focus mirrors (default layout only)
    const keep = {};
    for (const k of Object.keys(vo).sort()) keep[k] = vo[k];
    rows[vo.parameter_longname] = { varname: box.varname, valueof: keep };
  }
  return { rows, order: Object.keys(p.parameters).filter((k) => !k.endsWith("-mir")), banks: p.parameters.parameterbanks };
}

const baseTable = paramTable(readDevice("default"));
const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const contains = (o, i) => i[0] >= o[0] && i[1] >= o[1] && i[0] + i[2] <= o[0] + o[2] && i[1] + i[3] <= o[1] + o[3];
const TOGGLES = ["obj-toggle-saved-btn", "obj-toggle-filters-btn", "obj-toggle-playback-btn"];
const { execFileSync } = require("child_process");

for (const name of names) {
  const tag = `[${name}]`;
  const p = readDevice(name);
  const lay = layoutModule(name);
  const boxMap = new Map();
  for (const { box } of p.boxes) {
    assert(!boxMap.has(box.id), `${tag} duplicate box id ${box.id}`);
    boxMap.set(box.id, box);
  }

  // The default device is THEMED (computeXoLayout(theme, saved, filters, playback, options), themes LCD / Focus); the
  // variant devices keep the three-argument layout.
  const themed = Array.isArray(lay.XO_THEMES);
  const callLayout = (cfg) => (themed ? lay.computeXoLayout(cfg.theme, cfg.s, cfg.f, cfg.p, cfg.o) : lay.computeXoLayout(cfg.s, cfg.f, cfg.p));
  /** every (theme x) section combination to check */
  const configs = [];
  for (const theme of (themed ? lay.XO_THEMES : [null])) for (let n = 0; n < (themed ? 16 : 8); n++) {
    configs.push({ theme, s: n & 1, f: (n >> 1) & 1, p: (n >> 2) & 1, o: (n >> 3) & 1 });
  }
  // Height, width, title.
  // saved / default state: the default device starts with Saved only; the variants keep all sections shown
  const all = callLayout(themed ? { theme: "LCD", s: 1, f: 0, p: 0, o: 0 } : { theme: null, s: 1, f: 1, p: 1, o: 0 });
  assert.strictEqual(p.devicewidth, all.deviceWidth, `${tag} devicewidth must equal the saved-state layout's deviceWidth`);
  assert.deepStrictEqual(p.openrect, [0, 0, all.deviceWidth, 169], `${tag} openrect (presentation height 169)`);
  assert.strictEqual(p.openinpresentation, 1, `${tag} openinpresentation`);
  assert.strictEqual(lay.XO_DEVICE_H, 169, `${tag} XO_DEVICE_H`);
  assert.strictEqual(p.title, name === "default" ? "XO Sample Map" : `XO Sample Map ${name}`, `${tag} title`);

  // Identical parameter set, long names, ranges, defaults, order.
  const table = paramTable(p);
  assert.deepStrictEqual(table.order, baseTable.order, `${tag} parameter order must equal the default's`);
  assert.deepStrictEqual(table.banks, baseTable.banks, `${tag} parameter banks must equal the default's`);
  assert.deepStrictEqual(Object.keys(table.rows), Object.keys(baseTable.rows), `${tag} parameter set must equal the default's`);
  for (const [long, row] of Object.entries(table.rows)) {
    // the default device starts with Filters and Playback closed (a new instance); the variants keep them shown
    const strip = (v) => (themed || !/^Show(Filters|Playback)Section$/.test(long)) ? v : Object.assign({}, v, { parameter_initial: baseTable.rows[long].valueof.parameter_initial });
    assert.deepStrictEqual(strip(row.valueof), baseTable.rows[long].valueof, `${tag} parameter ${long}: name / range / default / type must equal the default's`);
    assert.strictEqual(row.varname, baseTable.rows[long].varname, `${tag} parameter ${long}: varname`);
  }

  // Built presentation rects equal the variant's own all-shown layout; every laid-out box exists.
  for (const [id, spec] of Object.entries(all.boxes)) {
    assert(boxMap.has(id), `${tag} layout box ${id} missing from the device`);
    assert.deepStrictEqual(boxMap.get(id).presentation_rect, spec.rect, `${tag} built presentation_rect of ${id} must match the all-shown layout`);
    assert.strictEqual(boxMap.get(id).hidden || 0, spec.hidden, `${tag} built hidden flag of ${id} must match the saved-state layout`);
  }
  if (themed) {
    // The Python mirror (scripts/xo_layouts/default.py, used for the saved state) equals the JS layout for every combination.
    const py = JSON.parse(execFileSync("python3", ["-I", "-c", "import json,sys; sys.path.insert(0, 'scripts/xo_layouts'); import default; print(json.dumps(default.dump_layouts()))"], { cwd: ROOT, encoding: "utf8" }));
    for (const cfg of configs) {
      const key = `${cfg.theme}/${cfg.s}/${cfg.f}/${cfg.p}/${cfg.o}`;
      const js = callLayout(cfg);
      assert.strictEqual(py[key].width, js.deviceWidth, `${tag} python layout width (${key})`);
      assert.deepStrictEqual(Object.keys(py[key].boxes).sort(), Object.keys(js.boxes).sort(), `${tag} python layout ids (${key})`);
      for (const [id, spec] of Object.entries(js.boxes)) assert.deepStrictEqual(py[key].boxes[id], [spec.rect, spec.hidden], `${tag} python vs JS layout ${id} (${key})`);
    }
  }

  // Scripting names: unique varnames, XO_LAYOUT_NAMES matches them.
  const names_ = /var XO_LAYOUT_NAMES = (\{[^\n]*\});/.exec(boxMap.get("obj-minimap").textfile.text);
  assert(names_, `${tag} mini-map script must start with XO_LAYOUT_NAMES`);
  const layoutNames = JSON.parse(names_[1]);
  assert.deepStrictEqual(Object.keys(layoutNames).sort(), Object.keys(all.boxes).sort(), `${tag} XO_LAYOUT_NAMES ids must be the layout's ids`);
  const varnames = p.boxes.map((b) => b.box.varname).filter(Boolean);
  for (const [id, vn] of Object.entries(layoutNames)) {
    assert.strictEqual(boxMap.get(id).varname, vn, `${tag} XO_LAYOUT_NAMES[${id}] must equal the varname`);
    assert.strictEqual(varnames.filter((v) => v === vn).length, 1, `${tag} scripting name ${vn} must be unique`);
  }
  assert(boxMap.get("obj-minimap").textfile.text.includes(fs.readFileSync(path.join(ROOT, "src", "xo_layouts", name + ".js"), "utf8").split("\n")[0]), `${tag} mini-map script must embed src/xo_layouts/${name}.js`);

  // Background panels are last (node box included), all with background 1; no foreground box after the first.
  const firstBg = p.boxes.findIndex((b) => b.box.background === 1);
  assert(firstBg > 0, `${tag} background boxes expected`);
  for (const b of p.boxes.slice(firstBg)) assert.strictEqual(b.box.background, 1, `${tag} ${b.box.id} after the first background panel must have background 1`);
  for (const b of p.boxes) if (b.box.maxclass === "panel") assert.strictEqual(b.box.background, 1, `${tag} panel ${b.box.id} needs background 1`);

  // Section wiring: toggles exist, are icons, parameters unchanged, device width expression.
  const exprText = boxMap.get("obj-expr-width").text;
  const exprM = themed ? /^expr [-+*()\s$i0-9.]+$/.exec(exprText) : /^expr (\d+) \+ \$i1 \* (\d+) \+ \$i2 \* (\d+) \+ \$i3 \* (\d+)$/.exec(exprText);
  assert(exprM && !exprText.includes(","), `${tag} obj-expr-width must be 'expr base + $i1 * saved + $i2 * filters + $i3 * playback' (themed: plain arithmetic over $i1..$i5, no comma, saved filters playback options theme)`);
  const exprWidth = (cfg) => {
    if (themed) {
      const vals = [cfg.s, cfg.f, cfg.p, cfg.o, cfg.theme === "LCD" ? 0 : 1];
      return Function('"use strict"; return (' + exprText.replace(/^expr /, "").replace(/\$i(\d)/g, (m, d) => String(vals[Number(d) - 1])) + ");")();
    }
    const n = exprM.slice(1).map(Number);
    return n[0] + cfg.s * n[1] + cfg.f * n[2] + cfg.p * n[3];
  };
  for (const id of themed ? TOGGLES.concat(["obj-toggle-options-btn"]) : TOGGLES) {
    const b = boxMap.get(id);
    assert(b, `${tag} ${id} missing`);
    assert.strictEqual(b.maxclass, "live.text", `${tag} ${id}`);
    assert(b.annotation && b.annotation.length > 10, `${tag} ${id} needs a tooltip (annotation)`);
    if (b.presentation_rect[2] < 28) assert.strictEqual(b.usepicture, 1, `${tag} ${id}: compact toggles use icons, not text`);
  }

  // Interactive v8uis (no ignoreclick) must never overlap a live.* widget.
  const interactiveV8 = [...boxMap.values()].filter((b) => b.maxclass === "v8ui" && b.presentation === 1 && !b.ignoreclick);
  assert(interactiveV8.length >= 2, `${tag} expected the mini-map and folder list v8uis`);

  for (const cfg of configs) {
    const { s: sv, f: fv, p: pv } = cfg;
    const ctag = `${tag}[${cfg.theme ? cfg.theme + " " : ""}saved=${sv} filters=${fv} playback=${pv}${themed ? " options=" + cfg.o : ""}]`;
    const L = callLayout(cfg);
    const W = L.deviceWidth;
    assert.strictEqual(exprWidth(cfg), W, `${ctag} obj-expr-width must equal the layout's deviceWidth`);
    assert.deepStrictEqual(Object.keys(L.boxes).sort(), Object.keys(all.boxes).sort(), `${ctag} same ids in every combination`);

    const vis = Object.entries(L.boxes).filter(([, s]) => !s.hidden);
    for (const [id, s] of vis) {
      const r = s.rect;
      assert(r[0] >= 0 && r[1] >= 0 && r[0] + r[2] <= W + 1e-6 && r[1] + r[3] <= 169 + 1e-6, `${ctag} ${id} ${JSON.stringify(r)} must lie inside the ${W} x 169 device`);
    }
    // Toolbar: always visible.
    for (const id of themed ? TOGGLES.concat(["obj-toggle-options-btn"]) : TOGGLES) assert.strictEqual(L.boxes[id].hidden, 0, `${ctag} toolbar toggle ${id} must always be visible`);
    // Panels: visible background panels never partially overlap each other; every other visible box sits in a panel.
    const panels = vis.filter(([id]) => boxMap.get(id).maxclass === "panel").map(([id, s]) => [id, s.rect]);
    for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
      const [ia, ra] = panels[i], [ib, rb] = panels[j];
      if (overlap(ra, rb)) assert(contains(ra, rb) || contains(rb, ra), `${ctag} panels ${ia} and ${ib} overlap`);
    }
    for (const [id, s] of vis) {
      if (boxMap.get(id).maxclass === "panel") continue;
      assert(panels.some(([, pr]) => contains(pr, s.rect)), `${ctag} ${id} ${JSON.stringify(s.rect)} must sit inside a visible panel`);
    }
    // The map pane (the layout's own constants): fixed width (equal in every theme), Saved list adds its own width, fits the device height.
    const mm = L.boxes["obj-minimap"];
    assert.strictEqual(mm.hidden, 0, `${ctag} map must be visible`);
    assert.strictEqual(mm.rect[2], lay.XO_MAP_PANE_W + (sv ? lay.XO_SAVED_PANE_W : 0), `${ctag} map pane width must follow XO_MAP_PANE_W / XO_SAVED_PANE_W`);
    assert(mm.rect[3] >= 134 && mm.rect[1] + mm.rect[3] <= 169, `${ctag} map pane height ${mm.rect[3]}`);
    if (themed) assert.strictEqual(mm.rect[2], callLayout(Object.assign({}, cfg, { theme: cfg.theme === "LCD" ? "Focus" : "LCD" })).boxes["obj-minimap"].rect[2], `${ctag} map pane width is the same in both themes`);
    // No live.* overlapping an interactive v8ui (mini-map, folder list), among the visible boxes.
    for (const v of interactiveV8) {
      const vr = L.boxes[v.id] && !L.boxes[v.id].hidden ? L.boxes[v.id].rect : null;
      if (!vr) continue;
      for (const [id, s] of vis) {
        if (id !== v.id && /^live\./.test(boxMap.get(id).maxclass)) assert(!overlap(vr, s.rect), `${ctag} live.* ${id} overlaps interactive v8ui ${v.id}`);
      }
    }
  }
  console.log(`OK: variant ${name} (${p.devicewidth} x 169, ${Object.keys(table.rows).length} parameters, ${configs.length} layout combinations)`);
}
