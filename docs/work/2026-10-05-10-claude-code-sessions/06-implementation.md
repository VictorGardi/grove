---
feature: 2026-10-05-10-claude-code-sessions
phase: implementation
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 05-plan.md@3
forced: []
---

# Implementation: Claude Code sessions

## Progress

- [x] Slice 1 — Tracer: start a Claude session, spool fills; state v2 (capture partial; see below)
- [x] Slice 2 — Seam generalised (D1), OpenCode unchanged 
- [x] Slice 3 — Claude live status
- [ ] Slice 4 — Claude auto-link and restart catch-up
- [ ] Slice 5 — Claude resume and cleanup

## Slice 1

Deviations (mechanical, no design impact):

- Core creates the spool dir (`mkdirSync`, mode 0700) in `sessionCreate` for now; the design puts this in `SpoolClaude`, which arrives in slice 3.
- `CoreOptions.claudeSpoolDir?: string` stands in for the Claude source until slice 3; without it `sessionCreate({kind:'claude'})` returns `no-source` (the design's error for a missing source).
- `withStatus` and the OpenCode id lookups in `linkWrite`, `catchUp`, `wrote` and `resync` also require `kind === 'opencode'`, so a Claude card never takes OpenCode status before slice 2 makes these per kind.
- `readVersioned` stamps `schemaVersion: n + 1` itself after `migrations[n]`, so a migration only reshapes the data.
- `setupCore().make(now, over)` takes option overrides; `createClaude` helper added to `src/core/testing/setup.ts`.
- `IconName` now includes `claude` (Lucide asterisk); `SessionsBoard` and `Sidebar` pass `s.kind` as the icon name; `.iconOpencode` renamed `.iconAgent`.

Verification: `npm test -- src/core/store src/core/claude src/core/sessions.test.ts` (57 passed), `npm run typecheck` clean, `npm test` (298 passed, run outside the sandbox). A throwaway check confirmed the `--settings` JSON survives `loginShellArgv` quoting with a userData path containing a space.

### Hook capture (2026-10-07, claude 2.1.285)

Fixture: `src/core/claude/fixtures/capture-2.1.285.jsonl` (spool of session `4049dd18-…`, permission mode `acceptEdits`, the user's sandbox on). 24 records, 17.6 KB, one record per line, 401–1279 bytes each, **no corrupt span**, no interleaving seen. Delivery works, so E-D10 holds.

What the session actually exercised (in order): resume right after start, plain prompt, Bash, Write + Bash in one batch, AskUserQuestion (rejected with Esc), Write + Bash (sandbox-denied), `/clear` + prompt.

| Hook | Fired | Fields the mapping uses | Notes |
|---|---|---|---|
| `SessionStart` | 3× | `source` (`startup`, `resume`, `clear`), `session_id` | `--resume <id>` keeps `session_id`; `/clear` gives a **new** `session_id` (`07e96ba9-…`), so the resume-id rule (latest `SessionStart` id) holds |
| `UserPromptSubmit` | 6× | `prompt_id`, `permission_mode` | also carries `prompt` text |
| `PreToolUse` AskUserQuestion | 1× | `tool_use_id`, `tool_name` | as designed |
| `PermissionRequest` | 1× | `tool_name` = **`AskUserQuestion`** | **fires for the question tool too**; has no `tool_use_id`. No PermissionRequest for a real tool was captured (Bash ran without a prompt under acceptEdits + sandbox) |
| `PostToolUse` | 2× (Write) | `tool_use_id`, `tool_input.file_path` (absolute, realpath `/private/tmp/…`) | no Edit/MultiEdit captured; none for the rejected AskUserQuestion |
| `PostToolUseFailure` | 1× (Bash, sandbox deny) | `tool_use_id`, `is_interrupt: false`, `error` | |
| `PostToolBatch` | 5× | `tool_calls[].tool_use_id` | **each call carries full `tool_input` and `tool_response`, for every tool incl. Bash** (and would for Read) |
| `Stop` | 4× | — | `stop_hook_active: false`; not after the rejected question |
| `StopFailure` | 0 | — | not provoked |
| `Notification` `idle_prompt` | 0 | — | not provoked (the next prompt came 9 s after the Esc) |
| subagent `agent_id` | 0 | — | not provoked |

The Esc on the question (transcript: "Request interrupted by user for tool use") fired **no** hook at all: no PostToolUse(Failure), no Stop. The turn closed only on the next `UserPromptSubmit`, as the design's interrupt risk expects.

Findings against `03-design.md` (not acted on; see the slice 1 stop):

1. `PermissionRequest` with `tool_name: AskUserQuestion` would open `perm:main` next to `q:<id>`; with precedence permission > question the card would say "waiting · permission" for a question, and nothing would close it until the next prompt or Stop (a rejected question fires no Post hook).
2. `PostToolBatch` copies every tool's input and response (Bash output, and Read file contents) into the spool, which contradicts two-way decision 4 ("Read/Bash payloads stay out of the spool").
3. Not exercised: a real tool's `PermissionRequest`, an answered AskUserQuestion, Esc during a working turn + `idle_prompt` after 60 s, Edit/MultiEdit, parallel hooks writing at once, subagent scope.

Human decision (2026-10-07): continue to slice 2 now. The second capture (item 3) and a `grove-design` revise of the mapping for findings 1–2 are deferred; both must be settled before slice 3, which implements the mapping.

## Slice 2

Deviations (mechanical, no design impact):

- Temporary bridge: Claude has no source until slice 3, so `sessionCreate` keeps slice 1's `claudeSpoolDir` launch path when no `claude` source is registered. Without either, an agent kind returns `no-source`. Slice 3 removes the bridge.
- A session whose kind has no registered source gets no status, seen mark or notification. This is how "kind filters" work for now: Claude cards stay running / gone until slice 3 adds `SpoolClaude`.
- `sessionResume` still accepts only `kind === 'opencode'` (`not-opencode`; slice 5 generalises it) and returns `no-source` when no OpenCode source is registered. Before, it built the argv inline even without a source.
- Added `withAllStatus` (runs `withStatus` for each state) and `sessionOf(st, agentId)` helpers in `core.ts`.
- `HttpOpenCode.argv` / `forget` and `FakeAgentSource.argv` declare the interface's unused parameters (`_mode`, `_id`) so direct calls typecheck.
- `FakeAgentSource.argv(id)` returns `[kind, '-s', id]`, so the existing `exec opencode -s <id>` expectations hold unchanged.

Verification: `npm run typecheck` clean; `npm test` 301 passed (outside the sandbox), including the existing "core opencode status", "core seen and notify", "core auto-link" and "resume" tests with only import renames and the fake swapped. Manual OpenCode check passed (human, 2026-10-07: "works great").

## Slice 3

Re-planned against design and structure v2 (plan `based_on` updated; slices 1–2 unaffected by v2).

- Part A done: `PostToolBatch` writes only a marker (`hooks.ts` + test, `npm test -- src/core/claude` 4 passed).

### Hook capture 2 (2026-10-07, claude 2.1.285)

Fixture: `src/core/claude/fixtures/capture-2.1.285-b.jsonl` (spool of session `1c076504-…`, default permission mode). 46 records, 40.8 KB, one record per line, 68–7639 bytes each, **no corrupt span**, no interleaving seen. Delivery works; E-D10 holds.

| Hook | Fired | Fields the mapping uses | Notes |
|---|---|---|---|
| `SessionStart` | 1× | `session_id` | `source: startup` |
| `UserPromptSubmit` | 13× | — | 2 of them are Claude's own `<task-notification>` prompts (a background shell task and a background subagent finishing), each starting a turn that ends in `Stop` |
| `PermissionRequest` | 7× | `tool_name`, `agent_id` | real tools seen: Bash (4×, one approved after 16 s), Edit (2×), AskUserQuestion (1×, ignored as designed); **no `tool_use_id`**. One from a subagent carries `agent_id` + `agent_type` |
| `PreToolUse` AskUserQuestion | 1× | `tool_use_id` | |
| `PostToolUse` | 3× | `tool_use_id`, `tool_name` | answered AskUserQuestion (same `tool_use_id` as its PreToolUse: closes `q:`); Edit ×2 (each closes the Edit's `perm:main`). Edit's `tool_response` holds the whole file (~6.9 KB) |
| `PostToolUseFailure` | 0 | — | |
| `PostToolBatch` | 13× | — | marker only, 68 bytes; closes Bash permissions (Bash has no PostToolUse hook) |
| `Stop` | 11× | `agent_id` absent | none after the Esc |
| `Notification` `idle_prompt` | 0 | — | the Esc was followed by a new prompt after 17 s, so it couldn't fire |

Design risk items: a real tool's `PermissionRequest` — **seen**; an answered question — **seen**; Edit — **seen**; subagent `agent_id` — **seen** (on `PermissionRequest`; its batch marker closes it); parallel appends — none seen; `idle_prompt` after an interrupt — **still unseen** (capture 1 shows `idle_prompt` 60 s after a `Stop`: its table said "0", but the fixture's last record is one).

Esc during a working turn (07:31:18–21) fired no hook; the turn closed on the next `UserPromptSubmit`, as the design's interrupt risk expects.

Mapping rows: **no change**. Every observed record maps through the table as written.

Observed, not acted on: a background subagent's `PermissionRequest` arrived after the main `Stop` (the main turn ends while background work continues). The mapping shows it as `waiting · permission`, which is right; while background work runs without asking anything, the card shows idle / waiting · done.

Part B deviations (mechanical, no design impact):

- `ClaudeFold` carries `id` (the spool's file id), so `step(fold, record)` keeps its two-argument signature and still emits events keyed by file id.
- `SpoolTail` delivers `(id, records, initial)`; `SpoolClaude.start()` folds records already in the spools without emitting events, then emits `connected` (version `'spool'`). `snapshot` reads the in-memory folds, so it matches the events exactly.
- A spool whose only record is `SessionStart` has a fold (it shows in `snapshot` after a restart) but no live tracker until its first event (normally the first prompt), so the card shows tmux `running` until then.
- `PostToolUse(Failure)` closes `q:<tool_use_id>` and `perm:<scope>` only if they are open; `Stop`/`Notification` always close everything; `UserPromptSubmit` and `Stop` always emit their event, even when the fold doesn't change.
- `scanRecords` resyncs on the literal `{"t":"`; an object nested in `e` whose first key is `"t"` with a string value only matters inside a corrupt span.
- `setupCore()` now registers `FakeAgentSource('claude', true)` next to the OpenCode fake and returns it as `claude`; the Claude launch test uses a real `SpoolClaude` on `claudeDir`.

Verification: `npm test -- src/core/claude src/core/sessions.test.ts` (69 passed), `npm run typecheck` clean, `npm test` (332 passed, outside the sandbox). Manual check passed (human, 2026-10-07: "works").

## Slice 4

Deviations (mechanical, no design impact):

- `src/core/core.ts` unchanged: slice 2 already made `linkWrite`, `catchUp` and `resync` per `SourceState`, and a replayed `Stop` reaches `statusOf` through the snapshot, so "per-state catch-up" needed no code.
- `NotebookEdit` names its path `tool_input.notebook_path`, not `file_path` (Claude Code's tool schema; not in either capture). The `wrote` row takes `file_path`, else `notebook_path`; no string path → no `wrote`.
- Tests for kind claude live in a new `describe('core auto-link (claude)')` in `features.test.ts`; the restart test uses a real `SpoolClaude` on `claudeDir` and also checks the restarted core sends no notification.

Verification: `npm test -- src/core/claude src/core/features.test.ts` (53 passed), `npm run typecheck` clean, `npm test` (336 passed, outside the sandbox). Manual check: pending (human).

## Open questions
