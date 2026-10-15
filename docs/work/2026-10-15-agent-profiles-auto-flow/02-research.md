---
feature: 2026-10-15-agent-profiles-auto-flow
phase: research
status: draft
version: 1
created: 2026-10-15
updated: 2026-10-15
approved_at:
based_on:
  - 01-outcome.md@1
forced: []
repo_heads:
  - c26512b   # grove (working tree dirty: --base flag + worktree base plumbing uncommitted)
  - 20d2f57   # grove-skills (working tree dirty: question-tool rule in all SKILL.md + one contract.md copy)
---

# Research: agent profiles and the `auto` flow

Facts only, gathered by four read-only researchers. Paths relative to `/Users/victor/git/grove` unless prefixed `skills:` (= `/Users/victor/git/grove-skills`).

## Summary

- The grove skills live in `~/git/grove-skills` (`skills/`, `shared/`, `commands/`, `scripts/`). `~/.claude/skills` is `~/git/victor/skills`, whose `grove-*` entries are symlinks into `grove-skills/skills/`. `~/git/victor/skills/grove` links to this repo's `resources/skills/grove`.
- `grove new` has no model flag; Claude's argv carries no `--model`. The workflow's `actions` are validated but never interpreted by the app.
- `grove.config.json` is read by the app for `artifactRoot` only; skills read the rest as prose. The schema (`skills:shared/config.schema.json`) rejects unknown keys but nothing enforces it in code.
- No *committed* skill mentions the question tool, models, roles or profiles. At research time the skills repo has uncommitted edits (by another session) adding an `AskUserQuestion` rule to every existing SKILL.md and a rule 9 to one `contract.md` copy.

## `grove new` and launch path

