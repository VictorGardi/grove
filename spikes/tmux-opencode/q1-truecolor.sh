#!/bin/bash
# Q1 (colour depth): which SGR colour forms OpenCode writes into the pane with/without COLORTERM and FORCE_COLOR.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-tc; export SOCK
O="$SPIKE_DIR/q1tc"; mkdir -p "$O"; rm -f "$O"/*; T kill-server 2>/dev/null; sleep 0.3
T new-session -d -s none -c "$SPIKE_DIR/proj" "sleep 1; exec opencode $SPIKE_DIR/proj"
T new-session -d -s fc -c "$SPIKE_DIR/proj" -e FORCE_COLOR=3 "sleep 1; exec opencode $SPIKE_DIR/proj"
T new-session -d -s ct -c "$SPIKE_DIR/proj" -e COLORTERM=truecolor "sleep 1; exec opencode $SPIKE_DIR/proj"
for s in none fc ct; do T pipe-pane -O -t $s "cat > $O/$s.raw"; done
sleep 10
for s in none fc ct; do printf '%-5s env-COLORTERM=%s  38;2/48;2 in output=%s  38;5/48;5=%s\n' $s "$(T show-environment -t $s COLORTERM 2>&1)" \
  "$(grep -ao '\[[0-9;]*[34]8;2;' $O/$s.raw | wc -l | tr -d ' ')" "$(grep -ao '\[[0-9;]*[34]8;5;' $O/$s.raw | wc -l | tr -d ' ')"; done
T kill-server
