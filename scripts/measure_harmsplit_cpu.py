#!/usr/bin/env python3
"""Relative DSP cost of Harmonic Split's gen core in real Max (inside the tart VM, AGENTS.md 1a), on the shared NonRealTime harness.

    scripts/vm_spectral.sh run measure_harmsplit_cpu.py <core.genexpr> [<core2.genexpr> ...]      (from the host; files must exist in the VM)

Each core is rendered as four instances (the audio-test patch of run_harmsplit_audio_tests.py, stimulus = band-limited 220 Hz
sawtooth) for a short and a long measured window; the NonRealTime driver renders as fast as it can, so
(wall(long) - wall(short)) / (long - short) is the cost of one second of audio for the whole patch (stimulus + 4 cores), in seconds per
second (a real-time factor, not the CPU load of Live). Run the same script on an older core (`git show <rev>:src/harmsplit_core.genexpr`
copied into the VM) to compare: the difference divided by 4 is the cost of one core instance. Sizes 1k / 2k / 4k.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_harmsplit_audio_tests as rt  # noqa: E402

SHORT_MS, LONG_MS = 1500, 21500


def source_with_core(core_path):
    parts = []
    for name in ("cepstrum_lib.genexpr", "spectral_split_lib.genexpr"):
        with open(os.path.join(rt.SRC, name), "r", encoding="utf-8") as f:
            parts.append(f.read().rstrip() + "\n")
    with open(core_path, "r", encoding="utf-8") as f:
        parts.append(f.read().rstrip() + "\n")
    return "\n".join(parts)


def wall(code, n, dur):
    case = [c for c in rt.cases() if c["name"] == "saw_p2"][0]
    case.update(n=n, dur=dur, settle=300)
    t0 = time.time()
    rt.run_case(code, case)
    return time.time() - t0


def main():
    cores = sys.argv[1:] or [os.path.join(rt.SRC, "harmsplit_core.genexpr")]
    for core in cores:
        code = source_with_core(core)
        for n in (1024, 2048, 4096):
            ws = wall(code, n, SHORT_MS)
            wl = wall(code, n, LONG_MS)
            rtf = (wl - ws) / ((LONG_MS - SHORT_MS) / 1000.0)
            print(f"{os.path.basename(core)} Size {n}: short {ws:.1f} s, long {wl:.1f} s -> {rtf:.3f} s of wall time per second of audio (4 cores + stimulus)")


if __name__ == "__main__":
    main()
