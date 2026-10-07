---
feature: 2026-10-07-review-comments
phase: plan
status: approved
version: 1
created: 2026-10-07
updated: 2026-10-07
approved_at: 2026-10-07
based_on:
  - 03-design.md@1
  - 04-structure.md@1
forced: []
---

# Review comments — plan

Self-approved per slice by grove-implement: mechanical checks passed, not human-reviewed.

Ground rules: read `03-design.md` (types, message format, send path) first. Code
style: no semicolons, single quotes, 2-space indent, `Result<T>` from `@shared/ipc`.
Slice 1 creates only note drafts from the UI; the model accepts any anchor, and
`formatReview` renders only `note` drafts until slices 2 and 4.

## Slice 1 — Send a general note from the tray (tracer)

- [x] `src/shared/types.ts`: add `CommentAnchor`, `Comment`, `CommentsFile` exactly as in the design; add `comments: Comment[]` to `Slices`.
- [x] `src/shared/ipc.ts`: add `InvokeMap` channels `'comment:add'`, `'comment:update'`, `'comment:delete'`, `'review:send'` (arg/result types from the design's key signatures; delete → `{ id: string }`), and `PushMap['state:comments']: Comment[]`.
- [x] Write failing test `src/core/backend/tmux.test.ts` "paste puts multi-line text into a pane": create a session with `argv: ['cat']`, `paste(name, 'line one\nline two', true)`, poll `capture(name, 50)` until it contains both lines.
- [x] `src/core/backend/types.ts`: add `paste(name, text, submit)` and `capture(name, lines)`. `tmux.ts`: `paste` = `set-buffer -b grove-send -- <text>` → `paste-buffer -p -d -b grove-send -t =name:` → (submit) 150 ms sleep → `send-keys -t =name: Enter`, serialised through a private promise chain so two pastes never share the buffer; `capture` = `capture-pane -p -J -S -<lines> -t =name:`, `''` on any error.
- [x] `src/core/testing/fakeBackend.ts`: `pastes: { name; text; submit }[]` recorded by `paste`; `captured = new Map<string, string>()` returned by `capture` (`''` when unset).
- [x] Write failing tests `src/core/comments/store.test.ts` (missing file → empty; save then load round-trips; bad JSON moved aside and reported), `model.test.ts` (add trims and rejects empty body `'empty'`; second draft note → `'note-exists'`; update only drafts, else `'not-draft'`; remove; `markSent` sets `state`/`sentAt` and keeps the newest 100 sent per session; `dropSession`), `format.test.ts` (note: header with count, blank line, note body).
- [x] Create `src/core/comments/store.ts` (`loadComments(file, onBad)` / `saveComments(file, f)` via `readVersioned`/`atomicWrite`, v1), `model.ts` (pure: `addComment`, `updateComment`, `removeComment`, `markSent`, `dropSession`, `draftsOf`), `format.ts` (`formatReview(drafts, ctx)`: `Review comments from Grove (<n>). Please address each one.`, blank line, note body; anchored drafts skipped until slices 2/4).
- [x] Write failing test `src/core/send.test.ts`: unknown id → `not-found`; gone session → `gone`; live session → one paste with `submit: true`, `{ ok: true, data: { id } }`.
- [x] Create `src/core/send.ts`: `sendToSession(deps: { find(id): Session | undefined; backend: SessionBackend }, a: { id; text; submit? })`; backend errors become `{ ok: false, error: message }`.
- [x] `src/core/core.ts`: `CoreOptions.commentsPath`; `comments` slice (loaded in `start`, saved in `set('comments')`); `Commands` + implementations `commentAdd|commentUpdate|commentDelete|reviewSend|sendToSession`; `reviewSend` = drafts of the session (none → `'empty'`), `formatReview` (ctx: project path, `featurePath` from `slices.features.items`), `sendToSession`, `markSent`; a per-session in-flight guard (second call → `'busy'`); drop a session's comments in `dropSessions`.
- [x] `src/core/testing/setup.ts`: pass `commentsPath` (`<dir>/comments.json`) and return it. Write failing core test `src/core/comments/core.test.ts`: `reviewSend` pastes once and marks the note sent; no drafts → `'empty'`; comments survive a new core on the same files; `sessionRemove` drops them.
- [x] `src/main/ipc.ts`: handle the four channels (`returnsResult` true). `src/main/index.ts`: `commentsPath: path.join(app.getPath('userData'), 'comments.json')`.
- [x] `src/renderer/src/stores/slices.ts`: `comments` state, `api.on('state:comments')`, hydrated from `state:get`.
- [x] `src/renderer/src/components/ReviewTray.tsx` + `ReviewTray.module.css`: `ReviewMenu({ sessionId })` = a **Review (n)** ghost `Button` (n = that session's drafts) that toggles a popover (closes on Esc and outside click) holding a note textarea (saved on blur through add/update/delete), a **Send** button (flushes the note, calls `review:send`, "Sending…", inline error), and a collapsed `<details>` **Sent** list with time and body. CSS variables only.
- [x] `src/renderer/src/App.tsx`: render `<ReviewMenu sessionId={shown.session.id} />` beside the Diff button in the session header.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: `npm run dev`; send a note "reply with the word pong" to an OpenCode and a Claude session; both submit and answer; restart the app and the Sent list is still there.

## Slice 2 — Comment on diff lines

- [x] Write failing tests: `src/core/comments/format.test.ts` "diff range, removed lines, path outside project"; `src/renderer/src/reviewView.test.ts` (`draftsByLine`, `groupForTray`); `src/renderer/src/diffView.test.ts` (`rangeAnchor`).
- [x] `src/core/comments/format.ts`: diff blocks under `## <path>` headings (files in order of first comment; `L<a>-<b> (new|removed):`, `> ` quoted lines, body); path project-relative when inside the project, else absolute.
- [x] `src/renderer/src/diffView.ts`: `sideOf`, `rangeAnchor(root, file, hunk, side, a, b)` (lines of that side in one hunk between two line indices). `src/renderer/src/reviewView.ts`: `draftsByLine`, `groupForTray`.
- [x] `src/renderer/src/components/CommentEditor.tsx` + `.module.css`: textarea with Save/Cancel; ⌘↩ saves, Esc cancels.
- [x] `DiffViewer.tsx` + CSS: gutter **+** on each line; click opens the editor under the line; shift-click in the same hunk and side extends the range; saving calls `comment:add` with `anchor` from `rangeAnchor`; drafts render under their last line with Edit/Delete.
- [x] `ReviewTray.tsx`: list drafts by file (`groupForTray`) with quote, edit and delete; clicking a quote opens the session's diff.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: comment on 2 lines and on a removed line, send, and check the agent receives all three with their line numbers.

## Slice 3 — Diff drafts re-anchor and orphan

Rules (from the design, D3): only a session's drafts with a `diff` anchor whose `root` equals `diff.root`, when `diff.state === 'ok'` and `!diff.truncated`. A file that is `binary` or `truncated` is left alone (its lines can't be judged). A line run is contiguous numbers on one side across a file's hunks: `new` side = `add` and `context` lines (number `.new`), `old` side = `del` and `context` lines (number `.old`). Match = same `lines` texts in order, consecutive numbers; take the match whose start is nearest the stored `start` (ties: the lower start). No match, or the file is not in the diff → `orphaned: true`, anchor kept. A match → `start`/`end` updated, `orphaned: false`. Returns the same array reference when nothing changed.

- [x] Write failing test `src/core/comments/anchor.test.ts`: "unchanged → same reference"; "lines moved down → start/end updated"; "two matches → nearest"; "lines removed → orphaned, anchor text kept"; "found again → not orphaned"; "file left the diff → orphaned"; "old side matches del and context lines"; "other session, other root, sent, note and artifact comments untouched"; "diff not ok or truncated → untouched".
- [x] Create `src/core/comments/anchor.ts` with `reanchorDiff(cs: Comment[], diff: SessionDiff): Comment[]` per the rules above (pure; updates `updatedAt` not at all).
- [x] Write failing core test in `src/core/comments/core.test.ts` "diff drafts follow their lines": temp git repo in the project folder (as `src/core/diff/core.test.ts`), modify `a.txt`, open the diff viewer, add a `diff` draft on the changed line (root = `diff.root`), insert two lines above it on disk, wait for the diff to change, expect `start` +2; then replace the line's text and expect `orphaned: true`.
- [x] `src/core/core.ts`: after `set('diff', d)` in the `createDiffWatch` callback, `const next = reanchorDiff(slices.comments, d)` when `d` is non-null and `next !== slices.comments` → `set('comments', next)`.
- [x] `src/renderer/src/components/ReviewTray.tsx` + `.module.css`: for `orphaned` drafts show an "orphaned" tag beside the quote (CSS variables only).
- [x] `src/core/comments/format.ts`: for an orphaned diff draft, append `(The lines have changed since this comment was written.)` after the body, as in the design's message format.
- [x] Add to `src/core/comments/format.test.ts`: "orphaned diff draft is marked".
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: comment on a line in `npm run dev`, insert lines above it in the file, and the draft in the tray shows the new line number; delete the line and it shows orphaned.

## Slice 4 — Comment on markdown artifacts

Protocol additions beyond the design's four messages (log as deviation): iframe → app `{grove:1,type:'ready'}`; app → iframe `{grove:1,type:'config',canComment:boolean}` (Comment is disabled when no session is focused). Selection text is the whitespace-collapsed rendered text, with a space between blocks. Only `kind: 'artifact'` targets whose path ends `.md` get the bridge.

- [x] Write failing tests `src/core/artifacts/markdown.test.ts` "blocks carry data-line offset by frontmatter" (`<p data-line="6-6">` after a 4-line frontmatter block + title; `<h1 data-line=…>`; fence `<code data-line>`; script tag `grove-artifact://assets/comments.js` present) and `src/core/comments/format.test.ts` "artifact quote" (`## <featurePath>/<path>` heading, `L40-41, on "quote":`, body; orphaned marked; long quotes cut at 200 chars).
- [x] `src/core/artifacts/markdown.ts`: core rule setting `data-line="<start>-<end>"` (1-based, + frontmatter line offset) on block tokens that have `map` (nesting 1, `fence`, `code_block`, `hr`); mermaid `<pre>` gets it too; load `comments.js` script tag in head.
- [x] `src/core/comments/format.ts`: artifact blocks under the same `## <path>` headings as diff blocks.
- [x] `resources/viewer/comments.js` (selection → `select`, popover Comment button, `config`, `highlights` via `CSS.highlights`, click → `open`, `reveal`), `resources/viewer/markdown.css` (`::highlight(grove-comment)`, popover), `src/main/artifacts.ts` asset entry.
- [x] `src/renderer/src/artifactComments.ts` (+ test): `parseIframeMessage(data)` validation, `draftsForFile(cs, sessionId, target)`.
- [x] `ArtifactViewer.tsx` + CSS: message bridge (`event.source === iframe.contentWindow`, markdown artifact only), editor panel under the frame (new from `select`, edit from `open`), send `config` and `highlights` on `ready` and on change; props `sessionId`, `comments`. `App.tsx` passes them.
- [x] `ReviewTray.tsx`: artifact drafts grouped by file with quote; Jump opens the artifact.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: select text across two paragraphs in a `03-design.md`, comment, reload the app (highlight is back), send; an HTML artifact shows no Comment popover.

## Slice 5 — Markdown drafts re-anchor and orphan

Rules (design D3): `blockText(source)` returns one entry per leaf block (inline token → plain rendered text from its `text`/`code_inline`/image-alt children, softbreak → space; `fence`/`code_block` → content), whitespace-collapsed, with 1-based whole-file `start`/`end` (frontmatter offset; table cells use their row's lines). `reanchorArtifact` joins the blocks with one space and, per draft of that file (any session), tries in order `prefix+exact+suffix`, `prefix+exact`, `exact+suffix`, `exact`; the first tier with any match decides: exactly one → `start` = first block's `start`, `end` = last block's `end`; several (ambiguous) or none overall → orphaned. A match clears the orphan mark. Same array when unchanged. Core runs it when a feature artifact's `mtimeMs` differs from the last one seen (or has not been seen) and a draft exists for that file.

- [x] Write failing tests `src/core/comments/anchor.test.ts` (new `describe('reanchorArtifact')`, `blockText`): "quote moved by an insert above", "quote edited → orphaned", "ambiguous → orphaned, prefix/suffix breaks the tie", "frontmatter offset", "spans two blocks", "found again clears orphaned", "same array when unchanged", "other files, sent and diff drafts untouched".
- [x] `src/core/artifacts/markdown.ts`: export `parseMarkdown(source)` (tokens, env, frontmatter) used by `renderMarkdown`.
- [x] `src/core/comments/anchor.ts`: `blockText`, `reanchorArtifact(cs, file: { projectId; slug; path }, source)`.
- [x] `src/core/core.ts`: after `publish()` derives features, for each feature artifact with a changed or unseen `mtimeMs` and an artifact draft on it, read the file (`artifactPath`), run `reanchorArtifact` on the current `slices.comments`, `set('comments')` when changed.
- [x] Write core test `src/core/comments/reanchor.test.ts` "artifact drafts follow an edited file": a feature folder under the project (copy the fixture style of existing core tests), add an artifact draft, edit the file, expect `start` to move.
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: comment in a `03-design.md`, insert a paragraph above it on disk, and the tray line numbers follow; edit the quoted words and it shows orphaned.

## Slice 6 — Send to working and gone sessions

Rules (design "Send path"): `sendToSession` on a `gone` session: a terminal or an agent session without `agentSessionId` → `gone`. Otherwise call `deps.resume(id)` (failure → its error), sleep 1 s, then poll `backend.capture(name, 50)` every 250 ms; the pane is ready once its non-empty text has stayed unchanged for 1 s; still not ready 20 s after the resume → `not-ready`. Then paste and submit. A live session (`working` included) pastes at once. `deps` gets `resume`, `sleep(ms)` and `now()` (defaults: `setTimeout`, `Date.now`) so tests run on a fake clock.

- [x] Write failing tests in `src/core/send.test.ts`: "gone agent → resume, waits for 1 s stable capture, then pastes" (fake clock; capture changes twice then holds; paste happens at ≥ 1 s after the last change, after the resume call), "never stable → not-ready at 20 s" (capture changes every poll; nothing pasted), "gone terminal → gone", "resume failure is returned", "empty capture never counts as stable".
- [x] `src/core/send.ts`: implement per the rules (`SendDeps.resume`, `sleep`, `now`).
- [x] `src/core/core.ts`: `sendDeps.resume = (id) => commands.sessionResume({ id })`.
- [x] Write core test in `src/core/comments/core.test.ts`: a gone claude session with `agentSessionId`, `fake.captured` set for its pane, `reviewSend` resumes it and pastes once, marks sent.
- [x] `src/renderer/src/components/ReviewTray.tsx`: show "Resuming the session… (Sending…)" text while sending a gone agent session; map errors `not-ready` → "The session did not become ready. Try again.", `gone` → "This session has ended and cannot be resumed.", `busy` → "A send is already running.".
- [x] Run `npm test`
- [x] Run `npm run typecheck`
- [ ] Manual: `tmux -L grove kill-session` a Claude session's pane, then Send; it resumes and the agent answers.
