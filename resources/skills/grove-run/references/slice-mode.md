# grove-run: slice mode (child)

You are a child session started by `grove-run` with `<slug> --slice N --profile P`. You
play the `planner` role in your own session. Your cwd is the run worktree. Follow only
this file. The `04-run.md` layout is in `references/run-template.md`.

## Rules

- Never ask the human, not even through the question tool (`AskUserQuestion`, or `question` in OpenCode): a question in a child stops the run. If you are unsure or cannot finish, halt (see Halt). Tell every subagent the same.
- Plan the slice yourself, build it through `implementer` subagents, review it through a fresh `reviewer` subagent. Subagents never get the parent id and never run `grove send`.
- Never end your turn while a subagent is outstanding: await every one first.
- One commit per slice, plus the halt commit when you halt (see Halt). Never end your turn before the commit exists and the report is sent.
- Name roles only; never model names. Approve nothing.

## Steps

1. Read `<artifactRoot>/<slug>/03-plan.md`, `01-outcome.md`, and `04-run.md` if
   it exists. The label is on the `Label:` line and the parent id on the `Parent:` line of your prompt.
2. **Slice 1 only:** if an uncommitted `04-run.md` already exists (dead child), reuse it,
   never recreate it; otherwise create `04-run.md` from `references/run-template.md`,
   writing only the frontmatter, the header block and `## Open questions`; the
   later sections (`## Slice N`, `## Final summary`) are added when they are
   written, and placeholder text is never copied:
   profile (the `--profile` value of your prompt, `inherit` if none),
   branch (`git branch --show-current`), plan commit (`git rev-parse HEAD`),
   roles (the `Roles:` and `Agents:` lines of your prompt are `role=model` and
   `role=agent`; record each role as `- <role>: <agent>, <model or inherit>`).
   Use ONLY those two lines; never re-resolve the profile from config. End the file with
   `## Open questions`. If the project has no `node_modules` or similar and a
   documented install command exists (README, AGENTS.md), run it; if you cannot
   tell, continue.
2a. **Decision (resume after a halt).** Only when your prompt has a `Decision: <option
   title and text>` line or a `Retry: yes` line; otherwise skip (a halt commit at HEAD
   alone is not a trigger). You are the fresh child after a halt. If HEAD's subject is
   `<slug>: slice N halted`, run `git reset --soft HEAD~1` (the slice must end as exactly
   one commit that contains the note). Read `04-run.md` as it stands (do not recreate it;
   skip step 2 and step 3's append only for what already exists: a `Retry: yes` child may
   find no `## Slice N` or no `04-run.md`; then create it as usual). Under `## Slice N` add `### Decision` containing the
   line `Decision: <option title and text>` (for `Retry: yes`: `Decision: retry from the
   worktree as it stands`), keep `### Halt` and `### Options` as history, set `Status: in
   progress`, update `Session:` to your label. Then continue at step 4: plan and apply the
   choice on the worktree as it stands. An option that discards failing code discards
   source files only; never `git reset --hard` or `git checkout .` over `04-run.md` (it is
   staged after the soft reset and keeps Halt, Options and Decision). Fix rounds are
   counted afresh. If this attempt fails too, halt again (see Halt).
3. Append `## Slice N` (above `## Final summary` and `## Open questions`) with lines
   `Session: <label>`, `Status: in progress`, `Commit: this commit (see git log)`. A
   replacement child may find an uncommitted `## Slice N` (or, in slice 1, an uncommitted
   `04-run.md`) from a dead child: reuse what is there, never add a second section or
   recreate the file; update `Session:` to your label.
4. **Plan just in time.** Read the files the slice touches in the real code, then
   write `### Slice plan`: a `Found in the code:` paragraph, then for each
   `implementer` subagent a checkbox list of concrete steps with file paths, then a
   `Models passed:` line (role: model per subagent role you will use, `inherit` where so;
   update it if a role fell back to `general`).
   In OpenCode, once `Roles:` is read, run the generation recipe ("In OpenCode" in
   `references/roles.md`) in the run worktree before step 5.
5. **Build.** Delegate each chunk to an `implementer` subagent through the Agent tool
   (general-purpose subagent type; `model` = the implementer's value on the `Roles:`
   line, omitted when it is `inherit`); in OpenCode the `subagent` tool with
   `agent: grove-implementer` (`general` when it inherits or when the check in
   `references/roles.md` fell back), no model, per
   `references/roles.md`. Run independent chunks in parallel, on disjoint
   files. Each prompt carries the slice plan chunk, the files, the plan's Decisions
   that apply, and ends with "you cannot reach the human; return findings, never ask".
   Await all. Then run the slice's **Verification** from `03-plan.md` yourself. If it
   fails and you cannot fix it (through another implementer if needed), halt.
