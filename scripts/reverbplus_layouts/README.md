# Reverb+ layout contract

A *layout* is the face of a Reverb+ Start device: where every parameter's widget sits, which display `v8ui`s draw
the telemetry, and the device width. The build (`scripts/build_reverbplus.py`) supplies everything that is not
visual: the engine `v8ui` (parameter store, link layer, deferred gen~, IR pipeline), the gen hub, `plugin~` /
`plugout~`, buffers, `live.thisdevice`, all routing and the state bus. The shipped face is `base.py` ("Hybrid tabs", 444 x 169, chosen from prototypes; section 27 of AGENTS.md describes it). An alternative face adds only its own files
and needs no edit to `build_reverbplus.py`, `src/reverbplus_config.js` or `tests/test_reverbplus.js`:

| file | what |
|---|---|
| `scripts/reverbplus_layouts/<x>.py` | the layout module (this contract). `base` (the shipped face) -> `Reverb+`; any other name `<x>` -> device `Reverb+ <X>` |
| `src/reverbplus_face*.js` | the face script(s), loaded after the prelude (below) |
| `tsconfig.reverbplus-<name>.json` | type-check group: `src/types/max-extras.d.ts`, `src/types/reverbplus.d.ts`, `src/reverbplus_config.js`, `src/reverbplus_face_common.js`, your face files (copy `tsconfig.reverbplus-face.json`; the shipped face has one group per script because the hook names `paint` / `onclick` clash: `-face`, `-face-ir`). Required: `npm run typecheck` picks up every `tsconfig.*.json`. |
| `tests/test_reverbplus_face.js` | your own tests (`tests/test_reverbplus.js` also runs every `tests/test_reverbplus_face_<x>.js`; the shipped face's is in the gate) |
| `previews/reverb.png` | `python3 scripts/render_preview.py "devices/Reverb+.amxd"` (slug = lower-cased device name). The shipped face also has `reverb_tone.png`, `reverb_tail.png`, `reverb_conv.png`: `RC_PAGE=<0..2> RC_ALGO=<0..5>` at build AND render time, e.g. `RC_PAGE=2 python3 scripts/build_reverbplus.py --no-sets --out-dir /tmp/x && RC_PAGE=2 python3 scripts/render_preview.py /tmp/x/Reverb+.amxd _tail` |

Build / gate:
```bash
npm run -s typecheck && python3 scripts/build_reverbplus.py && node tests/test_reverbplus.js \
  && python3 scripts/render_preview.py "devices/Reverb+.amxd"     # then look at previews/reverb.png (AGENTS.md rule 3)
```
`node tests/test_reverbplus.js` builds EVERY module found here into a temp dir and checks the contract for each.
`python3 scripts/build_reverbplus.py --variant <x>` builds one extra layout (default: `base`). `--out-dir <dir>` builds elsewhere, `--no-sets` skips the Live test set.

## `layout(h)` -> dict

`h` is the build module (`scripts/build_reverbplus.py`). Return:

| key | meaning |
|---|---|
| `width` | device width in px (height is always 169) |
| `controls` | list of `live.*` boxes. **Every parameter key exactly once**, id `obj-ctrl-<key>`. Make them with `h.dial`, `h.menu`, `h.tab`, `h.button`, `h.numbox`, `h.irdrop` (all take the *key*, so name / range / unit / enum / help come from the one table `P`). A widget with `presentation 0` (drawn by a v8ui that drives it through `rpSend`) must be listed in `off_face` |
| `off_face` | `{key: reason}` for parameters with no presentation widget (still real, automatable `live.*` objects, kept hidden) |
| `panels` | background `panel`s (`h.panel`), **last** in the box list, `background 1`. Among background panels Max draws earlier ones on top, so list small panels before big ones (see `base.py`) |
| `panel_theme` | `[[panel id, Live theme colour name, [r, g, b, a] fallback], ...]`: the engine colours these panels from `max.getcolor` on load and on theme change (attribute bindings on panels do not repaint in Live). Give a panel `varname` = its id (`h.panel` does) |
| `extra_boxes`, `extra_lines` | your own boxes / cords (hairlines, show/hide logic). Box ids must not start with `obj-ui-`, `obj-scale-`, `obj-prep-`, `obj-buf-`, `obj-msg-`, `obj-route-`, `obj-state-`; use `obj-lay-base-...` |
| `v8uis` | the display / controller `v8ui`s, see below |

Rules (checked by `validate_layout` in the build, which runs on every build, and by `tests/test_reverbplus.js`): each box inside
`width x 169`; no two visible `live.*` widgets overlap; no visible `live.*` over an interactive `v8ui` (AGENTS.md rule 4: a
`v8ui` with `"ignoreclick": 1` that only draws may sit under a transparent `live.*` that is *later* in `controls`); live.* use Live's theme colours
(no colour attributes, or `h.theme(box, textcolor="live_lcd_control_fg_alt", ...)` bindings like Delay+); `#0` / `---` names for
anything per instance (the build already does that for buffers and the state bus).

### A display `v8ui` entry

```python
{"id": "obj-lay-base-viz",            # unique, obj-lay-base-...
 "files": ["reverbplus_face_math.js", "reverbplus_face.js"],   # src/ files, concatenated after config + prelude
 "rect": [x, y, w, h],             # presentation_rect
 "keys": ["algo", "decay", ...],   # parameters it receives as set_<key> <value> (raw parameter units)
 "outs": 1,                        # outlets (outlet 0 is the parameter / command stream below; default 1)
 "hidden": False, "presentation": 1, "ignoreclick": False,
 "names": True, "state": True}     # receive `names ...` / the state bus (both default True)
```
Script = `src/reverbplus_config.js` + `src/reverbplus_face_common.js` (the *prelude*) + your `files`. The prelude
(`reverbplus_face_common.js`, read its header) gives you:

* **Parameters in:** `anything()` stores `set_<key>` values in `rpP[key]` (raw units: ms, Hz, %, dB, enum index). `rpNum(key, default)`,
  `rpAlgo()` (0..5), `rpActive(key)` (false when the key does not apply to the current algorithm: grey it). Define `onParam(key, value)` to react.
  Subscribed keys only: list every key you read in `keys`.
* **Parameters out:** `rpSend(key, value)` drives the parameter's `live.*` object (undo / automation / echo to every face). Works for any key,
  subscribed or not, on-face or `off_face`. `rpCmd("browse_ir")` / `rpCmd("clear_ir")` for the IR file.
* **Telemetry:** `rpPoll(fps)` starts a Task that reads buffer `---rpscope` (layout `RP_SCOPE` in `src/reverbplus_config.js`, 64 samples: frame counter,
  sr, algorithm, freeze, paired, `B` / `L` / `K`, `MIN_MS`, `LOOP_MS`, `PREDELAY_MS`, `CLAMPED`, peaks `IN_PK` / `WET_PK` / `RET_PK`, `CLIP_DB`, `RT60_LO` /
  `RT60_MID` / `RT60_HI` (theoretical), IR flags, `ASLEEP`, the derived loop `LOOP_GAIN` / `TANK_RT`) into `rpT.s` and calls `onFrame(rpT)` when the gen's
  frame counter moved (`rpT.active` = signal seen in the last ~3 s; nothing happens while idle). The prelude redraws after `onFrame` unless it
  returns `false`: a face that does not need every frame (the shipped Tone / Tail tabs) returns `false` when nothing it shows changed. Other buffers
  by name through `rpBuf(rpNames.spec | irview)`: `---rpspec` (wet / dry rings of 4096, `rpSpectrum32(buf, RP_SPEC.WET | RP_SPEC.DRY)` gives 32 log
  bands in dB; run it only while the spectrum is shown) and `---rpirview` (processed IR: 512-point dB envelope at 16.., 512 min/max pairs at 528..,
  see `reverbplus_face.js` IR spectrogram code).
* **State:** `rpState.dsp {ready, error}`, `rpState.link {paired, status, latency, partner}`, `rpState.ir {status idle|loading|processing|ready|error, loaded,
  len, sr, channels, srMismatch, name}` (the engine broadcasts them; define `onState(kind)` for changes). `rpHeaderPills()` gives the standard status pills
  (DSP loading / failed, no End, `LATENCY: LOOP <min>`, IR status) to draw yourself.
* **Drawing:** `rpRefreshTheme()` (call in `paint`), `RPC` palette, `rpColor`, `rpText`, `rpTextW`, `rpPill`.
* **Preview:** define `preview()` (scripts/render_preview.py calls it before `paint()`); `rpPreviewBase(algo, rt60)` fills a representative state and
  a synthetic scope (`rpFakeScope`).
* Define `paint()`. Start the script with nothing else needed: the prelude already has `inlets`, `outlets`, `mgraphics.init(); relative_coords = 0; autofill = 0`.
  Never declare `box`, `patcher`, `max`, `messagename`, `inlet`, `jsarguments`.

### Extra UI-state parameters (page, view toggle, ...)

Call `h.register(key, long_name, short_name, lo, hi, initial, ptype=0, unit=9, expo=1.0, help_text="", enum=None)` *inside* `layout(h)` before building the
widget with `h.tab(key, ...)` / `h.button(...)` / ...: it is stored with the Set, `parameter_invisible 1` (not automatable), short names must be unique across
the device. The build wires `set_<key>` to the engine and to every v8ui that lists the key.

### Parameters (the base table `P` in `scripts/build_reverbplus.py`)

`algo predelay size decay diffusion damp bassmult xover modrate moddepth erlevel latelevel lowcut highcut width freeze loopclip looplevel duck duckrel
drywet output irstretch irstart irreverse irdecay irfile input`. `irfile` is the `live.drop` (`h.irdrop(x, y, w, h, hidden=0, ignoreclick=0)`): exactly one, parameter mode,
Live saves its path and replays it on load (the engine loads it). A layout may draw its own IR drop area and keep the live.drop transparent over it (`ignoreclick` face).
Parameters that do not apply to the algorithm: `RP_INACTIVE` in the config (`rpActive`).

### Test hook

The engine also listens on `receive #0-rptest` (the MCP bridge: `messnamed("#0-rptest", ...)`): `dropfile <path>` loads an IR, `test_report` writes
`Global("reverbplus_test").report_<LOM device id>` (DSP, link, IR, header). `scripts/test_reverbplus_live.js` uses it.

`base.py` is the worked example (the shipped face); `src/reverbplus_face.js` (display), `src/reverbplus_face_math.js` (pure helpers), and `src/reverbplus_face_ir.js` (IR box) are its scripts. It uses the optional `preamble`, `hidden` and `ignoreclick` entries of a `v8ui`, `h.register` for its Tab parameter, and `presentation_rect` messages (a `msgbox` into the display) to grow the display on the Tail tab.

Note: the chain loop's time and gain are derived by the Start (AGENTS.md section 27); there are no `Loop` / `Loop Time` parameters. A face that wants them reads the Start's telemetry (`RP_SCOPE.LOOP_MS`, `LOOP_GAIN`, `TANK_RT`); the shipped face shows none of it except the `LATENCY` pill.
