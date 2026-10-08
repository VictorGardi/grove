---
phase: questions
status: approved
version: 1
based_on: []
repo_heads: ["feature/xirp"]
approved_at: 2026-10-08
---

# Agent session sandboxing — questions

## Goal

Let a session's agent process (OpenCode/Claude) roam freely within its own working directory but be structurally unable to touch the rest of the host filesystem — opt-in per session, for longer sessions doing heavy code generation, not a default for every session.

## Out of scope

- Making sandboxing the default for all sessions (explicitly opt-in only)
- Cloud-hosted or remote sandboxes (e2b, Daytona, Modal) — local desktop use case only
- Replacing the tmux backend or building a new SessionBackend — the research confirms sandboxing wraps the argv inside the existing backend
- Persistent, declaratively-configured devcontainer-style environments — this is a disposable per-session jail
- Solving the worktree feature — related but separate; sandboxing should compose with it if both are enabled

## Research questions

*Neutral, factual questions about the current system. These must not reveal or imply the intended solution.*

1. How is a session's `argv` constructed today — from the agent source's `argv()` method through `loginShellArgv()` to the backend's `create()` call?
2. What environment variables does `cliEnv(session)` inject, and which of those must remain reachable inside any sandbox for existing features to work (e.g., `GROVE_SOCKET`, `GROVE_SESSION_ID`, hook-spool path)?
3. How does the hook-spool mechanism work for Claude sessions — what writes to `<userData>/agents/claude/<id>.jsonl`, and what reads from it?
4. How does the Grove CLI (`grove` command) communicate with a running session — what socket path, what protocol, and what session identity does it use?
4. What is the current `Session` schema in `src/shared/types.ts`, and how are schema migrations handled (reference ADR 0029 for the `cwd` field addition)?
5. How does the tmux backend's `create()` method receive and execute the `argv` — what does `tmux new-session ... -- <argv>` actually run?
6. What are the existing session-creation entry points (UI, CLI, next-action) and which of them currently accept or could accept a per-session option like `sandboxed: boolean`?
7. How does the app determine a session's working directory today — `Session.cwd` vs `Project.path` — and how is that passed to the backend?
8. What teardown/cleanup logic exists when a session ends — does the backend's `kill()` do anything beyond `tmux kill-session`, and would a sandbox need explicit teardown?
9. How does the diff/discovery/autolink machinery resolve paths — does it use `Session.cwd` or `Project.path`, and what would break if a session's cwd is a bind-mounted path inside a container?
10. What is the current state of the worktree-support feature (../2026-10-08-worktree-support/), and which of its design decisions (e.g., dedicated worktree per session) would intersect with sandboxing?

## Product questions for the human

*Only things the code cannot answer — priorities, trade-offs, constraints.*

### Q1: Isolation mechanism — pick one primary, or stage them?

**Answered: Apple `container` CLI only** — Prototype Apple's native container CLI as the single mechanism; accept macOS-only, sub-second starts, real VM isolation, no Docker needed.

Options from research:
- **Apple's native `container` CLI** (macOS-only, sub-second starts, real VM isolation, no Docker Desktop needed) — *your stated preference*
- **OS-level sandboxing** (macOS Seatbelt via `sandbox-exec`, Linux bubblewrap) — near-zero latency, no container/VM, kernel policy only; what Claude Code's built-in sandbox uses
- **`sbx` / Docker Sandboxes** — same infra this research session runs under; scriptable (`sbx run`, `sbx policy`), but needs Docker VM, seconds-level startup, bind-mount throughput tax on many-small-file workloads

| | Apple `container` | OS-level (Seatbelt/bwrap) | `sbx` / Docker |
|---|---|---|---|
| Isolation strength | Real VM (strongest) | Kernel policy (weaker) | Container/VM (strong) |
| Latency (cold) | ~sub-second | ~instant | ~seconds (Docker VM) |
| Network control | Thinner/less documented | Coarse (deny-all + proxy) | Rich (`sbx policy allow/deny`) |
| macOS only? | Yes | No (Linux too) | No |
| Dependencies | macOS 15+, Apple Silicon | None | Docker Desktop / KVM |
| Teardown | Auto on exit | Auto on exit | Explicit `sbx rm`/`prune` |

**Decision:** Apple `container` CLI only. macOS-only is accepted. OS-level and `sbx` are not pursued unless Apple's CLI proves fundamentally insufficient.

---

### Q2: Is macOS-only acceptable for Grove's actual users?

**Answered: Yes, Grove is macOS-only.** Apple's container CLI's requirement (Apple Silicon + macOS 15+) is acceptable — no Linux sandboxing story needed.

Apple's `container` CLI requires Apple Silicon + recent macOS (15+). The research notes this is "fine for a macOS-only app" — but is Grove macOS-only in practice, or do you have/plan Linux users who would need sandboxing too?

---

