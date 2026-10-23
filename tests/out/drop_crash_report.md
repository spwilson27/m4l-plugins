# File-drop heap corruption: Finder (a source app) crashes the same way as Live (DRAFT, not sent anywhere)

Status: interim. The matrix was interrupted by a VM restart (screen 1024x768 -> 1920x1080, Live auto-updated 12.4.6 -> 12.4.7). After the restart no drag (synthetic or Finder) was delivered to any target, not even the plain Cocoa sink (a ghost drag image stayed on screen; slower drags, killing Finder / Dock did not help), so the remaining cells are "pending" and need a clean VM state. The counts above were measured before the restart on Live 12.4.6.

## Environment
- tart VM `macos-1`, macOS 27.0 (26A428), 1024x768 screen, Apple Silicon (ARM64).
- Ableton Live 12.4.6 Suite (with Max for Live), standalone Max 9.2.0.
- Test tools: `scripts/drop_stress.py` (driver), `scripts/vm_dropstress.sh` (host wrapper), `scripts/build_dropprobe.py` (minimal M4L probes + standalone patch), `scripts/rp_drag_source.m` (synthetic NSDraggingSource), `scripts/rp_drop_sink.m` (plain Cocoa drop window), `scripts/drop_finder_calib.py`.

## Symptom (original report)
Live aborts with `EXC_BREAKPOINT`, "BUG IN CLIENT OF LIBMALLOC: memory corruption of free block", detected on a later malloc in Live's CoreAnimation render queue or an NSTimer callback; no Max / Reverb+ frame; roughly 1 crash per 300 real file drops onto a Max for Live device.

## New finding: the same abort happens in Finder, as the drag SOURCE
With Finder as the drag source (real list-view icon, CGEvent press and drag) and Live running, Finder itself crashed 5 times in about 720 drags (the first run 3 in 120, then 1 in 107, 1 in 579). Identical `asi` ("memory corruption of free block"), `EXC_BREAKPOINT`, main thread. Two distinct stacks, both inside Apple code starting a drag session:
- `CoreDragCreateInternal` -> `CSMemNewPtrClear` -> `_xzm_xzone_malloc_from_freelist_chunk` (abort), reached from `-[NSTableView _performFlockedDragOfIndexes:hitRow:event:gestureRecognizer:]` -> `-[NSView(NSDrag) beginDraggingSessionWithItems:...]` -> `-[NSDraggingSession _initWithPasteboard:...]`.
- `InitLayerBackedDragWindow` -> `__CoreDragSetupDragImageLayers` -> `-[CoreDragDraggingLayer initWithDragImageDataRef:cursorLocation:]` -> `-[CDImageData imageComponents]` -> AppKit autolayout (`NSISObjectiveLinearExpression`, `_hashMapRehash`) -> malloc abort.
Reports: `~/Library/Logs/DiagnosticReports/Finder-2026-10-22-214636.ips`, `-214758`, `-215316`, `-230712`, `-233454` (in the VM).

## Matrix so far (drops = attempted drags, received = reached the target)
| cell (source-target) | drops | received | target crashes (Live/Max) | source-side crashes |
|---|---|---|---|---|
| synthetic -> plain Cocoa sink (no Live, no Max) | 300 | 292 | 0 | 0 |
| Finder -> plain Cocoa sink (no Live, no Max) | 600 | 599 | 0 | 0 |
| Finder -> DropProbe DF (only a transparent whole-face `dropfile`, Live) | 600 (+120 in an aborted run) | 186 | 0 | 2 (+3 in the aborted run), all Finder |
| Finder -> DropProbe LD (only a whole-face `live.drop`) | interrupted by the VM restart (150 drops, 58 received, 0 crashes seen) | | | |
| synthetic -> DF / LD / Reverb+, Finder -> Reverb+, native Live target, standalone Max | pending | | | |

Other observations: a synthetic drag onto the DF probe is received 100% when Live is the active app, but only about 45% when Live is not active (Finder as source keeps Live inactive, hence 31% received); in both cases the source reports the drop operation, so Live rejects some drags itself.

## Reading
- Finder never crashed in 900 drags with no Live running (plain sink), and crashed 5 times in about 720 drags while Live was running. So the corruption in Finder's heap depends on Live (or Max for Live) being present, but the faulting code is in CoreDrag / AppKit, in an Apple process, with no Live or Max frame.
- The Live-side crash has the same signature. With a minimal probe (no Reverb+ code) no Live crash was seen in 600 Finder drops (186 received); the earlier Reverb+ rate was about 1 in 300 synthetic drops, so the target-side rate is low enough that the minimal cells need more drops to compare.
- Conclusion so far: not specific to Reverb+; points at a macOS (27.0 beta-class build in a VM) CoreDrag / AppKit heap bug that Live's presence makes more likely. Not yet proven to be a Live bug.

## Repro
`scripts/vm_dropstress.sh F-df 600 3` (host, takes the Live lock) in the tart VM; or by hand: Finder list view of a folder with audio files, press on an icon and drag it over a Live window repeatedly; check `~/Library/Logs/DiagnosticReports` for `Finder-*.ips`.
