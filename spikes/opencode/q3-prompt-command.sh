#!/usr/bin/env bash
# Q3: what `opencode --prompt "/<command> <args>"` does for an existing command, a missing one, and plain text.
# Each case: fresh TUI (new session) in a throwaway project with a project-local command; raw SSE captured.
# Usage: q3-prompt-command.sh <case> <prompt-text>     e.g. q3-prompt-command.sh exists "/spike-echo alpha beta"
set -u; source "$(dirname "$0")/common.sh"
P="$SPIKE_SCRATCH/proj-q3"; mkdir -p "$P/.opencode/commands"
cat > "$P/.opencode/commands/spike-echo.md" <<'MD'
---
description: grove spike echo command
---
Reply with exactly the text SPIKE-ECHO followed by: $ARGUMENTS
MD
CASE=$1; TEXT=$2; OUT="$SPIKE_SCRATCH/sse-q3-$CASE.txt"
PID=$("$(dirname "$0")/sse-capture.sh" start "$OUT"); sleep 1
$T new-session -d -s "q3$CASE" -x 160 -y 45 -c "$P" "opencode --prompt '$TEXT'"
sleep 25
echo "--- screen"; screen "q3$CASE" | head -14
kill "$PID"
echo "--- events"; python3 "$(dirname "$0")/sse-summary.py" "$OUT" | grep -v '\.updated  \|delta' 
SID=$(grep -o '"type":"session.created"[^}]*"sessionID":"ses_[^"]*' "$OUT" | grep -o 'ses_[A-Za-z0-9]*' | head -1)
[ -z "$SID" ] && SID=$(grep -o 'ses_[A-Za-z0-9]\{26\}' "$OUT" | head -1)
echo "--- session $SID"; opencode api GET "/api/session/$SID" | head -c 600; echo
echo "--- messages (user text)"; opencode api GET "/api/session/$SID/message" | python3 -c '
import sys,json
for m in reversed(json.load(sys.stdin)["data"]):
  t=m.get("text") or " ".join(p.get("text","") for p in m.get("content",[]) if p.get("type")=="text")
  print(m["type"], "|", (t or "")[:300].replace("\n"," / "), "|", m.get("error",{}).get("message","") if m.get("error") else "")'
