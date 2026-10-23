// Envelope Trigger graph + "MIDI To" routing controller.
// src/envtrig_config.js is prepended at build time.
// Two views, switched by the [envelope | scope] toggle in the HUD:
//   envelope — scrolling fast envelope (dB scale) and slow baseline, ~3.6 s
//   scope    — oscilloscope of the mono input (linear, min/max per 32-sample block), ~186 ms
// Both draw the draggable threshold, thin full-height fired-note ticks and a flashing velocity
// LED on the right edge, with the MIDI To destination in the HUD.
//
// Outlet 0: ["thr", dB] from threshold drags, ["view", 0|1] from the view toggle.
// Outlet 1: messages for the "MIDI Output Type" live.menu.
// Outlet 2: messages for the "MIDI Output Channel" live.menu.
// The routing itself lives on this device's LOM DeviceIO (`this_device midi_outputs 0`),
// so Live saves it with the set; the menus only mirror it.

mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 3;

var COLOR = [0.28, 0.84, 0.96];
var AMBER = [0.96, 0.66, 0.25];

var scopeBuf = null;
var scopeTask = null;

var histFast = [];
var histSlow = [];
var histFire = [];
var flash = 0;
var lastFires = -1;
var lastVel = 0;
var idleFrames = 0;
var faceDirty = 0;
var hoverZone = -1;
var hoverSeen = -1;

var scopeMin = [];
var scopeMax = [];
var scopeFire = [];
var lastHead = -1;
var view = 0; // 0 = envelope, 1 = oscilloscope

var thrDb = -24.0;
var note = 36;
var dragging = false;

var lomTypes = null;
var lomChannels = null;
var lomType = null;
var lomChannel = null;
var routingName = "No Output";

function initHistory(demo) {
    histFast = [];
    histSlow = [];
    histFire = [];
    for (var i = 0; i < SCOPE_COLS; i++) {
        if (!demo) {
            histFast.push(0);
            histSlow.push(0);
            histFire.push(0);
            continue;
        }
        var local = (i + 3) % 28;
        var amp = 0.78 * (0.85 + 0.15 * Math.sin(i * 0.7));
        var f = amp * Math.exp(-local * 0.16) + 0.004;
        histFast.push(f);
        var prev = i > 0 ? histSlow[i - 1] : f * 0.4;
        histSlow.push(prev + (f - prev) * 0.12);
        histFire.push(local === 1 && linToDb(f) > thrDb ? velocityFromPeak(f, thrDb, 40, 127) : 0);
    }
    scopeMin = [];
    scopeMax = [];
    scopeFire = [];
    for (var k = 0; k < SCOPE_BLOCKS; k++) {
        var local2 = (k + 20) % 85;
        var a = demo ? 0.82 * Math.exp(-local2 * 0.07) * Math.abs(Math.sin(k * 0.9 + 0.3)) + 0.01 : 0;
        scopeMin.push(-a);
        scopeMax.push(a * 0.94);
        scopeFire.push(demo && local2 === 0 ? 1 : 0);
    }
    if (demo) {
        flash = 0.9;
        lastVel = 112;
    }
}

initHistory(false);

function preview() {
    initHistory(true);
}

function setbuffer(name) {
    if (!name) return;
    scopeBuf = new Buffer("" + name);
}

