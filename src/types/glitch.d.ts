// Globals that scripts/build_glitch.py injects after src/glitch_config.js (see ui_boxes).

/** The gen patch as .gendsp JSON and its content hash (deferred DSP, see loadDsp in src/glitch_ui.js). */
declare var GEN_STAGES: Array<{ id: string; index: number; role: string; side: string; ins: string[]; outs: string[]; hash: string; text: string; shellKey: string }>;
declare var GEN_SHELLS: { [key: string]: string };
/** Preview build only: which UI state preview() shows ("editor" / "seq" / "options" / "many"; "" = the default view). */
declare var UI_PREVIEW: string;
