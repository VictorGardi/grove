# Grove

<p align="center">
  <img src="resources/icon.png" width="128" height="128" alt="Grove icon">
</p>

A local-first, file-based developer task orchestration tool. Grove acts as an orchestration layer over your repositories — reading and writing Markdown files, managing git worktrees, and embedding a terminal so AI coding agents can be run without requiring API key management.

<p align="center">
  <img src="screenshot.png" alt="Grove in action" width="800">
</p>

## Principles

- **No auth, no login, no server, no cloud** — everything stays on your machine
- **The repo is the source of truth** — all tasks and decisions are stored as Markdown files inside the repo being worked on
- **The app is a UI layer** on top of the filesystem and git
- **Multiple workspaces** — manage several repos in parallel, each with their own tasks and terminals

## How It Works

1. Define a task in the kanban board - it will be saved in .tasks in the chosen workspace. Plan the task details with an agent inside the task definition. Automatically get a review of the plan from another agent to make sure it's trustworthy.
2. Drag a planned task to **Doing** (or press `D`) → Grove automatically creates a git worktree, isolated branch and your chosen execution agent implements the plan and reviews implementation.
3. Review what the agent changed via the built-in diff view
4. Move to **Done** → Grove prompts to clean up the worktree

## Why Grove

- **No context switching** — task board, terminal, file browser, and diff review in one window
- **Isolated work** — one worktree per task means clean parallel development without manual branch switching
- **No lock-in** — everything is Markdown files in your repo; delete the app, your tasks remain

## Features

### Task Board

- Kanban-style board with Backlog, Doing, Review, and Done columns
- Drag-and-drop cards between columns
- Priority badges (Critical, High, Medium, Low)
- Tag support with filtering
- Keyboard shortcuts for moving tasks between columns (B/D/R/F)

### File-Based Storage

- Tasks live in `.tasks/{backlog,doing,review,done}/` as Markdown files with YAML frontmatter
- Decisions stored in `.decisions/` with structured format
- Full git integration — version control your tasks alongside your code

### Git Worktree Automation

- Drag a card to **Doing** → automatically creates a git worktree and branch
- Worktrees isolated in `.worktrees/` directory
- Branch name shown on the card
- Prompt to clean up worktree when moving to Done

### Embedded Terminal

- Real terminal per worktree using xterm.js + node-pty (same stack as VS Code)
- One tab per active worktree
- Run any CLI-based agent (Claude Code, Copilot CLI, Codex, Aider, OpenCode)
- Terminal persists across workspace switches
- Session persistence — PTYs survive app restarts and reconnect automatically

### Diff View

- For any task in Doing, see which files have been modified
- Inline diff renderer with syntax highlighting
- Auto-refreshes after agent activity
- Click to open file in the viewer

### File Tree & Viewer

- Browse any file in the workspace
- Respects `.gitignore`
- Fuzzy file search with `Cmd+P`
- Syntax-highlighted read-only viewer powered by Shiki

### Task Detail

- Tabbed interface: Edit, Agent, Changes, Debug
- Raw markdown editor with live preview for task content
- Inline title editing and tag management
- Changes tab shows git diff for tasks in Doing status
- Debug tab exposes session metadata and internal state

### Agent Integration

- Plan and Execute modes for each task
- In-app AI agent chat with agent selection (opencode, copilot) and model picker
- Session persistence and reconnection across app restarts
- File autocomplete in chat via `@` prefix

## Quick Start

```bash
# Clone and install
npm install

# Run in development
npm run dev

# Build for production
npm run build
```

## Keyboard Shortcuts

| Shortcut    | Action                                  |
| ----------- | --------------------------------------- |
| `Cmd+P`     | Fuzzy file search                       |
| `Cmd+K`     | Search tasks on board                   |
| `Cmd+,`     | Open settings                           |
| `Cmd+B`     | Toggle sidebar                          |
| `Cmd+J`     | Toggle terminal panel                   |
| ``Ctrl+` `` | Toggle terminal (works in terminal too) |
| `` ` ``     | Toggle terminal panel                   |
| `Cmd+N`     | Add workspace                           |
| `Cmd+T`     | Create new task (from board)            |
| `Cmd+1-9`   | Switch workspace                        |
| `N`         | Create new task (from board, legacy)    |
| `B`         | Move selected task to Backlog           |
| `D`         | Move selected task to Doing             |
| `R`         | Move selected task to Review            |
| `F`         | Move selected task to Done              |
| `?`         | Activate search on board                |
| `Escape`    | Clear search / close panel              |

## Tech Stack

- **Electron** — desktop shell with native terminal support
- **React + Vite** — fast, modern UI
- **xterm.js + node-pty** — terminal emulation (VS Code's stack)
- **simple-git** — git operations
- **Shiki** — syntax highlighting
- **Zustand** — state management

## License

MIT
