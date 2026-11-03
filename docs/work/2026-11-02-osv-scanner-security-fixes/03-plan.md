---
feature: 2026-11-02-osv-scanner-security-fixes
phase: plan
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: [01-outcome.md@1, 02-research.md@1]
forced: []
---

# Plan: OSV scanner in CI and security fixes

## Decisions

### D1. How the OSV scan runs and where the ignore list lives

**Context.** The scan must fail on any finding unless it is on a reviewed ignore list with a reason and an expiry, expired entries must fail again, and the `spikes/electron` lockfile must be scanned without ever blocking. The ignore list format is hard to change once entries accumulate.

**Options.**
- A. The official `google/osv-scanner-action` composite action (not the reusable workflow, which is a job-level `uses` and cannot carry per-step `continue-on-error`), pinned to an exact tag or SHA, with `permissions: contents: read`. Config is a repo-root `osv-scanner.toml` (`[[IgnoredVulns]]` with `id`, `ignoreUntil`, `reason`), passed explicitly with `--config` to the root scan. Two steps: root lockfile (blocking), `spikes/electron` lockfile (`continue-on-error: true`, no config, findings only visible). A small repo test or CI step fails if any `[[IgnoredVulns]]` entry lacks `ignoreUntil` or `reason`, because the tool itself accepts such entries and they never expire. Pros: native expiry support, standard format, little custom code. Cons: depends on the action's and tool's behaviour; first PR run on GitHub is the real confirmation.
- B. Install the `osv-scanner` binary in the job and wrap it in our own script reading our own ignore file. Pros: full control. Cons: we own expiry logic and a custom format.

**Pick:** A

**Outcome impact.** The human edits one familiar file to accept a finding, and expiry works without custom code.

### D2. Where CI runs

**Context.** CI has never existed; the repo pins no Node version and the tests may rely on macOS or tmux. This decides what "green in a clean environment" means.

**Options.**
- A. `ubuntu-latest`, Node 24 (matches `@types/node` 24), set in the workflow only. Pros: cheap, fast. Cons: macOS-only assumptions surface as CI failures to fix once.
- B. `macos-latest`. Pros: matches the dev machine. Cons: slower and costlier.

**Pick:** A

**Outcome impact.** Four PR checks run on Linux; any macOS-only test assumption is fixed or skipped with a recorded reason in slice 3.

### D3. How the vulnerable packages get fixed

**Context.** Seven are direct dependencies with named fixed versions; dompurify and undici are transitive with no named target, and no major upgrades are allowed.

**Options.**
- A. Bump each direct dependency to its fixed version (exact pins kept: electron 44.10.1, markdown-it 15.0.3, vite 7.3.7, vitest 4.1.12, mermaid 12.2.0); for dompurify and undici run `npm update` on them first and add an `overrides` entry in `package.json` only where the parent still resolves a vulnerable range; ignore-list entry (reason, expiry) only if no fixed version exists. Pros: the fixes are real and the ignore list stays short. Cons: overrides can drift from what the parent tested.
- B. Bump direct dependencies and put dompurify and undici on the ignore list. Pros: no overrides. Cons: leaves a critical finding open.

**Pick:** A

**Outcome impact.** The scan starts clean, with the ignore list used only for findings with no fix.

### D4. What artifact links do after the hardening

**Context.** Today any sub-frame navigation to http(s) calls `shell.openExternal` with no user gesture, so a hostile artifact can open the browser by itself. Fixing it can change what a legitimate click in an artifact does.

**Options.**
- A. Keep opening the browser only on a real user click, detected via a user-activation signal on the navigation event; slice 5 first checks whether Electron 44 exposes one for sub-frame navigation. It probably does not, so B is the likely result. Falls back to B, noted in the commit message. Covers both `will-frame-navigate` and `setWindowOpenHandler` in `src/main/artifacts.ts`.
- B. Never open the browser from an artifact frame navigation; links in artifacts do nothing. Pros: simplest and safest. Cons: loses clickable external links in artifacts.

**Pick:** A, falling back to B. Slice 5 first checks Electron 44's `will-frame-navigate` and `setWindowOpenHandler` details for a user-activation field; if none exists (checked in the type definitions under `node_modules/electron/electron.d.ts`), B ships.

