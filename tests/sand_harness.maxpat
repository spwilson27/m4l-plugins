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
					"text": "delay 800"
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
					"text": "delay 200"
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
					"text": "delay 250"
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
						110.0,
						20.0
					],
					"text": "analyze 250"
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
						760.0,
						20.0
					],
					"text": "amount 0, stages 1, dorder 0, soft 0, debrick 0, ftype 0, ffreq 18000, fpos 2, mix 100, outmode 0, mix 100, dorder 0, amount 0, ftype 0, ffreq 400, fpos 1, outmode 0"
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
						180.0,
						20.0
					],
					"text": "setbuffer #0-sandwave"
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
						160.0,
						20.0
					],
					"text": "wave #0-sandwave"
				}
			},
			{
				"box": {
					"id": "obj-wave",
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
						180.0,
						20.0
					],
					"text": "buffer~ #0-sandwave 100 2"
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
						140.0,
						140.0,
						20.0
					],
					"text": "buffer~ rec 2000 2"
				}
			},
			{
				"box": {
					"code": "// Sand \u2014 differential compander.\n// The wet path differentiates (or integrates) the input, then expands quiet\n// parts of that signal and soft-limits the peaks. Order 0 is the raw signal.\n// Order -1 integrates. Orders 1..15 cascade a differentiator whose gain is\n// at most 1, at Nyquist (nrm = 0.5). Higher orders keep only the top of the\n// spectrum without amplifying float rounding error into a full-scale oscillation.\n// Amount is 0..140 dB of extra quiet-lift.\n//\n// Maintenance invariants for future contributors:\n// 1. GenExpr requires every function before Buffer, Param, and assignments.\n// 2. Do not name a variable \"e\" followed by digits: the lexer reads that as Euler's constant.\n// 3. Keep p1..p15 and q1..q15 unrolled inside channel() so each derivative stage\n//    gets its own independent History state per channel() call site (L/R), and\n//    q1..q15 suppress the sample-0 startup impulse.\n// 4. Buffer wave(\"sandwave\") memory map (2 channels, bound via `wave #0-sandwave`):\n//    - frames 0..127:   ch 0 = out1 (L), ch 1 = out2 (R) circular ring buffer\n//    - frames 128..255: ch 0 = mono dry input, ch 1 = mono wet grit\n//    - frames 256..259: ch 0 = [pkIn, pkWet, pkOut, wpos] telemetry for v8ui scope\n\nslew(target, coef) {\n\tHistory sw(0);\n\tHistory swinit(0);\n\tsw = (swinit == 0) ? target : mix(target, sw, coef);\n\tswinit = 1;\n\treturn sw;\n}\n\ninteg(x) {\n\tHistory ig(0);\n\tcoef = exp(-6.28318530718 * 8 / samplerate);\n\tig = coef * ig + (1 - coef) * x * 125;\n\treturn clip(ig, -8, 8);\n}\n\ncompand(x, amt01, soft01, brick01) {\n\tHistory en(0);\n\tax = abs(x);\n\tsoft = clip(soft01, 0, 1);\n\tatk = mix(0.15, 0.7, soft);\n\trel = mix(0.98, 0.9997, soft);\n\ten = mix(ax, en, (ax > en) ? atk : rel);\n\tmaxG = exp(clip(amt01, 0, 1) * 16.11809565095832);\n\tknee = mix(0.03, 0.45, soft);\n\tquiet = knee / max(knee + en, 1e-8);\n\tg = 1 + (maxG - 1) * quiet;\n\ty = x * g;\n\thard = clip(y, -1.2, 1.2);\n\tshaped = mix(hard, tanh(y), soft);\n\tmild = tanh(x * mix(8, 1.5, soft));\n\treturn mix(shaped, mild, clip(brick01, 0, 1));\n}\n\nfilt(x, freq, mode) {\n\tHistory fs(0);\n\tHistory fb(0);\n\tc = exp(-6.28318530718 * clip(freq, 20, 18000) / samplerate);\n\tfs = mix(x, fs, c);\n\thigh = x - fs;\n\tfb = mix(high, fb, c);\n\tlow = fs;\n\tband = fb;\n\treturn (mode < 0.5) ? low : ((mode < 1.5) ? band : high);\n}\n\nlimit(x) {\n\tHistory le(0);\n\tax = abs(x);\n\tle = (ax > le) ? ax : mix(ax, le, 0.9995);\n\tg = 0.89 / max(le, 0.89);\n\treturn x * g;\n}\n\n// fpos 0 filters the input, 1 filters the derivative, 2 filters the companded wet.\nchannel(x, ord, stg, amt01, soft01, brick01, freq, ftype, fpos) {\n\tHistory p1(0); History q1(0);\n\tHistory p2(0); History q2(0);\n\tHistory p3(0); History q3(0);\n\tHistory p4(0); History q4(0);\n\tHistory p5(0); History q5(0);\n\tHistory p6(0); History q6(0);\n\tHistory p7(0); History q7(0);\n\tHistory p8(0); History q8(0);\n\tHistory p9(0); History q9(0);\n\tHistory p10(0); History q10(0);\n\tHistory p11(0); History q11(0);\n\tHistory p12(0); History q12(0);\n\tHistory p13(0); History q13(0);\n\tHistory p14(0); History q14(0);\n\tHistory p15(0); History q15(0);\n\tpreOn = (fpos < 0.5) ? 1 : 0;\n\tsrc = (preOn > 0.5) ? filt(x, freq, ftype) : x;\n\td0 = src;\n\tnrm = 0.5;\n\td1 = (q1 == 0) ? 0 : clip((d0 - p1) * nrm, -8, 8); p1 = d0; q1 = 1;\n\td2 = (q2 == 0) ? 0 : clip((d1 - p2) * nrm, -8, 8); p2 = d1; q2 = 1;\n\td3 = (q3 == 0) ? 0 : clip((d2 - p3) * nrm, -8, 8); p3 = d2; q3 = 1;\n\td4 = (q4 == 0) ? 0 : clip((d3 - p4) * nrm, -8, 8); p4 = d3; q4 = 1;\n\td5 = (q5 == 0) ? 0 : clip((d4 - p5) * nrm, -8, 8); p5 = d4; q5 = 1;\n\td6 = (q6 == 0) ? 0 : clip((d5 - p6) * nrm, -8, 8); p6 = d5; q6 = 1;\n\td7 = (q7 == 0) ? 0 : clip((d6 - p7) * nrm, -8, 8); p7 = d6; q7 = 1;\n\td8 = (q8 == 0) ? 0 : clip((d7 - p8) * nrm, -8, 8); p8 = d7; q8 = 1;\n\td9 = (q9 == 0) ? 0 : clip((d8 - p9) * nrm, -8, 8); p9 = d8; q9 = 1;\n\td10 = (q10 == 0) ? 0 : clip((d9 - p10) * nrm, -8, 8); p10 = d9; q10 = 1;\n\td11 = (q11 == 0) ? 0 : clip((d10 - p11) * nrm, -8, 8); p11 = d10; q11 = 1;\n\td12 = (q12 == 0) ? 0 : clip((d11 - p12) * nrm, -8, 8); p12 = d11; q12 = 1;\n\td13 = (q13 == 0) ? 0 : clip((d12 - p13) * nrm, -8, 8); p13 = d12; q13 = 1;\n\td14 = (q14 == 0) ? 0 : clip((d13 - p14) * nrm, -8, 8); p14 = d13; q14 = 1;\n\td15 = (q15 == 0) ? 0 : clip((d14 - p15) * nrm, -8, 8); p15 = d14; q15 = 1;\n\tbody = (ord < -0.5) ? integ(src) : d0;\n\tbody = (ord > 0.5) ? d1 : body;\n\tbody = (ord > 1.5) ? d2 : body;\n\tbody = (ord > 2.5) ? d3 : body;\n\tbody = (ord > 3.5) ? d4 : body;\n\tbody = (ord > 4.5) ? d5 : body;\n\tbody = (ord > 5.5) ? d6 : body;\n\tbody = (ord > 6.5) ? d7 : body;\n\tbody = (ord > 7.5) ? d8 : body;\n\tbody = (ord > 8.5) ? d9 : body;\n\tbody = (ord > 9.5) ? d10 : body;\n\tbody = (ord > 10.5) ? d11 : body;\n\tbody = (ord > 11.5) ? d12 : body;\n\tbody = (ord > 12.5) ? d13 : body;\n\tbody = (ord > 13.5) ? d14 : body;\n\tbody = (ord > 14.5) ? d15 : body;\n\tmidOn = (fpos > 0.5) ? ((fpos < 1.5) ? 1 : 0) : 0;\n\tmid = (midOn > 0.5) ? filt(body, freq, ftype) : body;\n\tc1 = compand(mid, amt01, soft01, brick01);\n\tc2 = compand(c1, amt01, soft01, brick01);\n\tc3 = compand(c2, amt01, soft01, brick01);\n\tc4 = compand(c3, amt01, soft01, brick01);\n\twet = (stg < 1.5) ? c1 : ((stg < 2.5) ? c2 : ((stg < 3.5) ? c3 : c4));\n\tpostOn = (fpos > 1.5) ? 1 : 0;\n\treturn (postOn > 0.5) ? filt(wet, freq, ftype) : wet;\n}\n\nBuffer wave(\"sandwave\");\n\nParam amount(18);\nParam stages(1);\nParam dorder(1);\nParam soft(35);\nParam debrick(0);\nParam ftype(0);\nParam ffreq(14000);\nParam fpos(2);\nParam mix(50);\nParam outmode(0);\n\nHistory hop(0);\nHistory wpos(0);\nHistory pkIn(0);\nHistory pkWet(0);\nHistory pkOut(0);\n\namountS = slew(amount, 0.999);\nsoftS = slew(soft, 0.999);\nbrickS = slew(debrick, 0.999);\nfreqS = slew(ffreq, 0.9992);\nmixS = slew(mix, 0.999);\n\namt01 = clip(amountS, 0, 140) / 140;\nsoft01 = clip(softS, 0, 100) / 100;\nbrick01 = clip(brickS, 0, 100) / 100;\nordN = clip(dorder, -1, 15);\nstgN = clip(stages, 1, 4);\nfreqN = clip(freqS, 20, 18000);\ntypeN = clip(ftype, 0, 2);\nposN = clip(fpos, 0, 2);\n\nwetL = channel(in1, ordN, stgN, amt01, soft01, brick01, freqN, typeN, posN);\nwetR = channel(in2, ordN, stgN, amt01, soft01, brick01, freqN, typeN, posN);\n\nang = clip(mixS, 0, 100) / 100 * 1.57079632679;\ndryG = cos(ang);\nwetG = sin(ang);\nmixL = in1 * dryG + wetL * wetG;\nmixR = in2 * dryG + wetR * wetG;\n\nlimL = limit(mixL);\nlimR = limit(mixR);\nmode = clip(outmode, 0, 2);\nout1 = (mode < 0.5) ? mixL : ((mode < 1.5) ? clip(mixL, -1, 1) : limL);\nout2 = (mode < 0.5) ? mixR : ((mode < 1.5) ? clip(mixR, -1, 1) : limR);\nout1 = fixnan(out1);\nout2 = fixnan(out2);\n\ninAbs = max(abs(in1), abs(in2));\nwetAbs = max(abs(wetL), abs(wetR));\noutAbs = max(abs(out1), abs(out2));\npkIn = max(inAbs, pkIn * 0.996);\npkWet = max(wetAbs, pkWet * 0.996);\npkOut = max(outAbs, pkOut * 0.996);\n\nhop = wrap(hop + 1, 0, 32);\nif (hop == 0) {\n\tpoke(wave, out1, wpos, 0);\n\tpoke(wave, out2, wpos, 1);\n\tpoke(wave, 0.5 * (in1 + in2), 128 + wpos, 0);\n\tpoke(wave, 0.5 * (wetL + wetR), 128 + wpos, 1);\n\tpoke(wave, pkIn, 256, 0);\n\tpoke(wave, pkWet, 257, 0);\n\tpoke(wave, pkOut, 258, 0);\n\tpoke(wave, wpos, 259, 0);\n\twpos = wrap(wpos + 1, 0, 128);\n}\n",
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
						280.0,
						80.0
					]
				}
			},
			{
				"box": {
					"id": "obj-record",
					"maxclass": "newobj",
					"numinlets": 3,
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
					"numoutlets": 1,
					"outlettype": [
						"bang"
					],
					"patching_rect": [
						200.0,
						470.0,
						360.0,
						20.0
					],
					"text": "js /Users/mrwilson/software/ableton/tests/sand_probe.js sine2k"
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
						80.0,
						20.0
					],
					"text": "cycle~ 2000"
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
						60.0,
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
						"obj-peak-c",
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
			}
		]
	}
}
