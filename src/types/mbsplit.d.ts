// mbsplit_ui.js falls back to a `global` object (Node / older runtimes) when Max's Global() is unavailable.
declare var global: { __mbsplit_shared_bus?: any } | undefined;
// Injected by scripts/build_mbsplit.py (the deferred gen~, src/mbsplit_dsp.js)
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
