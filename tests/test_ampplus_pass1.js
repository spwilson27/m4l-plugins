"use strict";

// Pass 1 bug sweep, Amp+ core: red tests for the genexpr test mirror.
//
// These encode DEVICE semantics. In gen, a function-local History is
// inlined fresh at every call site. ampplus_core.genexpr relies on this:
// Each biq call is its own filter; a wrapper would share one History
// across every band. The device therefore runs seven independent slew
// instances and seven independent biq instances.
//
// tests/genexpr_functions.js instead hoists each function-local History
// to ONE global shared by every call of that function, so the mirror
// cannot represent per-instance state. Both tests below fail against
// the mirror today; they pass only once the mirror models per-call-site
// History.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { load } = require("./genexpr_functions");

const CORE = path.join(__dirname, "..", "src", "ampplus_core.genexpr");
const SR = 48000;

// slew: bassSm and midSm are separate call sites. Each primes to its own
// first target. The mirror eases the second call from the first site
// state, about 40.04 instead of 80.
{
    const g = load(fs.readFileSync(CORE, "utf8"));
    assert.strictEqual(g.slew(40, 20, SR), 40, "first slew instance primes to its target");
    assert.strictEqual(g.slew(80, 20, SR), 80, "second slew instance should prime to its own target, not ease from the first instance state");
}

// biq: each tone and cab band is a separate call site with zeroed state.
// A fresh instance fed silence must output silence, even after another
// instance has been driven to a nonzero state. The mirror leaks the
// previous instance state into the next call.
{
    const g = load(fs.readFileSync(CORE, "utf8"));
    const lp = [0, 1, 2, 3, 4].map((c) => g.filt(4, 1000, 0.707, 0, SR, c));
    for (let n = 0; n < 200; n++) g.biq(1, lp[0], lp[1], lp[2], lp[3], lp[4]);
    assert.strictEqual(g.biq(0, lp[0], lp[1], lp[2], lp[3], lp[4]), 0, "a fresh biq instance fed 0 should output 0, not the previous instance state");
}

console.log("ampplus pass1 ok");
