# Build a feature-focused desktop workspace for OpenCode

You are building a macOS desktop app, `<APP_NAME>`. It combines three things:

- **Xirp's model:** real coding-agent TUIs in persistent terminals, managed from
  one window, with live status per session.
- **HumanLayer's model:** everything is organised around **features (tasks)**,
  not chat sessions. Each feature has stages, artifacts, sessions, and a clear
  next action.
- **My existing workflow:** my `grove-*` skills (questions → research → design →
  structure → plan → implement) produce markdown artifacts and a `feature.md`
  manifest per feature. The app must know **nothing** about those specific
  phases. All workflow knowledge lives in one config file (`workflow.yaml`).

The app embeds OpenCode's own TUI. It does **not** build a chat UI.

## How to work

1. Read this whole spec.
2. List the ambiguities and the one-way-door decisions you find. Ask me about
   them **one at a time**, each with 2–3 options and your recommendation.
3. Do **Phase 0** (the spikes) and report the findings **before** writing any
   app code.
4. Then build phase by phase. Stop after each phase for my review.

---

## 1. Locked decisions

1. **Embed, don't rebuild.** Sessions run the real `opencode` TUI in a PTY,
   rendered with xterm.js. No custom message rendering.
2. **Persistence comes from a session backend, not the window.** Closing the
   app must not kill sessions. The backend sits behind an adapter: herdr is
   preferred, tmux is the fallback. Phase 0 decides which.
3. **Workflow-agnostic.** Stage names, columns, next actions and gate logic
   come only from `workflow.yaml`. No code may mention `questions`, `design`,
   `grove-*` and so on. Swapping in a different workflow must need only a new
   `workflow.yaml`.
4. **Files are the source of truth.** The app reads `feature.md` and artifact
   frontmatter. It never edits artifacts. It writes only:
   - a new `feature.md` when I create a feature from the app
   - a sessions file per feature (§4.3)
   - its own app config
5. **Stage is derived, never dragged.** A feature's column is computed from its
   artifact state, as in HumanLayer's board. You move a feature forward with
   **next-action buttons**, which start sessions. There is no drag-and-drop.
6. **Approvals go through the agent.** An "Approve" action sends the approve
   command to a session. The app never flips a status itself.
7. **Local only.** No accounts, no cloud, no telemetry.

---

## 2. Phase 0: spikes (report back before building)

Write throwaway scripts in `spikes/` and give me a short findings report.

1. **herdr API**
   - Can we create a workspace or pane with a given cwd and label, start
     `opencode` in it, and get a stable id back?
   - Can we read agent status (working / blocked / done / idle) as JSON, and
     subscribe to changes or poll cheaply?
   - **Crucial:** can a single pane be attached from an external PTY, so it can
     be rendered in our own xterm.js without herdr's own UI around it?
   - Does herdr report the OpenCode session id?
2. **tmux fallback.** The same questions using `tmux new-session -d`,
   `tmux attach -t`, and status detection.
3. **OpenCode**
   - How do we start the TUI with an initial prompt or command (for example
     `/grove-design ENG-123`)? If there's no flag, can we type it in once the
     TUI is ready?
   - Can each TUI instance's local server port be fixed or discovered, so we
     can read structured status from its event stream instead of parsing the
     screen?
   - How do we resume a session by id?
4. **xterm.js + node-pty in Electron** rendering the OpenCode TUI: colours,
   mouse, resize, and keybindings (`Cmd+K`, `Esc`, `Ctrl+C`). List any
   conflicts.
5. **Recommendation:** which backend to use, which status source (backend,
   OpenCode server, or both), and any change needed to this spec.

---

## 3. Tech stack (confirm in the grilling round)

- Electron, TypeScript, React, Vite. Recommended over Tauri because
  node-pty + xterm.js is well-proven in Electron. Ask me if you disagree.
- xterm.js with the WebGL and fit addons, and node-pty.
- chokidar (file watching), gray-matter (frontmatter), yaml, markdown-it with
  Mermaid rendering for artifacts that have no HTML companion.
- vitest for unit tests, especially stage derivation and workflow parsing.
- Security:
  - `contextIsolation: true`, no `nodeIntegration` in the renderer, and a
    typed preload IPC bridge only.
  - Artifact HTML is shown in a sandboxed iframe (scripts allowed, no
    same-origin, no access to Node).

---

## 4. Data model

### 4.1 App config: `~/.config/<APP_NAME>/config.json`

```json
{
  "workspaceRoot": "~/git",
  "hub": "~/git/eng-hub",
  "workflow": "~/git/eng-hub/workflow.yaml",
  "backend": "herdr",
  "agentCommand": "opencode",
  "plannotatorCommand": "plannotator"
}
```

### 4.2 Feature discovery

- Scan `<hub>/<featuresDir>/*/feature.md`.
- Also scan each registered repo's `<artifactRoot>/*/feature.md`. Read
  `featuresDir` and `artifactRoot` from the existing `grove.hub.json` and
  `grove.config.json` files. This is a config read, not workflow knowledge.
- Watch with chokidar and update the UI live.
- A feature folder with a `feature.md` but no artifacts is in the **backlog**.

### 4.3 Sessions file: `<feature folder>/.sessions.json`

Gitignored, because it's machine-local.

```json
[{ "id": "uuid", "action": "research", "repo": "api", "cwd": "~/git/eng-hub",
   "backendRef": "herdr-pane-id", "opencodeSession": "ses_…",
   "startedAt": "…", "endedAt": null, "status": "working" }]
```

### 4.4 `workflow.yaml` (the only place the workflow exists)

The app ships an example `workflow.yaml` written for my grove skills. The code
itself must stay generic. Draft schema (refine it with me):

