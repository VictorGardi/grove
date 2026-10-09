---
feature: 2026-10-09-session-workflow-status
phase: implementation
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on:
  - 05-plan.md@2
forced:
  - "Human explicitly requested skipping Grove approval gates and proceeding with implementation (2026-10-09); no artifact is self-approved by an agent."
---

# Implementation: session workflow statuses

## Slice 1 — Persist and edit workflow status

Committed as `5bafb87`.

### Re-planned before execution

The plan written ahead of time assumed a *new* marker control beside the
card's existing `icon` slot. In review the human corrected one-way decision 3:
the marker replaces the `icon` slot. Three follow-ups settled placement:

- The marker applies to **every session kind**, agent and terminal alike, not
  only agents.
- The **Sessions Board** card takes the same `icon` slot, so board cards look
  like sidebar cards.
- **No kind glyph** moves to the top-right. An earlier proposal to put it there
  was dropped as unnecessary; that also removed a collision with `ListRow`'s
  hover `actions` slot, which is absolutely positioned at the same corner.

`03-design.md` is v2 and `04-structure.md` v2 accordingly; the slice section in
`05-plan.md` was rewritten against them.

### Post-slice correction — the rail

The first pass also put the marker in the collapsed rail's top-left corner.
Seeing it running, the human found the 36px tile was carrying too much and
asked for the marker to come out. Commit `4bbd5d9` reverts
`SidebarRail.tsx` and its stylesheet to their pre-feature state; the rail is
untouched by this feature. `03-design.md` is now v3 and `04-structure.md` v3.

One confusion worth recording: the instruction "remove the icon from the
sidebar rail cards" was first read as *remove the kind glyph*. It meant the
marker just added. The kind glyph is what the rail had all along and stays.

### Deviations from the plan

- **`WorkflowStatusButton` takes a session, not `(status, onPick)`.** The plan
  specified an `onPick` callback; the component instead invokes
  `session:workflowStatus` itself, so the three call sites stay one line each.
  No behaviour change — the invoke still goes renderer → IPC → core.
- **`ListRow` was not touched.** The plan had a step for it; passing the button
  in through the existing `icon` prop needed no change to the component.
- **Menu positioning uses CSS variables set on the node**, matching
  `ContextMenu`, rather than a React state object. A `style={{ left, top }}`
  prop would have failed `noInlineStyles.test.ts`.
- **`SidebarRail` marker wraps the button in a `.statusCorner` span** that
  stops click propagation, so focusing a tile by clicking its corner does not
  also open the picker. The tile is a `<button>`, so a nested button is not
  valid; the span is the click shield.
- **Terminal card tone** now keys off `s.kind === 'terminal'` directly, since
  the local `agent` flag only existed to choose the old icon.
- **`SidebarRail` is not modified at all.** It was in the plan's file list and
  was changed in the first pass, then reverted in `4bbd5d9`.

### Verification

- `npm run typecheck` — clean.
- `npm test` — 647 passing, 1 failing: `noInlineStyles.test.ts` on
  `Sidebar.tsx:326`, the project-visibility popover added by commit `e1be2bc`.
  **Pre-existing on `master`**, confirmed by stashing this slice and re-running.
  Not fixed here; it belongs to the visibility feature.

### Known consequences of the design decision

- Agent cards no longer show live status at a glance in the icon. It is on the
  bottom status line and the alert badge.
- The `iconGone` dimming has no replacement, so a gone session looks like a
  live one apart from its status line.
- Terminal and kind glyphs are gone from sidebar and board card icons. The
  rail tile keeps its centred kind glyph and is otherwise unchanged.

## PR description

Sessions carry a manual workflow status, chosen by clicking the circle at the
top-left of their card.

**Design.** Seven labels — Backlog, In Progress, Blocked, In Review, Cancelled,
Done, Pinned — matching Xirp's picker, with a glyph and tone per value. The
marker replaces the icon slot the card already had rather than adding a
control beside it: on agent cards that slot held the yellow half-circle /
blue check live-status ring, on terminals the terminal glyph, and on Sessions
Board cards the opencode/claude/terminal mark. A separate marker was rejected
as a duplicate that widens every card. The status is a required
`Session.workflowStatus`, defaulting to `in-progress`, with state schema 7 → 8
and a migration for existing files. Changing it is a label write over the
existing renderer → IPC → core path: no archive, no cleanup, no lifecycle
effect. It is deliberately independent of live agent status.

**Slice 1 — Persist and edit workflow status.** The field, the migration, the
`session:workflowStatus` command, the shared picker, and wiring into the
sidebar and Sessions Board cards. Commits `5bafb87` and `4bbd5d9`.

**Verify by hand.** `npm run dev`. Click the circle on a sidebar card and on a
board card; pick Pinned on one, Blocked on the other, and pick Pinned on a
terminal session too. Restart Grove and confirm all three kept their status.
Confirm the grid `plus`/`check` still toggles membership, the bottom status
line still reports running/waiting/gone, the alert badge still appears, and the
collapsed rail tile is untouched.

**Known pre-existing failure.** `npm test` has one failure,
`noInlineStyles.test.ts` on `Sidebar.tsx:326` (the project-visibility popover
from `e1be2bc`). It fails on `master` and is unrelated to this feature.