#!/bin/bash
# Q1 (OSC 10/11): what tmux answers to a pane's colour queries, detached vs attached, with/without pane style.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-osc; export SOCK
O="$SPIKE_DIR/q1osc"; mkdir -p "$O"; rm -f "$O"/*; T kill-server 2>/dev/null; sleep 0.3
P="$HERE/osc-probe.py"
T new-session -d -s a "python3 $P $O/a.txt 1"                      # detached, no style
T new-session -d -s b "sleep 0.5; python3 $P $O/b.txt 1"; T select-pane -t b -P 'fg=#d4d4d4,bg=#1e1e1e'  # detached, pane style
T new-session -d -s c "python3 $P $O/c.txt 3 9"                    # attached (client answers) at 3s, detached at 9s
T new-session -d -s e "python3 $P $O/e.txt 3 9"                    # attached (client silent) at 3s, detached at 9s
node attach-logger.js "$O/att-c" c 5000 --answer > "$O/att-c.sum" &
node attach-logger.js "$O/att-e" e 5000 > "$O/att-e.sum" &
sleep 12
for f in a b c e; do echo "-- $f"; cat "$O/$f.txt"; done
grep -h -o 'answered OSC1[01]' "$O"/att-c.esc | sort | uniq -c
T show -p -t b window-style 2>&1; T display -p -t b '#{pane_style}' 2>&1; T show -p -t b 2>&1 | head
