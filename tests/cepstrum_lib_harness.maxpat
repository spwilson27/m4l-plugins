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
					"text": "delay 1500"
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
						40.0,
						360.0,
						140.0,
						20.0
					],
					"text": "analyze 30000 4200"
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
					"text": "fftn 1024, mode 0, src 0, per 150"
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
					"text": "buffer~ rec @samps 131072 @chans 4"
				}
			},
			{
				"box": {
					"code": "// cepstrum_lib.genexpr \u2014 shared STFT + real-cepstrum engine for gen.codebox~.\n// Device build scripts PREPEND this file to their own core, so every function\n// below sits ahead of the core's Param, History, Delay and Data declarations\n// (GenExpr requires functions first). Reference: src/cepstrum_ref.js.\n//\n// ---------------------------------------------------------------------------\n// Verified in Max 9.1 (tests/test_cepstrum_lib.js + scripts/run_cepstrum_lib_audio_tests.py)\n//   * Functions CAN take Data arguments, and they are passed by reference:\n//     d.peek(i[, ch]) and d.poke(value, i[, ch]) inside a function change the\n//     caller's Data. A function body can NOT see a global Data, so the library\n//     has no fixed names: the core declares Data and passes it in.\n//   * A function whose result is assigned to an unused variable is removed as\n//     dead code (`z = fn(d);` does nothing). Call work functions as BARE\n//     statements (`fn(d);`), which stay in statement order, also inside `if`.\n//   * Never name an identifier \"e\" followed by digits: the lexer reads Euler's constant.\n//\n// Data the core must declare (sizes are the maximum; N is 512..4096):\n//   Data tab(4096, 3);   // twiddles + bit reversal. Shared by every FFT in the core.\n//   Data win(4096);      // Hann table, shared by every channel.\n//   Data fx(4096, 2);    // work spectrum/frame: channel 0 = real, 1 = imag. Shared.\n//   Data fc(4096, 2);    // work cepstrum / log spectrum, same layout. Shared.\n//   Per audio channel:\n//   Data ring(4096);     // input ring buffer.\n//   Data acc(4096);      // overlap-add accumulator.\n//   Data st(4);          // framing state (write position, hop counter, N seen by in/out).\n// fx and fc are scratch: they are only valid inside one hop-boundary block, so\n// L and R can reuse them one after the other. Devices that need to keep a\n// cepstrum or spectrum across frames (freeze, novelty) add their own Data.\n//\n// Per-sample call order for each channel (see the skeleton at the end):\n//   fft_init(tab); stft_win(win, n);\n//   rdy = stft_in(ring, st, x, n);\n//   if (rdy) { stft_frame -> fft_run -> ...process... -> fft_run(inverse) -> stft_ola }\n//   y = stft_out(acc, st, n);\n//\n// Latency: the frame is processed in the same sample that completes it, and\n// output sample s leaves the accumulator once the last frame covering it is\n// added. That is N - 1 samples for hop N/4 (out[t] = in[t - (N - 1)]; measured\n// exactly in real Max at 512/1024/2048/4096). Identity gain is exactly 1: Hann\n// analysis x Hann synthesis sums to 1.5 at hop N/4, and stft_ola scales by 2/3.\n// Live's reported latency (patcher \"latency\" attribute) is static, so a device\n// with a user-selectable N should pad with a Delay to a constant 4096 samples:\n//   Delay padl(4096);  padl.write(y);  out = padl.read(4096 - (n - 1));\n// Changing n clears the ring and accumulator (stft_in / stft_out), so the output\n// is silent for the first n - 1 samples after the change.\n// Cost (Max 9, 44.1 kHz, per mono instance): identity about 0.75 % of a core,\n// forward + cepstrum + inverse chain about 1.7 %, nearly flat in N. All of it\n// runs in the one sample that completes a hop; stereo can pack L and R into the\n// real and imaginary parts of one FFT if that ever matters.\n// ---------------------------------------------------------------------------\n\n// Snap a requested size to a power of two in 512..4096.\ncep_n(req) {\n\treturn pow(2, clip(round(log(max(req, 1)) * 1.4426950408889634), 9, 12));\n}\n\n// Twiddle table (forward kernel: cos and -sin of 2*pi*k/4096, k < 2048) in\n// tab channels 0/1, and the 12-bit bit-reversed index in channel 2. Runs once\n// (History guard), so call it every sample for free.\nfft_init(tab) {\n\tHistory done(0);\n\tif (done == 0) {\n\t\tfor (k = 0; k < 2048; k += 1) {\n\t\t\tph = 6.283185307179586 * k / 4096;\n\t\t\ttab.poke(cos(ph), k, 0);\n\t\t\ttab.poke(-sin(ph), k, 1);\n\t\t}\n\t\tfor (i = 0; i < 4096; i += 1) {\n\t\t\tr = 0;\n\t\t\tv = i;\n\t\t\tfor (b = 0; b < 12; b += 1) {\n\t\t\t\thv = floor(v * 0.5);\n\t\t\t\tr = r * 2 + (v - hv * 2);\n\t\t\t\tv = hv;\n\t\t\t}\n\t\t\ttab.poke(r, i, 2);\n\t\t}\n\t\tdone = 1;\n\t}\n\treturn done;\n}\n\n// In-place radix-2 FFT of x (channel 0 = real, 1 = imag) over n points, n a\n// power of two <= 4096. inv = 1 runs the inverse and scales by 1 / n.\n// The bit-reversed index for n is the 12-bit one divided by 4096 / n (rdiv).\nfft_run(x, tab, n, inv) {\n\trdiv = 4096 / n;\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = tab.peek(i, 2) / rdiv;\n\t\tif (j > i) {\n\t\t\ttr = x.peek(i, 0);\n\t\t\tti = x.peek(i, 1);\n\t\t\tx.poke(x.peek(j, 0), i, 0);\n\t\t\tx.poke(x.peek(j, 1), i, 1);\n\t\t\tx.poke(tr, j, 0);\n\t\t\tx.poke(ti, j, 1);\n\t\t}\n\t}\n\tsgn = inv > 0.5 ? -1 : 1;\n\tfor (len = 2; len <= n; len *= 2) {\n\t\thalf = len * 0.5;\n\t\tstp = 4096 / len;\n\t\tfor (s = 0; s < n; s += len) {\n\t\t\tfor (k = 0; k < half; k += 1) {\n\t\t\t\twr = tab.peek(k * stp, 0);\n\t\t\t\twi = sgn * tab.peek(k * stp, 1);\n\t\t\t\ta = s + k;\n\t\t\t\tb = a + half;\n\t\t\t\txr = x.peek(b, 0);\n\t\t\t\txi = x.peek(b, 1);\n\t\t\t\ttr = xr * wr - xi * wi;\n\t\t\t\tti = xr * wi + xi * wr;\n\t\t\t\tur = x.peek(a, 0);\n\t\t\t\tui = x.peek(a, 1);\n\t\t\t\tx.poke(ur + tr, a, 0);\n\t\t\t\tx.poke(ui + ti, a, 1);\n\t\t\t\tx.poke(ur - tr, b, 0);\n\t\t\t\tx.poke(ui - ti, b, 1);\n\t\t\t}\n\t\t}\n\t}\n\tif (inv > 0.5) {\n\t\tsc = 1 / n;\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tx.poke(x.peek(i, 0) * sc, i, 0);\n\t\t\tx.poke(x.peek(i, 1) * sc, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// Periodic Hann table for n points. Rebuilt only when n changes.\nstft_win(win, n) {\n\tHistory wn(0);\n\tif (n != wn) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\twin.poke(0.5 - 0.5 * cos(6.283185307179586 * i / n), i);\n\t\t}\n\t\twn = n;\n\t}\n\treturn wn;\n}\n\n// Push one sample. Returns 1 when a hop (n / 4 samples) completed and a frame\n// is ready. Changing n clears the ring and restarts the hop counter.\n// st: 0 = write position (= oldest sample), 1 = hop counter, 2 = n seen here.\nstft_in(ring, st, x, n) {\n\tif (n != st.peek(2)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tring.poke(0, i);\n\t\t}\n\t\tst.poke(0, 0);\n\t\tst.poke(0, 1);\n\t\tst.poke(n, 2);\n\t}\n\twp = st.peek(0);\n\tring.poke(x, wp);\n\twp += 1;\n\tif (wp >= n) {\n\t\twp = 0;\n\t}\n\tcnt = st.peek(1) + 1;\n\trdy = 0;\n\tif (cnt >= n * 0.25) {\n\t\tcnt = 0;\n\t\trdy = 1;\n\t}\n\tst.poke(wp, 0);\n\tst.poke(cnt, 1);\n\treturn rdy;\n}\n\n// Copy the last n samples, oldest first, times the Hann window into fx (imag 0).\nstft_frame(fx, ring, st, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tfx.poke(ring.peek(j) * win.peek(i), i, 0);\n\t\tfx.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Weighted overlap-add: window the real part of fx and add it into acc at the\n// frame's start position. 2 / 3 = 1 / sum(Hann^2) at hop n / 4.\nstft_ola(acc, st, fx, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tacc.poke(acc.peek(j) + fx.peek(i, 0) * win.peek(i) * 0.6666666666666666, j);\n\t}\n\treturn 0;\n}\n\n// One output sample: the oldest accumulator slot is finished, so read and clear\n// it. Call after the frame block, every sample. Clears acc when n changes.\n// st: 3 = n seen here.\nstft_out(acc, st, n) {\n\tif (n != st.peek(3)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tacc.poke(0, i);\n\t\t}\n\t\tst.poke(n, 3);\n\t}\n\twp = st.peek(0);\n\ty = acc.peek(wp);\n\tacc.poke(0, wp);\n\treturn y;\n}\n\n// Real cepstrum of the complex spectrum in fx: fc = IFFT(log(|X| + eps)).\n// fc channel 0 holds c[n] (real and even), channel 1 is about 0.\ncep_from_spec(fx, fc, tab, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tfc.poke(log(sqrt(xr * xr + xi * xi) + eps), i, 0);\n\t\tfc.poke(0, i, 1);\n\t}\n\tfft_run(fc, tab, n, 1);\n\treturn 0;\n}\n\n// Cepstrum (any cepstrum, in place) back to the log spectrum: forward FFT.\n// For an even cepstrum fc channel 0 becomes log|X|. For a folded (min or max\n// phase) cepstrum channel 0 is log|X| and channel 1 is the phase in radians.\ncep_to_logmag(fc, tab, n) {\n\tfft_run(fc, tab, n, 0);\n\treturn 0;\n}\n\n// Minimum-phase fold in place: c[0], 2 c[i] for 0 < i < n/2, c[n/2], else 0.\ncep_fold_minphase(fc, n) {\n\thalf = n * 0.5;\n\tfor (i = 1; i < half; i += 1) {\n\t\tfc.poke(fc.peek(i, 0) * 2, i, 0);\n\t}\n\tfor (i = half + 1; i < n; i += 1) {\n\t\tfc.poke(0, i, 0);\n\t}\n\tfor (i = 0; i < n; i += 1) {\n\t\tfc.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Maximum-phase fold: the minimum-phase cepstrum mirrored in quefrency\n// (c_max[i] = c_min[n - i]). Same magnitude, opposite phase.\ncep_fold_maxphase(fc, n) {\n\thalf = n * 0.5;\n\tcep_fold_minphase(fc, n);\n\tfor (i = 1; i < half; i += 1) {\n\t\tt = fc.peek(i, 0);\n\t\tfc.poke(0, i, 0);\n\t\tfc.poke(t, n - i, 0);\n\t}\n\treturn 0;\n}\n\n// Complex exponential of the log spectrum in fc (re = log magnitude, im =\n// phase) into the spectrum fx, minus the eps added in cep_from_spec. After a\n// minimum-phase fold this is the minimum-phase spectrum with the original magnitude.\ncep_exp_spec(fc, fx, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tph = fc.peek(i, 1);\n\t\tfx.poke(m * cos(ph), i, 0);\n\t\tfx.poke(m * sin(ph), i, 1);\n\t}\n\treturn 0;\n}\n\n// Impose the magnitude exp(fc.re) - eps on the phase already in fx (keep the\n// original phase, change only the magnitude: Lifter EQ, crusher, and so on).\ncep_remag(fx, fc, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tmag = sqrt(xr * xr + xi * xi);\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tif (mag > 1e-20) {\n\t\t\tg = m / mag;\n\t\t\tfx.poke(xr * g, i, 0);\n\t\t\tfx.poke(xi * g, i, 1);\n\t\t} else {\n\t\t\tfx.poke(m, i, 0);\n\t\t\tfx.poke(0, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// Cepstral pitch peak: the quefrency index in [lo, hi] (samples; 2..20 ms is\n// lo = samplerate * 0.002, hi = samplerate * 0.02) where c[q] is largest.\n// fc channel 0 must hold the real cepstrum from cep_from_spec.\ncep_peak(fc, lo, hi) {\n\tbest = -1e30;\n\tbi = lo;\n\tfor (q = lo; q <= hi; q += 1) {\n\t\tv = fc.peek(q, 0);\n\t\tif (v > best) {\n\t\t\tbest = v;\n\t\t\tbi = q;\n\t\t}\n\t}\n\treturn bi;\n}\n\n// Confidence 0..1 for the peak at q: z-score of c[q] against the [lo, hi]\n// range, mapped 3 sigma -> 0 and 10 sigma -> 1. White noise stays near 0.\ncep_peak_conf(fc, q, lo, hi) {\n\tcntq = hi - lo + 1;\n\tsm = 0;\n\tsq = 0;\n\tfor (i = lo; i <= hi; i += 1) {\n\t\tv = fc.peek(i, 0);\n\t\tsm += v;\n\t\tsq += v * v;\n\t}\n\tmu = sm / cntq;\n\tsd = sqrt(max(sq / cntq - mu * mu, 1e-20));\n\treturn clip(((fc.peek(q, 0) - mu) / sd - 3) / 7, 0, 1);\n}\n\n// Parabolic refinement of the peak at q: fractional quefrency in samples.\ncep_peak_refine(fc, q) {\n\ta = fc.peek(q - 1, 0);\n\tb = fc.peek(q, 0);\n\tc = fc.peek(q + 1, 0);\n\tden = a - 2 * b + c;\n\treturn q + (abs(den) > 1e-20 ? clip(0.5 * (a - c) / den, -0.5, 0.5) : 0);\n}\n\n// ---------------------------------------------------------------------------\n// Skeleton of a device core (mono; stereo repeats the per-channel part with\n// ringR/accR/stR and reuses fx, fc, tab, win):\n//\n//   Param fftn(1024);\n//   Data tab(4096, 3);  Data win(4096);  Data fx(4096, 2);  Data fc(4096, 2);\n//   Data ring(4096);    Data acc(4096);  Data st(4);\n//   n = cep_n(fftn);\n//   fft_init(tab);\n//   stft_win(win, n);\n//   rdy = stft_in(ring, st, in1, n);\n//   if (rdy) {\n//       stft_frame(fx, ring, st, win, n);\n//       fft_run(fx, tab, n, 0);              // fx = X\n//       cep_from_spec(fx, fc, tab, n, 1e-9); // fc = real cepstrum\n//       cep_fold_minphase(fc, n);            // ...process the cepstrum...\n//       cep_to_logmag(fc, tab, n);           // fc = log|X| + j phase\n//       cep_exp_spec(fc, fx, n, 1e-9);       // fx = new spectrum\n//       fft_run(fx, tab, n, 1);              // back to time\n//       stft_ola(acc, st, fx, win, n);\n//   }\n//   out1 = stft_out(acc, st, n);             // delayed by n - 1 samples\n// ---------------------------------------------------------------------------\n\n// Test core for src/cepstrum_lib.genexpr (prepended by\n// scripts/run_cepstrum_lib_audio_tests.py). Mono STFT with a selectable\n// per-frame process, plus a built-in pulse train for the pitch-peak check.\n//   mode 0 identity, 1 minimum phase, 2 cepstrum round trip keeping the phase,\n//   3 identity + cepstral pitch peak (out2 = quefrency, out3 = confidence),\n//   4 maximum phase.\n// out1 = processed signal, out2 = pitch quefrency (samples, mode 3) or the FFT size in use, out3 = pitch confidence (mode 3) or\n// samplerate / 100000 (other modes; the Max test reads the real rate from it).\n\nParam fftn(1024);\nParam mode(0);\nParam src(0);\nParam per(150);\nParam fftn2(512);\nParam swsec(0);\nParam pad(0);\n\nData tab(4096, 3);\nData win(4096);\nData fx(4096, 2);\nData fc(4096, 2);\nData ring(4096);\nData acc(4096);\nData st(4);\nDelay padl(4096);\nHistory tc(0);\nHistory pc(0);\nHistory qh(0);\nHistory ch(0);\n\n// FFT size, with an optional switch to fftn2 at swsec seconds after DSP\n// start (the N-change test; a message from Max is not sample accurate).\ntc += 1;\nreq = (swsec > 0 && tc > swsec * samplerate) ? fftn2 : fftn;\nn = cep_n(req);\nfft_init(tab);\nstft_win(win, n);\n\n// Built-in pulse train (src = 1) or the external input.\npc += 1;\npulse = 0;\nif (pc >= per) {\n\tpc = 0;\n\tpulse = 0.5;\n}\nx = src > 0.5 ? pulse : in1;\n\nrdy = stft_in(ring, st, x, n);\nif (rdy) {\n\tstft_frame(fx, ring, st, win, n);\n\tfft_run(fx, tab, n, 0);\n\t// modes 1 and 4: minimum / maximum phase, same magnitude\n\tif (mode > 0.5 && mode < 1.5) {\n\t\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\t\tcep_fold_minphase(fc, n);\n\t\tcep_to_logmag(fc, tab, n);\n\t\tcep_exp_spec(fc, fx, n, 1e-9);\n\t}\n\tif (mode > 3.5) {\n\t\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\t\tcep_fold_maxphase(fc, n);\n\t\tcep_to_logmag(fc, tab, n);\n\t\tcep_exp_spec(fc, fx, n, 1e-9);\n\t}\n\t// mode 2: cepstrum -> log magnitude -> original phase back on\n\tif (mode > 1.5 && mode < 2.5) {\n\t\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\t\tcep_to_logmag(fc, tab, n);\n\t\tcep_remag(fx, fc, n, 1e-9);\n\t}\n\t// mode 3: pitch peak, spectrum untouched\n\tif (mode > 2.5 && mode < 3.5) {\n\t\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\t\tlo = floor(samplerate * 0.002);\n\t\thi = floor(samplerate * 0.02);\n\t\tq = cep_peak(fc, lo, hi);\n\t\tch = cep_peak_conf(fc, q, lo, hi);\n\t\tqh = cep_peak_refine(fc, q);\n\t}\n\tfft_run(fx, tab, n, 1);\n\tstft_ola(acc, st, fx, win, n);\n}\ny = stft_out(acc, st, n);\n// pad = 1: constant total latency of 4096 samples for every N, so a device can\n// report one fixed latency to Live whatever FFT size the user picks.\npadl.write(y);\nout1 = pad > 0.5 ? padl.read(4096 - (n - 1)) : y;\nout2 = (mode > 2.5 && mode < 3.5) ? qh : n;\nout3 = (mode > 2.5 && mode < 3.5) ? ch : samplerate * 0.00001;\n",
					"fontname": "<Monospaced>",
					"fontsize": 10.0,
					"id": "obj-gen",
					"maxclass": "gen.codebox~",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"signal",
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
					"text": "js /Users/mrwilson/software/ableton/tests/cepstrum_lib_probe.js /tmp/cepstrum_lib_audio.txt 16384"
				}
			},
			{
				"box": {
					"id": "obj-noise",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						40.0,
						60.0,
						20.0
					],
					"text": "noise~"
				}
			},
			{
				"box": {
					"id": "obj-ng",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						70.0,
						50.0,
						20.0
					],
					"text": "*~ 0.2"
				}
			},
			{
				"box": {
					"id": "obj-sine",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						780.0,
						40.0,
						80.0,
						20.0
					],
					"text": "cycle~ 440"
				}
			},
			{
				"box": {
					"id": "obj-sg",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						780.0,
						70.0,
						50.0,
						20.0
					],
					"text": "*~ 0.3"
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
						700.0,
						100.0,
						40.0,
						20.0
					],
					"text": "+~"
				}
			},
			{
				"box": {
					"id": "obj-mute",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						130.0,
						50.0,
						20.0
					],
					"text": "*~ 1"
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
						"obj-mute",
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
						"obj-gen",
						2
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
						"obj-mute",
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
						"obj-noise",
						0
					],
					"destination": [
						"obj-ng",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-sine",
						0
					],
					"destination": [
						"obj-sg",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ng",
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
						"obj-sg",
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
						"obj-mute",
						0
					]
				}
			}
		]
	}
}
