"""Mangle GenExpr copied into a device.

``src/*.genexpr`` stays as written. Build scripts pass the finished gen text
through ``minify_gen`` when they embed it (``.gendsp`` codebox or ``gen.codebox~``).
Comments are removed. Function names, ``History`` / ``Data`` / ``Delay`` names,
function parameters and other locals are renamed. These names stay, because
they are the patcher's API or GenExpr's own words:

- ``Param`` and ``Buffer`` variable names (messages and ``loadbang`` binds)
- ``in1`` / ``out1`` / ``samplerate`` and the other gen builtins
- names after a dot (``line.read``) and named arguments (``interp="linear"``)
- anything spelled ``e`` plus digits (the lexer treats that as Euler's constant)

The transform is a rename plus comment stripping: ``--check`` un-renames every
``.genexpr`` and requires the tokens to match the original.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

KEYWORDS = {
    "if", "else", "for", "while", "do", "return", "break", "continue",
    "switch", "case", "default",
    "History", "Data", "Delay", "Buffer", "Param",
}

# Gen operators, constants, and spellings the codebox compiler will not accept as a
# user function. A call written with one of these names is the operator (``eq(x)``
# compares, ``ln(x)`` is log, ``or(x)`` is logical or) or fails to compile
# (``i``, ``f``, ``r``, ``s`` are left undeclared in the generated C++; ``e`` is
# Euler's constant). A local that already uses one of these spellings is left
# alone, so a builtin call cannot be renamed along with it.
BUILTINS = KEYWORDS | {
    "abs", "absdiff", "accum", "acos", "acosh", "add", "and", "asin", "asinh", "atan", "atan2", "atanh",
    "avg", "bool", "cartopol", "ceil", "change", "channels", "clamp", "clip", "codebox",
    "copysign", "cos", "cosh", "counter", "cycle", "data", "dbtoa", "dcblock", "delay", "delta",
    "degrees", "degtorad", "dim", "div", "dot", "drunk", "elapsed", "eq", "eqp", "exp", "exp2",
    "f", "fastcos", "fastexp", "fastlog", "fastpow", "fastsin", "fastsqrt", "fasttan", "fasttanh",
    "fftfullspect", "ffthop", "fftinfo", "fftoffset", "fftsize", "fixdenorm", "fixnan", "float",
    "floor", "fmod", "fold", "fract", "ftom", "gate", "gen", "group", "gt", "gte", "gtep", "gtp",
    "history", "hypot", "i", "in", "index", "inf", "int", "interp", "isdenorm", "isnan", "latch",
    "ln", "log", "log10", "log2", "lookup", "lt", "lte", "ltep", "ltp", "max", "maximum", "mean", "min",
    "minimum", "mix", "mod", "mstosamps", "mtof", "mul", "nearest", "neg", "neq", "neqp", "noise",
    "not", "or", "out", "param", "pass", "peek", "phasor", "phasewrap", "pi", "pinknoise", "poke",
    "poltocar", "pow", "qconj", "qmul", "qrot", "r", "radians", "radtodeg", "random", "rate",
    "rdiv", "read", "receive", "rect", "rmod", "round", "rsub", "s", "safediv", "safemod",
    "safepow", "sah", "sample", "samplerate", "sampstoms", "saw", "scale", "selector", "send",
    "sign", "sin", "sinh", "slide", "smoothstep", "splat", "spline", "sqrt", "sr", "step", "sub",
    "switch", "t60", "t60time", "tan", "tanh", "train", "triangle", "trunc", "twopi", "vec",
    "vectorsize", "voice", "voicecount", "wave", "wrap", "write", "xor", "zerox",
    "atodb", "blocksize", "boundmode", "buffer", "channelmode", "e", "false", "mc_channel",
    "mc_channelcount", "ms2samps", "samps2ms", "true",
}
BUILTINS |= {f"in{i}" for i in range(1, 65)}
BUILTINS |= {f"out{i}" for i in range(1, 65)}

# Fresh names are emitted as C++ identifiers. ``asm`` is a keyword, and a parameter
# renamed to it fails the gen compile ("invalid parameter name"). These are never
# chosen as a new name; a local the source already spelled this way is still renamed
# away from it, because it is not in BUILTINS.
CPP_KEYWORDS = {
    "alignas", "alignof", "and_eq", "asm", "auto", "bitand", "bitor", "char", "class", "compl",
    "concept", "const", "consteval", "constexpr", "constinit", "const_cast", "co_await", "co_return",
    "co_yield", "decltype", "delete", "double", "dynamic_cast", "enum", "explicit", "export", "extern",
    "friend", "goto", "inline", "long", "mutable", "namespace", "new", "noexcept", "not_eq", "nullptr",
    "operator", "or_eq", "private", "protected", "public", "register", "reinterpret_cast", "requires",
    "short", "signed", "sizeof", "static", "static_assert", "static_cast", "struct", "template", "this",
    "thread_local", "throw", "try", "typedef", "typeid", "typename", "union", "unsigned", "using",
    "virtual", "void", "volatile", "wchar_t", "xor_eq",
}

DECLS = ("History", "Data", "Delay", "Buffer", "Param")
ASSIGN_OPS = ("=", "+=", "-=", "*=", "/=")
_GLUE = {
    ("+", "+"), ("-", "-"), ("=", "="), ("!", "="), ("<", "="), (">", "="),
    ("<", "<"), (">", ">"), ("&", "&"), ("|", "|"), ("+", "="), ("-", "="),
    ("*", "="), ("/", "="), ("/", "/"), ("/", "*"),
}


def lex(src):
    """Split ``src`` into ``(kind, text)`` tokens. Kinds: comment, ws, string, number, ident, op."""
    i = 0
    n = len(src)
    out = []
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            if j < 0:
                j = n
            out.append(("comment", src[i:j]))
            i = j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            if j < 0:
                raise ValueError("unterminated block comment")
            out.append(("comment", src[i:j + 2]))
            i = j + 2
            continue
        if c == '"':
            j = i + 1
            while j < n:
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == '"':
                    j += 1
                    break
                j += 1
            else:
                raise ValueError("unterminated string")
            out.append(("string", src[i:j]))
            i = j
            continue
        if c.isdigit() or (c == "." and i + 1 < n and src[i + 1].isdigit()):
            m = re.match(r"(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?", src[i:])
            out.append(("number", m.group(0)))
            i += m.end()
            continue
        if c.isalpha() or c == "_":
            j = i + 1
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            word = src[i:j]
            if re.fullmatch(r"e\d+", word):
                raise ValueError(f"identifier {word} is lexed as Euler's constant by GenExpr")
            out.append(("ident", word))
            i = j
            continue
        if c in " \t\r\n":
            j = i + 1
            while j < n and src[j] in " \t\r\n":
                j += 1
            out.append(("ws", src[i:j]))
            i = j
            continue
        two = src[i:i + 2]
        if two in ("==", "!=", "<=", ">=", "&&", "||", "<<", ">>", "++", "--", "+=", "-=", "*=", "/="):
            out.append(("op", two))
            i += 2
            continue
        out.append(("op", c))
        i += 1
    return out


def _skip(toks, i):
    while i < len(toks) and toks[i][0] in ("ws", "comment"):
        i += 1
    return i


def _match_paren(toks, open_at):
    depth = 0
    for i in range(open_at, len(toks)):
        text = toks[i][1]
        if text == "(":
            depth += 1
        elif text == ")":
            depth -= 1
            if depth == 0:
                return i
    raise ValueError("unbalanced '('")


def _params(toks, start, end):
    """Identifiers at the top level of a function parameter list."""
    depth = 0
    names = []
    for i in range(start, end):
        kind, text = toks[i]
        if text == "(":
            depth += 1
        elif text == ")":
            depth -= 1
        elif depth == 0 and kind == "ident" and text not in KEYWORDS:
            names.append(text)
    return names


def rename_map(src):
    """Return ``old -> new`` for locals in ``src``. Param and Buffer names are absent."""
    toks = lex(src)
    keep = set(BUILTINS)
    declared = []
    seen = set()

    def add(name):
        if name in keep or name in seen:
            return
        seen.add(name)
        declared.append(name)

    for i, (kind, text) in enumerate(toks):
        if kind == "ident" and text in ("Param", "Buffer"):
            j = _skip(toks, i + 1)
            if j < len(toks) and toks[j][0] == "ident":
                keep.add(toks[j][1])

    for i, (kind, text) in enumerate(toks):
        if kind != "ident":
            continue
        j = _skip(toks, i + 1)
        if text in DECLS and j < len(toks) and toks[j][0] == "ident":
            if text not in ("Param", "Buffer"):
                add(toks[j][1])
            continue
        if text in KEYWORDS:
            continue
        if j < len(toks) and toks[j][1] == "(":
            close = _match_paren(toks, j)
            nxt = _skip(toks, close + 1)
            if nxt < len(toks) and toks[nxt][1] == "{":
                add(text)
                for name in _params(toks, j + 1, close):
                    add(name)
            continue
        if j < len(toks) and toks[j][0] == "op" and toks[j][1] in ASSIGN_OPS:
            add(text)
    occupied = {text for kind, text in toks if kind == "ident"}
    return _assign(declared, keep, occupied)


def _assign(names, keep, occupied):
    # Fresh names must not be any spelling already in the file. Otherwise a local
    # renamed to ``in`` is indistinguishable from the identifier ``in`` that was left as-is.
    used = set(keep) | set(occupied)
    mapping = {}
    n = 0
    alphabet = "abcdefghijklmnopqrstuvwxyz"
    for name in names:
        while True:
            letters = []
            k = n
            n += 1
            while True:
                letters.append(alphabet[k % 26])
                k = k // 26 - 1
                if k < 0:
                    break
            fresh = "".join(reversed(letters))
            if fresh in used or fresh in CPP_KEYWORDS or re.fullmatch(r"e\d+", fresh):
                continue
            used.add(fresh)
            mapping[name] = fresh
            break
    return mapping


# Gen's lexer takes the longest operator, and the pass comparisons are ``<p`` ``>p``
# ``<=p`` ``>=p`` ``==p`` ``!=p``. ``x<=pp`` would be ``<=p`` plus leftover ``p``,
# so an identifier that starts with ``p`` keeps a space after those operators.
_PASS_OPS = ("<", ">", "<=", ">=", "==", "!=")


def _needs_space(prev, nxt):
    if not prev or prev[-1] in " \n\t":
        return False
    if prev in _PASS_OPS and nxt.startswith("p"):
        return True
    a, b = prev[-1], nxt[0]
    if (a.isalnum() or a == "_") and (b.isalnum() or b == "_"):
        return True
    return (a, b) in _GLUE


def minify_gen(src):
    """Return ``src`` with comments removed and locals renamed."""
    if not src or not src.strip():
        return src
    toks = lex(src)
    mapping = rename_map(src)
    parts = []
    prev = ""
    i = 0
    while i < len(toks):
        kind, text = toks[i]
        if kind == "comment":
            i += 1
            continue
        if kind == "ws":
            if "\n" in text and prev and not prev.endswith("\n"):
                parts.append("\n")
                prev = "\n"
            i += 1
            continue
        if kind == "ident" and text in mapping and _rename_here(toks, i):
            text = mapping[text]
        if parts and _needs_space(prev, text):
            parts.append(" ")
            prev += " "
        parts.append(text)
        prev = text
        i += 1
    out = "".join(parts)
    if src.endswith("\n") and not out.endswith("\n"):
        out += "\n"
    return out


def _rename_here(toks, i):
    """A name after ``.`` is a method (``line.read``), not a local."""
    j = i - 1
    while j >= 0 and toks[j][0] in ("ws", "comment"):
        j -= 1
    return not (j >= 0 and toks[j][1] == ".")


def _significant(src):
    return [(k, t) for k, t in lex(src) if k not in ("ws", "comment")]


def unmangle(src, mapping):
    inv = {v: k for k, v in mapping.items()}
    toks = lex(src)
    parts = []
    prev = ""
    for i, (kind, text) in enumerate(toks):
        if kind == "ws":
            if "\n" in text and prev and not prev.endswith("\n"):
                parts.append("\n")
                prev = "\n"
            continue
        if kind == "comment":
            continue
        if kind == "ident" and text in inv and _rename_here(toks, i):
            text = inv[text]
        if parts and _needs_space(prev, text):
            parts.append(" ")
            prev += " "
        parts.append(text)
        prev = text
    return "".join(parts)


def check_source(src, label):
    """Raise ``AssertionError`` when mangling ``src`` would change its tokens."""
    mapping = rename_map(src)
    mangled = minify_gen(src)
    if "//" in mangled or "/*" in mangled:
        # A comment marker inside a string is fine; one outside a string is not.
        outside = _significant(mangled)
        for kind, text in outside:
            if kind != "string" and ("//" in text or "/*" in text):
                raise AssertionError(f"{label}: comment survived in {text!r}")
    for kind, text in _significant(mangled):
        if kind == "ident" and re.fullmatch(r"e\d+", text):
            raise AssertionError(f"{label}: mangled name {text} collides with Euler's constant")
    bad = sorted(set(mapping.values()) & CPP_KEYWORDS)
    if bad:
        raise AssertionError(f"{label}: mangled name {bad[0]} is a C++ keyword")
    for old in mapping:
        if old in BUILTINS:
            raise AssertionError(f"{label}: builtin {old} was renamed")
    back = unmangle(mangled, mapping)
    if _significant(src) != _significant(back):
        a = _significant(src)
        b = _significant(back)
        for n, (x, y) in enumerate(zip(a, b)):
            if x != y:
                raise AssertionError(f"{label}: token {n} {x} != {y}")
        raise AssertionError(f"{label}: token count {len(a)} != {len(b)}")
    kept = set()
    toks = lex(src)
    for i, (kind, text) in enumerate(toks):
        if kind == "ident" and text in ("Param", "Buffer"):
            j = _skip(toks, i + 1)
            if j < len(toks) and toks[j][0] == "ident":
                kept.add(toks[j][1])
    mangled_idents = {t for k, t in _significant(mangled) if k == "ident"}
    missing = sorted(name for name in kept if name not in mangled_idents)
    if missing:
        raise AssertionError(f"{label}: Param/Buffer names dropped: {missing[:8]}")
    survived = sorted(name for name in mapping if name in mangled_idents)
    if survived:
        raise AssertionError(f"{label}: renamed names still present: {survived[:8]}")
    return mapping


def check_tree(root=None):
    root = Path(root) if root else ROOT
    paths = sorted(list((root / "src").glob("*.genexpr")) + list((root / "tests").rglob("*.genexpr")))
    if not paths:
        raise SystemExit("no genexpr files")
    for path in paths:
        check_source(path.read_text(encoding="utf-8"), str(path.relative_to(root)))
    return paths


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--check":
        found = check_tree()
        print(f"minify gen ok ({len(found)} files)")
    else:
        sys.stdout.write(minify_gen(sys.stdin.read()))
