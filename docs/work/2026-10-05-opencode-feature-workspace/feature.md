---
kind: epic
children:
  - 2026-10-05-01-workspace-walking-skeleton
  - 2026-10-05-09-visual-foundation
  - 2026-10-05-02-workflow-discovery-sidebar
  - 2026-10-05-03-session-status-linking
  - 2026-10-05-04-artifact-viewer
  - 2026-10-05-10-claude-code-sessions
  - 2026-10-05-05-next-actions
  - 2026-10-05-06-artifact-comments
  - 2026-10-05-07-command-palette-grid
  - 2026-10-05-08-packaging
appetite: "~6–7 weeks"
created: 2026-10-05
---

# Feature-focused desktop workspace for OpenCode

## Problem

Grove features move through phased, gated stages, but the work happens in
loose terminal windows running OpenCode. Nothing ties a session to the feature
and stage it serves. Nothing shows which feature is waiting on me, which stage
each feature is in, or what the next action is. Seeing that state means reading
artifact frontmatter by hand and keeping track of terminals in my head.

## Who it's for

Me: a single developer running grove features with OpenCode on macOS, often
several features and sessions in parallel.

## Success looks like

The app is my daily driver. I run every grove feature from the app instead of
from separate terminals. Sessions survive app restarts. I can see at a glance
which features are waiting on me and what each one's next action is.

## Non-goals

- A custom chat UI or custom message rendering
- Cloud sync, accounts, telemetry, multi-user features
- Linux and Windows support
- Editing artifacts inside the app
- Agents other than OpenCode and Claude Code (Claude Code added 2026-10-06,
  child 10)

## Appetite

~6–7 weeks across all children (raised from ~4 weeks on 2026-10-05, when the
visual foundation child was added, and from ~5–6 weeks on 2026-10-06, when
the Claude Code sessions child was added). If it runs over, cut scope (the grid view,
session resume, the OpenCode-server status source, signed packaging) rather than
extend the time.

## Follow-ups

- 2026-10-05 (from child `2026-10-05-04-artifact-viewer`, design): **repo docs
  in the artifact viewer.** Relative links from artifacts to ADRs and
  `CONTEXT.md` should open in the viewer, read-only (the human's answer in that
  child's questions). E-D8 allowlists feature folders only, so the child defers
  it and refuses such links with an "outside the feature folders" page. A fix
  needs an epic design revision: E-D8/ADR 0007 (repo-relative
  `grove-artifact://` URLs, since `<projectId>/<slug>/<file>` loses `docs/`
  when `../../adr/x.md` is resolved) and E-D2 (a `workflow.yaml` discovery key
  declaring the extra allowed paths, since the app may not name grove's
  `adrDir`/`contextFile`). Then the human re-approves; children 4 and 6 go stale.

## Re-scope (2026-10-07)

Sessions and review come first; new workflow features are on hold
([ADR 0020](../../adr/0020-sessions-and-review-before-workflow.md)). The
remaining build order is:

1. the project page opens on its Sessions board (done directly, no feature)
2. child 10, Claude Code sessions
3. `2026-10-07-session-diff` (standalone)
4. `2026-10-07-review-comments` (standalone; supersedes child 6)
5. the grove CLI (standalone, added 2026-10-07)
6. child 8, packaging

Children 5 (next actions) and 7 (command palette and grid) are **on hold**.
Child 6 is **superseded**. `children:` and the approved `03-design.md` and
`04-structure.md` (v6) are left as they are; this section overrides their
build order.
