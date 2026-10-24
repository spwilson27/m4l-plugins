// Comments come out and locals are renamed. Tokens round-trip, so the rename is not a rewrite.
const { execFileSync } = require("child_process");
const path = require("path");

const out = execFileSync("python3", [path.join(__dirname, "..", "scripts", "minify_gen.py"), "--check"], {
    encoding: "utf8",
});
if (!/minify gen ok/.test(out)) {
    console.error(out);
    process.exit(1);
}
console.log(out.trim());
