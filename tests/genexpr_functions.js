"use strict";
// Test helper: runs the plain FUNCTIONS of a GenExpr source in Node by transpiling them to JavaScript, so a device's
// gen code can be checked numerically against its Node mirror without Max. Only the function definitions are
// translated (top-level `name(args) {` ... `}` blocks); Buffer / Data / Param / History / Delay declarations and the
// per-sample statements are not. A `History x(v);` declared INSIDE a function becomes a persistent variable of that
// function. Data arguments are simulated by DataSim, which THROWS on an out-of-range peek / poke (Max would silently
// clamp or return 0, which hides indexing bugs).
//
// This catches typos, wrong indices and any mismatch with the mirror. It cannot catch GenExpr-only semantics
// (variable scope inside `if`, early `return`, dead-code elimination): those are covered by the lint in the tests.

class DataSim {
    constructor(size, chans) {
        this.size = size;
        this.chans = chans || 1;
        this.a = new Float64Array(size * this.chans);
    }

    peek(i, ch) {
        const c = ch === undefined ? 0 : ch;
        const k = Math.floor(i);
        if (!(k >= 0 && k < this.size) || !(c >= 0 && c < this.chans)) throw new Error(`Data peek out of range: ${i}, ${c} (size ${this.size} x ${this.chans})`);
        return this.a[c * this.size + k];
    }

    poke(v, i, ch) {
        const c = ch === undefined ? 0 : ch;
        const k = Math.floor(i);
        if (!(k >= 0 && k < this.size) || !(c >= 0 && c < this.chans)) throw new Error(`Data poke out of range: ${i}, ${c} (size ${this.size} x ${this.chans})`);
        if (!Number.isFinite(v)) throw new Error(`Data poke of a non-finite value at ${i}, ${c}`);
        this.a[c * this.size + k] = v;
        return v;
    }
}

function splitFunctions(src) {
    const lines = src.split("\n");
    const fns = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^([A-Za-z_]\w*)\(([^)]*)\) \{$/.exec(lines[i]);
        if (!m) continue;
        const body = [];
        let j = i + 1;
        while (j < lines.length && lines[j] !== "}") body.push(lines[j++]);
        fns.push({ name: m[1], params: m[2].split(",").map((s) => s.trim()).filter(Boolean), body });
        i = j;
    }
    return fns;
}

const BUILTINS = {
    sin: Math.sin, cos: Math.cos, exp: Math.exp, log: Math.log, sqrt: Math.sqrt, pow: Math.pow, floor: Math.floor,
    round: Math.round, abs: Math.abs, min: Math.min, max: Math.max, tanh: Math.tanh,
    clip: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
};

function transpile(fn) {
    const hist = [];
    let body = fn.body.filter((l) => {
        const m = /^\s*History\s+(\w+)\((.*)\);\s*$/.exec(l);
        if (m) {
            hist.push({ name: m[1], init: m[2] });
            return false;
        }
        return true;
    });
    let text = body.join("\n");
    const globals = [];
    for (const h of hist) {
        const g = `H_${fn.name}_${h.name}`;
        text = text.replace(new RegExp(`\\b${h.name}\\b`, "g"), g);
        globals.push(`var ${g} = ${h.init};`);
    }
    const noComments = text.replace(/\/\/.*$/gm, "");
    const vars = new Set();
    const re = /(?:^|[;{(,\s])([A-Za-z_]\w*)\s*([+\-*\/]?=)(?!=)/g;
    let m;
    while ((m = re.exec(noComments))) vars.add(m[1]);
    for (const p of fn.params) vars.delete(p);
    for (const h of hist) vars.delete(`H_${fn.name}_${h.name}`);
    const decl = vars.size ? `var ${Array.from(vars).join(", ")};\n` : "";
    return { globals, code: `function ${fn.name}(${fn.params.join(", ")}) {\n${decl}${text}\n}` };
}

// sources: GenExpr texts (library first). Returns an object with every function as a callable.
function load(...sources) {
    const parts = [];
    const names = [];
    for (const s of sources) {
        for (const fn of splitFunctions(s)) {
            const t = transpile(fn);
            parts.push(...t.globals, t.code);
            names.push(fn.name);
        }
    }
    const pre = Object.keys(BUILTINS).join(", ");
    const body = `${parts.join("\n")}\nreturn { ${names.join(", ")} };`;
    return new Function(...Object.keys(BUILTINS), body)(...Object.values(BUILTINS));
}

// Lint helper: the functions of a source with their bodies, to check "one return, at the end" and similar rules.
function functionsOf(src) {
    return splitFunctions(src);
}

module.exports = { DataSim, load, functionsOf };
