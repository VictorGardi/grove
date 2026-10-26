---
feature: 2026-10-26-artifacts-canvas
phase: outcome
status: approved
version: 1
created: 2026-10-26
updated: 2026-10-26
approved_at: 2026-10-26
based_on: []
forced: []
---

# Outcome: artifacts canvas

## Summary

A new project-level **Artifacts** view in Grove that works like Claude's artifacts page: a whiteboard of live preview cards for every artifact in the project, grouped by feature, that you pan and zoom, open full page, step through, and comment on, sending the comments to the right Grove session.

## What the human sees and does

1. On a project they switch between Board, Sessions and a new **Artifacts** view.
2. The Artifacts view is a whiteboard. Each feature is a labelled cluster; inside it each artifact is a card in stage order (questions, research, design, and so on). Each card shows a real rendered preview: the page for html, the image for images, the start of the text for markdown, with name, stage and modified time.
3. They move around the board (pan) and zoom in and out. Cards cannot be dragged or rearranged.
4. A feature filter narrows the board to one feature's cluster; clearing it shows all.
5. Clicking a card opens that artifact **full page**, replacing the board, with a Back button and breadcrumb. Back returns to the board at the same pan, zoom and filter.
6. In full page they step to the neighbouring artifact (previous/next) without going back to the board; order follows the board (within a cluster, then the next cluster).
7. In full page they add comments to a markdown artifact, as they do today in the viewer and diff view. Comments stay saved on the artifact until sent, so they can comment with no session running.
8. The comment tray shows "Sending to: <session>", the feature's linked session. One linked session: Send goes there. Several: the most recently active is the default and they click the chip to switch. None: Send becomes "Start a session and send", which starts a session on that feature with the comments as its first message.
9. The Feature page keeps its Files list and the right-hand viewer exactly as today.

## Non-goals

- Dragging or rearranging cards, or remembering custom card positions.
- A per-feature whiteboard on the Feature page, or removing the Files list or right-hand viewer.
- Commenting on html or image artifacts (today only markdown and diffs are commentable).
- Changing how diffs or the existing viewer comments work.
- Searching or editing artifacts from the board.

## How I'll know it works

- The Artifacts view opens from the project and shows every feature's artifacts as preview cards in labelled clusters.
- I can pan and zoom smoothly, and the feature filter narrows and restores the board.
- Clicking a card opens it full page; Back returns me to the same pan, zoom and filter; previous/next steps through artifacts.
- I can comment on a markdown artifact in full page and Send goes to the right session, visible in the chip: the linked one, a chosen one when several, or a new one when none.
- Comments I add with no session running are still there when I come back and send them.
- The Feature page and its right-hand viewer behave as before.

## Interview log

**Q1. Where should the whiteboard live, and which artifacts does it show?** Options: per project (recommended), per feature, both.
**A1.** "i want to see project level -> but also filter by feature?" (project-level page showing all features' artifacts, with a filter by feature.)

**Q2. How should each artifact appear on the whiteboard, and how are the cards arranged?** Options: live previews grouped by feature (recommended), simple title cards grouped, live previews you place yourself, live previews grouped and draggable.
**A2.** Live previews, grouped by feature (each artifact a card with a real rendered preview; each feature a labelled cluster in stage order; pan and zoom the board; feature filter narrows to one cluster; no dragging of cards).

**Q3. When you open an artifact full page from the board, what should that look like and how do you get back?** Options: replaces board with Back (recommended), reuse expanded viewer, read-only full page, replaces board plus step through.
**A3.** (free text) "what i haven't mentioned is that i'd like to be able to add comments to artifacts and send to grove session.. just like in diff view. how can we do this in a really nice way? i'd also like the step through feature you're mentioning. the difficult part here is how to send comments to the right session?" (Comments on artifacts sent to a session like the diff view; step-through between artifacts wanted; open question for the human: which session receives the comments.)

**Q4. When you add comments to an artifact on the board or full page and hit Send, which session receives them?** Options: smart default with target chip (recommended), always ask, save now and send later, pin a session once.
**A4.** Smart default with a target chip: the tray shows "Sending to: <session>", the feature's linked session. One linked session: Send goes there. Several: defaults to the most recently active, click the chip to switch. None: Send becomes "Start a session and send" with the comments as the first message. Comments stay saved on the artifact until sent, so commenting works with no session running.

**Q5. Where does the whiteboard sit, and what happens to today's Files list and side viewer?** Options: new view beside Board (recommended), beside Board plus link from Files list, per-feature whiteboard too, whiteboard only.
**A5.** New view beside Board (Board, Sessions, Artifacts on a project). The Feature page keeps its Files list and right-hand viewer unchanged.

## Open questions
