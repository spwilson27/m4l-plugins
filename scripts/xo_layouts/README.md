# XO Sample Map layouts — contributor note

`devices/XO Sample Map.amxd` is ONE device with three switchable looks ("themes": **LCD**, **Focus** and **Live**), chosen at
runtime in its Options section (Live parameter `Theme`). There are no layout variants (the earlier experiments A..E were
removed). Its layout module is `default`: `scripts/xo_layouts/default.py` + `src/xo_layouts/default.js`, loaded by
`scripts/build_xo_map.py`.

- **Geometry** is `computeXoLayout(theme, saved, filters, playback, options)` in `src/xo_layouts/default.js` (theme = `"LCD"` |
  `"Focus"` | `"Live"` or its index). It returns every laid-out box as `{rect, hidden}` plus `sections` (box -> toolbar | options |
  left | filters | playback) and `themeOnly` (box -> the one theme it exists in). Keep it a global script (AGENTS.md 1c).
- `default.py` is its Python mirror (`layout_boxes`, used for the saved state = default theme with `DEFAULT_SECTIONS`;
  `tests/test_xo_layout.js` compares it with the JS for all 2 x 16 combinations), the per-theme style `THEME_STYLE`
  (`{theme: {box id: {attribute: value}}}`, injected as `XO_THEME_STYLE`), `WIDTH_EXPR` (`obj-expr-width`: plain arithmetic
  over `$i1..$i5`, no `if()` / commas: a comma inside an `expr` box must be escaped in Max) and `customize` (presentation-only
  extras: cells, labels, ticks, the Options header, the parameter mirrors and their wiring).
- **Adding a themed box:** add it to `layout_boxes` (Python) and `computeXoLayout` (JS) with its section and `only` tag, create it
  in `customize`, and give it a `varname`. **Adding a theme:** extend `XO_THEMES`, `XO_FILTERS_W` / `XO_PLAYBACK_W`, `THEMES`,
  `THEME_STYLE`, `WIDTH_EXPR`, the palette (`src/xo_palette.js`) and the Theme tab's enum (append, so saved sets stay valid).
  **Adding an option:** widen the Options panel first, then add the control and, if it must persist, an appended Live parameter
  (or a field of the XOStateData blob).
- **Parameter / mirror pairs** and everything else about the device: AGENTS.md section 4.
- Gate: `python3 scripts/build_xo_map.py && node tests/test_xo_map.js` (runs `tests/test_xo_layout.js`).
