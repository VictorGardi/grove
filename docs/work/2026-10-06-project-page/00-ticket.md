Source: the human's request on 2026-10-06, verbatim, followed by the decisions the human chose in the grilling session that followed (each one picked explicitly by the human).

## Request (verbatim)

i need a few small things. /grill-me . 1. when clicking on a feature from board i can only go back by clicking on board again, there is no going back button. 2. i need a keyboard shortcut to get to board. 3. when i'm in board mode and click on a session -> i don't see the session content, the session content is only visible when i'm in list mode? that is weird

## Follow-up remarks during grilling (verbatim)

- "i think the weird thing is that board mode still shows the list on the left sidebar, i mean it is always there.. maybe the board is not needed? or.. the board is another way to shows the features, and the features are in the sidebar when i choose features. web search and explore - how can i build this properly? right now that part is no good"
- "project only. just found xirp's project view where i can choose a board to show sessions and it is beautiful! i want something like this." (screenshot: Xirp's Projects sidebar tab; a project page with the project name, tabs, and a board of session cards in status columns; waiting cards amber with an "Input required" strip, branch, progress bar, elapsed time)
- "epic tag -> epic page. BUT.. we've said that the only thing that decides the workflow for us is the workflow.yaml but that there are epics is part of a workflow and now we're building that into the app - no? maybe we only have features but features can have children?"
- "grove small flow but document properly so other features that will be planned know about hte changes."

## Decisions chosen in grilling

1. The board is no longer a global mode. `ui.view` and the List/Board toggle go away. The board lives on a **project page**: the content area for one project.
2. Project page header: the project name and a Features | Sessions switch. No other tabs (Git, Files…), no layout buttons, no prompt box.
3. The board shows **Features** (columns = workflow stages, as today) or **Sessions** (columns by shown status: Waiting | Working | Idle | Ended; a plain terminal with status `running` goes in Working). One global choice, persisted in UI state.
4. Feature cards, Xirp-style: card state on top, title, parent tag, linked sessions as status dots; the whole card amber with an "Input required" strip when any linked session is waiting; progress for group features.
5. Session cards: label, linked feature tag, kind, time in the current state; waiting cards amber.
6. Sidebar tabs become **Sessions | Projects**; the Features tab is removed. A Projects row: folder icon, name, live session count, amber waiting count when any; hover actions new session and remove; Add project stays in the tab header.
7. Parent/child stays generic (a `workflow.yaml` kind with `group: true` and `parent_field`); the app never says "epic". A card's parent tag opens the parent's feature page. A group feature's page lists its children with their stage, each linking to its page. A child's page links up to its parent. Code names `epic` become `parent`.
8. Going back is by clickable breadcrumb up-links only, no history stack. Feature: project › parent › feature. Session: project › linked feature › session, or project › session when unlinked. The project segment opens the project page.
9. ⌘B (View menu, "Project Board") opens the project page of the current context: the focused session's or feature's project, else the first project. Pressed on the project page, it switches the board between Features and Sessions.
10. When nothing is focused, the content area shows the last project page, else the first project's. The focused project is a third exclusive focus next to the focused session and focused feature, persisted.
11. Clicking anything in the sidebar always changes the content area.
12. Document it for later features: an ADR for the navigation and UI-state change, and `CONTEXT.md` updated (Board, Project page, Projects tab, Group feature wording).
13. Standalone feature, not a child of the epic.
