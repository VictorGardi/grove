# Grove artifact contract

This is the single source of truth for artifact structure. It is copied
verbatim into every skill's `references/contract.md` by `scripts/sync-shared.sh`.
Do not edit the copies directly — edit this file and re-run the script.

## Feature folder

Every feature lives at `<artifactRoot>/<feature-slug>/` in the target repo
(default `artifactRoot`: `docs/work`). Epics use exactly the same layout —
an epic is a feature folder with `kind: epic`, living flat alongside its
children's folders, never nesting them.

**Feature slug:**
- `<TICKET-ID>-<kebab-name>` when a tracker ticket exists (e.g. `ENG-123-retry-queue`)
- `<YYYY-MM-DD>-<kebab-name>` otherwise (e.g. `2026-10-04-retry-queue`)
- **Epic children** insert their two-digit `order` after the prefix, so a
  directory listing sorts children in build order:
  `<TICKET-ID>-<NN>-<kebab-name>` or `<YYYY-MM-DD>-<NN>-<kebab-name>`
  (e.g. `2026-10-04-01-retry-queue-core`). `NN` is the child's `order` when
  its folder is created and is never renumbered afterwards — a child added
  on re-approval takes the next free number, even if it slots earlier in
  `children:`. `children:` and `order` stay the source of truth for order.

## Kind: epic vs feature

Every `feature.md` has `kind: feature` (the default — existing manifests
without `kind` count as features) or `kind: epic`.

- Only a `kind: feature` manifest may set `parent`. Epics never have a
  `parent` and never nest: an epic's children are always `kind: feature`,
  flat.
- An epic runs **Questions → Research → Design → Structure** only, at
  *system level*, always in `full` flow. `grove-implement` refuses to run on
  a `kind: epic` feature — see its own doc.
- A child (`parent` set) runs the normal phases in its own flow (default
  `standard`). It is a
  `kind: feature` feature in every other respect: same files, same gates,
  same approval mechanics. The only differences are that its research and
  design read the epic's artifacts first and work only on the gaps (see
  "Inheritance" below), and that its folder sits flat next to the epic's,
  not nested under it — feature resolution (find a slug → find its folder)
  is an unchanged flat scan of `<artifactRoot>/*/feature.md`.
- Status is never duplicated onto the epic. The epic's `feature.md` lists
  its children by slug only (`children:`); an epic's progress is always
  worked out by reading the children's own files (see `grove-epic-status`).

## Flows

Every feature runs in one of four flows, recorded as `flow` in
`feature.md`. The flow decides which sessions run and where the human stops;
the artifacts and their format are the same in every flow.

| Flow | Sessions (each a fresh session) | Human stops |
|---|---|---|
| `full` | `grove-start` → `grove-design` → `grove-structure` → `grove-implement` | start (skim) → design → structure → each slice |
| `standard` | `grove-start` → `grove-design` (writes design **and** structure) → `grove-implement` | start (skim) → design + structure (one review) → each slice |
| `small` | `grove-start` (questions only) → `grove-implement` | questions → each slice |
| `auto` | `grove-auto` (outcome interview, research map, plan) → `grove-run` (parent starts one child session per slice, one commit per slice) | outcome play-back → plan approval → after slice 1 → final review and run approval |

An epic is always `full` and stops after structure: its implementation
happens in its children. An epic is never `auto`. `auto` is never proposed by
`grove-questions`: the human starts it with `grove-auto`.

**Proposed flow.** `grove-questions` proposes a flow from its size verdict
and the human confirms or changes it:

| Situation | Proposed flow |
|---|---|
| epic (`kind: epic`) | `full` |
| child of an epic (`parent` set) | `standard` |
| size S | `small` |
| size M | `standard` |
| size L, not an epic | `full` |

**Missing `flow`.** A `feature.md` without `flow` (or a feature with no
`feature.md` at all, from before it existed) is treated as `full` — the
behaviour every feature had before flows existed.

### Changing the flow

The human may change the flow at any time by asking; a skill may only
*propose* a change (e.g. `grove-implement` in `small` flow hitting a one-way
decision, or an epic child outgrowing `standard`). On a change, the skill
writes the new `flow` to `feature.md` and appends one line to its
`## Flow log` body section (create the heading at the end of the body if
missing):

```markdown
## Flow log

- 2026-10-05: standard (proposed from size M, confirmed)
- 2026-10-09: standard → full — child needs 10 slices; human chose full over a split
```

