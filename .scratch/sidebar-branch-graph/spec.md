Status: shipped
Shipped as specified. Follow-up: Go to now draws the same tree instead of letter tiles.

# Sidebar as a branch graph

Decisions behind this spec: `outcome-brief.md`, `decision-log.md`, `research-*.md` in this folder, and ADR 0005 (`docs/adr/0005-sidebar-groups-a-repo-under-a-heading.md`). Glossary terms used: **Space**, **Worktree space**, **Heading**, **Most urgent state**, **Tab**, **Tab state**, **Tab name**, **Quiet space**, **Go to**, **Exited tab**, **Active space**.

## Problem Statement

The sidebar tells me which folders I have, but not where my work is. A coloured letter tile says nothing about a space, a worktree looks like any other row with a small icon, and the agents are a second list I have to read against the first. When several worktrees of one repo each run agents, I cannot see at a glance which worktree is working, which has finished and is waiting for me, and which needs me. I also have to read two lists to match a worktree to its agents.

## Solution

The sidebar draws each repo with worktrees as a trunk with its worktrees branching off it. A **heading** names the repo, and its spaces (the main checkout and each worktree space) are rows on branches off it. A space with no worktrees stays one plain row until it has tabs. Each row has a node showing its state, and two lines:

- Line 1: the name, and on the right the time since the shown state began. The line is blue while something is working.
- Line 2: what is open, right-aligned, as the agent icon with the number of live agents and then the terminal icon (`>_`) with the number of live terminals, each only when its count is above zero. No tab name is shown.

The node reuses the status looks Grove already has, with the same colours and the same Waiting and Running colour and indicator settings: hollow for idle, dashed for no tabs open (and for no status), a halo for needs-you, solid for finished, and the chosen waveform or three dots for working. A row shows its **most urgent state**. The list of per-agent rows is gone, so the agent type of each tab shows only in the tab bar.

## User Stories

