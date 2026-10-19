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
			980.0,
			520.0
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
					"text": "delay 1100"
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
						80.0,
						20.0
					],
					"text": "delay 220"
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
					"id": "obj-trig-msg",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						110.0,
						170.0,
						220.0,
						20.0
					],
					"text": "slice 0, trigcount 1"
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
						210.0,
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
						245.0,
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
						280.0,
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
						315.0,
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
						315.0,
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
						365.0,
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
						220.0,
						30.0,
						620.0,
						20.0
					],
					"text": "speed 0.2, grainsize 38, morph 0.3, trans 0.5, jitter 0, combmix 0.85, combfbk 0.92, pitch 0, crush 0, wet 1, keymode 0, midi_note 60, gate 1, rev 0, capture 0"
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
						60.0,
						330.0,
						20.0
					],
					"text": "setbuffer #0-gssample #0-gsslices #0-gsstate"
				}
			},
			{
				"box": {
					"id": "obj-samp",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"float",
						"bang"
					],
					"patching_rect": [
						560.0,
						95.0,
						200.0,
						20.0
					],
					"text": "buffer~ #0-gssample 2000 2"
				}
			},
			{
				"box": {
					"id": "obj-slices",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"float",
						"bang"
					],
					"patching_rect": [
						560.0,
						125.0,
						210.0,
						20.0
					],
					"text": "buffer~ #0-gsslices @samps 512"
				}
			},
			{
				"box": {
					"id": "obj-state",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"float",
						"bang"
					],
					"patching_rect": [
						560.0,
						155.0,
						200.0,
						20.0
					],
					"text": "buffer~ #0-gsstate @samps 16"
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
						560.0,
						185.0,
						160.0,
						20.0
					],
					"text": "buffer~ rec 4000 2"
				}
			},
			{
				"box": {
					"code": "// Better GrainSpec \u2014 Real-time Transient-Preserving Granular + Spectral Stretch & Comb Engine.\n// Buffers bound via loadbang message: `samp #0-gssample, slices #0-gsslices, state #0-gsstate`\n//   samp   (#0-gssample): 2-channel stereo audio buffer (up to 8s)\n//   slices (#0-gsslices): 512 floats = 128 slices * 4 [startFrame, endFrame, transientFrames, pitchHz]\n//   state  (#0-gsstate):  16 floats telemetry for v8ui visualization:\n//     0: normalized slice playhead (0..1)\n//     1: active slice index\n//     2..5: grain 0..3 normalized positions within slice (0..1)\n//     6..9: grain 0..3 envelope levels (0..1)\n//     10: output envelope (0..1)\n//     11: transient punch envelope (0..1)\n//     12: capture write head (0..1)\n//     13: voice active gate (0..1)\n//     14: current comb frequency Hz\n//     15: current playback pitch ratio\n//\n// GenExpr ordering rules:\n// 1. All functions must precede Buffer, Param, History, and Delay declarations.\n// 2. All Delay and History declarations must precede expression statements.\n// 3. Never use identifiers matching Euler's constant followed by digits.\n\nslew(target, coef) {\n\tHistory s(0);\n\tHistory init(0);\n\ts = (init == 0) ? target : mix(target, s, coef);\n\tinit = 1;\n\treturn s;\n}\n\nlp1(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn s;\n}\n\nhp1(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn x - s;\n}\n\nfollow(x) {\n\tHistory s(0);\n\tax = abs(x);\n\ts = mix(ax, s, (ax > s) ? 0.45 : 0.992);\n\treturn s;\n}\n\nnoiseHash(seedVal) {\n\tHistory st(0.173);\n\tst = fract(sin(st * 127.1 + seedVal * 311.7 + 19.19) * 43758.5453);\n\treturn st * 2 - 1;\n}\n\nhannWin(ph) {\n\tp = clip(ph, 0, 1);\n\treturn 0.5 - 0.5 * cos(p * 6.283185307179586);\n}\n\n// Resonant bandpass / formant filter for spectral stretch bank\nresonBand(x, freqHz, rPole) {\n\tHistory y1(0);\n\tHistory y2(0);\n\tw = clip(freqHz, 35, samplerate * 0.42) * 6.283185307179586 / max(samplerate, 1);\n\tr = clip(rPole, 0.5, 0.996);\n\tb0 = (1 - r * r) * 0.5;\n\ty = b0 * (x - y2) + 2 * r * cos(w) * y1 - (r * r) * y2;\n\ty2 = y1;\n\ty1 = clip(fixnan(y), -4, 4);\n\treturn y1;\n}\n\n// Per-loop feedback gain for pitch-matching comb filter.\n// combfbk 0 -> 0 recirculation; combfbk 1 -> ~6 seconds RT60, always < 1.\ncombLoopGain(delaySamps, fbk01) {\n\tk = clip(fbk01, 0, 1);\n\tsecs = max(delaySamps, 1) / max(samplerate, 1);\n\trt = max(k * 6.5, 0.015);\n\tg = exp(-6.90775527898 * secs / rt);\n\tquiet = (k < 0.001) ? 0 : g;\n\treturn clip(quiet, 0, 0.9985);\n}\n\nBuffer samp(\"gssample\");\nBuffer slices(\"gsslices\");\nBuffer state(\"gsstate\");\n\nParam speed(0.25);\nParam grainsize(38);\nParam morph(0.35);\nParam trans(0.75);\nParam jitter(0.15);\nParam pitch(0);\nParam combmix(0.30);\nParam combfbk(0.55);\nParam crush(0);\nParam wet(1.0);\nParam slice(0);\nParam trigcount(0);\nParam keymode(0);\nParam midi_note(60);\nParam gate(1);\nParam rev(0);\nParam capture(0);\n\nHistory prevTrig(0);\nHistory prevCap(0);\nHistory ageSamps(99999999);\nHistory bodyPos(0);\nHistory capWrite(0);\nHistory gPh(0);\nHistory gJit0(0);\nHistory gJit1(0);\nHistory gJit2(0);\nHistory gJit3(0);\nHistory gBase0(0);\nHistory gBase1(0);\nHistory gBase2(0);\nHistory gBase3(0);\nHistory specPh0(0);\nHistory specPh1(0);\nHistory specBase0(0);\nHistory specBase1(0);\nHistory crushHoldL(0);\nHistory crushHoldR(0);\nHistory crushCnt(0);\nHistory tick(0);\nHistory activeVoice(0);\nHistory cOutL(0);\nHistory cOutR(0);\n\nDelay combDL(4096);\nDelay combDR(4096);\n\nsr = max(samplerate, 1);\nsampFrames = dim(samp);\nsliceTableFrames = dim(slices);\n\n// Smooth user controls\nspeedS = slew(clip(speed, -2, 2), 0.998);\ngrainMsS = slew(clip(grainsize, 4, 250), 0.998);\nmorphS = slew(clip(morph, 0, 1), 0.998);\ntransS = slew(clip(trans, 0, 1), 0.998);\njitterS = slew(clip(jitter, 0, 1), 0.998);\npitchSemiS = slew(clip(pitch, -24, 24), 0.998);\ncombMixS = slew(clip(combmix, 0, 1), 0.998);\ncombFbkS = slew(clip(combfbk, 0, 1), 0.998);\ncrushS = slew(clip(crush, 0, 1), 0.998);\nwetS = slew(clip(wet, 0, 1), 0.998);\n\n// Live Audio Capture into Buffer samp when capture > 0.5\ncapOn = (capture > 0.5) && (sampFrames > 64);\nif (capOn) {\n\tif (prevCap <= 0.5) {\n\t\tcapWrite = 0;\n\t}\n\tpoke(samp, in1, capWrite, 0, 0);\n\tpoke(samp, in2, capWrite, 1, 0);\n\tcapWrite = wrap(capWrite + 1, 0, max(sampFrames, 1));\n}\nprevCap = capture;\n\n// Read slice metadata from #0-gsslices\nsliceIdx = clip(floor(slice), 0, 127);\nbaseIdx = sliceIdx * 4;\nhasSlices = (sliceTableFrames >= 4) && (sampFrames > 64);\n\nrawStart = hasSlices ? peek(slices, baseIdx + 0, 0) : 0;\nrawEnd = hasSlices ? peek(slices, baseIdx + 1, 0) : 0;\nrawTrans = hasSlices ? peek(slices, baseIdx + 2, 0) : 1024;\nrawHz = hasSlices ? peek(slices, baseIdx + 3, 0) : 110;\n\nsStart = clip(rawStart, 0, max(sampFrames - 2, 0));\nsEnd = clip(rawEnd, sStart + 1, max(sampFrames - 1, 1));\nsSpan = max(sEnd - sStart, 1);\nsliceValid = hasSlices && (rawEnd > rawStart);\n\n// Pitch & Comb Frequency resolution\nnoteSemi = (keymode > 0.5) ? (midi_note - 60) : 0;\ntotalSemi = pitchSemiS + noteSemi;\npitchRatio = pow(2, totalSemi / 12);\npitchRatio = clip(pitchRatio, 0.125, 8.0);\nbaseSliceHz = clip(rawHz > 20 ? rawHz : 110, 35, 2000);\ntargetCombHz = clip(baseSliceHz * pitchRatio, 32, 3800);\n\n// Trigger detection (fires whenever trigcount changes)\nisTrig = (trigcount != prevTrig) && (trigcount > 0);\nprevTrig = trigcount;\n\nif (isTrig && sliceValid) {\n\tageSamps = 0;\n\tactiveVoice = 1;\n\tbodyPos = (rev > 0.5) ? max(sSpan - 1, 0) : 0;\n\tgPh = 0;\n\tgBase0 = bodyPos;\n\tgBase1 = bodyPos;\n\tgBase2 = bodyPos;\n\tgBase3 = bodyPos;\n\tgJit0 = 0;\n\tgJit1 = 0;\n\tgJit2 = 0;\n\tgJit3 = 0;\n\tspecPh0 = 0;\n\tspecPh1 = 0.5;\n\tspecBase0 = bodyPos;\n\tspecBase1 = bodyPos;\n}\n\n// Transient preservation window length in frames (0..75 ms scaled by Trans dial)\ntransMaxSamps = min(max(rawTrans, sr * 0.012), sSpan * 0.65);\ntransLenSamps = clip(transMaxSamps * transS * 1.35, 0, sSpan * 0.8);\nxfadeSamps = max(sr * 0.005, 64);\n\n// Direct 1:1 unstretched transient reader (preserves full drum punch at slice start)\ntransReadOffset = (rev > 0.5) ? max(sSpan - 1 - ageSamps, 0) : min(ageSamps, sSpan - 1);\ntransFrame = clip(sStart + transReadOffset, sStart, sEnd);\ntransL = sliceValid ? peek(samp, transFrame, 0, interp=\"linear\") : 0;\ntransR = sliceValid ? peek(samp, transFrame, 1, interp=\"linear\") : transL;\n\n// Raised-cosine crossfade from transient (1.0) to stretched body (0.0)\ntransEnv = (transLenSamps < 16) ? 0 : clip(1 - (ageSamps - transLenSamps) / xfadeSamps, 0, 1);\ntransGain = sin(transEnv * 1.57079632679);\nbodyGain = cos(transEnv * 1.57079632679);\n\n// Advance master body playhead within the slice\nbodyRegionStart = min(transLenSamps * 0.5, max(sSpan - 32, 0));\nbodyRegionSpan = max(sSpan - bodyRegionStart, 1);\ndirSign = (rev > 0.5) ? -1 : 1;\nwalkJit = noiseHash(ageSamps * 0.013) * jitterS * 1.75;\nstepRate = speedS * dirSign + walkJit;\nbodyPos = wrap(bodyPos + stepRate, 0, bodyRegionSpan);\nmasterOffset = bodyRegionStart + bodyPos;\n\n// ============================================================================\n// 1. 4-Voice Overlapping Hann Granular Engine\n// ============================================================================\ngrainSamps = max(grainMsS * sr / 1000, 64);\ngrainFreq = 1 / grainSamps;\noldPh = gPh;\ngPh = wrap(gPh + grainFreq, 0, 1);\n\nph0 = gPh;\nph1 = fract(gPh + 0.25);\nph2 = fract(gPh + 0.50);\nph3 = fract(gPh + 0.75);\n\n// Latch a fresh grain start position + random jitter when each grain wraps phase\nwrap0 = (ph0 < grainFreq * 1.5);\nwrap1 = (ph1 < grainFreq * 1.5);\nwrap2 = (ph2 < grainFreq * 1.5);\nwrap3 = (ph3 < grainFreq * 1.5);\n\njitRange = jitterS * sSpan * 0.38;\nif (wrap0) {\n\tgBase0 = masterOffset;\n\tgJit0 = noiseHash(ageSamps + 1.1) * jitRange;\n}\nif (wrap1) {\n\tgBase1 = masterOffset;\n\tgJit1 = noiseHash(ageSamps + 2.3) * jitRange;\n}\nif (wrap2) {\n\tgBase2 = masterOffset;\n\tgJit2 = noiseHash(ageSamps + 3.7) * jitRange;\n}\nif (wrap3) {\n\tgBase3 = masterOffset;\n\tgJit3 = noiseHash(ageSamps + 5.1) * jitRange;\n}\n\nw0 = hannWin(ph0);\nw1 = hannWin(ph1);\nw2 = hannWin(ph2);\nw3 = hannWin(ph3);\n\npos0 = sStart + wrap(gBase0 + gJit0 + ph0 * grainSamps * pitchRatio * dirSign, 0, sSpan);\npos1 = sStart + wrap(gBase1 + gJit1 + ph1 * grainSamps * pitchRatio * dirSign, 0, sSpan);\npos2 = sStart + wrap(gBase2 + gJit2 + ph2 * grainSamps * pitchRatio * dirSign, 0, sSpan);\npos3 = sStart + wrap(gBase3 + gJit3 + ph3 * grainSamps * pitchRatio * dirSign, 0, sSpan);\n\ng0L = sliceValid ? peek(samp, pos0, 0, interp=\"linear\") * w0 : 0;\ng0R = sliceValid ? peek(samp, pos0, 1, interp=\"linear\") * w0 : 0;\ng1L = sliceValid ? peek(samp, pos1, 0, interp=\"linear\") * w1 : 0;\ng1R = sliceValid ? peek(samp, pos1, 1, interp=\"linear\") * w1 : 0;\ng2L = sliceValid ? peek(samp, pos2, 0, interp=\"linear\") * w2 : 0;\ng2R = sliceValid ? peek(samp, pos2, 1, interp=\"linear\") * w2 : 0;\ng3L = sliceValid ? peek(samp, pos3, 0, interp=\"linear\") * w3 : 0;\ng3R = sliceValid ? peek(samp, pos3, 1, interp=\"linear\") * w3 : 0;\n\n// Hann overlap-add of 4 streams at 0.25 spacing sums to constant amplitude 2.0 -> scale by 0.5\ngranL = (g0L + g1L + g2L + g3L) * 0.55;\ngranR = (g0R + g1R + g2R + g3R) * 0.55;\n\n// ============================================================================\n// 2. Spectral / Phase-Locked Monophonic-Harmonic Stretch Engine\n// ============================================================================\n// Locks window period to an integer multiple of the slice's fundamental wavelength\n// so adjacent windows stay phase-coherent (\"Gantz Graf\" metallic / robotic sustain),\n// then passes through a harmonic resonant filter bank tuned to 1x, 2x, 3x, 5x f0.\nfundPeriod = clip(sr / max(targetCombHz, 35), 12, 2048);\ncyclesInWin = max(round(grainSamps / fundPeriod), 2);\nspecWinSamps = clip(cyclesInWin * fundPeriod, 64, 16384);\nspecStep = 1 / specWinSamps;\n\nspecPh0 = wrap(specPh0 + specStep, 0, 1);\nspecPh1 = fract(specPh0 + 0.5);\n\nif (specPh0 < specStep * 1.5) {\n\t// Quantize window anchor to integer multiples of fundamental period for phase coherence\n\tqOff0 = round((masterOffset + noiseHash(ageSamps + 7.7) * jitRange * 0.25) / fundPeriod) * fundPeriod;\n\tspecBase0 = wrap(qOff0, 0, sSpan);\n}\nif (specPh1 < specStep * 1.5) {\n\tqOff1 = round((masterOffset + noiseHash(ageSamps + 9.3) * jitRange * 0.25) / fundPeriod) * fundPeriod;\n\tspecBase1 = wrap(qOff1, 0, sSpan);\n}\n\nsw0 = hannWin(specPh0);\nsw1 = hannWin(specPh1);\n\nsPos0 = sStart + wrap(specBase0 + wrap(specPh0 * specWinSamps * pitchRatio * dirSign, 0, fundPeriod * 2), 0, sSpan);\nsPos1 = sStart + wrap(specBase1 + wrap(specPh1 * specWinSamps * pitchRatio * dirSign, 0, fundPeriod * 2), 0, sSpan);\n\nsp0L = sliceValid ? peek(samp, sPos0, 0, interp=\"linear\") * sw0 : 0;\nsp0R = sliceValid ? peek(samp, sPos0, 1, interp=\"linear\") * sw0 : 0;\nsp1L = sliceValid ? peek(samp, sPos1, 0, interp=\"linear\") * sw1 : 0;\nsp1R = sliceValid ? peek(samp, sPos1, 1, interp=\"linear\") * sw1 : 0;\n\nrawSpecL = sp0L + sp1L;\nrawSpecR = sp0R + sp1R;\n\n// Harmonic spectral bank (1x, 2x, 3x, 5x fundamental) + phase-locked core\nband1L = resonBand(rawSpecL, targetCombHz, 0.965);\nband2L = resonBand(rawSpecL, targetCombHz * 2, 0.96);\nband3L = resonBand(rawSpecL, targetCombHz * 3, 0.955);\nband5L = resonBand(rawSpecL, targetCombHz * 5, 0.95);\n\nband1R = resonBand(rawSpecR, targetCombHz, 0.965);\nband2R = resonBand(rawSpecR, targetCombHz * 2.01, 0.96);\nband3R = resonBand(rawSpecR, targetCombHz * 2.99, 0.955);\nband5R = resonBand(rawSpecR, targetCombHz * 5.02, 0.95);\n\nspecL = tanh(rawSpecL * 0.55 + (band1L * 0.45 + band2L * 0.35 + band3L * 0.25 + band5L * 0.18) * 1.6);\nspecR = tanh(rawSpecR * 0.55 + (band1R * 0.45 + band2R * 0.35 + band3R * 0.25 + band5R * 0.18) * 1.6);\n\n// Equal-power crossfade between Granular (morph=0) and Spectral (morph=1)\nmAng = morphS * 1.57079632679;\ngranG = cos(mAng);\nspecG = sin(mAng);\nstretchedL = granL * granG + specL * specG;\nstretchedR = granR * granG + specR * specG;\n\n// Combine preserved transient punch with stretched granular/spectral body\n// If speed == 1 and morph == 0 and jitter == 0, keep continuous body after transient\nvoiceActive = sliceValid && (activeVoice > 0.5) && (gate > 0.01);\nvoiceGain = voiceActive ? clip(gate, 0, 1.5) : 0;\n\ncombinedL = (transL * transGain + stretchedL * bodyGain) * voiceGain;\ncombinedR = (transR * transGain + stretchedR * bodyGain) * voiceGain;\n\n// ============================================================================\n// 3. Pitch-Matching Stereo Comb Filter\n// ============================================================================\ncombDelaySamps = clip(sr / targetCombHz, 8, 4000);\ncGain = combLoopGain(combDelaySamps, combFbkS);\ndampCoef = 0.18;\n\ncTapL = combDL.read(combDelaySamps, interp=\"linear\");\ncTapR = combDR.read(combDelaySamps * 1.003, interp=\"linear\");\n\ncFiltL = lp1(cTapL, dampCoef);\ncFiltR = lp1(cTapR, dampCoef);\n\ncInL = tanh(combinedL + cFiltL * cGain);\ncInR = tanh(combinedR + cFiltR * cGain);\ncombDL.write(cInL);\ncombDR.write(cInR);\n\ncOutL = cInL;\ncOutR = cInR;\n\npostCombL = mix(combinedL, cOutL, combMixS);\npostCombR = mix(combinedR, cOutR, combMixS);\n\n// ============================================================================\n// 4. Hyperglitch Sample-Rate & Bit Crush Stage\n// ============================================================================\ncrushStep = 1 + floor(pow(crushS, 1.8) * 42);\ncrushCnt = crushCnt + 1;\nif (crushCnt >= crushStep) {\n\tcrushCnt = 0;\n\tlevels = max(8, pow(2, 12 - crushS * 8.5));\n\tcrushHoldL = (crushS > 0.01) ? (round(postCombL * levels) / levels) : postCombL;\n\tcrushHoldR = (crushS > 0.01) ? (round(postCombR * levels) / levels) : postCombR;\n}\nwetOutL = (crushS > 0.01) ? crushHoldL : postCombL;\nwetOutR = (crushS > 0.01) ? crushHoldR : postCombR;\n\n// Advance slice age counter\nif (voiceActive) {\n\tageSamps = min(ageSamps + 1, 99999999);\n\t// When playing normal unstretched 1x with high speed and no sustain hold,\n\t// keep looping within the slice while gate is held.\n}\n\n// ============================================================================\n// 5. Audio-Reactive Visual Telemetry (Buffer state / #0-gsstate)\n// ============================================================================\nenvG0 = follow((g0L + g0R) * 0.5);\nenvG1 = follow((g1L + g1R) * 0.5);\nenvG2 = follow((g2L + g2R) * 0.5);\nenvG3 = follow((g3L + g3R) * 0.5);\nenvOut = follow(wetOutL * 0.5 + wetOutR * 0.5);\nenvTr = follow(transL * transGain);\n\nnormPlayhead = sliceValid ? clip(masterOffset / sSpan, 0, 1) : 0;\nnormG0 = sliceValid ? clip((pos0 - sStart) / sSpan, 0, 1) : 0;\nnormG1 = sliceValid ? clip((pos1 - sStart) / sSpan, 0, 1) : 0;\nnormG2 = sliceValid ? clip((pos2 - sStart) / sSpan, 0, 1) : 0;\nnormG3 = sliceValid ? clip((pos3 - sStart) / sSpan, 0, 1) : 0;\nnormCap = (sampFrames > 0) ? (capWrite / sampFrames) : 0;\n\ntick = wrap(tick + 1, 0, 32);\nif (tick == 0) {\n\tpoke(state, normPlayhead, 0, 0);\n\tpoke(state, sliceIdx, 1, 0);\n\tpoke(state, normG0, 2, 0);\n\tpoke(state, normG1, 3, 0);\n\tpoke(state, normG2, 4, 0);\n\tpoke(state, normG3, 5, 0);\n\tpoke(state, envG0, 6, 0);\n\tpoke(state, envG1, 7, 0);\n\tpoke(state, envG2, 8, 0);\n\tpoke(state, envG3, 9, 0);\n\tpoke(state, envOut, 10, 0);\n\tpoke(state, envTr, 11, 0);\n\tpoke(state, normCap, 12, 0);\n\tpoke(state, voiceActive ? 1 : 0, 13, 0);\n\tpoke(state, targetCombHz, 14, 0);\n\tpoke(state, pitchRatio, 15, 0);\n}\n\nwAng = wetS * 1.57079632679;\ndryGain = cos(wAng);\nwetGain = sin(wAng);\n\nout1 = fixnan(clip(in1 * dryGain + wetOutL * wetGain, -1.5, 1.5));\nout2 = fixnan(clip(in2 * dryGain + wetOutR * wetGain, -1.5, 1.5));\n",
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
						220.0,
						180.0,
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
						220.0,
						285.0,
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
						220.0,
						325.0,
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
						300.0,
						325.0,
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
						325.0,
						70.0,
						20.0
					],
					"text": "peakamp~"
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
						720.0,
						220.0,
						80.0,
						20.0
					],
					"text": "cycle~ 220"
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
						720.0,
						255.0,
						60.0,
						20.0
					],
					"text": "*~ 0.25"
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
						220.0,
						365.0,
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
						280.0,
						365.0,
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
						220.0,
						405.0,
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
						220.0,
						445.0,
						380.0,
						20.0
					],
					"text": "js /Users/mrwilson/software/ableton/tests/grainspec_probe.js comb_pitch"
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
						220.0,
						95.0,
						330.0,
						20.0
					],
					"text": "samp #0-gssample, slices #0-gsslices, state #0-gsstate"
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
						"obj-trig-msg",
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
						"obj-trig-msg",
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
			}
		]
	}
}
