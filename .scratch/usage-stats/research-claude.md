# Research: Claude usage data on disk

Source: research sub-agent, read-only, counts and field names only. Local times.

## Where the data is

- Transcripts: `~/.claude/projects/**/*.jsonl`, 1817 files, 1.58 GB (588 main sessions, 1229 subagent files under `<sessionId>/subagents/`). Earliest record 2026-05-19; no retention setting in `~/.claude/settings.json`, so the default applies and pruning is possible in principle (not confirmed). Use the record `timestamp`, not file mtime.
- `~/.claude/stats-cache.json` does not exist. `history.jsonl` and `sessions/*.json` carry no tokens.
- Grove's `~/.grove/agents/claude/<tabId>.usage.json` is one overwritten context snapshot (no output tokens, no history): not usable for statistics.

## Record shape

- Usage line: `type:"assistant"` with `message.usage{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`, `message.model`, `message.id`, top-level `requestId` (missing on 28 lines), `timestamp` (UTC ISO), `cwd`, `sessionId`, `isSidechain`, `entrypoint` (cli, claude-desktop, sdk-cli).
- A request is identified by `message.id` (+ `requestId`; one id never maps to two requestIds).

## Dedupe rules (verified)

- Raw lines are about 1.9x the unique requests (107,294 raw vs 56,023 unique). One line per content block of one response; `output_tokens` can grow across lines. Last line per key has the max in every case. Summing lines over-counts about 2x.
- Dedupe globally across files, not per file: 864 keys repeat across files (resumed or forked sessions copy history, same timestamps). Attribute to the earliest occurrence.
- Subagent (sidechain) records are real calls, not duplicates: include them (14,862 of 56,023 unique requests); tag by parent sessionId.
- Drop `<synthetic>` records (48, zero tokens) and `isApiErrorMessage` lines (32). Do not filter on `stop_reason`.

## In Grove or not

- Transcript lines carry no Grove marker. The marker is on Grove's side: a session is "in Grove" if its sessionId appears in `~/.grove/agents/claude/*.jsonl` (SessionStart payload `session_id`) or `*.usage.json`. 50 of 52 such ids match a main transcript.
- Not knowable for sessions before 2026-11-05 (Grove's tab files start then); those can only be "outside Grove / unknown". Tab files may be deleted when tabs are killed (untested). A session resumed in Grove can mix older outside-Grove records; record timestamp versus SessionStart time can split them.

## Cost

- Claude does record cumulative per-session cost: 547 `type:"cost-state"` lines with `totalCostUSD` and `modelUsage` per model (tokens + `costUSD`). Cumulative snapshots, latest per sessionId wins; not per request or per day. Usage lines themselves have no cost.

## Cost of scanning

- Full scan (parse only lines containing `"usage"`, dedupe, aggregate) about 14.4 s for 1.58 GB in Python. Incremental scanning is cheap: transcripts are append-only, keep a byte offset per file and a global seen-key set (about 56k keys); keep max `output_tokens` per key because re-read lines can be partial.

## Matrix metric

After dedupe, over 92 active days: cache reads are 97.7% of all tokens.
Spearman rank correlation: total vs fresh 0.921, total vs requests 0.951, fresh vs requests 0.956. Top-10 days: total vs fresh share 5, total vs requests share 7.
Total (with cache reads) tracks long-context many-turn days; fresh tokens and requests agree with each other and track activity. Example: 11-02 and 10-26 are #1 and #2 by fresh tokens but #3 and #10 by total; 09-02 and 09-07 are #4 and #8 by total but #24 and #27 by fresh.

## Space and hour

- Space is `cwd` on each record (356 distinct). `cwd` can change within a session; worktree sessions appear as a different cwd. The encoded project directory name is lossy: use `cwd`.
- Requests per hour peak 06:00 to 17:00 and 20:00 to 22:00.
