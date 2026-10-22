/**
 * XO Sample Map: category search by WORDS (src/xo_search.js). Pure, no Max / Node APIs.
 *
 * The bottom toolbar's category buttons (Kick, Snare, Hi-Hat, Clap, Perc, Shaker, Cymbal, Voice) select samples whose
 * file name (and, with "Match folders", the folder names between the indexed root and the file) contain one of the
 * category's search terms. Shared by the node engine (embedded by scripts/build_xo_map.py as XO_SEARCH_EMBEDDED,
 * `require`d under plain Node by the tests) and the mini-map v8ui (it only needs the defaults and the term parser, so it
 * is prepended there as a global script). Keep it a global script: no top-level module.exports (AGENTS.md 1c).
 *
 * Rules (tests/test_xo_search.js):
 *  - Text = file name without extension + (Match folders) the folder names below the root folder.
 *  - Tokens: camelCase and digit boundaries split ("ClosedHat" -> closed hat, "Kick808" -> kick 808), then
 *    everything that is not a letter or digit separates (space _ - . ( ) [ ] ...); lower case.
 *  - A term is tokenised the same way. It matches when its tokens, concatenated, equal a run of 1..4 adjacent tokens
 *    concatenated, where the LAST token of the run may carry a plural "s" / "es". So "kick" matches "Kicks", but "tom"
 *    never matches "custom" / "bottom", "hat" never "chat" / "what", "hihat" matches "Hi Hat" / "hi-hat" / "HiHat" and
 *    "bassdrum" matches "Bass Drum", and "hi hat" / "hi-hat" match "hihat".
 *  - A sample belongs to every category with a matching term (bit mask, bit i = category i).
 *
 * Speed: tokenising happens once per sample (xoSampleKeys; callers cache the result per path). The terms compile into
 * one Map key -> category mask (xoBuildSearchIndex), so matching a sample is about 4 * tokens Map lookups.
 */

/** @typedef {{ id: string, title: string, short: string, terms: string[] }} XoSearchCat */

/** Category order = toolbar order = first-match colouring priority. */
/** @type {XoSearchCat[]} */
var XO_SEARCH_CATS = [
  { id: "kick", title: "Kick", short: "Kick", terms: ["kick", "bd", "kik", "bassdrum"] },
  { id: "snare", title: "Snare", short: "Snare", terms: ["snare", "rim", "sd", "snr"] },
  { id: "hihat", title: "Hi-Hat", short: "Hi-Hat", terms: ["hihat", "hi hat", "hi-hat", "hh", "hat"] },
  { id: "clap", title: "Clap", short: "Clap", terms: ["clap", "snap"] },
  {
    id: "perc", title: "Perc", short: "Perc",
    terms: ["tom", "perc", "conga", "bongo", "cowbell", "clave", "woodblock", "block", "triangle", "agogo", "djembe",
      "cajon", "tabla", "timbale", "darbuka"]
  },
  { id: "shaker", title: "Shaker", short: "Shaker", terms: ["shaker", "tamb", "tambourine", "cabasa"] },
  { id: "cymbal", title: "Cymbal", short: "Cymbal", terms: ["crash", "cymbal", "ride", "splash", "china", "cym"] },
  { id: "voice", title: "Voice", short: "Voice", terms: ["vox", "voice", "vocal", "chant", "choir", "adlib"] }
];

var XO_SEARCH_MAX_RUN = 4;

/**
 * Lower-case tokens of a name or a term.
 * @param {string} str
 * @returns {string[]}
 */
function xoTokenize(str) {
  var s = String(str === undefined || str === null ? "" : str);
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])([0-9])/g, "$1 $2")
    .replace(/([0-9])([A-Za-z])/g, "$1 $2")
    .toLowerCase();
  var parts = s.split(/[^a-z0-9À-￿]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
  return out;
}

