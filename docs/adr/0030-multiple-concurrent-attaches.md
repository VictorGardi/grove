# 0030. Multiple concurrent attaches, owned by the renderer

Date: 2026-10-07

## Status

Accepted

## Context

`pty:attach` killed every earlier attach ("one live attach: the focused
session"), because one terminal showed at a time. The session grid shows
several live terminals at once, each in its own xterm. Nothing detached an
attach when the renderer reloaded.

## Decision

`pty:attach` no longer kills earlier attaches. `attaches` stays a map of
`attachId` to handle; each terminal owns its attach and detaches on unmount.
Main kills every attach when the window's `webContents` is destroyed or
reloads. A session is attached by at most one terminal at a time.

## Consequences

Easier: the grid needs no new channels; `pty:data`/`pty:exit` are already
filtered by `attachId`. Harder: a leaked attach is no longer cleaned by the
next attach, hence the `webContents` cleanup. Rejected: a main registry keyed
by `sessionId` (extra index, forbids two views of one session); one shared PTY
fanned out to many xterms (sizing conflicts, ref-counting, not needed).
