"use strict";
// Shared mock loader for the sweep2 EQ+ tests: reuses loadFace() from
// tests/test_eqplus_bugsweep.js without running its blocks.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(__dirname, "test_eqplus_bugsweep.js"), "utf8");
const start = src.indexOf("function loadFace()");
const end = src.indexOf("const failures = [];");
const prelude = 'const fs=require("fs"),path=require("path"),vm=require("vm");const ROOT=' + JSON.stringify(ROOT)
    + ';const configSrc=fs.readFileSync(path.join(ROOT,"src","eqplus_config.js"),"utf8");'
    + 'const uiSrc=fs.readFileSync(path.join(ROOT,"src","eqplus_ui.js"),"utf8");';
const mod = { exports: {} };
new Function("module", "require", prelude + src.slice(start, end) + "\nmodule.exports={loadFace,paramEmissions,hasParam};")(mod, require);
module.exports = mod.exports;
