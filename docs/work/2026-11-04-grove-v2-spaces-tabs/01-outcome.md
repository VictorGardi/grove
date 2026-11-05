---
feature: 2026-11-04-grove-v2-spaces-tabs
phase: outcome
status: approved
version: 1
created: 2026-11-04
updated: 2026-11-04
approved_at: 2026-11-05
based_on: []
forced: []
---

# Outcome

## Summary

Rebuild Grove from the ground up as a simpler app built around spaces and tabs, in the style of Herdr. A space is a folder you work in (a repo, a worktree, or anywhere). Tabs inside a space open in that folder. The sidebar shows two lists: your spaces, and your agents with their state. Claude, OpenCode and Copilot all work, the grid mode stays, and status is crisp and reliable.

Version 1 is core only. You can start agents from the app and from a terminal command, see them in the sidebar, get interrupted when they need you or finish, and have them survive app quits and crashes. An agent can change settings, shortcuts, themes, launcher looks and layout from a single sentence, applied live. It runs on both of your Macs, with as few extra installs as possible on the work Mac. It runs beside the old Grove and starts empty, with no migration.

You are interrupted, with a notification and a sound, both when an agent needs you (permission, question, error) and when it finishes, if you are in another window. Accuracy target (a default to check): a state is never wrong for more than a few seconds, and where an agent cannot report a state reliably the app says "unknown" instead of guessing.

After a reboot, spaces and tabs come back, terminals are fresh shells, and agents offer a one-click Resume where the agent supports it.

Defaults the human should check at play-back:
- Spaces are created from the app or by a terminal command run in a directory, and are remembered after restart.
- A tab opens in its space's root directory.
- A worktree is just another space, shown under its repo's space when it belongs to one.
- Remote machines are out of v1.
- macOS only (Windows and Linux out).
- The grid mode is kept.
- Claude, OpenCode and Copilot are all first-class in v1.
- The `grove` command starts and drives sessions from a terminal (list, new, send, read, wait, focus, kill) in v1, because agents and skills use it.
- The look is calm and Herdr-like, with a spaces list and an agents list in the sidebar; agents are grouped by state, each with time since last change.
- The accuracy target above (never stuck wrong, "unknown" when an agent cannot report).

## What the human sees and does

- Open the app. It starts empty. Add a space by picking a folder, or by running a command in a terminal inside a folder.
- The sidebar lists spaces, and the agents below them, grouped by state (for example needs you, working, idle), each showing how long ago its state changed. A worktree space sits under its repo's space.
- Inside a space, open numbered tabs with a "+" button. Each new tab starts in the space's root folder. A tab can be a plain terminal or Claude, OpenCode or Copilot.
- Status for each agent is clear at a glance and matches what the agent is really doing; where it cannot be known, it says so.
- When an agent needs you or finishes while you are in another window, you get a notification and a sound.
- Switch to grid mode to see up to nine live tabs at once, as in today's Grove.
- Quit or kill the app: agents keep running. Reopen and they are all there with correct status.
- After a reboot, spaces and tabs return, terminals are fresh shells, and a one-click Resume is offered for agents that support it.
- From any terminal, use `grove` to list sessions, start a new one, send it text, read its screen, wait for it, focus it, or kill it.
- Tell an agent in one sentence to change a setting, shortcut, theme, launcher look or layout. The change shows up live. If the settings file ends up broken, the app keeps the last good version and shows a clear note.
- The old Grove stays installed and running alongside, untouched.

## Non-goals

- Workflow features and artifacts (stages, feature folders, workflow files).
- Review comments.
- Diff and Changes view.
- Dictation.
- Scratchpad.
- The classifier.
- The auto-flow driving (grove-run, orchestrators driving child sessions) as first-class app features. The `grove` command is enough for agents to drive sessions for now.
- Add-ons that run new code (such as an editor tab). Only settings, shortcuts, themes, launchers and layout are changeable by sentence in v1.
- Remote machines ("Add machine").
- Windows and Linux.
- Migrating old sessions, projects or settings. The new app starts clean.
- Fixing or changing the old Grove, which keeps serving the features v1 lacks.

## How I'll know it works