**Outcome impact.** Artifacts can no longer open your browser on their own. Likely cost: links clicked inside an artifact stop opening the browser (fallback B), unless Electron offers a reliable click signal.

### D5. Permission handler on the main window

**Context.** Electron allows every permission request when no handler exists. The planned `2026-11-02-stt-voice-input` feature needs `getUserMedia`, so a deny-all handler would break it.

**Options.**
- A. Allow-list handler: allow `media` for Grove's own window origin, deny everything else. Pros: closes the default-allow gap and leaves voice input unblocked. Cons: allows media before any feature uses it.
- B. No handler. Pros: nothing to maintain. Cons: any permission request is silently granted.

**Pick:** A. The origin test accepts the dev server origin and the packaged `file://` origin of the main window, and both `setPermissionRequestHandler` and `setPermissionCheckHandler` are set.

**Outcome impact.** No visible change today; other permission requests are refused.

### D6. How far the git hardening reaches

**Context.** A cloned repo's own config (`core.fsmonitor`, hooks) can execute code when Grove runs git on it. Some users rely on their hooks for explicit actions.

**Options.**
- A. Apply `-c core.fsmonitor=false -c core.hooksPath=/dev/null` only to the read-only calls Grove makes on its own (`status`, `diff`, `ls-files`, `rev-parse`); leave `worktree add`, `submodule update` and `gh` as explicit user actions, only adding branch/base validation. Pros: closes the automatic-execution path and keeps legitimate hooks. Cons: explicit actions in a hostile repo can still run its hooks.
- B. Apply the flags to every git call. Pros: strongest. Cons: breaks legitimate `post-checkout` and similar hooks on worktree creation.

**Pick:** A

**Outcome impact.** Opening or browsing a hostile repo no longer runs its code; worktree creation behaves as before.

## Slices

### Slice 1. The OSV scan exists as a PR check

**Outcome.** A workflow runs the OSV scan on pull requests and reports the known findings; ignore-list config exists.
**Thin end-to-end:** workflow file -> osv-scanner action -> root `package-lock.json` -> `osv-scanner.toml`. Deliberately missing: the other three checks, the weekly and manual triggers, the dependency fixes (the scan is expected to be red here).
**Files.** `.github/workflows/ci.yml` (scan job on `pull_request`, `permissions: contents: read`, composite action at an exact ref), `osv-scanner.toml` (empty ignore list with a comment on the entry format).
**Verification.** The first GitHub PR run is the final confirmation that the action ref, permissions and config work; locally: the workflow parses (`actionlint .github/workflows/ci.yml` if installed, else `ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'`); with `osv-scanner` installed (`brew install osv-scanner` if missing), `osv-scanner scan -L package-lock.json --config osv-scanner.toml` (syntax checked against the installed v1 or v2 with `osv-scanner --help`) exits non-zero and lists the dompurify, electron, markdown-it, vite and undici findings.

### Slice 2. Dependencies upgraded, scan clean

**Outcome.** The 9 reported vulnerabilities are gone, or on the ignore list only where no fix exists.
**Files.** `package.json`, `package-lock.json`, `osv-scanner.toml`, and optionally `spikes/electron/package-lock.json` (left alone by default; its findings never block).
**Verification.** `npm ls dompurify undici` shows non-vulnerable versions; `npm ci && npm test && npm run typecheck && npm run build` pass; `osv-scanner scan --config osv-scanner.toml -L package-lock.json` exits 0, and none of the 9 advisory groups (dompurify, electron, markdown-it, vite, undici, vitest/@vitest/mocker, mermaid/katex) appear in its output. The OSV scan is the source of truth where `npm audit` and OSV disagree.

### Slice 3. All four checks, weekly and manual triggers