function set_thr(db) {
    thrDb = clamp(Number(db), THR_MIN_DB, THR_MAX_DB);
    faceDirty = 1;
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function set_view(v) {
    view = Number(v) > 0.5 ? 1 : 0;
    lastHead = -1; // re-read the ring on the next frame
    faceDirty = 1;
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function set_note(n) {
    note = clamp(Math.round(Number(n) || 0), 0, 127);
    faceDirty = 1;
    mgraphics.redraw();
}

// ---------- "MIDI To" routing (LOM DeviceIO) ----------

// Must be triggered by live.thisdevice, not loadbang: the LOM is not ready before that.
// The same bang schedules the deferred gen~ (init_dsp is the other entry).
function init_routing() {
    etDspSchedule();
    if (typeof LiveAPI === "undefined") return;
    lomTypes = new LiveAPI(onTypes, ROUTING_PATH);
    lomTypes.property = "available_routing_types";
    lomChannels = new LiveAPI(onChannels, ROUTING_PATH);
    lomChannels.property = "available_routing_channels";
    lomType = new LiveAPI(onType, ROUTING_PATH);
    lomType.property = "routing_type";
    lomChannel = new LiveAPI(onChannel, ROUTING_PATH);
    lomChannel.property = "routing_channel";
}

function onTypes(args) {
    var types = lomValue(args, "available_routing_types");
    if (!types) return;
    outlet(1, ["_parameter_range"].concat(routingTypeRange(types)));
    if (lomType) onType(lomType.get("routing_type"));
}

function onChannels(args) {
    var chans = lomValue(args, "available_routing_channels");
    if (!chans) return;
    var st = routingChannelState(chans);
    outlet(2, ["_parameter_range"].concat(st.range));
    outlet(2, ["active", st.active]);
    outlet(2, ["ignoreclick", st.active ? 0 : 1]);
    if (st.active && lomChannel) onChannel(lomChannel.get("routing_channel"));
}

function onType(args) {
    var t = lomValue(args, "routing_type");
    if (!t) return;
    routingName = String(t.display_name);
    outlet(1, ["setsymbol", routingName]);
    mgraphics.redraw();
}

function onChannel(args) {
    var c = lomValue(args, "routing_channel");
    if (!c || !c.display_name) return;
    outlet(2, ["setsymbol", String(c.display_name)]);
}

function settype(i) {
    if (!lomTypes || !lomType) return;
    var types = lomValue(lomTypes.get("available_routing_types"), "available_routing_types");
    var idx = Math.round(Number(i) || 0);
    if (types && types[idx]) lomType.set("routing_type", types[idx]);
}

function setchannel(i) {
    if (!lomChannels || !lomChannel) return;
    var chans = lomValue(lomChannels.get("available_routing_channels"), "available_routing_channels");
    var idx = Math.round(Number(i) || 0);
    if (chans && chans.length > 1 && chans[idx]) lomChannel.set("routing_channel", chans[idx]);
}

// ---------- Scope telemetry ----------

function sampleAt(chunk, idx) {
    if (!chunk || !chunk.length || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (v === v && v > 0) ? v : 0;
}

// One buffer slot. Unlike sampleAt, 0 is a real value (the scope write head wraps through 0).
function peekNum(off) {
    var chunk = scopeBuf.peek(1, off, 1);
    if (typeof chunk === "number") return chunk === chunk ? chunk : 0;
    if (!chunk || !chunk.length) return 0;
    var v = chunk[0];
    return (typeof v === "number" && v === v) ? v : 0;
}

function numAt(chunk, idx) {
    if (typeof chunk === "number") return idx === 0 && chunk === chunk ? chunk : 0;
    if (!chunk || idx >= chunk.length) return 0;
    var v = chunk[idx];
    return (typeof v === "number" && v === v) ? v : 0;
}

function pullScope() {
    if (!scopeBuf) return false;
    // Asleep in silence: read only the slots that can change the picture (fast env, fire
    // counter, write head). The roll counter in slot 3 keeps moving on a silent track so the
    // deferred gen can be confirmed; it is not a reason to redraw. Skip the ring copy and the
    // history shift, and skip mgraphics.redraw(), unless a parameter, drag or hover changed.
    if (idleFrames > SCOPE_COLS + 4 && flash === 0 && !dragging) {
        var f0 = clamp(peekNum(0), 0, 1.5);
        var fires0 = peekNum(2);
        var head0 = Math.round(peekNum(6)) % SCOPE_BLOCKS;
        var fired0 = lastFires >= 0 && fires0 !== lastFires;
        if (f0 <= 0.0001 && !fired0 && head0 === lastHead) {
            if (!faceDirty && hoverZone === hoverSeen) return false;
            faceDirty = 0;
            hoverSeen = hoverZone;
            return true;
        }
    }
    faceDirty = 0;
    var chunk = scopeBuf.peek(1, 0, 7);
    var f = clamp(sampleAt(chunk, 0), 0, 1.5);
    var s = clamp(sampleAt(chunk, 1), 0, 1.5);
    var fires = sampleAt(chunk, 2);
    var fireVel = 0;
    if (lastFires >= 0 && fires !== lastFires) {
        fireVel = clamp(sampleAt(chunk, 5), 1, 127);
        lastVel = fireVel;
        flash = 1.0;
    }
    lastFires = fires;
    flash *= 0.82;
    if (flash < 0.01) flash = 0;

    histFast.shift();
    histFast.push(f);
    histSlow.shift();
    histSlow.push(s);
    histFire.shift();
    histFire.push(fireVel);

    var head = pullRing(Math.round(numAt(chunk, 6)) % SCOPE_BLOCKS);

    // roll (slot 3) is intentionally not part of this: it advances in silence.
    var quiet = f <= 0.0001 && fireVel === 0 && flash === 0 && head === lastHead;
    lastHead = head;
    hoverSeen = hoverZone;
    if (quiet) {
        idleFrames++;
        // Once the whole history has scrolled flat, stop redrawing at 30 fps.
        if (idleFrames > SCOPE_COLS + 4) return false;
    } else {
        idleFrames = 0;
    }
    return true;
}

// Reads the oscilloscope ring (oldest block first, starting at the write head). The 7-sample
// header already supplied `head`; the 768-sample ring is copied only while the scope is showing
// and only when that head has moved.
function pullRing(head) {
    if (head === lastHead || view !== 1) return head;
    var ring = scopeBuf.peek(1, SCOPE_RING_OFFSET, SCOPE_BLOCKS * 3);
    if (!ring || !ring.length) return head;
    for (var i = 0; i < SCOPE_BLOCKS; i++) {
        var b = ((head + i) % SCOPE_BLOCKS) * 3;
        var lo = ring[b];
        var hi = ring[b + 1];
        scopeMin[i] = (lo === lo) ? clamp(lo, -1, 1) : 0;
        scopeMax[i] = (hi === hi) ? clamp(hi, -1, 1) : 0;
        scopeFire[i] = ring[b + 2] > 0.5 ? 1 : 0;
    }
    return head;
}

function loadbang() {
    if (typeof Task === "function") {
        scopeTask = new Task(function () {
            if (pullScope()) mgraphics.redraw();
        }, this);
        scopeTask.interval = 33;
        scopeTask.repeat();
    }
    mgraphics.redraw();
}

// ---------- Geometry & interaction ----------

function bounds() {
    var s = mgraphics.size;
    var w = (s && s.length > 1) ? s[0] : 192;
    var h = (s && s.length > 1) ? s[1] : 104;
    var ledW = 16;
    var x = 3;
    var y = 15;
    return { w: w, h: h, x: x, y: y, pw: w - x - ledW - 6, ph: h - y - 3, ledX: w - ledW - 3, ledW: ledW };
}

function plotY(b, lin) {
    return b.y + b.ph - linToPlot01(lin) * b.ph;
}

// [envelope | scope] toggle in the HUD's top-left corner, two 14 px segments.
function viewButton() {
    return { x: 3, y: 1, w: 28, h: 11 };
}

function onclick(x, y) {
    var vb = viewButton();
    if (x >= vb.x && x <= vb.x + vb.w && y >= vb.y && y <= vb.y + vb.h + 1) {
    view = x < vb.x + vb.w / 2 ? 0 : 1;
    lastHead = -1;
    faceDirty = 1;
    outlet(0, ["view", view]);
        dragging = false;
        if (!scopeBuf) initHistory(true);
        mgraphics.redraw();
        return;
    }
    dragging = true;
    faceDirty = 1;
    ondrag(x, y);
}

function ondrag(x, y, but) {
    if (!dragging) return;
    if (but === 0) {
        dragging = false;
        return;
    }
    var b = bounds();
    if (view === 1) {
        // Scope: linear amplitude, threshold mirrored around the centre line.
        var amp = clamp(Math.abs(y - (b.y + b.ph / 2)) / Math.max(1, b.ph / 2), 0.001, 1);
        thrDb = Math.round(clamp(linToDb(amp), THR_MIN_DB, THR_MAX_DB) * 10) / 10;
    } else {
        var v01 = clamp((b.y + b.ph - y) / Math.max(1, b.ph), 0, 1);
        thrDb = Math.round(plot01ToDb(v01) * 10) / 10;
    }
    outlet(0, ["thr", thrDb]);
    faceDirty = 1;
    if (!scopeBuf) initHistory(true);
    mgraphics.redraw();
}

function zoneAt(x, y) {
    var vb = viewButton();
    if (x >= vb.x && x <= vb.x + vb.w && y >= vb.y && y <= vb.y + vb.h + 1) return 1;
    return 0;
}

// Hover only marks the face dirty when the zone changes, so an asleep graph is not redrawn
// on every mouse move.
function onidle(x, y) {
    var z = zoneAt(x, y);
    if (z === hoverZone) return;
    hoverZone = z;
    faceDirty = 1;
}

function onidleout() {
    if (hoverZone === 0 && !faceDirty) {
        hoverZone = 0;
        return;
    }
    hoverZone = 0;
    faceDirty = 1;
}

// ---------- Drawing ----------

// Small dark backing so labels stay legible over the traces.
function labelPill(x, y, txt, col) {
    var w = txt.length * 4.3 + 4;
    mgraphics.set_source_rgba(0.047, 0.059, 0.075, 0.82);
    mgraphics.rectangle(x, y, w, 10);
    mgraphics.fill();
    mgraphics.set_source_rgba(col[0], col[1], col[2], 0.95);
    mgraphics.move_to(x + 2, y + 8);
    mgraphics.show_text(txt);
}

// Shown only once DSP creation has started (or failed). A fresh paint — the static preview —
// has createdAt 0 and no error, so it stays clear.
function drawDspStatus(b) {
    if (etDsp.ready || !(etDsp.createdAt > 0 || etDsp.error)) return;
    var failed = !!etDsp.error;
    var label = failed ? ("DSP failed: " + String(etDsp.error)) : "DSP loading...";
    if (label.length > 28) label = label.substring(0, 27) + ".";
    var col = failed ? [0.95, 0.38, 0.32] : AMBER;
    labelPill(b.x + 2, b.y + b.ph - 12, label, col);
}

function drawEnvelope(b) {
    var step = b.pw / (SCOPE_COLS - 1);

    // Fast envelope silhouette + trace
    mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.22);
    mgraphics.move_to(b.x, b.y + b.ph);
    for (var i = 0; i < SCOPE_COLS; i++) mgraphics.line_to(b.x + i * step, plotY(b, histFast[i]));
    mgraphics.line_to(b.x + b.pw, b.y + b.ph);
    mgraphics.close_path();
    mgraphics.fill();

    mgraphics.set_line_width(1.3);
    mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.95);
    for (var j = 0; j < SCOPE_COLS; j++) {
        if (j === 0) mgraphics.move_to(b.x, plotY(b, histFast[j]));
        else mgraphics.line_to(b.x + j * step, plotY(b, histFast[j]));
    }
    mgraphics.stroke();

    // Slow baseline
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.80, 0.84, 0.90, 0.35);
    for (var k = 0; k < SCOPE_COLS; k++) {
        if (k === 0) mgraphics.move_to(b.x, plotY(b, histSlow[k]));
        else mgraphics.line_to(b.x + k * step, plotY(b, histSlow[k]));
    }
    mgraphics.stroke();

    var ticks = [];
    for (var m = 0; m < SCOPE_COLS; m++) if (histFire[m] > 0) ticks.push(b.x + m * step);
    return ticks;
}

