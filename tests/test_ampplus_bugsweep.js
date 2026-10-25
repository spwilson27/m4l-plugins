"use strict";

// PASS 1 bugsweep RED tests for Amp+ variants (slug: ampplus-variants).
// Current HEAD uses buffer~ #0-ampscope. Live does not expand #0 in a
// top-level M4L patcher (AGENTS.md Multiband Split / Glitch / Delay+), so
// every Amp+ instance in a Set shares one scope ring. Expect FAIL until
// build_ampplus.py emits ---ampscope (do not fix production code in pass 1).
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEVICES = [
    "Amp+.amxd",
    "Amp+ Wave.amxd",
    "Amp+ Pulse.amxd",
    "Amp+ Tiles.amxd",
    "Amp+ Strip.amxd",
    "Amp+ Mono.amxd",
];

function readAmxd(file) {
    const raw = fs.readFileSync(file);
    return { raw, doc: JSON.parse(raw.slice(32).toString("utf8")) };
}

for (const name of DEVICES) {
    const file = path.join(ROOT, "devices", name);
    const { doc } = readAmxd(file);
    const boxes = doc.patcher.boxes.map((b) => b.box);
    const byId = new Map(boxes.map((b) => [b.id, b]));

    const scope = byId.get("obj-scope");
    assert.ok(scope, `${name}: missing obj-scope`);
    assert.strictEqual(
        scope.text,
        "buffer~ ---ampscope @samps 32",
        `${name}: scope buffer must use --- instance isolation (Live does not expand #0 in a top-level patcher); got ${scope.text}`
    );

    const msgBuf = byId.get("obj-msg-buf");
    assert.ok(msgBuf, `${name}: missing obj-msg-buf`);
    assert.strictEqual(
        msgBuf.text,
        "---ampscope",
        `${name}: loadbang buffer name must be ---ampscope; got ${msgBuf.text}`
    );

    for (const box of boxes) {
        const t = box.text || "";
        assert.ok(
            !/#0-ampscope\b/.test(t),
            `${name}: ${box.id} must not use literal #0-ampscope (got ${t})`
        );
    }
}

const buildSrc = fs.readFileSync(path.join(ROOT, "scripts", "build_ampplus.py"), "utf8");
assert.ok(
    buildSrc.includes("buffer~ ---ampscope @samps 32"),
    "build_ampplus.py must create buffer~ ---ampscope @samps 32"
);
assert.ok(
    /["']---ampscope["']/.test(buildSrc),
    "build_ampplus.py must emit the ---ampscope bind name"
);
assert.ok(
    !/#0-ampscope/.test(buildSrc),
    "build_ampplus.py must not emit #0-ampscope"
);

console.log("ampplus bugsweep ok");