**Outcome.** A PR shows scan, test, typecheck and build as separate checks; the scan also runs weekly and by manual dispatch; none run on push to master.
**Files.** `.github/workflows/ci.yml` (test, typecheck, build jobs on Node 24 / `ubuntu-latest`, each with `if: github.event_name == 'pull_request'` so `schedule` and `workflow_dispatch` run the scan only; `schedule` weekly and `workflow_dispatch` added at workflow level), tests or setup only if a macOS-only assumption fails on Linux.
**Verification.** Locally, in a fresh clone in an empty temp directory, `npm ci && npm test && npm run typecheck && npm run build` pass, and `grep -rn "darwin\|afplay\|tmux" src --include=*.test.ts` plus `src/main/sound.ts` are inspected so tests that need macOS or tmux are stubbed, skipped with a reason, or the job installs tmux (`sudo apt-get install -y tmux`); the workflow YAML shows `on:` with `pull_request`, `schedule` (weekly) and `workflow_dispatch` (the three code jobs carry the `pull_request` condition) and no `push`. The first GitHub PR run is the real Linux check.

### Slice 4. Failure modes proven and spikes lockfile non-blocking

**Outcome.** An expired ignore entry fails the scan, an unexpired one passes it, and `spikes/electron` findings never block.
**Files.** `.github/workflows/ci.yml` (second scan step for `spikes/electron/package-lock.json` with `continue-on-error: true`), `scripts/check-osv-ignores.mjs` (parses `osv-scanner.toml`, exits non-zero on an `[[IgnoredVulns]]` entry missing `ignoreUntil` or `reason`), `scripts/check-osv-ignores.test.ts` (vitest, run by `npm test`), a CI step in the scan job running the script, `osv-scanner.toml` (comments only).
**Verification.** In an empty temp directory outside the repo, take the pre-upgrade lockfile (`git show <slice-1-commit>:package-lock.json`), write a config with an `[[IgnoredVulns]]` entry for one of its advisories: with `ignoreUntil` in the past the scan reports it and exits non-zero, with a future date that advisory is suppressed; `npm test` includes the new check's tests, which reject an entry missing `ignoreUntil` or `reason`; the spikes step carries `continue-on-error: true`.

### Slice 5. Artifact frame, window and CSP hardening (findings 1, 4, 5)