1. Start the app on a clean setup: it opens empty, and I can add a space from the app and another by running a terminal command in a folder. Both are still there after a restart.
2. Open several tabs in a space: each lands in the space's root folder.
3. Add a worktree: it appears as a space under its repo's space.
4. Run Claude, OpenCode and Copilot each in a tab: each shows up in the agents list in the right state group, with time since last change, and the state follows what the agent actually does (working, needs me, idle, finished).
5. While I am in another window, make an agent ask for permission: I get a notification and a sound. Let another one finish: same. Nothing is stuck showing the wrong state for more than a few seconds; where an agent cannot report, it shows "unknown".
6. Quit the app, and separately kill it hard: agents and terminals keep running. On reopen they are all listed with correct current status.
7. Reboot: spaces and tabs are back, terminals are fresh shells, and agents that support it show a one-click Resume that brings the conversation back.
8. Grid mode shows up to nine live tabs at once, each updating.
9. From a plain terminal, `grove` can list, start, send to, read, wait for, focus and kill sessions, and an agent in one session can drive another this way.
10. Ask an agent in one sentence to change a setting, a shortcut, the theme, a launcher look and the layout: each applies live without a restart. Then break the settings file on purpose: the last good version stays in effect and a clear note tells me what was wrong.
11. Run it on the personal Mac and on the work Mac (admin available); on the work Mac the list of extra things I must install is as short as possible, and I can see what that list is.
12. The old Grove is untouched and still running beside the new one, with its own sessions and settings, and the new app shows none of them.

## Interview log

**Q1. Which flows must be in the first version for you to switch to it for daily work?** Options: A. Core only (spaces, tabs, sidebar with spaces and agents, crisp status, grid, Claude + OpenCode + Copilot started from the app and the `grove` command); B. Core plus a Changes view; C. Core plus the auto flow (orchestrators driving child sessions); D. Everything that exists today, rebuilt cleanly. Recommended: A, then C before B.
**A1.** A. Core only. Workflow driving, review comments, diff, dictation, scratchpad and the classifier stay in the old Grove until they return.

**Q2. In the first version, what should the "change the app with one sentence" goal look like?** Options: A. Not in v1, only leave room; B. Small things in v1 (settings, shortcuts, themes, launcher looks, sidebar and panel arrangement, live reload, no new code); C. Full in v1 (add-ons that run trusted code, as in Herdr); D. Full with a safety bar. Recommended: B.
**A2.** B. Small things in v1. An agent can change settings, shortcuts, themes, launchers and arrangement with live reload, and a broken file keeps the last good version. Add-ons that run new code (such as an editor tab) come later.

**Q3. Where must the new Grove run in v1?** Options: A. Personal Mac only; B. Personal and work Mac, installed like a normal app; C. Locked-down work machine (single self-contained signed download, no extra tools, maybe proxy); D. Windows or Linux too. Recommended: B.
**A3.** Free text: "when using grove now have only been running it through npm run dev. so i can do quite a bit on my work computer (admin). but want to avoid installing as many deps as possible." Read as: B (both Macs, admin available, run-from-source is acceptable today), with a strong preference for as few things to install as possible on the work machine.

**Q4. Which moments must the app tell you about when you are in another window, and how wrong may status be?** Options: 1. Only needs-you (permission, question, error) interrupt; 2. Needs-you and finished both interrupt (notification and sound); 3. Nothing interrupts; 4. Needs-you only plus a hard bar (never stuck wrong more than a few seconds, show "unknown" where an agent cannot report reliably). Recommended: 4.
**A4.** 2. Needs-you and finished both interrupt, with notification and sound, as Grove does today when the agent is off screen. The "never stuck wrong, show unknown" rule was not chosen on its own, so it is still open how strict the accuracy bar is for "finished".

**Q5. What must still be running and findable after the window closes, after a crash, and after a reboot?** Options: 1. Survive close and crash, reboot starts fresh (spaces and tabs return, terminals are fresh shells, agents resume with a one-click Resume where supported); 2. Survive close only; 3. Survive everything incl. reboot with automatic resume; 4. Nothing survives. Recommended: 1.
**A5.** 1. Agents and terminals keep running when the app quits or crashes; reopening shows them with current status. After a reboot spaces and tabs are back, terminals are fresh shells, and agents offer a one-click Resume where the agent supports it.

**Q6 (asked by the planner from the cto's note).** Should the new Grove run beside the old one and start clean, or take over existing sessions, projects and settings? Options: beside and start clean; beside and import project folders as spaces; replace and migrate. Recommended: beside, start clean.
**A6.** Beside, start clean. The old Grove keeps serving features v1 lacks; the new app starts empty; no migration code.

## Open questions
