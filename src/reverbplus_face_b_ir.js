// Reverb+ face `b`: the Convolution IR box under the display (scripts/reverbplus_layouts/b.py), two tiny v8uis sharing
// this script; the layout prepends `var RBI_MODE = "name" | "btn"`.
//   name  66 x 15, ignoreclick: the impulse response's file name in a dark field (the transparent live.drop `IR File`
//         sits in front of it and takes the dropped file); amber hint / status text while there is none
//   btn   30 x 15: folder glyph = browse (rpCmd browse_ir), x = clear (rpCmd clear_ir)
// Build order: config + face_common + this file.

function rbiFit(str, w, size) {
    var s = String(str);
    if (rpTextW(s, size, true) <= w) return s;
    while (s.length > 2 && rpTextW(s + "…", size, true) > w) s = s.substring(0, s.length - 1);
    return s + "…";
}

function paint() {
    var w = mgraphics.size[0];
    var h = mgraphics.size[1];
    rpRefreshTheme();
    if (RBI_MODE === "name") {
        rpColor(RPC.frame, 0.55);
        mgraphics.rectangle_rounded(0, 0, w, h, 3, 3);
        mgraphics.fill();
        rpColor(RPC.frame, 1);
        mgraphics.set_line_width(1);
        mgraphics.rectangle_rounded(0.5, 0.5, w - 1, h - 1, 3, 3);
        mgraphics.stroke();
        var ir = rpState.ir;
        var busy = ir.status === "loading" || ir.status === "processing";
        var txt = busy ? "loading…" : (ir.loaded ? (ir.name || "impulse response") : "drop an IR");
        rpText(rbiFit(txt, w - 8, 8), 4, h - 4.5, 8, ir.loaded && !busy ? RPC.text : RPC.amber, true);
        return;
    }
    var half = w / 2;
    var i;
    for (i = 0; i < 2; i++) {
        rpColor(RPC.frame, 0.55);
        mgraphics.rectangle_rounded(i * half + 1, 0, half - 2, h, 3, 3);
        mgraphics.fill();
    }
    // folder = browse
    rpColor(RPC.dim, 1);
    mgraphics.set_line_width(1.1);
    mgraphics.rectangle(half / 2 - 5.5, 5, 11, 6.5);
    mgraphics.stroke();
    mgraphics.move_to(half / 2 - 5.5, 5); mgraphics.line_to(half / 2 - 3, 3); mgraphics.line_to(half / 2 - 0.5, 3); mgraphics.line_to(half / 2 + 0.5, 5);
    mgraphics.stroke();
    // x = clear
    var cx = half + half / 2;
    rpColor(rpState.ir.loaded ? RPC.dim : RPC.frame, 1);
    mgraphics.move_to(cx - 3.5, h / 2 - 3.5); mgraphics.line_to(cx + 3.5, h / 2 + 3.5);
    mgraphics.move_to(cx + 3.5, h / 2 - 3.5); mgraphics.line_to(cx - 3.5, h / 2 + 3.5);
    mgraphics.stroke();
}

function onclick(x, y, but) {
    if (!but || RBI_MODE !== "btn") return;
    if (x < mgraphics.size[0] / 2) rpCmd("browse_ir");
    else rpCmd("clear_ir");
}

function preview() {
    rpPreviewBase(5, 2.2);
}
