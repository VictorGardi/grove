# 0049. The child-prompt hold and `grove escalate` are removed

Date: 2026-11-03

## Status

Accepted

Supersedes the parent-answers-first behaviour of the `grove` and `grove-run` skills: the 60-second grace window, `grove escalate` and the routine/never-answer lists.

## Context

A child session's permission request or question was held for a grace window
(60 s, `escalateAfterSec`) so the parent session could answer routine prompts or
call `grove escalate`. The hold delayed the human, `grove wait` needed a special
exit code 4, and handled prompts were recorded on the parent's card. In practice
the human answers these prompts anyway, and a parent guessing at permissions was a
risk with little payoff.

## Decision

- **A child's prompt reaches the human at once.** No grace window, no
  `escalateAfterSec`, no `held`/`handled` card fields.
- **The parent never answers a child's prompt.** It waits or reports; it does not
  `send` into a child that is waiting on one.
- **`grove escalate` is removed**, and every skill sentence mentioning it.
- **`grove wait` / `--wait` treats a child waiting on a prompt as still running.**
  Exit 4 is gone; exit codes are 0 done, 5 gone, 124 timeout, 1/2/3 as before.
- **`grove send` no longer sends or records a `from` field.** Plain send stays.

## Consequences

- The `grove` and `grove-run` skills lose the "Answering a child's prompt" section
  and its routine list.
- A run with a child blocked on a prompt waits for the human; there is no
  automatic answer.
