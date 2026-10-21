// Globals that scripts/build_delayplus.py injects between delayplus_config.js and delayplus_link.js.
declare var DP_ROLE: "start" | "end";
declare var DP_BUILD: string;

// Optional hooks defined by only some of the concatenated scripts and called behind `typeof x === "function"`.
// dpTimeMs, dpPokeTimes, dpApplyPanelTheme and dpInitMidiRouting live in delayplus_ui.js (Start only; delayplus_link.js calls
// them); vizPreview lives in delayplus_viz_b.js.
declare function dpTimeMs(): number;
declare function dpPokeTimes(): void;
declare function dpApplyPanelTheme(): void;
declare function dpInitMidiRouting(): void;
declare function vizPreview(s: any): void;

// Deferred DSP (Start face only): the gen patch as .gendsp JSON, its hash, and the gen-bound
// parameters as key -> [gen message, divide by 100] (scripts/build_delayplus.py); the hooks in
// delayplus_dsp.js that delayplus_link.js / delayplus_ui.js call behind `typeof`.
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
declare var DP_GEN_PARAMS: { [key: string]: [string, boolean] };
declare function dpDspSchedule(): void;
declare function dpDspState(): { label: string, alert: boolean } | null;
