---
kind: feature
created: 2026-10-07
flow: small
---

# Unify viewer targets and comment anchors

Any rendered markdown file in a project can be commented on, whether it sits in
a feature folder or elsewhere (CONTEXT.md, ADRs, README). Removes the
slug-keyed `artifact` target and the `~file` route split of
[ADR 0022](../../adr/0022-viewer-serves-project-files.md) in favour of one
project-relative file target. Follow-up to `2026-10-07-review-comments`, which
left project files out of scope.

## Flow log

- 2026-10-07: small — proposed standard from size M; human chose small (mechanical refactor, no research or design review)
