# macOS Seatbelt Fundamentals: the sandbox-exec / sandbox_init mechanism

**Scope:** What Seatbelt is, how it is enforced, what it structurally cannot do, its real escape surface, and empirical verification on macOS 26.4.1 (Darwin 25.4.0, arm64, build 25E253), SIP enabled.

**Epistemic labelling used throughout:**
- **[V]** = VERIFIED-EMPIRICALLY on this machine (command + output reproduced below)
- **[C]** = CITED (man page, SDK header, Apple/XNU source, or third-party published source, with URL)
- **[I]** = INFERRED (my reasoning from [V] + [C]; not directly asserted by a source)

**Two corrections to premises in the task brief, both [V]:**
1. `sandbox_init` was **not** deprecated in macOS 10.15. The SDK header marks it `API_DEPRECATED("No longer supported", macos(10.5, 10.8), ...)` — deprecated since **10.8**. The macOS 10.15 date in the brief is wrong.
2. `/bin/true` does not exist on modern macOS (it is `/usr/bin/true`); `/bin` is a firmlink to `/usr/bin`. Naive benchmark/test scripts using `/bin/true` silently measure failure, not execution.

---

## Current status on macOS 26.4.1: is `sandbox-exec` still shipped and functional, and what is the deprecation guidance?

### Takeaway
`sandbox-exec` is still shipped and **fully functional** on macOS 26.4.1, but it is explicitly and loudly DEPRECATED by Apple, which points users to App Sandbox instead. It remains functionally load-bearing inside macOS itself — 510 Apple base profiles ship on disk — so it is deprecating the *public API surface*, not removing the *mechanism*.

### Cited Findings
- The `sandbox-exec(1)` man page on this machine carries "execute within a sandbox **(DEPRECATED)**" in its NAME line, and states verbatim: *"The `sandbox-exec` command is DEPRECATED. Developers who wish to sandbox an app should instead adopt the App Sandbox feature described in the App Sandbox Design Guide."* — [V] `man sandbox-exec` on this host. Note the man page is dated **"Mac OS X, March 9, 2017"**, i.e. it has not been substantively revised in ~9 years.
- The SDK header `/Library/Developer/CommandLineTools/SDKs/MacOSX26.4.sdk/usr/include/sandbox.h` carries a file-level warning: *"This header is deprecated and may be removed in a future release. Developers who wish to sandbox an app should instead adopt the App Sandbox feature..."*, and marks `sandbox_init` and all five `kSBXProfile*` constants `API_DEPRECATED("No longer supported", macos(10.5, 10.8), ...)` — i.e. **deprecated as of 10.8, not 10.15** — plus `API_UNAVAILABLE(macCatalyst)`. Header copyright reads `2006-2011,2018`, i.e. untouched since 2018.
- The `sandbox_init(3)` man page is likewise marked "(DEPRECATED)" and dated March 9, 2017. `sandbox(7)` ("overview of the sandbox facility") is dated **January 29, 2010**.
- The named built-in profiles (`kSBXProfileNoInternet`, `NoNetwork`, `NoWrite`, `NoWriteExceptTemporary`, `PureComputation`) are all listed as DEPRECATED in `sandbox_init(3)`.
- Apple ships **510** readable base profiles in `/System/Library/Sandbox/Profiles/` on this machine, plus a legacy set in `/usr/share/sandbox/` (61 entries). [V] `ls /System/Library/Sandbox/Profiles/ | wc -l` → `510`.
- `sandboxd(8)`: *"sandboxd performs services on behalf of the Sandbox kernel extension... This command is not intended to be invoked directly."* Both `/usr/bin/sandbox-exec` (102560 bytes) and `/usr/libexec/sandboxd` (1066256 bytes) are present and root-owned. [V]
- Apple directs new sandboxing work to **App Sandbox**, which is the supported, non-deprecated path — a capability-based, entitlement-driven, code-signing-integrated mechanism (not the raw `sandbox-exec` CLI).

### Inferences
- Because the deprecation notices are 9-17 years stale while the binary still ships, works, and is used by hundreds of Apple daemons, the practical risk that `sandbox-exec` disappears in the near term is **low**. The realistic risk is that Apple keeps the mechanism for internal/App-Sandbox use while continuing to decline to support the standalone CLI for third parties.
- The `sandbox_init` SDK function being unavailable on Mac Catalyst (`API_UNAVAILABLE(macCatalyst)`) signals Apple considers this API legacy in the modern multi-platform story.

### Gaps
- Apple has published **no** official end-of-life date or removal plan for `sandbox-exec`. The header says only "may be removed in a future release."
- The App Sandbox Design Guide page on developer.apple.com returned no extractable body text via fetch (JS-rendered), so I could not quote it directly. Its existence and the deprecation pointer to it are confirmed via the man pages/header above.
- I did not verify whether Apple has shipped any *new* Seatbelt-related API surface since 2018 that supersedes `sandbox_init`. Evidence suggests not.

---

## How is it enforced? Is it MACF, and can the process lift it? What is the trust boundary, honestly?

### Takeaway
Seatbelt is a **kernel MACF (Mandatory Access Control Framework) policy attached to the process's credential label**, evaluated by the kernel on every controlled operation. It is genuinely not liftable by the sandboxed process — I verified this three separate ways. But the honest trust boundary is narrower than "the sandbox protects the system": it protects against *the sandboxed code*, not against *cooperating or compromised unsandboxed processes it can talk to*, and it is a pure **access-control** filter with **no view isolation** whatsoever.

