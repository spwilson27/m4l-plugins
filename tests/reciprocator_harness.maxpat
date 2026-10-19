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
					"text": "delay 300"
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
					"text": "analyze 300"
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
					"text": "amount 0.0, gate -48, attack 1.5, release 40, wet 0.5, ceiling 0, lookahead 10.0, detect 0.25, schp 40, sclp 16000, outmode 1, revgate 0"
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
					"text": "setbuffer #0-recipscope"
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
					"text": "scope #0-recipscope"
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
					"text": "buffer~ #0-recipscope @samps 32"
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
					"text": "buffer~ rec 4000 2"
				}
			},
			{
				"box": {
					"code": "// Reciprocator \u2014 Reciprocal envelope follower & audio-rate dynamics/waveshaper.\n// Multiplies the lookahead-delayed input by env^(-amount) * gate so quiet tails\n// and textures jump to full ceiling while silence below Gate is cleanly muted\n// (or, when Reverse Gate `revgate` is enabled, only quiet signals below Gate\n// pass through while loud hits are muted).\n//\n// Scope telemetry buffer (buffer~ #0-recipscope, bound via `scope #0-recipscope`):\n//   0: input peak (0..1)\n//   1: post-detector envelope (0..1)\n//   2: gate open state (0..1)\n//   3: applied gain normalized (0..1 where 0.25 = 0 dB, 1.0 = +60 dB)\n//   4: wet output peak (0..1)\n//   5: current gate threshold linear (0..1)\n//   6: current ceiling linear (0..1)\n//   7: rolling frame counter\n//\n// GenExpr requires all functions before Buffer/Param/History/Delay declarations,\n// and all declarations before expression statements. No variable is named e<digit>.\n\nslew(target, coef) {\n\tHistory s(0);\n\tHistory init(0);\n\ts = (init == 0) ? target : mix(target, s, coef);\n\tinit = 1;\n\treturn s;\n}\n\nonepole_lp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn s;\n}\n\nonepole_hp(x, coef) {\n\tHistory s(0);\n\ts = mix(x, s, coef);\n\treturn x - s;\n}\n\n// Combined Peak + RMS detector with independent attack and release coefficients.\nenv_detect(x, atkCoef, relCoef, detectBlend) {\n\tHistory pk(0);\n\tHistory ms(0);\n\tax = abs(x);\n\tcPk = (ax > pk) ? atkCoef : relCoef;\n\tpk = mix(ax, pk, cPk);\n\tx2 = x * x;\n\tcMs = (x2 > ms) ? atkCoef : relCoef;\n\tms = mix(x2, ms, cMs);\n\trms = sqrt(max(ms, 0));\n\treturn mix(pk, rms, clip(detectBlend, 0, 1));\n}\n\n// Smooth normal or reverse gate with a 6 dB cubic knee around gateLin.\n// When revMode > 0.5, signals BELOW gateLin open the gate and signals ABOVE\n// gateLin close it (while sub-floor silence < 0.00005 is muted so an idle track stays silent).\ngate_smooth(envVal, gateLin, relCoef, revMode) {\n\tHistory gState(0);\n\tg = max(gateLin, 0.00001);\n\tlo = g * 0.5;\n\thi = g * 1.41421356;\n\tt = clip((envVal - lo) / max(hi - lo, 0.00001), 0, 1);\n\tnormalRaw = t * t * (3 - 2 * t);\n\n\t// Floor guard for Reverse Gate so pure digital silence does not get boosted to 0 dBFS.\n\tsLo = 0.00002;\n\tsHi = max(min(lo * 0.5, 0.00025), 0.00005);\n\ttf = clip((envVal - sLo) / max(sHi - sLo, 0.00001), 0, 1);\n\tfloorGuard = tf * tf * (3 - 2 * tf);\n\n\trevRaw = (1.0 - normalRaw) * floorGuard;\n\traw = (revMode > 0.5) ? revRaw : normalRaw;\n\n\tc = (raw > gState) ? 0.25 : clip(relCoef, 0.5, 0.9995);\n\tgState = mix(raw, gState, c);\n\treturn gState;\n}\n\n// Output stage (`outmode`):\n//   0 = Soft (`tanh` soft saturation to ceilLin)\n//   1 = Hard (`clip` to [-ceilLin, +ceilLin])\n//   2 = Lim  (Instant-attack, smooth-release peak limiter to ceilLin, preserving waveform shape)\nlimit_out(x, ceilLin, outMode) {\n\tHistory limEnv(0);\n\tc = max(ceilLin, 0.05);\n\tax = abs(x);\n\t// Always update limiter envelope history so switching modes never clicks.\n\tlimEnv = (ax > limEnv) ? ax : mix(ax, limEnv, 0.9985);\n\tlimGain = c / max(limEnv, c);\n\tlimited = clip(x * limGain, -c, c);\n\tsoft = c * tanh(x / c);\n\thard = clip(x, -c, c);\n\treturn (outMode < 0.5) ? soft : ((outMode < 1.5) ? hard : limited);\n}\n\nBuffer scope(\"recipscope\");\n\nParam amount(1.0);\nParam gate(-42.0);\nParam attack(1.5);\nParam release(60.0);\nParam wet(1.0);\nParam ceiling(-1.0);\nParam lookahead(1.5);\nParam detect(0.25);\nParam schp(60.0);\nParam sclp(12000.0);\nParam outmode(0.0);\nParam revgate(0.0);\n\nHistory tick(0);\nHistory rollCounter(0);\nHistory peakInHold(0);\nHistory peakEnvHold(0);\nHistory peakOutHold(0);\n\nDelay lookL(1024);\nDelay lookR(1024);\n\nsr = max(samplerate, 1);\n\namountS = slew(clip(amount, 0, 1.5), 0.999);\ngateDbS = slew(clip(gate, -72, -6), 0.999);\natkMsS = slew(clip(attack, 0.05, 250), 0.999);\nrelMsS = slew(clip(release, 0.5, 1500), 0.999);\nwetS = slew(clip(wet, 0, 1), 0.999);\nceilDbS = slew(clip(ceiling, -18, 0), 0.999);\nlookMsS = slew(clip(lookahead, 0, 10), 0.999);\ndetectS = slew(clip(detect, 0, 1), 0.999);\nhpHzS = slew(clip(schp, 20, 2000), 0.999);\nlpHzS = slew(clip(sclp, 400, 18000), 0.999);\noutMode = clip(outmode, 0, 2);\nrevMode = clip(revgate, 0, 1);\n\n// 1. Write raw stereo input into lookahead delay lines (used for both wet VCA and phase-aligned dry).\nlookSamps = clip(lookMsS * sr / 1000, 0, 960);\nlookL.write(in1);\nlookR.write(in2);\ndelInL = lookL.read(lookSamps, interp=\"linear\");\ndelInR = lookR.read(lookSamps, interp=\"linear\");\n\n// 2. Sidechain filter conditioning on the undelayed input so detection leads the delayed audio.\nhpCoef = exp(-6.28318530718 * hpHzS / sr);\nlpCoef = exp(-6.28318530718 * lpHzS / sr);\nscL = onepole_lp(onepole_hp(in1, hpCoef), lpCoef);\nscR = onepole_lp(onepole_hp(in2, hpCoef), lpCoef);\n\n// 3. Envelope detection with sub-millisecond to 1.5 s ballistics.\natkCoef = exp(-1000 / ( max(atkMsS, 0.05) * sr ));\nrelCoef = exp(-1000 / ( max(relMsS, 0.5) * sr ));\ndetL = env_detect(scL, atkCoef, relCoef, detectS);\ndetR = env_detect(scR, atkCoef, relCoef, detectS);\n\n// Stereo link: detect knob also blends from tight dual-mono peak (0%) toward linked RMS (100%).\nlinkedEnv = max(detL, detR);\nlinkAmt = 0.35 + 0.65 * detectS;\nenvL = mix(detL, linkedEnv, linkAmt);\nenvR = mix(detR, linkedEnv, linkAmt);\nenvMax = max(envL, envR);\n\n// 4. Gate & Reciprocal gain calculation.\ngateLin = pow(10, gateDbS / 20);\nceilLin = pow(10, ceilDbS / 20);\n\ngateL = gate_smooth(envL, gateLin, relCoef, revMode);\ngateR = gate_smooth(envR, gateLin, relCoef, revMode);\n\nfloorEnv = (revMode > 0.5) ? 0.00005 : max(gateLin * 0.5, 0.00001);\nsafeL = max(envL, floorEnv);\nsafeR = max(envR, floorEnv);\n\n// Scale target so that at amount = 1.0, x / env lands at ceilLin, and at\n// amount > 1.0 loud peaks are ducked down while quiet details rise to ceilLin.\noverAmt = max(amountS - 1.0, 0.0);\ntargetScale = pow(ceilLin, min(amountS, 1.0)) * pow(0.05, overAmt);\nrawGainL = min(pow(safeL, -amountS) * targetScale, 1000.0);\nrawGainR = min(pow(safeR, -amountS) * targetScale, 1000.0);\n\n// Blend between unity (1.0) at amount = 0 (unless revMode > 0.5, which always gates) and reciprocal gain.\ngateMix = (revMode > 0.5) ? 1.0 : clip(amountS * 4.0, 0, 1);\neffGateL = mix(1.0, gateL, gateMix);\neffGateR = mix(1.0, gateR, gateMix);\n\ngainL = rawGainL * effGateL;\ngainR = rawGainR * effGateR;\n\n// 5. Multiply lookahead-delayed signal by reciprocal gain and apply Soft / Hard / Limiter ceiling.\nvcaL = delInL * gainL;\nvcaR = delInR * gainR;\nwetL = limit_out(vcaL, ceilLin, outMode);\nwetR = limit_out(vcaR, ceilLin, outMode);\n\n// 6. Equal-power dry/wet mix (using lookahead-aligned dry signal so parallel blend never comb-filters).\nang = wetS * 1.57079632679;\ndryG = cos(ang);\nwetG = sin(ang);\noutL = delInL * dryG + wetL * wetG;\noutR = delInR * dryG + wetR * wetG;\n\n// 7. Update scope telemetry buffer every 64 samples with peak-held values over the window.\ninAbs = max(abs(delInL), abs(delInR));\noutAbs = max(abs(wetL), abs(wetR));\npeakInHold = max(peakInHold, inAbs);\npeakEnvHold = max(peakEnvHold, envMax);\npeakOutHold = max(peakOutHold, outAbs);\n\ntick = wrap(tick + 1, 0, 64);\nif (tick == 0) {\n\tgainAvg = 0.5 * (gainL + gainR);\n\tgainDbNorm = clip((20 * log10(max(gainAvg, 0.001)) + 20) / 80, 0, 1);\n\trollCounter = wrap(rollCounter + 1, 0, 100000);\n\tpoke(scope, clip(peakInHold, 0, 1.5), 0, 0);\n\tpoke(scope, clip(peakEnvHold, 0, 1.5), 1, 0);\n\tpoke(scope, clip(max(gateL, gateR), 0, 1), 2, 0);\n\tpoke(scope, gainDbNorm, 3, 0);\n\tpoke(scope, clip(peakOutHold, 0, 1.5), 4, 0);\n\tpoke(scope, clip(gateLin, 0, 1), 5, 0);\n\tpoke(scope, clip(ceilLin, 0, 1), 6, 0);\n\tpoke(scope, rollCounter, 7, 0);\n\tpeakInHold = 0;\n\tpeakEnvHold = 0;\n\tpeakOutHold = 0;\n}\n\nout1 = fixnan(outL);\nout2 = fixnan(outR);\n",
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
					"text": "js /Users/mrwilson/software/ableton/tests/reciprocator_probe.js impulse"
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
					"text": "*~ 0.5"
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
