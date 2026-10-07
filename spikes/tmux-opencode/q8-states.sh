#!/bin/bash
# Q8: exit codes/output of has-session, list-sessions, ls -F in each server state,
# plus exit-empty and destroy-unattached behaviour.
source "$(dirname "$0")/env.sh"
SOCK=grove-spike-q8
run() { local out err rc; out=$(T "$@" 2>$SPIKE_DIR/q8err); rc=$?; err=$(cat $SPIKE_DIR/q8err);
  printf '  $ tmux -L %s %s\n    rc=%s stdout=[%s] stderr=[%s]\n' "$SOCK" "$*" "$rc" "$out" "$err"; }
probe() { echo "## $1"; run has-session -t alpha; run list-sessions; run ls -F '#{session_name}'; }
T kill-server 2>/dev/null; sleep 0.3
probe "A: no server running (socket absent: $(ls $TMUX_TMPDIR/tmux-$(id -u)/$SOCK 2>&1))"
# server with zero sessions: need exit-empty off, start-server alone exits immediately otherwise
T start-server \; set -g exit-empty off; sleep 0.3
probe "B: server running, zero sessions (exit-empty off)"
T new-session -d -s alpha 'sleep 600'
probe "C: session alpha exists"
T kill-session -t alpha
probe "D: alpha killed (exit-empty off, server alive? pid=$(pgrep -f "tmux -L $SOCK" | head -1))"
T kill-server; sleep 0.3
probe "E: after kill-server, stale socket file? $(ls $TMUX_TMPDIR/tmux-$(id -u)/ 2>&1 | tr '\n' ' ')"
echo "## F: exit-empty on (default): kill last session"
T new-session -d -s alpha 'sleep 600'; T show -gv exit-empty | sed 's/^/  exit-empty=/'
T kill-session -t alpha; sleep 0.5
run has-session -t alpha; run list-sessions
echo "## G: start-server alone with default exit-empty on"
T start-server; sleep 0.5; run list-sessions
echo "## H: last session's program exits (remain-on-exit failed, exit 0)"
T new-session -d -s alpha 'sleep 1; exit 0'; sleep 2; run has-session -t alpha; run list-sessions
echo "## I: last session's program exits non-zero (remain-on-exit failed)"
T new-session -d -s alpha 'sleep 1; exit 3'; sleep 2; run has-session -t alpha
run list-panes -t alpha -F '#{pane_dead} #{pane_dead_status}'
T kill-server 2>/dev/null; sleep 0.3
echo "## J: destroy-unattached on, session never attached (new-session -d)"
T new-session -d -s alpha 'sleep 600' \; set -g destroy-unattached on; sleep 1
run has-session -t alpha
T kill-server 2>/dev/null; sleep 0.3
echo "## K: exit-unattached option value / list"
T new-session -d -s alpha 'sleep 600'; T show -g exit-unattached; T show -g destroy-unattached; T show -g exit-empty
T kill-server 2>/dev/null
