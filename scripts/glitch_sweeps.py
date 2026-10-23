"""Parameter sensitivity sweeps for Glitch (data + checks; run by scripts/run_glitch_audio_tests.py, inside the VM).

Each sweep renders ONE module (or one spectral sub-op) alone, with several parameter variants one after the other in a single Max
launch (slot k = variant k, the weights switch between cycles, see sweep_case() in the runner). The probe (tests/glitch_probe.js
analyzeSweep) reduces every variant to a few numbers and the level difference between every two variants; this file says which numbers
must move, and in which direction, for each parameter. No sweep changes anything but the parameters it names.

Metric table (probe name -> what it measures, used by the checks below)
  difL / difR  dB, error of the output against the dry input delayed by the device latency (0 dB = as loud as the input; < -60 = identical)
  pair(a, b)   dB, waveform difference of two variants (< -60 = identical renders; every variant sees the same input at the same beat phase)
  cent         spectral centroid (Hz)               flat      spectral flatness (dB, lower = peakier / more tonal)
  hf           HF (4..16 kHz) over LF (60..1k) dB   peakhz    strongest spectral line (Hz)
  nonfund      dB of the energy more than 60 Hz from the strongest line (noisiness of a tone)
  acLag/acPk   lag (samples) / height of the short-term autocorrelation peak (comb pitch); acLong the same for 800..30000 samples (loops)
  perMs        period (ms) of the block-rms envelope (gating, tape stop, chopper);  modd depth of that envelope (std / mean)
  centPer / centStd  period (ms) / spread of the frame-wise centroid (phaser sweeps)
  trend        dB, last third of the window against the first (decay of repeats)
  maxd2        largest second difference (click size)
  eL<j> / eR<j> dB, mean square of the L / R output in a short window at offset j (ms list of the sweep) after the burst onset; eRef the burst itself
  rmsL         linear rms of the output;  lr  (L-R)^2 over (L^2+R^2): stereo width
All stimuli are mono (the same signal in L and R), so every stereo effect (Ping Pong, Slapback offset, Reverb) is measured as it appears from a
centred source.
"""

import copy
import math

NOISE, SINE, MIX = "noise", "sine", "mix"


def merge(base, over):
    d = copy.deepcopy(base)
    for inst, vals in over.items():
        d.setdefault(inst, {}).update(vals)
    return d


class Res(object):
    """Access to the numbers of one finished sweep: R.m(label, metric), R.pair(a, b)."""

    def __init__(self, labels, r):
        self.labels, self.r = labels, r

    def m(self, label, name):
        return self.r["v%d_%s" % (self.labels.index(label), name)]

    def pair(self, a, b):
        i, j = sorted((self.labels.index(a), self.labels.index(b)))
        return self.r["pair_%d_%d" % (i, j)]


class Chk(object):
    """Collects (ok, message) tuples."""

    def __init__(self, R):
        self.R, self.out = R, []

    def t(self, cond, msg):
        self.out.append((bool(cond), msg))

    def differ(self, a, b, what, thr=-30.0):
        v = self.R.pair(a, b)
        self.t(v > thr, "%s: %s vs %s must sound different (pair %.1f dB, need > %.0f)" % (what, a, b, v, thr))

    def same(self, a, b, what, thr=-60.0):
        v = self.R.pair(a, b)
        self.t(v < thr, "%s: %s vs %s must be identical (pair %.1f dB, need < %.0f)" % (what, a, b, v, thr))

    def gt(self, a, b, metric, delta, what):
        va, vb = self.R.m(a, metric), self.R.m(b, metric)
        self.t(va > vb + delta, "%s: %s(%s)=%.3g must exceed %s(%s)=%.3g by %.3g" % (what, metric, a, va, metric, b, vb, delta))

    def near(self, a, metric, target, rel, what, absol=0.0):
        va = self.R.m(a, metric)
        self.t(abs(va - target) <= max(abs(target) * rel, absol), "%s: %s(%s)=%.4g should be %.4g (+-%.0f%%)" % (what, metric, a, va, target, rel * 100))

    def lin(self, full, half, what, metric="difL", tol=3.0):
        """Mix 0.5 halves the processed part: the error against the dry input drops by 6.02 dB."""
        d = self.R.m(half, metric) - self.R.m(full, metric)
        self.t(abs(d - (-6.02)) <= tol, "%s: Mix 50%% changes %s by %.1f dB (want -6.0 +-%.0f)" % (what, metric, d, tol))


SWEEPS = []


def sweep(sid, stim, base, variants, checks, win=(700, 2000), echo=None, echo_w=10, label=None, cyc=2000):
    """cyc: cycle length in ms (the stimulus period). Beat-slotted modules (Ratchet) decide at a span boundary with whatever the parameters are at
    that moment, so a variant's first span still sees the previous cycle's default parameters: those sweeps use a longer cycle and measure from
    the second span on."""
    SWEEPS.append({"cyc": cyc, "id": sid, "stim": stim, "base": base, "variants": variants, "checks": checks, "win": win, "echo": echo or {}, "echo_w": echo_w, "label": label or sid})


def V(label, **over):
    """Variant: V("hi", filt={"cutoff": 4000}) (merged onto the sweep's base)."""
    return (label, over)


# ------------------------------------------------------------------------------------------------------------------ distortion
for _d in ("drvA", "drvB"):
    def _drive(R, d=_d):
        c = Chk(R)
        c.gt("d24", "d0", "difL", 3, d + ".drive")
        c.t(R.m("t800", "cent") < R.m("ref", "cent") * 0.6, d + ".tone: 800 Hz low-pass lowers the centroid (%.0f vs %.0f)" % (R.m("t800", "cent"), R.m("ref", "cent")))
        for a, b in (("ref", "m1"), ("ref", "m2"), ("ref", "m3"), ("m1", "m2"), ("m2", "m3")):
            c.differ(a, b, d + ".mode")
        c.lin("ref", "half", d + ".Mix")
        return c.out
    sweep("drive_" + _d, NOISE, {_d: {"wet": 1, "mode": 0, "drive": 12, "tone": 20000}},
          [V("ref"), V("d0", **{_d: {"drive": 0}}), V("d24", **{_d: {"drive": 24}}), V("m1", **{_d: {"mode": 1}}), V("m2", **{_d: {"mode": 2}}), V("m3", **{_d: {"mode": 3}}),
           V("t800", **{_d: {"tone": 800}}), V("half", **{_d: {"wet": 0.5}})], _drive)


