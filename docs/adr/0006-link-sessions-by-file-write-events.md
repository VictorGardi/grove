# 0006. Link sessions to features from OpenCode file-write events

Date: 2026-10-05

## Status

Accepted

## Context

Sessions started from the ＋ modal begin unlinked; the human expects them to
group under the right epic/feature automatically once grove skills start
writing into a feature folder. The human often runs several features in
parallel in one project, so timing-based correlation is ambiguous. The app
already holds OpenCode's SSE stream (ADR 0005), which includes tool events.

## Decision

A session is linked to the feature whose folder (under a discovered feature
root) its edit/write tool most recently targeted; writes into an epic's folder
link to the epic. A manual link pins the session and stops auto-linking. Writes
into a folder not yet discovered are held briefly until discovery reports it.
At startup, events missed while the app was closed are recovered by reading
each known session's messages over HTTP. Plain terminals are linked manually
only. Sessions started from next-action buttons are linked at creation.

## Consequences

- Correct with parallel sessions in one project; no workflow knowledge needed.
- Depends on tool events carrying the target path (Phase 0 verifies; failure
  reopens this decision).
- A session that touches several features moves to the latest one; history of
  earlier links is not kept.
- Rejected: manual only (loses auto-grouping); matching file changes to the
  working session (wrong with parallel sessions or the human's own edits);
  prompt-text patterns (slug doesn't exist yet when questions starts).
