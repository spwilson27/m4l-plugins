/**
 * XO Sample Map — Node for Max Engine (src/xo_node_engine.js)
 *
 * Responsibilities:
 *  1. Fast recursive audio directory scanner (.wav, .aif, .aiff, .flac, .mp3, .caf, .m4a)
 *  2. Zero-dependency WAV & AIFF/AIFC PCM/Float parser (8/16/24/32-bit, extensible, JUNK/LIST chunks)
 *  3. 12-Dimensional acoustic feature extractor:
 *     - Duration, Log-Duration, Attack Time, Decay Ratio, Zero-Crossing Rate, Crest Factor
 *     - 6-Band DFT Filterbank (Sub, Low, Low-Mid, Mid, High-Mid, High/Air)
 *     - Spectral Centroid (Brightness), Spectral Flatness (Noisiness), Spectral Rolloff
 *     - Autocorrelation Fundamental Pitch (Hz & MIDI note)
 *     - 32-bar normalized waveform peak envelope
 *  4. Hybrid Acoustic + Filename/Folder Auto-Categorizer (10 XO drum categories)
 *  5. 2D XO Constellation Embedding (Feature PCA + Semantic Angular Anchors + Force Relaxation)
 *  6. 12D k-Nearest-Neighbors (k-NN) similarity graph for instant neighbor stepping
 *  7. Persistent disk cache (~/.xo_sample_map_cache.json)
 *  8. Localhost HTTP + SSE server for the pop-out jweb Sample Space window
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { execFile } = require("child_process");

let Max = null;
let hasRealMaxApi = false;
try {
  Max = require("max-api");
  hasRealMaxApi = true;
} catch (_) {
  Max = global.__MAX_API_MOCK__ || {
    post: () => {},
    outlet: () => {},
    addHandler: () => {}
  };
}

const CACHE_FILE = path.join(os.homedir(), ".xo_sample_map_cache_v1.json");
const SUPPORTED_EXTS = new Set([".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg", ".m4a", ".caf"]);

const CORE_DRUM_PATHS = [
  "/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Core Library/Samples/One Shots/Drums",
  "/Applications/Ableton Live 12 Beta.app/Contents/App-Resources/Core Library/Samples/One Shots/Drums",
  "/Applications/Ableton Live 12 Standard.app/Contents/App-Resources/Core Library/Samples/One Shots/Drums"
];

const CATEGORY_LIST = [
  "kick", "snare", "hihat", "clap", "tom", "rim", "cymbal", "shaker", "perc", "fx"
];

const CATEGORY_ANGLES = {
  kick:   -2.35, // Bottom-left (Red/Coral)
  tom:    -1.65, // Left-bottom (Purple)
  snare:  -0.95, // Top-left (Orange)
  clap:   -0.35, // Top (Magenta)
  rim:     0.20, // Top-right (Rose)
  hihat:   0.80, // Right-top (Yellow)
  shaker:  1.35, // Right (Teal)
  cymbal:  1.95, // Bottom-right (Sky Blue)
  perc:    2.55, // Bottom-center (Green)
  fx:      3.05  // Far left (Indigo)
};

// ============================================================================
// 1. Binary WAV & AIFF/AIFC Audio Parser
// ============================================================================

function readIEEE80Extended(buf, offset) {
  if (offset + 10 > buf.length) return 44100;
  const expon = ((buf[offset] & 0x7f) << 8) | buf[offset + 1];
  const hiMant = buf.readUInt32BE(offset + 2);
  const loMant = buf.readUInt32BE(offset + 6);
  if (expon === 0 && hiMant === 0 && loMant === 0) return 0;
  const sign = (buf[offset] & 0x80) ? -1 : 1;
  let f = hiMant * Math.pow(2, expon - 16383 - 31) + loMant * Math.pow(2, expon - 16383 - 63);
  return sign * f;
}

function parseWavBuffer(buf, fullFileSize) {
  if (buf.length < 44) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return null;
  }
  let pos = 12;
  let audioFormat = 1;
  let channels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let blockAlign = 2;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", pos, pos + 4);
    const chunkSize = buf.readUInt32LE(pos + 4);
    const payloadStart = pos + 8;

    if (chunkId === "fmt " && payloadStart + 16 <= buf.length) {
      audioFormat = buf.readUInt16LE(payloadStart);
      channels = Math.max(1, buf.readUInt16LE(payloadStart + 2));
      sampleRate = Math.max(8000, buf.readUInt32LE(payloadStart + 4));
      blockAlign = Math.max(1, buf.readUInt16LE(payloadStart + 12));
      bitsPerSample = buf.readUInt16LE(payloadStart + 14);
      if (audioFormat === 0xfffe && chunkSize >= 40 && payloadStart + 26 <= buf.length) {
        audioFormat = buf.readUInt16LE(payloadStart + 24);
      }
    } else if (chunkId === "data") {
      dataOffset = payloadStart;
      dataSize = chunkSize;
      break;
    }
    pos = payloadStart + chunkSize + (chunkSize & 1);
  }

  if (dataOffset < 0 || dataOffset >= buf.length) return null;
  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const frameStep = Math.max(channels * bytesPerSample, blockAlign);
  const totalFileDataBytes = dataSize > 0 ? dataSize : Math.max(0, (fullFileSize || buf.length) - dataOffset);
  const totalFrames = Math.floor(totalFileDataBytes / frameStep);
  const availBytes = Math.min(buf.length - dataOffset, totalFileDataBytes);
  const availFrames = Math.floor(availBytes / frameStep);
  if (availFrames <= 0) return null;

  const maxDecodeFrames = Math.min(availFrames, sampleRate * 2); // Decode up to 2.0s mono for analysis
  const mono = new Float32Array(maxDecodeFrames);

  for (let i = 0; i < maxDecodeFrames; i++) {
    const fPos = dataOffset + i * frameStep;
    if (fPos + bytesPerSample > buf.length) break;
    let s = 0;
    if (audioFormat === 3 && bitsPerSample === 32) {
      s = buf.readFloatLE(fPos);
    } else if (bitsPerSample === 8) {
      s = (buf.readUInt8(fPos) - 128) / 128.0;
    } else if (bitsPerSample === 16) {
      s = buf.readInt16LE(fPos) / 32768.0;
    } else if (bitsPerSample === 24) {
      let v = buf[fPos] | (buf[fPos + 1] << 8) | (buf[fPos + 2] << 16);
      if (v & 0x800000) v |= 0xff000000;
      s = v / 8388608.0;
    } else if (bitsPerSample === 32) {
      s = buf.readInt32LE(fPos) / 2147483648.0;
    }
    mono[i] = Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
  }

  return {
    sampleRate,
    channels,
    totalFrames,
    durationMs: (totalFrames / sampleRate) * 1000.0,
    samples: mono
  };
}

function parseAiffBuffer(buf, fullFileSize) {
  if (buf.length < 46) return null;
  const form = buf.toString("ascii", 0, 4);
  const aiffType = buf.toString("ascii", 8, 12);
  if (form !== "FORM" || (aiffType !== "AIFF" && aiffType !== "AIFC")) {
    return null;
  }

  let pos = 12;
  let channels = 1;
  let totalFrames = 0;
  let bitsPerSample = 16;
  let sampleRate = 44100;
  let littleEndian = false;
  let isFloat = false;
  let ssndOffset = -1;
  let ssndSize = 0;

  while (pos + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", pos, pos + 4);
    const chunkSize = buf.readUInt32BE(pos + 4);
    const payloadStart = pos + 8;

    if (chunkId === "COMM" && payloadStart + 18 <= buf.length) {
      channels = Math.max(1, buf.readUInt16BE(payloadStart));
      totalFrames = buf.readUInt32BE(payloadStart + 2);
      bitsPerSample = buf.readUInt16BE(payloadStart + 6);
      sampleRate = Math.max(8000, Math.round(readIEEE80Extended(buf, payloadStart + 8)));
      if (aiffType === "AIFC" && chunkSize >= 22 && payloadStart + 22 <= buf.length) {
        const compType = buf.toString("ascii", payloadStart + 18, payloadStart + 22);
        if (compType === "sowt") littleEndian = true;
        else if (compType === "fl32" || compType === "FL32") isFloat = true;
        else if (compType !== "NONE" && compType !== "twos") return null;
      }
    } else if (chunkId === "SSND" && payloadStart + 8 <= buf.length) {
      const dataOff = buf.readUInt32BE(payloadStart);
      ssndOffset = payloadStart + 8 + dataOff;
      ssndSize = Math.max(0, chunkSize - 8 - dataOff);
      break;
    }
    pos = payloadStart + chunkSize + (chunkSize & 1);
  }

  if (ssndOffset < 0 || ssndOffset >= buf.length) return null;
  const bytesPerSample = Math.max(1, Math.floor((bitsPerSample + 7) / 8));
  const frameStep = channels * bytesPerSample;
  if (totalFrames <= 0) {
    const estBytes = ssndSize > 0 ? ssndSize : Math.max(0, (fullFileSize || buf.length) - ssndOffset);
    totalFrames = Math.floor(estBytes / frameStep);
  }
  const availFrames = Math.floor((buf.length - ssndOffset) / frameStep);
  if (availFrames <= 0) return null;

  const maxDecodeFrames = Math.min(availFrames, sampleRate * 2);
  const mono = new Float32Array(maxDecodeFrames);

  for (let i = 0; i < maxDecodeFrames; i++) {
    const fPos = ssndOffset + i * frameStep;
    if (fPos + bytesPerSample > buf.length) break;
    let s = 0;
    if (isFloat && bitsPerSample === 32) {
      s = littleEndian ? buf.readFloatLE(fPos) : buf.readFloatBE(fPos);
    } else if (bitsPerSample === 8) {
      s = buf.readInt8(fPos) / 128.0;
    } else if (bitsPerSample === 16) {
      s = (littleEndian ? buf.readInt16LE(fPos) : buf.readInt16BE(fPos)) / 32768.0;
    } else if (bitsPerSample === 24) {
      let v = littleEndian
        ? (buf[fPos] | (buf[fPos + 1] << 8) | (buf[fPos + 2] << 16))
        : ((buf[fPos] << 16) | (buf[fPos + 1] << 8) | buf[fPos + 2]);
      if (v & 0x800000) v |= 0xff000000;
      s = v / 8388608.0;
    } else if (bitsPerSample === 32) {
      s = (littleEndian ? buf.readInt32LE(fPos) : buf.readInt32BE(fPos)) / 2147483648.0;
    }
    mono[i] = Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
  }

  return {
    sampleRate,
    channels,
    totalFrames,
    durationMs: (totalFrames / sampleRate) * 1000.0,
    samples: mono
  };
}

function parseAudioBuffer(buf, fullFileSize) {
  if (!buf || buf.length < 44) return null;
  const magic = buf.toString("ascii", 0, 4);
  if (magic === "RIFF") return parseWavBuffer(buf, fullFileSize);
  if (magic === "FORM") return parseAiffBuffer(buf, fullFileSize);
  return null;
}

// ============================================================================
// 2. 12-Dimensional Acoustic Feature Extractor
// ============================================================================

function extractAudioFeatures(decoded) {
  const { sampleRate, durationMs: rawDurationMs, samples } = decoded;
  const N = samples.length;
  if (N < 32) return null;

  // 1. Find peak amplitude, onset index, and effective end (above -54 dB)
  let peakAmp = 0;
  let peakIdx = 0;
  for (let i = 0; i < N; i++) {
    const a = Math.abs(samples[i]);
    if (a > peakAmp) {
      peakAmp = a;
      peakIdx = i;
    }
  }
  const normScale = peakAmp > 1e-5 ? 1.0 / peakAmp : 1.0;
  const onsetThresh = 0.05;
  const silenceThresh = 0.004;
  let onsetIdx = 0;
  let endIdx = N - 1;

  for (let i = 0; i < N; i++) {
    if (Math.abs(samples[i]) * normScale >= onsetThresh) {
      onsetIdx = i;
      break;
    }
  }
  for (let i = N - 1; i > onsetIdx + 64; i--) {
    if (Math.abs(samples[i]) * normScale >= silenceThresh) {
      endIdx = i;
      break;
    }
  }

  const activeLen = Math.max(64, endIdx - onsetIdx + 1);
  const trimmedMs = (activeLen / sampleRate) * 1000.0;
  const durationMs = rawDurationMs > 2000 ? rawDurationMs : Math.max(15, trimmedMs);
  const logDuration = Math.max(0, Math.min(1, (Math.log10(Math.max(15, durationMs)) - 1.17) / 2.55));

  // 2. Attack time & Crest factor & Zero-Crossing Rate (ZCR)
  const attackSamples = Math.max(1, peakIdx - onsetIdx);
  const attackMs = (attackSamples / sampleRate) * 1000.0;
  const logAttack = Math.max(0, Math.min(1, Math.log10(1 + attackMs) / 2.5));

  let sumSq = 0;
  let zeroCrossings = 0;
  let firstHalfEnergy = 0;
  let secondHalfEnergy = 0;
  const halfPoint = onsetIdx + Math.floor(activeLen * 0.35);

  for (let i = onsetIdx; i <= endIdx; i++) {
    const s = samples[i] * normScale;
    const e = s * s;
    sumSq += e;
    if (i < halfPoint) firstHalfEnergy += e;
    else secondHalfEnergy += e;
    if (i > onsetIdx && ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0))) {
      zeroCrossings++;
    }
  }

  const rms = Math.sqrt(sumSq / activeLen);
  const crestFactor = Math.min(1.0, (1.0 / Math.max(0.02, rms)) / 20.0);
  const zcr = Math.min(1.0, (zeroCrossings / activeLen) / 0.45);
  const decayRatio = Math.min(1.0, secondHalfEnergy / Math.max(1e-6, firstHalfEnergy + secondHalfEnergy));

  // 3. 32-Bar Waveform Peak Envelope
  const peaks = [];
  const numBars = 32;
  const barSpan = Math.max(1, Math.floor(activeLen / numBars));
  for (let b = 0; b < numBars; b++) {
    const st = onsetIdx + b * barSpan;
    const en = Math.min(endIdx, st + barSpan);
    let m = 0;
    for (let i = st; i <= en; i++) {
      const a = Math.abs(samples[i]) * normScale;
      if (a > m) m = a;
    }
    peaks.push(Math.round(Math.pow(m, 0.75) * 100) / 100);
  }

  // 4. Spectral Analysis via Goertzel / DFT Filterbank across 24 log-spaced frequencies (35 Hz .. 14 kHz)
  const specWin = Math.min(1024, activeLen);
  const freqs = [
    40, 55, 75, 100,       // Sub (0..3)
    135, 180, 240, 320,    // Low (4..7)
    450, 650, 950, 1350,   // Mid-Low (8..11)
    1900, 2600, 3500, 4800,// Mid-High (12..15)
    6400, 8500, 11000, 14000 // High/Air (16..19)
  ];
  const bandEnergies = new Float64Array(freqs.length);
  let totalSpecEnergy = 1e-9;

  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    if (f >= sampleRate * 0.48) continue;
    const omega = (2.0 * Math.PI * f) / sampleRate;
    const coeff = 2.0 * Math.cos(omega);
    let q1 = 0;
    let q2 = 0;
    for (let n = 0; n < specWin; n++) {
      const w = 0.5 - 0.5 * Math.cos((2.0 * Math.PI * n) / (specWin - 1));
      const x = samples[onsetIdx + n] * normScale * w;
      const q0 = coeff * q1 - q2 + x;
      q2 = q1;
      q1 = q0;
    }
    const magSq = Math.max(1e-12, q1 * q1 + q2 * q2 - coeff * q1 * q2);
    const mag = Math.sqrt(magSq);
    bandEnergies[k] = mag;
    totalSpecEnergy += mag;
  }

  // Spectral Centroid (log-frequency weighted) & Flatness & Band Ratios
  let weightedFreqSum = 0;
  let logSum = 0;
  let subE = 0, lowE = 0, midE = 0, highE = 0;

  for (let k = 0; k < freqs.length; k++) {
    const normPos = k / (freqs.length - 1);
    const e = bandEnergies[k];
    weightedFreqSum += normPos * e;
    logSum += Math.log(Math.max(1e-9, e));
    if (k < 4) subE += e;
    else if (k < 9) lowE += e;
    else if (k < 15) midE += e;
    else highE += e;
  }

  const centroid = Math.max(0, Math.min(1, weightedFreqSum / totalSpecEnergy));
  const geomMean = Math.exp(logSum / freqs.length);
  const arithMean = totalSpecEnergy / freqs.length;
  const flatness = Math.max(0, Math.min(1, geomMean / Math.max(1e-9, arithMean)));

  const subRatio = Math.round((subE / totalSpecEnergy) * 100) / 100;
  const lowRatio = Math.round((lowE / totalSpecEnergy) * 100) / 100;
  const midRatio = Math.round((midE / totalSpecEnergy) * 100) / 100;
  const highRatio = Math.round((highE / totalSpecEnergy) * 100) / 100;

  // 5. Autocorrelation Fundamental Pitch Estimate (40 Hz .. 1200 Hz)
  const pitchWin = Math.min(1024, activeLen);
  const minLag = Math.max(4, Math.floor(sampleRate / 1200));
  const maxLag = Math.min(Math.floor(pitchWin * 0.6), Math.floor(sampleRate / 38));
  let bestLag = 0;
  let bestCorr = 0;
  let zeroLagEnergy = 1e-9;

  for (let i = 0; i < pitchWin; i++) {
    const s = samples[onsetIdx + i] * normScale;
    zeroLagEnergy += s * s;
  }

  for (let lag = minLag; lag <= maxLag; lag += 2) {
    let corr = 0;
    for (let i = 0; i < pitchWin - lag; i += 2) {
      corr += (samples[onsetIdx + i] * normScale) * (samples[onsetIdx + i + lag] * normScale);
    }
    const normCorr = (corr * 2) / zeroLagEnergy;
    if (normCorr > bestCorr) {
      bestCorr = normCorr;
      bestLag = lag;
    }
  }

  const pitchHz = bestLag > 0 && bestCorr > 0.22 ? Math.round((sampleRate / bestLag) * 10) / 10 : 0;
  const pitchMidi = pitchHz > 20 ? Math.round(69 + 12 * Math.log2(pitchHz / 440.0)) : 48;
  const normPitch = Math.max(0, Math.min(1, (pitchMidi - 24) / 60));

  return {
    durationMs: Math.round(durationMs),
    logDuration,
    attackMs: Math.round(attackMs * 10) / 10,
    logAttack,
    decayRatio,
    zcr,
    crestFactor,
    centroid: Math.round(centroid * 1000) / 1000,
    flatness: Math.round(flatness * 1000) / 1000,
    subRatio,
    lowRatio,
    midRatio,
    highRatio,
    pitchHz,
    pitchMidi,
    normPitch,
    peaks,
    vector: [
      centroid,
      flatness,
      logDuration,
      logAttack,
      decayRatio,
      zcr,
      subRatio,
      lowRatio,
      midRatio,
      highRatio,
      normPitch,
      crestFactor
    ]
  };
}

// ============================================================================
// 3. Auto-Categorizer (Filename / Folder + Acoustic Feature Fallback)
// ============================================================================

function classifySample(filePath, features) {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const dir = path.basename(path.dirname(filePath)).toLowerCase();
  const combined = `${dir} ${base}`;

  if (/\b(kick|bd|bassdrum|808 sub|909 bd)\b/.test(combined) || dir === "kick") return "kick";
  if (/\b(snare|sd|snba|snr)\b/.test(combined) || dir === "snare") return "snare";
  if (/\b(hihat|hat|hh|chh|ohh|closed hat|open hat)\b/.test(combined) || dir === "hihat") return "hihat";
  if (/\b(clap|clp|handclap)\b/.test(combined) || dir === "clap") return "clap";
  if (/\b(tom|flr|midtom|hitom|lowtom)\b/.test(combined) || dir === "tom") return "tom";
  if (/\b(rim|rimshot|sidestick|stick)\b/.test(combined) || dir === "rim") return "rim";
  if (/\b(cymbal|crash|ride|cym)\b/.test(combined) || dir === "cymbal" || dir === "ride") return "cymbal";
  if (/\b(shaker|shk|tambourine|tamb|maraca|cabasa)\b/.test(combined) || dir === "shaker" || dir === "tambourine") return "shaker";
  if (/\b(bongo|conga|timbale|wood|clave|cowbell|bell|agogo|triangle|perc)\b/.test(combined) ||
      ["bongo", "conga", "timbales", "wood", "bell", "electronic percussion", "misc percussion"].includes(dir)) {
    return "perc";
  }
  if (/\b(fx|impact|laser|sweep|noise|riser|downer|zap|utility|vinyl)\b/.test(combined) || dir === "fx hit" || dir === "utility") {
    return "fx";
  }

  // Acoustic classification fallback when filename is generic
  if (!features) return "perc";
  if (features.subRatio + features.lowRatio > 0.58 && features.centroid < 0.34 && features.zcr < 0.18) {
    return features.pitchHz > 95 ? "tom" : "kick";
  }
  if (features.highRatio > 0.45 && features.zcr > 0.35) {
    if (features.durationMs > 420) return "cymbal";
    if (features.attackMs > 18) return "shaker";
    return "hihat";
  }
  if (features.midRatio + features.highRatio > 0.55 && features.flatness > 0.42) {
    return features.attackMs > 10 ? "clap" : "snare";
  }
  if (features.durationMs < 95 && features.midRatio > 0.38) {
    return "rim";
  }
  return "perc";
}

// ============================================================================
// 4. 2D XO Constellation Map & 12D k-NN Graph
// ============================================================================

function computeKNN(samples, k = 8) {
  const N = samples.length;
  if (N === 0) return;
  const actualK = Math.min(k, Math.max(0, N - 1));

  // Weights emphasize perceptual timbre (centroid, band ratios, duration, ZCR, flatness)
  const weights = [2.2, 1.4, 1.8, 1.2, 1.2, 1.6, 2.0, 1.6, 1.5, 1.8, 1.0, 0.8];

  for (let i = 0; i < N; i++) {
    const vi = samples[i].vector || [];
    const cati = samples[i].category;
    const dists = [];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const vj = samples[j].vector || [];
      let d2 = 0;
      for (let d = 0; d < weights.length; d++) {
        const diff = (vi[d] || 0) - (vj[d] || 0);
        d2 += weights[d] * diff * diff;
      }
      // Slight semantic bonus for same drum category so nearest neighbors feel cohesive
      if (samples[j].category !== cati) d2 += 0.35;
      dists.push({ idx: j, d2 });
    }
    dists.sort((a, b) => a.d2 - b.d2);
    samples[i].neighbors = dists.slice(0, actualK).map((x) => x.idx);
  }
}

function compute2DMap(samples) {
  const N = samples.length;
  if (N === 0) return;

  // Step 1: Compute initial semantic + acoustic polar coordinates
  // Radius encodes brightness/duration contrast; angle blends category sector with spectral tilt
  const pts = new Array(N);
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const baseAngle = CATEGORY_ANGLES[s.category] !== undefined ? CATEGORY_ANGLES[s.category] : 0;
    const v = s.vector || [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5];

    // Angular offset within sector driven by brightness (centroid), pitch, and noisiness (zcr)
    const angleOffset = ((v[0] - 0.45) * 0.55) + ((v[5] - 0.3) * 0.35) + ((v[10] - 0.5) * 0.25);
    const angle = baseAngle + angleOffset;

    // Radial distance from center driven by logDuration, decayRatio, and sub/high energy
    const radialBase = 0.20 + 0.58 * (0.45 * v[2] + 0.30 * v[0] + 0.25 * (1.0 - v[6]));
    const r = Math.max(0.08, Math.min(0.88, radialBase));

    pts[i] = {
      x: 0.5 + Math.cos(angle) * r * 0.48,
      y: 0.5 + Math.sin(angle) * r * 0.48
    };
  }

  // Step 2: Iterative k-NN attraction + local collision repulsion (UMAP/t-SNE style relaxation)
  const iterations = 36;
  const minDist = Math.max(0.011, Math.min(0.032, 0.48 / Math.sqrt(N)));
  const minDistSq = minDist * minDist;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 0.18 * (1.0 - iter / iterations);

    // Pull slightly toward acoustic k-NN neighbors
    for (let i = 0; i < N; i++) {
      const nbrs = samples[i].neighbors || [];
      let gx = 0, gy = 0;
      const take = Math.min(4, nbrs.length);
      if (take > 0) {
        for (let k = 0; k < take; k++) {
          const nIdx = nbrs[k];
          gx += pts[nIdx].x - pts[i].x;
          gy += pts[nIdx].y - pts[i].y;
        }
        pts[i].x += (gx / take) * alpha * 0.45;
        pts[i].y += (gy / take) * alpha * 0.45;
      }
    }

    // Repel overlapping / crowded points
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = pts[j].x - pts[i].x;
        const dy = pts[j].y - pts[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDistSq) {
          const d = Math.sqrt(d2) || 1e-4;
          const push = ((minDist - d) / d) * 0.35;
          const px = dx * push;
          const py = dy * push;
          pts[i].x -= px;
          pts[i].y -= py;
          pts[j].x += px;
          pts[j].y += py;
        }
      }
    }
  }

  // Step 3: Normalize into [0.05 .. 0.95] bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < N; i++) {
    if (pts[i].x < minX) minX = pts[i].x;
    if (pts[i].x > maxX) maxX = pts[i].x;
    if (pts[i].y < minY) minY = pts[i].y;
    if (pts[i].y > maxY) maxY = pts[i].y;
  }
  const spanX = Math.max(1e-5, maxX - minX);
  const spanY = Math.max(1e-5, maxY - minY);

  for (let i = 0; i < N; i++) {
    samples[i].x = Math.round((0.05 + ((pts[i].x - minX) / spanX) * 0.90) * 10000) / 10000;
    samples[i].y = Math.round((0.05 + ((pts[i].y - minY) / spanY) * 0.90) * 10000) / 10000;
  }
}

// ============================================================================
// 5. Directory Scanner & Cache Manager
// ============================================================================

function loadDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch (_) {}
  return { entries: {}, favorites: {} };
}

function saveDiskCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf8");
  } catch (_) {}
}

function collectAudioFilesRecursive(dirPath, maxFiles = 750, out = []) {
  if (out.length >= maxFiles) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return out;
  }
  // Sort deterministically
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const subdirs = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      subdirs.push(full);
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        out.push(full);
        if (out.length >= maxFiles) return out;
      }
    }
  }

  for (const sub of subdirs) {
    collectAudioFilesRecursive(sub, maxFiles, out);
    if (out.length >= maxFiles) break;
  }
  return out;
}

function analyzeAudioFile(filePath, cache) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (_) {
    return null;
  }
  const cacheKey = `${filePath}|${st.size}|${Math.floor(st.mtimeMs)}`;
  if (cache && cache.entries && cache.entries[cacheKey]) {
    const cached = { ...cache.entries[cacheKey] };
    cached.favorite = !!(cache.favorites && cache.favorites[filePath]);
    return cached;
  }

  // Read up to first 256 KB for fast header + transient/body analysis
  const readLen = Math.min(st.size, 262144);
  const buf = Buffer.allocUnsafe(readLen);
  let bytesRead = 0;
  let fd = null;
  try {
    fd = fs.openSync(filePath, "r");
    bytesRead = fs.readSync(fd, buf, 0, readLen, 0);
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }

  const slice = bytesRead < readLen ? buf.subarray(0, bytesRead) : buf;
  const decoded = parseAudioBuffer(slice, st.size);
  if (!decoded) return null;

  const feats = extractAudioFeatures(decoded);
  if (!feats) return null;

  const category = classifySample(filePath, feats);
  const folder = path.basename(path.dirname(filePath));
  const name = path.basename(filePath, path.extname(filePath));

  const item = {
    name,
    path: filePath,
    folder,
    category,
    durationMs: feats.durationMs,
    attackMs: feats.attackMs,
    centroid: feats.centroid,
    flatness: feats.flatness,
    zcr: feats.zcr,
    subRatio: feats.subRatio,
    lowRatio: feats.lowRatio,
    midRatio: feats.midRatio,
    highRatio: feats.highRatio,
    pitchHz: feats.pitchHz,
    pitchMidi: feats.pitchMidi,
    peaks: feats.peaks,
    vector: feats.vector,
    favorite: !!(cache && cache.favorites && cache.favorites[filePath]),
    x: 0.5,
    y: 0.5,
    neighbors: []
  };

  if (cache && cache.entries) {
    cache.entries[cacheKey] = item;
  }
  return item;
}

function scanDirectories(dirs, maxFiles = 750) {
  const cache = loadDiskCache();
  const allFiles = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    // Balanced sampling across subdirectories if scanning a top-level Drum folder
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {}
    const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    if (subdirs.length >= 4) {
      const perSub = Math.max(20, Math.floor(maxFiles / subdirs.length));
      for (const sd of subdirs) {
        collectAudioFilesRecursive(path.join(d, sd.name), allFiles.length + perSub, allFiles);
      }
    } else {
      collectAudioFilesRecursive(d, maxFiles, allFiles);
    }
  }

  const samples = [];
  const folderSet = new Set();
  for (const f of allFiles) {
    const item = analyzeAudioFile(f, cache);
    if (item) {
      samples.push(item);
      folderSet.add(item.folder);
    }
  }

  computeKNN(samples, 8);
  compute2DMap(samples);
  saveDiskCache(cache);

  return {
    samples,
    folders: Array.from(folderSet).sort()
  };
}

// ============================================================================
// 6. Runtime State, Max Outlet Sync & HTTP/SSE Server
// ============================================================================

const engineState = {
  scannedDirs: [],
  samples: [],
  folders: [],
  selectedIndex: -1,
  activeCategory: "ALL",
  maxLenMs: 5000,
  toneFilter: 0,
  pitchSt: 0,
  decayMs: 2500,
  gainDb: 0,
  autoLoad: false,
  lockTarget: false,
  targetName: "Auto (Simpler / Pad)",
  statusText: "Initializing..."
};

const sseClients = new Set();

function broadcastSSE(partial) {
  const payload = `data: ${JSON.stringify(partial)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

function syncMiniMapToMax() {
  if (!Max || typeof Max.outlet !== "function") return;
  Max.outlet("minimap_clear");
  const batchSize = 50;
  for (let i = 0; i < engineState.samples.length; i += batchSize) {
    const slice = engineState.samples.slice(i, i + batchSize);
    const flat = [];
    for (let j = 0; j < slice.length; j++) {
      const s = slice[j];
      const catIdx = Math.max(0, CATEGORY_LIST.indexOf(s.category));
      flat.push(
        Math.round(s.x * 1000) / 1000,
        Math.round(s.y * 1000) / 1000,
        catIdx,
        Math.round(s.durationMs),
        Math.round((s.centroid || 0.5) * 100)
      );
    }
    Max.outlet("minimap_batch", i, ...flat);
  }
  Max.outlet("minimap_done", engineState.samples.length, engineState.statusText);
  if (engineState.selectedIndex >= 0) {
    emitSelectedToMax(engineState.selectedIndex, false);
  }
}

function emitSelectedToMax(idx, audition = true) {
  if (idx < 0 || idx >= engineState.samples.length) return;
  engineState.selectedIndex = idx;
  const s = engineState.samples[idx];
  const catIdx = Math.max(0, CATEGORY_LIST.indexOf(s.category));

  if (Max && typeof Max.outlet === "function") {
    Max.outlet(
      "selected_info",
      idx,
      s.name,
      s.category,
      catIdx,
      Math.round(s.durationMs),
      Math.round((s.centroid || 0.5) * 100),
      s.favorite ? 1 : 0,
      ...(s.peaks || []).slice(0, 32),
      "nbrs",
      ...(s.neighbors || []).slice(0, 8)
    );

    if (audition) {
      const speed = Math.pow(2.0, (engineState.pitchSt || 0) / 12.0);
      Max.outlet("play_speed", speed);
      Max.outlet("play_decay", engineState.decayMs || 2500);
      Max.outlet("play_file", s.path);
      if (engineState.autoLoad) {
        Max.outlet("lom_load_simpler", s.path);
      }
    }
  }

  broadcastSSE({
    selectedIndex: idx,
    statusText: `${s.name} (${s.category.toUpperCase()} • ${Math.round(s.durationMs)} ms)`
  });
}

function findDefaultCoreDrumsDir() {
  for (const p of CORE_DRUM_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function performScan(dirs) {
  const validDirs = dirs.filter((d) => d && fs.existsSync(d));
  if (validDirs.length === 0) {
    engineState.statusText = "No sample folder found — click Add Folder";
    broadcastSSE({ statusText: engineState.statusText });
    return;
  }
  engineState.scannedDirs = validDirs;
  engineState.statusText = "Scanning audio files...";
  broadcastSSE({ statusText: engineState.statusText });

  const result = scanDirectories(validDirs, 600);
  engineState.samples = result.samples;
  engineState.folders = result.folders;
  engineState.selectedIndex = result.samples.length > 0 ? 0 : -1;
  engineState.statusText = `${result.samples.length} samples mapped`;

  syncMiniMapToMax();
  broadcastSSE({
    samples: engineState.samples,
    folders: engineState.folders,
    selectedIndex: engineState.selectedIndex,
    statusText: engineState.statusText
  });
}

function getUIHtml() {
  if (typeof EMBEDDED_XO_HTML === "string" && EMBEDDED_XO_HTML.length > 50) {
    return EMBEDDED_XO_HTML;
  }
  const htmlPath = path.join(__dirname, "xo_map_ui.html");
  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, "utf8");
  }
  return "<html><body><h1>XO Sample Space</h1></body></html>";
}

let httpServer = null;
let serverPort = 0;

function startHttpServer(callback) {
  if (httpServer && serverPort > 0) {
    if (callback) callback(serverPort);
    return;
  }
  httpServer = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getUIHtml());
      return;
    }

    if (req.method === "GET" && req.url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(engineState));
      return;
    }

    if (req.method === "GET" && req.url === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write(`data: ${JSON.stringify({ statusText: engineState.statusText, selectedIndex: engineState.selectedIndex })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    if (req.method === "POST" && req.url === "/api/action") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body || "{}");
          handleAction(msg);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(err) }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  httpServer.listen(0, "127.0.0.1", () => {
    serverPort = httpServer.address().port;
    const url = `http://127.0.0.1:${serverPort}`;
    if (Max && typeof Max.outlet === "function") {
      Max.outlet("server_url", url);
    }
    if (callback) callback(serverPort);
  });
}

function handleAction(msg) {
  const { action } = msg;
  if (action === "select") {
    emitSelectedToMax(Number(msg.index), msg.audition !== false);
  } else if (action === "load_simpler") {
    const idx = msg.index !== undefined ? Number(msg.index) : engineState.selectedIndex;
    const s = engineState.samples[idx];
    if (s && Max) Max.outlet("lom_load_simpler", s.path);
  } else if (action === "load_clip") {
    const idx = msg.index !== undefined ? Number(msg.index) : engineState.selectedIndex;
    const s = engineState.samples[idx];
    if (s && Max) Max.outlet("lom_load_clip", s.path);
  } else if (action === "reveal") {
    const idx = msg.index !== undefined ? Number(msg.index) : engineState.selectedIndex;
    const s = engineState.samples[idx];
    if (s && fs.existsSync(s.path)) {
      execFile("open", ["-R", s.path], () => {});
    }
  } else if (action === "toggle_favorite") {
    const idx = Number(msg.index);
    const s = engineState.samples[idx];
    if (s) {
      s.favorite = !s.favorite;
      const cache = loadDiskCache();
      cache.favorites = cache.favorites || {};
      if (s.favorite) cache.favorites[s.path] = true;
      else delete cache.favorites[s.path];
      saveDiskCache(cache);
      emitSelectedToMax(idx, false);
    }
  } else if (action === "scan_core") {
    const core = findDefaultCoreDrumsDir();
    if (core) performScan([core]);
  } else if (action === "prompt_folder") {
    if (Max) Max.outlet("prompt_folder");
  } else if (action === "set_filter") {
    if (msg.category !== undefined) {
      engineState.activeCategory = msg.category;
      if (Max) Max.outlet("strip_filter_cat", msg.category);
    }
    if (msg.maxLenMs !== undefined) {
      engineState.maxLenMs = Number(msg.maxLenMs);
      if (Max) Max.outlet("strip_filter_maxlen", engineState.maxLenMs);
    }
    if (msg.toneFilter !== undefined) {
      engineState.toneFilter = Number(msg.toneFilter);
      if (Max) Max.outlet("strip_filter_tone", engineState.toneFilter);
    }
  } else if (action === "set_playback") {
    if (msg.pitchSt !== undefined) {
      engineState.pitchSt = Number(msg.pitchSt);
      if (Max) Max.outlet("play_speed", Math.pow(2.0, engineState.pitchSt / 12.0));
    }
    if (msg.decayMs !== undefined) {
      engineState.decayMs = Number(msg.decayMs);
      if (Max) Max.outlet("play_decay", engineState.decayMs);
    }
    if (msg.gainDb !== undefined) {
      engineState.gainDb = Number(msg.gainDb);
      if (Max) Max.outlet("play_gain", engineState.gainDb);
    }
  } else if (action === "set_autoload") {
    engineState.autoLoad = !!msg.autoLoad;
    if (Max) Max.outlet("strip_autoload", engineState.autoLoad ? 1 : 0);
  } else if (action === "set_lock_target") {
    engineState.lockTarget = !!msg.lockTarget;
    if (Max) Max.outlet("lom_lock_target", engineState.lockTarget ? 1 : 0);
  }
}

// ============================================================================
// 7. Max Message Handlers
// ============================================================================

if (Max && typeof Max.addHandler === "function") {
  Max.addHandler("init", () => {
    startHttpServer((port) => {
      Max.outlet("server_url", `http://127.0.0.1:${port}`);
    });
    if (engineState.samples.length === 0) {
      const core = findDefaultCoreDrumsDir();
      if (core) performScan([core]);
    } else {
      syncMiniMapToMax();
    }
  });

  Max.addHandler("scan_core", () => {
    const core = findDefaultCoreDrumsDir();
    if (core) performScan([core]);
  });

  Max.addHandler("add_folder", (folderPath) => {
    if (!folderPath || typeof folderPath !== "string") return;
    // Strip Max "Macintosh HD:" prefix if present
    let clean = folderPath.replace(/^[^/]+:/, "/");
    if (!fs.existsSync(clean) && fs.existsSync(folderPath)) clean = folderPath;
    if (fs.existsSync(clean)) {
      const stat = fs.statSync(clean);
      const dir = stat.isDirectory() ? clean : path.dirname(clean);
      const nextDirs = Array.from(new Set([...engineState.scannedDirs, dir]));
      performScan(nextDirs);
    }
  });

  Max.addHandler("select_index", (idx, audition = 1) => {
    emitSelectedToMax(Number(idx), Number(audition) !== 0);
  });

  Max.addHandler("replay", () => {
    if (engineState.selectedIndex >= 0) {
      emitSelectedToMax(engineState.selectedIndex, true);
    }
  });

  Max.addHandler("step_similar", (dir) => {
    if (engineState.samples.length === 0) return;
    const curIdx = engineState.selectedIndex >= 0 ? engineState.selectedIndex : 0;
    const cur = engineState.samples[curIdx];
    const nbrs = (cur && cur.neighbors) ? cur.neighbors : [];
    if (nbrs.length === 0) return;
    const nextIdx = Number(dir) >= 0 ? nbrs[0] : nbrs[nbrs.length - 1];
    emitSelectedToMax(nextIdx, true);
  });

  Max.addHandler("random_sample", () => {
    if (engineState.samples.length === 0) return;
    const pick = Math.floor(Math.random() * engineState.samples.length);
    emitSelectedToMax(pick, true);
  });

  Max.addHandler("load_selected", () => {
    if (engineState.selectedIndex >= 0) {
      const s = engineState.samples[engineState.selectedIndex];
      if (s) Max.outlet("lom_load_simpler", s.path);
    }
  });

  Max.addHandler("clip_selected", () => {
    if (engineState.selectedIndex >= 0) {
      const s = engineState.samples[engineState.selectedIndex];
      if (s) Max.outlet("lom_load_clip", s.path);
    }
  });

  Max.addHandler("reveal_selected", () => {
    if (engineState.selectedIndex >= 0) {
      const s = engineState.samples[engineState.selectedIndex];
      if (s && fs.existsSync(s.path)) {
        execFile("open", ["-R", s.path], () => {});
      }
    }
  });

  Max.addHandler("set_pitch", (st) => {
    engineState.pitchSt = Number(st) || 0;
    const speed = Math.pow(2.0, engineState.pitchSt / 12.0);
    Max.outlet("play_speed", speed);
    broadcastSSE({ pitchSt: engineState.pitchSt });
  });

  Max.addHandler("set_decay", (ms) => {
    engineState.decayMs = Math.max(20, Number(ms) || 2500);
    Max.outlet("play_decay", engineState.decayMs);
    broadcastSSE({ decayMs: engineState.decayMs });
  });

  Max.addHandler("set_maxlen", (ms) => {
    engineState.maxLenMs = Math.max(50, Number(ms) || 5000);
    broadcastSSE({ maxLenMs: engineState.maxLenMs });
  });

  Max.addHandler("set_tone", (tone) => {
    engineState.toneFilter = Number(tone) || 0;
    broadcastSSE({ toneFilter: engineState.toneFilter });
  });

  Max.addHandler("set_autoload", (flag) => {
    engineState.autoLoad = Number(flag) !== 0;
    broadcastSSE({ autoLoad: engineState.autoLoad });
  });

  Max.addHandler("target_status", (name) => {
    engineState.targetName = String(name || "Auto (Simpler / Pad)");
    broadcastSSE({ targetName: engineState.targetName });
  });
}

// Auto-boot when running inside Max node.codebox
if (hasRealMaxApi) {
  startHttpServer((port) => {
    if (Max && typeof Max.outlet === "function") {
      Max.outlet("server_url", `http://127.0.0.1:${port}`);
    }
  });
  const core = findDefaultCoreDrumsDir();
  if (core) {
    setTimeout(() => performScan([core]), 150);
  }
}

module.exports = {
  parseWavBuffer,
  parseAiffBuffer,
  parseAudioBuffer,
  extractAudioFeatures,
  classifySample,
  computeKNN,
  compute2DMap,
  analyzeAudioFile,
  scanDirectories,
  handleAction,
  startHttpServer,
  engineState,
  CATEGORY_LIST
};
