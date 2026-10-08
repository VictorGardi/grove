# 0017. Agent-neutral session id and the first state migration

Date: 2026-10-06

## Status

Accepted

## Context

`Session.opencodeSessionId` is persisted in `state.json`, and core keys launch
argv and live status on it. Claude Code sessions (epic v6) need their own
agent session id, a UUID passed as `claude --session-id`. The store accepts
only `schemaVersion: 1`; any other version is moved aside as `.bad-<ms>`, and
no migration code exists, although ADR 0009 says migrations are hand-written
per `schemaVersion`.

## Decision

`Session.kind` becomes `opencode | claude | terminal` and
`opencodeSessionId` is renamed `agentSessionId: string | null`, interpreted by
kind. `state.json` moves to `schemaVersion: 2`, read through a hand-written
v1 → v2 migration (rename the field) in the versioned-read path; the file is
written back as v2.

## Consequences

- One id field for every agent kind; code branches on `kind`, not on which
  id is set.
- The migration path that ADR 0009 describes now exists, with a test.
- An older build opening a v2 file moves it aside (single user, development
  builds only).
- Rejected: renaming without a version bump and aliasing on load (the version
  stops describing the shape); one id field per agent (schema grows with each
  agent, branching on field presence).
