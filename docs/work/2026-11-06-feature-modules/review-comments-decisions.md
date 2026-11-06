# Diff review: restyle, comments, and sending them to the focused agent

Status: decided in a grill-me session on 2026-11-06. Not a grove-phase artifact. Targets `next/` (the Tauri rebuild). Records ADR 0052.
Mockups: https://claude.ai/artifact/FS164yXZnELR4yurtofR2d (option A was chosen).

## Goal

Make the Changes panel feel like reviewing code on GitHub (option A: one scrolling column of file cards), let the human leave line
comments, and send the pending comments to the agent session whose changes are being reviewed.

## Facts checked in the code

- The core has `tabs.write` (`protocol/messages.ts`, raw bytes to a tab). The CLI's `send` uses it through `cli/paste.ts` (`pasteText`,
  `waitStable`). The window can do the same; no new core transport is needed.
- The diff panel names the active tab and the core resolves the folder; per-folder diff prefs are persisted by the core
  (`core/store/state.ts`, `diffPrefs`). Comments follow that model.
- No comments, viewed state or review concept exists in `next/` today.

## Decisions

1. **Delivery: batch, human-triggered.** Comments collect as pending. One "Send to <agent>" press sends them all. Nothing is sent before.
2. **Paste only.** The review text lands in the agent's input, unsubmitted. Focus moves to that tab. The human edits and presses Enter.
3. **Target: the active tab.** The button names it (agent and tab name). It is disabled with a reason for a shell or a dead tab.
4. **Storage: the core, per folder.** New `diff.comments.*` RPCs and a `diffComments` section in `state.json`, added without a version
   bump like `diffPrefs`. A comment is anchored by file, side (old or new), line and the line's text. If the text no longer matches after a
   refresh, the comment is flagged "outdated". It is never moved or dropped silently.
5. **Lifecycle: pending, sent, resolved.** Send includes only pending comments and marks them sent. Sent comments stay visible, dimmed.
   The human resolves or deletes them.
6. **Format: markdown.** One intro line ("Review comments on the current changes:"), then per comment `path:line (new|old)`, a fenced
   snippet of the line with two lines of context, and the comment text. The same text for every agent kind.
7. **Slices:** 1 restyle (option A, no behaviour change). 2 comments (core store, RPCs, thread UI, pending list). 3 send (`tabs.write`).
   Each is reviewed alone.
8. **Agent state.** Send is allowed while the agent is working, with a one-line notice. It is disabled while the agent waits on a
   permission prompt or question, because pasted text could answer it.

## Open for the plan

- Exact `diff.comments.*` method names and params.
- Where "viewed" state lives (likely the same core section).
- Whether `pasteText` moves out of `cli/` into a shared place so the window can use bracketed paste.
- What "focused" means in grid mode, where several panes are on screen: the window's active tab is the rule until that is a problem.
- Whether the Unified/Split toggle in option A ships in slice 1 or is shown disabled. Recommendation: slice 1 ships Unified only.
