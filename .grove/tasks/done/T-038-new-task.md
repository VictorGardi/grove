---
id: T-038
title: when a task is created the title input should be active right away
status: done
created: "2026-04-05"
planSessionId: ses_2a2ad72deffejbyvbr25MbxolI
planSessionAgent: opencode
planModel: opencode/big-pickle
execSessionId: ses_2a2abb6fdffeRaklpTrzWBWgUg
execSessionAgent: opencode
---

## Description

When a user creates a new task (via Cmd+T or clicking "+ New task"), the title input field should be automatically active and ready for typing, without requiring the user to click on the title area first.

### Implementation approach

1. Add a `startEditing` prop to `InlineEdit` component (`src/renderer/src/components/shared/InlineEdit.tsx`)
   - When `true`, initialize `editing` state to `true` (instead of `false`)
   - The existing `useEffect` will then focus and select the input

2. In `TaskDetailPanel`, detect newly created tasks and pass `startEditing`
   - New tasks are created with title "New task" (see `taskActions.ts:129`)
   - When `task.title === "New task"`, pass `startEditing={true}` to `InlineEdit`

3. Edge case: if user clicks away (blur) before typing, keep "New task" as the title (existing behavior)

## Definition of Done

- [x] When a user creates a new task via Cmd+T or "+ New task" button, the title input is immediately focused
- [x] User can type the task title without clicking on the title area
- [x] Pressing Enter saves the title and exits edit mode
- [x] Pressing Escape cancels the edit and reverts to "New task" (the default title)
- [x] Opening an existing task does NOT auto-focus the title input
- [x] Tab navigation works normally in the title input

## Context for agent
