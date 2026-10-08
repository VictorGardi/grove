# Shared helpers for OpenCode spikes. Source this file.
export SPIKE_SCRATCH="${SPIKE_SCRATCH:-/private/tmp/claude-501/-Users-victor-git-grove/a57f9130-1cb1-4e6c-8385-1a16954e077a/scratchpad/opencode}"
export TMUX_TMPDIR="${TMUX_TMPDIR_SPIKE:-/private/tmp/claude-501/gocs}"; mkdir -p "$TMUX_TMPDIR"  # short path: unix socket limit
T="tmux -L grove-oc-spike"
DB="$HOME/.local/share/opencode/opencode.db"
dbq() { sqlite3 -readonly "$DB" "$@"; }
screen() { $T capture-pane -p -t "$1" | sed '/^[[:space:]]*$/d'; }
# Start an SSE capture against the shared service; password stays in-process.
sse_start() { # $1=outfile
  ( PW=$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.local/state/opencode/service.json')))['password'])")
    exec curl -sN -u "opencode:$PW" http://127.0.0.1:49374/api/event > "$1" ) &
  echo $! 
}
