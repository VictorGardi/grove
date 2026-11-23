Status: ready-for-human

# Pinned spaces

Decisions behind this spec: `outcome-brief.md`, `decision-log.md`, `research-*.md` and `round-1-respondent.md` in this folder, ADR 0007 (`docs/adr/0007-pins-are-saved-with-the-space.md`) and ADR 0005 (the heading). Mockups of the chosen option (A, spaces only): https://claude.ai/artifact/2VDzKEe7Snb3o5ujVyoAeq. Glossary terms used: **Space**, **Worktree space**, **Pin**, **Pinned group**, **Heading**, **Most urgent state**, **Active space**, **Quiet space**, **Go to**, **Recent order**, **Tab**, **Core**.

## Problem Statement

When I come back to Grove after a weekend, I have to work out again where I was going. The sidebar lists every space, and the ones I care about are mixed in with the ones I opened once. Nothing lets me say "this is where I am going back to", so I scan the tree, guess, and open the wrong space first.

## Solution

I can **pin** a space, a worktree space included. Pinned spaces appear in a **Pinned group** at the top of the sidebar, in the order I pinned them, drawn as the same rows as the tree below (state node, name, what is open, time) with the repo's name added. A pinned space also stays in its own place in the tree. Go to lists pinned spaces first within each group and marks them. A shortcut, and a Pin or Unpin item in the space's right-click menu, pin and unpin a space. Pins are saved with the space, so they survive quitting Grove and restarting the Mac, and end when the space is closed. Only spaces are pinned, never tabs.

## User Stories

1. As a person returning after a weekend, I want a Pinned group at the top of the sidebar, so that I see where I was going without scanning the tree.
2. As a person returning after a weekend, I want to click a pinned space and land on its tab that needs me, or else the tab I last used, so that one click puts me back where I was.
3. As a person with several repos, I want to pin a space in any repo, so that the places I return to sit together.
4. As a person who works in worktrees, I want to pin a worktree space like any other space, so that a branch I am working on stays one click away.
5. As a person pinning a space, I want to do it with a keyboard shortcut while I am in it, so that I do not leave the keyboard.
6. As a person pinning a space, I want Pin and Unpin in the space's right-click menu, so that I can pin a space I am not in.
7. As a person who rebinds keys, I want the pin shortcut in the Keys panel with its default shown, so that I can change it like the others and see what it is.
8. As a person pinning a space, I want the shortcut to clash with nothing Grove already binds, so that it never fires something else (the default is Cmd+Shift+P; Cmd+Shift+D is taken by Changes).
9. As a person scanning the Pinned group, I want each row to look like its row in the tree, with the repo's name added, so that I read it the same way and can tell same-named worktrees apart.
10. As a person scanning the Pinned group, I want each row to show the space's state, what is open and the time, so that I see which pinned space needs me.
11. As a person with a pinned space, I want it to keep its row under its repo's heading, so that the tree is still complete and I find it in both places.
12. As a person with the Pinned group, I want the active space highlighted in both places it appears, so that I always see where I am.
13. As a person who uses Cmd+1 to Cmd+9, I want those places to count only the tree rows, so that pinning a space never changes which space a number opens.
14. As a person who pins in an order that means something, I want the Pinned group to list spaces in the order I pinned them, newest at the bottom, so that the list stays where I left it.
15. As a person who unpins and pins again, I want the space to go to the bottom, so that the order follows my last decision.
16. As a person who has pinned nothing, I want no Pinned group drawn at all, so that the sidebar looks as it does today.
17. As a person with many pins, I want no limit, so that I am never told to unpin something.
18. As a person who wants a quiet sidebar, I want the Pinned group to have no fold, so that my pins are always visible.
19. As a person with a pinned space under a folded heading, I want clicking its Pinned row to open that heading, so that the space I jumped to is visible in the tree.
20. As a person with quiet spaces folded away, I want a pinned space always shown in the Pinned group, so that a pin is never hidden.
21. As a person with quiet spaces folded away, I want the tree copy of a pinned space to follow the normal quiet rule, so that the tree is as calm as before.
22. As a person opening Go to with no search words, I want pinned spaces first within each group, so that my pinned spaces lead.
23. As a person who is waiting on an agent, I want a space that needs me to stay first in Go to even if it is not pinned, so that a pin never buries it.
24. As a person scanning Go to, I want a pin mark on a pinned space, so that I recognise it.
25. As a person searching in Go to, I want the ranking unchanged and only a pin mark added, so that a pinned space never outranks a better match.
26. As a person in Go to, I want a pinned space listed once, not twice, so that the list stays short and Enter goes to the one I highlighted.
27. As a person in Go to, I want no way to pin there, so that Go to keeps only navigating.
28. As a person who quits Grove, I want my pins to survive quitting and a restart of the Mac, so that they are still there on Monday.
29. As a person who closes a space, I want its pin to end with it, so that no pin points at nothing.
30. As a person who closes a space and adds the same folder again, I want a new, unpinned space, so that a pin never comes back by surprise.
31. As a person who deleted a pinned worktree's folder outside Grove, I want the space to stay pinned until I close it in Grove, so that where I was is not silently erased.
32. As a person with two spaces on the same folder, I want each pinned on its own, so that pinning one does not pin the other.
33. As a person who runs the `grove` command, I want pins to be the same as in the window, so that every client agrees.
34. As a person whose saved state cannot be written, I want a pin that fails to tell me so, so that I do not believe a pin is saved when it is not.
35. As a person who hides the sidebar, I want the shortcut to still toggle the pin, so that it works with the sidebar closed (it gives no visible feedback until the sidebar is shown, by my own choice).
36. As a person who unpins a space, I want it to leave the Pinned group at once and stay in the tree, so that unpinning loses nothing else.
37. As a person using the demo window, I want the Pinned group to follow the same rules with its sample spaces, so that the demo shows the feature.
38. As a person who reads the glossary, I want Pin and Pinned group defined, with the Pinned group stated not to be a heading, so that the words stay clear.

