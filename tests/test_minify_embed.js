// The build mangles embedded scripts. src/ stays readable; locals in the device do not.
const { execFileSync } = require("child_process");
const path = require("path");
const assert = require("assert");

const src = `
// design note that must not ship
function paint() {
  var width = 12;
  var height = width + 3;
  mgraphics.rectangle(0, 0, width, height);
}
function set_mix(v) { curMix = v; }
var GEN_DSP_TEXT = "{\\"patcher\\":1}";
var GEN_DSP_HASH = "abc123abc123";
`;

const out = execFileSync("python3", [path.join(__dirname, "..", "scripts", "minify_embed.py")], {
  input: src,
  encoding: "utf8",
});

assert.ok(!out.includes("design note"), "comments are stripped");
assert.ok(out.includes("function paint"), "patcher entry points stay");
assert.ok(out.includes("function set_mix"), "message handlers stay");
assert.ok(!/\bwidth\b/.test(out) && !/\bheight\b/.test(out), "locals are mangled");
assert.ok(out.includes("mgraphics.rectangle"), "Max globals stay");
assert.ok(/var GEN_DSP_TEXT\s*=\s*"\{\\"patcher\\":1\}"/.test(out), "embedded gen string stays a string");
assert.ok(/var GEN_DSP_HASH\s*=\s*"abc123abc123"/.test(out));
console.log("minify embed ok");
