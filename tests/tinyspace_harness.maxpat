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
					"text": "delay 1600"
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
					"text": "delay 300"
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
						80.0,
						20.0
					],
					"text": "delay 400"
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
					"text": "analyze 1600"
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
					"text": "size 0, damp 0, width 1, wet 1, fbk 0.5, predly 0, modamt 0, xfeed 0, hp 20, lp 18000, duck 1"
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
					"text": "buffer~ rec 14000 2"
				}
			},
			{
				"box": {
					"code": "// Tiny Space \u2014 20-line feedback delay network.\n// Config buffer (buffer~ #0-tsconfig), indices match src/tinyspace_config.js:\n//   0 activeCount, 1 character,\n//   2..5 allpass lengths (ms), 6..9 allpass gains,\n//   10..29 nominal delay (ms), 30..49 damp offset, 50..69 mod Hz.\n// Meter buffer (buffer~ #0-tsmeters) is one envelope per line.\n// GenExpr rejects the old delay operator. Each line is declared with Delay, then written\n// and read as a tap. Tank taps never exceed 16000 samples, so each tank line is\n// 16384 samples and stays in cache. Predelay can be 250 ms, so those two lines\n// stay at 65536. Only the selected room model is mixed, modulation sines run\n// only while Mod is up, and a silent input with a dead tank skips the network.\n// Full feedback holds a line to about -60 dB in 27.5 seconds (see ringGain).\n// Short combs stay bright: delay taps are whole samples, and Damp 0 does not\n// lowpass the loop, so a small Size rings as a metallic tone instead of a thud.\n// The coefficient depends on that line's delay so short combs do not die\n// in a fraction of a second. It is clipped just under 1, so the tail ends.\n// Every room mix is orthogonal and keeps the all-ones mode at magnitude 1,\n// and crossfeed is a rotation, so neither one shortens that tail.\n// GenExpr requires every function to appear before Buffer, Param, and assignments.\n\nslew(target, coef) {\n\tHistory s(0);\n\tHistory init(0);\n\ts = (init == 0) ? target : mix(target, s, coef);\n\tinit = 1;\n\treturn s;\n}\n\n// steps is 1 at audio rate, or 32 when the phase is sampled once per block.\nlfo(hz, steps) {\n\tHistory ph(0);\n\tph = wrap(ph + hz * steps / samplerate, 0, 1);\n\treturn sin(ph * 6.283185307179586);\n}\n\nlp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn s;\n}\n\nhp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn x - s;\n}\n\n// Schroeder allpass. Delay holds the samples; History holds the previous tap\n// so the feedback coefficient is applied to a delayed sample.\n// g near 0 (comb seeds) is a short delay of about t samples.\nallpass(x, t, g) {\n\tDelay line(4096);\n\tHistory mem(0);\n\ty = -g * x + mem;\n\tline.write(x + g * y);\n\tmem = line.read(clip(t, 1, 4000), interp=\"linear\");\n\treturn y;\n}\n\nlineTime(lenMs, lfoVal, sizeNow, modNow) {\n\tsc = 0.22 + clip(sizeNow, 0, 1) * 1.93;\n\tbase = clip(lenMs * sc * samplerate / 1000, 1, 16000);\n\tdepth = min(base * 0.28, samplerate * 0.0012) * clip(modNow, 0, 1);\n\t// Whole-sample taps. Linear interpolation would shave a little high end\n\t// off every pass, and a 1 ms comb passes often enough that the tone dies.\n\treturn round(clip(base + lfoVal * depth, 1, 16000));\n}\n\nfollow(x) {\n\tHistory s(0);\n\tax = abs(x);\n\ts = mix(ax, s, (ax > s) ? 0.45 : 0.992);\n\treturn s;\n}\n\n// Delay-style RT60. 50% is a short slap (~0.7 s); 100% is about 27.5 s to -60 dB.\n// rt = 2.90663 k^2 - 0.81561 k^4 + 7.05921 k^6 - 1.60268 k^10 + 19.9526 k^16\n// Matches feedbackRt60() in tinyspace_config.js. fbk 0 returns 0 (no recirculation).\nfeedbackRt(fbkNow) {\n\tk = clip(fbkNow, 0, 1);\n\tk2 = k * k;\n\tk4 = k2 * k2;\n\tk6 = k4 * k2;\n\tk10 = k6 * k4;\n\tk16 = k10 * k6;\n\trtRaw = 2.90663 * k2 - 0.81561 * k4 + 7.05921 * k6 - 1.60268 * k10 + 19.9526 * k16;\n\treturn (k < 0.001) ? 0 : rtRaw;\n}\n\n// Per-line loop gain from an RT60 already computed by feedbackRt. rt 0 does not\n// recirculate. The ceiling sits just under 1 so a 1-sample comb still ends.\nringGain(delaySamps, rt) {\n\tsecs = max(delaySamps, 1) / samplerate;\n\tsafe = (rt > 0.00001) ? rt : 1;\n\tg = exp(-6.90775527898 * secs / safe);\n\tquiet = (rt > 0.00001) ? g : 0;\n\treturn clip(quiet, 0, 0.9999995);\n}\n\n// One-pole lowpass coefficient. Damp 0 is a bypass (pole 0), so a bright comb\n// stays metallic. Above that, the knob is a cutoff: about 5 kHz at 20%,\n// about 1.8 kHz at 50%, and a few hundred hertz at 100% on an 8 ms line.\n// Short lines get a higher cutoff so a 1 ms comb is not filtered 20 times\n// harder than a 20 ms room line. Matches dampPole() in tinyspace_config.js.\ndampCoef(delaySamps, dampNow, offset) {\n\tamtIn = clip(dampNow, 0, 1);\n\tpole = 0;\n\tif (amtIn >= 0.001) {\n\t\toff = clip(offset, 0, 0.35);\n\t\tamt = clip(amtIn * (0.85 + 0.30 * off), 0, 1);\n\t\tamtPow = pow(max(amt, 0.00001), 0.75);\n\t\tfcBase = 16000 * pow(0.015, amtPow);\n\t\tspan = max(delaySamps, 1);\n\t\tscale = pow(0.008 * samplerate / span, 0.45);\n\t\tscale = clip(scale, 0.6, 3.2);\n\t\tfcNow = fcBase * scale;\n\t\tpole = exp(-6.28318530718 * fcNow / samplerate);\n\t}\n\treturn clip(pole, 0, 0.995);\n}\n\n// Rotate three samples inside the plane orthogonal to (1, 1, 1).\n// Eigenvalue of the all-ones vector is +1, and the map is orthogonal\n// for every angle (c, s) = (cos theta, sin theta). A plain 2x2 rotation\n// of two lines is orthogonal too, but its common-mode gain is only cos(theta),\n// which would silence the output sum. Mirrors spin3() in tinyspace_config.js.\nspin3(x0, x1, x2, c, s) {\n\tu0 = 0.7071067811865476;\n\tu1 = -0.7071067811865476;\n\tv0 = 0.40824829046386302;\n\tv1 = 0.40824829046386302;\n\tv2 = -0.81649658092772603;\n\tpu = x0 * u0 + x1 * u1;\n\tpv = x0 * v0 + x1 * v1 + x2 * v2;\n\tf = c - 1;\n\ty0 = x0 + f * (pu * u0 + pv * v0) + s * (pu * v0 - pv * u0);\n\ty1 = x1 + f * (pu * u1 + pv * v1) + s * (pu * v1 - pv * u1);\n\ty2 = x2 + f * (pv * v2) + s * (pu * v2);\n\treturn y0, y1, y2;\n}\n\ntap(i, a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) {\n\treturn (i < 0.5) ? a0 : ((i < 1.5) ? a1 : ((i < 2.5) ? a2 : ((i < 3.5) ? a3 : ((i < 4.5) ? a4 : ((i < 5.5) ? a5 : ((i < 6.5) ? a6 : ((i < 7.5) ? a7 : ((i < 8.5) ? a8 : a9))))))));\n}\n\n// Eight orthogonal room topologies. Each one satisfies M^T M = I and sends\n// the all-ones vector to \u00b1 itself, so the normalized output sum decays only\n// through ringGain. Mirrors fdnMix() in tinyspace_config.js.\n//   0 COMB    identity (parallel combs)\n//   1 HYBRID  character-scaled rotation in the plane orthogonal to all-ones\n//   2 ROOM    Householder reflection\n//   3 PLATE   Householder, then a sign-flipping cycle\n//   4 TANK    sign-flipping cycle (figure-8 ring)\n//   5 BOX     Householder, then pairwise wall swaps\n//   6 SPRING  overlapping sum-preserving rotations (dispersion lattice)\n//   7 BOUNCE  sign-flipping reversal\n// hc, hs are cos/sin of character * pi, refreshed with the other slow coefficients.\n// Only the selected model runs. Spring's angle is the constant pair cos(1.15), sin(1.15).\nhouse(o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, n, model, hc, hs) {\n\tz0 = (0 < n) ? o0 : 0;\n\tz1 = (1 < n) ? o1 : 0;\n\tz2 = (2 < n) ? o2 : 0;\n\tz3 = (3 < n) ? o3 : 0;\n\tz4 = (4 < n) ? o4 : 0;\n\tz5 = (5 < n) ? o5 : 0;\n\tz6 = (6 < n) ? o6 : 0;\n\tz7 = (7 < n) ? o7 : 0;\n\tz8 = (8 < n) ? o8 : 0;\n\tz9 = (9 < n) ? o9 : 0;\n\tm0 = z0;\n\tm1 = z1;\n\tm2 = z2;\n\tm3 = z3;\n\tm4 = z4;\n\tm5 = z5;\n\tm6 = z6;\n\tm7 = z7;\n\tm8 = z8;\n\tm9 = z9;\n\n\tif (model == 0) {\n\t\tm0 = z0;\n\t} else if (model == 1) {\n\t\tq0, q1, q2 = spin3(z0, z1, z2, hc, hs);\n\t\tm0 = (2 < n) ? q0 : z0;\n\t\tm1 = (2 < n) ? q1 : z1;\n\t\tm2 = (2 < n) ? q2 : z2;\n\t\tq0, q1, q2 = spin3(z3, z4, z5, hc, hs);\n\t\tm3 = (5 < n) ? q0 : z3;\n\t\tm4 = (5 < n) ? q1 : z4;\n\t\tm5 = (5 < n) ? q2 : z5;\n\t\tq0, q1, q2 = spin3(z6, z7, z8, hc, hs);\n\t\tm6 = (8 < n) ? q0 : z6;\n\t\tm7 = (8 < n) ? q1 : z7;\n\t\tm8 = (8 < n) ? q2 : z8;\n\t} else if (model == 2) {\n\t\tsum = z0 + z1 + z2 + z3 + z4 + z5 + z6 + z7 + z8 + z9;\n\t\tkk = 2 / max(n, 1);\n\t\tm0 = (0 < n) ? (z0 - sum * kk) : 0;\n\t\tm1 = (1 < n) ? (z1 - sum * kk) : 0;\n\t\tm2 = (2 < n) ? (z2 - sum * kk) : 0;\n\t\tm3 = (3 < n) ? (z3 - sum * kk) : 0;\n\t\tm4 = (4 < n) ? (z4 - sum * kk) : 0;\n\t\tm5 = (5 < n) ? (z5 - sum * kk) : 0;\n\t\tm6 = (6 < n) ? (z6 - sum * kk) : 0;\n\t\tm7 = (7 < n) ? (z7 - sum * kk) : 0;\n\t\tm8 = (8 < n) ? (z8 - sum * kk) : 0;\n\t\tm9 = (9 < n) ? (z9 - sum * kk) : 0;\n\t} else if (model == 3) {\n\t\t// PLATE: Householder, then a sign-flipping cycle. Every sign is negative\n\t\t// so an even-length ring still maps all-ones to \u00b1all-ones.\n\t\tsum = z0 + z1 + z2 + z3 + z4 + z5 + z6 + z7 + z8 + z9;\n\t\tkk = 2 / max(n, 1);\n\t\thh0 = (0 < n) ? (z0 - sum * kk) : 0;\n\t\thh1 = (1 < n) ? (z1 - sum * kk) : 0;\n\t\thh2 = (2 < n) ? (z2 - sum * kk) : 0;\n\t\thh3 = (3 < n) ? (z3 - sum * kk) : 0;\n\t\thh4 = (4 < n) ? (z4 - sum * kk) : 0;\n\t\thh5 = (5 < n) ? (z5 - sum * kk) : 0;\n\t\thh6 = (6 < n) ? (z6 - sum * kk) : 0;\n\t\thh7 = (7 < n) ? (z7 - sum * kk) : 0;\n\t\thh8 = (8 < n) ? (z8 - sum * kk) : 0;\n\t\tlastH = tap(n - 1, hh0, hh1, hh2, hh3, hh4, hh5, hh6, hh7, hh8, (9 < n) ? (z9 - sum * kk) : 0);\n\t\tm0 = (0 < n) ? -lastH : 0;\n\t\tm1 = (1 < n) ? -hh0 : 0;\n\t\tm2 = (2 < n) ? -hh1 : 0;\n\t\tm3 = (3 < n) ? -hh2 : 0;\n\t\tm4 = (4 < n) ? -hh3 : 0;\n\t\tm5 = (5 < n) ? -hh4 : 0;\n\t\tm6 = (6 < n) ? -hh5 : 0;\n\t\tm7 = (7 < n) ? -hh6 : 0;\n\t\tm8 = (8 < n) ? -hh7 : 0;\n\t\tm9 = (9 < n) ? -hh8 : 0;\n\t} else if (model == 4) {\n\t\tlastZ = tap(n - 1, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9);\n\t\tm0 = (0 < n) ? -lastZ : 0;\n\t\tm1 = (1 < n) ? -z0 : 0;\n\t\tm2 = (2 < n) ? -z1 : 0;\n\t\tm3 = (3 < n) ? -z2 : 0;\n\t\tm4 = (4 < n) ? -z3 : 0;\n\t\tm5 = (5 < n) ? -z4 : 0;\n\t\tm6 = (6 < n) ? -z5 : 0;\n\t\tm7 = (7 < n) ? -z6 : 0;\n\t\tm8 = (8 < n) ? -z7 : 0;\n\t\tm9 = (9 < n) ? -z8 : 0;\n\t} else if (model == 5) {\n\t\tsum = z0 + z1 + z2 + z3 + z4 + z5 + z6 + z7 + z8 + z9;\n\t\tkk = 2 / max(n, 1);\n\t\thh0 = (0 < n) ? (z0 - sum * kk) : 0;\n\t\thh1 = (1 < n) ? (z1 - sum * kk) : 0;\n\t\thh2 = (2 < n) ? (z2 - sum * kk) : 0;\n\t\thh3 = (3 < n) ? (z3 - sum * kk) : 0;\n\t\thh4 = (4 < n) ? (z4 - sum * kk) : 0;\n\t\thh5 = (5 < n) ? (z5 - sum * kk) : 0;\n\t\thh6 = (6 < n) ? (z6 - sum * kk) : 0;\n\t\thh7 = (7 < n) ? (z7 - sum * kk) : 0;\n\t\thh8 = (8 < n) ? (z8 - sum * kk) : 0;\n\t\thh9 = (9 < n) ? (z9 - sum * kk) : 0;\n\t\tm0 = (1 < n) ? -hh1 : ((0 < n) ? -hh0 : 0);\n\t\tm1 = (1 < n) ? -hh0 : 0;\n\t\tm2 = (3 < n) ? -hh3 : ((2 < n) ? -hh2 : 0);\n\t\tm3 = (3 < n) ? -hh2 : 0;\n\t\tm4 = (5 < n) ? -hh5 : ((4 < n) ? -hh4 : 0);\n\t\tm5 = (5 < n) ? -hh4 : 0;\n\t\tm6 = (7 < n) ? -hh7 : ((6 < n) ? -hh6 : 0);\n\t\tm7 = (7 < n) ? -hh6 : 0;\n\t\tm8 = (9 < n) ? -hh9 : ((8 < n) ? -hh8 : 0);\n\t\tm9 = (9 < n) ? -hh8 : 0;\n\t} else if (model == 6) {\n\t\t// cos(1.15), sin(1.15). A constant angle, not an audio-rate call.\n\t\tsc = 0.40848744088415739;\n\t\tss = 0.91276394026052099;\n\t\tu0 = z0;\n\t\tu1 = z1;\n\t\tu2 = z2;\n\t\tu3 = z3;\n\t\tu4 = z4;\n\t\tu5 = z5;\n\t\tu6 = z6;\n\t\tu7 = z7;\n\t\tu8 = z8;\n\t\tu9 = z9;\n\t\tq0, q1, q2 = spin3(u0, u1, u2, sc, ss);\n\t\tu0 = (2 < n) ? q0 : u0;\n\t\tu1 = (2 < n) ? q1 : u1;\n\t\tu2 = (2 < n) ? q2 : u2;\n\t\tq0, q1, q2 = spin3(u1, u2, u3, sc, ss);\n\t\tu1 = (3 < n) ? q0 : u1;\n\t\tu2 = (3 < n) ? q1 : u2;\n\t\tu3 = (3 < n) ? q2 : u3;\n\t\tq0, q1, q2 = spin3(u2, u3, u4, sc, ss);\n\t\tu2 = (4 < n) ? q0 : u2;\n\t\tu3 = (4 < n) ? q1 : u3;\n\t\tu4 = (4 < n) ? q2 : u4;\n\t\tq0, q1, q2 = spin3(u3, u4, u5, sc, ss);\n\t\tu3 = (5 < n) ? q0 : u3;\n\t\tu4 = (5 < n) ? q1 : u4;\n\t\tu5 = (5 < n) ? q2 : u5;\n\t\tq0, q1, q2 = spin3(u4, u5, u6, sc, ss);\n\t\tu4 = (6 < n) ? q0 : u4;\n\t\tu5 = (6 < n) ? q1 : u5;\n\t\tu6 = (6 < n) ? q2 : u6;\n\t\tq0, q1, q2 = spin3(u5, u6, u7, sc, ss);\n\t\tu5 = (7 < n) ? q0 : u5;\n\t\tu6 = (7 < n) ? q1 : u6;\n\t\tu7 = (7 < n) ? q2 : u7;\n\t\tq0, q1, q2 = spin3(u6, u7, u8, sc, ss);\n\t\tu6 = (8 < n) ? q0 : u6;\n\t\tu7 = (8 < n) ? q1 : u7;\n\t\tu8 = (8 < n) ? q2 : u8;\n\t\tq0, q1, q2 = spin3(u7, u8, u9, sc, ss);\n\t\tu7 = (9 < n) ? q0 : u7;\n\t\tu8 = (9 < n) ? q1 : u8;\n\t\tu9 = (9 < n) ? q2 : u9;\n\t\tm0 = (2 < n) ? u0 : ((0 < n) ? -z0 : 0);\n\t\tm1 = (2 < n) ? u1 : ((1 < n) ? -z1 : 0);\n\t\tm2 = (2 < n) ? u2 : 0;\n\t\tm3 = (2 < n) ? u3 : 0;\n\t\tm4 = (2 < n) ? u4 : 0;\n\t\tm5 = (2 < n) ? u5 : 0;\n\t\tm6 = (2 < n) ? u6 : 0;\n\t\tm7 = (2 < n) ? u7 : 0;\n\t\tm8 = (2 < n) ? u8 : 0;\n\t\tm9 = (2 < n) ? u9 : 0;\n\t} else {\n\t\tm0 = (0 < n) ? -tap(n - 1, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm1 = (1 < n) ? -tap(n - 2, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm2 = (2 < n) ? -tap(n - 3, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm3 = (3 < n) ? -tap(n - 4, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm4 = (4 < n) ? -tap(n - 5, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm5 = (5 < n) ? -tap(n - 6, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm6 = (6 < n) ? -tap(n - 7, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm7 = (7 < n) ? -tap(n - 8, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm8 = (8 < n) ? -tap(n - 9, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t\tm9 = (9 < n) ? -tap(n - 10, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\t}\n\treturn m0, m1, m2, m3, m4, m5, m6, m7, m8, m9;\n}\n\nBuffer cfg(\"tsconfig\");\nBuffer meters(\"tsmeters\");\n\nParam size(0.45);\nParam damp(0.2);\nParam width(0.7);\nParam wet(0.35);\nParam fbk(0.4);\nParam predly(0);\nParam modamt(0.15);\nParam xfeed(0.25);\nParam hp(40);\nParam lp(14000);\nParam duck(1);\nHistory tick(0);\nHistory o0(0);\nHistory o1(0);\nHistory o2(0);\nHistory o3(0);\nHistory o4(0);\nHistory o5(0);\nHistory o6(0);\nHistory o7(0);\nHistory o8(0);\nHistory o9(0);\nHistory o10(0);\nHistory o11(0);\nHistory o12(0);\nHistory o13(0);\nHistory o14(0);\nHistory o15(0);\nHistory o16(0);\nHistory o17(0);\nHistory o18(0);\nHistory o19(0);\nHistory awake(1);\nHistory idleCount(0);\nHistory tankE(0);\nHistory initDone(0);\nHistory activeCount(0);\nDelay preDL(65536);\nDelay preDR(65536);\nDelay del0(16384);\nDelay del1(16384);\nDelay del2(16384);\nDelay del3(16384);\nDelay del4(16384);\nDelay del5(16384);\nDelay del6(16384);\nDelay del7(16384);\nDelay del8(16384);\nDelay del9(16384);\nDelay del10(16384);\nDelay del11(16384);\nDelay del12(16384);\nDelay del13(16384);\nDelay del14(16384);\nDelay del15(16384);\nDelay del16(16384);\nDelay del17(16384);\nDelay del18(16384);\nDelay del19(16384);\n\nsizeS = slew(size, 0.9992);\ndampS = slew(damp, 0.9992);\nwidthS = slew(width, 0.9992);\nwetS = slew(wet, 0.9992);\nfbkS = slew(fbk, 0.9992);\npredlyS = slew(predly, 0.9992);\nmodS = slew(modamt, 0.9992);\nxfeedS = slew(xfeed, 0.9992);\nhpS = slew(hp, 0.9992);\nlpS = slew(lp, 0.9992);\nduckG = clip(duck, 0, 1);\nsr = max(samplerate, 1);\ninAbs = abs(in1) + abs(in2);\n// -100 dB. DAW dither and denormals sit quieter than this and must not wake the tank.\nawake = (inAbs > 0.00001) ? 1 : awake;\nidleCount = (inAbs > 0.00001) ? 0 : idleCount;\n\npreDL.write(in1);\npreDR.write(in2);\n\nwetL = 0;\nwetR = 0;\ntankE = 0;\nenv0 = 0;\nenv1 = 0;\nenv2 = 0;\nenv3 = 0;\nenv4 = 0;\nenv5 = 0;\nenv6 = 0;\nenv7 = 0;\nenv8 = 0;\nenv9 = 0;\nenv10 = 0;\nenv11 = 0;\nenv12 = 0;\nenv13 = 0;\nenv14 = 0;\nenv15 = 0;\nenv16 = 0;\nenv17 = 0;\nenv18 = 0;\nenv19 = 0;\n\nif (awake > 0.5) {\n\tcfgCount = peek(cfg, 0);\n\trefresh = ((initDone == 0) || (tick == 0) || (cfgCount != activeCount)) ? 1 : 0;\n\tif (refresh > 0.5) {\n\t\tinitDone = 1;\n\t\tactiveCount = cfgCount;\n\t}\n\tcharacter = clip(peek(cfg, 1), 0, 1);\n\t\tmodel = round(clip(peek(cfg, 70), 0, 7));\n\t\tnL = activeCount * 0.5;\n\t\tnR = nL;\n\t\tinvL = 1 / sqrt(max(nL, 1));\n\t\tinvR = 1 / sqrt(max(nR, 1));\n\t\tchClip = clip(character, 0, 1);\n\t\thc = cos(chClip * 3.141592653589793);\n\t\ths = sin(chClip * 3.141592653589793);\n\t\tlpCoef = exp(-6.28318530718 * clip(lpS, 400, 18000) / sr);\n\t\thpCoef = exp(-6.28318530718 * clip(hpS, 20, 4000) / sr);\n\t\tapT0 = clip(peek(cfg, 2) * sr / 1000, 1, sr * 0.02);\n\t\tapT1 = clip(peek(cfg, 3) * sr / 1000, 1, sr * 0.02);\n\t\tapT2 = clip(peek(cfg, 4) * sr / 1000, 1, sr * 0.02);\n\t\tapT3 = clip(peek(cfg, 5) * sr / 1000, 1, sr * 0.02);\n\t\tapG0 = clip(peek(cfg, 6), 0, 0.7);\n\t\tapG1 = clip(peek(cfg, 7), 0, 0.7);\n\t\tapG2 = clip(peek(cfg, 8), 0, 0.7);\n\tapG3 = clip(peek(cfg, 9), 0, 0.7);\n\tmodNow = clip(modS, 0, 1);\n\t\t\tl0 = 0;\n\t\t\tl1 = 0;\n\t\t\tl2 = 0;\n\t\t\tl3 = 0;\n\t\t\tl4 = 0;\n\t\t\tl5 = 0;\n\t\t\tl6 = 0;\n\t\t\tl7 = 0;\n\t\t\tl8 = 0;\n\t\t\tl9 = 0;\n\t\t\tl10 = 0;\n\t\t\tl11 = 0;\n\t\t\tl12 = 0;\n\t\t\tl13 = 0;\n\t\t\tl14 = 0;\n\t\t\tl15 = 0;\n\t\t\tl16 = 0;\n\t\t\tl17 = 0;\n\t\t\tl18 = 0;\n\t\t\tl19 = 0;\n\t\t\tif (modNow > 0.001) {\n\t\t\t\tl0 = lfo(peek(cfg, 50), 1);\n\t\t\t\tl1 = lfo(peek(cfg, 51), 1);\n\t\t\t\tl2 = lfo(peek(cfg, 52), 1);\n\t\t\t\tl3 = lfo(peek(cfg, 53), 1);\n\t\t\t\tl4 = lfo(peek(cfg, 54), 1);\n\t\t\t\tl5 = lfo(peek(cfg, 55), 1);\n\t\t\t\tl6 = lfo(peek(cfg, 56), 1);\n\t\t\t\tl7 = lfo(peek(cfg, 57), 1);\n\t\t\t\tl8 = lfo(peek(cfg, 58), 1);\n\t\t\t\tl9 = lfo(peek(cfg, 59), 1);\n\t\t\t\tl10 = lfo(peek(cfg, 60), 1);\n\t\t\t\tl11 = lfo(peek(cfg, 61), 1);\n\t\t\t\tl12 = lfo(peek(cfg, 62), 1);\n\t\t\t\tl13 = lfo(peek(cfg, 63), 1);\n\t\t\t\tl14 = lfo(peek(cfg, 64), 1);\n\t\t\t\tl15 = lfo(peek(cfg, 65), 1);\n\t\t\t\tl16 = lfo(peek(cfg, 66), 1);\n\t\t\t\tl17 = lfo(peek(cfg, 67), 1);\n\t\t\t\tl18 = lfo(peek(cfg, 68), 1);\n\t\t\t\tl19 = lfo(peek(cfg, 69), 1);\n\t\t\t}\n\t\t\tt0 = lineTime(peek(cfg, 10), l0, sizeS, modS);\n\t\t\tt1 = lineTime(peek(cfg, 11), l1, sizeS, modS);\n\t\t\tt2 = lineTime(peek(cfg, 12), l2, sizeS, modS);\n\t\t\tt3 = lineTime(peek(cfg, 13), l3, sizeS, modS);\n\t\t\tt4 = lineTime(peek(cfg, 14), l4, sizeS, modS);\n\t\t\tt5 = lineTime(peek(cfg, 15), l5, sizeS, modS);\n\t\t\tt6 = lineTime(peek(cfg, 16), l6, sizeS, modS);\n\t\t\tt7 = lineTime(peek(cfg, 17), l7, sizeS, modS);\n\t\t\tt8 = lineTime(peek(cfg, 18), l8, sizeS, modS);\n\t\t\tt9 = lineTime(peek(cfg, 19), l9, sizeS, modS);\n\t\t\tt10 = lineTime(peek(cfg, 20), l10, sizeS, modS);\n\t\t\tt11 = lineTime(peek(cfg, 21), l11, sizeS, modS);\n\t\t\tt12 = lineTime(peek(cfg, 22), l12, sizeS, modS);\n\t\t\tt13 = lineTime(peek(cfg, 23), l13, sizeS, modS);\n\t\t\tt14 = lineTime(peek(cfg, 24), l14, sizeS, modS);\n\t\t\tt15 = lineTime(peek(cfg, 25), l15, sizeS, modS);\n\t\t\tt16 = lineTime(peek(cfg, 26), l16, sizeS, modS);\n\t\t\tt17 = lineTime(peek(cfg, 27), l17, sizeS, modS);\n\t\t\tt18 = lineTime(peek(cfg, 28), l18, sizeS, modS);\n\t\t\tt19 = lineTime(peek(cfg, 29), l19, sizeS, modS);\n\t\t\tc0 = dampCoef(t0, dampS, peek(cfg, 30));\n\t\t\tc1 = dampCoef(t1, dampS, peek(cfg, 31));\n\t\t\tc2 = dampCoef(t2, dampS, peek(cfg, 32));\n\t\t\tc3 = dampCoef(t3, dampS, peek(cfg, 33));\n\t\t\tc4 = dampCoef(t4, dampS, peek(cfg, 34));\n\t\t\tc5 = dampCoef(t5, dampS, peek(cfg, 35));\n\t\t\tc6 = dampCoef(t6, dampS, peek(cfg, 36));\n\t\t\tc7 = dampCoef(t7, dampS, peek(cfg, 37));\n\t\t\tc8 = dampCoef(t8, dampS, peek(cfg, 38));\n\t\t\tc9 = dampCoef(t9, dampS, peek(cfg, 39));\n\t\t\tc10 = dampCoef(t10, dampS, peek(cfg, 40));\n\t\t\tc11 = dampCoef(t11, dampS, peek(cfg, 41));\n\t\t\tc12 = dampCoef(t12, dampS, peek(cfg, 42));\n\t\t\tc13 = dampCoef(t13, dampS, peek(cfg, 43));\n\t\t\tc14 = dampCoef(t14, dampS, peek(cfg, 44));\n\t\t\tc15 = dampCoef(t15, dampS, peek(cfg, 45));\n\t\t\tc16 = dampCoef(t16, dampS, peek(cfg, 46));\n\t\t\tc17 = dampCoef(t17, dampS, peek(cfg, 47));\n\t\t\tc18 = dampCoef(t18, dampS, peek(cfg, 48));\n\t\t\tc19 = dampCoef(t19, dampS, peek(cfg, 49));\n\t\t\trtNow = feedbackRt(fbkS);\n\t\t\tg0 = ringGain(t0, rtNow);\n\t\t\tg1 = ringGain(t1, rtNow);\n\t\t\tg2 = ringGain(t2, rtNow);\n\t\t\tg3 = ringGain(t3, rtNow);\n\t\t\tg4 = ringGain(t4, rtNow);\n\t\t\tg5 = ringGain(t5, rtNow);\n\t\t\tg6 = ringGain(t6, rtNow);\n\t\t\tg7 = ringGain(t7, rtNow);\n\t\t\tg8 = ringGain(t8, rtNow);\n\t\t\tg9 = ringGain(t9, rtNow);\n\t\t\tg10 = ringGain(t10, rtNow);\n\t\t\tg11 = ringGain(t11, rtNow);\n\t\t\tg12 = ringGain(t12, rtNow);\n\t\t\tg13 = ringGain(t13, rtNow);\n\t\t\tg14 = ringGain(t14, rtNow);\n\t\t\tg15 = ringGain(t15, rtNow);\n\t\t\tg16 = ringGain(t16, rtNow);\n\t\t\tg17 = ringGain(t17, rtNow);\n\t\t\tg18 = ringGain(t18, rtNow);\n\t\t\tg19 = ringGain(t19, rtNow);\n\txf = clip(xfeedS, 0, 1);\n\tcth = cos(xf * 1.5707963267948966);\n\tsth = sin(xf * 1.5707963267948966);\n\ta0 = (0 < nL) ? 1 : 0;\n\ta1 = (1 < nL) ? 1 : 0;\n\ta2 = (2 < nL) ? 1 : 0;\n\ta3 = (3 < nL) ? 1 : 0;\n\ta4 = (4 < nL) ? 1 : 0;\n\ta5 = (5 < nL) ? 1 : 0;\n\ta6 = (6 < nL) ? 1 : 0;\n\ta7 = (7 < nL) ? 1 : 0;\n\ta8 = (8 < nL) ? 1 : 0;\n\ta9 = (9 < nL) ? 1 : 0;\n\ta10 = (0 < nR) ? 1 : 0;\n\ta11 = (1 < nR) ? 1 : 0;\n\ta12 = (2 < nR) ? 1 : 0;\n\ta13 = (3 < nR) ? 1 : 0;\n\ta14 = (4 < nR) ? 1 : 0;\n\ta15 = (5 < nR) ? 1 : 0;\n\ta16 = (6 < nR) ? 1 : 0;\n\ta17 = (7 < nR) ? 1 : 0;\n\ta18 = (8 < nR) ? 1 : 0;\n\ta19 = (9 < nR) ? 1 : 0;\n\n\tpreSamps = clip(predlyS, 0, 250) * sr / 1000;\n\tpreSamps = clip(preSamps, 0, 48000);\n\tpreL = preDL.read(preSamps, interp=\"linear\");\n\tpreR = preDR.read(preSamps, interp=\"linear\");\n\ttoneL = hp(lp(preL, lpCoef), hpCoef);\n\ttoneR = hp(lp(preR, lpCoef), hpCoef);\n\taL = allpass(toneL, apT0, apG0);\n\taL = allpass(aL, apT1, apG1);\n\taL = allpass(aL, apT2, apG2);\n\taL = allpass(aL, apT3, apG3);\n\taR = allpass(toneR, apT0, apG0);\n\taR = allpass(aR, apT1, apG1);\n\taR = allpass(aR, apT2, apG2);\n\taR = allpass(aR, apT3, apG3);\n\tinjL = aL * invL;\n\tinjR = aR * invR;\n\n\tm0, m1, m2, m3, m4, m5, m6, m7, m8, m9 = house(o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, nL, model, hc, hs);\n\tm10, m11, m12, m13, m14, m15, m16, m17, m18, m19 = house(o10, o11, o12, o13, o14, o15, o16, o17, o18, o19, nR, model, hc, hs);\n\tx0 = cth * m0 + sth * m10;\n\tx1 = cth * m1 + sth * m11;\n\tx2 = cth * m2 + sth * m12;\n\tx3 = cth * m3 + sth * m13;\n\tx4 = cth * m4 + sth * m14;\n\tx5 = cth * m5 + sth * m15;\n\tx6 = cth * m6 + sth * m16;\n\tx7 = cth * m7 + sth * m17;\n\tx8 = cth * m8 + sth * m18;\n\tx9 = cth * m9 + sth * m19;\n\tx10 = -sth * m0 + cth * m10;\n\tx11 = -sth * m1 + cth * m11;\n\tx12 = -sth * m2 + cth * m12;\n\tx13 = -sth * m3 + cth * m13;\n\tx14 = -sth * m4 + cth * m14;\n\tx15 = -sth * m5 + cth * m15;\n\tx16 = -sth * m6 + cth * m16;\n\tx17 = -sth * m7 + cth * m17;\n\tx18 = -sth * m8 + cth * m18;\n\tx19 = -sth * m9 + cth * m19;\n\n\tz0 = a0 * (clip(x0, -2, 2) * g0 * duckG + injL);\n\tz1 = a1 * (clip(x1, -2, 2) * g1 * duckG + injL);\n\tz2 = a2 * (clip(x2, -2, 2) * g2 * duckG + injL);\n\tz3 = a3 * (clip(x3, -2, 2) * g3 * duckG + injL);\n\tz4 = a4 * (clip(x4, -2, 2) * g4 * duckG + injL);\n\tz5 = a5 * (clip(x5, -2, 2) * g5 * duckG + injL);\n\tz6 = a6 * (clip(x6, -2, 2) * g6 * duckG + injL);\n\tz7 = a7 * (clip(x7, -2, 2) * g7 * duckG + injL);\n\tz8 = a8 * (clip(x8, -2, 2) * g8 * duckG + injL);\n\tz9 = a9 * (clip(x9, -2, 2) * g9 * duckG + injL);\n\tz10 = a10 * (clip(x10, -2, 2) * g10 * duckG + injR);\n\tz11 = a11 * (clip(x11, -2, 2) * g11 * duckG + injR);\n\tz12 = a12 * (clip(x12, -2, 2) * g12 * duckG + injR);\n\tz13 = a13 * (clip(x13, -2, 2) * g13 * duckG + injR);\n\tz14 = a14 * (clip(x14, -2, 2) * g14 * duckG + injR);\n\tz15 = a15 * (clip(x15, -2, 2) * g15 * duckG + injR);\n\tz16 = a16 * (clip(x16, -2, 2) * g16 * duckG + injR);\n\tz17 = a17 * (clip(x17, -2, 2) * g17 * duckG + injR);\n\tz18 = a18 * (clip(x18, -2, 2) * g18 * duckG + injR);\n\tz19 = a19 * (clip(x19, -2, 2) * g19 * duckG + injR);\n\tdel0.write(z0);\n\tdel1.write(z1);\n\tdel2.write(z2);\n\tdel3.write(z3);\n\tdel4.write(z4);\n\tdel5.write(z5);\n\tdel6.write(z6);\n\tdel7.write(z7);\n\tdel8.write(z8);\n\tdel9.write(z9);\n\tdel10.write(z10);\n\tdel11.write(z11);\n\tdel12.write(z12);\n\tdel13.write(z13);\n\tdel14.write(z14);\n\tdel15.write(z15);\n\tdel16.write(z16);\n\tdel17.write(z17);\n\tdel18.write(z18);\n\tdel19.write(z19);\n\to0 = lp(del0.read(t0, interp=\"linear\") * a0, c0);\n\to1 = lp(del1.read(t1, interp=\"linear\") * a1, c1);\n\to2 = lp(del2.read(t2, interp=\"linear\") * a2, c2);\n\to3 = lp(del3.read(t3, interp=\"linear\") * a3, c3);\n\to4 = lp(del4.read(t4, interp=\"linear\") * a4, c4);\n\to5 = lp(del5.read(t5, interp=\"linear\") * a5, c5);\n\to6 = lp(del6.read(t6, interp=\"linear\") * a6, c6);\n\to7 = lp(del7.read(t7, interp=\"linear\") * a7, c7);\n\to8 = lp(del8.read(t8, interp=\"linear\") * a8, c8);\n\to9 = lp(del9.read(t9, interp=\"linear\") * a9, c9);\n\to10 = lp(del10.read(t10, interp=\"linear\") * a10, c10);\n\to11 = lp(del11.read(t11, interp=\"linear\") * a11, c11);\n\to12 = lp(del12.read(t12, interp=\"linear\") * a12, c12);\n\to13 = lp(del13.read(t13, interp=\"linear\") * a13, c13);\n\to14 = lp(del14.read(t14, interp=\"linear\") * a14, c14);\n\to15 = lp(del15.read(t15, interp=\"linear\") * a15, c15);\n\to16 = lp(del16.read(t16, interp=\"linear\") * a16, c16);\n\to17 = lp(del17.read(t17, interp=\"linear\") * a17, c17);\n\to18 = lp(del18.read(t18, interp=\"linear\") * a18, c18);\n\to19 = lp(del19.read(t19, interp=\"linear\") * a19, c19);\n\tenv0 = follow(o0);\n\tenv1 = follow(o1);\n\tenv2 = follow(o2);\n\tenv3 = follow(o3);\n\tenv4 = follow(o4);\n\tenv5 = follow(o5);\n\tenv6 = follow(o6);\n\tenv7 = follow(o7);\n\tenv8 = follow(o8);\n\tenv9 = follow(o9);\n\tenv10 = follow(o10);\n\tenv11 = follow(o11);\n\tenv12 = follow(o12);\n\tenv13 = follow(o13);\n\tenv14 = follow(o14);\n\tenv15 = follow(o15);\n\tenv16 = follow(o16);\n\tenv17 = follow(o17);\n\tenv18 = follow(o18);\n\tenv19 = follow(o19);\n\ttankE = env0 + env1 + env2 + env3 + env4 + env5 + env6 + env7 + env8 + env9 + env10 + env11 + env12 + env13 + env14 + env15 + env16 + env17 + env18 + env19;\n\tsumL = (o0 + o1 + o2 + o3 + o4 + o5 + o6 + o7 + o8 + o9) * invL;\n\tsumR = (o10 + o11 + o12 + o13 + o14 + o15 + o16 + o17 + o18 + o19) * invR;\n\tmid = (sumL + sumR) * 0.5;\n\tside = (sumL - sumR) * 0.5 * clip(widthS, 0, 1);\n\twetL = (mid + side) * duckG;\n\twetR = (mid - side) * duckG;\n} else {\n\to0 = 0;\n\to1 = 0;\n\to2 = 0;\n\to3 = 0;\n\to4 = 0;\n\to5 = 0;\n\to6 = 0;\n\to7 = 0;\n\to8 = 0;\n\to9 = 0;\n\to10 = 0;\n\to11 = 0;\n\to12 = 0;\n\to13 = 0;\n\to14 = 0;\n\to15 = 0;\n\to16 = 0;\n\to17 = 0;\n\to18 = 0;\n\to19 = 0;\n}\nang = clip(wetS, 0, 1) * 1.57079632679;\ndryG = cos(ang);\nwetG = sin(ang);\nout1 = fixnan(in1 * dryG + wetL * wetG);\nout2 = fixnan(in2 * dryG + wetR * wetG);\n\ntick = wrap(tick + 1, 0, 32);\nif (tick == 0) {\n\tidleCount = ((inAbs > 0.00001) || (tankE > 0.00001)) ? 0 : (idleCount + 1);\n\tawake = ((inAbs > 0.00001) || (tankE > 0.00001)) ? 1 : ((idleCount > 200) ? 0 : awake);\n\tpoke(meters, env0, 0, 0);\n\tpoke(meters, env1, 1, 0);\n\tpoke(meters, env2, 2, 0);\n\tpoke(meters, env3, 3, 0);\n\tpoke(meters, env4, 4, 0);\n\tpoke(meters, env5, 5, 0);\n\tpoke(meters, env6, 6, 0);\n\tpoke(meters, env7, 7, 0);\n\tpoke(meters, env8, 8, 0);\n\tpoke(meters, env9, 9, 0);\n\tpoke(meters, env10, 10, 0);\n\tpoke(meters, env11, 11, 0);\n\tpoke(meters, env12, 12, 0);\n\tpoke(meters, env13, 13, 0);\n\tpoke(meters, env14, 14, 0);\n\tpoke(meters, env15, 15, 0);\n\tpoke(meters, env16, 16, 0);\n\tpoke(meters, env17, 17, 0);\n\tpoke(meters, env18, 18, 0);\n\tpoke(meters, env19, 19, 0);\n}\n",
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
					"text": "js /Users/mrwilson/software/ableton/tests/tinyspace_probe.js impulse ring7"
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
					"id": "obj-click",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						200.0,
						50.0,
						20.0
					],
					"text": "click~"
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
			},
			{
				"box": {
					"id": "obj-del-click",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						700.0,
						160.0,
						70.0,
						20.0
					],
					"text": "delay 40"
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
						"obj-click",
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
			},
			{
				"patchline": {
					"source": [
						"obj-del-arm",
						0
					],
					"destination": [
						"obj-del-click",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-del-click",
						0
					],
					"destination": [
						"obj-click",
						0
					]
				}
			}
		]
	}
}
