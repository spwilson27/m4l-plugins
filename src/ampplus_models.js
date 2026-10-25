// Seven NAM captures, one per Ableton Amp type. Files live next to the device
// in devices/ampplus_models/ and stay under GPL-3.0 (see COPYING and NOTICE.json).
var AMP_MODELS = [
    { type: "Clean", file: "ampplus_models/clean.nam", capture: "Twin Verb", credit: "Tim R", source: "Tim R Fender TwinVerb Norm Bright.nam" },
    { type: "Boost", file: "ampplus_models/boost.nam", capture: "AC15 Top Boost", credit: "Phillipe P", source: "Phillipe P VOXAC15-TopBoost.nam" },
    { type: "Blues", file: "ampplus_models/blues.nam", capture: "King Kong 60s", credit: "George B", source: "George B Ceriatone King Kong Channel 1 60s mode.nam" },
    { type: "Rock", file: "ampplus_models/rock.nam", capture: "JCM2000 Crunch", credit: "Tim R", source: "Tim R JCM2000 Crunch.nam" },
    { type: "Lead", file: "ampplus_models/lead.nam", capture: "Mark IV", credit: "Roman A", source: "Roman A LT_MESA_MARKIV_1.nam" },
    { type: "Heavy", file: "ampplus_models/heavy.nam", capture: "5150", credit: "Helga B", source: "Helga B 5150 BlockLetter - NoBoost.nam" },
    { type: "Bass", file: "ampplus_models/bass.nam", capture: "dUg Bass Pre", credit: "Jason Z", source: "Jason Z Tech21 dUg DP3X bass preamp pedal all dimed no shift.nam" }
];

function ampStep(index, direction, count) {
    var n = index + direction;
    var total = count || AMP_MODELS.length;
    if (n < 0) n = total - 1;
    if (n >= total) n = 0;
    return n;
}

// Export through a local so this file stays a global script for the type checker (see AGENTS.md 1c).
var nodeModule = (typeof module !== "undefined") ? module : undefined;
if (nodeModule && nodeModule.exports) {
    nodeModule.exports = { AMP_MODELS: AMP_MODELS, ampStep: ampStep };
}
