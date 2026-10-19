# Ableton Max for Live Devices (`devices/*.amxd`)

A collection of custom Max for Live devices for **Ableton Live 12 Suite (Max 9.1+)**:

1. **`devices/XO Sample Map.amxd`** — An XLN Audio XO–inspired 2D Drum Sample Space Browser, Auto-Categorizer, Similarity Explorer, and Simpler / Drum Rack Pad Loader (`Node for Max` + `jweb` pop-out window + in-device `v8ui` mini-map + `LiveAPI`).
2. **`devices/Tiny Space.amxd`** — A "tiny space" reverb (20 delay lines) with Size, Damp, Width, Dry/Wet, Feedback, Pre-delay, Modulation, Crossfeed, and HP/LP. A Seed (0–1000) scales active delay-line density from 4 up to 20 lines and picks delay times and diffusion character. Vibrating delay-line display.
3. **`devices/Better Shaper.amxd`** — A Bitwig Studio–inspired MSEG curve modulator with audio-rate wavetable lookup, loop sub-regions, step-brush painting, S-curves, undo/redo history, and an 8-slot modulation matrix.
4. **`devices/Sand.amxd`** — A differential compander. It expands quiet parts of the signal’s derivative (orders −1 through 15) and soft-limits the peaks, with a movable filter, split dry/wet, and a final clip/limit stage.
5. **`devices/Reciprocator.amxd`** — An upgraded reciprocal envelope dynamics & audio-rate waveshaping processor (`x / env^amount`) with a smooth noise gate floor, lookahead delay, Peak/RMS detector blend, sidechain HP/LP filters, soft-clip ceiling, and a live scrolling envelope/gate/output HUD.
6. **`devices/Better GrainSpec.amxd`** — A Max for Live Instrument (`iiii`) inspired by Woulg's *WR-GrainSpec*, combining adjustable onset slicing across 128 MIDI notes (or chromatic keyboard playback), punch-preserving transient pass-through, a 4-voice Granular to Phase-Locked Spectral stretch engine, a pitch-matching stereo feedback comb filter, live audio capture, and an interactive waveform/slice editor.
7. **`devices/Percipitator.amxd`** (`380 x 169` px) — A 16-band scale-quantized wavetable resynthesizer inspired by Woulg's *WR-Percipitator*, featuring a 4-frame `Sine -> Triangle -> Saw -> Square` wavetable bank, scrollable phase warp (`Bend`, `Asym`, `Sync`, `Fold`) & Partial Sieve (`All`, `Odd`, `Even`, `Sprs`, `Rise`) selectors, Spectral Tilt, `±2000 Hz` Frequency Shift, horizontal value-bar sliders for `Vol` and `Mix`, Sidechain MIDI pitch locking, and an audio-reactive Partials Viewer + 12-Note Scale Strip UI.

---

## 1. XO Sample Map (`devices/XO Sample Map.amxd`)

An XLN Audio XO–style 2D sample constellation browser and sample exporter that analyzes drum & one-shot folders, clusters samples by acoustic similarity, and lets you scrub-audition, shape (`Pitch`, `Trim/Decay`, `Gain`), save a curated list of samples with their associated playback settings, and drag them out of the device as either **Raw** or **Edited** (re-rendered with Pitch/Trim/Gain applied) audio files.

### Features
- **Dual UI (Compact In-Device Mini Editor + Large Pop-Out `jweb` Sample Space Window)**:
  - **In-Device Mini Editor (`v8ui`, `372 x 134` px)**:
    - **Left Pane (`x = 0..244`)**: 24-bar waveform viewer with a **live scanning playhead line**, interactive 2D sample constellation map with k-NN similarity lines, drag-to-scrub auditioning, and a 12-item geometric vector icon toolbar (`All`, `Kick`, `Snare`, `Hihat`, `Clap`, `Tom`, `Cymbal`, `Perc`, `FX`, `Prev Similar`, `Next Similar`, `Random`).
    - **Right Pane (`x = 237..372`) — Scrollable Saved Samples List & OS File Drag-Out Dock**: Displays saved samples alongside their captured playback settings (`Pitch`, `Trim/Decay`, `Gain`). Supports scrolling (scrollbar track/thumb & wheel), clicking to select/recall, vertical drag-to-reorder, deleting items (`[×]` button or `Delete`/`Backspace` key), a `+Save` button (`S` hotkey), per-item **`[R]` (Raw)** and **`[E]` (Edited)** OS file drag handles, and bottom **`[Drag Raw]`** / **`[Drag Edit]`** batch OS file drag zones.
  - **Pop-Out Floating Window (`p XOMapWindow`, `1040 x 680` px `jweb` Canvas)**: High-DPI 60fps HTML5 Canvas with smooth wheel/pinch zoom, pan, hover tooltips, color mode switcher (`Category`, `Brightness`, `Pitch`, `Duration`), 4-band spectral analyzer (`SUB`, `LOW`, `MID`, `HIGH`), animated waveform scanning playhead, and full Saved Samples Raw/Edited drag-out sidebar.
