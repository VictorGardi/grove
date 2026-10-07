#!/usr/bin/env bash
# Capture the raw /api/event SSE stream of the shared service (127.0.0.1:49374) into a file.
# Usage: sse-capture.sh start <outfile>  -> prints pid ; sse-capture.sh stop <pid>
set -u
case "$1" in
start)
  ( PW=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.local/state/opencode/service.json')))['password'])")
    exec curl -sN -u "opencode:$PW" http://127.0.0.1:49374/api/event > "$2" ) >/dev/null 2>&1 &
  echo $! ;;
stop) kill "$2" ;;
esac
