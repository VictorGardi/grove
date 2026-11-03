# 0048. The epic concept is removed

Date: 2026-11-03

## Status

Accepted

Supersedes the group-feature parts of [0002](./0002-declarative-workflow-contract.md) (group completion) and [0018](./0018-project-page-replaces-board-mode.md) (Parent/Children on the feature page).

## Context

A feature kind could be marked `group: true` (grove's epic), with children found
through `parent_field`. The app drew a parent tag, breadcrumb segment and a
children list for it, and computed group completion. Epics in practice were shaped in
the workflow but built through child features, and the sidebar and project page no
longer have a place for them.

## Decision

- **The app no longer knows group kinds or epics.** No parent/children relation
  between features, no group completion, no Parent/Children on the feature page.
- **The workflow parser still tolerates and ignores `group` and `parent_field`** in
  workflow files, so existing `workflow.yaml` files keep loading.
- **`kind: epic` loads as an ordinary feature.**
- **Skill text drops the epic concept**: `contract.md` and `gates.md` lose the epic
  layout, `kind: epic`, `children`, `appetite`, `order`, `parent`, `E-D` ids,
  inheritance, the epic gate, rolling-wave warning and targeted stale marking. `AGENTS.md`
  loses the epic gate line and `grove.config.json` loses `epicMaxOneWayDecisions` and
  `epicMaxChildren`.

## Consequences

- The copies in `resources/skills/*/references/` are synced from the grove skills
  tooling (`scripts/sync-shared.sh` and the shared `contract.md`/`gates.md`, in the
  grove-skills checkout). The same edits must be made there, or the next sync brings
  the epic text back.
- Older ADRs keep their history; 0002 and 0018 carry a note pointing here.
