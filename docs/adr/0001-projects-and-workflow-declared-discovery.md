# 0001. Projects in app config, feature discovery declared in workflow.yaml

Date: 2026-10-05

## Status

Accepted

## Context

The grove app groups everything (sessions, features, links) under projects:
registered repo folders. It must find each project's features. The app's code
is required to be workflow-agnostic: swapping in a different workflow must need
only a new `workflow.yaml`. Grove's own layout (`grove.config.json` →
`artifactRoot`, `*/feature.md`) is one workflow's convention.

## Decision

Projects are stored in the app's own config as `projects: [{ id, name, path }]`
with a stable uuid `id`. Where a project's features live is declared in
`workflow.yaml` under `discovery` (`manifest`, and `root` as either a literal
path or `{ from_file, key, default }`). The app code contains no grove file
names. One global `workflow.yaml` applies to every project.

## Consequences

- A different workflow tool, or a future hub, is a yaml change, not a code
  change. A grep for `grove.config` or `feature.md` in the source should come
  back empty.
- Projects without a config file or feature root still host sessions; the app
  watches for the config file appearing and starts discovery then.
- Rejected: hardcoding grove's file names (simpler by a few fields, but breaks
  the "only a new yaml" promise); auto-detecting projects by scanning a
  workspace root (can't include non-grove repos or curate the list).
