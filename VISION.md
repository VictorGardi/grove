# Worktree — Vision

## What you are building

A local-first, file-based developer task orchestration tool. It is an Electron desktop app that acts as an orchestration layer over a developer's repositories — reading and writing Markdown files, managing git worktrees, and embedding a terminal so AI coding agents can be run without requiring API keys.

**Core principles:**
- No auth, no login, no server, no cloud
- The repo is the source of truth — all tasks and decisions are stored as Markdown files inside the repo being worked on
- The app is a UI layer on top of the filesystem and git
- Multiple repos (workspaces) can be open in parallel, each with their own tasks, decisions, and running terminals
- Embedded terminals allow any CLI-based agent (Claude Code, Copilot CLI, Codex, Aider, OpenCode) to run without API key management in the app itself

---

## Tech stack

| Layer | Choice | Reason |
|---|---|---|
| Shell | Electron | node-pty (terminal emulation) requires native Node bindings; Electron handles this cleanly |
| UI | React + Vite (via `electron-vite`) | Fast iteration, standard ecosystem |
| Styling | CSS variables + scoped CSS modules | No runtime CSS-in-JS, clean theming |
| Terminal | xterm.js + node-pty | Same stack as VS Code terminal |
| Filesystem watch | chokidar | Reliable cross-platform fs watcher |
| Markdown parsing | gray-matter + remark | Frontmatter + body parsing |
| Syntax highlighting | Shiki | Fast, accurate, theme-aware — used for file viewer |
| Diff rendering | diff2html | Parses unified diff output into structured HTML |
| Fuzzy search | fuse.js | Client-side fuzzy search for file tree and command palette |
| Git ops | simple-git | Thin wrapper over git CLI |
| State | Zustand | Lightweight, no boilerplate |
| IPC | Electron contextBridge | Renderer ↔ main communication |

**Note on file editing:** The file viewer is intentionally read-only in v1. Agents running in the embedded terminal are actively modifying files — adding an in-app editor creates conflict risk (concurrent writes, stale content, "file changed on disk" flows). Read-only with syntax highlighting gives full visibility without that complexity. Promote to editable in a future version once the terminal/agent workflow is stable.

---

## File structure (inside each repo being managed)

```
<repo-root>/
  .tasks/
    backlog/
      T-001-initial-scaffold.md
    doing/
      T-004-jwt-refresh.md
    review/
      T-002-drizzle-migration.md
    done/
      T-000-project-init.md
  .decisions/
    D-001-hono-over-express.md
    D-002-redis-for-sessions.md
```

### Task file format

```md
---
id: T-004
title: JWT refresh token rotation with revocation support
status: doing
agent: claude-code
worktree: .worktrees/feat/T-004
branch: feat/T-004
created: 2026-04-01
tags: [auth, api]
decisions: [D-002]
---

## Description
Implement secure refresh token rotation...

## Definition of Done
- [x] Refresh endpoint issues new token pair
- [x] Old token added to Redis revocation set
- [ ] TTL cleanup job for expired entries
- [ ] Integration tests covering rotation flow

## Context for agent
See D-002. Use existing Redis client from src/lib/redis.ts.
Follow error handling patterns in src/middleware/errors.ts.
Tests in Vitest.
```

### Decision file format

```md
---
id: D-002
title: Use Redis for session and token state
status: active
created: 2026-03-28
tags: [infra, auth]
---

## Context
Needed fast revocation lookups without DB round-trips.

## Decision
Use Redis with TTL-based expiry for token revocation lists and session state.

## Consequences
- Adds Redis as a dependency
- Cleanup is automatic via TTL
- +~2ms latency on token validation (acceptable)
```

---

## App-level config (not inside any repo)

```json
// ~/.config/worktree/config.json
{
  "workspaces": [
    { "name": "assaria-backend", "path": "/Users/victor/code/assaria/backend" },
    { "name": "centiro-pipeline", "path": "/Users/victor/code/centiro/pipeline" }
  ],
  "lastActiveWorkspace": "assaria-backend"
}
```

---

