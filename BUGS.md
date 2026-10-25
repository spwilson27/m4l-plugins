# Amp+ variants — Pass 1 bug hunt (bugsweep/ampplus-variants-pass1)

## Verdict

**1 credible bug found.** Red test added in `tests/test_ampplus_bugsweep.js`
(expect FAIL on current HEAD). Production code is intentionally untouched in
pass 1.

- Worktree: `/private/tmp/bugsweep/ampplus-variants`, branch
  `bugsweep/ampplus-variants-pass1`.
- Devices in scope: `devices/Amp+.amxd` plus the five locked-face variants
  (`Amp+ Wave/Pulse/Tiles/Strip/Mono.amxd`), all built by
  `scripts/build_ampplus.py`.

## Bug 1: Scope buffer uses `#0-ampscope` (not instance-isolated in Live)

### Symptom
Every Amp+ instance in a Live Set shares one scope ring / header. With
`scopeon 1` the gen pokes envelope, peak and the 24-sample waveform into
`buffer~ #0-ampscope`; the face polls it every 33 ms for meters, traces,
spokes, tiles and the level disc. Two (or more) Amp+ devices therefore
corrupt each other's meters and waveform displays.

### Evidence
- `scripts/build_ampplus.py:190` — `sc.message("obj-msg-buf", "#0-ampscope", ...)`
  (loadbang name fed to `prepend scope` / `prepend set_scope`).
- `scripts/build_ampplus.py:194` —
  `sc.newobj("obj-scope", "buffer~ #0-ampscope @samps 32", ...)`.
- `src/ampplus_core.genexpr` — `Buffer scope("ampscope")` rebound on loadbang
  via `scope <name>`; the collision is the patcher-side name, not the GenExpr
  external default.
- `AGENTS.md` §30 still documents `buffer~ #0-ampscope` as the contract.
- Same class already fixed elsewhere: Multiband Split migrated
  `#0-splitscope` → `---mbsplitscope` because "Live does not expand `#0` in a
  device's top-level patcher (AGENTS 15)"; Glitch / Delay+ / Spectral Split
  use `---` names and assert no literal `#0` in box text / v8ui script
  (`tests/test_glitch.js`, `tests/test_mbsplit.js`).
- `tests/test_ampplus.js` never asserts `---` isolation or rejects
  `#0-ampscope`.

### Red test
`tests/test_ampplus_bugsweep.js` — for each of the six `.amxd` files:
`obj-scope.text === "buffer~ ---ampscope @samps 32"`,
`obj-msg-buf.text === "---ampscope"`, and no box text matches `#0-ampscope`;
plus the same constraints on `scripts/build_ampplus.py`.

### Fix direction (do **not** apply in pass 1)
In `scripts/build_ampplus.py` replace `#0-ampscope` with `---ampscope` in the
`buffer~`, the loadbang message, and any bind strings; rebuild all six
devices; update `AGENTS.md` §30. GenExpr `Buffer scope("ampscope")` can stay
(rebound by `scope ---ampscope`, same pattern as Glitch).

## Audited and cleared

### Z-order / ignoreclick vs live.* controls
Hypothesis that `obj-viz-bg` (full-bleed `ignoreclick` drawing canvas) sat
after the `live.*` dials and covered them. Probe of all six `.amxd` files:
`obj-viz-bg` at `boxes[0]`, `obj-viz` at `[1]`, `bg.ignoreclick = 1`,
`bg.background` undefined, **zero** `live.*` boxes before `obj-viz-bg`. Per
AGENTS.md rule 4 (ignoreclick exception: later in `boxes` = in front), the
ordering is correct. Not a bug.

### GenExpr / tone-stack / cabinet core
`src/ampplus_core.genexpr` read in full. Existing `tests/test_ampplus.js`
covers single-return lint, no `e<digit>` identifiers, toneDb / volCurve,
flat/shelf biquad magnitudes, cab LP/HP/peak helpers, slew, and a short
biquad run. No new DSP defect found in pass 1.

### Presentation / look lock / overlap
Five looks (Wave/Pulse/Tiles/Strip/Mono) validated by `test_ampplus.js`
(`ampLookProblems`, baked `ampLookLock`, no `live.*` overlap with
`obj-viz`'s click target). Variant devices lock Look to one face. Cleared.

### Integer > 255 automatable params / theme / state
No `parameter_type` integer knobs above 255 spotted in the Amp+ build path;
theme menus come from `spectral_common`; no `getvalueof`/`setvalueof` blob
beyond the normal Live parameter set. Cleared for pass 1.

## Commands run (pass 1)
- `git merge --ff-only main` on `bugsweep/ampplus-variants-pass1` (clean).
- Host reads of `src/ampplus_{ui,looks,core,models}.*`,
  `scripts/build_ampplus.py`, `tests/test_ampplus.js`, `AGENTS.md` §30.
- Z-order probe script over all six `.amxd` (see above).
- `node tests/test_ampplus_bugsweep.js` — expected RED on current HEAD
  (run after this file lands).
