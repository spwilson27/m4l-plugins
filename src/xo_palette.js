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
  "Live": { tone: null, cats: {} },
  "LCD": {
    // luminance 1.0 -> the LCD accent amber, 0 -> black
    tone: [1.0, 0.70, 0.10],
    cats: {
      // eight categories + "no match" that stay apart in the amber family: hue (red .. yellow-green), lightness
      "ALL": [0.80, 0.78, 0.72],
      "kick": [1.00, 0.30, 0.08],
      "snare": [1.00, 0.58, 0.05],
      "hihat": [1.00, 0.93, 0.40],
      "clap": [0.96, 0.48, 0.36],
      "perc": [0.74, 0.40, 0.05],
      "shaker": [0.80, 0.76, 0.30],
      "cymbal": [1.00, 0.78, 0.14],
      "voice": [1.00, 0.96, 0.86],
      "none": [0.46, 0.34, 0.14]
    }
  }
};

var xoPaletteName = "default";
/** Theme names by Theme parameter index (the Options > Theme enum). */
var XO_PALETTE_THEMES = ["LCD", "Focus", "Live"];

// ---- Live palette: theme colours -------------------------------------------------------------------------------------
/** Live 12.4.6 default dark theme, measured with max.getcolor in Live (same values as SPT_FALLBACK in spectral_theme.js). */
var XO_LIVE_FALLBACK = {
  live_desktop: [0.165, 0.165, 0.165, 1],
  live_surface_bg: [0.212, 0.212, 0.212, 1],
  live_surface_frame: [0.141, 0.141, 0.141, 1],
  live_lcd_bg: [0.094, 0.094, 0.094, 1],
  live_lcd_frame: [0.243, 0.243, 0.243, 1],
  live_lcd_title: [0.71, 0.71, 0.71, 1],
  live_lcd_control_fg: [1, 0.678, 0.337, 1],
  live_lcd_control_fg_alt: [0.012, 0.765, 0.835, 1],
  live_display_line_one: [1, 0.678, 0.337, 1],
  live_display_line_two: [0.012, 0.765, 0.835, 1],
  live_display_handle_one: [1, 0.678, 0.337, 1],
  live_display_handle_two: [1, 0.412, 0.498, 1],
  live_display_scale_text: [0.525, 0.525, 0.525, 1],
  live_control_bg: [0.118, 0.118, 0.118, 1],
  live_control_fg: [0.71, 0.71, 0.71, 1],
  live_control_selection: [1, 0.678, 0.337, 1],
  live_control_zombie: [0.459, 0.459, 0.459, 1],
  live_alert: [0.906, 0.412, 0.259, 1]
};

/**
 * A Live theme colour, [r, g, b, a] in 0..1 (max.getcolor, or the default-dark fallback when it is not available).
 * @param {string} name
 * @returns {number[]}
 */
function xoLiveColor(name) {
  if (typeof m4lColor === "function" && typeof m4lIsActive === "function" && m4lIsActive()) {
    return m4lColor(name, XO_LIVE_FALLBACK[name] || [0.5, 0.5, 0.5, 1]);
  }
  try {
    if (typeof max !== "undefined" && max && typeof max.getcolor === "function") {
      const c = max.getcolor(name);
      if (c && c.length >= 3 && !(c.length > 3 && c[3] === 0 && c[0] === 0 && c[1] === 0 && c[2] === 0)) {
        return [Number(c[0]), Number(c[1]), Number(c[2]), c.length > 3 ? Number(c[3]) : 1];
      }
    }
  } catch (e) {}
  const f = XO_LIVE_FALLBACK[name] || [0.5, 0.5, 0.5, 1];
  return [f[0], f[1], f[2], f.length > 3 ? f[3] : 1];
}

const XO_LIVE_WATCHED = ["live_lcd_bg", "live_lcd_title", "live_control_selection", "live_display_line_two", "live_alert", "live_desktop",
  "live_control_bg", "live_control_fg", "live_lcd_control_fg_alt", "live_lcd_frame"];

