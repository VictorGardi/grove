# 0008. In-app inline comments, collected as drafts, sent explicitly

Date: 2026-10-05

## Status

Accepted

## Context

The human reviews grove artifacts daily and wants to highlight and comment on
them, collect comments (possibly across several artifacts), and send them to
the agent only by explicit action. Editing artifacts in the app is a non-goal.
Plannotator exists but runs in a browser as one closed session per file.
Artifacts are served through `grove-artifact://` with one injectable script
(ADR 0007).

## Decision

The app builds an inline comment layer: the injected script supports text
selection, a comment popover and highlights, talking to the app only via
`postMessage`. Each comment anchors on artifact path, artifact `version`,
quoted text, and prefix/suffix context (TextQuoteSelector), re-attached by fuzzy
match after rewrites; unplaceable comments show as orphaned. A per-feature
review tray holds drafts. "Send to agent" fills the workflow's `{feedback}`
variable and either pastes into a linked idle session or starts the stage's
`needs_input` action; the human chooses the target. Sent comments are kept and
marked with the version they were made against.

## Consequences

- Review stays in the app and matches "collect, then send"; no dependency.
- Costs roughly 4–6 days of the appetite. If cut, side-panel comments (no
  inline anchors) reuse the same data model and send path.
- Rejected: Plannotator as the review flow (out-of-app, per-run sessions, no
  persistent drafts; it may remain an "open externally" button); side-panel
  comments only (no highlighting, clunky for line-level review).
