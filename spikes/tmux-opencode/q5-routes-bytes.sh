#!/bin/bash
# Q5 (bytes): what each tmux route writes to the pane's input, for a pane with ?2004 on and one with it off.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-q5b; export SOCK
O="$SPIKE_DIR/q5b"; mkdir -p "$O"; rm -f "$O"/*; T kill-server 2>/dev/null; sleep 0.3
TXT='say ok'; HEX=$(printf '\e[200~%s\e[201~' "$TXT" | xxd -p | sed 's/../& /g')
for mode in on off; do
  s=p$mode; [ $mode = on ] && m=2004 || m=
  T new-session -d -s $s "python3 $HERE/input-log.py $O/$s.txt 30 $m"; sleep 1
  echo "## pane ?2004 $mode  (bracketed_paste flag: $(T display -p -t $s '#{pane_bracketed_paste}' 2>&1))" >> $O/$s.cmds
  T send-keys -t $s -l $'\e[200~'"$TXT"$'\e[201~'; sleep 0.3; T send-keys -t $s Enter; sleep 1
  T send-keys -t $s -H $HEX; sleep 0.3; T send-keys -t $s Enter; sleep 1
  T set-buffer -b spike "$TXT"; T paste-buffer -p -t $s -b spike; sleep 0.3; T send-keys -t $s Enter; sleep 1
  T paste-buffer -t $s -b spike; sleep 0.3; T send-keys -t $s Enter; sleep 1                       # without -p
  T set-buffer -b spike2 $'line1\nline2'; T paste-buffer -p -t $s -b spike2; sleep 1             # multi-line, -p
  T paste-buffer -t $s -b spike2; sleep 1                                                         # multi-line, no -p (LF->CR)
done
for s in pon poff; do cat $O/$s.cmds; cat $O/$s.txt; done
echo "routes in order: send-keys -l | Enter | send-keys -H | Enter | paste-buffer -p | Enter | paste-buffer | Enter | paste-buffer -p multi | paste-buffer multi"
T kill-server
