# Theme Editor — Pass 1 Bug Hunt

Branch: bugsweep/theme-editor-pass1. Worktree: /tmp/bugsweep/theme-editor (at main HEAD 66fea67, clean before this pass).
Scope: devices/Theme Editor.amxd plus src/theme_engine.js, src/theme_editor_node.js, src/theme_editor_ui.js, src/theme_editor_web.html, scripts/build_theme_editor.py, scripts/theme_common.py, tests/test_theme_editor.js.
Method: source audit, then one red test per credible bug in the existing suite style. No fixes in this pass.

Baseline: node tests/test_theme_editor.js — all 9 checks PASS, exit 0.
Red suite: node tests/test_theme_editor_bugs.js — 0 passed, 6 failed, exit 1.

## Bug 1 — m4lSetThemeState stores NaN for non-numeric satScale/contrast, and a JSON round trip decays it to 0

Location: src/theme_engine.js, m4lSetThemeState (macro parsing).

hueShift and brightness are parsed as Number(x) || 0, so bad input falls back to the default. satScale and contrast only special-case undefined and otherwise store Number(value) unchecked, so a non-numeric value (a string from a hand-edited state file or an API client, an object, null after a round trip) is stored as NaN.

Ingress paths are real: the node server loadStateFromDisk performs no sanitation of ~/.m4l_theme_state.json before broadcasting it, POST /api/state accepts arbitrary JSON, and the v8ui theme_sync handler feeds parsed JSON straight into m4lSetThemeState.

The damage compounds through serialisation: JSON.stringify writes NaN as null (bus stateJson, the getvalueof blob, the node disk file), and the next m4lSetThemeState computes Number(null) === 0. One bad Saturation value therefore becomes a permanent satScale of 0 in the saved state — every themed device renders fully desaturated until the state is repaired by hand.

Red evidence:
- satScale must fall back to 1.0, not NaN (NaN !== 1)
- satScale after a JSON round trip must be 1.0, not 0 (0 !== 1)

## Bug 2 — m4lApplyMacros maps a null alpha to fully transparent

Location: src/theme_engine.js, m4lApplyMacros.

When a colour array has a fourth element, alpha is m4lClamp(Number(col[3]), 0, 1). Number(null) is 0, so a token with an explicit null alpha (or a NaN alpha that JSON.stringify turned into null) comes out fully transparent. m4lColor and m4lMixColor treat a missing fourth element as opaque 1.0 and pass a present fourth element through without Number(); m4lMapRgba shares the same Number(a) coercion for a present null (`a === undefined ? 1.0 : Number(a)`), so the original "this one site" wording was slightly overstated. The functional defect still stands: a null alpha becoming fully invisible is a bad failure mode for JSON-revived or hand-edited colour tokens, and it contradicts the missing→opaque convention used by m4lColor / m4lMixColor. (Bug 1's NaN→null→0 chain is about satScale/contrast macros, not colour alphas; the two bugs share the JSON null decay pattern but are otherwise independent.)

Red evidence:
- a null alpha (what JSON produces from NaN) must fall back to opaque 1.0 (0 !== 1)

## Bug 3 — The node server replaces the whole theme state on update, dropping every field it was not sent

Location: src/theme_editor_node.js, the POST /api/state handler and the sync_state Max handler, persisted by saveStateToDisk.

Both ingress paths assign the parsed body wholesale (currentState = next / currentState = parsed) and immediately save and broadcast the result. A partial update therefore deletes the fields it does not mention: posting { preset: "Cyber Cyan" } — a shape the existing verification suite itself uses — silently removes abletonUi, customPresets and deviceOverrides from the served state and from ~/.m4l_theme_state.json, and posting { macros: { hueShift: 25 } } removes satScale, contrast and brightness from the macros object. loadStateFromDisk cannot heal this: it merges only at the top level on restart and replaces nested objects wholesale, so the loss is permanent. The engine-side m4lSetThemeState demonstrates the intended pattern — it merges the incoming state into defaults field by field. The node hub, which owns persistence, does not.

Red evidence:
- abletonUi must survive a partial POST
- satScale must not be dropped by a partial macros POST (undefined !== 1)
- the on-disk state file must keep abletonUi

## Investigated and not counted as bugs

- Preset switching clears token overrides in both the v8ui (onclick) and the WebUI (preset buttons): identical on both surfaces, treated as deliberate design.
- The candidate grids in m4lEstimateAbletonUiSettings (brightness, intensity, hue) are coarse by design and the function reports rmse.
- m4lRgbKey quantises to 1/1000; the comment documents this and the existing suite covers the no-double-mapping behaviour.
- WebUI hexToRgba always returns alpha 1.0, but its only caller is an input type=color element, which has no alpha channel; worth revisiting only if an alpha-capable editor is added.
- teBroadcastState republishes state (incrementing its version) on every macro drag frame: a batching and undo-granularity improvement for a future pass, not a correctness bug.

## Commands and results

- node tests/test_theme_editor_bugs.js → exit 1, 0 passed / 6 failed (red, this pass)
- node tests/test_theme_editor.js → exit 0, all 9 checks PASS (baseline untouched)

## Pass 2 review (kept all three)

Reviewed against source on tip 3cb1c01. All three claims are real functional/state bugs; none dropped. No production/src fixes in this pass.

- Bug 1 KEEP — satScale/contrast store `Number(x)` with no NaN fallback while hueShift/brightness use `Number(x) || 0` (m4lSetThemeState ~3482–3483). JSON round-trip NaN→null→0 permanently desaturates themed devices.
- Bug 2 KEEP — m4lApplyMacros null alpha → 0 is a real failure mode. Softened the "one site" consistency claim above (m4lMapRgba also Number()-coerces a present null); the missing→opaque convention of m4lColor/m4lMixColor still makes this a bug. Bug 1 linkage is about macros, not colour alphas.
- Bug 3 KEEP — POST /api/state and sync_state assign `currentState` wholesale; partial bodies drop abletonUi/customPresets/sibling macros. Confirmed in theme_editor_node.js.

Red suite re-run on unfixed code: `node tests/test_theme_editor_bugs.js` → 0 passed, 6 failed, exit 1 (expected).
