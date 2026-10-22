"use strict";
// Unit tests for src/spectral_link.js with a mocked Global / LiveAPI / Task (shared by every Spectral Split device).
// Standalone: node tests/spectral_link_tests.js     From a device test: require("./spectral_link_tests.js").runLinkTests().

const assert = require("assert");
const path = require("path");
const spl = require(path.join(__dirname, "..", "src", "spectral_link.js"));

function makeWorld() {
    const store = {};
    const racks = {};     // rack path -> chain count
    const world = {
        time: 1000,
        store,
        racks,
        env(devicePath) {
            return {
                Global: function (name) {
                    if (!store[name]) store[name] = {};
                    return store[name];
                },
                LiveAPI: function (cb, p) {
                    if (p === "this_device") {
                        return { get unquotedpath() { return devicePath.value; }, get path() { return devicePath.value; } };
                    }
                    const api = { unquotedpath: p, path: p, getcount(prop) { return prop === "chains" ? (racks[api.path] || 0) : 0; } };
                    return api;
                },
                Task: function (fn) {
                    this.interval = 0;
                    this.repeat = function () {};
                    this.cancel = function () {};
                },
                now: () => world.time
            };
        }
    };
    return world;
}

// an instance with its own face state: values, applied log, info log
function makeInstance(world, kind, devicePath, initial) {
    const dp = { value: devicePath };
    const vals = Object.assign({ bias: 0, tilt: 0, size: 1 }, initial || {});
    const applied = [];
    const infos = [];
    let link = null;
    link = spl.splCreateLink({
        kind,
        keys: ["bias", "tilt", "size"],
        channelCount: 2,
        getLocal: (k) => vals[k],
        apply: (k, v) => {
            vals[k] = v;
            applied.push([k, v]);
            link.notify(k, v);      // a face that wrongly echoes: the link must ignore it while applying
        },
        onInfo: (i) => infos.push(i)
    }, world.env(dp));
    return { link, vals, applied, infos, dp };
}

function tick(world, instances, ms) {
    world.time += ms || 100;
    for (const i of instances) i.link.tick();
}

// ---- rack sharing: leader election and the messages sent to the gen ----
function makeRackInstance(world, devicePath, name) {
    const gen = { run: false, alive: 0, fb: 0 };
    const sent = [];
    const dp = { value: devicePath };
    const vals = { bias: 0, size: 1 };
    let link = null;
    link = spl.splCreateLink({
        kind: "rk", keys: ["bias", "size"], channelCount: 3, scopeName: "scope_" + name,
        getLocal: (k) => vals[k], apply: (k, v) => { vals[k] = v; },
        rack: {
            channels: 3,
            ring: () => "ring_" + name,
            genState: () => ({ alive: gen.alive, fb: gen.fb }),
            send: (n, v) => sent.push([n, v])
        }
    }, world.env(dp));
    spl.splNoteScope("scope_" + name);
    return { link, gen, sent, dp, name };
}

function rackTick(world, list, ms, n) {
    for (let i = 0; i < (n || 1); i++) {
        world.time += ms || 100;
        for (const x of list) {
            if (x.gen.run) x.gen.alive += 1;
            x.link.tick();
        }
    }
}

const lastOf = (inst, name) => { for (let i = inst.sent.length - 1; i >= 0; i--) if (inst.sent[i][0] === name) return inst.sent[i][1]; return undefined; };

