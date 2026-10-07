# Context

Domain glossary for this repo. Each entry is a term this codebase uses with a
specific meaning, so humans and agents stay consistent.

## Terms

- **Project**: a repo folder registered in the app (`{id, name, path}` in app
  config). Groups the Sessions tab and lists in the Projects tab. May host
  sessions without any features.
- **Workflow**: the single `workflow.yaml` that holds all stage, kind, action
  and discovery rules. The app's code knows no workflow's phase names.
- **Feature**: a folder found by the workflow's `discovery` rule, identified by
  `projectId + slug`. Its **artifacts** are the files in that folder.
- **Group feature**: a feature whose kind has `group: true` (grove's epic);
  its children are found via `parent_field`. Never a board card: reached from
  a child's **parent tag** or breadcrumb, and its feature page lists its
  children. The app never names the kind (ADR 0018).
- **Stage**: a feature's current step, derived from artifact frontmatter by
  workflow rules: the first incomplete stage, unless a later artifact exists.
- **Flow**: a second manifest field (grove's `flow`) whose value, via the
  workflow's `flows`, selects which stages a feature uses alongside its kind.
- **Card state**: the generic per-feature state computed in code (`backlog`,
  `running`, `waiting`, `needs-review`, `ready`, `done`).
- **Session**: an app-started process in a tmux session on the `grove` socket;
  an **OpenCode session** or a **Claude session** (both **agent sessions**,
  running the agent's TUI) or a **terminal session** (a shell).
- **Agent session id**: `agentSessionId`, the agent's own id for a session
  (`ses_…` for OpenCode, a UUID for Claude), minted by grove before launch.
- **Agent source**: the per-kind adapter that reports agent events (turn
  start/end, pending permission or question, writes) to core; one per agent
  kind, each with its own connect and re-sync state (ADR 0019).
- **Hook spool**: the app-owned file `<userData>/agents/claude/<id>.jsonl` that
  a Claude session's per-launch hooks append to, and the Claude source tails
  (ADR 0016).
- **Session status**: `working`, `waiting`, `idle`, `gone` (agent sessions,
  from their agent source); `running`, `gone` (terminal, from tmux).
  **Waiting** means it's the human's move: a pending permission or question,
  or a finished turn not yet seen. Live only; `lastStatus` stores tmux
  liveness (ADR 0015).
- **Seen mark**: `seenAt`, when the human last had a session on screen with the
  window focused; a finished turn after it makes the session waiting.
- **Resume**: restarting a gone agent session in a new tmux session with
  `opencode -s <id>` or `claude --resume <id>`, keeping its id, label and link.
- **Link**: a session's association with one feature. Set at start by a next
  action, automatically from the session's latest write into a feature folder,
  or manually; a manual link is **pinned** and stops auto-linking.
- **Unlinked session**: a session with no link, shown directly under its project.
- **Next action**: a workflow action offered for the current stage; clicking it
  starts a linked session with a templated prompt.
- **Comment draft**: a comment on session diff lines or on quoted text in a
  markdown artifact, held in a session's review tray until the human explicitly
  sends it (ADR 0025).
- **Orphaned comment**: a draft whose anchored lines or quote can no longer be
  found in the file; still listed and sendable, marked in the message.
- **Review tray**: the per-session list of comment drafts plus one general
  note; **Send** delivers them as one message to that session, then keeps
  them in a collapsed Sent list (ADR 0024).
- **Send path**: `sendToSession`, the one way core puts text into a session:
  tmux bracketed paste then Enter, resuming a gone agent session first
  (ADR 0023). Used by review comments and the Grove CLI.
- **Grove CLI**: the `grove` command talking to the running app over
  `<userData>/grove.sock`; sessions know themselves by `GROVE_SESSION_ID`
  (ADR 0027).
- **Slice**: one domain's whole state (`projects`, `sessions`, `ui`, later
  `features`, `comments`), held in memory by core and pushed to the renderer as a
  whole on every change (ADR 0011).
- **Attach**: one node-pty `tmux attach` client showing a session in xterm.js.
  Closing an attach never ends the session.
- **Token**: a named design value (colour, type, spacing, radius, size) as a
  CSS custom property in `styles/tokens.css`; terminal and window colours live
  in `src/shared/theme.ts` (ADR 0012).
- **Session card**: a session's row in the sidebar (`ListRow`), bordered, with
  kind icon, title and status line; it can be **compacted** to one line.
- **Project folder**: a project's one-line header on the Sessions tab; it can
  be **collapsed** to hide its sessions.
- **Projects tab**: the sidebar tab listing projects, each with its live
  session count and a waiting badge; clicking one opens its project page.
- **Focus**: what the content area shows: exactly one of a session, a feature
  page or a project page (`focusedSessionId`, `focusedFeature`,
  `focusedProject`, mutually exclusive). With none, the first project's page
  (ADR 0018).
- **Project page**: the content area for one project: a Features | Sessions
  switch over its board. Going to it always shows the sessions board first
  (ADR 0020). ⌘B opens the current context's project page, and on it switches
  the board.
- **Breadcrumb**: the content header's trail (project › parent › feature, or
  project › linked feature › session); every segment but the last is an
  up-link. There is no back history.
- **Effective stages**: the stages a feature uses: those in both its kind's
  and its flow's list, in workflow order. Other stages are absent from its
  timeline.
- **Unapproved pass**: a stage counted as passed because a later effective
  stage's artifact exists, although its own `complete_when` is not met.
- **Feature page**: the content area for one feature: stage timeline, card
  state and flags, its parent link, its children, its artifacts listed, its
  linked sessions.
- **Board**: the project page's body. The **features board** groups the
  project's non-group features into one column per workflow stage; a
  **feature card** shows card state, title, parent tag and linked-session
  dots, and turns amber with "Input required" while a linked session waits.
  The **sessions board** groups the project's sessions into Waiting, Working
  (also plain terminals), Idle and Ended, with time in the current status.
- **Artifact viewer**: the right-hand panel showing one viewer target (an
  artifact, a project file, or a session diff), next to the main area or
  expanded over it; HTML in an opaque sandboxed iframe
  served by `grove-artifact://`, markdown rendered in main.
- **Session diff**: `git diff HEAD` plus untracked files of the repo holding a
  session's working directory, shown in the viewer (ADR 0021). Per working
  directory, so sessions sharing a checkout share it.
- **Diff line identity**: `(path, side, number)` of a diff line: `add` →
  new-side number, `del` → old-side, context → new-side.
- **Viewer target**: what the viewer shows: an `artifact`, a project `file`
  (ADR 0022), or a session's `diff`. A file opened from a diff keeps
  `fromDiff` for "← Diff".
- **Artifact path**: an artifact's identity within its feature: the path
  relative to the feature folder (POSIX), as in
  `grove-artifact://<projectId>/<slug>/<path>`.
