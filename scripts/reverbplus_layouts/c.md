# Reverb+ C (Essentials + More): notes

Width 444 x 169. Default: 9 live controls (Algorithm, Pre-Delay, Size, Decay, HF Damp, Loop, Dry/Wet, Freeze, More) + waterfall.
More view: the same 9 + 16 LCD values (20 in Convolution replacing 4 tank ones; Late stays). Nothing is off-face.

Contract requests
- v8ui entries get no scripting name: the head strip finds the hero by presentation_rect. A `varname` key on a v8ui entry would remove that.
- scripts/render_preview.py draws every live.line as a horizontal mid-line, so the vertical brackets / column separators show as small ticks.
- Pages: `RP_C_PAGE=more|more_conv python3 scripts/build_reverbplus.py --variant c` then render; saved previews previews/reverb_c_more*.png.
- Live (not verified, host gate only): Maxobj.setattr("hidden") on a v8ui / live.drop, setattr("active") on live.* from the head strip.
