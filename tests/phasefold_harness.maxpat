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
			600.0
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
					"text": "delay 3400"
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
						320.0,
						80.0,
						20.0
					],
					"text": "delay 150"
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
						40.0,
						360.0,
						140.0,
						20.0
					],
					"text": "analyze 262144"
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
						460.0,
						20.0
					],
					"text": "phaseamt 0, sizeidx 2, orig 0, autog 1, mixpct 100, outdb 0"
				}
			},
			{
				"box": {
					"id": "obj-srcparams",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200.0,
						70.0,
						120.0,
						20.0
					],
					"text": "srcmode 0"
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
						120.0,
						20.0
					],
					"text": "scope pfscope"
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
						160.0,
						20.0
					],
					"text": "buffer~ pfscope 100 4"
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
						200.0,
						20.0
					],
					"text": "buffer~ rec @samps 262144 @chans 4"
				}
			},
			{
				"box": {
					"code": "// Test signal generator for the Phase Fold audio tests.\n// srcmode 0 noise, 1 kick train, 2 kick + snare, 3 silence, 4 sine 220 Hz.\nParam srcmode(0);\nHistory tc(0);\nHistory sph(0);\ntc = wrap(tc + 1, 0, samplerate * 0.5);\nt = tc / samplerate;\nnz = noise();\nkick = 0.8 * exp(-t * 25) * sin(6.283185307179586 * (55 * t + 3 * (1 - exp(-t * 40))));\nsnon = t >= 0.25 ? 1 : 0;\nsn = snon * nz * exp(-max(t - 0.25, 0) * 30) * 0.5;\nsph = wrap(sph + 220 / samplerate, 0, 1);\nsinv = sin(6.283185307179586 * sph) * 0.3;\nsel0 = srcmode < 0.5 ? 1 : 0;\nsel1 = (srcmode > 0.5 && srcmode < 1.5) ? 1 : 0;\nsel2 = (srcmode > 1.5 && srcmode < 2.5) ? 1 : 0;\nsel4 = srcmode > 3.5 ? 1 : 0;\nx = sel0 * nz * 0.35 + sel1 * kick + sel2 * (kick + sn) + sel4 * sinv;\nout1 = x;\nout2 = samplerate * 0.00001;\n",
					"fontname": "<Monospaced>",
					"fontsize": 10.0,
					"id": "obj-src",
					"maxclass": "gen.codebox~",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"signal",
						"signal"
					],
					"patching_rect": [
						520.0,
						200.0,
						200.0,
						60.0
					]
				}
			},
			{
				"box": {
					"code": "// cepstrum_lib.genexpr \u2014 shared STFT + real-cepstrum engine for gen.codebox~.\n// Device build scripts PREPEND this file to their own core, so every function\n// below sits ahead of the core's Param, History, Delay and Data declarations\n// (GenExpr requires functions first). Reference: src/cepstrum_ref.js.\n//\n// ---------------------------------------------------------------------------\n// Verified in Max 9.1 (tests/test_cepstrum_lib.js + scripts/run_cepstrum_lib_audio_tests.py)\n//   * Functions CAN take Data arguments, and they are passed by reference:\n//     d.peek(i[, ch]) and d.poke(value, i[, ch]) inside a function change the\n//     caller's Data. A function body can NOT see a global Data, so the library\n//     has no fixed names: the core declares Data and passes it in.\n//   * A function whose result is assigned to an unused variable is removed as\n//     dead code (`z = fn(d);` does nothing). Call work functions as BARE\n//     statements (`fn(d);`), which stay in statement order, also inside `if`.\n//   * Never name an identifier \"e\" followed by digits: the lexer reads Euler's constant.\n//\n// Data the core must declare (sizes are the maximum; N is 512..4096):\n//   Data tab(4096, 3);   // twiddles + bit reversal. Shared by every FFT in the core.\n//   Data win(4096);      // Hann table, shared by every channel.\n//   Data fx(4096, 2);    // work spectrum/frame: channel 0 = real, 1 = imag. Shared.\n//   Data fc(4096, 2);    // work cepstrum / log spectrum, same layout. Shared.\n//   Per audio channel:\n//   Data ring(4096);     // input ring buffer.\n//   Data acc(4096);      // overlap-add accumulator.\n//   Data st(4);          // framing state (write position, hop counter, N seen by in/out).\n// fx and fc are scratch: they are only valid inside one hop-boundary block, so\n// L and R can reuse them one after the other. Devices that need to keep a\n// cepstrum or spectrum across frames (freeze, novelty) add their own Data.\n//\n// Per-sample call order for each channel (see the skeleton at the end):\n//   fft_init(tab); stft_win(win, n);\n//   rdy = stft_in(ring, st, x, n);\n//   if (rdy) { stft_frame -> fft_run -> ...process... -> fft_run(inverse) -> stft_ola }\n//   y = stft_out(acc, st, n);\n//\n// Latency: the frame is processed in the same sample that completes it, and\n// output sample s leaves the accumulator once the last frame covering it is\n// added. That is N - 1 samples for hop N/4 (out[t] = in[t - (N - 1)]; measured\n// exactly in real Max at 512/1024/2048/4096). Identity gain is exactly 1: Hann\n// analysis x Hann synthesis sums to 1.5 at hop N/4, and stft_ola scales by 2/3.\n// Live's reported latency (patcher \"latency\" attribute) is static, so a device\n// with a user-selectable N should pad with a Delay to a constant 4096 samples:\n//   Delay padl(4096);  padl.write(y);  out = padl.read(4096 - (n - 1));\n// Changing n clears the ring and accumulator (stft_in / stft_out), so the output\n// is silent for the first n - 1 samples after the change.\n// Cost (Max 9, 44.1 kHz, per mono instance): identity about 0.75 % of a core,\n// forward + cepstrum + inverse chain about 1.7 %, nearly flat in N. All of it\n// runs in the one sample that completes a hop; stereo can pack L and R into the\n// real and imaginary parts of one FFT if that ever matters.\n// ---------------------------------------------------------------------------\n\n// Snap a requested size to a power of two in 512..4096.\ncep_n(req) {\n\treturn pow(2, clip(round(log(max(req, 1)) * 1.4426950408889634), 9, 12));\n}\n\n// Twiddle table (forward kernel: cos and -sin of 2*pi*k/4096, k < 2048) in\n// tab channels 0/1, and the 12-bit bit-reversed index in channel 2. Runs once\n// (History guard), so call it every sample for free.\nfft_init(tab) {\n\tHistory done(0);\n\tif (done == 0) {\n\t\tfor (k = 0; k < 2048; k += 1) {\n\t\t\tph = 6.283185307179586 * k / 4096;\n\t\t\ttab.poke(cos(ph), k, 0);\n\t\t\ttab.poke(-sin(ph), k, 1);\n\t\t}\n\t\tfor (i = 0; i < 4096; i += 1) {\n\t\t\tr = 0;\n\t\t\tv = i;\n\t\t\tfor (b = 0; b < 12; b += 1) {\n\t\t\t\thv = floor(v * 0.5);\n\t\t\t\tr = r * 2 + (v - hv * 2);\n\t\t\t\tv = hv;\n\t\t\t}\n\t\t\ttab.poke(r, i, 2);\n\t\t}\n\t\tdone = 1;\n\t}\n\treturn done;\n}\n\n// In-place radix-2 FFT of x (channel 0 = real, 1 = imag) over n points, n a\n// power of two <= 4096. inv = 1 runs the inverse and scales by 1 / n.\n// The bit-reversed index for n is the 12-bit one divided by 4096 / n (rdiv).\nfft_run(x, tab, n, inv) {\n\trdiv = 4096 / n;\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = tab.peek(i, 2) / rdiv;\n\t\tif (j > i) {\n\t\t\ttr = x.peek(i, 0);\n\t\t\tti = x.peek(i, 1);\n\t\t\tx.poke(x.peek(j, 0), i, 0);\n\t\t\tx.poke(x.peek(j, 1), i, 1);\n\t\t\tx.poke(tr, j, 0);\n\t\t\tx.poke(ti, j, 1);\n\t\t}\n\t}\n\tsgn = inv > 0.5 ? -1 : 1;\n\tfor (len = 2; len <= n; len *= 2) {\n\t\thalf = len * 0.5;\n\t\tstp = 4096 / len;\n\t\tfor (s = 0; s < n; s += len) {\n\t\t\tfor (k = 0; k < half; k += 1) {\n\t\t\t\twr = tab.peek(k * stp, 0);\n\t\t\t\twi = sgn * tab.peek(k * stp, 1);\n\t\t\t\ta = s + k;\n\t\t\t\tb = a + half;\n\t\t\t\txr = x.peek(b, 0);\n\t\t\t\txi = x.peek(b, 1);\n\t\t\t\ttr = xr * wr - xi * wi;\n\t\t\t\tti = xr * wi + xi * wr;\n\t\t\t\tur = x.peek(a, 0);\n\t\t\t\tui = x.peek(a, 1);\n\t\t\t\tx.poke(ur + tr, a, 0);\n\t\t\t\tx.poke(ui + ti, a, 1);\n\t\t\t\tx.poke(ur - tr, b, 0);\n\t\t\t\tx.poke(ui - ti, b, 1);\n\t\t\t}\n\t\t}\n\t}\n\tif (inv > 0.5) {\n\t\tsc = 1 / n;\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tx.poke(x.peek(i, 0) * sc, i, 0);\n\t\t\tx.poke(x.peek(i, 1) * sc, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// Periodic Hann table for n points. Rebuilt only when n changes.\nstft_win(win, n) {\n\tHistory wn(0);\n\tif (n != wn) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\twin.poke(0.5 - 0.5 * cos(6.283185307179586 * i / n), i);\n\t\t}\n\t\twn = n;\n\t}\n\treturn wn;\n}\n\n// Push one sample. Returns 1 when a hop (n / 4 samples) completed and a frame\n// is ready. Changing n clears the ring and restarts the hop counter.\n// st: 0 = write position (= oldest sample), 1 = hop counter, 2 = n seen here.\nstft_in(ring, st, x, n) {\n\tif (n != st.peek(2)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tring.poke(0, i);\n\t\t}\n\t\tst.poke(0, 0);\n\t\tst.poke(0, 1);\n\t\tst.poke(n, 2);\n\t}\n\twp = st.peek(0);\n\tring.poke(x, wp);\n\twp += 1;\n\tif (wp >= n) {\n\t\twp = 0;\n\t}\n\tcnt = st.peek(1) + 1;\n\trdy = 0;\n\tif (cnt >= n * 0.25) {\n\t\tcnt = 0;\n\t\trdy = 1;\n\t}\n\tst.poke(wp, 0);\n\tst.poke(cnt, 1);\n\treturn rdy;\n}\n\n// Copy the last n samples, oldest first, times the Hann window into fx (imag 0).\nstft_frame(fx, ring, st, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tfx.poke(ring.peek(j) * win.peek(i), i, 0);\n\t\tfx.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Weighted overlap-add: window the real part of fx and add it into acc at the\n// frame's start position. 2 / 3 = 1 / sum(Hann^2) at hop n / 4.\nstft_ola(acc, st, fx, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tacc.poke(acc.peek(j) + fx.peek(i, 0) * win.peek(i) * 0.6666666666666666, j);\n\t}\n\treturn 0;\n}\n\n// One output sample: the oldest accumulator slot is finished, so read and clear\n// it. Call after the frame block, every sample. Clears acc when n changes.\n// st: 3 = n seen here.\nstft_out(acc, st, n) {\n\tif (n != st.peek(3)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tacc.poke(0, i);\n\t\t}\n\t\tst.poke(n, 3);\n\t}\n\twp = st.peek(0);\n\ty = acc.peek(wp);\n\tacc.poke(0, wp);\n\treturn y;\n}\n\n// Real cepstrum of the complex spectrum in fx: fc = IFFT(log(|X| + eps)).\n// fc channel 0 holds c[n] (real and even), channel 1 is about 0.\ncep_from_spec(fx, fc, tab, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tfc.poke(log(sqrt(xr * xr + xi * xi) + eps), i, 0);\n\t\tfc.poke(0, i, 1);\n\t}\n\tfft_run(fc, tab, n, 1);\n\treturn 0;\n}\n\n// Cepstrum (any cepstrum, in place) back to the log spectrum: forward FFT.\n// For an even cepstrum fc channel 0 becomes log|X|. For a folded (min or max\n// phase) cepstrum channel 0 is log|X| and channel 1 is the phase in radians.\ncep_to_logmag(fc, tab, n) {\n\tfft_run(fc, tab, n, 0);\n\treturn 0;\n}\n\n// Minimum-phase fold in place: c[0], 2 c[i] for 0 < i < n/2, c[n/2], else 0.\ncep_fold_minphase(fc, n) {\n\thalf = n * 0.5;\n\tfor (i = 1; i < half; i += 1) {\n\t\tfc.poke(fc.peek(i, 0) * 2, i, 0);\n\t}\n\tfor (i = half + 1; i < n; i += 1) {\n\t\tfc.poke(0, i, 0);\n\t}\n\tfor (i = 0; i < n; i += 1) {\n\t\tfc.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Maximum-phase fold: the minimum-phase cepstrum mirrored in quefrency\n// (c_max[i] = c_min[n - i]). Same magnitude, opposite phase.\ncep_fold_maxphase(fc, n) {\n\thalf = n * 0.5;\n\tcep_fold_minphase(fc, n);\n\tfor (i = 1; i < half; i += 1) {\n\t\tt = fc.peek(i, 0);\n\t\tfc.poke(0, i, 0);\n\t\tfc.poke(t, n - i, 0);\n\t}\n\treturn 0;\n}\n\n// Complex exponential of the log spectrum in fc (re = log magnitude, im =\n// phase) into the spectrum fx, minus the eps added in cep_from_spec. After a\n// minimum-phase fold this is the minimum-phase spectrum with the original magnitude.\ncep_exp_spec(fc, fx, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tph = fc.peek(i, 1);\n\t\tfx.poke(m * cos(ph), i, 0);\n\t\tfx.poke(m * sin(ph), i, 1);\n\t}\n\treturn 0;\n}\n\n// Impose the magnitude exp(fc.re) - eps on the phase already in fx (keep the\n// original phase, change only the magnitude: Lifter EQ, crusher, and so on).\ncep_remag(fx, fc, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tmag = sqrt(xr * xr + xi * xi);\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tif (mag > 1e-20) {\n\t\t\tg = m / mag;\n\t\t\tfx.poke(xr * g, i, 0);\n\t\t\tfx.poke(xi * g, i, 1);\n\t\t} else {\n\t\t\tfx.poke(m, i, 0);\n\t\t\tfx.poke(0, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// Cepstral pitch peak: the quefrency index in [lo, hi] (samples; 2..20 ms is\n// lo = samplerate * 0.002, hi = samplerate * 0.02) where c[q] is largest.\n// fc channel 0 must hold the real cepstrum from cep_from_spec.\ncep_peak(fc, lo, hi) {\n\tbest = -1e30;\n\tbi = lo;\n\tfor (q = lo; q <= hi; q += 1) {\n\t\tv = fc.peek(q, 0);\n\t\tif (v > best) {\n\t\t\tbest = v;\n\t\t\tbi = q;\n\t\t}\n\t}\n\treturn bi;\n}\n\n// Confidence 0..1 for the peak at q: z-score of c[q] against the [lo, hi]\n// range, mapped 3 sigma -> 0 and 10 sigma -> 1. White noise stays near 0.\ncep_peak_conf(fc, q, lo, hi) {\n\tcntq = hi - lo + 1;\n\tsm = 0;\n\tsq = 0;\n\tfor (i = lo; i <= hi; i += 1) {\n\t\tv = fc.peek(i, 0);\n\t\tsm += v;\n\t\tsq += v * v;\n\t}\n\tmu = sm / cntq;\n\tsd = sqrt(max(sq / cntq - mu * mu, 1e-20));\n\treturn clip(((fc.peek(q, 0) - mu) / sd - 3) / 7, 0, 1);\n}\n\n// Parabolic refinement of the peak at q: fractional quefrency in samples.\ncep_peak_refine(fc, q) {\n\ta = fc.peek(q - 1, 0);\n\tb = fc.peek(q, 0);\n\tc = fc.peek(q + 1, 0);\n\tden = a - 2 * b + c;\n\treturn q + (abs(den) > 1e-20 ? clip(0.5 * (a - c) / den, -0.5, 0.5) : 0);\n}\n\n// ---------------------------------------------------------------------------\n// Skeleton of a device core (mono; stereo repeats the per-channel part with\n// ringR/accR/stR and reuses fx, fc, tab, win):\n//\n//   Param fftn(1024);\n//   Data tab(4096, 3);  Data win(4096);  Data fx(4096, 2);  Data fc(4096, 2);\n//   Data ring(4096);    Data acc(4096);  Data st(4);\n//   n = cep_n(fftn);\n//   fft_init(tab);\n//   stft_win(win, n);\n//   rdy = stft_in(ring, st, in1, n);\n//   if (rdy) {\n//       stft_frame(fx, ring, st, win, n);\n//       fft_run(fx, tab, n, 0);              // fx = X\n//       cep_from_spec(fx, fc, tab, n, 1e-9); // fc = real cepstrum\n//       cep_fold_minphase(fc, n);            // ...process the cepstrum...\n//       cep_to_logmag(fc, tab, n);           // fc = log|X| + j phase\n//       cep_exp_spec(fc, fx, n, 1e-9);       // fx = new spectrum\n//       fft_run(fx, tab, n, 1);              // back to time\n//       stft_ola(acc, st, fx, win, n);\n//   }\n//   out1 = stft_out(acc, st, n);             // delayed by n - 1 samples\n// ---------------------------------------------------------------------------\n\n// Phase Fold: cepstral phase sculptor. Built by scripts/build_phasefold.py as\n// src/cepstrum_lib.genexpr + this file. Mirrors tests/phasefold_model.js.\n//\n// Per Hann frame (hop N/4) the real cepstrum c[n] of log|X| is re-weighted\n//   c'[n]     = c[n] * (1 + p)   0 < n < N/2   (causal half: min-phase part)\n//   c'[N - n] = c[n] * (1 - p)                  (anti-causal half: max-phase part)\n// c is even, so the even part (the magnitude) is untouched and the odd part\n// becomes p * (min-phase phase). p = +1 is the minimum-phase frame, p = 0 the\n// zero-phase frame, p = -1 the maximum-phase (time reversed) frame, and the\n// group delay, hence the energy centroid, moves linearly in between.\n//\n// Level: a folded frame has its energy in a different place, not a different\n// amount. Two things made the library's min/max-phase frames 3..12 dB quiet:\n//  1. Position. Min-phase energy sits at frame index 0 and max-phase energy at\n//     index N-1, where the Hann synthesis window is 0 (up to -16 dB for noise).\n//     Fix: pivot placement. Every frame is delayed so its sharpest energy\n//     (pf_pivot, the loudest n/64 samples of the windowed input) lands on the\n//     input's own pivot, which also keeps hits where they were.\n//  2. Overlap coherence. Frames with a rebuilt phase no longer add as\n//     amplitudes but as powers: 2/3 * sum(w^2) = 1 becomes 0.49 (-3.1 dB).\n//     Fix: Auto Gain scales each frame so its window-weighted energy equals the\n//     input frame's, times 1.43 (+3.1 dB) fading to 1.00 as Orig goes to 100%.\n//\n// Telemetry buffer \"phasefoldscope\" (4 channels, bound with `scope #0-phasefoldscope`):\n//   frames 0..255 : ch0 dry max, ch1 dry min, ch2 wet max, ch3 wet min (mono,\n//                   128-sample peaks of the delayed dry and of the wet output)\n//   frame 256     : ch0 write position, ch1 heartbeat, ch2 FFT size, ch3 wet gate\n//   frame 257     : ch0 input centroid, ch1 output centroid (frame position\n//                   0..1), ch2 pivot position 0..1, ch3 Auto Gain in dB\n// GenExpr rules: functions first, no identifier \"e\" + digit, \"phi\" and \"pi\" are\n// constants, Buffer bound on loadbang by the GenExpr variable name.\n\n// Window-weighted energy and centroid of the windowed input frame in fx.\n// ep (shared energy profile): first = 1 writes, first = 0 adds. Results go to\n// ms[2 ch] = energy and ms[2 ch + 1] = centroid (0..1).\npf_energy(fx, ep, ms, win, n, ch, first) {\n\tein = 0;\n\tcin = 0;\n\tfor (i = 0; i < n; i += 1) {\n\t\tv = fx.peek(i, 0);\n\t\ten = v * v;\n\t\tif (first > 0.5) {\n\t\t\tep.poke(en, i);\n\t\t} else {\n\t\t\tep.poke(ep.peek(i) + en, i);\n\t\t}\n\t\tw2 = en * win.peek(i) * win.peek(i);\n\t\tein += w2;\n\t\tcin += w2 * i;\n\t}\n\tms.poke(ein, ch * 2);\n\tcres = 0.5;\n\tif (ein > 1e-24) {\n\t\tcres = cin / (ein * n);\n\t}\n\tms.poke(cres, ch * 2 + 1);\n\treturn ein;\n}\n\n// Index of the loudest n/64-sample stretch of the energy profile (its centre).\npf_pivot(ep, n) {\n\twl = max(8, round(n / 64));\n\ts = 0;\n\tbest = -1;\n\tbi = n * 0.5;\n\tfor (i = 0; i < n; i += 1) {\n\t\ts += ep.peek(i);\n\t\tif (i >= wl) {\n\t\t\ts -= ep.peek(i - wl);\n\t\t}\n\t\tif (i >= wl - 1) {\n\t\t\tif (s > best) {\n\t\t\t\tbest = s;\n\t\t\t\tbi = i - floor(wl * 0.5);\n\t\t\t}\n\t\t}\n\t}\n\treturn bi;\n}\n\n// Asymmetric quefrency weighting, in place (see the header).\npf_weight(fc, n, p) {\n\thalf = n * 0.5;\n\twp1 = 1 + p;\n\twn1 = 1 - p;\n\tfor (i = 1; i < half; i += 1) {\n\t\tfc.poke(fc.peek(i, 0) * wp1, i, 0);\n\t\tfc.poke(fc.peek(n - i, 0) * wn1, n - i, 0);\n\t}\n\tfor (i = 0; i < n; i += 1) {\n\t\tfc.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Delay the new spectrum fx by t0 samples (linear phase) and blend it with the\n// original-phase spectrum xo: fx = (1 - orig) * shifted + orig * xo.\npf_place(fx, xo, n, t0, orig) {\n\tfor (k = 0; k < n; k += 1) {\n\t\ta = -6.283185307179586 * ((k * t0) % n) / n;\n\t\tcr = cos(a);\n\t\tci = sin(a);\n\t\tpr = fx.peek(k, 0);\n\t\tpj = fx.peek(k, 1);\n\t\tfx.poke((pr * cr - pj * ci) * (1 - orig) + xo.peek(k, 0) * orig, k, 0);\n\t\tfx.poke((pr * ci + pj * cr) * (1 - orig) + xo.peek(k, 1) * orig, k, 1);\n\t}\n\treturn 0;\n}\n\n// Window-weighted output energy (returned) and the frame-relative centroid\n// 0..1 measured from the pivot (min phase near 0, zero phase 0.5, max phase near 1).\npf_stats(fx, win, ms, n, t0, ch) {\n\teo = 0;\n\tcn = 0;\n\tcd = 0;\n\tfor (i = 0; i < n; i += 1) {\n\t\tv = fx.peek(i, 0);\n\t\ty2 = v * v;\n\t\teo += y2 * win.peek(i) * win.peek(i);\n\t\tq = i - t0;\n\t\tif (q < 0) {\n\t\t\tq += n;\n\t\t}\n\t\tcn += y2 * q;\n\t\tcd += y2;\n\t}\n\tcres = 0.5;\n\tif (cd > 1e-24) {\n\t\tcres = cn / (cd * n);\n\t}\n\tms.poke(cres, 4 + ch * 2);\n\treturn eo;\n}\n\n// Weighted overlap-add with a per-frame gain (stft_ola with g).\npf_ola(acc, st, fx, win, n, g) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tacc.poke(acc.peek(j) + fx.peek(i, 0) * win.peek(i) * 0.6666666666666666 * g, j);\n\t}\n\treturn 0;\n}\n\n// One channel's frame: fx holds the windowed input frame on entry.\npf_channel(fx, fc, xo, tab, win, acc, st, ms, n, p, orig, ag, t0, ch) {\n\tein = ms.peek(ch * 2);\n\tfft_run(fx, tab, n, 0);\n\tif (orig > 0.001) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\txo.poke(fx.peek(i, 0), i, 0);\n\t\t\txo.poke(fx.peek(i, 1), i, 1);\n\t\t}\n\t}\n\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\tpf_weight(fc, n, p);\n\tcep_to_logmag(fc, tab, n);\n\tcep_exp_spec(fc, fx, n, 1e-9);\n\tpf_place(fx, xo, n, t0, orig);\n\tfft_run(fx, tab, n, 1);\n\teo = pf_stats(fx, win, ms, n, t0, ch);\n\tg = 1;\n\tif (ag > 0.5) {\n\t\tif (eo > 1e-24) {\n\t\t\tg = min(sqrt(ein / eo) * (1 + 0.43 * (1 - orig)), 4);\n\t\t}\n\t}\n\tms.poke(g, 5 + ch * 2);\n\tpf_ola(acc, st, fx, win, n, g);\n\treturn 0;\n}\n\npf_slew(target, coef) {\n\tHistory sw(0);\n\tHistory swinit(0);\n\tsw = (swinit == 0) ? target : mix(target, sw, coef);\n\tswinit = 1;\n\treturn sw;\n}\n\nBuffer scope(\"phasefoldscope\");\n\nParam phaseamt(-50);\nParam sizeidx(2);\nParam orig(0);\nParam autog(1);\nParam mixpct(100);\nParam outdb(0);\n\nData tab(4096, 3);\nData win(4096);\nData fx(4096, 2);\nData fc(4096, 2);\nData xo(4096, 2);\nData ep(4096);\nData ms(8);\nData ringL(4096);\nData accL(4096);\nData stL(4);\nData ringR(4096);\nData accR(4096);\nData stR(4);\n\nDelay padL(4200);\nDelay padR(4200);\nDelay dryL(4200);\nDelay dryR(4200);\n\nHistory nact(0);\nHistory hold(0);\nHistory wgate(0);\nHistory hop(0);\nHistory wpos(0);\nHistory beat(0);\nHistory dmax(0);\nHistory dmin(0);\nHistory wmax(0);\nHistory wmin(0);\nHistory hcin(0.5);\nHistory hcout(0.5);\nHistory hpiv(0.5);\nHistory hgdb(0);\n\n// Active FFT size. A Size change fades the wet out over 512 samples, switches\n// (the library clears its ring and accumulator), holds the wet at 0 until the\n// new stream is fully overlapped (4096 + 0.75 n samples through the constant\n// pad, rounded up to 4160 + n), then fades in.\nnreq = pow(2, 9 + clip(round(sizeidx), 0, 3));\nif (nact < 1) {\n\tnact = nreq;\n\thold = 4160 + nreq;\n\twgate = 0;\n}\nif (nreq != nact) {\n\twgate = max(wgate - 0.001953125, 0);\n\tif (wgate <= 0) {\n\t\tnact = nreq;\n\t\thold = 4160 + nreq;\n\t}\n} else {\n\tif (hold > 0) {\n\t\thold -= 1;\n\t\twgate = 0;\n\t} else {\n\t\twgate = min(wgate + 0.001953125, 1);\n\t}\n}\nn = nact;\n\nph1 = clip(phaseamt, -100, 100) / 100;\nor1 = clip(orig, 0, 100) / 100;\nag1 = autog > 0.5 ? 1 : 0;\n\nfft_init(tab);\nstft_win(win, n);\nrdyL = stft_in(ringL, stL, in1, n);\nrdyR = stft_in(ringR, stR, in2, n);\n\nt0 = 0;\ngv = 1;\nif (rdyL + rdyR > 0.5) {\n\tstft_frame(fx, ringL, stL, win, n);\n\tpf_energy(fx, ep, ms, win, n, 0, 1);\n\tstft_frame(fx, ringR, stR, win, n);\n\tpf_energy(fx, ep, ms, win, n, 1, 0);\n\tif (ms.peek(0) + ms.peek(2) > 1e-12) {\n\t\tt0 = pf_pivot(ep, n);\n\t\tstft_frame(fx, ringL, stL, win, n);\n\t\tpf_channel(fx, fc, xo, tab, win, accL, stL, ms, n, ph1, or1, ag1, t0, 0);\n\t\tstft_frame(fx, ringR, stR, win, n);\n\t\tpf_channel(fx, fc, xo, tab, win, accR, stR, ms, n, ph1, or1, ag1, t0, 1);\n\t\thcin = 0.5 * (ms.peek(1) + ms.peek(3));\n\t\thcout = 0.5 * (ms.peek(4) + ms.peek(6));\n\t\thpiv = t0 / n;\n\t\tgv = 0.5 * (ms.peek(5) + ms.peek(7));\n\t\tif (gv < 0.000001) {\n\t\t\tgv = 0.000001;\n\t\t}\n\t\thgdb = 8.685889638065035 * log(gv);\n\t}\n}\nyL = stft_out(accL, stL, n);\nyR = stft_out(accR, stR, n);\n\n// Constant 4096-sample latency for every size; the dry path matches it.\npadL.write(yL);\npadR.write(yR);\ndryL.write(in1);\ndryR.write(in2);\nwetL = padL.read(4096 - (n - 1)) * wgate;\nwetR = padR.read(4096 - (n - 1)) * wgate;\ndrL = dryL.read(4096);\ndrR = dryR.read(4096);\n\nmixS = pf_slew(clip(mixpct, 0, 100), 0.999);\noutS = pf_slew(clip(outdb, -24, 12), 0.999);\nang = mixS / 100 * 1.5707963267948966;\nog = pow(10, outS / 20);\nout1 = fixnan((drL * cos(ang) + wetL * sin(ang)) * og);\nout2 = fixnan((drR * cos(ang) + wetR * sin(ang)) * og);\n\ndm = 0.5 * (drL + drR);\nwm = 0.5 * (wetL + wetR);\nhop = wrap(hop + 1, 0, 128);\nfresh = hop == 1 ? 1 : 0;\ndmax = fresh > 0.5 ? dm : max(dmax, dm);\ndmin = fresh > 0.5 ? dm : min(dmin, dm);\nwmax = fresh > 0.5 ? wm : max(wmax, wm);\nwmin = fresh > 0.5 ? wm : min(wmin, wm);\nif (hop == 0) {\n\tpoke(scope, dmax, wpos, 0);\n\tpoke(scope, dmin, wpos, 1);\n\tpoke(scope, wmax, wpos, 2);\n\tpoke(scope, wmin, wpos, 3);\n\tbeat = wrap(beat + 1, 0, 1000000);\n\twpos = wrap(wpos + 1, 0, 256);\n\tpoke(scope, wpos, 256, 0);\n\tpoke(scope, beat, 256, 1);\n\tpoke(scope, n, 256, 2);\n\tpoke(scope, wgate, 256, 3);\n\tpoke(scope, hcin, 257, 0);\n\tpoke(scope, hcout, 257, 1);\n\tpoke(scope, hpiv, 257, 2);\n\tpoke(scope, hgdb, 257, 3);\n}\n\nout1 = in1;\nout2 = in2;\n",
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
						200.0,
						60.0
					]
				}
			},
			{
				"box": {
					"id": "obj-record",
					"maxclass": "newobj",
					"numinlets": 5,
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
					"text": "record~ rec 4"
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
						200.0,
						470.0,
						360.0,
						20.0
					],
					"text": "js /Users/mrwilson/software/ableton/tests/phasefold_probe.js /tmp/phasefold_audio.txt 24000"
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
						"obj-srcparams",
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
						"obj-srcparams",
						0
					],
					"destination": [
						"obj-src",
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
						"obj-src",
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
						"obj-src",
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
						"obj-src",
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
						1
					],
					"destination": [
						"obj-record",
						2
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-src",
						1
					],
					"destination": [
						"obj-record",
						3
					]
				}
			}
		]
	}
}
