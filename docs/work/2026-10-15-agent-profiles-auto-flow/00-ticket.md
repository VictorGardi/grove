Add an agent-driven `auto` workflow to grove: planning that asks the human only about the outcome, and a one-command run that implements the plan slice by slice with configurable agent roles and models ("profiles").

Decisions from the human-approved grilling conversation (2026-10-15):

## Problem

- Planning asks too many technical questions, with vague context. The human wants to be asked about the OUTCOME only.
- Implementation requires retyping the same prompt each time: parent grove session, one child session per slice, child plans slice details, delegates to subagents, reviews, reports back, human reviews, next slice. It also stops after every slice.
- There is no way to define which agents (and models) do what, or to try different setups.
- Guiding principle: start simple, add complexity only when needed. No unnecessary technical debt.

## Gates

- Human gates: (1) the outcome, (2) review after slice 1, (3) final review after the last slice. Slice 1 is always a thin end-to-end vertical slice. Slices 2..N run unattended; `--review-each` restores per-slice review.
- Only `grove-approve`, invoked by the human, sets `status: approved`. One approval covers the plan bundle.

## Planning (skill `grove-auto`, one session)

- Planner is the main agent. Researcher, reviewer and CTO are fresh subagents. Researchers explore the repo so the planner's context is not bloated.
- Step 1, outcome alignment (most important; misreads are costliest here): researchers map the relevant code first so questions are informed. The CTO asks one question at a time. Each question gives background (why it matters), options with outcome impact, and a recommendation. It ends in an Outcome Brief: what the user sees/does, a walkthrough scenario, non-goals, "how I'll know it works", constraints. The CTO plays it back in plain words; the human confirms in-session. The planner starts only after that.
- Plan loop: planner drafts, reviewer critiques, planner researches more and revises. Stops when the reviewer has no blocking findings, or after 3 rounds; anything still contested goes to the human flagged "agents disagree".
- Reviewer lenses: unnecessary technical debt; easiest path to the outcome given the codebase; deepening vs shallowing architecture (aim deeper, without unnecessary complexity).
- The CTO returns once at the end to check the plan still delivers the brief.
- Agents decide technical (one-way-door) decisions. The gate shows each with context, options, pros/cons, impact on the outcome and the pick; the human can veto line by line. Questions to the human are asked only when the outcome is unclear.

## Artifacts (`auto` flow)

- `00-ticket.md`: raw input.
- `01-outcome.md`: the Outcome Brief.
- `02-research.md`: facts from researchers (same contract as today).
- `03-plan.md`: Decisions (as above), ordered Slices each with verification, compact reviewer round log. This is what the human approves.
- `04-run.md`: written during the run: profile used, and per slice the detailed plan (written just-in-time by the child), commit, review verdict, fix rounds, deviations.
- Existing full/standard/small flows and finished features stay untouched. The board is not essential; artifacts are shaped for the workflow, not the legacy board.

## Run (skill `grove-run`)

- `grove-run <slug> [--profile X] [--review-each] [--continue]`, built on the existing `grove new --child`. No orchestrator in the app.
- One worktree per run, one commit per slice. Each child plans its slice, delegates implementation to implementer subagents, and reviews.
- Failure: up to 2 fix rounds. If still failing, or a fix would change the design or outcome, the child stops and writes the options (with pros/cons) to `04-run.md`; the parent halts the run in a needs-review state. Later slices never start on a broken base. Resume with `--continue`.

## Agents and profiles

- Workflow = what/when (stages, gates, artifacts) and refers to roles by name only. Profile = who (role to agent and model). Skills never name models; the workflow never names agents.
- Roles (5): `cto`, `researcher`, `planner`, `reviewer` (plan mode and slice mode), `implementer`.
- Profiles live in the repo's `grove.config.json`: `profiles: { default: {...}, cheap: {...} }`, with an active `profile` and a per-run `--profile` override. The profile used is recorded in `04-run.md`.
- Claude only in v1. The profile shape stays agent-neutral (`role: { agent, model }`) so OpenCode can be added later via the existing `AgentSource` seam; no OpenCode code now.
- Session-level model (planner, child main agents): `grove new --model`. Subagent model: the skill passes `model` on each Agent call from the active profile; no generated `.claude/agents` files. The model each subagent ran with is recorded in `04-run.md`.

## Where changes land

- `~/git/victor/skills`: new skills `grove-auto` and `grove-run`; extend `grove-start/references/contract.md` and `approve.md` with an `auto` flow section and the one-approval rule.
- This repo: `profiles` schema in `grove.config.json`; `grove new --model`; a minimal `auto` flow in `resources/workflow.yaml` so features are still discovered without card warnings. No run view or other UI.

## Non-goals

- Fully user-defined roles, custom role prompts, OpenCode support, an app-level orchestrator, a run UI, auto-start on approve, per-slice risk tagging, user-global profiles.

## Suggested build order

1. `grove-auto` step 1 (outcome alignment), usable and tunable on real features at once.
2. Plan loop and `03-plan.md`.
3. Profiles config and `grove new --model`.
4. `grove-run`.