function drawScope(b) {
    var mid = b.y + b.ph / 2;
    var half = b.ph / 2 - 1;
    var cols = Math.max(2, Math.floor(b.pw));
    var per = SCOPE_BLOCKS / cols;
    var ticks = [];

    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.18, 0.22, 0.28, 1.0);
    mgraphics.move_to(b.x, mid);
    mgraphics.line_to(b.x + b.pw, mid);
    mgraphics.stroke();

    // Min/max waveform envelope, one column per pixel, filled as one polygon
    var tops = [];
    var bots = [];
    for (var c = 0; c < cols; c++) {
        var from = Math.floor(c * per);
        var to = Math.max(from + 1, Math.floor((c + 1) * per));
        var lo = 0;
        var hi = 0;
        var fired = 0;
        for (var i = from; i < to && i < SCOPE_BLOCKS; i++) {
            if (scopeMin[i] < lo) lo = scopeMin[i];
            if (scopeMax[i] > hi) hi = scopeMax[i];
            if (scopeFire[i]) fired = 1;
        }
        tops.push(Math.min(mid - hi * half, mid - 0.5));
        bots.push(Math.max(mid - lo * half, mid + 0.5));
        if (fired) ticks.push(b.x + c + 0.5);
    }
    mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.85);
    mgraphics.move_to(b.x, tops[0]);
    for (var u = 1; u < cols; u++) mgraphics.line_to(b.x + u, tops[u]);
    for (var d = cols - 1; d >= 0; d--) mgraphics.line_to(b.x + d, bots[d]);
    mgraphics.close_path();
    mgraphics.fill();
    return ticks;
}