- **Visibly Separate Filters vs. Playback Controls**:
  - **`FILTERS` Panel (`x = 392..530`)**: Dedicated cyan-bordered panel housing the **Search Textbox** (`textedit` + `Clr` button for filtering by sample name), **`MaxLen`** dial (`50 ms` up to **Infinite / `Inf`** at max), **`Tone`** dial (`-100% Dark` to `+100% Bright`), and filter-aware **`< Sim`**, **`Sim >`**, and **`Rand`** buttons.
  - **`PLAYBACK` Panel (`x = 536..674`)**: Dedicated amber-bordered panel housing **`Audition / Replay`**, **`Pitch`** (`-24 st` to `+24 st`), **`Trim/Dec`** (`20 ms` to `5000 ms`), and **`Gain`** (`-36 dB` to `+12 dB`).
- **True Dual-Channel Audio Playback & Native macOS OS File Drag-Out (`src/xo_node_engine.js`)**:
  - **Mono-Safe Stereo Playback (`selector~ 2 1`)**: Automatically routes 1-channel (mono) samples to both Left and Right outputs while preserving true L/R stereo on 2-channel files, with ordered `open -> speed -> start` triggering and unattenuated unity gain unless `Trim/Dec` is shorter than the sample.
  - **Native macOS `NSDraggingSource` Helper & OS File Links**: Creates OS file links in `/tmp/xo_sample_map_exports/Raw/` and stereo 16-bit PCM re-rendered WAV files in `/tmp/xo_sample_map_exports/Edited/`, and uses a compiled Cocoa `NSDraggingSource` helper so dragging from `[R]`, `[E]`, `[Drag Raw]`, or `[Drag Edit]` initiates a native macOS Finder file drag directly into Ableton Live tracks, Drum Racks, or Simplers.

---

## 2. Tiny Space (`devices/Tiny Space.amxd`)

A Max for Live **Audio Effect** reverb — a "tiny space" ranging from tight comb-spaces to a small room. Built around a **gen.codebox~** feedback-delay network (20 delay lines) with a seed-driven configuration.

### Features
- **Controls**: Size, Damp, Width, Dry/Wet (Mix), Feedback, Pre-delay, Modulation, Crossfeed, HP/LP, **Seed** (0–1000), and **Character** (`COMB`, `HYBRID`, `ROOM`, `PLATE`, `TANK`, `BOX`, `SPRING`, `BOUNCE` dropdown selection box). Knobs stay put when the seed or character changes.
- **Seed & 8 Room Models**: Deterministic mulberry32 config (`0..1000`). Lower seed values use fewer delay lines (starting at 4 lines: 2 L + 2 R) and higher seeds increase monotonically up to the 20-line cap (10 L + 10 R). The `Character` selector switches across 8 acoustic/algorithmic room models (`COMB` parallel metallic lines, `HYBRID` comb-to-Householder blend, `ROOM` diffused Householder small room, `PLATE` Hadamard/velvet plate, `TANK` Dattorro figure-8 daisy-chained ring loop, `BOX` 3D shoebox standing-wave eigenmodes, `SPRING` dispersive allpass chirp tube, and `BOUNCE` geometric reflection cluster).
- **Visualization**: 20 vibrating strings (`v8ui`) with the 10 Left (cyan) and 10 Right (amber) delay lines overlaid in a single unified field. Amplitude follows each line's envelope; inactive lines are dim stubs.
- **gen.codebox~ core**: Predelay, HP/LP, seeded allpasses, 20 fractional delays, crossfeed, damping, soft clip, width, equal-power dry/wet. A seed change ducks the tank for 160 ms.

### Files
- `src/tinyspace_config.js` — seeded config and the float layout shared with gen
- `src/tinyspace_ui.js` — v8ui strings, config poke, meter peek
- `src/tinyspace_core.genexpr` — Gen core
- `scripts/build_tinyspace.py` — builds `devices/Tiny Space.amxd`
- `tests/test_tinyspace.js` — config invariants and device structure
- `previews/tiny_space.png` — rendered preview

