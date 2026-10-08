#!/bin/bash
# Q1: OpenCode TUI in a detached tmux session; attach/detach/re-attach with a node-pty client.
# Outputs under $SPIKE_DIR/q1/. Needs sandbox off (tmux socket + opencode log dir).
source "$(dirname "$0")/env.sh"; cd "$HERE"
SOCK=grove-spike; export SOCK; O="$SPIKE_DIR/q1"; mkdir -p "$O" "$SPIKE_DIR/proj"; rm -f "$O"/*
T kill-server 2>/dev/null; sleep 0.3
fl='#{pane_width}x#{pane_height} alt=#{alternate_on} mouse_any=#{mouse_any_flag} std=#{mouse_standard_flag} btn=#{mouse_button_flag} sgr=#{mouse_sgr_flag} utf8=#{mouse_utf8_flag} all=#{mouse_all_flag} focus? bp? clients=#{session_attached} win=#{window_width}x#{window_height}'
snap() { echo "== $1"; T display -p -t oc "$fl"; T capture-pane -p -e -t oc > "$O/$1.cap-e.txt"; T capture-pane -p -t oc > "$O/$1.cap.txt";
  printf '   nonblank lines=%s  RGB SGRs in capture=%s\n' "$(grep -c '[^ ]' "$O/$1.cap.txt")" "$(grep -o '\[[0-9;:]*[34]8;2;' "$O/$1.cap-e.txt" | wc -l | tr -d ' ')"; }
T new-session -d -s oc -c "$SPIKE_DIR/proj" -e COLORTERM=truecolor -e FORCE_COLOR=3 "sleep 1; exec opencode $SPIKE_DIR/proj"
T pipe-pane -O -t oc "cat > $O/pane-output.raw"
echo "default-terminal=$(T show -gv default-terminal) default-size=$(T show -gv default-size) window-size=$(T show -gv window-size)"
sleep 12; snap 1-before-attach
node attach-logger.js "$O/att1" oc 5000; snap 2-after-detach1
sleep 3; snap 3-detached-3s
node attach-logger.js "$O/att2" oc 5000 --answer; snap 4-after-detach2
node attach-logger.js "$O/att3" oc 5000 --cols 100 --rows 30; snap 5-after-detach3
# mid-attach refresh-client: does tmux re-emit mouse modes to a client that is still attached?
( sleep 2; T refresh-client -t "$(T list-clients -F '#{client_name}' | head -1)"; echo "refresh at ~2s" ) &
node attach-logger.js "$O/att4" oc 4500; wait; snap 6-after-detach4
T pipe-pane -t oc
