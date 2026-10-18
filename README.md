# Ableton Max for Live Devices (`devices/*.amxd`)

A collection of custom Max for Live devices for **Ableton Live 12 Suite (Max 9.1+)**:

1. **`devices/XO Sample Map.amxd`** — An XLN Audio XO–inspired 2D Drum Sample Space Browser, Auto-Categorizer, Similarity Explorer, and Simpler / Drum Rack Pad Loader (`Node for Max` + `jweb` pop-out window + in-device `v8ui` mini-map + `LiveAPI`).
2. **`devices/Tiny Space.amxd`** — A "tiny space" reverb (FDN, 20 delay lines) with Size, Damp, Width, Dry/Wet, Feedback, plus Pre-delay, Modulation, Crossfeed, I/O gain, HP/LP, Freeze, and a Seed (0–9999) that deterministically selects a random internal delay-line configuration. 20-bar v8ui visualization.
3. **`devices/Bitwig Shaper.amxd`** — A Bitwig Studio–inspired MSEG curve modulator with audio-rate wavetable lookup, loop sub-regions, step-brush painting, S-curves, undo/redo history, and an 8-slot modulation matrix.

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
- **Controls**: Size, Damp, Width, Dry/Wet (Mix), Feedback, plus Pre-delay, Modulation, Crossfeed, Input/Output gain, HP/LP filters, Freeze, and a **Seed** (0–9999) that deterministically selects a random internal delay-line configuration.
- **Visualization**: 20 per-delay-line energy bars (v8ui) that pulse with the actual delay-line energy.
- **gen.codebox~ core**: FDN reverb with input allpass diffusion, per-line damping/feedback, crossfeed, modulation, freeze, width (M/S), predelay.

### Files
- `src/tinyspace_ui.js` — v8ui visualization + seed PRNG + config buffer poke + `getvalueof`/`setvalueof`
- `src/tinyspace_core.genexpr` — Gen core
- `scripts/build_tinyspace.py` — builds `devices/Tiny Space.amxd`
- `tests/test_tinyspace.js` — structure + JS unit tests
- `tests/tinyspace_harness.maxpat` — audio test harness with extra in/out sinks
- `previews/tiny_space.png` — rendered preview

### Rebuild & Test
```bash
python3 scripts/build_tinyspace.py && node tests/test_tinyspace.js && python3 scripts/render_preview.py "devices/Tiny Space.amxd"
```

### Audio validation
```bash
python3 scripts/build_tinyspace_harness.py
python3 scripts/run_tinyspace_audio_tests.py
```

---

## 3. Bitwig Shaper (`devices/Bitwig Shaper.amxd`)

A Max for Live Audio Effect modulator device that replaces Ableton's stock **Shaper** MSEG editor with a fast, fluid **Bitwig Studio–inspired MSEG curve editor**, audio-rate wavetable modulation, and an 8-slot modulation matrix.

### Features
- **Bitwig-Style MSEG Editor (`v8ui` + `mgraphics`)**:
  - **Single-Click Point Creation & Double-Click Deletion**.
  - **Tension Curves & Symmetric S-Curves** (`Alt/Option + drag` to bend tension; `Ctrl + click` or S-Curve toolbar icon to toggle S-Curve mode).
  - **Point Overwriting ("Eat Points" on Drag)** & **Marquee Box Selection** with vertical bounding-box scaling.
  - **Keyboard Shortcuts When Focused**: `Cmd+A` (Select All points), `Delete` / `Backspace` (Delete selected interior points), `Cmd+Z` / `Cmd+Shift+Z` (Undo / Redo), `Escape` (Clear selection).
  - **Paint / Draw Step Brush Mode** (`Step`, `Ramp`, `Decay`, `Tri`, and continuous multi-point `Free` brushes).
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

## Project Structure & Development

```text
.
├── devices/
│   ├── XO Sample Map.amxd   # Built XO Sample Space Browser & Simpler Loader (.amxd)
│   └── Bitwig Shaper.amxd   # Built Bitwig-style MSEG Shaper Modulator (.amxd)
├── previews/
│   ├── xo_sample_map.png    # Rendered 2x Retina visual screenshot for XO Sample Map
│   └── bitwig_shaper.png    # Rendered 2x Retina visual screenshot for Bitwig Shaper
├── src/
│   ├── xo_node_engine.js    # Node for Max audio analyzer, 2D map, edited WAV renderer & HTTP/SSE server
│   ├── xo_map_ui.html       # Pop-out jweb HTML5 Canvas 2D Sample Space UI
│   ├── xo_strip_ui.js       # In-device v8ui mini-map, waveform scanner, vector toolbar & saved list
│   └── mseg_editor.js       # Max 9 v8ui JavaScript source for Bitwig Shaper MSEG editor
├── scripts/
│   ├── build_xo_map.py      # Assembles src/xo_* + patcher DSP/UI into devices/XO Sample Map.amxd
│   ├── build_shaper.py      # Assembles src/mseg_editor.js + patcher DSP/UI into devices/Bitwig Shaper.amxd
│   └── render_preview.py    # Renders a 2x Retina visual screenshot of a device to previews/<plugin_slug>.png
├── tests/
│   ├── test_xo_map.js       # Automated verification & interaction test suite for XO Sample Map
│   └── test_shaper.js       # Automated verification & interaction test suite for Bitwig Shaper
├── README.md
└── AGENTS.md                # Architecture, rules & technical reference for AI coding agents
```

### Rebuilding, Testing & Visual Screenshot Inspection

Run the build, verification test suite, and 2x Retina preview generator for either device:

```bash
# XO Sample Map
python3 scripts/build_xo_map.py && node tests/test_xo_map.js && python3 scripts/render_preview.py "devices/XO Sample Map.amxd"

# Bitwig Shaper
python3 scripts/build_shaper.py && node tests/test_shaper.js && python3 scripts/render_preview.py "devices/Bitwig Shaper.amxd"
```
