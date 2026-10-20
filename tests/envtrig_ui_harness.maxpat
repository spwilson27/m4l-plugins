{
	"patcher": {
		"fileversion": 1,
		"appversion": {
			"major": 9,
			"minor": 1,
			"revision": 0,
			"architecture": "x64",
			"modernui": 1
		},
		"classnamespace": "box",
		"rect": [
			100.0,
			100.0,
			342.0,
			169.0
		],
		"openrect": [
			0.0,
			0.0,
			228.0,
			169.0
		],
		"bglocked": 0,
		"openinpresentation": 1,
		"default_fontsize": 10.0,
		"default_fontface": 0,
		"default_fontname": "Arial Bold",
		"gridonopen": 1,
		"gridsize": [
			8.0,
			8.0
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
		"devicewidth": 228.0,
		"description": "Transient detector that fires MIDI notes from an audio track to any MIDI track",
		"digest": "Transient detection with a collapsible, native-style MIDI To chooser",
		"tags": "trigger transient drum replacement midi envelope",
		"style": "",
		"subpatcher_template": "",
		"assistshowspatchername": 0,
		"boxes": [
			{
				"box": {
					"border": 0,
					"filename": "none",
					"id": "obj-viz",
					"maxclass": "v8ui",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						""
					],
					"patching_rect": [
						20.0,
						80.0,
						192.0,
						104.0
					],
					"presentation": 1,
					"presentation_rect": [
						8.0,
						8.0,
						192.0,
						104.0
					],
					"textfile": {
						"text": "// Shared Envelope Trigger math, UI geometry & LOM routing helpers.\n// Prepended into src/envtrig_ui.js at build time and exported for Node tests.\n\nconst SCOPE_COLS = 110;\n// buffer~ #0-trigscope layout (written by src/envtrig_core.genexpr): header 0..6, then the\n// oscilloscope ring of SCOPE_BLOCKS x (min, max, onset flag) from SCOPE_RING_OFFSET.\nconst SCOPE_BLOCKS = 256;\nconst SCOPE_RING_OFFSET = 32;\nconst SCOPE_BUFFER_SAMPS = 800;\nconst THR_MIN_DB = -60.0;\nconst THR_MAX_DB = 0.0;\n// Device width with the MIDI To panel collapsed / expanded (live.thisdevice setwidth).\nconst WIDTH_COLLAPSED = 228;\nconst WIDTH_EXPANDED = 342;\nconst NOTE_NAMES = [\"C\", \"C#\", \"D\", \"D#\", \"E\", \"F\", \"F#\", \"G\", \"G#\", \"A\", \"A#\", \"B\"];\nconst ROUTING_PATH = \"this_device midi_outputs 0\";\n\nfunction clamp(v, lo, hi) {\n    return Math.max(lo, Math.min(hi, v));\n}\n\nfunction dbToLin(db) {\n    return Math.pow(10, db / 20);\n}\n\nfunction linToDb(lin) {\n    return 20 * Math.log10(Math.max(lin, 1e-6));\n}\n\n// Live's note naming (C3 = 60).\nfunction noteName(n) {\n    const v = clamp(Math.round(Number(n) || 0), 0, 127);\n    return NOTE_NAMES[v % 12] + (Math.floor(v / 12) - 2);\n}\n\n// Required fast/slow ratio for an onset: Sens 100% -> 0 dB (threshold only), Sens 0% -> 12 dB.\nfunction onsetRatio(sens01) {\n    return dbToLin((1 - clamp(sens01, 0, 1)) * 12);\n}\n\n// Mirrors the GenExpr velocity map: captured peak between threshold and 0 dBFS -> velLo..velHi.\nfunction velocityFromPeak(peakLin, thrDb, velLo, velHi) {\n    const lo = clamp(velLo, 1, 127);\n    const hi = clamp(Math.max(velHi, lo), 1, 127);\n    const thr = clamp(thrDb, THR_MIN_DB, THR_MAX_DB);\n    const t = clamp((linToDb(peakLin) - thr) / Math.max(-thr, 1), 0, 1);\n    return clamp(Math.floor(lo + t * (hi - lo) + 0.5), 1, 127);\n}\n\n// Display mapping for the scope: 0 dBFS at the top, -60 dB at the bottom of the plot.\nfunction dbToPlot01(db) {\n    return clamp((db - THR_MIN_DB) / (THR_MAX_DB - THR_MIN_DB), 0, 1);\n}\n\nfunction linToPlot01(lin) {\n    if (lin <= 1e-6) return 0;\n    return dbToPlot01(linToDb(lin));\n}\n\nfunction plot01ToDb(v01) {\n    return THR_MIN_DB + clamp(v01, 0, 1) * (THR_MAX_DB - THR_MIN_DB);\n}\n\n// LiveAPI hands back dictionary properties in three shapes; normalise them all:\n//   get()             -> [\"{json}\"]\n//   observer callback -> [property, <Max Dict>] in v8 (a handle like {name: \"u0950...\"}, read via stringify())\n//   classic js        -> [property, parsed object]\nfunction lomValue(raw, key) {\n    let v = raw;\n    if (Array.isArray(v)) v = v.length > 1 ? v[1] : v[0];\n    if (v && typeof v === \"object\" && typeof v.stringify === \"function\") v = v.stringify();\n    if (typeof v === \"string\") {\n        try { v = JSON.parse(v); } catch (err) { return null; }\n    }\n    if (v && typeof v === \"object\" && key in v) return v[key];\n    return null;\n}\n\n// Menu items for the \"MIDI To\" type chooser.\nfunction routingTypeRange(types) {\n    if (!types || !types.length) return [\"No Output\", \"-\"];\n    const names = types.map((t) => String(t.display_name));\n    return names.length === 1 ? [names[0], \"-\"] : names;\n}\n\n// Menu state for the channel chooser: single/empty channel lists are shown but disabled.\nfunction routingChannelState(channels) {\n    if (!channels || !channels.length) return { range: [\"-\", \"-\"], active: 0 };\n    if (channels.length === 1) {\n        const n = String(channels[0].display_name || \"\");\n        return { range: [n || \"-\", \"-\"], active: 0 };\n    }\n    return { range: channels.map((c) => String(c.display_name)), active: 1 };\n}\n\nif (typeof module !== \"undefined\" && module.exports) {\n    module.exports = {\n        SCOPE_COLS,\n        SCOPE_BLOCKS,\n        SCOPE_RING_OFFSET,\n        SCOPE_BUFFER_SAMPS,\n        THR_MIN_DB,\n        THR_MAX_DB,\n        WIDTH_COLLAPSED,\n        WIDTH_EXPANDED,\n        ROUTING_PATH,\n        clamp,\n        dbToLin,\n        linToDb,\n        noteName,\n        onsetRatio,\n        velocityFromPeak,\n        dbToPlot01,\n        linToPlot01,\n        plot01ToDb,\n        lomValue,\n        routingTypeRange,\n        routingChannelState,\n    };\n}\n\n// Envelope Trigger graph + \"MIDI To\" routing controller.\n// src/envtrig_config.js is prepended at build time.\n// Two views, switched by the [envelope | scope] toggle in the HUD:\n//   envelope \u2014 scrolling fast envelope (dB scale) and slow baseline, ~3.6 s\n//   scope    \u2014 oscilloscope of the mono input (linear, min/max per 32-sample block), ~186 ms\n// Both draw the draggable threshold, thin full-height fired-note ticks and a flashing velocity\n// LED on the right edge, with the MIDI To destination in the HUD.\n//\n// Outlet 0: [\"thr\", dB] from threshold drags, [\"view\", 0|1] from the view toggle.\n// Outlet 1: messages for the \"MIDI Output Type\" live.menu.\n// Outlet 2: messages for the \"MIDI Output Channel\" live.menu.\n// The routing itself lives on this device's LOM DeviceIO (`this_device midi_outputs 0`),\n// so Live saves it with the set; the menus only mirror it.\n\nmgraphics.init();\nmgraphics.relative_coords = 0;\nmgraphics.autofill = 0;\n\ninlets = 1;\noutlets = 3;\n\nvar COLOR = [0.28, 0.84, 0.96];\nvar AMBER = [0.96, 0.66, 0.25];\n\nvar scopeBuf = null;\nvar scopeTask = null;\n\nvar histFast = [];\nvar histSlow = [];\nvar histFire = [];\nvar flash = 0;\nvar lastFires = -1;\nvar lastVel = 0;\nvar lastRoll = -1;\nvar idleFrames = 0;\n\nvar scopeMin = [];\nvar scopeMax = [];\nvar scopeFire = [];\nvar lastHead = -1;\nvar view = 0; // 0 = envelope, 1 = oscilloscope\n\nvar thrDb = -24.0;\nvar note = 36;\nvar dragging = false;\n\nvar lomTypes = null;\nvar lomChannels = null;\nvar lomType = null;\nvar lomChannel = null;\nvar routingName = \"No Output\";\n\nfunction initHistory(demo) {\n    histFast = [];\n    histSlow = [];\n    histFire = [];\n    for (var i = 0; i < SCOPE_COLS; i++) {\n        if (!demo) {\n            histFast.push(0);\n            histSlow.push(0);\n            histFire.push(0);\n            continue;\n        }\n        var local = (i + 3) % 28;\n        var amp = 0.78 * (0.85 + 0.15 * Math.sin(i * 0.7));\n        var f = amp * Math.exp(-local * 0.16) + 0.004;\n        histFast.push(f);\n        var prev = i > 0 ? histSlow[i - 1] : f * 0.4;\n        histSlow.push(prev + (f - prev) * 0.12);\n        histFire.push(local === 1 && linToDb(f) > thrDb ? velocityFromPeak(f, thrDb, 40, 127) : 0);\n    }\n    scopeMin = [];\n    scopeMax = [];\n    scopeFire = [];\n    for (var k = 0; k < SCOPE_BLOCKS; k++) {\n        var local2 = (k + 20) % 85;\n        var a = demo ? 0.82 * Math.exp(-local2 * 0.07) * Math.abs(Math.sin(k * 0.9 + 0.3)) + 0.01 : 0;\n        scopeMin.push(-a);\n        scopeMax.push(a * 0.94);\n        scopeFire.push(demo && local2 === 0 ? 1 : 0);\n    }\n    if (demo) {\n        flash = 0.9;\n        lastVel = 112;\n    }\n}\n\ninitHistory(false);\n\nfunction preview() {\n    initHistory(true);\n}\n\nfunction setbuffer(name) {\n    if (!name) return;\n    scopeBuf = new Buffer(\"\" + name);\n}\n\nfunction set_thr(db) {\n    thrDb = clamp(Number(db), THR_MIN_DB, THR_MAX_DB);\n    if (!scopeBuf) initHistory(true);\n    mgraphics.redraw();\n}\n\nfunction set_view(v) {\n    view = Number(v) > 0.5 ? 1 : 0;\n    lastHead = -1; // re-read the ring on the next frame\n    if (!scopeBuf) initHistory(true);\n    mgraphics.redraw();\n}\n\nfunction set_note(n) {\n    note = clamp(Math.round(Number(n) || 0), 0, 127);\n    mgraphics.redraw();\n}\n\n// ---------- \"MIDI To\" routing (LOM DeviceIO) ----------\n\n// Must be triggered by live.thisdevice, not loadbang: the LOM is not ready before that.\nfunction init_routing() {\n    if (typeof LiveAPI === \"undefined\") return;\n    lomTypes = new LiveAPI(onTypes, ROUTING_PATH);\n    lomTypes.property = \"available_routing_types\";\n    lomChannels = new LiveAPI(onChannels, ROUTING_PATH);\n    lomChannels.property = \"available_routing_channels\";\n    lomType = new LiveAPI(onType, ROUTING_PATH);\n    lomType.property = \"routing_type\";\n    lomChannel = new LiveAPI(onChannel, ROUTING_PATH);\n    lomChannel.property = \"routing_channel\";\n}\n\nfunction onTypes(args) {\n    var types = lomValue(args, \"available_routing_types\");\n    if (!types) return;\n    outlet(1, [\"_parameter_range\"].concat(routingTypeRange(types)));\n    if (lomType) onType(lomType.get(\"routing_type\"));\n}\n\nfunction onChannels(args) {\n    var chans = lomValue(args, \"available_routing_channels\");\n    if (!chans) return;\n    var st = routingChannelState(chans);\n    outlet(2, [\"_parameter_range\"].concat(st.range));\n    outlet(2, [\"active\", st.active]);\n    outlet(2, [\"ignoreclick\", st.active ? 0 : 1]);\n    if (st.active && lomChannel) onChannel(lomChannel.get(\"routing_channel\"));\n}\n\nfunction onType(args) {\n    var t = lomValue(args, \"routing_type\");\n    if (!t) return;\n    routingName = String(t.display_name);\n    outlet(1, [\"setsymbol\", routingName]);\n    mgraphics.redraw();\n}\n\nfunction onChannel(args) {\n    var c = lomValue(args, \"routing_channel\");\n    if (!c || !c.display_name) return;\n    outlet(2, [\"setsymbol\", String(c.display_name)]);\n}\n\nfunction settype(i) {\n    if (!lomTypes || !lomType) return;\n    var types = lomValue(lomTypes.get(\"available_routing_types\"), \"available_routing_types\");\n    var idx = Math.round(Number(i) || 0);\n    if (types && types[idx]) lomType.set(\"routing_type\", types[idx]);\n}\n\nfunction setchannel(i) {\n    if (!lomChannels || !lomChannel) return;\n    var chans = lomValue(lomChannels.get(\"available_routing_channels\"), \"available_routing_channels\");\n    var idx = Math.round(Number(i) || 0);\n    if (chans && chans.length > 1 && chans[idx]) lomChannel.set(\"routing_channel\", chans[idx]);\n}\n\n// ---------- Scope telemetry ----------\n\nfunction sampleAt(chunk, idx) {\n    if (!chunk || !chunk.length || idx >= chunk.length) return 0;\n    var v = chunk[idx];\n    return (v === v && v > 0) ? v : 0;\n}\n\nfunction pullScope() {\n    if (!scopeBuf) return false;\n    var chunk = scopeBuf.peek(1, 0, 6);\n    var f = clamp(sampleAt(chunk, 0), 0, 1.5);\n    var s = clamp(sampleAt(chunk, 1), 0, 1.5);\n    var fires = sampleAt(chunk, 2);\n    var roll = sampleAt(chunk, 3);\n    var fireVel = 0;\n    if (lastFires >= 0 && fires !== lastFires) {\n        fireVel = clamp(sampleAt(chunk, 5), 1, 127);\n        lastVel = fireVel;\n        flash = 1.0;\n    }\n    lastFires = fires;\n    flash *= 0.82;\n    if (flash < 0.01) flash = 0;\n\n    histFast.shift();\n    histFast.push(f);\n    histSlow.shift();\n    histSlow.push(s);\n    histFire.shift();\n    histFire.push(fireVel);\n\n    var head = pullRing();\n\n    var quiet = f <= 0.0001 && fireVel === 0 && flash === 0 && roll === lastRoll && head === lastHead;\n    lastHead = head;\n    lastRoll = roll;\n    if (quiet) {\n        idleFrames++;\n        // Once the whole history has scrolled flat, stop redrawing at 30 fps.\n        if (idleFrames > SCOPE_COLS + 4) return false;\n    } else {\n        idleFrames = 0;\n    }\n    return true;\n}\n\n// Reads the oscilloscope ring (oldest block first, starting at the write head). Only the head is\n// read in the envelope view; the 768-sample ring is copied only while the scope is showing.\nfunction pullRing() {\n    var hdr = scopeBuf.peek(1, 6, 1);\n    var head = Math.round(typeof hdr === \"number\" ? hdr : sampleAt(hdr, 0)) % SCOPE_BLOCKS;\n    if (head === lastHead || view !== 1) return head;\n    var ring = scopeBuf.peek(1, SCOPE_RING_OFFSET, SCOPE_BLOCKS * 3);\n    if (!ring || !ring.length) return head;\n    for (var i = 0; i < SCOPE_BLOCKS; i++) {\n        var b = ((head + i) % SCOPE_BLOCKS) * 3;\n        var lo = ring[b];\n        var hi = ring[b + 1];\n        scopeMin[i] = (lo === lo) ? clamp(lo, -1, 1) : 0;\n        scopeMax[i] = (hi === hi) ? clamp(hi, -1, 1) : 0;\n        scopeFire[i] = ring[b + 2] > 0.5 ? 1 : 0;\n    }\n    return head;\n}\n\nfunction loadbang() {\n    if (typeof Task === \"function\") {\n        scopeTask = new Task(function () {\n            if (pullScope()) mgraphics.redraw();\n        }, this);\n        scopeTask.interval = 33;\n        scopeTask.repeat();\n    }\n    mgraphics.redraw();\n}\n\n// ---------- Geometry & interaction ----------\n\nfunction bounds() {\n    var s = mgraphics.size;\n    var w = (s && s.length > 1) ? s[0] : 192;\n    var h = (s && s.length > 1) ? s[1] : 104;\n    var ledW = 16;\n    var x = 3;\n    var y = 15;\n    return { w: w, h: h, x: x, y: y, pw: w - x - ledW - 6, ph: h - y - 3, ledX: w - ledW - 3, ledW: ledW };\n}\n\nfunction plotY(b, lin) {\n    return b.y + b.ph - linToPlot01(lin) * b.ph;\n}\n\n// [envelope | scope] toggle in the HUD's top-left corner, two 14 px segments.\nfunction viewButton() {\n    return { x: 3, y: 1, w: 28, h: 11 };\n}\n\nfunction onclick(x, y) {\n    var vb = viewButton();\n    if (x >= vb.x && x <= vb.x + vb.w && y >= vb.y && y <= vb.y + vb.h + 1) {\n        view = x < vb.x + vb.w / 2 ? 0 : 1;\n        lastHead = -1;\n        outlet(0, [\"view\", view]);\n        dragging = false;\n        if (!scopeBuf) initHistory(true);\n        mgraphics.redraw();\n        return;\n    }\n    dragging = true;\n    ondrag(x, y);\n}\n\nfunction ondrag(x, y, but) {\n    if (!dragging) return;\n    if (but === 0) {\n        dragging = false;\n        return;\n    }\n    var b = bounds();\n    if (view === 1) {\n        // Scope: linear amplitude, threshold mirrored around the centre line.\n        var amp = clamp(Math.abs(y - (b.y + b.ph / 2)) / Math.max(1, b.ph / 2), 0.001, 1);\n        thrDb = Math.round(clamp(linToDb(amp), THR_MIN_DB, THR_MAX_DB) * 10) / 10;\n    } else {\n        var v01 = clamp((b.y + b.ph - y) / Math.max(1, b.ph), 0, 1);\n        thrDb = Math.round(plot01ToDb(v01) * 10) / 10;\n    }\n    outlet(0, [\"thr\", thrDb]);\n    if (!scopeBuf) initHistory(true);\n    mgraphics.redraw();\n}\n\n// ---------- Drawing ----------\n\n// Small dark backing so labels stay legible over the traces.\nfunction labelPill(x, y, txt, col) {\n    var w = txt.length * 4.3 + 4;\n    mgraphics.set_source_rgba(0.047, 0.059, 0.075, 0.82);\n    mgraphics.rectangle(x, y, w, 10);\n    mgraphics.fill();\n    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.95);\n    mgraphics.move_to(x + 2, y + 8);\n    mgraphics.show_text(txt);\n}\n\nfunction drawEnvelope(b) {\n    var step = b.pw / (SCOPE_COLS - 1);\n\n    // Fast envelope silhouette + trace\n    mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.22);\n    mgraphics.move_to(b.x, b.y + b.ph);\n    for (var i = 0; i < SCOPE_COLS; i++) mgraphics.line_to(b.x + i * step, plotY(b, histFast[i]));\n    mgraphics.line_to(b.x + b.pw, b.y + b.ph);\n    mgraphics.close_path();\n    mgraphics.fill();\n\n    mgraphics.set_line_width(1.3);\n    mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.95);\n    for (var j = 0; j < SCOPE_COLS; j++) {\n        if (j === 0) mgraphics.move_to(b.x, plotY(b, histFast[j]));\n        else mgraphics.line_to(b.x + j * step, plotY(b, histFast[j]));\n    }\n    mgraphics.stroke();\n\n    // Slow baseline\n    mgraphics.set_line_width(1);\n    mgraphics.set_source_rgba(0.80, 0.84, 0.90, 0.35);\n    for (var k = 0; k < SCOPE_COLS; k++) {\n        if (k === 0) mgraphics.move_to(b.x, plotY(b, histSlow[k]));\n        else mgraphics.line_to(b.x + k * step, plotY(b, histSlow[k]));\n    }\n    mgraphics.stroke();\n\n    var ticks = [];\n    for (var m = 0; m < SCOPE_COLS; m++) if (histFire[m] > 0) ticks.push(b.x + m * step);\n    return ticks;\n}\n\nfunction drawScope(b) {\n    var mid = b.y + b.ph / 2;\n    var half = b.ph / 2 - 1;\n    var cols = Math.max(2, Math.floor(b.pw));\n    var per = SCOPE_BLOCKS / cols;\n    var ticks = [];\n\n    mgraphics.set_line_width(1);\n    mgraphics.set_source_rgba(0.18, 0.22, 0.28, 1.0);\n    mgraphics.move_to(b.x, mid);\n    mgraphics.line_to(b.x + b.pw, mid);\n    mgraphics.stroke();\n\n    // Min/max waveform envelope, one column per pixel, filled as one polygon\n    var tops = [];\n    var bots = [];\n    for (var c = 0; c < cols; c++) {\n        var from = Math.floor(c * per);\n        var to = Math.max(from + 1, Math.floor((c + 1) * per));\n        var lo = 0;\n        var hi = 0;\n        var fired = 0;\n        for (var i = from; i < to && i < SCOPE_BLOCKS; i++) {\n            if (scopeMin[i] < lo) lo = scopeMin[i];\n            if (scopeMax[i] > hi) hi = scopeMax[i];\n            if (scopeFire[i]) fired = 1;\n        }\n        tops.push(Math.min(mid - hi * half, mid - 0.5));\n        bots.push(Math.max(mid - lo * half, mid + 0.5));\n        if (fired) ticks.push(b.x + c + 0.5);\n    }\n    mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.85);\n    mgraphics.move_to(b.x, tops[0]);\n    for (var u = 1; u < cols; u++) mgraphics.line_to(b.x + u, tops[u]);\n    for (var d = cols - 1; d >= 0; d--) mgraphics.line_to(b.x + d, bots[d]);\n    mgraphics.close_path();\n    mgraphics.fill();\n    return ticks;\n}\n\n// Segmented [envelope | scope] toggle with vector icons; the active segment is filled.\nfunction drawViewButton() {\n    var vb = viewButton();\n    var segW = vb.w / 2;\n    for (var sIdx = 0; sIdx < 2; sIdx++) {\n        var sx = vb.x + sIdx * segW;\n        var on = sIdx === view;\n        mgraphics.set_source_rgba(on ? COLOR[0] : 0.12, on ? COLOR[1] : 0.15, on ? COLOR[2] : 0.19, on ? 0.9 : 1.0);\n        mgraphics.rectangle(sx, vb.y, segW - 1, vb.h);\n        mgraphics.fill();\n        var ic = on ? [0.04, 0.06, 0.08] : [0.62, 0.70, 0.78];\n        mgraphics.set_source_rgba(ic[0], ic[1], ic[2], 1.0);\n        mgraphics.set_line_width(1.1);\n        var x0 = sx + 2.5;\n        var x1 = sx + segW - 3.5;\n        var yb = vb.y + vb.h - 2.5;\n        var yt = vb.y + 2.5;\n        if (sIdx === 0) {\n            // Envelope: sharp attack, exponential-ish decay\n            mgraphics.move_to(x0, yb);\n            mgraphics.line_to(x0 + 2, yt);\n            mgraphics.line_to(x0 + 4.5, vb.y + 6);\n            mgraphics.line_to(x1, yb);\n        } else {\n            // Scope: one sine cycle\n            var ym = vb.y + vb.h / 2;\n            for (var q = 0; q <= 8; q++) {\n                var px = x0 + (x1 - x0) * q / 8;\n                var py = ym - Math.sin(q / 8 * Math.PI * 2) * (vb.h / 2 - 2.5);\n                if (q === 0) mgraphics.move_to(px, py);\n                else mgraphics.line_to(px, py);\n            }\n        }\n        mgraphics.stroke();\n    }\n}\n\nfunction paint() {\n    if (!scopeBuf && histFast[SCOPE_COLS - 1] === 0 && histFast[0] === 0) initHistory(true);\n\n    var b = bounds();\n    mgraphics.set_source_rgba(0.047, 0.059, 0.075, 1.0);\n    mgraphics.rectangle(0, 0, b.w, b.h);\n    mgraphics.fill();\n\n    mgraphics.set_source_rgba(0.065, 0.08, 0.10, 1.0);\n    mgraphics.rectangle(b.x, b.y, b.pw, b.ph);\n    mgraphics.fill();\n\n    // Threshold position(s): one line on the dB envelope, mirrored \u00b1 lines on the linear scope.\n    var thrLines = [];\n    if (view === 1) {\n        var amp = dbToLin(thrDb) * (b.ph / 2 - 1);\n        thrLines = [b.y + b.ph / 2 - amp, b.y + b.ph / 2 + amp];\n    } else {\n        thrLines = [b.y + b.ph - dbToPlot01(thrDb) * b.ph];\n        mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.05);\n        mgraphics.rectangle(b.x, b.y, b.pw, thrLines[0] - b.y);\n        mgraphics.fill();\n    }\n\n    var ticks = view === 1 ? drawScope(b) : drawEnvelope(b);\n\n    // Fired-note ticks: thin and always full height\n    mgraphics.set_line_width(1);\n    mgraphics.set_source_rgba(1.0, 0.86, 0.45, 0.9);\n    for (var t = 0; t < ticks.length; t++) {\n        var tx = Math.round(ticks[t]) + 0.5;\n        mgraphics.move_to(tx, b.y);\n        mgraphics.line_to(tx, b.y + b.ph);\n    }\n    mgraphics.stroke();\n\n    // Draggable threshold (dashed)\n    mgraphics.set_line_width(1.2);\n    mgraphics.set_source_rgba(AMBER[0], AMBER[1], AMBER[2], 0.95);\n    for (var li = 0; li < thrLines.length; li++) {\n        for (var gx = b.x; gx < b.x + b.pw; gx += 8) {\n            mgraphics.move_to(gx, thrLines[li]);\n            mgraphics.line_to(Math.min(gx + 4, b.x + b.pw), thrLines[li]);\n        }\n    }\n    mgraphics.stroke();\n\n    mgraphics.select_font_face(\"Arial Bold\");\n    mgraphics.set_font_size(7.5);\n    var thrTxt = Math.round(thrDb) + \"dB\";\n    var pillW = thrTxt.length * 4.3 + 4;\n    labelPill(b.x + b.pw - pillW - 2, clamp(thrLines[0] - 11, b.y + 2, b.y + b.ph - 11), thrTxt, AMBER);\n\n    // Velocity LED\n    mgraphics.set_source_rgba(0.08, 0.10, 0.13, 1.0);\n    mgraphics.rectangle(b.ledX, b.y, b.ledW, b.ph);\n    mgraphics.fill();\n    if (flash > 0) {\n        mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.25 + 0.75 * flash);\n        var fillH = Math.max(3, (lastVel / 127) * (b.ph - 4));\n        mgraphics.rectangle(b.ledX + 2, b.y + b.ph - 2 - fillH, b.ledW - 4, fillH);\n        mgraphics.fill();\n    }\n\n    // HUD: view toggle, destination, then note + last velocity on the right\n    drawViewButton();\n    mgraphics.set_font_size(8);\n    var dest = routingName.length > 18 ? routingName.substring(0, 17) + \".\" : routingName;\n    var noOut = routingName === \"No Output\";\n    mgraphics.set_source_rgba(noOut ? 0.96 : 0.36, noOut ? 0.52 : 0.84, noOut ? 0.40 : 0.66, 0.95);\n    mgraphics.move_to(35, 10);\n    mgraphics.show_text(\"> \" + dest);\n\n    var info = noteName(note) + (lastVel > 0 ? \" \" + Math.round(lastVel) : \"\");\n    mgraphics.set_source_rgba(1.0, 0.86, 0.45, 0.92);\n    mgraphics.move_to(b.w - 4 - info.length * 4.6, 10);\n    mgraphics.show_text(info);\n\n    mgraphics.set_line_width(1);\n    mgraphics.set_source_rgba(0.18, 0.22, 0.28, 1.0);\n    mgraphics.rectangle(0.5, 0.5, b.w - 1, b.h - 1);\n    mgraphics.stroke();\n}\n",
						"filename": "none",
						"flags": 0,
						"embed": 1,
						"autowatch": 1
					}
				}
			},
			{
				"box": {
					"activedialcolor": [
						0.28,
						0.84,
						0.96,
						1.0
					],
					"annotation": "Level a hit must exceed to fire a note. Also draggable on the graph.",
					"annotation_name": "Threshold",
					"id": "obj-ctrl-thr",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						18,
						220.0,
						44.0,
						46.0
					],
					"presentation": 1,
					"presentation_rect": [
						18.0,
						116.0,
						44.0,
						46.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "Threshold",
							"parameter_initial": [
								-24.0
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Threshold",
							"parameter_mmax": 0.0,
							"parameter_mmin": -60.0,
							"parameter_shortname": "Thresh",
							"parameter_type": 0,
							"parameter_unitstyle": 4
						}
					},
					"varname": "Threshold"
				}
			},
			{
				"box": {
					"activedialcolor": [
						0.28,
						0.84,
						0.96,
						1.0
					],
					"annotation": "How far a hit must jump above the recent level to count as a transient. 100% fires on the threshold alone; 0% needs a 12 dB jump.",
					"annotation_name": "Sensitivity",
					"id": "obj-ctrl-sens",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						82,
						220.0,
						44.0,
						46.0
					],
					"presentation": 1,
					"presentation_rect": [
						82.0,
						116.0,
						44.0,
						46.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "Sensitivity",
							"parameter_initial": [
								50.0
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Sensitivity",
							"parameter_mmax": 100.0,
							"parameter_mmin": 0.0,
							"parameter_shortname": "Sens",
							"parameter_type": 0,
							"parameter_unitstyle": 5
						}
					},
					"varname": "Sensitivity"
				}
			},
			{
				"box": {
					"activedialcolor": [
						0.28,
						0.84,
						0.96,
						1.0
					],
					"annotation": "Retrigger lockout after each note, so one hit only fires once.",
					"annotation_name": "Hold",
					"id": "obj-ctrl-hold",
					"maxclass": "live.dial",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						146,
						220.0,
						44.0,
						46.0
					],
					"presentation": 1,
					"presentation_rect": [
						146.0,
						116.0,
						44.0,
						46.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "Hold",
							"parameter_initial": [
								60.0
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Hold",
							"parameter_mmax": 1000.0,
							"parameter_mmin": 20.0,
							"parameter_shortname": "Hold",
							"parameter_type": 0,
							"parameter_unitstyle": 2,
							"parameter_exponent": 2.0
						}
					},
					"varname": "Hold"
				}
			},
			{
				"box": {
					"border": 0,
					"filename": "none",
					"id": "obj-strip",
					"maxclass": "v8ui",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						860.0,
						40.0,
						16.0,
						161.0
					],
					"presentation": 1,
					"presentation_rect": [
						208.0,
						4.0,
						16.0,
						161.0
					],
					"textfile": {
						"text": "var PANEL_NAMES = [\"MIDI Output Type\", \"MIDI Output Channel\", \"obj-lbl-note\", \"Note\", \"obj-lbl-chan\", \"MIDI Channel\", \"obj-lbl-len\", \"Note Length\", \"obj-lbl-velmin\", \"Velocity Low\", \"obj-lbl-velmax\", \"Velocity High\", \"obj-panel-midi\"];\n\n// Envelope Trigger collapsible \"MIDI To\" strip (like Envelope Follower's \"Audio Routing\" strip).\n// Draws a round arrow button and a vertical label. Clicking anywhere toggles the panel:\n// outlet 0 sends the new state (0 = collapsed, 1 = open) to the hidden \"MIDI To Panel\" live.text,\n// which resizes the device and shows/hides the panel widgets. `set_open` mirrors the saved state.\n\nmgraphics.init();\nmgraphics.relative_coords = 0;\nmgraphics.autofill = 0;\n\ninlets = 1;\noutlets = 1;\n\nvar LABEL = \"MIDI TO\";\nvar open = 0;\nvar lastWidth = -1;\n// Scripting names of the panel widgets; build_envtrig.py prepends `var PANEL_NAMES = [...]`.\nif (typeof PANEL_NAMES === \"undefined\") var PANEL_NAMES = [];\n\nfunction set_open(v) {\n    open = Number(v) > 0.5 ? 1 : 0;\n    mgraphics.redraw();\n}\n\n// Mirrors the `setwidth` value sent to live.thisdevice, for test_report.\nfunction set_width(w) {\n    lastWidth = Number(w);\n}\n\nfunction onclick() {\n    outlet(0, open ? 0 : 1);\n}\n\n// ---------- Test hook (global `receive envtrig-test`) ----------\n// Lets standalone Max and the Ableton MCP bridge drive the strip and read back the panel state:\n//   test_click  \u2014 same as a mouse click on the strip\n//   test_report \u2014 writes this instance's state to Global(\"envtrig_test\") as `report_<device id>` and `last`\n\nfunction test_click() {\n    onclick();\n}\n\nfunction deviceId() {\n    try {\n        if (typeof LiveAPI !== \"undefined\") return String(new LiveAPI(\"this_device\").id);\n    } catch (err) {}\n    return \"0\";\n}\n\nfunction test_report() {\n    var p = this.patcher;\n    var hidden = {};\n    for (var i = 0; i < PANEL_NAMES.length; i++) {\n        var obj = p ? p.getnamed(PANEL_NAMES[i]) : null;\n        hidden[PANEL_NAMES[i]] = obj ? (obj.hidden ? 1 : 0) : -1;\n    }\n    var toggle = p ? p.getnamed(\"MIDI To Panel\") : null;\n    var report = {\n        open: open,\n        toggle: toggle ? Number(toggle.getvalueof()) : -1,\n        width: lastWidth,\n        hidden: hidden,\n    };\n    // Plain string properties survive across v8 contexts; nested objects may not.\n    var g = new Global(\"envtrig_test\");\n    g[\"report_\" + deviceId()] = JSON.stringify(report);\n    g.last = JSON.stringify(report);\n}\n\nfunction paint() {\n    var s = mgraphics.size;\n    var w = (s && s.length > 1) ? s[0] : 16;\n    var h = (s && s.length > 1) ? s[1] : 161;\n    var cx = w / 2;\n    var cy = 10;\n\n    mgraphics.set_source_rgba(0.10, 0.11, 0.13, 1.0);\n    mgraphics.rectangle(0, 0, w, h);\n    mgraphics.fill();\n\n    // Round button with an arrow: right when collapsed (panel opens to the right), left when open.\n    mgraphics.set_source_rgba(open ? 0.96 : 0.82, open ? 0.66 : 0.86, open ? 0.25 : 0.90, 1.0);\n    mgraphics.arc(cx, cy, 6, 0, Math.PI * 2);\n    mgraphics.fill();\n    mgraphics.set_source_rgba(0.06, 0.07, 0.09, 1.0);\n    var dir = open ? -1 : 1;\n    mgraphics.move_to(cx - 2 * dir, cy - 3);\n    mgraphics.line_to(cx + 2.5 * dir, cy);\n    mgraphics.line_to(cx - 2 * dir, cy + 3);\n    mgraphics.close_path();\n    mgraphics.fill();\n\n    // Vertical label reading bottom-to-top, anchored near the bottom like Live's native strips.\n    mgraphics.select_font_face(\"Arial Bold\");\n    mgraphics.set_font_size(8.5);\n    mgraphics.set_source_rgba(open ? 0.96 : 0.70, open ? 0.66 : 0.76, open ? 0.25 : 0.82, 1.0);\n    mgraphics.save();\n    mgraphics.translate(cx + 3, h - 6);\n    mgraphics.rotate(-Math.PI / 2);\n    mgraphics.move_to(0, 0);\n    mgraphics.show_text(LABEL);\n    mgraphics.restore();\n\n    mgraphics.set_line_width(1);\n    mgraphics.set_source_rgba(0.22, 0.26, 0.32, 1.0);\n    mgraphics.rectangle(0.5, 0.5, w - 1, h - 1);\n    mgraphics.stroke();\n}\n",
						"filename": "none",
						"flags": 0,
						"embed": 1,
						"autowatch": 1
					}
				}
			},
			{
				"box": {
					"id": "obj-panel-toggle",
					"maxclass": "live.text",
					"mode": 1,
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"parameter_enable": 1,
					"patching_rect": [
						860.0,
						10.0,
						60.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"Closed",
								"Open"
							],
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_invisible": 1,
							"parameter_linknames": 1,
							"parameter_longname": "MIDI To Panel",
							"parameter_mmax": 1,
							"parameter_shortname": "MIDI To",
							"parameter_type": 2
						}
					},
					"text": "MIDI To",
					"texton": "MIDI To",
					"varname": "MIDI To Panel"
				}
			},
			{
				"box": {
					"id": "obj-view-toggle",
					"maxclass": "live.text",
					"mode": 1,
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						""
					],
					"parameter_enable": 1,
					"patching_rect": [
						860.0,
						160.0,
						60.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_enum": [
								"Envelope",
								"Scope"
							],
							"parameter_initial": [
								0
							],
							"parameter_initial_enable": 1,
							"parameter_invisible": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Graph View",
							"parameter_mmax": 1,
							"parameter_shortname": "View",
							"parameter_type": 2
						}
					},
					"text": "View",
					"texton": "View",
					"varname": "Graph View"
				}
			},
			{
				"box": {
					"activebgcolor": [
						0.06,
						0.075,
						0.095,
						1.0
					],
					"annotation": "Selects the track (or external MIDI port) that receives the fired notes, like External Instrument's MIDI To.",
					"annotation_name": "MIDI Output Type",
					"bordercolor": [
						0.42,
						0.36,
						0.26,
						1.0
					],
					"fontface": 1,
					"fontsize": 9.0,
					"hidden": 1,
					"id": "obj-route-type",
					"maxclass": "live.menu",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						700.0,
						100.0,
						102.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						232.0,
						10.0,
						102.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "MIDI Output Type",
							"parameter_enum": [
								"No Output",
								"-"
							],
							"parameter_info": "Selects the track (or external MIDI port) that receives the fired notes, like External Instrument's MIDI To.",
							"parameter_invisible": 2,
							"parameter_linknames": 1,
							"parameter_longname": "MIDI Output Type",
							"parameter_mmax": 1,
							"parameter_shortname": "MIDI To",
							"parameter_type": 2
						}
					},
					"textcolor": [
						0.96,
						0.66,
						0.25,
						1.0
					],
					"varname": "MIDI Output Type"
				}
			},
			{
				"box": {
					"activebgcolor": [
						0.06,
						0.075,
						0.095,
						1.0
					],
					"annotation": "Selects the input of the destination track (Track In, or a device inside it).",
					"annotation_name": "MIDI Output Channel",
					"bordercolor": [
						0.42,
						0.36,
						0.26,
						1.0
					],
					"fontface": 1,
					"fontsize": 9.0,
					"hidden": 1,
					"id": "obj-route-chan",
					"maxclass": "live.menu",
					"numinlets": 1,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						700.0,
						130.0,
						102.0,
						15.0
					],
					"presentation": 1,
					"presentation_rect": [
						232.0,
						27.0,
						102.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "MIDI Output Channel",
							"parameter_enum": [
								"-",
								"-"
							],
							"parameter_info": "Selects the input of the destination track (Track In, or a device inside it).",
							"parameter_invisible": 2,
							"parameter_linknames": 1,
							"parameter_longname": "MIDI Output Channel",
							"parameter_mmax": 1,
							"parameter_shortname": "MIDI Ch To",
							"parameter_type": 2
						}
					},
					"textcolor": [
						0.96,
						0.66,
						0.25,
						1.0
					],
					"varname": "MIDI Output Channel"
				}
			},
			{
				"box": {
					"fontface": 1,
					"fontname": "Arial Bold",
					"fontsize": 8.0,
					"id": "obj-lbl-note",
					"maxclass": "live.comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						232,
						15.0,
						44,
						13.0
					],
					"presentation": 1,
					"presentation_rect": [
						232.0,
						53.0,
						44.0,
						13.0
					],
					"text": "Note",
					"textcolor": [
						0.84,
						0.7,
						0.48,
						1.0
					],
					"textjustification": 0,
					"hidden": 1,
					"varname": "obj-lbl-note"
				}
			},
			{
				"box": {
					"activebgcolor": [
						0.06,
						0.075,
						0.095,
						1.0
					],
					"annotation": "MIDI note fired on each hit.",
					"annotation_name": "Note",
					"appearance": 0,
					"bordercolor": [
						0.22,
						0.27,
						0.33,
						1.0
					],
					"fontface": 1,
					"fontsize": 9.0,
					"id": "obj-ctrl-note",
					"maxclass": "live.numbox",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						278,
						275.0,
						56,
						15
					],
					"presentation": 1,
					"presentation_rect": [
						278.0,
						52.0,
						56.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "Note",
							"parameter_initial": [
								36
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Note",
							"parameter_mmax": 127,
							"parameter_mmin": 0,
							"parameter_shortname": "Note",
							"parameter_type": 1,
							"parameter_unitstyle": 8
						}
					},
					"textcolor": [
						0.96,
						0.66,
						0.25,
						1.0
					],
					"varname": "Note",
					"hidden": 1
				}
			},
			{
				"box": {
					"fontface": 1,
					"fontname": "Arial Bold",
					"fontsize": 8.0,
					"id": "obj-lbl-chan",
					"maxclass": "live.comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						232,
						15.0,
						44,
						13.0
					],
					"presentation": 1,
					"presentation_rect": [
						232.0,
						75.0,
						44.0,
						13.0
					],
					"text": "MIDI Ch",
					"textcolor": [
						0.84,
						0.7,
						0.48,
						1.0
					],
					"textjustification": 0,
					"hidden": 1,
					"varname": "obj-lbl-chan"
				}
			},
			{
				"box": {
					"activebgcolor": [
						0.06,
						0.075,
						0.095,
						1.0
					],
					"annotation": "MIDI channel of the fired notes.",
					"annotation_name": "MIDI Channel",
					"appearance": 0,
					"bordercolor": [
						0.22,
						0.27,
						0.33,
						1.0
					],
					"fontface": 1,
					"fontsize": 9.0,
					"id": "obj-ctrl-chan",
					"maxclass": "live.numbox",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						278,
						275.0,
						56,
						15
					],
					"presentation": 1,
					"presentation_rect": [
						278.0,
						74.0,
						56.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "MIDI Channel",
							"parameter_initial": [
								1
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "MIDI Channel",
							"parameter_mmax": 16,
							"parameter_mmin": 1,
							"parameter_shortname": "Ch",
							"parameter_type": 1,
							"parameter_unitstyle": 0
						}
					},
					"textcolor": [
						0.96,
						0.66,
						0.25,
						1.0
					],
					"varname": "MIDI Channel",
					"hidden": 1
				}
			},
			{
				"box": {
					"fontface": 1,
					"fontname": "Arial Bold",
					"fontsize": 8.0,
					"id": "obj-lbl-len",
					"maxclass": "live.comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						232,
						15.0,
						44,
						13.0
					],
					"presentation": 1,
					"presentation_rect": [
						232.0,
						97.0,
						44.0,
						13.0
					],
					"text": "Length",
					"textcolor": [
						0.84,
						0.7,
						0.48,
						1.0
					],
					"textjustification": 0,
					"hidden": 1,
					"varname": "obj-lbl-len"
				}
			},
			{
				"box": {
					"activebgcolor": [
						0.06,
						0.075,
						0.095,
						1.0
					],
					"annotation": "How long each fired note is held before its note-off.",
					"annotation_name": "Note Length",
					"appearance": 0,
					"bordercolor": [
						0.22,
						0.27,
						0.33,
						1.0
					],
					"fontface": 1,
					"fontsize": 9.0,
					"id": "obj-ctrl-len",
					"maxclass": "live.numbox",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						278,
						275.0,
						56,
						15
					],
					"presentation": 1,
					"presentation_rect": [
						278.0,
						96.0,
						56.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "Note Length",
							"parameter_initial": [
								100.0
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Note Length",
							"parameter_mmax": 2000.0,
							"parameter_mmin": 5.0,
							"parameter_shortname": "Length",
							"parameter_type": 0,
							"parameter_unitstyle": 2,
							"parameter_exponent": 2.0
						}
					},
					"textcolor": [
						0.96,
						0.66,
						0.25,
						1.0
					],
					"varname": "Note Length",
					"hidden": 1
				}
			},
			{
				"box": {
					"fontface": 1,
					"fontname": "Arial Bold",
					"fontsize": 8.0,
					"id": "obj-lbl-velmin",
					"maxclass": "live.comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						232,
						15.0,
						44,
						13.0
					],
					"presentation": 1,
					"presentation_rect": [
						232.0,
						119.0,
						44.0,
						13.0
					],
					"text": "Vel Lo",
					"textcolor": [
						0.84,
						0.7,
						0.48,
						1.0
					],
					"textjustification": 0,
					"hidden": 1,
					"varname": "obj-lbl-velmin"
				}
			},
			{
				"box": {
					"activebgcolor": [
						0.06,
						0.075,
						0.095,
						1.0
					],
					"annotation": "Velocity of a hit right at the threshold.",
					"annotation_name": "Velocity Low",
					"appearance": 0,
					"bordercolor": [
						0.22,
						0.27,
						0.33,
						1.0
					],
					"fontface": 1,
					"fontsize": 9.0,
					"id": "obj-ctrl-velmin",
					"maxclass": "live.numbox",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						278,
						275.0,
						56,
						15
					],
					"presentation": 1,
					"presentation_rect": [
						278.0,
						118.0,
						56.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "Velocity Low",
							"parameter_initial": [
								40
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Velocity Low",
							"parameter_mmax": 127,
							"parameter_mmin": 1,
							"parameter_shortname": "Vel Lo",
							"parameter_type": 1,
							"parameter_unitstyle": 0
						}
					},
					"textcolor": [
						0.96,
						0.66,
						0.25,
						1.0
					],
					"varname": "Velocity Low",
					"hidden": 1
				}
			},
			{
				"box": {
					"fontface": 1,
					"fontname": "Arial Bold",
					"fontsize": 8.0,
					"id": "obj-lbl-velmax",
					"maxclass": "live.comment",
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						232,
						15.0,
						44,
						13.0
					],
					"presentation": 1,
					"presentation_rect": [
						232.0,
						141.0,
						44.0,
						13.0
					],
					"text": "Vel Hi",
					"textcolor": [
						0.84,
						0.7,
						0.48,
						1.0
					],
					"textjustification": 0,
					"hidden": 1,
					"varname": "obj-lbl-velmax"
				}
			},
			{
				"box": {
					"activebgcolor": [
						0.06,
						0.075,
						0.095,
						1.0
					],
					"annotation": "Velocity of a hit at 0 dBFS.",
					"annotation_name": "Velocity High",
					"appearance": 0,
					"bordercolor": [
						0.22,
						0.27,
						0.33,
						1.0
					],
					"fontface": 1,
					"fontsize": 9.0,
					"id": "obj-ctrl-velmax",
					"maxclass": "live.numbox",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"",
						"float"
					],
					"parameter_enable": 1,
					"patching_rect": [
						278,
						275.0,
						56,
						15
					],
					"presentation": 1,
					"presentation_rect": [
						278.0,
						140.0,
						56.0,
						15.0
					],
					"saved_attribute_attributes": {
						"valueof": {
							"parameter_annotation_name": "Velocity High",
							"parameter_initial": [
								127
							],
							"parameter_initial_enable": 1,
							"parameter_linknames": 1,
							"parameter_longname": "Velocity High",
							"parameter_mmax": 127,
							"parameter_mmin": 1,
							"parameter_shortname": "Vel Hi",
							"parameter_type": 1,
							"parameter_unitstyle": 0
						}
					},
					"textcolor": [
						0.96,
						0.66,
						0.25,
						1.0
					],
					"varname": "Velocity High",
					"hidden": 1
				}
			},
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
						20.0,
						240.0,
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
						20.0,
						460.0,
						58.0,
						20.0
					],
					"text": "plugout~"
				}
			},
			{
				"box": {
					"code": "// Envelope Trigger \u2014 transient detector that fires MIDI notes from an audio track.\n// Audio passes through untouched (out1/out2). Detection runs on the mono sum:\n//   fast env  \u2014 instant attack, 15 ms release peak follower\n//   slow env  \u2014 60 ms one-pole baseline that lags behind the fast env on transients\n//   onset     \u2014 fast > threshold AND fast > slow * ratio, where ratio = (1 - sens) * 12 dB,\n//               only while armed and outside the `holdms` lockout\n//   capture   \u2014 2.5 ms window after the onset that records the peak for velocity\n//   fire      \u2014 gate high for holdms/2 (>= 10 ms so edge~ sees it at any vector size),\n//               velocity = velmin..velmax from the captured peak (threshold .. 0 dBFS)\n//   re-arm    \u2014 once the fast env falls below 70% of threshold or back near the baseline\n//\n// Outlets: out1/out2 audio thru, out3 gate (0/1), out4 velocity (1..127, held).\n//\n// Scope telemetry buffer (buffer~ #0-trigscope @samps 800, bound via `scope #0-trigscope`):\n//   every 64 samples:\n//     0: fast env peak   1: slow env   2: fire counter   3: rolling frame counter\n//     4: input peak      5: last fired velocity (1..127)\n//   oscilloscope ring, one block per 32 samples (256 blocks \u2248 186 ms at 44.1 kHz):\n//     6: next block index (write head, 0..255)\n//     32 + 3 * block + 0/1/2: mono min, mono max, onset-in-block flag\n//\n// GenExpr requires all Buffer/Param/History declarations before expression statements.\n// No variable is named e<digit>. Never name a Param `hold`: the lockout and gate\n// outputs silently stop working.\n\nBuffer scope(\"trigscope\");\n\nParam thr(-24.0);\nParam sens(0.5);\nParam holdms(60.0);\nParam velmin(40.0);\nParam velmax(127.0);\n\nHistory fast(0);\nHistory slow(0);\nHistory armed(1);\nHistory lock(0);\nHistory cap(0);\nHistory capPeak(0);\nHistory gateLeft(0);\nHistory vel(0);\nHistory fires(0);\nHistory tick(0);\nHistory rollCounter(0);\nHistory pkIn(0);\nHistory pkFast(0);\nHistory idleTicks(0);\nHistory blkCount(0);\nHistory blkMin(0);\nHistory blkMax(0);\nHistory blkFire(0);\nHistory head(0);\nHistory cacheSr(0);\nHistory cacheThr(1);\nHistory cacheSens(-1);\nHistory thrLin(0);\nHistory ratio(1);\nHistory relC(0);\nHistory slowC(0);\n\nsr = max(samplerate, 1);\n\nholdSamps = floor(clip(holdms, 20, 1000) * sr / 1000);\ncapSamps = max(floor(2.5 * sr / 1000), 1);\nvelLo = clip(velmin, 1, 127);\nvelHi = clip(max(velmax, velLo), 1, 127);\nthrDb = clip(thr, -60, 0);\n\n// pow/exp coefficients are recomputed only when their inputs change, not every sample.\nif (thr != cacheThr) {\n\tcacheThr = thr;\n\tthrLin = pow(10, thrDb / 20);\n}\nif (sens != cacheSens) {\n\tcacheSens = sens;\n\tratio = pow(10, (1 - clip(sens, 0, 1)) * 12 / 20);\n}\nif (sr != cacheSr) {\n\tcacheSr = sr;\n\trelC = exp(-1000 / (15 * sr));\n\tslowC = exp(-1000 / (60 * sr));\n}\n\n// 1. Envelopes on the mono sum.\nmono = 0.5 * (in1 + in2);\nax = abs(mono);\nnf = (ax > fast) ? ax : fast * relC;\nfast = (nf < 1e-12) ? 0 : nf;\nns = mix(fast, slow, slowC);\nslow = (ns < 1e-12) ? 0 : ns;\n\nlock = max(lock - 1, 0);\ngateLeft = max(gateLeft - 1, 0);\n\n// 2. Onset -> capture -> fire -> re-arm.\nonsetNow = 0;\nif (cap > 0) {\n\tcapPeak = max(capPeak, fast);\n\tcap = cap - 1;\n\tif (cap <= 0) {\n\t\tpkDb = 20 * log10(max(capPeak, 0.000001));\n\t\tt = clip((pkDb - thrDb) / max(-thrDb, 1), 0, 1);\n\t\tvel = clip(floor(velLo + t * (velHi - velLo) + 0.5), 1, 127);\n\t\tgateLeft = max(floor(holdSamps * 0.5), 1);\n\t\tlock = holdSamps;\n\t\tfires = wrap(fires + 1, 0, 100000);\n\t}\n} else if (armed > 0.5 && lock <= 0 && fast > thrLin && fast > slow * ratio) {\n\tcap = capSamps;\n\tcapPeak = fast;\n\tarmed = 0;\n\tonsetNow = 1;\n} else if (armed < 0.5 && (fast < thrLin * 0.7 || fast < slow * 1.12)) {\n\tarmed = 1;\n}\n\ngateOut = (gateLeft > 0) ? 1 : 0;\n\n// 3. Oscilloscope ring: min / max / onset flag per 32-sample block (onset, not the end of the\n//    velocity capture, so the tick lines up with the attack; every onset fires a note).\nblkMin = (blkCount == 0) ? mono : min(blkMin, mono);\nblkMax = (blkCount == 0) ? mono : max(blkMax, mono);\nblkFire = (blkCount == 0) ? onsetNow : max(blkFire, onsetNow);\nblkCount = blkCount + 1;\nif (blkCount >= 32) {\n\tblkCount = 0;\n\tif (idleTicks <= 4) {\n\t\tbase = 32 + head * 3;\n\t\tpoke(scope, clip(blkMin, -1.5, 1.5), base, 0);\n\t\tpoke(scope, clip(blkMax, -1.5, 1.5), base + 1, 0);\n\t\tpoke(scope, blkFire, base + 2, 0);\n\t\thead = wrap(head + 1, 0, 256);\n\t\tpoke(scope, head, 6, 0);\n\t}\n}\n\n// 4. Envelope telemetry every 64 samples, skipping buffer pokes once the device has settled in silence.\npkIn = max(pkIn, max(abs(in1), abs(in2)));\npkFast = max(pkFast, fast);\n\ntick = wrap(tick + 1, 0, 64);\nif (tick == 0) {\n\twindowSilent = (pkIn < 1e-6 && pkFast < 1e-6);\n\tidleTicks = windowSilent ? min(idleTicks + 1, 1000) : 0;\n\tif (idleTicks <= 4) {\n\t\trollCounter = wrap(rollCounter + 1, 0, 100000);\n\t\tpoke(scope, clip(pkFast, 0, 1.5), 0, 0);\n\t\tpoke(scope, clip(slow, 0, 1.5), 1, 0);\n\t\tpoke(scope, fires, 2, 0);\n\t\tpoke(scope, rollCounter, 3, 0);\n\t\tpoke(scope, clip(pkIn, 0, 1.5), 4, 0);\n\t\tpoke(scope, vel, 5, 0);\n\t}\n\tpkIn = 0;\n\tpkFast = 0;\n}\n\nout1 = fixnan(in1);\nout2 = fixnan(in2);\nout3 = gateOut;\nout4 = vel;\n",
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
						120.0,
						300.0,
						420.0,
						140.0
					],
					"varname": "envtrig"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-scope",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"float",
						"bang"
					],
					"patching_rect": [
						560.0,
						240.0,
						210.0,
						20.0
					],
					"text": "buffer~ #0-trigscope @samps 800"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-loadbang",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"bang"
					],
					"patching_rect": [
						560.0,
						300.0,
						60.0,
						20.0
					],
					"text": "loadbang"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-msg-ui-buf",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						560.0,
						330.0,
						180.0,
						20.0
					],
					"text": "setbuffer #0-trigscope"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-msg-gen-buf",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						560.0,
						360.0,
						180.0,
						20.0
					],
					"text": "scope #0-trigscope"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-thisdevice",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"bang",
						"int"
					],
					"patching_rect": [
						700.0,
						10.0,
						85.0,
						20.0
					],
					"text": "live.thisdevice"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-msg-init-routing",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						800.0,
						40.0,
						80.0,
						20.0
					],
					"text": "init_routing"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-msg-settype",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						820.0,
						100.0,
						80.0,
						20.0
					],
					"text": "settype $1"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-msg-setchan",
					"maxclass": "message",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						820.0,
						130.0,
						90.0,
						20.0
					],
					"text": "setchannel $1"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-open-store",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"int"
					],
					"patching_rect": [
						860.0,
						70.0,
						40.0,
						20.0
					],
					"text": "i 0"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-open-fan",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"int"
					],
					"patching_rect": [
						940.0,
						10.0,
						30.0,
						20.0
					],
					"text": "t i"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ui-open",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						940.0,
						40.0,
						100.0,
						20.0
					],
					"text": "prepend set_open"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-expr-width",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						940.0,
						70.0,
						130.0,
						20.0
					],
					"text": "expr 228 + $i1 * 114"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-prep-setwidth",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						940.0,
						100.0,
						100.0,
						20.0
					],
					"text": "prepend setwidth"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-eq-hidden",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1080.0,
						70.0,
						40.0,
						20.0
					],
					"text": "== 0"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-prep-hidden",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1080.0,
						100.0,
						90.0,
						20.0
					],
					"text": "prepend hidden"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-route-viz",
					"maxclass": "newobj",
					"numinlets": 3,
					"numoutlets": 3,
					"outlettype": [
						"",
						"",
						""
					],
					"patching_rect": [
						20.0,
						215.0,
						90.0,
						20.0
					],
					"text": "route thr view"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-view-store",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"int"
					],
					"patching_rect": [
						860.0,
						190.0,
						40.0,
						20.0
					],
					"text": "i 0"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ui-view",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						940.0,
						190.0,
						100.0,
						20.0
					],
					"text": "prepend set_view"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-set-thr",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						100.0,
						245.0,
						75.0,
						20.0
					],
					"text": "prepend set"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ui-thr",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						560.0,
						390.0,
						100.0,
						20.0
					],
					"text": "prepend set_thr"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ui-note",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						700.0,
						400.0,
						105.0,
						20.0
					],
					"text": "prepend set_note"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-edge",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"bang",
						"bang"
					],
					"patching_rect": [
						120.0,
						560.0,
						45.0,
						20.0
					],
					"text": "edge~"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-trig",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 2,
					"outlettype": [
						"bang",
						"bang"
					],
					"patching_rect": [
						120.0,
						586.0,
						40.0,
						20.0
					],
					"text": "t b b"
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
						"float"
					],
					"patching_rect": [
						170.0,
						612.0,
						65.0,
						20.0
					],
					"text": "snapshot~"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-note",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"int"
					],
					"patching_rect": [
						120.0,
						638.0,
						40.0,
						20.0
					],
					"text": "i 36"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-makenote",
					"maxclass": "newobj",
					"numinlets": 3,
					"numoutlets": 2,
					"outlettype": [
						"float",
						"float"
					],
					"patching_rect": [
						120.0,
						700.0,
						110.0,
						20.0
					],
					"text": "makenote 100 100"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-pack-note",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						120.0,
						730.0,
						60.0,
						20.0
					],
					"text": "pack 0 0"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-midiformat",
					"maxclass": "newobj",
					"numinlets": 7,
					"numoutlets": 1,
					"outlettype": [
						"int"
					],
					"patching_rect": [
						120.0,
						760.0,
						70.0,
						20.0
					],
					"text": "midiformat"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-midiout",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 0,
					"outlettype": [],
					"patching_rect": [
						120.0,
						790.0,
						55.0,
						20.0
					],
					"text": "midiout"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-r-test",
					"maxclass": "newobj",
					"numinlets": 0,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						860.0,
						210.0,
						120.0,
						20.0
					],
					"text": "receive envtrig-test"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-ui-width",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						940.0,
						130.0,
						105.0,
						20.0
					],
					"text": "prepend set_width"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-prep-thr",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						424.0,
						500.0,
						110.0,
						20.0
					],
					"text": "prepend thr"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-scale-sens",
					"maxclass": "newobj",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"float"
					],
					"patching_rect": [
						360.0,
						526.0,
						52.0,
						20.0
					],
					"text": "/ 100."
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-prep-sens",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						424.0,
						526.0,
						110.0,
						20.0
					],
					"text": "prepend sens"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-prep-hold",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						424.0,
						552.0,
						110.0,
						20.0
					],
					"text": "prepend holdms"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-prep-velmin",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						424.0,
						656.0,
						110.0,
						20.0
					],
					"text": "prepend velmin"
				}
			},
			{
				"box": {
					"fontname": "Arial Bold",
					"fontsize": 10.0,
					"id": "obj-prep-velmax",
					"maxclass": "newobj",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						424.0,
						682.0,
						110.0,
						20.0
					],
					"text": "prepend velmax"
				}
			},
			{
				"box": {
					"angle": 270.0,
					"background": 1,
					"bgcolor": [
						0.1,
						0.11,
						0.13,
						1.0
					],
					"border": 1,
					"bordercolor": [
						0.22,
						0.26,
						0.32,
						1.0
					],
					"grad1": [
						0.1,
						0.11,
						0.13,
						1.0
					],
					"grad2": [
						0.085,
						0.0935,
						0.1105,
						1.0
					],
					"id": "obj-panel-main",
					"maxclass": "panel",
					"mode": 0,
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						4.0,
						10.0,
						200.0,
						161.0
					],
					"presentation": 1,
					"presentation_rect": [
						4.0,
						4.0,
						200.0,
						161.0
					],
					"proportion": 0.39,
					"rounded": 6
				}
			},
			{
				"box": {
					"angle": 270.0,
					"background": 1,
					"bgcolor": [
						0.11,
						0.1,
						0.12,
						1.0
					],
					"border": 1,
					"bordercolor": [
						0.54,
						0.38,
						0.2,
						1.0
					],
					"grad1": [
						0.11,
						0.1,
						0.12,
						1.0
					],
					"grad2": [
						0.0935,
						0.085,
						0.102,
						1.0
					],
					"id": "obj-panel-midi",
					"maxclass": "panel",
					"mode": 0,
					"numinlets": 1,
					"numoutlets": 0,
					"patching_rect": [
						228.0,
						10.0,
						110.0,
						161.0
					],
					"presentation": 1,
					"presentation_rect": [
						228.0,
						4.0,
						110.0,
						161.0
					],
					"proportion": 0.39,
					"rounded": 6,
					"hidden": 1,
					"varname": "obj-panel-midi"
				}
			},
			{
				"box": {
					"id": "obj-t-load",
					"maxclass": "newobj",
					"text": "loadbang",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						"bang"
					],
					"patching_rect": [
						1200.0,
						40.0,
						60.0,
						20.0
					]
				}
			},
			{
				"box": {
					"id": "obj-t-delay",
					"maxclass": "newobj",
					"text": "delay 2000",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						"bang"
					],
					"patching_rect": [
						1200.0,
						70.0,
						70.0,
						20.0
					]
				}
			},
			{
				"box": {
					"id": "obj-t-run",
					"maxclass": "message",
					"text": "run",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1200.0,
						100.0,
						35.0,
						20.0
					]
				}
			},
			{
				"box": {
					"id": "obj-t-probe",
					"maxclass": "newobj",
					"text": "v8 /Users/mrwilson/software/ableton/tests/envtrig_ui_probe.js",
					"numinlets": 1,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1200.0,
						130.0,
						300.0,
						20.0
					]
				}
			},
			{
				"box": {
					"id": "obj-t-quit",
					"maxclass": "message",
					"text": "; max quit",
					"numinlets": 2,
					"numoutlets": 1,
					"outlettype": [
						""
					],
					"patching_rect": [
						1200.0,
						160.0,
						70.0,
						20.0
					]
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
						"obj-loadbang",
						0
					],
					"destination": [
						"obj-msg-ui-buf",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-loadbang",
						0
					],
					"destination": [
						"obj-msg-gen-buf",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-msg-ui-buf",
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
						"obj-msg-gen-buf",
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
						"obj-thisdevice",
						0
					],
					"destination": [
						"obj-msg-init-routing",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-msg-init-routing",
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
						"obj-thisdevice",
						0
					],
					"destination": [
						"obj-open-store",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-panel-toggle",
						0
					],
					"destination": [
						"obj-open-store",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-panel-toggle",
						0
					],
					"destination": [
						"obj-open-fan",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-open-store",
						0
					],
					"destination": [
						"obj-open-fan",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-viz",
						1
					],
					"destination": [
						"obj-route-type",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-viz",
						2
					],
					"destination": [
						"obj-route-chan",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-route-type",
						0
					],
					"destination": [
						"obj-msg-settype",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-route-chan",
						0
					],
					"destination": [
						"obj-msg-setchan",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-msg-settype",
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
						"obj-msg-setchan",
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
						"obj-strip",
						0
					],
					"destination": [
						"obj-panel-toggle",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-open-fan",
						0
					],
					"destination": [
						"obj-ui-open",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ui-open",
						0
					],
					"destination": [
						"obj-strip",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-open-fan",
						0
					],
					"destination": [
						"obj-expr-width",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-expr-width",
						0
					],
					"destination": [
						"obj-prep-setwidth",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-setwidth",
						0
					],
					"destination": [
						"obj-thisdevice",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-open-fan",
						0
					],
					"destination": [
						"obj-eq-hidden",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-eq-hidden",
						0
					],
					"destination": [
						"obj-prep-hidden",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-viz",
						0
					],
					"destination": [
						"obj-route-viz",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-route-viz",
						1
					],
					"destination": [
						"obj-view-toggle",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-view-toggle",
						0
					],
					"destination": [
						"obj-view-store",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-view-toggle",
						0
					],
					"destination": [
						"obj-ui-view",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-thisdevice",
						0
					],
					"destination": [
						"obj-view-store",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-view-store",
						0
					],
					"destination": [
						"obj-ui-view",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ui-view",
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
						"obj-route-viz",
						0
					],
					"destination": [
						"obj-prep-thr",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-route-viz",
						0
					],
					"destination": [
						"obj-set-thr",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-set-thr",
						0
					],
					"destination": [
						"obj-ctrl-thr",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-thr",
						0
					],
					"destination": [
						"obj-ui-thr",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ui-thr",
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
						"obj-ctrl-note",
						0
					],
					"destination": [
						"obj-note",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-note",
						0
					],
					"destination": [
						"obj-ui-note",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ui-note",
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
						2
					],
					"destination": [
						"obj-edge",
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
						"obj-snap",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-edge",
						0
					],
					"destination": [
						"obj-trig",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-trig",
						1
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
						"obj-trig",
						0
					],
					"destination": [
						"obj-note",
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
						"obj-makenote",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-note",
						0
					],
					"destination": [
						"obj-makenote",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-makenote",
						0
					],
					"destination": [
						"obj-pack-note",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-makenote",
						1
					],
					"destination": [
						"obj-pack-note",
						1
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-pack-note",
						0
					],
					"destination": [
						"obj-midiformat",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-midiformat",
						0
					],
					"destination": [
						"obj-midiout",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-chan",
						0
					],
					"destination": [
						"obj-midiformat",
						6
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-len",
						0
					],
					"destination": [
						"obj-makenote",
						2
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-route-type",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-route-chan",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-lbl-note",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-ctrl-note",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-lbl-chan",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-ctrl-chan",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-lbl-len",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-ctrl-len",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-lbl-velmin",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-ctrl-velmin",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-lbl-velmax",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-ctrl-velmax",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hidden",
						0
					],
					"destination": [
						"obj-panel-midi",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-r-test",
						0
					],
					"destination": [
						"obj-strip",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-expr-width",
						0
					],
					"destination": [
						"obj-ui-width",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ui-width",
						0
					],
					"destination": [
						"obj-strip",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-ctrl-thr",
						0
					],
					"destination": [
						"obj-prep-thr",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-thr",
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
						"obj-ctrl-sens",
						0
					],
					"destination": [
						"obj-scale-sens",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-scale-sens",
						0
					],
					"destination": [
						"obj-prep-sens",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-sens",
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
						"obj-ctrl-hold",
						0
					],
					"destination": [
						"obj-prep-hold",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-hold",
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
						"obj-ctrl-velmin",
						0
					],
					"destination": [
						"obj-prep-velmin",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-velmin",
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
						"obj-ctrl-velmax",
						0
					],
					"destination": [
						"obj-prep-velmax",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-prep-velmax",
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
						"obj-t-load",
						0
					],
					"destination": [
						"obj-t-delay",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-t-delay",
						0
					],
					"destination": [
						"obj-t-run",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-t-run",
						0
					],
					"destination": [
						"obj-t-probe",
						0
					]
				}
			},
			{
				"patchline": {
					"source": [
						"obj-t-probe",
						0
					],
					"destination": [
						"obj-t-quit",
						0
					]
				}
			}
		],
		"parameters": {},
		"dependency_cache": [],
		"autosave": 0
	}
}
