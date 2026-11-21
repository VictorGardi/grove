# Glossary

Domain glossary for this repo. Each entry is a term this codebase uses with a
specific meaning, so humans and agents stay consistent.

## Terms

- **Space**: a folder; its tabs are terminal sessions started in that folder.
  A **worktree space** is a space on a linked `git worktree` checkout; it
  belongs to the repo of its main checkout, which is a space like any other.
  New checkouts go under `~/.grove/worktrees/<repo>/<branch>`, outside the
  repo so an agent never shares the main working tree.
- **Heading**: a repo's group in the sidebar, drawn as a trunk with its spaces
  (the main checkout and its worktree spaces) branching off it. It is a
  grouping, not a space: it has no tabs and clicking it only folds or unfolds
  the group. Every space git places in a repo sits under one, even a lone checkout; only a space outside git has none. Each repo has a colour, from a hash of its name, on its heading and trunk. A worktree space whose
  main checkout is not a space still sits under a heading named after the repo.
- **Most urgent state**: the one state a space shows when its tabs differ, and
  a folded heading shows for the spaces under it. Order: `needs-you`,
  `finished`, `working`, `unknown`, `idle`. An unfolded heading shows none.
- **Tab**: one terminal session inside a space, optionally running an agent
  (Claude, OpenCode or Copilot), with a **Tab state**.
- **Tab number**: a tab's position among its space's tabs, in the order they
  were opened. It is not a stable id: when an earlier tab closes, the later
  tabs renumber. A tab without a name shows as "Tab N".
- **Tab name**: what a tab is called, from the first of: its **label** (set by
  the human by renaming, or by `--label`), its **session name**, its tab number.
  A label is never replaced by a session name; clearing the label brings the
  session name back.
- **Session name**: the name an agent keeps for the session a tab runs: Claude's
  `/rename` or `--name` name (else its own generated title, else the session's
  first prompt as a stand-in), OpenCode's session title, Copilot's session
  `name`. Read from the agent's own records, shown on the tab, never saved by
  Grove, and replaced when the agent changes it. A tab whose agent has no name
  yet shows its tab number.
- **Exited tab**: a tab whose process ended. It stays listed, showing
  `[process exited]`, until closed. An exited agent tab whose agent can pick its
  saved session up again offers **Resume**, which starts the agent again in the
  same tab.
- **Active tab / Active space**: the tab on screen (in the grid, the focused
  pane) and the space shown in the tab strip. The active tab always belongs to
  the active space, unless the space has no tabs.
- **Recent order**: tabs most recently shown first, kept per space and for the
  whole window. The previous-tab key walks a space's order; Go to lists tabs
  and spaces in the window's order.
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
  The ring, the CLI and agents all use the same level. It always describes the
  tab's root agent; a subagent's own context never shows and never moves it. When an agent's latest
  reading can't be used (unknown model window, unreadable source), the tab keeps
  its last good reading until a new valid one arrives, for every agent; only an
  agent's own empty reading, such as after a compaction, clears the figure.
- **Handoff**: an agent's work moving to a new tab because its context level is
  `handoff`: the old tab stops after its current step, and a fresh tab carries
  on from a brief. The old tab is left for the human, never killed. An
  orchestrator hands off its own work, or a worker's next step.
- **Agent tab**: a tab running an agent (Claude, OpenCode or Copilot). A tab
  running only a shell is a **plain terminal tab**.
- **Voice input**: holding the **push-to-talk key** in the active agent tab,
  speaking, and on release finding the words, turned to text on the Mac, added
  after whatever is already in that agent's input. Grove never presses Enter,
  so nothing is sent until the human sends it. No audio leaves the Mac or is
  kept. A plain terminal tab does nothing.
- **Push-to-talk key**: the key held while speaking; rebindable like the other
  keys. While it is held the tab shows a **listening indicator**.
- **Grid layout**: how the grid's panes tile the screen. **Automatic** by
  default (columns follow pane count, tab order); once the human drags or
  resizes it becomes **custom**, a **split tree** whose leaves are panes and
  whose splits each divide their space by a ratio. One layout per window;
  **Reset layout** returns to automatic.
- **Quiet space**: a space that is not the active space or under its heading,
  has no tab that is working, needs you or is finished, and is not among the 5
  most recently visited spaces (each space counts once, by its latest visit;
  the active space and the spaces under its heading take no place). Go to (with an empty query) and the spaces list in the
  sidebar fold the quiet spaces behind one line, "N quiet spaces ▾" while
  closed and "Hide quiet spaces ▴" while open, which opens and closes them. A query in Go to searches them too. The sidebar
  folds them without reordering: spaces keep the sidebar order. A heading
  leaves the list only when all its spaces are quiet. This is separate from
  folding a heading, which the human does and which is remembered per repo.
- **Go to**: the Cmd+K overlay that fuzzy-matches tabs, spaces and agents,
  and jumps to the chosen tab on Enter. With an empty query it draws the
  sidebar's tree (headings, branches, nodes, row names), a space with one tab
  as a single row and a space with several as a header over its tabs. With a
  query it is a flat ranked list of worktrees, then tabs, each hit with its
  match marked; Enter on a worktree goes to the tab that decides its state (the
  one that needs you). A tab with no name of its own is named by what it runs
  and where, or "<agent>, untitled". It only navigates; it runs no commands.
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

- **Request**: one model call an agent makes, counting the calls of its helper
  agents. It is the unit the usage panel's matrix and bars count; tokens and,
  for Copilot, credits are detail. Not Copilot's "premium request", and not
  part of **Context level**.
- **Credits**: Copilot's own unit of cost, GitHub AI Credits (1 credit =
  1,000,000,000 nano AIU), carried per request. Shown as "credits", never with a
  dollar sign, never added to anything but other credits. A total that includes
  requests without a credit figure reads "plus N requests without credits".
- **Usage panel**: the dock **Module** that shows each agent's requests per
  day, week and month: a day matrix, stacked bars, when you work (weekday by
  hour) and where it went (by repository, worktrees rolled up into their main
  checkout, folders without a space under "Other"). An agent appears only if it
  made a request in the last 30 days. Claude's figures include Claude Desktop as
  a separate slice. Copilot also shows credits; Claude shows no cost. Nothing
  here is a plan limit, and nothing is added across agents or machines.
- **Usage history**: what the usage panel counts: one entry per request, with
  its time, agent, model, folder and token counts, and no conversation text.
  Grove builds it in memory from the agents' own files at every start and keeps
  no record of it on disk, so it reaches back only as far as those files do and
  is shorter when an agent prunes them. The read of a large set of files takes a
  few seconds to minutes and the panel says it is still being built, with how
  far each agent has got. A day older than the earliest request the files hold
  is shown as having no record, not as zero activity.
- **Not tracked by Grove**: requests from sessions Grove did not run or cannot
  tell it ran. The usage panel shows this share only from the date Grove began
  recording its own sessions; before that it says it cannot tell. Copilot via
  OpenCode is never split this way.
- **Copilot via OpenCode** ("via OpenCode"): requests OpenCode made on Copilot's models. Only OpenCode's
  own database records them, so Grove reads it for these alone (nothing else of
  OpenCode appears in the usage panel). They count under Copilot as their own
  slice, drawn hatched, are not split into run in Grove or not tracked, and carry
  no credit figure, so they are always "requests without credits".
