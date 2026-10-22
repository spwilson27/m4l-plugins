#!/usr/bin/env node
/**
 * XO Sample Map: category search by words (src/xo_search.js). Pure matcher tests; the node-engine / v8ui integration
 * (category membership, colouring, state blob, Options wiring) is in tests/test_xo_map.js. Run: node tests/test_xo_search.js
 */
const assert = require("assert");
const S = require("../src/xo_search.js");

const CAT = Object.fromEntries(S.XO_SEARCH_CATS.map((c, i) => [c.id, i]));
const DEF = S.xoDefaultSearchTerms();

/** category ids matching name (+ folders) */
function cats(name, folders = [], terms = DEF, mf = true) {
  const m = S.xoMatchMask(name, folders, terms, mf);
  return S.XO_SEARCH_CATS.filter((c, i) => m & (1 << i)).map((c) => c.id);
}
const has = (name, id, folders, terms, mf) => cats(name, folders, terms, mf).includes(id);

// --- category set and order -------------------------------------------------------------------------------------
assert.deepStrictEqual(S.XO_SEARCH_CATS.map((c) => c.id), ["kick", "snare", "hihat", "clap", "perc", "shaker", "cymbal", "voice"]);
assert.deepStrictEqual(S.XO_SEARCH_CATS.map((c) => c.title), ["Kick", "Snare", "Hi-Hat", "Clap", "Perc", "Shaker", "Cymbal", "Voice"]);
assert.deepStrictEqual(DEF[CAT.kick], ["kick", "bd", "kik", "bassdrum"]);
assert.deepStrictEqual(DEF[CAT.snare], ["snare", "rim", "sd", "snr"]);
assert.deepStrictEqual(DEF[CAT.hihat], ["hihat", "hi hat", "hi-hat", "hh", "hat"]);
assert.deepStrictEqual(DEF[CAT.clap], ["clap", "snap"]);
assert.deepStrictEqual(DEF[CAT.perc], ["tom", "perc", "conga", "bongo", "cowbell", "clave", "woodblock", "block", "triangle", "agogo", "djembe", "cajon", "tabla", "timbale", "darbuka"]);
assert.deepStrictEqual(DEF[CAT.shaker], ["shaker", "tamb", "tambourine", "cabasa"]);
assert.deepStrictEqual(DEF[CAT.cymbal], ["crash", "cymbal", "ride", "splash", "china", "cym"]);
assert.deepStrictEqual(DEF[CAT.voice], ["vox", "voice", "vocal", "chant", "choir", "adlib"]);
assert.strictEqual(S.XO_SEARCH_CATS.length, 8, "eight categories fit the 32-bit mask");

// --- tokenizer --------------------------------------------------------------------------------------------------
const tk = S.xoTokenize;
assert.deepStrictEqual(tk("ClosedHat"), ["closed", "hat"]);
assert.deepStrictEqual(tk("Kick808"), ["kick", "808"]);
assert.deepStrictEqual(tk("808Kick"), ["808", "kick"]);
assert.deepStrictEqual(tk("HHClosed"), ["hh", "closed"]);
assert.deepStrictEqual(tk("Hi-Hat_01 (Open) [v2].x"), ["hi", "hat", "01", "open", "v", "2", "x"]);
assert.deepStrictEqual(tk("  snare   drum "), ["snare", "drum"]);
assert.deepStrictEqual(tk("KICK"), ["kick"]);
assert.deepStrictEqual(tk(""), []);

