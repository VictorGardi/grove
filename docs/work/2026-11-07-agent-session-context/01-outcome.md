---
feature: 2026-11-07-agent-session-context
phase: outcome
status: approved
version: 3
created: 2026-11-07
updated: 2026-11-07
approved_at: 2026-11-07
based_on: []
forced: []
---

## Summary

People want to see token usage for each agent session in relation to that agent's context window, with the measurement timing clear.

## What the human sees and does

- For Claude and Copilot, the person can see the current context tokens out of the session's context-window limit.
- For Copilot after resume, a saved usage pair is labeled “last measured” with its timestamp until a fresh SDK event arrives; if no pair has been saved, no reading is shown until an event arrives.
- For OpenCode, the person can see the exact input tokens from the latest completed model request out of the model's context limit, labeled as the last request with its measurement time. This is a snapshot, not a continuously current occupancy reading.
- The person can distinguish the usage for one session from another.

## Non-goals

- Viewing prompts or transcripts
- Displaying other context metrics
- Changing or managing an agent session's context

## How I'll know it works

- Each agent session shows its context usage as tokens consumed out of its context window.
- A saved Copilot reading after resume is clearly marked as last measured, not current.
- OpenCode's last-request measurement is visibly labeled with its timestamp and is not presented as continuously current.
- People can distinguish the usage for one session from another.

## Interview log

- **Question:** What would you want to see to understand an agent session?
  - The starting request; a concise overview of request, work, and latest result; or the full conversation.
  - **Answer:** “No — show context usage for each agent: how many tokens it has consumed out of that agent's context window.”
- **Question:** Should OpenCode use exact current occupancy only, its exact latest-request measurement with a timestamp, or an estimated current-context value?
  - **Answer:** B — use the exact latest-request tokens and context limit with a timestamp; the human understands this is not continuously current.
- **Question:** How should Copilot's saved reading appear after resume, when its live usage event is not replayed?
  - **Answer:** Restore the last saved exact pair with its timestamp and label it “last measured,” not current; show no reading until an event if no saved pair exists.

## Open questions
