// Injected by scripts/build_analyzer.py into the v8ui (the deferred gen~, src/analyzer_dsp.js).
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;

// Optional. spectral_theme.js uses these when the shared theme engine is in the same script.
// Analyzer does not embed that engine; the face falls through to max.getcolor and SPT_FALLBACK.
declare function m4lColor(name: string, fallback?: Array<number>): Array<number>;
declare function m4lIsActive(): boolean;
declare function m4lEffectiveConfig(): { preset: string };
