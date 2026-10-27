# Amp face — the design contract

The Neural Amp is one engine (NAM / Tone 3000 `.nam` models in a generated gen~, tone stack, cab,
gate, telemetry) plus one face (`neural`; the other four prototypes were removed). The design system
stays so another face could be added. A design is two or three files:

- `scripts/amp_designs/<slug>.py` — layout module (fields documented at the top of `scripts/build_amp.py`)
- `src/amp_face_<slug>.js` — the face script (concatenated after `src/amp_config.js` and `src/amp_engine.js`
  into the device's single main v8ui `obj-viz`)
- `tsconfig.amp-<slug>.json` — typecheck group (copy `tsconfig.amp-neural.json`, swap the face file)

Reference implementation: `scripts/amp_designs/neural.py` + `src/amp_face_neural.js`.
Do not edit shared files (`src/amp_config.js`, `src/amp_engine.js`, `src/amp_core.genexpr`,
`scripts/build_amp.py`, `tests/test_amp_face.js`); ask for a change instead.

## Gate (run all, in this order)

```bash
npx tsc -p tsconfig.amp-<slug>.json
python3 scripts/build_amp.py <slug>
node tests/test_amp_face.js <slug>
python3 scripts/render_preview.py "devices/<DEVICE>.amxd"   # then LOOK at previews/<file>.png
```

## Engine API the face uses (see the header of `src/amp_engine.js`)

- `ampP[key]` raw values; keys and ranges in `AMP_PARAMS` (`src/amp_config.js`):
  `model` (enum Clean / Crunch / Lead / File), `gain` (-24..24 dB, into the model), `gate` (-100..-20 dB,
  -100 = off), `bass` `mid` `treble` `presence` (0..10, 5 = flat), `cab` (enum Off / 1x12 / 4x12 / 2x12),
  `stereo` (enum Mono / Stereo), `volume` (-40..12 dB), `mix` (0..100 %, Dry/Wet).
- `ampSet(key, v)` sets a parameter through its live.* object (clamped / rounded for you).
- `ampBrowse()` opens the file dialog (the "Load .nam" action). `ampModelNames()` = Model enum labels,
  the loaded file's name as entry 3.
- `amp.model` = `{name, label (e.g. "Feather · 3.0k"), kind ("WaveNet" | "LSTM"), layers, rf, error, file}`;
  `amp.dsp` = `{ready, error}` (show "loading" / the error somewhere small).
- Telemetry, refreshed by the engine at ~30 Hz: `ampTel` = `{in_pk, out_pk, in_rms, out_rms, gate (gate gain 0..1),
  sat (mean |activation| of the first layer array, 0..~1), nam_pk, asleep, switching, sr, ...}`;
  `ampLayers()` per-layer activity (array, length = layer count, values ~0..1);
  `ampXY(n)` the last n `[input, model output]` pairs (n <= 512, one pair per 4 samples);
  `ampOutRing(n)` the last n output samples (n <= 2048) for scopes / FFTs;
  `ampToneCurve(f)` dB of tone stack + cab at f Hz.
- Hooks the face MUST define: `ampFaceFrame()` (return true to redraw on a new telemetry frame; the
  engine stops redrawing after ~1.5 s of silence by itself) and `ampFaceChanged(what)` (called after a
  parameter / model / file change; may be empty).
- `preview()` MUST call `ampPreviewSetup(drive)` (fake telemetry) and may set `ampP` values so the
  committed preview shows the face in use.
- The engine owns `anything()`, `setnames()`, `init_dsp()`, `dropfile()`, `browsed()` and calls
  `mgraphics.init()` / `relative_coords = 0` / `autofill = 0`. Do not define those. Define `paint`,
  `onclick(x, y, but, cmd, shift, capslock, option, ctrl)`, `ondrag(...)` (button 0 = release),
  `ondblclick`, `onidle`, `onidleout` as needed. Never declare Max globals (`box`, `patcher`, `max`,
  `messagename`, `inlet`, `jsarguments`) as variables (AGENTS.md 8). Prefix every top-level name with
  your own short prefix (functions and vars share one scope with the engine).

## Preview renderer limits (`scripts/render_preview.py`, also what the tests mock)

Supported mgraphics calls: `set_source_rgba`, `set_line_width`, `rectangle`, `rectangle_rounded`,
`move_to`, `line_to`, `curve_to`, `close_path`, `arc`, `ellipse`, `fill`, `fill_preserve`, `stroke`,
`select_font_face`, `set_font_size`, `text_measure`, `show_text`, `save`, `restore`, `translate`,
`rotate`. Anything else (patterns, gradients, `scale`, `set_line_cap`, `text_path`, images) crashes the
preview. `arc` always renders as a FULL circle in the preview: draw partial arcs (knob rings, gauges)
as `line_to` polylines. `rectangle_rounded` ignores `translate` in the preview: avoid translate around it.

## Rules

- Height is 169 px; everything inside the device width. No presentation live.* widget may overlap the
  interactive v8ui (AGENTS.md 4): put native widgets outside `VIZ`.
- Every parameter must be reachable: an on-face live.* widget (`WIDGETS`) or a control the face draws
  that calls `ampSet`. There must be a Load control (`ampBrowse()`) or a visible `DROP` zone.
- Audio reactive: the main graphic must move with the telemetry.
- Text never clipped or overlapping; small controls use vector glyphs.
