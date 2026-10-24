/**
 * File drag for Better Sampler Reactive 2. Speaks the same JSON protocol as XO Sample Map's
 * Cocoa helper (src/xo_node_engine.js, binary xo_drag_helper_v6_bin). DRAG_HELPER_SOURCE is
 * injected at build time from that file, so this device does not ship a second drag binary.
 *
 * Inlet: `arm <path…>` while the pointer is over the sample name, `disarm` when it leaves.
 * `arm` uses mode selected_raw: a drag starts an OS file drag of that path, a click without
 * a drag prints REPLAY_CLICK, which this node forwards as `name_click` for the face.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const Max = require("max-api");

const EXPORT_DIR = path.join(os.tmpdir(), "xo_sample_map_exports");
const HELPER_BIN = path.join(EXPORT_DIR, "xo_drag_helper_v6_bin");
const HELPER_SRC = path.join(EXPORT_DIR, "xo_drag_helper_v6.m");

let helper = null;

function ensureHelper() {
  if (process.platform !== "darwin") return null;
  if (helper && !helper.killed) return helper;
  try {
    try { execFileSync("/usr/bin/pkill", ["-f", "[x]o_drag_helper"]); } catch (_) {}
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    if (!fs.existsSync(HELPER_BIN)) {
      fs.writeFileSync(HELPER_SRC, DRAG_HELPER_SOURCE, "utf8");
      execFileSync("/usr/bin/clang", ["-O2", "-framework", "Cocoa", "-framework", "ApplicationServices", HELPER_SRC, "-o", HELPER_BIN]);
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

Max.addHandler("arm", (...parts) => {
  const filePath = parts.map((p) => String(p)).join(" ").trim();
  if (!filePath) {
    send({ cmd: "disarm" });
    return;
  }
  send({
    cmd: "arm",
    mode: "selected_raw",
    paths: [filePath],
    w: 16,
    h: 16,
    stateFile: path.join(EXPORT_DIR, "last_drag_helper_state.json")
  });
});

Max.addHandler("disarm", () => {
  send({ cmd: "disarm" });
});
