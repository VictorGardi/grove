# 0002. Declarative workflow.yaml with a fixed predicate set

Date: 2026-10-05 (amended 2026-10-05: `flows` axis; amended 2026-10-05: group completion and `active`)

## Status

Accepted

## Context

All workflow knowledge (stages, kinds, actions, completion rules) must live in
one `workflow.yaml`; the app's code may not name any workflow's phases. The
board is derived from files, never dragged. Grove needs: approval-gated stages,
soft and forced gates (a later artifact can exist while an earlier one is a
draft), a `stale` status, epics that run only some stages, parent/child
grouping, and implementation completion via ticked plan checkboxes. Grove
also has a `flow` (`full|standard|small`, missing = `full`) in the same
`feature.md`; `small` writes no research, design or structure, so a
feature's stage list depends on its flow as well as its kind.

## Decision

`workflow.yaml` is declarative: `discovery`, `kinds` (field, default,
`parent_field`, per-kind `group` and stage list), `flows` (same shape as
`kinds`: field, default, per-value stage list), ordered `stages` (`id`,
`label`, `artifact`, optional `review`, `complete_when`), optional `flags`,
`actions` and `stage_actions`. `complete_when` uses exactly four predicates:
`exists`, `field equals`, `field in`, `all_checked <file>`. A feature's
effective stages are those in both its kind's and its flow's list, in
`stages` order; a missing flow value uses `default`, an unknown one uses
`default` with a card warning. Over the effective stages, the current stage
is the first incomplete stage, where a stage also counts as passed if any
later stage's artifact exists (marked "unapproved" on the timeline). Card
states (`backlog`, `running`, `waiting`, `needs-review`, `ready`, `active`,
`done`) are a fixed generic set computed in code. A group kind is `done` only
when its own effective stages are complete and every child (by
`parent_field`) is `done`; until then, with its own stages complete, it is
`active` and shows how many children are done. A group with no children is
done by its own stages.

## Consequences

- Stage and card-state derivation are pure functions over parsed frontmatter,
  fully unit-testable, with clear validation errors.
- A workflow needing logic beyond the four predicates requires extending the
  vocabulary in code (additively, without breaking existing files).
- Stages a feature's flow skips are absent from its timeline, never shown as
  "unapproved" passes. A third stage-selecting field would need another axis
  in code.
- Rejected: an expression language (new dependency, worse errors, unneeded
  power); a workflow-supplied JS module (arbitrary code in main, no
  validation); ordered first-match profiles over manifest fields (more
  general, but order-dependent and a bigger reshape of `kinds`); a per-stage
  `skip_when` (flow meaning scattered across stages, two mechanisms for one
  job); a group reading `ready` with a progress count, or mirroring
  its busiest child, while children are unfinished (`ready` would mean two
  things; the busiest child is already visible beneath it).
