# Claude status fixtures

These files are SYNTHETIC captures. They were written by hand from the documented Claude Code hook shape (the hook names, the payload fields, and the `notification_type` values in the upstream docs). They were NOT recorded from a real Claude run. No real session was captured for them, and the timings, tool names and screen text are invented.

Each `.jsonl` file is a spool as `hook.mjs` would write it: one line per hook call, `{ "event", "at", "payload" }`. The `.txt` files are terminal screen text as the holder would return it.

- `a-permission-answered.jsonl`: a permission ask. PermissionRequest, then the user approves in the terminal. Approval fires no hook, so the next record is the PreToolUse of the approved tool, then PostToolUse and Stop.
- `b-interrupted-turn.jsonl`: an interrupted turn. The user presses Esc during a tool run. Interrupts fire no hook (per the research), so there is no end record for the first turn; the state stays `working` until the next prompt. This is modelled without a Stop, deliberately.
- `c-esc-rejected-question.jsonl`, `c-esc-rejected-question.before.txt`, `c-esc-rejected-question.after.txt`: an Esc-rejected question. Notification (elicitation_dialog) raises a question; Esc fires no hook and the stream goes quiet. The two screens are the dialog before the Esc and the interrupted prompt after it.
- `d-background-task-turn.jsonl`: a turn woken by a background task. The first record is a PreToolUse with no UserPromptSubmit, then PostToolUse and Stop.

Replay tests live in `../replay.test.ts`. Do not treat these as evidence of real Claude behaviour; a recorded capture from a real run would replace them.
