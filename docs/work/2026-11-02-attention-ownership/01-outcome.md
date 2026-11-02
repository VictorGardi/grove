---
feature: 2026-11-02-attention-ownership
phase: outcome
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: []
forced: []
---

# Outcome: attention ownership and sidebar zones

## Summary

Grove should work for the human instead of asking them to hold every agent's hand. Every session has an owner: the human, or a parent agent. Routine events from a child go to its parent, and the parent either handles them or passes them up with a one-line reason. Only things that need the human reach them. The sidebar is regrouped into zones that show what needs the human, what is ready to review, what is running fine without them, and where they were. A child that finishes cleanly stays visible on its own row but no longer counts toward "N waiting" or cmd+. and no longer interrupts. Failures look exactly as they do today. This replaces the earlier narrow idea of notification tiers, mute and a new failed state.

## What the human sees and does

- **Zones are the default sidebar view.**
  - **Needs you:** sessions the human must answer. Each row shows the session name and the parent's one-line reason for escalating. Enter, click or cmd+. opens the session where the question waits; the human answers there, as today. There are no inline answer buttons.
  - **Ready to review:** finished work waiting for a look, including finished runs.
  - **Running (handled):** work in progress that a parent is taking care of, collapsed to a count. It can be opened to audit what the parent resolved.
  - **Where you were:** about 5 recent sessions, each with a one-line "what it was doing", so the human can find their way back after a break or a restart.
- **Projects toggle:** the old project tree is one click away through a Zones/Projects toggle, newest first with readable names.
- **Run parents:** a parent running a set of slices shows a progress bar, for example "Slice 4 of 8, 8 children done, none escalated".
- **What a parent decides alone:** routine permission prompts and obvious either/or questions that its own plan already answers.
- **What a parent passes up:** new kinds of permission, real trade-offs, design choices, destructive actions, and anything it is unsure about. When unsure, it passes it up.
- **Override:** the human can always move a session to a different zone by hand.
- **How a session lands in a zone:** clear cases follow simple rules; agents can declare where they belong; ambiguous cases, such as a question asked in prose, are judged by a small fast model. When unsure, the session goes to Needs you.
- **Clean-finished child:** keeps its finished look on its own row; not counted in "N waiting"; cmd+. does not visit it.
- **Child asking a permission or question:** stays counted and visited unless the parent handles it.
- **Failures:** no new failed state. A failed session looks as it does today (the same as a normal finish), so a child that ends in an error is treated like a clean finish: silent and out of the count.

## Non-goals

- No new failed status or error look for any kind of session (Claude, OpenCode, Copilot, terminal).
- No inline answering from the sidebar; the human answers in the session.
- No per-session mute and no presence check (skipping alerts when the window is focused or the human is active). The interview never settled them, so they are deferred.
- Notifications are not redesigned as a goal in themselves. Quiet comes from routing, not from new alert settings.
- No per-project or per-run setting for how much a parent may decide; one rule applies everywhere.
- Replacing the project tree is not a goal; it stays available.
- A top-level "superorchestrator" session is not promised. It was raised as the root owner, but its details are not settled here.

## How I'll know it works

- A run with 8 children where nothing goes wrong produces no popups, no sound, and no change to "N waiting" from the children. The parent's progress bar advances slice by slice and the children show as finished on their own rows.
- A child that asks something outside the routine list (a new kind of permission, a design choice, a destructive action) appears in Needs you with the session name and a one-line reason; Enter, click or cmd+. opens that session.
- A child that asks a routine permission or an obvious either/or question from the plan is answered by the parent. It does not appear in Needs you; it shows in the Running (handled) count, and opening it lets the human audit what was resolved.
- When the parent is unsure about a question, it appears in Needs you instead of being answered.
- A finished run appears in Ready to review.
- After a restart, Where you were shows about 5 of the last sessions worked in, each with a one-line "what it was doing".
- A child that finishes cleanly keeps its finished look on its own row, but cmd+. skips it and it is not in the "N waiting" number.
- A child that ends in an error looks the same as it does today; no new failed look appears anywhere.
- The human can move any session to another zone by hand, and it stays there.
- The Zones/Projects toggle switches between the zone view and the project tree.