def _filt_a(R):
    c = Chk(R)
    c.t(R.m("hp", "cent") > R.m("lp", "cent") * 3, "filt.type: HP centroid %.0f far above LP %.0f" % (R.m("hp", "cent"), R.m("lp", "cent")))
    c.t(R.m("c4000", "cent") > R.m("c200", "cent") * 3, "filt.cutoff: 4 kHz vs 200 Hz low-pass centroid %.0f vs %.0f" % (R.m("c4000", "cent"), R.m("c200", "cent")))
    for a, b in (("lp", "bp"), ("bp", "hp"), ("lp", "nt")):
        c.differ(a, b, "filt.type")
    c.lin("lp", "half", "filt.Mix")
    return c.out


sweep("filter_a", NOISE, {"filt": {"wet": 1, "type": 0, "cutoff": 1000, "res": 0.3}},
      [V("lp"), V("bp", filt={"type": 1}), V("hp", filt={"type": 2}), V("nt", filt={"type": 3}), V("c200", filt={"cutoff": 200}), V("c4000", filt={"cutoff": 4000}),
       V("half", filt={"wet": 0.5})], _filt_a)


def _filt_b(R):
    c = Chk(R)
    c.t(R.m("r1", "flat") < R.m("r0", "flat") - 2, "filt.res: resonance makes the band-pass peakier (flat %.1f vs %.1f dB)" % (R.m("r1", "flat"), R.m("r0", "flat")))
    c.differ("r0", "r1", "filt.res")
    return c.out


sweep("filter_b", NOISE, {"filt": {"wet": 1, "type": 1, "cutoff": 1000, "res": 0.3}}, [V("r0", filt={"res": 0.0}), V("r1", filt={"res": 1.0})], _filt_b)


def _form(R):
    c = Chk(R)
    c.differ("va", "vi", "form.vowel")
    c.differ("vi", "vu", "form.vowel")
    c.t(R.m("sp12", "cent") > R.m("sm12", "cent") * 1.3, "form.shift: +12 st raises the centroid (%.0f vs %.0f)" % (R.m("sp12", "cent"), R.m("sm12", "cent")))
    c.t(R.m("r1", "flat") < R.m("r0", "flat") - 1, "form.res: more resonance, peakier (flat %.1f vs %.1f)" % (R.m("r1", "flat"), R.m("r0", "flat")))
    c.lin("va", "half", "form.Mix")
    return c.out


sweep("formant", NOISE, {"form": {"wet": 1, "vowel": 0, "shift": 0, "res": 0.5}},
      [V("va"), V("vi", form={"vowel": 2}), V("vu", form={"vowel": 4}), V("sm12", form={"shift": -12}), V("sp12", form={"shift": 12}), V("r0", form={"res": 0.0}),
       V("r1", form={"res": 1.0}), V("half", form={"wet": 0.5})], _form)


def _comb(R):
    c = Chk(R)
    c.near("f220", "acLag", 48000.0 / 220, 0.04, "comb.freq 220 Hz")
    c.near("f880", "acLag", 48000.0 / 880, 0.06, "comb.freq 880 Hz")
    c.gt("fb09", "fb02", "acPk", 0.1, "comb.fb")
    c.near("fbn", "acLag", 2 * 48000.0 / 220, 0.05, "comb.fb negative (odd harmonics: the autocorrelation peaks at 2T)")
    c.t(R.m("d1k", "flat") > R.m("f220", "flat") + 1, "comb.damp: 1 kHz damping leaves comb peaks only in the lows, the spectrum is flatter (%.1f vs %.1f dB)" % (R.m("d1k", "flat"), R.m("f220", "flat")))
    c.lin("f220", "half", "comb.Mix")
    return c.out


sweep("comb", NOISE, {"comb": {"wet": 1, "freq": 220, "fb": 0.8, "damp": 16000}},
      [V("f220"), V("f880", comb={"freq": 880}), V("fb02", comb={"fb": 0.2}), V("fb09", comb={"fb": 0.9}), V("fbn", comb={"fb": -0.8}), V("d1k", comb={"damp": 1000}),
       V("half", comb={"wet": 0.5})], _comb)


def _phas_a(R):
    c = Chk(R)
    c.near("hz3", "bandPer", 1000 / 3.0, 0.2, "phas.hz 3")
    c.near("hz8", "bandPer", 1000 / 8.0, 0.25, "phas.hz 8")
    c.t(R.m("dep01", "bandStd") < R.m("hz3", "bandStd") * 0.6, "phas.depth: 0.1 sweeps less than 1.0 (500..3k band level spread %.2f vs %.2f dB)" % (R.m("dep01", "bandStd"), R.m("hz3", "bandStd")))
    c.differ("hz3", "st0", "phas.stages")
    c.differ("fb0", "fb09", "phas.fb")
    c.t(R.m("fb09", "flat") < R.m("fb0", "flat"), "phas.fb: feedback deepens the notches (flat %.1f vs %.1f)" % (R.m("fb09", "flat"), R.m("fb0", "flat")))
    c.lin("hz3", "half", "phas.Mix")
    return c.out


sweep("phaser_a", NOISE, {"phas": {"wet": 1, "stages": 3, "sync": 0, "hz": 3, "div": 0, "depth": 1, "fb": 0.5}},
      [V("hz3"), V("hz8", phas={"hz": 8}), V("dep01", phas={"depth": 0.1}), V("fb0", phas={"fb": 0.0}), V("fb09", phas={"fb": 0.9}), V("st0", phas={"stages": 0}),
       V("half", phas={"wet": 0.5})], _phas_a)


def _phas_b(R):
    c = Chk(R)
    c.near("sy0", "bandPer", 250, 0.2, "phas.div 1/8 (sync)")
    c.near("sy1", "bandPer", 500, 0.2, "phas.div 1/4 (sync)")
    c.differ("sy0", "sy1", "phas.div")
    c.differ("sy1", "free", "phas.sync")
    return c.out


sweep("phaser_b", NOISE, {"phas": {"wet": 1, "stages": 3, "sync": 1, "hz": 3, "div": 0, "depth": 1, "fb": 0.5}},
      [V("sy0"), V("sy1", phas={"div": 1}), V("free", phas={"sync": 0})], _phas_b)


def _crush(R):
    c = Chk(R)
    c.t(R.m("ref", "difL") < -70, "crush: 16 bits, no downsample is transparent (%.1f dB)" % R.m("ref", "difL"))
    c.gt("b4", "ref", "difL", 20, "crush.bits 16 -> 4")
    c.gt("b1", "b4", "difL", 3, "crush.bits 4 -> 1")
    c.gt("r8", "ref", "difL", 15, "crush.rate x1 -> x8")
    c.differ("j0", "j1", "crush.jitter")
    c.gt("j1", "j0", "nonfund", 0.3, "crush.jitter (a jittered hold is noisier)")
    c.lin("b4", "b4half", "crush.Mix")
    return c.out


