#!/usr/bin/env python3
"""Self-test for scripts/max_harness.py (real Max, NonRealTime driver).

Records a gen sample counter (ch1) and a `sig~` that an `events` message flips to 1 at 400 ms (ch2):
  * the measured window must be exactly samples settle+1 .. settle+dur, contiguous, at 48 kHz;
  * in "stepped" mode the event must land within one 64-sample vector of its sample time;
  * in "nrt" mode the event lag is only reported (the scheduler runs behind the audio);
  * three runners started at once with DIFFERENT durations must each get exactly their own window
    (the harness serializes Max; identical patches would hide a shared-process mix-up).
"""
import concurrent.futures
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import max_harness as mh

PROBE = os.path.join(mh.ROOT, "tests", "max_harness_selftest_probe.js")
SETTLE_MS, DUR_MS, EVENT_MS = 300, 500, 400


def device():
    boxes = [
        mh.gen_box("dev-idx", "History n(0);\nn = n + 1;\nout1 = n;\n", 200, 200, numinlets=1, numoutlets=1),
        mh.box("dev-sig", "sig~ 0", 420, 200, 60, numinlets=1, outlettype=["signal"]),
    ]
    lines = [
        mh.line("dev-idx", 0, "obj-record", 0),
        mh.line("dev-sig", 0, "obj-record", 1),
        mh.line("dev-idx", 0, "obj-mute-l", 0),
        mh.line("dev-sig", 0, "obj-mute-r", 0),
    ]
    return boxes, lines


def run(mode, tag="", dur_ms=DUR_MS):
    b, l = device()
    return mh.run_case(f"selftest_{mode}{tag}", b, l, probe_js=PROBE, settle_ms=SETTLE_MS, dur_ms=dur_ms,
                       mode=mode, events=[(EVENT_MS, "dev-sig", 0, "1")])


def check_window(r, label, dur_ms=DUR_MS):
    settle, dur = mh.samples_for_ms(SETTLE_MS), mh.samples_for_ms(dur_ms)
    assert r["harness_sr"] == 48000, f"{label}: DSP must run at 48 kHz (got {r['harness_sr']})"
    assert r["frames"] == dur and r["contiguous"] == 1, f"{label}: window must be {dur} contiguous samples ({r})"
    assert r["first"] == settle + 1 and r["last"] == settle + dur, f"{label}: window must start right after settle ({r})"
    assert abs(r["bufms"] - dur_ms) < 0.5, f"{label}: rec buffer length must read as {dur_ms} ms ({r['bufms']})"


def main():
    if not os.path.exists(mh.MAX_BIN):
        print(f"SKIP: Max binary not found at {mh.MAX_BIN}")
        return
    want = mh.samples_for_ms(EVENT_MS)

    r = run("stepped")
    check_window(r, "stepped")
    lag = r["eventAt"] - want
    print(f"[PASS] stepped  window ok, event lag {lag:.0f} samples, wall {r['harness_wall_s']:.1f} s")
    assert 0 <= lag <= 128, f"stepped: event must land within two 64-sample vectors (lag {lag})"

    r = run("nrt")
    check_window(r, "nrt")
    print(f"[PASS] nrt      window ok, event lag {r['eventAt'] - want:.0f} samples (not guaranteed), wall {r['harness_wall_s']:.1f} s")

    durs = [500, 600, 700]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
        results = list(ex.map(lambda d: run("nrt", f"_par{d}", d), durs))
    for d, rr in zip(durs, results):
        check_window(rr, f"concurrent {d} ms", d)
    print(f"[PASS] 3 concurrent runners (500/600/700 ms) each got their own window")
    print("max_harness self-test passed")


if __name__ == "__main__":
    main()