1. As a person running agents in several worktrees, I want each repo drawn as a heading with its worktrees branching off it, so that I see which worktrees belong together.
2. As a person with a repo that has worktrees, I want its main checkout shown as one of the rows under the heading, so that it is a space like the others and not a special parent.
3. As a person with a plain folder that has no worktrees, I want it to stay a single row with no heading, so that the sidebar does not add structure where there is none.
4. As a person scanning the sidebar, I want a node on each row that shows its state, so that I see what is happening without reading.
5. As a person scanning the sidebar, I want a row where an agent is working to show the working indicator I chose (waveform or three dots) in my Running colour, so that the sidebar matches the tab bar.
6. As a person waiting for an agent, I want a row whose agent needs me (permission, question, sign-in or error) to show the needs-you look in my Waiting colour, so that I notice it first.
7. As a person who stepped away, I want a row with a finished agent to show the finished look, so that I know there is something to review.
8. As a person who opens the finished tab, I want the row to return to idle, so that finished means "not yet looked at".
9. As a person, I want a row with no tabs to show a dashed node and "No tabs open", so that I can tell an empty worktree from a resting one.
10. As a person with an agent that reports no status, I want the dashed node with the agent counted on line 2, so that I can tell it from an empty worktree.
11. As a person, I want a row with only idle tabs to show a hollow node, so that resting work looks resting.
12. As a person with several tabs in one worktree in different states, I want the row to show the most urgent state in the order needs-you, finished, working, unknown, idle, so that nothing that needs me is hidden by something that does not.
13. As a person, I want line 2 to show no tab name, only what is open, so that the row stays short and the node and time carry the story.
14. As a person with two tabs tied on state, I want the most recently active one to decide the row's time and what a click opens, so that it is the tab I most likely mean.
15. As a person, I want line 1 to be blue while anything in that row is working, so that activity stands out beside the node.
16. As a person, I want line 1's time to say how long the shown state has lasted (or, when idle, how long it has been idle), so that I know how stale a finished or idle worktree is.
17. As a person, I want no "Ready" word on a finished row, so that the node alone says finished and the row stays calm.
18. As a person, I want the time to keep counting without me touching anything, so that I do not read a stale age.
19. As a person with a worktree that has only terminals, I want the row to show no time rather than a made-up one, so that the sidebar never guesses.
20. As a person, I want line 2 to count open tabs by type as icons with numbers (the agent icon and 4, then `>_` and 1), so that I know what is open without opening the worktree.
21. As a person, I want tabs whose process has exited left out of those counts, so that the counts say what is alive.
22. As a person, I want the agent type (Claude, Copilot, OpenCode) to show in the tab bar and not in the sidebar, so that the sidebar answers where and the tab bar answers what.
23. As a person, I want the main checkout's row named by my rename if I gave one, else by its branch, else by its folder when the checkout is detached, so that the row says which checkout it is.
24. As a person, I want a worktree row named by its space name (my rename, or its folder), so that renaming keeps working.
25. As a person, I want a plain space with no tabs to show its name and branch on one line, so that I still see which branch a folder is on.
26. As a person who opens the first tab in a plain space, I want that row to become the same two-line row as a worktree, with the time replacing the branch, so that every space with work in it reads the same way.
27. As a person, I want clicking a row to select that space and open the deciding tab when it needs me or has finished, so that I land on what the row told me about.
28. As a person, I want clicking a row whose tabs are only working or idle to open the tab I visited last in that space, so that I return to where I was.
29. As a person, I want clicking a heading to only fold or unfold it, so that I never switch spaces by accident.
30. As a person with a crowded sidebar, I want to fold a heading, so that I can tidy a repo I am not working in.
31. As a person with a folded heading, I want the heading to show the most urgent state among its rows, so that folding never hides that something needs me or is working.
32. As a person with an unfolded heading, I want the heading to show no state of its own, so that I do not count one state twice.
33. As a person, I want my folds remembered for each repo across restarts, with every heading open at first, so that my tidy-up lasts.
34. As a person, I want a folded heading that holds the active space to stay open while that space is active, so that I never lose sight of where I am.
35. As a person, I want leaving that space to bring my saved fold back, so that being shown does not overwrite my choice.
36. As a person who jumps to a tab inside a folded heading (Go to, a shortcut, the jump to urgent), I want the heading to open, so that I see the row I landed on.
37. As a person, I want a folded repo that no longer exists to stop being remembered, so that old choices do not pile up.
38. As a person with a worktree whose main checkout is not a space, I want it to sit under a heading named after the repo with only worktree rows, so that it still reads as part of its repo.
39. As a person who later adds that main checkout as a space, I want its row to appear in that same heading, with my fold kept, so that nothing jumps or resets.
40. As a person who removes the main checkout space, I want its worktrees to stay under the repo's heading, so that they do not scatter.
41. As a person with two spaces on one folder, I want the second to stay a separate row, so that nothing is merged behind my back.
42. As a person, I want the Quiet-spaces fold ("N quiet spaces ▾", "Hide quiet spaces ▴" while open) to apply to the sidebar's spaces, so that the many spaces I am not using stay out of the way.
43. As a person, I want a heading to leave the list only when all its spaces are quiet, and never while its space is active, so that the group around my work stays whole.
44. As a person, I want the quiet count to count spaces and not headings, so that "N quiet spaces" says what it says.
45. As a person who opens the quiet fold, I want spaces in their usual sidebar order, so that nothing is reordered.
46. As a person, I want Go to to list quiet spaces exactly as it did, so that searching is unchanged.
47. As a person who presses Cmd+digit, I want the numbers to count every row, including rows inside folded headings, so that a shortcut always means the same space.
48. As a person, I want to right-click a heading to create or open a worktree of that repo, so that those actions have a home even when there is no main checkout row.
49. As a person, I want the right-click menu on a row to keep its space actions (rename, close and the rest), so that nothing I used is lost.
50. As a person with an exited agent that can be resumed, I want a Resume action in that tab's pane, so that I can still resume now the agent rows are gone.
51. As a person, I want the pane of an exited tab that cannot be resumed to look as it does today, so that I am not offered what will not work.
52. As a person, I want the per-agent list under the spaces gone, so that I read one list and not two.
53. As a person, I want the letter tiles gone, so that the node is the only mark on the row.
54. As a person who turns on reduced motion, I want the sidebar as static as the rest of Grove, so that nothing pulses.
55. As a person who changes the Waiting, Running or indicator setting, I want the sidebar nodes to follow at once, so that settings apply everywhere the same way.
56. As a person with a long repo or tab name, I want it to shorten and not push the time off the row, so that the time is always visible.
57. As a person who hides the sidebar or resizes it, I want the graph to keep its shape, so that it never breaks at a different width.
58. As a person, I want a space whose git state cannot be read to still show as a row (a plain row if it cannot be told to be a worktree), so that a slow or broken repo never empties the sidebar.
59. As a person, I want Go to, the urgent banner and the jump-to-urgent key to keep their behaviour, so that moving around is not part of this change.
60. As a person using the demo states page, I want it to show the new sidebar for every state, so that I can review the look without real agents.

## Implementation Decisions

