# 0004. Core runs in Electron main behind an Electron-free seam

Date: 2026-10-05

## Status

Accepted

## Context

tmux keeps sessions alive across app quits (ADR 0003). The app still needs a
home for its live machinery: PTY attaches, tmux control, file watchers, the
OpenCode event client and the state store. Options were Electron main, a
`utilityProcess` child, or a detached daemon that outlives the app (Xirp).

## Decision

The core runs in Electron main. Core modules (backend, discovery, derivation,
status, store) import nothing from Electron and expose a plain event-emitter
interface; only a thin IPC layer in main touches Electron. Nothing observes
while the app is closed; on start the app reconciles from tmux, its state store
and OpenCode's HTTP API.

## Consequences

- One Node process, no extra channel, simplest debugging; same shape as the
  previous app.
- A native crash or blocked event loop affects the window process; moving the
  core to a `utilityProcess` later is mechanical thanks to the seam.
- Events that happen while the app is closed are recovered by reconciliation,
  not observed live.
- Rejected: `utilityProcess` now (solves an unseen problem, adds a hop per
  keystroke); a detached daemon (lifecycle and versioning cost, overlaps tmux).