/**
 * Terms from the comma separated text of the Options field (also splits on ; and newlines). Trimmed, no empties,
 * no duplicates (case-insensitive); the original spelling is kept for display.
 * @param {string} text
 * @returns {string[]}
 */
function xoParseTerms(text) {
  var parts = String(text === undefined || text === null ? "" : text).split(/[,;\n\r]+/);
  var out = [];
  var seen = {};
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i].replace(/^\s+|\s+$/g, "");
    var k = t.toLowerCase();
    if (!t || seen[k]) continue;
    seen[k] = 1;
    out.push(t);
  }
  return out;
}

/** @param {string[]} terms @returns {string} */
function xoFormatTerms(terms) {
  return terms.join(", ");
}

/**
 * Safe single-token encoding of a term list for the Live blob (no spaces, no commas): terms joined by "|", spaces
 * written as "~"; an empty list is "-".
 * @param {string[]} terms
 * @returns {string}
 */
function xoEncodeTerms(terms) {
  if (!terms || terms.length === 0) return "-";
  return terms.map(function (t) { return String(t).replace(/[|~]/g, " ").replace(/\s+/g, "~"); }).join("|");
}

/**
 * @param {string | number} enc
 * @returns {string[]}
 */
function xoDecodeTerms(enc) {
  var s = String(enc === undefined || enc === null ? "" : enc);
  if (s === "-" || s === "") return [];
  return s.split("|").map(function (t) { return t.replace(/~/g, " "); }).filter(function (t) { return t.length > 0; });
}

/** Default term lists, copied. @returns {string[][]} */
function xoDefaultSearchTerms() {
  return XO_SEARCH_CATS.map(function (c) { return c.terms.slice(); });
}

/**
 * @param {string} tok
 * @returns {string[]}  the token and its singular forms
 */
function xoTokenVariants(tok) {
  var out = [tok];
  var n = tok.length;
  if (n > 2 && tok.charAt(n - 1) === "s") out.push(tok.slice(0, n - 1));
  if (n > 3 && tok.slice(n - 2) === "es") out.push(tok.slice(0, n - 2));
  return out;
}

/**
 * Match keys of one token list: runs of 1..XO_SEARCH_MAX_RUN adjacent tokens concatenated, the last token also in
 * singular form. Computed once per sample and cached by the caller.
 * @param {string[]} tokens
 * @returns {string[]}
 */
function xoRunKeys(tokens) {
  var keys = [];
  for (var i = 0; i < tokens.length; i++) {
    var prefix = "";
    for (var j = i; j < tokens.length && j < i + XO_SEARCH_MAX_RUN; j++) {
      var vs = xoTokenVariants(tokens[j]);
      for (var v = 0; v < vs.length; v++) keys.push(prefix + vs[v]);
      prefix += tokens[j];
    }
  }
  return keys;
}

/**
 * Folder names between the indexed root folder and the file (the root's own name and parents are excluded).
 * @param {string} filePath
 * @param {string} [rootFolder]
 * @returns {string[]}
 */
function xoRelFolders(filePath, rootFolder) {
  var p = String(filePath || "").replace(/\\/g, "/");
  var dirs = p.split("/");
  dirs.pop();
  var root = String(rootFolder || "").replace(/\\/g, "/").replace(/\/+$/, "");
  var rel;
  if (root && (p.indexOf(root + "/") === 0)) {
    rel = p.slice(root.length + 1).split("/");
    rel.pop();
  } else {
    // unknown root: only the immediate folder
    rel = dirs.length > 0 ? [dirs[dirs.length - 1]] : [];
  }
  return rel.filter(function (d) { return d.length > 0; });
}

/**
 * File name without an audio extension (.wav .aif .aiff .flac .mp3 .ogg .m4a .caf).
 * @param {string} name
 * @returns {string}
 */
function xoStripExt(name) {
  return String(name || "").replace(/\.(wav|aiff?|flac|mp3|ogg|m4a|caf)$/i, "");
}

