---
name: grove
description: Drive other Grove sessions from a Grove terminal or agent session with the `grove` command. Use to list sessions, start another Claude, OpenCode, Copilot or terminal session in any folder, send it a message, read its screen, wait for it to finish, focus or kill it.
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
grove new <opencode|claude|copilot|terminal> [--cwd DIR] [--prompt TEXT|-] [--label L]
          [--link SLUG] [--parent REF | --child] [--wait] [--timeout S] [--json]
                                     start a background session; prints its id
grove new claude --model ALIAS        start Claude with that model (an alias such as the ones `claude --model` takes)
grove new opencode --model PROVIDER/MODEL  start OpenCode with that model (provider/model, as `opencode models` lists them)
grove send <ref> <TEXT|-> [--no-enter] [--wait] [--timeout S]
                                     type text into a session and submit it
grove wait <ref> [--timeout S]       block until the session stops working
grove read <ref> [--lines N]         the last N lines of its screen (default 100)
grove focus <ref>                    show it in the app and raise the window
grove kill <ref>                     end it
grove status [<ref>] <value>         set a session's workflow status (default: your own session)
grove skill                          print this file
```

`-` as the text or prompt reads stdin. `--cwd` defaults to your current
directory; the session lands under the project that contains it (a new folder
is registered as a project). `--link SLUG` pins the session to a feature of that
project and fails, creating nothing, if there is no such feature.
A prompt that starts with `-` must be written `--prompt=-text`.
`--model` (claude, opencode and copilot; a usage error for terminal) starts the agent with that model.
Claude takes the alias `claude --model` takes; OpenCode takes `provider/model` and gets it through
its config env `OPENCODE_CONFIG_CONTENT`; Copilot takes the name `copilot --model` takes. Resuming the session keeps the model.

`--parent REF` puts the new session in REF's group in the sidebar; `--child`
means "in my group", taking your own `GROVE_SESSION_ID`. Without either, the new
session stands alone. Both fail, creating nothing (no worktree either), if the
parent does not exist. See Groups below.

`grove status` sets the manual workflow label shown on a session's card. `<value>` is one of
`backlog`, `in-progress`, `blocked`, `in-review`, `cancelled`, `done`, `pinned`; another value is a usage
error (exit 2). With one argument it sets your own session (needs `GROVE_SESSION_ID`); with two,
`grove status <ref> <value>` sets that session. Any session may set any session's status. It only
changes the label: nothing is started, stopped or cascaded. `grove ls` shows it in the WORKFLOW
column and `grove ls --json` as `workflowStatus`.

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

## Groups

A session can have a parent. The sidebar draws the children under it, wherever
they run (a worktree included), and a collapsed parent still shows its most
urgent child. Groups are one level deep: a session started by a child with
`--child` or `--parent <child>` lands beside that child, under the same parent,
and a session that has children cannot become a child. Removing a parent leaves
its children as top-level sessions. A human can also set or clear a parent from
a card's menu.

## Orchestrating

To drive a multi-step job (for example one slice of a feature per session), be
the parent and start each step with `--child`, so everything you started is
grouped under you:

```
id=$(grove new claude --child --label "slice 1" --prompt "implement slice 1 of docs/work/x/04-structure.md" --wait)
case $? in
  0) grove read "$id" --lines 80 ;;   # the turn finished: read what it did
  4) echo "slice 1 needs the human" ;; # a permission or question: stop and say so
  5) echo "slice 1 ended" ;;
  124) echo "slice 1 timed out" ;;
esac
```

- One step per session. Start the next only after reading the last one's result,
  and never start a step the human has not approved when the work has a gate.
- Exit 4 means a human has to answer in that session. Do not `send` around it
  and do not kill it: report it and wait for the human.
- Give each child a self-contained `--prompt`: it does not see your context.
- Use `--worktree --branch NAME` when two children could touch the same files.
- Do the small, read-only fan-out inside your own session with subagents. A
  session is for work the human may want to watch, review or resume.

## Notes

- `wait` follows Claude, OpenCode and Copilot sessions. A terminal session has no
  status and fails with `no-status`; use `read` to look at it. A Copilot card shows
  working, done and waiting on a shown permission prompt or question. It has no
  subagent marks: a background subagent still working after the turn ends shows
  as done, so `read` a Copilot session if its result looks incomplete.
- `--wait` first gives the turn up to 30 s to start, then waits for it to end.
- `send` types into the session even if the human is looking at it, and resumes
  an ended Claude, OpenCode or Copilot session first.
- `kill` can end any session, including your own. Kill only sessions you
  started, unless asked.
- A new Claude session in a never-trusted folder shows its trust dialog first;
  the prompt waits behind it.
