// Globals that scripts/build_glitch.py injects after src/glitch_config.js (see ui_boxes).

/** The gen patch as .gendsp JSON and its content hash (deferred DSP, see loadDsp in src/glitch_ui.js). */
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
/** Preview build only: open the module editor in preview(). */
declare var UI_PREVIEW_EDITOR: boolean;
