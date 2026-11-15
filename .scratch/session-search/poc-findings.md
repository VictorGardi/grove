# Session search POC: findings (Claude only, 2026-11-15)

Code: `poc/index.ts`, `poc/search.ts`, `poc/eval.md`. Node 26, `node:sqlite`, FTS5 with `porter unicode61`. Nothing under `packages/`
touched, nothing committed. The index (`poc/index.db`) is gitignored.

## Numbers
- Data: 1,795 `.jsonl` files, but only 578 are top-level sessions; the other 1,217 are subagent transcripts under
  `<session>/subagents/`, which the brief says to skip. So the brief's "1,800 files" is really 578 sessions (956 MB).
- Full build: **5.5 s** (578 files, 17,716 messages kept). Index: **18 MB** (577 sessions, 17,570 messages).
- Incremental run with nothing changed: ~0.1 s (2 files changed since the build, 65 messages).
- Query latency: **0-10 ms** (bm25, top 2,000 messages, grouped by session).
- Messages: 15,116 assistant (avg 396 chars), 2,450 user (avg 424). Assistant text is 86% of the corpus.
- 10 of 577 sessions have no name at all (no title, no real prompt).

## Eval (details in `poc/eval.md`)
19 queries (10 about Grove decisions, 9 from other projects or generic): **11 yes, 3 unclear, 5 no** for "right session in top 10".
Every one- or two-word topical query landed in the top 3. All 5 misses were multi-word natural-language queries.

## Verdict
**Lexical search is good enough to build on.** Fast, small, cheap to keep fresh, and it finds the session when the user remembers
a distinctive term. Semantic search is not needed for a first version; it would only help the "why did we decide X" phrasings that
share no words with the answer, and the misses here are fixable lexically. Revisit semantic search only if real use shows
misses after the fixes below.

## Top 3 problems
1. **Strict AND per message kills natural phrasing.** `why polling 3 seconds name`, `hardened English output` and `freehold auth`
   found nothing or the wrong thing, because every word must sit in one message. Fix: match across a session (or per message OR,
   ranked by how many terms hit), drop stop words and "why/how/did we".
2. **Noise from common words and weak ranking across sessions.** `session name tab` matched 27 sessions, `herdr` 10+. bm25 prefers
   short messages, and nothing prefers recent or same-folder sessions. Fix: recency boost, cwd filter or boost, rank by session.
3. **The decision is not the hit.** Assistant text is 86% of the corpus and the best snippet is often mid-work narration
   ("the holder restarts its core…") instead of the user's decision. Fix: boost user messages and the first assistant reply after
   them, and show the user prompt next to the snippet.

Also seen, smaller: ~1% of long messages (46 of 5,135) are exact duplicates across sessions (resumes, copied briefs); 5 messages over
20 KB (pasted logs); the same session id existed in two project folders once (577 sessions from 578 files, so one overwrote the
other: key by file path next time); porter stemming is English only, so Swedish sessions match poorly; `grove-search` in `~/git` was
only mentioned in a session, not a source of data.

## Not tested
Opencode and Copilot sessions, secrets handling (transcripts contain API keys; a real design needs a redaction or opt-out policy and
a permissions-restricted index file), index growth over time, a Go to integration.
