# 0028. The CLI runs on the app's own Electron binary as Node, through an app-written launcher

Date: 2026-10-07

## Status

Accepted

## Context

The `grove` command must work for agents in grove sessions and for the human
in any terminal, without assuming a system `node`. The app isn't packaged yet
(epic child 8). It runs from a dev checkout through electron-vite.

## Decision

The CLI is a second input of electron-vite's main build (`out/main/cli.js`).
At every start, the app writes `<userData>/bin/grove`, a `#!/bin/sh` launcher
that runs `ELECTRON_RUN_AS_NODE=1 exec <process.execPath> <cli.js> "$@"`.
Grove sessions get that directory first on `PATH`, prefixed after the login
shell's rc files. The menu item **Install Command Line Tool…** symlinks
`~/.local/bin/grove` to the launcher.

## Consequences

- No new toolchain or dependency. The CLI always matches the running app's
  code.
- Each call starts Electron in Node mode (roughly 100–200 ms), which is
  acceptable for agent use.
- The launcher holds absolute paths. It is rewritten at each start, and
  packaging (child 8) points it into the app bundle.
- Rejected: a system `node` (may be missing or the wrong version); a compiled
  standalone binary (a new toolchain and about 50 MB).
