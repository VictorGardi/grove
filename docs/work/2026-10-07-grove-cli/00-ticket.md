Source: the human's remarks on 2026-10-07, verbatim, followed by the context
given when starting this feature.

## Request (verbatim)

"i also realize i want grove to have a cli like xirp and herdr so that agents in grove can open other sessions in grove. how much work is this?"

"yes, start in xirp with grove-start"

## Context given at start

- Standalone feature, not an epic child. Step 5 of the re-scope in
  docs/adr/0020-sessions-and-review-before-workflow.md: built after
  2026-10-07-review-comments (reuse its send path) and before packaging (epic
  child 8).
- Rough estimate given in conversation: 2-3 days, ~4-5 slices — a Unix control
  socket in Electron main dispatching to the existing core methods
  (src/core/core.ts sessionCreate/sessionLink/...), sessionCreate extended with
  initial prompt/label/cwd/link, a `grove` CLI (ls, new --agent opencode|claude
  --prompt --label --link, send, wait, focus, --json), GROVE_SESSION_ID /
  GROVE_SOCKET in session env, PATH install, and an agent skill.
- One-way doors to put to the human in design: CLI command surface and output
  format, socket protocol and versioning, whether destructive commands
  (kill/remove) are exposed, whether spawned sessions record their parent
  session.
