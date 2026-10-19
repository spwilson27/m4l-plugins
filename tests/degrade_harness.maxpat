{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 9,
      "minor": 1,
      "revision": 0,
      "architecture": "x64",
      "modernui": 1
    },
    "rect": [
      80.0,
      80.0,
      980.0,
      560.0
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
            40.0,
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
            80.0,
            80.0,
            20.0
          ],
          "text": "delay 1600"
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
            120.0,
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
            160.0,
            80.0,
            20.0
          ],
          "text": "delay 1500"
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
            200.0,
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
            240.0,
            80.0,
            20.0
          ],
          "text": "delay 450"
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
            280.0,
            30.0,
            20.0
          ],
          "text": "0"
        }
      },
      {
        "box": {
          "id": "obj-del-peak",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            40.0,
            320.0,
            70.0,
            20.0
          ],
          "text": "delay 40"
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
            360.0,
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
            360.0,
            90.0,
            20.0
          ],
          "text": "analyze 450"
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
            420.0,
            70.0,
            20.0
          ],
          "text": "; max quit"
        }
      },
      {
        "box": {
          "id": "obj-params",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            200.0,
            40.0,
            740.0,
            20.0
          ],
          "text": "wet 1.0, out_gain 0, bit_on 1, bits 2.0, wrap_amt 0.8, dither 0.0, sr_on 0, codec_on 0, tele_on 1, tele_mode 2, tele_line 0.85, fft_on 0, order_code 30124"
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
            200.0,
            70.0,
            190.0,
            20.0
          ],
          "text": "setbuffer #0-degscope"
        }
      },
      {
        "box": {
          "id": "obj-bind",
          "maxclass": "message",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            ""
          ],
          "patching_rect": [
            200.0,
            100.0,
            180.0,
            20.0
          ],
          "text": "scope #0-degscope"
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
            520.0,
            100.0,
            210.0,
            20.0
          ],
          "text": "buffer~ #0-degscope @samps 32"
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
            520.0,
            160.0,
            150.0,
            20.0
          ],
          "text": "buffer~ rec 2000 2"
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
            130.0,
            70.0,
            20.0
          ],
          "text": "cycle~ 220"
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
            130.0,
            75.0,
            20.0
          ],
          "text": "cycle~ 1760"
        }
      },
      {
        "box": {
          "id": "obj-g1",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            200.0,
            160.0,
            55.0,
            20.0
          ],
          "text": "*~ 0.45"
        }
      },
      {
        "box": {
          "id": "obj-g2",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            280.0,
            160.0,
            55.0,
            20.0
          ],
          "text": "*~ 0.20"
        }
      },
      {
        "box": {
          "id": "obj-sum",
          "maxclass": "newobj",
          "numinlets": 2,
          "numoutlets": 1,
          "outlettype": [
            "signal"
          ],
          "patching_rect": [
            200.0,
            185.0,
            40.0,
            20.0
          ],
          "text": "+~"
        }
      },
      {
        "box": {
          "code": "// Degrade \u2014 Modular 5-Section Reorderable Digital & Codec Degradation Engine.\n//\n// Sections (dynamically ordered via `order_code` permutation of [0, 1, 2, 3, 4],\n// each wrapped in an `if ((stId == k) * (<stage>_on > 0.5))` zero-CPU bypass gate):\n//   0: BIT     \u2014 Bit reduction (1..16 bits), signal-following noise floor, integer wrap & TPDF dither\n//   1: SR      \u2014 Sample-rate decimation (S&H vs Filtered reconstruction) & chaotic clock jitter\n//   2: CODEC   \u2014 SpecOps MP3ify / MAIM style 16-Band Pitch-Tracked Sinusoidal MDCT Resynthesizer:\n//                zero-crossing instantaneous frequency tracking snapped to FFT bin multiples,\n//                lateral psychoacoustic spectral holes, smooth multi-frame birdie chirp envelopes,\n//                sfb21 HF cutoff, and true 32-ms lookahead spectral envelope pre-echo swell\n//   3: TELE    \u2014 Telephone companding (u-Law, A-Law, IMA ADPCM slope-overload, GSM 06.10 buzz)\n//   4: FFT     \u2014 Spectral frame glitch (Freeze/Hold, Bin Scramble, Spectral Comb, Phase Splat)\n//\n// Telemetry buffer (`buffer~ #0-degscope`, bound on loadbang via `scope #0-degscope`):\n//   0      : Input peak (0..1)\n//   1      : Wet output peak (0..1)\n//   2..6   : Per-stage activity meter for BIT, SR, CODEC, TELE, FFT (0 when disabled)\n//   7      : Rolling frame counter\n//   8..15  : 8-sample decimated wet waveform ring for real-time staircase/glitch trace\n//   16..27 : 12-band spectral energy / hole profile (0..1)\n//   28     : Effective bit depth (1..16)\n//   29     : Effective sample-rate ratio (0..1)\n//   30     : Active stage bitmask (0..31)\n//   31     : Current order_code echo\n//\n// GenExpr rules strictly enforced:\n//   - All helper functions appear BEFORE Buffer, Param, History, and Delay declarations.\n//   - No identifier is named e<digit> (Euler's constant lexer rule).\n//   - Delay lines use Delay.write / Delay.read methods.\n\nslew(target, coef) {\n\tHistory s(0);\n\tHistory init(0);\n\ts = (init == 0) ? target : mix(target, s, coef);\n\tinit = 1;\n\treturn s;\n}\n\nquant_steps(x, steps) {\n\ts = max(steps, 2.0);\n\thalf = s * 0.5;\n\treturn round(x * half) / half;\n}\n\nint_wrap(x, drive, wrapMix) {\n\td = x * max(drive, 1.0);\n\tclipped = clip(d, -1.0, 1.0);\n\tfolded = wrap(d + 1.0, 0.0, 2.0) - 1.0;\n\tw = clip(wrapMix, 0.0, 1.0);\n\treturn mix(clipped, folded, w);\n}\n\nulaw_compand(x, qSteps) {\n\tsgn = (x >= 0) ? 1.0 : -1.0;\n\tax = clip(abs(x), 0.0, 1.0);\n\tmu = 255.0;\n\tcomp = sgn * (log(1.0 + mu * ax) / 5.54517744448);\n\tqComp = quant_steps(comp, qSteps);\n\tsgnQ = (qComp >= 0) ? 1.0 : -1.0;\n\texpVal = sgnQ * ((pow(256.0, abs(qComp)) - 1.0) / mu);\n\treturn clip(expVal, -1.0, 1.0);\n}\n\nalaw_compand(x, qSteps) {\n\tsgn = (x >= 0) ? 1.0 : -1.0;\n\tax = clip(abs(x), 0.0, 1.0);\n\taVal = 87.6;\n\tlnA = 5.47278106592;\n\tcompLo = sgn * (aVal * ax) / lnA;\n\taxScaled = max(aVal * ax, 0.0001);\n\tcompHi = sgn * (1.0 + log(axScaled)) / lnA;\n\tcomp = (ax < 0.01141552511) ? compLo : compHi;\n\tqComp = quant_steps(comp, qSteps);\n\tsgnQ = (qComp >= 0) ? 1.0 : -1.0;\n\taq = abs(qComp);\n\texpLo = (aq * lnA) / aVal;\n\texpHi = exp(aq * lnA - 1.0) / aVal;\n\texpVal = sgnQ * ((aq < 0.18272246982) ? expLo : expHi);\n\treturn clip(expVal, -1.0, 1.0);\n}\n\n// SpecOps MP3ify + MAIM style psychoacoustic spectral hole, packet starvation & birdie gain computer.\n//   - 0..70% Damage: progressive psychoacoustic spectral holes, sfb21 HF rolloff & birdie warble.\n//   - 70..100% Damage: extreme buffer-underrun / packet-loss starvation where almost all spectral\n//     bands are zeroed into deep silence (`0.0`) except for rare, isolated sinusoidal birdie glitches!\nmp3ify_band_mask(bandEnv, nbrEnv, avgEnv, lossAmt, birdieAmt, randBip, bandIdxNorm) {\n\t// 1. Low-bitrate MP3 sfb21 high-frequency rolloff\n\thfLimit = 1.15 - lossAmt * 0.78;\n\thfWidth = 0.14;\n\thfGate = clip((hfLimit - bandIdxNorm) / hfWidth, 0.0, 1.0);\n\thfPass = hfGate * hfGate * (3.0 - 2.0 * hfGate);\n\n\t// 2. Psychoacoustic lateral + global simultaneous masking threshold\n\t//    Above 65% Damage, `starveCurve` ramps up steeply so thresholds exceed normal signal levels\n\tstarveZone = clip((lossAmt - 0.62) / 0.38, 0.0, 1.0);\n\tstarveCurve = starveZone * starveZone * (3.0 - 2.0 * starveZone);\n\n\tlatMask = nbrEnv * (0.46 + lossAmt * 0.85 + starveCurve * 3.5);\n\tglobMask = avgEnv * (0.35 + lossAmt * 1.85 + starveCurve * 6.5);\n\tmaskHi = max(latMask, globMask);\n\tthresh = max(maskHi, 0.0003);\n\n\t// 3. Stochastic Packet-Drop & Isolated Birdie Glitch Survival\n\t//    As lossAmt -> 1.0, `surviveProb` drops to ~5% so almost every band is gated to 0.0,\n\t//    and only rare random birdie spikes (`abs(randBip) > dropCeil`) poke through the silence!\n\tdropCeil = clip(lossAmt * lossAmt * 0.94, 0.0, 0.94);\n\tpacketAlive = clip((abs(randBip) - dropCeil) / max(1.0 - dropCeil, 0.04), 0.0, 1.0);\n\tpacketMask = packetAlive * packetAlive * (3.0 - 2.0 * packetAlive);\n\n\t// Occasional random glitch burst allows an isolated partial to pierce through high thresholds\n\t// At high Birdies (birdieAmt -> 1.0), birdie spikes happen more frequently and ring out stronger!\n\tglitchThresh = 0.92 - birdieAmt * 0.32;\n\tglitchBurst = (randBip > glitchThresh) ? (2.2 + starveCurve * 6.5 + birdieAmt * 3.5) : 1.0;\n\tbirdMod = (1.0 + randBip * birdieAmt * 1.35) * glitchBurst;\n\tposMod = max(birdMod, 0.02);\n\teffEnv = bandEnv * posMod;\n\n\t// Cubic soft-knee spectral hole gate (drops masked bands to 0.0 with zero click)\n\tthreshLo = thresh * 0.82;\n\tthreshHi = max(thresh * 1.18, threshLo + 0.00005);\n\tholeT = clip((effEnv - threshLo) / (threshHi - threshLo), 0.0, 1.0);\n\tholeCurve = holeT * holeT * (3.0 - 2.0 * holeT);\n\n\t// 4. MAIM / MP3 x^(3/4) non-linear scale-factor quantization on surviving bands\n\tdenomAvg = max(avgEnv * 2.0, 0.001);\n\tnormMag = clip(effEnv / denomAvg, 0.0, 1.8);\n\tqSteps = max(1.5, 14.0 - lossAmt * 12.2);\n\tsafeNorm = max(normMag, 0.0001);\n\tpow34 = pow(safeNorm, 0.75);\n\tqInt = floor(pow34 * qSteps + 0.5);\n\tqRatio = max(qInt / qSteps, 0.0);\n\tqMag = pow(qRatio, 1.3333333);\n\tqScale = qMag / max(normMag, 0.08);\n\tquantFactor = mix(1.0, clip(qScale, 0.0, 1.6), lossAmt * 0.75);\n\n\t// Combine spectral hole gate with stochastic packet-starvation mask\n\tstarveBlend = clip((lossAmt - 0.45) / 0.55, 0.0, 1.0);\n\tfinalHole = holeCurve * mix(1.0, packetMask, starveBlend);\n\n\t// Keep mid- frequencies alive during extreme 100% glitch bursts even if sfb21 is low\n\teffHf = mix(hfPass, 1.0, starveCurve * packetMask * 0.85);\n\toutG = finalHole * quantFactor * effHf;\n\treturn clip(outG, 0.0, 2.2);\n}\n\n// Quantizes a tracked band frequency `estHz` toward discrete FFT bin multiples (`binStepHz`)\n// with wide Birdie bin-hopping (`birdHopHz`) so resynthesized partials warble and arpeggiate\n// across FFT bins like extreme low-bitrate MP3/Opus birdies.\nsnap_fft_bin_hz(estHz, centerHz, binStepHz, snapAmt, birdHopHz) {\n\tclampedHz = clip(estHz, centerHz * 0.55, centerHz * 1.75);\n\tshiftedHz = clampedHz + birdHopHz;\n\tsafeStep = max(binStepHz, 10.0);\n\tqBinHz = round(shiftedHz / safeStep) * safeStep;\n\tsafeQHz = clip(qBinHz, centerHz * 0.42, centerHz * 2.35);\n\tsAmt = clip(snapAmt, 0.0, 1.0);\n\treturn mix(clampedHz, safeQHz, sAmt);\n}\n\nhann_win(ph) {\n\tp = clip(ph, 0.0, 1.0);\n\treturn 0.5 - 0.5 * cos(p * 6.28318530718);\n}\n\nBuffer scope(\"degscope\");\n\n// Global & Order parameters\nParam order_code(1234);\nParam wet(0.5);\nParam out_gain(0.0);\n\n// Stage 0: BIT (Bit Reduction, Integer Wrap & Dither)\nParam bit_on(0.0);\nParam bits(16.0);\nParam wrap_amt(0.0);\nParam dither(0.0);\n\n// Stage 1: SR (Sample-Rate Reduction & Clock Jitter)\nParam sr_on(0.0);\nParam srate(44100.0);\nParam jitter(0.0);\nParam sr_mode(0.0);\n\n// Stage 2: CODEC (Lossy MP3/AAC/Opus Spectral Holes, Pre-Echo & Birdies)\nParam codec_on(0.0);\nParam codec_loss(0.0);\nParam preecho(0.0);\nParam birdies(0.0);\n\n// Stage 3: TELE (Telecom Companding: u-Law, A-Law, ADPCM, GSM)\nParam tele_on(0.0);\nParam tele_mode(0.0);\nParam tele_line(0.0);\n\n// Stage 4: FFT (Spectral Frame Glitch: Freeze, Scramble, Comb, Splat)\nParam fft_on(0.0);\nParam fft_mode(0.0);\nParam fft_glitch(0.0);\nParam fft_frame(45.0);\n\n// PRNG & Order latch histories\nHistory prngState(0.318309886);\nHistory prevNoiseL(0);\nHistory prevNoiseR(0);\nHistory orderLatch(1234);\n\n// Stage 0 (BIT) state\nHistory bitEnvL(0);\nHistory bitEnvR(0);\nHistory bitActHold(0);\n\n// Stage 1 (SR) state\nHistory srPh(0);\nHistory srJitHold(0);\nHistory srHoldL(0);\nHistory srHoldR(0);\nHistory srPrevL(0);\nHistory srPrevR(0);\nHistory srFiltL(0);\nHistory srFiltR(0);\nHistory srActHold(0);\n\n// Stage 2 (CODEC) state \u2014 12-band zero-crossing pitch-tracked sinusoidal MDCT resynthesizer\nHistory cBp0L(0);  History cLp0L(0);  History cBp0R(0);  History cLp0R(0);\nHistory cBp1L(0);  History cLp1L(0);  History cBp1R(0);  History cLp1R(0);\nHistory cBp2L(0);  History cLp2L(0);  History cBp2R(0);  History cLp2R(0);\nHistory cBp3L(0);  History cLp3L(0);  History cBp3R(0);  History cLp3R(0);\nHistory cBp4L(0);  History cLp4L(0);  History cBp4R(0);  History cLp4R(0);\nHistory cBp5L(0);  History cLp5L(0);  History cBp5R(0);  History cLp5R(0);\nHistory cBp6L(0);  History cLp6L(0);  History cBp6R(0);  History cLp6R(0);\nHistory cBp7L(0);  History cLp7L(0);  History cBp7R(0);  History cLp7R(0);\nHistory cBp8L(0);  History cLp8L(0);  History cBp8R(0);  History cLp8R(0);\nHistory cBp9L(0);  History cLp9L(0);  History cBp9R(0);  History cLp9R(0);\nHistory cBp10L(0); History cLp10L(0); History cBp10R(0); History cLp10R(0);\nHistory cBp11L(0); History cLp11L(0); History cBp11R(0); History cLp11R(0);\n\n// Zero-crossing period trackers per band (tracks actual input harmonics in real time!)\nHistory cSign0(1);  History cCnt0(0);  History cPer0(256);  History cHz0(172);\nHistory cSign1(1);  History cCnt1(0);  History cPer1(166);  History cHz1(265);\nHistory cSign2(1);  History cCnt2(0);  History cPer2(107);  History cHz2(410);\nHistory cSign3(1);  History cCnt3(0);  History cPer3(71);   History cHz3(620);\nHistory cSign4(1);  History cCnt4(0);  History cPer4(48);   History cHz4(910);\nHistory cSign5(1);  History cCnt5(0);  History cPer5(33);   History cHz5(1320);\nHistory cSign6(1);  History cCnt6(0);  History cPer6(23);   History cHz6(1900);\nHistory cSign7(1);  History cCnt7(0);  History cPer7(16);   History cHz7(2700);\nHistory cSign8(1);  History cCnt8(0);  History cPer8(11.6); History cHz8(3800);\nHistory cSign9(1);  History cCnt9(0);  History cPer9(8.3);  History cHz9(5300);\nHistory cSign10(1); History cCnt10(0); History cPer10(6.0); History cHz10(7300);\nHistory cSign11(1); History cCnt11(0); History cPer11(4.5); History cHz11(9800);\n\n// Per-band tracked envelopes, MDCT frame target masks, and smoothly slewed gains\nHistory cEnv0(0);  History cEnv1(0);  History cEnv2(0);  History cEnv3(0);\nHistory cEnv4(0);  History cEnv5(0);  History cEnv6(0);  History cEnv7(0);\nHistory cEnv8(0);  History cEnv9(0);  History cEnv10(0); History cEnv11(0);\n\nHistory cTgt0(1);  History cTgt1(1);  History cTgt2(1);  History cTgt3(1);\nHistory cTgt4(1);  History cTgt5(1);  History cTgt6(1);  History cTgt7(1);\nHistory cTgt8(1);  History cTgt9(1);  History cTgt10(1); History cTgt11(1);\n\nHistory cGain0(1);  History cGain1(1);  History cGain2(1);  History cGain3(1);\nHistory cGain4(1);  History cGain5(1);  History cGain6(1);  History cGain7(1);\nHistory cGain8(1);  History cGain9(1);  History cGain10(1); History cGain11(1);\n\n// 12 Phase-continuous sinusoidal resynthesis oscillators + smoothly slewed target frequencies\nHistory cOscPh0(0);  History cOscPh1(0);  History cOscPh2(0);  History cOscPh3(0);\nHistory cOscPh4(0);  History cOscPh5(0);  History cOscPh6(0);  History cOscPh7(0);\nHistory cOscPh8(0);  History cOscPh9(0);  History cOscPh10(0); History cOscPh11(0);\n\nHistory cBirdHop0(0);  History cBirdHop1(0);  History cBirdHop2(0);  History cBirdHop3(0);\nHistory cBirdHop4(0);  History cBirdHop5(0);  History cBirdHop6(0);  History cBirdHop7(0);\nHistory cBirdHop8(0);  History cBirdHop9(0);  History cBirdHop10(0); History cBirdHop11(0);\n\nHistory cFastEnv(0); History cSlowEnv(0); History cPreSwell(0);\nHistory cFramePh(0);\nHistory codMakeup(1.5);\nHistory codecActHold(0);\n\n// Stage 3 (TELE) state\nHistory tHpL(0); History tHpR(0);\nHistory tLpL(0); History tLpR(0);\nHistory tDecimPh(0);\nHistory tHoldL(0); History tHoldR(0);\nHistory tPredL(0); History tPredR(0);\nHistory tGsmPh(0);\nHistory tGsmGain(1.0);\nHistory tRes1L(0); History tRes2L(0);\nHistory tRes1R(0); History tRes2R(0);\nHistory teleActHold(0);\n\n// Stage 4 (FFT) state \u2014 6-band SVF spectral bank + slewed routing & envelope gates\nHistory fPh(0);\nHistory fBp0L(0); History fLp0L(0); History fBp0R(0); History fLp0R(0);\nHistory fBp1L(0); History fLp1L(0); History fBp1R(0); History fLp1R(0);\nHistory fBp2L(0); History fLp2L(0); History fBp2R(0); History fLp2R(0);\nHistory fBp3L(0); History fLp3L(0); History fBp3R(0); History fLp3R(0);\nHistory fBp4L(0); History fLp4L(0); History fBp4R(0); History fLp4R(0);\nHistory fBp5L(0); History fLp5L(0); History fBp5R(0); History fLp5R(0);\nHistory fEnv0(0); History fEnv1(0); History fEnv2(0);\nHistory fEnv3(0); History fEnv4(0); History fEnv5(0);\nHistory fDenT0(1); History fDenT1(1); History fDenT2(1);\nHistory fDenT3(1); History fDenT4(1); History fDenT5(1);\nHistory fDenG0(1); History fDenG1(1); History fDenG2(1);\nHistory fDenG3(1); History fDenG4(1); History fDenG5(1);\nHistory fScrT0(1); History fScrT1(1); History fScrT2(1);\nHistory fScrT3(1); History fScrT4(1); History fScrT5(1);\nHistory fScrG0(1); History fScrG1(1); History fScrG2(1);\nHistory fScrG3(1); History fScrG4(1); History fScrG5(1);\nHistory fScrModPh(0); History fScrModHz(90);\nHistory fW0(1); History fW1(1); History fW2(1);\nHistory fW3(1); History fW4(1); History fW5(1);\nHistory fCombSamps(512);\nHistory fAp1L(0); History fAp2L(0); History fAp3L(0); History fAp4L(0);\nHistory fAp1R(0); History fAp2R(0); History fAp3R(0); History fAp4R(0);\nHistory fftActHold(0);\n\n// Telemetry histories\nHistory tick(0);\nHistory waveIdx(0);\nHistory rollCounter(0);\nHistory peakInHold(0);\nHistory peakOutHold(0);\n\n// Delay lines for Stage 2 (Codec Lookahead Pre-Echo) and Stage 4 (FFT Spectral Frame Buffer)\nDelay codecDL(8192);\nDelay codecDR(8192);\nDelay fftDL(8192);\nDelay fftDR(8192);\n\nsr = max(samplerate, 1);\n\n// Fast PRNG (updates once per sample)\nprngState = fract(sin(prngState * 127.1 + 311.7) * 43758.5453123);\nnoiseA = prngState * 2.0 - 1.0;\nprngState = fract(sin(prngState * 269.5 + 183.3) * 43758.5453123);\nnoiseB = prngState * 2.0 - 1.0;\n\n// Smooth parameters via slew()\nwetSlew = slew(clip(wet, 0.0, 1.0), 0.998);\noutGainDbS = slew(clip(out_gain, -24.0, 12.0), 0.998);\noutGainSlew = pow(10.0, outGainDbS / 20.0);\n\nbitsVal = slew(clip(bits, 1.0, 16.0), 0.995);\nwrapVal = slew(clip(wrap_amt, 0.0, 1.0), 0.995);\nditherVal = slew(clip(dither, 0.0, 1.0), 0.995);\n\nsrateVal = slew(clip(srate, 100.0, 44100.0), 0.995);\njitterVal = slew(clip(jitter, 0.0, 1.0), 0.995);\nsrModeVal = slew(clip(sr_mode, 0.0, 1.0), 0.5);\n\ncodecLossVal = slew(clip(codec_loss, 0.0, 1.0), 0.995);\npreechoVal = slew(clip(preecho, 0.0, 1.0), 0.995);\nbirdiesVal = slew(clip(birdies, 0.0, 1.0), 0.995);\n\nteleModeVal = round(slew(clip(tele_mode, 0.0, 3.0), 0.2));\nteleLineVal = slew(clip(tele_line, 0.0, 1.0), 0.995);\n\nfftModeVal = round(slew(clip(fft_mode, 0.0, 3.0), 0.2));\nfftGlitchVal = slew(clip(fft_glitch, 0.0, 1.0), 0.995);\nfftFrameMs = slew(clip(fft_frame, 5.0, 150.0), 0.995);\n\n// Latch order_code through History orderLatch so decoding runs inside sample loop\norderLatch = round(order_code);\nrawCode = max(orderLatch, 0);\ndig4 = floor(rawCode % 10);\nr3 = floor(rawCode / 10);\ndig3 = floor(r3 % 10);\nr2 = floor(r3 / 10);\ndig2 = floor(r2 % 10);\nr1 = floor(r2 / 10);\ndig1 = floor(r1 % 10);\ndig0 = floor(floor(r1 / 10) % 10);\n\ndSum = dig0 + dig1 + dig2 + dig3 + dig4;\ndProd = (dig0 + 1) * (dig1 + 1) * (dig2 + 1) * (dig3 + 1) * (dig4 + 1);\nisPerm = (dSum == 10) * (dProd == 120);\nord0 = isPerm ? dig0 : 0;\nord1 = isPerm ? dig1 : 1;\nord2 = isPerm ? dig2 : 2;\nord3 = isPerm ? dig3 : 3;\nord4 = isPerm ? dig4 : 4;\n\nsigL = in1;\nsigR = in2;\n\n// Execute the 5 stages in dynamic user order; disabled stages are completely skipped (0 CPU branch)\nfor (slot = 0; slot < 5; slot += 1) {\n\tstId = (slot == 0) ? ord0 : ((slot == 1) ? ord1 : ((slot == 2) ? ord2 : ((slot == 3) ? ord3 : ord4)));\n\n\t// ========================================================================\n\t// STAGE 0: BIT REDUCTION, SIGNAL-FOLLOWING NOISE FLOOR, INTEGER WRAP & DITHER\n\t// ========================================================================\n\tif ((stId == 0) * (bit_on > 0.5)) {\n\t\tinBitL = sigL;\n\t\tinBitR = sigR;\n\n\t\taxL = abs(inBitL);\n\t\taxR = abs(inBitR);\n\t\tcBitL = (axL > bitEnvL) ? 0.25 : 0.995;\n\t\tcBitR = (axR > bitEnvR) ? 0.25 : 0.995;\n\t\tbitEnvL = mix(axL, bitEnvL, cBitL);\n\t\tbitEnvR = mix(axR, bitEnvR, cBitR);\n\n\t\tdrive = 1.0 + wrapVal * 3.5;\n\t\tpreL = int_wrap(inBitL, drive, wrapVal);\n\t\tpreR = int_wrap(inBitR, drive, wrapVal);\n\n\t\tsteps = pow(2.0, bitsVal);\n\t\tsafeSteps = max(steps, 2.0);\n\t\tstepSize = 2.0 / safeSteps;\n\t\thpDithL = noiseA - prevNoiseL;\n\t\thpDithR = noiseB - prevNoiseR;\n\t\tprevNoiseL = noiseA;\n\t\tprevNoiseR = noiseB;\n\n\t\tsigGritScale = (16.0 - bitsVal) * 0.0075;\n\t\tdithStep = max(stepSize * 0.85, 0.018);\n\t\tdithAmp = ditherVal * dithStep;\n\t\tnoisyL = preL + noiseA * bitEnvL * sigGritScale + hpDithL * dithAmp;\n\t\tnoisyR = preR + noiseB * bitEnvR * sigGritScale + hpDithR * dithAmp;\n\n\t\tqBitL = quant_steps(noisyL, steps);\n\t\tqBitR = quant_steps(noisyR, steps);\n\t\tsigL = clip(qBitL, -1.0, 1.0);\n\t\tsigR = clip(qBitR, -1.0, 1.0);\n\t\tdiffBitL = abs(sigL - inBitL);\n\t\tdiffBitR = abs(sigR - inBitR);\n\t\tdiffBit = max(diffBitL, diffBitR) + 0.12;\n\t\tbitActHold = max(bitActHold, diffBit);\n\t}\n\n\t// ========================================================================\n\t// STAGE 1: SAMPLE-RATE REDUCTION (S&H vs FILTERED) & CLOCK JITTER\n\t// ========================================================================\n\tif ((stId == 1) * (sr_on > 0.5)) {\n\t\tinSrL = sigL;\n\t\tinSrR = sigR;\n\n\t\tbaseInc = clip(srateVal / sr, 100.0 / sr, 1.0);\n\t\tjitFactor = pow(2.0, srJitHold * jitterVal * 0.85);\n\t\teffInc = clip(baseInc * jitFactor, 0.0005, 1.0);\n\t\tsrPh = srPh + effInc;\n\n\t\tif (srPh >= 1.0) {\n\t\t\tsrPh = fract(srPh);\n\t\t\tsrPrevL = srHoldL;\n\t\t\tsrPrevR = srHoldR;\n\t\t\tsrHoldL = inSrL;\n\t\t\tsrHoldR = inSrR;\n\t\t\tsrJitHold = noiseA;\n\t\t}\n\n\t\tinterpL = mix(srPrevL, srHoldL, srPh);\n\t\tinterpR = mix(srPrevR, srHoldR, srPh);\n\t\tcutHz = min(srateVal * 0.45, sr * 0.45);\n\t\tlpCoef = exp(-6.28318530718 * cutHz / sr);\n\t\tsrFiltL = mix(interpL, srFiltL, lpCoef);\n\t\tsrFiltR = mix(interpR, srFiltR, lpCoef);\n\n\t\tsigL = (srModeVal < 0.5) ? srHoldL : srFiltL;\n\t\tsigR = (srModeVal < 0.5) ? srHoldR : srFiltR;\n\t\tdiffSrL = abs(sigL - inSrL);\n\t\tdiffSrR = abs(sigR - inSrR);\n\t\tdiffSr = max(diffSrL, diffSrR) + 0.12;\n\t\tsrActHold = max(srActHold, diffSr);\n\t}\n\n\t// ========================================================================\n\t// STAGE 2: SPECOPS MP3IFY / MAIM STYLE PITCH-TRACKED SINUSOIDAL RESYNTHESIZER\n\t//   1. True Lookahead Pre-Echo: Delays main body by up to 32 ms (`codecDL`),\n\t//      while undelayed transients immediately excite the 12 spectral band\n\t//      envelopes 32 ms early so pure sinusoidal partials bloom BEFORE attacks!\n\t//   2. 12-Band High-Q SVF + Zero-Crossing Instantaneous Frequency Estimators:\n\t//      Tracks the exact pitches/harmonics present in the input audio and snaps\n\t//      them to discrete FFT bin multiples (43.066 Hz steps) with Birdie warble.\n\t//   3. Lateral Psychoacoustic Hole Masking + Automatic Sparse-Band Energy Makeup\n\t//      + 100% Phase-Continuous Pure Sine Resynthesis (zero quantization crunch!).\n\t// ========================================================================\n\tif ((stId == 2) * (codec_on > 0.5)) {\n\t\tinCodL = sigL;\n\t\tinCodR = sigR;\n\n\t\tcodecDL.write(inCodL);\n\t\tcodecDR.write(inCodR);\n\n\t\t// 1. True Lookahead Pre-Echo & Multi-Tap MDCT Block Smear (up to 72 ms lookahead at 100% Echo)\n\t\tinCodAbsL = abs(inCodL);\n\t\tinCodAbsR = abs(inCodR);\n\t\tinPeak = max(inCodAbsL, inCodAbsR);\n\t\tcFastCoef = (inPeak > cFastEnv) ? 0.03 : (0.97 + preechoVal * 0.026);\n\t\tcFastEnv = mix(inPeak, cFastEnv, cFastCoef);\n\t\tcSlowEnv = mix(inPeak, cSlowEnv, 0.9965);\n\t\ttransBurst = clip((cFastEnv - cSlowEnv * 1.12) * 5.5, 0.0, 1.0);\n\t\tcPreSwell = mix(transBurst, cPreSwell, (transBurst > cPreSwell) ? 0.05 : (0.992 + preechoVal * 0.007));\n\n\t\tpreDelaySamps = preechoVal * sr * 0.072;\n\t\tdelL = codecDL.read(preDelaySamps, interp=\"linear\");\n\t\tdelR = codecDR.read(preDelaySamps, interp=\"linear\");\n\n\t\t// 4-tap overlapping MDCT block smear across the 72 ms lookahead window (0%, 25%, 55%, 80%)\n\t\ttapE1 = preDelaySamps * 0.22;\n\t\ttapE2 = preDelaySamps * 0.48;\n\t\ttapE3 = preDelaySamps * 0.76;\n\t\ttapPost = preDelaySamps * 1.35;\n\t\tearlySmearL = 0.38 * inCodL + 0.30 * codecDL.read(tapE1, interp=\"linear\") + 0.24 * codecDL.read(tapE2, interp=\"linear\") + 0.20 * codecDL.read(tapE3, interp=\"linear\") + 0.18 * codecDL.read(tapPost, interp=\"linear\");\n\t\tearlySmearR = 0.38 * inCodR + 0.30 * codecDR.read(tapE2, interp=\"linear\") + 0.24 * codecDR.read(tapE1, interp=\"linear\") + 0.20 * codecDR.read(tapPost, interp=\"linear\") + 0.18 * codecDR.read(tapE3, interp=\"linear\");\n\n\t\t// Blend smeared lookahead cloud into the analyzer input so spectral partials bloom early and smear in time!\n\t\tpreExcite = clip(preechoVal * (0.55 + 0.75 * cPreSwell), 0.0, 1.0);\n\t\tanaL = mix(delL, earlySmearL, preExcite * 0.92);\n\t\tanaR = mix(delR, earlySmearR, preExcite * 0.92);\n\n\t\t// 2. 12-Band Overlapping SVF Analysis (Q ~ 5.5 so zero frequencies fall between bands)\n\t\tsvfDamp = 0.18;\n\t\tinNormL = anaL * svfDamp;\n\t\tinNormR = anaR * svfDamp;\n\n\t\t// Band 0: 172 Hz\n\t\tcf0 = 2.0 * sin(3.14159265359 * 172.0 / sr);\n\t\thp0L = inNormL - cLp0L - svfDamp * cBp0L; cBp0L = clip(cBp0L + cf0 * hp0L, -2.0, 2.0); cLp0L = clip(cLp0L + cf0 * cBp0L, -2.0, 2.0);\n\t\thp0R = inNormR - cLp0R - svfDamp * cBp0R; cBp0R = clip(cBp0R + cf0 * hp0R, -2.0, 2.0); cLp0R = clip(cLp0R + cf0 * cBp0R, -2.0, 2.0);\n\n\t\t// Band 1: 265 Hz\n\t\tcf1 = 2.0 * sin(3.14159265359 * 265.0 / sr);\n\t\thp1L = inNormL - cLp1L - svfDamp * cBp1L; cBp1L = clip(cBp1L + cf1 * hp1L, -2.0, 2.0); cLp1L = clip(cLp1L + cf1 * cBp1L, -2.0, 2.0);\n\t\thp1R = inNormR - cLp1R - svfDamp * cBp1R; cBp1R = clip(cBp1R + cf1 * hp1R, -2.0, 2.0); cLp1R = clip(cLp1R + cf1 * cBp1R, -2.0, 2.0);\n\n\t\t// Band 2: 410 Hz\n\t\tcf2 = 2.0 * sin(3.14159265359 * 410.0 / sr);\n\t\thp2L = inNormL - cLp2L - svfDamp * cBp2L; cBp2L = clip(cBp2L + cf2 * hp2L, -2.0, 2.0); cLp2L = clip(cLp2L + cf2 * cBp2L, -2.0, 2.0);\n\t\thp2R = inNormR - cLp2R - svfDamp * cBp2R; cBp2R = clip(cBp2R + cf2 * hp2R, -2.0, 2.0); cLp2R = clip(cLp2R + cf2 * cBp2R, -2.0, 2.0);\n\n\t\t// Band 3: 620 Hz\n\t\tcf3 = 2.0 * sin(3.14159265359 * 620.0 / sr);\n\t\thp3L = inNormL - cLp3L - svfDamp * cBp3L; cBp3L = clip(cBp3L + cf3 * hp3L, -2.0, 2.0); cLp3L = clip(cLp3L + cf3 * cBp3L, -2.0, 2.0);\n\t\thp3R = inNormR - cLp3R - svfDamp * cBp3R; cBp3R = clip(cBp3R + cf3 * hp3R, -2.0, 2.0); cLp3R = clip(cLp3R + cf3 * cBp3R, -2.0, 2.0);\n\n\t\t// Band 4: 910 Hz\n\t\tcf4 = 2.0 * sin(3.14159265359 * 910.0 / sr);\n\t\thp4L = inNormL - cLp4L - svfDamp * cBp4L; cBp4L = clip(cBp4L + cf4 * hp4L, -2.0, 2.0); cLp4L = clip(cLp4L + cf4 * cBp4L, -2.0, 2.0);\n\t\thp4R = inNormR - cLp4R - svfDamp * cBp4R; cBp4R = clip(cBp4R + cf4 * hp4R, -2.0, 2.0); cLp4R = clip(cLp4R + cf4 * cBp4R, -2.0, 2.0);\n\n\t\t// Band 5: 1320 Hz\n\t\tcf5 = 2.0 * sin(3.14159265359 * 1320.0 / sr);\n\t\thp5L = inNormL - cLp5L - svfDamp * cBp5L; cBp5L = clip(cBp5L + cf5 * hp5L, -2.0, 2.0); cLp5L = clip(cLp5L + cf5 * cBp5L, -2.0, 2.0);\n\t\thp5R = inNormR - cLp5R - svfDamp * cBp5R; cBp5R = clip(cBp5R + cf5 * hp5R, -2.0, 2.0); cLp5R = clip(cLp5R + cf5 * cBp5R, -2.0, 2.0);\n\n\t\t// Band 6: 1900 Hz\n\t\tcf6 = 2.0 * sin(3.14159265359 * 1900.0 / sr);\n\t\thp6L = inNormL - cLp6L - svfDamp * cBp6L; cBp6L = clip(cBp6L + cf6 * hp6L, -2.0, 2.0); cLp6L = clip(cLp6L + cf6 * cBp6L, -2.0, 2.0);\n\t\thp6R = inNormR - cLp6R - svfDamp * cBp6R; cBp6R = clip(cBp6R + cf6 * hp6R, -2.0, 2.0); cLp6R = clip(cLp6R + cf6 * cBp6R, -2.0, 2.0);\n\n\t\t// Band 7: 2700 Hz\n\t\tcf7 = 2.0 * sin(3.14159265359 * 2700.0 / sr);\n\t\thp7L = inNormL - cLp7L - svfDamp * cBp7L; cBp7L = clip(cBp7L + cf7 * hp7L, -2.0, 2.0); cLp7L = clip(cLp7L + cf7 * cBp7L, -2.0, 2.0);\n\t\thp7R = inNormR - cLp7R - svfDamp * cBp7R; cBp7R = clip(cBp7R + cf7 * hp7R, -2.0, 2.0); cLp7R = clip(cLp7R + cf7 * cBp7R, -2.0, 2.0);\n\n\t\t// Band 8: 3800 Hz\n\t\tcf8 = 2.0 * sin(3.14159265359 * 3800.0 / sr);\n\t\thp8L = inNormL - cLp8L - svfDamp * cBp8L; cBp8L = clip(cBp8L + cf8 * hp8L, -2.0, 2.0); cLp8L = clip(cLp8L + cf8 * cBp8L, -2.0, 2.0);\n\t\thp8R = inNormR - cLp8R - svfDamp * cBp8R; cBp8R = clip(cBp8R + cf8 * hp8R, -2.0, 2.0); cLp8R = clip(cLp8R + cf8 * cBp8R, -2.0, 2.0);\n\n\t\t// Band 9: 5300 Hz\n\t\tcf9 = 2.0 * sin(3.14159265359 * 5300.0 / sr);\n\t\thp9L = inNormL - cLp9L - svfDamp * cBp9L; cBp9L = clip(cBp9L + cf9 * hp9L, -2.0, 2.0); cLp9L = clip(cLp9L + cf9 * cBp9L, -2.0, 2.0);\n\t\thp9R = inNormR - cLp9R - svfDamp * cBp9R; cBp9R = clip(cBp9R + cf9 * hp9R, -2.0, 2.0); cLp9R = clip(cLp9R + cf9 * cBp9R, -2.0, 2.0);\n\n\t\t// Band 10: 7300 Hz\n\t\thz10 = min(7300.0, sr * 0.42);\n\t\tcf10 = 2.0 * sin(3.14159265359 * hz10 / sr);\n\t\thp10L = inNormL - cLp10L - svfDamp * cBp10L; cBp10L = clip(cBp10L + cf10 * hp10L, -2.0, 2.0); cLp10L = clip(cLp10L + cf10 * cBp10L, -2.0, 2.0);\n\t\thp10R = inNormR - cLp10R - svfDamp * cBp10R; cBp10R = clip(cBp10R + cf10 * hp10R, -2.0, 2.0); cLp10R = clip(cLp10R + cf10 * cBp10R, -2.0, 2.0);\n\n\t\t// Band 11: 9800 Hz\n\t\thz11 = min(9800.0, sr * 0.44);\n\t\tcf11 = 2.0 * sin(3.14159265359 * hz11 / sr);\n\t\thp11L = inNormL - cLp11L - svfDamp * cBp11L; cBp11L = clip(cBp11L + cf11 * hp11L, -2.0, 2.0); cLp11L = clip(cLp11L + cf11 * cBp11L, -2.0, 2.0);\n\t\thp11R = inNormR - cLp11R - svfDamp * cBp11R; cBp11R = clip(cBp11R + cf11 * hp11R, -2.0, 2.0); cLp11R = clip(cLp11R + cf11 * cBp11R, -2.0, 2.0);\n\n\t\t// 3. Zero-Crossing Instantaneous Pitch Tracker on each band (tracks input harmonics!)\n\t\tcCnt0 = cCnt0 + 1; sg0 = (cBp0L >= 0) ? 1 : -1; cr0 = (sg0 > 0) * (cSign0 < 0); val0 = cr0 * (cCnt0 > 32) * (cCnt0 < 1200); cPer0 = val0 ? mix(cCnt0, cPer0, 0.70) : cPer0; cCnt0 = cr0 ? 0 : cCnt0; cSign0 = sg0;\n\t\tcCnt1 = cCnt1 + 1; sg1 = (cBp1L >= 0) ? 1 : -1; cr1 = (sg1 > 0) * (cSign1 < 0); val1 = cr1 * (cCnt1 > 20) * (cCnt1 < 800);  cPer1 = val1 ? mix(cCnt1, cPer1, 0.70) : cPer1; cCnt1 = cr1 ? 0 : cCnt1; cSign1 = sg1;\n\t\tcCnt2 = cCnt2 + 1; sg2 = (cBp2L >= 0) ? 1 : -1; cr2 = (sg2 > 0) * (cSign2 < 0); val2 = cr2 * (cCnt2 > 14) * (cCnt2 < 500);  cPer2 = val2 ? mix(cCnt2, cPer2, 0.70) : cPer2; cCnt2 = cr2 ? 0 : cCnt2; cSign2 = sg2;\n\t\tcCnt3 = cCnt3 + 1; sg3 = (cBp3L >= 0) ? 1 : -1; cr3 = (sg3 > 0) * (cSign3 < 0); val3 = cr3 * (cCnt3 > 10) * (cCnt3 < 350);  cPer3 = val3 ? mix(cCnt3, cPer3, 0.70) : cPer3; cCnt3 = cr3 ? 0 : cCnt3; cSign3 = sg3;\n\t\tcCnt4 = cCnt4 + 1; sg4 = (cBp4L >= 0) ? 1 : -1; cr4 = (sg4 > 0) * (cSign4 < 0); val4 = cr4 * (cCnt4 > 7)  * (cCnt4 < 240);  cPer4 = val4 ? mix(cCnt4, cPer4, 0.70) : cPer4; cCnt4 = cr4 ? 0 : cCnt4; cSign4 = sg4;\n\t\tcCnt5 = cCnt5 + 1; sg5 = (cBp5L >= 0) ? 1 : -1; cr5 = (sg5 > 0) * (cSign5 < 0); val5 = cr5 * (cCnt5 > 5)  * (cCnt5 < 160);  cPer5 = val5 ? mix(cCnt5, cPer5, 0.70) : cPer5; cCnt5 = cr5 ? 0 : cCnt5; cSign5 = sg5;\n\t\tcCnt6 = cCnt6 + 1; sg6 = (cBp6L >= 0) ? 1 : -1; cr6 = (sg6 > 0) * (cSign6 < 0); val6 = cr6 * (cCnt6 > 4)  * (cCnt6 < 110);  cPer6 = val6 ? mix(cCnt6, cPer6, 0.70) : cPer6; cCnt6 = cr6 ? 0 : cCnt6; cSign6 = sg6;\n\t\tcCnt7 = cCnt7 + 1; sg7 = (cBp7L >= 0) ? 1 : -1; cr7 = (sg7 > 0) * (cSign7 < 0); val7 = cr7 * (cCnt7 > 3)  * (cCnt7 < 80);   cPer7 = val7 ? mix(cCnt7, cPer7, 0.70) : cPer7; cCnt7 = cr7 ? 0 : cCnt7; cSign7 = sg7;\n\t\tcCnt8 = cCnt8 + 1; sg8 = (cBp8L >= 0) ? 1 : -1; cr8 = (sg8 > 0) * (cSign8 < 0); val8 = cr8 * (cCnt8 > 2)  * (cCnt8 < 55);   cPer8 = val8 ? mix(cCnt8, cPer8, 0.70) : cPer8; cCnt8 = cr8 ? 0 : cCnt8; cSign8 = sg8;\n\t\tcCnt9 = cCnt9 + 1; sg9 = (cBp9L >= 0) ? 1 : -1; cr9 = (sg9 > 0) * (cSign9 < 0); val9 = cr9 * (cCnt9 > 2)  * (cCnt9 < 40);   cPer9 = val9 ? mix(cCnt9, cPer9, 0.70) : cPer9; cCnt9 = cr9 ? 0 : cCnt9; cSign9 = sg9;\n\t\tcCnt10 = cCnt10 + 1; sg10 = (cBp10L >= 0) ? 1 : -1; cr10 = (sg10 > 0) * (cSign10 < 0); val10 = cr10 * (cCnt10 > 2) * (cCnt10 < 30); cPer10 = val10 ? mix(cCnt10, cPer10, 0.70) : cPer10; cCnt10 = cr10 ? 0 : cCnt10; cSign10 = sg10;\n\t\tcCnt11 = cCnt11 + 1; sg11 = (cBp11L >= 0) ? 1 : -1; cr11 = (sg11 > 0) * (cSign11 < 0); val11 = cr11 * (cCnt11 > 2) * (cCnt11 < 22); cPer11 = val11 ? mix(cCnt11, cPer11, 0.70) : cPer11; cCnt11 = cr11 ? 0 : cCnt11; cSign11 = sg11;\n\n\t\t// Track per-band envelopes:\n\t\t// As `preechoVal` approaches 100%, attack softens into a pre-echo swell and release stretches\n\t\t// up to 0.99965 (~160 ms MDCT block blur) so transients smear into liquid spectral clouds!\n\t\tenvAtk = 0.90 + preechoVal * 0.092;\n\t\tenvRel = 0.993 + preechoVal * 0.0066;\n\t\tpk0  = max(abs(cBp0L),  abs(cBp0R));  cEnv0  = mix(pk0,  cEnv0,  (pk0  > cEnv0)  ? envAtk : envRel);\n\t\tpk1  = max(abs(cBp1L),  abs(cBp1R));  cEnv1  = mix(pk1,  cEnv1,  (pk1  > cEnv1)  ? envAtk : envRel);\n\t\tpk2  = max(abs(cBp2L),  abs(cBp2R));  cEnv2  = mix(pk2,  cEnv2,  (pk2  > cEnv2)  ? envAtk : envRel);\n\t\tpk3  = max(abs(cBp3L),  abs(cBp3R));  cEnv3  = mix(pk3,  cEnv3,  (pk3  > cEnv3)  ? envAtk : envRel);\n\t\tpk4  = max(abs(cBp4L),  abs(cBp4R));  cEnv4  = mix(pk4,  cEnv4,  (pk4  > cEnv4)  ? envAtk : envRel);\n\t\tpk5  = max(abs(cBp5L),  abs(cBp5R));  cEnv5  = mix(pk5,  cEnv5,  (pk5  > cEnv5)  ? envAtk : envRel);\n\t\tpk6  = max(abs(cBp6L),  abs(cBp6R));  cEnv6  = mix(pk6,  cEnv6,  (pk6  > cEnv6)  ? envAtk : envRel);\n\t\tpk7  = max(abs(cBp7L),  abs(cBp7R));  cEnv7  = mix(pk7,  cEnv7,  (pk7  > cEnv7)  ? envAtk : envRel);\n\t\tpk8  = max(abs(cBp8L),  abs(cBp8R));  cEnv8  = mix(pk8,  cEnv8,  (pk8  > cEnv8)  ? envAtk : envRel);\n\t\tpk9  = max(abs(cBp9L),  abs(cBp9R));  cEnv9  = mix(pk9,  cEnv9,  (pk9  > cEnv9)  ? envAtk : envRel);\n\t\tpk10 = max(abs(cBp10L), abs(cBp10R)); cEnv10 = mix(pk10, cEnv10, (pk10 > cEnv10) ? envAtk : envRel);\n\t\tpk11 = max(abs(cBp11L), abs(cBp11R)); cEnv11 = mix(pk11, cEnv11, (pk11 > cEnv11) ? envAtk : envRel);\n\n\t\tcAvg = (cEnv0 + cEnv1 + cEnv2 + cEnv3 + cEnv4 + cEnv5 + cEnv6 + cEnv7 + cEnv8 + cEnv9 + cEnv10 + cEnv11) * 0.08333333;\n\n\t\t// 4. MDCT Frame Hop (~12..38 Hz) updates lateral psychoacoustic hole masks & wide FFT bin hop offsets\n\t\tframeRate = 12.0 + birdiesVal * 26.0;\n\t\tcFramePh = cFramePh + frameRate / sr;\n\t\tif (cFramePh >= 1.0) {\n\t\t\tcFramePh = fract(cFramePh);\n\t\t\tr0  = sin(rollCounter * 1.13 + noiseA * 2.1);\n\t\t\tr1  = cos(rollCounter * 1.79 + noiseB * 2.3);\n\t\t\tr2  = sin(rollCounter * 2.41 - noiseA * 1.9);\n\t\t\tr3  = cos(rollCounter * 3.07 + (noiseA + noiseB) * 1.5);\n\t\t\tr4  = sin(rollCounter * 3.73 - noiseB * 2.5);\n\t\t\tr5  = cos(rollCounter * 4.39 + noiseA * 2.7);\n\t\t\tr6  = sin(rollCounter * 5.03 + noiseB * 2.9);\n\t\t\tr7  = cos(rollCounter * 5.89 - noiseA * 3.1);\n\t\t\tr8  = sin(rollCounter * 6.41 + noiseA * 2.2);\n\t\t\tr9  = cos(rollCounter * 7.13 - noiseB * 2.4);\n\t\t\tr10 = sin(rollCounter * 7.87 + noiseB * 2.8);\n\t\t\tr11 = cos(rollCounter * 8.53 - noiseA * 2.6);\n\n\t\t\tnbr0  = cEnv1;\n\t\t\tnbr1  = max(cEnv0, cEnv2);\n\t\t\tnbr2  = max(cEnv1, cEnv3);\n\t\t\tnbr3  = max(cEnv2, cEnv4);\n\t\t\tnbr4  = max(cEnv3, cEnv5);\n\t\t\tnbr5  = max(cEnv4, cEnv6);\n\t\t\tnbr6  = max(cEnv5, cEnv7);\n\t\t\tnbr7  = max(cEnv6, cEnv8);\n\t\t\tnbr8  = max(cEnv7, cEnv9);\n\t\t\tnbr9  = max(cEnv8, cEnv10);\n\t\t\tnbr10 = max(cEnv9, cEnv11);\n\t\t\tnbr11 = cEnv10;\n\n\t\t\tcTgt0  = mp3ify_band_mask(cEnv0,  nbr0,  cAvg, codecLossVal, birdiesVal, r0,  0.00);\n\t\t\tcTgt1  = mp3ify_band_mask(cEnv1,  nbr1,  cAvg, codecLossVal, birdiesVal, r1,  0.09);\n\t\t\tcTgt2  = mp3ify_band_mask(cEnv2,  nbr2,  cAvg, codecLossVal, birdiesVal, r2,  0.18);\n\t\t\tcTgt3  = mp3ify_band_mask(cEnv3,  nbr3,  cAvg, codecLossVal, birdiesVal, r3,  0.27);\n\t\t\tcTgt4  = mp3ify_band_mask(cEnv4,  nbr4,  cAvg, codecLossVal, birdiesVal, r4,  0.36);\n\t\t\tcTgt5  = mp3ify_band_mask(cEnv5,  nbr5,  cAvg, codecLossVal, birdiesVal, r5,  0.45);\n\t\t\tcTgt6  = mp3ify_band_mask(cEnv6,  nbr6,  cAvg, codecLossVal, birdiesVal, r6,  0.54);\n\t\t\tcTgt7  = mp3ify_band_mask(cEnv7,  nbr7,  cAvg, codecLossVal, birdiesVal, r7,  0.63);\n\t\t\tcTgt8  = mp3ify_band_mask(cEnv8,  nbr8,  cAvg, codecLossVal, birdiesVal, r8,  0.72);\n\t\t\tcTgt9  = mp3ify_band_mask(cEnv9,  nbr9,  cAvg, codecLossVal, birdiesVal, r9,  0.81);\n\t\t\tcTgt10 = mp3ify_band_mask(cEnv10, nbr10, cAvg, codecLossVal, birdiesVal, r10, 0.90);\n\t\t\tcTgt11 = mp3ify_band_mask(cEnv11, nbr11, cAvg, codecLossVal, birdiesVal, r11, 1.00);\n\n\t\t\t// Wide Birdie FFT bin-hop offsets (at 100% Birdies, hops +/- 4..8 FFT bins per frame for dramatic arpeggiated warble!)\n\t\t\tbinStep = 43.0664;\n\t\t\thopScale = (birdiesVal + birdiesVal * birdiesVal * 2.2) * binStep;\n\t\t\tcBirdHop0  = round(r0  * hopScale / binStep) * binStep * 0.65;\n\t\t\tcBirdHop1  = round(r1  * hopScale / binStep) * binStep * 0.85;\n\t\t\tcBirdHop2  = round(r2  * hopScale / binStep) * binStep * 1.15;\n\t\t\tcBirdHop3  = round(r3  * hopScale / binStep) * binStep * 1.45;\n\t\t\tcBirdHop4  = round(r4  * hopScale / binStep) * binStep * 1.80;\n\t\t\tcBirdHop5  = round(r5  * hopScale / binStep) * binStep * 2.10;\n\t\t\tcBirdHop6  = round(r6  * hopScale / binStep) * binStep * 2.40;\n\t\t\tcBirdHop7  = round(r7  * hopScale / binStep) * binStep * 2.60;\n\t\t\tcBirdHop8  = round(r8  * hopScale / binStep) * binStep * 2.50;\n\t\t\tcBirdHop9  = round(r9  * hopScale / binStep) * binStep * 2.20;\n\t\t\tcBirdHop10 = round(r10 * hopScale / binStep) * binStep * 1.80;\n\t\t\tcBirdHop11 = round(r11 * hopScale / binStep) * binStep * 1.50;\n\t\t}\n\n\t\t// Smoothly interpolate sub-band gains (~35 ms MDCT window slew -> liquid, zero zipper noise)\n\t\tgSlew = 0.9986;\n\t\tcGain0  = mix(cTgt0,  cGain0,  gSlew);\n\t\tcGain1  = mix(cTgt1,  cGain1,  gSlew);\n\t\tcGain2  = mix(cTgt2,  cGain2,  gSlew);\n\t\tcGain3  = mix(cTgt3,  cGain3,  gSlew);\n\t\tcGain4  = mix(cTgt4,  cGain4,  gSlew);\n\t\tcGain5  = mix(cTgt5,  cGain5,  gSlew);\n\t\tcGain6  = mix(cTgt6,  cGain6,  gSlew);\n\t\tcGain7  = mix(cTgt7,  cGain7,  gSlew);\n\t\tcGain8  = mix(cTgt8,  cGain8,  gSlew);\n\t\tcGain9  = mix(cTgt9,  cGain9,  gSlew);\n\t\tcGain10 = mix(cTgt10, cGain10, gSlew);\n\t\tcGain11 = mix(cTgt11, cGain11, gSlew);\n\n\t\t// Smoothly slew each band's FFT-bin-snapped instantaneous frequency (zero FM click!)\n\t\tsnapStrength = clip(codecLossVal * 0.75 + birdiesVal * 0.85, 0.0, 1.0);\n\t\tp0  = max(cPer0,  32.0); tHz0  = snap_fft_bin_hz(sr / p0,  172.0,  21.533, snapStrength, cBirdHop0);\n\t\tp1  = max(cPer1,  20.0); tHz1  = snap_fft_bin_hz(sr / p1,  265.0,  21.533, snapStrength, cBirdHop1);\n\t\tp2  = max(cPer2,  14.0); tHz2  = snap_fft_bin_hz(sr / p2,  410.0,  43.066, snapStrength, cBirdHop2);\n\t\tp3  = max(cPer3,  10.0); tHz3  = snap_fft_bin_hz(sr / p3,  620.0,  43.066, snapStrength, cBirdHop3);\n\t\tp4  = max(cPer4,  7.0);  tHz4  = snap_fft_bin_hz(sr / p4,  910.0,  43.066, snapStrength, cBirdHop4);\n\t\tp5  = max(cPer5,  5.0);  tHz5  = snap_fft_bin_hz(sr / p5,  1320.0, 43.066, snapStrength, cBirdHop5);\n\t\tp6  = max(cPer6,  4.0);  tHz6  = snap_fft_bin_hz(sr / p6,  1900.0, 86.133, snapStrength, cBirdHop6);\n\t\tp7  = max(cPer7,  3.0);  tHz7  = snap_fft_bin_hz(sr / p7,  2700.0, 86.133, snapStrength, cBirdHop7);\n\t\tp8  = max(cPer8,  2.5);  tHz8  = snap_fft_bin_hz(sr / p8,  3800.0, 86.133, snapStrength, cBirdHop8);\n\t\tp9  = max(cPer9,  2.2);  tHz9  = snap_fft_bin_hz(sr / p9,  5300.0, 86.133, snapStrength, cBirdHop9);\n\t\tp10 = max(cPer10, 2.0);  tHz10 = snap_fft_bin_hz(sr / p10, 7300.0, 172.26, snapStrength, cBirdHop10);\n\t\tp11 = max(cPer11, 2.0);  tHz11 = snap_fft_bin_hz(sr / p11, 9800.0, 172.26, snapStrength, cBirdHop11);\n\n\t\thzSlew = 0.9975;\n\t\tcHz0  = mix(tHz0,  cHz0,  hzSlew);\n\t\tcHz1  = mix(tHz1,  cHz1,  hzSlew);\n\t\tcHz2  = mix(tHz2,  cHz2,  hzSlew);\n\t\tcHz3  = mix(tHz3,  cHz3,  hzSlew);\n\t\tcHz4  = mix(tHz4,  cHz4,  hzSlew);\n\t\tcHz5  = mix(tHz5,  cHz5,  hzSlew);\n\t\tcHz6  = mix(tHz6,  cHz6,  hzSlew);\n\t\tcHz7  = mix(tHz7,  cHz7,  hzSlew);\n\t\tcHz8  = mix(tHz8,  cHz8,  hzSlew);\n\t\tcHz9  = mix(tHz9,  cHz9,  hzSlew);\n\t\tcHz10 = mix(tHz10, cHz10, hzSlew);\n\t\tcHz11 = mix(tHz11, cHz11, hzSlew);\n\n\t\t// 5. Advance the 12 Phase-Continuous Pure Sine Resynthesis Oscillators\n\t\tcOscPh0  = fract(cOscPh0  + cHz0  / sr);\n\t\tcOscPh1  = fract(cOscPh1  + cHz1  / sr);\n\t\tcOscPh2  = fract(cOscPh2  + cHz2  / sr);\n\t\tcOscPh3  = fract(cOscPh3  + cHz3  / sr);\n\t\tcOscPh4  = fract(cOscPh4  + cHz4  / sr);\n\t\tcOscPh5  = fract(cOscPh5  + cHz5  / sr);\n\t\tcOscPh6  = fract(cOscPh6  + cHz6  / sr);\n\t\tcOscPh7  = fract(cOscPh7  + cHz7  / sr);\n\t\tcOscPh8  = fract(cOscPh8  + cHz8  / sr);\n\t\tcOscPh9  = fract(cOscPh9  + cHz9  / sr);\n\t\tcOscPh10 = fract(cOscPh10 + cHz10 / sr);\n\t\tcOscPh11 = fract(cOscPh11 + cHz11 / sr);\n\n\t\t// Pure sinusoidal partials with Staggered MDCT Birdie Chirp Windows:\n\t\t// As `birdiesVal` approaches 100%, each band pulses with a staggered sine-squared MDCT\n\t\t// droplet envelope (`bw0..11`) and receives phantom birdie excitation from `cAvg`,\n\t\t// creating unmistakable watery, chirping MP3/Opus birdie artifacts!\n\t\tbDepth = birdiesVal * birdiesVal;\n\t\tphRad = cFramePh * 6.28318530718;\n\t\tbw0  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 0.0), 2.0), bDepth);\n\t\tbw1  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 1.1), 2.0), bDepth);\n\t\tbw2  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 2.2), 2.0), bDepth);\n\t\tbw3  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 3.3), 2.0), bDepth);\n\t\tbw4  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 4.4), 2.0), bDepth);\n\t\tbw5  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 5.5), 2.0), bDepth);\n\t\tbw6  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 0.5), 2.0), bDepth);\n\t\tbw7  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 1.6), 2.0), bDepth);\n\t\tbw8  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 2.7), 2.0), bDepth);\n\t\tbw9  = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 3.8), 2.0), bDepth);\n\t\tbw10 = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 4.9), 2.0), bDepth);\n\t\tbw11 = mix(1.0, 0.25 + 1.15 * pow(0.5 + 0.5 * sin(phRad + 6.0), 2.0), bDepth);\n\n\t\t// Phantom birdie cross-band excitation Focused on vocal/birdie bands (300..3800 Hz)\n\t\tphantomEnv = cAvg * bDepth * 0.45;\n\t\tbAmp0  = (cEnv0  + phantomEnv * 0.2) * cGain0  * bw0;\n\t\tbAmp1  = (cEnv1  + phantomEnv * 0.4) * cGain1  * bw1;\n\t\tbAmp2  = (cEnv2  + phantomEnv * 0.7) * cGain2  * bw2;\n\t\tbAmp3  = (cEnv3  + phantomEnv * 0.9) * cGain3  * bw3;\n\t\tbAmp4  = (cEnv4  + phantomEnv * 1.0) * cGain4  * bw4;\n\t\tbAmp5  = (cEnv5  + phantomEnv * 1.0) * cGain5  * bw5;\n\t\tbAmp6  = (cEnv6  + phantomEnv * 0.9) * cGain6  * bw6;\n\t\tbAmp7  = (cEnv7  + phantomEnv * 0.7) * cGain7  * bw7;\n\t\tbAmp8  = (cEnv8  + phantomEnv * 0.4) * cGain8  * bw8;\n\t\tbAmp9  = (cEnv9  + phantomEnv * 0.2) * cGain9  * bw9;\n\t\tbAmp10 = (cEnv10 + phantomEnv * 0.1) * cGain10 * bw10;\n\t\tbAmp11 = (cEnv11 + phantomEnv * 0.1) * cGain11 * bw11;\n\n\t\ts0  = sin(cOscPh0  * 6.28318530718) * bAmp0;\n\t\ts1  = sin(cOscPh1  * 6.28318530718) * bAmp1;\n\t\ts2  = sin(cOscPh2  * 6.28318530718) * bAmp2;\n\t\ts3  = sin(cOscPh3  * 6.28318530718) * bAmp3;\n\t\ts4  = sin(cOscPh4  * 6.28318530718) * bAmp4;\n\t\ts5  = sin(cOscPh5  * 6.28318530718) * bAmp5;\n\t\ts6  = sin(cOscPh6  * 6.28318530718) * bAmp6;\n\t\ts7  = sin(cOscPh7  * 6.28318530718) * bAmp7;\n\t\ts8  = sin(cOscPh8  * 6.28318530718) * bAmp8;\n\t\ts9  = sin(cOscPh9  * 6.28318530718) * bAmp9;\n\t\ts10 = sin(cOscPh10 * 6.28318530718) * bAmp10;\n\t\ts11 = sin(cOscPh11 * 6.28318530718) * bAmp11;\n\n\t\tevenSin = s0 + s2 + s4 + s6 + s8 + s10;\n\t\toddSin  = s1 + s3 + s5 + s7 + s9 + s11;\n\n\t\t// Smooth automatic sparse-band energy makeup:\n\t\t//   - Below 70% Damage: boosts surviving sparse partials to unity loudness (`cFastEnv`).\n\t\t//   - Above 75%..100% Damage: rolls off makeup and gates whole frames so 100% Damage is\n\t\t//     nearly silent except when an isolated sinusoidal birdie glitch pokes through!\n\t\toutBandSum = bAmp0 + bAmp1 + bAmp2 + bAmp3 + bAmp4 + bAmp5 + bAmp6 + bAmp7 + bAmp8 + bAmp9 + bAmp10 + bAmp11;\n\t\tsafeOutBand = max(outBandSum, 0.002);\n\t\tstarveFade = 1.0 - clip((codecLossVal - 0.72) / 0.28, 0.0, 1.0) * 0.92;\n\t\tmaxMakeup = 1.0 + 5.5 * starveFade;\n\t\ttargetMakeup = clip((cFastEnv * 1.15 * starveFade) / safeOutBand, 0.15, maxMakeup);\n\t\tcodMakeup = mix(targetMakeup, codMakeup, 0.9985);\n\n\t\tsineResL = (evenSin * 0.75 + oddSin * 0.40) * codMakeup;\n\t\tsineResR = (oddSin * 0.75 + evenSin * 0.40) * codMakeup;\n\n\t\t// Gated narrowband SVF sum (also scaled by codMakeup)\n\t\tsvfSumL = (cBp0L  * cGain0  + cBp1L  * cGain1  + cBp2L  * cGain2  + cBp3L  * cGain3\n\t\t        +  cBp4L  * cGain4  + cBp5L  * cGain5  + cBp6L  * cGain6  + cBp7L  * cGain7\n\t\t        +  cBp8L  * cGain8  + cBp9L  * cGain9  + cBp10L * cGain10 + cBp11L * cGain11) * codMakeup;\n\t\tsvfSumR = (cBp0R  * cGain0  + cBp1R  * cGain1  + cBp2R  * cGain2  + cBp3R  * cGain3\n\t\t        +  cBp4R  * cGain4  + cBp5R  * cGain5  + cBp6R  * cGain6  + cBp7R  * cGain7\n\t\t        +  cBp8R  * cGain8  + cBp9R  * cGain9  + cBp10R * cGain10 + cBp11R * cGain11) * codMakeup;\n\n\t\t// Blend from narrowband gated SVF bank into 100% pure pitch-tracked sinusoidal resynthesis\n\t\tresynthBlend = clip(0.45 + codecLossVal * 0.45 + birdiesVal * 0.65 + preechoVal * 0.45, 0.0, 1.0);\n\t\tcodecWetL = mix(svfSumL, sineResL, resynthBlend);\n\t\tcodecWetR = mix(svfSumR, sineResR, resynthBlend);\n\n\t\t// Pure linear crossfade (zero tanh distortion!)\n\t\tactiveAmt = clip(codecLossVal * 1.4 + birdiesVal * 1.1 + preechoVal * 1.0, 0.0, 1.0);\n\t\tsigL = clip(mix(delL, codecWetL, activeAmt), -1.2, 1.2);\n\t\tsigR = clip(mix(delR, codecWetR, activeAmt), -1.2, 1.2);\n\n\t\tdiffCodL = abs(sigL - inCodL);\n\t\tdiffCodR = abs(sigR - inCodR);\n\t\tdiffCod = max(diffCodL, diffCodR) + 0.12;\n\t\tcodecActHold = max(codecActHold, diffCod);\n\t}\n\n\t// ========================================================================\n\t// STAGE 3: TELECOM COMPANDING (u-Law / A-Law / ADPCM / GSM)\n\t// ========================================================================\n\tif ((stId == 3) * (tele_on > 0.5)) {\n\t\tinTelL = sigL;\n\t\tinTelR = sigR;\n\n\t\thpFreq = 120.0 + teleLineVal * 260.0;\n\t\tlpFreq = 7000.0 - teleLineVal * 4200.0;\n\t\tcHp = exp(-6.28318530718 * hpFreq / sr);\n\t\tcLp = exp(-6.28318530718 * lpFreq / sr);\n\n\t\ttHpL = mix(inTelL, tHpL, cHp);\n\t\ttHpR = mix(inTelR, tHpR, cHp);\n\t\thpOutL = inTelL - tHpL;\n\t\thpOutR = inTelR - tHpR;\n\t\ttLpL = mix(hpOutL, tLpL, cLp);\n\t\ttLpR = mix(hpOutR, tLpR, cLp);\n\n\t\tvoiceSr = 16000.0 - teleLineVal * 10000.0;\n\t\ttDecimPh = tDecimPh + voiceSr / sr;\n\t\tif (tDecimPh >= 1.0) {\n\t\t\ttDecimPh = fract(tDecimPh);\n\t\t\ttHoldL = tLpL;\n\t\t\ttHoldR = tLpR;\n\n\t\t\tmaxSlew = max(0.025, 0.42 - teleLineVal * 0.37);\n\t\t\tdiffL = clip(tHoldL - tPredL, -maxSlew, maxSlew);\n\t\t\tdiffR = clip(tHoldR - tPredR, -maxSlew, maxSlew);\n\t\t\tstepQ = max(maxSlew / 3.5, 0.002);\n\t\t\tqDiffL = round(diffL / stepQ) * stepQ;\n\t\t\tqDiffR = round(diffR / stepQ) * stepQ;\n\t\t\ttPredL = clip(tPredL * 0.94 + qDiffL, -1.0, 1.0);\n\t\t\ttPredR = clip(tPredR * 0.94 + qDiffR, -1.0, 1.0);\n\t\t}\n\t\tvL = mix(tLpL, tHoldL, 0.35 + teleLineVal * 0.65);\n\t\tvR = mix(tLpR, tHoldR, 0.35 + teleLineVal * 0.65);\n\n\t\tqStepsRaw = floor(64.0 - teleLineVal * 56.0 + 0.5);\n\t\tqSteps = max(qStepsRaw, 4.0);\n\t\tuL = ulaw_compand(vL, qSteps);\n\t\tuR = ulaw_compand(vR, qSteps);\n\t\taL = alaw_compand(vL, qSteps);\n\t\taR = alaw_compand(vR, qSteps);\n\t\tadpcmL = tPredL;\n\t\tadpcmR = tPredR;\n\n\t\ttGsmPh = tGsmPh + 50.0 / sr;\n\t\tif (tGsmPh >= 1.0) {\n\t\t\ttGsmPh = fract(tGsmPh);\n\t\t\tdropThresh = teleLineVal * 0.38;\n\t\t\tnoiseAbs = abs(noiseA);\n\t\t\ttGsmGain = (noiseAbs < dropThresh) ? 0.12 : (0.85 + 0.15 * noiseB);\n\t\t}\n\t\twForm = 6.28318530718 * 1050.0 / sr;\n\t\trForm = 0.72 + teleLineVal * 0.20;\n\t\tb0Form = (1.0 - rForm * rForm) * 0.5;\n\t\tresL = b0Form * vL + 2.0 * rForm * cos(wForm) * tRes1L - (rForm * rForm) * tRes2L;\n\t\tresR = b0Form * vR + 2.0 * rForm * cos(wForm) * tRes1R - (rForm * rForm) * tRes2R;\n\t\ttRes2L = tRes1L;\n\t\ttRes1L = clip(fixnan(resL), -2.0, 2.0);\n\t\ttRes2R = tRes1R;\n\t\ttRes1R = clip(fixnan(resR), -2.0, 2.0);\n\n\t\tgsmGrid = max(3.0, 22.0 - teleLineVal * 18.0);\n\t\tgsmRawL = mix(vL, tRes1L * 1.6, 0.55) * tGsmGain;\n\t\tgsmRawR = mix(vR, tRes1R * 1.6, 0.55) * tGsmGain;\n\t\tgsmL = quant_steps(tanh(gsmRawL * (1.5 + teleLineVal * 2.0)), gsmGrid);\n\t\tgsmR = quant_steps(tanh(gsmRawR * (1.5 + teleLineVal * 2.0)), gsmGrid);\n\n\t\tmodeOutL = (teleModeVal == 0) ? uL : ((teleModeVal == 1) ? aL : ((teleModeVal == 2) ? adpcmL : gsmL));\n\t\tmodeOutR = (teleModeVal == 0) ? uR : ((teleModeVal == 1) ? aR : ((teleModeVal == 2) ? adpcmR : gsmR));\n\n\t\tteleWet = clip(teleLineVal * 2.5, 0.0, 1.0);\n\t\tsigL = clip(mix(inTelL, modeOutL, teleWet), -1.0, 1.0);\n\t\tsigR = clip(mix(inTelR, modeOutR, teleWet), -1.0, 1.0);\n\t\tdiffTelL = abs(sigL - inTelL);\n\t\tdiffTelR = abs(sigR - inTelR);\n\t\tdiffTel = max(diffTelL, diffTelR) + 0.12;\n\t\tteleActHold = max(teleActHold, diffTel);\n\t}\n\n\t// ========================================================================\n\t// STAGE 4: 4-MODE FFT SPECTRAL GLITCH\n\t//   0: Den (Bad Spectral Denoiser / Underwater Musical Noise)\n\t//   1: Scr (Click-Free 6-Band Spectral Matrix Scramble \u2014 smooth even at 5 ms!)\n\t//   2: Spl (Dual Hann-Windowed Dispersive Phase Splat)\n\t//   3: Cmb (Spectral Contrast Sieve + Resonant Pitch Comb)\n\t// ========================================================================\n\tif ((stId == 4) * (fft_on > 0.5)) {\n\t\tinFftL = sigL;\n\t\tinFftR = sigR;\n\n\t\tframeSamps = clip(fftFrameMs * sr / 1000.0, 220.0, 7500.0);\n\t\tstepInc = 1.0 / frameSamps;\n\n\t\toldPhA = fPh;\n\t\tfPh = fract(oldPhA + stepInc);\n\t\tphA = fPh;\n\t\tphB = fract(fPh + 0.5);\n\t\twrapFrame = (phA < oldPhA);\n\n\t\twA = hann_win(phA);\n\t\twB = hann_win(phB);\n\n\t\tfftDL.write(inFftL);\n\t\tfftDR.write(inFftR);\n\n\t\t// 6-Band Resonant Chamberlin SVF Spectral Bank (220, 520, 1150, 2400, 4600, 8200 Hz)\n\t\tfDamp = 0.22;\n\t\tfInL = inFftL * fDamp;\n\t\tfInR = inFftR * fDamp;\n\n\t\tff0 = 2.0 * sin(3.14159265359 * 220.0 / sr);\n\t\tfhp0L = fInL - fLp0L - fDamp * fBp0L; fBp0L = clip(fBp0L + ff0 * fhp0L, -2.0, 2.0); fLp0L = clip(fLp0L + ff0 * fBp0L, -2.0, 2.0);\n\t\tfhp0R = fInR - fLp0R - fDamp * fBp0R; fBp0R = clip(fBp0R + ff0 * fhp0R, -2.0, 2.0); fLp0R = clip(fLp0R + ff0 * fBp0R, -2.0, 2.0);\n\n\t\tff1 = 2.0 * sin(3.14159265359 * 520.0 / sr);\n\t\tfhp1L = fInL - fLp1L - fDamp * fBp1L; fBp1L = clip(fBp1L + ff1 * fhp1L, -2.0, 2.0); fLp1L = clip(fLp1L + ff1 * fBp1L, -2.0, 2.0);\n\t\tfhp1R = fInR - fLp1R - fDamp * fBp1R; fBp1R = clip(fBp1R + ff1 * fhp1R, -2.0, 2.0); fLp1R = clip(fLp1R + ff1 * fBp1R, -2.0, 2.0);\n\n\t\tff2 = 2.0 * sin(3.14159265359 * 1150.0 / sr);\n\t\tfhp2L = fInL - fLp2L - fDamp * fBp2L; fBp2L = clip(fBp2L + ff2 * fhp2L, -2.0, 2.0); fLp2L = clip(fLp2L + ff2 * fBp2L, -2.0, 2.0);\n\t\tfhp2R = fInR - fLp2R - fDamp * fBp2R; fBp2R = clip(fBp2R + ff2 * fhp2R, -2.0, 2.0); fLp2R = clip(fLp2R + ff2 * fBp2R, -2.0, 2.0);\n\n\t\tff3 = 2.0 * sin(3.14159265359 * 2400.0 / sr);\n\t\tfhp3L = fInL - fLp3L - fDamp * fBp3L; fBp3L = clip(fBp3L + ff3 * fhp3L, -2.0, 2.0); fLp3L = clip(fLp3L + ff3 * fBp3L, -2.0, 2.0);\n\t\tfhp3R = fInR - fLp3R - fDamp * fBp3R; fBp3R = clip(fBp3R + ff3 * fhp3R, -2.0, 2.0); fLp3R = clip(fLp3R + ff3 * fBp3R, -2.0, 2.0);\n\n\t\tff4 = 2.0 * sin(3.14159265359 * 4600.0 / sr);\n\t\tfhp4L = fInL - fLp4L - fDamp * fBp4L; fBp4L = clip(fBp4L + ff4 * fhp4L, -2.0, 2.0); fLp4L = clip(fLp4L + ff4 * fBp4L, -2.0, 2.0);\n\t\tfhp4R = fInR - fLp4R - fDamp * fBp4R; fBp4R = clip(fBp4R + ff4 * fhp4R, -2.0, 2.0); fLp4R = clip(fLp4R + ff4 * fBp4R, -2.0, 2.0);\n\n\t\tfHz5 = min(8200.0, sr * 0.42);\n\t\tff5 = 2.0 * sin(3.14159265359 * fHz5 / sr);\n\t\tfhp5L = fInL - fLp5L - fDamp * fBp5L; fBp5L = clip(fBp5L + ff5 * fhp5L, -2.0, 2.0); fLp5L = clip(fLp5L + ff5 * fBp5L, -2.0, 2.0);\n\t\tfhp5R = fInR - fLp5R - fDamp * fBp5R; fBp5R = clip(fBp5R + ff5 * fhp5R, -2.0, 2.0); fLp5R = clip(fLp5R + ff5 * fBp5R, -2.0, 2.0);\n\n\t\t// Track 6 spectral band envelopes\n\t\tfpk0 = max(abs(fBp0L), abs(fBp0R)); fEnv0 = mix(fpk0, fEnv0, 0.992);\n\t\tfpk1 = max(abs(fBp1L), abs(fBp1R)); fEnv1 = mix(fpk1, fEnv1, 0.992);\n\t\tfpk2 = max(abs(fBp2L), abs(fBp2R)); fEnv2 = mix(fpk2, fEnv2, 0.992);\n\t\tfpk3 = max(abs(fBp3L), abs(fBp3R)); fEnv3 = mix(fpk3, fEnv3, 0.992);\n\t\tfpk4 = max(abs(fBp4L), abs(fBp4R)); fEnv4 = mix(fpk4, fEnv4, 0.992);\n\t\tfpk5 = max(abs(fBp5L), abs(fBp5R)); fEnv5 = mix(fpk5, fEnv5, 0.992);\n\t\tfAvgEnv = (fEnv0 + fEnv1 + fEnv2 + fEnv3 + fEnv4 + fEnv5) * 0.1666667;\n\n\t\t// Frame-clocked random target updates for Denoise (Mode 0) and Scramble (Mode 1)\n\t\tif (wrapFrame) {\n\t\t\tdTh = fAvgEnv * (0.45 + fftGlitchVal * 1.35);\n\t\t\tfDenT0 = (fEnv0 * (1.0 + noiseA * 0.7) > dTh) ? 1.8 : 0.0;\n\t\t\tfDenT1 = (fEnv1 * (1.0 + noiseB * 0.7) > dTh) ? 1.8 : 0.0;\n\t\t\tfDenT2 = (fEnv2 * (1.0 - noiseA * 0.7) > dTh) ? 1.8 : 0.0;\n\t\t\tfDenT3 = (fEnv3 * (1.0 - noiseB * 0.7) > dTh) ? 1.8 : 0.0;\n\t\t\tfDenT4 = (fEnv4 * (1.0 + (noiseA + noiseB) * 0.5) > dTh) ? 1.8 : 0.0;\n\t\t\tfDenT5 = (fEnv5 * (1.0 - (noiseA - noiseB) * 0.5) > dTh) ? 1.8 : 0.0;\n\n\t\t\tfScrT0 = 0.2 + 1.5 * abs(sin(rollCounter * 1.3 + noiseA * 3.1));\n\t\t\tfScrT1 = 0.2 + 1.5 * abs(cos(rollCounter * 2.1 + noiseB * 2.7));\n\t\t\tfScrT2 = 0.2 + 1.5 * abs(sin(rollCounter * 2.9 - noiseA * 2.3));\n\t\t\tfScrT3 = 0.2 + 1.5 * abs(cos(rollCounter * 3.7 + noiseB * 3.5));\n\t\t\tfScrT4 = 0.2 + 1.5 * abs(sin(rollCounter * 4.3 - noiseB * 2.9));\n\t\t\tfScrT5 = 0.2 + 1.5 * abs(cos(rollCounter * 5.1 + noiseA * 3.7));\n\t\t\tsrcStep = max(fftFrameMs, 5.0);\n\t\t\ttargetModHz = 35.0 + (abs(noiseA) * 320.0) * (45.0 / srcStep);\n\t\t\tfScrModHz = clip(targetModHz, 25.0, 950.0);\n\t\t}\n\n\t\t// --------------------------------------------------------------------\n\t\t// MODE 0: Den \u2014 Bad Spectral Denoiser / Underwater Musical Noise\n\t\t// --------------------------------------------------------------------\n\t\tfDenG0 = mix(fDenT0, fDenG0, 0.9965);\n\t\tfDenG1 = mix(fDenT1, fDenG1, 0.9965);\n\t\tfDenG2 = mix(fDenT2, fDenG2, 0.9965);\n\t\tfDenG3 = mix(fDenT3, fDenG3, 0.9965);\n\t\tfDenG4 = mix(fDenT4, fDenG4, 0.9965);\n\t\tfDenG5 = mix(fDenT5, fDenG5, 0.9965);\n\t\tdenL = (fBp0L * fDenG0 + fBp1L * fDenG1 + fBp2L * fDenG2 + fBp3L * fDenG3 + fBp4L * fDenG4 + fBp5L * fDenG5) * 1.15;\n\t\tdenR = (fBp0R * fDenG0 + fBp1R * fDenG1 + fBp2R * fDenG2 + fBp3R * fDenG3 + fBp4R * fDenG4 + fBp5R * fDenG5) * 1.15;\n\n\t\t// --------------------------------------------------------------------\n\t\t// MODE 1: Scr \u2014 Click-Free 6-Band Spectral Matrix Scramble\n\t\t// --------------------------------------------------------------------\n\t\tfScrG0 = mix(fScrT0, fScrG0, 0.9985);\n\t\tfScrG1 = mix(fScrT1, fScrG1, 0.9985);\n\t\tfScrG2 = mix(fScrT2, fScrG2, 0.9985);\n\t\tfScrG3 = mix(fScrT3, fScrG3, 0.9985);\n\t\tfScrG4 = mix(fScrT4, fScrG4, 0.9985);\n\t\tfScrG5 = mix(fScrT5, fScrG5, 0.9985);\n\n\t\tfScrModPh = fract(fScrModPh + fScrModHz / sr);\n\t\tcSc = cos(fScrModPh * 6.28318530718);\n\t\tsSc = sin(fScrModPh * 6.28318530718);\n\n\t\tscrB01L = (fBp0L * cSc - fLp0L * sSc) * fScrG0 + (fBp1L * cSc + fLp1L * sSc) * fScrG1;\n\t\tscrB23L = (fBp2L * cSc - fLp2L * sSc) * fScrG2 + (fBp3L * cSc + fLp3L * sSc) * fScrG3;\n\t\tscrB45L = (fBp4L * cSc - fLp4L * sSc) * fScrG4 + (fBp5L * cSc + fLp5L * sSc) * fScrG5;\n\n\t\tscrB01R = (fBp0R * cSc + fLp0R * sSc) * fScrG1 + (fBp1R * cSc - fLp1R * sSc) * fScrG0;\n\t\tscrB23R = (fBp2R * cSc + fLp2R * sSc) * fScrG3 + (fBp3R * cSc - fLp3R * sSc) * fScrG2;\n\t\tscrB45R = (fBp4R * cSc + fLp4R * sSc) * fScrG5 + (fBp5R * cSc - fLp5R * sSc) * fScrG4;\n\n\t\tscrL = (scrB01L + scrB23L + scrB45L) * 0.95;\n\t\tscrR = (scrB01R + scrB23R + scrB45R) * 0.95;\n\n\t\t// --------------------------------------------------------------------\n\t\t// MODE 2: Spl \u2014 Dual Hann-Windowed Dispersive Phase Splat\n\t\t// --------------------------------------------------------------------\n\t\tapK = 0.38 - 0.28 * sin(fPh * 6.28318530718);\n\t\tu1L = inFftL - apK * fAp1L; y1L = fAp1L + apK * u1L; fAp1L = clip(fixnan(u1L), -2.0, 2.0);\n\t\tu2L = y1L    - apK * fAp2L; y2L = fAp2L + apK * u2L; fAp2L = clip(fixnan(u2L), -2.0, 2.0);\n\t\tu3L = y2L    - apK * fAp3L; y3L = fAp3L + apK * u3L; fAp3L = clip(fixnan(u3L), -2.0, 2.0);\n\t\tu4L = y3L    - apK * fAp4L; y4L = fAp4L + apK * u4L; fAp4L = clip(fixnan(u4L), -2.0, 2.0);\n\n\t\tu1R = inFftR - apK * fAp1R; y1R = fAp1R + apK * u1R; fAp1R = clip(fixnan(u1R), -2.0, 2.0);\n\t\tu2R = y1R    - apK * fAp2R; y2R = fAp2R + apK * u2R; fAp2R = clip(fixnan(u2R), -2.0, 2.0);\n\t\tu3R = y2R    - apK * fAp3R; y3R = fAp3R + apK * u3R; fAp3R = clip(fixnan(u3R), -2.0, 2.0);\n\t\tu4R = y3R    - apK * fAp4R; y4R = fAp4R + apK * u4R; fAp4R = clip(fixnan(u4R), -2.0, 2.0);\n\n\t\tchirpTapA = (0.5 - 0.45 * cos(phA * 6.28318530718)) * frameSamps * 0.28;\n\t\tchirpTapB = (0.5 - 0.45 * cos(phB * 6.28318530718)) * frameSamps * 0.28;\n\t\tchirpL = fftDL.read(chirpTapA, interp=\"linear\") * wA + fftDL.read(chirpTapB, interp=\"linear\") * wB;\n\t\tchirpR = fftDR.read(chirpTapA, interp=\"linear\") * wA + fftDR.read(chirpTapB, interp=\"linear\") * wB;\n\n\t\tsplatL = y4L * 0.55 + chirpL * 0.65;\n\t\tsplatR = y4R * 0.55 + chirpR * 0.65;\n\n\t\t// --------------------------------------------------------------------\n\t\t// MODE 3: Cmb \u2014 Smooth Spectral Contrast Sieve + Resonant Pitch Comb\n\t\t// --------------------------------------------------------------------\n\t\tfMax01 = max(fEnv0, fEnv1);\n\t\tfMax23 = max(fEnv2, fEnv3);\n\t\tfMax45 = max(fEnv4, fEnv5);\n\t\tfMax0123 = max(fMax01, fMax23);\n\t\tfMaxAll = max(fMax0123, fMax45);\n\t\tfMax = max(fMaxAll, 0.0005);\n\n\t\tcontrastExp = 1.0 + fftGlitchVal * 4.5;\n\t\trE0 = clip(fEnv0 / fMax, 0.0, 1.0); tw0 = pow(rE0, contrastExp) * 1.45;\n\t\trE1 = clip(fEnv1 / fMax, 0.0, 1.0); tw1 = pow(rE1, contrastExp) * 1.45;\n\t\trE2 = clip(fEnv2 / fMax, 0.0, 1.0); tw2 = pow(rE2, contrastExp) * 1.45;\n\t\trE3 = clip(fEnv3 / fMax, 0.0, 1.0); tw3 = pow(rE3, contrastExp) * 1.45;\n\t\trE4 = clip(fEnv4 / fMax, 0.0, 1.0); tw4 = pow(rE4, contrastExp) * 1.45;\n\t\trE5 = clip(fEnv5 / fMax, 0.0, 1.0); tw5 = pow(rE5, contrastExp) * 1.45;\n\n\t\tfW0 = mix(tw0, fW0, 0.996);\n\t\tfW1 = mix(tw1, fW1, 0.996);\n\t\tfW2 = mix(tw2, fW2, 0.996);\n\t\tfW3 = mix(tw3, fW3, 0.996);\n\t\tfW4 = mix(tw4, fW4, 0.996);\n\t\tfW5 = mix(tw5, fW5, 0.996);\n\n\t\ttargetCombSamps = clip(frameSamps * 0.18, 32.0, 2048.0);\n\t\tfCombSamps = mix(targetCombSamps, fCombSamps, 0.9985);\n\t\tcombTapL = fftDL.read(fCombSamps, interp=\"linear\");\n\t\tcombTapR = fftDR.read(fCombSamps, interp=\"linear\");\n\t\tcombL = (fBp0L * fW0 + fBp1L * fW1 + fBp2L * fW2 + fBp3L * fW3 + fBp4L * fW4 + fBp5L * fW5) * 0.85 + combTapL * 0.65;\n\t\tcombR = (fBp0R * fW0 + fBp1R * fW1 + fBp2R * fW2 + fBp3R * fW3 + fBp4R * fW4 + fBp5R * fW5) * 0.85 + combTapR * 0.65;\n\n\t\t// Select active FFT mode 0..3 (0=Den, 1=Scr, 2=Spl, 3=Cmb)\n\t\tfftWetL = (fftModeVal == 0) ? denL : ((fftModeVal == 1) ? scrL : ((fftModeVal == 2) ? splatL : combL));\n\t\tfftWetR = (fftModeVal == 0) ? denR : ((fftModeVal == 1) ? scrR : ((fftModeVal == 2) ? splatR : combR));\n\n\t\tmixFftL = mix(inFftL, fftWetL, fftGlitchVal);\n\t\tmixFftR = mix(inFftR, fftWetR, fftGlitchVal);\n\t\tsigL = clip(mixFftL, -1.0, 1.0);\n\t\tsigR = clip(mixFftR, -1.0, 1.0);\n\t\tdiffFftL = abs(sigL - inFftL);\n\t\tdiffFftR = abs(sigR - inFftR);\n\t\tdiffFft = max(diffFftL, diffFftR) + 0.12;\n\t\tfftActHold = max(fftActHold, diffFft);\n\t}\n}\n\n// Equal-power Dry/Wet Mix & Output Trim\nwetAng = wetSlew * 1.57079632679;\ndryG = cos(wetAng);\nwetG = sin(wetAng);\n\nwetOutL = tanh(sigL * outGainSlew);\nwetOutR = tanh(sigR * outGainSlew);\n\noutL = in1 * dryG + wetOutL * wetG;\noutR = in2 * dryG + wetOutR * wetG;\n\n// Update `#0-degscope` telemetry buffer every 64 samples\ninAbs1 = abs(in1);\ninAbs2 = abs(in2);\ninAbs = max(inAbs1, inAbs2);\noutAbs1 = abs(outL);\noutAbs2 = abs(outR);\noutAbs = max(outAbs1, outAbs2);\npeakInHold = max(peakInHold, inAbs);\npeakOutHold = max(peakOutHold, outAbs);\n\ntick = wrap(tick + 1, 0, 64);\nif (tick == 0) {\n\trollCounter = wrap(rollCounter + 1, 0, 100000);\n\tm0 = (bit_on > 0.5) ? 1 : 0;\n\tm1 = (sr_on > 0.5) ? 2 : 0;\n\tm2 = (codec_on > 0.5) ? 4 : 0;\n\tm3 = (tele_on > 0.5) ? 8 : 0;\n\tm4 = (fft_on > 0.5) ? 16 : 0;\n\tactMask = m0 + m1 + m2 + m3 + m4;\n\n\tpkInC = clip(peakInHold, 0.0, 1.5);\n\tpkOutC = clip(peakOutHold, 0.0, 1.5);\n\tactBitC = clip(bitActHold, 0.0, 1.0);\n\tactSrC = clip(srActHold, 0.0, 1.0);\n\tactCodC = clip(codecActHold, 0.0, 1.0);\n\tactTelC = clip(teleActHold, 0.0, 1.0);\n\tactFftC = clip(fftActHold, 0.0, 1.0);\n\n\tpoke(scope, pkInC, 0, 0);\n\tpoke(scope, pkOutC, 1, 0);\n\tpoke(scope, (bit_on > 0.5) ? actBitC : 0.0, 2, 0);\n\tpoke(scope, (sr_on > 0.5) ? actSrC : 0.0, 3, 0);\n\tpoke(scope, (codec_on > 0.5) ? actCodC : 0.0, 4, 0);\n\tpoke(scope, (tele_on > 0.5) ? actTelC : 0.0, 5, 0);\n\tpoke(scope, (fft_on > 0.5) ? actFftC : 0.0, 6, 0);\n\tpoke(scope, rollCounter, 7, 0);\n\n\twaveIdx = wrap(waveIdx + 1, 0, 8);\n\twaveSample = clip(0.5 * (outL + outR), -1.0, 1.0);\n\tpoke(scope, waveSample, 8 + waveIdx, 0);\n\n\tbaseSpec = clip(peakOutHold, 0.02, 1.0);\n\tfor (bIdx = 0; bIdx < 12; bIdx += 1) {\n\t\tbandNorm = bIdx / 11.0;\n\t\tcBandGain = (bIdx == 0) ? cGain0 : ((bIdx == 1) ? cGain1 : ((bIdx == 2) ? cGain2 : ((bIdx == 3) ? cGain3 : ((bIdx == 4) ? cGain4 : ((bIdx == 5) ? cGain5 : ((bIdx == 6) ? cGain6 : ((bIdx == 7) ? cGain7 : ((bIdx == 8) ? cGain8 : ((bIdx == 9) ? cGain9 : ((bIdx == 10) ? cGain10 : cGain11))))))))));\n\t\tholeRaw = clip(cBandGain * 0.65, 0.0, 1.0);\n\t\tholeAtten = (codec_on > 0.5) ? holeRaw : 1.0;\n\t\tteleRaw = 1.0 - teleLineVal * 0.85;\n\t\tisTeleEdge = (bIdx < 2) + (bIdx > 8);\n\t\tteleCond = (tele_on > 0.5) * (isTeleEdge > 0);\n\t\tteleAtten = teleCond ? teleRaw : 1.0;\n\t\tsrRaw = 0.35 + 0.55 * (1.0 - srModeVal);\n\t\tsrCond = (sr_on > 0.5) * (bandNorm > (srateVal / 22050.0));\n\t\tsrAlias = srCond ? srRaw : 1.0;\n\t\tvalB = clip(baseSpec * holeAtten * teleAtten * srAlias * (0.55 + 0.45 * abs(cos(bIdx * 0.9 + rollCounter * 0.15))), 0.0, 1.0);\n\t\tpoke(scope, valB, 16 + bIdx, 0);\n\t}\n\n\tsrRatioC = clip(srateVal / sr, 0.0, 1.0);\n\tpoke(scope, bitsVal, 28, 0);\n\tpoke(scope, srRatioC, 29, 0);\n\tpoke(scope, actMask, 30, 0);\n\tpoke(scope, ord0 * 10000 + ord1 * 1000 + ord2 * 100 + ord3 * 10 + ord4, 31, 0);\n\n\tpeakInHold = 0;\n\tpeakOutHold = 0;\n\tbitActHold = bitActHold * 0.5;\n\tsrActHold = srActHold * 0.5;\n\tcodecActHold = codecActHold * 0.5;\n\tteleActHold = teleActHold * 0.5;\n\tfftActHold = fftActHold * 0.5;\n}\n\nout1 = fixnan(outL);\nout2 = fixnan(outR);\n",
          "fontname": "<Monospaced>",
          "fontsize": 10.0,
          "id": "obj-gen",
          "maxclass": "gen.codebox~",
          "numinlets": 2,
          "numoutlets": 2,
          "outlettype": [
            "signal",
            "signal"
          ],
          "patching_rect": [
            200.0,
            215.0,
            300.0,
            75.0
          ]
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
            200.0,
            305.0,
            90.0,
            20.0
          ],
          "text": "record~ rec 2"
        }
      },
      {
        "box": {
          "id": "obj-peak-l",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "patching_rect": [
            200.0,
            340.0,
            70.0,
            20.0
          ],
          "text": "peakamp~"
        }
      },
      {
        "box": {
          "id": "obj-peak-r",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "patching_rect": [
            290.0,
            340.0,
            70.0,
            20.0
          ],
          "text": "peakamp~"
        }
      },
      {
        "box": {
          "id": "obj-peak-c",
          "maxclass": "newobj",
          "numinlets": 1,
          "numoutlets": 1,
          "outlettype": [
            "float"
          ],
          "patching_rect": [
            380.0,
            340.0,
            70.0,
            20.0
          ],
          "text": "peakamp~"
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
            200.0,
            390.0,
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
            260.0,
            390.0,
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
            200.0,
            430.0,
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
          "numinlets": 4,
          "numoutlets": 3,
          "outlettype": [
            "bang",
            "bang",
            ""
          ],
          "patching_rect": [
            200.0,
            470.0,
            420.0,
            20.0
          ],
          "text": "js /Users/mrwilson/software/ableton/tests/degrade_probe.js order_b"
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
            "obj-params",
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
            "obj-load",
            0
          ],
          "destination": [
            "obj-bind",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-bind",
            0
          ],
          "destination": [
            "obj-gen",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-params",
            0
          ],
          "destination": [
            "obj-gen",
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
            3
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
            "obj-del-peak",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-peak",
            0
          ],
          "destination": [
            "obj-peak-l",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-peak",
            0
          ],
          "destination": [
            "obj-peak-r",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-peak",
            0
          ],
          "destination": [
            "obj-peak-c",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-del-peak",
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
            "obj-osc1",
            0
          ],
          "destination": [
            "obj-g1",
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
            "obj-g2",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-g1",
            0
          ],
          "destination": [
            "obj-sum",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-g2",
            0
          ],
          "destination": [
            "obj-sum",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-sum",
            0
          ],
          "destination": [
            "obj-gen",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-sum",
            0
          ],
          "destination": [
            "obj-gen",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-sum",
            0
          ],
          "destination": [
            "obj-peak-c",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-gen",
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
            "obj-gen",
            1
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
            "obj-gen",
            0
          ],
          "destination": [
            "obj-peak-l",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-gen",
            1
          ],
          "destination": [
            "obj-peak-r",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-gen",
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
            "obj-gen",
            1
          ],
          "destination": [
            "obj-mute-r",
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
            "obj-peak-l",
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
            "obj-peak-c",
            0
          ],
          "destination": [
            "obj-js",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "obj-peak-r",
            0
          ],
          "destination": [
            "obj-js",
            2
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
      }
    ]
  }
}