---
id: T-047
title: tasks in done column should be in order of execution
status: done
created: "2026-04-05"
planTmuxSession: grove-plan-c0e897-T-047
planSessionId: ses_2a26842b2ffevZ5D84QS8S9PK3
planSessionAgent: opencode
planModel: opencode/big-pickle
execTmuxSession: grove-exec-c0e897-T-047
execSessionId: ses_2a2670504ffeViyhcsjHSEcRc9
execSessionAgent: opencode
execModel: opencode/big-pickle
---

## Description

The Done column currently displays tasks in an undefined order (filesystem/alphabetical). Users expect tasks to appear in the order they were completed - earliest completion at the top.

To implement this:

1. Add a `completed` field (YYYY-MM-DD) to TaskFrontmatter that gets set when a task moves to "done" status
2. Update `moveTask()` in src/main/tasks.ts to set the completed date when moving to "done"
3. Sort done tasks by completed date (ascending), with fallback to `created` date for legacy tasks without `completed`

## Definition of Done

- [x] Add `completed` field to TaskFrontmatter type in src/shared/types.ts
- [x] Modify moveTask() in src/main/tasks.ts to set completed date when toStatus is "done"
- [x] Sort done tasks by completed date in Board.tsx (fallback to created for tasks without completed)
- [x] Verify: move a task to done and check the completed field is set in the markdown file
- [x] Verify: done column shows tasks in completion order (oldest completed at top)

## Context for agent
