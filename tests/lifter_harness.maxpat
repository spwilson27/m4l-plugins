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
			1100.0,
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
					"text": "delay 1500"
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
					"id": "obj-del-snap",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						140.0,
						200.0,
						80.0,
						20.0
					],
					"text": "delay 300"
				}
			},
			{
				"box": {
					"id": "obj-snap",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						140.0,
						230.0,
						40.0,
						20.0
					],
					"text": "snap"
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
						160.0,
						20.0
					],
					"text": "analyze 66000 0 200"
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
						560.0,
						20.0
					],
					"text": "sizei 2, depthp 100, smoothp 0, wetp 100, outdb 0, trackp 0"
				}
			},
			{
				"box": {
					"id": "obj-bind-curve",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200.0,
						70.0,
						170.0,
						20.0
					],
					"text": "lcurve #0-liftercurve"
				}
			},
			{
				"box": {
					"id": "obj-bind-scope",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						380.0,
						70.0,
						170.0,
						20.0
					],
					"text": "lscope #0-lifterscope"
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
						560.0,
						70.0,
						250.0,
						20.0
					],
					"text": "setbuffer #0-lifterscope #0-liftercurve"
				}
			},
			{
				"box": {
					"id": "obj-curve",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						200.0,
						100.0,
						400.0,
						20.0
					],
					"text": "curve 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 -0.00688 -0.23936 -0.77717 -1.58636 -2.63301 -3.88321 -5.30303 -6.85854 -8.51582 -10.24095 -12.00000 -13.75905 -15.48418 -17.14146 -18.69697 -20.11679 -21.36699 -22.41364 -23.22283 -23.76064 -23.99312 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -24.00000 -23.93894 -23.58025 -22.92982 -22.02158 -20.88943 -19.56732 -18.08915 -16.48886 -14.80037 -13.05760 -11.29448 -9.54493 -7.84287 -6.22222 -4.71692 -3.36088 -2.18803 -1.23229 -0.52758 -0.10783 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000 0.00000"
				}
			},
			{
				"box": {
					"id": "obj-curvebuf",
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
						220.0,
						20.0
					],
					"text": "buffer~ #0-liftercurve @samps 256"
				}
			},
			{
				"box": {
					"id": "obj-scopebuf",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"float",
						"bang"
					],
					"patching_rect": [
						520.0,
						170.0,
						220.0,
						20.0
					],
					"text": "buffer~ #0-lifterscope @samps 512"
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
						200.0,
						220.0,
						20.0
					],
					"text": "buffer~ rec @samps 131072 @chans 3"
				}
			},
			{
				"box": {
					"code": "// cepstrum_lib.genexpr \u2014 shared STFT + real-cepstrum engine for gen.codebox~.\n// Device build scripts PREPEND this file to their own core, so every function\n// below sits ahead of the core's Param, History, Delay and Data declarations\n// (GenExpr requires functions first). Reference: src/cepstrum_ref.js.\n//\n// ---------------------------------------------------------------------------\n// Verified in Max 9.1 (tests/test_cepstrum_lib.js + scripts/run_cepstrum_lib_audio_tests.py)\n//   * Functions CAN take Data arguments, and they are passed by reference:\n//     d.peek(i[, ch]) and d.poke(value, i[, ch]) inside a function change the\n//     caller's Data. A function body can NOT see a global Data, so the library\n//     has no fixed names: the core declares Data and passes it in.\n//   * A function whose result is assigned to an unused variable is removed as\n//     dead code (`z = fn(d);` does nothing). Call work functions as BARE\n//     statements (`fn(d);`), which stay in statement order, also inside `if`.\n//   * Never name an identifier \"e\" followed by digits: the lexer reads Euler's constant.\n//\n// Data the core must declare (sizes are the maximum; N is 512..4096):\n//   Data tab(4096, 3);   // twiddles + bit reversal. Shared by every FFT in the core.\n//   Data win(4096);      // Hann table, shared by every channel.\n//   Data fx(4096, 2);    // work spectrum/frame: channel 0 = real, 1 = imag. Shared.\n//   Data fc(4096, 2);    // work cepstrum / log spectrum, same layout. Shared.\n//   Per audio channel:\n//   Data ring(4096);     // input ring buffer.\n//   Data acc(4096);      // overlap-add accumulator.\n//   Data st(4);          // framing state (write position, hop counter, N seen by in/out).\n// fx and fc are scratch: they are only valid inside one hop-boundary block, so\n// L and R can reuse them one after the other. Devices that need to keep a\n// cepstrum or spectrum across frames (freeze, novelty) add their own Data.\n//\n// Per-sample call order for each channel (see the skeleton at the end):\n//   fft_init(tab); stft_win(win, n);\n//   rdy = stft_in(ring, st, x, n);\n//   if (rdy) { stft_frame -> fft_run -> ...process... -> fft_run(inverse) -> stft_ola }\n//   y = stft_out(acc, st, n);\n//\n// Latency: the frame is processed in the same sample that completes it, and\n// output sample s leaves the accumulator once the last frame covering it is\n// added. That is N - 1 samples for hop N/4 (out[t] = in[t - (N - 1)]; measured\n// exactly in real Max at 512/1024/2048/4096). Identity gain is exactly 1: Hann\n// analysis x Hann synthesis sums to 1.5 at hop N/4, and stft_ola scales by 2/3.\n// Live's reported latency (patcher \"latency\" attribute) is static, so a device\n// with a user-selectable N should pad with a Delay to a constant 4096 samples:\n//   Delay padl(4096);  padl.write(y);  out = padl.read(4096 - (n - 1));\n// Changing n clears the ring and accumulator (stft_in / stft_out), so the output\n// is silent for the first n - 1 samples after the change.\n// Cost (Max 9, 44.1 kHz, per mono instance): identity about 0.75 % of a core,\n// forward + cepstrum + inverse chain about 1.7 %, nearly flat in N. All of it\n// runs in the one sample that completes a hop; stereo can pack L and R into the\n// real and imaginary parts of one FFT if that ever matters.\n// ---------------------------------------------------------------------------\n\n// Snap a requested size to a power of two in 512..4096.\ncep_n(req) {\n\treturn pow(2, clip(round(log(max(req, 1)) * 1.4426950408889634), 9, 12));\n}\n\n// Twiddle table (forward kernel: cos and -sin of 2*pi*k/4096, k < 2048) in\n// tab channels 0/1, and the 12-bit bit-reversed index in channel 2. Runs once\n// (History guard), so call it every sample for free.\nfft_init(tab) {\n\tHistory done(0);\n\tif (done == 0) {\n\t\tfor (k = 0; k < 2048; k += 1) {\n\t\t\tph = 6.283185307179586 * k / 4096;\n\t\t\ttab.poke(cos(ph), k, 0);\n\t\t\ttab.poke(-sin(ph), k, 1);\n\t\t}\n\t\tfor (i = 0; i < 4096; i += 1) {\n\t\t\tr = 0;\n\t\t\tv = i;\n\t\t\tfor (b = 0; b < 12; b += 1) {\n\t\t\t\thv = floor(v * 0.5);\n\t\t\t\tr = r * 2 + (v - hv * 2);\n\t\t\t\tv = hv;\n\t\t\t}\n\t\t\ttab.poke(r, i, 2);\n\t\t}\n\t\tdone = 1;\n\t}\n\treturn done;\n}\n\n// In-place radix-2 FFT of x (channel 0 = real, 1 = imag) over n points, n a\n// power of two <= 4096. inv = 1 runs the inverse and scales by 1 / n.\n// The bit-reversed index for n is the 12-bit one divided by 4096 / n (rdiv).\nfft_run(x, tab, n, inv) {\n\trdiv = 4096 / n;\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = tab.peek(i, 2) / rdiv;\n\t\tif (j > i) {\n\t\t\ttr = x.peek(i, 0);\n\t\t\tti = x.peek(i, 1);\n\t\t\tx.poke(x.peek(j, 0), i, 0);\n\t\t\tx.poke(x.peek(j, 1), i, 1);\n\t\t\tx.poke(tr, j, 0);\n\t\t\tx.poke(ti, j, 1);\n\t\t}\n\t}\n\tsgn = inv > 0.5 ? -1 : 1;\n\tfor (len = 2; len <= n; len *= 2) {\n\t\thalf = len * 0.5;\n\t\tstp = 4096 / len;\n\t\tfor (s = 0; s < n; s += len) {\n\t\t\tfor (k = 0; k < half; k += 1) {\n\t\t\t\twr = tab.peek(k * stp, 0);\n\t\t\t\twi = sgn * tab.peek(k * stp, 1);\n\t\t\t\ta = s + k;\n\t\t\t\tb = a + half;\n\t\t\t\txr = x.peek(b, 0);\n\t\t\t\txi = x.peek(b, 1);\n\t\t\t\ttr = xr * wr - xi * wi;\n\t\t\t\tti = xr * wi + xi * wr;\n\t\t\t\tur = x.peek(a, 0);\n\t\t\t\tui = x.peek(a, 1);\n\t\t\t\tx.poke(ur + tr, a, 0);\n\t\t\t\tx.poke(ui + ti, a, 1);\n\t\t\t\tx.poke(ur - tr, b, 0);\n\t\t\t\tx.poke(ui - ti, b, 1);\n\t\t\t}\n\t\t}\n\t}\n\tif (inv > 0.5) {\n\t\tsc = 1 / n;\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tx.poke(x.peek(i, 0) * sc, i, 0);\n\t\t\tx.poke(x.peek(i, 1) * sc, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// Periodic Hann table for n points. Rebuilt only when n changes.\nstft_win(win, n) {\n\tHistory wn(0);\n\tif (n != wn) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\twin.poke(0.5 - 0.5 * cos(6.283185307179586 * i / n), i);\n\t\t}\n\t\twn = n;\n\t}\n\treturn wn;\n}\n\n// Push one sample. Returns 1 when a hop (n / 4 samples) completed and a frame\n// is ready. Changing n clears the ring and restarts the hop counter.\n// st: 0 = write position (= oldest sample), 1 = hop counter, 2 = n seen here.\nstft_in(ring, st, x, n) {\n\tif (n != st.peek(2)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tring.poke(0, i);\n\t\t}\n\t\tst.poke(0, 0);\n\t\tst.poke(0, 1);\n\t\tst.poke(n, 2);\n\t}\n\twp = st.peek(0);\n\tring.poke(x, wp);\n\twp += 1;\n\tif (wp >= n) {\n\t\twp = 0;\n\t}\n\tcnt = st.peek(1) + 1;\n\trdy = 0;\n\tif (cnt >= n * 0.25) {\n\t\tcnt = 0;\n\t\trdy = 1;\n\t}\n\tst.poke(wp, 0);\n\tst.poke(cnt, 1);\n\treturn rdy;\n}\n\n// Copy the last n samples, oldest first, times the Hann window into fx (imag 0).\nstft_frame(fx, ring, st, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tfx.poke(ring.peek(j) * win.peek(i), i, 0);\n\t\tfx.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Weighted overlap-add: window the real part of fx and add it into acc at the\n// frame's start position. 2 / 3 = 1 / sum(Hann^2) at hop n / 4.\nstft_ola(acc, st, fx, win, n) {\n\twp = st.peek(0);\n\tfor (i = 0; i < n; i += 1) {\n\t\tj = wp + i;\n\t\tif (j >= n) {\n\t\t\tj -= n;\n\t\t}\n\t\tacc.poke(acc.peek(j) + fx.peek(i, 0) * win.peek(i) * 0.6666666666666666, j);\n\t}\n\treturn 0;\n}\n\n// One output sample: the oldest accumulator slot is finished, so read and clear\n// it. Call after the frame block, every sample. Clears acc when n changes.\n// st: 3 = n seen here.\nstft_out(acc, st, n) {\n\tif (n != st.peek(3)) {\n\t\tfor (i = 0; i < n; i += 1) {\n\t\t\tacc.poke(0, i);\n\t\t}\n\t\tst.poke(n, 3);\n\t}\n\twp = st.peek(0);\n\ty = acc.peek(wp);\n\tacc.poke(0, wp);\n\treturn y;\n}\n\n// Real cepstrum of the complex spectrum in fx: fc = IFFT(log(|X| + eps)).\n// fc channel 0 holds c[n] (real and even), channel 1 is about 0.\ncep_from_spec(fx, fc, tab, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tfc.poke(log(sqrt(xr * xr + xi * xi) + eps), i, 0);\n\t\tfc.poke(0, i, 1);\n\t}\n\tfft_run(fc, tab, n, 1);\n\treturn 0;\n}\n\n// Cepstrum (any cepstrum, in place) back to the log spectrum: forward FFT.\n// For an even cepstrum fc channel 0 becomes log|X|. For a folded (min or max\n// phase) cepstrum channel 0 is log|X| and channel 1 is the phase in radians.\ncep_to_logmag(fc, tab, n) {\n\tfft_run(fc, tab, n, 0);\n\treturn 0;\n}\n\n// Minimum-phase fold in place: c[0], 2 c[i] for 0 < i < n/2, c[n/2], else 0.\ncep_fold_minphase(fc, n) {\n\thalf = n * 0.5;\n\tfor (i = 1; i < half; i += 1) {\n\t\tfc.poke(fc.peek(i, 0) * 2, i, 0);\n\t}\n\tfor (i = half + 1; i < n; i += 1) {\n\t\tfc.poke(0, i, 0);\n\t}\n\tfor (i = 0; i < n; i += 1) {\n\t\tfc.poke(0, i, 1);\n\t}\n\treturn 0;\n}\n\n// Maximum-phase fold: the minimum-phase cepstrum mirrored in quefrency\n// (c_max[i] = c_min[n - i]). Same magnitude, opposite phase.\ncep_fold_maxphase(fc, n) {\n\thalf = n * 0.5;\n\tcep_fold_minphase(fc, n);\n\tfor (i = 1; i < half; i += 1) {\n\t\tt = fc.peek(i, 0);\n\t\tfc.poke(0, i, 0);\n\t\tfc.poke(t, n - i, 0);\n\t}\n\treturn 0;\n}\n\n// Complex exponential of the log spectrum in fc (re = log magnitude, im =\n// phase) into the spectrum fx, minus the eps added in cep_from_spec. After a\n// minimum-phase fold this is the minimum-phase spectrum with the original magnitude.\ncep_exp_spec(fc, fx, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tph = fc.peek(i, 1);\n\t\tfx.poke(m * cos(ph), i, 0);\n\t\tfx.poke(m * sin(ph), i, 1);\n\t}\n\treturn 0;\n}\n\n// Impose the magnitude exp(fc.re) - eps on the phase already in fx (keep the\n// original phase, change only the magnitude: Lifter EQ, crusher, and so on).\ncep_remag(fx, fc, n, eps) {\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tmag = sqrt(xr * xr + xi * xi);\n\t\tm = max(exp(fc.peek(i, 0)) - eps, 0);\n\t\tif (mag > 1e-20) {\n\t\t\tg = m / mag;\n\t\t\tfx.poke(xr * g, i, 0);\n\t\t\tfx.poke(xi * g, i, 1);\n\t\t} else {\n\t\t\tfx.poke(m, i, 0);\n\t\t\tfx.poke(0, i, 1);\n\t\t}\n\t}\n\treturn 0;\n}\n\n\n\n\n// ---------------------------------------------------------------------------\n// Skeleton of a device core (mono; stereo repeats the per-channel part with\n// ringR/accR/stR and reuses fx, fc, tab, win):\n//\n//   Param fftn(1024);\n//   Data tab(4096, 3);  Data win(4096);  Data fx(4096, 2);  Data fc(4096, 2);\n//   Data ring(4096);    Data acc(4096);  Data st(4);\n//   n = cep_n(fftn);\n//   fft_init(tab);\n//   stft_win(win, n);\n//   rdy = stft_in(ring, st, in1, n);\n//   if (rdy) {\n//       stft_frame(fx, ring, st, win, n);\n//       fft_run(fx, tab, n, 0);              // fx = X\n//       cep_from_spec(fx, fc, tab, n, 1e-9); // fc = real cepstrum\n//       cep_fold_minphase(fc, n);            // ...process the cepstrum...\n//       cep_to_logmag(fc, tab, n);           // fc = log|X| + j phase\n//       cep_exp_spec(fc, fx, n, 1e-9);       // fx = new spectrum\n//       fft_run(fx, tab, n, 1);              // back to time\n//       stft_ola(acc, st, fx, win, n);\n//   }\n//   out1 = stft_out(acc, st, n);             // delayed by n - 1 samples\n// ---------------------------------------------------------------------------\n\n// Lifter \u2014 an EQ for the quefrency axis (stereo).\n// scripts/build_lifter.py PREPENDS src/cepstrum_lib.genexpr to this file, so the\n// cep_* / fft_* / stft_* functions are already defined above everything here.\n//\n// Per hop (N / 4 samples), per channel:\n//   frame -> FFT -> real cepstrum c[q] -> pitch peak (lft_pitch) ->\n//   delta[q] = (gain[q] - 1) * c[q], smoothed over time ->\n//   FFT(delta) = change of log|X| (soft-limited) -> scale X by exp(change) ->\n//   one per-frame factor restores the frame energy (Whisper keeps its loudness) ->\n//   the original phase stays -> inverse FFT -> overlap-add.\n// Working on the DELTA (not on the whole cepstrum) keeps a flat curve an exact\n// identity at every Smooth setting: delta = 0, exp(0) = 1.\n//\n// gain[q] = 10^(curve_dB(x) * Depth / 20), x = log(q / (sr * 0.2 ms)) / log(200),\n// so the curve spans 0.2 ms .. 40 ms of quefrency whatever the sample rate or Size.\n// With Track on, q is scaled by (5 ms / detected pitch period) first, so the\n// pitch peak always lands on the 5 ms marker (x = 0.6074).\n//\n// Latency: the STFT lags N - 1 samples; a Delay pads every Size to a constant 4096\n// samples (patcher \"latency\": 4096). The dry path is delayed by the same 4096.\n//\n// Buffer lcurve(\"liftercurve\"), bound with `lcurve #0-liftercurve`:\n//   frames 0..255, ch 1 = curve in dB (-24..+24) on the log-quefrency axis, written by the v8ui.\n// Buffer lscope(\"lifterscope\"), bound with `lscope #0-lifterscope` (1 channel, 512 frames):\n//   0..127   |c| input cepstrum, max per display column (display axis = tracked axis)\n//   128..255 |c| after the lifter\n//   256..319 input spectrum (dB re a full-scale sine), 64 log columns 30 Hz..20 kHz, -999 = no bin\n//   320..383 output spectrum, same layout\n//   384 pitch period (samples, smoothed) 385 confidence 386 hop counter (not advanced when silent)\n//   387 input peak 388 output peak 389 samplerate 390 N 391 Track 392 silent flag 393 quefrency used as marker\n//\n// Maintenance invariants:\n// 1. Every function sits before every Param / Buffer / Data / History / Delay.\n// 2. Never name an identifier e + digits (GenExpr reads Euler's constant).\n// 3. Work functions are called as bare statements (an unused result is removed).\n\n// Linear interpolation of the 256-point dB table cvd at x in 0..1.\nlft_interp(cvd, x) {\n\tp = clip(x, 0, 1) * 255;\n\ti0 = floor(p);\n\ti1 = min(i0 + 1, 255);\n\tfr = p - i0;\n\treturn cvd.peek(i0) * (1 - fr) + cvd.peek(i1) * fr;\n}\n\n// Gain factor gtab[q] and display column gcol[q] (0..127) for q = 0..n/2.\nlft_build(cvd, gtab, gcol, n, sr, scl, depth) {\n\thalf = n * 0.5;\n\tbase = sr * 0.0002;\n\tfor (q = 0; q <= half; q += 1) {\n\t\tx = log(max(q, 0.5) * scl / base) * 0.18873916581775485;\n\t\tdb = lft_interp(cvd, x) * depth;\n\t\tgtab.poke(exp(db * 0.11512925464970229), q);\n\t\tgcol.poke(clip(floor(x * 128), 0, 127), q);\n\t}\n\treturn 0;\n}\n\n// Replace fc (the real cepstrum) by the smoothed delta cepstrum and keep the\n// telemetry maxima for the display (left channel only, wtm = 1).\nlft_apply(fc, gtab, gcol, smv, tele, n, a, wtm) {\n\thalf = n * 0.5;\n\tfc.poke(0, 0, 0);\n\tfc.poke(0, 0, 1);\n\tfor (q = 1; q <= half; q += 1) {\n\t\tc = fc.peek(q, 0);\n\t\tsd = a * smv.peek(q) + (1 - a) * (gtab.peek(q) - 1) * c;\n\t\tsmv.poke(sd, q);\n\t\tfc.poke(sd, q, 0);\n\t\tfc.poke(0, q, 1);\n\t\tif (q < half) {\n\t\t\tfc.poke(sd, n - q, 0);\n\t\t\tfc.poke(0, n - q, 1);\n\t\t}\n\t\tif (wtm > 0.5) {\n\t\t\tcol = gcol.peek(q);\n\t\t\ttele.poke(max(tele.peek(col), abs(c)), col);\n\t\t\ttele.poke(max(tele.peek(128 + col), abs(c + sd)), 128 + col);\n\t\t}\n\t}\n\treturn 0;\n}\n\n// fc.re now holds the change of log|X| per bin. Scale the spectrum by its soft-limited\n// exponential (phase untouched), then by one factor per frame that restores the frame's\n// energy, so Whisper does not get quieter and Robot does not explode (a flat curve\n// leaves every bin alone and the factor is exactly 1). Left channel also records the\n// input / output spectrum columns. fc channel 1 holds the per-bin change meanwhile.\nlft_remag(fx, fc, tele, n, lim, ndb, sr, wtm) {\n\thalf = n * 0.5;\n\tdfs = sr / n;\n\tein = 0;\n\teout = 0;\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tm2 = xr * xr + xi * xi;\n\t\tgd = lim * tanh(fc.peek(i, 0) / lim);\n\t\tfc.poke(gd, i, 1);\n\t\tein += m2;\n\t\teout += m2 * exp(2 * gd);\n\t}\n\tnf = 1;\n\tif (ein > 1e-18 && eout > 1e-30) {\n\t\tnf = clip(sqrt(ein / eout), 0.001, 1000);\n\t}\n\tnfd = log(nf);\n\tfor (i = 0; i < n; i += 1) {\n\t\txr = fx.peek(i, 0);\n\t\txi = fx.peek(i, 1);\n\t\tgd = fc.peek(i, 1) + nfd;\n\t\tif (wtm > 0.5 && i >= 1 && i <= half) {\n\t\t\tmg = sqrt(xr * xr + xi * xi);\n\t\t\tldb = log(mg + 1e-9) * 8.685889638065035 - ndb;\n\t\t\tsc = floor(log(i * dfs / 30) * 9.842721836);\n\t\t\tif (sc >= 0 && sc < 64) {\n\t\t\t\ttele.poke(max(tele.peek(256 + sc), ldb), 256 + sc);\n\t\t\t\ttele.poke(max(tele.peek(320 + sc), ldb + gd * 8.685889638065035), 320 + sc);\n\t\t\t}\n\t\t}\n\t\tg = exp(gd);\n\t\tfx.poke(xr * g, i, 0);\n\t\tfx.poke(xi * g, i, 1);\n\t}\n\treturn 0;\n}\n\n// Cepstral pitch peak of the real cepstrum in fc: refined period in samples and a\n// 0..1 confidence (z-score of the peak, like cep_peak_conf), 2..20 ms search range.\n// Same maths as cep_peak / cep_peak_conf / cep_peak_refine plus an octave check, written\n// out here with its own names: the library calls fail to compile (undeclared loop\n// variable) when two inlined copies sit in one function that is itself used twice.\n// pst[pb] = period, pst[pb + 1] = confidence.\nlft_pitch(fc, pst, pb, n, sr) {\n\tplo = floor(sr * 0.002);\n\tphi = min(floor(sr * 0.02), n * 0.5 - 2);\n\tpcf = 0;\n\tpqf = 0;\n\tif (phi - plo > 8) {\n\t\tpbest = -1e30;\n\t\tpq = plo;\n\t\tpsum = 0;\n\t\tpsq = 0;\n\t\tfor (pj = plo; pj <= phi; pj += 1) {\n\t\t\tpval = fc.peek(pj, 0);\n\t\t\tpsum += pval;\n\t\t\tpsq += pval * pval;\n\t\t\tif (pval > pbest) {\n\t\t\t\tpbest = pval;\n\t\t\t\tpq = pj;\n\t\t\t}\n\t\t}\n\t\tpcnt = phi - plo + 1;\n\t\tpmu = psum / pcnt;\n\t\tpsd = sqrt(max(psq / pcnt - pmu * pmu, 1e-20));\n\t\tpcf = clip(((pbest - pmu) / psd - 3) / 7, 0, 1);\n\t\t// Octave check: a harmonic spectrum often has an equal or larger peak at twice\n\t\t// the period (and a period between two samples splits its peak over two bins).\n\t\t// Compare the 3-bin mass of the peak near half the period with the main one.\n\t\tphalf = floor(pq * 0.5);\n\t\tpbq = phalf;\n\t\tpbm = -1e30;\n\t\tfor (pk = phalf - 2; pk <= phalf + 2; pk += 1) {\n\t\t\tpmass = fc.peek(pk - 1, 0) + fc.peek(pk, 0) + fc.peek(pk + 1, 0);\n\t\t\tif (pk >= plo && pmass > pbm) {\n\t\t\t\tpbm = pmass;\n\t\t\t\tpbq = pk;\n\t\t\t}\n\t\t}\n\t\tpmain = fc.peek(pq - 1, 0) + fc.peek(pq, 0) + fc.peek(pq + 1, 0);\n\t\tif (phalf >= plo && pbm > 0 && pbm > 0.5 * pmain) {\n\t\t\tpq = pbq;\n\t\t}\n\t\tpya = fc.peek(pq - 1, 0);\n\t\tpyb = fc.peek(pq, 0);\n\t\tpyc = fc.peek(pq + 1, 0);\n\t\tpden = pya - 2 * pyb + pyc;\n\t\tpqf = pq + ((abs(pden) > 1e-20) ? clip(0.5 * (pya - pyc) / pden, -0.5, 0.5) : 0);\n\t}\n\tpst.poke(pqf, pb);\n\tpst.poke(pcf, pb + 1);\n\treturn 0;\n}\n\n// Everything between the forward and the inverse FFT of one channel's frame.\nlft_proc(fx, fc, tab, smv, gtab, gcol, tele, pst, n, a, wtm, pb, sr, lim, ndb) {\n\tcep_from_spec(fx, fc, tab, n, 1e-9);\n\tlft_pitch(fc, pst, pb, n, sr);\n\tlft_apply(fc, gtab, gcol, smv, tele, n, a, wtm);\n\tcep_to_logmag(fc, tab, n);\n\tlft_remag(fx, fc, tele, n, lim, ndb, sr, wtm);\n\treturn 0;\n}\n\n// Per hop: copy the curve buffer into cvd and reset the telemetry maxima.\n// (No for loop may sit in the main body: it breaks fft_init's compile in Max 9.)\nlft_prep(cbuf, cvd, tele, n) {\n\tnc = min(256, n);\n\tnt = min(384, n);\n\tfor (zi = 0; zi < nc; zi += 1) {\n\t\tcvd.poke(peek(cbuf, zi, 0), zi);\n\t\ttele.poke(0, zi);\n\t}\n\tfor (zi = nc; zi < nt; zi += 1) {\n\t\ttele.poke(-999, zi);\n\t}\n\treturn 0;\n}\n\n// Write the telemetry traces (frames 0..383) to the scope buffer.\nlft_write(sbuf, tele, n) {\n\tnt = min(384, n);\n\tfor (zi = 0; zi < nt; zi += 1) {\n\t\tpoke(sbuf, tele.peek(zi), zi, 0);\n\t}\n\treturn 0;\n}\n\nParam sizei(1);\nParam depthp(100);\nParam smoothp(20);\nParam wetp(100);\nParam outdb(0);\nParam trackp(0);\n\nBuffer lcurve(\"liftercurve\");\nBuffer lscope(\"lifterscope\");\n\nData tab(4096, 3);\nData win(4096);\nData fx(4096, 2);\nData fc(4096, 2);\nData ringL(4096);\nData accL(4096);\nData stL(8);\nData smL(4096);\nData ringR(4096);\nData accR(4096);\nData stR(8);\nData smR(4096);\nData gtab(2049);\nData gcol(2049);\nData cvd(256);\nData tele(512);\nData pst(8);\nDelay padL(4096);\nDelay padR(4096);\nDelay dryL(4200);\nDelay dryR(4200);\nHistory qc(0);\nHistory pki(0);\nHistory pko(0);\nHistory hopc(0);\nHistory nprev(0);\nHistory swc(0);\nHistory lwL(0);\nHistory lwR(0);\nHistory efL(0);\nHistory efR(0);\n\nsr = samplerate;\nn = pow(2, 9 + clip(round(sizei), 0, 3));\nfft_init(tab);\nstft_win(win, n);\n\nxin = max(abs(in1), abs(in2));\nqc = (xin < 0.000001) ? min(qc + 1, 100000000) : 0;\npki = max(pki, xin);\n\n// A new Size invalidates the stored (smoothed) cepstral delta: stL[5] = 1 makes the next\n// processed hop skip the smoothing (it then overwrites every slot it will use). No clear\n// loop: in Max 9.1 a loop that pokes a constant into smL / smR fails to compile at random\n// (\"undeclared identifier 'v_40'\").\nif (n != stL.peek(4)) {\n\tstL.poke(1, 5);\n\tstL.poke(n, 4);\n\tstR.poke(n, 4);\n}\n\nrdyL = stft_in(ringL, stL, in1, n);\nrdyR = stft_in(ringR, stR, in2, n);\n\nif (rdyL * rdyR > 0.5) {\n\tif (qc >= n) {\n\t\t// The whole frame is silent: skip all FFT work, output stays exactly 0.\n\t\tstL.poke(1, 5);\n\t\tpoke(lscope, 1, 392, 0);\n\t\tpoke(lscope, 0, 387, 0);\n\t\tpoke(lscope, 0, 388, 0);\n\t\tpoke(lscope, sr, 389, 0);\n\t\tpoke(lscope, n, 390, 0);\n\t\tpoke(lscope, trackp, 391, 0);\n\t} else {\n\t\tsm01 = clip(smoothp * 0.01, 0, 1);\n\t\ta = (sm01 < 0.001) ? 0 : exp(-(n * 0.25 / sr) / (0.4 * sm01));\n\t\tif (stL.peek(5) > 0.5) {\n\t\t\ta = 0;\n\t\t}\n\t\tstL.poke(0, 5);\n\t\tdepth = clip(depthp * 0.01, -1, 1);\n\t\tqref = sr * 0.005;\n\t\tqp = pst.peek(6);\n\t\tif (qp < 1) {\n\t\t\tqp = qref;\n\t\t\tpst.poke(qp, 6);\n\t\t}\n\t\tqpuse = (trackp > 0.5) ? qp : qref;\n\t\tscl = qref / qpuse;\n\t\tndb = 8.685889638065035 * log(n * 0.25);\n\n\t\tlft_prep(lcurve, cvd, tele, n);\n\t\tlft_build(cvd, gtab, gcol, n, sr, scl, depth);\n\n\t\tstft_frame(fx, ringL, stL, win, n);\n\t\tfft_run(fx, tab, n, 0);\n\t\tlft_proc(fx, fc, tab, smL, gtab, gcol, tele, pst, n, a, 1, 0, sr, 4.6, ndb);\n\t\tfft_run(fx, tab, n, 1);\n\t\tstft_ola(accL, stL, fx, win, n);\n\n\t\tstft_frame(fx, ringR, stR, win, n);\n\t\tfft_run(fx, tab, n, 0);\n\t\tlft_proc(fx, fc, tab, smR, gtab, gcol, tele, pst, n, a, 0, 3, sr, 4.6, ndb);\n\t\tfft_run(fx, tab, n, 1);\n\t\tstft_ola(accR, stR, fx, win, n);\n\n\t\t// Pitch for Track: the more confident channel, smoothed, held when unsure.\n\t\tcl = pst.peek(1);\n\t\tcr = pst.peek(4);\n\t\tqb = (cr > cl) ? pst.peek(3) : pst.peek(0);\n\t\tcb = max(cl, cr);\n\t\tif (cb > 0.25 && qb > 1) {\n\t\t\tqp = qp * 0.65 + qb * 0.35;\n\t\t\tpst.poke(qp, 6);\n\t\t}\n\n\t\tlft_write(lscope, tele, n);\n\t\thopc = hopc + 1;\n\t\tpoke(lscope, qp, 384, 0);\n\t\tpoke(lscope, cb, 385, 0);\n\t\tpoke(lscope, hopc, 386, 0);\n\t\tpoke(lscope, pki, 387, 0);\n\t\tpoke(lscope, pko, 388, 0);\n\t\tpoke(lscope, sr, 389, 0);\n\t\tpoke(lscope, n, 390, 0);\n\t\tpoke(lscope, trackp, 391, 0);\n\t\tpoke(lscope, 0, 392, 0);\n\t\tpoke(lscope, qpuse, 393, 0);\n\t}\n\tpki = 0;\n\tpko = 0;\n}\n\nyl = stft_out(accL, stL, n);\nyr = stft_out(accR, stR, n);\npadL.write(yl);\npadR.write(yr);\nwl = padL.read(4096 - (n - 1));\nwr = padR.read(4096 - (n - 1));\ndryL.write(in1);\ndryR.write(in2);\ndl = dryL.read(4096);\ndr = dryR.read(4096);\n\n// Size change: the STFT restarts (silent for N - 1 samples) and the pad delay\n// reads from a new offset, so the wet path is garbage for 4096 samples. Hold the\n// last wet sample and fade it to the dry signal over 128 samples, play dry, then\n// fade the new wet in over 512 samples. Every step is continuous.\nswc = (n != nprev) ? 0 : min(swc + 1, 100000);\nnprev = n;\nif (swc == 0) {\n\tlwL = efL;\n\tlwR = efR;\n}\nff = clip(1 - swc / 128, 0, 1);\ngg = clip((swc - 4096) / 512, 0, 1);\neffL = dl + (lwL - dl) * ff + (wl - dl) * gg;\neffR = dr + (lwR - dr) * ff + (wr - dr) * gg;\nefL = effL;\nefR = effR;\n\nmxv = clip(wetp * 0.01, 0, 1);\nog = exp(outdb * 0.11512925464970229);\nout1 = (dl + (effL - dl) * mxv) * og;\nout2 = (dr + (effR - dr) * mxv) * og;\npko = max(pko, max(abs(out1), abs(out2)));\n",
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
					"text": "record~ rec 3"
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
						360.0,
						20.0
					],
					"text": "js /Users/mrwilson/software/ableton/tests/lifter_probe.js /tmp/lifter_audio.txt 16384"
				}
			},
			{
				"box": {
					"id": "obj-ph",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						40.0,
						80.0,
						20.0
					],
					"text": "phasor~ 200"
				}
			},
			{
				"box": {
					"id": "obj-off",
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
					"text": "-~ 0.5"
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
						100.0,
						50.0,
						20.0
					],
					"text": "*~ 0.5"
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
						"obj-load",
						0
					],
					"destination": [
						"obj-bind-curve",
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
						"obj-bind-scope",
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
						"obj-curve",
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
						"obj-del-arm",
						0
					],
					"destination": [
						"obj-del-snap",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-del-snap",
						0
					],
					"destination": [
						"obj-snap",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-snap",
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
						"obj-bind-curve",
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
						"obj-bind-scope",
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
						"obj-curve",
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
						"obj-mute",
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
						"obj-ph",
						0
					],
					"destination": [
						"obj-off",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-off",
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
						"obj-ng",
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
