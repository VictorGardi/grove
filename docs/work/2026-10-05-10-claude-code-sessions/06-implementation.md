---
feature: 2026-10-05-10-claude-code-sessions
phase: implementation
status: stale
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 05-plan.md@1
forced: []
---

# Implementation: Claude Code sessions

## Progress

- [x] Slice 1 — Tracer: start a Claude session, spool fills; state v2 (capture partial; see below)
- [x] Slice 2 — Seam generalised (D1), OpenCode unchanged 
- [ ] Slice 3 — Claude live status
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

## Open questions
