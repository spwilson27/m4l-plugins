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
					"text": "delay 250"
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
					"text": "delay 1000"
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
					"text": "analyze 1000"
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
					"text": "thr -24, sens 0.5, holdms 60, velmin 40, velmax 127"
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
						190.0,
						20.0
					],
					"text": "setbuffer #0-trigscope"
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
						180.0,
						20.0
					],
					"text": "scope #0-trigscope"
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
						210.0,
						20.0
					],
					"text": "buffer~ #0-trigscope @samps 800"
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
						130.0,
						150.0,
						20.0
					],
					"text": "buffer~ rec 4000 2"
				}
			},
			{
				"box": {
					"code": "// Envelope Trigger \u2014 transient detector that fires MIDI notes from an audio track.\n// Audio passes through untouched (out1/out2). Detection runs on the mono sum:\n//   fast env  \u2014 instant attack, 15 ms release peak follower\n//   slow env  \u2014 60 ms one-pole baseline that lags behind the fast env on transients\n//   onset     \u2014 fast > threshold AND fast > slow * ratio, where ratio = (1 - sens) * 12 dB,\n//               only while armed and outside the `holdms` lockout\n//   capture   \u2014 2.5 ms window after the onset that records the peak for velocity\n//   fire      \u2014 gate high for holdms/2 (>= 10 ms so edge~ sees it at any vector size),\n//               velocity = velmin..velmax from the captured peak (threshold .. 0 dBFS)\n//   re-arm    \u2014 once the fast env falls below 70% of threshold or back near the baseline\n//\n// Outlets: out1/out2 audio thru, out3 gate (0/1), out4 velocity (1..127, held).\n//\n// Scope telemetry buffer (buffer~ #0-trigscope @samps 800, bound via `scope #0-trigscope`):\n//   every 64 samples:\n//     0: fast env peak   1: slow env   2: fire counter   3: rolling frame counter\n//     4: input peak      5: last fired velocity (1..127)\n//   oscilloscope ring, one block per 32 samples (256 blocks \u2248 186 ms at 44.1 kHz):\n//     6: next block index (write head, 0..255)\n//     32 + 3 * block + 0/1/2: mono min, mono max, onset-in-block flag\n//\n// GenExpr requires all Buffer/Param/History declarations before expression statements.\n// No variable is named e<digit>. Never name a Param `hold`: the lockout and gate\n// outputs silently stop working.\n\nBuffer scope(\"trigscope\");\n\nParam thr(-24.0);\nParam sens(0.5);\nParam holdms(60.0);\nParam velmin(40.0);\nParam velmax(127.0);\n\nHistory fast(0);\nHistory slow(0);\nHistory armed(1);\nHistory lock(0);\nHistory cap(0);\nHistory capPeak(0);\nHistory gateLeft(0);\nHistory vel(0);\nHistory fires(0);\nHistory tick(0);\nHistory rollCounter(0);\nHistory pkIn(0);\nHistory pkFast(0);\nHistory idleTicks(0);\nHistory blkCount(0);\nHistory blkMin(0);\nHistory blkMax(0);\nHistory blkFire(0);\nHistory head(0);\n\nsr = max(samplerate, 1);\n\nratio = pow(10, (1 - clip(sens, 0, 1)) * 12 / 20);\nholdSamps = floor(clip(holdms, 20, 1000) * sr / 1000);\ncapSamps = max(floor(2.5 * sr / 1000), 1);\nvelLo = clip(velmin, 1, 127);\nvelHi = clip(max(velmax, velLo), 1, 127);\nthrDb = clip(thr, -60, 0);\nthrLin = pow(10, thrDb / 20);\nrelC = exp(-1000 / (15 * sr));\nslowC = exp(-1000 / (60 * sr));\n\n// 1. Envelopes on the mono sum.\nmono = 0.5 * (in1 + in2);\nax = abs(mono);\nnf = (ax > fast) ? ax : fast * relC;\nfast = (nf < 1e-12) ? 0 : nf;\nns = mix(fast, slow, slowC);\nslow = (ns < 1e-12) ? 0 : ns;\n\nlock = max(lock - 1, 0);\ngateLeft = max(gateLeft - 1, 0);\n\n// 2. Onset -> capture -> fire -> re-arm.\nonsetNow = 0;\nif (cap > 0) {\n\tcapPeak = max(capPeak, fast);\n\tcap = cap - 1;\n\tif (cap <= 0) {\n\t\tpkDb = 20 * log10(max(capPeak, 0.000001));\n\t\tt = clip((pkDb - thrDb) / max(-thrDb, 1), 0, 1);\n\t\tvel = clip(floor(velLo + t * (velHi - velLo) + 0.5), 1, 127);\n\t\tgateLeft = max(floor(holdSamps * 0.5), 1);\n\t\tlock = holdSamps;\n\t\tfires = wrap(fires + 1, 0, 100000);\n\t}\n} else if (armed > 0.5 && lock <= 0 && fast > thrLin && fast > slow * ratio) {\n\tcap = capSamps;\n\tcapPeak = fast;\n\tarmed = 0;\n\tonsetNow = 1;\n} else if (armed < 0.5 && (fast < thrLin * 0.7 || fast < slow * 1.12)) {\n\tarmed = 1;\n}\n\ngateOut = (gateLeft > 0) ? 1 : 0;\n\n// 3. Oscilloscope ring: min / max / onset flag per 32-sample block (onset, not the end of the\n//    velocity capture, so the tick lines up with the attack; every onset fires a note).\nblkMin = (blkCount == 0) ? mono : min(blkMin, mono);\nblkMax = (blkCount == 0) ? mono : max(blkMax, mono);\nblkFire = (blkCount == 0) ? onsetNow : max(blkFire, onsetNow);\nblkCount = blkCount + 1;\nif (blkCount >= 32) {\n\tblkCount = 0;\n\tif (idleTicks <= 4) {\n\t\tbase = 32 + head * 3;\n\t\tpoke(scope, clip(blkMin, -1.5, 1.5), base, 0);\n\t\tpoke(scope, clip(blkMax, -1.5, 1.5), base + 1, 0);\n\t\tpoke(scope, blkFire, base + 2, 0);\n\t\thead = wrap(head + 1, 0, 256);\n\t\tpoke(scope, head, 6, 0);\n\t}\n}\n\n// 4. Envelope telemetry every 64 samples, skipping buffer pokes once the device has settled in silence.\npkIn = max(pkIn, max(abs(in1), abs(in2)));\npkFast = max(pkFast, fast);\n\ntick = wrap(tick + 1, 0, 64);\nif (tick == 0) {\n\twindowSilent = (pkIn < 1e-6 && pkFast < 1e-6);\n\tidleTicks = windowSilent ? min(idleTicks + 1, 1000) : 0;\n\tif (idleTicks <= 4) {\n\t\trollCounter = wrap(rollCounter + 1, 0, 100000);\n\t\tpoke(scope, clip(pkFast, 0, 1.5), 0, 0);\n\t\tpoke(scope, clip(slow, 0, 1.5), 1, 0);\n\t\tpoke(scope, fires, 2, 0);\n\t\tpoke(scope, rollCounter, 3, 0);\n\t\tpoke(scope, clip(pkIn, 0, 1.5), 4, 0);\n\t\tpoke(scope, vel, 5, 0);\n\t}\n\tpkIn = 0;\n\tpkFast = 0;\n}\n\nout1 = fixnan(in1);\nout2 = fixnan(in2);\nout3 = gateOut;\nout4 = vel;\n",
					"fontname": "<Monospaced>",
					"fontsize": 10.0,
					"id": "obj-gen",
					"maxclass": "gen.codebox~",
					"numinlets": 2,
					"numoutlets": 4,
					"outlettype": [
						"signal",
						"signal",
						"signal",
						"signal"
					],
					"patching_rect": [
						200.0,
						220.0,
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
						360.0,
						90.0,
						20.0
					],
					"text": "record~ rec 2"
				}
			},
			{
				"box": {
					"id": "obj-gv0",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						200.0,
						300.0,
						40.0,
						20.0
					],
					"text": "*~"
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
						400.0,
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
						290.0,
						400.0,
						70.0,
						20.0
					],
					"text": "peakamp~"
				}
			},
			{
				"box": {
					"id": "obj-dspstate",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 4,
					"outlettype": [
						"int",
						"float",
						"int",
						"int"
					],
					"patching_rect": [
						640.0,
						40.0,
						70.0,
						20.0
					],
					"text": "dspstate~"
				}
			},
			{
				"box": {
					"id": "obj-prep-sr",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						640.0,
						70.0,
						90.0,
						20.0
					],
					"text": "prepend dspsr"
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
						400.0,
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
						440.0,
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
						480.0,
						420.0,
						20.0
					],
					"text": "js /Users/mrwilson/software/ableton/tests/envtrig_probe.js hits"
				}
			},
			{
				"box": {
					"code": "\nburst_env(dt, atk, decay) {\n\trise = (atk > 0.001) ? clip(dt / atk, 0, 1) : 1;\n\tfall = exp(-max(dt - atk, 0) * 6.9078 / max(decay, 1));\n\treturn (dt < 0) ? 0 : rise * fall;\n}\n\nParam go(0);\nParam kind(0);\nParam amp(0.8);\nParam freq(1000);\nParam first(40);\nParam every(200);\nParam atk(0);\nParam decay(80);\n\nHistory n(0);\nHistory ph(0);\n\nn = (go > 0.5) ? n + 1 : 0;\ntms = n * 1000 / samplerate;\nph = wrap(ph + freq / samplerate, 0, 1);\ntone = sin(6.28318531 * ph);\nlocal = tms - first;\ndtTrain = local - floor(max(local, 0) / max(every, 1)) * max(every, 1);\ntrain = burst_env((local < 0) ? -1 : dtTrain, atk, decay);\nsus = clip(local / 2, 0, 1);\nsig = (kind < 0.5) ? tone * train : tone * sus;\nout1 = (go > 0.5) ? sig * amp : 0;\n",
					"fontname": "<Monospaced>",
					"fontsize": 10.0,
					"id": "obj-src",
					"maxclass": "gen.codebox~",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						700.0,
						220.0,
						300.0,
						80.0
					]
				}
			},
			{
				"box": {
					"id": "obj-src-params",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						700.0,
						160.0,
						380.0,
						20.0
					],
					"text": "kind 0, amp 0.8, freq 1000, first 40, every 200, atk 0, decay 80"
				}
			},
			{
				"box": {
					"id": "obj-src-go",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						700.0,
						190.0,
						40.0,
						20.0
					],
					"text": "go 1"
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
						2
					],
					"destination": [
						"obj-gv0",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-gen",
						3
					],
					"destination": [
						"obj-gv0",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-gv0",
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
						"obj-dspstate",
						1
					],
					"destination": [
						"obj-prep-sr",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-sr",
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
						"obj-load",
						0
					],
					"destination": [
						"obj-src-params",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-src-params",
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
						"obj-del-arm",
						0
					],
					"destination": [
						"obj-src-go",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-src-go",
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
						"obj-src",
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
