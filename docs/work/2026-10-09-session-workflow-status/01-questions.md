---
feature: 2026-10-09-session-workflow-status
phase: questions
status: draft
version: 1
created: 2026-10-09
updated: 2026-10-09
approved_at:
based_on: []
forced: []
---

# Questions: session workflow statuses

## Scope

Add a manually selected workflow status to every session, surfaced by an Xirp-style circle on session cards. This is a label, not a session-lifecycle control.

## Research questions

1. How are session fields persisted and migrated, and where are sessions created or updated?
2. Which card components represent sessions, and how can one status picker be shared across them without replacing grid membership or live status?
3. What Xirp statuses, glyphs, and colors does the supplied reference establish?

## Size verdict

S — one cross-layer slice: persisted session field, migration/default, update command, and card picker/marker with focused tests.

## Flow

Standard, force-requested by the human to bypass Grove approval gates for this implementation. Artifacts remain drafts; no approval status is set by the agent.
