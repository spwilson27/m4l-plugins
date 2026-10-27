"use strict";
/**
 * Reusable static lints, factored from the per-device tests (test_cepstra / test_glitch / test_reverbplus /
 * test_delayplus). Pure functions of source text, no device knowledge. Used by tests/test_device_static.js.
 *
 *   lintGenExpr(src, label)  -> [{rule, msg}]     GenExpr (gen.codebox~ / .gendsp `code`) lint
 *   functionsOf(src)         -> [{name, params, body:[lines], depth info}]   (also works on the minified build output)
 *   scanMaxGlobals(jsText)   -> [{rule, msg}]     v8ui / js script declares or assigns a Max-provided global
 *   extractGenCode(jsText)   -> [{label, code}]   every embedded .gendsp string literal's codebox `code`
 *   readAmxd(buf)            -> {header, patcher}  parse per AGENTS section 2
 */

// ---------------------------------------------------------------------------------------------------------------- amxd
function readAmxd(buf) {
    const errs = [];
    if (buf.length < 32) throw new Error("file shorter than the 32-byte header");
    if (buf.slice(0, 4).toString("latin1") !== "ampf") errs.push("header does not start with 'ampf'");
    const type = buf.slice(8, 12).toString("latin1");
    if (!["aaaa", "mmmm", "iiii"].includes(type)) errs.push(`unknown device type 4CC '${type}'`);
    if (buf.slice(24, 28).toString("latin1") !== "ptch") errs.push("bytes 24..27 are not 'ptch'");
    const len = buf.readUInt32LE(28);
    if (len !== buf.length - 32) errs.push(`payload length ${len} != file size - 32 (${buf.length - 32})`);
    const text = buf.slice(32).toString("utf8");
    if (!text.endsWith("\n")) errs.push("JSON payload does not end with a newline");
    const json = JSON.parse(text);
    return { type, errs, patcher: json.patcher };
}

// ------------------------------------------------------------------------------------------------------------ GenExpr
const KEYWORDS = new Set(["if", "for", "while", "else", "switch", "return", "do"]);
const DECL_RE = /^(Buffer|Data|Param|History|Delay)\b/;

function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Function definitions (a `name(args) {` header at brace depth 0, possibly spread over several lines in the minified
 *  build output) with their line ranges. Works for pretty and minified output. */
