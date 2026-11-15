# Eval: 19 queries on the real index (2026-11-15)

Verdict = right session in the top 10. Judged by eye; ground truth from `docs/adr/`, `git log` and what I know of each session's job.
"Top 3" shows session name · date · one line (snippets trimmed).

| # | Query | Top 3 | Verdict | What would have helped |
|---|---|---|---|---|
| 1 | `git reads hooks` (ADR 0001) | Confirmed go-ahead 11-14 (drafts the ADR text) · Single-git-runner create/remove writes 11-14 · Single-git-runner slice 1 11-14 | **yes** (#1) | none |
| 2 | `why OSC 7501` | OSC-7501 agent status symbols 11-07 · Herdr OSC 7501 agent status support 11-07 · OSC-7501 status slice 5 11-07 | **yes** (#1-3) | "why" is not a term; works because the topic words are rare |
| 3 | `quiet spaces recency` | Grove vs herdr-app and xirp 11-15 ("How a space becomes quiet…") · Cmd+P quick open modal 11-09 | **yes** (#1) | only 2 sessions match, so easy |
| 4 | `session name tab` (ADR 0002) | Grove vs herdr-app and xirp 11-15 (the prompt "implement one line summaries per tab…") · debug copilot and install · a Swedish client-app session | **yes** (#1), but 27 sessions match, 20+ off topic | recency or same-cwd boost |
| 5 | `single git runner` | Confirmed go-ahead · slice 1 · create/remove writes | **yes** (#1) | none |
| 6 | `handoff context 200k` | Context warning and handoff thresholds 11-12 | **yes** (only hit) | none |
| 7 | `usage keeps last reading` | Opencode behavior parity with other agents 11-14 · Commit and push to main · Context display in app | **yes** (#1) | stemming (keeps/reading) did the work |
| 8 | `worktrees outside the repo` | Grove skill for agent orchestration · Grove app architecture and workflow design 11-04 (quotes the "outside the repo" rule) · fix small issues | **yes** (#2) | stop words ("the") match; harmless here |
| 9 | `holder survive restart` | Sidebar settings icon and page · OSC-7501 agent status symbols · Feature modules design review | **unclear**: hits are about restarting the core, none states the decision | assistant-text snippet is mid-conversation, not the decision |
| 10 | `timeout kills process group` | Single-git-runner create/remove writes | **yes** (only hit) | none |
| 11 | `hooks config pager` | Right sidebar diff view 11-05 · Confirmed go-ahead 11-14 | **yes** (#2) | none |
| 12 | `why polling 3 seconds name` | Sidebar and footer branch display · terminal status · Grove superorchestrator… (all about other polls) | **no**: right session (Grove vs herdr-app and xirp) missing | drop stop/question words, OR fallback, ranking by term coverage |
| 13 | `hardened English output` | no hits | **no** | the words never co-occur in one message; AND per message is too strict, search per session or OR with ranking |
| 14 | `SIGKILL holder` | no hits | **no** | same; or the text never says it |
| 15 | `presign uploads` (spatial-intelligence-platform) | model-bundle-tenant-isolation 10-27 · build customer app 10-27 · Mattpocock skills ASS-17 | **yes** (#1-2) | none |
| 16 | `node:sqlite` (spatial-intelligence-platform) | ASS-56 implementation · Stuck quality pipeline runs in Teams · Fix stuck-job detector… | **yes** | the `:` is dropped by the tokenizer; fine here |
| 17 | `homeostat sensor` (Swedish sessions) | Zigbee-dongel via USB-förlängare · SSH mot min Raspberry Pi · Homeostat fork eller PR-strategi | **unclear**: relevant sessions, but "sensor" ≠ Swedish "sensor/givare" inflections | porter stemmer is English only |
| 18 | `freehold auth` | no hits | **no**: terms never in one message | same as 13 |
| 19 | `herdr` | Grove vs herdr-app and xirp · Herdr OSC 7501 agent status support · Pane header slimming in Next | **unclear**: 10+ sessions mention it, bm25 favors short messages | recency boost; session-level grouping |

Tally: 11 yes, 3 unclear, 5 no. All 5 "no" are queries with 3+ words or words that don't share one message; every 1-2 word
topical query landed. Latency 0-10 ms per query.
