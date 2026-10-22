/**
 * Shared Live check for the shipped Delay+ / Reverb+ rack presets (devices/Delay+.adg, devices/Reverb+.adg).
 * The test sets carry a track built by the same generator and options as the .adg (scripts/make_delayplus_sets.py
 * `--middle fxrack`, End folded): [Start] [Audio Effect Rack "<name> FX" with one empty chain "FX"] [End, collapsed].
 *
 *   structure  Start first, one nested Audio Effect Rack with exactly 1 chain and no devices, End last
 *   folded     End's view.is_collapsed == 1 (Start's is 0)
 *   link       Start and End see each other (hdr 14 / 15) and L in use (hdr 4) == 0 with the empty inner rack
 *   latency    a Limiter put into the inner chain: L follows its latency_in_samples (a rack counts as its longest chain)
 *   audio      a Core Library loop plays through the chain: the track meter moves
 *
 * env = { evalLom, sleep, check, readHdr, HELPERS, loop }; pair = an entry of the test's `pairs`.
 */
function presetCheck(env, pair, label) {
    const { evalLom, sleep, check, readHdr, HELPERS, loop } = env;
    const tag = `[${label} preset ${pair.path}]`;
    const chainPath = pair.path.replace(/ devices \d+$/, "");
    const trackPath = pair.path.split(" devices ")[0];
    const endIdx = pair.devs.findIndex((d, i) => i > pair.index && d.role === "end");
    check(pair.index === 0 && endIdx === pair.devs.length - 1 && pair.devs.length === 3,
        `${tag} chain is [Start, rack, End]: ${pair.devs.map((d) => d.cls).join(", ")}`);
    const rack = pair.devs[1];
    check(rack && rack.cls === "AudioEffectGroupDevice", `${tag} middle device is an Audio Effect Rack (${rack && rack.name})`);
    if (!rack || endIdx < 0) return;
    const inner = evalLom(`
        var r = new LiveAPI("${chainPath} devices 1");
        var c = new LiveAPI("${chainPath} devices 1 chains 0");
        return { chains: Number(r.getcount("chains")), devices: Number(c.getcount("devices")), name: String(c.get("name")),
                 lat: Number(r.get("latency_in_samples")) };
    `);
    check(inner.chains === 1 && inner.devices === 0, `${tag} nested rack: ${inner.chains} chain "${inner.name}", ${inner.devices} devices`);

    const coll = (i) => evalLom(`return Number(new LiveAPI("${chainPath} devices ${i} view").get("is_collapsed"));`);
    check(coll(endIdx) === 1, `${tag} End device is collapsed (is_collapsed ${coll(endIdx)})`);
    check(coll(0) === 0, `${tag} Start device is expanded (is_collapsed ${coll(0)})`);

    sleep(1500);
    let h = readHdr(pair.hdr);
    check(h[14] === 1 && h[15] === 1, `${tag} link: Start sees End (${h[14]}), End sees Start (${h[15]})`);
    check(h[4] === 0 && inner.lat === 0, `${tag} L in use ${h[4]} == 0 with the empty inner rack`);

    // a Limiter in the inner chain: the rack counts as its longest chain
    const lim = evalLom(`
        new LiveAPI("${chainPath} devices 1 chains 0").call("insert_device", "Limiter", 0);
        var l = new LiveAPI("${chainPath} devices 1 chains 0 devices 0");
        return Number(l.id);
    `);
    for (const look of [2, 0, 1]) {
        evalLom(HELPERS + `param(${lim}, "Lookahead").set("value", ${look}); return 1;`);
        sleep(1500);
        const lat = evalLom(`return Number(new LiveAPI("id ${lim}").get("latency_in_samples"));`);
        h = readHdr(pair.hdr);
        check(h[4] === lat, `${tag} inner Limiter lookahead ${look} (${lat} smp): L in use ${h[4]} == ${lat}`);
    }
    evalLom(`new LiveAPI("${chainPath} devices 1 chains 0").call("delete_device", 0); return 1;`);
    sleep(1500);
    h = readHdr(pair.hdr);
    check(h[4] === 0, `${tag} inner Limiter removed: L in use ${h[4]} == 0`);

    // audio passes through [Start, rack, End]
    const clip = evalLom(`
        var slot = new LiveAPI("${trackPath} clip_slots 0");
        if (Number(slot.get("has_clip")) === 0) {
            try { slot.call("create_audio_clip", ${JSON.stringify(loop)}); } catch (e) { return "no create_audio_clip: " + e; }
        }
        if (Number(slot.get("has_clip")) === 0) return "clip not created";
        new LiveAPI("${trackPath} clip_slots 0 clip").set("looping", 1);
        slot.call("fire");
        return "ok";
    `);
    check(clip === "ok", `${tag} loop clip playing (${clip})`);
    let peak = 0;
    for (let i = 0; i < 12 && peak <= 0.02; i++) {
        sleep(500);
        peak = Math.max(peak, evalLom(`var t = new LiveAPI("${trackPath}"); return Math.max(Number(t.get("output_meter_left")), Number(t.get("output_meter_right")));`));
    }
    check(peak > 0.02, `${tag} audio passes: track meter ${peak.toFixed(3)}`);
    evalLom(`new LiveAPI("${trackPath}").call("stop_all_clips"); return 1;`);
}
module.exports = { presetCheck };
