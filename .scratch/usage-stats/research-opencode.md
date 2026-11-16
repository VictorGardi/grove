# Research: OpenCode data and Copilot overlap

Source: research sub-agent, read-only, counts and field names only.

## Facts

- OpenCode history is one SQLite file, `~/.local/share/opencode/opencode.db` (204 MB), readable read-only with no service running. No pruning seen; history from 2026-04-22.
- Two table generations in the same db:
  - v1 `session` + `message` (2026-04-22 to 2026-05-27): assistant `data` has flat `providerID`, `modelID`, `cost`, `tokens{input,output,reasoning,cache{read,write}}`, `time{created,completed}`.
  - v2 `session_v2` + `session_message` (2026-04-22 to 2026-11-09): assistant `data.model{id,providerID}`, same `tokens`, `time`, `cost`. `session_v2.directory` gives the folder; join on `session_message.session_id = session_v2.id`.
  - The two overlap Apr 22 to May 27: pick one source or dedupe by id.
- Rows in progress or failed can lack `tokens` and `time.completed`: skip them.
- Copilot's provider id in OpenCode is `github-copilot` (from the cached models.dev catalog in `kv`). On this machine there are zero github-copilot requests; all 11,400 assistant messages are provider `opencode` (free hosted models), cost 0.0.
- Copilot CLI records live in `~/.copilot/session-store.db`, table `assistant_usage_events` (787 rows, 2026-10-22 to 2026-11-10; columns include model, input/output/cache/reasoning tokens, `total_nano_aiu`, `request_multiplier`, `initiator`, `created_at`), plus `session-state/<uuid>/events.jsonl`.
- Overlap: no shared record is expected. OpenCode calls the Copilot API itself, so the Copilot CLI store never sees those requests. The real risk is the opposite of double counting: Copilot-via-OpenCode usage is invisible in Copilot's own records. Not testable here (no such requests exist).
- OpenCode `cost` is computed locally from models.dev pricing; no premium-request multiplier or nano-AIU for OpenCode requests, so only tokens are known for them.

## Implication for "OpenCode silent, its Copilot requests counted under Copilot"

Needs a minimal OpenCode reader: open the db read-only, select assistant rows with providerID `github-copilot` (v2, and v1 only if old history matters), use tokens, time, model id and session directory, tag "via OpenCode". Everything else in OpenCode stays out. Smoke test needs a fixture.