sweep("crush", SINE, {"crush": {"wet": 1, "bits": 16, "rate": 1, "jitter": 0}},
      [V("ref"), V("b4", crush={"bits": 4}), V("b1", crush={"bits": 1}), V("r8", crush={"rate": 8}), V("r32", crush={"rate": 32}), V("j0", crush={"rate": 6}),
       V("j1", crush={"rate": 6, "jitter": 1}), V("b4half", crush={"bits": 4, "wet": 0.5})], _crush)


def _rect(R):
    c = Chk(R)
    c.near("full", "peakhz", 880, 0.03, "rect.mode Full doubles the frequency")
    c.near("half", "peakhz", 440, 0.03, "rect.mode Half keeps the fundamental")
    c.differ("half", "asym", "rect.mode")
    c.differ("full", "asym", "rect.mode")
    c.lin("half", "half50", "rect.Mix")
    return c.out


sweep("rectify", SINE, {"rect": {"wet": 1, "mode": 0}},
      [V("half"), V("full", rect={"mode": 1}), V("asym", rect={"mode": 2}), V("half50", rect={"wet": 0.5})], _rect)


def _fm(R):
    c = Chk(R)
    c.gt("i1", "i0", "difL", 10, "fm.index")
    c.t(R.m("r32", "cent") > R.m("r025", "cent") * 1.3, "fm.ratio: a 3.5 kHz modulator spreads the sidebands (centroid %.0f vs %.0f)" % (R.m("r32", "cent"), R.m("r025", "cent")))
    c.differ("ref", "self", "fm.mode")
    c.differ("r025", "r32", "fm.ratio")
    c.lin("ref", "half", "fm.Mix")
    return c.out


sweep("fm", SINE, {"fm": {"wet": 1, "mode": 0, "ratio": 4, "index": 0.6}},
      [V("ref"), V("self", fm={"mode": 1, "ratio": 8, "index": 0.8}), V("r025", fm={"ratio": 0.25}), V("r32", fm={"ratio": 32}), V("i0", fm={"index": 0.0}), V("i1", fm={"index": 1.0}),
       V("half", fm={"wet": 0.5})], _fm)


def _corr_a(R):
    c = Chk(R)
    c.t(R.m("ref", "difL") < -60, "corr: chance 1 with flips / wrap / drop 0 passes the signal (%.1f dB)" % R.m("ref", "difL"))
    c.t(R.m("ch0", "difL") < -60, "corr.chance 0: nothing is corrupted (%.1f dB)" % R.m("ch0", "difL"))
    c.gt("fl", "ref", "difL", 15, "corr.flips")
    c.gt("wr", "ref", "difL", 30, "corr.wrap 0.5")
    c.gt("wr1", "ref", "difL", 30, "corr.wrap 1")
    c.gt("dr", "ref", "difL", 30, "corr.drop")
    c.gt("ch5", "ch0", "difL", 20, "corr.chance 0.5")
    c.t(R.m("full", "difL") >= R.m("ch5", "difL") - 1.5, "corr.chance: 1 corrupts at least as much as 0.5")
    return c.out


_c = {"flips": 1.0, "wrap": 0.5, "drop": 1.0}
sweep("corrupt_a", SINE, {"corr": {"wet": 1, "div": 2, "chance": 1.0, "flips": 0.0, "wrap": 0.0, "drop": 0.0}},
      [V("ref"), V("fl", corr={"flips": 1.0}), V("wr", corr={"wrap": 0.5}), V("wr1", corr={"wrap": 1.0}), V("dr", corr={"drop": 1.0}), V("ch0", corr=dict(_c, chance=0.0)),
       V("ch5", corr=dict(_c, chance=0.5)), V("full", corr=dict(_c))], _corr_a)


def _corr_b(R):
    c = Chk(R)
    c.differ("d2", "d6", "corr.div (slot length)")
    c.differ("d2", "d4", "corr.div")
    return c.out


sweep("corrupt_b", SINE, {"corr": {"wet": 1, "div": 2, "chance": 0.5, "flips": 1.0, "wrap": 0.5, "drop": 0.5}}, [V("d2"), V("d4", corr={"div": 4}), V("d6", corr={"div": 6})], _corr_b)


def _ring(R):
    c = Chk(R)
    c.near("ref", "peakhz", 740, 0.02, "ring.freq: shift +300 Hz of 440")
    c.near("shm", "peakhz", 140, 0.06, "ring.freq: shift -300 Hz")
    c.t(min(abs(R.m("rm", "peakhz") - 140), abs(R.m("rm", "peakhz") - 740)) < 20, "ring mode: sum or difference line (%.0f Hz)" % R.m("rm", "peakhz"))
    c.t(min(abs(R.m("rm6", "peakhz") - 160), abs(R.m("rm6", "peakhz") - 1040)) < 30, "ring.freq 600: sum or difference line (%.0f Hz)" % R.m("rm6", "peakhz"))
    c.differ("ref", "rm", "ring.mode")
    c.lin("ref", "half", "ring.Mix")
    return c.out


sweep("ring", SINE, {"ring": {"wet": 1, "mode": 1, "freq": 300}},
      [V("ref"), V("shm", ring={"freq": -300}), V("rm", ring={"mode": 0}), V("rm6", ring={"mode": 0, "freq": 600}), V("half", ring={"wet": 0.5})], _ring)


# ------------------------------------------------------------------------------------------------------------------ time
def _stut(R):
    c = Chk(R)
    c.near("ref", "acLong", 6000, 0.02, "stut.div 1/16 loop length")
    c.near("d4", "acLong", 12000, 0.02, "stut.div 1/8 loop length")
    c.near("d6", "acLong", 24000, 0.02, "stut.div 1/4 loop length")
    c.t(R.m("p0", "difL") < -60, "stut.prob 0: nothing engages (%.1f dB)" % R.m("p0", "difL"))
    c.t(R.m("dec1", "trend") < R.m("ref", "trend") - 3, "stut.decay: repeats fade (trend %.1f vs %.1f dB)" % (R.m("dec1", "trend"), R.m("ref", "trend")))
    c.lin("ref", "half", "stut.Mix")
    return c.out


sweep("stutter", NOISE, {"stut": {"wet": 1, "div": 2, "prob": 1.0, "decay": 0.0}},
      [V("ref"), V("d4", stut={"div": 4}), V("d6", stut={"div": 6}), V("p0", stut={"prob": 0.0}), V("dec1", stut={"decay": 1.0}), V("half", stut={"wet": 0.5})], _stut)


