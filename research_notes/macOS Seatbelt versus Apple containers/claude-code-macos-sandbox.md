# Claude Code's macOS sandboxing, from public sources only

Research date: 2026-10-10. All sources below were fetched from the public web on that date. Nothing in this
file was obtained by inspecting, decompiling, disassembling, or string-extracting the shipped Claude Code
binary or any installed package directory.

**Primary sources used**

- P1 — Anthropic docs, "Configure the sandboxed Bash tool": https://code.claude.com/docs/en/sandboxing
  (also reachable as https://docs.claude.com/en/docs/claude-code/sandboxing). Accessed 2026-10-10.
- P2 — Anthropic docs, "All settings" (settings reference): https://code.claude.com/docs/en/settings-reference
- P3 — Anthropic docs, "Choose a sandbox environment": https://code.claude.com/docs/en/sandbox-environments
- P4 — Anthropic docs, "Security": https://code.claude.com/docs/en/security
- P5 — Anthropic docs, "CLI reference": https://code.claude.com/docs/en/cli-reference
- P6 — Anthropic engineering blog, "Beyond permission prompts: making Claude Code more secure and
  autonomous", published **Oct 20, 2025**: https://www.anthropic.com/engineering/claude-code-sandboxing
- P7 — Anthropic public repository, `@anthropic-ai/sandbox-runtime` README (vendor-published, open source):
  https://github.com/anthropics/sandbox-runtime (README raw: https://raw.githubusercontent.com/anthropics/sandbox-runtime/main/README.md)
- P8 — Public Claude Code changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
  (raw: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md), ~986 KB.
- T1 — Third-party analysis, CodeAnt, "Claude Code macOS Sandbox Escape via Literal Path and Glob
  Confusion", published **Oct 10, 2026**: https://codeant.ai/blogs/claude-code-macos-sandbox-escape
  **Treat T1 with caution — see its reliability note in Q8.**

**Staleness flags**

- P6 is dated **Oct 20, 2025** — roughly a year old as of this research. It describes the launch state.
  Where P6 and P1 disagree (P1 is far richer and has version-gated notes up to **v2.1.290**), P1 wins.
- P1/P2/P3/P4/P5 are living documents. They contain explicit "Requires Claude Code vX.Y.Z or later"
  markers; treat any specific claim as version-sensitive and re-check against the live page before
  depending on it.
- P8 was read at the head of the `main` changelog, so it covers the newest releases only. Entries below
  are quoted with the surrounding context where the version number was recoverable.

---

## Q1. Does Claude Code sandbox on macOS via Seatbelt / `sandbox-exec`, and is it officially documented?

### Takeaway

Yes — Seatbelt is the officially documented enforcement mechanism on macOS, and the open-source package
Anthropic publishes states the mechanism is `sandbox-exec` with dynamically generated Seatbelt profiles.
The *exact* invocation (`/usr/bin/sandbox-exec -p <profile>`) and the *exact SBPL text* are not published.

### Cited Findings

- **VERIFIED-FROM-PUBLIC-SOURCE.** "The sandboxed Bash tool uses operating system security primitives:
  **macOS: uses Seatbelt for sandbox enforcement**; **Linux: uses [bubblewrap](https://github.com/containers/bubblewrap)
  for isolation**; **WSL2: uses bubblewrap, same as Linux**." — P1 §"OS-level enforcement"
- **VERIFIED-FROM-PUBLIC-SOURCE.** "The sandbox runs on macOS, Linux, and WSL2. On native Windows, Claude Code
  runs commands unsandboxed." — P1 intro
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Claude Code builds the sandbox on the open source
  [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime) package." — P1 §"What the
  sandbox restricts"
- **VERIFIED-FROM-PUBLIC-SOURCE.** "`srt` uses native OS sandboxing primitives (**`sandbox-exec` on macOS**,
  `bubblewrap` on Linux) and proxy-based network filtering." — P7
- **VERIFIED-FROM-PUBLIC-SOURCE.** "**macOS: Uses `sandbox-exec` with dynamically generated [Seatbelt
  profiles](https://reverse.put.as/wp-content/uploads/2011/09/Apple-Sandbox-Guide-v1.0.pdf)**" — P7 §"How It Works"
- **VERIFIED-FROM-PUBLIC-SOURCE.** "**macOS**: Uses `sandbox-exec` with custom profiles (**no additional
  dependencies**)" — P7 §"Platform Support". Corroborated by P1: "**macOS**: sandboxing uses the built-in
  Seatbelt framework, so you can go straight to the steps" (no `bubblewrap`/`socat` on macOS).
- **VERIFIED-FROM-PUBLIC-SOURCE.** Anthropic's own launch post names the primitive: "We've built this on top
  of OS level primitives such as **Linux bubblewrap** and **MacOS seatbelt** to enforce these restrictions at
  the OS level." — P6
- **VERIFIED-FROM-PUBLIC-SOURCE.** Violation detection on macOS rides the system log store: "The sandbox
  runtime taps into macOS's system sandbox violation log store… This is the same mechanism Claude Code uses
  for violation detection," with the example `log stream --predicate 'process == "sandbox-exec"' --style syslog`
  — P7. Note the predicate matches the **`sandbox-exec` process name**, which is itself public evidence that
  `sandbox-exec` is the launcher on macOS.
- **VERIFIED-FROM-PUBLIC-SOURCE (partial).** One SBPL fragment *is* published, for the optional
  `allowPty` setting: "The seatbelt profile then carries `(allow pseudo-tty)` plus read, write and `ioctl`
  on `/dev/ptmx` and `/dev/ttys*`" — P7 §Other Configuration. This is the only SBPL text in any public
  Anthropic source.

### Inferences

- Because P7 says the Seatbelt profile is *dynamically generated*, and P1 says per-command config changes
  "apply to the running session … so the next sandboxed command runs under the new paths", the profile is
  regenerated as configuration changes rather than being a fixed artifact. This is an inference from the two
  documents, not a stated fact about profile lifetime.

### Gaps

- The exact argv — whether it is literally `/usr/bin/sandbox-exec -p <profile>`, whether the profile arrives
  by `-p`, by a temp file, or on stdin — is **not confirmable from public sources**. P7 names the binary and
  the profile language; neither P1, P2, P3, P4, P6, nor P7 publishes the command line.
- The SBPL text of a real generated profile (`(version 1)`, `(deny default …)`, rule ordering) is **not
  confirmable from public sources**. Only the `allowPty` fragment above is published.

---

## Q2. What is actually confined — the whole agent process, or individual shell invocations? (MOST IMPORTANT)

### Takeaway

**Definitively per-invocation, not per-process.** Anthropic documents this explicitly and repeatedly: the
built-in sandbox covers "Bash, PowerShell, and Monitor commands and the processes they start", while the
agent process itself, its file tools, MCP servers, hooks and helpers run *outside*. Anthropic also tells you
verbatim to run the whole process in the sandbox runtime, a container, or a VM if you want a boundary around
everything.

### Cited Findings

- **VERIFIED-FROM-PUBLIC-SOURCE.** "The Bash sandbox is a boundary that the operating system enforces **around
  the shell commands Claude runs on your machine**… the limits apply to **Bash, PowerShell, and Monitor
  commands and the processes they start**." — P1 intro
- **VERIFIED-FROM-PUBLIC-SOURCE.** "**The sandbox covers shell commands only.** Claude's file tools, MCP
  servers, and hooks [run outside it]." — P1 intro
- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §"What runs outside the sandbox", verbatim:
  > "The sandbox wraps shell commands. These tools and processes run outside it:
  > * **Built-in file and web tools**: tools such as Read, Edit, Write, WebFetch, and WebSearch follow
  >   permission rules instead. A `denyRead` entry doesn't stop the Read tool, and `allowedDomains` doesn't
  >   limit WebFetch
  > * **Other processes Claude Code starts**: command hooks, local MCP servers, plugin monitors, LSP servers,
  >   and helper commands such as your status line command and `apiKeyHelper` run with your full access"
