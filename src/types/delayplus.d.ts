// Globals that scripts/build_delayplus.py injects between delayplus_config.js and delayplus_link.js.
declare var DP_ROLE: "start" | "end";
declare var DP_BUILD: string;

// Optional hooks defined by only some of the concatenated scripts and called behind `typeof x === "function"`.
// dpTimeMs lives in delayplus_ui.js (Start only; delayplus_link.js calls it); vizPreview lives in delayplus_viz_b.js.
declare function dpTimeMs(): number;
declare function vizPreview(s: any): void;
