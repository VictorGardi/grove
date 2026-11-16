# Research: what in Grove constrains a usage panel

Source: research sub-agent, file references from HEAD 4efc9bf.

## Wiring a dock panel

- A panel is a `DockModule` (`packages/ui/modules.ts:40-48`), registered in `packages/ui/main.ts:248-282` with deps as closures over `bridge.rpc`. Adding one also touches: the `KeyAction` union (`packages/protocol/messages.ts:185-212`), `KEY_ACTIONS` + default binding + description in `packages/core/config/schema.ts`, key labels in `packages/ui/keys-panel.ts:8-36` (type-forced), the handler map in `main.ts` (~358), and a name in `packages/ui/icons.ts:5` `ICON_NAMES`.
- Host events are only `activeTabChanged`, `agentStateChanged`, `connectionChanged`. No event for spaces changing or a day boundary. The diff panel pattern is "the core does not push; the window asks again".
- Protocol: request methods in `METHODS` + `MethodMap`, notifications in `NotificationMap`, core dispatch is an if-chain in `packages/core/daemon.ts` with hand validation. Panels take a `*Deps` interface so tests fake it.

## Reading files in core

- Core is one Node process (v26.13), no worker threads anywhere. All existing reads are synchronous `fs` calls on the single event loop, each a bounded delta or a 1 MB cap. A blocked event loop stalls window RPC, status/context/name broadcasts, git and presence polls.
- Existing conventions: poll helper in `agents/usageSource.ts`, busy guards, fail soft (no value on unreadable), `console.error('core: <what> failed: <message>')`.
- The session-search proof of concept scanned the same Claude files in a separate process: full build 5.5 s, unchanged re-run about 0.1 s (mtime + size per file). It uses `node:sqlite`, which is not used anywhere in `packages/` yet. It skips subagent transcripts and does not read token fields.
- Data sizes on this machine: Claude 1.6 GB (578 top-level + 1,217 subagent files), Copilot 69 MB.

## Spaces and folders

- A Space maps to a session folder only by exact path match; no code matches by prefix or git toplevel. A worktree space's `parent` comes from `SpaceInfo.parent`. A folder with no Space has no representation (only `path.basename` or git repo name could name it). A tab's folder can differ from its space root. Two spaces can share a path.
- A usage panel "where it went" by space therefore needs a new rule for sessions whose folder matches no space (scratch dirs, deleted worktrees, `~`).

## Run in Grove or not

- Grove sets `GROVE_TAB`, `GROVE_HOME`, `GROVE_CONFIG` on every tab. `TabRecord` stores `agentSessionId`, but tab close removes the record and `/clear` overwrites the id. Nothing keeps past session ids that ran in Grove, apart from Grove's own per-tab hook files that survive until removed.

## Persistence

- `~/.grove/` holds state.json, config, notes, agents/<kind>/<tab>.*. `atomicWrite` (temp + rename, mode 0o600) exists. There is no cache for derived history. Window-side prefs use `persistedPref`.
- ADR 0002 names "an index in `~/.grove`" as the shape of a future session search and says it "would need its own decision". The session-search brief is still undecided.

## Language and decisions

- The glossary has no entry for usage statistics, totals, tokens or history. It never uses bare "usage"; its term for the existing thing is Context level. The code uses "usage" for the context reading (`usageSource.ts`, `ContextUsage`, `*.usage.json`, `GROVE_USAGE`). A new feature called "usage" would share the word with these.
- ADR 0001 (git reads) and ADR 0002 (session names) do not forbid this. No ADR or glossary conflict, but ADR 0002 says the history reader and index need their own decision.

## Tests

- Vitest; core agent tests use temp dirs, injected paths and clocks, `drain()` on sources. UI model tests are pure functions. Panels take fake `*Deps`. `packages/ui/literals.test.ts` may constrain UI strings (not opened).
