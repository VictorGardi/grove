---
feature: 2026-10-23-session-spinner
phase: outcome
status: approved
version: 1
created: 2026-10-23
updated: 2026-10-23
approved_at: 2026-10-23
based_on: []
forced: []
---

# Outcome: session spinner while a session starts

## Summary

When a session is started (new or resumed), its card appears in the sidebar at once, even while the worktree is still being created. It shows a spinner until the agent reports its first status, then the normal status dot takes over. The same applies to the collapsed rail tile. If startup really fails, the card becomes a dismissable error card. If the agent never reports a status, the spinner stops after about 60 s and the card looks normal.

## What the human sees and does

- Starts a new or resumed session: a card appears immediately in the sidebar (and a tile on the rail when collapsed). A spinner sits where the status dot normally is; on the rail tile, in the corner-dot position.
- First status arrives: the spinner is replaced by the usual status dot. No other layout change.
- Real failure (worktree creation, tmux, preflight): the card switches to an error state with an error indicator in place of the spinner. Hovering shows the reason. The human can dismiss the card.
- Agent silent for about 60 s: the spinner stops and the card looks like a normal card, with no error.
- Collapsed parent with a starting child: the parent shows the spinner only if no child has a more urgent status; otherwise it shows that child's dot as today. Expanding the parent shows the child's own spinner.
- Restart-restored sessions show no spinner.
- Defaults chosen without asking: the spinner replaces the dot (not beside it), uses the existing small spinner component, and matches the dot's size and position on card and rail tile.

## Non-goals

- No spinner for restart-restored sessions.
- No retry button or auto-retry on failure; the error card is dismiss-only.
- No progress steps or phase text (such as "creating worktree...").
- No change to status semantics or urgency ranking among existing statuses.
- No spinner for other busy states, such as a working agent.
- No configurable timeout.

## How I'll know it works

1. Start a new session: the card appears right away with a spinner, including during slow worktree creation. The spinner becomes the status dot on the first status.
2. Resume a session: same behavior.
3. Restart the app with existing sessions: no spinners.
4. Collapse the sidebar to the rail: the tile shows the spinner in the corner-dot position until the first status.
5. Force a worktree, tmux or preflight failure: the card turns into an error card with the reason on hover, and it can be dismissed.
6. Use an agent that never reports a status: the spinner stops at about 60 s and the card looks normal, with no error.
7. Collapse a parent that has a starting child and no more urgent sibling: the parent shows the spinner. Give another child a more urgent status: the parent shows that status instead.

## Interview log

**Q1. Which moments should the spinner cover?** Options: only after the card exists; new + resumed with the card appearing at once (recommended); everything incl. after restart.
**A1.** New + resumed, card appears at once: a card with a spinner appears as soon as a session is started (even during worktree creation) and spins until the first status arrives. Resumed sessions spin too. Restart-restored sessions do not.

**Q2. If a new session fails to start or the agent never reports a status, what should you see on the card?** Options: error card + timeout fallback (recommended); card vanishes with a toast; timeout only.
**A2.** Error card + timeout fallback: real failures (worktree, tmux, preflight) turn the card into a dismissable error state with the reason on hover. If the agent just never reports a status, the spinner stops after a timeout (~60 s) and the card looks normal. Nothing spins forever.

## Open questions
