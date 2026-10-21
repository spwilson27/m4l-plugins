# XO Sample Map layouts — contributor note

`devices/XO Sample Map.amxd` is ONE device with two switchable looks ("themes": **LCD** and **Focus**, the former variants D and E),
chosen at runtime in its Options section (Live parameter `Theme`). Its layout module is `default`
(`scripts/xo_layouts/default.py` + `src/xo_layouts/default.js`). Variants A..E build to `devices/XO Sample Map <V>.amxd` from the same
engine, v8ui scripts and parameter set; they are the earlier look experiments (D and E are the reference builds of the two themes;
A, B and C were not picked but still build and pass).

## The themed layout (`default`)
- **Geometry** is `computeXoLayout(theme, saved, filters, playback, options)` in `src/xo_layouts/default.js` (theme = `"LCD"` |
  `"Focus"` or its index). It returns every laid-out box as `{rect, hidden}` plus `sections` (box -> toolbar | options | left | filters |
  playback) and `themeOnly` (box -> the one theme it exists in). Hidden = its section is closed OR it belongs to the other theme.
  Toolbar | Options | map (+ Saved) | Filters | Playback are packed left to right (3 px after the toolbar, 6 px between sections); the
  map pane is `XO_MAP_PANE_W` 236 px wide and 154 px high in both themes, Filters / Playback are narrower in Focus.
- `scripts/xo_layouts/default.py` is its Python mirror (`layout_boxes`, used for the saved state = LCD, Options closed;
  `tests/test_xo_variants.js` compares it with the JS for all 2 x 16 combinations), the per-theme style `THEME_STYLE`
  (`{theme: {box id: {attribute: value}}}`: colours, fonts, button texts; injected as `XO_THEME_STYLE`, applied with `setattr` when
  the theme changes and on load), `WIDTH_EXPR` (`obj-expr-width`: plain arithmetic over `$i1..$i5` = saved filters playback options theme, no `if()` / commas:
  a comma inside an `expr` box must be escaped in Max) and `customize` (the presentation-only extras: LCD cells / labels, Focus ticks / labels, the
  Options header, the parameter mirrors and their `prepend set` wiring).
- **Adding a themed box:** add it to `layout_boxes` (Python) and `computeXoLayout` (JS) with its section and `only` theme, create it in
  `customize`, and give it a `varname` (the build does when missing). **Adding a theme:** extend `XO_THEMES`, `XO_FILTERS_W` /
  `XO_PLAYBACK_W`, `THEMES`, `THEME_STYLE`, `WIDTH_EXPR`, the palette (`src/xo_palette.js`) and the Theme tab's enum (appending
  keeps saved sets valid). **Adding an option:** put its control under `obj-lbl-theme` in the Options panel (below y = 62 there is
  room), as a new appended Live parameter.
- **Parameter / mirror pairs:** each value control is ONE parameter object (`live.numbox`, the old `live.dial` ids) shown in LCD, plus a
  non-parameter `live.dial` mirror (`<id>-mir`) shown in Focus, synced both ways without a loop (see AGENTS.md section 4).
- **Palette:** `src/xo_palette.js` (`XO_PALETTES`, `xoSrc`); `set_theme` selects it in the map and folder-list v8uis.

## Files a variant author owns (touch nothing else)
For variant `<V>` (A..E):
- `scripts/xo_layouts/<V>.py` — DATA for `scripts/build_xo_map.py`: `RECTS` (presentation rect of every layout box with all
  three sections shown), `STYLE` (per-box attribute overrides: colours, fonts, `pictures`, panel colours, `appearance`),
  `WIDTH_EXPR` (the `obj-expr-width` expression), `DEVICE_WIDTH`, and the optional `customize(boxes_by_id, boxes, lines)` hook
  (presentation-only boxes, swapping `maxclass` where equivalent, e.g. `live.dial` <-> `live.numbox` bar).
- `src/xo_layouts/<V>.js` — `computeXoLayout(saved, filters, playback)` geometry plus `XO_MAP_PANE_W`, `XO_SAVED_PANE_W`,
  `XO_DEVICE_H`. Its box ids must be exactly the keys of `RECTS`. Keep it a global script (AGENTS.md 1c). Variants keep this
  three-argument signature (no Options section, no themes; the v8ui detects it by the missing `XO_THEMES`).
- `tsconfig.xo-strip-<V>.json` — already provided (type-checks `<V>.js` with `src/xo_strip_ui.js` and `src/xo_palette.js`).
- Outputs (generated, do not hand-edit): `devices/XO Sample Map <V>.amxd`, `previews/xo_sample_map_<v>.png`.

Do **not** edit: `scripts/build_xo_map.py`, `src/xo_strip_ui.js` / `xo_folder_ui.js` / `xo_palette.js` / `xo_node_engine.js` /
`xo_stretch.js`, `scripts/render_preview.py`, the tests, `scripts/xo_layouts/default.py`, other variants' files. Needing a change
there? Ask the integrator; a shared change must keep every variant passing.

## Rules (enforced by `tests/test_xo_variants.js`)
- Parameter set, long names, ranges, defaults and order are identical in every device (presets / automation portable); `ShowOptions` and
  `Theme` are appended last and exist (off-face in the variants) everywhere. Only rects, `maxclass`/`appearance` where equivalent,
  colours, panels, labels and section behaviour may differ. The three toggle parameters `ShowSavedList` / `ShowFiltersSection` /
  `ShowPlaybackSection` must stay meaningful (a variant may show tabs instead of collapsing, but `computeXoLayout`'s 8 combinations
  and `obj-expr-width` must still agree).
- The toolbar (`obj-panel-toolbar` + the three icon toggles `obj-toggle-{saved,filters,playback}-btn`; the themed device adds
  `obj-toggle-options-btn` at the bottom) is always visible; compact (< 28 px) buttons are icons (`usepicture`), with a tooltip.
  Presentation height 169 px; every visible box inside the device and inside a visible panel; panels never partially overlap;
  background panels last; no `live.*` over an interactive v8ui.
- Every box in `RECTS` needs a scripting name (the build adds `varname` = id when missing). The map pane width must equal
  `XO_MAP_PANE_W (+ XO_SAVED_PANE_W when Saved is shown)`; the mini-map v8ui derives its drawing from its own size.

## Per-variant gate (replace C with your letter; run from the repo root)
```bash
npx tsc -p tsconfig.xo-strip-C.json && python3 scripts/build_xo_map.py --variant C && node tests/test_xo_variants.js C \
  && python3 scripts/render_preview.py "devices/XO Sample Map C.amxd"
```
Then Read `previews/xo_sample_map_c.png` and fix any truncation / overlap. In Live (VM only, waits on the shared Live lock):
`scripts/vm_xo.sh run C` must end with "all checks passed".

Full gate (integrator):
```bash
for c in xo-strip xo-node xo-folder xo-stretch xo-strip-A xo-strip-B xo-strip-C xo-strip-D xo-strip-E; do npx tsc -p tsconfig.$c.json; done \
  && python3 scripts/build_xo_map.py --all && node tests/test_xo_map.js && XO_STRETCH_QUICK=1 node tests/test_xo_stretch.js \
  && for v in "" " A" " B" " C" " D" " E"; do python3 scripts/render_preview.py "devices/XO Sample Map$v.amxd"; done
```
The default preview renders the saved state (LCD, Options closed). Focus and the Options-open state are rendered from scratch copies
(apply `computeXoLayout` + `XO_THEME_STYLE` to a copy of the device JSON, then reuse `render_preview.render_device`).
