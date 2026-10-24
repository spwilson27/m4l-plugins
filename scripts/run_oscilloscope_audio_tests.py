#!/usr/bin/env python3
"""Oscilloscope 1 Cyc checks on a sine and on real drum loops.

Run only inside the macos-01 VM (AGENTS.md section 1a). The host gate is
typecheck, build, and node tests. This runner plays audio through the analyzer
gen (the scope ring the device reads) and asks the same oscComputeFrame the UI
uses for one cycle.

Drum wavs are 16-bit PCM in $OSC_DRUM_DIR, or /tmp/drum_probe when that exists:
  kick, snare, hat, wingman, dnb, dnbroll, spacer.

Cases:
  sine220        220 Hz sine. One rise, frequency near 220, trace starts at 0.
  kick           kick one-shot body. One rise, pitch stays in the body range.
  snare / hat    one-shots. One rise, window shorter than the body period.
  wingman, dnb, dnbroll, spacer
                 loops from the start, plus a later slice of each loop
                 (dnb_mid, dnbroll_mid, spacer_mid). One visible rise.
"""

import array
import os
import struct
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

ROOT = mh.ROOT
GEN = open(os.path.join(ROOT, "src", "analyzer_core.genexpr"), encoding="utf-8").read()
CONFIG = open(os.path.join(ROOT, "src", "oscilloscope_config.js"), encoding="utf-8").read()
PROBE_BODY = open(os.path.join(ROOT, "tests", "oscilloscope_probe.js"), encoding="utf-8").read()
PROBE = os.path.join(ROOT, "tests", "out", "oscilloscope_audio_probe.js")

SETTLE_MS = 50
DUR_MS = 100


def drum_dir():
    env = os.environ.get("OSC_DRUM_DIR", "")
    if env and os.path.isdir(env):
        return env
    here = "/tmp/drum_probe"
    if os.path.isdir(here):
        return here
    raise SystemExit("set OSC_DRUM_DIR to the 16-bit drum wavs (kick.wav, snare.wav, ...)")


def wav_info(path):
    with wave.open(path, "rb") as w:
        return w.getnchannels(), w.getframerate(), w.getnframes()


def write_probe():
    os.makedirs(os.path.dirname(PROBE), exist_ok=True)
    with open(PROBE, "w", encoding="utf-8") as f:
        f.write(CONFIG)
        f.write("\n")
        f.write(PROBE_BODY)


def write_slice(wav_path, skip, count, out_path):
    """Write `count` stereo frames from `skip` as int32 length + float32 pairs.

    The loader pokes this into buffer~ before DSP. A text file of one line per
    sample was still being read when the render started, so the scope ring
    stayed empty.
    """
    with wave.open(wav_path, "rb") as w:
        channels = w.getnchannels()
        total = w.getnframes()
        skip = max(0, min(int(skip), max(0, total - 1)))
        w.setpos(skip)
        raw = w.readframes(count)
    pcm = array.array("h")
    pcm.frombytes(raw)
    frames = len(pcm) // channels
    floats = []
    for i in range(frames):
        floats.append(pcm[i * channels] / 32768.0)
        floats.append(pcm[i * channels + (1 if channels > 1 else 0)] / 32768.0)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<i", frames))
        f.write(struct.pack("<%df" % len(floats), *floats))
    return frames


