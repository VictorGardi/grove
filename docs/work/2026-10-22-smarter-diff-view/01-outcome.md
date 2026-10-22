---
feature: 2026-10-22-smarter-diff-view
phase: outcome
status: approved
version: 1
created: 2026-10-22
updated: 2026-10-22
approved_at: 2026-10-22
based_on: []
forced: []
---

# Outcome: smarter diff view

## Summary

Opening a session's diff shows everything the branch has changed since it split from the main branch, committed and uncommitted together, with nothing to pick. The "compare against" control becomes a short smart list (main branch first, then recently used branches, then a search box) instead of every branch. Three quick views are offered: Branch + uncommitted (default), Uncommitted only, and Last commit. Inline review comments, the file filter and tree, and the split/unified display stay as they are.

## What the human sees and does

- Opening the diff after committing locally shows the branch's committed changes plus any uncommitted work, with no manual choice. The main branch is detected automatically and its name is shown as what the diff is compared against.
- A view switch offers three choices: Branch + uncommitted (default), Uncommitted only (today's behaviour), and Last commit.
- The "compare against" control opens a short list: the auto-detected main branch marked as default, then branches recently picked in this project. Typing in the search box finds any other branch, remote ones included. There is no long alphabetical list.
- A picked compare branch and a chosen view are remembered for that session while it stays open, so reopening the diff does not make the human choose again. A new session starts at the defaults. The recently-picked list is shared across the project.
- Empty states say why nothing is shown, and each offers a quick way to switch view:
  - Branch + uncommitted, no changes: "No changes on this branch compared to <main>."
  - Uncommitted only, no changes: "No uncommitted changes."
  - Last commit on a branch with no commits of its own: "No commits on this branch yet."
- When the session is on the main branch itself there is nothing to compare against: the diff shows only uncommitted changes, with the note "You are on <main>; showing uncommitted changes only." Another branch can still be picked.
- When no main branch can be detected, the human picks a branch through the search, and a short message explains why.

## Non-goals

- No picker for arbitrary commits and no commit-range selection; only the three views above.
- No change to inline review comments, the file filter and tree, or the split/unified display and its expand button.
- No full alphabetical branch list, no pull-request creation and no hosting-service integration.
- No per-file or per-hunk "viewed" state, and no new diff rendering or syntax highlighting.
- No remembering of choices across sessions; only within a session.

## How I'll know it works

- Make a local commit on a feature branch, open the diff, and see that commit's changes at once without choosing a branch.
- Add an uncommitted edit and see it alongside the committed changes; switch to "Uncommitted only" and see just that edit.
- Switch to "Last commit" and see only the most recent commit's changes.
- In a project with many branches, open the "compare against" control and see a short list (main first, then recent picks); type part of a rarely used or remote-only branch name and find it.
- Pick another compare branch, close and reopen the diff in the same session, and see the choice kept; start a new session and see the defaults.
- Open the diff on an unchanged branch and see the specific empty-state message.
- Open the diff while on the main branch and see the uncommitted changes with the explanatory note.
- Inline comments, the file filter and tree, and the split/unified display still work as before.

## Interview log

**Q1. When you open the session diff, what should you see by default?**
Options: Branch + uncommitted (recommended); Branch, committed only; Smart fallback; Keep today's default.
**A1.** Branch + uncommitted: everything since the branch split from the main branch, committed and uncommitted together, main branch detected automatically; an "Uncommitted only" switch keeps the old view.

**Q2. When you click the "compare against" control, what should the list of choices look like?**
Options: Short smart list + search (recommended); Short list only; Full list searchable by recent activity; Keep today's dropdown.
**A2.** Short smart list + search: the auto-detected main branch marked default, then branches picked recently in this project, then a search box that finds any other branch (remote ones too) by typing. No long alphabetical list.

**Q3. Besides "Branch + uncommitted" and "Uncommitted only", do you want other quick views, such as "Last commit" or comparing against one specific commit?**
Options: Add "Last commit" only (recommended); Last commit + commit picker; Keep just the two views; Commit picker without "Last commit".
**A3.** Add "Last commit" only: three views (Branch + uncommitted as default, Uncommitted only, Last commit); no arbitrary commit picker.

## Open questions