## UI structure

```
[ Workspace Rail (52px) ]
[ Sidebar (220px)       ][ Main area                            ][ Detail Panel (360px) ]
                        [       Terminal Panel (180px, collapsible)                     ]
```

The **main area** is a view switcher — the sidebar nav determines what's shown:
- **Board** — kanban columns (default)
- **Files** — file tree + file viewer

The **detail panel** is context-sensitive:
- When a kanban card is selected: task detail with DoD, chat, metadata
- When a "doing" task is selected: detail panel gains a **Changes** tab showing git diff

- **Workspace Rail** — narrow icon strip, one icon per registered workspace, active indicator, add/settings at bottom
- **Sidebar** — workspace name + path, nav items (Board, Files, Decisions, Context), active worktrees list with status
- **Kanban Board** — four columns, cards show ID, title, tags, agent, DoD progress, branch if active
- **File Tree** — collapsible directory tree of repo, fuzzy search, click to open file in viewer pane
- **File Viewer** — read-only, syntax-highlighted, Shiki-powered
- **Detail Panel** — task details, DoD, agent picker, decisions, chat. For "doing" tasks: adds Changes tab with diff view
- **Terminal Panel** — xterm.js, one tab per active worktree

### Design spec
- Dark theme, Zed/Obsidian aesthetic
- Background `#0b0b0d`, surfaces `#101012` / `#141417`
- Border `#242430`, hover `#32323f`
- Text: primary `#e2e2e6`, secondary `#8b8b96`, muted `#44444e`
- Accent: `#7b68ee` (purple)
- Status colors: green `#3ecf8e`, amber `#e8a44a`, red `#e05c5c`, blue `#5ba3f5`
- Fonts: `Figtree` for UI, `JetBrains Mono` for IDs, paths, terminal, code
- No gradients, no shadows except subtle glow on accent elements
- Minimal chrome — every pixel has a reason

---

## Phase breakdown

---

## Phase 1 — Electron shell + workspace management

**Goal:** A working Electron app with workspace switching. No tasks yet. Just the skeleton.

**Tasks:**
1. Scaffold with `electron-vite` + React + TypeScript
2. Implement `config.json` read/write in main process via IPC:
   - `workspace:list` → returns array of workspaces
   - `workspace:add(path)` → validates path exists, extracts name from dirname, appends to config
   - `workspace:remove(name)`
   - `workspace:setActive(name)`
3. Render the workspace rail with workspace avatars (first two letters of name)
4. Active workspace indicator (left accent bar, glow on icon)
5. Add workspace flow — file picker dialog, validates the selected directory
6. Persist and restore last active workspace on relaunch
7. Basic sidebar showing workspace name and path
8. App window: frameless, 1200×800 default, remember size/position across restarts

**Done when:** You can register multiple repos, switch between them, and the active workspace name and path shows in the sidebar. State persists across restarts.

---

## Phase 2 — Filesystem reader + Kanban board

**Goal:** Read `.tasks/` from the active workspace and render a live kanban board.

**Tasks:**
1. Main process: scan `.tasks/{backlog,doing,review,done}/*.md` on workspace switch
   - Parse frontmatter with `gray-matter`
   - Parse DoD checkbox progress from body (`- [x]` vs `- [ ]`)
   - Return structured task array via IPC: `tasks:list(workspacePath)`
2. Initialize `.tasks/` directory structure if it doesn't exist
3. Watch `.tasks/` with `chokidar` — push `tasks:changed` IPC event to renderer on any file change
4. Kanban board component — four columns, correct status mapping to column
5. Task card component — ID (mono), title, tags, agent badge, DoD progress bar, branch name if present
6. Column header with dot indicator color and count
7. "Add ticket" placeholder at bottom of each column (not functional yet)
8. Smooth card hover states, column scroll

**Done when:** Drop a `.md` file into `.tasks/doing/` and the card appears in the Doing column within one second, with correct DoD progress.

---

## Phase 3 — File tree + file viewer

**Goal:** Browse and read any file in the active workspace. Useful for understanding the codebase while working on tasks, and for inspecting files the agent has created or modified.

