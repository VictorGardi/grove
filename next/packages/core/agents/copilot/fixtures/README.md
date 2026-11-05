# Copilot status fixtures

These files are the record shapes the old Grove Copilot tests used. The old tests name copilot 1.0.102 (hook payloads, `-p` runs), 1.0.103 (subagent hooks, Notification naming) and 1.0.105 (log records). They were NOT re-captured in this slice: no live run of copilot was made.

- `hooks-permission-turn.jsonl`: a spool as the hook command writes it, one `{ "t", "e" }` line per hook call, with `e.hook_event_name` stamped in. A prompt, a shown permission prompt, an allowed apply_patch (the tool result closes the prompt), and the end of the turn.
- `session-log-abort.jsonl`: Copilot's `session-state/<id>/events.jsonl` lines: a root turn start, then an abort (Esc), which no hook reports.

Tests in `../source.test.ts` copy these into a temp home. Do not treat them as evidence of a live Copilot run; a recorded capture would replace them.
