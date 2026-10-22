// Structural check of a shipped Delay+ / Reverb+ rack preset (.adg = gzipped XML):
//   chain "<name>" = [Start .amxd] [nested Audio Effect Rack with ONE EMPTY chain] [End .amxd, folded].
const assert = require("assert");
const fs = require("fs");
const zlib = require("zlib");

// Child elements of `tag`'s direct children are found by a tiny depth-aware scan (no XML dependency).
function checkRackPreset(file, name, start, end) {
    const x = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8");
    const a = x.indexOf("<BranchPresets>");
    const b = x.indexOf("<DevicePresets>", a);
    let c = b + 1, lvl = 1;  // matching close of the outer <DevicePresets>
    for (const mm of x.slice(b + 15).matchAll(/<DevicePresets>|<\/DevicePresets>/g)) {
        lvl += mm[0][1] === "/" ? -1 : 1;
        if (lvl === 0) { c = b + 15 + mm.index; break; }
    }
    const chain = x.slice(b, c);
    // top-level entries of the outer chain, in order
    const tops = [];
    const re = /<(AbletonDevicePreset|GroupDevicePreset)\b[^>]*>|<\/(AbletonDevicePreset|GroupDevicePreset)>/g;
    let depth = 0, m, from = 0, kind = "";
    while ((m = re.exec(chain))) {
        if (m[1]) { if (depth++ === 0) { from = m.index; kind = m[1]; } }
        else if (--depth === 0) tops.push({ kind, xml: chain.slice(from, m.index + m[0].length) });
    }
    assert.strictEqual(tops.length, 3, `${file}: chain holds ${tops.length} entries, want Start + rack + End`);
    assert(tops[0].xml.includes("MxDeviceAudioEffect") && tops[0].xml.includes(start), "first entry is the Start device");
    assert.strictEqual(tops[1].kind, "GroupDevicePreset", "middle entry is a nested rack");
    assert(tops[2].xml.includes("MxDeviceAudioEffect") && tops[2].xml.includes(end), "last entry is the End device");
    // nested rack: an Audio Effect Rack with exactly one chain, and that chain holds no devices
    const rack = tops[1].xml;
    assert(rack.includes("<AudioEffectGroupDevice"), "nested rack is an Audio Effect Rack");
    assert.strictEqual((rack.match(/<AudioEffectBranchPreset\b/g) || []).length, 1, "nested rack has one chain");
    assert(/<DevicePresets>\s*<\/DevicePresets>|<DevicePresets\s*\/>/.test(rack), "the inner chain is empty");
    assert(!rack.includes("<AbletonDevicePreset Id=\"0\"><OverwriteProtectionNumber Value=\"3076\" /><Device><Mx"), "no device inside");
    assert(rack.includes(`<UserName Value="${name} FX" />`), "nested rack is named '<name> FX'");
    assert(/<Name Value="FX" \/>/.test(rack), "inner chain is named FX");
    // folded: the End device only
    const fold = (s) => (s.match(/<IsFolded Value="(\w+)" \/>/) || [])[1];
    assert.strictEqual(fold(tops[2].xml), "true", "End device is folded");
    assert.strictEqual(fold(tops[0].xml), "false", "Start device is not folded");
    return true;
}
module.exports = { checkRackPreset };
