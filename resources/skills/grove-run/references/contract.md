# Grove artifact contract

This is the single source of truth for artifact structure. It is copied
verbatim into every skill's `references/contract.md` by `scripts/sync-shared.sh`.
Do not edit the copies directly — edit this file and re-run the script.

## Feature folder

Every feature lives at `<artifactRoot>/<feature-slug>/` in the target repo
(default `artifactRoot`: `docs/work`).

**Feature slug:**
- `<TICKET-ID>-<kebab-name>` when a tracker ticket exists (e.g. `ENG-123-retry-queue`)
- `<YYYY-MM-DD>-<kebab-name>` otherwise (e.g. `2026-10-04-retry-queue`)
## Kind

`feature.md` may carry `kind: feature`; it is optional and the only value
(existing manifests without `kind` are features). Feature resolution (find a
slug → find its folder) is a flat scan of `<artifactRoot>/*/feature.md`.

## Flows

Every feature runs in one of four flows, recorded as `flow` in
`feature.md`. The flow decides which sessions run and where the human stops;
the artifacts and their format are the same in every flow.

| Flow | Sessions (each a fresh session) | Human stops |
|---|---|---|
| `full` | `grove-start` → `grove-design` → `grove-structure` → `grove-implement` | start (skim) → design → structure → each slice |
| `standard` | `grove-start` → `grove-design` (writes design **and** structure) → `grove-implement` | start (skim) → design + structure (one review) → each slice |
| `small` | `grove-start` (questions only) → `grove-implement` | questions → each slice |
| `auto` | `grove-auto` (outcome interview, research map, plan) → `grove-run` (hands off to an orchestrator session in the run worktree, which starts one child session per slice, one commit per slice) | outcome play-back → plan approval → after slice 1 (skippable with `--no-review`) → final review and run approval |

`auto` is never proposed by `grove-questions`: the human starts it with
`grove-auto`.

**Proposed flow.** `grove-questions` proposes a flow from its size verdict
and the human confirms or changes it:

| Situation | Proposed flow |
|---|---|
| size S | `small` |
| size M | `standard` |
| size L | `full` |

**Missing `flow`.** A `feature.md` without `flow` (or a feature with no
`feature.md` at all, from before it existed) is treated as `full` — the
behaviour every feature had before flows existed.

### Changing the flow

The human may change the flow at any time by asking; a skill may only
*propose* a change (e.g. `grove-implement` in `small` flow hitting a one-way
decision). On a change, the skill
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
| `feature.md` | grove-questions (flow changes append to `## Flow log`) | — (identity, not reviewed) |
| `00-ticket.md` | grove-questions (also via grove-start) | — (source snapshot) |
| `01-questions.md` | grove-questions (also via grove-start) | 2 min |
| `02-research.md` (+ `.html`) | grove-research, or grove-start via blind subagents (not in `small` flow) | skim, correct facts |
| `03-design.md` (+ `.html`) | grove-design (not in `small` flow) | careful, ≤ ~200 lines |
| `04-structure.md` (+ `.html`) | grove-structure (`full`); grove-design (`standard`) (not in `small` flow) | careful, ≤ ~2 pages |
| `05-plan.md` | grove-implement, one slice at a time, just before executing it | none — agent-facing, self-checked |
| `06-implementation.md` | grove-implement; approved by the human after the last slice (`grove-approve <slug> implementation`) | per slice |
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
static facts that identify the feature.

## `feature.md` frontmatter

Written by `grove-questions` when the feature folder is created; updated only
where noted.

```yaml
---
kind: feature             # optional (default: feature)
flow: standard             # full | standard | small | auto (missing = full); see "Flows"
created: 2026-10-04
---
```

`flow` is the one field that changes after creation without an approval:
see "Changing the flow". Every change is logged in the body's
`## Flow log`.

Existing features created before this field existed have no `feature.md`;
treat a missing file as `kind: feature`.

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
   validation, frontmatter, stale marking, ADR flips —
   lives in `shared/approve.md` (each skill's `references/approve.md`), used
   both inline at the end of a gated skill and by `grove-approve`.
9. **Asking the human.** Every skill asks the human only through the question
   tool (`AskUserQuestion` in Claude, the equivalent in other agents), one
   question at a time, with the background and a recommendation, never as plain
   chat text. Approval prompts included (options: yes / not yet).

## Per-repo config

Created by `grove-setup` at `<PREFIX>.config.json` (i.e. `grove.config.json`)
in the target repo root. See `shared/config.schema.json` for the schema.