function runRackLinkTests() {
    const R = "live_set tracks 0 devices 0";
    const w = makeWorld();
    w.racks[R] = 3;
    const A = makeRackInstance(w, R + " chains 0 devices 0", "A");
    const B = makeRackInstance(w, R + " chains 1 devices 0", "B");
    const C = makeRackInstance(w, R + " chains 2 devices 0", "C");
    const all = [A, B, C];
    for (const x of all) x.link.init();
    rackTick(w, all, 100, 5);
    for (const x of all) {
        assert.strictEqual(x.link.rack.state().role, 0, "no running gen, no leader: role 0");
        assert.strictEqual(lastOf(x, "role"), 0);
    }
    // B's gen starts first: it leads
    B.gen.run = true;
    rackTick(w, all, 100, 6);
    assert.strictEqual(B.link.rack.state().role, 1, "the first running gen leads");
    assert.strictEqual(lastOf(B, "serve"), 7, "the leader serves every channel when there are peers");
    assert.strictEqual(A.link.rack.state().role, 2, "A's gen is not running yet but it is told to follow B, so its gen follows from its first sample");
    assert.strictEqual(lastOf(A, "lead"), "ring_B");
    const ep1 = B.link.rack.state().epoch;
    assert.ok(ep1 >= 1);
    // A and C start: they follow B (A has the lower chain index but leadership is sticky)
    A.gen.run = true;
    C.gen.run = true;
    rackTick(w, all, 100, 6);
    for (const x of [A, C]) {
        const st = x.link.rack.state();
        assert.strictEqual(st.role, 2, `${x.name} follows`);
        assert.strictEqual(lastOf(x, "lead"), "ring_B", `${x.name} reads the leader's ring`);
        assert.strictEqual(lastOf(x, "epoch"), ep1);
        assert.strictEqual(lastOf(x, "serve"), 0);
        assert.strictEqual(x.link.rack.displayScope(), "scope_B", "followers draw the leader's scope");
    }
    assert.strictEqual(B.link.rack.state().role, 1, "the leader stays");
    assert.strictEqual(B.link.rack.displayScope(), "", "the leader draws its own scope");
    // everything is re-sent every 2 s (a deferred gen drops messages until it runs)
    const nBefore = A.sent.length;
    rackTick(w, all, 500, 5);
    assert.ok(A.sent.length > nBefore, "messages are repeated");
    assert.deepStrictEqual(A.link.rack.messages().map((m) => m[0]), ["lead", "epoch", "serve", "role"]);

    // the leader's gen stops: after the 1.5 s ready timeout A (lowest chain among the ready ones) leads, C follows A with a new epoch
    B.gen.run = false;
    rackTick(w, all, 100, 25);
    assert.strictEqual(A.link.rack.state().role, 1, "A takes over");
    assert.strictEqual(C.link.rack.state().role, 2);
    assert.strictEqual(lastOf(C, "lead"), "ring_A");
    assert.ok(lastOf(C, "epoch") > ep1, "a new leader is a new epoch");
    assert.strictEqual(B.link.rack.state().role, 2, "the stopped instance now points at the new leader");
    B.gen.run = true;
    rackTick(w, all, 100, 6);
    assert.strictEqual(A.link.rack.state().role, 1, "B coming back does not take the lead");

    // a follower reports its leader dead (fb 2): the election does not wait for a stale heartbeat
    const epA = A.link.rack.state().epoch;
    C.gen.fb = 2;
    rackTick(w, all, 100, 4);
    const nl = [A, B, C].filter((x) => x.link.rack.state().role === 1);
    assert.strictEqual(nl.length, 1, "exactly one leader");
    assert.ok(nl[0].link.rack.state().epoch > epA, "the epoch grew");
    assert.notStrictEqual(nl[0], A, "the leader reported dead is replaced");
    C.gen.fb = 0;
    rackTick(w, all, 100, 4);

    // fb 1 (input differs): private, role 0, never elected
    const leader = [A, B, C].find((x) => x.link.rack.state().role === 1);
    const follower = [A, B, C].find((x) => x !== leader);
    follower.gen.fb = 1;
    rackTick(w, all, 100, 4);
    assert.strictEqual(follower.link.rack.state().role, 0, "a follower whose input differs computes alone");
    leader.gen.run = false;
    rackTick(w, all, 100, 25);
    assert.notStrictEqual(follower.link.rack.state().role, 1, "a private instance is never elected");
    follower.gen.fb = 0;
    leader.gen.run = true;

    // outside a rack: role 0, nothing to follow
    const S = makeRackInstance(w, "live_set tracks 4 devices 0", "S");
    S.gen.run = true;
    S.link.init();
    rackTick(w, [S], 100, 6);
    assert.strictEqual(S.link.rack.state().role, 0);
    assert.strictEqual(lastOf(S, "role"), 0);
    assert.strictEqual(lastOf(S, "serve"), 0);

    // a lone instance in a rack leads and serves only itself (the gen ORs in its own output channel)
    const w3 = makeWorld();
    w3.racks[R] = 2;
    const L = makeRackInstance(w3, R + " chains 0 devices 0", "L");
    L.gen.run = true;
    L.link.init();
    rackTick(w3, [L], 100, 6);
    assert.strictEqual(L.link.rack.state().role, 1);
    assert.strictEqual(lastOf(L, "serve"), 0, "a lone leader serves only its own channel");
    // a deleted leader (no heartbeat) is replaced after the stale timeout
    const M = makeRackInstance(w3, R + " chains 1 devices 0", "M");
    M.gen.run = true;
    M.link.init();
    rackTick(w3, [L, M], 100, 8);
    assert.strictEqual(M.link.rack.state().role, 2);
    L.link.dispose();
    L.gen.run = false;
    rackTick(w3, [M], 200, 30);
    assert.strictEqual(M.link.rack.state().role, 1, "the survivor leads when the leader's chain is deleted");
    return true;
}

