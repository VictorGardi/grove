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

## Open questions
