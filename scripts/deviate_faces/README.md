# Deviate face contract

Deviate ships as one `.amxd` per face (`devices/Deviate <Face>.amxd`). All faces share ONE DSP, ONE engine and ONE parameter table;
they differ only in where the `live.*` widgets sit and in what their display canvas (`v8ui`) draws from the gen's telemetry.
`scripts/build_deviate.py` builds every module found in this directory (every `.py` except `_*.py`); adding a face needs **no edit** to
the build, the config, the shared tests or the engine. Spec: `DEVIATE_PLAN.md` (Faces, Verification). Section 30 of `AGENTS.md`
(written at integration) describes the finished device.

| you write | what |
|---|---|
| `scripts/deviate_faces/<face>.py` | the layout module (this contract). `NAME = "Roulette"` -> device `Deviate Roulette` |
| `src/deviate_face_<face>.js` | the canvas script(s), loaded after the prelude |
| `tsconfig.deviate-face-<face>.json` | type-check group (copy `tsconfig.deviate-face-stub.json`; one group per script: hook names `paint` / `onclick` clash across scripts). `npm run typecheck` picks up every `tsconfig.*.json` |
| `tests/test_deviate_face_<face>.js` | optional per-face extras; `tests/test_deviate_faces.js` runs it if present (must exit 0) |
| `previews/deviate_<face>.png`, `_idle.png`, `_extreme.png` | made by `scripts/render_deviate_previews.py`; you must READ them (AGENTS.md rule 3) |

Per-face gate (host only, never Max or Live):
```bash
npm run -s typecheck && python3 scripts/build_deviate.py <face> --no-sets && node tests/test_deviate.js && node tests/test_deviate_faces.js \
  && node tests/test_parameter_info.js && node tests/test_device_static.js --device "Deviate <Face>.amxd" \
  && node tests/test_face_fuzz.js --device "Deviate <Face>.amxd" && python3 scripts/render_deviate_previews.py <face>
```
then `Read` `previews/deviate_<face>.png`, `_idle.png`, `_extreme.png` and fix every truncated / overlapping / off-panel / blank-canvas defect
(the `hit` and `idle` stills must visibly differ). Do not edit shared files (`build_deviate.py`, `deviate_config.js`, `deviate_face_common.js`,
`deviate_engine.js`, `_blocks.py`, any other face, `AGENTS.md`); if the contract is missing something, stop and report what and why.

## `layout(h)` -> dict

`h` is the build module (`scripts/build_deviate.py`). Return:

| key | meaning |
|---|---|
| `width` | device width in px, **<= 600**. Height is always 169 |
| `controls` | list of `live.*` boxes. **Every parameter key exactly once** (33), id `obj-ctrl-<key>`. Make them with `h.dial / h.numbox / h.toggle / h.button / h.menu / h.tab` (all take the *key*; name, range, unit, enum and help come from the one table `P`). A control not shown is made with `h.park(h.dial(...))` (presentation 0) and listed in `off_face` |
| `off_face` | `{key: reason}` for parameters with no visible widget (they stay real, automatable objects). **Never off the face**: the 8 Values `v_*`, the 8 Ranges `r_*`, `reroll`, `mix`, `chance`, `sens` (the build rejects it). Everything else may be off (typically `thresh`, `seed`, `drift`, `split`, the locks, `midi_in`) but think about the user: MIDI From and Split Mode are needed to use the device |
| `canvases` | the display `v8ui`s, see below |
| `panels` | background panels (`h.panel(id, x, y, w, h, bg=, border=, rounded=)`), **last** in the box list, `background 1`. Among background panels Max draws earlier ones on top, so list small panels first; a body panel `obj-panel-body` (if you have one) is the **last** panel |
| `panel_theme` | `[[panel id, Live theme colour name, [r, g, b, a] fallback], ...]` for panels the engine should recolour from `max.getcolor` (Live-themed faces; give the panel a varname = its id, `h.panel` does). `[]` for an own-palette face |
| `extra_boxes`, `extra_lines` | your own boxes / cords (labels, hairlines, show/hide logic). Box ids **must start with `obj-lay-`** |
| `theme` | `"own"` (default: your own palette, colour attributes allowed) or `"ableton"` (Live-native: no static colour attributes on `live.*`, bind with `h.theme(box, textcolor="live_control_fg", ...)`; the canvas script gets `src/spectral_theme.js` prepended; use `sc.make_section` / `sc.make_theme_*` from `scripts/spectral_common.py` for panels and labels, see `scripts/build_harmsplit.py`) |

