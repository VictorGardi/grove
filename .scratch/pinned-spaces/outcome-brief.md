# Outcome brief: pinned spaces

Status: confirmed by user (phase 1); amended in phase 3: the window-level pin indicator is dropped for now.

You can pin a space, a worktree space included, so that after a weekend you can see at a glance where you were going and get back in one step. Pinned spaces show in a Pinned group at the top of the sidebar, with the same rows as the tree below (state, name, open counts, time) plus the repo name; a pinned space also stays in its place in the tree, and Go to lists pinned spaces first within each group (a space that needs you is never buried below a pin). Opening a pinned space works as opening any space does: the tab that needs you, else the one you last used. Whether a space is pinned shows in the sidebar only (and as a mark in Go to). A keyboard shortcut pins or unpins the space you are in. Pins have no limit, carry no notes and never expire; they are saved, so they survive quitting Grove and restarting the Mac, and every window shows the same pins. If a pinned space is closed or its worktree removed, its pin goes with it. Tabs cannot be pinned (a possible later addition: pinning a tab in the tab strip). Done means: pin a space, quit Grove, come back after a restart, and the Pinned group is still there with each space one click from its tab.

## Non-goals
- A pin indicator in the tab strip, pane header or title bar (dropped by the user for now);
- Pinning tabs; notes or reminders on pins; expiry; a separate "last session" restore; a cap on pins.
