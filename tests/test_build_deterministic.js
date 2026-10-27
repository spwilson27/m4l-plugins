// Shared-lane red test (sweep2 shared F1b): committed device builds must be byte-deterministic.
// Reverb+ and Delay+ embed a wall-clock BUILD_STAMP, so two builds a second apart differ.
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync } = require("child_process");
const root = path.join(__dirname, "..");
let fails = 0, checks = 0;
function check(c, m) { checks++; if (!c) { fails++; console.log("FAIL " + m); } }
// static: no wall clock in any build script
for (const f of fs.readdirSync(path.join(root, "scripts")).filter(n => /^build_.*\.py$/.test(n))) {
  const s = fs.readFileSync(path.join(root, "scripts", f), "utf8");
  check(!/time\.(strftime|time|ctime)\(|datetime\.(now|utcnow)|uuid\.uuid/.test(s), f + ": uses the wall clock / random id in the build");
}
// dynamic: Reverb+ twice, 2 s apart
const a = fs.mkdtempSync(path.join(os.tmpdir(), "det_a_")), b = fs.mkdtempSync(path.join(os.tmpdir(), "det_b_"));
execFileSync("python3", [path.join(root, "scripts/build_reverbplus.py"), "--no-sets", "--out-dir", a], { cwd: root, stdio: "ignore" });
execFileSync("sleep", ["2"]);
execFileSync("python3", [path.join(root, "scripts/build_reverbplus.py"), "--no-sets", "--out-dir", b], { cwd: root, stdio: "ignore" });
for (const f of fs.readdirSync(a).filter(n => n.endsWith(".amxd")))
  check(fs.existsSync(path.join(b, f)) && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))), f + ": two builds differ");
console.log(`test_build_deterministic: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