- **VERIFIED-FROM-PUBLIC-SOURCE.** P1, the sentence that answers the question directly, verbatim:
  > "To put the tools, processes, and commands in this section behind one boundary, run the Claude Code
  > process itself in a **container, virtual machine, or the sandbox runtime**."
- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §Limitations › Scope, verbatim:
  > "**A boundary around the whole process**: to put the processes in What runs outside the sandbox behind a
  > boundary too, run Claude Code (local mode) inside the **sandbox runtime** with a network allowlist limited
  > to the hosts you approve, or in the **dev container** with its firewall script."
- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §Limitations › Scope, verbatim: "**Subagents**: subagents run in the
  same process as the parent session and use the same sandbox configuration." (i.e. even subagents are not a
  separate boundary; only their *Bash commands* are sandboxed.) "**Background sessions**: a background
  session runs in its own process, and its Bash commands are sandboxed when its settings enable sandboxing."
- **VERIFIED-FROM-PUBLIC-SOURCE.** P3's comparison table is unambiguous:

  | Approach | What is isolated | Requires Docker |
  | :- | :- | :- |
  | Sandboxed Bash tool | **Bash, PowerShell, and Monitor tool commands and their child processes** | No |
  | Sandbox runtime | **The whole Claude Code process, including file tools, MCP servers, and hooks** | No |
  | Dev container / Custom container | Full development environment | Yes |
  | Virtual machine | Full operating system | No |

  followed by: "The sandboxed Bash tool is built into Claude Code and restricts Bash commands. Built-in file
  tools, MCP servers, and hooks still run directly on your host. **Every other approach in the table puts the
  whole Claude Code process inside the isolation boundary**, so file tools, MCP servers, and hooks are
  restricted too." — P3 §"Compare sandboxing approaches"
- **VERIFIED-FROM-PUBLIC-SOURCE.** P3 §"Sandboxed Bash tool", verbatim: "The per-command sandbox does not cover
  everything that runs in a session… **MCP servers, command hooks, and plugin monitors are separate processes
  that run unconstrained on the host.**"
- **VERIFIED-FROM-PUBLIC-SOURCE.** P3 §"How isolation relates to permission modes", verbatim: "The sandboxed
  Bash tool on its own constrains only shell commands, **so it is not sufficient for fully unattended runs in
  either mode**.… **Always run `--dangerously-skip-permissions` sessions inside a container, a VM, or the
  sandbox runtime**, so that file tools, MCP servers, and hooks are also inside the boundary. On Linux and
  macOS, Claude Code refuses to start with this flag when running as root, so run the container, VM, or sandbox
  runtime as a non-root user."
- **VERIFIED-FROM-PUBLIC-SOURCE.** P4 §"Security best practices › Working with sensitive code", verbatim:
  "For additional isolation, run the whole Claude Code (local mode) process inside the sandbox runtime or a
  dev container."
- **VERIFIED-FROM-PUBLIC-SOURCE.** P7 states the same for the standalone runtime: "The `SandboxManager`…" /
  "The sandbox uses OS-level primitives to enforce restrictions that apply to **the entire process tree**:
  **macOS**: Uses `sandbox-exec` with dynamically generated Seatbelt profiles" — and P3: "The
  `@anthropic-ai/sandbox-runtime` package **wraps an entire process** in the same Seatbelt or bubblewrap
  isolation that the built-in Bash sandbox uses."
