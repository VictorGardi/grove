# Research: glossary, ADRs, current behaviour (subagent report, facts)

- No ADR or glossary conflict. Only ADR is 0001 (git). GLOSSARY "Context level": a tab with no usable reading has no level.
- Only OpenCode clears the ring on an unsupported reading (usage.ts drain, null delivered once a real one stands).
  Claude's "null" is a ContextUsage with null fields (compaction), still delivered; stays.
- Dead after change: opencode/adapter.ts:80-82 null->cleared-row mapping and comment; `| null` on OpencodeUsageOptions.onContext;
  drain doc comment.
- Tests to change: opencode/usage.test.ts:265-280 (expects [A, null, A]); seen typed ContextUsage|null at ~97,221,364;
  opencode/adapter.test.ts ~133-137 (expects second onContext with nulls). Claude test 121-135 stays.
- Skeleton differences a shared helper must absorb: dedupe key (Claude ignores `at`, others include it); Claude/Copilot drain
  synchronously at creation, OpenCode waits for first interval; OpenCode async with busy/closed guards; log wording per agent;
  close() sets closed only in OpenCode.
