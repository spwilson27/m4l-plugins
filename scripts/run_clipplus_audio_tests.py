#!/usr/bin/env python3
"""Clip+ audio cases on the Max harness (run inside the tart VM, never on the host).

  ceiling   hard clip holds a slammed sine at the -6 dB ceiling
  detail100 a quiet non-harmonic sine survives a loud clipped one
  detail0   the same quiet sine is erased by the ordinary clipper
  delta0    drive 0 delta is silent
  delta18   a driven hard clip's delta is not
  dcon      the 15 Hz highpass removes a DC offset
  dcoff     the same offset stays
  osoff     7 kHz hard clip aliases
  oson      4x oversampling drops that alias
  tpoff     a near-Nyquist square's samples sit under the ceiling while its true peak does not
  tpon      true peak pulls that reconstruction onto the ceiling
  lr_both   L/R Both plays 220 Hz on the left and 880 Hz on the right
  lr_l      L mode keeps the dry right channel
  lr_r      R mode keeps the dry left channel and the processed right
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spectral_common as sc
from minify_gen import minify_gen
import max_harness as mh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBE = os.path.join(ROOT, "tests", "clipplus_probe.js")

BASE = (
    "ingain 0, drive 0, detail 100, shape 0, sym 0, ceiling 0, outgain 0, "
    "on 1, dlt 0, dcon 0, oson 0, hlim 1, tpeak 0, autog 1"
)


def gen_code():
    src = os.path.join(ROOT, "src")
    text = sc.gen_code(os.path.join(src, "cepstrum_lib.genexpr"), os.path.join(src, "clipplus_core.genexpr"))
    return minify_gen(text)


def params(extra):
    return BASE + ", " + extra


def signal(mode):
    """Return (boxes, lines, left_id, right_id). Both outlets are `dev-sig` unless the case is stereo."""
    boxes = []
    lines = []
    if mode == "low":
        boxes += [
            mh.box("dev-osc", "cycle~ 80", 700, 200, 90, numinlets=2, outlettype=["signal"]),
            mh.box("dev-sig", "*~ 1", 700, 240, 70, numinlets=2, outlettype=["signal"]),
        ]
        lines.append(mh.line("dev-osc", 0, "dev-sig", 0))
    elif mode == "sine" or mode == "quiet":
        boxes += [
            mh.box("dev-osc", "cycle~ 220", 700, 200, 90, numinlets=2, outlettype=["signal"]),
            mh.box("dev-sig", "*~ 0.5" if mode == "sine" else "*~ 0.04", 700, 240, 70, numinlets=2, outlettype=["signal"]),
        ]
        lines.append(mh.line("dev-osc", 0, "dev-sig", 0))
    elif mode == "two":
        boxes += [
            mh.box("dev-a", "cycle~ 50", 700, 160, 90, numinlets=2, outlettype=["signal"]),
            mh.box("dev-ag", "*~ 0.5", 820, 160, 70, numinlets=2, outlettype=["signal"]),
            mh.box("dev-b", "cycle~ 1370", 700, 200, 90, numinlets=2, outlettype=["signal"]),
            mh.box("dev-bg", "*~ 0.02", 820, 200, 70, numinlets=2, outlettype=["signal"]),
            mh.box("dev-sig", "+~", 940, 180, 40, numinlets=2, numoutlets=1, outlettype=["signal"]),
        ]
        lines += [
            mh.line("dev-a", 0, "dev-ag", 0),
            mh.line("dev-b", 0, "dev-bg", 0),
            mh.line("dev-ag", 0, "dev-sig", 0),
            mh.line("dev-bg", 0, "dev-sig", 1),
        ]
    elif mode == "hi":
        boxes += [
            mh.box("dev-osc", "cycle~ 7000", 700, 200, 100, numinlets=2, outlettype=["signal"]),
            mh.box("dev-sig", "*~ 0.8", 820, 200, 70, numinlets=2, outlettype=["signal"]),
        ]
        lines.append(mh.line("dev-osc", 0, "dev-sig", 0))
    elif mode == "dc":
        boxes += [
            mh.box("dev-dc", "sig~ 0.3", 700, 160, 70, outlettype=["signal"]),
            mh.box("dev-osc", "cycle~ 100", 700, 200, 90, numinlets=2, outlettype=["signal"]),
            mh.box("dev-g", "*~ 0.05", 820, 200, 70, numinlets=2, outlettype=["signal"]),
            mh.box("dev-sig", "+~", 940, 180, 40, numinlets=2, numoutlets=1, outlettype=["signal"]),
        ]
        lines += [
            mh.line("dev-osc", 0, "dev-g", 0),
            mh.line("dev-dc", 0, "dev-sig", 0),
            mh.line("dev-g", 0, "dev-sig", 1),
        ]
    elif mode == "square":
        boxes += [
            mh.box("dev-osc", "cycle~ 11163", 700, 160, 110, numinlets=2, outlettype=["signal"]),
            mh.box("dev-clip", "clip~ -0.02 0.02", 820, 160, 120, numinlets=1, outlettype=["signal"]),
            mh.box("dev-sig", "*~ 49.5", 960, 160, 70, numinlets=2, outlettype=["signal"]),
        ]
        lines += [
            mh.line("dev-osc", 0, "dev-clip", 0),
            mh.line("dev-clip", 0, "dev-sig", 0),
        ]
    elif mode == "lr":
        # Independent tones so a dead right channel cannot hide behind a mono copy of the left.
        boxes += [
            mh.box("dev-losc", "cycle~ 220", 700, 160, 100, numinlets=2, outlettype=["signal"]),
            mh.box("dev-lsig", "*~ 0.4", 820, 160, 70, numinlets=2, outlettype=["signal"]),
            mh.box("dev-rosc", "cycle~ 880", 700, 210, 100, numinlets=2, outlettype=["signal"]),
            mh.box("dev-rsig", "*~ 0.25", 820, 210, 70, numinlets=2, outlettype=["signal"]),
        ]
        lines += [
            mh.line("dev-losc", 0, "dev-lsig", 0),
            mh.line("dev-rosc", 0, "dev-rsig", 0),
        ]
        return boxes, lines, "dev-lsig", "dev-rsig"
    elif mode == "mid" or mode == "side":
        # One oscillator, so mid is L == R and side is L == -R.
        boxes += [
            mh.box("dev-osc", "cycle~ 220", 700, 160, 100, numinlets=2, outlettype=["signal"]),
            mh.box("dev-lsig", "*~ 0.5", 820, 150, 70, numinlets=2, outlettype=["signal"]),
            mh.box("dev-rsig", "*~ -0.5" if mode == "side" else "*~ 0.5", 820, 190, 70, numinlets=2, outlettype=["signal"]),
        ]
        lines += [
            mh.line("dev-osc", 0, "dev-lsig", 0),
            mh.line("dev-osc", 0, "dev-rsig", 0),
        ]
        return boxes, lines, "dev-lsig", "dev-rsig"
    else:
        raise SystemExit("unknown stimulus " + mode)
    return boxes, lines, "dev-sig", "dev-sig"


def device(code, case):
    boxes, lines, left_id, right_id = signal(case["mode"])
    boxes += [
        mh.gen_box("dev-gen", code, 200, 260, numinlets=2, numoutlets=2),
        mh.msg("dev-params", case["params"], 40, 40, 920),
        mh.msg("dev-bind", "scope #0-clipscope", 40, 80, 180),
        mh.box("dev-buf", "buffer~ #0-clipscope 1280 1", 40, 120, 200, numoutlets=2, outlettype=["float", "bang"]),
    ]
    lines += [
        mh.line("obj-load", 0, "dev-params", 0),
        mh.line("obj-load", 0, "dev-bind", 0),
        mh.line("dev-params", 0, "dev-gen", 0),
        mh.line("dev-bind", 0, "dev-gen", 0),
        mh.line(left_id, 0, "dev-gen", 0),
        mh.line(right_id, 0, "dev-gen", 1),
        mh.line("dev-gen", 0, "obj-record", 0),
        mh.line("dev-gen", 1, "obj-record", 1),
        mh.line("dev-gen", 0, "obj-mute-l", 0),
        mh.line("dev-gen", 1, "obj-mute-r", 0),
        mh.line("obj-mute-l", 0, "obj-dac", 0),
        mh.line("obj-mute-r", 0, "obj-dac", 1),
    ]
    return boxes, lines


def cases():
    return [
        {"name": "ceiling", "mode": "sine", "freqs": "220", "params": params("drive 18, shape 100, detail 0, hlim 1, autog 0, ceiling -6, oson 0, tpeak 0")},
        {"name": "detail100", "mode": "two", "freqs": "50 1370", "params": params("drive 18, shape 100, detail 100, hlim 0, autog 0")},
        {"name": "detail0", "mode": "two", "freqs": "50 1370", "params": params("drive 18, shape 100, detail 0, hlim 0, autog 0")},
        {"name": "delta0", "mode": "sine", "freqs": "220", "params": params("drive 0, detail 0, dlt 1, hlim 1, autog 1")},
        {"name": "delta18", "mode": "sine", "freqs": "220", "params": params("drive 18, shape 100, detail 0, dlt 1, hlim 1, autog 0")},
        {"name": "dcon", "mode": "dc", "freqs": "100", "params": params("drive 0, detail 0, dcon 1, hlim 0, autog 0")},
        {"name": "dcoff", "mode": "dc", "freqs": "100", "params": params("drive 0, detail 0, dcon 0, hlim 0, autog 0")},
        {"name": "osoff", "mode": "hi", "freqs": "7000 13000", "params": params("drive 12, shape 100, detail 0, hlim 1, autog 0, oson 0")},
        {"name": "oson", "mode": "hi", "freqs": "7000 13000", "params": params("drive 12, shape 100, detail 0, hlim 1, autog 0, oson 1")},
        {"name": "tpoff", "mode": "square", "freqs": "", "params": params("drive 0, detail 0, hlim 0, autog 0, tpeak 0, ceiling 0")},
        {"name": "tpon", "mode": "square", "freqs": "", "params": params("drive 0, detail 0, hlim 0, autog 0, tpeak 1, ceiling 0")},
        # L/R, detail 100 (the STFT path). Left is 220 Hz, right is 880 Hz.
        # Both plays both processed channels. L plays processed left + dry right. R plays dry left + processed right.
        {"name": "lr_both", "mode": "lr", "freqs": "220 880", "params": params("chmode 0, detail 100, drive 0, hlim 1, oson 0")},
        {"name": "lr_l", "mode": "lr", "freqs": "220 880", "params": params("chmode 1, detail 100, drive 0, hlim 1, oson 0")},
        {"name": "lr_r", "mode": "lr", "freqs": "220 880", "params": params("chmode 2, detail 100, drive 0, hlim 1, oson 0")},
        # Hot left (0.4) and quieter right (0.25), drive 18. Clipped peaks sit on the ceiling;
        # the channel that is not fed to the clipper stays at its input level. Both outlets stay alive.
        {"name": "clip_both", "mode": "lr", "freqs": "220 880", "params": params("chmode 0, msmode 0, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "clip_l", "mode": "lr", "freqs": "220 880", "params": params("chmode 1, msmode 0, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "clip_r", "mode": "lr", "freqs": "220 880", "params": params("chmode 2, msmode 0, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "clip_both_stft", "mode": "lr", "freqs": "220 880", "params": params("chmode 0, msmode 0, drive 18, shape 100, detail 100, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "clip_l_stft", "mode": "lr", "freqs": "220 880", "params": params("chmode 1, msmode 0, drive 18, shape 100, detail 100, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "clip_r_stft", "mode": "lr", "freqs": "220 880", "params": params("chmode 2, msmode 0, drive 18, shape 100, detail 100, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "clip_l_os", "mode": "lr", "freqs": "220 880", "params": params("chmode 1, msmode 0, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 1, tpeak 0")},
        # M clips the mid and leaves the side alone. S does the opposite. Both channels of the decoded stereo stay up.
        {"name": "ms_mid_m", "mode": "mid", "freqs": "220", "params": params("msmode 1, chmode 1, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "ms_mid_s", "mode": "mid", "freqs": "220", "params": params("msmode 1, chmode 2, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "ms_side_m", "mode": "side", "freqs": "220", "params": params("msmode 1, chmode 1, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "ms_side_s", "mode": "side", "freqs": "220", "params": params("msmode 1, chmode 2, drive 18, shape 100, detail 0, hlim 1, autog 0, oson 0, tpeak 0")},
        {"name": "ms_side_both", "mode": "side", "freqs": "220", "params": params("msmode 1, chmode 0, drive 18, shape 100, detail 100, hlim 1, autog 0, oson 0, tpeak 0")},
        # GR is the dB the driven peak sits above the ceiling. A −28 dB tone and a
        # −6 dB tone stay at 0 when drive rises 0.8 dB, on both the STFT and the waveshaper.
        # A −6 dB tone with 12 dB of drive is 6 dB over and reports that, not the soft-knee sag.
        {"name": "gr_quiet", "mode": "quiet", "freqs": "220", "params": params("drive 0.8, detail 100, shape 0, ceiling 0, autog 0")},
        {"name": "gr_drive08", "mode": "sine", "freqs": "220", "params": params("drive 0.8, detail 100, shape 0, ceiling 0, autog 0")},
        {"name": "gr_drive08_wave", "mode": "sine", "freqs": "220", "params": params("drive 0.8, detail 0, shape 0, ceiling 0, autog 0")},
        {"name": "gr_over", "mode": "sine", "freqs": "220", "params": params("drive 12, detail 100, shape 0, ceiling 0, autog 0")},
        # 80 Hz under a low shelf. The input meter's RMS and peak are the same post-shelf signal,
        # so a sine's RMS sits about 3 dB under its peak.
        {"name": "shelf_rms", "mode": "low", "freqs": "80", "params": params("drive 0, detail 0, shape 0, hlim 0, autog 0, filton 1, filttype 0, filtfreq 250, filtgain 6, filtq 0.707")},
    ]


def _stereo_kept(name, meta, errors):
    """220 Hz stays on the left, 880 Hz on the right, and neither outlet is silent."""
    if meta.get("m0", 0) < 0.15:
        errors.append(f"{name}: left lost its 220 Hz tone ({meta.get('m0')})")
    if meta.get("rm1", 0) < 0.08:
        errors.append(f"{name}: right lost its 880 Hz tone ({meta.get('rm1')})")
    if meta.get("m1", 1) > 0.08:
        errors.append(f"{name}: left picked up the right tone ({meta.get('m1')})")
    if meta.get("rm0", 1) > 0.08:
        errors.append(f"{name}: right picked up the left tone ({meta.get('rm0')})")
    if meta.get("peak", 0) < 0.1:
        errors.append(f"{name}: left output is quiet ({meta.get('peak')})")
    if meta.get("rpeak", 0) < 0.1:
        errors.append(f"{name}: right output is quiet ({meta.get('rpeak')})")


def check(name, meta, got, errors):
    peak = meta.get("peak", 99)
    mean = meta.get("mean", 99)
    if meta.get("nan", 1) != 0:
        errors.append(f"{name}: non-finite samples")
    if name == "ceiling":
        lim = 10 ** (-6 / 20)
        if peak > lim * 1.02:
            errors.append(f"{name}: peak {peak} exceeds the -6 dB ceiling")
        if peak < lim * 0.5:
            errors.append(f"{name}: peak {peak} never reached the ceiling")
    elif name == "detail100":
        if meta.get("m1", 0) < 0.12:
            errors.append(f"{name}: quiet sine was not kept ({meta.get('m1')})")
    elif name == "detail0":
        kept = got["detail100"].get("m1", 1)
        if meta.get("m1", 1) > kept * 0.35:
            errors.append(f"{name}: quiet sine still present ({meta.get('m1')} vs {kept})")
    elif name == "delta0":
        if peak > 0.02:
            errors.append(f"{name}: delta at drive 0 is not silent ({peak})")
    elif name == "delta18":
        if peak < 0.15:
            errors.append(f"{name}: driven delta is quiet ({peak})")
    elif name == "dcon":
        if abs(mean) > 0.02:
            errors.append(f"{name}: DC remains ({mean})")
        if meta.get("m0", 0) < 0.02:
            errors.append(f"{name}: the tone was removed too ({meta.get('m0')})")
    elif name == "dcoff":
        if mean < 0.2:
            errors.append(f"{name}: DC was removed ({mean})")
    elif name == "oson":
        off = got["osoff"].get("m1", 0)
        on = meta.get("m1", 1)
        if not (off > 0.05 and on < off * 0.7):
            errors.append(f"{name}: alias {on} did not drop below {off}")
    elif name == "tpoff":
        if meta.get("tp", 0) < 1.15:
            errors.append(f"{name}: no intersample over ({meta.get('tp')})")
        if peak > 1.05:
            errors.append(f"{name}: samples already over the ceiling ({peak})")
    elif name == "tpon":
        off = got["tpoff"].get("tp", 0)
        tp = meta.get("tp", 99)
        if tp > 1.08 or (off > 0 and tp > off * 0.9):
            errors.append(f"{name}: true peak {tp} (was {off})")
    elif name in ("lr_both", "lr_l", "lr_r"):
        # 220 Hz belongs on the left, 880 Hz on the right, in every channel mode.
        if meta.get("m0", 0) < 0.2:
            errors.append(f"{name}: left lost its 220 Hz tone ({meta.get('m0')})")
        if meta.get("rm1", 0) < 0.12:
            errors.append(f"{name}: right lost its 880 Hz tone ({meta.get('rm1')})")
        if meta.get("m1", 1) > 0.05:
            errors.append(f"{name}: left picked up the right tone ({meta.get('m1')})")
        if meta.get("rm0", 1) > 0.05:
            errors.append(f"{name}: right picked up the left tone ({meta.get('rm0')})")
        if meta.get("rpeak", 0) < 0.1:
            errors.append(f"{name}: right output is quiet ({meta.get('rpeak')})")
        if meta.get("peak", 0) < 0.1:
            errors.append(f"{name}: left output is quiet ({meta.get('peak')})")
    elif name in ("clip_both", "clip_l", "clip_r", "clip_both_stft", "clip_l_stft", "clip_r_stft", "clip_l_os"):
        _stereo_kept(name, meta, errors)
        # Left stays at its dry 0.5 only in R. Right stays at its dry 0.2 only in L.
        if name in ("clip_r", "clip_r_stft"):
            if not (0.40 <= peak <= 0.62):
                errors.append(f"{name}: left was fed to the clipper ({peak})")
        elif peak < 0.70:
            errors.append(f"{name}: left was not clipped ({peak})")
        rp = meta.get("rpeak", 0)
        if name in ("clip_l", "clip_l_stft", "clip_l_os"):
            if not (0.14 <= rp <= 0.30):
                errors.append(f"{name}: right was fed to the clipper ({rp})")
        elif rp < 0.70:
            errors.append(f"{name}: right was not clipped ({rp})")
    elif name in ("ms_mid_m", "ms_mid_s", "ms_side_m", "ms_side_s", "ms_side_both"):
        if peak < 0.2 or meta.get("rpeak", 0) < 0.2:
            errors.append(f"{name}: a channel went quiet (L {peak} R {meta.get('rpeak')})")
        mid = meta.get("midrms", 0)
        side = meta.get("siderms", 0)
        # A clipped mid or side is a square at the ceiling, then the decode scales it by 0.707,
        # so each speaker peaks near 0.707 and the sum/difference rms is near 1.4. Dry stays at 0.5.
        if name in ("ms_mid_m",):
            if mid < 1.1 or side > 0.15 or not (0.62 <= peak <= 0.80):
                errors.append(f"{name}: mid was not clipped (mid {mid} side {side} peak {peak})")
        elif name == "ms_mid_s":
            if not (0.45 <= mid <= 0.85) or side > 0.15 or peak > 0.65:
                errors.append(f"{name}: side mode clipped the mid (mid {mid} side {side} peak {peak})")
        elif name == "ms_side_m":
            if not (0.45 <= side <= 0.85) or mid > 0.15 or peak > 0.65:
                errors.append(f"{name}: mid mode clipped the side (mid {mid} side {side} peak {peak})")
        elif name in ("ms_side_s", "ms_side_both"):
            if side < 1.1 or mid > 0.2 or not (0.62 <= peak <= 0.80):
                errors.append(f"{name}: side was not clipped (mid {mid} side {side} peak {peak})")
    elif name in ("gr_quiet", "gr_drive08", "gr_drive08_wave"):
        if meta.get("scframe", 0) < 100:
            errors.append(f"{name}: scope frame {meta.get('scframe')} (meter was not read)")
        if meta.get("gr", 99) > 0.05:
            errors.append(f"{name}: GR {meta.get('gr')} on a signal under the ceiling")
    elif name == "gr_over":
        if meta.get("scframe", 0) < 100:
            errors.append(f"{name}: scope frame {meta.get('scframe')} (meter was not read)")
        gr = meta.get("gr", 0)
        if abs(gr - 5.97) > 0.35:
            errors.append(f"{name}: GR {gr} want about 6.0 dB over the ceiling")
    elif name == "shelf_rms":
        pk = meta.get("drvpk", 0)
        ms = meta.get("inms", 0)
        rms = (ms * 0.5) ** 0.5 if ms > 0 else 0
        if meta.get("scframe", 0) < 100 or pk < 0.05:
            errors.append(f"{name}: meter was not read (peak {pk}, frame {meta.get('scframe')})")
        elif not (0.6 < rms / pk < 0.85):
            errors.append(f"{name}: RMS {rms:.4f} is not ~3 dB under the post-shelf peak {pk:.4f}")


def main():
    want = set(sys.argv[1:])
    code = gen_code()
    got = {}
    errors = []
    selected = [c for c in cases() if not want or c["name"] in want]
    # Comparisons need their partner even if the user named one side.
    names = {c["name"] for c in selected}
    if "detail0" in names and "detail100" not in names:
        selected = [c for c in cases() if c["name"] == "detail100"] + selected
    if "oson" in names and "osoff" not in names:
        selected = [c for c in cases() if c["name"] == "osoff"] + selected
    if "tpon" in names and "tpoff" not in names:
        selected = [c for c in cases() if c["name"] == "tpoff"] + selected
    for case in selected:
        boxes, lines = device(code, case)
        meta = mh.run_case(
            "clipplus_" + case["name"], boxes, lines, probe_js=PROBE, probe_args=case["freqs"],
            settle_ms=500, dur_ms=400, channels=2, sr=48000, mode="nrt",
        )
        got[case["name"]] = meta
        print(f"--- {case['name']} peak {meta.get('peak')} rpeak {meta.get('rpeak')} mean {meta.get('mean')} tp {meta.get('tp')} m0 {meta.get('m0')} m1 {meta.get('m1')} rm0 {meta.get('rm0')} rm1 {meta.get('rm1')} wall {meta.get('harness_wall_s'):.1f}s")
        if not want or case["name"] in want:
            check(case["name"], meta, got, errors)
    if errors:
        print("FAILED")
        for e in errors:
            print("  " + e)
        sys.exit(1)
    print(f"clipplus audio: {len(selected)} cases ok")


if __name__ == "__main__":
    main()
