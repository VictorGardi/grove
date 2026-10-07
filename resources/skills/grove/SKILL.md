---
name: grove
description: Drive other Grove sessions from a Grove terminal or agent session with the `grove` command. Use to list sessions, start another Claude, OpenCode or terminal session in any folder, send it a message, read its screen, wait for it to finish, focus or kill it.
---

# grove

`grove` talks to the running Grove app. Inside a Grove session it is already on
`PATH`, and `GROVE_SESSION_ID` names your own session (`grove ls` marks it
with `*`). If the app is not running, every command exits 3 with
`grove: the Grove app is not running`.

A `<ref>` is a session's full id, a unique id prefix of at least 4 characters,
or its exact label. An unknown or ambiguous ref is an error (exit 1).

## Commands

```
grove ls [--all] [--json]            live sessions (--all: also ended ones)
grove new <opencode|claude|terminal> [--cwd DIR] [--prompt TEXT|-] [--label L]
          [--link SLUG] [--wait] [--timeout S] [--json]
                                     start a background session; prints its id
grove send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
                                     type text into a session and submit it
grove wait <ref> [--timeout S]       block until the session stops working
grove read <ref> [--lines N]         the last N lines of its screen (default 100)
grove focus <ref>                    show it in the app and raise the window
grove kill <ref>                     end it
grove skill                          print this file
```

`-` as the text or prompt reads stdin. `--cwd` defaults to your current
directory; the session lands under the project that contains it (a new folder
is registered as a project). `--link SLUG` pins the session to a feature of that
project and fails, creating nothing, if there is no such feature.
A prompt that starts with `-` must be written `--prompt=-text`.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | done; for `wait`/`--wait`, the turn finished |
| 1 | error: `grove: <code>: <message>` on stderr |
| 2 | usage error |
| 3 | the Grove app is not running |
| 4 | the session is waiting for the human (permission or a question) |
| 5 | the session ended |
| 124 | timed out (default 600 s) |

## Patterns

Hand work to a helper and wait for it:

```
id=$(grove new claude --cwd ~/git/other --label helper --prompt "run the tests and summarise failures" --wait)
code=$?
grove read "$id" --lines 60
```

Ask a running session something:

```
grove send helper "which files did you change?" --wait && grove read helper --lines 40
```

## Notes

- `wait` only follows OpenCode and Claude sessions. A terminal session has no
  status and fails with `no-status`; use `read` to look at it.
- `--wait` first gives the turn up to 30 s to start, then waits for it to end.
- `send` types into the session even if the human is looking at it, and resumes
  an ended OpenCode or Claude session first.
- `kill` can end any session, including your own. Kill only sessions you
  started, unless asked.
- A new Claude session in a never-trusted folder shows its trust dialog first;
  the prompt waits behind it.