**Tasks:**

### File tree
1. IPC handler `fs:tree(workspacePath)` — returns a recursive directory tree, respecting `.gitignore` (use the `ignore` npm package to parse and apply gitignore rules). Always exclude: `.git/`, `node_modules/`, `.worktrees/`
2. Sidebar nav item "Files" switches the main area to file tree view
3. File tree component:
   - Collapsible directories, remembers open/closed state per workspace in local config
   - File icons by extension (simple extension → icon character map, no heavy icon library)
   - Indent guides — subtle `1px` vertical lines at each level, `--border-dim` color
   - Clicking a file opens it in the viewer pane to the right
   - Keyboard navigation: arrow keys to move, enter to open, right/left to expand/collapse dirs
4. chokidar watches workspace root (excluding `.git`, `node_modules`, `.worktrees`) — refresh tree on file add/remove/rename

### Fuzzy file search
5. Search input at top of file tree — `⌘P` / `Ctrl+P` focuses it from anywhere in the app
6. Uses `fuse.js` over the flat list of all file paths — shows filtered flat results while query is active, returns to tree view when cleared
7. Results show: filename bold, directory path dimmed, matching characters highlighted with accent color
8. Keyboard: arrows navigate results, enter opens, escape clears

### File viewer
9. IPC handler `fs:readFile(filePath)` → returns file content as string + detected language (from extension)
10. File viewer pane renders to the right of the file tree, occupying the same layout slot as the kanban board when in Files view
11. Syntax highlighting via **Shiki** — use a custom theme object built from the app's CSS variable palette (do not use a bundled Shiki theme directly — derive colors so syntax integrates naturally). Support at minimum: TypeScript, JavaScript, TSX, JSX, Python, Go, Rust, SQL, YAML, JSON, Markdown, Bash, Dockerfile
12. File viewer header: path as breadcrumb (directory dimmed / filename normal weight), language badge, line count. All in JetBrains Mono
13. **Read-only** — no cursor blink, no text selection caret, slightly different background (`--bg-surface` vs `--bg-base`) to distinguish from an editor. A small "read only" badge in the header makes this explicit
14. Line numbers in `--text-lo`, JetBrains Mono, right-aligned in a fixed-width gutter
15. If the file is binary or unreadable: show centered message "Binary file — cannot display"
16. chokidar watches the open file. On external change (agent modified it), auto-reload and briefly flash changed line backgrounds (200ms pulse in `--accent-dim`) to signal the update

**Done when:** Click "Files" in sidebar → tree renders respecting gitignore → collapse/expand dirs → `⌘P` opens fuzzy search → enter opens file with syntax highlighting → agent edits a file in the terminal → viewer auto-reloads with a flash.

---

## Phase 4 — Task detail panel + CRUD

**Goal:** Click a card, see full detail. Create, edit, and move tasks.

**Tasks:**
1. Detail panel slides in from right on card click (not a modal — panel stays, board narrows slightly)
2. Panel shows: ID, title, status tag, description, DoD checklist (interactive — clicking a checkbox updates the `.md` file), agent badge, metadata grid, context-for-agent field (editable textarea), linked decisions
3. Inline title editing (click to edit, blur/enter to save)
4. DoD item editing: add new item, delete item, check/uncheck — all write back to the `.md` file immediately
5. Agent picker dropdown — values: `claude-code`, `copilot`, `codex`, `aider`, `opencode`. Saves to frontmatter
6. "New ticket" button in toolbar → creates a new `.md` in `.tasks/backlog/` with a generated ID (next integer), opens detail panel
7. Drag-and-drop between columns — moves the `.md` file to the corresponding directory, updates `status` in frontmatter
8. Delete task — moves to `.tasks/archive/` (never hard-delete)
9. Tags — comma-separated input, saved as frontmatter array

**Done when:** Full task lifecycle works — create, edit all fields, move between columns by drag, delete. All changes immediately reflected in the `.md` files.

---

## Phase 5 — Git worktree automation

