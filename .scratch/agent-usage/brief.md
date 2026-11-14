# Agent usage sources: outcome brief (confirmed by user)

Status: needs-triage

Claude and Copilot tabs: nothing changes for the human (context ring, Context level, core-log failure lines keep wording).
OpenCode tabs: one deliberate change. Today the ring blanks when OpenCode reports something we can't turn into a figure
(e.g. unknown model window). After: the ring keeps the last good figure until a new valid reading arrives, like Claude and
Copilot. Claude's own "no reading yet" readings (e.g. after compaction) still clear the ring.
Scope: the three usage readers only (core/agents/{claude,copilot,opencode}/usage.ts). Session discovery is out of scope.
Done when: Claude/Copilot tests pass unchanged; OpenCode tests change only where they expected a clear; typecheck passes;
the repeated parts (number check, duplicate-report suppression, report-failure logging, poll-and-close) live in one place so
a fourth agent needs only its own reading logic.

## Decision log
- Q1 same behaviour for human: yes (user)
- Q2 make OpenCode behave like Claude/Copilot (never clear on unsupported reading): user
- Q3 keep log wording: yes (user)
- Q4 scope = usage readers only: yes (user)
- Q5 done bar: yes (user)

## Research round (no interview rounds needed)
Research: .scratch/agent-usage/research-docs.md plus behaviour report (see chat). Open decisions found: first read at creation vs
first interval, close-during-drain guard, shared helper shape, dedupe-key `at` handling. All reversible, invisible to the human,
so they fail the altitude rule: decided at implementation, preserving today's observable behaviour. No ADR passes the three
tests. Respondent/checker rounds skipped as vacuous. GLOSSARY.md "Context level" updated with the keep-last-good-reading rule.
