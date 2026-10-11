# Prior art and hard evidence: macOS agent sandboxing (Seatbelt vs Apple containers vs microVMs)

Research date: 2026-10-10. Scope: existing tools that sandbox coding agents / untrusted code on macOS, what has actually broken in production, and what has actually been measured.

**Source-quality policy for these notes.** Every claim below is tagged with a confidence level:

- **HIGH** = primary source (vendor source code, vendor docs, GitHub security advisory, CVEs, GitHub issue with reproduction).
- **MED** = practitioner report (named individual writing about their own experience) or reliable secondary technical writeup.
- **LOW** = SEO/aggregator content of unknown authorship, or vendor marketing with no supporting measurement. Treat as leads to verify, not findings.

I found one blog (codex.danielvaughan.com) that is heavily cited by search results but is **LLM-generated content** — its "references" point at whole-repo GitHub URLs and a bare `github.com/openai/codex/issues` rather than specific issues, and its code quotes do not match the real source. I have excluded its unique claims and only used it where it happens to agree with a primary source I verified.

---

## 1. OpenAI Codex CLI sandboxing: how it actually works

### Takeaway

Codex CLI is the closest public prior art: it is open source, ships a real macOS Seatbelt implementation with generated SBPL, and has a published CVE for a workspace-boundary escape. On macOS it delegates to `/usr/bin/sandbox-exec` with a dynamically generated profile; **network control on macOS is genuinely binary** (allow-all or deny-all) with no domain filtering, and `.git` is forced read-only by carving `require-not` clauses into the writable root.

### Cited Findings — mechanism and policy shape