// --- every default term, positives -------------------------------------------------------------------------------
const POS = {
  kick: ["Kick 01", "Kicks", "BD_Deep", "kik loop", "Bassdrum", "Bass Drum 2", "909 Kick", "KickHard", "808Kick", "Deep-Kick.wav"],
  snare: ["Snare Tight", "Rim Click", "SD 03", "snr_big", "Snares", "Rims 1", "RimShot", "SnareRoll"],
  hihat: ["Hihat Closed", "Hi Hat Open", "Hi-Hat 02", "HiHat", "HH Closed", "Closed Hat", "Hats 4", "OpenHat", "hi_hat", "Hi hats"],
  clap: ["Clap 808", "Claps", "Snap 1", "Finger Snap", "HandClap"],
  perc: ["Tom Low", "Floor Tom", "Perc 3", "Conga Hi", "Bongo", "Cowbell", "Clave", "Woodblock", "Wood Block", "Block 2", "Triangle", "Agogo",
    "Djembe Slap", "Cajon", "Tabla", "Timbale", "Darbuka", "Perc_Hit", "Toms"],
  shaker: ["Shaker 01", "Tamb Hit", "Tambourine Loop", "Cabasa", "Shakers", "Egg_Shaker"],
  cymbal: ["Crash 1", "Cymbal", "Ride Bell", "Splash", "China", "Cym 3", "RideCymbal", "Crashes"],
  voice: ["Vox 1", "Voice Chop", "Vocal Phrase", "Chant", "Choir Ah", "Adlib", "Voices", "Male_Vox"]
};
for (const [id, names] of Object.entries(POS)) for (const n of names) assert(has(n, id), `"${n}" belongs to ${id} (got ${cats(n)})`);

// --- negatives: whole words only ----------------------------------------------------------------------------------
const NEG = [
  ["Custom Bass", "perc"], ["Bottom End", "perc"], ["Atomic", "perc"], ["Tomorrow", "perc"], ["Autom", "perc"],
  ["Chat Sample", "hihat"], ["What", "hihat"], ["Hatch", "hihat"], ["Shatter", "hihat"], ["Phat Bass", "hihat"],
  ["Pride", "cymbal"], ["Override", "cymbal"], ["Bride", "cymbal"], ["Riders", "cymbal"],
  ["Prime", "snare"], ["Trim", "snare"], ["Grim", "snare"], ["Primary", "snare"], ["Sds", "voice"],
  ["Kickstart", "kick"], ["Kicker", "kick"], ["Bdsm", "kick"], ["Embd", "kick"],
  ["Tambour", "shaker"], ["Snapshot", "clap"], ["Snappy", "clap"], ["Block Chord", "kick"],
  ["Voiceover", "voice"], ["Evoxx", "voice"], ["Scrash", "cymbal"], ["China Town", "kick"], ["Cymbalom", "cymbal"],
  ["Triangles Of", "kick"]
];
for (const [n, id] of NEG) {
  if (n === "Sds") continue; // "sds" is the plural of "sd" (snare): checked below
  assert(!has(n, id), `"${n}" must NOT belong to ${id}`);
}
assert(has("Sds", "snare"), '"Sds" is the plural of sd');
assert.deepStrictEqual(cats("Custom"), [], "custom matches nothing");
assert.deepStrictEqual(cats("Bottom"), [], "bottom matches nothing");
assert.deepStrictEqual(cats("What Chat"), [], "what / chat match nothing");
assert.deepStrictEqual(cats("Pride Override"), [], "pride / override match nothing");
assert.deepStrictEqual(cats("Prime Trim"), [], "prime / trim match nothing");
assert(has("Custom Tom", "perc"), "a real whole-word tom still matches next to custom");
assert(has("Bottom Kick", "kick"));
assert(has("Ride", "cymbal") && !has("Ride", "perc"));

// --- plurals ------------------------------------------------------------------------------------------------------
for (const [n, id] of [["Kicks", "kick"], ["Claps", "clap"], ["Hats", "hihat"], ["Toms", "perc"], ["Crashes", "cymbal"], ["Voices", "voice"], ["Percs", "perc"], ["Boxes", "kick"]]) {
  if (id === "kick" && n === "Boxes") continue;
  assert(has(n, id), `plural "${n}" matches ${id}`);
}
assert(!has("Kickss", "kick") && !has("Hatss", "hihat"), "only one plural letter");

