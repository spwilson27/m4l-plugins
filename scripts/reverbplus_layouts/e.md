# Reverb+ E: "Direct manipulation" (600 x 169)

Display (396 x 161) = shipped waterfall + six numbered handles; SPACE / TAIL tabs on the header line.
Left: Algorithm, Size, Diffusion (Convolution: Stretch, Start, Reverse, IR drop). Right: Freeze, LOOP bracket (Loop, Loop Time), Dry/Wet.
Handles: 1 Decay (vertical track, IR Decay in Convolution), 2 HF Damp + 3 Bass Mult/Crossover (RT60-ratio strip), 4 Low Cut, 5 High Cut (front axis), 6 Pre-Delay (ruler).
TAIL page (drawn bars): Mod Rate/Depth, Early, Late, Width, Ducking, Release, Output, Clip Level/Mode.
Previews: `RC_PREVIEW=conv|freeze|tail|drag python3 scripts/render_preview.py "devices/Reverb+ E.amxd" _<mode>`.

## Contract requests
- render_preview draws every live.line horizontally (vertical bracket ticks are invisible in the preview, Max draws along the long side).
- A shared `h.line_box()` helper for live.line hairlines (this layout builds them inline).
