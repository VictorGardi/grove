# Source me. Isolated tmux socket in scratch dir; never touches the default server.
: "${SPIKE_DIR:=/private/tmp/claude-501/-Users-victor-git-grove/a57f9130-1cb1-4e6c-8385-1a16954e077a/scratchpad/tmux-opencode}"
export SPIKE_DIR
# Socket path must fit sun_path (104 bytes) so the socket dir is short.
export TMUX_TMPDIR="${SPIKE_SOCKDIR:-/private/tmp/claude/gs}"
mkdir -p "$TMUX_TMPDIR"
unset TMUX COLORTERM  # keep the tmux global environment free of the caller's COLORTERM
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
CFG="$HERE/spike.conf"
T() { /opt/homebrew/bin/tmux -L "${SOCK:-grove-spike}" -f "$CFG" "$@"; }