function runLinkTests() {
    // ---- path parsing ----
    let c = spl.splParseRackContext("live_set tracks 0 devices 1 chains 2 devices 0");
    assert.deepStrictEqual([c.isInRack, c.parentRackPath, c.chainIndex, c.deviceIndex, c.nestingDepth], [true, "live_set tracks 0 devices 1", 2, 0, 1]);
    c = spl.splParseRackContext('"live_set tracks 3 devices 0 chains 1 devices 2 chains 0 devices 0"');
    assert.deepStrictEqual([c.isInRack, c.parentRackPath, c.chainIndex, c.nestingDepth], [true, "live_set tracks 3 devices 0 chains 1 devices 2", 0, 2], "nested rack: the immediate parent rack");
    c = spl.splParseRackContext("live_set tracks 0 devices 4");
    assert.strictEqual(c.isInRack, false);
    assert.strictEqual(c.deviceIndex, 4);
    assert.strictEqual(spl.splParseRackContext("").isInRack, false);

    const R = "live_set tracks 0 devices 0";
    const w = makeWorld();
    w.racks[R] = 2;
    const A = makeInstance(w, "tk", R + " chains 0 devices 0", { bias: 10 });
    const B = makeInstance(w, "tk", R + " chains 1 devices 0", { bias: -30 });

    // ---- first instance publishes, second adopts ----
    A.link.init();
    assert.strictEqual(A.applied.length, 0, "the first instance applies nothing");
    B.link.init();
    assert.deepStrictEqual(B.applied.map((a) => a[0]).sort(), ["bias", "size", "tilt"], "the second instance adopts every group value");
    assert.strictEqual(B.vals.bias, 10, "adopted the first instance's bias");
    assert.strictEqual(A.link.info().autoChannel, 0);
    assert.strictEqual(B.link.info().autoChannel, 1);
    assert.strictEqual(B.link.info().chainCount, 2, "chain count comes from the rack's LOM chains");
    tick(w, [A, B]);
    tick(w, [A, B], 600);
    assert.strictEqual(A.link.info().peers, 2);
    assert.strictEqual(A.link.info().linked, true);
    assert.ok(A.infos.length >= 2, "onInfo fires when the link state changes");

    // ---- a change propagates once and never loops ----
    A.applied.length = 0;
    B.applied.length = 0;
    A.vals.bias = 55;
    A.link.notify("bias", 55);
    const counterAfterPublish = w.store.spectral_split_bus.groups["tk::" + R].counter;
    tick(w, [A, B]);
    assert.deepStrictEqual(B.applied, [["bias", 55]], "peer applies the new value exactly once");
    assert.deepStrictEqual(A.applied, [], "the writer does not re-apply its own value");
    assert.strictEqual(w.store.spectral_split_bus.groups["tk::" + R].counter, counterAfterPublish, "applying a remote value does not publish");
    tick(w, [A, B]);
    tick(w, [A, B]);
    assert.strictEqual(B.applied.length, 1, "no repeat on later polls");

    // ---- a repeat of the value the bus already holds does not bump the version ----
    A.link.notify("bias", 55);
    assert.strictEqual(w.store.spectral_split_bus.groups["tk::" + R].counter, counterAfterPublish, "same value again: no new version");

    // ---- last writer wins, both converge ----
    A.link.notify("tilt", 20);
    A.vals.tilt = 20;
    B.link.notify("tilt", -40);
    B.vals.tilt = -40;
    tick(w, [A, B]);
    tick(w, [A, B]);
    assert.strictEqual(A.vals.tilt, B.vals.tilt, "the instances agree after conflicting writes");
    assert.strictEqual(A.vals.tilt, -40, "the newest write wins");

    // ---- keys that are not linked are ignored ----
    const before = JSON.stringify(w.store.spectral_split_bus.groups["tk::" + R]);
    A.link.notify("output", 3);
    assert.strictEqual(JSON.stringify(w.store.spectral_split_bus.groups["tk::" + R]), before, "Output is not linked");

    // ---- before init and after dispose notify does nothing ----
    const D = makeInstance(w, "tk", R + " chains 0 devices 0");
    D.link.notify("bias", 99);
    assert.strictEqual(w.store.spectral_split_bus.groups["tk::" + R].params.bias.v, 55, "notify before init is ignored");

    // ---- chain count clamp for Auto with more chains than channels ----
    w.racks[R] = 3;
    const E = makeInstance(w, "tk", R + " chains 2 devices 0");
    E.link.init();
    assert.strictEqual(E.link.autoChannel(), 1, "Auto clamps to the last channel");
    assert.strictEqual(E.link.info().chainCount, 3);
    E.link.dispose();

    // ---- late join adopts the newest values ----
    const F = makeInstance(w, "tk", R + " chains 1 devices 0", { bias: 0, tilt: 0 });
    F.link.init();
    assert.strictEqual(F.vals.bias, 55);
    assert.strictEqual(F.vals.tilt, -40);
    F.link.dispose();

    // ---- kinds never mix, outside a rack nothing links ----
    const K = makeInstance(w, "other", R + " chains 0 devices 0", { bias: 77 });
    K.link.init();
    assert.strictEqual(K.applied.length, 0, "another device kind has its own group");
    assert.strictEqual(A.vals.bias, 55);
    const S1 = makeInstance(w, "tk", "live_set tracks 5 devices 0", { bias: 1 });
    const S2 = makeInstance(w, "tk", "live_set tracks 6 devices 0", { bias: 2 });
    S1.link.init();
    S2.link.init();
    assert.strictEqual(S1.link.autoChannel(), -1, "Auto outside a rack means all channels");
    assert.strictEqual(S1.link.info().linked, false);
    S1.link.notify("bias", 9);
    tick(w, [S1, S2]);
    assert.strictEqual(S2.vals.bias, 2, "solo instances do not link");

    // ---- peers leave: the link state follows, and a rebuilt rack does not inherit stale values ----
    B.link.dispose();
    A.link.dispose();
    D.link.dispose();
    w.time += 10000;
    const G = makeInstance(w, "tk", R + " chains 0 devices 0", { bias: 3 });
    G.link.init();
    assert.strictEqual(G.applied.length, 0, "a group with no live peer starts afresh");
    assert.strictEqual(w.store.spectral_split_bus.groups["tk::" + R].params.bias.v, 3);
    const H = makeInstance(w, "tk", R + " chains 1 devices 0");
    H.link.init();
    tick(w, [G, H], 600);
    assert.strictEqual(G.link.info().peers, 2);
    H.link.dispose();
    w.time += 4000;
    G.link.tick();
    assert.strictEqual(G.link.info().peers, 1, "a peer without heartbeat drops out");
    assert.strictEqual(G.link.info().linked, false);
    G.link.dispose();

    // ---- a device moved to another rack leaves the old group ----
    const w2 = makeWorld();
    w2.racks["live_set tracks 0 devices 0"] = 2;
    w2.racks["live_set tracks 1 devices 0"] = 2;
    const P = makeInstance(w2, "tk", "live_set tracks 0 devices 0 chains 0 devices 0", { bias: 5 });
    const Q = makeInstance(w2, "tk", "live_set tracks 1 devices 0 chains 0 devices 0", { bias: 6 });
    P.link.init();
    Q.link.init();
    assert.notStrictEqual(P.link.info().groupKey, Q.link.info().groupKey);
    Q.dp.value = "live_set tracks 0 devices 0 chains 1 devices 0";
    tick(w2, [P, Q], 600);
    assert.strictEqual(Q.link.info().groupKey, P.link.info().groupKey, "moved into P's rack");
    assert.strictEqual(Q.vals.bias, 5, "and adopted its values");
    assert.strictEqual(Q.link.info().chainIndex, 1);
    P.link.dispose();
    Q.link.dispose();
    runRackLinkTests();
    return true;
}

module.exports = { runLinkTests, runRackLinkTests };

if (require.main === module) {
    runLinkTests();
    console.log("spectral_link tests passed");
}