Changing the flow never changes any artifact's `status` by itself. It only
changes which gates apply next (`references/gates.md`) — e.g. switching
`small` → `standard` means `grove-start`'s research, `grove-design`, and the
combined approval now come before `grove-implement` can continue.

## Files per feature

| File | Written by | Human review |
|---|---|---|
| `feature.md` | grove-questions (approval updates it for epics; flow changes append to `## Flow log`) | — (identity, not reviewed) |
| `00-ticket.md` | grove-questions (also via grove-start) | — (source snapshot) |
| `01-questions.md` | grove-questions (also via grove-start) | 2 min |
| `02-research.md` (+ `.html`) | grove-research, or grove-start via blind subagents (not in `small` flow) | skim, correct facts |
| `03-design.md` (+ `.html`) | grove-design (not in `small` flow) | careful, ≤ ~200 lines |
| `04-structure.md` (+ `.html`) | grove-structure (`full`); grove-design (`standard`) (not in `small` flow) | careful, ≤ ~2 pages |
| `05-plan.md` | grove-implement, one slice at a time, just before executing it | none — agent-facing, self-checked (epics: not produced) |
| `06-implementation.md` | grove-implement; approved by the human after the last slice (`grove-approve <slug> implementation`) | per slice (epics: not produced) |
| `01-outcome.md` | grove-auto (`auto` flow only) | plain-language Outcome Brief; the human reviews it at the play-back |
| `03-plan.md` | grove-auto (`auto` flow only) | Decisions + Slices; approved with the outcome and research (`plan` unit) |
| `04-run.md` | grove-run children (`auto` flow only); lives in the run's worktree on the run branch | after slice 1; approved by the human after the final review (`grove-approve <slug> run`, run from the run worktree) |

An `auto` feature has no `01-questions.md`, `03-design.md`, `04-structure.md`,
`05-plan.md` or `06-implementation.md`.

An approved `06-implementation.md` marks the feature **done**. Nothing else
does: a fully ticked `05-plan.md` only means the slices ran.

`.html` companions are generated only by `grove-render` and are never hand-edited.
`feature.md` is not a phase artifact: it has no `phase`/`status`/`version`
lifecycle of its own and is never approved or marked stale. It holds only the
static facts that identify the feature and, for a child, locate its epic.

## `feature.md` frontmatter

Written by `grove-questions` when the feature folder is created; updated only
where noted.

```yaml
---
kind: feature             # epic | feature (default: feature)
parent: ""                # feature only, child of an epic: the epic's slug
children: []               # epic only: ordered list of child slugs, written by grove-approve
appetite: ""               # epic: required. feature: optional free-text time budget
order: 0                   # child only: position in the epic's order (1 = walking skeleton)
flow: standard             # full | standard | small | auto (missing = full); see "Flows"
created: 2026-10-04
---
```

`flow` is the one field that changes after creation without an approval:
see "Changing the flow". Every change is logged in the body's
`## Flow log`.

Existing features created before this field existed have no `feature.md`;
treat a missing file as `kind: feature`, no `parent`.

### Shaping section (epic `feature.md` body only)

An epic's `feature.md` body must contain these headings, in order, checked
and filled in by `grove-questions`:

`## Problem`, `## Who it's for`, `## Success looks like`, `## Non-goals`,
`## Appetite`.

## Frontmatter (every phase artifact except `00-ticket.md` and `feature.md`)

```yaml
---
feature: ENG-123-retry-queue
phase: design            # outcome|questions|research|design|structure|plan|run|implementation
status: draft            # draft|approved|stale
version: 3               # bump on every substantive edit
created: 2026-10-04
updated: 2026-10-04
approved_at:             # set only by grove-approve
based_on:                # upstream artifacts and the versions read
  - 01-questions.md@2
  - 02-research.md@1
  - parent:02-research.md@3   # child only: the epic's artifact and version read
  - parent:03-design.md@2
forced: []               # reasons, if a gate was overridden with --force
repo_heads:              # 02-research.md only: VCS ref(s) read, e.g. git rev-parse HEAD per repo
  - abc1234
---
```

## `auto` flow artifacts

- `01-outcome.md` carries the standard frontmatter (`phase: outcome`,
  `status`, `version`, `based_on: []`, `forced`) and ends with an empty
  `## Open questions`.
