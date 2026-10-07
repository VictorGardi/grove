# 0029. Sessions store their own working directory and take their first prompt at launch

Date: 2026-10-07

## Status

Accepted

## Context

`grove new` may start a session in any folder, registering it as a project
if needed (product answer). Until now a session always started, and resumed,
in `project.path`. Agents started by the CLI also need an initial prompt.
Both TUIs accept one at launch: `opencode --prompt` and Claude's positional
`prompt`.

## Decision

- **Project:** core picks the registered project with the longest path
  containing the requested folder. If none contains it, core registers the
  folder's git top level, or the folder itself outside git.
- **cwd:** `Session.cwd` (`null` = the project path) is persisted. This bumps
  the state file to v4, and `v3ToV4` sets `cwd: null`. Create and resume both
  use it.
- **First prompt:** passed through `AgentSource.argv(id, mode, {prompt, name})`
  on the launch command line. A terminal session gets it through the send
  path once its pane is stable.

## Consequences

- Subfolders don't each become a project. A resumed session returns to its
  own folder.
- A v4 state file can't be read by older builds; it is moved aside.
- Rejected: registering every folder as its own project (clutters the
  Projects tab); pasting the first prompt after start (racy, and it needs a
  readiness wait for agents that accept it at launch).
