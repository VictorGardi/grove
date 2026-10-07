---
kind: feature
parent: 2026-10-05-opencode-feature-workspace
order: 8
created: 2026-10-05
---

# Artifact comments

Child 6 of epic `2026-10-05-opencode-feature-workspace`. Read the epic's
`02-research.md` and `03-design.md` first.

## Goal

Review artifacts by commenting inline and sending the comments to the agent deliberately.

## Outcome

I select text in a viewed artifact and add a comment. Comments are kept as drafts with TextQuoteSelector anchors and the artifact version, and they re-attach after the artifact is revised. Unplaceable comments show as orphans. The review tray lists drafts, and Send turns them into one `{feedback}` revise prompt through child 5's send path. Nothing is ever sent automatically.

## Scope

E-D7 (`comments/<projectId>.json`, `Comment`), E-D8 (injected `postMessage` script), E-D9. Design: Desired state 7 (commenting); "Artifacts and comments"; the comment re-anchoring risk.

## Dependencies

4, 5.

## Size estimate

4–6 days, about 6 slices. Appetite cut 5: if inline comments are behind at the midpoint, ship side-panel comments on the same data model and send path.

## Superseded (2026-10-07)

Replaced by the standalone feature `2026-10-07-review-comments`, which covers
comments on session diffs as well as artifacts and builds its own send path
instead of waiting for child 5
([ADR 0020](../../adr/0020-sessions-and-review-before-workflow.md)). Don't
start this child.