def _ratc(R):
    c = Chk(R)
    c.t(R.m("pr0", "difL") < -60, "ratc.prob 0: no roll (%.1f dB)" % R.m("pr0", "difL"))
    c.gt("ref", "pr0", "difL", 10, "ratc: a roll replaces the signal")
    for a, b, w in (("ref", "n8", "ratc.count"), ("ref", "ac1", "ratc.accel"), ("ac1", "acm", "ratc.accel sign"), ("ref", "p12", "ratc.pitch"), ("ref", "d5", "ratc.div")):
        c.differ(a, b, w, -25)
    c.t(R.m("dc", "rmsL") < R.m("ref", "rmsL") * 0.8, "ratc.decay 1: the repeats get quieter (rms %.3f vs %.3f)" % (R.m("dc", "rmsL"), R.m("ref", "rmsL")))
    return c.out


sweep("ratchet", NOISE, {"ratc": {"wet": 1, "div": 7, "count": 4, "accel": 0.0, "pitch": 0.0, "decay": 0.0, "prob": 1.0}},
      [V("ref"), V("n8", ratc={"count": 8}), V("ac1", ratc={"accel": 1.0}), V("acm", ratc={"accel": -1.0}), V("p12", ratc={"pitch": 12}), V("dc", ratc={"decay": 1.0}),
       V("pr0", ratc={"prob": 0.0}), V("d5", ratc={"div": 5})], _ratc, win=(1100, 4000), cyc=4000)


def _time(R):
    c = Chk(R)
    c.near("stop", "perMs", 500, 0.1, "time.div 1/4 cycle")
    c.near("d4", "perMs", 250, 0.1, "time.div 1/8 cycle")
    c.t(R.m("stop", "modd") > 2 * R.m("a02", "modd"), "time.amt (Tape Depth): a full tape stop modulates much deeper than 0.2 (%.2f vs %.2f)" % (R.m("stop", "modd"), R.m("a02", "modd")))
    c.differ("stop", "vari", "time.mode")
    c.differ("vari", "rev", "time.mode")
    c.differ("vari", "va02", "time.amt in Vari", -25)
    c.same("rev", "rev0", "time.amt is not used by Reverse (documented: Tape Depth applies to Stop and Vari)")
    return c.out


sweep("time", NOISE, {"time": {"wet": 1, "mode": 0, "amt": 1.0, "div": 6}},
      [V("stop"), V("vari", time={"mode": 1}), V("rev", time={"mode": 2}), V("a02", time={"amt": 0.2}), V("d4", time={"div": 4}), V("rev0", time={"mode": 2, "amt": 0.0}),
       V("va02", time={"mode": 1, "amt": 0.2})], _time)


def _scrb(R):
    c = Chk(R)
    c.t(R.m("d0", "nonfund") < -40, "scrb.depth 0 is a clean 4-sample delay (nonfund %.1f)" % R.m("d0", "nonfund"))
    c.gt("ref", "d0", "nonfund", 15, "scrb.depth: the platter smears a sine")
    c.gt("d1", "ref", "nonfund", 0.0, "scrb.depth 0.6 -> 1")
    for a, b, w in (("ref", "saw", "scrb.shape"), ("ref", "rnd", "scrb.shape"), ("saw", "rnd", "scrb.shape"), ("ref", "r5", "scrb.rate"), ("ref", "s3", "scrb.size")):
        c.differ(a, b, w, -25)
    c.lin("ref", "half", "scrb.Mix", tol=4)
    return c.out


sweep("scratch", SINE, {"scrb": {"wet": 1, "size": 5, "shape": 0, "rate": 3, "depth": 0.6}},
      [V("ref"), V("d0", scrb={"depth": 0.0}), V("d1", scrb={"depth": 1.0}), V("saw", scrb={"shape": 1}), V("rnd", scrb={"shape": 2}), V("r5", scrb={"rate": 5}), V("s3", scrb={"size": 3}),
       V("half", scrb={"wet": 0.5})], _scrb)


def _gpit(R):
    c = Chk(R)
    c.near("p0", "peakhz", 440, 0.03, "gpit.pitch 0")
    c.near("p12", "peakhz", 880, 0.03, "gpit.pitch +12")
    c.near("pm12", "peakhz", 220, 0.05, "gpit.pitch -12")
    c.near("p7", "peakhz", 659, 0.03, "gpit.pitch +7")
    c.differ("sz20", "sz400", "gpit.size", -25)
    c.differ("p12", "j1", "gpit.jitter", -25)
    return c.out


sweep("gpitch", SINE, {"gpit": {"wet": 1, "pitch": 12, "size": 80, "jitter": 0.0}},
      [V("p12"), V("p0", gpit={"pitch": 0}), V("pm12", gpit={"pitch": -12}), V("p7", gpit={"pitch": 7}), V("sz20", gpit={"size": 20}), V("sz400", gpit={"size": 400}), V("j1", gpit={"jitter": 1.0}),
       V("half", gpit={"wet": 0.5})], _gpit)


def _gstr(R):
    c = Chk(R)
    c.near("ref", "peakhz", 440, 0.03, "gstr: pitch is kept while the speed changes")
    c.near("sp0", "peakhz", 440, 0.03, "gstr.speed 0 (freeze) keeps the grain's pitch")
    for a, b, w in (("ref", "sp1", "gstr.speed"), ("ref", "sz20", "gstr.size"), ("ref", "sz400", "gstr.size"), ("ref", "spr1", "gstr.spread")):
        c.differ(a, b, w, -25)
    return c.out


sweep("gstretch", SINE, {"gstr": {"wet": 1, "speed": 0.25, "size": 120, "spread": 0.0}},
      [V("ref"), V("sp1", gstr={"speed": 1.0}), V("sp0", gstr={"speed": 0.0}), V("sz20", gstr={"size": 20}), V("sz400", gstr={"size": 400}), V("spr1", gstr={"spread": 1.0})], _gstr)


def _rvs(R):
    c = Chk(R)
    c.t(R.m("c0", "difL") < -60, "rvs.chance 0: nothing reversed (%.1f dB)" % R.m("c0", "difL"))
    c.t(R.m("c1", "difL") > -3.5, "rvs.chance 1: every slice is replaced by uncorrelated (reversed) noise (%.1f dB)" % R.m("c1", "difL"))
    c.t(R.m("c05", "difL") < R.m("c1", "difL") - 1 and R.m("c05", "difL") > R.m("c0", "difL") + 20, "rvs.chance 0.5 sits between (%.1f dB)" % R.m("c05", "difL"))
    c.differ("c1", "d2", "rvs.div", -20)
    c.differ("c1", "d6", "rvs.div", -20)
    return c.out


sweep("revslice", NOISE, {"rvs": {"wet": 1, "div": 4, "chance": 1.0}},
      [V("c1"), V("c0", rvs={"chance": 0.0}), V("c05", rvs={"chance": 0.5}), V("d2", rvs={"div": 2}), V("d6", rvs={"div": 6})], _rvs)