```yaml
artifact_dir_glob: "*.md"
stages:                      # ordered; a feature's stage = the first stage not yet complete
  - id: questions
    label: Questions
    artifact: "01-questions.md"
    complete_when: { status: approved }   # or: exists | status in [...]
    soft: true                            # a draft counts as complete for derivation
  - id: research
    label: Research
    artifact: "02-research.md"
    complete_when: { exists: true }
  - id: design
    label: Design
    artifact: "03-design.md"
    review: "03-design.html"              # what the Review button opens
    complete_when: { status: approved }
  # … structure, plan, implement
  - id: implement
    label: Implementation
    per_repo: true                        # one action/session per repo in feature.repos
    artifact: "06-implementation-{repo}.md"
    complete_when: { all_checked: "05-plan-{repo}.md" }
actions:
  start:   { label: "Start {stage}", prompt: "/grove-{stage} {slug}", cwd: "{home}" }
  revise:  { label: "Revise",  prompt: "/grove-{stage} {slug} {feedback}", cwd: "{home}", needs_input: true }
  approve: { label: "Approve", prompt: "/grove-approve {slug} {stage}", cwd: "{home}" }
  implement_repo: { label: "Implement in {repo}", prompt: "/grove-implement {slug}", cwd: "{repo_path}" }
stage_actions:
  default:   [start, revise, approve]
  implement: [implement_repo]
```

Supported template variables: `{slug}`, `{stage}`, `{home}`, `{repo}`,
`{repo_path}`, `{feedback}`. The workflow file is validated at load time, and
the app shows clear errors in a banner rather than crashing.

### 4.5 Card state (derived, generic)

| State | Meaning |
|---|---|
| `backlog` | no artifacts yet |
| `running` | a live session for this feature is working |
| `waiting` | a session needs input; a permission prompt or question is shown |
| `needs-review` | the current stage's artifact exists, isn't complete, and no session is running |
| `ready` | the stage is complete; the next action is available |
| `done` | every stage is complete |

---

## 5. UI

Dark, calm, dense, keyboard-first. Take inspiration from Xirp and HumanLayer
without copying either.

- **Left sidebar: features.**
  - Grouped by stage, with a toggle between a List and a Board layout. Board
    columns are the stages from `workflow.yaml`. Cards are not draggable.
  - Each row shows the title, slug, repos, and a state badge.
  - A count of waiting features goes in the header, with a native
    notification when a feature becomes `waiting`.
- **Center: the feature page.**
  - Header: the title, the stage timeline (stages from the workflow, current
    one highlighted), and the **next-action buttons** for the current stage.
  - Tabs: **Sessions**, **Terminal**, **Artifacts**.
    - Sessions: a table of current and past sessions; click one to open its
      terminal.
    - Terminal: the embedded OpenCode TUI for the selected live session. More
      than one terminal opens as tabs.
- **Right panel: the artifact viewer.**
  - Shows the current stage's `review` HTML (or rendered markdown) in the
    sandboxed iframe.
  - An artifact switcher.
  - Buttons: "Open in Plannotator", "Copy path", "Open in editor".
- **New feature** (`Cmd+N`): title, optional ticket id, repos (from the hub
  config), and a markdown body. Writes `feature.md` into the hub (when it's
  multi-repo) or into the repo's artifact root.
- **Command palette** (`Cmd+K`): jump to a feature, run an action, open a
  terminal.
- **Grid view** (later): several live terminals side by side.

---

## 6. Runner adapter interface

```ts
interface SessionBackend {
  start(opts: { cwd: string; label: string; command: string; initialInput?: string }): Promise<BackendRef>;
  attach(ref: BackendRef): PtyStream;          // for xterm.js
  status(ref: BackendRef): Promise<AgentStatus>; // working | waiting | idle | done | gone
  onStatus(cb: (ref: BackendRef, s: AgentStatus) => void): Unsubscribe;
  sessionId?(ref: BackendRef): Promise<string | null>; // OpenCode session id, if known
  stop(ref: BackendRef): Promise<void>;
  list(): Promise<BackendRef[]>;               // re-adopt live sessions after an app restart
}
```

Implement the backend Phase 0 recommends. Leave the other as a stub.

---

## 7. Phases

- **Phase 1: read-only workspace.** Config, discovery, the workflow parser,
  stage and state derivation (with unit tests), the sidebar list and board, the
  feature page, the artifact viewer. No terminals yet.
- **Phase 2: terminals.** The session backend, starting a plain OpenCode
  session for a feature, the embedded terminal, live status dots,
  re-adopting live sessions after a restart, and `.sessions.json`.
- **Phase 3: actions.** Next-action buttons from the workflow (including
  `needs_input` actions like Revise, with a text box), per-repo actions, New
  Feature, notifications, and the command palette.
- **Phase 4: polish.** Grid view, session resume, a better status source (the
  OpenCode server, if Phase 0 found it viable), keyboard shortcuts, and
  packaging into a signed or ad-hoc `.app`.

Each phase ends with: tests passing, a short demo script I can follow, and a
list of known gaps.

---

## 8. Changes needed in my skills repo (note them; don't make them here)

- `grove-questions` must accept the slug of an existing `feature.md` and
  snapshot its body as `00-ticket.md` when there is no tracker ticket.
- Add `.sessions.json` to the gitignore entries that `grove-setup` writes.

Write these into `docs/skills-changes.md` for me to apply separately.

---

## 9. Non-goals (for now)

A custom chat UI, cloud sync, multi-user features, Linux and Windows support,
editing artifacts inside the app, and running non-OpenCode agents. The adapter
should make other agents possible later, but don't build that now.
