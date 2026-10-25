/**
 * Ableton MCP Bridge — Node for Max HTTP-to-LOM Relay (`src/ableton_mcp_node.js`)
 *
 * Runs inside `node.codebox` (`@autostart 1`) and listens on `http://127.0.0.1:<port>`
 * (default `9877`, configurable via `ABLETON_MCP_PORT` or auto-incremented `9877..9890`
 * when multiple Ableton Live sessions run concurrently on the same machine).
 *
 * Multi-Session Isolation:
 *  - On `EADDRINUSE`, inspects `GET /health` on that port:
 *    - If the existing server belongs to the SAME Max/Live parent process (`max_ppid === process.ppid`),
 *      requests a clean `/shutdown` of the old listener and rebinds the same port.
 *    - If the existing server belongs to a DIFFERENT Ableton Live process, leaves it untouched
 *      and automatically binds the next available port (`port + 1`).
 *  - Writes active session metadata to `/tmp/ableton_mcp_sessions.json` so Cursor agents
 *    can discover all running Ableton + MCP sessions via `ableton_list_sessions`.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

let Max = null;
try {
    Max = require("max-api");
} catch (_) {
    Max = global.__MAX_API_MOCK__ || {
        post: () => {},
        outlet: () => {},
        addHandler: () => {}
    };
}

const BASE_PORT = Number(process.env.ABLETON_MCP_PORT) || 9877;
const MAX_PORT_SCAN = 16;
const HOST = "127.0.0.1";
const RPC_TIMEOUT_MS = 8000;
const SESSIONS_REGISTRY_FILE = "/tmp/ableton_mcp_sessions.json";

let activePort = BASE_PORT;
let nextReqId = 1;
const pending = new Map();
let server = null;
const startedAt = Date.now();

Max.addHandler("lom_reply", (reqId, jsonStr) => {
    const key = String(reqId);
    const entry = pending.get(key);
    if (!entry) return;
    pending.delete(key);
    clearTimeout(entry.timer);
    try {
        const parsed = JSON.parse(String(jsonStr || "{}"));
        entry.resolve(parsed);
    } catch (err) {
        entry.resolve({ ok: false, error: "Invalid JSON from LOM: " + String(err.message || err) });
    }
});

Max.addHandler("set_port", (newPort) => {
    const p = Number(newPort);
    if (p >= 1024 && p <= 65535 && p !== activePort) {
        if (server) {
            unregisterSessionPort(activePort);
            try { server.close(); } catch (_) {}
            server = null;
        }
        startListening(p, 0);
    }
});

function callLomRpc(action, params) {
    return new Promise((resolve) => {
        const reqId = String(nextReqId++);
        const timer = setTimeout(() => {
            pending.delete(reqId);
            resolve({ ok: false, error: `LOM RPC timed out after ${RPC_TIMEOUT_MS}ms (${action})` });
        }, RPC_TIMEOUT_MS);

        pending.set(reqId, { resolve, timer });
        try {
            Max.outlet("lom_rpc", reqId, JSON.stringify({ action, params: params || {} }));
        } catch (err) {
            clearTimeout(timer);
            pending.delete(reqId);
            resolve({ ok: false, error: String(err.message || err) });
        }
    });
}

function registerSessionPort(port) {
    try {
        let sessions = {};
        if (fs.existsSync(SESSIONS_REGISTRY_FILE)) {
            try {
                sessions = JSON.parse(fs.readFileSync(SESSIONS_REGISTRY_FILE, "utf8")) || {};
            } catch (_) {
                sessions = {};
            }
        }
        sessions[String(port)] = {
            port,
            host: HOST,
            node_pid: process.pid,
            max_ppid: process.ppid,
            session_tag: process.env.ABLETON_MCP_SESSION_TAG || "",
            started_at: startedAt,
            updated_at: Date.now()
        };
        fs.writeFileSync(SESSIONS_REGISTRY_FILE, JSON.stringify(sessions, null, 2), "utf8");
    } catch (_) {}
}

function unregisterSessionPort(port) {
    try {
        if (!fs.existsSync(SESSIONS_REGISTRY_FILE)) return;
        const sessions = JSON.parse(fs.readFileSync(SESSIONS_REGISTRY_FILE, "utf8")) || {};
        if (sessions[String(port)] && sessions[String(port)].node_pid === process.pid) {
            delete sessions[String(port)];
            fs.writeFileSync(SESSIONS_REGISTRY_FILE, JSON.stringify(sessions, null, 2), "utf8");
        }
    } catch (_) {}
}

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Access-Control-Allow-Origin": "*"
    });
    res.end(body);
}

function createBridgeServer(port) {
    return http.createServer((req, res) => {
        if (req.method === "OPTIONS") {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            });
            res.end();
            return;
        }

        if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
            sendJson(res, 200, {
                ok: true,
                status: "online",
                port,
                node_pid: process.pid,
                max_ppid: process.ppid,
                session_tag: process.env.ABLETON_MCP_SESSION_TAG || "",
                uptime_ms: Date.now() - startedAt
            });
            return;
        }

        if (req.method === "POST" && req.url === "/shutdown") {
            unregisterSessionPort(port);
            sendJson(res, 200, { ok: true, shutting_down: true, port });
            if (server) {
                try { server.close(); } catch (_) {}
                server = null;
            }
            return;
        }

        if (req.method === "POST" && req.url === "/rpc") {
            const chunks = [];
            req.on("data", (chunk) => chunks.push(chunk));
            req.on("end", async () => {
                let body = {};
                try {
                    const raw = Buffer.concat(chunks).toString("utf8");
                    body = raw ? JSON.parse(raw) : {};
                } catch (err) {
                    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
                    return;
                }
                if (body === null || typeof body !== "object" || Array.isArray(body)) {
                    sendJson(res, 400, { ok: false, error: "Request body must be a JSON object" });
                    return;
                }
                const reqBody = /** @type {{ action?: unknown, params?: Record<string, unknown> }} */ (body);
                const action = String(reqBody.action || "ping");
                const params = reqBody.params || {};
                const reply = await callLomRpc(action, params);
                if (reply && typeof reply === "object") {
                    reply.port = port;
                    reply.max_ppid = process.ppid;
                }
                sendJson(res, reply.ok ? 200 : 500, reply);
            });
            return;
        }

        sendJson(res, 404, { ok: false, error: "Not found" });
    });
}

