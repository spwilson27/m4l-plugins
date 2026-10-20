#!/bin/zsh
# Starts the Live Test Bridge extension (tools/live-extension) against Live 12 Beta in Developer
# Mode (Settings -> Extensions -> Developer Mode). It serves 127.0.0.1:9895 (/tree, /reload,
# /insert, /delete) until stopped. Run it in the background or a terminal tab.
cd "$(dirname "$0")/../tools/live-extension" || exit 1
[ -d node_modules ] || npm install --no-audit --no-fund || exit 1
exec npm start
