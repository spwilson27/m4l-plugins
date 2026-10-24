"""Shared pieces of the Glitch build: the gen source assembler used by build_glitch.py and run_glitch_audio_tests.py.

The layout (parameter indices, scope offsets) lives in src/glitch_config.js; this module asks Node for it (host only: the VM
has no node, so the audio runner reads the layout JSON that build_glitch.py writes to tests/out/glitch_layout.json)."""

import json
import os
import re
import subprocess

from minify_gen import minify_gen

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB_PATH = os.path.join(ROOT_DIR, "src", "cepstrum_lib.genexpr")
CORE_PATH = os.path.join(ROOT_DIR, "src", "glitch_core.genexpr")
CONFIG_PATH = os.path.join(ROOT_DIR, "src", "glitch_config.js")
LAYOUT_CACHE = os.path.join(ROOT_DIR, "tests", "out", "glitch_layout.json")

_DUMP = r"""
const g = require(process.argv[1]);
const L = g.glitchLayout();
const base = {};
for (const i of L.instances) base[i.id] = i.base;
console.log(JSON.stringify({ np: L.np, weightsOffset: L.weightsOffset, seqOffset: L.seqOffset, metaOffset: L.metaOffset, defsOffset: L.defsOffset, wbOffset: L.wbOffset, ninst: L.ninst, constants: g.glitchEngineConstants(), base, meta: g.glitchMeta(), scope: g.GL_SCOPE, index: L.index,
  bands: g.GL_BANDS,
  latency: g.GL_LATENCY, slotsBufSamps: g.GL_SLOTS_BUF_SAMPS, scopeSamps: g.GL_SCOPE_SAMPS, nslot: g.GL_NSLOT,
  order: L.instances.map((i) => i.id), params: g.GL_PARAMS, paramKeys: g.GL_PARAM_KEYS,
  mvDivBeats: g.GL_MV_DIV_BEATS, minsOffset: L.minsOffset, maxsOffset: L.maxsOffset, mvBase: L.mvBase, mvN: L.mvN, mv: L.mv,
  stages: g.glitchStages(), scopeStageFrame: g.GL_SCOPE.STAGE_FRAME, ctl: g.glitchCtlLayout(),
  face: g.glitchFaceLayout(g.defaultUi()),
  faces: { editor: g.glitchFaceLayout({ editor: 1, slots: 1 }), seq: g.glitchFaceLayout({ seq: 1, slots: 1 }), options: g.glitchFaceLayout({ options: 1, slots: 1 }), motion: g.glitchFaceLayout({ editor: 1, slots: 1, edTab: 1 }), many: g.glitchFaceLayout({ slots: 1 }), many2: g.glitchFaceLayout({ slots: 1 }),
    new: g.glitchFaceLayout({ slots: 1 }), specedit: g.glitchFaceLayout({ editor: 1, slots: 1 }), options2: g.glitchFaceLayout({ options: 1, slots: 1 }) } }));
"""


