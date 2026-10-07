#!/bin/bash
# Q1 (colour depth to client): SGR forms tmux sends to a node-pty client with and without COLORTERM in its env.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-crgb; export SOCK
O="$SPIKE_DIR/q1crgb"; mkdir -p "$O"; rm -f "$O"/*; T kill-server 2>/dev/null; sleep 0.3
T new-session -d -s oc -c "$SPIKE_DIR/proj" -e COLORTERM=truecolor -e FORCE_COLOR=3 "sleep 1; exec opencode $SPIKE_DIR/proj"
sleep 8
( sleep 1.5; T list-clients -F 'no-colorterm client: termname=#{client_termname} features=#{client_termfeatures}' ) &
node attach-logger.js "$O/a" oc 3000; wait
( sleep 1.5; T list-clients -F 'COLORTERM client: termname=#{client_termname} features=#{client_termfeatures}' ) &
node attach-logger.js "$O/b" oc 3000 --colorterm; wait
T kill-server
