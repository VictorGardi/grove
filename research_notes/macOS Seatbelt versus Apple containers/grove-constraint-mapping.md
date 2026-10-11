# grove constraint mapping: Apple `container` (Linux VM) vs Seatbelt (`sandbox-exec`)

Scope: for each of the 10 constraints grove has already committed to, what changes under Seatbelt.
Every empirical claim below was measured on this machine (macOS 26.4.1, build 25E253, Apple
 Silicon, `sandbox-exec` at `/usr/bin/sandbox-exec`) unless labelled *reasoned* or *cited*.

Container-side facts are taken from `02-research.md` § Spikes (measured 2026-10-10) and
`03-design.md` v6; those spikes were **not** re-run.

All probe artefacts (a throwaway repo/worktree at `~/git/sbx-probe-*`, one keychain item
`sbx-probe-secret`) were created and removed; verified clean at the end. No grove session,
container, or OpenCode service was touched.

---

## Key Question 1 — What does Seatbelt require for each of grove's 10 constraints?

### Takeaway

Seatbelt satisfies **8 of 10** constraints natively or more cheaply than the container, with two
that get *structurally harder* (5's shared-service design collapses into a non-problem, but 2's
worktree case needs a new mechanism; and 6 flips from "impossible" to "possible but needs
care"). The decisive wins are constraint 7 (no image, no build, native binaries — **~10,000×
faster cold start**) and constraint 8 (Seatbelt *does* provide the network enforcement primitive
ADR 0036 says is missing). The decisive losses are the **documented, measured FD-inheritance
escape** (`sandbox(7)`: an already-open write FD bypasses all path rules — reproduced below) and
the fact that **Apple deprecates `sandbox-exec`**.

### Cited Findings

**Constraint 1 — host-identical paths.**
- Seatbelt is a *path-filtering* sandbox, not a filesystem-namespace sandbox, so the working
  directory is inherently at its real host path. Measured: `pwd` inside the sandbox returned
  `/Users/victor/git/sbx-probe-90344/wt-probe`; `git rev-parse --show-toplevel` returned the same
  host path. No bind-mount machinery exists to get wrong.
- **Verdict: EASIER (effectively free).** The constraint dissolves: there is no mount table.

**Constraint 2 — worktrees.**
- Measured, Seatbelt, worktree only: `git rev-parse --show-toplevel` →
  `fatal: not a git repository: /Users/victor/git/sbx-probe-90344/main/.git/worktrees/wt-probe`.
  **Identical failure mode to the container**, and for the identical reason: the worktree's `.git`
  is a file naming a path outside the allow-set. Measured, `cat` of that `.git` file *succeeds*
  inside the sandbox (it is inside the allowed worktree path); only the *target* is unreachable.
- Measured, Seatbelt, worktree + common dir allowed (read/write on
  `<main>/.git`, plus `(deny file-write* (subpath ".../hooks"))` and `(deny file-write* (subpath ".../config"))`):
  `rev-parse --show-toplevel` → correct host path; `rev-parse --git-common-dir` →
  `<main>/.git`; a real `git commit --allow-empty` succeeded (`[detached HEAD 50c5dfa]`);
  writes to `.git/` succeeded while `touch .git/hooks/probe-bad` →
  `Operation not permitted`.
- The `hooks`/`config` carve-out works with **no experimental flag**, no "absent path" tolerance
  question, and no nested-carve-out question — the profile is a flat ordered rule list and the
  carve-outs are plain `deny` rules (measured working, both carve-outs simultaneously).
- **Verdict: THE SAME.** Seatbelt does **not** eliminate the "also grant the common dir" step; it
  replaces the mount flag with an allow-rule. What it eliminates is the *experimental* part.

