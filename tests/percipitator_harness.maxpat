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
			40.0,
			40.0,
			1000.0,
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
					"text": "delay 1200"
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
					"text": "delay 250"
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
					"text": "delay 400"
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
					"text": "analyze 400"
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
						680.0,
						20.0
					],
					"text": "wet 1, pitch 0, stretch 1, fshift 0, snap 1, scalemask 4095, gate -42, decay 80, attack 1.5, blur 0.1, tilt 0.5, sieve 0, freeze 0, wtpos 0, wtmode 0, warp 0.5, resynthgain 0"
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
						250.0,
						20.0
					],
					"text": "setbuffer #0-percipwt #0-percipscope"
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
						250.0,
						20.0
					],
					"text": "wt #0-percipwt, scope #0-percipscope"
				}
			},
			{
				"box": {
					"id": "obj-wt",
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
						220.0,
						20.0
					],
					"text": "buffer~ #0-percipwt @samps 8192"
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
						130.0,
						220.0,
						20.0
					],
					"text": "buffer~ #0-percipscope @samps 64"
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
					"id": "obj-recsize",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						520.0,
						185.0,
						75.0,
						20.0
					],
					"text": "size 2000"
				}
			},
			{
				"box": {
					"code": "// Percipitator \u2014 16-Band Scale-Quantized Wavetable Resynthesizer.\n//\n// Buffers (bound on loadbang via `wt #0-percipwt, scope #0-percipscope`):\n//   wt    (\"percipwt\")   : 8192 samples (4 frames x 2048 samples: Sine -> Triangle -> Saw -> Square)\n//   scope (\"percipscope\"): 36 samples:\n//     0..15  : per-band post-sieve/tilt/freeze resynthesis amplitude (0..1.5)\n//     16..31 : per-band quantized MIDI note\n//     32     : peak output level\n//     33     : active partial count\n//     34     : current gate linear\n//     35     : rolling frame counter\n//\n// GenExpr rules strictly enforced:\n//   - All functions appear before Buffer, Param, History, and expression statements.\n//   - No identifier is named e<digit> (Euler's constant lexer bug).\n\nslew(target, coef) {\n\tHistory s(0);\n\tHistory init(0);\n\ts = (init == 0) ? target : mix(target, s, coef);\n\tinit = 1;\n\treturn s;\n}\n\n// 2-pole zero-delay Chamberlin SVF bandpass + instantaneous frequency tracker + Spectral Freeze latch.\n// Optimized:\n//   - Polynomial SVF frequency coefficient (eliminates 16 sin() calls per sample).\n//   - Zero-crossing log2() pitch update runs ONLY on valid zero crossings (validCross).\n//   - Sleeps when input and filter/envelope states are silent.\nband_track(x, centerHz, dampVal, atkCoef, relCoef, gateLin, freezeOn, srVal) {\n\tHistory lpState(0);\n\tHistory bpState(0);\n\tHistory envState(0);\n\tHistory prevSign(1);\n\tHistory periodSamps(100);\n\tHistory sampCount(0);\n\tHistory targetMidi(60);\n\tHistory midiHold(60);\n\tHistory frozenAmp(0);\n\tHistory frozenMidi(60);\n\n\tisFrz = (freezeOn > 0.5);\n\tif (isFrz) {\n\t\treturn frozenAmp, frozenMidi;\n\t}\n\n\tactivity = abs(x) + abs(bpState) + abs(lpState) + envState;\n\tif (activity < 0.0000005) {\n\t\tbpState = 0;\n\t\tlpState = 0;\n\t\tenvState = 0;\n\t\tfrozenAmp = 0;\n\t\treturn 0, midiHold;\n\t}\n\n\tw = 3.14159265359 * clip(centerHz, 40, srVal * 0.42) / srVal;\n\tf = w * (2.0 - 0.33333333 * w * w);\n\thp = x * dampVal - lpState - dampVal * bpState;\n\tbpNew = bpState + f * hp;\n\tlpNew = lpState + f * bpNew;\n\tbpState = clip(bpNew, -2, 2);\n\tlpState = clip(lpNew, -2, 2);\n\n\t// Zero-crossing period estimator on the narrowband signal\n\tsampCount = sampCount + 1;\n\tcurSign = (bpState >= 0) ? 1 : -1;\n\tcrossed = (curSign > 0) && (prevSign < 0);\n\tvalidCross = crossed && (sampCount > 4) && (sampCount < srVal * 0.03);\n\tif (validCross) {\n\t\tperiodSamps = mix(sampCount, periodSamps, 0.65);\n\t\testHz = clip(srVal / max(periodSamps, 4), centerHz * 0.72, centerHz * 1.38);\n\t\ttargetMidi = 69 + 12 * log2(max(estHz, 20) / 440);\n\t}\n\tsampCount = crossed ? 0 : sampCount;\n\tprevSign = curSign;\n\tmidiHold = mix(targetMidi, midiHold, 0.992);\n\n\t// Envelope follower with soft-knee precipitation gate\n\tax = abs(bpState) * 1.45;\n\tc = (ax > envState) ? atkCoef : relCoef;\n\tenvState = mix(ax, envState, c);\n\n\tgLo = max(gateLin * 0.6, 0.00001);\n\tgHi = max(gateLin * 1.6, gLo + 0.0001);\n\tgt = clip((envState - gLo) / (gHi - gLo), 0, 1);\n\tgateFactor = gt * gt * (3 - 2 * gt);\n\tliveAmp = envState * gateFactor;\n\n\tfrozenAmp = liveAmp;\n\tfrozenMidi = midiHold;\n\n\treturn liveAmp, midiHold;\n}\n\n// Quantize a MIDI note number to the active 12-bit scaleMask (bits 0..11 = C..B).\n// Searches +/- 11 semitones so even a single-note MIDI sidechain mask snaps every band.\nquant_midi(inMidi, scaleMask, snapAmt) {\n\tmask = int(clip(scaleMask, 0, 4095));\n\tbase = round(inMidi);\n\tbest = base;\n\tbestDist = 99;\n\n\tfor (k = -11; k <= 11; k += 1) {\n\t\tcand = base + k;\n\t\tpc = int(wrap(cand, 0, 12));\n\t\tbit = int(floor(mask / pow(2, pc))) % 2;\n\t\tdist = abs(cand - inMidi);\n\t\ttake = (bit > 0) && (dist < bestDist);\n\t\tbest = take ? cand : best;\n\t\tbestDist = take ? dist : bestDist;\n\t}\n\teffBest = (mask > 0) ? best : inMidi;\n\treturn mix(inMidi, effBest, clip(snapAmt, 0, 1));\n}\n\n// Per-band Partial Sieve + Spectral Tilt weight.\n//   sieveMode: 0=All, 1=Odd, 2=Even, 3=Sparse (every 3rd), 4=Rising\nband_weight(bandIdx, sieveMode, tiltBipolar) {\n\tm = round(clip(sieveMode, 0, 4));\n\tisEven = ((bandIdx % 2) == 0);\n\tisThird = ((bandIdx % 3) == 0);\n\tsAll = 1.0;\n\tsOdd = isEven ? 1.0 : 0.06;\n\tsEven = isEven ? 0.06 : 1.0;\n\tsSprs = isThird ? 1.18 : 0.03;\n\tsRise = 0.22 + 0.98 * (bandIdx / 15.0);\n\tsieveG = (m == 0) ? sAll : ((m == 1) ? sOdd : ((m == 2) ? sEven : ((m == 3) ? sSprs : sRise)));\n\n\tpos = ((bandIdx / 15.0) - 0.5) * 2.0;\n\ttiltG = pow(2.0, clip(tiltBipolar, -1, 1) * pos * 6.0);\n\treturn sieveG * tiltG;\n}\n\n// Phase warp modifier for wavetable oscillators:\n//   mode 0 (Bend): exponential phase pinch/stretch (uses precomputed bendExp)\n//   mode 1 (Asym): asymmetric duty breakpoint skew\n//   mode 2 (Sync): 1x..5x hard sync phase multiplier\n//   mode 3 (Fold): 1x..4x triangle wavefold\nwarp_phase(ph, mode, warpAmt, bendExp) {\n\tp = wrap(ph, 0, 1);\n\tw = clip(warpAmt, 0, 1);\n\tm = round(clip(mode, 0, 3));\n\toutP = p;\n\tif (m == 0) {\n\t\toutP = (abs(w - 0.5) < 0.003) ? p : pow(max(p, 0.00001), bendExp);\n\t} else if (m == 1) {\n\t\tbp = 0.5 - w * 0.38;\n\t\toutP = (p < bp) ? (0.5 * p / max(bp, 0.02)) : (0.5 + 0.5 * (p - bp) / max(1 - bp, 0.02));\n\t} else if (m == 2) {\n\t\toutP = wrap(p * (1 + w * 4.0), 0, 1);\n\t} else {\n\t\tfp = wrap(p * (1 + w * 3.0), 0, 2);\n\t\toutP = (fp <= 1) ? fp : (2 - fp);\n\t}\n\treturn clip(outP, 0, 0.9999);\n}\n\n// 4-Frame Wavetable Resynthesis Oscillator + Control-Rate Pitch/Weight Decimator per band.\n// Skips all wavetable lookups, phase warp, and pitch quantization when rawAmp <= 0.00001.\n// When active, updates quantized MIDI pitch, frequency pow(), and sieve/tilt weight every 16 samples.\nvoice_osc(wtBuf, bandIdx, rawAmp, rawMidi, pitchSt, stretchVal, fshiftHz, maskInt, snapAmt, sieveMode, tiltVal, wtPos01, warpMode, warpAmt, bendExp, srVal) {\n\tHistory ph(0);\n\tHistory cTick(0);\n\tHistory cInit(0);\n\tHistory heldWeight(1.0);\n\tHistory heldQm(60.0);\n\tHistory heldFreq(440.0);\n\n\tif ((rawAmp <= 0.00001) && (cInit > 0)) {\n\t\treturn 0, 0, heldQm;\n\t}\n\n\tif ((cTick == 0) || (cInit == 0)) {\n\t\theldWeight = band_weight(bandIdx, sieveMode, tiltVal);\n\t\theldQm = quant_midi(69 + (rawMidi - 69) * stretchVal + pitchSt, maskInt, snapAmt);\n\t\theldFreq = clip(440 * pow(2, (heldQm - 69) / 12) + fshiftHz, 20, 18000);\n\t\tcInit = 1;\n\t}\n\tcTick = wrap(cTick + 1, 0, 16);\n\n\tamp = rawAmp * heldWeight;\n\tif (amp <= 0.00001) {\n\t\treturn 0, 0, heldQm;\n\t}\n\n\tinc = clip(heldFreq / srVal, 0, 0.45);\n\tph = wrap(ph + inc, 0, 1);\n\n\twPh = warp_phase(ph, warpMode, warpAmt, bendExp);\n\tfScaled = clip(wtPos01, 0, 1) * 3.0;\n\tf0 = floor(fScaled);\n\tf1 = min(3, f0 + 1);\n\tfFrac = fScaled - f0;\n\n\tidx = wPh * 2048.0;\n\ti0 = floor(idx);\n\ti1 = wrap(i0 + 1, 0, 2048);\n\tiFrac = idx - i0;\n\n\ts00 = peek(wtBuf, f0 * 2048 + i0, 0);\n\ts01 = peek(wtBuf, f0 * 2048 + i1, 0);\n\ts10 = peek(wtBuf, f1 * 2048 + i0, 0);\n\ts11 = peek(wtBuf, f1 * 2048 + i1, 0);\n\twt0 = mix(s00, s01, iFrac);\n\twt1 = mix(s10, s11, iFrac);\n\tsig = mix(wt0, wt1, fFrac);\n\n\t// Procedural Sine -> Triangle -> Saw -> Square fallback only when buffer is unbound\n\thasWt = (abs(s00) + abs(s01) + abs(s10) > 0.000001) ? 1 : 0;\n\tif (hasWt == 0) {\n\t\tpSin = sin(wPh * 6.28318530718);\n\t\tpTri = 1.0 - 4.0 * abs(wrap(wPh - 0.25, 0, 1) - 0.5);\n\t\tpSaw = 1.0 - 2.0 * wPh;\n\t\tpSqr = (wPh < 0.5) ? 0.9 : -0.9;\n\t\tsig = (fScaled <= 1.0) ? mix(pSin, pTri, fScaled) : ((fScaled <= 2.0) ? mix(pTri, pSaw, fScaled - 1.0) : mix(pSaw, pSqr, fScaled - 2.0));\n\t}\n\treturn sig * amp, amp, heldQm;\n}\n\nBuffer wt(\"percipwt\");\nBuffer scope(\"percipscope\");\n\nParam pitch(0.0);\nParam stretch(1.0);\nParam fshift(0.0);\nParam snap(1.0);\nParam scalemask(2741);\nParam gate(-42.0);\nParam decay(120.0);\nParam attack(2.5);\nParam blur(0.25);\nParam tilt(0.0);\nParam sieve(0);\nParam freeze(0);\nParam wtpos(0.0);\nParam wtmode(0);\nParam warp(0.5);\nParam resynthgain(0.0);\nParam wet(1.0);\n\nHistory tick(0);\nHistory rollCount(0);\nHistory ctrlInit(0);\nHistory gateLin(0.007943);\nHistory resGainLin(1.0);\nHistory atkCoef(0.99);\nHistory relCoef(0.999);\nHistory bendExp(1.0);\nHistory dryG(0.0);\nHistory wetG(1.0);\n\nsr = max(samplerate, 1);\n\npitchS = slew(clip(pitch, -24, 24), 0.999);\nstretchS = slew(clip(stretch, 0.5, 2.0), 0.999);\nfshiftS = slew(clip(fshift, -2000, 2000), 0.999);\nsnapS = slew(clip(snap, 0, 1), 0.999);\ngateDbS = slew(clip(gate, -66, -6), 0.999);\ndecayMsS = slew(clip(decay, 1, 1500), 0.999);\natkMsS = slew(clip(attack, 0.2, 100), 0.999);\nblurS = slew(clip(blur, 0, 1), 0.999);\ntiltS = slew(clip(tilt, -1, 1), 0.999);\nwtPosS = slew(clip(wtpos, 0, 1), 0.999);\nwarpS = slew(clip(warp, 0, 1), 0.999);\nresGainDbS = slew(clip(resynthgain, -36, 18), 0.999);\nwetS = slew(clip(wet, 0, 1), 0.999);\nmodeNow = round(clip(wtmode, 0, 3));\nsieveNow = round(clip(sieve, 0, 4));\nfreezeNow = (freeze > 0.5) ? 1 : 0;\nmaskNow = round(clip(scalemask, 0, 4095));\n\n// Update shared control-rate transcendentals every 16 samples\nif ((tick % 16 == 0) || (ctrlInit == 0)) {\n\tgateLin = pow(10, gateDbS / 20);\n\tresGainLin = pow(10, resGainDbS / 20);\n\teffAtkMs = atkMsS + blurS * 45.0;\n\teffRelMs = decayMsS + blurS * 350.0;\n\tatkCoef = exp(-1000 / (max(effAtkMs, 0.2) * sr));\n\trelCoef = exp(-1000 / (max(effRelMs, 1.0) * sr));\n\tbendExp = (modeNow == 0) ? pow(3.2, (warpS - 0.5) * 2.0) : 1.0;\n\tang = wetS * 1.57079632679;\n\tdryG = cos(ang);\n\twetG = sin(ang);\n\tctrlInit = 1;\n}\n\nmonoIn = (in1 + in2) * 0.70710678;\ndampBand = 1.0 / 7.5;\n\n// 1. Track 16 spectral bands (with idle sleep & Spectral Freeze latch)\nraw0, m0 = band_track(monoIn, 92.5,   dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw1, m1 = band_track(monoIn, 123.5,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw2, m2 = band_track(monoIn, 164.8,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw3, m3 = band_track(monoIn, 220.0,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw4, m4 = band_track(monoIn, 293.7,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw5, m5 = band_track(monoIn, 392.0,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw6, m6 = band_track(monoIn, 523.3,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw7, m7 = band_track(monoIn, 698.5,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw8, m8 = band_track(monoIn, 932.3,  dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw9, m9 = band_track(monoIn, 1244.5, dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw10, m10 = band_track(monoIn, 1661.2, dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw11, m11 = band_track(monoIn, 2217.5, dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw12, m12 = band_track(monoIn, 2960.0, dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw13, m13 = band_track(monoIn, 3951.1, dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw14, m14 = band_track(monoIn, 5274.0, dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\nraw15, m15 = band_track(monoIn, 7040.0, dampBand, atkCoef, relCoef, gateLin, freezeNow, sr);\n\n// 2. Synthesize 16 wavetable partials (skips inactive bands when gated/silent)\nv0, amp0, qm0 = voice_osc(wt, 0,  raw0,  m0,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv1, amp1, qm1 = voice_osc(wt, 1,  raw1,  m1,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv2, amp2, qm2 = voice_osc(wt, 2,  raw2,  m2,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv3, amp3, qm3 = voice_osc(wt, 3,  raw3,  m3,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv4, amp4, qm4 = voice_osc(wt, 4,  raw4,  m4,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv5, amp5, qm5 = voice_osc(wt, 5,  raw5,  m5,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv6, amp6, qm6 = voice_osc(wt, 6,  raw6,  m6,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv7, amp7, qm7 = voice_osc(wt, 7,  raw7,  m7,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv8, amp8, qm8 = voice_osc(wt, 8,  raw8,  m8,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv9, amp9, qm9 = voice_osc(wt, 9,  raw9,  m9,  pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv10, amp10, qm10 = voice_osc(wt, 10, raw10, m10, pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv11, amp11, qm11 = voice_osc(wt, 11, raw11, m11, pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv12, amp12, qm12 = voice_osc(wt, 12, raw12, m12, pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv13, amp13, qm13 = voice_osc(wt, 13, raw13, m13, pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv14, amp14, qm14 = voice_osc(wt, 14, raw14, m14, pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\nv15, amp15, qm15 = voice_osc(wt, 15, raw15, m15, pitchS, stretchS, fshiftS, maskNow, snapS, sieveNow, tiltS, wtPosS, modeNow, warpS, bendExp, sr);\n\n// Alternate stereo spread across even/odd bands and scale by the Resynthesized Partials Volume slider\nevenSum = v0 + v2 + v4 + v6 + v8 + v10 + v12 + v14;\noddSum = v1 + v3 + v5 + v7 + v9 + v11 + v13 + v15;\nhasWet = (abs(evenSum) + abs(oddSum) > 0.0000001);\nwetL = hasWet ? (tanh((evenSum * 0.78 + oddSum * 0.42) * 1.35 * resGainLin) * 0.88) : 0;\nwetR = hasWet ? (tanh((oddSum * 0.78 + evenSum * 0.42) * 1.35 * resGainLin) * 0.88) : 0;\n\n// 3. Equal-power dry/wet mix\noutL = in1 * dryG + wetL * wetG;\noutR = in2 * dryG + wetR * wetG;\n\n// 5. Write scope telemetry every 64 samples\ntick = wrap(tick + 1, 0, 64);\nif (tick == 0) {\n\trollCount = wrap(rollCount + 1, 0, 100000);\n\tpoke(scope, clip(amp0, 0, 1.5), 0, 0);\n\tpoke(scope, clip(amp1, 0, 1.5), 1, 0);\n\tpoke(scope, clip(amp2, 0, 1.5), 2, 0);\n\tpoke(scope, clip(amp3, 0, 1.5), 3, 0);\n\tpoke(scope, clip(amp4, 0, 1.5), 4, 0);\n\tpoke(scope, clip(amp5, 0, 1.5), 5, 0);\n\tpoke(scope, clip(amp6, 0, 1.5), 6, 0);\n\tpoke(scope, clip(amp7, 0, 1.5), 7, 0);\n\tpoke(scope, clip(amp8, 0, 1.5), 8, 0);\n\tpoke(scope, clip(amp9, 0, 1.5), 9, 0);\n\tpoke(scope, clip(amp10, 0, 1.5), 10, 0);\n\tpoke(scope, clip(amp11, 0, 1.5), 11, 0);\n\tpoke(scope, clip(amp12, 0, 1.5), 12, 0);\n\tpoke(scope, clip(amp13, 0, 1.5), 13, 0);\n\tpoke(scope, clip(amp14, 0, 1.5), 14, 0);\n\tpoke(scope, clip(amp15, 0, 1.5), 15, 0);\n\n\tpoke(scope, qm0, 16, 0);\n\tpoke(scope, qm1, 17, 0);\n\tpoke(scope, qm2, 18, 0);\n\tpoke(scope, qm3, 19, 0);\n\tpoke(scope, qm4, 20, 0);\n\tpoke(scope, qm5, 21, 0);\n\tpoke(scope, qm6, 22, 0);\n\tpoke(scope, qm7, 23, 0);\n\tpoke(scope, qm8, 24, 0);\n\tpoke(scope, qm9, 25, 0);\n\tpoke(scope, qm10, 26, 0);\n\tpoke(scope, qm11, 27, 0);\n\tpoke(scope, qm12, 28, 0);\n\tpoke(scope, qm13, 29, 0);\n\tpoke(scope, qm14, 30, 0);\n\tpoke(scope, qm15, 31, 0);\n\n\toutPk = max(abs(wetL), abs(wetR));\n\tactiveN = (amp0 > 0.002) + (amp1 > 0.002) + (amp2 > 0.002) + (amp3 > 0.002) +\n\t          (amp4 > 0.002) + (amp5 > 0.002) + (amp6 > 0.002) + (amp7 > 0.002) +\n\t          (amp8 > 0.002) + (amp9 > 0.002) + (amp10 > 0.002) + (amp11 > 0.002) +\n\t          (amp12 > 0.002) + (amp13 > 0.002) + (amp14 > 0.002) + (amp15 > 0.002);\n\tpoke(scope, outPk, 32, 0);\n\tpoke(scope, activeN, 33, 0);\n\tpoke(scope, gateLin, 34, 0);\n\tpoke(scope, rollCount, 35, 0);\n}\n\nout1 = fixnan(outL);\nout2 = fixnan(outR);\n",
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
						200.0,
						300.0,
						80.0
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
						300.0,
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
					"text": "js /Users/mrwilson/software/ableton/tests/percipitator_probe.js sine"
				}
			},
			{
				"box": {
					"id": "obj-tone",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						200.0,
						85.0,
						20.0
					],
					"text": "cycle~ 1760.0"
				}
			},
			{
				"box": {
					"id": "obj-gain",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						240.0,
						65.0,
						20.0
					],
					"text": "*~ 0.25"
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
						"obj-recsize",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-recsize",
						0
					],
					"destination": [
						"obj-recbuf",
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
						"obj-analyze",
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
						"obj-tone",
						0
					],
					"destination": [
						"obj-gain",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-gain",
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
						"obj-gain",
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
						"obj-gain",
						0
					],
					"destination": [
						"obj-peak-c",
						0
					]
				}
			}
		]
	}
}
