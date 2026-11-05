# OpenCode fixtures

Event shapes as OpenCode 2.0.20 sends them on `/api/event`, one JSON envelope per line
(`{ id, type, created, data }`). They are the shapes the old Grove tests in
`src/core/opencode/*.test.ts` were written against, copied here for the status replay.

These were not re-captured in the Slice 5 run: no live OpenCode was run. Re-capture them from a
real session before relying on a new OpenCode version.

`permission-run.jsonl` is a session that starts a turn, asks for a permission, has a subagent
created, gets the permission answered, sees another session start (ignored here), and ends.
