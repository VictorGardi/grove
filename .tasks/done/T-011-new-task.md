---
id: T-011
title: allow @ to attach files to agent chat
status: done
created: "2026-04-03"
autoRun: true
agent: opencode
planSessionId: ses_2a87f05a8ffe8sNM1zMitlSZUU
planSessionAgent: opencode
planModel: opencode/big-pickle
runSessionAgent: opencode
runModel: opencode/big-pickle
worktree: null
branch: null
useWorktree: false
execSessionId: ses_2a6e2cee3ffeuOOWIiI0u0jBiL
execSessionAgent: opencode
execModel: opencode/big-pickle
---

## Description

Add @ file mention autocomplete to the PlanChat input. When the user types @, show a dropdown with fuzzy-matched files from the workspace. The user can navigate with arrow keys and select with Enter. The selected file path is inserted into the input as @filepath.

## Definition of Done

- [x] Detect @ trigger in input and show file dropdown
- [x] Filter files using Fuse.js fuzzy search as user types after @
- [x] Support keyboard navigation (ArrowUp/ArrowDown) through results
- [x] Support selection with Enter key
- [x] Support dismissal with Escape key
- [x] Click on dropdown item also selects the file
- [x] Selected file path is inserted into input as @filepath
- [x] Multiple @ mentions can be added in one message
- [x] Handle case when no files match the search query
- [x] Handle case when @ is at end of input (show all files)
- [x] Dropdown is positioned correctly near the cursor
- [x] Handle @ in middle of text (not just end of string)
- [x] Close dropdown when @ is deleted or followed by space
- [x] Handle blur/focus loss properly
- [x] UX is consistent with other autocomplete experiences (VS Code, etc.)

## Context for agent