**Goal:** Dragging a card to Doing creates a git worktree and updates the task.

**Tasks:**
1. Main process git helpers via `simple-git`:
   - `git:isRepo(path)` → validates workspace is a git repo
   - `git:worktrees(path)` → list existing worktrees
   - `git:createWorktree(repoPath, taskId, branchName)` → `git worktree add .worktrees/<id> -b <branch>`
   - `git:removeWorktree(repoPath, worktreePath)` → cleanup when task moves to Done/archive
2. On drag to **Doing**:
   - Check if worktree already exists (idempotent)
   - Create worktree at `<repo>/.worktrees/<task-id>/`
   - Update task frontmatter: `worktree` and `branch` fields
   - Copy `.tasks/` and `.decisions/` into the worktree root (agents can read them)
3. On drag to **Done**:
   - Prompt: "Remove worktree? The branch will be kept."
   - If confirmed: `git worktree remove` the path
   - Clear `worktree` field from frontmatter
4. Sidebar worktree list — show all active worktrees for current workspace with status (running = terminal open, idle = no terminal)
5. Show branch name on card when worktree is active

**Done when:** Drag a backlog card to Doing → worktree created → branch name appears on card → drag to Done → worktree removed.

---

## Phase 6 — Diff view

**Goal:** For any task in Doing, show which files have been modified in the worktree branch vs the base branch — with a full inline diff per file. This is the primary way to review what an agent has done before moving to Review.

**Architecture note:** All git operations run in the main process via `simple-git`. The renderer receives structured diff data and renders it — never shell out from the renderer.

**Tasks:**

### Changed files list
1. IPC handler `git:diff(worktreePath, baseBranch)`:
   - Runs `git diff $(git merge-base HEAD <baseBranch>)...HEAD --name-status` in the worktree
   - Returns array of `{ path, status: 'M' | 'A' | 'D' | 'R', additions: number, deletions: number }`
   - Use `git merge-base` to find the true divergence point — ensures diff only shows what this branch added, not unrelated commits on the base
2. In the task detail panel, add a **"Changes" tab** alongside the default "Detail" tab — visible only when the task has an active worktree (status = doing and `worktree` field is set)
3. Changes tab header shows a summary: `3 files changed · +47 −12`
4. Changed files list — one row per file:
   - Status pill: `M` amber, `A` green, `D` red — short monospace badge
   - File path: basename normal weight, parent directory dimmed, both in JetBrains Mono
   - Line delta: `+12 −3` in respective colors, right-aligned
   - Click row to expand inline diff below it (accordion — one expanded at a time)
   - Keyboard: arrow keys navigate rows, enter expands/collapses

### Inline diff renderer
5. IPC handler `git:fileDiff(worktreePath, baseBranch, filePath)`:
   - Runs `git diff $(git merge-base HEAD <baseBranch>)...HEAD -- <filePath>` → returns raw unified diff string
6. Render inline below the file row using **diff2html** in `line-by-line` mode:
   - Do **not** use diff2html's default CSS — restyle from scratch:
     - Container background: `--bg-surface`
     - Added lines: background `--green-dim`, line number gutter `--green-dim` at 60% opacity, `+` glyph in `--green`
     - Removed lines: background `--red-dim`, gutter at 60% opacity, `-` glyph in `--red`
     - Unchanged context lines: background `--bg-base`, text `--text-lo`
     - Code font: JetBrains Mono 11px
     - Hunk headers (`@@ ... @@`): background `--bg-active`, text `--text-lo`, border-top `--border`
7. Long diffs: show first 150 lines, then a "Show N more lines" button — expands inline, no pagination
8. Untracked/new files (status `A`): show full file content as a pure addition diff (all lines green)
9. Deleted files (status `D`): show full file content as a pure removal diff (all lines red)

### Refresh + cross-linking
10. "Refresh" button in the Changes tab header — re-fetches diff on demand
11. Auto-refresh when the terminal for this worktree has been idle for 3 seconds (use the idle signal from Phase 7)
12. Each file row has a small "→ View file" icon button — clicking it switches to Files view and opens that file in the Shiki viewer, so you can see the full file with proper syntax highlighting alongside the diff context
13. Default base branch: detect from `git remote show origin` or fall back to `main` / `master`. Allow per-workspace override in settings

