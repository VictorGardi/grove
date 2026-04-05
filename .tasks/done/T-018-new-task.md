---
id: T-018
title: show agent running with indicator when planning session is ongoing
status: done
created: '2026-04-04'
useWorktree: false
planSessionId: ses_2a6847c3effeRav4Ier5RuM6u5
planSessionAgent: opencode
planModel: opencode/big-pickle
execSessionId: ses_2a6823eaaffeX2Jy3SkwOcE82p
execSessionAgent: opencode
---

## Description

When a planning agent is actively running for a task in the backlog column, display a visual indicator on the task card similar to the existing execution agent indicator in the doing column.

**Implementation approach:**

1. In `TaskCard.tsx`, add a selector to check if a planning session is running: `usePlanStore((s) => s.sessions[\`plan:${task.id}\`]?.isRunning ?? false)`
2. Show the existing agent running indicator when `task.status === "backlog"` and planning is running
3. Reuse the existing CSS classes (`agentRunningRow`, `agentRunningDot`, `agentRunningLabel`) for consistency

**Edge cases to handle:**

- If task moves from backlog → doing while planning runs, indicator disappears (planning session key changes to execute)
- Stale `isRunning` state handled by existing PlanChat mount effect

## Definition of Done

- [x] Add planning agent running check to TaskCard component
- [x] Show indicator for backlog tasks with active planning session
- [x] Verify indicator displays correctly when plan agent is running
- [x] Verify indicator hides when planning session ends or task moves to doing