/** @returns {string} a fingerprint of the watched theme colours (changes when Live's theme / hue does) */
function xoLiveThemeKey() {
  let k = "";
  for (let i = 0; i < XO_LIVE_WATCHED.length; i++) k += xoLiveColor(XO_LIVE_WATCHED[i]).join(",") + ";";
  return k;
}

/** @param {number[]} c @returns {number} */
function xoLum(c) {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

/** @param {number[]} a @param {number[]} b @param {number} t @returns {number[]} */
function xoMixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

/** Hue 0..360, saturation / lightness 0..1 -> [r, g, b, 1]. @param {number} h @param {number} s @param {number} l @returns {number[]} */
function xoHsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; } else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  return [r + m, g + m, b + m, 1];
}

/**
 * Category hues (degrees) and a lightness offset, in toolbar order: neighbours on the colour wheel differ in lightness too.
 * @type {Object<string, number[]>}
 */
const XO_LIVE_CAT_HUES = {
  kick: [0, 0.0], snare: [45, 0.06], hihat: [90, -0.03], perc: [140, 0.05], shaker: [185, -0.04],
  cymbal: [225, 0.05], voice: [275, -0.03], clap: [320, 0.04]
};

/** @type {{bg: number[], hi: number[], accent: number[], amber: number[], green: number[], alert: number[], dark: boolean} | null} */
var xoLiveCache = null;

/** Reads the theme colours the palette needs (call when the theme may have changed). */
function xoLiveRefresh() {
  const bg = xoLiveColor("live_lcd_bg");
  const dark = xoLum(bg) < 0.5;
  const title = xoLiveColor("live_lcd_title");
  // text end of the ramp: the theme's LCD title colour, pushed away from the background when the two are close
  let hi = xoMixRgb(title, dark ? [1, 1, 1, 1] : [0, 0, 0, 1], 0.3);
  if (Math.abs(xoLum(hi) - xoLum(bg)) < 0.35) hi = dark ? [0.85, 0.85, 0.85, 1] : [0.15, 0.15, 0.15, 1];
  xoLiveCache = {
    bg: bg, hi: hi, dark: dark,
    accent: xoLiveColor("live_control_selection"),
    amber: xoLiveColor("live_lcd_control_fg"),
    green: xoLiveColor("live_display_line_two"),
    alert: xoLiveColor("live_alert")
  };
}

/**
 * Live palette: a colour of the original (blue) look -> the Live theme.
 * Saturated colours by hue: cyan / blue = the accent (live_control_selection), amber = live_lcd_control_fg, red / pink =
 * live_alert, green = live_display_line_two. Everything else (the slate neutrals and white) is mapped by luminance onto
 * the ramp live_lcd_bg .. text colour. Alpha is kept.
 * @param {number} r @param {number} g @param {number} b @param {number} a
 * @returns {number[]}
 */
function xoLiveMap(r, g, b, a) {
  if (!xoLiveCache) xoLiveRefresh();
  const L = /** @type {NonNullable<typeof xoLiveCache>} */ (xoLiveCache);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn > 0.25 && mx > 0.5) {
    let h;
    const d = mx - mn;
    if (mx === r) h = 60 * (((g - b) / d + 6) % 6); else if (mx === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4);
    const c = (h >= 330 || h < 15) ? L.alert : (h < 70 ? L.amber : (h < 150 ? L.green : (h < 175 ? L.green : L.accent)));
    return [c[0], c[1], c[2], a];
  }
  const t = Math.max(0, Math.min(1, xoLum([r, g, b])));
  return [L.bg[0] + (L.hi[0] - L.bg[0]) * t, L.bg[1] + (L.hi[1] - L.bg[1]) * t, L.bg[2] + (L.hi[2] - L.bg[2]) * t, a];
}

