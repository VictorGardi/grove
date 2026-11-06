---
feature: 2026-10-15-opencode-support
phase: research
status: draft
version: 1
created: 2026-10-15
updated: 2026-10-15
approved_at:
based_on: []
forced: []
---

# Research: OpenCode as seen by the installed binary

Facts only. Every OpenCode fact below was checked against the installed binary on 2026-10-15
(`opencode --version` → `opencode v2.0.20`, `/opt/homebrew/bin/opencode` → Homebrew Cellar 2.0.20,
a single Mach-O binary with the JS bundled; `strings` on it was used to read the bundled source).
No OpenCode docs were used.

## Launch and model flags

- `opencode --help`: the default command (the TUI the app launches today) takes only `--standalone`, `--server`, `--auto`, `--continue/-c`, `--session/-s`, `--prompt`, plus `[<directory>]`. No `--model`, no `--agent`.
- `opencode -m opencode/big-pickle` → `ERROR Unrecognized flag: -m in command opencode` (prints the help). So D2's `-m` does not exist on the default command.
- `opencode mini --help` (the "minimal interactive interface") takes `--standalone`, `--server`, `-c`, `-s`, `--fork`, `--replay`, `--replay-limit`, `--model/-m` ("provider/model"), `--agent`, `--prompt`. It has no `--auto`.
- `opencode run --help` takes `--model/-m` ("provider/model#variant"), `--agent`, `--format default|json`, `--auto`, `-s`, `--continue`, `--fork`, `--file`, `--title`, `--thinking`, `--standalone`, `--server`.
- `opencode mini -s <ses_…> -m opencode/space-bunny-free --prompt 'Reply with the single word pong'` run in tmux: banner `oc mini v2.0.20`, footer `Build · Space Bunny Free [max] · … · OpenCode`, the model answered `pong`; `opencode session list` then listed the session id that had been minted with the app's `mintSessionId` format. So `mini` creates the session when `-s` names one that does not exist, and honours `-m`.
- `opencode --server http://127.0.0.1:1 mini -s ses_x -m …` → `ERROR Unrecognized flag: --server in command opencode mini` (`mini --help` after the same prefix only prints help, which hides it). `opencode mini --server http://127.0.0.1:1 -s ses_x -m …` parses (then `Could not reach server`). Root flags do not carry into a subcommand. The sandbox wrapper `withServer` (`src/core/sandbox/launch.ts`) put `--server` right after the binary; for `mini` it must go after `mini`.
- A model that is listed but not usable shows `Model unavailable: opencode/exo-free` in the mini transcript (nothing else breaks).
- Model strings are `provider/model` (`opencode models` lists them, e.g. `opencode/big-pickle`, `opencode/space-bunny-free`).

## Config and the shared service

- Config sources (`opencode debug config`): `~/.config/opencode/opencode.json` plus project files; the bundle also lists `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_PROJECT_DISABLE`.
- `OPENCODE_CONFIG_CONTENT='{"model":"opencode/exo-free"}' opencode` (TUI, in tmux): the footer still showed `Build · Space Bunny Free OpenCode`. The client's environment does not reach the shared background service that resolves config, so an env-var route cannot set the model of an app-launched session.
- The TUI picks its model in this order (bundled source): `--model` arg of the command (only commands that have one), agent's configured model, the config `model`, `model.json` in the state dir (`recent`), first available.
- The user's config here is `{"permission":{"doom_loop":"allow"}}`; the permission keys the schema knows: `read edit glob grep list bash task external_directory question webfetch websearch lsp doom_loop skill`, each `ask|allow|deny` (or a pattern map); a top-level string sets all.
- `opencode --auto` (default command) and `opencode run --auto`: "Auto-approve permissions that are not explicitly denied".

## Agents (subagents) and their models

- Agent files: bundled loader patterns `{agent,agents}/**/*.md` (subagent unless `mode` says otherwise) and `{mode,modes}/*.md` (primary), under a config directory; the project's `.opencode/` is one.
- AgentConfig fields (bundled schema): `model` ("provider/model"), `variant`, `temperature`, `top_p`, `prompt`, `tools` (deprecated), `disable`, `description`, `mode` (`subagent|primary|all`), `hidden`, `options`, `color`, `steps`, `permission`. In a markdown file the body is the prompt.
- `opencode debug agents` in a directory without agent files lists `build`, `compaction`, `plan`, `summary`, `title` (primary) and `explore`, `general` (subagent). Run from the repo root it also lists a `.opencode/agent/*.md` file.
- Experiment, in a scratch git repo: `.opencode/agent/grove-reviewer.md` with frontmatter `description`, `mode: subagent`, `model: opencode/big-pickle`; `opencode run --format json -m opencode/space-bunny-free "Use the grove-reviewer subagent to review the sentence 'hello'. Report its answer."`:
  - the parent called a tool named `subagent` with input `{agent: "grove-reviewer", description, prompt}`; its output was `<subagent sessionID="…" state="completed">…</subagent>`;
  - `opencode session export <id>` shows the parent session on model `space-bunny-free` and the subagent child session (`agent: grove-reviewer`) on `big-pickle`. A subagent's model therefore comes from its agent file, with no per-call model.
- Inherit, verified on a later run (parent `-m opencode/big-pickle`): a subagent from an agent file with no `model` line, and the built-in `general` subagent, both ran on `big-pickle`, the parent's model (`opencode session export <subagent sessionID>`).
- Subagent tool name: the TUI normalises `task`→`subagent`, and its inputs `agent` or `subagent_type` are read; in 2.0.20 the tool seen on the wire is `subagent`.

## The question tool

- The bundled TUI renders a tool named `question` with input `{questions: [{header, question, options: [{label, description}], multiple, custom}]}`; the session shows attention `question` while a form is pending. The `question` permission key exists (`ask|allow|deny`).

## The app today (this worktree)

- `src/cli/args.ts`: `KINDS = opencode|claude|terminal`; `--model` accepted for `claude` only (`kind !== 'claude'` → `UsageError('--model only works with claude')`); `USAGE` documents `grove new claude --model ALIAS`.
- `src/main/cliServer.ts:82-83`: the same rule server side (`bad-params`).
- `src/core/core.ts:828` sets `launchModel` on the session; `:830`/`:898` pass `{ model }` to `source.argv(id, 'start'|'resume', …)`; `src/shared/types.ts:28` documents it as claude's.
- `src/core/claude/hooks.ts:50-54` (`claudeArgv`) adds `--model` on start and resume.
- `src/core/opencode/client.ts:73` `argv(id, _mode, opts)` ignores `opts.model`: `['opencode','-s',id, ...('--prompt' …)]`; `client.test.ts:94-95` pins that.
- `src/core/sessionCreate.test.ts:46` pins `exec opencode -s ses_… --prompt 'say hi'`; `:333` pins the sandboxed form `opencode --server http://… -s ses_…`.
- `resources/skills/grove/SKILL.md:23,38` documents `--model` as claude only.
- Skills repo `~/git/grove-skills`: `shared/roles.md` (resolution step 6 rejects `agent` ≠ `claude`; passing: Agent tool `model`, `grove new claude --model`); `skills/grove-run/SKILL.md` step 2 launches `grove new claude --child …`; `skills/grove-run/references/slice-mode.md` (child rules use `AskUserQuestion`, Agent tool); `skills/grove-auto/SKILL.md` names the Agent tool and `AskUserQuestion`; `scripts/validate.sh` requires `AskUserQuestion` in every skill.

## Open questions
