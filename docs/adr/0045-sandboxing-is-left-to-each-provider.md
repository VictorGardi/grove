# 0045. Sandboxing is left to each provider

Date: 2026-10-23

## Status

Accepted

## Context

Grove had sandboxed sessions: an agent process running inside an Apple `container`
Linux VM (ADRs 0033-0036, 0039, 0040; 0038 was already superseded by 0035). The
agent providers (Claude Code, Copilot, OpenCode) now ship their own isolation
features, and maintaining a VM sandbox of our own (images, mounts, credentials,
networking, the OpenCode service bridge) was costly.

## Decision

Grove removes sandboxed sessions entirely: the launch dialog option, `grove new
--sandboxed` and the socket `sandboxed` parameter. The CLI now rejects `--sandboxed`
as an unknown option, and the socket answers `bad-params unknown parameter:
sandboxed`. Grove builds no replacement isolation; isolation beyond git worktrees is
left to each provider's own features.

## Consequences

- The state file goes to version 10. Sessions that were sandboxed are dropped from
  the list on upgrade. Older Grove builds cannot read version 10.
- A one-time cleanup runs on first launch (`src/core/legacySandboxCleanup.ts`). It
  runs in the background, gives each external call a 10 s timeout, and writes the
  marker file `sandbox-cleanup.done` in the data folder even if `container` is
  missing or times out. It:
  - stops and removes containers whose names start with `grove-`;
  - removes images tagged `grove-sandbox:`;
  - removes the `hostname` key from the OpenCode `service.json`, only if it equals
    the default network's gateway as reported by `container`. Other keys (password,
    port) are kept. If the gateway has since changed, a stale entry is left behind;
    if `container` is unavailable, the file is left alone.
- Worktrees and tmux sessions of dropped sessions are left alone. Stopping the
  containers ends their terminal panes.
- The cleanup module is meant to be deleted in a later release.
- The artifact viewer iframe sandbox and CSP are unrelated and unchanged.
- Rejected alternatives:
  - Filtering sandboxed sessions at load and keeping the flag: leaves dead state and
    code paths in place for no benefit.
  - Running the cleanup on every launch: needless external calls forever; once is
    enough.
  - Leaving `service.json` alone: a stale `hostname` would keep OpenCode bound to a
    container-only address.
