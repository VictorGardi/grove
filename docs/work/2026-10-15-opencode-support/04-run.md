---
feature: 2026-10-15-opencode-support
phase: run
status: draft
version: 1
created: 2026-10-15
updated: 2026-10-15
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: auto flow on OpenCode

Profile: inherit (hand-over: plan treated as human-approved though its files say draft)
Branch: run/opencode-support-inherit (app worktree); skills repo `~/git/grove-skills` on main
Plan commit: 71987c473757dfc85d1634d684bdf950dc0f3ca0 (app base; the plan files are uncommitted in the main checkout)
Roles:
- cto: inherit
- researcher: inherit
- planner: inherit (this child session)
- reviewer: opus (hand-over instruction)
- implementer: sonnet (hand-over instruction)

## Slice 1

Session: child of e332d049 (OPENCODE hand-over)
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: the installed OpenCode (v2.0.20) has no `-m` on its default command (`opencode -m x` is `Unrecognized flag`); `-m/--model` exists on `opencode mini` (the minimal interactive interface, which also takes `-s` and `--prompt` and creates the session when the id is new) and on `run`. The env route (`OPENCODE_CONFIG_CONTENT`) does not reach the shared service, so it cannot set an app-launched session's model (see `02-research.md`). `launchModel` already flows to `source.argv(id, 'start'|'resume', { model })` for every kind (`src/core/core.ts:830,898`); only `HttpOpenCode.argv` (`src/core/opencode/client.ts:73`) ignores it, and two guards reject `--model` for non-claude (`src/cli/args.ts:74`, `src/main/cliServer.ts:83`).

Implementer 1 (one chunk, coupled files):
- [x] `src/core/opencode/client.ts` `argv`: with `opts.model` → `['opencode','mini','-s',id,'-m',model,...prompt]` on start and resume; without a model unchanged (`['opencode','-s',id,...prompt]`).
- [x] `src/cli/args.ts` and `src/main/cliServer.ts`: `--model` allowed for `claude` and `opencode`, still rejected for `terminal` (message `--model only works with claude and opencode`); USAGE line for `grove new opencode --model PROVIDER/MODEL`; empty value still rejected.
- [x] `src/shared/types.ts` comment on `launchModel`; `resources/skills/grove/SKILL.md` (usage lines and `--model` paragraph: both agents, opencode takes `provider/model`, starts the minimal interface `opencode mini`); `README.md` line 110 wording.
- [x] Tests: `src/cli/args.test.ts` (opencode accepted with model, terminal rejected, empty rejected), `src/core/opencode/client.test.ts` (argv with/without model, start and resume, prompt order), `src/core/sessionCreate.test.ts` (opencode `--model` argv in the launched command, `launchModel` persisted and kept on resume; sandboxed opencode with a model puts `--server` after `mini`), `src/main/cliServer.test.ts` (opencode accepted, terminal refused).

Models passed: implementer: sonnet; reviewer: opus.

### Review rounds

Round 1: 1 blocking (sandboxed opencode with a model produced `opencode --server URL mini …`, which the installed binary rejects with `Unrecognized flag: --server in command opencode mini`; my earlier `--help`-only check had hidden it). Fix: `withServer` in `src/core/sandbox/launch.ts` inserts `--server` after `mini`; the pinning test now asserts `opencode mini --server URL -s … -m …`; comments in `core.ts` and `CONTEXT.md` updated. Re-run: `npm test` 1093 passed, typecheck clean.
Round 2 (fresh reviewer): no blocking; reviewer verified the new order and the unchanged non-model sandbox argv against the real binary and ran a mutation check (reverting `withServer` fails exactly the new test).

Approved after 1 fix round, 0 blocking. Non-blocking left: no test resumes a sandboxed opencode session with a model (same `withServer` path); ADRs 0005 and 0043 still describe `opencode -s <id>` / claude-only `--model` (true only without a model; not edited, ADRs are history).

### Deviations