/**
 * @typedef {{ n: string[], f: string[] }} XoSampleKeys
 * @param {string} name  file name (extension optional)
 * @param {string[]} folders  folder names between the root and the file
 * @returns {XoSampleKeys}
 */
function xoSampleKeys(name, folders) {
  var nameKeys = xoRunKeys(xoTokenize(xoStripExt(name)));
  var folderKeys = [];
  for (var i = 0; i < (folders ? folders.length : 0); i++) {
    var ks = xoRunKeys(xoTokenize(folders[i]));
    for (var k = 0; k < ks.length; k++) folderKeys.push(ks[k]);
  }
  return { n: nameKeys, f: folderKeys };
}

/**
 * @typedef {{ map: Map<string, number>, count: number }} XoSearchIndex
 * @param {string[][]} termsByCat  one term list per category (XO_SEARCH_CATS order)
 * @returns {XoSearchIndex}
 */
function xoBuildSearchIndex(termsByCat) {
  /** @type {Map<string, number>} */
  var map = new Map();
  for (var c = 0; c < XO_SEARCH_CATS.length; c++) {
    var list = (termsByCat && termsByCat[c]) || [];
    for (var t = 0; t < list.length; t++) {
      var toks = xoTokenize(list[t]);
      if (toks.length === 0 || toks.length > XO_SEARCH_MAX_RUN) continue;
      var key = toks.join("");
      map.set(key, (map.get(key) || 0) | (1 << c));
    }
  }
  return { map: map, count: map.size };
}

/**
 * Category bit mask of a sample.
 * @param {XoSampleKeys} keys
 * @param {XoSearchIndex} index
 * @param {boolean} matchFolders
 * @returns {number}
 */
function xoSampleMask(keys, index, matchFolders) {
  var m = 0;
  var map = index.map;
  var a = keys.n;
  var v;
  for (var i = 0; i < a.length; i++) {
    v = map.get(a[i]);
    if (v) m |= v;
  }
  if (matchFolders) {
    var b = keys.f;
    for (var j = 0; j < b.length; j++) {
      v = map.get(b[j]);
      if (v) m |= v;
    }
  }
  return m;
}

/**
 * Index of the first (highest priority) category in the mask, -1 for none.
 * @param {number} mask
 * @returns {number}
 */
function xoFirstCat(mask) {
  for (var i = 0; i < XO_SEARCH_CATS.length; i++) if (mask & (1 << i)) return i;
  return -1;
}

/**
 * Convenience for tests and tools: mask of a name + folders for term lists.
 * @param {string} name
 * @param {string[]} folders
 * @param {string[][]} [termsByCat]  default terms when omitted
 * @param {boolean} [matchFolders]  default true
 * @returns {number}
 */
function xoMatchMask(name, folders, termsByCat, matchFolders) {
  return xoSampleMask(xoSampleKeys(name, folders), xoBuildSearchIndex(termsByCat || xoDefaultSearchTerms()),
    matchFolders === undefined ? true : !!matchFolders);
}

var xoSearchNodeModule = (typeof module !== "undefined") ? module : undefined;
if (xoSearchNodeModule && xoSearchNodeModule.exports) {
  xoSearchNodeModule.exports = {
    XO_SEARCH_CATS: XO_SEARCH_CATS, xoTokenize: xoTokenize, xoParseTerms: xoParseTerms, xoFormatTerms: xoFormatTerms,
    xoEncodeTerms: xoEncodeTerms, xoDecodeTerms: xoDecodeTerms, xoDefaultSearchTerms: xoDefaultSearchTerms,
    xoRunKeys: xoRunKeys, xoRelFolders: xoRelFolders, xoStripExt: xoStripExt, xoSampleKeys: xoSampleKeys,
    xoBuildSearchIndex: xoBuildSearchIndex, xoSampleMask: xoSampleMask, xoFirstCat: xoFirstCat, xoMatchMask: xoMatchMask
  };
}
