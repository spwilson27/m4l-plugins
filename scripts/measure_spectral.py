#!/usr/bin/env python3
"""Goal 1 measurements for the Spectral Split suite on real Max inside the tart VM (AGENTS.md 1a, shared harness 1b):

  scripts/vm_spectral.sh run measure_spectral.py compile [slug ...]       gen compile time (harness wall time of a 100 ms render minus a trivial gen)
  scripts/vm_spectral.sh run measure_spectral.py cpu [slug ...]           cost per instance per Size: NonRealTime wall seconds per second of audio,
                                                                          slope of (long - short) for 1 and 3 instances, per-instance = (s3 - s1) / 2
  scripts/vm_spectral.sh run measure_spectral.py split                    transplit only: cost of forward FFT + inverse FFT + OLA (F, I), the Mid analysis (A) and
                                                                          the mask computation, by switching parts of the core off (timing only, output is garbage)
  scripts/vm_spectral.sh run measure_spectral.py derive [slug ...]        cost of ONE RACK (leader + followers) per Size with the shared-template savings on / off:
                                                                          SS_NO_DERIVE=1 (every channel inverse-transformed) and SS_NO_MIDA=1 (Mid phase atan2 kept)
  scripts/vm_spectral.sh run measure_spectral.py spike [slug ...]         `adstatus cpu` polled every 3 ms on the REAL-TIME driver (audio_device, machine-wide lock) with
                                                                          racks of the device at Size 4k / 1k: mean / p90 / p99 / max, to see whether the once-per-hop
                                                                          analysis is a per-vector CPU spike (candidate for time slicing)
  scripts/vm_spectral.sh run measure_spectral.py all

NRT renders as fast as it can, so the ratio is a real-time factor of the WHOLE patch (stimulus + record + instances) on one core,
not Live's CPU meter; differences between runs (1 vs 3 instances, variants) isolate the instance. Use the same VM state for
before / after comparisons (run twice and compare spreads)."""
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
SRC = os.path.join(ROOT, "src")
PROBE = os.path.join(ROOT, "tests", "sampler_loadtime_probe.js")
SLUGS = ["transplit", "loudsplit", "harmsplit", "freqsplit"]
SIZES = [("512", 512), ("1k", 1024), ("2k", 2048), ("4k", 4096)]
SHORT_MS, LONG_MS = 1000, 21000
N_HI = 12            # instances in the loaded patch; the slope difference / (N_HI - 1) is the per-instance cost
STIM = ("History n(0);\nn = n + 1;\nk = n - 1;\nr = noise();\n"
        "x = 0.1 * sin(6.283185307179586 * 440 * k / 48000) + 0.25 * r;\nout1 = x;\nout2 = x * 0.5;\n")


def src(*names):
    return "\n".join(open(os.path.join(SRC, n), encoding="utf-8").read().rstrip() + "\n" for n in names)


def core_source(slug, extra_libs=()):
    if slug == "transplit" and os.environ.get("MEASURE_OLD_TRANSPLIT") != "1":
        import build_transplit          # the device's real gen code (rack machinery expanded)
        return build_transplit.gen_code()
    libs = ["cepstrum_lib.genexpr", "spectral_split_lib.genexpr"] + list(extra_libs) + [f"{slug}_core.genexpr"]
    return src(*libs)


def render(name, boxes, lines, dur, channels=1):
    return mh.run_case(name, boxes, lines, probe_js=PROBE, settle_ms=50, dur_ms=dur, channels=channels)["harness_wall_s"]


def compile_case(name, code):
    boxes = [mh.gen_box("obj-g", code, 40, 80, numinlets=2, numoutlets=2)]
    lines = [mh.line("obj-g", 0, "obj-record", 0)]
    return render(name, boxes, lines, 100)