def load_layout():
    """Layout dict. Runs Node when available (and refreshes the cache); otherwise reads the cached JSON."""
    try:
        out = subprocess.run(["node", "-e", _DUMP, CONFIG_PATH], check=True, capture_output=True, text=True).stdout
        data = json.loads(out)
        os.makedirs(os.path.dirname(LAYOUT_CACHE), exist_ok=True)
        with open(LAYOUT_CACHE, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return data
    except (FileNotFoundError, subprocess.CalledProcessError):
        with open(LAYOUT_CACHE, "r", encoding="utf-8") as f:
            return json.load(f)


def _fmt(v):
    return repr(float(v)) if isinstance(v, float) and not float(v).is_integer() else str(int(v))


def raw_stage(layout):
    """The stage the raw (directive-commented) text is substituted for: the node twin in tests/test_glitch.js uses the same values."""
    return {"id": "raw", "index": 0, "role": "raw", "k0": 0, "k1": layout["ninst"], "plo": 0, "phi": layout["mvBase"], "mlo": layout["mvBase"],
            "mhi": layout["np"], "insts": list(layout["order"]), "ins": ["L", "R", "tk", "bi", "bf", "quiet"], "outs": ["L", "R"]}


def stage_flags(st):
    r = st["role"]
    f = set()
    if r == "head":
        f.add("head")
    elif r in ("group", "spec"):
        f.add("modg")
        f.add("spec" if r == "spec" else "grp")
    elif r == "tail":
        f.add("tail")
    if r != "tail":
        f.add("notail")
    return f


def tokens(layout, st=None):
    t = {
        "NP": layout["np"],
        "WOFF": layout["weightsOffset"],
        "SVSIZE": layout["np"] * layout["nslot"],
        "SQOFF": layout["seqOffset"],
        "METAOFF": layout["metaOffset"],
        "DEFOFF": layout["defsOffset"],
        "WBOFF": layout["wbOffset"],
        "NINST": layout["ninst"],
        "MINOFF": layout["minsOffset"],
        "MAXOFF": layout["maxsOffset"],
        "MVBASE": layout["mvBase"],
        "MVN": layout["mvN"],
        "MSTN": 8 * layout["ninst"],
        "MTN": 4 * layout["ninst"],
    }
    for k, v in layout["mv"].items():
        t["MV_" + k.upper()] = v
    for k, v in layout["base"].items():
        t[f"B_{k}"] = v
    for pos, iid in enumerate(layout["order"]):
        t[f"P_{iid}"] = pos
    for key, idx in layout["index"].items():
        t["I_" + key.replace(".", "_")] = idx
    for k, v in layout["scope"].items():
        t[f"SC_{k}"] = v
    st = st or raw_stage(layout)
    ins = st["ins"]
    ix = lambda name: "in%d" % (ins.index(name) + 1) if name in ins else "in1"
    t.update({"K0": st["k0"], "K1": st["k1"], "PLO": st["plo"], "PHI": st["phi"], "MLO": st["mlo"], "MHI": st["mhi"]})
    t["PVN"] = layout["np"] if st["role"] in ("head", "raw") else layout["mvBase"]
    t["RINGOFF"] = layout["ctl"]["ringOffset"]
    t["CTLSLOTS"] = layout["ctl"]["slots"]
    t["CTLSTRIDE"] = layout["ctl"]["stride"]
    t["TKIN"] = ix("tk")[2:]
    t["BIIN"] = ix("bi")[2:]
    t["BFIN"] = ix("bf")[2:]
    t["QUIET"] = ix("quiet")
    t["DRYL"] = ix("dryL")
    t["DRYR"] = ix("dryR")
    t["SC_STAGEF"] = layout["scope"]["STAGE_FRAME"] + st["index"]
    t["WETS"] = wets_code(layout, st)
    return t


def wets_code(layout, st):
    """The per-sample wet smoothing of a group's own instances, unrolled (the wet index of an instance is its base)."""
    if st["role"] in ("raw", "head", "tail"):
        return ""
    lines = []
    for k in range(st["k0"], st["k1"]):
        wi = layout["base"][layout["order"][k]]
        # `go` is 0 until the loader has switched the chain onto this gen~: the wet then ramps in from 0 over the module's own smoothing
        lines += [f"tw = (go > 0.5) ? d_pv.peek({wi}) : 0;", f"cw = d_wS.peek({k});", "cw = cw + (tw - cw) * 0.01;", "cw = (tw < 0.0005 && cw < 0.0005) ? 0 : cw;", f"d_wS.poke(cw, {k});"]
    return "\n".join(lines)


_DIRECTIVE = re.compile(r"^\s*//@(\w+)(?:\s+(\w+))?\s*$")


def apply_directives(core, st, flags):
    """Keep the `//@mod` / `//@if` blocks that belong to the stage; drop the directive lines themselves."""
    insts = set(st["insts"])
    if ("gpit" in insts) != ("gstr" in insts):
        raise ValueError("gpit and gstr share one gl_grain call site and must be in the same stage")
    out = []
    stack = []  # [active_before, this_branch_active]

    def live():
        return all(a for a in stack)

    for line in core.split("\n"):
        m = _DIRECTIVE.match(line)
        if not m:
            if live():
                out.append(line)
            continue
        kind, arg = m.group(1), m.group(2)
        if kind == "mod":
            stack.append(arg in insts)
        elif kind == "if":
            stack.append(arg in flags)
        elif kind == "else":
            stack[-1] = not stack[-1]
        elif kind in ("endmod", "endif"):
            stack.pop()
        else:
            raise ValueError("unknown directive //@" + kind)
    if stack:
        raise ValueError("unbalanced //@ directives")
    return "\n".join(out)


_FN_HEAD = re.compile(r"^([a-z_0-9]+)\(.*\)\s*\{\s*$")


def split_functions(text):
    """[(name, source)] of the top-level function definitions of a source (comments between them are dropped)."""
    funcs = []
    cur = None
    buf = []
    for line in text.split("\n"):
        if cur is None:
            m = _FN_HEAD.match(line)
            if m:
                cur, buf = m.group(1), [line]
        else:
            buf.append(line)
            if line == "}":
                funcs.append((cur, "\n".join(buf)))
                cur, buf = None, []
    return funcs


def _strip_comments(text):
    return "\n".join(l for l in text.split("\n") if l.strip() and not l.lstrip().startswith("//"))


def _calls(text, names):
    return {n for n in names if re.search(r"\b%s\(" % re.escape(n), text)}


def build_stage(layout, st, with_lib=True):
    """One stage's complete gen source: only the functions its body reaches, only the declarations it uses."""
    with open(CORE_PATH, "r", encoding="utf-8") as f:
        core = f.read()
    tok = tokens(layout, st)
    flags = stage_flags(st)
    core = apply_directives(core, st, flags)

    def sub(m):
        name = m.group(1)
        if name not in tok:
            raise KeyError(f"unknown token @{name}@ in glitch_core.genexpr")
        return str(tok[name])

    core = re.sub(r"@([A-Za-z0-9_]+)@", sub, core)
    lib = ""
    if with_lib:
        with open(LIB_PATH, "r", encoding="utf-8") as f:
            lib = f.read()
    full = lib + "\n" + core
    i = full.index("\nBuffer slots(")
    fn_text, rest = full[:i], full[i + 1:]
    m = re.search(r"^// -{20,}\n// Per-sample", rest, re.M)
    decl_text, body = rest[:m.start()], rest[m.start():]
    body = _strip_comments(body)
    body += "\n" + epilogue(st, tok)
    funcs = split_functions(fn_text)
    names = [n for n, _ in funcs]
    src = dict(funcs)
    need = set(_calls(body, names))
    work = list(need)
    while work:
        n = work.pop()
        for c in _calls(src[n], names):
            if c != n and c not in need:
                need.add(c)
                work.append(c)
    kept_fns = [src[n] for n in names if n in need]
    decls = []
    for line in decl_text.split("\n"):
        dm = re.match(r"^(Buffer|Data|Delay|Param|History)\s+(\w+)", line)
        if dm and dm.group(2) == "beat" and st["role"] in ("group", "spec"):
            continue  # a group reads the head's beat from its inlets into a plain variable (a History would read back the old value)
        if dm and re.search(r"\b%s\b" % re.escape(dm.group(2)), body):
            decls.append(line)
    return "\n".join(kept_fns) + "\n" + "\n".join(decls) + "\n" + body + "\n"


def epilogue(st, tok):
    """Signal outlets of a non-tail stage."""
    if st["role"] == "head":
        # the History reads see the previous sample's beat, exactly what every module of the one-gen chain read
        return "out1 = d_tk.peek(0);\nout2 = floor(beat);\nout3 = beat - floor(beat);\nout4 = (quietCnt >= n) ? 1 : 0;"
    if st["role"] in ("group", "spec"):
        return "out1 = d_io.peek(0);\nout2 = d_io.peek(1);"
    return ""


def gen_source(layout=None, with_lib=True, stage=None):
    """cepstrum_lib + glitch_core with every @TOKEN@ replaced. stage = None: the raw text (directives left as comments, the form the node
    twin compares, not compilable); stage = a stage dict from layout["stages"]: that stage's gen."""
    layout = layout or load_layout()
    if stage is not None:
        return build_stage(layout, stage, with_lib)
    with open(CORE_PATH, "r", encoding="utf-8") as f:
        core = f.read()
    tok = tokens(layout)

    def sub(m):
        name = m.group(1)
        if name not in tok:
            raise KeyError(f"unknown token @{name}@ in glitch_core.genexpr")
        return str(tok[name])

    core = re.sub(r"@([A-Za-z0-9_]+)@", sub, core)
    if not with_lib:
        return core
    with open(LIB_PATH, "r", encoding="utf-8") as f:
        lib = f.read()
    return lib + "\n" + core


def shell_code(st):
    """The placeholder gen of a stage: same inlets, outlets, Params and Buffers as the real code (so the hub's messages and the bindings are
    understood, a gen~ without them logs `doesn't understand`), no work. The device is saved with these (every stage's gen~ and all its
    cords are static: adding objects or cords at run time silences the whole device for as long as the new gen~ takes to compile, measured
    in Live); the v8ui hot-loads the real code with `setattr gen` (measured: 2 - 4 ms of lost audio, 0.1 - 1.2 s on the main thread)."""
    r = st["role"]
    if r == "head":
        decl = 'Param bpm(120);\nParam ppq(0);\nParam playing(1);\nBuffer slots("glitchslots");\nBuffer scope("glitchscope");\nBuffer ctl("glitchctl");\n'
        keep = "bpm + ppq + playing + peek(slots, 0, 0) + peek(scope, 0, 0) + peek(ctl, 0, 0)"
    elif r in ("group", "spec"):
        decl = 'Param bpm(120);\nParam go(0);\nBuffer scope("glitchscope");\nBuffer ctl("glitchctl");\n'
        keep = "bpm + go + peek(scope, 0, 0) + peek(ctl, 0, 0)"
    else:
        decl = 'Param wet(1);\nParam outdb(0);\nBuffer scope("glitchscope");\n'
        keep = "wet + outdb + peek(scope, 0, 0)"
    outs = "".join(f"out{i + 1} = 0;\n" for i in range(1, len(st["outs"])))
    return decl + f"keep = {keep};\nout1 = keep > 1e30 ? 1 : 0;\n" + outs


def stage_sources(layout=None):
    """[{id, index, code, ins, outs, role, ...}] for the staged build, in chain order."""
    layout = layout or load_layout()
    res = []
    for st in layout["stages"]:
        d = dict(st)
        d["code"] = gen_source(layout, stage=st)
        d["shell"] = shell_code(st)
        res.append(d)
    return res


def gendsp_json(gen_code, nin=2, nout=2):
    """A gen patcher (in 1..nin -> codebox -> out 1..nout) as .gendsp JSON text (AGENTS.md 1d: the device ships without its gen~ and the
    v8ui creates it from this file after load)."""
    gen_code = minify_gen(gen_code)
    def b(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {"id": i, "maxclass": cls, "numinlets": ni, "numoutlets": no, "outlettype": [""] * no,
               "patching_rect": [float(x), float(y), 200.0, 22.0]}
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}
    boxes = [b("obj-in%d" % (i + 1), "in %d" % (i + 1), 20 + 100 * i, 20, 0, 1) for i in range(nin)]
    boxes.append(b("obj-code", "", 20, 60, nin, nout, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0))
    boxes += [b("obj-out%d" % (i + 1), "out %d" % (i + 1), 20 + 100 * i, 400, 1, 0) for i in range(nout)]
    lines = [{"patchline": {"source": ["obj-in%d" % (i + 1), 0], "destination": ["obj-code", i]}} for i in range(nin)]
    lines += [{"patchline": {"source": ["obj-code", i], "destination": ["obj-out%d" % (i + 1), 0]}} for i in range(nout)]
    patch = {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "dsp.gen",
        "rect": [50.0, 50.0, 600.0, 450.0],
        "boxes": boxes,
        "lines": lines,
    }}
    return json.dumps(patch)
