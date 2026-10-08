---
feature: 2026-10-05-10-claude-code-sessions
phase: structure
status: approved
version: 2
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@2
  - parent:04-structure.md@6
forced: []
---

# Structure: Claude Code sessions

Five vertical slices inside the epic's scope for child 10 (E-D3, E-D5, E-D6,
E-D7, E-D10). Each ends with `npm run typecheck` and `npm test` green (the
real-tmux and stub-server tests need to run outside the agent sandbox), plus
the listed checks.

## Slices

### Slice 1 — Tracer: start a Claude session, spool fills; state v2

- **Outcome:** the ＋ modal offers "Claude Code"; it starts
  `claude --session-id <uuid> --settings <hooks>` via the login shell in tmux,
  labelled "Claude · HH:MM" with a `claude` glyph; hook records land in
  `<userData>/agents/claude/<uuid>.jsonl`. The card shows running / gone only.
  An existing v1 `state.json` loads as v2 with sessions intact. The hook
  payloads are captured live and committed as the adapter's fixture.
- **Files:** NEW `src/core/claude/hooks.ts` + test. MODIFIED
  `src/shared/types.ts` (`SessionKind` + `claude`, `agentSessionId`,
  `StateFile` v2), `src/core/store/jsonFile.ts` (`migrations`),
  `src/core/store/stateStore.ts` (v1 → v2) + tests, `src/core/sessions.ts`
  (`newSession({…, agentSessionId})`, label), `src/core/core.ts`
  (`agentSessionId` everywhere; Claude argv by kind for now; spool dir option;
  save v2), `src/main/index.ts` (spool dir), `NewSessionModal.tsx`,
  `ui/Icon.tsx`, `Sidebar.tsx` (agent icon/tone). NEW
  `src/core/claude/fixtures/capture-2.1.285.jsonl`.
- **Signatures:** `hookSettings(spool: string): string`;
  `claudeArgv(id, spool, mode: 'start' | 'resume', resumeId?): string[]`;
  `readVersioned(file, version, empty, onBad?, migrations?)`.
- **Verify:** `npm test -- src/core/store src/core/claude src/core/sessions.test.ts`
  (v1 file with `opencodeSessionId` → v2 `agentSessionId`, written back as v2;
  `hookSettings` lists the design's hooks and matchers with the quoted spool
  path; Claude `argv[4]` starts `exec claude --session-id <uuid> --settings`).
  Manual: `npm run dev`, start Claude Code, then in that session: a plain
  prompt; a Bash command needing permission (wait > 6 s); a prompt that makes
  it ask a question (AskUserQuestion); Esc mid-turn and wait 60 s; a prompt
  making parallel Edits; `/clear` and a prompt; kill the tmux server and run
  `claude --resume <uuid>` by hand. Copy the spool to the fixture and record per
  hook in 06-implementation.md: fired or not, fields used by the mapping, sizes,
  any corrupt span. No hook record at all → stop: E-D10 reopens.
- **Depends on:** —

### Slice 2 — Seam generalised (D1), OpenCode unchanged

- **Outcome:** core runs `sources: AgentSource[]` with a `SourceState` per
  kind; OpenCode's id minting and argv live in `HttpOpenCode`; behaviour is
  identical for OpenCode and Claude cards still show running / gone.
- **Files:** NEW `src/core/agents/types.ts`,
  `src/core/testing/fakeAgentSource.ts`. DELETED `src/core/opencode/types.ts`,
  `src/core/testing/fakeOpenCode.ts`. MODIFIED `src/core/opencode/client.ts`,
  `normalise.ts`, `src/core/status.ts` (`withStatus` per kind),
  `src/core/core.ts`, `src/core/testing/setup.ts`, `src/main/index.ts`, all
  tests importing the old names.
- **Signatures:** `AgentSource { kind, statusNeedsEvent, mintId, argv, start,
  snapshot, lastWrites, forget, stop }`; `SourceState`;
  `withStatus(sessions, kind, trackers, connected, needsEvent)`.
- **Verify:** `npm test` (every existing "core opencode status", "core seen and
  notify", "core auto-link", "resume" test passes with only renames and the
  fake swapped) and `npm run typecheck`. Manual: `npm run dev`, an OpenCode
  session still shows working → idle and waiting · permission.
- **Depends on:** 1

### Slice 3 — Claude live status

- **Outcome:** Claude cards show working, waiting · permission, waiting ·
  question, waiting · done (finished, unseen) and idle; they count in the
  waiting header, notify off screen, and take the seen mark. A session whose
  spool has no record shows running / gone only.