## Implementation Decisions

- **Where pins live (ADR 0007).** A pin is saved on the space's own record in Grove's saved state, with the time it was pinned. The core owns it; the window and the CLI read it from the space. Closing a space drops the record and so the pin. No separate list and no per-window setting. Adding the pin to the saved record needs no version bump of the saved state; a record without it is unpinned.
- **What clients are told.** A space as clients see it carries whether it is pinned and when. A change goes out through the existing "space changed" broadcast, so every client agrees without a new notice. Anything that compares whole space objects (tests, the CLI) must tolerate the new field.
- **Pin and unpin.** A request toggles a space's pin by space id. Unpinning clears it. Pinning an already pinned space does nothing, so the order is not reshuffled. If the saved state cannot be written, the request fails and the window shows the error the way other failed requests show it.
- **Order.** The Pinned group lists pinned spaces by pin time, oldest first. The order is the same for every client, so it never uses Recent order (which is per window and not saved).
- **Pinned group in the sidebar.** A grouping at the top of the sidebar with its own label, drawn only while at least one space is pinned. It is not a heading: it must not use the heading's structure, since the existing heading tests assert that the list of headings is exactly the repos. It has no fold and no stored preference. Its rows are the same row as the tree's, with the repo's name added after the space's name, and a pin shown on hover and on a pinned row to unpin.
- **Tree.** Each pinned space keeps its row under its heading. The Pinned group is not a place in the Cmd+1 to Cmd+9 order; those places count only tree rows, in the order they are drawn today.
- **Active space.** Both copies of the active space are highlighted; only the tree copy carries the "current" marker for assistive technology, so there is one.
- **Opening.** A Pinned row opens its space as any row does (the tab that needs you or has finished, else the last visited). If the space's heading is folded, opening it from the Pinned group unfolds the heading, as opening a space in a folded heading already does.
- **Quiet spaces.** The shared quiet rule is unchanged. A pinned space is exempted outside it: never folded in the Pinned group and never behind Go to's quiet count. Its tree copy still follows the rule, so the "N quiet spaces" count can include a space shown in the Pinned group, and counts spaces, not rows.
- **Go to.** With no search words, inside each group (needs-you, finished, active space, working, rest) pinned spaces come first, in Pinned-group order, then the others in the existing order. Needs-you stays above all lower groups, so a pin never buries a space that needs you. A pinned space is listed once. A pin mark is shown on its row. With search words, ranking is unchanged and the mark is shown. Go to never pins or unpins.
- **Shortcut.** A new key action toggles the pin of the active space. The default is Cmd+Shift+P. It is a named, described action like the others: it shows in the Keys panel, can be rebound in the keys file, is validated against duplicates, and shows in the README's list of keys. With no active space it does nothing.
- **Context menu.** A space row's right-click menu gets Pin or Unpin (by state). A heading's menu does not, since a heading is not a space. The demo window installs no menu, as today.
- **Vanishing.** A pin ends only when its space is closed in Grove. A worktree folder deleted outside Grove leaves the space (as a plain row) and its pin in place.
- **Glossary.** Pin and Pinned group are already added to the glossary. The Go to entry's "only navigates" and Recent order's "Go to lists in the window's order" lines need a short note that pinned spaces lead within each group.
- **No window-level indicator.** Whether the active space is pinned shows in the sidebar only (and as a mark in Go to). Nothing is added to the tab strip, pane header or title bar.

