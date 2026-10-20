{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 1,
      "revision": 5,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "box",
    "rect": [
      100.0,
      100.0,
      1080.0,
      580.0
    ],
    "boxes": [
      {
        "box": {
          "id": "obj-load",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "bang"
          ],
          "patching_rect": [
            40.0,
            30.0,
            60.0,
            20.0
          ],
          "text": "loadbang"
        }
      },
      {
        "box": {
          "id": "obj-del-dsp",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            65.0,
            75.0,
            20.0
          ],
          "text": "delay 1000"
        }
      },
      {
        "box": {
          "id": "obj-dsp",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            100.0,
            80.0,
            20.0
          ],
          "text": "; dsp start"
        }
      },
      {
        "box": {
          "id": "obj-del-arm",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            135.0,
            75.0,
            20.0
          ],
          "text": "delay 1300"
        }
      },
      {
        "box": {
          "id": "obj-rec-on",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            170.0,
            30.0,
            20.0
          ],
          "text": "1"
        }
      },
      {
        "box": {
          "id": "obj-del-stop",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            205.0,
            80.0,
            20.0
          ],
          "text": "delay 500"
        }
      },
      {
        "box": {
          "id": "obj-rec-off",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            240.0,
            30.0,
            20.0
          ],
          "text": "0"
        }
      },
      {
        "box": {
          "id": "obj-del-analyze",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            275.0,
            70.0,
            20.0
          ],
          "text": "delay 80"
        }
      },
      {
        "box": {
          "id": "obj-analyze",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            120.0,
            275.0,
            95.0,
            20.0
          ],
          "text": "analyze 500"
        }
      },
      {
        "box": {
          "id": "obj-quit",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            340.0,
            70.0,
            20.0
          ],
          "text": "; max quit"
        }
      },
      {
        "box": {
          "id": "obj-setbuf",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220.0,
            30.0,
            160.0,
            20.0
          ],
          "text": "setbuffer #0-splitscope"
        }
      },
      {
        "box": {
          "id": "obj-scope",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "float",
            "bang"
          ],
          "patching_rect": [
            400.0,
            30.0,
            220.0,
            20.0
          ],
          "text": "buffer~ #0-splitscope @samps 8224"
        }
      },
      {
        "box": {
          "id": "obj-recbuf",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 2,
          "outlettype": [
            "float",
            "bang"
          ],
          "patching_rect": [
            630.0,
            30.0,
            150.0,
            20.0
          ],
          "text": "buffer~ rec 3000 2"
        }
      },
      {
        "box": {
          "id": "obj-record",
          "maxclass": "newobj",
          "numinlets": 4,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            260.0,
            420.0,
            100.0,
            20.0
          ],
          "text": "record~ rec 2"
        }
      },
      {
        "box": {
          "id": "obj-mute-l",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            260.0,
            460.0,
            45.0,
            20.0
          ],
          "text": "*~ 0"
        }
      },
      {
        "box": {
          "id": "obj-mute-r",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            320.0,
            460.0,
            45.0,
            20.0
          ],
          "text": "*~ 0"
        }
      },
      {
        "box": {
          "id": "obj-dac",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 0,
          "outlettype": [],
          "patching_rect": [
            260.0,
            500.0,
            50.0,
            20.0
          ],
          "text": "dac~"
        }
      },
      {
        "box": {
          "id": "obj-js",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "bang"
          ],
          "patching_rect": [
            420.0,
            420.0,
            220.0,
            20.0
          ],
          "text": "js /Users/mrwilson/software/ableton/tests/mbsplit_probe.js"
        }
      },
      {
        "box": {
          "id": "obj-osc1",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            200.0,
            80.0,
            70.0,
            20.0
          ],
          "text": "cycle~ 80"
        }
      },
      {
        "box": {
          "id": "obj-osc2",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            280.0,
            80.0,
            75.0,
            20.0
          ],
          "text": "cycle~ 380"
        }
      },
      {
        "box": {
          "id": "obj-osc3",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            365.0,
            80.0,
            80.0,
            20.0
          ],
          "text": "cycle~ 1900"
        }
      },
      {
        "box": {
          "id": "obj-osc4",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            455.0,
            80.0,
            80.0,
            20.0
          ],
          "text": "cycle~ 7500"
        }
      },
      {
        "box": {
          "id": "obj-sum-in",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            260.0,
            120.0,
            60.0,
            20.0
          ],
          "text": "*~ 0.15"
        }
      },
      {
        "box": {
          "code": "// Multiband Split \u2014 Phase-Coherent Linkwitz-Riley (12 / 24 / 48 dB/oct) 2/3/4-Band Crossover Engine\n// All parallel bands sum to an exact allpass unity transfer function (0.000 dB flat response).\n// Dynamic Phase (dynphase = 1): F1 stays a minimum-phase Linkwitz-Riley split, while F2 / F3 become\n// complementary linear-phase FIR splits (Kaiser beta 6 windowed sinc, half-length D = 128 samples at\n// 48 kHz) of the F1 high band. Band 1 is the F1 low band delayed by D, so all bands sum to the F1\n// allpass delayed by exactly D samples (latency D, reported to Live by the v8ui).\n\nslew_step(cur, target, coef) {\n    return cur + (target - cur) * coef;\n}\n\ncalc_tan_g(fc, sr) {\n    fClamped = clamp(fc, 20.0, sr * 0.48);\n    return tan(3.141592653589793 * fClamped / sr);\n}\n\ndb_to_lin(db) {\n    return pow(10.0, db * 0.05);\n}\n\nbessel_i0(x) {\n    s = 1.0;\n    t = 1.0;\n    for (k = 1; k < 30; k += 1) {\n        q = x / (2.0 * k);\n        t = t * q * q;\n        s = s + t;\n    }\n    return s;\n}\n\nBuffer scope(\"splitscope\");\n\nParam f1(120.0);\nParam f2(800.0);\nParam f3(4500.0);\nParam numbands(3.0);\nParam slope(1.0);\nParam bandmask(1.0);\nParam gain(0.0);\nParam phase(0.0);\nParam dynphase(0.0);\n\n// Dynamic Phase FIR state: 6-channel input ring (x, low1, high1 for L / R), Kaiser half-window, F2 / F3 half-kernels\nData firRing(2048, 6);\nData firWin(520);\nData firK2(520);\nData firK3(520);\nHistory firD(128.0);\nHistory firSr(0.0);\nHistory firWp(0.0);\nHistory kF2(-1.0);\nHistory kF3(-1.0);\nHistory kCnt(0.0);\nHistory dynActive(0.0);\nHistory dynFade(1.0);\n\n// Smoothed frequency & gain histories\nHistory smF1(120.0);\nHistory smF2(800.0);\nHistory smF3(4500.0);\nHistory smGain(1.0);\nHistory lastSlope(-1.0);\n\n// --- Stage 1 (Crossover F1) States (L & R) ---\n// LR2 (1st-order cascades)\nHistory s1_l1a_L(0.0), s1_l1b_L(0.0), s1_h1a_L(0.0), s1_h1b_L(0.0);\nHistory s1_l1a_R(0.0), s1_l1b_R(0.0), s1_h1a_R(0.0), s1_h1b_R(0.0);\n// LR4 / LR8 SVF states for Stage 1 LP (4 stages per channel) & HP (4 stages per channel)\nHistory s1_lp1_ic1L(0.0), s1_lp1_ic2L(0.0), s1_lp2_ic1L(0.0), s1_lp2_ic2L(0.0);\nHistory s1_lp3_ic1L(0.0), s1_lp3_ic2L(0.0), s1_lp4_ic1L(0.0), s1_lp4_ic2L(0.0);\nHistory s1_hp1_ic1L(0.0), s1_hp1_ic2L(0.0), s1_hp2_ic1L(0.0), s1_hp2_ic2L(0.0);\nHistory s1_hp3_ic1L(0.0), s1_hp3_ic2L(0.0), s1_hp4_ic1L(0.0), s1_hp4_ic2L(0.0);\n\nHistory s1_lp1_ic1R(0.0), s1_lp1_ic2R(0.0), s1_lp2_ic1R(0.0), s1_lp2_ic2R(0.0);\nHistory s1_lp3_ic1R(0.0), s1_lp3_ic2R(0.0), s1_lp4_ic1R(0.0), s1_lp4_ic2R(0.0);\nHistory s1_hp1_ic1R(0.0), s1_hp1_ic2R(0.0), s1_hp2_ic1R(0.0), s1_hp2_ic2R(0.0);\nHistory s1_hp3_ic1R(0.0), s1_hp3_ic2R(0.0), s1_hp4_ic1R(0.0), s1_hp4_ic2R(0.0);\n\n// --- Stage 2 (Crossover F2) States (L & R) ---\nHistory s2_l1a_L(0.0), s2_l1b_L(0.0), s2_h1a_L(0.0), s2_h1b_L(0.0);\nHistory s2_l1a_R(0.0), s2_l1b_R(0.0), s2_h1a_R(0.0), s2_h1b_R(0.0);\nHistory s2_lp1_ic1L(0.0), s2_lp1_ic2L(0.0), s2_lp2_ic1L(0.0), s2_lp2_ic2L(0.0);\nHistory s2_lp3_ic1L(0.0), s2_lp3_ic2L(0.0), s2_lp4_ic1L(0.0), s2_lp4_ic2L(0.0);\nHistory s2_hp1_ic1L(0.0), s2_hp1_ic2L(0.0), s2_hp2_ic1L(0.0), s2_hp2_ic2L(0.0);\nHistory s2_hp3_ic1L(0.0), s2_hp3_ic2L(0.0), s2_hp4_ic1L(0.0), s2_hp4_ic2L(0.0);\n\nHistory s2_lp1_ic1R(0.0), s2_lp1_ic2R(0.0), s2_lp2_ic1R(0.0), s2_lp2_ic2R(0.0);\nHistory s2_lp3_ic1R(0.0), s2_lp3_ic2R(0.0), s2_lp4_ic1R(0.0), s2_lp4_ic2R(0.0);\nHistory s2_hp1_ic1R(0.0), s2_hp1_ic2R(0.0), s2_hp2_ic1R(0.0), s2_hp2_ic2R(0.0);\nHistory s2_hp3_ic1R(0.0), s2_hp3_ic2R(0.0), s2_hp4_ic1R(0.0), s2_hp4_ic2R(0.0);\n\n// Allpass F2 on Band 1 (for 3-way and 4-way phase alignment)\nHistory ap2_b1_z1L(0.0), ap2_b1_z1R(0.0);\nHistory ap2_b1_1_ic1L(0.0), ap2_b1_1_ic2L(0.0), ap2_b1_2_ic1L(0.0), ap2_b1_2_ic2L(0.0);\nHistory ap2_b1_1_ic1R(0.0), ap2_b1_1_ic2R(0.0), ap2_b1_2_ic1R(0.0), ap2_b1_2_ic2R(0.0);\n\n// --- Stage 3 (Crossover F3) States (L & R) ---\nHistory s3_l1a_L(0.0), s3_l1b_L(0.0), s3_h1a_L(0.0), s3_h1b_L(0.0);\nHistory s3_l1a_R(0.0), s3_l1b_R(0.0), s3_h1a_R(0.0), s3_h1b_R(0.0);\nHistory s3_lp1_ic1L(0.0), s3_lp1_ic2L(0.0), s3_lp2_ic1L(0.0), s3_lp2_ic2L(0.0);\nHistory s3_lp3_ic1L(0.0), s3_lp3_ic2L(0.0), s3_lp4_ic1L(0.0), s3_lp4_ic2L(0.0);\nHistory s3_hp1_ic1L(0.0), s3_hp1_ic2L(0.0), s3_hp2_ic1L(0.0), s3_hp2_ic2L(0.0);\nHistory s3_hp3_ic1L(0.0), s3_hp3_ic2L(0.0), s3_hp4_ic1L(0.0), s3_hp4_ic2L(0.0);\n\nHistory s3_lp1_ic1R(0.0), s3_lp1_ic2R(0.0), s3_lp2_ic1R(0.0), s3_lp2_ic2R(0.0);\nHistory s3_lp3_ic1R(0.0), s3_lp3_ic2R(0.0), s3_lp4_ic1R(0.0), s3_lp4_ic2R(0.0);\nHistory s3_hp1_ic1R(0.0), s3_hp1_ic2R(0.0), s3_hp2_ic1R(0.0), s3_hp2_ic2R(0.0);\nHistory s3_hp3_ic1R(0.0), s3_hp3_ic2R(0.0), s3_hp4_ic1R(0.0), s3_hp4_ic2R(0.0);\n\n// Allpass F3 on Band 1 and Band 2 (for 4-way phase alignment)\nHistory ap3_b1_z1L(0.0), ap3_b1_z1R(0.0);\nHistory ap3_b1_1_ic1L(0.0), ap3_b1_1_ic2L(0.0), ap3_b1_2_ic1L(0.0), ap3_b1_2_ic2L(0.0);\nHistory ap3_b1_1_ic1R(0.0), ap3_b1_1_ic2R(0.0), ap3_b1_2_ic1R(0.0), ap3_b1_2_ic2R(0.0);\n\nHistory ap3_b2_z1L(0.0), ap3_b2_z1R(0.0);\nHistory ap3_b2_1_ic1L(0.0), ap3_b2_1_ic2L(0.0), ap3_b2_2_ic1L(0.0), ap3_b2_2_ic2L(0.0);\nHistory ap3_b2_1_ic1R(0.0), ap3_b2_1_ic2R(0.0), ap3_b2_2_ic1R(0.0), ap3_b2_2_ic2R(0.0);\n\n// --- 16-Band Spectrum Analyzer States (32 Hz .. 16 kHz) ---\nHistory sp_ic1_0(0.0), sp_ic2_0(0.0), sp_env_0(0.0);\nHistory sp_ic1_1(0.0), sp_ic2_1(0.0), sp_env_1(0.0);\nHistory sp_ic1_2(0.0), sp_ic2_2(0.0), sp_env_2(0.0);\nHistory sp_ic1_3(0.0), sp_ic2_3(0.0), sp_env_3(0.0);\nHistory sp_ic1_4(0.0), sp_ic2_4(0.0), sp_env_4(0.0);\nHistory sp_ic1_5(0.0), sp_ic2_5(0.0), sp_env_5(0.0);\nHistory sp_ic1_6(0.0), sp_ic2_6(0.0), sp_env_6(0.0);\nHistory sp_ic1_7(0.0), sp_ic2_7(0.0), sp_env_7(0.0);\nHistory sp_ic1_8(0.0), sp_ic2_8(0.0), sp_env_8(0.0);\nHistory sp_ic1_9(0.0), sp_ic2_9(0.0), sp_env_9(0.0);\nHistory sp_ic1_10(0.0), sp_ic2_10(0.0), sp_env_10(0.0);\nHistory sp_ic1_11(0.0), sp_ic2_11(0.0), sp_env_11(0.0);\nHistory sp_ic1_12(0.0), sp_ic2_12(0.0), sp_env_12(0.0);\nHistory sp_ic1_13(0.0), sp_ic2_13(0.0), sp_env_13(0.0);\nHistory sp_ic1_14(0.0), sp_ic2_14(0.0), sp_env_14(0.0);\nHistory sp_ic1_15(0.0), sp_ic2_15(0.0), sp_env_15(0.0);\n\n// Peak telemetry & 8192-sample FFT ring buffer histories\nHistory pkB1(0.0), pkB2(0.0), pkB3(0.0), pkB4(0.0);\nHistory pkIn(0.0), pkOut(0.0);\nHistory scopeCnt(0.0), scopeBeat(0.0);\nHistory ringPos(0.0);\n\nsr = max(samplerate, 1.0);\nxL = fixnan(in1);\nxR = fixnan(in2);\n\n// Parameter smoothing (~3 ms)\nsmoothCoef = 1.0 - exp(-1.0 / (0.003 * sr));\ntargetF1 = clamp(f1, 20.0, sr * 0.48);\ntargetF2 = clamp(max(f2, targetF1 * 1.1892), 24.0, sr * 0.48);\ntargetF3 = clamp(max(f3, targetF2 * 1.1892), 28.0, sr * 0.48);\n\nsmF1 = slew_step(smF1, targetF1, smoothCoef);\nsmF2 = slew_step(smF2, targetF2, smoothCoef);\nsmF3 = slew_step(smF3, targetF3, smoothCoef);\n\ntargetGainLin = (gain <= -69.5) ? 0.0 : db_to_lin(clamp(gain, -70.0, 18.0));\nsmGain = slew_step(smGain, targetGainLin, smoothCoef);\n\nnb = clamp(round(numbands), 1.0, 4.0);\nslopeMode = clamp(round(slope), 0.0, 2.0);\nmaskInt = clamp(round(bandmask), 0.0, 15.0);\nphaseSign = (phase > 0.5) ? -1.0 : 1.0;\n\n// Damping constants for Butterworth 2nd-order (LR4) and 4th-order (LR8)\nkButter2 = 1.4142135623730951;\nkButter4A = 1.8477590650225735;\nkButter4B = 0.7653668647301796;\n\n// Effective damping per SVF stage based on slopeMode (1 = LR4 uses kButter2; 2 = LR8 alternates A and B)\nkStageA = (slopeMode > 1.5) ? kButter4A : kButter2;\nkStageB = (slopeMode > 1.5) ? kButter4B : kButter2;\n\n// Pre-declare stage output variables at outer scope before conditional branches (GenExpr scoping rule)\nlow1L = 0.0; high1L = 0.0; low1R = 0.0; high1R = 0.0;\nlow2L = 0.0; high2L = 0.0; low2R = 0.0; high2R = 0.0;\nb1_after2L = 0.0; b1_after2R = 0.0;\nlow3L = 0.0; high3L = 0.0; low3R = 0.0; high3R = 0.0;\nb1_after3L = 0.0; b1_after3R = 0.0;\nb2_after3L = 0.0; b2_after3R = 0.0;\n\n// =========================================================================\n// STAGE 1: Crossover at smF1\n// =========================================================================\ng_f1 = calc_tan_g(smF1, sr);\ng1_f1 = g_f1 / (1.0 + g_f1);\n\nif (slopeMode < 0.5) {\n    // 12 dB/oct (LR2)\n    vL = (xL - s1_l1a_L) * g1_f1; lp1aL = vL + s1_l1a_L; s1_l1a_L = lp1aL + vL;\n    vL2 = (lp1aL - s1_l1b_L) * g1_f1; lp1bL = vL2 + s1_l1b_L; s1_l1b_L = lp1bL + vL2;\n    vhL = (xL - s1_h1a_L) * g1_f1; lpHaL = vhL + s1_h1a_L; s1_h1a_L = lpHaL + vhL; hp1aL = xL - lpHaL;\n    vhL2 = (hp1aL - s1_h1b_L) * g1_f1; lpHbL = vhL2 + s1_h1b_L; s1_h1b_L = lpHbL + vhL2; hp1bL = hp1aL - lpHbL;\n\n    vR = (xR - s1_l1a_R) * g1_f1; lp1aR = vR + s1_l1a_R; s1_l1a_R = lp1aR + vR;\n    vR2 = (lp1aR - s1_l1b_R) * g1_f1; lp1bR = vR2 + s1_l1b_R; s1_l1b_R = lp1bR + vR2;\n    vhR = (xR - s1_h1a_R) * g1_f1; lpHaR = vhR + s1_h1a_R; s1_h1a_R = lpHaR + vhR; hp1aR = xR - lpHaR;\n    vhR2 = (hp1aR - s1_h1b_R) * g1_f1; lpHbR = vhR2 + s1_h1b_R; s1_h1b_R = lpHbL * 0.0 + lpHbR + vhR2; hp1bR = hp1aR - lpHbR;\n\n    low1L = lp1bL;\n    high1L = -hp1bL;\n    low1R = lp1bR;\n    high1R = -hp1bR;\n} else {\n    a1A_1 = 1.0 / (1.0 + g_f1 * (g_f1 + kStageA));\n    a2A_1 = g_f1 * a1A_1;\n    a3A_1 = g_f1 * a2A_1;\n\n    a1B_1 = 1.0 / (1.0 + g_f1 * (g_f1 + kStageB));\n    a2B_1 = g_f1 * a1B_1;\n    a3B_1 = g_f1 * a2B_1;\n\n    // LP cascade Stage 1 & 2 (L)\n    v3 = xL - s1_lp1_ic2L; v1 = a1A_1 * s1_lp1_ic1L + a2A_1 * v3; v2 = s1_lp1_ic2L + a2A_1 * s1_lp1_ic1L + a3A_1 * v3;\n    s1_lp1_ic1L = 2.0 * v1 - s1_lp1_ic1L; s1_lp1_ic2L = 2.0 * v2 - s1_lp1_ic2L;\n    lp_s1L = v2;\n\n    v3 = lp_s1L - s1_lp2_ic2L; v1 = a1B_1 * s1_lp2_ic1L + a2B_1 * v3; v2 = s1_lp2_ic2L + a2B_1 * s1_lp2_ic1L + a3B_1 * v3;\n    s1_lp2_ic1L = 2.0 * v1 - s1_lp2_ic1L; s1_lp2_ic2L = 2.0 * v2 - s1_lp2_ic2L;\n    lp_s2L = v2;\n\n    // HP cascade Stage 1 & 2 (L)\n    v3 = xL - s1_hp1_ic2L; v1 = a1A_1 * s1_hp1_ic1L + a2A_1 * v3; v2 = s1_hp1_ic2L + a2A_1 * s1_hp1_ic1L + a3A_1 * v3;\n    s1_hp1_ic1L = 2.0 * v1 - s1_hp1_ic1L; s1_hp1_ic2L = 2.0 * v2 - s1_hp1_ic2L;\n    hp_s1L = xL - kStageA * v1 - v2;\n\n    v3 = hp_s1L - s1_hp2_ic2L; v1 = a1B_1 * s1_hp2_ic1L + a2B_1 * v3; v2 = s1_hp2_ic2L + a2B_1 * s1_hp2_ic1L + a3B_1 * v3;\n    s1_hp2_ic1L = 2.0 * v1 - s1_hp2_ic1L; s1_hp2_ic2L = 2.0 * v2 - s1_hp2_ic2L;\n    hp_s2L = hp_s1L - kStageB * v1 - v2;\n\n    // LP cascade Stage 1 & 2 (R)\n    v3 = xR - s1_lp1_ic2R; v1 = a1A_1 * s1_lp1_ic1R + a2A_1 * v3; v2 = s1_lp1_ic2R + a2A_1 * s1_lp1_ic1R + a3A_1 * v3;\n    s1_lp1_ic1R = 2.0 * v1 - s1_lp1_ic1R; s1_lp1_ic2R = 2.0 * v2 - s1_lp1_ic2R;\n    lp_s1R = v2;\n\n    v3 = lp_s1R - s1_lp2_ic2R; v1 = a1B_1 * s1_lp2_ic1R + a2B_1 * v3; v2 = s1_lp2_ic2R + a2B_1 * s1_lp2_ic1R + a3B_1 * v3;\n    s1_lp2_ic1R = 2.0 * v1 - s1_lp2_ic1R; s1_lp2_ic2R = 2.0 * v2 - s1_lp2_ic2R;\n    lp_s2R = v2;\n\n    // HP cascade Stage 1 & 2 (R)\n    v3 = xR - s1_hp1_ic2R; v1 = a1A_1 * s1_hp1_ic1R + a2A_1 * v3; v2 = s1_hp1_ic2R + a2A_1 * s1_hp1_ic1R + a3A_1 * v3;\n    s1_hp1_ic1R = 2.0 * v1 - s1_hp1_ic1R; s1_hp1_ic2R = 2.0 * v2 - s1_hp1_ic2R;\n    hp_s1R = xR - kStageA * v1 - v2;\n\n    v3 = hp_s1R - s1_hp2_ic2R; v1 = a1B_1 * s1_hp2_ic1R + a2B_1 * v3; v2 = s1_hp2_ic2R + a2B_1 * s1_hp2_ic1R + a3B_1 * v3;\n    s1_hp2_ic1R = 2.0 * v1 - s1_hp2_ic1R; s1_hp2_ic2R = 2.0 * v2 - s1_hp2_ic2R;\n    hp_s2R = hp_s1R - kStageB * v1 - v2;\n\n    if (slopeMode > 1.5) {\n        // LR8 (48 dB/oct): Stages 3 & 4\n        v3 = lp_s2L - s1_lp3_ic2L; v1 = a1A_1 * s1_lp3_ic1L + a2A_1 * v3; v2 = s1_lp3_ic2L + a2A_1 * s1_lp3_ic1L + a3A_1 * v3;\n        s1_lp3_ic1L = 2.0 * v1 - s1_lp3_ic1L; s1_lp3_ic2L = 2.0 * v2 - s1_lp3_ic2L;\n        lp_s3L = v2;\n        v3 = lp_s3L - s1_lp4_ic2L; v1 = a1B_1 * s1_lp4_ic1L + a2B_1 * v3; v2 = s1_lp4_ic2L + a2B_1 * s1_lp4_ic1L + a3B_1 * v3;\n        s1_lp4_ic1L = 2.0 * v1 - s1_lp4_ic1L; s1_lp4_ic2L = 2.0 * v2 - s1_lp4_ic2L;\n        low1L = v2;\n\n        v3 = hp_s2L - s1_hp3_ic2L; v1 = a1A_1 * s1_hp3_ic1L + a2A_1 * v3; v2 = s1_hp3_ic2L + a2A_1 * s1_hp3_ic1L + a3A_1 * v3;\n        s1_hp3_ic1L = 2.0 * v1 - s1_hp3_ic1L; s1_hp3_ic2L = 2.0 * v2 - s1_hp3_ic2L;\n        hp_s3L = hp_s2L - kStageA * v1 - v2;\n        v3 = hp_s3L - s1_hp4_ic2L; v1 = a1B_1 * s1_hp4_ic1L + a2B_1 * v3; v2 = s1_hp4_ic2L + a2B_1 * s1_hp4_ic1L + a3B_1 * v3;\n        s1_hp4_ic1L = 2.0 * v1 - s1_hp4_ic1L; s1_hp4_ic2L = 2.0 * v2 - s1_hp4_ic2L;\n        high1L = hp_s3L - kStageB * v1 - v2;\n\n        v3 = lp_s2R - s1_lp3_ic2R; v1 = a1A_1 * s1_lp3_ic1R + a2A_1 * v3; v2 = s1_lp3_ic2R + a2A_1 * s1_lp3_ic1R + a3A_1 * v3;\n        s1_lp3_ic1R = 2.0 * v1 - s1_lp3_ic1R; s1_lp3_ic2R = 2.0 * v2 - s1_lp3_ic2R;\n        lp_s3R = v2;\n        v3 = lp_s3R - s1_lp4_ic2R; v1 = a1B_1 * s1_lp4_ic1R + a2B_1 * v3; v2 = s1_lp4_ic2R + a2B_1 * s1_lp4_ic1R + a3B_1 * v3;\n        s1_lp4_ic1R = 2.0 * v1 - s1_lp4_ic1R; s1_lp4_ic2R = 2.0 * v2 - s1_lp4_ic2R;\n        low1R = v2;\n\n        v3 = hp_s2R - s1_hp3_ic2R; v1 = a1A_1 * s1_hp3_ic1R + a2A_1 * v3; v2 = s1_hp3_ic2R + a2A_1 * s1_hp3_ic1R + a3A_1 * v3;\n        s1_hp3_ic1R = 2.0 * v1 - s1_hp3_ic1R; s1_hp3_ic2R = 2.0 * v2 - s1_hp3_ic2R;\n        hp_s3R = hp_s2R - kStageA * v1 - v2;\n        v3 = hp_s3R - s1_hp4_ic2R; v1 = a1B_1 * s1_hp4_ic1R + a2B_1 * v3; v2 = s1_hp4_ic2R + a2B_1 * s1_hp4_ic1R + a3B_1 * v3;\n        s1_hp4_ic1R = 2.0 * v1 - s1_hp4_ic1R; s1_hp4_ic2R = 2.0 * v2 - s1_hp4_ic2R;\n        high1R = hp_s3R - kStageB * v1 - v2;\n    } else {\n        low1L = lp_s2L;\n        high1L = hp_s2L;\n        low1R = lp_s2R;\n        high1R = hp_s2R;\n    }\n}\n\n// =========================================================================\n// STAGE 2: Crossover at smF2 (on high1) + Allpass at smF2 (on low1)\n// =========================================================================\ng_f2 = calc_tan_g(smF2, sr);\ng1_f2 = g_f2 / (1.0 + g_f2);\n\nif (slopeMode < 0.5) {\n    // 12 dB/oct (LR2) Split on high1\n    vL = (high1L - s2_l1a_L) * g1_f2; lp2aL = vL + s2_l1a_L; s2_l1a_L = lp2aL + vL;\n    vL2 = (lp2aL - s2_l1b_L) * g1_f2; lp2bL = vL2 + s2_l1b_L; s2_l1b_L = lp2bL + vL2;\n    vhL = (high1L - s2_h1a_L) * g1_f2; lp2HaL = vhL + s2_h1a_L; s2_h1a_L = lp2HaL + vhL; hp2aL = high1L - lp2HaL;\n    vhL2 = (hp2aL - s2_h1b_L) * g1_f2; lp2HbL = vhL2 + s2_h1b_L; s2_h1b_L = lp2HbL + vhL2; hp2bL = hp2aL - lp2HbL;\n\n    vR = (high1R - s2_l1a_R) * g1_f2; lp2aR = vR + s2_l1a_R; s2_l1a_R = lp2aR + vR;\n    vR2 = (lp2aR - s2_l1b_R) * g1_f2; lp2bR = vR2 + s2_l1b_R; s2_l1b_R = lp2bR + vR2;\n    vhR = (high1R - s2_h1a_R) * g1_f2; lp2HaR = vhR + s2_h1a_R; s2_h1a_R = lp2HaR + vhR; hp2aR = high1R - lp2HaR;\n    vhR2 = (hp2aR - s2_h1b_R) * g1_f2; lp2HbR = vhR2 + s2_h1b_R; s2_h1b_R = lp2HbR + vhR2; hp2bR = hp2aR - lp2HbR;\n\n    low2L = lp2bL;\n    high2L = -hp2bL;\n    low2R = lp2bR;\n    high2R = -hp2bR;\n\n    // 1st-order Allpass at F2 on low1\n    vaL = (low1L - ap2_b1_z1L) * g1_f2; lpaL = vaL + ap2_b1_z1L; ap2_b1_z1L = lpaL + vaL;\n    b1_after2L = 2.0 * lpaL - low1L;\n    vaR = (low1R - ap2_b1_z1R) * g1_f2; lpaR = vaR + ap2_b1_z1R; ap2_b1_z1R = lpaR + vaR;\n    b1_after2R = 2.0 * lpaR - low1R;\n} else {\n    a1A_2 = 1.0 / (1.0 + g_f2 * (g_f2 + kStageA));\n    a2A_2 = g_f2 * a1A_2;\n    a3A_2 = g_f2 * a2A_2;\n\n    a1B_2 = 1.0 / (1.0 + g_f2 * (g_f2 + kStageB));\n    a2B_2 = g_f2 * a1B_2;\n    a3B_2 = g_f2 * a2B_2;\n\n    // LP cascade Stage 1 & 2 (L)\n    v3 = high1L - s2_lp1_ic2L; v1 = a1A_2 * s2_lp1_ic1L + a2A_2 * v3; v2 = s2_lp1_ic2L + a2A_2 * s2_lp1_ic1L + a3A_2 * v3;\n    s2_lp1_ic1L = 2.0 * v1 - s2_lp1_ic1L; s2_lp1_ic2L = 2.0 * v2 - s2_lp1_ic2L;\n    lp2_s1L = v2;\n    v3 = lp2_s1L - s2_lp2_ic2L; v1 = a1B_2 * s2_lp2_ic1L + a2B_2 * v3; v2 = s2_lp2_ic2L + a2B_2 * s2_lp2_ic1L + a3B_2 * v3;\n    s2_lp2_ic1L = 2.0 * v1 - s2_lp2_ic1L; s2_lp2_ic2L = 2.0 * v2 - s2_lp2_ic2L;\n    lp2_s2L = v2;\n\n    // HP cascade Stage 1 & 2 (L)\n    v3 = high1L - s2_hp1_ic2L; v1 = a1A_2 * s2_hp1_ic1L + a2A_2 * v3; v2 = s2_hp1_ic2L + a2A_2 * s2_hp1_ic1L + a3A_2 * v3;\n    s2_hp1_ic1L = 2.0 * v1 - s2_hp1_ic1L; s2_hp1_ic2L = 2.0 * v2 - s2_hp1_ic2L;\n    hp2_s1L = high1L - kStageA * v1 - v2;\n    v3 = hp2_s1L - s2_hp2_ic2L; v1 = a1B_2 * s2_hp2_ic1L + a2B_2 * v3; v2 = s2_hp2_ic2L + a2B_2 * s2_hp2_ic1L + a3B_2 * v3;\n    s2_hp2_ic1L = 2.0 * v1 - s2_hp2_ic1L; s2_hp2_ic2L = 2.0 * v2 - s2_hp2_ic2L;\n    hp2_s2L = hp2_s1L - kStageB * v1 - v2;\n\n    // LP cascade Stage 1 & 2 (R)\n    v3 = high1R - s2_lp1_ic2R; v1 = a1A_2 * s2_lp1_ic1R + a2A_2 * v3; v2 = s2_lp1_ic2R + a2A_2 * s2_lp1_ic1R + a3A_2 * v3;\n    s2_lp1_ic1R = 2.0 * v1 - s2_lp1_ic1R; s2_lp1_ic2R = 2.0 * v2 - s2_lp1_ic2R;\n    lp2_s1R = v2;\n    v3 = lp2_s1R - s2_lp2_ic2R; v1 = a1B_2 * s2_lp2_ic1R + a2B_2 * v3; v2 = s2_lp2_ic2R + a2B_2 * s2_lp2_ic1R + a3B_2 * v3;\n    s2_lp2_ic1R = 2.0 * v1 - s2_lp2_ic1R; s2_lp2_ic2R = 2.0 * v2 - s2_lp2_ic2R;\n    lp2_s2R = v2;\n\n    // HP cascade Stage 1 & 2 (R)\n    v3 = high1R - s2_hp1_ic2R; v1 = a1A_2 * s2_hp1_ic1R + a2A_2 * v3; v2 = s2_hp1_ic2R + a2A_2 * s2_hp1_ic1R + a3A_2 * v3;\n    s2_hp1_ic1R = 2.0 * v1 - s2_hp1_ic1R; s2_hp1_ic2R = 2.0 * v2 - s2_hp1_ic2R;\n    hp2_s1R = high1R - kStageA * v1 - v2;\n    v3 = hp2_s1R - s2_hp2_ic2R; v1 = a1B_2 * s2_hp2_ic1R + a2B_2 * v3; v2 = s2_hp2_ic2R + a2B_2 * s2_hp2_ic1R + a3B_2 * v3;\n    s2_hp2_ic1R = 2.0 * v1 - s2_hp2_ic1R; s2_hp2_ic2R = 2.0 * v2 - s2_hp2_ic2R;\n    hp2_s2R = hp2_s1R - kStageB * v1 - v2;\n\n    // Allpass at F2 on low1 (Stage A)\n    v3 = low1L - ap2_b1_1_ic2L; v1 = a1A_2 * ap2_b1_1_ic1L + a2A_2 * v3; v2 = ap2_b1_1_ic2L + a2A_2 * ap2_b1_1_ic1L + a3A_2 * v3;\n    ap2_b1_1_ic1L = 2.0 * v1 - ap2_b1_1_ic1L; ap2_b1_1_ic2L = 2.0 * v2 - ap2_b1_1_ic2L;\n    ap2_s1L = low1L - 2.0 * kStageA * v1;\n\n    v3 = low1R - ap2_b1_1_ic2R; v1 = a1A_2 * ap2_b1_1_ic1R + a2A_2 * v3; v2 = ap2_b1_1_ic2R + a2A_2 * ap2_b1_1_ic1R + a3A_2 * v3;\n    ap2_b1_1_ic1R = 2.0 * v1 - ap2_b1_1_ic1R; ap2_b1_1_ic2R = 2.0 * v2 - ap2_b1_1_ic2R;\n    ap2_s1R = low1R - 2.0 * kStageA * v1;\n\n    if (slopeMode > 1.5) {\n        // LR8 (48 dB/oct): Stages 3 & 4\n        v3 = lp2_s2L - s2_lp3_ic2L; v1 = a1A_2 * s2_lp3_ic1L + a2A_2 * v3; v2 = s2_lp3_ic2L + a2A_2 * s2_lp3_ic1L + a3A_2 * v3;\n        s2_lp3_ic1L = 2.0 * v1 - s2_lp3_ic1L; s2_lp3_ic2L = 2.0 * v2 - s2_lp3_ic2L;\n        lp2_s3L = v2;\n        v3 = lp2_s3L - s2_lp4_ic2L; v1 = a1B_2 * s2_lp4_ic1L + a2B_2 * v3; v2 = s2_lp4_ic2L + a2B_2 * s2_lp4_ic1L + a3B_2 * v3;\n        s2_lp4_ic1L = 2.0 * v1 - s2_lp4_ic1L; s2_lp4_ic2L = 2.0 * v2 - s2_lp4_ic2L;\n        low2L = v2;\n\n        v3 = hp2_s2L - s2_hp3_ic2L; v1 = a1A_2 * s2_hp3_ic1L + a2A_2 * v3; v2 = s2_hp3_ic2L + a2A_2 * s2_hp3_ic1L + a3A_2 * v3;\n        s2_hp3_ic1L = 2.0 * v1 - s2_hp3_ic1L; s2_hp3_ic2L = 2.0 * v2 - s2_hp3_ic2L;\n        hp2_s3L = hp2_s2L - kStageA * v1 - v2;\n        v3 = hp2_s3L - s2_hp4_ic2L; v1 = a1B_2 * s2_hp4_ic1L + a2B_2 * v3; v2 = s2_hp4_ic2L + a2B_2 * s2_hp4_ic1L + a3B_2 * v3;\n        s2_hp4_ic1L = 2.0 * v1 - s2_hp4_ic1L; s2_hp4_ic2L = 2.0 * v2 - s2_hp4_ic2L;\n        high2L = hp2_s3L - kStageB * v1 - v2;\n\n        v3 = lp2_s2R - s2_lp3_ic2R; v1 = a1A_2 * s2_lp3_ic1R + a2A_2 * v3; v2 = s2_lp3_ic2R + a2A_2 * s2_lp3_ic1R + a3A_2 * v3;\n        s2_lp3_ic1R = 2.0 * v1 - s2_lp3_ic1R; s2_lp3_ic2R = 2.0 * v2 - s2_lp3_ic2R;\n        lp2_s3R = v2;\n        v3 = lp2_s3R - s2_lp4_ic2R; v1 = a1B_2 * s2_lp4_ic1R + a2B_2 * v3; v2 = s2_lp4_ic2R + a2B_2 * s2_lp4_ic1R + a3B_2 * v3;\n        s2_lp4_ic1R = 2.0 * v1 - s2_lp4_ic1R; s2_lp4_ic2R = 2.0 * v2 - s2_lp4_ic2R;\n        low2R = v2;\n\n        v3 = hp2_s2R - s2_hp3_ic2R; v1 = a1A_2 * s2_hp3_ic1R + a2A_2 * v3; v2 = s2_hp3_ic2R + a2A_2 * s2_hp3_ic1R + a3A_2 * v3;\n        s2_hp3_ic1R = 2.0 * v1 - s2_hp3_ic1R; s2_hp3_ic2R = 2.0 * v2 - s2_hp3_ic2R;\n        hp2_s3R = hp2_s2R - kStageA * v1 - v2;\n        v3 = hp2_s3R - s2_hp4_ic2R; v1 = a1B_2 * s2_hp4_ic1R + a2B_2 * v3; v2 = s2_hp4_ic2R + a2B_2 * s2_hp4_ic1R + a3B_2 * v3;\n        s2_hp4_ic1R = 2.0 * v1 - s2_hp4_ic1R; s2_hp4_ic2R = 2.0 * v2 - s2_hp4_ic2R;\n        high2R = hp2_s3R - kStageB * v1 - v2;\n\n        // 2nd Allpass SVF stage (kStageB) for LR8 allpass on low1\n        v3 = ap2_s1L - ap2_b1_2_ic2L; v1 = a1B_2 * ap2_b1_2_ic1L + a2B_2 * v3; v2 = ap2_b1_2_ic2L + a2B_2 * ap2_b1_2_ic1L + a3B_2 * v3;\n        ap2_b1_2_ic1L = 2.0 * v1 - ap2_b1_2_ic1L; ap2_b1_2_ic2L = 2.0 * v2 - ap2_b1_2_ic2L;\n        b1_after2L = ap2_s1L - 2.0 * kStageB * v1;\n\n        v3 = ap2_s1R - ap2_b1_2_ic2R; v1 = a1B_2 * ap2_b1_2_ic1R + a2B_2 * v3; v2 = ap2_b1_2_ic2R + a2B_2 * ap2_b1_2_ic1R + a3B_2 * v3;\n        ap2_b1_2_ic1R = 2.0 * v1 - ap2_b1_2_ic1R; ap2_b1_2_ic2R = 2.0 * v2 - ap2_b1_2_ic2R;\n        b1_after2R = ap2_s1R - 2.0 * kStageB * v1;\n    } else {\n        low2L = lp2_s2L;\n        high2L = hp2_s2L;\n        low2R = lp2_s2R;\n        high2R = hp2_s2R;\n        b1_after2L = ap2_s1L;\n        b1_after2R = ap2_s1R;\n    }\n}\n\n// =========================================================================\n// STAGE 3: Crossover at smF3 (on high2) + Allpass at smF3 (on b1_after2 & low2)\n// =========================================================================\ng_f3 = calc_tan_g(smF3, sr);\ng1_f3 = g_f3 / (1.0 + g_f3);\n\nif (slopeMode < 0.5) {\n    // 12 dB/oct (LR2) Split on high2\n    vL = (high2L - s3_l1a_L) * g1_f3; lp3aL = vL + s3_l1a_L; s3_l1a_L = lp3aL + vL;\n    vL2 = (lp3aL - s3_l1b_L) * g1_f3; lp3bL = vL2 + s3_l1b_L; s3_l1b_L = lp3bL + vL2;\n    vhL = (high2L - s3_h1a_L) * g1_f3; lp3HaL = vhL + s3_h1a_L; s3_h1a_L = lp3HaL + vhL; hp3aL = high2L - lp3HaL;\n    vhL2 = (hp3aL - s3_h1b_L) * g1_f3; lp3HbL = vhL2 + s3_h1b_L; s3_h1b_L = lp3HbL + vhL2; hp3bL = hp3aL - lp3HbL;\n\n    vR = (high2R - s3_l1a_R) * g1_f3; lp3aR = vR + s3_l1a_R; s3_l1a_R = lp3aR + vR;\n    vR2 = (lp3aR - s3_l1b_R) * g1_f3; lp3bR = vR2 + s3_l1b_R; s3_l1b_R = lp3bR + vR2;\n    vhR = (high2R - s3_h1a_R) * g1_f3; lp3HaR = vhR + s3_h1a_R; s3_h1a_R = lp3HaR + vhR; hp3aR = high2R - lp3HaR;\n    vhR2 = (hp3aR - s3_h1b_R) * g1_f3; lp3HbR = vhR2 + s3_h1b_R; s3_h1b_R = lp3HbR + vhR2; hp3bR = hp3aR - lp3HbR;\n\n    low3L = lp3bL;\n    high3L = -hp3bL;\n    low3R = lp3bR;\n    high3R = -hp3bR;\n\n    // 1st-order Allpass at F3 on b1_after2 and low2\n    va1L = (b1_after2L - ap3_b1_z1L) * g1_f3; lpa1L = va1L + ap3_b1_z1L; ap3_b1_z1L = lpa1L + va1L;\n    b1_after3L = 2.0 * lpa1L - b1_after2L;\n    va1R = (b1_after2R - ap3_b1_z1R) * g1_f3; lpa1R = va1R + ap3_b1_z1R; ap3_b1_z1R = lpa1R + va1R;\n    b1_after3R = 2.0 * lpa1R - b1_after2R;\n\n    va2L = (low2L - ap3_b2_z1L) * g1_f3; lpa2L = va2L + ap3_b2_z1L; ap3_b2_z1L = lpa2L + va2L;\n    b2_after3L = 2.0 * lpa2L - low2L;\n    va2R = (low2R - ap3_b2_z1R) * g1_f3; lpa2R = va2R + ap3_b2_z1R; ap3_b2_z1R = lpa2R + va2R;\n    b2_after3R = 2.0 * lpa2R - low2R;\n} else {\n    a1A_3 = 1.0 / (1.0 + g_f3 * (g_f3 + kStageA));\n    a2A_3 = g_f3 * a1A_3;\n    a3A_3 = g_f3 * a2A_3;\n\n    a1B_3 = 1.0 / (1.0 + g_f3 * (g_f3 + kStageB));\n    a2B_3 = g_f3 * a1B_3;\n    a3B_3 = g_f3 * a2B_3;\n\n    // LP cascade Stage 1 & 2 (L)\n    v3 = high2L - s3_lp1_ic2L; v1 = a1A_3 * s3_lp1_ic1L + a2A_3 * v3; v2 = s3_lp1_ic2L + a2A_3 * s3_lp1_ic1L + a3A_3 * v3;\n    s3_lp1_ic1L = 2.0 * v1 - s3_lp1_ic1L; s3_lp1_ic2L = 2.0 * v2 - s3_lp1_ic2L;\n    lp3_s1L = v2;\n    v3 = lp3_s1L - s3_lp2_ic2L; v1 = a1B_3 * s3_lp2_ic1L + a2B_3 * v3; v2 = s3_lp2_ic2L + a2B_3 * s3_lp2_ic1L + a3B_3 * v3;\n    s3_lp2_ic1L = 2.0 * v1 - s3_lp2_ic1L; s3_lp2_ic2L = 2.0 * v2 - s3_lp2_ic2L;\n    lp3_s2L = v2;\n\n    // HP cascade Stage 1 & 2 (L)\n    v3 = high2L - s3_hp1_ic2L; v1 = a1A_3 * s3_hp1_ic1L + a2A_3 * v3; v2 = s3_hp1_ic2L + a2A_3 * s3_hp1_ic1L + a3A_3 * v3;\n    s3_hp1_ic1L = 2.0 * v1 - s3_hp1_ic1L; s3_hp1_ic2L = 2.0 * v2 - s3_hp1_ic2L;\n    hp3_s1L = high2L - kStageA * v1 - v2;\n    v3 = hp3_s1L - s3_hp2_ic2L; v1 = a1B_3 * s3_hp2_ic1L + a2B_3 * v3; v2 = s3_hp2_ic2L + a2B_3 * s3_hp2_ic1L + a3B_3 * v3;\n    s3_hp2_ic1L = 2.0 * v1 - s3_hp2_ic1L; s3_hp2_ic2L = 2.0 * v2 - s3_hp2_ic2L;\n    hp3_s2L = hp3_s1L - kStageB * v1 - v2;\n\n    // LP cascade Stage 1 & 2 (R)\n    v3 = high2R - s3_lp1_ic2R; v1 = a1A_3 * s3_lp1_ic1R + a2A_3 * v3; v2 = s3_lp1_ic2R + a2A_3 * s3_lp1_ic1R + a3A_3 * v3;\n    s3_lp1_ic1R = 2.0 * v1 - s3_lp1_ic1R; s3_lp1_ic2R = 2.0 * v2 - s3_lp1_ic2R;\n    lp3_s1R = v2;\n    v3 = lp3_s1R - s3_lp2_ic2R; v1 = a1B_3 * s3_lp2_ic1R + a2B_3 * v3; v2 = s3_lp2_ic2R + a2B_3 * s3_lp2_ic1R + a3B_3 * v3;\n    s3_lp2_ic1R = 2.0 * v1 - s3_lp2_ic1R; s3_lp2_ic2R = 2.0 * v2 - s3_lp2_ic2R;\n    lp3_s2R = v2;\n\n    // HP cascade Stage 1 & 2 (R)\n    v3 = high2R - s3_hp1_ic2R; v1 = a1A_3 * s3_hp1_ic1R + a2A_3 * v3; v2 = s3_hp1_ic2R + a2A_3 * s3_hp1_ic1R + a3A_3 * v3;\n    s3_hp1_ic1R = 2.0 * v1 - s3_hp1_ic1R; s3_hp1_ic2R = 2.0 * v2 - s3_hp1_ic2R;\n    hp3_s1R = high2R - kStageA * v1 - v2;\n    v3 = hp3_s1R - s3_hp2_ic2R; v1 = a1B_3 * s3_hp2_ic1R + a2B_3 * v3; v2 = s3_hp2_ic2R + a2B_3 * s3_hp2_ic1R + a3B_3 * v3;\n    s3_hp2_ic1R = 2.0 * v1 - s3_hp2_ic1R; s3_hp2_ic2R = 2.0 * v2 - s3_hp2_ic2R;\n    hp3_s2R = hp3_s1R - kStageB * v1 - v2;\n\n    // Allpass at F3 on b1_after2 (Stage A)\n    v3 = b1_after2L - ap3_b1_1_ic2L; v1 = a1A_3 * ap3_b1_1_ic1L + a2A_3 * v3; v2 = ap3_b1_1_ic2L + a2A_3 * ap3_b1_1_ic1L + a3A_3 * v3;\n    ap3_b1_1_ic1L = 2.0 * v1 - ap3_b1_1_ic1L; ap3_b1_1_ic2L = 2.0 * v2 - ap3_b1_1_ic2L;\n    ap3_b1_s1L = b1_after2L - 2.0 * kStageA * v1;\n\n    v3 = b1_after2R - ap3_b1_1_ic2R; v1 = a1A_3 * ap3_b1_1_ic1R + a2A_3 * v3; v2 = ap3_b1_1_ic2R + a2A_3 * ap3_b1_1_ic1R + a3A_3 * v3;\n    ap3_b1_1_ic1R = 2.0 * v1 - ap3_b1_1_ic1R; ap3_b1_1_ic2R = 2.0 * v2 - ap3_b1_1_ic2R;\n    ap3_b1_s1R = b1_after2R - 2.0 * kStageA * v1;\n\n    // Allpass at F3 on low2 (Stage A)\n    v3 = low2L - ap3_b2_1_ic2L; v1 = a1A_3 * ap3_b2_1_ic1L + a2A_3 * v3; v2 = ap3_b2_1_ic2L + a2A_3 * ap3_b2_1_ic1L + a3A_3 * v3;\n    ap3_b2_1_ic1L = 2.0 * v1 - ap3_b2_1_ic1L; ap3_b2_1_ic2L = 2.0 * v2 - ap3_b2_1_ic2L;\n    ap3_b2_s1L = low2L - 2.0 * kStageA * v1;\n\n    v3 = low2R - ap3_b2_1_ic2R; v1 = a1A_3 * ap3_b2_1_ic1R + a2A_3 * v3; v2 = ap3_b2_1_ic2R + a2A_3 * ap3_b2_1_ic1R + a3A_3 * v3;\n    ap3_b2_1_ic1R = 2.0 * v1 - ap3_b2_1_ic1R; ap3_b2_1_ic2R = 2.0 * v2 - ap3_b2_1_ic2R;\n    ap3_b2_s1R = low2R - 2.0 * kStageA * v1;\n\n    if (slopeMode > 1.5) {\n        // LR8 (48 dB/oct): Stages 3 & 4\n        v3 = lp3_s2L - s3_lp3_ic2L; v1 = a1A_3 * s3_lp3_ic1L + a2A_3 * v3; v2 = s3_lp3_ic2L + a2A_3 * s3_lp3_ic1L + a3A_3 * v3;\n        s3_lp3_ic1L = 2.0 * v1 - s3_lp3_ic1L; s3_lp3_ic2L = 2.0 * v2 - s3_lp3_ic2L;\n        lp3_s3L = v2;\n        v3 = lp3_s3L - s3_lp4_ic2L; v1 = a1B_3 * s3_lp4_ic1L + a2B_3 * v3; v2 = s3_lp4_ic2L + a2B_3 * s3_lp4_ic1L + a3B_3 * v3;\n        s3_lp4_ic1L = 2.0 * v1 - s3_lp4_ic1L; s3_lp4_ic2L = 2.0 * v2 - s3_lp4_ic2L;\n        low3L = v2;\n\n        v3 = hp3_s2L - s3_hp3_ic2L; v1 = a1A_3 * s3_hp3_ic1L + a2A_3 * v3; v2 = s3_hp3_ic2L + a2A_3 * s3_hp3_ic1L + a3A_3 * v3;\n        s3_hp3_ic1L = 2.0 * v1 - s3_hp3_ic1L; s3_hp3_ic2L = 2.0 * v2 - s3_hp3_ic2L;\n        hp3_s3L = hp3_s2L - kStageA * v1 - v2;\n        v3 = hp3_s3L - s3_hp4_ic2L; v1 = a1B_3 * s3_hp4_ic1L + a2B_3 * v3; v2 = s3_hp4_ic2L + a2B_3 * s3_hp4_ic1L + a3B_3 * v3;\n        s3_hp4_ic1L = 2.0 * v1 - s3_hp4_ic1L; s3_hp4_ic2L = 2.0 * v2 - s3_hp4_ic2L;\n        high3L = hp3_s3L - kStageB * v1 - v2;\n\n        v3 = lp3_s2R - s3_lp3_ic2R; v1 = a1A_3 * s3_lp3_ic1R + a2A_3 * v3; v2 = s3_lp3_ic2R + a2A_3 * s3_lp3_ic1R + a3A_3 * v3;\n        s3_lp3_ic1R = 2.0 * v1 - s3_lp3_ic1R; s3_lp3_ic2R = 2.0 * v2 - s3_lp3_ic2R;\n        lp3_s3R = v2;\n        v3 = lp3_s3R - s3_lp4_ic2R; v1 = a1B_3 * s3_lp4_ic1R + a2B_3 * v3; v2 = s3_lp4_ic2R + a2B_3 * s3_lp4_ic1R + a3B_3 * v3;\n        s3_lp4_ic1R = 2.0 * v1 - s3_lp4_ic1R; s3_lp4_ic2R = 2.0 * v2 - s3_lp4_ic2R;\n        low3R = v2;\n\n        v3 = hp3_s2R - s3_hp3_ic2R; v1 = a1A_3 * s3_hp3_ic1R + a2A_3 * v3; v2 = s3_hp3_ic2R + a2A_3 * s3_hp3_ic1R + a3A_3 * v3;\n        s3_hp3_ic1R = 2.0 * v1 - s3_hp3_ic1R; s3_hp3_ic2R = 2.0 * v2 - s3_hp3_ic2R;\n        hp3_s3R = hp3_s2R - kStageA * v1 - v2;\n        v3 = hp3_s3R - s3_hp4_ic2R; v1 = a1B_3 * s3_hp4_ic1R + a2B_3 * v3; v2 = s3_hp4_ic2R + a2B_3 * s3_hp4_ic1R + a3B_3 * v3;\n        s3_hp4_ic1R = 2.0 * v1 - s3_hp4_ic1R; s3_hp4_ic2R = 2.0 * v2 - s3_hp4_ic2R;\n        high3R = hp3_s3R - kStageB * v1 - v2;\n\n        // 2nd Allpass SVF stage (kStageB) for LR8 allpass on b1_after2 & low2\n        v3 = ap3_b1_s1L - ap3_b1_2_ic2L; v1 = a1B_3 * ap3_b1_2_ic1L + a2B_3 * v3; v2 = ap3_b1_2_ic2L + a2B_3 * ap3_b1_2_ic1L + a3B_3 * v3;\n        ap3_b1_2_ic1L = 2.0 * v1 - ap3_b1_2_ic1L; ap3_b1_2_ic2L = 2.0 * v2 - ap3_b1_2_ic2L;\n        b1_after3L = ap3_b1_s1L - 2.0 * kStageB * v1;\n\n        v3 = ap3_b1_s1R - ap3_b1_2_ic2R; v1 = a1B_3 * ap3_b1_2_ic1R + a2B_3 * v3; v2 = ap3_b1_2_ic2R + a2B_3 * ap3_b1_2_ic1R + a3B_3 * v3;\n        ap3_b1_2_ic1R = 2.0 * v1 - ap3_b1_2_ic1R; ap3_b1_2_ic2R = 2.0 * v2 - ap3_b1_2_ic2R;\n        b1_after3R = ap3_b1_s1R - 2.0 * kStageB * v1;\n\n        v3 = ap3_b2_s1L - ap3_b2_2_ic2L; v1 = a1B_3 * ap3_b2_2_ic1L + a2B_3 * v3; v2 = ap3_b2_2_ic2L + a2B_3 * ap3_b2_2_ic1L + a3B_3 * v3;\n        ap3_b2_2_ic1L = 2.0 * v1 - ap3_b2_2_ic1L; ap3_b2_2_ic2L = 2.0 * v2 - ap3_b2_2_ic2L;\n        b2_after3L = ap3_b2_s1L - 2.0 * kStageB * v1;\n\n        v3 = ap3_b2_s1R - ap3_b2_2_ic2R; v1 = a1B_3 * ap3_b2_2_ic1R + a2B_3 * v3; v2 = ap3_b2_2_ic2R + a2B_3 * ap3_b2_2_ic1R + a3B_3 * v3;\n        ap3_b2_2_ic1R = 2.0 * v1 - ap3_b2_2_ic1R; ap3_b2_2_ic2R = 2.0 * v2 - ap3_b2_2_ic2R;\n        b2_after3R = ap3_b2_s1R - 2.0 * kStageB * v1;\n    } else {\n        low3L = lp3_s2L;\n        high3L = hp3_s2L;\n        low3R = lp3_s2R;\n        high3R = hp3_s2R;\n        b1_after3L = ap3_b1_s1L;\n        b1_after3R = ap3_b1_s1R;\n        b2_after3L = ap3_b2_s1L;\n        b2_after3R = ap3_b2_s1R;\n    }\n}\n\n// =========================================================================\n// DYNAMIC PHASE: IIR F1 + COMPLEMENTARY LINEAR-PHASE FIR F2 / F3\n// =========================================================================\nif (sr != firSr) {\n    firSr = sr;\n    firD = clamp(128.0 * round(sr / 48000.0), 128.0, 512.0);\n    i0beta = bessel_i0(6.0);\n    for (j = 0; j <= firD; j += 1) {\n        rr = j / firD;\n        poke(firWin, bessel_i0(6.0 * sqrt(max(1.0 - rr * rr, 0.0))) / i0beta, j);\n    }\n    kF2 = -1.0;\n    kF3 = -1.0;\n}\nDn = firD;\n\n// Kernels follow the smoothed crossovers every 32 samples. Any kernel keeps the bands complementary,\n// so a redesign mid-sweep never breaks the flat sum.\nkCnt = kCnt + 1.0;\nif (kCnt >= 32.0 || kF2 < 0.0 || kF3 < 0.0) {\n    kCnt = 0.0;\n    if (abs(smF2 - kF2) > 0.01) {\n        kF2 = smF2;\n        wc2 = 2.0 * pi * smF2 / sr;\n        ksum2 = 0.0;\n        for (j = 0; j <= Dn; j += 1) {\n            hv2 = (j < 0.5) ? (wc2 / pi) : (sin(wc2 * j) / (pi * max(j, 1.0)));\n            hv2 = hv2 * peek(firWin, j);\n            poke(firK2, hv2, j);\n            ksum2 = ksum2 + ((j < 0.5) ? hv2 : 2.0 * hv2);\n        }\n        inv2 = 1.0 / max(ksum2, 1e-9);\n        for (j = 0; j <= Dn; j += 1) {\n            poke(firK2, peek(firK2, j) * inv2, j);\n        }\n    }\n    if (abs(smF3 - kF3) > 0.01) {\n        kF3 = smF3;\n        wc3 = 2.0 * pi * smF3 / sr;\n        ksum3 = 0.0;\n        for (j = 0; j <= Dn; j += 1) {\n            hv3 = (j < 0.5) ? (wc3 / pi) : (sin(wc3 * j) / (pi * max(j, 1.0)));\n            hv3 = hv3 * peek(firWin, j);\n            poke(firK3, hv3, j);\n            ksum3 = ksum3 + ((j < 0.5) ? hv3 : 2.0 * hv3);\n        }\n        inv3 = 1.0 / max(ksum3, 1e-9);\n        for (j = 0; j <= Dn; j += 1) {\n            poke(firK3, peek(firK3, j) * inv3, j);\n        }\n    }\n}\n\n// Rings always run so a mode switch starts with valid history\nwp = firWp;\npoke(firRing, xL, wp, 0);\npoke(firRing, xR, wp, 1);\npoke(firRing, low1L, wp, 2);\npoke(firRing, low1R, wp, 3);\npoke(firRing, high1L, wp, 4);\npoke(firRing, high1R, wp, 5);\nfirWp = (wp + 1.0 >= 2048.0) ? 0.0 : wp + 1.0;\n\n// 4 ms fade out -> switch -> 4 ms fade in, so the latency jump never clicks\ndynTarget = (dynphase > 0.5) ? 1.0 : 0.0;\nfadeStep = 1.0 / max(0.004 * sr, 1.0);\nif (dynTarget != dynActive) {\n    dynFade = max(dynFade - fadeStep, 0.0);\n    if (dynFade <= 0.0) {\n        dynActive = dynTarget;\n    }\n} else {\n    dynFade = min(dynFade + fadeStep, 1.0);\n}\n\nband1L = 0.0; band1R = 0.0; band2L = 0.0; band2R = 0.0;\nband3L = 0.0; band3R = 0.0; band4L = 0.0; band4R = 0.0;\n\nif (dynActive > 2.0) {\n    band1L = 0.0;\n} else {\n    // =========================================================================\n    // SELECT 1-WAY (FULL), 2-WAY, 3-WAY, OR 4-WAY PHASE-ALIGNED BANDS\n    // =========================================================================\n    band1L = (nb < 1.5) ? xL : ((nb < 2.5) ? low1L : ((nb < 3.5) ? b1_after2L : b1_after3L));\n    band1R = (nb < 1.5) ? xR : ((nb < 2.5) ? low1R : ((nb < 3.5) ? b1_after2R : b1_after3R));\n\n    band2L = (nb < 1.5) ? 0.0 : ((nb < 2.5) ? high1L : ((nb < 3.5) ? low2L : b2_after3L));\n    band2R = (nb < 1.5) ? 0.0 : ((nb < 2.5) ? high1R : ((nb < 3.5) ? low2R : b2_after3R));\n\n    band3L = (nb < 2.5) ? 0.0 : ((nb < 3.5) ? high2L : low3L);\n    band3R = (nb < 2.5) ? 0.0 : ((nb < 3.5) ? high2R : low3R);\n\n    band4L = (nb < 3.5) ? 0.0 : high3L;\n    band4R = (nb < 3.5) ? 0.0 : high3R;\n}\n\n// Decode 4-bit bandmask\nen1 = (mod(floor(maskInt), 2.0) >= 0.5) ? 1.0 : 0.0;\nen2 = (mod(floor(maskInt * 0.5), 2.0) >= 0.5) ? 1.0 : 0.0;\nen3 = (mod(floor(maskInt * 0.25), 2.0) >= 0.5) ? 1.0 : 0.0;\nen4 = (mod(floor(maskInt * 0.125), 2.0) >= 0.5) ? 1.0 : 0.0;\n\nsumL = en1 * band1L + en2 * band2L + en3 * band3L + en4 * band4L;\nsumR = en1 * band1R + en2 * band2R + en3 * band3R + en4 * band4R;\n\noutL = fixnan(sumL * smGain * phaseSign * dynFade);\noutR = fixnan(sumR * smGain * phaseSign * dynFade);\n\nout1 = outL;\nout2 = outR;\n\n// =========================================================================\n// 16-BAND SPECTRUM ANALYZER & TELEMETRY (poked to Buffer scope every 64 samps)\n// =========================================================================\nmonoIn = 0.5 * (xL + xR);\nenvDecay = 0.9992;\nkSpec = 0.45; // Q ~ 2.2 bandpass analysis bank\n\n// Band 0: 32 Hz\ng0 = calc_tan_g(32.0, sr); a1_0 = 1.0 / (1.0 + g0 * (g0 + kSpec)); a2_0 = g0 * a1_0; a3_0 = g0 * a2_0;\nv3 = monoIn - sp_ic2_0; v1 = a1_0 * sp_ic1_0 + a2_0 * v3; v2 = sp_ic2_0 + a2_0 * sp_ic1_0 + a3_0 * v3;\nsp_ic1_0 = 2.0 * v1 - sp_ic1_0; sp_ic2_0 = 2.0 * v2 - sp_ic2_0;\nsp_env_0 = max(abs(kSpec * v1), sp_env_0 * envDecay);\n\n// Band 1: 48 Hz\ng1s = calc_tan_g(48.0, sr); a1_1 = 1.0 / (1.0 + g1s * (g1s + kSpec)); a2_1 = g1s * a1_1; a3_1 = g1s * a2_1;\nv3 = monoIn - sp_ic2_1; v1 = a1_1 * sp_ic1_1 + a2_1 * v3; v2 = sp_ic2_1 + a2_1 * sp_ic1_1 + a3_1 * v3;\nsp_ic1_1 = 2.0 * v1 - sp_ic1_1; sp_ic2_1 = 2.0 * v2 - sp_ic2_1;\nsp_env_1 = max(abs(kSpec * v1), sp_env_1 * envDecay);\n\n// Band 2: 72 Hz\ng2s = calc_tan_g(72.0, sr); a1_2 = 1.0 / (1.0 + g2s * (g2s + kSpec)); a2_2 = g2s * a1_2; a3_2 = g2s * a2_2;\nv3 = monoIn - sp_ic2_2; v1 = a1_2 * sp_ic1_2 + a2_2 * v3; v2 = sp_ic2_2 + a2_2 * sp_ic1_2 + a3_2 * v3;\nsp_ic1_2 = 2.0 * v1 - sp_ic1_2; sp_ic2_2 = 2.0 * v2 - sp_ic2_2;\nsp_env_2 = max(abs(kSpec * v1), sp_env_2 * envDecay);\n\n// Band 3: 110 Hz\ng3s = calc_tan_g(110.0, sr); a1_3 = 1.0 / (1.0 + g3s * (g3s + kSpec)); a2_3 = g3s * a1_3; a3_3 = g3s * a2_3;\nv3 = monoIn - sp_ic2_3; v1 = a1_3 * sp_ic1_3 + a2_3 * v3; v2 = sp_ic2_3 + a2_3 * sp_ic1_3 + a3_3 * v3;\nsp_ic1_3 = 2.0 * v1 - sp_ic1_3; sp_ic2_3 = 2.0 * v2 - sp_ic2_3;\nsp_env_3 = max(abs(kSpec * v1), sp_env_3 * envDecay);\n\n// Band 4: 165 Hz\ng4s = calc_tan_g(165.0, sr); a1_4 = 1.0 / (1.0 + g4s * (g4s + kSpec)); a2_4 = g4s * a1_4; a3_4 = g4s * a2_4;\nv3 = monoIn - sp_ic2_4; v1 = a1_4 * sp_ic1_4 + a2_4 * v3; v2 = sp_ic2_4 + a2_4 * sp_ic1_4 + a3_4 * v3;\nsp_ic1_4 = 2.0 * v1 - sp_ic1_4; sp_ic2_4 = 2.0 * v2 - sp_ic2_4;\nsp_env_4 = max(abs(kSpec * v1), sp_env_4 * envDecay);\n\n// Band 5: 250 Hz\ng5s = calc_tan_g(250.0, sr); a1_5 = 1.0 / (1.0 + g5s * (g5s + kSpec)); a2_5 = g5s * a1_5; a3_5 = g5s * a2_5;\nv3 = monoIn - sp_ic2_5; v1 = a1_5 * sp_ic1_5 + a2_5 * v3; v2 = sp_ic2_5 + a2_5 * sp_ic1_5 + a3_5 * v3;\nsp_ic1_5 = 2.0 * v1 - sp_ic1_5; sp_ic2_5 = 2.0 * v2 - sp_ic2_5;\nsp_env_5 = max(abs(kSpec * v1), sp_env_5 * envDecay);\n\n// Band 6: 375 Hz\ng6s = calc_tan_g(375.0, sr); a1_6 = 1.0 / (1.0 + g6s * (g6s + kSpec)); a2_6 = g6s * a1_6; a3_6 = g6s * a2_6;\nv3 = monoIn - sp_ic2_6; v1 = a1_6 * sp_ic1_6 + a2_6 * v3; v2 = sp_ic2_6 + a2_6 * sp_ic1_6 + a3_6 * v3;\nsp_ic1_6 = 2.0 * v1 - sp_ic1_6; sp_ic2_6 = 2.0 * v2 - sp_ic2_6;\nsp_env_6 = max(abs(kSpec * v1), sp_env_6 * envDecay);\n\n// Band 7: 560 Hz\ng7s = calc_tan_g(560.0, sr); a1_7 = 1.0 / (1.0 + g7s * (g7s + kSpec)); a2_7 = g7s * a1_7; a3_7 = g7s * a2_7;\nv3 = monoIn - sp_ic2_7; v1 = a1_7 * sp_ic1_7 + a2_7 * v3; v2 = sp_ic2_7 + a2_7 * sp_ic1_7 + a3_7 * v3;\nsp_ic1_7 = 2.0 * v1 - sp_ic1_7; sp_ic2_7 = 2.0 * v2 - sp_ic2_7;\nsp_env_7 = max(abs(kSpec * v1), sp_env_7 * envDecay);\n\n// Band 8: 840 Hz\ng8s = calc_tan_g(840.0, sr); a1_8 = 1.0 / (1.0 + g8s * (g8s + kSpec)); a2_8 = g8s * a1_8; a3_8 = g8s * a2_8;\nv3 = monoIn - sp_ic2_8; v1 = a1_8 * sp_ic1_8 + a2_8 * v3; v2 = sp_ic2_8 + a2_8 * sp_ic1_8 + a3_8 * v3;\nsp_ic1_8 = 2.0 * v1 - sp_ic1_8; sp_ic2_8 = 2.0 * v2 - sp_ic2_8;\nsp_env_8 = max(abs(kSpec * v1), sp_env_8 * envDecay);\n\n// Band 9: 1260 Hz\ng9s = calc_tan_g(1260.0, sr); a1_9 = 1.0 / (1.0 + g9s * (g9s + kSpec)); a2_9 = g9s * a1_9; a3_9 = g9s * a2_9;\nv3 = monoIn - sp_ic2_9; v1 = a1_9 * sp_ic1_9 + a2_9 * v3; v2 = sp_ic2_9 + a2_9 * sp_ic1_9 + a3_9 * v3;\nsp_ic1_9 = 2.0 * v1 - sp_ic1_9; sp_ic2_9 = 2.0 * v2 - sp_ic2_9;\nsp_env_9 = max(abs(kSpec * v1), sp_env_9 * envDecay);\n\n// Band 10: 1900 Hz\ng10s = calc_tan_g(1900.0, sr); a1_10 = 1.0 / (1.0 + g10s * (g10s + kSpec)); a2_10 = g10s * a1_10; a3_10 = g10s * a2_10;\nv3 = monoIn - sp_ic2_10; v1 = a1_10 * sp_ic1_10 + a2_10 * v3; v2 = sp_ic2_10 + a2_10 * sp_ic1_10 + a3_10 * v3;\nsp_ic1_10 = 2.0 * v1 - sp_ic1_10; sp_ic2_10 = 2.0 * v2 - sp_ic2_10;\nsp_env_10 = max(abs(kSpec * v1), sp_env_10 * envDecay);\n\n// Band 11: 2850 Hz\ng11s = calc_tan_g(2850.0, sr); a1_11 = 1.0 / (1.0 + g11s * (g11s + kSpec)); a2_11 = g11s * a1_11; a3_11 = g11s * a2_11;\nv3 = monoIn - sp_ic2_11; v1 = a1_11 * sp_ic1_11 + a2_11 * v3; v2 = sp_ic2_11 + a2_11 * sp_ic1_11 + a3_11 * v3;\nsp_ic1_11 = 2.0 * v1 - sp_ic1_11; sp_ic2_11 = 2.0 * v2 - sp_ic2_11;\nsp_env_11 = max(abs(kSpec * v1), sp_env_11 * envDecay);\n\n// Band 12: 4300 Hz\ng12s = calc_tan_g(4300.0, sr); a1_12 = 1.0 / (1.0 + g12s * (g12s + kSpec)); a2_12 = g12s * a1_12; a3_12 = g12s * a2_12;\nv3 = monoIn - sp_ic2_12; v1 = a1_12 * sp_ic1_12 + a2_12 * v3; v2 = sp_ic2_12 + a2_12 * sp_ic1_12 + a3_12 * v3;\nsp_ic1_12 = 2.0 * v1 - sp_ic1_12; sp_ic2_12 = 2.0 * v2 - sp_ic2_12;\nsp_env_12 = max(abs(kSpec * v1), sp_env_12 * envDecay);\n\n// Band 13: 6450 Hz\ng13s = calc_tan_g(6450.0, sr); a1_13 = 1.0 / (1.0 + g13s * (g13s + kSpec)); a2_13 = g13s * a1_13; a3_13 = g13s * a2_13;\nv3 = monoIn - sp_ic2_13; v1 = a1_13 * sp_ic1_13 + a2_13 * v3; v2 = sp_ic2_13 + a2_13 * sp_ic1_13 + a3_13 * v3;\nsp_ic1_13 = 2.0 * v1 - sp_ic1_13; sp_ic2_13 = 2.0 * v2 - sp_ic2_13;\nsp_env_13 = max(abs(kSpec * v1), sp_env_13 * envDecay);\n\n// Band 14: 9700 Hz\ng14s = calc_tan_g(9700.0, sr); a1_14 = 1.0 / (1.0 + g14s * (g14s + kSpec)); a2_14 = g14s * a1_14; a3_14 = g14s * a2_14;\nv3 = monoIn - sp_ic2_14; v1 = a1_14 * sp_ic1_14 + a2_14 * v3; v2 = sp_ic2_14 + a2_14 * sp_ic1_14 + a3_14 * v3;\nsp_ic1_14 = 2.0 * v1 - sp_ic1_14; sp_ic2_14 = 2.0 * v2 - sp_ic2_14;\nsp_env_14 = max(abs(kSpec * v1), sp_env_14 * envDecay);\n\n// Band 15: 14500 Hz\ng15s = calc_tan_g(14500.0, sr); a1_15 = 1.0 / (1.0 + g15s * (g15s + kSpec)); a2_15 = g15s * a1_15; a3_15 = g15s * a2_15;\nv3 = monoIn - sp_ic2_15; v1 = a1_15 * sp_ic1_15 + a2_15 * v3; v2 = sp_ic2_15 + a2_15 * sp_ic1_15 + a3_15 * v3;\nsp_ic1_15 = 2.0 * v1 - sp_ic1_15; sp_ic2_15 = 2.0 * v2 - sp_ic2_15;\nsp_env_15 = max(abs(kSpec * v1), sp_env_15 * envDecay);\n\n// Per-band & I/O peak tracking\npkB1 = max(0.5 * (abs(band1L) + abs(band1R)), pkB1 * envDecay);\npkB2 = max(0.5 * (abs(band2L) + abs(band2R)), pkB2 * envDecay);\npkB3 = max(0.5 * (abs(band3L) + abs(band3R)), pkB3 * envDecay);\npkB4 = max(0.5 * (abs(band4L) + abs(band4R)), pkB4 * envDecay);\npkIn = max(max(abs(xL), abs(xR)), pkIn * envDecay);\npkOut = max(max(abs(outL), abs(outR)), pkOut * envDecay);\n\n// Write mono input into 8192-sample circular audio ring buffer (indices 32..8223) for 8192-block FFT spectrogram\npoke(scope, monoIn, 32.0 + ringPos, 0, 0);\nringPos = mod(ringPos + 1.0, 8192.0);\n\nscopeCnt = scopeCnt + 1.0;\nif (scopeCnt >= 64.0) {\n    scopeCnt = 0.0;\n    scopeBeat = mod(scopeBeat + 1.0, 1024.0);\n    poke(scope, sp_env_0, 0, 0, 0);\n    poke(scope, sp_env_1, 1, 0, 0);\n    poke(scope, sp_env_2, 2, 0, 0);\n    poke(scope, sp_env_3, 3, 0, 0);\n    poke(scope, sp_env_4, 4, 0, 0);\n    poke(scope, sp_env_5, 5, 0, 0);\n    poke(scope, sp_env_6, 6, 0, 0);\n    poke(scope, sp_env_7, 7, 0, 0);\n    poke(scope, sp_env_8, 8, 0, 0);\n    poke(scope, sp_env_9, 9, 0, 0);\n    poke(scope, sp_env_10, 10, 0, 0);\n    poke(scope, sp_env_11, 11, 0, 0);\n    poke(scope, sp_env_12, 12, 0, 0);\n    poke(scope, sp_env_13, 13, 0, 0);\n    poke(scope, sp_env_14, 14, 0, 0);\n    poke(scope, sp_env_15, 15, 0, 0);\n    poke(scope, pkB1, 16, 0, 0);\n    poke(scope, pkB2, 17, 0, 0);\n    poke(scope, pkB3, 18, 0, 0);\n    poke(scope, pkB4, 19, 0, 0);\n    poke(scope, pkIn, 20, 0, 0);\n    poke(scope, pkOut, 21, 0, 0);\n    poke(scope, maskInt, 22, 0, 0);\n    poke(scope, scopeBeat, 23, 0, 0);\n    poke(scope, ringPos, 24, 0, 0);\n    poke(scope, sr, 25, 0, 0);\n    poke(scope, firD, 26, 0, 0);\n    poke(scope, dynActive, 27, 0, 0);\n}\n",
          "fontname": "<Monospaced>",
          "fontsize": 10.0,
          "id": "obj-gen1",
          "maxclass": "gen.codebox~",
          "numinlets": 2,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            "signal"
          ],
          "patching_rect": [
            220.0,
            200.0,
            220.0,
            60.0
          ]
        }
      },
      {
        "box": {
          "id": "obj-p1",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            220.0,
            160.0,
            520.0,
            20.0
          ],
          "text": "scope #0-splitscope, numbands 4, slope 1, f1 150, f2 900, f3 4200, bandmask 15, gain 0, phase 0"
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "obj-load",
            0
          ],
          "destination": [
            "obj-del-dsp",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-load",
            0
          ],
          "destination": [
            "obj-setbuf",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-setbuf",
            0
          ],
          "destination": [
            "obj-js",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-dsp",
            0
          ],
          "destination": [
            "obj-dsp",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-dsp",
            0
          ],
          "destination": [
            "obj-del-arm",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-arm",
            0
          ],
          "destination": [
            "obj-rec-on",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-arm",
            0
          ],
          "destination": [
            "obj-del-stop",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-stop",
            0
          ],
          "destination": [
            "obj-rec-off",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-stop",
            0
          ],
          "destination": [
            "obj-del-analyze",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-rec-on",
            0
          ],
          "destination": [
            "obj-record",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-rec-off",
            0
          ],
          "destination": [
            "obj-record",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-analyze",
            0
          ],
          "destination": [
            "obj-analyze",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-analyze",
            0
          ],
          "destination": [
            "obj-js",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-js",
            0
          ],
          "destination": [
            "obj-quit",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-mute-l",
            0
          ],
          "destination": [
            "obj-dac",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-mute-r",
            0
          ],
          "destination": [
            "obj-dac",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-osc1",
            0
          ],
          "destination": [
            "obj-sum-in",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-osc2",
            0
          ],
          "destination": [
            "obj-sum-in",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-osc3",
            0
          ],
          "destination": [
            "obj-sum-in",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-osc4",
            0
          ],
          "destination": [
            "obj-sum-in",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-load",
            0
          ],
          "destination": [
            "obj-p1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-p1",
            0
          ],
          "destination": [
            "obj-gen1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-sum-in",
            0
          ],
          "destination": [
            "obj-gen1",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-sum-in",
            0
          ],
          "destination": [
            "obj-gen1",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-gen1",
            0
          ],
          "destination": [
            "obj-record",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-sum-in",
            0
          ],
          "destination": [
            "obj-record",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-gen1",
            0
          ],
          "destination": [
            "obj-mute-l",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-sum-in",
            0
          ],
          "destination": [
            "obj-mute-r",
            0
          ]
        }
      }
    ]
  }
}