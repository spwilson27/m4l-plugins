# Reverb+ A "Signal-flow sections" (586 x 169)

Files: `scripts/reverbplus_layouts/a.py`, `src/reverbplus_face_a.js` (copy of the waterfall resized to 210 x 88, no icons / footer),
`src/reverbplus_face_a_deco.js` (one ignoreclick v8ui over the whole face behind the controls), `tsconfig.reverbplus-a*.json`,
`tests/test_reverbplus_face_a.js`, `previews/reverb_a.png`, `previews/reverb_a_conv.png` (RA_PAGE=conv build + RC_PREVIEW=conv render).
The shared `reverbplus_face_math.js` is used unchanged; the copy overrides its `RCG` plot geometry at load.

Visible controls: tank page 21 (12 primary: Algorithm, Pre-Delay, Size, Decay, Diffusion, HF Damp, Bass Mult, Loop, Loop Time,
Freeze, Width, Dry/Wet; 9 small LCD values / menu: Low Cut, High Cut, Crossover, Late, Early, Mod Rate, Mod Depth, Clip Mode,
Clip Level). Convolution page 18 (IR Stretch / Start / Decay, Reverse, Drop IR replace Size / Decay / Diffusion and the MOD column;
Bass Mult, Crossover, Early hidden).
Off the face: Output (track fader / Dry-Wet cover it), Ducking, Duck Release (set-and-forget); still real automatable live.* objects.

Contract requests: none (a transparent whole-face ignoreclick v8ui replaces live.line hairlines, so separators, brackets and labels
are drawn in Live theme colours and are visible in the preview, whose live.line renderer only draws horizontal lines).
