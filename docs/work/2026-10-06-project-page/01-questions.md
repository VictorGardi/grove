---
feature: 2026-10-06-project-page
phase: questions
status: approved
version: 1
created: 2026-10-06
updated: 2026-10-06
approved_at: 2026-10-06
based_on: []
forced:
  - "approval with size verdict M in small flow: every decision was made by the human in grilling and recorded in ADR 0018; small flow chosen deliberately (2026-10-06)"
---

# Questions: project page

Standalone feature, `small` flow. Every product decision was chosen by the
human in a grilling session and is listed in `00-ticket.md` ("Decisions
chosen in grilling") and [ADR 0018](../../adr/0018-project-page-replaces-board-mode.md).
In `small` flow there is no research phase, so `grove-implement` answers the
research questions below from the code when it plans each slice.

## Goal

From the human: going back from a feature opened on the board, a keyboard
shortcut to the board, and seeing a session's content when it's clicked while
the board is showing. Rebuilt Xirp-style: the board lives on a project page,
reached from a Projects sidebar tab, ⌘B and breadcrumbs.

## Out of scope

- A navigation history stack (back/forward, ⌘[ / ⌘]).
- Project page tabs other than the board (Git, Files, Skills, Rules), layout
  buttons (grid/list), and a prompt box.
- Filtering the board by parent feature, or parent swimlanes.
- Drag-and-drop on either board (the board stays derived from files, ADR 0002).
- Persisting a board filter separate from the focused project.
- Child 7's command palette and grid view (it plans against this change).

## Research questions

1. How is `UiState` read, defaulted and written, and what happens today when a
   persisted `ui` object has a field the current type lacks, or lacks a field
   the type has? Is a `ui` shape change covered by `schemaVersion` and the
   migration path from ADR 0017?
2. Which code reads or writes `ui.view`, `ui.focusedSessionId`,
   `ui.focusedFeature` and `ui.sidebarTab`, in main, core and renderer,
   including `ui:set` handling and any invariant that keeps two focuses
   exclusive?
3. How does the `seenAt` mark (ADR 0015) decide that a session is "on
   screen", and what does it depend on in UI state?
4. What does each sidebar click handler call today (session card, linked
   feature button, feature row, project header, tabs), and what does each
   store action change?
5. How are menu accelerators defined, sent to the renderer (`menu:action`)
   and handled, and how do key presses reach the renderer while a terminal
   (xterm.js) has focus?
6. What do `ContentHeader` and its breadcrumbs render today, and are crumbs
   interactive anywhere?
7. Which data does the renderer already have for a feature card and a session
   card: card state, `progress`, linked sessions per feature, shown session
   status, `waitingFor`, the time a session entered its current status, and
   session kind?
8. How are group features and their children found (`group`, `parent`,
   `buildTree`, `boardColumns`, `colorTags`), and which tests cover them?
9. Which tests cover the sidebar tabs, the Board, `ViewToggle`, `ui.view` and
   UI-state persistence, and which would break if those were removed?
10. Which UI primitives (`ListRow`, `Tag`, `Badge`, `Button`, status tones) and
    tokens exist for cards and the amber waiting tone (ADR 0012)?

## Product questions for the human

All answered in the grilling session; see `00-ticket.md` decisions 1–13.

1. *Is the board a mode, a page or an overlay?* A page: the project page
   (an overlay was considered first, then replaced by the Xirp project-page
   shape).
2. *What does the board filter by?* Project only, by being on that project's
   page. The default is the project of the session or feature you were on.
3. *Features or sessions as cards?* Both, with a Features | Sessions switch.
4. *How is the project page reached?* A Projects sidebar tab replacing the
   Features tab, ⌘B, and breadcrumbs.
5. *How are parent features reached once the Features tab is gone?* From
   the parent tag on a card. Parent and child pages link to each other.
   Kept generic, never "epic".
6. *How does back work?* Breadcrumb up-links only.
7. *What does ⌘B do on the project page?* It switches Features/Sessions.
8. *Session board columns?* By status: Waiting | Working | Idle | Ended.
9. *Feature card richness?* Xirp-style, with linked sessions' live status.
10. *Content with nothing focused?* The last project page, else the first.
11. *Projects row?* Name, live session count, waiting badge, hover actions.
12. *Epic child or standalone?* Standalone.

## Size verdict

**M.** The result is clear and every decision is made, but it touches about
12 files across main (menu), shared types, the state store and most of the
renderer shell, and it changes the persisted UI-state shape, which is a
one-way door (recorded in ADR 0018). That would normally propose `standard`;
the human chose `small` (see `feature.md` Flow log). A natural slice order
for `grove-implement`: (1) project page, focus model, Projects tab,
breadcrumbs and ⌘B with the existing board on it; (2) the Sessions board;
(3) rich feature cards and parent/child links; (4) `CONTEXT.md`.

## Open questions
