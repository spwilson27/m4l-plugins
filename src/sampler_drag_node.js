/**
 * File drag for Better Sampler Reactive 2. DRAG_HELPER_SOURCE is scripts/bs_drag_helper.m,
 * injected at build time. A drag starts in mouseDragged so Ableton accepts the file.
 *
 * Inlet: `arm <w> <h> <path…>` while the pointer is over the sample name, `disarm` when it
 * moves onto another control. `arm` uses mode selected_raw: a drag starts an OS file drag of
 * that path, a click without a drag prints REPLAY_CLICK, forwarded as `name_click`.
 */
"use strict";

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
          if (lines[i].indexOf("REPLAY_CLICK") >= 0) {
            try { Max.outlet("name_click"); } catch (_) {}
          }
        }
      });
    }
    helper.on("exit", () => { helper = null; });
  } catch (err) {
    helper = null;
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

Max.addHandler("arm", (w, h, ...rest) => {
  const ww = Number(w);
  const hh = Number(h);
  let width = 16;
  let height = 16;
  let filePath = "";
  if (Number.isFinite(ww) && Number.isFinite(hh) && rest.length) {
    width = Math.max(16, Math.min(240, ww));
    height = Math.max(14, Math.min(40, hh));
    filePath = rest.map((p) => String(p)).join(" ").trim();
  } else {
    filePath = [w, h, ...rest].filter((p) => p !== undefined).map((p) => String(p)).join(" ").trim();
  }
  if (!filePath) {
    send({ cmd: "disarm" });
    return;
  }
  send({
    cmd: "arm",
    mode: "selected_raw",
    paths: [filePath],
    w: width,
    h: height,
    stateFile: path.join(EXPORT_DIR, "last_drag_helper_state.json")
  });
});

Max.addHandler("disarm", () => {
  send({ cmd: "disarm" });
});
