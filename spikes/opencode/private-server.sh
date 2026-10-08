#!/usr/bin/env bash
# Start/stop a PRIVATE opencode server (not the shared service) on port 49499 with debug logs,
# so every HTTP request the TUI makes is visible. Password is random per run, kept in a 0600 file in scratch.
# Usage: private-server.sh start | stop | tui <tmux-name> <dir> <prompt>
set -u; source "$(dirname "$0")/common.sh"
PORT=49499; PWF="$SPIKE_SCRATCH/private-pw"; LOG="$SPIKE_SCRATCH/private-server.log"
case "$1" in
start)
  umask 077; [ -f "$PWF" ] || openssl rand -hex 16 > "$PWF"
  $T new-session -d -s privsrv -c "$SPIKE_SCRATCH" "OPENCODE_PASSWORD=\$(cat $PWF) opencode serve --hostname 127.0.0.1 --port $PORT --log-level debug --print-logs 2> $LOG"
  sleep 4; tail -3 "$LOG" | cut -c1-200 ;;
stop) $T kill-session -t privsrv; $T kill-session -t proxy ;;
proxy) $T new-session -d -s proxy "node $(cd "$(dirname "$0")" && pwd)/logging-proxy.js 49498 $PORT > $SPIKE_SCRATCH/proxy.log 2>&1" ;;
tui)
  $T new-session -d -s "$2" -x 160 -y 45 -c "$3" "OPENCODE_PASSWORD=\$(cat $PWF) opencode --server http://127.0.0.1:${TUI_PORT:-$PORT} --prompt '$4'" ;;
esac
# proxy: run logging-proxy.js in tmux window "proxy"; TUI_PORT=49498 private-server.sh tui ... goes through it.
