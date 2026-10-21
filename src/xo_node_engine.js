/**
 * XO Sample Map — Node for Max Engine (src/xo_node_engine.js)
 *
 * Responsibilities:
 *  1. Fast recursive audio directory scanner (.wav, .aif, .aiff, .flac, .mp3, .caf, .m4a)
 *  2. Zero-dependency WAV & AIFF/AIFC PCM/Float parser (8/16/24/32-bit, extensible, JUNK/LIST chunks)
 *  3. 12-Dimensional acoustic feature extractor & Hybrid Auto-Categorizer (10 XO drum categories)
 *  4. 2D XO Constellation Embedding & 12D k-Nearest-Neighbors (k-NN) similarity graph
 *  5. Filter-aware similarity stepping & random selection (Category, MaxLen [50ms..Inf], Tone, Search)
 *  6. Saved Samples List with per-sample playback settings (Pitch, Decay/Trim, Gain), Reorder & Delete
 *  7. Offline Audio Re-Renderer (renderEditedSampleWav) baking Pitch, Trim/Decay & Gain into WAV files
 *  8. Native macOS Cocoa NSDraggingSource OS File Drag Helper + Raw/Edited OS file links
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFile, execFileSync } = require("child_process");

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

const CACHE_DIR = process.env.XO_CACHE_DIR || os.homedir();
const CACHE_FILE = path.join(CACHE_DIR, ".xo_sample_map_cache_v2.json");
const CACHE_BIN_FILE = path.join(CACHE_DIR, ".xo_sample_map_cache_v4.bin");
const CACHE_IDX_FILE = path.join(CACHE_DIR, ".xo_sample_map_cache_v4.idx.json");
const RECORD_BYTE_SIZE = 104; // 12*4B vector (48B) + 8*4B scalars (32B) + 24*1B uint8 peaks (24B) = 104 bytes/sample
const MAX_DISPLAY_SAMPLES = 1500;
const MAX_FILES_PER_FOLDER = 50000;
const EXPORT_BASE_DIR = path.join(os.tmpdir(), "xo_sample_map_exports");
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
  kick:   -2.35,
  tom:    -1.65,
  snare:  -0.95,
  clap:   -0.35,
  rim:     0.20,
  hihat:   0.80,
  shaker:  1.35,
  cymbal:  1.95,
  perc:    2.55,
  fx:      3.05
};

// ============================================================================
// 1. Native macOS Cocoa OS File Drag Helper (NSDraggingSource + NSPasteboard)
// ============================================================================

const OBJC_DRAG_HELPER_SOURCE = `
#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>

@interface XODragView : NSView <NSDraggingSource>
@property (nonatomic, strong) NSArray<NSString *> *filePaths;
@property (nonatomic, copy) NSString *dragMode;
@property (nonatomic, strong) NSEvent *mouseDownEvent;
@property (nonatomic, assign) BOOL didDrag;
@end

@implementation XODragView

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    return YES;
}

- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
    return NSDragOperationCopy | NSDragOperationLink | NSDragOperationGeneric;
}

- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)screenPoint operation:(NSDragOperation)operation {
    [[self window] orderOut:nil];
}

- (void)mouseDown:(NSEvent *)event {
    self.mouseDownEvent = event;
    self.didDrag = NO;
    // For dedicated drag buttons ([R], [E], [Drag Raw], [Drag Edit]), initiate drag immediately on mouseDown.
    if (![self.dragMode isEqualToString:@"selected_raw"]) {
        self.didDrag = YES;
        [self initiateOSFileDrag:event];
        return;
    }

    // For Sample Preview bar ("selected_raw"), synchronously track mouseDragged vs mouseUp in WindowServer
    // so dragging starts an OS file drag (without playback) and clicking without dragging triggers playback!
    [[self window] trackEventsMatchingMask:(NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp)
                                   timeout:4.0
                                      mode:NSEventTrackingRunLoopMode
                                   handler:^(NSEvent * _Nullable ev, BOOL * _Nonnull stop) {
        if (!ev) {
            *stop = YES;
            return;
        }
        if (ev.type == NSEventTypeLeftMouseDragged) {
            self.didDrag = YES;
            *stop = YES;
            [self initiateOSFileDrag:event];
        } else if (ev.type == NSEventTypeLeftMouseUp) {
            *stop = YES;
            [[self window] orderOut:nil];
            if (!self.didDrag) {
                fprintf(stdout, "REPLAY_CLICK\\n");
                fflush(stdout);
            }
        }
    }];
}

- (void)initiateOSFileDrag:(NSEvent *)event {
    if (!self.filePaths || self.filePaths.count == 0) return;
    NSMutableArray<NSDraggingItem *> *items = [NSMutableArray array];
    NSMutableArray<NSURL *> *urls = [NSMutableArray array];

    for (NSString *p in self.filePaths) {
        if (![[NSFileManager defaultManager] fileExistsAtPath:p]) continue;
        NSURL *u = [NSURL fileURLWithPath:p];
        if (!u) continue;
        [urls addObject:u];

        NSDraggingItem *di = [[NSDraggingItem alloc] initWithPasteboardWriter:u];
        NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:p];
        [icon setSize:NSMakeSize(32, 32)];
        [di setDraggingFrame:NSMakeRect(0, 0, 32, 32) contents:icon];
        [items addObject:di];
    }
    if (items.count == 0) return;

    NSPasteboard *pb = [NSPasteboard generalPasteboard];
    [pb clearContents];
    [pb writeObjects:urls];

    [self beginDraggingSessionWithItems:items event:event source:self];
}

- (void)drawRect:(NSRect)dirtyRect {
    // 100% visually imperceptible dark fill (alpha 0.051 > 0.05 so macOS WindowServer routes mouseDown without any visible gray box)
    [[NSColor colorWithCalibratedRed:0.06 green:0.07 blue:0.09 alpha:0.051] setFill];
    NSRectFill(self.bounds);
}
@end

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) NSPanel *dragWindow;
@property (nonatomic, strong) XODragView *dragView;
@property (nonatomic, assign) NSPoint armedPoint;
@property (nonatomic, assign) CGFloat armedRadiusSq;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSRect frame = NSMakeRect(0, 0, 44, 20);
    self.dragWindow = [[NSPanel alloc] initWithContentRect:frame
                                                 styleMask:(NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel)
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
    [self.dragWindow setOpaque:NO];
    [self.dragWindow setBackgroundColor:[NSColor clearColor]];
    [self.dragWindow setFloatingPanel:YES];
    [self.dragWindow setBecomesKeyOnlyIfNeeded:YES];
    [self.dragWindow setLevel:NSStatusWindowLevel];
    [self.dragWindow setHasShadow:NO];
    [self.dragWindow setIgnoresMouseEvents:NO];
    [self.dragWindow setAcceptsMouseMovedEvents:YES];

    self.dragView = [[XODragView alloc] initWithFrame:frame];
    [self.dragWindow setContentView:self.dragView];
    self.armedRadiusSq = 900.0;

    [NSTimer scheduledTimerWithTimeInterval:0.025 repeats:YES block:^(NSTimer * _Nonnull timer) {
        if (![self.dragWindow isVisible]) return;
        if ([NSEvent pressedMouseButtons] != 0) return;
        NSPoint cur = [NSEvent mouseLocation];
        if (!NSPointInRect(cur, [self.dragWindow frame])) {
            [self.dragWindow orderOut:nil];
        }
    }];

    dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
        char buf[65536];
        while (fgets(buf, sizeof(buf), stdin) != NULL) {
            NSString *line = [NSString stringWithUTF8String:buf];
            if (!line) continue;
            NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
            NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if (!json) continue;
            dispatch_async(dispatch_get_main_queue(), ^{
                [self handleCommand:json];
            });
        }
        exit(0);
    });
}

- (void)handleCommand:(NSDictionary *)cmd {
    NSString *action = cmd[@"cmd"];
    if ([action isEqualToString:@"disarm"]) {
        if (([NSEvent pressedMouseButtons] & 1) == 0) {
            [self.dragWindow orderOut:nil];
        }
        return;
    }
    NSArray *paths = cmd[@"paths"];
    if (!paths || paths.count == 0) return;

    NSMutableArray<NSURL *> *urls = [NSMutableArray array];
    for (NSString *p in paths) {
        if ([[NSFileManager defaultManager] fileExistsAtPath:p]) {
            [urls addObject:[NSURL fileURLWithPath:p]];
        }
    }
    if (urls.count > 0) {
        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];
        [pb writeObjects:urls];
    }

    NSPoint mouse = [NSEvent mouseLocation];
    self.armedPoint = mouse;
    CGFloat w = [cmd[@"w"] doubleValue] ?: 24.0;
    CGFloat h = [cmd[@"h"] doubleValue] ?: 18.0;
    self.dragView.filePaths = paths;
    self.dragView.dragMode = cmd[@"mode"] ?: @"raw";

    NSRect winRect = NSMakeRect(mouse.x - w * 0.5, mouse.y - h * 0.5, w, h);
    [self.dragWindow setFrame:winRect display:YES];
    [self.dragView setFrame:NSMakeRect(0, 0, w, h)];
    [self.dragView setNeedsDisplay:YES];
    [self.dragWindow orderFrontRegardless];

    NSString *stateFile = cmd[@"stateFile"];
    if (stateFile) {
        NSDictionary *st = @{
            @"visible": @([self.dragWindow isVisible]),
            @"count": @(urls.count),
            @"paths": paths
        };
        NSData *stData = [NSJSONSerialization dataWithJSONObject:st options:0 error:nil];
        [stData writeToFile:stateFile atomically:YES];
    }
}
@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
        AppDelegate *del = [[AppDelegate alloc] init];
        [app setDelegate:del];
        [app run];
    }
    return 0;
}
`;

let dragHelperProc = null;

function ensureDragHelperProcess() {
  if (!hasRealMaxApi || process.platform !== "darwin") return null;
  if (dragHelperProc && !dragHelperProc.killed) return dragHelperProc;
  try {
    try {
      execFileSync("/usr/bin/pkill", ["-f", "[x]o_drag_helper"]);
    } catch (_) {}
    fs.mkdirSync(EXPORT_BASE_DIR, { recursive: true });
    const srcPath = path.join(EXPORT_BASE_DIR, "xo_drag_helper_v6.m");
    const binPath = path.join(EXPORT_BASE_DIR, "xo_drag_helper_v6_bin");
    if (!fs.existsSync(binPath)) {
      fs.writeFileSync(srcPath, OBJC_DRAG_HELPER_SOURCE, "utf8");
      execFileSync("/usr/bin/clang", [
        "-O2", "-framework", "Cocoa", "-framework", "ApplicationServices", srcPath, "-o", binPath
      ]);
    }
    dragHelperProc = spawn(binPath, [], { stdio: ["pipe", "pipe", "ignore"] });
    if (dragHelperProc.stdout) {
      let stdoutBuf = "";
      dragHelperProc.stdout.on("data", (chunk) => {
        stdoutBuf += chunk.toString("utf8");
        const lines = stdoutBuf.split("\n");
        stdoutBuf = lines.pop() || "";
        for (const line of lines) {
          if (line.includes("REPLAY_CLICK") || line.includes("replay_click")) {
            if (engineState.selectedIndex >= 0) {
              emitSelectedToMax(engineState.selectedIndex, true);
            }
          }
        }
      });
    }
    dragHelperProc.on("exit", () => { dragHelperProc = null; });
    process.on("exit", () => {
      if (dragHelperProc && !dragHelperProc.killed) {
        try { dragHelperProc.kill("SIGTERM"); } catch (_) {}
      }
    });
    return dragHelperProc;
  } catch (_) {
    return null;
  }
}

function sendDragHelperCommand(payload) {
  const proc = ensureDragHelperProcess();
  if (proc && proc.stdin && !proc.stdin.destroyed) {
    try {
      proc.stdin.write(JSON.stringify(payload) + "\n");
    } catch (_) {}
  }
}

// ============================================================================
// 2. Binary WAV & AIFF/AIFC Audio Parser
// ============================================================================

function readIEEE80Extended(buf, offset) {
  if (offset + 10 > buf.length) return 44100;
  const expon = ((buf[offset] & 0x7f) << 8) | buf[offset + 1];
  const hiMant = buf.readUInt32BE(offset + 2);
  const loMant = buf.readUInt32BE(offset + 6);
  if (expon === 0 && hiMant === 0 && loMant === 0) return 0;
  const sign = (buf[offset] & 0x80) ? -1 : 1;
  const f = hiMant * Math.pow(2, expon - 16383 - 31) + loMant * Math.pow(2, expon - 16383 - 63);
  return sign * f;
}

function parseWavBuffer(buf, fullFileSize, maxSeconds = 2.0, peakChannels = false) {
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
  const fileDataRoom = Math.max(0, (fullFileSize || buf.length) - dataOffset);
  // data size 0 / 0xFFFFFFFF (streamed) or larger than the file: use what the file really holds
  const totalFileDataBytes = dataSize > 0 ? Math.min(dataSize, fileDataRoom) : fileDataRoom;
  const totalFrames = Math.floor(totalFileDataBytes / frameStep);
  const availBytes = Math.min(buf.length - dataOffset, totalFileDataBytes);
  const availFrames = Math.floor(availBytes / frameStep);
  if (availFrames <= 0) return null;

  const maxDecodeFrames = Math.min(availFrames, Math.floor(sampleRate * maxSeconds));
  const mono = new Float32Array(maxDecodeFrames);

  const readSampleAt = (fPos) => {
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
    return Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
  };

  for (let i = 0; i < maxDecodeFrames; i++) {
    const fPos = dataOffset + i * frameStep;
    if (fPos + bytesPerSample > buf.length) break;
    let v = readSampleAt(fPos);
    if (peakChannels) {
      // Waveform display: keep the channel sample with the largest magnitude
      for (let c = 1; c < channels && fPos + (c + 1) * bytesPerSample <= buf.length; c++) {
        const o = readSampleAt(fPos + c * bytesPerSample);
        if (Math.abs(o) > Math.abs(v)) v = o;
      }
    }
    mono[i] = v;
  }

  return {
    sampleRate,
    channels,
    totalFrames,
    durationMs: (totalFrames / sampleRate) * 1000.0,
    samples: mono
  };
}

function parseAiffBuffer(buf, fullFileSize, maxSeconds = 2.0, peakChannels = false) {
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

  const maxDecodeFrames = Math.min(availFrames, Math.floor(sampleRate * maxSeconds));
  const mono = new Float32Array(maxDecodeFrames);

  const readSampleAt = (fPos) => {
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
    return Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
  };

  for (let i = 0; i < maxDecodeFrames; i++) {
    const fPos = ssndOffset + i * frameStep;
    if (fPos + bytesPerSample > buf.length) break;
    let v = readSampleAt(fPos);
    if (peakChannels) {
      for (let c = 1; c < channels && fPos + (c + 1) * bytesPerSample <= buf.length; c++) {
        const o = readSampleAt(fPos + c * bytesPerSample);
        if (Math.abs(o) > Math.abs(v)) v = o;
      }
    }
    mono[i] = v;
  }

  return {
    sampleRate,
    channels,
    totalFrames,
    durationMs: (totalFrames / sampleRate) * 1000.0,
    samples: mono
  };
}

function parseAudioBuffer(buf, fullFileSize, maxSeconds = 2.0, peakChannels = false) {
  if (!buf || buf.length < 44) return null;
  const magic = buf.toString("ascii", 0, 4);
  if (magic === "RIFF") return parseWavBuffer(buf, fullFileSize, maxSeconds, peakChannels);
  if (magic === "FORM") return parseAiffBuffer(buf, fullFileSize, maxSeconds, peakChannels);
  return null;
}

// ----------------------------------------------------------------------------
// Detailed waveform for the mini-map banner (selected_wave)
// ----------------------------------------------------------------------------

const WAVEFORM_COLUMNS = 256;
const WAVEFORM_CACHE_MAX = 24;
const WAVEFORM_MAX_FILE_BYTES = 96 * 1024 * 1024;
const WAVEFORM_MAX_SECONDS = 180;
const waveformCache = new Map(); // path -> { size, mtimeMs, data } (insertion order = LRU order)

/**
 * Per-column min / max / RMS over the whole signal (linear amplitude, 3 decimals).
 * Columns are contiguous and cover every sample exactly once.
 */
