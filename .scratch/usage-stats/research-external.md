# Research: external docs and prior art

Source: research sub-agent, 2026-11-16. Secondary sources are marked.

## Claude Code (Anthropic docs, primary)

- Transcript format is not documented as a schema (https://code.claude.com/docs/en/claude-directory). Subagent transcripts sit in `projects/<project>/<session>/subagents/`.
- **Retention:** transcripts, subagent transcripts and tool results are deleted once older than `cleanupPeriodDays`, default 30 days, minimum 1. Claude Desktop and Cowork transcripts are kept unless `desktopSessionCleanupPeriodDays` is set. `stats-cache.json` ("aggregated token and cost counts shown by `/usage`") is kept until deleted. On this machine transcripts go back to May with no `cleanupPeriodDays` set, which contradicts a 30-day default: unresolved (see decision log).
- Built-in `/usage` (aliases `/cost`, `/stats`): session cost computed locally from token counts at list price (an estimate), plan usage limits (approximate, from local history on this machine only), activity stats.

## ccusage and similar tools (https://github.com/ccusage/ccusage)

- Dedupes Claude Code on message id + request id across sessions; without `requestId`, message id + session + timestamp. Keeps the most complete (last) duplicate: first-seen-wins undercounted 2-3x (issues #888, #901). Sidechain replay copies of a parent's message are dropped; sidechain responses with their own message ids are counted (#913). Upstream Claude Code issues report placeholder `input_tokens`, partial streaming `output_tokens` and no final stop event (user-filed).
- Cache creation and cache read are tracked separately. Cost modes: stored cost if present, else calculated from a price list by event timestamp. Timezone: configurable, grouping by local date; an invalid zone is rejected because falling back "can group usage under the wrong date".
- Views: daily, weekly, monthly, session, blocks (5-hour windows). Has separate adapters for Claude, Copilot, OpenCode.

## GitHub Copilot

- **Billing changed 2026-06-01:** usage-based billing with GitHub AI Credits (1 credit = $0.01); input, output and cached tokens all count, priced per model. Copilot CLI draws from the same credits. Legacy premium-request billing applies only to annual Pro/Pro+ plans that stayed on it. Under legacy rules each CLI prompt is one premium request (times the model multiplier), autonomous tool calls do not count. (https://github.blog/changelog/2026/04/27/github-copilot-is-moving-to-usage-based-billing/ and docs.github.com billing pages)
- `events.jsonl` has no documented schema. `/chronicle` and `session-store.db` exist. No automatic retention; `/session prune` and `/session delete-all` act on local sessions only.
- ccusage reads cumulative `session.shutdown` snapshots and differences them on resume; a crashed process loses its per-model calls. `totalNanoAiu` is the credit total.

## OpenCode (https://github.com/anomalyco/opencode)

- `opencode stats` aggregates `session_message` rows (tokens, stored `cost`, by provider/model/variant); its activity calendar counts assistant steps per day with Monday-first weeks and ranks levels over distinct non-zero daily values.
- Fork sessions copy parent rows (skip as inherited). The `claude-agent` provider runs Claude Code, which writes its own transcript, so a naive sum double counts. No special handling of the github-copilot provider documented.

## Contribution graph

- GitHub times contributions in UTC. A community answer (not labelled staff) says levels are quartiles of the user's own displayed days, after removing outliers; zero days excluded (third party). Not documented by GitHub.
- WCAG 2.2: 1.4.11 needs 3:1 for graphical objects; 1.4.1 forbids hue-only meaning. Vary lightness for sequential scales.
