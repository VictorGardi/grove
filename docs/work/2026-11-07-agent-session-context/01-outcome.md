---
feature: 2026-11-07-agent-session-context
phase: outcome
status: draft
version: 4
created: 2026-11-07
updated: 2026-11-08
based_on: []
forced: []
---

## Summary

People want to see token usage for each agent session against the capacity figure that agent exposes, with the measurement timing and meaning clear.

## What the human sees and does

- For Claude, the person can see the current context tokens out of the provider-reported context-window limit.
- For Copilot, the person can see the exact input tokens of the latest completed request out of the CLI's prompt budget, labeled as a last request with its measurement time and explicitly not a context-window reading. When the budget is unavailable, only the input tokens are shown.
- For Copilot after resume, the last usage record is replayed and shown with its timestamp until a newer request arrives; if no record exists, no reading is shown.
- For OpenCode, the person can see the exact input tokens from the latest completed model request out of the model's context limit, labeled as the last request with its measurement time. This is a snapshot, not a continuously current occupancy reading.
- The person can distinguish the usage for one session from another, and a hand-started session that cannot be uniquely identified shows no reading.

## Non-goals

- Viewing prompts or transcripts
- Displaying other context metrics
- Changing or managing an agent session's context

## How I'll know it works

- Each agent session shows its usage against the capacity figure its provider exposes, under a label that states whether it is current or a last request.
- Copilot's denominator is always called a prompt budget, never a context window.
- A replayed Copilot reading is clearly marked as a last request with its timestamp, not current.
- OpenCode's last-request measurement is visibly labeled with its timestamp and is not presented as continuously current.
- An ambiguous hand-started Copilot or OpenCode session shows no reading rather than another session's numbers.
- People can distinguish the usage for one session from another.

## Interview log

- **Question:** What would you want to see to understand an agent session?
  - The starting request; a concise overview of request, work, and latest result; or the full conversation.
  - **Answer:** “No — show context usage for each agent: how many tokens it has consumed out of that agent's context window.”
- **Question:** Should OpenCode use exact current occupancy only, its exact latest-request measurement with a timestamp, or an estimated current-context value?
  - **Answer:** B — use the exact latest-request tokens and context limit with a timestamp; the human understands this is not continuously current.
- **Question:** The Copilot SDK cannot attach to Grove's already-running interactive `copilot` CLI. Which constraint wins: the exact current/full-window metric via an SDK-owned Copilot, or keeping the interactive CLI with a weaker metric?
  - **Answer:** Keep the interactive CLI. Show the timestamped input tokens of the latest completed request out of the CLI's prompt budget, labeled honestly; do not call the budget a context window, and show tokens only when the budget is missing.
- **Question:** A hand-started Copilot tab can match more than one session in the same folder. What should happen?
  - **Answer:** Show no reading when the session cannot be uniquely identified; never risk attributing another session's usage.
- **Question:** How long should a replayed Copilot reading stay visible with no newer request?
  - **Answer:** Keep the last record with its timestamp until a newer one arrives; the timestamp carries the age.

## Open questions