def analyzer(boxes, lines):
    boxes += [
        mh.gen_box("dev-gen", GEN, 200, 240),
        mh.msg("dev-params", "f1 150, f2 1000, f3 6000", 200, 40, 220),
        mh.msg("dev-bind", "scope #0-analyzerscope", 200, 70, 220),
        mh.box("dev-buf", "buffer~ #0-analyzerscope @samps 17952", 200, 110, 280,
               numoutlets=2, outlettype=["float", "bang"]),
    ]
    lines += [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    return boxes, lines


def sine_chain():
    boxes = [
        mh.box("dev-tone", "cycle~ 220", 40, 160, 80, numinlets=2, outlettype=["signal"]),
        mh.box("dev-amp", "*~ 0.4", 40, 200, 60, numinlets=2, outlettype=["signal"]),
    ]
    lines = [
        mh.line("dev-tone", 0, "dev-amp", 0),
        mh.line("dev-amp", 0, "dev-gen", 0),
        mh.line("dev-amp", 0, "dev-gen", 1),
    ]
    return analyzer(boxes, lines)


def drum_chain(slice_path, samps, sr):
    loader = os.path.join(ROOT, "tests", "oscilloscope_wavload.js")
    # phasor~ sweeps 0..1 in exactly one buffer length, so index~ walks every sample once.
    rate = float(sr) / float(samps)
    boxes = [
        mh.box("dev-wav", "buffer~ drums @samps %d 2" % samps, 40, 80, 220,
               numoutlets=2, outlettype=["float", "bang"]),
        mh.box("dev-ph", "phasor~ %s" % rate, 40, 180, 110, numinlets=2, outlettype=["signal"]),
        mh.box("dev-sc", "*~ %d" % samps, 40, 220, 70, numinlets=2, outlettype=["signal"]),
        mh.box("dev-idx-l", "index~ drums 1", 40, 260, 110, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        mh.box("dev-idx-r", "index~ drums 2", 170, 260, 110, numinlets=2, numoutlets=2, outlettype=["signal", "signal"]),
        mh.box("dev-load", "js " + loader, 40, 120, 260),
        mh.msg("dev-fill", "fill " + slice_path, 40, 40, 360),
    ]
    lines = [
        mh.line("obj-load", 0, "dev-fill", 0),
        mh.line("dev-fill", 0, "dev-load", 0),
        mh.line("dev-ph", 0, "dev-sc", 0),
        mh.line("dev-sc", 0, "dev-idx-l", 0),
        mh.line("dev-sc", 0, "dev-idx-r", 0),
        mh.line("dev-idx-l", 0, "dev-gen", 0),
        mh.line("dev-idx-r", 0, "dev-gen", 1),
    ]
    return analyzer(boxes, lines)


def check(name, got):
    frame = float(got.get("frame", 0))
    if frame < 5:
        raise SystemExit("%s: gen frame counter did not move (%s)" % (name, got.get("frame")))
    scopepk = float(got.get("scopepk", 0))
    pas = float(got.get("pass", 0))
    zc = float(got.get("zc", 99))
    freq = float(got.get("freq", 0))
    windowms = float(got.get("windowms", 0))
    y0 = float(got.get("y0", 1))
    if scopepk < 0.02:
        raise SystemExit("%s: scope ring is quiet (%s), buffer peak %s frames %s" % (
            name, scopepk, got.get("wavpk"), got.get("wavn")))
    if pas < 0.02:
        raise SystemExit("%s: pass-through is quiet (%s)" % (name, pas))
    if name == "sine220":
        if not (210 <= freq <= 230):
            raise SystemExit("%s: freq %s" % (name, freq))
        if zc > 2:
            raise SystemExit("%s: rising zeros %s" % (name, zc))
        if abs(y0) > 0.15:
            raise SystemExit("%s: trace does not start near 0 (%s)" % (name, y0))
    elif name == "kick":
        if not (30 <= freq <= 90):
            raise SystemExit("%s: body pitch %s Hz (zc %s, %s ms, pk %s, wav %s)" % (
                name, freq, zc, windowms, scopepk, got.get("wavpk")))
        if zc > 3:
            raise SystemExit("%s: rising zeros %s" % (name, zc))
    elif name == "snare":
        if zc > 3:
            raise SystemExit("%s: rising zeros %s" % (name, zc))
        if windowms >= 2.5:
            raise SystemExit("%s: window %s ms" % (name, windowms))
    elif name == "hat":
        if zc > 3:
            raise SystemExit("%s: rising zeros %s" % (name, zc))
        if windowms >= 1.5:
            raise SystemExit("%s: window %s ms" % (name, windowms))
    else:
        if zc > 4:
            raise SystemExit("%s: rising zeros %s (freq %s Hz, %s ms)" % (name, zc, freq, windowms))
    print("ok", name, "zc", zc, "freq", round(freq, 1), "ms", round(windowms, 3),
          "y0", round(y0, 3), "pk", round(scopepk, 3))


def cases(names):
    out = []
    folder = None
    for name in names:
        if name == "sine220":
            out.append((name, sine_chain(), 48000, SETTLE_MS, DUR_MS))
            continue
        if folder is None:
            folder = drum_dir()
        kind = name
        at = 0.0
        if name == "dnb_mid":
            kind, at = "dnb", 0.95
        elif name == "dnbroll_mid":
            kind, at = "dnbroll", 2.25
        elif name == "spacer_mid":
            kind, at = "spacer", 0.45
        path = os.path.join(folder, kind + ".wav")
        if not os.path.isfile(path):
            raise SystemExit("%s: missing %s" % (name, path))
        _ch, sr, _n = wav_info(path)
        # One full scope ring, and nothing else, so the drawn window is this slice.
        start = int(round(at * sr))
        slice_path = os.path.join("/tmp", "osc_slice_%s.f32" % name)
        write_slice(path, start, 4096, slice_path)
        boxes, lines = drum_chain(slice_path, 4096, sr)
        dur_ms = 4096 * 1000.0 / sr
        out.append((name, (boxes, lines), sr, 0, dur_ms))
    return out


def main():
    wanted = sys.argv[1:] or [
        "sine220", "kick", "snare", "hat", "wingman",
        "dnb", "dnb_mid", "dnbroll", "dnbroll_mid", "spacer", "spacer_mid",
    ]
    write_probe()
    for name, chain, sr, settle_ms, dur_ms in cases(wanted):
        boxes, lines = chain
        got = mh.run_case(
            "osc_" + name, boxes, lines, probe_js=PROBE, probe_object="v8",
            settle_ms=settle_ms, dur_ms=dur_ms, channels=2, sr=sr,
        )
        check(name, got)


if __name__ == "__main__":
    main()
