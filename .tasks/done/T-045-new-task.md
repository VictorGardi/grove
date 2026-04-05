---
id: T-045
title: double scroll bar edit view in task panel details
status: done
created: "2026-04-05"
planSessionId: ses_2a2917d75ffeR15Bnu6D84hx2b
planSessionAgent: opencode
execSessionId: ses_2a28e9ab2ffenE2EX2ZwLFiNPF
execSessionAgent: opencode
execModel: opencode/big-pickle
execTmuxSession: grove-exec-c0e897-T-045
---

## Description

In the task panel details modal, the edit view (split markdown editor + preview) showed double scrollbars: one on the outer container and one on the inner scrollable pane (textarea or preview). This was caused by flex children not properly constraining their minimum height, allowing them to overflow their parent containers and trigger additional scrollbars at multiple levels.

## Definition of Done

- [x] Define acceptance criteria

## Acceptance Criteria

- The edit view (textarea on the left, preview on the right) should each show exactly **one** scrollbar when content overflows — on the scrollable pane itself, not on any parent container.
- The `.modal` container must not show a scrollbar.
- The `.splitView`, `.editorPane` containers must not show scrollbars (they clip via `overflow: hidden`).
- Only `.editor` (textarea) and `.previewPane` scroll independently with `overflow-y: auto`.

## Fix

Added `min-height: 0` to all flex children in the scroll containment chain in `TaskDetailPanel.module.css`:

- `.splitView` — flex child of `.modal` (column flex)
- `.previewPane` — flex child of `.splitView` (row flex)
- `.editor` (textarea) — flex child of `.editorPane` (column flex)
- `.changesWrapper` — flex child of `.modal` (column flex) — fixed for consistency

Also added `height: 100%` to `.editor` textarea to ensure it fills the pane correctly.

**Root cause:** In CSS flexbox, the default `min-height` for flex items is `auto` (respects the intrinsic/content size). For a textarea or scrollable div, this means the item will grow to fit all its content rather than being constrained by the flex container — causing overflow and triggering parent scrollbars. Setting `min-height: 0` overrides this so the flex item can shrink below its content size and scroll internally instead.

## Context for agent

File changed: `src/renderer/src/components/TaskDetail/TaskDetailPanel.module.css`
