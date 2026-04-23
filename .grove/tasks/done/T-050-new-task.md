---
id: T-050
title: first message from user in execution chat
status: done
created: '2026-04-05T13:45:17.988Z'
planTmuxSession: grove-plan-c0e897-T-050
planSessionId: ses_2a21a9da0ffefPfnsIz2OBRYLH
planSessionAgent: opencode
planModel: opencode/big-pickle
execSessionAgent: opencode
execModel: opencode/big-pickle
execTmuxSession: grove-exec-c0e897-T-050
execSessionId: ses_2a20b0a79ffeihqcHUoYD9lBNR
completed: '2026-04-05T14:22:41.670Z'
---

## Description

When a task is moved from backlog to "doing" status, the user wants to see a first message in the execution chat. Currently, the agent starts without any visible user message.

The implementation should modify `handleDragToDoing` in `Board.tsx` to append a user message to the plan store AFTER successfully sending the execution prompt to the agent but BEFORE calling `startAgentMessage`. This ensures the user message appears on top (before the agent bubble).

The message should be: `Sent plan for ticket '{task title}' to Agent`

This provides visual confirmation that the plan was sent to the agent and gives context to the conversation thread.

## Definition of Done

- [x] Add user message to execution chat when task moves to doing
- [x] Message reads "Sent plan for ticket '{task title}' to Agent"
- [x] Message appears BEFORE the agent bubble (user message is last in the array)
- [x] Message only appears if execution successfully started (not on failure)
- [x] Manual test: drag task to doing, verify message appears above the agent bubble

## Context for agent