// Segmented [envelope | scope] toggle with vector icons; the active segment is filled.
function drawViewButton() {
    var vb = viewButton();
    var segW = vb.w / 2;
    for (var sIdx = 0; sIdx < 2; sIdx++) {
        var sx = vb.x + sIdx * segW;
        var on = sIdx === view;
        mgraphics.set_source_rgba(on ? COLOR[0] : 0.12, on ? COLOR[1] : 0.15, on ? COLOR[2] : 0.19, on ? 0.9 : 1.0);
        mgraphics.rectangle(sx, vb.y, segW - 1, vb.h);
        mgraphics.fill();
        var ic = on ? [0.04, 0.06, 0.08] : [0.62, 0.70, 0.78];
        mgraphics.set_source_rgba(ic[0], ic[1], ic[2], 1.0);
        mgraphics.set_line_width(1.1);
        var x0 = sx + 2.5;
        var x1 = sx + segW - 3.5;
        var yb = vb.y + vb.h - 2.5;
        var yt = vb.y + 2.5;
        if (sIdx === 0) {
            // Envelope: sharp attack, exponential-ish decay
            mgraphics.move_to(x0, yb);
            mgraphics.line_to(x0 + 2, yt);
            mgraphics.line_to(x0 + 4.5, vb.y + 6);
            mgraphics.line_to(x1, yb);
        } else {
            // Scope: one sine cycle
            var ym = vb.y + vb.h / 2;
            for (var q = 0; q <= 8; q++) {
                var px = x0 + (x1 - x0) * q / 8;
                var py = ym - Math.sin(q / 8 * Math.PI * 2) * (vb.h / 2 - 2.5);
                if (q === 0) mgraphics.move_to(px, py);
                else mgraphics.line_to(px, py);
            }
        }
        mgraphics.stroke();
    }
}