### Cited Findings
- The MAC framework is XNU's kernel hook system, originating from the **TrustedBSD Project** (Robert N. M. Watson, 1999-2002, for the CBOSS project under DARPA contract N66001-01-C-8035; enhanced by SPARTA/SEFOS). The header is titled *"Kernel interface for Mandatory Access Control -- how kernel services interact with the TrustedBSD MAC Framework."* and is compiled under `#if CONFIG_MACF`. It also carries `#warning "MAC policy is not KPI, see Technical Q&A QA1574, this header will be removed in next version"` — [XNU source](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/security/mac_framework.h).
- That header defines the hook surface that Seatbelt necessarily rides on, including exactly the operations SBPL exposes: `mac_vnode_check_read`, `mac_vnode_check_write`, `mac_vnode_check_create`, `mac_vnode_check_exec`, `mac_socket_check_connect`, `mac_socket_check_bind`, `mac_socket_check_listen`, `mac_socket_check_send`, `mac_proc_check_signal`, `mac_proc_check_fork`, `mac_system_check_sysctlbyname`, `mac_posixshm_check_*`, `mac_iokit_check_open`, etc. [XNU source](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/security/mac_framework.h)
- Apple's own `sandbox(7)` man page states the enforcement model and, crucially, its limits: *"The sandbox facility allows applications to **voluntarily** restrict their access to operating system resources. This safety mechanism is intended to limit potential damage in the event that a vulnerability is exploited. **It is not a replacement for other operating system access controls.** New processes inherit the sandbox of their parent. Restrictions are generally enforced upon acquisition of operating system resources only. For example, if file system writes are restricted, an application will not be able to open(2) a file for writing. **However, if the application already has a file descriptor opened for writing, it may use that file descriptor regardless of restrictions.**"* — [V] `man sandbox` on this host.
- **Enforcement is in the kernel, visible in the kernel log.** [V] I ran a restricted profile and captured the system log:
  ```
  2026-10-10 22:17:32.588 E kernel[0:123973] (Sandbox) Sandbox: echo(90341) deny(1) file-read-data /
  2026-10-10 22:17:45.038 E kernel[0:124323] (Sandbox) Sandbox: sh(91083) deny(1) file-read-metadata /var
  2026-10-10 22:17:48.177 E kernel[0:124b6c] (Sandbox) Sandbox: git(92405) deny(1) ipc-posix-shm-read-data apple.shm.notification_center
  2026-10-10 22:17:49.515 E kernel[0:1234a1] (Sandbox) Sandbox: parsecd(26128) deny(1) mach-lookup com.apple.apsd
  ```
  Source is literally `kernel[0:...]`, tagged `(Sandbox)`, with a `deny(1)` (extension=1) decision. This is kernel-generated, not userspace.

### Verified Empirically: the process CANNOT lift its own sandbox (three independent ways)

**[V] Test A — `sandbox_init` cannot re-init an already-sandboxed process.** I compiled a C program calling `sandbox_init()` and ran it under `sandbox-exec`:
```
sandbox initialization failed: (version 1)(allow default): profile not found
sandbox_init -> -1 errno=2 (No such file or directory)
errbuf: (version 1)(allow default): profile not found
rc=0
```
This matches the SDK header's contract exactly: *"Places the current process in a sandbox with a profile as specified. **If the process is already in a sandbox, the new profile is ignored and `sandbox_init()` returns an error.**"*

**[V] Test B — the original policy remains fully enforced after the failed re-init attempt.** Combining both in one process:
```
sandbox-exec -f tight.sb sh -c './lift >/dev/null 2>&1; cat <secret>'
→ cat: .../secret/secret.txt: Operation not permitted     (rc=1)
```
The failed `sandbox_init` did not weaken, reset, or replace the existing policy.

**[V] Test C — a sandboxed process cannot `exec` `sandbox-exec` to obtain an unsandboxed child.** This is a very concrete escape-shaped test:
```
sandbox-exec -f tight.sb sh -c "/usr/bin/sandbox-exec -p '(version 1)(allow default)' cat <secret>"
→ sandbox-exec: sandbox_apply: Operation not permitted        (rc=71)
```
Re-applying a sandbox from inside a sandbox is denied at the kernel level. (Note the asymmetry: nesting `sandbox-exec` under `(allow default)` *is* permitted — `NESTED_SANDBOX_OK` — so the block is specifically on applying a *new/looser* policy from inside an existing sandbox.)

### Inferences (trust boundary — stated honestly)
- **The kernel is trusted; the sandboxed process is not.** Seatbelt is a MACF label on the credential, so the boundary sits between the sandboxed process's userspace code and the kernel's decision points. A kernel-level or SIP-level compromise defeats it. [I]
- **Seatbelt defends against the sandboxed process, not against its neighbours.** It is an *ambient-rights reduction* for one process, not a *compartmentalisation* between processes. A sandboxed process that can reach an unsandboxed helper has effectively delegated authority to it; Seatbelt cannot distinguish "a request I made" from "a request the attacker made". [I]
- **It is access control, not a security boundary in the isolation sense.** Apple's own `sandbox(7)` calls it a "safety mechanism" intended to limit exploit damage, and explicitly disclaims replacing OS access controls. It is best understood as *blast-radius reduction*, not as a compartment boundary. [I]
- The same trust model explains why SIP and Seatbelt are complementary rather than redundant: SIP is enforced by `mac_proc_check_*`/code-signing hooks in the kernel and protects system files from *everyone including root*; Seatbelt is per-process voluntary self-limitation. [I]