## Testing Decisions

- A good test checks what the human sees or the saved result, never how it is built: rows drawn, their order, what a click or key opens, what a restart restores. It does not assert internal state, field names or call counts.
- **Seam 1: the whole-window test** (the existing test that drives the window against a mocked Grove bridge). It checks: the Pinned group appears and disappears with the first and last pin; its rows and the repo name; order by pin time; the tree copy remains; the active space highlighted in both; Cmd+1 to Cmd+9 unchanged by pinning; clicking a Pinned row opens the right tab and unfolds a folded heading; pinned spaces never fold into the quiet count; Go to with and without search words (pinned first within a group, needs-you never buried, a pin mark, listed once, no pin action); the shortcut toggles the pin and does nothing with no active space; Pin or Unpin in the space menu and none on a heading; a failed pin shows the error; and the Pinned group contains no heading markup, so the heading tests keep passing.
- **Seam 2: the core's spaces test** (the existing core tests for spaces and their saved state, including its restart-style reload tests). It checks: a pin is saved with the space and is still there after the state is loaded again; the order survives; closing the space ends the pin; a space added again is unpinned; two spaces on one folder pin separately; a record without a pin loads unpinned; pinning twice keeps the first pin time; and a refused state file fails the pin.
- Prior art: the whole-window test's heading, fold, quiet and Go to cases; the core tests for spaces, writes and saved state; the existing key-action tests for the Keys panel and the keys file.
- Pure rules (the Go to order and the Pinned group's listing) may also get small unit tests beside their existing ones, but through the same behaviour, not new seams.
- `npm test` and `npm run typecheck` pass; the test that forbids literal colours and sizes outside tokens keeps passing, so any new colour or size is a token.

## Out of Scope

- Pinning tabs, or any pin indicator in the tab strip, pane header or title bar.
- Notes or reminders on a pin, expiry, a cap on pins, reordering pins by hand, folding the Pinned group.
- A separate "restore my last session" feature.
- Pinning from Go to.
- Keeping a pin when a space is closed and added again.
- Several windows (Grove has one today); the design only keeps pins the same for every client.

## Further Notes

- Mockups of option A, with the sidebar as it is today, are linked at the top.
- The sidebar branch graph's issue files still say `ready-for-agent` though that work has shipped; the glossary edits here should be done with or after its docs cleanup so they do not collide.
- Terminals in a pane can hold keys of their own: Cmd+Shift+P is unbound by Grove, and Cmd+letter does not normally reach a terminal program on macOS, but this is not verified for the agents Grove runs, so check Claude, OpenCode and Copilot do not use it.
- If the human later wants tab pins, the mockup's option C (tabs pinned in the tab strip) can be added without undoing this.
