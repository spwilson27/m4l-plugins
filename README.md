# Bitwig Shaper (`devices/Bitwig Shaper.amxd`)

A Max for Live Audio Effect modulator device for **Ableton Live 12 (Max 9)** that replaces Ableton's stock **Shaper** MSEG editor with a fast, fluid **Bitwig Studio–inspired MSEG curve editor**, audio-rate wavetable modulation, loop sub-regions, step-brush painting, S-curves, undo/redo history, and an 8-slot modulation matrix.

---

## Features

### 1. Bitwig-Style MSEG Editor (`v8ui` + `mgraphics`)
- **Single-Click Point Creation**:
  - Click directly on or near the curve (indicated by a ghost hover dot) to insert a point on the curve and drag it immediately.
  - Single-click anywhere in empty space to create a point at that `(X, Y)` coordinate (or `Cmd + drag` in empty space to create and drag immediately).
- **Double-Click Point Deletion**:
  - Double-click any interior point to delete it (if multiple points are selected, double-clicking any selected point deletes all selected interior points).
  - Double-click the start (`0%`) or end (`100%`) boundary point to reset its `Y` value to `50%`.
- **Tension Curves & S-Curves**:
  - **`Alt/Option + drag`** vertically on any segment—or drag the **midpoint handle** directly—to bend the segment's tension curve. Dragging up always bows the curve upward; dragging down always bows it downward.
  - **S-Curve Mode**: Toggle symmetric sigmoid S-Curves per segment via **`Ctrl + click` (or Right-click)** on a segment, or click the **S-Curve icon** in the bottom toolbar. Standard segments show an **amber diamond** midpoint handle; S-Curve segments show a **cyan circle** midpoint handle.
  - **Reset Curve**: Double-click any midpoint handle (or `Alt + double-click` / `Cmd + Alt + click` a segment) to reset it to linear (`0%`).
- **Point Overwriting ("Eat Points" on Drag)**:
  - Dragging a point (or a multi-selection of points) horizontally across unselected points overwrites/deletes them instead of blocking movement at neighboring points.
- **Marquee Box Selection & Multi-Point Scaling**:
  - Click and drag in empty space (or `Shift + drag` anywhere) to draw a selection rectangle around multiple points (`Shift + click` toggles individual points).
  - Drag any selected point to move all selected points together.
  - Drag the **top or bottom highlight bar** of the multi-selection bounding box to vertically scale/compress the selected points.
  - `Alt + drag` with multiple points selected bends all selected segments simultaneously.
- **Paint / Draw Step Brush Mode**:
  - Click the **Pencil (`Draw`)** icon in the bottom toolbar (or hold **`Ctrl + Alt + drag`** at any time) to paint shapes across grid columns.
  - Click the adjacent **Brush Shape** icon to cycle between **`Step`** (flat bars), **`Ramp`** (upward saw steps), **`Decay`** (exponential decay steps), **`Tri`** (triangle peaks), and **`Free`** (freehand curve drawing).
- **Draggable Loop Start / Loop End Region Markers**:
  - Drag the left (`[`) or right (`]`) cyan bracket markers in the **top 11px Loop Banner** (or click the **`[–]` Loop** icon in the bottom toolbar / double-click the loop bar) to loop any sub-region of the MSEG.
  - Drag the body of the loop bar to slide the entire loop window across the MSEG.
  - When Loop is active, the MSP phase window and rate automatically scale so tempo-synced subdivisions stay locked to host tempo.
- **Undo / Redo History**:
  - 64-step undo/redo history stack accessible via the **`<`** and **`>`** chevron buttons on the far left of the bottom toolbar.

### 2. LFO, Shaping & 8-Slot Modulation Matrix
- **Audio-Rate Engine**: The MSEG is rendered into a 4096-sample `buffer~` (`#0-mseg`) and read at audio rate via `index~` for ultra-smooth modulation.
- **Rate (`Hz` & Tempo `Sync`)**: Switch between Free (`0.01 Hz – 40 Hz`) and Tempo-Synced (`1/64` up to `8 Bars`) locked to Ableton Live's transport BPM via `plugsync~`.
- **Jitter, Smooth, Depth, Phase, Retrigger (`R`), Offset**: Live waveform output previewed in real time on the center `live.scope~` display.
- **8-Slot Modulation Matrix**: 8 independent target slots (`Map 1–8`), each with its own `Map` toggle, `Unmap (X)` button, and `Min` / `Max` (`0%–100%`) range controls driving `live.map` and `live.remote~ @normalized 1`.

---

## Project Structure & Development

```text
.
├── devices/
│   └── Bitwig Shaper.amxd   # Built Max for Live Audio Effect device (ready to drop into Ableton Live)
├── src/
│   └── mseg_editor.js       # Max 9 v8ui JavaScript source for the MSEG editor & wavetable generator
├── scripts/
│   ├── build_shaper.py      # Assembles src/mseg_editor.js + patcher DSP/UI into devices/Bitwig Shaper.amxd
│   └── render_preview.py    # Renders a 2x Retina visual screenshot of the device + v8ui to tests/preview.png
├── tests/
│   ├── test_shaper.js       # Node.js verification & interaction test suite
│   └── preview.png          # Rendered visual screenshot for UI inspection
├── README.md
└── AGENTS.md                # Architecture, rules & technical reference for AI coding agents
```

### Rebuilding, Testing & Visual Screenshot Inspection

After editing `src/mseg_editor.js` or `scripts/build_shaper.py`, rebuild, test, and render the visual preview with:

```bash
python3 scripts/build_shaper.py && node tests/test_shaper.js && python3 scripts/render_preview.py
```
