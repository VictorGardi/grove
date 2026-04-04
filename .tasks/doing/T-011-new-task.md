---
id: T-011
title: allow @ to attach files to agent chat
status: doing
created: '2026-04-03'
autoRun: true
agent: opencode
planSessionId: ses_2a87f05a8ffe8sNM1zMitlSZUU
planSessionAgent: opencode
planModel: opencode/big-pickle
runSessionAgent: opencode
runModel: opencode/big-pickle
worktree: .worktrees/T-011
branch: feat/t-011-allow-to-attach-files-to-agent
execSessionId: ses_2a7062f19ffebZ4OWlnCO30Sn2
execSessionAgent: opencode
execModel: opencode/big-pickle
---

## Description

Add @ file mention autocomplete to the PlanChat input. When the user types @, show a dropdown with fuzzy-matched files from the workspace. The user can navigate with arrow keys and select with Enter. The selected file path is inserted into the input as @filepath.

## Definition of Done

- [ ] Detect @ trigger in input and show file dropdown
- [ ] Filter files using Fuse.js fuzzy search as user types after @
- [ ] Support keyboard navigation (ArrowUp/ArrowDown) through results
- [ ] Support selection with Enter key
- [ ] Support dismissal with Escape key
- [ ] Click on dropdown item also selects the file
- [ ] Selected file path is inserted into input as @filepath
- [ ] Multiple @ mentions can be added in one message
- [ ] Handle case when no files match the search query
- [ ] Handle case when @ is at end of input (show all files)
- [ ] Dropdown is positioned correctly near the cursor
- [ ] Handle @ in middle of text (not just end of string)
- [ ] Close dropdown when @ is deleted or followed by space
- [ ] Handle blur/focus loss properly
- [ ] UX is consistent with other autocomplete experiences (VS Code, etc.)

## Context for agent

