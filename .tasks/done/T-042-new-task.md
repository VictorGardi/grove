---
id: T-042
title: name of task changes with task title
status: done
created: '2026-04-05'
planSessionId: ses_2a29d5b6fffefIuLU0HASIo0pX
planSessionAgent: opencode
planTmuxSession: grove-plan-c0e897-T-042
planModel: opencode/big-pickle
execTmuxSession: grove-exec-c0e897-T-042
execSessionId: ses_2a215eedcffeXLjmAw8WuFH2VT
execSessionAgent: opencode
execModel: opencode/big-pickle
completed: '2026-04-05T14:06:58.997Z'
---

## Description

All tasks created from the UI are named `T-XXX-new-task.md` because the hardcoded title `"New task"` is slugified at creation time. The simplest fix is to use ID-only filenames: `T-XXX.md`. This eliminates the rename complexity entirely.

### Approach

Change the filename format in `createTask` from `${id}-${slug}.md` to `${id}.md`. No other changes required — title lives in frontmatter, not in the filename.

### Files affected

- `src/main/tasks.ts` — `createTask`

## Definition of Done

- [x] New tasks are created with filename `T-XXX.md` (e.g. `T-001.md`) instead of `T-XXX-new-task.md`
- [x] Title continues to be stored in the YAML frontmatter (no change to data model)
- [x] Existing tasks are not migrated — no bulk rename of existing files needed
- [x] Task ID is derived from the filename prefix (`T-XXX`) at parse time, unchanged
- [x] Task status is still derived from the directory (`backlog`, `doing`, etc.), unchanged

## Context for agent
