---
feature: 2026-10-15-opencode-support
phase: outcome
status: draft
version: 1
created: 2026-10-15
updated: 2026-10-15
approved_at:
based_on: []
---

# Outcome Brief: auto flow on OpenCode

## Summary

A profile role can say `agent: opencode`. Then `grove-run` children for that role are OpenCode sessions on the configured model, and subagent roles (researcher, reviewer, implementer, cto) inside an OpenCode session use their configured models. Claude-only profiles behave exactly as today.

## How I'll know it works

- `grove new opencode --model provider/model` starts an OpenCode session on that model; `--model` still works for Claude and is still rejected for terminal sessions.
- A profile with `planner: {agent: opencode, model: ...}` makes `grove-run` start its children as OpenCode sessions with that model, and `04-run.md` records agent and model per role.
- In an OpenCode session, `grove-auto` and `grove-run` read correctly: the skills name the question tool and subagents in terms OpenCode has, and per-role subagent models come from agent definitions the skills tell the agent how to use.
- Claude behaviour and all existing tests are unchanged.

## Non-goals

Custom roles, mixing agents inside one subagent tree beyond what the profile says, sandbox/OpenCode-service changes, new UI.

## Constraints

Start simple. Claude stays the default. Verify OpenCode facts against the installed OpenCode, not memory.

## Open questions