function paint() {
    if (!scopeBuf && histFast[SCOPE_COLS - 1] === 0 && histFast[0] === 0) initHistory(true);

    var b = bounds();
    mgraphics.set_source_rgba(0.047, 0.059, 0.075, 1.0);
    mgraphics.rectangle(0, 0, b.w, b.h);
    mgraphics.fill();

    mgraphics.set_source_rgba(0.065, 0.08, 0.10, 1.0);
    mgraphics.rectangle(b.x, b.y, b.pw, b.ph);
    mgraphics.fill();

    // Threshold position(s): one line on the dB envelope, mirrored ± lines on the linear scope.
    var thrLines = [];
    if (view === 1) {
        var amp = dbToLin(thrDb) * (b.ph / 2 - 1);
        thrLines = [b.y + b.ph / 2 - amp, b.y + b.ph / 2 + amp];
    } else {
        thrLines = [b.y + b.ph - dbToPlot01(thrDb) * b.ph];
        mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.05);
        mgraphics.rectangle(b.x, b.y, b.pw, thrLines[0] - b.y);
        mgraphics.fill();
    }

    var ticks = view === 1 ? drawScope(b) : drawEnvelope(b);

    // Fired-note ticks: thin and always full height
    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(1.0, 0.86, 0.45, 0.9);
    for (var t = 0; t < ticks.length; t++) {
        var tx = Math.round(ticks[t]) + 0.5;
        mgraphics.move_to(tx, b.y);
        mgraphics.line_to(tx, b.y + b.ph);
    }
    mgraphics.stroke();

    // Draggable threshold (dashed)
    mgraphics.set_line_width(1.2);
    mgraphics.set_source_rgba(AMBER[0], AMBER[1], AMBER[2], 0.95);
    for (var li = 0; li < thrLines.length; li++) {
        for (var gx = b.x; gx < b.x + b.pw; gx += 8) {
            mgraphics.move_to(gx, thrLines[li]);
            mgraphics.line_to(Math.min(gx + 4, b.x + b.pw), thrLines[li]);
        }
    }
    mgraphics.stroke();

    mgraphics.select_font_face("Arial Bold");
    mgraphics.set_font_size(7.5);
    var thrTxt = Math.round(thrDb) + "dB";
    var pillW = thrTxt.length * 4.3 + 4;
    labelPill(b.x + b.pw - pillW - 2, clamp(thrLines[0] - 11, b.y + 2, b.y + b.ph - 11), thrTxt, AMBER);

    // Velocity LED
    mgraphics.set_source_rgba(0.08, 0.10, 0.13, 1.0);
    mgraphics.rectangle(b.ledX, b.y, b.ledW, b.ph);
    mgraphics.fill();
    if (flash > 0) {
        mgraphics.set_source_rgba(COLOR[0], COLOR[1], COLOR[2], 0.25 + 0.75 * flash);
        var fillH = Math.max(3, (lastVel / 127) * (b.ph - 4));
        mgraphics.rectangle(b.ledX + 2, b.y + b.ph - 2 - fillH, b.ledW - 4, fillH);
        mgraphics.fill();
    }

    // HUD: view toggle, destination, then note + last velocity on the right
    drawViewButton();
    mgraphics.set_font_size(8);
    var dest = routingName.length > 18 ? routingName.substring(0, 17) + "." : routingName;
    var noOut = routingName === "No Output";
    mgraphics.set_source_rgba(noOut ? 0.96 : 0.36, noOut ? 0.52 : 0.84, noOut ? 0.40 : 0.66, 0.95);
    mgraphics.move_to(35, 10);
    mgraphics.show_text("> " + dest);

    var info = noteName(note) + (lastVel > 0 ? " " + Math.round(lastVel) : "");
    mgraphics.set_source_rgba(1.0, 0.86, 0.45, 0.92);
    mgraphics.move_to(b.w - 4 - info.length * 4.6, 10);
    mgraphics.show_text(info);

    drawDspStatus(b);

    mgraphics.set_line_width(1);
    mgraphics.set_source_rgba(0.18, 0.22, 0.28, 1.0);
    mgraphics.rectangle(0.5, 0.5, b.w - 1, b.h - 1);
    mgraphics.stroke();
}
