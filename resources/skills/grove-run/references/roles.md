# Roles and profiles

The auto flow names *roles*, never models. A profile in `grove.config.json`
says which agent and model plays each role.

## Roles

`cto`, `researcher`, `planner`, `reviewer`, `implementer`.

## Config shape

```json
{
  "profile": "default",
  "profiles": {
    "default": {
      "planner": { "agent": "claude", "model": "<alias>" }
    },
    "cheap": {
      "researcher": { "agent": "claude", "model": "<alias>" },
      "reviewer": { "agent": "claude", "model": "<alias>" }
    }
  }
}
```

Both keys are optional. A profile lists only the roles it wants to set.
`model` is a model alias for `claude` and `provider/model` for `opencode`,
passed unchanged; this file and the skills never name one.

## Resolving the roles

Do this once, before the first subagent or child session is started.

1. Active profile = the `--profile X` argument, else the config `profile`,
   else none.
2. No active profile: the profile name is `inherit` and every role inherits.
3. An active profile (from `--profile` or config `profile`) that is not in
   `profiles`, including when there is no `profiles` key: stop and tell the
   human which profiles exist (list the names, or say there are none).
4. A profile may not be called `inherit`, since that name is reserved: stop
   with a message saying so.
5. For each of the five roles: if the active profile has no entry for it, or
   the entry has no `model`, the role inherits. There is no fallback to
   another profile.
6. A role entry's `agent` must be `claude` or `opencode`; any other value
   stops with `agent <x> is not supported yet`. A missing `agent` on a subagent
   role means the agent of the session that spawns it; on `planner`, the agent of
   the running session. An entry that has an `agent` but no `model` still selects
   the agent, and the model inherits.
   Subagent roles (`cto`, `researcher`, `reviewer`, `implementer`) are played
   inside the session that spawns them: `grove-auto`'s own session, or the
   `grove-run` child, which runs as the `planner`'s agent (the parent's when
   the planner has none). So their `agent`, when set, must equal that
   session's agent; otherwise stop, naming the role and both agents. Only
   `planner` may name a different agent, since it is a child session started
   with `grove new <agent>`; in `grove-auto` the planner is the session itself, so
   a planner `agent` there is ignored (no relaunch). A profile targets one agent
   for each subagent role the session spawns, so their model strings are in that
   agent's format.
7. Otherwise the role's model is its `model` value, unchanged.

**Inherit** means pass no model: the role runs with the model of the session
that starts it. A child session started with a different agent than its parent
runs on that agent's own default model.

## Passing a resolved role

- **Subagent** (`cto`, `researcher`, `reviewer`, `implementer`), by the agent
  that runs it:
  - Claude: pass the role's `model` as the Agent tool's `model` parameter;
    omit the parameter when the role inherits.
  - OpenCode: see "In OpenCode".
- **Child session** (the `planner` of a `grove-run` slice): run
  `grove new <planner agent> ... --model <planner model>`; omit `--model` when
  the planner inherits. Both `claude` and `opencode` accept `--model`. The child learns each role's
  agent from the `Agents:` line of its prompt.
- **Your own session** (`grove-auto`, the `grove-run` parent) keeps the model
  the human started it with; it never relaunches itself.

The model is requested, not verified: the skill cannot confirm what the
runtime actually used.

## In OpenCode

`AskUserQuestion` means the `question` tool. The Agent tool means the
`subagent` tool with `agent`, `description` and `prompt`; its calls take no
model. A subagent's model comes from its agent file, so the skill writes one
per role, once, after resolving the roles and before the first subagent:

1. First delete any existing `.opencode/agent/grove-*.md`, so a profile switch
   leaves nothing stale. Then, for each subagent role the session spawns that has a resolved model (for `grove-run`'s child, the `Roles:` line of its prompt), write
   `.opencode/agent/grove-<role>.md` in the session's working directory:
   frontmatter `description` (one line naming the role), `mode: subagent`,
   `model: <role model>`; body one line: you play the `<role>` role, follow the
   task prompt, you cannot reach the human. `grove-` is a reserved
   prefix for these files.
2. Add the line `.opencode/agent/grove-*.md` once (no duplicates) to the file
   printed by `git rev-parse --git-path info/exclude`, creating or appending
   through the shell (`printf`/`grep -qxF … || echo … >>`), not the edit tool: in a
   linked worktree that file is in the main checkout, outside the working
   directory, and the edit tool would hit the `external_directory` ask,
   so the files are never committed and `git status` stays clean. `.git/info` may
   need creating.
3. `opencode debug agents` reads a shared service that notices file changes
   late: a new file can be missing, or a changed `model` show the old value, for
   a few calls. Poll it about once a second, up to about 10 tries, until every
   generated `grove-<role>` is listed with the model that was written (in the
   JSON, `model` is an object: compare `model.providerID` + `/` + `model.id`) (a stale
   file in a parent directory can also be listed; OpenCode loads agent files
   from parent directories too). An agent whose `model` is not in
   `provider/model` form is silently left out of the list, which this check
   catches. A role still missing, or listed with a different model, after the
   polling uses the built-in `general` agent instead (the session's model), and
   the skill says so.
4. Spawn with the `subagent` tool and `agent: grove-<role>`. A role that
   inherits, or that step 3 left on `general`, uses the built-in `general`
   agent, which runs on the session's model; say so in the skill's output (the
   run log, for `grove-run`).

The model is requested, not verified, as in Claude.
