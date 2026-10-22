# Reverb+ face b "Hybrid tabs" (device `Reverb+ B`, 520 x 169)

Files: `scripts/reverbplus_layouts/b.py`, `src/reverbplus_face_b.js`, `src/reverbplus_face_b_math.js`, `src/reverbplus_face_b_ir.js`,
`src/types/reverbplus-b-ir.d.ts`, `tsconfig.reverbplus-b.json`, `tsconfig.reverbplus-b-ir.json`, `tests/test_reverbplus_face_b.js`,
`previews/reverb_b*.png` (`reverb_b_<reverb|tone|tone_plate|loop|conv>.png`: `RCB_PAGE=0..2 RCB_ALGO=0..5` at build AND render time).

Layout: fixed left column (Pre-Delay, Loop, Loop Time), fixed right column (Width, Freeze, Dry/Wet), centre display with page tabs
(hidden UI-state `Reverb Page`), the display v8ui, a hairline and an LCD row of real live.* widgets (label above value).
Visible controls: Reverb 12 (Conv 12), Tone 12 (Plate 10), Loop 9, counting the 6 fixed ones and the tab.

Off the face: Mod Rate, Early, Late, Ducking, Duck Release, Output (rare / set once; see `OFF_FACE` in b.py).

Rough edges: scripts/render_preview.py draws a vertical `live.line` as a short dash and ignores `parameter_units` (Decay shows `2` not
`2.50 s`); both are fine in Live. The IR drop is a transparent live.drop over an ignoreclick name field (rule 4 exception); browse /
clear are a second small v8ui beside it. Hidden widgets rely on `prepend hidden` reaching v8ui / live.line boxes (as Delay+ does).

Contract requests: none. (A `hidden` for v8ui entries and a `preamble` were already supported.)
