Source: the human's remarks on 2026-10-08, verbatim.

## Request (verbatim)

"also reasearch how we could run agent sessions (opencode/cc) in docker
sandboxes, i.e., sbx tool (optionally) - or perhaps there is a better/easier
sandbox method to use? goal is that agent should be able to 'roam around' a
bit but never fuck up filesystem. what options do i have? how difficult is
it? note that not all agent sessions need/should run in this sandboxed env,
only when running longer sessions with a lot of code generation"

Follow-up, after the research came back: "i'd say apple container cli is
really interesting for this.."

## Decisions chosen

None formally approved — this was an investigation only. One product lean
worth recording: the human finds Apple's native `container` CLI the most
interesting candidate, over both the OS-level (Seatbelt/bubblewrap) route and
`sbx`/Docker Sandboxes — worth weighing against this doc's own ranking (which
leads with OS-level sandboxing for latency/simplicity) when the questions
phase happens.

## Open for the questions phase

- Isolation mechanism: Apple's `container` CLI vs. OS-level (Seatbelt on
  macOS, bubblewrap on Linux) vs. `sbx`/Docker Sandboxes — pick one, or stage
  them (prototype one, fall back to another if isolation/network control
  proves insufficient)?
- Given Apple's `container` CLI is macOS-only and young (first stable release
  within the past year): is a Linux story needed at all for Grove's actual
  users, or is macOS-only acceptable?
- Per-session opt-in UX: a toggle at session-creation time, a kind of
  session, or a project-level default?
- Network policy default: fully offline, or an allow-list for the agent's own
  API host (and, for OpenCode, its local HTTP server port)?
- What's exposed inside the sandbox besides the working directory: does the
  Claude hook-spool path and the Grove control socket get bind-mounted in, or
  does a sandboxed session simply lose `grove` CLI / status-line capability?
- Relationship to the worktree investigation
  (`../2026-10-08-worktree-support/`): should a sandboxed session always run
  against a dedicated worktree, so the sandbox's writable root is a clean,
  disposable directory rather than the shared project checkout?
