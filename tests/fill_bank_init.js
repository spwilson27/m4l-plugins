// Pokes one experimental page into the slot the gen reads (#0-fillbank index 16).
// bank <hz> <rt60>  builds eight modes around hz. bang uses 200 Hz / 0.2 s.

outlets = 1;

function bank(hz, rt60) {
    var b = new Buffer("#0-fillbank");
    var page = [];
    var i;
    var rate = 48000;
    var freq = Number(hz);
    var rt = Number(rt60);
    if (!(freq > 20)) freq = 200;
    if (!(rt > 0.02)) rt = 0.02;
    if (rt > 0.5) rt = 0.5;
    var r0 = Math.exp(-6.91 / (rt * rate));
    var w0 = freq / rate * 2 * Math.PI;
    for (i = 0; i < 408; i++) page[i] = 0;
    for (i = 0; i < 8; i++) {
        var base = i * 8;
        var r = r0 * (1 - 0.55 * i / 7);
        if (r < 0.05) r = 0.05;
        page[base] = w0 * (1 + i * 0.37);
        page[base + 1] = r;
        page[base + 2] = i === 0 ? 1 : 0.22;
        page[base + 3] = 0;
        page[base + 4] = i === 0 ? 0.72 : 0.04;
        page[base + 7] = (i / 6) | 0;
    }
    page[405] = 1.2;
    page[407] = rt;
    b.poke(1, 0, [0, 1, 1, 48, 0]);
    b.poke(1, 16, page);
    outlet(0, "bankgen", 1);
}

function bang() {
    bank(200, 0.2);
}
