#!/bin/zsh
# Build the MIT neural~ external (https://github.com/apresta/neural_tilde) and
# copy neural~.mxo next to devices/Amp+.amxd. Max finds an external in the
# same folder as the device. Also installs it into Max 9's package folder so
# harness patches, which live in a temp directory, can load it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${NEURAL_TILDE_SRC:-/tmp/neural_tilde}"
if [[ ! -f "$SRC/CMakeLists.txt" ]]; then
  git clone --recursive --depth 1 https://github.com/apresta/neural_tilde.git "$SRC"
fi
ADT="$SRC/deps/NeuralAudio/deps/NeuralAmpModelerCore/Dependencies/AudioDSPTools"
if [[ ! -f "$ADT/dsp/ResamplingContainer/ResamplingContainer.h" ]]; then
  git clone --depth 1 https://github.com/sdatkinson/AudioDSPTools.git "$ADT"
fi
cmake -S "$SRC" -B "$SRC/build" -DSUPERBUILD=OFF -DCMAKE_BUILD_TYPE=Release -DMAX_EXTERNALS_DIR="$SRC/out"
cmake --build "$SRC/build" -j 8
cmake --install "$SRC/build"
MXO="$(find "$SRC/out" -name 'neural~.mxo' -print -quit)"
[[ -n "$MXO" ]] || { echo "neural~.mxo was not produced" >&2; exit 1; }
cp -R "$MXO" "$ROOT/devices/neural~.mxo"
codesign --force --deep --sign - "$ROOT/devices/neural~.mxo"
PKG="$HOME/Documents/Max 9/Packages/neural/externals"
mkdir -p "$PKG"
rm -rf "$PKG/neural~.mxo"
cp -R "$ROOT/devices/neural~.mxo" "$PKG/neural~.mxo"
echo "installed $ROOT/devices/neural~.mxo"