### Q3: Per-session opt-in UX — how does the human enable it?

**Answered: Toggle at session creation** — Checkbox in the new-session dialog (UI) and `--sandboxed` flag (CLI) — explicit per-session decision.

- **Toggle at session creation** (checkbox in the new-session dialog / `--sandboxed` CLI flag)
- **A kind of session** (e.g., `kind: 'opencode-sandboxed'` — but this proliferates kinds)
- **Project-level default** (project setting: "sandbox all agent sessions in this project")
- **Something else?**

---

### Q4: Network policy default — fully offline, or allow-list?

**Answered: Use Docker Sandboxes (`sbx`) default allow-list as reference** — The user notes Docker Sandboxes must have a default allow-list for API hosts; adopt the same approach since "this must have been solved before."

- **Fully offline** (deny all egress) — safest, but agent can't reach its API host (Anthropic/OpenAI/OpenCode server)
- **Allow-list for agent's API host(s) + OpenCode's local HTTP port** — minimal viable connectivity; requires knowing the API hostnames at sandbox-creation time
- **Something else?** → **Use `sbx`/`Docker Sandboxes` default allow-list as the reference** — adopt what Docker's sandboxing product uses out of the box for agent API connectivity (e.g., a local proxy for granular per-host control)

---

### Q5: What's exposed inside the sandbox besides the working directory?

**Answered: Bind-mount everything needed** — Working directory (rw), hook-spool (rw, Claude), Grove socket (rw, both), OpenCode HTTP port (accessible from host UI), plus API host egress via allow-list.

The research identifies two host paths that must be reachable at identical paths for existing features to keep working:
1. **Claude hook-spool file** (`<userData>/agents/claude/<id>.jsonl`) — written by inline shell snippets in Claude's hooks, read by the Claude source
2. **Grove control socket** (`<userData>/grove.sock`, `GROVE_SOCKET`) — for `grove` CLI access from inside the session

Additional for OpenCode:
- **OpenCode HTTP port** — local server port that the Grove UI connects to for the agent source; must be reachable from host

Options:
- **Bind-mount both in** (read-write) — keeps all current features working (hooks, `grove` CLI, status line)
- **Bind-mount neither** — sandboxed session loses hook-spool (Claude event streaming degrades) and `grove` CLI capability
- **Bind-mount only hook-spool** — keeps Claude event streaming, loses `grove` CLI
- **Something else?**

**Decision:** Bind-mount everything needed: working dir (rw) + hook-spool (rw, Claude) + Grove socket (rw, both) + OpenCode HTTP port (accessible from host UI) + API host egress via allow-list.

---

### Q6: Relationship to worktree support — should a sandboxed session always run against a dedicated worktree?

**Answered: Independent** — Sandboxed sessions can run against the shared project checkout (bind-mounted rw) or a worktree; the two features are independent opt-ins.

The worktree feature (../2026-10-08-worktree-support/) would give each session a clean, disposable writable root (a git worktree) instead of the shared project checkout. A sandboxed session's writable root is naturally the worktree directory.

- **Always pair them** — sandboxed ⇒ dedicated worktree (cleanest isolation: sandbox can't touch main checkout even via bind-mount escape)
- **Independent** — sandboxed sessions can run against the shared project checkout (bind-mounted read-write) or a worktree
- **Default to worktree, allow override** — sandboxed defaults to a fresh worktree, but human can pick the shared checkout

**Decision:** Independent. Sandboxing works without waiting for the worktree feature; bind-mount whatever `Session.cwd` is (project path or worktree). The worktree feature can compose later if both are enabled.

Pros/cons considered:
- **Always pair**: cleanest isolation, but requires worktree feature first, more git ops, no quick main-checkout sandboxes
- **Independent**: works today, simpler impl, but weaker isolation if cwd=project.path, two separate opt-ins
- **Default to worktree**: best of both, but most complex (conditional logic, two code paths)

## Size verdict

**M** (standard flow)

Reasons:
- Clear result: one new per-session flag, one argv-wrapping module, a UI toggle, and a schema migration — no new `SessionBackend`
- Known pattern: substitutes what gets `exec`'d inside the existing `loginShellArgv` → `backend.create()` seam (ADR 0010, `src/core/env.ts:42`, `src/core/core.ts:634-637`)
- ≤ ~3 files for core logic (sandbox wrapper module, schema migration, UI toggle)
- Two two-way decisions: isolation mechanism (Q1) and network policy (Q4) — both reversible at runtime
- One schema change: `Session.sandboxed` boolean (like `cwd` in ADR 0029)
- No unfamiliar modules — touches `core.ts`, `env.ts`, `tmux.ts`, session store, session-creation UI
- One user-visible outcome: a checkbox at session creation that confines the agent process

Proposed flow: **standard** (questions → research → design → structure → plan → implement)

---

## Open questions

None — all product questions resolved above.