### Rebuild & Test
```bash
python3 scripts/build_tinyspace.py && node tests/test_tinyspace.js && python3 scripts/render_preview.py "devices/Tiny Space.amxd"
```

---

## 4. Sand (`devices/Sand.amxd`)

A Max for Live audio effect that compands the derivative of the input. Quiet motion gets louder, peaks get soft-limited, and the result sits somewhere between grit, a strange high-pass, and extracted detail.

### Features
- **Order** −1..15. −1 integrates, 0 is the raw signal, 1..15 stack differentiators. Each stage peaks at unity at Nyquist, so higher orders keep only the top of the spectrum.
- **Amount** (`0..140 dB` quiet-lift) and **Freq** (`20 Hz..18 kHz` filter cutoff) as automatable HUD value boxes above the scope (also draggable directly inside the XY scope).
- **Out** selection slider/box in the graphic header to switch between `Off`, `Hard` (`±1` clip), and `Limit` (fast limiter).
- **Single-Column Right Panel**: **Filter** (native LP/BP/HP curve icons and `Pre`/`Diff`/`Post` placement) on top, **Soft** (`%`) and **Debrick** (`%`) horizontal value bars in the middle, and **Mix** (`%`) dial at the bottom.
- **Audio-Reactive Scope** with sand grain particle cloud, compander transfer curve inset, and dual `G`/`O` meters.

### Files
- `src/sand_core.genexpr` — Gen core
- `src/sand_ui.js` — scope
- `scripts/build_sand.py` — builds `devices/Sand.amxd`
- `scripts/run_sand_audio_tests.py` — renders audio in Max
- `tests/test_sand.js` — device structure
- `previews/sand.png` — rendered preview

### Rebuild & Test
```bash
python3 scripts/build_sand.py && node tests/test_sand.js && python3 scripts/render_preview.py "devices/Sand.amxd"
```

---

## 5. Reciprocator (`devices/Reciprocator.amxd`)

A Max for Live **Audio Effect** dynamics and waveshaping processor inspired by the classic "cuntpressor" / Woulg *Reciprocator* (`x / env`), upgraded with continuous reciprocal exponent (`Amount`), a smooth noise gate floor (`Gate`), lookahead delay (`Lookahead`), Peak/RMS detector blend (`Detect`), sidechain HP/LP filtering, and a `tanh` soft-clipping ceiling.

### Features
- **Compact 3-Stage Signal-Flow Layout (`448 × 169` px)**:
  - **Left Interactive Scope (`162 × 132` px `v8ui`)**: Displays the input silhouette, cyan `ENV` follower, amber `OUT` waveform, live `1/E` dB gain + `OPEN`/`MUTE` bar meter, and **directly draggable `Gate` and `Ceiling` threshold bars** synced bidirectionally with the dials.
  - **`1. DETECT` Stage (Cyan Card)**: `Attack` (`0.05..250 ms`) and `Release` (`0.5..1500 ms`) dials on top, with stacked `HP` (`SC HP` `20..2000 Hz`), `LP` (`SC LP` `400..18000 Hz`), `RMS` (`Detect` `0..100%` Peak-to-RMS + stereo link), and `Look` (`Lookahead` `0..10 ms`) numboxes below.
  - **`2. 1 / ENV` Stage (Coral Card)**: Stacked `Amount` (`0%..150%` reciprocal exponent, morphing from unity `0%`, to flat `1/env` sustain `100%`, to inverted dynamics `150%`) and `Gate` (`-72..-6 dB` smooth cubic noise floor) dials.
  - **`3. OUTPUT` Stage (Amber Card)**: `Ceiling` (`-18..0 dB`) dial, `Soft Clip` (`tanh` vs hard ceiling) toggle, and `Mix` (`0..100%` lookahead-aligned equal-power dry/wet) dial.

### Files
- `src/reciprocator_config.js` — shared reciprocal math & gate helpers
- `src/reciprocator_core.genexpr` — `gen.codebox~` DSP core & scope telemetry writer
- `src/reciprocator_ui.js` — interactive scrolling envelope/gate/output HUD (`v8ui`)
- `scripts/build_reciprocator.py` — builds `devices/Reciprocator.amxd`
- `scripts/run_reciprocator_audio_tests.py` — automated Max audio test harness (`bypass`, `flatten`, `gate_mute`, `audiorate`, `ceiling`, `invert`)
- `tests/reciprocator_probe.js` — Max audio recording & scope buffer probe
- `tests/test_reciprocator.js` — unit, layout, patchline & UI interaction verification suite
- `previews/reciprocator.png` — rendered 2x Retina preview

