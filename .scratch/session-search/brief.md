# Session search: proof of concept (Claude only)

Status: needs-triage

## Why
We may add "search the conversation history of every agent session" to Grove: a local index over the agents' own transcripts, used
by (a) a Go to search, (b) a `grove search` CLI that agents can call, later (c) cross-agent recall. Before any design or ADR we need
evidence that search over the real data finds the right session. This POC answers one question:

**On the user's real Claude sessions, does full-text search put the right session in the top 10 for "why did we decide X"-style
queries?**

Do not build app features. Do not touch app code under `packages/`. Throwaway code only, under `.scratch/session-search/poc/`.

## Data (verified on this machine, 2026-11-15)
- `~/.claude/projects/<encoded cwd>/<session id>.jsonl`: about 1,800 files, about 1.6 GB, 66 project folders. One JSON record per line.
- Record `type`s that matter: `user`, `assistant`, `custom-title` (`customTitle`), `agent-name` (`agentName`), `ai-title` (`aiTitle`).
  Others (`file-history-snapshot`, `mode`, `permission-mode`, ...) are noise.
- `user` / `assistant` records: `message.content` is a string or an array of parts. Index only `text` parts. Skip `tool_use`,
  `tool_result` and `thinking` parts (bulk, noise). Skip records with `isSidechain: true` (subagent conversations) and `isMeta: true`.
  User text starting with `<` is a slash-command or hook wrapper: skip it.
- Session name: custom-title/agent-name (latest wins), else ai-title, else first real prompt. `packages/core/agents/claude/name.ts` already
  has `readLine`, `nameOf`, `cleanName`: import and reuse them, do not rewrite.
- Use `node:sqlite` with FTS5 (verified available under Node 26 here). Index file under `.scratch/session-search/poc/` and gitignored.

## Build
1. `poc/index.ts`: builds or updates the index. Incremental by file mtime and size. Table per message (session id, role, timestamp, cwd,
   text) in an FTS5 table, plus a sessions table (id, project folder, cwd, name, first/last timestamp, message count).
   Report: time for a full build, index size, files and messages indexed.
2. `poc/search.ts "<query>" [--json] [--limit N]`: ranked by bm25, grouped by session (best snippet per session), showing session name,
   cwd, date, snippet with the match marked, and the session id. Support plain words (all must match) and quoted phrases.
3. `poc/eval.md`: run at least 12 realistic queries against the real index and judge each by eye: did the right session land in the
   top 10? Include "why" questions about decisions in THIS repo, found by reading `docs/adr/` and `git log` (for example why git
   reads never run repo code, why OSC 7501, why quiet spaces use recency) as well as a few from other projects under `~/git`.
   For each: query, top 3 hits (session name, date, one line), verdict (right session in top 10: yes / no / unclear), and what
   would have helped (phrasing, stemming, recency boost, assistant text vs user text).

## Output
Write `.scratch/session-search/poc-findings.md`: numbers (build time, size, query latency), the eval table, a plain verdict on whether
lexical search is good enough or semantic search is needed, and the top 3 problems found (noise, long sessions drowning short ones,
duplicate hits from resumed sessions, and so on). Keep it short.

## Rules
- Follow `AGENTS.md` and `GLOSSARY.md` terms (tab, session name, space).
- The transcripts hold secrets (API keys in prompts). Never print a whole record. Snippets only, at most 200 characters. Never write
  transcript text into any tracked file except short snippets in the eval table. Do not commit the index.
- Do not use any network service. Everything is local.
- Commit nothing unless asked; leave `poc/` and the findings in the working tree. Run `npm run typecheck` if you touch tracked TypeScript.
- Ask the user at the end whether to proceed to a real design (brief, ADR) based on the findings.