**Constraint 3 — git hooks execute regardless.**
- Measured: a host-authored `post-checkout` hook **ran** inside the Seatbelt sandbox (branch
  switch reported `Switched to a new branch`, and the hook's side effect landed). Read-only
  `hooks/` did not stop execution — matching the container measurement exactly.
- **New and important difference (measured):** the hook's *blast radius* is confined. The hook
  tried to write `<probe-root>/HOOK_RAN.txt`, outside the sandbox → `Operation not permitted`, and
  the file did not exist on the host afterwards. The same hook writing *inside* the allowed
  worktree succeeded (`ran`). So under Seatbelt a hostile hook is a **noisy but contained**
  nuisance; under the container the same hook ran as **uid=0** inside the jail.
- Measured: `GIT_CONFIG_COUNT=1 / GIT_CONFIG_KEY_0=core.hooksPath / GIT_CONFIG_VALUE_0=/dev/null`
  suppressed the hook under Seatbelt exactly as it does under the container (the in-worktree
  marker file was absent after the neutralised checkout).
- **Verdict: THE SAME**, with a strictly better blast radius.

**Constraint 4 — `~/.gitconfig` readable, not writable.**
- Measured: `(allow file-read* (subpath "/Users/victor/.gitconfig"))` and no write rule →
  `git` reads it fine; an attempted `>> /Users/victor/.gitconfig` → `Operation not permitted`.
- **A failure mode the container does not have (measured):** if `~/.gitconfig` is *unreadable*,
  git does **not** degrade — it **fatals**: `fatal: unable to access '/Users/victor/.gitconfig':
  Operation not permitted`, and *every* git command fails. Same for `/etc/gitconfig`. The
  container mounts a Linux `/etc/gitconfig` inside the image, so this class of miss does not
  arise there. grove must therefore allow-read `/etc`, `/etc/gitconfig`, and `~/.gitconfig`
  explicitly, or the pane's git is dead. This is an *easy* failure (loud, immediate), which is
  the good kind.
- Ordering rule (measured, important for authoring): **first match wins.** With
  `(allow file-read* (subpath "/private/tmp"))` then `(deny file-read* (subpath ".../secret"))`,
  the read was **blocked**. With the two rules swapped, the read **succeeded** (`hunter2` printed).
  So carve-outs must be written *before* the broader allow. Getting this backwards silently
  disables the carve-out — a real authoring hazard for constraint 4 and for constraint 3.
- **Verdict: EASIER.** One allow-line, no `--read-only-path`, no Experimental label, no
  absent-path tolerance, no nested carve-out assertion.

**Constraint 5 — hook spool + grove's unix socket.**
- Measured: with `(allow file-read* / file-write* (subpath <spoolDir>))` and
  `(allow network-outbound (literal "<socketPath>"))`, a Python AF_UNIX server answered
  `PONG:HELLO` from inside the sandbox, and a file write into the spool returned rc=0.
- This is strictly simpler than the container's D6 machinery — **no bridge address discovery, no
  rebinding the host's shared OpenCode service off loopback, no consent prompt, no `0.0.0.0` risk,
  no second-registration eviction hazard.** The sandboxed process shares the host's loopback, so
  the OpenCode service is reachable as-is. The entire D6 decision (bridge binding, `service.json`
  read-only, service rebinding, orphan pruning of containers) evaporates.
- **Verdict: EASIER, and it deletes D6 outright.**

**Constraint 6 — credentials / Keychain. (Primary question.)**
- **Seatbelt can DENY Keychain access.** Measured: a deny-default profile with broad
  `(allow mach-lookup)` and `(allow network*)` but `(deny file-read* (subpath "~/Library/Keychains"))`
  → `security find-generic-password -s sbx-probe-secret -w` returns
  `SecKeychainSearchCopyNext: The specified item could not be found in the keychain` (rc=44), and
  `wc -c ~/Library/Keychains/login.keychain-db` → `open: Operation not permitted` (vs 233212 bytes
  unsandboxed). The deny holds whether the rule is written before or after the broad allows.
- **Seatbelt can also PERMIT it** (so credentials *can* work, if grove ever wants that):
  deny-default + `(allow mach-lookup (global-name "com.apple.securityd"))`
  + `(allow mach-lookup (global-name "com.apple.SecurityServer"))`
  + `(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))`
  + `(allow mach-lookup (global-name "com.apple.logd"))`
  + `(allow mach-lookup (global-name "com.apple.analyticsd"))`
  + `(allow mach-lookup (global-name "com.apple.system.notification_center"))`
  + `(allow file-read* (subpath "~/Library/Keychains"))` → returned the secret verbatim.
  The kernel deny log named `com.apple.SecurityServer` as the blocking Mach service.
- So the "Linux container cannot read the Keychain" risk **does not transfer**: under Seatbelt
  Claude Code's macOS credentials work unchanged, and grove keeps a *choice* about whether to
  expose them.
- **The security decision this forces (reasoned, not measured):** a default grove profile that
  omits `~/Library/Keychains` grants the agent no credentials but makes
  `claude`/`opencode` auth-dependent calls fail unless they fall back to file-based credentials.
  grove must decide whether "sandboxed agent cannot read the Keychain" is the intended default —
  it almost certainly is, and it is *better* than the container, where credentials are merely
  absent rather than denied. But it must be a decision, not an accident of profile omission.
- **Verdict: EASIER.** The container treats credentials as an unavoidable casualty; Seatbelt
  makes them an explicit, enforceable policy choice (deny-by-default, grantable if ever needed).

**Constraint 7 — native binaries.**
- Measured: under a deny-default Seatbelt profile that allow-reads `/opt/homebrew`, the **host's
  own** binaries ran natively with no image and no build:
  `node --version` → `v26.3.0`; `claude --version` → `2.1.285 (Claude Code)`;
  `opencode --version` → `opencode v2.0.20`.
- Startup cost measured: 5 consecutive `sandbox-exec` runs at **0.00–0.01 s wall**, identical to a
  bare `/bin/echo` baseline — versus the container's measured 0.68 s warm and 28 s first-build
  (`02-research.md` § Spikes). Cold path is a binary spawn, not a VM boot or image build.
- **Verdict: EASIER — the whole image subsystem (Dockerfile, content-hash tag, `ensureImage`,
  28 s first-session cost, pinned-Linux-agent maintenance) is eliminated.** This is the single
  largest reduction in grove's implementation surface.

**Constraint 8 — filesystem-only isolation / network enforcement (ADR 0036).**
- **Seatbelt provides a network enforcement primitive; the container does not** (per ADR 0036's
  own reasoning). Measured:
  - `(deny network*)` under deny-default → `curl https://api.anthropic.com/v1/models` →
    `Could not resolve host` / `HTTP=000`. Full egress denial works.
  - `(allow network*)` → `HTTP=401` (the correct unauthenticated answer, matching the container
    spike's control).
  - **Port-scoped allow works and is precise:** `(allow network-outbound (remote ip "*:443"))`
    → direct-IP HTTPS to `api.anthropic.com` returned **401 (allowed)**, while plain HTTP to port
    80 returned **000 (blocked)**.
- **Granularity limit (measured):** the host field must be `*` or `localhost` —
  `sandbox-exec` rejects `(remote ip "160.79.104.10:0-65535")` with
  `host must be * or localhost in network address`. So Seatbelt can allow/deny **all** network,
  and can filter by **port**, but **cannot allow-list by destination hostname/IP**.
- DNS is separately gated: `dig` fails under profiles that don't permit it, so an allow-list also
  has to permit the resolver path.
- **Verdict: EASIER for the stated goal (deny-all is available), but it does NOT deliver the
  deferred allow-list.** This partially reopens ADR 0036: the "no enforcement primitive" premise
  is *wrong* for Seatbelt (deny-all exists, and it's strictly stronger than the container's
  default-open), while a hostname allow-list still needs the host proxy ADR 0036 already
  anticipated. ADR 0036's core argument — that the mount set is what does the confining — is
  weakened under Seatbelt, since Seatbelt can express network policy natively.

**Constraint 9 — architecture / placement.**
- Measured: grove's real pane shape works. `sandbox-exec -f profile /bin/zsh -l -i -c 'exec git -C
  <wt> rev-parse --show-toplevel'` returned the correct host path, rc=0 — the login shell starts
  fine under the profile and the inner `exec` replaces it as intended.
- The policy is applied by grove (`sandboxArgv` composes `sandbox-exec -f <profile>` as the pane's
  leaf argv), not by the agent, exactly as today. The seam, the tmux backend, and
  `loginShellArgv` are unchanged in shape.
- **Verdict: THE SAME.** One asymmetry worth noting: unlike the container, Seatbelt does not
  create a distinct process tree or namespace, so **the sandbox is inherited by every descendant
  the agent spawns** (documented: *"New processes inherit the sandbox of their parent"*) — which is
  what we want, and is not true of a container in the same way (its init is the boundary).

**Constraint 10 — rollback safety / no silent fallback.**
- Structurally identical: `sandboxArgv` produces a wrapper argv; a missing `sandbox-exec` or an
  invalid profile must fail the create with `no-sandbox`. Easier to verify because there is no
  image build step to time out.
- **Verdict: EASIER.** The failure surface shrinks from {missing `container` binary, failed image
  build, undiscoverable bridge, service rebinding} to {missing `/usr/bin/sandbox-exec`, profile
  parse error}. Note a profile *logic* error (a typo'd path) does **not** fail closed loudly — it
  fails as the agent hitting `Operation not permitted` mid-run. grove should therefore validate
  the profile at create time with a canary read/write test, which the container's mount errors
  largely give for free.

### Inferences

- Constraints 1, 4, 5, 7 are strictly cheaper under Seatbelt; 5 and 7 eliminate entire subsystems
  (D6 bridge/service-rebinding; the image build). 2, 3, 9 are the same shape. 6 improves from
  "impossible" to "an explicit policy choice". 8 gains a primitive that did not previously exist.
- The net implementation delta is strongly negative in size: the container needs
  `spec,image,argv,container,service.ts` plus a Dockerfile, image lifecycle, container pruning,
  and bridge discovery; Seatbelt needs `spec,argv.ts` plus a profile template and a canary check.
- **The decisive risk is not any single constraint — it is the security model itself.** Under the
  container, escape requires a Linux kernel exploit. Under Seatbelt, escape requires (a) a profile
  authoring mistake, or (b) an inherited file descriptor, or (c) a macOS sandbox escape CVE. (a)
  is the dominant risk: grove's profile is hand-written and grove's threat model is a
  prompt-injected agent that will actively look for holes.
- Cited corroboration for that risk: researchers found "many other sandbox escapes in the policy"
  when reviewing an AI-agent Seatbelt profile, noting such mistakes "are easy to make with
  Seatbelt but harder to make with containers"
  ([HN discussion](https://news.ycombinator.com/item?id=44283454)); and a published walkthrough of
  an allow-default agent profile escaped to unsandboxed code execution
  ([Pillar Security](https://www.pillar.security/blog/escaping-antigravitys-allow-default-seatbelt)).

---

## Key Question 2 — Can Seatbelt satisfy the worktree case without the "also grant the common dir" workaround?

### Takeaway

**No.** The workaround is *inherent to the problem*, not an artifact of mounting. A worktree's
`.git` file names a gitdir outside the working directory; any allow-list — SBPL or mount — must
name that path. Seatbelt replaces `--volume <commonDir>:<commonDir>` with
`(allow file-read* (allow file-write* (subpath "<commonDir>")))`, which is *the same
requirement expressed in a different language*.

### Cited Findings

- Measured: Seatbelt with the worktree allowed and the common dir **not** allowed →
  `fatal: not a git repository: <main>/.git/worktrees/wt-probe` for `rev-parse --show-toplevel`,
  `rev-parse --git-dir`, `status`, and `commit`. Four commands, four identical failures.
- Measured: `cat <worktree>/.git` **succeeds** inside the sandbox (it lives under the allowed
  worktree path) and prints `gitdir: /Users/victor/git/sbx-probe-90344/main/.git/worktrees/wt-probe`;
  reading that target's `HEAD` also succeeded *in that profile* only because that profile still
  carried a broad system read. Under the tight profile the gitdir is unreachable — hence the fatal.
- Measured: adding the common dir (read/write) plus `deny file-write*` on `hooks/` and `config/`
  made everything work, including a real commit.
- The container's measured equivalent (`02-research.md` § Spikes) is `fatal: not a git
  repository: (null)` — the `(null)` vs. the named-path difference is a cosmetic artifact of which
  git code path fails first, not a semantic difference. **Both fail; both are fixed by naming the
  common dir.**

### Inferences

- What Seatbelt changes is the *cost of the fix*: the container needed `--read-only-path`, flagged
  **Experimental**, whose two risky behaviours (absent path tolerated; two nested carve-outs
  cooperating) grove had to measure and then assert in slice 1. Seatbelt needs a plain ordered
  `deny` rule and it works first time. So the *design* is unchanged and the *risk* around it is
  smaller.
- grove's D2 wording ("the common dir is not an extra root") carries over intact: it is still one
  repository, still host-identical paths, still no `/workspace` remap. The only edit D2 needs is
  swapping mount syntax for rule syntax.
- The ordering hazard (first-match-wins, carve-outs must precede broad allows) is the one genuinely
  new correctness risk in this constraint, and it is silent — a reversed pair disables the
  read-only guarantee on `hooks/` and `config` without any error.

### Gaps

- I did not test a **nested worktree** (worktree of a worktree) or `git worktree add` *inside* the
  sandbox, which would need write access to the common dir's `worktrees/` subtree. Not measured.

---

## Key Question 3 — Constraints Seatbelt eliminates outright, and ones it introduces that do not exist today.

### Takeaway

Seatbelt deletes two entire subsystems (the image; the shared-service bridge) and one whole class
of risk (credentials being unreachable). It introduces four: a hand-written policy whose mistakes
are silent, an inherited-FD escape that no path rule can close, a deprecation dependency, and
per-command profile fragility.

### Cited Findings

**Eliminated outright**
- **The sandbox image** (constraint 7): no Dockerfile, no content-hash tag, no `ensureImage`, no
  28 s first-session build, no pinned Linux copies of two agents that must be re-pinned on every
  upgrade. Measured: host `node`/`claude`/`opencode` all run natively under the profile.
- **D6 / the shared-service bridge** (constraint 5): the sandboxed process shares host loopback,
  so the OpenCode service is reachable as-is. No bridge-address discovery, no `192.168.64.1`
  probing, no rebinding the host service to a routable interface, no LAN-exposure risk, no
  consent prompt, no `0.0.0.0` refusal path, no second-registration eviction hazard, no container
  orphan pruning.
- **The Keychain casualty** (constraint 6): credentials either work or are explicitly denied —
  neither is an unavoidable loss.
- **`--read-only-path`'s experimental status** (constraints 2 and 4): plain ordered rules.
- **Wrong-architecture risk**: host macOS binaries run directly; the D1 rejection reason
  ("macOS binaries cannot run in a Linux container") does not apply.

**Introduced — do not exist today**
1. **Inherited-FD escape (measured, and documented).** `sandbox(7)` states: *"if the application
   already has a file descriptor opened for writing, it may use that file descriptor regardless of
   restrictions."* Measured end-to-end: a parent opened a write FD to a file outside the sandbox
   and passed it down; the sandboxed child wrote through `/dev/fd/3` under a profile containing
   `(deny file-write* (literal "<that exact path>"))`; the child's marker
   `CHILD_MARKER_VIA_INHERITED_FD` landed on the host. The deny was fully specified and fully
   bypassed. A container cannot be escaped this way — the FD would point into the container's own
   filesystem. **For grove this is concrete, not theoretical:** the pane is launched by a tmux
   *server* that is long-lived and already holds open FDs (to sockets, to the user's home, to
   whatever the session was started with). Anything grove or tmux opened before the exec is
   inherited. Mitigations exist (close non-stdio FDs before exec, which grove controls at the
   `sandbox-exec` boundary; and the agent cannot *open* new FDs outside the profile) but they are
   grove-side work that does not exist in the container design.
2. **A deprecated enforcement primitive.** `man sandbox-exec` on this machine reads: *"The
   sandbox-exec command is DEPRECATED. Developers who wish to sandbox an app should instead adopt
   the App Sandbox feature described in the App Sandbox Design Guide"* (man page dated March 9,
   2017) — [sandbox-exec(1)](https://keith.github.io/xcode-man-pages/sandbox-exec.1.html).
   It still works (every measurement here succeeded) but it is explicitly not Apple's recommended
   path, and Apple itself is migrating its own container shim off it — apple/containerization
   issue #737 asks Apple to clarify the timeline and notes `sandbox-exec(1)` "is the only
   documented mechanism for applying Seatbelt … to arbitrary user-space processes on macOS
   without enrolling in the App Store or using Xcode entitlements"
   ([apple/containerization#737](https://github.com/apple/containerization/issues/737)).
   Corroborated: "sandbox-exec / seatbelt has been marked as deprecated for nearly a decade now
   (since macOS Sierra in 2016) but it's still what everyone uses"
   ([HN](https://news.ycombinator.com/item?id=44283454)).
3. **Silent profile-error failure mode.** Unlike the container's loud mount errors, a mistyped or
   misordered rule produces no error — it produces `Operation not permitted` mid-agent-run (and,
   in the carve-out case, silently *disables* a protection). Combined with the first-match-wins
   ordering I measured, this is the most likely way a Seatbelt grove would ship with a hole.
4. **Per-command profile fragility.** Measured: getting one `git` command to run took a working
   set including `/etc` (for `/etc/gitconfig`), `~/.gitconfig`, `/private/etc`,
   `/private/var/db/dyld`, `/var/select` + `/Library/Developer` (because `/usr/bin/git` is an
   `xcrun` shim that shells out), `/dev/null` (which needs an explicit **literal** — `subpath
   "/dev"` did *not* cover it; measured `tee /dev/null` aborting under a `subpath "/dev"` allow),
   plus `file-read-metadata`, `process-exec*`, `mach-lookup`, and `(allow file-read-data (literal
   "/"))` or the process aborts with SIGABRT. This is a real, ongoing maintenance burden — and
   each missing item surfaces as an obscure failure inside a TUI, not as a clean error.

### Inferences

- Items 1–3 are all *security-model* changes, not engineering-effort changes; items 4 and the
  eliminated subsystems are engineering-effort changes. Seatbelt trades a large amount of
  engineering work for a materially different (and, for a prompt-injected agent, weaker) security
  story.
- Notably, the escape surface is not hypothetical: real macOS sandbox escapes exist and are
  exploited in the wild — CVE-2023-32364 (sandboxed process escapes via mounting), CVE-2025-31191
  (Security-Scoped Bookmarks), CVE-2026-84535 (an authorization bug allowing a sandboxed app to
  escape). This does not argue that Seatbelt is *weak today* — the kernel is patched — but it does
  mean the Seatbelt jail is a **userspace policy on a shared kernel**, while the container is a
  **separate kernel**. The blast radius of a future macOS sandbox escape under grove's design
  would be the user's whole home directory; under the container design it would be the mount set.

### Gaps

- I did **not** attempt a full Seatbelt escape (no devfs mount, no Launch Services handoff, no
  DYLD). I did test the Launch Services handoff specifically: under a deny-default profile with
  broad `(allow mach-lookup)`, `open` on a host-built `.app` failed with
  `_LSOpenURLsWithCompletionHandler() failed with error -54`, and an `.app` built *by the sandboxed
  process itself* was tagged `com.apple.provenance` and likewise refused (error -54). So the
  documented Antigravity-style Launch Services escape **did not reproduce** here — most likely
  because `(deny default)` blocks the `mount -t devfs` that the published chain depends on. That
  is a meaningful negative result, but it is one escape class, not an audit.
- Whether grove's *real* pane chain (Electron → tmux server → pane) hands the agent any usable
  write FDs is **unmeasured** and is the single most important thing to spike before choosing
  Seatbelt. My FD test proves the primitive is real; it does not prove grove's launch path exposes
  it.
- No source found quantifying Seatbelt-vs-container escape rates. The security comparison rests on
  mechanism (shared kernel, policy-vs-namespace), not on a measured incident rate.

---

## Key Question 4 — Where Seatbelt is strictly weaker in a way that matters for "structurally unable to touch the host"?

### Takeaway

Three places, in order of seriousness: **(1) inherited file descriptors**, which no path rule can
close and which I reproduced; **(2) policy-vs-namespace** — a mistake in a hand-written profile is
a hole, whereas the container's mount set fails loudly and is enumerated in one place; **(3) a
degraded kernel boundary** — same kernel, same user, so an unpatched or future macOS sandbox
escape lands the agent in the user's home directory rather than in a mount set.

### Cited Findings

- **Inherited FDs (measured):** `sandbox(7)` documents the behaviour explicitly — *"if the
  application already has a file descriptor opened for writing, it may use that file descriptor
  regardless of restrictions"* ([sandbox(7)](https://keith.github.io/xcode-man-pages/sandbox.7.html)).
  My test opened a write FD outside the sandbox in the parent, passed it into a deny-default
  profile that explicitly denied writes to that exact literal path, and the child wrote
  `CHILD_MARKER_VIA_INHERITED_FD` through `/dev/fd/3`. The rule was present, correct, and bypassed.
- **Policy mistakes are silent (measured, repeatedly):** reversed carve-out ordering silently
  disabled the protection (`hunter2` was readable with `deny` written after the broad `allow`);
  `(subpath "/dev")` silently failed to cover `/dev/null`; missing `/etc` made every git command
  fatal rather than obviously misconfigured. In each case the failure mode is a wrong result, not
  a loud refusal.
- **Independence research (cited):** an AI-agent Seatbelt policy review found it "failed to
  properly block off access to the user's home directory dotfiles and ~/Library" and noted "there
  are many other sandbox escapes in the policy I saw… easy to make with Seatbelt but harder to
  make with containers" ([HN](https://news.ycombinator.com/item?id=44283454)). A published
  walkthrough of a commercial agent's allow-default profile achieved unsandboxed code execution
  via a devfs mount + Launch Services handoff, bypassing provenance xattrs using symlinks
  ([Pillar Security](https://www.pillar.security/blog/escaping-antigravitys-allow-default-seatbelt);
  underlying bug [CVE-2023-32364](https://gergelykalman.com/CVE-2023-32364-a-macOS-sandbox-escape-by-mounting.html)).
- **Same-kernel sharing (cited):** "A sandbox-exec profile cannot grant the process privileges it
  does not already have; it can only restrict… It can't override the OS-level protections, System
  Integrity Protection and TCC… The agent's process still runs on the host and still shares the
  kernel with you. Isolation by profile is isolation by promise"
  ([Pillar Security](https://www.pillar.security/blog/escaping-antigravitys-allow-default-seatbelt)).
- **Escape classes exist in the platform itself (cited):** CVE-2023-32364, CVE-2025-31191,
  CVE-2026-84535 (the last: an authorization bug letting a sandboxed app escape, fixed in a
  current macOS release) — [SentinelOne CVE database](https://www.sentinelone.com/vulnerability-database/cve-2026-84535).
- **Where Seatbelt is genuinely *stronger*, stated for balance:** the documented Launch Services
  escape **did not reproduce** under `(deny default)` in my testing — `open` on a `.app` built by
  the sandboxed process was refused (error -54) and the bundle carried `com.apple.provenance`. The
  published chain depends on `mount -t devfs`, which `(deny default)` blocks. A carefully
  constructed deny-default profile is a real jail; the risk is in the authoring, not in the
  primitive.

### Inferences

- For grove's stated goal — "let an agent roam freely inside its own working directory but be
  structurally unable to touch the rest of the host" — the word **structurally** is where the two
  designs part. The container's structure is a mount table: an enumeration, in one place, of every
  path that exists inside the jail, enforced by the kernel's namespace machinery, with failures
  that are loud. Seatbelt's structure is a *policy*: a hand-maintained claim about what the
  process may ask the kernel for, maintained as a list of exceptions from "deny everything", where
  the dangerous failure is silent and where one class of escape (inherited FDs) is not expressible
  as a rule at all.
- If grove's threat model is **a misbehaving-but-not-malicious agent** (an agent that wanders, or
  follows a bad instruction), Seatbelt is very likely sufficient and much cheaper — the profile
  is short, the failure mode is an error message the user sees, and the blast radius of a mistake
  is bounded by whatever the profile failed to mention.
- If grove's threat model is **an actively adversarial agent** (one reading this source, hunting
  for holes, e.g. via prompt injection from repository content), the container is the better
  structure: escape needs a kernel bug, and the agent cannot enumerate its way out because the
  jail *is* the mount set rather than a list of things not to do.
- The inherited-FD issue is the sharpest single difference and the one most fixable: grove controls
  the `sandbox-exec` exec boundary, so closing non-stdio FDs before exec is tractable grove-side
  work. Until that is measured on grove's real tmux chain, it is an open risk, not a solved one.

### Gaps

- **Unmeasured and decision-relevant:** which FDs grove's actual Electron → tmux-server → pane
  chain leaves open and inheritable. My probe proved the primitive; it did not prove grove's
  exposure. This is the first thing to spike if Seatbelt is seriously considered.
- **Unmeasured:** whether a properly tightened Seatbelt profile survives a real Claude Code /
  OpenCode TUI session (MCP servers, background daemons, `open`, notifications, keychain prompts).
  My probes used short-lived CLI commands only.
- **Unmeasured:** multi-agent / multi-repo sessions, and whether the profile can be expressed
  compactly for N roots without becoming unreadable.
- **No measured basis** for comparing how often real-world escapes occur under each approach.

---

## Quick reference: verdict table

| # | Constraint | Container requires | Seatbelt requires | Verdict |
|---|---|---|---|---|
| 1 | Host-identical paths | mount table, same-path invariant | nothing (path filters are inherently host-path) | **EASIER** |
| 2 | Worktrees | mount worktree + common dir; experimental `--read-only-path` for `hooks`/`config` | allow worktree + common dir; ordered `deny` rules for `hooks`/`config` | **THE SAME** (fix is inherent; cost of fix lower) |
| 3 | Git hooks execute | `GIT_CONFIG_*` neutralisation; hook runs as uid=0 | same neutralisation (measured working); hook confined by policy | **THE SAME**, smaller blast radius |
| 4 | `.gitconfig` ro | `--read-only-path` (experimental) | one `file-read*` allow, no write allow; **carve-outs must precede broad allows** | **EASIER** |
| 5 | Spool + socket | mount both; D6 bridge discovery + service rebinding | subpath allows + one `network-outbound` literal; shares host loopback | **EASIER** (deletes D6) |
| 6 | Credentials | impossible (Linux VM) | denyable *and* grantable via Keychain subpath + `SecurityServer` mach-lookup | **EASIER** (becomes a policy choice) |
| 7 | Native binaries | image build, 28 s first run, pinned Linux agents | nothing; host binaries run natively; 0.00–0.01 s start | **EASIER** (deletes the image) |
| 8 | Network enforcement | none ("no enforcement primitive") | `(deny network*)`, port-scoped `(remote ip "*:443")`; **no hostname allow-list** | **EASIER** for deny-all; still no allow-list |
| 9 | Placement | `container run` as leaf argv in login shell | `sandbox-exec -f` as leaf argv (measured working in `-l -i -c`) | **THE SAME** |
| 10 | Rollback safety | missing binary / build fail / bridge discovery | missing binary / profile parse error; **silent rule mistakes need a canary** | **EASIER**, different failure mode |

**Net:** Seatbelt removes more machinery than it adds, and improves every constraint *as
engineering*. It is weaker as a **security structure** — shared kernel, hand-authored policy,
silent rule errors, and a documented FD-inheritance escape no rule can close. That is the trade
the design phase has to make explicitly.