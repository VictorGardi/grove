# 0018. A project page replaces the global Board mode

Date: 2026-10-06

## Status

Accepted

## Context

`UiState.view` (`list | board`) is a global mode. With `view: 'board'` the
content area shows the Board whatever is focused. So clicking a session or
feature in the sidebar changes the focus behind the board and shows nothing.
Opening a board card switches to `list`, and nothing records the way back.
The board also has no shortcut. The sidebar's Features tab and the Board are
two layouts of the same collection, and a mode on top of an always-visible
sidebar keeps the two out of sync. The epic design's two-way row "Per-viewer
UI state" (`2026-10-05-opencode-feature-workspace/03-design.md`, v6) lists
the List/Board toggle and the Sessions/Features tab. This ADR supersedes that
part of the row. Feature `2026-10-06-project-page`.

## Decision

The board is a place, not a mode. The **project page** is the content area
for one project. Its header holds the project name and a Features | Sessions
switch. Its body is a board of either features (one column per workflow
stage) or sessions (Waiting | Working | Idle | Ended). The switch is one
persisted UI-state choice.

UI state has three mutually exclusive focuses: a session, a feature, or a
project (the project page). `view` is removed. When nothing else is focused,
the last focused project is shown, else the first project. Every sidebar
click changes the content area.

The sidebar tabs are **Sessions | Projects**. The Features tab is removed.
Features are reached from the project board, from breadcrumbs, and through
parent/child links. A card's parent tag opens the parent's feature page, a
group feature's page lists its children, and a child's page links to its
parent. These use only `group` and `parent` from `workflow.yaml` (ADR 0002).
The app never names grove's epic kind.

Going back is by clickable breadcrumb up-links (project › parent › feature;
project › linked feature › session). There is no history stack. ⌘B opens the
project page of the current context, and on the project page it switches the
board between Features and Sessions.

## Consequences

- Fixes the hidden-click bug by construction: no mode can hide the focused
  thing.
- Later features that add navigation (child 7's ⌘K palette and grid) target
  three focus kinds (session, feature, project) and should offer projects as
  palette entries. A grid layout is a fourth content kind, not a mode over the
  others.
- Persisted `ui` changes shape (`view` dropped; a focused project and a board
  switch added). Old state files must read cleanly (ADR 0009, ADR 0017).
- Without the sidebar feature tree, a feature is two clicks away (project,
  then card) unless a session links to it. ⌘K (child 7) is the planned
  shortcut.
- "Back" means "up". After jumping from a board to a session, the
  breadcrumb's project segment returns to the board, not to scroll position.
- Rejected: keeping the mode and making sidebar clicks switch to list (the
  sidebar and the board still fight); a ⌘B overlay board with a project filter
  (chosen first, then replaced by the Xirp project-page shape: an overlay is
  never a place you can stay on as a dashboard); removing the board (loses
  the at-a-glance stage view); a history stack with ⌘[ / ⌘] (more state than
  up-links need); keeping the Features tab next to a Projects tab (three
  overlapping ways to browse); epic cards or swimlanes on the board.
