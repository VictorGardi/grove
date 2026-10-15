# 0043. Agent profiles name roles in config, and a run keeps its state in its worktree

Date: 2026-10-15

## Status

Accepted

## Context

The auto flow plans a feature and builds it one slice per child session. Which model
plays each part should be a config edit, not a change to the skills, and a run must be
resumable and comparable with another run of the same ticket. The pieces that are hard
to change later are the config shape, how a model reaches a child session, where run
state lives, and how a child tells its parent it is done. The full plan is
`docs/work/2026-10-15-agent-profiles-auto-flow/03-plan.md`.

## Decision

- **Profile schema (D1).** `grove.config.json` gains top-level `profile` (the active
  name) and `profiles`: `{ "<name>": { "<role>": { "agent": "claude", "model": "<alias>" } } }`.
  The roles are `cto`, `researcher`, `planner`, `reviewer`, `implementer`, all optional.
  A missing role, missing `profiles` or no active profile means inherit: no model is
  passed. `agent` must be `claude` in v1. `model` is an alias, because the same value
  goes to the Agent tool and to `claude --model`. A role missing from a profile does not
  fall back to another profile. The app ignores these keys.
- **Skills name roles only (D2).** Skills say "the `researcher` subagent"; the profile
  says who. Subagents get their model on each Agent call. A child session gets its
  planner model from `grove new claude --model ALIAS`, which is claude-only and a usage
  error otherwise. The model is stored as the optional `Session.launchModel` and a
  resume passes it again, so a resumed child never changes model. `Session.model` stays
  the live display field. The CLI param is additive, with no protocol bump (ADR 0027).
- **Run state in the worktree (D3).** A run's `04-run.md` lives in its worktree, on
  branch `run/<slug>-<profile>`, forked from the commit that holds the approved plan
  and not from HEAD. Each slice's commit carries its update. Two runs of one ticket are
  two branches with two comparable files, and children write inside their own cwd.
- **Children report back (D4).** After its commit, a child runs
  `grove send <parent> "SLICE n: done|halted — …"`. The parent does not wait on or watch
  the child. Git is the source of truth: the parent reads the commit subject and
  `04-run.md` from the branch, and the message only wakes it.

## Consequences

- No state migration: `launchModel` is optional and absent means the session's own model
  (`seenAt` is the precedent).
- The `grove` skill documents `--model`. Skills must not contain model aliases; a
  validate check in the skills repo enforces it.
- The feature card in the main checkout does not show run progress; the worktree
  appears as its own project.
- A subagent's model is requested, not verified: the harness does not report it back.
- A later OpenCode profile needs only a new `agent` value, not a schema change.
