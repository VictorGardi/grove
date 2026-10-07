#!/bin/bash
# Q1: what tmux writes to a pane that enabled ?2031 (colour-change notify) and ?1004 (focus) on attach/detach,
# with server option focus-events off (default) and then on.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-2031; export SOCK
O="$SPIKE_DIR/q1-2031"; mkdir -p "$O"; rm -f "$O"/*; T kill-server 2>/dev/null; sleep 0.3
T new-session -d -s n "python3 $HERE/input-log.py $O/n.txt 20 2031 1004"
T new-session -d -s f "python3 $HERE/input-log.py $O/f.txt 20 2031 1004"
echo "focus-events=$(T show -sv focus-events)"
sleep 2; node attach-logger.js "$O/att-n1" n 3000 --answer >/dev/null       # ~2-5s
node attach-logger.js "$O/att-n2" n 3000 >/dev/null                         # ~6-9s, client silent
T set -s focus-events on; node attach-logger.js "$O/att-f1" f 3000 --answer >/dev/null   # ~10-13s
sleep 8; echo "-- n (focus-events off)"; cat $O/n.txt; echo "-- f (focus-events on)"; cat $O/f.txt
for f in n1 n2 f1; do echo "att-$f ?1004h count: $(grep -o '?1004h' $O/att-$f.esc | wc -l)"; done