Widget helpers (`h.`; sizes in px; `color` = RGB tuple accent for an own palette, `None` = Live's theme colours):
`dial(key, x, y, w=33, h=42, color=None, showname=1, shownumber=1)` (Live snaps it to about 29..33 x 42 with name and value),
`numbox(key, x, y, w, h=15, color=None, appearance=2)` (0 box, 1 triangle, 2 value bar, 3 bipolar bar, 4 borderless LCD; Live clamps height to 14-15),
`toggle(key, x, y, w, h=14, text=None, color=None)` (live.text, Toggle: the Locks), `button(key, x, y, w, h=15, text=None, color=None)` (live.text,
Button mode: **momentary**, 1 while pressed: Reroll), `menu(key, x, y, w, h=15, color=None)` (live.menu: Split Mode, MIDI From),
`tab(key, x, y, w, h=15, color=None, rows=1)`, `label(id, text, x, y, w, ...)` (live.comment), `panel(...)`, `park(box)`, `theme(box, attr=name)`.
Every one accepts `hidden=1` except `label`/`panel`. Max/Live drawing rules: `live.*` widgets must not overlap each other; Live may snap
sizes (`live.numbox` height 15, `live.dial` about 33 x 42).

`scripts/deviate_faces/_blocks.py`: `strip_block(h, x, y, color=None)` (the 8 metas in a 4 x 2 grid: Value dial 33 x 42, Range numbox 33 x 15,
Lock toggle 33 x 14, pitch 35 x 80 -> 140 x 153) and `globals_block(h, x, y, color=None)` (Sens Thresh Chance / Mix Drift Seed dials, Reroll button +
Split menu, MIDI From menu -> 108 x 128). They return `(controls, rects)`. You may lay out controls by hand instead; the rules above are what count.

### Rules the build checks (`validate_layout`, every build) and `tests/test_deviate*.js`
every key placed once or `off_face` with a reason; all presentation boxes and canvases inside `width x 169`; no two visible `live.*` overlap; **no
`live.*` over a canvas** (a canvas with `"ignoreclick": 1` that only draws could sit under a transparent `live.*` only when `UNDER_CONTROLS` is on
in the build; it is **off** until spike S1 has proven the z-order in Live, so use a *tile layout*: the canvas beside the widgets); panels last,
`background 1`, body panel very last; `theme: "ableton"` faces carry no static colour attributes on `live.*`; Info View sentences are written by
the build (do not set annotations). `#0` is never used; per-instance buffers are `---` names (already done by the build).

## A canvas entry

```python
{"id": "obj-lay-wheel",                  # unique, starts with obj-lay-
 "files": ["deviate_face_roulette.js"],  # src/ files, concatenated AFTER the prelude
 "rect": [x, y, w, h],                   # presentation_rect
 "keys": ["v_snap", ..., "chance"],      # parameters it receives as set_<key> <raw value> (list every key you read with dvParam / dvNorm)
 "role": "hit",                          # "hit": a click is a manual hit (the face sends dvManualHit()); "display" (default): drawing only
 "ignoreclick": False,                   # True: the canvas only draws and never takes clicks (default False)
 "outs": 1, "hidden": False, "presentation": 1,
 "reactive": True}                       # tests/test_deviate_faces.js: default True; False (or a list of ["hit","t","b","l","ring","metas","gate"]) opts a canvas out of the reactivity diff
```
Script = `var DV_FACE / DV_ROLE / DV_THEMED / DV_CANVAS_ID` + `src/deviate_config.js` + [`src/spectral_theme.js` when `theme: "ableton"`] +
`src/deviate_face_common.js` (the **prelude**) + your `files`. A canvas gets exactly the cords the build wires: `set_<key>` for its `keys`, the
state bus and `names`; its outlet 0 goes to `param` / `cmd` routing. A canvas that must be one of several in the device gets its own id and files.

## What a face script defines and may use

Never declare `box`, `patcher`, `max`, `messagename`, `inlet`, `jsarguments` (AGENTS.md rule 8; Delay+ crashed Live). The prelude already has
`inlets`, `outlets`, `mgraphics.init(); relative_coords = 0; autofill = 0`. Never use `Math.random` (use `dvRng(seed)`) or `fract`.

**Required:** `paint()`, `preview()`. **Optional:** `onFrame(t)`, `onParam(key, v)`, `onState(kind)`, `onclick / ondrag / ondblclick / onidle`,
`var PAINT_REGIONS = [[x, y, w, h], ...]` (canvas-local rects everything must be drawn inside, default the whole canvas), `var hitZones`
(array, or a function returning an array, of canvas-local `[x, y, w, h]`: the clickable regions, checked inside the canvas and disjoint from the `live.*` rects).

* `preview()` runs in `scripts/render_preview.py` (Node, no Task / Buffer data / `max`) and in the tests: call `dvPreviewBase()` first, then set any
  face state (tweens, particles) deterministically. `dvPreviewBase()` reads `DV_PREVIEW_STATE` (`"idle" | "hit" | "ring" | "extreme"`, default `"hit"`; the
  previews script injects it) and fills `dvTel`, `dvState`, `dvP` metas. The three stills must visibly differ.
* Start telemetry at load with `dvPoll(30)` (it guards `typeof Task`). `onFrame(t)` runs when the gen's FRAMES counter moved; the prelude then calls
  `mgraphics.redraw()` unless `onFrame` returns `false`. **No redraw while idle** (polling slows to 100 ms about 3 s after silence; use `dvAnimating()`,
  `dvAnimate(ms)` for tweens). Paint must stay <= ~1 ms (hard 3 ms) and <= 700 drawing calls.
* **Reactivity minimum:** an onset flash (`dvTel.hitNew`); `dvTel.pk.t / .b / .l` (transient / body / long peaks, smoothed) each move pixels independently;
  `dvTel.ring` (the drifted Ring meta 0..1) / `dvTel.ringEnv` / `dvTel.ageMs` move pixels; a new draw (`dvTel.serialNew`, `dvTel.metas[]`) changes pixels for
  all 8 metas; a Chance-rejected hit (`dvTel.gate === 0`) is visually distinct. Draw the DSP status with `dvDrawDspPill(right, y, size)` /
  `dvDspPillText()`.
* The preview renderer has no gradients, no clipping and draws every `arc` as a full circle: draw with paths (`dvCircle`, `dvRingSeg`, `dvPoly`), rectangles
  and text. `mgraphics.relative_coords = 0`: coordinates are pixels of the canvas.

### Prelude API (`src/deviate_face_common.js`; telemetry layout `DV_SCOPE` in `src/deviate_config.js`)

| name | what |
|---|---|
| `dvParam(key[, dflt])`, `dvNorm(key[, raw])`, `dvDenorm(key, n)` | raw parameter value (units of the parameter), 0..1 over its range, back |
| `dvSend(key, value)` | drive the real `live.*` object (undo, automation, echo to every face). Works for any key, listed in `keys` or not, on or off the face |
| `dvCmd(name, ...)`, `dvManualHit()`, `dvSaveUi(ints)` | `cmd` to the engine; a manual hit (as if a MIDI note arrived); this face's own small integer state saved with the Set (`dvState.ui` after reload) |
| `dvPoll(fps)`, `dvNeed({wave, spec})`, `dvAnimating()`, `dvAnimate(ms)` | telemetry polling; ask for the 256-block waveform ring (`dvTel.wave`: raw scope array, blocks at `DV_SCOPE.WAVE + i * DV_WAVE_STRIDE` ending at `dvTel.waveHead`) and/or the 32-band output spectrum (`dvTel.spec`, dB, -100..0) |
| `dvTel` | `frames hits serial ageMs gate src split latency asleep reroll trS ringEnv ring irTag fast slow thr pageApplied`, `metas[8]` (drifted, 0..100), `draws[8]` (raw), `hidden[36]`, `pk {i t b l o d}` (smoothed peaks: input, transient, body, long, output, dry), `hitNew`, `serialNew`, `active`, `s` (raw header) |
| `dvMetaValue(i)` | the meta to show: drifted draw, or the Value before the first draw |
| `dvState` | `dsp {ready, error}`, `midi` (routing name), `ui` |
| `dvRng(seed)`, `dvClamp`, `dvNum` | deterministic random numbers; helpers |
| `dvColor(c[, a])`, `dvText(str, x, y, size, c, bold, a)`, `dvTextW`, `dvPill`, `dvCircle(cx, cy, r)`, `dvPoly(pts, close)`, `dvRingSeg(cx, cy, r0, r1, a0, a1[, steps])`, `dvInside(x, y, rect)` | drawing helpers (paths only) |
| `dvTheme(name, fallback)`, `DVC`, `dvRefreshTheme()` | Live theme colours (`max.getcolor`) with fallbacks |
| constants | everything of `deviate_config.js`: `DV_METAS`, `DV_META_KEYS`, `DV_SCOPE`, `DV_HIDDEN`, `DV_PARAMS`, `dvRingEnv`, `dvWindows`, `dvPreviewTel` ... |

Telemetry facts: `pk.t / .b / .l` are the levels of the transient / body / long (tail) chains; in Envelope mode they come from time windows (transient
first, then body, then the tail), in Spectral mode from a spectral split. `ageMs` is the time since the last hit reached the output (-1 idle), `ringEnv`
the tail envelope (1 for 150 ms, then decaying; exactly 0 after 2.0 s). A hit with `gate === 0` was rejected by Chance and plays with the previous draw.
`metas[i]` moves toward `draws[i]` over the following hits when Drift > 0.

## Engine, hook, state (not your business, but good to know)

`obj-engine` (a v8ui not in the presentation) owns the parameter store, the deferred gen~ (the device is **silent until it runs**: show the DSP pill),
MIDI From routing, the IR bank, the state blob `DeviateStateData` and the Live test hook. Hook (deviation from the plan, forced by the repo's static
check): `r ---deviatetest` with the expanded per-instance name published in `Global("deviate_hooks").map` (JSON `{LOM device id: name}`); messages
`test_report`, `test_hit`, `test_reroll`, `test_set <key> <v>`; report in `Global("deviate_test").report_<LOM id>`.

## Spike S1 (done, Live 12.4.x in the VM, 2026-10-27): results and decisions

Run with `scripts/vm_deviate.sh spike --phase adde|e2|b` (`scripts/test_deviate_spike_s1.js`) and the skeleton `scripts/vm_deviate.sh test --midi`
(`scripts/test_deviate_live.js`, now all green on a Stub + a scratch "Under" device).

* **(a) blob persistence: PASS, with a fix.** `duplicate_track` of the Stub: the clone's `DeviateStateData` equals the original's (20 ints, e.g.
  `[1,1,7,0,7091,8295,...]`, reroll counter 7 survives, the clone's gen holds the same 8 draws to 0.01). Before the fix it was NOT saved: Live
  calls `getvalueof()` only after `notifyclients()`, and the engine never called it (clone got `[1,0,0,...]`). The engine now polls the gen's
  DRAW_SERIAL / REROLL (300 ms Task, 2 floats) and calls `notifyclients()` when they move. **Decision: the blob stays on the non-presentation
  engine v8ui** (no 1x1 presentation v8ui needed). A real Set save / reopen was not run (duplicate_track is the stand-in, as for Mega Modulator).
* **(b) ignoreclick canvas under live.* widgets: PASS with a rule.** Live loads the v8ui canvases IN FRONT of the live.* widgets whatever their
  order in the saved file: a full-device ignoreclick canvas under the whole Stub layout hid every widget (screenshot: only the canvas painted).
  The engine now calls `patcher.bringtofront()` on every `live.*` box (not live.comment / live.line / live.thisdevice; 33 boxes) at +0.4 / 1.5 /
  4 s after init (`dvFrontControls`, hook `test_front`, report `frontN`). Then the widgets draw over the canvas (the canvas shows through their
  transparent parts) and real OS clicks reach them: Lock toggle `L Snap` 0 -> 1, Snap dial drag 30 -> 53.6, Chance dial drag 100 -> 76.4, with the
  canvas under them (`ignoreclick 1`). `live.numbox` drags did not move the value, but they do not on the Stub (no overlap) either, so that is
  the synthetic drag, not the canvas. **`UNDER_CONTROLS = True`.** Face rule: the canvas must have `"ignoreclick": True` and `role: "display"`;
  every `live.*` goes in `controls` (the engine fronts them, nothing else to do); a canvas that needs clicks (`role: "hit"`) still must not overlap
  a widget. Do not draw text under widgets expecting it to stay readable: dials / numboxes paint their own labels and values over it.
* **(c) latency: PASS.** Split 1 -> `latency_in_samples` 1279 within 2 s, back to 256 (telemetry LATENCY follows; attribute 256 at load).
* **(d) MIDI From: PASS.** `this_device midi_inputs 0` `routing_type` set to the "Deviate MIDI Src" track (value form: the `{identifier}` dict);
  note-ons reach `midiin`: engine `midi.hits` +7, gen HITS 55 -> 62 per 4-bar clip pass. Available types list the MIDI tracks by name.
* **(e) Reroll: PASS, with a fix.** The Button-mode `live.text` emits a bare `bang` (not 1 / 0) per press and nothing for a LOM set of 0; its LOM
  value stays 1 after a LOM set of 1 (a second press needs 0 -> 1 again, or a real mouse press). Passed straight to the gen as `dvreroll` the press
  was never seen (0 rerolls). **The engine now owns `dvreroll`** (`ENGINE_GEN` / `DV_ENGINE_GEN` include `reroll`): every press becomes
  0, then 1 after 25 ms, then 0 after 100 ms (queued if pressed again meanwhile), resend sends 0 as the baseline. Result: exactly one reroll and one
  new draw per press, awake and asleep (REROLL 5 -> 6, DRAW_SERIAL 59 -> 60), HITS unchanged.
* **Other findings.** DSP ready arrives 0.75 s after gen creation (trace `dsp ready after 750 ms`), IR bank 2.4 s. The gen refreshes its ECHO
  telemetry block only while awake (it sleeps after about 0.35 s of silence), so tests wake it with a hit before reading echoes. Live lists the
  device parameters in its own order (not the table's, equal across devices): compare as sets. Invisible parameters (Split, MIDI In) are not in
  the LOM list: use `test_set split`.