def _shuf(R):
    c = Chk(R)
    c.t(R.m("ch0", "difL") < -60, "shuf.chance 0: nothing shuffled (%.1f dB)" % R.m("ch0", "difL"))
    for a, b, w in (("ref", "sl0", "shuf.slices"), ("ref", "sl3", "shuf.slices"), ("ref", "sp2", "shuf.span"), ("ref", "sd5", "shuf.seed")):
        c.differ(a, b, w, -25)
    c.gt("ref", "ch0", "difL", 10, "shuf: slices are swapped")
    return c.out


sweep("shuffle", NOISE, {"shuf": {"wet": 1, "slices": 2, "span": 0, "chance": 1.0, "seed": 0}},
      [V("ref"), V("sl0", shuf={"slices": 0}), V("sl3", shuf={"slices": 3}), V("sp2", shuf={"span": 2}), V("ch0", shuf={"chance": 0.0}), V("sd5", shuf={"seed": 5})], _shuf)


def _chop(R):
    c = Chk(R)
    c.near("aa", "perMs", 250, 0.1, "chop.div 1/16, pattern 1010...")
    c.near("d4", "perMs", 500, 0.1, "chop.div 1/8")
    c.t(R.m("ff", "difL") < -50, "chop pattern all steps on is transparent (%.1f dB)" % R.m("ff", "difL"))
    c.differ("aa", "f0", "chop.pattern", -20)
    return c.out


sweep("chopper_a", NOISE, {"chop": {"wet": 1, "pattern": 0xAAAA, "div": 2, "smooth": 0.0}},
      [V("aa"), V("f0", chop={"pattern": 0xF0F0}), V("ff", chop={"pattern": 0xFFFF}), V("d4", chop={"div": 4})], _chop)


def _chop_b(R):
    c = Chk(R)
    c.t(R.m("sm0", "nonfund") > R.m("sm1", "nonfund") + 10, "chop.smooth: 30 ms edges splatter far less than 0.3 ms edges (non-fundamental energy %.1f vs %.1f dB)" % (R.m("sm0", "nonfund"), R.m("sm1", "nonfund")))
    return c.out


sweep("chopper_b", SINE, {"chop": {"wet": 1, "pattern": 0xAAAA, "div": 2, "smooth": 0.0}}, [V("sm0"), V("sm1", chop={"smooth": 1.0})], _chop_b)


# ------------------------------------------------------------------------------------------------------------------ space (echo windows after the burst)
DLY_OFS = [0, 250, 500, 750, 1000, 125]


def _dly_a(R):
    c = Chk(R)
    m = R.m
    # Ping Pong: with a mono input the echoes must alternate L, R, L, R
    c.t(m("pp1", "eL1") - m("pp1", "eR1") > 30, "dly.pp 1: echo 1 only on L (L %.1f, R %.1f dB)" % (m("pp1", "eL1"), m("pp1", "eR1")))
    c.t(m("pp1", "eR2") - m("pp1", "eL2") > 30, "dly.pp 1: echo 2 only on R (L %.1f, R %.1f dB)" % (m("pp1", "eL2"), m("pp1", "eR2")))
    c.t(m("pp1", "eL3") - m("pp1", "eR3") > 25, "dly.pp 1: echo 3 back on L (L %.1f, R %.1f dB)" % (m("pp1", "eL3"), m("pp1", "eR3")))
    for j in (1, 2, 3):
        c.t(abs(m("ref", "eL%d" % j) - m("ref", "eR%d" % j)) < 1.0, "dly.pp 0: echo %d identical on L and R (%.1f / %.1f)" % (j, m("ref", "eL%d" % j), m("ref", "eR%d" % j)))
    c.t(3 < m("pp05", "eL1") - m("pp05", "eR1") < 9, "dly.pp 0.5: echo 1 is 6 dB louder on L than on R (%.1f)" % (m("pp05", "eL1") - m("pp05", "eR1")))
    # Feedback
    c.t(m("fb0", "eL2") < m("fb0", "eL1") - 40, "dly.fb 0: a single echo (%.1f vs %.1f dB)" % (m("fb0", "eL2"), m("fb0", "eL1")))
    c.t(abs((m("fb08", "eL2") - m("fb08", "eL1")) - 20 * math.log10(0.8)) < 4, "dly.fb 0.8: each echo 1.9 dB below the last (%.1f)" % (m("fb08", "eL2") - m("fb08", "eL1")))
    c.t(m("fb08", "eL3") > m("ref", "eL3") + 1.5, "dly.fb: more feedback, louder third echo")
    # Time: echo at the division, nothing at its midpoint
    c.t(m("d2", "eL1") > m("d2", "eRef") - 15 and m("d2", "eL5") < m("d2", "eRef") - 35, "dly.div 1/16: echo at 125 ms, not at 62 ms (%.1f / %.1f vs burst %.1f)" % (m("d2", "eL1"), m("d2", "eL5"), m("d2", "eRef")))
    c.t(m("d6", "eL1") > m("d6", "eRef") - 15 and m("d6", "eL5") < m("d6", "eRef") - 35, "dly.div 1/4: echo at 500 ms, not at 250 ms (%.1f / %.1f vs burst %.1f)" % (m("d6", "eL1"), m("d6", "eL5"), m("d6", "eRef")))
    c.t(m("ref", "eL1") > m("ref", "eRef") - 15 and m("ref", "eL5") < m("ref", "eRef") - 35, "dly.div 1/8: echo at 250 ms, not at 125 ms")
    c.t(m("dmp", "eL1") < m("ref", "eL1") - 6, "dly.damp 500 Hz darkens the echoes (%.1f vs %.1f dB)" % (m("dmp", "eL1"), m("ref", "eL1")))
    return c.out


_o250 = {"ofs": [0, 250, 500, 750, 1000, 125]}
sweep("delay_a", "burst1", {"dly": {"wet": 1, "div": 4, "fb": 0.5, "pp": 0.0, "damp": 16000}},
      [V("ref"), V("pp1", dly={"pp": 1.0}), V("pp05", dly={"pp": 0.5}), V("fb0", dly={"fb": 0.0}), V("fb08", dly={"fb": 0.8}), V("d2", dly={"div": 2}), V("d6", dly={"div": 6}),
       V("dmp", dly={"damp": 500})], _dly_a, win=(300, 1990),
      echo={"ref": [0, 250, 500, 750, 1000, 125], "pp1": [0, 250, 500, 750, 1000, 125], "pp05": [0, 250, 500, 750, 1000, 125], "fb0": [0, 250, 500, 750, 1000, 125],
            "fb08": [0, 250, 500, 750, 1000, 125], "d2": [0, 125, 250, 375, 500, 62], "d6": [0, 500, 1000, 1500, 1900, 250], "dmp": [0, 250, 500, 750, 1000, 125]})


