# Decision log (running)

See `brief.md` for the user-confirmed decisions 1 to 9. Research is in `research-*.md`.

## Facts that changed the picture (from research)

- Copilot bills in AI credits since 2026-06-01 (1 credit = $0.01), and the local records carry a per-request credit figure. "Request count" is no longer Copilot's billing unit.
- OpenCode requests made on Copilot's models appear only in OpenCode's database, never in Copilot's records. Counting them under Copilot needs a small OpenCode reader, and they carry no credit figure.
- Claude deletes transcripts after 30 days by default (docs). This machine shows 6 months, with no setting found: unresolved.
- "Run in Grove" is knowable for Copilot (Grove's tab files list its sessions) and for Claude only since 2026-11-05.
- Claude and Copilot totals need dedupe and must include helper agents (about a quarter of requests).
- A usage-history scan needs a cache and an incremental update: core is single-threaded and a full Claude scan is about 6 to 14 s.

## Open decisions (frontier, round 1)

Q1 Keep own history. Q2 Matrix metric. Q3 Copilot credits. Q4 Helper agents. Q5 Where-it-went grouping. Q6 "Run in Grove" labelling. Q7 OpenCode-via-Copilot display. Q8 Is Claude pruning at 30 days here.

## Round 1 (respondent: fresh, stateless)

New facts: 53% of this machine's Claude requests are Claude Desktop (kept for months, never run in Grove); terminal Claude sessions are pruned at 30 days (confirmed: terminal history starts 2026-10-07). Copilot's per-request credit sums match its session totals exactly (36 of 36), so credit billing is real here. Rolled up by repository, Claude's requests fall into 15 groups (top 5 hold 96%); about 72% map to a current Space.

| Q | Respondent | Interviewer outcome |
|---|------------|---------------------|
| Q1 keep own history | inferred, high: keep a record with one entry per request (not day sums), larger count wins on rewrite | escalate (privacy, one-way door) |
| Q2 matrix metric | inferred, medium-high: requests; tokens as detail; quartile shading | escalate (product preference) |
| Q3 Copilot credits | inferred, high on trust: credits shown, no dollar sign | escalate (what the human sees) |
| Q4 helper agents | inferred, high: include, label | decided by interviewer: include |
| Q5 where it went | inferred, high: by repository, worktrees rolled up, Spaces marked, "Other" | decided by interviewer |
| Q6 Grove share | inferred, medium: "Not tracked by Grove", split starts 2026-11-05, Desktop separate | decided by interviewer; Desktop part escalated |
| Q7 OpenCode via Copilot | inferred, medium: narrow reader, counted under Copilot, "credits unknown" | decided by interviewer |
| Q8.1 Claude Desktop | inferred, high: include as its own slice | escalate (what the human sees) |
| Q8.2 time zone | needs-human, medium: local day, store request timestamps | decided by interviewer: local day, store timestamps |

Escalated to the user: Q1, Q2, Q3, Q8.1.

## User answers (round 1 escalation), all as recommended

| # | Question | Answer | Decided by |
|---|----------|--------|------------|
| 10 | Keep own record of daily numbers | Yes: one entry per request, no conversation text, per machine, wipeable | user |
| 11 | Matrix darkness and bar height | Requests; quartile shading of own days; tokens on click | user |
| 12 | Copilot cost | Credits, no dollar sign; Claude none; not added across agents | user |
| 13 | Claude Desktop | Included in Claude, as its own slice | user |

Settled by the interviewer from the respondent's evidence: helper agents included and labelled (inferred); where-it-went by repository with worktrees rolled up, Spaces marked, "Other" for the rest (inferred); the Grove share labelled "Not tracked by Grove", shown only from 2026-11-05 when Grove began recording, with Desktop known separately (inferred); OpenCode requests on Copilot counted under Copilot, tagged "via OpenCode", credits unknown, narrow reader, nothing else of OpenCode shown (inferred); a day is the local day, with request timestamps stored (inferred).

No open decision remains. Glossary updated: Request, Usage panel, Usage history, Not tracked by Grove.

## Final review (phase 4)

Checker: no blocking item in the brief's checklist; three blocking gaps (Claude's sources vs the Grove share, where helper agents show, partial Copilot credit totals) closed in brief.md. User reopened row 15 (hidden agent's history), asked what it costs, and kept it as drafted: hidden, history returns when the agent is used again. Rows 10 to 14 not reopened. ADR 0003 (usage history) approved and written to docs/adr/0003-usage-history.md. Recommended next step: to-spec first.

## After shipping

- ADR 0004 superseded row 10 (a saved record) and the "history from", wipe and saved-history-returns decisions: the history is built from the agents' files at every start and nothing is saved.
- The per-agent "Where it ran" section was removed (62d03dd); a day's detail still says where that day's requests ran.
- Hover, one tooltip, arrow keys and a calm first drawing were added (92313f5).
- "No record that far back" is per agent: each agent's own first request, not the earliest of all agents.
- Status set to `shipped` in spec.md and brief.md. It is not one of the five triage roles in `docs/agents/triage-labels.md`; those describe work not yet done.
