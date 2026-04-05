---
id: T-048
title: always show agent tab in task detail
status: done
created: "2026-04-05T12:42:50.864Z"
planTmuxSession: grove-plan-c0e897-T-048
planSessionId: ses_2a25420a7ffeVPVbsUUdOFF9t2
planSessionAgent: opencode
planModel: github-copilot/claude-sonnet-4.6
execTmuxSession: grove-exec-c0e897-T-048
execSessionId: ses_2a250eec7ffeXPAblOTe1hynwt
execSessionAgent: opencode
execModel: opencode/big-pickle
completed: "2026-04-05T12:50:33.737Z"
---

## Description

The Agent tab in `TaskDetailPanel` is currently gated behind `task.status === "backlog" || task.status === "doing"`, hiding it for tasks in `review` or `done` status. Additionally, the tab label is conditionally "Plan" for backlog and "Agent" for doing.

This change makes the Agent tab always visible regardless of task status, and renames it to "Agent" in all cases.

**Changes required in `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx`:**

1. Remove the status condition (`task.status === "backlog" || task.status === "doing"`) that gates the Agent tab button in the tab bar — always render it.
2. Always label the tab "Agent" (remove the `task.status === "doing" ? "Agent" : "Plan"` ternary).
3. Remove the same status condition gating the `PlanChat` component mount — always keep it mounted (the hidden/visible toggle via `display: none` / `display: flex` already handles non-active tabs).
4. For `PlanChat`'s `mode` prop: use `"execute"` for `doing` status, `"plan"` for all other statuses.
5. Keep the existing default tab logic: default to `"plan"` for backlog/doing tasks, `"edit"` for review/done tasks (no change needed here).

## Definition of Done

- [x] The Agent tab button is rendered in the tab bar for all task statuses (backlog, doing, review, done)
- [x] The Agent tab is always labeled "Agent" — the "Plan" label is removed
- [x] The Agent tab button for a backlog task is labeled "Agent" (not "Plan")
- [x] `PlanChat` is mounted for all tasks regardless of status
- [x] `PlanChat` uses `mode="execute"` for `doing` tasks and `mode="plan"` for all other statuses
- [x] Opening a backlog or doing task still defaults to the Agent tab; opening a review or done task still defaults to the Edit tab
- [x] Switching between Edit, Agent, Changes, and Debug tabs works correctly for all statuses
- [x] No regressions in the Edit, Changes, or Debug tab content

## Context for agent

The relevant file is `src/renderer/src/components/TaskDetail/TaskDetailPanel.tsx`.

The tab button to change is at lines 446–453. The `PlanChat` mount condition is at lines 473–507. The default tab `useEffect` is at lines 106–112 and does not need to change.
