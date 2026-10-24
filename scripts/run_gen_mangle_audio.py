#!/usr/bin/env python3
"""Render each gen core twice — the source, and the mangled source — on one noise input.

Max only, inside the tart VM (AGENTS.md 1a). A non-zero maxdiff means the rename changed the DSP.
Outlets beyond 8 are still compiled (numoutlets stays honest) but only the first 8 are compared.
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import minify_gen

ROOT = mh.ROOT
PROBE = os.path.join(ROOT, "tests", "gen_mangle_probe.js")
COMPARE_CAP = 8


def ports(src):
    code = re.sub(r"//[^\n]*", "", src)
    ins = [int(n) for n in re.findall(r"\bin(\d+)\b", code)] or [1]
    outs = [int(n) for n in re.findall(r"\bout(\d+)\b", code)] or [1]
    return max(ins), max(outs)


def device(original, mangled, n_in, n_out, compare):
    boxes = [
        mh.box("dev-noise", "noise~", 40, 80, 60, numinlets=0, numoutlets=1, outlettype=["signal"]),
        mh.box("dev-gain", "*~ 0.25", 40, 140, 60, numinlets=2, numoutlets=1, outlettype=["signal"]),
        mh.gen_box("dev-orig", original, 200, 80, numinlets=n_in, numoutlets=n_out),
        mh.gen_box("dev-mang", mangled, 200, 220, numinlets=n_in, numoutlets=n_out),
    ]
    lines = [mh.line("dev-noise", 0, "dev-gain", 0)]
    for i in range(n_in):
        lines.append(mh.line("dev-gain", 0, "dev-orig", i))
        lines.append(mh.line("dev-gain", 0, "dev-mang", i))
    for i in range(compare):
        lines.append(mh.line("dev-orig", i, "obj-record", i))
        lines.append(mh.line("dev-mang", i, "obj-record", compare + i))
    lines.append(mh.line("dev-orig", 0, "obj-mute-l", 0))
    if n_out > 1:
        lines.append(mh.line("dev-orig", 1, "obj-mute-r", 0))
    else:
        lines.append(mh.line("dev-orig", 0, "obj-mute-r", 0))
    lines.append(mh.line("obj-mute-l", 0, "obj-dac", 0))
    lines.append(mh.line("obj-mute-r", 0, "obj-dac", 1))
    return boxes, lines


def sources():
    files = [
        "src/sand_core.genexpr",
        "src/reciprocator_core.genexpr",
        "src/degrade_core.genexpr",
        "src/envtrig_core.genexpr",
        "src/mbsplit_core.genexpr",
        "src/tinyspace_core.genexpr",
        "src/delayplus_start.genexpr",
        "src/delayplus_end.genexpr",
        "src/cepstra_core.genexpr",
        "src/percipitator_core.genexpr",
        "src/sampler_core.genexpr",
    ]
    out = []
    tiny = (
        "lp(x, coef) {\n"
        "\tHistory s(0);\n"
        "\ts = mix(x, s, coef);\n"
        "\treturn s;\n"
        "}\n"
        'Buffer wave("gmanglewave");\n'
        "Param gain(0.5);\n"
        "Delay dly(64);\n"
        "dly.write(in2);\n"
        "out1 = lp(in1, 0.9) * gain;\n"
        'out2 = dly.read(8, interp="linear");\n'
        "poke(wave, out1, 0, 0);\n"
    )
    out.append(("tiny", tiny))
    for rel in files:
        with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
            out.append((os.path.splitext(os.path.basename(rel))[0], f.read()))
    import glitch_common as gc
    stages = [s for s in gc.stage_sources(gc.load_layout()) if len(s["code"]) > 400]
    st = min(stages, key=lambda s: len(s["code"]))
    out.append((f"glitch_{st['id']}", st["code"]))
    import megamod_common as mc
    out.append(("megamod_engine", open(os.path.join(ROOT, "src", "megamod_engine.genexpr"), encoding="utf-8").read()))
    out.append(("megamod_router", mc.router_gen_code()))
    return out


def main():
    want = sys.argv[1:]
    failed = 0
    for name, src in sources():
        if want and name not in want:
            continue
        mangled = minify_gen.minify_gen(src)
        n_in, n_out = ports(src)
        compare = min(n_out, COMPARE_CAP)
        boxes, lines = device(src, mangled, n_in, n_out, compare)
        print(f"--- {name} {n_in}in/{n_out}out compare {compare}", flush=True)
        result = mh.run_case(
            f"mangle_{name}", boxes, lines,
            probe_js=PROBE, probe_args=str(compare),
            settle_ms=200, dur_ms=300, channels=compare * 2, sr=48000,
        )
        diff = float(result["maxdiff"])
        peak = float(result["peak"])
        nans = int(float(result["nan"]))
        print(f"    maxdiff {diff:.3e} peak {peak:.4f} nan {nans} frames {result['frames']}", flush=True)
        if diff > 1e-12 or nans:
            print(f"FAIL {name}", flush=True)
            failed += 1
        elif peak <= 0 and name in ("tiny", "sand_core", "reciprocator_core", "delayplus_start", "mbsplit_core"):
            print(f"FAIL {name} silent", flush=True)
            failed += 1
    if failed:
        raise SystemExit(f"{failed} gen mangle comparisons failed")
    print("gen mangle audio ok")


if __name__ == "__main__":
    main()