function functionsOf(srcRaw) {
    const src = stripComments(srcRaw);
    const lines = src.split("\n");
    const fns = [];
    let depth = 0, i = 0;
    const parenBal = (t) => { let d = 0; for (const ch of t) { if (ch === "(") d++; else if (ch === ")") d--; } return d; };
    while (i < lines.length) {
        if (depth === 0) {
            const first = /^\s*([A-Za-z_]\w*)\s*\(/.exec(lines[i]);
            if (first && !KEYWORDS.has(first[1])) {
                let j = i, header = lines[i];
                while (parenBal(header) > 0 && j + 1 < lines.length && j - i < 400) header += lines[++j];
                const m = /^\s*([A-Za-z_]\w*)\s*\(([^()]*)\)\s*\{\s*$/.exec(header);
                if (m) {
                    const f = { name: m[1], params: m[2].split(",").map((x) => x.trim()).filter(Boolean), start: i, body: [] };
                    let d = 1;
                    let k = j + 1;
                    for (; k < lines.length && d > 0; k++) {
                        f.body.push({ text: lines[k], depth0: d });
                        for (const ch of lines[k]) { if (ch === "{") d++; else if (ch === "}") d--; }
                    }
                    f.end = k - 1;
                    fns.push(f);
                    i = k;
                    continue;
                }
            }
        }
        for (const ch of lines[i]) { if (ch === "{") depth++; else if (ch === "}") depth--; }
        i++;
    }
    return fns;
}

/** Balanced-paren argument text after `name(` starting at index of the '('. */
function balanced(code, openIdx) {
    let d = 0;
    for (let i = openIdx; i < code.length; i++) {
        if (code[i] === "(") d++;
        else if (code[i] === ")") { d--; if (d === 0) return code.slice(openIdx + 1, i); }
    }
    return code.slice(openIdx + 1);
}

function lintGenExpr(srcRaw, label) {
    const out = [];
    const bad = (rule, msg) => out.push({ rule, msg: `${label}: ${msg}` });
    const code = stripComments(srcRaw);
    const fns = functionsOf(srcRaw);
    const fnNames = new Set(fns.map((f) => f.name));

    // ---- identifiers GenExpr's lexer treats as constants / operators
    if (/\be\d+\b/.test(code)) bad("gen-reserved-name", `identifier e<digit> (lexed as Euler's constant): ${(/\be\d+\b/.exec(code) || [""])[0]}`);
    const declNames = [...code.matchAll(/(?:^|[;{}\s])(?:Buffer|Data|Param|History|Delay)\s+(\w+)/gm)].map((m) => m[1]);
    const paramNames = fns.flatMap((f) => f.params);
    for (const n of new Set([...declNames, ...paramNames])) {
        if (/^e\d+$/.test(n) || n === "phi" || n === "pi" || n === "twopi") bad("gen-reserved-name", `'${n}' is a GenExpr constant, never an identifier`);
        if (["noise", "rise", "fall", "bias", "mix", "hold"].includes(n) && declNames.includes(n)) bad("gen-reserved-name", `'${n}' as a Param / Data / History name shadows a GenExpr operator (AGENTS: never name a Param 'hold'; 'mix' shadows mix())`);
    }
    if (/(^|[^.\w])(?:phi|pi)\s*=[^=]/.test(code)) bad("gen-reserved-name", "assignment to phi / pi");
    if (/(^|[^.\w])delay\s*\(/.test(code)) bad("gen-delay-call", "uses delay(...): use `Delay d(size); d.write(); d.read()` (AGENTS section 1 item 8)");

    // ---- single return at function level, last statement
    for (const f of fns) {
        const rets = f.body.map((l, idx) => ({ l, idx })).filter((x) => /\breturn\b/.test(x.l.text));
        const nested = rets.filter((x) => x.l.depth0 > 1);
        if (nested.length) bad("gen-nested-return", `function ${f.name}: return inside a block (GenExpr falls through; last return wins): ${nested[0].l.text.trim().slice(0, 80)}`);
        const top = rets.filter((x) => x.l.depth0 === 1);
        if (top.length > 1) bad("gen-multi-return", `function ${f.name}: ${top.length} returns at function level`);
        if (top.length === 1) {
            const lastStmt = [...f.body].reverse().find((l) => l.text.trim() && l.text.trim() !== "}");
            if (lastStmt && !/\breturn\b/.test(lastStmt.text)) bad("gen-return-not-last", `function ${f.name}: return is not the last statement`);
        }
    }

    // ---- ordering: functions, then declarations, then statements
    const fnRanges = fns.map((f) => [f.start, f.end]);
    const inFn = (i) => fnRanges.some(([a, b]) => i >= a && i <= b);
    const lines = code.split("\n");
    let firstDecl = -1, lastFnEnd = -1, firstStmt = -1, lastDecl = -1;
    for (const f of fns) lastFnEnd = Math.max(lastFnEnd, f.end);
    for (let i = 0; i < lines.length; i++) {
        if (inFn(i)) continue;
        const t = lines[i].trim();
        if (!t || t === "}" || t === "{") continue;
        if (DECL_RE.test(t)) { if (firstDecl < 0) firstDecl = i; lastDecl = i; }
        else if (firstStmt < 0) firstStmt = i;
    }
    if (firstDecl >= 0 && fns.some((f) => f.start > firstDecl)) bad("gen-order", "a function is defined after the first Buffer / Data / Param / History / Delay declaration");
    if (firstStmt >= 0 && lastDecl > firstStmt) bad("gen-order", `a declaration (line ${lastDecl + 1}) comes after the first expression statement (line ${firstStmt + 1})`);
    if (firstStmt >= 0 && firstStmt < lastFnEnd) bad("gen-order", "an expression statement precedes a function definition");

    // ---- user function calls nested in poke() / in an if condition (compile to silence / mis-compile; reverbplus, spectral lib)
    if (fnNames.size) {
        const callRe = new RegExp("(?:^|[^.\\w])(" + [...fnNames].map((n) => n.replace(/[$]/g, "\\$")).join("|") + ")\\s*\\(");
        for (const m of code.matchAll(/(?:^|[^.\w])poke\s*\(/g)) {
            const args = balanced(code, m.index + m[0].length - 1);
            const c = callRe.exec(args);
            if (c) bad("gen-call-in-poke", `user function ${c[1]}() nested in poke(): ${args.slice(0, 60)}`);
        }
        for (const m of code.matchAll(/(?:^|[^.\w])if\s*\(/g)) {
            const args = balanced(code, m.index + m[0].length - 1);
            const c = callRe.exec(args);
            if (c) bad("gen-call-in-if", `user function ${c[1]}() in an if condition: ${args.slice(0, 60)}`);
        }
    }

    // ---- function-local variable named like a global Data / Buffer (silently breaks the compile; parameters are fine)
    const globals = new Set([...code.matchAll(/(?:^|[;{}\s])(?:Data|Buffer)\s+(\w+)/gm)].map((m) => m[1]));
    for (const f of fns) {
        const params = new Set(f.params);
        const body = f.body.map((l) => l.text).join("\n");
        const assigned = new Set([...body.matchAll(/(?:^|[;{(,\s])([A-Za-z_]\w*)\s*(?:[+\-*/]?=)(?!=)/g)].map((m) => m[1]));
        for (const a of assigned) if (globals.has(a) && !params.has(a)) bad("gen-local-shadows-data", `function ${f.name} assigns '${a}', which is also a global Data / Buffer`);
    }

    // ---- round(peek()) misbehaves (AGENTS sampler notes). wrap() with a non-constant upper bound is NOT linted: AGENTS 16 says it
    // fails codegen in one context, but shipped, tested cores (Delay+, Reverb+, Sampler, ...) use it widely and compile.
    if (/\bround\s*\(\s*(?:\w+\.)?peek\s*\(/.test(code)) bad("gen-round-peek", "round() of a Data peek returned wrong values in Max 9 (use floor(x + 0.5))");
    return out;
}
/** Every string literal in a v8ui script that holds a .gendsp patcher (deferred gen~ text): returns its codebox sources. */
function extractGenCode(js) {
    const out = [];
    let from = 0;
    for (;;) {
        const i = js.indexOf("\"{\\\"patcher\\\"", from);
        if (i < 0) break;
        let j = i + 1;
        while (j < js.length && js[j] !== "\"") j += js[j] === "\\" ? 2 : 1;
        from = j + 1;
        let gd;
        try { gd = JSON.parse(JSON.parse(js.slice(i, j + 1))); } catch (e) { out.push({ label: `gendsp@${i}`, error: String(e.message) }); continue; }
        const walk = (p, path) => {
            for (const { box } of p.boxes || []) {
                if (typeof box.code === "string") out.push({ label: `gendsp@${i}/${box.id}`, code: box.code });
                if (box.patcher) walk(box.patcher, path + box.id + "/");
            }
        };
        walk(gd.patcher, "");
        if (!out.some((o) => o.label.startsWith(`gendsp@${i}/`))) out.push({ label: `gendsp@${i}`, code: null });
    }
    return out;
}

// -------------------------------------------------------------------------------------------------- Max JS globals
const MAX_GLOBALS = ["box", "patcher", "max", "messagename", "inlet", "jsarguments"];

/**
 * AGENTS 1.8: never declare or assign Max's own v8ui / js globals. Parses with acorn (a dependency of terser; the installed
 * `typescript` 7 has no JS API) so function parameters and function-local variables of the same name (legal shadowing) are
 * not reported; reports (a) script-level var / let / const / function declarations, (b) assignments to a bare reserved
 * identifier that no enclosing function declares.
 */
function scanMaxGlobals(code, label) {
    const acorn = require("acorn");
    const out = [];
    const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", locations: true, allowReturnOutsideFunction: true });
    const reserved = new Set(MAX_GLOBALS);
    const patNames = (n, r) => {
        if (!n) return r;
        if (n.type === "Identifier") r.push(n.name);
        else if (n.type === "ObjectPattern") n.properties.forEach((p) => patNames(p.type === "RestElement" ? p.argument : p.value, r));
        else if (n.type === "ArrayPattern") n.elements.forEach((e) => patNames(e, r));
        else if (n.type === "AssignmentPattern") patNames(n.left, r);
        else if (n.type === "RestElement") patNames(n.argument, r);
        return r;
    };
    const isFn = (n) => n && (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression");
    const children = (n) => {
        const r = [];
        for (const k of Object.keys(n)) {
            if (k === "loc") continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach((x) => { if (x && typeof x.type === "string") r.push(x); });
            else if (v && typeof v.type === "string") r.push(v);
        }
        return r;
    };
    const locals = (fn) => {
        const s = new Set();
        fn.params.forEach((p) => patNames(p, []).forEach((x) => s.add(x)));
        if (fn.type === "FunctionExpression" && fn.id) s.add(fn.id.name);
        const visit = (n) => {
            if (isFn(n)) { if (n.type === "FunctionDeclaration" && n.id) s.add(n.id.name); return; }
            if (n.type === "VariableDeclarator") patNames(n.id, []).forEach((x) => s.add(x));
            if (n.type === "CatchClause" && n.param) patNames(n.param, []).forEach((x) => s.add(x));
            children(n).forEach(visit);
        };
        children(fn.body && fn.body.type ? fn.body : fn).forEach(visit);
        if (fn.body && fn.body.type !== "BlockStatement") visit(fn.body);
        return s;
    };
    const visit = (n, scopes) => {
        if (isFn(n)) {
            if (n.type === "FunctionDeclaration" && n.id && reserved.has(n.id.name) && scopes.length === 0)
                out.push({ rule: "js-max-global", msg: `${label}: script declares function ${n.id.name} (line ${n.loc.start.line})` });
            scopes = scopes.concat([locals(n)]);
        }
        if (n.type === "VariableDeclarator" && scopes.length === 0)
            for (const nm of patNames(n.id, [])) if (reserved.has(nm)) out.push({ rule: "js-max-global", msg: `${label}: script-level declaration of Max global '${nm}' (line ${n.loc.start.line})` });
        if (n.type === "AssignmentExpression" && n.left.type === "Identifier" && reserved.has(n.left.name) && !scopes.some((s) => s.has(n.left.name)))
            out.push({ rule: "js-max-global", msg: `${label}: assignment to Max global '${n.left.name}' (line ${n.loc.start.line})` });
        children(n).forEach((c) => visit(c, scopes));
    };
    visit(ast, []);
    return out;
}

module.exports = { readAmxd, stripComments, functionsOf, lintGenExpr, extractGenCode, scanMaxGlobals, MAX_GLOBALS };
