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
					"text": "delay 900"
				}
			},
			{
				"box": {
					"id": "obj-mark",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						120.0,
						200.0,
						40.0,
						20.0
					],
					"text": "mark"
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
					"text": "delay 600"
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
					"text": "delay 120"
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
					"text": "analyze 600"
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
					"text": "res 0.57, midshift 0, sideshift 0, gate 0, fmtlevel 1, harmlevel 1, resmode 0, quality 1, wet 1, midinote -1, quality 2, midshift 7, sideshift -5, gate 0.2"
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
					"text": "setbuffer #0-cepscope"
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
					"text": "scope #0-cepscope"
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
						220.0,
						20.0
					],
					"text": "buffer~ #0-cepscope @samps 272"
				}
			},
			{
				"box": {
					"id": "obj-src",
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
						150.0,
						20.0
					],
					"text": "buffer~ src 1000 1"
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
					"code": "// Cepstra \u2014 true cepstral formant shifter (STFT overlap-add, M/S, Hann/Hann, 75% overlap).\n//\n// Buffer (bound on loadbang via `scope #0-cepscope`), 272 samples:\n//   0..191   : signed Mid cepstrum c[n] on 192 LINEAR quefrency columns, n = 0 .. 20 ms (largest |c| per column, 9999 = beyond N/2)\n//   256      : current lifter cutoff L in samples\n//   257      : f0 estimate in Hz (0 = unvoiced / unknown)\n//   258      : input level (linear peak, 0 while asleep)\n//   259      : rolling frame counter\n//   260      : FFT size N\n//   261      : voiced flag\n//   262      : resmode in use\n//\n// Frame work (about 58 jobs per frame) is time-sliced across the first half of each hop, so no single\n// sample runs more than one FFT pass. Packed-FFT trick: Mid + j*Side share one complex FFT, and because\n// both log-spectra / cepstra are real and symmetric, the same packing carries them through every stage.\n// Latency = N + N/8 samples (dry path is delayed by the same amount).\n//\n// GenExpr rules strictly enforced:\n//   - All functions appear before Buffer, Data, Param, History, and expression statements.\n//   - No identifier is named e<digit> (Euler's constant lexer bug).\n\n// In-place radix-2 DIT pass `s` (1..log2 n) over bit-reversed input. sgn = +1 forward, -1 inverse (unscaled).\nfft_pass(re, im, twr, twi, n, s, sgn) {\n\thlf = pow(2, s - 1);\n\tblk = hlf * 2;\n\ttstep = 4096 / blk;\n\tnb = n * 0.5;\n\tfor (b = 0; b < nb; b += 1) {\n\t\tgrp = floor(b / hlf);\n\t\tj = b - grp * hlf;\n\t\ti0 = grp * blk + j;\n\t\ti1 = i0 + hlf;\n\t\ttIdx = j * tstep;\n\t\twr = peek(twr, tIdx);\n\t\twi = sgn * peek(twi, tIdx);\n\t\tar = peek(re, i0);\n\t\tai = peek(im, i0);\n\t\tbr = peek(re, i1);\n\t\tbi = peek(im, i1);\n\t\ttr = br * wr - bi * wi;\n\t\ttm = br * wi + bi * wr;\n\t\tpoke(re, ar - tr, i1);\n\t\tpoke(im, ai - tm, i1);\n\t\tpoke(re, ar + tr, i0);\n\t\tpoke(im, ai + tm, i0);\n\t}\n\treturn 0;\n}\n\n// One-time tables: twiddles exp(-2*pi*i*k/4096) for k = 0..2048 and the 12-bit bit-reversal table.\ninit_tables(twr, twi, brv) {\n\tfor (k = 0; k <= 2048; k += 1) {\n\t\ta = 6.28318530718 * k / 4096;\n\t\tpoke(twr, cos(a), k);\n\t\tpoke(twi, 0 - sin(a), k);\n\t}\n\tfor (i = 0; i < 4096; i += 1) {\n\t\tt = i;\n\t\tr = 0;\n\t\tfor (q = 0; q < 12; q += 1) {\n\t\t\tr = r * 2 + (t % 2);\n\t\t\tt = floor(t / 2);\n\t\t}\n\t\tpoke(brv, r, i);\n\t}\n\treturn 0;\n}\n\nclear_rings(ra, rb) {\n\tfor (i = 0; i < 8192; i += 1) {\n\t\tpoke(ra, 0, i);\n\t\tpoke(rb, 0, i);\n\t}\n\treturn 0;\n}\n\n// Job: Hann-window the last n samples of Mid (real) and Side (imag), writing bit-reversed for the forward FFT.\njob_capture(xre, xim, inM, inS, brv, twr, n, stride, capPos) {\n\tnh = n * 0.5;\n\tfor (i = 0; i < n; i += 1) {\n\t\tci = (i <= nh) ? i : (n - i);\n\t\tw = 0.5 - 0.5 * peek(twr, ci * stride);\n\t\tsrc = wrap(capPos - n + i, 0, 8192);\n\t\tr = floor(peek(brv, i) / stride);\n\t\tpoke(xre, w * peek(inM, src), r);\n\t\tpoke(xim, w * peek(inS, src), r);\n\t}\n\treturn 0;\n}\n\n// Job: logmag[k] = log(|X[k]| + 1e-9) for Mid and Side (separated from the packed FFT).\n// Stores them natural-order (lre/lim, kept for the harmonic split) and bit-reversed (wre/wim) for the cepstrum IFFT.\njob_logmag(xre, xim, lre, lim, wre, wim, brv, n, stride, part, nparts) {\n\tnh = n * 0.5;\n\tk0 = floor((nh + 1) * part / nparts);\n\tk1 = floor((nh + 1) * (part + 1) / nparts);\n\tfor (k = k0; k < k1; k += 1) {\n\t\tkk = (n - k) % n;\n\t\tar = peek(xre, k);\n\t\tai = peek(xim, k);\n\t\tbr = peek(xre, kk);\n\t\tbi = peek(xim, kk);\n\t\tmr = 0.5 * (ar + br);\n\t\tmi = 0.5 * (ai - bi);\n\t\tsr = 0.5 * (ai + bi);\n\t\tsi = 0.5 * (br - ar);\n\t\tlm = log(sqrt(mr * mr + mi * mi) + 0.000000001);\n\t\tls = log(sqrt(sr * sr + si * si) + 0.000000001);\n\t\tpoke(lre, lm, k);\n\t\tpoke(lre, lm, kk);\n\t\tpoke(lim, ls, k);\n\t\tpoke(lim, ls, kk);\n\t\tr1 = floor(peek(brv, k) / stride);\n\t\tr2 = floor(peek(brv, kk) / stride);\n\t\tpoke(wre, lm, r1);\n\t\tpoke(wre, lm, r2);\n\t\tpoke(wim, ls, r1);\n\t\tpoke(wim, ls, r2);\n\t}\n\treturn 0;\n}\n\n// Job: cutoff quefrency L (Manual / Auto f0 / MIDI note), then lifter the Mid+Side cepstra into ere/eim (bit-reversed).\n// State lives in stat[]: 0 = L smoothed, 1 = f0 Hz, 2 = voiced, 4 = held target L.\njob_lift(wre, wim, ere, eim, brv, stat, n, stride, srVal, modeNow, res01, midiNote) {\n\tinvN = 1.0 / n;\n\tnh = n * 0.5;\n\tr01 = clip(res01, 0, 1);\n\tkscale = 0.3 + 0.7 * r01;\n\theld = peek(stat, 4);\n\tf0v = peek(stat, 1);\n\tvoiced = 0;\n\tif (modeNow < 0.5) {\n\t\theld = 0.0003 * pow(50, r01) * srVal;\n\t\tf0v = 0;\n\t} else if (modeNow < 1.5) {\n\t\tqlo = max(floor(srVal * 0.001), 4);\n\t\tqhi = min(floor(srVal / 60), nh - 3);\n\t\tbest = 0;\n\t\tbestQ = 0;\n\t\tyL = 0;\n\t\tyR = 0;\n\t\tprv = peek(wre, qlo - 1) * invN;\n\t\tcur = peek(wre, qlo) * invN;\n\t\tfor (q = qlo; q <= qhi; q += 1) {\n\t\t\tnxt = peek(wre, q + 1) * invN;\n\t\t\tisPk = (cur > prv) && (cur >= nxt);\n\t\t\tif (isPk && (cur > best)) {\n\t\t\t\tbest = cur;\n\t\t\t\tbestQ = q;\n\t\t\t\tyL = prv;\n\t\t\t\tyR = nxt;\n\t\t\t}\n\t\t\tprv = cur;\n\t\t\tcur = nxt;\n\t\t}\n\t\tif (best > 0.06) {\n\t\t\tden = yL - 2 * best + yR;\n\t\t\tdl = (abs(den) > 0.0000001) ? (0.5 * (yL - yR) / den) : 0;\n\t\t\tperiod = bestQ + clip(dl, -0.5, 0.5);\n\t\t\theld = kscale * period;\n\t\t\tf0v = srVal / period;\n\t\t\tvoiced = 1;\n\t\t}\n\t} else {\n\t\tif (midiNote >= 0) {\n\t\t\tperiod = srVal / (440 * pow(2, (midiNote - 69) / 12));\n\t\t\theld = kscale * period;\n\t\t\tf0v = srVal / period;\n\t\t\tvoiced = 1;\n\t\t}\n\t}\n\tpoke(stat, held, 4);\n\tsm = peek(stat, 0);\n\tsm = sm + 0.4 * (held - sm);\n\tlc = clip(sm, 2, nh - 4);\n\tpoke(stat, sm, 0);\n\tpoke(stat, lc, 3);\n\tpoke(stat, f0v, 1);\n\tpoke(stat, voiced, 2);\n\n\ttw = clip(lc * 0.25, 2, 6);\n\tfor (i = 0; i < n; i += 1) {\n\t\tq2 = (i <= nh) ? i : (n - i);\n\t\twgt = 0;\n\t\tif (q2 < lc) {\n\t\t\twgt = 1;\n\t\t\tif (q2 > lc - tw) {\n\t\t\t\twgt = 0.5 + 0.5 * cos(3.14159265359 * (q2 - (lc - tw)) / tw);\n\t\t\t}\n\t\t}\n\t\tr = floor(peek(brv, i) / stride);\n\t\tpoke(ere, wgt * peek(wre, i) * invN, r);\n\t\tpoke(eim, wgt * peek(wim, i) * invN, r);\n\t}\n\treturn 0;\n}\n\n// Linear interpolation of a real, symmetric log-envelope at fractional bin kf (held flat above Nyquist).\ninterp_env(arr, kf, nh) {\n\tkc = clip(kf, 0, nh);\n\ti0 = floor(kc);\n\ti1 = min(i0 + 1, nh);\n\tfr = kc - i0;\n\treturn mix(peek(arr, i0), peek(arr, i1), fr);\n}\n\n// Harmonic gate on the fine structure h (nepers above the envelope). gate01 = 0 is a bypass.\ngate_h(h, gate01) {\n\tif (gate01 <= 0.0005) {\n\t\treturn h;\n\t}\n\tthr = gate01 * 3.4539;\n\tkn = 0.6;\n\tt = clip((h - (thr - kn)) / (2 * kn), 0, 1);\n\tg = t * t * (3 - 2 * t);\n\tdepth = 6.9 * clip(gate01 * 10, 0, 1);\n\treturn h - (1 - g) * depth;\n}\n\n// Job: formant shift + harmonic gate + levels, original phase, written bit-reversed for the synthesis IFFT.\njob_spec(xre, xim, lre, lim, ere, eim, ore, oim, brv, n, stride, part, nparts, ratM, ratS, fmt, harm, gate01) {\n\tnh = n * 0.5;\n\tk0 = floor((nh + 1) * part / nparts);\n\tk1 = floor((nh + 1) * (part + 1) / nparts);\n\tfor (k = k0; k < k1; k += 1) {\n\t\tkk = (n - k) % n;\n\t\tar = peek(xre, k);\n\t\tai = peek(xim, k);\n\t\tbr = peek(xre, kk);\n\t\tbi = peek(xim, kk);\n\t\tmr = 0.5 * (ar + br);\n\t\tmi = 0.5 * (ai - bi);\n\t\tsr = 0.5 * (ai + bi);\n\t\tsi = 0.5 * (br - ar);\n\t\tam = sqrt(mr * mr + mi * mi);\n\t\tasv = sqrt(sr * sr + si * si);\n\t\tpmr = (am > 0.000000000001) ? (mr / am) : 1;\n\t\tpmi = (am > 0.000000000001) ? (mi / am) : 0;\n\t\tpsr = (asv > 0.000000000001) ? (sr / asv) : 1;\n\t\tpsi = (asv > 0.000000000001) ? (si / asv) : 0;\n\n\t\tlm = peek(lre, k);\n\t\tls = peek(lim, k);\n\t\temv = peek(ere, k);\n\t\tesv = peek(eim, k);\n\t\tepm = interp_env(ere, k / ratM, nh);\n\t\teps = interp_env(eim, k / ratS, nh);\n\t\thm = gate_h(lm - emv, gate01);\n\t\ths = gate_h(ls - esv, gate01);\n\t\tomv = clip(fmt * epm + harm * hm, -21, 12);\n\t\tosv = clip(fmt * eps + harm * hs, -21, 12);\n\t\tmagM = exp(omv);\n\t\tmagS = exp(osv);\n\t\tymr = magM * pmr;\n\t\tymi = magM * pmi;\n\t\tysr = magS * psr;\n\t\tysi = magS * psi;\n\t\tif ((k == 0) || (k == nh)) {\n\t\t\tymi = 0;\n\t\t\tysi = 0;\n\t\t}\n\t\tr1 = floor(peek(brv, k) / stride);\n\t\tr2 = floor(peek(brv, kk) / stride);\n\t\tpoke(ore, ymr - ysi, r1);\n\t\tpoke(oim, ymi + ysr, r1);\n\t\tpoke(ore, ymr + ysi, r2);\n\t\tpoke(oim, ysr - ymi, r2);\n\t}\n\treturn 0;\n}\n\n// Job: signed Mid cepstrum c[n] on a LINEAR quefrency axis, 192 columns covering n = 0 .. 20 ms.\n// A column spanning several bins keeps the bin with the largest |c| and its sign (pitch peaks survive).\n// Columns at or beyond N/2 (the 1k setting) write the sentinel 9999.\njob_tele(wre, scope, stat, n, srVal, levelIn, frameNo, modeNow) {\n\tnh = n * 0.5;\n\tinvN = 1.0 / n;\n\tqmax = 0.02 * srVal;\n\tfor (b = 0; b < 192; b += 1) {\n\t\tqlo = b * qmax / 192;\n\t\tqhi = (b + 1) * qmax / 192;\n\t\tk0 = floor(qlo);\n\t\tk1 = max(k0, ceil(qhi) - 1);\n\t\tv = 9999;\n\t\tif (k0 < nh - 1) {\n\t\t\tbest = 0;\n\t\t\tk1c = min(k1, nh - 2);\n\t\t\tfor (k = k0; k <= k1c; k += 1) {\n\t\t\t\tcv = peek(wre, k) * invN;\n\t\t\t\tif (abs(cv) > abs(best)) {\n\t\t\t\t\tbest = cv;\n\t\t\t\t}\n\t\t\t}\n\t\t\tv = best;\n\t\t}\n\t\tpoke(scope, v, b, 0);\n\t}\n\tpoke(scope, peek(stat, 3), 256, 0);\n\tpoke(scope, peek(stat, 1), 257, 0);\n\tpoke(scope, levelIn, 258, 0);\n\tpoke(scope, frameNo, 259, 0);\n\tpoke(scope, n, 260, 0);\n\tpoke(scope, peek(stat, 2), 261, 0);\n\tpoke(scope, modeNow, 262, 0);\n\treturn 0;\n}\n\n// Job: synthesis Hann window and overlap-add into the Mid / Side output rings (Hann^2 at 75% overlap = 1.5).\njob_ola(ore, oim, oM, oS, twr, n, stride, outStart) {\n\tnh = n * 0.5;\n\tscl = 1.0 / (n * 1.5);\n\tfor (i = 0; i < n; i += 1) {\n\t\tci = (i <= nh) ? i : (n - i);\n\t\tw = (0.5 - 0.5 * peek(twr, ci * stride)) * scl;\n\t\tpos = wrap(outStart + i, 0, 8192);\n\t\tpoke(oM, peek(oM, pos) + w * peek(ore, i), pos);\n\t\tpoke(oS, peek(oS, pos) + w * peek(oim, i), pos);\n\t}\n\treturn 0;\n}\n\nBuffer scope(\"cepscope\");\n\nData inM(8192);\nData inS(8192);\nData dryL(8192);\nData dryR(8192);\nData oM(8192);\nData oS(8192);\nData xre(4096);\nData xim(4096);\nData lre(4096);\nData lim(4096);\nData wre(4096);\nData wim(4096);\nData ere(4096);\nData eim(4096);\nData ore(4096);\nData oim(4096);\nData twr(2049);\nData twi(2049);\nData brv(4096);\nData stat(16);\n\nParam res(0.57);\nParam midshift(0.0);\nParam sideshift(0.0);\nParam gate(0.0);\nParam fmtlevel(1.0);\nParam harmlevel(1.0);\nParam resmode(0);\nParam quality(1);\nParam wet(1.0);\nParam midinote(-1);\n\nHistory initDone(0);\nHistory nCur(0);\nHistory llog(11);\nHistory stride(2);\nHistory hopN(512);\nHistory wLat(256);\nHistory ltot(2304);\nHistory jobCount(54);\nHistory spacing(4);\nHistory hopCtr(0);\nHistory jobId(54);\nHistory jobWait(0);\nHistory wp(0);\nHistory capPos(0);\nHistory outStart(0);\nHistory quietCount(0);\nHistory levelPk(0);\nHistory frameNo(0);\nHistory muteCnt(0);\nHistory sleepNote(0);\nHistory tick(0);\nHistory dryG(0.0);\nHistory wetG(1.0);\nHistory wetSm(1.0);\n\nsr = max(samplerate, 1);\n\nif (initDone == 0) {\n\tinit_tables(twr, twi, brv);\n\tpoke(stat, 100, 0);\n\tpoke(stat, 100, 4);\n\tinitDone = 1;\n}\n\n// Quality (FFT size) change: abort jobs, clear the overlap-add rings, brief mute then fade-in.\nqIdx = round(clip(quality, 0, 2));\nnWant = 1024 * pow(2, qIdx);\nif (nWant != nCur) {\n\tnCur = nWant;\n\tllog = 10 + qIdx;\n\tstride = 4096 / nWant;\n\thopN = nWant * 0.25;\n\twLat = nWant * 0.125;\n\tltot = nWant + wLat;\n\tjobCount = 4 * llog + 10;\n\tspacing = max(1, floor((wLat - 2) / jobCount));\n\thopCtr = 0;\n\tjobId = jobCount;\n\tjobWait = 0;\n\tclear_rings(oM, oS);\n\tmuteCnt = ltot + 3 * hopN + 256;\n}\n\n// Control-rate mix coefficients\nif (tick % 16 == 0) {\n\twetSm = wetSm + 0.05 * (clip(wet, 0, 1) - wetSm);\n\tang = wetSm * 1.57079632679;\n\tdryG = cos(ang);\n\twetG = sin(ang);\n}\ntick = wrap(tick + 1, 0, 16);\n\n// Read the finished output sample, then record the new input.\nyM = peek(oM, wp);\nyS = peek(oS, wp);\npoke(oM, 0, wp);\npoke(oS, 0, wp);\ndL = peek(dryL, wrap(wp - ltot, 0, 8192));\ndR = peek(dryR, wrap(wp - ltot, 0, 8192));\npoke(inM, (in1 + in2) * 0.5, wp);\npoke(inS, (in1 - in2) * 0.5, wp);\npoke(dryL, in1, wp);\npoke(dryR, in2, wp);\nwp = wrap(wp + 1, 0, 8192);\n\n// Silence sleep gate: input below -100 dB for a whole frame skips all FFT work.\ninAbs = max(abs(in1), abs(in2));\nloud = (inAbs > 0.00001) ? 1 : 0;\nquietCount = (loud > 0) ? 0 : min(quietCount + 1, 100000000);\nlevelPk = max(inAbs, levelPk * 0.9995);\n\nhopCtr = hopCtr + 1;\nif (hopCtr >= hopN) {\n\thopCtr = 0;\n\tif (quietCount < nCur) {\n\t\tif (jobId >= jobCount) {\n\t\t\tjobId = 0;\n\t\t\tjobWait = 0;\n\t\t\tcapPos = wp;\n\t\t\toutStart = wrap(wp + wLat, 0, 8192);\n\t\t\tframeNo = wrap(frameNo + 1, 0, 100000);\n\t\t}\n\t\tsleepNote = 0;\n\t} else {\n\t\tif (sleepNote == 0) {\n\t\t\tpoke(scope, 0, 258, 0);\n\t\t\tpoke(scope, 0, 257, 0);\n\t\t\tsleepNote = 1;\n\t\t}\n\t}\n}\n\n// Time-sliced frame pipeline\nif (jobId < jobCount) {\n\tif (jobWait <= 0) {\n\t\tj = jobId;\n\t\tif (j == 0) {\n\t\t\tjob_capture(xre, xim, inM, inS, brv, twr, nCur, stride, capPos);\n\t\t} else if (j <= llog) {\n\t\t\tfft_pass(xre, xim, twr, twi, nCur, j, 1);\n\t\t} else if (j <= llog + 2) {\n\t\t\tjob_logmag(xre, xim, lre, lim, wre, wim, brv, nCur, stride, j - llog - 1, 2);\n\t\t} else if (j <= 2 * llog + 2) {\n\t\t\tfft_pass(wre, wim, twr, twi, nCur, j - llog - 2, -1);\n\t\t} else if (j == 2 * llog + 3) {\n\t\t\tjob_lift(wre, wim, ere, eim, brv, stat, nCur, stride, sr, resmode, res, midinote);\n\t\t} else if (j <= 3 * llog + 3) {\n\t\t\tfft_pass(ere, eim, twr, twi, nCur, j - 2 * llog - 3, 1);\n\t\t} else if (j <= 3 * llog + 7) {\n\t\t\tjob_spec(xre, xim, lre, lim, ere, eim, ore, oim, brv, nCur, stride, j - 3 * llog - 4, 4, pow(2, midshift / 12), pow(2, sideshift / 12), clip(fmtlevel, 0, 2), clip(harmlevel, 0, 2), clip(gate, 0, 1));\n\t\t} else if (j == 3 * llog + 8) {\n\t\t\tjob_tele(wre, scope, stat, nCur, sr, levelPk, frameNo, resmode);\n\t\t} else if (j <= 4 * llog + 8) {\n\t\t\tfft_pass(ore, oim, twr, twi, nCur, j - 3 * llog - 8, -1);\n\t\t} else {\n\t\t\tjob_ola(ore, oim, oM, oS, twr, nCur, stride, outStart);\n\t\t}\n\t\tjobId = jobId + 1;\n\t\tjobWait = spacing;\n\t} else {\n\t\tjobWait = jobWait - 1;\n\t}\n}\n\nwetL = yM + yS;\nwetR = yM - yS;\noutL = dL * dryG + wetL * wetG;\noutR = dR * dryG + wetR * wetG;\n\n// Quality-switch mute with a 256-sample fade-in\noutGain = 1;\nif (muteCnt > 0) {\n\toutGain = (muteCnt > 256) ? 0 : (1 - muteCnt / 256);\n\tmuteCnt = muteCnt - 1;\n}\n\nout1 = fixnan(fixdenorm(outL * outGain));\nout2 = fixnan(fixdenorm(outR * outGain));\n",
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
					"numinlets": 5,
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
					"text": "js /Users/mrwilson/software/ableton/tests/cepstra_probe.js vowel 4608"
				}
			},
			{
				"box": {
					"id": "obj-sig1",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						200.0,
						65.0,
						20.0
					],
					"text": "phasor~ 1"
				}
			},
			{
				"box": {
					"id": "obj-groove",
					"maxclass": "newobj",
					"numinlets": 3,
					"numoutlets": 2,
					"outlettype": [
						"signal",
						"signal"
					],
					"patching_rect": [
						700.0,
						240.0,
						90.0,
						20.0
					],
					"text": "wave~ src"
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
						280.0,
						65.0,
						20.0
					],
					"text": "*~ 1.0"
				}
			},
			{
				"box": {
					"id": "obj-sr-msg",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						40.0,
						560.0,
						50.0,
						20.0
					],
					"text": "44100"
				}
			},
			{
				"box": {
					"id": "obj-sr-set",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"float"
					],
					"patching_rect": [
						100.0,
						560.0,
						90.0,
						20.0
					],
					"text": "adstatus sr"
				}
			},
			{
				"box": {
					"id": "obj-del-setbuf",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200.0,
						20.0,
						70.0,
						20.0
					],
					"text": "delay 500"
				}
			},
			{
				"box": {
					"id": "obj-metro",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						40.0,
						480.0,
						70.0,
						20.0
					],
					"text": "metro 100"
				}
			},
			{
				"box": {
					"id": "obj-adstatus",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"float"
					],
					"patching_rect": [
						40.0,
						510.0,
						90.0,
						20.0
					],
					"text": "adstatus cpu"
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
						"obj-sr-msg",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-sr-msg",
						0
					],
					"destination": [
						"obj-sr-set",
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
						"obj-del-setbuf",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-del-setbuf",
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
						"obj-del-dsp",
						0
					],
					"destination": [
						"obj-metro",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-metro",
						0
					],
					"destination": [
						"obj-adstatus",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-adstatus",
						0
					],
					"destination": [
						"obj-js",
						4
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
						"obj-mark",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-mark",
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
						"obj-gain",
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
						"obj-sig1",
						0
					],
					"destination": [
						"obj-groove",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-groove",
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
			}
		]
	}
}
