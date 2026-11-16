Status: shipped

# Usage statistics: outcome brief

Confirmed with the user (phase 1).

## Outcome

The human opens one usage panel in the dock. At the top is a GitHub-style day matrix, one per agent: darker days are bigger days, clicking a day shows its breakdown. Under it, for the selected range:

- stacked bars: how big each day was and which agent it came from
- **When you work**: weekday by hour
- **Where it went**: by space and model, with the share not run in Grove marked

Claude and Copilot come first. Numbers are tokens and request counts from the agents' own records. Scope is everything on this machine, including sessions started outside Grove. When OpenCode uses Copilot's models, each request is counted once, under Copilot, tagged "via OpenCode". Dollar amounts only where an agent reports a cost itself.

An agent appears only if it had usage in the last 30 days. No empty matrices. If no agent did, one plain "no usage in the last 30 days" message.

## Non-goals

- Plan limits, quotas, reset times (explicitly out).
- Estimated dollar costs.
- Any change to the context ring, meter or warn/handoff levels.
- Combining numbers across machines.
- OpenCode's own panel: OpenCode stays silent (no placeholder, no "not available yet") until its data works.

## How we'll know it works

- Claude and Copilot totals for a day match what the human expects from a day's work, including sessions started outside Grove.
- An OpenCode request made through Copilot appears once.
- An agent with nothing in the last 30 days is absent, not shown as zeros.

## Decision log

| # | Question | Answer | Decided by |
|---|----------|--------|------------|
| 1 | Meaning of "detailed usage statistics" | Consumption (tokens, requests over time by agent/model/space); limits later | user (accepted) |
| 2 | Whose sessions count | Everything on this machine, Grove-run share marked | user (accepted) |
| 3 | Where shown | Dock panel | user (accepted) |
| 4 | OpenCode over Copilot overlap | Count once, under Copilot, tag "via OpenCode" | user (accepted) |
| 5 | OpenCode lag | OpenCode may lag; stays silent (no placeholder) | user |
| 6 | Money vs tokens | Tokens and requests; dollars only where agent reports | user (accepted) |
| 7 | Layout | Matrix as navigator, stacked bars for range, per-agent Today/7d/30d header, "When you work", "Where it went" | user |
| 8 | Hide empty agents | Show an agent only with usage in last 30 days | user |
| 9 | Plan limits | Out of scope | user |

| 10 | Keep own record of daily numbers | Yes: one entry per request, no conversation text, per machine, wipeable. **Superseded (ADR 0004):** no saved record; built from the agents' files at every start; nothing to wipe. | user |
| 11 | Matrix darkness and bar height | Requests (model calls, helper agents included); quartile shading of own days; tokens on click | user |
| 12 | Copilot cost | Credits, no dollar sign; Claude none; not added across agents | user |
| 13 | Claude Desktop | Included in Claude as its own slice | user |

Settled from research and the checker (not asked): helper agents included, shown as "of which helper agents" in the day detail; where it went by repository with worktrees rolled up, Spaces marked, "Other" for the rest, with model as a second breakdown; Claude's sources shown as Claude Desktop, Claude Code run in Grove, Claude Code not tracked by Grove (that split only from 2026-11-05, "can't tell" before); a Copilot credit total that includes OpenCode-via-Copilot requests is marked "plus N requests without credits"; a day is the local day; ~~the panel shows "history from <date>"~~ (superseded by ADR 0004: a day older than an agent's own earliest request is "no record that far back"); an agent with no request in 30 days is hidden and returns, with what its files hold, when it is active again; ~~wiping the history resets "history from"~~ (superseded: nothing is saved). Later changes: the per-agent "Where it ran" section was removed (62d03dd; a day's detail still says where it ran); hover, tooltip, arrow keys and a calm first drawing were added (92313f5).

Correction to the outcome above: the headline number is requests (model calls), with tokens (and Copilot credits) as detail on click; "where it went" is by repository, not Space.

Mockups: https://claude.ai/artifact/UrnxD9zaWzvNr1n1LC2Tta
