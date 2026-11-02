# 0027 (note). The control socket's missing authentication is an accepted risk

Date: 2026-11-02

Companion to [0027](0027-grove-cli-over-unix-socket.md). It changes nothing in that decision.

## Status

Accepted

## Risk

The control socket (`<userData>/grove.sock`, mode 0600) has no token and no peer
check. Any process running as the same user can send it requests, including
`new` (which starts an agent session with a prompt of its choosing) and
`kill`. Unauthenticated `sessions.create` is therefore a way to run an agent
as the user. This was found in the 2026-11-02 security review (finding 2).

## Why accepted

- The same user can already run anything: reaching the socket grants nothing
  that `tmux -L grove`, the user's shell or their agent CLIs do not.
- Mode 0600 plus the single-instance lock keep other users out.
- A token would have to be handed to every session and CLI call, a change to
  the contract in 0027 that the human chose not to make for this feature.

## When to revisit

- Grove runs untrusted code inside the same user account (for example a
  sandboxed session that can still reach `GROVE_SOCKET`; see ADR 0045).
- The socket moves off a user-private directory, or onto a network transport.
- A caller-identity or per-session permission model is wanted.

## Follow-ups, not done

- Socket authentication (a token or peer-credential check).
- The IPC allowlist and sender validation in the Electron main process
  (finding 3, see the security review research). Left out of the
  security-fixes feature on purpose.

## Dependency scan: how entries are accepted and how failures arrive

The OSV scan (`.github/workflows/ci.yml`) is documented in the README
section "Dependency scan". Weekly and manual runs have no PR to show a red
check on: a failure there arrives only as a failed Actions run and GitHub's
standard email. Nothing else notifies anyone. An ignored email means a new
advisory can sit unseen. Entries in `osv-scanner.toml` need an `ignoreUntil`
date and a `reason`, so an accepted finding comes back as a failure when it
expires.
