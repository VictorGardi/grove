---
id: T-020
title: fix alignment send button
status: done
created: "2026-04-04"
planSessionId: ses_2a61a6e82ffelBUK0fxJZjuDSM
planSessionAgent: opencode
planModel: opencode/big-pickle
useWorktree: false
execSessionId: ses_2a6161328ffeb2FW3bj6AWH0nX
execSessionAgent: opencode
---

## Description

Fix vertical alignment of the Send button in the PlanChat input area so it is centered with the input text window.

**Root cause:** The `.inputArea` container uses `align-items: flex-end` which aligns both the textarea and Send button to the bottom edge.

**Solution:** Change `align-items: flex-end` to `align-items: center` in `src/renderer/src/components/TaskDetail/PlanChat.module.css` (line 386).

## Definition of Done

- [ ] Change `.inputArea` CSS from `align-items: flex-end` to `align-items: center`

## Context for agent
