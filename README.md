# Grove

**A desktop workspace for running many coding agents at once, and for steering each feature through a human-gated workflow.**

Grove runs [OpenCode](https://opencode.ai) and [Claude Code](https://claude.com/claude-code) sessions side by side, tells you which one needs you, and keeps every feature's research, design and plan as reviewable files in your repo.

<p align="center">
  <img src="docs/assets/screenshot.png" alt="Grove running: sessions in the sidebar, a live agent terminal and the project board" width="900">
</p>

## Features

**Sessions**
- Start OpenCode, Claude or plain terminal sessions per project with `⌘T`, or `⌘⇧T` to set prompt, worktree and sandbox.
- Live status on every session: *working*, *waiting* (a permission, a question, or a finished turn you haven't seen), *idle* or *gone*.
- Sessions live in tmux, so closing the app or a pane never kills an agent. Resume a gone session with its id, label and link intact.
- Session grid (`⌘G`): up to nine live terminals tiled on one screen.
- Drag to reorder, group by project or status, and jump anywhere with the command palette (`⌘K`).

**Isolation**
- **Git worktrees:** launch a session in a fresh worktree on a new branch, so parallel agents never share a working tree.
- **Sandboxed sessions:** run an agent inside an Apple [`container`](https://github.com/apple/container) Linux VM that sees only its working directory and a fixed mount set. This is filesystem isolation only, with no network restriction.

**Review**
- Session diff (`⌘⌥B`): `git diff HEAD` plus untracked files, in the app.
- Inline comments on diff lines or on quoted text in markdown. Drafts collect in a review tray and go to the agent as one message when you press Send.
- Built-in viewer for markdown, HTML artifacts and project files.

**Feature workflow**
- A board of every feature by stage, with *Input required* highlighted when a linked session is waiting on you.
- Stages, kinds and next actions come from a single `workflow.yaml`. The default is the `grove-*` workflow: questions → research → design → structure → plan → implement, with a human approving each gate.
- Features are plain folders (`docs/work/<slug>/`) of markdown artifacts, so they live in git and review like code.

**Grove CLI**
- Drive the running app from any terminal, or let agents orchestrate other agents:

```sh
grove ls                                          # list sessions
grove new claude --prompt "fix the flaky test" --worktree --branch fix-flaky
grove new opencode --sandboxed --cwd ~/code/app   # agent in a container
grove send <session> "also update the docs"
grove wait <session>                              # exit 0 done, 4 needs you, 5 gone
grove read <session> --lines 50                   # last lines of its screen
grove focus <session>   # show it in the app
grove kill <session>    # end it
```

## Install

Grove is a macOS Electron app, run from source for now.

**Requirements**

- macOS
- Node.js and npm
- [`tmux`](https://github.com/tmux/tmux) (`brew install tmux`)
- At least one agent CLI on your `PATH`: [`opencode`](https://opencode.ai) and/or [`claude`](https://claude.com/claude-code)
- `git`, for diffs and worktrees
- Optional: Apple [`container`](https://github.com/apple/container), for sandboxed sessions

```sh
git clone https://github.com/VictorGardi/grove.git
cd grove
npm install
npm run dev        # development
# or
npm run build && npm start
```

To get the `grove` command in your terminal, choose **Grove → Install Command Line Tool…** in the app. It links `grove` into `~/.local/bin`. Make sure that directory is on your `PATH`.

## Getting started

1. Open Grove and add a project: any folder, usually a git checkout.
2. Press `⌘T` to start a session, or `⌘⇧T` for the launch dialog (agent, worktree, prompt, sandbox).
3. Watch the sidebar. Sessions that need you are marked *waiting*.
4. Open the project board (`⌘⇧B`) for features by stage, or the sessions board.
5. To use the feature workflow, run the setup skill in your repo (`grove-setup`). It creates `grove.config.json`, `docs/adr/`, `CONTEXT.md` and an `AGENTS.md` block. Then start a feature from the board.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘T` / `⌘⇧T` | New session / with options |
| `⌘J` | New terminal |
| `⌘1`–`⌘9` | Jump to a session |
| `⌃Tab` | Last session |
| `⌘K` | Command palette |
| `⌘B` | Toggle sidebar |
| `⌘⇧B` | Project board |
| `⌘⌥B` | Session diff |
| `⌘G` / `⌘⇧G` | Session grid / add session to grid |
| `⌘W` | Remove session |

## The workflow

Features move through phased, human-gated steps. Each phase is a `grove-*` skill that writes one artifact into `docs/work/<slug>/`:

| Phase | Skill | Artifact |
| --- | --- | --- |
| Questions | `grove-questions` | `01-questions.md` |
| Research | `grove-research` | `02-research.md` |
| Design | `grove-design` | `03-design.md` |
| Structure | `grove-structure` | `04-structure.md` |
| Plan | `grove-plan` | `05-plan.md` |
| Implement | `grove-implement` | `06-implementation.md` |

Only a human can approve a phase. Later phases refuse to start on unapproved input, and an artifact with open questions or `TODO`s can't be approved. See [AGENTS.md](AGENTS.md) for the gates and [`resources/workflow.yaml`](resources/workflow.yaml) for the stage definitions.

The `auto` flow is an alternative for features you want built unattended. `grove-auto` interviews the human about the outcome, then writes a research map and a decision-and-slice plan; one `grove-approve <slug> plan` unlocks `grove-run`, which builds each slice in its own child session on a `run/<slug>-<profile>` branch. After the final review, `grove-approve <slug> run` (from the run worktree) approves `04-run.md`; you then commit it and merge or open a PR. `resources/workflow.yaml` defines its stages: Outcome, Research, Plan, Run. Profiles in `grove.config.json` choose which agent and model plays each role, and `grove new --model <model>` (claude or opencode) sets the child session model.

## Development

```sh
npm run dev         # run with hot reload
npm test            # vitest
npm run typecheck   # node + web
npm run build
```

Architecture decisions are in [`docs/adr/`](docs/adr), and the domain vocabulary is in [`CONTEXT.md`](CONTEXT.md).

## Tech

Electron, React, Zustand, xterm.js, node-pty, tmux, CodeMirror.
