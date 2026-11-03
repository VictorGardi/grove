---
feature: 2026-11-03-simplify-sessions-and-sidebar
phase: outcome
status: approved
version: 2
created: 2026-11-03
updated: 2026-11-03
approved_at: 2026-11-03
based_on: []
forced: []
---

# Outcome

## Summary

Grove's app gets simpler and calmer. Three concepts leave the app: zones, boards and the epic concept. The 60-second child-prompt hold goes too, along with `grove escalate`. The sidebar becomes one fixed layout: Project, then root sessions. Child sessions are hidden behind their parent. A child that needs you shows as a badge on the parent plus one temporary "via parent" row. Features and their artifacts are reached through sessions and cmd+K. The project page becomes minimal. The relation between sessions gets an explicit kind, so "parent" no longer means several different things. Before the hide-children UI is built, the human sees 3-5 mockup concepts in Claude artifacts, and the run pauses for their pick.

**Defaults the human should check at play-back (decided by the interviewer, not asked):**
- Existing saved sessions, parent links and layout settings keep working after upgrade. Nothing is migrated or deleted destructively.
- Leftover settings for removed features (sidebarView, board, artifacts, zoneOverride and similar) are ignored and left in place.
- Existing children simply become hidden under their parent. Existing ad-hoc children are treated as group members, and the human can promote any of them back to a normal sidebar row.
- Feature folders and their docs on disk are untouched. Only the app's board and epic views go away.
- The `grove` CLI and skills keep working. Only the escalate path, the text that describes the hold, and the epic rules (in the skill references, `AGENTS.md` and the config limits) are removed.
- Everything done today without zones, boards or epics keeps working: starting, resuming, answering and killing sessions, worktrees, and agent profiles.

## What the human sees and does

- **Removed:** zones, boards (the features board, sessions board and artifacts board), and the epic concept in the app. The child-prompt hold is also removed: a child's permission request or question reaches the human at once instead of waiting 60 seconds (`escalateAfterSec`) for its parent. That takes out `grove escalate` and the grove-run and grove skill text that describes it.
- **Sidebar layout (option A):** one fixed layout, Project then root sessions. There is no "Group by" and no Workflow-status grouping. There is one sort control, and keyboard shortcuts follow the visible list.
- **Slice progress on the parent row:** an auto-run parent shows a per-slice progress bar (for example 3 of 5) on its own row. There are no child session cards.
- **Child needs you:** the parent shows a badge. One "via parent" row for the waiting child appears only while it needs you. One click answers it, and the row disappears once handled. The child is never duplicated under an expander.
- **Peek plus promote:** from the parent, a quick overlay lists its children with live screen and status. Each child has a "promote" action that turns it into a normal visible session in the sidebar. Hiding stays the default.
- **Features and artifacts:** open them from a linked session, or find any feature or artifact by name in cmd+K. There is no board or list page.
- **Project page, and a worktree's project page:** a minimal page with a project header, a "new session" action and a cmd+K hint. The sidebar handles everything else.
- **Explicit relation kind:** a session's link to another session is one of three kinds: ad-hoc group member, auto-run slice, or agent subagent. Epic and worktree nesting stop reusing the word "parent".
- **Mockup round:** before the hide-children UI is built, the run produces 3-5 full concepts for all five pieces in Claude artifacts: badge, via-parent row, peek overlay, promote, and slice progress bar. The run then pauses for the human's pick.

## Non-goals

- Not chosen: the decision queue (E), chief of staff (F), goal cards, gates and quiet hours (the rest of G).
- No "needs you" inbox, feature list or board replacement.
- No per-parent expander, and no duplicate of a child under its parent.
- No Group by, and no Workflow-status view.
- No destructive migration of saved sessions or settings.
- No change to the on-disk feature folders, the grove workflow phases or the auto-run flow itself. Only the app's views, the epic rules and the child-prompt hold go.
- No new alert channels beyond the badge, the via-parent row and the existing popup.

## How I'll know it works

