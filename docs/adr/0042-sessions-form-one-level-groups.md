# 0042. Sessions form one-level groups through a parent id

Date: 2026-10-12

## Status

Accepted

## Context

Driving a feature slice by slice starts a session per slice, and the Sessions tab fills
with unrelated-looking cards. The CLI already lets an agent start, wait on, read and
message sessions (ADR 0027), so a session can orchestrate others. What was missing was
any relation between them. The alternatives for automation (a trigger engine inside the
app) and for the relation (a separate depends-on edge beside parent/child) were
considered and left out.

## Decision

- **`Session.parentId`**, optional. Grouping only: no behaviour hangs off it. Automation
  stays an agent using the CLI.
- **One level deep.** A parent has no parent; a child has no children. Setting a parent
  resolves to that session's group leader, so a session started by a child is its
  sibling. A session with children cannot become a child (`is-parent`). The rules live
  in `shared/sessionGroups.ts`, used by core, the CLI server and the picker.
- **Not the default.** `grove new --parent REF` or `--child` (the caller's own
  `GROVE_SESSION_ID`); the card menu has Set parent… and Clear parent. The parent is
  resolved before a `--worktree` checkout is made, so a bad one creates nothing.
- **Drawn nested wherever it runs.** A child sits under its parent even in another
  project or worktree, which wins over project grouping. Only roots are grouped by
  project or status. A child whose parent is hidden or missing is drawn as a root.
- **Roll-up.** A collapsed parent shows the child count and the dot of its most urgent
  child (waiting, working, idle, running, gone), so a waiting child is never hidden.
  Collapse is `ui.collapsed` key `k:<parentId>`, expanded by default, dropped with the
  session.
- **Removal** promotes the children to top level, never cascades.
- **Drag** reorders within a level only: roots among roots, a child among its siblings.
  Regrouping goes through the picker.

## Consequences

- No migration: `parentId` is optional and absent means no parent.
- The `grove` skill gains Groups and Orchestrating sections, and an "Install Agent Skill…"
  menu action links it into `~/.claude/skills` (Claude Code) and `<XDG_CONFIG_HOME or ~/.config>/opencode/skills` (OpenCode).
- A workflow-aware slice orchestrator, which needs grove-workflow knowledge, belongs in
  grove-skills, not in the app.
