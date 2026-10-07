---
feature: 2026-10-07-review-comments
phase: implementation
status: draft
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at:
based_on:
  - 05-plan.md@1
forced: []
---

# Review comments — implementation

## Slice 1 — Send a general note from the tray (tracer)

**Changed:** `Comment`/`CommentAnchor`/`CommentsFile` and `Slices.comments`
(`shared/types.ts`); `comment:add|update|delete`, `review:send`, `state:comments`
(`shared/ipc.ts`). Backend `paste`/`capture` (tmux: `set-buffer` →
`paste-buffer -p -d` → 150 ms → `send-keys Enter`, serialised through a promise
chain; herdr stub; `FakeBackend.pastes`/`captured`). New `core/comments/{store,model,format}.ts`
and `core/send.ts` (live sessions only). Core: `commentsPath` option, the
`comments` slice (saved on `set('comments')`, loaded in `start`), commands
`commentAdd|Update|Delete`, `reviewSend`, `sendToSession`, comments dropped with
removed sessions. Renderer: `comments` in the store, `ReviewMenu` (Review (n)
button, popover with note textarea, Send, collapsed Sent list) in the session
header.

**Tests:** `tmux.test.ts` (paste into a real `cat` pane), `comments/{store,model,format,core}.test.ts`,
`send.test.ts`. `npm test` 414 pass; `npm run typecheck` clean.

**Deviations:**
- `commentAdd` returns `note-exists` for a second draft note and `empty` for a
  blank body; `commentUpdate` returns `not-draft` for a sent comment. The design
  says only "at most one draft note"; these error names are mine.
- `reviewSend` has an in-flight guard per session (`busy`), so a double click
  can't paste twice.
- `formatReview` counts all drafts, the note included, in `(n)`. It skips
  anchored drafts until slices 2 and 4; `commentAdd` already accepts any anchor.
- The tray saves the note on blur, and Send saves it first.

**Not done:** the manual check in `05-plan.md` (send "reply with the word pong"
to an OpenCode and a Claude session; restart and see Sent). It needs live agents.