**Outcome.** Artifacts cannot open the browser unprompted (per D4); window settings are explicit; the renderer CSP is tighter.
**Files.** `src/main/artifacts.ts`, `src/main/index.ts` (explicit `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, the D5 permission handler, `will-attach-webview` denied), `src/renderer/index.html` (`base-uri 'none'`, `form-action 'none'`, `object-src 'none'`), tests beside existing ones.
**Verification.** `npm test`, `npm run typecheck` and `npm run build` pass; a test or inspection shows neither `will-frame-navigate` nor `setWindowOpenHandler` calls `openExternal` without the signal chosen under D4; the app is launched (`npm run dev`) and the preload bridge is confirmed working under `sandbox: true` (the board loads sessions, so `window.api` exists, since a sandboxed preload with a bad import fails silently), an artifact viewer renders, and the permission handler allows `media` and denies another permission in a unit test.

### Slice 6. Git and paste hardening (findings 6, 7, 8)

**Outcome.** Git no longer runs config-driven code in untrusted repos; branch and base names cannot be read as options; pasted quoted text cannot break out of the terminal paste.
**Files.** `src/core/diff/git.ts`, `src/core/diff/compute.ts`, `src/core/worktrees.ts`, `src/core/pr.ts` (D6: hardening flags on the read-only calls only; branch and base checked with `git check-ref-format --branch` and `--end-of-options` where git supports it), `src/core/backend/tmux.ts`, `src/core/comments/format.ts` (strip C0 and C1 control characters except newline and tab from quoted text and sent text), tests beside each.
**Verification.** `npm test` passes with new tests: a branch name starting with `-` is rejected, a string containing `ESC[201~` comes out without ESC, the read-only git helper includes the hardening flags and the `worktree add` call does not; `npm run typecheck` passes.

### Slice 7. File-handling hardening (findings 9, 10, 11)

**Outcome.** Discovery roots cannot escape the project unintentionally, state files are written safely, and the file-viewer read cannot be redirected between check and read.
**Files.** `src/core/discovery/folder.ts` (`resolveRoot` rejects a root whose real path is outside `projectPath`; ADR 0001 and the code give no sign that out-of-project roots are intended, so this is a behaviour change noted in the commit), `src/core/store/jsonFile.ts` (random temp name, `wx` flag, mode `0o600`), `src/core/artifacts/path.ts`, `src/core/core.ts` (open once, check the opened file, read from the same handle), tests beside each.
**Verification.** `npm test` and `npm run typecheck` pass; new tests show a discovery path outside the project is rejected and one inside still resolves, a pre-planted symlink at the temp name is not followed, overwriting an existing state file (mode 0600) still works, and a symlink swap case reads the checked file.

### Slice 8. Documentation of accepted risk and follow-ups

**Outcome.** The accepted control-socket risk and the out-of-scope IPC finding are recorded; the ignore-list process is written down.
**Files.** a short note next to ADR 0027 in `docs/adr/` (risk, why accepted, when to revisit), `docs/adr/` or `README.md` section on `osv-scanner.toml` entries (reason and expiry), `CONTEXT.md` only if a new term was introduced.
**Files addendum.** The note also records that unauthenticated `sessions.create` and the IPC allowlist (finding 3) are follow-ups, and that weekly and manual scan failures arrive only as GitHub's failed-run email.
**Verification.** `ls docs/adr` shows the note beside ADR 0027; `grep -n "accepted risk\|revisit\|IPC allowlist\|sessions.create" docs/adr/*0027*` and `grep -n "ignoreUntil" README.md docs/adr/*` find the new text; `npm test` still passes.

## Reviewer round log

- CTO check (0 blocking).
- Round 2 (1 blocking, 9 non-blocking). Blocking: D1's ignore-entry check had no file or slice → fixed by adding `scripts/check-osv-ignores.mjs` and its test to slice 4. Applied non-blocking: D4 pick states the fallback and its test, schedule/dispatch conditions on the three code jobs, YAML and osv-scanner syntax checks, spikes lockfile optional, D5 origin and check handler, more risks, D6 residual, slice 8 grep.
- Round 1 (3 blocking, 12 non-blocking). Blocking: slice 4 expiry test ran against a clean tree → fixed by testing against the pre-upgrade lockfile in a temp dir; slice 5 deny-all permission handler would break voice input and was decided silently → fixed by D5 (allow-list); slice 5 sandbox and preload bridge not verified → fixed by a required app launch check. Applied non-blocking: D6 for git flags, `setWindowOpenHandler` covered, composite action versus reusable workflow, config per lockfile, ignore-entry validation, Linux check and tmux, override verification, finding 9 resolved at plan time, jsonFile overwrite test, slice 8 grep, new risks.

## Deviations from the brief the human should know

- Finding 9 (discovery root) becomes a small behaviour change: a root outside the project is refused.
- D4 will probably make links clicked inside artifacts stop opening the browser.
- D5 lets `media` through for Grove's own window now, to keep the planned voice-input feature working.

## Risks and what is deliberately not done

- `sandbox: true` can silently break the preload; slice 5 requires launching the app to check.
- The `0600` state-file mode and the discovery-root rejection could break existing user data or project configs.
- `schedule` and `workflow_dispatch` only fire from the default branch, so they do nothing until the workflow is merged; slice 4's local proof does not exercise the pinned action's `--config` path, so the first GitHub PR run (or a deliberate throwaway PR with an expired entry) is the only check of it.
- Git hardening in D6 leaves other config-driven execution (`core.sshCommand`, `diff.external`, textconv) as residual risk, and `check-ref-format --branch` may reject names git itself accepts.
- First CI run on Linux may expose macOS-only test assumptions (tmux, afplay); fixed or stubbed in slice 3.
- The scan is red after slice 1 until slice 2 lands; nothing merges between them.
- Electron, vite, vitest and mermaid bumps can break build or tests; slice 2 gates on all three.
- `npm ci` downloads the Electron binary through its install step; the first CI run may be slow or fail on that and needs a fix in slice 3.
- A PR check gates nothing unless GitHub branch protection requires it, and the repo is currently committed straight to master. Setting branch protection is outside this plan; the human decides.
- Weekly and manual scan failures arrive only as the failed run and GitHub's email, so a new advisory can sit unseen if that email is ignored.
- Not done: socket authentication, IPC allowlist and sender validation (finding 3), push-to-master trigger, custom alerting, major upgrades, Node pinning in the repo, packaging.

## Open questions