/**
 * Live palette category colour: a fixed hue per category, lightness chosen for the LCD background (lighter on a dark theme,
 * darker on a light one); "ALL" = the text colour, "none" = a quiet neutral between the background and the text colour.
 * @param {string} id
 * @returns {number[] | null}
 */
function xoLiveCat(id) {
  if (!xoLiveCache) xoLiveRefresh();
  const L = /** @type {NonNullable<typeof xoLiveCache>} */ (xoLiveCache);
  if (id === "ALL") return xoMixRgb(L.bg, L.hi, 0.85);
  if (id === "none") return xoMixRgb(L.bg, L.hi, 0.38);
  const h = XO_LIVE_CAT_HUES[id];
  if (!h) return null;
  return L.dark ? xoHsl(h[0], 0.58, 0.62 + h[1]) : xoHsl(h[0], 0.62, 0.40 - h[1]);
}

/** Theme-change Task (one per v8ui, only while the Live palette is active). */
var xoLiveTask = null;
var xoLiveKey = "";

/** Starts the 1 s watcher: when Live's theme colours change, the cache is re-read and xoLiveThemeChanged() is called. */
function xoLiveWatch() {
  if (xoLiveTask || typeof Task === "undefined") return;
  xoLiveKey = xoLiveThemeKey();
  xoLiveTask = new Task(function () {
    if (xoPaletteName !== "Live") { xoLiveWatchStop(); return; }
    const k = xoLiveThemeKey();
    if (k === xoLiveKey) return;
    xoLiveKey = k;
    xoLiveRefresh();
    if (typeof xoLiveThemeChanged === "function") xoLiveThemeChanged();
  });
  try {
    xoLiveTask.interval = 1000;
    xoLiveTask.repeat();
  } catch (e) { xoLiveTask = null; }
}

function xoLiveWatchStop() {
  if (!xoLiveTask) return;
  try { xoLiveTask.cancel(); } catch (e) {}
  xoLiveTask = null;
}

/** @param {string} name */
function xoPaletteSet(name) {
  xoPaletteName = XO_PALETTES[name] ? name : "default";
  if (xoPaletteName === "Live") { xoLiveRefresh(); xoLiveWatch(); } else xoLiveWatchStop();
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
  if (xoPaletteName === "Live") return xoLiveMap(r, g, b, a);
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
  if (xoPaletteName === "Live") {
    var lc = xoLiveCat(id);
    return lc ? [lc[0], lc[1], lc[2], base.length > 3 ? base[3] : 1.0] : base;
  }
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
 * Chrome colours with a meaning (v8ui section titles, mini buttons). The Live palette answers with Ableton's neutral control
 * look: "title" = live_lcd_title, "frame" = live_lcd_frame, "btn" = a flat control fill (live_control_bg lifted off the LCD background), "btntext" =
 * the control text colour; every other palette (and any other role) paints the given colour through xoSrc as before.
 * @param {string} role
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 */
function xoRole(role, r, g, b, a) {
  if (xoPaletteName === "Live") {
    if (!xoLiveCache) xoLiveRefresh();
    const L = /** @type {NonNullable<typeof xoLiveCache>} */ (xoLiveCache);
    let c = null;
    if (role === "title") c = xoLiveColor("live_lcd_title");
    else if (role === "btn") c = xoMixRgb(L.bg, L.hi, 0.2);
    else if (role === "btntext") c = xoLiveColor("live_control_fg");
    else if (role === "frame") { c = xoLiveColor("live_lcd_frame"); mgraphics.set_source_rgba(c[0], c[1], c[2], 1.0); return; }
    if (c) { mgraphics.set_source_rgba(c[0], c[1], c[2], 1.0); return; }
  }
  xoSrc(r, g, b, a);
}

/**
 * Section title text: upper case in the LCD / Focus looks, title case in the Live look.
 * @param {string} upper
 * @param {string} mixed
 * @returns {string}
 */
function xoTitleText(upper, mixed) {
  return xoPaletteName === "Live" ? mixed : upper;
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
