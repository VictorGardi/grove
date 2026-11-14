# Decision log

- Q1-Q5 outcome answers: user yes to all (2026-11-14). Brief confirmed by user ("go").
- Research done: research-behaviour.md, research-constraints.md.
- Open decisions listed, none pass the altitude test (hard to reverse + surprising + real trade-off). All are reversible internal refactor choices, decided by the interviewer, no ADR:
  1. view-state console.warn vs the other seven silent -> keep as today: the shared mechanism takes an optional failure hook, view-state passes console.warn, the other seven pass nothing. (Revised after checker: silencing would break view-state.test.ts warn assertions and change "same as today".)
  2. Storage looked up per use (getter) rather than once -> getter, as view-state already does. Keeps today's behaviour when site data is blocked.
  3. Existing keys and stored formats are unchanged. (Revised after checker, item 4.) The shared mechanism owns the key, the default, the try/catch and the encode/decode to the stored text. A setting supplies only its key, default and validity rule, plus a custom encode/decode where the format is not plain text (booleans, JSON, numbers). Each setting keeps its own rules (zoom rejects out of range, pane-dim clamps and defaults to unset, dock width has a floor, appearance is all-or-nothing, view-state normalises on read). Dock's two values are two settings.
  4. ViewStatePort and its three adapters stay, built on the shared mechanism, so window-store and its tests are untouched.
  5. Where the KeyValueStore type lives -> the shared mechanism, not sidebar-state.
  6. "A change holds until the window closes" is carried by the callers' in-memory values, not by the storage layer; the brief wording means that, no behaviour added.
- Phase 3 rounds skipped: no open decision remains. No ADR needed. No GLOSSARY.md change (no domain term resolved; "module" is taken by DockModule so avoid it).
- Checker (outcome only): items 1,2,3,5 ok; item 4 blocking, fixed by revised decision 3 above. Item 2 caveat verified: callers hold their own in-memory value (zoom, themeId, soundOn, agentAppearance in main.ts:116-132; dock width/expanded in dock.ts:83-84; sidebar and pane-dim live in the DOM state), so "a change holds until the window closes" is true without new code.
- Wording fix for "behave the same on a bad value": same for unreadable or failing storage and unparseable text; out-of-range numbers keep each setting's own rule (pane-dim clamped, dock floored, zoom reset).
