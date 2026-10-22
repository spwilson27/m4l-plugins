// Globals that scripts/build_reverbplus.py injects between reverbplus_config.js and the other scripts of the
// Start engine / End face, and hooks defined by only some of the concatenated scripts.
declare var RP_ROLE: "start" | "end";
declare var RP_BUILD: string;
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
/** parameter key -> [gen message, divisor] */
declare var RP_GEN_PARAMS: { [key: string]: [string, number] };
/** [box id, Live theme colour name, fallback rgba] */
declare var RP_PANEL_THEME: Array<[string, string, number[]]>;
/** parameter key -> varname (the long name) of its live.* object */
declare var RP_VARNAMES: { [key: string]: string };
declare function rpDspSchedule(): void;
declare function rpBroadcastDsp(): void;
declare function rpApplyPanelTheme(): void;
declare function rpOnInit(): void;
declare function rpScopeBind(name: string): void;

// Hooks a face may define (src/reverbplus_face_common.js calls them behind `typeof`).
declare function onParam(key: string, value: number): void;
declare function onFrame(t: any): boolean | void;
declare function onState(kind: string): void;
