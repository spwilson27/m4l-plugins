// Shared-lane red test (sweep2 shared F3): paint_bounds_lib must accept move_to at the arc's own start point
// (the correct way to avoid a joining line, used by the XO minimap) and still flag a real join.
const { makeRecorder } = require("./paint_bounds_lib.js");
let fails = 0, checks = 0;
function check(c, m) { checks++; if (!c) { fails++; console.log("FAIL " + m); } }
function run(fn) { const r = makeRecorder(100, 100); r.begin("t"); fn(r.mgraphics); r.end(); return r.bad.slice(); }
const TAU = Math.PI * 2;
check(run(g => { g.move_to(30 + 5, 40); g.arc(30, 40, 5, 0, TAU); g.fill(); }).length === 0, "move_to at arc start (angle 0) flagged");
check(run(g => { g.move_to(30, 40 + 5); g.arc(30, 40, 5, Math.PI / 2, Math.PI); g.stroke(); }).length === 0, "move_to at arc start (angle pi/2) flagged");
check(run(g => { g.move_to(5, 5); g.arc(60, 60, 5, 0, TAU); g.stroke(); }).length > 0, "real join (pending point far from arc start) not flagged");
check(run(g => { g.move_to(5, 5); g.line_to(10, 10); g.arc(60, 60, 5, 0, TAU); g.stroke(); }).length > 0, "arc after line_to elsewhere not flagged");
console.log(`test_paint_bounds_lib: ${checks - fails}/${checks} passed`);
process.exit(fails ? 1 : 0);