### Rebuild & Test
```bash
python3 scripts/build_reciprocator.py && node tests/test_reciprocator.js && python3 scripts/render_preview.py "devices/Reciprocator.amxd"
python3 scripts/run_reciprocator_audio_tests.py
```

---

## 3. Better Shaper (`devices/Better Shaper.amxd`)

A Max for Live Audio Effect modulator device that replaces Ableton's stock **Shaper** MSEG editor with a fast, fluid **Bitwig Studio–inspired MSEG curve editor**, audio-rate wavetable modulation, and an 8-slot modulation matrix.

### Features
- **Bitwig-Style MSEG Editor (`v8ui` + `mgraphics`, `436 × 169` px 2-Panel Footprint)**:
  - **Single-Click Point Creation & Double-Click Deletion**.
  - **Tension Curves & Per-Segment S-Curves**:
    - **`Alt/Option + drag`** (or midpoint handle drag) bends the tension curve of a segment. When **multiple nodes are selected**, `Alt/Option + drag` adjusts the slope of **each selected segment's curve** simultaneously.
    - **`Double Alt/Option + click`** on any curve segment switches that segment between **Exponential (`sCurve = 0`, diamond midpoint handle)** and **Symmetric S-Curve (`sCurve = 1`, cyan circular midpoint handle)**.
  - **Point Overwriting ("Eat Points" on Drag)** & **Marquee Box Selection** with vertical bounding-box scaling.
  - **Keyboard Shortcuts When Focused**: `Cmd+A` (Select All points), `Delete` / `Backspace` (Delete selected interior points), `Cmd+Z` / `Cmd+Shift+Z` (Undo / Redo), `Escape` (Clear selection).
  - **Paint / Draw Step Brush Mode** (`Step`, `Ramp`, `Decay`, `Tri`, and continuous multi-point `Free` brushes).
  - **9-Icon Bottom Toolbar + Built-In `Grid` & `Snap` Controls**:
    - `Undo (<)`, `Redo (>)`, `Draw`, `Brush Shape`, `Sine`, **`Randomize Ramps`** (generates random grid-quantized exponential decay ramps spanning `1–3` grid steps), **`Randomize Steps`** (generates random grid-quantized flat steps spanning `1–3` grid steps), `Randomize Smooth Curve`, and `Reverse Horizontally (Flip X)`.
    - Built-in **`Grid [ 1–16 ]`** (drag vertically, click to step, double-click to reset to `8`) and **`[ Snap ]`** controls rendered directly inside `v8ui` and synced bidirectionally with Ableton Live parameters.
  - **Draggable Loop Start / Loop End Region Markers** & **64-Step Undo / Redo History**.