## Interview log

_Restarted 2026-11-02 around ownership and sidebar zones (see 00-ticket.md scope change). Q1-Q3 below come from the earlier narrow framing; A2 and A3 still stand, A1 is subsumed._

**Q1. When a child session finishes cleanly, what should you experience?** Options offered: B silent but visible (recommended), A fully silent, C batched, D silent with a time limit.
**A1.** (Free text, no option picked.) "i don't want the children finishing notification to be included in the 'X waiting' notification i currently get that i toggle through using cmd + ." Fact check: that is the sidebar "N waiting" button and the next-waiting shortcut (`App.tsx` `nextWaiting`, `Sidebar.tsx` waitingCount), which count and cycle every session whose shown status is waiting, including finished children.

**Q2. A clean-finished child leaves the "N waiting" count and cmd+. cycle. How should it still show up, and what about children with a problem?** Options: A finish visible, problems counted (recommended); B finish hidden too; C only the parent counts; D as A plus a safety net.
**A2.** A. A clean-finished child keeps its finished look on its own row but is not counted or visited by cmd+. A child asking a permission or question, or failing, stays counted and visited.

**Q3. When a session fails (error, abort, or a terminal command exiting with an error), what should you see, and should its parent's row also show it?** Options: A all kinds, parent shows it too (recommended); B all kinds, child row only; C AI agents only; D popup and sound only.
**A3.** (Free text, no option picked.) "i don't want to change current behavior regarding this". So: no new failed state, and failures keep looking like a normal finish for every session kind. Consequence for Q2: a failed child cannot be told from a clean finish, so only a child's permission or question stays counted; a child that ends in an error is treated like a clean finish (silent, out of the count). The ticket's goal to add a failed status is dropped.

**Human question (free text, asked instead of Q4 mute).** "Should those statuses be set by me manually (workflow status), since I can already group the sidebar like that, or can we make it automatic, by a superorchestrator classifying? Is this where a small fast agent would be perfect?" Fact check: the existing workflow status is a manual label (backlog, in-progress, blocked, in-review, cancelled, done, pinned) independent of live agent status; the sidebar can group by it (`groupBy: 'status'`); agents can set it with `grove status`.

**Q4. When a child agent hits something, how much may its parent agent decide alone before it has to hand it to you?** Options: A routine alone, rest to you (recommended); B permissions only; C almost everything; D set per project or run.
**A4.** A. The parent answers routine permission prompts and obvious either/or questions from its own plan. It escalates new kinds of permission, real trade-offs, design choices, destructive actions, and anything it is unsure about. "Running (handled)" shows what the parent resolved so it can be audited. When unsure, escalate; the human can always override a session's zone by hand.

**Q5. When a parent agent escalates something to you, what do you see in the sidebar, and where do you answer it?** Options: A reason line, answer in the session (recommended); B reason plus quick answer buttons; C reason line only; D reason plus what the parent tried.
**A5.** A. The "Needs you" row shows the session name and the parent's one-line reason. Enter, click, or cmd+. opens the session where the question waits; the human answers there, as today. No inline answering.

**Q6. How should the sidebar be laid out now that it has zones, and does the old project tree stay?** Options: A zones default with the tree as a toggle (recommended); B zones replace the tree; C zones on top, tree below; D tree default, zones optional.
**A6.** (Free text, no option picked.) The human asked for 3 mockup alternatives of the zone sidebar as artifacts before deciding. Mockups: https://claude.ai/artifact/SUH1gfXk4GpTZwF2pg5pNs (A inbox zones with a Zones/Projects toggle; B attention tray over the project tree; C tabbed zones with a Where-you-were strip). Layout decision pending the human's pick.
**A6 (decision).** A, with one addition from B: a run parent's card shows a slice progress bar (e.g. "Slice 4 of 8, 8 children done, none escalated"). So: zones are the default (Needs you, Ready to review, Running (handled) collapsed to a count, Where you were); the project tree stays one click away through a Zones/Projects toggle; run parents show a slice progress bar.

## Open questions