- Codex CLI is open source in Rust; the macOS sandbox path lives in `codex-rs/core/src/seatbelt.rs`. `spawn_command_under_seatbelt()` hardcodes `/usr/bin/sandbox-exec`, passes the command plus policy into `create_seatbelt_command_args()`, and sets `CODEX_SANDBOX=seatbelt` in the child env. Every tool call routes through `process_exec_tool_call`, which matches on `SandboxType::{None, MacosSeatbelt, ...}` — sandboxing is **opt-out, not opt-in**. — [Pierce Freeman, "A deep dive on agent sandboxes" (Sept 26 2025)](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH** (quotes actual source with line numbers; I could not re-fetch the file at its current path to byte-verify, so treat the code excerpts as very-likely-accurate rather than confirmed-current)

- The policy layer is a small enum the platform drivers translate from: `ReadOnly`, `WorkspaceWrite` (read all, write only inside project root), `DangerFullAccess`. — [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH**

- **Path scoping:** writable roots are enumerated from policy config, each canonicalised (`wr.root.canonicalize()`) explicitly "to avoid mismatches like `/var` vs `/private/var` on macOS", passed as SBPL `-D WRITABLE_ROOT_n=…` params, and `.git` directories are carved back out to read-only via `(require-not …)` clauses. — [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH**

- **Network egress on macOS is genuinely binary.** The generated policy is literally:
  ```
  let network_policy = if sandbox_policy.has_full_network_access() {
      "(allow network-outbound)\n(allow network-inbound)\n(allow system-socket)"
  } else { "" };
  ```
  i.e. when network is off, the allow rules are simply *omitted* and Seatbelt's default-deny does the rest. There is **no hostname, port, or protocol filtering at the sandbox layer on macOS**. — [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH**

- Contrast: the Linux driver is far more granular — Landlock for filesystem, a seccomp filter denying `connect`, `accept`, `accept4`, `bind`, `listen`, `getpeername`, `getsockname`, `shutdown`, `sendto`, `sendmsg`, `sendmmsg` (deliberately leaving `recvfrom` open so `cargo clippy` can run), plus a `bubblewrap` path with mount/PID/network namespaces. — [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH**

- **Environment scrubbing:** `spawn_child_async` calls `cmd.env_clear()` then repopulates only an explicit allowlist; when network is disabled it also sets `CODEX_SANDBOX_NETWORK_DISABLED=1`. This is the defence against leaking `AWS_SECRET_ACCESS_KEY` / `GITHUB_TOKEN` from the parent shell into agent-run commands. — [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH**

- **Official docs confirm the macOS mechanism and the mode names** but say almost nothing about policy internals: "On **macOS**, sandboxing works out of the box using the built-in Seatbelt framework." Modes are `read-only`, `workspace-write` (the default low-friction mode), `danger-full-access`; escalation is via `sandbox_workspace_write.writable_roots` and per-command `rules`. — [Codex Sandboxing docs](https://developers.openai.com/codex/sandboxing.md) — **HIGH** (vendor docs)

- **Documented limits (vendor's own words):** Codex docs explicitly steer users away from broadening the sandbox — "Keep the project boundary as the default; use separate projects or worktrees instead of broadening access across unrelated repositories." Full access is defined as `sandbox_mode = "danger-full-access"` **plus** `approval_policy = "never"`, i.e. two independent switches. — [Codex Sandboxing docs](https://developers.openai.com/codex/sandboxing.md) — **HIGH**

- **Codex deliberately blocks the agent from editing its own instructions.** `.agents/` subdirectories are write-protected by default; OpenAI's engineer closed the issue explaining "Allowing an agent to update its own instructions represents a security issue, so it's important that all such modifications are done with express consent from the user." The user's only fix was to add an absolute path to `writable_roots` — and a commenter flagged that this is unusable for a *project-level* policy because absolute paths can't be committed to a repo. — [openai/codex#11597](https://github.com/openai/codex/issues/11597) — **HIGH**

- Codex denies write to `/git`, `/.codex`, `/.agents` even inside a writable root on Windows, and treats them as "read-only within writable" locations. — [OpenAI, "Building a safe, effective sandbox to enable Codex on Windows"](https://openai.com/index/building-codex-windows-sandbox) — **HIGH** (vendor)

### Cited Findings — real-world failures (Codex)

- **CVE-2025-59532 / GHSA-w5fx-fh39-j5rw (High), published 19 Sep 2025.** Codex CLI `0.2.0 <= 0.38.0` (and IDE extension `<= 0.4.11`) treated a **model-generated `cwd` as the sandbox writable root**, including paths outside the folder the user started the session in. This "bypassed the intended workspace boundary and enables arbitrary file writes and command execution where the Codex process has permissions". Fixed in CLI 0.39.0 by canonicalising and validating that the boundary is based on where the *user* started the session, not the model. Credited to Tzanko Matev (Codetracer). — [GHSA-w5fx-fh39-j5rw](https://github.com/openai/codex/security/advisories/GHSA-w5fx-fh39-j5rw) — **HIGH**

- **Root cause class:** the failure was not a Seatbelt weakness — it was a *policy-generation* weakness. The SBPL was correct; the paths fed into it were attacker-influenced. This is the single most transferable lesson in the whole survey. — [GHSA-w5fx-fh39-j5rw](https://github.com/openai/codex/security/advisories/GHSA-w5fx-fh39-j5rw) — **HIGH** (my characterisation of the described mechanism, directly supported by the advisory's own remediation wording)

- **Same bug class in the IDE extension:** vscode-codex *overwrote* `sandbox_workspace_write.writable_roots` with the currently-open project folder rather than appending to it, silently discarding configured roots. Reported by a user; maintainer said "this is correct, the extension users your open workspace folders as writable roots"; reporter reopened arguing the CLI behaviour (append cwd to configured roots) is the correct one. Consequence reported: git worktree use case broke, and users had to whitelist `.git` to work around it. — [openai/codex#8029](https://github.com/openai/codex/issues/8029) — **HIGH**

- **Escalation-flag incoherence:** `codex app-server` launched tool commands through `codex-linux-sandbox` with `{"type":"read-only"}` even when the app-server was started with `--dangerously-bypass-approvals-and-sandbox`. Caught via `strace`. Reproduced on 0.111.0 and 0.112.0, app-server path only, not `codex exec`. Still open. — [openai/codex#14068](https://github.com/openai/codex/issues/14068) — **HIGH**

- **Shared-fate bug across vendors:** Claude Code's `allowAllUnixSockets` did not emit `(allow network-bind (local unix-socket))`, so `npx tsx` (an IPC server) failed with `listen EPERM` inside the sandbox. The reporter notes **Codex hit the same issue and fixed it in openai/codex#12702**. Closed as `not_planned`/`stale`. — [anthropics/claude-code#41254](https://github.com/anthropics/claude-code/issues/41254) — **HIGH**

### Inferences

- Codex's macOS posture is **"blast-radius reduction", not "hostile-code containment"**. Nothing in the design defends against an *adversarial* model; the published CVE was caused by trusting model output, which is exactly the failure a hostile-model threat model cares about. Anyone reusing Codex's approach should treat the CVE-2025-59532 root cause (never let agent-generated values define the policy boundary) as a mandatory design rule, not a historical bug.
- The macOS/Linux asymmetry is real and is a *product* decision, not an accident: macOS has no seccomp or Landlock, and Seatbelt's network filter has no domain primitive, so macOS genuinely cannot offer what Linux can. Treating macOS sandboxing as "Linux sandboxing but worse" is wrong; it is a different, coarser tool.
- Codex's `.git`-is-read-only + no-self-edit rules are a pattern worth stealing: the highest-value thing to protect is not the user's data but the *agent's own control plane* (its instructions, its hooks, its history), because that is the cheapest path from "sandboxed" to "unsandboxed".

### Gaps

- **Could not retrieve the current `codex-rs/core/src/seatbelt.rs` source.** `raw.githubusercontent.com/openai/codex/main/codex-rs/core/src/seatbelt.rs` returned **404**, and the GitHub code-search API returned **401** (unauthenticated). The Freeman excerpts are from Sept 2025 and cite `codex-rs/core/src/seatbelt.rs`; Codex has been heavily refactored since (the 2026 docs describe `codex sandbox`, `permission_profile = ":workspace"`, `requirements.toml` for enterprise enforcement, and a separate Windows account model). **The 2025 code excerpts should be treated as historically accurate but potentially stale on current structure.** Someone with GitHub API access should re-verify.
- **No measured performance data for Codex's macOS sandbox found.** No benchmarks of Seatbelt overhead on real build workloads.
- **I could not verify whether macOS network control on Codex is still binary in 2026.** The 2026 docs page I fetched discusses `sandbox_workspace_write.writable_roots`, permissions *profiles*, and `requirements.toml` with `allowed_domains`, but I did not fetch the full configuration reference, so there may now be a domain allowlist feature that Freeman's 2025 code reading did not cover. **Do not assert "binary only" without checking the current config reference.**
- The Daniel Vaughan Codex-internals article cites a specific issue number (`#10390`) for the binary-network limitation and a symlink-traversal fix; **I could not verify either issue exists** and the article appears machine-generated. Excluded.

---

## 2. `sbx` — what it is and whether it is relevant

### Takeaway

`sbx` is Docker's dedicated CLI for **Docker Sandboxes**, which are *not containers on the host* but **one microVM per sandbox with its own Linux kernel**, its own Docker daemon, and a host-side intercepting proxy that injects credentials and enforces an allow/deny domain policy. It is directly relevant to grove's design debate and its most-cited weakness is **performance** — a named practitioner called the slowdown "crippling" and reported it as *the* deal-breaker.

### Cited Findings

- **`sbx` is a Docker product.** Docker Sandboxes "run AI agents in isolated environments"; the docs state "It might surprise you that this actually *isn't* built on containers, but rather on isolated microVM sandboxes." `sbx` is the standalone CLI that replaced the older Docker Desktop–bundled `docker sandbox run`, specifically so it "doesn't require docker desktop". — [Docker Sandboxes docs](https://docs.docker.com/ai/sandboxes/) and [Andrew Lock, "Running AI agents safely in a microVM using docker sandbox" (7 Apr 2026)](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Isolation model:** each sandbox has its own kernel; a separate Docker engine runs *inside* the microVM so agents can build containers without mounting the host Docker socket; the network is isolated from the host with a proxy on the host side that blocks access to the host's localhost and injects authentication headers so the sandbox never sees the API keys. Only the workspace directory is shared read-write. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) quoting [docs.docker.com/ai/sandboxes/security](https://docs.docker.com/ai/sandboxes/security/) — **HIGH**

- **Platform support:** "Only macOS (arm64) and Windows (x86_64, Windows 11) are currently supported." Requires the `HypervisorPlatform` feature on Windows. Installable via `winget install -h Docker.sbx` or from `github.com/docker/sbx-releases`. **Requires `sbx login`** — an interactive browser sign-in to Docker, and the product is behind a Docker Subscription Service Agreement. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH** (practitioner hands-on; the login requirement and subscription gating are directly observed)

- **`sbx` CLI surface:** `create`, `run`, `exec`, `ls`, `rm`, `stop`, `reset`, `save`, `policy`, `ports`, `secret`, `login`, `logout`, `completion`, `version`. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Network policy: three tiers, chosen interactively at first login** — `Open` (all traffic), `Balanced` (default-deny with common dev sites allowed), `Locked Down` (all blocked unless allowed). The `Balanced` allowlist is a fixed, shipped list grouped into five categories. **I captured the full domain list; representative entries:** *default ai services* includes `api.anthropic.com:443`, `chatgpt.com:443`, `gemini.google.com:443`, `platform.claude.com:443`, `statsig.anthropic.com:443`, `models.dev:443`; *default package managers* is a ~50-entry list including `registry.npmjs.org`, `pypi.org`, `crates.io`, `proxy.golang.org`, `repo.maven.apache.org`, `swift.org`, `rubygems.org`; *default code and containers* includes `github.com`, `ghcr.io`, `docker.io`; *default cloud infrastructure* includes `**.amazonaws.com`, `dev.azure.com`, `supabase.com`, `vercel.com`; *default os packages* is Debian/Ubuntu/Fedora/Arch mirrors. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Known gap in `Balanced`: documentation sites are missing.** Andrew's assessment: "it's notably missing things like documentation sites, so if your agent needs to go out to Microsoft learn (for example), it's going to be stuck. I think that could be a big gap in the balanced mode, so I switched to 'open' mode." — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH** (named practitioner, direct experience, specific reasoning)

- **On policy curation:** "It looks like a nice way to limit the blast radius of a rogue agent, but I feel like I'd always be running into limitations, trying to curate the policies. Seems like a useful 'organisation policy' level control, but frankly I'm probably just going to run it in open mode. The sandbox ensures the agent can't mess up my system, and as it doesn't have access to any of my keys or private data, I'm not too worried about what sites it tries to access." — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH** (this is the key practitioner insight: **network allowlisting inside a strong isolation boundary is largely theatre if the boundary already denies access to your data**)

- **Memory behaviour:** the earlier Docker Desktop version was capped at **4 GB, non-configurable**, which made it "virtually unusable" for large projects (Andrew cites the DataDog `dd-trace-dotnet` repo). `sbx` adds `--memory` and **defaults to 50% of host memory**. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Supported agents:** Claude Code, Codex, Copilot, Gemini, Kiro, OpenCode, Docker Agent. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) and [docs.docker.com/ai/sandboxes](https://docs.docker.com/ai/sandboxes/) — **HIGH**

- **Git integration is a real workflow wart.** Two modes: *direct* (agent edits your working dir and commits to the real repo — "it has access to the *whole* git history, so technically the agent *could* end up breaking your git repo") and *branch* (creates a git worktree in a `.sbx/` subfolder inside your repo root, which then shows up as untracked in `git status` and requires gitignoring). Andrew's recommended posture: "make sure you have a backup (e.g. you've pushed to a remote repository)… Or alternatively, work on an entirely separate clone of the repo." Also: creating your own worktree and pointing the sandbox at it **breaks commits**, because the agent loses access to the parent git repo. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Commit signing is unsolved.** 1Password's `ssh-agent` signing does not work inside the sandbox; Andrew's workaround is unsigned commits in the sandbox, then a host-side rebase to sign them all at the end. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Commercial status:** "`The sbx CLI and local sandbox compute are free to use, including for commercial work. Cloud compute uses a pay-as-you-go subscription.`" — [docs.docker.com/ai/sandboxes](https://docs.docker.com/ai/sandboxes/) — **HIGH** (vendor docs; directly relevant to grove's licensing question — *local* compute is free for commercial use, but a `sbx login` is still required)

- Docker ships org-level governance for local sandboxes "across developer machines" — network, filesystem, and MCP policies — but "Available on a separate paid subscription." — [docs.docker.com/ai/sandboxes](https://docs.docker.com/ai/sandboxes/) — **HIGH** (vendor)

### Name collisions (flagged, since the assignment asked)

There are at least two other things called `sbx` that are **not** Docker:

- `sbx` is used as a session-suffix constant inside Anthropic's own sandbox runtime: `const sessionSuffix = \`_${Math.random().toString(36).slice(2, 11)}_SBX\`` — [anthropic-experimental/sandbox-runtime `macos-sandbox-utils.ts`](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**
- The `exec-sandbox` PyPI package (QEMU/HVF microVM execution) documents a `sbx prefetch` command for warming asset caches. — [PyPI exec-sandbox](https://pypi.org/project/exec-sandbox/0.16.0) — **MED** (vendor README; may just be an alias or a different binary)

**grove's rejected tool is unambiguously Docker Sandboxes' `sbx`.** grove's own docs already use it that way — `docs/work/2026-10-08-agent-sandboxing/03-design.md:141` records "Rejected: … `sbx`/Docker (needs Docker VM, seconds of startup…)" and `01-questions.md:51` records "`sbx run`, `sbx policy`". — **HIGH**

### Inferences

- **The `Balanced` allowlist is directly reusable prior art** for grove's own design (grove's questions doc explicitly resolved to "Use Docker Sandboxes (`sbx`) default allow-list as reference"). The list is concrete, versioned by Docker, and covers the AI-provider + package-registry + code-hosting + cloud-infra surface. The gap Andrew found — no documentation sites — is a real design lesson: a default allowlist that omits docs pushes users to open mode.
- **The strongest argument for a microVM boundary over a MACF sandbox is not security theatre, it is that it makes network policy optional.** Andrew's own reasoning ("I'm probably just going to run it in open mode") is the honest position: if the agent cannot read your credentials or your home directory, egress control stops being your first line of defence. This inverts the usual framing — a weaker boundary makes the network allowlist load-bearing, a stronger boundary makes it optional.
- **`sbx`'s local compute is free for commercial use**, which removes the licensing objection. The remaining objections are: login/service dependency, 50%-of-host-RAM default, the `.sbx/` worktree gitignore wart, and the performance complaint below.

### Gaps

- **No primary Docker statement of microVM startup time or memory footprint found.** `docs.docker.com/ai/sandboxes/architecture/` was not fetched. The "seconds of startup" claim in grove's own `03-design.md` is **not yet sourced** and should be verified against the architecture page or measured directly.
- **No independent benchmark of `sbx` performance found** — only Andrew Lock's qualitative "crippling". He did not quantify it and did not identify the cause (bind-mount throughput? VM I/O? memory pressure from the 50% default?). **This is the single most important thing to measure for grove.**
- **The `Balanced` allowlist as shipped in April 2026 may have changed.** It is not version-pinned in the blog post. Anyone relying on it should run `sbx policy ls` and capture the current output.
- The exact behaviour of `sbx policy allow/deny` for adding a domain was not demonstrated (only `sbx policy ls` and `sbx policy reset` are shown).

---

## 3. Other coding-agent and dev-tool sandboxes on macOS

### Takeaway

Nearly every serious coding agent on macOS converged on **Seatbelt via `sandbox-exec`** — Codex, Claude Code, Cursor, and Gemini CLI all use it, for the same reasons (zero setup, no VM startup, kernel-enforced, confines the whole subprocess tree). The one outlier is Cursor's Linux path, which uses Landlock+seccomp+overlayfs rather than a shipped tool. Cline/Roo Code/Aider/Continue do **no** OS-level filesystem confinement of their own — they are human-in-the-loop approval UIs, or they defer to Dev Containers.

### Cited Findings

- **Claude Code — Seatbelt, via a standalone OSS runtime.** Anthropic ships `@anthropic-ai/sandbox-runtime` / `anthropic-experimental/sandbox-runtime`, a TypeScript library that generates the SBPL. Claude Code bundles it. The macOS launch is `env <vars> /usr/bin/sandbox-exec -p "<ENTIRE SEATBELT PROFILE>" /bin/zsh -c "<command>"`. — [anthropics/claude-code#73468](https://github.com/anthropics/claude-code/issues/73468) — **HIGH** (issue author says "paraphrased from the bundled `@anthropic-ai/sandbox-runtime`"; corroborated by the library's own source, below)

- **The generated Claude Code profile is default-deny and quite specific.** From the runtime's `generateSandboxProfile()`: starts `(version 1)` / `(deny default (with message "<logTag>"))`, then allows `(allow process-exec)`, `(allow process-fork)`, `process-info*`/`signal`/`mach-priv-task-port` **only when `(target same-sandbox)`**, then a hand-curated **allowlist of 15 Mach services** (no wildcard): `com.apple.audio.systemsoundserver`, `com.apple.distributed_notifications@Uv3`, `com.apple.FontObjectsServer`, `com.apple.fonts`, `com.apple.logd`, `com.apple.lsd.mapdb`, `com.apple.PowerManagement.control`, `com.apple.system.logger`, `com.apple.system.notification_center`, `com.apple.system.opendirectoryd.libinfo`, `com.apple.system.opendirectoryd.membership`, `com.apple.bsd.dirhelper`, `com.apple.securityd.xpc`, `com.apple.coreservices.launchservicesd`. Comment in source: "Essential permissions - based on Chrome sandbox policy". — [sandbox-runtime `macos-sandbox-utils.ts`](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Claude Code's mandatory write-deny list** (`macGetMandatoryDenyEntries`): every entry in `DANGEROUS_FILES` and `getDangerousDirectories()`, emitted **twice** — once as a literal relative to cwd, once as an anchored `**/<name>` glob so it applies anywhere beneath cwd. Always blocked: `.git/hooks` (both spellings). Conditionally blocked unless `allowGitConfig`: `.git/config`. — [sandbox-runtime `macos-sandbox-utils.ts`](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Claude Code has much richer network control than Codex on macOS — via a proxy, not via Seatbelt.** The profile opens loopback TCP only to `httpProxyPort`/`socksProxyPort` and injects `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` env vars pointing at it, plus a per-session `proxyAuthToken` embedded in the proxy URL and a TLS-termination CA cert injected as trust env vars. A Java agent jar is injected via `JAVA_TOOL_OPTIONS`. Denials are reported back via a base64 `CMD64_<encoded>_END_<session>_SBX` log tag that Seatbelt's `(with message …)` returns — the library parses the macOS sandbox log to reconstruct violations. — [sandbox-runtime `macos-sandbox-utils.ts`](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**. **This directly contradicts the common claim that Seatbelt cannot do egress control** — it cannot do it *in SBPL*, but a supervised proxy that is the *only* reachable thing is enforced at the Seatbelt layer. See §7 for the important caveat about this not being airtight.

- **Cursor — Seatbelt on macOS, and the most explicit public rationale for choosing it.** Cursor evaluated four approaches: App Sandbox, containers, VMs, Seatbelt. App Sandbox "would require Cursor to sign every binary an agent might execute… opened up new abuse vectors by allowing agent-generated or modified binaries to inherit Cursor's trust"; containers "would limit us to Linux binaries"; VMs "impose unacceptable startup latency and memory overhead". "This left Seatbelt, accessed via `sandbox-exec`. It was introduced in 2007 and deprecated in 2016, but is still used by critical third-party applications like Chrome." — [Cursor, "Implementing a secure sandbox for local agents" (18 Feb 2026)](https://cursor.com/blog/agent-sandboxing) — **HIGH** (vendor, but the *rejection reasoning* is the valuable part and is specific and checkable)

- **Cursor generates its policy at runtime from workspace settings, admin settings, and the user's `.cursorignore`.** Published example of the deny rules it emits: `.vscode`, `.cursor` (except `rules|commands|worktrees|skills|agents`), `*.code-workspace`, `.cursorignore`, `.git/config`, `.git/hooks`, and its own `/var/folders/…-cursor…-zsh` temp dir. — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **HIGH**

- **Cursor's Linux path is different in kind:** Landlock + seccomp, with workspaces mapped into an **overlay filesystem** so `.cursorignore`d files are replaced with unreadable copies. "Finding and remounting these files is the slowest part of Linux sandboxing." Cursor's own framing: "It would be easier to lazily filter filesystem operations the way macOS does, but Linux doesn't provide easy access to the file path in a seccomp-bpf context." Windows is **WSL2 with Cursor's Linux sandbox**, not a native Windows sandbox. — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **HIGH**

- **Cursor's measured outcome:** "Sandboxed agents stop 40% less often than unsandboxed ones, saving users hours of manual review and approval." (Vendor's own production telemetry — a vendor claim, not independently verified.) — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **MED** (vendor measurement)

- **Cursor's usability finding is more valuable than its security finding:** a sandbox that blocks commands the agent didn't anticipate causes the agent to **retry the same failing command**. Cursor's fix was harness-side, not policy-side: surface the sandbox constraint in the Shell tool result and recommend escalation. — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **HIGH** (vendor, but a specific and reproducible mechanism)

- **Cursor documents its sandbox env vars:** `CURSOR_SANDBOX` = `"seatbelt"` (macOS) or `"native"` (Linux); `CURSOR_ORIG_UID` = launching user's UID, captured **before** the sandbox applies identity changes. Requires Cursor v2.0+. — [cursor.com/docs/agent/security/run-modes](https://cursor.com/docs/agent/security/run-modes) — **HIGH** (vendor docs)

- **Gemini CLI — Seatbelt with an explicitly permissive default.** macOS Seatbelt is auto-detected (`commandExists.sync('sandbox-exec')` on darwin). "Default profile: `permissive-open` — denies operations by default; confines writes to the project directory while **allowing broad file reads and network access**." Built-in profiles selectable via `SEATBELT_PROFILE`. Also supports Docker/Podman, gVisor `runsc` (explicit only, not auto-detected), and LXC. — [gemini-cli `docs/cli/sandbox.md`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md) and [`sandboxConfig.ts`](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/config/sandboxConfig.ts) — **HIGH**

- **Cline / Roo Code — no OS-level sandbox.** Their own README: "While autonomous AI agent scripts traditionally run in sandboxed environments, this extension provides a human-in-the-loop GUI to approve every file change and terminal command." Sandbox isolation is available only by adding an MCP server pointing at a remote sandbox (E2B Firecracker), or by running VS Code itself inside a Dev Container. — [Roo-Cline README](https://github.com/chb3/Roo-Cline) and [Fastio, Cline Code Interpreter Workspace](https://fast.io/resources/cline-code-interpreter-workspace) — **HIGH** (README is primary; Fastio is vendor content marketing for a competing product, so treat its framing as interested)

- **Dev Containers — container-based, committed to the repo.** VS Code runs client-server: UI on the host, editor backend + extensions inside the container. Isolation granularity is the Docker container. Community writeups describe the pattern as `host → docker → container → agents`, with the practical benefit being team reproducibility plus the fact that `~/.ssh`, cloud credentials and browser sessions "live up here and the container never sees them". — [Dan Lopatenco, Medium (22 May 2026)](https://medium.com/@danlopatenco/how-i-let-claude-code-codex-other-agents-into-my-codebase-without-giving-them-my-home-37b036658bc8) — **MED** (practitioner blog; the VS Code client-server architecture is uncontroversial and documented)

- **Also using Seatbelt:** Gemini CLI (above), `safedep/pmg` (package-manager guard: "macOS | Yes | Seatbelt sandbox-exec", Landlock default on Linux 5.13+ with Bubblewrap fallback) — [safedep/pmg docs/sandbox.md](https://github.com/safedep/pmg/blob/main/docs/sandbox.md) — **HIGH**; Microsoft `mxc` (JSON policy → SBPL, applied via `sandbox_init()` between `fork()` and `exec`, CI on macOS 15 **and macOS 26** Apple silicon) — [microsoft/mxc seatbelt-backend.md](https://github.com/microsoft/mxc/blob/main/docs/seatbelt/seatbelt-backend.md) — **HIGH**

### Cited Findings — the mechanism's hard limits, documented by people who hit them

- **Seatbelt has no hostname primitive — this is not an opinion.** Microsoft's `mxc` implementation *rejects* such rules outright: "Allow/deny by hostname ❌ Rejected — no such primitive in Seatbelt. Allow/deny by IP, CIDR, port, or protocol ❌ Rejected — no such primitive. The short version: Seatbelt gives you an on/off switch for outbound network plus a loopback exception… Its `(remote ...)` filter accepts only `*` and `localhost` — nothing else is even syntactically valid." — [mxc seatbelt-backend.md](https://github.com/microsoft/mxc/blob/main/docs/seatbelt/seatbelt-backend.md) — **HIGH**

- **Seatbelt cannot deny unix-domain sockets via the network policy** — they match by *path*, so they are governed by the filesystem policy. `mxc` notes that a `deny` therefore also cuts the sandbox off from its own loopback listeners, "since a Seatbelt sandbox shares the host's network stack". — [mxc seatbelt-backend.md](https://github.com/microsoft/mxc/blob/main/docs/seatbelt/seatbelt-backend.md) — **HIGH**. Corroborated independently by `safedep/pmg`: "SBPL network rules do not confine unix-domain sockets; the macOS sensitive-UDS surface is small, so this is a documented boundary." — [safedep/pmg](https://github.com/safedep/pmg/blob/main/docs/sandbox.md) — **HIGH**

- **A Seatbelt sandbox shares the host network stack.** There is no network namespace. Consequence: loopback services on the host are reachable unless you deny them, and `(allow network-bind (local ip "localhost:*"))` grants nothing about egress. — [mxc](https://github.com/microsoft/mxc/blob/main/docs/seatbelt/seatbelt-backend.md), and the Codex sandbox shares this property — **HIGH**

- **The `read-only` Seatbelt stance has no private tmpfs.** `safedep/pmg`: "explicit writable paths and `/dev/null` stay allowed, so on seatbelt read-only means no host writes beyond those exceptions (there is no private tmpfs to fall back on)." — [safedep/pmg](https://github.com/safedep/pmg/blob/main/docs/sandbox.md) — **HIGH**. This is a substantive architectural difference from Linux, where you can always give a process a private `/tmp`.

- **Homebrew/package managers are a known pain point**, quoted from an HN thread on Seatbelt: "If you use a native Mac sandbox then it'd need to ask permission to use homebrew. Maybe you can find a way to run homebrew inside a Mac sandbox but it won't be straightforward." — quoted in [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **MED** (HN comment via secondary source; I did not fetch the HN thread directly)

- **"Policy complexity leads to security holes"** — another HN quote Freeman reproduces: "The bug I reported (in an AI agent sandbox using Seatbelt) was that it failed to properly block off access to the user's home directory dotfiles and `~/Library`. This sort of mistake is easy to make with Seatbelt but harder to make with containers." — quoted in [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **MED** (same caveat; the underlying bug report was not located)

- **The consumer view of Seatbelt's status is contested.** One HN commenter: "the sandbox subsystem is what all of Apple's system software uses for sandboxing, as well as many security-conscious third-party programs such as web browsers. It's not going away anytime soon." — quoted in [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **MED**

- **Chrome is the canary, and Chrome's own team treats Seatbelt profiles as a maintenance burden that must be re-audited on every OS update.** Chromium's Mac Sandbox V2 design doc exists to "improve security on macOS by sandboxing the currently unsandboxed **warmup phase** of Chromium child processes" — the warmup phase called system frameworks "before it was sandboxed, and those resources change with every new OS update from Apple." The stated benefit of enumerating resources explicitly: "it is possible to accurately audit Chromium's attack surface for each new macOS version." Chromium requires an OWNERS review of every new policy before landing. — [Chromium seatbelt_sandbox_design.md](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/sandbox/mac/seatbelt_sandbox_design.md) (last updated 2025-01-30) — **HIGH**

- **A key Seatbelt property that shapes everything:** file descriptors opened *before* the sandbox applies remain usable. Chromium exploits this deliberately ("a common pattern is to first open any needed resources, then apply the sandbox policy"). Any policy generator must therefore apply the profile as early as possible. — [Chromium The Mac Sandbox README](https://chromium.googlesource.com/chromium/src/+/HEAD/sandbox/mac/README.md) and [OSX Sandboxing Design](https://chromium.googlesource.com/playground/chromium-org-site/+/refs/heads/main/developers/design-documents/sandbox/osx-sandboxing-design.md) — **HIGH**

### Inferences

- **Convergence on Seatbelt is a real signal, not herd behaviour.** Four independent teams (OpenAI, Anthropic, Cursor/Anysphere, Google) each evaluated alternatives and landed on `sandbox-exec` for the macOS local-agent case. Cursor's published rejection of App Sandbox (signing agent-generated binaries) and VMs (startup latency + memory) is the crispest statement of why.
- **The interesting divergence is not Seatbelt-vs-VM, it is Seatbelt-*how*.** Codex's macOS profile is minimal (writable roots + `.git` carve-out + binary network). Cursor's is richer (derived from `.cursorignore`, regex denies). Claude Code's is by far the most elaborate — Mach service allowlists, `same-sandbox` targeting, deny-glob/`require-not` re-emission to survive last-match-wins, unlink re-denies, path-spelling normalisation for `/var` vs `/private/var`, glob-vs-literal disambiguation so a directory named `a[b/c]d` doesn't compile into a character class. **That elaboration is itself the evidence about how hard Seatbelt policy generation is.**
- **For grove specifically:** the `permissive-open` default in Gemini CLI ("allows broad file reads and network access") is a useful calibration point — it shows that a Seatbelt agent sandbox in practice defaults to *write* confinement, not *read* confinement, because read confinement breaks toolchains.

### Gaps

- **No evidence found for Aider or Continue** doing OS-level filesystem confinement on macOS. Neither appeared in any search result in this survey. Likely no sandbox at all (approval-based / read-only-diff model), but **I did not verify this** — treat as unconfirmed.
- **Windsurf did not appear in any source.** No mechanism identified. **Gap.**
- **No Windsurf/Cline/Roo/Aider/Continue security advisories or escape reports found.** The entire "real-world failures" corpus for macOS agent sandboxes is dominated by Claude Code and Codex. I found **no published CVEs for Cursor's Seatbelt sandbox, Gemini CLI's Seatbelt sandbox, `sandbox-runtime`, or `sbx`.** Either they are young, or people are not reporting there.
- **The HN thread on Seatbelt (`news.ycombinator.com/item?id=44283454`) was not fetched directly.** Two quotes above come via Freeman's summary of it; the original discussion may contain more.
- I did not verify the `sandbox-runtime` version currently bundled in Claude Code, nor whether the profile I read from `main` matches what Claude Code ships.

---

## 4. Real-world failures: published escapes, CVEs, and serious complaints

### Takeaway

Every published escape I found is a **policy-generation or policy-composition bug, not a Seatbelt bypass**. Nobody has published a macOS kernel or Seatbelt-policy bypass. The recurring root causes are: (a) agent-generated values leaking into the boundary definition, (b) `last-match-wins` ordering mistakes, and (c) protecting a path that didn't exist when the profile was built.

### Cited Findings — CVEs and advisories

- **CVE-2026-55607 / GHSA-7835-87q9-rgvv (High), 25 Jun 2026 — Claude Code sandbox escape via git worktree path confusion.** Affected `= 2.1.38, < 2.1.163`, patched 2.1.163. "Claude Code's worktree handling allowed creation of worktrees named `.git` and navigation to worktrees outside the sandbox context, enabling git directory confusion attacks. By exploiting symlink manipulation and git `fsmonitor` execution during worktree operations, an attacker could overwrite files in the user's home directory (such as `.zshenv`), **leading to code execution outside of seatbelt sandbox restrictions**." Precondition: "Reliably exploiting this required the user to clone a malicious repository containing prompt injection content and run Claude Code against it." Credited to hackerone.com/metnew. CWE-22 (path traversal) + CWE-59 (improper link resolution). — [GHSA-7835-87q9-rgvv](https://github.com/anthropics/claude-code/security/advisories/GHSA-7835-87q9-rgvv), [GitLab GLAD mirror](https://advisories.gitlab.com/npm/@anthropic-ai/claude-code/CVE-2026-55607/) — **HIGH**

- **CVE-2026-25725 / GHSA-ff64-7w26-62rf (High), 6 Feb 2026 — Claude Code sandbox escape via persistent configuration injection.** Affected `< v2.1.2`. Root cause is a **TOCTOU-class mistake**: "Claude Code's bubblewrap sandboxing mechanism failed to properly protect the `.claude/settings.json` configuration file **when it did not exist at startup**. While the parent directory was mounted as writable and `.claude/settings.local.json` was explicitly protected with read-only constraints, `settings.json` was not protected if it was missing. This allowed malicious code running inside the sandbox to create this file and inject persistent hooks (such as `SessionStart` commands) that would execute with host privileges when Claude Code was restarted." CWE-668. Credited to hackerone.com/edbr. — [GHSA-ff64-7w26-62rf](https://github.com/anthropics/claude-code/security/advisories/GHSA-ff64-7w26-62rf) — **HIGH**

  *Note:* the advisory text says "bubblewrap" but the repo issue context and Claude Code's macOS path use Seatbelt; the advisory appears to be describing the mechanism generically or the Linux backend. The escape concept is platform-independent (create-if-missing a file the parent dir lets you write).

- **CVE-2025-59532 / GHSA-w5fx-fh39-j5rw (High), 19 Sep 2025 — Codex sandbox bypass via model-generated cwd.** (Detailed in §1.) — **HIGH**

- **Full exploit-chain analysis exists for CVE-2026-55607** at penligent.ai, describing it as a chain of primitives beginning with a malicious repository supplying agent instructions. — [penligent.ai](https://www.penligent.ai/hackinglabs/cve-2026-55607) — **MED** (security-vendor content; I did not read the full chain, only the search snippet, and it explicitly says the official advisory "confirms the principal elements")

### Cited Findings — serious complaints (non-security failures that make a sandbox unusable)

- **The ARG_MAX failure — the single best-documented real-world macOS sandbox failure.** `anthropics/claude-code#73468` (2 Jul 2026, v2.1.197, macOS Darwin arm64, still open): Claude Code passes the **entire Seatbelt profile inline as a command-line argument**. On a machine with ~1,000 worktrees across ~100 repos, the profile crosses ~1 MB and `argv`+`envp` exceeds macOS `ARG_MAX` (1,048,576 bytes), so `posix_spawn('/bin/zsh')` fails with `E2BIG: argument list too long` **before any command runs**. Symptom: `printf ok` fails. "The sandbox becomes 100% unusable and the only workaround is disabling it entirely." The reporter verified the environment was *not* the cause (~80 vars, ~12 KB) — "the sandbox wrapper itself is." — [anthropics/claude-code#73468](https://github.com/anthropics/claude-code/issues/73468) — **HIGH**

- **Measured quantification of that bug** (comment on the sibling issue #73437): "bisected threshold on 2.1.199: **8 registered worktrees ✅ / 11 ❌**, i.e. **~75 KB argv cost per worktree**; static base profile alone **>256 KB at zero worktrees**." — quoted in [anthropics/claude-code#73468](https://github.com/anthropics/claude-code/issues/73468) — **HIGH** (named reporter, bisected, numbers given)

- **The scale of the profile is directly explained by the runtime source:** for each git worktree, Claude Code emits one deny rule per git config file, e.g. `(deny file-write* (literal "<repo>/.git/worktrees/<name>/config.worktree"))` and the `.lock` variant. The runtime source confirms this shape — `groupLiteralDenyPaths` exists specifically to fold `<gitdir>/worktrees/<name>/{commondir,config.worktree}` into one anchored regex per chunk instead of one `subpath` filter per path. — [anthropics/claude-code#73468](https://github.com/anthropics/claude-code/issues/73468) and [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **The upstream fix, verified live by the reporter:** `sandbox-exec -f <tempfile>` instead of `-p`. "at 225 deny paths, sandbox-exec argv drops to **218 bytes** and the wrapped command executes under a real seatbelt profile (live test subset 48 pass / 0 fail)." — [anthropics/claude-code#73468](https://github.com/anthropics/claude-code/issues/73468) — **HIGH**

- **`sandbox-exec` has its own string-literal size limit.** `sandbox-exec` rejects a string literal longer than **1025 bytes** with "Error reading string". The runtime consequently caps generated regexes at `SBPL_STRING_MAX_BYTES = 900`, with the comment: "the regexes built below stay well under that, since **one oversized string invalidates the whole profile**." — [sandbox-runtime `macos-sandbox-utils.ts`](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Invalid SBPL fails silently.** `anthropics/claude-code#39635` (v2.1.85, macOS Darwin 25.3.0): setting `sandbox.filesystem.denyRead: ["/"]` produced invalid SBPL for deny-with-exceptions (`require-not` inside deny clauses), and **every bash command failed with exit code 1, no output, and no error**. Reporter: "Either generate valid SBPL with separate deny/allow rules, or surface the `sandbox-exec` error instead of silently returning exit code 1." Diagnosed by Claude Code itself via iterative `sandbox-exec -p` testing. Fixed. — [anthropics/claude-code#39635](https://github.com/anthropics/claude-code/issues/39635) — **HIGH**

- **A related Linux-side report:** `#32226 — denyRead ineffective on Linux/bubblewrap (different root cause: rules not enforced vs. sandbox aborting here)` — **MED** (referenced, not read).

- **Denying the root inode breaks dyld.** From the runtime source, comment on issue `#190`: "`(subpath "/")` — or a re-emitted `/*`-shaped glob — denies the root inode itself; no `allowWithinDeny` entry covers `/`, so **dyld aborts before exec**." The fix is a narrow `(allow file-read* (literal "/"))` emitted after the re-emitted denies, with the note that this "exposes `ls /` dirent names but no subtree contents". — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **The agent will keep retrying the blocked command.** Cursor found this was "a common failure mode" in their Cursor Bench evals: "the agent would repeatedly retry the same terminal command without changing permissions." Fix was harness-side. — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **HIGH**

- **Approval fatigue is the failure mode sandboxes exist to fix, and it is real.** Andrew Lock: "The real problem is that Claude asks this for *endless* things. Want to use `grep`? Confirm permission. Want to use `sed`? Confirm permission. Want to use `cd` [because Claude Code doesn't understand Windows]? Confirm permission. This is an absolute *killer* for productivity… constantly switching between terminal windows." — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH** (practitioner, with a linked upstream issue for the `cd`-on-Windows case: anthropics/claude-code#30524). Cursor's framing of why this matters: "as approvals accumulate, users stop inspecting them carefully." — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **HIGH**

- **Codex users hit the sandbox constantly for toolchains that live outside the project.** Pierce Freeman's own first experience: he had Codex iterate on a Swift project with `swift build`, and it "kept failing with a clang permissions error. Clang was installed and working fine when I ran it manually." Root cause: "Codex default launches in the mode where it only has access to the current folder… The swift toolchain lives outside the project directory, so of course it couldn't access it." — [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH** (first-person practitioner report, reproducible)

- **Codex's own escalation path for this:** "If a sandboxed command fails due to permissions, the system asks if you want to retry unsandboxed." — [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH**

### Cited Findings — the deep Seatbelt-specific failure modes (from Anthropic's runtime source)

These are the most valuable technical findings in the whole survey, because they are **documented by the team that shipped the escapes and fixed them**.

- **Seatbelt is strictly last-match-wins.** The runtime's rule-ordering contract, spelled out in `generateReadRules`: emit `(allow file-read*)` → `(deny file-read* …)` → `(allow file-read* …)` for carve-outs → then **re-emit every deny the allow block would clobber**, narrowing globs with `require-not`. The code comment names the invariant: "**Every filter here is a deny or a narrower deny: nothing this function produces can make a path readable that is not readable today.**" — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Specific operation denies are not overridden by wildcards.** "in macOS Seatbelt, a specific `(deny file-write-unlink)` is **not overridden** by a later `(allow file-write*)` wildcard — the specific operation deny wins. This means file deletions are blocked even in write-allowed directories like the project directory. We fix this by explicitly re-allowing `file-write-unlink` and `file-write-create` for write-allowed paths after the move-blocking deny rules." — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **A concrete, worked escape that Seatbelt's semantics create, and the fix.** `generateReadDenyUnlinkRules` exists because: "Any read-denied path INSIDE a write root is therefore movable again: **`mv .env x; cat x`**, or `mv secrets s2; cat s2/key`, defeats both glob and literal denies." The fix is a trailing `(deny file-write-unlink …)` block — deny unlink but *not* create, "so new files can still be made; a new `.env` is still read-denied by name". This is a **destructive rename bypass of read-deny rules**, and it is exactly the kind of thing grove must handle if it does read confinement. — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Move-blocking requires denying ancestors, with a side-effect you must plan for.** `generateMoveBlockingRules` "denies `file-write-unlink` and `file-write-create` on each deny path AND on its ancestor directories. The intent: stop `mv ~/.config/foo ~/.config/bar` then `cat ~/.config/bar`. **But this also kills file deletions inside write-allowed dirs** because Seatbelt evaluates specific denials before generic allows." — [sandbox-runtime-handbook, 05-filesystem-isolation-macos.md](https://github.com/SpaceX-mit/sandbox-runtime-handbook/blob/main/handbook/05-filesystem-isolation-macos.md) — **HIGH**

- **The glob-anchoring trap — a bug class that would be easy to reproduce.** Source comment: "a cwd like `a[b/c]d` would turn into a character class and **every one of these denies would match nothing**." The fix is a two-way split between `PathEntry` with `glob: false` (names on disk, compiled to `subpath`) and `glob: true` (caller-written patterns, compiled to `regex`), decided **once** by whoever produced the spelling and never re-derived from the characters. — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Path-spelling normalisation is mandatory on macOS.** Every path gets `normalizePathForSandbox()`, and read entries are emitted in **two spellings** (`inBothSpellings`) — as written, and with symlinks/links on the way resolved — because a deny has to cover both the alias and the real target. Codex does the equivalent via `canonicalize()`. — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts), [Freeman](https://pierce.dev/notes/a-deep-dive-on-agent-sandboxes) — **HIGH**

- **A read-deny needs a `file-read-metadata` escape hatch or `realpath()` breaks.** "Allow stat/lstat on all directories so that `realpath()` can traverse path components within denied regions. Without this, C `realpath()` fails when resolving symlinks because it needs to lstat every intermediate directory… This only allows metadata reads on directories — not listing contents (`readdir`) or reading files." — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Credential masking is not achievable in SBPL on macOS.** Source comment on `maskedFileBinds`: "SBPL cannot redirect reads, so on macOS these **degrade to read-deny** on `realPath` until the DYLD interposer lands." So "mask this credential file to a fake path" — the strongest form of secret protection — is **not available** in Seatbelt today. `safedep/pmg` independently reaches the same conclusion about Seatbelt vs Landlock asymmetry. — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Named-platform quirk:** on macOS 14/15, `open`/`osascript` need `(allow lsopen)` plus Mach lookups for `coreservicesd` and `quarantine-resolver`, "without these open fails with -10822 kLSServerCommunicationErr or -54". — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **Go TLS verification needs a weakened-network-isolation escape hatch:** `(allow mach-lookup (global-name "com.apple.trustd.agent"))`, opt-in via `enableWeakerNetworkIsolation`, with the source comment marking it "(weaker network isolation)". — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**

- **IPv4-mapped IPv6 loopback defeats Seatbelt's `localhost` token.** "modern runtimes (Java, etc.) create IPv6 dual-stack sockets by default; binding such a socket to 127.0.0.1 is represented in the kernel as `::ffff:127.0.0.1`, which Seatbelt's `localhost` filter does not match. Seatbelt only accepts `localhost` or `*` as the host token, so `*:*` is the only way to admit the IPv4-mapped form." And the corresponding egress risk, tracked as #225/#88: "A `(local ip ...)` filter on `network-outbound` is evaluated against the source address, which for an unbound socket is `INADDR_ANY`… Seatbelt's `localhost` matches the any-address, so **any `(local ip ...)` host value admits every outbound connection**." — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**. **This is a live security-relevant footgun in Claude Code's own profile generation.**

- **Seatbelt policy compilation cost is order-of-magnitude sensitive to filter count.** Source comment on `groupLiteralDenyPaths`: "Each group renders as one anchored regex per chunk of names instead of one `subpath` filter per path, so a directory with many same-shaped children costs bytes and profile compile time proportional to the names, not to the repeated absolute prefix (**`sandbox-exec` compiles a few thousand path filters in seconds; a few dozen regexes in milliseconds**)." — [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH** (the best hard performance datapoint I found for `sandbox-exec`; see §6)

### Inferences

- **Confidence: HIGH — the pattern across all four published advisories is that the MACF primitive held and the policy generator failed.** Not one advisory describes a Seatbelt filter that didn't do what it said. If grove wants a single design rule, it is: *no value produced by the model or by filesystem traversal at runtime may define the sandbox boundary.* Compute the boundary from the invocation site only, canonicalise it, and emit deny rules for paths whether or not they exist.
- **Confidence: HIGH — read confinement on macOS via Seatbelt is a significantly harder engineering problem than write confinement, and the difficulty is in ordering, not in rule syntax.** Claude Code's runtime is ~1700 lines of TS for this; `safedep/pmg`, `mxc`, and Codex each needed their own careful handling of the same last-match-wins semantics. If grove's design is filesystem-confinement-only (per ADR 0036), this supports that scoping; if it ever grows read-deny rules, the `mv .env x; cat x` class of bypass is the thing to test for.
- **Confidence: MEDIUM — the "usability tax" of Seatbelt is a bigger driver of real-world failure than the security risk.** Every serious complaint I found (Swift toolchain blocked, tsx EPERM, `cd` on Windows, `.agents/` read-only, repeated retries) is about the sandbox blocking legitimate work. The security escapes were all found by security researchers via HackerOne, not by users.
- **Confidence: MEDIUM — the `sandbox-exec -f` vs `-p` choice is a genuine design decision, not a micro-optimisation.** `-p` puts an unbounded, attacker-influenceable profile into `argv`, which is both an ARG_MAX failure mode (measured at ~75 KB/worktree, breaking at 8–11 worktrees) and an unusual exposure. `-f` costs a temp file and removes the failure mode entirely (218 bytes of argv at 225 deny paths).

### Gaps

- **No published Seatbelt, sandbox-exec, or macOS-kernel sandbox escape was found.** Not from Claude Code, Codex, Cursor, Gemini CLI, `sandbox-runtime`, or `sbx`. This is a meaningful negative result but I cannot distinguish "no one has found one" from "no one is publishing them here."
- **The HN thread `news.ycombinator.com/item?id=44283454`** (Seatbelt status/deprecation) was not read directly; two quotations above are Freeman's summary of it.
- **I did not read the full exploit chain for CVE-2026-55607** at penligent.ai — only the search snippet. The primary advisory's own summary is what I relied on.
- **I did not investigate the "MOSAIC 96.59% attack rate" or "CIPR repository poisoning" claims** surfaced in search results. Both come from the same apparently machine-generated blog and I could not verify them; **do not treat these as real** without independent confirmation.
- **No data on how often these CVEs are exploited in the wild**, or on HackerOne disclosure volume for Claude Code / Codex.
- Andrew Lock mentions "1Password's SSH agent signing remains problematic" but the second post (on custom templates) was not read; there may be more measured detail there.

---

## 5. Performance: measured overhead

### Takeaway

**I did not find a clean, sourced benchmark of `sandbox-exec`/Seatbelt overhead on a real build workload.** What I did find: one hard datapoint on `sandbox-exec` *compile* time from Anthropic's source, one hard datapoint on `sandbox-exec` *spawn* time (<5 ms) from a container-runtime author, one hard comparison of native-vs-VM startup (~800 ms, +128 MB) from the same author, and one practitioner verdict on microVM agent sandboxes being "crippling" with no quantification.

### Cited Findings

- **`sandbox-exec` compile time scales with filter count, badly.** "sandbox-exec compiles **a few thousand path filters in seconds; a few dozen regexes in milliseconds**." (This is why Claude Code's runtime aggressively groups literal deny paths into anchored regexes.) — [sandbox-runtime `macos-sandbox-utils.ts`](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts) — **HIGH**. This is a *compile-time* cost, incurred once per command, and is the only Seatbelt performance number I found stated as a measurement.

- **Native sandbox-exec startup is <5 ms.** A container-runtime author benchmarking their own `containerd-shim-darwin` reports falling back to Linux VMs "Increases startup latency from **<5ms to ~800ms** and adds **128MB+ RAM overhead per pod**." — [apple/containerization#737](https://github.com/apple/containerization/issues/737) — **MED** (self-reported by the author of the shim, in an issue; not independently benchmarked, but the delta is large and directionally consistent with everything else)

- **`sbx` performance is a reported deal-breaker, unquantified.** Andrew Lock: "The final issue, performance, which has, unfortunately, been the deal breaker for me in many cases. Even for simple projects, I've found that the performance hit from running in a sandbox can be crippling. I only recently ran into this issue (I swear it wasn't so much of an issue a couple of weeks ago), so I'm *hoping* it's something that will be addressed soon." — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **MED** (one named practitioner, no numbers, no identified cause). He had tested on **Windows 11**, not macOS — a material caveat.

- **`sbx` memory default is 50% of host RAM**, with `--memory` to override. The predecessor Docker Desktop version was hard-capped at 4 GB. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Apple's own VM start claim is "sub-second".** WWDC26 session "Containerization" on `container machine`: "Reviews the open-source Containerization Swift framework — its architecture, **VM-based isolation, sub-second start times**, and the companion `container` CLI tool." Design principles named: "fast and lightweight, simple to create and operate, persistent across sessions, and a seamless extension of macOS." — [WWDC26 session 389 transcript](https://developer.apple.com/videos/play/wwdc2026/389/) — **HIGH** (vendor; "sub-second" is Apple's number for its own product)

- **Cloud microVM sandboxes: 80–200 ms.** E2B claims sandboxes "start in less than 200ms" in-region and advertises 80 ms on its Pro tier; Firecracker is the VMM. A vendor-neutral-ish analysis puts Daytona at ~90 ms vs E2B ~150 ms at parity pricing, and usefully decomposes what that gap actually costs: at 10,000 sandboxes/day it is **10 minutes of aggregate wall-clock spread across 10,000 independent executions**, i.e. a latency question only for serial agent chains (12 steps × 60 ms = 720 ms added to p50), not a cost question at any realistic scale. It also notes the framing that matters: "you should read the 60 ms not as overhead but as **the price of the boundary**." — [bex.co, "Daytona's 90ms vs E2B's 150ms"](https://bex.co/blog/2026/08/06/daytona-e2b-cold-start-benchmark-agent-sandboxes) — **MED** (the underlying numbers are vendor claims; the decomposition is the analyst's and is sound arithmetic; note this is about **cloud** microVMs with snapshot-restore, a much faster regime than a cold local VM boot)

- **The local-VM cold-boot vs snapshot-restore distinction matters enormously and is easy to miss.** A QEMU/HVF microVM comparison table: warm-pool snapshot **1–2 ms** to first exec; L1 memory-snapshot **~100 ms**; L2/L3 cold boot **~400 ms boot + 4–11 s interpreter cold-start**; E2B Firecracker **~80–150 ms** (always snapshots with the interpreter warm, "so they never have this penalty"); QEMU is heavier than Firecracker (~5 MiB VMM overhead). — [PyPI `exec-sandbox`](https://pypi.org/project/exec-sandbox/0.16.0) — **MED** (vendor README for a competing product; treat the QEMU-vs-Firecracker and snapshot-tier numbers as indicative rather than benchmarked, but the *shape* — that cold interpreter startup dominates and snapshotting eliminates it — is well-established)

- **Cursor's VM rejection was on latency and memory, with no number given:** "virtual machines impose unacceptable startup latency and memory overhead." — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **HIGH** (vendor statement of intent; **no figure published**)

- **A relevant non-sandbox performance datapoint from the Codex side:** there is no measurable throughput cost claimed for the Seatbelt path anywhere; the entire Codex macOS sandbox story is presented as zero-overhead. This is a vendor framing and I found nothing supporting or refuting it. — **LOW/absent**

### Inferences

- **Confidence: MEDIUM — the dominant performance cost of a microVM agent sandbox on macOS is almost certainly *not* VM boot (~800 ms once per session) but I/O on the bind-mounted workspace plus memory pressure from a large VM default.** Andrew's report is that even *simple* projects are "crippling", which is inconsistent with a boot-time explanation; and he had just migrated off a 4 GB cap to a 50%-of-host-RAM default, which is a plausible contributor. grove's own `01-questions.md` already flags "bind-mount throughput tax on many-small-file workloads" as the expected cost — that hypothesis is consistent with the available evidence but **I found no published measurement of it**.
- **Confidence: MEDIUM — Seatbelt's *runtime* enforcement cost is unmeasured in public, but is structurally likely to be small**, because it is a MACF check in the VFS path with a pre-compiled binary policy and no namespace/VM setup. Contrast with Landlock/bwrap (namespace setup, mount operations) and microVMs (full guest kernel). *This is reasoning from architecture, not a measurement* — flag it as such.
- **Confidence: HIGH — the one Seatbelt cost that IS documented and IS large is policy *compilation*, and it scales with the number of literal path filters, not with the number of rules in the abstract.** A design that emits one `(subpath …)` filter per protected path will pay seconds. A design that emits regexes pays milliseconds. This is a concrete, actionable engineering finding for grove and it costs nothing to design for up front.
- **Confidence: LOW — I cannot rank Seatbelt vs Apple `container` vs `sbx` on measured performance from public sources.** Anyone making that call for grove needs to run the benchmark themselves.

### Gaps

- **The headline gap: no published measurement of `sandbox-exec` overhead on a real build/test workload.** No before/after wall-clock for `npm run build`, `cargo test`, `swift build`, etc., inside vs outside a Seatbelt profile. I searched for this explicitly and it does not appear to exist publicly.
- **No measured numbers behind Andrew Lock's "crippling".** He did not isolate VM boot, memory, or bind-mount I/O, and he was on Windows.
- **No independent macOS benchmark of `sbx`** (all reports I found are the single Windows-based practitioner post).
- **No published numbers for Apple `container` CLI cold start, memory footprint, or bind-mount throughput.** Apple's only figure is "sub-second start times" for `container machine` (a *persistent* machine, which is the faster case). `docs.docker.com/ai/sandboxes/architecture/` was not fetched and may contain Docker's numbers.
- **Apple's `container` one-VM-per-container architecture means the per-agent cost is a full VM, not a shared one** — the implication for grove's per-session cost is significant but unquantified in any source I read.

---

## 6. Layered approaches: MACF sandbox + container/VM

### Takeaway

Layering is explicitly advocated and explicitly practised, but the credible practitioner position is that **layering a Seatbelt policy inside a microVM is mostly redundant for security and pure overhead for speed** — unless the inner agent is one that has its own sandbox you'd rather not trust. Everyone converges on the same stack shape: proxy at the host, boundary in the VM, credential injection at the proxy.

### Cited Findings

- **Docker's own architecture is a four-layer stack with the proxy outside the boundary.** From the security diagram Andrew reproduces: agent process + Docker engine + packages + VM filesystem are *inside* the VM; host filesystem, host processes, host Docker engine, and host network are *outside and not accessible*; the workspace directory is shared read-write; "a proxy enforces allow/deny policies and injects credentials into outbound requests." — [docs.docker.com/ai/sandboxes/security](https://docs.docker.com/ai/sandboxes/security/) via [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Layering Seatbelt inside a microVM is explicitly proposed** by a practitioner-adjacent comparison: "Running Codex CLI inside a Docker sandbox (`sbx run codex`) gives you the built-in Seatbelt/Bubblewrap restrictions *plus* microVM isolation. Adding OpenShell policies on top provides granular network filtering and inference routing. Each layer catches what the others miss." — [codex.danielvaughan.com](https://codex.danielvaughan.com/2026/04/24/agent-sandbox-comparison-codex-seatbelt-openshell-docker-sbx/) — **LOW** (machine-generated blog; the *concept* is sound and matches Docker's design, but I do not trust this source's specifics and would not cite it)

- **The realistic layer stack for any agent sandbox is:** (1) model/harness layer — approval policy and prompt; (2) agent-internal sandbox — Codex's Seatbelt, Claude Code's `sandbox-runtime`; (3) OS/host layer — Seatbelt directly, or a VM/microVM boundary; (4) network — a proxy outside the boundary, whether or not the inner sandbox can reach it. All four production systems surveyed have all four. — synthesised from [Codex docs](https://developers.openai.com/codex/sandboxing.md), [Cursor blog](https://cursor.com/blog/agent-sandboxing), [sandbox-runtime source](https://github.com/anthropic-experimental/sandbox-runtime/blob/main/src/sandbox/macos-sandbox-utils.ts), [Docker sandboxes](https://docs.docker.com/ai/sandboxes/) — **HIGH** (each layer individually sourced; the synthesis is mine)

- **NVIDIA OpenShell is the one product designed explicitly as a *layer*, not a replacement.** It layers Landlock+seccomp sandbox, a policy engine evaluating actions at binary/destination/method/path level, and a privacy router. Its distinguishing design claim: **filesystem and process policies are static** (locked at sandbox creation), while **network and inference policies are hot-reloadable** via `openshell policy set` without restarting the sandbox. It supports unmodified agents including Claude Code, Codex CLI, and OpenCode. Linux-only as of April 2026. — [docs.nvidia.com/openshell policies](https://docs.nvidia.com/openshell/latest/sandboxes/policies) and [NVIDIA Technical Blog](https://developer.nvidia.com/blog/run-autonomous-self-evolving-agents-more-safely-with-nvidia-openshell/) as cited in the comparison article — **LOW/MED**. I did **not** fetch either NVIDIA source directly; all I have is them being cited. **The static-FS/dynamic-network split is a genuinely interesting design idea worth verifying independently if it matters to grove.**

- **The strongest statement of what layering actually buys you is Andrew Lock's, and it is about the network layer, not the filesystem layer:** "The sandbox ensures the agent can't mess up my system, and as it doesn't have access to any of my keys or private data, I'm not too worried about what sites it tries to access" — i.e. with a strong boundary, the egress allowlist is *redundant*; with a weak boundary (Seatbelt alone, sharing the host network stack and the host filesystem), the egress allowlist is *load-bearing and probably insufficient*. — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

- **Community practice: agents inside Dev Containers with `--dangerously-skip-permissions`, *not* agent-internal sandboxes.** The established pattern is to run the agent in `bypassPermissions`/`danger-full-access` inside a container, because the container is the boundary and the in-container sandbox adds nothing. Andrew Lock's whole thesis: "The idea is that you can just let your agents run amok, without having to babysit them." — [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) and [Dan Lopatenco, Medium](https://medium.com/@danlopatenco/how-i-let-claude-code-codex-other-agents-into-my-codebase-without-giving-them-my-home-37b036658bc8) — **HIGH**

### Inferences

- **Confidence: MEDIUM-HIGH — the industry has converged on "strong boundary OR good in-process sandbox", not both.** Running an agent in bypass mode inside a container is the dominant practitioner pattern; running it sandboxed-on-the-host is the dominant vendor pattern. Almost nobody does both for the same session, because the second layer's main cost (approval friction, policy generation bugs) is paid without a proportionate security gain when the first layer already holds.
- **Confidence: MEDIUM — the layer that genuinely *does* compose well is the proxy, because it lives outside every boundary.** All three strong designs (Docker sbx, Claude Code's sandbox-runtime, NVIDIA OpenShell) put an intercepting proxy at a layer the sandboxed process cannot bypass, and inject credentials there rather than into the environment. This is the one pattern I'd call prior art worth copying regardless of which boundary grove picks — and it is exactly the "local proxy for granular per-host control" grove's `01-questions.md:91` resolved to.
- **Confidence: MEDIUM — the one case where layering is clearly worth it is an untrusted agent *harness*, not untrusted code.** If grove runs third-party or user-supplied agent configurations, an inner Seatbelt profile around the harness protects against a malformed harness even when the outer container holds.
- **Confidence: MEDIUM — the static/dynamic policy split (OpenShell) is the most interesting unresolved design question in this survey.** The observed failure mode everywhere is "policy needs to change mid-session and changing it is expensive or requires restart" (Codex's FS policies are restart-bound; Docker's `sbx policy` changes need a sandbox restart). If grove's sessions are long, hot-reloadable network policy independent of static FS policy is a differentiator — **but I could not verify OpenShell's behaviour from a primary source.**

### Gaps

- **NVIDIA OpenShell was not read from a primary source.** Everything I have about it is second-hand via a machine-generated blog. **Verify at [docs.nvidia.com/openshell](https://docs.nvidia.com/openshell/latest/sandboxes/policies) before relying on it.**
- **No published cost-benefit analysis of layering exists.** Everything above is reasoning.
- **`docs.docker.com/ai/sandboxes/architecture/` not fetched** — likely the best source for what Docker claims about its isolation and workspace-mounting design.
- **No evidence found on whether Docker `sbx` applies any Seatbelt policy to the *host-side* `sbx` process itself** (only inside the VM), or whether `sbx`'s host daemon is privileged.

---

## 7. macOS 26 (Tahoe) era changes

### Takeaway

The big 2026 development is **Apple shipping first-party container tooling** (`container` / `containerization`, one-VM-per-container via Kata) which reframes the VM option from "Docker Desktop's big shared VM" to "Apple's own, sub-second, per-container VM". Simultaneously, **Apple has confirmed that `sandbox-exec` has no replacement** — the issue asking Apple to clarify the deprecation timeline is assigned to an Apple engineer and still open. In short: the VM path got much better; the Seatbelt path is on notice with no successor.

### Cited Findings

- **Apple's first-party `container` uses one-VM-per-container, not a shared VM.** "Unlike traditional container engines like Docker Desktop, which typically run all containers within a single shared Linux virtual machine (VM), Apple Container utilizes a **'one-VM-per-container' architecture** to improve security and resource isolation." Each container runs in its own lightweight Linux VM using Kata containers. Built on the `apple/containerization` Swift package and macOS `Virtualization.framework`, "with no need for an additional hypervisor." Introduced at WWDC25. — [Wikipedia, "Apple container"](https://en.wikipedia.org/wiki/Apple_container) — **MED** (Wikipedia, but sourced to Apple's own WWDC material and the apple/container repo)

- **`container machine` (WWDC26) adds persistent Linux environments with the host home directory mounted.** "Your repo lives in `$HOME` on macOS and is mounted at `/Users/<username>` inside the container machine. Use your macOS editor or IDE; compile and run inside your container machine." Design principles: "fast and lightweight, simple to create and operate, **persistent across sessions**, and a seamless extension of macOS." — [WWDC26 session 389](https://developer.apple.com/videos/play/wwdc2026/389/) and [apple/container `docs/container-machine.md`](https://github.com/apple/container/blob/main/docs/container-machine.md) — **HIGH**

- **Apple's claimed performance:** "VM-based isolation, **sub-second start times**." — [WWDC26 session 389](https://developer.apple.com/videos/play/wwdc2026/389/) — **HIGH** (vendor claim, no published benchmark)

- **`container machine` supports nested virtualization** (M3 or later, macOS 15+, Linux kernel with `CONFIG_KVM=y`) — i.e. Apple explicitly designed for the case where you want to run KVM workloads inside. — [apple/container `docs/container-machine.md`](https://github.com/apple/container/blob/main/docs/container-machine.md) — **HIGH**

- **Apple's `container` still has real gaps as of March 2026 (v0.11.0):** no native Docker Compose support (bridged only by third-party projects like Container-Compose); Dev Container support is partial — "networking issues, no support for setup scripts etc." — [Wikipedia, "Apple container"](https://en.wikipedia.org/wiki/Apple_container) — **MED**

- **There are open Virtualization.framework reliability bugs on current macOS.** `apple/container#1254`: "[Bug]: VirtualizationFramework fails to start any containers… This appears to be a macOS Virtualization.framework bug affecting macOS Sequoia 26.x on ARM64. **This blocks all Apple Container usage on macOS**." — [apple/container#1254](https://github.com/apple/container/issues/1254) — **HIGH** (a user-filed bug report with maintainer-confirmed framing; severity claim is the reporter's, but a blocking bug in the current release line is material to grove's risk assessment)

- **Apple has been asked, directly, what the Seatbelt replacement is — and has not answered.** `apple/containerization#737`, opened 12 May 2026 by the author of `containerd-shim-darwin`. The issue states: "`sandbox-exec(1)` is the only documented mechanism for applying Seatbelt (TrustedBSD MAC) policies to arbitrary user-space processes on macOS without enrolling in the App Store or using Xcode entitlements. Apple marks it as deprecated" — with the reproduced warning `WARNING: sandbox-exec is deprecated. Consider adopting the App Sandbox instead.` — and enumerates why each alternative fails: App Sandbox "requires code signing with the `com.apple.security.app-sandbox` entitlement and an Xcode project… designed for GUI apps distributed through the Mac App Store, not for headless server processes compiled with `go build`"; Endpoint Security "does not offer a declarative sandbox profile that restricts a child process at exec time"; System Extensions are "distribution-gated and inappropriate for per-process isolation". It asks Apple three questions: will `sandbox-exec` be removed, is there a non-deprecated equivalent (e.g. a documented `sandbox_init_with_parameters` C API), and will Apple Containerization offer a "lite" mode that sandboxes a darwin/arm64 process without a Linux VM. — [apple/containerization#737](https://github.com/apple/containerization/issues/737) — **HIGH**

- **Apple has acknowledged the issue.** It is **assigned to `katiewasnothere`** (assigned 18 May 2026) and remains **Open** as of the last activity. A user comment (13 Sep 2026) says they "submitted FB24765111 for this". — [apple/containerization#737](https://github.com/apple/containerization/issues/737) — **HIGH**. This is meaningful: Apple's container lead owns the "please document the Seatbelt deprecation timeline" ticket.

- **Cursor's stated deprecation date for `sandbox-exec`:** "introduced in 2007 and **deprecated in 2016**, but is still used by critical third-party applications like Chrome." — [Cursor blog](https://cursor.com/blog/agent-sandboxing) — **HIGH** (vendor). Note: the deprecation banner `#737` reproduces is from macOS 15 Sequoia, not Tahoe — **the banner still present in Tahoe 26 would suggest no removal has occurred.** I did not verify on Tahoe 26 specifically.

- **Seatbelt profiles must be re-audited on every macOS release — this is an ongoing cost, not a one-time one.** Chromium's own justification for the V2 design: enumerating resources explicitly "is possible to accurately audit Chromium's attack surface **for each new macOS version**." — [Chromium seatbelt_sandbox_design.md](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/sandbox/mac/seatbelt_sandbox_design.md) — **HIGH**

- **Microsoft's `mxc` runs its Seatbelt backend CI on macOS 15 *and* macOS 26** (Apple silicon), and requires "macOS 15 (Sequoia) or later" as a minimum — evidence that Seatbelt is alive and maintained on Tahoe by third parties. — [microsoft/mxc seatbelt-backend.md](https://github.com/microsoft/mxc/blob/main/docs/seatbelt/seatbelt-backend.md) — **HIGH**

- **Apple's `container` supports x86_64 binaries under Rosetta via `VZLinuxRosettaDirectoryShare`** and improved TSO memory model for Rosetta. — [Apple Virtualization docs](https://developer.apple.com/documentation/virtualization) — **HIGH** (vendor docs). Relevant only if grove's agent sessions must run x86 toolchains.

- **VM use on macOS requires the `com.apple.security.virtualization` entitlement**, and `HypervisorPlatform` on Windows. Signing/distribution friction exists but is modest for a CLI. — [Apple Virtualization docs](https://developer.apple.com/documentation/virtualization), [Andrew Lock](https://andrewlock.net/running-ai-agents-safely-in-a-microvm-using-docker-sandbox/) — **HIGH**

### Inferences

- **Confidence: HIGH — the macOS calculus genuinely changed in 2026, but in a direction that favours the VM/container option more than the Seatbelt option.** Apple's own tooling removes the old objection ("VMs are slow and heavy because Docker Desktop runs one big VM"), while the Seatbelt deprecation question is formally open with Apple and unanswered. If grove picks Seatbelt, it is picking a primitive Apple has publicly been asked to replace and has declined to commit either way on.
- **Confidence: MEDIUM — the risk is asymmetric and worth stating plainly.** Picking Seatbelt risks: no announced replacement, a macOS release that removes or hardens `sandbox-exec`, and permanent policy-maintenance burden. Picking Apple `container` risks: a tool in active development (v0.11.0 in March 2026, no Compose, partial Dev Container support), an open blocking Virtualization.framework bug on 26.x, and a **one-VM-per-container** cost model that is well-measured nowhere.
- **Confidence: MEDIUM — `container machine` (persistent, host `$HOME` mounted at `/Users/<username>`) is architecturally closer to grove's needs than plain `container run`.** A persistent machine avoids per-session VM boot entirely and gives the agent the real macOS home path structure. grove's design explicitly binds worktrees under a macOS home path, so the `/Users/<username>` mount is a direct fit. This is worth investigating as an alternative to short-lived containers — **but I found no practitioner report on running agents inside `container machine`.**
- **Confidence: HIGH (from Apple's own docs) — network control is a first-class gap that no macOS sandbox mechanism fills.** The proxy-outside-the-boundary pattern is not optional for a design that wants egress control; Seatbelt alone cannot do it, and a container needs a proxy too. This is the one architectural element that should be decided independently of the boundary choice.

### Gaps

- **No Apple announcement about removing `sandbox-exec`.** `#737` is open and assigned; the only comment is a Feedback Assistant reference. **Do not assert a removal timeline — none exists.**
- **I did not verify whether the deprecation warning still appears on macOS 26 Tahoe specifically.** The reproduction in `#737` is on macOS 15 Sequoia.
- **No independent measurement of Apple `container` cold-start time, memory footprint, or bind-mount throughput.** Apple's "sub-second" is the only figure and it is for `container machine`, not per-container `container run`. **This is the most important benchmark grove could run before committing.**
- **No practitioner writeups of running coding agents inside Apple `container` or `container machine` were found.** The ecosystem discussion is still centred on Docker/Dev Containers. grove may be early here, which is a risk and an opportunity.
- **NVIDIA OpenShell** — all information is second-hand and unverified (see §6).
- **Whether `sbx` has a macOS-specific performance profile different from Windows** is unknown; all reports are Windows.

---

## Cross-cutting summary for the report writer

**The four things with the strongest evidentiary support:**

1. **Every published agent-sandbox escape on macOS is a policy-generation bug, not a MACF bypass.** The fix pattern is identical every time: derive the boundary only from the invocation site, canonicalise it, and deny-protect paths regardless of whether they exist. (CVE-2025-59532, CVE-2026-25725, CVE-2026-55607.)

2. **Seatbelt network control is binary *in SBPL*, but is achievable via a supervised proxy outside the sandbox.** Codex does nothing (documented gap); Cursor does nothing; Claude Code runs an HTTP+SOCKS proxy with per-session auth tokens and parses Seatbelt's `(with message …)` denial log to report violations. Microsoft's `mxc` states flatly that hostname/IP/port filtering is "Rejected — no such primitive in Seatbelt."

3. **Seatbelt's cost is in policy generation and compile time, not in enforcement.** "A few thousand path filters in seconds; a few dozen regexes in milliseconds." Profiles must be passed via `-f <file>`, not `-p`, or they hit `ARG_MAX` (measured: ~75 KB per git worktree; breaks at 8–11 worktrees, 100% sandbox failure).

4. **No public performance benchmark of `sandbox-exec` overhead on a real build workload exists.** Anyone making a Seatbelt-vs-container decision on performance grounds in 2026 is doing so without published data. The two hard numbers available are `<5 ms` native sandbox startup vs `~800 ms` + 128 MB for a Linux VM (from one container-runtime author), and an unquantified but emphatic practitioner verdict that `sbx` on Windows is "crippling" even on simple projects.

**Highest-value gaps to close if more research time is available:**
- Re-fetch `openai/codex` `seatbelt.rs` from GitHub (the raw path 404'd and code search 401'd without auth) and confirm the current macOS profile and whether domain-based network allowlisting now exists.
- Measure Seatbelt overhead directly: `sandbox-exec -p '<minimal deny-default profile>' /usr/bin/time <real build>` vs unconfined.
- Measure Apple `container run` cold start, RSS, and bind-mount throughput on Tahoe 26.
- Read `docs.docker.com/ai/sandboxes/architecture/` for Docker's own isolation and workspace-mount design.
- Read NVIDIA OpenShell's policy docs directly, if the static-FS / dynamic-network split matters.
