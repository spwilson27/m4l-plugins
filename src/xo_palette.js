/**
 * XO Sample Map: shared v8ui palette mechanism (prepended to the mini-map v8ui, src/xo_strip_ui.js, and to the
 * folder list v8ui, src/xo_folder_ui.js, by scripts/build_xo_map.py). Keep it a global script (no top-level
 * module.exports, AGENTS.md 1c).
 *
 * Every colour the two v8uis paint goes through xoSrc(r, g, b, a). The palette named by the last `set_theme`
 * message decides what reaches mgraphics:
 *   "default" / "Focus"  identity: the original blue / category-coloured look (variant devices never receive
 *                        set_theme, so they keep it).
 *   "LCD"                amber monochrome to match the LCD theme's hardware look: the colour's luminance is
 *                        mapped onto one amber ramp (alpha unchanged), and the category colours (kick, snare, ...)
 *                        become distinct warm amber / red-orange / yellow tones so the map still reads.
 * Tables are plain data, so a new theme is one more entry in XO_PALETTES.
 */

/** @typedef {{ tone: number[] | null, cats: Object<string, number[]> }} XoPalette */

/** @type {Object<string, XoPalette>} */
var XO_PALETTES = {
  "default": { tone: null, cats: {} },
  "Focus": { tone: null, cats: {} },
  "LCD": {
    // luminance 1.0 -> the LCD accent amber, 0 -> black
    tone: [1.0, 0.70, 0.10],
    cats: {
      "ALL": [1.00, 0.86, 0.55],
      "kick": [1.00, 0.34, 0.08],
      "snare": [1.00, 0.56, 0.05],
      "hihat": [1.00, 0.90, 0.45],
      "clap": [0.96, 0.46, 0.30],
      "tom": [0.78, 0.40, 0.04],
      "rim": [1.00, 0.64, 0.36],
      "cymbal": [1.00, 0.80, 0.14],
      "shaker": [0.86, 0.72, 0.32],
      "perc": [0.96, 0.74, 0.10],
      "fx": [0.72, 0.52, 0.20]
    }
  }
};

var xoPaletteName = "default";

/** @param {string} name */
function xoPaletteSet(name) {
  xoPaletteName = XO_PALETTES[name] ? name : "default";
}

/**
 * Palette-mapped colour (pure; used by xoSrc and the tests).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {number[]}
 */
function xoPaletteColor(r, g, b, a) {
  var tone = XO_PALETTES[xoPaletteName].tone;
  if (!tone) return [r, g, b, a];
  var l = 0.299 * r + 0.587 * g + 0.114 * b;
  return [Math.min(1, l * tone[0]), Math.min(1, l * tone[1]), Math.min(1, l * tone[2]), a];
}

/**
 * Category colour for the active palette (falls back to the category's own colour).
 * @param {string} id  category id ("kick", "ALL", ...)
 * @param {number[]} base  the category's default colour
 * @returns {number[]}
 */
function xoPaletteCat(id, base) {
  var o = XO_PALETTES[xoPaletteName].cats[id];
  return o ? [o[0], o[1], o[2], base.length > 3 ? base[3] : 1.0] : base;
}

/**
 * Sets the paint colour through the active palette.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 */
function xoSrc(r, g, b, a) {
  var c = xoPaletteColor(r, g, b, a);
  mgraphics.set_source_rgba(c[0], c[1], c[2], c[3]);
}

/**
 * Sets a colour that is already palette-resolved (category colours from xoPaletteCat) without mapping it again.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 */
function xoSrcRaw(r, g, b, a) {
  mgraphics.set_source_rgba(r, g, b, a);
}