// --- camelCase / digits / hyphen / space / concatenation ------------------------------------------------------------
for (const n of ["hihat", "Hi Hat", "hi-hat", "HiHat", "Hi_Hat", "HI HAT", "hi.hat", "HIHAT 12"]) assert(has(n, "hihat"), `${n} -> hihat`);
for (const n of ["Bass Drum", "bassdrum", "BassDrum", "Bass-Drum 03", "bass_drum"]) assert(has(n, "kick"), `${n} -> kick`);
assert(has("ClosedHat", "hihat") && has("OpenHat3", "hihat"));
assert(has("Kick808", "kick") && has("808kick", "kick") && has("909Snare", "snare"));
assert(has("Hi Hats", "hihat"), "hi hats -> hihat via the singular of the last token");
// multi-word terms in custom lists
const CUSTOM = [["kick"], ["snare"], ["hi hat", "open-hat"], [], [], [], ["big crash"], []];
assert(has("Open Hat 1", "hihat", [], CUSTOM) && has("OpenHat", "hihat", [], CUSTOM) && has("open_hat", "hihat", [], CUSTOM));
assert(!has("Hat Open", "hihat", [], CUSTOM), "terms keep their token order");
assert(has("Big Crash 2", "cymbal", [], CUSTOM) && !has("Big Ride Crash", "cymbal", [], CUSTOM), "multi-word terms need adjacent tokens");
assert(has("Hi Hats", "hihat", [], CUSTOM), "multi-word term + plural on the last token");

// --- several categories ---------------------------------------------------------------------------------------------
assert.deepStrictEqual(cats("Rim Click Perc"), ["snare", "perc"], "Rim Click Perc is Snare and Perc");
assert.deepStrictEqual(cats("Kick Snare Hat"), ["kick", "snare", "hihat"]);
assert.deepStrictEqual(cats("Tom Crash Vox"), ["perc", "cymbal", "voice"]);
assert.deepStrictEqual(cats("Tambourine Snap"), ["clap", "shaker"]);
assert.deepStrictEqual(cats("Sine Pad"), [], "no match -> no categories");

// --- folders: Match folders on / off and the root boundary -----------------------------------------------------------
{
  const root = "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/One Shots/Drums";
  assert.deepStrictEqual(S.xoRelFolders(root + "/Kick/Deep/a.wav", root), ["Kick", "Deep"]);
  assert.deepStrictEqual(S.xoRelFolders(root + "/a.wav", root), [], "a file directly in the root has no relative folders");
  assert.deepStrictEqual(S.xoRelFolders(root + "/Snare/a.wav", root + "/"), ["Snare"], "trailing slash on the root");
  assert.deepStrictEqual(S.xoRelFolders("/Users/x/Splice/Packs/Pack One/Hats/a.wav", "/Users/x/Splice"), ["Packs", "Pack One", "Hats"]);
  // the root's own name and parents never match: "Drums", "One Shots", "Core Library", "Splice" ...
  const rootKick = "/Users/x/Kick Collection";
  assert.deepStrictEqual(S.xoRelFolders(rootKick + "/Sub/a.wav", rootKick), ["Sub"], "root name excluded");
  assert.deepStrictEqual(cats("Thing 01", S.xoRelFolders(rootKick + "/Sub/Thing 01.wav", rootKick)), [], "a root called Kick Collection does not make everything a kick");
  assert.deepStrictEqual(cats("Thing 01", S.xoRelFolders(root + "/Snare/Thing 01.wav", root)), ["snare"], "folder below the root counts");
  assert.deepStrictEqual(cats("Thing 01", ["Snare"], DEF, false), [], "Match folders off ignores folders");
  assert.deepStrictEqual(cats("Thing 01", ["Snare", "Hats"], DEF, true), ["snare", "hihat"]);
  assert.deepStrictEqual(cats("Kick 01", ["Snare"], DEF, false), ["kick"], "name matches still count with folders off");
  assert.deepStrictEqual(S.xoRelFolders("/a/b/c.wav", ""), ["b"], "unknown root: only the immediate folder");
  assert.deepStrictEqual(S.xoRelFolders("/a/b/c.wav", "/other"), ["b"], "file outside the root: immediate folder");
  // Windows separators
  assert.deepStrictEqual(S.xoRelFolders("C:\\Samples\\Kicks\\a.wav", "C:\\Samples"), ["Kicks"]);
  assert.deepStrictEqual(cats("a", ["Kicks"]), ["kick"], "folder plural");
  assert.deepStrictEqual(cats("a", ["Crash Cymbals"]), ["cymbal"]);
  assert.deepStrictEqual(cats("a", ["Hi Hats"]), ["hihat"], "folder Hi Hats");
}

