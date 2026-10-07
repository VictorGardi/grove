#!/usr/bin/env bash
# Q3 (HTTP view): run `opencode --server <logging proxy -> private server> --prompt <text>`
# and print every HTTP request the TUI made (from proxy.log). Needs: private-server.sh start; private-server.sh proxy
# Usage: q3-private-http.sh <case> <prompt-text>
set -u; source "$(dirname "$0")/common.sh"
P="$SPIKE_SCRATCH/proj-q3"; LOGF="$HOME/.local/share/opencode/log/opencode.log"
PSTART=$(( $(wc -l < "$SPIKE_SCRATCH/proxy.log" 2>/dev/null || echo 0) + 1 ))
TUI_PORT=49498 "$(dirname "$0")/private-server.sh" tui "p3$1" "$P" "$2"
sleep 25
echo "--- screen"; screen "p3$1" | head -8
echo "--- HTTP via logging proxy"; sed -n "${PSTART:-1},\$p" "$SPIKE_SCRATCH/proxy.log"
