# 0009. App-owned state in versioned JSON files, never in repos

Date: 2026-10-05

## Status

Accepted

## Context

The app owns three kinds of data: projects/config, sessions with their feature
links, and comment drafts. Sessions can start unlinked, so they have no feature
folder to live in. The human decided the app never writes into repos. The
ticket had proposed a per-feature `.sessions.json`. Data volume is small (tens
of sessions, hundreds of comments).

## Decision

Config (projects, workflow path) lives in `~/.config/grove/config.json`
(human-editable). State lives in `~/Library/Application Support/grove/`:
`state.json` (sessions, links, UI state) and `comments/<projectId>.json`. Every
file carries a `schemaVersion`, is written atomically (write `.tmp`, rename),
and has a single writer: the core in main. Features are identified by
`projectId + slug`.

## Consequences

- No new dependency or native module; files are inspectable and backed up by
  hand. Migrations are hand-written per `schemaVersion`.
- A renamed feature folder orphans its links and comments (shown as orphaned).
- The ticket's `.sessions.json` and its gitignore change in grove-skills are no
  longer needed.
- Rejected: SQLite (a second Electron-ABI native module, migration framework,
  no benefit at this size); per-feature files in repos (breaks "never writes
  into repos", no home for unlinked sessions).