- Parse: `src/cli/args.ts:55-76`. Flags: `--cwd --prompt --label --link --parent --child --worktree --branch --base --sandboxed --json --timeout --wait`. `--worktree` needs `--branch`; `--base` needs `--worktree`; `--parent`/`--child` exclusive. No `--model`. Usage errors exit 2.
- Dispatch: `src/cli/index.ts:41-46` sends `sessions.create` (params type `src/shared/cli.ts:8-11`, no model). `--child` uses `GROVE_SESSION_ID` as parent (index.ts:60-63).
- Server: `src/main/cliServer.ts:69-103`. Resolves `--parent` first (`no-parent` before any worktree exists), makes the worktree with `worktrees.add` (`src/core/worktrees.ts:35-50`, path `~/.grove/worktrees/<repo>/<branch>`, forks the checkout's HEAD or `--base`), then `core.commands.sessionCreate` (`src/core/core.ts:794-851`). The child's cwd is `--cwd` or the CLI's cwd, never the parent's; `--worktree` swaps it for the new checkout. A worktree path used as `--cwd` is registered as its own project (ADR 0037).
- Claude argv: `claudeArgv` (`src/core/claude/hooks.ts:51-55`): `claude --session-id <uuid> --settings <hooks JSON> [--name <label>] [--] <prompt>`; resume passes `--resume <id> --settings …` and no prompt/name. Seam: `AgentSource.argv(id, mode, opts?: {prompt?, name?})` (`src/core/agents/types.ts:38`), called at `core.ts:829` (start) and `core.ts:897` (resume, no opts). The sandbox wrapper appends `agentArgv` unchanged (`src/core/sandbox/argv.ts:28`).
- A `--model` would touch: `args.ts`, `index.ts:41-45`, `shared/cli.ts:9`, `cliServer.ts:94-97`, `core.ts:90-92,794,829`, `agents/types.ts:38`, `claude/source.ts:26-28` + `hooks.ts:51`. For resume to re-pass it the session must persist it (`sessionResume` builds argv from the stored session only). `Session.sandboxed` is the precedent for a persisted launch property (`state file schemaVersion 9`, `src/core/store/stateStore.ts:49`, migrations v1ToV2…v8ToV9). `Session.model` (`src/shared/types.ts:37`) already exists but is live display data from the statusLine and is stripped before saving (`core.ts:226`).
- Exit codes of `new --wait` / `wait` (`src/cli/output.ts:21`, `src/core/cliOps.ts:80-117`): 0 turn ended idle (a finished-unseen turn counts as idle); 4 pending permission or open AskUserQuestion; 5 session gone; 124 timeout (default 600 s, `--timeout`); 1 other error; 3 app not running. `new --wait` gives the turn up to 30 s to start. `wait` on an agent with no status yet keeps waiting.
- Statuses (`src/core/status.ts:54-78`): permission → `waiting/permission`; question → `waiting/question`; running → `working`; idle newer than seen → `waiting/done`; else `idle`. A parent does not aggregate its children's status; the sidebar nests children and shows the most urgent one on a collapsed parent (`src/renderer/src/sessionList.ts:109-114`). `grove ls --json` includes `parent`.
- Groups are one level deep; `--child` from a child lands beside it (`src/shared/sessionGroups.ts:20-28`).
- Tests: `src/cli/args.test.ts` (pure `parseCommand`), `src/main/cliServer.test.ts` (real Core + unix socket, `setupCore()`, `gitRepo()`), `src/core/sessionCreate.test.ts` (fake tmux backend, argv assertions, `claudeArgv` and `SpoolClaude` pure tests), `src/core/claude/*.test.ts`. vitest, `describe/it/expect`.

## `workflow.yaml`, flows, discovery

- Default workflow `resources/workflow.yaml`, used unless the app config (`~/.config/grove/config.json`, key `workflow`, absolute or `~/…`) overrides it (`src/core/core.ts:235-241`). One global workflow for all projects (ADR 0001). This repo's `grove.config.json` has no `workflow` key.
- `flows.values`: `full: all`, `standard: all`, `small: [questions, implementation]`. `stages` is a global ordered list (questions 01, research 02, design 03, structure 04, implementation 06-implementation.md). `kinds.feature: all`, `epic` explicit.
- Effective stages = kind ∩ flow, in global `stages` order; a flow's own list order is ignored (`src/core/workflow/derive.ts:12-19`). Current stage = first incomplete; a stage counts as passed if a later effective artifact exists (derive.ts:53-64). Stage keys allowed: `id label artifact review complete_when`; one artifact per stage id, no per-flow overrides (`src/core/workflow/parse.ts:9-16,42-139`).
- Card warnings come only from `Feature.warnings` (derive.ts:92-97): `flow?` / `kind?` when the manifest value is not a key of `values` (the feature then uses the default flow's stages), `frontmatter?: <file>` on parse errors. Rendered only on `FeaturePage.tsx:49`. Nothing warns on unknown stage or missing artifact. Test: `derive.test.ts:103-107`.
- `actions`, `stage_actions` and flag labels are validated (`parse.ts:36-39,109-115`) but nothing expands or renders them. The `/grove-{stage}` prompts are inert text.
- An `auto` flow needs only new global `stages` entries (ids unique, each with `label`, `artifact`, `complete_when`) and `flows.values.auto: {stages: [...]}`. Because `full` and `standard` are `all`, any new global stage is also added to them unless their lists are made explicit.
- Tests: `src/core/workflow/parse.test.ts` (loads bundled yaml, `it.each` mutation table), `derive.test.ts`, `src/core/features.test.ts`, `src/core/discovery/folder.test.ts`.
- Worktree copies: a feature in a worktree project is discovered by that project and shown as a chip if at a different stage than the parent checkout's copy (ADR 0037).

## `grove.config.json`

- The app reads exactly one key, `artifactRoot`, via `resolveRoot` (`src/core/discovery/folder.ts:19-31`); unknown keys are ignored (`folder.test.ts:55`); no validation, silent fallbacks. Watched (chokidar) per project; changes to other keys are no-ops (`core.ts:278-296`). Each worktree project reads its own copy; no walk-up (ADR 0037).
- The `grove` CLI has no config reader (socket only, `src/shared/cli.ts:6-17`); it runs on Electron-as-node (ADR 0028) so `fs` is available but unused.
- Schema `skills:shared/config.schema.json` (copied only to `grove-setup/references/`): top-level `additionalProperties: false`, required `artifactRoot adrDir contextFile commitHtml tracker commands limits`; `commands` allows `test typecheck lint build`; this repo's config also has `commands.dev`, which the schema would reject. No script validates configs against the schema. Skills read config as prose (`limits.maxSlices`, `commands.*`, `tracker`, `commitHtml`).
- This repo's limits: `maxOneWayDecisions 8`, `maxSlices 8`, `designMaxLines 220`.
- Agent kinds: `AgentKind` = `claude | opencode` (`src/core/agents/types.ts:30`); `AgentSource` is the per-kind seam (ADR 0019); OpenCode argv is `opencode -s <id> [--prompt p]` (`src/core/opencode/client.ts:54-56`).

## Skills repo (`skills:`)

- Layout: `skills/<name>/SKILL.md` + `references/`; `commands/<name>.md` (5-line wrapper: "Load the <skill> skill with the skill tool and follow it exactly. Arguments: $ARGUMENTS"); `shared/*` single sources copied into each skill's `references/` by `scripts/sync-shared.sh` per `shared/MANIFEST`; `install.sh` symlinks `skills/*` into `~/.claude/skills` and `commands/*` into the OpenCode commands dir (glob-driven).
- `scripts/validate.sh`: SKILL.md present; folder/`name` match; `description` 1..1024 chars; frontmatter keys limited to `name description license compatibility metadata disable-model-invocation`; `disable-model-invocation` allowed only on `grove-approve`; hard-coded `gated_skills` (must carry `references/approve.md` and the literal `Approve now? (yes / not yet)`) and `handoff_skills` lists (lines 13, 16); `commands/<skill>.md` must exist; copies in sync; bans `plannotator` and the string `grove-plan` in skills/commands/shared. No SKILL.md line limit. `validate-fixtures.sh` checks fixture `feature.md` (`flow in {full, standard, small}`, epic must be `full`, `## Flow log` present, per-flow artifact rules).
- A new skill must add: SKILL.md, `commands/<name>.md`, MANIFEST lines if it needs shared copies (`contract.md *` and `gates.md *` apply automatically), README tables, and hand edits to `validate.sh` lists and `AGENTS.md`.
- Questions today: plain chat ("one at a time" in `grove-questions`, `grove-start`, `grove-design`; approval prompt "Approve now? (yes / not yet)" in `shared/approve.md`; handoff offer "(yes / no)" in `shared/next-session.md`). No mention of `AskUserQuestion` or any question tool in committed files (an uncommitted working-tree edit adds a `## Rules` bullet "Ask the human only through the question tool …" to every SKILL.md); skills say generically "the skill tool" and "subagent/task tool".
- `grove-approve`: `disable-model-invocation: true`; resolves slug + unit, then runs `references/approve.md` from "Procedure" step 1 (validate, summarise ≤5 lines, ask, on yes set `status: approved` + `approved_at`, stale-mark downstream, flip ADRs, tracker, report). Units table: `questions, research, questions+research, design, structure, design+structure, implementation`. No unit covers 01+02+03 or `run`. Approve never commits.
- Content gates (`shared/gates.md`): no non-empty `## Open questions`, no `TODO`/`TBD`, every slice has verification, every design decision has a chosen option. Staleness: `based_on` version older than input → stop and warn. Epic gate and hard gates are flow-keyed tables.
- `grove-implement`: next slice = first in `04-structure.md` whose `05-plan.md` section is missing or has `- [ ]`; slice plan written just-in-time (`references/slice-plan.md`: exact paths, mechanical steps, verbatim verification, zero-context test, no new decisions else stop and escalate); one commit per slice `<slug>: slice N — <outcome>`; subagents may draft slice plans or run checks only; `--all` chains slices; after last slice runs `commands.*`, writes PR description to `06-implementation.md`, tells the human to run `grove-approve <slug> implementation`.
- Structure rules (`shared/structure-process.md`): ≤ `maxSlices` vertical slices, slice 1 a tracer bullet, each with observable outcome, files, key signatures, exact verification, dependencies.
- `shared/next-session.md`: handoff spawns `grove new "$agent" --cwd "<repo root>" --prompt "Load the <skill> skill … Arguments: <args>" --label "<skill>-<slug>" --link "<slug>"`; retries without `--link` if the feature is unknown; never `--wait`; same agent kind as the current session.
- Grove skill `resources/skills/grove/SKILL.md` (this repo; printed by `grove skill`): documents orchestration with `--child`, `--wait` exit codes, "never start a step the human has not approved", "one step per session", `--worktree --branch` for conflicting children.
- Stale text: `skills:AGENTS.md` and this repo's `AGENTS.md` still describe a `grove-plan` phase and `05-plan.md`; `validate.sh` does not scan `AGENTS.md`.

## Unknowns

- (Resolved by reading `src/core/store/stateStore.ts:41-60`) `sandboxed` needed a v8→v9 migration because it was required; `seenAt` was added later as an optional field defaulted in `loadState` with no bump. An optional field with an `undefined` default needs no migration.
- Whether Claude Code prompts for Read/Edit of files outside a session's cwd (relevant to a parent reading a worktree's files); not checked.
- Which model values both the Agent tool `model` param and `claude --model` accept: the Agent tool accepts only the aliases `sonnet|opus|haiku|fable` in this environment.

## Open questions
