# 0040. A sandboxed session authenticates through the agent's own channel, never the Keychain

Date: 2026-10-11

## Status

Accepted

## Context

Slice 1 ran the real Claude Code v2.1.296 inside `grove-sandbox:cbcd1e51f27a`. It started,
read its mounted config, rendered its TUI, and stopped at **"Select login method"**. The
design had assumed the mount set carried credentials; it does not, and could not.

Measuring both agents on the host and in the real container settled three things:

1. **Claude Code's OAuth token lives in the macOS Keychain** (`svce = "Claude Code-credentials"`,
   measured with `security dump-keychain`). There is no `~/.claude/.credentials.json` on a
   Mac that has logged in interactively, and a Linux VM cannot read a Mac keychain at all.
2. **OpenCode carries no credential on this machine at all** — no `auth.json`, no
   `credential` row in `opencode.db`, no keychain entry, no `OPENCODE_API_KEY`, and
   `opencode auth list` reporting "No authenticated integrations" — and yet it runs. The
   Zen free tier is gated on the client *being* opencode: an unauthenticated curl to
   `opencode.ai/zen/v1` gets `403 FreeTierError`. So its auth is the binary, not a secret.
3. **The root cause of both is `HOME`.** The container runs `uid=0` with `HOME=/root`, so
   both agents resolve `~` to `/root` while grove mounts the host's config at
   `/Users/victor/…`. Those volumes were **present and never read**. A run inside the
   container created its own `/root/.claude.json`, `/root/.config/opencode/opencode.jsonc`
   and `/root/.local/share/opencode/opencode.db`, leaving the host's untouched.

That third point is also why a host-side `opencode auth login` — GitHub Copilot on another
Mac — never reached the sandbox: OpenCode documents that credential as
`~/.local/share/opencode/auth.json`, inside a directory grove already mounts.

## Decision

A sandboxed session authenticates through each agent's **own documented credential
channel**, and grove refuses `no-sandbox` rather than opening a pane that cannot log in.
Concretely: point `CLAUDE_CONFIG_DIR` (claude) and `XDG_DATA_HOME` / `XDG_CONFIG_HOME`
(opencode) at the host paths grove **already** mounts — no new mounts, and ADR 0035's
same-path invariant untouched — forward `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY`
**bare**, so the value comes from the pane's login shell and never enters argv, and carve
`settings.json`, `.credentials.json` and `auth.json` out read-only.

**grove never reads the macOS Keychain.**

## Consequences

Easier: no new volume, no new dependency, no schema change, and roughly four entries in
`envFor` plus three carve-outs. A host-side `opencode auth login` starts working inside the
sandbox with no grove change beyond the pointer — measured, the containerized agent read a
mounted `auth.json` and listed the provider as authenticated. OpenCode needs no
configuration at all when the human has not logged in.

Harder: forwarding is only as good as the user's shell profile, so grove gains a probe
(`$SHELL -l -i -c`, the interpreter the pane already uses) to detect absence before opening
a pane — necessary because a bare `-e VAR` for an unset variable **does not fail the run**.
Making the config volumes live also means the agent can now read and write Claude history
and transcripts for every project, which it silently could not before.

Rejected:

- **Reading the Keychain.** Unsupported by Anthropic, and conditionally unavailable —
  locked after reboot or under FileVault, keychain password out of sync, no Aqua session, a
  `CLAUDE_CONFIG_DIR` session reading a different item, Data Protection entries invisible to
  `security`. Decisively: Claude Code creates the item with no `-T`/`-A`, so any same-user
  process can read it — reported to Anthropic (Silverfort, HackerOne 2026-06-25, CWE-732) as
  *"any macOS process can read stored credentials"*, and **Anthropic confirmed they are
  tightening that ACL as a hardening improvement**. grove would break as a silent, remote
  change, most likely as a login-password prompt inside a GUI-launched Electron app that
  cannot answer it.
- **grove writing a credential file from the Keychain.** Converts an ephemeral environment
  variable into a durable secret at rest, readable by the sandbox — strictly worse than the
  keychain read it replaces, which Claude Code itself rotates.
- **A token baked into the image.** The image is content-addressed by grove from the
  Dockerfile alone, so a secret would ship inside the shared, reusable tag.
- **A one-time interactive login inside the container.** Measured dead: it writes to
  `/root`, which is destroyed on exit, so *every* session would have to log in again.

One accepted gap: grove cannot distinguish a one-year `claude setup-token` from a
short-lived credential, and Anthropic's own container guidance prefers short-lived,
repository-scoped tokens. grove therefore **names the variable it forwards** on the session
card and in the refusal message rather than forwarding silently. Transparency is the
mitigation; enforcement is not available.

## References

- [ADR 0035](./0035-sandbox-binds-mounts-at-identical-host-paths.md) — the same-path
  invariant D8 reuses rather than bends.
- [ADR 0036](./0036-sandbox-isolation-is-filesystem-only.md) — why a plaintext token in
  the agent's environment is in scope for this feature.
- Anthropic, authentication precedence and container guidance:
  <https://code.claude.com/docs/en/authentication>, <https://code.claude.com/docs/en/devcontainer>
- Silverfort, the ACL weakness and Anthropic's response:
  <https://www.silverfort.com/blog/skipping-the-lock-a-claude-code-cli-weakness-lets-any-macos-process-read-stored-credentials>
