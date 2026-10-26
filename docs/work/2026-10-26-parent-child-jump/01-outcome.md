---
feature: 2026-10-26-parent-child-jump
phase: outcome
status: approved
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at: 2026-10-26
based_on: []
forced: []
---

# Outcome: session children in the parent header

## Summary

When you look at a session that belongs to a family, its header shows the family and lets you jump inside it in one step. A parent's header shows a chip for its **active child** (name and live status) plus an "N children" control that opens a list of every child. A child's header shows an "↑ parent" chip. One keyboard shortcut toggles: on a parent it goes to the active child, on a child it goes to the parent. Grid pane headers show the same chips. The **active child** is the running child that needs you most: waiting, then working, then idle. Ended children are never the jump target. Sessions with no family look and behave exactly as they do today.

## What the human sees and does

1. **Parent with one running child.** The header row (still one row) shows a chip with that child's name and status dot, followed by "1 child". Clicking the chip, or pressing the shortcut, focuses the child the same way selecting it in the sidebar does.
2. **Parent with several running children.** The chip shows the one that needs you most: waiting beats working, working beats idle. Ties go to the one you looked at most recently, then the newest. The chip updates on its own as statuses change.
3. **Opening the children list.** Clicking "N children" opens a list of every child with name and status: running children first by urgency, ended children last, shown as ended. Clicking any entry, ended ones included, jumps to it. The list closes after a jump, on an outside click, or on Escape.
4. **Child header.** A child's header shows "↑ <parent name>". Clicking it, or pressing the shortcut, focuses the parent. Pressing the shortcut again goes to the parent's active child, which may differ from the child you came from.
5. **Parent whose children have all ended.** No active-child chip. "N children" stays and lists the ended children. The shortcut does nothing (no jump, no error dialog).
6. **Starting or failed children.** A starting child counts as running but ranks after every waiting, working or idle child. A failed child counts as ended: never the jump target, still in the list.
7. **Child whose parent has ended but still exists.** "↑ parent" is still shown and still jumps.
8. **Child whose parent was removed.** It becomes standalone, as today: no "↑ parent" chip, the shortcut does nothing.
9. **Session with no family.** Header unchanged from today; the shortcut does nothing.
10. **Grid panes.** Each pane header shows the same chips and "N children" control. Clicking one focuses the target as clicking that session elsewhere would. The shortcut acts on the focused session.
11. **Sidebar.** Unchanged. Jumping to a child hidden in a collapsed group shows the existing "holding focus" marker on the parent.

## Non-goals

- Groups deeper than one level.
- Marking or pinning the active child by hand.
- Creating, re-parenting or removing children from the header (ParentPicker, sidebar menu and CLI cover that).
- Changes to the sidebar nesting, collapsed rail, command palette, or Ctrl+Tab behaviour.
- Cycling through several running children with the shortcut; it always goes to the single active child.
- Notifications or badges outside the header.

## How I'll know it works

- [ ] A parent with one running child shows a chip with that child's name and status, plus "1 child"; clicking the chip focuses the child.
- [ ] A parent with one waiting, one working and one idle child shows the waiting child in the chip; when it stops waiting, the chip switches to the working child without a reload.
- [ ] "N children" shows the right count (ended included); its list orders running by urgency then ended, and clicking any entry focuses it.
- [ ] A child's header shows "↑ <parent name>"; clicking it focuses the parent.
- [ ] The shortcut goes parent → active child and child → parent; pressing it twice from a parent returns to the same active child.
- [ ] On a parent whose children have all ended or failed: no active-child chip, the list still shows them, the shortcut does nothing.
- [ ] On a session with no family, the header is unchanged and the shortcut does nothing.
- [ ] After a parent is removed, its former children show no "↑ parent" chip.
- [ ] Grid pane headers show the same chips and list and jump the same way.
- [ ] The header stays one row with the chips added.
- [ ] Jumping to a child hidden in a collapsed sidebar group focuses it and the parent shows the existing "holding focus" marker.
- [ ] Existing shortcuts (⌘., Ctrl+Tab, ⌘1..9, ⌘K and the rest) behave as before.

## Interview log

1. **Q: When you jump from a parent to its "active child", which child should that be?** Options: running then most urgent (recommended); most urgent; most recently viewed; marked by hand.
   **A:** Running, then most urgent. If exactly one child is still running it is the active child; if several run, the one that needs the human most wins (waiting, then working, then idle). Ended children are never the jump target.
2. **Q: When you're looking at a parent session, what should its header show about its children?** Options: active-child chip plus a child count that opens a list (recommended); active-child chip only; every child as a chip; nothing, shortcut only.
   **A:** Chip + count list. A chip with the active child's name and status, which jumps there on click, plus an "N children" control that opens a list of every child with its status; clicking one jumps to it. The header stays one row.
3. **Q: Should the jump work both ways, from the keyboard, and in grid panes?** Options: round trip everywhere (recommended); parent → child plus shortcut; mouse only, main view only; round trip but not in grid.
   **A:** Round trip everywhere. A child's header shows an "↑ parent" chip; one keyboard shortcut toggles parent → active child and child → parent; grid pane headers show the same chips.

## Open questions
