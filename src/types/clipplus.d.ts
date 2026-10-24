// Injected by scripts/build_clipplus.py (the deferred gen~). The meter script does not embed the gen.
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
declare var FACE_ROLE: string | undefined;

// Present when a device concatenates theme_engine.js. Clip+ uses spectral_theme's own fallback.
declare function m4lColor(name: string, fallback?: number[]): number[];
declare function m4lIsActive(slug?: string): boolean;