- The sidebar's spaces list and agents list become one list of rows. Per-agent rows, their group headers and the letter tiles are removed. The sidebar keeps its two-section layout setting only as far as the remaining section needs.
- **Grouping.** A heading is derived from each space's repo and its existing parent link (ADR 0005). A repo gets a heading when it has a worktree space; its main checkout space, when it is a space, is a row like the worktree rows. The heading is keyed by repo, not by the main checkout's space. Spaces with no worktrees have no heading. Grouping is one level, as today. The data the core sends about spaces already carries everything needed (parent, worktree flag, repo name, branch); no new core data is required.
- **Most urgent state.** The shared urgency order becomes needs-you, finished, working, unknown, idle. The only places it was inverted are the sidebar's own roll-up and the agent-row sort (which goes away); Go to, the urgent banner and the jump-to-urgent key already use this order. A row's state is the most urgent state over its live tabs. A folded heading's state is the most urgent over its rows; an unfolded heading shows none.
- **Row summary** is a pure rule computed from a space's tabs: the deciding tab (most urgent, ties to the most recently active), its agent kind for the icon, counts of live agent tabs and live terminal tabs (exited tabs not counted), the time, and whether the space has no tabs. Time is the start of the deciding tab's state; a space whose tabs carry no such time shows none.
- **Node** reuses the existing indicator for each state, including the working mark with the user's waveform or three-dots choice, the Waiting, Running and finished colours, and the reduced-motion behaviour. The same dashed look serves "no tabs" and "no status". The sidebar now shows idle and unknown nodes on rows, which it hid before. Graph geometry (trunk, branches, node placement) is new design tokens; the literals test applies.
- **Time** shows seconds, minutes, hours and days as today, and refreshes on its existing timer for the new rows. A finished row shows its time like any row; there is no "Ready" label.
- **Row naming.** A main checkout row shows the space's rename, else its branch, else its folder name (detached or unknown branch). A worktree row shows the space name. A plain space with no tabs shows its name and branch on one line; once it has tabs it becomes the two-line row with the time in place of the branch.
- **Click behaviour.** Clicking a row selects its space and opens the deciding tab when it needs the human or has finished; otherwise it opens the most recently visited tab of that space (today's behaviour). Clicking a heading only folds or unfolds.
- **Fold.** The heading fold is a new saved preference, one choice per repo, default open, using the same persisted-preference approach as the other sidebar settings, with unknown or invalid data ignored and repos that no longer exist dropped. The active space's heading is forced open while it is active without changing the saved choice. Going to a tab in a folded heading opens it. Cmd+digit numbering and Go to's order keep counting hidden rows.
- **Quiet-spaces fold** now applies to the sidebar's spaces list (it applied only to the agents list). Quietness is still judged per space with the existing definition, widened as in the glossary: the active space and the spaces under its heading are never quiet. A heading leaves the list only when all its spaces are quiet. The count counts spaces. Its open/closed state stays in memory. Go to is unchanged.
- **Heading menu.** The heading has its own context menu with create and open worktree. A row keeps its existing space actions.
- **Resume** moves into the pane of an exited tab whose agent can be resumed, in place of the bare "[process exited]" line for that case. Panes of exited tabs that cannot resume are unchanged.
- **Out of the sidebar by decision:** per-tab age, the agent mark and context ring on rows, the grid icon, and one-click jump to a specific tab. The context ring remains in the pane header and in Go to; the tab bar keeps the agent marks.
- **Glossary and docs.** `GLOSSARY.md` already carries Heading, Most urgent state and the reworded Space and Quiet space. The design notes need rewriting where they describe tiles, agent rows and the sidebar as "spaces and the agents grouped under them"; the window-store spec's mentions of agent rows need a note that they are superseded.

## Testing Decisions

- Good tests check what a person would see or do, not how it is built: rows, nodes, lines, counts, folds, panes and what a click opens. They do not assert on class names or element structure beyond the few landmarks the window test already relies on.
- **Seam 1, the whole-window test** (the existing jsdom test that loads the real window): rows and nodes for each state, the dashed no-tabs and no-status cases, two-line content and counts, the time, no "Ready" text, the heading with and without a main checkout row, fold and unfold, a click on a row and on a heading, the quiet fold on the spaces list, the settings (Waiting, Running, indicator) reaching the nodes, Resume in an exited pane, and that no agent type is named in the sidebar. The existing assertions about agent rows and letter tiles are replaced.
- **Seam 2, the sidebar rules** (the existing pure sidebar-rules tests): the most urgent state order including unknown and idle, the deciding tab and its tie rule, counts excluding exited tabs, the no-time case, grouping under headings (no main checkout, main added or removed later, two spaces on one folder), which headings are quiet, and Cmd+digit numbering over hidden rows. The quiet-space rules keep their own existing test file, extended for the widened definition.
- The saved fold preference is tested the way the other saved preferences are: default, round trip, invalid data ignored, vanished repos dropped.
- The literals test keeps guarding that new styling uses tokens. The demo states page's own test keeps passing with the new rows.
- Prior art: the existing window test, sidebar rules tests, quiet-spaces tests, saved-preference tests and the indicator tests.

## Out of Scope

- Any change to status colours, indicator styles, their settings, or how a tab's state is decided.
- Agent-type marks in the tab bar, Go to's behaviour, and the urgent banner.
- A warning for a background tab's context level in the sidebar.
- A new home for per-tab age or for jumping straight to one tab from the sidebar.
- Nesting deeper than one level, or merging spaces that share a folder.
- Dock panels and the usage panel.

## Further Notes

- ADR 0005 records the heading decision. Everything else here follows the glossary and the decision log.
- The sidebar becomes more informative for idle and unknown rows than it was, since those nodes used to be hidden on space rows; check the look at a narrow sidebar width.
- A repo with a single worktree and no main checkout still gets a heading, for uniformity; revisit if it reads as noise.
- When a space is removed, its worktrees' parent link can stay stale until the next git refresh, so a heading may briefly show the old grouping before it settles.