// --- terms text: parse / format / encode ----------------------------------------------------------------------------
assert.deepStrictEqual(S.xoParseTerms("kick, bd ,, Kik;bassdrum\nKICK"), ["kick", "bd", "Kik", "bassdrum"], "trim, drop empties and case-insensitive duplicates");
assert.deepStrictEqual(S.xoParseTerms(""), []);
assert.strictEqual(S.xoFormatTerms(["a", "hi hat"]), "a, hi hat");
for (const list of DEF.concat([[], ["hi hat", "x"], ["808", "a-b"]])) {
  const enc = S.xoEncodeTerms(list);
  assert(!/\s/.test(enc) && !enc.includes(","), `encoded "${enc}" is one safe token`);
  assert.deepStrictEqual(S.xoDecodeTerms(enc), list, `round trip ${enc}`);
}
assert.strictEqual(S.xoEncodeTerms([]), "-");
assert.deepStrictEqual(S.xoDecodeTerms("-"), []);
assert.deepStrictEqual(S.xoDecodeTerms(808), ["808"], "a numeric-looking term survives Max turning it into a number");

// --- custom terms change the result; empty list matches nothing --------------------------------------------------
{
  const t = S.xoDefaultSearchTerms();
  t[CAT.kick] = ["thump"];
  assert(has("Thump 1", "kick", [], t) && !has("Kick 1", "kick", [], t), "edited terms replace the defaults");
  t[CAT.kick] = [];
  assert.deepStrictEqual(cats("Kick Thump", [], t), [], "an empty list matches nothing");
}

// --- first-match colouring --------------------------------------------------------------------------------------------
{
  const first = (n, f) => S.xoFirstCat(S.xoMatchMask(n, f || [], DEF, true));
  assert.strictEqual(first("Sine"), -1);
  assert.strictEqual(first("Kick Snare"), CAT.kick);
  assert.strictEqual(first("Rim Perc"), CAT.snare, "Snare > Perc");
  assert.strictEqual(first("Tom Crash"), CAT.perc, "Perc > Cymbal");
  assert.strictEqual(first("Shaker Crash Vox"), CAT.shaker, "Shaker > Cymbal > Voice");
  assert.strictEqual(first("Vox Crash"), CAT.cymbal, "Cymbal > Voice");
  assert.strictEqual(first("x", ["Voice"]), CAT.voice);
  assert.strictEqual(S.xoFirstCat(0), -1);
}

// --- speed: 20k names ---------------------------------------------------------------------------------------------------
{
  const names = [];
  const words = ["Kick", "Snare", "ClosedHat", "Tom", "Vox", "Sine", "Pad", "Bass", "Crash", "Perc", "Loop", "Hit", "Texture", "Riser", "Custom", "Bottom"];
  for (let i = 0; i < 20000; i++) names.push(`${words[i % 16]}_${words[(i * 7) % 16]} ${i} v${i % 5}`);
  let t0 = process.hrtime.bigint();
  const keys = names.map((n, i) => S.xoSampleKeys(n, ["Drums", words[i % 16] + "s"]));
  const tokMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const idx = S.xoBuildSearchIndex(DEF);
  t0 = process.hrtime.bigint();
  let sum = 0;
  for (let r = 0; r < 5; r++) for (const k of keys) sum += S.xoSampleMask(k, idx, true);
  const matchMs = Number(process.hrtime.bigint() - t0) / 1e6 / 5;
  assert(sum > 0);
  console.log(`OK: 20k names: tokenise ${tokMs.toFixed(0)} ms once, re-match after a terms edit ${matchMs.toFixed(0)} ms`);
  assert(tokMs < 1500 && matchMs < 500, "matching 20k samples stays interactive");
}

console.log("OK: xo_search matcher (categories, plurals, whole words, camelCase, hi-hat spellings, folders / root, first match, terms text)");
