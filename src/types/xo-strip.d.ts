// Globals that scripts/build_xo_map.py prepends to the mini-map v8ui (src/xo_strip_ui.js).
/** Section-layout box id -> scripting name (varname) in the device patcher. */
declare const XO_LAYOUT_NAMES: { [boxId: string]: string };
/** Theme names (src/xo_layouts/default.js defines it; the variant layouts do not: guard with typeof). */
declare var XO_THEMES: string[];
/** Per-theme colours / fonts / texts of the shared boxes: {theme: {box id: {attribute: value | number[]}}} (themed layout only). */
declare const XO_THEME_STYLE: { [theme: string]: { [boxId: string]: { [attr: string]: any } } };