- Zones, boards and epics no longer appear anywhere in the app, in `AGENTS.md`, in the config limits or in the skill references of this repo, and nothing in the app mentions `grove escalate`.
- A child's permission request or question reaches me immediately, with no 60-second wait.
- The sidebar shows Project then roots only. There is no Group by, and exactly one sort control.
- When a hidden child needs me, its parent shows a badge and one "via parent" row appears. One click answers it, the row disappears once handled, and the child is not shown twice.
- A child that is not waiting stays hidden. Peek shows its live screen and status, and promote turns it into a normal sidebar session.
- An auto-run parent shows slice progress (for example 3 of 5) on its own row, with no child cards.
- cmd+K finds any feature or artifact by name, and I can reach them from a linked session. No board or list page exists.
- Clicking a project, or a worktree's project, shows only the minimal page: header, new session and a cmd+K hint.
- After upgrading, my existing sessions, parent links and settings still work. Old children are hidden and promotable, and nothing was deleted.
- The run stopped and showed me 3-5 mockup concepts for the hide-children pieces, and waited for my pick before building them.
- A session's link to another session is clearly one of: group member, auto-run slice or subagent.

## Interview log

**Q1.** After the boards are removed, how should you reach features and their artifacts? Options: A only through sessions; B sessions plus search in cmd+K, no board or list page (recommended); C plain feature list on the project page; D drop it, read outside the app.
**A1.** B: Sessions plus search. Open a feature or its artifacts from a linked session, or find any feature or artifact by name in cmd+K. No board or list page.

**Q2.** When a hidden child needs you, how should the sidebar tell you and how do you get to it? Options: A badge on the parent only; B badge plus one "via parent" row for the waiting child while it needs you (recommended); C popup only; D like B but sticky until dismissed.
**A2.** B: Badge on the parent plus one "via parent" row for the waiting child, shown only while it needs you. One click answers it; the row disappears once handled; the child is never duplicated under an expander.

**Q3.** How do you look at, or take over, a hidden child that is not waiting on you? Options: A peek only; B peek plus promote (recommended); C per-parent expander; D promote only.
**A3.** B: Peek plus promote. From the parent, a quick overlay lists its children with live screen and status; each child has a "promote" action that makes it a normal visible session in the sidebar. Hiding stays the default.

**Scope addition (human, unprompted, after Q3).** Remove the child-prompt hold: a child's permission or question no longer waits 60 seconds (`escalateAfterSec`) for its parent to answer before it reaches the human. Dependent pieces seen in research: `held`, `handled[]`, `startHold`/`settleHold`, `holdSent`, the `grove escalate` path and the grove-run / grove skill text that describes it. Consequence for the mockups: concept F (chief of staff) rested on that grace window.

**Q4.** Once zones and boards are gone, how should the sidebar be arranged and ordered? Options: A one fixed layout (Project then roots, no Group by); B Project then roots plus a flat toggle, Workflow status retired (recommended); C keep Group by, remove zones only; D Project then roots with needs-you floating to the top.
**A4.** The human asked for mockups of A-D plus 3 more options (shown in the Claude artifact https://claude.ai/artifact/UcFupPt91emTJmQqYax1Lh), then picked: A, one fixed layout (Project, then root sessions, no Group by, one sort control, shortcuts follow the list), "i think we need to simplify". From G they want the slice display kept: no child session cards, but the parent row shows how many slices are done (a per-slice progress bar, e.g. 3 of 5). Layers E (decision queue), F (chief of staff) and the rest of G (goal cards, gates, quiet hours) are not chosen. F is also out because the hold it relied on is being removed.

**Q5.** Do you still want a mockup round for the hide-children pieces (badge, via-parent row, peek overlay, promote, slice progress bar) before they are built, with the run waiting for your pick? Options: A no more mockups; B one page for peek and via-parent row only (recommended); C full 3-5 concepts for all five pieces; D build first, adjust at slice 1.
**A5.** C: Full 3-5 concepts for all five pieces, shown in Claude artifacts, with the run waiting for the human's pick before the hide-children UI is built.

**Q6.** What should you see when you click a project (or a worktree's project page) once the boards are gone? Options: 1 the sidebar tree in the main area (recommended; the relay's draft also listed features as roots, which conflicts with A1, so features stay reachable only through sessions and cmd+K); 2 a "needs you" inbox first; 3 a minimal page; 4 the last session open in that project.
**A6.** 3: Minimal page. A project header, a "new session" action and a cmd+K hint; the sidebar is used for everything else. Worktree project pages get the same minimal page.

## Open questions
