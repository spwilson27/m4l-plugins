#!/usr/bin/env python3
"""Evidence for the hop-phase bug of the PRE-rack design (Goal 1 of the splitter optimisation): two instances of the OLD core (git HEAD's
src/transplit_core.genexpr, every instance frames the signal on its own) are told to change Size at slightly different moments (a linked Size
change reaching the peers some ms apart, or a chain started later). Their STFT framing then differs by the time difference (modulo the hop), and the
two chains no longer sum to the input. Run in the VM:  scripts/vm_spectral.sh run demo_hopphase_bug.py <old core file>
Prints the Transients + Tones null against the input delayed 4096 samples for a Size change at the same sample and 3 ms apart."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh
import run_transplit_audio_tests as rt

rt.LATENCY = 4096          # the old core's latency


def old_source(core_path):
    parts = []
    for name in ("cepstrum_lib.genexpr", "spectral_split_lib.genexpr"):
        parts.append(open(os.path.join(rt.SRC, name), encoding="utf-8").read().rstrip() + "\n")
    parts.append(open(core_path, encoding="utf-8").read().rstrip() + "\n")
    return "\n".join(parts)


def run(code, dt_ms, n_from, n_to):
    boxes = [
        mh.gen_box("obj-stim", rt.stim_code("drums", True), 40, 120, numinlets=1, numoutlets=3),
        mh.box("obj-half", "*~ 0.5", 40, 160, 45, numinlets=2, outlettype=["signal"]),
        mh.box("obj-scope", "buffer~ #0-transplitscope @samps 800", 520, 100, 260, numoutlets=2, outlettype=["float", "bang"]),
        mh.msg("obj-setbuf", "setbuffer #0-transplitscope", 520, 130, 220),
    ]
    lines = [mh.line("obj-load", 0, "obj-setbuf", 0), mh.line("obj-setbuf", 0, "obj-js", 0), mh.line("obj-stim", 0, "obj-half", 0)]
    for tag, sel in (("t", 1), ("q", 2)):
        gid = f"obj-gen-{tag}"
        boxes.append(mh.gen_box(gid, code, 200 + 240 * sel, 260))
        boxes.append(mh.msg(f"obj-params-{tag}", f"outsel {sel}, fftn {n_from}, ttype 0, anbias 0, tdecay 8, tsmooth 1.5, tiltamt 0, tmode 0, blendamt 0.5, mixamt 1"
                            + (", scope #0-transplitscope" if tag == "t" else ""), 200 + 240 * sel, 220, 330))
        lines += [mh.line("obj-load", 0, f"obj-params-{tag}", 0), mh.line(f"obj-params-{tag}", 0, gid, 0),
                  mh.line("obj-stim", 0, gid, 0), mh.line("obj-half", 0, gid, 1)]
    lines += [mh.line("obj-gen-t", 0, "obj-record", 0), mh.line("obj-gen-q", 0, "obj-record", 1), mh.line("obj-stim", 1, "obj-record", 2),
              mh.line("obj-stim", 2, "obj-record", 3), mh.line("obj-gen-t", 0, "obj-mute-l", 0), mh.line("obj-gen-q", 0, "obj-mute-r", 0)]
    # the other three probe channels are unused: feed zeros so the probe's 7 channel contract holds
    for ch in (4, 5, 6):
        lines.append(mh.line("obj-gen-t", 1, "obj-record", ch))
    events = [(1000.0, "obj-gen-t", 0, f"fftn {n_to}"), (1000.0 + dt_ms, "obj-gen-q", 0, f"fftn {n_to}")]
    r = mh.run_case(f"hopphase_{dt_ms}", boxes, lines, probe_js=rt.PROBE_JS, probe_args="drums 0", settle_ms=2200, dur_ms=1500, channels=7, sr=rt.SR, events=events)
    return 10 * __import__("math").log10(max(r["nullE"] / max(r["energyD"], 1e-300), 1e-300))


if __name__ == "__main__":
    code = old_source(sys.argv[1])
    for n_to in (2048, 4096):
        for dt in (0.0, 3.0, 11.0):
            print(f"OLD core, Size change to {n_to} at 1000 ms, second instance {dt} ms later: T + Q vs input delayed 4096: null {run(code, dt, 1024, n_to):.1f} dB")
