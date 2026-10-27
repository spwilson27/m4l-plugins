"use strict";
// Self-test of tests/lint_lib.js: each rule must fire on a bad sample and stay quiet on a good one.
const assert = require("assert");
const L = require("./lint_lib.js");
const rules = (src) => new Set(L.lintGenExpr(src, "t").map((x) => x.rule));
const GOOD = "f(a,b) {\n\tx = a + b;\n\treturn x;\n}\nData d(16);\nParam p(1);\nout1 = f(in1, p);\n";
assert.strictEqual(rules(GOOD).size, 0, [...rules(GOOD)].join());
assert(rules("f(a) {\n\tif (a > 0) {\n\t\treturn 1;\n\t}\n\treturn 0;\n}\nout1 = f(in1);").has("gen-nested-return"));
assert(rules("f(a) {\n\treturn a;\n\treturn 0;\n}\nout1 = f(in1);").has("gen-multi-return"));
assert(rules("out1 = in1 * e0;").has("gen-reserved-name"));
assert(rules("Param phi(1);\nout1 = in1;").has("gen-reserved-name"));
assert(rules("out1 = in1;\nf(a) {\n\treturn a;\n}\n").has("gen-order"));
assert(rules("Data d(4);\nf(a) {\n\treturn a;\n}\nout1 = in1;").has("gen-order"));
assert(rules("f(a) {\n\treturn a;\n}\nData d(4);\nout1 = in1;\nHistory h(0);").has("gen-order"));
assert(rules("f(a) {\n\treturn a;\n}\nData d(4);\npoke(d, f(in1), 0);").has("gen-call-in-poke"));
assert(rules("f(a) {\n\treturn a;\n}\nif (f(in1) > 0) {\n\tout1 = 1;\n}").has("gen-call-in-if"));
assert(rules("Data tab(4);\nf(a) {\n\ttab = a;\n\treturn a;\n}\nout1 = in1;").size >= 1);
assert(rules("Data tab(4);\nout1 = delay(in1, 4);").has("gen-delay-call"));
// multi-line (minified) headers
assert.strictEqual(L.functionsOf("zr(\naa,\nvq\n){\nreturn aa;\n}\nout1=zr(in1,in2);").length, 1);
const g = (c) => L.scanMaxGlobals(c, "t").length;
assert.strictEqual(g("var box = null;"), 1);
assert.strictEqual(g("function f(){ box = 1; }"), 1);
assert.strictEqual(g("function f(box){ box = 1; var patcher = 2; }"), 0);
assert.strictEqual(g("var o = { box: 1 }; o.box = 2; max.getcolor('a');"), 0);
assert.strictEqual(g("function inlet(){}"), 1);
console.log("lint_lib self-test ok");
