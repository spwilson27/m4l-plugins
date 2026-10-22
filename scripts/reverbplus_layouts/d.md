# Reverb+ D: "Display + grouped strip"

632 x 169. Display v8ui 624 x 95 (waterfall wide and short, right panel with the dry/wet strip, band readout, PRE / LOOP / FROZEN / CLIP, IR name + browse / clear), then one row of 12 controls in four bracketed groups.

- Page 1: SPACE (Algorithm, Pre-Delay, Size, Decay) | TONE (HF Damp, Low Cut, High Cut) | LOOP (Loop, Loop Time) | MIX (Freeze, Width, Dry/Wet). 12 value controls + 4 titles.
- Page 2 (click the bracket title; "NAME >" / "< NAME", one hidden UI-state parameter per group `pg_space|tone|loop|mix`, so groups swap independently): SPACE Early, Diffusion, Mod Rate, Mod Depth; TONE Bass Mult, Crossover, Late; LOOP Clip Level, Clip Mode; MIX Output, Duck, Duck Rel.
- Convolution: SPACE page 1 shows IR Stretch instead of Size; page 2 shows IR File, IR Start, IR Decay, IR Reverse. Decay / Freeze (and Bass / Crossover / Early on Plate, Spring) are greyed with `active 0`.
- Nothing is off-face. Algorithm is a live.menu in the row (the icons of the shipped face are gone).
- Face files: `src/reverbplus_face_d.js`, `src/reverbplus_face_d_math.js` (copies of the shipped ones with new geometry). Page logic is computed in the face (`dHidden`) and sent on outlet 1 (`g_<group> <hidden>`, `act_<key> <0|1>`) -> route -> `prepend hidden` / `prepend active`; python mirror `hidden_groups` in d.py (tested).
- Preview pages: `REVERBPLUS_D_PAGE=space2|tone2|loop2|mix2|conv|conv2` at build time (+ `RC_PREVIEW=conv` for the display), then render_preview.

## Contract requests / rough edges
- `scripts/render_preview.py` draws every `live.line` horizontally, so the vertical ticks and separators show as small dashes in the PNG; in Live they are vertical (Delay+ does the same). Not verifiable in the preview.
- Preview ignores dial `fontsize` (8 pt here) and greying (`active 0`) of dials, so labels look wider than in Live.
- Title toggles bind `live_lcd_title` for the lines and `live_surface_bg` for the title chip; in Live the chip should blend into the surface (preview shows it as a lighter chip).
- Only one-click-per-group pages: no way to see two pages of one group at once; clicking a title is the only affordance (the `>` marks it).
- Live-only checks not done (host gate only): saved `pg_*` restore outputs `set_pg_*`, `active` message on live.dial / live.drop.
