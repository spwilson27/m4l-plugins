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

/** "main", "side" or "inspector": which v8ui canvas this copy of the face draws. */
declare var FACE_REGION: "main" | "side" | "inspector";
declare var FACE_PARAMS: { [key: string]: FaceParamSpec };
/** Main face only: the gen patch as .gendsp JSON and its content hash (deferred DSP, see loadDsp). */
declare var GEN_DSP_TEXT: string;
declare var GEN_DSP_HASH: string;
