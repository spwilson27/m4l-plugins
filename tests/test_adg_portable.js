// Shared-lane red test (sweep2 shared F1): committed .adg presets must be portable and byte-deterministic:
// no absolute checkout path, no build-time mtime, OriginalFileSize == the committed .amxd it references.
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const dir = path.join(__dirname, "..", "devices");
let fails = 0, checks = 0;
function check(c, m) { checks++; if (!c) { fails++; console.log("FAIL " + m); } }
for (const f of fs.readdirSync(dir).filter(n => n.endsWith(".adg"))) {
  const x = zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8");
  const refs = [...x.matchAll(/<MxPatchRef Id="\d+">\s*<FileRef>[\s\S]*?<\/MxPatchRef>/g)].map(m => m[0]);
  check(refs.length > 0, f + ": no MxPatchRef");
  for (const r of refs) {
    const p = (r.match(/<Path Value="([^"]*)"/) || [])[1] || "";
    const rel = (r.match(/<RelativePath Value="([^"]*)"/) || [])[1] || "";
    const size = +(r.match(/<OriginalFileSize Value="(\d+)"/) || [])[1];
    const mod = +(r.match(/<LastModDate Value="(\d+)"/) || [])[1];
    check(!p.startsWith("/"), f + ": absolute Path baked in: " + p);
    check(!/\/tmp\/|\/Users\//.test(p + rel), f + ": checkout path in reference: " + p + " | " + rel);
    check(mod === 0, f + ": LastModDate is a build-time mtime (" + mod + ")");
    const target = path.resolve(dir, rel.replace(/&amp;/g, "&"));
    if (check(fs.existsSync(target), f + ": RelativePath does not resolve from devices/: " + rel), fs.existsSync(target))
      check(fs.statSync(target).size === size, f + ": OriginalFileSize " + size + " != " + fs.statSync(target).size + " (" + rel + ")");
  }
}
console.log(`test_adg_portable: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
