---
feature: 2026-11-02-osv-scanner-security-fixes
phase: run
status: draft
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at:
based_on: [03-plan.md@1]
forced: []
---

# Run: OSV scanner in CI and security fixes

Profile: inherit
Branch: feature/2026-11-02-osv-scanner-security-fixes-inherit
Plan commit: 05911ac30a8217db8d8b9a5b7cde2eb74943ecfd
Roles:
- cto: claude, inherit
- researcher: claude, inherit
- planner: claude, inherit
- reviewer: claude, inherit
- implementer: claude, inherit

## Slice 1

Session: osv-scanner-security-fixes-slice-1-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: no `.github` directory and no `osv-scanner.toml` existed; `package-lock.json` is at the repo root. The google/osv-scanner-action v2.7.0 composite action is docker-based and takes newline-separated `scan-args`.

Implementer 1:
- [x] `.github/workflows/ci.yml`: scan job on `pull_request`, `permissions: contents: read`, action at exact tag v2.7.0, `--config=osv-scanner.toml --lockfile=package-lock.json`
- [x] `osv-scanner.toml`: empty ignore list with a comment on the entry format

Models passed: implementer: inherit (built directly by the planner session, the slice is two small files), reviewer: inherit

### Review rounds

Round 1: no blocking findings; non-blocking: tag not SHA (matches plan's "exact tag"), scan red until slice 2.

approved, 0 blocking, 0 fix rounds. Non-blocking left: pin by SHA, pin actions/checkout, `--lockfile` is the legacy v2 form but works.

### Deviations

The planner session wrote the two files itself instead of delegating to an implementer subagent.

### Verification

- Workflow parses (`ruby -ryaml`; actionlint not installed).
- osv-scanner 2.7.0 installed with brew; `osv-scanner scan --config osv-scanner.toml -L package-lock.json` exits 1 and lists 22 vulnerabilities in dompurify, electron, katex, markdown-it, undici, vite and @vitest/mocker.
- Models requested: reviewer inherit.

### Left for the human

The first GitHub PR run confirms the action ref, permissions and config. The scan is red until slice 2.

## Slice 2

Session: osv-scanner-security-fixes-slice-2-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `package.json` pins electron 44.5.1, markdown-it 15.0.2, mermaid 12.1.0, vite 7.3.6, vitest 4.1.11 exactly; dompurify, undici, katex and @vitest/mocker are transitive. The OSV scan listed 22 advisories over 7 packages (the 9 reported groups).

Implementer 1:
- [x] `package.json`: electron 44.10.1, markdown-it 15.0.3, mermaid 12.2.0, vite 7.3.7, vitest 4.1.12 (exact pins)
- [x] `npm install`, then `npm update dompurify undici`; no `overrides` needed (dompurify 3.4.17, undici 7.30.1 resolved)
- [x] `osv-scanner.toml` unchanged: every finding had a fix, no ignore entries

Models passed: implementer: inherit (done directly by the planner session, a version bump), reviewer: inherit

### Review rounds

Round 1: no blocking findings; non-blocking: katex 0.16.47 -> 0.18.10 (required by mermaid 12.2.0 `katex ^0.18`) and its nested commander 8 -> 15 are transitive 0.x-minor/major jumps; commander 15 needs Node >=22.12, fine for Node 24 and only used by katex's CLI.

approved, 0 blocking, 0 fix rounds. Non-blocking left: spot-check mermaid math rendering by hand.

### Deviations

The planner session edited the versions itself instead of delegating to an implementer subagent. katex and its nested commander moved a minor/major as a consequence of the mermaid pin; accepted.

### Verification

- `npm ls dompurify undici katex @vitest/mocker`: dompurify 3.4.17, undici 7.30.1, katex 0.18.10, @vitest/mocker 4.1.12.
- Clean `npm ci`, then `npm test` (108 files, 1324 tests pass), `npm run typecheck` and `npm run build` pass.
- `osv-scanner scan --config osv-scanner.toml -L package-lock.json`: "No issues found".
- Models requested: reviewer inherit.

### Left for the human

Spot-check mermaid diagrams with math in the app (katex 0.18).

## Slice 3

Session: osv-scanner-security-fixes-slice-3-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `ci.yml` had only the `scan` job on `pull_request`. `src/main/sound.ts` is macOS-only but pure (the `afplay` call is in `src/main/index.ts`, not under test); `src/core/backend/tmux.test.ts` is `describe.skipIf(!tmuxPath)`, so it skips on a runner without tmux. No other test needs macOS.

Implementer 1:
- [x] `.github/workflows/ci.yml`: add `schedule` (weekly, Monday 06:00 UTC) and `workflow_dispatch`; add `test`, `typecheck`, `build` jobs on `ubuntu-latest`, Node 24, each with `if: github.event_name == 'pull_request'`; test job installs tmux so the tmux tests run

Models passed: implementer: inherit (done directly by the planner session, one file), reviewer: inherit

### Review rounds

Round 1: no blocking findings; non-blocking: actions pinned by tag not SHA (same as slice 1), `npm ci` repeated per job.

approved, 0 blocking, 0 fix rounds. Non-blocking left: pin actions by SHA, share install via cache.

### Deviations

The planner session edited the workflow itself instead of delegating to an implementer subagent. Review was done by the planner against the diff rather than a separate reviewer subagent.

### Verification

- Workflow parses (`ruby -ryaml`): `on` has `pull_request`, `schedule` and `workflow_dispatch`, no `push`; jobs scan, test, typecheck, build.
- Fresh clone in an empty temp directory: `npm ci`, `npm test` (108 files, 1324 tests pass), `npm run typecheck` and `npm run build` pass.
- Inspected macOS/tmux assumptions: tmux tests skip without tmux and the job installs it; `sound.ts` is pure. No test changes needed.
- Models requested: reviewer inherit.

### Left for the human

The first GitHub PR run confirms the Linux run (tmux install, Electron binary download in `npm ci`); `schedule` and `workflow_dispatch` only fire once merged to the default branch.

## Slice 4

Session: osv-scanner-security-fixes-slice-4-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `ci.yml` had the scan step only; `vitest.config.ts` included only `src/**/*.test.ts` and `tsconfig.node.json` does not cover `scripts/`; no TOML parser is a dependency. `spikes/electron/package-lock.json` exists.

Implementer 1:
- [x] `scripts/check-osv-ignores.mjs`: dependency-free parser of `[[IgnoredVulns]]` entries, exits 1 on a missing `id`, `ignoreUntil` or `reason`
- [x] `scripts/check-osv-ignores.test.ts` and `vitest.config.ts` include `scripts/**/*.test.ts`
- [x] `.github/workflows/ci.yml`: check step before the scan, second scan step for `spikes/electron/package-lock.json` with `continue-on-error: true` and no config
- [x] `osv-scanner.toml`: comments only

Models passed: implementer: inherit (done directly by the planner session, small files), reviewer: inherit

### Review rounds

Round 1: no blocking findings; non-blocking: the parser is line-based and handles only the documented `key = value` form (no multi-line strings or inline tables); the action's `--config` path is only proven on the first GitHub run.

approved, 0 blocking, 0 fix rounds. Non-blocking left: line-based TOML parsing, `--config` through the action unproven locally.

### Deviations

The planner session wrote the files itself instead of delegating to an implementer subagent, and reviewed the diff itself rather than through a separate reviewer subagent. `vitest.config.ts` was changed (not in the plan's file list) so `npm test` runs the new test.

### Verification

- Pre-upgrade lockfile (`git show ba2ae11:package-lock.json`) in an empty temp directory with an `[[IgnoredVulns]]` entry for GHSA-238p-pmpm-9mq7 (katex): `ignoreUntil` in the past, the scan still lists the advisory in its table and exits 1 ("unused ignores"); `ignoreUntil` in 2099, it prints "filtered out because: test future" and the advisory is absent from the table (exit is still 1 for the other advisories in that old lockfile).
- `node scripts/check-osv-ignores.mjs osv-scanner.toml` exits 0; the new test (6 cases, including missing `ignoreUntil` and missing `reason`) passes within `npm test` (109 files, 1330 tests pass); `npm run typecheck` passes.
- Workflow parses (`ruby -ryaml`); the spikes step has `continue-on-error: true`.
- Models requested: reviewer inherit.

### Left for the human

The first GitHub PR run confirms the pinned action's `--config` handling and the spikes step; a throwaway PR with an expired entry would prove expiry through the action.

## Slice 5

Session: osv-scanner-security-fixes-slice-5-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `guardNavigation` in `src/main/artifacts.ts` called `shell.openExternal` for any sub-frame http(s) navigation and from `setWindowOpenHandler`; the `BrowserWindow` in `src/main/index.ts` set only `preload` and `contextIsolation`; no permission handler existed; the renderer CSP had no `base-uri`, `form-action` or `object-src`. Electron 44's `WebContentsWillFrameNavigateEventParams` (url, isSameDocument, isMainFrame, frame, initiator) and `HandlerDetails` (url, frameName, features, disposition, referrer, postBody) carry no user-activation field, so D4 falls back to B.

Implementer 1:
- [x] `src/main/artifacts.ts`: drop `openExternal` from `will-frame-navigate` and `setWindowOpenHandler` (window.open denied); `artifacts.test.ts` updated
- [x] `src/main/windowGuard.ts` (new, so it is unit-testable): D5 allow-list, `media` for the file:// or dev-server origin of the main window only, on both the request and the check handler; `will-attach-webview` denied; `windowGuard.test.ts`
- [x] `src/main/index.ts`: explicit `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, call `guardWindow`
- [x] `src/renderer/index.html`: `base-uri 'none'; form-action 'none'; object-src 'none'`

Models passed: implementer: inherit (done directly by the planner session), reviewer: inherit

### Review rounds

Round 1: no blocking findings; non-blocking: the dev-server origin comes from `ELECTRON_RENDERER_URL`, so in dev the handler trusts whatever that variable names; the permission handler is per-session, which is the default session shared by all of Grove's webContents, and it also checks `contents === wc`.

approved, 0 blocking, 0 fix rounds. Non-blocking left: both above.

### Deviations

The planner session wrote the code itself and reviewed the diff itself rather than through subagents. A new file `src/main/windowGuard.ts` (and test) was added beyond the plan's file list. D4 shipped as fallback B: links and `window.open` in artifacts no longer open the browser, noted in the commit message.

### Verification

- `npm test` (110 files, 1335 tests pass), `npm run typecheck` and `npm run build` pass.
- Tests: `artifacts.test.ts` shows `openExternal` is never called from sub-frame navigation or `window.open`; `windowGuard.test.ts` shows `media` is allowed for the main window and `geolocation` denied, plus artifact, foreign and other-port origins denied and webview attach prevented.
- The built app was launched (`electron .`, isolated `--user-data-dir`, over CDP, both with the file:// renderer and once picking up an existing dev server URL): `typeof window.api` is `object`, `typeof process` is `undefined` (sandboxed), the board rendered (15 elements under `#root`). The built preload only requires `electron`.
- Models requested: reviewer inherit.

### Left for the human

Open an artifact in the viewer once and confirm it renders (the artifact protocol and its CSP were not changed, but this was not clicked through in the launched app); links in artifacts no longer open the browser.

## Slice 6

Session: osv-scanner-security-fixes-slice-6-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: every git call goes through `gitRunner` in `src/core/diff/git.ts`, which prefixed only `-c core.quotePath=false`; `worktrees.add` passed the branch and base to git unchecked (`resolveBase` used a bare `rev-parse --verify`); `computeDiff` passed an explicit base straight to `merge-base` and `diff`; the only path from text to a pane is `TmuxBackend.paste` (herdr throws "not implemented"); `formatReview` built the sent text from quoted lines and comment bodies unchanged. `pr.ts` passes the branch as a separate argv element after `--head`.

Implementer 1:
- [x] `src/core/diff/git.ts`: `gitArgv` adds `-c core.fsmonitor=false -c core.hooksPath=/dev/null` only for status, diff, ls-files, rev-parse, for-each-ref, symbolic-ref, merge-base and `worktree list`; `--end-of-options` on the default-base `rev-parse`; `git.test.ts`
- [x] `src/core/worktrees.ts`: branch rejected when it starts with `-` or `git check-ref-format --branch` fails or expands it; base starting with `-` rejected; `--end-of-options` on `resolveBase`; tests in `worktrees.test.ts`
- [x] `src/core/diff/compute.ts`: explicit base starting with `-` becomes an error state
- [x] `src/core/controlChars.ts` (`stripControls`: C0 and C1 except newline and tab), used by `formatReview` and `TmuxBackend.paste`; `controlChars.test.ts`, `format.test.ts`

Models passed: implementer: inherit (done directly by the planner session), reviewer: inherit

### Review rounds

Round 1: no blocking findings. Non-blocking applied: `--end-of-options` on `resolveDefaultBase`'s `rev-parse`, a comment that callers pass the subcommand first. Non-blocking left: refs read from a hostile repo (`defaultBranch`) are not checked for a leading `-` before `merge-base` and `diff`; stripping lives in the tmux backend (and `formatReview`), so a future herdr backend must strip too; `core.hooksPath=/dev/null` assumes Unix.

approved, 0 blocking, 0 fix rounds.

### Deviations

The planner session wrote the code itself rather than through an implementer subagent; the review was a fresh reviewer subagent. New files `src/core/controlChars.ts` and tests were added beyond the plan's file list. `src/core/pr.ts` was left unchanged: the branch is a separate argv element after `--head`, which `gh` takes as the value. `stripControls` also removes CR (tmux turns LF into CR itself on paste).

### Verification

- `npm test` (112 files, 1344 tests pass) and `npm run typecheck` pass.
- Tests show: a branch starting with `-`, containing a space, or `@{-1}` is rejected and nothing is created; a base `--orphan` is rejected; a normal `feat/fine` branch is still created; `ESC[201~` comes out without ESC; the read-only helper includes the hardening flags and `worktree add`, `submodule update` and `worktree remove` do not.
- Models requested: reviewer inherit.

### Left for the human

none

## Slice 7

Session: osv-scanner-security-fixes-slice-7-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: `resolveRoot` returned any existing directory under `path.resolve(projectPath, rel)`; `atomicWrite` used `${file}.${pid}.tmp` with a plain `writeFileSync`; the viewer protocol handler in `src/main/artifacts.ts` and `diffLines` in `src/core/core.ts` checked a realpath and then read by path. `atomicWrite` callers are the comment, config and state stores and the notes file.

Implementer 1:
- [x] `src/core/discovery/folder.ts`: `resolveRoot` returns null when the real path of the root is outside the real project path (behaviour change: out-of-project roots, by `../` or symlink, are refused)
- [x] `src/core/store/jsonFile.ts`: random temp name, `wx`, mode `0o600`, temp removed on failure
- [x] `src/core/artifacts/path.ts`: `readInside` / `readSafeFile` open once with `O_NOFOLLOW`, compare the handle with the path (real path, ino, dev) and read from the handle; `core.readFile` added, used by the artifact protocol handler; `diffLines` uses `readInside`
- [x] tests in `folder.test.ts`, `jsonFile.test.ts`, `path.test.ts`

Models passed: implementer: inherit (done directly by the planner session), reviewer: inherit

### Review rounds

Round 1: no blocking findings. Non-blocking: the open-and-recheck narrows but cannot eliminate a directory-swap race (Node has no `openat`); comment reworded. Left: the comment re-anchor loop (`reanchorFiles`) still reads by path; the manifest read in `readFolder` follows a symlink; `resolveRoot` returns the unresolved root; stray `*.tmp` after a hard kill; the 0600 mode now applies to every state file; `new Uint8Array(bytes)` copies.

approved, 0 blocking, 0 fix rounds.

### Deviations

The planner session wrote the code itself rather than through an implementer subagent. Added `readFile` to the `Core` interface and changed `src/main/artifacts.ts` to use it. The pre-planted symlink test uses the old guessable name, since the new name is random.

### Verification

- `npm test` (112 files, 1349 tests pass) and `npm run typecheck` pass.
- Tests show: a root outside the project (`../` or symlink) is rejected and a symlink inside still resolves; overwriting a 0600 state file works and stays 0600; a symlink at the old temp name is not followed; a symlink swapped in after the check is not read.
- Models requested: reviewer inherit.

### Left for the human

none

## Slice 8

Session: osv-scanner-security-fixes-slice-8-a1
Status: done
Commit: this commit (see git log)

### Slice plan

Found in the code: ADR 0027 is `docs/adr/0027-grove-cli-over-unix-socket.md` (the next free number is 0046); the README has no section on the scan and `osv-scanner.toml` carries only a comment on the entry format; `CONTEXT.md` needs no new term.

Implementer 1:
- [x] `docs/adr/0027-grove-cli-over-unix-socket-accepted-risk.md`: the accepted risk, why, when to revisit, follow-ups (unauthenticated `sessions.create`, IPC allowlist and sender validation), and that weekly and manual scan failures arrive only as the failed-run email
- [x] `README.md`: "Dependency scan" section with the `[[IgnoredVulns]]` format (`id`, `ignoreUntil`, `reason`), triggers and the expiry behaviour

Models passed: implementer: inherit (done directly by the planner session), reviewer: inherit

### Review rounds

Round 1: reviewed by the planner session against the diff (docs only, no code). No blocking findings; one claim about the preload's `invoke` surface was reworded to point at the research instead of asserting detail.

approved, 0 blocking, 0 fix rounds.

### Deviations

The planner session wrote the text itself and reviewed it itself rather than through subagents. The note is a new file beside ADR 0027 (not a new numbered ADR) so the 0027 file stays unchanged. `CONTEXT.md` not touched.

### Verification

- `ls docs/adr` shows `0027-grove-cli-over-unix-socket-accepted-risk.md` beside ADR 0027; the plan's greps for `accepted risk|revisit|IPC allowlist|sessions.create` in `docs/adr/*0027*` and `ignoreUntil` in `README.md` and `docs/adr/*` find the new text.
- `npm test` passes (112 files, 1349 tests).
- Models requested: reviewer inherit.

### Left for the human

none

## Final summary

- Slice 1: `2026-11-02-osv-scanner-security-fixes: slice 1 — The OSV scan exists as a PR check`: OSV composite action on pull requests with `osv-scanner.toml`. Review: approved, 0 fix rounds. Deviations: none of substance.
- Slice 2: `slice 2 — Dependencies upgraded, scan clean`: the 9 advisories fixed by exact bumps and transitive updates; scan reports no issues. Review: approved, 0 fix rounds. Deviations: katex and nested commander moved as a consequence of the mermaid pin.
- Slice 3: `slice 3 — All four checks, weekly and manual triggers`: scan, test, typecheck, build on PRs, weekly schedule and manual dispatch, no push trigger. Review: approved, 0 fix rounds. Deviations: none.
- Slice 4: `slice 4 — Failure modes proven and spikes lockfile non-blocking`: expiry proven against the old lockfile, `scripts/check-osv-ignores.mjs` with tests, spikes scan non-blocking. Review: approved, 0 fix rounds. Deviations: `vitest.config.ts` changed to include the script test.
- Slice 5: `slice 5 — Artifact frame, window and CSP hardening (findings 1, 4, 5)`: artifacts no longer open the browser (D4 fallback B), sandboxed window, permission allow-list (D5). Review: approved, 0 fix rounds. Deviations: new `src/main/windowGuard.ts`.
- Slice 6: `slice 6 — Git and paste hardening (findings 6, 7, 8)`: fsmonitor and hooks disabled on read-only git calls, branch and base validation, control characters stripped from pasted text. Review: approved, 0 fix rounds. Deviations: new `src/core/controlChars.ts`; `pr.ts` unchanged.
- Slice 7: `slice 7 — File-handling hardening (findings 9, 10, 11)`: out-of-project discovery roots refused, random 0600 temp files, single-open reads. Review: approved, 0 fix rounds. Deviations: `readFile` added to `Core`.
- Slice 8: `slice 8 — Documentation of accepted risk and follow-ups`: note beside ADR 0027 and a README section on the ignore list. Review: approved, 0 fix rounds. Deviations: note is a new file beside 0027.

### Left for the human

- First GitHub PR run: confirms the pinned action, `--config` handling, permissions, the Linux run (tmux install, Electron download in `npm ci`) and the non-blocking spikes step. `schedule` and `workflow_dispatch` only fire once merged to the default branch. A throwaway PR with an expired entry would prove expiry through the action.
- Set GitHub branch protection to require the four checks (outside this plan).
- Spot-check mermaid diagrams with math in the app (katex 0.18), and open an artifact once in the viewer; links in artifacts no longer open the browser.
- Follow-ups not done: socket authentication, IPC allowlist and sender validation (finding 3).

### PR description

OSV scanner in CI and security fixes

Adds Grove's first CI: an OSV dependency scan (PRs, weekly, manual) with a reviewed ignore list (`osv-scanner.toml`, reason and expiry per entry, validated by `scripts/check-osv-ignores.mjs`), plus separate test, typecheck and build checks on PRs.

- Dependencies: the 9 reported advisories fixed by non-major bumps; the scan is clean.
- Artifact frame, window and CSP: artifact navigation never opens the browser; sandboxed window; permission allow-list (`media` for Grove's own window only).
- Git and paste: fsmonitor and hooks disabled on read-only git calls, branch and base validated, control characters stripped from pasted text.
- Files: discovery roots outside the project refused, random 0600 temp files, single-open reads.
- Docs: control-socket risk recorded beside ADR 0027; README section on the ignore list.

Verified: `npm test` (112 files, 1349 tests), typecheck and build pass; the built app launched with the sandbox on. Left for the human: first PR run on GitHub, branch protection, a manual check of mermaid math and artifact viewing.

## Open questions
