/**
 * File drag for Better Sampler Reactive 2. DRAG_HELPER_SOURCE is scripts/bs_drag_helper.m,
 * injected at build time. The helper is XO's: a 16×16 panel under the cursor, and the drag
 * session starts from the original mouseDown.
 *
 * Inlet: `arm hover <w> <h> <ox> <oy>` while the pointer is over the sample name (the box
 * covers that whole name), `arm handoff` when a drag has already started on the face,
 * `disarm` when it moves onto another control. The path is read from /tmp/bs_drag_path.txt
 * so a name with spaces is not split by Max. Live reports it as "Macintosh HD:/Users/...",
 * which is resolved to the POSIX path before the file is checked. Mode is selected_raw:
 * a drag starts an OS file drag, a click without a drag prints REPLAY_CLICK, forwarded
 * as `name_click`.
 */
"use strict";

// The face writes "<charCount>\\n<path>". A later shorter path must not keep the tail of
// the previous one: Max's File write has been observed to leave those bytes in place.
function takeDragPathText(raw) {
  raw = String(raw || "").replace(/\0/g, "");
  const nl = raw.search(/\r?\n/);
  if (nl > 0 && /^\d+$/.test(raw.slice(0, nl))) {
    const n = parseInt(raw.slice(0, nl), 10);
    const start = nl + (raw.charAt(nl) === "\r" && raw.charAt(nl + 1) === "\n" ? 2 : 1);
    return raw.slice(start, start + n);
  }
  return raw.trim();
}

// buffer~ reports the boot volume as "Macintosh HD:/Users/...". That string is not a file.
function resolveSampleDragPath(raw, exists) {
  const p = String(raw || "").replace(/\0/g, "").trim();
  if (!p) return "";
  if (exists(p)) return p;
  const colon = p.indexOf(":");
  if (colon > 0) {
    const rest = p.slice(colon + 1);
    if (rest.charAt(0) === "/" && exists(rest)) return rest;
  }
  return "";
}

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const Max = require("max-api");

const EXPORT_DIR = path.join(os.tmpdir(), "xo_sample_map_exports");
const HELPER_BIN = path.join(EXPORT_DIR, "bs_drag_helper_v1_bin");
const HELPER_SRC = path.join(EXPORT_DIR, "bs_drag_helper_v1.m");
const HELPER_STAMP = HELPER_BIN + ".stamp";

let helper = null;
const LOG = "/tmp/bs_drag_node.log";
const PATH_FILE = "/tmp/bs_drag_path.txt";

function log(line) {
  try { fs.appendFileSync(LOG, line + "\n"); } catch (_) {}
}

function sidePath() {
  try { return resolveSampleDragPath(takeDragPathText(fs.readFileSync(PATH_FILE, "utf8")), (p) => fs.existsSync(p)); }
  catch (_) { return ""; }
}

function armBox(args) {
  let handoff = false;
  const nums = [];
  for (let i = 0; i < args.length; i++) {
    if (String(args[i]) === "handoff") handoff = true;
    else if (String(args[i]) !== "hover") {
      const n = Number(args[i]);
      if (isFinite(n)) nums.push(n);
    }
  }
  const w = nums.length >= 1 && nums[0] > 0 ? nums[0] : 16;
  const h = nums.length >= 2 && nums[1] > 0 ? nums[1] : 16;
  return {
    handoff: handoff,
    w: w,
    h: h,
    ox: nums.length >= 4 ? nums[2] : w * 0.5,
    oy: nums.length >= 4 ? nums[3] : h * 0.5
  };
}

function ensureHelper() {
  if (process.platform !== "darwin") return null;
  const stamp = crypto.createHash("sha256").update(String(DRAG_HELPER_SOURCE)).digest("hex");
  let current = false;
  try { current = fs.readFileSync(HELPER_STAMP, "utf8") === stamp && fs.existsSync(HELPER_BIN); } catch (_) { current = false; }
  if (helper && !helper.killed && current) return helper;
  try {
    if (helper && !helper.killed) { try { helper.kill("SIGTERM"); } catch (_) {} }
    helper = null;
    try { execFileSync("/usr/bin/pkill", ["-f", "[b]s_drag_helper_v1"]); } catch (_) {}
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    if (!current) {
      fs.writeFileSync(HELPER_SRC, DRAG_HELPER_SOURCE, "utf8");
      execFileSync("/usr/bin/clang", ["-O2", "-framework", "Cocoa", "-framework", "ApplicationServices", HELPER_SRC, "-o", HELPER_BIN]);
      fs.writeFileSync(HELPER_STAMP, stamp);
    }
    helper = spawn(HELPER_BIN, [], { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    if (helper.stdout) {
      helper.stdout.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i]) continue;
          log("helper " + lines[i]);
          if (lines[i].indexOf("REPLAY_CLICK") >= 0) {
            try { Max.outlet("name_click"); } catch (_) {}
          }
        }
      });
    }
    helper.on("exit", () => { helper = null; });
  } catch (err) {
    helper = null;
    log("spawn failed: " + err);
    try { Max.post("sampler drag helper: " + err); } catch (_) {}
  }
  return helper;
}

function send(payload) {
  const proc = ensureHelper();
  if (proc && proc.stdin && !proc.stdin.destroyed) {
    try { proc.stdin.write(JSON.stringify(payload) + "\n"); } catch (_) {}
  }
}

Max.addHandler("arm", (...args) => {
  // The path is not in this message: a sample name with spaces never arrived intact, so the
  // panel never armed. The face writes it to PATH_FILE first, then sends `arm hover` or `arm handoff`.
  const box = armBox(args);
  const filePath = sidePath();
  log("arm args=" + JSON.stringify(args) + " path=" + JSON.stringify(filePath));
  if (!filePath) {
    send({ cmd: "disarm" });
    return;
  }
  send({
    cmd: "arm",
    mode: "selected_raw",
    paths: [filePath],
    // The box is the whole sample name, placed so the cursor keeps its offset inside it.
    w: box.w,
    h: box.h,
    ox: box.ox,
    oy: box.oy,
    handoff: box.handoff,
    stateFile: "/tmp/bs_drag_state.json"
  });
});

Max.addHandler("disarm", () => {
  send({ cmd: "disarm" });
});
