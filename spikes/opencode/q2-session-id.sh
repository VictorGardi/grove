#!/usr/bin/env bash
# Q2: does `opencode -s <client-generated ses_ id>` create a session with that exact id, and when?
# Usage: q2-session-id.sh <phase>   phase = launch | check <id> | send <text> | wrong
set -u; source "$(dirname "$0")/common.sh"
P="$SPIKE_SCRATCH/proj-q2"; mkdir -p "$P"
case "$1" in
launch)
  ID=$(node "$(dirname "$0")/gen-session-id.js"); echo "ID=$ID" | tee "$SPIKE_SCRATCH/q2-id.txt"
  $T new-session -d -s q2 -x 160 -y 45 -c "$P" "opencode -s $ID"
  sleep 8; screen q2 | tail -15 ;;
check)
  ID=$2
  echo "--- opencode api GET /api/session/$ID"; opencode api GET "/api/session/$ID" 2>&1 | head -c 1500; echo
  echo "--- sqlite session_v2"; dbq "select id,title,directory,time_created from session_v2 where id='$ID';"
  echo "--- opencode session list (grep)"; (cd "$P" && opencode session list) 2>&1 | grep -F "$ID" || echo "(not listed)" ;;
send)
  $T send-keys -t q2 -l "$2"; sleep 0.5; $T send-keys -t q2 Enter; sleep 20; screen q2 | tail -20 ;;
wrong)
  $T new-session -d -s q2w -x 160 -y 45 -c "$P" "opencode -s foo123; echo EXIT=\$?; sleep 600"
  sleep 8; screen q2w | tail -15 ;;
loose)
  $T new-session -d -s q2l -x 160 -y 45 -c "$P" "opencode -s ses_grovespike1"
  sleep 8; $T send-keys -t q2l -l "reply with the single word ok"; sleep 0.5; $T send-keys -t q2l Enter; sleep 15; screen q2l | tail -12 ;;
esac
# Variant: "ses"-prefixed id that does not follow the time+random layout.
# Run: q2-session-id.sh loose   then  q2-session-id.sh check ses_grovespike1
