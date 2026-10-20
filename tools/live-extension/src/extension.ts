// Live Test Bridge — an Ableton Extension (Live 12 Beta, Settings → Extensions → Developer Mode)
// that lets test scripts change a running Live Set without anyone clicking in Live.
//
// The Extensions API cannot load .amxd / .adg files (insertDevice takes built-in devices by name
// only), but it can duplicate and delete devices. Duplicating a Max for Live device instantiates
// it again, which is how a rebuilt .amxd is picked up without reopening the Set (`/reload`).
//
// HTTP on 127.0.0.1:$LIVE_TEST_BRIDGE_PORT (default 9895), JSON in / JSON out:
//   GET  /tree                          tracks -> devices (-> chains -> devices), with paths
//   POST /reload  {"match": "Delay+"}   duplicate + delete every device whose name starts with
//                                       `match` (anywhere, inside racks too), keeping positions
//   POST /insert  {"path": [...], "name": "Limiter", "index": 1}   built-in device into a chain
//   POST /delete  {"path": [...]}       delete the device at path
// A path is [trackIndex, deviceIndex, chainIndex, deviceIndex, ...] over Song.tracks.
//
// Run: cd tools/live-extension && npm install && npm start   (scripts/live_test_bridge.sh)

import * as ableton from "@ableton-extensions/sdk";
import * as http from "node:http";

type Ctx = ableton.ExtensionContext<"1.0.0">;
type Dev = ableton.Device<"1.0.0">;
type Container = ableton.Track<"1.0.0"> | ableton.Chain<"1.0.0">;

interface DeviceNode {
    path: number[];
    name: string;
    className: string;
    chains?: { name: string; devices: DeviceNode[] }[];
}

const PORT = Number(process.env.LIVE_TEST_BRIDGE_PORT || 9895);

function isRack(d: Dev): d is ableton.RackDevice<"1.0.0"> {
    return d instanceof ableton.RackDevice;
}

function describe(devices: Dev[], prefix: number[]): DeviceNode[] {
    return devices.map((d, i) => {
        const node: DeviceNode = { path: [...prefix, i], name: d.name, className: (d.constructor as { className?: string }).className ?? "Device" };
        if (isRack(d)) {
            node.chains = d.chains.map((c, ci) => ({ name: (c as unknown as { name?: string }).name ?? "", devices: describe(c.devices, [...prefix, i, ci]) }));
        }
        return node;
    });
}

// Resolves [track, dev, chain, dev, ...] to the device's container and its index in it.
function resolve(ctx: Ctx, path: number[]): { container: Container; index: number } {
    if (path.length < 2 || path.length % 2 !== 0) throw new Error("path must be [track, device, (chain, device)...]");
    const track = ctx.application.song.tracks[path[0]!];
    if (!track) throw new Error("no track " + path[0]);
    let container: Container = track;
    for (let k = 1; k < path.length - 1; k += 2) {
        const dev = container.devices[path[k]!];
        if (!dev || !isRack(dev)) throw new Error("not a rack at " + path.slice(0, k + 1).join(","));
        const chain = dev.chains[path[k + 1]!];
        if (!chain) throw new Error("no chain at " + path.slice(0, k + 2).join(","));
        container = chain;
    }
    return { container, index: path[path.length - 1]! };
}

// Every container (track or chain) in the Set, depth first.
function containers(ctx: Ctx): Container[] {
    const out: Container[] = [];
    const walk = (c: Container) => {
        out.push(c);
        for (const d of c.devices) if (isRack(d)) for (const ch of d.chains) walk(ch);
    };
    for (const t of ctx.application.song.tracks) walk(t);
    return out;
}

async function reload(ctx: Ctx, match: string): Promise<string[]> {
    const done: string[] = [];
    for (const c of containers(ctx)) {
        // Snapshot the matching devices first: positions shift as we duplicate / delete.
        const targets = c.devices.filter((d) => d.name.startsWith(match));
        for (const d of targets) {
            await c.duplicateDevice(d); // inserted right after the original
            await c.deleteDevice(d);
            done.push(d.name);
        }
    }
    return done;
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((res, rej) => {
        let s = "";
        req.on("data", (b) => (s += b));
        req.on("end", () => {
            try {
                res(s ? JSON.parse(s) : {});
            } catch (e) {
                rej(e);
            }
        });
    });
}

export function activate(activation: ableton.ActivationContext) {
    const ctx = ableton.initialize(activation, "1.0.0");
    const server = http.createServer(async (req, res) => {
        const reply = (code: number, body: unknown) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        try {
            if (req.method === "GET" && req.url === "/tree") {
                const tracks = ctx.application.song.tracks.map((t, ti) => ({ index: ti, name: (t as unknown as { name?: string }).name ?? "", devices: describe(t.devices, [ti]) }));
                return reply(200, { tracks });
            }
            const body = req.method === "POST" ? await readBody(req) : {};
            if (req.url === "/reload") {
                const match = String(body.match ?? "");
                if (!match) return reply(400, { error: "match required" });
                return reply(200, { reloaded: await reload(ctx, match) });
            }
            if (req.url === "/insert") {
                const { container } = resolve(ctx, [...(body.path as number[]), 0]);
                const dev = await container.insertDevice(String(body.name), Number(body.index ?? container.devices.length));
                return reply(200, { inserted: dev.name });
            }
            if (req.url === "/delete") {
                const { container, index } = resolve(ctx, body.path as number[]);
                const dev = container.devices[index];
                if (!dev) return reply(404, { error: "no device" });
                await container.deleteDevice(dev);
                return reply(200, { deleted: dev.name });
            }
            return reply(404, { error: "unknown route" });
        } catch (e) {
            return reply(500, { error: String(e instanceof Error ? e.message : e) });
        }
    });
    server.listen(PORT, "127.0.0.1", () => console.log(`Live Test Bridge listening on 127.0.0.1:${PORT}`));
}
