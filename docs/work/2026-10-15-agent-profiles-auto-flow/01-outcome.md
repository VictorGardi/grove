# Outcome Brief: agent profiles and the `auto` flow

## Summary

You describe a feature once. The agents ask you only about the outcome, one question at a time with plain background, and then plan and implement it themselves. You review at three points: the outcome, slice 1, and the end. Which agent and model plays which role is a setting you change in `grove.config.json`, so you can try other setups without touching the workflow.

## What the human sees and does

1. You write the ticket and start planning with `grove-auto`. Researchers read the code first so the questions are informed.
2. The CTO asks you outcome questions, one at a time. Each gives the background, 2-4 options with what each does to the outcome, and a recommendation.
3. The CTO writes the Outcome Brief, plays it back in plain words, and you confirm or correct it in the same session. Planning does not go on until you confirm.
4. The planner drafts the plan and the reviewer critiques it. They loop up to 3 rounds. Anything still contested reaches you marked "agents disagree".
5. You see the plan: every technical decision with context, options, pros/cons, impact on the outcome and the agents' pick, then the ordered slices. You can veto any decision line by line. You approve the whole plan with one `grove-approve`.
6. You run `grove-run <slug>`. A parent session starts one child session per slice in one worktree, with one commit per slice. The children appear nested in the sidebar like any session group.
7. After slice 1, which is a thin end-to-end slice, the parent shows a summary (what was built, review verdict, deviations). The diff is one click away. You answer in plain words: continue, fix with a comment, or stop.
8. Slices 2..N run unattended. If you passed `--review-each`, you review after every slice instead.
9. If a slice fails after 2 fix rounds, or a fix would change the design or outcome, the child writes the options with pros/cons to `04-run.md`. The parent session then shows as waiting with a one-line message, such as "Halted at slice 3: options in 04-run.md". If a child hits a permission prompt, the run also stops and waits for you. Later slices never start on a broken base.
10. To resume, you read the options, tell the parent which to take, and run `grove-run <slug> --continue`. Your choice is recorded in `04-run.md`. If it would change the design or outcome, you are told the plan needs revising first. You can also abandon the run and re-plan.
11. At the end you see the whole run's summary and approve the result with `grove-approve`.
12. To try another setup, you edit the profiles in `grove.config.json` and run `grove-run <slug> --profile cheap`. `04-run.md` records the profile and the model each subagent ran with.

## Walkthrough scenario

You file a ticket: "add a dark-mode toggle to settings". You start `grove-auto`. After the researchers have mapped the settings code, the CTO asks: "Should the toggle follow the system theme by default, or start light?" You pick the recommended option. A second question covers whether the choice persists across restarts. The CTO plays back the brief: a toggle in settings, it persists, system default, and no per-window override. You confirm.

The planner and reviewer settle on a 3-slice plan. Slice 1 is a toggle that flips the theme and persists. The plan has one technical decision you veto: you don't like the stored-setting location and choose another. You approve the plan with `grove-approve` and then run `grove-run`.

Slice 1 finishes. You see the summary and the diff, and reply "continue". Slices 2 and 3 run while you are away. Slice 3 fails review twice, and the parent waits with "Halted at slice 3: options in 04-run.md". You open the file, reply "go with option 2", and run `grove-run <slug> --continue`. The run finishes. You review the summary and approve. Next week you run the same ticket with `--profile cheap` and compare the two `04-run.md` files.

## Non-goals

- Fully user-defined roles, custom role prompts, OpenCode support, an app-level orchestrator, a run UI, auto-start on approve, per-slice risk tagging, user-global profiles.
- Push or desktop notifications when a run halts or finishes.
- A settings screen or a point-and-click profile picker.
- Changing existing full/standard/small flows or finished features.

## How I'll know it works

- During planning, I am asked only outcome questions, one at a time, each with background, options with outcome impact, and a recommendation.
- Planning does not go on past outcome alignment until I confirm the played-back brief in the session.
- The plan I approve shows every technical decision with options and the pick, and I can veto each one.
- One `grove-approve` covers the whole plan, and nothing is approved without me invoking it.
- In every step of the flow, agents ask me through the question tool, never as plain chat text.
- `grove-run <slug>` needs no retyped prompt: it creates the worktree, the child per slice and one commit per slice.
- I am asked for review after slice 1 and at the end, and in between only when something halts, or after every slice with `--review-each`.
- A halted run shows as waiting in the sidebar with a one-line reason, the options are in `04-run.md`, and `--continue` resumes after I choose.
- A permission prompt in a child stops the run and waits for me, and no later slice starts.
- Changing a profile in `grove.config.json` and passing `--profile` changes which agents and models are used, and `04-run.md` shows the profile and models used.
- Existing features and flows behave as before, and an `auto` feature is still discovered by the app without card warnings.

## Constraints

- Start simple, add complexity only when needed, and leave no unnecessary technical debt.
- Claude only in v1, with a profile shape that does not block adding OpenCode later.
- No orchestrator in the app and no run UI. Visibility comes from the existing session tree and status.
- Only `grove-approve`, invoked by the human, sets approved status. There are two approval points: the plan bundle (before the run) and the finished run (after the final review, as today's `implementation` unit).
- Every skill in the flow tells agents to ask the human through the question tool (`AskUserQuestion` in Claude), one question at a time, never as plain chat text.
- Workflow says what and when and names roles only. Profiles say who. Skills never name models.

## Decisions taken in this interview

- Run visibility: the existing nested session tree plus a one-line message when the run halts or finishes. No push notifications.
- Permission prompts in unattended slices: the run halts and waits for the human.
- Review gates: a summary, the diff and a verdict, and the human answers continue, fix or stop. The final review approves the result.
- Trying other setups: edit profiles in `grove.config.json` and pick with `--profile`. No UI and no extra inspection command.
- After a halt: the human says in the parent session which option to take, then runs `--continue`. A choice that changes design or outcome sends the human back to revise the plan first. Abandoning and re-planning stays available.
