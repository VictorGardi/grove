---
feature: 2026-11-02-osv-scanner-security-fixes
phase: research
status: approved
version: 1
created: 2026-11-02
updated: 2026-11-02
approved_at: 2026-11-02
based_on: []
forced: []
repo_heads: [ed1ea362b9fc9f5b07ad0db24cc04d087b115291]
---

# Research: OSV scanner in CI and security fixes

Facts only. Static reading; nothing was dynamically tested.

## Build, CI and dependencies

- Commands: `npm test` (vitest run), `npm run typecheck` (node + web tsc), `npm run build` (electron-vite build). `postinstall` runs `scripts/fix-spawn-helper.mjs`. README names no Node version; no `engines`, `.nvmrc`, `.npmrc`. Local toolchain node 26.3.0, npm 11.16.0.
- No CI exists: no `.github/`, no other CI config. Remote is `https://github.com/VictorGardi/grove.git`.
- Lockfile: root `package-lock.json` (lockfileVersion 3), tracked. Also `spikes/electron/package-lock.json`. `.claude/` is untracked.
- Nearly all dependencies are exact-pinned; the one ranged dependency is `@fontsource-variable/jetbrains-mono` `^5.3.0`.
- `osv-scanner` is not installed locally. `npm audit` reports 9 vulnerabilities (1 critical, 4 high, 2 moderate, 2 low), all with non-major fixes:

| Package (installed) | Severity | Direct | Fixed in |
|---|---|---|---|
| dompurify 3.4.16 (via mermaid) | critical | no | range `<=3.4.16`; target not named |
| electron 44.5.1 | high | yes (dev) | 44.10.1 |
| markdown-it 15.0.2 | high (quadratic DoS) | yes | 15.0.3 |
| vite 7.3.6 | high (dev-server issues, launch-editor) | yes (dev) | 7.3.7 |
| undici 7.30.0 (via electron/@electron/get) | high | no | range `7.0.0-7.30.0`; target not named |
| vitest 4.1.11 / @vitest/mocker | moderate | yes (dev) | 4.1.12 |
| mermaid 12.1.0 / katex 0.16.47 | low | yes (dev) | mermaid 12.2.0 |

- Packaging: electron-builder is not installed; the `build.asarUnpack` key in `package.json` is unused. electron, react, mermaid are listed as devDependencies but are bundled or run at runtime.

## Security review of the app

No high-severity issue found. Findings, with severity as judged by the review:

1. Artifact iframe `will-frame-navigate` calls `shell.openExternal` for http(s) without a user gesture (`src/main/artifacts.ts:88-109`). A hostile HTML artifact can open the default browser via meta refresh. Board cards render live artifact iframes. Medium/low.
2. Local control socket `<userData>/grove.sock` (mode 0600, dir 0700) has no token or peer check (`src/main/cliServer.ts:171-200`); `sessions.create` with `kind: terminal` is command execution; `GROVE_SOCKET` is exported into every session. Design decision per ADR 0027. Medium.
3. IPC: generic preload `invoke/send/on` with no channel allowlist, no sender validation, no runtime argument validation (`src/main/ipc.ts`, `src/preload/index.ts`). Not exploitable today (no XSS found). Low/medium as defence in depth.
4. Window hardening implicit (`src/main/index.ts:153`: only `preload`, `contextIsolation: true`); no permission handler, no Electron fuses. Low.
5. Renderer CSP (`src/renderer/index.html:8-9`) lacks `base-uri`, `form-action`, `object-src`; `style-src 'unsafe-inline'`. Low.
6. Git runs automatically in untrusted repos (`src/core/diff/git.ts`, `compute.ts`, `worktrees.ts`, `pr.ts`); repo config such as `core.fsmonitor` can execute code. `--no-ext-diff` is already set. Low/medium, suspected.
7. Branch/base names reach git without leading-dash validation (`src/core/worktrees.ts:46,60,80`); `execFile` is used. Low, suspected.
8. Quoted document text is pasted into tmux panes without stripping control characters (`src/core/backend/tmux.ts:98-109`, `src/core/comments/format.ts:40-43`). Low, suspected.
9. Project-declared discovery root can resolve outside the project (`src/core/discovery/folder.ts:18-31`). Low.
10. `atomicWrite` uses a predictable temp name (`src/core/store/jsonFile.ts:4-9`); safe in practice because of 0700 dirs. Low.
11. TOCTOU between realpath check and read in file-viewer paths (`src/core/artifacts/path.ts`, `core.ts:1123-1136`). Low.

Checked and OK: preload exposes no `ipcRenderer`; artifact iframes are sandboxed without same-origin and have a strict response CSP; markdown-it `html:false`; mermaid default `strict`; no `innerHTML`/`eval` sinks in `src` or `resources`; path-traversal guard `safeArtifactPath` with tests; all subprocesses use `execFile`/argv; YAML uses core schema; no hardcoded secrets.

## Open questions