**Done when:** Open a "doing" task → click "Changes" tab → see list of modified files with status and line deltas → click a file row → inline diff renders with correct colors → click "View file" → file opens in the file tree viewer. Auto-refreshes after agent activity in the terminal.

---

## Phase 7 — Embedded terminal

**Goal:** A real terminal per worktree, tabbed, persistent across workspace switches.

**Tasks:**
1. Install `node-pty` and `xterm.js` (+ `xterm-addon-fit`, `xterm-addon-web-links`)
2. Main process: PTY manager
   - `pty:create(id, cwd)` → spawns a PTY in the given directory (default shell from `$SHELL`), returns `id`
   - `pty:write(id, data)` → forward keystrokes
   - `pty:resize(id, cols, rows)` → forward resize events
   - `pty:kill(id)` → cleanup
   - Stream PTY output back via `pty:data(id, chunk)` IPC events
   - Expose `pty:isIdle(id)` — true if no output received for 3+ seconds (used by diff auto-refresh)
3. Terminal panel at bottom — 180px default height, resizable by dragging the top edge
4. One tab per active worktree (opened automatically when worktree is created in Phase 5)
5. Tab shows worktree branch name + running indicator (green dot = active output, grey = idle)
6. Switch tabs without killing PTY — just hide/show the xterm instance
7. "+" tab opens a free terminal at repo root (no worktree association)
8. Collapse/expand terminal panel (toggle button + backtick shortcut), persists preference
9. Terminal inherits the user's shell config (`$SHELL`, env vars from parent process)
10. When a worktree terminal is first opened, pre-fill (but do not run) the agent command based on the task's `agent` field — e.g. `claude` for `claude-code`, `gh copilot suggest` for `copilot`. User presses enter to start it

**Done when:** Drag card to Doing → worktree tab appears in terminal → switch tabs without losing state → typing works exactly like a real terminal → close and reopen app, worktrees still exist (PTYs restart in their worktree dirs).

---

## Phase 8 — Decision log

**Goal:** A structured decision log, linked to tasks, readable by agents.

**Tasks:**
1. Main process: scan `.decisions/*.md` with same `chokidar` watcher pattern as tasks
2. Parse frontmatter: `id`, `title`, `status` (active / superseded / deprecated), `created`, `tags`
3. Decision log view — "Decisions" sidebar nav item
4. Opens as a panel overlay (board stays mounted underneath — not a full page nav)
5. List: ID badge, title, status tag, first line of body as summary
6. Click decision → expand inline showing full sections (Context, Decision, Consequences)
7. "New decision" → creates `.decisions/D-XXX-slug.md` with template, opens inline editor
8. Inline editing of all decision fields (same debounce + atomic write pattern as tasks)
9. In task detail panel: "Linked decisions" — searchable multi-select, saves `decisions: [D-001, D-002]` to frontmatter
10. Status transition: active → superseded (prompts "Superseded by which decision?") → links the two records in frontmatter
11. Verify decisions are included in the context copied to worktrees (Phase 5)

**Done when:** Create a decision, link it to a task from the detail panel, see it appear in the linked decisions list with click-to-expand. `.decisions/` files exist and are readable by agents in worktrees.

---

## Phase 9 — In-app AI chat for ticket refinement

**Goal:** An AI chat panel inside the task detail for refining ticket content — not tied to any provider, not required to use the app.

**Tasks:**
1. Chat panel embedded at the bottom of the detail panel (below DoD, above metadata)
2. Settings: OpenAI-compatible base URL + optional API key
3. Context payload on send:
   - System: "You are helping refine a software task. Current task: [full task markdown]. Relevant decisions: [linked decision content]. Help refine description, DoD, and agent context."
   - User: their message
