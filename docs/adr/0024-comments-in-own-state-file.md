# 0024. Review comments live in their own state file, pushed as a `comments` slice

Date: 2026-10-07

## Status

Accepted

## Context

Comment drafts and sent comments must survive restarts (ADR 0009: app state
in versioned JSON files, never in repos). ADR 0009 planned
`comments/<projectId>.json` for "hundreds of comments" on feature artifacts.
Review comments instead keeps one tray per session, with drafts on diff lines
and markdown artifacts, and the volume is small: drafts plus at most 100 sent
per session.

## Decision

All comments live in one file, `<userData>/comments.json`
(`{schemaVersion: 1, comments: Comment[]}`). Core reads and writes it with
`readVersioned` and `atomicWrite`, and pushes it whole as the `comments` slice
(ADR 0011). A comment belongs to a session (`sessionId`), and removing the
session removes its comments.

## Consequences

- Same patterns as `state.json`: whole-slice pushes and a separate schema
  version, so comment changes never rewrite session or UI state.
- Supersedes the per-project file planned in ADR 0009.
- Rejected: per-project files (trays are per session, not per project);
  inside `state.json` (a v4 migration, and every UI change rewrites comments).
