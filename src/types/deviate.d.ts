// Globals that scripts/build_deviate.py injects into the Deviate scripts, and hooks only some of the concatenated scripts define.
/** the face name ("Roulette", ...) */
declare var DV_FACE: string;
/** "engine" (obj-engine) or "display" | "hit" (a face canvas) */
declare var DV_ROLE: string;
declare var DV_PREFIX: string;
declare var DV_THEMED: boolean;
declare var DV_CANVAS_ID: string;
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
/** parameter key -> [gen message, divisor] for the keys the engine re-sends to the gen */
declare var DV_GEN_PARAMS: { [key: string]: [string, number] };
/** [panel box id, Live theme colour name, fallback rgba] */
declare var DV_PANEL_THEME: Array<[string, string, number[]]>;
/** parameter key -> varname (the long name) of its live.* object */
declare var DV_VARNAMES: { [key: string]: string };
/** true once the Spectral split stage exists in the gen (the DSP lane flips it) */
declare var DV_SPEC_STAGE: boolean;
/** set by scripts/render_deviate_previews.py through the renderer's prelude: "idle" | "hit" | "ring" | "extreme" or {kind, ...} */
declare var DV_PREVIEW_STATE: string | { kind: string; spectral?: boolean; gate?: number; seed?: number; ageMs?: number } | undefined;

// Hooks a face may define (src/deviate_face_common.js calls them behind `typeof`).
declare function onParam(key: string, value: number): void;
declare function onFrame(t: any): boolean | void;
declare function onState(kind: string): void;
declare function preview(): void;
