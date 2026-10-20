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
			700.0
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
					"text": "delay 700"
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
					"id": "obj-mark",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						100.0,
						200.0,
						40.0,
						20.0
					],
					"text": "mark"
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
					"text": "delay 2000"
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
						120.0,
						20.0
					],
					"text": "analyze 2000"
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
						700.0,
						20.0
					],
					"text": "fftn 2048, coeffs 1, qbits 16, smode 0, samt 0.5, qshift 0, freeze 0, qhold 0, wet 1, outdb 0, bpm 120, ppq 0, outdb -6"
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
						70.0,
						200.0,
						20.0
					],
					"text": "scope #0-qcrushscope"
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
						100.0,
						220.0,
						20.0
					],
					"text": "setbuffer #0-qcrushscope"
				}
			},
			{
				"box": {
					"id": "obj-del-fill",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200.0,
						130.0,
						80.0,
						20.0
					],
					"text": "delay 300"
				}
			},
			{
				"box": {
					"id": "obj-fill",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						300.0,
						130.0,
						40.0,
						20.0
					],
					"text": "fill"
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
						260.0,
						20.0
					],
					"text": "buffer~ #0-qcrushscope @samps 320"
				}
			},
			{
				"box": {
					"id": "obj-stim",
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
					"text": "buffer~ stim 3000 1"
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
						220.0,
						20.0
					],
					"text": "buffer~ rec @samps 262144 @chans 4"
				}
			},
			{
				"box": {
					"code": "// cepstrum_lib.genexpr \u2014 shared STFT + real-cepstrum engine for gen.codebox~.\n// Device build scripts PREPEND this file to their own core, so every function\n// below sits ahead of the core's Param, History, Delay and Data declarations\n// (GenExpr requires functions first). Reference: src/cepstrum_ref.js.\n//\n// ---------------------------------------------------------------------------\n// Verified in Max 9.1 (tests/test_cepstrum_lib.js + scripts/run_cepstrum_lib_audio_tests.py)\n//   * Functions CAN take Data arguments, and they are passed by reference:\n//     d.peek(i[, ch]) and d.poke(value, i[, ch]) inside a function change the\n//     caller's Data. A function body can NOT see a global Data, so the library\n//     has no fixed names: the core declares Data and passes it in.\n//   * A function whose result is assigned to an unused variable is removed as\n//     dead code (`z = fn(d);` does nothing). Call work functions as BARE\n//     statements (`fn(d);`), which stay in statement order, also inside `if`.\n//   * Never name an identifier \"e\" followed by digits: the lexer reads Euler's constant.\n//\n// Data the core must declare (sizes are the maximum; N is 512..4096):\n//   Data tab(4096, 3);   // twiddles + bit reversal. Shared by every FFT in the core.\n//   Data win(4096);      // Hann table, shared by every channel.\n//   Data fx(4096, 2);    // work spectrum/frame: channel 0 = real, 1 = imag. Shared.\n//   Data fc(4096, 2);    // work cepstrum / log spectrum, same layout. Shared.\n//   Per audio channel:\n//   Data ring(4096);     // input ring buffer.\n//   Data acc(4096);      // overlap-add accumulator.\n//   Data st(4);          // framing state (write position, hop counter, N seen by in/out).\n// fx and fc are scratch: they are only valid inside one hop-boundary block, so\n// L and R can reuse them one after the other. Devices that need to keep a\n// cepstrum or spectrum across frames (freeze, novelty) add their own Data.\n//\n// Per-sample call order for each channel (see the skeleton at the end):\n//   fft_init(tab); stft_win(win, n);\n//   rdy = stft_in(ring, st, x, n);\n//   if (rdy) { stft_frame -> fft_run -> ...process... -> fft_run(inverse) -> stft_ola }\n//   y = stft_out(acc, st, n);\n//\n// Latency: the frame is processed in the same sample that completes it, and\n// output sample s leaves the accumulator once the last frame covering it is\n// added. That is N - 1 samples for hop N/4 (out[t] = in[t - (N - 1)]; measured\n// exactly in real Max at 512/1024/2048/4096). Identity gain is exactly 1: Hann\n// analysis x Hann synthesis sums to 1.5 at hop N/4, and stft_ola scales by 2/3.\n// Live's reported latency (patcher \"latency\" attribute) is static, so a device\n// with a user-selectable N should pad with a Delay to a constant 4096 samples:\n//   Delay padl(4096);  padl.write(y);  out = padl.read(4096 - (n - 1));\n// Changing n clears the ring and accumulator (stft_in / stft_out), so the output\n// is silent for the first n - 1 samples after the change.\n// Cost (Max 9, 44.1 kHz, per mono instance): identity about 0.75 % of a core,\n// forward + cepstrum + inverse chain about 1.7 %, nearly flat in N. All of it\n// runs in the one sample that completes a hop; stereo can pack L and R into the\n// real and imaginary parts of one FFT if that ever matters.\n// ---------------------------------------------------------------------------\n\n// Snap a requested size to a power of two in 512..4096.\ncep_n(req) {\n\treturn pow(2, clip(round(log(max(req, 1)) * 1.4426950408889634), 9, 12));\n}\n\n// Twiddle table (forward kernel: cos and -sin of 2*pi*k/4096, k < 2048) in\n// tab channels 0/1, and the 12-bit bit-reversed index in channel 2. Runs once\n// (History guard), so call it every sample for free.\nfft_init(tab) {\n\tHistory done(0);\n\tif (done == 0) {\n\t\tfor (k = 0; k < 2048; k += 1) {\n\t\t\tph = 6.283185307179586 * k / 4096;\n\t\t\ttab.poke(cos(ph), k, 0);\n\t\t\ttab.poke(-sin(ph), k, 1);\n\t\t}\n\t\tfor (i = 0; i < 4096; i += 1) {\n\t\t\tr = 0;\n\t\t\tv = i;\n\t\t\tfor (b = 0; b < 12; b += 1) {\n\t\t\t\thv = floor(v * 0.5);\n\t\t\t\tr = r * 2 + (v - hv * 2);\n\t\t\t\tv = hv;\n\t\t\t}\n\t\t\ttab.poke(r, i, 2);\n\t\t}\n\t\tdone = 1;\n\t}\n\treturn done;\n}\n\n// In-place radix-2 FFT of x (channel 0 = real, 1 = imag) over n points, n a\n// power of two <= 4096. inv = 1 runs the inverse and scales by 1 / n.\n// The bit-reversed index for n is the 12-bit one divided by 4096 / n (rdiv).\nfft_run(x, tab, n, inv) {\n\trdiv = 4096 / n;\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = tab.peek(i, 2) / rdiv;\n\t\tif (j > i) {\n\t\t\ttr = x.peek(i, 0);\n\t\t\tti = x.peek(i, 1);\n\t\t\tx.poke(x.peek(j, 0), i, 0);\n\t\t\tx.poke(x.peek(j, 1), i, 1);\n\t\t\tx.poke(tr, j, 0);\n\t\t\tx.poke(ti, j, 1);\n\t\t}\n\t}\n\tsgn = inv > 0.5 ? -1 : 1;\n\tfor (len = 2; len <= n; len *= 2) {\n\t\thalf = len * 0.5;\n\t\tstp = 4096 / len;\n\t\tfor (s = 0; s < n; s += len) {\n\t\t\tfor (k = 0; k < half; k += 1) {\n\t\t\t\twr = tab.peek(k * stp, 0);\n\t\t\t\twi = sgn * tab.peek(k * stp, 1);\n\t\t\t\ta = s + k;\n\t\t\t\tb = a + half;\n\t\t\t\txr = x.peek(b, 0);\n\t\t\t\txi = x.peek(b, 1);\n\t\t\t\ttr = xr * wr - xi * wi;\n\t\t\t\tti = xr * wi + xi * wr;\n\t\t\t\tur = x.peek(a, 0);\n\t\t\t\tui = x.peek(a, 1);\n\t\t\t\tx.poke(ur + tr, a, 0);\n\t\t\t\tx.poke(ui + ti, a, 1);\n\t\t\t\tx.poke(ur - tr, b, 0);\n\t\t\t\tx.poke(ui - ti, b, 1);\n\t\t\t}\n\t\t}\n\t}\n\tif (inv > 0.5) {\n\t\tsc = 1 / n;\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tx.poke(x.peek(i, 0) * sc, i, 0);\n\t\t\tx.poke(x.peek(i, 1) * sc, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// Periodic Hann table for n points. Rebuilt only when n changes.\nstft_win(win, n) {\n\tHistory wn(0);\n\tif (n != wn) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\twin.poke(0.5 - 0.5 * cos(6.283185307179586 * i / n), i);\n\t\t}\n\t\twn = n;\n\t}\n\treturn wn;\n}\n\n// Push one sample. Returns 1 when a hop (n / 4 samples) completed and a frame\n// is ready. Changing n clears the ring and restarts the hop counter.\n// st: 0 = write position (= oldest sample), 1 = hop counter, 2 = n seen here.\nstft_in(ring, st, x, n) {\n\tif (n != st.peek(2)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tring.poke(0, i);\n\t\t}\n\t\tst.poke(0, 0);\n\t\tst.poke(0, 1);\n\t\tst.poke(n, 2);\n\t}\n\twp = st.peek(0);\n\tring.poke(x, wp);\n\twp += 1;\n\tif (wp >= n) {\n\t\twp = 0;\n\t}\n\tcnt = st.peek(1) + 1;\n\trdy = 0;\n\tif (cnt >= n * 0.25) {\n\t\tcnt = 0;\n\t\trdy = 1;\n\t}\n\tst.poke(wp, 0);\n\tst.poke(cnt, 1);\n\treturn rdy;\n}\n\n// Copy the last n samples, oldest first, times the Hann window into fx (imag 0).\nstft_frame(fx, ring, st, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tfx.poke(ring.peek(j) * win.peek(i), i, 0);\n\t\tfx.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Weighted overlap-add: window the real part of fx and add it into acc at the\n// frame's start position. 2 / 3 = 1 / sum(Hann^2) at hop n / 4.\nstft_ola(acc, st, fx, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tacc.poke(acc.peek(j) + fx.peek(i, 0) * win.peek(i) * 0.6666666666666666, j);\n\t}\n\treturn 0;\n}\n\n// One output sample: the oldest accumulator slot is finished, so read and clear\n// it. Call after the frame block, every sample. Clears acc when n changes.\n// st: 3 = n seen here.\nstft_out(acc, st, n) {\n\tif (n != st.peek(3)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tacc.poke(0, i);\n\t\t}\n\t\tst.poke(n, 3);\n\t}\n\twp = st.peek(0);\n\ty = acc.peek(wp);\n\tacc.poke(0, wp);\n\treturn y;\n}\n\n// Real cepstrum of the complex spectrum in fx: fc = IFFT(log(|X| + eps)).\n// fc channel 0 holds c[n] (real and even), channel 1 is about 0.\ncep_from_spec(fx, fc, tab, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tfc.poke(log(sqrt(xr * xr + xi * xi) + eps), i, 0);\n\t\tfc.poke(0, i, 1);\n\t}\n\tfft_run(fc, tab, n, 1);\n\treturn 0;\n}\n\n// Cepstrum (any cepstrum, in place) back to the log spectrum: forward FFT.\n// For an even cepstrum fc channel 0 becomes log|X|. For a folded (min or max\n// phase) cepstrum channel 0 is log|X| and channel 1 is the phase in radians.\ncep_to_logmag(fc, tab, n) {\n\tfft_run(fc, tab, n, 0);\n\treturn 0;\n}\n\n// Minimum-phase fold in place: c[0], 2 c[i] for 0 < i < n/2, c[n/2], else 0.\ncep_fold_minphase(fc, n) {\n\thalf = n * 0.5;\n\tfor (i = 1; i < half; i += 1) {\n\t\tfc.poke(fc.peek(i, 0) * 2, i, 0);\n\t}\n\tfor (i = half + 1; i < n; i += 1) {\n\t\tfc.poke(0, i, 0);\n\t}\n\tfor (i = 0; i < n; i += 1) {\n\t\tfc.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Maximum-phase fold: the minimum-phase cepstrum mirrored in quefrency\n// (c_max[i] = c_min[n - i]). Same magnitude, opposite phase.\ncep_fold_maxphase(fc, n) {\n\thalf = n * 0.5;\n\tcep_fold_minphase(fc, n);\n\tfor (i = 1; i < half; i += 1) {\n\t\tt = fc.peek(i, 0);\n\t\tfc.poke(0, i, 0);\n\t\tfc.poke(t, n - i, 0);\n\t}\n\treturn 0;\n}\n\n// Complex exponential of the log spectrum in fc (re = log magnitude, im =\n// phase) into the spectrum fx, minus the eps added in cep_from_spec. After a\n// minimum-phase fold this is the minimum-phase spectrum with the original magnitude.\ncep_exp_spec(fc, fx, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tph = fc.peek(i, 1);\n\t\tfx.poke(m * cos(ph), i, 0);\n\t\tfx.poke(m * sin(ph), i, 1);\n\t}\n\treturn 0;\n}\n\n// Impose the magnitude exp(fc.re) - eps on the phase already in fx (keep the\n// original phase, change only the magnitude: Lifter EQ, crusher, and so on).\ncep_remag(fx, fc, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tmag = sqrt(xr * xr + xi * xi);\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tif (mag > 1e-20) {\n\t\t\tg = m / mag;\n\t\t\tfx.poke(xr * g, i, 0);\n\t\t\tfx.poke(xi * g, i, 1);\n\t\t} else {\n\t\t\tfx.poke(m, i, 0);\n\t\t\tfx.poke(0, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// Cepstral pitch peak: the quefrency index in [lo, hi] (samples; 2..20 ms is\n// lo = samplerate * 0.002, hi = samplerate * 0.02) where c[q] is largest.\n// fc channel 0 must hold the real cepstrum from cep_from_spec.\ncep_peak(fc, lo, hi) {\n\tbest = -1e30;\n\tbi = lo;\n\tfor (q = lo; q <= hi; q += 1) {\n\t\tv = fc.peek(q, 0);\n\t\tif (v > best) {\n\t\t\tbest = v;\n\t\t\tbi = q;\n\t\t}\n\t}\n\treturn bi;\n}\n\n// Confidence 0..1 for the peak at q: z-score of c[q] against the [lo, hi]\n// range, mapped 3 sigma -> 0 and 10 sigma -> 1. White noise stays near 0.\ncep_peak_conf(fc, q, lo, hi) {\n\tcntq = hi - lo + 1;\n\tsm = 0;\n\tsq = 0;\n\tfor (i = lo; i <= hi; i += 1) {\n\t\tv = fc.peek(i, 0);\n\t\tsm += v;\n\t\tsq += v * v;\n\t}\n\tmu = sm / cntq;\n\tsd = sqrt(max(sq / cntq - mu * mu, 1e-20));\n\treturn clip(((fc.peek(q, 0) - mu) / sd - 3) / 7, 0, 1);\n}\n\n// Parabolic refinement of the peak at q: fractional quefrency in samples.\ncep_peak_refine(fc, q) {\n\ta = fc.peek(q - 1, 0);\n\tb = fc.peek(q, 0);\n\tc = fc.peek(q + 1, 0);\n\tden = a - 2 * b + c;\n\treturn q + (abs(den) > 1e-20 ? clip(0.5 * (a - c) / den, -0.5, 0.5) : 0);\n}\n\n// ---------------------------------------------------------------------------\n// Skeleton of a device core (mono; stereo repeats the per-channel part with\n// ringR/accR/stR and reuses fx, fc, tab, win):\n//\n//   Param fftn(1024);\n//   Data tab(4096, 3);  Data win(4096);  Data fx(4096, 2);  Data fc(4096, 2);\n//   Data ring(4096);    Data acc(4096);  Data st(4);\n//   n = cep_n(fftn);\n//   fft_init(tab);\n//   stft_win(win, n);\n//   rdy = stft_in(ring, st, in1, n);\n//   if (rdy) {\n//       stft_frame(fx, ring, st, win, n);\n//       fft_run(fx, tab, n, 0);              // fx = X\n//       cep_from_spec(fx, fc, tab, n, 1e-9); // fc = real cepstrum\n//       cep_fold_minphase(fc, n);            // ...process the cepstrum...\n//       cep_to_logmag(fc, tab, n);           // fc = log|X| + j phase\n//       cep_exp_spec(fc, fx, n, 1e-9);       // fx = new spectrum\n//       fft_run(fx, tab, n, 1);              // back to time\n//       stft_ola(acc, st, fx, win, n);\n//   }\n//   out1 = stft_out(acc, st, n);             // delayed by n - 1 samples\n// ---------------------------------------------------------------------------\n\n// Quefrency Crush core (appended to src/cepstrum_lib.genexpr at build time, so the library functions\n// sit ahead of everything here). Reference: src/qcrush_ref.js.\n//\n// Stereo STFT (hop N/4, Hann/Hann; the right channel's frames run half a hop after the left's). Per frame and channel:\n//   X = FFT(frame); c = real cepstrum of |X|; c' = crush(c); |X'| = exp(FFT(c')); X' = |X'| * phase(X); IFFT.\n// crush(c), in this order:\n//   (after the crush the frame is scaled to the input frame's energy: loudness does not change)\n//   1. split c at the formant quefrency Qs (2 ms) into the envelope part en (q < Qs) and the excitation ex (q > Qs)\n//   2. Hold/Freeze: en(1..) is sampled and held, c0 (level) and ex stay live (talkbox / vowel stepping)\n//   3. Scramble: reverse / seeded shuffle / rotate of q*en(q) over 1..min(K, Qs), blended by Amt\n//   4. Shift: ex splatted to quefrency q / 2^(st/12) (area preserving), the harmonic comb moves, the envelope stays\n//   5. Coeffs: keep only the first K coefficients (raised-cosine taper over the last 20 %). K: 2..Qs over the first\n//      75 % of the knob (log), Qs..N/2 over the last 25 % (linear: the pitch comb returns over a usable stretch)\n//   6. Bits: mid-tread quantizer, step 1.5 * 2^(-(bits-1) * 0.75) nepers (bits 16 = off)\n// Neutral settings skip all of it (pure STFT identity, exactly unity).\n//\n// Latency is constant 4096 samples for every Size (wet padded with a Delay, dry delayed identically).\n// Size changes crossfade to the dry path, switch N, wait for the pipeline to fill, then fade the wet back in.\n//\n// Telemetry buffer (bound on loadbang via `scope #0-qcrushscope`), 320 floats:\n//   0..95    original cepstrum c[1..96]            96..191  crushed cepstrum c'[1..96]\n//   192 N   193 K (coefficients kept)   194 bits   195 envelope held (1/0)   196 hold clock phase 0..1\n//   197 hold tick counter   198 shuffle roll counter   199 input peak (0 asleep)   200 pitch quefrency (samples)\n//   201 pitch confidence   202 shifted pitch quefrency   203 frame counter   204 samplerate   205 Qs\n//   206 scramble mode   207 scramble amount   208 shift ratio   209 neutral flag\n//   210..257 excitation strip, original (48 log bins 1..25 ms)   258..305 same, crushed\n//\n// GenExpr rules: functions first, then Buffer / Data / Param / History / Delay, then statements.\n// No identifier named e<digit>.\n\n// Smooth 0..1 crossover between envelope (0, q well below qs) and excitation (1, q well above qs).\nqc_hi(q, qs) {\n\tw = max(qs * 0.25, 1);\n\tt = clip((q - (qs - w)) / (2 * w), 0, 1);\n\treturn t * t * (3 - 2 * t);\n}\n\n// Seeded Fisher-Yates permutation of 1..r into pm.\nqc_perm(pm, r, seed) {\n\tfor (i = 1; i <= r; i += 1) {\n\t\tpm.poke(i, i);\n\t}\n\tfor (t = 0; t < r - 1; t += 1) {\n\t\ti = r - t;\n\t\tv = sin(i * 12.9898 + seed * 78.233) * 43758.5453;\n\t\tj = 1 + floor((v - floor(v)) * i);\n\t\tj = min(j, i);\n\t\ta = pm.peek(i);\n\t\tpm.poke(pm.peek(j), i);\n\t\tpm.poke(a, j);\n\t}\n\treturn r;\n}\n\n// Copy src[1..nc] (channel 0) into the telemetry buffer at off.\nqc_tele_c(src, scope, off, nc) {\n\tfor (q = 1; q <= nc; q += 1) {\n\t\tpoke(scope, src.peek(q), off + q - 1, 0);\n\t}\n\treturn nc;\n}\n\n// Max of src (positive peaks only) in nb log-spaced quefrency bins between qlo and qhi, into scope at off.\nqc_tele_strip(src, scope, off, nb, qlo, qhi, half) {\n\tratio = qhi / qlo;\n\tfor (b = 0; b < nb; b += 1) {\n\t\ta0 = floor(qlo * pow(ratio, b / nb));\n\t\ta1 = floor(qlo * pow(ratio, (b + 1) / nb));\n\t\ta0 = clip(a0, 1, half - 1);\n\t\ta1 = clip(max(a1, a0), a0, half - 1);\n\t\tm = 0;\n\t\tfor (q = a0; q <= a1; q += 1) {\n\t\t\tm = max(m, src.peek(q));\n\t\t}\n\t\tpoke(scope, m, off + b, 0);\n\t}\n\treturn nb;\n}\n\n// Magnitude from the log spectrum in fc, original phase kept, gain change limited to [-dn, +up] nepers per\n// bin, then the whole frame is scaled back to the input frame's energy (so no operation changes the loudness).\nqc_remag(fx, fc, n, eps, up, dn) {\n\tein = 0;\n\teout = 0;\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tmag = sqrt(xr * xr + xi * xi);\n\t\tg = 1;\n\t\tif (mag > 1e-20) {\n\t\t\td = clip(fc.peek(i, 0) - log(mag + eps), 0 - dn, up);\n\t\t\tg = max(((mag + eps) * exp(d) - eps) / mag, 0);\n\t\t\tfx.poke(xr * g, i, 0);\n\t\t\tfx.poke(xi * g, i, 1);\n\t\t}\n\t\tein = ein + mag * mag;\n\t\teout = eout + mag * mag * g * g;\n\t}\n\tgn = 1;\n\tif (eout > 1e-30 && ein > 1e-30) {\n\t\tgn = clip(sqrt(ein / eout), 0.05, 20);\n\t}\n\tif (abs(gn - 1) > 0.000001) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tfx.poke(fx.peek(i, 0) * gn, i, 0);\n\t\t\tfx.poke(fx.peek(i, 1) * gn, i, 1);\n\t\t}\n\t}\n\treturn gn;\n}\n\n// Soft knee: identity below 0.8, rounds off to 1.0.\nqc_soft(x) {\n\ta = abs(x);\n\treturn a <= 0.8 ? x : (x < 0 ? -1 : 1) * (0.8 + 0.2 * tanh((a - 0.8) * 5));\n}\n\n// Start the right channel's hop counter half a hop (n / 8) after the left one's, so the two channels' frames never\n// complete in the same sample and the worst-case CPU spike halves. Overlap-add stays exactly COLA at any phase and the\n// latency stays n - 1. Done once per N, before stft_in sees the new N (it would reset the counter to 0).\nqc_stagger(ring, st, n) {\n\tfor (i = 0; i < n; i += 1) {\n\t\tring.poke(0, i);\n\t}\n\tst.poke(0, 0);\n\tst.poke(n * 0.125, 1);\n\tst.poke(n, 2);\n\treturn n;\n}\n\n// Cepstral pitch peak of the original cepstrum (2..20 ms) into the telemetry: 200 quefrency, 201 confidence.\nqc_pitch(fc, scope, srv, n) {\n\tlo = floor(srv * 0.002);\n\thi = min(floor(srv * 0.02), n * 0.5 - 3);\n\tqp = 0;\n\tcp = 0;\n\tif (hi > lo + 4) {\n\t\tqk = cep_peak(fc, lo, hi);\n\t\tcp = cep_peak_conf(fc, qk, lo, hi);\n\t\tqp = cep_peak_refine(fc, qk);\n\t}\n\tpoke(scope, qp, 200, 0);\n\tpoke(scope, cp, 201, 0);\n\treturn qp;\n}\n\n// The crusher. fc (channel 0) holds the real cepstrum on entry and the crushed, mirrored cepstrum on exit\n// (channel 1 zero), ready for the forward FFT. cn: new cepstrum (q = 0..n/2), us: scramble scratch,\n// hd: held envelope, pm: shuffle permutation of 1..rr.\n// kq coefficients kept (float), smode 0 off / 1 reverse / 2 shuffle / 3 rotate, rho = 2^(shift/12),\n// useh 1 = envelope held, caph 1 = capture the envelope now, tele 1 = write telemetry.\nqc_proc(fc, cn, us, hd, pm, scope, srv, n, qs, kq, bits, smode, samt, rho, useh, caph, tele) {\n\thalf = n * 0.5;\n\tw = max(qs * 0.25, 1);\n\tqe = min(floor(qs + w) + 1, half - 1);\n\trr = max(2, min(floor(kq), floor(qs)));\n\tcn.poke(fc.peek(0, 0), 0);\n\tfor (q = 1; q <= qe; q += 1) {\n\t\tev = fc.peek(q, 0) * (1 - qc_hi(q, qs));\n\t\tif (caph > 0.5) {\n\t\t\thd.poke(ev, q);\n\t\t}\n\t\tif (useh > 0.5) {\n\t\t\tev = hd.peek(q);\n\t\t}\n\t\tcn.poke(ev, q);\n\t}\n\tif (smode > 0.5 && samt > 0.001) {\n\t\tfor (q = 1; q <= rr; q += 1) {\n\t\t\tus.poke(cn.peek(q) * q, q);\n\t\t}\n\t\tfor (q = 1; q <= rr; q += 1) {\n\t\t\tu0 = us.peek(q);\n\t\t\tu1 = u0;\n\t\t\tif (smode < 1.5) {\n\t\t\t\tu1 = us.peek(rr + 1 - q);\n\t\t\t} else if (smode < 2.5) {\n\t\t\t\tu1 = us.peek(pm.peek(q));\n\t\t\t} else {\n\t\t\t\tp0 = q - 1 - samt * rr * 0.5;\n\t\t\t\tp0 = p0 - rr * floor(p0 / rr);\n\t\t\t\ti0 = floor(p0) + 1;\n\t\t\t\tfr = p0 - floor(p0);\n\t\t\t\ti1 = i0 + 1;\n\t\t\t\tif (i1 > rr) {\n\t\t\t\t\ti1 = 1;\n\t\t\t\t}\n\t\t\t\tu1 = us.peek(i0) * (1 - fr) + us.peek(i1) * fr;\n\t\t\t}\n\t\t\tif (smode < 2.5) {\n\t\t\t\tu1 = u0 + (u1 - u0) * samt;\n\t\t\t}\n\t\t\tcn.poke(u1 / q, q);\n\t\t}\n\t}\n\tshifting = abs(rho - 1) > 0.0002;\n\tfor (q = qe + 1; q <= half; q += 1) {\n\t\tcn.poke(0, q);\n\t}\n\tif (shifting) {\n\t\t// splat each excitation coefficient to quefrency s / rho (linear, area preserving): narrow pitch peaks survive\n\t\tinr = 1 / rho;\n\t\tfor (s = 1; s <= half; s += 1) {\n\t\t\tex = fc.peek(s, 0) * qc_hi(s, qs);\n\t\t\tdq = s * inr;\n\t\t\tif (dq >= 1) {\n\t\t\t\ti0 = floor(dq);\n\t\t\t\tfr = dq - i0;\n\t\t\t\tif (i0 <= half) {\n\t\t\t\t\tcn.poke(cn.peek(i0) + ex * (1 - fr), i0);\n\t\t\t\t}\n\t\t\t\tif (i0 + 1 <= half) {\n\t\t\t\t\tcn.poke(cn.peek(i0 + 1) + ex * fr, i0 + 1);\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t} else {\n\t\tfor (q = 1; q <= half; q += 1) {\n\t\t\tcn.poke(cn.peek(q) + fc.peek(q, 0) * qc_hi(q, qs), q);\n\t\t}\n\t}\n\tif (kq < half - 0.5) {\n\t\ttw = max(2, kq * 0.2);\n\t\tfor (q = 1; q <= half; q += 1) {\n\t\t\tg = 0;\n\t\t\tif (q <= kq) {\n\t\t\t\tg = 1;\n\t\t\t\tif (q > kq - tw) {\n\t\t\t\t\tg = 0.5 + 0.5 * cos(3.141592653589793 * (q - (kq - tw)) / tw);\n\t\t\t\t}\n\t\t\t}\n\t\t\tcn.poke(cn.peek(q) * g, q);\n\t\t}\n\t}\n\tif (bits < 15.5) {\n\t\tstp = 1.5 * pow(2, 0 - (bits - 1) * 0.75);\n\t\tinv = 1 / stp;\n\t\tfor (q = 1; q <= half; q += 1) {\n\t\t\tcn.poke(round(cn.peek(q) * inv) * stp, q);\n\t\t}\n\t}\n\tif (tele > 0.5) {\n\t\tqc_tele_c(fc, scope, 0, 96);\n\t\tqc_tele_c(cn, scope, 96, 96);\n\t\tqlo = max(srv * 0.001, 2);\n\t\tqhi = max(srv * 0.025, qlo * 2);\n\t\tqc_tele_strip(fc, scope, 210, 48, qlo, qhi, half);\n\t\tqc_tele_strip(cn, scope, 258, 48, qlo, qhi, half);\n\t}\n\tfc.poke(cn.peek(0), 0, 0);\n\tfc.poke(0, 0, 1);\n\tfor (q = 1; q < half; q += 1) {\n\t\tv = cn.peek(q);\n\t\tfc.poke(v, q, 0);\n\t\tfc.poke(v, n - q, 0);\n\t\tfc.poke(0, q, 1);\n\t\tfc.poke(0, n - q, 1);\n\t}\n\tfc.poke(cn.peek(half), half, 0);\n\tfc.poke(0, half, 1);\n\treturn half;\n}\n\n// Telemetry when the crusher is bypassed: crushed = original.\nqc_tele_neutral(fc, scope, srv, n) {\n\thalf = n * 0.5;\n\tqc_tele_c(fc, scope, 0, 96);\n\tqc_tele_c(fc, scope, 96, 96);\n\tqlo = max(srv * 0.001, 2);\n\tqhi = max(srv * 0.025, qlo * 2);\n\tqc_tele_strip(fc, scope, 210, 48, qlo, qhi, half);\n\tqc_tele_strip(fc, scope, 258, 48, qlo, qhi, half);\n\treturn half;\n}\n\nBuffer scope(\"qcrushscope\");\n\nData tab(4096, 3);\nData win(4096);\nData fx(4096, 2);\nData fc(4096, 2);\nData ringL(4096);\nData accL(4096);\nData stL(4);\nData ringR(4096);\nData accR(4096);\nData stR(4);\nData cn(4096);\nData us(256);\nData hdL(256);\nData hdR(256);\nData pm(256);\nDelay padL(4096);\nDelay padR(4096);\nDelay dlyL(4097);\nDelay dlyR(4097);\n\nParam fftn(1024);\nParam coeffs(1);\nParam qbits(16);\nParam smode(0);\nParam samt(0.5);\nParam qshift(0);\nParam freeze(0);\nParam qhold(0);\nParam wet(1);\nParam outdb(0);\nParam bpm(120);\nParam ppq(0);\n\nHistory nCur(0);\nHistory nSeenR(0);\nHistory pdS(0);\nHistory pwS(0);\nHistory gAgc(1);\nHistory gT(1);\nHistory nCtl(0);\nHistory ctlCnt(0);\nHistory swState(0);\nHistory swWait(0);\nHistory wf(1);\nHistory mixS(1);\nHistory outS(1);\nHistory outT(1);\nHistory beat(0);\nHistory ppqPrev(0);\nHistory lastIdx(0);\nHistory roll(1);\nHistory permRoll(0);\nHistory permRR(0);\nHistory tickCnt(0);\nHistory capL(1);\nHistory capR(1);\nHistory vldL(0);\nHistory vldR(0);\nHistory fzPrev(0);\nHistory quietCnt(0);\nHistory levelPk(0);\nHistory teleAcc(0);\nHistory frameNo(0);\nHistory sleepNote(0);\nHistory kqH(512);\nHistory bqH(16);\nHistory smH(0);\nHistory saH(0.5);\nHistory rhoH(1);\nHistory shH(0);\nHistory qsH(88);\nHistory scrH(0);\nHistory neuH(1);\nHistory perH(1);\nHistory hidxH(0);\n\nsr = max(samplerate, 1);\nfft_init(tab);\n\n// --- Size: crossfade to dry, switch, wait for the pipeline to fill, fade the wet back in ---\nnReq = cep_n(fftn);\nif (nCur < 1) {\n\tnCur = nReq;\n}\nif (nReq != nCur && swState != 1 && swState != 2) {\n\tswState = 1;\n}\nif (swState == 1) {\n\twf = wf - 1 / 256;\n\tif (wf <= 0) {\n\t\twf = 0;\n\t\tnCur = nReq;\n\t\tswState = 2;\n\t\tswWait = 4096 + nCur + 128;\n\t}\n} else if (swState == 2) {\n\tswWait = swWait - 1;\n\tif (swWait <= 0) {\n\t\tswState = 3;\n\t}\n} else if (swState == 3) {\n\twf = wf + 1 / 512;\n\tif (wf >= 1) {\n\t\twf = 1;\n\t\tswState = 0;\n\t}\n}\nn = nCur;\nstft_win(win, n);\n\n// --- Control values, refreshed every 32 samples (and at once when N changes) ---\nctlCnt = ctlCnt + 1;\nif (ctlCnt >= 32 || n != nCtl) {\n\tctlCnt = 0;\n\tnCtl = n;\n\tcf = clip(coeffs, 0, 1);\n\tqsH = clip(round(sr * 0.002), 16, 96);\n\tkqH = n * 0.5;\n\tif (cf < 0.995) {\n\t\tkqH = cf < 0.75 ? 2 * pow(qsH * 0.5, cf / 0.75) : qsH + (n * 0.5 - qsH) * (cf - 0.75) / 0.25;\n\t}\n\tbqH = clip(round(qbits), 1, 16);\n\tsmH = round(clip(smode, 0, 3));\n\tsaH = clip(samt, 0, 1);\n\tshH = clip(qshift, -12, 12);\n\trhoH = pow(2, shH / 12);\n\tscrH = (smH > 0.5 && saH > 0.001) ? 1 : 0;\n\tneuH = (kqH >= n * 0.5 - 0.5 && bqH >= 15.5 && scrH < 0.5 && abs(shH) < 0.005) ? 1 : 0;\n\thidxH = round(clip(qhold, 0, 6));\n\tperH = hidxH < 0.5 ? 1 : pow(2, hidxH - 4);\n\toutT = pow(10, clip(outdb, -36, 12) / 20);\n}\n\n// --- Hold clock: free-runs on the host tempo, locks to the host position whenever it moves ---\nif (ppq != ppqPrev) {\n\tbeat = ppq;\n\tppqPrev = ppq;\n} else {\n\tbeat = beat + max(bpm, 20) / (60 * sr);\n}\ncidx = floor(beat / perH);\ntick = 0;\nif (cidx > lastIdx) {\n\ttick = 1;\n\tlastIdx = cidx;\n} else if (cidx < lastIdx - 1) {\n\tlastIdx = cidx;\n}\nclkPhase = beat / perH - cidx;\nfzOn = freeze > 0.5 ? 1 : 0;\nuseHold = (fzOn > 0.5 || hidxH > 0.5) ? 1 : 0;\nif (tick > 0.5) {\n\ttickCnt = wrap(tickCnt + 1, 0, 100000);\n\troll = wrap(roll + 1, 1, 100000);\n\tif (hidxH > 0.5 && fzOn < 0.5) {\n\t\tcapL = 1;\n\t\tcapR = 1;\n\t}\n\tpoke(scope, tickCnt, 197, 0);\n}\nif (fzOn > 0.5 && fzPrev < 0.5) {\n\tcapL = 1;\n\tcapR = 1;\n}\nfzPrev = fzOn;\nif (useHold < 0.5) {\n\tvldL = 0;\n\tvldR = 0;\n}\npoke(scope, clkPhase, 196, 0);\nneutral = (neuH > 0.5 && useHold < 0.5) ? 1 : 0;\n\n// --- Input level and silence sleep ---\ninAbs = max(abs(in1), abs(in2));\nquietCnt = inAbs > 0.00001 ? 0 : min(quietCnt + 1, 100000000);\nlevelPk = max(inAbs, levelPk * 0.9995);\nawake = quietCnt < n ? 1 : 0;\n\n// --- Frame scheduling ---\nrdyL = stft_in(ringL, stL, in1, n);\nif (nSeenR != n) {\n\tnSeenR = n;\n\tqc_stagger(ringR, stR, n);\n}\nrdyR = stft_in(ringR, stR, in2, n);\nif (rdyL > 0.5) {\n\tteleAcc = teleAcc + n * 0.25;\n}\nteleNow = 0;\nif (rdyL > 0.5 && teleAcc >= 2048) {\n\tteleNow = awake > 0.5 ? 1 : 0;\n\tteleAcc = 0;\n}\n\n// Shuffle permutation (shared by both channels, rebuilt when rolled or when the region changes)\nrrNow = max(2, min(floor(kqH), floor(qsH)));\nif (smH > 1.5 && smH < 2.5 && scrH > 0.5 && (roll != permRoll || rrNow != permRR)) {\n\tqc_perm(pm, rrNow, roll);\n\tpermRoll = roll;\n\tpermRR = rrNow;\n}\n\nif (rdyL > 0.5 && awake > 0.5) {\n\tstft_frame(fx, ringL, stL, win, n);\n\tfft_run(fx, tab, n, 0);\n\tif (neutral < 0.5 || teleNow > 0.5) {\n\t\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\t\tif (teleNow > 0.5) {\n\t\t\tqc_pitch(fc, scope, sr, n);\n\t\t}\n\t}\n\tif (neutral < 0.5) {\n\t\tcapNowL = (capL > 0.5 || (useHold > 0.5 && vldL < 0.5)) ? 1 : 0;\n\t\tqc_proc(fc, cn, us, hdL, pm, scope, sr, n, qsH, kqH, bqH, smH, saH, rhoH, useHold, capNowL, teleNow);\n\t\tcep_to_logmag(fc, tab, n);\n\t\tqc_remag(fx, fc, n, 1e-9, 3.45, 8);\n\t\tif (capNowL > 0.5) {\n\t\t\tvldL = 1;\n\t\t\tcapL = 0;\n\t\t}\n\t} else if (teleNow > 0.5) {\n\t\tqc_tele_neutral(fc, scope, sr, n);\n\t}\n\tfft_run(fx, tab, n, 1);\n\tstft_ola(accL, stL, fx, win, n);\n}\nif (rdyR > 0.5 && awake > 0.5) {\n\tstft_frame(fx, ringR, stR, win, n);\n\tfft_run(fx, tab, n, 0);\n\tif (neutral < 0.5) {\n\t\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\t\tcapNowR = (capR > 0.5 || (useHold > 0.5 && vldR < 0.5)) ? 1 : 0;\n\t\tqc_proc(fc, cn, us, hdR, pm, scope, sr, n, qsH, kqH, bqH, smH, saH, rhoH, useHold, capNowR, 0);\n\t\tcep_to_logmag(fc, tab, n);\n\t\tqc_remag(fx, fc, n, 1e-9, 3.45, 8);\n\t\tif (capNowR > 0.5) {\n\t\t\tvldR = 1;\n\t\t\tcapR = 0;\n\t\t}\n\t}\n\tfft_run(fx, tab, n, 1);\n\tstft_ola(accR, stR, fx, win, n);\n}\nyL = stft_out(accL, stL, n);\nyR = stft_out(accR, stR, n);\n\n// --- Telemetry scalars ---\nif (teleNow > 0.5) {\n\tframeNo = wrap(frameNo + 1, 0, 100000);\n\tpoke(scope, n, 192, 0);\n\tpoke(scope, kqH, 193, 0);\n\tpoke(scope, bqH, 194, 0);\n\tpoke(scope, useHold, 195, 0);\n\tpoke(scope, roll, 198, 0);\n\tpoke(scope, levelPk, 199, 0);\n\tpoke(scope, peek(scope, 200, 0) / rhoH, 202, 0);\n\tpoke(scope, frameNo, 203, 0);\n\tpoke(scope, sr, 204, 0);\n\tpoke(scope, qsH, 205, 0);\n\tpoke(scope, smH * scrH, 206, 0);\n\tpoke(scope, saH, 207, 0);\n\tpoke(scope, rhoH, 208, 0);\n\tpoke(scope, neutral, 209, 0);\n}\nif (awake < 0.5 && sleepNote < 0.5) {\n\tpoke(scope, 0, 199, 0);\n\tsleepNote = 1;\n}\nif (awake > 0.5) {\n\tsleepNote = 0;\n}\n\n// --- Constant 4096 latency, dry aligned, mix and output ---\npadL.write(yL);\npadR.write(yR);\nwetL = padL.read(4096 - (n - 1));\nwetR = padR.read(4096 - (n - 1));\ndlyL.write(in1);\ndlyR.write(in2);\ndryL = dlyL.read(4096);\ndryR = dlyR.read(4096);\nmixS = mixS + 0.002 * (clip(wet, 0, 1) - mixS);\noutS = outS + 0.002 * (outT - outS);\nmEff = mixS * wf;\n// Loudness match: heavy spectral edits lose energy in the overlap-add, so the wet path follows the dry one's level\n// (60 ms power average, gain limited to +-12 dB, frozen while Size changes, off at neutral settings).\nif (swState < 0.5) {\n\tpdS = pdS + 0.0004 * ((dryL * dryL + dryR * dryR) * 0.5 - pdS);\n\tpwS = pwS + 0.0004 * ((wetL * wetL + wetR * wetR) * 0.5 - pwS);\n\tgT = neuH > 0.5 ? 1 : clip(sqrt((pdS + 1e-10) / (pwS + 1e-10)), 0.25, 4);\n\tgAgc = gAgc + 0.0005 * (gT - gAgc);\n}\n// Scrambled and shifted spectra with the original (pulse-aligned) phase can peak well above the input: crushed audio is\n// kept under 1.0 by a soft knee that starts at 0.8. Neutral settings pass the wet path untouched.\nif (neuH < 0.5) {\n\twetL = qc_soft(wetL * gAgc);\n\twetR = qc_soft(wetR * gAgc);\n}\nout1 = fixnan(fixdenorm((dryL * (1 - mEff) + wetL * mEff) * outS));\nout2 = fixnan(fixdenorm((dryR * (1 - mEff) + wetR * mEff) * outS));\n",
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
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"bang"
					],
					"patching_rect": [
						200.0,
						470.0,
						480.0,
						20.0
					],
					"text": "js /Users/mrwilson/software/ableton/tests/qcrush_probe.js mix /tmp/qcrush_audio.txt 4096"
				}
			},
			{
				"box": {
					"id": "obj-phasor",
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
					"text": "phasor~ 0.3333333333333333"
				}
			},
			{
				"box": {
					"id": "obj-wave",
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
					"text": "wave~ stim"
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
						"obj-bind",
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
						"obj-del-fill",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-del-fill",
						0
					],
					"destination": [
						"obj-fill",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-fill",
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
						1
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
						"obj-wave",
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
						"obj-phasor",
						0
					],
					"destination": [
						"obj-record",
						3
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
						"obj-phasor",
						0
					],
					"destination": [
						"obj-wave",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-wave",
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
						"obj-wave",
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