def _dly_b(R):
    c = Chk(R)
    c.t(abs((R.m("half", "eL1") - R.m("ref", "eL1")) + 6.02) < 1.5, "dly Mix 50%%: echoes 6 dB down (%.1f)" % (R.m("half", "eL1") - R.m("ref", "eL1")))
    c.t(R.m("off", "eL1") < R.m("ref", "eL1") - 40, "dly Mix 0: no echo")
    return c.out


sweep("delay_b", "burst1", {"dly": {"wet": 1, "div": 4, "fb": 0.5, "pp": 0.0, "damp": 16000}},
      [V("ref"), V("half", dly={"wet": 0.5}), V("off", dly={"wet": 0.0})], _dly_b, win=(300, 1990),
      echo={"ref": [0, 250, 500], "half": [0, 250, 500], "off": [0, 250, 500]})


def _slap(R):
    c = Chk(R)
    m = R.m
    c.t(m("ref", "eL1") > m("ref", "eRef") - 12 and m("ref", "eL2") < m("ref", "eL1") - 25, "slap.time 90 ms: echo at 90 ms, none at 45 ms (%.1f / %.1f)" % (m("ref", "eL1"), m("ref", "eL2")))
    c.t(m("t40", "eL1") > m("t40", "eRef") - 12, "slap.time 40 ms: echo at 40 ms (%.1f)" % m("t40", "eL1"))
    c.t(m("t180", "eL1") > m("t180", "eRef") - 12, "slap.time 180 ms: echo at 180 ms (%.1f)" % m("t180", "eL1"))
    c.t(m("tn", "eL1") < m("ref", "eL1") - 6, "slap.tone 800 Hz darkens the echo (%.1f vs %.1f)" % (m("tn", "eL1"), m("ref", "eL1")))
    c.t(m("offp", "eL1") - m("offp", "eR1") > 20, "slap.offset +1: R echo 15 ms late (L %.1f, R %.1f dB in the L echo's first 10 ms)" % (m("offp", "eL1"), m("offp", "eR1")))
    c.t(m("offm", "eR1") - m("offm", "eL1") > 20, "slap.offset -1: L echo 15 ms late (L %.1f, R %.1f dB)" % (m("offm", "eL1"), m("offm", "eR1")))
    c.t(abs(m("ref", "eL1") - m("ref", "eR1")) < 1, "slap.offset 0: both echoes together")
    c.t(abs((m("half", "eL1") - m("ref", "eL1")) + 6.02) < 1.5, "slap Mix 50%: 6 dB down")
    return c.out


sweep("slapback", "burst1", {"slap": {"wet": 1, "time": 90, "tone": 16000, "offset": 0.0}},
      [V("ref"), V("t40", slap={"time": 40}), V("t180", slap={"time": 180}), V("tn", slap={"tone": 800}), V("offp", slap={"offset": 1.0}), V("offm", slap={"offset": -1.0}),
       V("half", slap={"wet": 0.5})], _slap, win=(300, 1990), echo_w=8,
      echo={"ref": [0, 90, 45], "t40": [0, 40, 20], "t180": [0, 180, 90], "tn": [0, 90, 45], "offp": [0, 90, 45], "offm": [0, 90, 45], "half": [0, 90, 45]})


def _rev(R):
    c = Chk(R)
    m = R.m
    c.t(m("dec09", "eL3") > m("ref", "eL3") + 3 > m("dec02", "eL3") + 6 - 0, "rev.decay: a longer decay keeps the tail up (late tail 0.2 / 0.5 / 0.9: %.1f / %.1f / %.1f dB)" % (m("dec02", "eL3"), m("ref", "eL3"), m("dec09", "eL3")))
    c.t(m("void1", "eL3") > m("ref", "eL3") + 3, "rev.void stretches the tail (%.1f vs %.1f dB)" % (m("void1", "eL3"), m("ref", "eL3")))
    c.t(m("dmp", "eL3") < m("ref", "eL3") - 3, "rev.damp 800 Hz drains the tail (late tail %.1f vs %.1f dB)" % (m("dmp", "eL3"), m("ref", "eL3")))
    c.differ("sz01", "sz09", "rev.size", -20)
    c.t(m("ref", "lr") > 0.05, "rev: a centred source gives a stereo tail (lr %.2f)" % m("ref", "lr"))
    c.lin("ref", "half", "rev.Mix", tol=4)
    return c.out


_ro = [0, 200, 600, 1000, 1400]
sweep("reverb", "burst1", {"rev": {"wet": 1, "size": 0.5, "decay": 0.5, "damp": 8000, "void": 0.0}},
      [V("ref"), V("dec02", rev={"decay": 0.2}), V("dec09", rev={"decay": 0.9}), V("sz01", rev={"size": 0.1}), V("sz09", rev={"size": 0.9}), V("dmp", rev={"damp": 800}),
       V("void1", rev={"void": 1.0}), V("half", rev={"wet": 0.5})], _rev, win=(300, 1990), echo_w=40,
      echo={k: _ro for k in ("ref", "dec02", "dec09", "sz01", "sz09", "dmp", "void1", "half")})


# ------------------------------------------------------------------------------------------------------------------ spectral sub-ops
def S(**kw):
    d = {"wet": 1}
    d.update(kw)
    return {"spec": d}


def sp(label, **kw):
    return (label, {"spec": kw})


def _spec_lin(c, full, half, what):
    c.lin(full, half, what + " Mix", tol=3.5)


def _freeze(R):
    c = Chk(R)
    c.near("on", "peakhz", 440, 0.06, "frz_amt: frozen at the engage (440 Hz) while the input moves to 1320")
    c.near("off", "peakhz", 1320, 0.04, "frz off: the input passes (1320 Hz)")
    c.near("r1", "peakhz", 1320, 0.04, "frz_rate 1 beat: re-captured after the input moved")
    c.near("r4", "peakhz", 440, 0.06, "frz_rate 4 beats: not re-captured within the cycle")
    return c.out


sweep("spec_freeze", "sweep2", S(frz_amt=1.0, frz_rate=0),
      [sp("on", frz_amt=1.0, frz_rate=0), sp("off", frz_amt=0.0), sp("r1", frz_amt=1.0, frz_rate=3), sp("r4", frz_amt=1.0, frz_rate=1)], _freeze)


def _smear(R):
    c = Chk(R)
    c.t(R.m("a1", "modd") < R.m("a02", "modd") - 0.1 < R.m("a0001", "modd") - 0.2, "smr_amt (Length): longer smear, flatter envelope (modd %.2f / %.2f / %.2f)" % (R.m("a0001", "modd"), R.m("a02", "modd"), R.m("a1", "modd")))
    return c.out


sweep("spec_smear", "clicks", S(smr_amt=1.0, smr_blur=0.3), [sp("a1", smr_amt=1.0), sp("a02", smr_amt=0.2), sp("a0001", smr_amt=0.001)], _smear)


