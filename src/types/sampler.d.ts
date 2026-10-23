// Globals that scripts/build_sampler.py injects after src/sampler_face.js (see make_viz / face_params_json).

interface FaceParamSpec {
    lo: number;
    hi: number;
    init: number;
    exp: number;
    /** Live unitstyle; 9 = enum. */
    unit: number;
    enums?: string[];
}

/** "main", "side", "inspector", "adsr" or "filt": which v8ui canvas this copy of the face draws. */
declare var FACE_REGION: "main" | "side" | "inspector" | "adsr" | "filt";
/** Layout key -> scripting name of the box (src/sampler_layout_ableton.js; injected by the build). */
declare var AB_BOXNAMES: { [key: string]: string };
declare var FACE_PARAMS: { [key: string]: FaceParamSpec };
/** Main face only: the gen patch as .gendsp JSON and its content hash (deferred DSP, see loadDsp). */
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
declare var FACE_DESIGN: string | undefined;
declare var OSC2_UI_STYLE: string | undefined;
