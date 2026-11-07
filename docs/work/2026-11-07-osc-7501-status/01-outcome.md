---
feature: 2026-11-07-osc-7501-status
phase: outcome
status: approved
version: 1
created: 2026-11-07
updated: 2026-11-07
approved_at: 2026-11-07
based_on: []
forced: []
---

# Outcome: agent status from OSC 7501 only

## Summary

In Grove v2, a Claude, Copilot or OpenCode tab shows its status (working, idle, finished, needs you) from one source: the status report the agent itself sends to the terminal (OSC 7501). The per-agent hook, spool, event-log and service sources go away. A tab whose agent sends no report shows `unknown`, with a hint about which agent version is needed.

## What the human sees and does

- Start Claude, Copilot or OpenCode in a Grove tab: the tab shows idle, then working while it works, and finished when a turn ends (also when you interrupt with Esc).
- When an agent asks for permission, a question or sign-in, the tab shows needs-you with that reason; sign-in reads "Needs sign-in". A blocked report with no kind counts as permission. An error report shows needs-you/error.
- A tab whose agent is too old or sends nothing stays `unknown`; the tooltip says the minimum version (Copilot 1.0.107, OpenCode 2.2.6, Claude as tested 2.1.309). There is no fallback to the old sources.
- Status keeps working with no window attached, and does not depend on the window answering the terminal's queries.
- Resume of an agent tab (including after Claude `/clear` and for hand-started agents) keeps working.
- When the terminal process exits, the tab goes to unknown. Nothing else (no silence timer, no screen check) resets it.

## Non-goals

- No per-terminal child-record model (only the root record decides a tab's status).
- No fallback to the old status sources, and no support for agent versions below the minimums.
- No change to the attention/notification model, rollup, or the tab and sidebar visuals beyond the unknown hint and the new `auth` reason.
- No approval, no implementation in this planning run.

## How I'll know it works

- Each of Claude, Copilot and OpenCode, started in a Grove tab, shows working, idle, finished and needs-you (permission) correctly end to end.
- A real failure (for example an auth failure) is observed for each agent and shows needs-you with the right reason, before any old source is deleted.
- A tab with no report shows `unknown` plus the version hint; killing the process resets to unknown.
- Resume after `/clear` and for a hand-started agent still works.
- `npm run typecheck` and `npm test` pass after every slice; the old watchdog, cross-check, spool, hooks/events and hub/normalise code is gone at the end.

## Interview log

The outcome interview was already done by the human in a grill-me session (eight fixed decisions, recorded in `00-ticket.md`), so no further outcome questions were asked in this run.

## Open questions
