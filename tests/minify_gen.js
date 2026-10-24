// Shared by device tests. The build mangles GenExpr as it embeds it; src/ stays readable.
const { execFileSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function minifyGen(src) {
    return execFileSync("python3", [path.join(ROOT, "scripts", "minify_gen.py")], {
        input: src,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
}

function builderGen(moduleName) {
    return execFileSync("python3", ["-c",
        `import sys; sys.path.insert(0, "scripts"); import ${moduleName} as b; sys.stdout.write(b.gen_code())`], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
}

module.exports = { minifyGen, builderGen };