function extractWaveformColumns(samples, columns = WAVEFORM_COLUMNS) {
  const n = samples ? samples.length : 0;
  if (n <= 0) return null;
  const cols = Math.max(1, Math.min(columns, n));
  const min = new Array(cols);
  const max = new Array(cols);
  const rms = new Array(cols);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  for (let c = 0; c < cols; c++) {
    const a = Math.floor((c * n) / cols);
    const b = Math.max(a + 1, Math.floor(((c + 1) * n) / cols));
    let lo = Infinity;
    let hi = -Infinity;
    let sq = 0;
    for (let i = a; i < b; i++) {
      const v = samples[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sq += v * v;
    }
    min[c] = r3(lo);
    max[c] = r3(hi);
    rms[c] = r3(Math.sqrt(sq / (b - a)));
  }
  return { columns: cols, min, max, rms };
}

function computeWaveformFromBuffer(buf, columns = WAVEFORM_COLUMNS) {
  const decoded = parseAudioBuffer(buf, buf.length, WAVEFORM_MAX_SECONDS, true);
  if (!decoded || !decoded.samples || decoded.samples.length === 0) return null;
  return extractWaveformColumns(decoded.samples, columns);
}

/** Cached (small LRU, keyed by path and invalidated by size / mtime). Returns null when the file cannot be decoded. */
function getWaveformSync(filePath) {
  try {
    const st = fs.statSync(filePath);
    const hit = waveformCache.get(filePath);
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) {
      waveformCache.delete(filePath);
      waveformCache.set(filePath, hit);
      return hit.data;
    }
    let data = null;
    if (st.size > 44 && st.size <= WAVEFORM_MAX_FILE_BYTES) {
      data = computeWaveformFromBuffer(fs.readFileSync(filePath));
    }
    waveformCache.set(filePath, { size: st.size, mtimeMs: st.mtimeMs, data });
    while (waveformCache.size > WAVEFORM_CACHE_MAX) {
      waveformCache.delete(waveformCache.keys().next().value);
    }
    return data;
  } catch (_) {
    return null;
  }
}

/** Outlet message: selected_wave <idx> <n> <min0> <max0> <rms0> ... ; n = 0 when the file could not be decoded. */
function buildSelectedWaveMessage(idx, data) {
  if (!data) return ["selected_wave", idx, 0];
  const flat = [];
  for (let i = 0; i < data.columns; i++) flat.push(data.min[i], data.max[i], data.rms[i]);
  return ["selected_wave", idx, data.columns, ...flat];
}

let waveJobId = 0;
function requestSelectedWaveform(idx, filePath) {
  if (!Max || typeof Max.outlet !== "function" || !filePath) return;
  const job = ++waveJobId;
  setImmediate(() => {
    if (job !== waveJobId) return; // a newer selection superseded this one
    Max.outlet(...buildSelectedWaveMessage(idx, getWaveformSync(filePath)));
  });
}

// ============================================================================
// 3. Offline Audio Re-Renderer & OS File Link Generator
// ============================================================================

function encodeStereoWav16(samplesMono, sampleRate) {
  // Writes a 2-channel stereo 16-bit PCM WAV file so dragged samples always play in both channels
  const numFrames = samplesMono.length;
  const channels = 2;
  const dataBytes = numFrames * channels * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, 4, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, 4, "ascii");
  buf.write("fmt ", 12, 4, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, 4, "ascii");
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < numFrames; i++) {
    const clamped = Math.max(-1.0, Math.min(1.0, samplesMono[i]));
    const s16 = Math.max(-32768, Math.min(32767, Math.round(clamped * 32767)));
    const off = 44 + i * 4;
    buf.writeInt16LE(s16, off);     // Left
    buf.writeInt16LE(s16, off + 2); // Right
  }
  return buf;
}

// ----------------------------------------------------------------------------
// Stretch engines (src/xo_stretch.js). In the device, scripts/build_xo_map.py wraps that file in a function and
// prepends it as XO_STRETCH_EMBEDDED, so no require is needed inside the node.codebox; under plain Node (tests) it is required.
// ----------------------------------------------------------------------------
/** @type {XoStretchApi} */
const XS = (typeof XO_STRETCH_EMBEDDED !== "undefined" && XO_STRETCH_EMBEDDED) ? XO_STRETCH_EMBEDDED : /** @type {any} */ (require("./xo_stretch.js"));

// Mode dial index -> engine name (the one table; the Mode dial and saved items use these indices).
const STRETCH_MODES = ["granular", "complex", "texture"];
const DEFAULT_STRETCH_MODE = 1;
const STRETCH_MODE_TEXTURE = 2;
// Names from older builds that stored the mode as text: the removed Signalsmith engine loads as Complex.
const LEGACY_STRETCH_NAMES = { signalsmith: 1, smith: 1 };

/** @param {any} v mode index (0..2) or name */
function stretchModeIndex(v) {
  if (typeof v === "string" && Number.isNaN(Number(v))) {
    const name = v.toLowerCase();
    if (LEGACY_STRETCH_NAMES[name] !== undefined) return LEGACY_STRETCH_NAMES[name];
    const i = STRETCH_MODES.indexOf(name);
    return i >= 0 ? i : DEFAULT_STRETCH_MODE;
  }
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(STRETCH_MODES.length - 1, n)) : DEFAULT_STRETCH_MODE;
}

/** Mode of a settings / saved item. Old items carried spectralPct instead: any spectral blend maps to Granular. */
function resolveStretchMode(settings) {
  if (!settings) return DEFAULT_STRETCH_MODE;
  if (settings.stretchMode !== undefined) return stretchModeIndex(settings.stretchMode);
  if (Number(settings.spectralPct) > 0) return 0;
  return DEFAULT_STRETCH_MODE;
}

/**
 * Render-needed rule. Pitch and Speed are independent (Ableton Complex behaviour): an offline render is needed
 * whenever Speed != 100 %, Pitch != 0 or the mode is Texture. Only Speed 100 % + Pitch 0 (non-Texture) is played
 * as-is by sfplay~ (speed 1.0); sfplay~ never repitches a rendered file.
 * @param {number} mode
 * @param {number} speedPct
 * @param {number} [pitchSt]
 */
function stretchEngineWanted(mode, speedPct, pitchSt) {
  return mode === STRETCH_MODE_TEXTURE
    || Math.abs((Number(speedPct) || 100) - 100) >= 0.5
    || Math.abs(Number(pitchSt) || 0) >= 0.005;
}

/** Grain 5..250 ms doubles as Texture's window-size amount 0..1. */
function grainToTextureAmount(grainMs) {
  return Math.max(0, Math.min(1, ((Number(grainMs) || 45) - 5) / 245));
}

const lastRenderInfo = { engine: "", note: "" };