6. **Review.** Start a FRESH `reviewer` subagent through the Agent tool (general-purpose
   subagent type, `model` = the reviewer's value on the `Roles:` line, omitted when
   `inherit`); in OpenCode the `subagent` tool with `agent: grove-reviewer` (`general`
   when it inherits or when the check in `references/roles.md` fell back), no model, per `references/roles.md`. Give it the diff, the slice
   plan, the plan's Decisions and `01-outcome.md`; it returns blocking and non-blocking
   findings and cannot ask the human. Blocking findings get up to 2 fix rounds: an
   `implementer` fixes, you re-run Verification, a fresh `reviewer` re-reviews. If it still
   fails after 2 rounds, or a fix would change a plan Decision or the outcome, halt. Non-blocking findings: apply
   the cheap ones, list the rest under `### Review rounds`.
7. **Log** in the slice section: `### Review rounds` (one line per round: blocking
   findings, the fix, the result; then the verdict and fix-round count), `### Deviations` (anything built differently from the plan, or `none`),
   `### Verification` (what ran, the result, and which models were requested for each
   subagent role used), `### Left for the human` (manual or interactive checks from the
   slice text you could not run, or `none`). Tick the boxes, set `Status: done`.
   **Last slice only** (N is the highest `### Slice N.` heading of `03-plan.md`): also
   write `## Final summary` before `## Open questions`.
8. Commit the source and new files plus `04-run.md` (`## Open questions` last); never commit dependency or build directories (check `git status` first) with
   subject exactly `<slug>: slice N — <outcome>`, where outcome is the text
   after `### Slice N.` in `03-plan.md`.
9. **Report.** Last action, only after the commit exists and no subagent is outstanding:
   `grove send <parent-id> "SLICE <N>: done — <one line what was built>"`, then
   end your turn but stay alive for a fix. If halting: the halt commit exists, then
   `grove send <parent-id> "SLICE <N>: halted — <one line why>"` as the last action, then
   end. Never send before the commit (slice or halt) exists.

## Halt

You halt when you cannot finish: 2 failed fix rounds, a fix that would change a plan
Decision or the outcome, a Verification you cannot fix, or being unsure. Never ask
instead. Exception: a halt in answer to `Fix slice N` changes nothing and commits nothing
(see Fix after review).

1. Under `## Slice N` set `Status: halted` and add `### Halt` (reason, what was tried,
   number of fix rounds) and `### Options`: numbered, each as
   `#### Option <k>: <title>` followed by `Pros:`, `Cons:` and
   `Changes design or outcome: yes|no`. At least two options (for example a retry or
   alternative, and a stop or reset); say first which one you recommend. On a repeat halt
   (after a `Decision:`), rename the old sections `### Halt (attempt <n>)` and `### Options
   (attempt <n>)` first; only the latest un-numbered `### Options` is read by the parent.
2. `git add` only `04-run.md` (never the failing code, never dependency or build
   directories) and commit with `git commit -- <artifactRoot>/<slug>/04-run.md` (or check `git diff
   --cached --name-only` first) so nothing else staged goes in, subject exactly
   `<slug>: slice N halted`. The failing
   code stays uncommitted in the worktree. This also holds in slice 1, where `04-run.md`
   was just created. After a soft reset the halt commit goes on top of the previous
   slice's commit.
3. Make sure no subagent is outstanding.
4. Send `grove send <parent-id> "SLICE <N>: halted — <one line why>"` as the last action
   and end your turn. Never send before the halt commit exists.

## Fix after review

After your report the parent may send `Fix slice N: <comment>`. Apply it through an
`implementer` subagent (same subagent rules), re-run the slice's Verification, then
AMEND the slice commit: same subject, never a new commit, so the slice stays exactly one
commit. In `04-run.md` add a `### Fix after review` entry under the slice (the comment,
what changed, the Verification re-run); on the last slice keep `## Final summary` current.
If the fix would change a plan Decision or the outcome, or you are unsure, change nothing
and send `grove send <parent-id> "SLICE <N>: halted — <one line why>"`; the reason
says that the slice commit is unchanged and why nothing was changed (the parent treats
this as an answer to the fix, not a failed slice). Otherwise report
`grove send <parent-id> "SLICE <N>: done — fixed: <one line>"` and end your turn.