def _smear_blur(R):
    c = Chk(R)
    c.differ("b0", "b1", "smr_blur")
    c.gt("b1", "b0", "nonfund", 0.3, "smr_blur widens a line")
    return c.out


sweep("spec_smear_blur", SINE, S(smr_amt=0.3, smr_blur=0.0), [sp("b0", smr_blur=0.0), sp("b1", smr_blur=1.0)], _smear_blur)


def _ccrush(R):
    c = Chk(R)
    c.differ("ref", "c09", "cc_coeffs", -25)
    c.gt("ref", "c09", "difL", 3, "cc_coeffs 0.9 -> 0.1 (fewer coefficients, more damage)")
    c.gt("b2", "b8", "difL", 3, "cc_bits 8 -> 2")
    c.differ("b8", "b2", "cc_bits", -25)
    c.differ("ref", "half", "cc_amt", -30)
    return c.out


sweep("spec_ccrush", "vowel", S(cc_amt=1.0, cc_coeffs=0.1, cc_bits=16),
      [sp("ref"), sp("c09", cc_coeffs=0.9), sp("b8", cc_coeffs=0.9, cc_bits=8), sp("b2", cc_coeffs=0.9, cc_bits=2), sp("half", cc_amt=0.5)], _ccrush)


def _scr(R):
    c = Chk(R)
    for a, b in (("m1", "m2"), ("m1", "m3"), ("m2", "m3")):
        c.differ(a, b, "sc_mode", -25)
    c.differ("m1", "half", "sc_amt", -30)
    return c.out


sweep("spec_scramble", "vowel", S(sc_amt=1.0, sc_mode=1), [sp("m1"), sp("m2", sc_mode=2), sp("m3", sc_mode=3), sp("half", sc_amt=0.5)], _scr)


def _sct(R):
    c = Chk(R)
    c.t(abs(R.m("ref", "peakhz") - 1000) > 100, "sct: the 1 kHz line is moved (%.0f Hz)" % R.m("ref", "peakhz"))
    c.differ("ref", "w2", "sct_w", -20)
    c.differ("ref", "w32", "sct_w", -20)
    c.differ("ref", "r0", "sct_rate", -30)
    _spec_lin(c, "ref", "half", "sct")
    return c.out


sweep("spec_scatter", "sine1k", S(sct_amt=1.0, sct_w=8, sct_rate=5),
      [sp("ref"), sp("w2", sct_w=2), sp("w32", sct_w=32), sp("r0", sct_rate=0), sp("half", sct_amt=0.5)], _sct)


def _mir(R):
    c = Chk(R)
    c.near("p1500", "peakhz", 2016, 0.06, "mir_pivot 1500: 1 kHz mirrors to 2 kHz")
    c.near("p4000", "peakhz", 6984, 0.06, "mir_pivot 4000: 1 kHz mirrors to 7 kHz")
    c.near("p600", "peakhz", 234, 0.2, "mir_pivot 600")
    _spec_lin(c, "p1500", "half", "mir")
    return c.out


sweep("spec_mirror", "sine1k", S(mir_amt=1.0, mir_pivot=1500),
      [sp("p1500"), sp("p4000", mir_pivot=4000), sp("p600", mir_pivot=600), sp("half", mir_amt=0.5)], _mir)


def _bsh(R):
    c = Chk(R)
    c.near("b16", "peakhz", 1000 + 16 * 46.875, 0.04, "bsh_bins +16")
    c.near("bm16", "peakhz", 1000 - 16 * 46.875, 0.06, "bsh_bins -16")
    c.near("b64", "peakhz", 1000 + 64 * 46.875, 0.04, "bsh_bins +64")
    c.near("b0", "peakhz", 1000, 0.03, "bsh_bins 0")
    _spec_lin(c, "b16", "half", "bsh")
    return c.out


sweep("spec_binshift", "sine1k", S(bsh_amt=1.0, bsh_bins=16),
      [sp("b16"), sp("bm16", bsh_bins=-16), sp("b64", bsh_bins=64), sp("b0", bsh_bins=0), sp("half", bsh_amt=0.5)], _bsh)


def _sgl(R):
    c = Chk(R)
    c.t(R.m("k4", "nonfund") < R.m("k64", "nonfund") - 10, "sgl_k: keeping 4 bins leaves only the tone, 64 keeps noise bins too (non-fundamental %.1f vs %.1f dB)" % (R.m("k4", "nonfund"), R.m("k64", "nonfund")))
    c.gt("l24", "l2", "difL", 3, "sgl_step 2 -> 24 dB")
    c.differ("k64", "l24", "sgl_mode", -25)
    _spec_lin(c, "k64", "half", "sgl")
    return c.out


sweep("spec_gate", MIX, S(sgl_amt=1.0, sgl_mode=0, sgl_k=64, sgl_step=6),
      [sp("k64"), sp("k4", sgl_k=4), sp("l24", sgl_mode=1, sgl_step=24), sp("l2", sgl_mode=1, sgl_step=2), sp("half", sgl_amt=0.5)], _sgl)


def _gfz(R):
    c = Chk(R)
    c.differ("d02", "d1", "gfz_dens", -20)
    c.differ("r1", "r7", "gfz_rate", -30)
    c.differ("d02", "r1", "gfz_rate", -30)
    c.differ("d02", "half", "gfz_amt", -30)
    return c.out


sweep("spec_gfreeze", NOISE, S(gfz_amt=1.0, gfz_dens=0.2, gfz_rate=5),
      [sp("d02"), sp("d1", gfz_dens=1.0), sp("r1", gfz_rate=1), sp("r7", gfz_rate=7), sp("half", gfz_amt=0.5)], _gfz)


def _str(R):
    c = Chk(R)
    c.near("p7", "peakhz", 1498, 0.04, "str_st +7")
    c.near("p12", "peakhz", 2000, 0.04, "str_st +12")
    c.near("m12", "peakhz", 500, 0.06, "str_st -12")
    c.near("h0", "peakhz", 1498, 0.05, "str_mode Harmonic, inharmonic 0 = a plain shift")
    c.t(R.m("h1", "peakhz") > R.m("h0", "peakhz") + 100, "str_inh stretches the partials upward (%.0f vs %.0f Hz)" % (R.m("h1", "peakhz"), R.m("h0", "peakhz")))
    _spec_lin(c, "p7", "half", "str")
    return c.out


sweep("spec_stretch", "sine1k", S(str_amt=1.0, str_mode=0, str_st=7, str_inh=0.0),
      [sp("p7"), sp("p12", str_st=12), sp("m12", str_st=-12), sp("h0", str_mode=1), sp("h1", str_mode=1, str_inh=1.0), sp("half", str_amt=0.5)], _str)


