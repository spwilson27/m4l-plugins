"""Shared pieces of the Glitch build: the gen source assembler used by build_glitch.py and run_glitch_audio_tests.py.

The layout (parameter indices, scope offsets) lives in src/glitch_config.js; this module asks Node for it (host only: the VM
has no node, so the audio runner reads the layout JSON that build_glitch.py writes to tests/out/glitch_layout.json)."""

import json
import os
import re
import subprocess

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
  face: g.glitchFaceLayout(g.defaultUi()),
  faces: { editor: g.glitchFaceLayout({ editor: 1, slots: 1 }), seq: g.glitchFaceLayout({ seq: 1, slots: 1 }), options: g.glitchFaceLayout({ options: 1, slots: 1 }), many: g.glitchFaceLayout({ slots: 1 }), many2: g.glitchFaceLayout({ slots: 1 }) } }));
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


def tokens(layout):
    t = {
        "NP": layout["np"],
        "WOFF": layout["weightsOffset"],
        "SVSIZE": layout["np"] * layout["nslot"],
        "SQOFF": layout["seqOffset"],
        "METAOFF": layout["metaOffset"],
        "DEFOFF": layout["defsOffset"],
        "WBOFF": layout["wbOffset"],
        "NINST": layout["ninst"],
    }
    for k, v in layout["base"].items():
        t[f"B_{k}"] = v
    for pos, iid in enumerate(layout["order"]):
        t[f"P_{iid}"] = pos
    for key, idx in layout["index"].items():
        t["I_" + key.replace(".", "_")] = idx
    for k, v in layout["scope"].items():
        t[f"SC_{k}"] = v
    return t


def gen_source(layout=None, with_lib=True):
    """cepstrum_lib + glitch_core with every @TOKEN@ replaced."""
    layout = layout or load_layout()
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


def gendsp_json(gen_code):
    """The gen patcher (in 1 / in 2 -> codebox -> out 1 / out 2) as .gendsp JSON text (AGENTS.md 1d: the device ships
    without its gen~ and the v8ui creates it from this file after load)."""
    def b(i, text, x, y, ni, no, cls="newobj", **kw):
        box = {"id": i, "maxclass": cls, "numinlets": ni, "numoutlets": no, "outlettype": [""] * no,
               "patching_rect": [float(x), float(y), 200.0, 22.0]}
        if cls == "newobj":
            box["text"] = text
        box.update(kw)
        return {"box": box}
    patch = {"patcher": {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 0, "architecture": "x64", "modernui": 1},
        "classnamespace": "dsp.gen",
        "rect": [50.0, 50.0, 600.0, 450.0],
        "boxes": [
            b("obj-in1", "in 1", 20, 20, 0, 1), b("obj-in2", "in 2", 120, 20, 0, 1),
            b("obj-code", "", 20, 60, 2, 2, cls="codebox", code=gen_code, fontname="<Monospaced>", fontsize=12.0),
            b("obj-out1", "out 1", 20, 400, 1, 0), b("obj-out2", "out 2", 120, 400, 1, 0),
        ],
        "lines": [
            {"patchline": {"source": ["obj-in1", 0], "destination": ["obj-code", 0]}},
            {"patchline": {"source": ["obj-in2", 0], "destination": ["obj-code", 1]}},
            {"patchline": {"source": ["obj-code", 0], "destination": ["obj-out1", 0]}},
            {"patchline": {"source": ["obj-code", 1], "destination": ["obj-out2", 0]}},
        ],
    }}
    return json.dumps(patch)
