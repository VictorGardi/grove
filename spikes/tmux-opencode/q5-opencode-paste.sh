#!/bin/bash
# Q5: bracketed paste + Enter into the OpenCode TUI by each tmux route. Causes 3 model turns ("say ok").
# Composer-only checks run in throwaway TUIs that never submit.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-q5; export SOCK
O="$SPIKE_DIR/q5"; P="$SPIKE_DIR/proj"; mkdir -p "$O" "$P"; rm -f "$O"/*; T kill-server 2>/dev/null; sleep 0.3
E="-e COLORTERM=truecolor -e FORCE_COLOR=3"; TXT='say ok'
HEX=$(printf '\e[200~%s\e[201~' "$TXT" | xxd -p | sed 's/../& /g')
start() { T new-session -d -s "$1" -x 100 -y 30 -c "$P" $E "sleep 1; exec opencode $P"; sleep 10;
  echo "[$1] pane flags: alt=$(T display -p -t $1 '#{alternate_on}')"; }
comp() { T capture-pane -p -t "$1" > "$O/$2.txt"; echo "--- $2 (composer region)"; grep -n -E '┃' "$O/$2.txt" | head -8; }
# composer-only checks (no Enter)
start c1; T set-buffer -b ml $'line1\nline2\nline3'; T paste-buffer -p -t c1 -b ml; sleep 1; comp c1 c1-paste-p-multiline
T send-keys -t c1 -l $'\e[200~'"$TXT"$'\e[201~'; sleep 1; comp c1 c1-then-sendkeys-l
T kill-session -t c1
start c2; T set-buffer -b one "$TXT"; T paste-buffer -t c2 -b one; sleep 1; comp c2 c2-paste-no-p
T send-keys -t c2 -l "$TXT"; sleep 1; comp c2 c2-then-sendkeys-l-unbracketed
T kill-session -t c2
# submissions in one TUI
start s
T send-keys -t s -l $'\e[200~'"$TXT (route send-keys -l)"$'\e[201~'; sleep 1; comp s s1-before-enter
T send-keys -t s Enter; sleep 20; comp s s1-after-enter
T send-keys -t s -H $(printf '\e[200~%s\e[201~' "$TXT (route send-keys -H)" | xxd -p | sed 's/../& /g'); sleep 1; comp s s2-before-enter
T send-keys -t s Enter; sleep 20; comp s s2-after-enter
T set-buffer -b r3 "$TXT (route paste-buffer -p, Enter chained)"; T paste-buffer -p -t s -b r3 \; send-keys -t s Enter; sleep 20; comp s s3-after-enter
T capture-pane -p -t s -S - > "$O/s-final.txt"
cd "$P" && opencode session list > "$O/sessions.txt" 2>&1; cat "$O/sessions.txt"
