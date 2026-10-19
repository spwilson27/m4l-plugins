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
					"text": "delay 1200"
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
					"text": "analyze 1200"
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
					"text": "size 0, damp 1, width 1, wet 1, fbk 1, predly 0, modamt 0, xfeed 0, hp 20, lp 18000, duck 1"
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
					"code": "// Tiny Space \u2014 20-line feedback delay network.\n// Config buffer (buffer~ #0-tsconfig), indices match src/tinyspace_config.js:\n//   0 activeCount, 1 character,\n//   2..5 allpass lengths (ms), 6..9 allpass gains,\n//   10..29 nominal delay (ms), 30..49 damp offset, 50..69 mod Hz.\n// Meter buffer (buffer~ #0-tsmeters) is one envelope per line.\n// GenExpr rejects the old delay operator. Each line is declared with Delay, then written\n// and read as a tap. Tank and pre-delay lines are 65536 samples, longer than\n// the longest tap plus a signal vector, so a short comb keeps recirculating.\n// Full feedback holds a line to about -60 dB in 27.5 seconds (see ringGain).\n// Short combs stay bright: delay taps are whole samples, and Damp 0 does not\n// lowpass the loop, so a small Size rings as a metallic tone instead of a thud.\n// The coefficient depends on that line's delay so short combs do not die\n// in a fraction of a second. It is clipped just under 1, so the tail ends.\n// Every room mix is orthogonal and keeps the all-ones mode at magnitude 1,\n// and crossfeed is a rotation, so neither one shortens that tail.\n// GenExpr requires every function to appear before Buffer, Param, and assignments.\n\nslew(target, coef) {\n\tHistory s(0);\n\tHistory init(0);\n\ts = (init == 0) ? target : mix(target, s, coef);\n\tinit = 1;\n\treturn s;\n}\n\nlfo(hz) {\n\tHistory ph(0);\n\tph = wrap(ph + hz / samplerate, 0, 1);\n\treturn sin(ph * 6.283185307179586);\n}\n\nlp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn s;\n}\n\nhp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn x - s;\n}\n\n// Schroeder allpass. Delay holds the samples; History holds the previous tap\n// so the feedback coefficient is applied to a delayed sample.\n// g near 0 (comb seeds) is a short delay of about t samples.\nallpass(x, t, g) {\n\tDelay line(4096);\n\tHistory mem(0);\n\ty = -g * x + mem;\n\tline.write(x + g * y);\n\tmem = line.read(clip(t, 1, 4000), interp=\"linear\");\n\treturn y;\n}\n\nlineTime(lenMs, lfoVal, sizeNow, modNow) {\n\tsc = 0.22 + clip(sizeNow, 0, 1) * 1.93;\n\tbase = clip(lenMs * sc * samplerate / 1000, 1, 16000);\n\tdepth = min(base * 0.28, samplerate * 0.0012) * clip(modNow, 0, 1);\n\t// Whole-sample taps. Linear interpolation would shave a little high end\n\t// off every pass, and a 1 ms comb passes often enough that the tone dies.\n\treturn round(clip(base + lfoVal * depth, 1, 16000));\n}\n\nfollow(x) {\n\tHistory s(0);\n\tax = abs(x);\n\ts = mix(ax, s, (ax > s) ? 0.45 : 0.992);\n\treturn s;\n}\n\n// Delay-style RT60. 50% is a short slap (~0.7 s); 100% is about 27.5 s to -60 dB.\n// rt = 2.90663 k^2 - 0.81561 k^4 + 7.05921 k^6 - 1.60268 k^10 + 19.9526 k^16\n// Matches feedbackRt60() in tinyspace_config.js. fbk 0 does not recirculate.\n// The gain ceiling sits just under 1 so a 1-sample comb still ends.\nringGain(delaySamps, fbkNow) {\n\tk = clip(fbkNow, 0, 1);\n\tsecs = max(delaySamps, 1) / samplerate;\n\tk2 = k * k;\n\tk4 = k2 * k2;\n\tk6 = k4 * k2;\n\tk10 = k6 * k4;\n\tk16 = k10 * k6;\n\trtRaw = 2.90663 * k2 - 0.81561 * k4 + 7.05921 * k6 - 1.60268 * k10 + 19.9526 * k16;\n\trt = (k < 0.001) ? 1 : rtRaw;\n\tg = exp(-6.90775527898 * secs / rt);\n\tquiet = (k < 0.001) ? 0 : g;\n\treturn clip(quiet, 0, 0.9999995);\n}\n\n// One-pole lowpass coefficient. Damp 0 is a bypass (pole 0), so a bright comb\n// stays metallic. Above that, the knob is a cutoff: about 5 kHz at 20%,\n// about 1.8 kHz at 50%, and a few hundred hertz at 100% on an 8 ms line.\n// Short lines get a higher cutoff so a 1 ms comb is not filtered 20 times\n// harder than a 20 ms room line. Matches dampPole() in tinyspace_config.js.\ndampCoef(delaySamps, dampNow, offset) {\n\tamtIn = clip(dampNow, 0, 1);\n\toff = clip(offset, 0, 0.35);\n\tamt = clip(amtIn * (0.85 + 0.30 * off), 0, 1);\n\tamtPow = pow(max(amt, 0.00001), 0.75);\n\tfcBase = 16000 * pow(0.015, amtPow);\n\tspan = max(delaySamps, 1);\n\tscale = pow(0.008 * samplerate / span, 0.45);\n\tscale = clip(scale, 0.6, 3.2);\n\tfcNow = fcBase * scale;\n\tpole = exp(-6.28318530718 * fcNow / samplerate);\n\tquiet = (amtIn < 0.001) ? 0 : pole;\n\treturn clip(quiet, 0, 0.995);\n}\n\n// Rotate three samples inside the plane orthogonal to (1, 1, 1).\n// Eigenvalue of the all-ones vector is +1, and the map is orthogonal\n// for every angle (c, s) = (cos theta, sin theta). A plain 2x2 rotation\n// of two lines is orthogonal too, but its common-mode gain is only cos(theta),\n// which would silence the output sum. Mirrors spin3() in tinyspace_config.js.\nspin3(x0, x1, x2, c, s) {\n\tu0 = 0.7071067811865476;\n\tu1 = -0.7071067811865476;\n\tv0 = 0.40824829046386302;\n\tv1 = 0.40824829046386302;\n\tv2 = -0.81649658092772603;\n\tpu = x0 * u0 + x1 * u1;\n\tpv = x0 * v0 + x1 * v1 + x2 * v2;\n\tf = c - 1;\n\ty0 = x0 + f * (pu * u0 + pv * v0) + s * (pu * v0 - pv * u0);\n\ty1 = x1 + f * (pu * u1 + pv * v1) + s * (pu * v1 - pv * u1);\n\ty2 = x2 + f * (pv * v2) + s * (pu * v2);\n\treturn y0, y1, y2;\n}\n\ntap(i, a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) {\n\treturn (i < 0.5) ? a0 : ((i < 1.5) ? a1 : ((i < 2.5) ? a2 : ((i < 3.5) ? a3 : ((i < 4.5) ? a4 : ((i < 5.5) ? a5 : ((i < 6.5) ? a6 : ((i < 7.5) ? a7 : ((i < 8.5) ? a8 : a9))))))));\n}\n\n// Eight orthogonal room topologies. Each one satisfies M^T M = I and sends\n// the all-ones vector to \u00b1 itself, so the normalized output sum decays only\n// through ringGain. Mirrors fdnMix() in tinyspace_config.js.\n//   0 COMB    identity (parallel combs)\n//   1 HYBRID  character-scaled rotation in the plane orthogonal to all-ones\n//   2 ROOM    Householder reflection\n//   3 PLATE   Householder, then a sign-flipping cycle\n//   4 TANK    sign-flipping cycle (figure-8 ring)\n//   5 BOX     Householder, then pairwise wall swaps\n//   6 SPRING  overlapping sum-preserving rotations (dispersion lattice)\n//   7 BOUNCE  sign-flipping reversal\nhouse(o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, n, character, model) {\n\tz0 = (0 < n) ? o0 : 0;\n\tz1 = (1 < n) ? o1 : 0;\n\tz2 = (2 < n) ? o2 : 0;\n\tz3 = (3 < n) ? o3 : 0;\n\tz4 = (4 < n) ? o4 : 0;\n\tz5 = (5 < n) ? o5 : 0;\n\tz6 = (6 < n) ? o6 : 0;\n\tz7 = (7 < n) ? o7 : 0;\n\tz8 = (8 < n) ? o8 : 0;\n\tz9 = (9 < n) ? o9 : 0;\n\n\tsum = z0 + z1 + z2 + z3 + z4 + z5 + z6 + z7 + z8 + z9;\n\tkk = 2 / max(n, 1);\n\thh0 = (0 < n) ? (z0 - sum * kk) : 0;\n\thh1 = (1 < n) ? (z1 - sum * kk) : 0;\n\thh2 = (2 < n) ? (z2 - sum * kk) : 0;\n\thh3 = (3 < n) ? (z3 - sum * kk) : 0;\n\thh4 = (4 < n) ? (z4 - sum * kk) : 0;\n\thh5 = (5 < n) ? (z5 - sum * kk) : 0;\n\thh6 = (6 < n) ? (z6 - sum * kk) : 0;\n\thh7 = (7 < n) ? (z7 - sum * kk) : 0;\n\thh8 = (8 < n) ? (z8 - sum * kk) : 0;\n\thh9 = (9 < n) ? (z9 - sum * kk) : 0;\n\n\t// HYBRID. Groups of three, angle = character * pi. character 0 is identity.\n\thc = cos(clip(character, 0, 1) * 3.141592653589793);\n\ths = sin(clip(character, 0, 1) * 3.141592653589793);\n\tq0, q1, q2 = spin3(z0, z1, z2, hc, hs);\n\thb0 = (2 < n) ? q0 : z0;\n\thb1 = (2 < n) ? q1 : z1;\n\thb2 = (2 < n) ? q2 : z2;\n\tq0, q1, q2 = spin3(z3, z4, z5, hc, hs);\n\thb3 = (5 < n) ? q0 : z3;\n\thb4 = (5 < n) ? q1 : z4;\n\thb5 = (5 < n) ? q2 : z5;\n\tq0, q1, q2 = spin3(z6, z7, z8, hc, hs);\n\thb6 = (8 < n) ? q0 : z6;\n\thb7 = (8 < n) ? q1 : z7;\n\thb8 = (8 < n) ? q2 : z8;\n\thb9 = z9;\n\n\t// PLATE and TANK share a sign-flipping cycle. Plate cycles the Householder\n\t// mix; tank cycles the raw lines. Every sign is negative so an even-length\n\t// ring still maps all-ones to \u00b1all-ones (alternating signs would null the sum).\n\tlastH = tap(n - 1, hh0, hh1, hh2, hh3, hh4, hh5, hh6, hh7, hh8, hh9);\n\tp0 = (0 < n) ? -lastH : 0;\n\tp1 = (1 < n) ? -hh0 : 0;\n\tp2 = (2 < n) ? -hh1 : 0;\n\tp3 = (3 < n) ? -hh2 : 0;\n\tp4 = (4 < n) ? -hh3 : 0;\n\tp5 = (5 < n) ? -hh4 : 0;\n\tp6 = (6 < n) ? -hh5 : 0;\n\tp7 = (7 < n) ? -hh6 : 0;\n\tp8 = (8 < n) ? -hh7 : 0;\n\tp9 = (9 < n) ? -hh8 : 0;\n\n\tlastZ = tap(n - 1, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9);\n\tr0 = (0 < n) ? -lastZ : 0;\n\tr1 = (1 < n) ? -z0 : 0;\n\tr2 = (2 < n) ? -z1 : 0;\n\tr3 = (3 < n) ? -z2 : 0;\n\tr4 = (4 < n) ? -z3 : 0;\n\tr5 = (5 < n) ? -z4 : 0;\n\tr6 = (6 < n) ? -z5 : 0;\n\tr7 = (7 < n) ? -z6 : 0;\n\tr8 = (8 < n) ? -z7 : 0;\n\tr9 = (9 < n) ? -z8 : 0;\n\n\t// BOX: local wall exchange after the Householder scatter.\n\tbx0 = (1 < n) ? -hh1 : ((0 < n) ? -hh0 : 0);\n\tbx1 = (1 < n) ? -hh0 : 0;\n\tbx2 = (3 < n) ? -hh3 : ((2 < n) ? -hh2 : 0);\n\tbx3 = (3 < n) ? -hh2 : 0;\n\tbx4 = (5 < n) ? -hh5 : ((4 < n) ? -hh4 : 0);\n\tbx5 = (5 < n) ? -hh4 : 0;\n\tbx6 = (7 < n) ? -hh7 : ((6 < n) ? -hh6 : 0);\n\tbx7 = (7 < n) ? -hh6 : 0;\n\tbx8 = (9 < n) ? -hh9 : ((8 < n) ? -hh8 : 0);\n\tbx9 = (9 < n) ? -hh8 : 0;\n\n\t// SPRING: overlapping spins at a fixed angle. Two-line springs just invert.\n\tsc = cos(1.15);\n\tss = sin(1.15);\n\tu0 = z0;\n\tu1 = z1;\n\tu2 = z2;\n\tu3 = z3;\n\tu4 = z4;\n\tu5 = z5;\n\tu6 = z6;\n\tu7 = z7;\n\tu8 = z8;\n\tu9 = z9;\n\tq0, q1, q2 = spin3(u0, u1, u2, sc, ss);\n\tu0 = (2 < n) ? q0 : u0;\n\tu1 = (2 < n) ? q1 : u1;\n\tu2 = (2 < n) ? q2 : u2;\n\tq0, q1, q2 = spin3(u1, u2, u3, sc, ss);\n\tu1 = (3 < n) ? q0 : u1;\n\tu2 = (3 < n) ? q1 : u2;\n\tu3 = (3 < n) ? q2 : u3;\n\tq0, q1, q2 = spin3(u2, u3, u4, sc, ss);\n\tu2 = (4 < n) ? q0 : u2;\n\tu3 = (4 < n) ? q1 : u3;\n\tu4 = (4 < n) ? q2 : u4;\n\tq0, q1, q2 = spin3(u3, u4, u5, sc, ss);\n\tu3 = (5 < n) ? q0 : u3;\n\tu4 = (5 < n) ? q1 : u4;\n\tu5 = (5 < n) ? q2 : u5;\n\tq0, q1, q2 = spin3(u4, u5, u6, sc, ss);\n\tu4 = (6 < n) ? q0 : u4;\n\tu5 = (6 < n) ? q1 : u5;\n\tu6 = (6 < n) ? q2 : u6;\n\tq0, q1, q2 = spin3(u5, u6, u7, sc, ss);\n\tu5 = (7 < n) ? q0 : u5;\n\tu6 = (7 < n) ? q1 : u6;\n\tu7 = (7 < n) ? q2 : u7;\n\tq0, q1, q2 = spin3(u6, u7, u8, sc, ss);\n\tu6 = (8 < n) ? q0 : u6;\n\tu7 = (8 < n) ? q1 : u7;\n\tu8 = (8 < n) ? q2 : u8;\n\tq0, q1, q2 = spin3(u7, u8, u9, sc, ss);\n\tu7 = (9 < n) ? q0 : u7;\n\tu8 = (9 < n) ? q1 : u8;\n\tu9 = (9 < n) ? q2 : u9;\n\tsp0 = (2 < n) ? u0 : ((0 < n) ? -z0 : 0);\n\tsp1 = (2 < n) ? u1 : ((1 < n) ? -z1 : 0);\n\tsp2 = (2 < n) ? u2 : 0;\n\tsp3 = (2 < n) ? u3 : 0;\n\tsp4 = (2 < n) ? u4 : 0;\n\tsp5 = (2 < n) ? u5 : 0;\n\tsp6 = (2 < n) ? u6 : 0;\n\tsp7 = (2 < n) ? u7 : 0;\n\tsp8 = (2 < n) ? u8 : 0;\n\tsp9 = (2 < n) ? u9 : 0;\n\n\t// BOUNCE: reverse the active lines and flip every sign.\n\tbn0 = (0 < n) ? -tap(n - 1, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn1 = (1 < n) ? -tap(n - 2, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn2 = (2 < n) ? -tap(n - 3, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn3 = (3 < n) ? -tap(n - 4, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn4 = (4 < n) ? -tap(n - 5, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn5 = (5 < n) ? -tap(n - 6, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn6 = (6 < n) ? -tap(n - 7, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn7 = (7 < n) ? -tap(n - 8, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn8 = (8 < n) ? -tap(n - 9, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\tbn9 = (9 < n) ? -tap(n - 10, z0, z1, z2, z3, z4, z5, z6, z7, z8, z9) : 0;\n\n\tisHyb = (model == 1);\n\tisRoom = (model == 2);\n\tisPlate = (model == 3);\n\tisTank = (model == 4);\n\tisBox = (model == 5);\n\tisSpring = (model == 6);\n\tisBounce = (model == 7);\n\n\tm0 = isHyb ? hb0 : (isRoom ? hh0 : (isPlate ? p0 : (isTank ? r0 : (isBox ? bx0 : (isSpring ? sp0 : (isBounce ? bn0 : z0))))));\n\tm1 = isHyb ? hb1 : (isRoom ? hh1 : (isPlate ? p1 : (isTank ? r1 : (isBox ? bx1 : (isSpring ? sp1 : (isBounce ? bn1 : z1))))));\n\tm2 = isHyb ? hb2 : (isRoom ? hh2 : (isPlate ? p2 : (isTank ? r2 : (isBox ? bx2 : (isSpring ? sp2 : (isBounce ? bn2 : z2))))));\n\tm3 = isHyb ? hb3 : (isRoom ? hh3 : (isPlate ? p3 : (isTank ? r3 : (isBox ? bx3 : (isSpring ? sp3 : (isBounce ? bn3 : z3))))));\n\tm4 = isHyb ? hb4 : (isRoom ? hh4 : (isPlate ? p4 : (isTank ? r4 : (isBox ? bx4 : (isSpring ? sp4 : (isBounce ? bn4 : z4))))));\n\tm5 = isHyb ? hb5 : (isRoom ? hh5 : (isPlate ? p5 : (isTank ? r5 : (isBox ? bx5 : (isSpring ? sp5 : (isBounce ? bn5 : z5))))));\n\tm6 = isHyb ? hb6 : (isRoom ? hh6 : (isPlate ? p6 : (isTank ? r6 : (isBox ? bx6 : (isSpring ? sp6 : (isBounce ? bn6 : z6))))));\n\tm7 = isHyb ? hb7 : (isRoom ? hh7 : (isPlate ? p7 : (isTank ? r7 : (isBox ? bx7 : (isSpring ? sp7 : (isBounce ? bn7 : z7))))));\n\tm8 = isHyb ? hb8 : (isRoom ? hh8 : (isPlate ? p8 : (isTank ? r8 : (isBox ? bx8 : (isSpring ? sp8 : (isBounce ? bn8 : z8))))));\n\tm9 = isHyb ? hb9 : (isRoom ? hh9 : (isPlate ? p9 : (isTank ? r9 : (isBox ? bx9 : (isSpring ? sp9 : (isBounce ? bn9 : z9))))));\n\treturn m0, m1, m2, m3, m4, m5, m6, m7, m8, m9;\n}\n\nBuffer cfg(\"tsconfig\");\nBuffer meters(\"tsmeters\");\n\nParam size(0.45);\nParam damp(0.2);\nParam width(0.7);\nParam wet(0.35);\nParam fbk(0.4);\nParam predly(0);\nParam modamt(0.15);\nParam xfeed(0.25);\nParam hp(40);\nParam lp(14000);\nParam duck(1);\nHistory tick(0);\nHistory o0(0);\nHistory o1(0);\nHistory o2(0);\nHistory o3(0);\nHistory o4(0);\nHistory o5(0);\nHistory o6(0);\nHistory o7(0);\nHistory o8(0);\nHistory o9(0);\nHistory o10(0);\nHistory o11(0);\nHistory o12(0);\nHistory o13(0);\nHistory o14(0);\nHistory o15(0);\nHistory o16(0);\nHistory o17(0);\nHistory o18(0);\nHistory o19(0);\nDelay preDL(65536);\nDelay preDR(65536);\nDelay del0(65536);\nDelay del1(65536);\nDelay del2(65536);\nDelay del3(65536);\nDelay del4(65536);\nDelay del5(65536);\nDelay del6(65536);\nDelay del7(65536);\nDelay del8(65536);\nDelay del9(65536);\nDelay del10(65536);\nDelay del11(65536);\nDelay del12(65536);\nDelay del13(65536);\nDelay del14(65536);\nDelay del15(65536);\nDelay del16(65536);\nDelay del17(65536);\nDelay del18(65536);\nDelay del19(65536);\n\nsizeS = slew(size, 0.9992);\ndampS = slew(damp, 0.9992);\nwidthS = slew(width, 0.9992);\nwetS = slew(wet, 0.9992);\nfbkS = slew(fbk, 0.9992);\npredlyS = slew(predly, 0.9992);\nmodS = slew(modamt, 0.9992);\nxfeedS = slew(xfeed, 0.9992);\nhpS = slew(hp, 0.9992);\nlpS = slew(lp, 0.9992);\n\nactiveCount = peek(cfg, 0);\ncharacter = clip(peek(cfg, 1), 0, 1);\nmodel = round(clip(peek(cfg, 70), 0, 7));\nnL = activeCount * 0.5;\nnR = nL;\nsr = max(samplerate, 1);\nduckG = clip(duck, 0, 1);\n\npreSamps = clip(predlyS, 0, 250) * sr / 1000;\npreSamps = clip(preSamps, 0, 48000);\npreDL.write(in1);\npreDR.write(in2);\npreL = preDL.read(preSamps, interp=\"linear\");\npreR = preDR.read(preSamps, interp=\"linear\");\n\nlpCoef = exp(-6.28318530718 * clip(lpS, 400, 18000) / sr);\nhpCoef = exp(-6.28318530718 * clip(hpS, 20, 4000) / sr);\ntoneL = hp(lp(preL, lpCoef), hpCoef);\ntoneR = hp(lp(preR, lpCoef), hpCoef);\n\napT0 = clip(peek(cfg, 2) * sr / 1000, 1, sr * 0.02);\napT1 = clip(peek(cfg, 3) * sr / 1000, 1, sr * 0.02);\napT2 = clip(peek(cfg, 4) * sr / 1000, 1, sr * 0.02);\napT3 = clip(peek(cfg, 5) * sr / 1000, 1, sr * 0.02);\napG0 = clip(peek(cfg, 6), 0, 0.7);\napG1 = clip(peek(cfg, 7), 0, 0.7);\napG2 = clip(peek(cfg, 8), 0, 0.7);\napG3 = clip(peek(cfg, 9), 0, 0.7);\naL = allpass(toneL, apT0, apG0);\naL = allpass(aL, apT1, apG1);\naL = allpass(aL, apT2, apG2);\naL = allpass(aL, apT3, apG3);\naR = allpass(toneR, apT0, apG0);\naR = allpass(aR, apT1, apG1);\naR = allpass(aR, apT2, apG2);\naR = allpass(aR, apT3, apG3);\n\ninvL = 1 / sqrt(max(nL, 1));\ninvR = 1 / sqrt(max(nR, 1));\ninjL = aL * invL;\ninjR = aR * invR;\n\nlfo0 = lfo(peek(cfg, 50));\nlfo1 = lfo(peek(cfg, 51));\nlfo2 = lfo(peek(cfg, 52));\nlfo3 = lfo(peek(cfg, 53));\nlfo4 = lfo(peek(cfg, 54));\nlfo5 = lfo(peek(cfg, 55));\nlfo6 = lfo(peek(cfg, 56));\nlfo7 = lfo(peek(cfg, 57));\nlfo8 = lfo(peek(cfg, 58));\nlfo9 = lfo(peek(cfg, 59));\nlfo10 = lfo(peek(cfg, 60));\nlfo11 = lfo(peek(cfg, 61));\nlfo12 = lfo(peek(cfg, 62));\nlfo13 = lfo(peek(cfg, 63));\nlfo14 = lfo(peek(cfg, 64));\nlfo15 = lfo(peek(cfg, 65));\nlfo16 = lfo(peek(cfg, 66));\nlfo17 = lfo(peek(cfg, 67));\nlfo18 = lfo(peek(cfg, 68));\nlfo19 = lfo(peek(cfg, 69));\n\nt0 = lineTime(peek(cfg, 10), lfo0, sizeS, modS);\nt1 = lineTime(peek(cfg, 11), lfo1, sizeS, modS);\nt2 = lineTime(peek(cfg, 12), lfo2, sizeS, modS);\nt3 = lineTime(peek(cfg, 13), lfo3, sizeS, modS);\nt4 = lineTime(peek(cfg, 14), lfo4, sizeS, modS);\nt5 = lineTime(peek(cfg, 15), lfo5, sizeS, modS);\nt6 = lineTime(peek(cfg, 16), lfo6, sizeS, modS);\nt7 = lineTime(peek(cfg, 17), lfo7, sizeS, modS);\nt8 = lineTime(peek(cfg, 18), lfo8, sizeS, modS);\nt9 = lineTime(peek(cfg, 19), lfo9, sizeS, modS);\nt10 = lineTime(peek(cfg, 20), lfo10, sizeS, modS);\nt11 = lineTime(peek(cfg, 21), lfo11, sizeS, modS);\nt12 = lineTime(peek(cfg, 22), lfo12, sizeS, modS);\nt13 = lineTime(peek(cfg, 23), lfo13, sizeS, modS);\nt14 = lineTime(peek(cfg, 24), lfo14, sizeS, modS);\nt15 = lineTime(peek(cfg, 25), lfo15, sizeS, modS);\nt16 = lineTime(peek(cfg, 26), lfo16, sizeS, modS);\nt17 = lineTime(peek(cfg, 27), lfo17, sizeS, modS);\nt18 = lineTime(peek(cfg, 28), lfo18, sizeS, modS);\nt19 = lineTime(peek(cfg, 29), lfo19, sizeS, modS);\n\nm0, m1, m2, m3, m4, m5, m6, m7, m8, m9 = house(o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, nL, character, model);\nm10, m11, m12, m13, m14, m15, m16, m17, m18, m19 = house(o10, o11, o12, o13, o14, o15, o16, o17, o18, o19, nR, character, model);\n\n// Rotation by xfeed * pi/2. xfeed 0 is identity, xfeed 1 swaps the sides\n// with one polarity flip. A convex blend (1-xf, xf) has a differential\n// eigenvalue of 1-2*xf and would erase the tail on short delays.\nxf = clip(xfeedS, 0, 1);\ncth = cos(xf * 1.5707963267948966);\nsth = sin(xf * 1.5707963267948966);\nx0 = cth * m0 + sth * m10;\nx1 = cth * m1 + sth * m11;\nx2 = cth * m2 + sth * m12;\nx3 = cth * m3 + sth * m13;\nx4 = cth * m4 + sth * m14;\nx5 = cth * m5 + sth * m15;\nx6 = cth * m6 + sth * m16;\nx7 = cth * m7 + sth * m17;\nx8 = cth * m8 + sth * m18;\nx9 = cth * m9 + sth * m19;\nx10 = -sth * m0 + cth * m10;\nx11 = -sth * m1 + cth * m11;\nx12 = -sth * m2 + cth * m12;\nx13 = -sth * m3 + cth * m13;\nx14 = -sth * m4 + cth * m14;\nx15 = -sth * m5 + cth * m15;\nx16 = -sth * m6 + cth * m16;\nx17 = -sth * m7 + cth * m17;\nx18 = -sth * m8 + cth * m18;\nx19 = -sth * m9 + cth * m19;\n\nc0 = dampCoef(t0, dampS, peek(cfg, 30));\nc1 = dampCoef(t1, dampS, peek(cfg, 31));\nc2 = dampCoef(t2, dampS, peek(cfg, 32));\nc3 = dampCoef(t3, dampS, peek(cfg, 33));\nc4 = dampCoef(t4, dampS, peek(cfg, 34));\nc5 = dampCoef(t5, dampS, peek(cfg, 35));\nc6 = dampCoef(t6, dampS, peek(cfg, 36));\nc7 = dampCoef(t7, dampS, peek(cfg, 37));\nc8 = dampCoef(t8, dampS, peek(cfg, 38));\nc9 = dampCoef(t9, dampS, peek(cfg, 39));\nc10 = dampCoef(t10, dampS, peek(cfg, 40));\nc11 = dampCoef(t11, dampS, peek(cfg, 41));\nc12 = dampCoef(t12, dampS, peek(cfg, 42));\nc13 = dampCoef(t13, dampS, peek(cfg, 43));\nc14 = dampCoef(t14, dampS, peek(cfg, 44));\nc15 = dampCoef(t15, dampS, peek(cfg, 45));\nc16 = dampCoef(t16, dampS, peek(cfg, 46));\nc17 = dampCoef(t17, dampS, peek(cfg, 47));\nc18 = dampCoef(t18, dampS, peek(cfg, 48));\nc19 = dampCoef(t19, dampS, peek(cfg, 49));\n\na0 = (0 < nL) ? 1 : 0;\na1 = (1 < nL) ? 1 : 0;\na2 = (2 < nL) ? 1 : 0;\na3 = (3 < nL) ? 1 : 0;\na4 = (4 < nL) ? 1 : 0;\na5 = (5 < nL) ? 1 : 0;\na6 = (6 < nL) ? 1 : 0;\na7 = (7 < nL) ? 1 : 0;\na8 = (8 < nL) ? 1 : 0;\na9 = (9 < nL) ? 1 : 0;\na10 = (0 < nR) ? 1 : 0;\na11 = (1 < nR) ? 1 : 0;\na12 = (2 < nR) ? 1 : 0;\na13 = (3 < nR) ? 1 : 0;\na14 = (4 < nR) ? 1 : 0;\na15 = (5 < nR) ? 1 : 0;\na16 = (6 < nR) ? 1 : 0;\na17 = (7 < nR) ? 1 : 0;\na18 = (8 < nR) ? 1 : 0;\na19 = (9 < nR) ? 1 : 0;\n\n// Per-line loop gain. Short lines need a higher coefficient to ring as long.\ng0 = ringGain(t0, fbkS);\nz0 = a0 * (clip(x0, -2, 2) * g0 * duckG + injL);\ng1 = ringGain(t1, fbkS);\nz1 = a1 * (clip(x1, -2, 2) * g1 * duckG + injL);\ng2 = ringGain(t2, fbkS);\nz2 = a2 * (clip(x2, -2, 2) * g2 * duckG + injL);\ng3 = ringGain(t3, fbkS);\nz3 = a3 * (clip(x3, -2, 2) * g3 * duckG + injL);\ng4 = ringGain(t4, fbkS);\nz4 = a4 * (clip(x4, -2, 2) * g4 * duckG + injL);\ng5 = ringGain(t5, fbkS);\nz5 = a5 * (clip(x5, -2, 2) * g5 * duckG + injL);\ng6 = ringGain(t6, fbkS);\nz6 = a6 * (clip(x6, -2, 2) * g6 * duckG + injL);\ng7 = ringGain(t7, fbkS);\nz7 = a7 * (clip(x7, -2, 2) * g7 * duckG + injL);\ng8 = ringGain(t8, fbkS);\nz8 = a8 * (clip(x8, -2, 2) * g8 * duckG + injL);\ng9 = ringGain(t9, fbkS);\nz9 = a9 * (clip(x9, -2, 2) * g9 * duckG + injL);\ng10 = ringGain(t10, fbkS);\nz10 = a10 * (clip(x10, -2, 2) * g10 * duckG + injR);\ng11 = ringGain(t11, fbkS);\nz11 = a11 * (clip(x11, -2, 2) * g11 * duckG + injR);\ng12 = ringGain(t12, fbkS);\nz12 = a12 * (clip(x12, -2, 2) * g12 * duckG + injR);\ng13 = ringGain(t13, fbkS);\nz13 = a13 * (clip(x13, -2, 2) * g13 * duckG + injR);\ng14 = ringGain(t14, fbkS);\nz14 = a14 * (clip(x14, -2, 2) * g14 * duckG + injR);\ng15 = ringGain(t15, fbkS);\nz15 = a15 * (clip(x15, -2, 2) * g15 * duckG + injR);\ng16 = ringGain(t16, fbkS);\nz16 = a16 * (clip(x16, -2, 2) * g16 * duckG + injR);\ng17 = ringGain(t17, fbkS);\nz17 = a17 * (clip(x17, -2, 2) * g17 * duckG + injR);\ng18 = ringGain(t18, fbkS);\nz18 = a18 * (clip(x18, -2, 2) * g18 * duckG + injR);\ng19 = ringGain(t19, fbkS);\nz19 = a19 * (clip(x19, -2, 2) * g19 * duckG + injR);\n\ndel0.write(z0);\ndel1.write(z1);\ndel2.write(z2);\ndel3.write(z3);\ndel4.write(z4);\ndel5.write(z5);\ndel6.write(z6);\ndel7.write(z7);\ndel8.write(z8);\ndel9.write(z9);\ndel10.write(z10);\ndel11.write(z11);\ndel12.write(z12);\ndel13.write(z13);\ndel14.write(z14);\ndel15.write(z15);\ndel16.write(z16);\ndel17.write(z17);\ndel18.write(z18);\ndel19.write(z19);\n// Filter the delay tap. Pole 0 is a bypass, so Damp 0 matches an unfiltered\n// read. Every later pass is filtered once, and the first reflection is too.\no0 = lp(del0.read(t0, interp=\"linear\") * a0, c0);\no1 = lp(del1.read(t1, interp=\"linear\") * a1, c1);\no2 = lp(del2.read(t2, interp=\"linear\") * a2, c2);\no3 = lp(del3.read(t3, interp=\"linear\") * a3, c3);\no4 = lp(del4.read(t4, interp=\"linear\") * a4, c4);\no5 = lp(del5.read(t5, interp=\"linear\") * a5, c5);\no6 = lp(del6.read(t6, interp=\"linear\") * a6, c6);\no7 = lp(del7.read(t7, interp=\"linear\") * a7, c7);\no8 = lp(del8.read(t8, interp=\"linear\") * a8, c8);\no9 = lp(del9.read(t9, interp=\"linear\") * a9, c9);\no10 = lp(del10.read(t10, interp=\"linear\") * a10, c10);\no11 = lp(del11.read(t11, interp=\"linear\") * a11, c11);\no12 = lp(del12.read(t12, interp=\"linear\") * a12, c12);\no13 = lp(del13.read(t13, interp=\"linear\") * a13, c13);\no14 = lp(del14.read(t14, interp=\"linear\") * a14, c14);\no15 = lp(del15.read(t15, interp=\"linear\") * a15, c15);\no16 = lp(del16.read(t16, interp=\"linear\") * a16, c16);\no17 = lp(del17.read(t17, interp=\"linear\") * a17, c17);\no18 = lp(del18.read(t18, interp=\"linear\") * a18, c18);\no19 = lp(del19.read(t19, interp=\"linear\") * a19, c19);\n\nenv0 = follow(o0);\nenv1 = follow(o1);\nenv2 = follow(o2);\nenv3 = follow(o3);\nenv4 = follow(o4);\nenv5 = follow(o5);\nenv6 = follow(o6);\nenv7 = follow(o7);\nenv8 = follow(o8);\nenv9 = follow(o9);\nenv10 = follow(o10);\nenv11 = follow(o11);\nenv12 = follow(o12);\nenv13 = follow(o13);\nenv14 = follow(o14);\nenv15 = follow(o15);\nenv16 = follow(o16);\nenv17 = follow(o17);\nenv18 = follow(o18);\nenv19 = follow(o19);\n\ntick = wrap(tick + 1, 0, 32);\nif (tick == 0) {\n\tpoke(meters, env0, 0, 0);\n\tpoke(meters, env1, 1, 0);\n\tpoke(meters, env2, 2, 0);\n\tpoke(meters, env3, 3, 0);\n\tpoke(meters, env4, 4, 0);\n\tpoke(meters, env5, 5, 0);\n\tpoke(meters, env6, 6, 0);\n\tpoke(meters, env7, 7, 0);\n\tpoke(meters, env8, 8, 0);\n\tpoke(meters, env9, 9, 0);\n\tpoke(meters, env10, 10, 0);\n\tpoke(meters, env11, 11, 0);\n\tpoke(meters, env12, 12, 0);\n\tpoke(meters, env13, 13, 0);\n\tpoke(meters, env14, 14, 0);\n\tpoke(meters, env15, 15, 0);\n\tpoke(meters, env16, 16, 0);\n\tpoke(meters, env17, 17, 0);\n\tpoke(meters, env18, 18, 0);\n\tpoke(meters, env19, 19, 0);\n}\n\nsumL = (o0 + o1 + o2 + o3 + o4 + o5 + o6 + o7 + o8 + o9) * invL;\nsumR = (o10 + o11 + o12 + o13 + o14 + o15 + o16 + o17 + o18 + o19) * invR;\nmid = (sumL + sumR) * 0.5;\nside = (sumL - sumR) * 0.5 * clip(widthS, 0, 1);\nwetL = (mid + side) * duckG;\nwetR = (mid - side) * duckG;\nang = clip(wetS, 0, 1) * 1.57079632679;\ndryG = cos(ang);\nwetG = sin(ang);\nout1 = fixnan(in1 * dryG + wetL * wetG);\nout2 = fixnan(in2 * dryG + wetR * wetG);\n",
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
					"text": "js /Users/mrwilson/software/ableton/tests/tinyspace_probe.js impulse ring0"
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
