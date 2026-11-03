# 04-run.md template

When creating the file at slice 1, write only the frontmatter, the header block
(through `Roles:`) and `## Open questions`. The `## Slice N` and `## Final summary`
sections below are added when they are written; never copy their placeholder text.

```markdown
---
feature: <slug>
phase: run
status: draft
version: 1
created: <date>
updated: <date>
approved_at:
based_on: [03-plan.md@<version>]
forced: []
---

# Run: <feature title>

Profile: <profile or inherit>
Branch: <branch>
Plan commit: <sha>
Roles:
- cto: <agent>, <model or inherit>
- researcher: <agent>, <model or inherit>
- planner: <agent>, <model or inherit>
- reviewer: <agent>, <model or inherit>
- implementer: <agent>, <model or inherit>

## Slice <N>

Session: <label>
Status: <in progress | done | halted>
Commit: this commit (see git log)

### Slice plan

Found in the code: <what the real code looks like where this slice touches it>

Implementer 1:
- [ ] <concrete step, file path>

Models passed: <role: model, one entry per subagent role used, inherit where so>

### Review rounds

Round <r>: <blocking findings, the fix, the result> (one line per round)

<verdict>, <blocking count> blocking, <fix rounds> fix rounds. Non-blocking left: <list or none>

### Deviations

<anything built differently from the plan, or none>

### Verification

<what ran, the result, models requested per subagent role used>

### Left for the human

<manual or interactive checks from the slice text not run, or none>

### Halt

<only after a halt: reason, what was tried, number of fix rounds>

### Options

<only after a halt: at least two, recommended first>

#### Option <k>: <title>

Pros: <...>
Cons: <...>
Changes design or outcome: <yes | no>

### Decision

<only after a halt: written by the resuming child, containing the line `Decision: <option title and text>`>

Old halts are renamed `### Halt (attempt <n>)` and `### Options (attempt <n>)`.

### Fix after review

<only after a fix: the comment, what changed, the Verification re-run>

## Final summary

Written by the child that builds the last slice; kept current on a fix.

- Slice <N>: `<commit subject>`: <what was built>. Review: <verdict>, <fix rounds> fix rounds. Deviations: <list or none>.

### Left for the human

<checks the human still has to do, or none>

### PR description

<title>

<what changed and why, per slice; how it was verified; what is left for the human>

## Open questions
```
