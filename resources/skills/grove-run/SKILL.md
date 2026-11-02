---
name: grove-run
description: Build an approved auto-flow plan one slice at a time, each slice in its own child Grove session in a shared worktree, unattended after a slice-1 review gate, with a final review (execution half of the grove auto flow). Load when the human wants to run, continue, resume or `--continue` a halted or stopped approved auto plan.
license: MIT
---

# grove-run

## Purpose

Execution half of the `auto` flow. The parent (this skill, run from the main
checkout) starts one child Grove session per slice in a worktree on branch
`feature/<slug>-<profile>` (profile `inherit` when none is active), starts it and
ends its turn until it reports, and checks the result in git. The human is
asked only after slice 1, after every slice with `--review-each`, and after
the last slice (continue, fix with a comment, or stop); other slices run
unattended. A profile (`--profile P` or the config's `profile`) sets
the agent and model per role (`references/roles.md`); the child is launched
as the `planner`'s agent with the `planner` model. `--continue` (parent mode only) resumes a stopped run per
`references/continue.md`. With `--slice N` the skill is the child: load
`references/slice-mode.md` and follow only it.

## When to use / not use

- Use after `grove-approve <slug> plan`. Re-invoking resumes: finished slices
  are found from `04-run.md` in the worktree.
- Do not use to change the plan, and do not run it without the Grove app.

## Inputs

`<slug> [--continue] [--profile P] [--review-each]` (parent mode) or `<slug> --slice N [--profile P]` (child
mode). `grove.config.json` (`artifactRoot`, `profile`, `profiles`).

## Preconditions & gates

Child mode: skip this section; follow `references/slice-mode.md`.

Parent mode, all required (`--force` is not available here):

- `grove.config.json` exists, is tracked (`git ls-files --error-unmatch grove.config.json`
  ok) and unchanged (`git status --porcelain -- grove.config.json` empty).
- `<artifactRoot>/<slug>/feature.md` has `flow: auto`.
- `01-outcome.md`, `02-research.md`, `03-plan.md` are all `status: approved`;
  otherwise stop and name `grove-approve <slug> plan`.
- `git status --porcelain -- <artifactRoot>/<slug>/ grove.config.json` is empty.
  If not, ask through the question tool whether to commit the folder and config
  together as `<slug>: approved plan`;
  commit on yes, stop on no. With `--continue` skip this question when the
  worktree for the run exists. Every other gate applies to `--continue` too.
- You are inside a Grove session: `grove ls --json` lists `$GROVE_SESSION_ID`.
  Otherwise stop: grove-run needs the Grove app.

## Process

1. **Resolve.** With `--continue`, follow `references/continue.md` instead of
   the rest of this step (never create a new branch with `--continue`). Resolve each role's agent and model per `references/roles.md` (`--profile P`, else
   the config's `profile`, else `inherit`); an unknown profile or an
   unsupported agent stops the skill. Plan commit =
   `git log -1 --format=%H -- <artifactRoot>/<slug>/03-plan.md`. Branch =
   `feature/<slug>-<profile>`; on resume `--profile` selects which run's branch
   (without it, the config's active profile, else `inherit`). **Stale** = the
   `Plan commit:` in the header of the worktree's committed `04-run.md` differs
   from the current plan commit, or `03-plan.md`'s `version` is newer than
   `04-run.md`'s `based_on`. A stale run is never resumed: start a new run on
   the next free `-2`, `-3` branch from the new plan commit. **Resume** = a
   worktree for that branch already exists (`git worktree list --porcelain`),
   is not stale and has a slice not done. If HEAD there is a halt commit
   (`<slug>: slice N halted`), do not start a child: stop with "Halted at slice
   N: options in <worktree>/<artifactRoot>/<slug>/04-run.md; run `grove-run
   <slug> --continue`". Use the `-2`, `-3` suffix only when the existing branch
   is stale, all its slices are done, or it has no worktree. Slices = the
   `### Slice N.` headings in `03-plan.md`. A slice is done when
   `git -C <worktree> show HEAD:<artifactRoot>/<slug>/04-run.md` has
   `## Slice N` with `Status: done` and a non-empty `Commit:` line, confirmed
   by a git log subject `<slug>: slice N — <outcome>` on the branch. Next = the
   first slice not done.
2. **Start the slice.** Label = `<name>-slice-<n>-a<k>`, where `<name>` is `<slug>` without its leading `yyyy-mm-dd-` date, and k = 1 plus the
   number of sessions in `grove ls --all --json` whose label starts with
   `<name>-slice-<n>-a`. Child prompt: "Load the grove-run skill and follow
   it exactly. Arguments: <slug> --slice <N> --profile <P>" plus the lines `Label: <label>`,
   `Parent: <id>`,
   `Roles: cto=<m|inherit> researcher=<m|inherit> planner=<m|inherit> reviewer=<m|inherit> implementer=<m|inherit>`
   and `Agents: cto=<agent> researcher=<agent> planner=<agent> reviewer=<agent> implementer=<agent>`
   (resolved, one token per role, in that order; a subagent role without
   `agent` gets the planner's agent, the planner without `agent` the parent's
   own agent), where id is the current value of `$GROVE_SESSION_ID` (expanded, no angle brackets or variable name in the prompt). Start the child without `--wait`.
   - No worktree yet (slice 1): `grove new <planner agent> --child --worktree --branch <branch> --base <plan-commit> --label <label> --link <slug> [--model <planner model>] --prompt "<child prompt>"`
     (`--link <slug>` links the child to the feature, so the app offers it as a
     send target for comments on the feature's artifacts)
   - Whenever the worktree exists (later slices, and every slice on resume,
     slice 1 included): the same without `--worktree`, `--branch`, `--base`,
     and with `--cwd <worktree>`. In both forms `--model <planner model>` is
     added only when the `planner` role has a model; omit it when it inherits.
   - After the first child creates the worktree, the parent finds its path as
     the `git worktree list --porcelain` entry for `<branch>` and uses it for
     later slices and `git -C <worktree>`.
3. **End the turn.** Final line: "Started slice N in <label>; it will report
   here". No background or unbounded `grove wait` loop (bounded `--timeout 600` calls only, see "A child's prompt"). The parent wakes when a message
   `SLICE n: done|halted — <one line>` arrives from the child (after a fix:
   `SLICE n: done — fixed: <line>`). `halted`: stop as in step 4, except a
   `halted` that answers a fix request (see step 5, fix with a comment).
   - **A child's prompt.** After starting a child, the parent does not end its turn at once:
     it runs `grove wait <label> --timeout 600` (one call, never in a background loop).
     Exit 0 or 124: end the turn as above (the report arrives as a message; on 124 with the
     child still working, wait once more; a second 124: end the turn). Exit 5: the child ended; go to the git check in
     step 4. Exit 4: the child is waiting on a permission or question; Grove holds it for a
     grace window (60 s by default) so the parent can deal with it. Follow "Answering a
     child's prompt" in the grove skill (`grove skill` prints it; it is the one source of the routine and never-answer lists): `grove read <label> --lines 40`,
     decide against the routine list there, re-read the screen right before sending, answer
     with `grove send <label> "<answer>"` only for a routine prompt you are sure of, and
     otherwise `grove escalate <label> "<one-line reason>"`. After an answer, wait again; after
     an escalation, end the turn and say which child needs the human (the human answers in
     that child; then they say "continue" here). Unsure means escalate. Never `send` to a child
     whose prompt you have not just read.
   - Silence: a child that never reports (crash, or a permission prompt that was escalated, shown
     as waiting in the sidebar) is seen by the human via the label. When the
     human says "continue" here and the child is waiting, say which child (name the label)
     to answer the prompt in, then say "continue" here or run
     `grove-run <slug> --continue`. When the
     human says "continue" here, check `git -C <worktree> log -1 --format=%s`,
     `04-run.md` and `grove ls` first: slice finished but report lost, go to
     step 4; child still waiting, tell the human to answer in that child and
     start nothing; child still working: say so, start nothing, end the turn;
     child gone with no matching commit: stop as in the git check. Never `send` into a child waiting on a prompt, except an answer to a routine prompt you have just re-read (see "A child's prompt"); never start a
     later slice without a report or a git-confirmed finish.
4. **Check in git.** `git -C <worktree> log -1 --format=%s` must equal
   `<slug>: slice N — <outcome>` and `git -C <worktree> rev-list --count
   <plan-commit>..HEAD` must equal N (one commit per slice), for every `done`
   report (first run, retry, `Decision:` child, fix); the message alone is never
   trusted. Otherwise:
   - HEAD subject `<slug>: slice N halted` (the halt commit; the report was
     `halted`, or HEAD says so after "continue"): stop with "Halted at slice N:
     options in <worktree>/<artifactRoot>/<slug>/04-run.md"; leave the child
     (<label>) running, no later slice starts. The human then runs
     `grove-run <slug> --continue`.
   - Any other mismatch, or a `halted` report without the halt subject: stop
     with "Slice N did not finish in <label>: see
     <worktree>/<artifactRoot>/<slug>/04-run.md"; leave the child running; the
     human decides (`grove-run <slug> --continue`). No retries.
5. **Gate.** The human is asked after slice 1 (always), after every slice
   when `--review-each` is given, and after the last slice (final review).
   Every other slice has no question: after the git check, `grove status <label> done`
   on the finished child (it stays open), start the next child (step 2) and end the turn (step 3). After each git-confirmed slice, also run `grove progress <own-id> <done>/<total>`.
   Slices 2..N then run with no human prompt. At a gate:
   - Show a summary in the format of the `auto` review gates section of
     `references/gates.md`: what was built, review verdict and fix rounds
     (from the slice's section in
     `git -C <worktree> show HEAD:<artifactRoot>/<slug>/04-run.md`),
     deviations, and where the diff is (the worktree project in the app, one
     click from the sidebar; not a link).
   - The slice-1 summary also lists the Bash command prefixes the parent needs
     allowed so later slices do not stall: `grove new`, `grove send`,
     `grove status`, `grove kill`, `grove ls`, `grove read`, `git -C <worktree>`. Say plainly
     that the run uses the human's own permission settings for the agent that
     runs it (Claude: a repo without pre-approved edits and project commands
     halts at the first prompt; OpenCode: its `permission` config, below), and
     that for the children it is the children's agent (the planner's) that
     matters, and that they can allow those prefixes ("don't ask again")
     before answering continue. In OpenCode, permissions come from the human's
     OpenCode `permission` config: the default allows edits and shell but asks
     for `external_directory` and `.env` reads, and an unattended run stops at
     any `ask`, so set `allow` for what the run needs (the `grove` and `git`
     commands, the project's commands). Grove never starts OpenCode with `--auto`,
     so only the `permission` config decides. A question in a child still halts
     the run (the question tool there is `question`).
   - Ask through the question tool, one question, options *continue*, *fix
     with a comment*, *stop* (last slice: *finish*, *fix with a comment*,
     *stop*). A one-slice plan has slice 1 as the last slice: its gate is the
     final one (finish / fix / stop) and still carries the slice-1
     permission-prefix note above.
   - **continue / finish**: `grove status <label> done` on the finished child
     (only now; never kill it). Continue: go to step 2 for the next slice and end the turn (step
     3). Finish: go to step 6.
   - **fix with a comment**: the comment is the question tool's other/free
     text; if empty, ask once more for it through the question tool. Then
     `grove send <label> "Fix slice N: <comment>"` to the live child (no
     `--wait`) and end the turn. The child amends its slice commit and
     reports `SLICE N: done — fixed: <line>`. On that report, check git again
     (step 4: HEAD subject still `<slug>: slice N — <outcome>`, and
     `git -C <worktree> rev-list --count <plan-commit>..HEAD` equals N, N being
     the slice number: one commit per slice; a fix amends, never adds a
     commit), then show the updated summary and ask the gate question again.
     If the child instead reports `SLICE N: halted — <reason>` in answer to the
     fix, the fix would have changed a Decision or the outcome, so nothing
     changed and the slice commit is still valid: do not go to step 4's "did
     not finish" stop. Show the one-line reason and ask the same gate question
     again (continue / fix with a comment / stop; finish / fix / stop on the
     last slice). A `halted` that is not an answer to a fix keeps the normal
     handling. The silence rule of step 3 applies.
   - **stop**: `grove status <label> done`, print where things are (worktree,
     branch, `04-run.md` in the worktree) and end.
6. **After the last slice.** Once its gate is answered *finish* and the child
   is marked done, print the hand-off as the final message:
   the worktree path and branch; that `04-run.md` lives there with its
   `## Final summary`; a ready-to-paste line with real values filled in,
   `grove new <the parent's own agent> --cwd <worktree> --prompt "/grove-approve <slug> run"`;
   and the steps after approval: commit the approved `04-run.md` on the run
   branch as `<slug>: approve run`, then merge or open a PR using the PR
   description from the final summary. The parent approves nothing.

**Abandoning a run.** When the human says to abandon the run, the parent
leaves the branch and worktree in place, prints `git worktree remove
<worktree>` and `git branch -D <branch>`, and runs them only if the human
picks that in a question-tool question. An abandoned run is never resumed. To
re-plan, the human runs `grove-auto <slug>`, re-approves with
`grove-approve <slug> plan`, and `grove-run` starts a new run on the next free
`-2`, `-3` branch from the new plan commit.

## Output

Commits on `feature/<slug>-<profile>` in the worktree: one per slice, including
`04-run.md`; at the end, the hand-off message naming `grove-approve <slug> run`.
The parent writes no files.

## Stop conditions

Failed precondition, an unfinished slice, the human choosing stop at a gate,
the last slice's gate answered finish, or the human abandoning the run.

## Rules

- Ask the human only through the question tool (`AskUserQuestion` in Claude, the equivalent in other agents), one question at a time, with the background and your recommendation; never as plain chat text. This includes approval prompts (offer *yes* and *not yet* as options).
- The parent asks only the commit-first question, the gate questions (slice 1, `--review-each` slices, final), the `--continue` run-choice question, the `--continue` option question and the `--continue` retry / leave-it question; every other slice runs with no prompt.
- The parent never edits files in the worktree.
- Never start a later slice on a broken base.
- Never mark a child done or kill it before its gate is answered; a finished child is marked done with `grove status <label> done`, never killed (`grove kill` is only for replacing a live idle child on `--continue` retry); never `send` into a child waiting on a prompt, except an answer to a routine prompt you have just re-read (see step 3, "A child's prompt").
- Name roles only; never model names.
- Only `grove-approve`, invoked by the human, approves. This skill approves nothing.
