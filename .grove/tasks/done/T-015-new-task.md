---
id: T-015
title: remove new ticket
status: done
created: "2026-04-04"
planSessionId: ses_2a72c976affeQ6OeKIGGF2EaKY
planSessionAgent: opencode
planModel: opencode/big-pickle
useWorktree: false
execSessionId: ses_2a6ea0ef1ffeJLr40anIBRit7U
execSessionAgent: opencode
---

## Description

Remove the "+ Add ticket" button from the footer of each kanban column in the Board component.

## Definition of Done

- [x] The footer div containing "+ Add ticket" is removed from Column.tsx (lines 37-39)
- [x] The unused `createTask` import is also removed from Column.tsx
- [x] The Column component still renders correctly without the footer

## Context for agent

The button is located at `/Users/victor/test/grove/src/renderer/src/components/Board/Column.tsx` lines 37-39:

```jsx
<div className={styles.footer} onClick={() => createTask("New task")}>
  + Add ticket
</div>
```

After removal, the import on line 3 (`import { createTask } from "../../actions/taskActions";`) will be unused and should also be removed.
