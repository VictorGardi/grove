#!/bin/bash
# Q8 (part 2): has-session wording with other sessions present; destroy-unattached / exit-empty / exit-unattached
# when a node-pty client attaches then detaches.
source "$(dirname "$0")/env.sh"; cd "$HERE"; SOCK=grove-spike-q8d; export SOCK
run() { local out rc; out=$(T "$@" 2>&1); rc=$?; printf '  $ tmux %s -> rc=%s out=[%s]\n' "$*" "$rc" "$out"; }
srv() { T display -p '#{pid}' >/dev/null 2>&1 && echo "server up" || echo "server gone"; }
T kill-server 2>/dev/null; sleep 0.3
echo "## 1: other session exists, target missing / prefix match"
T new-session -d -s beta 'sleep 600'; T new-session -d -s alphabet 'sleep 600'
run has-session -t alpha; run has-session -t =alpha; run has-session -t =alphabet; run has-session -t nosuch; run has-session -t =nosuch
T kill-server; sleep 0.3
echo "## 2: destroy-unattached on set on an unattached session (other session present)"
T new-session -d -s a 'sleep 600'; T new-session -d -s keep 'sleep 600'; T set -t a destroy-unattached on; sleep 0.3
run has-session -t a; run ls -F '#{session_name}'
T kill-server; sleep 0.3
echo "## 3: destroy-unattached on set while a client is attached, then client detaches"
T new-session -d -s a 'sleep 600'; T new-session -d -s keep 'sleep 600'
( sleep 1; T set -t a destroy-unattached on; echo "  set while attached; has-session a rc=$(T has-session -t a 2>&1; echo $?)" ) &
node attach-logger.js "$SPIKE_DIR/q8d-a" a 2500 >/dev/null; wait; sleep 0.5; run has-session -t a; run ls -F '#{session_name}'
T kill-server; sleep 0.3
echo "## 4: same, but it is the only session (exit-empty on)"
T new-session -d -s a 'sleep 600'
( sleep 1; T set -t a destroy-unattached on ) & node attach-logger.js "$SPIKE_DIR/q8d-b" a 2500 >/dev/null; wait; sleep 0.5
run has-session -t a; echo "  $(srv)"
T kill-server 2>/dev/null; sleep 0.3
echo "## 5a: exit-unattached on set with no client attached"
T new-session -d -s a 'sleep 600'; T set -s exit-unattached on; sleep 0.5; echo "  $(srv)"
T kill-server 2>/dev/null; sleep 0.3
echo "## 5b: exit-unattached on set while attached, then client detaches"
T new-session -d -s a 'sleep 600'; T new-session -d -s b 'sleep 600'
( sleep 1; T set -s exit-unattached on; echo "  set while attached: $(srv)" ) & node attach-logger.js "$SPIKE_DIR/q8d-c" a 2500 >/dev/null; wait
sleep 0.5; echo "  after detach: $(srv)"
T kill-server 2>/dev/null; sleep 0.3
echo "## 6: exit-empty off, last session's command exits 0 (remain-on-exit failed)"
T new-session -d -s a 'sleep 1' \; set -s exit-empty off; sleep 2; run ls; echo "  $(srv)"
T kill-server 2>/dev/null; sleep 0.3
echo "## 7: attached client while its session is killed"
T new-session -d -s a 'sleep 600'; T new-session -d -s b 'sleep 600'
( sleep 1; T kill-session -t a ) & node attach-logger.js "$SPIKE_DIR/q8d-d" a 2500; wait; run ls -F '#{session_name}'
grep -o 'exited\|detached[^\\]*' "$SPIKE_DIR/q8d-d.esc" | head -3
T kill-server 2>/dev/null
