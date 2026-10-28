# GPL-3.0 NAM captures used by Neural Amp

Four of Neural Amp's twelve built-in models are **Feather students of community NAM captures**: small
NAM WaveNets trained (by `scripts/amp_train_defaults.py`) to reproduce these captures' output for the same
input. The captures come from the Neural Amp Modeler community collection
<https://github.com/pelennor2170/NAM_models> (commit `944ca6718581c60cc5365586d2f378d740e181f3`), which is
licensed under the **GNU General Public License v3** (full text: `COPYING` in this folder; the collection's
README: models "made by the Neural Amp Modeler community ... licenced under the GNU GPL v3").

| Built-in | Student (shipped in the device) | Teacher (this folder) | Gear | Capture author | Original file |
|---|---|---|---|---|---|
| Magna | `src/amp_models/magna.nam` | `magnatone_ch1.nam` | Magnatone Super 59 MkII, Ch1 Normal | Tim R | `Tim R Magnatone Super 59 Mkii Ch1 Norm.nam` |
| DS-1 | `src/amp_models/ds1.nam` | `ds1.nam` | Boss DS-1, gain 6, tone 5 | Keith B | `Keith B DS1_g6_t5.nam` |
| Splawn | `src/amp_models/splawn.nam` | `splawn_g10_g3.nam` | Splawn Pro Mod, G10, gear 3 | Tim R | `Tim R Splawn Pro Mod G10 Gear 3.nam` |
| Mark IV | `src/amp_models/markiv.nam` | `mesa_markiv.nam` | Mesa Boogie Mark IV | Roman A | `Roman A LT_MESA_MARKIV_1.nam` |

Authors are as the collection names them (first name and initial in the file name). The teacher files are
unmodified copies. The students are derivative works and are distributed under the same license
(GPL-3.0-or-later); each student's `metadata` carries `license`, `credit`, `modeled_by` and `teacher`, and
the device shows the credit on its display when one of them is selected.

**Scope of the license.** The other eight built-ins (Clean, Bass, Chime, Drive, Crunch, Lead, Metal, Fuzz) are trained on this project's own
synthetic circuits (`scripts/amp_fit_circuits.py`); from the GPL captures only measured numbers were used to
fit them. Whether GPL obligations extend from a bundled student model to the whole device is not settled
law; this project treats the four students and their teachers as GPL-3.0 and keeps their source (the
`.nam` files, which are the preferred form for modification, and the training script) in this repository.
Anyone redistributing `devices/Neural Amp.amxd` must keep this notice and the GPL text with it.

Rebuild a student: `<venv>/bin/python scripts/amp_train_defaults.py magna ds1 splawn markiv`
(venv with torch, `neural-amp-modeler`, scipy; see AGENTS.md section 30).
