#!/usr/bin/env node
/**
 * PASS-1 RED suite for Tiny Space bugsweep (bugsweep/tinyspace-pass1).
 * These checks are expected to FAIL on current production code.
 * See BUGS.md. Do not "fix" by editing src/ or scripts/ in this pass.
 */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const UI_PATH = path.join(ROOT, "src", "tinyspace_ui.js");
const BUILD_PATH = path.join(ROOT, "scripts", "build_tinyspace.py");
const AMXD_PATH = path.join(ROOT, "devices", "Tiny Space.amxd");

let checks = 0;
function ok(cond, msg) {
    checks++;
    assert.ok(cond, msg);
}

const uiSrc = fs.readFileSync(UI_PATH, "utf8");
const buildSrc = fs.readFileSync(BUILD_PATH, "utf8");

// ---------------------------------------------------------------------------------------------
// Bug A — config / meter buffers must be instance-unique (`---…`), not shared `#0-ts*`
// ---------------------------------------------------------------------------------------------
{
    ok(
        /---tsconfig/.test(buildSrc) || /---tsmeters/.test(buildSrc),
        "Bug A RED: build should reference unique ---tsconfig / ---tsmeters (or equivalent --- names)"
    );
    ok(
        !/buffer~\s+#0-tsconfig\b/.test(buildSrc),
        "Bug A RED: build must not create buffer~ #0-tsconfig (Live does not expand #0 in top-level devices)"
    );
    ok(
        !/buffer~\s+#0-tsmeters\b/.test(buildSrc),
        "Bug A RED: build must not create buffer~ #0-tsmeters"
    );
    ok(
        !/\bcfg\s+#0-tsconfig\b/.test(buildSrc),
        "Bug A RED: build must not bind gen cfg to #0-tsconfig"
    );
    ok(
        !/\bmeters\s+#0-tsmeters\b/.test(buildSrc),
        "Bug A RED: build must not bind gen meters to #0-tsmeters"
    );
    ok(
        !/setbuffer\s+#0-tsconfig\s+#0-tsmeters\b/.test(buildSrc),
        "Bug A RED: build must not send setbuffer #0-tsconfig #0-tsmeters to the face"
    );
    ok(
        !/new\s+Buffer\s*\(\s*["']#0-tsmeters["']\s*\)/.test(uiSrc),
        "Bug A RED: tinyspace_ui.tsDspFrames must not hardcode new Buffer(\"#0-tsmeters\"); use meterBuf from setbuffer"
    );
    if (fs.existsSync(AMXD_PATH)) {
        const amxd = fs.readFileSync(AMXD_PATH, "utf8");
        ok(
            (!/#0-tsconfig/.test(amxd) && !/#0-tsmeters/.test(amxd)) ||
                (/---tsconfig/.test(amxd) && /---tsmeters/.test(amxd)),
            "Bug A RED: built Tiny Space.amxd must not rely solely on shared #0-tsconfig / #0-tsmeters"
        );
    }
}

console.log(`tinyspace bugsweep RED: ${checks} checks (expected FAIL on current code until PASS 2 fixes)`);
