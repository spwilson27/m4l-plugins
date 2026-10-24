// Read a top-level `var NAME = <object or array>` out of a mangled device script.
// Terser reprints object keys without quotes, so the literal is JavaScript, not JSON.

function readJsLiteral(src, name) {
    const m = new RegExp("(?:var|let|const) " + name + "\\s*=\\s*").exec(src);
    if (!m) return null;
    const start = m.index + m[0].length;
    const open = src[start];
    if (open !== "{" && open !== "[") return null;
    const stack = [];
    let quote = null;
    for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quote) {
            if (c === "\\") { i += 1; continue; }
            if (c === quote) quote = null;
            continue;
        }
        if (c === "\"" || c === "'" || c === "`") { quote = c; continue; }
        if (c === "{" || c === "[") stack.push(c);
        else if (c === "}" || c === "]") {
            stack.pop();
            if (stack.length === 0) return Function("return (" + src.slice(start, i + 1) + ")")();
        }
    }
    return null;
}

module.exports = { readJsLiteral };
