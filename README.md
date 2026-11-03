# Grove

**A desktop workspace for running many coding agents at once, and for steering each feature through a human-gated workflow.**

Grove runs [OpenCode](https://opencode.ai), [Claude Code](https://claude.com/claude-code) and [GitHub Copilot CLI](https://github.com/features/copilot/cli) sessions side by side, tells you which one needs you, and keeps every feature's research, design and plan as reviewable files in your repo.

<p align="center">
  <img src="docs/assets/screenshot.png" alt="Grove running: sessions in the sidebar, a live agent terminal and the project page" width="900">
</p>

## Features

**Sessions**
- Start OpenCode, Claude, Copilot or plain terminal sessions per project with `⌘T`, or `⌘⇧T` to set prompt and worktree.
- Live status on every session: *working*, *waiting* (a permission, a question, or a finished turn you haven't seen), *idle* or *gone*.
- Sessions live in tmux, so closing the app or a pane never kills an agent. Resume a gone session with its id, label and link intact.
- Session grid (`⌘G`): up to nine live terminals tiled on one screen.
- Drag to reorder, group by project, and jump anywhere with the command palette (`⌘K`).

**Isolation**
- **Git worktrees:** launch a session in a fresh worktree on a new branch, so parallel agents never share a working tree.

Isolation beyond git worktrees is left to each agent provider's own features.

**Review**
- Session diff (`⌘⌥B`): `git diff HEAD` plus untracked files, in the app.
- Inline comments on diff lines or on quoted text in markdown. Drafts collect in a review tray and go to the agent as one message when you press Send.
- Built-in viewer for markdown, HTML artifacts and project files.

**Feature workflow**
- Features and their artifacts are found in the command palette (`⌘K`), with *Input required* highlighted when a linked session is waiting on you.
- Stages, kinds and next actions come from a single `workflow.yaml`. The default is the `grove-*` workflow: questions → research → design → structure → plan → implement, with a human approving each gate.
- Features are plain folders (`docs/work/<slug>/`) of markdown artifacts, so they live in git and review like code.

**Dictation**
- Hold `⌃⇧Space` in a session pane, speak, release: the words appear in that session's prompt, unsent. Local only (whisper.cpp), English only. See [Dictation](#dictation).

**Grove CLI**
- Drive the running app from any terminal, or let agents orchestrate other agents:

```sh
grove ls                                          # list sessions
grove new claude --prompt "fix the flaky test" --worktree --branch fix-flaky
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
- At least one agent CLI on your `PATH`: [`opencode`](https://opencode.ai), [`claude`](https://claude.com/claude-code) and/or [`copilot`](https://github.com/features/copilot/cli)
- `git`, for diffs and worktrees

```sh
git clone https://github.com/VictorGardi/grove.git
cd grove
npm install
npm run dev        # development
# or
npm run build && npm start
```

To get the `grove` command in your terminal, choose **Grove → Install Command Line Tool…** in the app. It links `grove` into `~/.local/bin`. Make sure that directory is on your `PATH`.

## Dictation

Dictation is optional and needs a one-time setup. Nothing is downloaded by the app.

1. Install `whisper-cli` from [`ggml-org/whisper.cpp`](https://github.com/ggml-org/whisper.cpp), either with `brew install whisper-cpp` or by building it yourself. It must be on the `PATH` of your login shell. Do not use the unrelated `vatsalaggarwal/whisper-cli`: it sends audio to OpenAI's cloud and must not be used.
2. Fetch the model: `node scripts/stt-fetch-model.mjs`. It downloads `ggml-base.en.bin` from the [whisper.cpp Hugging Face repository](https://huggingface.co/ggerganov/whisper.cpp), checks its sha256 and writes it to `~/Library/Application Support/grove/stt/ggml-base.en.bin`. If the machine cannot reach Hugging Face, copy the file there yourself (the app only checks its size, 147964211 bytes) or run `node scripts/stt-fetch-model.mjs --from <file>`, which verifies the sha256.
3. Restart Grove. The first time you dictate, macOS asks for microphone access. When running from source (`npm run dev`), the prompt is attributed to the host app or terminal that launched Grove (Electron or your terminal), and that app is the one to allow in System Settings → Privacy & Security → Microphone.
4. Check that it is ready: the dictation item in the **Session** menu shows the shortcut when setup is complete and "setup needed" otherwise. It is checked once at launch, so restart Grove after changing the setup.

Use: hold `⌃⇧Space` while a Grove pane is focused, speak, release. The target pane is fixed when you press. The words are pasted into its prompt and never submitted. It works only while the Grove window is focused, records at most while the keys are held, and gives up after 30 seconds of transcription.

**For a security review**

- The dictation code has no network code. Audio never leaves the machine; whisper.cpp runs as a local child process.
- The audio is written to a temporary WAV under `~/Library/Application Support/grove/stt/tmp` and deleted straight after transcription. Stale files are removed at the next start.
- The model is an ordinary file, so it can be scanned and approved like any other.
- The fetch script is the only step that touches the network. You run it yourself, outside the app, and it refuses a file whose sha256 does not match.
- The `whisper-cli` binary (for example from Homebrew) is a supply-chain item your organisation may need to approve. A locally built binary from a reviewed tag works the same.
- Packaged builds will need `NSMicrophoneUsageDescription` and the audio-input entitlement. No packaging exists yet, so this is documented, not built.

## Getting started

1. Open Grove and add a project: any folder, usually a git checkout.
2. Press `⌘T` to start a session, or `⌘⇧T` for the launch dialog (agent, worktree, prompt).
3. Watch the sidebar. Sessions that need you are marked *waiting*.
4. Open a project's page from the sidebar: a header, a new-session button and a `⌘K` hint. Features and artifacts are one `⌘K` away.
5. To use the feature workflow, run the setup skill in your repo (`grove-setup`). It creates `grove.config.json`, `docs/adr/`, `CONTEXT.md` and an `AGENTS.md` block. Then start a feature from `⌘K`.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘T` / `⌘⇧T` | New session / with options |
| `⌘J` | New terminal |
| `⌘1`–`⌘9` | Jump to a session |
| `⌃Tab` | Last session |
| `⌘K` | Command palette |
| `⌘B` | Toggle sidebar |
| `⌘⌥B` | Session diff |
| `⌘G` / `⌘⇧G` | Session grid / add session to grid |
| `⌘W` | Remove session |
| `⌃⇧Space` (hold) | Dictate into the focused pane |

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

The `auto` flow is an alternative for features you want built unattended. `grove-auto` interviews the human about the outcome, then writes a research map and a decision-and-slice plan; one `grove-approve <slug> plan` unlocks `grove-run`, which builds each slice in its own child session on a `run/<slug>-<profile>` branch. After the final review, `grove-approve <slug> run` (from the run worktree) approves `04-run.md`; you then commit it and merge or open a PR. `resources/workflow.yaml` defines its stages: Outcome, Research, Plan, Run. Profiles in `grove.config.json` choose which agent and model plays each role, and `grove new --model <model>` (claude, opencode or copilot) sets the child session model.

## Development

```sh
npm run dev         # run with hot reload
npm test            # vitest
npm run typecheck   # node + web
npm run build
```

Architecture decisions are in [`docs/adr/`](docs/adr), and the domain vocabulary is in [`CONTEXT.md`](CONTEXT.md).

### Discovery roots

A workflow's discovery root (the `default` or the `key` read from its `from_file`)
must resolve inside the project, symlinks included. A root that points outside it
(for example `../shared-notes`) is refused and the project shows no features.

### Dependency scan

CI runs the OSV scanner on pull requests, weekly (Mondays) and on demand
("Run workflow" in GitHub Actions); it does not run on push to master. Pull
requests also run tests, typecheck and build as separate checks. The scan fails
on any advisory in the root `package-lock.json` unless it is listed in
[`osv-scanner.toml`](osv-scanner.toml). The `spikes/electron` lockfile is
scanned too, but its findings never fail the check.

To accept a finding, add an entry with an id, an expiry and a reason:

```toml
[[IgnoredVulns]]
id = "GHSA-xxxx-xxxx-xxxx"
ignoreUntil = 2027-01-31
reason = "No fixed version exists; not reachable from Grove"
```

Prefer upgrading to a fixed version; use an entry only when none exists or the
risk is judged acceptable. Once `ignoreUntil` passes, the scan fails on that
advisory again. `scripts/check-osv-ignores.mjs` (a CI step, with its own test) fails when an
entry lacks `ignoreUntil` or `reason`. Failures of the weekly and manual runs
arrive only as a failed Actions run and GitHub's email. The control socket's
missing authentication is a recorded accepted risk, not an ignore entry; see
[the note beside ADR 0027](docs/adr/0027-grove-cli-over-unix-socket-accepted-risk.md).

## Tech

Electron, React, Zustand, xterm.js, node-pty, tmux, CodeMirror.
