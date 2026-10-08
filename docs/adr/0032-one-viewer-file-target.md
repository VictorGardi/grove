# 0032. One viewer file target, project-relative

Date: 2026-10-08

## Status

Accepted. Supersedes the second route of ADR 0022 and the slug-keyed route of
ADR 0007.

## Context

The viewer had two document targets: `artifact` (`projectId + slug + path`,
inside a discovered feature folder) and `file` (`~file`, ADR 0022, anywhere in
the project). Only artifact markdown could be commented on, so `CONTEXT.md` or
an ADR rendered but offered no Comment. Comment anchors carried the slug too.

## Decision

- One target `{kind: 'file', projectId, path}`, `path` relative to the project
  folder. URL: `grove-artifact://<projectId>/<path>#<hash>`. No `~file`
  segment, no slug.
- One server check: viewable extension plus `safeArtifactPath` against the
  registered project folder (no dot-segments, real path inside, regular file).
- Markdown comment anchors are `{kind: 'file', projectId, path, quote…}`. Any
  rendered `.md` can be commented on. Drafts are re-anchored per file on disk
  change, not per feature.
- `DiffFile.rendered` is `{path}`; the diff no longer looks at feature folders.
- The viewer's file switcher finds the feature by folder prefix (renderer).
- Persisted: `state.json` v6 closes a saved `artifact` viewer; `comments.json`
  v2 drops drafts with an artifact anchor and turns sent ones into file anchors
  labelled `<slug>/<path>` (the feature folder isn't known to a migration, so
  their jump may not resolve).

## Consequences

- One kind of target, one anchor, one handler path. Relative links between
  project documents resolve naturally against the URL.
- Not viewable or commentable any more: a feature folder outside the project
  folder (discovery lets `artifactRoot` be `../x`), or under a dot-folder such
  as `.grove/work`. Discovery still lists such features.
- Rejected: a root field on the target (keeps every file reachable but adds a
  persisted dimension for a configuration edge case).