def patch(code, count, n, scope_names):
    boxes = [mh.gen_box("obj-stim", STIM, 40, 100, numinlets=1, numoutlets=2)]
    lines = []
    for b in scope_names:
        boxes.append(mh.box(f"obj-buf-{b}", f"buffer~ #0-x{b} @samps 1024", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
    for i in range(count):
        gid = f"obj-g{i}"
        boxes.append(mh.gen_box(gid, code, 200 + 60 * i, 260))
        binds = ", ".join(f"{b} #0-x{b}" for b in scope_names)
        boxes.append(mh.msg(f"obj-p{i}", f"outsel 1, fftn {n}" + (", " + binds if binds else ""), 200 + 60 * i, 220, 300))
        lines += [mh.line("obj-load", 0, f"obj-p{i}", 0), mh.line(f"obj-p{i}", 0, gid, 0),
                  mh.line("obj-stim", 0, gid, 0), mh.line("obj-stim", 1, gid, 1), mh.line(gid, 0, "obj-mute-l", 0)]
    lines.append(mh.line("obj-g0", 0, "obj-record", 0))
    return boxes, lines


def slope(code, count, n, scope_names, tag):
    b, l = patch(code, count, n, scope_names)
    ws = render(f"ms_{tag}_s", b, l, SHORT_MS)
    wl = render(f"ms_{tag}_l", b, l, LONG_MS)
    return (wl - ws) / ((LONG_MS - SHORT_MS) / 1000.0), ws


def scope_names(code):
    return re.findall(r"^Buffer\s+(\w+)\(", code, re.M)


def patch_rack(code, racks, n, shared, ring_samps):
    """`racks` racks of two chains each (Transients + Tones instances). shared = True: the first instance of a rack leads, the second follows
    its ring (what the face sets up); False: both compute alone (role 0, the old behaviour)."""
    boxes = [mh.gen_box("obj-stim", STIM, 40, 100, numinlets=1, numoutlets=2)]
    lines = []
    for r in range(racks):
        for c in range(2):
            tag = f"{r}_{c}"
            gid = f"obj-g{tag}"
            lead_tag = f"{r}_0" if shared else tag
            role = (1 if c == 0 else 2) if shared else 0
            serve = 3 if (shared and c == 0) else 0
            boxes.append(mh.box(f"obj-ring{tag}", f"buffer~ #0-ring{tag} @samps {ring_samps}", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
            boxes.append(mh.box(f"obj-sc{tag}", f"buffer~ #0-sc{tag} @samps 1024", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
            boxes.append(mh.gen_box(gid, code, 200, 260))
            boxes.append(mh.msg(f"obj-p{tag}", f"outsel {c + 1}, fftn {n}, ring #0-ring{tag}, lead #0-ring{lead_tag}, scope #0-sc{tag}, role {role}, serve {serve}, epoch 1", 200, 220, 300))
            lines += [mh.line("obj-load", 0, f"obj-p{tag}", 0), mh.line(f"obj-p{tag}", 0, gid, 0),
                      mh.line("obj-stim", 0, gid, 0), mh.line("obj-stim", 1, gid, 1), mh.line(gid, 0, "obj-mute-l", 0)]
    lines.append(mh.line("obj-g0_0", 0, "obj-record", 0))
    return boxes, lines


def do_rack(slugs=None):
    import build_transplit
    code = build_transplit.gen_code()
    for label, n in SIZES:
        res = {}
        for shared in (False, True):
            b1, l1 = patch_rack(code, 1, n, shared, build_transplit.RING_SAMPS)
            bh, lh = patch_rack(code, N_HI // 2, n, shared, build_transplit.RING_SAMPS)
            def sl(b, l, tag):
                ws = render(f"msr_{tag}_s", b, l, SHORT_MS)
                wl = render(f"msr_{tag}_l", b, l, LONG_MS)
                return (wl - ws) / ((LONG_MS - SHORT_MS) / 1000.0), ws
            s1, w1 = sl(b1, l1, f"{shared}1")
            sh, wh = sl(bh, lh, f"{shared}h")
            res[shared] = (sh - s1) / (N_HI // 2 - 1)
            print(f"RACK Size {label} {'shared (leader + follower)' if shared else 'old (both compute)'}: per rack {res[shared]:.4f} s/s = {res[shared] * 100:.2f} % of one core; "
                  f"wall short render 1 rack {w1:.1f} s, {N_HI // 2} racks {wh:.1f} s")
        print(f"RACK Size {label}: shared / old = {res[True] / max(res[False], 1e-9):.2f}")


def patch_rack_k(code, racks, n, k, ring_samps):
    """`racks` racks of k chains, the first instance of a rack leads and serves every channel, the others follow."""
    boxes = [mh.gen_box("obj-stim", STIM, 40, 100, numinlets=1, numoutlets=2)]
    lines = []
    for r in range(racks):
        for c in range(k):
            tag = f"{r}_{c}"
            gid = f"obj-g{tag}"
            role = 1 if c == 0 else 2
            serve = (1 << k) - 1 if c == 0 else 0
            boxes.append(mh.box(f"obj-ring{tag}", f"buffer~ #0-ring{tag} @samps {ring_samps}", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
            boxes.append(mh.box(f"obj-sc{tag}", f"buffer~ #0-sc{tag} @samps 1024", 520, 100, 240, numoutlets=2, outlettype=["float", "bang"]))
            boxes.append(mh.gen_box(gid, code, 200, 260))
            boxes.append(mh.msg(f"obj-p{tag}", f"outsel {c + 1}, fftn {n}, ring #0-ring{tag}, lead #0-ring{r}_0, scope #0-sc{tag}, role {role}, serve {serve}, epoch 1", 200, 220, 300))
            lines += [mh.line("obj-load", 0, f"obj-p{tag}", 0), mh.line(f"obj-p{tag}", 0, gid, 0),
                      mh.line("obj-stim", 0, gid, 0), mh.line("obj-stim", 1, gid, 1), mh.line(gid, 0, "obj-mute-l", 0)]
    lines.append(mh.line("obj-g0_0", 0, "obj-record", 0))
    return boxes, lines


def rack_cost(code, n, k, ring_samps, tag):
    b1, l1 = patch_rack_k(code, 1, n, k, ring_samps)
    bh, lh = patch_rack_k(code, N_HI // 2, n, k, ring_samps)
    def sl(b, l, t):
        ws = render(f"msd_{t}_s", b, l, SHORT_MS)
        wl = render(f"msd_{t}_l", b, l, LONG_MS)
        return (wl - ws) / ((LONG_MS - SHORT_MS) / 1000.0)
    return (sl(bh, lh, tag + "h") - sl(b1, l1, tag + "1")) / (N_HI // 2 - 1)


def do_derive(slugs, reps=1):
    import importlib
    for slug in slugs:
        mod = importlib.import_module(f"build_{slug}")
        k = {"transplit": 2, "loudsplit": 3, "harmsplit": 3, "freqsplit": 4}[slug]
        variants = [("all savings", {}), ("no derive", {"SS_NO_DERIVE": "1"}), ("no derive, no mida", {"SS_NO_DERIVE": "1", "SS_NO_MIDA": "1"}),
                    ("derive, no mida", {"SS_NO_MIDA": "1"})]
        if slug in ("transplit", "harmsplit"):
            variants = variants[:2]                  # these keep the phase
        for label, n in SIZES:
            if n not in (1024, 4096):          # two sizes keep the run short (VM shared)
                continue
            row = []
            for vname, env in variants:
                for key in ("SS_NO_DERIVE", "SS_NO_MIDA"):
                    os.environ.pop(key, None)
                os.environ.update(env)
                code = mod.gen_code()
                vtag = vname.replace(' ', '')[:4]
                vals = [rack_cost(code, n, k, mod.RING_SAMPS, f"{slug}{label}{vtag}{i}") for i in range(reps)]
                row.append((vname, vals))
            for key in ("SS_NO_DERIVE", "SS_NO_MIDA"):
                os.environ.pop(key, None)
            print(f"DERIVE {slug} Size {label}: " + " | ".join(f"{v}: " + " ".join(f"{x * 100:.2f}" for x in vals) + f" (min {min(vals) * 100:.2f}) %" for v, vals in row))


def do_spike(slugs, racks=6, dur=8000):
    import importlib
    probe = os.path.join(ROOT, "tests", "spectral_probe", "cpu_probe.js")
    for slug in slugs:
        mod = importlib.import_module(f"build_{slug}")
        k = {"transplit": 2, "loudsplit": 3, "harmsplit": 3, "freqsplit": 4}[slug]
        code = mod.gen_code()
        for label, n in (("4k", 4096), ("1k", 1024)):
            for nracks in (0, racks):
                b, l = patch_rack_k(code, max(nracks, 1), n, k, mod.RING_SAMPS) if nracks else ([mh.gen_box("obj-stim", STIM, 40, 100, numinlets=1, numoutlets=2)], [])
                if not nracks:
                    l = [mh.line("obj-stim", 0, "obj-record", 0)]
                b += [mh.box("dev-metro", "metro 3", 40, 480, 70, numinlets=2), mh.box("dev-adstatus", "adstatus cpu", 40, 510, 90, outlettype=["float"]),
                      mh.box("dev-cpu-prep", "prepend cpu", 40, 540, 90)]
                l += [mh.line("obj-load", 0, "dev-metro", 0), mh.line("dev-metro", 0, "dev-adstatus", 0), mh.line("dev-adstatus", 0, "dev-cpu-prep", 0),
                      mh.line("dev-cpu-prep", 0, "obj-js", 0)]
                r = mh.run_case(f"msp_{slug}_{label}_{nracks}", b, l, probe_js=probe, settle_ms=300, dur_ms=dur, mode="audio_device")
                m = r.get("meta") or r
                print(f"SPIKE {slug} Size {label} racks {nracks}: " + " ".join(f"{k2} {m.get(k2)}" for k2 in ("n", "mean", "p50", "p90", "p99", "max", "distinct")))


def do_compile(slugs, runs=3):
    base = min(compile_case("ms_base", "out1 = in1; out2 = in2;") for _ in range(runs))
    print(f"baseline trivial gen: {base:.2f} s")
    for slug in slugs:
        code = core_source(slug)
        w = [compile_case(f"ms_c_{slug}", code) for _ in range(runs)]
        print(f"COMPILE {slug}: wall {' '.join(f'{x:.2f}' for x in w)}  -> compile ~{min(w) - base:.2f} s (min - baseline)")


def do_cpu(slugs):
    for slug in slugs:
        code = core_source(slug)
        names = scope_names(code)
        for label, n in SIZES:
            if slug == "freqsplit" and n == 512:
                continue
            s1, w1 = slope(code, 1, n, names, f"{slug}1")
            sh, wh = slope(code, N_HI, n, names, f"{slug}{N_HI}")
            per = (sh - s1) / (N_HI - 1)
            print(f"CPU {slug} Size {label}: 1 inst {s1:.4f} s/s, {N_HI} inst {sh:.4f} s/s -> per instance {per:.4f} s/s = {per * 100:.2f} % of one core "
                  f"(floor {s1 - per:.4f}); wall of the short render: 1 inst {w1:.1f} s, {N_HI} inst {wh:.1f} s -> load per instance {(wh - w1) / (N_HI - 1) * 1000:.0f} ms")


def do_split():
    full = core_source("transplit")
    names = scope_names(full)
    variants = {
        "full": full,
        "no_masks": re.sub(r"\n\tts_masks\([^\n]*\n", "\n", full),
        "no_fft": full.replace("fft_run(fx, tab, n, 0);", "").replace("fft_run(fx, tab, n, 1);", ""),
        "no_mid_masks": re.sub(r"\n\tts_masks\([^\n]*\n", "\n", full).replace("ss_mid(fx, ms, n);", ""),
        "no_frame_work": re.sub(r"\n\tts_masks\([^\n]*\n", "\n", full).replace("ss_mid(fx, ms, n);", "").replace("fft_run(fx, tab, n, 0);", "").replace("fft_run(fx, tab, n, 1);", ""),
        "no_tele": full.replace("teleNow = awake > 0.5 ? 1 : 0;", "teleNow = 0;"),
    }
    for n in (1024, 4096):
        res = {}
        for k, code in variants.items():
            if code == full and k != "full":
                print(f"WARNING variant {k} did not change the source")
            s1, _ = slope(code, 1, n, names, f"split_{k}1")
            sh, _ = slope(code, N_HI, n, names, f"split_{k}{N_HI}")
            res[k] = (sh - s1) / (N_HI - 1)
            print(f"SPLIT Size {n} {k}: per instance {res[k]:.4f} s/s")
        print(f"SPLIT Size {n}: masks (ts_masks) = {res['full'] - res['no_masks']:.3f}, FFTs = {res['full'] - res['no_fft']:.3f}, "
              f"telemetry = {res['full'] - res['no_tele']:.3f}, rest (pad / ola / framing) = {res['no_frame_work']:.3f}  (s/s per instance)")


def main():
    args = sys.argv[1:] or ["all"]
    what = args[0]
    slugs = [a for a in args[1:] if a in SLUGS] or SLUGS
    if what in ("compile", "all"):
        do_compile(slugs)
    if what in ("cpu", "all"):
        do_cpu(slugs)
    if what in ("split", "all"):
        do_split()
    if what in ("rack", "all"):
        do_rack()
    if what == "spike":
        do_spike(slugs)
    if what in ("derive",):
        do_derive(slugs)


if __name__ == "__main__":
    main()
