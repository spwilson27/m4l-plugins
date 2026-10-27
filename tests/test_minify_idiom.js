// Shared-lane red test (sweep2 shared F2): scripts/minify_gen.py must not glue a binary +/- between two
// number literals ("exp(0 - 1 / x)" -> "exp(0-1/x)"), which gen~ compiles to a silent gen (wave 1 spectral F2).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let fails = 0, checks = 0;
function check(c, m) { checks++; if (!c) { fails++; console.log("FAIL " + m); } }

function minify(srcs) {
  const py = "import sys,json; sys.path.insert(0, sys.argv[1]); import minify_gen as m; " +
    "print(json.dumps([m.minify_gen(s) for s in json.loads(sys.stdin.read())]))";
  const out = execFileSync("python3", ["-c", py, path.join(root, "scripts")], { input: JSON.stringify(srcs), maxBuffer: 1 << 28 });
  return JSON.parse(out.toString());
}
// literal zero, binary minus, number, division: the exact idiom that gen~ compiles to a silent gen ("exp(0-1/x)")
const bad = /(^|[^\w.])0(\.0*)?[-][0-9.]+[/]/;
function glued(s) { return bad.test(s); }
const cases = [
  "y = exp(0 - 1 / x);", "y = 0 - 1 / 3;", "y = 0.0 - 2.5 / x;", "y = exp(0 - 1 / clip(x, 1, 2));",
];
const outs = minify(cases);
check(minify(["y = a - 1 / b;"])[0].includes("a-1/b") || /=\w+-1\/\w+/.test(minify(["y = a - 1 / b;"])[0]), "ordinary subtraction stays minified");
cases.forEach((c, i) => check(!glued(outs[i]), "glued number-sign-number: " + JSON.stringify(c) + " -> " + JSON.stringify(outs[i])));
// the real cores
const files = fs.readdirSync(path.join(root, "src")).filter(f => f.endsWith(".genexpr"));
const texts = files.map(f => fs.readFileSync(path.join(root, "src", f), "utf8"));
let res;
try { res = minify(texts); } catch (e) { res = null; }
if (res) files.forEach((f, i) => check(!glued(res[i]), f + ": minified output has 0-<number>/ glued (" + (res[i].match(/.{12}[0-9.]*0-[0-9.]+[/].{6}/) || [""])[0] + ")"));
console.log(`test_minify_idiom: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
