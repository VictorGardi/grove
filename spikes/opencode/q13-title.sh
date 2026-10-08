#!/usr/bin/env bash
# Q13: session titles. Renames an existing spike session via PATCH /api/session/{id} (shared service),
# and creates a session with an explicit title + id via POST /api/session, then prompts it once.
# Usage: q13-title.sh rename <sid> <title> | regen <sid> | create-titled | prompt <sid> <text> | show <sid>
set -u; source "$(dirname "$0")/common.sh"
P="$SPIKE_SCRATCH/proj-q13"; mkdir -p "$P"
show() { echo "--- GET"; opencode api GET "/api/session/$1" | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print("title=",repr(d.get("title")),"outcome=",d.get("outcome"))'
         echo "--- sqlite"; dbq "select id, quote(title) from session_v2 where id='$1';"; }
case "$1" in
rename) opencode api PATCH "/api/session/$2" -d "{\"title\":\"$3\"}"; show "$2" ;;
regen)  opencode api PATCH "/api/session/$2" -d '{"title":""}'; sleep 8; show "$2" ;;
create-titled)
  ID=$(node "$(dirname "$0")/gen-session-id.js")
  opencode api POST /api/session -d "{\"id\":\"$ID\",\"title\":\"grove spike preset title\",\"location\":{\"directory\":\"$P\"}}" | head -c 400; echo
  show "$ID" ;;
prompt) opencode api POST "/api/session/$2/prompt" -d "{\"text\":\"$3\"}"; sleep 15; show "$2" ;;
show) show "$2" ;;
esac
