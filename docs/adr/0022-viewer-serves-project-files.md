# 0022. The viewer serves viewable files anywhere in the project folder

Date: 2026-10-07

## Status

Accepted; its second `~file` route and the `file` variant beside `artifact` are superseded by [ADR 0032](0032-one-viewer-file-target.md)

## Context

ADR 0007 serves only files inside discovered feature folders through
`grove-artifact://`. The session diff lists changed files, and the documents
most worth reading rendered there are often outside feature folders: ADRs,
`CONTEXT.md`, `README.md`, `AGENTS.md`. Review comments (ADR 0008's quote
layer) need the same files rendered.

## Decision

Amends ADR 0007. A second route, `grove-artifact://<projectId>/~file/<path>`,
serves a file when it is viewable by extension and passes the existing
`safeArtifactPath` check against the registered project folder: relative, no
dot-segments (so nothing under `.git/`), real path inside the root after
symlinks, a regular file. Responses get the same header CSP, opaque sandbox,
markdown rendering and bundled Mermaid as artifacts. Feature-folder files
still open as artifacts. The viewer target gains a `file` variant.

## Consequences

- Any document an agent writes in the project can be read rendered and later
  commented on.
- Agent-written HTML anywhere in the project can run in the viewer, inside the
  same sandbox with no network and no same-origin access as artifacts today.
- Two allowlists to maintain in one handler. Dot-folders (`.github/`) stay
  unviewable. A feature folder literally named `~file` becomes unreachable.
- Rejected: feature folders only (ADRs and `CONTEXT.md` unreadable rendered);
  the diff's repo root (the allowlist would follow a pane's live cwd).
