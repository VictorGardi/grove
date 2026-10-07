---
feature: 2026-10-05-10-claude-code-sessions
phase: plan
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Plan: Claude Code sessions

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

## Slice 1 — Tracer: start a Claude session, spool fills; state v2

Context: today `Session.opencodeSessionId` holds OpenCode's id, `StateFile.schemaVersion` is 1,
`readVersioned` moves any file with another version aside, and `sessionCreate` builds argv only
for `kind === 'opencode'`. This slice renames the field to `agentSessionId`, adds kind `claude`,
migrates state v1 → v2, and starts Claude with per-launch hooks writing the spool. Status for
Claude cards stays tmux liveness only (running / gone) until slice 3; resume stays OpenCode-only
until slice 5.

- [x] Write failing tests in `src/core/store/jsonFile.test.ts`: with `migrations = { 1: (o) => ({ ...o, y: o.x }) }`, `readVersioned(file, 2, empty2, onBad, migrations)` on a `{"schemaVersion":1,"x":2}` file returns `{ schemaVersion: 2, x: 2, y: 2 }` and does not call `onBad` or move the file; a `{"schemaVersion":0}` file (no migration for 0) is moved aside.
- [x] Write failing tests in `src/core/store/stateStore.test.ts`: a v1 file whose sessions carry `opencodeSessionId: 'ses_x'` (and a terminal with `opencodeSessionId: null`) loads as `schemaVersion: 2` with `agentSessionId` `'ses_x'` / `null` and no `opencodeSessionId` key; `saveState` of that result then reading the raw file gives `schemaVersion: 2`. Change the existing empty-state expectations to `schemaVersion: 2`, and the round-trip fixture to `schemaVersion: 2`.
- [x] Write failing test `src/core/claude/hooks.test.ts`: `JSON.parse(hookSettings('/a b/it\'s/x.jsonl'))` has `hooks` keys exactly `SessionStart, UserPromptSubmit, PermissionRequest, PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, Stop, StopFailure, Notification`; matchers `PreToolUse: 'AskUserQuestion'`, `PostToolUse: 'Write|Edit|MultiEdit|NotebookEdit|AskUserQuestion'`, `Notification: 'idle_prompt'`, none on the others; every handler is `{ type: 'command', command, timeout: 5 }` with the same command, which ends in `>> '/a b/it'\''s/x.jsonl'`. A second test runs that command with `sh -c` (stdin `{"a":1}`) against a temp spool and checks the file's line matches `/^\{"t":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ","e":\{"a":1\}\}\n$/`. `claudeArgv(id, spool, 'start')` = `['claude', '--session-id', id, '--settings', hookSettings(spool)]`; `claudeArgv(id, spool, 'resume')` = `['claude', '--resume', id, …]`; with `resumeId` `'r'` uses `'r'`.
- [x] Write failing test in `src/core/sessions.test.ts` ("core sessions"): `sessionCreate({ kind: 'claude' })` gives a UUID `agentSessionId`, label `/^Claude · /`, `argv[4]` starting `` `exec claude --session-id ${id} --settings ` `` and containing the spool path `<claudeSpoolDir>/<id>.jsonl`; the spool dir exists with mode `0o700`. With no `claudeSpoolDir` option, `sessionCreate({ kind: 'claude' })` returns `{ ok: false, error: 'no-source' }`. Rename `opencodeSessionId` → `agentSessionId` in the existing tests; add a `makeLabel('claude', …)` → `'Claude · 09:07'` case.
- [x] `src/shared/types.ts`: `SessionKind = 'opencode' | 'claude' | 'terminal'`; `Session.opencodeSessionId` → `agentSessionId: string | null // set for agent kinds (opencode, claude)`; `StateFile.schemaVersion: 2`.
- [x] `src/core/store/jsonFile.ts`: add `migrations?: Record<number, (old: any) => any>` as the 5th parameter of `readVersioned`. After `JSON.parse`, while `parsed.schemaVersion !== schemaVersion` and `migrations?.[parsed.schemaVersion]` exists, set `parsed = { ...migrations[v](parsed), schemaVersion: v + 1 }`; then the existing version check (match → return, else move aside).
- [x] `src/core/store/stateStore.ts`: `readVersioned<StateFile>(file, 2, { schemaVersion: 2, sessions: [], ui: DEFAULT_UI }, onBad, { 1: v1ToV2 })` where `v1ToV2` maps each session `({ opencodeSessionId, ...x }) => ({ ...x, agentSessionId: opencodeSessionId ?? null })`. The existing fill-ins (seenAt, ui) stay after it.
- [x] `src/core/claude/hooks.ts` (NEW): `hookSettings(spool: string): string` returning `JSON.stringify({ hooks })` built from the list and matchers above, command `` x=$(cat); printf '{"t":"%s","e":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$x" >> <sh-single-quoted spool> ``; `claudeArgv(id: string, spool: string, mode: 'start' | 'resume', resumeId?: string): string[]` as in the test.
- [x] `src/core/sessions.ts`: `KIND_NAMES.claude = 'Claude'`; `newSession` takes `agentSessionId: string | null` in its options object and stores it (no minting inside; drop the `mintSessionId` import).
- [x] `src/core/core.ts`: `CoreOptions.claudeSpoolDir?: string // <userData>/agents/claude; absent: no Claude sessions`. In `sessionCreate`: `kind === 'claude'` without `claudeSpoolDir` → `{ ok: false, error: 'no-source' }`; mint `agentSessionId` = `mintSessionId(now().getTime())` for opencode, `randomUUID()` for claude, `null` for terminal; argv = opencode `loginShellArgv(['opencode', '-s', id])`, claude: `fs.mkdirSync(dir, { recursive: true, mode: 0o700 })` then `loginShellArgv(claudeArgv(id, path.join(dir, id + '.jsonl'), 'start'))`, terminal `undefined`. Replace every `opencodeSessionId` with `agentSessionId`, and wherever sessions are matched by it (`linkWrite`, `catchUp`, `onOcEvent` 'wrote', `resync` ids) also require `s.kind === 'opencode'`. Save with `schemaVersion: 2`.
- [x] `src/core/status.ts` `withStatus`: compute live status only when `s.kind === 'opencode' && connected && s.agentSessionId` (slice 2 generalises this per kind).
- [x] `src/core/testing/setup.ts`: pass `claudeSpoolDir: path.join(dir, 'agents', 'claude')` and return it as `claudeDir`; add `createClaude(core, projectId = 'p')` like `createOpenCode`.
- [x] `src/main/index.ts`: pass `claudeSpoolDir: path.join(app.getPath('userData'), 'agents', 'claude')`.
- [x] Renderer: `src/renderer/src/components/ui/Icon.tsx` add `'claude'` to `IconName` with the Lucide asterisk shape (`<><path d="M12 6v12" /><path d="M17.196 9 6.804 15" /><path d="m6.804 9 10.392 6" /></>`); `NewSessionModal.tsx` adds `{ kind: 'claude', label: 'Claude Code', icon: 'claude' }` between OpenCode and Terminal (icon type widened to `IconName`); `Sidebar.tsx` uses `agent = s.kind !== 'terminal'`, `<Icon name={s.kind} …className={agent ? css.iconAgent : css.iconTerminal} />` and `tone={… agent ? 'default' : 'muted'}` (the Resume button stays `kind === 'opencode'`); `Sidebar.module.css` rename `.iconOpencode` → `.iconAgent`; `SessionsBoard.tsx` icon `name={x.kind}`.
- [x] Rename `opencodeSessionId` → `agentSessionId` in `src/core/status.test.ts`, `src/core/features.test.ts`, `src/renderer/src/navigation.test.ts`, `src/renderer/src/tree.test.ts`, `src/renderer/src/sessionStatus.test.ts`.
- [x] Run `npm test -- src/core/store src/core/claude src/core/sessions.test.ts`
- [x] Run `npm run typecheck` and `npm test`
- [ ] Manual (human): `npm run dev`, start Claude Code from the ＋ modal, then in that session: a plain prompt; a Bash command needing permission (wait > 6 s); a prompt that makes it ask a question (AskUserQuestion); Esc mid-turn and wait 60 s; a prompt making parallel Edits; `/clear` and a prompt; kill the tmux server (`tmux -L grove kill-server`) and run `claude --resume <uuid>` by hand.
- [ ] Copy `~/Library/Application Support/grove/agents/claude/<uuid>.jsonl` to `src/core/claude/fixtures/capture-2.1.285.jsonl` and record per hook in `06-implementation.md`: fired or not, fields used by the mapping, sizes, any corrupt span. No hook record at all → stop: E-D10 reopens.