4. Streaming response with token-by-token rendering
5. Action buttons on AI response: "Apply to DoD", "Apply to description", "Apply to context" — each writes the relevant section to the `.md` file
6. Chat history ephemeral (session only — not persisted)
7. If no endpoint configured: show "Configure an OpenAI-compatible endpoint in settings, or use the terminal to chat with your agent directly."

**Note:** The terminal is the primary agent interface. This chat is only for pre-work ticket refinement.

**Done when:** Configure endpoint → open task → ask refinement question → streaming response → "Apply to DoD" appends checklist items to task file.

---

## Phase 10 — Polish + packaging

**Goal:** App is stable, distributable, and pleasant to use.

**Tasks:**
1. Keyboard shortcuts:
   - `N` — new ticket (board focused)
   - `⌘P` / `Ctrl+P` — fuzzy file search (global)
   - `⌘F` / `Ctrl+F` — filter tickets (board) / search in file viewer
   - `⌘K` / `Ctrl+K` — command palette
   - `⌘,` / `Ctrl+,` — settings
   - `Escape` — close panels / clear search
   - `` ` `` — toggle terminal panel
2. Command palette — fuzzy over: workspaces, tasks (by title/ID), decisions, files, actions
3. Filter bar on board — by tag, agent, status
4. Settings panel — workspaces, API endpoint, shell override, default base branch, Shiki theme
5. Onboarding — first-launch empty state: "Add your first workspace"
6. Error handling — git not installed, not a repo, worktree failure, binary file, write failure
7. `electron-builder` — macOS `.dmg`, Linux `.AppImage`, Windows `.exe`
8. Performance — virtual scroll on large file lists, lazy Shiki load, debounced writes

**Done when:** Clean build on macOS. All shortcuts work. Errors surface clearly. Empty states guide the user.

---

## Important implementation notes

### IPC pattern
All filesystem, git, and PTY operations happen in the **main process**. The renderer never touches the filesystem directly. Use `contextBridge` to expose a typed API:

```ts
// preload.ts
contextBridge.exposeInMainWorld('api', {
  tasks:      { list, create, update, move, delete },
  decisions:  { list, create, update },
  workspaces: { list, add, remove, setActive },
  git:        { createWorktree, removeWorktree, listWorktrees, diff, fileDiff },
  fs:         { tree, readFile },
  pty:        { create, write, resize, kill, isIdle },
  config:     { get, set },
})
```

### File write strategy
- Debounce all writes by 300ms to avoid hammering the filesystem on fast typing
- Write atomically: write to `<file>.tmp` then rename — prevents partial reads by chokidar
- Never re-parse a file immediately after writing it — use in-memory state as truth, let chokidar confirm

### File viewer and agent edits
The viewer is read-only so there is no conflict to resolve when an agent modifies an open file. Re-fetch and re-highlight on the chokidar event. Flash changed lines for 200ms (`--accent-dim` background pulse) to signal the reload.

### Diff base branch detection
```ts
// In main process
const base = await git.raw(['merge-base', 'HEAD', baseBranch])
const diff = await git.raw(['diff', `${base.trim()}...HEAD`, '--name-status'])
```
Default `baseBranch`: check if `main` exists, else `master`, else prompt the user once and save to workspace config.

### Worktree context injection
When creating a worktree, copy into the worktree root:
- `.tasks/` — agent sees all task context
- `.decisions/` — agent sees all decisions
- `CONTEXT.md` — generated summary of the specific task: title, DoD, linked decision content, context-for-agent field

### Multi-workspace terminal isolation
Each workspace has its own PTY pool. Switching workspaces does not kill running terminals — they stay alive in the background. Switching back resumes them exactly where they left off.

### Chokidar setup
```ts
chokidar.watch(`${workspacePath}/.tasks/**/*.md`, {
  ignoreInitial: false,
  awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
})
```
`awaitWriteFinish` prevents double-reads during atomic writes.

### Shiki setup
Load Shiki lazily on first file open — it's large. Cache the highlighter instance per session. Build a custom theme object from CSS variables rather than using a bundled theme, so syntax colors integrate naturally with the app palette.