- **Files:** NEW `src/core/claude/spool.ts`, `normalise.ts`, `source.ts` +
  tests, `src/core/claude/fixtures/capture-2.1.285-b.jsonl` (second
  capture). MODIFIED `src/core/claude/hooks.ts` + test (`PostToolBatch`
  marker command), `src/core/core.ts` (Claude source wired; kind filters
  `!== 'terminal'`; slice 1's `claudeSpoolDir` launch bridge removed),
  `src/main/index.ts` (`new SpoolClaude({dir})`),
  `src/renderer/src/sessionStatus.ts`.
- **Signatures:** `scanRecords(text) → {records, consumed}`;
  `step(fold, record) → {fold, events}`; `class SpoolClaude implements AgentSource`.
- **Verify:** first, a second human-driven capture with the marker command
  in place, in default permission mode: a Bash command that prompts
  (approved after > 6 s), an answered question, Esc during a working turn
  then wait 60 s, an Edit of an existing file, a prompt that uses a
  subagent. Record per hook in 06-implementation.md; mapping rows adjust to
  it (a row change is logged; no hook record at all → stop: E-D10 reopens).
  Then `npm test -- src/core/claude src/core/sessions.test.ts`
  (both fixtures replay to the mapping table's events, incl. AskUserQuestion
  → waiting · question not permission, and an Esc-rejected question closed
  by `idle_prompt`; `PostToolBatch` command writes only the marker; scanner handles glued
  records, a missing trailing newline and a corrupt span; tail emits only
  bytes appended after `start()`; core "claude status": `FakeAgentSource('claude')`
  permission → waiting · permission, notify fires off screen only, no status
  before the first record; an OpenCode `disconnected` leaves Claude status).
  Manual: `npm run dev`, Claude session asks permission while another session
  is focused → notification, card "waiting · permission"; approve → working → idle.
- **Depends on:** 2

### Slice 4 — Claude auto-link and restart catch-up

- **Outcome:** a Claude Write/Edit into a feature folder links the session
  (pins respected); after an app restart, status and links are rebuilt from the
  spool, a turn finished while grove was closed shows waiting · done only if it
  ended after the seen mark.
- **Files:** MODIFIED `src/core/claude/normalise.ts` (`wrote`, `lastWrite`),
  `source.ts` (`snapshot`, `lastWrites` from the fold), `src/core/core.ts`
  (per-state catch-up), tests in `src/core/features.test.ts`.
- **Signatures:** `ClaudeFold.lastWrite: string[]`; `lastWrites(id)`.
- **Verify:** `npm test -- src/core/claude src/core/features.test.ts`
  ("core auto-link" for kind claude: write → linked, pinned untouched, held
  until discovered; catch-up after start from `lastWrites`; replayed `Stop` with
  `t` before `seenAt` → idle, after → waiting · done). Manual: quit grove, let
  a Claude session (still in tmux) edit a file in a feature folder and finish,
  relaunch → card linked to that feature and "waiting · done".
- **Depends on:** 3

### Slice 5 — Claude resume and cleanup

- **Outcome:** gone Claude cards and the "Session ended" view offer Resume,
  which reopens the current conversation (after `/clear`, the post-clear one).
  Removing a Claude session, or its project, deletes its spool.
- **Files:** MODIFIED `src/core/claude/source.ts` (`argv('resume')` with the
  resume id, `forget`), `src/core/core.ts` (`sessionResume` per kind,
  `not-agent`; `forget` on remove), `Sidebar.tsx`, `App.tsx`, tests in
  `src/core/sessions.test.ts`.
- **Signatures:** `ClaudeFold.resumeId: string | null`;
  `argv(id, 'resume')`; `forget(id)`.
- **Verify:** `npm test -- src/core/claude src/core/sessions.test.ts` (resume
  argv `exec claude --resume <latest SessionStart id> --settings`; terminal →
  `not-agent`; session and project remove delete the spool file). Manual:
  `npm run dev`, Claude session, `/clear`, a prompt, kill the tmux server →
  card gone → Resume → the post-clear conversation with its history; Remove →
  spool file gone.
- **Depends on:** 4

## Appetite check

The epic's structure sizes this child at 4–5 days, about 6 slices and at most
2 own one-way decisions. This structure has 5 slices (about a day each, slice
2 the riskiest) and 1 own one-way decision. Revision 2 adds a second hook
capture to slice 3 (about half a day). It still fits; the epic's appetite
(~6–7 weeks) is unchanged.

## Deferred

- Spool compaction or rotation.
- A Claude connection banner or Claude CLI version warning.
- Linking on files written by Bash or external processes.
- Next-action prompts for Claude sessions (child 5).

## Rollout / migration

`state.json` moves to `schemaVersion: 2` on first save after slice 1. An older
build opening it moves it aside as `.bad-<ms>` (ADR 0017; development builds
only). Spool files appear under `<userData>/agents/claude/` and are removed
with their sessions.

## Open questions
