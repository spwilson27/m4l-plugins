"""Mangle the JavaScript copied into a device.

``src/`` stays as written. Build scripts call ``minify_patcher`` on the patcher
dict just before it is serialized, so only the embedded ``v8ui`` / ``node.codebox``
text is rewritten. Top-level names are kept: they are the messages the patcher
sends (``paint``, ``set_mix``, ``init_dsp``, …). Locals are mangled and comments
are removed.

GenExpr is mangled separately by ``minify_gen`` when a build embeds it. This
module only rewrites JavaScript.
"""

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

JS_CLASSES = {"v8ui", "v8", "v8.codebox", "js", "jsui", "node.codebox"}
CODE_CLASSES = {"node.codebox", "v8.codebox", "v8"}

_NODE = r"""
const { minify } = require("terser");
let src = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { src += c; });
process.stdin.on("end", () => {
  minify(src, {
    ecma: 2022,
    compress: false,
    mangle: { toplevel: false },
    format: { comments: false, ecma: 2022, quote_style: 3, max_line_len: 240 },
  }).then((r) => {
    if (r.error) { console.error(r.error); process.exit(1); }
    process.stdout.write(r.code || "");
  }).catch((e) => { console.error(e); process.exit(1); });
});
"""

_cache = {}


def minify_js(src):
    """Return ``src`` with comments removed and local names mangled."""
    if src in _cache:
        return _cache[src]
    if not src or not src.strip():
        _cache[src] = src
        return src
    proc = subprocess.run(
        ["node", "-e", _NODE],
        input=src.encode("utf-8"),
        capture_output=True,
        cwd=str(ROOT),
    )
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace")[:800]
        raise RuntimeError(f"minify of embedded script failed:\n{err}\n---\n{src[:240]}")
    out = proc.stdout.decode("utf-8")
    if not out.endswith("\n"):
        out += "\n"
    _cache[src] = out
    return out


def _walk(patcher):
    for entry in patcher.get("boxes") or []:
        box = entry.get("box") if isinstance(entry, dict) else None
        if not isinstance(box, dict):
            continue
        if box.get("maxclass") in JS_CLASSES:
            tf = box.get("textfile")
            if isinstance(tf, dict) and isinstance(tf.get("text"), str):
                tf["text"] = minify_js(tf["text"])
            if box.get("maxclass") in CODE_CLASSES and isinstance(box.get("code"), str):
                box["code"] = minify_js(box["code"])
        nested = box.get("patcher")
        if isinstance(nested, dict):
            _walk(nested)


def minify_patcher(doc):
    """Mangle embedded scripts in a patcher document, in place."""
    root = doc.get("patcher") if isinstance(doc, dict) else None
    if isinstance(root, dict):
        _walk(root)
    return doc


if __name__ == "__main__":
    import sys
    sys.stdout.write(minify_js(sys.stdin.read()))