function queryExistingPortHealth(port) {
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: HOST,
                port,
                path: "/health",
                method: "GET",
                timeout: 450
            },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                    } catch (_) {
                        resolve(null);
                    }
                });
            }
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
            req.destroy();
            resolve(null);
        });
        req.end();
    });
}

function requestPreviousInstanceShutdown(port) {
    return new Promise((/** @type {(value?: any) => void} */ resolve) => {
        const req = http.request(
            {
                hostname: HOST,
                port,
                path: "/shutdown",
                method: "POST",
                timeout: 600
            },
            (res) => {
                res.resume();
                res.on("end", () => setTimeout(resolve, 120));
            }
        );
        req.on("error", () => resolve());
        req.on("timeout", () => {
            req.destroy();
            resolve();
        });
        req.end();
    });
}

function startListening(targetPort, attempt) {
    const srv = createBridgeServer(targetPort);
    server = srv;

    srv.on("error", async (/** @type {NodeJS.ErrnoException} */ err) => {
        if (err && err.code === "EADDRINUSE" && attempt < MAX_PORT_SCAN) {
            const existing = await queryExistingPortHealth(targetPort);
            if (existing && existing.max_ppid === process.ppid) {
                // Same Max/Ableton process reloaded the device -> replace old listener on same port
                await requestPreviousInstanceShutdown(targetPort);
                startListening(targetPort, attempt + 1);
                return;
            }
            // Another Ableton Live session is actively using `targetPort` -> bind next port
            startListening(targetPort + 1, attempt + 1);
            return;
        }
        try {
            Max.outlet("bridge_status", "ERR:" + (err.code || "PORT"), targetPort);
        } catch (_) {}
    });

    srv.listen(targetPort, HOST, () => {
        activePort = targetPort;
        registerSessionPort(targetPort);
        try {
            Max.outlet("bridge_status", "ONLINE", targetPort);
            Max.post(`[Ableton MCP Bridge] Listening on http://${HOST}:${targetPort} (Max PPID ${process.ppid})`);
        } catch (_) {}
    });
}

process.on("exit", () => unregisterSessionPort(activePort));
process.on("SIGTERM", () => {
    unregisterSessionPort(activePort);
    process.exit(0);
});

startListening(BASE_PORT, 0);

module.exports = {
    callLomRpc,
    BASE_PORT,
    SESSIONS_REGISTRY_FILE
};
