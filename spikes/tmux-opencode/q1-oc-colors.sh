#!/bin/bash
# Q1 (colours): OpenCode TUI with no pane style vs a light pane style; when it re-sends OSC 10/11 queries.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-occ; export SOCK
O="$SPIKE_DIR/q1occ"; mkdir -p "$O" "$SPIKE_DIR/proj"; rm -f "$O"/*; T kill-server 2>/dev/null; sleep 0.3
E="-e COLORTERM=truecolor -e FORCE_COLOR=3"
T new-session -d -s x -c "$SPIKE_DIR/proj" $E "sleep 1; exec opencode $SPIKE_DIR/proj"
T pipe-pane -O -t x "python3 $HERE/pane-ts.py $O/x.ts"
T new-session -d -s y -c "$SPIKE_DIR/proj" $E "sleep 1; exec opencode $SPIKE_DIR/proj"
T select-pane -t y -P 'fg=#000000,bg=#ffffff'
T new-session -d -s z -c "$SPIKE_DIR/proj" -e FORCE_COLOR=3 "sleep 1; exec opencode $SPIKE_DIR/proj"   # no COLORTERM
sleep 12
for s in x y z; do T capture-pane -p -e -t $s > "$O/$s.cap-e.txt"
  echo "$s: top bg/fg SGRs: $(grep -o '\[[0-9;]*m' "$O/$s.cap-e.txt" | sort | uniq -c | sort -rn | head -4 | tr -s ' \n' ' ')"; done
echo "-- x: OSC 10/11 queries before attach:"; grep -o '+[0-9.]*s\].\{0,0\}' "$O/x.ts" >/dev/null; grep -n '\]1[01];?' "$O/x.ts" | cut -c1-20
node attach-logger.js "$O/att-x" x 5000 --answer > "$O/att-x.sum"; sleep 1
echo "-- x: OSC 10/11 queries after attach/detach:"; grep -n '\]1[01];?' "$O/x.ts" | cut -c1-20
T capture-pane -p -e -t x > "$O/x-after.cap-e.txt"
echo "x after answered attach: $(grep -o '\[[0-9;]*m' "$O/x-after.cap-e.txt" | sort | uniq -c | sort -rn | head -4 | tr -s ' \n' ' ')"
T pipe-pane -t x
