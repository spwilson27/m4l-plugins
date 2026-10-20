#!/bin/zsh
# Restart the separate Live 12 Suite instance that hosts delayplus_test.als (never touches other
# Live instances): quits the Live process whose command line names the test set, relaunches it
# with `open -n`, and waits for its MCP bridge. Prints the bridge port.
SET="${1:-$(cd "$(dirname "$0")/.." && pwd)/delayplus_test.als}"
PID=$(pgrep -f "MacOS/Live $SET")
if [ -n "$PID" ]; then
  kill $PID
  for i in $(seq 1 40); do kill -0 $PID 2>/dev/null || break; sleep 0.5; done
  kill -0 $PID 2>/dev/null && kill -9 $PID
fi
before=$(node "$(dirname "$0")/ableton_mcp_server.js" --list-sessions 2>/dev/null | python3 -c "import json,sys; print(' '.join(str(s['port']) for s in json.load(sys.stdin)['sessions']))")
open -n -a "Ableton Live 12 Suite" --args "$SET"
for i in $(seq 1 60); do
  sleep 2
  now=$(node "$(dirname "$0")/ableton_mcp_server.js" --list-sessions 2>/dev/null | python3 -c "import json,sys; print(' '.join(str(s['port']) for s in json.load(sys.stdin)['sessions']))")
  for p in ${=now}; do
    if [[ " $before " != *" $p "* ]]; then echo $p; exit 0; fi
  done
done
echo "bridge did not come up" >&2; exit 1