- `03-plan.md` has `phase: plan` and `based_on` listing `01-outcome.md@<v>`
  and `02-research.md@<v>`.
- The `plan` approval unit (see `references/approve.md`) approves the three
  files at once.

## `05-plan.md`: one slice at a time

`grove-implement` writes the plan for **the next slice only**, just before
executing it, against the code as it is after the previous slice. The file
keeps the same frontmatter and grows by one `## Slice N — <outcome>`
section per slice, in order:

- Each section's steps are checkboxes (`- [ ]` / `- [x]`), ticked as they
  complete — this is what makes resuming from the file work in any session.
- `based_on` lists what the latest section was planned against:
  `03-design.md@<v>` and `04-structure.md@<v>` (`small` flow:
  `01-questions.md@<v>`). It is updated each time a section is added.
- `status: approved` is set by `grove-implement` itself once a section passes
  the self-checks (zero-context test, no new decisions, verification command
  present, no `TODO`/`TBD`), with a note in the body that this approval is
  automatic — the plan is mechanical once design and structure are locked.
  The plan is never shown to the human for approval.
- **Legacy plans.** A `05-plan.md` written in full up front (before this
  rule) stays valid: a slice that already has a section is reused after a
  drift check against the current code, and re-planned in place only if it
  drifted (see `grove-implement`).

## Decision ids

Every one-way decision an **epic** design makes gets a stable id (`E-D1`,
`E-D2`, …), assigned once in `03-design.md` and never reused or renumbered —
a later revision only ever appends the next id. A child's `04-structure.md`
scope and `03-design.md` lists which `E-D` ids it depends on, so stale
marking can target the children actually affected by a changed decision
(see "Inheritance" below). Decisions inside a normal (non-epic) design, and
a child's own decisions, are not ided — only epic-level decisions need a
stable cross-file reference.

## Inheritance (child of an epic)

- A child's `02-research.md` and `03-design.md` list the epic's artifacts
  they read in `based_on` as `parent:02-research.md@<version>` and
  `parent:03-design.md@<version>`.
- Epic-level decisions are **read-only** from inside a child: a child's
  research and design work only the gaps the epic didn't cover, and never
  re-decide or override an `E-D` id.
- If a child finds an epic decision wrong or missing, it stops — the issue
  goes into the epic's `03-design.md` `## Open questions`, the epic design
  goes back to `draft`, and staleness propagates to the affected children
  (see `shared/gates.md`). A child never silently overrides the epic.
- The same version-compare staleness rule (below) applies across the
  parent–child link: if a `parent:*` entry's version is behind the epic
  artifact's current version, the child skill must stop and warn before
  proceeding.

## Rules

1. **Precedence.** Later artifacts take precedence over earlier ones when they
   disagree. The current code is always the source of truth for *current*
   behavior — research describes what the code does today, not what any
   earlier artifact assumed.
2. **Edits invalidate downstream artifacts.** Editing an approved artifact
   resets its own `status` to `draft` and marks every downstream artifact's
   `status` as `stale`.
3. **Staleness warning.** Any skill whose input artifact has a version newer
   than what is recorded in `based_on` must warn the human and offer to
   revise before proceeding.
4. **Revise mode.** Every skill that writes an artifact supports revise mode:
   if the artifact already exists, read it plus any feedback (CLI arguments,
   or inline markers `> [!feedback] ...` or `<!-- feedback: ... -->` in the
   file) and update it in place rather than starting over. Bump `version`.
5. **Nothing lives only in chat.** Before ending any session, every decision
   made in that session must be written into the artifact.
6. **Open questions.** Every artifact ends with a `## Open questions` heading.
   It must be empty for the artifact to be approved.
7. **No placeholders in approved artifacts.** `TODO` and `TBD` block approval.
8. **Approval has one implementation.** Everything approval does —
   validation, frontmatter, stale marking, ADR flips, epic child creation —
   lives in `shared/approve.md` (each skill's `references/approve.md`), used
   both inline at the end of a gated skill and by `grove-approve`.
9. **Asking the human.** Every skill asks the human only through the question
   tool (`AskUserQuestion` in Claude, the equivalent in other agents), one
   question at a time, with the background and a recommendation, never as plain
   chat text. Approval prompts included (options: yes / not yet).

## Per-repo config

Created by `grove-setup` at `<PREFIX>.config.json` (i.e. `grove.config.json`)
in the target repo root. See `shared/config.schema.json` for the schema.
