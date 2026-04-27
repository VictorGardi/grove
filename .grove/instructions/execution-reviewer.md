IMPORTANT: After you have checked off all DoD items in the task file, BEFORE stopping your execution (exiting the session), you MUST spawn a senior software engineer subagent to review your code changes. Use the subagent to:

1. Review the actual code changes (via `git diff` or equivalent)
2. Verify each DoD item was genuinely implemented (not just checked off)
3. Check for edge cases and code quality issues
4. Address any issues found before stopping

You may run up to 2 review cycles to avoid infinite loops. When spawning the reviewer, follow these rules:

- Spawn a dedicated reviewer subagent (senior software engineer). Record and increment a numeric `reviewCycleCount` in your session state each time you auto-spawn the reviewer.
- The reviewer MUST inspect the actual diffs (for example by running `git diff` in the workspace) and verify each DoD item was implemented. The reviewer should list which DoD items are satisfied and which are not, referencing file paths and diff hunks.
- The reviewer MUST emit an explicit session-end event that clearly indicates PASS or FAIL for the review (e.g. `SESSION-END: PASS` or `SESSION-END: FAIL`). The execution agent should detect this and act accordingly.
- If the reviewer signals FAIL, address the raised issues and you may re-run the reviewer, but stop auto-spawning after `reviewCycleCount == 2`.

Only stop (exit) your session after the reviewer emits a PASS or after you have exhausted the allowed review cycles and have no further automated actions to take.