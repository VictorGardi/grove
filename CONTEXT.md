# Context

Domain glossary for this repo. Each entry is a term this codebase uses with a
specific meaning, so humans and agents stay consistent.

## Terms

- **Space**: a folder; its tabs are terminal sessions started in that folder.
  A **worktree space** is a space on a linked `git worktree` checkout; it nests
  under the space of its main checkout. New checkouts go under
  `~/.grove/worktrees/<repo>/<branch>`, outside the repo so an agent never
  shares the main working tree.
- **Tab**: one terminal session inside a space, optionally running an agent
  (Claude, OpenCode or Copilot), with a **Tab state**.
- **Holder**: the detached Node process that owns the PTYs, so tabs survive the
  window and the core restarting. It parses the agents' OSC 7501 reports.
- **Core**: the Node process the holder supervises. It keeps spaces, tabs and
  state, derives each tab's state, and serves the window and the CLI over a
  Unix socket.
- **OSC 7501 status**: the status report an agent sends to its terminal
  (`state=working|idle|blocked|done|error`, fields split on `:`, `kind=` and
  `id=`). The holder parses it, answers the `?` query and keeps the last root
  record per tab; only the root record decides a tab's state.
- **Tab state**: `working`, `needs-you`, `finished`, `idle` or `unknown`.
  **Finished** is derived in core when the root report leaves working or
  needs-you for idle (or says `done`). **Unknown** means no report: the agent
  is too old, sends nothing, the PTY exited, or core restarted with no live
  holder entry. A live agent tab in unknown names the minimum version (Claude
  2.1.309, Copilot 1.0.107, OpenCode 2.2.6). In appearance settings,
  **waiting** names needs-you only, and **running** names working; neither is
  a state value.
- **Needs-you reason**: why a tab needs the human: `permission`, `question`,
  `auth` (the agent is not signed in or its key failed) or `error`.
- **Context level**: how full an agent's context window is, as one of `ok`,
  `warn` or `handoff`, taken from whichever of the agent's token count or its
  share of the window crosses a line first. Warn is from 150k tokens or 50%;
  handoff from 200k tokens or 70%. A tab with no usable reading has no level.
  The ring, the CLI and agents all use the same level.
- **Handoff**: an agent's work moving to a new tab because its context level is
  `handoff`: the old tab stops after its current step, and a fresh tab carries
  on from a brief. The old tab is left for the human, never killed. An
  orchestrator hands off its own work, or a worker's next step.
- **Grid layout**: how the grid's panes tile the screen. **Automatic** by
  default (columns follow pane count, tab order); once the human drags or
  resizes it becomes **custom**, a **split tree** whose leaves are panes and
  whose splits each divide their space by a ratio. One layout per window;
  **Reset layout** returns to automatic.
- **Go to**: the Cmd+P overlay that fuzzy-matches tabs, spaces and agents,
  grouped by space, and jumps to the chosen tab on Enter. It only navigates; it
  runs no commands.
- **Grove CLI**: the `grove` command, which drives the running app over the
  core socket (`~/.grove/s`); a tab knows itself by `GROVE_TAB`.
- **Token**: a named design value (colour, type, spacing, radius, size) as a
  CSS custom property in `packages/ui/src/tokens.css`.
- **Module**: a feature that lives in the dock and is declared as a
  `DockModule` in `packages/ui/modules.ts`: a panel, its rail button, its key
  action, and the **host events** it follows. Built-in only; the window builds
  buttons, key handlers and wiring from the registry. The **host** (terminals,
  spaces, tabs, status, config, the dock itself) is not a module. "Module" in
  the sense of a source file keeps its ordinary meaning.
- **Host event**: a notice the window sends to modules on its typed bus
  (`activeTabChanged`, `agentStateChanged`, `connectionChanged`), so a module
  never needs a named call from `main.ts`.
- **Expanded dock**: the dock at a large share of the window, switched on and
  off without losing the width the human dragged it to. One flag for the whole
  dock, whatever panel is showing.
- **Preview**: a file card's second view in the diff panel, for markdown files:
  the file as it reads after the change, rendered and read only, beside the
  card's **Diff** view. Raw HTML in the file is shown as text, never run.