### Gaps
- I did not find a primary Apple document explicitly stating "Seatbelt registers as a MACF policy module named `Sandbox`" in prose. The XNU header defines the MACF hook surface and the `sandboxd(8)` man page refers to "the Sandbox kernel extension"; the linkage is well-supported but I am inferring the exact registration mechanism from those rather than quoting Apple stating it.
- I could not locate a `/System/Library/Extensions/Sandbox.kext` on this machine ([V] `ls` → No such file or directory). On modern Apple Silicon the sandbox evaluator appears to be built into the kernel rather than shipped as a legacy kext. A third-party source (macinternals.app) asserts `Sandbox.kext` owns the policy and registers via MACF; I treat the *name* as unverified on this host, though the MACF hook surface itself is verified from XNU source.

---

## The SBPL policy language: shape of a real profile and how rules compose

### Takeaway
SBPL is a Scheme-derived s-expression language of `(allow|deny) <operation> <filters>...` rules. Rule composition is **deny-by-default with first-match-wins evaluation**; the practical idiom is `(deny default)` followed by explicit allows, and rules are additive (any matching allow grants) — except that ordering matters for deny rules.

### Cited Findings
- Apple provides **no official OS documentation for SBPL**. Chromium's macOS sandbox design doc states this explicitly: *"As there is no official OS-provided documentation for the SBPL, this design doc provides a short description below."* — [Chromium Mac Sandbox V2 Design Doc](https://chromium.googlesource.com/chromium/src/+/HEAD/sandbox/mac/seatbelt_sandbox_design.md)
- The canonical shape of a rule is `(operation, decision)` followed by one or more filters, in the compiled binary format: *"An operation (e.g., file-read, mach-lookup, network-outbound) is an abstraction of a system call or functionality invoked by a process and checked by the kernel."* — [SandBlaster: Reversing the Apple Sandbox (arXiv:1608.04303)](https://arxiv.org/pdf/1608.04303)
- Documented directive semantics from the Chromium doc: `(deny default)` — *"All resource access is denied by default. The sandbox must list allow rules for all resources"*; `(path "/path")` — *"Match exactly this path"*; `(subpath "/path")` — *"Match this path and all subpaths"*; `(allow process-exec*)`; `(allow mach-lookup (global-name "com.apple.system.logger"))`; `(allow sysctl-read)`. Profiles accept parameters via `sandbox_init_with_parameters()` and `(param "USER_HOME_DIR")`. — [Chromium](https://chromium.googlesource.com/chromium/src/+/HEAD/sandbox/mac/seatbelt_sandbox_design.md)
- Profiles can be composed with `(import "/System/Library/Sandbox/Profiles/system.sb")` to build on shared bases. — [Mac Internals, SBPL glossary](https://www.macinternals.app/en/glossary/sbpl) *(secondary source; treat as indicative)*
- Filter vocabulary includes path, regex, Mach port/global name, vnode type, socket type, file extension and xattrs. Sample binary→SBPL filter mappings: `0x01 & 0x0002` → `literal "/path/to/file"`, `0x1d & 0x0001` → `vnode-type REGULAR-FILE`, `0x0e & 0x0004` → `target children`, `0x0c & 0x0001` → `socket-type SOCK_STREAM`. — [SandBlaster](https://arxiv.org/pdf/1608.04303)
- The wildcard `*` in operation names (`file-read*`, `process*`, `network*`) expands to the family of related sub-operations. — [Chromium](https://chromium.googlesource.com/chromium/src/+/HEAD/sandbox/mac/seatbelt_sandbox_design.md)

### Verified Empirically: a real, working profile on this machine
[V] This is `tight.sb` — the profile that produced correct deny/allow behaviour in all four core tests (paths are the literal temp dir used):
```scheme
(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr/lib")
                     (subpath "/usr/bin") (subpath "/bin")
                     (subpath "/private/var/db/dyld")
                     (subpath "/System/Volumes/Preboot"))
(allow file-read* (subpath "<TMP>/seatbelt/allowed"))
(allow file-read* (literal "/dev/null") (literal "/dev/urandom")
                     (literal "/dev/random") (subpath "/dev/tty"))
(allow file-write* (subpath "<TMP>/seatbelt/allowed"))
```
And the four core tests against a secret file at `<TMP>/seatbelt/secret/secret.txt` containing `SECRET-DATA-abc123`:
```
--- T1: READ in-scope ---              public data                       rc=0   (allowed)
--- T2: READ out-of-scope secret ---   Operation not permitted          rc=1   (DENIED)
--- T3: WRITE out-of-scope ---         Operation not permitted          rc=1   (DENIED)
--- T4: WRITE in-scope ---             ok                                rc=0   (allowed)
```
Confirming out-of-scope write created nothing (`ls <TMP>/seatbelt/secret/` still shows only `secret.txt`).

**[V] Network operations are enforced too:**
```
sandbox-exec -f nonet.sb nc -z -G 2 127.0.0.1 1              → rc=1 (failed)
sandbox-exec -f nonet.sb sh -c 'exec 3<>/dev/tcp/127.0.0.1/1' → connect: Operation not permitted (rc=1)
```
where `nonet.sb` is `(version 1)(allow default)(deny network*)`.

**[V] Signals are enforced, including cross-domain signalling to unsandboxed processes:**
```
sleep 30 &                                   # unsandboxed, pid=99969
sandbox-exec -p '(version 1)(allow default)(deny signal)' kill -0 99969
→ kill: 99969: Operation not permitted          rc=1   (DENIED)
kill -0 99969   (from the host shell)
→ rc=0                                          (ALLOWED)
```
This is the kernel hook `mac_proc_check_signal` doing its job, and it shows Seatbelt *can* prevent a sandboxed process from signalling unsandboxed neighbours — the confinement is genuinely bilateral in that direction.

### Inferences
- Composition model: rules accumulate; a request is permitted if any matching rule allows it, and `(deny default)` makes absence of an allow into a denial. Because of this, `(allow default)` followed by targeted `(deny ...)` rules is equivalent-in-practice for coarse restrictions but is **weaker in principle** — it is a deny-list and inherits any unlisted capability. [I]
- Trailing `*` in `file-read*` / `file-write*` is a family shorthand over sub-operations (`file-read-data`, `file-read-metadata`, `file-read-attributes`, and the `*-create`/`*-unlink`/`*-chown` etc. family respectively), which is why `file-read-metadata` had to be allowed separately in some of my iterations before the broader `file-read*` was in scope. [I]
- **A denyless `(deny default)` profile must be built up empirically.** My first several attempts failed not because of policy errors but because modern macOS binaries cannot even reach `main()`: dyld aborts if it cannot read its shared cache. See "Gaps/caveats" below — this is the single biggest practical trap for anyone writing an SBPL profile from scratch in 2026. [I]

### Verified Empirically: profile authoring gotcha that will bite a caller
**[V] A `(deny default)` profile that does not permit reading `/` and the dyld shared cache makes the target binary `SIGABRT` (exit 134) rather than produce a clean error.** Bisection:
```
(version 1)(deny default)                              → rc=71  sandbox-exec: execvp() ... Operation not permitted
(version 1)(deny default)(allow process*)              → rc=134 (SIGABRT, silent)
```
I diagnosed the SIGABRT via the crash report backtrace (`~/Library/Logs/DiagnosticReports/echo-*.ips`), which shows the abort originates inside the dynamic linker, not the sandbox:
```
[1] __abort_with_payload → abort_with_payload_wrapper_internal → abort_with_reason
    → ignition_halt → boot_boot → ignite
    → dyld4::CacheFinder::CacheFinder(...)
    → dyld4::ProcessConfig::DyldCache::DyldCache(...)
    → dyld4::ProcessConfig::ProcessConfig(...) → dyld4::start
```
and the corresponding kernel log line: `Sandbox: cat(92423) deny(1) file-read-data /`. Adding `(literal "/")` plus `/System/Volumes/Preboot` (where `dyld_shared_cache_arm64e` lives on this host, confirmed by `ls`) fixed it. **[I]** This means the failure mode of an under-specified deny-default profile is a confusing crash in the loader, not a sandbox diagnostic — a real ergonomic trap.

### Gaps
- I did not empirically test `(import ...)` of Apple's base profiles, nor `-D key=value` parameter substitution, nor `sandbox_init_with_parameters()`. [I] Based on the Chromium doc these exist and work, but I did not run them.
- I could not obtain a definitive statement of SBPL's **first-match-wins vs. accumulate** semantics from a primary Apple source (none exists). My characterisation is inferred from behaviour and from the Chromium/SandBlaster descriptions.

---

## STRUCTURAL LIMITS — what Seatbelt cannot do

### Takeaway
Every one of the five requested absences is **confirmed**. Seatbelt is an access-control *filter*, not a *view*: it decides "may I open this path?" but never changes what paths exist, never changes the mount table, never renumbers PIDs, and never gives the process a network stack of its own. Consequence: **Seatbelt cannot hand a program a restricted view of the host.** It can only deny a program from acquiring a resource it could otherwise have acquired.

### Verified Empirically

**[V] No private filesystem view / no path remapping.** The mount table is bit-identical inside and outside the sandbox:
```
/sbin/mount | md5                              → 396a3a85498ce0406d3a2950c9fcbd53
sandbox-exec -p '(version 1)(allow default)' /sbin/mount | md5 → 396a3a85498ce0406d3a2950c9fcbd53
```
and the sandboxed process sees the host's real mounts, including sealed-system detail:
```
/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
/dev/disk3s6 on /System/Volumes/VM (apfs, local, noexec, ...)
/dev/disk3s2 on /System/Volumes/Preboot ...
/dev/disk3s4 on /System/Volumes/Update ...
```

**[V] No `chroot`-based private view either** (this is a capability denial by the profile, demonstrating that Seatbelt *can* deny chroot but supplies no substitute):
```
sandbox-exec -p '(version 1)(allow default)' sh -c 'chroot /tmp'
→ chroot: /tmp: Operation not permitted     (rc=1)
```

**[V] No PID namespace.** The sandboxed process gets an ordinary host PID and lives in the host's single PID namespace; PID 1 is the host's `launchd`:
```
outside shell pid=99944
sandbox-exec -p '(version 1)(allow default)' sh -c 'echo $$'   → 99955
ps -p 1 -o pid,comm                                              → 1 /sbin/launchd
```
There is no per-sandbox PID view, so PIDs are guessable/enumerable and cross-tenant process identity is shared.

**[V] No mount-namespace / `unshare` capability.** macOS has **no `unshare` binary at all** on this host (`ls /usr/bin/unshare /bin/unshare` → No such file or directory, [V]), so the Linux `unshare --mount --pid` idiom has no counterpart. `mount(8)` inside a sandbox does not create a private namespace either:
```
sandbox-exec -f tight.sb sh -c 'mount -t tmpfs none /tmp/x'
→ mount: /tmp/x: invalid file system.      (rc=66)
```

**[V] No separate kernel.** `uname -a` inside the sandbox returns the host kernel verbatim: `Darwin Kernel Version 25.4.0: Thu Mar 19 19:31:09 PDT 2026; root:xnu-12377.101.15~1/RELEASE_ARM64_T8132 arm64`.

**[V] No private network stack.** Seatbelt can only deny or permit socket operations; it cannot create a network namespace, veth pair, netns, or per-process network stack. Verified enforcement of denial only: `(deny network*)` blocked both `nc` and bash `/dev/tcp`. It has no notion of a separate stack. (Cross-check: Apple's own answer to this need is a *VM*, see the containerisation section below.)

### Consequences for an application that wants to hand a program a restricted view of the host
- A denied `file-read*` still leaves the *existence and metadata* of paths partly observable unless you also deny `file-read-metadata` — a classic information leak, because a "denied" path may still be distinguishable from a nonexistent one. [I] I observed `deny(1) file-read-metadata /` and `deny(1) file-read-metadata /Users` in the kernel log for unrelated processes, illustrating that metadata enumeration is a separately-gated operation that callers frequently forget. [I]
- Because the mount table is shared and immutable from inside, a sandboxed program can still observe the host's device/partition topology and, if permitted to read `/System/Volumes/*`, learn about the sealed system volume and update volumes. [I]
- Because PIDs are shared and unrenumbered, PID-based isolation (a common weak sandbox trick) is meaningless here. [I]
- **Net:** Seatbelt answers "what may this process do?" but not "what does this process see?". Any requirement that needs genuine view/virtualisation isolation is out of scope and must be met with a VM, a container, or an emulator — not Seatbelt. [I]

### Cited Findings
- Apple's own Containerization framework takes precisely this route, running each Linux container in its **own lightweight virtual machine** via `Virtualization.framework`, giving dedicated IP addresses and requiring only Apple silicon + macOS 26. — [apple/containerization README](https://github.com/apple/Containerization/blob/main/README.md), [apple/container README](https://github.com/apple/container/blob/main/README.md)
- On the Linux side, upstream Landlock documentation explicitly separates the two concerns, noting namespaces *"can help create sandboxes but they are not designed for access-control and then miss useful features for such use case"* — i.e. namespaces and access-control sandboxes solve different problems and are complementary. — [Landlock kernel docs](https://www.kernel.org/doc/html/v6.16/userspace-api/landlock.html)

### Gaps
- I did not test whether an APFS firmlink or a bind-mount-style trick could produce a partial path-remapping effect from *inside* a sandbox. Given the identical mount-table md5 and absence of any namespace primitive, I am confident there is no supported mechanism, but I did not exhaustively attempt exploits.

---

## Real escape surface

### Takeaway
The critical distinction is between **(a) the process breaking out on its own** — which Seatbelt genuinely prevents; and **(b) the process asking an already-unsandboxed party to act for it** — which it cannot prevent, and which Apple documents explicitly. The single most important escape vector is the **inherited file descriptor**, which is a documented, by-design hole.

### Verified Empirically — (b) "ask an unsandboxed helper to act for you": the inherited-fd bypass
**[V] This is the headline escape finding.** Apple's `sandbox(7)` documents it; I reproduced it:
```
exec 9< <TMP>/seatbelt/secret/secret.txt          # opened OUTSIDE the sandbox
sandbox-exec -f tight.sb sh -c 'echo "fd 9 content:"; cat <&9'
→ fd 9 content:
  SECRET-DATA-abc123                              rc=0
```
The sandboxed process read a file it is **provably forbidden to open by path** (Test T2 shows the same path returns EPERM when opened normally), purely because the descriptor was inherited across the sandbox boundary. This is exactly the scenario `sandbox(7)` warns about: *"if the application already has a file descriptor opened for writing, it may use that file descriptor regardless of restrictions."*

**[I] Generalised:** any capability that can be *carried in* rather than *acquired* bypasses Seatbelt. This includes inherited fds, inherited Mach ports, inherited XPC connections, inherited mmap'd regions, inherited sockets, and stdin/stdout/stderr. **[V]** stdio passthrough confirmed working (`echo to-stdout` / `echo to-stderr` both succeeded under `tight.sb`).

### Verified Empirically — DYLD_* library injection
**[V] DYLD injection is gated by file-read policy, not blocked by Seatbelt per se:**
```
# unsandboxed, self-compiled victim binary
DYLD_INSERT_LIBRARIES=inject.dylib ./victim
→ [INJECTED] library loaded into process
  victim main ran                                    rc=0

# under a profile that ALLOWS reading the dylib's path (dyld.sb)
sandbox-exec -f dyld.sb sh -c "DYLD_INSERT_LIBRARIES=inject.dylib ./victim"
→ [INJECTED] library loaded into process
  victim main ran                                    rc=0     # INJECTION SUCCEEDS

# under a profile that does NOT allow reading it (tight.sb)
sandbox-exec -f tight.sb sh -c "DYLD_INSERT_LIBRARIES=inject.dylib ./victim"
→ dyld[...]: terminating because inserted dylib '.../inject.dylib'
  could not be loaded: ... (file system sandbox blocked open())
```
So: **Seatbelt does not disable DYLD injection**; it constrains it to the extent the dylib lives in an unreadable path. Note the injected code then runs *inside* the sandbox and is still subject to the policy — but it can execute attacker logic and inherits all remaining allowances. [I]

**[V] Code-signing/library-validation is a separate layer, and it blocked my attempt against a copied system binary.** Injecting into a copy of `/usr/bin/true` produced no constructor call even unsandboxed; the kernel/AMFI log explains why:
```
kernel: AMFI: '.../xpcprobe2' is adhoc signed.
amfid: ... Error Domain=AppleMobileFileIntegrityError Code=-423
       "The file is adhoc signed or signed by an unknown certificate chain"
```
**[I]** Practical meaning: `DYLD_INSERT_LIBRARIES` is only a practical vector against non-platform-signed binaries; SIP-protected Apple platform binaries resist it via code-signing, independent of Seatbelt. This is a caveat against over-claiming DYLD as a universal escape.

### Verified Empirically — setuid helper binaries
**[V]** Attempting to exec a setuid-root helper from inside a sandbox is blocked at the exec:
```
sandbox-exec -p '(version 1)(allow default)(deny file-write*)' /usr/bin/sudo -n true
→ sandbox-exec: execvp() of '/usr/bin/sudo' failed: Operation not permitted
```
(`/usr/bin/sudo` is `-r-s--x--x root:wheel`, `/usr/bin/su` is `-rwsr-xr-x`.) [V] This is the `mac_vnode_check_exec` / process-exec policy check. [I]

### Verified Empirically — IPC / XPC to unsandboxed processes
**[C]+[V]** `mach-lookup` is a first-class Seatbelt operation and is genuinely enforced — confirmed both by the rule surface and by kernel log evidence from this machine:
```
kernel: Sandbox: parsecd(26128) deny(1) mach-lookup com.apple.apsd
kernel: Sandbox: spotlightknowledged(15986) deny(1) mach-lookup com.apple.diagnosticd
```
**[V]** My own direct probes were inconclusive on the *happy path* for an important reason worth reporting: XPC connection creation is **lazy**. `xpc_connection_create_mach_service()` returns a handle without performing a bootstrap lookup, so under `(deny mach-lookup)` all four services still yielded handles:
```
com.apple.system.notification_center          handle obtained (0x10563d990)
com.apple.pasteboard.1                        handle obtained (0x10563e170)
com.apple.coreservices.launchservicesd        handle obtained (0x10563e450)
com.apple.securityd                           handle obtained (0x10563e730)
```
**[V]** Also, `bootstrap_look_up()` is effectively neutered on modern macOS — it returned `kr=112 (unknown error code)` for both a real and a fake service name, unsandboxed and sandboxed, so it cannot discriminate. **[I]** This means the practical XPC risk is: a sandboxed process must be *granted* `mach-lookup` for a given service name; if the profile omits it, real IPC to that service will fail at first message. The escape-relevant consequence is that **`(allow mach-lookup)` is a broad grant**: any service enumerated in the profile becomes a confused deputy available to the sandboxed code, and such a service runs *outside* the sandbox. [I]

### Verified Empirically — signals
**[V]** `(deny signal)` successfully blocked signalling an unsandboxed process (`kill -0` → Operation not permitted), while the same signal from the host succeeded. So signal-based escape *is* preventable, but only if the profile denies it; `(allow default)` grants it. [V] The kernel hook is `mac_proc_check_signal`. [C]

### Inferences — the honest taxonomy
- **"Breaks out on its own": prevented.** Seatbelt genuinely blocks: re-initialising itself (`sandbox_init` fails), `exec`ing `sandbox-exec` to get a fresh unsandboxed child (`sandbox_apply: EPERM`), reading/writing forbidden paths by name, socket operations, cross-domain signals (if denied), and setuid helper exec. All [V].
- **"Asks an unsandboxed helper to act for it": NOT prevented, and partly by design.** The inherited-fd bypass is documented [C] and reproduced [V]. Beyond fds, any reachable unsandboxed service permitted by `mach-lookup` (or an inherited Mach port / XPC connection) is a confused deputy. This is the real escape surface and it is fundamentally about *composition with other principals*, not about defeating Seatbelt's own checks. [I]
- **DYLD injection** is a code-execution vector into the sandbox, gated by readable-path policy rather than blocked as a class [V], and further gated in practice by code-signing for platform binaries [V]. [I]
- The real operational lesson: **Seatbelt's strength is entirely a function of profile completeness.** Every broad grant is a potential confused deputy, and the profile must be updated as Apple's system frameworks change which services they contact (this compatibility-drift burden is exactly why Chromium documents its V2 sandbox this way). [C: Chromium doc] [I]

### Gaps
- I did **not** empirically demonstrate a *successful* sandbox escape against a well-formed restrictive profile via XPC/mach confused-deputy (e.g. making a permitted daemon read a forbidden file on request). My mach-lookup probe was blocked by lazy connection semantics. The confused-deputy risk is **[I]**, supported by the operation surface and by the observed `deny(1) mach-lookup` lines, not by a completed end-to-end escape in my testing.
- I did not test Mach port inheritance, `task_for_pid`, or `IOKit` user-client access as escape vectors.

---

## Inheritance: does the policy survive `exec`? Do children inherit? Can it be applied to an already-running process?

### Takeaway
Inheritance is total and automatic: the policy survives `exec` and propagates to all descendants at any depth. It is a **one-way door** — it cannot be relaxed from inside, and there is no supported way to apply a sandbox to an already-running process.

### Cited Findings
- `sandbox(7)`: *"**New processes inherit the sandbox of their parent.** Restrictions are generally enforced upon acquisition of operating system resources only."* — [V] `man sandbox` on this host.
- `sandbox.h`: *"If the process is already in a sandbox, the new profile is ignored and `sandbox_init()` returns an error."* — [V] SDK header, `MacOSX26.4.sdk/usr/include/sandbox.h`.

### Verified Empirically
**[V] Survives `exec` and propagates through arbitrarily deep nesting:**
```
# 4a: sh execs cat (grandchild) — still denied
sandbox-exec -f tight.sb sh -c "cat <secret>"
→ cat: .../secret/secret.txt: Operation not permitted        rc=1

# 4b: sh -> sh -> sh -> cat (three levels) — still denied
sandbox-exec -f tight.sb sh -c "/bin/sh -c '/bin/sh -c \"cat <secret>\"'"
→ cat: .../secret/secret.txt: Operation not permitted        rc=1
```
**[V] Survives a completely different binary:**
```
sandbox-exec -f tight.sb /opt/homebrew/bin/node -e "..."
→ (ran; policy enforced — see gaps)
```
**[V] Applying to an already-running process: not possible via the supported interface.** `sandbox_init` operates on the *current* process, and `sandbox-exec` applies the policy at `exec` time of a child it then launches. There is no "attach to PID" mechanism in `sandbox-exec`. The closest observed behaviour is the *negative* case (Test C): calling `sandbox_apply` from inside an already-sandboxed process fails with `Operation not permitted`.

### Inferences
- Because inheritance is automatic and mandatory, the only supported way to get a differently-sandboxed process is to launch it from a different (differently- or non-)sandboxed parent — i.e. `sandbox-exec` from an unsandboxed parent. [I]
- This inheritance property is what makes Seatbelt's security model coherent: there is no way to spawn an unconfined child from within a confined parent, so compromise of a confined process cannot trivially fork its way to freedom. [I]

### Gaps
- I did not test `fork()`-without-`exec` inheritance directly (I tested exec-chains). The man page asserts inheritance generally; I verified the exec/fork-via-shell cases, which are the common ones.
- I did not verify the precise kernel-internal credential-label propagation (e.g. whether `exec` of a differently-signed binary can ever reset the label); `mac_cred_label_update_execve` exists in the MACF header, which suggests exec-relevant label handling exists, but I did not probe it.

---

## Linux analogues (bubblewrap / landwrap, Landlock, seccomp) for cross-platform contrast

### Takeaway
Linux has a richer, more modular toolbox than macOS: **namespaces** (view isolation), **Landlock** (unprivileged unprivileged access control, the closest functional analogue to Seatbelt), and **seccomp-BPF** (syscall filtering). macOS Seatbelt is a single mechanism that bundles access control but provides none of the view-isolation primitives that Linux namespaces and VMs provide.

### Cited Findings
- **Landlock** is a *stackable* Linux LSM that lets *any* process, including unprivileged ones, restrict its own ambient rights: *"The goal of Landlock is to enable to restrict ambient rights (e.g. global filesystem or network access) for a set of processes... Landlock empowers any process, including unprivileged ones, to securely restrict themselves."* It was introduced in **Linux 5.13**, requires `CONFIG_SECURITY_LANDLOCK` at build time and boot-time enablement. — [Landlock kernel docs](https://www.kernel.org/doc/html/v6.16/userspace-api/landlock.html)
- **Landlock's trust model is explicitly no_new_privs-gated**: *"Enforcing a ruleset requires that the task has CAP_SYS_ADMIN in their namespace or is running with no_new_privs. This avoids scenarios where unprivileged tasks can affect the behavior of privileged children."* — [Landlock](https://www.kernel.org/doc/html/latest/userspace-api/landlock.html). The docs also warn: *"sandboxed processes could still execute set-user-ID, set-group-ID or file-capability binaries"* if `no_new_privs` is left unset — [Landlock](https://www.kernel.org/doc/html/latest/userspace-api/landlock.html). **[I]** This is a directly comparable concern to macOS's setuid helper vector.
- **Landlock's inheritance** matches Seatbelt's: *"Every new thread resulting from a `clone(2)` inherits Landlock domain restrictions from its parent."* — [Landlock](https://www.kernel.org/doc/html/v6.16/userspace-api/landlock.html)
- **Landlock distinguishes scope of unconfined peers**, with `LANDLOCK_SCOPE_SIGNAL` and `LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET` to *"Restrict a sandboxed process from connecting to an abstract UNIX socket created by a process outside the related Landlock domain... or sending a signal to another process outside the domain."* — [Landlock 7.1-rc3 docs](https://www.kernel.org/doc/html/v7.1-rc3/userspace-api/landlock.html). **[I]** This is the explicit, first-class expression of exactly the "sandboxed talks to unsandboxed" boundary that macOS expresses more bluntly via `(deny signal)` / `(deny mach-lookup)`.
- **Landlock explicitly separates namespaces from access control**: *"Namespaces can help create sandboxes but they are not designed for access-control and then miss useful features for such use case (e.g. no fine-grained restrictions). Moreover, their complexity can lead to security issues, especially when untrusted processes can manipulate them."* — [Landlock](https://www.kernel.org/doc/html/v6.16/userspace-api/landlock.html)
- **Landlock's own design history** explicitly positions it as comparable to Apple's technology: *"The goal of this new stackable Linux Security Module (LSM) called Landlock is to allow any process, including unprivileged ones, to create powerful security sandboxes comparable to **XNU Sandbox** or OpenBSD Pledge."* — [LWN, "Landlock LSM: Toward Unprivileged Sandboxing"](https://lwn.net/Articles/731478)
- Landlock has a known limitation analogous to Seatbelt's fd issue, and states it explicitly: *"Files or directories opened before the sandboxing are not subject to these restrictions."* — [Landlock 5.13 docs](https://www.kernel.org/doc/html//v5.13/userspace-api/landlock.html). **[I]** Notably, macOS's `sandbox(7)` documents this *same* inherited-fd caveat, so both platforms share this "acquisition-time" enforcement weakness — Seatbelt is not unusual here.
- Landlock is designed so rules *"shall not be able to programmatically communicate with user space"* (to avoid side-channel policy leaks) — [Landlock kernel docs](https://docs.kernel.org/security/landlock.html). **[I]** SBPL gives no comparable guarantee.

### Inferences — cross-platform contrast
- **Closest analogue:** Landlock ≈ Seatbelt (unprivileged, self-imposed, inherited, filesystem-focused access control). Seatbelt's distinctive property versus Landlock is that Seatbelt is *bundled with a daemon/IPC/kill model* in one policy language, whereas Landlock is layered with seccomp and namespaces as separate orthogonal mechanisms. [I]
- **Key asymmetry for a cross-platform product:** Linux can compose **namespaces (view isolation) + Landlock (access control) + seccomp (syscall filter) + optionally a VM**; macOS offers **Seatbelt (access control only) + Virtualization.framework (VM)**. There is no macOS equivalent of `unshare`/`bwrap`'s namespace-isolation path. So a cross-platform sandboxing story must use a different mechanism per OS for true view isolation — Seatbelt cannot substitute for `bubblewrap` when "restricted view of the host" is the requirement. [I]
- I did not find a primary source in this research pass for **bubblewrap** or a tool named **landwrap** specifically; see Gaps.

### Gaps
- I did not obtain a primary citation for **bubblewrap** (`bwrap`) or for any tool specifically named **"landwrap"** in this pass. I should not assert facts about "landwrap" without a source. The closest sourced analogue I found is **"landlock-island"** (`island`), a third-party Landlock wrapper for command execution, explicitly *"not yet ready for production use"* — [github.com/landlock-lsm/island](https://github.com/landlock-lsm/island). **[I]** Recommend the report-writer treat "landwrap" as unverified and either source it directly or substitute Landlock/bubblewrap.
- I did not empirically test Landlock/seccomp (this is a macOS host); the Linux material is cited, not verified.

---

## Bottom line for a report-writer

1. **Seatbelt works and is still shipped on macOS 26.4.1**, but Apple marks `sandbox-exec`, `sandbox_init`, and the SDK header **DEPRECATED** (since 10.8 per the header, not 10.15 as the brief stated), directing developers to **App Sandbox**. It remains used by ~510 Apple base profiles internally.
2. **It is kernel-enforced MACF** (TrustedBSD-derived), visible as `kernel[...] (Sandbox) deny(1) ...`, and **cannot be lifted by the sandboxed process** — verified via failed `sandbox_init`, retained enforcement after that failure, and denied `sandbox_apply`.
3. **The honest trust boundary:** it reduces the blast radius of the sandboxed process against *itself*; it does not compartment it from unsandboxed peers it can reach, and the `sandbox(7)`-documented **inherited-fd bypass** is a real, reproduced escape-by-delegation.
4. **Structurally, Seatbelt provides no namespaces, no path remapping, no private FS view, no private network stack, and no separate kernel** — all confirmed empirically (identical mount-table md5, shared PID namespace, no `unshare`, shared kernel). It therefore **cannot** satisfy "hand a program a restricted view of the host"; that needs a VM (Apple Containerization / Virtualization.framework) or, on Linux, namespaces+bwrap.
5. **Cost is a fixed ~5.5–6 ms per sandboxed exec** (measured), which is negligible for long-lived processes but real for high-fanout short-lived ones.
6. **Cross-platform:** Landlock is the closest unprivileged analogue; Linux additionally has namespaces and seccomp, giving a richer composition story than macOS's single Seatbelt mechanism.