def _bub(R):
    c = Chk(R)
    c.differ("ref", "s8", "bub_spread", -25)
    c.differ("d005", "d08", "bub_dens", -25)
    _spec_lin(c, "ref", "half", "bub")
    return c.out


sweep("spec_bubbler", MIX, S(bub_amt=1.0, bub_spread=3, bub_dens=0.15),
      [sp("ref"), sp("s8", bub_spread=8), sp("d005", bub_dens=0.05), sp("d08", bub_dens=0.8), sp("half", bub_amt=0.5)], _bub)


def _mp3(R):
    c = Chk(R)
    c.t(R.m("k16", "difL") > R.m("k64", "difL") + 1 and R.m("k64", "difL") > R.m("k320", "difL") + 1, "mp3_kbps: lower bitrate, more damage (%.1f / %.1f / %.1f dB)" % (R.m("k16", "difL"), R.m("k64", "difL"), R.m("k320", "difL")))
    c.t(R.m("k16", "cent") < R.m("k320", "cent") * 0.7, "mp3_kbps 16 cuts the highs (centroid %.0f vs %.0f)" % (R.m("k16", "cent"), R.m("k320", "cent")))
    c.differ("m0", "m1", "mp3_mask", -35)
    _spec_lin(c, "k64", "half", "mp3")
    return c.out


sweep("spec_mp3", NOISE, S(mp3_amt=1.0, mp3_kbps=64, mp3_mask=0.5),
      [sp("k64"), sp("k16", mp3_kbps=16), sp("k320", mp3_kbps=320), sp("m0", mp3_mask=0.0), sp("m1", mp3_mask=1.0), sp("half", mp3_amt=0.5)], _mp3)


def _dst(R):
    c = Chk(R)
    c.t(R.m("dep0", "difL") < R.m("ref", "difL") - 1, "dst_depth 0 decodes correctly (%.1f vs %.1f dB)" % (R.m("dep0", "difL"), R.m("ref", "difL")))
    c.differ("ref", "perm", "dst_mode", -25)
    c.differ("ref", "r7", "dst_rate", -30)
    c.differ("ref", "k16", "dst_kbps", -25)
    _spec_lin(c, "ref", "half", "dst")
    return c.out


sweep("spec_duststorm", NOISE, S(dst_amt=1.0, dst_kbps=64, dst_mode=0, dst_depth=0.8, dst_rate=3),
      [sp("ref"), sp("dep0", dst_depth=0.0), sp("perm", dst_mode=1, dst_depth=1.0), sp("r7", dst_rate=7), sp("k16", dst_kbps=16), sp("half", dst_amt=0.5)], _dst)


def _thn(R):
    c = Chk(R)
    c.t(R.m("n16", "flat") < R.m("n1", "flat") - 0.5, "thn_n: a wider neighbourhood leaves a sparser spectrum (flat %.1f vs %.1f)" % (R.m("n16", "flat"), R.m("n1", "flat")))
    c.t(R.m("s1", "difL") < R.m("s0", "difL") - 1, "thn_soft 1 keeps more of the removed bins (%.1f vs %.1f dB)" % (R.m("s1", "difL"), R.m("s0", "difL")))
    _spec_lin(c, "n1", "half", "thn")
    return c.out


sweep("spec_thinner", MIX, S(thn_amt=1.0, thn_n=1, thn_soft=0.0),
      [sp("n1"), sp("n16", thn_n=16), sp("s0", thn_n=4, thn_soft=0.0), sp("s1", thn_n=4, thn_soft=1.0), sp("half", thn_amt=0.5)], _thn)


def _dec(R):
    c = Chk(R)
    c.t(R.m("k8", "rmsL") < R.m("k1", "rmsL") * 0.95, "dec_k: removing more of the loudest bins is quieter (%.3f vs %.3f)" % (R.m("k8", "rmsL"), R.m("k1", "rmsL")))
    c.t(R.m("b24", "rmsL") > R.m("k8", "rmsL") * 1.3, "dec_boost 24 dB lifts the next bins (%.3f vs %.3f)" % (R.m("b24", "rmsL"), R.m("k8", "rmsL")))
    _spec_lin(c, "k1", "half", "dec")
    return c.out


sweep("spec_decap", MIX, S(dec_amt=1.0, dec_k=1, dec_boost=0.0),
      [sp("k1"), sp("k8", dec_k=8), sp("b24", dec_k=8, dec_boost=24.0), sp("half", dec_amt=0.5)], _dec)


def _nsf(R):
    c = Chk(R)
    c.t(R.m("d0", "difL") < -50, "nsf_depth 0 is transparent (%.1f dB)" % R.m("d0", "difL"))
    c.gt("d18", "d0", "difL", 30, "nsf_depth 18 dB")
    c.differ("d18", "g16", "nsf_grain", -25)
    c.gt("d18", "d6", "difL", 2, "nsf_depth 6 -> 18")
    return c.out


sweep("spec_noisify", NOISE, S(nsf_amt=1.0, nsf_depth=18.0, nsf_grain=1),
      [sp("d18"), sp("d0", nsf_depth=0.0), sp("d6", nsf_depth=6.0), sp("g16", nsf_grain=16)], _nsf)


def _clp(R):
    c = Chk(R)
    c.gt("c36", "c3", "difL", 3, "clp_db -3 -> -36 (lower ceiling clips more)")
    c.differ("c36", "hard", "clp_mode", -30)
    _spec_lin(c, "c36", "half", "clp")
    return c.out


sweep("spec_clipper", MIX, S(clp_amt=1.0, clp_mode=0, clp_db=-36.0),
      [sp("c36"), sp("c3", clp_db=-3.0), sp("hard", clp_mode=1), sp("half", clp_amt=0.5)], _clp)


def _psw(R):
    c = Chk(R)
    c.differ("w512", "w8", "psw_w", -20)
    c.differ("w512", "w64", "psw_w", -20)
    _spec_lin(c, "w512", "half", "psw")
    return c.out


sweep("spec_pswap", MIX, S(psw_amt=1.0, psw_w=512), [sp("w512"), sp("w8", psw_w=8), sp("w64", psw_w=64), sp("half", psw_amt=0.5)], _psw)


def _rph(R):
    c = Chk(R)
    c.differ("rob", "wh", "rph_mode", -20)
    c.differ("rob", "rob1", "rph_rand (Robot)", -25)
    c.differ("wh", "wh03", "rph_rand (Whisper)", -25)
    c.differ("rob", "half", "rph_amt", -30)
    return c.out


sweep("spec_rphase", SINE, S(rph_amt=1.0, rph_mode=0, rph_rand=0.0),
      [sp("rob"), sp("wh", rph_mode=1, rph_rand=1.0), sp("rob1", rph_rand=1.0), sp("wh03", rph_mode=1, rph_rand=0.3), sp("half", rph_amt=0.5)], _rph)