function renderEditedAudioSamples(decoded, settings = {}) {
  const pitchSt = Number(settings.pitchSt) || 0;
  const decayMs = Math.max(20, Number(settings.decayMs) || 2500);
  const gainDb = Number(settings.gainDb) || 0;
  const isReversed = !!(settings.reverse && Number(settings.reverse) !== 0);
  const speedPct = settings.speedPct !== undefined ? Math.max(10, Math.min(400, Number(settings.speedPct) || 100)) : 100;
  const grainMs = settings.grainMs !== undefined ? Math.max(5, Math.min(250, Number(settings.grainMs) || 45)) : 45;
  const mode = resolveStretchMode(settings);
  const useEngine = stretchEngineWanted(mode, speedPct, pitchSt);

  // Speed alone sets the duration (out length = in length / Speed); Pitch never changes it.
  const speedRatio = useEngine ? Math.max(0.1, Math.min(4, speedPct / 100.0)) : 1.0;
  const linGain = Math.pow(10.0, gainDb / 20.0);
  const sr = decoded.sampleRate || 44100;
  const rawSrc = decoded.samples;
  const srcLen = rawSrc.length;
  let src = rawSrc;
  if (isReversed) {
    src = new Float32Array(srcLen);
    for (let i = 0; i < srcLen; i++) {
      src[i] = rawSrc[srcLen - 1 - i];
    }
  }

  const effectiveScanRate = speedRatio;
  const stretchedFullFrames = useEngine
    ? Math.max(16, Math.round(srcLen / effectiveScanRate))
    : srcLen;
  const maxDecayFrames = Math.max(16, Math.floor((decayMs / 1000.0) * sr));
  const isTrimmed = maxDecayFrames < stretchedFullFrames;
  const outFrames = Math.min(stretchedFullFrames, maxDecayFrames, sr * 20);
  const out = new Float32Array(outFrames);

  // In Forward mode, Trim/Dec keeps the start (0..outFrames) and fades out the tail.
  // In Reverse mode, Trim/Dec trims from the start (keeping the last outFrames leading up to the reversed peak)
  // and applies a rising sweep fade-in at the start!
  const revSkipOutFrames = isReversed ? Math.max(0, stretchedFullFrames - outFrames) : 0;

  const holdFrames = (!isReversed && isTrimmed) ? Math.floor(outFrames * 0.72) : outFrames;
  const rampSpan = Math.max(1, outFrames - holdFrames);
  const revSweepFrames = (isReversed && isTrimmed) ? Math.max(1, Math.floor(outFrames * 0.68)) : 0;

  function computeEnvelope(i) {
    if (isReversed) {
      if (revSweepFrames > 0 && i < revSweepFrames) {
        const norm = i / revSweepFrames;
        return norm * norm; // Quadratic rising sweep into the reversed transient peak
      }
      return 1.0;
    }
    if (isTrimmed && i > holdFrames) {
      return Math.max(0.0, 1.0 - (i - holdFrames) / rampSpan);
    }
    return 1.0;
  }

  let engine = "repitch";
  let note = "";
  if (!useEngine) {
    const revSkipSrcFrames = revSkipOutFrames * effectiveScanRate;
    for (let i = 0; i < outFrames; i++) {
      const srcPos = revSkipSrcFrames + i;
      const idx0 = Math.floor(srcPos);
      const frac = srcPos - idx0;
      const s0 = (idx0 >= 0 && idx0 < srcLen) ? src[idx0] : 0;
      const s1 = (idx0 + 1 >= 0 && idx0 + 1 < srcLen) ? src[idx0 + 1] : s0;
      const interp = s0 + frac * (s1 - s0);
      const env = computeEnvelope(i);
      out[i] = Math.max(-1.0, Math.min(1.0, interp * env * linGain));
    }
  } else {
    // Forward renders only need the part of the source that can reach the (trimmed) output.
    let feed = src;
    if (!isReversed) {
      const needSrc = Math.ceil(outFrames * effectiveScanRate) + 16384;
      if (needSrc < srcLen) feed = src.subarray(0, needSrc);
    }
    const res = XS.stretchAudioEx([feed], sr, {
      mode: STRETCH_MODES[mode],
      speed: effectiveScanRate,
      pitchSt,
      grainMs,
      amount: grainToTextureAmount(grainMs)
    });
    const stretched = res.channels[0];
    engine = res.engine;
    note = res.note || "";
    for (let i = 0; i < outFrames; i++) {
      const j = revSkipOutFrames + i;
      const v = j < stretched.length ? stretched[j] : 0;
      out[i] = Math.max(-1.0, Math.min(1.0, v * computeEnvelope(i) * linGain));
    }
  }
  lastRenderInfo.engine = engine;
  lastRenderInfo.note = note;

  return {
    sampleRate: sr,
    samples: out,
    durationMs: Math.round((outFrames / sr) * 1000.0),
    engine,
    note
  };
}

function createRawFileLink(rawFilePath) {
  if (!rawFilePath) return rawFilePath;
  try {
    return path.resolve(rawFilePath);
  } catch (_) {
    return rawFilePath;
  }
}

/** Rendered-file cache keyed by source file + settings (+ out dir); entries are dropped when the file is gone. */
const renderCache = new Map();
const RENDER_CACHE_MAX = 64;
const renderStats = { renders: 0, cacheHits: 0 };

function renderCacheKey(rawFilePath, settings, outDir) {
  let mt = 0;
  try { mt = fs.statSync(rawFilePath).mtimeMs; } catch (_) {}
  const sp = settings.speedPct !== undefined ? Math.round(Number(settings.speedPct) * 10) / 10 : 100;
  return [
    rawFilePath, mt, outDir,
    Math.round((Number(settings.pitchSt) || 0) * 1000) / 1000,
    Math.round(Number(settings.decayMs) || 2500),
    Math.round((Number(settings.gainDb) || 0) * 100) / 100,
    (settings.reverse && Number(settings.reverse) !== 0) ? 1 : 0,
    sp, Math.round(Number(settings.grainMs) || 45), resolveStretchMode(settings)
  ].join("|");
}