D2 said the OpenCode argv gets `-m`. The installed OpenCode's default command has no `-m` (`Unrecognized flag: -m`), and the env route (`OPENCODE_CONFIG_CONTENT`) does not reach the shared service. So with a model the argv is `opencode mini -s <id> -m <model> [--prompt p]` (start and resume); without a model it is unchanged. Everything else in D2 holds (same flag, same `launchModel`, value passed through, terminal still refused). Sandbox: `--server` goes after `mini` (fix round 1). Effect for the human: a session started with `--model` runs in OpenCode's minimal interface (`oc mini`), for its whole life.

### Verification

`npm test` (92 files, 1093 tests passed) and `npm run typecheck` (node and web) both green, run by me after each round (worktree has no node_modules; the main repo's was symlinked for the run and removed). Against the installed OpenCode v2.0.20 (see `02-research.md`): `opencode -m` rejected; `opencode mini -s <minted id> -m <free model> --prompt …` started in tmux, banner `oc mini`, the model answered and the minted id appeared in `opencode session list`; the sandbox order measured as above. Subagent models requested: implementer sonnet (build and fix round), reviewer opus (two fresh reviewers).

### Left for the human

- In the app: `grove new opencode --model <provider/model>` and check the footer shows that model in the `oc mini` interface; `grove new terminal --model x` is refused (covered by tests, not run in the app).
- `grove send`, `grove wait`, `grove read` and permission/question prompts against an `oc mini` pane were not exercised.
- `opencode mini` has no `--auto` (matters for slice 3 unattended children).
- A real sandboxed OpenCode with `--model` was not started (no container run here); the argv shape was checked against the binary's flag parser only.

## Slice 2

Session: child of e332d049 (OPENCODE hand-over)
Status: done
Commit: skills repo `~/git/grove-skills` (see its git log); nothing in the app repo

### Slice plan

Found in the code: all text, in `~/git/grove-skills`. `shared/roles.md` (copied by `scripts/sync-shared.sh` into `skills/grove-auto/references/` and `skills/grove-run/references/`; `validate.sh` checks the copies and forbids model names (`opus|sonnet|haiku|fable`, whole words) anywhere under `skills/grove-auto` and `skills/grove-run`, and requires `AskUserQuestion` in every SKILL.md). Resolution step 6 rejects any `agent` other than `claude`; "Passing a resolved role" only knows the Agent tool's `model` and `grove new claude --model`. `skills/grove-auto/SKILL.md` lines 38/46/59/86/136, `skills/grove-auto/references/plan-process.md` lines 99-122 and `skills/grove-run/references/slice-mode.md` lines 9-10/55-62 name the Agent tool / `AskUserQuestion`.
Verified in OpenCode v2.0.20 (`02-research.md`): `.opencode/agent/grove-<role>.md` with `mode: subagent` and `model: provider/model` is picked up and the subagent session runs on that model while the parent runs on another; the tool is `subagent` with `{agent, description, prompt}`; the question tool is `question`.

Implementer 1 (skills repo, one chunk):
- [x] `shared/roles.md`: step 6 accepts `claude` and `opencode`, anything else stops with `agent <x> is not supported yet`; a missing `agent` means the agent of the running session (D4); a subagent role can only be played by the agent of the session that spawns it (grove-auto's own session, the grove-run child), so a differing `agent` on a subagent role stops with a message naming role and agents; `planner` is the one role whose agent may differ (it is a child session).
- [x] `shared/roles.md`: new section "In OpenCode" (D1 option A, D3): tool mapping (`AskUserQuestion` → `question`, Agent tool → `subagent` with `agent`), no per-call model, the generation recipe (`.opencode/agent/grove-<role>.md` in the session's cwd, frontmatter `description`, `mode: subagent`, `model: <role model>`; body one line naming the role; roles that inherit use no file and the built-in `general` agent; delete stale `grove-<role>.md` for the five roles first; add `.opencode/agent/grove-*.md` once to `$(git rev-parse --git-path info/exclude)`; check `opencode debug agents` lists them, and when an agent is missing fall back to `general` (inherit) and say so; then call `subagent` with `agent: grove-<role>`); "Passing a resolved role" split by agent.
- [x] `skills/grove-auto/SKILL.md`, `references/plan-process.md`, `skills/grove-run/references/slice-mode.md`: where they say "Agent call" / "Agent tool", add a pointer to `references/roles.md` ("In OpenCode" there); no model names, `AskUserQuestion` stays in SKILL.md; slice-mode's `Models passed:` line stays role:model.
- [x] Run `bash scripts/sync-shared.sh` then `bash scripts/validate.sh`.

Models passed: implementer: sonnet; reviewer: opus.

### Review rounds

Round 1 (opus): 1 blocking: `slice-mode.md` steps 5/6 mixed Claude's Agent-tool wording ("general-purpose subagent type", `model =`) with OpenCode's. Fix: separate Claude and OpenCode clauses (`agent: grove-implementer|grove-reviewer`, or `general`, no model). Also applied: step 6 wording (missing `agent` on a subagent role = the spawning session's agent, on `planner` = the running session's; planner `agent` ignored in grove-auto), `config.schema.json` (dropped `"default": "claude"`, model description covers `provider/model`), recipe step 1 "resolved model", `question` pointers in grove-auto.
Round 2 (opus): 1 blocking: `opencode debug agents` lags behind file writes (measured by the reviewer: a new file or changed model shows up on the 2nd/3rd call), so a one-shot check would wrongly fall back to `general`. Fix: poll about once a second, up to about 10 tries, until each `grove-<role>` is listed with the written model; else `general`, said in the output. Also: "each subagent role the session spawns", one profile targets one agent for its subagent roles, Inherit wording for cross-agent children, `grove-` reserved prefix, `question` pointer in slice-mode rule 1.
Round 3 (opus, fresh): no blocking; reviewer repeated the lag measurement and confirmed polling handles it.

Approved after 2 fix rounds, 0 blocking. Non-blocking left (folded into slice 3 where it touches the same text): say the model to compare is `model.providerID` + `/` + `model.id` in the `debug agents` JSON; slice-mode step 4's `Models passed:` must be updated when a role falls back to `general`; slice-mode steps 5/6 could name the polling fallback; delete-first ordering of recipe step 1; nested parentheses in slice-mode rule 1.

### Deviations

none from the plan's Decisions. D1 option A holds (verified, so fallback C is used only per role when an agent cannot be listed with the right model, via the built-in `general`). Inherit roles use `general`, not a generated file. Two OpenCode facts found in review that are now in the recipe: `opencode debug agents` lags file writes (poll), and a model not in `provider/model` form makes the agent silently absent. Also `shared/config.schema.json` changed (not in the plan's file list) so the schema no longer contradicts D4.

### Verification

`bash scripts/sync-shared.sh` then `bash scripts/validate.sh`: OK (skills and fixtures). References copies diffed against `shared/` by the reviewers. Static checks against the installed OpenCode v2.0.20 (see `02-research.md` and the reviewers' runs): agent file at `.opencode/agent/grove-<role>.md` picked up, also when written mid-session in `opencode run`; subagent on the file's model while the parent runs on another; no-model file and `general` both inherit; `git rev-parse --git-path info/exclude` works in a linked worktree and hides the files. Subagent models requested: implementer sonnet (build and two fix rounds), reviewer opus (three fresh reviewers).

### Left for the human

- Manual: with a profile giving distinct models for researcher and reviewer (OpenCode `provider/model` strings), run `grove-auto` in an interactive OpenCode session and check the researcher/reviewer subagent sessions run on them (`opencode session export <child id>`). Only `opencode run` was exercised, not an interactive TUI or `oc mini` session picking up files written mid-session.
- `grove-run/SKILL.md` still launches `grove new claude`; slice 3 changes that. Until then a profile with `planner.agent: opencode` passes resolution but is not launched as OpenCode.

## Slice 3

Session: child of e332d049 (OPENCODE hand-over)
Status: done
Commit: skills repo `~/git/grove-skills` (see its git log); nothing in the app repo

### Slice plan

Found in the code: `skills/grove-run/SKILL.md` step 2 starts every child with `grove new claude --child …` (lines ~82-90) and prints `grove new claude --cwd <worktree> --prompt "/grove-approve <slug> run"` at the end (~170); the slice-1 gate note (~134-137) talks about the human's Claude permission settings. The child prompt's `Roles:` line is `role=model` (no agent); `references/slice-mode.md` step 2 copies it into `04-run.md` as `role: model`; `references/run-template.md` lists `- <role>: <model or inherit>`. `shared/roles.md` (slice 2) already says the child runs as the planner's agent through `grove new <planner agent>`. App side (slice 1): `grove new opencode --model provider/model` starts `opencode mini -s id -m model` (the minimal interface, no `--auto`). OpenCode's default permission (`opencode debug agents`, build agent): everything allowed except `external_directory` and reading `.env` files, which ask; config key `permission` per tool (`read edit glob grep list bash task external_directory question webfetch websearch lsp doom_loop skill`, each `ask|allow|deny`).

Implementer 1 (skills repo, one chunk):
- [x] `skills/grove-run/SKILL.md`: step 1 resolves each role's agent too (per `references/roles.md`); step 2: child prompt gets an `Agents:` line (`cto=<agent> researcher=<agent> planner=<agent> reviewer=<agent> implementer=<agent>`, resolved: a subagent role without `agent` gets the planner's agent, the planner without `agent` gets the parent's own agent) next to `Roles:`; launch `grove new <planner agent> --child …` with `[--model <planner model>]`; final hand-off prints `grove new <parent's own agent> --cwd <worktree> --prompt "/grove-approve <slug> run"`; Purpose/Inputs wording that says Claude only; the slice-1 gate permission note gets an OpenCode paragraph (permissions come from the human's OpenCode `permission` config; default allows edits and shell but asks for `external_directory`; an unattended run stops at any `ask`; set `allow` for what the run needs; the child started with `--model` runs in `opencode mini`, which has no `--auto`; the question tool in a child still halts the run).
- [x] `skills/grove-run/references/slice-mode.md`: step 2 reads the `Agents:` line next to `Roles:` and records `- <role>: <agent>, <model or inherit>`; `Models passed:` stays `role: model`, with "update it if a role fell back to `general`" in step 4; steps 5/6 name the polling fallback ("or when the check in `references/roles.md` fell back"); rule 1 parentheses tidy.
- [x] `skills/grove-run/references/run-template.md`: Roles entries `- <role>: <agent>, <model or inherit>`; the test fixture `tests/fixtures/flows/docs/work/2026-10-04-auto-feature/04-run.md` header entries `claude, inherit`.
- [x] `shared/roles.md` (the slice-2 non-blocking leftovers): the model to compare in `opencode debug agents` JSON is `model.providerID` + `/` + `model.id`; delete-first ordering of recipe step 1; "Passing a resolved role" child-session line mentions the `Agents:` line is how the child learns the agents.
- [x] `bash scripts/sync-shared.sh`, `bash scripts/validate.sh` OK.

Models passed: implementer: sonnet; reviewer: opus.

### Review rounds

Round 1 (opus, fresh): no blocking. Applied the cheap non-blocking items through one more implementer (no re-review needed, no blocking): `continue.md` reads `Agents:` too and takes the agents from the continued run's header; the permission note says "Grove never starts OpenCode with `--auto` (and `opencode mini` has none), so only the `permission` config decides" and names the children's agent; recipe step 2 appends to the exclude file through the shell (in a linked worktree it lives in the main checkout, outside the working directory, so the edit tool would hit `external_directory`).
Approved after 0 fix rounds, 0 blocking. Non-blocking left: `/grove-approve` as the hand-off prompt for an OpenCode parent is unverified (could be written "Load the grove-approve skill"); `question: deny` in the OpenCode config could be suggested for children.

### Deviations

Added an `Agents:` line to the child prompt (the plan only said `grove new <agent> --model …`) so the child learns each role's agent and can record it; header entries in `04-run.md` are `- <role>: <agent>, <model or inherit>` (template and the one test fixture updated). No Decision changed.

### Verification

`bash scripts/sync-shared.sh`, `bash scripts/validate.sh`: OK (skills, fixtures); grep for model names under grove-auto/grove-run: none. Reviewer checked the OpenCode default permissions against `opencode debug agents` (everything allowed except `external_directory` and `.env` reads; `general` denies `question` and `subagent`) and that the app accepts `grove new opencode --child --worktree --branch --base --label --model`. Subagent models requested: implementer sonnet, reviewer opus.

### Left for the human

- Manual, toy repo: an all-OpenCode profile (planner, implementer, reviewer as `agent: opencode` with `provider/model` strings), `grove-run` from an OpenCode parent: two slices, two commits, `04-run.md` with `<agent>, <model>` per role; then a Claude-only profile to confirm it still runs as before. Never exercised end to end here.
- Against an `oc mini` child: `grove send <child> "Fix slice N: …"` typing, `grove wait`, `grove read`, and the child loading the grove-run skill from its prompt ("Load the grove-run skill …") in OpenCode.
- An OpenCode parent's hand-off `/grove-approve <slug> run` prompt (command vs plain text).
- The first slice's gate asks the human to allow prefixes; for OpenCode, set `permission` entries to `allow` in the OpenCode config first.

## Final summary

Three slices done, three commits: app repo `5d9b038` (slice 1), skills repo `9f13eb2` (slice 2) and the slice 3 commit in the skills repo (see its git log).

- `grove new opencode --model provider/model` starts `opencode mini -s <id> -m <model>` (start and resume; sandbox `--server` after `mini`); without a model OpenCode starts as before; terminal still refuses `--model`. Deviation from D2: the installed OpenCode's default command has no `-m`, so a model means the minimal interface.
- D1 verified in OpenCode v2.0.20: generated `.opencode/agent/grove-<role>.md` gives a subagent its own model; fallback C (inherit via `general`) is used only per role when the agent is not listed with the written model after polling `opencode debug agents` (it lags file writes). Inherit roles use `general`.
- `grove-run` starts children with `grove new <planner agent>`, passes an `Agents:` line, records agent and model per role; the roles and permissions text covers OpenCode; Claude-only profiles read the same.
- PR description for the app repo: "`grove new opencode --model`: launches `opencode mini -s <id> -m <model>` (the default `opencode` command has no model flag), keeps `--model` rejected for terminal, puts `--server` after `mini` in the sandbox wrapper."
- Checks green: app `npm test` (1093) and `npm run typecheck`; skills `sync-shared.sh` and `validate.sh`. Interactive checks are the human's (see each slice's Left for the human).

## Follow-up: model via config instead of mini

Human decision: OpenCode gets its model through config, not `opencode mini -m`. App commit `e55da36` (branch run/opencode-support-inherit), skills commit `06ac739`.

- `HttpOpenCode.argv` is plain `opencode -s <id> [--prompt …]` again; sandbox `--server` is right after the binary again.
- New helper `opencodeModelEnv(model, existing?)` in `src/shared/opencodeSession.ts` builds env `OPENCODE_CONFIG_CONTENT={"model":"<model>"}`; an existing value is merged (grove wins for `model` only; unparsable or non-object is replaced). Used by `cliEnv` (host create and resume, tmux env) and `envFor` (sandbox, container `-e`, single-quoted by `loginShellArgv`). Claude keeps `--model` argv. `cliEnv` now returns the model env even without `sessionEnv`.
- Text updated: CONTEXT.md, resources/skills/grove/SKILL.md, comments; skills repo `grove-run/SKILL.md` no longer mentions `opencode mini`. README and args usage never said `mini`.
- Models passed to subagents: implementer sonnet (two rounds), reviewer opus (one round). Review: 0 blocking; applied the cheap non-blocking items (tests independent of ambient env, cliEnv test with sessionEnv, comment in agents/types.ts).
- Verified: app `npm test` (1102) and `npm run typecheck` green; skills `sync-shared.sh` and `validate.sh` OK; reviewer traced the env to tmux `new-session -e` and the container `-e` flags. The parent had checked in tmux that the TUI picks up the model from `OPENCODE_CONFIG_CONTENT`.
- Left, not fixed: a user's `OPENCODE_CONFIG_CONTENT` exported in their shell rc is re-sourced by the login shell after tmux sets the env and would override grove's value; the merge reads grove's own process env, not the rc's.

## Open questions
