# 0025. Comment anchors carry both position and text, and core re-anchors them

Date: 2026-10-07

## Status

Accepted

## Context

Drafts must stay attached when files change, show as orphaned when they
can't, and give the agent a precise location. Diff lines have a stable
identity `(path, side, number)` (ADR 0021). Rendered markdown has no
source-line mapping. ADR 0008 chose a quote anchor (TextQuoteSelector) for
artifacts, re-attached by fuzzy match.

## Decision

- A **diff** anchor stores `root`, `path`, `side`, `start..end` and the
  lines' text. Re-anchoring finds that text as a contiguous run on the same
  side, nearest the old position.
- A **markdown** anchor stores the quote (`exact`, `prefix`, `suffix`,
  whitespace-collapsed) plus the source line range of the enclosing blocks,
  taken from markdown-it's `token.map`. Re-anchoring searches the blocks'
  plain text for the quote; it needs a unique match.
- Core re-anchors on diff changes and on artifact mtime changes, and sets
  `orphaned`. It clears `orphaned` when the text is found again.

## Consequences

- The agent gets line numbers and quoted text for both kinds of comment.
  Orphan state is known without the artifact being open.
- Markdown text extracted from tokens can differ from the rendered DOM
  (entities, task boxes). Such drafts orphan, but stay sendable.
- Amends ADR 0008: exact-or-unique matching instead of fuzzy matching, and
  no artifact `version` field.
- Rejected: quote only (no line numbers, and core can't place it); line
  numbers only (placement lost on edits above); re-anchoring in the iframe
  (state is known only while the artifact is open).
