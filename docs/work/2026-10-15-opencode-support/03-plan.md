---
feature: 2026-10-15-opencode-support
phase: plan
status: draft
version: 1
created: 2026-10-15
updated: 2026-10-15
approved_at:
based_on:
  - 01-outcome.md@1
forced: []
---

# Plan: auto flow on OpenCode

Planned directly by one planner (no reviewer loop, no interview) at the human's instruction; the human handed implementation to one child. Two repos: app (worktree) and skills (`~/git/grove-skills`, main).

## Decisions

### D1. How a subagent role gets its model in OpenCode
**Context.** Claude takes `model` per Agent call; OpenCode has no per-call model, a subagent's model comes from a defined agent.
**Options.** A. The skill writes `.opencode/agent/grove-<role>.md` (model from the profile) into the project at run start, gitignored, and invokes those agents. Pro: profile switching works, no stale files. Con: a generator step and a file-write per run. B. Documented one-time setup by hand. Pro: nothing generated. Con: stale on profile change, defeats easy experiments. C. OpenCode sessions inherit one model for all subagents. Pro: zero work. Con: loses cheap-implementer/strong-reviewer.
**Pick: A**, but the child must first verify against the installed OpenCode (version, agent file format and location, how a primary agent invokes a subagent, the question tool name) and may fall back to C for roles it cannot make work, recording that in `04-run.md`.

### D2. `--model` for OpenCode sessions
**Pick.** Same flag, same `launchModel`, OpenCode argv gets `-m <provider/model>` (verify the exact flag on the installed binary); value passed through unchanged; still rejected for terminal. No alias translation (a profile writes the format its agent takes).

### D3. Skill wording
**Pick.** Keep one set of skills. Where the text names Claude-only tools (Agent tool, `AskUserQuestion`, Bash `timeout`), add the OpenCode equivalent in a short "In OpenCode" paragraph in the shared roles reference rather than forking the skills. `scripts/validate.sh` keeps its checks and learns nothing new.

### D4. Role resolution
**Pick.** `shared/roles.md`: a role's `agent` selects how it is started (`grove new <agent>` for sessions, D1 for subagents); a missing `agent` means the agent of the running session; `04-run.md` records agent and model per role.

## Slices

### Slice 1. Verify OpenCode, then `grove new opencode --model`
**Outcome.** The facts in D1/D2 are written down (installed version, flags, agent file format, subagent invocation, question tool) in `02-research.md`; `grove new opencode --model m` starts OpenCode on that model.
**Files (app).** `docs/work/2026-10-15-opencode-support/02-research.md`; `src/cli/args.ts` (allow `opencode`), `src/core/opencode/client.ts` (`argv` uses `opts.model`), whatever carries `launchModel` for Claude today, `resources/skills/grove/SKILL.md`; tests next to each (args, argv, sessionCreate).
**Verification.** `npm test && npm run typecheck`; manual in the app: `grove new opencode --model <a real model>` and the OpenCode banner/status shows it; `--model` on a terminal session is still refused.

### Slice 2. Subagent roles in OpenCode
**Outcome.** A profile's role models apply to subagents inside an OpenCode session (or the recorded fallback of D1).
**Files (skills).** `shared/roles.md` (role to agent mapping, "In OpenCode" paragraph, agent-file generation recipe or fallback), `skills/grove-auto/SKILL.md` and `skills/grove-run/SKILL.md` + `references/slice-mode.md` (point at it; no model names), `scripts/validate.sh` only if a check is needed.
**Verification.** `bash scripts/validate.sh`; manual: with a profile giving distinct models, `grove-auto` in an OpenCode session shows the researcher/reviewer subagents running on them.

### Slice 3. `grove-run` with OpenCode children
**Outcome.** `grove-run` starts children as OpenCode sessions when the profile says so, and the whole path works: report-back with `grove send`, review gate, `04-run.md` with agent and model per role.
**Files (skills).** `skills/grove-run/SKILL.md`, `references/slice-mode.md`, `shared/roles.md` (child launch: `grove new <agent> --model …`), permissions note for OpenCode (`permission` config) in the unattended-run paragraph.
**Verification.** `bash scripts/validate.sh`; manual on the toy repo with an all-OpenCode profile: two slices, two commits, `04-run.md` with the agent and model per role; a Claude-only profile still runs as before.

## Risks and not done
- OpenCode behaviour is unverified until Slice 1; D1 may fall back to C. No new UI, no sandbox work, no custom roles, no Claude behaviour change.

## Open questions
