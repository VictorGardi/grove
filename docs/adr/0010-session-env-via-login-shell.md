# 0010. Sessions get their environment from the user's login shell

Date: 2026-10-05

## Status

Accepted

## Context

A Finder- or Dock-launched app gets launchd's environment:
`PATH=/usr/bin:/bin:/usr/sbin:/sbin` and no `LANG`. A tmux server keeps the env of
the process that started it. A pane started with a command runs under a non-login
`sh -c`, so a bare `opencode` isn't found and OpenCode's tools miss the user's
`PATH` (nvm, mise, `.zshrc` exports). Every session-start path (new session, next
actions, resume) needs the same answer.

## Decision

The app gives tmux only a minimal env: its PATH plus fixed directories, used to find
`tmux`, and `LANG=en_US.UTF-8` if it is unset. It also strips any inherited
`TMUX`/`TMUX_PANE`. Each OpenCode pane runs
`$SHELL -l -i -c 'exec opencode …'`, and terminal sessions use tmux's login shell, so
each session gets the user's own shell environment, re-read at each start.

## Consequences

- Sessions match the user's terminal, and env edits apply to the next session without an
  app restart. The app parses no env, and app startup isn't slowed.
- Each session pays the user's shell startup time. A prompting rc file shows up in the
  pane before OpenCode starts, where it is visible and typeable.
- Commands must be shell-quoted by one tested helper.
- Rejected: fixed PATH augmentation only (the previous app's pattern), which misses
  version managers and `.zshrc` env; resolving the login-shell env once at app start
  (VS Code), which adds startup cost, parse and timeout logic, and stays stale until
  restart.
