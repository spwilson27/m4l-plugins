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
					"text": "delay 400"
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
					"text": "delay 350"
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
					"text": "analyze 350"
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
					"text": "size 0.55, damp 0.15, width 1, wet 1, fbk 0.55, predly 0, modamt 0, xfeed 0, hp 20, lp 18000, duck 1"
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
						220.0,
						20.0
					],
					"text": "setbuffer #0-tsconfig #0-tsmeters"
				}
			},
			{
				"box": {
					"id": "obj-cfg",
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
					"text": "buffer~ #0-tsconfig @samps 128"
				}
			},
			{
				"box": {
					"id": "obj-meters",
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
						210.0,
						20.0
					],
					"text": "buffer~ #0-tsmeters @samps 32"
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
					"text": "buffer~ rec 8000 2"
				}
			},
			{
				"box": {
					"code": "// Tiny Space \u2014 20-line feedback delay network.\n// Config buffer (buffer~ #0-tsconfig), indices match src/tinyspace_config.js:\n//   0 activeCount, 1 character,\n//   2..5 allpass lengths (ms), 6..9 allpass gains,\n//   10..29 nominal delay (ms), 30..49 damp offset, 50..69 mod Hz.\n// Meter buffer (buffer~ #0-tsmeters) is one envelope per line.\n// GenExpr rejects the old delay operator. Each line is declared with Delay, then written\n// and read as a tap. Tank lines are 16384 samples (~170 ms at 96 kHz); pre-delay\n// lines are 65536 samples. Read times are clamped inside those lengths.\n// Loop gain is clip(fbk, 0, 1) * 0.97 (see feedbackGain() in tinyspace_config.js).\n// GenExpr requires every function to appear before Buffer, Param, and assignments.\n\nslew(target, coef) {\n\tHistory s(0);\n\tHistory init(0);\n\ts = (init == 0) ? target : mix(target, s, coef);\n\tinit = 1;\n\treturn s;\n}\n\nlfo(hz) {\n\tHistory ph(0);\n\tph = wrap(ph + hz / samplerate, 0, 1);\n\treturn sin(ph * 6.283185307179586);\n}\n\nlp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn s;\n}\n\nhp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn x - s;\n}\n\n// Schroeder allpass. Delay holds the samples; History holds the previous tap\n// so the feedback coefficient is applied to a delayed sample.\n// g near 0 (comb seeds) is a short delay of about t samples.\nallpass(x, t, g) {\n\tDelay line(4096);\n\tHistory mem(0);\n\ty = -g * x + mem;\n\tline.write(x + g * y);\n\tmem = line.read(clip(t, 1, 4000), interp=\"linear\");\n\treturn y;\n}\n\nlineTime(lenMs, lfoVal, sizeNow, modNow) {\n\tsc = 0.22 + clip(sizeNow, 0, 1) * 1.93;\n\tbase = clip(lenMs * sc * samplerate / 1000, 1, 16000);\n\tdepth = min(base * 0.28, samplerate * 0.0012) * clip(modNow, 0, 1);\n\treturn clip(base + lfoVal * depth, 1, 16000);\n}\n\nfollow(x) {\n\tHistory e(0);\n\tax = abs(x);\n\te = mix(ax, e, (ax > e) ? 0.45 : 0.992);\n\treturn e;\n}\n\n// Parallel combs (character 0) blended into a per-side Householder mix (character 1).\nhouse(o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, n, character) {\n\tsum = o0 + o1 + o2 + o3 + o4 + o5 + o6 + o7 + o8 + o9;\n\tk = 2 / max(n, 1);\n\tm0 = (0 < n) ? mix(o0, o0 - sum * k, character) : 0;\n\tm1 = (1 < n) ? mix(o1, o1 - sum * k, character) : 0;\n\tm2 = (2 < n) ? mix(o2, o2 - sum * k, character) : 0;\n\tm3 = (3 < n) ? mix(o3, o3 - sum * k, character) : 0;\n\tm4 = (4 < n) ? mix(o4, o4 - sum * k, character) : 0;\n\tm5 = (5 < n) ? mix(o5, o5 - sum * k, character) : 0;\n\tm6 = (6 < n) ? mix(o6, o6 - sum * k, character) : 0;\n\tm7 = (7 < n) ? mix(o7, o7 - sum * k, character) : 0;\n\tm8 = (8 < n) ? mix(o8, o8 - sum * k, character) : 0;\n\tm9 = (9 < n) ? mix(o9, o9 - sum * k, character) : 0;\n\treturn m0, m1, m2, m3, m4, m5, m6, m7, m8, m9;\n}\n\nBuffer cfg(\"tsconfig\");\nBuffer meters(\"tsmeters\");\n\nParam size(0.45);\nParam damp(0.2);\nParam width(0.7);\nParam wet(0.35);\nParam fbk(0.4);\nParam predly(0);\nParam modamt(0.15);\nParam xfeed(0.25);\nParam hp(40);\nParam lp(14000);\nParam duck(1);\nHistory tick(0);\nHistory o0(0);\nHistory o1(0);\nHistory o2(0);\nHistory o3(0);\nHistory o4(0);\nHistory o5(0);\nHistory o6(0);\nHistory o7(0);\nHistory o8(0);\nHistory o9(0);\nHistory o10(0);\nHistory o11(0);\nHistory o12(0);\nHistory o13(0);\nHistory o14(0);\nHistory o15(0);\nHistory o16(0);\nHistory o17(0);\nHistory o18(0);\nHistory o19(0);\nDelay preDL(65536);\nDelay preDR(65536);\nDelay del0(16384);\nDelay del1(16384);\nDelay del2(16384);\nDelay del3(16384);\nDelay del4(16384);\nDelay del5(16384);\nDelay del6(16384);\nDelay del7(16384);\nDelay del8(16384);\nDelay del9(16384);\nDelay del10(16384);\nDelay del11(16384);\nDelay del12(16384);\nDelay del13(16384);\nDelay del14(16384);\nDelay del15(16384);\nDelay del16(16384);\nDelay del17(16384);\nDelay del18(16384);\nDelay del19(16384);\n\nsizeS = slew(size, 0.9992);\ndampS = slew(damp, 0.9992);\nwidthS = slew(width, 0.9992);\nwetS = slew(wet, 0.9992);\nfbkS = slew(fbk, 0.9992);\npredlyS = slew(predly, 0.9992);\nmodS = slew(modamt, 0.9992);\nxfeedS = slew(xfeed, 0.9992);\nhpS = slew(hp, 0.9992);\nlpS = slew(lp, 0.9992);\n\nactiveCount = peek(cfg, 0);\ncharacter = clip(peek(cfg, 1), 0, 1);\nnL = activeCount * 0.5;\nnR = nL;\nsr = max(samplerate, 1);\nfbg = clip(fbkS, 0, 1) * 0.97;\nduckG = clip(duck, 0, 1);\n\npreSamps = clip(predlyS, 0, 250) * sr / 1000;\npreSamps = clip(preSamps, 0, 48000);\npreDL.write(in1);\npreDR.write(in2);\npreL = preDL.read(preSamps, interp=\"linear\");\npreR = preDR.read(preSamps, interp=\"linear\");\n\nlpCoef = exp(-6.28318530718 * clip(lpS, 400, 18000) / sr);\nhpCoef = exp(-6.28318530718 * clip(hpS, 20, 4000) / sr);\ntoneL = hp(lp(preL, lpCoef), hpCoef);\ntoneR = hp(lp(preR, lpCoef), hpCoef);\n\napT0 = clip(peek(cfg, 2) * sr / 1000, 1, sr * 0.02);\napT1 = clip(peek(cfg, 3) * sr / 1000, 1, sr * 0.02);\napT2 = clip(peek(cfg, 4) * sr / 1000, 1, sr * 0.02);\napT3 = clip(peek(cfg, 5) * sr / 1000, 1, sr * 0.02);\napG0 = clip(peek(cfg, 6), 0, 0.7);\napG1 = clip(peek(cfg, 7), 0, 0.7);\napG2 = clip(peek(cfg, 8), 0, 0.7);\napG3 = clip(peek(cfg, 9), 0, 0.7);\naL = allpass(toneL, apT0, apG0);\naL = allpass(aL, apT1, apG1);\naL = allpass(aL, apT2, apG2);\naL = allpass(aL, apT3, apG3);\naR = allpass(toneR, apT0, apG0);\naR = allpass(aR, apT1, apG1);\naR = allpass(aR, apT2, apG2);\naR = allpass(aR, apT3, apG3);\n\ninvL = 1 / sqrt(max(nL, 1));\ninvR = 1 / sqrt(max(nR, 1));\ninjL = aL * invL;\ninjR = aR * invR;\n\nlfo0 = lfo(peek(cfg, 50));\nlfo1 = lfo(peek(cfg, 51));\nlfo2 = lfo(peek(cfg, 52));\nlfo3 = lfo(peek(cfg, 53));\nlfo4 = lfo(peek(cfg, 54));\nlfo5 = lfo(peek(cfg, 55));\nlfo6 = lfo(peek(cfg, 56));\nlfo7 = lfo(peek(cfg, 57));\nlfo8 = lfo(peek(cfg, 58));\nlfo9 = lfo(peek(cfg, 59));\nlfo10 = lfo(peek(cfg, 60));\nlfo11 = lfo(peek(cfg, 61));\nlfo12 = lfo(peek(cfg, 62));\nlfo13 = lfo(peek(cfg, 63));\nlfo14 = lfo(peek(cfg, 64));\nlfo15 = lfo(peek(cfg, 65));\nlfo16 = lfo(peek(cfg, 66));\nlfo17 = lfo(peek(cfg, 67));\nlfo18 = lfo(peek(cfg, 68));\nlfo19 = lfo(peek(cfg, 69));\n\nt0 = lineTime(peek(cfg, 10), lfo0, sizeS, modS);\nt1 = lineTime(peek(cfg, 11), lfo1, sizeS, modS);\nt2 = lineTime(peek(cfg, 12), lfo2, sizeS, modS);\nt3 = lineTime(peek(cfg, 13), lfo3, sizeS, modS);\nt4 = lineTime(peek(cfg, 14), lfo4, sizeS, modS);\nt5 = lineTime(peek(cfg, 15), lfo5, sizeS, modS);\nt6 = lineTime(peek(cfg, 16), lfo6, sizeS, modS);\nt7 = lineTime(peek(cfg, 17), lfo7, sizeS, modS);\nt8 = lineTime(peek(cfg, 18), lfo8, sizeS, modS);\nt9 = lineTime(peek(cfg, 19), lfo9, sizeS, modS);\nt10 = lineTime(peek(cfg, 20), lfo10, sizeS, modS);\nt11 = lineTime(peek(cfg, 21), lfo11, sizeS, modS);\nt12 = lineTime(peek(cfg, 22), lfo12, sizeS, modS);\nt13 = lineTime(peek(cfg, 23), lfo13, sizeS, modS);\nt14 = lineTime(peek(cfg, 24), lfo14, sizeS, modS);\nt15 = lineTime(peek(cfg, 25), lfo15, sizeS, modS);\nt16 = lineTime(peek(cfg, 26), lfo16, sizeS, modS);\nt17 = lineTime(peek(cfg, 27), lfo17, sizeS, modS);\nt18 = lineTime(peek(cfg, 28), lfo18, sizeS, modS);\nt19 = lineTime(peek(cfg, 29), lfo19, sizeS, modS);\n\nm0, m1, m2, m3, m4, m5, m6, m7, m8, m9 = house(o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, nL, character);\nm10, m11, m12, m13, m14, m15, m16, m17, m18, m19 = house(o10, o11, o12, o13, o14, o15, o16, o17, o18, o19, nR, character);\n\nxf = clip(xfeedS, 0, 1);\nx0 = m0 * (1 - xf) + m10 * xf;\nx1 = m1 * (1 - xf) + m11 * xf;\nx2 = m2 * (1 - xf) + m12 * xf;\nx3 = m3 * (1 - xf) + m13 * xf;\nx4 = m4 * (1 - xf) + m14 * xf;\nx5 = m5 * (1 - xf) + m15 * xf;\nx6 = m6 * (1 - xf) + m16 * xf;\nx7 = m7 * (1 - xf) + m17 * xf;\nx8 = m8 * (1 - xf) + m18 * xf;\nx9 = m9 * (1 - xf) + m19 * xf;\nx10 = m10 * (1 - xf) + m0 * xf;\nx11 = m11 * (1 - xf) + m1 * xf;\nx12 = m12 * (1 - xf) + m2 * xf;\nx13 = m13 * (1 - xf) + m3 * xf;\nx14 = m14 * (1 - xf) + m4 * xf;\nx15 = m15 * (1 - xf) + m5 * xf;\nx16 = m16 * (1 - xf) + m6 * xf;\nx17 = m17 * (1 - xf) + m7 * xf;\nx18 = m18 * (1 - xf) + m8 * xf;\nx19 = m19 * (1 - xf) + m9 * xf;\n\nc0 = clip(dampS * 0.92 + peek(cfg, 30) * 0.35, 0, 0.995);\nc1 = clip(dampS * 0.92 + peek(cfg, 31) * 0.35, 0, 0.995);\nc2 = clip(dampS * 0.92 + peek(cfg, 32) * 0.35, 0, 0.995);\nc3 = clip(dampS * 0.92 + peek(cfg, 33) * 0.35, 0, 0.995);\nc4 = clip(dampS * 0.92 + peek(cfg, 34) * 0.35, 0, 0.995);\nc5 = clip(dampS * 0.92 + peek(cfg, 35) * 0.35, 0, 0.995);\nc6 = clip(dampS * 0.92 + peek(cfg, 36) * 0.35, 0, 0.995);\nc7 = clip(dampS * 0.92 + peek(cfg, 37) * 0.35, 0, 0.995);\nc8 = clip(dampS * 0.92 + peek(cfg, 38) * 0.35, 0, 0.995);\nc9 = clip(dampS * 0.92 + peek(cfg, 39) * 0.35, 0, 0.995);\nc10 = clip(dampS * 0.92 + peek(cfg, 40) * 0.35, 0, 0.995);\nc11 = clip(dampS * 0.92 + peek(cfg, 41) * 0.35, 0, 0.995);\nc12 = clip(dampS * 0.92 + peek(cfg, 42) * 0.35, 0, 0.995);\nc13 = clip(dampS * 0.92 + peek(cfg, 43) * 0.35, 0, 0.995);\nc14 = clip(dampS * 0.92 + peek(cfg, 44) * 0.35, 0, 0.995);\nc15 = clip(dampS * 0.92 + peek(cfg, 45) * 0.35, 0, 0.995);\nc16 = clip(dampS * 0.92 + peek(cfg, 46) * 0.35, 0, 0.995);\nc17 = clip(dampS * 0.92 + peek(cfg, 47) * 0.35, 0, 0.995);\nc18 = clip(dampS * 0.92 + peek(cfg, 48) * 0.35, 0, 0.995);\nc19 = clip(dampS * 0.92 + peek(cfg, 49) * 0.35, 0, 0.995);\n\nd0 = lp(x0, c0);\nd1 = lp(x1, c1);\nd2 = lp(x2, c2);\nd3 = lp(x3, c3);\nd4 = lp(x4, c4);\nd5 = lp(x5, c5);\nd6 = lp(x6, c6);\nd7 = lp(x7, c7);\nd8 = lp(x8, c8);\nd9 = lp(x9, c9);\nd10 = lp(x10, c10);\nd11 = lp(x11, c11);\nd12 = lp(x12, c12);\nd13 = lp(x13, c13);\nd14 = lp(x14, c14);\nd15 = lp(x15, c15);\nd16 = lp(x16, c16);\nd17 = lp(x17, c17);\nd18 = lp(x18, c18);\nd19 = lp(x19, c19);\n\na0 = (0 < nL) ? 1 : 0;\na1 = (1 < nL) ? 1 : 0;\na2 = (2 < nL) ? 1 : 0;\na3 = (3 < nL) ? 1 : 0;\na4 = (4 < nL) ? 1 : 0;\na5 = (5 < nL) ? 1 : 0;\na6 = (6 < nL) ? 1 : 0;\na7 = (7 < nL) ? 1 : 0;\na8 = (8 < nL) ? 1 : 0;\na9 = (9 < nL) ? 1 : 0;\na10 = (0 < nR) ? 1 : 0;\na11 = (1 < nR) ? 1 : 0;\na12 = (2 < nR) ? 1 : 0;\na13 = (3 < nR) ? 1 : 0;\na14 = (4 < nR) ? 1 : 0;\na15 = (5 < nR) ? 1 : 0;\na16 = (6 < nR) ? 1 : 0;\na17 = (7 < nR) ? 1 : 0;\na18 = (8 < nR) ? 1 : 0;\na19 = (9 < nR) ? 1 : 0;\n\nz0 = a0 * (tanh(d0 * fbg) * duckG + injL);\nz1 = a1 * (tanh(d1 * fbg) * duckG + injL);\nz2 = a2 * (tanh(d2 * fbg) * duckG + injL);\nz3 = a3 * (tanh(d3 * fbg) * duckG + injL);\nz4 = a4 * (tanh(d4 * fbg) * duckG + injL);\nz5 = a5 * (tanh(d5 * fbg) * duckG + injL);\nz6 = a6 * (tanh(d6 * fbg) * duckG + injL);\nz7 = a7 * (tanh(d7 * fbg) * duckG + injL);\nz8 = a8 * (tanh(d8 * fbg) * duckG + injL);\nz9 = a9 * (tanh(d9 * fbg) * duckG + injL);\nz10 = a10 * (tanh(d10 * fbg) * duckG + injR);\nz11 = a11 * (tanh(d11 * fbg) * duckG + injR);\nz12 = a12 * (tanh(d12 * fbg) * duckG + injR);\nz13 = a13 * (tanh(d13 * fbg) * duckG + injR);\nz14 = a14 * (tanh(d14 * fbg) * duckG + injR);\nz15 = a15 * (tanh(d15 * fbg) * duckG + injR);\nz16 = a16 * (tanh(d16 * fbg) * duckG + injR);\nz17 = a17 * (tanh(d17 * fbg) * duckG + injR);\nz18 = a18 * (tanh(d18 * fbg) * duckG + injR);\nz19 = a19 * (tanh(d19 * fbg) * duckG + injR);\n\ndel0.write(z0);\ndel1.write(z1);\ndel2.write(z2);\ndel3.write(z3);\ndel4.write(z4);\ndel5.write(z5);\ndel6.write(z6);\ndel7.write(z7);\ndel8.write(z8);\ndel9.write(z9);\ndel10.write(z10);\ndel11.write(z11);\ndel12.write(z12);\ndel13.write(z13);\ndel14.write(z14);\ndel15.write(z15);\ndel16.write(z16);\ndel17.write(z17);\ndel18.write(z18);\ndel19.write(z19);\no0 = del0.read(t0, interp=\"linear\") * a0;\no1 = del1.read(t1, interp=\"linear\") * a1;\no2 = del2.read(t2, interp=\"linear\") * a2;\no3 = del3.read(t3, interp=\"linear\") * a3;\no4 = del4.read(t4, interp=\"linear\") * a4;\no5 = del5.read(t5, interp=\"linear\") * a5;\no6 = del6.read(t6, interp=\"linear\") * a6;\no7 = del7.read(t7, interp=\"linear\") * a7;\no8 = del8.read(t8, interp=\"linear\") * a8;\no9 = del9.read(t9, interp=\"linear\") * a9;\no10 = del10.read(t10, interp=\"linear\") * a10;\no11 = del11.read(t11, interp=\"linear\") * a11;\no12 = del12.read(t12, interp=\"linear\") * a12;\no13 = del13.read(t13, interp=\"linear\") * a13;\no14 = del14.read(t14, interp=\"linear\") * a14;\no15 = del15.read(t15, interp=\"linear\") * a15;\no16 = del16.read(t16, interp=\"linear\") * a16;\no17 = del17.read(t17, interp=\"linear\") * a17;\no18 = del18.read(t18, interp=\"linear\") * a18;\no19 = del19.read(t19, interp=\"linear\") * a19;\n\ne0 = follow(o0);\ne1 = follow(o1);\ne2 = follow(o2);\ne3 = follow(o3);\ne4 = follow(o4);\ne5 = follow(o5);\ne6 = follow(o6);\ne7 = follow(o7);\ne8 = follow(o8);\ne9 = follow(o9);\ne10 = follow(o10);\ne11 = follow(o11);\ne12 = follow(o12);\ne13 = follow(o13);\ne14 = follow(o14);\ne15 = follow(o15);\ne16 = follow(o16);\ne17 = follow(o17);\ne18 = follow(o18);\ne19 = follow(o19);\n\ntick = wrap(tick + 1, 0, 32);\nif (tick == 0) {\n\tpoke(meters, 0.42, 3, 0);\n\tpoke(meters, e0, 0, 0);\n\tpoke(meters, e1, 1, 0);\n\tpoke(meters, e2, 2, 0);\n\tpoke(meters, e3, 3, 0);\n\tpoke(meters, e4, 4, 0);\n\tpoke(meters, e5, 5, 0);\n\tpoke(meters, e6, 6, 0);\n\tpoke(meters, e7, 7, 0);\n\tpoke(meters, e8, 8, 0);\n\tpoke(meters, e9, 9, 0);\n\tpoke(meters, e10, 10, 0);\n\tpoke(meters, e11, 11, 0);\n\tpoke(meters, e12, 12, 0);\n\tpoke(meters, e13, 13, 0);\n\tpoke(meters, e14, 14, 0);\n\tpoke(meters, e15, 15, 0);\n\tpoke(meters, e16, 16, 0);\n\tpoke(meters, e17, 17, 0);\n\tpoke(meters, e18, 18, 0);\n\tpoke(meters, e19, 19, 0);\n}\n\nsumL = (o0 + o1 + o2 + o3 + o4 + o5 + o6 + o7 + o8 + o9) * invL;\nsumR = (o10 + o11 + o12 + o13 + o14 + o15 + o16 + o17 + o18 + o19) * invR;\nmid = (sumL + sumR) * 0.5;\nside = (sumL - sumR) * 0.5 * clip(widthS, 0, 1);\nwetL = (mid + side) * duckG;\nwetR = (mid - side) * duckG;\nang = clip(wetS, 0, 1) * 1.57079632679;\ndryG = cos(ang);\nwetG = sin(ang);\nout1 = fixnan(in1 * dryG + wetL * wetG);\nout2 = fixnan(in2 * dryG + wetR * wetG);\n",
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
					"text": "js /Users/mrwilson/software/ableton/tests/tinyspace_probe.js sine width"
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
						340.0,
						20.0
					],
					"text": "cfg #0-tsconfig, meters #0-tsmeters"
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
