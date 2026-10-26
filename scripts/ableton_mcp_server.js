#!/usr/bin/env node
/**
 * Ableton Live M4L MCP Server (`scripts/ableton_mcp_server.js`)
 *
 * Connects Cursor's Model Context Protocol (MCP) to `devices/Ableton MCP Bridge.amxd`
 * running inside Ableton Live (`http://127.0.0.1:<port>/rpc`, default port `9877`).
 *
 * Supports multiple concurrent Ableton Live + MCP sessions on the same machine:
 *  - `ableton_list_sessions` discovers all active sessions across ports `9877..9884`
 *    and `/tmp/ableton_mcp_sessions.json`.
 *  - Every tool accepts an optional `port` argument to target a specific session.
 *  - CLI supports `--port <port>`:
 *      node scripts/ableton_mcp_server.js --call ableton_list_sessions '{}'
 *      node scripts/ableton_mcp_server.js --port 9877 --call ableton_get_session_info '{}'
 *      node scripts/ableton_mcp_server.js --port 9878 --call ableton_get_tracks_tree '{}'
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const BRIDGE_HOST = process.env.ABLETON_MCP_HOST || "127.0.0.1";
let DEFAULT_BRIDGE_PORT = Number(process.env.ABLETON_MCP_PORT) || 9877;
const HTTP_TIMEOUT_MS = Number(process.env.ABLETON_MCP_TIMEOUT_MS) || 8000;
const SESSIONS_REGISTRY_FILE = "/tmp/ableton_mcp_sessions.json";

const PORT_PROP = {
    type: "number",
    description: "Optional TCP port of the target Ableton MCP Bridge session (default 9877, or 9878+ for additional concurrent Ableton sessions)."
};

const TOOLS = [
    {
        name: "ableton_list_sessions",
        description: "List all active Ableton Live + MCP Bridge sessions running on this machine (ports 9877..9884), including their port, PID, session tag, tempo, and track count.",
        inputSchema: {
            type: "object",
            properties: {}
        }
    },
    {
        name: "ableton_ping",
        description: "Verify connectivity to the `Ableton MCP Bridge.amxd` device running in Ableton Live.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP
            }
        }
    },
    {
        name: "ableton_get_session_info",
        description: "Get Ableton Live Set session info: tempo, time signature, playing state, loop settings, track count, and selected track.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP
            }
        }
    },
    {
        name: "ableton_get_tracks_tree",
        description: "Get the full hierarchy of tracks, Audio/Instrument/Drum Racks, Rack chains, nested Racks, and devices in the current Ableton Live Set.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                trackIndex: {
                    type: "number",
                    description: "Optional 0-based track index to inspect a single track instead of all tracks."
                },
                includeParameters: {
                    type: "boolean",
                    description: "If true, include device parameter lists for each device."
                },
                maxParameters: {
                    type: "number",
                    description: "Maximum parameters per device to return when includeParameters is true (default 32)."
                },
                includeReturns: {
                    type: "boolean",
                    description: "Include return tracks (default true)."
                },
                includeMaster: {
                    type: "boolean",
                    description: "Include master track (default true)."
                }
            }
        }
    },
    {
        name: "ableton_lom_get",
        description: "Query any Ableton Live Object Model (LOM) path (e.g. 'live_set tracks 0 devices 0') for properties, child counts, or LOM object info.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                path: {
                    type: "string",
                    description: "LOM path such as 'live_set', 'live_set tracks 0', 'live_set tracks 0 devices 0 chains 1 devices 0'."
                },
                property: {
                    oneOf: [
                        { type: "string" },
                        { type: "array", items: { type: "string" } }
                    ],
                    description: "Property name or array of property names to read via LiveAPI.get()."
                },
                childCount: {
                    type: "string",
                    description: "Optional child collection name to count via LiveAPI.getcount() (e.g. 'tracks', 'devices', 'chains', 'parameters')."
                },
                includeInfo: {
                    type: "boolean",
                    description: "If true, include full LiveAPI.info and children metadata."
                }
            },
            required: ["path"]
        }
    },
    {
        name: "ableton_lom_set",
        description: "Set a property on any Ableton Live Object Model (LOM) path via LiveAPI.set(property, value).",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                path: {
                    type: "string",
                    description: "Target LOM path (e.g. 'live_set', 'live_set tracks 0', 'live_set tracks 0 devices 0 parameters 1')."
                },
                property: {
                    type: "string",
                    description: "Property name to set (e.g. 'tempo', 'mute', 'solo', 'name', 'value', 'is_active')."
                },
                value: {
                    description: "New value to assign to the property (number or string)."
                }
            },
            required: ["path", "property", "value"]
        }
    },
    {
        name: "ableton_lom_call",
        description: "Call any method on an Ableton LOM path via LiveAPI.call(method, ...args), such as 'delete_device', 'create_audio_track', 'duplicate_track', 'undo', 'redo'.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                path: {
                    type: "string",
                    description: "Target LOM path (e.g. 'live_set', 'live_set tracks 0', 'live_set tracks 0 devices 0 chains 1')."
                },
                method: {
                    type: "string",
                    description: "Method name to invoke on the LOM object."
                },
                args: {
                    type: "array",
                    items: {},
                    description: "Optional array of arguments passed to LiveAPI.call()."
                }
            },
            required: ["path", "method"]
        }
    },
    {
        name: "ableton_get_device_parameters",
        description: "List all parameters (index, id, name, value, min, max, display_value) of a device at the given LOM path.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                path: {
                    type: "string",
                    description: "Device LOM path (e.g. 'live_set tracks 0 devices 0' or 'live_set tracks 0 devices 0 chains 0 devices 0')."
                },
                maxParameters: {
                    type: "number",
                    description: "Maximum number of parameters to return (default 128)."
                }
            },
            required: ["path"]
        }
    },
    {
        name: "ableton_set_device_parameter",
        description: "Set a parameter on a device by parameter name or 0-based parameter index.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                path: {
                    type: "string",
                    description: "Device LOM path."
                },
                paramName: {
                    type: "string",
                    description: "Parameter name (exact or substring match, case-insensitive)."
                },
                paramIndex: {
                    type: "number",
                    description: "0-based parameter index (if paramName is not used)."
                },
                value: {
                    type: "number",
                    description: "New numeric value to set (automatically clamped to [min, max])."
                }
            },
            required: ["path", "value"]
        }
    },
    {
        name: "ableton_delete_device",
        description: "Delete a device from a Track or Rack Chain by full device LOM path (e.g. 'live_set tracks 0 devices 0 chains 2 devices 0') or parentPath + deviceIndex.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                path: {
                    type: "string",
                    description: "Full LOM path of the device to delete (e.g. 'live_set tracks 0 devices 0 chains 2 devices 0')."
                },
                parentPath: {
                    type: "string",
                    description: "Optional parent Track or Chain LOM path if deviceIndex is provided directly."
                },
                deviceIndex: {
                    type: "number",
                    description: "Optional 0-based device index inside parentPath."
                }
            }
        }
    },
    {
        name: "ableton_transport",
        description: "Control Ableton Live transport and undo/redo history ('play', 'stop', 'continue', 'undo', 'redo') or set tempo.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                action: {
                    type: "string",
                    enum: ["play", "stop", "continue", "undo", "redo"],
                    description: "Transport or undo action to trigger."
                },
                tempo: {
                    type: "number",
                    description: "Optional BPM tempo (20..999) to set."
                }
            }
        }
    },
    {
        name: "ableton_inspect_mbsplit",
        description: "Inspect `Global('mbsplit_shared_bus')` in Max's JS runtime (all registered Multiband Split peers, group states, chain ranks, liveness) alongside all Multiband Split devices currently in the Live Set.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP
            }
        }
    },
    {
        name: "ableton_eval_lom_js",
        description: "Evaluate a diagnostic JavaScript snippet inside Max's `v8ui` LOM environment (with access to `LiveAPI`, `Global`, `Buffer`, `max`, `makeApi`, `getScalar`, `extractIds`) and return the JSON result.",
        inputSchema: {
            type: "object",
            properties: {
                port: PORT_PROP,
                code: {
                    type: "string",
                    description: "JavaScript function body to execute (use `return ...;` to return a value)."
                }
            },
            required: ["code"]
        }
    }
];

const TOOL_TO_ACTION = {
    ableton_ping: "ping",
    ableton_get_session_info: "get_session_info",
    ableton_get_tracks_tree: "get_tracks_tree",
    ableton_lom_get: "lom_get",
    ableton_lom_set: "lom_set",
    ableton_lom_call: "lom_call",
    ableton_get_device_parameters: "get_device_parameters",
    ableton_set_device_parameter: "set_device_parameter",
    ableton_delete_device: "delete_device",
    ableton_transport: "transport",
    ableton_inspect_mbsplit: "inspect_mbsplit",
    ableton_eval_lom_js: "eval_js"
};

function checkPortHealth(port, timeoutMs = 450) {
    return new Promise((resolve) => {
        const req = http.request(
            {
                hostname: BRIDGE_HOST,
                port,
                path: "/health",
                method: "GET",
                timeout: timeoutMs
            },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    try {
                        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                        resolve(data && data.ok ? data : null);
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

function callBridgeHttp(action, params, targetPort) {
    const port = Number(targetPort || (params && params.port) || DEFAULT_BRIDGE_PORT) || 9877;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        return Promise.resolve({
            ok: false,
            error: `Invalid bridge port ${port} (must be an integer 0..65535).`
        });
    }
    return new Promise((resolve) => {
        const cleanParams = Object.assign({}, params || {});
        delete cleanParams.port;
        const payload = JSON.stringify({ action, params: cleanParams });
        const req = http.request(
            {
                hostname: BRIDGE_HOST,
                port,
                path: "/rpc",
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Content-Length": Buffer.byteLength(payload)
                },
                timeout: HTTP_TIMEOUT_MS
            },
            (res) => {
                const chunks = [];
                res.on("data", (c) => chunks.push(c));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    try {
                        resolve(JSON.parse(text));
                    } catch (e) {
                        resolve({ ok: false, error: "Invalid JSON from Ableton MCP Bridge: " + text });
                    }
                });
            }
        );
        req.on("error", (err) => {
            resolve({
                ok: false,
                error:
                    `Cannot reach Ableton MCP Bridge at http://${BRIDGE_HOST}:${port} (${err.code || err.message}). ` +
                    `Open '/Users/mrwilson/software/ableton/ableton_mcp_bridge.als' or load 'devices/Ableton MCP Bridge.amxd' in Ableton Live.`
            });
        });
        req.on("timeout", () => {
            req.destroy();
            resolve({
                ok: false,
                error: `Request to Ableton MCP Bridge at http://${BRIDGE_HOST}:${port} timed out after ${HTTP_TIMEOUT_MS}ms.`
            });
        });
        req.write(payload);
        req.end();
    });
}

async function discoverActiveSessions() {
    const candidatePorts = new Set();
    for (let p = 9877; p <= 9884; p++) candidatePorts.add(p);
    if (fs.existsSync(SESSIONS_REGISTRY_FILE)) {
        try {
            const reg = JSON.parse(fs.readFileSync(SESSIONS_REGISTRY_FILE, "utf8")) || {};
            for (const k of Object.keys(reg)) {
                const pn = Number(k);
                if (pn >= 1024 && pn <= 65535) candidatePorts.add(pn);
            }
        } catch (_) {}
    }

    const sortedPorts = Array.from(candidatePorts).sort((a, b) => a - b);
    const activeSessions = [];
    for (const p of sortedPorts) {
        const health = await checkPortHealth(p, 350);
        if (health && health.ok) {
            const sessionRes = await callBridgeHttp("get_session_info", {}, p);
            activeSessions.push({
                port: p,
                host: BRIDGE_HOST,
                node_pid: health.node_pid,
                max_ppid: health.max_ppid,
                session_tag: health.session_tag || "",
                uptime_ms: health.uptime_ms,
                session_info: sessionRes && sessionRes.ok ? sessionRes.result : null
            });
        }
    }
    return {
        default_port: DEFAULT_BRIDGE_PORT,
        active_count: activeSessions.length,
        sessions: activeSessions
    };
}

async function executeMcpTool(name, args) {
    if (name === "ableton_list_sessions") {
        const info = await discoverActiveSessions();
        return {
            isError: false,
            content: [{ type: "text", text: JSON.stringify(info, null, 2) }]
        };
    }

    const action = TOOL_TO_ACTION[name];
    if (!action) {
        return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool: ${name}` }]
        };
    }
    const targetPort = (args && args.port) ? Number(args.port) : DEFAULT_BRIDGE_PORT;
    const res = await callBridgeHttp(action, args || {}, targetPort);
    if (!res || !res.ok) {
        return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(res || { ok: false, error: "Empty response" }, null, 2) }]
        };
    }
    return {
        isError: false,
        content: [{ type: "text", text: JSON.stringify(res.result, null, 2) }]
    };
}

// =========================================================================
// STDIO MCP JSON-RPC 2.0 SERVER + CLI RUNNER
// =========================================================================
let useContentLengthFraming = false;

function sendRpcMessage(msg) {
    const json = JSON.stringify(msg);
    if (useContentLengthFraming) {
        const byteLen = Buffer.byteLength(json, "utf8");
        process.stdout.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
    } else {
        process.stdout.write(json + "\n");
    }
}

async function handleJsonRpcMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    const { id, method, params } = msg;

    // A message with no id is a JSON-RPC notification and must never be answered.
    if (id === undefined) return;

    if (method === "initialize") {
        const clientProtocol = (params && params.protocolVersion) || "2024-11-05";
        sendRpcMessage({
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: clientProtocol,
                capabilities: {
                    tools: {}
                },
                serverInfo: {
                    name: "ableton-m4l-mcp",
                    version: "1.1.0"
                }
            }
        });
        return;
    }

    if (method === "notifications/initialized" || method === "notifications/cancelled") {
        return;
    }

    if (method === "ping") {
        sendRpcMessage({ jsonrpc: "2.0", id, result: {} });
        return;
    }

    if (method === "tools/list") {
        sendRpcMessage({
            jsonrpc: "2.0",
            id,
            result: {
                tools: TOOLS
            }
        });
        return;
    }

    if (method === "resources/list") {
        sendRpcMessage({ jsonrpc: "2.0", id, result: { resources: [] } });
        return;
    }

    if (method === "prompts/list") {
        sendRpcMessage({ jsonrpc: "2.0", id, result: { prompts: [] } });
        return;
    }

    if (method === "tools/call") {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};
        const toolResult = await executeMcpTool(toolName, toolArgs);
        sendRpcMessage({
            jsonrpc: "2.0",
            id,
            result: toolResult
        });
        return;
    }

    if (id !== undefined) {
        sendRpcMessage({
            jsonrpc: "2.0",
            id,
            error: {
                code: -32601,
                message: `Method not found: ${method}`
            }
        });
    }
}

function startStdioMcpServer() {
    let buffer = Buffer.alloc(0);

    process.stdin.on("data", (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length > 0) {
            const headStr = buffer.toString("utf8", 0, Math.min(buffer.length, 1024));
            const headerBlockMatch = headStr.match(/^((?:[A-Za-z][A-Za-z0-9-]*:[^\r\n]*\r?\n)+)\r?\n/);
            let headerMatch = null;
            if (headerBlockMatch) {
                const lenMatch = headerBlockMatch[1].match(/Content-Length:\s*(\d+)/i);
                if (lenMatch) headerMatch = [headerBlockMatch[0], lenMatch[1]];
            }
            if (headerMatch) {
                useContentLengthFraming = true;
                const headerByteLen = Buffer.byteLength(headerMatch[0], "utf8");
                const bodyByteLen = parseInt(headerMatch[1], 10);
                if (buffer.length < headerByteLen + bodyByteLen) {
                    break;
                }
                const bodyStr = buffer.slice(headerByteLen, headerByteLen + bodyByteLen).toString("utf8");
                buffer = buffer.slice(headerByteLen + bodyByteLen);
                let bodyMsg;
                try {
                    bodyMsg = JSON.parse(bodyStr);
                } catch (_) {
                    sendRpcMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
                    continue;
                }
                try {
                    handleJsonRpcMessage(bodyMsg);
                } catch (_) {}
                continue;
            }

            // Incomplete header block (chunk ended before the blank-line terminator,
            // e.g. a Content-Type or Content-Length line split across chunks): wait for
            // more bytes; do not treat header lines as NDJSON.
            if (/^[A-Za-z][A-Za-z0-9-]*:/.test(headStr) && !/\r?\n\r?\n/.test(headStr)) {
                break;
            }

            const nlIdx = buffer.indexOf(0x0a); // '\n'
            if (nlIdx === -1) break;
            const lineStr = buffer.slice(0, nlIdx).toString("utf8").trim();
            buffer = buffer.slice(nlIdx + 1);
            if (!lineStr) continue;
            let lineMsg;
            try {
                lineMsg = JSON.parse(lineStr);
            } catch (_) {
                sendRpcMessage({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
                continue;
            }
            try {
                handleJsonRpcMessage(lineMsg);
            } catch (_) {}
        }
    });
}

async function main() {
    const argv = process.argv.slice(2);
    let idx = 0;
    while (idx < argv.length) {
        if (argv[idx] === "--port" && argv[idx + 1]) {
            DEFAULT_BRIDGE_PORT = Number(argv[idx + 1]) || 9877;
            idx += 2;
            continue;
        }
        if (argv[idx] === "--list-sessions") {
            const out = await executeMcpTool("ableton_list_sessions", {});
            console.log(out.content[0].text);
            process.exit(0);
            return;
        }
        if (argv[idx] === "--call") {
            const toolName = argv[idx + 1] || "ableton_ping";
            let args = {};
            if (argv[idx + 2]) {
                try {
                    args = JSON.parse(argv[idx + 2]);
                } catch (e) {
                    console.error("Invalid JSON arguments:", e.message);
                    process.exit(1);
                }
            }
            const out = await executeMcpTool(toolName, args);
            console.log(out.content[0].text);
            process.exit(out.isError ? 1 : 0);
            return;
        }
        idx++;
    }

    startStdioMcpServer();
}

if (require.main === module) {
    main();
}

module.exports = {
    TOOLS,
    TOOL_TO_ACTION,
    executeMcpTool,
    callBridgeHttp,
    discoverActiveSessions
};