- **Audio-Rate Wavetable Engine, Timeline Sync & 8-Slot Modulation Matrix**:
  - 4096-sample `buffer~` (`#0-mseg`) read via `index~`, with `Rate` (`Hz` or **Timeline-Aligned `Sync`** locked to Ableton Live's 1-PPQ arrangement position via `plugsync~`), `Jitter`, `Smooth`, `Depth`, `Phase`, `Retrigger (R)`, and `Offset`.
  - **Native In-Panel Multimap Toggle (`≡` / `—`)**:
    - Slot 1 (`Map`, `Mod`/`Remote`, `±`/`+`, `50 %`) and the top-right **`≡` / `—` Multimap button** are always visible at the top of the Left Panel.
    - Clicking **`≡`** switches the Left Panel from the **MSEG Editor + Grid/Snap view** to the **8-Slot Modulation Matrix view** (hiding the MSEG canvas and the `Grid` / `Snap` controls, and showing Slots 1–8 plus the bottom `Parameter   Mode   — Range —` labels).
  - **Live 12 Native Shaper Right Panel Layout**:
    - **Top Dark LCD Box**: Full-width oscilloscope, Row 1 (`Jitter 0 %`, `Smooth 0 %`), and Row 2 (circular `(R)` Retrigger button, `Ø` Phase `0.00 %`, and `Offset 0 %`).
    - **Middle Playback Mode Row**: **`[ Loop ] [ 1-Shot ] [ Manual ]`** mode selector (continuous LFO, single-shot cycle triggered by `(R)`, or direct manual `Ø` phase scrubbing).
    - **Bottom Row**: **`Rate`** dial (`1/4` / `Hz`) connected by a tick mark `-` to stacked **`Hz` / Metronome** buttons, and **`Depth`** dial (`100 %`).
  - **Per-Slot Modern Modulation (`Mod`) vs. Legacy Takeover (`Remote`)**:
    - In **`Mod`** mode (`live.modulate~`), each slot displays a **Bipolar (`±` / `+`) button** and a **single Modulation Amount (`-100%` to `+100%`, default `50%`)** percentage numbox.
    - In **`Remote`** mode (`live.remote~ @normalized 1`), each slot switches to **`Min` (`0%–100%`)** and **`Max` (`0%–100%`)** range numboxes.

---

## 6. Better GrainSpec (`devices/Better GrainSpec.amxd`)

A Max for Live **Instrument** (`iiii`) inspired by Woulg's *WR-GrainSpec*, combining onset-based 128-note sample slicing with transient preservation, a 4-voice Granular to Phase-Locked Spectral/Monophonic stretch engine, a pitch-matching stereo feedback comb filter, live track audio capture, and an interactive waveform/slice editor.

### Features
- **Interactive Waveform & Slice Editor (`v8ui`)**:
  - Pre-populates `buffer~ #0-gssample` with a synthesized 2-second breakbeat/glitch loop on load so it plays out of the box.
  - Adjustable onset detection (`Sens` `0%..100%`) plus manual slice editing (click to select/audition, drag marker to move boundary, double-click to insert or delete slice markers, full Undo/Redo history).
  - Switchable **`128` (128 Slice Map)** and **`Key` (Chromatic Pitch)** keyboard modes.
- **Transient Preservation (`Trans` `0%..100%`)**: Plays the initial transient of each triggered slice at 1:1 unstretched rate with a raised-cosine crossfade into the stretched body so beats stay punchy even at `0%` (frozen) speed.
- **Granular <-> Spectral Stretch (`Speed`, `Grain`, `Morph`, `Jitter`)**: Crossfades between 4 overlapping Hann-windowed granular streams (`Morph = 0%`) and a phase-locked fundamental-quantized harmonic resonator stretch (`Morph = 100%`).
- **Pitch-Matching Stereo Comb Filter & Crush (`Pitch`, `CombMix`, `CombFbk`, `Crush`, `Mix`)**: Automatically tunes the comb filter to each slice's detected fundamental pitch (or played MIDI note in Chromatic mode).

### Files
- `src/grainspec_slicer.js` — default breakbeat loop synthesizer, high-frequency flux onset detector, autocorrelation pitch estimator, and MIDI mapper
- `src/grainspec_core.genexpr` — `gen.codebox~` DSP engine and telemetry writer
- `src/grainspec_ui.js` — interactive waveform, slice editor, vector toolbar, and grain/playhead visualizer
- `scripts/build_grainspec.py` — builds `devices/Better GrainSpec.amxd`
- `scripts/run_grainspec_audio_tests.py` — automated Max 9 audio & telemetry test suite
- `tests/test_grainspec.js` — unit, layout, and UI interaction test suite
- `previews/better_grainspec.png` — rendered 2x Retina preview

---

## 7. Percipitator (`devices/Percipitator.amxd`)

A Max for Live **Audio Effect** 16-band scale-quantized wavetable resynthesizer inspired by Woulg's *WR-Percipitator* in a **`380 x 169` px** horizontal value-bar layout.

### Features
- **16-Band Resonant Spectral Analysis & Graphical Gate (`Gate`, `Decay`, `Atk`, `Blur`)**: Tracks amplitude and instantaneous pitch across 16 log-spaced bands (`92.5 Hz..7040 Hz`), spawning resonant harmonic droplets above the adjustable `G -42dB` Gate line inside the Partials Viewer.
- **Interactive 12-Note Scale Strip & Sidechain MIDI Pitch Control (`Snap`, `Pitch`, `Strch`, `Shift`)**:
  - Click notes directly in the bottom 12-note keyboard strip (`C..B`) or route any MIDI track to **Percipitator** in Ableton Live: incoming MIDI notes (`midiin` $\to$ `midiparse` $\to$ `midi_in`) automatically define and latch the active pitch-class mask and light up held notes in emerald green.
  - Includes semitone `Pitch` (`-24..+24 st`), inharmonic `Strch` (`50..200%`), and wide-range linear `Shift` (`-2000..+2000 Hz`).
- **4-Frame `Sine -> Triangle -> Saw -> Square` Wavetable Bank, Scrollable Phase Warp & Partial Sieve (`Wave`, `Mode`, `Warp`, `Sieve`, `Tilt`, `Vol`, `Mix`)**:
  - Morphs continuously across `Sine (0% default) -> Triangle -> Saw -> Square` (`Wave` `0..100%`) with `Warp` defaulting to `50%`.
  - Scrollable **`Mode`** value selector (`Bend`, `Asym`, `Sync`, `Fold`) and **`Sieve`** value selector (`All`, `Odd`, `Even`, `Sprs`, `Rise`), plus **`Tilt`** (`-100%..+100%` spectral brightness balance) and horizontal value-bar sliders for **`Vol`** (`-36..+18 dB`) right above **`Mix`** (`0..100%`).

### Files
- `src/percipitator_config.js` — 4-frame `Sine->Tri->Saw->Square` wavetable generator, phase warp, partial sieve, spectral tilt & scale/MIDI quantizer math
- `src/percipitator_core.genexpr` — 16-band `gen.codebox~` spectral tracker & wavetable resynthesizer
- `src/percipitator_ui.js` — audio-reactive Spectral Waterfall, 3D Warped Wavetable preview, and 12-note scale strip
- `scripts/build_percipitator.py` — builds `devices/Percipitator.amxd` (`380 x 169` px)
- `scripts/run_percipitator_audio_tests.py` — automated Max 9 audio render & verification suite
- `tests/test_percipitator.js` — unit, layout, and UI interaction test suite
- `previews/percipitator.png` — rendered 2x Retina preview

---

## Project Structure & Development

```text
.
├── devices/
│   ├── XO Sample Map.amxd   # Built XO Sample Space Browser & Simpler Loader (.amxd)
│   └── Better Shaper.amxd   # Built Bitwig-style MSEG Shaper Modulator (.amxd)
├── previews/
│   ├── xo_sample_map.png    # Rendered 2x Retina visual screenshot for XO Sample Map
│   └── better_shaper.png    # Rendered 2x Retina visual screenshot for Better Shaper
├── src/
│   ├── xo_node_engine.js    # Node for Max audio analyzer, 2D map, edited WAV renderer & HTTP/SSE server
│   ├── xo_map_ui.html       # Pop-out jweb HTML5 Canvas 2D Sample Space UI
│   ├── xo_strip_ui.js       # In-device v8ui mini-map, waveform scanner, vector toolbar & saved list
│   └── mseg_editor.js       # Max 9 v8ui JavaScript source for Better Shaper MSEG editor
├── scripts/
│   ├── build_xo_map.py      # Assembles src/xo_* + patcher DSP/UI into devices/XO Sample Map.amxd
│   ├── build_shaper.py      # Assembles src/mseg_editor.js + patcher DSP/UI into devices/Better Shaper.amxd
│   └── render_preview.py    # Renders a 2x Retina visual screenshot of a device to previews/<plugin_slug>.png
├── tests/
│   ├── test_xo_map.js       # Automated verification & interaction test suite for XO Sample Map
│   └── test_shaper.js       # Automated verification & interaction test suite for Better Shaper
├── README.md
└── AGENTS.md                # Architecture, rules & technical reference for AI coding agents
```

### Rebuilding, Testing & Visual Screenshot Inspection

Run the build, verification test suite, and 2x Retina preview generator for either device:

```bash
# XO Sample Map
python3 scripts/build_xo_map.py && node tests/test_xo_map.js && python3 scripts/render_preview.py "devices/XO Sample Map.amxd"

# Better Shaper
python3 scripts/build_shaper.py && node tests/test_shaper.js && python3 scripts/render_preview.py "devices/Better Shaper.amxd"

# Reciprocator
python3 scripts/build_reciprocator.py && node tests/test_reciprocator.js && python3 scripts/render_preview.py "devices/Reciprocator.amxd"

# Better GrainSpec
python3 scripts/build_grainspec.py && node tests/test_grainspec.js && python3 scripts/render_preview.py "devices/Better GrainSpec.amxd"

# Percipitator
python3 scripts/build_percipitator.py && node tests/test_percipitator.js && python3 scripts/render_preview.py "devices/Percipitator.amxd"
```
