/** API of src/xo_stretch.js as seen by xo_node_engine.js (XO_STRETCH_EMBEDDED is prepended by scripts/build_xo_map.py). */
interface XoStretchApi {
  stretchAudioEx(
    channels: Float32Array[],
    sampleRate: number,
    opts?: { mode?: string; speed?: number; pitchSt?: number; grainMs?: number; amount?: number }
  ): { channels: Float32Array[]; engine: string; note: string };
}
declare const XO_STRETCH_EMBEDDED: XoStretchApi | undefined;