/** Renders (or fetches from the cache) the edited WAV. Returns { path, durationMs, engine, note, cached } or null. */
function renderEditedSampleWavEx(rawFilePath, settings = {}, customOutDir = null) {
  if (!rawFilePath || !fs.existsSync(rawFilePath)) return null;
  const outDir = customOutDir || path.join(EXPORT_BASE_DIR, "Edited");
  const key = renderCacheKey(rawFilePath, settings, outDir);
  const hit = renderCache.get(key);
  if (hit && fs.existsSync(hit.path)) {
    renderStats.cacheHits++;
    lastRenderInfo.engine = hit.engine;
    lastRenderInfo.note = hit.note;
    return Object.assign({}, hit, { cached: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const rawBuf = fs.readFileSync(rawFilePath);
  const decoded = parseAudioBuffer(rawBuf, rawBuf.length, 25.0);
  if (!decoded) return null;

  const rendered = renderEditedAudioSamples(decoded, settings);
  renderStats.renders++;
  const wavBuf = encodeStereoWav16(rendered.samples, rendered.sampleRate);

  const base = path.basename(rawFilePath, path.extname(rawFilePath)).replace(/[^a-zA-Z0-9_-]/g, "_");
  const pTag = (Number(settings.pitchSt) || 0) >= 0 ? `+${Number(settings.pitchSt) || 0}` : `${Number(settings.pitchSt) || 0}`;
  const dTag = Math.round(Number(settings.decayMs) || 2500);
  const gTag = Math.round((Number(settings.gainDb) || 0) * 10) / 10;
  const rTag = (settings.reverse && Number(settings.reverse) !== 0) ? "_rev" : "";
  const mode = resolveStretchMode(settings);
  const spPct = settings.speedPct !== undefined ? Math.round(Number(settings.speedPct)) : 100;
  const engaged = stretchEngineWanted(mode, spPct, Number(settings.pitchSt) || 0);
  const spTag = spPct !== 100 ? `_sp${spPct}` : "";
  const mdTag = engaged ? `_${["gr", "cx", "tx"][mode]}` : "";
  const grTag = (engaged && (mode === 0 || mode === STRETCH_MODE_TEXTURE)) ? `_gr${Math.round(Number(settings.grainMs) || 45)}` : "";
  const outName = `${base}_p${pTag}st_d${dTag}ms_g${gTag}dB${rTag}${spTag}${mdTag}${grTag}.wav`;
  const outPath = path.join(outDir, outName);

  fs.writeFileSync(outPath, wavBuf);
  const info = { path: outPath, durationMs: rendered.durationMs, engine: rendered.engine, note: rendered.note || "", frames: rendered.samples.length, sampleRate: rendered.sampleRate };
  if (renderCache.size >= RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value);
  renderCache.set(key, info);
  return Object.assign({}, info, { cached: false });
}

function renderEditedSampleWav(rawFilePath, settings = {}, customOutDir = null) {
  const r = renderEditedSampleWavEx(rawFilePath, settings, customOutDir);
  return r ? r.path : null;
}

// Dial drags (Pitch, Speed, Grain, Mode, Trim/Dec, Reverse) fire many set_* messages. Renders are synchronous, so
// instead of rendering per message the latest setting is pre-rendered once the dial has been quiet for
// RENDER_DEBOUNCE_MS (earlier requests are superseded); the next audition then hits the cache.
const renderDebounce = { ms: 150, timer: null, requested: 0, executed: 0, superseded: 0, generation: 0 };

function currentRenderSettings() {
  return {
    pitchSt: engineState.pitchSt || 0,
    speedPct: engineState.speedPct || 100,
    grainMs: engineState.grainMs || 45,
    stretchMode: resolveStretchMode(engineState),
    decayMs: engineState.decayMs || 2500,
    gainDb: 0,
    reverse: engineState.reverse ? 1 : 0
  };
}

function requestRenderPrewarm() {
  renderDebounce.requested++;
  renderDebounce.generation++;
  if (renderDebounce.timer) {
    clearTimeout(renderDebounce.timer);
    renderDebounce.superseded++;
  }
  const gen = renderDebounce.generation;
  renderDebounce.timer = setTimeout(() => {
    renderDebounce.timer = null;
    if (gen !== renderDebounce.generation) return;
    const s = engineState.samples[engineState.selectedIndex];
    const st = currentRenderSettings();
    if (!s || !s.path || !(st.reverse || stretchEngineWanted(resolveStretchMode(st), st.speedPct, st.pitchSt))) return;
    try {
      renderEditedSampleWavEx(s.path, st, path.join(EXPORT_BASE_DIR, "PreviewGranular"));
      renderDebounce.executed++;
    } catch (_) {}
  }, renderDebounce.ms);
  if (renderDebounce.timer && typeof renderDebounce.timer.unref === "function") renderDebounce.timer.unref();
}

function renderReversedPreviewWav(rawFilePath) {
  if (!rawFilePath || !fs.existsSync(rawFilePath)) return rawFilePath;
  try {
    const revDir = path.join(EXPORT_BASE_DIR, "PreviewRev");
    fs.mkdirSync(revDir, { recursive: true });
    const base = path.basename(rawFilePath, path.extname(rawFilePath)).replace(/[^a-zA-Z0-9_-]/g, "_");
    const outPath = path.join(revDir, `${base}_rev_preview.wav`);
    const rawBuf = fs.readFileSync(rawFilePath);
    const decoded = parseAudioBuffer(rawBuf, rawBuf.length, 15.0);
    if (!decoded) return rawFilePath;
    const N = decoded.samples.length;
    const revMono = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      revMono[i] = decoded.samples[N - 1 - i];
    }
    const wavBuf = encodeStereoWav16(revMono, decoded.sampleRate || 44100);
    fs.writeFileSync(outPath, wavBuf);
    return outPath;
  } catch (_) {
    return rawFilePath;
  }
}

// ============================================================================
// 4. 12-Dimensional Acoustic Feature Extractor
// ============================================================================

function extractAudioFeatures(decoded) {
  const { sampleRate, durationMs: rawDurationMs, samples } = decoded;
  const N = samples.length;
  if (N < 32) return null;

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
  // activeMs (silence-trimmed, capped by the 2 s decode window) feeds the feature vector and the category
  // heuristics; durationMs is the true file length from the header (frames / sample rate).
  const activeMs = rawDurationMs > 2000 ? rawDurationMs : Math.max(15, trimmedMs);
  const durationMs = rawDurationMs > 0 ? rawDurationMs : activeMs;
  const logDuration = Math.max(0, Math.min(1, (Math.log10(Math.max(15, activeMs)) - 1.17) / 2.55));

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

  const specWin = Math.min(1024, activeLen);
  const freqs = [
    40, 55, 75, 100,
    135, 180, 240, 320,
    450, 650, 950, 1350,
    1900, 2600, 3500, 4800,
    6400, 8500, 11000, 14000
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

  const pitchWin = Math.min(2048, activeLen);
  const minLag = Math.max(4, Math.floor(sampleRate / 1200));
  const maxLag = Math.min(Math.floor(pitchWin * 0.65), Math.floor(sampleRate / 35));
  let bestLag = 0;
  let bestCorr = 0;

  let passedZeroDip = false;
  for (let lag = minLag; lag <= maxLag; lag += 2) {
    let corr = 0;
    let e0 = 1e-9;
    let e1 = 1e-9;
    const limit = pitchWin - lag;
    for (let i = 0; i < limit; i += 2) {
      const a = samples[onsetIdx + i] * normScale;
      const b = samples[onsetIdx + i + lag] * normScale;
      corr += a * b;
      e0 += a * a;
      e1 += b * b;
    }
    const normCorr = corr / Math.sqrt(e0 * e1);
    if (normCorr < 0) passedZeroDip = true;
    if (passedZeroDip && normCorr > bestCorr) {
      bestCorr = normCorr;
      bestLag = lag;
    }
  }

  const pitchHz = bestLag > 0 && bestCorr > 0.25 ? Math.round((sampleRate / bestLag) * 10) / 10 : 0;
  const pitchMidi = pitchHz > 20 ? Math.round(69 + 12 * Math.log2(pitchHz / 440.0)) : 48;
  const normPitch = Math.max(0, Math.min(1, (pitchMidi - 24) / 60));

  return {
    durationMs: Math.round(durationMs),
    activeMs: Math.round(activeMs),
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
// 5. Auto-Categorizer, 2D Map & k-NN
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

  if (!features) return "perc";
  if (features.subRatio + features.lowRatio > 0.58 && features.centroid < 0.34 && features.zcr < 0.18) {
    return features.pitchHz > 95 ? "tom" : "kick";
  }
  if ((features.highRatio > 0.28 || features.centroid > 0.50) && features.zcr > 0.35) {
    if ((features.activeMs || features.durationMs) > 420) return "cymbal";
    if (features.attackMs > 18) return "shaker";
    return "hihat";
  }
  if (features.midRatio + features.highRatio > 0.55 && features.flatness > 0.42) {
    return features.attackMs > 10 ? "clap" : "snare";
  }
  if ((features.activeMs || features.durationMs) < 95 && features.midRatio > 0.38) {
    return "rim";
  }
  return "perc";
}

function computeKNN(samples, k = 8) {
  const N = samples.length;
  if (N === 0) return;
  const actualK = Math.min(k, Math.max(0, N - 1));
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
      if (samples[j].category !== cati) d2 += 0.35;
      dists.push({ idx: j, d2 });
    }
    dists.sort((a, b) => a.d2 - b.d2);
    samples[i].neighbors = dists.slice(0, actualK).map((x) => x.idx);
  }
}

function compute2DMap(samples, seed = 1) {
  const N = samples.length;
  if (N === 0) return;

  const seedJitter = ((Number(seed) || 1) - 1) * 0.61803398875;
  const pts = new Array(N);
  for (let i = 0; i < N; i++) {
    const s = samples[i];
    const baseAngle = CATEGORY_ANGLES[s.category] !== undefined ? CATEGORY_ANGLES[s.category] : 0;
    const v = s.vector || [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25, 0.25, 0.5, 0.5];
    const jitter = seed > 1 ? Math.sin((i + 1) * 12.9898 + seedJitter * 78.233) * 0.14 : 0;
    const angleOffset = ((v[0] - 0.45) * 0.55) + ((v[5] - 0.3) * 0.35) + ((v[10] - 0.5) * 0.25) + jitter;
    const angle = baseAngle + angleOffset;
    const radialBase = 0.20 + 0.58 * (0.45 * v[2] + 0.30 * v[0] + 0.25 * (1.0 - v[6]));
    const r = Math.max(0.08, Math.min(0.88, radialBase));

    pts[i] = {
      x: 0.5 + Math.cos(angle) * r * 0.48,
      y: 0.5 + Math.sin(angle) * r * 0.48
    };
  }

  const iterations = 36;
  const minDist = Math.max(0.011, Math.min(0.032, 0.48 / Math.sqrt(N)));
  const minDistSq = minDist * minDist;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 0.18 * (1.0 - iter / iterations);
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
// 6. Binary Cache Manager (104-byte fixed binary records) & Background Scanner
// ============================================================================

function mulberry32(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function packSampleBinaryRecord(item) {
  const buf = Buffer.alloc(RECORD_BYTE_SIZE);
  const vec = item.vector || [];
  for (let i = 0; i < 12; i++) {
    buf.writeFloatLE(Number(vec[i]) || 0, i * 4);
  }
  const catIdx = Math.max(0, CATEGORY_LIST.indexOf(item.category || "kick"));
  buf.writeFloatLE(Number(item.durationMs) || 0, 48);
  buf.writeFloatLE(Number(item.attackMs) || 0, 52);
  buf.writeFloatLE(Number(item.pitchHz) || 0, 56);
  buf.writeFloatLE(Number(item.pitchMidi) || 48, 60);
  buf.writeFloatLE(Number(item.channels) || 1, 64);
  buf.writeFloatLE(catIdx, 68);
  buf.writeFloatLE(item.favorite ? 1 : 0, 72);
  buf.writeFloatLE(0, 76);

  const peaks = item.peaks || [];
  for (let i = 0; i < 24; i++) {
    const p = Math.max(0, Math.min(1, Number(peaks[i]) || 0));
    buf.writeUInt8(Math.round(p * 255), 80 + i);
  }
  return buf;
}

function unpackSampleBinaryRecord(buf, offset, filePath, rootFolder = "") {
  if (!buf || offset + RECORD_BYTE_SIZE > buf.length) return null;
  const vector = new Array(12);
  for (let i = 0; i < 12; i++) {
    vector[i] = buf.readFloatLE(offset + i * 4);
  }
  const durationMs = Math.round(buf.readFloatLE(offset + 48));
  const attackMs = Math.round(buf.readFloatLE(offset + 52) * 10) / 10;
  const pitchHz = Math.round(buf.readFloatLE(offset + 56) * 10) / 10;
  const pitchMidi = Math.round(buf.readFloatLE(offset + 60));
  const channels = Math.max(1, Math.round(buf.readFloatLE(offset + 64)));
  const catIdx = Math.max(0, Math.min(CATEGORY_LIST.length - 1, Math.round(buf.readFloatLE(offset + 68))));
  const favorite = buf.readFloatLE(offset + 72) > 0.5;

  const peaks = new Array(24);
  for (let i = 0; i < 24; i++) {
    peaks[i] = Math.round((buf.readUInt8(offset + 80 + i) / 255.0) * 1000) / 1000;
  }

  return {
    name: path.basename(filePath, path.extname(filePath)),
    path: filePath,
    folder: path.basename(path.dirname(filePath)),
    rootFolder: rootFolder || path.dirname(filePath),
    category: CATEGORY_LIST[catIdx] || "kick",
    channels,
    durationMs,
    attackMs,
    centroid: Math.round(vector[0] * 1000) / 1000,
    flatness: Math.round(vector[1] * 1000) / 1000,
    zcr: vector[5],
    subRatio: vector[6],
    lowRatio: vector[7],
    midRatio: vector[8],
    highRatio: vector[9],
    pitchHz,
    pitchMidi,
    peaks,
    vector,
    favorite,
    x: 0.5,
    y: 0.5,
    neighbors: []
  };
}

function loadDiskCache() {
  const cache = {
    version: 3,
    entries: {},
    favorites: {},
    knownFolders: [],
    records: {},
    binChunks: [],
    nextRecordIndex: 0
  };
  try {
    if (fs.existsSync(CACHE_IDX_FILE) && fs.existsSync(CACHE_BIN_FILE)) {
      const idxData = JSON.parse(fs.readFileSync(CACHE_IDX_FILE, "utf8"));
      const binBuf = fs.readFileSync(CACHE_BIN_FILE);
      cache.favorites = idxData.favorites || {};
      cache.knownFolders = Array.isArray(idxData.knownFolders) ? idxData.knownFolders : [];
      cache.records = idxData.records || {};
      cache.binChunks = [binBuf];
      cache.nextRecordIndex = Math.floor(binBuf.length / RECORD_BYTE_SIZE);
      return cache;
    }
  } catch (_) {}
  return cache;
}

function saveDiskCache(cache) {
  if (!cache) return;
  try {
    const fullBin = cache.binChunks && cache.binChunks.length > 0
      ? Buffer.concat(cache.binChunks)
      : Buffer.alloc(0);
    cache.binChunks = [fullBin];
    fs.writeFileSync(CACHE_BIN_FILE, fullBin);
    const idxPayload = {
      version: 3,
      favorites: cache.favorites || {},
      knownFolders: cache.knownFolders || [],
      records: cache.records || {}
    };
    fs.writeFileSync(CACHE_IDX_FILE, JSON.stringify(idxPayload), "utf8");
  } catch (_) {}
}

function collectAudioFilesRecursive(dirPath, maxFiles = MAX_FILES_PER_FOLDER, out = []) {
  if (out.length >= maxFiles) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return out;
  }
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

function analyzeAudioFile(filePath, cache, rootFolder = "") {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (_) {
    return null;
  }
  const cacheKey = `${filePath}|${st.size}|${Math.floor(st.mtimeMs)}`;

  if (cache) {
    if (cache.entries && cache.entries[cacheKey] && cache.entries[cacheKey].channels) {
      const cached = { ...cache.entries[cacheKey], rootFolder: rootFolder || cache.entries[cacheKey].rootFolder || path.dirname(filePath) };
      cached.favorite = !!(cache.favorites && cache.favorites[filePath]);
      return cached;
    }
    if (cache.records && cache.records[cacheKey] !== undefined && cache.binChunks && cache.binChunks.length > 0) {
      const recIdx = cache.records[cacheKey];
      const mainBuf = cache.binChunks[0];
      const byteOff = recIdx * RECORD_BYTE_SIZE;
      if (byteOff + RECORD_BYTE_SIZE <= mainBuf.length) {
        const unpacked = unpackSampleBinaryRecord(mainBuf, byteOff, filePath, rootFolder);
        if (unpacked) {
          unpacked.favorite = !!(cache.favorites && cache.favorites[filePath]);
          if (cache.entries) cache.entries[cacheKey] = unpacked;
          return unpacked;
        }
      }
    }
  }

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
    rootFolder: rootFolder || path.dirname(filePath),
    category,
    channels: decoded.channels || 1,
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

  if (cache) {
    if (cache.entries) cache.entries[cacheKey] = item;
    if (cache.records && cache.binChunks) {
      const recBuf = packSampleBinaryRecord(item);
      const recIdx = cache.nextRecordIndex || 0;
      cache.records[cacheKey] = recIdx;
      cache.binChunks.push(recBuf);
      cache.nextRecordIndex = recIdx + 1;
    }
  }
  return item;
}

function selectSeededMapSubset(corpusSamples, maxDisplay = MAX_DISPLAY_SAMPLES, seed = 1) {
  if (!Array.isArray(corpusSamples) || corpusSamples.length === 0) return [];
  if (corpusSamples.length <= maxDisplay) {
    return corpusSamples.map((s) => ({ ...s }));
  }
  const rng = mulberry32(seed);
  // Stratified reservoir/shuffle across categories so all drum types stay balanced
  const byCat = new Map();
  for (let i = 0; i < corpusSamples.length; i++) {
    const s = corpusSamples[i];
    const cat = s.category || "perc";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  // Fisher-Yates shuffle each category bucket using seeded PRNG
  for (const arr of byCat.values()) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }
  // Round-robin pick across categories up to maxDisplay
  const selected = [];
  const cats = Array.from(byCat.keys());
  let depth = 0;
  while (selected.length < maxDisplay) {
    let addedInPass = false;
    for (let c = 0; c < cats.length && selected.length < maxDisplay; c++) {
      const arr = byCat.get(cats[c]);
      if (depth < arr.length) {
        selected.push({ ...arr[depth] });
        addedInPass = true;
      }
    }
    if (!addedInPass) break;
    depth++;
  }
  return selected;
}

function scanDirectories(dirs, maxFiles = MAX_FILES_PER_FOLDER, seed = 1, maxDisplay = MAX_DISPLAY_SAMPLES) {
  const cache = loadDiskCache();
  const fileEntries = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {}
    const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    const dirFiles = [];
    if (subdirs.length >= 4) {
      const perSub = Math.max(25, Math.floor(maxFiles / subdirs.length));
      for (const sd of subdirs) {
        collectAudioFilesRecursive(path.join(d, sd.name), dirFiles.length + perSub, dirFiles);
      }
    } else {
      collectAudioFilesRecursive(d, maxFiles, dirFiles);
    }
    for (const f of dirFiles) {
      fileEntries.push({ filePath: f, rootFolder: d });
    }
  }

  const corpusSamples = [];
  const folderSet = new Set();
  for (const fe of fileEntries) {
    const item = analyzeAudioFile(fe.filePath, cache, fe.rootFolder);
    if (item) {
      corpusSamples.push(item);
      folderSet.add(item.folder);
    }
  }

  const samples = selectSeededMapSubset(corpusSamples, maxDisplay, seed);
  computeKNN(samples, 8);
  compute2DMap(samples, seed);
  saveDiskCache(cache);

  return {
    samples,
    corpusSamples,
    folders: Array.from(folderSet).sort()
  };
}

// ============================================================================
// 7. Runtime State, Filter Evaluation (50ms..Infinite), Saved List & Drag-Out
// ============================================================================

const engineState = {
  scannedDirs: [],
  knownFolders: [], // [{ path, name, enabled, count }] — automatically includes Ableton Core Drums & remembers added folders
  corpusSamples: [],
  samples: [],
  folders: [],
  sampleSeed: 1,
  maxDisplaySamples: MAX_DISPLAY_SAMPLES,
  selectedIndex: -1,
  anchorIndex: -1,
  activeCategory: "ALL",
  maxLenMs: 5000, // >= 4990 or Infinity = Infinite (no max length cutoff)
  toneFilter: 0,
  tonalFilter: 0,
  drumFilter: 0,
  searchQuery: "",
  pitchSt: 0,
  speedPct: 100,
  grainMs: 45,
  stretchMode: DEFAULT_STRETCH_MODE,
  decayMs: 2500,
  gainDb: 0,
  reverse: 0,
  showSaved: 1,
  showFilters: 1,
  showPlayback: 1,
  savedList: [],
  lastDragOut: null,
  statusText: "Initializing..."
};

let nextSavedId = 1;
let activeScanJobId = 0;
let acousticSimTourCache = [];
let acousticSimTourKey = "";
function isInfiniteMaxLen(val) {
  if (val === "inf" || val === "infinite" || val === "Infinity" || val === Infinity) return true;
  const n = Number(val);
  return !Number.isFinite(n) || n >= 4990;
}

function isSampleFolderEnabled(s, st = engineState) {
  if (!s) return false;
  if (!Array.isArray(st.knownFolders) || st.knownFolders.length === 0) return true;
  const rf = s.rootFolder || "";
  const sp = s.path || "";
  for (let i = 0; i < st.knownFolders.length; i++) {
    const kf = st.knownFolders[i];
    if (!kf || !kf.path) continue;
    if (rf === kf.path || sp.startsWith(kf.path + path.sep) || sp === kf.path) {
      return !!kf.enabled;
    }
  }
  return true;
}

function computeSampleDruminessPct(s) {
  if (!s) return 50.0;
  if (s.druminess !== undefined) return Number(s.druminess);
  const v = s.vector || [];
  const durMs = Number(s.durationMs) || 300;
  const logDur = v[2] !== undefined ? Number(v[2]) : Math.max(0, Math.min(1, (Math.log10(Math.max(10, durMs)) - 1.0) / 3.0));
  const logAtk = v[3] !== undefined ? Number(v[3]) : Math.max(0, Math.min(1, Math.log10(1 + (Number(s.attackMs) || 5)) / 2.4));
  const decRat = v[4] !== undefined ? Number(v[4]) : 0.35;
  const crest = v[11] !== undefined ? Number(v[11]) : 0.55;

  const fastAttack = 1.0 - Math.max(0.0, Math.min(1.0, logAtk));
  const fastDecay = 1.0 - Math.max(0.0, Math.min(1.0, decRat));
  const shortDur = 1.0 - Math.max(0.0, Math.min(1.0, logDur));
  const punchCrest = Math.max(0.0, Math.min(1.0, crest));

  // Long samples (> 900ms) scale down toward the Pad / Sustained Cluster side
  const lengthScale = durMs > 900 ? Math.max(0.20, 1.0 - (durMs - 900) / 3000.0) : 1.0;
  const score = (0.30 * fastAttack + 0.26 * fastDecay + 0.28 * shortDur + 0.16 * punchCrest) * lengthScale;
  return Math.max(0.0, Math.min(100.0, score * 100.0));
}

function isSamplePassingFilters(s, st = engineState) {
  if (!s) return false;
  if (!isSampleFolderEnabled(s, st)) return false;
  if (st.activeCategory && st.activeCategory !== "ALL" && s.category !== st.activeCategory) {
    return false;
  }
  if (!isInfiniteMaxLen(st.maxLenMs) && s.durationMs > Number(st.maxLenMs)) {
    return false;
  }
  const centroidPct = (s.centroid !== undefined ? s.centroid : 0.5) * 100.0;
  if (st.toneFilter < 0) {
    const maxB = 100.0 + st.toneFilter * 0.85;
    if (centroidPct > maxB) return false;
  } else if (st.toneFilter > 0) {
    const minB = st.toneFilter * 0.85;
    if (centroidPct < minB) return false;
  }
  const tonalPct = Math.max(0.0, Math.min(100.0, (1.0 - (s.flatness !== undefined ? s.flatness : 0.5)) * 100.0));
  if (st.tonalFilter < 0) {
    const maxT = 100.0 + st.tonalFilter * 0.85;
    if (tonalPct > maxT) return false;
  } else if (st.tonalFilter > 0) {
    const minT = st.tonalFilter * 0.85;
    if (tonalPct < minT) return false;
  }
  const drumPct = computeSampleDruminessPct(s);
  const df = Number(st.drumFilter) || 0;
  if (df < 0) {
    const maxD = 100.0 + df * 0.85;
    if (drumPct > maxD) return false;
  } else if (df > 0) {
    const minD = df * 0.85;
    if (drumPct < minD) return false;
  }
  if (st.searchQuery && st.searchQuery.trim().length > 0) {
    const clauses = st.searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (clauses.length > 0) {
      const haystack = String(s.name || "")
        .toLowerCase()
        .replace(/[_\-./\\]+/g, " ");
      for (let i = 0; i < clauses.length; i++) {
        if (!haystack.includes(clauses[i])) return false;
      }
    }
  }
  return true;
}

function syncFolderListToMax() {
  if (!Max || typeof Max.outlet !== "function") return;
  const flat = [];
  for (let i = 0; i < engineState.knownFolders.length; i++) {
    const kf = engineState.knownFolders[i];
    const flags = (kf.enabled ? 1 : 0) | (kf.scanning ? 2 : 0);
    flat.push(
      flags,
      Number(kf.count) || 0,
      String(kf.name || "Folder"),
      String(kf.path || "")
    );
  }
  Max.outlet("folder_list_sync", engineState.knownFolders.length, ...flat);
}

function ensureKnownFoldersInitialized(forceReload = false) {
  if (!forceReload && Array.isArray(engineState.knownFolders) && engineState.knownFolders.length > 0) {
    return engineState.knownFolders;
  }
  const cache = loadDiskCache();
  const mapByPath = new Map();
  const coreDir = findDefaultCoreDrumsDir() || CORE_DRUM_PATHS[0];

  // Always include Ableton Core Drums first
  mapByPath.set(coreDir, {
    path: coreDir,
    name: "Ableton Core Drums",
    enabled: true,
    count: 0
  });

  // Restore previously added folders from persistent cache
  if (Array.isArray(cache.knownFolders)) {
    for (const f of cache.knownFolders) {
      if (f && f.path) {
        const normPath = path.resolve(String(f.path).replace(/^\/+/, "/"));
        if (normPath === coreDir || fs.existsSync(normPath)) {
          const existing = mapByPath.get(normPath);
          mapByPath.set(normPath, {
            path: normPath,
            name: normPath === coreDir ? "Ableton Core Drums" : (f.name || path.basename(normPath)),
            enabled: f.enabled !== undefined ? !!f.enabled : true,
            count: Number(f.count) || (existing ? existing.count : 0)
          });
        }
      }
    }
  }

  engineState.knownFolders = Array.from(mapByPath.values());
  return engineState.knownFolders;
}

function persistKnownFoldersToCache() {
  const cache = loadDiskCache();
  cache.knownFolders = engineState.knownFolders.map((f) => ({
    path: f.path,
    name: f.name,
    enabled: !!f.enabled,
    count: Number(f.count) || 0
  }));
  saveDiskCache(cache);
}

function rebuildActiveMapSubset(seed = engineState.sampleSeed, applyActiveFilters = false) {
  engineState.sampleSeed = Number(seed) || 1;
  acousticSimTourKey = "";
  const candidateCorpus = applyActiveFilters
    ? engineState.corpusSamples.filter((s) => isSamplePassingFilters(s, engineState))
    : engineState.corpusSamples.filter((s) => isSampleFolderEnabled(s, engineState));
  const maxDisp = Math.max(1, Number(engineState.maxDisplaySamples) || MAX_DISPLAY_SAMPLES);
  const subset = selectSeededMapSubset(candidateCorpus, maxDisp, engineState.sampleSeed);
  computeKNN(subset, 8);
  compute2DMap(subset, engineState.sampleSeed);
  engineState.samples = subset;
  if (engineState.selectedIndex < 0 || engineState.selectedIndex >= subset.length) {
    engineState.selectedIndex = subset.length > 0 ? 0 : -1;
  }
  engineState.statusText = `${subset.length} / ${candidateCorpus.length} samples mapped (Seed #${engineState.sampleSeed})`;
  syncFolderListToMax();
  syncMiniMapToMax();
  return subset;
}

function reseedMapSubset(applyActiveFilters = false) {
  engineState.sampleSeed = ((engineState.sampleSeed || 1) + 1) >>> 0;
  return rebuildActiveMapSubset(engineState.sampleSeed, applyActiveFilters);
}

function reseedWithActiveFilters() {
  return reseedMapSubset(true);
}

function addRememberedFolder(folderPath, runAsync = false, onDone = null) {
  if (!folderPath || typeof folderPath !== "string") return null;
  let clean = path.resolve(folderPath.replace(/^[^/]+:\/*/, "/"));
  if (!fs.existsSync(clean) && fs.existsSync(folderPath)) clean = path.resolve(folderPath);
  if (!fs.existsSync(clean)) return null;
  const stat = fs.statSync(clean);
  const dir = stat.isDirectory() ? clean : path.dirname(clean);

  ensureKnownFoldersInitialized();
  const coreDir = findDefaultCoreDrumsDir() || CORE_DRUM_PATHS[0];
  let entry = engineState.knownFolders.find((f) => f.path === dir);
  if (!entry) {
    entry = {
      path: dir,
      name: dir === coreDir ? "Ableton Core Drums" : path.basename(dir),
      enabled: true,
      count: 0
    };
    engineState.knownFolders.push(entry);
  } else {
    entry.enabled = true;
  }
  persistKnownFoldersToCache();
  syncFolderListToMax();

  const allDirs = engineState.knownFolders.map((f) => f.path).filter((p) => fs.existsSync(p));
  if (runAsync) {
    startBackgroundScan(allDirs, onDone);
  } else {
    performScan(allDirs);
    if (onDone) onDone(engineState.samples);
  }
  return entry;
}

function toggleFolderFilter(folderPath, enabledOpt = undefined) {
  ensureKnownFoldersInitialized();
  let target = engineState.knownFolders.find((f) => f.path === folderPath || f.name === folderPath);
  if (!target && Number.isFinite(Number(folderPath))) {
    target = engineState.knownFolders[Number(folderPath)];
  }
  if (!target) return engineState.knownFolders;
  target.enabled = enabledOpt !== undefined ? !!Number(enabledOpt) : !target.enabled;
  persistKnownFoldersToCache();
  rebuildActiveMapSubset(engineState.sampleSeed);
  return engineState.knownFolders;
}

function enableAllFolderFilters() {
  ensureKnownFoldersInitialized();
  for (let i = 0; i < engineState.knownFolders.length; i++) {
    engineState.knownFolders[i].enabled = true;
  }
  persistKnownFoldersToCache();
  rebuildActiveMapSubset(engineState.sampleSeed);
  return engineState.knownFolders;
}

function removeRememberedFolder(folderPath) {
  let targetIdx = engineState.knownFolders.findIndex((f) => f.path === folderPath || f.name === folderPath);
  if (targetIdx < 0 && Number.isFinite(Number(folderPath))) {
    const n = Number(folderPath);
    if (n >= 0 && n < engineState.knownFolders.length) targetIdx = n;
  }
  if (targetIdx < 0) return engineState.knownFolders;

  const removed = engineState.knownFolders.splice(targetIdx, 1)[0];
  const rmPath = removed ? removed.path : "";
  if (rmPath) {
    engineState.scannedDirs = engineState.scannedDirs.filter((d) => d !== rmPath);
    engineState.corpusSamples = engineState.corpusSamples.filter((s) => {
      const rf = s.rootFolder || "";
      const sp = s.path || "";
      return !(rf === rmPath || sp.startsWith(rmPath + path.sep) || sp === rmPath);
    });
    // Remove folder and its indexed sample records from persistent disk cache
    const cache = loadDiskCache();
    cache.knownFolders = engineState.knownFolders.map((f) => ({
      path: f.path,
      name: f.name,
      enabled: !!f.enabled,
      count: Number(f.count) || 0
    }));
    if (cache.records) {
      for (const k of Object.keys(cache.records)) {
        if (k.startsWith(rmPath + path.sep) || k.startsWith(rmPath + "|")) {
          delete cache.records[k];
        }
      }
    }
    saveDiskCache(cache);
  }

  rebuildActiveMapSubset(engineState.sampleSeed);
  return engineState.knownFolders;
}

function buildAcousticSimilarityTour(startIdx) {
  const vis = [];
  for (let i = 0; i < engineState.samples.length; i++) {
    if (isSamplePassingFilters(engineState.samples[i])) vis.push(i);
  }
  if (vis.length === 0) return [];
  const enabledFolderKey = engineState.knownFolders.map((f) => `${f.path}:${f.enabled ? 1 : 0}`).join(",");
  const key = `${vis.length}|${engineState.activeCategory}|${engineState.maxLenMs}|${engineState.toneFilter}|${engineState.pitchFilter}|${engineState.tonalFilter}|${engineState.searchQuery}|${engineState.sampleSeed}|${enabledFolderKey}`;
  if (acousticSimTourKey === key && acousticSimTourCache.length === vis.length && acousticSimTourCache.includes(startIdx)) {
    return acousticSimTourCache;
  }

  const weights = [2.2, 1.4, 1.8, 1.2, 1.2, 1.6, 2.0, 1.6, 1.5, 1.8, 1.0, 0.8];
  const remaining = new Set(vis);
  const start = remaining.has(startIdx) ? startIdx : vis[0];
  const tour = [start];
  remaining.delete(start);

  let cur = start;
  while (remaining.size > 0) {
    const cs = engineState.samples[cur];
    const vi = (cs && cs.vector) || [];
    let bestIdx = -1;
    let bestD2 = Infinity;
    for (const cand of remaining) {
      const qs = engineState.samples[cand];
      const vj = (qs && qs.vector) || [];
      let d2 = 0;
      for (let d = 0; d < weights.length; d++) {
        const diff = (vi[d] || 0) - (vj[d] || 0);
        d2 += weights[d] * diff * diff;
      }
      if (qs.category !== cs.category) d2 += 0.35;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = cand;
      }
    }
    if (bestIdx < 0) break;
    tour.push(bestIdx);
    remaining.delete(bestIdx);
    cur = bestIdx;
  }

  acousticSimTourKey = key;
  acousticSimTourCache = tour;
  return tour;
}

function stepSimilarSample(dir = 1) {
  if (engineState.samples.length === 0) return -1;
  const curIdx = engineState.selectedIndex >= 0 ? engineState.selectedIndex : 0;
  const anchor = (engineState.anchorIndex >= 0 && engineState.anchorIndex < engineState.samples.length)
    ? engineState.anchorIndex
    : curIdx;
  const tour = buildAcousticSimilarityTour(anchor);
  if (tour.length === 0) return -1;
  let pos = tour.indexOf(curIdx);
  if (pos < 0) pos = 0;
  const step = Number(dir) < 0 ? -1 : 1;
  const nextPos = (pos + step + tour.length) % tour.length;
  const nextIdx = tour[nextPos];
  emitSelectedToMax(nextIdx, true);
  return nextIdx;
}

function syncMiniMapToMax() {
  if (!Max || typeof Max.outlet !== "function") return;
  Max.outlet("minimap_clear");
  const batchSize = 35;
  for (let i = 0; i < engineState.samples.length; i += batchSize) {
    const slice = engineState.samples.slice(i, i + batchSize);
    const flat = [];
    for (let j = 0; j < slice.length; j++) {
      const s = slice[j];
      const catIdx = Math.max(0, CATEGORY_LIST.indexOf(s.category));
      const drumPct = Math.round(computeSampleDruminessPct(s));
      const tonalPct = Math.round(Math.max(0, Math.min(100, (1.0 - (s.flatness !== undefined ? s.flatness : 0.5)) * 100)));
      flat.push(
        Math.round(s.x * 1000) / 1000,
        Math.round(s.y * 1000) / 1000,
        catIdx,
        Math.round(s.durationMs),
        Math.round((s.centroid || 0.5) * 100),
        drumPct,
        tonalPct,
        String(s.name || "Sample")
      );
    }
    Max.outlet("minimap_batch", i, ...flat);
  }
  Max.outlet("minimap_done", engineState.samples.length, engineState.statusText);
  syncSavedListToMax();
  if (engineState.selectedIndex >= 0) {
    emitSelectedToMax(engineState.selectedIndex, false, { record: false });
  }
}

function syncSavedListToMax() {
  if (!Max || typeof Max.outlet !== "function") return;
  const flat = [];
  for (let i = 0; i < engineState.savedList.length; i++) {
    const item = engineState.savedList[i];
    flat.push(
      item.id,
      item.sampleIndex,
      item.name,
      item.catIdx,
      item.pitchSt,
      item.decayMs,
      item.gainDb,
      item.reverse ? 1 : 0,
      item.speedPct !== undefined ? item.speedPct : 100,
      item.grainMs !== undefined ? item.grainMs : 45,
      resolveStretchMode(item)
    );
  }
  Max.outlet("saved_list_sync", engineState.savedList.length, ...flat);
}

// ----------------------------------------------------------------------------
// Selection history (browser-style Back / Forward, arrow keys Down / Up)
// Entries are file paths (sample indices change on re-seed / filter changes).
// ----------------------------------------------------------------------------

const SELECTION_HISTORY_MAX = 200;
const selectionHistory = { entries: [], pos: -1 };

/** Record a selection that is not a history navigation: truncate the forward part, skip a duplicate of the current entry. */
function recordSelectionHistory(samplePath) {
  if (!samplePath) return false;
  const h = selectionHistory;
  if (h.pos >= 0 && h.entries[h.pos] === samplePath) return false;
  h.entries.length = h.pos + 1;
  h.entries.push(samplePath);
  if (h.entries.length > SELECTION_HISTORY_MAX) {
    h.entries.splice(0, h.entries.length - SELECTION_HISTORY_MAX);
  }
  h.pos = h.entries.length - 1;
  return true;
}

function clearSelectionHistory() {
  selectionHistory.entries = [];
  selectionHistory.pos = -1;
}

/**
 * Move through the history (dir -1 = back / older, +1 = forward / newer) and audition the sound.
 * Entries that are no longer in the current map are skipped. Returns the new sample index or -1.
 */
function stepSelectionHistory(dir) {
  const h = selectionHistory;
  const step = Number(dir) < 0 ? -1 : 1;
  for (let p = h.pos + step; p >= 0 && p < h.entries.length; p += step) {
    const idx = engineState.samples.findIndex((smp) => smp.path === h.entries[p]);
    if (idx < 0) continue;
    h.pos = p;
    engineState.anchorIndex = idx;
    acousticSimTourKey = "";
    emitSelectedToMax(idx, true, { record: false });
    return idx;
  }
  return -1;
}

function emitSelectedToMax(idx, audition = true, opts = null) {
  if (idx < 0 || idx >= engineState.samples.length) return;
  engineState.selectedIndex = idx;
  const s = engineState.samples[idx];
  if (!opts || opts.record !== false) recordSelectionHistory(s.path);
  const catIdx = Math.max(0, CATEGORY_LIST.indexOf(s.category));
  const useOfflineGranular = stretchEngineWanted(resolveStretchMode(engineState), engineState.speedPct, engineState.pitchSt);
  // Duration depends on Speed only; Pitch never changes it.
  const stretchRatio = useOfflineGranular ? Math.max(0.1, Math.min(4, (Number(engineState.speedPct) || 100) / 100.0)) : 1.0;
  let naturalScaledMs = Math.max(20, Math.round((s.durationMs || 300) / stretchRatio));
  const decaySettingMs = Math.max(20, Number(engineState.decayMs) || 2500);
  let isTrimmed = decaySettingMs < 19950 && decaySettingMs < naturalScaledMs;
  let effDurMs = isTrimmed ? decaySettingMs : naturalScaledMs;

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
    requestSelectedWaveform(idx, s.path);

    if (audition) {
      const isRev = !!(engineState.reverse && Number(engineState.reverse) !== 0);
      let playPath = s.path;
      const sfPlaySpeed = 1.0; // sfplay~ never repitches: pitch lives in the rendered file
      let rendersDuration = 0;
      let renderInfo = null;
      let chMode = (s.channels && s.channels >= 2) ? 2 : 1;

      if ((useOfflineGranular || isRev) && s.path && fs.existsSync(s.path)) {
        const previewDir = path.join(EXPORT_BASE_DIR, "PreviewGranular");
        const rr = renderEditedSampleWavEx(s.path, Object.assign(currentRenderSettings(), { reverse: isRev ? 1 : 0 }), previewDir);
        if (rr) {
          playPath = rr.path;
          renderInfo = rr;
          rendersDuration = rr.durationMs; // Pitch, stretch, trim & reverse sweep already baked into the WAV
          chMode = 2;
        }
      }

      if (rendersDuration > 0) {
        effDurMs = rendersDuration;
        isTrimmed = false;
      }

      Max.outlet("play_mono", chMode);
      Max.outlet("play_speed", sfPlaySpeed);
      Max.outlet("play_scan_dur", effDurMs);

      if (isTrimmed && !isRev && !rendersDuration) {
        const holdMs = Math.max(10, Math.round(effDurMs * 0.72));
        const fadeMs = Math.max(10, effDurMs - holdMs);
        Max.outlet("play_env", 1.0, 0, 1.0, holdMs, 0.0, fadeMs);
      } else {
        // Untouched unity gain throughout effective duration
        Max.outlet("play_env", 1.0, 0, 1.0, effDurMs + 500);
      }
      Max.outlet("play_file", playPath);
      // For the HUD / tests: what is playing (file, length in ms and frames, whether it was rendered, engine used)
      Max.outlet(
        "audition_info",
        playPath,
        effDurMs,
        renderInfo ? renderInfo.frames : 0,
        renderInfo ? 1 : 0,
        renderInfo ? renderInfo.engine : "plain",
        engineState.pitchSt || 0,
        engineState.speedPct || 100,
        resolveStretchMode(engineState)
      );
    }
  }

}

function saveSampleToList(sampleIdx = engineState.selectedIndex, customSettings = null) {
  const effIdx = (sampleIdx !== undefined && sampleIdx >= 0) ? Number(sampleIdx) : Math.max(0, engineState.selectedIndex);
  const s = engineState.samples[effIdx] || {
    name: (customSettings && customSettings.name) ? String(customSettings.name) : `Sample_${effIdx}`,
    category: CATEGORY_LIST[(customSettings && customSettings.catIdx) || 0] || "kick",
    durationMs: 320,
    path: ensureFallbackWavFile((customSettings && customSettings.name) || `Sample_${effIdx}`)
  };
  const catIdx = Math.max(0, CATEGORY_LIST.indexOf(s.category));
  const pitchSt = customSettings && customSettings.pitchSt !== undefined ? Number(customSettings.pitchSt) : engineState.pitchSt;
  const decayMs = customSettings && customSettings.decayMs !== undefined ? Number(customSettings.decayMs) : engineState.decayMs;
  const gainDb = customSettings && customSettings.gainDb !== undefined ? Number(customSettings.gainDb) : engineState.gainDb;
  const reverse = customSettings && customSettings.reverse !== undefined ? (Number(customSettings.reverse) ? 1 : 0) : (engineState.reverse ? 1 : 0);
  const speedPct = customSettings && customSettings.speedPct !== undefined ? Number(customSettings.speedPct) : (engineState.speedPct || 100);
  const grainMs = customSettings && customSettings.grainMs !== undefined ? Number(customSettings.grainMs) : (engineState.grainMs || 45);
  const stretchMode = customSettings && customSettings.stretchMode !== undefined ? stretchModeIndex(customSettings.stretchMode) : resolveStretchMode(engineState);

  const rawLinkPath = createRawFileLink(s.path);
  let editedPath = rawLinkPath;
  try {
    const rendered = renderEditedSampleWav(s.path, { pitchSt, decayMs, gainDb, reverse, speedPct, grainMs, stretchMode });
    if (rendered) editedPath = rendered;
  } catch (_) {}

  const entry = {
    id: nextSavedId++,
    sampleIndex: effIdx,
    name: s.name,
    category: s.category,
    catIdx,
    durationMs: s.durationMs,
    pitchSt,
    decayMs,
    gainDb,
    reverse,
    speedPct,
    grainMs,
    stretchMode,
    rawPath: rawLinkPath,
    sourcePath: s.path,
    editedPath
  };

  engineState.savedList.push(entry);
  syncSavedListToMax();
  return entry;
}

function recallSavedSample(savedIdx, audition = true) {
  if (savedIdx < 0 || savedIdx >= engineState.savedList.length) return null;
  const item = engineState.savedList[savedIdx];
  engineState.pitchSt = item.pitchSt;
  engineState.decayMs = item.decayMs;
  engineState.gainDb = item.gainDb;
  engineState.reverse = item.reverse ? 1 : 0;
  engineState.speedPct = item.speedPct !== undefined ? item.speedPct : 100;
  engineState.grainMs = item.grainMs !== undefined ? item.grainMs : 45;
  engineState.stretchMode = resolveStretchMode(item);

  if (Max && typeof Max.outlet === "function") {
    Max.outlet(
      "sync_playback_dials",
      item.pitchSt,
      item.decayMs,
      item.gainDb,
      engineState.reverse,
      engineState.speedPct,
      engineState.grainMs,
      engineState.stretchMode
    );
  }
  emitSelectedToMax(item.sampleIndex, audition);
  return item;
}

function reorderSavedSample(fromIdx, toIdx) {
  const len = engineState.savedList.length;
  if (fromIdx < 0 || fromIdx >= len || toIdx < 0 || toIdx >= len || fromIdx === toIdx) {
    return engineState.savedList;
  }
  const [moved] = engineState.savedList.splice(fromIdx, 1);
  engineState.savedList.splice(toIdx, 0, moved);
  syncSavedListToMax();
  return engineState.savedList;
}

function removeSavedSample(savedIdx) {
  if (savedIdx < 0 || savedIdx >= engineState.savedList.length) return;
  engineState.savedList.splice(savedIdx, 1);
  syncSavedListToMax();
}

function clearSavedSamples() {
  engineState.savedList = [];
  syncSavedListToMax();
}

function ensureFallbackWavFile(labelName = "Sample", freqHz = 60, durationSec = 0.35) {
  const rawDir = path.join(EXPORT_BASE_DIR, "Raw");
  fs.mkdirSync(rawDir, { recursive: true });
  const safe = String(labelName || "Sample").replace(/[^a-zA-Z0-9_-]/g, "_");
  const outPath = path.join(rawDir, `${safe}.wav`);
  try {
    const st = fs.lstatSync(outPath);
    if (st.isSymbolicLink()) {
      fs.unlinkSync(outPath);
    } else if (st.isFile() && st.size > 44) {
      return outPath;
    }
  } catch (_) {}

  const sr = 44100;
  const frames = Math.floor(durationSec * sr);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 10);
    mono[i] = Math.sin(2 * Math.PI * freqHz * (t + 0.04 * Math.exp(-t * 35))) * env * 0.9;
  }
  const wavBuf = encodeStereoWav16(mono, sr);
  fs.writeFileSync(outPath, wavBuf);
  return outPath;
}

function resolveDragOutPaths(mode, savedIdx = -1, triggerNativeOverlay = true, handoff = false) {
  const isEdited = mode === "edited" || mode === "all_edited";
  const isAll = mode === "all_raw" || mode === "all_edited";
  const isSelectedPreviewRaw = mode === "selected_raw";

  let items = [];
  if (isSelectedPreviewRaw) {
    const sampleIdx = (savedIdx >= 0 && savedIdx < engineState.samples.length)
      ? savedIdx
      : (engineState.selectedIndex >= 0 ? engineState.selectedIndex : 0);
    const cur = engineState.samples[sampleIdx];
    const srcPath = (cur && cur.path && fs.existsSync(cur.path))
      ? cur.path
      : ensureFallbackWavFile((cur && cur.name) || "Selected_Sample", 62, 0.35);
    const rawLink = createRawFileLink(srcPath);
    items = [{
      name: (cur && cur.name) || "Selected Sample",
      rawPath: rawLink,
      sourcePath: srcPath,
      editedPath: rawLink,
      pitchSt: 0,
      decayMs: (cur && cur.durationMs) || 350,
      gainDb: 0
    }];
  } else if (isAll) {
    items = engineState.savedList;
  } else if (savedIdx >= 0 && savedIdx < engineState.savedList.length) {
    items = [engineState.savedList[savedIdx]];
  } else if (engineState.selectedIndex >= 0 && engineState.samples[engineState.selectedIndex]) {
    const cur = engineState.samples[engineState.selectedIndex];
    const settings = {
      pitchSt: engineState.pitchSt,
      decayMs: engineState.decayMs,
      gainDb: engineState.gainDb,
      reverse: engineState.reverse ? 1 : 0,
      speedPct: engineState.speedPct || 100,
      grainMs: engineState.grainMs || 45,
      stretchMode: resolveStretchMode(engineState)
    };
    const rawLink = createRawFileLink(cur.path);
    const ed = isEdited ? (renderEditedSampleWav(cur.path, settings) || rawLink) : rawLink;
    items = [{
      name: cur.name,
      rawPath: rawLink,
      sourcePath: cur.path,
      editedPath: ed,
      pitchSt: settings.pitchSt,
      decayMs: settings.decayMs,
      gainDb: settings.gainDb,
      reverse: settings.reverse,
      speedPct: settings.speedPct,
      grainMs: settings.grainMs,
      stretchMode: settings.stretchMode
    }];
  } else if (engineState.savedList.length > 0) {
    items = [engineState.savedList[0]];
  }

  // Fallback for batch/row drag when savedList is empty (never mutates engineState.savedList)
  if (items.length === 0) {
    const fbKick = ensureFallbackWavFile("Kick_Atmos", 58, 0.32);
    items = [{
      name: "Kick Atmos",
      rawPath: fbKick,
      sourcePath: fbKick,
      editedPath: isEdited ? (renderEditedSampleWav(fbKick, { pitchSt: 0, decayMs: 320, gainDb: 0 }) || fbKick) : fbKick,
      pitchSt: 0,
      decayMs: 320,
      gainDb: 0
    }];
  }

  const paths = [];
  for (const item of items) {
    const srcFile = (item.sourcePath && fs.existsSync(item.sourcePath))
      ? item.sourcePath
      : ((item.rawPath && fs.existsSync(item.rawPath)) ? item.rawPath : ensureFallbackWavFile(item.name || "Sample"));
    if (isEdited) {
      if (!item.editedPath || item.editedPath === item.rawPath || !fs.existsSync(item.editedPath)) {
        const rendered = renderEditedSampleWav(srcFile, {
          pitchSt: item.pitchSt,
          decayMs: item.decayMs,
          gainDb: item.gainDb,
          reverse: item.reverse ? 1 : 0,
          speedPct: item.speedPct !== undefined ? item.speedPct : 100,
          grainMs: item.grainMs !== undefined ? item.grainMs : 45,
          stretchMode: resolveStretchMode(item)
        });
        if (rendered) item.editedPath = rendered;
      }
      paths.push(item.editedPath || srcFile);
    } else {
      if (!item.rawPath || !fs.existsSync(item.rawPath)) {
        item.rawPath = createRawFileLink(srcFile);
      }
      paths.push(item.rawPath || srcFile);
    }
  }

  const dragResult = {
    mode,
    savedIdx,
    count: paths.length,
    paths
  };
  engineState.lastDragOut = dragResult;

  if (triggerNativeOverlay && paths.length > 0) {
    const label = isAll
      ? `⤓ Drag ${isEdited ? "Edit" : "Raw"} (${paths.length})`
      : `⤓ ${isEdited ? "E" : "R"}`;
    sendDragHelperCommand({
      cmd: "arm",
      mode,
      paths,
      label,
      isEdited,
      visible: true,
      handoff: !!handoff,
      stateFile: path.join(EXPORT_BASE_DIR, "last_drag_helper_state.json"),
      w: 16,
      h: 16
    });
  }

  if (Max && typeof Max.outlet === "function" && paths.length > 0) {
    Max.outlet("drag_out_paths", mode, ...paths);
  }
  return dragResult;
}

function armHoverDragZone(mode, savedIdx = -1) {
  if (!mode || mode === "none") {
    sendDragHelperCommand({ cmd: "disarm" });
    return;
  }
  const res = resolveDragOutPaths(mode, savedIdx, false, false);
  if (res.paths.length > 0) {
    const isEdited = mode === "edited" || mode === "all_edited";
    const isAll = mode === "all_raw" || mode === "all_edited";
    sendDragHelperCommand({
      cmd: "arm",
      mode,
      paths: res.paths,
      label: isAll ? (isEdited ? "Drag Edit" : "Drag Raw") : (isEdited ? "E" : "R"),
      isEdited,
      visible: true,
      handoff: false,
      stateFile: path.join(EXPORT_BASE_DIR, "last_drag_helper_state.json"),
      w: 16,
      h: 16
    });
  }
}

function findDefaultCoreDrumsDir() {
  for (const p of CORE_DRUM_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function updateKnownFolderCounts() {
  ensureKnownFoldersInitialized();
  for (const kf of engineState.knownFolders) {
    kf.count = 0;
    kf.scanning = false;
  }
  for (const s of engineState.corpusSamples) {
    const rf = s.rootFolder || "";
    const sp = s.path || "";
    for (const kf of engineState.knownFolders) {
      if (rf === kf.path || sp.startsWith(kf.path + path.sep) || sp === kf.path) {
        kf.count++;
        break;
      }
    }
  }
  persistKnownFoldersToCache();
}

function startBackgroundScan(dirs, onComplete = null, maxFilesPerFolder = MAX_FILES_PER_FOLDER) {
  ensureKnownFoldersInitialized();
  const validDirs = Array.from(new Set(dirs.filter((d) => d && fs.existsSync(d))));
  if (validDirs.length === 0) {
    engineState.statusText = "No sample folder found — click + Folder";
    syncFolderListToMax();
    if (onComplete) onComplete([]);
    return;
  }

  const coreDir = findDefaultCoreDrumsDir() || CORE_DRUM_PATHS[0];
  for (const d of validDirs) {
    let kf = engineState.knownFolders.find((f) => f.path === d);
    if (!kf) {
      kf = {
        path: d,
        name: d === coreDir ? "Ableton Core Drums" : path.basename(d),
        enabled: true,
        count: 0,
        scanning: true
      };
      engineState.knownFolders.push(kf);
    } else {
      kf.scanning = true;
      kf.count = 0;
    }
  }

  const jobId = ++activeScanJobId;
  engineState.scannedDirs = validDirs;
  engineState.statusText = "Scanning folders in background...";
  syncFolderListToMax();

  const cache = loadDiskCache();
  const fileEntries = [];
  for (const d of validDirs) {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {}
    const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
    const dirFiles = [];
    if (subdirs.length >= 4) {
      const perSub = Math.max(40, Math.floor(maxFilesPerFolder / subdirs.length));
      for (const sd of subdirs) {
        collectAudioFilesRecursive(path.join(d, sd.name), dirFiles.length + perSub, dirFiles);
      }
    } else {
      collectAudioFilesRecursive(d, maxFilesPerFolder, dirFiles);
    }
    for (const f of dirFiles) {
      fileEntries.push({ filePath: f, rootFolder: d });
    }
  }

  const corpusSamples = [];
  const folderSet = new Set();
  let cursor = 0;
  let chunkStep = 0;
  const CHUNK_SIZE = 48;

  function processNextChunk() {
    if (jobId !== activeScanJobId) return;
    const end = Math.min(fileEntries.length, cursor + CHUNK_SIZE);
    for (; cursor < end; cursor++) {
      const fe = fileEntries[cursor];
      const item = analyzeAudioFile(fe.filePath, cache, fe.rootFolder);
      if (item) {
        corpusSamples.push(item);
        folderSet.add(item.folder);
        const kf = engineState.knownFolders.find((f) => f.path === fe.rootFolder);
        if (kf) kf.count = (Number(kf.count) || 0) + 1;
      }
    }
    chunkStep++;

    if (cursor < fileEntries.length) {
      engineState.statusText = `Scanning in background... ${corpusSamples.length} / ${fileEntries.length}`;
      if (chunkStep % 4 === 0) {
        syncFolderListToMax();
      }
      setImmediate(processNextChunk);
      return;
    }

    engineState.corpusSamples = corpusSamples;
    engineState.folders = Array.from(folderSet).sort();
    updateKnownFolderCounts();
    saveDiskCache(cache);
    rebuildActiveMapSubset(engineState.sampleSeed);
    if (onComplete) onComplete(engineState.samples);
  }

  setImmediate(processNextChunk);
}

function performScan(dirs, maxFiles = MAX_FILES_PER_FOLDER) {
  ensureKnownFoldersInitialized();
  const validDirs = Array.from(new Set(dirs.filter((d) => d && fs.existsSync(d))));
  if (validDirs.length === 0) {
    engineState.statusText = "No sample folder found — click + Folder";
    syncFolderListToMax();
    return;
  }
  const coreDir = findDefaultCoreDrumsDir() || CORE_DRUM_PATHS[0];
  for (const d of validDirs) {
    if (!engineState.knownFolders.some((f) => f.path === d)) {
      engineState.knownFolders.push({
        path: d,
        name: d === coreDir ? "Ableton Core Drums" : path.basename(d),
        enabled: true,
        count: 0
      });
    }
  }

  engineState.scannedDirs = validDirs;
  engineState.statusText = "Scanning audio files...";

  const result = scanDirectories(validDirs, maxFiles, engineState.sampleSeed, engineState.maxDisplaySamples);
  engineState.corpusSamples = result.corpusSamples;
  engineState.folders = result.folders;
  updateKnownFolderCounts();
  rebuildActiveMapSubset(engineState.sampleSeed);
}

// ============================================================================
// 8. Max Message Handlers
// ============================================================================

if (Max && typeof Max.addHandler === "function") {
  Max.addHandler("init", () => {
    ensureDragHelperProcess();
    ensureKnownFoldersInitialized();
    syncFolderListToMax();
    if (engineState.samples.length === 0) {
      const dirs = engineState.knownFolders.map((f) => f.path).filter((p) => fs.existsSync(p));
      if (dirs.length > 0) startBackgroundScan(dirs);
    } else {
      syncMiniMapToMax();
    }
  });

  Max.addHandler("scan_core", () => {
    ensureKnownFoldersInitialized();
    const dirs = engineState.knownFolders.map((f) => f.path).filter((p) => fs.existsSync(p));
    if (dirs.length > 0) startBackgroundScan(dirs);
  });

  Max.addHandler("add_folder", (folderPath) => {
    addRememberedFolder(folderPath, true);
  });

  Max.addHandler("toggle_folder", (folderPath, enabled) => {
    toggleFolderFilter(folderPath, enabled);
  });

  Max.addHandler("remove_folder", (folderPath) => {
    removeRememberedFolder(folderPath);
  });

  Max.addHandler("enable_all_folders", () => {
    enableAllFolderFilters();
  });

  Max.addHandler("prompt_folder", () => {
    if (Max && typeof Max.outlet === "function") {
      Max.outlet("prompt_folder");
    }
  });

  Max.addHandler("reseed_map", () => {
    reseedMapSubset(false);
  });

  Max.addHandler("reseed_filtered", () => {
    reseedWithActiveFilters();
  });

  Max.addHandler("select_index", (idx, audition = 1) => {
    const nIdx = Number(idx);
    engineState.anchorIndex = nIdx;
    acousticSimTourKey = "";
    emitSelectedToMax(nIdx, Number(audition) !== 0);
  });

  Max.addHandler("replay", () => {
    if (engineState.selectedIndex >= 0) {
      emitSelectedToMax(engineState.selectedIndex, true);
    }
  });

  Max.addHandler("history_back", () => {
    stepSelectionHistory(-1);
  });

  Max.addHandler("history_forward", () => {
    stepSelectionHistory(1);
  });

  Max.addHandler("step_similar", (dir) => {
    stepSimilarSample(Number(dir) < 0 ? -1 : 1);
  });

  Max.addHandler("random_sample", () => {
    if (engineState.samples.length === 0) return;
    const vis = [];
    engineState.samples.forEach((s, i) => {
      if (isSamplePassingFilters(s)) vis.push(i);
    });
    if (vis.length > 0) {
      const pick = vis[Math.floor(Math.random() * vis.length)];
      emitSelectedToMax(pick, true);
    }
  });

  Max.addHandler("save_selected", (idx, name, catIdx, pitch, decay, gain, rev, speedPct, grainMs, stretchMode) => {
    const settings = {};
    if (name !== undefined) settings.name = name;
    if (catIdx !== undefined) settings.catIdx = Number(catIdx);
    if (pitch !== undefined) settings.pitchSt = Number(pitch);
    if (decay !== undefined) settings.decayMs = Number(decay);
    if (gain !== undefined) settings.gainDb = Number(gain);
    if (rev !== undefined) settings.reverse = Number(rev) ? 1 : 0;
    if (speedPct !== undefined) settings.speedPct = Number(speedPct);
    if (grainMs !== undefined) settings.grainMs = Number(grainMs);
    if (stretchMode !== undefined) settings.stretchMode = stretchModeIndex(stretchMode);
    saveSampleToList(idx !== undefined ? Number(idx) : engineState.selectedIndex, settings);
  });

  Max.addHandler("recall_saved", (savedIdx) => {
    recallSavedSample(Number(savedIdx), true);
  });

  Max.addHandler("reorder_saved", (fromIdx, toIdx) => {
    reorderSavedSample(Number(fromIdx), Number(toIdx));
  });

  Max.addHandler("remove_saved", (savedIdx) => {
    removeSavedSample(Number(savedIdx));
  });

  Max.addHandler("clear_saved", () => {
    clearSavedSamples();
  });

  Max.addHandler("drag_out", (mode, savedIdx = -1) => {
    resolveDragOutPaths(String(mode || "raw"), Number(savedIdx), true, true);
  });

  Max.addHandler("arm_drag", (mode, savedIdx = -1) => {
    armHoverDragZone(String(mode || "none"), Number(savedIdx));
  });

  Max.addHandler("set_pitch", (st) => {
    // Pitch only changes the next render; sfplay~ is never repitched (would double-apply on rendered files).
    engineState.pitchSt = Number(st) || 0;
    requestRenderPrewarm();
  });

  Max.addHandler("set_decay", (ms) => {
    engineState.decayMs = Math.max(20, Number(ms) || 2500);
    requestRenderPrewarm();
  });

  Max.addHandler("set_gain", (db) => {
    engineState.gainDb = Number(db) || 0;
    Max.outlet("play_gain", engineState.gainDb);
  });

  Max.addHandler("set_reverse", (rev) => {
    engineState.reverse = Number(rev) ? 1 : 0;
    requestRenderPrewarm();
  });

  Max.addHandler("set_speed", (sp) => {
    engineState.speedPct = Math.max(10, Math.min(400, Number(sp) || 100));
    requestRenderPrewarm();
  });

  Max.addHandler("set_grain", (gr) => {
    engineState.grainMs = Math.max(5, Math.min(250, Number(gr) || 45));
    requestRenderPrewarm();
  });

  Max.addHandler("set_stretchmode", (m) => {
    engineState.stretchMode = stretchModeIndex(m);
    requestRenderPrewarm();
  });

  Max.addHandler("set_maxlen", (ms) => {
    engineState.maxLenMs = isInfiniteMaxLen(ms) ? 5000 : Math.max(50, Number(ms) || 5000);
    Max.outlet("strip_filter_maxlen", engineState.maxLenMs);
  });

  Max.addHandler("set_tone", (tone) => {
    engineState.toneFilter = Number(tone) || 0;
    Max.outlet("strip_filter_tone", engineState.toneFilter);
  });

  Max.addHandler("set_filter_pitch", (pf) => {
    engineState.pitchFilter = Number(pf) || 0;
    Max.outlet("strip_filter_pitch", engineState.pitchFilter);
  });

  Max.addHandler("set_filter_tonal", (tf) => {
    engineState.tonalFilter = Number(tf) || 0;
    Max.outlet("strip_filter_tonal", engineState.tonalFilter);
  });

  Max.addHandler("set_filter_drum", (df) => {
    engineState.drumFilter = Number(df) || 0;
    Max.outlet("strip_filter_drum", engineState.drumFilter);
  });

  Max.addHandler("set_show_saved", (v) => {
    // Section layout and device width live in the patcher (mini-map v8ui + obj-expr-width).
    engineState.showSaved = Number(v) ? 1 : 0;
  });

  Max.addHandler("set_show_filters", (v) => {
    // Section layout and device width live in the patcher (mini-map v8ui + obj-expr-width).
    engineState.showFilters = Number(v) ? 1 : 0;
  });

  Max.addHandler("set_show_playback", (v) => {
    // Section layout and device width live in the patcher (mini-map v8ui + obj-expr-width).
    engineState.showPlayback = Number(v) ? 1 : 0;
  });

  Max.addHandler("set_search", (...words) => {
    const q = words.join(" ").replace(/^text\s*/i, "").trim();
    engineState.searchQuery = q;
    Max.outlet("strip_filter_search", q);
  });

  Max.addHandler("set_cat", (cat) => {
    engineState.activeCategory = String(cat || "ALL");
    Max.outlet("strip_filter_cat", engineState.activeCategory);
  });
}

if (hasRealMaxApi) {
  ensureDragHelperProcess();
  ensureKnownFoldersInitialized();
  const dirs = engineState.knownFolders.map((f) => f.path).filter((p) => fs.existsSync(p));
  if (dirs.length > 0) {
    setTimeout(() => startBackgroundScan(dirs), 150);
  }
}

module.exports = {
  parseWavBuffer,
  parseAiffBuffer,
  parseAudioBuffer,
  extractWaveformColumns,
  computeWaveformFromBuffer,
  getWaveformSync,
  buildSelectedWaveMessage,
  waveformCache,
  encodeStereoWav16,
  ensureFallbackWavFile,
  renderEditedAudioSamples,
  STRETCH_MODES,
  stretchModeIndex,
  resolveStretchMode,
  stretchEngineWanted,
  lastRenderInfo,
  renderEditedSampleWav,
  renderEditedSampleWavEx,
  requestRenderPrewarm,
  renderDebounce,
  renderStats,
  renderCache,
  renderReversedPreviewWav,
  createRawFileLink,
  extractAudioFeatures,
  classifySample,
  computeKNN,
  compute2DMap,
  packSampleBinaryRecord,
  unpackSampleBinaryRecord,
  selectSeededMapSubset,
  rebuildActiveMapSubset,
  reseedMapSubset,
  reseedWithActiveFilters,
  ensureKnownFoldersInitialized,
  addRememberedFolder,
  removeRememberedFolder,
  toggleFolderFilter,
  enableAllFolderFilters,
  startBackgroundScan,
  stepSimilarSample,
  analyzeAudioFile,
  scanDirectories,
  isInfiniteMaxLen,
  computeSampleDruminessPct,
  isSamplePassingFilters,
  saveSampleToList,
  recallSavedSample,
  reorderSavedSample,
  removeSavedSample,
  clearSavedSamples,
  resolveDragOutPaths,
  emitSelectedToMax,
  selectionHistory,
  recordSelectionHistory,
  clearSelectionHistory,
  stepSelectionHistory,
  SELECTION_HISTORY_MAX,
  engineState,
  CATEGORY_LIST,
  MAX_DISPLAY_SAMPLES,
  MAX_FILES_PER_FOLDER,
  RECORD_BYTE_SIZE
};