- **VERIFIED-FROM-PUBLIC-SOURCE.** `sandbox-environments` also names the practical grove-relevant escape
  hatches: cloud sessions ("Full operating system, hosted by Anthropic") and VMs ("Use this approach when
  you are evaluating untrusted code, when your security policy requires kernel-level separation between the
  agent and the host").
- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §Limitations › Scope also flags **mods**: "a mod is a plugin that runs
  its own code inside Claude Code, and a process that a mod starts runs outside the sandbox."

### Inferences

- **Direct consequence for grove's decision:** using Claude Code's built-in sandbox alone gives you
  confinement of *shell commands only*. The Read/Edit/Write tools, MCP servers, hooks, the statusline
  command, `apiKeyHelper`, LSP servers, and any plugin/mod subprocess all run with full user-level access on
  the host. If grove wants "confine an agent process's filesystem access", Claude Code's own sandbox is a
  **per-command** control and would need to be layered *inside* an outer process-level boundary.
- Anthropic's own recommendation for unattended / `--dangerously-skip-permissions` use is an outer boundary.
  Anthropic's ranking of approaches in P3 puts "Virtual machine" above "Custom container" above "Dev
  container" above "Sandbox runtime" above "Sandboxed Bash tool" in strength.
- Note the root refusal documented in P3: on Linux and macOS, `--dangerously-skip-permissions` is refused
  when Claude Code runs as **root**. That matters if grove ever considers running the agent as root to gain
  isolation from the desktop user — Anthropic blocks that configuration on macOS.

### Gaps

- Whether Claude Code's *embedded* copy of `sandbox-runtime` is byte-identical to the published npm package
  at any given release is **not confirmable from public sources**. P1 says it is "built on" the package; it
  does not pin a version. Any grove decision that depends on exact profile contents is therefore unsupported
  by public sources.

---

## Q3. Documented configuration surface — field names and defaults

### Takeaway

The `sandbox` object is fully documented with per-key types and defaults. Note there is **no**
`allowedCommands` key — the write-side analogue is `filesystem.allowWrite`, and there is **no** separate
`allowedCommands`. `enabled` defaults `false`; `autoAllowBashIfSandboxed` and `allowUnsandboxedCommands`
default `true`.

### Cited Findings

All from **P2 §"sandbox settings"** unless noted.

Top-level object:

- **VERIFIED-FROM-PUBLIC-SOURCE.** `sandbox` — "**Scope**: Any file. **Type**: object with `enabled`,
  `failIfUnavailable`, `autoAllowBashIfSandboxed`, `excludedCommands`, `allowUnsandboxedCommands`,
  `enableWeakerNestedSandbox`, `enableWeakerNetworkIsolation`, `allowAppleEvents`, `bwrapPath`, `socatPath`,
  `ignoreViolations`, and `ripgrep`, plus the `filesystem`, `network`, and `credentials` objects.
  **Default**: unset, so Claude Code runs commands without a sandbox."

Core on/off keys (defaults verified verbatim):

| Key | Type | Default | Source quote |
| :- | :- | :- | :- |
| `sandbox.enabled` | Boolean | **`false`** | "`true`: Claude Code sandboxes Bash commands / `false`: Bash commands run unsandboxed. **Default**: `false`" |
| `sandbox.failIfUnavailable` | Boolean | **`false`** | "`true`: Claude Code exits with an error at startup when `sandbox.enabled` is `true` but the sandbox can't start / `false`: Claude Code runs commands unsandboxed when the sandbox can't start. **Default**: `false`" |
| `sandbox.autoAllowBashIfSandboxed` | Boolean | **`true`** | "`true`: Claude Code runs sandboxed Bash commands without a permission prompt… **Default**: `true`" |
| `sandbox.allowUnsandboxedCommands` | Boolean | **`true`** | "`true`: Claude can retry a command outside the sandbox with the `dangerouslyDisableSandbox` parameter… **Default**: `true`" |
| `sandbox.excludedCommands` | array of command patterns | **unset** | "**Default**: unset, so no command is excluded" |
| `sandbox.allowAppleEvents` | Boolean | see below | P1/P2: honored only from user, managed, or CLI settings; a repository cannot enable it |
| `sandbox.enableWeakerNestedSandbox` | Boolean | `false` | P7 documents `false` as the default; P2 lists it as a weakening key an admin should force to `false` |
| `sandbox.enableWeakerNetworkIsolation` | Boolean | `false` | P7: "`enableWeakerNetworkIsolation` - Allow access to `com.apple.trustd.agent` in the macOS sandbox (boolean, **default: false**)" |
| `sandbox.ignoreViolations` | object (command pattern → paths) | unset | P2; P7: "Object mapping command patterns to arrays of paths where violations should be ignored" |
| `sandbox.ripgrep` / `sandbox.bwrapPath` / `sandbox.socatPath` | path | unset | P2; `bwrapPath`/`socatPath` are Linux-only per P7 |

Filesystem sub-object (**VERIFIED-FROM-PUBLIC-SOURCE**, P2):

- `sandbox.filesystem.allowWrite` — array of paths; this is the *only* way to grant a subprocess write access
  outside the working directory without dropping it out of the sandbox.
- `sandbox.filesystem.denyWrite`, `sandbox.filesystem.denyRead`, `sandbox.filesystem.allowRead`
- `sandbox.filesystem.allowManagedReadPathsOnly` (managed-only lock)
- `sandbox.filesystem.disabled` — Boolean, "**Default**: `false`", "Requires Claude Code v2.1.216 or later".
  Setting it `true` skips filesystem isolation while keeping network isolation. **Only** user settings,
  managed settings, and `--settings` can set it — project settings cannot. (P1 §"Which settings can disable it")

Network sub-object (**VERIFIED-FROM-PUBLIC-SOURCE**, P2):

- `sandbox.network.allowedDomains` — array of strings; "domain, wildcard pattern, or IP literal, with an
  optional `:port` suffix"; **Default: unset, so your permission mode decides what happens to each new host**
- `sandbox.network.deniedDomains` — same grammar; wins over `allowedDomains`; refused in every permission mode
- `sandbox.network.strictAllowlist` — Boolean; when `true` in user/managed/`--settings`, hosts outside the
  allowlist are denied instead of prompting. Requires v2.1.219+.
- `sandbox.network.allowManagedDomainsOnly` — managed-settings-only lock; blocks instead of prompting
- `sandbox.network.allowUnixSockets` — array of strings, each a socket path; **Default: unset, so the macOS
  sandbox blocks every Unix socket**
- `sandbox.network.allowAllUnixSockets` — Boolean, **Default: `false`**
- `sandbox.network.allowLocalBinding` — Boolean, **Default: `false`**; macOS-only in effect
- `sandbox.network.allowMachLookup` — array of Mach/XPC service names; single trailing `*` matches a prefix,
  `"*"` alone matches every service
- `sandbox.network.httpProxyPort`, `sandbox.network.socksProxyPort` — replace the built-in proxy
- `sandbox.network.tlsTerminate` — experimental TLS termination at the proxy

Credentials sub-object (**VERIFIED-FROM-PUBLIC-SOURCE**, P2/P1):

- `sandbox.credentials.files` — array of `{ "path": …, "mode": "deny" | "mask", … }`
- `sandbox.credentials.envVars` — array of `{ "name": …, "mode": "deny" | "mask", "injectHosts": [...] }`
- `sandbox.credentials.allowPlaintextInject`, `sandbox.credentials.awsPairs`, `sandbox.credentials.sigv4`
- "There is no built-in credential deny list, so only the files and variables you list are restricted." — P1

Permission-related keys that interact with the sandbox (**VERIFIED-FROM-PUBLIC-SOURCE**):

- `permissions.blockReadsOutsideWorkingDirectories` — "sandboxed commands also lose read access to your home
  directory and the other directories that hold user files" (P1 §Filesystem isolation). This is the closest
  thing to a per-path read deny on whole directories.
- `permissions.additionalDirectories`, `--add-dir` / `/add-dir` — add write paths to the sandbox.
- `permissions.defaultMode`, `permissions.allow`, `permissions.ask`, `permissions.deny`,
  `permissions.disableBypassPermissionsMode` (P2).

CLI flags (**VERIFIED-FROM-PUBLIC-SOURCE**, P5 and P1):

- `--settings` — "Path to a settings JSON file or an inline JSON string… Keys you set here override the same
  keys in `settings.json` files for this session." P1 gives a literal one-liner:
  `claude --settings '{"sandbox": {"enabled": true, "allowUnsandboxedCommands": false}}'`
- `--setting-sources` — "Comma-separated list of setting sources to load (`user`, `project`, `local`)". P1:
  "When you exclude a settings source … Claude Code ignores its `sandbox.filesystem` entries, its `Edit`
  permission rules, and its `Read` deny rules when building the sandbox configuration. Requires Claude Code
  v2.1.246 or later."
- `--dangerously-skip-permissions` — "Skip permission prompts. Equivalent to `--permission-mode bypassPermissions`."
- `--permission-mode` — accepts `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions`, `manual`
- `--add-dir`, `--restricted`, `--bare`, `--safe-mode`, `--worktree`, `--tmux`
- **There is no `--sandbox` / `--no-sandbox` flag in the CLI reference.** Enabling is via the `/sandbox`
  slash command or `sandbox.enabled` in a settings file. (P5 flags table contains no sandbox flag; P1 says
  "To turn it on, run `/sandbox` in a session, as Get started shows, or set `sandbox.enabled` to `true` in a
  settings file".)

### Inferences

- The whole configuration surface is JSON settings + the `/sandbox` TUI panel. There is no CLI flag to
  enable or disable it, which means a grove-style launcher must either write a settings file or pass
  `--settings '<json>'` (the inline-JSON form is explicitly documented, so grove can inject
  `{"sandbox": {"enabled": true, ...}}` without touching user files).
- `/sandbox` writes the user's choice to the **project's** `.claude/settings.local.json`; P1 warns that if
  managed settings or `--settings` set `sandbox.enabled`, `sandbox.autoAllowBashIfSandboxed`, or
  `sandbox.allowUnsandboxedCommands`, `/sandbox` refuses with "Sandbox settings are overridden by a
  higher-priority configuration". Relevant if grove passes `--settings`.

### Gaps

- **`sandbox.allowedCommands` does not exist** in the documented settings reference — zero occurrences in the
  full settings-reference page. If the previous notes claimed an `allowedCommands` key, that is **not
  confirmable from public sources** and should be discarded. The closest real keys are
  `filesystem.allowWrite` / `filesystem.allowRead` and the permission rules `permissions.allow`.
- Exact P2 defaults for `sandbox.allowAppleEvents`, `sandbox.strictAllowlist`,
  `sandbox.allowManagedDomainsOnly`, `sandbox.tlsTerminate` sub-keys, `sandbox.ripgrep` were not captured in
  this pass; P1 describes `allowAppleEvents` as off-by-default ("The sandbox blocks Apple Events by
  default") and `strictAllowlist` / `allowManagedDomainsOnly` as opt-in locks.

---

## Q4. Network egress handling

### Takeaway

Blocked at the socket layer by default, and **proxied** through a proxy process running on the host outside
the sandbox. The Seatbelt profile permits connection only to the proxy's localhost port. Domain
allowlisting is enforced by the proxy on the client-supplied hostname, and the default TLS behaviour does
**not** inspect encrypted content (so domain fronting is a documented bypass).

### Cited Findings

- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §Network isolation, verbatim:
  > "A sandboxed command has no direct route to the network:
  > * **Linux and WSL2**: the command runs in a separate network namespace that has no connection to your network
  > * **macOS**: **the Seatbelt sandbox framework by default blocks connections other than the one to the sandbox proxy**"
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Claude Code runs the sandbox proxy on your machine, **outside the
  sandbox**, and directs commands to it with `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and related environment
  variables. The proxy checks the hostname of each connection against your allowed and denied domains." — P1
- **VERIFIED-FROM-PUBLIC-SOURCE.** P7 §Dual Isolation Model: "**macOS: The Seatbelt profile allows
  communication only to a specific localhost port.** The proxies listen on this port, creating a controlled
  channel for all network access"; and §Network Isolation: "All other network access is blocked."
- **VERIFIED-FROM-PUBLIC-SOURCE.** Non-HTTP and non-TCP traffic is simply dead: "Anything that isn't TCP: UDP,
  HTTP/3 over QUIC, and ICMP tools such as `ping` can't leave the sandbox" — P1.
- **VERIFIED-FROM-PUBLIC-SOURCE.** Proxy-ignorant tools cannot connect at all: "Tools that ignore the proxy
  variables: plain `ssh`, most database drivers, and similar tools can't connect, even to an allowed host."
  — P1. This is why plain `ssh`/`scp`/`rsync` and most DB drivers fail inside the sandbox.
- **VERIFIED-FROM-PUBLIC-SOURCE.** Default allowlist is empty: "`sandbox.network.allowedDomains` … **Default**:
  unset, so your permission mode decides what happens to each new host" — P2. And P1's summary table:
  "Network | **No direct route out.** Connections go through a proxy on your machine that checks each host
  against your allowed domains, **which start empty**."
- **VERIFIED-FROM-PUBLIC-SOURCE.** Documented configuration syntax (P2), all with defaults:
  ```json
  {
    "sandbox": {
      "network": {
        "allowedDomains": ["github.com", "*.npmjs.org", "api.example.com:443"],
        "deniedDomains": ["uploads.github.com"],
        "allowLocalBinding": true,
        "allowUnixSockets": ["~/.ssh/agent-socket"],
        "allowMachLookup": ["com.apple.coresimulator.*"]
      }
    }
  }
  ```
  "Wildcards such as `*.example.com` match subdomains, and an optional `:port` suffix limits an entry to one
  port; an entry without a port matches every port." IPv6 literals must be bracketed: `"[::1]"`,
  `"[::1]:443"` (requires v2.1.229+).
- **VERIFIED-FROM-PUBLIC-SOURCE.** What happens to an unlisted host depends on permission mode (P1,
  verbatim table):
  | Permission mode | What happens to the connection |
  | :- | :- |
  | `bypassPermissions` mode, and plan mode with bypass permissions available | **Allowed without a prompt** |
  | Manual mode, `acceptEdits` mode, and plan mode otherwise | You get a prompt |
  | Auto mode | Refused unless the command listed the host and the classifier approved the list |
  | `dontAsk` mode | Refused |

  "With `strictAllowlist` or `allowManagedDomainsOnly` on, the built-in sandbox proxy refuses the connection
  in **every** permission mode."
- **VERIFIED-FROM-PUBLIC-SOURCE.** SSRF-ish local-address check: "After a hostname passes the allowlist, the
  sandbox proxy resolves it and refuses the connection when the name resolves only to local addresses. Local
  addresses include loopback addresses such as `127.0.0.1`, link-local addresses such as the `169.254.169.254`
  cloud metadata endpoint, and addresses assigned to your own machine. The names `localhost` and
  `*.localhost` are allowed to resolve to loopback." — P1. (Requires v2.1.284+; "Before v2.1.284, the proxy
  connected to whatever address an allowed hostname resolved to.")
- **VERIFIED-FROM-PUBLIC-SOURCE.** Documented limitation: "the built-in proxy does not terminate or inspect TLS
  on outbound traffic, so the contents of encrypted connections are not examined" and the explicit warning:
  "Because the proxy makes its allow decision from the client-supplied hostname without inspecting TLS, code
  running inside the sandbox can potentially use **domain fronting** or similar techniques to reach hosts
  outside the allowlist." — P1 §Security limitations
- **VERIFIED-FROM-PUBLIC-SOURCE.** Bring-your-own-proxy: `sandbox.network.httpProxyPort` / `socksProxyPort`
  "replace the built-in sandbox proxy with a proxy you run on the same machine", with a warning that once
  set "Claude Code's own network controls, such as `allowedDomains`, `deniedDomains`, `strictAllowlist`,
  approval prompts, and the local-address check, stop applying to that traffic." — P1 §Custom proxy configuration
- **VERIFIED-FROM-PUBLIC-SOURCE.** P6 (Oct 2025) describes the same design: "only allowing internet access
  through a unix domain socket connected to a proxy server running outside the sandbox… we also support
  customizing this proxy to enforce arbitrary rules on outgoing traffic." Note P6 says *unix domain socket*
  while the current P7/P1 describe *localhost TCP ports* on macOS and a *bind-mounted Unix socket* on
  Linux. The macOS description has since changed; prefer P1/P7.

### Inferences

- On macOS the enforcement primitive is purely the Seatbelt socket filter plus the proxy's allowlist — no
  kernel-level egress filtering (no PF/pfctl, no network namespace). Seatbelt's `network-outbound` rules
  cannot filter by domain at all, which is precisely why the proxy exists. If grove needs egress filtering
  that a compromised process cannot influence, Seatbelt alone cannot supply it; only a VM or a firewall
  (Anthropic's own dev-container answer: "default-deny iptables firewall") can.

### Gaps

- The default proxy port numbers on macOS are **not documented** in P1/P2. Only `httpProxyPort` /
  `socksProxyPort` overrides are documented, and the fact that when they are set "Claude Code's own network
  controls … stop applying". Whether a port is allocated dynamically per session is **not confirmable from
  public sources**.
- `network.tlsTerminate` full field list is only partially captured here; the detailed TLS/MITM semantics
  are in P7 (README) rather than in P2 as fetched.

---

## Q5. UNIX sockets and per-path allowlisting

### Takeaway

Yes, both are controllable and both default to closed on macOS. `allowUnixSockets` is a macOS-only
path allowlist; `allowAllUnixSockets` is the blanket switch. Per-path filesystem allowlisting is the whole
point of `filesystem.allowWrite` / `allowRead` / `denyRead` / `denyWrite`, and the runtime additionally
imposes an un-exemptable "protected paths" deny list inside the writable set.

### Cited Findings

- **VERIFIED-FROM-PUBLIC-SOURCE.** `sandbox.network.allowUnixSockets`: "List the Unix socket paths sandboxed
  commands can connect to **on macOS**. Claude Code **ignores this list on Linux and WSL2**, where the seccomp
  filter can't inspect socket paths; use `allowAllUnixSockets` there instead." "**Default**: unset, so the
  **macOS sandbox blocks every Unix socket**." Example value: `"allowUnixSockets": ["~/.ssh/agent-socket"]`. —
  P2
- **VERIFIED-FROM-PUBLIC-SOURCE.** `sandbox.network.allowAllUnixSockets`: Boolean, **Default `false`**;
  "`false`: the sandbox blocks Unix-socket connections: on macOS except the paths in `allowUnixSockets`, and on
  Linux and WSL2 through the seccomp filter when it's present." — P2. P7 corroborates: "Unix sockets are
  **blocked by default** on both platforms."
- **VERIFIED-FROM-PUBLIC-SOURCE.** Documented risk of the per-path socket list: "**Privilege escalation via
  Unix sockets**: the `allowUnixSockets` configuration can inadvertently grant access to system services that
  could lead to sandbox bypasses. For example, allowing access to `/var/run/docker.sock` effectively grants
  access to the host system through the Docker socket." — P1 §Security limitations
- **VERIFIED-FROM-PUBLIC-SOURCE.** Apple Events / Mach: "the macOS sandbox blocks Apple Events by default. The
  `allowAppleEvents` setting lifts this restriction… but it removes code-execution isolation: sandboxed commands
  can launch other applications unsandboxed with no user prompt, and can send AppleScript commands to running
  applications." — P1 §Security limitations. XPC/Mach services are gated by
  `sandbox.network.allowMachLookup` (P2). Docs also note "`open`, `osascript`, or browser-based auth flows
  fail with error `-600` on macOS" as a symptom of the default.
- **VERIFIED-FROM-PUBLIC-SOURCE.** Per-path filesystem control, P1 §Filesystem isolation: "**Default write
  behavior**: read and write access to the current working directory and its subdirectories, any directories
  you've added with `--add-dir` … plus the per-user temp directory"; "**Default read behavior**: read access to
  the entire computer, except certain denied directories. **This default still allows reading credential
  files**, so protect credentials you don't want commands to read."
- **VERIFIED-FROM-PUBLIC-SOURCE — protected paths (an un-exemptable deny list).** P1 §Protected paths,
  verbatim highlights:
  > "Inside the directories that sandboxed commands can write to, the sandbox still **denies writes to the
  > files Claude Code loads configuration and code from**. A command that could edit those files could grant
  > itself permissions, or add a hook or MCP server that Claude Code runs outside the sandbox."
  
  It covers four groups: (1) in the working directory and above — `.claude/settings*.json`, `.claude/skills`,
  `.claude/agents`, `.claude/commands`, `.claude/hooks`, `.mcp.json`, `.claude/workflows`,
  `.claude/scheduled_tasks.json`; (2) working directory only — `.bashrc`, `.zshrc`, `.gitconfig`,
  `.vscode`, `.idea`, and `hooks`/`config` inside `.git`; (3) files that would turn the working directory
  into a bare git repo — `HEAD`, `objects`, `refs`, and existing `config`/`hooks`; (4) in `~/.claude` (or
  `CLAUDE_CONFIG_DIR`) plus `~/.claude.json` and `.credentials.json`.
  
  And: "**There is no way to exempt one of these paths**: an `allowWrite` entry or an `Edit` allow rule that
  covers the path doesn't lift the protection. The only way to turn the protection off is `filesystem.disabled`."
  Also: "If a symlink appears at a protected settings file's path during the session, the sandbox also denies
  writes to the file it points to, starting with the next command."
- **VERIFIED-FROM-PUBLIC-SOURCE.** Symlink handling under the write boundary: "with the filesystem layer off,
  a sandboxed command can write files that later commands run or read, such as shell startup files, executables
  on `$PATH`, or `~/.claude/settings.json`, and use them to widen its own access on the next run" — P1.
- **VERIFIED-FROM-PUBLIC-SOURCE.** Glob semantics on macOS (P7 §Filesystem Configuration): "Paths support
  git-style glob patterns on macOS… `*`, `**`, `?`, `[abc]`". P7 also documents the `{"path": …, "literal":
  true}` escape hatch: "To name a path and nothing else, write `{ "path": "/work/*.env", "literal": true }` in
  place of the string. Such an entry is never a pattern, whether or not the path exists." (This is a
  runtime-level knob and is relevant to T1 in Q8.)
- **VERIFIED-FROM-PUBLIC-SOURCE.** Per-command host lists exist in auto mode (v2.1.271+): each Bash /
  PowerShell / Monitor command "can carry a list of hosts beyond the sandbox's allowlist… An approved list
  opens those hosts for that one command alone, for as long as it runs. Nothing is added to your session's
  allowed hosts or your settings." — P1 §Per-command allowed domains in auto mode

### Inferences

- The "protected paths" list is the closest thing in Claude Code to a grove-style invariant: a write-deny
  layer that sits *inside* the writable set and that configuration cannot loosen. It exists because the
  sandbox is only a per-command control — the agent process itself reads those files, so a write there
  becomes privilege escalation on the next command.
- Because `allowUnixSockets` is ignored on Linux and ignored whenever `filesystem.disabled` is irrelevant
  here, a grove design that ports a seatbelt profile to Linux would lose the socket allowlist entirely.

### Gaps

- The SBPL that `allowUnixSockets` compiles to is **not confirmable from public sources**. No Anthropic
  document publishes a `remote unix-socket` / `subpath` rule.
- Whether Seatbelt's own semantics permit a *deny*-only Unix socket policy without an explicit allow list,
  or what happens to sockets opened *before* the profile is applied, is **not documented by Anthropic**.

---

## Q6. Default posture on a fresh install, and the escape hatches

### Takeaway

**Not sandboxed.** The `sandbox` block is unset, `enabled` defaults to `false`, and the whole feature is
opt-in per project or per user. The dominant escape hatch is not a setting but the **`!` shell-mode prompt**,
which runs unsandboxed in most sessions. The secondary hatches are `excludedCommands`, the
`dangerouslyDisableSandbox` retry, and the documented **fail-open** default when the sandbox can't start.

### Cited Findings

- **VERIFIED-FROM-PUBLIC-SOURCE.** Fresh-install default: `sandbox` — "**Default**: unset, so Claude Code runs
  commands without a sandbox"; `sandbox.enabled` — "**Default**: `false`" — P2. P1: "**The sandbox is off by
  default.** To turn it on, run `/sandbox` in a session… or set `sandbox.enabled` to `true` in a settings
  file such as `~/.claude/settings.json`."
- **VERIFIED-FROM-PUBLIC-SOURCE — FAIL-OPEN, documented.** P1 §Get started, verbatim warning:
  > "By default, if the sandbox can't start because a dependency is missing or the platform is unsupported,
  > Claude Code runs commands without sandboxing. To make Claude Code exit at startup instead, set
  > `sandbox.failIfUnavailable` to `true`."
  
  Corroborated by P2 (`failIfUnavailable`: "`false`: Claude Code runs commands unsandboxed when the sandbox
  can't start") and by P3 §sandbox-runtime: "If `~/.srt-settings.json` doesn't exist and you don't pass
  `--settings`, the runtime starts anyway… **Don't take a clean start as proof your settings loaded.**" (For
  the standalone runtime the *opposite* choice is made: "If the settings file exists but is empty, unreadable,
  or invalid, the runtime **refuses to start**… which are a different config rather than a weaker one.")
- **VERIFIED-FROM-PUBLIC-SOURCE — escape hatch #1, the `!` prompt.** "**Commands you type yourself**: a
  command you enter at the `!` shell-mode prompt runs unsandboxed in **most sessions**." — P1. P1 repeats in
  the org-enforcement section: "A developer can still type a command at the `!` shell-mode prompt and run it
  outside the sandbox, with the same access they already have in any terminal outside Claude Code." Only
  background sessions, and Linux sessions with `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` set, are covered.
- **VERIFIED-FROM-PUBLIC-SOURCE — escape hatch #2, `excludedCommands`.** "List a command pattern in
  `sandbox.excludedCommands` to run matching commands outside the sandbox, which means **no filesystem
  restrictions and no network proxy**." Warning: "An excluded command runs with your full access. A broad entry
  such as `docker *` covers everything that tool can do. If you write a pattern that covers an interpreter, a
  script inside your working directory, or a tool that acts on a file there… Claude can write that file and
  then run it outside the sandbox." — P1. P2 adds: "Exclusion is a convenience, **not a security boundary**."
- **VERIFIED-FROM-PUBLIC-SOURCE — escape hatch #3, the unsandboxed retry.** "The unsandboxed retry is an
  escape hatch for commands that fail inside the sandbox… Claude analyzes the failure and may retry the command
  with the **`dangerouslyDisableSandbox`** parameter. The retried command runs unsandboxed." — P1. Approval
  depends on mode: `bypassPermissions` → no prompt; Manual/`acceptEdits` → prompt titled "Bash command
  (unsandboxed)"; `auto` → classifier; `dontAsk` → denied. Critically: "**A matching allow rule**: if an allow
  rule such as `Bash(curl *)` matches the command, **it also approves the retry**, so the command runs outside
  the sandbox with no prompt." Disabled by `sandbox.allowUnsandboxedCommands: false` ("Strict sandbox mode").
- **VERIFIED-FROM-PUBLIC-SOURCE — escape hatch #4, `filesystem.disabled`.** Turns off the filesystem layer
  while keeping network isolation; only user/managed/`--settings` can set it; a repository cannot.
- **VERIFIED-FROM-PUBLIC-SOURCE — escape hatch #5, `allowAppleEvents` / `enableWeakerNetworkIsolation` /
  `enableWeakerNestedSandbox` / `allowAllUnixSockets` / `allowLocalBinding`.** P1 §Keep developers from
  widening the policy: "Each one weakens the sandbox, so set it to `false` in managed settings if you don't
  want it used", listing exactly those five keys plus `allowAppleEvents`.
- **VERIFIED-FROM-PUBLIC-SOURCE — hard stop.** "On Linux and macOS, Claude Code **refuses to start** with
  `--dangerously-skip-permissions` when running as root, so run the container, VM, or sandbox runtime as a
  non-root user." — P3 §How isolation relates to permission modes
- **VERIFIED-FROM-PUBLIC-SOURCE.** Admin-required mode: "If you or your administrator disable the retry in
  managed settings or with the `--settings` flag, the sandbox becomes **admin-required**. Claude Code then
  ignores the settings in a repository's files that loosen the sandbox, `excludedCommands` entries included."
  Requires v2.1.285+ for the full set; "From v2.1.282 to v2.1.284, the same settings made Claude Code ignore a
  repository's `excludedCommands` entries."

### Inferences

- For grove: if grove launches agents with the sandbox enabled but relies on `settings.json` alone, the
  `!`-prompt and the `dangerouslyDisableSandbox` retry remain open unless grove also passes
  `--settings '{"sandbox": {"enabled": true, "allowUnsandboxedCommands": false}}'` (the documented one-liner)
  or ships managed settings. A *repository* cannot close those hatches.
- `failIfUnavailable` defaults `false`, which means any environment where Seatbelt or the proxy fails to
  start degrades silently to *no sandbox*. For grove that is a real availability-vs-safety decision, and
  Anthropic's own recommendation for a security gate is to set it `true` (which turns "no sandbox" into "no
  agent").

### Gaps

- The exact conditions under which Seatbelt fails to start on macOS (as opposed to Linux's `bubblewrap`/
  `socat`) are **not documented**. P1's dependency discussion for macOS says only "sandboxing uses the
  built-in Seatbelt framework"; the Dependencies tab is described as Linux-specific ("plus a Dependencies tab
  on Linux when the optional seccomp filter is missing").
- Whether `sandbox-exec` can be removed, shadowed, or fail on a macOS host in a way that triggers the
  fail-open path is **not confirmable from public sources**.

---

## Q7. Are policy/profile files written to disk at runtime?

### Takeaway

**No public documentation states that Seatbelt profiles are written to disk.** The only documented on-disk
artifacts are config files (`~/.srt-settings.json`, settings.json) and — on Linux/WSL2 only — 0-byte
read-only placeholder files the sandbox creates at settings paths while a command runs.

### Cited Findings

- **VERIFIED-FROM-PUBLIC-SOURCE (profiles described as generated, location unspecified).** "macOS: Uses
  `sandbox-exec` with **dynamically generated** Seatbelt profiles" — P7. P7 never says where the profile
  lives between generation and use.
- **VERIFIED-FROM-PUBLIC-SOURCE (on-disk runtime artifacts that ARE documented).** P1 §Troubleshooting:
  "**On Linux and WSL2**, the sandbox holds a write denial on a file that doesn't exist yet by **creating a
  0-byte read-only placeholder there while a sandboxed command runs.** The sandbox removes the placeholder
  afterward. If a session is killed before that cleanup runs, for example by SIGKILL, the placeholders stay
  behind… Run `claude doctor` in your terminal to list the leftover placeholder files. The
  '**Stale sandbox mask files left by a killed session**' warning names some of them." Requires v2.1.257+.
  **This is Linux/WSL2 only — no macOS equivalent is documented.**
- **VERIFIED-FROM-PUBLIC-SOURCE (config files on disk).** `~/.srt-settings.json` for the standalone runtime,
  overridable with `--settings` (P3, P7). `settings.json` / `settings.local.json` / managed settings files for
  Claude Code (P2, P5).
- **VERIFIED-FROM-PUBLIC-SOURCE (proxy trust material).** P7 documents that TLS termination points the
  sandboxed process at a generated trust bundle, and that the command's `--control-fd` slot is redirected:
  "**On macOS and Linux the sandboxed command does not get the descriptor: srt points that slot at
  `/dev/null` for the command**." The ephemeral MITM CA is generated in-process ("an ephemeral CA if
  omitted"). Whether that CA material or the trust bundle is written to a file is not stated in the fetched
  portion.
- **VERIFIED-FROM-PUBLIC-SOURCE.** `srt` supports live config updates over `--control-fd <fd>`: "Nothing else
  changes. **The filesystem rules are already in the seatbelt profile**, the bubblewrap argv or the Windows
  ACEs, the credential masks were built when the command was wrapped…" — P7. This documents that filesystem
  rules are baked into the profile at wrap time and are not updated live.

### Inferences

- "Dynamically generated" + "The filesystem rules are already in the seatbelt profile … built when the
  command was wrapped" strongly suggests the profile is materialized at wrap time and consumed by
  `sandbox-exec`. Whether that materialization is a pipe/stdin handoff or a temp file is **not stated
  anywhere public**, so the contaminated claim #3 ("generated in memory per invocation; no profile file is
  written to disk") is only *half* confirmable: the "generated per wrap" half is supported, the "in memory,
  never touches disk" half is not.

### Gaps

- **NOT CONFIRMABLE.** Whether a generated Seatbelt profile is written to a temp file on disk, and if so
  where and with what lifetime/permissions, is **not documented in any public Anthropic source**. This
  matters for grove: if a profile file is written to a world-readable temp path, that is an information
  leak; if it is not, grove cannot rely on any on-disk artifact for auditing.
- Whether the violation store writes anything to disk, and whether `--debug` / `SRT_DEBUG` dumps the profile
  text to a log file, is **not confirmable from public sources**. (P7 references an `SRT_DEBUG` env var in
  passing, so a debug mode exists, but no fetched document shows its output format or destination.)

---

## Q8. Documented limitations, known issues, changelog entries, "fail open", and the contaminated claims

### Takeaway

Anthropic documents substantial limitations and ships frequent sandbox fixes — several of which are
bypass-shaped (glob confusion, `excludedCommands` over-matching, sandbox auto-allow skipping deny rules).
The documented fail-open default is "run unsandboxed when the sandbox can't start". Separately, one
third-party writeup alleges an unfixed macOS Seatbelt policy-compiler escape; its reliability is poor.

### Cited Findings — Anthropic's own limitations section

- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §Limitations opens: "**Sandboxing reduces risk but is not a complete
  isolation boundary.** Review the limitations below before relying on it as a hard security control."
- **VERIFIED-FROM-PUBLIC-SOURCE.** The four named security limitations are: (1) **Network filtering** — no
  TLS inspection by default, domain-fronting exposure; (2) **Privilege escalation via Unix sockets** —
  `allowUnixSockets` can grant `/var/run/docker.sock`; (3) **Filesystem permission escalation** — "overly
  broad filesystem write permissions can enable privilege escalation attacks. Allowing writes to directories
  containing executables in `$PATH`, system configuration directories, or user shell configuration files such
  as `.bashrc` or `.zshrc` can lead to code execution in different security contexts"; (4) **Linux sandbox
  strength** — `enableWeakerNestedSandbox` "considerably weakens security"; plus **Apple Events on macOS** —
  `allowAppleEvents` "removes code-execution isolation".
- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §Scope closing warning: "**Effective sandboxing requires both filesystem
  and network isolation.** Without network isolation, a compromised agent could exfiltrate sensitive files
  like SSH keys. Without filesystem isolation… a compromised agent could backdoor system resources to gain
  network access." P6 makes the same claim at launch.
- **VERIFIED-FROM-PUBLIC-SOURCE.** P1 §Limitations warning: "Isolation also does not change what is sent to
  the model. Your prompts and the files Claude reads are transmitted to the Anthropic API… with or without a
  sandbox." — P3.

### Cited Findings — documented macOS-specific breakage (relevant to grove)

- **VERIFIED-FROM-PUBLIC-SOURCE.** `git` over SSH is broken on macOS specifically: "On macOS, `git fetch`,
  `git pull`, and `git push` against an SSH remote fail inside the sandbox **even when the host is allowed**.
  On Linux and WSL2, they work once the host is allowed. Claude Code tunnels git's SSH connection through the
  sandbox proxy, and the macOS tunnel can't authenticate to that proxy." Workaround: switch to HTTPS or add
  `excludedCommands`. — P1 §Troubleshooting
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Go-based CLIs fail TLS verification on macOS": "Tools such as `gh`,
  `gcloud`, and `terraform` may fail TLS verification under Seatbelt." Workarounds: `excludedCommands` (which
  gives them "full access and its stored credentials") or `enableWeakerNetworkIsolation` (which "opens a
  potential data exfiltration vector through the trustd service", per P7). — P1 §Troubleshooting + P7
- **VERIFIED-FROM-PUBLIC-SOURCE.** `open`/`osascript`/browser auth fail with error `-600` on macOS (Apple
  Events blocked by default). — P1 §Troubleshooting
- **VERIFIED-FROM-PUBLIC-SOURCE.** `pbcopy`, `xclip`, `wl-copy` "can fail to reach the system clipboard from
  inside the sandbox". Note: "adding the tool to `excludedCommands` doesn't take that call out of the sandbox
  on its own." — P1 §Troubleshooting
- **VERIFIED-FROM-PUBLIC-SOURCE.** `docker` is documented as incompatible: "`docker` is incompatible with the
  sandbox." `watchman` is incompatible (`jest --no-watchman`). — P1 §Troubleshooting
- **VERIFIED-FROM-PUBLIC-SOURCE.** `git merge`/`checkout` fail with `unable to unlink old` on protected paths.
  — P1 §Troubleshooting

### Cited Findings — changelog entries (P8), the security-relevant ones

- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed a `sandbox.excludedCommands` glob **exempting an entire compound
  Bash command from the sandbox when only one part matched; every part must now match**." — P8. (P2 documents
  the current rule: "**Every command in the call has to match**.")
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed **Bash deny and ask rules missing a command behind an environment
  variable prefix** with an expanded value (e.g. `TZ="$HOME" rm -rf build`) when the sandbox auto-allows
  commands"; and "Fixed a Bash deny or ask rule being skipped under sandbox auto-allow when a bare variable
  assignment came before the command." — P8. These are auto-allow bypasses.
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed **sandboxed Monitor tool commands skipping the permission prompt
  under sandbox auto-allow**; they now follow your permission rules." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed `Edit`/`Write`/`Read` permission rules whose path contains
  **parentheses** being dropped as invalid or ignored by the Bash sandbox, which left 'read-only' folders
  writable." — P8. This is a real sandbox-bypass-shaped bug class (path syntax → dropped rule).
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed one file permission rule with an **uncompilable pattern (e.g. an
  unclosed `[`)** making every file edit fail with `Invalid regular expression`; such a deny rule now guards
  the literal path it spells." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed a permission rule containing a **NUL byte** being expanded into a
  wildcard match; such a rule now matches nothing." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed Bash permission checks auto-approving some read-only commands (such
  as `rg` or `git grep`) whose arguments the shell would still expand as wildcards." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed sandbox `excludedCommands` entries not matching `git rev-parse
  --git-dir`, programs named like shell builtins, and commit messages containing `[WIP]` or `#` lines"; and
  "a short form of a `git clone` option keeping the sandbox exemption from a git pattern such as `git *` in
  `sandbox.excludedCommands`; it is now treated like the long form." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed sandboxed Bash commands being unable to write to project
  directories named `hooks/` or `config/`." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed sandboxed commands being able to read the staged file copies of
  `/ultrareview` uploads under `~/.claude/seed-admin`." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed a managed sandbox read-deny path (and user ones beside it) that
  appears or re-points mid-session not dropping project grants inside it or ending credential injection from
  files it covers." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed **managed `sandbox` settings being ignored entirely when one nested
  value was invalid**; the invalid value now **fails closed** and the rest of the block still applies." — P8.
  Historically this was fail-open; it is now fail-closed.
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed Bash sandbox instructions over-stating confinement: no unenforced
  path lists when filesystem isolation is off, and strict mode no longer claims commands can never run
  unsandboxed." — P8 (v2.1.271 area). Useful: Anthropic has had to walk back overstated confinement claims.
- **VERIFIED-FROM-PUBLIC-SOURCE.** Policy-lock hardening: "Changed sandbox settings so project settings cannot
  widen or turn off an admin-required sandbox, replace the proxy behind a managed deny list, extend a strict
  allowlist, or reopen managed read-denies"; and "Changed `sandbox.excludedCommands` to ignore project and
  local settings entries when managed settings or `--settings` set `allowUnsandboxedCommands: false`, or
  managed `allowManagedDomainsOnly: true`." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** Fixes to the macOS-specific behavior: "Improved sandbox guidance on macOS:
  when a local dev server can't bind a port, Claude now points to `sandbox.network.allowLocalBinding`"; "Fixed
  `permissions.blockReadsOutsideWorkingDirectories` on macOS hiding the user's git config from sandboxed git
  and hiding a worktree-isolated sub-agent's own checkout"; "Fixed an allowed hostname being refused with
  `resolved to a loopback address`" (documented as new in v2.1.284). — P8 + P1
- **VERIFIED-FROM-PUBLIC-SOURCE.** Linux-only sandbox artifacts: "Fixed sandboxed Bash commands on Linux
  inheriting an open handle on the Claude Code executable"; "Fixed sandboxed Bash commands failing to start on
  Linux when the working directory is write-denied and contains a read-denied directory"; "Fixed sandboxed
  Bash commands on Linux reporting exit code 0 for failed commands when the shell is zsh." — P8. Useful for
  grove: these are exactly the classes of bug to expect when a sandbox wrapper is layered under a terminal
  multiplexer — signal handling, exit-status propagation, and inherited FDs are named failure modes.
- **VERIFIED-FROM-PUBLIC-SOURCE.** "Fixed a stale `.git/config.lock` breaking `git checkout -b`, `git push -u`
  and `git config` for the rest of a session after a sandboxed command failed to start (Linux)." — P8
- **VERIFIED-FROM-PUBLIC-SOURCE.** Release-day documentation of the feature itself: "[VSCode] Added a Sandbox
  dialog for the sandbox mode, the unsandboxed fallback and excluded commands, opened from the panel menu or
  by typing `/sandbox`." — P8

### Cited Findings — the third-party writeup (use with heavy caution)

- **T1 (CodeAnt, Oct 10, 2026)** alleges that on macOS arm64, Claude Code 2.1.214 and 2.1.215, a workspace
  whose *real directory name contains glob metacharacters* (e.g. `review-bundle**.claude`) caused the
  Seatbelt policy generator to treat the resolved literal path as a glob, widening the write allow while
  altering the protected-settings deny — allowing a sandboxed, auto-approved Bash command to write a sibling
  project's `.claude/settings.local.json` containing a `SessionStart` hook, which then executed on the
  sibling's next launch "before initialization, authentication, model output, or access to the Bash tool."
  Claimed CVSS 4.0 7.7 High, Anthropic-validated, bounty awarded; fixed version and advisory "TBD".
  https://codeant.ai/blogs/claude-code-macos-sandbox-escape
- **Reliability warning (my assessment, not a source claim).** T1 is a vendor SEO/marketing blog, and it is
  **methodologically contaminated for this assignment**: its own root-cause section states "The
  reverse-engineered JavaScript from Claude Code 2.1.214 showed the following policy-generation path" and
  lists minified identifiers. It also contains unfilled placeholders (`$XXXX bounty`, "TBD" fix version,
  `<parent>` in place of real paths) and duplicate/mangled FAQ sections. It should not be treated as
  established fact, and its root-cause claims cannot be cited from a public source at all.
- **Plausibly-corroborating public signal, independent of T1.** P8 contains several fixes in the same
  family — uncompilable `[` patterns now "guard the literal path it spells"; parentheses in paths "ignored by
  the Bash sandbox, which left 'read-only' folders writable"; NUL bytes "expanded into a wildcard match";
  P7 introduces the `{"path": …, "literal": true}` form explicitly for this reason ("To name a path and
  nothing else… Such an entry is never a pattern"). That Anthropic has repeatedly shipped
  path-metacharacter/pattern-confusion fixes is itself a public, citable fact and a good reason for grove to
  **avoid literal paths containing `* ? [ ]` in any Seatbelt profile it generates.**

### Inferences

- Anthropic's changelog shows a recurring bug class: **user-supplied path/command syntax leaking into the
  policy compiler**, causing rules to be silently dropped (fail-open). For grove this is the single most
  actionable lesson — a grove-generated SBPL profile must fail closed on any path it cannot compile, and must
  never treat a resolved absolute path as a pattern.
- The macOS-specific breakage list (SSH git, Go TLS, Apple Events, clipboard, Docker, watchman) is the
  practical tax of Seatbelt on macOS: there is no per-namespace loopback, no per-process mount namespace, and
  `network-outbound` cannot filter by domain. Several documented breakages have documented workarounds that
  *weaken* the sandbox (`excludedCommands`, `enableWeakerNetworkIsolation`, `allowAppleEvents`).
- Anthropic's own ordering (VM > container > dev container > sandbox runtime > Bash sandbox) is the clearest
  public signal available about where the vendor thinks the strong boundary is.

### Gaps

- No Anthropic security advisory or CVE for the Seatbelt policy-compiler issue is publicly available as of
  this research; T1 itself says the fix/advisory decision is "TBD". Whether Anthropic issued one cannot be
  confirmed from public sources.
- Anthropic's `trust.anthropic.com` advisory feed was not searched in this pass; an out-of-band advisory
  could exist. Treated as a gap.
- Whether Anthropic's published CVSS/bounty claim in T1 is real is **not confirmable from public sources**.
- Rate or severity data on sandbox-escape reports in the wild (HackerOne, CVEs) was not gathered; the
  HackerOne program exists (P4 §Reporting security issues) but its contents are not public.

---

## Appendix — status of the seven "contaminated claims" from the previous pass

Each is re-established from a public source or explicitly marked. **Claim 7 in particular was produced by
string extraction and is unsupported by any public source; it should be deleted, not re-verified.**

| # | Previous claim | Verdict | Basis |
| :- | :- | :- | :- |
| 1 | Mechanism is `/usr/bin/sandbox-exec -p <profile>` with SBPL beginning `(version 1) (deny default ...)` | **PARTLY VERIFIED / partly NOT CONFIRMABLE** | VERIFIED that macOS enforcement is Seatbelt via `sandbox-exec` with dynamically generated profiles (P1 §OS-level enforcement; P7 §How It Works; P7 log-stream example naming the `sandbox-exec` process). **NOT CONFIRMABLE:** the absolute path `/usr/bin/sandbox-exec`, the `-p` flag, the delivery mechanism for the profile, and the exact SBPL text including `(version 1)` and `(deny default …)`. No public Anthropic source publishes a generated profile. |
| 2 | Bash invocations are individually wrapped; the agent process itself is not confined | **VERIFIED-FROM-PUBLIC-SOURCE** | P1 intro ("around the shell commands Claude runs… Bash, PowerShell, and Monitor commands and the processes they start"; "The sandbox covers shell commands only"), P1 §What runs outside the sandbox, P1 §Scope ("run Claude Code (local mode) inside the sandbox runtime… or in the dev container"), P3 comparison table (Bash tool = commands + child processes; sandbox runtime = whole process). |
| 3 | Profiles are generated in memory per invocation; no profile file is written to disk | **PARTLY VERIFIED / partly NOT CONFIRMABLE** | VERIFIED that profiles are "dynamically generated" (P7) and that filesystem rules are baked into the profile at wrap time (P7 §`--control-fd`). **NOT CONFIRMABLE:** whether they are held "in memory", and whether any profile file touches disk. No public source addresses this. The only documented on-disk sandbox artifacts are Linux/WSL2-only 0-byte placeholder files (P1 §Troubleshooting) and `~/.srt-settings.json`. |
| 4 | Network is blocked by default by permitting only `localhost` to a local proxy port | **VERIFIED-FROM-PUBLIC-SOURCE** | P1 §Network isolation: "macOS: the Seatbelt sandbox framework by default blocks connections other than the one to the sandbox proxy"; proxy runs "outside the sandbox" and is reached via `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`. P7: "The Seatbelt profile allows communication only to a specific localhost port. … All other network access is blocked." The *port number* is not documented. (Minor drift: P6 from Oct 2025 described a Unix domain socket; the current docs describe localhost TCP ports on macOS.) |
| 5 | `allowUnixSockets` produces `(allow network-outbound (remote unix-socket (subpath "...")))` | **PARTLY VERIFIED / partly NOT CONFIRMABLE** | VERIFIED that `sandbox.network.allowUnixSockets` exists, is macOS-only, is a list of socket paths, and defaults to unset/blocked (P2; P7 Unix Socket Settings table). **NOT CONFIRMABLE:** the SBPL rule it compiles to. No public Anthropic source publishes that rule. (Contrast: the `allowPty` SBPL fragment *is* published in P7, so publication of such rules is possible — this one simply is not.) |
| 6 | Defaults: `enabled: false`; `autoAllowBashIfSandboxed` defaults `true`; a `dangerouslyDisableSandbox` retry hatch exists | **VERIFIED-FROM-PUBLIC-SOURCE** | P2: `sandbox.enabled` "**Default**: `false`"; `sandbox.autoAllowBashIfSandboxed` "**Default**: `true`"; `sandbox.allowUnsandboxedCommands` "**Default**: `true`". P1 §The unsandboxed retry escape hatch: "Claude analyzes the failure and may retry the command with the **`dangerouslyDisableSandbox`** parameter. The retried command runs unsandboxed." |
| 7 | An embedded comment reading "Essential permissions - based on Chrome sandbox policy" | **NOT-CONFIRMABLE — discard** | No public Anthropic documentation, changelog entry, repository file, advisory, or third-party write-up encountered in this research mentions this string or attributes any Claude Code behaviour to a Chrome sandbox policy. It is a product-internals artifact and, per this assignment's constraints, cannot be re-established without inspecting the shipped binary. **Delete it.** |

Two further corrections to the previous pass's framing:

- There is **no `sandbox.allowedCommands`** key (zero occurrences across the entire settings reference).
  Widening is done with `sandbox.filesystem.allowWrite` / `allowRead` and permission rules, or by removing a
  command from the sandbox entirely with `sandbox.excludedCommands`.
- The Anthropic docs at `docs.claude.com/en/docs/claude-code/*` are served from the same content as
  `code.claude.com/docs/en/*`; the search-result summary line "macOS: uses Seatbelt for sandbox enforcement"
  that appears on both is the authoritative mechanism statement.

---

## Gaps that matter most to grove's decision (summary)

1. **No public source describes the boundary Claude Code's built-in sandbox actually draws on macOS at the
   policy-text level.** Everything above is documented behaviour and configuration surface; the generated
   SBPL is not published. Any grove conclusion of the form "we can reuse Claude Code's exact macOS policy" is
   unsupported.
2. **No public source states whether a profile file is written to disk.** If grove needs to audit or ship a
   policy, it must generate its own.
3. **Anthropic's own documented verdict is that the Bash sandbox is insufficient for unattended runs** and
   that a process-level boundary (sandbox runtime, container, or VM) is the answer for that case. Seatbelt
   is the mechanism *inside* the no-Docker option; it is not itself the outer boundary Anthropic recommends
   when isolation matters.
4. **Third-party claims about macOS Seatbelt escapes exist but the strongest one found is methodologically
   contaminated and partly placeholder-filled.** The durable, citable lesson is the *class* of bug (path
   metacharacters leaking into the policy compiler), which is independently corroborated by real changelog
   fixes and by the runtime's new `{"literal": true}` path form.
5. **Apple `container` is not addressed by any Anthropic document fetched.** No public Anthropic source
   discusses Apple's containerization framework, so there is no vendor comparison to make. (Gap for the
   coordinator: the Apple `container` side of the grove question needs a different researcher.)