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
			60.0,
			80.0,
			900.0,
			780.0
		],
		"bglocked": 0,
		"openinpresentation": 0,
		"default_fontsize": 10.0,
		"default_fontface": 0,
		"default_fontname": "Arial Bold",
		"gridonopen": 1,
		"gridsize": [
			15.0,
			15.0
		],
		"gridsnaponopen": 1,
		"objectsnaponopen": 1,
		"statusbarvisible": 2,
		"toolbarvisible": 1,
		"lefttoolbarpinned": 0,
		"toptoolbarpinned": 0,
		"righttoolbarpinned": 0,
		"bottomtoolbarpinned": 0,
		"toolbars_unpinned_last_save": 0,
		"tallnewobj": 0,
		"boxanimatetime": 200,
		"enablehscroll": 1,
		"enablevscroll": 1,
		"devicewidth": 0.0,
		"description": "",
		"digest": "",
		"tags": "",
		"style": "",
		"subpatcher_template": "",
		"boxes": [
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-plugin",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 2,
					"outlettype": [
						"signal",
						"signal"
					],
					"patching_rect": [
						30.0,
						30.0,
						52.0,
						20.0
					],
					"text": "plugin~"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-plugout",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 2,
					"outlettype": [
						"signal",
						"signal"
					],
					"patching_rect": [
						30.0,
						80.0,
						58.0,
						20.0
					],
					"text": "plugout~"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-bufcfg",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"float",
						"bang"
					],
					"patching_rect": [
						30.0,
						120.0,
						180.0,
						20.0
					],
					"text": "buffer~ #0-tsconfig @samps 48"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-loadbuf",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						30.0,
						150.0,
						180.0,
						20.0
					],
					"text": "loadmess setbuffer #0-tsconfig"
				}
			},
			{
				"box": {
					"code": "// Tiny Space reverb core (GenExpr for gen.codebox~)\n// in1 = L audio, in2 = R audio\n// in3 = size, in4 = damp, in5 = width, in6 = mix, in7 = feedback\n// in8 = freeze, in9 = predelay, in10 = ingain, in11 = outgain\n// in12 = hp, in13 = lp, in14 = mod, in15 = crossfeed\n// out1 = L out, out2 = R out\n// out3..out22 = per-line meters (post-damping)\n// Buffer cfg = [activeCount, len0..19, char0..19]\n\nBuffer cfg(`#0-tsconfig`);\n\nData linesL(4800, 20);\nData linesR(4800, 20);\nData wptrL(20);\nData wptrR(20);\nData dampStateL(20);\nData dampStateR(20);\nData meters(20);\n\nHistory modPhase(0);\nHistory apBufL(0);\nHistory apBufR(0);\nHistory apWptrL(0);\nHistory apWptrR(0);\nHistory pdBufL(0);\nHistory pdBufR(0);\nHistory pdWptrL(0);\nHistory pdWptrR(0);\n\n// smoother histories\nHistory sizeS(0.5);\nHistory dampS(0.5);\nHistory widthS(1.0);\nHistory mixS(0.5);\nHistory fbS(0.5);\nHistory crossS(0.3);\nHistory modS(0.0);\nHistory hpS(0.0);\nHistory lpS(1.0);\nHistory ingainS(1.0);\nHistory outgainS(1.0);\nHistory predelayS(0.1);\n\n// allpass delay buffer\nData apDelayL(32);\nData apDelayR(32);\n\n// predelay buffer\nData pdDelayL(2400);\nData pdDelayR(2400);\n\n// ---- config ----\nactiveCount = peek(cfg, 0);\nif (activeCount < 1) activeCount = 10;\nif (activeCount > 20) activeCount = 20;\n\n// ---- smooth controls ----\nsizeS = sizeS + (in3 - sizeS) * 0.002;\ndampS = dampS + (in4 - dampS) * 0.002;\nwidthS = widthS + (in5 - widthS) * 0.002;\nmixS = mixS + (in6 - mixS) * 0.002;\nfbS = fbS + (in7 - fbS) * 0.002;\ncrossS = crossS + (in15 - crossS) * 0.002;\nmodS = modS + (in14 - modS) * 0.002;\nhpS = hpS + (in12 - hpS) * 0.002;\nlpS = lpS + (in13 - lpS) * 0.002;\ningainS = ingainS + (in10 - ingainS) * 0.002;\noutgainS = outgainS + (in11 - outgainS) * 0.002;\npredelayS = predelayS + (in9 - predelayS) * 0.002;\nfreezeV = in8;\n\nsizeV = sizeS;\ndampV = dampS;\nwidthV = widthS;\nmixV = mixS;\nfbV = fbS;\ncrossV = crossS;\nmodV = modS;\nhpV = hpS;\nlpV = lpS;\ningainV = ingainS;\noutgainV = outgainS;\npredelayV = predelayS;\n\n// ---- input gain ----\ninL = in1 * ingainV;\ninR = in2 * ingainV;\n\n// ---- HP / LP (one-pole) ----\n// lowpass state\nHistory lpStateL(0);\nHistory lpStateR(0);\nHistory hpStateL(0);\nHistory hpStateR(0);\nlpCoeff = 0.01 + lpV * 0.98;\nhpCoeff = hpV * 0.5;\nlpStateL = lpStateL + (inL - lpStateL) * lpCoeff;\nlpStateR = lpStateR + (inR - lpStateR) * lpCoeff;\nhpL = inL - lpStateL * hpCoeff;\nhpR = inR - lpStateR * hpCoeff;\nfiltL = hpL;\nfiltR = hpR;\n\n// ---- input allpass diffusion ----\ng = 0.5;\napDelay = 12;\n// L\napInL = filtL;\napIdxL = apWptrL;\napReadL = apIdxL - apDelay;\nif (apReadL < 0) apReadL = apReadL + 32;\napXprevL = peek(apDelayL, apReadL);\napYnewL = -g * apInL + apXprevL + g * apBufL;\npoke(apDelayL, apInL, apIdxL);\napBufL = apYnewL;\napWptrL = apWptrL + 1;\nif (apWptrL >= 32) apWptrL = 0;\ndiffL = apYnewL;\n\n// R\napInR = filtR;\napIdxR = apWptrR;\napReadR = apIdxR - apDelay;\nif (apReadR < 0) apReadR = apReadR + 32;\napXprevR = peek(apDelayR, apReadR);\napYnewR = -g * apInR + apXprevR + g * apBufR;\npoke(apDelayR, apInR, apIdxR);\napBufR = apYnewR;\napWptrR = apWptrR + 1;\nif (apWptrR >= 32) apWptrR = 0;\ndiffR = apYnewR;\n\n// ---- predelay ----\npdSamps = predelayV * 2400.0;\nif (pdSamps < 1.0) pdSamps = 1.0;\nif (pdSamps > 2390.0) pdSamps = 2390.0;\n// L\npdWpL = pdWptrL;\npdRpL = pdWpL - pdSamps;\nif (pdRpL < 0) pdRpL = pdRpL + 2400.0;\npdRp0L = floor(pdRpL);\npdRp1L = pdRp0L + 1;\nif (pdRp1L >= 2400.0) pdRp1L = 0;\npdFracL = pdRpL - pdRp0L;\npdY0L = peek(pdDelayL, pdRp0L);\npdY1L = peek(pdDelayL, pdRp1L);\npdOutL = pdY0L * (1.0 - pdFracL) + pdY1L * pdFracL;\npoke(pdDelayL, diffL, pdWpL);\npdWptrL = pdWpL + 1;\nif (pdWptrL >= 2400.0) pdWptrL = 0;\n// R\npdWpR = pdWptrR;\npdRpR = pdWpR - pdSamps;\nif (pdRpR < 0) pdRpR = pdRpR + 2400.0;\npdRp0R = floor(pdRpR);\npdRp1R = pdRp0R + 1;\nif (pdRp1R >= 2400.0) pdRp1R = 0;\npdFracR = pdRpR - pdRp0R;\npdY0R = peek(pdDelayR, pdRp0R);\npdY1R = peek(pdDelayR, pdRp1R);\npdOutR = pdY0R * (1.0 - pdFracR) + pdY1R * pdFracR;\npoke(pdDelayR, diffR, pdWpR);\npdWptrR = pdWpR + 1;\nif (pdWptrR >= 2400.0) pdWptrR = 0;\n\n// ---- mod LFO ----\nmodPhase = modPhase + 1.0 / 48000.0 * 0.3;\nif (modPhase >= 1.0) modPhase = modPhase - 1.0;\nmodLfo = sin(modPhase * 6.2831853);\n\n// ---- FDN: 20 lines ----\nsumL = 0;\nsumR = 0;\nfor (i = 0; i < 20; i += 1) {\n    lenNorm = peek(cfg, 1 + i);\n    charV = peek(cfg, 21 + i);\n    active = (i < activeCount) ? 1 : 0;\n\n    // delay time\n    baseMs = 1.0 + charV * 49.0;\n    delayMs = baseMs * sizeV;\n    delaySamps = delayMs * 48.0;\n    if (delaySamps < 1.0) delaySamps = 1.0;\n    if (delaySamps > 4790.0) delaySamps = 4790.0;\n\n    // damping\n    dampK = 0.1 + dampV * 0.85 + (charV - 0.5) * 0.1;\n    if (dampK < 0.01) dampK = 0.01;\n    if (dampK > 0.99) dampK = 0.99;\n\n    // feedback gain (clamped below 1.0 to prevent infinite ringing)\n    fbGain = fbV * (0.8 + charV * 0.4);\n    if (fbGain > 0.95) fbGain = 0.95;\n    if (freezeV > 0.5) fbGain = 0.995;\n\n    // mod\n    lineMod = modLfo * modV * (0.5 + charV * 0.5) * delaySamps * 0.02;\n\n    isLeft = (i < 10) ? 1 : 0;\n    inputV = isLeft ? pdOutL : pdOutR;\n\n    // crossfeed: add opposite side contribution\n    // (approximated: add crossV * (sum of opposite) * 0.05)\n    // We'll handle crossfeed by adding crossV * inputV * 0.1 for right->left coupling\n    // Simplified: crossfeed adds crossV * (isLeft ? pdOutR : pdOutL) * 0.1\n    crossTerm = crossV * (isLeft ? pdOutR : pdOutL) * 0.1;\n    inputV = inputV + crossTerm;\n\n    // read position (fractional)\n    if (isLeft) {\n        wp = peek(wptrL, i);\n        rp = wp - delaySamps + lineMod;\n        if (rp < 0) rp = rp + 4800.0;\n        if (rp >= 4800.0) rp = rp - 4800.0;\n        rp0 = floor(rp);\n        rp1 = rp0 + 1;\n        if (rp1 >= 4800.0) rp1 = 0;\n        frac = rp - rp0;\n        y0 = peek(linesL, rp0, i);\n        y1 = peek(linesL, rp1, i);\n        outLine = y0 * (1.0 - frac) + y1 * frac;\n\n        ds = peek(dampStateL, i);\n        d = outLine * (1.0 - dampK) + ds * dampK;\n        poke(dampStateL, d, i);\n\n        fbTerm = d * fbGain;\n        poke(linesL, inputV + fbTerm, wp, i);\n\n        wpNew = wp + 1;\n        if (wpNew >= 4800.0) wpNew = 0;\n        poke(wptrL, wpNew, i);\n    } else {\n        ii = i - 10;\n        wp = peek(wptrR, ii);\n        rp = wp - delaySamps + lineMod;\n        if (rp < 0) rp = rp + 4800.0;\n        if (rp >= 4800.0) rp = rp - 4800.0;\n        rp0 = floor(rp);\n        rp1 = rp0 + 1;\n        if (rp1 >= 4800.0) rp1 = 0;\n        frac = rp - rp0;\n        y0 = peek(linesR, rp0, ii);\n        y1 = peek(linesR, rp1, ii);\n        outLine = y0 * (1.0 - frac) + y1 * frac;\n\n        ds = peek(dampStateR, ii);\n        d = outLine * (1.0 - dampK) + ds * dampK;\n        poke(dampStateR, d, ii);\n\n        fbTerm = d * fbGain;\n        poke(linesR, inputV + fbTerm, wp, ii);\n\n        wpNew = wp + 1;\n        if (wpNew >= 4800.0) wpNew = 0;\n        poke(wptrR, wpNew, ii);\n    }\n\n    if (active < 1) {\n        d = 0;\n        poke(meters, 0, i);\n    } else {\n        poke(meters, d, i);\n    }\n\n    if (isLeft) {\n        sumL = sumL + d;\n    } else {\n        sumR = sumR + d;\n    }\n}\n\n// ---- width (M/S) ----\nmid = (sumL + sumR) * 0.5;\nside = (sumL - sumR) * 0.5;\nwetL = mid + side * widthV;\nwetR = mid - side * widthV;\n\n// ---- dry/wet mix ----\noutL = in1 * (1.0 - mixV) + wetL * mixV;\noutR = in2 * (1.0 - mixV) + wetR * mixV;\n\n// ---- output gain ----\nout1 = outL * outgainV;\nout2 = outR * outgainV;\n\n// ---- meters ----\nout3 = peek(meters, 0);\nout4 = peek(meters, 1);\nout5 = peek(meters, 2);\nout6 = peek(meters, 3);\nout7 = peek(meters, 4);\nout8 = peek(meters, 5);\nout9 = peek(meters, 6);\nout10 = peek(meters, 7);\nout11 = peek(meters, 8);\nout12 = peek(meters, 9);\nout13 = peek(meters, 10);\nout14 = peek(meters, 11);\nout15 = peek(meters, 12);\nout16 = peek(meters, 13);\nout17 = peek(meters, 14);\nout18 = peek(meters, 15);\nout19 = peek(meters, 16);\nout20 = peek(meters, 17);\nout21 = peek(meters, 18);\nout22 = peek(meters, 19);\n",
					"fontface": 0,
					"fontname": "<Monospaced>",
					"fontsize": 10.0,
					"hidden": 1,
					"id": "obj-gen",
					"maxclass": "gen.codebox~",
					"numinlets": 15,
					"numoutlets": 22,
					"outlettype": [
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal",
						"signal"
					],
					"patching_rect": [
						30.0,
						200.0,
						260.0,
						120.0
					],
					"varname": "TinySpaceGen"
				}
			},
			{
				"box": {
					"border": 0,
					"filename": "none",
					"id": "obj-viz",
					"maxclass": "v8ui",
					"numinlets": 1,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						30.0,
						230.0,
						200.0,
						80.0
					],
					"textfile": {
						"text": "\nmgraphics.init();\nmgraphics.relative_coords = 0;\nmgraphics.autofill = 0;\ninlets = 1;\noutlets = 1;\nlet bufName = \"\";\nlet snaps = [];\nfunction setbuffer(n){ bufName = n; poke(); }\nfunction poke(){\n  if (!bufName) return;\n  const arr = [10];\n  for (let i = 0; i < 40; i++) arr.push(0.5);\n  try { new Buffer(bufName).poke(1, 0, arr); } catch(e) {}\n}\nfunction loadbang(){ poke(); post(\"TINYZSPACE_HARNESS_OK\\n\"); }\nfunction paint(){ mgraphics.set_source_rgba(0.06,0.07,0.09,1); mgraphics.rectangle(0,0,mgraphics.size[0],mgraphics.size[1]); mgraphics.fill(); }\n// snapshot measurement: snapshot~ arrives as snap(v)\nlet snaps = [];\nfunction snap(v){\n  const val = (typeof v === \"number\") ? v : 0;\n  snaps.push(val);\n  post(\"SNAP \" + snaps.length + \" = \" + val + \"\\n\");\n  if (snaps.length >= 3) {\n    // early (after ~0.3s) vs late (after ~2s)\n    const early = Math.max.apply(null, snaps.slice(0, 3).map(Math.abs));\n    const late = Math.abs(snaps[snaps.length - 1]);\n    const decent = early > 0.001;\n    const noClip = early < 0.99;\n    const ratio = (early > 0) ? (late / early) : 0;\n    const freezeMode = false;\n    const ringOk = freezeMode ? (ratio > 0.3) : (ratio < 0.3);\n    if (decent && noClip && ringOk) post(\"HARNESS_PASS\\n\");\n    else post(\"HARNESS_FAIL decent=\" + decent + \" noClip=\" + noClip + \" ringOk=\" + ringOk + \" ratio=\" + ratio + \" early=\" + early + \" late=\" + late + \"\\n\");\n  }\n}\n",
						"filename": "none",
						"flags": 0,
						"embed": 1,
						"autowatch": 1
					},
					"varname": "VizData"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-click",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						320.0,
						60.0,
						20.0
					],
					"text": "click~"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-0",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						340.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.5"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-1",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						352.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.5"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-2",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						364.0,
						60.0,
						20.0
					],
					"text": "sig~ 1"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-3",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						376.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.3"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-4",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						388.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.4"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-5",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						400.0,
						60.0,
						20.0
					],
					"text": "sig~ 0"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-6",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						412.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.1"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-7",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						424.0,
						60.0,
						20.0
					],
					"text": "sig~ 1"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-8",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						436.0,
						60.0,
						20.0
					],
					"text": "sig~ 1"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-9",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						448.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.05"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-10",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						460.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.8"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-11",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						472.0,
						60.0,
						20.0
					],
					"text": "sig~ 0"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ctrl-12",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"signal"
					],
					"patching_rect": [
						30.0,
						484.0,
						60.0,
						20.0
					],
					"text": "sig~ 0.3"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-snap",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						30.0,
						500.0,
						80.0,
						20.0
					],
					"text": "snapshot~ 200"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-snapprep",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						30.0,
						520.0,
						80.0,
						20.0
					],
					"text": "prepend snap"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-lb",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						30.0,
						560.0,
						70.0,
						20.0
					],
					"text": "loadbang"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-lb2",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						30.0,
						640.0,
						70.0,
						20.0
					],
					"text": "loadbang"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ezdac",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						30.0,
						680.0,
						44.0,
						44.0
					],
					"text": "ezdac~"
				}
			}
		],
		"lines": [
			{
				"patchline": {
					"source": [
						"obj-plugin",
						0
					],
					"destination": [
						"obj-plugout",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-plugin",
						1
					],
					"destination": [
						"obj-plugout",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-plugin",
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
						"obj-plugin",
						1
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
						"obj-plugout",
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
						"obj-plugout",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-loadbuf",
						0
					],
					"destination": [
						"obj-viz",
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
						"obj-gen",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-0",
						0
					],
					"destination": [
						"obj-gen",
						2
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-1",
						0
					],
					"destination": [
						"obj-gen",
						3
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-2",
						0
					],
					"destination": [
						"obj-gen",
						4
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-3",
						0
					],
					"destination": [
						"obj-gen",
						5
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-4",
						0
					],
					"destination": [
						"obj-gen",
						6
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-5",
						0
					],
					"destination": [
						"obj-gen",
						7
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-6",
						0
					],
					"destination": [
						"obj-gen",
						8
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-7",
						0
					],
					"destination": [
						"obj-gen",
						9
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-8",
						0
					],
					"destination": [
						"obj-gen",
						10
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-9",
						0
					],
					"destination": [
						"obj-gen",
						11
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-10",
						0
					],
					"destination": [
						"obj-gen",
						12
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-11",
						0
					],
					"destination": [
						"obj-gen",
						13
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-12",
						0
					],
					"destination": [
						"obj-gen",
						14
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
						"obj-snapprep",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-snapprep",
						0
					],
					"destination": [
						"obj-viz",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-lb",
						0
					],
					"destination": [
						"obj-click",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-lb2",
						0
					],
					"destination": [
						"obj-viz",
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
						"obj-ezdac",
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
						"obj-ezdac",
						1
					]
				}
			}
		],
		"parameters": {},
		"dependency_cache": [],
		"latency": 0
	}
}