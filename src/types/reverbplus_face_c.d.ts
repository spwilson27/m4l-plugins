// Globals that scripts/reverbplus_layouts/c.py injects (as the v8ui's preamble) before src/reverbplus_face_c_head.js.
/** Names of the boxes (scripting names) the head strip shows / hides / greys, from the layout. */
declare var CC_LAYOUT: {
    /** presentation_rect of the hero v8ui (found by rectangle: the build gives v8uis no scripting name) */
    heroRect: number[];
    /** group -> scripting names: "more" (the More grid, always together), "tank" (tank-only part), "ir" (Convolution part) */
    groups: { [group: string]: string[] };
    /** parameter key -> scripting name of its live.* object (greyed by rpActive) */
    keyNames: { [key: string]: string };
};
